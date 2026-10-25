// Turns raw league data into decisions: player value, optimal daily lineups, matchup
// projection, add/drop moves and alerts. Pure functions over the loaded state.
import { BENCH, IR, SLOT, etDate } from './espn.js';

const OUT = new Set(['OUT', 'INJURY_RESERVE', 'SUSPENSION']);
export const isOut = p => OUT.has(p.inj);
// Chance he actually suits up on a given day.
export const avail = p => (isOut(p) ? 0 : p.inj ? 0.7 : 1);

// Value = expected fantasy points per game, rest of season. Early on the sample is tiny, so lean
// on ESPN's projection + last season and shift toward this season (with recent form) as games pile up.
export function value(p) {
  const { cur, l15, proj, ly } = p.s;
  const prior = proj?.avg != null && ly?.avg != null && ly.gp >= 10 ? 0.6 * proj.avg + 0.4 * ly.avg : (proj?.avg ?? ly?.avg ?? null);
  const gp = cur?.gp || 0;
  if (!gp) return prior ?? 0;
  const now = l15?.gp >= 2 ? 0.6 * cur.avg + 0.4 * l15.avg : cur.avg;
  if (prior == null) return now;
  const w = Math.min(gp / 20, 0.75);
  return w * now + (1 - w) * prior;
}

// Recent form vs value: >0 hot, <0 cold. Needs a couple of recent games.
export function form(p) {
  const l = p.s.l7?.gp >= 2 ? p.s.l7 : p.s.l15?.gp >= 2 ? p.s.l15 : null;
  return l && p.value ? (l.avg - p.value) / p.value : 0;
}

export function dates(sched) {
  const spOf = d => sched.first + Date.parse(d + 'T00:00:00Z') / 864e5 - sched.firstDay;
  const dateOf = sp => new Date((sched.firstDay + sp - sched.first) * 864e5).toISOString().slice(0, 10);
  // Matchup weeks run Mon–Sun; week 1 is the (short) week the season opens in.
  const dow0 = new Date(dateOf(sched.first) + 'T12:00:00Z').getUTCDay();
  const week = sp => Math.floor((sp - sched.first + ((dow0 + 6) % 7)) / 7) + 1;
  return { spOf, dateOf, week };
}

export function prepare(raw) {
  const { league, sched, cfg } = raw;
  const D = dates(sched);
  const today = etDate(Date.now()), todaySp = D.spOf(today);
  const mpOfWeek = {};
  for (const [mp, weeks] of Object.entries(league.matchupPeriods)) for (const w of weeks) mpOfWeek[w] = +mp;
  const mpOf = sp => mpOfWeek[D.week(sp)];
  const finalSp = league.status.finalScoringPeriod || todaySp + 180;
  const mp = mpOf(Math.max(todaySp, league.status.firstScoringPeriod || 1)) ?? league.status.currentMatchupPeriod;
  const sps = [];
  for (let sp = league.status.firstScoringPeriod || sched.first; sp <= finalSp; sp++) if (mpOf(sp) === mp) sps.push(sp);
  const left = sps.filter(sp => sp >= todaySp);
  const next = [];
  for (let sp = (sps.at(-1) ?? todaySp) + 1; sp <= finalSp && next.length < 14; sp++) { if (mpOf(sp) === mp + 1) next.push(sp); else if (next.length) break; }

  const players = league.players;
  for (const p of Object.values(players)) {
    p.team = sched.teams[p.proTeamId]?.abbrev || 'FA';
    p.value = value(p);
    p.form = form(p);
    p.games = sp => sched.teams[p.proTeamId]?.games[sp];
    p.left = left.filter(sp => p.games(sp)).length;
  }
  const teams = Object.fromEntries(league.teams.map(t => [t.id, { ...t, players: t.ids.map(id => players[id]).filter(Boolean) }]));
  const me = teams[cfg.teamId];
  const game = (p, sp) => {
    const g = p.games(sp);
    if (!g) return null;
    const opp = sched.teams[g.opp]?.abbrev;
    return { ...g, label: (g.home ? 'vs ' : '@') + opp, time: new Date(g.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) };
  };
  return { ...raw, D, today, todaySp, mp, sps, left, next, players, teams, me, game, mpOf };
}

// Max-value lineup for one day. Greedy over players by value + augmenting paths is optimal here
// (it's a weighted transversal matroid), and with ~10 slots it's instant.
export function bestLineup(st, roster, sp, { weight = p => p.value * avail(p) } = {}) {
  const slots = [];
  for (const [id, n] of Object.entries(st.league.slots)) if (+id !== BENCH && +id !== IR) for (let i = 0; i < n; i++) slots.push(+id);
  const holder = new Array(slots.length).fill(null);
  const cand = roster.filter(p => p.slot !== IR && p.games(sp) && weight(p) > 0).sort((a, b) => weight(b) - weight(a));
  const tryPlace = (p, seen) => {
    for (let i = 0; i < slots.length; i++) {
      if (!p.slots.includes(slots[i]) || seen.has(i)) continue;
      seen.add(i);
      if (!holder[i] || tryPlace(holder[i], seen)) { holder[i] = p; return true; }
    }
    return false;
  };
  for (const p of cand) tryPlace(p, new Set());
  const starters = holder.map((p, i) => p && { p, slot: slots[i] }).filter(Boolean);
  return { starters, pts: starters.reduce((a, x) => a + weight(x.p), 0), sit: cand.filter(p => !holder.includes(p)) };
}

