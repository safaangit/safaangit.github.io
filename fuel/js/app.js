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

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const addDays = (d, k) => today(new Date(new Date(d + 'T12:00').getTime() + k * 864e5));
const nowTime = () => new Date().toTimeString().slice(0, 5);
const fmtDate = d => d === today() ? 'Today' : d === addDays(today(), -1) ? 'Yesterday' : new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const DT_ORDER = [null, 'rest', 'run', 'long'];

const state = { date: today(), tab: local.get('tab', 'today'), s: null, sel: null };

// ---------- shell ----------
async function render() {
  state.s = await db.settings();
  local.set('tab', state.tab);
  if (state.tab === 'recipes') state.tab = 'foods';
  $$('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  const main = $('main');
  if (state.tab === 'recipes') state.tab = 'foods';
  const views = { today: viewToday, trends: viewTrends, foods: viewFoods, settings: viewSettings };
  main.innerHTML = await views[state.tab]();
  bind[state.tab]?.(main);
  syncBadge();
}
function syncBadge(msg) {
  const el = $('#sync');
  if (!sync.configured()) { el.textContent = 'local only'; el.className = 'muted'; return; }
  if (msg) { el.textContent = msg; return; }
  const t = local.get('lastSync', 0);
  el.textContent = t ? 'synced ' + new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'not synced';
  el.className = 'muted';
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
function sheet(html, { title = '' } = {}) {
  closeSheet();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button class="x" aria-label="Close">✕</button></header><div class="body">${html}</div></div>`;
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
  return recipes.map(r => ({ id: r.id, recipeId: r.id, name: r.name, tag: r.tag, n: per(r), units: [{ label: r.servingLabel || 'serving', mult: 1 }], source: 'recipe', srcLabel: r.tag === 'creami' ? 'Creami' : 'Recipe', recipe: r }));
}

function macroLine(n, s = state.s) {
  const c = s.netCarbs ? Math.max(0, (n.c || 0) - (n.fib || 0)) : n.c;
  return `<span class="m p">${r0(n.p)}P</span> <span class="m c">${r0(c)}${s.netCarbs ? 'N' : 'C'}</span> <span class="m f">${r0(n.f)}F</span>`;
}
const kcalOf = n => r0(N.countedKcal(n, state.s.caloriesFromMacros));
function checkBadge(n) {
  const c = N.check(n);
  if (c.missingKcal) return `<span class="badge warn" title="No calories listed">no kcal listed</span>`;
  return c.ok ? '' : `<span class="badge warn" title="Label ${c.listed} kcal vs macros ${c.est} kcal">kcal ≠ macros ${Math.round(c.pct * 100)}%</span>`;
}
function foodRow(f, i, selState = null) {
  const p = food.preview(f);
  return `<li class="food ${selState || ''}" data-i="${i}">${selState != null ? '<span class="box"></span>' : ''}<div class="grow"><div class="name">${f.fav ? '★ ' : ''}${esc(f.name)}${f.verified ? ' <span class="badge ok">✓</span>' : ''}</div>
  <div class="sub">${f.brand ? esc(f.brand) + ' · ' : ''}<span class="badge src-${f.source}">${esc(f.srcLabel || f.source)}</span> ${checkBadge(f.n)}</div>
  <div class="sub">${esc(p.unit.label)} · ${kcalOf(p.n)} kcal · ${macroLine(p.n)}</div></div><span class="chev">›</span></li>`;
}

// ---------- Today ----------
async function viewToday() {
  const s = state.s, date = state.date;
  const [entries, ctx, weights] = await Promise.all([entriesFor(date), dayContext(date), db.all('weights')]);
  const { g, gday, goals } = ctx;
  const tot = N.entryTotals(entries, s.caloriesFromMacros);
  const carbs = s.netCarbs ? tot.c - tot.fib : tot.c;
  const left = goals.kcal - tot.kcal;
  const pct = Math.min(1, tot.kcal / Math.max(1, goals.kcal));
  const ring = `<svg viewBox="0 0 120 120" class="ring"><circle cx="60" cy="60" r="52" class="track"/><circle cx="60" cy="60" r="52" class="fill ${left < 0 ? 'over' : ''}" stroke-dasharray="${(pct * 326.7).toFixed(1)} 326.7" transform="rotate(-90 60 60)"/>
    <text x="60" y="58" text-anchor="middle" class="big">${r0(Math.abs(left))}</text><text x="60" y="76" text-anchor="middle" class="small">${left < 0 ? 'kcal over' : 'kcal left'}</text></svg>`;
  const bar = (k, label, have, goal) => {
    const w = Math.min(100, (have / Math.max(1, goal)) * 100);
    return `<div class="mbar ${k}"><div class="lbl"><span>${label}</span><span>${r0(have)} / ${r0(goal)} g</span></div><div class="track"><div style="width:${w}%" class="${have > goal * 1.08 ? 'over' : ''}"></div></div><div class="rem">${r0(goal - have)} g left</div></div>`;
  };
  const dtLabel = s.dayTypes[goals.type]?.label || goals.type;
  const w = weights.find(x => x.date === date)?.lb ?? gday?.weightLb;

  const single = s.meals.length === 1, sel = state.sel;
  const byMeal = s.meals.map((m, mi) => {
    const list = entries.filter(e => single || (e.meal ?? 0) === mi);
    const t = N.entryTotals(list, s.caloriesFromMacros);
    return `<section class="card meal"><header><h3>${esc(m)}</h3><span class="muted">${list.length ? r0(t.kcal) + ' kcal' : ''}</span>
      ${list.length && !sel ? '<button class="link selBtn">Select</button>' : ''}
      ${mi === 0 && !sel ? '<button class="add voiceBtn" aria-label="Log by voice">🎤</button>' : ''}${sel ? '' : `<button class="add" data-meal="${mi}" aria-label="Add to ${esc(m)}">＋</button>`}</header>
    <ul class="entries ${sel ? 'selecting' : ''}">${list.map(e => {
      const n = N.scale(e.n, e.qty * e.mult);
      return `<li data-id="${e.id}" class="${sel?.has(e.id) ? 'picked' : ''}">${sel ? '<span class="box"></span>' : ''}<div class="grow"><div class="name">${esc(e.name)}</div><div class="sub">${r1(e.qty)} × ${esc(e.unit)}${e.time ? ' · ' + e.time : ''}</div></div><div class="right"><div>${kcalOf(n)}</div><div class="sub">${macroLine(n)}</div></div></li>`;
    }).join('') || (single ? '<li class="empty muted small">Tap 🎤 and say everything you ate, e.g. "chicken 8.5 oz, milk 240 grams, 2 eggs".</li>' : '')}</ul></section>`;
  }).join('');
  const selBar = sel ? `<div class="selbar"><span>${sel.size} selected</span><button id="selAll">All</button>
    ${state.date !== today() ? '<button id="selCopy">Copy to today</button>' : '<button id="selDup">Duplicate</button>'}
    <button id="selDel" class="danger">Delete</button><button id="selDone" class="primary">Done</button></div>` : '';

  const acts = g.activities || [];
  const garmin = `<section class="card">
    <header><h3>Activity</h3>${gday ? '' : `<span class="muted">${sync.configured() ? 'no Garmin data yet' : 'connect Garmin in Settings'}</span>`}<button class="add" id="addEx" aria-label="Add exercise">＋</button></header>
    ${gday ? `<div class="stats">
      ${stat('Steps', gday.steps?.toLocaleString())}${stat('Active kcal', gday.activeKcal)}${stat('Sleep', gday.sleepSec ? r1(gday.sleepSec / 3600) + ' h' : null, gday.sleepScore ? 'score ' + gday.sleepScore : '')}
      ${stat('HRV', gday.hrv, gday.hrvStatus?.toLowerCase())}${stat('RHR', gday.rhr)}${stat('Readiness', gday.readiness)}</div>` : ''}
    <ul class="entries">${acts.map(a => `<li ${a.manual ? `data-ex="${a.id}"` : ''}><div class="grow"><div class="name">${esc(a.name)}</div><div class="sub">${[
      a.distance ? r1(a.distance / 1609.34) + ' mi' : '', a.duration ? Math.round(a.duration / 60) + ' min' : a.min ? a.min + ' min' : '',
      a.distance && a.duration ? pace(a.duration, a.distance) : '', a.avgHR ? a.avgHR + ' bpm' : '', a.manual ? 'manual' : ''].filter(Boolean).join(' · ')}</div></div><div class="right">${r0(a.kcal)} kcal</div></li>`).join('')}</ul></section>`;

  return `
  <div class="datebar"><button id="prev" aria-label="Previous day">‹</button><button id="dateLbl">${fmtDate(date)}</button><button id="next" aria-label="Next day">›</button></div>
  <section class="card summary">
    ${ring}
    <div class="grow">
      <button class="chip" id="dayType" title="Tap to change">${esc(dtLabel)} day${goals.auto ? ' · auto' : ''}</button>
      <div class="muted small">${r0(tot.kcal)} eaten · goal ${r0(goals.kcal)}${goals.eatBack ? ` (+${goals.eatBack} exercise)` : ''}</div>
      ${bar('p', 'Protein', tot.p, goals.p)}${bar('c', s.netCarbs ? 'Net carbs' : 'Carbs', carbs, goals.c)}${bar('f', 'Fat', tot.f, goals.f)}
    </div>
  </section>
  ${byMeal}
  ${selBar}
  ${garmin}
  <section class="card row"><h3>Weight</h3><input id="weight" type="number" inputmode="decimal" step="0.1" placeholder="lb" value="${w ?? ''}"><span class="muted small">${!weights.find(x => x.date === date) && gday?.weightLb ? 'from Garmin' : ''}</span></section>`;
}
const stat = (k, v, sub = '') => v == null || v === '' ? '' : `<div class="stat"><div class="v">${esc(v)}</div><div class="k">${k}${sub ? ' · ' + esc(sub) : ''}</div></div>`;
function pace(sec, m) { const p = sec / (m / 1609.34); return `${Math.floor(p / 60)}:${String(Math.round(p % 60)).padStart(2, '0')}/mi`; }

const bind = {};
bind.today = root => {
  $('#prev', root).onclick = () => { state.date = addDays(state.date, -1); state.sel = null; render(); };
  $('#next', root).onclick = () => { state.date = addDays(state.date, 1); state.sel = null; render(); };
  $('#dateLbl', root).onclick = () => { state.date = today(); render(); };
  $('#dayType', root).onclick = async () => {
    const cur = (await db.get('days', state.date))?.dayType ?? null;
    const next = DT_ORDER[(DT_ORDER.indexOf(cur) + 1) % DT_ORDER.length];
    await db.put('days', { id: state.date, dayType: next });
    render();
  };
  $$('.meal .add[data-meal]', root).forEach(b => (b.onclick = () => openAdd(+b.dataset.meal)));
  $$('.voiceBtn', root).forEach(b => (b.onclick = () => openVoice()));
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
    $('#selCopy', root)?.addEventListener('click', () => copyTo(today()));
    $('#selDup', root)?.addEventListener('click', () => copyTo(state.date));
  }
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
function openAdd(meal, { pick } = {}) {
  const b = sheet(`
    <div class="searchbar"><input id="q" type="search" placeholder="Search foods, brands, recipes" autocomplete="off" enterkeyhint="search"></div>
    <div class="tools">
      ${pick ? '' : '<button id="voiceBtn">🎤 Say it</button>'}<button id="scanBtn">▥ Scan</button><button id="labelBtn">📷 Label</button>
      ${pick ? '' : '<button id="quickBtn">⚡ Quick add</button>'}<button id="newBtn">＋ New food</button>
    </div>
    <div id="results"><p class="muted">Loading recents…</p></div>`, { title: pick ? 'Pick ingredient' : state.s.meals.length > 1 ? `Add to ${state.s.meals[meal] || 'diary'}` : 'Add food' });
  const q = $('#q', b), out = $('#results', b);
  let list = [];
  let editing = null; // Set of list indexes while cleaning up recents
  const show = (sections) => {
    list = [];
    out.innerHTML = sections.filter(s => s.items.length).map(s => `<h4>${s.title}${s.editable ? ` <button class="link" id="editRecents">${editing ? 'Cancel' : 'Clean up'}</button>` : ''}</h4>
      <ul class="list ${s.editable && editing ? 'selecting' : ''}">${s.items.map(f => { const i = list.push(f) - 1; return foodRow(f, i, s.editable && editing ? (editing.has(i) ? 'picked' : '') : null); }).join('')}</ul>
      ${s.editable && editing ? `<div class="actions"><button class="danger" id="hideRecents">Remove ${editing.size || ''} from recents</button></div>` : ''}`).join('') || '<p class="muted">Nothing found. Try fewer words, snap the label, or make a new food.</p>';
    $$('li.food', out).forEach(li => (li.onclick = () => {
      const i = +li.dataset.i;
      if (editing && list[i]._key) { editing.has(i) ? editing.delete(i) : editing.add(i); return show(lastSections); }
      choose(list[i]);
    }));
    const er = $('#editRecents', out);
    if (er) er.onclick = () => { editing = editing ? null : new Set(); show(lastSections); };
    const hr = $('#hideRecents', out);
    if (hr) hr.onclick = async () => {
      const keys = [...editing].map(i => list[i]._key).filter(Boolean);
      if (!keys.length) return;
      await setHidden(keys, true);
      editing = null; toast(`Removed ${keys.length} from recents`);
      lastSections[0].items = lastSections[0].items.filter(f => !keys.includes(f._key));
      show(lastSections);
    };
    lastSections = sections;
  };
  let lastSections = [];
  const choose = f => (pick ? openPortion(f, { pick }) : openPortion(f, { meal }));
  (async () => {
    const [recent, pantry, recipes] = await Promise.all([recentFoods(), food.mine(), recipeFoods()]);
    const favs = pantry.filter(p => p.fav && !recent.some(r => r.id === p.id));
    show([{ title: 'Recent', items: recent, editable: true }, { title: 'Favorites', items: favs }, { title: 'Recipes & Creami', items: recipes }]);
  })();
  let t, seq = 0;
  const run = async () => {
    const v = q.value.trim(); if (v.length < 2) return;
    const my = ++seq;
    out.innerHTML = '<p class="muted">Searching your foods, USDA and Open Food Facts…</p>';
    const res = await food.search(v, { recipes: await recipeFoods() });
    if (my !== seq) return;
    editing = null;
    show([{ title: 'Yours', items: res.own }, { title: 'Best matches', items: res.remote }]);
    if (food.usdaThrottled && !local.get('usdaKey')) out.insertAdjacentHTML('afterbegin', '<p class="warn small">USDA demo key is rate-limited. Add your free key in Settings for better generic results.</p>');
  };
  q.oninput = () => { clearTimeout(t); t = setTimeout(run, 650); };
  q.onkeydown = e => { if (e.key === 'Enter') { clearTimeout(t); run(); } };
  $('#scanBtn', b).onclick = () => openScanner(meal, pick);
  $('#labelBtn', b).onclick = () => openLabel({ meal, pick });
  $('#newBtn', b).onclick = () => openFoodEditor(null, { meal, pick });
  if (!pick) { $('#quickBtn', b).onclick = () => openQuick(meal); $('#voiceBtn', b).onclick = () => openVoice(); }
  setTimeout(() => q.focus(), 50);
}

function openQuick(meal) {
  const b = sheet(`<form id="qa" class="form"><label>Name<input name="name" value="Quick add"></label>
    <div class="grid4"><label>Protein<input name="p" type="number" step="any" inputmode="decimal"></label><label>Carbs<input name="c" type="number" step="any" inputmode="decimal"></label>
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
function openPortion(f, { meal = 0, entry, pick } = {}) {
  (async () => {
    // A logged entry's food may have more units now; reload it if it still exists.
    if (entry && f.id) { const live = await db.get('foods', f.id); if (live) f = { ...live, source: 'mine' }; }
    const units = f.units?.length ? f.units : [{ label: 'serving', mult: 1 }];
    let ui = entry ? Math.max(0, units.findIndex(u => u.label === entry.unit)) : Math.max(0, units.findIndex(u => u.label.startsWith('serving')));
    if (entry && units[ui]?.label !== entry.unit) { units.unshift({ label: entry.unit, mult: entry.mult }); ui = 0; }
    let q0 = entry ? entry.qty : 1;
    if (!entry && !units[ui].label.startsWith('serving') && units.some(u => u.label === 'g') && !units.some(u => !['g', 'oz'].includes(u.label))) { ui = units.findIndex(u => u.label === 'g'); q0 = 100; }
    const remote = !['mine', 'recipe'].includes(f.source) || f._quick;
    const b = sheet(`
      <div class="pname">${esc(f.name)}</div><div class="sub">${f.brand ? esc(f.brand) + ' · ' : ''}<span class="badge src-${f.source}">${esc(f.srcLabel || '')}</span> ${checkBadge(f.n)}</div>
      ${!N.check(f.n).ok && !N.check(f.n).missingKcal ? `<p class="warn small">Listed calories don't match the macros. ${state.s.caloriesFromMacros ? 'The app is counting calories from macros, so your totals stay consistent.' : 'Consider turning on "calories from macros" in Settings.'}</p>` : ''}
      <div class="qty"><input id="qty" type="number" inputmode="decimal" step="any" value="${q0}"><select id="unit">${units.map((u, i) => `<option value="${i}" ${i === ui ? 'selected' : ''}>${esc(u.label)}</option>`).join('')}</select></div>
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
      $('#live', b).innerHTML = `<div class="kcal">${kcalOf(n)} kcal</div><div>${macroLine(n)}</div><div class="muted small">fiber ${r1(n.fib)} g · sugar ${r1(n.sug)} g · sodium ${r0(n.na)} mg</div>`;
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
    <div class="grid4"><label>kcal<input name="kcal" type="number" step="any" inputmode="decimal" value="${v('kcal')}"></label><label>Protein<input name="p" type="number" step="any" inputmode="decimal" value="${v('p')}"></label>
    <label>Carbs<input name="c" type="number" step="any" inputmode="decimal" value="${v('c')}"></label><label>Fat<input name="f" type="number" step="any" inputmode="decimal" value="${v('f')}"></label></div>
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
async function matchRows(text) {
  const items = voice.parseItems(text), cands = await voiceCandidates();
  return Promise.all(items.map(async it => {
    const row = { said: [it.qty !== 1 || it.unit ? `${it.qty}${it.unit ? ' ' + it.unit : ''}` : '', it.text].filter(Boolean).join(' '), qty: it.qty, unit: it.unit, text: it.text };
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
function openVoice() {
  const b = sheet(`
    ${voice.speechSupported() ? '<button id="mic" class="bigbtn mic">🎤 Tap and talk</button>' : '<p class="muted small">This browser has no voice input here. Type it, or use your keyboard\'s mic button.</p>'}
    <textarea id="vt" rows="3" placeholder="chicken 8.5 oz, milk 240 grams, 2 eggs, 1 josephs pita">${esc(vstate.text)}</textarea>
    <div class="actions"><button id="parse">Match items</button></div>
    <ul class="list" id="vrows"></ul>
    <div id="vlog"></div>`, { title: 'Say what you ate' });
  const ta = $('#vt', b);
  const draw = () => {
    const rows = vstate.rows;
    $('#vrows', b).innerHTML = rows.map((r, i) => {
      const units = r.food?.units?.length ? r.food.units : [{ label: 'serving', mult: 1 }];
      const n = r.food ? N.scale(r.food.n, r.amount.qty * r.amount.mult) : null;
      return `<li class="vrow" data-i="${i}"><div class="grow">
        <div class="name">${r.food ? esc(r.food.name) : 'No match'} <span class="badge ${r.src === 'yours' ? 'ok' : 'warn'}">${r.src === 'yours' ? 'yours' : r.src === 'guess' ? 'best guess, check it' : 'pick one'}</span></div>
        <div class="sub">heard "${esc(r.said)}"${n ? ` · ${kcalOf(n)} kcal · ${macroLine(n)}` : ''}</div>
        ${r.food ? `<div class="vamt"><input class="vq" type="number" step="any" inputmode="decimal" value="${r.amount.qty}"><select class="vu">${units.map(u => `<option ${u.label === r.amount.unit ? 'selected' : ''}>${esc(u.label)}</option>`).join('')}</select></div>` : ''}
      </div><div class="vbtns"><button class="chg">Change</button><button class="rm" aria-label="Remove">✕</button></div></li>`;
    }).join('');
    const ok = rows.filter(r => r.food).length;
    $('#vlog', b).innerHTML = rows.length ? `<div class="actions"><button class="primary" id="logAll" ${ok ? '' : 'disabled'}>Log ${ok} item${ok === 1 ? '' : 's'}</button></div>` : '';
    $$('.vrow', b).forEach(li => {
      const r = rows[+li.dataset.i];
      $('.rm', li).onclick = () => { rows.splice(+li.dataset.i, 1); draw(); };
      $('.chg', li).onclick = () => openAdd(0, { pick: (base, full) => {
        r.food = full; r.src = 'yours'; r.amount = { qty: base.qty, unit: base.unit, mult: base.mult };
        openVoice();
      } });
      const q = $('.vq', li), u = $('.vu', li);
      if (q) q.onchange = () => { r.amount.qty = +q.value || 0; draw(); };
      if (u) u.onchange = () => { const unit = r.food.units.find(x => x.label === u.value); r.amount = { ...r.amount, unit: unit.label, mult: unit.mult }; draw(); };
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
  const parse = async () => {
    vstate.text = ta.value;
    if (!ta.value.trim()) return;
    $('#vrows', b).innerHTML = '<li class="muted small">Matching…</li>';
    vstate.rows = await matchRows(ta.value);
    draw();
  };
  ta.oninput = () => (vstate.text = ta.value);
  $('#parse', b).onclick = parse;
  const mic = $('#mic', b);
  let rec;
  if (mic) mic.onclick = () => {
    if (rec) return rec.stop();
    const before = ta.value ? ta.value.replace(/[,\s]*$/, ', ') : '';
    mic.textContent = '● Listening… tap to stop'; mic.classList.add('on');
    rec = voice.listen({
      onText: t => { ta.value = before + t; vstate.text = ta.value; },
      onEnd: (_, err) => {
        rec = null; mic.textContent = '🎤 Tap and talk'; mic.classList.remove('on');
        if (err && err !== 'no-speech' && err !== 'aborted') toast('Mic error: ' + err);
        parse();
      },
    });
  };
  draw();
  if (!vstate.rows.length && mic && !vstate.text) mic.click();
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
  const head = `<div class="seg" id="fseg"><button data-v="foods" class="${seg === 'foods' ? 'on' : ''}">My foods</button><button data-v="recipes" class="${seg === 'recipes' ? 'on' : ''}">Recipes & Creami</button></div>`;
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
  const row = (r) => `<li data-id="${r.id}"><div class="grow"><div class="name">${esc(r.name)} <span class="badge src-recipe">${r.tag === 'creami' ? 'Creami' : 'Recipe'}</span></div>
    <div class="sub">per ${esc(r.units[0].label)} · ${kcalOf(r.n)} kcal · ${macroLine(r.n)}</div></div><span class="chev">›</span></li>`;
  return `<div class="tools top"><button id="newR" class="primary">＋ Recipe</button><button id="newC">＋ Creami pint</button></div>
    ${rs.length ? `<ul class="list card">${rs.sort((a, b) => a.name.localeCompare(b.name)).map(row).join('')}</ul>` : '<p class="muted">No recipes yet. Ingredients can be your foods, search results, or other recipes.</p>'}`;
}
bind.recipes = root => {
  $('#newR', root).onclick = () => openRecipe({ name: '', servings: 1, servingLabel: 'serving', items: [] });
  $('#newC', root).onclick = () => openRecipe({ name: 'Creami pint', tag: 'creami', servings: 1, servingLabel: 'pint', items: [] });
  $$('li[data-id]', root).forEach(li => (li.onclick = async () => openRecipe(await db.get('recipes', li.dataset.id))));
};
function openRecipe(r) {
  r = structuredClone(r);
  const b = sheet(`<form id="rf" class="form">
    <label>Name<input name="name" required value="${esc(r.name)}"></label>
    <div class="grid3"><label>Type<select name="tag"><option value="">Recipe</option><option value="creami" ${r.tag === 'creami' ? 'selected' : ''}>Creami</option></select></label>
    <label>Servings<input name="servings" type="number" step="any" inputmode="decimal" value="${r.servings}"></label><label>Serving name<input name="servingLabel" value="${esc(r.servingLabel)}"></label></div>
    <h4>Ingredients</h4><ul class="list" id="items"></ul>
    <button type="button" id="addI">＋ Ingredient</button>
    <div id="rtot" class="live"></div>
    <div class="actions">${r.id ? '<button type="button" class="danger" id="delR">Delete</button><button type="button" id="logR">Log a serving</button>' : ''}<button class="primary">Save</button></div></form>`, { title: r.id ? 'Edit recipe' : 'New recipe' });
  const form = $('#rf', b);
  const draw = () => {
    $('#items', b).innerHTML = r.items.map((it, i) => {
      const n = N.scale(it.n, it.qty * it.mult);
      return `<li><div class="grow"><div class="name">${esc(it.name)}</div><div class="sub">${macroLine(n)} · ${kcalOf(n)} kcal</div></div>
      <input class="iq" data-i="${i}" type="number" step="any" inputmode="decimal" value="${it.qty}"><span class="small">${esc(it.unit)}</span><button type="button" class="rm" data-i="${i}" aria-label="Remove">✕</button></li>`;
    }).join('');
    const t = N.zero(); r.items.forEach(it => N.add(t, N.scale(it.n, it.qty * it.mult)));
    const sv = Math.max(1, +form.servings.value || 1), per = N.scale(t, 1 / sv);
    $('#rtot', b).innerHTML = `<div>Total ${kcalOf(t)} kcal · ${macroLine(t)}</div><div class="kcal">Per ${esc(form.servingLabel.value)}: ${kcalOf(per)} kcal</div><div>${macroLine(per)}</div>`;
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
  form.onsubmit = async e => { e.preventDefault(); await db.put('recipes', { ...r, ...readForm() }); closeSheet(); toast('Recipe saved'); render(); };
  if (r.id) {
    $('#delR', b).onclick = async () => { await db.remove('recipes', r.id); closeSheet(); render(); };
    $('#logR', b).onclick = async () => {
      await db.put('recipes', { ...r, ...readForm() });
      const rf = (await recipeFoods()).find(x => x.id === r.id);
      openPortion(rf, { meal: 0 });
    };
  }
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
  const runs = rows.filter(r => r.type !== 'rest').length;
  const card = (k, v, sub = '') => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div>${sub ? `<div class="k">${sub}</div>` : ''}</div>`;
  const steps = rows.map(r => r.gd?.steps || 0);
  return `<div class="seg" id="range">${[7, 30, 90, 180].map(n => `<button data-n="${n}" class="${n === range ? 'on' : ''}">${n}d</button>`).join('')}</div>
  <section class="card"><div class="stats">
    ${card('Avg kcal', r0(avg('kcal')), 'goal ' + r0(avgGoal('kcal')))}${card('Avg protein', r0(avg('p')) + ' g', 'goal ' + r0(avgGoal('p')))}
    ${card('Avg carbs', r0(avg('c')) + ' g', 'goal ' + r0(avgGoal('c')))}${card('Avg fat', r0(avg('f')) + ' g', 'goal ' + r0(avgGoal('f')))}
    ${card('On target', logged.length ? Math.round((hit / logged.length) * 100) + '%' : '–', `${logged.length}/${range} days logged`)}
    ${card('Weight trend', wFirst != null ? (wLast - wFirst >= 0 ? '+' : '') + r1(wLast - wFirst) + ' lb' : '–', wLast != null ? 'now ' + r1(wLast) : '')}
    ${card('Measured TDEE', tdee ? r0(tdee) : '–', tdee ? 'from logs + weight' : 'needs 14+ days')}${card('Run days', runs, 'of ' + range)}
  </div></section>
  <section class="card"><h3>Calories vs goal</h3>${bars(rows.map(r => r.date), rows.map(r => r.kcal), rows.map(r => r.goal.kcal), { title: 'Calories vs goal' })}</section>
  <section class="card"><h3>Protein vs goal</h3>${bars(rows.map(r => r.date), rows.map(r => r.p), rows.map(r => r.goal.p), { title: 'Protein' })}</section>
  <section class="card"><h3>Weight</h3>${w.some(Number.isFinite) ? line(rows.map(r => r.date), w, { trend: wt, title: 'Weight', fmt: r1 }) : '<p class="muted">Log weight on the Today tab (Garmin scale weigh-ins show up too).</p>'}</section>
  ${steps.some(Boolean) ? `<section class="card"><h3>Steps</h3>${bars(rows.map(r => r.date), steps, null, { title: 'Steps' })}</section>
  <section class="card"><h3>Active calories (Garmin)</h3>${bars(rows.map(r => r.date), rows.map(r => r.gd?.activeKcal || 0), null, { title: 'Active kcal' })}</section>
  <section class="card"><h3>Sleep (h)</h3>${line(rows.map(r => r.date), rows.map(r => (r.gd?.sleepSec ? r.gd.sleepSec / 3600 : NaN)), { title: 'Sleep', fmt: r1 })}</section>` : ''}
  <section class="card"><h3>Macro split (avg)</h3>${split(avg('p'), avg('c'), avg('f'))}</section>`;
}
function split(p, c, f) {
  const k = { p: p * 4, c: c * 4, f: f * 9 }, t = k.p + k.c + k.f || 1;
  return `<div class="split">${['p', 'c', 'f'].map(x => `<div class="${x}" style="flex:${k[x] / t}">${Math.round((k[x] / t) * 100)}%</div>`).join('')}</div>`;
}
bind.trends = root => $$('#range button', root).forEach(b => (b.onclick = () => { local.set('range', +b.dataset.n); render(); }));

// ---------- Settings ----------
async function viewSettings() {
  const s = state.s, p = s.profile;
  const meta = await sync.garminMeta().catch(() => null);
  const dt = (k) => {
    const d = s.dayTypes[k], g = N.goalGrams(d), mk = r0(4 * g.p + 4 * g.c + 9 * g.f);
    return `<fieldset data-dt="${k}"><legend>${esc(d.label)} day</legend>
      <div class="grid2"><label>Calories<input name="kcal" type="number" inputmode="numeric" value="${d.kcal}"></label>
      <label>Macros by<select name="mode"><option value="g" ${d.mode === 'g' ? 'selected' : ''}>grams</option><option value="%" ${d.mode === '%' ? 'selected' : ''}>percent</option></select></label></div>
      <div class="grid3"><label>Protein ${d.mode === '%' ? '%' : 'g'}<input name="p" type="number" step="any" inputmode="decimal" value="${d.p}"></label>
      <label>Carbs ${d.mode === '%' ? '%' : 'g'}<input name="c" type="number" step="any" inputmode="decimal" value="${d.c}"></label>
      <label>Fat ${d.mode === '%' ? '%' : 'g'}<input name="f" type="number" step="any" inputmode="decimal" value="${d.f}"></label></div>
      <p class="small ${Math.abs(mk - d.kcal) > 30 ? 'warn' : 'muted'}">Macros add up to ${mk} kcal${Math.abs(mk - d.kcal) > 30 ? ` (calorie goal is ${d.kcal})` : ''}.</p></fieldset>`;
  };
  return `
  <section class="card"><h3>Goals</h3>
    <p class="muted small">Each day picks a target on its own: <b>long run</b> if Garmin shows a run of ${s.longRunMi}+ mi, <b>run</b> for any other run or workout, otherwise <b>rest</b>. Tap the chip on Today to override a day.</p>
    <form id="dts">${dt('rest')}${dt('run')}${dt('long')}</form>
    <button id="calc" class="primary">Recommend from my stats</button>
  </section>
  <section class="card"><h3>Profile</h3><form id="prof" class="form">
    <div class="grid3"><label>Sex<select name="sex"><option value="male" ${p.sex === 'male' ? 'selected' : ''}>male</option><option value="female" ${p.sex === 'female' ? 'selected' : ''}>female</option></select></label>
    <label>Age<input name="age" type="number" value="${p.age}"></label><label>Height in<input name="heightIn" type="number" step="0.5" value="${p.heightIn}"></label></div>
    <div class="grid3"><label>Weight lb<input name="weightLb" type="number" step="0.1" value="${p.weightLb}"></label>
    <label>Goal<select name="goal"><option value="cut" ${s.goal.type === 'cut' ? 'selected' : ''}>lose</option><option value="maintain" ${s.goal.type === 'maintain' ? 'selected' : ''}>maintain</option><option value="gain" ${s.goal.type === 'gain' ? 'selected' : ''}>gain</option></select></label>
    <label>lb / week<input name="rate" type="number" step="0.25" value="${s.goal.rateLbWk}"></label></div>
    <label>Daily movement outside workouts<select name="neat">${[[1.2, 'desk job, little walking'], [1.3, 'some walking'], [1.4, 'on your feet a lot'], [1.5, 'physical job']].map(([v, l]) => `<option value="${v}" ${+p.neat === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
  </form></section>
  <section class="card"><h3>Tracking</h3><form id="opts" class="form">
    <label class="check"><input type="checkbox" name="caloriesFromMacros" ${s.caloriesFromMacros ? 'checked' : ''}> Count calories from macros (4/4/9). Keeps totals consistent when labels disagree.</label>
    <label class="check"><input type="checkbox" name="netCarbs" ${s.netCarbs ? 'checked' : ''}> Show net carbs (carbs − fiber)</label>
    <div class="grid2"><label>Long run at (mi)<input name="longRunMi" type="number" step="0.5" value="${s.longRunMi}"></label>
    <label>Eat back Garmin exercise kcal %<input name="eatBackPct" type="number" min="0" max="100" step="5" value="${s.eatBackPct}"></label></div>
    <label>Meals (one name = a single running list for the day; commas = separate meals)<input name="meals" value="${esc(s.meals.join(', '))}"></label>
  </form></section>
  <section class="card"><h3>Sync & Garmin</h3><form id="gh" class="form">
    <label>GitHub token<input name="ghToken" type="password" autocomplete="off" value="${esc(local.get('ghToken', ''))}" placeholder="fine-grained token"></label>
    <div class="grid2"><label>Repo<input name="ghRepo" value="${esc(local.get('ghRepo', 'safaangit/safaan-personal'))}"></label><label>Branch<input name="ghBranch" value="${esc(local.get('ghBranch', ''))}" placeholder="repo default"></label></div>
    <p class="muted small">Food logs sync to <code>data/fuel/</code>. Garmin data comes from the nightly workflow into <code>data/garmin/</code>${meta?.lastSync ? `, last pulled ${new Date(meta.lastSync).toLocaleString()}${meta.backfillDone ? '' : ` (history back to ${meta.earliest || '…'}, still backfilling)`}` : ''}.</p>
    <div class="actions"><button type="button" id="syncNow">Sync now</button><button type="button" id="pullG">Pull Garmin now</button></div>
  </form></section>
  <section class="card"><h3>Food data & label reader</h3><form id="keys" class="form">
    <label>USDA API key (free at api.data.gov)<input name="usdaKey" autocomplete="off" value="${esc(local.get('usdaKey', ''))}" placeholder="DEMO_KEY is rate-limited"></label>
    <details><summary class="small">Optional: Claude API label reader (paid, not covered by Pro)</summary>
    <label>Anthropic API key<input name="anthropicKey" type="password" autocomplete="off" value="${esc(local.get('anthropicKey', ''))}" placeholder="leave empty to stay free"></label>
    <label>Claude model<input name="claudeModel" value="${esc(local.get('claudeModel', 'claude-opus-5-5'))}"></label></details>
    <p class="muted small">Keys stay on this phone and never sync to GitHub. With no Anthropic key, nothing here can cost money.</p>
  </form></section>
  <section class="card"><h3>Data</h3><div class="actions"><button id="export">Export everything (JSON)</button></div></section>`;
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
  $('#prof', root).onchange = async e => {
    const f = Object.fromEntries(new FormData(e.currentTarget));
    s.profile = { sex: f.sex, age: +f.age, heightIn: +f.heightIn, weightLb: +f.weightLb, neat: +f.neat };
    s.goal = { type: f.goal, rateLbWk: +f.rate };
    await db.saveSettings(s); toast('Profile saved');
  };
  $('#opts', root).onchange = async e => {
    const f = new FormData(e.currentTarget);
    Object.assign(s, { caloriesFromMacros: f.get('caloriesFromMacros') === 'on', netCarbs: f.get('netCarbs') === 'on', longRunMi: +f.get('longRunMi') || 10, eatBackPct: +f.get('eatBackPct') || 0,
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
    try { await sync.runGarminSync(); toast('Garmin sync started. Data lands in a few minutes.'); }
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
  const row = k => `<tr><th>${rec[k].label}</th><td>${rec[k].kcal}</td><td>${rec[k].p}</td><td>${rec[k].c}</td><td>${rec[k].f}</td></tr>`;
  const b = sheet(`<p class="small muted">Based on ${rec.basis}${runD.length ? `, ${runD.length} run days and ${longD.length} long runs from Garmin` : ''}. Protein ${s.goal.type === 'cut' ? '1.0' : '0.85'} g/lb, fat at least 0.3 g/lb or 25%, carbs fill the rest and rise with mileage.</p>
    <table class="tbl"><tr><th></th><th>kcal</th><th>P</th><th>C</th><th>F</th></tr>${row('rest')}${row('run')}${row('long')}</table>
    <p class="small muted">Long-run days get half the deficit so you can recover; check the numbers against how you feel and train.</p>
    <div class="actions"><button class="primary" id="apply">Apply these goals</button></div>`, { title: 'Recommended goals' });
  $('#apply', b).onclick = async () => {
    for (const k of ['rest', 'run', 'long']) s.dayTypes[k] = rec[k];
    await db.saveSettings(s); closeSheet(); toast('Goals updated'); render();
  };
}

// ---------- boot ----------
$$('nav button').forEach(b => (b.onclick = () => { if (b.dataset.tab === 'add') return openAdd(defaultMeal()); state.tab = b.dataset.tab; state.sel = state.fsel = null; render(); }));
function defaultMeal() {
  const h = new Date().getHours(), n = state.s?.meals.length || 1;
  return Math.min(n - 1, h < 15 ? 0 : h < 18 ? 1 : 2);
}
db.onChange(() => scheduleSync());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') runSync(); else scheduleSync(500); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
render().then(() => scheduleSync(300));
