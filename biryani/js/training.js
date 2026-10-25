// Marathon training: a plan built back from race day, paces from your goal time,
// and fitness read from the Garmin runs the nightly workflow writes to data/garmin/.
import { today } from './db.js';

export const DEFAULTS = { raceName: 'Philadelphia Marathon', raceDate: '2026-11-22', raceStart: '7:00 AM', raceMi: 26.2, goalSec: null, longDay: 6, planStart: '2026-10-26' };
const RUN = /running|treadmill|track|trail_run|ultra/i;
const M = 1609.34, MARATHON = 26.2188;

export const addDays = (d, k) => today(new Date(new Date(d + 'T12:00').getTime() + k * 864e5));
export const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 864e5);
const dow = d => new Date(d + 'T12:00').getDay();
export const weekStart = d => addDays(d, -((dow(d) + 6) % 7)); // Monday
const half = v => Math.max(0, Math.round(v * 2) / 2);
const pad2 = n => String(n).padStart(2, '0');
export const fmtPace = sec => { const s = Math.round(sec); return `${Math.floor(s / 60)}:${pad2(s % 60)}`; };
export const fmtTime = sec => { const s = Math.round(sec); return `${Math.floor(s / 3600)}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`; };
export const parseTime = t => { const p = String(t || '').trim().split(':').map(Number); if (!p.length || p.some(isNaN)) return null; while (p.length < 3) p.push(0); return p[0] * 3600 + p[1] * 60 + p[2] || null; };

export const config = s => ({ ...DEFAULTS, ...(s.training || {}) });

// Every Garmin run, one row per activity.
export function runsFrom(gdays) {
  return Object.entries(gdays).flatMap(([date, d]) => (d.activities || [])
    .filter(a => RUN.test(a.type || '') && a.distance > 0)
    .map(a => ({ date, name: a.name, mi: a.distance / M, sec: a.duration, hr: a.avgHR, tread: /treadmill/.test(a.type) })))
    .sort((a, b) => a.date.localeCompare(b.date));
}
export const milesOn = (runs, date) => runs.filter(r => r.date === date).reduce((t, r) => t + r.mi, 0);

// Marathon prediction: Riegel (t × (26.2 / d)^1.06) on runs of 5+ mi from the last 8 weeks,
// treadmill runs +2% (no wind or hills), median of the best three so one fast day can't carry it.
export function predict(runs, ref = today()) {
  const from = addDays(ref, -56);
  const eq = runs.filter(r => r.date >= from && r.date <= ref && r.mi >= 5 && r.sec)
    .map(r => ({ ...r, eq: r.sec * Math.pow(MARATHON / r.mi, 1.06) * (r.tread ? 1.02 : 1) }))
    .sort((a, b) => a.eq - b.eq);
  if (!eq.length) return null;
  const top = eq.slice(0, 3);
  return { sec: top[Math.floor((top.length - 1) / 2)].eq, basis: top };
}
// Suggested goal: prediction less ~1.5% for the taper, to the nearest 5 minutes.
export const suggestGoal = pred => Math.round((pred * 0.985) / 300) * 300;

export function zones(goalSec, raceMi = 26.2) {
  const mp = goalSec / (raceMi > 26 ? MARATHON : raceMi);
  return {
    mp,
    list: [
      ['recovery', 'Recovery', mp + 90, mp + 120, 'Day after hard efforts. Slower is fine.'],
      ['easy', 'Easy', mp + 60, mp + 90, 'Conversational. Most of your miles.'],
      ['long', 'Long run', mp + 45, mp + 75, 'Steady, still able to talk.'],
      ['mp', 'Marathon pace', mp - 5, mp + 5, 'Goal race effort.'],
      ['tempo', 'Tempo', mp - 25, mp - 15, 'Comfortably hard, ~1 hr race effort.'],
      ['interval', 'Intervals', mp - 50, mp - 40, '5K-ish effort, full recovery jogs.'],
    ],
  };
}
const zone = (z, k) => z.list.find(x => x[0] === k);

// Weekly mileage keyed by Monday.
export function weekly(runs) {
  const w = new Map();
  for (const r of runs) { const k = weekStart(r.date); w.set(k, (w.get(k) || 0) + r.mi); }
  return w;
}

