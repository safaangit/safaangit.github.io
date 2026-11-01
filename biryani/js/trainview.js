// Training tab (Plan / Trends / Race) and the small plan card on Today.
// Shell helpers come in from app.js as `ui` so this file stays self-contained.
import * as db from './db.js';
import { today, monthOf, local } from './db.js';
import * as sync from './sync.js';
import * as T from './training.js';
import { bars, line, bindCharts } from './charts.js';
import * as L from './lifts.js';

const KIND = { easy: 'Easy', medium: 'Medium', quality: 'Workout', long: 'Long', race: 'Race', rest: 'Rest', recovery: 'Recover' };
const r1 = v => Math.round(v * 10) / 10;
// Fast to slow, the way a watch reads (8:41–9:06/mi).
const paceRange = p => p ? `${T.fmtPace(p[0])}–${T.fmtPace(p[1])}/mi` : '';
const miRange = x => !x.mi ? '' : x.kind === 'race' || x.lo === x.hi ? `${x.mi} mi` : `${x.lo}-${x.hi} mi`;
// Short calendar label and 1-3 intensity pips, so hard days stand out at a glance.
const SHORT = { Tempo: 'Tempo', Intervals: 'Intervals', 'Marathon pace': 'MP', Sharpener: 'MP', Recovery: 'Recover', Shakeout: 'Shakeout', 'Medium long': 'Medium' };
const calLabel = x => x.kind === 'quality' ? SHORT[x.title.replace(/ \((moved|shorter)\)$/, '')] || 'Workout' : x.kind === 'long' ? 'Long' : SHORT[x.title] || KIND[x.kind];
const LEVEL = { recovery: 0, rest: 0, easy: 1, medium: 2, long: 2, quality: 3, race: 3 };
const shoeName = (gear, ids) => (ids || []).map(id => gear.find(g => g.uuid === id)?.name).filter(Boolean).join(', ');
const mon = d => new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const wkday = d => new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' });

// Everything the tab needs: Garmin days for ~4 months, runs, config with a goal, the plan.
async function load(s, ref = today()) {
  const cfg = T.config(s, ref);
  // 7 months: a season race months out predicts from 6 months of runs (training.js predict).
  // Whole calendar months back from this one (stepping 31 days skipped a month: Oct 1 → Aug 31 lost September).
  const [y0, m0] = monthOf(ref).split('-').map(Number);
  const months = Array.from({ length: 7 }, (_, i) => { const k = y0 * 12 + m0 - 1 - i; return `${Math.floor(k / 12)}-${String(k % 12 + 1).padStart(2, '0')}`; }).sort();
  const gdays = Object.assign({}, ...(await Promise.all(months.map(m => sync.garminMonth(m).catch(() => ({ days: {} }))))).map(g => g.days || {}));
  const manual = (await db.all('exercises')).filter(x => x.run && x.mi > 0);
  for (const x of manual) (gdays[x.date] ??= { activities: [] }).activities = [...(gdays[x.date].activities || []), { name: x.name, type: 'running', distance: x.mi * 1609.34, duration: (x.min || 0) * 60 }];
  const runs = T.runsFrom(gdays), lifts = T.liftsFrom(gdays);
  const pred = T.predict(runs, ref, cfg.raceDate);
  const autoGoal = !cfg.goalSec;
  if (autoGoal) cfg.goalSec = pred ? T.suggestGoal(pred.sec) : 4 * 3600;
  const plan = T.seasonPlan(cfg, runs, ref);
  const adapted = T.adapt(plan, runs, gdays, cfg, ref);
  const gear = ((await sync.garminGear().catch(() => null))?.gear || []).filter(g => /shoe/i.test(g.type || ''));
  return { cfg, gdays, runs, lifts, pred, autoGoal, plan, adapted, gear };
}

// Plan day kinds by date plus the race date, for the weekly calorie budget. Today asks on every
// render, so keep it for a minute.
let kindsMemo = null;
export async function planKinds(s) {
  if (kindsMemo && Date.now() - kindsMemo.t < 60e3) return kindsMemo.v;
  const { cfg, plan } = await load(s);
  const kinds = Object.fromEntries(plan.weeks.flatMap(w => w.days).map(d => [d.date, d.kind]));
  kindsMemo = { t: Date.now(), v: { kinds, raceDate: cfg.raceDate } };
  return kindsMemo.v;
}

// ---------- Today card ----------
export async function todayCard(s, date, ui) {
  const { cfg, runs, plan } = await load(s);
  const toRace = T.daysBetween(today(), cfg.raceDate);
  if (toRace < -1) return '';
  const d = T.planFor(plan, date);
  if (!d) return '';
  const done = T.milesOn(runs, date), st = T.status(d, T.doneMiles(runs, d));
  const short = cfg.raceName.replace(/ (Marathon|Half Marathon)$/, '');
  return `<section class="card trainday k-${d.kind}" id="trainCard"><header><h3>Training</h3><span class="cd">${toRace === 0 ? 'Race day!' : toRace > 0 ? `${toRace} days to ${ui.esc(short)}` : ''}</span>${ui.ico('next')}</header>
    <div class="tdrow"><span class="kst"></span><div class="grow"><div class="name">${d.mi ? `${miRange(d)} · ` : ''}${ui.esc(d.title)}</div>
    <div class="sub">${d.pace ? paceRange(d.pace) : ui.esc(d.detail)}${d.adj ? ` · <span class="adjt">adjusted</span>` : ''}</div></div>
    ${done ? `<div class="kcol"><div class="kc">${r1(done)}</div><div class="kl">mi done</div></div>` : ''}${st === 'done' && d.mi ? `<span class="tick">${ui.ico('check')}</span>` : ''}</div></section>`;
}

// ---------- Training tab ----------
let picked = null; // what the Trends charts were drawn from, for taps
export async function view(s, ui) {
  const sub = local.get('trainTab', 'plan');
  const data = await load(s);
  const seg = `<div class="seg" id="trainSeg">${[['plan', 'Plan'], ['trends', 'Trends'], ['race', 'Race'], ['goal', 'Boston']].map(([k, l]) => `<button data-k="${k}" class="${k === sub ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  return seg + (sub === 'trends' ? trends(data, ui) : sub === 'race' ? race(data, s, ui) : sub === 'goal' ? boston(data, s, ui) : planView(data, s, ui));
}

