import { loadLeague, loadSchedule, loadGameLogs, loadNews, currentSeason, etDate, SLOT, BENCH, IR, STAT_LABEL } from './espn.js';
import { prepare, dates, matchup, moves, alerts, addsLeft, bestLineup, reasons, power, isOut, avail } from './model.js';
import { gameBars, compareLines, meter, wireTips } from './charts.js';

const $ = s => document.querySelector(s);
const main = $('main');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const f1 = v => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(1));
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('hoops.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('hoops.' + k, JSON.stringify(v)); } catch {} },
};

let cfg = readCfg(), st = null, an = null, tab = store.get('tab', 'moves'), busy = false;
const ui = { lineupDay: 0, wirePos: 'All', wireSort: 'move', wireToday: false, wireHealthy: true, leagueQ: '', openTeam: null, compare: store.get('compare', []) };
const news = {}, logs = {};

function readCfg() {
  const q = new URLSearchParams(location.search);
  const saved = store.get('cfg', null);
  if (q.get('league')) {
    const c = { leagueId: +q.get('league'), teamId: q.get('team') ? +q.get('team') : saved?.teamId, season: +(q.get('season') || currentSeason()) };
    if (saved?.leagueId !== c.leagueId) c.teamId = q.get('team') ? +q.get('team') : null;
    store.set('cfg', c);
    return c;
  }
  if (saved && !q.get('season')) saved.season = currentSeason();
  return saved;
}

// ---------- data ----------
async function refresh({ quiet } = {}) {
  if (busy || !cfg?.leagueId) return;
  busy = true; setStatus('Updating…', true);
  try {
    let sched = store.get('sched', null);
    if (!sched || sched.season !== cfg.season || Date.now() - sched.at > 12 * 36e5) {
      sched = { ...(await loadSchedule(cfg.season)), season: cfg.season, at: Date.now() };
      store.set('sched', sched);
    }
    const league = await loadLeague({ ...cfg, sp: Math.max(dates(sched).spOf(etDate(Date.now())), 1) });
    if (!cfg.teamId || !league.teams.some(t => t.id === cfg.teamId)) { busy = false; return pickTeam(league); }
    const raw = { league, sched, cfg, at: Date.now() };
    store.set('cache', raw);
    build(raw);
    loadRosterNews();
  } catch (e) {
    setStatus(e.message, false, true);
    if (!st) main.innerHTML = `<div class="card"><h3>Couldn't load your league</h3><p class="warn">${esc(e.message)}</p><button onclick="location.reload()">Try again</button> <button id="reset">Change league</button></div>`, $('#reset')?.addEventListener('click', setup);
    busy = false; return;
  }
  busy = false;
}

function build(raw) {
  const s = prepare(raw);
  const mu = matchup(s), adds = addsLeft(s);
  const mv = moves(s, { nextWeek: s.next.length > 0 && (adds.left === 0 || s.left.length <= 1) });
  an = { mu, mv, adds, al: alerts(s, mu, mv, adds, news), pw: power(s) };
  st = s;
  setStatus(`Updated ${ago(raw.at)}`);
  document.title = st.me.name;
  render();
}

async function loadRosterNews() {
  const ids = st.me.players.map(p => p.id);
  await Promise.all(ids.map(async id => { news[id] = await loadNews(id, 3).catch(() => []); }));
  an.al = alerts(st, an.mu, an.mv, an.adds, news);
  if (tab === 'moves') render();
}

