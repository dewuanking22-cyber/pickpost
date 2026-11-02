// The two-sided layout: Markets side, Sports side, Split view; pinned strips; shared items reachable from both.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Client } = require('./helpers');

let app, u;
before(async () => { app = await boot(); u = new Client(app.base); await u.signup('layoutlu'); });
after(async () => { await app.close(); });
const count = (text, re) => (text.match(re) || []).length;

test('default is the Markets side: ticker strip pinned, feed + vote cards, no scores strip', async () => {
  const c = new Client(app.base);
  const r = await c.get('/');
  assert.match(r.text, /data-mode="markets"/); assert.match(r.text, /class="switch"/);
  assert.match(r.text, /data-strip="markets"/); assert.doesNotMatch(r.text, /data-strip="sports"/);
  assert.match(r.text, /Vote on the market/); assert.match(r.text, /Markets feed/);
  for (const t of [/sw-markets on/, /href="\/mode\/sports\?next=/, /href="\/mode\/split\?next=/, /Groups/, /Leaderboard/]) assert.match(r.text, t);
});

test('switching to Sports: scores strip pinned, sports hub on /, choice is remembered', async () => {
  const c = new Client(app.base);
  const sw = await c.get('/mode/sports?next=%2F'); assert.equal(sw.status, 302); assert.equal(sw.location, '/');
  const r = await c.get('/');
  assert.match(r.text, /data-mode="sports"/); assert.match(r.text, /data-strip="sports"/); assert.doesNotMatch(r.text, /data-strip="markets"/);
  assert.match(r.text, /<h1>🏟️ Sports<\/h1>/); assert.match(r.text, /sw-sports on/); assert.match(r.text, /Sports feed/);
  assert.match((await c.get('/groups')).text, /data-strip="sports"/, 'shared pages keep the side you were on');
  assert.match((await c.get('/leaderboard')).text, /data-strip="sports"/);
  // visiting the other side's pages flips the side
  assert.match((await c.get('/markets')).text, /data-mode="markets"/);
  assert.match((await c.get('/')).text, /Vote on the market/);
  await c.get('/sports'); assert.match((await c.get('/')).text, /data-mode="sports"/);
});

test('Split view: both sides side by side on /, each pane with its own strip; both strips on other pages', async () => {
  const c = new Client(app.base);
  await c.get('/mode/split');
  const r = await c.get('/');
  assert.match(r.text, /id="split"/); assert.match(r.text, /pane-markets/); assert.match(r.text, /pane-sports/);
  assert.equal(count(r.text, /data-strip="markets"/g), 1); assert.equal(count(r.text, /data-strip="sports"/g), 1);
  assert.match(r.text, /data-pane-btn="markets"/); assert.match(r.text, /data-pane-btn="sports"/, 'tabs for narrow screens');
  assert.match(r.text, /sw-split on/);
  const other = await c.get('/groups'); assert.equal(count(other.text, /data-strip="markets"/g), 1); assert.equal(count(other.text, /data-strip="sports"/g), 1);
  await c.get('/sports'); assert.match((await c.get('/')).text, /id="split"/, 'visiting a side keeps split mode');
});

test('mode switch is safe: unknown modes fall back, redirects stay on-site, side pages never redirect away', async () => {
  const c = new Client(app.base);
  assert.equal((await c.get('/mode/evil')).status, 302);
  assert.equal((await c.get('/mode/sports?next=//evil.com')).location, '/');
  assert.equal((await c.get('/mode/markets?next=/groups')).location, '/groups');
  assert.equal((await c.get('/mode/sports?next=/sports/feed')).location, '/', 'side pages decide the side themselves');
  const r = await c.get('/'); assert.match(r.text, /data-mode="sports"/);
});

test('shared things reachable from both sides: profile, groups, notifications; footer on every page', async () => {
  const footer = '21+ | Bet responsibly | 1-800-GAMBLER | Not financial advice. For entertainment and education only.';
  for (const mode of ['markets', 'sports', 'split']) {
    await u.get('/mode/' + mode);
    const r = await u.get('/groups');
    assert.match(r.text, /href="\/u\/layoutlu"/); assert.match(r.text, /href="\/notifications"/); assert.match(r.text, /href="\/groups"/);
    assert.ok(r.text.includes(footer), 'footer in ' + mode);
    for (const p of ['/', '/sports', '/markets', '/votes', '/sports/feed']) assert.ok((await u.get(p)).text.includes(footer), `footer on ${p} in ${mode}`);
  }
});

test('no inline scripts or handlers (CSP) in any new page', async () => {
  for (const p of ['/', '/sports', '/t/AAPL', '/mode/split']) {
    const r = await u.get(p); if (r.status !== 200) continue;
    assert.doesNotMatch(r.text, /<script(?![^>]*\bsrc=)[^>]*>/); assert.doesNotMatch(r.text, /\son[a-z]+="/);
  }
  const csp = (await u.get('/')).headers.get('content-security-policy'); assert.match(csp, /script-src 'self'/);
});
