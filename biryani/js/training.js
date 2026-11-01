// Marathon training: a plan built back from race day, paces from your goal time,
// and fitness read from the Garmin runs the nightly workflow writes to data/garmin/.
import { today } from './db.js';

export const DEFAULTS = { raceName: 'Philadelphia Marathon', raceDate: '2026-11-22', raceStart: '7:00 AM', raceMi: 26.2, goalSec: null, longDay: 6, planStart: '2026-10-26', restDays: 2 };
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

// The long game: races after the current one, in order. Once a race is over, the next marathon here
// becomes the race the plan builds to, with recovery, base and speed weeks first (seasonPlan).
// Saved edits live in settings.training.season; these are the defaults. Times in seconds.
export const SEASON = {
  goal: 'Boston 2028', std: 10500, aim: 10140, // M18-34 standard 2:55; recent cutoffs 4:34-6:51 under, so aim 2:49
  windowEnd: '2027-09-12', // the 2028 window closes at B.A.A. registration week in Sept 2027 (date not set yet)
  baseTop: 54, peakMi: 64, blockWeeks: 18, recoverWeeks: 3,
  races: [
    { id: 'philly26', name: 'Philadelphia Marathon', date: '2026-11-22', start: '7:00 AM', mi: 26.2 },
    // Checkpoint: 1:21 or faster = 2:49 shot; 1:24 or faster = 2:55 shot (lottery); slower = PR race, BQ moves to 2029.
    { id: 'half27', name: 'Spring half', date: '2027-05-02', start: '', mi: 13.1, gate: [4860, 5040], tbc: true },
    { id: 'erie27', name: 'Erie Marathon', date: '2027-09-12', start: '7:00 AM', mi: 26.2, bq: true, tbc: true },
  ],
};
export const season = s => { const x = s.training?.season || {}; return { ...SEASON, ...x, races: [...(x.races || SEASON.races)].sort((a, b) => a.date.localeCompare(b.date)) }; };

// The race you're training for: the one in settings until it's over, then the next marathon in the
// season. A season race with a finished marathon before it gets recovery, base and speed weeks first
// (seasonPlan); until then nothing changes. Edits to a season race are saved on the race (openRace).
export const config = (s, ref = today()) => {
  const cfg = { ...DEFAULTS, ...(s.training || {}) }, sea = season(s), M = sea.races.filter(r => r.mi > 26);
  let r = ref <= cfg.raceDate ? sea.races.find(x => x.date === cfg.raceDate) : M.find(x => x.date >= ref);
  if (!r && ref > cfg.raceDate) r = [...M].reverse().find(x => x.date < ref);
  const prev = r && [...M].reverse().find(x => x.date < r.date && x.date < ref);
  if (!r || !prev) return { ...cfg, raceId: r?.id, season: sea };
  const after = d => d > prev.date;
  return { ...cfg, raceId: r.id, raceName: r.name, raceDate: r.date, raceStart: r.start || '', raceMi: r.mi, goalSec: r.goalSec || null,
    planStart: addDays(prev.date, 1), prevRace: prev, peakMi: sea.peakMi, season: sea,
    swaps: (cfg.swaps || []).filter(p => after(p[0])), skips: (cfg.skips || []).filter(after) };
};

// Every Garmin run, one row per activity.
export function runsFrom(gdays) {
  return Object.entries(gdays).flatMap(([date, d]) => (d.activities || [])
    .filter(a => RUN.test(a.type || '') && a.distance > 0)
    .map(a => ({ date, id: a.id, name: a.name, mi: a.distance / M, sec: a.duration, hr: a.avgHR, tread: /treadmill/.test(a.type), feel: a.feel, rpe: a.rpe, gear: a.gear })))
    .sort((a, b) => a.date.localeCompare(b.date));
}
// Garmin's post-run ratings: feel 0 very weak .. 100 very strong, rpe 10..100 (effort 1-10).
export const FEEL = { 0: 'Very weak', 25: 'Weak', 50: 'Normal', 75: 'Strong', 100: 'Very strong' };
export const feelText = r => [r.feel != null ? 'felt ' + (FEEL[r.feel] || r.feel).toLowerCase() : '', r.rpe ? `effort ${Math.round(r.rpe / 10)}/10` : ''].filter(Boolean).join(' · ');
export const milesOn = (runs, date) => runs.filter(r => r.date === date).reduce((t, r) => t + r.mi, 0);
// Doubles add up for easy days, but a long run has to be one run: 7 + 7 isn't a 14-miler.
export const longestOn = (runs, date) => Math.max(0, ...runs.filter(r => r.date === date).map(r => r.mi));
export const doneMiles = (runs, d) => (d.kind === 'long' ? longestOn(runs, d.date) : milesOn(runs, d.date));