function hero({ cfg, autoGoal, plan }, ui) {
  const toRace = T.daysBetween(today(), cfg.raceDate);
  const big = toRace > 0 ? `<b>${toRace}</b><span>days to go</span>` : toRace === 0 ? '<b>Today</b><span>race day</span>' : '<b>Done</b><span>set your next race</span>';
  return `<section class="card hero"><div class="cdown">${big}</div><div class="grow"><div class="rn">${ui.esc(cfg.raceName)}</div>
    <div class="sub">${new Date(cfg.raceDate + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${ui.esc(cfg.raceStart)}</div>
    <div class="goal">Goal <b>${T.fmtTime(cfg.goalSec)}</b> · ${T.fmtPace(plan.z.mp)}/mi${autoGoal ? ' · auto' : ''}</div></div>
    <button class="icon" id="raceEdit" aria-label="Race settings">${ui.ico('settings')}</button></section>`;
}

function planView(data, s, ui) {
  const { plan, runs, cfg, lifts } = data, t = today();
  const nudges = T.notes({ ...data, s });
  for (const g of data.gear.filter(g => !/retired/i.test(g.status || ''))) {
    const { mi, max, pct } = shoeInfo(g), used = data.runs.filter(r => r.date > T.addDays(t, -21) && r.gear?.includes(g.uuid)).length;
    if (pct >= 0.85 && used) nudges.push(['warn', `${g.name} is at ${Math.round(mi)} of ${Math.round(max)} mi. Start the next pair now so it has 30+ mi on it before race day.`]);
  }
  const fz = data.adapted.fatigue;
  if (fz.signals.length === 1) nudges.unshift(['warn', `Watch it: ${fz.signals[0]}. One more sign of fatigue and the next workout turns easy.`]);
  if (!fz.signals.length && fz.strong >= 2) nudges.push(['info', `Your last ${fz.strong} rated runs felt strong. Training is landing well.`]);
  const d = T.planFor(plan, t);
  const next = d && d.kind === 'rest' ? plan.weeks.flatMap(w => w.days).find(x => x.date > t && x.mi > 0) : null;
  const workout = x => `<div class="wo k-${x.kind}"><span class="kst"></span><div class="grow"><div class="name">${x.mi ? miRange(x) + ' · ' : ''}${ui.esc(x.title)}${x.pace ? ` <span class="pace">${paceRange(x.pace)}</span>` : ''}</div><div class="sub">${ui.esc(x.detail)}</div>${x.adj ? `<div class="adjn">${ui.ico('refresh')}${ui.esc(x.adj)}</div>` : ''}</div></div>`;
  const todayCardHtml = d ? `<section class="card"><header><h3>Today</h3>${T.milesOn(runs, t) ? `<span class="hkcal">${r1(T.milesOn(runs, t))} mi done</span>` : ''}</header>${workout(d)}
    ${next ? `<h4 class="nexth">Next: ${wkday(next.date)}</h4>${workout(next)}` : ''}</section>` : '';
  const NOTE_ICO = { warn: 'alert', knee: 'knee', fuel: 'pie', info: 'info' };
  // What the plan changed for the days ahead, so you can see it adapting to what you actually ran.
  const upcoming = data.adapted.changes.filter(([dt]) => dt >= t).sort((a, b) => a[0].localeCompare(b[0]));
  const changedHtml = upcoming.length ? `<section class="card adjcard"><h3>Plan adjusted</h3>${upcoming.map(([dt, why]) => `<button class="adjrow" data-d="${dt}"><b>${wkday(dt)} ${+dt.slice(8)}</b><span>${ui.esc(why)}</span></button>`).join('')}</section>` : '';
  const notesHtml = nudges.length ? `<section class="card notes">${nudges.map(([k, txt]) => `<div class="note ${k}">${ui.ico(NOTE_ICO[k])}<span>${ui.esc(txt)}</span></div>`).join('')}</section>` : '';

  // Calendar: the 3 weeks you've run, then the plan to race day.
  const wkMi = T.weekly(runs), first = plan.weeks[0]?.start || T.weekStart(t);
  const pastWeeks = [3, 2, 1].map(k => T.addDays(first, -7 * k)).map(start => ({
    start, phase: 'Done', past: true, days: Array.from({ length: 7 }, (_, i) => ({ date: T.addDays(start, i), kind: 'past', mi: 0 })),
  }));
  const cell = x => {
    if (x.date < cfg.planStart && x.kind !== 'past') x = { ...x, kind: 'past' };
    const act = T.milesOn(runs, x.date), st = x.kind === 'past' ? '' : T.status(x, T.doneMiles(runs, x));
    const past = x.kind === 'past' || x.date < t;
    // Once you've run, the cell shows what you did (a tempo on an easy day shows as Tempo).
    const ran = x.date <= t && x.kind !== 'race' ? T.ranAs(runs, x.date, plan.z) : null;
    const kind = ran ? ran.kind : x.kind === 'past' ? 'rest' : x.kind;
    const miTxt = past || ran ? (act ? r1(act) : '–') : !x.mi ? '–' : x.kind === 'race' || x.lo === x.hi ? r1(x.mi) : `${x.lo}-${x.hi}`;
    const lvl = ran ? LEVEL[ran.kind] : x.kind === 'past' ? 0 : LEVEL[x.kind] || 0;
    const lifted = lifts.some(l => l.date === x.date);
    return `<button class="cal k-${kind} ${x.date === t ? 'now' : ''} ${st} ${(x.adj || x.moved) && !past ? 'adj' : ''} ${miTxt.length > 4 ? 'rng' : ''}" data-d="${x.date}"><span class="dn">${+x.date.slice(8)}</span>
      ${lifted ? '<i class="lift"></i>' : ''}<span class="mi">${miTxt}</span><span class="kl">${ran ? ran.label : x.kind === 'past' ? '' : calLabel(x)}</span>
      ${lvl ? `<span class="pips">${'<i></i>'.repeat(lvl)}</span>` : ''}
      ${st === 'done' && x.mi ? '<i class="ok"></i>' : st === 'miss' || st === 'part' ? '<i class="miss"></i>' : ''}</button>`;
  };
  const wkHtml = w => {
    const actual = wkMi.get(w.start) || 0;
    const before = w.past || T.addDays(w.start, 6) < cfg.planStart;
    const right = before ? `${r1(actual)} mi` : w.start <= t ? `${r1(actual)} of ${Math.round(w.lo)}-${Math.round(w.hi)} mi` : `${Math.round(w.lo)}-${Math.round(w.hi)} mi`;
    return `<div class="wk ${before ? 'past' : ''}"><div class="wkh"><span>${mon(w.start)} – ${mon(T.addDays(w.start, 6))}</span><span class="ph">${before ? 'Done' : w.phase}</span><b>${right}</b></div>
      <div class="calrow">${w.days.map(cell).join('')}</div></div>`;
  };
  // Finished weeks fold away; this week and the rest of the plan stay open.
  const all = [...pastWeeks, ...plan.weeks], done = all.filter(w => T.addDays(w.start, 6) < t), ahead = all.filter(w => T.addDays(w.start, 6) >= t);
  const doneMi = done.reduce((a, w) => a + (wkMi.get(w.start) || 0), 0);
  const pastHtml = done.length ? `<details class="pastwks" id="pastWks" ${local.get('calPastOpen', false) ? 'open' : ''}><summary><span>${done.length} earlier weeks</span><span class="muted">${mon(done[0].start)} – ${mon(T.addDays(done[done.length - 1].start, 6))} · ${Math.round(doneMi)} mi</span></summary>${done.map(wkHtml).join('')}</details>` : '';
  // Target paces for each kind of day, pinned above the calendar while you scroll it.
  const Z = k => plan.z.list.find(x => x[0] === k);
  // One tile per pace zone, colored like the calendar days that use it, fast–slow per mile.
  const chips = [['easy', 'Recovery', 'recovery'], ['easy', 'Easy', 'easy'], ['long', 'Long · <span class="k-medium">Medium</span>', 'long'], ['quality', 'Marathon', 'mp'], ['quality', 'Tempo', 'tempo'], ['quality', 'Intervals', 'interval']]
    .map(([k, l, z]) => `<div class="ptile k-${k}"><b>${l}</b><span>${T.fmtPace(Z(z)[2])}–${T.fmtPace(Z(z)[3])}</span></div>`).join('');
  return hero(data, ui) + changedHtml + `<section class="card calcard"><h3>Plan to race day</h3>
    <div class="calstick"><div class="ptiles">${chips}</div><div class="calrow dow">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => `<span>${x}</span>`).join('')}</div></div>
    ${pastHtml}${ahead.slice(0, 8).map(wkHtml).join('')}${ahead.length > 8 ? `<details class="pastwks" id="laterWks" ${local.get('calLaterOpen', false) ? 'open' : ''}><summary><span>${ahead.length - 8} more weeks</span><span class="muted">${mon(ahead[8].start)} – ${mon(cfg.raceDate)} · ${ahead.slice(8).map(w => w.phase).filter((x, i, a) => a.indexOf(x) === i && x !== 'Cutback').join(' → ')}</span></summary>${ahead.slice(8).map(wkHtml).join('')}</details>` : ''}
    <p class="muted small">Paces are per mile. Dots show how hard the day is, and any distance in the range counts. Done days show what you actually ran; a purple corner means you lifted. Tap a day to see the workout, swap it with another day, or skip it.</p></section>
  ${todayCardHtml}${notesHtml}
  <section class="card"><details class="how"><summary><h3>How this plan adjusts</h3></summary><ul class="tips">
    <li><b>Ranges, not exact miles.</b> Anything in the range counts as done. Long runs flex down, not up.</li>
    <li><b>Ran short on an easy day?</b> About half of it gets added to your remaining easy days this week (max +1.5 mi a day). The rest is let go; chasing missed miles is how knees get hurt.</li>
    <li><b>Ran extra?</b> Extra miles on any day (a longer long run, a run on a rest day) come off your later easy days that week, up to 2 mi a day.</li>
    <li><b>Went harder than planned?</b> A tempo-paced run on an easy day, or a long run near race pace or rated 9-10/10 effort, counts as a hard day. The next day becomes a short recovery run, a workout in the next 2 days turns easy, and after a hard long run the next workout gets shorter.</li>
    <li><b>Goal and paces</b> update from your runs until the taper starts, then hold still so race pace doesn't move in the last 3 weeks.</li>
    <li><b>Missed the long run?</b> It moves to the next day or two (never in race week). If you ran it on another day, that counts.</li>
    <li><b>Missed a workout?</b> It moves to today if today is easy and not the day before the long run, otherwise it's dropped so hard days don't stack.</li>
    <li><b>Tired?</b> If two signals line up (resting HR up, recent runs rated weak, or easy runs rated hard effort in Garmin), the next workout turns into an easy run.</li>
    <li><b>Week to week</b>, mileage is rebuilt from what you actually ran the last 4-6 weeks. Lock your goal time with the gear so paces don't drift.</li>
  </ul></details></section>`;
}

