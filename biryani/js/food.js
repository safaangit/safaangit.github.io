// Food lookup across your pantry, the bundled USDA whole-foods list, Open Food Facts and USDA
// FoodData Central, ranked by source quality, name match and whether calories agree with macros.
import { all, local } from './db.js';
import { check, gramUnits, scale } from './nutrition.js';

const usdaKey = () => local.get('usdaKey', '') || 'DEMO_KEY';
const timeout = (ms) => AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
// Answers are kept for the session: the free USDA demo key allows only ~30 lookups an hour.
const cached = new Map();
async function getJSON(url) {
  if (cached.has(url)) return cached.get(url);
  const r = await fetch(url, { signal: timeout(12000) });
  if (!r.ok) throw new Error(`${r.status} ${new URL(url).host}`);
  const d = await r.json();
  cached.set(url, d);
  return d;
}

// UPC-A (12) and EAN-13 with a leading 0 are the same product.
export function codeVariants(code) {
  const c = String(code).replace(/\D/g, '');
  const v = new Set([c, c.replace(/^0+/, '')]);
  if (c.length === 12) v.add('0' + c);
  if (c.length === 13 && c[0] === '0') v.add(c.slice(1));
  if (c.length === 14) v.add(c.slice(1)).add(c.slice(2));
  return [...v].filter(Boolean);
}
const sameCode = (a, b) => a && b && String(a).replace(/^0+/, '') === String(b).replace(/^0+/, '');

