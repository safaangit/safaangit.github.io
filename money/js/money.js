// Money: one screen for accounts, investing, spending, bills and the yearly duties (zakat, Roth).
// Data comes from three places, merged in build():
//   1. data/money/*.json   written by tools/money_sync.mjs (GitHub Action), read-only here   -> js/gh.js
//   2. data/fuel/money.json  things typed in the app (accounts, bills, settings), synced       -> js/db.js + js/sync.js
//   3. live prices and metals fetched straight from the phone                                 -> js/gh.js
// All sums live in js/calc.js (tested by tools/test_money.mjs). This file only draws and saves.
import * as db from './db.js';
import * as sync from './sync.js';
import * as gh from './gh.js';
import * as C from './calc.js';
import { sample } from './sample.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = $('main');
const TABS = ['today', 'invest', 'spend', 'bills', 'yearly'];
const MARKET = ['SPY', 'QQQ', 'SPUS', 'HLAL', 'SPSK', 'UMMA'];
const VETTING = 'https://claude.ai/artifact/5GyR9wBMWo5cqC9b45YfpF';

const params = new URLSearchParams(location.search);
const S = {
  tab: TABS.includes(params.get('tab')) ? params.get('tab') : db.local.get('moneyTab', 'today'),
  demo: params.has('demo') || db.local.get('moneyDemo', false),
  month: C.iso(new Date()).slice(0, 7),
  live: { at: 0, q: {} }, spot: null, m: null, busy: false,
};

// ---------- model ----------
async function build() {
  const today = C.iso(new Date()), ym = S.month;
  let manual, files;
  if (S.demo) ({ manual, files } = sample(today));
  else {
    manual = await db.all('money');
    files = {};
    for (const n of ['accounts', 'holdings', 'quotes', 'history', 'meta', 'halal', 'tx/' + ym]) files[n] = await gh.cached(n);
  }
  const set = manual.find(r => r.id === 'settings') || { id: 'settings', kind: 'settings' };
  const quotes = { ...(files.quotes?.q || {}), ...(S.demo ? {} : S.live.q) };
  const holdings = C.valueHoldings([...(files.holdings?.holdings || []), ...manual.filter(r => r.kind === 'hold')], quotes);
  const accounts = C.applyHoldings(C.mergeAccounts(files.accounts?.accounts, manual), holdings);
  const nw = C.netWorth(accounts);
  const bills = manual.filter(r => r.kind === 'bill'), pays = manual.filter(r => r.kind === 'pay'), contribs = manual.filter(r => r.kind === 'roth');
  const tx = Object.entries(files['tx/' + ym]?.tx || {}).map(([id, t]) => ({ id, ...t })).sort((a, b) => b.d.localeCompare(a.d));
  const coming = C.upcoming({ bills, accounts, pays }, today, 14);
  const year = Number(today.slice(0, 4));
  // Until April 15 last year's Roth room is still open, so show that year first while it has room.
  const prev = C.rothStatus(contribs, year - 1, set, today), cur = C.rothStatus(contribs, year, set, today);
  const roth = prev && prev.daysLeft >= 0 && prev.left > 0 ? [prev, cur] : [cur];
  const snaps = Object.assign({}, ...manual.filter(r => r.kind === 'snap').map(r => r.days || {}));
  const history = { ...snaps, ...Object.fromEntries(Object.entries(files.history?.days || {}).map(([d, v]) => [d, v.net])) };
  const cardDebtDue = C.sum(accounts.filter(a => a.type === 'card'), a => a.bal);
  const z = C.zakat({ cash: nw.cash, invest: nw.invest, roth: nw.roth, debt: cardDebtDue, other: set.zakatOther }, set, S.spot);
  S.m = { today, ym, manual, files, set, quotes, holdings, accounts, nw, bills, pays, contribs, tx, coming, roth, history, z,
    alerts: C.alerts({ coming, tx, meta: files.meta, roth: roth[0], zakatDate: set.zakatDate, today }),
    empty: !accounts.length && !bills.length && !pays.length && !holdings.length };
  return S.m;
}
// One net-worth point a day so the trend line works even before any account is connected.
async function snapshot() {
  const m = S.m;
  if (S.demo || m.empty || m.files.history?.days?.[m.today]) return;
  const id = 'snap-' + m.today.slice(0, 4), rec = (await db.get('money', id)) || { id, kind: 'snap', days: {} };
  if (rec.days[m.today] === m.nw.net) return;
  rec.days[m.today] = m.nw.net;
  await db.put('money', rec);
}

