// Training tab (Plan / Trends / Race) and the small plan card on Today.
// Shell helpers come in from app.js as `ui` so this file stays self-contained.
import * as db from './db.js';
import { today, monthOf, local } from './db.js';
import * as sync from './sync.js';
import * as T from './training.js';
import { bars, line, bindCharts } from './charts.js';

const KIND = { easy: 'Easy', medium: 'Medium', quality: 'Workout', long: 'Long', race: 'Race', rest: 'Rest', recovery: 'Recover' };
const r1 = v => Math.round(v * 10) / 10;
const paceRange = p => p ? `${T.fmtPace(p[1])}-${T.fmtPace(p[0])}/mi` : '';
const mon = d => new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const wkday = d => new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' });

// Everything the tab needs: Garmin days for ~4 months, runs, config with a goal, the plan.
async function load(s, ref = today()) {
  const cfg = T.config(s);
  const months = [...new Set(Array.from({ length: 5 }, (_, i) => monthOf(T.addDays(ref, -31 * i))))].sort();
  const gdays = Object.assign({}, ...(await Promise.all(months.map(m => sync.garminMonth(m).catch(() => ({ days: {} }))))).map(g => g.days || {}));
  const manual = (await db.all('exercises')).filter(x => x.run && x.mi > 0);
  for (const x of manual) (gdays[x.date] ??= { activities: [] }).activities = [...(gdays[x.date].activities || []), { name: x.name, type: 'running', distance: x.mi * 1609.34, duration: (x.min || 0) * 60 }];
  const runs = T.runsFrom(gdays);
  const pred = T.predict(runs, ref);
  const autoGoal = !cfg.goalSec;
  if (autoGoal) cfg.goalSec = pred ? T.suggestGoal(pred.sec) : 4 * 3600;
  const plan = T.buildPlan(cfg, runs, ref);
  return { cfg, gdays, runs, pred, autoGoal, plan };
}

// ---------- Today card ----------
export async function todayCard(s, date, ui) {
  const { cfg, runs, plan } = await load(s);
  const toRace = T.daysBetween(today(), cfg.raceDate);
  if (toRace < -1) return '';
  const d = T.planFor(plan, date);
  if (!d) return '';
  const done = T.milesOn(runs, date), st = T.status(d, done);
  const short = cfg.raceName.replace(/ (Marathon|Half Marathon)$/, '');
  return `<section class="card trainday k-${d.kind}" id="trainCard"><header><h3>Training</h3><span class="cd">${toRace === 0 ? 'Race day!' : toRace > 0 ? `${toRace} days to ${ui.esc(short)}` : ''}</span>${ui.ico('next')}</header>
    <div class="tdrow"><span class="kst"></span><div class="grow"><div class="name">${d.mi ? `${d.mi} mi · ` : ''}${ui.esc(d.title)}</div>
    <div class="sub">${d.pace ? paceRange(d.pace) : ui.esc(d.detail)}</div></div>
    ${done ? `<div class="kcol"><div class="kc">${r1(done)}</div><div class="kl">mi done</div></div>` : ''}${st === 'done' && d.mi ? `<span class="tick">${ui.ico('check')}</span>` : ''}</div></section>`;
}

