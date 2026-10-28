import * as db from './db.js';
import { today, monthOf, local } from './db.js';
import * as N from './nutrition.js';
import { r0, r1 } from './nutrition.js';
import * as food from './food.js';
import * as scan from './scan.js';
import * as sync from './sync.js';
import { goalsFor, recommend, measuredTdee, autoDayType, weekAdjust, withWeek } from './goals.js';
import { weekStart, daysBetween } from './training.js';
import { bars, line, ema, bindCharts } from './charts.js';
import * as voice from './voice.js';
import * as train from './trainview.js';
import * as lifts from './lifts.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const addDays = (d, k) => today(new Date(new Date(d + 'T12:00').getTime() + k * 864e5));
const nowTime = () => new Date().toTimeString().slice(0, 5);
const fmtDate = d => d === today() ? 'Today' : d === addDays(today(), -1) ? 'Yesterday' : new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const DT_ORDER = [null, 'rest']; // auto from exercise, or a plain base day

// Line icons (24px grid, stroke = currentColor) so the UI doesn't lean on emoji.
const ICONS = {
  today: '<path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H19"/>',
  trends: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  foods: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  prev: '<path d="m15 18-6-6 6-6"/>', back: '<path d="M19 12H5M12 19l-7-7 7-7"/>', next: '<path d="m9 18 6-6-6-6"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4"/>',
  plusc: '<circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M14 8v8M17 8v8"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  training: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  knee: '<path d="M12 2v8l-3 4v8M12 10l4 4v8"/><circle cx="12" cy="12" r="2.5"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  explore: '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36z"/>',
  youtube: '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 9 5 3-5 3z"/>',
  reddit: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  web: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  map: '<path d="m1 6 7-4 8 4 7-4v16l-7 4-8-4-7 4z"/><path d="M8 2v16M16 6v16"/>',
  nav: '<path d="m3 11 19-9-9 19-2-8z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
  locate: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/>',
};
const ico = k => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;

const state = { date: today(), today: today(), tab: local.get('tab', 'today'), s: null, sel: null };

// ---------- shell ----------
async function render() {
  state.s = await db.settings();
  local.set('tab', state.tab);
  if (state.tab === 'recipes') state.tab = 'foods';
  $$('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  const main = $('main');
  if (state.tab === 'recipes') state.tab = 'foods';
  const views = { today: viewToday, training: () => train.view(state.s, ui), trends: viewTrends, foods: viewFoods, explore: viewExplore, settings: viewSettings };
  main.innerHTML = await views[state.tab]();
  document.body.classList.toggle('today', state.tab === 'today');
  $('#datenav').innerHTML = state.tab === 'today' ? `<button id="prev" aria-label="Previous day">${ico('prev')}</button><button id="dateLbl">${ico('cal')}${fmtDate(state.date)}</button><button id="next" aria-label="Next day">${ico('next')}</button>` : '';
  if (state.tab === 'training') train.bind(main, state.s, ui);
  bind[state.tab]?.(main);
  $('#gear').classList.toggle('on', state.tab === 'settings');
  $('#trendsBtn').classList.toggle('on', state.tab === 'trends');
  syncBadge();
}
// Sync problems show in the header only (tap it for details) and retry on their own,
// so a failed save never pops up over what you're doing. Your entries stay on the phone meanwhile.
let syncErr = null, syncFails = 0;
function syncBadge(msg) {
  const el = $('#sync');
  if (!sync.configured()) { el.textContent = 'local only'; el.className = ''; return; }
  if (msg) { el.textContent = msg; el.className = ''; return; }
  if (syncErr) { el.textContent = 'not synced ⟳'; el.className = 'warn'; return; }
  const t = local.get('lastSync', 0);
  el.textContent = t ? '✓ ' + new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'not synced';
  el.className = '';
}
let syncTimer;
function scheduleSync(ms = 6000) { clearTimeout(syncTimer); syncTimer = setTimeout(runSync, ms); }
async function runSync() {
  if (!sync.configured()) return;
  syncBadge('syncing…');
  try { const r = await sync.sync(); syncErr = null; syncFails = 0; syncBadge(); if (r.pulled) render(); }
  catch (e) {
    syncErr = navigator.onLine === false ? 'Offline. Your entries are saved on this phone and sync when you\'re back online.' : e.message;
    syncBadge(); scheduleSync(Math.min(5 * 60e3, 15e3 * 2 ** syncFails++));
  }
}
$('#sync').onclick = () => { if (syncErr) toast(syncErr.length > 140 ? 'Sync failed; retrying now.' : syncErr); runSync(); };
// Small notice above the nav. With an action ("Undo") it stays a little longer and is tappable.
function toast(msg, { action, onAction } = {}) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show'); t.classList.toggle('act', !!action);
  if (action) {
    const btn = document.createElement('button'); btn.textContent = action;
    btn.onclick = () => { t.classList.remove('show'); onAction(); };
    t.append(btn);
  }
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), action ? 5000 : Math.min(5000, Math.max(2200, msg.length * 55)));
}
// Swipe a row left past a third of its width to delete it (red "Delete" shows underneath).
function swipeToDelete(li, onDelete) {
  let x0, y0, dx = 0, drag = null, bg = null;
  const reset = () => { li.style.transform = ''; bg?.remove(); bg = null; };
  li.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; drag = null; li.style.transition = 'none'; }, { passive: true });
  li.addEventListener('touchmove', e => {
    const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
    if (drag === null) { if (Math.abs(mx) < 10 && Math.abs(my) < 10) return; drag = mx < 0 && Math.abs(mx) > Math.abs(my) * 1.3; }
    if (!drag) return;
    if (!bg) { bg = document.createElement('div'); bg.className = 'swipebg'; bg.textContent = 'Delete'; Object.assign(bg.style, { top: li.offsetTop + 'px', height: li.offsetHeight + 'px' }); li.parentNode.append(bg); }
    dx = Math.min(0, mx); li.style.transform = `translateX(${dx}px)`;
    bg.classList.toggle('armed', -dx > li.offsetWidth / 3);
  }, { passive: true });
  li.addEventListener('touchend', () => {
    li.style.transition = '';
    if (!drag) return;
    li._swiped = true; setTimeout(() => (li._swiped = false), 400); // no tap-to-edit after a swipe
    if (-dx > li.offsetWidth / 3) { li.style.transform = 'translateX(-100%)'; setTimeout(onDelete, 160); } else reset();
  });
  li.addEventListener('touchcancel', () => { li.style.transition = ''; reset(); });
}

// Bottom sheet modal. Returns the sheet body element.
function sheet(html, { title = '', full = false } = {}) {
  closeSheet();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap' + (full ? ' full' : '');
  const x = full ? `<button class="x" aria-label="Back">${ico('back')}</button><h2>${esc(title)}</h2>` : `<h2>${esc(title)}</h2><button class="x" aria-label="Close">✕</button>`;
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(title)}"><header>${x}</header><div class="body">${html}</div></div>`;
  wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('.x')) closeSheet(); });
  document.body.append(wrap);
  history.pushState({ sheet: 1 }, '');
  return $('.body', wrap);
}
function closeSheet() {
  const w = $('.sheet-wrap'); if (!w) return;
  w._cleanup?.(); w.remove();
}
addEventListener('popstate', closeSheet);

// ---------- data helpers ----------
const logName = date => 'log/' + monthOf(date);
async function entriesFor(date) {
  return (await db.all(logName(date))).filter(e => e.date === date).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
}
// Garmin's day plus exercise you added by hand (basketball, anything not on the watch).
function withManual(gday, date, manual) {
  const mine = manual.filter(x => x.date === date).map(x => ({ ...x, manual: true, distance: (x.mi || 0) * 1609.34, type: x.run ? 'running' : x.lift ? 'strength_training' : 'other' }));
  return { ...(gday || {}), activities: [...(gday?.activities || []), ...mine] };
}
// base: skip the weekly budget (it is built from the base goals of the week's other days).
async function dayContext(date, base = false) {
  const [gday, dayRec, manual] = await Promise.all([sync.garminDay(date).catch(() => null), db.get('days', date), db.all('exercises')]);
  const g = withManual(gday, date, manual);
  const goals = goalsFor(state.s, g, dayRec?.dayType);
  const week = base ? null : await weekBudget(date, goals).catch(() => null);
  return { gday, g, dayRec, week, goals: withWeek(goals, week?.adj) };
}
// Where this week stands vs the goals so far, and what that moves today's goal by (goals.js weekAdjust).
async function weekBudget(date, goals) {
  if (state.s.weekBudget === false || date > today()) return null;
  const start = weekStart(date), prior = [], rest = [];
  for (let d = start; d < date; d = addDays(d, 1)) {
    const [es, ctx] = await Promise.all([entriesFor(d), dayContext(d, true)]);
    prior.push({ date: d, eaten: N.entryTotals(es, state.s.caloriesFromMacros).kcal, goal: ctx.goals.kcal });
  }
  const { kinds, raceDate } = await train.planKinds(state.s).catch(() => ({ kinds: {} }));
  const why = d => {
    const k = kinds[d], toRace = raceDate ? daysBetween(d, raceDate) : 99;
    if (toRace >= -1 && toRace <= 6) return 'race week';
    if (k === 'long') return 'long run day';
    if (k === 'quality') return 'workout day';
    if (kinds[addDays(d, -1)] === 'long') return 'day after the long run';
    if (d === date && goals.exKcal >= 600) return 'big training day';
    return '';
  };
  for (let d = date; d <= addDays(start, 6); d = addDays(d, 1)) rest.push({ date: d, protect: why(d) });
  return { ...weekAdjust(prior, rest, date), prior, start };
}
// Recents ranked by how often and how lately you ate them. One-offs drop off after a
// week, and anything you remove stays hidden until you log it again.
const recentKey = e => e.foodId || e.recipeId || 'n:' + e.name.toLowerCase();
async function recentFoods(limit = 30) {
  const hidden = new Set(state.s.hiddenRecents || []);
  const months = [0, -31, -62].map(k => monthOf(addDays(today(), k)));
  const cutoff = addDays(today(), -60), week = addDays(today(), -7);
  const stats = new Map();
  for (const m of new Set(months)) for (const e of await db.all('log/' + m)) {
    if (e.date < cutoff) continue;
    const k = recentKey(e), st = stats.get(k) || { uses: 0, last: '', e };
    st.uses++;
    if ((e.date + (e.time || '')) > st.last) { st.last = e.date + (e.time || ''); st.e = e; }
    stats.set(k, st);
  }
  const foods = new Map((await food.mine()).map(f => [f.id, f]));
  const recipes = new Map((await recipeFoods()).map(r => [r.recipeId, r]));
  return [...stats.entries()]
    .filter(([k, st]) => !hidden.has(k) && (st.uses >= 2 || st.last >= week || foods.get(k)?.fav))
    .sort((a, b) => (b[1].uses + (b[1].last >= week ? 3 : 0)) - (a[1].uses + (a[1].last >= week ? 3 : 0)) || b[1].last.localeCompare(a[1].last))
    .slice(0, limit)
    .map(([k, { e, uses }]) => ({ ...((e.foodId && foods.get(e.foodId)) || (e.recipeId && recipes.get(e.recipeId)) ||
      { name: e.name, brand: e.brand, n: e.n, units: [{ label: e.unit, mult: e.mult }], source: 'mine', srcLabel: 'Recent', _quick: true }), _key: k, _uses: uses }));
}
async function setHidden(keys, hide) {
  const h = new Set(state.s.hiddenRecents || []);
  keys.forEach(k => (hide ? h.add(k) : h.delete(k)));
  state.s.hiddenRecents = [...h];
  await db.saveSettings(state.s);
}

const tagLabel = t => (t === 'creami' ? 'Creami' : t === 'prep' ? 'Meal prep' : 'Recipe');
// Recipe nutrition per serving, resolved through nested recipes.
async function recipeFoods() {
  const recipes = await db.all('recipes'), foods = new Map((await db.all('foods')).map(f => [f.id, f]));
  const byId = new Map(recipes.map(r => [r.id, r]));
  const per = (r, depth = 0) => {
    const t = N.zero();
    for (const it of r.items || []) {
      let n = it.n;
      if (it.recipeId && byId.has(it.recipeId) && depth < 5) n = per(byId.get(it.recipeId), depth + 1);
      else if (it.foodId && foods.has(it.foodId)) n = foods.get(it.foodId).n;
      N.add(t, N.scale(n, it.qty * it.mult));
    }
    return N.scale(t, 1 / Math.max(1, +r.servings || 1));
  };
  return recipes.map(r => ({ id: r.id, recipeId: r.id, name: r.name, tag: r.tag, n: per(r), units: [{ label: r.servingLabel || 'serving', mult: 1 }], source: 'recipe', srcLabel: tagLabel(r.tag), recipe: r }));
}

function macroLine(n, s = state.s) {
  const c = s.netCarbs ? Math.max(0, (n.c || 0) - (n.fib || 0)) : n.c;
  return `<span class="macros">${s.netCarbs ? 'NC' : 'C'}: <b class="c">${r1(c)}</b>P: <b class="p">${r1(n.p)}</b>F: <b class="f">${r1(n.f)}</b></span>`;
}
const kcalOf = n => r0(N.countedKcal(n, state.s.caloriesFromMacros));
// What's left today in words, so going over reads "248 g over" instead of a minus sign.
function leftLine(rem) {
  const amt = (v, u) => `${r0(Math.abs(v))}${u} ${v < 0 ? 'over' : 'left'}`;
  return `<span class="leftline"><b class="${rem.kcal < 0 ? 'neg' : ''}">${amt(rem.kcal, ' kcal')}</b> · <span class="p">P ${amt(rem.p, ' g')}</span> · <span class="c">${state.s.netCarbs ? 'NC' : 'C'} ${amt(rem.c, ' g')}</span> · <span class="f">F ${amt(rem.f, ' g')}</span></span>`;
}
// Once you're out of calories, only lean protein still "fits" (60%+ of its calories from
// protein, 250 kcal or less), and only while protein is short, so suggestions never add carbs or fat.
const outOfKcal = rem => rem.kcal <= 50;
const isLean = (n, k) => k > 0 && k <= 250 && (n.p * 4) / k >= 0.6;
const fitsLeft = (n, k, rem) => outOfKcal(rem) ? rem.p >= 15 && isLean(n, k) : k <= rem.kcal + 40 && n.f <= Math.max(rem.f, 0) + 4;
const netC = t => Math.max(0, t.c - (t.fib || 0));
// "serving (1 pita (57g))" reads better as "1 pita (57g)" in tight rows.
const unitText = l => (/^serving \((.*)\)$/.exec(l || '')?.[1] || l || '').replace(/\d+\.\d{2,}/g, m => String(Math.round(m * 10) / 10));
// Macros-style two-line row: name + kcal, then brand/serving + C P F.
const row2 = (nameHtml, n, subHtml) => `<div class="r1"><span class="name">${nameHtml}</span><span class="kc">${kcalOf(n)}</span></div><div class="r2"><span class="sub">${subHtml}</span>${macroLine(n)}</div>`;
// "58 g", "1 package", "2 × 1 pita (57g)" — skip the "1 ×" Macros never shows.
const qtyText = (q, unit) => { const u = unitText(unit); return /^\d/.test(u) ? (r1(q) === 1 ? u : `${r1(q)} × ${u}`) : `${r1(q)} ${u}`; };
const kcalCol = n => `<div class="kcol"><div class="kc">${kcalOf(n)}</div><div class="kl">kcal</div></div>`;
function checkBadge(n) {
  const c = N.check(n);
  if (c.missingKcal) return `<span class="badge warn" title="No calories listed">no kcal listed</span>`;
  return c.ok ? '' : `<span class="badge warn" title="Label ${c.listed} kcal vs macros ${c.est} kcal">kcal ≠ macros ${Math.round(c.pct * 100)}%</span>`;
}
function foodRow(f, i, selState = null, amt = null) {
  const p = amt ? { n: N.scale(f.n, amt.qty * amt.unit.mult), label: qtyText(amt.qty, amt.unit.label) } : (x => ({ n: x.n, label: unitText(x.unit.label) }))(food.preview(f));
  // Your own foods need no source tag; a verified one gets a check like Macros does.
  const badge = f.source === 'mine' ? '' : `<span class="badge src-${f.source}">${esc(f.srcLabel || f.source)}</span> `;
  const tick = f.source === 'mine' && f.verified ? ' <span class="badge ok">✓</span>' : '';
  return `<li class="food ${selState || ''}" data-i="${i}">${selState != null ? '<span class="box"></span>' : ''}<div class="grow">${row2(`${f.fav ? '★ ' : ''}${esc(f.name)}${tick}`, p.n,
    `${badge}${checkBadge(f.n)}${[f.brand, p.label].filter(Boolean).map(esc).join(', ')}`)}</div></li>`;
}

// Latest log entry per food over the last ~3 months, keyed like recents.
async function lastUses() {
  const out = new Map();
  for (const m of new Set([0, -31, -62].map(k => monthOf(addDays(today(), k))))) for (const e of await db.all('log/' + m)) {
    const k = recentKey(e), o = out.get(k);
    if (!o || e.date + (e.time || '') > o.date + (o.time || '')) out.set(k, e);
  }
  return out;
}
const keysOf = f => [f.source === 'mine' && !f._quick ? f.id : null, f.recipeId, f._key, 'n:' + (f.name || '').toLowerCase()].filter(Boolean);
const lastOf = (f, uses) => keysOf(f).map(k => uses?.get(k)).find(Boolean);
// Servings you count rather than weigh (a bar, a pouch, 7 dumplings) start at 1 serving.
const COUNTED = /\b(bars?|wedges?|pieces?|pcs?|pouch(es)?|cans?|bottles?|eggs?|rolls?|cookies?|slices?|packets?|packs?|packages?|pkgs?|containers?|cartons?|scoops?|sandwich(es)?|knots?|bags?|dumplings?|tortillas?|wraps?|patt(y|ies)|links?|sticks?|cones?|buns?|bagels?|muffins?|bowls?|trays?|box(es)?|meals?|ea|each|pints?)\b/i;
// Amount a food starts at: what you logged last time (like Macros), else grams for anything
// you weigh, else one serving.
function startAmount(f, last) {
  const units = f.units?.length ? f.units : [{ label: 'serving', mult: 1 }];
  if (last) return { qty: last.qty, unit: units.find(u => u.label === last.unit) || { label: last.unit, mult: last.mult } };
  const sv = units.find(u => u.label.startsWith('serving')), g = units.find(u => u.label === 'g');
  if (g && !(sv && COUNTED.test(sv.label))) return { qty: sv ? r1(sv.mult * 100) : 100, unit: g };
  return { qty: 1, unit: sv || units[0] };
}
const defaultAmount = async f => startAmount(f, lastOf(f, await lastUses()));
async function logMany(rows, meal = 0) {
  for (const { f, qty, unit, mult } of rows)
    await db.put(logName(state.date), { date: state.date, time: nowTime(), meal, name: f.name, brand: f.brand,
      foodId: f.source === 'mine' && !f._quick ? f.id : undefined, recipeId: f.recipeId, qty, unit, mult, n: f.n });
  const keys = rows.map(r => recentKey({ foodId: r.f.source === 'mine' && !r.f._quick ? r.f.id : undefined, recipeId: r.f.recipeId, name: r.f.name }));
  if (keys.some(k => (state.s.hiddenRecents || []).includes(k))) await setHidden(keys, false);
  closeSheet(); render(); toast(`Logged ${rows.length} item${rows.length === 1 ? '' : 's'}`);
}

