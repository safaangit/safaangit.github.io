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