const ago = t => { const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`; };
function setStatus(text, spin = false, err = false) {
  $('#status').textContent = text;
  $('#status').classList.toggle('warn', err);
  $('#refresh').classList.toggle('spin', spin);
}

// ---------- pieces ----------
const injTag = p => p.inj ? `<span class="tag ${isOut(p) ? 'bad' : 'warn'}">${p.inj === 'DAY_TO_DAY' ? 'DTD' : esc(p.inj.replace(/_/g, ' '))}</span>` : '';
const trend = p => p.form > 0.15 ? '<span class="ok" title="hot">▲</span>' : p.form < -0.15 ? '<span class="warn" title="cold">▼</span>' : '';
const owner = p => p.onTeamId ? (p.onTeamId === st.me.id ? 'You' : esc(st.teams[p.onTeamId]?.abbrev || '')) : p.status === 'WAIVERS' ? 'Waivers' : 'FA';
const nextGame = p => { for (const sp of st.left) { const g = st.game(p, sp); if (g) return `${dayName(sp)} ${g.label}`; } return 'none this wk'; };
const dayName = sp => sp === st.todaySp ? 'Today' : sp === st.todaySp + 1 ? 'Tmrw' : new Date(st.D.dateOf(sp) + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

function playerRow(p, { right = '', sub = '' } = {}) {
  return `<button class="prow" data-pid="${p.id}">
    <span class="pmain"><span><b>${esc(p.name)}</b>${injTag(p)}${p.status === 'WAIVERS' ? '<span class="tag">WAIVERS</span>' : ''}</span>
      <span class="small muted">${esc(p.pos.join('/'))} · ${esc(p.team)}${sub ? ' · ' + sub : ''}</span></span>
    <span class="pnum">${right || `<b>${f1(p.value)}</b>${trend(p)}<span class="small muted">value</span>`}</span></button>`;
}
const chip = (lvl, text) => `<div class="alert ${lvl}"><span class="ic">${{ bad: '!', warn: '⚠', good: '✓', info: 'i' }[lvl]}</span><span>${esc(text)}</span></div>`;

// ---------- tabs ----------
function render() {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (!st) return;
  main.innerHTML = { moves: renderMoves, roster: renderRoster, wire: renderWire, league: renderLeague, compare: renderCompare }[tab]();
  if (tab === 'compare') fillCompareChart();
}

function renderMoves() {
  const { mu, mv, adds, al } = an;
  const wk = st.mp;
  let h = '';
  if (mu) {
    const pct = Math.round(mu.win * 100);
    h += `<section class="card matchup"><div class="small muted">Week ${wk} matchup · ${st.left.length} day${st.left.length === 1 ? '' : 's'} left</div>
      <div class="score"><div><span class="small muted">You</span><b>${Math.round(mu.score)}</b></div><div class="vs">vs</div><div><span class="small muted">${esc(mu.opp?.name || 'Opponent')}</span><b>${Math.round(mu.oppScore)}</b></div></div>
      <div class="winbar" role="img" aria-label="${pct}% win probability"><i style="width:${pct}%"></i></div>
      <div class="small"><b>${pct}%</b> to win · projected <b>${mu.myFinal.toFixed(0)}–${mu.oppFinal.toFixed(0)}</b> · games left ${mu.myGames} vs ${mu.oppGames}</div></section>`;
  }
  if (al.length) {
    const top = al.slice(0, 6), more = al.slice(6);
    h += `<section class="card"><h3>Alerts</h3>${top.map(a => chip(a.lvl, a.text)).join('')}${more.length ? `<details><summary class="small muted">${more.length} more</summary>${more.map(a => chip(a.lvl, a.text)).join('')}</details>` : ''}</section>`;
  }
  h += `<section class="card"><header><h3>Best moves</h3><span class="small muted">${adds.limit === Infinity ? 'unlimited adds' : `${adds.left}/${adds.limit} adds left`}</span></header>`;
  if (!mv.top.length) h += `<p class="muted">Stand pat: no free agent beats your worst player right now.</p>`;
  for (const m of mv.top) h += moveCard(m);
  h += `</section>`;
  h += lineupCard();
  h += `<section class="card"><h3>Streams for ${mv.nextWeek ? 'next' : 'this'} week</h3><p class="small muted">${mv.nextWeek ? 'This week is almost over or out of adds, so these are for next week. ' : ''}Ranked by projected points added, using real daily lineups (an extra game on a full day adds nothing).</p>
    ${mv.streams.map(m => playerRow(m.add, { sub: `drop ${esc(m.drop.last)}`, right: `<b class="ok">+${m.week.toFixed(0)}</b><span class="small muted">${m.games[0]} g</span>` })).join('') || '<p class="muted">Nothing worth an add.</p>'}</section>`;
  h += `<section class="card"><h3>Long-term upgrades</h3>
    ${mv.longTerm.map(m => playerRow(m.add, { sub: `over ${esc(m.drop.last)}`, right: `<b class="ok">+${m.ros.toFixed(1)}</b><span class="small muted">pts/g</span>` })).join('') || '<p class="muted">Your roster beats the wire. Nice.</p>'}</section>`;
  h += `<section class="card"><h3>Drop candidates</h3>${mv.drops.map(p => playerRow(p, { sub: `${p.left} g this wk` })).join('')}</section>`;
  h += rulesCard();
  return h;
}

function moveCard(m) {
  return `<div class="move" data-pid="${m.add.id}">
    <div class="swap"><span class="ok">＋ <b>${esc(m.add.name)}</b></span><span class="small muted">${esc(m.add.pos.join('/'))} ${esc(m.add.team)} · ${f1(m.add.value)}/g</span></div>
    <div class="swap"><span class="warn">− <b>${esc(m.drop.name)}</b></span><span class="small muted">${esc(m.drop.pos.join('/'))} ${esc(m.drop.team)} · ${f1(m.drop.value)}/g</span></div>
    <div class="small">${reasons(st, m).map(esc).join(' · ')}</div></div>`;
}

function lineupCard() {
  const sp = st.todaySp + ui.lineupDay;
  const roster = st.me.players;
  const best = bestLineup(st, roster, sp);
  const rows = best.starters.sort((a, b) => a.slot - b.slot).map(({ p, slot }) => {
    const moved = ui.lineupDay === 0 && (p.slot === BENCH);
    return `<tr class="${moved ? 'chg' : ''}" data-pid="${p.id}"><td class="slot">${SLOT[slot]}</td><td>${esc(p.name)} ${injTag(p)}</td><td class="small muted gm">${esc(st.game(p, sp).label)}<br>${esc(st.game(p, sp).time)}</td><td class="num">${f1(p.value * avail(p))}</td></tr>`;
  }).join('');
  const sit = best.sit.map(p => esc(p.last)).join(', ');
  const off = roster.filter(p => !p.games(sp) && p.slot !== IR).map(p => esc(p.last)).join(', ');
  return `<section class="card"><header><h3>Best lineup</h3><div class="seg">${['Today', 'Tomorrow'].map((d, i) => `<button data-lineday="${i}" class="${ui.lineupDay === i ? 'on' : ''}">${d}</button>`).join('')}</div></header>
    <table class="tbl">${rows || '<tr><td class="muted">No games.</td></tr>'}</table>
    ${ui.lineupDay === 0 ? '<p class="small muted">Highlighted = currently on your bench; move him in.</p>' : ''}
    ${sit ? `<p class="small">Sitting (plays, but slots are full): ${sit}</p>` : ''}${off ? `<p class="small muted">No game: ${off}</p>` : ''}</section>`;
}

function rulesCard() {
  const L = st.league, sc = Object.entries(L.scoring).map(([k, v]) => `${STAT_LABEL[k]} ${v > 0 ? '+' : ''}${v}`).join(' · ');
  const slots = Object.entries(L.slots).filter(([, n]) => n).map(([k, n]) => `${SLOT[k]}${n > 1 ? '×' + n : ''}`).join(' ');
  return `<details class="card"><summary><b>League rules</b> <span class="small muted">(${esc(L.name)})</span></summary>
    <p class="small"><b>Scoring</b> (${esc(L.type.replace(/_/g, ' ').toLowerCase())}): ${sc}</p>
    <p class="small"><b>Lineup</b>: ${slots} · locks ${L.lock === 'INDIVIDUAL_GAME' ? 'per game' : 'daily'}</p>
    <p class="small"><b>Adds</b>: ${an.adds.limit === Infinity ? 'unlimited' : `${an.adds.limit} this matchup`} · drops clear waivers in ${L.acq.waiverHours}h · claims process ${L.acq.days.map(d => d[0] + d.slice(1).toLowerCase()).join(', ') || 'daily'}</p>
    <p class="small"><b>Playoffs</b>: top ${L.playoffTeams} of ${L.size}${L.tradeDeadline ? ` · trade deadline ${new Date(L.tradeDeadline).toLocaleDateString()}` : ''}</p>
    <p class="small muted"><b>Value</b> = expected fantasy points per game, rest of season. It blends this season (and the last 15 days) with ESPN's projection and last season, trusting this season more as games pile up.</p></details>`;
}

