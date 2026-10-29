// Best lift: one lift per strength session (name, weight, reps), not a full workout log.
// data/fuel/lifts.json, one record per session keyed by the Garmin activity id (or the manual exercise id):
// { id, date, name, lb, reps, each }. each = the weight is per dumbbell. The day's split (Push / Pull...)
// stays in settings.training.lifts[id], the same tags the Training tab sets.
import * as db from './db.js';
import { LIFTS } from './training.js';

const SUGGEST = {
  Push: ['Incline DB press', 'DB bench press', 'Bench press', 'Dips'],
  Pull: ['Lat pulldown', 'DB row', 'Pull-ups', 'Cable row'],
  Legs: ['Goblet squat', 'Leg press', 'RDL', 'Bulgarian split squat'],
  Shoulders: ['DB shoulder press', 'Lateral raise', 'Arnold press'],
  Abs: ['Cable crunch', 'Hanging leg raise', 'Ab wheel'],
};
const key = n => (n || '').trim().toLowerCase();
const isDb = n => /\b(db|dbs|dumbbells?)\b/i.test(n || '');
const fmtDay = d => new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
// "70 lb DBs × 12", "Bodyweight × 15"
export const setText = r => `${r.lb ? `${r.lb} lb${r.each ? ' DBs' : ''}` : 'Bodyweight'}${r.reps ? ` × ${r.reps}` : ''}`;
// Heavier wins; same weight, more reps wins.
const better = (a, b) => (a.lb || 0) > (b.lb || 0) || ((a.lb || 0) === (b.lb || 0) && (a.reps || 0) > (b.reps || 0));

export const forSession = id => db.get('lifts', String(id));
export const tagsOf = (s, id) => s.training?.lifts?.[String(id)] || [];

// The line under a strength session on Today: "Push · Incline DB press 70 lb DBs × 12", or a prompt.
export function rowLine(s, a, rec, esc) {
  const tags = tagsOf(s, a.id).join(' + ');
  const txt = rec ? `${tags ? `${esc(tags)} · ` : ''}${esc(rec.name)} <b>${esc(setText(rec))}</b>` : `${tags ? `${esc(tags)} · ` : ''}+ Best lift`;
  return `<button class="bestlift ${rec ? 'set' : ''}" data-lift="${esc(String(a.id))}">${txt}</button>`;
}

