// Made-up numbers for the "See it with sample numbers" preview. Nothing here is real and nothing is saved.
// Dates are built from today so the preview always looks current. This file is public (Pages repo): keep it fake.
import { addDays, iso, parse } from './calc.js';

export function sample(today) {
  const ym = today.slice(0, 7), d = n => addDays(today, n);
  const first = ym + '-01', day = n => iso(new Date(parse(first).getFullYear(), parse(first).getMonth(), Math.min(n, parse(today).getDate())));
  const manual = [
    { id: 'settings', kind: 'settings', zakatDate: d(52), stockMethod: 'proxy25', nisab: 'silver', rothMethod: 'net', rothBasis: 9000, taxRate: 22, filing: 'single', magi: 0, budget: 2600 },
    { id: 'b1', kind: 'bill', name: 'Electric', amt: 84.12, cat: 'utility', every: 'monthly', date: d(3), auto: false },
    { id: 'b2', kind: 'bill', name: 'Phone', amt: 35, cat: 'utility', every: 'monthly', date: d(9), auto: true },
    { id: 'b3', kind: 'bill', name: 'Car insurance', amt: 612, cat: 'insurance', every: 'yearly', date: d(40), auto: false },
    { id: 'b4', kind: 'bill', name: 'Prescription refill', amt: 15, cat: 'rx', every: 'days30', date: d(6), auto: false },
    { id: 'b5', kind: 'bill', name: 'Gym', amt: 24.99, cat: 'sub', every: 'monthly', date: d(-2), auto: false },
    { id: 'p1', kind: 'pay', name: 'Paycheck', amt: 2140.55, every: 'biweekly', next: d(4) },
    { id: 'r1', kind: 'roth', year: Number(ym.slice(0, 4)), date: ym + '-01', amt: 3500 },
    { id: 'r2', kind: 'roth', year: Number(ym.slice(0, 4)), date: ym + '-01', amt: 1500 },
  ];
  const accounts = { at: Date.now() - 42 * 6e4, accounts: [
    { id: 'a1', src: 'plaid', inst: 'Sample Bank', name: 'Checking', mask: '1234', type: 'cash', bal: 4812.33 },
    { id: 'a2', src: 'plaid', inst: 'Sample Bank', name: 'Savings (no interest)', mask: '9876', type: 'cash', bal: 6200 },
    { id: 'a3', src: 'snaptrade', inst: 'Sample Brokerage', name: 'Brokerage', type: 'invest', bal: 18240.1 },
    { id: 'a4', src: 'snaptrade', inst: 'Sample Brokerage', name: 'Roth IRA', type: 'roth', bal: 11980.4 },
    { id: 'a5', src: 'plaid', inst: 'Sample Card', name: 'Cash back card', mask: '4321', type: 'card', bal: 932.18, limit: 8000, autopay: 'full',
      card: { stmt: 741.6, stmtDate: d(-12), due: d(11), min: 35, overdue: false } },
    { id: 'a6', src: 'plaid', inst: 'Sample Card', name: 'Travel card', mask: '2222', type: 'card', bal: 318.4, limit: 5000,
      card: { stmt: 318.4, stmtDate: d(-20), due: d(5), min: 25, overdue: false } },
  ] };
  const holdings = { at: accounts.at, holdings: [
    { acct: 'a3', sym: 'SPUS', name: 'SP Funds S&P 500 Sharia', qty: 180, price: 52.4, cost: 7900 },
    { acct: 'a3', sym: 'LRCX', name: 'Lam Research', qty: 30, price: 142.1, cost: 3100 },
    { acct: 'a3', sym: 'ADBE', name: 'Adobe', qty: 6, price: 512.3, cost: 3350 },
    { acct: 'a3', sym: 'BA', name: 'Boeing', qty: 5, price: 214.2, cost: 980 },
    { acct: 'a4', sym: 'HLAL', name: 'Wahed FTSE USA Shariah', qty: 150, price: 62.9, cost: 8100 },
    { acct: 'a4', sym: 'SPSK', name: 'SP Funds Sukuk', qty: 140, price: 18.2, cost: 2500 },
  ] };
  const quotes = { at: accounts.at, q: { SPY: { p: 702.4, pc: 698.1 }, QQQ: { p: 628.9, pc: 631.2 }, SPUS: { p: 52.4, pc: 52.05 }, HLAL: { p: 62.9, pc: 62.6 },
    SPSK: { p: 18.2, pc: 18.19 }, UMMA: { p: 29.8, pc: 29.95 }, LRCX: { p: 142.1, pc: 139.8 }, ADBE: { p: 512.3, pc: 516 }, BA: { p: 214.2, pc: 212 } } };
  const days = {};
  for (let i = 60; i >= 0; i--) days[d(-i)] = { net: Math.round(36800 + (60 - i) * 68 + Math.sin(i / 4) * 700) };
  const T = (n, amt, name, cat, acct = 'a5') => ({ d: day(n), amt, name, cat, acct });
  const tx = { tx: Object.fromEntries([
    T(1, 950, 'Rent', 'Housing', 'a1'), T(2, 86.4, 'Wegmans', 'Groceries'), T(3, 42.1, 'Sheetz', 'Gas'), T(4, 18.75, 'Halal Guys', 'Eating out'),
    T(5, 64.2, 'Giant', 'Groceries'), T(5, 24.99, 'Gym', 'Subscriptions'), T(6, 131.5, 'Amazon', 'Shopping'), T(7, 15, 'Pharmacy', 'Health'),
    T(8, 2.31, 'Interest charge', 'Interest charged', 'a6'), T(8, 55.3, 'Trader Joes', 'Groceries'), T(9, 38, 'Sushi buffet', 'Eating out'),
    T(1, -2140.55, 'Payroll', 'Income', 'a1'), T(9, -0.42, 'Bank interest', 'Interest earned', 'a2'), T(3, 500, 'Transfer to brokerage', 'Transfer', 'a1'),
  ].map((t, i) => ['s' + i, t])) };
  const meta = { lastSync: accounts.at, items: [{ inst: 'Sample Bank' }, { inst: 'Sample Card' }], errors: [] };
  const halal = { us: { LRCX: 6, LIN: 5, VRTX: 4.5, ROST: 4, ADBE: 3.5, REGN: 3, SNPS: 2.5, GRMN: 2 },
    nonus: [], complicity: [[['BA'], ['boeing'], ['afscG'], 'Bomb guidance kits, aircraft']], defense: { prime: ['BA'], partial: [] },
    etfs: { SPUS: 'S&P 500 Shariah', HLAL: 'FTSE USA Shariah', SPSK: 'Sukuk', UMMA: 'Intl Shariah', SPWO: 'World ex-US Shariah', SPRE: 'Shariah REITs', AMAPX: 'Amana Participation' } };
  return { manual, files: { accounts, holdings, quotes, history: { days }, meta, halal, ['tx/' + ym]: tx } };
}
