// Voice / free-text logging: "chicken 8.5 oz, milk 24 grams, 2 eggs" -> items with
// amounts, matched against your foods and recents first, then the food databases.
import { relevance } from './food.js';

const NUMS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, half: 0.5, quarter: 0.25 };
const UNIT = [
  [/^(g|gs|gram|grams|gr)$/, 'g'], [/^(oz|ounce|ounces)$/, 'oz'], [/^(lb|lbs|pound|pounds)$/, 'lb'],
  [/^(ml|milliliter|milliliters|millilitre|millilitres)$/, 'ml'], [/^(kg|kilo|kilos|kilogram|kilograms)$/, 'kg'],
  [/^(cup|cups)$/, 'cup'], [/^(tbsp|tablespoon|tablespoons)$/, 'tbsp'], [/^(tsp|teaspoon|teaspoons)$/, 'tsp'],
  [/^(serving|servings|portion|portions)$/, 'serving'], [/^(slice|slices)$/, 'slice'], [/^(scoop|scoops)$/, 'scoop'],
  [/^(piece|pieces|pc|pcs)$/, 'piece'], [/^(pint|pints)$/, 'pint'], [/^(bar|bars)$/, 'bar'], [/^(can|cans)$/, 'can'],
  [/^(packet|packets|pack|packs|package|packages|pouch|pouches)$/, 'packet'], [/^(container|containers|cartons?)$/, 'container'],
  [/^(bowl|bowls)$/, 'bowl'], [/^(bottle|bottles)$/, 'bottle'], [/^(handful|handfuls)$/, 'handful'],
];
const unitOf = w => UNIT.find(([re]) => re.test(w))?.[1];
const numOf = w => (/^\d+(\.\d+)?$/.test(w) ? +w : /^\d+\/\d+$/.test(w) ? w.split('/')[0] / w.split('/')[1] : NUMS[w]);
const FILLER = /^(of|um|uh|like|about|around|plus|also|then|i|had|ate|and)$/;

// Splits a transcript into { text, qty, unit } items. Works with or without commas:
// "22 grams eggs 2 packets ketchup 1 pound chicken" and "chicken 8 oz rice 150 g" both split
// at each amount, pairing it with the words before it (name first) or after it (amount first).
export function parseItems(raw) {
  const chunks = raw
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')           // "8,5" -> 8.5
    .replace(/(\d)\s*point\s*(\d)/g, '$1.$2') // "8 point 5"
    .replace(/(\d)(g|oz|ml|lbs?|kg)\b/g, '$1 $2')
    .replace(/\b(\d+(?:\.\d+)?|one|two|three|four|five|six)\s+and\s+a\s+half\b/g, (_, n) => String(numOf(n) + 0.5))
    .replace(/[–—-]/g, ' ')
    .split(/\s*(?:,|;|\n|\.(?!\d))\s*/);
  const items = [];
  for (const chunk of chunks) {
    const words = chunk.split(/\s+/).filter(Boolean);
    let open = null; // item still waiting for its name (amount came first) or its amount (name came first)
    const close = () => { if (open) { if (open.name.length) items.push(open); open = null; } };
    for (let i = 0; i < words.length; i++) {
      const w = words[i], n = numOf(w), nextUnit = unitOf(words[i + 1] || '');
      if (n != null && (!['a', 'an'].includes(w) || nextUnit)) {
        const q = { qty: n, unit: nextUnit };
        if (nextUnit) i++;
        if (open && open.name.length && open.qty == null) { Object.assign(open, q); close(); }
        else { close(); open = { name: [], ...q }; }
        continue;
      }
      if (/^(then|also|plus|and)$/.test(w) && open && open.qty != null && open.name.length) { close(); continue; } // "creami then a banana"
      if (FILLER.test(w) && !(open && open.name.length && words[i + 1] && numOf(words[i + 1]) == null)) continue;
      if (open && open.qty != null && open.name.length && !open.namedAfter) close();
      if (!open) open = { name: [], qty: null };
      if (open.qty != null) open.namedAfter = true;
      open.name.push(w);
    }
    close();
  }
  return items
    .map(it => ({ text: it.name.join(' ').replace(/^(a|an|some|the)\s+/, '').replace(/\s+(and|of)$/, '').trim(), qty: it.qty ?? 1, unit: it.unit }))
    .filter(it => it.text);
}

