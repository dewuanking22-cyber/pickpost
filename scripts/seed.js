// Demo data: `npm run seed`. Creates sample users, posts, groups, chat and reactions so a fresh install looks alive.
// Refuses to run on a database that already has users. All demo accounts use the password "demo12345" -
// delete them (or wipe the data/ folder) before going live.
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');

if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) { console.error('Database already has users - refusing to seed.'); process.exit(1); }
const hash = bcrypt.hashSync('demo12345', 10);
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
const user = db.prepare('INSERT INTO users (username, password_hash, bio, is_admin, created_at) VALUES (?, ?, ?, ?, ?)');
const people = [
  ['admin', 'Site admin. Keep it civil.', 1], ['MarketMaya', 'Swing trader. Macro + charts.', 0], ['QuantQuincy', 'Options and futures. Risk first.', 0],
  ['CryptoKai', 'On-chain nerd. Not a financial advisor.', 0], ['SharpSam', 'Sports picks with units discipline.', 0], ['FXFiona', 'Forex sessions: London + NY.', 0], ['RookieRay', 'Learning in public.', 0],
];
const id = {};
people.forEach(([n, bio, adm], i) => { id[n] = Number(user.run(n, hash, bio, adm, ago(500 - i)).lastInsertRowid); });

const post = db.prepare(`INSERT INTO posts (user_id, group_id, category, exchange, subject, pick, odds, units, entry, target, stop, timeframe, reasoning, status, settled_at, created_at)
  VALUES (@u, @g, @c, @x, @s, @p, @o, @un, @e, @t, @st, @tf, @r, @status, @sa, @ca)`);
const mk = (o) => Number(post.run({ g: null, x: null, o: null, un: null, e: null, t: null, st: null, tf: null, status: 'open', sa: null, ...o }).lastInsertRowid);
const T = (u, c, s, p, e, t, st, tf, r, hrs, status = 'open', x = null, g = null) => mk({ u: id[u], c, s, p, e, t, st, tf, r, ca: ago(hrs), status, sa: status === 'open' ? null : ago(hrs - 1), x, g });
const S = (u, s, p, o, un, r, hrs, status = 'open', g = null) => mk({ u: id[u], c: 'sports', s, p, o, un, r, ca: ago(hrs), status, sa: status === 'open' ? null : ago(hrs - 1), g, x: null });

