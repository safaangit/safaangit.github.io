// Explore: halal food ideas (Cook), restaurant help and a halal map (Eat out), and grocery deals (Deals).
// Split out of Baro's Biryani on 2026-10-31 so it can grow on its own. It lives on the same site
// (safaangit.github.io/explore/), so it shares Biryani's IndexedDB ('fuel'), GitHub token and synced data:
// recipes you save and meals you log here show up in Biryani after the next sync.
// db.js, sync.js and nutrition.js are copies of app/js/ in Biryani; keep them identical.
import * as db from './db.js';
import { today, monthOf, local, kv } from './db.js';
import * as N from './nutrition.js';
import { r0, r1 } from './nutrition.js';
import * as sync from './sync.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const addDays = (d, k) => today(new Date(new Date(d + 'T12:00').getTime() + k * 864e5));
const nowTime = () => new Date().toTimeString().slice(0, 5);
const fmtDate = d => d === today() ? 'Today' : d === addDays(today(), -1) ? 'Yesterday' : new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const BIRYANI = '../biryani/';

const ICONS = {
  cook: '<path d="M4 11h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M2 11h20M8 7c0-1 1-1.5 1-2.5M12 7c0-1 1-1.5 1-2.5M16 7c0-1 1-1.5 1-2.5"/>',
  out: '<path d="M3 2v7c0 1.1.9 2 2 2h2a2 2 0 0 0 2-2V2M6 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
  deals: '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><path d="M7 7h.01"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  youtube: '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 9 5 3-5 3z"/>',
  reddit: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  web: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  map: '<path d="m1 6 7-4 8 4 7-4v16l-7 4-8-4-7 4z"/><path d="M8 2v16M16 6v16"/>',
  nav: '<path d="m3 11 19-9-9 19-2-8z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
  locate: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/>',
};
const ico = k => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;

const TABS = ['cook', 'out', 'deals'];
const state = { s: null, tab: TABS.includes(local.get('exMode')) ? local.get('exMode') : 'cook' };
const bind = {};

// ---------- shell ----------
async function render() {
  state.s = await db.settings();
  local.set('exMode', state.tab);
  $$('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  $('main').innerHTML = await views[state.tab]();
  bind[state.tab]?.($('main'));
  syncBadge();
}
let syncErr = null, syncFails = 0, syncTimer;
function syncBadge(msg) {
  const el = $('#sync');
  if (!sync.configured()) { el.textContent = 'local only'; el.className = ''; return; }
  if (msg) { el.textContent = msg; el.className = ''; return; }
  if (syncErr) { el.textContent = 'not synced ⟳'; el.className = 'warn'; return; }
  const t = local.get('lastSync', 0);
  el.textContent = t ? '✓ ' + new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'not synced';
  el.className = '';
}
function scheduleSync(ms = 6000) { clearTimeout(syncTimer); syncTimer = setTimeout(runSync, ms); }
async function runSync() {
  if (!sync.configured()) return;
  syncBadge('syncing…');
  try { const r = await sync.sync(); syncErr = null; syncFails = 0; syncBadge(); if (r.pulled && !$('.sheet-wrap')) render(); }
  catch (e) {
    syncErr = navigator.onLine === false ? "Offline. What you log is saved on this phone and syncs when you're back online." : e.message;
    syncBadge(); scheduleSync(Math.min(5 * 60e3, 15e3 * 2 ** syncFails++));
  }
}
$('#sync').onclick = () => {
  if (!sync.configured()) return toast('Sync is set up in Baro\'s Biryani → Settings; Explore uses the same connection.');
  if (syncErr) toast(syncErr.length > 140 ? 'Sync failed; retrying now.' : syncErr);
  runSync();
};
function toast(msg, { action, onAction } = {}) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show'); t.classList.toggle('act', !!action);
  if (action) {
    const btn = document.createElement('button'); btn.textContent = action;
    btn.onclick = () => { t.classList.remove('show'); onAction(); };
    t.append(btn);
  }
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), action ? 5000 : Math.min(5000, Math.max(2200, msg.length * 55)));
}
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

