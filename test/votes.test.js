// Game voting: cards, lines, locking, grading, sharing, notifications. (Market votes live in marketvotes.test.js.)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Client, sportsPost } = require('./helpers');
const clock = require('../services/clock');

let app, votes, scores, admin, a, b, c, anon;
const realNow = clock.now;
const uid = (n) => app.db.prepare('SELECT id FROM users WHERE username = ?').get(n).id;
let seq = 0;
function mkGame(o = {}) {
  const id = o.id || `${o.league || 'nfl'}-${++seq}${Math.floor(Math.random() * 1e6)}`;
  app.db.prepare(`INSERT INTO games (id, league, event_id, starts_at, state, status_name, detail, completed, home_id, home_name, home_abbr, home_score, away_id, away_name, away_abbr, away_score, espn_spread, espn_total)
    VALUES (@id, @league, @eid, @starts, @state, @status, @detail, @completed, '1', @home, @habbr, @hs, '2', @away, @aabbr, @as, @spread, @total)`).run({
    id, league: o.league || 'nfl', eid: String(seq), starts: o.starts || new Date(Date.now() + 3 * 3600e3).toISOString(), state: o.state || 'pre', status: o.status || '', detail: o.detail || '', completed: o.completed ? 1 : 0,
    home: o.home || 'Cardinals', habbr: 'ARI', hs: o.hs ?? null, away: o.away || 'Cowboys', aabbr: 'DAL', as: o.as ?? null,
    spread: o.spread === undefined ? -3.5 : o.spread, total: o.total === undefined ? 47.5 : o.total });
  return id;
}
function finish(id, h, aw, status = 'STATUS_FINAL') {
  app.db.prepare(`UPDATE games SET state = 'post', completed = 1, status_name = ?, home_score = ?, away_score = ? WHERE id = ?`).run(status, h, aw, id);
  return votes.gradeGame(id);
}
const vote = (cl, id, market, pick, extra = {}) => cl.post(`/game/${id}/vote`, { market, pick, ...extra });
async function json(cl, url, body) { // what the browser script does: fetch with Accept: application/json
  const form = new URLSearchParams({ _csrf: cl.jar.csrf, ...body });
  const r = await fetch(app.base + url, { method: 'POST', redirect: 'manual', headers: { Cookie: cl.cookieHeader(), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'X-Requested-With': 'fetch' }, body: form.toString() });
  return { status: r.status, body: await r.json() };
}
const rows = (id, who) => app.db.prepare('SELECT market, pick, line, result FROM game_votes WHERE game_id = ? AND user_id = ? ORDER BY market').all(id, uid(who));

before(async () => {
  app = await boot();
  votes = require('../services/votes'); scores = require('../services/scores');
  [admin, a, b, c, anon] = [0, 1, 2, 3, 4].map(() => new Client(app.base));
  for (const [i, cl] of [admin, a, b, c].entries()) await cl.signup(['vadmin', 'vera', 'vic', 'val'][i]);
  app.db.prepare("UPDATE users SET is_admin = 1 WHERE username = 'vadmin'").run();
});
after(async () => { clock.now = realNow; await app.close(); });

