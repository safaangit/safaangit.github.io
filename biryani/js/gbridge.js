// Link to Safaan's own Google Apps Script (app/tasks-bridge.gs), which mirrors the Tasks tab into Google Tasks
// (for the home-screen widget and Google Home / Gemini voice) and puts timed tasks on Google Calendar.
// The app pushes its changes a second after you make them and pulls back what was checked off or added
// on the Google side whenever it opens. URL + key stay on this phone.
import * as db from './db.js';
import { local } from './db.js';
import * as P from './taskparse.js';

const FILE = 'tasks';
export const configured = () => !!(local.get('gbUrl', '') && local.get('gbKey', ''));
const EMOJI = new RegExp(`^\\s*(?:⭐\\s*)?(?:(?:${P.CATS.map(c => c.emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*)?`, 'u');
export const stripPrefix = t => t.replace(EMOJI, '').trim();

const slim = r => {
  const o = { id: r.id };
  if (r.del) { o.del = true; return o; }
  for (const k of ['kind', 't', 'due', 'time', 'rm', 'list', 'qty', 'store', 'aisle', 'note', 'pri', 'cat', 'gone']) if (r[k] != null && r[k] !== '') o[k] = r[k];
  if (r.done) o.done = true;
  if (r.kind !== 'grocery') { o.kind = 'task'; o.emoji = P.catOf(r.cat || P.categoryOf(r.t)).emoji; }
  return o;
};

// Google's /dev address only answers someone signed in to Google in that same browser, so the phone can't use it.
export const DEV_MSG = 'That link is Google\'s test address (ends in /dev). In the script: Deploy → Manage deployments → copy the Web app URL (ends in /exec) and paste it in Setup steps → "Paste the link details by hand".';
async function call(items) {
  if (/\/dev\/?$/.test(local.get('gbUrl', ''))) throw new Error(DEV_MSG);
  const r = await fetch(local.get('gbUrl', ''), {
    method: 'POST', redirect: 'follow',
    headers: { 'content-type': 'text/plain;charset=utf-8' }, // a "simple" request: no CORS preflight, which Apps Script can't answer
    body: JSON.stringify({ key: local.get('gbKey', ''), items, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  });
  const j = await r.json().catch(() => null);
  if (!j) throw new Error('Google script answered with something unexpected. Check it is deployed as a Web app with access "Anyone".');
  if (j.error) throw new Error(j.error === 'wrong key' ? 'Google script says the key is wrong. Copy it again from the setup log.' : 'Google script error: ' + j.error);
  return j;
}

export async function test() { return call([]); }

let running = null;
// Returns true when something changed locally (so the screen should redraw).
export function sync() { return (running ??= doSync().finally(() => (running = null))); }
async function doSync() {
  if (!configured()) return false;
  const started = Date.now(), last = local.get('gbPushed', 0);
  const recs = Object.values((await db.file(FILE)).records);
  // First link: skip finished and deleted things so Google doesn't fill up with history.
  const items = recs.filter(r => (r.u || 0) > last && (last || (!r.del && !r.done && !r.gone))).map(slim);
  let res;
  try { res = await call(items); local.set('gbErr', ''); }
  catch (e) { local.set('gbErr', navigator.onLine === false ? 'Offline' : e.message); throw e; }
  local.set('gbPushed', started);
  local.set('gbLast', Date.now());
  return applyRemote(res);
}

async function applyRemote(res) {
  let changed = false;
  const s = await db.settings();
  const all = () => db.all(FILE);
  for (const st of res.state || []) {
    const r = await db.get(FILE, st.id);
    if (!r) continue;
    if (st.gone) {
      if (r.kind === 'grocery' && !r.gone) { await db.put(FILE, { ...r, gone: true, done: undefined }); changed = true; }
      else if (r.kind !== 'grocery' && !r.done && (r.list || 'todo') === 'todo') { await db.put(FILE, { ...r, done: Date.now() }); changed = true; }
      continue;
    }
    if (st.done && !r.done) {
      if (r.kind !== 'grocery' && r.rep && r.due) await db.put(FILE, { ...r, due: P.nextDue(r.due, r.rep, db.today()), lastDone: Date.now() });
      else await db.put(FILE, { ...r, done: Date.now() });
      changed = true;
    } else if (!st.done && r.done && r.kind === 'grocery' && !r.gone) {
      const u = { ...r }; delete u.done; await db.put(FILE, u); changed = true;
    }
  }
  for (const it of res.inbox || []) {
    if (await db.get(FILE, it.id)) continue;
    const raw = stripPrefix(it.title).replace(/\s+×\s*\S+/, '').replace(/\s+·\s+[^·]+$/, '');
    const pr = P.parsePri(raw);
    const kind = it.list === 'groc' ? 'grocery' : P.kindOf(pr.text, { learned: s.tasksLearn || {} }) === 'grocery' ? 'grocery' : 'task';
    if (kind === 'grocery') {
      const g = P.groceryBits(pr.text);
      const dup = (await all()).find(r => r.kind === 'grocery' && !r.gone && P.sameItem(r.t, g.name));
      if (dup) {
        // Already on the list: drop the copy (the next push deletes it from Google too) and un-check the original.
        await db.put(FILE, { id: it.id, del: true });
        if (dup.done) { const u = { ...dup }; delete u.done; await db.put(FILE, u); }
      } else {
        await db.put(FILE, { id: it.id, kind: 'grocery', t: g.name || pr.text, qty: g.qty, store: g.store, aisle: (s.aisleLearn || {})[P.core(g.name).join(' ')] || P.aisleOf(g.name), buys: 0, created: Date.now(), src: 'google' });
      }
    } else {
      const w = P.parseWhen(pr.text);
      const ref = P.REF_PREFIX.test(pr.text);
      const t = w.title.replace(P.REF_PREFIX, '');
      await db.put(FILE, { id: it.id, kind: 'task', t: t[0].toUpperCase() + t.slice(1), note: it.notes || undefined, due: it.due || w.due, time: it.time || w.time, rep: w.rep, pri: pr.pri || undefined,
        cat: P.categoryOf(t, s.catLearn), list: ref ? 'ref' : P.listFor(t), rm: (it.time || w.time) ? 0 : null, created: Date.now(), src: 'google' });
    }
    changed = true;
  }
  return changed;
}