// ---------- Today ----------
async function viewToday() {
  const s = state.s, date = state.date;
  const [entries, ctx, weights] = await Promise.all([entriesFor(date), dayContext(date), db.all('weights')]);
  const { g, gday, goals } = ctx;
  const tot = N.entryTotals(entries, s.caloriesFromMacros);
  const carbs = s.netCarbs ? netC(tot) : tot.c;
  const left = goals.kcal - tot.kcal, pLeft = goals.p - tot.p;
  const showLeft = local.get('kcalView', 'eaten') === 'left';
  // Past the goal (with 8% slack) the bar stays full: goal part in color, the overshoot in red.
  const isOver = (have, goal) => have > goal * 1.08;
  const fill = (have, goal) => `<div class="track">${isOver(have, goal) ? `<div class="over" style="width:100%;--g:${((goal / have) * 100).toFixed(1)}%"></div>`
    : `<div style="width:${Math.min(100, (have / Math.max(1, goal)) * 100)}%"></div>`}</div>`;
  const col = (k, label, have, goal) => `<div class="mcol ${k}"><div class="lbl">${label}</div>${fill(have, goal)}${showLeft ? `<div class="num ${have > goal ? 'over' : ''}">${r0(goal - have)} left</div>` : `<div class="num ${isOver(have, goal) ? 'over' : ''}">${r0(have)} / ${r0(goal)} g</div>`}</div>`;
  const kbar = `<button class="kbar ${isOver(tot.kcal, goals.kcal) ? 'over' : ''}" id="kcalBtn" aria-label="Toggle eaten / remaining">${fill(tot.kcal, goals.kcal)}
    <div class="num">${showLeft ? `<b>${r0(left)}</b> kcal left` : `<b>${r0(tot.kcal)}</b> / ${r0(goals.kcal)} kcal`}</div></button>`;
  const w = weights.find(x => x.date === date)?.lb ?? gday?.weightLb;
  const wk = ctx.week, sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + r0(Math.abs(v));
  const weekLine = !wk?.logged ? '' : `<button class="weekline" id="weekBtn">${ico('cal')}<span>Week <b>${sgn(wk.balance)}</b> ${wk.small ? '· on track' : wk.balance > 0 ? 'over' : 'under'}${
    wk.adj ? ` · today <b>${sgn(wk.adj)}</b>` : wk.protect ? ` · not from today (${wk.protect})` : ''}</span>${ico('next')}</button>`;

  const single = s.meals.length === 1, sel = state.sel;
  // A meal prep that isn't logged yet gets a banner at the top of the list, so a short day is obvious;
  // once it's in, a quiet row below the list adds another portion.
  const prepList = await prepStatus(date), isToday = date === today();
  const prepNag = prepList.filter(x => x.missing).map(x => `<div class="prepnag"><div class="grow"><div class="t">${esc(x.name)} not logged ${isToday ? 'yet today' : 'this day'}</div>
      <div class="sub">+${kcalOf(x.n)} kcal · ${macroLine(x.n)}</div></div><button class="primary prepbtn" data-prep="${x.id}">Add</button><button class="iconbtn prepskip" data-prep="${x.id}" aria-label="Not ${isToday ? 'today' : 'this day'}">✕</button></div>`).join('');
  const preps = prepList.filter(x => !x.missing).map(x => `<button class="prepbtn" data-prep="${x.id}">${ico('plusc')}<span class="grow">${esc(x.name)}</span><span class="small">${
    [x.logged ? '✓ logged' : '', x.total > 1 ? (x.left > 0 ? `${x.left} of ${x.total} left` : 'all eaten') : '', `${kcalOf(x.n)} kcal`].filter(Boolean).join(' · ')}</span></button>`).join('');
  const byMeal = s.meals.map((m, mi) => {
    const list = entries.filter(e => single || (e.meal ?? 0) === mi);
    const t = N.entryTotals(list, s.caloriesFromMacros), tc = s.netCarbs ? netC(t) : t.c;
    // Stripe under the title shows this meal's calorie split, like Macros.
    const kc = { c: tc * 4, p: t.p * 4, f: t.f * 9 }, ks = kc.c + kc.p + kc.f;
    const stripe = `<div class="mstripe">${ks ? ['c', 'p', 'f'].map(k => `<div class="${k}" style="flex:${kc[k] / ks}"></div>`).join('') : '<div class="e"></div>'}</div>`;
    // With one running list the meal total is the day total, so show it against the goal.
    const mt = (k, v, goal, label) => `<div class="${k}"><b class="${single && isOver(v, goal) ? 'over' : ''}">${r0(v)}${single ? ' / ' + r0(goal) : ''}</b><span>${label}</span></div>`;
    return `<section class="card meal"><header><h3>${esc(single && /^food$/i.test(m) ? (date === today() ? 'Today meals' : 'Meals') : m)}</h3>
      ${list.length && !sel ? '<button class="link selBtn">Select</button>' : ''}</header>${stripe}
    ${sel || mi !== 0 ? '' : prepNag}
    <ul class="entries ${sel ? 'selecting' : ''}">${list.map(e => {
      const n = N.scale(e.n, e.qty * e.mult);
      return `<li data-id="${e.id}" class="${sel?.has(e.id) ? 'picked' : ''}">${sel ? '<span class="box"></span>' : ''}<div class="grow">${row2(esc(e.name), n, esc([e.brand, qtyText(e.qty, e.unit)].filter(Boolean).join(', ')))}</div></li>`;
    }).join('') || (single ? '<li class="empty small">Nothing logged yet. Tap Say it and list everything, e.g. "chicken 8.5 oz, milk 240 grams, 2 eggs".</li>' : '')}</ul>
    ${list.length ? `<div class="mtot">${mt('c', tc, goals.c, s.netCarbs ? 'Net carbs' : 'Carbs')}${mt('p', t.p, goals.p, 'Protein')}${mt('f', t.f, goals.f, 'Fat')}${mt('k', t.kcal, goals.kcal, 'Calories')}</div>` : ''}
    ${sel || mi !== 0 ? '' : preps}
    ${sel ? '' : `<div class="bigacts">${mi === 0 ? `<button class="voiceBtn">${ico('mic')}Say it</button>` : ''}<button class="addBig" data-meal="${mi}">${ico('plusc')}Add food</button></div>`}</section>`;
  }).join('');
  const selBar = sel ? `<div class="selbar"><span>${sel.size} selected</span><button id="selAll">All</button>
    <button id="selCopy">Copy to…</button>
    <button id="selDel" class="danger">Delete</button><button id="selDone" class="primary">Done</button></div>` : '';

  const acts = g.activities || [];
  const burned = acts.reduce((t, a) => t + (a.kcal || 0), 0);
  // Strength sessions get one line for the day's best lift (lifts.js).
  const best = new Map(await Promise.all(acts.filter(a => actKind(a) === 'strength').map(async a => [a.id, await lifts.forSession(a.id)])));
  const garmin = `<section class="card">
    <header><h3>Exercise</h3><span class="hkcal">${r0(burned)} kcal</span><button class="add" id="addEx" aria-label="Add exercise">${ico('plusc')}</button></header>
    ${gday ? `<div class="stats">
      ${stat('Steps', gday.steps?.toLocaleString(), '', 'steps')}${stat('Active kcal', gday.activeKcal && r0(gday.activeKcal), '', 'burn')}${stat('Sleep', gday.sleepSec ? r1(gday.sleepSec / 3600) + ' h' : null, gday.sleepScore ? 'score ' + gday.sleepScore : '', 'sleep')}
      ${stat('HRV', gday.hrv, gday.hrvStatus?.toLowerCase(), 'hrv')}${stat('Rest HR', gday.rhr, '', 'heart')}${stat('Readiness', gday.readiness, '', 'ready')}</div>` : `<p class="muted small">${sync.configured() ? 'No Garmin data for this day yet.' : 'Connect Garmin in Settings.'}</p>`}
    ${acts.length ? `<ul class="entries acts">${acts.map(a => `<li class="act ${actKind(a)}" ${a.manual ? `data-ex="${a.id}"` : ''}><span class="aicon">${ACT_ICON[actKind(a)]}</span><div class="grow"><div class="name">${esc(a.name)}</div><div class="qty">${[
      a.distance ? r1(a.distance / 1609.34) + ' mi' : '', a.duration ? Math.round(a.duration / 60) + ' min' : a.min ? a.min + ' min' : '',
      a.distance && a.duration ? pace(a.duration, a.distance) : '', a.avgHR ? a.avgHR + ' bpm' : '', a.manual ? 'manual' : ''].filter(Boolean).join(' · ')}</div>${best.has(a.id) ? lifts.rowLine(s, a, best.get(a.id), esc) : ''}</div><div class="kcol burn"><div class="kc">${r0(a.kcal)}</div><div class="kl">kcal</div></div></li>`).join('')}</ul>` : ''}</section>`;

  return `
  <section class="card summary">
    <div class="mcols" id="macroBtn" role="button" aria-label="Toggle eaten / remaining">${col('c', s.netCarbs ? 'Net carbs' : 'Carbs', carbs, goals.c)}${col('p', 'Protein', tot.p, goals.p)}${col('f', 'Fat', tot.f, goals.f)}</div>
    ${kbar}
    ${weekLine}
    ${date !== today() ? '' : left > 50 ? `<button class="fitbtn" id="fitBtn">${ico('zap')}What fits my ${r0(left)} kcal left?</button>`
      : pLeft >= 15 ? `<button class="fitbtn" id="fitBtn">${ico('zap')}Still ${r0(pLeft)} g protein short · lean picks</button>` : ''}
    <div class="sumfoot"><button class="chip" id="dayType" title="Tap to ignore or count exercise">${ico('pie')}${esc(goals.label)}${goals.auto ? '' : ' · set by you'}</button>
      <div class="goalline">Goal <b>${r0(goals.kcal)}</b>${goals.eatBack || goals.weekAdj ? ` <span class="small">(${[goals.eatBack ? `+${goals.eatBack} exercise` : '', goals.weekAdj ? `${sgn(goals.weekAdj)} week` : ''].filter(Boolean).join(', ')})</span>` : ''}</div></div>
  </section>
  ${byMeal}
  ${selBar}
  ${await train.todayCard(s, date, ui).catch(() => '')}
  ${garmin}
  <section class="card row"><h3>Weight</h3><input id="weight" type="number" inputmode="decimal" step="0.1" placeholder="lb" value="${w ?? ''}"><span class="muted small">${!weights.find(x => x.date === date) && gday?.weightLb ? 'from Garmin' : ''}</span></section>`;
}
const stat = (k, v, sub = '', cls = '', icon = '') => v == null || v === '' ? '' : `<div class="stat ${cls}"><div class="k">${icon ? icon + ' ' : ''}${k}</div><div class="v">${esc(v)}</div>${sub ? `<div class="k">${esc(sub)}</div>` : ''}</div>`;
const ACT_ICON = { run: '🏃', strength: '🏋️', ride: '🚴', walk: '🚶', swim: '🏊', other: '⚡' };
const actKind = a => { const t = a.type || ''; return /run|track/.test(t) ? 'run' : /strength|weight/.test(t) ? 'strength' : /cycl|bik|ride/.test(t) ? 'ride' : /walk|hik/.test(t) ? 'walk' : /swim/.test(t) ? 'swim' : 'other'; };
function pace(sec, m) { const p = sec / (m / 1609.34); return `${Math.floor(p / 60)}:${String(Math.round(p % 60)).padStart(2, '0')}/mi`; }

const bind = {};
bind.today = root => {
  $('#prev').onclick = () => { state.date = addDays(state.date, -1); state.sel = null; render(); };
  $('#next').onclick = () => { state.date = addDays(state.date, 1); state.sel = null; render(); };
  $('#dateLbl').onclick = () => { state.date = today(); render(); };
  $('#dayType', root).onclick = async () => {
    const cur = (await db.get('days', state.date))?.dayType ?? null;
    const next = DT_ORDER[(DT_ORDER.indexOf(cur) + 1) % DT_ORDER.length];
    await db.put('days', { id: state.date, dayType: next });
    render();
  };
  $$('.meal .addBig[data-meal]', root).forEach(b => (b.onclick = () => openAdd(+b.dataset.meal)));
  $('#fitBtn', root)?.addEventListener('click', () => openFits());
  $('#weekBtn', root)?.addEventListener('click', () => openWeek());
  // Tap the macros or the calorie bar to flip all four between eaten and left, like Macros.
  $$('#kcalBtn, #macroBtn', root).forEach(x => (x.onclick = () => { local.set('kcalView', local.get('kcalView', 'eaten') === 'left' ? 'eaten' : 'left'); render(); }));
  $$('.voiceBtn', root).forEach(b => (b.onclick = () => openVoice()));
  $$('.prepskip', root).forEach(b => (b.onclick = () => {
    const all = local.get('prepSkip', {}), keep = Object.fromEntries(Object.entries(all).filter(([d]) => d >= addDays(today(), -14)));
    keep[state.date] = [...(keep[state.date] || []), b.dataset.prep]; local.set('prepSkip', keep); render();
  }));
  $$('.prepbtn', root).forEach(b => (b.onclick = async () => {
    const f = (await recipeFoods()).find(x => x.id === b.dataset.prep); if (!f) return;
    await logEntry({ name: f.name, recipeId: f.recipeId, qty: 1, unit: f.units[0].label, mult: 1, n: f.n, meal: 0 });
  }));
  $$('.selBtn', root).forEach(b => (b.onclick = () => { state.sel = new Set(); render(); }));
  if (!state.sel) $$('.meal li[data-id]', root).forEach(li => swipeToDelete(li, async () => {
    const e = await db.get(logName(state.date), li.dataset.id); if (!e) return render();
    await db.remove(logName(e.date), e.id); render();
    toast(`Deleted ${e.name}`, { action: 'Undo', onAction: async () => { await db.put(logName(e.date), { ...e }); render(); } });
  }));
  $$('.meal li[data-id]', root).forEach(li => (li.onclick = async () => {
    if (li._swiped) return;
    if (state.sel) { state.sel.has(li.dataset.id) ? state.sel.delete(li.dataset.id) : state.sel.add(li.dataset.id); return render(); }
    const e = await db.get(logName(state.date), li.dataset.id);
    openPortion({ name: e.name, brand: e.brand, n: e.n, units: [{ label: e.unit, mult: e.mult }], id: e.foodId, recipeId: e.recipeId, source: 'mine' }, { entry: e });
  }));
  if (state.sel) {
    const picked = async () => (await entriesFor(state.date)).filter(e => state.sel.has(e.id));
    $('#selDone', root).onclick = () => { state.sel = null; render(); };
    $('#selAll', root).onclick = async () => { (await entriesFor(state.date)).forEach(e => state.sel.add(e.id)); render(); };
    $('#selDel', root).onclick = async () => {
      const list = await picked(); if (!list.length) return;
      if (!confirm(`Delete ${list.length} entr${list.length === 1 ? 'y' : 'ies'}?`)) return;
      for (const e of list) await db.remove(logName(e.date), e.id);
      state.sel = null; render(); toast(`Deleted ${list.length}`);
    };
    const copyTo = async date => {
      const list = await picked();
      for (const { id, u, ...e } of list) await db.put(logName(date), { ...e, date, time: nowTime() });
      state.sel = null; toast(`Copied ${list.length} to ${fmtDate(date)}`); render();
    };
    $('#selCopy', root).onclick = () => {
      if (!state.sel.size) return toast('Select entries first');
      const t = today(), opts = [[addDays(t, -1), 'Yesterday'], [t, 'Today'], [addDays(t, 1), 'Tomorrow']];
      const b = sheet(`<p class="hint">Copy ${state.sel.size} entr${state.sel.size === 1 ? 'y' : 'ies'} to:</p>
        <div class="daypick">${opts.map(([d, l]) => `<button data-d="${d}" class="${d === state.date ? '' : 'primary'}">${l}<small>${fmtDate(d) === l ? new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : fmtDate(d)}</small></button>`).join('')}</div>
        <label>Or pick a date<input type="date" id="cdate" value="${addDays(state.date, 1)}"></label>
        <div class="actions"><button class="primary" id="cgo">Copy to that date</button></div>`, { title: 'Copy entries' });
      $$('.daypick button', b).forEach(x => (x.onclick = () => { closeSheet(); copyTo(x.dataset.d); }));
      $('#cgo', b).onclick = () => { const d = $('#cdate', b).value; if (d) { closeSheet(); copyTo(d); } };
    };
  }
  const tc = $('#trainCard', root); if (tc) tc.onclick = () => { state.tab = 'training'; render(); };
  $('#addEx', root).onclick = () => openExercise();
  $$('li[data-ex]', root).forEach(li => (li.onclick = () => openExercise(li.dataset.ex)));
  $$('.bestlift', root).forEach(x => (x.onclick = async ev => {
    ev.stopPropagation();
    const a = (await dayContext(state.date, true)).g.activities.find(a => String(a.id) === x.dataset.lift);
    if (a) lifts.open(state.s, a, state.date, ui);
  }));
  $('#weight', root).onchange = async e => {
    const v = parseFloat(e.target.value);
    if (v > 0) {
      await db.put('weights', { id: state.date, date: state.date, lb: v });
      if (state.date === today()) await db.saveSettings({ ...state.s, profile: { ...state.s.profile, weightLb: v } });
      toast('Weight saved');
    } else await db.remove('weights', state.date);
  };
};

function openExercise(id) {
  (async () => {
    const x = id ? await db.get('exercises', id) : { name: 'Run', run: true };
    const b = sheet(`<form id="ex" class="form">
      <label>Name<input name="name" value="${esc(x.name)}" required></label>
      <label class="check"><input type="checkbox" name="run" ${x.run ? 'checked' : ''}> Counts as a run</label>
      <label class="check"><input type="checkbox" name="lift" ${x.lift ? 'checked' : ''}> Lifting (no watch session)</label>
      <div class="grid3"><label>Miles<input name="mi" type="number" min="0" step="0.01" inputmode="decimal" value="${x.mi ?? ''}"></label>
      <label>Minutes<input name="min" type="number" min="0" inputmode="numeric" value="${x.min ?? ''}"></label>
      <label>kcal<input name="kcal" type="number" min="0" inputmode="numeric" value="${x.kcal ?? ''}"></label></div>
      <p class="muted small">Garmin activities show up on their own after the nightly sync; use this for anything not on your watch.</p>
      <div class="actions">${id ? '<button type="button" class="danger" id="del">Delete</button>' : ''}<button class="primary">Save</button></div></form>`, { title: id ? 'Edit exercise' : 'Add exercise' });
    const run = $('[name=run]', b), lift = $('[name=lift]', b);
    run.onchange = () => { if (run.checked) lift.checked = false; };
    lift.onchange = () => { if (lift.checked) { run.checked = false; if (/^run$/i.test($('[name=name]', b).value)) $('[name=name]', b).value = 'Lifting'; } };
    $('#ex', b).onsubmit = async ev => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      await db.put('exercises', { ...x, date: x.date || state.date, name: f.get('name'), run: f.get('run') === 'on', lift: f.get('run') !== 'on' && f.get('lift') === 'on', mi: Math.max(0, +f.get('mi') || 0), min: Math.max(0, +f.get('min') || 0), kcal: Math.max(0, +f.get('kcal') || 0) });
      closeSheet(); render();
    };
    if (id) $('#del', b).onclick = async () => { await db.remove('exercises', id); closeSheet(); render(); };
  })();
}

