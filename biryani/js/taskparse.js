// Quick capture parsing for the Tasks tab, with no network and no AI:
//  - dates, times, repeats and reminders pulled out of a messy note ("call dad tmrw 5pm", "ps plus ends jan 1 2027")
//  - task vs grocery vs food log, so one capture box handles all three
//  - grocery aisle, store ("soup aldi"), and duplicate detection ("pickles" = "dill pickle spears")
// Pure functions: tools/test_taskparse.js runs them in node.

const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (d, k) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + k, 12); return x; };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// Sun / Sat / Wed alone are ordinary words ("sun glasses", "sat down"), so those need the full name.
const DAY_RE = '(sunday|mon(?:day)?|tue(?:s|sday)?|weds|wednesday|thu(?:r|rs|rsday)?|fri(?:day)?|saturday)';
const dayIdx = w => DAYS.indexOf(w.slice(0, 3).toLowerCase());
const monIdx = w => MONTHS.indexOf(w.slice(0, 3).toLowerCase());
const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1, couple: 2, few: 3 };
const num = w => (/^\d+$/.test(w) ? +w : NUMW[w]);

// Next date with weekday `wd`, today included unless `skipToday`.
function nextDow(now, wd, skipToday = false) {
  let k = (wd - now.getDay() + 7) % 7;
  if (k === 0 && skipToday) k = 7;
  return at(now, k);
}
// "next friday" = the Friday of next week (weeks start Monday).
function nextWeekDow(now, wd) {
  const toMon = (8 - now.getDay()) % 7 || 7; // days until next Monday
  return at(now, toMon + ((wd + 6) % 7));
}
function monthDay(now, m, d, y) {
  if (y != null) return new Date(y < 100 ? 2000 + y : y, m, d, 12);
  let x = new Date(now.getFullYear(), m, d, 12);
  if (ymd(x) < ymd(now)) x = new Date(now.getFullYear() + 1, m, d, 12);
  return x;
}
const validDay = (m, d) => d >= 1 && d <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m];