// ---------- Training tab ----------
let picked = null; // what the Trends charts were drawn from, for taps
export async function view(s, ui) {
  const sub = local.get('trainTab', 'plan');
  const data = await load(s);
  const seg = `<div class="seg" id="trainSeg">${[['plan', 'Plan'], ['trends', 'Trends'], ['race', 'Race']].map(([k, l]) => `<button data-k="${k}" class="${k === sub ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  return seg + (sub === 'trends' ? trends(data, ui) : sub === 'race' ? race(data, s, ui) : planView(data, s, ui));
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
  const { plan, runs, cfg } = data, t = today();
  const nudges = T.notes({ ...data, s });
  const d = T.planFor(plan, t);
  const next = d && d.kind === 'rest' ? plan.weeks.flatMap(w => w.days).find(x => x.date > t && x.mi > 0) : null;
  const workout = x => `<div class="wo k-${x.kind}"><span class="kst"></span><div class="grow"><div class="name">${x.mi ? x.mi + ' mi · ' : ''}${ui.esc(x.title)}${x.pace ? ` <span class="pace">${paceRange(x.pace)}</span>` : ''}</div><div class="sub">${ui.esc(x.detail)}</div></div></div>`;
  const todayCardHtml = d ? `<section class="card"><header><h3>Today</h3>${T.milesOn(runs, t) ? `<span class="hkcal">${r1(T.milesOn(runs, t))} mi done</span>` : ''}</header>${workout(d)}
    ${next ? `<h4 class="nexth">Next: ${wkday(next.date)}</h4>${workout(next)}` : ''}</section>` : '';
  const NOTE_ICO = { warn: 'alert', knee: 'knee', fuel: 'pie', info: 'info' };
  const notesHtml = nudges.length ? `<section class="card notes">${nudges.map(([k, txt]) => `<div class="note ${k}">${ui.ico(NOTE_ICO[k])}<span>${ui.esc(txt)}</span></div>`).join('')}</section>` : '';

  // Calendar: the 3 weeks you've run, then the plan to race day.
  const wkMi = T.weekly(runs), first = plan.weeks[0]?.start || T.weekStart(t);
  const pastWeeks = [3, 2, 1].map(k => T.addDays(first, -7 * k)).map(start => ({
    start, phase: 'Done', past: true, days: Array.from({ length: 7 }, (_, i) => ({ date: T.addDays(start, i), kind: 'past', mi: 0 })),
  }));
  const cell = x => {
    if (x.date < cfg.planStart && x.kind !== 'past') x = { ...x, kind: 'past' };
    const act = T.milesOn(runs, x.date), st = x.kind === 'past' ? '' : T.status(x, act);
    const showMi = x.kind === 'past' || x.date < t ? act : x.mi;
    const kind = x.kind === 'past' ? (act >= 13 ? 'long' : act > 0 ? 'easy' : 'rest') : x.kind;
    return `<button class="cal k-${kind} ${x.date === t ? 'now' : ''} ${st}" data-d="${x.date}"><span class="dn">${+x.date.slice(8)}</span>
      <span class="mi">${showMi ? r1(showMi) : '–'}</span><span class="kl">${x.kind === 'past' ? (act ? 'run' : '') : KIND[x.kind]}</span>
      ${st === 'done' && x.mi ? '<i class="ok"></i>' : st === 'miss' || st === 'part' ? '<i class="miss"></i>' : ''}</button>`;
  };
  const weeksHtml = [...pastWeeks, ...plan.weeks].map(w => {
    const actual = wkMi.get(w.start) || 0;
    const before = w.past || T.addDays(w.start, 6) < cfg.planStart;
    const right = before ? `${r1(actual)} mi` : w.start <= t ? `${r1(actual)} / ${r1(w.mi)} mi` : `${r1(w.mi)} mi`;
    return `<div class="wk ${before ? 'past' : ''}"><div class="wkh"><span>${mon(w.start)} – ${mon(T.addDays(w.start, 6))}</span><span class="ph">${before ? 'Done' : w.phase}</span><b>${right}</b></div>
      <div class="calrow">${w.days.map(cell).join('')}</div></div>`;
  }).join('');
  return hero(data, ui) + todayCardHtml + notesHtml + `<section class="card calcard"><h3>Plan to race day</h3>
    <div class="calrow dow">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => `<span>${x}</span>`).join('')}</div>${weeksHtml}
    <div class="legend">${['easy', 'medium', 'quality', 'long', 'race'].map(k => `<span class="k-${k}"><i></i>${KIND[k]}</span>`).join('')}</div>
    <p class="muted small">Tap a day for the workout. Past days show what Garmin logged. The plan rebuilds from your recent weeks each time you open it.</p></section>`;
}

