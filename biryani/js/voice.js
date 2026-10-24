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
];
const unitOf = w => UNIT.find(([re]) => re.test(w))?.[1];
const numOf = w => (/^\d+(\.\d+)?$/.test(w) ? +w : /^\d+\/\d+$/.test(w) ? w.split('/')[0] / w.split('/')[1] : NUMS[w]);

// Splits a transcript into { text, qty, unit } items.
export function parseItems(raw) {
  return raw
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')           // "8,5" -> 8.5
    .replace(/(\d)\s*point\s*(\d)/g, '$1.$2') // "8 point 5"
    .replace(/(\d)(g|oz|ml|lbs?|kg)\b/g, '$1 $2')
    .replace(/\b(\d+(?:\.\d+)?|one|two|three|four|five|six)\s+and\s+a\s+half\b/g, (_, n) => String(numOf(n) + 0.5))
    .split(/\s*(?:,|;|\n|\.(?!\d)|\band then\b|\bthen\b|\balso\b|\band\b(?=\s+(?:\d|a |an |one|two|three|half)))\s*/)
    .map(seg => seg.replace(/[–—-]/g, ' ').replace(/\b(of|with|about|around|like|i had|i ate|plus)\b/g, ' ').trim())
    .filter(Boolean)
    .map(seg => {
      const words = seg.split(/\s+/);
      let qty, unit;
      const name = [];
      for (let i = 0; i < words.length; i++) {
        const w = words[i], n = numOf(w);
        if (n != null && qty == null && (w !== 'a' && w !== 'an' || unitOf(words[i + 1] || ''))) {
          qty = n;
          const u = unitOf(words[i + 1] || '');
          if (u) { unit = u; i++; }
          continue;
        }
        if (!unit && qty != null && unitOf(w)) { unit = unitOf(w); continue; }
        name.push(w);
      }
      return { text: name.join(' ').replace(/^(a|an|some|the)\s+/, '').trim(), qty: qty ?? 1, unit };
    })
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
export function listen({ onText, onEnd }) {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new R();
  rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true;
  let final = '';
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript + ', ';
      else interim += e.results[i][0].transcript;
    }
    onText(final + interim);
  };
  rec.onend = () => onEnd?.(final);
  rec.onerror = e => onEnd?.(final, e.error);
  rec.start();
  return rec;
}