function trends({ runs, gdays, plan, cfg, gear }, ui) {
  const t = today(), first = T.weekStart(T.addDays(t, -7 * 11));
  const weeks = Array.from({ length: 12 }, (_, i) => T.addDays(first, 7 * i));
  const wk = T.weekly(runs);
  const miles = weeks.map(w => wk.get(w) || 0);
  const planned = weeks.map(w => plan.weeks.find(p => p.start === w)?.mi);
  const inWeek = w => runs.filter(r => T.weekStart(r.date) === w);
  const paceW = weeks.map(w => { const rs = inWeek(w).filter(r => r.sec && r.mi >= 2); const mi = rs.reduce((a, r) => a + r.mi, 0); return mi ? rs.reduce((a, r) => a + r.sec, 0) / mi / 60 : NaN; });
  const longW = weeks.map(w => Math.max(0, ...inWeek(w).map(r => r.mi)));
  const days = Array.from({ length: 30 }, (_, i) => T.addDays(t, i - 29));
  const g = d => gdays[d] || {};
  const last4 = miles.slice(-5, -1), avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const r28 = runs.filter(r => r.date > T.addDays(t, -28) && r.sec), mi28 = r28.reduce((a, r) => a + r.mi, 0);
  const steps7 = days.slice(-7).map(d => g(d).steps).filter(Boolean), rhr7 = days.slice(-7).map(d => g(d).rhr).filter(Boolean);
  const stat = (k, v, sub, cls) => `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="k">${sub}</div>` : ''}</div>`;
  const recent = runs.filter(r => r.mi >= 1).slice(-10).reverse();
  picked = { weeks, days, inWeek, miles, paceW, longW, g };
  return `<section class="card"><div class="stats">
    ${stat('This week', r1(miles[11]) + ' mi', planned[11] && weeks[11] >= T.weekStart(cfg.planStart) ? 'plan ' + r1(planned[11]) : 'per week', 'run')}${stat('4-wk avg', r1(avg(last4)) + ' mi', 'per week', 'run')}
    ${stat('Longest', r1(Math.max(...longW.slice(-4))) + ' mi', 'last 4 wks', 'burn')}${stat('Avg pace', mi28 ? T.fmtPace(r28.reduce((a, r) => a + r.sec, 0) / mi28) : '–', 'last 28 days', 'p')}
    ${stat('Steps', steps7.length ? Math.round(avg(steps7)).toLocaleString() : '–', '7-day avg', 'steps')}${stat('Rest HR', rhr7.length ? Math.round(avg(rhr7)) : '–', '7-day avg', 'heart')}
  </div></section>
  ${shoes(gear, ui)}
  <section class="card"><h3>Weekly miles</h3><div class="tipbox"><span class="muted">Tap a week to see it</span></div>${bars(weeks, miles, null, { title: 'Weekly miles', cls: 'run', id: 'wk' })}</section>
  <section class="card"><h3>Average pace (min/mi)</h3><div class="tipbox"><span class="muted">Tap a week to see it</span></div>${line(weeks, paceW, { title: 'Pace', fmt: v => T.fmtPace(v * 60), id: 'pace' })}</section>
  <section class="card"><h3>Steps</h3><div class="tipbox"><span class="muted">Tap a day to see it</span></div>${bars(days, days.map(d => g(d).steps || 0), null, { title: 'Steps', cls: 'steps', id: 'steps' })}</section>
  <section class="card"><h3>Resting heart rate</h3><div class="tipbox"><span class="muted">Tap a day to see it</span></div>${line(days, days.map(d => g(d).rhr || NaN), { title: 'Resting HR', id: 'rhr' })}<p class="muted small">A few bpm above your normal for 2-3 days usually means back off.</p></section>
  <section class="card"><h3>Recent runs</h3><ul class="entries runs">${recent.map(r => `<li><div class="grow"><div class="r1"><span class="name">${ui.esc(r.name || 'Run')}</span><span class="kc">${r1(r.mi)} mi</span></div>
    <div class="r2"><span class="sub">${wkday(r.date)} ${mon(r.date)}${r.tread ? ' · treadmill' : ''}</span><span class="macros">${r.sec ? T.fmtPace(r.sec / r.mi) + '/mi' : ''}${r.hr ? ` · ${r.hr} bpm` : ''}</span></div>
    ${T.feelText(r) || r.gear?.length ? `<div class="r3">${[T.feelText(r), shoeName(gear, r.gear)].filter(Boolean).map(ui.esc).join(' · ')}</div>` : ''}</div></li>`).join('') || '<li class="empty small">No runs synced yet.</li>'}</ul>
    ${runs.some(r => r.feel != null || r.rpe) ? '' : '<p class="muted small">Rate "How did you feel" and effort in Garmin after runs; they show here and the plan uses them to spot fatigue.</p>'}</section>`;
}

// Running shoes from Garmin gear: miles vs the shoe's max (Garmin's setting, else 400 mi).
export const shoeInfo = g => { const mi = (g.distance || 0) / 1609.34, max = g.maxM ? g.maxM / 1609.34 : 400; return { mi, max, pct: mi / max }; };
function shoes(gear, ui) {
  const active = gear.filter(g => !/retired/i.test(g.status || ''));
  if (!active.length) return `<section class="card"><h3>Shoes</h3><p class="muted small">Add your shoes under Gear in Garmin Connect. Mileage shows here after the next sync, with a heads-up when a pair is wearing out.</p></section>`;
  return `<section class="card"><h3>Shoes</h3><ul class="shoes">${active.sort((a, b) => (b.distance || 0) - (a.distance || 0)).map(g => {
    const { mi, max, pct } = shoeInfo(g);
    return `<li class="${pct >= 1 ? 'over' : pct >= 0.85 ? 'warn' : ''}"><div class="r1"><span class="name">${ui.esc(g.name || 'Shoe')}</span><b>${Math.round(mi)} <span class="muted">/ ${Math.round(max)} mi</span></b></div>
      <div class="track"><div style="width:${Math.min(100, pct * 100)}%"></div></div>
      <div class="sub">${pct >= 1 ? 'Past its mileage. Replace it.' : pct >= 0.85 ? `About ${Math.round(max - mi)} mi left. Get the next pair now.` : `${g.activities || 0} activities${g.since ? ' since ' + mon(g.since) : ''}`}</div></li>`;
  }).join('')}</ul></section>`;
}

function race({ cfg, plan, pred, autoGoal }, s, ui) {
  const z = plan.z, kg = (s.profile?.weightLb || 180) / 2.2046, marathon = cfg.raceMi > 26;
  const split = mi => T.fmtTime(z.mp * mi);
  const splits = (marathon ? [[3.107, '5K'], [6.214, '10K'], [13.109, 'Half'], [20, '20 mi'], [26.219, 'Finish']] : [[3.107, '5K'], [6.214, '10K'], [10, '10 mi'], [13.109, 'Finish']]);
  return hero({ cfg, autoGoal, plan }, ui) + `
  <section class="card"><h3>Fitness check</h3>${pred ? `<p>Your recent runs point to about <b>${T.fmtTime(pred.sec)}</b> for the marathon. ${pred.vol ? `That includes +${Math.round(pred.vol * 100)}% because you've averaged ${Math.round(pred.avgWk)} mi a week; race formulas run fast on lower mileage. ` : ''}${autoGoal ? `Goal: <b>${T.fmtTime(cfg.goalSec)}</b>.` : ''}</p>
    <ul class="entries runs">${pred.basis.map(r => `<li><div class="grow"><div class="r1"><span class="name">${r1(r.mi)} mi in ${T.fmtTime(r.sec)}</span><span class="kc">${T.fmtTime(r.eq)}</span></div><div class="r2"><span class="sub">${mon(r.date)}${r.tread ? ' · treadmill (+2%)' : ''}</span><span class="macros">${T.fmtPace(r.sec / r.mi)}/mi</span></div></div></li>`).join('')}</ul>
    <p class="muted small">Riegel formula on your 3 fastest runs of 5+ mi from the last 8 weeks (the middle one counts). Treadmill runs get +2% for no wind or hills.</p>` : '<p class="muted">Sync a few Garmin runs of 5+ miles to get a prediction.</p>'}</section>
  <section class="card"><h3>Paces</h3><table class="tbl zones">${z.list.map(([k, l, lo, hi, d]) => `<tr class="k-${k}"><td><b>${l}</b><div class="muted small">${d}</div></td><td>${T.fmtPace(lo)}–${T.fmtPace(hi)}</td></tr>`).join('')}</table></section>
  <section class="card"><h3>Race-day splits</h3><table class="tbl splits">${splits.map(([mi, l]) => `<tr><td>${l}</td><td>${split(mi)}</td></tr>`).join('')}</table>
    <p class="muted small">Even pacing at ${T.fmtPace(z.mp)}/mi. Run the first 3 mi 5-10 s/mi slower, then settle in. Only push after mile 20 if you feel good.</p></section>
  <section class="card"><h3>Fueling</h3><ul class="tips">
    <li><b>Carb-load</b> the 3 days before: about ${Math.round((kg * 8) / 10) * 10} g carbs a day (8 g/kg), lower fat and fiber. Lean on rice, bagels, potatoes, juice.</li>
    <li><b>Race morning</b> breaks the 16:8 fast: eat ${Math.round((kg * 1.5) / 10) * 10}-${Math.round((kg * 2) / 10) * 10} g carbs about 3 h before the ${ui.esc(cfg.raceStart)} start. Bagel, banana, honey.</li>
    <li><b>During</b>: 60-90 g carbs an hour, a gel every 30-40 min starting at mile 4, water at most aid stations. Only use what you tested on long runs.</li>
    <li><b>Adderall XR + caffeine</b> both raise heart rate and blunt appetite. Take your normal dose only if you've done it before a long run, eat before it kicks in, and don't stack extra caffeine gels.</li>
  </ul></section>
  <section class="card"><h3>Knee</h3><ul class="tips">
    <li>Taper is when niggles show up. Sharp lateral knee pain, swelling, catching or locking means stop and get it checked, not "run through it."</li>
    <li>Keep 1-2 short strength sessions a week (glutes, quads, single-leg) through the taper, lighter in race week.</li>
    <li>On race day, shorten your stride on downhills instead of braking.</li>
  </ul></section>`;
}