// ---------- macro display (same look as Biryani) ----------
function macroLine(n, s = state.s) {
  const c = s.netCarbs ? Math.max(0, (n.c || 0) - (n.fib || 0)) : n.c;
  return `<span class="macros">${s.netCarbs ? 'NC' : 'C'}: <b class="c">${r1(c)}</b>P: <b class="p">${r1(n.p)}</b>F: <b class="f">${r1(n.f)}</b></span>`;
}
const kcalOf = n => r0(N.countedKcal(n, state.s.caloriesFromMacros));
function leftLine(rem) {
  const amt = (v, u) => `${r0(Math.abs(v))}${u} ${v < 0 ? 'over' : 'left'}`;
  return `<span class="leftline"><b class="${rem.kcal < 0 ? 'neg' : ''}">${amt(rem.kcal, ' kcal')}</b> · <span class="p">P ${amt(rem.p, ' g')}</span> · <span class="c">${state.s.netCarbs ? 'NC' : 'C'} ${amt(rem.c, ' g')}</span> · <span class="f">F ${amt(rem.f, ' g')}</span></span>`;
}
// Once you're out of calories, only lean protein still "fits" (60%+ of its calories from protein, 250 kcal or less).
const outOfKcal = rem => rem.kcal <= 50;
const isLean = (n, k) => k > 0 && k <= 250 && (n.p * 4) / k >= 0.6;
const fitsLeft = (n, k, rem) => outOfKcal(rem) ? rem.p >= 15 && isLean(n, k) : k <= rem.kcal + 40 && n.f <= Math.max(rem.f, 0) + 4;
const netC = t => Math.max(0, t.c - (t.fib || 0));
const unitText = l => (/^serving \((.*)\)$/.exec(l || '')?.[1] || l || '').replace(/\d+\.\d{2,}/g, m => String(Math.round(m * 10) / 10));
const row2 = (nameHtml, n, subHtml) => `<div class="r1"><span class="name">${nameHtml}</span><span class="kc">${kcalOf(n)}</span></div><div class="r2"><span class="sub">${subHtml}</span>${macroLine(n)}</div>`;
const qtyText = (q, unit) => { const u = unitText(unit); return /^\d/.test(u) ? (r1(q) === 1 ? u : `${r1(q)} × ${u}`) : `${r1(q)} ${u}`; };

// What's left today. Today's goals depend on Garmin exercise and the week budget, which only Biryani
// works out, so Biryani saves them (fuel:goalsToday) each time it shows Today; the eaten part is read here.
async function leftToday() {
  const g = local.get('goalsToday', null);
  if (!g) return null;
  const s = state.s, entries = (await db.all('log/' + monthOf(today()))).filter(e => e.date === today());
  const tot = N.entryTotals(entries, s.caloriesFromMacros);
  return { kcal: g.kcal - tot.kcal, p: g.p - tot.p, c: g.c - (s.netCarbs ? netC(tot) : tot.c), f: g.f - tot.f, stale: g.date !== today(), from: g.date };
}
const staleNote = rem => (rem?.stale ? `<br><span class="small">Goals from ${esc(fmtDate(rem.from))}; open Baro's Biryani to refresh today's.</span>` : '');

