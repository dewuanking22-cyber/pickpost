// Community voting for sports games and market moves. TRACKING ONLY: no money, no odds, no payouts.
const db = require('../db');
const config = require('../config');
const clock = require('./clock');
const prices = require('./prices');
const { nextWindow, catalog } = require('./windows');
const { notify } = require('./notify');

const VCFG = config.votes;
const VOID_STATUS = /POSTPONED|CANCEL|FORFEIT|ABANDON|SUSPEND/i;

// ================= sports games =================
const isSoccer = (league) => VCFG.drawLeagues.includes(league);
const getGame = (id) => db.prepare('SELECT * FROM games WHERE id = ?').get(id);

function gameLocked(g, now = clock.now()) {
  return g.state !== 'pre' || now >= new Date(g.starts_at) || VOID_STATUS.test(g.status_name || '');
}
// admin line > ESPN line > community line
function lineFor(g, market) {
  const row = db.prepare('SELECT * FROM game_lines WHERE game_id = ? AND market = ?').get(g.id, market);
  if (row && row.source === 'admin') return { line: row.line, source: 'admin' };
  const espn = market === 'total' ? g.espn_total : g.espn_spread;
  if (espn !== null && espn !== undefined) return { line: espn, source: 'espn' };
  if (row) return { line: row.line, source: 'community' };
  return { line: null, source: null };
}
const validLine = (market, v) => Number.isFinite(v) && (market === 'total' ? v > 0 && v <= VCFG.maxCommunityLine : Math.abs(v) <= 100) && Math.abs(v * 2 - Math.round(v * 2)) < 1e-9 ; // halves only

function setGameLine(gameId, market, line, userId, source) {
  line = Number(line);
  if (!['total', 'spread'].includes(market) || !validLine(market, line)) return { error: market === 'total' ? 'Enter a total like 47.5.' : 'Enter a spread like -3.5 (from the home team’s view).' };
  if (source === 'admin') db.prepare(`INSERT INTO game_lines (game_id, market, line, source, set_by) VALUES (?, ?, ?, 'admin', ?)
    ON CONFLICT(game_id, market) DO UPDATE SET line = excluded.line, source = 'admin', set_by = excluded.set_by, created_at = datetime('now')`).run(gameId, market, line, userId);
  else db.prepare(`INSERT OR IGNORE INTO game_lines (game_id, market, line, source, set_by) VALUES (?, ?, ?, 'community', ?)`).run(gameId, market, line, userId);
  return { ok: true };
}

const MARKET_PICKS = { moneyline: ['home', 'away', 'draw'], total: ['over', 'under'], spread: ['home', 'away'] };

const MARKET_LABEL = { moneyline: 'Winner', total: 'Over/Under', spread: 'Spread' };
function castGameVote({ userId, gameId, market, pick, line }) {
  const g = getGame(gameId);
  if (!g) return { error: 'Unknown game.' };
  if (!MARKET_PICKS[market] || !MARKET_PICKS[market].includes(pick)) return { error: 'Invalid vote.' };
  if (pick === 'draw' && !isSoccer(g.league)) return { error: 'Draws are only available for soccer.' };
  if (gameLocked(g)) return { error: 'Voting is locked — this game has started.' };
  let ln = null;
  if (market !== 'moneyline') {
    let cur = lineFor(g, market);
    if (cur.line === null) { // community line: first voter sets it
      const r = setGameLine(g.id, market, line, userId, 'community');
      if (r.error) return { error: 'No line yet — enter one to be the first voter: ' + r.error };
      cur = lineFor(g, market);
    }
    ln = cur.line;
  }
  db.prepare(`INSERT INTO game_votes (user_id, game_id, market, pick, line) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, game_id, market) DO UPDATE SET pick = excluded.pick, line = excluded.line, updated_at = datetime('now')`).run(userId, g.id, market, pick, ln);
  const v = db.prepare('SELECT * FROM game_votes WHERE user_id = ? AND game_id = ? AND market = ?').get(userId, g.id, market);
  const text = `${voteDescr(g, v)} · ${MARKET_LABEL[market]}`; // keep anything already shared in sync with the changed vote
  db.prepare(`UPDATE posts SET pick = ? WHERE vote_id = ? AND kind = 'game_vote'`).run(text, v.id);
  db.prepare(`UPDATE messages SET card = json_set(card, '$.pick', ?) WHERE card IS NOT NULL AND json_extract(card, '$.voteId') = ? AND json_extract(card, '$.type') = 'game'`).run(text, v.id);
  return { ok: true };
}
function removeGameVote(userId, gameId, market) {
  const g = getGame(gameId); if (!g || gameLocked(g)) return { error: 'Voting is locked.' };
  const v = db.prepare('SELECT id FROM game_votes WHERE user_id = ? AND game_id = ? AND market = ?').get(userId, gameId, market);
  if (v) {
    db.prepare(`UPDATE posts SET deleted = 1 WHERE vote_id = ? AND kind = 'game_vote'`).run(v.id);
    db.prepare(`DELETE FROM messages WHERE card IS NOT NULL AND json_extract(card, '$.voteId') = ? AND json_extract(card, '$.type') = 'game'`).run(v.id);
  }
  db.prepare(`DELETE FROM game_votes WHERE user_id = ? AND game_id = ? AND market = ?`).run(userId, gameId, market);
  return { ok: true };
}