// Marathon prediction: Riegel (t × (26.2 / d)^1.07) on runs of 5+ mi from the last 8 weeks,
// treadmill runs +2% (no wind or hills), median of the best three so one fast day can't carry it.
// Riegel alone runs ~10 min fast for most recreational marathoners (Vickers & Vertosick 2016), and
// more so on lower mileage, so it adds up to 4% when you average under 50 mi a week.
// With a race date, it stops at the end of the last build week, so the goal (and every pace) holds
// still through the taper instead of drifting as the miles drop.
export function predict(runs, ref = today(), raceDate) {
  if (raceDate && ref > addDays(weekStart(raceDate), -15)) ref = addDays(weekStart(raceDate), -15);
  // Months out (season base weeks are all easy), look back 6 months so the goal doesn't sink with easy pace.
  const from = addDays(ref, raceDate && daysBetween(ref, raceDate) > 7 * 18 ? -182 : -56);
  const eq = runs.filter(r => r.date >= from && r.date <= ref && r.mi >= 5 && r.sec)
    .map(r => ({ ...r, eq: r.sec * Math.pow(MARATHON / r.mi, 1.07) * (r.tread ? 1.02 : 1) }))
    .sort((a, b) => a.eq - b.eq);
  if (!eq.length) return null;
  const top = eq.slice(0, 3), wk = weekly(runs), mon = weekStart(ref);
  const avgWk = Array.from({ length: 8 }, (_, k) => wk.get(addDays(mon, -7 * (k + 1))) || 0).reduce((a, b) => a + b, 0) / 8;
  const vol = Math.min(0.04, Math.max(0, ((50 - avgWk) / 10) * 0.02));
  return { sec: top[Math.floor((top.length - 1) / 2)].eq * (1 + vol), basis: top, avgWk, vol };
}
// Suggested goal: the prediction to the nearest 5 minutes.
export const suggestGoal = pred => Math.round(pred / 300) * 300;