// ---------- logging into Biryani ----------
function defaultMeal() {
  const h = new Date().getHours(), n = state.s?.meals.length || 1;
  return Math.min(n - 1, h < 15 ? 0 : h < 18 ? 1 : 2);
}
// Recipe nutrition per serving (nested recipes and your own foods' current numbers), like Biryani's recipeFoods.
async function recipeN(r) {
  const recipes = new Map((await db.all('recipes')).map(x => [x.id, x])), foods = new Map((await db.all('foods')).map(f => [f.id, f]));
  const per = (r, depth = 0) => {
    const t = N.zero();
    for (const it of r.items || []) {
      let n = it.n;
      if (it.recipeId && recipes.has(it.recipeId) && depth < 5) n = per(recipes.get(it.recipeId), depth + 1);
      else if (it.foodId && foods.has(it.foodId)) n = foods.get(it.foodId).n;
      N.add(t, N.scale(n, it.qty * it.mult));
    }
    return N.scale(t, 1 / Math.max(1, +r.servings || 1));
  };
  return per(r);
}
// Amount sheet: servings in, live macros, then one entry in today's log (Biryani's log entry shape).
function openLog({ name, n, unit = 'serving', recipeId, src }) {
  const b = sheet(`<div class="pv logv"><div class="pname">${esc(name)}</div>${src ? `<div class="pbrand"><span class="badge src-recipe">${esc(src)}</span></div>` : ''}
    <div id="live" class="pmac"></div>
    <div class="qtyrow"><input id="qty" type="number" min="0" inputmode="decimal" step="any" value="1"><div class="unitlbl">× ${esc(unitText(unit))}</div></div>
    <div class="uchips">${[0.5, 1, 1.5, 2].map(q => `<button data-q="${q}">${q}</button>`).join('')}</div>
    <div class="pacts"><button class="primary" id="go">Log to today</button></div>
    <p class="muted small">Goes into today's list in Baro's Biryani.</p></div>`, { title: 'Log it' });
  const qty = $('#qty', b);
  const upd = () => {
    const q = Math.max(0, +qty.value || 0), m = N.scale(n, q), col = (k, v, l) => `<div class="${k}"><b>${v}</b><span>${l}</span></div>`;
    $('#live', b).innerHTML = col('c', r1(state.s.netCarbs ? netC(m) : m.c), state.s.netCarbs ? 'Net carbs' : 'Carbs') + col('p', r1(m.p), 'Protein') + col('f', r1(m.f), 'Fat') + col('k', kcalOf(m), 'Calories');
    $$('.uchips button', b).forEach(x => x.classList.toggle('on', +x.dataset.q === q));
    $('#go', b).disabled = !(q > 0);
  };
  qty.oninput = upd;
  $$('.uchips button', b).forEach(x => (x.onclick = () => { qty.value = x.dataset.q; upd(); }));
  upd();
  $('#go', b).onclick = async () => {
    const q = Math.round((+qty.value || 0) * 1000) / 1000, d = today();
    await db.put('log/' + monthOf(d), { date: d, time: nowTime(), meal: defaultMeal(), name, recipeId, qty: q, unit, mult: 1, n });
    // Biryani hides cleared-out recents; logging something again brings it back, same as there.
    const key = recipeId || 'n:' + name.toLowerCase(), s = state.s;
    if ((s.hiddenRecents || []).includes(key)) await db.saveSettings({ ...s, hiddenRecents: s.hiddenRecents.filter(k => k !== key) });
    closeSheet();
    toast(`Logged ${name}`, { action: 'Open Biryani', onAction: () => (location.href = BIRYANI) });
    scheduleSync(1500);
    if (state.tab === 'cook' && local.get('exChip') === 'fits') render();
  };
}

// ---------- Cook ----------
// Curated halal ideas (ideas.json), each linked to the YouTube / Reddit / recipe-site posts behind it.
let ideasP;
const loadIdeas = () => (ideasP ??= fetch('ideas.json').then(r => r.json()).catch(() => { ideasP = null; return { ideas: [], buys: {} }; }));
const EX_CHIPS = [['you', 'For you'], ['sale', 'On sale'], ['fits', 'Fits today'], ['meal', 'Meals'], ['sweet', 'Sweets'], ['snack', 'Snacks'], ['hack', 'Hacks']];
const CAT = { meal: 'Meal', sweet: 'Sweet', snack: 'Snack' };
const LINK = { youtube: 'YouTube', reddit: 'Reddit', web: 'Recipe' };

async function exploreData() {
  const [{ ideas, buys }, foods, recipes, deals] = await Promise.all([loadIdeas(), db.all('foods'), db.all('recipes'), allDeals()]);
  const byId = new Map(foods.map(f => [f.id, f]));
  // Log names from the last ~60 days, counted, so "because you eat X" names your most frequent match.
  const names = new Map(), cutoff = addDays(today(), -60);
  for (const m of new Set([0, -31, -62].map(k => monthOf(addDays(today(), k)))))
    for (const e of await db.all('log/' + m)) if (e.date >= cutoff) names.set(e.name, (names.get(e.name) || 0) + 1);
  const pantry = foods.map(f => f.name);
  const list = ideas.map(x => {
    // Use your own food's current numbers when the idea uses one of your foods.
    const items = x.items.map(it => (it.foodId && byId.has(it.foodId) ? { ...it, n: byId.get(it.foodId).n } : it));
    const n = N.zero(); items.forEach(it => N.add(n, N.scale(it.n, it.qty * it.mult)));
    const re = new RegExp(x.like, 'i');
    const hits = [...names].filter(([nm]) => re.test(nm)).sort((a, b) => b[1] - a[1]);
    const owned = items.filter(it => it.foodId && byId.has(it.foodId)).length;
    const because = hits[0]?.[0] || pantry.find(nm => re.test(nm));
    const xd = deals.filter(d => x.buys?.includes(d.buy));
    return { ...x, links: x.links || [], items, n, k: N.countedKcal(n, state.s.caloriesFromMacros), because, owned,
      score: hits.reduce((t, h) => t + h[1], 0) * 2 + (because ? 3 : 0) + owned,
      saved: recipes.find(r => r.explore === x.id), deals: xd, sale: xd.filter(d => d.until) };
  });
  return { list, buys, deals };
}
// "On sale at Giant" for an idea whose ingredients are in this week's ads.
const saleBadge = x => (x.sale.length ? `<span class="badge deal">On sale at ${esc([...new Set(x.sale.map(d => shortStore(d.store)))].slice(0, 2).join(', '))}</span>` : '');
const shortStore = s => s.replace(/ Food Stores| Markets/i, '');

