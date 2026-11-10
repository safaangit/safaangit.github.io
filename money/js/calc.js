// Money maths with no DOM and no network, so `node tools/test_money.mjs` can check every number.
// Amounts are plain dollars. Dates are 'YYYY-MM-DD' strings in local time.

export const TROY_OZ_G = 31.1034768;
export const NISAB_G = { gold: 85, silver: 595 }; // grams (the common 85 g / 595 g figures)
export const ZAKAT_RATE = 0.025;                  // per lunar year
export const LUNAR_YEAR_DAYS = 354;

// IRS limits. 2026: Notice 2025-67 (limit $7,500; Roth phase-out single $153k-$168k, joint $242k-$252k).
// 2025: limit $7,000; single $150k-$165k, joint $236k-$246k. Add a year here each November.
export const ROTH = {
  2025: { limit: 7000, single: [150000, 165000], joint: [236000, 246000] },
  2026: { limit: 7500, single: [153000, 168000], joint: [242000, 252000] },
};

export const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
export const sum = (list, f = x => x) => list.reduce((t, x) => t + (Number(f(x)) || 0), 0);

// ---- dates ----
export const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
export const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const addMonths = (s, n) => {
  const d = parse(s), day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, daysIn(d.getFullYear(), d.getMonth())));
  return iso(d);
};

// Next date on or after `from` for something due on day-of-month `day` (31 means last day in short months).
export function nextMonthly(day, from) {
  const f = parse(from);
  for (let i = 0; i < 2; i++) {
    const y = f.getFullYear(), m = f.getMonth() + i;
    const d = new Date(y, m, Math.min(day, daysIn(y, m)));
    if (iso(d) >= from) return iso(d);
  }
}
// Roll a known date forward by its rhythm until it is on or after `from`. Month rhythms count from the
// original date each time, so a bill due on the 31st goes Jan 31, Feb 28, Mar 31 (not Mar 28).
const DAY_STEP = { weekly: 7, biweekly: 14, days30: 30, days90: 90 };
const MONTH_STEP = { monthly: 1, quarterly: 3, yearly: 12 };
export function rollForward(date, every, from) {
  if (!date || date >= from) return date;
  if (DAY_STEP[every]) { const n = DAY_STEP[every]; return addDays(date, Math.ceil(daysBetween(date, from) / n) * n); }
  const m = MONTH_STEP[every];
  if (!m) return date; // 'once' or unknown: leave it where it is
  for (let k = 1; k < 1200; k++) { const d = addMonths(date, k * m); if (d >= from) return d; }
  return date;
}
// Twice a month on the 15th and the last day (the usual semimonthly payroll).
export function nextSemimonthly(from) {
  const f = parse(from), y = f.getFullYear(), m = f.getMonth();
  const c = [new Date(y, m, 15), new Date(y, m, daysIn(y, m)), new Date(y, m + 1, 15)].map(iso);
  return c.find(d => d >= from);
}

// ---- accounts ----
// One list out of what the sync job found and what was typed in by hand.
// Synced accounts win; a manual account marked `hide` on a synced id hides that one.
const TYPES = ['cash', 'invest', 'roth', 'card', 'loan', 'other'];
export function mergeAccounts(synced = [], manual = []) {
  const ov = Object.fromEntries(manual.filter(m => m.kind === 'ov').map(m => [m.acct, m]));
  const out = synced.filter(a => !ov[a.id]?.hide).map(a => ({ ...a, manual: false, ...(ov[a.id]?.autopay ? { autopay: ov[a.id].autopay } : {}), ...(ov[a.id]?.name ? { name: ov[a.id].name } : {}) }));
  for (const m of manual) if (m.kind === 'acct') out.push({ ...m, src: 'manual', manual: true, bal: Number(m.bal) || 0 });
  return out.filter(a => TYPES.includes(a.type));
}
// A hand-entered brokerage or Roth account with positions under it is worth those positions (at live prices)
// plus any cash typed on the account. Synced accounts keep the balance the brokerage reported.
export function applyHoldings(accounts, valued) {
  return accounts.map(a => {
    if (!a.manual || !['invest', 'roth'].includes(a.type)) return a;
    const mine = valued.filter(h => h.acct === a.id);
    return mine.length ? { ...a, bal: round2(sum(mine, h => h.value) + (Number(a.cash) || 0)), fromHoldings: true } : a;
  });
}
// Cards and loans are money owed, stored as positive balances.
export function netWorth(accounts) {
  const of = t => round2(sum(accounts.filter(a => a.type === t), a => a.bal));
  const cash = of('cash'), invest = round2(of('invest') + of('other')), roth = of('roth'), debt = round2(of('card') + of('loan'));
  return { cash, invest, roth, debt, net: round2(cash + invest + roth - debt) };
}

