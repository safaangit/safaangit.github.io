// Food lookup across your pantry, Open Food Facts and USDA FoodData Central,
// ranked by source quality, name match and whether calories agree with macros.
import { all, local } from './db.js';
import { check, gramUnits, scale } from './nutrition.js';

const usdaKey = () => local.get('usdaKey', '') || 'DEMO_KEY';
const timeout = (ms) => AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
async function getJSON(url) {
  const r = await fetch(url, { signal: timeout(12000) });
  if (!r.ok) throw new Error(`${r.status} ${new URL(url).host}`);
  return r.json();
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
    name: p.product_name || 'Unnamed product', brand: brand?.trim(), barcode: p.code,
    n: clean(n), units: gramUnits(sq > 0 ? [{ label: `serving (${p.serving_size || sq + ' g'})`, mult: sq / 100 }] : []),
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
    name: titleCase(x.description), brand: x.brandName || x.brandOwner, barcode: x.gtinUpc,
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

// ---- Ranking ----
const SRC_W = { mine: 1.3, recipe: 1.25, usda: 1.0, 'usda-b': 0.85, off: 0.7 };
function relevance(q, f) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${f.name} ${f.brand || ''}`.toLowerCase();
  if (!words.length) return 1;
  const hits = words.filter(w => hay.includes(w)).length / words.length;
  const starts = hay.startsWith(words[0]) ? 0.15 : 0;
  const short = 0.2 / Math.max(1, hay.split(/\s+/).length / 4); // prefer "Chicken breast, cooked" over long descriptions
  return hits + starts + short;
}
export function score(q, f) {
  const c = check(f.n);
  const complete = ['kcal', 'p', 'c', 'f'].every(k => f.n?.[k] != null) ? 1 : 0.7;
  return relevance(q, f) * (SRC_W[f.source] || 0.6) * (c.ok ? 1 : 0.6) * complete;
}
function dedupe(list) {
  const seen = new Map();
  for (const f of list) {
    const k = f.barcode ? 'b' + String(f.barcode).replace(/^0+/, '') : 'n' + `${f.name}|${f.brand || ''}`.toLowerCase();
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

// Text: generic USDA data is the most accurate for whole foods; brands come from USDA Branded + OFF.
export async function search(q, { recipes = [] } = {}) {
  const ql = q.trim();
  const own = [...(await mine()), ...recipes.map(r => ({ ...r, source: 'recipe', srcLabel: r.tag === 'creami' ? 'Creami' : 'Recipe' }))]
    .filter(f => relevance(ql, f) >= 0.99);
  const [gen, br, off] = await Promise.all([
    usdaSearch(ql, 'Foundation,SR Legacy,Survey (FNDDS)'),
    usdaSearch(ql, 'Branded'),
    offSearch(ql),
  ]);
  const remote = dedupe([...gen, ...br, ...off]).map(f => ({ f, s: score(ql, f) })).sort((a, b) => b.s - a.s).map(x => x.f);
  own.sort((a, b) => score(ql, b) - score(ql, a));
  return { own, remote: remote.slice(0, 30) };
}

// Per-serving preview for list rows.
export function preview(f) {
  const u = f.units?.find(x => x.label.startsWith('serving')) || f.units?.find(x => !['g', 'oz'].includes(x.label)) ||
    (f.units?.some(x => x.label === 'g') ? { label: '100 g', mult: 1 } : f.units?.[0] || { label: 'serving', mult: 1 });
  return { unit: u, n: scale(f.n, u.mult) };
}

function clean(n) {
  return Object.fromEntries(Object.entries(n).filter(([, v]) => v != null && !Number.isNaN(+v)).map(([k, v]) => [k, +v]));
}
function titleCase(s = '') {
  return s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