function liveSearch(root, sel, key) {
  const q = $(sel, root); if (!q) return;
  q.oninput = () => { state[key] = q.value; clearTimeout(q._t); q._t = setTimeout(async () => { await render(); const n = $(sel); n.focus(); n.setSelectionRange(99, 99); }, 350); };
  q.onkeydown = e => { if (e.key === 'Enter') q.blur(); };
}
async function viewCook() {
  const chip = EX_CHIPS.some(c => c[0] === local.get('exChip')) ? local.get('exChip') : 'you', q = (state.exQ || '').trim().toLowerCase();
  const { list } = await exploreData();
  let shown = q ? list.filter(x => `${x.name} ${x.items.map(i => i.name).join(' ')}`.toLowerCase().includes(q)) : list, note = '', empty = 'Nothing matches.';
  const density = (a, b) => b.n.p / b.k - a.n.p / a.k;
  if (chip === 'you') shown = [...shown].sort((a, b) => b.score + (b.sale.length ? 2 : 0) - a.score - (a.sale.length ? 2 : 0) || density(a, b));
  else if (chip === 'sale') { shown = shown.filter(x => x.sale.length).sort(density); empty = "None of this week's ads have an idea's ingredients yet. Deals refresh every time you open the Deals tab."; }
  else if (chip === 'fits') {
    const rem = await leftToday();
    if (!rem) { shown = []; empty = "Open Today in Baro's Biryani once, and Explore will know what's left today."; }
    else {
      shown = shown.filter(x => fitsLeft(x.n, x.k, rem)).sort((a, b) => b.n.p - a.n.p);
      empty = outOfKcal(rem) && rem.p < 15 ? 'Calories and protein are covered today. Nothing to add.' : "None of the ideas fit what's left today.";
      note = `<p class="hint">Today: ${leftLine(rem)}${outOfKcal(rem) && rem.p >= 15 ? '<br>Out of calories, so only lean protein shows.' : ''}${staleNote(rem)}</p>`;
    }
  } else shown = shown.filter(x => (chip === 'hack' ? x.hack : x.cat === chip)).sort(density);
  state.exShown = shown;
  const sub = x => [CAT[x.cat], ...new Set(x.links.map(l => LINK[l.t]))].join(' · ');
  const row = (x, i) => `<li class="food idea" data-i="${i}"><div class="grow">${row2(esc(x.name), x.n, esc(sub(x)))}
    ${chip === 'you' && x.because ? `<div class="bc">Because you eat ${esc(x.because.split(',')[0])}</div>` : ''}
    ${x.sale.length && chip !== 'sale' ? `<div class="why">${saleBadge(x)}</div>` : chip === 'sale' ? `<div class="why">${x.sale.slice(0, 2).map(d => `<span class="badge deal">${esc(shortStore(d.store))}: ${esc(d.price || d.promo || 'in the ad')}</span>`).join(' ')}</div>` : ''}</div></li>`;
  return `<div class="row eoq"><input id="exQ" type="search" placeholder="Search ideas or an ingredient" value="${esc(state.exQ || '')}" enterkeyhint="search"></div>
    <div class="chips" id="exChips">${EX_CHIPS.map(([k, l]) => `<button data-c="${k}" class="${k === chip ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${note}
    ${shown.length ? `<ul class="list card ideas">${shown.map(row).join('')}</ul>` : `<p class="muted pad">${empty}</p>`}
    ${chip === 'fits' ? `<a class="btn wide" href="${BIRYANI}?do=fits">${ico('pie')}What fits from my own foods</a>` : ''}
    <p class="muted small">All halal: vegetarian, seafood or halal meat, no gelatin or alcohol. Macros are worked out from labels for the amounts listed. Tap an idea for the videos and posts it came from.</p>`;
}
bind.cook = root => {
  liveSearch(root, '#exQ', 'exQ');
  $$('#exChips button', root).forEach(b => (b.onclick = () => { local.set('exChip', b.dataset.c); render(); }));
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
    <div class="actions">${x.kind === 'buy' ? '' : `<button id="iSave" ${x.saved ? 'disabled' : ''}>${x.saved ? 'In my recipes ✓' : 'Save to my recipes'}</button>`}<button class="primary" id="iLog">Log it</button></div>`, { title: x.name });
  $('#iLog', b).onclick = async () => openLog(x.saved
    ? { name: x.saved.name, n: await recipeN(x.saved), unit: x.saved.servingLabel || 'serving', recipeId: x.saved.id, src: 'My recipe' }
    : { name: x.name, n: x.n, unit: x.serving || (x.items.length === 1 ? x.items[0].unit : 'serving'), src: 'Explore' });
  const sv = $('#iSave', b);
  if (sv && !x.saved) sv.onclick = async () => {
    x.saved = await db.put('recipes', { name: x.name, servings: 1, servingLabel: x.serving || 'serving',
      items: x.items.map(({ foodId, name, brand, qty, unit, mult, n }) => ({ foodId, name, brand, qty, unit, mult, n })), explore: x.id });
    sv.textContent = 'In my recipes ✓'; sv.disabled = true;
    toast("Saved to My recipes in Baro's Biryani");
    scheduleSync(1500);
  };
}