// ---- holdings ----
// Value each position at the freshest price we have: live quote, else the job's price, else what was paid.
export function valueHoldings(holdings = [], quotes = {}) {
  return holdings.map(h => {
    const q = quotes[h.sym], price = q?.p ?? h.price ?? null, qty = Number(h.qty) || 0;
    const cost = h.cost != null ? round2(Number(h.cost)) : null; // total cost basis, not per share
    const value = price != null ? round2(price * qty) : round2(Number(h.value) || cost || 0); // no price yet: carry it at cost
    const day = q?.p != null && q?.pc ? round2((q.p - q.pc) * qty) : null;
    return { ...h, qty, price, value, cost, gain: cost != null ? round2(value - cost) : null,
      gainPct: cost ? round2((value - cost) / cost * 100) : null, day, dayPct: q?.p != null && q?.pc ? round2((q.p / q.pc - 1) * 100) : null };
  }).sort((a, b) => b.value - a.value);
}

// ---- halal flags ----
// halal = data/money/halal.json: { us: {SYM: weight}, nonus: [{t, n, w}], complicity: [[tickers, names, srcs, note]], defense: {prime, partial}, etfs }
export function halalFlag(sym, halal) {
  if (!halal || !sym) return { tone: 'none', label: 'Not checked' };
  const s = sym.toUpperCase();
  const comp = (halal.complicity || []).find(c => c[0].includes(s));
  if (comp) return { tone: 'bad', label: 'Complicity list', why: comp[3] };
  if (halal.defense?.prime?.includes(s)) return { tone: 'bad', label: 'Defense maker' };
  if (halal.defense?.partial?.includes(s)) return { tone: 'warn', label: 'Partly defense' };
  if (halal.etfs?.[s]) return { tone: 'ok', label: 'Halal fund', why: halal.etfs[s] };
  if (halal.us?.[s] != null || (halal.nonus || []).some(n => n.t === s)) return { tone: 'ok', label: 'On your list' };
  return { tone: 'warn', label: 'Not on your lists' };
}
// Names on the US list that aren't held yet, heaviest first. A screen against the owner's own list, not a price call.
export function picks(halal, heldSyms = [], n = 12) {
  const held = new Set(heldSyms.map(s => s.toUpperCase()));
  return Object.entries(halal?.us || {}).filter(([s]) => !held.has(s) && halalFlag(s, halal).tone === 'ok')
    .sort((a, b) => b[1] - a[1]).slice(0, n).map(([sym, w]) => ({ sym, w }));
}

