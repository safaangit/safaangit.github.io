// Nutrient math. n = { kcal, p, c, f, fib, sug, na(mg) } for one "base" of a food
// (100 g when grams are known, otherwise one serving). Units scale the base by `mult`.

export const KEYS = ['kcal', 'p', 'c', 'f', 'fib', 'sug', 'na'];
export const zero = () => Object.fromEntries(KEYS.map(k => [k, 0]));
export const scale = (n, m) => Object.fromEntries(KEYS.map(k => [k, (+n?.[k] || 0) * m]));
export function add(a, b) { for (const k of KEYS) a[k] += +b?.[k] || 0; return a; }

// Atwater from macros. Fiber counts ~2 kcal/g, which US labels mostly assume.
export const macroKcal = n => 4 * (n.p || 0) + 4 * Math.max(0, (n.c || 0) - (n.fib || 0)) + 2 * (n.fib || 0) + 9 * (n.f || 0);
const plainKcal = n => 4 * (n.p || 0) + 4 * (n.c || 0) + 9 * (n.f || 0);

// Flags foods whose listed calories don't line up with their macros.
export function check(n) {
  if (!n || !(n.kcal > 0)) return { ok: !!n && (n.p || n.c || n.f) > 0, missingKcal: true, est: macroKcal(n || {}) };
  const est = macroKcal(n), est2 = plainKcal(n);
  const diff = Math.min(Math.abs(n.kcal - est), Math.abs(n.kcal - est2));
  const pct = diff / Math.max(n.kcal, 1);
  return { ok: pct <= 0.12 || diff <= 10, pct, est: Math.round(est), listed: Math.round(n.kcal) };
}

// Calories the app counts: macro-derived when the setting is on, else the label.
export const countedKcal = (n, fromMacros) => (fromMacros || !(n.kcal > 0) ? macroKcal(n) : n.kcal);

export function entryTotals(entries, fromMacros) {
  const t = zero();
  for (const e of entries) {
    const n = scale(e.n, e.qty * e.mult);
    n.kcal = countedKcal(n, fromMacros);
    add(t, n);
  }
  return t;
}

export const r0 = x => Math.round(+x || 0);
export const r1 = x => Math.round((+x || 0) * 10) / 10;

// Goal grams for a day type ({ kcal, mode:'g'|'%', p, c, f }).
export function goalGrams(dt) {
  if (dt.mode === '%') return { kcal: dt.kcal, p: (dt.kcal * dt.p) / 400, c: (dt.kcal * dt.c) / 400, f: (dt.kcal * dt.f) / 900 };
  return { kcal: dt.kcal, p: dt.p, c: dt.c, f: dt.f };
}

// Standard units every gram-based food gets.
export function gramUnits(extra = []) {
  const u = [...extra, { label: 'g', mult: 0.01 }, { label: 'oz', mult: 0.2835 }];
  const seen = new Set();
  return u.filter(x => x.mult > 0 && !seen.has(x.label) && seen.add(x.label));
}