export function zones(goalSec, raceMi = 26.2) {
  const mp = goalSec / (raceMi > 26 ? MARATHON : raceMi);
  return {
    mp,
    list: [
      // Bands don't overlap, slowest to fastest. Long runs and medium-long runs share the steady band.
      ['recovery', 'Recovery', mp + 105, mp + 135, 'Day after hard efforts. Slower is fine.'],
      ['easy', 'Easy', mp + 70, mp + 100, 'Conversational. Most of your miles.'],
      ['long', 'Long / medium', mp + 40, mp + 65, 'Steady, still able to talk.'],
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
// o (used by seasonPlan): from = first plan week, v0 / lg0 = where base training left the weekly and long-run miles.
export function buildPlan(cfg, runs, ref = today(), o = {}) {
  const z = zones(cfg.goalSec, cfg.raceMi), race = cfg.raceDate;
  const raceWk = weekStart(race), thisWk = o.from || weekStart(ref);
  const nWeeks = Math.floor(daysBetween(thisWk, raceWk) / 7);
  if (nWeeks < 0) return { weeks: [], z };
  const wk = weekly(runs);
  const past = k => wk.get(addDays(thisWk, -7 * k)) || 0;
  const avg4 = (past(1) + past(2) + past(3) + past(4)) / 4, max6 = Math.max(...[1, 2, 3, 4, 5, 6].map(past));
  // Season blocks cut back every third week, so they build from the better of the last two weeks, not the average.
  const v0 = o.v0 ?? (cfg.peakMi ? Math.max(past(1), past(2)) : avg4);
  // A season race can peak higher (peakMi), but only 20% over what you're really running, for the knee.
  const peak = cfg.peakMi ? Math.min(cfg.peakMi, Math.max(20, v0 * 1.2, max6 * 0.85)) : Math.min(70, Math.max(20, v0 * 1.1, max6 * 0.85));
  const recentLong = Math.max(o.lg0 || 0, ...runs.filter(r => r.date >= addDays(ref, -42)).map(r => r.mi));
  const longPeak = cfg.raceMi > 26 ? Math.min(20, Math.max(14, Math.round(recentLong) + 2)) : Math.min(14, Math.max(10, Math.round(recentLong) + 1));
  const L = cfg.longDay;

  // Build-week volumes, worked forward from now so the first week starts near what you run.
  const vols = [], longs = [];
  let v = Math.max(v0, 15), lg = Math.max(8, Math.min(recentLong, longPeak - 2));
  // Cutback weeks (every third) dip 20% and 3 mi off the long run, then the build carries on from where
  // it was. A season block cuts on schedule even in the current week, so its cutbacks really happen.
  for (let w = nWeeks; w >= 0; w--) {
    let vw = v, lw = lg;
    if (w === 3) { vw = v = peak; lw = lg = longPeak; }
    else if (w === 2) { vw = peak * 0.8; lw = longPeak * 0.7; }
    else if (w === 1) { vw = peak * 0.6; lw = longPeak * 0.5; }
    else if (w > 3) {
      const cut = w % 3 === 0 && (w !== nWeeks || !!cfg.peakMi);
      if (cut) { vw = v * 0.8; lw = lg - 3; } else { vw = v = Math.min(peak, v * 1.08); lw = lg = Math.min(longPeak, lg + 1); }
    }
    vols[w] = vw; longs[w] = Math.max(6, half(lw));
  }

  const P = k => { const x = zone(z, k); return [x[2], x[3]]; };
  const day = (date, kind, mi, title, detail, pace) => ({ date, kind, mi: kind === 'race' ? mi : half(mi), title, detail, pace, ...range(kind, kind === 'race' ? mi : half(mi)) });
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
  // How the non-long miles spread over the running days (by days after the long run). Fewer rest days
  // spreads the same weekly miles thinner, not more miles.
  const share = { 2: 0.24, 3: 0.30, 4: 0.20, 5: 0.26, ...(cfg.restDays < 2 ? { 6: 0.12 } : {}), ...(cfg.restDays < 1 ? { 1: 0.12 } : {}) };
  const tot = Object.values(share).reduce((a, b) => a + b, 0);
  for (const k in share) share[k] /= tot;

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
      else if (off === 1 && cfg.restDays < 1) days.push(day(date, 'easy', Math.max(3, rest * share[1]), 'Recovery', 'Very easy, the day after the long run.', P('recovery')));
      else if (off === 6 && cfg.restDays < 2) days.push(day(date, 'easy', Math.max(3, rest * share[6]), 'Shakeout', 'Short and easy before the long run. A few strides.', P('recovery')));
      else if (off === 1 || off === 6) days.push(day(date, 'rest', 0, 'Rest', off === 1 ? 'Off, or strength / mobility. Ice the knee if it talks back.' : 'Off. Legs up before the long run.'));
      else if (off === 2) days.push(day(date, 'easy', Math.max(3, rest * share[2]), 'Easy', 'Easy miles. Add 4-6 strides at the end.', P('easy')));
      else if (off === 3) { const mi = Math.max(4, rest * share[3]), [t, d, p] = quality(w, mi); days.push(day(date, 'quality', mi, t, d, p)); }
      else if (off === 4) days.push(day(date, 'easy', Math.max(3, rest * share[4]), 'Recovery', 'Truly easy after the workout.', P('recovery')));
      else days.push(day(date, 'medium', Math.max(4, rest * share[5]), 'Medium long', 'Steady, a little quicker than easy and a bit longer.', P('long')));
    }
    weeks.push({ start, w, phase: PHASE[w] || (w % 3 === 0 && (w !== nWeeks || !!cfg.peakMi) ? 'Cutback' : 'Build'), days, mi: days.filter(d => d.kind !== 'race').reduce((t, d) => t + d.mi, 0) });
  }
  if (!o.noMoves) applyMoves(weeks, cfg);
  return { weeks, z, peak, longPeak };
}

// A season race far away: recovery after the last race, base, then speed (with the checkpoint half),
// then the normal buildPlan block for the last blockWeeks weeks. Close races are just buildPlan.
export function seasonPlan(cfg, runs, ref = today()) {
  const sea = cfg.season || SEASON, raceWk = weekStart(cfg.raceDate), thisWk = weekStart(ref);
  const nWeeks = Math.floor(daysBetween(thisWk, raceWk) / 7), B = sea.blockWeeks;
  if (!cfg.prevRace || nWeeks < B) return buildPlan(cfg, runs, ref);
  const z = zones(cfg.goalSec, cfg.raceMi), blockStart = addDays(raceWk, -7 * (B - 1));
  const gate = sea.races.find(r => r.gate && r.date > cfg.prevRace.date && r.date < blockStart);
  const recEnd = addDays(weekStart(addDays(cfg.prevRace.date, 1)), 7 * sea.recoverWeeks);
  const speedFrom = speedStart(gate, blockStart);
  const wk = weekly(runs), past = k => wk.get(addDays(thisWk, -7 * k)) || 0;
  const recentLong = Math.max(0, ...runs.filter(r => r.date >= addDays(ref, -21) && r.date > cfg.prevRace.date).map(r => r.mi));
  // Start from what you actually ran the last 2 weeks (+10%), then project +10% a week, a 20% cut every 4th.
  let v = Math.max(22, Math.max(past(1), past(2)) * 1.1), lg = Math.max(10, Math.min(recentLong + 1, 16));
  const weeks = [], P = k => { const x = z.list.find(y => y[0] === k); return [x[2], x[3]]; };
  for (let start = thisWk, i = 0; start < blockStart; start = addDays(start, 7), i++) {
    const w = Math.floor(daysBetween(start, raceWk) / 7);
    const rec = start < recEnd ? Math.floor(daysBetween(weekStart(addDays(cfg.prevRace.date, 1)), start) / 7) : -1;
    const gateWk = gate && weekStart(gate.date) === start, afterGate = gate && addDays(weekStart(gate.date), 7) === start;
    const speed = start >= speedFrom, top = speed ? sea.baseTop + 4 : sea.baseTop;
    const baseIdx = Math.floor(daysBetween(recEnd, start) / 7), cut = rec < 0 && !gateWk && !afterGate && baseIdx % 4 === 3;
    let phase, vol, long;
    if (rec >= 0) { phase = 'Recover'; vol = [8, 18, 25][rec] ?? 25; long = [0, 6, 8][rec] ?? 8; }
    else {
      // Base restarts at 25 mi after recovery; after that, +10% a week up to the phase's top.
      if (i > 0 && start === recEnd) v = 25;
      else if (i > 0 && !cut) v = v * 1.1;
      v = Math.min(top, v);
      vol = cut ? v * 0.8 : gateWk ? v * 0.7 : afterGate ? v * 0.75 : v;
      if (i > 0 && !cut) lg = Math.min(speed ? 17 : 16, lg + 1);
      long = cut ? lg - 3 : lg;
      phase = cut ? 'Cutback' : gateWk ? 'Checkpoint' : afterGate ? 'Recover' : speed ? 'Speed' : 'Base';
    }
    weeks.push(layWeek(start, w, phase, vol, long, cfg, P, { rec, speed: speed && !cut && !afterGate, gate: gateWk ? gate : null, hills: !speed && rec < 0 }));
  }
  const block = buildPlan(cfg, runs, ref, { from: blockStart, v0: v, lg0: lg, noMoves: true });
  const all = [...weeks, ...block.weeks];
  applyMoves(all, cfg);
  return { weeks: all, z, peak: block.peak, longPeak: block.longPeak };
}

// Speed weeks: the 7 before the checkpoint week (plus it and the week after), or the 8 before the block.
const speedStart = (gate, blockStart) => gate ? addDays(weekStart(gate.date), -7 * 7) : addDays(blockStart, -7 * 8);

// One week of the season's pre-block training, laid out around the long-run day like buildPlan.
function layWeek(start, w, phase, vol, long, cfg, P, o) {
  const L = cfg.longDay, days = [];
  const day = (date, kind, mi, title, detail, pace) => ({ date, kind, mi: kind === 'race' ? mi : half(mi), title, detail, pace, ...range(kind, kind === 'race' ? mi : half(mi)) });
  const longMi = Math.max(0, half(long)), rest = Math.max(0, vol - longMi);
  const share = { 2: 0.24, 3: 0.30, 4: 0.20, 5: 0.26, ...(cfg.restDays < 2 ? { 6: 0.12 } : {}), ...(cfg.restDays < 1 ? { 1: 0.12 } : {}) };
  const tot = Object.values(share).reduce((a, b) => a + b, 0);
  for (const k in share) share[k] /= tot;
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i), off = (dow(date) - L + 7) % 7;
    if (o.gate) {
      const r = daysBetween(date, o.gate.date);
      if (r === 0) { days.push(day(date, 'race', o.gate.mi, o.gate.name, 'Checkpoint race. Even effort, first 2 mi a touch easy. This time decides the fall goal.', P('tempo'))); continue; }
      if (r === 1 || r === 3) { days.push(day(date, 'rest', 0, 'Rest', r === 1 ? 'Off before the race.' : 'Off.')); continue; }
      if (r === 2) { days.push(day(date, 'easy', 3, 'Easy + strides', '3 mi easy + 4 × 20 s strides.', P('easy'))); continue; }
      if (r === 4) { days.push(day(date, 'quality', 5, 'Sharpener', '1.5 mi easy, 3 × 1 mi at half effort (2 min jog), rest easy.', P('tempo'))); continue; }
      if (r >= 5) { days.push(day(date, 'easy', Math.max(3, rest * 0.18), 'Easy', 'Easy miles. Nothing hard this week before the race.', P('easy'))); continue; }
      if (r < 0) { days.push(day(date, 'easy', r === -1 ? 0 : 3, r === -1 ? 'Recover' : 'Easy', 'Very easy.', P('recovery'))); continue; }
    }
    if (o.rec === 0) {
      const k = { 4: 3, 0: 5 }[off];
      days.push(k ? day(date, 'easy', k, 'Easy (optional)', 'Only if stairs feel normal. Walking counts.', P('recovery')) : day(date, 'rest', 0, 'Rest', 'Walk, eat, sleep. The knee gets back to zero this week.'));
      continue;
    }
    if (off === 0) days.push(day(date, 'long', longMi, 'Long run', o.speed ? 'Easy, last 3-4 mi steady (long-run pace).' : 'Easy and conversational. Time on feet, not pace.', P('long')));
    else if (off === 1 && cfg.restDays < 1) days.push(day(date, 'easy', Math.max(3, rest * share[1]), 'Recovery', 'Very easy, the day after the long run.', P('recovery')));
    else if (off === 6 && cfg.restDays < 2) days.push(day(date, 'easy', Math.max(3, rest * share[6]), 'Shakeout', 'Short and easy. A few strides.', P('recovery')));
    else if (off === 1 || off === 6) days.push(day(date, 'rest', 0, 'Rest', off === 1 ? 'Off. Strength day: single-leg squats, step-downs, RDLs, calf raises.' : 'Off. Legs up before the long run.'));
    else if (off === 2) days.push(day(date, 'easy', Math.max(3, rest * share[2]), 'Easy + strides', 'Easy miles, then 6 × 20 s strides.', P('easy')));
    else if (off === 3) {
      const mi = Math.max(4, rest * share[3]);
      if (o.speed) days.push(day(date, 'quality', mi, 'Threshold', `2 mi easy, ${Math.min(5, Math.max(3, Math.round(mi / 2)))} × 1 mi @ tempo (1 min jog), rest easy.`, P('tempo')));
      else days.push(day(date, 'easy', mi, o.hills ? 'Easy + hill sprints' : 'Easy', o.hills ? 'Easy miles, then 8 × 10 s hill sprints, walk back down. Full rest.' : 'Easy miles.', P('easy')));
    } else if (off === 4) days.push(day(date, 'easy', Math.max(3, rest * share[4]), 'Recovery', 'Truly easy.', P('recovery')));
    else {
      const mi = Math.max(4, rest * share[5]);
      if (o.speed) days.push(day(date, 'quality', mi, 'Intervals', '2 mi easy, 5-6 × 1000 m @ interval pace (equal jog), rest easy.', P('interval')));
      else days.push(day(date, 'medium', mi, 'Steady', 'A little quicker than easy, still conversational.', P('long')));
    }
  }
  return { start, w, phase, days, noSwap: !!o.gate, mi: days.filter(d => d.kind !== 'race').reduce((t, d) => t + d.mi, 0) };
}

