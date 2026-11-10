// Local store: IndexedDB key/value, plus record collections that merge by updatedAt.
// Every synced file is { records: { id: { ...rec, u: updatedAtMs, del?: true } } }.

const DB = 'fuel', STORE = 'kv';
let dbp;
function idb() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode), s = t.objectStore(STORE), out = fn(s);
    t.oncomplete = () => res(out?.result);
    t.onerror = () => rej(t.error);
  });
}
export const kv = {
  get: k => tx('readonly', s => s.get(k)),
  set: (k, v) => tx('readwrite', s => s.put(v, k)),
  keys: () => tx('readonly', s => s.getAllKeys()),
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const today = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
export const monthOf = date => date.slice(0, 7);

// Files: foods, recipes, weights, exercises, days, settings, log/YYYY-MM
const cache = new Map();
export async function file(name) {
  if (!cache.has(name)) cache.set(name, (await kv.get('f:' + name)) || { records: {} });
  return cache.get(name);
}
async function save(name) {
  await kv.set('f:' + name, cache.get(name));
  const dirty = new Set((await kv.get('dirty')) || []);
  dirty.add(name);
  await kv.set('dirty', [...dirty]);
  listeners.forEach(f => f(name));
}
const listeners = new Set();
export const onChange = f => listeners.add(f);

export async function all(name) {
  return Object.values((await file(name)).records).filter(r => !r.del);
}
export async function get(name, id) {
  const r = (await file(name)).records[id];
  return r && !r.del ? r : undefined;
}
export async function put(name, rec) {
  const f = await file(name);
  rec.id ??= uid();
  rec.u = Date.now();
  f.records[rec.id] = rec;
  await save(name);
  return rec;
}
export async function remove(name, id) {
  const f = await file(name);
  if (f.records[id]) { f.records[id] = { id, del: true, u: Date.now() }; await save(name); }
}

// Last-writer-wins per record. Returns true if `local` changed.
export function merge(local, remote) {
  let changed = false;
  for (const [id, r] of Object.entries(remote.records || {})) {
    const l = local.records[id];
    if (!l || (r.u || 0) > (l.u || 0)) { local.records[id] = r; changed = true; }
  }
  return changed;
}
export async function replaceFromRemote(name, data) {
  const f = await file(name);
  const changed = merge(f, data);
  if (changed) { await kv.set('f:' + name, f); listeners.forEach(fn => fn(name)); }
  return changed;
}
export async function isDirty(name) { return ((await kv.get('dirty')) || []).includes(name); }
export async function dirtyList() { return (await kv.get('dirty')) || []; }
export async function clearDirty(name) {
  await kv.set('dirty', ((await kv.get('dirty')) || []).filter(n => n !== name));
}

// Settings are one record with id 'main'.
export const DEFAULT_SETTINGS = {
  id: 'main',
  profile: { sex: 'male', age: 30, heightIn: 70, weightLb: 180, neat: 1.3 },
  goal: { type: 'cut', rateLbWk: 0.5 },
  caloriesFromMacros: true,
  netCarbs: false,
  eatBackPct: 0,
  longRunMi: 10,
  dayTypes: {
    rest: { label: 'Rest', kcal: 2100, mode: 'g', p: 180, c: 180, f: 73 },
    run: { label: 'Run', kcal: 2450, mode: 'g', p: 180, c: 265, f: 75 },
    long: { label: 'Long run', kcal: 2900, mode: 'g', p: 180, c: 370, f: 80 },
  },
  meals: ['Food'],
  hiddenRecents: [],
};
export async function settings() {
  const s = await get('settings', 'main');
  if (!s) return structuredClone(DEFAULT_SETTINGS);
  if (s.meals?.join() === 'Meal 1,Meal 2,Meal 3,Snacks') s.meals = ['Food']; // old default -> single running list
  return { ...structuredClone(DEFAULT_SETTINGS), ...s };
}
export const saveSettings = s => put('settings', { ...s, id: 'main' });

// Device-only prefs (secrets never sync to the repo).
export const local = {
  get(k, d) { try { const v = localStorage.getItem('fuel:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('fuel:' + k, JSON.stringify(v)); } catch {} },
};