// ---------- small pieces ----------
const money = (n, o) => `<span class="num">${C.usd(n, o)}</span>`;
const chip = (text, tone = '') => `<span class="chip ${tone}">${esc(text)}</span>`;
const tone = n => (n > 0 ? 'up' : n < 0 ? 'down' : '');
const empty = (text, act, label) => `<div class="empty"><p>${text}</p>${act ? `<button class="primary" data-act="${act}">${label}</button>` : ''}</div>`;
function spark(history) {
  const pts = Object.entries(history).sort(([a], [b]) => a.localeCompare(b)).slice(-90).map(([, v]) => v);
  if (pts.length < 2) return '';
  const lo = Math.min(...pts), hi = Math.max(...pts), W = 320, H = 56, span = hi - lo || 1;
  const xy = pts.map((v, i) => `${(i / (pts.length - 1) * W).toFixed(1)},${(H - 4 - (v - lo) / span * (H - 8)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Net worth over the last ${pts.length} days"><polyline points="${xy}"/></svg>`;
}
const bar = (share, cls = '') => `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, share * 100)).toFixed(1)}%"></i></div>`;

// ---------- Today ----------
function viewToday(m) {
  if (m.empty) return `<section class="card welcome"><h2>Your money, one screen</h2>
    <p class="muted">Add an account, a card or a bill to start. Bank and brokerage connections fill the rest in on their own once they're set up.</p>
    <div class="actions"><button class="primary" data-act="add:acct">Add an account</button><button data-act="demo:on">See it with sample numbers</button></div></section>`;
  const days = Object.keys(m.history).sort(), ago30 = m.history[days.filter(d => d <= C.addDays(m.today, -30)).pop() ?? days[0]];
  const delta = ago30 != null && days.length > 1 ? C.round2(m.nw.net - ago30) : null;
  const stat = (k, v, tab) => `<button class="stat" data-act="tab:${tab}"><span>${k}</span><b class="num">${C.usd(v, { cents: false })}</b></button>`;
  const row = c => `<li class="${c.late ? 'late' : ''}">
      <span class="when">${esc(C.when(c.date, m.today))}</span>
      <span class="what">${esc(c.name)}${c.type === 'card' ? ' <small>statement</small>' : ''}${c.auto ? ' ' + chip('Auto', 'ok') : ''}</span>
      <span class="amt ${c.type === 'pay' ? 'up' : ''}">${c.type === 'pay' ? C.usd(c.amt, { sign: true }) : C.usd(c.amt)}</span>
      ${c.type === 'bill' || c.type === 'rx' ? `<button class="tick" aria-label="Mark ${esc(c.name)} paid" data-act="paid:${c.id}:${c.date}">✓</button>` : '<span class="tick-gap"></span>'}</li>`;
  const out14 = C.round2(C.sum(m.coming.filter(c => c.type !== 'pay'), c => c.amt)), in14 = C.round2(C.sum(m.coming.filter(c => c.type === 'pay'), c => c.amt));
  return `<section class="hero">
      <div class="label">Net worth</div>
      <div class="big num">${C.usd(m.nw.net, { cents: false })}</div>
      ${delta != null ? `<div class="delta ${tone(delta)}">${C.usd(delta, { cents: false, sign: true })} in 30 days</div>` : ''}
      ${spark(m.history)}
      <div class="stats">${stat('Cash', m.nw.cash, 'bills')}${stat('Invested', C.round2(m.nw.invest + m.nw.roth), 'invest')}${stat('Owed', m.nw.debt, 'bills')}</div>
    </section>
    ${m.alerts.length ? `<section class="alerts">${m.alerts.map(a => `<button class="alert ${a.tone}" data-act="${a.tab === 'settings' ? 'settings' : 'tab:' + a.tab}">${esc(a.text)}</button>`).join('')}</section>` : ''}
    <section class="card"><header><h3>Next 14 days</h3><span class="muted small">${in14 ? `${C.usd(in14, { cents: false })} in · ` : ''}${C.usd(out14, { cents: false })} out</span></header>
      ${m.coming.length ? `<ul class="rows">${m.coming.map(row).join('')}</ul>` : '<p class="muted">Nothing due. Add bills and paydays under Bills.</p>'}
    </section>
    <section class="card accts"><header><h3>Accounts</h3><button class="link" data-act="add:acct">Add</button></header>
      <ul class="rows">${m.accounts.map(a => `<li data-act="${a.manual ? 'edit:' + a.id : 'ov:' + a.id}">
        <span class="what">${esc(a.name)}<small>${esc(a.manual ? (a.fromHoldings ? 'From your holdings' : 'Typed in' + (a.asOf ? ' ' + C.shortDate(a.asOf) : '')) : (a.inst || '') + (a.mask ? ' ··' + a.mask : ''))}</small></span>
        <span class="amt ${['card', 'loan'].includes(a.type) ? 'owed' : ''}">${C.usd(['card', 'loan'].includes(a.type) ? -a.bal : a.bal)}</span></li>`).join('')}</ul>
    </section>`;
}

// ---------- Invest ----------
function viewInvest(m) {
  const mk = MARKET.map(s => { const q = m.quotes[s], ch = q?.pc ? (q.p / q.pc - 1) * 100 : null;
    return `<div class="tile"><span>${s}</span><b class="num">${q ? q.p.toFixed(2) : '–'}</b><i class="${tone(ch)} num">${C.pct(ch)}</i></div>`; }).join('');
  const total = C.round2(C.sum(m.holdings, h => h.value)), day = C.round2(C.sum(m.holdings, h => h.day)), cost = C.sum(m.holdings.filter(h => h.cost != null), h => h.cost);
  const gain = C.round2(C.sum(m.holdings.filter(h => h.cost != null), h => h.gain));
  const flag = h => C.halalFlag(h.sym, m.files.halal);
  const bad = m.holdings.filter(h => ['bad', 'warn'].includes(flag(h).tone));
  const hrow = h => { const f = flag(h); return `<li data-act="${h.kind === 'hold' ? 'edit:' + h.id : 'vet:' + h.sym}">
      <span class="what"><b>${esc(h.sym)}</b> ${f.tone !== 'none' ? chip(f.label, f.tone) : ''}<small>${h.qty.toLocaleString()} sh${h.price != null ? ' at ' + C.usd(h.price) : ''}</small></span>
      <span class="amt">${C.usd(h.value)}<small class="${tone(h.dayPct ?? h.gain)}">${h.dayPct != null ? C.pct(h.dayPct) + ' today' : h.gain != null ? C.usd(h.gain, { sign: true }) : ''}</small></span></li>`; };
  const picks = C.picks(m.files.halal, m.holdings.map(h => h.sym), 10);
  const liveAge = S.demo ? 'sample prices' : S.live.at ? 'live ' + C.ago(S.live.at) : m.files.quotes?.at ? 'prices from ' + C.ago(m.files.quotes.at) : 'no prices yet';
  return `<section class="card"><header><h3>Market</h3><span class="muted small">${liveAge}</span></header>
      <div class="tiles">${mk}</div>
      ${!S.demo && !gh.finnhubKey() ? `<p class="muted small">Add a free Finnhub key in settings for live prices on this phone. <button class="link" data-act="settings">Open settings</button></p>` : ''}
    </section>
    <section class="card"><header><h3>Holdings</h3><button class="link" data-act="add:hold">Add</button></header>
      ${m.holdings.length ? `<div class="triple"><div><span>Value</span><b class="num">${C.usd(total, { cents: false })}</b></div>
        <div><span>Today</span><b class="num ${tone(day)}">${C.usd(day, { cents: false, sign: true })}</b></div>
        <div><span>Gain</span><b class="num ${tone(gain)}">${cost ? C.usd(gain, { cents: false, sign: true }) : '–'}</b></div></div>
        ${bad.length ? `<p class="note warn">${bad.length} holding${bad.length > 1 ? 's need' : ' needs'} a look against your halal rules: ${bad.map(h => esc(h.sym)).join(', ')}.</p>` : ''}
        <ul class="rows">${m.holdings.map(hrow).join('')}</ul>`
      : empty('No holdings yet. They fill in when a brokerage is connected, or add one by hand.', 'add:hold', 'Add a holding')}
    </section>
    <section class="card"><header><h3>Halal picks</h3><a class="link" href="${VETTING}" target="_blank" rel="noopener">Vetting tool</a></header>
      ${picks.length ? `<p class="muted small">On your Halal Ethical list and not in your accounts, heaviest first. A screen against your own rules, not a price call. Vet each one before buying.</p>
        <ul class="rows picks">${picks.map(p => `<li><span class="what"><b>${esc(p.sym)}</b></span><span class="amt muted">${p.w.toFixed(2)}% of list</span></li>`).join('')}</ul>`
      : '<p class="muted">Your halal lists load after the first sync.</p>'}
    </section>`;
}

// ---------- Spend ----------
function viewSpend(m) {
  const { cats, total } = C.spendByCat(m.tx, m.ym), inc = C.income(m.tx, m.ym), budget = Number(m.set.budget) || 0;
  const isNow = m.ym === m.today.slice(0, 7), p = budget && isNow ? C.pace(total, budget, m.today) : null;
  const [y, mo] = m.ym.split('-').map(Number), title = new Date(y, mo - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const charged = C.interestCharges(m.tx), earned = C.interestEarned(m.tx);
  const head = `<div class="monthnav"><button data-act="month:-1" aria-label="Previous month">‹</button><b>${title}</b><button data-act="month:1" aria-label="Next month" ${isNow ? 'disabled' : ''}>›</button></div>`;
  if (!m.tx.length) return head + `<section class="card">${empty('Spending fills in on its own once a bank or card is connected. Nothing to type here.', 'settings', 'Connection status')}</section>`;
  const max = cats[0]?.amt || 1;
  return head + `<section class="card"><div class="triple"><div><span>Spent</span><b class="num">${C.usd(total, { cents: false })}</b></div>
        <div><span>Income</span><b class="num">${C.usd(inc, { cents: false })}</b></div>
        <div><span>Kept</span><b class="num ${tone(inc - total)}">${inc ? C.usd(inc - total, { cents: false, sign: true }) : '–'}</b></div></div>
      ${budget ? `${bar(total / budget, total > budget ? 'over' : '')}<p class="muted small">${C.usd(total, { cents: false })} of ${C.usd(budget, { cents: false })} budget${p ? `, ${p.over > 0 ? C.usd(p.over, { cents: false }) + ' ahead of an even pace' : C.usd(-p.over, { cents: false }) + ' under an even pace'}` : ''}.</p>`
        : `<p class="muted small">Set a monthly budget in settings to see your pace. <button class="link" data-act="settings">Open settings</button></p>`}
    </section>
    ${charged.length ? `<section class="alerts">${charged.map(t => `<div class="alert bad">Interest charged: ${C.usd(t.amt)} on ${esc(t.name)}, ${C.shortDate(t.d)}. Pay the full statement to stop it.</div>`).join('')}</section>` : ''}
    ${earned > 0 ? `<section class="alerts"><div class="alert warn">Interest earned this month: ${C.usd(earned)}. Give this amount away to purify it.</div></section>` : ''}
    <section class="card"><h3>By category</h3><ul class="cats">${cats.map(c => `<li><span>${esc(c.cat)}</span><span class="num">${C.usd(c.amt, { cents: false })}</span>${bar(c.amt / max)}</li>`).join('')}</ul></section>
    <section class="card"><h3>Latest</h3><ul class="rows">${m.tx.slice(0, 40).map(t => `<li><span class="when">${C.shortDate(t.d)}</span>
      <span class="what">${esc(t.name)}<small>${esc(t.cat || '')}</small></span><span class="amt ${t.amt < 0 ? 'up' : ''}">${C.usd(-t.amt, { sign: t.amt < 0 })}</span></li>`).join('')}</ul></section>`;
}

// ---------- Bills ----------
const EVERY = { once: 'One time', weekly: 'Weekly', biweekly: 'Every 2 weeks', semimonthly: '15th and last day', days30: 'Every 30 days', monthly: 'Monthly', days90: 'Every 90 days', quarterly: 'Every 3 months', yearly: 'Yearly' };
const CATS = { utility: 'Utility', sub: 'Subscription', insurance: 'Insurance', rent: 'Rent', rx: 'Prescription', other: 'Other' };
function viewBills(m) {
  const cards = m.accounts.filter(a => a.type === 'card');
  const cardRow = a => {
    const due = a.card?.due || (a.dueDay ? C.nextMonthly(Number(a.dueDay), m.today) : null), stmt = a.card?.stmt ?? a.stmt ?? null, auto = a.autopay || a.card?.autopay;
    const util = a.limit ? a.bal / a.limit : null;
    return `<li data-act="${a.manual ? 'edit:' + a.id : 'ov:' + a.id}"><span class="what">${esc(a.name)} ${auto === 'full' ? chip('Autopay full', 'ok') : chip(auto === 'min' ? 'Autopay minimum only' : 'No autopay', 'warn')}
        <small>${stmt != null && due ? `Statement ${C.usd(stmt)} due ${C.when(due, m.today)}` : due ? `Due ${C.when(due, m.today)}` : 'Add a due day'}${util != null ? ` · ${(util * 100).toFixed(0)}% of limit` : ''}</small></span>
      <span class="amt owed">${C.usd(a.bal)}<small>balance</small></span></li>`; };
  const next = b => { let d = C.billDue(b, C.addDays(m.today, -10)); if (d && b.paid?.[d]) d = C.billDue(b, C.addDays(d, 1)); return d; };
  const list = (rows, kind) => rows.map(b => ({ b, d: next(b) })).sort((a, z) => (a.d || '9').localeCompare(z.d || '9')).map(({ b, d }) => `<li class="${d && d < m.today ? 'late' : ''}" data-act="edit:${b.id}">
      <span class="what">${esc(b.name)}${b.auto ? ' ' + chip('Auto', 'ok') : ''}<small>${esc(EVERY[b.every] || 'Monthly')}${d ? ' · ' + (kind === 'rx' ? 'refill ' : 'due ') + C.when(d, m.today) : ''}</small></span>
      <span class="amt">${C.usd(Number(b.amt) || 0)}</span>${d ? `<button class="tick" aria-label="Mark ${esc(b.name)} paid" data-act="paid:${b.id}:${d}">✓</button>` : '<span class="tick-gap"></span>'}</li>`).join('');
  const bills = m.bills.filter(b => b.cat !== 'rx'), rx = m.bills.filter(b => b.cat === 'rx');
  const perMonth = b => (Number(b.amt) || 0) * ({ weekly: 52 / 12, biweekly: 26 / 12, days30: 365 / 30 / 12, monthly: 1, days90: 365 / 90 / 12, quarterly: 1 / 3, yearly: 1 / 12 }[b.every] ?? 0);
  const fixed = C.round2(C.sum(m.bills, perMonth));
  return `<section class="card"><header><h3>Credit cards</h3><button class="link" data-act="add:card">Add</button></header>
      ${cards.length ? `<ul class="rows">${cards.map(cardRow).join('')}</ul><p class="muted small">Always the full statement, never the minimum, so no interest is ever charged.</p>` : '<p class="muted">Add a card with its due day to get pay-in-full reminders.</p>'}
    </section>
    <section class="card"><header><h3>Bills and subscriptions</h3><button class="link" data-act="add:bill">Add</button></header>
      ${bills.length ? `<ul class="rows">${list(bills)}</ul><p class="muted small">About ${C.usd(fixed, { cents: false })} a month in fixed bills.</p>` : '<p class="muted">Electric, phone, insurance, subscriptions.</p>'}
    </section>
    <section class="card"><header><h3>Prescriptions</h3><button class="link" data-act="add:rx">Add</button></header>
      ${rx.length ? `<ul class="rows">${list(rx, 'rx')}</ul>` : '<p class="muted">Refill dates and what each one costs.</p>'}
    </section>
    <section class="card"><header><h3>Paychecks</h3><button class="link" data-act="add:pay">Add</button></header>
      ${m.pays.length ? `<ul class="rows">${m.pays.map(p => { const d = p.every === 'semimonthly' ? C.nextSemimonthly(m.today) : C.rollForward(p.next, p.every, m.today);
        return `<li data-act="edit:${p.id}"><span class="what">${esc(p.name)}<small>${esc(EVERY[p.every] || '')}${d ? ' · next ' + C.when(d, m.today) : ''}</small></span><span class="amt up">${C.usd(Number(p.amt) || 0, { sign: true })}</span></li>`; }).join('')}</ul>`
      : '<p class="muted">Add your payday to see it on Today.</p>'}
    </section>`;
}

// ---------- Yearly ----------
function viewYearly(m) {
  const z = m.z, s = m.set, n = s.zakatDate ? C.daysBetween(m.today, s.zakatDate) : null;
  const sel = (k, opts, cur) => `<select data-set="${k}">${Object.entries(opts).map(([v, l]) => `<option value="${v}" ${String(cur) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const rothCard = r => `<div class="roth"><div class="triple"><div><span>${r.year} put in</span><b class="num">${C.usd(r.put, { cents: false })}</b></div>
        <div><span>Room left</span><b class="num">${C.usd(r.left, { cents: false })}</b></div><div><span>Deadline</span><b>${C.shortDate(r.deadline)}, ${r.deadline.slice(0, 4)}</b></div></div>
      ${bar(r.allowed ? r.put / r.allowed : 1, r.over ? 'over' : '')}
      <p class="muted small">${r.over ? `Over the limit by ${C.usd(r.over)}. Pull the extra out before the deadline to avoid the 6% penalty.` : r.allowed < r.limit ? `Your income cuts this year's limit to ${C.usd(r.allowed, { cents: false })} (full limit ${C.usd(r.limit, { cents: false })}).` : `Limit ${C.usd(r.limit, { cents: false })}. ${r.daysLeft} days left${r.left && r.daysLeft > 0 ? `, about ${C.usd(r.left / Math.max(1, Math.ceil(r.daysLeft / 30.4)), { cents: false })} a month to fill it` : ''}.`}</p></div>`;
  return `<section class="card"><header><h3>Zakat</h3>${n != null ? `<span class="muted small">${n < 0 ? `${-n} days overdue` : n === 0 ? 'due today' : `due in ${n} days`}</span>` : ''}</header>
      <div class="duo"><div><span class="label">Due this year</span><div class="big num">${S.spot ? C.usd(z.due) : '–'}</div></div>
        <div class="right"><span class="label">Nisab today</span><div class="num">${S.spot ? C.usd(z.nisab, { cents: false }) : 'loading'}</div></div></div>
      ${S.spot && !z.owes ? '<p class="note">You are under nisab, so nothing is due.</p>' : ''}
      <ul class="rows tight">${z.lines.filter(l => l.v).map(l => `<li><span class="what">${esc(l.k)}</span><span class="amt">${C.usd(l.v, { cents: false })}</span></li>`).join('')}
        <li class="total"><span class="what">Counts toward zakat</span><span class="amt">${C.usd(z.base, { cents: false })}</span></li></ul>
      <div class="fields">
        <label>Zakat date<input type="date" data-set="zakatDate" value="${esc(s.zakatDate || '')}"></label>
        <label>Stocks${sel('stockMethod', { proxy25: 'Long-term: 25% of value', proxy30: 'Long-term: 30% of value', full: 'Trading: full value' }, s.stockMethod || 'proxy25')}</label>
        <label>Roth IRA${sel('rothMethod', { net: 'What I could withdraw', proxy: 'Like other stocks', skip: 'Leave out' }, s.rothMethod || 'net')}</label>
        <label>Nisab by${sel('nisab', { silver: 'Silver (595 g)', gold: 'Gold (85 g)' }, s.nisab || 'silver')}</label>
        <label>Other zakatable (gold, loans owed to you)<input type="number" inputmode="decimal" data-set="zakatOther" value="${esc(s.zakatOther ?? '')}" placeholder="0"></label>
      </div>
      <div class="actions"><button data-act="zakat:paid" ${s.zakatDate ? '' : 'disabled'}>Mark paid, set next year</button></div>
      <p class="muted small">2.5% once a lunar year. Long-term stock methods follow <a href="https://nzf.org.uk/knowledge/zakat-on-stocks-and-shares/" target="_blank" rel="noopener">NZF (25%)</a> or Wahed's guide (30%); the Roth default follows <a href="https://www.amjaonline.org/fatwa/en/23284/zakat-and-the-401k-retirement-plan" target="_blank" rel="noopener">AMJA 23284</a>. Scholars differ, so pick with yours.${S.spot ? ` Gold ${C.usd(S.spot.gold)}/oz, silver ${C.usd(S.spot.silver)}/oz, ${C.ago(S.spot.at)}.` : ''}</p>
    </section>
    <section class="card"><header><h3>Roth IRA</h3><button class="link" data-act="add:roth">Add contribution</button></header>
      ${m.roth.map(rothCard).join('')}
      ${m.contribs.length ? `<ul class="rows tight">${[...m.contribs].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(c => `<li data-act="edit:${c.id}"><span class="what">${c.date ? C.shortDate(c.date) : ''}<small>for ${c.year}</small></span><span class="amt">${C.usd(Number(c.amt) || 0)}</span></li>`).join('')}</ul>` : ''}
      <p class="muted small">Limits from the IRS (2026: $7,500 under age 50). Keep the Roth in halal funds only; any holding that fails your rules is flagged under Invest.</p>
    </section>`;
}

// ---------- render ----------
const VIEWS = { today: viewToday, invest: viewInvest, spend: viewSpend, bills: viewBills, yearly: viewYearly };
async function render({ keepScroll = true } = {}) {
  const y = scrollY, m = await build();
  main.innerHTML = (S.demo ? `<div class="demo">Sample numbers, nothing here is yours. <button class="link" data-act="demo:off">Turn off</button></div>` : '')
    + (!S.demo && !gh.configured() ? `<div class="demo">Not signed in on this phone yet, so nothing syncs. Open <a href="../biryani/">Baro's Biryani</a> → Settings and paste your token once; Money uses the same one.</div>` : '')
    + VIEWS[S.tab](m);
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  status();
  if (keepScroll) scrollTo(0, y);
}
function status(text) {
  const m = S.m, at = m?.files.meta?.lastSync;
  $('#status').textContent = text ?? (S.demo ? 'Sample' : at ? 'Accounts ' + C.ago(at) : '');
}
let toastT;
function toast(text) { const t = $('#toast'); t.textContent = text; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200); }

// ---------- forms ----------
// field: { k, label, type: text|number|date|select|check, opts, ph }
const F = {
  acct: { title: 'Account', fields: [{ k: 'name', label: 'Name', ph: 'Checking' }, { k: 'type', label: 'Type', type: 'select', opts: { cash: 'Cash (checking, savings)', invest: 'Brokerage', roth: 'Roth IRA', loan: 'Loan or money you owe', other: 'Other asset' } },
    { k: 'bal', label: 'Balance today', type: 'number' }], base: { kind: 'acct', type: 'cash' }, stamp: 'asOf' },
  card: { title: 'Credit card', fields: [{ k: 'name', label: 'Name', ph: 'Cash back card' }, { k: 'bal', label: 'Balance today', type: 'number' }, { k: 'stmt', label: 'Last statement balance', type: 'number' },
    { k: 'dueDay', label: 'Due day of the month', type: 'number', ph: '15' }, { k: 'autopay', label: 'Autopay', type: 'select', opts: { off: 'Off', full: 'Full statement balance', min: 'Minimum only' } },
    { k: 'limit', label: 'Credit limit (optional)', type: 'number' }], base: { kind: 'acct', type: 'card', autopay: 'off' }, stamp: 'asOf' },
  bill: { title: 'Bill', fields: [{ k: 'name', label: 'Name', ph: 'Electric' }, { k: 'amt', label: 'Amount', type: 'number' }, { k: 'cat', label: 'Kind', type: 'select', opts: CATS },
    { k: 'date', label: 'Next due date', type: 'date' }, { k: 'every', label: 'Repeats', type: 'select', opts: (({ semimonthly, ...o }) => o)(EVERY) }, { k: 'auto', label: 'Paid automatically', type: 'check' }], base: { kind: 'bill', cat: 'utility', every: 'monthly' } },
  rx: { title: 'Prescription', fields: [{ k: 'name', label: 'Name', ph: 'Prescription' }, { k: 'amt', label: 'Cost per refill', type: 'number' }, { k: 'date', label: 'Next refill date', type: 'date' },
    { k: 'every', label: 'Repeats', type: 'select', opts: { days30: 'Every 30 days', days90: 'Every 90 days', monthly: 'Monthly', once: 'One time' } }], base: { kind: 'bill', cat: 'rx', every: 'days30' } },
  pay: { title: 'Paycheck', fields: [{ k: 'name', label: 'From', ph: 'Paycheck' }, { k: 'amt', label: 'Take-home amount', type: 'number' },
    { k: 'every', label: 'How often', type: 'select', opts: { biweekly: EVERY.biweekly, semimonthly: EVERY.semimonthly, weekly: EVERY.weekly, monthly: EVERY.monthly } }, { k: 'next', label: 'Next payday', type: 'date' }], base: { kind: 'pay', every: 'biweekly' } },
  roth: { title: 'Roth contribution', fields: [{ k: 'amt', label: 'Amount', type: 'number' }, { k: 'date', label: 'Date', type: 'date' }, { k: 'year', label: 'Counts for tax year', type: 'select', opts: {} }], base: { kind: 'roth' } },
  hold: { title: 'Holding', fields: [{ k: 'sym', label: 'Ticker', ph: 'SPUS' }, { k: 'qty', label: 'Shares', type: 'number' }, { k: 'cost', label: 'Total cost paid (optional)', type: 'number' }, { k: 'acct', label: 'Account', type: 'select', opts: {} }], base: { kind: 'hold' } },
};
function formFor(rec) {
  if (rec.kind === 'acct') return rec.type === 'card' ? 'card' : 'acct';
  if (rec.kind === 'bill') return rec.cat === 'rx' ? 'rx' : 'bill';
  return rec.kind;
}
function openForm(name, rec) {
  if (S.demo) return toast('Sample numbers are read-only. Turn the sample off to add your own.');
  const f = F[name], m = S.m, isNew = !rec, year = Number(m.today.slice(0, 4));
  rec = rec ? { ...rec } : { ...f.base };
  if (name === 'roth') { F.roth.fields[2].opts = { [year]: String(year), [year - 1]: String(year - 1) }; rec.year ??= year; rec.date ??= m.today; }
  if (name === 'hold') {
    const mine = m.accounts.filter(a => a.manual && ['invest', 'roth'].includes(a.type));
    F.hold.fields[3].opts = { ...Object.fromEntries(mine.map(a => [a.id, a.name])), 'new:invest': 'New brokerage account', 'new:roth': 'New Roth IRA' };
    rec.acct ??= mine[0]?.id || 'new:invest';
  }
  const input = x => {
    const v = rec[x.k] ?? '';
    if (x.type === 'select') return `<select name="${x.k}">${Object.entries(x.opts).map(([k, l]) => `<option value="${esc(k)}" ${String(v) === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    if (x.type === 'check') return `<input type="checkbox" name="${x.k}" ${v ? 'checked' : ''}>`;
    return `<input name="${x.k}" type="${x.type === 'number' ? 'number' : x.type || 'text'}" ${x.type === 'number' ? 'inputmode="decimal" step="any"' : ''} value="${esc(v)}" placeholder="${esc(x.ph || '')}" autocomplete="off">`;
  };
  sheet(`<h2>${isNew ? 'Add' : 'Edit'} ${f.title.toLowerCase()}</h2><form>${f.fields.map(x => `<label class="${x.type === 'check' ? 'check' : ''}">${esc(x.label)}${input(x)}</label>`).join('')}
    <div class="actions">${isNew ? '' : '<button type="button" class="danger" data-del>Delete</button>'}<button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`,
  el => {
    el.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      for (const x of f.fields) rec[x.k] = x.type === 'check' ? fd.has(x.k) : x.type === 'number' ? (fd.get(x.k) === '' ? null : Number(fd.get(x.k))) : String(fd.get(x.k) || '').trim();
      if (name === 'hold') { rec.sym = rec.sym.toUpperCase(); if (!rec.sym || !rec.qty) return toast('Ticker and shares are needed.');
        if (rec.acct.startsWith('new:')) { const type = rec.acct.slice(4); rec.acct = (await db.put('money', { kind: 'acct', type, name: type === 'roth' ? 'Roth IRA' : 'Brokerage', bal: 0 })).id; } }
      else if (name === 'roth') { rec.year = Number(rec.year); if (!rec.amt) return toast('Enter an amount.'); }
      else if (!rec.name) return toast('Give it a name.');
      if (f.stamp) rec[f.stamp] = m.today;
      await db.put('money', rec);
      closeSheet(); await render(); pushSoon();
    };
    el.querySelector('[data-del]')?.addEventListener('click', async () => { await db.remove('money', rec.id); closeSheet(); await render(); pushSoon(); });
  });
}
function sheet(html, wire) {
  const el = $('#sheet');
  el.innerHTML = `<div class="panel" role="dialog" aria-modal="true">${html}</div>`;
  el.classList.add('on'); document.body.classList.add('locked');
  el.onclick = e => { if (e.target === el || e.target.closest('[data-close]')) closeSheet(); };
  wire?.(el);
}
function closeSheet() { $('#sheet').classList.remove('on'); document.body.classList.remove('locked'); $('#sheet').innerHTML = ''; }

async function saveSetting(k, v) {
  if (S.demo) return toast('Sample numbers are read-only.');
  const s = (await db.get('money', 'settings')) || { id: 'settings', kind: 'settings' };
  s[k] = v; await db.put('money', s); await render(); pushSoon();
}
function openSettings() {
  const m = S.m, s = m.set, meta = m.files.meta, items = meta?.items || [];
  sheet(`<h2>Settings</h2>
    <h3>Connections</h3>
    ${items.length ? `<ul class="rows tight">${items.map(i => `<li><span class="what">${esc(i.inst)}</span><span class="amt">${i.needsLogin ? chip('Sign in again', 'warn') : chip('Connected', 'ok')}</span></li>`).join('')}</ul>` : '<p class="muted small">No bank, card or brokerage connected yet. Until then, anything you type in works on its own.</p>'}
    ${meta?.errors?.length ? `<p class="note warn">${meta.errors.map(e => esc(`${e.src}: ${e.msg}`)).join('<br>')}</p>` : ''}
    <p class="muted small">Accounts update on their own four times a day${meta?.lastSync ? `, last ${C.ago(meta.lastSync)}` : ''}. Prices and nisab refresh every time you open the app.</p>
    <div class="actions"><button type="button" data-act="sync:run">Refresh accounts now</button></div>
    <h3>You</h3><div class="fields">
      <label>Monthly spending budget<input type="number" inputmode="decimal" data-set="budget" value="${esc(s.budget ?? '')}"></label>
      <label>Tax filing<select data-set="filing"><option value="single" ${s.filing !== 'joint' ? 'selected' : ''}>Single</option><option value="joint" ${s.filing === 'joint' ? 'selected' : ''}>Married, joint</option></select></label>
      <label>Income this year (for the Roth limit)<input type="number" inputmode="decimal" data-set="magi" value="${esc(s.magi ?? '')}"></label>
      <label>Roth: total you've put in, all years<input type="number" inputmode="decimal" data-set="rothBasis" value="${esc(s.rothBasis ?? '')}"></label>
      <label>Tax rate on early Roth earnings, %<input type="number" inputmode="decimal" data-set="taxRate" value="${esc(s.taxRate ?? 22)}"></label>
    </div>
    <h3>This phone</h3><div class="fields">
      <label>Finnhub key for live prices (free at finnhub.io, stays on this phone)<input type="text" data-local="finnhubKey" value="${esc(gh.finnhubKey())}" autocomplete="off" autocapitalize="off"></label>
    </div>
    <div class="actions"><button type="button" data-act="demo:${S.demo ? 'off' : 'on'}">${S.demo ? 'Turn off sample numbers' : 'Show sample numbers'}</button><button type="button" class="primary" data-close>Done</button></div>`);
}
// A synced account can't be edited, but its name, autopay setting and visibility can be overridden.
function openOverride(id) {
  if (S.demo) return toast('Sample numbers are read-only.');
  const a = S.m.accounts.find(x => x.id === id), ov = S.m.manual.find(r => r.kind === 'ov' && r.acct === id) || { kind: 'ov', acct: id };
  sheet(`<h2>${esc(a.name)}</h2><form><label>Show as<input name="name" value="${esc(ov.name || a.name)}"></label>
    ${a.type === 'card' ? `<label>Autopay<select name="autopay">${Object.entries({ off: 'Off', full: 'Full statement balance', min: 'Minimum only' }).map(([k, l]) => `<option value="${k}" ${(ov.autopay || 'off') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
    <label class="check">Hide this account<input type="checkbox" name="hide" ${ov.hide ? 'checked' : ''}></label>
    <div class="actions"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`,
  el => { el.querySelector('form').onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target);
    Object.assign(ov, { name: String(fd.get('name') || '').trim(), autopay: fd.get('autopay') || undefined, hide: fd.has('hide') });
    await db.put('money', ov); closeSheet(); await render(); pushSoon(); }; });
}

// ---------- actions ----------
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const [act, a, b] = el.dataset.act.split(':'), m = S.m;
  if (act === 'tab') { S.tab = a; db.local.set('moneyTab', a); await render({ keepScroll: false }); scrollTo(0, 0); if (a === 'invest') pollQuotes(); }
  else if (act === 'add') openForm(a);
  else if (act === 'edit') { const rec = m.manual.find(r => r.id === a); if (rec) openForm(formFor(rec), rec); }
  else if (act === 'ov') openOverride(a);
  else if (act === 'vet') window.open(VETTING, '_blank', 'noopener');
  else if (act === 'settings') openSettings();
  else if (act === 'refresh') refreshAll({ manual: true });
  else if (act === 'demo') { S.demo = a === 'on'; db.local.set('moneyDemo', S.demo); closeSheet(); await render({ keepScroll: false }); if (!S.demo) refreshAll(); }
  else if (act === 'month') { const [y, mo] = S.month.split('-').map(Number); S.month = C.iso(new Date(y, mo - 1 + Number(a), 1)).slice(0, 7); await render({ keepScroll: false }); if (!S.demo) gh.refresh().then(ch => ch.length && render()).catch(() => {}); }
  else if (act === 'paid') {
    if (S.demo) return toast('Sample numbers are read-only.');
    const rec = await db.get('money', a); if (!rec) return;
    rec.paid = { ...(rec.paid || {}), [b]: Date.now() };
    for (const k of Object.keys(rec.paid)) if (k < C.addDays(m.today, -400)) delete rec.paid[k]; // keep a year of ticks
    await db.put('money', rec); toast(`${rec.name} marked paid`); await render(); pushSoon();
  }
  else if (act === 'zakat') {
    if (S.demo) return toast('Sample numbers are read-only.');
    const s = (await db.get('money', 'settings')) || { id: 'settings', kind: 'settings' };
    s.zakatLog = [...(s.zakatLog || []), { date: m.today, due: m.z.due, base: m.z.base }].slice(-10);
    s.zakatDate = C.addDays(s.zakatDate, C.LUNAR_YEAR_DAYS);
    await db.put('money', s); toast(`Recorded. Next zakat date ${C.shortDate(s.zakatDate)}`); await render(); pushSoon();
  }
  else if (act === 'sync') {
    if (S.demo) return toast('Sample numbers are read-only.');
    const last = db.local.get('moneyRunAt', 0);
    if (Date.now() - last < 10 * 6e4) return toast('Already asked a few minutes ago. New numbers land in 1 to 2 minutes.');
    try { await gh.runSync(); db.local.set('moneyRunAt', Date.now()); toast('Refreshing accounts. New numbers land in 1 to 2 minutes.'); watchForSync(); }
    catch (err) { toast(err.message); }
  }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.set) saveSetting(el.dataset.set, el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value);
  else if (el.dataset.local) { db.local.set(el.dataset.local, el.value.trim()); pollQuotes(true); }
});
document.querySelectorAll('nav button').forEach(b => (b.dataset.act = 'tab:' + b.dataset.tab));