// ---------- Boston: the long game ----------
const hms = sec => sec ? T.fmtTime(sec).replace(/^0:/, '') : '–';
const PH_TARGET = (sea, k) => ({ recover: 25, base: sea.baseTop, speed: sea.baseTop + 4, gate: sea.baseTop + 4, block: sea.peakMi })[k];
function boston({ cfg, runs, pred, plan }, s, ui) {
  const sea = cfg.season, t = today(), road = T.roadmap(cfg, t), nowP = road.find(p => p.now) || road.find(p => p.from > t);
  const bq = sea.races.find(r => r.bq), toBq = bq ? T.daysBetween(t, bq.date) : null;
  const sec = pred?.sec, gap = sec ? sec - sea.aim : null;
  const verdict = !sec ? 'Sync a few runs of 5+ mi to see where you stand.'
    : sec <= sea.aim ? `Your runs point to ${hms(sec)}: under ${hms(sea.aim)}. That's a BQ with room for the cutoff.`
    : sec <= sea.std ? `Your runs point to ${hms(sec)}: under the ${hms(sea.std)} standard but inside the cutoff zone. Another ${Math.ceil((sec - sea.aim) / 60)} min makes it safe.`
    : `Your runs point to ${hms(sec)}. ${Math.ceil(gap / 60)} min to find${toBq > 0 ? ` in ${Math.round(toBq / 7)} weeks` : ''}. Miles find most of it.`;
  const avgWk = pred?.avgWk ?? (() => { const w = T.weekly(runs), m = T.weekStart(t); return Array.from({ length: 8 }, (_, k) => w.get(T.addDays(m, -7 * (k + 1))) || 0).reduce((a, b) => a + b, 0) / 8; })();
  const target = nowP && PH_TARGET(sea, nowP.k), hd = T.hardDays(runs, plan.z, t);
  // Checkpoint result: a 13-13.5 mi run on (or a day either side of) the checkpoint date.
  const gates = sea.races.filter(r => r.gate).map(g => {
    const res = runs.filter(r => Math.abs(T.daysBetween(g.date, r.date)) <= 1 && r.mi >= 12.9 && r.mi <= 13.6 && r.sec).sort((a, b) => a.sec - b.sec)[0];
    const v = !res ? '' : res.sec <= g.gate[0] ? `Under ${hms(g.gate[0])}: go for ${hms(sea.aim)} at ${bq?.name || 'the BQ race'}.` : res.sec <= g.gate[1] ? `Under ${hms(g.gate[1])}: a ${hms(sea.std)} attempt is on (lottery spot if it holds).` : `Slower than ${hms(g.gate[1])}: race ${bq?.name || 'the fall marathon'} for a PR and aim the BQ at the next window.`;
    return { g, res, v };
  });
  const row = p => `<li class="${p.now ? 'now' : p.done ? 'done' : ''} k-${p.k === 'race' || p.k === 'gate' ? 'race' : p.k === 'block' ? 'quality' : p.k === 'speed' ? 'long' : 'easy'}"><span class="kst"></span><div class="grow">
    <div class="r1"><span class="name">${ui.esc(p.name)}${p.race?.tbc ? ' <span class="muted small">date not set</span>' : ''}</span><span class="muted small">${p.from === p.to ? mon(p.from) : `${mon(p.from)} – ${mon(p.to)}`}</span></div>
    ${p.note || p.race?.gate ? `<div class="sub">${ui.esc(p.note || `Checkpoint: ${hms(p.race.gate[0])} or faster = ${hms(sea.aim)} shot; ${hms(p.race.gate[1])} or faster = ${hms(sea.std)} shot.`)}</div>` : ''}</div></li>`;
  return `<section class="card hero"><div class="cdown">${toBq > 0 ? `<b>${toBq}</b><span>days to ${ui.esc((bq.name || '').replace(/ Marathon$/, ''))}</span>` : '<b>BQ</b><span>set the race</span>'}</div><div class="grow"><div class="rn">${ui.esc(sea.goal)}</div>
    <div class="sub">Standard ${hms(sea.std)} · aim ${hms(sea.aim)} for the cutoff</div><div class="goal">Window closes about <b>${mon(sea.windowEnd)}</b>${sea.windowEnd.slice(0, 4) !== t.slice(0, 4) ? ` ${sea.windowEnd.slice(0, 4)}` : ''}</div></div>
    <button class="icon" id="seasonEdit" aria-label="Edit season">${ui.ico('settings')}</button></section>
  <section class="card"><h3>Where you stand</h3><p>${ui.esc(verdict)}</p>
    <div class="stats">
      <div class="stat run"><div class="k">Predicted</div><div class="v">${hms(sec)}</div><div class="k">marathon</div></div>
      <div class="stat burn"><div class="k">Mi / week</div><div class="v">${Math.round(avgWk)}</div><div class="k">${target ? `aim ${Math.round(target)} now` : '8-wk avg'}</div></div>
      <div class="stat ${hd.length > 2 ? 'heart' : 'steps'}"><div class="k">Hard days</div><div class="v">${hd.length}</div><div class="k">last 7 · max 2</div></div>
    </div>
    <p class="muted small">Prediction is the same one the Race tab uses. Months out it looks back 6 months, so easy base weeks don't drag it down.</p></section>
  ${gates.map(({ g, res, v }) => `<section class="card"><h3>Checkpoint: ${ui.esc(g.name)}</h3>${res ? `<p><b>${hms(res.sec)}</b> on ${mon(res.date)}. ${ui.esc(v)}</p>` : `<p>${mon(g.date)}${g.tbc ? ' (pick the race and set the date)' : ''}. ${hms(g.gate[0])} or faster: ${hms(sea.aim)} is on. ${hms(g.gate[1])} or faster: ${hms(sea.std)} is on. Slower: the fall race is a PR race and the BQ moves to the next window.</p>`}</section>`).join('')}
  <section class="card"><h3>The road</h3><ul class="entries road">${road.filter(p => !p.done || p.k === 'race').map(row).join('')}</ul>
    <p class="muted small">The Plan tab follows this on its own: after each marathon it builds recovery, base and speed weeks, then the race block. Long runs stop at 20 mi and no week jumps more than ~10%, for the knee.</p></section>
  <section class="card"><h3>Rules that get you there</h3><ul class="tips">
    <li><b>Easy means easy.</b> Two hard days a week. The rest conversational.</li>
    <li><b>Miles first.</b> Most of the gap closes by holding 55-65 mi weeks, not by faster workouts.</li>
    <li><b>Cut only in base.</b> Once workouts start, eat at maintenance.</li>
    <li><b>Strength 2× a week</b> (single-leg squats, step-downs, RDLs, calf raises) and 7.5 h+ sleep past 50 mi a week.</li>
  </ul></section>`;
}