// Plan weeks from this week through race week. Weeks out: 0 = race week, 1-3 = taper
// (60 / 80 / 100% of peak, last 20-miler 3 weeks out), 4+ = build at most +8% a week with a
// cutback every third week. Ramps are kept gentle for the repaired meniscus.
export function buildPlan(cfg, runs, ref = today()) {
  const z = zones(cfg.goalSec, cfg.raceMi), race = cfg.raceDate;
  const raceWk = weekStart(race), thisWk = weekStart(ref);
  const nWeeks = Math.floor(daysBetween(thisWk, raceWk) / 7);
  if (nWeeks < 0) return { weeks: [], z };
  const wk = weekly(runs);
  const past = k => wk.get(addDays(thisWk, -7 * k)) || 0;
  const avg4 = (past(1) + past(2) + past(3) + past(4)) / 4, max6 = Math.max(...[1, 2, 3, 4, 5, 6].map(past));
  const peak = Math.min(70, Math.max(20, avg4 * 1.1, max6 * 0.85));
  const recentLong = Math.max(0, ...runs.filter(r => r.date >= addDays(ref, -42)).map(r => r.mi));
  const longPeak = cfg.raceMi > 26 ? Math.min(20, Math.max(14, Math.round(recentLong) + 2)) : Math.min(14, Math.max(10, Math.round(recentLong) + 1));
  const L = cfg.longDay;

  // Build-week volumes, worked forward from now so the first week starts near what you run.
  const vols = [], longs = [];
  let v = Math.max(avg4, 15), lg = Math.max(8, Math.min(recentLong, longPeak - 2));
  for (let w = nWeeks; w >= 0; w--) {
    if (w === 3) { v = peak; lg = longPeak; }
    else if (w === 2) { v = peak * 0.8; lg = longPeak * 0.7; }
    else if (w === 1) { v = peak * 0.6; lg = longPeak * 0.5; }
    else if (w > 3) {
      const cut = w % 3 === 0 && w !== nWeeks;
      v = cut ? v * 0.8 : Math.min(peak, v * 1.08); lg = cut ? lg - 3 : Math.min(longPeak, lg + 1);
    }
    vols[w] = v; longs[w] = Math.max(6, half(lg));
  }

  const P = k => { const x = zone(z, k); return [x[2], x[3]]; };
  const day = (date, kind, mi, title, detail, pace) => ({ date, kind, mi: kind === 'race' ? mi : half(mi), title, detail, pace });
  const quality = (w, mi) => {
    const t = w === 2 || (w > 3 && w % 3 === 1) ? 'tempo' : w > 3 && w % 3 === 0 ? 'interval' : 'mp';
    if (t === 'tempo') return ['Tempo', `2 mi easy, ${w === 2 ? '3 × 1.5 mi' : `${Math.max(3, Math.round(mi * 0.45))} mi`} @ tempo (3 min jog between), rest easy.`, P('tempo')];
    if (t === 'interval') return ['Intervals', '2 mi easy, 6 × 800 m @ interval pace with 400 m jogs, rest easy.', P('interval')];
    return ['Marathon pace', `2 mi easy, ${Math.max(3, Math.round(mi - 3))} mi @ marathon pace, 1 mi easy.`, P('mp')];
  };
  const longText = w => w === 3 ? 'Last big one. Easy effort; last 3 mi @ marathon pace only if the knee feels great. Practice race fueling.'
    : w === 2 ? 'Middle 6 mi @ marathon pace, the rest easy.' : w === 1 ? 'Easy, with 3 mi @ marathon pace near the end.'
    : 'Easy and conversational. Practice race fueling (a gel every 35-40 min).';
  const PHASE = { 0: 'Race week', 1: 'Taper', 2: 'Taper', 3: 'Peak week' };

  const weeks = [];
  for (let w = nWeeks; w >= 0; w--) {
    const start = addDays(raceWk, -7 * w), days = [];
    const longMi = longs[w], rest = Math.max(0, vols[w] - longMi);
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i), off = (dow(date) - L + 7) % 7, r = daysBetween(date, race);
      if (w === 0 || (r >= 0 && r <= 6)) {
        // Race week counts back from race day.
        if (r === 0) days.push(day(date, 'race', cfg.raceMi, 'Race day', `${cfg.raceName}, ${cfg.raceStart} start. Go out ~10 s/mi slow for 3 mi, then lock in.`, P('mp')));
        else if (r < 0) days.push(day(date, 'recovery', 0, 'Recover', 'Walk, eat, sleep. Easy running again when stairs feel normal.'));
        else if (r === 1) days.push(day(date, 'easy', 2, 'Shakeout', '2 mi very easy + 4 short strides. Lay out race kit.', P('recovery')));
        else if (r === 2 || r === 6) days.push(day(date, 'rest', 0, 'Rest', 'Off. Start carb-loading 2-3 days out.'));
        else if (r === 3) days.push(day(date, 'easy', 3, 'Easy + strides', '3 mi easy + 4 × 20 s strides.', P('easy')));
        else if (r === 4) days.push(day(date, 'easy', 4, 'Easy', '4 mi easy.', P('easy')));
        else days.push(day(date, 'quality', 5, 'Sharpener', '1.5 mi easy, 2 × 1 mi @ marathon pace (3 min jog), rest easy.', P('mp')));
        continue;
      }
      if (off === 0) days.push(day(date, 'long', longMi, `Long run`, longText(w), P('long')));
      else if (off === 1 || off === 6) days.push(day(date, 'rest', 0, 'Rest', off === 1 ? 'Off, or strength / mobility. Ice the knee if it talks back.' : 'Off. Legs up before the long run.'));
      else if (off === 2) days.push(day(date, 'easy', Math.max(3, rest * 0.24), 'Easy', 'Easy miles. Add 4-6 strides at the end.', P('easy')));
      else if (off === 3) { const mi = Math.max(4, rest * 0.30), [t, d, p] = quality(w, mi); days.push(day(date, 'quality', mi, t, d, p)); }
      else if (off === 4) days.push(day(date, 'easy', Math.max(3, rest * 0.20), 'Recovery', 'Truly easy after the workout.', P('recovery')));
      else days.push(day(date, 'medium', Math.max(4, rest * 0.26), 'Medium long', 'Steady easy run, a bit longer.', P('easy')));
    }
    weeks.push({ start, w, phase: PHASE[w] || (w % 3 === 0 && w !== nWeeks ? 'Cutback' : 'Build'), days, mi: days.filter(d => d.kind !== 'race').reduce((t, d) => t + d.mi, 0) });
  }
  return { weeks, z, peak, longPeak };
}

