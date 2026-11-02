// Live scoreboard + game cache from ESPN's public scoreboard JSON (unofficial, no key). Text only - no team logos.
// Every poll upserts rows into the `games` table; votes are graded from those rows when a game goes final.
const db = require('../db');
const config = require('../config');
const clock = require('./clock');
const cfg = config.data;

const API = 'https://site.api.espn.com/apis/site/v2/sports';
const leagueByKey = Object.fromEntries(cfg.leagues.map(l => [l.key, l]));
let lastError = {}, lastRefresh = null;

async function getJson(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
  try { const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'PickPost/1.0' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}

// ESPN lists the spread as text ("SEA -3") plus a number; derive the HOME team's spread robustly.
function parseOdds(c, homeAbbr, awayAbbr, soccer) {
  const o = (c.odds || [])[0];
  if (!o) return { spread: null, total: null };
  let spread = null;
  // For soccer ESPN's "details" is the money line ("DEP -110"), not a handicap - never read it as a spread.
  const m = soccer ? null : /^([A-Za-z.&'\- ]+?)\s+([+-]?\d+(\.\d+)?)$/.exec(String(o.details || '').trim());
  if (m) { const v = Math.abs(parseFloat(m[2])); const fav = m[1].trim().toUpperCase(); if (v <= 60) spread = fav === String(homeAbbr).toUpperCase() ? -v : fav === String(awayAbbr).toUpperCase() ? v : null; }
  else if (!soccer && /^EVEN$|^PK$/i.test(String(o.details || '').trim())) spread = 0;
  if (spread === null && typeof o.spread === 'number' && Math.abs(o.spread) <= (soccer ? 3 : 60)) spread = o.spread;
  const total = typeof o.overUnder === 'number' && o.overUnder > 0 && o.overUnder < 500 ? o.overUnder : null;
  return { spread, total };
}
function parseEvent(l, e) {
  const c = (e.competitions || [])[0] || {};
  const teams = c.competitors || [];
  const home = teams.find(x => x.homeAway === 'home') || teams[0] || {}, away = teams.find(x => x.homeAway === 'away') || teams[1] || {};
  const st = (e.status && e.status.type) || {};
  const nm = (x) => (x.team && (x.team.shortDisplayName || x.team.displayName)) || '?';
  const ab = (x) => (x.team && x.team.abbreviation) || '';
  const rec = (x) => ((x.records || [])[0] || {}).summary || null;
  const sc = (x) => (st.state === 'pre' || x.score === undefined || x.score === '' ? null : Number(x.score));
  const odds = parseOdds(c, ab(home), ab(away), config.votes.drawLeagues.includes(l.key));
  return {
    id: `${l.key}-${e.id}`, league: l.key, event_id: String(e.id), starts_at: new Date(e.date).toISOString(),
    state: st.state || 'pre', status_name: st.name || '', detail: st.shortDetail || st.detail || '', completed: st.completed ? 1 : 0,
    home_id: home.team && String(home.team.id), home_name: nm(home), home_abbr: ab(home), home_score: sc(home), home_record: rec(home),
    away_id: away.team && String(away.team.id), away_name: nm(away), away_abbr: ab(away), away_score: sc(away), away_record: rec(away),
    venue: (c.venue && c.venue.fullName) || null, broadcast: ((c.broadcasts || [])[0] || {}).names ? c.broadcasts[0].names.join(', ') : null,
    espn_spread: odds.spread, espn_total: odds.total,
  };
}
const upsert = db.prepare(`INSERT INTO games (id, league, event_id, starts_at, state, status_name, detail, completed, home_id, home_name, home_abbr, home_score, away_id, away_name, away_abbr, away_score, home_record, away_record, venue, broadcast, espn_spread, espn_total, updated_at)
  VALUES (@id, @league, @event_id, @starts_at, @state, @status_name, @detail, @completed, @home_id, @home_name, @home_abbr, @home_score, @away_id, @away_name, @away_abbr, @away_score, @home_record, @away_record, @venue, @broadcast, @espn_spread, @espn_total, datetime('now'))
  ON CONFLICT(id) DO UPDATE SET starts_at = excluded.starts_at, state = excluded.state, status_name = excluded.status_name, detail = excluded.detail, completed = excluded.completed,
    home_score = excluded.home_score, away_score = excluded.away_score, home_record = COALESCE(excluded.home_record, home_record), away_record = COALESCE(excluded.away_record, away_record),
    venue = COALESCE(excluded.venue, venue), broadcast = COALESCE(excluded.broadcast, broadcast),
    espn_spread = COALESCE(excluded.espn_spread, espn_spread), espn_total = COALESCE(excluded.espn_total, espn_total), updated_at = datetime('now')`);
const saveAll = db.transaction((rows) => rows.forEach(r => upsert.run(r)));

async function fetchLeague(l, dates) {
  const j = await getJson(`${API}/${l.path}/scoreboard${dates ? '?dates=' + dates : ''}`);
  return (j.events || []).map(e => parseEvent(l, e));
}
async function refresh() {
  if (!cfg.enabled) return;
  await Promise.all(cfg.leagues.map(async (l) => {
    try { saveAll(await fetchLeague(l)); delete lastError[l.key]; } catch (e) { lastError[l.key] = e.message; }
  }));
  lastRefresh = new Date().toISOString();
  await reconcile().catch(() => {});
  try { require('./votes').gradeAllGames(); } catch (e) { console.error('grading', e.message); }
}
// Games we know about that never reached "final" in the live feed (server was down, date rolled over):
// ask ESPN for that day's board so votes can still be graded.
async function reconcile() {
  const stale = db.prepare(`SELECT DISTINCT league, substr(datetime(starts_at, '-6 hours'), 1, 10) AS day FROM games g
    WHERE state != 'post' AND starts_at < datetime('now', '-6 hours') AND starts_at > datetime('now', '-10 days')
      AND EXISTS (SELECT 1 FROM game_votes v WHERE v.game_id = g.id AND v.result = 'pending') LIMIT 8`).all();
  for (const s of stale) {
    const l = leagueByKey[s.league]; if (!l) continue;
    try { saveAll(await fetchLeague(l, s.day.replace(/-/g, ''))); } catch (e) { /* retry next cycle */ }
  }
}
let timer;
function start() {
  if (!cfg.enabled || timer) return;
  refresh().catch(() => {});
  timer = setInterval(() => refresh().catch(() => {}), cfg.scoresRefreshSeconds * 1000);
  timer.unref();
}

// ---- reading ----
const toGame = (r) => ({
  ...r, leagueLabel: (leagueByKey[r.league] || {}).label || r.league, date: r.starts_at, matchup: `${r.away_name} vs ${r.home_name}`,
  home: { id: r.home_id, name: r.home_name, abbr: r.home_abbr, score: r.home_score === null ? '' : String(r.home_score), winner: r.state === 'post' && r.home_score > r.away_score },
  away: { id: r.away_id, name: r.away_name, abbr: r.away_abbr, score: r.away_score === null ? '' : String(r.away_score), winner: r.state === 'post' && r.away_score > r.home_score },
});
// "Today's slate": live games, anything starting within the next 36h, and games finished in the last 20h.
function slate(leagueKey) {
  const rows = db.prepare(`SELECT * FROM games WHERE (state = 'in' OR (starts_at BETWEEN @a AND @b)) ${leagueKey ? 'AND league = @l' : ''}
    ORDER BY CASE state WHEN 'in' THEN 0 WHEN 'pre' THEN 1 ELSE 2 END, starts_at`).all({
    a: new Date(clock.now().getTime() - 20 * 3600e3).toISOString(), b: new Date(clock.now().getTime() + 36 * 3600e3).toISOString(), l: leagueKey || null }).map(toGame);
  return rows;
}
function snapshot() {
  const all = slate();
  const leagues = cfg.leagues.map(l => {
    const games = all.filter(g => g.league === l.key);
    return { key: l.key, label: l.label, games, live: games.filter(g => g.state === 'in').length, error: lastError[l.key] || null, loaded: true };
  });
  return { enabled: cfg.enabled, leagues, live: all.filter(g => g.state === 'in'), total: all.length, updatedAt: lastRefresh || new Date().toISOString() };
}
const gameById = (id) => { const r = db.prepare('SELECT * FROM games WHERE id = ?').get(id); return r ? toGame(r) : null; };

// ---- teams (fetched on demand, cached) ----
const tcache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = tcache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v;
  try { const v = await fn(); tcache.set(key, { at: Date.now(), v }); return v; } catch (e) { if (hit) return hit.v; throw e; }
}
async function teamList(leagueKey) {
  const l = leagueByKey[leagueKey]; if (!l || !cfg.enabled) return [];
  return cached('teams:' + leagueKey, 24 * 3600e3, async () => {
    const j = await getJson(`${API}/${l.path}/teams?limit=100`);
    const ts = (((j.sports || [])[0] || {}).leagues || [])[0];
    return ((ts && ts.teams) || []).map(t => ({ id: String(t.team.id), name: t.team.displayName, abbr: t.team.abbreviation })).sort((a, b) => a.name.localeCompare(b.name));
  }).catch(() => []);
}
async function teamInfo(leagueKey, id) {
  const l = leagueByKey[leagueKey]; if (!l) return null;
  const local = db.prepare(`SELECT home_id, home_name, home_abbr, away_id, away_name, away_abbr FROM games WHERE league = ? AND (home_id = ? OR away_id = ?) LIMIT 1`).get(leagueKey, id, id);
  let info = local ? (local.home_id === id ? { name: local.home_name, abbr: local.home_abbr } : { name: local.away_name, abbr: local.away_abbr }) : null;
  let extra = {};
  if (cfg.enabled) {
    try {
      extra = await cached(`team:${leagueKey}:${id}`, 10 * 60e3, async () => {
        const [t, s] = await Promise.all([getJson(`${API}/${l.path}/teams/${id}`), getJson(`${API}/${l.path}/teams/${id}/schedule`).catch(() => null)]);
        const tm = t.team || {};
        const events = ((s && s.events) || []).map(e => {
          const c = (e.competitions || [])[0] || {}; const me = (c.competitors || []).find(x => x.team && String(x.team.id) === String(id)); const opp = (c.competitors || []).find(x => x !== me) || {};
          const sc = (x) => x && x.score ? (x.score.displayValue || x.score.value || x.score) : '';
          return { id: `${l.key}-${e.id}`, date: e.date, name: e.shortName || e.name, home: me && me.homeAway === 'home', opp: (opp.team && opp.team.displayName) || '', state: (c.status && c.status.type && c.status.type.state) || 'pre',
            detail: (c.status && c.status.type && (c.status.type.shortDetail || c.status.type.detail)) || '', score: sc(me), oppScore: sc(opp), winner: me && me.winner };
        });
        return { name: tm.displayName, abbr: tm.abbreviation, record: ((tm.record || {}).items || [])[0] && tm.record.items[0].summary, standing: tm.standingSummary, events };
      });
    } catch (e) { /* offline: fall back to local data */ }
  }
  if (!info && !extra.name) return null;
  return { id, league: leagueKey, leagueLabel: l.label, name: extra.name || info.name, abbr: extra.abbr || (info && info.abbr) || '', record: extra.record || null, standing: extra.standing || null, events: extra.events || [] };
}
module.exports = { start, refresh, snapshot, slate, gameById, toGame, teamList, teamInfo, parseEvent, saveAll, leagueByKey };