// ---------- staying fresh ----------
let pushT;
function pushSoon() { clearTimeout(pushT); pushT = setTimeout(() => sync.sync().catch(() => {}), 1500); }
const symbols = () => [...new Set([...MARKET, ...(S.m?.holdings || []).map(h => h.sym)])];
let quoteT;
async function pollQuotes(force) {
  clearTimeout(quoteT);
  if (S.demo || !gh.finnhubKey() || document.hidden) return;
  if (force || Date.now() - S.live.at > 55e3) {
    const q = await gh.liveQuotes(symbols());
    if (Object.keys(q).length) { S.live = { at: Date.now(), q: { ...S.live.q, ...q } }; if (!$('#sheet').classList.contains('on')) await render(); }
  }
  if (S.tab === 'invest') quoteT = setTimeout(pollQuotes, 60e3);
}
async function refreshAll({ manual = false } = {}) {
  if (S.demo || S.busy) return;
  S.busy = true; $('#refresh').classList.add('spin'); if (manual) status('Updating…');
  try {
    const [files, synced, , spot] = await Promise.allSettled([gh.refresh(), sync.sync(), pollQuotes(true), gh.metals()]);
    if (spot.value) S.spot = spot.value;
    const failed = [files, synced].find(r => r.status === 'rejected');
    if (failed && manual) toast(failed.reason.message);
    await build(); await snapshot();
    if (!$('#sheet').classList.contains('on')) await render();
    if (manual && !failed) toast('Up to date');
  } finally { S.busy = false; $('#refresh').classList.remove('spin'); }
}
// After "Refresh accounts now": look every 20 s for up to 4 minutes until the job's files change.
function watchForSync(tries = 12) {
  if (tries <= 0) return;
  setTimeout(async () => { const ch = await gh.refresh().catch(() => []); if (ch.length) { await render(); toast('Accounts updated'); } else watchForSync(tries - 1); }, 20e3);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - db.local.get('moneyChecked', 0) > 2 * 6e4) refreshAll(); });

// ---------- start ----------
(async () => {
  S.live = S.demo ? S.live : await gh.lastLive();
  S.spot = await gh.metalsCached();
  await render({ keepScroll: false }); // instant, from what the phone already has
  refreshAll();                         // then pull whatever changed
  if (S.demo || !S.spot) gh.metals().then(v => { if (v && v !== S.spot) { S.spot = v; render(); } });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