// Everything the card needs: per-market lines, counts + percentages, the viewer's votes.
function gameCard(g, viewerId) {
  const rows = db.prepare('SELECT market, pick, COUNT(*) n FROM game_votes WHERE game_id = ? GROUP BY market, pick').all(g.id);
  const count = (m, p) => (rows.find(r => r.market === m && r.pick === p) || { n: 0 }).n;
  const mine = {};
  if (viewerId) db.prepare('SELECT * FROM game_votes WHERE game_id = ? AND user_id = ?').all(g.id, viewerId).forEach(v => { mine[v.market] = v; });
  const soccer = isSoccer(g.league);
  const mk = (market, picks) => {
    const total = picks.reduce((s, p) => s + count(market, p), 0);
    return { total, picks: picks.map(p => ({ pick: p, n: count(market, p), pct: total ? Math.round((count(market, p) / total) * 100) : 0 })), mine: mine[market] ? { ...mine[market], text: voteDescr(g, mine[market]) } : null };
  };
  return {
    game: g, locked: gameLocked(g), soccer, void: VOID_STATUS.test(g.status_name || ''),
    moneyline: mk('moneyline', soccer ? ['away', 'draw', 'home'] : ['away', 'home']),
    total: { ...mk('total', ['over', 'under']), ...lineFor(g, 'total') },
    spread: { ...mk('spread', ['away', 'home']), ...lineFor(g, 'spread') },
  };
}

