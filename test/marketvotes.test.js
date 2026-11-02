// Market votes (Up/Down for the next session or week): windows, locking, grading from price data, sharing, leaderboard.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Client } = require('./helpers');
const clock = require('../services/clock');
const prices = require('../services/prices');

let app, votes, a, b, c, anon;
const realNow = clock.now;
const at = (iso) => { clock.now = () => new Date(iso); };
const uid = (n) => app.db.prepare('SELECT id FROM users WHERE username = ?').get(n).id;
const T0 = '2026-11-04T15:00:00Z';                       // Wednesday 10:00 in New York
async function json(cl, url, body) {
  const r = await fetch(app.base + url, { method: 'POST', redirect: 'manual', headers: { Cookie: cl.cookieHeader(), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ _csrf: cl.jar.csrf, ...body }).toString() });
  return { status: r.status, body: await r.json() };
}
const mv = (who, sym = 'AAPL') => app.db.prepare('SELECT * FROM market_votes WHERE user_id = ? AND symbol = ? ORDER BY id').all(uid(who), sym);
const dayv = (who, sym = 'AAPL') => mv(who, sym).find(v => v.timeframe === 'day');
let book = {};                                            // mock price data: "SYM|startISO" -> {start,end} | {void:true} | Error
const provider = { quote: async (s) => (/^[A-Z]{2,4}$/.test(s) && s !== 'ZZZZ' ? { price: 100, name: s + ' Inc', changePct: 1.2 } : null),
  between: async (sym, s, e) => { const r = book[`${sym}|${new Date(s).toISOString()}`]; if (r instanceof Error) throw r; if (!r) throw new Error('no data'); return r; } };

before(async () => {
  app = await boot(); votes = require('../services/votes');
  prices.setProvider(provider);
  [a, b, c, anon] = [0, 1, 2, 3].map(() => new Client(app.base));
  for (const [i, cl] of [a, b, c].entries()) await cl.signup(['mara', 'milo', 'mina'][i]);
  at(T0);
});
after(async () => { clock.now = realNow; prices.setProvider(null); await app.close(); });

test('windows: next session / next week per market, in the market\'s own time zone', async () => {
  const C = votes.catalog();
  const w = (s) => Object.fromEntries(votes.windowsFor(C[s], new Date(T0)).map(x => [x.timeframe, x]));
  assert.equal(w('AAPL').day.starts, '2026-11-05T14:30:00.000Z');  assert.equal(w('AAPL').day.ends, '2026-11-05T21:00:00.000Z');   // 09:30-16:00 ET (EST)
  assert.equal(w('AAPL').week.starts, '2026-11-09T14:30:00.000Z'); assert.equal(w('AAPL').week.ends, '2026-11-13T21:00:00.000Z');
  assert.equal(w('^N225').day.starts, '2026-11-05T00:00:00.000Z'); assert.equal(w('^N225').day.ends, '2026-11-05T06:30:00.000Z');    // 09:00-15:30 JST
  assert.equal(w('BTC-USD').day.ends, '2026-11-06T00:00:00.000Z');                                                                    // UTC day
  assert.equal(w('EURUSD=X').day.starts, '2026-11-04T22:00:00.000Z');                                                                 // 17:00 ET rollover
  const fri = votes.windowsFor(C.AAPL, new Date('2026-11-06T22:00:00Z'));                                                             // Friday evening -> Monday
  assert.equal(fri[0].starts, '2026-11-09T14:30:00.000Z');
  const thanks = votes.windowsFor(C.AAPL, new Date('2026-11-25T22:00:00Z'));                                                          // skips Thanksgiving (Nov 26)
  assert.equal(thanks[0].starts, '2026-11-27T14:30:00.000Z');
});