// ---- zakat ----
export function nisab(spot, basis = 'silver') { // spot = { gold, silver } USD per troy oz
  const perG = (spot?.[basis] || 0) / TROY_OZ_G;
  return round2(perG * NISAB_G[basis]);
}
// Share of a stock position that counts. 'full' = shares held to trade (whole market value);
// 'proxy25' = NZF's long-term proxy (25% of market value); 'proxy30' = the 30% figure Wahed's US guide uses.
export const STOCK_FACTOR = { full: 1, proxy25: 0.25, proxy30: 0.30 };
// Roth: 'net' follows AMJA 23284 (what you could withdraw, less the 10% penalty and income tax on the earnings;
// contributions come out free), 'proxy' treats it like other long-term stock, 'skip' leaves it out until withdrawal.
export function rothZakatable(value, s = {}) {
  const m = s.rothMethod || 'net';
  if (m === 'skip' || !value) return 0;
  if (m === 'proxy') return round2(value * (STOCK_FACTOR[s.stockMethod || 'proxy25'] ?? 0.25));
  const basis = Math.min(Number(s.rothBasis) || 0, value), earnings = value - basis;
  return round2(basis + earnings * (1 - 0.10 - (Number(s.taxRate ?? 22) / 100)));
}
export function zakat({ cash = 0, invest = 0, roth = 0, debt = 0, other = 0 }, s = {}, spot) {
  const factor = STOCK_FACTOR[s.stockMethod || 'proxy25'] ?? 0.25;
  const lines = [
    { k: 'Cash', v: round2(cash) },
    { k: factor === 1 ? 'Stocks (full value)' : `Stocks (${factor * 100}% of value)`, v: round2(invest * factor) },
    { k: 'Roth IRA', v: rothZakatable(roth, s) },
    { k: 'Gold, money owed to you, other', v: round2(Number(other) || 0) },
    { k: 'Debts due now', v: -round2(debt) },
  ];
  const base = Math.max(0, round2(sum(lines, l => l.v)));
  const floor = nisab(spot, s.nisab || 'silver');
  const owes = floor > 0 && base >= floor;
  return { lines, base, nisab: floor, owes, due: owes ? round2(base * ZAKAT_RATE) : 0 };
}

// ---- Roth ----
export function rothStatus(contribs = [], year, s = {}, today) {
  const r = ROTH[year];
  if (!r) return null;
  const put = round2(sum(contribs.filter(c => Number(c.year) === year), c => c.amt));
  const band = r[s.filing === 'joint' ? 'joint' : 'single'], magi = Number(s.magi) || 0;
  // IRS reduction: limit x (top - MAGI) / band width, rounded up to the next $10, never under $200 until it hits zero.
  let allowed = r.limit;
  if (magi >= band[1]) allowed = 0;
  else if (magi > band[0]) allowed = Math.max(200, Math.ceil(r.limit * (band[1] - magi) / (band[1] - band[0]) / 10) * 10);
  const deadline = `${year + 1}-04-15`;
  return { year, limit: r.limit, allowed, put, left: Math.max(0, round2(allowed - put)), over: Math.max(0, round2(put - allowed)),
    deadline, daysLeft: today ? daysBetween(today, deadline) : null, band };
}

