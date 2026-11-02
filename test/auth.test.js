const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Client } = require('./helpers');

let app;
before(async () => { app = await boot(); });
after(async () => { await app.close(); });

test('signup validates input and hashes passwords', async () => {
  const c = new Client(app.base);
  assert.match((await c.post('/signup', { username: 'ab', password: 'password123', password2: 'password123', age21: 'on' })).text, /Username must be/);
  assert.match((await c.post('/signup', { username: 'alice', password: 'short', password2: 'short', age21: 'on' })).text, /Password must be/);
  assert.match((await c.post('/signup', { username: 'alice', password: 'password123', password2: 'different1', age21: 'on' })).text, /do not match/);
  assert.match((await c.post('/signup', { username: 'alice', password: 'password123', password2: 'password123' })).text, /21 or older/);
  const ok = await c.signup('alice');
  assert.equal(ok.status, 302);
  const row = app.db.prepare('SELECT * FROM users WHERE username = ?').get('alice');
  assert.ok(row.password_hash.startsWith('$2'), 'bcrypt hash stored');
  assert.notEqual(row.password_hash, 'password123');
  assert.equal(row.is_admin, 1, 'first user is admin');
  const dup = await new Client(app.base).signup('ALICE');
  assert.match(dup.text, /taken/);
  const second = new Client(app.base); await second.signup('bob');
  assert.equal(app.db.prepare('SELECT is_admin FROM users WHERE username = ?').get('bob').is_admin, 0);
});

test('session token is stored hashed, login/logout work', async () => {
  const c = new Client(app.base);
  assert.equal((await c.login('alice', 'wrongpass1')).status, 401);
  const r = await c.login('alice');
  assert.equal(r.status, 302);
  const sid = c.jar.sid;
  assert.ok(sid && sid.length === 64);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM sessions WHERE id = ?').get(sid).n, 0, 'raw cookie token must not be in the DB');
  assert.ok((await c.get('/')).text.includes('@alice'));
  await c.post('/logout');
  assert.ok(!(await c.get('/')).text.includes('Log out'));
});

test('cookies are HttpOnly + SameSite and CSRF is enforced', async () => {
  const c = new Client(app.base);
  const res = await fetch(app.base + '/login');
  const cookies = res.headers.getSetCookie().join('\n');
  assert.match(cookies, /HttpOnly/); assert.match(cookies, /SameSite=Lax/);
  const bad = await c.post('/login', { username: 'alice', password: 'password123' }, { noCsrf: true });
  assert.equal(bad.status, 403);
  const forged = await c.post('/login', { username: 'alice', password: 'password123', _csrf: 'f'.repeat(48) });
  assert.equal(forged.status, 403);
});

test('security headers present and open redirects are blocked', async () => {
  const res = await fetch(app.base + '/');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  const c = new Client(app.base);
  const r = await c.post('/login', { username: 'alice', password: 'password123', next: '//evil.example' });
  assert.equal(r.location, '/');
});

test('login is throttled per account after repeated failures', async () => {
  const c = new Client(app.base);
  let last;
  for (let i = 0; i < 10; i++) last = await c.login('bob', 'nope-nope-' + i);
  assert.equal(last.status, 429);
});

test('footer disclaimer appears on every page', async () => {
  const c = new Client(app.base); await c.login('alice');
  const footer = '21+ | Bet responsibly | 1-800-GAMBLER | Not financial advice. For entertainment and education only.';
  for (const p of ['/', '/login', '/signup', '/markets', '/markets/jp', '/sports', '/sports/feed', '/sports/teams', '/sports/leaderboard', '/t/AAPL', '/votes', '/notifications', '/groups', '/leaderboard', '/post/new', '/settings', '/friends', '/admin', '/u/alice', '/nope-404', '/offline']) {
    const r = await c.get(p);
    assert.ok(r.text.includes(footer), 'footer missing on ' + p + ' (' + r.status + ')');
  }
});
