const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Client } = require('./helpers');
let app;
before(async () => { app = await boot(); });
after(async () => { await app.close(); });

test('migrations applied and idempotent', () => {
  const rows = app.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r => r.version);
  assert.deepEqual(rows, ['001_init.sql', '002_market_tags.sql', '003_votes_sports.sql']);
  assert.deepEqual(app.db.migrate(), []);
});
test('PWA: manifest, service worker, icons, offline page', async () => {
  const m = await (await fetch(app.base + '/manifest.webmanifest')).json();
  assert.equal(m.display, 'standalone'); assert.equal(m.name, 'PickPost'); assert.ok(m.icons.some(i => i.sizes === '512x512'));
  for (const i of m.icons) assert.equal((await fetch(app.base + i.src)).status, 200);
  const sw = await fetch(app.base + '/sw.js'); assert.equal(sw.status, 200); assert.match(sw.headers.get('content-type'), /javascript/);
  const home = await (await fetch(app.base + '/')).text();
  assert.match(home, /rel="manifest"/); assert.match(home, /theme-color/);
});
test('JSON APIs, health and 404 handling', async () => {
  assert.equal(await (await fetch(app.base + '/healthz')).text(), 'ok');
  const mk = await (await fetch(app.base + '/api/markets')).json();
  assert.equal(mk.world.length, 12); assert.ok(mk.world.every(w => w.status && w.status.label));
  const sc = await (await fetch(app.base + '/api/scores')).json();
  assert.ok(Array.isArray(sc.leagues));
  assert.equal((await fetch(app.base + '/markets/atlantis')).status, 404);
  assert.equal((await fetch(app.base + '/definitely-not-here')).status, 404);
});
test('markets pages degrade gracefully with no data source', async () => {
  const c = new Client(app.base);
  const all = await c.get('/markets');
  assert.equal(all.status, 200);
  for (const name of ['US', 'London', 'Frankfurt', 'Paris', 'Tokyo', 'Hong Kong', 'Shanghai', 'India', 'Toronto', 'Sydney', 'Crypto', 'Forex']) assert.match(all.text, new RegExp(name));
  assert.match(all.text, /Index data unavailable/);
  assert.match(all.text, /Open|Closed/);
  const jp = await c.get('/markets/jp');
  assert.match(jp.text, /Nikkei|Tokyo/); assert.match(jp.text, /09:00–11:30, 12:30–15:30/);
  assert.equal((await c.get('/sports')).status, 200);
  assert.equal((await c.get('/scores')).status, 301);
});
test('rebrand via environment/config', () => {
  const config = require('../config');
  assert.equal(typeof config.appName, 'string'); assert.ok(config.footerText.includes('1-800-GAMBLER'));
});