function openSeason(s, ui) {
  const sea = T.season(s);
  const raceRow = (r, i) => `<fieldset class="srace" data-i="${i}"><legend>${r.mi > 26 ? 'Marathon' : 'Half'}${r.gate ? ' · checkpoint' : ''}${r.bq ? ' · BQ race' : ''}</legend>
    <label>Name<input class="sName" value="${ui.esc(r.name)}"></label><label>Date<input class="sDate" type="date" value="${r.date}"></label>
    <label>Distance<select class="sMi"><option value="26.2" ${r.mi > 26 ? 'selected' : ''}>Marathon</option><option value="13.1" ${r.mi < 26 ? 'selected' : ''}>Half marathon</option></select></label>
    <button class="sDel">Remove</button></fieldset>`;
  const b = ui.sheet(`<label>Goal<input id="sGoal" value="${ui.esc(sea.goal)}"></label>
    <label>Qualifying standard<input id="sStd" inputmode="numeric" value="${T.fmtTime(sea.std)}"></label>
    <label>Aim (standard minus a cutoff buffer)<input id="sAim" inputmode="numeric" value="${T.fmtTime(sea.aim)}"></label>
    <label>Window closes<input id="sWin" type="date" value="${sea.windowEnd}"></label>
    <h4>Races</h4><div id="sRaces">${sea.races.map(raceRow).join('')}</div>
    <div class="actions"><button id="sAdd">Add race</button><button class="primary" id="sSave">Save</button></div>
    <p class="muted small">Marathons set the plan, in date order: after each one, the next becomes your race. Halves between them are checkpoints.</p>`, { title: 'Season' });
  let races = sea.races.map(r => ({ ...r }));
  const read = () => ui.$$('.srace', b).forEach(f => { const r = races[+f.dataset.i]; Object.assign(r, { name: ui.$('.sName', f).value.trim() || r.name, date: ui.$('.sDate', f).value || r.date, mi: +ui.$('.sMi', f).value }); if (r.date !== sea.races.find(x => x.id === r.id)?.date) r.tbc = false; });
  const redraw = () => { ui.$('#sRaces', b).innerHTML = races.map(raceRow).join(''); wire(); };
  const wire = () => ui.$$('.sDel', b).forEach(x => (x.onclick = () => { read(); races.splice(+x.closest('.srace').dataset.i, 1); redraw(); }));
  wire();
  ui.$('#sAdd', b).onclick = () => { read(); races.push({ id: 'r' + Date.now(), name: 'Marathon', date: T.addDays(races.at(-1)?.date || today(), 70), start: '7:00 AM', mi: 26.2 }); redraw(); };
  ui.$('#sSave', b).onclick = async () => {
    read();
    races = races.map(r => r.mi < 26 && !r.gate ? { ...r, gate: [sea.aim * 0.479, sea.std * 0.48].map(Math.round) } : r);
    const season = { goal: ui.$('#sGoal', b).value.trim() || sea.goal, std: T.parseTime(ui.$('#sStd', b).value) || sea.std, aim: T.parseTime(ui.$('#sAim', b).value) || sea.aim,
      windowEnd: ui.$('#sWin', b).value || sea.windowEnd, races: races.sort((x, y) => x.date.localeCompare(y.date)) };
    await db.saveSettings({ ...s, training: { ...(s.training || {}), season: { ...(s.training?.season || {}), ...season } } });
    ui.closeSheet(); ui.toast('Season saved'); ui.render();
  };
}

