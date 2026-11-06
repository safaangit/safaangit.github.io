// Optional AI helper: Google's Gemini API on its free tier sorts brain dumps (Tasks capture, Quick add) and
// splits spoken food lists. The app's own rules always run first and show instantly; Gemini only replaces their
// result when it answers in time with something that checks out. No key, off, offline, over the limit, slow or
// odd answer: the rules result simply stays. Nothing waits on Gemini for more than a moment.
//
// Device-only settings (localStorage via `local`, never synced): geminiKey, aiTasks, aiFood (default on once a key
// is set), aiCap (daily calls, default 200), aiModel. Usage: aiUse = { day (Pacific date), n, last: {ms, ok, at} },
// aiBlock = { until (ms), why }. Google resets free daily quotas at midnight Pacific time.
// Free tier: Google may use what's sent to improve its products and people may review it, so only the capture text
// or the spoken food list goes out, never logs, weights, goals or Garmin data.
import { local } from './db.js';

const API = 'https://generativelanguage.googleapis.com/v1beta/models/';
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite'; // free tier, stable (Google's model list, checked 2026-11-06)
export const DEFAULT_CAP = 200;
const TIMEOUT = 6000;
const PER_MIN = 12;

const pacificDay = (t = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(t);
// Next midnight Pacific, in ms.
function nextReset(now = Date.now()) {
  const day = pacificDay(now);
  let t = now + 36e5;
  while (pacificDay(t) === day) t += 36e5;
  while (pacificDay(t - 6e4) !== day) t -= 6e4; // walk back to the first minute of the new day
  return t;
}

export const key = () => String(local.get('geminiKey', '') || '').trim();
export const model = () => String(local.get('aiModel', '') || '').trim() || DEFAULT_MODEL;
export const cap = () => Math.max(1, +local.get('aiCap', DEFAULT_CAP) || DEFAULT_CAP);
export const wants = what => !!key() && local.get(what === 'food' ? 'aiFood' : 'aiTasks', true) !== false;

export function usage(now = Date.now()) {
  const u = local.get('aiUse', null) || {};
  return u.day === pacificDay(now) ? { n: u.n || 0, last: u.last || null } : { n: 0, last: u.last || null };
}
const recent = [];
// Every call counts toward today's total, failed or not, since Google counts the request either way.
function count(last) {
  const u = usage();
  local.set('aiUse', { day: pacificDay(), n: u.n + (last.counted ? 1 : 0), last: { ms: last.ms, ok: last.ok, at: Date.now(), why: last.why || '' } });
}
function block(ms, why) { local.set('aiBlock', { until: Date.now() + ms, why }); }
export const resetsAt = () => nextReset();

// Can a call go out right now? { ok, why } where why is a short reason for Settings and the preview.
export function ready(what) {
  if (!key()) return { ok: false, why: 'no key' };
  if (what && !wants(what)) return { ok: false, why: 'off' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, why: 'offline' };
  const b = local.get('aiBlock', null);
  if (b && b.until > Date.now()) return { ok: false, why: b.why };
  if (usage().n >= cap()) return { ok: false, why: 'daily cap reached' };
  const now = Date.now();
  while (recent.length && now - recent[0] > 6e4) recent.shift();
  if (recent.length >= PER_MIN) return { ok: false, why: 'busy, a minute' };
  return { ok: true };
}

// One JSON call. Returns the parsed object or throws.
async function ask(prompt, schema, { signal } = {}) {
  recent.push(Date.now());
  const t0 = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  signal?.addEventListener('abort', () => ctl.abort());
  try {
    const r = await fetch(`${API}${encodeURIComponent(model())}:generateContent`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key() },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseJsonSchema: schema },
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = d.error?.message || `Gemini ${r.status}`;
      if (r.status === 429) {
        // Per-day quota: wait for Google's midnight-Pacific reset. Per-minute: back off a minute.
        if (/per\s*day|PerDay|daily/i.test(JSON.stringify(d))) block(nextReset() - Date.now(), 'Google daily limit reached');
        else block(6e4, 'busy, a minute');
      } else if (r.status === 400 && /api key/i.test(msg) || r.status === 401 || r.status === 403) block(365 * 864e5, 'key not accepted: check it in Settings');
      else if (r.status === 404) block(365 * 864e5, `model "${model()}" not found: check it in Settings`);
      else if (r.status >= 500) block(12e4, 'Gemini is down, retrying in 2 min');
      const e = new Error(msg); e.status = r.status; throw e;
    }
    const text = (d.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
    const out = JSON.parse(text);
    count({ counted: true, ms: Math.round(performance.now() - t0), ok: true });
    return out;
  } catch (e) {
    const why = e.name === 'AbortError' ? 'too slow, used the app\'s sorting' : e.message;
    count({ counted: true, ms: Math.round(performance.now() - t0), ok: false, why });
    throw e;
  } finally { clearTimeout(timer); }
}