function renderRoster() {
  const ps = [...st.me.players].sort((a, b) => (a.slot === IR) - (b.slot === IR) || b.value - a.value);
  let h = `<section class="card"><header><h3>${esc(st.me.name)}</h3><span class="small muted">${st.me.record.wins ?? 0}-${st.me.record.losses ?? 0}</span></header>`;
  h += ps.map(p => playerRow(p, { sub: `${p.slot === IR ? 'IR · ' : p.slot === BENCH ? 'bench · ' : ''}${p.left} g · next ${nextGame(p)}` })).join('') + '</section>';
  // Schedule grid for this matchup: who plays which day, and how many games each day.
  const days = st.sps;
  const head = days.map(sp => `<th class="${sp === st.todaySp ? 'now' : ''}">${dayName(sp).slice(0, 3)}</th>`).join('');
  const nStart = Object.entries(st.league.slots).filter(([k]) => +k !== BENCH && +k !== IR).reduce((a, [, n]) => a + n, 0);
  const body = ps.filter(p => p.slot !== IR).map(p => `<tr><td class="nm">${esc(p.last)}</td>${days.map(sp => { const g = st.game(p, sp); return `<td class="${sp < st.todaySp ? 'past' : ''} ${g && isOut(p) ? 'outg' : ''}">${g ? esc(g.label.replace('vs ', '')) : ''}</td>`; }).join('')}</tr>`).join('');
  const counts = days.map(sp => { const n = ps.filter(p => p.slot !== IR && p.games(sp) && !isOut(p)).length; return `<td class="${n > nStart ? 'warn' : ''}"><b>${n}</b></td>`; }).join('');
  h += `<section class="card"><h3>This week's schedule</h3><div class="scroll"><table class="grid"><tr><th></th>${head}</tr>${body}<tr class="tot"><td>Playing</td>${counts}</tr></table></div>
    <p class="small muted">${nStart} lineup slots a day. Red count = more healthy players than slots (someone sits). @ = away.</p></section>`;
  h += statTable(ps.filter(p => p.slot !== IR), 'Per-game box scores (this season)');
  return h;
}

