// Read-only side of Money: the files the money-sync job writes to data/money/ in the private repo.
// Shares Biryani's GitHub token (same site, same localStorage), so there is no second sign-in.
// Each file is kept in IndexedDB and only downloaded again when its sha changes, so opening the app
// costs two small directory listings when nothing moved.
import { kv, local } from './db.js';

const cfg = () => ({ token: local.get('ghToken', ''), repo: local.get('ghRepo', 'safaangit/safaan-personal'), branch: local.get('ghBranch', '') });
export const configured = () => !!cfg().token;

async function gh(path, opts = {}) {
  const { token, repo } = cfg();
  const r = await fetch(`https://api.github.com/repos/${repo}${path ? '/' + path : ''}`, {
    cache: 'no-store', ...opts,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...opts.headers },
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    let msg = `GitHub ${r.status}`;
    if (r.status === 401) msg = 'GitHub rejected the token. Paste a new one in Baro\'s Biryani → Settings.';
    else if (r.status === 403 && path.startsWith('actions')) msg = 'Token is missing the "Actions: Read and write" permission (needed for Refresh accounts).';
    else if (r.status === 403) msg = 'GitHub rate limit or permission problem; try again in a few minutes.';
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return r.status === 204 ? true : r.headers.get('content-type')?.includes('json') ? r.json() : r.text();
}
let defaultBranch;
async function branch() {
  if (cfg().branch) return cfg().branch;
  defaultBranch ??= gh('').then(r => r.default_branch).catch(e => { defaultBranch = null; throw e; });
  return defaultBranch;
}
async function listing(dir) {
  const l = await gh(`contents/${dir}?ref=${encodeURIComponent(await branch())}`);
  return Object.fromEntries((Array.isArray(l) ? l : []).filter(x => x.type === 'file' && x.name.endsWith('.json')).map(x => [x.name.slice(0, -5), x.sha]));
}
async function raw(path) {
  const t = await gh(`contents/${path}?ref=${encodeURIComponent(await branch())}`, { headers: { accept: 'application/vnd.github.raw+json' } });
  return t == null ? null : typeof t === 'string' ? JSON.parse(t) : t;
}

// What the phone already has: { accounts, holdings, history, quotes, meta, halal, cards, picks, 'tx/2026-11', ... }
const mem = new Map();
export async function cached(name) {
  if (!mem.has(name)) mem.set(name, (await kv.get('m:' + name)) ?? null);
  return mem.get(name);
}
export async function cachedNames() { return ((await kv.keys()) || []).filter(k => typeof k === 'string' && k.startsWith('m:')).map(k => k.slice(2)); }

// Pull whatever changed. Returns the names that changed (empty = nothing new).
let running;
export function refresh() { return (running ??= doRefresh().finally(() => (running = null))); }
async function doRefresh() {
  if (!configured()) return [];
  const known = (await kv.get('m:shas')) || {};
  const [top, tx] = await Promise.all([listing('data/money'), listing('data/money/tx')]);
  const remote = { ...top };
  for (const [n, sha] of Object.entries(tx)) remote['tx/' + n] = sha;
  const changed = Object.entries(remote).filter(([n, sha]) => known[n] !== sha);
  await Promise.all(changed.map(async ([n, sha]) => {
    const data = await raw(`data/money/${n}.json`);
    if (data == null) return;
    await kv.set('m:' + n, data); mem.set(n, data); known[n] = sha;
  }));
  await kv.set('m:shas', known);
  local.set('moneyChecked', Date.now());
  return changed.map(([n]) => n);
}

// Start the account pull now (the same job that runs on a timer). Needs Actions: write on the token.
export async function runSync() {
  return gh('actions/workflows/money-sync.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: await branch() }) });
}

// ---- live prices straight from the phone (no job, no wait) ----
// Finnhub free key is device-only (localStorage), never synced. Without one the app shows the job's last prices.
export const finnhubKey = () => local.get('finnhubKey', '');
export async function liveQuotes(syms) {
  const key = finnhubKey();
  if (!key || !syms.length) return {};
  const out = {};
  await Promise.all([...new Set(syms)].slice(0, 50).map(async s => {
    try {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s)}&token=${encodeURIComponent(key)}`);
      if (!r.ok) return;
      const q = await r.json();
      if (q && q.c > 0) out[s] = { p: q.c, pc: q.pc, t: (q.t || 0) * 1000 };
    } catch {}
  }));
  if (Object.keys(out).length) { await kv.set('m:live', { at: Date.now(), q: out }); }
  return out;
}
export const lastLive = async () => (await kv.get('m:live')) || { at: 0, q: {} };

// Gold and silver spot (USD per troy oz) for nisab. gold-api.com: free, no key, CORS open.
export const metalsCached = async () => (await kv.get('m:metals')) || null;
export async function metals() {
  const c = (await kv.get('m:metals')) || null;
  if (c && Date.now() - c.at < 6 * 3600e3) return c;
  try {
    const [g, s] = await Promise.all(['XAU', 'XAG'].map(x => fetch(`https://api.gold-api.com/price/${x}`).then(r => r.json())));
    if (g?.price > 0 && s?.price > 0) { const v = { at: Date.now(), gold: g.price, silver: s.price }; await kv.set('m:metals', v); return v; }
  } catch {}
  return c; // stale beats nothing; null when it has never loaded
}