// ---------- Add food ----------
// Full-screen search, laid out like Macros: search bar with scan, then My foods / My recipes / Library tabs.
function openAdd(meal, { pick, query } = {}) {
  const tab0 = local.get('addTab', 'mine') === 'library' ? 'mine' : local.get('addTab', 'mine');
  const b = sheet(`
    <div class="sbar">
      <div class="searchbar"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="q" type="search" placeholder="Search" autocomplete="off" enterkeyhint="search"><button id="qx" class="iconbtn" aria-label="Clear" hidden>✕</button><button id="scanBtn" class="iconbtn" aria-label="Scan barcode">${ico('scan')}</button></div>
      <div class="tabs" role="tablist">${[['mine', 'My foods'], ['recipes', 'My recipes'], ['library', 'Library']].map(([k, l]) => `<button role="tab" data-t="${k}" class="${k === tab0 ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>
    <div class="tools quick">
      ${pick ? '' : `<button id="voiceBtn">${ico('mic')}Say it</button>`}<button id="labelBtn">${ico('camera')}Label</button>
      ${pick ? '' : `<button id="quickBtn">${ico('zap')}Quick</button>`}<button id="newBtn">${ico('add')}New food</button>
    </div>
    <div id="results"><p class="muted">Loading…</p></div>`, { title: pick ? 'Pick ingredient' : state.s.meals.length > 1 ? `Add to ${state.s.meals[meal] || 'diary'}` : 'Search', full: true });
  const q = $('#q', b), out = $('#results', b);
  let tab = tab0, list = [], lastSections = [];
  let editing = null; // Set of list indexes while cleaning up recents
  let data = null, libQ = '', libRes = null, libSeq = 0, libMore = false;
  // Ticked foods, kept while you search for the next one; "Add N" logs them all at their usual amounts.
  const sel = new Map(), selKey = f => keysOf(f)[0] + '|' + (f.srcId || '');
  const words = () => food.tokens(q.value).filter(w => !food.STOP.has(w));
  // Word starts with typo tolerance ("drizzalicious"), plus plain substrings for longer words ("berry" in strawberry).
  const hit = f => { const hay = food.tokens(`${f.name} ${f.brand || ''}`), t = hay.join(' '); return words().every(w => food.wordHit(w, hay) || (w.length >= 4 && t.includes(w))); };
  const header = b.closest('.sheet').querySelector('header');
  if (!pick) header.insertAdjacentHTML('beforeend', '<button id="addN" class="addn" hidden>Add <b>0</b></button>');
  const addN = $('#addN', header);
  const updSel = () => { if (!addN) return; addN.hidden = !sel.size; $('b', addN).textContent = sel.size; };
  const show = (sections, extra = '') => {
    list = [];
    out.innerHTML = sections.filter(s => s.items.length || s.letters).map(s => {
      const open = !s.fold || local.get('fold:' + s.fold, true);
      let letter = '';
      const rows = s.items.map(f => {
        const i = list.push(f) - 1, L = (f.name[0] || '#').toUpperCase();
        const head = s.letters && L !== letter ? `<li class="letter">${esc((letter = L))}</li>` : '';
        const mark = s.editable && editing ? (editing.has(i) ? 'picked' : '') : pick ? null : sel.has(selKey(f)) ? 'picked' : '';
        return head + foodRow(f, i, mark, startAmount(f, lastOf(f, data.uses)));
      }).join('');
      return `<h4 ${s.fold ? `class="fold" data-fold="${s.fold}"` : ''}><span>${s.title}</span><span>${s.editable && open ? `<button class="link" id="editRecents">${editing ? 'Cancel' : 'Clean up'}</button>` : ''}${s.fold ? `<span class="caret ${open ? 'up' : ''}">${ico('next')}</span>` : ''}</span></h4>
      ${open ? `<ul class="list ${s.editable && editing ? 'selecting' : ''}">${rows || '<li class="empty small">Nothing here yet.</li>'}</ul>` : ''}
      ${open && s.editable && editing ? `<div class="actions"><button class="danger" id="hideRecents">Remove ${editing.size || ''} from recents</button></div>` : ''}`;
    }).join('') + extra || '<p class="muted pad">Nothing found. Try the Library tab, snap the label, or make a new food.</p>';
    $$('li.food', out).forEach(li => (li.onclick = e => {
      const i = +li.dataset.i, f = list[i];
      if (editing && f._key) { editing.has(i) ? editing.delete(i) : editing.add(i); return show(lastSections, extra); }
      if (!pick && !editing && e.target.closest('.box')) {
        const k = selKey(f);
        if (sel.has(k)) sel.delete(k); else sel.set(k, { f, amt: startAmount(f, lastOf(f, data.uses)) });
        $$('li.food', out).forEach(x => list[+x.dataset.i] && selKey(list[+x.dataset.i]) === k && x.classList.toggle('picked', sel.has(k)));
        return updSel();
      }
      choose(f);
    }));
    $$('h4.fold', out).forEach(h => (h.onclick = e => { if (e.target.closest('#editRecents')) return; const k = 'fold:' + h.dataset.fold; local.set(k, !local.get(k, true)); draw(); }));
    const er = $('#editRecents', out);
    if (er) er.onclick = () => { editing = editing ? null : new Set(); show(lastSections, extra); };
    const hr = $('#hideRecents', out);
    if (hr) hr.onclick = async () => {
      const keys = [...editing].map(i => list[i]._key).filter(Boolean);
      if (!keys.length) return;
      await setHidden(keys, true);
      editing = null; toast(`Removed ${keys.length} from recents`);
      data.recent = data.recent.filter(f => !keys.includes(f._key));
      draw();
    };
    $('#toLib', out)?.addEventListener('click', () => setTab('library'));
    lastSections = sections;
  };
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const draw = () => {
    if (!data) return;
    const typed = words().length > 0;
    $('#qx', b).hidden = !typed;
    if (tab === 'mine') {
      const recent = data.recent.filter(hit), recentIds = new Set(recent.map(f => f.id).filter(Boolean));
      const mine = data.pantry.filter(f => hit(f) && !(typed && recentIds.has(f.id))).sort(byName);
      show([{ title: 'Recent foods', items: recent, editable: !typed, fold: 'recent' }, { title: 'My foods', items: mine, letters: true }],
        typed ? `<div class="pad"><button class="wide" id="toLib">Search the library for “${esc(q.value.trim())}”</button></div>` : '');
    } else if (tab === 'recipes') {
      show([{ title: 'My recipes', items: data.recipes.filter(hit).sort(byName), letters: true }]);
    } else {
      if (!typed) { out.innerHTML = '<p class="muted pad">Type a food or brand to search USDA and Open Food Facts.</p>'; return; }
      if (libQ !== q.value.trim()) return runLib();
      if (!libRes) { out.innerHTML = '<p class="muted pad">Searching…</p>'; return; }
      show([{ title: 'Library', items: libRes }], libMore ? '<p class="muted small pad">Checking Open Food Facts too…</p>'
        : libRes.length ? '' : '<p class="muted pad">No library matches. Try fewer words, scan the barcode, or snap the label.</p>');
      if (food.usdaThrottled && !local.get('usdaKey')) out.insertAdjacentHTML('afterbegin', '<p class="warn small">USDA demo key is rate-limited. Add your free key in Settings for more branded results.</p>');
    }
  };
  const runLib = async () => {
    const v = q.value.trim(); if (v.length < 2) return;
    const my = ++libSeq; libQ = v; libRes = null; libMore = true; draw();
    // Foods on the phone show right away; Open Food Facts results slot in when they arrive.
    const res = await food.search(v, { onLocal: r => { if (my === libSeq) { libRes = r.remote; draw(); } } }).catch(() => ({ remote: libRes || [] }));
    if (my !== libSeq) return;
    libRes = res.remote; libMore = false; draw();
  };
  const setTab = t => {
    tab = t; editing = null;
    if (t !== 'library') local.set('addTab', t);
    $$('.tabs button', b).forEach(x => x.classList.toggle('on', x.dataset.t === t));
    draw();
  };
  $$('.tabs button', b).forEach(x => (x.onclick = () => setTab(x.dataset.t)));
  const choose = f => (pick ? openPortion(f, { pick }) : openPortion(f, { meal }));
  (async () => {
    const [recent, pantry, recipes, uses] = await Promise.all([recentFoods(), food.mine(), recipeFoods(), lastUses()]);
    data = { recent, pantry, recipes, uses };
    // Opened with words already typed (a voice item it couldn't match): straight to the Library unless one of yours fits.
    if (query) { q.value = query; [...recent, ...pantry].some(hit) ? draw() : setTab('library'); }
    else draw();
  })();
  if (addN) addN.onclick = () => logMany([...sel.values()].map(({ f, amt }) => ({ f, qty: amt.qty, unit: amt.unit.label, mult: amt.unit.mult })), meal);
  let t;
  q.oninput = () => { editing = null; if (tab === 'library') { clearTimeout(t); t = setTimeout(draw, 650); } else draw(); };
  q.onkeydown = e => {
    if (e.key !== 'Enter') return;
    clearTimeout(t);
    if (tab !== 'library' && !list.length) setTab('library'); else draw();
    q.blur();
  };
  $('#qx', b).onclick = () => { q.value = ''; draw(); q.focus(); };
  q.focus(); // keyboard up right away, like Macros
  $('#scanBtn', b).onclick = () => openScanner(meal, pick);
  $('#labelBtn', b).onclick = () => openLabel({ meal, pick });
  $('#newBtn', b).onclick = () => openFoodEditor(null, { meal, pick });
  if (!pick) { $('#quickBtn', b).onclick = () => openQuick(meal); $('#voiceBtn', b).onclick = () => openVoice(); }
}

// The week so far: each logged day vs its goal, and how the rest of the week is adjusted.
async function openWeek() {
  const { week: wk, goals } = await dayContext(state.date);
  if (!wk) return;
  const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + r0(Math.abs(v));
  const day = d => new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const rows = wk.prior.map(d => {
    const counted = d.eaten >= d.goal * 0.5, diff = d.eaten - d.goal;
    return `<li><div class="grow"><div class="name">${day(d.date)}</div><div class="sub">${counted ? `${r0(d.eaten)} / ${r0(d.goal)} kcal` : d.eaten ? 'Not counted: under half logged' : 'Not logged'}</div></div>
      ${counted ? `<b class="wdiff ${diff > 0 ? 'over' : 'under'}">${sgn(diff)}</b>` : ''}</li>`;
  }).join('');
  const now = wk.small ? `That's within 300 kcal, which is tracking noise, so today's goal is unchanged.`
    : wk.adj < 0 ? `Today's goal is ${r0(-wk.adj)} kcal lower (taken from fat and carbs, never protein) to even it out over the days left.`
    : wk.adj > 0 ? `Today's goal is ${r0(wk.adj)} kcal higher, mostly carbs, to use what you saved.`
    : wk.protect ? `Nothing comes off today because it's a ${wk.protect}. Fuel it fully.` : 'No days left this week to spread it over, so it\'s let go.';
  sheet(`<p class="wsum">This week (from ${day(wk.start)}): <b>${sgn(wk.balance)} kcal</b> ${wk.balance >= 0 ? 'over' : 'under'} your goals so far. ${now}</p>
    <ul class="entries card weekdays">${rows || '<li class="empty small">Today is the first day of the week.</li>'}</ul>
    <p class="hint">Today's goal: <b>${r0(goals.kcal)}</b> kcal · ${macroLine({ c: r0(goals.c), p: r0(goals.p), f: r0(goals.f) })}</p>
    <p class="muted small">How it works: the week runs Monday to Sunday and starts clean every Monday. Gaps under 300 kcal are ignored. Bigger ones are spread over the days left, at most 250 kcal a day. Overs are never taken from a long run, workout, day after a long run, or race week. Anything left on Sunday is let go. Turn it off in Settings → Daily goals.</p>`, { title: 'Weekly budget' });
}

// Suggest your own foods and recipes that fit what's left today, protein first.
async function openFits() {
  const s = state.s, [entries, ctx] = await Promise.all([entriesFor(state.date), dayContext(state.date)]);
  const tot = N.entryTotals(entries, s.caloriesFromMacros), goals = ctx.goals;
  const rem = { kcal: goals.kcal - tot.kcal, p: goals.p - tot.p, c: goals.c - (s.netCarbs ? netC(tot) : tot.c), f: goals.f - tot.f };
  const lean = outOfKcal(rem);
  const [recent, pantry, recipes] = await Promise.all([recentFoods(300), food.mine(), recipeFoods()]);
  const seen = new Set(), cands = [];
  for (const f of [...pantry, ...recipes, ...recent]) { const k = f.id || f._key || f.name; if (!seen.has(k)) { seen.add(k); cands.push(f); } }
  const picks = [];
  for (const f of cands) {
    const pv = food.preview(f), one = pv.n, k1 = N.countedKcal(one, s.caloriesFromMacros);
    if (!(k1 > 0)) continue;
    let best = null;
    // One serving, or 2 of small things (egg whites, tuna) so a suggestion is a real portion.
    for (const q of k1 < 150 ? [1, 2] : [0.5, 1]) {
      const n = N.scale(one, q), k = k1 * q;
      if (lean) {
        // Over on calories: lean protein only, sized to the protein still missing.
        if (rem.p < 15 || !isLean(n, k) || n.p > rem.p + 15) continue;
        const score = (Math.min(n.p, rem.p) / rem.p) * 2 + (n.p * 4) / k - (q === 1 ? 0 : 0.1);
        if (!best || score > best.score) best = { f, q, n, k, score, unit: pv.unit };
        continue;
      }
      if (k > rem.kcal + 40 || n.f > Math.max(rem.f, 0) + 4 || (s.netCarbs ? netC(n) : n.c) > Math.max(rem.c, 0) + 8) continue;
      // Reward filling protein and using the calories; penalize going over any macro.
      // Aim at a meal-sized chunk (≤700 kcal, ≤50 g protein) so a big budget doesn't just suggest doubles.
      const tk = Math.min(rem.kcal, 700), tp = Math.min(rem.p, 50);
      const pFill = tp > 5 ? Math.min(n.p, tp) / tp : 0, kFill = (Math.min(k, tk) - Math.max(0, k - tk)) / tk;
      const score = pFill * 2 + kFill + (n.p * 4) / k - (q === 1 ? 0 : 0.1);
      if (!best || score > best.score) best = { f, q, n, k, score, unit: pv.unit };
    }
    if (best) picks.push(best);
  }
  picks.sort((a, b) => b.score - a.score);
  const top = picks.slice(0, 15);
  const b = sheet(`<p class="hint">Today: ${leftLine(rem)}</p>
    ${lean ? `<p class="hint">${rem.p >= 15 ? "You're out of calories, so these are lean protein only (mostly protein, almost no carbs or fat). Skip them if you're not hungry." : 'Calories and protein are both covered today. Nothing to add.'}</p>` : ''}
    ${lean && rem.p < 15 ? '' : top.length ? `<ul class="list">${top.map((x, i) => `<li class="food" data-i="${i}"><div class="grow">${row2(esc(x.f.name), x.n, esc(`${x.q === 1 ? '' : x.q + ' × '}${unitText(x.unit.label)}${x.f.brand ? ', ' + x.f.brand : ''}`))}</div></li>`).join('')}</ul>`
      : '<p class="muted">Nothing in your foods fits what\'s left. A protein shake or egg whites usually does.</p>'}
    ${lean ? '' : `<p class="muted small" style="margin-top:12px">Ranked by how much protein it covers and how well it uses your calories without going over. Tap one to log it.</p>`}`, { title: lean ? 'Lean protein' : 'What fits' });
  $$('li.food', b).forEach(li => (li.onclick = () => { const x = top[+li.dataset.i]; openPortion(x.f, { meal: 0, qty: x.q }); }));
}

// Meal preps for a day: portions left since the prep's week started, whether one is logged on
// that day, and whether to flag it (a prep still in use: started this week or eaten in the last
// few days, with portions left, and not waved off for that day).
async function prepStatus(date = today()) {
  const preps = (await recipeFoods()).filter(r => r.tag === 'prep');
  if (!preps.length) return [];
  const logs = (await Promise.all([...new Set([monthOf(date), monthOf(addDays(date, -10)), monthOf(today())])].map(m => db.all('log/' + m)))).flat();
  const skipped = local.get('prepSkip', {})[date] || [];
  return preps.map(p => {
    const since = p.recipe.weekStart || '0000', total = Math.round(+p.recipe.servings || 1);
    const mine = logs.filter(e => e.recipeId === p.id);
    const used = mine.filter(e => e.date >= since).reduce((t, e) => t + (+e.qty || 0) * (+e.mult || 1), 0);
    const left = Math.max(0, Math.round((total - used) * 10) / 10);
    const logged = mine.some(e => e.date === date);
    const inUse = (since <= date && since >= addDays(date, -6)) || mine.some(e => e.date < date && e.date >= addDays(date, -3));
    return { id: p.id, name: p.name, n: p.n, total, left, logged, missing: !logged && inUse && (total <= 1 || left > 0) && !skipped.includes(p.id) };
  });
}

function openQuick(meal) {
  const b = sheet(`<form id="qa" class="form"><label>Name<input name="name" value="Quick add"></label>
    <div class="grid4"><label>Carbs<input name="c" type="number" min="0" step="any" inputmode="decimal"></label><label>Protein<input name="p" type="number" min="0" step="any" inputmode="decimal"></label>
    <label>Fat<input name="f" type="number" min="0" step="any" inputmode="decimal"></label><label>kcal<input name="kcal" type="number" min="0" step="any" inputmode="decimal" placeholder="auto"></label></div>
    <div class="actions"><button class="primary">Log</button></div></form>`, { title: 'Quick add' });
  $('#qa', b).onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const pos = v => Math.max(0, +v || 0);
    const n = { p: pos(f.p), c: pos(f.c), f: pos(f.f) };
    n.kcal = pos(f.kcal) || N.macroKcal(n);
    await logEntry({ name: f.name || 'Quick add', n, qty: 1, unit: 'serving', mult: 1, meal });
  };
}

async function logEntry(e) {
  await db.put(logName(state.date), { date: state.date, time: nowTime(), ...e });
  if ((state.s.hiddenRecents || []).includes(recentKey(e))) await setHidden([recentKey(e)], false);
  closeSheet(); render(); toast(`Logged ${e.name}`);
}

// Per-serving foods whose label gives grams ("1 bar (65 g)") can still be weighed in g or oz.
const gramsOf = l => +(/([\d.]+)\s*g\b/.exec(l || '')?.[1]) || 0;
function withMass(units) {
  if (units.some(u => u.label === 'g')) return units;
  const sv = units.find(u => gramsOf(u.label));
  if (!sv) return units;
  const g = sv.mult / gramsOf(sv.label);
  return [...units, { label: 'g', mult: g }, { label: 'oz', mult: g * 28.3495 }];
}
const unitsOf = f => withMass([...(f?.units?.length ? f.units : [{ label: 'serving', mult: 1 }])]);
// Same amount in another unit: 220 g -> 7.8 oz, 2 servings (28 g) -> 56 g.
const convertQty = (q, from, to) => { const v = (q * from.mult) / to.mult; return to.label === 'g' || to.label === 'ml' ? Math.round(v) : to.label === 'oz' ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100; };