// Each rule: regex (matched on lowercased text) -> fills { date, time, rep } from the match.
// Order matters: longer, more specific phrases first. Every match is cut out of the title.
const B = '(?<![\\w/:.])', E = '(?![\\w/:])';
const RULES = [
  // repeats
  [`every\\s+other\\s+(day|week|month|year)`, (m, r) => { r.rep = { n: 2, unit: m[1] }; }],
  [`every\\s+(\\d+|two|three|four|six)\\s+(day|week|month|year)s?`, (m, r) => { r.rep = { n: num(m[1]), unit: m[2] }; }],
  [`(?:every|each)\\s+${DAY_RE}`, (m, r, now) => { r.rep = { n: 1, unit: 'week' }; r.date ??= nextDow(now, dayIdx(m[1])); }],
  [`every\\s+(?:single\\s+)?(day|morning|night|week|month|year)`, (m, r) => { const u = { morning: 'day', night: 'day' }[m[1]] || m[1]; r.rep = { n: 1, unit: u }; if (m[1] === 'morning') r.time ??= '09:00'; if (m[1] === 'night') r.time ??= '21:00'; }],
  [`(daily|weekly|monthly|yearly|annually|biweekly)`, (m, r) => { r.rep = { daily: { n: 1, unit: 'day' }, weekly: { n: 1, unit: 'week' }, monthly: { n: 1, unit: 'month' }, yearly: { n: 1, unit: 'year' }, annually: { n: 1, unit: 'year' }, biweekly: { n: 2, unit: 'week' } }[m[1]]; }],
  // relative days
  [`(?:the\\s+)?day\\s+after\\s+(?:tomorrow|tmrw|tmr)`, (m, r, now) => { r.date = at(now, 2); }],
  [`(?:by\\s+|on\\s+)?(?:tomorrow|tmrw|tmrow|tmr|tomm?or+ow)(\\s+(?:morning|afternoon|evening|night))?`, (m, r, now) => { r.date = at(now, 1); if (m[1]) r.time ??= PART[m[1].trim()]; }],
  [`(?:by\\s+)?tonight`, (m, r, now) => { r.date = at(now, 0); r.time ??= '20:00'; }],
  [`(?:by\\s+)?(?:today|tdy)`, (m, r, now) => { r.date = at(now, 0); }],
  [`(?:this|next)\\s+weekend`, (m, r, now) => { const sat = nextDow(now, 6); r.date = m[0].startsWith('next') && now.getDay() !== 0 && now.getDay() !== 6 ? at(sat, 7) : sat; }],
  [`(?:by\\s+)?(?:the\\s+)?weekend`, (m, r, now) => { r.date = nextDow(now, 6); }],
  [`(?:by\\s+)?(?:the\\s+)?end\\s+of\\s+(?:the\\s+)?week`, (m, r, now) => { r.date = nextDow(now, 5); }],
  [`(?:by\\s+)?(?:the\\s+)?end\\s+of\\s+(?:the\\s+)?month`, (m, r, now) => { r.date = new Date(now.getFullYear(), now.getMonth() + 1, 0, 12); }],
  [`next\\s+week`, (m, r, now) => { r.date = nextWeekDow(now, 1); }],
  [`next\\s+month`, (m, r, now) => { r.date = new Date(now.getFullYear(), now.getMonth() + 1, 1, 12); }],
  [`next\\s+year`, (m, r, now) => { r.date = new Date(now.getFullYear() + 1, 0, 1, 12); }],
  [`in\\s+(?:a\\s+)?(\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple(?:\\s+of)?|few)?\\s*(min(?:ute)?s?|hours?|hrs?|days?|weeks?|wks?|months?|years?)`, (m, r, now) => {
    const n = num((m[1] || 'a').replace(/\s+of$/, '')) || 1, u = m[2];
    if (/^min/.test(u) || /^h/.test(u)) {
      const t = new Date(now.getTime() + n * (/^min/.test(u) ? 6e4 : 36e5));
      r.date = at(t, 0); r.time = `${pad(t.getHours())}:${pad(t.getMinutes())}`;
    } else if (/^d/.test(u)) r.date = at(now, n);
    else if (/^w/.test(u)) r.date = at(now, 7 * n);
    else if (/^mo/.test(u)) r.date = new Date(now.getFullYear(), now.getMonth() + n, now.getDate(), 12);
    else r.date = new Date(now.getFullYear() + n, now.getMonth(), now.getDate(), 12);
  }],
  [`(?:by\\s+|on\\s+)?next\\s+${DAY_RE}`, (m, r, now) => { r.date = nextWeekDow(now, dayIdx(m[1])); }],
  [`(?:by\\s+|on\\s+|this\\s+|this\\s+coming\\s+|coming\\s+)?${DAY_RE}(\\s+(?:morning|afternoon|evening|night))?`, (m, r, now) => { r.date = nextDow(now, dayIdx(m[1])); if (m[2]) r.time ??= PART[m[2].trim()]; }],
  // calendar dates
  [`(?:on\\s+|by\\s+)?${MON_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, (m, r, now) => { const mo = monIdx(m[1]), d = +m[2]; if (!validDay(mo, d)) return false; r.date = monthDay(now, mo, d, m[3] ? +m[3] : null); }],
  [`(?:on\\s+|by\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON_RE}(?:,?\\s+(\\d{4}))?`, (m, r, now) => { const mo = monIdx(m[2]), d = +m[1]; if (!validDay(mo, d)) return false; r.date = monthDay(now, mo, d, m[3] ? +m[3] : null); }],
  [`(?:on\\s+|by\\s+)?(\\d{1,2})/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?`, (m, r, now) => { const mo = +m[1] - 1, d = +m[2]; if (mo > 11 || !validDay(mo, d)) return false; r.date = monthDay(now, mo, d, m[3] ? +m[3] : null); }],
  [`(?:on\\s+|by\\s+)?the\\s+(\\d{1,2})(?:st|nd|rd|th)`, (m, r, now) => { const d = +m[1]; if (d < 1 || d > 31) return false; let x = new Date(now.getFullYear(), now.getMonth(), d, 12); if (ymd(x) < ymd(now)) x = new Date(now.getFullYear(), now.getMonth() + 1, d, 12); r.date = x; }],
  // times
  [`(?:at\\s+|@\\s*|by\\s+)?(noon|midday|midnight)`, (m, r) => { r.time = m[1] === 'midnight' ? '23:59' : '12:00'; }],
  [`(?:at\\s+|@\\s*|by\\s+|around\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)(?![a-z])`, (m, r) => { let h = +m[1]; const mi = +(m[2] || 0), pm = m[3][0] === 'p'; if (h > 12 || mi > 59) return false; if (h === 12) h = 0; r.time = `${pad(h + (pm ? 12 : 0))}:${pad(mi)}`; }],
  [`(?:at\\s+|@\\s*|by\\s+|around\\s+)(\\d{1,2}):(\\d{2})`, (m, r) => { const h = +m[1], mi = +m[2]; if (h > 23 || mi > 59) return false; r.time = `${pad(h < 7 ? h + 12 : h)}:${pad(mi)}`; }],
  [`(\\d{1,2}):(\\d{2})`, (m, r) => { const h = +m[1], mi = +m[2]; if (h > 23 || mi > 59) return false; r.time = `${pad(h < 7 ? h + 12 : h)}:${pad(mi)}`; }],
  [`(?:at|@)\\s*(\\d{1,2})(?!\\s*(?:%|k\\b|lb|lbs|mi|miles|g\\b|oz|dollars|bucks))`, (m, r) => { const h = +m[1]; if (h < 1 || h > 12) return false; r.time = `${pad(h < 7 || h === 12 ? (h === 12 ? 12 : h + 12) : h)}:00`; }],
  [`(?:in\\s+the\\s+|this\\s+)(morning|afternoon|evening)`, (m, r, now) => { r.time ??= PART[m[1]]; r.date ??= at(now, 0); }],
];
const PART = { morning: '09:00', afternoon: '14:00', evening: '18:00', night: '21:00' };
const COMPILED = RULES.map(([src, fn]) => [new RegExp(B + src + E, 'i'), fn]);

// "Call dad tomorrow at 5pm" -> { title: 'Call dad', due: '2026-11-01', time: '17:00', rep: null, spans: [...] }
// `spans` are the [start, end) slices of the original text that were read as a date (for highlighting).
export function parseWhen(text, now = new Date()) {
  const r = {}, spans = [];
  let work = text;
  for (const [re, fn] of COMPILED) {
    const m = re.exec(work);
    if (!m) continue;
    if (fn(m, r, now) === false) continue;
    spans.push([m.index, m.index + m[0].length]);
    // Blank the match out (same length) so later rules can't reuse it and spans stay aligned.
    work = work.slice(0, m.index) + ' '.repeat(m[0].length) + work.slice(m.index + m[0].length);
  }
  if (r.rep && !r.date) r.date = r.rep.unit === 'day' ? at(now, 0) : r.rep.unit === 'week' ? at(now, 0) : at(now, 0);
  if (r.time && !r.date) {
    // A bare time is today, or tomorrow once it has passed.
    const [h, mi] = r.time.split(':').map(Number);
    r.date = h * 60 + mi > now.getHours() * 60 + now.getMinutes() ? at(now, 0) : at(now, 1);
  }
  // A dash left hanging where a date was cut out: "haywoods - oct 7 ask wife" -> "haywoods ask wife"
  let title = work.replace(/\s*[-–]\s{2,}|\s{2,}[-–]\s*/g, '  ').replace(/\s+/g, ' ')
    .replace(/\s+(?:on|at|by|due|this|next|in|for|the|-|–|,)\s*$/i, '')
    .replace(/^\s*(?:on|at|by|due|-|–|,)\s+/i, '')
    .replace(/^(?:remind\s+me\s+(?:to\s+)?|reminder\s*:?\s*(?:to\s+)?|don'?t\s+forget\s+(?:to\s+)?|todo\s*:?\s*)/i, '')
    .replace(/\s*[-–,:;]\s*$/, '').replace(/^\s*[-–,:;]\s*/, '').trim();
  if (!title) title = text.trim();
  return { title, due: r.date ? ymd(r.date) : null, time: r.time || null, rep: r.rep || null, spans };
}

// Moves a repeating task to its next date after `from` (YYYY-MM-DD).
export function nextDue(due, rep, from = due) {
  let d = new Date(due + 'T12:00');
  const step = () => {
    if (rep.unit === 'day') d = at(d, rep.n);
    else if (rep.unit === 'week') d = at(d, 7 * rep.n);
    else if (rep.unit === 'month') d = new Date(d.getFullYear(), d.getMonth() + rep.n, d.getDate(), 12);
    else d = new Date(d.getFullYear() + rep.n, d.getMonth(), d.getDate(), 12);
  };
  step();
  while (ymd(d) <= from) step();
  return ymd(d);
}
export const repText = rep => !rep ? '' : rep.n === 1 ? { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' }[rep.unit] : `Every ${rep.n} ${rep.unit}s`;

// ---------- groceries ----------
// Walking order through a typical store. Words are matched on singular, lowercased tokens.
export const AISLES = [
  ['produce', 'Produce', 'apple banana berry blueberry strawberry raspberry blackberry grape orange lemon lime avocado tomato potato onion garlic ginger lettuce spinach kale arugula cabbage broccoli cauliflower carrot celery cucumber pepper jalapeno zucchini squash mushroom enoki shiitake corn pea bean sprout cilantro parsley basil mint dill scallion leek bok choy fruit veggie vegetable salad melon watermelon cantaloupe pineapple mango peach pear plum cherry kiwi pomegranate date fig radish beet asparagus eggplant okra herb coleslaw'],
  ['bakery', 'Bakery & bread', 'bread bagel bun roll tortilla wrap pita naan muffin english croissant loaf joseph lavash flatbread bun'],
  ['meat', 'Meat & seafood', 'chicken beef steak ground turkey lamb goat mutton fish salmon tuna tilapia cod shrimp prawn crab lobster imitation scallop sausage halal meat breast thigh wing drumstick mince kebab'],
  ['deli', 'Deli & prepared', 'deli hummus sushi rotisserie dip guacamole salsa'],
  ['dairy', 'Dairy & eggs', 'milk egg cheese feta mozzarella cheddar parmesan cottage yogurt greek skyr butter cream sour kefir laughing cow string creamer oikos fairlife'],
  ['frozen', 'Frozen', 'frozen ice dumpling pizza nugget waffle edamame gyoza creami popsicle'],
  ['pantry', 'Pantry', 'rice pasta noodle spaghetti macaroni shirataki konjac oat oatmeal cereal flour sugar salt spice cumin turmeric masala paprika oil olive vinegar sauce ketchup mustard mayo mayonnaise sriracha soy miso paste hondashi dashi wakame seaweed nori broth stock soup can canned refried chickpea lentil bean peanut butter jam jelly honey syrup pb2 powder protein whey baking yeast vanilla cinnamon tea coffee kcup k-cup pickle olive tuna-can quinoa couscous tahini'],
  ['snacks', 'Snacks', 'chip cracker pretzel popcorn bar granola nut almond cashew pistachio walnut cookie chocolate candy jerky gum rice-cake trail drizzilicious quest gu'],
  ['drinks', 'Drinks', 'water seltzer soda juice coke pepsi sprite gatorade electrolyte liquid celsius drink kombucha sparkling lacroix'],
  ['intl', 'International', 'halal international indian asian mexican kimchi gochujang curry paneer ghee basmati tofu'],
  ['household', 'Household', 'paper towel toilet tissue napkin trash bag foil wrap ziploc detergent soap dish dishwasher sponge bleach cleaner drano lysol clorox battery bulb filter tide pod softener windex swiffer'],
  ['health', 'Health & personal', 'tums tum advil tylenol ibuprofen vitamin supplement creatine magnesium shampoo conditioner toothpaste toothbrush floss deodorant razor lotion sunscreen bandaid band-aid medicine prescription contact solution melatonin zyrtec claritin'],
  ['other', 'Other', ''],
].map(([k, label, words]) => ({ k, label, words: new Set(words.split(/\s+/).filter(Boolean)) }));
const AISLE_OF = new Map(AISLES.flatMap(a => [...a.words].map(w => [w, a.k])));
// "tums" singularizes to "tum": try the word as written too.
const aisleWord = w => AISLE_OF.get(w) || AISLE_OF.get(w.replace(/-/g, '')) || AISLE_OF.get(w + 's');
// Two-word items that would otherwise land in the wrong aisle.
const PHRASES = [[/\bpeanut butter\b/, 'pantry'], [/\bice cream\b/, 'frozen'], [/\bcream cheese\b/, 'dairy'], [/\bsour cream\b/, 'dairy'], [/\bbok choy\b/, 'produce'], [/\bpaper towels?\b/, 'household'], [/\btoilet paper\b/, 'household'],
  [/\b(?:k-?cups?|coffee pods?)\b/, 'pantry'], [/\bprotein (?:bars?|chips?)\b/, 'snacks'], [/\brice cakes?\b/, 'snacks'], [/\bchicken nuggets?\b/, 'frozen'], [/\bfrozen\b/, 'frozen'], [/\bwater (?:jug|filter)s?\b/, 'household'], [/\bcanned\b/, 'pantry'], [/\bcan of\b/, 'pantry'], [/\btrail mix\b/, 'snacks'], [/\bpickles?\b|\bpickle spears?\b/, 'pantry']];

export const STORES = [
  ['giant', 'Giant', /\bgiant(?:\s+eagle)?\b/],
  ['sams', "Sam's", /\bsam'?s(?:\s+club)?\b|\bsams\s*club\b/],
  ['walmart', 'Walmart', /\bwal-?mart\b/],
  ['aldi', 'Aldi', /\baldi'?s?\b/],
  ['intl', 'Intl market', /\b(?:intl|international|asian|indian|halal)\s+(?:market|store|grocery)\b|\bh\s*mart\b/],
  ['costco', 'Costco', /\bcostco\b/],
  ['target', 'Target', /\btarget\b/],
  ['amazon', 'Amazon', /\bamazon\b/],
];
export const storeLabel = k => STORES.find(s => s[0] === k)?.[1] || '';

const STOP = new Set('a an the some more of for and or to get buy pick up grab need needs new another extra few couple pack packs bag bags box boxes bottle bottles jar jars can cans lb lbs oz pound pounds g gram grams kg gallon gallons dozen of from at x'.split(' '));
export function singular(w) {
  if (w.length <= 3 || /(ss|us|is|ous)$/.test(w)) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (/(ches|shes|xes|oes|sses)$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}
const words = s => s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9\- ]+/g, ' ').split(/\s+/).filter(Boolean);
// Core words for matching: no amounts, filler or plurals. "2 bags of Dill Pickle Spears" -> ['dill','pickle','spear']
export const core = s => words(s).filter(w => !STOP.has(w) && !/^\d/.test(w) && !/^\d*x\d*$/.test(w)).map(singular);

export function aisleOf(name, learned = {}) {
  const k = core(name).join(' ');
  if (learned[k]) return learned[k];
  const low = name.toLowerCase();
  for (const [re, a] of PHRASES) if (re.test(low)) return a;
  const ws = core(name);
  // The last food word usually names the thing ("greek yogurt", "dill pickle spears" -> pickle).
  for (let i = ws.length - 1; i >= 0; i--) { const a = aisleWord(ws[i]); if (a) return a; }
  return 'other';
}

// Pulls a quantity and store out of a grocery line. "2x enoki mushrooms (~$1.99/ea) aldi" ->
// { name: 'Enoki mushrooms', qty: '2', store: 'aldi' }
export function groceryBits(line) {
  let s = line.replace(/\(.*?\)/g, ' ').replace(/~?\$\d+(\.\d+)?(\/\w+)?/g, ' ');
  let store = null;
  for (const [k, , re] of STORES) if (re.test(s.toLowerCase())) { store = k; s = s.replace(new RegExp(`(?:\\s+(?:at|from|@)\\s+)?${re.source}`, 'i'), ' '); break; }
  let qty = null;
  const q = /^\s*(\d+(?:\.\d+)?)\s*(?:x\b|×)?\s*/i.exec(s) || /\s+x?\s*(\d+)\s*$/i.exec(s);
  if (q && !/^\s*\d+(?:\.\d+)?\s*(?:%|(?:lb|lbs|oz|g|kg|ml|l|gal|pct|percent)\b)/i.test(s.slice(q.index).trimStart() ? s.slice(q.index) : '')) { qty = q[1]; s = s.slice(0, q.index) + ' ' + s.slice(q.index + q[0].length); }
  s = s.replace(/^\s*(?:buy|get|grab|pick\s+up|need|more)\s+/i, '').replace(/\s+/g, ' ').replace(/^[\s,.\-:]+|[\s,.\-:]+$/g, '');
  return { name: s ? s[0].toUpperCase() + s.slice(1) : '', qty, store };
}

// Same item? "pickles" vs "dill pickle spears", "ff cottage cheese" vs "cottage cheese".
// One name's core words all appear in the other's, and they share a food word (not just "cheese" vs "cheese").
export function sameItem(a, b) {
  const A = core(a), Bw = core(b);
  if (!A.length || !Bw.length) return false;
  if (A.join(' ') === Bw.join(' ')) return true;
  const [small, big] = A.length <= Bw.length ? [A, Bw] : [Bw, A];
  const bigSet = new Set(big);
  if (!small.every(w => bigSet.has(w))) return false;
  // A lone generic word only matches when it's the head noun ("cheese" != "feta cheese" but "pickle" ~ "dill pickle spear")
  if (small.length === 1 && ['cheese', 'sauce', 'milk', 'bread', 'oil', 'juice', 'water', 'powder', 'butter', 'cream'].includes(small[0])) return big.length === 1;
  return true;
}

// ---------- capture routing ----------
const TASK_VERB = /^(?:call|text|email|e-mail|reply|respond|message|msg|dm|ask|tell|remind|pay|cancel|book|schedule|reschedule|apply|submit|file|renew|return|exchange|send|mail|ship|drop\s+off|pick\s+up\s+(?:the\s+)?(?:kids|package|order|prescription|dry)|fix|clean|wash|vacuum|mop|laundry|do|finish|start|check|review|read|watch|update|sign|print|scan|post|sell|list|meet|visit|go|take|bring|move|change|set\s+up|setup|install|research|look\s+into|find|figure|plan|prep|make|write|study|practice|register|confirm|follow\s+up|contact|request|order|transfer|deposit|withdraw|backup|back\s+up|clear|organize|charge|replace|repair|install|rsvp|zelle|venmo)\b/i;
const NOT_GROCERY = /\b(appt|appointment|meeting|interview|call|dentist|doctor|bill|bills|payment|lease|rent|insurance|tax|taxes|passport|visa|license|registration|flight|hotel|ticket|resume|linkedin|job|work|gift|birthday|bday|party|wedding|event|events|claude|reddit|email|movie|show|anime|episode|season|book|course|class|order|return|pickup|refund|credit|account|subscription|plan|annual|renewal|renewalis|ends|expire|expires|deadline|due)\b/i;
// Things around the house that share words with food ("water dispenser", "ice maker").
const NOT_GROCERY_THING = /\b(?:dispenser|icemaker|icemake|maker|machine|fridge|freezer|oven|stove|car|phone|laptop|tv|filter change|repair|broken|leak)\b/i;
const FOOD_LOG = /^(?:ate|had|log|logged|eating)\b|\b\d+(?:\.\d+)?\s*(?:g|grams?|oz|ounces?|ml)\b/i;
// Weights jotted down to log later: "204 pasta 70 craft 80 cottage cheese" (two or more 20+ numbers before words).
const WEIGHTS = /(?:\b(?:[2-9]\d|\d{3,4})\s+[a-z][^\d,]*[\s,]*){2,}/i;
const isFoodLog = s => (FOOD_LOG.test(s) || WEIGHTS.test(s)) && !TASK_VERB.test(s) && !/\$|\bmiles?\b|\bk\b/i.test(s);
const WATCH = /\b(?:watch|movie|film|show|series|anime|season|episode|ghibli|netflix|hulu|crunchyroll|read|book|novel|podcast|listen)\b/i;

// One line of a capture -> 'food' | 'grocery' | 'task'. `known` = Set of your own food names (lowercased core words).
export function kindOf(line, { known = new Set(), learned = {} } = {}) {
  const low = line.toLowerCase().trim();
  if (!low) return 'task';
  const k = core(line).join(' ');
  if (learned[k]) return learned[k] === 'task' ? 'task' : 'grocery';
  if (/^(?:buy|get|grab|need|more|out of)\b/.test(low) && !NOT_GROCERY.test(low)) return 'grocery';
  if (isFoodLog(low)) return 'food';
  if (TASK_VERB.test(low) || NOT_GROCERY.test(low)) return 'task';
  const g = groceryBits(line);
  const ws = core(g.name || line);
  if (!ws.length) return 'task';
  if (known.has(ws.join(' '))) return 'grocery';
  const hits = ws.filter(aisleWord).length;
  for (const [re] of PHRASES) if (re.test(low)) return 'grocery';
  // Short lines that are mostly food words: "dill pickle spears", "tums", "deli tuna", "soup aldi"
  if (hits && hits / ws.length >= 0.5 && ws.length <= 5) return 'grocery';
  // Brand + product: "hikari miso paste", "beyond meat nuggets"
  if (hits && ws.length <= 3 && !NOT_GROCERY_THING.test(low)) return 'grocery';
  if (g.store && hits) return 'grocery';
  return 'task';
}

// Splits a capture into items. Newlines always split. Commas split when most parts are groceries
// ("tofu, dumplings, water jug"), but not a task that happens to have a comma ("Lego windstorm claude, claude gr...").
export function splitCapture(text, ctx = {}) {
  const out = [];
  for (const line of text.split(/\n+/).map(l => l.trim()).filter(Boolean)) {
    const stripped = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '');
    if (isFoodLog(stripped) && kindOf(stripped, ctx) === 'food') { out.push({ text: stripped, kind: 'food' }); continue; }
    const parts = stripped.split(/\s*(?:,|;|\s+&\s+)\s*/).map(p => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      const kinds = parts.map(p => kindOf(p, ctx));
      const g = kinds.filter(k => k === 'grocery').length;
      if (g >= Math.ceil(parts.length / 2)) {
        // "and" inside a grocery part: "eggs and milk"
        parts.forEach((p, i) => {
          const sub = kinds[i] === 'grocery' ? p.split(/\s+and\s+/).filter(Boolean) : [p];
          sub.forEach(s => out.push({ text: s, kind: kinds[i] === 'grocery' ? 'grocery' : kindOf(s, ctx) }));
        });
        continue;
      }
    }
    const kind = kindOf(stripped, ctx);
    // "milk and eggs" -> two groceries, when both halves are groceries on their own.
    const halves = kind === 'grocery' ? stripped.split(/\s+(?:and|&)\s+/) : [stripped];
    if (halves.length > 1 && halves.every(h => kindOf(h, ctx) === 'grocery')) halves.forEach(h => out.push({ text: h, kind: 'grocery' }));
    else out.push({ text: stripped, kind });
  }
  return out;
}

// Lists a task can live in.
export const LISTS = [['todo', 'To do'], ['someday', 'Someday'], ['watch', 'Watch & read'], ['ref', 'Reference (kept, out of the way)']];
export const listFor = text => (WATCH.test(text) ? 'watch' : 'todo');

// Google Calendar "add event" link, prefilled (no account setup needed).
export function calendarLink(t) {
  if (!t.due) return null;
  const d = t.due.replace(/-/g, '');
  let dates;
  if (t.time) {
    const s = new Date(`${t.due}T${t.time}:00`), e = new Date(s.getTime() + 30 * 6e4);
    const f = x => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
    dates = `${f(s)}/${f(e)}`;
  } else {
    dates = `${d}/${ymd(at(new Date(t.due + 'T12:00'), 1)).replace(/-/g, '')}`;
  }
  const p = new URLSearchParams({ action: 'TEMPLATE', text: t.t, dates, details: (t.note ? t.note + '\n\n' : '') + 'From Baro\'s Biryani tasks' });
  if (t.rep) p.set('recur', `RRULE:FREQ=${{ day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[t.rep.unit]};INTERVAL=${t.rep.n}`);
  try { p.set('ctz', Intl.DateTimeFormat().resolvedOptions().timeZone); } catch {}
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}

// ---------- priority + categories ----------
// "!", "urgent", "asap", "important", "high priority", "top priority" pin a task above everything.
const PRI = /(?:^|\s)!+(?=\s|$)|\s*\b(?:asap|urgent(?:ly)?|important|high\s+priority|top\s+priority|priority|pin(?:\s+it)?)\b/gi;
export function parsePri(text) {
  const pri = PRI.test(text); PRI.lastIndex = 0;
  return { pri, text: pri ? text.replace(PRI, ' ').replace(/\s+/g, ' ').replace(/^[\s,:-]+|[\s,:-]+$/g, '') : text };
}
// Auto categories: a color in the app, an emoji in the Google Tasks widget (which has no colors).
export const CATS = [
  ['call', 'Calls & messages', '📞', '#3b82f6', /\b(?:call|text|email|e-mail|reply|respond|message|msg|dm|tell|ask|send|zelle|venmo|rsvp|contact|follow\s+up|catch\s+up)\b/i],
  ['money', 'Money & bills', '💵', '#16a34a', /\b(?:pay|bill|bills|rent|lease|bank|credit|refund|reimburse|expense|tax|taxes|zakat|invest|reinvest|fidelity|oracle|xfinity|subscription|cancel|annual|renewal|insurance|payment|charges?|\$\d)/i],
  ['car', 'Car', '🚗', '#ca8a04', /\b(?:car|oil\s+change|tires?|rotation|registration|inspection|miles|mileage|wiper|filters?|mechanic|dealer|toyota|honda|parking|gas)\b/i],
  ['health', 'Health', '🩺', '#db2777', /\b(?:dentist|dental|doctor|dr\.?|appt|appointment|prescription|pharmacy|meds?|adderall|refill|glasses|contacts|therapy|physio|knee|meniscus|vaccine|flu\s+shot)\b/i],
  ['home', 'Home', '🏠', '#0d9488', /\b(?:clean|laundry|wash|vacuum|mop|dishes|trash|fix|repair|dispenser|fridge|filter|lease|landlord|move|moving|packing|pack|furniture|amazon\s+return|return|mail)\b/i],
  ['work', 'Work & career', '💼', '#7c3aed', /\b(?:apply|application|resume|linkedin|interview|job|recruiter|offer|onboarding|pto|meeting|expense\s+report|boss|work|ascm|spacex|space\s+x|career)\b/i],
  ['watch', 'Watch & read', '🎬', '#9333ea', /\b(?:watch|movie|film|show|series|anime|season|episode|ghibli|netflix|read|book|novel|podcast)\b/i],
  ['run', 'Running', '🏃', '#ea580c', /\b(?:run|race|marathon|half|5k|10k|gu|shoes|strava|garmin|training)\b/i],
  ['other', 'Other', '•', '#6b7280', null],
].map(([k, label, emoji, color, re]) => ({ k, label, emoji, color, re }));
export const catOf = k => CATS.find(c => c.k === k) || CATS[CATS.length - 1];
export function categoryOf(text, learned = {}) {
  const key = core(text).join(' ');
  if (learned[key]) return learned[key];
  for (const c of CATS) if (c.re && c.re.test(text)) return c.k;
  return 'other';
}
// Things to keep but not see every day (car service notes, a list of race dates): "note:", "fyi", "ref:".
export const REF_PREFIX = /^\s*(?:note|notes|fyi|ref|reference|log)\s*[:\-]\s*/i;