export async function open(s, a, date, ui) {
  const id = String(a.id), rec = await forSession(id), all = (await db.all('lifts')).filter(r => r.id !== id);
  const tags = new Set(tagsOf(s, id));
  const b = ui.sheet(`<p class="muted small">Just your top set from this session. Skip the rest.</p>
    <div class="wkruns lifttags" id="blTags">${LIFTS.map(k => `<button type="button" data-t="${k}" class="${tags.has(k) ? 'on' : ''}">${k}</button>`).join('')}</div>
    <form id="bl" class="form">
      <label>Lift<input name="name" id="blName" autocomplete="off" placeholder="Incline DB press" value="${ui.esc(rec?.name || '')}"></label>
      <div class="chips blsug" id="blSug"></div>
      <div class="grid2"><label>Weight (lb)<input name="lb" type="number" min="0" step="0.5" inputmode="decimal" placeholder="blank = bodyweight" value="${rec?.lb ?? ''}"></label>
      <label>Reps<input name="reps" type="number" min="0" inputmode="numeric" value="${rec?.reps ?? ''}"></label></div>
      <label class="check"><input type="checkbox" name="each" id="blEach" ${rec?.each ? 'checked' : ''}> Dumbbells (weight is each)</label>
      <div class="blhist" id="blHist"></div>
      <div class="actions">${rec ? '<button type="button" class="danger" id="blDel">Clear</button>' : ''}<button class="primary">Save</button></div></form>`, { title: 'Best lift' });
  const nameIn = ui.$('#blName', b), each = ui.$('#blEach', b);
  // Lifts you've logged before (most recent first), narrowed to the split you tapped; starter ideas otherwise.
  const sug = () => {
    const pick = [...tags], seen = new Set(), out = [];
    const mine = all.filter(r => !pick.length || tagsOf(s, r.id).some(t => pick.includes(t))).sort((x, y) => y.date.localeCompare(x.date));
    for (const r of mine) if (!seen.has(key(r.name))) { seen.add(key(r.name)); out.push(r.name); }
    for (const t of pick.length ? pick : ['Push', 'Pull', 'Legs']) for (const n of SUGGEST[t] || []) if (!seen.has(key(n))) { seen.add(key(n)); out.push(n); }
    ui.$('#blSug', b).innerHTML = out.slice(0, 8).map(n => `<button type="button" class="${key(n) === key(nameIn.value) ? 'on' : ''}">${ui.esc(n)}</button>`).join('');
    ui.$$('#blSug button', b).forEach(x => (x.onclick = () => { nameIn.value = x.textContent; if (isDb(nameIn.value)) each.checked = true; sug(); hist(); }));
  };
  // Last time and best ever for this lift, so you know what to beat.
  const hist = () => {
    const same = all.filter(r => key(r.name) === key(nameIn.value) && key(r.name)).sort((x, y) => y.date.localeCompare(x.date));
    const best = same.reduce((m, r) => (!m || better(r, m) ? r : m), null);
    ui.$('#blHist', b).innerHTML = same.length ? `<div>Last: <b>${ui.esc(setText(same[0]))}</b> · ${fmtDay(same[0].date)}</div>${best !== same[0] ? `<div>Best: <b>${ui.esc(setText(best))}</b> · ${fmtDay(best.date)}</div>` : ''}` : '';
  };
  nameIn.oninput = () => { if (isDb(nameIn.value)) each.checked = true; sug(); hist(); };
  ui.$$('#blTags button', b).forEach(x => (x.onclick = () => { tags.has(x.dataset.t) ? tags.delete(x.dataset.t) : tags.add(x.dataset.t); x.classList.toggle('on'); sug(); }));
  sug(); hist();
  const saveTags = async () => {
    if (tags.size === tagsOf(s, id).length && [...tags].every(t => tagsOf(s, id).includes(t))) return;
    s.training = { ...(s.training || {}), lifts: { ...(s.training?.lifts || {}), [id]: [...tags] } };
    await db.saveSettings({ ...s });
  };
  ui.$('#bl', b).onsubmit = async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target), name = String(f.get('name') || '').trim();
    await saveTags();
    if (!name) { ui.closeSheet(); return ui.render(); }
    const r = { id, date, name, lb: Math.max(0, +f.get('lb') || 0), reps: Math.max(0, Math.round(+f.get('reps') || 0)), each: f.get('each') === 'on' };
    const prior = all.filter(x => key(x.name) === key(name));
    await db.put('lifts', r);
    ui.closeSheet(); ui.render();
    ui.toast(prior.length && prior.every(x => better(r, x)) ? `New best on ${name}` : 'Lift saved');
  };
  const del = ui.$('#blDel', b);
  if (del) del.onclick = async () => { await db.remove('lifts', id); await saveTags(); ui.closeSheet(); ui.render(); };
  return b;
}

// ---------- Cardio and everything else ----------
// Machines and other workouts the watch can't fully describe (stair stepper, bike, elliptical, incline walk,
// basketball...): what you used, the setting, and distance or floors if the machine shows it.
// data/fuel/cardio.json: { id (activity id), date, name, setting, mi, floors }. GPS runs and walks already
// have distance and pace from Garmin, so they get no line.
const MACHINES = [
  [/stair/, 'Stair stepper', 'Level 9', 'floors'], [/cycl|bik|ride|spin/, 'Bike', 'Resistance 12', 'mi'],
  [/ellip/, 'Elliptical', 'Level 8', 'mi'], [/row/, 'Rower', 'Damper 5', 'mi'], [/walk|hik/, 'Incline walk', '12% · 3.5 mph', 'mi'],
  [/cardio|hiit/, 'Cardio', 'What you did', ''],
];
const machineOf = a => MACHINES.find(([re]) => re.test(a.type || '')) || [null, a.name || 'Workout', 'Setting or note', ''];
const CARDIO_SUGGEST = ['Incline walk', 'Stair stepper', 'Bike', 'Elliptical', 'Rower'];
export const needsCardio = a => !/run|track|strength|weight/.test(a.type || '') && !(a.distance > 0 && !a.manual);
export const forCardio = id => db.get('cardio', String(id));
export const cardioText = r => [r.setting, r.mi ? `${r.mi} mi` : '', r.floors ? `${r.floors} floors` : ''].filter(Boolean).join(' · ');

