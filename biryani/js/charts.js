// Small inline-SVG charts. Colors come from CSS variables so light/dark both work.

const W = 340, H = 140, PAD = { l: 34, r: 8, t: 10, b: 20 };
const x = (i, n) => PAD.l + (n <= 1 ? 0 : (i * (W - PAD.l - PAD.r)) / (n - 1));
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
const labels = dates => {
  const n = dates.length, idx = [0, Math.floor(n / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  const anchor = i => (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle');
  return idx.map(i => `<text x="${x(i, n)}" y="${H - 4}" class="ax" text-anchor="${anchor(i)}">${dates[i]?.slice(5)}</text>`).join('');
};

// Bars with an optional per-day goal step line.
export function bars(dates, vals, goals, { title = '', cls = '' } = {}) {
  const n = dates.length, s = yScale([0, ...vals, ...(goals || [])], 0.05, 0);
  const bw = Math.max(2, ((W - PAD.l - PAD.r) / n) * 0.7);
  const b = vals.map((v, i) => v > 0
    ? `<rect x="${x(i, n) - bw / 2}" y="${s.y(v)}" width="${bw}" height="${Math.max(0, s.y(0) - s.y(v))}" rx="1.5" class="bar ${cls} ${goals && v > goals[i] * 1.05 ? 'over' : ''}"><title>${dates[i]}: ${Math.round(v)}</title></rect>` : '').join('');
  const g = goals ? `<polyline class="goal" points="${goals.map((v, i) => `${x(i, n)},${s.y(v)}`).join(' ')}"/>` : '';
  return svg(title, axis(s) + b + g + labels(dates));
}

// Line with dots for raw values and a smoothed trend.
export function line(dates, vals, { trend, title = '', fmt } = {}) {
  const n = dates.length, s = yScale([...vals, ...(trend || [])]);
  const pts = vals.map((v, i) => (Number.isFinite(v) ? `<circle cx="${x(i, n)}" cy="${s.y(v)}" r="2.2" class="dot"><title>${dates[i]}: ${v}</title></circle>` : '')).join('');
  const path = arr => {
    let d = '', pen = false;
    arr.forEach((v, i) => { if (Number.isFinite(v)) { d += `${pen ? 'L' : 'M'}${x(i, n)},${s.y(v)}`; pen = true; } });
    return d;
  };
  const tr = trend ? `<path d="${path(trend)}" class="trend"/>` : `<path d="${path(vals)}" class="trend"/>`;
  return svg(title, axis(s, fmt) + tr + pts + labels(dates));
}

const svg = (title, inner) => `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${title}">${inner}</svg>`;

// Exponential moving average, skipping gaps (like a scale-weight trend line).
export function ema(vals, alpha = 0.25) {
  let last;
  return vals.map(v => (Number.isFinite(v) ? (last = last == null ? v : last + alpha * (v - last)) : last));
}
