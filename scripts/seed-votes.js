// Demo votes: `npm run seed:votes` (after `npm run seed` and once the scoreboard has loaded some games).
// Casts a spread of votes from the demo accounts on today's games and the featured markets so the split bars look alive.
const db = require('../db');
const votes = require('../services/votes');
const users = db.prepare(`SELECT id, username FROM users WHERE username != 'admin' ORDER BY id`).all();
if (!users.length) { console.error('Run `npm run seed` first.'); process.exit(1); }
// A little finished history (clearly fictional teams) so records and leaderboards have something to show.
const fake = [['Riverton Rockets', 'Lakeside Lynx', 'nba', 112, 104], ['Harbor City Gulls', 'Mesa Mustangs', 'nba', 98, 101], ['Granite Peaks', 'Ironwood Bears', 'nfl', 27, 20],
  ['Coastal Kings', 'Valley Vipers', 'nfl', 17, 24], ['Northgate FC', 'Southport United', 'epl', 1, 1], ['Redwood Rangers', 'Bayview Bulls', 'nhl', 4, 2]];
fake.forEach(([home, away, league, hs, as], i) => {
  const id = `demo-${i + 1}`;
  if (db.prepare('SELECT 1 FROM games WHERE id = ?').get(id)) return;
  db.prepare(`INSERT INTO games (id, league, event_id, starts_at, state, status_name, detail, completed, home_id, home_name, home_abbr, home_score, away_id, away_name, away_abbr, away_score, espn_spread, espn_total)
    VALUES (?, ?, ?, ?, 'pre', '', '', 0, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?)`).run(id, league, id, new Date(Date.now() + 3600e3).toISOString(), 9000 + i, home, home.slice(0, 3).toUpperCase(), 9100 + i, away, away.slice(0, 3).toUpperCase(), league === 'nfl' ? -3.5 : league === 'nba' ? -2.5 : null, league === 'nfl' ? 44.5 : league === 'nba' ? 213.5 : league === 'epl' ? 2.5 : 5.5);
  users.forEach((u, ui) => {
    votes.castGameVote({ userId: u.id, gameId: id, market: 'moneyline', pick: votes.isSoccer(league) ? ['home', 'away', 'draw'][ui % 3] : (ui + i) % 3 ? 'home' : 'away' });
    votes.castGameVote({ userId: u.id, gameId: id, market: 'total', pick: (ui + i) % 2 ? 'over' : 'under' });
    if (league !== 'epl') votes.castGameVote({ userId: u.id, gameId: id, market: 'spread', pick: (ui * 2 + i) % 3 ? 'home' : 'away' });
  });
  db.prepare(`UPDATE games SET starts_at = ?, state = 'post', completed = 1, status_name = 'STATUS_FINAL', detail = 'Final', home_score = ?, away_score = ? WHERE id = ?`).run(new Date(Date.now() - (24 + i * 7) * 3600e3).toISOString(), hs, as, id);
  votes.gradeGame(id);
});
for (let i = 0; i < 8; i++) users.forEach((u, ui) => {
  if ((i + ui) % 5 === 4) return;
  db.prepare(`INSERT OR IGNORE INTO market_votes (user_id, symbol, label, timeframe, starts_at, ends_at, direction, result, change_pct) VALUES (?, ?, ?, 'day', ?, ?, ?, ?, ?)`)
    .run(u.id, ['^GSPC', 'BTC-USD', 'AAPL', 'EURUSD=X'][(i + ui) % 4], ['S&P 500', 'Bitcoin (BTC)', 'AAPL', 'EUR/USD'][(i + ui) % 4], `2026-10-${10 + i}T14:30:00.000Z`, `2026-10-${10 + i}T21:00:00.000Z`, 'up', (i * 3 + ui) % 7 < 4 ? 'won' : 'lost', ((i * 3 + ui) % 7 < 4 ? 1 : -1) * (0.3 + ((i + ui) % 5) / 4));
});
const games = db.prepare(`SELECT * FROM games WHERE state = 'pre' AND starts_at > datetime('now') ORDER BY starts_at LIMIT 16`).all();
if (!games.length) console.log('No upcoming games in the database yet (is the scoreboard loaded? set MARKET_DATA=on and wait a few seconds).');
let n = 0;
games.forEach((g, gi) => {
  users.forEach((u, ui) => {
    const r = (gi * 7 + ui * 3) % 10;
    if (r < 3) return;
    const ml = votes.isSoccer(g.league) ? ['home', 'away', 'draw'][(gi + ui) % 3] : (r % 3 ? 'home' : 'away');
    n += votes.castGameVote({ userId: u.id, gameId: g.id, market: 'moneyline', pick: ml }).ok ? 1 : 0;
    n += votes.castGameVote({ userId: u.id, gameId: g.id, market: 'total', pick: r % 2 ? 'over' : 'under', line: 47.5 }).ok ? 1 : 0;
    n += votes.castGameVote({ userId: u.id, gameId: g.id, market: 'spread', pick: (r + ui) % 2 ? 'home' : 'away', line: -3.5 }).ok ? 1 : 0;
  });
});
const CAT = votes.catalog();
const config = require('../config');
for (const f of config.votes.featured) {
  const info = CAT[f.symbol]; if (!info) continue;
  votes.windowsFor(info).forEach((w, wi) => users.forEach((u, ui) => {
    if ((ui + wi) % 4 === 3) return;
    votes.castMarketVote({ userId: u.id, info, timeframe: w.timeframe, starts: w.starts, direction: (ui * 3 + wi + info.symbol.length) % 5 < 3 ? 'up' : 'down', target: ui % 3 === 0 && wi === 0 ? 0.5 : '' });
    n++;
  }));
}
console.log(`Cast ${n} demo votes.`);
