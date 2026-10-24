// Syncs local files with data/fuel/ in the GitHub repo through the contents API,
// and reads the Garmin files the nightly workflow writes to data/garmin/.
import { file, kv, local, replaceFromRemote, dirtyList, clearDirty } from './db.js';

const cfg = () => ({
  token: local.get('ghToken', ''), repo: local.get('ghRepo', 'safaangit/safaan-personal'), branch: local.get('ghBranch', ''),
});
export const configured = () => !!cfg().token;

async function gh(path, opts = {}) {
  const { token, repo } = cfg();
  const r = await fetch(`https://api.github.com/repos/${repo}${path ? '/' + path : ''}`, {
    ...opts,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...opts.headers },
  });
  if (r.status === 404) return null;
  if (!r.ok) { const e = new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 160)}`); e.status = r.status; throw e; }
  return r.status === 204 ? true : r.headers.get('content-type')?.includes('json') ? r.json() : r.text();
}
function enc(s) {
  const b = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(bin);
}
// Empty branch setting = the repo's default branch (looked up once per session).
let defaultBranch;
async function branch() {
  if (cfg().branch) return cfg().branch;
  defaultBranch ??= gh('').then(r => r.default_branch).catch(e => { defaultBranch = null; throw e; });
  return defaultBranch;
}
const ref = async () => `ref=${encodeURIComponent(await branch())}`;

// Directory listing -> { name: sha }.
async function listing(dir) {
  const l = await gh(`contents/${dir}?${await ref()}`);
  return Object.fromEntries((Array.isArray(l) ? l : []).filter(x => x.type === 'file').map(x => [x.name, x.sha]));
}
async function raw(path) {
  const t = await gh(`contents/${path}?${await ref()}`, { headers: { accept: 'application/vnd.github.raw+json' } });
  return t == null ? null : typeof t === 'string' ? JSON.parse(t) : t;
}
async function putFile(path, data, sha) {
  const body = { message: `fuel: sync ${path.replace('data/', '')}`, content: enc(JSON.stringify(data, null, 1) + '\n'), branch: await branch() };
  if (sha) body.sha = sha;
  return gh(`contents/${path}`, { method: 'PUT', body: JSON.stringify(body) });
}

const pathOf = name => `data/fuel/${name}.json`;
let running;
export function sync() { return (running ??= doSync().finally(() => (running = null))); }

async function doSync() {
  if (!configured()) return { skipped: true };
  const known = (await kv.get('shas')) || {};
  const [top, logs] = await Promise.all([listing('data/fuel'), listing('data/fuel/log')]);
  const remote = {};
  for (const [n, sha] of Object.entries(top)) if (n.endsWith('.json')) remote[n.slice(0, -5)] = sha;
  for (const [n, sha] of Object.entries(logs)) if (n.endsWith('.json')) remote['log/' + n.slice(0, -5)] = sha;

  let pulled = 0, pushed = 0;
  // Pull files that changed elsewhere (another device, Claude, a manual edit).
  for (const [name, sha] of Object.entries(remote)) {
    if (known[name] === sha) continue;
    const data = await raw(pathOf(name));
    if (data && (await replaceFromRemote(name, data))) pulled++;
    known[name] = sha;
  }
  // Push local changes; on a conflict, re-pull and merge once more.
  for (const name of await dirtyList()) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await putFile(pathOf(name), await file(name), known[name]);
        known[name] = res.content.sha; pushed++;
        break;
      } catch (e) {
        if (![409, 422].includes(e.status) || attempt === 2) throw e;
        const cur = await gh(`contents/${pathOf(name)}?${await ref()}`);
        if (cur?.sha) { await replaceFromRemote(name, await raw(pathOf(name))); known[name] = cur.sha; }
      }
    }
    await clearDirty(name);
  }
  await kv.set('shas', known);
  local.set('lastSync', Date.now());
  return { pulled, pushed };
}

// ---- Garmin ----
// data/garmin/YYYY-MM.json = { days: { 'YYYY-MM-DD': { steps, activeKcal, ..., activities: [...] } } }
const gcache = new Map();
export async function garminMonth(ym, { fresh = false } = {}) {
  const key = 'g:' + ym;
  if (!fresh && gcache.has(ym)) return gcache.get(ym);
  let d = await kv.get(key);
  const stale = !d || Date.now() - (d.fetched || 0) > 30 * 60e3;
  if (configured() && (stale || fresh)) {
    try { const r = await raw(`data/garmin/${ym}.json`); if (r) { d = { ...r, fetched: Date.now() }; await kv.set(key, d); } } catch {}
  }
  d ??= { days: {} };
  gcache.set(ym, d);
  return d;
}
export async function garminDay(date, opts) { return (await garminMonth(date.slice(0, 7), opts)).days?.[date]; }
export async function garminMeta() { try { return configured() ? await raw('data/garmin/meta.json') : null; } catch { return null; } }

// Kicks off the Garmin workflow now (needs Actions: write on the token).
export async function runGarminSync() {
  return gh('actions/workflows/garmin-sync.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: await branch() }) });
}