function statTable(ps, title) {
  const keys = ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'to', 'tpm'];
  const rows = ps.map(p => { const b = p.s.cur?.box || {}; return `<tr data-pid="${p.id}"><td class="nm">${esc(p.last)}</td>${keys.map(k => `<td>${b[k] != null ? b[k].toFixed(k === 'min' ? 0 : 1) : '–'}</td>`).join('')}<td>${p.s.cur?.box?.fga ? Math.round((100 * p.s.cur.box.fgm) / p.s.cur.box.fga) : '–'}</td></tr>`; }).join('');
  return `<section class="card"><h3>${title}</h3><div class="scroll"><table class="grid stat"><tr><th></th>${keys.map(k => `<th>${k === 'min' ? 'MIN' : STAT_LABEL[k]}</th>`).join('')}<th>FG%</th></tr>${rows}</table></div></section>`;
}

function renderWire() {
  const worst = an.mv.drops[0];
  let ps = Object.values(st.players).filter(p => !p.onTeamId);
  if (ui.wirePos !== 'All') ps = ps.filter(p => p.pos.includes(ui.wirePos));
  if (ui.wireHealthy) ps = ps.filter(p => !isOut(p));
  if (ui.wireToday) ps = ps.filter(p => p.games(st.todaySp));
  const key = { move: p => p.value * (3 + p.left), value: p => p.value, week: p => p.value * avail(p) * p.left, l7: p => p.s.l7?.gp ? p.s.l7.avg : -1, trend: p => p.ownChg, ly: p => p.s.ly?.avg ?? -1 }[ui.wireSort];
  ps.sort((a, b) => key(b) - key(a));
  const pos = ['All', 'PG', 'SG', 'SF', 'PF', 'C'];
  let h = `<section class="filters"><div class="seg">${pos.map(x => `<button data-wpos="${x}" class="${ui.wirePos === x ? 'on' : ''}">${x}</button>`).join('')}</div>
    <div class="row"><select id="wsort">${[['move', 'Best add'], ['value', 'Value'], ['week', 'This week'], ['l7', 'Last 7 days'], ['trend', 'Trending'], ['ly', 'Last season']].map(([k, l]) => `<option value="${k}" ${ui.wireSort === k ? 'selected' : ''}>Sort: ${l}</option>`).join('')}</select>
    <label class="tog"><input type="checkbox" id="wtoday" ${ui.wireToday ? 'checked' : ''}> Plays today</label><label class="tog"><input type="checkbox" id="whealthy" ${ui.wireHealthy ? 'checked' : ''}> Healthy</label></div></section>`;
  h += `<section class="card">${worst ? `<p class="small muted">vs = value minus your weakest droppable player (${esc(worst.name)}, ${f1(worst.value)}).</p>` : ''}`;
  h += ps.slice(0, 60).map(p => {
    const d = worst ? p.value - worst.value : 0;
    const l7 = p.s.l7?.gp ? `L7 ${f1(p.s.l7.avg)}` : 'L7 –';
    return playerRow(p, { sub: `${p.left} g · ${l7} · ${p.own.toFixed(0)}%${p.ownChg ? ` (${p.ownChg > 0 ? '+' : ''}${p.ownChg.toFixed(1)})` : ''}`, right: `<b>${f1(p.value)}</b>${trend(p)}<span class="small ${d > 0 ? 'ok' : 'muted'}">${d > 0 ? '+' : ''}${d.toFixed(1)} vs</span>` });
  }).join('') + '</section>';
  return h;
}