const ids = [];
ids.push(T('MarketMaya', 'stocks', 'NVDA', 'Long', 118.5, 131, 112, 'Swing', 'Holding above the 50-day with volume expanding on green days. Earnings catalyst in two weeks; stop under the last higher low.', 3, 'open', 'us'));
ids.push(T('MarketMaya', 'stocks', 'AAPL', 'Long', 224, 236, 219, 'Swing', 'Base breakout on the daily. Risk/reward about 2.4:1.', 70, 'won', 'us'));
ids.push(T('MarketMaya', 'stocks', 'TSLA', 'Short', 262, 240, 272, 'Day trade', 'Rejected at the gap fill. Quick scalp idea only.', 96, 'lost', 'us'));
ids.push(T('MarketMaya', 'stocks', 'SHOP', 'Long', 92, 104, 88, 'Swing', 'Toronto-listed ADR strength after earnings. Watching relative strength vs TSX.', 120, 'won', 'ca'));
ids.push(T('QuantQuincy', 'options', 'SPY 600C 12/19', 'Long Call', 6.2, 9.5, 4.1, 'Swing', 'Cheap upside call into year-end seasonality. Max loss is the premium, sized small.', 5, 'open', 'us'));
ids.push(T('QuantQuincy', 'futures', 'ES', 'Short', 6020, 5960, 6045, 'Day trade', 'Failed breakout at overnight high; targeting the VWAP retest.', 30, 'won', 'us'));
ids.push(T('QuantQuincy', 'futures', 'NQ', 'Long', 21050, 21400, 20900, 'Day trade', 'Opening range reclaim. Tight stop below the open.', 52, 'won'));
ids.push(T('QuantQuincy', 'options', 'AMZN 230P 11/29', 'Long Put', 3.1, 5.5, 1.8, 'Day trade', 'Hedge idea into the print. Not sizing this one big.', 80, 'lost', 'us'));
ids.push(T('CryptoKai', 'crypto', 'BTC', 'Long', 76500, 82000, 73500, 'Swing', 'Reclaimed the weekly pivot. ETF flows positive; funding is neutral so I am not worried about a squeeze.', 2, 'open', 'crypto'));
ids.push(T('CryptoKai', 'crypto', 'ETH', 'Long', 2240, 2500, 2120, 'Swing', 'ETH/BTC bouncing off multi-year support.', 40, 'won', 'crypto'));
ids.push(T('CryptoKai', 'crypto', 'SOL', 'Short', 175, 150, 185, 'Swing', 'Lower highs into resistance, unlock schedule is a headwind.', 100, 'lost', 'crypto'));
ids.push(T('FXFiona', 'forex', 'EUR/USD', 'Long', 1.1190, 1.1300, 1.1130, 'Day trade', 'London session sweep of Asian lows, then reclaim. Targeting the prior day high.', 6, 'open', 'forex'));
ids.push(T('FXFiona', 'forex', 'USD/JPY', 'Short', 158.2, 156.5, 159.0, 'Swing', 'Intervention risk near 160 plus overbought RSI on the daily.', 60, 'won', 'jp'));
ids.push(T('FXFiona', 'forex', 'GBP/USD', 'Long', 1.2950, 1.3080, 1.2890, 'Swing', 'BoE hawkish hold. Break above 1.2950 resistance.', 90, 'won', 'uk'));
ids.push(T('FXFiona', 'stocks', 'EWG', 'Long', 35.2, 37, 34.4, 'Swing', 'DAX momentum is strong while Frankfurt is outperforming. Using the ETF as a proxy.', 20, 'open', 'de'));
ids.push(S('SharpSam', 'Cowboys vs Cardinals', 'Cardinals +3.5', '-110', 1, 'Cardinals defense is healthy, Cowboys are on a short week. Taking the hook.', 4, 'open'));
ids.push(S('SharpSam', 'Celtics vs Heat', 'Celtics -6.5', '-108', 2, 'Rest advantage and the Heat are missing their starting wing. Net rating gap is real.', 28, 'won'));
ids.push(S('SharpSam', 'Chiefs vs Bills', 'Under 47.5', '-110', 1, 'Both defenses rank top 8 in EPA/play; wind is up.', 52, 'won'));
ids.push(S('SharpSam', 'Lakers vs Suns', 'Suns ML', '+135', 0.5, 'Value on the underdog; Lakers on the second night of a back-to-back.', 76, 'lost'));
ids.push(S('SharpSam', 'Arsenal vs Liverpool', 'Draw', '+260', 0.5, 'Two compact sides, low xG matchup at Anfield.', 100, 'push'));
ids.push(S('RookieRay', 'Yankees vs Red Sox', 'Red Sox ML', '+120', 1, 'Starter has a better K-BB% over the last 5 starts.', 8, 'open'));