export function planFor(plan, date) {
  for (const w of plan.weeks) for (const d of w.days) if (d.date === date) return d;
  return null;
}

// Planned vs done for a past/current day.
export function status(d, actual, ref = today()) {
  if (d.date > ref) return '';
  if (d.kind === 'rest' || d.kind === 'recovery') return actual > 0 ? 'extra' : 'done';
  if (actual >= d.mi * 0.75) return 'done';
  if (d.date === ref) return 'due';
  return actual > 0 ? 'part' : 'miss';
}

// Short, data-backed nudges for the top of the plan.
export function notes({ gdays, runs, plan, cfg, s, ref = today() }) {
  const out = [];
  const vals = (from, to, k) => Object.entries(gdays).filter(([d]) => d >= from && d <= to).map(([, g]) => g[k]).filter(v => v > 0);
  const avg = a => a.reduce((t, v) => t + v, 0) / (a.length || 1);
  const rhr3 = vals(addDays(ref, -3), ref, 'rhr'), rhr28 = vals(addDays(ref, -31), addDays(ref, -4), 'rhr');
  if (rhr3.length >= 2 && rhr28.length >= 10 && avg(rhr3) - avg(rhr28) >= 4)
    out.push(['warn', `Resting HR is up ${Math.round(avg(rhr3) - avg(rhr28))} bpm on your 4-week normal. Swap any hard day this week for easy until it settles.`]);
  const sleep = vals(addDays(ref, -4), ref, 'sleepSec').map(v => v / 3600);
  if (sleep.length >= 2 && avg(sleep) < 6.5) out.push(['warn', `Sleep is averaging ${avg(sleep).toFixed(1)} h lately. In the taper, sleep does more than extra miles.`]);
  // Rolling 7 days vs the 3 weeks before, so a big week shows up as soon as it happens.
  const sum = (a, b) => runs.filter(r => r.date > addDays(ref, -a) && r.date <= addDays(ref, -b)).reduce((t, r) => t + r.mi, 0);
  const last = sum(7, 0), prior = sum(28, 7) / 3;
  if (last > 20 && prior > 0 && last > prior * 1.25)
    out.push(['knee', `The last 7 days (${Math.round(last)} mi) ran ${Math.round((last / prior - 1) * 100)}% over your 3 weeks before. For the knee, stick to the plan this week and don't add miles.`]);
  const toRace = daysBetween(ref, cfg.raceDate);
  if (toRace >= 0 && toRace <= 28 && s.goal?.type === 'cut')
    out.push(['fuel', `You're still on a cut. Ease to maintenance through the taper, then carb-load the 3 days before (about ${Math.round((s.profile.weightLb / 2.2046) * 8 / 10) * 10} g carbs a day).`]);
  if (toRace >= 0 && toRace <= 28) out.push(['info', 'Taper time: fitness is banked. Volume drops, a little marathon pace stays in so the legs stay sharp.']);
  return out;
}