function renderLeague() {
  const { pw } = an;
  const rank = Object.fromEntries(pw.map((x, i) => [x.t.id, i + 1]));
  const teams = Object.values(st.teams).sort((a, b) => (b.record.wins ?? 0) - (a.record.wins ?? 0) || (b.record.pointsFor ?? 0) - (a.record.pointsFor ?? 0));
  const maxP = pw[0]?.power || 1;
  let h = `<section class="card"><h3>Standings & power</h3><table class="tbl stand"><tr><th>#</th><th>Team</th><th>W-L</th><th>PF</th><th>Power</th></tr>`;
  teams.forEach((t, i) => {
    const p = pw.find(x => x.t.id === t.id).power;
    h += `<tr class="${t.id === st.me.id ? 'me' : ''}" data-team="${t.id}"><td>${i + 1}</td><td>${esc(t.name)}</td><td>${t.record.wins ?? 0}-${t.record.losses ?? 0}</td><td>${Math.round(t.record.pointsFor ?? 0)}</td><td>${meter(p, maxP)} <span class="small">${p.toFixed(1)} (#${rank[t.id]})</span></td></tr>`;
    if (ui.openTeam === t.id) h += `<tr><td colspan="5">${t.players.sort((a, b) => b.value - a.value).map(p => playerRow(p)).join('')}</td></tr>`;
  });
  h += `</table><p class="small muted">Power = average value of each team's top 10 healthy players. Tap a team for its roster.</p></section>`;
  const games = st.league.schedule.filter(m => m.mp === st.mp && m.away);
  h += `<section class="card"><h3>Week ${st.mp} scoreboard</h3>${games.map(m => `<div class="sb ${[m.home.teamId, m.away.teamId].includes(st.me.id) ? 'me' : ''}"><span>${esc(st.teams[m.home.teamId]?.name)}</span><b>${Math.round(m.home.pts)}</b><b>${Math.round(m.away.pts)}</b><span>${esc(st.teams[m.away.teamId]?.name)}</span></div>`).join('')}</section>`;
  const q = ui.leagueQ.toLowerCase();
  const all = Object.values(st.players).filter(p => !q || p.name.toLowerCase().includes(q)).sort((a, b) => b.value - a.value).slice(0, q ? 40 : 30);
  h += `<section class="card"><h3>Every player, by value</h3><input id="lq" type="search" placeholder="Search any player" value="${esc(ui.leagueQ)}">
    ${all.map(p => playerRow(p, { sub: owner(p) })).join('')}</section>`;
  return h;
}

