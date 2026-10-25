// Inline-SVG charts. Colors are CSS variables so light/dark both work; tapping a mark writes
// its value into the chart's caption line (phones have no hover).
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const W = 340, H = 150, PAD = { l: 30, r: 8, t: 10, b: 22 };

function scale(vals) {
  const v = vals.filter(Number.isFinite);
  const hi = Math.max(10, ...v) * 1.08, lo = Math.min(0, ...v);
  return { y: x => PAD.t + (H - PAD.t - PAD.b) * (1 - (x - lo) / (hi - lo)), lo, hi };
}
const grid = s => {
  const step = s.hi > 60 ? 20 : 10, out = [];
  for (let v = Math.ceil(s.lo / step) * step; v <= s.hi; v += step)
    out.push(`<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${s.y(v)}" y2="${s.y(v)}" class="gl"/><text x="${PAD.l - 4}" y="${s.y(v) + 3}" class="ax" text-anchor="end">${v}</text>`);
  return out.join('');
};
const wrap = (body, cap, label) => `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${body}</svg><figcaption class="small muted cap">${cap}</figcaption></figure>`;

// Game log: one bar per game, a dashed line at the player's value. items: [{label, v, tip}]
export function gameBars(items, ref, { label = 'Fantasy points by game' } = {}) {
  const n = items.length, s = scale([...items.map(d => d.v), ref]);
  const slot = (W - PAD.l - PAD.r) / Math.max(n, 1), bw = Math.min(22, slot - 2);
  const bars = items.map((d, i) => {
    const x = PAD.l + i * slot + (slot - bw) / 2, y = s.y(Math.max(d.v, 0)), h = Math.max(1, s.y(0) - y);
    const r = Math.min(4, bw / 2, h);
    // Rounded at the data end only; square on the baseline.
    const path = `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${y + h}Z`;
    return `<g class="hit" data-tip="${esc(d.tip)}"><rect x="${PAD.l + i * slot}" y="${PAD.t}" width="${slot}" height="${H - PAD.t - PAD.b}" fill="transparent"/><path d="${path}" class="bar${d.old ? ' old' : ''}"/></g>`;
  }).join('');
  const ticks = items.map((d, i) => (n <= 8 || i % Math.ceil(n / 6) === 0 || i === n - 1) ? `<text x="${PAD.l + i * slot + slot / 2}" y="${H - 6}" class="ax" text-anchor="middle">${d.label}</text>` : '').join('');
  const refLine = ref ? `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${s.y(ref)}" y2="${s.y(ref)}" class="ref"/><text x="${W - PAD.r}" y="${s.y(ref) - 4}" class="ax" text-anchor="end">value ${ref.toFixed(1)}</text>` : '';
  return wrap(grid(s) + bars + refLine + ticks, 'Tap a bar for the box score. Faded bars are last season.', label);
}

// Compare: last N games per player as lines (≤3 series, fixed categorical order).
export function compareLines(series, { label = 'Fantasy points, recent games' } = {}) {
  const n = Math.max(...series.map(s => s.vals.length), 2), s = scale(series.flatMap(x => x.vals));
  const x = i => PAD.l + (i * (W - PAD.l - PAD.r)) / (n - 1);
  const lines = series.map((sr, k) => {
    const off = n - sr.vals.length; // right-align so the latest games line up
    const pts = sr.vals.map((v, i) => [x(i + off), s.y(v)]);
    return `<polyline points="${pts.map(p => p.join(',')).join(' ')}" class="line s${k + 1}"/>` +
      pts.map((p, i) => `<g class="hit" data-tip="${esc(sr.name + ': ' + sr.tips[i])}"><circle cx="${p[0]}" cy="${p[1]}" r="12" fill="transparent"/><circle cx="${p[0]}" cy="${p[1]}" r="4" class="dot s${k + 1}"/></g>`).join('');
  }).join('');
  const ticks = `<text x="${x(0)}" y="${H - 6}" class="ax">${n} games ago</text><text x="${x(n - 1)}" y="${H - 6}" class="ax" text-anchor="end">latest</text>`;
  const legend = series.map((sr, k) => `<span class="key"><i class="sw s${k + 1}"></i>${esc(sr.name)}</span>`).join('');
  return `<div class="legend small">${legend}</div>` + wrap(grid(s) + lines + ticks, 'Tap a point for that game.', label);
}

// Horizontal meter for a value against a max (used in tables).
export const meter = (v, max, cls = '') => `<span class="meter ${cls}"><i style="width:${Math.max(2, Math.min(100, (v / (max || 1)) * 100))}%"></i></span>`;

export function wireTips(root) {
  root.addEventListener('click', e => {
    const g = e.target.closest('.hit');
    if (!g) return;
    const fig = g.closest('figure');
    fig.querySelectorAll('.hit.on').forEach(x => x.classList.remove('on'));
    g.classList.add('on');
    fig.querySelector('.cap').textContent = g.dataset.tip;
  });
}
