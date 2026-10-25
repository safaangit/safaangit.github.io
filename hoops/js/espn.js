// ESPN fantasy basketball reads. Public leagues need no login, and ESPN's API sends CORS
// headers for any origin, so the phone talks to it directly.
const HOST = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba';
const NEWS = 'https://site.api.espn.com/apis/fantasy/v2/games/fba/news/players';

export const SLOT = { 0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C', 5: 'G', 6: 'F', 7: 'SG/SF', 8: 'G/F', 9: 'PF/C', 10: 'F/C', 11: 'UTIL', 12: 'BE', 13: 'IR' };
export const BENCH = 12, IR = 13;
const STAT = { 0: 'pts', 1: 'blk', 2: 'stl', 3: 'ast', 6: 'reb', 11: 'to', 13: 'fgm', 14: 'fga', 15: 'ftm', 16: 'fta', 17: 'tpm', 18: 'tpa', 40: 'min', 42: 'gp' };
export const STAT_LABEL = { pts: 'PTS', reb: 'REB', ast: 'AST', stl: 'STL', blk: 'BLK', to: 'TO', fgm: 'FGM', fga: 'FGA', ftm: 'FTM', fta: 'FTA', tpm: '3PM' };
const SCORE_KEY = { 0: 'pts', 1: 'blk', 2: 'stl', 3: 'ast', 6: 'reb', 11: 'to', 13: 'fgm', 14: 'fga', 15: 'ftm', 16: 'fta', 17: 'tpm' };

export function currentSeason(now = new Date()) {
  // ESPN names a season by the year it ends; the new one is live from August.
  return now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();
}

async function get(url, filter) {
  const headers = { accept: 'application/json' };
  if (filter) headers['x-fantasy-filter'] = JSON.stringify(filter);
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (res.status === 401 || res.status === 403) throw new Error('This league is private. Ask the commissioner to make it viewable to the public (League settings → Basic).');
  if (res.status === 404) throw new Error('League not found: check the league ID and season.');
  if (!res.ok) throw new Error(`ESPN returned ${res.status}`);
  return res.json();
}

export const etDate = ms => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const dayNum = d => Date.parse(d + 'T00:00:00Z') / 864e5;

function box(stats) {
  if (!stats) return null;
  const o = {};
  for (const [k, name] of Object.entries(STAT)) if (stats[k] != null) o[name] = stats[k];
  return o;
}

// One stat line: fantasy points per game (league scoring, from ESPN), games, per-game box score.
function split(row) {
  if (!row) return null;
  const gp = row.stats?.[42] ?? (row.statSourceId === 1 ? null : 0);
  return { avg: row.appliedAverage ?? (gp ? row.appliedTotal / gp : null), tot: row.appliedTotal, gp, box: box(row.averageStats || row.stats) };
}

export function normPlayer(entry, season, extra = {}) {
  const p = entry.player || entry;
  const pick = (src, spl, yr = season) => (p.stats || []).find(s => s.seasonId === yr && s.statSourceId === src && s.statSplitTypeId === spl && !s.scoringPeriodId);
  const pos = [0, 1, 2, 3, 4].filter(s => p.eligibleSlots?.includes(s)).map(s => SLOT[s]);
  return {
    id: p.id, name: p.fullName, first: p.firstName, last: p.lastName, proTeamId: p.proTeamId,
    pos, slots: p.eligibleSlots || [], inj: p.injuryStatus && p.injuryStatus !== 'ACTIVE' ? p.injuryStatus : '',
    droppable: p.droppable !== false, own: p.ownership?.percentOwned ?? 0, ownChg: p.ownership?.percentChange ?? 0,
    newsAt: p.lastNewsDate || 0, onTeamId: entry.onTeamId || 0, status: entry.status || '',
    s: { cur: split(pick(0, 0)), l7: split(pick(0, 1)), l15: split(pick(0, 2)), l30: split(pick(0, 3)), proj: split(pick(1, 0)), ly: split(pick(0, 0, season - 1)) },
    ...extra,
  };
}

export async function loadSchedule(season) {
  const j = await get(`${HOST}/seasons/${season}?view=proTeamSchedules_wl`);
  const teams = {};
  for (const t of j.settings.proTeams) {
    const games = {};
    for (const [sp, gs] of Object.entries(t.proGamesByScoringPeriod || {})) {
      const g = gs[0];
      const home = g.homeProTeamId === t.id;
      games[sp] = { opp: home ? g.awayProTeamId : g.homeProTeamId, home, at: g.date };
    }
    teams[t.id] = { id: t.id, abbrev: t.abbrev, name: `${t.location} ${t.name}`, games };
  }
  // Scoring period = one NBA day; anchor the date math on the earliest game.
  let first = Infinity, firstDate;
  for (const t of Object.values(teams)) for (const [sp, g] of Object.entries(t.games)) if (+sp < first) { first = +sp; firstDate = etDate(g.at); }
  return { teams, first, firstDay: dayNum(firstDate) };
}

export async function loadLeague({ leagueId, season, sp }) {
  const base = `${HOST}/seasons/${season}/segments/0/leagues/${leagueId}`;
  const [league, fa] = await Promise.all([
    get(`${base}?view=mSettings&view=mTeam&view=mRoster&view=mMatchupScore&view=mStatus&scoringPeriodId=${sp}`),
    get(`${base}?view=kona_player_info&scoringPeriodId=${sp}`, {
      players: { filterStatus: { value: ['FREEAGENT', 'WAIVERS'] }, filterSlotIds: { value: [0, 1, 2, 3, 4, 5, 6, 11] }, limit: 200, sortPercOwned: { sortPriority: 1, sortAsc: false } },
    }),
  ]);
  const s = league.settings;
  const members = Object.fromEntries((league.members || []).map(m => [m.id, m.firstName ? `${m.firstName} ${m.lastName || ''}`.trim() : m.displayName]));
  const players = {};
  const teams = league.teams.map(t => {
    const roster = t.roster?.entries || [];
    for (const e of roster) players[e.playerId] = normPlayer({ ...e.playerPoolEntry, onTeamId: t.id, status: 'ONTEAM' }, season, { slot: e.lineupSlotId, acq: e.acquisitionType });
    return {
      id: t.id, name: t.name || `${t.location || ''} ${t.nickname || ''}`.trim(), abbrev: t.abbrev,
      owner: members[t.owners?.[0]] || '', logo: t.logo,
      record: t.record?.overall || {}, seed: t.playoffSeed, adds: t.transactionCounter?.matchupAcquisitionTotals || {},
      waiver: t.waiverRank, ids: roster.map(e => e.playerId),
    };
  });
  for (const x of fa.players) if (x.player?.proTeamId && x.player.active !== false) players[x.player.id] = normPlayer(x, season);
  const acq = s.acquisitionSettings;
  return {
    name: s.name, size: league.teams.length, status: league.status,
    scoring: Object.fromEntries(s.scoringSettings.scoringItems.filter(i => SCORE_KEY[i.statId]).map(i => [SCORE_KEY[i.statId], i.points])),
    type: s.scoringSettings.scoringType,
    slots: s.rosterSettings.lineupSlotCounts, lock: s.rosterSettings.lineupLocktimeType,
    acq: { rate: acq.matchupLimitPerScoringPeriod ? acq.matchupAcquisitionLimit : null, perMatchup: acq.matchupLimitPerScoringPeriod ? null : acq.matchupAcquisitionLimit, season: acq.acquisitionLimit, type: acq.acquisitionType, waiverHours: acq.waiverHours, days: acq.waiverProcessDays || [] },
    matchupPeriods: s.scheduleSettings.matchupPeriods, regularSeason: s.scheduleSettings.matchupPeriodCount, playoffTeams: s.scheduleSettings.playoffTeamCount,
    tradeDeadline: s.tradeSettings?.deadlineDate,
    schedule: (league.schedule || []).map(m => ({ mp: m.matchupPeriodId, home: side(m.home), away: side(m.away), winner: m.winner })),
    teams, players,
  };
}
const side = x => x && { teamId: x.teamId, pts: x.totalPoints, live: x.totalPointsLive, byDay: x.pointsByScoringPeriod || {} };

// Recent games for a few players (lazy: only when a player card or compare opens).
export async function loadGameLogs({ leagueId, season }, ids, n = 15) {
  const j = await get(`${HOST}/seasons/${season}/segments/0/leagues/${leagueId}?view=kona_playercard`, {
    players: { filterIds: { value: ids }, filterStatsForTopScoringPeriodIds: { value: n, additionalValue: [`00${season}`, `00${season - 1}`] } },
  });
  const out = {};
  for (const x of j.players) {
    out[x.player.id] = (x.player.stats || []).filter(s => s.statSplitTypeId === 5 && s.statSourceId === 0 && s.stats?.[40])
      .map(s => ({ season: s.seasonId, sp: s.scoringPeriodId, pts: s.appliedTotal, box: box(s.stats) }))
      .sort((a, b) => a.season - b.season || a.sp - b.sp);
  }
  return out;
}

export async function loadNews(playerId, limit = 6) {
  const res = await fetch(`${NEWS}?limit=${limit}&playerId=${playerId}`);
  if (!res.ok) return [];
  const j = await res.json();
  return (j.feed || []).filter(n => n.type !== 'Media').map(n => ({ at: Date.parse(n.published), headline: n.headline, story: (n.story || n.description || '').replace(/<[^>]+>/g, '') }));
}