function renderCompare() {
  const ps = ui.compare.map(id => st.players[id]).filter(Boolean);
  let h = `<section class="card"><h3>Compare players</h3><p class="small muted">Up to 3: yours, free agents, or anyone in the league.</p>
    <input id="cq" type="search" placeholder="Add a player…" autocomplete="off"><div id="cres"></div>
    <div class="chips">${ps.map((p, k) => `<button class="chipx s${k + 1}" data-rm="${p.id}"><i class="sw s${k + 1}"></i>${esc(p.name)} ✕</button>`).join('')}</div></section>`;
  if (!ps.length) return h + `<p class="muted center">Tap "Compare" on any player card, or search above.</p>`;
  const rows = [
    ['Owner', p => owner(p)], ['Value', p => p.value, 1], ['Season avg', p => p.s.cur?.avg, 1], ['Last 7 days', p => p.s.l7?.gp ? p.s.l7.avg : null, 1], ['Last 15 days', p => p.s.l15?.gp ? p.s.l15.avg : null, 1],
    ['ESPN proj', p => p.s.proj?.avg, 1], ['Last season', p => p.s.ly?.avg, 1], ['Games this wk', p => p.left, 1], ['Minutes', p => p.s.cur?.box?.min, 1],
    ...['pts', 'reb', 'ast', 'stl', 'blk', 'tpm'].map(k => [STAT_LABEL[k], p => p.s.cur?.box?.[k], 1]), ['TO', p => p.s.cur?.box?.to, -1],
    ['FG%', p => (p.s.cur?.box?.fga ? (100 * p.s.cur.box.fgm) / p.s.cur.box.fga : null), 1], ['% owned', p => p.own, 0],
  ];
  h += `<section class="card"><div class="scroll"><table class="tbl cmp"><tr><th></th>${ps.map((p, k) => `<th class="num"><i class="sw s${k + 1}"></i>${esc(p.last.length > 9 ? p.last.slice(0, 8) + '…' : p.last)}</th>`).join('')}</tr>`;
  for (const [label, fn, better] of rows) {
    const vals = ps.map(fn), nums = vals.filter(v => typeof v === 'number' && Number.isFinite(v));
    const top = better === 1 ? Math.max(...nums) : better === -1 ? Math.min(...nums) : null;
    h += `<tr><td class="small muted">${label}</td>${vals.map(v => `<td class="num ${ps.length > 1 && top != null && v === top ? 'best' : ''}">${typeof v === 'number' ? (label === '% owned' || label === 'FG%' ? v.toFixed(0) : label === 'Games this wk' ? v : f1(v)) : esc(v ?? '–')}</td>`).join('')}</tr>`;
  }
  h += `</table></div><p class="small muted">Bold = best in row.</p></section><section class="card"><h3>Recent games</h3><div id="cchart" class="muted small">Loading game logs…</div></section>`;
  return h;
}

let chartGen = 0;
async function fillCompareChart() {
  const ids = ui.compare.filter(id => st.players[id]), gen = ++chartGen;
  if (!ids.length) return;
  const need = ids.filter(id => !logs[id]);
  if (need.length) Object.assign(logs, await loadGameLogs(cfg, need).catch(() => ({})));
  const el = $('#cchart');
  if (!el || gen !== chartGen) return; // a newer render owns the chart
  const series = ids.map(id => {
    const g = (logs[id] || []).slice(-10);
    return { name: st.players[id].last, vals: g.map(x => x.pts), tips: g.map(x => `${x.pts} FPTS (${x.box.pts}p ${x.box.reb}r ${x.box.ast}a ${x.box.stl}s ${x.box.blk}b)${x.season < cfg.season ? ' · last season' : ''}`) };
  }).filter(s => s.vals.length);
  el.innerHTML = series.length ? compareLines(series) : 'No games logged yet.';
}