export function projectWeek(st, roster, sps = st.left) {
  let pts = 0, varr = 0, games = 0;
  for (const sp of sps) {
    const l = bestLineup(st, roster, sp);
    pts += l.pts; games += l.starters.length;
    for (const { p } of l.starters) varr += (0.35 * p.value) ** 2;
  }
  return { pts, sd: Math.sqrt(varr), games };
}

const phi = z => 1 / (1 + Math.exp(-1.702 * z));

export function matchup(st) {
  const m = st.league.schedule.find(x => x.mp === st.mp && (x.home?.teamId === st.me.id || x.away?.teamId === st.me.id));
  if (!m) return null;
  const mine = m.home.teamId === st.me.id ? m.home : m.away, theirs = m.home.teamId === st.me.id ? m.away : m.home;
  const opp = st.teams[theirs?.teamId];
  const banked = s => Object.entries(s?.byDay || {}).filter(([sp]) => +sp < st.todaySp).reduce((a, [, v]) => a + v, 0);
  const a = projectWeek(st, st.me.players), b = opp ? projectWeek(st, opp.players) : { pts: 0, sd: 0 };
  const myFinal = banked(mine) + a.pts, oppFinal = banked(theirs) + b.pts;
  const sd = Math.sqrt(a.sd ** 2 + b.sd ** 2) || 1;
  return { opp, score: mine.pts, oppScore: theirs?.pts ?? 0, myFinal, oppFinal, win: phi((myFinal - oppFinal) / sd), myGames: a.games, oppGames: b.games };
}

export function addsLeft(st) {
  const { acq } = st.league;
  const used = st.me.adds[st.mp] || 0;
  const limit = acq.rate != null ? (acq.rate > 0 ? Math.floor(Math.round(acq.rate * st.sps.length * 100) / 100) : Infinity) : acq.perMatchup > 0 ? acq.perMatchup : Infinity;
  return { used, limit, left: Math.max(0, limit - used) };
}

// Add/drop moves. Week gain = change in this matchup's projected points (real lineup math,
// so games on crowded days don't count twice). ROS gain = value per game difference.
// Streams look at next week instead when this one is basically over or out of adds.
export function moves(st, { nextWeek = false } = {}) {
  const sps = nextWeek ? st.next : st.left;
  const mine = st.me.players;
  const base = projectWeek(st, mine, sps).pts;
  const drops = mine.filter(p => p.droppable && p.slot !== IR).sort((a, b) => a.value - b.value).slice(0, 4);
  const gamesIn = p => sps.filter(sp => p.games(sp)).length;
  const pool = Object.values(st.players).filter(p => !p.onTeamId && !isOut(p) && p.value > 0).sort((a, b) => b.value * (3 + gamesIn(b)) - a.value * (3 + gamesIn(a))).slice(0, 40);
  const out = [];
  for (const add of pool) for (const drop of drops) {
    const week = projectWeek(st, mine.filter(p => p !== drop).concat(add), sps).pts - base;
    const ros = add.value - drop.value;
    out.push({ add, drop, week, ros, score: week + 8 * ros, games: [gamesIn(add), gamesIn(drop)], nextWeek });
  }
  const best = (key, n) => {
    const seen = new Set(), res = [];
    for (const m of [...out].sort((a, b) => b[key] - a[key])) {
      // A stream must not cost a clearly better player for the rest of the season.
      if (seen.has(m.add.id) || m[key] <= 0 || (key === 'week' && m.ros < -3)) continue;
      seen.add(m.add.id); res.push(m);
      if (res.length === n) break;
    }
    return res;
  };
  return { top: best('score', 3), longTerm: best('ros', 6), streams: best('week', 6), drops, nextWeek };
}

export function reasons(st, m) {
  const r = [];
  if (m.ros > 0) r.push(`+${m.ros.toFixed(1)} pts/g over ${m.drop.last}`);
  if (m.week > 1) r.push(`+${m.week.toFixed(0)} proj ${m.nextWeek ? 'next' : 'this'} week (${m.games[0]} g vs ${m.games[1]})`);
  if (m.add.form > 0.2) r.push('hot lately');
  if (m.add.ownChg >= 3) r.push(`trending +${m.add.ownChg.toFixed(0)}% owned`);
  if (m.drop.inj) r.push(`${m.drop.last} ${m.drop.inj.toLowerCase().replace(/_/g, '-')}`);
  if (m.add.status === 'WAIVERS') r.push('on waivers: claim, not instant');
  return r;
}