// Grams in a unit label like "serving (57 g)" or "1 cup, chopped (140 g)".
const gramsIn = label => { const m = /([\d.]+)\s*g\b/.exec(label || ''); return m ? +m[1] : null; };

// Turns a spoken amount into { qty, unit (label), mult } for this food's units.
export function resolveAmount(food, qty, unit) {
  const units = food.units?.length ? food.units : [{ label: 'serving', mult: 1 }];
  const find = l => units.find(u => u.label === l);
  const g = find('g');
  const toGrams = { g: 1, kg: 1000, ml: 1, oz: 28.35, lb: 453.6 }[unit];
  if (toGrams) {
    if (unit === 'oz' && find('oz')) return { qty, unit: 'oz', mult: find('oz').mult };
    if (g) return { qty: Math.round(qty * toGrams * 10) / 10, unit: 'g', mult: g.mult };
    // Per-serving food: convert through the serving's grams when the label says them.
    const sv = units.find(u => gramsIn(u.label));
    if (sv) return { qty: Math.round(((qty * toGrams) / gramsIn(sv.label)) * 100) / 100, unit: sv.label, mult: sv.mult };
  }
  if (unit && unit !== 'serving') {
    const u = units.find(x => x.label.toLowerCase().includes(unit));
    if (u) return { qty, unit: u.label, mult: u.mult };
  }
  const sv = units.find(u => u.label.startsWith('serving')) || units.find(u => !['g', 'oz'].includes(u.label)) || units[0];
  return { qty, unit: sv.label, mult: sv.mult };
}

// Best local match (your foods, recipes, recent entries). Returns { food, score } or null.
export function bestLocal(text, candidates) {
  let best = null;
  for (const f of candidates) {
    const s = relevance(text, f) + (f.verified ? 0.05 : 0) + (f._uses || 0) * 0.01;
    if (!best || s > best.score) best = { food: f, score: s };
  }
  return best && best.score >= 0.8 ? best : null;
}

// Web Speech API (Chrome on Android uses Google's free recognizer; no key needed).
export const speechSupported = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
// Android Chrome resends earlier text inside later results, so each result is folded into the
// previous one when one contains the other. Recognition auto-restarts after pauses until stop().
const norm = t => t.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim();
function fold(list, t) {
  const last = list[list.length - 1];
  if (last && norm(t).startsWith(norm(last))) list[list.length - 1] = t;
  else if (!last || !norm(last).startsWith(norm(t))) list.push(t);
}
export function listen({ onText, onEnd }) {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  let committed = [], session = [], stopped = false, rec;
  const text = (interim = '') => { const all = [...committed, ...session]; if (interim) fold(all, interim); return all.join(', '); };
  const start = () => {
    rec = new R();
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true;
    rec.onresult = e => {
      session = []; let interim = '';
      for (const r of e.results) { const t = r[0].transcript.trim(); if (!t) continue; if (r.isFinal) fold(session, t); else interim = t; }
      onText(text(interim));
    };
    rec.onerror = e => { if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)) { stopped = true; onEnd?.(text(), e.error); } };
    rec.onend = () => {
      session.forEach(t => fold(committed, t)); session = [];
      if (stopped) return onEnd?.(text());
      try { start(); } catch { onEnd?.(text()); }
    };
    rec.start();
  };
  start();
  return { stop() { stopped = true; try { rec.stop(); } catch { onEnd?.(text()); } } };
}