// ---- what's coming ----
// bills: manual records kind 'bill' { name, amt, day | date, every, auto, cat, paid: { 'YYYY-MM-DD': ms } }
// cards: accounts of type 'card' (synced ones carry card: { due, stmt, min, overdue }, manual ones dueDay + stmt)
// pays:  manual records kind 'pay' { name, amt, every, next }
export function billDue(b, from) {
  if (b.every === 'once') return b.date;
  if (b.day && (!b.every || b.every === 'monthly')) return nextMonthly(Number(b.day), from);
  return rollForward(b.date, b.every || 'monthly', from);
}
export function upcoming({ bills = [], accounts = [], pays = [] }, today, days = 14) {
  const out = [], end = addDays(today, days), start = addDays(today, -10); // look back 10 days for unpaid
  for (const b of bills) {
    let due = billDue(b, start);
    if (!due) continue;
    if (b.paid?.[due]) due = billDue(b, addDays(due, 1)); // this one is ticked: show the next
    if (!due || due > end || b.paid?.[due]) continue;
    out.push({ type: b.cat === 'rx' ? 'rx' : 'bill', id: b.id, name: b.name, amt: Number(b.amt) || 0, date: due, auto: !!b.auto, late: due < today });
  }
  for (const a of accounts.filter(a => a.type === 'card')) {
    const due = a.card?.due || (a.dueDay ? nextMonthly(Number(a.dueDay), today) : null);
    const stmt = a.card?.stmt ?? a.stmt ?? a.bal;
    if (!due || due > end || !(stmt > 0)) continue;
    out.push({ type: 'card', id: a.id, name: a.name, amt: round2(stmt), date: due, auto: (a.autopay || a.card?.autopay) === 'full',
      late: due < today || !!a.card?.overdue });
  }
  for (const p of pays) {
    const d = p.every === 'semimonthly' ? nextSemimonthly(today) : rollForward(p.next, p.every, today);
    if (d && d <= end) out.push({ type: 'pay', id: p.id, name: p.name, amt: Number(p.amt) || 0, date: d });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

// ---- spending ----
// tx: [{ d, amt (+ = money out), name, cat, acct, pending }]. Transfers and card payments aren't spending.
export const NOT_SPEND = new Set(['Transfer', 'Card payment', 'Income', 'Investment']);
export function spendByCat(tx = [], ym) {
  const m = new Map();
  for (const t of tx) {
    if (!t.d.startsWith(ym) || NOT_SPEND.has(t.cat) || t.amt <= 0) continue;
    m.set(t.cat || 'Other', round2((m.get(t.cat || 'Other') || 0) + t.amt));
  }
  const cats = [...m].map(([cat, amt]) => ({ cat, amt })).sort((a, b) => b.amt - a.amt);
  return { cats, total: round2(sum(cats, c => c.amt)) };
}
export function income(tx = [], ym) {
  return round2(sum(tx.filter(t => t.d.startsWith(ym) && t.cat === 'Income'), t => -t.amt));
}
// Interest is the one charge this app treats as an alarm (riba): flag every one.
export const interestCharges = (tx = []) => tx.filter(t => t.cat === 'Interest charged' && t.amt > 0);
export const interestEarned = (tx = []) => round2(sum(tx.filter(t => t.cat === 'Interest earned'), t => -t.amt));
// Where the month should be by today if spending were even.
export function pace(spent, budget, today) {
  const d = parse(today), share = d.getDate() / daysIn(d.getFullYear(), d.getMonth());
  return { share, expected: round2(budget * share), over: round2(spent - budget * share) };
}

// ---- alerts for the Today screen ----
export function alerts({ coming = [], tx = [], meta, roth, zakatDate, today }) {
  const a = [];
  for (const c of coming.filter(c => c.late)) a.push({ tone: 'bad', text: `${c.name} was due ${shortDate(c.date)}`, tab: 'bills' });
  for (const t of interestCharges(tx).slice(0, 3)) a.push({ tone: 'bad', text: `Interest charged: $${t.amt.toFixed(2)} on ${t.name}`, tab: 'spend' });
  for (const c of coming.filter(c => c.type === 'card' && !c.late && !c.auto && daysBetween(today, c.date) <= 7))
    a.push({ tone: 'warn', text: `Pay ${c.name} in full by ${shortDate(c.date)}`, tab: 'bills' });
  for (const i of meta?.items || []) if (i.needsLogin) a.push({ tone: 'warn', text: `${i.inst} needs you to sign in again`, tab: 'settings' });
  if (roth && roth.left > 0 && roth.daysLeft != null && roth.daysLeft <= 60 && roth.daysLeft >= 0)
    a.push({ tone: 'warn', text: `$${roth.left.toLocaleString()} of ${roth.year} Roth room left, ${roth.daysLeft} days to go`, tab: 'yearly' });
  if (zakatDate) {
    const n = daysBetween(today, zakatDate);
    if (n < 0) a.push({ tone: 'bad', text: `Zakat was due ${shortDate(zakatDate)}`, tab: 'yearly' });
    else if (n <= 30) a.push({ tone: 'warn', text: n === 0 ? 'Zakat is due today' : `Zakat is due in ${n} day${n === 1 ? '' : 's'}`, tab: 'yearly' });
  }
  return a;
}

// ---- display ----
export const usd = (n, { cents = true, sign = false } = {}) => {
  if (n == null || Number.isNaN(n)) return '–';
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return (n < 0 ? '−' : sign && n > 0 ? '+' : '') + '$' + s;
};
export const pct = (n, sign = true) => n == null ? '–' : (n < 0 ? '−' : sign && n > 0 ? '+' : '') + Math.abs(n).toFixed(2) + '%';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const shortDate = s => { const d = parse(s); return `${MON[d.getMonth()]} ${d.getDate()}`; };
export function when(date, today) {
  const n = daysBetween(today, date);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n < 0) return `${-n} days ago`;
  return n < 7 ? DOW[parse(date).getDay()] : shortDate(date);
}
export function ago(ms, now = Date.now()) {
  if (!ms) return 'never';
  const m = Math.round((now - ms) / 6e4);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 36) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}
