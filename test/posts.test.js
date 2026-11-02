const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Client, stockPost, sportsPost, createPost } = require('./helpers');

let app, alice, bob, carol, dave;
before(async () => {
  app = await boot();
  alice = new Client(app.base); bob = new Client(app.base); carol = new Client(app.base); dave = new Client(app.base);
  for (const [c, n] of [[alice, 'alice'], [bob, 'bob'], [carol, 'carol'], [dave, 'dave']]) await c.signup(n);
});
after(async () => { await app.close(); });

test('create posts in every market category with validation', async () => {
  const bad = await alice.post('/post/new', stockPost({ stop: '120' }));
  assert.equal(bad.status, 400); assert.match(bad.text, /stop &lt; entry &lt; target/);
  assert.match((await alice.post('/post/new', stockPost({ subject: 'NOT A TICKER!!' }))).text, /valid ticker/i);
  assert.match((await alice.post('/post/new', stockPost({ reasoning: 'see http://spam.example now' }))).text, /Links are not allowed/);
  assert.match((await alice.post('/post/new', stockPost({ reasoning: 'short' }))).text, /at least 10/);
  assert.match((await alice.post('/post/new', stockPost({ exchange: 'zz' }))).text, /Unknown market tag/);
  // valid in each category
  await createPost(alice, stockPost({ exchange: 'us' }));
  await createPost(alice, { ...stockPost({ category: 'crypto', subject: 'btc', exchange: 'crypto' }) });
  const fx = await createPost(alice, stockPost({ category: 'forex', subject: 'eurusd', entry: '1.08', target: '1.09', stop: '1.07' }));
  assert.equal(app.db.prepare('SELECT subject FROM posts WHERE id = ?').get(fx).subject, 'EUR/USD');
  await createPost(alice, stockPost({ category: 'options', subject: 'SPY 520C 12/20', pick: 'Long Call', entry: '3.5', target: '6', stop: '2' }));
  await createPost(alice, stockPost({ category: 'futures', subject: 'ES', pick: 'Short', entry: '5200', target: '5150', stop: '5230' }));
  await createPost(alice, sportsPost());
  assert.match((await alice.post('/post/new', sportsPost({ odds: '110' }))).text, /American format/);
  assert.match((await alice.post('/post/new', sportsPost({ pick: 'Cardinals bet at bet365.com' }))).text, /Links are not allowed/);
});

test('feed filters by market category, world market tag, search and status', async () => {
  const all = await alice.get('/');
  assert.match(all.text, /EUR\/USD/); assert.doesNotMatch(all.text, /Cowboys vs Cardinals/, 'markets side excludes sports picks');
  assert.match((await alice.get('/sports/feed')).text, /Cowboys vs Cardinals/); assert.doesNotMatch((await alice.get('/sports/feed')).text, /EUR\/USD/);
  await alice.get('/mode/markets');
  const old = await alice.get('/?market=sports'); assert.equal(old.status, 302); assert.match(old.location, /^\/sports\/feed/);
  const crypto = await alice.get('/?market=crypto');
  assert.match(crypto.text, /BTC/); assert.doesNotMatch(crypto.text, /Cowboys/);
  const tagged = await alice.get('/?mkt=crypto');
  assert.match(tagged.text, /BTC/); assert.doesNotMatch(tagged.text, /EUR\/USD/);
  assert.match((await alice.get('/sports/feed?q=cowboys')).text, /Cowboys/);
  assert.doesNotMatch((await alice.get('/sports/feed?status=won')).text, /Cowboys/);
  assert.match((await alice.get('/markets/crypto')).text, /BTC/);
});

test('reactions: set, switch, remove; comments; link filter', async () => {
  const id = await createPost(alice, stockPost({ subject: 'TSLA' }));
  await bob.post(`/post/${id}/react`, { kind: 'bull' });
  await carol.post(`/post/${id}/react`, { kind: 'bear' });
  assert.deepEqual(app.db.prepare('SELECT kind FROM reactions WHERE post_id = ? ORDER BY kind').all(id).map(r => r.kind), ['bear', 'bull']);
  await bob.post(`/post/${id}/react`, { kind: 'fire' });                   // switch
  assert.equal(app.db.prepare('SELECT kind FROM reactions WHERE post_id = ? AND user_id = (SELECT id FROM users WHERE username = ?)').get(id, 'bob').kind, 'fire');
  await bob.post(`/post/${id}/react`, { kind: 'fire' });                   // toggle off
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM reactions WHERE post_id = ?').get(id).n, 1);
  await bob.post(`/post/${id}/react`, { kind: 'not-a-kind' });             // falls back to like
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM reactions WHERE post_id = ?').get(id).n, 2);
  assert.equal((await new Client(app.base).post(`/post/${id}/react`, { kind: 'like' })).status, 302); // anon -> login redirect
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM reactions WHERE post_id = ?').get(id).n, 2);

  await bob.post(`/post/${id}/comment`, { body: 'Nice setup, watching 95 support.' });
  assert.match((await alice.get(`/post/${id}`)).text, /watching 95 support/);
  const link = await bob.post(`/post/${id}/comment`, { body: 'free picks at spam.com/vip' });
  assert.match(decodeURIComponent(link.location), /Links are not allowed/);
  // HTML is escaped
  await bob.post(`/post/${id}/comment`, { body: '<script>alert(1)</script>' });
  const page = (await alice.get(`/post/${id}`)).text;
  assert.doesNotMatch(page, /<script>alert\(1\)<\/script>/); assert.match(page, /&lt;script&gt;/);
});