export function cardioLine(a, rec, esc) {
  const same = rec && key(rec.name) === key(a.name), txt = rec ? `${same && cardioText(rec) ? '' : esc(rec.name)}${cardioText(rec) ? ` <b>${esc(cardioText(rec))}</b>` : ''}` : `+ ${/cardio|stair|cycl|bik|ellip|row|walk/.test(a.type || '') ? 'Machine & setting' : 'Add detail'}`;
  return `<button class="bestlift ${rec ? 'set' : ''}" data-cardio="${esc(String(a.id))}">${txt}</button>`;
}

export async function openCardio(a, date, ui) {
  const id = String(a.id), rec = await forCardio(id), all = (await db.all('cardio')).filter(r => r.id !== id);
  const [, defName, hint, unit0] = machineOf(a);
  const b = ui.sheet(`<p class="muted small">Garmin has your time, heart rate and calories. Add what it can't see.</p>
    <form id="cd" class="form">
      <label>What<input name="name" id="cdName" autocomplete="off" value="${ui.esc(rec?.name || (/^(cardio|workout)$/i.test(defName) ? '' : defName))}" placeholder="${ui.esc(defName)}"></label>
      <div class="chips blsug" id="cdSug"></div>
      <label>Setting<input name="setting" autocomplete="off" placeholder="${ui.esc(hint)}" value="${ui.esc(rec?.setting || '')}"></label>
      <div class="grid2"><label>Distance (mi)<input name="mi" type="number" min="0" step="0.01" inputmode="decimal" value="${rec?.mi || ''}"></label>
      <label>Floors<input name="floors" type="number" min="0" inputmode="numeric" value="${rec?.floors || ''}"></label></div>
      <div class="blhist" id="cdHist"></div>
      <div class="actions">${rec ? '<button type="button" class="danger" id="cdDel">Clear</button>' : ''}<button class="primary">Save</button></div></form>`, { title: a.name || 'Workout' });
  if (unit0 === 'floors') ui.$('[name=floors]', b).closest('label').parentElement.prepend(ui.$('[name=floors]', b).closest('label'));
  const nameIn = ui.$('#cdName', b);
  const sug = () => {
    const seen = new Set(), out = [];
    for (const n of [...all.sort((x, y) => y.date.localeCompare(x.date)).map(r => r.name), ...CARDIO_SUGGEST]) if (!seen.has(key(n))) { seen.add(key(n)); out.push(n); }
    ui.$('#cdSug', b).innerHTML = out.slice(0, 7).map(n => `<button type="button" class="${key(n) === key(nameIn.value) ? 'on' : ''}">${ui.esc(n)}</button>`).join('');
    ui.$$('#cdSug button', b).forEach(x => (x.onclick = () => { nameIn.value = x.textContent; sug(); hist(); }));
  };
  // Last time on the same machine, with its minutes, so you can see if you went longer or harder.
  const hist = () => {
    const last = all.filter(r => key(r.name) && key(r.name) === key(nameIn.value)).sort((x, y) => y.date.localeCompare(x.date))[0];
    ui.$('#cdHist', b).innerHTML = last ? `<div>Last: <b>${ui.esc(cardioText(last) || last.name)}</b>${last.min ? ` · ${last.min} min` : ''} · ${fmtDay(last.date)}</div>` : '';
  };
  nameIn.oninput = () => { sug(); hist(); };
  sug(); hist();
  ui.$('#cd', b).onsubmit = async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target), name = String(f.get('name') || '').trim() || defName;
    const r = { id, date, name, setting: String(f.get('setting') || '').trim(), mi: Math.max(0, +f.get('mi') || 0), floors: Math.max(0, Math.round(+f.get('floors') || 0)),
      min: Math.round((a.duration || 0) / 60) || a.min || 0 };
    await db.put('cardio', r);
    ui.closeSheet(); ui.render(); ui.toast('Saved');
  };
  const del = ui.$('#cdDel', b);
  if (del) del.onclick = async () => { await db.remove('cardio', id); ui.closeSheet(); ui.render(); };
  return b;
}