// ---------- Deals ----------
// Two sources. Synced: data/fuel/deals.json, written Wed + Sat by tools/food_deals.js (weekly ads
// plus Slickdeals). Live: Flipp, the weekly-ad backend, answers browsers directly, so this tab
// re-checks the ads for your staples whenever it's been 6+ hours, and can search any product.
const ZIP = '16823'; // Bellefonte, PA
// Stores worth driving to; Flipp also returns pet stores, pharmacies, etc. Same list as tools/food_deals.js.
const STORES = /^(giant food stores|weis markets|aldi|walmart|sam'?s club|target|costco)\b/i;
const LIVE_MS = 6 * 3600e3;
const norm = s => s.toLowerCase().replace(/[’'-]/g, '').replace(/[^a-z0-9 ]/g, ' ');
function flyerPrice(i) {
  const pre = (i.pre_price_text || '').trim(), post = (i.post_price_text || '').trim(), cur = i.current_price;
  if (cur == null) return '';
  const n = pre.match(/^(\d+)\s*(?:\/|for)/i)?.[1];
  let t = n ? `${n} for $${cur}` : `$${cur}`;
  if (/^\/?\s*lb/i.test(post)) t += '/lb';
  else if (/club|card|coupon/i.test(post)) t += ' with ' + (/coupon/i.test(post) ? 'e-coupon' : 'card');
  return t;
}
// valid_to is midnight Eastern written in UTC ("2026-11-06T04:59:59Z"), so read it as a local date.
const adDate = s => (s ? today(new Date(s)) : '');
async function flipp(q) {
  const r = await fetch(`https://backflipp.wishabi.com/flipp/items/search?locale=en-us&postal_code=${ZIP}&q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error(`Weekly ads answered ${r.status}`);
  return ((await r.json()).items || []).filter(i => i.name && STORES.test((i.merchant_name || '').trim()) && adDate(i.valid_to) >= today());
}
const toDeal = (i, buy) => {
  const promo = (i.sale_story || '').trim();
  return { id: 'fl-' + i.flyer_item_id, buy, title: i.name, price: flyerPrice(i), promo: promo && promo !== 'None' ? promo : undefined,
    store: i.merchant_name.trim(), date: adDate(i.valid_from), until: adDate(i.valid_to), src: i.merchant_name.trim() + ' weekly ad', img: i.clean_image_url?.replace('/extra_large.', '/large.') };
};
// Re-checks every staple in ideas.json "buys" (34 searches, a few at a time). Kept on this phone only.
let liveP;
function refreshLive({ force = false } = {}) {
  return (liveP ??= (async () => {
    const cur = (await kv.get('ex:live')) || { at: 0, deals: [] };
    if (!force && Date.now() - cur.at < LIVE_MS) return cur;
    const { buys } = await loadIdeas(), jobs = Object.entries(buys).flatMap(([key, b]) => b.q.map(q => [key, q]));
    const out = new Map();
    let ok = 0;
    for (let i = 0; i < jobs.length; i += 6) {
      await Promise.all(jobs.slice(i, i + 6).map(async ([key, q]) => {
        const words = norm(q).split(/\s+/).filter(Boolean);
        try {
          for (const it of await flipp(q)) if (words.every(w => norm(it.name).includes(w))) out.set('fl-' + it.flyer_item_id, toDeal(it, key));
          ok++;
        } catch {}
      }));
    }
    if (!ok) throw new Error("Couldn't reach the weekly ads. Check your connection.");
    const d = { at: Date.now(), deals: [...out.values()] };
    await kv.set('ex:live', d);
    return d;
  })().finally(() => (liveP = null)));
}
// Synced + live, de-duplicated by Flipp item id. Ad deals count until the ad ends; online ones for 45 days.
async function allDeals() {
  const [synced, live] = await Promise.all([db.all('deals'), kv.get('ex:live')]);
  const by = new Map(synced.map(d => [d.id, d]));
  for (const d of live?.deals || []) by.set(d.id, { ...by.get(d.id), ...d });
  return [...by.values()].filter(d => (d.until ? d.until >= today() : d.date >= addDays(today(), -45)))
    .sort((a, b) => !!b.until - !!a.until || b.date.localeCompare(a.date));
}
const ago = t => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
function dealRow(d, buys, { store = true } = {}) {
  // "until Thu" within the week; a date for longer promos, so "Mon" never means a month out.
  const ends = d.until && new Date(d.until + 'T12:00').toLocaleDateString(undefined, d.until <= addDays(today(), 6) ? { weekday: 'short' } : { month: 'short', day: 'numeric' });
  const sub = d.until ? [store && d.store, ends && 'until ' + ends] : [buys?.[d.buy]?.name, fmtDate(d.date), d.src];
  const img = d.img ? `<img class="dimg" src="${esc(d.img)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  const body = `${img}<div class="grow"><div class="name">${esc(d.title)}</div>${d.until && (d.price || d.promo) ? `<div class="deal-p">${esc([d.price, d.promo].filter(Boolean).join(' · '))}</div>` : ''}<div class="sub">${esc(sub.filter(Boolean).join(' · '))}</div></div>`;
  return d.url ? `<li><a href="${esc(d.url)}" target="_blank" rel="noopener">${body}<span class="chev">›</span></a></li>` : `<li class="ad">${body}</li>`;
}
const untilLine = ds => { const u = ds.map(d => d.until).sort()[0]; return u ? 'until ' + new Date(u + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : ''; };
// Grouped by store; the same item twice in one ad (two flyer pages) shows once.
const byStore = ds => {
  const m = new Map(), seen = new Set();
  for (const d of ds) {
    const k = [d.store, d.title, d.price].join('|').toLowerCase();
    if (!seen.has(k)) { seen.add(k); m.set(d.store, [...(m.get(d.store) || []), d]); }
  }
  return [...m].sort((a, b) => b[1].length - a[1].length);
};
const storeCards = (groups, buys) => groups.map(([st, ds]) => `<section class="card deals"><header><h3>${esc(st)}</h3><span class="muted small">${untilLine(ds)}</span></header><ul class="list">${ds.map(d => dealRow(d, buys, { store: false })).join('')}</ul></section>`).join('');

async function viewDeals() {
  const [{ buys }, deals, live] = await Promise.all([loadIdeas(), allDeals(), kv.get('ex:live')]);
  const order = Object.keys(buys);
  const ads = deals.filter(d => d.until).sort((a, b) => order.indexOf(a.buy) - order.indexOf(b.buy)), online = deals.filter(d => !d.until).slice(0, 8);
  const s = state.adSearch;
  const status = state.liveErr ? `<span class="warn">${esc(state.liveErr)}</span>` : liveP ? 'Checking this week\'s ads…' : live?.at ? `Ads checked ${ago(live.at)}` : 'Ads not checked on this phone yet';
  return `<div class="row eoq"><input id="adQ" type="search" placeholder="Search this week's ads (e.g. chicken breast)" value="${esc(s?.q || '')}" enterkeyhint="search"><button class="primary" id="adGo">${ico('search')}</button></div>
    ${s ? s.loading ? '<p class="muted pad">Searching the weekly ads…</p>' : s.err ? `<p class="warn">${esc(s.err)}</p>`
      : `<h4 class="eoh">“${esc(s.q)}” in ads near Bellefonte</h4>${s.hits.length ? storeCards(byStore(s.hits)) : '<p class="muted pad">No store near you has it in this week\'s ad.</p>'}<button class="link" id="adClear">Back to your staples</button>` : ''}
    ${s ? '' : `<div class="dstatus"><span class="muted small">${status}</span><button class="link" id="adRefresh">${ico('refresh')}Refresh</button></div>
    <h4 class="eoh">Your staples on sale</h4>
    ${ads.length ? storeCards(byStore(ads), buys) : `<p class="muted pad">${liveP ? '' : 'None of your staples are in this week\'s ads.'}</p>`}
    ${online.length ? `<section class="card deals"><header><h3>Online (Slickdeals)</h3></header><ul class="list">${online.map(d => dealRow(d, buys)).join('')}</ul></section>` : ''}
    <p class="muted small">Weekly ads near Bellefonte (Giant, Weis, ALDI, Walmart, Target, Sam's Club, Costco) for what you buy: ${esc(Object.values(buys).map(b => b.name).join(', '))}. Ads are re-checked when you open this tab (every 6 hours at most); Slickdeals syncs Wednesdays and Saturdays.</p>`}`;
}
async function liveRefresh(force) {
  state.liveErr = null;
  const before = (await kv.get('ex:live'))?.at, p = refreshLive({ force });
  if (state.tab === 'deals' && !state.adSearch) render();
  let fresh = false;
  try { fresh = (await p).at !== before; } catch (e) { state.liveErr = e.message; }
  // Redraw with the new ads, unless you're typing or have something open.
  if ((fresh || state.tab === 'deals') && !state.adSearch && !$('.sheet-wrap') && !document.activeElement?.matches('input, textarea')) render();
}
bind.deals = root => {
  const go = async () => {
    const q = $('#adQ', root).value.trim();
    if (!q) return;
    state.adSearch = { q, loading: true }; await render();
    try {
      const words = norm(q).split(/\s+/).filter(Boolean);
      const hits = (await flipp(q)).map(i => toDeal(i)).filter(d => words.some(w => norm(d.title).includes(w)));
      state.adSearch = { q, hits };
    } catch (e) { state.adSearch = { q, err: e.message }; }
    render();
  };
  $('#adGo', root).onclick = go;
  $('#adQ', root).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('#adQ', root).blur(); go(); } };
  $('#adQ', root).oninput = e => { if (!e.target.value && state.adSearch) { state.adSearch = null; render(); } };
  $('#adClear', root)?.addEventListener('click', () => { state.adSearch = null; render(); });
  $('#adRefresh', root)?.addEventListener('click', () => liveRefresh(true));
};

// ---------- Eat out ----------
// Cuisine playbooks (eatout.json) work for any place; saved restaurant guides with halal detail live in
// data/fuel/places.json, written by Claude (.claude/skills/eat-out). The halal map reads data/halal/us.json.
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
  const fitsHint = f.includes('fits') ? rem ? `<p class="hint">Left today: <b>${r0(rem.kcal)}</b> kcal · ${macroLine(rem)}${staleNote(rem)}</p>` : '<p class="hint">Open Today in Baro\'s Biryani once, and Explore will know what\'s left today.</p>' : '';
  return `<div class="row eoq"><input id="eoQ" type="search" placeholder="Restaurant, town or cuisine" value="${esc(state.eoQ || '')}" enterkeyhint="search"><button class="primary" id="eoAsk">Ask Claude</button></div>
    <div class="chips" id="eoChips">${EO_CHIPS.map(([k, l]) => `<button data-c="${k}" class="${f.includes(k) ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${fitsHint}
    <button class="mapcard" id="eoMap">${ico('map')}<div class="grow"><div class="name">Halal map</div><div class="sub">${hd.all.length ? `${hd.all.length.toLocaleString()} US places${nCert ? ` · ${nCert} HMS certified` : ''}` : 'Loads after your next sync'}</div></div><span class="chev">›</span></button>
    ${near.length ? `<h4 class="eoh">${q.length >= 3 ? 'Halal places' : 'Halal near you'}</h4><ul class="list card ideas">${near.map((p, i) => hpRow(p, i, here)).join('')}</ul>`
      : !here && !q ? `<button class="wide" id="eoLoc">${ico('locate')}Show halal places near me</button>` : ''}
    ${ps.length ? `<h4 class="eoh">Your guides</h4><ul class="list card ideas">${ps.map(placeRow).join('')}</ul>` : ''}
    ${cs.length ? `<h4 class="eoh">Any place, by cuisine</h4><ul class="list card ideas">${cs.map(cuisineRow).join('')}</ul>` : ''}
    ${!ps.length && !cs.length && !near.length && q ? `<p class="muted pad">Nothing saved for “${esc(state.eoQ)}” yet. Ask Claude and it'll research the menu and halal status.</p>` : ''}
    <button class="wide" id="eoPhoto">${ico('camera')}Order from a menu photo</button>
    <p class="muted small">Published = the chain's own nutrition data; Estimate = portions guessed from the menu, usually within ~15%. Halal labels say where they come from: HMS certifies hand-slaughtered meat; open map data only says a place serves halal. Always confirm in person.</p>`;
}
bind.out = root => {
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

const logOrder = (where, o) => openLog({ name: `${o.name} (${where})`, n: o.n, unit: 'order', src: 'Eat out' });
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
  if (!rem) return 'I want high protein for the calories.';
  const amt = (v, u, what) => `${r0(Math.abs(v))}${u} ${what} ${v < 0 ? 'over' : 'left'}`;
  const line = `Today so far: ${[amt(rem.kcal, ' kcal', 'calories'), amt(rem.p, ' g', 'protein'), amt(rem.c, ' g', 'carbs'), amt(rem.f, ' g', 'fat')].join(', ')}.`;
  return line + (outOfKcal(rem) ? " I'm already at or over my calories, so I want the lightest, leanest high-protein option (or tell me to skip it)." : ' I want high protein for the calories.');
}
// Hands the question to Claude (free on your plan) with macros left and halal rules filled in.
async function openAsk({ place = '', cuisine = '', photo = false } = {}) {
  const rem = await leftToday(), f = local.get('eoF', []);
  const where = place || (cuisine ? `a ${cuisine} restaurant` : '');
  const b = sheet(`<label>Restaurant (name + town)<input id="aPlace" value="${esc(place)}" placeholder="${cuisine ? `${cuisine} place in…` : 'e.g. Penn Pide, State College'}"></label>
    ${photo ? '<p class="hint">Open Claude copies this prompt and opens a new chat: paste it, attach your menu photo or screenshot, then send.</p>' : ''}
    <label>Prompt<textarea id="aText" rows="9"></textarea></label>
    <div class="actions"><button id="aCopy">Copy</button><button class="primary" id="aGo">Open Claude</button></div>
    <p class="muted small">Opens a Claude chat, which is included in your plan. For the full research (saved to this app), send it in your project instead.</p>`, { title: photo ? 'Menu photo' : 'Ask Claude' });
  const build = () => {
    const w = $('#aPlace', b).value.trim() || where;
    const diet = [f.includes('veg') && 'vegetarian', f.includes('fish') && 'fish/seafood'].filter(Boolean);
    return [
      `What should I order at ${w || 'this restaurant'}?${photo ? ' I attached a photo of the menu.' : ''}`,
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

// ---------- boot ----------
const views = { cook: viewCook, out: viewEatOut, deals: viewDeals };
$$('nav button').forEach(b => {
  b.insertAdjacentHTML('afterbegin', ico(b.dataset.tab));
  b.onclick = () => {
    if (b.dataset.tab === state.tab) return scrollTo({ top: 0, behavior: 'smooth' });
    state.tab = b.dataset.tab; scrollTo(0, 0); render();
    if (state.tab === 'deals') liveRefresh(false);
  };
});
db.onChange(() => scheduleSync());
addEventListener('online', () => scheduleSync(500));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') return runSync();
  scheduleSync(500);
  if (state.tab === 'deals') liveRefresh(false);
});
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
// ?tab=cook|out|deals (home-screen shortcuts)
const startTab = new URL(location.href).searchParams.get('tab');
if (TABS.includes(startTab)) { state.tab = startTab; history.replaceState(null, '', location.pathname); }
render().then(() => {
  scheduleSync(300);
  // Ads are re-checked in the background on open (at most every 6 hours), so "On sale" is current on any tab.
  liveRefresh(false);
});