// Where the season stands: the phase you're in and the road ahead, for the Boston tab.
export function roadmap(cfg, ref = today()) {
  const sea = cfg.season || SEASON, out = [];
  let after = null;
  for (const r of sea.races) {
    if (r.mi > 26 && after) {
      const recEnd = addDays(weekStart(addDays(after, 1)), 7 * sea.recoverWeeks), blockStart = addDays(weekStart(r.date), -7 * (sea.blockWeeks - 1));
      const gate = sea.races.find(g => g.gate && g.date > after && g.date < blockStart), speedFrom = speedStart(gate, blockStart);
      out.push({ k: 'recover', name: 'Recover', from: addDays(after, 1), to: addDays(recEnd, -1), note: 'Week 1 off, then 18 → 25 mi, all easy.' });
      if (speedFrom > recEnd) out.push({ k: 'base', name: 'Base', from: recEnd, to: addDays(speedFrom, -1), note: `Build to ${sea.baseTop} mi/week, +10% max, every 4th week cut. Strides, hill sprints, strength 2×.` });
      out.push({ k: 'speed', name: 'Speed', from: speedFrom, to: addDays(blockStart, -1), note: 'Threshold + intervals each week, long runs 14-17.' });
      if (gate) out.push({ k: 'gate', name: gate.name, from: gate.date, to: gate.date, race: gate });
      out.push({ k: 'block', name: 'Marathon block', from: blockStart, to: addDays(r.date, -1), note: `Peak up to ${sea.peakMi} mi/week (never 20% past what you've been running), long runs to 20-22.` });
    }
    if (r.mi > 26) { out.push({ k: 'race', name: r.name, from: r.date, to: r.date, race: r }); after = r.date; }
  }
  return out.map(p => ({ ...p, now: p.from <= ref && ref <= p.to, done: p.to < ref }));
}