test('settle picks: owner only, once, record + leaderboard; delete rules', async () => {
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push(await createPost(bob, sportsPost({ subject: 'Game number ' + i })));
  await carol.post(`/post/${ids[0]}/settle`, { result: 'won' });              // not the owner
  assert.equal(app.db.prepare('SELECT status FROM posts WHERE id = ?').get(ids[0]).status, 'open');
  for (const [i, r] of [[0, 'won'], [1, 'won'], [2, 'lost'], [3, 'push']]) await bob.post(`/post/${ids[i]}/settle`, { result: r });
  await bob.post(`/post/${ids[2]}/settle`, { result: 'won' });                // cannot change once settled
  assert.equal(app.db.prepare('SELECT status FROM posts WHERE id = ?').get(ids[2]).status, 'lost');
  const prof = (await alice.get('/u/bob')).text;
  assert.match(prof, /2-1-1/); assert.match(prof, /66\.7%/);
  const lb = (await alice.get('/leaderboard')).text;
  assert.match(lb, /@bob/);                                                    // 3 decided picks qualifies
  assert.doesNotMatch(lb, /@carol/);
  // settled picks are locked against deletion by the owner, open picks can be deleted
  await bob.post(`/post/${ids[0]}/delete`, {});
  assert.equal(app.db.prepare('SELECT deleted FROM posts WHERE id = ?').get(ids[0]).deleted, 0);
  const open = await createPost(bob, stockPost({ subject: 'DEL' }));
  await carol.post(`/post/${open}/delete`, {});
  assert.equal(app.db.prepare('SELECT deleted FROM posts WHERE id = ?').get(open).deleted, 0);
  await bob.post(`/post/${open}/delete`, {});
  assert.equal(app.db.prepare('SELECT deleted FROM posts WHERE id = ?').get(open).deleted, 1);
  assert.equal((await alice.get(`/post/${open}`)).status, 404);
  // admin (alice) can reopen a settled pick
  await alice.post(`/post/${ids[2]}/settle`, { result: 'open' });
  assert.equal(app.db.prepare('SELECT status FROM posts WHERE id = ?').get(ids[2]).status, 'open');
});

test('follow + friends flow and following-feed', async () => {
  await carol.post('/u/alice/follow');
  assert.match((await carol.get('/?following=1')).text, /EUR\/USD/);
  assert.doesNotMatch((await carol.get('/sports/feed?following=1')).text, /Game number/);
  await carol.post('/u/alice/follow');                                         // unfollow
  assert.doesNotMatch((await carol.get('/?following=1')).text, /EUR\/USD/);
  // friend request -> accept
  await dave.post('/u/bob/friend', {});
  assert.match((await bob.get('/friends')).text, /Friend requests \(1\)/);
  assert.match((await dave.get('/u/bob')).text, /Request sent/);
  await bob.post('/u/dave/friend', {});                                        // accept
  assert.match((await dave.get('/friends')).text, /@bob/);
  assert.match((await dave.get('/sports/feed?following=1')).text, /Game number/);         // friends' posts show in "following & friends"
  await dave.post('/u/bob/friend', {});                                        // unfriend
  assert.doesNotMatch((await dave.get('/friends')).text, /Your friends \(1\)/);
  await dave.post('/u/dave/friend', {});                                       // cannot friend yourself
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM friendships').get().n, 0);
});

test('reports auto-hide a post; admin can restore or delete; ban works', async () => {
  const id = await createPost(dave, stockPost({ subject: 'SCAM' }));
  for (const c of [alice, bob, carol]) await c.post(`/post/${id}/report`, { reason: 'Spam or scam' });
  assert.equal(app.db.prepare('SELECT hidden FROM posts WHERE id = ?').get(id).hidden, 1);
  assert.doesNotMatch((await carol.get('/')).text, /SCAM/);
  assert.match((await alice.get('/admin')).text, /Open reports \(3\)/);
  assert.equal((await bob.get('/admin')).status, 403);
  const report = app.db.prepare('SELECT id FROM reports WHERE post_id = ?').get(id);
  await alice.post(`/admin/report/${report.id}/resolve`, { action: 'dismiss' });
  assert.equal(app.db.prepare('SELECT hidden FROM posts WHERE id = ?').get(id).hidden, 0);
  const uid = app.db.prepare('SELECT id FROM users WHERE username = ?').get('dave').id;
  await alice.post(`/admin/user/${uid}/ban`, {});
  assert.equal((await dave.get('/post/new')).status, 302, 'banned session is invalid');
  assert.equal((await new Client(app.base).login('dave')).status, 403);
});
