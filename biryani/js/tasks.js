// Tasks + groceries: one capture box for everything ("call dad tmrw 5pm, milk, eggs"), sorted on the way in
// so nothing piles up in an "Unsorted" dump.
// data/fuel/tasks.json, one record per item:
//   task:    { id, kind: 'task', t, note?, due?, time?, rep?: {n, unit}, lead? (days before due a repeating one shows), rm?,
//              pri?: true (pinned to top), cat (color category), list: 'todo'|'shop'|'ideas'|'watch'|'someday'|'ref', done?: ms, created }
//   grocery: { id, kind: 'grocery', t, qty?, store?, aisle, done?: ms (in cart), gone?: true (bought, kept for Usuals), buys, last?,
//              hist?: [ms…] (every purchase), every?: days (set rhythm), auto?: true (put back on the list when due), created }
// Groceries are never deleted when bought: the record is revived next time, so "pickles" never turns into three rows
// and the most-bought items show up as one-tap Usuals.
import * as db from './db.js';
import { today, local } from './db.js';
import * as voice from './voice.js';
import * as P from './taskparse.js';

const FILE = 'tasks';
const DAY = 864e5;
const STALE_DAYS = 14;
const addDays = (d, k) => today(new Date(new Date(d + 'T12:00').getTime() + k * DAY));
const st = { mode: local.get('tasksMode', 'tasks'), store: local.get('groceryStore', 'all'), open: new Set(local.get('tasksOpen', [])), showAll: false };
const saveOpen = () => local.set('tasksOpen', [...st.open]);

export const all = () => db.all(FILE);
const tasksOf = async () => (await all()).filter(r => r.kind !== 'grocery');
const groceriesOf = async () => (await all()).filter(r => r.kind === 'grocery');