// ---- Open Food Facts ----
const OFF_FIELDS = 'code,product_name,brands,nutriments,serving_size,serving_quantity';
function fromOFF(p) {
  const m = p.nutriments || {};
  const kcal = m['energy-kcal_100g'] ?? (m['energy_100g'] ? m['energy_100g'] / 4.184 : undefined);
  const n = { kcal, p: m.proteins_100g, c: m.carbohydrates_100g, f: m.fat_100g, fib: m.fiber_100g, sug: m.sugars_100g, na: m.sodium_100g != null ? m.sodium_100g * 1000 : undefined };
  if (n.p == null && n.c == null && n.f == null) return null;
  const sq = +p.serving_quantity;
  const brand = Array.isArray(p.brands) ? p.brands[0] : (p.brands || '').split(',')[0];
  return {
    name: shortName(p.product_name || 'Unnamed product'), full: p.product_name, brand: brand?.trim(), barcode: p.code,
    n: clean(n), units: gramUnits(sq > 0 ? [{ label: `serving (${p.serving_size || Math.round(sq * 10) / 10 + ' g'})`, mult: sq / 100 }] : []),
    source: 'off', srcLabel: 'Open Food Facts', srcId: p.code,
  };
}
async function offBarcode(code) {
  for (const c of codeVariants(code)) {
    try {
      const d = await getJSON(`https://world.openfoodfacts.org/api/v2/product/${c}.json?fields=${OFF_FIELDS}`);
      if (d.status === 1 || d.product) { const f = d.product && fromOFF(d.product); if (f) return [f]; }
    } catch {}
  }
  return [];
}
async function offSearch(q) {
  const qs = encodeURIComponent(q);
  try {
    const d = await getJSON(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${qs}&search_simple=1&action=process&json=1&page_size=20&fields=${OFF_FIELDS}`);
    return (d.products || []).map(fromOFF).filter(Boolean);
  } catch {}
  try { // newer search service; may refuse cross-origin calls
    const d = await getJSON(`https://search.openfoodfacts.org/search?q=${qs}&page_size=15&fields=${OFF_FIELDS}&langs=en`);
    return (d.hits || []).map(fromOFF).filter(Boolean);
  } catch { return []; }
}

// ---- USDA FoodData Central ----
// Nutrient ids and the older "numbers", since search responses have used both.
const NID = { kcal: [1008, 2047, 2048, '208', '957', '958'], p: [1003, '203'], c: [1005, 1050, '205'], f: [1004, 1085, '204'], fib: [1079, '291'], sug: [2000, 1063, '269'], na: [1093, '307'] };
function fromUSDA(x) {
  const by = {};
  for (const n of x.foodNutrients || []) {
    if (/^kj$/i.test(n.unitName || n.nutrient?.unitName || '')) continue;
    const v = n.value ?? n.amount;
    const id = n.nutrientId ?? n.nutrient?.id, num = String(n.nutrientNumber ?? n.number ?? n.nutrient?.number ?? '');
    if (id != null) by[id] ??= v;
    if (num) by[num] ??= v;
  }
  const pick = ids => ids.map(i => by[i]).find(v => v != null);
  const n = Object.fromEntries(Object.entries(NID).map(([k, ids]) => [k, pick(ids)]));
  if (n.p == null && n.c == null && n.f == null) return null;
  const extra = [];
  const unit = (x.servingSizeUnit || '').toLowerCase();
  if (x.servingSize && (unit === 'g' || unit === 'grm' || unit === 'ml' || unit === 'mlt'))
    extra.push({ label: `serving (${x.householdServingFullText || x.servingSize + ' ' + unit})`, mult: x.servingSize / 100 });
  for (const m of x.foodMeasures || []) if (m.gramWeight > 0 && m.disseminationText && m.disseminationText !== 'Quantity not specified')
    extra.push({ label: `${m.disseminationText} (${Math.round(m.gramWeight)} g)`, mult: m.gramWeight / 100 });
  const generic = x.dataType !== 'Branded';
  return {
    name: shortName(titleCase(x.description)), full: x.description, brand: x.brandName || x.brandOwner, barcode: x.gtinUpc,
    n: clean(n), units: gramUnits(extra.slice(0, 6)),
    source: generic ? 'usda' : 'usda-b', srcLabel: generic ? `USDA ${x.dataType}` : 'USDA Branded', srcId: x.fdcId,
  };
}
async function usdaSearch(q, dataType) {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${usdaKey()}&query=${encodeURIComponent(q)}&pageSize=20` + (dataType ? `&dataType=${encodeURIComponent(dataType)}` : '');
  try { return ((await getJSON(url)).foods || []).map(fromUSDA).filter(Boolean); }
  catch (e) { if (String(e).startsWith('429')) usdaThrottled = true; return []; }
}
export let usdaThrottled = false;
async function usdaBarcode(code) {
  const hits = await usdaSearch(String(code).replace(/^0+/, ''), 'Branded');
  return hits.filter(h => sameCode(h.barcode, code));
}

// ---- Bundled whole foods ----
// app/generic.json (built by tools/generic_foods.js): ~5,000 plain foods per 100 g from USDA
// Foundation + SR Legacy, so "shrimp" or "chicken breast" works instantly, offline and without a key.
let genP;
function fromGeneric([id, name, full, kcal, p, c, f, fib, sug, na, por, pop]) {
  const units = por ? por.split('|').map(x => { const i = x.lastIndexOf(':'); return { label: x.slice(0, i), mult: +x.slice(i + 1) / 100 }; }) : [];
  return {
    name: name || full, full, n: clean({ kcal, p, c, f, fib, sug, na }), units: gramUnits(units),
    source: 'gen', srcLabel: 'USDA', srcId: id, pop,
  };
}
export function generic() {
  genP ??= fetch(new URL('../generic.json', import.meta.url)).then(r => r.json()).then(d => d.foods.map(fromGeneric)).catch(() => { genP = null; return []; });
  return genP;
}
async function genericSearch(q, brands) {
  const list = await generic();
  return list.filter(f => coverage(q, f, brands) >= 0.66).map(f => ({ f, s: score(q, f, brands) }))
    .sort((a, b) => b.s - a.s).slice(0, 15).map(x => x.f);
}

// ---- Ranking ----
const SRC_W = { mine: 1.3, recipe: 1.25, gen: 1.1, usda: 1.0, 'usda-b': 0.85, off: 0.7 };
const stem = w => (w.length > 3 ? w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '') : w);
// Words that say nothing about the food, including what speech adds ("yeah so", "no I said").
export const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'with', 'in', 'on', 'i', 'no', 'said', 'mean', 'meant', 'some', 'my', 'yeah', 'so', 'um', 'uh', 'okay', 'ok', 'like', 'had', 'ate']);
// Words that only say "the ordinary one" ("plain shrimp"): fine to have, never required.
const SOFT = new Set(['plain', 'fresh', 'natural', 'regular', 'unseasoned', 'organic', 'simple', 'just']);
// Cooking words match how USDA names the method ("cooked" finds "boiled", "roasted", "dry heat").
const SYN = {
  cooked: ['cooked', 'boiled', 'steamed', 'roasted', 'grilled', 'baked', 'broiled', 'stewed', 'braised', 'poached', 'heat', 'browned'],
  grilled: ['grilled', 'broiled', 'roasted', 'heat'], baked: ['baked', 'roasted', 'heat'], boiled: ['boiled', 'moist', 'steamed'],
  steamed: ['steamed', 'boiled', 'moist'], raw: ['raw', 'uncooked', 'dry'], uncooked: ['raw', 'uncooked', 'dry'], dry: ['dry', 'raw', 'uncooked'],
};
export const tokens = s => (s || '').toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(Boolean);
export function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// How well one query word matches a list of food words: whole word or word start counts fully
// ("cookie" finds "cookies", but "i" no longer matches every word with an i in it); a typo in a
// longer word ("drizzalicious" for Drizzilicious) counts most of the way.
export function wordHit(w, hay) {
  if (SYN[w] && hay.some(h => SYN[w].includes(h))) return 1;
  const s = stem(w);
  if (hay.some(h => h === w || h.startsWith(s) || stem(h) === s)) return 1;
  const tol = w.length >= 9 ? 2 : w.length >= 5 ? 1 : 0;
  return tol && hay.some(h => h[0] === w[0] && lev(w, h) <= tol) ? 0.85 : 0;
}
// Share of the query's food words found in a food (0-1). Brand words count double, so
// "yasso cookie dough" ranks Yasso bars above plain cookie dough.
const foodWords = q => { const w = tokens(q).filter(x => !STOP.has(x)), hard = w.filter(x => !SOFT.has(x)); return hard.length ? hard : w; };
const hayOf = f => (f._hay ??= [...tokens(f.full || f.name), ...tokens(f.brand)]); // the full name, so a shortened one keeps its flavor
export function coverage(q, f, brands) {
  const words = foodWords(q);
  if (!words.length) return tokens(q).length ? 0 : 1;
  const hay = hayOf(f);
  let got = 0, max = 0;
  for (const w of words) { const wt = brands && wordHit(w, brands) ? 2 : 1; max += wt; got += wt * wordHit(w, hay); }
  return got / max;
}
export function relevance(q, f, brands) {
  const first = foodWords(q)[0], name = tokens(f.name);
  const starts = first && name[0] && wordHit(first, [name[0]]) ? 0.15 : 0;
  const short = 0.2 / Math.max(1, (name.length + tokens(f.brand).length) / 4); // prefer "Chicken breast, cooked" over long descriptions
  return coverage(q, f, brands) + starts + short;
}
// Brand words from your foods and the results, minus words that also name foods ("Minute Rice" isn't a brand cue for rice).
export function brandWords(list, generic = []) {
  const common = new Set(generic.flatMap(f => tokens(f.name)));
  return [...new Set(list.flatMap(f => tokens(f.brand)))].filter(w => w.length >= 3 && !STOP.has(w) && !common.has(w));
}
// Not halal: sinks to the bottom rather than hiding, so a search for it still finds something.
const HARAM = /\b(pork|lard|gelatine?|wine|beer|rum|liqueur|whiske?y|vodka|bourbon|brandy|tequila|pepperoni|salami|prosciutto|chorizo|pancetta)\b|(?<!(turkey|beef|chicken) )\b(ham|bacon)\b/i;
export function score(q, f, brands) {
  const c = check(f.n);
  const complete = ['kcal', 'p', 'c', 'f'].every(k => f.n?.[k] != null) ? 1 : 0.7;
  const rel = relevance(q, f, brands), staple = f.pop && rel >= 1 ? 0.3 : 0; // shrimp, chicken breast, rice, eggs…
  return (rel + staple) * (SRC_W[f.source] || 0.6) * (c.ok ? 1 : 0.6) * complete * (HARAM.test(`${f.full || f.name} ${f.brand || ''}`) ? 0.3 : 1);
}
function dedupe(list) {
  const seen = new Map();
  for (const f of list) {
    const k = f.barcode ? 'b' + String(f.barcode).replace(/^0+/, '') : ['gen', 'usda'].includes(f.source) ? 'u' + f.srcId : 'n' + `${f.name}|${f.brand || ''}`.toLowerCase();
    if (!seen.has(k) || (SRC_W[f.source] || 0) > (SRC_W[seen.get(k).source] || 0)) seen.set(k, f);
  }
  return [...seen.values()];
}

export async function mine() {
  const foods = (await all('foods')).map(f => ({ ...f, source: 'mine', srcLabel: f.verified ? 'Yours ✓' : 'Yours' }));
  return foods;
}

// Barcode: your pantry first; otherwise every candidate from OFF + USDA.
export async function byBarcode(code) {
  const own = (await mine()).filter(f => codeVariants(code).some(v => sameCode(v, f.barcode)));
  if (own.length) return { own, found: own };
  const [off, usda] = await Promise.all([offBarcode(code), usdaBarcode(code)]);
  const found = [...usda, ...off].map(f => ({ ...f, barcode: f.barcode || code }));
  found.sort((a, b) => score('', b) - score('', a));
  return { own: [], found };
}

// Text: generic USDA data is the most accurate for whole foods (bundled, plus the live API when
// you've added your own key); brands come from USDA Branded + OFF.
export async function search(q, { recipes = [] } = {}) {
  const ql = q.trim(), pantry = await mine();
  const [api, br, off, bundled] = await Promise.all([
    local.get('usdaKey', '') ? usdaSearch(ql, 'Foundation,SR Legacy,Survey (FNDDS)') : [], // saves the demo key's ~10/hour for brands
    usdaSearch(ql, 'Branded'),
    offSearch(ql),
    genericSearch(ql),
  ]);
  const gen = [...bundled, ...api];
  const brands = brandWords([...pantry, ...br, ...off], [...gen, ...pantry]);
  const own = [...pantry, ...recipes.map(r => ({ ...r, source: 'recipe', srcLabel: r.tag === 'creami' ? 'Creami' : r.tag === 'prep' ? 'Meal prep' : 'Recipe' }))]
    .filter(f => relevance(ql, f, brands) >= 0.99);
  const remote = dedupe([...gen, ...br, ...off]).map(f => ({ f, s: score(ql, f, brands) })).sort((a, b) => b.s - a.s).map(x => x.f);
  own.sort((a, b) => score(ql, b, brands) - score(ql, a, brands));
  return { own, remote: remote.slice(0, 30), brands };
}

// Per-serving preview for list rows.
export function preview(f) {
  if (f.source === 'gen') return { unit: { label: '100 g', mult: 1 }, n: f.n }; // you weigh these
  const u = f.units?.find(x => x.label.startsWith('serving')) || f.units?.find(x => !['g', 'oz'].includes(x.label)) ||
    (f.units?.some(x => x.label === 'g') ? { label: '100 g', mult: 1 } : f.units?.[0] || { label: 'serving', mult: 1 });
  return { unit: u, n: scale(f.n, u.mult) };
}

// Branded database names can be a whole ingredient list; keep the first clause of really long
// ones, but leave "Frozen Greek Yogurt Bar, Chocolate Chip Cookie Dough" whole.
export function shortName(s = '') {
  let n = s.trim();
  if (n.length > 60 && n.includes(',')) n = n.split(',')[0].trim();
  if (n.length > 64) n = n.slice(0, 62).replace(/\s+\S*$/, '') + '…';
  return n;
}
function clean(n) {
  return Object.fromEntries(Object.entries(n).filter(([, v]) => v != null && !Number.isNaN(+v)).map(([k, v]) => [k, +v]));
}
function titleCase(s = '') {
  return s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