export function bind(root, s, ui) {
  ui.$$('#trainSeg button', root).forEach(b => (b.onclick = () => { local.set('trainTab', b.dataset.k); ui.render(); }));
  const edit = ui.$('#raceEdit', root);
  if (edit) edit.onclick = () => openRace(s, ui);
  ui.$$('.cal[data-d], .adjrow[data-d]', root).forEach(c => (c.onclick = () => openDay(s, c.dataset.d, ui)));
  const pw = ui.$('#pastWks', root); if (pw) pw.ontoggle = () => local.set('calPastOpen', pw.open);
  const lw = ui.$('#laterWks', root); if (lw) lw.ontoggle = () => local.set('calLaterOpen', lw.open);
  const se = ui.$('#seasonEdit', root); if (se) se.onclick = () => openSeason(s, ui);
  if (picked) bindCharts(root, (id, i, c) => {
    const P = picked, box = c.closest('.card').querySelector('.tipbox');
    if (id === 'wk' || id === 'pace') {
      const w = P.weeks[i], rs = P.inWeek(w).filter(r => r.mi >= 1);
      box.innerHTML = `<div class="grow"><div class="tl">${mon(w)} – ${mon(T.addDays(w, 6))}</div><div><b>${r1(P.miles[i])} mi</b> <span class="muted">· ${rs.length} runs${P.longW[i] ? ` · long ${r1(P.longW[i])}` : ''}${Number.isFinite(P.paceW[i]) ? ` · ${T.fmtPace(P.paceW[i] * 60)}/mi avg` : ''}</span></div>
        <div class="wkruns">${rs.map(r => `<button data-d="${r.date}">${wkday(r.date)} ${r1(r.mi)}</button>`).join('')}</div></div>`;
      ui.$$('.wkruns button', box).forEach(b => (b.onclick = () => openDay(s, b.dataset.d, ui)));
    } else {
      const d = P.days[i], gd = P.g(d);
      box.innerHTML = `<div class="grow"><div class="tl">${wkday(d)} ${mon(d)}</div><div>${id === 'steps' ? `<b>${(gd.steps || 0).toLocaleString()}</b> steps` : gd.rhr ? `<b>${gd.rhr}</b> bpm resting` : '<span class="muted">No data</span>'}</div></div>
        <button class="link">Open day ${ui.ico('next')}</button>`;
      box.querySelector('button').onclick = () => ui.goDay(d);
    }
  });
}