// ---- grading ----
function gradeVote(v, g) {
  const h = g.home_score, a = g.away_score;
  if (h === null || a === null) return null;
  if (v.market === 'moneyline') {
    const out = h > a ? 'home' : a > h ? 'away' : 'draw';
    if (out === 'draw' && !isSoccer(g.league)) return 'push'; // NFL-style tie
    return v.pick === out ? 'won' : 'lost';
  }
  if (v.market === 'total') {
    const s = h + a; if (s === v.line) return 'push';
    return (s > v.line ? 'over' : 'under') === v.pick ? 'won' : 'lost';
  }
  const diff = h - a + v.line; // home spread, e.g. -3.5: home must win by 4+
  if (diff === 0) return 'push';
  return (diff > 0 ? 'home' : 'away') === v.pick ? 'won' : 'lost';
}
const RES_TXT = { won: 'won ✅', lost: 'lost ❌', push: 'pushed ➖', void: 'was voided (game not played)' };
function applyResult(table, v, result, href, what) {
  db.prepare(`UPDATE ${table} SET result = ?, graded_at = datetime('now') WHERE id = ?`).run(result, v.id);
  db.prepare(`UPDATE posts SET status = ?, settled_at = datetime('now') WHERE vote_id = ? AND kind = ?`).run(result === 'void' ? 'push' : result, v.id, table === 'game_votes' ? 'game_vote' : 'market_vote');
  db.prepare(`UPDATE messages SET card = json_set(card, '$.status', ?) WHERE card IS NOT NULL AND json_extract(card, '$.voteId') = ? AND json_extract(card, '$.type') = ?`).run(result === 'void' ? 'push' : result, v.id, table === 'game_votes' ? 'game' : 'market');
  notify(v.user_id, 'vote', `Your vote ${RES_TXT[result]}: ${what}`, href);
}
const pickText = (g, v) => ({ home: g.home_name, away: g.away_name, draw: 'Draw', over: 'Over', under: 'Under' }[v.pick]);
function voteDescr(g, v) {
  if (v.market === 'moneyline') return `${pickText(g, v)} to win`;
  if (v.market === 'total') return `${pickText(g, v)} ${v.line}`;
  const l = v.pick === 'home' ? v.line : -v.line; return `${pickText(g, v)} ${l > 0 ? '+' : ''}${l}`;
}
function gradeGame(gameId) {
  const g = getGame(gameId); if (!g) return 0;
  const pending = db.prepare(`SELECT * FROM game_votes WHERE game_id = ? AND result = 'pending'`).all(g.id);
  let n = 0;
  const isVoid = VOID_STATUS.test(g.status_name || '') && g.state !== 'in';
  if (!isVoid && !(g.state === 'post' && g.completed)) return 0;
  for (const v of pending) {
    const r = isVoid ? 'void' : gradeVote(v, g);
    if (!r) continue;
    applyResult('game_votes', v, r, `/game/${g.id}`, `${voteDescr(g, v)} (${g.away_abbr || g.away_name} @ ${g.home_abbr || g.home_name})`);
    n++;
  }
  db.prepare('UPDATE games SET graded = 1 WHERE id = ?').run(g.id);
  return n;
}
function gradeAllGames() {
  let n = 0;
  db.prepare(`SELECT DISTINCT g.id FROM games g JOIN game_votes v ON v.game_id = g.id WHERE v.result = 'pending' AND (g.state = 'post' OR g.status_name != '')`).all()
    .forEach(r => { n += gradeGame(r.id); });
  return n;
}