// ---------- player sheet ----------
async function openPlayer(id) {
  const p = st.players[id];
  if (!p) return;
  const sheet = $('#sheet');
  const lines = [['Value', p.value], ['Season', p.s.cur?.avg, p.s.cur?.gp], ['L7', p.s.l7?.gp ? p.s.l7.avg : null, p.s.l7?.gp], ['L15', p.s.l15?.gp ? p.s.l15.avg : null, p.s.l15?.gp], ['L30', p.s.l30?.gp ? p.s.l30.avg : null, p.s.l30?.gp], ['Proj', p.s.proj?.avg], ['Last yr', p.s.ly?.avg, p.s.ly?.gp]];
  const b = p.s.cur?.box || p.s.ly?.box || {};
  const sched = st.sps.filter(sp => sp >= st.todaySp).map(sp => { const g = st.game(p, sp); return `<span class="day ${g ? '' : 'off'}">${dayName(sp)}<b>${g ? esc(g.label) : '–'}</b></span>`; }).join('');
  const inCmp = ui.compare.includes(p.id);
  sheet.innerHTML = `<div class="sheet-in" role="dialog" aria-label="${esc(p.name)}"><button class="close" aria-label="Close">✕</button>
    <h2>${esc(p.name)} ${injTag(p)}</h2><div class="small muted">${esc(p.pos.join('/'))} · ${esc(st.sched.teams[p.proTeamId]?.name || p.team)} · ${owner(p)} · ${p.own.toFixed(0)}% owned${p.ownChg ? ` (${p.ownChg > 0 ? '+' : ''}${p.ownChg.toFixed(1)})` : ''}</div>
    <div class="kpis">${lines.map(([l, v, gp]) => `<div><span class="small muted">${l}</span><b>${f1(v)}</b>${gp != null ? `<span class="small muted">${gp} g</span>` : ''}</div>`).join('')}</div>
    <div class="small"><b>Per game${p.s.cur?.gp ? '' : ' (last season)'}:</b> ${['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'to', 'tpm'].map(k => `${b[k] != null ? b[k].toFixed(k === 'min' ? 0 : 1) : '–'} ${k === 'min' ? 'min' : STAT_LABEL[k].toLowerCase()}`).join(' · ')}${b.fga ? ` · ${Math.round((100 * b.fgm) / b.fga)}% FG` : ''}</div>
    <h3>This week</h3><div class="week">${sched || '<span class="muted small">Matchup over.</span>'}</div>
    <h3>Game log</h3><div id="glog" class="small muted">Loading…</div>
    <h3>News</h3><div id="pnews" class="small muted">Loading…</div>
    <div class="actions"><button id="cmpbtn" class="primary">${inCmp ? 'Remove from compare' : 'Compare'}</button><a class="btn" href="https://www.espn.com/nba/player/_/id/${p.id}" target="_blank" rel="noopener">ESPN page</a></div></div>`;
  sheet.hidden = false;
  document.body.classList.add('locked');
  $('#cmpbtn').onclick = () => { toggleCompare(p.id); closeSheet(); if (!inCmp) go('compare'); };
  if (!logs[id]) Object.assign(logs, await loadGameLogs(cfg, [id]).catch(() => ({})));
  const g = (logs[id] || []).slice(-15);
  const gl = $('#glog');
  if (gl) gl.outerHTML = g.length ? gameBars(g.map(x => ({ v: x.pts, old: x.season < cfg.season, label: x.season < cfg.season ? 'LY' : st.D.dateOf(x.sp).slice(5).replace('-', '/'), tip: `${x.season < cfg.season ? 'Last season' : st.D.dateOf(x.sp)}: ${x.pts} FPTS · ${x.box.min} min, ${x.box.pts} pts, ${x.box.reb} reb, ${x.box.ast} ast, ${x.box.stl} stl, ${x.box.blk} blk, ${x.box.to} to, ${x.box.fgm}/${x.box.fga} FG` })), p.value) : '<p class="small muted">No games yet.</p>';
  news[id] ??= await loadNews(id).catch(() => []);
  const pn = $('#pnews');
  if (pn) pn.outerHTML = news[id].length ? news[id].map(n => `<div class="news"><span class="small muted">${new Date(n.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span><p><b>${esc(n.headline)}</b></p><p class="small">${esc(n.story)}</p></div>`).join('') : '<p class="small muted">No recent news.</p>';
}
function closeSheet() { $('#sheet').hidden = true; document.body.classList.remove('locked'); }
function toggleCompare(id) {
  ui.compare = ui.compare.includes(id) ? ui.compare.filter(x => x !== id) : [...ui.compare, id].slice(-3);
  store.set('compare', ui.compare);
}