function trends({ runs, gdays, plan, cfg }, ui) {
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
  <section class="card"><h3>Weekly miles</h3><div class="tipbox"><span class="muted">Tap a week to see it</span></div>${bars(weeks, miles, null, { title: 'Weekly miles', cls: 'run', id: 'wk' })}</section>
  <section class="card"><h3>Average pace (min/mi)</h3><div class="tipbox"><span class="muted">Tap a week to see it</span></div>${line(weeks, paceW, { title: 'Pace', fmt: v => T.fmtPace(v * 60), id: 'pace' })}</section>
  <section class="card"><h3>Steps</h3><div class="tipbox"><span class="muted">Tap a day to see it</span></div>${bars(days, days.map(d => g(d).steps || 0), null, { title: 'Steps', cls: 'steps', id: 'steps' })}</section>
  <section class="card"><h3>Resting heart rate</h3><div class="tipbox"><span class="muted">Tap a day to see it</span></div>${line(days, days.map(d => g(d).rhr || NaN), { title: 'Resting HR', id: 'rhr' })}<p class="muted small">A few bpm above your normal for 2-3 days usually means back off.</p></section>
  <section class="card"><h3>Recent runs</h3><ul class="entries runs">${recent.map(r => `<li><div class="grow"><div class="r1"><span class="name">${ui.esc(r.name || 'Run')}</span><span class="kc">${r1(r.mi)} mi</span></div>
    <div class="r2"><span class="sub">${wkday(r.date)} ${mon(r.date)}${r.tread ? ' · treadmill' : ''}</span><span class="macros">${r.sec ? T.fmtPace(r.sec / r.mi) + '/mi' : ''}${r.hr ? ` · ${r.hr} bpm` : ''}</span></div></div></li>`).join('') || '<li class="empty small">No runs synced yet.</li>'}</ul></section>`;
}

function race({ cfg, plan, pred, autoGoal }, s, ui) {
  const z = plan.z, kg = (s.profile?.weightLb || 180) / 2.2046, marathon = cfg.raceMi > 26;
  const split = mi => T.fmtTime(z.mp * mi);
  const splits = (marathon ? [[3.107, '5K'], [6.214, '10K'], [13.109, 'Half'], [20, '20 mi'], [26.219, 'Finish']] : [[3.107, '5K'], [6.214, '10K'], [10, '10 mi'], [13.109, 'Finish']]);
  return hero({ cfg, autoGoal, plan }, ui) + `
  <section class="card"><h3>Fitness check</h3>${pred ? `<p>Your recent runs point to about <b>${T.fmtTime(pred.sec)}</b> for the marathon. ${autoGoal ? `With the taper, a goal of <b>${T.fmtTime(cfg.goalSec)}</b> is realistic.` : ''}</p>
    <ul class="entries runs">${pred.basis.map(r => `<li><div class="grow"><div class="r1"><span class="name">${r1(r.mi)} mi in ${T.fmtTime(r.sec)}</span><span class="kc">${T.fmtTime(r.eq)}</span></div><div class="r2"><span class="sub">${mon(r.date)}${r.tread ? ' · treadmill (+2%)' : ''}</span><span class="macros">${T.fmtPace(r.sec / r.mi)}/mi</span></div></div></li>`).join('')}</ul>
    <p class="muted small">Riegel formula on your 3 fastest runs of 5+ mi from the last 8 weeks (the middle one counts). Treadmill runs get +2% for no wind or hills.</p>` : '<p class="muted">Sync a few Garmin runs of 5+ miles to get a prediction.</p>'}</section>
  <section class="card"><h3>Paces</h3><table class="tbl zones">${z.list.map(([k, l, lo, hi, d]) => `<tr class="k-${k}"><td><b>${l}</b><div class="muted small">${d}</div></td><td>${T.fmtPace(lo)}-${T.fmtPace(hi)}</td></tr>`).join('')}</table></section>
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

export function bind(root, s, ui) {
  ui.$$('#trainSeg button', root).forEach(b => (b.onclick = () => { local.set('trainTab', b.dataset.k); ui.render(); }));
  const edit = ui.$('#raceEdit', root);
  if (edit) edit.onclick = () => openRace(s, ui);
  ui.$$('.cal[data-d]', root).forEach(c => (c.onclick = () => openDay(s, c.dataset.d, ui)));
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
  const { plan, runs } = await load(s);
  const d = T.planFor(plan, date), done = runs.filter(r => r.date === date);
  const b = ui.sheet(`${d ? `<div class="wo k-${d.kind}"><span class="kst"></span><div class="grow"><div class="name">${d.mi ? d.mi + ' mi · ' : ''}${ui.esc(d.title)}</div>
      ${d.pace ? `<div class="pace">${paceRange(d.pace)}</div>` : ''}<div class="sub">${ui.esc(d.detail)}</div></div></div>` : '<p class="muted">Before the plan started.</p>'}
    <h4>Garmin</h4>${done.length ? `<ul class="entries runs">${done.map(r => `<li><div class="grow"><div class="r1"><span class="name">${ui.esc(r.name || 'Run')}</span><span class="kc">${r1(r.mi)} mi</span></div>
      <div class="r2"><span class="sub">${r.tread ? 'treadmill' : 'outdoor'}</span><span class="macros">${r.sec ? T.fmtPace(r.sec / r.mi) + '/mi' : ''}${r.hr ? ` · ${r.hr} bpm` : ''}</span></div></div></li>`).join('')}</ul>` : `<p class="muted small">${date > today() ? 'Not yet.' : 'No run logged.'}</p>`}`,
    { title: new Date(date + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) });
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
    <div class="actions"><button class="primary" id="rSave">Save</button></div>`, { title: 'Race settings' });
  ui.$('#rSave', b).onclick = async () => {
    const training = { raceName: ui.$('#rName', b).value.trim() || c.raceName, raceDate: ui.$('#rDate', b).value || c.raceDate, raceStart: ui.$('#rStart', b).value.trim(),
      raceMi: +ui.$('#rMi', b).value, goalSec: T.parseTime(ui.$('#rGoal', b).value), longDay: +ui.$('#rLong', b).value,
      planStart: ui.$('#rDate', b).value !== c.raceDate ? T.weekStart(today()) : c.planStart };
    await db.saveSettings({ ...s, training });
    ui.closeSheet(); ui.toast('Race saved'); ui.render();
  };
}