// ================= market (trading) votes =================
const CAT = catalog();
async function resolveSymbol(sym) {
  sym = String(sym || '').trim();
  const key = Object.keys(CAT).find(k => k.toLowerCase() === sym.toLowerCase());
  if (key) return CAT[key];
  const up = sym.toUpperCase();
  if (!/^[A-Z]{1,5}$/.test(up)) return null;       // arbitrary lookups: US-listed tickers only
  let q = null; try { q = await prices.provider.quote(up); } catch (e) { return null; }
  if (!q) return null;
  return { kind: 'session', tz: 'America/New_York', open: '09:30', close: '16:00', holidays: 'nyse', category: 'stocks', market: 'us', symbol: up, label: `${up} · ${q.name}` };
}
function windowsFor(info, now = clock.now()) {
  return ['day', 'week'].map(tf => { const w = nextWindow(info, tf, now); return { timeframe: tf, starts: w.starts.toISOString(), ends: w.ends.toISOString(), label: w.label }; });
}
function marketCard(info, viewerId, now = clock.now()) {
  return windowsFor(info, now).map(w => {
    const rows = db.prepare('SELECT direction, COUNT(*) n, AVG(target_pct) avgt FROM market_votes WHERE symbol = ? AND timeframe = ? AND starts_at = ? GROUP BY direction').all(info.symbol, w.timeframe, w.starts);
    const up = (rows.find(r => r.direction === 'up') || {}).n || 0, down = (rows.find(r => r.direction === 'down') || {}).n || 0, tot = up + down;
    const mine = viewerId ? db.prepare('SELECT * FROM market_votes WHERE user_id = ? AND symbol = ? AND timeframe = ? AND starts_at = ?').get(viewerId, info.symbol, w.timeframe, w.starts) : null;
    return { ...w, up, down, total: tot, upPct: tot ? Math.round(up / tot * 100) : 0, downPct: tot ? 100 - Math.round(up / tot * 100) : 0, mine };
  });
}
const marketText = (v) => `${v.direction === 'up' ? '▲ Up' : '▼ Down'} ${v.timeframe === 'day' ? 'next session' : 'next week'}${v.target_pct ? ' by ≥ ' + v.target_pct + '%' : ''}`;
function castMarketVote({ userId, info, timeframe, starts, direction, target }) {
  const now = clock.now();
  if (!['day', 'week'].includes(timeframe)) return { error: 'Invalid timeframe.' };
  if (!['up', 'down'].includes(direction)) return { error: 'Invalid direction.' };
  const w = nextWindow(info, timeframe, now);
  if (new Date(starts).toISOString() !== w.starts.toISOString() || now >= w.starts) return { error: 'This round is locked — it has already started. Vote on the next round.' };
  let t = null;
  if (target !== undefined && target !== null && String(target).trim() !== '') {
    t = Number(String(target).replace('%', ''));
    if (!Number.isFinite(t) || t <= 0 || t > (timeframe === 'week' ? 50 : 25)) return { error: 'Target % must be between 0 and ' + (timeframe === 'week' ? 50 : 25) + '.' };
    t = Math.round(t * 100) / 100;
  }
  db.prepare(`INSERT INTO market_votes (user_id, symbol, label, timeframe, starts_at, ends_at, direction, target_pct) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, symbol, timeframe, starts_at) DO UPDATE SET direction = excluded.direction, target_pct = excluded.target_pct`)
    .run(userId, info.symbol, info.label, timeframe, w.starts.toISOString(), w.ends.toISOString(), direction, t);
  const v = db.prepare('SELECT * FROM market_votes WHERE user_id = ? AND symbol = ? AND timeframe = ? AND starts_at = ?').get(userId, info.symbol, timeframe, w.starts.toISOString());
  const text = marketText(v);
  db.prepare(`UPDATE posts SET pick = ? WHERE vote_id = ? AND kind = 'market_vote'`).run(text, v.id);
  db.prepare(`UPDATE messages SET card = json_set(card, '$.pick', ?) WHERE card IS NOT NULL AND json_extract(card, '$.voteId') = ? AND json_extract(card, '$.type') = 'market'`).run(text, v.id);
  return { ok: true, starts: w.starts.toISOString() };
}
function removeMarketVote(userId, symbol, timeframe, starts) {
  const r = db.prepare(`SELECT * FROM market_votes WHERE user_id = ? AND symbol = ? AND timeframe = ? AND starts_at = ?`).get(userId, symbol, timeframe, String(starts));
  if (!r) return { error: 'No vote to remove.' };
  if (clock.now() >= new Date(r.starts_at)) return { error: 'This round is locked.' };
  db.prepare('DELETE FROM market_votes WHERE id = ?').run(r.id);
  db.prepare(`UPDATE posts SET deleted = 1 WHERE vote_id = ? AND kind = 'market_vote'`).run(r.id);
  return { ok: true };
}
function gradeMarketResult(v, pct) {
  const dirUp = v.direction === 'up';
  if (Math.abs(pct) < 1e-9) return 'push';
  const rightWay = dirUp ? pct > 0 : pct < 0;
  if (!rightWay) return 'lost';
  if (v.target_pct) return Math.abs(pct) >= v.target_pct ? 'won' : 'lost';
  return 'won';
}
async function gradeMarketVotes(now = clock.now()) {
  const cutoff = new Date(now.getTime() - VCFG.gradeDelayMinutes * 60000).toISOString();
  const groups = db.prepare(`SELECT symbol, timeframe, starts_at, ends_at FROM market_votes WHERE result = 'pending' AND ends_at <= ? GROUP BY symbol, timeframe, starts_at, ends_at`).all(cutoff);
  let graded = 0;
  for (const gr of groups) {
    let out;
    try { out = await prices.provider.between(gr.symbol, new Date(gr.starts_at).getTime(), new Date(gr.ends_at).getTime()); }
    catch (e) {
      if ((now - new Date(gr.ends_at)) > VCFG.voidAfterDays * 86400e3) out = { void: true }; else continue; // retry next cycle
    }
    const votes = db.prepare(`SELECT * FROM market_votes WHERE result = 'pending' AND symbol = ? AND timeframe = ? AND starts_at = ?`).all(gr.symbol, gr.timeframe, gr.starts_at);
    for (const v of votes) {
      const href = '/t/' + encodeURIComponent(v.symbol);
      if (out.void) { applyResult('market_votes', v, 'void', href, `${v.label} ${v.direction}`); graded++; continue; }
      const pct = ((out.end - out.start) / out.start) * 100;
      const r = gradeMarketResult(v, pct);
      db.prepare('UPDATE market_votes SET start_price = ?, end_price = ?, change_pct = ? WHERE id = ?').run(out.start, out.end, Math.round(pct * 1000) / 1000, v.id);
      applyResult('market_votes', v, r, href, `${v.label} ${v.direction === 'up' ? '▲ Up' : '▼ Down'}${v.target_pct ? ' ' + v.target_pct + '%' : ''} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`);
      graded++;
    }
  }
  return graded;
}