// Portion page, laid out like Macros: name, calorie split, big C/P/F/kcal, amount with a
// one-tap g / oz / serving switch that converts the amount. Logs a food, edits an entry, or picks an ingredient.
function openPortion(f, { meal = 0, entry, pick, qty: qStart } = {}) {
  (async () => {
    // A logged entry's food may have more units now; reload it if it still exists.
    if (entry && f.id) { const live = await db.get('foods', f.id); if (live) f = { ...live, source: 'mine' }; }
    const units = unitsOf(f);
    // Editing keeps the entry's amount; "What fits" passes servings; otherwise start where you usually do.
    const start = entry ? { qty: entry.qty, unit: { label: entry.unit, mult: entry.mult } }
      : qStart ? { qty: qStart, unit: units.find(u => u.label.startsWith('serving')) || units[0] } : await defaultAmount(f);
    let ui = units.findIndex(u => u.label === start.unit.label);
    if (ui < 0) { units.unshift(start.unit); ui = 0; }
    const remote = !['mine', 'recipe'].includes(f.source) || f._quick;
    const chips = [units.findIndex(u => u.label === 'g'), units.findIndex(u => u.label === 'oz'), units.findIndex(u => !['g', 'oz'].includes(u.label))].filter(i => i >= 0);
    const chipLabel = u => (u.label === 'g' || u.label === 'oz' ? u.label : /^serving/.test(u.label) ? 'serving' : unitText(u.label));
    const c = N.check(f.n);
    const b = sheet(`<div class="pv">
      <div class="phead"><div class="grow"><div class="pname">${esc(f.name)}</div>
        <div class="pbrand">${[f.brand ? esc(f.brand) : '', f.source === 'mine' ? '' : `<span class="badge src-${f.source}">${esc(f.srcLabel || '')}</span>`, checkBadge(f.n)].filter(Boolean).join(' ')}</div></div>
        ${donutSvg(f.n)}</div>
      <div id="live" class="pmac"></div>
      ${!c.ok && !c.missingKcal ? `<p class="warn small">Listed calories don't match the macros. ${state.s.caloriesFromMacros ? 'The app counts calories from macros, so your totals stay consistent.' : 'Consider turning on "calories from macros" in Settings.'}</p>` : ''}
      <div class="qtyrow"><input id="qty" type="number" min="0" inputmode="decimal" step="any" value="${start.qty}"><select id="unit">${units.map((u, i) => `<option value="${i}" ${i === ui ? 'selected' : ''}>${esc(unitText(u.label))}</option>`).join('')}</select></div>
      ${chips.length > 1 ? `<div class="uchips">${chips.map(i => `<button data-u="${i}">${esc(chipLabel(units[i]))}</button>`).join('')}<span class="conv" id="conv"></span></div>` : ''}
      ${pick || state.s.meals.length < 2 ? '' : `<label>Meal<select id="meal">${state.s.meals.map((m, i) => `<option value="${i}" ${i === (entry?.meal ?? meal) ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>`}
      ${remote && !pick ? `<label class="check"><input type="checkbox" id="save"> Save to my foods</label>` : ''}
      <div class="pacts"><button class="primary" id="go">${entry ? 'Update' : pick ? 'Add ingredient' : 'Add'}</button>${f.source !== 'recipe' ? '<button class="link" id="edit">Edit</button>' : ''}</div>
      ${entry ? '<button class="link danger" id="del">Delete entry</button>' : ''}
    </div>`, { title: entry ? 'Edit entry' : pick ? 'Add ingredient' : 'Add food', full: true });
    const qty = $('#qty', b), unit = $('#unit', b);
    let cur = +unit.value;
    // Switching back and forth keeps the exact amount (220 g -> 7.8 oz -> 220 g, not 221).
    let exact = (+qty.value || 0) * units[cur].mult;
    const upd = () => {
      const u = units[+unit.value], q = exact / u.mult, n = N.scale(f.n, exact);
      const col = (k, v, l) => `<div class="${k}"><b>${v}</b><span>${l}</span></div>`;
      $('#live', b).innerHTML = col('c', r1(state.s.netCarbs ? Math.max(0, n.c - (n.fib || 0)) : n.c), state.s.netCarbs ? 'Net carbs' : 'Carbs') + col('p', r1(n.p), 'Protein') + col('f', r1(n.f), 'Fat') + col('k', kcalOf(n), 'Calories') +
        `<p class="muted small">${[n.fib ? `fiber ${r1(n.fib)} g` : '', n.sug ? `sugar ${r1(n.sug)} g` : '', n.na ? `sodium ${r0(n.na)} mg` : ''].filter(Boolean).join(' · ')}</p>`;
      $$('.uchips button', b).forEach(x => x.classList.toggle('on', +x.dataset.u === +unit.value));
      const conv = $('#conv', b);
      if (conv) {
        const other = units.find(x => x.label === (u.label === 'g' ? 'oz' : 'g'));
        conv.textContent = other && q ? `= ${convertQty(exact / other.mult, { mult: 1 }, { ...other, mult: 1 })} ${other.label}` : '';
      }
    };
    const setUnit = i => { qty.value = convertQty(exact / units[i].mult, { mult: 1 }, { ...units[i], mult: 1 }); unit.value = i; cur = i; upd(); };
    qty.oninput = () => { exact = Math.max(0, +qty.value || 0) * units[cur].mult; $('#go', b).disabled = !(exact > 0); upd(); };
    unit.onchange = () => setUnit(+unit.value);
    $$('.uchips button', b).forEach(x => (x.onclick = () => setUnit(+x.dataset.u)));
    upd();
    qty.focus(); qty.select();
    if (entry) $('#del', b).onclick = async () => { await db.remove(logName(entry.date), entry.id); closeSheet(); render(); };
    const editBtn = $('#edit', b);
    if (editBtn) editBtn.onclick = () => openFoodEditor(f, { meal, pick, entry });
    $('#go', b).onclick = async () => {
      let foodId = f.source === 'mine' && !f._quick ? f.id : undefined;
      if (remote && !pick && $('#save', b)?.checked) {
        const saved = await db.put('foods', { name: f.name, brand: f.brand, barcode: f.barcode, n: f.n, units, source: f.source, srcId: f.srcId });
        foodId = saved.id;
      }
      const u = units[+unit.value];
      const base = { name: f.name, brand: f.brand, foodId, recipeId: f.recipeId, qty: Math.round((exact / u.mult) * 1000) / 1000, unit: u.label, mult: u.mult, n: f.n };
      if (pick) return pick(base, { ...f, units });
      const m = +($('#meal', b)?.value ?? 0);
      if (entry) { await db.put(logName(entry.date), { ...entry, ...base, meal: m }); closeSheet(); render(); }
      else await logEntry({ ...base, meal: m });
    };
  })();
}

// Food editor works per serving, like reading a label; stores per 100 g when grams are known.
function openFoodEditor(f, { meal, pick, entry, barcode, prefill } = {}) {
  const su = f?.units?.find(u => u.label.startsWith('serving')) || f?.units?.[0];
  const per = prefill?.n || (f ? N.scale(f.n, su?.mult || 1) : {});
  const servingLabel = prefill?.servingLabel || (su ? unitText(su.label) : '') || '1 serving';
  const servingG = prefill?.servingG ?? (su && f?.units?.some(u => u.label === 'g') ? r1(su.mult * 100) : '');
  const v = k => (per[k] == null ? '' : r1(per[k]));
  const b = sheet(`<form id="fe" class="form">
    ${prefill?.notes ? `<p class="warn small">${esc(prefill.notes)}</p>` : ''}
    <label>Name<input name="name" required value="${esc(prefill?.name || f?.name || '')}"></label>
    <div class="grid2"><label>Brand<input name="brand" value="${esc(prefill?.brand || f?.brand || '')}"></label><label>Barcode<input name="barcode" inputmode="numeric" value="${esc(barcode || f?.barcode || '')}"></label></div>
    <div class="grid2"><label>Serving<input name="sl" value="${esc(servingLabel)}"></label><label>Serving grams<input name="sg" type="number" min="0" step="any" inputmode="decimal" value="${servingG}" placeholder="optional"></label></div>
    <h4>Per serving</h4>
    <div class="grid4"><label>kcal<input name="kcal" type="number" min="0" step="any" inputmode="decimal" value="${v('kcal')}"></label><label>Carbs<input name="c" type="number" min="0" step="any" inputmode="decimal" value="${v('c')}"></label>
    <label>Protein<input name="p" type="number" min="0" step="any" inputmode="decimal" value="${v('p')}"></label><label>Fat<input name="f" type="number" min="0" step="any" inputmode="decimal" value="${v('f')}"></label></div>
    <div class="grid3"><label>Fiber<input name="fib" type="number" min="0" step="any" inputmode="decimal" value="${v('fib')}"></label><label>Sugar<input name="sug" type="number" min="0" step="any" inputmode="decimal" value="${v('sug')}"></label><label>Sodium mg<input name="na" type="number" min="0" step="any" inputmode="decimal" value="${v('na')}"></label></div>
    <div id="chk"></div>
    <label class="check"><input type="checkbox" name="verified" ${f?.verified || prefill ? 'checked' : ''}> Verified against the package</label>
    <div class="actions">${f?.source === 'mine' && f.id && !f._quick ? '<button type="button" class="danger" id="delFood">Delete food</button>' : ''}<button class="primary">Save</button></div></form>`, { title: f ? 'Edit food' : 'New food' });
  const form = $('#fe', b);
  const read = () => { const d = Object.fromEntries(new FormData(form)); return { d, n: Object.fromEntries(N.KEYS.map(k => [k, d[k] === '' ? undefined : Math.max(0, +d[k] || 0)])) }; };
  const chk = () => {
    const { n } = read(), c = N.check(n);
    $('#chk', b).innerHTML = c.ok ? (n.kcal ? '<p class="ok small">✓ Calories match the macros</p>' : '') :
      `<p class="warn small">${c.missingKcal ? 'No calories entered.' : `Label says ${c.listed} kcal but the macros add up to ${c.est}.`} <button type="button" id="useEst">Use ${c.est}</button></p>`;
    const u = $('#useEst', b); if (u) u.onclick = () => { form.kcal.value = c.est; chk(); };
  };
  form.oninput = chk; chk();
  const del = $('#delFood', b);
  if (del) del.onclick = async () => { await db.remove('foods', f.id); closeSheet(); render(); };
  form.onsubmit = async e => {
    e.preventDefault();
    const { d, n } = read();
    const sg = +d.sg;
    const rec = { ...(f?.source === 'mine' && !f._quick ? f : {}), name: d.name.trim(), brand: d.brand.trim(), barcode: d.barcode.trim(), verified: d.verified === 'on', source: undefined, srcLabel: undefined };
    if (sg > 0) { rec.n = N.scale(n, 100 / sg); rec.units = N.gramUnits([{ label: `serving (${d.sl || sg + ' g'})`, mult: sg / 100 }]); }
    else { rec.n = N.scale(n, 1); rec.units = [{ label: `serving (${d.sl || '1'})`, mult: 1 }]; }
    delete rec.source; delete rec.srcLabel; delete rec._quick;
    const saved = await db.put('foods', rec);
    toast('Saved to my foods');
    openPortion({ ...saved, source: 'mine', srcLabel: saved.verified ? 'Yours ✓' : 'Yours' }, { meal, pick, entry });
  };
}

// ---------- Voice / list logging ----------
// "chicken 8.5 oz, milk 240 g, 2 eggs" -> one row per item, matched to your foods first.
let vstate = { text: '', rows: [] };
async function voiceCandidates() {
  const [mine, recipes, recent] = await Promise.all([food.mine(), recipeFoods(), recentFoods(300)]);
  const seen = new Set(), out = [];
  for (const f of [...mine, ...recipes, ...recent]) { const k = f.id || f._key || f.name; if (!seen.has(k)) { seen.add(k); out.push(f); } }
  return out;
}
async function matchRows(items, old = new Map()) {
  const cands = await voiceCandidates(), vocab = voice.vocabOf(cands), brands = food.brandWords(cands, cands);
  return Promise.all(items.map(async it => {
    const said = [it.qty !== 1 || it.unit ? `${it.qty}${it.unit ? ' ' + it.unit : ''}` : '', it.text].filter(Boolean).join(' ');
    const prev = old.get(it.text);
    if (prev?.food) return { ...prev, said, amount: prev.qty === it.qty && prev.unit === it.unit ? prev.amount : await amountFor(prev.food, it), qty: it.qty, unit: it.unit };
    const row = { said, qty: it.qty, unit: it.unit, text: it.text };
    const q = voice.clean(voice.respell(it.text, vocab));
    const local = voice.bestLocal(q, cands, brands);
    if (local?.sure) { row.food = local.food; row.src = 'yours'; }
    else {
      // Library results only count if they actually match the words (and the brand, if you said one).
      const res = await food.search(q).catch(() => ({ own: [], remote: [], brands }));
      const remote = res.remote.find(f => food.coverage(q, f, res.brands) >= 0.75);
      row.food = res.own[0] || remote || (local?.score >= 0.5 ? local.food : null);
      row.src = row.food ? 'guess' : 'none';
    }
    if (row.food) row.amount = await amountFor(row.food, it);
    return row;
  }));
}
// What you said, or your usual amount of that food when you only said its name.
async function amountFor(f, it) {
  if (it.given) return voice.resolveAmount(f, it.qty, it.unit);
  const d = await defaultAmount(f);
  return { qty: d.qty, unit: d.unit.label, mult: d.unit.mult };
}
function openVoice({ autostart = true } = {}) {
  const b = sheet(`
    ${voice.speechSupported() ? '<button id="mic" class="micbtn">🎤 Start talking</button>' : ''}
    <p class="hint" id="vhint">Say your whole list in one go, e.g. <b>"22 grams eggs, 2 packets ketchup, 1 pound chicken"</b>. Tap <b>Done</b> when you finish.</p>
    <textarea id="vt" rows="2" placeholder="…or type the list here">${esc(vstate.text)}</textarea>
    <div class="vtools"><button id="vclear">✕ Clear</button>${voice.speechSupported() ? '<button id="vredo">🎤 Start over</button>' : ''}</div>
    <ul class="list" id="vrows"></ul>
    <div id="vlog"></div>`, { title: 'Say what you ate' });
  const ta = $('#vt', b), mic = $('#mic', b);
  let rec = null, matchSeq = 0, typingT;
  const total = () => vstate.rows.filter(r => r.food).reduce((t, r) => t + N.countedKcal(N.scale(r.food.n, r.amount.qty * r.amount.mult), state.s.caloriesFromMacros), 0);
  const draw = () => {
    const rows = vstate.rows;
    $('#vrows', b).innerHTML = rows.map((r, i) => {
      const units = unitsOf(r.food);
      const n = r.food ? N.scale(r.food.n, r.amount.qty * r.amount.mult) : null;
      return `<li class="vrow ${r.src}" data-i="${i}"><div class="grow">
        <div class="vhead"><div class="name">${r.food ? esc(r.food.name) : `No match for "${esc(r.text)}"`}</div><button class="rm" aria-label="Remove">✕</button></div>
        <div class="qty">${r.src === 'yours' ? '✓ your food' : r.src === 'guess' ? '⚠ best guess, check it' : 'tap Pick to choose'} · heard "${esc(r.said)}"</div>
        ${r.food ? `<div class="vamt"><input class="vq" type="number" min="0" step="any" inputmode="decimal" value="${r.amount.qty}"><select class="vu">${units.map(u => `<option ${u.label === r.amount.unit ? 'selected' : ''}>${esc(unitText(u.label))}</option>`).join('')}</select></div>
        <div class="vfoot">${macroLine(n)}<span class="vk">${kcalOf(n)} kcal</span></div>${n.kcal > 1500 ? '<div class="warn small">⚠ That\'s a lot for one item. Check the amount and unit.</div>' : ''}` : ''}
        <button class="chg">${r.food ? 'Wrong food? Pick another' : 'Pick food'}</button>
      </div></li>`;
    }).join('');
    const ok = rows.filter(r => r.food).length;
    $('#vlog', b).innerHTML = rows.length ? `<div class="vlogbar"><button class="primary" id="logAll" ${ok ? '' : 'disabled'}>Log ${ok} item${ok === 1 ? '' : 's'} · ${r0(total())} kcal</button></div>` : '';
    $$('.vrow', b).forEach(li => {
      const r = rows[+li.dataset.i];
      $('.rm', li).onclick = () => { rows.splice(+li.dataset.i, 1); draw(); };
      $('.chg', li).onclick = () => { rec?.stop(); openAdd(0, { query: r.text, pick: (base, full) => {
        r.food = full; r.src = 'yours'; r.amount = { qty: base.qty, unit: base.unit, mult: base.mult };
        openVoice({ autostart: false });
      } }); };
      const q = $('.vq', li), u = $('.vu', li);
      if (q) q.oninput = () => { r.amount.qty = Math.max(0, +q.value || 0); const n = N.scale(r.food.n, r.amount.qty * r.amount.mult); $('.vfoot', li).innerHTML = `${macroLine(n)}<span class="vk">${kcalOf(n)} kcal</span>`; $('#logAll', b).textContent = `Log ${ok} item${ok === 1 ? '' : 's'} · ${r0(total())} kcal`; };
      // The number is what you said, so switching the unit relabels it ("26" serving -> 26 g) instead of converting.
      if (u) u.onchange = () => { const unit = unitsOf(r.food)[u.selectedIndex]; r.amount = { qty: r.amount.qty, unit: unit.label, mult: unit.mult }; draw(); };
    });
    const la = $('#logAll', b);
    if (la) la.onclick = async () => {
      const list = rows.filter(r => r.food);
      vstate = { text: '', rows: [] };
      await logMany(list.map(r => ({ f: r.food, ...r.amount })));
    };
  };
  // Re-match only items whose words changed, so edits and picks survive.
  const match = async () => {
    const my = ++matchSeq, items = voice.parseItems(vstate.text);
    if (!items.length) { vstate.rows = []; return draw(); }
    const old = new Map(vstate.rows.map(r => [r.text, r]));
    $('#vlog', b).innerHTML = '<p class="muted small">Finding foods…</p>';
    const rows = await matchRows(items, old);
    if (my !== matchSeq) return;
    vstate.rows = rows; draw();
  };
  const clear = () => { rec?.stop(); rec = null; vstate = { text: '', rows: [] }; ta.value = ''; draw(); setMic(false); };
  const setMic = on => {
    if (!mic) return;
    mic.textContent = on ? '■ Done' : '🎤 Start talking'; mic.classList.toggle('on', on);
    $('#vhint', b).hidden = !on && vstate.rows.length > 0;
  };
  const startListening = (auto = false) => {
    const before = ta.value.trim() ? ta.value.trim().replace(/[,\s]*$/, ', ') : '';
    setMic(true);
    rec = voice.listen({
      onText: t => { ta.value = before + t; vstate.text = ta.value; },
      // Opened from a shortcut, the phone may want a tap before the mic starts; that's not a blocked mic.
      onEnd: (_, err) => { rec = null; setMic(false); if (err) toast(auto ? 'Tap Start talking to begin' : 'Mic blocked: allow microphone access for this site'); match(); },
    });
  };
  if (mic) mic.onclick = () => (rec ? rec.stop() : startListening());
  $('#vclear', b).onclick = clear;
  $('#vredo', b)?.addEventListener('click', () => { clear(); startListening(); });
  ta.oninput = () => { vstate.text = ta.value; clearTimeout(typingT); typingT = setTimeout(match, 900); };
  $('.sheet-wrap')._cleanup = () => rec?.stop();
  draw();
  if (autostart && mic && !vstate.text) startListening(true);
}
// ---------- Barcode ----------
function openScanner(meal, pick) {
  const b = sheet(`<div class="scanner"><video playsinline muted></video><div class="reticle"></div></div>
    <p id="scanMsg" class="muted small">Point at the barcode. Hold steady about 6 inches away.</p>
    <form id="manual" class="row"><input name="code" inputmode="numeric" placeholder="or type the barcode digits"><button>Look up</button></form>
    <div id="hits"></div>`, { title: 'Scan barcode' });
  let ctl;
  const wrap = $('.sheet-wrap');
  wrap._cleanup = () => ctl?.stop();
  const lookup = async code => {
    ctl?.stop();
    $('.scanner', b).hidden = true;
    $('#scanMsg', b).textContent = `Looking up ${code}…`;
    const { own, found } = await food.byBarcode(code);
    if (own.length === 1) return openPortion(own[0], { meal, pick });
    const hits = $('#hits', b);
    if (!found.length && !own.length) {
      $('#scanMsg', b).textContent = `${code} isn't in Open Food Facts or USDA.`;
      hits.innerHTML = `<div class="tools"><button id="snap" class="primary">📷 Snap the label</button><button id="byName">Search by name</button><button id="manualFood">Enter manually</button></div>
        <p class="muted small">Whatever you save gets this barcode, so the next scan is instant.</p>`;
      $('#snap', b).onclick = () => openLabel({ meal, pick, barcode: code });
      $('#byName', b).onclick = () => openAdd(meal, { pick });
      $('#manualFood', b).onclick = () => openFoodEditor(null, { meal, pick, barcode: code });
      return;
    }
    const list = [...own, ...found];
    $('#scanMsg', b).textContent = list.length > 1 ? 'Pick the best match. Warnings mean the calories don\'t fit the macros.' : 'Found it:';
    hits.innerHTML = `<ul class="list">${list.map((f, i) => foodRow(f, i)).join('')}</ul><div class="tools"><button id="snap">None match: snap label</button></div>`;
    $$('li.food', hits).forEach(li => (li.onclick = () => openPortion(list[+li.dataset.i], { meal, pick })));
    $('#snap', b).onclick = () => openLabel({ meal, pick, barcode: code });
  };
  $('#manual', b).onsubmit = e => { e.preventDefault(); const c = e.target.code.value.replace(/\D/g, ''); if (c.length >= 6) lookup(c); };
  (async () => {
    try { ctl = await scan.scanBarcode($('video', b)); lookup(await ctl.done); }
    catch (e) { $('#scanMsg', b).textContent = 'Camera unavailable (' + e.message + '). Type the code instead.'; $('.scanner', b).hidden = true; }
  })();
}

// ---------- Label photo ----------
function openLabel({ meal, pick, barcode } = {}) {
  const b = sheet(`
    <div class="seg" role="radiogroup" aria-label="Label reader">
      <button data-r="ocr">On-device OCR (free)</button><button data-r="claude">Claude API (paid)</button></div>
    <p class="muted small" id="rdesc"></p>
    <label class="bigbtn">📷 Take photo of the label<input id="photo" type="file" accept="image/*" capture="environment" hidden></label>
    <p id="lmsg" class="small"></p>
    <p class="muted small">Tricky label? Send the photo to Claude in a chat on this repo instead (covered by your plan) and it adds the food to your synced foods.</p>`, { title: 'Snap nutrition label' });
  const hasKey = !!local.get('anthropicKey');
  const setR = r => {
    if (r === 'claude' && !hasKey) { toast('Claude API needs a paid Anthropic API key in Settings (not covered by Pro).'); r = 'ocr'; }
    scan.reader.set(r);
    $$('.seg button', b).forEach(x => x.classList.toggle('on', x.dataset.r === r));
    $('#rdesc', b).textContent = r === 'claude'
      ? 'Uses your Anthropic API key: about 1¢ per scan, billed separately from Claude Pro.'
      : 'Free and private. Runs on your phone; double-check the numbers before saving.';
  };
  $$('.seg button', b).forEach(x => (x.onclick = () => setR(x.dataset.r)));
  setR(scan.reader.get());
  $('#photo', b).onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    const msg = $('#lmsg', b);
    try {
      const { canvas, b64 } = await scan.toJpeg(file);
      const r = scan.reader.get();
      msg.textContent = r === 'claude' ? 'Claude is reading the label…' : 'Reading on device… (first run downloads the OCR model)';
      const res = r === 'claude' ? await scan.readLabelClaude(b64) : await scan.readLabelOCR(canvas, p => (msg.textContent = `Reading… ${Math.round(p * 100)}%`));
      openFoodEditor(null, { meal, pick, barcode, prefill: res });
    } catch (err) { msg.textContent = err.message; msg.className = 'warn small'; }
  };
}

// ---------- Foods & recipes ----------
async function viewFoods() {
  const seg = local.get('foodsSeg', 'foods') === 'recipes' ? 'recipes' : 'foods';
  const head = `<div class="seg" id="fseg"><button data-v="foods" class="${seg === 'foods' ? 'on' : ''}">My foods</button><button data-v="recipes" class="${seg === 'recipes' ? 'on' : ''}">Recipes</button></div>`;
  return head + (seg === 'recipes' ? await viewRecipes() : await viewMyFoods());
}
// Usage per food over the last ~90 days, so one-offs are easy to find and clear out.
async function foodUsage() {
  const use = new Map();
  for (const k of [0, -31, -62, -93]) for (const e of await db.all('log/' + monthOf(addDays(today(), k)))) {
    if (!e.foodId) continue;
    const u = use.get(e.foodId) || { n: 0, last: '' };
    u.n++; if (e.date > u.last) u.last = e.date;
    use.set(e.foodId, u);
  }
  return use;
}
async function viewMyFoods() {
  const [foods, use] = await Promise.all([db.all('foods'), foodUsage()]);
  const sort = local.get('foodSort', 'recent'), q = (state.foodQ || '').toLowerCase(), sel = state.fsel;
  const hidden = new Set(state.s.hiddenRecents || []);
  let list = foods.filter(f => !q || `${f.name} ${f.brand || ''}`.toLowerCase().includes(q));
  const u = f => use.get(f.id) || { n: 0, last: '' };
  list.sort(sort === 'az' ? (a, b) => a.name.localeCompare(b.name) : sort === 'least' ? (a, b) => u(a).n - u(b).n || a.name.localeCompare(b.name) : (a, b) => u(b).last.localeCompare(u(a).last) || a.name.localeCompare(b.name));
  state.fview = list.map(f => f.id);
  return `<div class="row"><input id="fq" type="search" placeholder="Filter ${foods.length} foods" value="${esc(state.foodQ || '')}">
    <select id="fsort" style="max-width:130px"><option value="recent" ${sort === 'recent' ? 'selected' : ''}>Recently eaten</option><option value="least" ${sort === 'least' ? 'selected' : ''}>Least used</option><option value="az" ${sort === 'az' ? 'selected' : ''}>A–Z</option></select></div>
    <div class="tools top">${sel ? '<button id="fAll">Select all shown</button><button id="fDone" class="primary">Done</button>' : '<button id="fSel">Select</button><button id="fNew">＋ New food</button>'}</div>
    ${list.length ? `<ul class="list card ${sel ? 'selecting' : ''}" id="flist">${list.map(f => {
      const x = u(f);
      return `<li data-id="${f.id}" class="${sel?.has(f.id) ? 'picked' : ''}">${sel ? '<span class="box"></span>' : ''}<div class="grow"><div class="name">${f.fav ? '★ ' : ''}${esc(f.name)}${f.verified ? ' <span class="badge ok">✓</span>' : ''}</div>
        <div class="sub">${f.brand ? esc(f.brand) + ' · ' : ''}${x.n ? `eaten ${x.n}× · last ${fmtDate(x.last)}` : 'not eaten in 90 days'}${hidden.has(f.id) ? ' · hidden from recents' : ''}</div></div>${sel ? '' : '<span class="chev">›</span>'}</li>`;
    }).join('')}</ul>` : '<p class="muted">No saved foods yet. Foods you save from search, barcode or label scans land here.</p>'}
    ${sel ? `<div class="selbar"><span>${sel.size} selected</span><button id="fFav">★ Favorite</button><button id="fHide">Hide in recents</button><button id="fDel" class="danger">Delete</button></div>` : ''}`;
}
bind.foods = root => {
  $$('#fseg button', root).forEach(b => (b.onclick = () => { local.set('foodsSeg', b.dataset.v); state.fsel = null; render(); }));
  if (local.get('foodsSeg', 'foods') === 'recipes') return bind.recipes(root);
  const fq = $('#fq', root);
  fq.oninput = () => { state.foodQ = fq.value; clearTimeout(fq._t); fq._t = setTimeout(async () => { await render(); const n = $('#fq'); n.focus(); n.setSelectionRange(99, 99); }, 300); };
  $('#fsort', root).onchange = e => { local.set('foodSort', e.target.value); render(); };
  $('#fSel', root)?.addEventListener('click', () => { state.fsel = new Set(); render(); });
  $('#fNew', root)?.addEventListener('click', () => openFoodEditor(null, {}));
  $('#fDone', root)?.addEventListener('click', () => { state.fsel = null; render(); });
  $('#fAll', root)?.addEventListener('click', () => { state.fview.forEach(id => state.fsel.add(id)); render(); });
  $$('#flist li[data-id]', root).forEach(li => (li.onclick = async () => {
    const id = li.dataset.id;
    if (state.fsel) { state.fsel.has(id) ? state.fsel.delete(id) : state.fsel.add(id); return render(); }
    openFoodEditor({ ...(await db.get('foods', id)), source: 'mine' }, {});
  }));
  if (!state.fsel) return;
  const ids = () => [...state.fsel];
  $('#fDel', root).onclick = async () => {
    if (!ids().length || !confirm(`Delete ${ids().length} food${ids().length === 1 ? '' : 's'}? Past log entries keep their numbers.`)) return;
    for (const id of ids()) await db.remove('foods', id);
    toast(`Deleted ${ids().length}`); state.fsel = null; render();
  };
  $('#fFav', root).onclick = async () => {
    const list = await Promise.all(ids().map(id => db.get('foods', id)));
    const on = list.some(f => !f.fav); // favorite all unless every one already is
    for (const f of list) await db.put('foods', { ...f, fav: on || undefined });
    toast(on ? 'Favorited' : 'Unfavorited'); state.fsel = null; render();
  };
  $('#fHide', root).onclick = async () => {
    const h = new Set(state.s.hiddenRecents || []), hide = ids().some(id => !h.has(id));
    await setHidden(ids(), hide); toast(hide ? 'Hidden from recents' : 'Back in recents'); state.fsel = null; render();
  };
};

async function viewRecipes() {
  const rs = await recipeFoods();
  const row = (r) => `<li data-id="${r.id}"><div class="grow"><div class="name">${esc(r.name)} <span class="badge src-recipe">${tagLabel(r.tag)}</span></div>
    <div class="qty">per ${esc(r.units[0].label)}</div>${macroLine(r.n)}</div>${kcalCol(r.n)}</li>`;
  return `<div class="tools top"><button id="newR" class="primary">＋ Recipe</button><button id="newP">＋ Meal prep</button></div>
    ${rs.length ? `<ul class="list card">${rs.sort((a, b) => a.name.localeCompare(b.name)).map(row).join('')}</ul>` : '<p class="muted">No recipes yet. Ingredients can be your foods, search results, or other recipes.</p>'}`;
}
bind.recipes = root => {
  $('#newR', root).onclick = () => openRecipe({ name: '', servings: 1, servingLabel: 'serving', items: [] });
  $('#newP', root).onclick = () => openRecipe({ name: 'Lunch prep', tag: 'prep', servings: 5, servingLabel: 'portion', items: [], weekStart: today() });
  $$('li[data-id]', root).forEach(li => (li.onclick = async () => openRecipe(await db.get('recipes', li.dataset.id))));
};
function openRecipe(r) {
  r = structuredClone(r);
  const b = sheet(`<form id="rf" class="form">
    <label>Name<input name="name" required value="${esc(r.name)}"></label>
    <div class="grid3"><label>Type<select name="tag"><option value="">Recipe</option><option value="creami" ${r.tag === 'creami' ? 'selected' : ''}>Creami</option><option value="prep" ${r.tag === 'prep' ? 'selected' : ''}>Meal prep</option></select></label>
    <label>Servings<input name="servings" type="number" step="any" inputmode="decimal" value="${r.servings}"></label><label>Serving name<input name="servingLabel" value="${esc(r.servingLabel)}"></label></div>
    ${r.tag === 'prep' ? `<p class="hint">One prep you reuse every week. Days you already logged keep their numbers, so on Sunday just change the amounts${r.id ? ' and tap New week' : ''}. Each day, tap it on Today to log a portion.</p>` : ''}
    <h4>Ingredients</h4><ul class="list" id="items"></ul>
    <button type="button" id="addI">＋ Ingredient</button>
    <div id="rtot" class="live"></div>
    <div class="actions">${r.id ? `<button type="button" class="danger" id="delR">Delete</button><button type="button" id="logR">Log a serving</button>${r.tag === 'prep' ? '<button type="button" id="newWeek">New week</button>' : ''}` : ''}<button class="primary">Save</button></div></form>`, { title: r.id ? (r.tag === 'prep' ? 'Edit meal prep' : 'Edit recipe') : r.tag === 'prep' ? 'New meal prep' : 'New recipe' });
  const form = $('#rf', b);
  const draw = () => {
    $('#items', b).innerHTML = r.items.map((it, i) => {
      const n = N.scale(it.n, it.qty * it.mult);
      return `<li><div class="grow"><div class="name">${esc(it.name)}</div><div class="qty"><b>${kcalOf(n)} kcal</b></div>${macroLine(n)}</div>
      <input class="iq" data-i="${i}" type="number" min="0" step="any" inputmode="decimal" value="${it.qty}"><span class="small">${esc(it.unit)}</span><button type="button" class="rm" data-i="${i}" aria-label="Remove">✕</button></li>`;
    }).join('');
    const t = N.zero(); r.items.forEach(it => N.add(t, N.scale(it.n, it.qty * it.mult)));
    const sv = Math.max(1, +form.servings.value || 1), per = N.scale(t, 1 / sv);
    $('#rtot', b).innerHTML = `<div class="qty">Whole recipe: <b>${kcalOf(t)} kcal</b></div>${macroLine(t)}<div class="kcal" style="margin-top:10px">Per ${esc(form.servingLabel.value)}: ${kcalOf(per)} kcal</div>${macroLine(per)}`;
    $$('.iq', b).forEach(x => (x.oninput = () => { r.items[+x.dataset.i].qty = Math.max(0, +x.value || 0); drawTotals(); }));
    $$('.rm', b).forEach(x => (x.onclick = () => { r.items.splice(+x.dataset.i, 1); draw(); }));
  };
  const drawTotals = () => { const keep = document.activeElement?.dataset?.i; draw(); if (keep != null) { const el = $(`.iq[data-i="${keep}"]`, b); el?.focus(); el?.setSelectionRange?.(99, 99); } };
  form.servings.oninput = form.servingLabel.oninput = draw;
  draw();
  const back = () => { const w = $('.sheet-wrap'); w?.remove(); openRecipe(r); };
  $('#addI', b).onclick = () => {
    Object.assign(r, readForm());
    openAdd(0, { pick: it => { if (it.recipeId && it.recipeId === r.id) return toast("A recipe can't contain itself"); r.items.push(it); back(); } });
  };
  const readForm = () => ({ name: form.name.value, tag: form.tag.value || undefined, servings: +form.servings.value || 1, servingLabel: form.servingLabel.value || 'serving' });
  form.onsubmit = async e => { e.preventDefault(); const x = { ...r, ...readForm() }; if (x.tag === 'prep') x.weekStart ??= today(); await db.put('recipes', x); closeSheet(); toast('Saved'); render(); };
  // New week: same ingredients, amounts stay editable here, and the portion count restarts.
  $('#newWeek', b)?.addEventListener('click', async () => { await db.put('recipes', { ...r, ...readForm(), weekStart: today() }); closeSheet(); toast('New week started. Past days keep their numbers.'); render(); });
  if (r.id) {
    $('#delR', b).onclick = async () => { await db.remove('recipes', r.id); closeSheet(); render(); };
    $('#logR', b).onclick = async () => {
      await db.put('recipes', { ...r, ...readForm() });
      const rf = (await recipeFoods()).find(x => x.id === r.id);
      openPortion(rf, { meal: 0 });
    };
  }
}

// ---------- Explore ----------
// Its own tab, three jobs: Cook (curated halal ideas from app/ideas.json, each linked to the
// YouTube / Reddit / recipe-site posts behind it), Eat out (playbooks, guides and a halal map)
// and Deals (data/fuel/deals.json, refreshed weekly by tools/food_deals.js).
let ideasP;
const loadIdeas = () => (ideasP ??= fetch('ideas.json').then(r => r.json()).catch(() => { ideasP = null; return { ideas: [], buys: {} }; }));
const EX_MODES = [['cook', 'Cook'], ['out', 'Eat out'], ['deals', 'Deals']];
const EX_CHIPS = [['you', 'For you'], ['fits', 'Fits today'], ['meal', 'Meals'], ['sweet', 'Sweets'], ['snack', 'Snacks'], ['hack', 'Hacks']];
const CAT = { meal: 'Meal', sweet: 'Sweet', snack: 'Snack' };
const LINK = { youtube: 'YouTube', reddit: 'Reddit', web: 'Recipe' };

async function exploreData() {
  const [{ ideas, buys }, foods, recipes, deals] = await Promise.all([loadIdeas(), db.all('foods'), db.all('recipes'), db.all('deals')]);
  const byId = new Map(foods.map(f => [f.id, f]));
  // Log names from the last ~60 days, counted, so "because you eat X" names your most frequent match.
  const names = new Map(), cutoff = addDays(today(), -60);
  for (const m of new Set([0, -31, -62].map(k => monthOf(addDays(today(), k)))))
    for (const e of await db.all('log/' + m)) if (e.date >= cutoff) names.set(e.name, (names.get(e.name) || 0) + 1);
  const pantry = foods.map(f => f.name);
  // Weekly-ad deals count until the ad ends; online ones for 45 days after posting.
  const fresh = deals.filter(d => (d.until ? d.until >= today() : d.date >= addDays(today(), -45))).sort((a, b) => !!b.until - !!a.until || b.date.localeCompare(a.date));
  const list = ideas.map(x => {
    // Use your own food's current numbers when the idea uses one of your foods.
    const items = x.items.map(it => (it.foodId && byId.has(it.foodId) ? { ...it, n: byId.get(it.foodId).n } : it));
    const n = N.zero(); items.forEach(it => N.add(n, N.scale(it.n, it.qty * it.mult)));
    const re = new RegExp(x.like, 'i');
    const hits = [...names].filter(([nm]) => re.test(nm)).sort((a, b) => b[1] - a[1]);
    const owned = items.filter(it => it.foodId && byId.has(it.foodId)).length;
    const because = hits[0]?.[0] || pantry.find(nm => re.test(nm));
    return { ...x, links: x.links || [], items, n, k: N.countedKcal(n, state.s.caloriesFromMacros), because, owned,
      score: hits.reduce((t, h) => t + h[1], 0) * 2 + (because ? 3 : 0) + owned,
      saved: recipes.find(r => r.explore === x.id), deals: fresh.filter(d => x.buys?.includes(d.buy)) };
  });
  return { list, buys, deals: fresh };
}
// Ad deals show price, promo and end date; online deals link out.
function dealRow(d, buys, { store = true } = {}) {
  const ends = d.until && new Date(d.until + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' });
  const sub = d.until ? [store && d.store, ends && 'until ' + ends] : [buys?.[d.buy]?.name, fmtDate(d.date), d.src];
  const body = `<div class="grow"><div class="name">${esc(d.title)}</div>${d.until && (d.price || d.promo) ? `<div class="deal-p">${esc([d.price, d.promo].filter(Boolean).join(' · '))}</div>` : ''}<div class="sub">${esc(sub.filter(Boolean).join(' · '))}</div></div>`;
  return d.url ? `<li><a href="${esc(d.url)}" target="_blank" rel="noopener">${body}<span class="chev">›</span></a></li>` : `<li class="ad">${body}</li>`;
}
async function leftToday() {
  const s = state.s, [entries, ctx] = await Promise.all([entriesFor(today()), dayContext(today())]);
  const tot = N.entryTotals(entries, s.caloriesFromMacros), g = ctx.goals;
  return { kcal: g.kcal - tot.kcal, p: g.p - tot.p, c: g.c - (s.netCarbs ? netC(tot) : tot.c), f: g.f - tot.f };
}

const exModeBar = m => `<div class="seg mode" id="exMode">${EX_MODES.map(([k, l]) => `<button data-m="${k}" class="${k === m ? 'on' : ''}">${l}</button>`).join('')}</div>`;
// Search box that re-renders as you type and keeps focus.
function liveSearch(root, sel, key) {
  const q = $(sel, root); if (!q) return;
  q.oninput = () => { state[key] = q.value; clearTimeout(q._t); q._t = setTimeout(async () => { await render(); const n = $(sel); n.focus(); n.setSelectionRange(99, 99); }, 350); };
  q.onkeydown = e => { if (e.key === 'Enter') q.blur(); };
}
async function viewExplore() {
  const mode = local.get('exMode', 'cook');
  if (mode === 'out') return exModeBar(mode) + await viewEatOut();
  if (mode === 'deals') return exModeBar(mode) + await viewDeals();
  const chip = local.get('exChip', 'you'), q = (state.exQ || '').trim().toLowerCase();
  const { list } = await exploreData();
  let shown = q ? list.filter(x => `${x.name} ${x.items.map(i => i.name).join(' ')}`.toLowerCase().includes(q)) : list, note = '';
  const density = (a, b) => b.n.p / b.k - a.n.p / a.k;
  if (chip === 'you') shown = [...shown].sort((a, b) => b.score - a.score || density(a, b));
  else if (chip === 'fits') {
    const rem = await leftToday();
    shown = shown.filter(x => fitsLeft(x.n, x.k, rem)).sort((a, b) => b.n.p - a.n.p);
    state.exFitsDone = outOfKcal(rem) && rem.p < 15;
    note = `<p class="hint">Today: ${leftLine(rem)}${outOfKcal(rem) && rem.p >= 15 ? '<br>Out of calories, so only lean protein shows.' : ''}</p>`;
  } else shown = shown.filter(x => (chip === 'hack' ? x.hack : x.cat === chip)).sort(density);
  state.exShown = shown;
  const sub = x => [CAT[x.cat], ...new Set(x.links.map(l => LINK[l.t]))].join(' · ');
  const row = (x, i) => `<li class="food idea" data-i="${i}"><div class="grow">${row2(esc(x.name), x.n, esc(sub(x)))}
    ${chip === 'you' && x.because ? `<div class="bc">Because you eat ${esc(x.because.split(',')[0])}</div>` : ''}</div></li>`;
  return `${exModeBar(mode)}<div class="row eoq"><input id="exQ" type="search" placeholder="Search ideas or an ingredient" value="${esc(state.exQ || '')}" enterkeyhint="search"></div>
    <div class="chips" id="exChips">${EX_CHIPS.map(([k, l]) => `<button data-c="${k}" class="${k === chip ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${note}
    ${shown.length ? `<ul class="list card ideas">${shown.map(row).join('')}</ul>` : `<p class="muted pad">${chip !== 'fits' ? 'Nothing matches.' : state.exFitsDone ? 'Calories and protein are covered today. Nothing to add.' : "None of the ideas fit what's left today."}</p>`}
    ${chip === 'fits' ? `<button class="wide" id="exFits">${ico('pie')}What fits from my own foods</button>` : ''}
    <p class="muted small">All halal: vegetarian, seafood or halal meat, no gelatin or alcohol. Macros are worked out from labels for the amounts listed. Tap an idea for the videos and posts it came from.</p>`;
}
async function viewDeals() {
  const { buys, deals } = await exploreData();
  const order = Object.keys(buys), byStore = new Map();
  for (const d of deals.filter(d => d.until).sort((a, b) => order.indexOf(a.buy) - order.indexOf(b.buy))) byStore.set(d.store, [...(byStore.get(d.store) || []), d]);
  const stores = [...byStore].sort((a, b) => b[1].length - a[1].length), online = deals.filter(d => !d.until).slice(0, 8);
  const until = ds => { const u = ds.map(d => d.until).sort()[0]; return u ? 'until ' + new Date(u + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : ''; };
  return `${stores.map(([st, ds]) => `<section class="card deals"><header><h3>${esc(st)}</h3><span class="muted small">${until(ds)}</span></header><ul class="list">${ds.map(d => dealRow(d, buys, { store: false })).join('')}</ul></section>`).join('')}
    ${online.length ? `<section class="card deals"><header><h3>Online</h3></header><ul class="list">${online.map(d => dealRow(d, buys)).join('')}</ul></section>` : ''}
    ${deals.length ? '' : '<p class="muted pad">No deals synced yet. They refresh Wednesdays and Saturdays.</p>'}
    <p class="muted small">Weekly ads near Bellefonte (Giant, Weis, ALDI, Walmart, Target) plus Slickdeals, checked Wed and Sat for what you buy: ${esc(Object.values(buys).map(b => b.name).join(', '))}.</p>`;
}
bind.explore = root => {
  $$('#exMode button', root).forEach(b => (b.onclick = () => { local.set('exMode', b.dataset.m); render(); }));
  const mode = local.get('exMode', 'cook');
  if (mode === 'out') return bind.eatout(root);
  if (mode === 'deals') return;
  liveSearch(root, '#exQ', 'exQ');
  $$('#exChips button', root).forEach(b => (b.onclick = () => { local.set('exChip', b.dataset.c); render(); }));
  $('#exFits', root)?.addEventListener('click', () => openFits());
  $$('li.idea', root).forEach(li => (li.onclick = () => openIdea(state.exShown[+li.dataset.i])));
};

const linkRow = l => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${ico(l.t)}<div class="grow"><div class="name">${esc(l.title)}</div><div class="sub">${esc([LINK[l.t] || '', l.by].filter(Boolean).join(' · '))}</div></div><span class="chev">›</span></a></li>`;
function openIdea(x) {
  const ing = x.items.map(it => { const n = N.scale(it.n, it.qty * it.mult); return `<li><div class="grow">${row2(esc(it.name), n, esc([it.brand, qtyText(it.qty, it.unit)].filter(Boolean).join(', ')))}</div></li>`; }).join('');
  const q = encodeURIComponent(x.q || x.name);
  const b = sheet(`<div class="live"><div class="kcal">${r0(x.k)} kcal${x.serving ? ' per ' + esc(x.serving) : ''}</div>${macroLine(x.n)}<div class="muted small">${[x.n.fib ? `fiber ${r1(x.n.fib)} g` : '', x.n.na ? `sodium ${r0(x.n.na)} mg` : ''].filter(Boolean).join(' · ')}</div></div>
    <p class="hint">${esc(x.why)}</p>
    <h4>${x.kind === 'buy' ? 'Item' : 'Ingredients'}</h4><ul class="list">${ing}</ul>
    ${x.kind === 'buy' ? '' : `<h4>How</h4><ol class="steps">${x.steps.map(t => `<li>${esc(t)}</li>`).join('')}</ol>`}
    ${x.halal ? `<p class="small halal">${esc(x.halal)}</p>` : ''}
    ${x.links.length ? `<h4>Watch & read</h4><ul class="list links">${x.links.map(linkRow).join('')}</ul>` : ''}
    <div class="findmore"><span class="muted small">Find more</span><a href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">${ico('youtube')}YouTube</a><a href="https://www.reddit.com/search/?q=${q}" target="_blank" rel="noopener">${ico('reddit')}Reddit</a><a href="https://www.google.com/search?q=${q}%20recipe" target="_blank" rel="noopener">${ico('web')}Web</a></div>
    ${x.links.length ? '<p class="muted small">Linked recipes may use non-halal swaps; the ingredients above are the halal version.</p>' : ''}
    ${x.deals.length ? `<h4>Deals</h4><ul class="list">${x.deals.slice(0, 4).map(d => dealRow(d)).join('')}</ul>` : ''}
    <div class="actions">${x.kind === 'buy' ? '' : `<button id="iSave">${x.saved ? 'Open my recipe' : 'Save to my recipes'}</button>`}<button class="primary" id="iLog">Log it</button></div>`, { title: x.name });
  $('#iLog', b).onclick = async () => openPortion(x.saved
    ? (await recipeFoods()).find(r => r.id === x.saved.id)
    : { name: x.name, n: x.n, units: [{ label: x.serving || (x.items.length === 1 ? x.items[0].unit : 'serving'), mult: 1 }], source: 'recipe', srcLabel: 'Explore' }, { meal: defaultMeal() });
  const sv = $('#iSave', b);
  if (sv) sv.onclick = async () => {
    const r = x.saved || await db.put('recipes', { name: x.name, servings: 1, servingLabel: x.serving || 'serving',
      items: x.items.map(({ foodId, name, brand, qty, unit, mult, n }) => ({ foodId, name, brand, qty, unit, mult, n })), explore: x.id });
    if (!x.saved) toast('Saved to My recipes');
    openRecipe(r);
  };
}

// ---------- Eat out ----------
// Cuisine playbooks (app/eatout.json) work for any place; saved restaurant guides with halal
// detail live in data/fuel/places.json, written by Claude (.claude/skills/eat-out). The halal
// map reads data/halal/us.json (Overture, OpenStreetMap and HMS listings, rebuilt monthly).
let eatoutP;
const loadEatout = () => (eatoutP ??= fetch('eatout.json').then(r => r.json()).catch(() => { eatoutP = null; return { cuisines: [] }; }));
const EO_CHIPS = [['veg', 'Veg'], ['fish', 'Fish'], ['fits', 'Fits today']];
const TAG_LABEL = { veg: 'Veg', fish: 'Fish', meat: 'Halal meat' };
const SLAUGHTER = { hand: 'Hand-slaughtered', machine: 'Machine-slaughtered', unconfirmed: 'Slaughter unconfirmed' };
const HOME = { la: 40.9134, lo: -77.7783 }; // Bellefonte, until the phone shares a location

function halalBadges(h) {
  if (!h || h.status === 'unknown') return '<span class="badge">Halal unknown</span>';
  if (h.status === 'none') return '<span class="badge warn">Not halal</span>';
  return [`<span class="badge ok">${h.status === 'full' ? 'Fully halal' : 'Partly halal'}</span>`,
    `<span class="badge ${h.slaughter === 'hand' ? 'ok' : ''}">${SLAUGHTER[h.slaughter] || SLAUGHTER.unconfirmed}</span>`,
    h.alcohol === false ? '<span class="badge">No alcohol</span>' : h.alcohol ? '<span class="badge warn">Serves alcohol</span>' : '',
    `<span class="badge">${h.cert ? 'Cert: ' + esc(h.cert) : 'No certifier listed'}</span>`].join(' ');
}
// Orders that pass the Veg / Fish / Fits filters. Meat only counts at a halal place.
function eoOrders(orders, f, rem, halalPlace) {
  const want = ['veg', 'fish'].filter(k => f.includes(k));
  return orders.filter(o => (!want.length || want.includes(o.tag)) && (o.tag !== 'meat' || halalPlace !== false)
    && (!f.includes('fits') || !rem || (outOfKcal(rem) ? rem.p >= 15 && isLean(o.n, o.n.kcal) : o.n.kcal <= rem.kcal + 40)))
    .sort((a, b) => b.n.p / b.n.kcal - a.n.p / a.n.kcal);
}
const orderRow = (o, i, halalPlace) => `<li class="food eo" data-o="${i}"><div class="grow">${row2(esc(o.name), o.n, esc(o.price || ''))}
  ${o.how ? `<div class="bc">${esc(o.how)}</div>` : ''}<div class="why"><span class="badge tag-${o.tag}">${TAG_LABEL[o.tag]}${o.tag === 'meat' && halalPlace == null ? ' · halal place only' : ''}</span> ${o.basis ? `<span class="badge ok" title="${esc(o.basis)}">Published</span>` : '<span class="badge">Estimate</span>'} <b class="pd">${r0((o.n.p * 100) / o.n.kcal)} g protein / 100 kcal</b></div></div></li>`;

// --- halal map data ---
const miles = (a, b) => { const x = (b.lo - a.lo) * Math.cos(((a.la + b.la) / 2) * Math.PI / 180), y = b.la - a.la; return Math.hypot(x, y) * 69.05; };
const KIND = { r: 'Restaurant', g: 'Grocery', b: 'Butcher / meat market' };
// Strongest halal evidence first: a current certificate, then a "fully halal" map tag, then a listing.
function halalLevel(p) {
  if (p.guide) return p.halal?.status === 'full' ? { lv: 'full', label: 'Fully halal (your guide)' } : { lv: 'listed', label: 'Partly halal (your guide)' };
  if (p.hms) return !p.hms.until || p.hms.until >= today() ? { lv: 'cert', label: 'HMS certified · hand-slaughtered' } : { lv: 'listed', label: 'HMS certificate expired' };
  if (p.osm?.h === 'only') return { lv: 'full', label: 'Fully halal (OpenStreetMap)' };
  return { lv: 'listed', label: p.osm ? 'Halal options (OpenStreetMap)' : p.ov === 'cat' ? 'Listed as halal (Overture Maps)' : '“Halal” in the name' };
}
async function halalData() {
  const [hp, guides] = await Promise.all([sync.halalPlaces(), db.all('places')]);
  const g = guides.filter(p => p.la && ['full', 'partial'].includes(p.halal?.status))
    .map(p => ({ n: p.name, la: p.la, lo: p.lo, k: 'r', a: p.address, c: p.city, guide: p.id, halal: p.halal }));
  // A saved guide replaces the same place from the open data.
  const dup = p => g.some(x => miles(x, p) < 0.15 && x.n.toLowerCase().split(' ')[0] === p.n.toLowerCase().split(' ')[0]);
  return { all: [...g, ...hp.places.filter(p => !dup(p))], built: hp.built };
}
function getLoc() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => { const l = { la: p.coords.latitude, lo: p.coords.longitude }; local.set('lastLoc', l); res(l); }, () => res(null), { timeout: 10000, maximumAge: 300000 });
  });
}
const hpRow = (p, i, here) => { const h = halalLevel(p); return `<li class="food hp" data-h="${i}"><span class="dot lv-${h.lv}"></span><div class="grow">
  <div class="r1"><span class="name">${esc(p.n)}</span><span class="muted small">${here ? r1(miles(here, p)) + ' mi' : ''}</span></div>
  <div class="r2"><span class="sub">${esc([KIND[p.k], p.c].filter(Boolean).join(' · '))}</span></div><div class="why"><span class="badge lv-${h.lv}">${esc(h.label)}</span></div></div></li>`; };