// Days that went hard (tempo pace or faster, a long run near race pace, or rated 9-10/10) in the last n days.
export function hardDays(runs, z, ref = today(), n = 7) {
  const tempoSlow = z.list.find(x => x[0] === 'tempo')[3], mpSlow = z.list.find(x => x[0] === 'mp')[3];
  return [...new Set(runs.filter(r => r.date > addDays(ref, -n) && r.date <= ref && r.mi >= 3 && r.sec &&
    (r.rpe >= 90 || r.sec / r.mi <= tempoSlow + 10 || (r.mi >= 13 && r.sec / r.mi <= mpSlow + 15))).map(r => r.date))];
}

// Your own changes, on top of the generated plan:
// - weekSwaps [[weekdayA, weekdayB, fromDate]]: e.g. rest Thursday instead of Friday, every week before race week.
// - swaps [[dateA, dateB]]: a one-off swap. skips [date]: that day becomes rest.
// Race day never moves.
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PLAN_KEYS = ['kind', 'mi', 'title', 'detail', 'pace', 'lo', 'hi'];
function applyMoves(weeks, cfg) {
  const all = weeks.flatMap(w => w.days), at = d => all.find(x => x.date === d), ok = d => d && d.kind !== 'race';
  const swap = (a, b, every) => {
    for (const k of PLAN_KEYS) [a[k], b[k]] = [b[k], a[k]];
    a.moved = `${every ? 'Every week: s' : 'S'}wapped with ${DOW[dow(b.date)]}.`; b.moved = `${every ? 'Every week: s' : 'S'}wapped with ${DOW[dow(a.date)]}.`;
  };
  for (const w of weeks) {
    if (w.w === 0 || w.noSwap) continue;
    for (const [x, y, from = ''] of cfg.weekSwaps || []) {
      const a = w.days.find(d => dow(d.date) === x), b = w.days.find(d => dow(d.date) === y);
      if (ok(a) && ok(b) && a.date >= from && b.date >= from) swap(a, b, true);
    }
  }
  for (const [x, y] of cfg.swaps || []) { const a = at(x), b = at(y); if (ok(a) && ok(b)) swap(a, b, false); }
  for (const x of cfg.skips || []) {
    const d = at(x);
    if (ok(d) && d.kind !== 'rest') Object.assign(d, { kind: 'rest', mi: 0, lo: 0, hi: 0, pace: null, moved: `Skipped (was ${d.title.toLowerCase()}${d.mi ? `, ${d.mi} mi` : ''}).`, title: 'Rest', detail: 'Day off, your call.' });
  }
  const hard = d => d && (d.kind === 'quality' || d.kind === 'long');
  all.forEach((d, i) => { if (d.moved && hard(d) && (hard(all[i - 1]) || hard(all[i + 1]))) d.moved += ' That puts two hard days in a row; take one of them easy if your legs are heavy.'; });
}