async function openDay(s, date, ui) {
  const { plan, runs, lifts, gear, cfg } = await load(s);
  const d = T.planFor(plan, date), done = runs.filter(r => r.date === date), lf = lifts.filter(l => l.date === date), t = today();
  const ran = date <= t && d && d.kind !== 'race' ? T.ranAs(runs, date, plan.z) : null;
  const diff = ran && d.kind !== 'rest' && ran.label !== calLabel(d) ? `You ran ${ran.label.toLowerCase()} (${r1(ran.mi)} mi); the plan had ${calLabel(d).toLowerCase()}.` : ran && d.kind === 'rest' ? `Planned rest; you ran ${r1(ran.mi)} mi.` : '';
  const tags = cfg.lifts || {}, bests = await Promise.all(lf.map(l => L.forSession(l.id)));
  const legsBefore = lifts.some(l => l.date === T.addDays(date, -1) && (tags[l.id] || []).includes('Legs'));
  const hint = !d ? '' : (legsBefore && (d.kind === 'quality' || d.kind === 'long') ? 'Legs yesterday, so start this one easy and see how they feel. ' : '') + T.liftHint(plan, date);
  // Swap targets: other days of the same week that haven't happened yet.
  const wk = plan.weeks.find(w => w.days.some(x => x.date === date));
  const open = x => x.date >= t && x.kind !== 'race' && !T.milesOn(runs, x.date);
  const canMove = d && open(d);
  const others = canMove ? wk.days.filter(x => x.date !== date && open(x)) : [];
  const b = ui.sheet(`${d ? `<div class="wo k-${d.kind}"><span class="kst"></span><div class="grow"><div class="name">${d.mi ? miRange(d) + ' · ' : ''}${ui.esc(d.title)}</div>
      ${d.pace ? `<div class="pace">${paceRange(d.pace)}</div>` : ''}<div class="sub">${ui.esc(d.detail)}</div>
      ${[d.moved, d.adj, diff].filter(Boolean).map(x => `<div class="adjn">${ui.ico('refresh')}${ui.esc(x)}</div>`).join('')}</div></div>
      ${hint ? `<p class="lifthint"><b>Lifting:</b> ${ui.esc(hint)}</p>` : ''}` : '<p class="muted">Before the plan started.</p>'}
    <h4>Garmin</h4>${done.length ? `<ul class="entries runs">${done.map(r => `<li><div class="grow"><div class="r1"><span class="name">${ui.esc(r.name || 'Run')}</span><span class="kc">${r1(r.mi)} mi</span></div>
      <div class="r2"><span class="sub">${r.tread ? 'treadmill' : 'outdoor'}</span><span class="macros">${r.sec ? T.fmtPace(r.sec / r.mi) + '/mi' : ''}${r.hr ? ` · ${r.hr} bpm` : ''}</span></div>
      ${T.feelText(r) || r.gear?.length ? `<div class="r3">${[T.feelText(r), shoeName(gear, r.gear)].filter(Boolean).map(ui.esc).join(' · ')}</div>` : ''}</div></li>`).join('')}</ul>` : ''}
    ${lf.map((l, i) => `<div class="liftrow"><div class="r1"><span class="name">${ui.esc(l.name || 'Strength')}</span><span class="muted">${l.min} min${l.hr ? ` · ${l.hr} bpm` : ''}</span></div>
      ${bests[i] ? `<div class="sub">Best lift: ${ui.esc(bests[i].name)} ${ui.esc(L.setText(bests[i]))}</div>` : ''}
      <div class="wkruns lifttags" data-id="${l.id}">${T.LIFTS.map(k => `<button data-t="${k}" class="${(tags[l.id] || []).includes(k) ? 'on' : ''}">${k}</button>`).join('')}</div></div>`).join('')}
    ${!done.length && !lf.length ? `<p class="muted small">${date > t ? 'Not yet.' : 'Nothing from Garmin.'}</p>` : ''}
    ${canMove ? `<h4>Change this day</h4>${others.length ? `<p class="muted small">Tap a day to swap with it.</p>
      <div class="wkruns swaps">${others.map(x => `<button data-sw="${x.date}">${wkday(x.date)} · ${x.kind === 'rest' ? 'Rest' : calLabel(x)}</button>`).join('')}</div>
      <label class="chk"><input type="checkbox" id="swEvery"> Every week until race week</label>` : ''}
      <div class="actions">${d.moved ? '<button id="swUndo">Undo change</button>' : ''}${d.kind !== 'rest' ? '<button id="swSkip">Skip this day</button>' : ''}</div>` : ''}`,
    { title: new Date(date + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) });
  const save = async (patch, msg) => { await db.saveSettings({ ...s, training: { ...(s.training || {}), ...patch } }); ui.closeSheet(); ui.toast(msg); ui.render(); };
  const tr = s.training || {}, dw = x => new Date(x + 'T12:00').getDay();
  ui.$$('[data-sw]', b).forEach(x => (x.onclick = () => ui.$('#swEvery', b).checked
    ? save({ weekSwaps: [...(tr.weekSwaps || []), [dw(date), dw(x.dataset.sw), T.weekStart(t)]] }, `${T.DOW[dw(date)]} and ${T.DOW[dw(x.dataset.sw)]} swapped every week`)
    : save({ swaps: [...(tr.swaps || []), [date, x.dataset.sw]] }, 'Swapped')));
  const undo = ui.$('#swUndo', b);
  if (undo) undo.onclick = () => save({
    swaps: (tr.swaps || []).filter(p => !p.includes(date)), skips: (tr.skips || []).filter(x => x !== date),
    weekSwaps: /^Every week/.test(d.moved) ? (tr.weekSwaps || []).filter(p => p[0] !== dw(date) && p[1] !== dw(date)) : tr.weekSwaps || [],
  }, 'Back to the plan');
  const skip = ui.$('#swSkip', b);
  if (skip) skip.onclick = () => save({ skips: [...(tr.skips || []), date] }, 'Skipped');
  // Lift tags: tap Push / Pull / Legs... on a watch "Strength" session. Saved with your settings.
  ui.$$('.lifttags', b).forEach(g => ui.$$('button', g).forEach(x => (x.onclick = async () => {
    const id = g.dataset.id, cur = new Set(tags[id] || []);
    cur.has(x.dataset.t) ? cur.delete(x.dataset.t) : cur.add(x.dataset.t);
    x.classList.toggle('on');
    const lifts2 = { ...(s.training?.lifts || {}), [id]: [...cur] };
    s.training = { ...(s.training || {}), lifts: lifts2 };
    await db.saveSettings({ ...s });
  })));
  return b;
}