const nm = p => p.name;
export function alerts(st, mu, mv, adds, news = {}) {
  const A = [], push = (lvl, text, ids = []) => A.push({ lvl, text, ids });
  const mine = st.me.players;
  const irP = mine.filter(p => p.slot === IR);
  for (const p of irP) if (!isOut(p)) push('bad', `Activate ${nm(p)} from IR. He's ${p.inj ? p.inj.toLowerCase().replace(/_/g, '-') : 'healthy'}, and ESPN blocks your adds/drops while a healthy player sits on IR.`, [p.id]);
  const irSlots = st.league.slots[IR] || 0;
  const outs = mine.filter(p => isOut(p) && p.slot !== IR);
  if (irP.length < irSlots) for (const p of outs) push('warn', `Move ${nm(p)} (OUT) to IR to open a roster spot.`, [p.id]);

  // Lineup for today vs the best possible lineup.
  const sp = st.todaySp;
  const best = bestLineup(st, mine, sp);
  const current = mine.filter(p => p.slot !== BENCH && p.slot !== IR);
  const curPts = current.reduce((a, p) => a + (p.games(sp) ? p.value * avail(p) : 0), 0);
  const bestIds = new Set(best.starters.map(x => x.p.id));
  const benchIn = best.starters.map(x => x.p).filter(p => p.slot === BENCH);
  const startOut = current.filter(p => !bestIds.has(p.id) && p.games(sp) && p.value * avail(p) > 0);
  if (best.pts - curPts > 3 && benchIn.length) {
    push('bad', `Lineup today: start ${benchIn.map(nm).join(', ')}${startOut.length ? ` over ${startOut.map(nm).join(', ')}` : ''} (+${(best.pts - curPts).toFixed(0)} proj).`, benchIn.map(p => p.id));
  }
  for (const p of current) if (p.games(sp) && isOut(p)) push('warn', `${nm(p)} is OUT but in your lineup today.`, [p.id]);
  for (const p of current) if (p.games(sp) && p.inj && !isOut(p)) push('info', `${nm(p)} is ${p.inj.toLowerCase().replace(/_/g, '-')}: check before ${st.game(p, sp).time} ET lock.`, [p.id]);

  if (adds.limit !== Infinity) push(adds.left ? 'info' : 'warn', adds.left ? `${adds.left} of ${adds.limit} adds left this matchup.` : `No adds left this matchup; queue moves for Monday.`);
  if (mu) {
    const pct = Math.round(mu.win * 100);
    if (pct < 45) push('warn', `Projected to lose ${mu.myFinal.toFixed(0)}–${mu.oppFinal.toFixed(0)} (${pct}% win). Stream for games: ${mv.streams[0] ? `${nm(mv.streams[0].add)} adds ~${mv.streams[0].week.toFixed(0)}` : 'no good streams'}.`);
    else push(pct > 60 ? 'good' : 'info', `Projected ${mu.myFinal.toFixed(0)}–${mu.oppFinal.toFixed(0)} vs ${mu.opp?.name} (${pct}% win). Games left: you ${mu.myGames}, them ${mu.oppGames}.`);
  }
  const worst = mv.drops[0];
  const hot = Object.values(st.players).filter(p => !p.onTeamId && !isOut(p) && p.ownChg >= 5 && worst && p.value > worst.value + 1).sort((a, b) => b.ownChg - a.ownChg).slice(0, 3);
  for (const p of hot) push('info', `${nm(p)} is trending +${p.ownChg.toFixed(0)}% owned and beats ${worst.name} (${p.value.toFixed(1)} vs ${worst.value.toFixed(1)}/g). Others may grab him.`, [p.id]);
  for (const p of mine) if (p.form < -0.3 && p.s.l7?.gp >= 2) push('info', `${nm(p)} is cold: ${p.s.l7.avg.toFixed(1)} over the last week vs ${p.value.toFixed(1)} value.`, [p.id]);
  for (const p of mine) if (p.form > 0.3 && p.s.l7?.gp >= 2) push('good', `${nm(p)} is hot: ${p.s.l7.avg.toFixed(1)} over the last week.`, [p.id]);
  const day = 864e5;
  for (const p of mine) {
    const n = news[p.id]?.[0];
    if (n && Date.now() - n.at < day && (p.inj || /out|injur|questionable|doubtful|ruled|surgery|sprain|strain|rest/i.test(n.headline))) push('info', `${p.last}: ${n.headline}`, [p.id]);
  }
  const order = { bad: 0, warn: 1, good: 2, info: 3 };
  return A.sort((a, b) => order[a.lvl] - order[b.lvl]);
}

export function power(st) {
  // Team strength = average of the best 10 values on the roster.
  return Object.values(st.teams).map(t => {
    const v = t.players.filter(p => !isOut(p)).map(p => p.value).sort((a, b) => b - a).slice(0, 10);
    return { t, power: v.reduce((a, x) => a + x, 0) / (v.length || 1) };
  }).sort((a, b) => b.power - a.power);
}

export { SLOT };