// What a day's running actually was, from pace and distance, so the calendar shows what you did.
export function ranAs(runs, date, z) {
  const rs = runs.filter(r => r.date === date), mi = rs.reduce((t, r) => t + r.mi, 0);
  if (!mi) return null;
  const slow = k => zone(z, k)[3], best = Math.min(Infinity, ...rs.filter(r => r.mi >= 3 && r.sec).map(r => r.sec / r.mi));
  const tempo = best <= slow('tempo') + 10;
  const one = Math.max(...rs.map(r => r.mi));
  if (one >= 16 || (one >= 13 && !tempo)) return { kind: 'long', label: 'Long', mi };
  if (tempo) return { kind: 'quality', label: 'Tempo', mi };
  if (best <= slow('mp') + 5) return { kind: 'quality', label: 'MP', mi };
  return { kind: 'easy', label: 'Easy', mi };
}

// Strength sessions from Garmin (a plain "Strength" tap on the watch is enough).
export const liftsFrom = gdays => Object.entries(gdays).flatMap(([date, g]) => (g.activities || [])
  .filter(a => /strength|weight/.test(a.type || '')).map(a => ({ date, id: a.id, name: a.name, min: Math.round((a.duration || 0) / 60), hr: a.avgHR })));
export const LIFTS = ['Push', 'Pull', 'Legs', 'Shoulders', 'Abs'];

// What kind of lifting fits a plan day, so legs never land right before a long run or workout.
export function liftHint(plan, date) {
  const d = planFor(plan, date), next = planFor(plan, addDays(date, 1)), toRace = d && plan.weeks.length ? daysBetween(date, plan.weeks.at(-1).days.find(x => x.kind === 'race')?.date || date) : 99;
  if (!d || d.kind === 'race' || toRace < 0) return '';
  if (toRace <= 6) return 'Race week: skip legs. Light upper body early in the week at most.';
  if (d.kind === 'long') return 'No lifting today. Eat and recover.';
  if (next && (next.kind === 'long' || next.kind === 'quality')) return `Upper body or abs only. ${next.kind === 'long' ? 'Long run' : 'Workout'} tomorrow, so no legs.`;
  if (d.kind === 'quality') return 'Legs fit best today, after the run, so your easy days stay easy.';
  if (toRace <= 13) return 'Upper body, abs, or light legs (bodyweight, no heavy squats).';
  return 'Any split. Legs are fine if nothing hard is tomorrow.';
}

// Any distance in the range counts as done. Easy days flex the most; long runs flex down, not up.
export function range(kind, mi) {
  if (!mi || kind === 'race') return { lo: mi, hi: mi };
  const R = Math.round;
  if (kind === 'long') return { lo: R(Math.max(mi - 2, mi * 0.85)), hi: R(mi) };
  if (kind === 'quality') return { lo: R(Math.max(3, mi - 1)), hi: R(mi + 1) };
  return { lo: R(Math.max(2, mi - 1)), hi: R(mi + (kind === 'medium' ? 1.5 : 1)) };
}
const sumBy = (a, k) => a.reduce((t, d) => t + (d[k] || 0), 0);

