import * as db from './db.js';
import { today, monthOf, local } from './db.js';
import * as N from './nutrition.js';
import { r0, r1 } from './nutrition.js';
import * as food from './food.js';
import * as scan from './scan.js';
import * as sync from './sync.js';
import { goalsFor, recommend, measuredTdee, autoDayType } from './goals.js';
import { bars, line, ema } from './charts.js';
import * as voice from './voice.js';
import * as train from './trainview.js';

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
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  knee: '<path d="M12 2v8l-3 4v8M12 10l4 4v8"/><circle cx="12" cy="12" r="2.5"/>',
  pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
};
const ico = k => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;

const state = { date: today(), tab: local.get('tab', 'today'), s: null, sel: null };

// ---------- shell ----------
async function render() {
  state.s = await db.settings();
  local.set('tab', state.tab);
  if (state.tab === 'recipes') state.tab = 'foods';
  $$('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  const main = $('main');
  if (state.tab === 'recipes') state.tab = 'foods';
  const views = { today: viewToday, training: () => train.view(state.s, ui), trends: viewTrends, foods: viewFoods, settings: viewSettings };
  main.innerHTML = await views[state.tab]();
  document.body.classList.toggle('today', state.tab === 'today');
  $('#datenav').innerHTML = state.tab === 'today' ? `<button id="prev" aria-label="Previous day">${ico('prev')}</button><button id="dateLbl">${ico('cal')}${fmtDate(state.date)}</button><button id="next" aria-label="Next day">${ico('next')}</button>` : '';
  if (state.tab === 'training') train.bind(main, state.s, ui);
  bind[state.tab]?.(main);
  $('#gear').classList.toggle('on', state.tab === 'settings');
  syncBadge();
}
function syncBadge(msg) {
  const el = $('#sync');
  if (!sync.configured()) { el.textContent = 'local only'; el.className = ''; return; }
  if (msg) { el.textContent = msg; return; }
  const t = local.get('lastSync', 0);
  el.textContent = t ? '✓ ' + new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'not synced';
  el.className = '';
}
let syncTimer;
function scheduleSync(ms = 6000) { clearTimeout(syncTimer); syncTimer = setTimeout(runSync, ms); }
async function runSync() {
  if (!sync.configured()) return;
  syncBadge('syncing…');
  try { const r = await sync.sync(); syncBadge(); if (r.pulled) render(); }
  catch (e) { syncBadge('sync failed'); $('#sync').className = 'warn'; toast(e.message); }
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), Math.max(3500, msg.length * 70));
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
async function dayContext(date) {
  const [gday, dayRec, manual] = await Promise.all([sync.garminDay(date).catch(() => null), db.get('days', date), db.all('exercises')]);
  const mine = manual.filter(x => x.date === date).map(x => ({ ...x, manual: true, distance: (x.mi || 0) * 1609.34, type: x.run ? 'running' : 'other' }));
  const g = { ...(gday || {}), activities: [...(gday?.activities || []), ...mine] };
  return { gday, g, dayRec, goals: goalsFor(state.s, g, dayRec?.dayType) };
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
function foodRow(f, i, selState = null) {
  const p = food.preview(f);
  // Your own foods need no source tag; a verified one gets a check like Macros does.
  const badge = f.source === 'mine' ? '' : `<span class="badge src-${f.source}">${esc(f.srcLabel || f.source)}</span> `;
  const tick = f.source === 'mine' && f.verified ? ' <span class="badge ok">✓</span>' : '';
  return `<li class="food ${selState || ''}" data-i="${i}">${selState != null ? '<span class="box"></span>' : ''}<div class="grow">${row2(`${f.fav ? '★ ' : ''}${esc(f.name)}${tick}`, p.n,
    `${badge}${checkBadge(f.n)}${[f.brand, unitText(p.unit.label)].filter(Boolean).map(esc).join(', ')}`)}</div></li>`;
}

// ---------- Today ----------
async function viewToday() {
  const s = state.s, date = state.date;
  const [entries, ctx, weights] = await Promise.all([entriesFor(date), dayContext(date), db.all('weights')]);
  const { g, gday, goals } = ctx;
  const tot = N.entryTotals(entries, s.caloriesFromMacros);
  const carbs = s.netCarbs ? tot.c - tot.fib : tot.c;
  const left = goals.kcal - tot.kcal;
  const showLeft = local.get('kcalView', 'eaten') === 'left';
  const fill = (have, goal) => `<div class="track"><div style="width:${Math.min(100, (have / Math.max(1, goal)) * 100)}%" class="${have > goal * 1.08 ? 'over' : ''}"></div></div>`;
  const col = (k, label, have, goal) => `<div class="mcol ${k}"><div class="lbl">${label}</div>${fill(have, goal)}<div class="num">${r0(have)} / ${r0(goal)} g</div><div class="rem">${have > goal ? r0(have - goal) + ' g over' : r0(goal - have) + ' g left'}</div></div>`;
  const kbar = `<button class="kbar ${left < 0 ? 'over' : ''}" id="kcalBtn" aria-label="Toggle eaten / remaining">${fill(tot.kcal, goals.kcal)}
    <div class="num">${showLeft ? `<b>${r0(Math.abs(left))}</b> kcal ${left < 0 ? 'over' : 'left'}` : `<b>${r0(tot.kcal)}</b> / ${r0(goals.kcal)} kcal`}</div></button>`;
  const w = weights.find(x => x.date === date)?.lb ?? gday?.weightLb;

  const single = s.meals.length === 1, sel = state.sel;
  const preps = (await prepStatus()).map(x => `<button class="prepbtn" data-prep="${x.id}">${ico('plusc')}<span class="grow">${esc(x.name)}</span><span class="small">${x.left > 0 ? `${x.left} of ${x.total} left` : 'all eaten'} · ${kcalOf(x.n)} kcal</span></button>`).join('');
  const byMeal = s.meals.map((m, mi) => {
    const list = entries.filter(e => single || (e.meal ?? 0) === mi);
    const t = N.entryTotals(list, s.caloriesFromMacros), tc = s.netCarbs ? t.c - t.fib : t.c;
    // Stripe under the title shows this meal's calorie split, like Macros.
    const kc = { c: tc * 4, p: t.p * 4, f: t.f * 9 }, ks = kc.c + kc.p + kc.f;
    const stripe = `<div class="mstripe">${ks ? ['c', 'p', 'f'].map(k => `<div class="${k}" style="flex:${kc[k] / ks}"></div>`).join('') : '<div class="e"></div>'}</div>`;
    // With one running list the meal total is the day total, so show it against the goal.
    const mt = (k, v, goal, label) => `<div class="${k}"><b>${r0(v)}${single ? ' / ' + r0(goal) : ''}</b><span>${label}</span></div>`;
    return `<section class="card meal"><header><h3>${esc(single && /^food$/i.test(m) ? (date === today() ? 'Today meals' : 'Meals') : m)}</h3>
      ${list.length && !sel ? '<button class="link selBtn">Select</button>' : ''}</header>${stripe}
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
  const garmin = `<section class="card">
    <header><h3>Exercise</h3><span class="hkcal">${r0(burned)} kcal</span><button class="add" id="addEx" aria-label="Add exercise">${ico('plusc')}</button></header>
    ${gday ? `<div class="stats">
      ${stat('Steps', gday.steps?.toLocaleString(), '', 'steps')}${stat('Active kcal', gday.activeKcal && r0(gday.activeKcal), '', 'burn')}${stat('Sleep', gday.sleepSec ? r1(gday.sleepSec / 3600) + ' h' : null, gday.sleepScore ? 'score ' + gday.sleepScore : '', 'sleep')}
      ${stat('HRV', gday.hrv, gday.hrvStatus?.toLowerCase(), 'hrv')}${stat('Rest HR', gday.rhr, '', 'heart')}${stat('Readiness', gday.readiness, '', 'ready')}</div>` : `<p class="muted small">${sync.configured() ? 'No Garmin data for this day yet.' : 'Connect Garmin in Settings.'}</p>`}
    ${acts.length ? `<ul class="entries acts">${acts.map(a => `<li class="act ${actKind(a)}" ${a.manual ? `data-ex="${a.id}"` : ''}><span class="aicon">${ACT_ICON[actKind(a)]}</span><div class="grow"><div class="name">${esc(a.name)}</div><div class="qty">${[
      a.distance ? r1(a.distance / 1609.34) + ' mi' : '', a.duration ? Math.round(a.duration / 60) + ' min' : a.min ? a.min + ' min' : '',
      a.distance && a.duration ? pace(a.duration, a.distance) : '', a.avgHR ? a.avgHR + ' bpm' : '', a.manual ? 'manual' : ''].filter(Boolean).join(' · ')}</div></div><div class="kcol burn"><div class="kc">${r0(a.kcal)}</div><div class="kl">kcal</div></div></li>`).join('')}</ul>` : ''}</section>`;

  return `
  <section class="card summary">
    <div class="mcols">${col('c', s.netCarbs ? 'Net carbs' : 'Carbs', carbs, goals.c)}${col('p', 'Protein', tot.p, goals.p)}${col('f', 'Fat', tot.f, goals.f)}</div>
    ${kbar}
    ${date === today() && left > 50 ? `<button class="fitbtn" id="fitBtn">${ico('zap')}What fits my ${r0(left)} kcal left?</button>` : ''}
    <div class="sumfoot"><button class="chip" id="dayType" title="Tap to ignore or count exercise">${ico('pie')}${esc(goals.label)}${goals.auto ? '' : ' · set by you'}</button>
      <div class="goalline">Goal <b>${r0(goals.kcal)}</b>${goals.eatBack ? ` <span class="small">(+${goals.eatBack} exercise)</span>` : ''}</div></div>
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
  $('#kcalBtn', root).onclick = () => { local.set('kcalView', local.get('kcalView', 'eaten') === 'left' ? 'eaten' : 'left'); render(); };
  $$('.voiceBtn', root).forEach(b => (b.onclick = () => openVoice()));
  $$('.prepbtn', root).forEach(b => (b.onclick = async () => {
    const f = (await recipeFoods()).find(x => x.id === b.dataset.prep); if (!f) return;
    await logEntry({ name: f.name, recipeId: f.recipeId, qty: 1, unit: f.units[0].label, mult: 1, n: f.n, meal: 0 });
  }));
  $$('.selBtn', root).forEach(b => (b.onclick = () => { state.sel = new Set(); render(); }));
  $$('.meal li[data-id]', root).forEach(li => (li.onclick = async () => {
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
      <div class="grid3"><label>Miles<input name="mi" type="number" step="0.01" inputmode="decimal" value="${x.mi ?? ''}"></label>
      <label>Minutes<input name="min" type="number" inputmode="numeric" value="${x.min ?? ''}"></label>
      <label>kcal<input name="kcal" type="number" inputmode="numeric" value="${x.kcal ?? ''}"></label></div>
      <p class="muted small">Garmin activities show up on their own after the nightly sync; use this for anything not on your watch.</p>
      <div class="actions">${id ? '<button type="button" class="danger" id="del">Delete</button>' : ''}<button class="primary">Save</button></div></form>`, { title: id ? 'Edit exercise' : 'Add exercise' });
    $('#ex', b).onsubmit = async ev => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      await db.put('exercises', { ...x, date: x.date || state.date, name: f.get('name'), run: f.get('run') === 'on', mi: +f.get('mi') || 0, min: +f.get('min') || 0, kcal: +f.get('kcal') || 0 });
      closeSheet(); render();
    };
    if (id) $('#del', b).onclick = async () => { await db.remove('exercises', id); closeSheet(); render(); };
  })();
}

// ---------- Add food ----------
// Full-screen search, laid out like Macros: search bar with scan, then My foods / My recipes / Library tabs.
function openAdd(meal, { pick } = {}) {
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
  let data = null, libQ = '', libRes = null, libSeq = 0;
  const words = () => q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hit = f => { const t = `${f.name} ${f.brand || ''}`.toLowerCase(); return words().every(w => t.includes(w)); };
  const show = (sections, extra = '') => {
    list = [];
    out.innerHTML = sections.filter(s => s.items.length || s.letters).map(s => {
      const open = !s.fold || local.get('fold:' + s.fold, true);
      let letter = '';
      const rows = s.items.map(f => {
        const i = list.push(f) - 1, L = (f.name[0] || '#').toUpperCase();
        const head = s.letters && L !== letter ? `<li class="letter">${esc((letter = L))}</li>` : '';
        return head + foodRow(f, i, s.editable && editing ? (editing.has(i) ? 'picked' : '') : null);
      }).join('');
      return `<h4 ${s.fold ? `class="fold" data-fold="${s.fold}"` : ''}><span>${s.title}</span><span>${s.editable && open ? `<button class="link" id="editRecents">${editing ? 'Cancel' : 'Clean up'}</button>` : ''}${s.fold ? `<span class="caret ${open ? 'up' : ''}">${ico('next')}</span>` : ''}</span></h4>
      ${open ? `<ul class="list ${s.editable && editing ? 'selecting' : ''}">${rows || '<li class="empty small">Nothing here yet.</li>'}</ul>` : ''}
      ${open && s.editable && editing ? `<div class="actions"><button class="danger" id="hideRecents">Remove ${editing.size || ''} from recents</button></div>` : ''}`;
    }).join('') + extra || '<p class="muted pad">Nothing found. Try the Library tab, snap the label, or make a new food.</p>';
    $$('li.food', out).forEach(li => (li.onclick = () => {
      const i = +li.dataset.i;
      if (editing && list[i]._key) { editing.has(i) ? editing.delete(i) : editing.add(i); return show(lastSections, extra); }
      choose(list[i]);
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
      if (!libRes) { out.innerHTML = '<p class="muted pad">Searching USDA and Open Food Facts…</p>'; return; }
      show([{ title: 'Library', items: libRes }], libRes.length ? '' : '<p class="muted pad">No library matches. Try fewer words, scan the barcode, or snap the label.</p>');
      if (food.usdaThrottled && !local.get('usdaKey')) out.insertAdjacentHTML('afterbegin', '<p class="warn small">USDA demo key is rate-limited. Add your free key in Settings for better generic results.</p>');
    }
  };
  const runLib = async () => {
    const v = q.value.trim(); if (v.length < 2) return;
    const my = ++libSeq; libQ = v; libRes = null; draw();
    const res = await food.search(v).catch(() => ({ remote: [] }));
    if (my !== libSeq) return;
    libRes = res.remote; draw();
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
    const [recent, pantry, recipes] = await Promise.all([recentFoods(), food.mine(), recipeFoods()]);
    data = { recent, pantry, recipes };
    draw();
  })();
  let t;
  q.oninput = () => { editing = null; if (tab === 'library') { clearTimeout(t); t = setTimeout(draw, 650); } else draw(); };
  q.onkeydown = e => {
    if (e.key !== 'Enter') return;
    clearTimeout(t);
    if (tab !== 'library' && !list.length) setTab('library'); else draw();
    q.blur();
  };
  $('#qx', b).onclick = () => { q.value = ''; draw(); q.focus(); };
  $('#scanBtn', b).onclick = () => openScanner(meal, pick);
  $('#labelBtn', b).onclick = () => openLabel({ meal, pick });
  $('#newBtn', b).onclick = () => openFoodEditor(null, { meal, pick });
  if (!pick) { $('#quickBtn', b).onclick = () => openQuick(meal); $('#voiceBtn', b).onclick = () => openVoice(); }
}

// Suggest your own foods and recipes that fit what's left today, protein first.
async function openFits() {
  const s = state.s, [entries, ctx] = await Promise.all([entriesFor(state.date), dayContext(state.date)]);
  const tot = N.entryTotals(entries, s.caloriesFromMacros), goals = ctx.goals;
  const rem = { kcal: goals.kcal - tot.kcal, p: goals.p - tot.p, c: goals.c - (s.netCarbs ? tot.c - tot.fib : tot.c), f: goals.f - tot.f };
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
      if (k > rem.kcal + 40 || n.f > Math.max(rem.f, 0) + 4 || n.c > Math.max(rem.c, 0) + 8) continue;
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
  const b = sheet(`<p class="hint">Left today: <b>${r0(rem.kcal)}</b> kcal · ${macroLine(rem)}</p>
    ${top.length ? `<ul class="list">${top.map((x, i) => `<li class="food" data-i="${i}"><div class="grow">${row2(esc(x.f.name), x.n, esc(`${x.q === 1 ? '' : x.q + ' × '}${unitText(x.unit.label)}${x.f.brand ? ', ' + x.f.brand : ''}`))}</div></li>`).join('')}</ul>`
      : '<p class="muted">Nothing in your foods fits what\'s left. A protein shake or egg whites usually does.</p>'}
    <p class="muted small" style="margin-top:12px">Ranked by how much protein it covers and how well it uses your calories without going over. Tap one to log it.</p>`, { title: 'What fits' });
  $$('li.food', b).forEach(li => (li.onclick = () => { const x = top[+li.dataset.i]; openPortion(x.f, { meal: 0, qty: x.q }); }));
}

// Meal preps with how many portions are left since the prep's week started.
async function prepStatus() {
  const preps = (await recipeFoods()).filter(r => r.tag === 'prep');
  if (!preps.length) return [];
  const logs = (await Promise.all([...new Set([monthOf(today()), monthOf(addDays(today(), -10))])].map(m => db.all('log/' + m)))).flat();
  return preps.map(p => {
    const since = p.recipe.weekStart || '0000', total = Math.round(+p.recipe.servings || 1);
    const used = logs.filter(e => e.recipeId === p.id && e.date >= since).reduce((t, e) => t + (+e.qty || 0) * (+e.mult || 1), 0);
    return { id: p.id, name: p.name, n: p.n, total, left: Math.max(0, Math.round((total - used) * 10) / 10) };
  });
}

function openQuick(meal) {
  const b = sheet(`<form id="qa" class="form"><label>Name<input name="name" value="Quick add"></label>
    <div class="grid4"><label>Carbs<input name="c" type="number" step="any" inputmode="decimal"></label><label>Protein<input name="p" type="number" step="any" inputmode="decimal"></label>
    <label>Fat<input name="f" type="number" step="any" inputmode="decimal"></label><label>kcal<input name="kcal" type="number" step="any" inputmode="decimal" placeholder="auto"></label></div>
    <div class="actions"><button class="primary">Log</button></div></form>`, { title: 'Quick add' });
  $('#qa', b).onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const n = { p: +f.p || 0, c: +f.c || 0, f: +f.f || 0 };
    n.kcal = +f.kcal || N.macroKcal(n);
    await logEntry({ name: f.name || 'Quick add', n, qty: 1, unit: 'serving', mult: 1, meal });
  };
}

async function logEntry(e) {
  await db.put(logName(state.date), { date: state.date, time: nowTime(), ...e });
  if ((state.s.hiddenRecents || []).includes(recentKey(e))) await setHidden([recentKey(e)], false);
  closeSheet(); render(); toast(`Logged ${e.name}`);
}

// Portion picker: log a food, edit a logged entry, or pick a recipe ingredient.
function openPortion(f, { meal = 0, entry, pick, qty: qStart } = {}) {
  (async () => {
    // A logged entry's food may have more units now; reload it if it still exists.
    if (entry && f.id) { const live = await db.get('foods', f.id); if (live) f = { ...live, source: 'mine' }; }
    const units = f.units?.length ? f.units : [{ label: 'serving', mult: 1 }];
    let ui = entry ? Math.max(0, units.findIndex(u => u.label === entry.unit)) : Math.max(0, units.findIndex(u => u.label.startsWith('serving')));
    if (entry && units[ui]?.label !== entry.unit) { units.unshift({ label: entry.unit, mult: entry.mult }); ui = 0; }
    let q0 = entry ? entry.qty : qStart || 1;
    if (!entry && !units[ui].label.startsWith('serving') && units.some(u => u.label === 'g') && !units.some(u => !['g', 'oz'].includes(u.label))) { ui = units.findIndex(u => u.label === 'g'); q0 = 100; }
    const remote = !['mine', 'recipe'].includes(f.source) || f._quick;
    const b = sheet(`
      <div class="pname">${esc(f.name)}</div><div class="sub">${f.brand ? esc(f.brand) + ' · ' : ''}<span class="badge src-${f.source}">${esc(f.srcLabel || '')}</span> ${checkBadge(f.n)}</div>
      ${!N.check(f.n).ok && !N.check(f.n).missingKcal ? `<p class="warn small">Listed calories don't match the macros. ${state.s.caloriesFromMacros ? 'The app is counting calories from macros, so your totals stay consistent.' : 'Consider turning on "calories from macros" in Settings.'}</p>` : ''}
      <div class="qtyrow"><input id="qty" type="number" inputmode="decimal" step="any" value="${q0}"><select id="unit">${units.map((u, i) => `<option value="${i}" ${i === ui ? 'selected' : ''}>${esc(u.label)}</option>`).join('')}</select></div>
      <div id="live" class="live"></div>
      ${pick || state.s.meals.length < 2 ? '' : `<label>Meal<select id="meal">${state.s.meals.map((m, i) => `<option value="${i}" ${i === (entry?.meal ?? meal) ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>`}
      ${remote && !pick ? `<label class="check"><input type="checkbox" id="save"> Save to my foods (for staples; it shows in recents either way once you eat it again)</label>` : ''}
      <div class="actions">
        ${entry ? '<button class="danger" id="del">Delete</button>' : ''}
        ${f.source !== 'recipe' ? '<button id="edit">Edit nutrition</button>' : ''}
        <button class="primary" id="go">${entry ? 'Update' : pick ? 'Add ingredient' : 'Log'}</button>
      </div>`, { title: entry ? 'Edit entry' : 'Portion' });
    const qty = $('#qty', b), unit = $('#unit', b);
    const upd = () => {
      const n = N.scale(f.n, (+qty.value || 0) * units[+unit.value].mult);
      $('#live', b).innerHTML = `<div class="kcal">${kcalOf(n)} kcal</div>${macroLine(n)}<div class="muted small">fiber ${r1(n.fib)} g · sugar ${r1(n.sug)} g · sodium ${r0(n.na)} mg</div>`;
    };
    qty.oninput = unit.onchange = upd; upd();
    qty.select();
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
      const base = { name: f.name, brand: f.brand, foodId, recipeId: f.recipeId, qty: +qty.value || 0, unit: u.label, mult: u.mult, n: f.n };
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
  const servingLabel = prefill?.servingLabel || su?.label?.replace(/^serving \((.*)\)$/, '$1') || '1 serving';
  const servingG = prefill?.servingG ?? (su && f?.units?.some(u => u.label === 'g') ? r1(su.mult * 100) : '');
  const v = k => (per[k] == null ? '' : r1(per[k]));
  const b = sheet(`<form id="fe" class="form">
    ${prefill?.notes ? `<p class="warn small">${esc(prefill.notes)}</p>` : ''}
    <label>Name<input name="name" required value="${esc(prefill?.name || f?.name || '')}"></label>
    <div class="grid2"><label>Brand<input name="brand" value="${esc(prefill?.brand || f?.brand || '')}"></label><label>Barcode<input name="barcode" inputmode="numeric" value="${esc(barcode || f?.barcode || '')}"></label></div>
    <div class="grid2"><label>Serving<input name="sl" value="${esc(servingLabel)}"></label><label>Serving grams<input name="sg" type="number" step="any" inputmode="decimal" value="${servingG}" placeholder="optional"></label></div>
    <h4>Per serving</h4>
    <div class="grid4"><label>kcal<input name="kcal" type="number" step="any" inputmode="decimal" value="${v('kcal')}"></label><label>Carbs<input name="c" type="number" step="any" inputmode="decimal" value="${v('c')}"></label>
    <label>Protein<input name="p" type="number" step="any" inputmode="decimal" value="${v('p')}"></label><label>Fat<input name="f" type="number" step="any" inputmode="decimal" value="${v('f')}"></label></div>
    <div class="grid3"><label>Fiber<input name="fib" type="number" step="any" inputmode="decimal" value="${v('fib')}"></label><label>Sugar<input name="sug" type="number" step="any" inputmode="decimal" value="${v('sug')}"></label><label>Sodium mg<input name="na" type="number" step="any" inputmode="decimal" value="${v('na')}"></label></div>
    <div id="chk"></div>
    <label class="check"><input type="checkbox" name="verified" ${f?.verified || prefill ? 'checked' : ''}> Verified against the package</label>
    <div class="actions">${f?.source === 'mine' && f.id && !f._quick ? '<button type="button" class="danger" id="delFood">Delete food</button>' : ''}<button class="primary">Save</button></div></form>`, { title: f ? 'Edit food' : 'New food' });
  const form = $('#fe', b);
  const read = () => { const d = Object.fromEntries(new FormData(form)); return { d, n: Object.fromEntries(N.KEYS.map(k => [k, d[k] === '' ? undefined : +d[k]])) }; };
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
  const cands = await voiceCandidates();
  return Promise.all(items.map(async it => {
    const said = [it.qty !== 1 || it.unit ? `${it.qty}${it.unit ? ' ' + it.unit : ''}` : '', it.text].filter(Boolean).join(' ');
    const prev = old.get(it.text);
    if (prev?.food) return { ...prev, said, amount: prev.qty === it.qty && prev.unit === it.unit ? prev.amount : voice.resolveAmount(prev.food, it.qty, it.unit), qty: it.qty, unit: it.unit };
    const row = { said, qty: it.qty, unit: it.unit, text: it.text };
    const local = voice.bestLocal(it.text, cands);
    if (local) { row.food = local.food; row.src = 'yours'; }
    else {
      const res = await food.search(it.text).catch(() => ({ own: [], remote: [] }));
      row.food = res.own[0] || res.remote[0]; row.src = row.food ? 'guess' : 'none';
    }
    if (row.food) row.amount = voice.resolveAmount(row.food, it.qty, it.unit);
    return row;
  }));
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
      const units = r.food?.units?.length ? r.food.units : [{ label: 'serving', mult: 1 }];
      const n = r.food ? N.scale(r.food.n, r.amount.qty * r.amount.mult) : null;
      return `<li class="vrow ${r.src}" data-i="${i}"><div class="grow">
        <div class="vhead"><div class="name">${r.food ? esc(r.food.name) : `No match for "${esc(r.text)}"`}</div><button class="rm" aria-label="Remove">✕</button></div>
        <div class="qty">${r.src === 'yours' ? '✓ your food' : r.src === 'guess' ? '⚠ best guess, check it' : 'tap Pick to choose'} · heard "${esc(r.said)}"</div>
        ${r.food ? `<div class="vamt"><input class="vq" type="number" step="any" inputmode="decimal" value="${r.amount.qty}"><select class="vu">${units.map(u => `<option ${u.label === r.amount.unit ? 'selected' : ''}>${esc(unitText(u.label))}</option>`).join('')}</select></div>
        <div class="vfoot">${macroLine(n)}<span class="vk">${kcalOf(n)} kcal</span></div>` : ''}
        <button class="chg">${r.food ? 'Wrong food? Pick another' : 'Pick food'}</button>
      </div></li>`;
    }).join('');
    const ok = rows.filter(r => r.food).length;
    $('#vlog', b).innerHTML = rows.length ? `<div class="vlogbar"><button class="primary" id="logAll" ${ok ? '' : 'disabled'}>Log ${ok} item${ok === 1 ? '' : 's'} · ${r0(total())} kcal</button></div>` : '';
    $$('.vrow', b).forEach(li => {
      const r = rows[+li.dataset.i];
      $('.rm', li).onclick = () => { rows.splice(+li.dataset.i, 1); draw(); };
      $('.chg', li).onclick = () => { rec?.stop(); openAdd(0, { pick: (base, full) => {
        r.food = full; r.src = 'yours'; r.amount = { qty: base.qty, unit: base.unit, mult: base.mult };
        openVoice({ autostart: false });
      } }); };
      const q = $('.vq', li), u = $('.vu', li);
      if (q) q.oninput = () => { r.amount.qty = +q.value || 0; const n = N.scale(r.food.n, r.amount.qty * r.amount.mult); $('.vfoot', li).innerHTML = `${macroLine(n)}<span class="vk">${kcalOf(n)} kcal</span>`; $('#logAll', b).textContent = `Log ${ok} item${ok === 1 ? '' : 's'} · ${r0(total())} kcal`; };
      if (u) u.onchange = () => { const unit = r.food.units[u.selectedIndex]; r.amount = { ...r.amount, unit: unit.label, mult: unit.mult }; draw(); };
    });
    const la = $('#logAll', b);
    if (la) la.onclick = async () => {
      const list = rows.filter(r => r.food);
      for (const r of list) {
        const f = r.food;
        await db.put(logName(state.date), { date: state.date, time: nowTime(), meal: 0, name: f.name, brand: f.brand,
          foodId: f.source === 'mine' && !f._quick ? f.id : undefined, recipeId: f.recipeId, qty: r.amount.qty, unit: r.amount.unit, mult: r.amount.mult, n: f.n });
      }
      const keys = list.map(r => recentKey({ foodId: r.food.source === 'mine' && !r.food._quick ? r.food.id : undefined, recipeId: r.food.recipeId, name: r.food.name }));
      if (keys.some(k => (state.s.hiddenRecents || []).includes(k))) await setHidden(keys, false);
      vstate = { text: '', rows: [] };
      closeSheet(); render(); toast(`Logged ${list.length} item${list.length === 1 ? '' : 's'}`);
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
  const startListening = () => {
    const before = ta.value.trim() ? ta.value.trim().replace(/[,\s]*$/, ', ') : '';
    setMic(true);
    rec = voice.listen({
      onText: t => { ta.value = before + t; vstate.text = ta.value; },
      onEnd: (_, err) => { rec = null; setMic(false); if (err) toast('Mic blocked: allow microphone access for this site'); match(); },
    });
  };
  if (mic) mic.onclick = () => (rec ? rec.stop() : startListening());
  $('#vclear', b).onclick = clear;
  $('#vredo', b)?.addEventListener('click', () => { clear(); startListening(); });
  ta.oninput = () => { vstate.text = ta.value; clearTimeout(typingT); typingT = setTimeout(match, 900); };
  $('.sheet-wrap')._cleanup = () => rec?.stop();
  draw();
  if (autostart && mic && !vstate.text) startListening();
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
    hits.innerHTML = `<ul class="list">${list.map(foodRow).join('')}</ul><div class="tools"><button id="snap">None match: snap label</button></div>`;
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
  const seg = local.get('foodsSeg', 'foods');
  const head = `<div class="seg" id="fseg"><button data-v="foods" class="${seg === 'foods' ? 'on' : ''}">My foods</button><button data-v="recipes" class="${seg === 'recipes' ? 'on' : ''}">Recipes & Creami</button><button data-v="explore" class="${seg === 'explore' ? 'on' : ''}">Explore</button></div>`;
  return head + (seg === 'recipes' ? await viewRecipes() : seg === 'explore' ? await viewExplore() : await viewMyFoods());
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
  if (local.get('foodsSeg', 'foods') === 'explore') return bind.explore(root);
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
  return `<div class="tools top"><button id="newR" class="primary">＋ Recipe</button><button id="newC">＋ Creami pint</button><button id="newP">＋ Meal prep</button></div>
    ${rs.length ? `<ul class="list card">${rs.sort((a, b) => a.name.localeCompare(b.name)).map(row).join('')}</ul>` : '<p class="muted">No recipes yet. Ingredients can be your foods, search results, or other recipes.</p>'}`;
}
bind.recipes = root => {
  $('#newR', root).onclick = () => openRecipe({ name: '', servings: 1, servingLabel: 'serving', items: [] });
  $('#newC', root).onclick = () => openRecipe({ name: 'Creami pint', tag: 'creami', servings: 1, servingLabel: 'pint', items: [] });
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
      <input class="iq" data-i="${i}" type="number" step="any" inputmode="decimal" value="${it.qty}"><span class="small">${esc(it.unit)}</span><button type="button" class="rm" data-i="${i}" aria-label="Remove">✕</button></li>`;
    }).join('');
    const t = N.zero(); r.items.forEach(it => N.add(t, N.scale(it.n, it.qty * it.mult)));
    const sv = Math.max(1, +form.servings.value || 1), per = N.scale(t, 1 / sv);
    $('#rtot', b).innerHTML = `<div class="qty">Whole recipe: <b>${kcalOf(t)} kcal</b></div>${macroLine(t)}<div class="kcal" style="margin-top:10px">Per ${esc(form.servingLabel.value)}: ${kcalOf(per)} kcal</div>${macroLine(per)}`;
    $$('.iq', b).forEach(x => (x.oninput = () => { r.items[+x.dataset.i].qty = +x.value || 0; drawTotals(); }));
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
// Curated halal ideas (app/ideas.json) built mostly from foods you already log, ranked by
// what you've eaten lately. Deals come from data/fuel/deals.json, refreshed weekly by
// tools/food_deals.js.
let ideasP;
const loadIdeas = () => (ideasP ??= fetch('ideas.json').then(r => r.json()).catch(() => { ideasP = null; return { ideas: [], buys: {} }; }));
const EX_CHIPS = [['you', 'For you'], ['hacks', 'Hacks'], ['fits', 'Fits today'], ['high-protein', 'High protein'], ['creami', 'Creami'], ['konjac', 'Konjac'], ['josephs', "Joseph's"], ['swap', 'Swaps'], ['frozen', 'Frozen']];

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
    return { ...x, items, n, k: N.countedKcal(n, state.s.caloriesFromMacros), because, owned,
      score: hits.reduce((t, h) => t + h[1], 0) * 2 + (because ? 3 : 0) + owned,
      saved: recipes.find(r => r.explore === x.id), deals: fresh.filter(d => x.buys?.includes(d.buy)) };
  });
  return { list, buys, deals: fresh };
}
// Ad deals show price, promo and end date; online deals link out.
function dealRow(d, buys) {
  const ends = d.until && new Date(d.until + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' });
  const sub = d.until ? [d.store, ends && 'until ' + ends] : [buys?.[d.buy]?.name, fmtDate(d.date), d.src];
  const body = `<div class="grow"><div class="name">${esc(d.title)}</div>${d.until && (d.price || d.promo) ? `<div class="deal-p">${esc([d.price, d.promo].filter(Boolean).join(' · '))}</div>` : ''}<div class="sub">${esc(sub.filter(Boolean).join(' · '))}</div></div>`;
  return d.url ? `<li><a href="${esc(d.url)}" target="_blank" rel="noopener">${body}<span class="chev">›</span></a></li>` : `<li class="ad">${body}</li>`;
}
async function leftToday() {
  const s = state.s, [entries, ctx] = await Promise.all([entriesFor(today()), dayContext(today())]);
  const tot = N.entryTotals(entries, s.caloriesFromMacros), g = ctx.goals;
  return { kcal: g.kcal - tot.kcal, p: g.p - tot.p, c: g.c - (s.netCarbs ? tot.c - tot.fib : tot.c), f: g.f - tot.f };
}

async function viewExplore() {
  const chip = local.get('exChip', 'you');
  const { list, buys, deals } = await exploreData();
  let shown = list, note = '';
  if (chip === 'you') shown = [...list].sort((a, b) => b.score - a.score || b.n.p / b.k - a.n.p / a.k);
  else if (chip === 'fits') {
    const rem = await leftToday();
    shown = list.filter(x => x.k <= rem.kcal + 40 && x.n.f <= Math.max(rem.f, 0) + 4).sort((a, b) => b.n.p - a.n.p);
    note = `<p class="hint">Left today: <b>${r0(rem.kcal)}</b> kcal · ${macroLine(rem)}</p>`;
  } else shown = list.filter(x => x.tags.includes(chip)).sort((a, b) => b.n.p / b.k - a.n.p / a.k);
  state.exShown = shown;
  const kind = x => x.kind === 'buy' ? 'Store pick' : `${{ creami: 'Creami pint', hack: 'Hack' }[x.kind] || 'Recipe'} · ${x.items.length} items`;
  const row = (x, i) => `<li class="food idea" data-i="${i}"><div class="grow">${row2(esc(x.name), x.n, kind(x))}
    ${x.because ? `<div class="bc">Because you eat ${esc(x.because.split(',')[0])}</div>` : ''}
    <div class="why">${x.kind === 'creami' ? '<span class="badge src-recipe">Creami</span> ' : x.kind === 'buy' ? '<span class="badge src-usda">Buy</span> ' : ''}${x.tags.includes('halal-certified') ? '<span class="badge ok">Halal certified</span> ' : ''}${x.deals.length ? '<span class="badge deal">Deal</span> ' : ''}${x.saved ? '<span class="badge ok">✓ saved</span> ' : ''}<b class="pd">${r0((x.n.p * 100) / Math.max(1, x.k))} g protein / 100 kcal</b></div></div></li>`;
  const order = Object.keys(buys), local_ = deals.filter(d => d.until).sort((a, b) => order.indexOf(a.buy) - order.indexOf(b.buy)), online = deals.filter(d => !d.until).slice(0, 4);
  return `<div class="chips" id="exChips">${EX_CHIPS.map(([k, l]) => `<button data-c="${k}" class="${k === chip ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${note}
    ${shown.length ? `<ul class="list card ideas">${shown.map(row).join('')}</ul>` : `<p class="muted pad">${chip === 'fits' ? "None of the ideas fit what's left today." : 'Nothing here yet.'}</p>`}
    <button class="wide" id="exFits">${ico('pie')}What fits from my own foods</button>
    <section class="card deals"><header><h3>Deals on what you buy</h3></header>
      ${local_.length ? `<h4>This week near you</h4><ul class="list">${local_.slice(0, 6).map(d => dealRow(d, buys)).join('')}</ul>${local_.length > 6 ? `<button class="link" id="exAllDeals">All ${local_.length} weekly ad deals</button>` : ''}` : ''}
      ${online.length ? `<h4>Online</h4><ul class="list">${online.map(d => dealRow(d, buys)).join('')}</ul>` : ''}
      ${deals.length ? '' : '<p class="muted small">No deals synced yet. They refresh Wednesdays and Saturdays.</p>'}
      <p class="muted small">From the Giant, Weis, ALDI, Walmart and Target weekly ads near Bellefonte plus Slickdeals, checked Wed and Sat for what you buy. Halal: ideas use vegetarian foods, seafood, or halal meat; no gelatin or alcohol.</p></section>`;
}
bind.explore = root => {
  $$('#exChips button', root).forEach(b => (b.onclick = () => { local.set('exChip', b.dataset.c); render(); }));
  $('#exFits', root).onclick = () => openFits();
  $('#exAllDeals', root)?.addEventListener('click', async () => {
    const { buys, deals } = await exploreData();
    sheet(`<ul class="list">${deals.filter(d => d.until).map(d => dealRow(d, buys)).join('')}</ul>`, { title: 'This week near you' });
  });
  $$('li.idea', root).forEach(li => (li.onclick = () => openIdea(state.exShown[+li.dataset.i])));
};

function openIdea(x) {
  const ing = x.items.map(it => { const n = N.scale(it.n, it.qty * it.mult); return `<li><div class="grow">${row2(esc(it.name), n, esc([it.brand, qtyText(it.qty, it.unit)].filter(Boolean).join(', ')))}</div></li>`; }).join('');
  const b = sheet(`<div class="live"><div class="kcal">${r0(x.k)} kcal</div>${macroLine(x.n)}<div class="muted small">${[x.n.fib ? `fiber ${r1(x.n.fib)} g` : '', x.n.na ? `sodium ${r0(x.n.na)} mg` : '', x.kind === 'creami' ? 'whole pint' : ''].filter(Boolean).join(' · ')}</div></div>
    <p class="hint">${esc(x.why)}</p>
    <h4>${x.kind === 'buy' ? 'Item' : 'Ingredients'}</h4><ul class="list">${ing}</ul>
    ${x.kind === 'buy' ? '' : `<h4>How</h4><ol class="steps">${x.steps.map(t => `<li>${esc(t)}</li>`).join('')}</ol>`}
    ${x.halal ? `<p class="small halal">${esc(x.halal)}</p>` : ''}
    ${x.deals.length ? `<h4>Deals</h4><ul class="list">${x.deals.slice(0, 4).map(d => dealRow(d)).join('')}</ul>` : ''}
    <div class="actions">${x.kind === 'buy' ? '' : `<button id="iSave">${x.saved ? 'Open my recipe' : 'Save to my recipes'}</button>`}<button class="primary" id="iLog">Log it</button></div>`, { title: x.name });
  $('#iLog', b).onclick = async () => openPortion(x.saved
    ? (await recipeFoods()).find(r => r.id === x.saved.id)
    : { name: x.name, n: x.n, units: [{ label: x.kind === 'creami' ? 'pint' : x.items.length === 1 ? x.items[0].unit : 'serving', mult: 1 }], source: 'recipe', srcLabel: 'Explore' }, { meal: defaultMeal() });
  const sv = $('#iSave', b);
  if (sv) sv.onclick = async () => {
    const r = x.saved || await db.put('recipes', { name: x.name, tag: x.kind === 'creami' ? 'creami' : undefined, servings: 1, servingLabel: x.kind === 'creami' ? 'pint' : 'serving',
      items: x.items.map(({ foodId, name, brand, qty, unit, mult, n }) => ({ foodId, name, brand, qty, unit, mult, n })), explore: x.id });
    if (!x.saved) toast('Saved to My recipes');
    openRecipe(r);
  };
}

// ---------- Trends ----------
async function viewTrends() {
  const s = state.s, range = local.get('range', 30);
  const dates = Array.from({ length: range }, (_, i) => addDays(today(), i - range + 1));
  const months = [...new Set(dates.map(monthOf))];
  const logs = (await Promise.all(months.map(m => db.all('log/' + m)))).flat();
  const garmin = Object.assign({}, ...(await Promise.all(months.map(m => sync.garminMonth(m).catch(() => ({ days: {} }))))).map(g => g.days || {}));
  const [weights, daysRec] = await Promise.all([db.all('weights'), db.all('days')]);
  const wBy = new Map(weights.map(w => [w.date, w.lb])), dtBy = new Map(daysRec.map(d => [d.id, d.dayType]));
  const rows = dates.map(d => {
    const t = N.entryTotals(logs.filter(e => e.date === d), s.caloriesFromMacros);
    const g = goalsFor(s, garmin[d], dtBy.get(d));
    return { date: d, ...t, goal: g, type: g.type, weight: wBy.get(d) ?? garmin[d]?.weightLb, gd: garmin[d] };
  });
  const logged = rows.filter(r => r.kcal > 0);
  const avg = k => (logged.length ? logged.reduce((t, r) => t + r[k], 0) / logged.length : 0);
  const avgGoal = k => (logged.length ? logged.reduce((t, r) => t + r.goal[k], 0) / logged.length : 0);
  const hit = logged.filter(r => Math.abs(r.kcal - r.goal.kcal) <= r.goal.kcal * 0.1 && r.p >= r.goal.p * 0.9).length;
  const tdee = measuredTdee(rows.map(r => ({ kcal: r.kcal, weight: r.weight })));
  const w = rows.map(r => r.weight ?? NaN), wt = ema(w);
  const wFirst = wt.find(Number.isFinite), wLast = [...wt].reverse().find(Number.isFinite);
  const runs = rows.filter(r => r.type !== 'rest').length; // days with real exercise
  const card = (k, v, sub = '', cls = '') => `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="k">${sub}</div>` : ''}</div>`;
  const steps = rows.map(r => r.gd?.steps || 0);
  return `<div class="seg" id="range">${[7, 30, 90, 180].map(n => `<button data-n="${n}" class="${n === range ? 'on' : ''}">${n}d</button>`).join('')}</div>
  <section class="card"><div class="stats">
    ${card('Avg kcal', r0(avg('kcal')), 'goal ' + r0(avgGoal('kcal')), 'kc-t')}${card('Avg carbs', r0(avg('c')) + ' g', 'goal ' + r0(avgGoal('c')), 'c')}
    ${card('Avg protein', r0(avg('p')) + ' g', 'goal ' + r0(avgGoal('p')), 'p')}${card('Avg fat', r0(avg('f')) + ' g', 'goal ' + r0(avgGoal('f')), 'f')}
    ${card('On target', logged.length ? Math.round((hit / logged.length) * 100) + '%' : '–', `${logged.length}/${range} days logged`, 'steps')}
    ${card('Weight trend', wFirst != null ? (wLast - wFirst >= 0 ? '+' : '') + r1(wLast - wFirst) + ' lb' : '–', wLast != null ? 'now ' + r1(wLast) : '', 'sleep')}
    ${card('Measured TDEE', tdee ? r0(tdee) : '–', tdee ? 'from logs + weight' : 'needs 14+ days', 'burn')}${card('Active days', runs, 'of ' + range, 'run')}
  </div></section>
  <section class="card"><h3>🔥 Calories vs goal</h3>${bars(rows.map(r => r.date), rows.map(r => r.kcal), rows.map(r => r.goal.kcal), { title: 'Calories vs goal' })}</section>
  <section class="card"><h3>💪 Protein vs goal</h3>${bars(rows.map(r => r.date), rows.map(r => r.p), rows.map(r => r.goal.p), { title: 'Protein', cls: 'p' })}</section>
  <section class="card"><h3>⚖️ Weight</h3>${w.some(Number.isFinite) ? line(rows.map(r => r.date), w, { trend: wt, title: 'Weight', fmt: r1 }) : '<p class="muted">Log weight on the Today tab (Garmin scale weigh-ins show up too).</p>'}</section>
  ${steps.some(Boolean) ? `<section class="card"><h3>👟 Steps</h3>${bars(rows.map(r => r.date), steps, null, { title: 'Steps', cls: 'steps' })}</section>
  <section class="card"><h3>🔥 Active calories (Garmin)</h3>${bars(rows.map(r => r.date), rows.map(r => r.gd?.activeKcal || 0), null, { title: 'Active kcal', cls: 'burn' })}</section>
  <section class="card"><h3>😴 Sleep (hours)</h3>${line(rows.map(r => r.date), rows.map(r => (r.gd?.sleepSec ? r.gd.sleepSec / 3600 : NaN)), { title: 'Sleep', fmt: r1 })}</section>` : ''}
  <section class="card"><h3>🥧 Macro split (avg)</h3>${split(avg('p'), avg('c'), avg('f'))}</section>`;
}
function split(p, c, f) {
  const k = { p: p * 4, c: c * 4, f: f * 9 }, t = k.p + k.c + k.f || 1;
  return `<div class="split">${['c', 'p', 'f'].map(x => `<div class="${x}" style="flex:${k[x] / t}">${k[x] / t >= 0.14 ? x.toUpperCase() + ' ' : ''}${Math.round((k[x] / t) * 100)}%</div>`).join('')}</div>`;
}
bind.trends = root => $$('#range button', root).forEach(b => (b.onclick = () => { local.set('range', +b.dataset.n); render(); }));

// ---------- Settings ----------
async function viewSettings() {
  const s = state.s, p = s.profile;
  const meta = await sync.garminMeta().catch(() => null);
  const dt = (k) => {
    const d = s.dayTypes[k], g = N.goalGrams(d), mk = r0(4 * g.p + 4 * g.c + 9 * g.f);
    return `<fieldset data-dt="${k}" class="dt-${k}"><legend>${k === 'rest' ? 'Base day' : esc(d.label) + ' day'}</legend>
      <div class="grid2"><label>Calories<input name="kcal" type="number" inputmode="numeric" value="${d.kcal}"></label>
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
    <form id="fuel" class="form"><label>Exercise calories to eat back (%)<input name="fuelPct" type="number" min="0" max="150" step="5" inputmode="numeric" value="${s.fuelPct ?? 100}"></label></form>
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
function macroSplit(g) {
  const k = { c: g.c * 4, p: g.p * 4, f: g.f * 9 }, t = k.c + k.p + k.f || 1;
  let a0 = -Math.PI / 2;
  const arc = x => {
    const frac = k[x] / t; if (frac <= 0) return '';
    const a1 = a0 + frac * 2 * Math.PI, R = 40, r = 18, big = frac > 0.5 ? 1 : 0, P = (rad, a) => `${50 + rad * Math.cos(a)} ${50 + rad * Math.sin(a)}`;
    const mid = (a0 + a1) / 2, d = frac >= 0.999 ? `M ${P(R, 0)} A ${R} ${R} 0 1 1 ${P(R, Math.PI)} A ${R} ${R} 0 1 1 ${P(R, 0)} Z` :
      `M ${P(R, a0)} A ${R} ${R} 0 ${big} 1 ${P(R, a1)} L ${P(r, a1)} A ${r} ${r} 0 ${big} 0 ${P(r, a0)} Z`;
    const out = `<path d="${d}" class="${x}"/>${frac >= 0.08 ? `<text x="${50 + 29 * Math.cos(mid)}" y="${50 + 29 * Math.sin(mid) + 4}" text-anchor="middle">${Math.round(frac * 100)}</text>` : ''}`;
    a0 = a1; return out;
  };
  const col = (x, l) => `<div class="${x}"><div>${l}</div><b>${r0(g[x])} g</b><span>${r0(k[x])} kcal</span></div>`;
  return `<div class="msplit"><div class="mcols3">${col('c', 'Carbs')}${col('p', 'Protein')}${col('f', 'Fat')}</div><svg viewBox="0 0 100 100" class="donut" role="img" aria-label="Calorie split">${['c', 'p', 'f'].map(arc).join('')}</svg></div>`;
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
  $('#fuel', root).onchange = async e => { s.fuelPct = Math.max(0, +e.target.value || 0); await db.saveSettings(s); toast('Saved'); };
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
    try { const r = await sync.sync(); syncBadge(); toast(`Synced ✓ ${r.pulled ? `pulled ${r.pulled} file(s)` : 'token works'}`); render(); }
    catch (e) { syncBadge('sync failed'); $('#sync').className = 'warn'; toast(e.message); }
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
const ui = { $, $$, esc, ico, sheet, closeSheet, toast, render };
$$('nav button').forEach(b => b.insertAdjacentHTML('afterbegin', ico(b.dataset.tab)));
$('#gear').innerHTML = ico('settings');
$('#gear').onclick = () => { state.tab = 'settings'; state.sel = state.fsel = null; render(); };
$$('nav button').forEach(b => (b.onclick = () => { if (b.dataset.tab === 'add') return openAdd(defaultMeal()); state.tab = b.dataset.tab; state.sel = state.fsel = null; render(); }));
function defaultMeal() {
  const h = new Date().getHours(), n = state.s?.meals.length || 1;
  return Math.min(n - 1, h < 15 ? 0 : h < 18 ? 1 : 2);
}
db.onChange(() => scheduleSync());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') runSync(); else scheduleSync(500); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
render().then(() => scheduleSync(300));