// ---------- formatting ----------
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
}
export function fmtDue(due, time) {
  if (!due) return '';
  const t0 = today(), diff = Math.round((new Date(due + 'T12:00') - new Date(t0 + 'T12:00')) / DAY);
  const d = new Date(due + 'T12:00');
  let s = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday'
    : diff > 1 && diff < 7 ? d.toLocaleDateString(undefined, { weekday: 'short' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
  return time ? `${s} ${fmtTime(time)}` : s;
}
const dueCls = r => !r.due || r.done ? '' : r.due < today() ? 'over' : r.due === today() ? 'today' : '';

// ---------- context for parsing ----------
let knownP;
async function ctx(s) {
  knownP ??= db.all('foods').then(fs => new Set(fs.map(f => P.core(f.name || '').join(' ')).filter(Boolean))).catch(() => new Set());
  return { known: await knownP, learned: s.tasksLearn || {} };
}

// ---------- saving ----------
// Adds one parsed capture item. Returns a short label for the toast, or null when it was a duplicate.
async function addItem(it, s, { mode } = {}) {
  const now = Date.now();
  if (it.kind === 'grocery') return addGrocery(it.text, s);
  const pr = P.parsePri(it.text);
  const ref = P.REF_PREFIX.test(pr.text);
  const w = P.parseWhen(pr.text.replace(P.REF_PREFIX, '').replace(P.IDEA_PREFIX, ''));
  const title = w.title[0].toUpperCase() + w.title.slice(1);
  const dup = (await tasksOf()).find(r => !r.done && P.core(r.t).join(' ') === P.core(title).join(' ') && (r.due || null) === w.due);
  if (dup) return { dup: dup.t };
  await db.put(FILE, { kind: 'task', t: title, due: w.due, time: w.time, rep: w.rep, list: ref ? 'ref' : P.listFor(it.text), created: now, rm: w.time ? 0 : w.due ? 'morning' : null,
    pri: pr.pri || undefined, cat: P.categoryOf(title, s.catLearn) });
  return { task: title, due: w.due };
}
async function addGrocery(text, s) {
  const g = P.groceryBits(text);
  if (!g.name) return null;
  const items = await groceriesOf();
  const same = items.filter(r => P.sameItem(r.t, g.name));
  const active = same.find(r => !r.gone);
  if (active) {
    // Already on the list (or in the cart): don't add a second row.
    const upd = { ...active };
    if (active.done) delete upd.done;
    if (g.qty) upd.qty = g.qty;
    if (g.store && !active.store) upd.store = g.store;
    await db.put(FILE, upd);
    return { dup: active.t, back: !!active.done };
  }
  const old = same.sort((a, b) => (b.buys || 0) - (a.buys || 0))[0];
  const learnedAisle = (s.aisleLearn || {})[P.core(g.name).join(' ')];
  if (old) {
    const upd = { ...old, gone: false, qty: g.qty || null, created: Date.now() };
    delete upd.done; if (g.store) upd.store = g.store;
    await db.put(FILE, upd);
    return { grocery: old.t };
  }
  await db.put(FILE, { kind: 'grocery', t: g.name, qty: g.qty, store: g.store, aisle: learnedAisle || P.aisleOf(g.name), buys: 0, created: Date.now() });
  return { grocery: g.name };
}

// Adds a whole capture. Food lines go to the food logger. Returns { added, groceries, dups, food }.
export async function capture(text, s, ui, { kinds } = {}) {
  const items = kinds || P.splitCapture(text, await ctx(s));
  const res = { tasks: [], groceries: [], dups: [], food: [] };
  for (const it of items) {
    if (it.kind === 'food') { res.food.push(it.text); continue; }
    const r = await addItem(it, s);
    if (!r) continue;
    if (r.dup) res.dups.push(r.dup); else if (r.grocery) res.groceries.push(r.grocery); else res.tasks.push(r);
  }
  const bits = [];
  if (res.tasks.length) bits.push(res.tasks.length === 1 ? `Added "${res.tasks[0].task}"${res.tasks[0].due ? ' · ' + fmtDue(res.tasks[0].due) : ''}` : `${res.tasks.length} tasks added`);
  if (res.groceries.length) bits.push(`${res.groceries.length} to Groceries`);
  if (res.dups.length) bits.push(`${res.dups.length === 1 ? `"${res.dups[0]}" was` : `${res.dups.length} were`} already on the list`);
  if (bits.length) ui.toast(bits.join(' · '));
  if (res.food.length) ui.logFoodText(res.food.join(', '));
  return res;
}

// Counts for the nav badge: overdue + due today.
export async function dueCount() {
  const t = today();
  const cut = addDays(t, -MISSED_DAYS);
  return (await tasksOf()).filter(r => !r.done && r.due && r.due <= t && (r.due >= cut || r.rep) && DATED.has(r.list || 'todo')).length;
}

// ---------- view ----------
function taskRow(r, ui) {
  const sub = [
    r.due ? `<span class="due ${dueCls(r)}">${ui.ico('cal')}${ui.esc(fmtDue(r.due, r.time))}</span>` : '',
    r.rep ? `<span class="rep">${ui.ico('refresh')}${ui.esc(P.repText(r.rep))}</span>` : '',
    r.note ? `<span class="nt">${ui.ico('note')}</span>` : '',
  ].filter(Boolean).join('');
  const c = P.catOf(r.cat || P.categoryOf(r.t));
  const ref = r.list === 'ref' && r.note ? `<div class="tnote">${ui.esc(r.note.split('\n').slice(0, 2).join(' · '))}</div>` : '';
  return `<li class="tk ${r.done ? 'done' : ''} ${r.pri ? 'pri' : ''}" data-id="${r.id}" style="--cc:${c.color}"><button class="tbox" aria-label="${r.done ? 'Mark not done' : 'Done'}">${r.done ? ui.ico('check') : ''}</button>
    <div class="grow"><div class="name">${r.pri ? '<span class="star">★</span>' : ''}${ui.esc(r.t)}</div>${sub || c.k !== 'other' ? `<div class="tsub">${c.k !== 'other' ? `<span class="cat">${ui.esc(c.label)}</span>` : ''}${sub}</div>` : ''}${ref}</div></li>`;
}
function groceryRow(r, ui, showStore) {
  return `<li class="tk gr ${r.done ? 'done' : ''}" data-id="${r.id}"><button class="tbox" aria-label="${r.done ? 'Put back' : 'In cart'}">${r.done ? ui.ico('check') : ''}</button>
    <div class="grow"><div class="name">${ui.esc(r.t)}${r.qty ? ` <span class="qty">×${ui.esc(r.qty)}</span>` : ''}</div></div>${showStore && r.store ? `<span class="stag">${ui.esc(P.storeLabel(r.store))}</span>` : ''}</li>`;
}
function section(key, title, rows, { count = rows.length, collapsible = false, extra = '', cls = '', hint = '' } = {}) {
  if (!count) return '';
  // A section the user opened or closed keeps that; otherwise collapsible ones start closed.
  const open = !collapsible || st.open.has(key);
  return `<section class="card tsec ${cls}" data-sec="${key}"><header class="${collapsible ? 'tog' : ''}"><h3>${title}</h3><span class="cnt">${count}</span>${extra}${collapsible ? `<span class="chev">${open ? '▾' : '▸'}</span>` : ''}</header>
    ${open ? `${hint ? `<p class="muted small shint">${hint}</p>` : ''}<ul class="list tlist">${rows.join('')}</ul>` : ''}</section>`;
}
const captureBar = (ui, mode) => `<div class="capture">
  <div class="cbar"><input id="capIn" autocomplete="off" enterkeyhint="done" placeholder="${mode === 'groceries' ? 'Add groceries' : 'Add a task or grocery'}">
  ${voice.speechSupported() ? `<button id="capMic" class="cmic" aria-label="Say it">${ui.ico('mic')}</button>` : ''}<button id="capGo" class="cgo" aria-label="Add">${ui.ico('add')}</button></div>
  <div id="capPrev" class="cprev"></div></div>`;

export async function view(s, ui) {
  await autoRestock();
  const items = await all(), t0 = today();
  const tasks = items.filter(r => r.kind !== 'grocery'), groc = items.filter(r => r.kind === 'grocery' && !r.gone);
  const openTasks = tasks.filter(r => !r.done && DATED.has(r.list || 'todo') && (!r.due || r.due <= addDays(t0, 7)));
  const left = groc.filter(r => !r.done).length;
  const seg = `<div class="seg tmode"><button data-m="tasks" class="${st.mode === 'tasks' ? 'on' : ''}">Tasks${openTasks.length ? ` · ${openTasks.length}` : ''}</button><button data-m="groceries" class="${st.mode === 'groceries' ? 'on' : ''}">Groceries${left ? ` · ${left}` : ''}</button></div>`;
  return seg + captureBar(ui, st.mode) + (st.mode === 'groceries' ? groceryView(items, s, ui) : taskView(tasks, ui, t0, s));
}

// Sections, top to bottom. The order can be changed (Settings saved in s.taskOrder); collapsed ones start closed.
export const SECTIONS = [
  ['top', '★ Top'], ['today', 'Today'], ['week', 'Coming up'], ['any', 'To do'], ['shop', 'Shopping'], ['ideas', 'Ideas'],
  ['watch', 'Watch & read'], ['later', 'Later'], ['recur', 'Repeating'], ['someday', 'Someday'], ['missed', 'Old dates'], ['ref', 'Reference'], ['done', 'Done this week'],
];
const COLLAPSED = new Set(['watch', 'later', 'recur', 'someday', 'missed', 'ref', 'done']);
const orderOf = s => { const o = (s.taskOrder || []).filter(k => SECTIONS.some(x => x[0] === k)); return [...o, ...SECTIONS.map(x => x[0]).filter(k => !o.includes(k))]; };
const DATED = new Set(['todo', 'shop', 'ideas']);
const MISSED_DAYS = 14;
// When a dated task counts as "showing": repeating ones only from a few days before they're due.
export const showsFrom = r => addDays(r.due, -P.leadDays(r));

function taskView(tasks, ui, t0, s) {
  const open = tasks.filter(r => !r.done);
  const home = r => r.list || 'todo';
  const top = open.filter(r => r.pri && DATED.has(home(r))).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  const rest = open.filter(r => !r.pri);
  const byDue = (a, b) => (a.due + (a.time || '99')).localeCompare(b.due + (b.time || '99'));
  const dated = rest.filter(r => r.due && DATED.has(home(r)));
  const missedCut = addDays(t0, -MISSED_DAYS);
  const missed = dated.filter(r => r.due < missedCut && !r.rep).sort(byDue);
  const tdy = dated.filter(r => r.due <= t0 && (r.due >= missedCut || r.rep)).sort(byDue);
  const wk = dated.filter(r => r.due > t0 && r.due <= addDays(t0, 7) && (!r.rep || showsFrom(r) <= t0)).sort(byDue);
  const recur = dated.filter(r => r.rep && r.due > t0 && !wk.includes(r)).sort(byDue);
  const later = dated.filter(r => !r.rep && r.due > addDays(t0, 7)).sort(byDue);
  const undated = l => rest.filter(r => !r.due && home(r) === l).sort((a, b) => (b.created || 0) - (a.created || 0));
  const anytime = undated('todo'), shop = undated('shop'), ideas = undated('ideas');
  const stale = anytime.filter(r => Date.now() - (r.created || r.u || 0) > STALE_DAYS * DAY);
  const someday = open.filter(r => r.list === 'someday'), watch = open.filter(r => r.list === 'watch'), refs = open.filter(r => r.list === 'ref').sort((a, b) => a.t.localeCompare(b.t));
  const doneWk = tasks.filter(r => r.done && Date.now() - r.done < 7 * DAY).sort((a, b) => b.done - a.done);
  const LIMIT = 8;
  const anyRows = (st.showAll ? anytime : anytime.slice(0, LIMIT)).map(r => taskRow(r, ui));
  if (!st.showAll && anytime.length > LIMIT) anyRows.push(`<li class="more" id="anyMore">Show ${anytime.length - LIMIT} more</li>`);
  const ai = ideas.filter(r => P.ideaGroup(r.t) === 'ai'), other = ideas.filter(r => P.ideaGroup(r.t) !== 'ai');
  const ideaRows = [...(ai.length ? [`<li class="tsubh">Claude & AI</li>`, ...ai.map(r => taskRow(r, ui))] : []), ...(other.length ? [ai.length ? `<li class="tsubh">Other ideas</li>` : '', ...other.map(r => taskRow(r, ui))] : [])].filter(Boolean);
  const overdue = tdy.filter(r => r.due < t0).length;
  const parts = {
    top: () => section('top', '★ Top', top.map(r => taskRow(r, ui)), { cls: 'topsec' }),
    today: () => section('today', 'Today', tdy.map(r => taskRow(r, ui)), { extra: overdue ? `<button class="link" id="allToday">Move ${overdue} late to today</button>` : '' }),
    week: () => section('week', 'Coming up', wk.map(r => taskRow(r, ui))),
    any: () => section('any', 'To do', anyRows, { count: anytime.length }),
    shop: () => section('shop', 'Shopping', shop.map(r => taskRow(r, ui))),
    ideas: () => section('ideas', 'Ideas', ideaRows, { count: ideas.length }),
    watch: () => section('watch', 'Watch & read', watch.map(r => taskRow(r, ui)), { collapsible: true }),
    later: () => section('later', 'Later', later.map(r => taskRow(r, ui)), { collapsible: true }),
    recur: () => section('recur', 'Repeating', recur.map(r => taskRow(r, ui)), { collapsible: true, hint: 'Shows up in Coming up a few days before it\'s due.' }),
    someday: () => section('someday', 'Someday', someday.map(r => taskRow(r, ui)), { collapsible: true }),
    missed: () => section('missed', 'Old dates', missed.map(r => taskRow(r, ui)), { collapsible: true, hint: `Dates that passed ${MISSED_DAYS}+ days ago. Tidy up sorts them one tap at a time.` }),
    ref: () => section('ref', 'Reference', refs.map(r => taskRow(r, ui)), { collapsible: true, cls: 'refsec' }),
    done: () => section('done', 'Done this week', doneWk.map(r => taskRow(r, ui)), { collapsible: true, cls: 'donesec' }),
  };
  const nTidy = stale.length + missed.length;
  const empty = !open.filter(r => r.list !== 'ref').length ? `<section class="card tempty"><h3>All clear</h3><p class="hint">Type or say anything above. Dates like "tmrw 5pm" or "every month on the 1st" get picked up, groceries go to their own list, "idea: …" goes to Ideas.</p></section>` : '';
  return empty
    + (nTidy >= 3 ? `<button class="tidy" id="tidy">${ui.ico('zap')}<span class="grow"><b>Tidy up ${nTidy} old items</b><span class="sub">Old dates and things sitting ${STALE_DAYS}+ days. One tap each.</span></span><span class="chev">›</span></button>` : '')
    + orderOf(s).map(k => parts[k]()).join('')
    + `<button class="link reorder" id="tReorder">${ui.ico('settings')}Reorder sections</button>`;
}

// Staples with a set rhythm and "add automatically" go back on the list by themselves when they're due.
async function autoRestock() {
  for (const r of await groceriesOf()) {
    const d = r.auto && r.gone ? P.dueIn(r) : null;
    if (d != null && d <= 0) { const upd = { ...r, gone: false, created: Date.now(), src: 'auto' }; delete upd.done; await db.put(FILE, upd); }
  }
}
const ago = ms => { const d = Math.round((Date.now() - ms) / DAY); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : `${Math.round(d / 7)} wks ago`; };
function usualRow(r, ui, due) {
  const c = P.cadence(r);
  const sub = [c ? P.rhythmText(c) + (r.every ? '' : ' (learned)') : `bought ${r.buys || 1}×`, r.last ? 'last ' + ago(r.last) : '', r.auto ? 'auto-adds' : ''].filter(Boolean).join(' · ');
  return `<li class="tk ur ${due != null && due <= 0 ? 'due' : ''}" data-id="${r.id}"><div class="grow"><div class="name">${ui.esc(r.t)}</div><div class="tsub">${ui.esc(sub)}</div></div><button class="uadd" data-us="${r.id}" aria-label="Add ${ui.esc(r.t)}">${ui.ico('add')}</button></li>`;
}

function groceryView(items, s, ui) {
  const groc = items.filter(r => r.kind === 'grocery');
  const list = groc.filter(r => !r.gone);
  const stores = ['giant', 'sams', 'walmart', 'aldi', ...new Set(list.map(r => r.store).filter(k => k && !['giant', 'sams', 'walmart', 'aldi'].includes(k)))];
  const inStore = r => st.store === 'all' || !r.store || r.store === st.store;
  const need = list.filter(r => !r.done && inStore(r)), cart = list.filter(r => r.done && inStore(r));
  const chips = `<div class="chips gstores wrap"><button data-st="all" class="${st.store === 'all' ? 'on' : ''}">All</button>${stores.map(k => {
    const n = list.filter(r => !r.done && r.store === k).length;
    return `<button data-st="${k}" class="${st.store === k ? 'on' : ''}">${P.storeLabel(k)}${n ? ` · ${n}` : ''}</button>`;
  }).join('')}</div>`;
  // Bought before and not on the list now: "Restock" when the rhythm says it's due, everything else under Usuals.
  const past = groc.filter(r => r.gone && (r.buys || (r.hist || []).length) && inStore(r)).map(r => ({ r, d: P.dueIn(r) }));
  // Due within 2 days, but not long forgotten (more than two rhythms late means you stopped buying it).
  const due = past.filter(x => x.d != null && x.d <= 2 && x.d >= -2 * P.cadence(x.r)).sort((a, b) => a.d - b.d);
  const usual = past.filter(x => !due.includes(x)).sort((a, b) => (a.d ?? 999) - (b.d ?? 999) || (b.r.buys || 0) - (a.r.buys || 0) || (b.r.last || 0) - (a.r.last || 0));
  const restock = due.length ? section('restock', 'Restock', due.map(x => usualRow(x.r, ui, x.d)), { cls: 'restock', extra: due.length > 1 ? `<button class="link" id="addDue">Add all</button>` : '' }) : '';
  const groups = P.AISLES.map(a => [a, need.filter(r => (a.k === (r.aisle || 'other'))).sort((x, y) => x.t.localeCompare(y.t))]).filter(([, rs]) => rs.length);
  const body = groups.map(([a, rs]) => section('a-' + a.k, a.label, rs.map(r => groceryRow(r, ui, st.store === 'all')), { cls: 'aisle' })).join('');
  const empty = !need.length && !cart.length ? `<section class="card tempty"><h3>${st.store === 'all' ? 'List is empty' : 'Nothing for ' + P.storeLabel(st.store)}</h3><p class="hint">Dump everything at once: "tofu, dumplings, water jug, soup aldi". Repeats merge, and items sort by aisle.</p></section>` : '';
  const cartSec = cart.length ? section('cart', 'In cart', cart.map(r => groceryRow(r, ui, false)), { cls: 'cart', extra: `<button class="link" id="doneShop">Done shopping</button>` }) : '';
  const usualSec = usual.length ? section('usuals', 'Usuals', usual.map(x => usualRow(x.r, ui, x.d)), { collapsible: true, cls: 'usualsec', hint: 'Tap + to add. Tap a name to set how often you buy it, and Baro\'s reminds you (or adds it for you) when it\'s due.' }) : '';
  return chips + restock + empty + body + cartSec + usualSec;
}

// ---------- interactions ----------
export function bind(root, s, ui) {
  const { $, $$ } = ui;
  $$('.tmode button', root).forEach(b => (b.onclick = () => { st.mode = b.dataset.m; local.set('tasksMode', st.mode); ui.render(); }));
  $$('.gstores button', root).forEach(b => (b.onclick = () => { st.store = b.dataset.st; local.set('groceryStore', st.store); ui.render(); }));
  $$('.tsec header.tog', root).forEach(h => (h.onclick = e => { if (e.target.closest('button')) return; const k = h.parentNode.dataset.sec; st.open.has(k) ? st.open.delete(k) : st.open.add(k); saveOpen(); ui.render(); }));
  $('#anyMore', root)?.addEventListener('click', () => { st.showAll = true; ui.render(); });
  $('#tidy', root)?.addEventListener('click', () => openTidy(s, ui));
  $('#allToday', root)?.addEventListener('click', async () => {
    const t0 = today(), over = (await tasksOf()).filter(r => !r.done && r.due && r.due < t0);
    for (const r of over) await db.put(FILE, { ...r, due: t0 });
    ui.toast(`${over.length} moved to today`); ui.render();
  });
  $('#doneShop', root)?.addEventListener('click', async () => {
    const cart = (await groceriesOf()).filter(r => !r.gone && r.done);
    const now = Date.now();
    for (const r of cart) await db.put(FILE, { ...r, gone: true, buys: (r.buys || 0) + 1, last: now, hist: [...(r.hist || []), now].slice(-24), qty: null });
    ui.toast(`${cart.length} item${cart.length === 1 ? '' : 's'} bought`, { action: 'Undo', onAction: async () => { for (const r of cart) await db.put(FILE, r); ui.render(); } });
    ui.render();
  });
  const revive = async id => { const r = await db.get(FILE, id); if (r) { const upd = { ...r, gone: false, created: Date.now() }; delete upd.done; await db.put(FILE, upd); } return r; };
  $$('[data-us]', root).forEach(b => (b.onclick = async e => { e.stopPropagation(); const r = await revive(b.dataset.us); if (r) ui.toast(`Added ${r.t}`); ui.render(); }));
  $('#addDue', root)?.addEventListener('click', async () => { const ids = $$('.restock [data-us]', root).map(b => b.dataset.us); for (const id of ids) await revive(id); ui.toast(`${ids.length} added`); ui.render(); });
  $('#tReorder', root)?.addEventListener('click', () => openReorder(s, ui));
  $$('li.tk', root).forEach(li => {
    const id = li.dataset.id;
    $('.tbox', li)?.addEventListener('click', e => { e.stopPropagation(); toggle(id, ui); });
    li.onclick = () => { if (!li._swiped) openEdit(id, s, ui); };
    ui.swipeToDelete(li, async () => {
      const r = await db.get(FILE, id);
      await db.remove(FILE, id);
      ui.toast(`Deleted "${r?.t || ''}"`, { action: 'Undo', onAction: async () => { if (r) { await db.put(FILE, r); ui.render(); } } });
      ui.render();
    });
  });
  bindCapture(root, s, ui);
}

async function toggle(id, ui) {
  const r = await db.get(FILE, id);
  if (!r) return;
  if (r.kind === 'grocery') { const upd = { ...r }; if (r.done) delete upd.done; else upd.done = Date.now(); await db.put(FILE, upd); return ui.render(); }
  if (!r.done && r.rep && r.due) {
    // Repeating: roll forward instead of finishing.
    const next = P.nextDue(r.due, r.rep, today());
    await db.put(FILE, { ...r, due: next, lastDone: Date.now(), streak: (r.streak || 0) + 1 });
    ui.toast(`Done · next ${fmtDue(next, r.time)}`, { action: 'Undo', onAction: async () => { await db.put(FILE, r); ui.render(); } });
    return ui.render();
  }
  const upd = { ...r };
  if (r.done) delete upd.done; else upd.done = Date.now();
  await db.put(FILE, upd);
  if (!r.done) ui.toast(`Done: ${r.t}`, { action: 'Undo', onAction: async () => { await db.put(FILE, r); ui.render(); } });
  ui.render();
}

// Live preview of what a capture will turn into, with a tap to switch an item's type.
// On the Groceries list every comma or line is a grocery; elsewhere each piece is sorted on its own.
// A brain dump split into several items gets a "Keep as one" link (`whole`), which keeps each line as one item.
async function parseCap(text, s, mode, overrides = {}, whole = false) {
  const base = mode === 'groceries'
    ? text.split(/\s*(?:,|;|\n)\s*/).map(t => t.trim()).filter(Boolean).map(t => ({ text: t, kind: 'grocery' }))
    : P.splitCapture(text, { ...(await ctx(s)), noSplit: whole });
  return base.map((it, i) => ({ ...it, kind: overrides[i] || it.kind }));
}
async function previewHtml(text, s, ui, overrides, mode, whole = false) {
  const items = await parseCap(text, s, mode, overrides, whole);
  if (!text.trim()) return { items: [], html: '' };
  const lines = text.split(/\n+/).filter(l => l.trim()).length;
  const toggle = mode === 'groceries' ? '' : whole ? `<button class="link pv-split" data-whole="0">Split it up</button>`
    : items.length > lines ? `<button class="link pv-split" data-whole="1">Keep as one item</button>` : '';
  const ICON = { task: 'check', grocery: 'cart', food: 'foods' }, LBL = { task: 'Task', grocery: 'Grocery', food: 'Food log' };
  const html = items.map((it, i) => {
    let detail = '';
    if (it.kind === 'task') { const pr = P.parsePri(it.text), w = P.parseWhen(pr.text.replace(P.REF_PREFIX, '').replace(P.IDEA_PREFIX, '')), c = P.catOf(P.categoryOf(w.title, s.catLearn)); const lst = P.REF_PREFIX.test(pr.text) ? 'Reference' : PV_LIST[P.listFor(it.text)]; detail = `${pr.pri ? '<span class="star">★</span>' : ''}${lst ? `<span class="muted">${lst} · </span>` : ''}${c.k !== 'other' ? `<span class="cdot" style="background:${c.color}"></span>` : ''}${ui.esc(w.title)}${w.due ? ` <span class="due">${ui.ico('cal')}${ui.esc(fmtDue(w.due, w.time))}</span>` : ''}${w.rep ? ` <span class="rep">${ui.ico('refresh')}${ui.esc(P.repText(w.rep))}</span>` : ''}`; }
    else if (it.kind === 'grocery') { const g = P.groceryBits(it.text); detail = `${ui.esc(g.name)}${g.qty ? ` ×${ui.esc(g.qty)}` : ''} <span class="muted">· ${ui.esc(P.AISLES.find(a => a.k === P.aisleOf(g.name, s.aisleLearn))?.label || '')}${g.store ? ' · ' + ui.esc(P.storeLabel(g.store)) : ''}</span>`; }
    else detail = `${ui.esc(it.text)} <span class="muted">· opens the food logger</span>`;
    return `<div class="pv-it"><button class="kind k-${it.kind}" data-i="${i}">${ui.ico(ICON[it.kind])}${LBL[it.kind]}</button><span class="grow">${detail}</span></div>`;
  }).join('') + (toggle ? `<div class="pv-tog">${items.length > 1 && !whole ? `<span class="muted small">Split into ${items.length}</span>` : ''}${toggle}</div>` : '');
  return { items, html };
}
const PV_LIST = { ideas: 'Idea', watch: 'Watch', shop: 'Shopping', someday: 'Someday' };
const NEXT_KIND = { task: 'grocery', grocery: 'food', food: 'task' };

function bindCapture(root, s, ui) {
  const { $, $$ } = ui;
  const inp = $('#capIn', root), prev = $('#capPrev', root);
  if (!inp) return;
  let overrides = {}, items = [], seq = 0, whole = false;
  const refresh = async () => {
    const my = ++seq;
    if (!inp.value.trim()) whole = false;
    const r = await previewHtml(inp.value, s, ui, overrides, st.mode, whole);
    if (my !== seq) return;
    items = r.items; prev.innerHTML = r.html;
    $$('.kind', prev).forEach(b => (b.onclick = () => { const i = +b.dataset.i; overrides[i] = NEXT_KIND[items[i].kind]; learn(items[i], overrides[i], s); refresh(); }));
    $$('.pv-split', prev).forEach(b => (b.onclick = () => { whole = b.dataset.whole === '1'; overrides = {}; refresh(); }));
  };
  const go = async () => {
    if (!inp.value.trim()) return inp.focus();
    await refresh();
    const text = inp.value; inp.value = ''; prev.innerHTML = ''; overrides = {}; whole = false;
    await capture(text, s, ui, { kinds: items });
    ui.render();
  };
  inp.oninput = refresh;
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
  $('#capGo', root).onclick = go;
  $('#capMic', root)?.addEventListener('click', () => openQuick(s, ui, { mode: st.mode }));
}

// Switching a preview item's type teaches the parser for next time ("tums" is a grocery, "Ghibli" is a task).
async function learn(it, kind, s) {
  if (kind === 'food') return;
  const k = P.core(P.groceryBits(it.text).name || it.text).join(' ');
  if (!k) return;
  s.tasksLearn = { ...(s.tasksLearn || {}), [k]: kind };
  await db.saveSettings(s);
}

// ---------- quick add sheet (mic first) ----------
// Opened by the mic button, the "Add task" home-screen shortcut, or on launch when Settings says so.
export function openQuick(s, ui, { mode = 'tasks', autostart = true } = {}) {
  const { $, $$ } = ui;
  const b = ui.sheet(`
    ${voice.speechSupported() ? '<button id="qMic" class="micbtn">🎤 Start talking</button>' : ''}
    <p class="hint" id="qHint">Say it all in one go: <b>"call dad tomorrow at 5, milk, eggs, dentist next friday"</b>. Tasks, groceries and food logs get sorted for you.</p>
    <textarea id="qT" rows="3" placeholder="…or type here, one thing per line or comma"></textarea>
    <div id="qPrev" class="cprev big"></div>
    <div class="actions"><button class="primary" id="qAdd" disabled>Add</button></div>`, { title: mode === 'groceries' ? 'Add groceries' : 'Quick add' });
  const ta = $('#qT', b), mic = $('#qMic', b), pv = $('#qPrev', b), add = $('#qAdd', b);
  let rec = null, items = [], overrides = {}, seq = 0, typingT, whole = false;
  const refresh = async () => {
    const my = ++seq;
    const r = await previewHtml(ta.value, s, ui, overrides, mode, whole);
    if (my !== seq) return;
    items = r.items; pv.innerHTML = r.html;
    add.disabled = !items.length;
    add.textContent = items.length ? `Add ${items.length} item${items.length === 1 ? '' : 's'}` : 'Add';
    $$('.kind', pv).forEach(k => (k.onclick = () => { const i = +k.dataset.i; overrides[i] = NEXT_KIND[items[i].kind]; learn(items[i], overrides[i], s); refresh(); }));
    $$('.pv-split', pv).forEach(b => (b.onclick = () => { whole = b.dataset.whole === '1'; overrides = {}; refresh(); }));
  };
  const setMic = on => { if (!mic) return; mic.textContent = on ? '■ Done' : '🎤 Start talking'; mic.classList.toggle('on', on); };
  const start = (auto = false) => {
    const before = ta.value.trim() ? ta.value.trim().replace(/[,\s]*$/, ', ') : '';
    setMic(true);
    rec = voice.listen({
      onText: t => { ta.value = before + t; clearTimeout(typingT); typingT = setTimeout(refresh, 250); },
      onEnd: (_, err) => { rec = null; setMic(false); if (err) ui.toast(auto ? 'Tap Start talking to begin' : 'Mic blocked: allow microphone access for this site'); refresh(); },
    });
  };
  if (mic) mic.onclick = () => (rec ? rec.stop() : start());
  ta.oninput = () => { clearTimeout(typingT); typingT = setTimeout(refresh, 300); };
  add.onclick = async () => {
    rec?.stop();
    await refresh();
    const its = items;
    ui.closeSheet();
    await capture(ta.value, s, ui, { kinds: its });
    ui.render();
  };
  $('.sheet-wrap')._cleanup = () => rec?.stop();
  if (autostart && mic) start(true); else setTimeout(() => ta.focus(), 50);
}

// ---------- edit ----------
const LEAD = [['', 'Auto'], [0, 'On the day'], [1, '1 day before'], [3, '3 days before'], [5, '5 days before'], [7, '1 week before'], [14, '2 weeks before'], [30, '1 month before']];
const REMIND = [[null, 'None'], [0, 'At the time'], [15, '15 min before'], [30, '30 min before'], [60, '1 hour before'], ['morning', 'Morning of (9 AM)'], [1440, '1 day before']];
async function openEdit(id, s, ui) {
  const r = await db.get(FILE, id);
  if (!r) return;
  return r.kind === 'grocery' ? editGrocery(r, s, ui) : editTask(r, s, ui);
}

function editTask(r, s, ui) {
  const { $, $$, esc } = ui;
  const t0 = today();
  const quick = [['Today', t0], ['Tomorrow', addDays(t0, 1)], ['Weekend', ymdNextSat()], ['Next week', P.parseWhen('next week').due], ['No date', '']];
  const b = ui.sheet(`<form id="te" class="form">
    <input name="t" class="tt" value="${esc(r.t)}" autocomplete="off">
    <div class="chips dq">${quick.map(([l, d]) => `<button type="button" data-d="${d}" class="${(r.due || '') === d ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="grid2"><label>Date<input name="due" type="date" value="${r.due || ''}"></label><label>Time<input name="time" type="time" value="${r.time || ''}"></label></div>
    <div class="grid2"><label>Repeat<select name="rep">${[['', 'Never'], ['1day', 'Daily'], ['1week', 'Weekly'], ['2week', 'Every 2 weeks'], ['1month', 'Monthly'], ['3month', 'Every 3 months'], ['1year', 'Yearly']].map(([v, l]) => `<option value="${v}" ${r.rep && `${r.rep.n}${r.rep.unit}` === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Reminder<select name="rm">${REMIND.map(([v, l]) => `<option value="${v ?? ''}" ${String(r.rm ?? '') === String(v ?? '') ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <label id="leadRow">Show it in my list<select name="lead">${LEAD.map(([v, l]) => `<option value="${v}" ${String(r.lead ?? '') === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select><span class="muted small">Repeating things stay tucked in "Repeating" until then. Auto: monthly ones 5 days ahead, yearly 3 weeks.</span></label>
    <div class="grid2"><label>Category<select name="cat">${P.CATS.map(c => `<option value="${c.k}" ${(r.cat || P.categoryOf(r.t)) === c.k ? 'selected' : ''}>${c.emoji} ${c.label}</option>`).join('')}</select></label>
    <label class="check pin"><input type="checkbox" name="pri" ${r.pri ? 'checked' : ''}> ★ Keep at top</label></div>
    <label>List<select name="list">${P.LISTS.map(([k, l]) => `<option value="${k}" ${(r.list || 'todo') === k ? 'selected' : ''}>${l}</option>`).join('')}<option value="grocery">Groceries (move)</option></select></label>
    <label>Notes<textarea name="note" rows="3" placeholder="Details, links, a checklist…">${esc(r.note || '')}</textarea></label>
    <div id="calRow"></div>
    <div class="actions"><button type="button" class="danger" id="tDel">Delete</button><button class="primary">Save</button></div>
  </form>`, { title: r.done ? 'Done task' : 'Task' });
  const f = $('#te', b);
  const calRow = () => {
    const due = f.due.value;
    $('#calRow', b).innerHTML = due ? `<a class="calbtn" target="_blank" rel="noopener" href="${esc(P.calendarLink({ t: f.t.value, due, time: f.time.value, note: f.note.value, rep: repOf(f.rep.value) }))}">${ui.ico('cal')}Add to Google Calendar</a><p class="muted small">Opens Google Calendar with this filled in, so its reminder pings your phone.</p>` : '';
  };
  $$('.dq button', b).forEach(x => (x.onclick = () => { f.due.value = x.dataset.d; if (!x.dataset.d) f.time.value = ''; $$('.dq button', b).forEach(y => y.classList.toggle('on', y === x)); calRow(); }));
  const leadRow = () => { $('#leadRow', b).hidden = !f.rep.value; };
  f.due.onchange = f.time.onchange = f.t.oninput = calRow;
  f.rep.onchange = () => { calRow(); leadRow(); };
  calRow(); leadRow();
  $('#tDel', b).onclick = async () => { await db.remove(FILE, r.id); ui.closeSheet(); ui.toast(`Deleted "${r.t}"`, { action: 'Undo', onAction: async () => { await db.put(FILE, r); ui.render(); } }); ui.render(); };
  f.onsubmit = async e => {
    e.preventDefault();
    const t = f.t.value.trim() || r.t;
    if (f.list.value === 'grocery') {
      await db.remove(FILE, r.id);
      await addGrocery(t, s);
      learn({ text: t }, 'grocery', s);
    } else {
      const rm = f.rm.value === '' ? null : f.rm.value === 'morning' ? 'morning' : +f.rm.value;
      const cat = f.cat.value;
      if (cat !== (r.cat || P.categoryOf(r.t))) { s.catLearn = { ...(s.catLearn || {}), [P.core(t).join(' ')]: cat }; await db.saveSettings(s); }
      await db.put(FILE, { ...r, t, cat, pri: f.pri.checked || undefined, due: f.due.value || null, time: f.due.value ? f.time.value || null : null, rep: f.due.value ? repOf(f.rep.value) : null, lead: f.lead.value === '' ? undefined : +f.lead.value, rm, list: f.list.value, note: f.note.value.trim() || undefined });
    }
    ui.closeSheet(); ui.render();
  };
}
const repOf = v => { const m = /^(\d+)(day|week|month|year)$/.exec(v || ''); return m ? { n: +m[1], unit: m[2] } : null; };
function ymdNextSat() { const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7)); return today(d); }

const EVERY = [['', 'Learn from my buys'], [7, 'Every week'], [14, 'Every 2 weeks'], [21, 'Every 3 weeks'], [30, 'Monthly'], [42, 'Every 6 weeks'], [60, 'Every 2 months'], [90, 'Every 3 months']];
function histText(r) {
  const h = (r.hist || []).slice().sort((a, b) => a - b), c = P.cadence(r), d = P.dueIn(r);
  const fmt = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (!h.length && !r.buys) return 'Not bought yet. After a couple of buys Baro\'s learns your rhythm.';
  const bits = [`Bought ${Math.max(r.buys || 0, h.length)}×${h.length ? ': ' + h.slice(-5).map(fmt).join(', ') : ''}.`];
  if (c) bits.push(`${r.every ? 'Set to' : 'Looks like'} ${P.rhythmText(c)}, so it's ${d <= 0 ? 'due now' : `due in ${d} day${d === 1 ? '' : 's'}`}.`);
  else bits.push('After 3 buys Baro\'s can guess the rhythm, or set it above.');
  return bits.join(' ');
}
function editGrocery(r, s, ui) {
  const { $, esc } = ui;
  const b = ui.sheet(`<form id="ge" class="form">
    <input name="t" class="tt" value="${esc(r.t)}" autocomplete="off">
    <div class="grid2"><label>How many<input name="qty" value="${esc(r.qty || '')}" placeholder="optional" inputmode="text"></label>
    <label>Store<select name="store"><option value="">Any store</option>${P.STORES.map(([k, l]) => `<option value="${k}" ${r.store === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <label>Aisle<select name="aisle">${P.AISLES.map(a => `<option value="${a.k}" ${(r.aisle || 'other') === a.k ? 'selected' : ''}>${a.label}</option>`).join('')}</select></label>
    <div class="grid2"><label>I buy it<select name="every">${EVERY.map(([v, l]) => `<option value="${v}" ${String(r.every || '') === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="check pin"><input type="checkbox" name="auto" ${r.auto ? 'checked' : ''}> Add it to my list when it's due</label></div>
    <p class="muted small">${histText(r)}</p>
    <div class="actions"><button type="button" id="gTask">It's a task</button><button type="button" class="danger" id="gDel">Delete</button><button class="primary">Save</button></div>
  </form>`, { title: 'Grocery' });
  const f = $('#ge', b);
  $('#gDel', b).onclick = async () => { await db.remove(FILE, r.id); ui.closeSheet(); ui.toast(`Deleted "${r.t}"`, { action: 'Undo', onAction: async () => { await db.put(FILE, r); ui.render(); } }); ui.render(); };
  $('#gTask', b).onclick = async () => {
    await db.remove(FILE, r.id);
    await db.put(FILE, { kind: 'task', t: f.t.value.trim() || r.t, list: 'todo', created: Date.now() });
    learn({ text: r.t }, 'task', s);
    ui.closeSheet(); ui.toast('Moved to Tasks'); ui.render();
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const aisle = f.aisle.value;
    if (aisle !== r.aisle) { s.aisleLearn = { ...(s.aisleLearn || {}), [P.core(f.t.value).join(' ')]: aisle }; await db.saveSettings(s); }
    await db.put(FILE, { ...r, t: f.t.value.trim() || r.t, qty: f.qty.value.trim() || null, store: f.store.value || null, aisle, every: +f.every.value || undefined, auto: (f.auto.checked && (+f.every.value || P.cadence(r))) ? true : undefined });
    ui.closeSheet(); ui.render();
  };
}

// ---------- tidy up: one old item at a time ----------
async function openTidy(s, ui) {
  const { $, $$, esc } = ui;
  const cut = addDays(today(), -MISSED_DAYS);
  const queue = (await tasksOf()).filter(r => !r.done && DATED.has(r.list || 'todo') && (
    (!r.due && (r.list || 'todo') === 'todo' && Date.now() - (r.created || r.u || 0) > STALE_DAYS * DAY) || (r.due && !r.rep && r.due < cut)))
    .sort((a, b) => (a.due || '0').localeCompare(b.due || '0') || (a.created || 0) - (b.created || 0));
  let i = 0, done = 0;
  const b = ui.sheet('<div id="tdy"></div>', { title: 'Tidy up' });
  const draw = () => {
    const r = queue[i];
    if (!r) { $('#tdy', b).innerHTML = `<p class="tdone">✨ ${done} sorted. Your list is clean.</p><div class="actions"><button class="primary" id="tClose">Close</button></div>`; $('#tClose', b).onclick = () => { ui.closeSheet(); ui.render(); }; return; }
    const age = Math.round((Date.now() - (r.created || r.u)) / DAY);
    $('#tdy', b).innerHTML = `<p class="muted small">${i + 1} of ${queue.length} · ${r.due ? `was due ${esc(fmtDue(r.due))}` : `added ${age} days ago`}</p>
      <div class="tcard">${esc(r.t)}</div>
      <div class="tgrid">
        <button data-a="today">${ui.ico('zap')}Do today</button><button data-a="week">${ui.ico('cal')}This week</button>
        <button data-a="someday">Someday</button>${r.due ? '<button data-a="nodate">Keep, no date</button>' : '<button data-a="watch">Watch & read</button>'}
        <button data-a="done">${ui.ico('check')}Already done</button><button data-a="del" class="danger">Delete</button>
      </div><button class="link" data-a="skip">Skip</button>`;
    $$('[data-a]', b).forEach(x => (x.onclick = async () => {
      const a = x.dataset.a, t0 = today();
      if (a === 'today') await db.put(FILE, { ...r, due: t0 });
      else if (a === 'week') await db.put(FILE, { ...r, due: P.parseWhen('friday').due });
      else if (a === 'nodate') await db.put(FILE, { ...r, due: null, time: null });
      else if (a === 'someday' || a === 'watch') await db.put(FILE, { ...r, list: a });
      else if (a === 'done') await db.put(FILE, { ...r, done: Date.now() });
      else if (a === 'del') await db.remove(FILE, r.id);
      if (a !== 'skip') done++;
      i++; draw();
    }));
  };
  draw();
}

// ---------- reorder sections ----------
function openReorder(s, ui) {
  const { $, $$ } = ui;
  let order = orderOf(s);
  const b = ui.sheet('<p class="hint">Move the sections you check most to the top. Sections with nothing in them stay hidden.</p><ul class="list reord" id="ro"></ul><div class="actions"><button type="button" id="roReset">Reset</button><button type="button" class="primary" id="roSave">Save</button></div>', { title: 'Reorder sections' });
  const name = k => SECTIONS.find(x => x[0] === k)[1];
  const draw = () => {
    $('#ro', b).innerHTML = order.map((k, i) => `<li data-k="${k}"><span class="grow">${ui.esc(name(k))}${COLLAPSED.has(k) ? ' <span class="muted small">· folded</span>' : ''}</span><button data-mv="-1" ${i ? '' : 'disabled'} aria-label="Up">↑</button><button data-mv="1" ${i < order.length - 1 ? '' : 'disabled'} aria-label="Down">↓</button></li>`).join('');
    $$('[data-mv]', b).forEach(x => (x.onclick = () => { const i = order.indexOf(x.closest('li').dataset.k), j = i + +x.dataset.mv; [order[i], order[j]] = [order[j], order[i]]; draw(); }));
  };
  draw();
  $('#roReset', b).onclick = () => { order = SECTIONS.map(x => x[0]); draw(); };
  $('#roSave', b).onclick = async () => { s.taskOrder = order; await db.saveSettings(s); ui.closeSheet(); ui.render(); };
}