function openRace(s, ui) {
  const c = T.config(s);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const b = ui.sheet(`<label>Race<input id="rName" value="${ui.esc(c.raceName)}"></label>
    <label>Date<input id="rDate" type="date" value="${c.raceDate}"></label>
    <label>Start time<input id="rStart" value="${ui.esc(c.raceStart)}"></label>
    <label>Distance<select id="rMi"><option value="26.2" ${c.raceMi > 26 ? 'selected' : ''}>Marathon</option><option value="13.1" ${c.raceMi < 26 ? 'selected' : ''}>Half marathon</option></select></label>
    <label>Goal time (h:mm:ss, blank = auto from your runs)<input id="rGoal" inputmode="numeric" placeholder="auto" value="${c.goalSec ? T.fmtTime(c.goalSec) : ''}"></label>
    <label>Long run day<select id="rLong">${days.map((d, i) => `<option value="${i}" ${i === c.longDay ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
    <label>Rest days a week<select id="rRest">${[[2, '2 (after and before the long run)'], [1, '1 (after the long run)'], [0, 'None (easy runs instead)']].map(([v, l]) => `<option value="${v}" ${v === c.restDays ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <p class="muted small">Same weekly miles either way, spread over more days. To move a rest day, tap it on the calendar and swap.</p>
    <div class="actions"><button class="primary" id="rSave">Save</button></div>`, { title: 'Race settings' });
  ui.$('#rSave', b).onclick = async () => {
    // A season race (after the first one) is saved on the race itself; settings keep the original race.
    if (c.prevRace) {
      const sea = T.season(s), v = { name: ui.$('#rName', b).value.trim() || c.raceName, date: ui.$('#rDate', b).value || c.raceDate, start: ui.$('#rStart', b).value.trim(), mi: +ui.$('#rMi', b).value, goalSec: T.parseTime(ui.$('#rGoal', b).value), tbc: false };
      const races = sea.races.map(r => r.id === c.raceId ? { ...r, ...v } : r);
      await db.saveSettings({ ...s, training: { ...(s.training || {}), restDays: +ui.$('#rRest', b).value, longDay: +ui.$('#rLong', b).value, season: { ...(s.training?.season || {}), races } } });
      ui.closeSheet(); ui.toast('Race saved'); ui.render(); return;
    }
    const training = { ...(s.training || {}), restDays: +ui.$('#rRest', b).value, raceName: ui.$('#rName', b).value.trim() || c.raceName, raceDate: ui.$('#rDate', b).value || c.raceDate, raceStart: ui.$('#rStart', b).value.trim(),
      raceMi: +ui.$('#rMi', b).value, goalSec: T.parseTime(ui.$('#rGoal', b).value), longDay: +ui.$('#rLong', b).value,
      planStart: ui.$('#rDate', b).value !== c.raceDate ? T.weekStart(today()) : c.planStart };
    await db.saveSettings({ ...s, training });
    ui.closeSheet(); ui.toast('Race saved'); ui.render();
  };
}