// Adjusts this week (and the first days of next) to what you actually ran, after buildPlan.
// Rules, kept conservative for the knee:
// - A missed long run moves to the next day or two if that isn't race week; otherwise it's dropped.
// - A missed workout moves to today if today is an easy day and it isn't the day before the long run;
//   otherwise it's dropped (no stacking hard days).
// - Easy-day shortfalls are only half made up, at most +1.5 mi a day; extra miles come off later easy days.
// - Two fatigue signals together (resting HR up, last runs felt weak / easy runs felt hard) turn the
//   next workout into an easy run.
export function adapt(plan, runs, gdays, cfg, ref = today()) {
  const all = plan.weeks.flatMap(w => w.days), at = d => all.find(x => x.date === d);
  const act = d => milesOn(runs, d), wkOf = d => plan.weeks.find(w => w.days.some(x => x.date === d));
  const toRace = d => daysBetween(d, cfg.raceDate), changes = [];
  const set = (d, patch, why) => { Object.assign(d, patch, range(patch.kind || d.kind, patch.mi ?? d.mi), { adj: why }); changes.push([d.date, why]); };
  const yesterday = addDays(ref, -1), twoAgo = addDays(ref, -2);
  for (const missed of [twoAgo, yesterday].map(at).filter(Boolean)) {
    const got = d => (missed.kind === 'long' ? longestOn(runs, d) : act(d));
    if (missed.date < cfg.planStart || missed.adj || got(missed.date) >= missed.lo * 0.75) continue;
    const later = Array.from({ length: daysBetween(missed.date, ref) }, (_, k) => addDays(missed.date, k + 1));
    if (later.some(d => got(d) >= missed.lo * 0.9 && got(d) >= 4)) { missed.adj = 'Done on a different day.'; continue; }
    if (missed.kind === 'long') {
      const slot = [ref, addDays(ref, 1)].map(at).find(x => x && x.kind !== 'race' && x.kind !== 'long' && toRace(x.date) > 6);
      if (slot && !act(slot.date)) {
        set(slot, { kind: 'long', mi: missed.mi, title: 'Long run (moved)', detail: missed.detail, pace: missed.pace }, `Moved from ${new Date(missed.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'long' })} since it didn't happen.`);
        const after = at(addDays(slot.date, 1));
        if (after && after.kind === 'quality') set(after, { kind: 'easy', mi: Math.max(3, after.mi - 2), title: 'Recovery', detail: 'Easy the day after the long run.', pace: plan.z.list.find(z => z[0] === 'recovery').slice(2, 4) }, 'Workout dropped: it would land the day after the moved long run.');
      }
      missed.adj = slot ? 'Missed; moved forward.' : 'Missed. Skip it rather than cram it in.';
    } else if (missed.kind === 'quality') {
      const t = at(ref), beforeLong = at(addDays(ref, 1))?.kind === 'long';
      if (t && (t.kind === 'easy' || t.kind === 'medium') && !beforeLong && !act(ref) && toRace(ref) > 2) {
        set(t, { kind: 'quality', mi: missed.mi, title: missed.title + ' (moved)', detail: missed.detail, pace: missed.pace }, 'Moved from yesterday.');
        missed.adj = 'Missed; moved to today.';
      } else missed.adj = 'Missed. Dropped so hard days don\'t stack.';
    }
  }
  // Fatigue: resting HR up and recent runs felt bad -> next workout becomes easy.
  const f = fatigue(runs, gdays, ref);
  if (f.signals.length >= 2) {
    const q = all.find(d => d.date >= ref && d.date <= addDays(ref, 3) && d.kind === 'quality' && !act(d.date) && toRace(d.date) > 0);
    if (q) set(q, { kind: 'easy', mi: Math.max(3, q.mi - 2), title: 'Easy (was ' + q.title.replace(/ \(moved\)$/, '').toLowerCase() + ')', detail: 'Easy miles instead of the workout. Bring it back next week if you feel better.', pace: plan.z.list.find(z => z[0] === 'easy').slice(2, 4) }, 'Swapped for easy: ' + f.signals.join(' and ') + '.');
  }
  // Harder than planned: a tempo-or-faster run on an easy day, or a long run near race pace (or rated 9-10/10).
  // The next day turns into a short recovery run, a workout within 2 days turns easy, and a workout on day 3
  // after a hard long run gets shorter. Checked for every plan day so far, so past changes stay on the calendar.
  const Z = k => plan.z.list.find(z => z[0] === k), tempoSlow = Z('tempo')[3], mpSlow = Z('mp')[3];
  const wkday = d => new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'long' });
  const easyFrom = (q, why, detail) => set(q, { kind: 'easy', mi: Math.max(3, q.mi - 2), title: 'Easy (was ' + q.title.replace(/ \(moved\)$/, '').toLowerCase() + ')', detail, pace: Z('easy').slice(2, 4) }, why);
  // Last week's days aren't in a plan built on Monday, so a hard long run from Saturday is looked up from the runs.
  const before = Array.from({ length: 3 }, (_, k) => addDays(ref, k - 3)).filter(x => !at(x) && x >= cfg.planStart && longestOn(runs, x) >= 13)
    .map(date => ({ date, kind: 'long', lo: 13 }));
  for (const d of [...before, ...all.filter(x => x.date >= cfg.planStart && x.date <= ref && x.kind !== 'race')]) {
    const longDay = d.kind === 'long';
    const hard = runs.find(r => r.date === d.date && r.mi >= 3 && r.sec && (longDay
      ? r.mi >= d.lo * 0.9 && (r.sec / r.mi <= mpSlow + 15 || r.rpe >= 90)
      : d.kind !== 'quality' && r.sec / r.mi <= tempoSlow + 10));
    if (!hard) continue;
    const pace = fmtPace(hard.sec / hard.mi), what = `${wkday(d.date)}'s ${r1(hard.mi)} mi at ${pace}/mi`;
    d.adj ??= longDay ? `Hard long run (${r1(hard.mi)} mi at ${pace}/mi${hard.rpe ? `, effort ${Math.round(hard.rpe / 10)}/10` : ''}).` : `Ran as a workout (${r1(hard.mi)} mi at ${pace}/mi).`;
    const after = at(addDays(d.date, 1));
    if (after && (after.kind === 'easy' || after.kind === 'medium') && !after.adj && toRace(after.date) > 6)
      set(after, { kind: 'easy', mi: Math.max(3, half(after.mi - 1.5)), title: 'Recovery', detail: 'Short and very easy. Walk breaks are fine.', pace: Z('recovery').slice(2, 4) }, `Shorter and slower: ${what} was hard.`);
    for (const q of all.filter(x => x.date > d.date && x.date <= addDays(d.date, 3) && x.kind === 'quality' && !x.adj && toRace(x.date) > 2)) {
      const gap = daysBetween(d.date, q.date), didIt = runs.some(r => r.date === q.date && r.mi >= 3 && r.sec && r.sec / r.mi <= tempoSlow + 10);
      if (didIt) continue;
      if (gap <= 2) easyFrom(q, `Swapped for easy: ${what} already counts as a hard day.`, 'Easy miles: you already got a hard run in.');
      else if (longDay) set(q, { mi: Math.max(4, half(q.mi - 1.5)), title: q.title + ' (shorter)' }, `Shorter: ${what} was close to race effort. Cut the fast part short if your legs feel flat.`);
    }
  }
  // Rebalance easy days in the current week.
  const wk = wkOf(ref);
  if (wk && wk.w >= 1) {
    // Every day you've run counts: easy days both ways, runs on rest days as extra, and long runs or
    // workouts only when they went over (a short one is moved or dropped above, not made up here).
    const doneDays = wk.days.filter(d => d.date <= ref && d.date >= cfg.planStart && d.kind !== 'race' && (d.date < ref || act(d.date)));
    const left = wk.days.filter(d => d.date >= ref && !act(d.date) && (d.kind === 'easy' || d.kind === 'medium') && !d.adj);
    const over = d => d.kind === 'easy' || d.kind === 'medium' ? act(d.date) - d.mi : d.kind === 'rest' || d.kind === 'recovery' ? act(d.date) : Math.max(0, act(d.date) - d.hi);
    let delta = doneDays.reduce((t, d) => t + over(d), 0);
    if (left.length && Math.abs(delta) >= 1.5) {
      const share = delta < 0 ? Math.min(1.5, (-delta / 2) / left.length) : -Math.min(2, delta / left.length);
      for (const d of left) {
        const mi = Math.max(3, half(d.mi + share));
        if (mi !== d.mi) set(d, { mi }, delta < 0 ? `+${r1(mi - d.mi)} mi: picking up about half of what earlier easy days missed.` : `${r1(mi - d.mi)} mi: you already ran extra this week.`);
      }
    }
  }
  for (const w of plan.weeks) Object.assign(w, { mi: sumBy(w.days.filter(d => d.kind !== 'race'), 'mi'), lo: sumBy(w.days.filter(d => d.kind !== 'race'), 'lo'), hi: sumBy(w.days.filter(d => d.kind !== 'race'), 'hi') });
  return { changes, fatigue: f };
}
const r1 = v => Math.round(v * 10) / 10;