// Detail for one map place: halal evidence with sources, then what to do next.
function halalCard(p, cuisines, { head = true } = {}) {
  const h = halalLevel(p), where = [p.a, p.c, p.s].filter(Boolean).join(', ');
  const cu = !p.guide && cuisines.find(c => new RegExp(c.match, 'i').test(p.n));
  const best = cu ? eoOrders(cu.orders, local.get('eoF', []).filter(k => k !== 'fits'), null, true).slice(0, 3) : [];
  const src = [p.hms && `<a href="${esc(p.hms.url)}" target="_blank" rel="noopener">HMS listing${p.hms.no ? ' #' + esc(p.hms.no) : ''}</a>${p.hms.until ? ', valid through ' + esc(fmtDate(p.hms.until)) : ''}`,
    p.osm && `<a href="https://www.openstreetmap.org/${esc(p.osm.id)}" target="_blank" rel="noopener">OpenStreetMap</a> (diet:halal=${esc(p.osm.h)})`,
    p.ov && `Overture Maps (${p.ov === 'cat' ? 'halal restaurant category' : 'name'})`,
    p.w && `<a href="${esc(p.w)}" target="_blank" rel="noopener">Website</a>`].filter(Boolean);
  const q = encodeURIComponent([p.n, p.a, p.c, p.s].filter(Boolean).join(' '));
  return `<div class="hc-top">${head ? `<div class="name">${esc(p.n)}</div>` : ''}<div class="sub">${esc([KIND[p.k], where].filter(Boolean).join(' · '))}</div></div>
    <div class="halalbox">${p.guide ? halalBadges(p.halal) : `<span class="badge lv-${h.lv}">${esc(h.label)}</span> <span class="badge">${p.hms ? 'Hand-slaughtered (HMS standard)' : SLAUGHTER.unconfirmed}</span>`}
      ${src.length ? `<p class="small muted">Sources: ${src.join(' · ')}</p>` : ''}
      ${p.hms || p.guide ? '' : '<p class="small muted">Open map data only says this place serves halal; it doesn\'t confirm the certifier, slaughter method or alcohol. Check Zabihah or ask the restaurant.</p>'}</div>
    ${best.length ? `<h4>Good orders (${esc(cu.name)} playbook)</h4><ul class="list">${best.map((o, i) => orderRow(o, i, true)).join('')}</ul>` : ''}
    <div class="hc-acts"><a class="btn" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">${ico('nav')}Directions</a>
      <a class="btn" href="https://www.google.com/search?q=${encodeURIComponent('site:zabihah.com ' + p.n + ' ' + (p.c || ''))}" target="_blank" rel="noopener">${ico('search')}Zabihah</a>
      ${p.guide ? '<button id="hcGuide" class="primary">Open guide</button>' : '<button id="hcAsk" class="primary">What to order</button>'}</div>`;
}
function bindHalalCard(el, p, cuisines) {
  const cu = !p.guide && cuisines.find(c => new RegExp(c.match, 'i').test(p.n));
  const orders = cu ? eoOrders(cu.orders, local.get('eoF', []).filter(k => k !== 'fits'), null, true).slice(0, 3) : [];
  $$('li.eo', el).forEach(li => (li.onclick = () => logOrder(p.n, orders[+li.dataset.o])));
  $('#hcAsk', el)?.addEventListener('click', () => openAsk({ place: [p.n, p.c, p.s].filter(Boolean).join(', ') }));
  $('#hcGuide', el)?.addEventListener('click', async () => openPlace(await db.get('places', p.guide)));
}
async function openHalal(p) {
  const { cuisines } = await loadEatout();
  const b = sheet(halalCard(p, cuisines, { head: false }), { title: p.n });
  bindHalalCard(b, p, cuisines);
}

