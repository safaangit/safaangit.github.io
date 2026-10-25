// Small inline-SVG charts. Colors come from CSS variables so light/dark both work.
// Every chart has an invisible tap target per point; bindCharts() turns a tap into a callback
// (like Garmin's charts: tap a bar, see that day).

const W = 340, H = 150, PAD = { l: 34, r: 8, t: 10, b: 20 };
const x = (i, n) => PAD.l + (n <= 1 ? (W - PAD.l - PAD.r) / 2 : ((i + 0.5) * (W - PAD.l - PAD.r)) / n);
function yScale(vals, pad = 0.08, floor) {
  const v = vals.filter(Number.isFinite);
  let lo = Math.min(...v), hi = Math.max(...v);
  if (!v.length) { lo = 0; hi = 1; }
  const span = hi - lo || Math.abs(hi) * 0.1 || 1;
  lo = floor ?? lo - span * pad; hi += span * pad;
  return { y: val => PAD.t + (H - PAD.t - PAD.b) * (1 - (val - lo) / (hi - lo)), lo, hi };
}
const short = v => (Math.abs(v) >= 10000 ? Math.round(v / 1000) + 'k' : Math.round(v));
const axis = (s, fmt = short) => [s.hi, (s.hi + s.lo) / 2, s.lo]
  .map(v => `<text x="${PAD.l - 4}" y="${s.y(v) + 3}" class="ax" text-anchor="end">${fmt(v)}</text><line x1="${PAD.l}" x2="${W - PAD.r}" y1="${s.y(v)}" y2="${s.y(v)}" class="grid"/>`).join('');
export const dayLabel = d => new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const labels = dates => {
  const n = dates.length, idx = n <= 7 ? dates.map((_, i) => i) : [0, Math.floor(n / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  const lab = d => (n <= 7 ? new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' }) : dayLabel(d));
  return idx.map(i => `<text x="${x(i, n)}" y="${H - 4}" class="ax" text-anchor="middle">${lab(dates[i])}</text>`).join('');
};
// Full-height tap strips plus a marker line that bindCharts() moves to the picked point.
const hits = n => {
  const w = (W - PAD.l - PAD.r) / n;
  return `<line class="mark" x1="0" x2="0" y1="${PAD.t}" y2="${H - PAD.b}"/>` +
    Array.from({ length: n }, (_, i) => `<rect class="hit" data-i="${i}" x="${x(i, n) - w / 2}" y="0" width="${w}" height="${H}"/>`).join('');
};

// Bars with optional per-point goal ticks.
export function bars(dates, vals, goals, { title = '', cls = '', id = '' } = {}) {
  const n = dates.length, s = yScale([0, ...vals, ...(goals || []).filter(Number.isFinite)], 0.05, 0);
  const bw = Math.max(2, ((W - PAD.l - PAD.r) / n) * 0.62), rx = Math.min(bw / 2, 6);
  const b = vals.map((v, i) => v > 0
    ? `<rect data-b="${i}" x="${x(i, n) - bw / 2}" y="${s.y(v)}" width="${bw}" height="${Math.max(0, s.y(0) - s.y(v))}" rx="${rx}" class="bar ${cls} ${goals && v > goals[i] * 1.05 ? 'over' : ''}"/>` : '').join('');
  // Goal as a short tick over each bar, so a big-goal day doesn't draw a spike across the chart.
  const tw = Math.max(bw + 4, 6);
  const g = goals ? goals.map((v, i) => Number.isFinite(v) && v > 0 ? `<line class="goal" x1="${x(i, n) - tw / 2}" x2="${x(i, n) + tw / 2}" y1="${s.y(v)}" y2="${s.y(v)}"/>` : '').join('') : '';
  return svg(title, id, n, axis(s) + b + g + labels(dates) + hits(n));
}

// Line with dots for raw values and a smoothed trend.
export function line(dates, vals, { trend, title = '', fmt, id = '' } = {}) {
  const n = dates.length, s = yScale([...vals, ...(trend || [])]);
  const pts = vals.map((v, i) => (Number.isFinite(v) ? `<circle data-b="${i}" cx="${x(i, n)}" cy="${s.y(v)}" r="2.6" class="dot"/>` : '')).join('');
  const path = arr => {
    let d = '', pen = false;
    arr.forEach((v, i) => { if (Number.isFinite(v)) { d += `${pen ? 'L' : 'M'}${x(i, n)},${s.y(v)}`; pen = true; } });
    return d;
  };
  const tr = trend ? `<path d="${path(trend)}" class="trend"/>` : `<path d="${path(vals)}" class="trend"/>`;
  return svg(title, id, n, axis(s, fmt) + tr + pts + labels(dates) + hits(n));
}

const svg = (title, id, n, inner) => `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${title}" data-id="${id}" data-n="${n}">${inner}</svg>`;

// Tap handling for every chart under root: highlights the point and calls onPick(id, i, svg).
export function bindCharts(root, onPick) {
  root.querySelectorAll('svg.chart').forEach(c => c.addEventListener('click', e => {
    const h = e.target.closest('.hit'); if (!h) return;
    const i = +h.dataset.i, n = +c.dataset.n, mx = x(i, n);
    c.querySelectorAll('[data-b].on').forEach(el => el.classList.remove('on'));
    c.querySelector(`[data-b="${i}"]`)?.classList.add('on');
    const m = c.querySelector('.mark'); m.setAttribute('x1', mx); m.setAttribute('x2', mx); c.classList.add('picked');
    onPick(c.dataset.id, i, c);
  }));
}

// Exponential moving average, skipping gaps (like a scale-weight trend line).
export function ema(vals, alpha = 0.25) {
  let last;
  return vals.map(v => (Number.isFinite(v) ? (last = last == null ? v : last + alpha * (v - last)) : last));
}