// ---------- checks: Gemini's answer has to be made of what was said ----------
const wordsOf = s => (s.toLowerCase().match(/[a-z]+|\d+(?:\.\d+)?/g) || []);
// Every real word in `piece` was in the input (or is one of the few words the app's own format adds).
const ADDED = new Set(['idea', 'buy', 'note', 'ref', 'the', 'a', 'an', 'and', 'to', 'of', 'at', 'on', 'for', 'in', 'by', 'with', 'my', 'from', 'g', 'oz', 'ml', 'lb', 'kg']);
export function madeOf(piece, input) {
  const have = new Set(wordsOf(input));
  const stems = [...have].map(w => w.replace(/(?:es|s)$/, ''));
  return wordsOf(piece).every(w => have.has(w) || ADDED.has(w) || stems.includes(w.replace(/(?:es|s)$/, '')) || /^\d/.test(w));
}

// ---------- Tasks capture ----------
const KINDS = ['task', 'grocery', 'food'];
const TASK_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, kind: { type: 'string', enum: KINDS } }, required: ['text', 'kind'] } } },
  required: ['items'],
};
function taskPrompt(text) {
  return `You sort a quick brain dump typed or spoken into a personal to-do app. Split it into separate items and label each one.
kind: "task" = something to do, remember, watch, read or an idea; "grocery" = a food or household item to buy at a grocery store; "food" = a log of food just eaten with amounts (e.g. "chicken 8 oz, rice 150 g" stays ONE food item).
Rules:
- Use only the person's own words. Never add, guess or correct facts. Don't translate dates; keep date and time words in the item ("call dad friday 5pm").
- A heading applies to each piece under it: "claude code - use cases, gmail export" -> "Claude code: use cases", "Claude code: gmail export". "groceries: milk, eggs" -> two groceries.
- Ideas keep the prefix "idea: ". A leading or trailing "!" (urgent) stays on its item.
- Groceries: just the item, with any quantity or store the person said ("2 milk aldi"). Split "eggs and milk" into two.
- Keep clauses that only explain an item attached to it ("pay rent, but only after payday" is one task).
- Drop filler ("um", "also", "oh and"). Don't merge separate things.
Brain dump:
"""${text}"""`;
}
export async function sortCapture(text, opts) {
  const d = await ask(taskPrompt(text), TASK_SCHEMA, opts);
  const items = (d.items || []).map(it => ({ text: String(it.text || '').trim().replace(/[\s,;.]+$/, ''), kind: KINDS.includes(it.kind) ? it.kind : 'task' })).filter(it => it.text);
  if (!items.length || items.length > 40 || !items.every(it => madeOf(it.text, text))) throw new Error('answer did not match what you wrote');
  return items;
}