// groups with channels
const grp = db.prepare('INSERT INTO user_groups (owner_id, name, description, privacy, invite_code, created_at) VALUES (?, ?, ?, ?, ?, ?)');
const mem = db.prepare('INSERT INTO group_members (group_id, user_id, role, status, created_at) VALUES (?, ?, ?, ?, ?)');
const chan = db.prepare('INSERT INTO group_channels (group_id, name, topic, position, exchange) VALUES (?, ?, ?, ?, ?)');
const msg = db.prepare('INSERT INTO messages (channel_id, user_id, body, created_at) VALUES (?, ?, ?, ?)');
function makeGroup(owner, name, desc, privacy, members) {
  const g = Number(grp.run(id[owner], name, desc, privacy, require('crypto').randomBytes(12).toString('hex'), ago(300)).lastInsertRowid);
  mem.run(g, id[owner], 'owner', 'active', ago(300));
  members.forEach(([n, role, status]) => mem.run(g, id[n], role, status || 'active', ago(200)));
  const chans = {};
  config.defaultChannels.forEach((c, i) => { chans[c.name] = Number(chan.run(g, c.name, c.topic || '', i, c.exchange || null).lastInsertRowid); });
  return { g, chans };
}
const lounge = makeGroup('MarketMaya', 'Day Traders Lounge', 'Open community for stocks, crypto, forex and futures chat. Be kind, show your risk.', 'public', [['QuantQuincy', 'mod'], ['CryptoKai', 'member'], ['FXFiona', 'member'], ['RookieRay', 'member']]);
const sharp = makeGroup('SharpSam', 'Sharp Sports Club', 'Private: units discipline, line shopping talk and daily card breakdowns.', 'private', [['RookieRay', 'member', 'pending'], ['MarketMaya', 'member']]);
T('CryptoKai', 'crypto', 'LINK', 'Long', 14.1, 17, 13.2, 'Swing', 'Posting this one just for the lounge: accumulation range breakout.', 12, 'open', 'crypto', lounge.g);
T('QuantQuincy', 'futures', 'CL', 'Long', 68.4, 71.5, 67.2, 'Day trade', 'Inventory draw expectation; clean level below.', 16, 'open', null, lounge.g);
S('SharpSam', 'Sunday card', 'Parlay is a trap - singles only', '-110', 1, 'Members-only reminder: stick to singles and unit sizing. Weekly card in #sports-picks.', 10, 'open', sharp.g);
const say = (ch, who, body, h) => msg.run(ch, id[who], body, ago(h));
say(lounge.chans.general, 'MarketMaya', 'Welcome everyone! Post ideas in the feed, banter here. Always include a stop.', 5);
say(lounge.chans.general, 'RookieRay', 'New here — how do you size positions?', 4.5);
say(lounge.chans.general, 'QuantQuincy', '1% account risk per idea is a decent starting point. Stop first, size second.', 4.4);
say(lounge.chans.crypto, 'CryptoKai', 'BTC reclaiming the weekly pivot, funding still flat.', 2);
say(lounge.chans.crypto, 'FXFiona', 'DXY softening helps. Watching 78k.', 1.9);
say(lounge.chans.forex, 'FXFiona', 'London open sweep on EUR/USD, then reclaim — classic.', 6);
say(lounge.chans.futures, 'QuantQuincy', 'ES holding the overnight mid, VWAP is the line in the sand.', 3);
say(sharp.chans['sports-picks'], 'SharpSam', 'Card is posted. Singles only this week.', 9);

// reactions, comments, follows, friends
const react = db.prepare('INSERT OR REPLACE INTO reactions (user_id, post_id, kind) VALUES (?, ?, ?)');
const kinds = ['like', 'bull', 'bear', 'fire', 'money'];
ids.forEach((pid, i) => ['MarketMaya', 'QuantQuincy', 'CryptoKai', 'SharpSam', 'FXFiona', 'RookieRay'].forEach((n, j) => { if ((i + j) % 3 !== 0) react.run(id[n], pid, kinds[(i * 2 + j) % kinds.length]); }));
const cm = db.prepare('INSERT INTO comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)');
cm.run(ids[0], id.QuantQuincy, 'Like the structure. I would trim into earnings though.', ago(2));
cm.run(ids[0], id.RookieRay, 'What timeframe are you using for the 50-day?', ago(1.5));
cm.run(ids[0], id.MarketMaya, 'Daily chart. Stops are on a closing basis.', ago(1));
cm.run(ids[8], id.FXFiona, 'Agree, DXY rolling over helps.', ago(1));
cm.run(ids[15], id.RookieRay, 'Any injury news on the Cowboys line?', ago(3));
const fol = db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)');
['MarketMaya', 'QuantQuincy', 'CryptoKai', 'SharpSam', 'FXFiona'].forEach(n => fol.run(id.RookieRay, id[n]));
fol.run(id.CryptoKai, id.MarketMaya); fol.run(id.FXFiona, id.QuantQuincy);
const fr = db.prepare('INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, ?)');
fr.run(id.MarketMaya, id.QuantQuincy, 'accepted'); fr.run(id.CryptoKai, id.FXFiona, 'accepted'); fr.run(id.RookieRay, id.MarketMaya, 'pending');

console.log('Seeded demo data. Log in as admin / MarketMaya / SharpSam ... with password demo12345');