test('vote card on a market page: Up / Down for session and week, with split and lock times', async () => {
  const page = await a.get('/t/AAPL');
  assert.equal(page.status, 200);
  for (const t of [/Next session/, /Next week/, /name="direction" value="up"/, /name="direction" value="down"/, /Target move/, /Locks/, /graded at/, /Tracking only/, /1-800-GAMBLER/]) assert.match(page.text, t);
  assert.equal((await anon.get('/t/aapl')).status, 200, 'symbols are case-insensitive');
  assert.match((await anon.get('/t/AAPL')).text, /href="\/login\?next=/);
  assert.equal((await anon.get('/t/TOOLONGSYMBOL')).status, 404); assert.equal((await anon.get('/t/ZZZZ')).status, 404, 'unknown tickers are rejected via the price provider');
  assert.equal((await anon.get('/t/%5EGSPC')).status, 200); assert.equal((await anon.get('/t/BTC-USD')).status, 200);
  assert.match((await anon.get('/markets')).text, /Vote on the market/);
  assert.match((await a.get('/')).text, /mvcard/);
});

test('cast, change, clear; split percentages; target validation; reaches the correct round', async () => {
  const [day, week] = votes.windowsFor(votes.catalog().AAPL);
  const post = (cl, body) => json(cl, '/t/AAPL/vote', { back: '/t/AAPL', ...body });
  assert.equal((await post(a, { timeframe: 'day', starts: day.starts, direction: 'up', target: '1.5' })).status, 200);
  await post(b, { timeframe: 'day', starts: day.starts, direction: 'down' }); await post(c, { timeframe: 'day', starts: day.starts, direction: 'up' });
  let card = votes.marketCard(votes.catalog().AAPL, uid('mara'));
  assert.deepEqual([card[0].up, card[0].down, card[0].upPct, card[0].downPct], [2, 1, 67, 33]); assert.equal(card[0].mine.target_pct, 1.5); assert.equal(card[1].total, 0);
  await post(a, { timeframe: 'day', starts: day.starts, direction: 'down', target: '' });             // change
  assert.equal(mv('mara').length, 1); assert.equal(mv('mara')[0].direction, 'down'); assert.equal(mv('mara')[0].target_pct, null);
  assert.equal((await post(a, { timeframe: 'week', starts: week.starts, direction: 'up' })).status, 200); assert.equal(mv('mara').length, 2);
  assert.match((await post(a, { timeframe: 'day', starts: day.starts, direction: 'up', target: '99' })).body.error, /between 0 and 25/);
  assert.match((await post(a, { timeframe: 'day', starts: day.starts, direction: 'up', target: 'abc' })).body.error, /between/);
  assert.match((await post(a, { timeframe: 'day', starts: day.starts, direction: 'sideways' })).body.error, /Invalid direction/);
  assert.match((await post(a, { timeframe: 'year', starts: day.starts, direction: 'up' })).body.error, /Invalid timeframe/);
  assert.match((await post(a, { timeframe: 'day', starts: '2026-11-04T14:30:00.000Z', direction: 'up' })).body.error, /locked|already started/i, 'a stale round is rejected');
  const r = await post(a, { timeframe: 'day', starts: day.starts, direction: '', remove: '1' }); assert.equal(r.status, 200);
  assert.equal(mv('mara').filter(v => v.timeframe === 'day').length, 0);
  assert.equal((await anon.post('/t/AAPL/vote', { timeframe: 'day', starts: day.starts, direction: 'up' })).status, 302);
});

test('locking: the round locks at the start of its window (no late votes, no changes, no clearing)', async () => {
  const [day] = votes.windowsFor(votes.catalog().AAPL);
  const post = (cl, body) => json(cl, '/t/AAPL/vote', { back: '/t/AAPL', timeframe: 'day', starts: day.starts, ...body });
  await post(b, { direction: 'up' });
  at('2026-11-05T14:29:59Z'); assert.equal((await post(c, { direction: 'up' })).status, 200, 'one second before the open still counts');
  at(day.starts);                                                                                              // 09:30 ET: the session starts
  assert.match((await post(a, { direction: 'up' })).body.error, /locked/i);
  assert.match((await post(b, { direction: 'down' })).body.error, /locked/i); assert.equal(mv('milo').find(v => v.starts_at === day.starts).direction, 'up');
  assert.match((await post(b, { direction: '', remove: '1' })).body.error, /locked/i);
  assert.ok(mv('milo').find(v => v.starts_at === day.starts), 'the locked vote is still there');
  assert.equal(votes.windowsFor(votes.catalog().AAPL)[0].starts, '2026-11-06T14:30:00.000Z', 'the card now offers the next session');
  at(T0);
});

test('grading from price data: direction, optional target %, flat = push, void, retry then void', async () => {
  const info = votes.catalog().AAPL;
  const mk = (who, sym, dir, target) => votes.castMarketVote({ userId: uid(who), info: votes.catalog()[sym], timeframe: 'day', starts: votes.windowsFor(votes.catalog()[sym])[0].starts, direction: dir, target });
  const day = (s) => votes.windowsFor(votes.catalog()[s])[0];
  // AAPL: +2% — mara up (won), milo down (lost), mina up with target 3% (lost: direction right, move too small)
  mk('mara', 'AAPL', 'up'); mk('milo', 'AAPL', 'down'); mk('mina', 'AAPL', 'up', 3);
  // MSFT: flat -> push
  mk('mara', 'MSFT', 'up'); mk('milo', 'MSFT', 'down');
  // NVDA: -2.5% with target 2 -> down+target met = won
  mk('mina', 'NVDA', 'down', 2);
  // TSLA: no data on a holiday-like window -> void
  mk('mara', 'TSLA', 'up');
  // AMZN: provider keeps failing -> stays pending, voids after 14 days
  mk('milo', 'AMZN', 'up');
  const k = (s) => `${s}|${day(s).starts}`;
  book[k('AAPL')] = { start: 100, end: 102 }; book[k('MSFT')] = { start: 400, end: 400 }; book[k('NVDA')] = { start: 200, end: 195 }; book[k('TSLA')] = { void: true }; book[k('AMZN')] = new Error('Yahoo down');
  const ends = new Date(day('AAPL').ends).getTime();
  at(new Date(ends + 5 * 60000).toISOString());
  assert.equal(await votes.gradeMarketVotes(), 0, 'nothing is graded until the grading delay has passed (10 min after the close)');
  at(new Date(ends + 11 * 60000).toISOString());
  const n = await votes.gradeMarketVotes();
  assert.equal(n, 7);
  assert.deepEqual([dayv('mara').result, dayv('milo').result, dayv('mina').result], ['won', 'lost', 'lost']);
  assert.equal(dayv('mara').change_pct, 2); assert.equal(dayv('mara').start_price, 100); assert.equal(dayv('mara').end_price, 102);
  assert.deepEqual([mv('mara', 'MSFT')[0].result, mv('milo', 'MSFT')[0].result], ['push', 'push']);
  assert.equal(mv('mina', 'NVDA')[0].result, 'won'); assert.equal(mv('mara', 'TSLA')[0].result, 'void');
  assert.equal(mv('milo', 'AMZN')[0].result, 'pending', 'data source failed: retried later, not guessed');
  assert.equal(await votes.gradeMarketVotes(), 0, 'idempotent');
  at(new Date(ends + 15 * 86400e3).toISOString());
  assert.equal(await votes.gradeMarketVotes(), 1); assert.equal(mv('milo', 'AMZN')[0].result, 'void', 'ungradable votes are voided after 14 days');
  assert.match(app.db.prepare("SELECT text FROM notifications WHERE user_id = ? AND type = 'vote' AND text LIKE '%AAPL%' ORDER BY id DESC").get(uid('mara')).text, /Your vote won/);
  const rec = votes.voteRecord(uid('mara')).markets; assert.equal(rec.w, 1); assert.equal(rec.p, 1);
  assert.deepEqual(votes.gradeMarketResult({ direction: 'up', target_pct: null }, 0.0001), 'won');
  assert.equal(votes.gradeMarketResult({ direction: 'down', target_pct: 2 }, -2), 'won'); assert.equal(votes.gradeMarketResult({ direction: 'down', target_pct: 2 }, 1), 'lost');
  at(T0);
});

test('market vote leaderboard needs the minimum number of graded votes; profile shows the record', async () => {
  const board = await anon.get('/leaderboard?board=votes');
  assert.equal(board.status, 200); assert.match(board.text, /Market votes/);
  for (let i = 0; i < 3; i++) app.db.prepare(`INSERT INTO market_votes (user_id, symbol, label, timeframe, starts_at, ends_at, direction, result) VALUES (?, 'SPY', 'SPY', 'day', ?, ?, 'up', 'won')`).run(uid('mina'), `2026-10-0${i + 1}T14:30:00.000Z`, `2026-10-0${i + 1}T21:00:00.000Z`);
  const b2 = (await anon.get('/leaderboard?board=votes')).text;
  assert.match(b2, /@mina/); assert.doesNotMatch(b2, /@mara/, 'mara has fewer than 3 won/lost votes');
  assert.match((await anon.get('/leaderboard?board=votes&timeframe=week')).text, /Nobody has qualified/);
  assert.match((await anon.get('/u/mina')).text, /Market votes/);
});

test('sharing a market vote: feed post mirrors the result; channel card; excluded from written-pick record', async () => {
  at(T0);
  const sym = 'GOOG';
  const info = votes.catalog().GOOG || { ...votes.catalog().AAPL, symbol: 'GOOG', label: 'GOOG · Alphabet' };
  const w = votes.windowsFor(info)[0];
  assert.equal(votes.castMarketVote({ userId: uid('milo'), info, timeframe: 'day', starts: w.starts, direction: 'up', target: 1 }).ok, true);
  const vid = mv('milo', 'GOOG')[0].id;
  const ok = await json(b, '/votes/share', { type: 'market', id: String(vid), dest: 'feed', comment: 'GOOG into the print' });
  assert.equal(ok.status, 200);
  const p = app.db.prepare("SELECT * FROM posts WHERE vote_id = ? AND kind = 'market_vote'").get(vid);
  assert.match(p.pick, /▲ Up next session by ≥ 1%/); assert.equal(p.game_id, 'GOOG'); assert.equal(p.status, 'open');
  assert.match((await a.get('/')).text, /shared a market vote/);
  // change the vote -> shared copy follows
  votes.castMarketVote({ userId: uid('milo'), info, timeframe: 'day', starts: w.starts, direction: 'down', target: '' });
  assert.match(app.db.prepare('SELECT pick FROM posts WHERE id = ?').get(p.id).pick, /▼ Down next session$/);
  // group channel
  await b.post('/groups/new', { name: 'Chart Club', privacy: 'public', description: 'x' });
  const gid = app.db.prepare("SELECT id FROM user_groups WHERE name = 'Chart Club'").get().id, ch = app.db.prepare("SELECT id FROM group_channels WHERE group_id = ? AND name = 'stocks'").get(gid).id;
  assert.equal((await json(b, '/votes/share', { type: 'market', id: String(vid), dest: `c:${gid}:${ch}` })).status, 200);
  assert.match((await b.get(`/g/${gid}/c/${ch}`)).text, /Market vote/);
  // grade: the post and the chat card both mirror the result
  book[`GOOG|${w.starts}`] = { start: 100, end: 98 };
  at(new Date(new Date(w.ends).getTime() + 11 * 60000).toISOString());
  assert.equal(await votes.gradeMarketVotes() >= 1, true);
  assert.equal(app.db.prepare('SELECT status FROM posts WHERE id = ?').get(p.id).status, 'won');
  assert.equal(JSON.parse(app.db.prepare('SELECT card FROM messages WHERE channel_id = ?').get(ch).card).status, 'won');
  assert.match((await b.get('/votes')).text, /GOOG/);
  at(T0);
});

test('unknown-ticker lookups are rate limited per IP; catalog symbols are not', async () => {
  const codes = [];
  for (let i = 0; i < 25; i++) codes.push((await anon.get('/t/ABCD')).status);
  assert.equal(codes[0] === 200 || codes[0] === 404, true);
  assert.ok(codes.slice(-3).every(s => s === 404), 'lookups beyond the per-minute budget are refused');
  assert.equal((await anon.get('/t/AAPL')).status, 200);
});