// ================= records & leaderboards =================
const acc = (w, l) => (w + l ? Math.round((w / (w + l)) * 1000) / 10 : null);
function voteRecord(userId) {
  const f = (table) => { const r = db.prepare(`SELECT SUM(result='won') w, SUM(result='lost') l, SUM(result='push') p, SUM(result='pending') open FROM ${table} WHERE user_id = ?`).get(userId); const w = r.w || 0, l = r.l || 0; return { w, l, p: r.p || 0, open: r.open || 0, acc: acc(w, l) }; };
  return { games: f('game_votes'), markets: f('market_votes') };
}
function boardGames({ league, market } = {}) {
  const where = [`v.result IN ('won','lost','push')`]; const p = {};
  if (league) { where.push('g.league = @league'); p.league = league; }
  if (market) { where.push('v.market = @market'); p.market = market; }
  return db.prepare(`SELECT u.username, SUM(v.result='won') w, SUM(v.result='lost') l, SUM(v.result='push') p FROM game_votes v JOIN games g ON g.id = v.game_id JOIN users u ON u.id = v.user_id
    WHERE u.banned = 0 AND ${where.join(' AND ')} GROUP BY v.user_id`).all(p).map(r => ({ ...r, settled: r.w + r.l + r.p, acc: acc(r.w, r.l) }))
    .filter(r => r.settled >= VCFG.leaderboardMin && r.acc !== null).sort((a, b) => b.acc - a.acc || b.w - a.w);
}
function boardMarkets({ timeframe } = {}) {
  const where = [`v.result IN ('won','lost','push')`]; const p = {};
  if (timeframe) { where.push('v.timeframe = @tf'); p.tf = timeframe; }
  return db.prepare(`SELECT u.username, SUM(v.result='won') w, SUM(v.result='lost') l, SUM(v.result='push') p FROM market_votes v JOIN users u ON u.id = v.user_id
    WHERE u.banned = 0 AND ${where.join(' AND ')} GROUP BY v.user_id`).all(p).map(r => ({ ...r, settled: r.w + r.l + r.p, acc: acc(r.w, r.l) }))
    .filter(r => r.settled >= VCFG.leaderboardMin && r.acc !== null).sort((a, b) => b.acc - a.acc || b.w - a.w);
}

let timer;
function start() {
  if (timer) return;
  const tick = () => { try { gradeAllGames(); } catch (e) { console.error('grade games', e.message); } gradeMarketVotes().catch(e => console.error('grade markets', e.message)); };
  timer = setInterval(tick, 60000); timer.unref(); setTimeout(tick, 5000).unref();
}
module.exports = {
  isSoccer, getGame, gameLocked, lineFor, setGameLine, castGameVote, removeGameVote, gameCard, gradeVote, gradeGame, gradeAllGames, voteDescr,
  resolveSymbol, catalog: () => CAT, windowsFor, marketCard, castMarketVote, removeMarketVote, marketText, gradeMarketResult, gradeMarketVotes,
  voteRecord, boardGames, boardMarkets, start, VOID_STATUS,
};