test('game vote card shows both teams and all three markets; logged-out users must log in to vote', async () => {
  const id = mkGame();
  const page = await a.get('/game/' + id);
  assert.equal(page.status, 200);
  for (const t of [/Cowboys/, /Cardinals/, /Winner/, /Over \/ Under/, /47\.5/, /Spread/, /ARI -3\.5/, /ESPN line/, /Voting open until kickoff/, /Tracking only/]) assert.match(page.text, t);
  assert.match(page.text, /21\+ \| Bet responsibly \| 1-800-GAMBLER/);
  assert.doesNotMatch(page.text, /<button[^>]*name="pick" value="draw"/, 'no draw option outside soccer');
  const out = await anon.get('/game/' + id);
  assert.match(out.text, /href="\/login\?next=/); assert.doesNotMatch(out.text, /<button[^>]*name="pick"/);
  assert.equal((await vote(anon, id, 'moneyline', 'home')).status, 302); assert.equal(app.db.prepare('SELECT COUNT(*) n FROM game_votes WHERE game_id = ?').get(id).n, 0);
});

test('moneyline: vote, change, clear, split percentages (also via the JSON endpoint the page script uses)', async () => {
  const id = mkGame();
  assert.equal((await vote(a, id, 'moneyline', 'home')).status, 302);
  await vote(b, id, 'moneyline', 'away'); await vote(c, id, 'moneyline', 'home');
  let card = votes.gameCard(votes.getGame(id), uid('vera'));
  assert.deepEqual(card.moneyline.picks.map(p => [p.pick, p.n, p.pct]), [['away', 1, 33], ['home', 2, 67]]);
  assert.equal(card.moneyline.mine.pick, 'home'); assert.equal(card.moneyline.total, 3);
  await vote(a, id, 'moneyline', 'away');                                 // change: still one row per user+market
  assert.equal(rows(id, 'vera').length, 1); assert.equal(rows(id, 'vera')[0].pick, 'away');
  const r = await json(a, `/game/${id}/vote`, { market: 'moneyline', pick: 'home' });
  assert.equal(r.status, 200); assert.ok(r.body.ok); assert.match(r.body.html, /gcard/); assert.match(r.body.html, /aria-pressed="true"/);
  const bad = await json(a, `/game/${id}/vote`, { market: 'moneyline', pick: 'sideways' });
  assert.equal(bad.status, 400); assert.match(bad.body.error, /Invalid/);
  assert.equal((await vote(a, id, 'bogus', 'home')).status, 302); assert.equal(rows(id, 'vera').length, 1);
  await vote(a, id, 'moneyline', '', { remove: '1' });
  assert.equal(rows(id, 'vera').length, 0);
  assert.equal((await a.post('/game/nope-1/vote', { market: 'moneyline', pick: 'home' })).status, 404);
});

test('lines: ESPN line is stored with the vote, admin overrides, community line set by the first voter', async () => {
  const id = mkGame({ total: 47.5, spread: -3.5 });
  await vote(a, id, 'total', 'over'); await vote(a, id, 'spread', 'home');
  assert.deepEqual(rows(id, 'vera').map(r => r.line), [-3.5, 47.5]);  // sorted: spread, total
  assert.equal((await a.post(`/game/${id}/line`, { market: 'total', line: '50.5' })).status, 403, 'only admins set lines');
  assert.equal((await admin.post(`/game/${id}/line`, { market: 'total', line: '49.5' })).status, 302);
  assert.equal(votes.lineFor(votes.getGame(id), 'total').source, 'admin');
  await vote(b, id, 'total', 'under');
  assert.equal(rows(id, 'vic')[0].line, 49.5, 'new votes use the admin line');
  assert.equal(rows(id, 'vera').find(r => r.market === 'total').line, 47.5, 'existing votes keep the line they were cast with');
  await admin.post(`/game/${id}/line`, { market: 'total', clear: '1' });
  assert.equal(votes.lineFor(votes.getGame(id), 'total').source, 'espn');
  assert.match((await admin.post(`/game/${id}/line`, { market: 'total', line: 'abc' })).location, /err=/);

  const bare = mkGame({ total: null, spread: null });                        // no ESPN line
  const first = await json(a, `/game/${bare}/vote`, { market: 'total', pick: 'over' });
  assert.equal(first.status, 400); assert.match(first.body.error, /No line yet/);
  assert.equal((await json(a, `/game/${bare}/vote`, { market: 'total', pick: 'over', line: '44.25' })).status, 400, 'lines are in half-point steps');
  assert.equal((await json(a, `/game/${bare}/vote`, { market: 'total', pick: 'over', line: '44.5' })).status, 200);
  assert.equal(votes.lineFor(votes.getGame(bare), 'total').source, 'community');
  await vote(b, bare, 'total', 'under', { line: '99' });                      // second voter's number is ignored
  assert.equal(rows(bare, 'vic')[0].line, 44.5);
  await vote(a, bare, 'spread', 'away', { line: '-2.5' });
  assert.equal(votes.lineFor(votes.getGame(bare), 'spread').line, -2.5);
  assert.match((await a.get('/game/' + bare)).text, /community line/);
  app.db.prepare('UPDATE games SET espn_total = 45 WHERE id = ?').run(bare);   // a real line shows up later and wins
  assert.equal(votes.lineFor(votes.getGame(bare), 'total').line, 45);
});

test('draw is a soccer-only option', async () => {
  const nfl = mkGame({ league: 'nfl' }), epl = mkGame({ league: 'epl', total: 2.5, spread: null });
  assert.equal((await json(a, `/game/${nfl}/vote`, { market: 'moneyline', pick: 'draw' })).status, 400);
  assert.equal((await json(a, `/game/${epl}/vote`, { market: 'moneyline', pick: 'draw' })).status, 200);
  assert.match((await a.get('/game/' + epl)).text, /<button[^>]*name="pick" value="draw"/);
  assert.match((await a.get('/game/' + epl)).text, /Result/);
});

test('locking: no voting, changing or clearing once the game has started', async () => {
  const start = Date.now() + 3600e3, id = mkGame({ starts: new Date(start).toISOString() });
  assert.equal((await json(a, `/game/${id}/vote`, { market: 'moneyline', pick: 'home' })).status, 200);
  clock.now = () => new Date(start);                                          // kickoff
  const late = await json(b, `/game/${id}/vote`, { market: 'moneyline', pick: 'away' });
  assert.equal(late.status, 400); assert.match(late.body.error, /locked/i);
  assert.match((await json(a, `/game/${id}/vote`, { market: 'moneyline', pick: 'away' })).body.error, /locked/i);
  assert.equal(rows(id, 'vera')[0].pick, 'home', 'a locked vote cannot be changed');
  assert.match((await json(a, `/game/${id}/vote`, { market: 'moneyline', pick: '', remove: '1' })).body.error, /locked/i);
  assert.equal(rows(id, 'vera').length, 1);
  assert.match((await a.get('/game/' + id)).text, /Voting is locked/);
  clock.now = realNow;
  const live = mkGame({ state: 'in', detail: 'Q2 4:00', hs: 7, as: 3, starts: new Date(Date.now() - 3600e3).toISOString() });  // already live
  assert.match((await json(b, `/game/${live}/vote`, { market: 'total', pick: 'over' })).body.error, /locked/i);
  const post = mkGame({ state: 'post', completed: true, status: 'STATUS_FINAL', hs: 1, as: 0, starts: new Date(Date.now() - 9e6).toISOString() });
  assert.match((await json(b, `/game/${post}/vote`, { market: 'moneyline', pick: 'home' })).body.error, /locked/i);
});

test('grading: winner, over/under and spread (home-team spread) from final scores; records, notifications, leaderboard. ARI 27 DAL 24 -> home wins, over 47.5 wins, away covers +3.5', async () => {
  const id = mkGame();
  for (const [cl, ml, ou, sp] of [[a, 'home', 'over', 'home'], [b, 'away', 'under', 'away']]) {
    await vote(cl, id, 'moneyline', ml); await vote(cl, id, 'total', ou); await vote(cl, id, 'spread', sp);
  }
  assert.equal(votes.gradeAllGames(), 0, 'still pre-game: nothing graded');
  assert.equal(finish(id, 27, 24), 6);
  assert.deepEqual(rows(id, 'vera').map(r => [r.market, r.result]), [['moneyline', 'won'], ['spread', 'lost'], ['total', 'won']]);
  assert.deepEqual(rows(id, 'vic').map(r => [r.market, r.result]), [['moneyline', 'lost'], ['spread', 'won'], ['total', 'lost']]);
  assert.equal(votes.gradeGame(id), 0, 'grading is idempotent');
  assert.equal(votes.voteRecord(uid('vera')).games.w >= 2, true);
  const rec = votes.voteRecord(uid('vera')).games; assert.ok(rec.acc > 0);
  const note = app.db.prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'vote' ORDER BY id DESC").all(uid('vera'));
  assert.equal(note.length >= 3, true); assert.match(note[0].text, /Your vote (won|lost|pushed)/); assert.equal(note[0].href, '/game/' + id);
  const board = await anon.get('/sports/leaderboard');
  assert.match(board.text, /@vera/); assert.match(board.text, /@vic/);
  assert.match((await anon.get('/sports/leaderboard?market=spread')).text, /Nobody has qualified|@vic/);
  assert.match((await a.get('/u/vera')).text, /Voting record/);
  const mine = await a.get('/votes'); assert.match(mine.text, /Cowboys @ Cardinals/); assert.match(mine.text, /27–24|24–27/);
});

test('grading: pushes (exact total, spread, NFL tie), soccer draw, postponed games void', async () => {
  const p = mkGame({ total: 51, spread: -3 });
  await vote(a, p, 'total', 'over'); await vote(a, p, 'spread', 'home'); await vote(a, p, 'moneyline', 'home');
  finish(p, 27, 24);                                       // total 51 = line, margin 3 = spread
  assert.deepEqual(rows(p, 'vera').map(r => r.result), ['won', 'push', 'push'], 'ml home wins, spread push, total push');
  const tie = mkGame(); await vote(b, tie, 'moneyline', 'home'); finish(tie, 20, 20);
  assert.equal(rows(tie, 'vic')[0].result, 'push', 'a tie in a no-draw sport pushes');
  const soc = mkGame({ league: 'epl', total: 2.5, spread: null });
  await vote(a, soc, 'moneyline', 'draw'); await vote(b, soc, 'moneyline', 'home'); await vote(c, soc, 'moneyline', 'away'); await vote(a, soc, 'total', 'under');
  finish(soc, 1, 1);
  assert.equal(rows(soc, 'vera').find(r => r.market === 'moneyline').result, 'won'); assert.equal(rows(soc, 'vera').find(r => r.market === 'total').result, 'won');
  assert.equal(rows(soc, 'vic')[0].result, 'lost'); assert.equal(rows(soc, 'val')[0].result, 'lost');
  const pp = mkGame(); await vote(a, pp, 'moneyline', 'home');
  app.db.prepare("UPDATE games SET status_name = 'STATUS_POSTPONED' WHERE id = ?").run(pp);
  assert.match((await json(b, `/game/${pp}/vote`, { market: 'moneyline', pick: 'home' })).body.error, /locked/i);
  assert.equal(votes.gradeAllGames() >= 1, true); assert.equal(rows(pp, 'vera')[0].result, 'void');
  const before = votes.voteRecord(uid('vera')).games;
  assert.equal(before.p >= 2, true);
});

test('ESPN refresh pipeline: events are upserted and votes are graded when the game goes final', async () => {
  const l = scores.leagueByKey.nba;
  const ev = (state, completed, hs, as, name) => ({ id: '99001', date: new Date(Date.now() + 7200e3).toISOString(), status: { type: { state, completed, name, shortDetail: completed ? 'Final' : 'Tonight' } },
    competitions: [{ competitors: [{ homeAway: 'home', score: String(hs), team: { id: '5', abbreviation: 'BOS', shortDisplayName: 'Celtics' }, records: [{ summary: '5-1' }] },
      { homeAway: 'away', score: String(as), team: { id: '9', abbreviation: 'NY', shortDisplayName: 'Knicks' } }], odds: [{ details: 'BOS -6.5', overUnder: 221.5 }], venue: { fullName: 'TD Garden' } }] });
  scores.saveAll([scores.parseEvent(l, ev('pre', false, 0, 0, 'STATUS_SCHEDULED'))]);
  const g = scores.gameById('nba-99001');
  assert.equal(g.state, 'pre'); assert.equal(g.home_score, null); assert.equal(g.espn_spread, -6.5, 'favourite BOS is the home team'); assert.equal(g.espn_total, 221.5); assert.equal(g.home_record, '5-1'); assert.equal(g.venue, 'TD Garden');
  await vote(a, g.id, 'spread', 'home'); await vote(a, g.id, 'moneyline', 'home');
  assert.match((await a.get('/sports?league=nba')).text, /Celtics/);
  assert.equal(JSON.parse((await (await fetch(app.base + '/api/scores')).text())).leagues.find(x => x.key === 'nba').games.length, 1);
  scores.saveAll([scores.parseEvent(l, ev('post', true, 110, 101, 'STATUS_FINAL'))]);
  assert.equal(votes.gradeAllGames(), 2);
  assert.deepEqual(rows(g.id, 'vera').map(r => r.result), ['won', 'won'], 'ARI-style spread: BOS -6.5 and won by 9');
});

test('shared votes: feed, group feed, channels; mirrored status; not counted as written picks; clean-up when a vote is cleared', async () => {
  const id = mkGame();
  await vote(a, id, 'moneyline', 'home'); await vote(a, id, 'total', 'over');
  const vid = app.db.prepare("SELECT id FROM game_votes WHERE game_id = ? AND user_id = ? AND market = 'moneyline'").get(id, uid('vera')).id;
  const tid = app.db.prepare("SELECT id FROM game_votes WHERE game_id = ? AND user_id = ? AND market = 'total'").get(id, uid('vera')).id;
  const bad = await a.post('/votes/share', { type: 'game', id: String(vid), dest: 'feed', comment: 'see www.pick.com', back: '/game/' + id });
  assert.match(bad.location, /err=Links/);
  assert.match((await b.post('/votes/share', { type: 'game', id: String(vid), dest: 'feed', back: '/' })).location, /err=Pick%20one%20of%20your%20own/, "can't share someone else's vote");
  const ok = await json(a, '/votes/share', { type: 'game', id: String(vid), dest: 'feed', comment: 'Easy money? No — just tracking.' });
  assert.equal(ok.status, 200); assert.ok(ok.body.ok);
  const post = app.db.prepare("SELECT * FROM posts WHERE vote_id = ? AND kind = 'game_vote'").get(vid);
  assert.equal(post.game_id, id); assert.equal(post.status, 'open'); assert.match(post.pick, /Cardinals to win/);
  assert.match((await b.get('/sports/feed')).text, /shared a game vote/);
  assert.match((await json(a, '/votes/share', { type: 'game', id: String(vid), dest: 'feed' })).body.error, /already shared/);
  assert.match((await b.get('/game/' + id)).text, /Shared votes/);

  // group feed + channel sharing, membership enforced
  await a.post('/groups/new', { name: 'Vote Crew', privacy: 'private', description: 'x' });
  const gid = app.db.prepare("SELECT id FROM user_groups WHERE name = 'Vote Crew'").get().id;
  const ch = app.db.prepare("SELECT id FROM group_channels WHERE group_id = ? AND name = 'sports-picks'").get(gid).id;
  assert.match((await json(b, '/votes/share', { type: 'game', id: String((app.db.prepare('SELECT id FROM game_votes WHERE user_id = ? LIMIT 1').get(uid('vic')) || { id: 0 }).id), dest: 'g:' + gid })).body.error, /own votes|member/);
  assert.equal((await json(a, '/votes/share', { type: 'game', id: String(vid), dest: 'g:' + gid })).status, 200);
  assert.match((await a.get('/g/' + gid)).text, /shared a game vote/); assert.doesNotMatch((await b.get('/sports/feed')).text.replace(/Shared votes/g, ''), /Vote Crew/, 'private group shares are not public');
  const ch1 = await json(a, '/votes/share', { type: 'game', id: String(tid), dest: `c:${gid}:${ch}`, comment: 'over looks good' });
  assert.equal(ch1.status, 200);
  const msg = app.db.prepare('SELECT * FROM messages WHERE channel_id = ? ORDER BY id DESC').get(ch);
  assert.equal(JSON.parse(msg.card).kind, 'game'); assert.equal(msg.body, 'over looks good');
  assert.match((await a.get(`/g/${gid}/c/${ch}`)).text, /vcard-embed/);
  await b.post('/votes/share', { type: 'game', id: '1', dest: `c:${gid}:${ch}` });
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM messages WHERE channel_id = ?').get(ch).n, 1, 'non-members cannot share into a channel');

  // changing the vote updates the shared copies; grading mirrors the result into the post and the chat card
  await vote(a, id, 'moneyline', 'away');
  assert.match(app.db.prepare('SELECT pick FROM posts WHERE vote_id = ? AND kind = ?').get(vid, 'game_vote').pick, /Cowboys to win/);
  await vote(a, id, 'moneyline', 'home');
  finish(id, 30, 10);
  assert.equal(app.db.prepare("SELECT status FROM posts WHERE vote_id = ? AND kind = 'game_vote' AND group_id IS NULL").get(vid).status, 'won');
  assert.equal(JSON.parse(app.db.prepare('SELECT card FROM messages WHERE id = ?').get(msg.id).card).status, 'lost');   // total 40 < 47.5, "over" lost
  const prof = (await a.get('/u/vera')).text;
  assert.match(prof, /Record \(W-L-P\)<\/small><b>0-0-0/, 'shared votes are not counted as written picks');
  // written pick tied to a game
  const wp = await a.post('/post/new', sportsPost({ subject: 'Cowboys @ Cardinals', game_id: id }));
  assert.equal(app.db.prepare('SELECT game_id FROM posts WHERE id = ?').get(Number(wp.location.match(/(\d+)/)[1])).game_id, id);
  const wp2 = await a.post('/post/new', sportsPost({ subject: 'Whatever', game_id: 'nope' }));
  assert.equal(app.db.prepare('SELECT game_id FROM posts WHERE id = ?').get(Number(wp2.location.match(/(\d+)/)[1])).game_id, null);
  // clearing a vote before the game removes what was shared
  const id2 = mkGame(); await vote(a, id2, 'moneyline', 'home');
  const v2 = app.db.prepare('SELECT id FROM game_votes WHERE game_id = ?').get(id2).id;
  await json(a, '/votes/share', { type: 'game', id: String(v2), dest: 'feed' });
  await vote(a, id2, 'moneyline', '', { remove: '1' });
  assert.equal(app.db.prepare("SELECT deleted FROM posts WHERE vote_id = ? AND kind = 'game_vote'").get(v2).deleted, 1);
});

test('notifications: graded votes, comments, friend requests appear with an unread count', async () => {
  const id = mkGame(); await vote(c, id, 'moneyline', 'away'); finish(id, 10, 3);
  const home = await c.get('/');
  assert.match(home.text, /class="badge">\d+</);
  const page = await c.get('/notifications');
  assert.match(page.text, /Your vote lost/); assert.match(page.text, new RegExp(`/game/${id}`));
  assert.doesNotMatch((await c.get('/')).text, /class="badge">\d+<\/span><\/a>\s*<a href="\/friends"/, 'marked read after viewing');
  const postId = Number((await a.post('/post/new', sportsPost()).then(r => r.location)).match(/(\d+)/)[1]);
  await c.post(`/post/${postId}/comment`, { body: 'nice one' });
  assert.match((await a.get('/notifications')).text, /@val commented on your post/);
  await c.post('/u/vera/friend', {});
  assert.match((await a.get('/notifications')).text, /sent you a friend request/);
  await a.post('/notifications/clear'); assert.match((await a.get('/notifications')).text, /Nothing yet/);
});

test('sports hub, league filter, team + game pages, legacy URLs', async () => {
  mkGame({ league: 'nba', home: 'Lakers', away: 'Suns', starts: new Date(Date.now() + 5 * 3600e3).toISOString() });
  const hub = await anon.get('/sports?league=nba');
  assert.match(hub.text, /Lakers/); assert.match(hub.text, /Suns/); assert.match(hub.text, /class="chip on"[^>]*>NBA|chip on" href="\/sports\?league=nba"/);
  assert.match((await anon.get('/sports?league=nba&filter=live')).text, /No games match/);
  assert.equal((await anon.get('/game/not-a-game')).status, 404);
  assert.equal((await anon.get('/team/zzz/1')).status, 404); assert.equal((await anon.get('/team/nba/abc')).status, 404);
  const sc = await anon.get('/scores?league=nba'); assert.equal(sc.status, 301); assert.equal(sc.location, '/sports?league=nba');
  assert.equal((await anon.get('/sports/leaderboard?by=picks')).status, 200);
  assert.match((await anon.get('/sports/teams?league=nba')).text, /Teams/);
});
