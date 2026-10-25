// Daily goals: a base day plus whatever exercise Garmin (or you) logged, and recommended
// base targets from your stats.
import { goalGrams } from './nutrition.js';

const RUN_TYPES = /running|treadmill|track|trail_run|ultra/i;
const mi = m => (m || 0) / 1609.34;

export function autoDayType(gday, s) {
  const acts = gday?.activities || [];
  const runMi = acts.filter(a => RUN_TYPES.test(a.type || '')).reduce((t, a) => t + mi(a.distance), 0);
  if (runMi >= s.longRunMi) return 'long';
  if (runMi > 0 || acts.some(a => (a.kcal || 0) >= 250)) return 'run';
  return 'rest';
}

// Exercise calories above what you'd burn sitting still. Garmin's activity kcal is gross and
// already reflects pace and heart rate, so a harder run counts for more than an easy one.
// Manual entries (basketball, etc.) are taken as entered.
export function exerciseNet(gday, s) {
  const restPerMin = (gday?.bmrKcal || bmr(s.profile)) / 1440;
  return (gday?.activities || []).reduce((t, a) => {
    const min = a.manual ? 0 : (a.duration || 0) / 60;
    return t + Math.max(0, (a.kcal || 0) - restPerMin * min);
  }, 0);
}

// "18 mi run", "5 mi run + strength", "Basketball"…
function dayLabel(gday) {
  const acts = gday?.activities || [];
  const runMi = acts.filter(a => RUN_TYPES.test(a.type || '')).reduce((t, a) => t + mi(a.distance), 0);
  const other = [...new Set(acts.filter(a => !RUN_TYPES.test(a.type || '')).map(a => /strength/.test(a.type || '') ? 'strength' : a.name || 'workout'))];
  return [runMi >= 0.5 ? `${Math.round(runMi * 10) / 10} mi run` : '', ...other].filter(Boolean).join(' + ');
}

// Goals start from your base (rest) day and grow with the exercise you actually did: every
// net exercise calorie is added back (Settings → exercise fuel %), mostly as carbs. Big days
// also get up to half the diet deficit back, ramping smoothly, so there are no mileage cutoffs.
// override: a day type you picked by hand ('rest' = ignore exercise; older 'run'/'long' still work).
export function goalsFor(s, gday, override) {
  if (override && s.dayTypes[override]) {
    const g = goalGrams(s.dayTypes[override]);
    return { type: override, label: s.dayTypes[override].label + ' day', auto: false, ...g, eatBack: 0, exKcal: 0 };
  }
  const g = goalGrams(s.dayTypes.rest);
  const net = exerciseNet(gday, s);
  const fuel = net * (s.fuelPct ?? 100) / 100;
  const deficit = s.goal?.type === 'cut' ? (s.goal.rateLbWk || 0.5) * 500 : 0;
  const recovery = deficit * 0.5 * Math.min(1, Math.max(0, (net - 500) / 1000));
  const back = Math.round((fuel + recovery) / 10) * 10;
  if (back > 0) { g.kcal += back; g.c += (back * 0.85) / 4; g.f += (back * 0.15) / 9; }
  const active = net >= 150 || (gday?.activities || []).length > 0;
  return { type: active ? 'active' : 'rest', label: active ? dayLabel(gday) || 'Active day' : 'Rest day', auto: true, ...g, eatBack: back, exKcal: Math.round(net) };
}

// Mifflin-St Jeor BMR.
export function bmr({ sex, age, heightIn, weightLb }) {
  const kg = weightLb / 2.2046, cm = heightIn * 2.54;
  return 10 * kg + 6.25 * cm - 5 * age + (sex === 'female' ? -161 : 5);
}

// Recommended day types. Run calories use ~0.63 kcal per lb per mile (net running cost),
// or your Garmin averages when there is history.
export function recommend(s, { avgRunKcal, avgLongKcal, measuredTdee } = {}) {
  const p = s.profile, lb = p.weightLb;
  const base = measuredTdee ? measuredTdee - (avgRunKcal || 0) * 0.4 : bmr(p) * (p.neat || 1.3);
  const deficit = s.goal.type === 'cut' ? (s.goal.rateLbWk || 0.5) * 500 : s.goal.type === 'gain' ? -(s.goal.rateLbWk || 0.25) * 500 : 0;
  const run = avgRunKcal || Math.round(0.63 * lb * 5);
  const long = avgLongKcal || Math.round(0.63 * lb * Math.max(s.longRunMi, 12));
  const protein = Math.round(lb * (s.goal.type === 'cut' ? 1.0 : 0.85));
  const mk = (label, kcal) => {
    kcal = Math.round(kcal / 10) * 10;
    const fat = Math.round(Math.max(lb * 0.3, (kcal * 0.25) / 9));
    const carbs = Math.max(50, Math.round((kcal - protein * 4 - fat * 9) / 4));
    return { label, kcal, mode: 'g', p: protein, c: carbs, f: fat };
  };
  return {
    rest: mk('Rest', base - deficit),
    run: mk('Run', base - deficit + run),
    long: mk('Long run', base - deficit * 0.5 + long), // smaller deficit on long-run days to fuel recovery
    basis: measuredTdee ? 'measured from your logs + weigh-ins' : 'Mifflin-St Jeor estimate',
  };
}

// Measured TDEE: average intake minus the energy implied by the weight trend.
// Needs ~14+ logged days and several weigh-ins to mean anything.
export function measuredTdee(days) {
  const logged = days.filter(d => d.kcal > 800);
  const w = days.map((d, x) => ({ x, y: d.weight })).filter(p => p.y);
  if (logged.length < 14 || w.length < 4) return null;
  const n = w.length, sx = w.reduce((t, p) => t + p.x, 0), sy = w.reduce((t, p) => t + p.y, 0);
  const sxy = w.reduce((t, p) => t + p.x * p.y, 0), sxx = w.reduce((t, p) => t + p.x * p.x, 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1); // lb per day
  const avg = logged.reduce((t, d) => t + d.kcal, 0) / logged.length;
  return Math.round(avg - slope * 3500);
}