let leafletP;
const loadLeaflet = () => (leafletP ??= new Promise((res, rej) => {
  const base = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min';
  document.head.insertAdjacentHTML('beforeend', `<link rel="stylesheet" href="${base}.css">`);
  const s = document.createElement('script'); s.src = base + '.js';
  s.onload = () => res(window.L); s.onerror = () => { leafletP = null; s.remove(); rej(new Error("Couldn't load the map. Check your connection.")); };
  document.head.append(s);
}));
const MAP_F = [['all', 'All'], ['cert', 'Certified'], ['r', 'Restaurants'], ['gb', 'Markets & butchers']];
async function openMap() {
  const b = sheet(`<div class="chips mapf" id="mapF">${MAP_F.map(([k, l]) => `<button data-f="${k}" class="${k === 'all' ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="mapwrap"><div id="hmap"></div><button id="mLoc" class="mloc" aria-label="My location">${ico('locate')}</button><div id="hcard" class="hcard" hidden></div></div>
    <p class="muted small maplegend"><span class="dot lv-cert"></span>HMS certified <span class="dot lv-full"></span>Fully halal <span class="dot lv-listed"></span>Listed as halal, not verified</p>`, { title: 'Halal map', full: true });
  const wrap = b.closest('.sheet-wrap'); wrap.classList.add('mapsheet');
  let L, data, cuisines;
  try { [L, data, { cuisines }] = await Promise.all([loadLeaflet(), halalData(), loadEatout()]); } catch (e) { $('#hmap', b).innerHTML = `<p class="muted pad">${esc(e.message)}</p>`; return; }
  if (!$('#hmap', b)?.isConnected) return;
  const dark = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#000';
  const start = local.get('lastLoc', null) || HOME;
  const map = L.map($('#hmap', b), { zoomControl: false, preferCanvas: true }).setView([start.la, start.lo], local.get('lastLoc', null) ? 13 : 11);
  wrap._cleanup = () => map.remove();
  // Standard OSM tiles; dark mode inverts them in CSS (.dark-tiles).
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Overture · HMS' }).addTo(map);
  $('#hmap', b).classList.toggle('dark-tiles', dark);
  const COLOR = { cert: '#34c759', full: '#5ac8fa', listed: '#ff9f0a' };
  const layer = L.layerGroup().addTo(map), card = $('#hcard', b);
  let you, f = 'all';
  const show = p => { card.hidden = false; card.innerHTML = halalCard(p, cuisines); bindHalalCard(card, p, cuisines); };
  const draw = () => {
    layer.clearLayers();
    for (const p of data.all) {
      const h = halalLevel(p);
      if (f === 'cert' ? h.lv !== 'cert' : f === 'r' ? p.k !== 'r' : f === 'gb' ? p.k === 'r' : false) continue;
      L.circleMarker([p.la, p.lo], { radius: p.guide ? 9 : 7, color: p.guide ? '#ff6150' : dark ? '#000' : '#fff', weight: p.guide ? 3 : 1.5, fillColor: COLOR[h.lv], fillOpacity: 0.95, bubblingMouseEvents: false })
        .on('click', () => show(p)).addTo(layer);
    }
  };
  draw();
  map.on('click', () => (card.hidden = true));
  $$('#mapF button', b).forEach(x => (x.onclick = () => { f = x.dataset.f; $$('#mapF button', b).forEach(y => y.classList.toggle('on', y === x)); card.hidden = true; draw(); }));
  const locate = async () => {
    const l = await getLoc(); if (!l) return toast('Location is off; showing the last place you looked');
    you?.remove(); you = L.circleMarker([l.la, l.lo], { radius: 6, color: '#fff', weight: 2, fillColor: '#0a84ff', fillOpacity: 1 }).addTo(map);
    map.setView([l.la, l.lo], 12);
  };
  $('#mLoc', b).onclick = locate;
  if (!local.get('lastLoc', null)) locate();
  setTimeout(() => map.invalidateSize(), 60);
}

async function viewEatOut() {
  const [{ cuisines }, places, hd] = await Promise.all([loadEatout(), db.all('places'), halalData()]);
  const f = local.get('eoF', []), q = (state.eoQ || '').trim().toLowerCase(), here = local.get('lastLoc', null);
  const rem = f.includes('fits') ? await leftToday() : null;
  const hit = (...xs) => !q || xs.some(x => (x || '').toLowerCase().includes(q));
  const ps = places.filter(p => hit(p.name, p.city, p.cuisine))
    .sort((a, b) => (b.halal?.status === 'full') - (a.halal?.status === 'full') || a.name.localeCompare(b.name));
  const cs = cuisines.filter(c => !q || hit(c.name) || new RegExp(c.match, 'i').test(q));
  // Halal places: search hits by name or town, else the closest restaurants.
  const pool = hd.all.filter(p => !p.guide);
  const near = q.length >= 3 ? pool.filter(p => hit(p.n, p.c)).sort((a, b) => (here ? miles(here, a) - miles(here, b) : 0)).slice(0, 8)
    : here ? pool.filter(p => p.k === 'r').map(p => [miles(here, p), p]).filter(([d]) => d < 40).sort((a, b) => a[0] - b[0]).slice(0, 5).map(x => x[1]) : [];
  state.eo = { ps, cs, rem, near };
  const best = (orders, hp) => eoOrders(orders, f, rem, hp)[0];
  const placeRow = (p, i) => { const b = best(p.orders, ['full', 'partial'].includes(p.halal?.status)); return `<li class="food place" data-p="${i}"><div class="grow">
    <div class="r1"><span class="name">${esc(p.name)}</span><span class="muted">${esc(p.price || '')}</span></div>
    <div class="r2"><span class="sub">${esc([p.city, cuisines.find(c => c.id === p.cuisine)?.name || p.cuisine].filter(Boolean).join(' · '))}</span></div>
    <div class="why">${halalBadges(p.halal)}</div>
    ${b ? `<div class="bc">Best: ${esc(b.name)} · <b class="kc">${kcalOf(b.n)}</b> kcal · ${macroLine(b.n)}</div>` : ''}</div></li>`; };
  const cuisineRow = (c, i) => { const b = best(c.orders); return `<li class="food cuisine" data-c="${i}"><div class="grow">
    <div class="r1"><span class="name">${esc(c.name)}</span><span class="chev">›</span></div>
    ${b ? `<div class="bc">${esc(b.name)} · <b class="kc">${kcalOf(b.n)}</b> kcal · ${macroLine(b.n)}</div>` : '<div class="bc muted">Nothing matches your filters.</div>'}</div></li>`; };
  const nCert = hd.all.filter(p => halalLevel(p).lv === 'cert').length;
  return `<div class="row eoq"><input id="eoQ" type="search" placeholder="Restaurant, town or cuisine" value="${esc(state.eoQ || '')}" enterkeyhint="search"><button class="primary" id="eoAsk">Ask Claude</button></div>
    <div class="chips" id="eoChips">${EO_CHIPS.map(([k, l]) => `<button data-c="${k}" class="${f.includes(k) ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${rem ? `<p class="hint">Left today: <b>${r0(rem.kcal)}</b> kcal · ${macroLine(rem)}</p>` : ''}
    <button class="mapcard" id="eoMap">${ico('map')}<div class="grow"><div class="name">Halal map</div><div class="sub">${hd.all.length ? `${hd.all.length.toLocaleString()} US places${nCert ? ` · ${nCert} HMS certified` : ''}` : 'Loads after your next sync'}</div></div><span class="chev">›</span></button>
    ${near.length ? `<h4 class="eoh">${q.length >= 3 ? 'Halal places' : 'Halal near you'}</h4><ul class="list card ideas">${near.map((p, i) => hpRow(p, i, here)).join('')}</ul>`
      : !here && !q ? `<button class="wide" id="eoLoc">${ico('locate')}Show halal places near me</button>` : ''}
    ${ps.length ? `<h4 class="eoh">Your guides</h4><ul class="list card ideas">${ps.map(placeRow).join('')}</ul>` : ''}
    ${cs.length ? `<h4 class="eoh">Any place, by cuisine</h4><ul class="list card ideas">${cs.map(cuisineRow).join('')}</ul>` : ''}
    ${!ps.length && !cs.length && !near.length && q ? `<p class="muted pad">Nothing saved for “${esc(state.eoQ)}” yet. Ask Claude and it'll research the menu and halal status.</p>` : ''}
    <button class="wide" id="eoPhoto">${ico('camera')}Order from a menu photo</button>
    <p class="muted small">Published = the chain's own nutrition data; Estimate = portions guessed from the menu, usually within ~15%. Halal labels say where they come from: HMS certifies hand-slaughtered meat; open map data only says a place serves halal. Always confirm in person.</p>`;
}
bind.eatout = root => {
  liveSearch(root, '#eoQ', 'eoQ');
  $$('#eoChips button', root).forEach(b => (b.onclick = () => {
    const f = new Set(local.get('eoF', [])); f.has(b.dataset.c) ? f.delete(b.dataset.c) : f.add(b.dataset.c); local.set('eoF', [...f]); render();
  }));
  $('#eoAsk', root).onclick = () => openAsk({ place: $('#eoQ', root).value.trim() });
  $('#eoPhoto', root).onclick = () => openAsk({ place: $('#eoQ', root).value.trim(), photo: true });
  $('#eoMap', root).onclick = () => openMap();
  $('#eoLoc', root)?.addEventListener('click', async () => { if (await getLoc()) render(); else toast('Location is off for this app'); });
  $$('li.place', root).forEach(li => (li.onclick = () => openPlace(state.eo.ps[+li.dataset.p])));
  $$('li.cuisine', root).forEach(li => (li.onclick = () => openCuisine(state.eo.cs[+li.dataset.c])));
  $$('li.hp', root).forEach(li => (li.onclick = () => openHalal(state.eo.near[+li.dataset.h])));
};

function logOrder(where, o) {
  openPortion({ name: `${o.name} (${where})`, n: o.n, units: [{ label: 'order', mult: 1 }], source: 'recipe', srcLabel: 'Eat out' }, { meal: defaultMeal() });
}
function openPlace(p) {
  const f = local.get('eoF', []), hp = ['full', 'partial'].includes(p.halal?.status);
  const orders = eoOrders(p.orders, f.filter(k => k !== 'fits'), null, hp), h = p.halal || {};
  const b = sheet(`<p class="sub">${esc([p.address, p.city, p.price].filter(Boolean).join(' · '))}</p>
    <div class="halalbox"><div>${halalBadges(h)}</div>${h.summary ? `<p class="small">${esc(h.summary)}</p>` : ''}
      ${h.source ? `<p class="small muted">Source: <a href="${esc(h.source)}" target="_blank" rel="noopener">${esc(new URL(h.source).hostname.replace('www.', ''))}</a>${h.checked ? ' · checked ' + esc(fmtDate(h.checked)) : ''}</p>` : ''}</div>
    <h4>Best orders${p.nutrition === 'published' ? '' : ' (estimates)'}</h4>
    <ul class="list">${orders.map((o, i) => orderRow(o, i, hp)).join('') || '<li class="empty small">Nothing matches your Veg / Fish filters here.</li>'}</ul>
    ${p.note ? `<p class="muted small">${esc(p.note)}</p>` : ''}
    ${p.avoid ? `<p class="small halal"><b>Skip:</b> ${esc(p.avoid)}</p>` : ''}
    <div class="actions">${p.menu ? `<a class="btn" href="${esc(p.menu)}" target="_blank" rel="noopener">Menu</a>` : ''}<button class="primary" id="pAsk">Ask Claude about it</button></div>
    <p class="muted small">Tap an order to log it.</p>`, { title: p.name });
  $$('li.eo', b).forEach(li => (li.onclick = () => logOrder(p.name, orders[+li.dataset.o])));
  $('#pAsk', b).onclick = () => openAsk({ place: `${p.name}, ${p.city}` });
}
function openCuisine(c) {
  const f = local.get('eoF', []), orders = eoOrders(c.orders, f.filter(k => k !== 'fits'), null, null);
  const b = sheet(`<ul class="tips">${c.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    ${c.halal ? `<p class="small halal">${esc(c.halal)}</p>` : ''}
    <h4>What to order</h4><ul class="list">${orders.map((o, i) => orderRow(o, i, null)).join('') || '<li class="empty small">Nothing matches your Veg / Fish filters.</li>'}</ul>
    <div class="actions"><button class="primary" id="cAsk">Ask Claude about a specific place</button></div>
    <p class="muted small">Tap an order to log it. Numbers are estimates for a typical restaurant portion.</p>`, { title: c.name });
  $$('li.eo', b).forEach(li => (li.onclick = () => logOrder(c.name, orders[+li.dataset.o])));
  $('#cAsk', b).onclick = () => openAsk({ place: '', cuisine: c.name });
}

// Macros for the prompt; once over, say so instead of sending negative numbers.
function askMacros(rem) {
  const amt = (v, u, what) => `${r0(Math.abs(v))}${u} ${what} ${v < 0 ? 'over' : 'left'}`;
  const line = `Today so far: ${[amt(rem.kcal, ' kcal', 'calories'), amt(rem.p, ' g', 'protein'), amt(rem.c, ' g', 'carbs'), amt(rem.f, ' g', 'fat')].join(', ')}.`;
  return line + (outOfKcal(rem) ? " I'm already at or over my calories, so I want the lightest, leanest high-protein option (or tell me to skip it)." : ' I want high protein for the calories.');
}

// Hands the question to Claude (free on your plan) with macros left and halal rules filled in.
async function openAsk({ place = '', cuisine = '', photo = false, near = false } = {}) {
  const rem = await leftToday(), f = local.get('eoF', []);
  const where = place || (cuisine ? `a ${cuisine} restaurant` : '');
  const b = sheet(`<label>${near ? 'Area' : 'Restaurant (name + town)'}<input id="aPlace" value="${esc(near ? '' : place)}" placeholder="${near ? 'Using your location' : cuisine ? `${cuisine} place in…` : 'e.g. Penn Pide, State College'}"></label>
    ${photo ? '<p class="hint">Open Claude copies this prompt and opens a new chat: paste it, attach your menu photo or screenshot, then send.</p>' : ''}
    <label>Prompt<textarea id="aText" rows="9"></textarea></label>
    <div class="actions"><button id="aCopy">Copy</button><button class="primary" id="aGo">Open Claude</button></div>
    <p class="muted small">Opens a Claude chat, which is included in your plan. For the full research (saved to this app), send it in your project instead.</p>`, { title: near ? 'Halal near me' : photo ? 'Menu photo' : 'Ask Claude' });
  const loc = near && navigator.geolocation ? await new Promise(res => navigator.geolocation.getCurrentPosition(p => res(`${p.coords.latitude.toFixed(3)}, ${p.coords.longitude.toFixed(3)}`), () => res(''), { timeout: 8000 })) : '';
  const build = () => {
    const w = $('#aPlace', b).value.trim() || (near ? '' : where);
    const diet = [f.includes('veg') && 'vegetarian', f.includes('fish') && 'fish/seafood'].filter(Boolean);
    return [
      near ? `Find halal restaurants near ${w || loc || 'me'}. For each: fully vs partly halal, certifier, hand vs machine slaughter (say "unconfirmed" if no source says), alcohol served, and the source (Zabihah, HMS, HFSAA, the restaurant) with a link. Then the best macro-friendly order at each.`
        : `What should I order at ${w || 'this restaurant'}?${photo ? ' I attached a photo of the menu.' : ''}`,
      askMacros(rem),
      'I eat halal only: no pork, no alcohol (including mirin, sake, wine in sauces). If the meat isn\'t halal, give vegetarian or fish options instead. Show the halal status with sources: fully vs partly halal, certifier, hand vs machine slaughter, alcohol served.',
      diet.length ? `Prefer ${diet.join(' or ')} orders.` : '',
      'Give the 3 best orders with exact customizations to ask for, estimated calories / protein / carbs / fat (say whether it\'s from published nutrition or an estimate, and the portion you assumed), the price if you can find it, and what to skip.',
      'If you have my safaan-personal repo, follow .claude/skills/eat-out and save the guide to my app.',
    ].filter(Boolean).join('\n\n');
  };
  const t = $('#aText', b); t.value = build();
  $('#aPlace', b).oninput = () => (t.value = build());
  $('#aCopy', b).onclick = async () => { try { await navigator.clipboard.writeText(t.value); toast('Copied'); } catch { t.select(); } };
  $('#aGo', b).onclick = async () => {
    try { await navigator.clipboard.writeText(t.value); } catch {}
    // ?q= can auto-send, so for a photo just copy the prompt and let them attach first.
    if (photo) toast('Prompt copied: paste it in Claude and attach the photo');
    window.open('https://claude.ai/new' + (photo ? '' : '?q=' + encodeURIComponent(t.value)), '_blank', 'noopener');
  };
}

// ---------- Trends ----------
// Garmin-style: one metric at a time, a period you can page through, tap a bar for that day.
const TR_METRICS = [['kcal', 'Calories'], ['p', 'Protein'], ['weight', 'Weight'], ['steps', 'Steps'], ['sleep', 'Sleep']];
const TR_RANGES = [[7, '7d'], [28, '4w'], [91, '3m'], [182, '6m']];
const fmtLong = d => new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const fmtShort = d => new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const avgOf = a => { const v = a.filter(x => Number.isFinite(x) && x > 0); return v.length ? v.reduce((t, x) => t + x, 0) / v.length : NaN; };
async function trendData() {
  const s = state.s, range = TR_RANGES.some(r => r[0] === local.get('range')) ? local.get('range') : 28;
  const end = state.trEnd && state.trEnd < today() ? state.trEnd : today();
  const dates = Array.from({ length: range }, (_, i) => addDays(end, i - range + 1));
  const months = [...new Set(dates.map(monthOf))];
  const logs = (await Promise.all(months.map(m => db.all('log/' + m)))).flat();
  const garmin = Object.assign({}, ...(await Promise.all(months.map(m => sync.garminMonth(m).catch(() => ({ days: {} }))))).map(g => g.days || {}));
  const [weights, daysRec, manual] = await Promise.all([db.all('weights'), db.all('days'), db.all('exercises')]);
  const wBy = new Map(weights.map(w => [w.date, w.lb])), dtBy = new Map(daysRec.map(d => [d.id, d.dayType]));
  const rows = dates.map(d => {
    const t = N.entryTotals(logs.filter(e => e.date === d), s.caloriesFromMacros), gd = garmin[d];
    const runMi = (gd?.activities || []).filter(a => /run|track/.test(a.type || '')).reduce((x, a) => x + (a.distance || 0) / 1609.34, 0);
    return { date: d, ...t, goal: goalsFor(s, withManual(gd, d, manual), dtBy.get(d)), weight: wBy.get(d) ?? gd?.weightLb, steps: gd?.steps || 0, sleep: gd?.sleepSec ? gd.sleepSec / 3600 : NaN, runMi };
  });
  // 3m / 6m read as weeks, like Garmin's longer views.
  const weekly = range > 28;
  const pts = weekly ? Array.from({ length: Math.ceil(range / 7) }, (_, k) => rows.slice(k * 7, k * 7 + 7)).map(w => ({
    date: w[0].date, end: w[w.length - 1].date, days: w, kcal: avgOf(w.map(r => r.kcal)), p: avgOf(w.map(r => r.kcal > 0 ? r.p : NaN)),
    goal: { kcal: avgOf(w.map(r => r.goal.kcal)), p: avgOf(w.map(r => r.goal.p)) }, weight: avgOf(w.map(r => r.weight)),
    steps: avgOf(w.map(r => r.steps)), sleep: avgOf(w.map(r => r.sleep)), runMi: w.reduce((t, r) => t + r.runMi, 0),
  })) : rows.map(r => ({ ...r, end: r.date }));
  return { range, end, rows, pts, weekly };
}
function trendMetric(m, { rows, pts, weekly }) {
  const logged = rows.filter(r => r.kcal > 0), n0 = v => (Number.isFinite(v) ? v : 0);
  const row = (k, v) => `<div class="tsum"><span>${k}</span><b>${v}</b></div>`;
  if (m === 'kcal' || m === 'p') {
    const unit = m === 'kcal' ? ' kcal' : ' g', vals = pts.map(p => n0(m === 'kcal' ? p.kcal : p.kcal > 0 ? p.p : 0)), goals = pts.map(p => p.goal[m]);
    const hit = m === 'kcal' ? logged.filter(r => Math.abs(r.kcal - r.goal.kcal) <= r.goal.kcal * 0.1).length : logged.filter(r => r.p >= r.goal.p * 0.9).length;
    return { chart: bars(pts.map(p => p.date), vals, goals, { title: m, cls: m === 'p' ? 'p' : '', id: 'trend' }),
      tip: i => vals[i] ? `<b>${r0(vals[i])}</b>${unit} <span class="muted">/ ${r0(goals[i])} goal${weekly ? ', daily avg' : ''}</span>` : `<span class="muted">${weekly ? 'Nothing logged' : 'Not logged'}</span>`,
      sum: row(`Avg ${m === 'kcal' ? 'eaten' : 'protein'} (logged days)`, logged.length ? r0(avgOf(logged.map(r => r[m]))) + unit : '–') +
        row('Avg goal', r0(avgOf(logged.map(r => r.goal[m]))) + unit) + row(m === 'kcal' ? 'Days within 10% of goal' : 'Days at 90%+ of goal', `${hit} of ${logged.length}`) + row('Days logged', `${logged.length} of ${rows.length}`) };
  }
  if (m === 'weight') {
    const w = pts.map(p => (Number.isFinite(p.weight) ? p.weight : NaN)), wt = ema(w);
    const first = wt.find(Number.isFinite), last = [...wt].reverse().find(Number.isFinite), tdee = measuredTdee(rows.map(r => ({ kcal: r.kcal, weight: r.weight })));
    return { chart: w.some(Number.isFinite) ? line(pts.map(p => p.date), w, { trend: wt, title: 'Weight', fmt: r1, id: 'trend' }) : '<p class="muted">Log weight on Today (Garmin scale weigh-ins show up too).</p>',
      tip: i => Number.isFinite(w[i]) ? `<b>${r1(w[i])}</b> lb <span class="muted">· trend ${r1(wt[i])}</span>` : '<span class="muted">No weigh-in</span>',
      sum: row('Trend now', last != null ? r1(last) + ' lb' : '–') + row('Change this period', first != null ? (last - first >= 0 ? '+' : '') + r1(last - first) + ' lb' : '–') +
        row('Measured TDEE', tdee ? r0(tdee) + ' kcal' : 'needs 14+ logged days') };
  }
  if (m === 'steps') {
    const vals = pts.map(p => n0(p.steps)), days = rows.filter(r => r.steps);
    return { chart: bars(pts.map(p => p.date), vals, null, { title: 'Steps', cls: 'steps', id: 'trend' }),
      tip: i => vals[i] ? `<b>${r0(vals[i]).toLocaleString()}</b> steps${weekly ? ' <span class="muted">daily avg</span>' : ''}` : '<span class="muted">No data</span>',
      sum: row('Daily average', days.length ? r0(avgOf(days.map(r => r.steps))).toLocaleString() : '–') +
        row('Best day', days.length ? (b => `${b.steps.toLocaleString()} · ${fmtShort(b.date)}`)(days.reduce((a, r) => (r.steps > a.steps ? r : a))) : '–') + row('Days over 10k', `${days.filter(r => r.steps >= 10000).length} of ${days.length}`) };
  }
  const vals = pts.map(p => n0(p.sleep)), nights = rows.filter(r => Number.isFinite(r.sleep));
  return { chart: nights.length ? bars(pts.map(p => p.date), vals, null, { title: 'Sleep', cls: 'sleep', id: 'trend' }) : '<p class="muted">No sleep data from Garmin in this period.</p>',
    tip: i => vals[i] ? `<b>${r1(vals[i])}</b> h${weekly ? ' <span class="muted">nightly avg</span>' : ''}` : '<span class="muted">No data</span>',
    sum: row('Average', nights.length ? r1(avgOf(nights.map(r => r.sleep))) + ' h' : '–') +
      row('Shortest', nights.length ? (b => `${r1(b.sleep)} h · ${fmtShort(b.date)}`)(nights.reduce((a, r) => (r.sleep < a.sleep ? r : a))) : '–') + row('Nights under 7 h', `${nights.filter(r => r.sleep < 7).length} of ${nights.length}`) };
}
async function viewTrends() {
  const d = await trendData(), metric = local.get('trMetric', 'kcal'), M = trendMetric(metric, d);
  state.trend = { d, M };
  const { pts, weekly, range, end } = d;
  // Day (or week) list, newest first; tap opens it.
  const list = [...pts].reverse().map((p, k) => {
    const i = pts.length - 1 - k, kc = weekly ? p.kcal : p.kcal || NaN;
    const sub = [Number.isFinite(kc) && kc > 0 ? `${r0(kc)} / ${r0(p.goal.kcal)} kcal` : 'not logged', Number.isFinite(p.p) && p.kcal > 0 ? `P ${r0(p.p)}` : '',
      p.steps ? `${r0(p.steps).toLocaleString()} steps` : '', p.runMi >= 0.5 ? `${r1(p.runMi)} mi` : ''].filter(Boolean).join(' · ');
    const over = Number.isFinite(kc) && kc > p.goal.kcal * 1.1, ok = Number.isFinite(kc) && Math.abs(kc - p.goal.kcal) <= p.goal.kcal * 0.1;
    return `<li data-i="${i}" ${k >= 7 && !state.trAll ? 'hidden' : ''}><span class="dot2 ${over ? 'over' : ok ? 'ok' : Number.isFinite(kc) && kc > 0 ? 'under' : ''}"></span><div class="grow"><div class="name">${weekly ? `${fmtShort(p.date)} – ${fmtShort(p.end)}` : fmtLong(p.date)}</div><div class="sub">${sub}</div></div>${ico('next')}</li>`;
  }).join('');
  return `<div class="seg" id="range">${TR_RANGES.map(([n, l]) => `<button data-n="${n}" class="${n === range ? 'on' : ''}">${l}</button>`).join('')}</div>
  <div class="pnav"><button id="trPrev" aria-label="Earlier">${ico('prev')}</button><b>${fmtShort(d.rows[0].date)} – ${fmtShort(end)}</b><button id="trNext" aria-label="Later" ${end >= today() ? 'disabled' : ''}>${ico('next')}</button></div>
  <div class="mtabs" id="trMetric">${TR_METRICS.map(([k, l]) => `<button data-m="${k}" class="${k === metric ? 'on' : ''}">${l}</button>`).join('')}</div>
  <section class="card tchart"><div class="tipbox" id="trTip"><span class="muted">Tap a ${weekly ? 'week' : 'day'} to see it</span></div>${M.chart}<div class="tsums">${M.sum}</div></section>
  <section class="card daylist"><h3>${weekly ? 'Weeks' : 'Days'}</h3><ul class="entries" id="trDays">${list}</ul>${pts.length > 7 && !state.trAll ? `<button class="link more" id="trAll">Show all ${pts.length}</button>` : ''}</section>`;
}
bind.trends = root => {
  const { d, M } = state.trend;
  const open = i => {
    const p = d.pts[i];
    if (d.weekly) { local.set('range', 7); state.trEnd = p.end; return render(); }
    state.date = p.date; state.tab = 'today'; render();
  };
  $$('#range button', root).forEach(b => (b.onclick = () => { local.set('range', +b.dataset.n); render(); }));
  $$('#trMetric button', root).forEach(b => (b.onclick = () => { local.set('trMetric', b.dataset.m); render(); }));
  $('#trPrev', root).onclick = () => { state.trEnd = addDays(d.end, -d.range); render(); };
  $('#trNext', root).onclick = () => { const e = addDays(d.end, d.range); state.trEnd = e >= today() ? null : e; render(); };
  bindCharts(root, (id, i) => {
    const p = d.pts[i];
    $('#trTip', root).innerHTML = `<div class="grow"><div class="tl">${d.weekly ? `${fmtShort(p.date)} – ${fmtShort(p.end)}` : fmtLong(p.date)}</div><div>${M.tip(i)}</div></div>
      <button class="link" id="trOpen">${d.weekly ? 'See days' : 'Open day'} ${ico('next')}</button>`;
    $('#trOpen', root).onclick = () => open(i);
  });
  $$('#trDays li', root).forEach(li => (li.onclick = () => open(+li.dataset.i)));
  if ($('#trAll', root)) $('#trAll', root).onclick = () => { state.trAll = true; render(); };
};

// ---------- Settings ----------
async function viewSettings() {
  const s = state.s, p = s.profile;
  const meta = await sync.garminMeta().catch(() => null);
  const dt = (k) => {
    const d = s.dayTypes[k], g = N.goalGrams(d), mk = r0(4 * g.p + 4 * g.c + 9 * g.f);
    return `<fieldset data-dt="${k}" class="dt-${k}"><legend>${k === 'rest' ? 'Base day' : esc(d.label) + ' day'}</legend>
      <div class="grid2"><label>Calories<input name="kcal" type="number" min="0" inputmode="numeric" value="${d.kcal}"></label>
      <label>Macros by<select name="mode"><option value="g" ${d.mode === 'g' ? 'selected' : ''}>grams</option><option value="%" ${d.mode === '%' ? 'selected' : ''}>percent</option></select></label></div>
      <div class="grid3"><label class="lc">Carbs ${d.mode === '%' ? '%' : 'g'}<input class="ic" name="c" type="number" step="any" inputmode="decimal" value="${d.c}"></label>
      <label class="lp">Protein ${d.mode === '%' ? '%' : 'g'}<input class="ip" name="p" type="number" step="any" inputmode="decimal" value="${d.p}"></label>
      <label class="lf">Fat ${d.mode === '%' ? '%' : 'g'}<input class="if" name="f" type="number" step="any" inputmode="decimal" value="${d.f}"></label></div>
      ${macroSplit(g)}
      <p class="small ${Math.abs(mk - d.kcal) > 30 ? 'warn' : 'muted'}">Macros add up to ${mk} kcal${Math.abs(mk - d.kcal) > 30 ? ` (calorie goal is ${d.kcal})` : ''}.</p></fieldset>`;
  };
  return `
  <section class="card"><h3>🎯 Daily goals</h3>
    <p class="hint">Set your base day (no exercise). Each day the app adds what you actually burned from Garmin or manual exercise, so a hard 9.5 mi run, a lift, or an hour of basketball all count, mostly as extra carbs. Big days (over ~500 exercise kcal) also get up to half your deficit back for recovery.</p>
    <button id="calc" class="primary wide">Recommend from my stats</button>
    <form id="dts">${dt('rest')}</form>
    <form id="fuel" class="form"><label>Exercise calories to eat back (%)<input name="fuelPct" type="number" min="0" max="150" step="5" inputmode="numeric" value="${s.fuelPct ?? 100}"></label>
      <label class="check"><input type="checkbox" name="weekBudget" ${s.weekBudget !== false ? 'checked' : ''}> Weekly budget: spread big overs and unders across the rest of the week (Mon–Sun, max 250 kcal a day, never on long run, workout or race-week days)</label></form>
  </section>
  <section class="card"><h3>👤 Profile</h3><form id="prof" class="form">
    <div class="grid3"><label>Sex<select name="sex"><option value="male" ${p.sex === 'male' ? 'selected' : ''}>male</option><option value="female" ${p.sex === 'female' ? 'selected' : ''}>female</option></select></label>
    <label>Age<input name="age" type="number" value="${p.age}"></label><label>Height in<input name="heightIn" type="number" step="0.5" value="${p.heightIn}"></label></div>
    <div class="grid3"><label>Weight lb<input name="weightLb" type="number" step="0.1" value="${p.weightLb}"></label>
    <label>Goal<select name="goal"><option value="cut" ${s.goal.type === 'cut' ? 'selected' : ''}>lose</option><option value="maintain" ${s.goal.type === 'maintain' ? 'selected' : ''}>maintain</option><option value="gain" ${s.goal.type === 'gain' ? 'selected' : ''}>gain</option></select></label>
    <label>lb / week<input name="rate" type="number" step="0.25" value="${s.goal.rateLbWk}"></label></div>
    <label>Daily movement outside workouts<select name="neat">${[[1.2, 'desk job, little walking'], [1.3, 'some walking'], [1.4, 'on your feet a lot'], [1.5, 'physical job']].map(([v, l]) => `<option value="${v}" ${+p.neat === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
  </form></section>
  <section class="card more"><h3>⚙️ More settings</h3>
  <details><summary>Tracking options</summary><form id="opts" class="form">
    <label class="check"><input type="checkbox" name="caloriesFromMacros" ${s.caloriesFromMacros ? 'checked' : ''}> Count calories from macros (4/4/9). Keeps totals consistent when labels disagree.</label>
    <label class="check"><input type="checkbox" name="netCarbs" ${s.netCarbs ? 'checked' : ''}> Show net carbs (carbs − fiber)</label>
    <label>Meals (one name = a single running list for the day; commas = separate meals)<input name="meals" value="${esc(s.meals.join(', '))}"></label>
  </form></details>
  <details><summary>Sync & Garmin</summary><form id="gh" class="form">
    <label>GitHub token<input name="ghToken" type="password" autocomplete="off" value="${esc(local.get('ghToken', ''))}" placeholder="fine-grained token"></label>
    <div class="grid2"><label>Repo<input name="ghRepo" value="${esc(local.get('ghRepo', 'safaangit/safaan-personal'))}"></label><label>Branch<input name="ghBranch" value="${esc(local.get('ghBranch', ''))}" placeholder="repo default"></label></div>
    <p class="muted small">Food logs sync to <code>data/fuel/</code>. Garmin data comes from the nightly workflow into <code>data/garmin/</code>${meta?.lastSync ? `, last pulled ${new Date(meta.lastSync).toLocaleString()}${meta.backfillDone ? '' : ` (history back to ${meta.earliest || '…'}, still backfilling)`}` : ''}.</p>
    <div class="actions"><button type="button" id="syncNow">Sync now</button><button type="button" id="pullG" ${s.garminPulledOn === today() ? 'disabled' : ''}>${s.garminPulledOn === today() ? 'Pulled Garmin today' : 'Pull Garmin now (1/day)'}</button></div>
  </form></details>
  <details><summary>Food data & keys</summary><form id="keys" class="form">
    <label>USDA API key (free at api.data.gov)<input name="usdaKey" autocomplete="off" value="${esc(local.get('usdaKey', ''))}" placeholder="DEMO_KEY is rate-limited"></label>
    <details><summary class="small">Optional: Claude API label reader (paid, not covered by Pro)</summary>
    <label>Anthropic API key<input name="anthropicKey" type="password" autocomplete="off" value="${esc(local.get('anthropicKey', ''))}" placeholder="leave empty to stay free"></label>
    <label>Claude model<input name="claudeModel" value="${esc(local.get('claudeModel', 'claude-opus-5-5'))}"></label></details>
    <p class="muted small">Keys stay on this phone and never sync to GitHub. With no Anthropic key, nothing here can cost money.</p>
  </form></details>
  <details><summary>Export data</summary><div class="actions"><button id="export">Export everything (JSON)</button></div></details>
  </section>`;
}
// Grams + kcal per macro next to a donut of the calorie split, like Macros' goal screen.
// Calorie split ring (C / P / F) with percentages, like Macros.
function donutSvg(g) {
  const k = { c: (g.c || 0) * 4, p: (g.p || 0) * 4, f: (g.f || 0) * 9 }, t = k.c + k.p + k.f || 1;
  let a0 = -Math.PI / 2;
  const arc = x => {
    const frac = k[x] / t; if (frac <= 0) return '';
    const a1 = a0 + frac * 2 * Math.PI, R = 40, r = 18, big = frac > 0.5 ? 1 : 0, P = (rad, a) => `${50 + rad * Math.cos(a)} ${50 + rad * Math.sin(a)}`;
    const mid = (a0 + a1) / 2, d = frac >= 0.999 ? `M ${P(R, 0)} A ${R} ${R} 0 1 1 ${P(R, Math.PI)} A ${R} ${R} 0 1 1 ${P(R, 0)} Z` :
      `M ${P(R, a0)} A ${R} ${R} 0 ${big} 1 ${P(R, a1)} L ${P(r, a1)} A ${r} ${r} 0 ${big} 0 ${P(r, a0)} Z`;
    const out = `<path d="${d}" class="${x}"/>${frac >= 0.08 ? `<text x="${50 + 29 * Math.cos(mid)}" y="${50 + 29 * Math.sin(mid) + 4}" text-anchor="middle">${Math.round(frac * 100)}</text>` : ''}`;
    a0 = a1; return out;
  };
  return `<svg viewBox="0 0 100 100" class="donut" role="img" aria-label="Calorie split">${['c', 'p', 'f'].map(arc).join('')}</svg>`;
}
function macroSplit(g) {
  const k = { c: g.c * 4, p: g.p * 4, f: g.f * 9 };
  const col = (x, l) => `<div class="${x}"><div>${l}</div><b>${r0(g[x])} g</b><span>${r0(k[x])} kcal</span></div>`;
  return `<div class="msplit"><div class="mcols3">${col('c', 'Carbs')}${col('p', 'Protein')}${col('f', 'Fat')}</div>${donutSvg(g)}</div>`;
}
bind.settings = root => {
  const s = state.s;
  $('#dts', root).onchange = async () => {
    for (const fs of $$('fieldset[data-dt]', root)) {
      const k = fs.dataset.dt, val = n => +$(`[name=${n}]`, fs).value || 0;
      const mode = $('[name=mode]', fs).value, d = s.dayTypes[k];
      if (mode !== d.mode) { // convert so the numbers keep meaning the same thing
        const g = N.goalGrams(d);
        Object.assign(d, mode === '%' ? { p: r0((g.p * 400) / d.kcal), c: r0((g.c * 400) / d.kcal), f: r0((g.f * 900) / d.kcal) } : { p: r0(g.p), c: r0(g.c), f: r0(g.f) }, { mode });
      } else Object.assign(d, { kcal: val('kcal'), p: val('p'), c: val('c'), f: val('f') });
    }
    await db.saveSettings(s); render();
  };
  $('#fuel', root).onchange = async e => {
    const f = new FormData(e.currentTarget);
    Object.assign(s, { fuelPct: Math.max(0, +f.get('fuelPct') || 0), weekBudget: f.get('weekBudget') === 'on' });
    await db.saveSettings(s); toast('Saved');
  };
  $('#prof', root).onchange = async e => {
    const f = Object.fromEntries(new FormData(e.currentTarget));
    s.profile = { sex: f.sex, age: +f.age, heightIn: +f.heightIn, weightLb: +f.weightLb, neat: +f.neat };
    s.goal = { type: f.goal, rateLbWk: +f.rate };
    await db.saveSettings(s); toast('Profile saved');
  };
  $('#opts', root).onchange = async e => {
    const f = new FormData(e.currentTarget);
    Object.assign(s, { caloriesFromMacros: f.get('caloriesFromMacros') === 'on', netCarbs: f.get('netCarbs') === 'on',
      meals: String(f.get('meals')).split(',').map(x => x.trim()).filter(Boolean) });
    if (!s.meals.length) s.meals = ['Meal 1'];
    await db.saveSettings(s); toast('Saved');
  };
  $('#gh', root).onchange = e => { for (const [k, v] of new FormData(e.currentTarget)) local.set(k, String(v).trim()); syncBadge(); };
  $('#keys', root).onchange = e => { for (const [k, v] of new FormData(e.currentTarget)) local.set(k, String(v).trim()); toast('Saved on this device'); };
  $('#syncNow', root).onclick = async () => {
    for (const [k, v] of new FormData($('#gh', root))) local.set(k, String(v).trim()); // pasted but not yet blurred
    if (!sync.configured()) return toast('Paste your GitHub token first');
    syncBadge('syncing…');
    try { const r = await sync.sync(); syncErr = null; syncBadge(); toast(`Synced ✓ ${r.pulled ? `pulled ${r.pulled} file(s)` : 'token works'}`); render(); }
    catch (e) { syncErr = e.message; syncBadge(); toast(e.message); }
  };
  $('#pullG', root).onclick = async () => {
    // Capped at one manual pull a day (synced, so it holds across devices); auto runs at 8am and 8pm.
    if (s.garminPulledOn === today()) return toast('Already pulled today. Next auto sync is 8am or 8pm.');
    try { await sync.runGarminSync(); s.garminPulledOn = today(); await db.saveSettings(s); toast('Garmin sync started. Data lands in a few minutes.'); render(); }
    catch (e) { toast(e.status === 403 ? 'Token needs Actions: read & write' : e.message); }
  };
  $('#calc', root).onclick = () => openRecommend();
  $('#export', root).onclick = async () => {
    const out = {};
    for (const k of await db.kv.keys()) if (String(k).startsWith('f:')) out[k.slice(2)] = await db.kv.get(k);
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' })), download: `baros-biryani-export-${today()}.json` });
    a.click();
  };
};

async function openRecommend() {
  const s = state.s;
  // Use the last 60 days of Garmin + logs to personalize.
  const dates = Array.from({ length: 60 }, (_, i) => addDays(today(), -i - 1)).reverse();
  const months = [...new Set(dates.map(monthOf))];
  const garmin = Object.assign({}, ...(await Promise.all(months.map(m => sync.garminMonth(m).catch(() => ({ days: {} }))))).map(g => g.days || {}));
  const logs = (await Promise.all(months.map(m => db.all('log/' + m)))).flat();
  const wBy = new Map((await db.all('weights')).map(w => [w.date, w.lb]));
  const exK = d => (garmin[d]?.activities || []).reduce((t, a) => t + (a.kcal || 0), 0);
  const runD = dates.filter(d => autoDayType(garmin[d], s) === 'run'), longD = dates.filter(d => autoDayType(garmin[d], s) === 'long');
  const mean = a => (a.length ? Math.round(a.reduce((t, x) => t + x, 0) / a.length) : undefined);
  const tdee = measuredTdee(dates.map(d => ({ kcal: N.entryTotals(logs.filter(e => e.date === d), s.caloriesFromMacros).kcal, weight: wBy.get(d) ?? garmin[d]?.weightLb })));
  const rec = recommend(s, { avgRunKcal: mean(runD.map(exK)), avgLongKcal: mean(longD.map(exK)), measuredTdee: tdee });
  const row = k => `<tr><th>${rec[k].label}</th><td>${rec[k].kcal}</td><td>${rec[k].c}</td><td>${rec[k].p}</td><td>${rec[k].f}</td></tr>`;
  const b = sheet(`<p class="small muted">Based on ${rec.basis}${runD.length ? `, ${runD.length} run days and ${longD.length} long runs from Garmin` : ''}. Protein ${s.goal.type === 'cut' ? '1.0' : '0.85'} g/lb, fat at least 0.3 g/lb or 25%, carbs fill the rest and rise with mileage.</p>
    <table class="tbl"><tr><th></th><th>kcal</th><th>C</th><th>P</th><th>F</th></tr>${row('rest')}</table>
    <p class="small muted">That's your base day. Exercise days add what Garmin says you burned on top.</p>
    <p class="small muted">Check the numbers against how you feel and train.</p>
    <div class="actions"><button class="primary" id="apply">Apply these goals</button></div>`, { title: 'Recommended goals' });
  $('#apply', b).onclick = async () => {
    for (const k of ['rest', 'run', 'long']) s.dayTypes[k] = rec[k];
    await db.saveSettings(s); closeSheet(); toast('Goals updated'); render();
  };
}

// ---------- boot ----------
// Helpers the Training tab module borrows.
const ui = { $, $$, esc, ico, sheet, closeSheet, toast, render, goDay: d => { state.date = d; state.tab = 'today'; render(); } };
$$('nav button').forEach(b => b.insertAdjacentHTML('afterbegin', ico(b.dataset.tab)));
$('#gear').innerHTML = ico('settings');
$('#trendsBtn').innerHTML = ico('trends');
$('#trendsBtn').onclick = () => { state.tab = 'trends'; state.trEnd = null; state.trAll = false; render(); };
$('#gear').onclick = () => { state.tab = 'settings'; state.sel = state.fsel = null; render(); };
$$('nav button').forEach(b => (b.onclick = () => { if (b.dataset.tab === 'add') return openAdd(defaultMeal()); state.tab = b.dataset.tab; state.sel = state.fsel = null; render(); }));
function defaultMeal() {
  const h = new Date().getHours(), n = state.s?.meals.length || 1;
  return Math.min(n - 1, h < 15 ? 0 : h < 18 ? 1 : 2);
}
db.onChange(() => scheduleSync());
addEventListener('online', () => scheduleSync(500));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') return runSync();
  // Left open overnight: a diary that was on "Today" moves to the new day instead of logging into yesterday.
  if (state.today !== today()) { if (state.date === state.today) state.date = today(); state.today = today(); render(); }
  scheduleSync(500);
});
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
// Home-screen shortcuts (long-press the icon, or a Quick Tap / side-button action) open ?do=voice|add|scan.
async function launchAction() {
  const u = new URL(location.href), act = u.searchParams.get('do');
  if (!act) return;
  u.searchParams.delete('do'); history.replaceState(null, '', u.pathname + u.search + u.hash);
  if (state.tab !== 'today' || state.date !== today()) { state.tab = 'today'; state.date = today(); await render(); }
  if (act === 'voice') openVoice();
  else if (act === 'add') openAdd(defaultMeal());
  else if (act === 'scan') openScanner(defaultMeal());
}
render().then(() => { launchAction(); scheduleSync(300); });