// ---------- setup ----------
function setup() {
  main.innerHTML = `<section class="card"><h3>Connect your ESPN league</h3>
    <p class="small">Paste your league link (from the ESPN app or site), or just the league ID. Public leagues work without a login.</p>
    <input id="lid" placeholder="https://fantasy.espn.com/basketball/league?leagueId=…" inputmode="url">
    <p><button class="primary" id="go">Load league</button></p></section>`;
  $('#go').onclick = () => {
    const v = $('#lid').value, m = v.match(/leagueId=(\d+)/) || v.match(/^\s*(\d+)\s*$/), t = v.match(/teamId=(\d+)/);
    if (!m) return setStatus('That doesn\'t look like a league link or ID.', false, true);
    cfg = { leagueId: +m[1], teamId: t ? +t[1] : null, season: currentSeason() };
    store.set('cfg', cfg); store.set('cache', null);
    refresh();
  };
}
function pickTeam(league) {
  setStatus('Pick your team');
  main.innerHTML = `<section class="card"><h3>${esc(league.name)}: which team is yours?</h3>${league.teams.map(t => `<button class="prow" data-pick="${t.id}"><span class="pmain"><b>${esc(t.name)}</b><span class="small muted">${esc(t.owner)}</span></span></button>`).join('')}</section>`;
  main.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { cfg.teamId = +b.dataset.pick; store.set('cfg', cfg); refresh(); });
}

// ---------- events ----------
function go(t) { tab = t; store.set('tab', t); render(); window.scrollTo(0, 0); }
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
$('#refresh').addEventListener('click', () => refresh());
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet' || e.target.closest('.close')) closeSheet(); });
wireTips(document.body);
main.addEventListener('click', e => {
  const t = e.target;
  const pid = t.closest('[data-pid]')?.dataset.pid;
  if (t.closest('[data-lineday]')) { ui.lineupDay = +t.closest('[data-lineday]').dataset.lineday; return render(); }
  if (t.closest('[data-wpos]')) { ui.wirePos = t.closest('[data-wpos]').dataset.wpos; return render(); }
  if (t.closest('[data-rm]')) { toggleCompare(+t.closest('[data-rm]').dataset.rm); return render(); }
  if (t.closest('[data-cadd]')) { toggleCompare(+t.closest('[data-cadd]').dataset.cadd); return render(); }
  if (t.closest('[data-team]') && !pid) { const id = +t.closest('[data-team]').dataset.team; ui.openTeam = ui.openTeam === id ? null : id; return render(); }
  if (pid) openPlayer(+pid);
});
main.addEventListener('change', e => {
  if (e.target.id === 'wsort') ui.wireSort = e.target.value;
  else if (e.target.id === 'wtoday') ui.wireToday = e.target.checked;
  else if (e.target.id === 'whealthy') ui.wireHealthy = e.target.checked;
  else return;
  render();
});
main.addEventListener('input', e => {
  if (e.target.id === 'lq') {
    ui.leagueQ = e.target.value;
    const pos = e.target.selectionStart; render(); const el = $('#lq'); el.focus(); el.setSelectionRange(pos, pos);
  } else if (e.target.id === 'cq') {
    const q = e.target.value.toLowerCase().trim();
    $('#cres').innerHTML = q.length < 2 ? '' : Object.values(st.players).filter(p => p.name.toLowerCase().includes(q) && !ui.compare.includes(p.id)).sort((a, b) => b.value - a.value).slice(0, 6)
      .map(p => `<button class="prow" data-cadd="${p.id}"><span class="pmain"><b>${esc(p.name)}</b><span class="small muted">${esc(p.team)} · ${owner(p)}</span></span><span class="pnum"><b>${f1(p.value)}</b></span></button>`).join('');
  }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && st && Date.now() - st.at > 5 * 6e4) refresh(); });

// ---------- boot ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (!cfg?.leagueId) { setStatus(''); setup(); }
else {
  const cache = store.get('cache', null);
  if (cache?.cfg?.leagueId === cfg.leagueId && cache.cfg.teamId === cfg.teamId && cache.cfg.season === cfg.season) { try { build(cache); } catch {} }
  refresh();
}
setInterval(() => { if (st) setStatus(`Updated ${ago(st.at)}`); }, 30e3);