// Signals from resting HR and your post-run ratings over the last few days.
export function fatigue(runs, gdays, ref = today()) {
  const signals = [], rated = runs.filter(r => r.date > addDays(ref, -5) && r.date <= ref && (r.feel != null || r.rpe));
  const v = (from, to) => Object.entries(gdays).filter(([d]) => d >= from && d <= to).map(([, g]) => g.rhr).filter(x => x > 0);
  const avg = a => a.reduce((t, x) => t + x, 0) / (a.length || 1);
  const r3 = v(addDays(ref, -2), ref), r28 = v(addDays(ref, -31), addDays(ref, -4));
  if (r3.length >= 2 && r28.length >= 10 && avg(r3) - avg(r28) >= 4) signals.push(`resting HR up ${Math.round(avg(r3) - avg(r28))} bpm`);
  const weak = rated.filter(r => r.feel != null && r.feel <= 25).length;
  const hardEasy = rated.filter(r => r.rpe >= 70 && r.mi < 10 && r.hr && r.hr < 150).length;
  if (weak >= 2) signals.push(`${weak} recent runs felt weak`);
  else if (hardEasy >= 2) signals.push('easy runs feeling hard');
  const strong = rated.filter(r => r.feel >= 75).length;
  return { signals, strong, rated: rated.length };
}

export function planFor(plan, date) {
  for (const w of plan.weeks) for (const d of w.days) if (d.date === date) return d;
  return null;
}

// Planned vs done for a past/current day.
export function status(d, actual, ref = today()) {
  if (d.date > ref) return '';
  if (d.kind === 'rest' || d.kind === 'recovery') return actual > 0 ? 'extra' : 'done';
  if (actual >= (d.lo ?? d.mi) * 0.95) return 'done';
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
  const hd = hardDays(runs, plan.z, ref);
  if (hd.length >= 3) out.push(['warn', `${hd.length} hard days in the last 7. Two a week builds fitness; more just adds risk for the knee. Keep the next few easy.`]);
  const ph = cfg.prevRace && roadmap(cfg, ref).find(p => p.now);
  if (ph && (ph.k === 'speed' || ph.k === 'gate' || ph.k === 'block') && s.goal?.type === 'cut')
    out.push(['fuel', 'Workouts have started. Switch your goal from cut to maintenance so the hard days get fueled; losing weight now costs fitness.']);
  if (toRace >= 0 && toRace <= 28) out.push(['info', 'Taper time: fitness is banked. Volume drops, a little marathon pace stays in so the legs stay sharp.']);
  return out;
}