// ---------- Spoken food list ----------
export const FOOD_UNITS = ['g', 'oz', 'lb', 'ml', 'kg', 'cup', 'tbsp', 'tsp', 'serving', 'slice', 'scoop', 'piece', 'pint', 'bar', 'can', 'packet', 'container', 'bowl', 'wedge', 'bottle', 'handful'];
const FOOD_SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string', enum: [...FOOD_UNITS, 'none'] } }, required: ['name', 'unit'] } } },
  required: ['items'],
};
function foodPrompt(text) {
  return `Split this spoken list of food someone ate into items for a calorie logger.
For each item: name = the food words only as said (brand included, lowercase, no amount, no filler like "um", "I had"); qty = the number said (digits; "half" = 0.5, "a"/"an" = 1, "8 and a half" = 8.5), omit if none; unit = one of ${FOOD_UNITS.join(', ')} or "none" when no unit was said ("2 eggs" = qty 2, unit none).
If they correct themselves ("no I meant", "actually", "scratch that"), keep only the corrected version. "mac and cheese" is one food; "eggs and toast" is two. Never invent foods or amounts.
Spoken list:
"""${text}"""`;
}
export async function parseFood(text, opts) {
  const d = await ask(foodPrompt(text), FOOD_SCHEMA, opts);
  const items = (d.items || []).map(it => {
    const unit = FOOD_UNITS.includes(it.unit) ? it.unit : undefined, has = typeof it.qty === 'number' && it.qty > 0;
    return { text: String(it.name || '').toLowerCase().replace(/^(a|an|some|the)\s+/, '').trim(), qty: has ? it.qty : 1, unit, given: has || !!unit };
  }).filter(it => it.text);
  if (!items.length || items.length > 40 || !items.every(it => madeOf(it.text, text))) throw new Error('answer did not match what you said');
  return items;
}

// A tiny call for the Settings "Test" button: { ok, ms, msg }.
export async function test() {
  const t0 = performance.now();
  try {
    const items = await sortCapture('call dad friday, milk, eggs');
    return { ok: true, ms: Math.round(performance.now() - t0), msg: `${items.length} items back` };
  } catch (e) { return { ok: false, ms: Math.round(performance.now() - t0), msg: e.message }; }
}

// ---------- shared plumbing for the live previews ----------
// One answer per exact text, so retyping or re-rendering never spends a second call.
const memo = new Map();
// Starts (or reuses) a call for `text`. Returns a promise of items, or null when it can't run.
export function start(what, text) {
  const k = what + '\u0000' + text;
  if (memo.has(k)) return memo.get(k);
  if (!ready(what).ok) return null;
  const p = (what === 'food' ? parseFood(text) : sortCapture(text)).catch(() => null);
  memo.set(k, p);
  if (memo.size > 30) memo.delete(memo.keys().next().value);
  p.then(v => { if (!v) memo.delete(k); }); // a failed call can be retried later (e.g. after a timeout)
  return p;
}
// The answer for `text` if it's already in, else waits at most `ms` for a call in flight. Never starts one.
export async function settled(what, text, ms = 1500) {
  const p = memo.get(what + '\u0000' + text);
  if (!p) return null;
  return Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
}

// Worth a call? Short single things ("milk", "call dad") are already sorted fine by the rules.
export const worthIt = (text, ruleCount) => text.trim().split(/\s+/).length >= 6 || ruleCount >= 3 || /[,;\n]/.test(text) && text.trim().split(/\s+/).length >= 4;

// Status line for Settings and the preview.
export function statusText() {
  if (!key()) return 'Off: no Gemini key on this phone. The app sorts everything itself.';
  const r = ready(), u = usage(), reset = new Date(nextReset()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const last = u.last ? ` · last call ${u.last.ok ? `${(u.last.ms / 1000).toFixed(1)} s` : `failed (${u.last.why || 'error'})`}` : '';
  return `${r.ok ? 'Ready' : `Paused: ${r.why}`} · ${u.n} of ${cap()} calls today (resets ${reset})${last}`;
}
