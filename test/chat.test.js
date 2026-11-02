const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { boot, Client } = require('./helpers');

let app, owner, member, outsider, gid, chId;
const uid = (n) => app.db.prepare('SELECT id FROM users WHERE username = ?').get(n).id;
const connect = (client, origin) => new Promise((resolve, reject) => {
  const s = io(app.base, { extraHeaders: { Cookie: client.cookieHeader(), ...(origin ? { Origin: origin } : {}) }, transports: ['websocket'], reconnection: false });
  s.on('connect', () => resolve(s)); s.on('connect_error', (e) => reject(e));
});
const emit = (s, ev, arg) => new Promise((r) => s.emit(ev, arg, r));
const once = (s, ev) => new Promise((r) => s.once(ev, r));

before(async () => {
  app = await boot();
  [owner, member, outsider] = [new Client(app.base), new Client(app.base), new Client(app.base)];
  await owner.signup('owner'); await member.signup('member1'); await outsider.signup('outsider');
  await owner.post('/groups/new', { name: 'Chat Room', privacy: 'private' });
  gid = app.db.prepare('SELECT id FROM user_groups').get().id;
  chId = app.db.prepare("SELECT id FROM group_channels WHERE name = 'crypto'").get().id;
  await member.post(`/g/${gid}/join`);
  await owner.post(`/g/${gid}/member/${uid('member1')}/approve`);
});
after(async () => { await app.close(); });

test('channel page: members only; renders history; HTTP fallback send works', async () => {
  assert.equal((await outsider.get(`/g/${gid}/c/${chId}`)).status, 302);
  const page = await member.get(`/g/${gid}/c/${chId}`);
  assert.equal(page.status, 200); assert.match(page.text, /# crypto/);
  await member.post(`/g/${gid}/c/${chId}/send`, { body: 'hello from the no-JS form' });
  assert.match((await owner.get(`/g/${gid}/c/${chId}`)).text, /hello from the no-JS form/);
  const bad = await member.post(`/g/${gid}/c/${chId}/send`, { body: 'visit spam.com now' });
  assert.match(decodeURIComponent(bad.location), /Links are not allowed/);
});

test('websocket: auth required, same-origin only, join restricted to members', async () => {
  await assert.rejects(connect(new Client(app.base)), /login required/);
  await assert.rejects(connect(owner, 'https://evil.example'), /bad origin/);
  const out = await connect(outsider);
  assert.deepEqual(await emit(out, 'join', chId), { ok: false });
  const r = await emit(out, 'message', { channelId: chId, body: 'sneaky' });
  assert.equal(r.ok, false);
  assert.equal(app.db.prepare("SELECT COUNT(*) n FROM messages WHERE body = 'sneaky'").get().n, 0);
  out.close();
});

test('websocket: real-time delivery between members, validation, moderation delete', async () => {
  const a = await connect(owner), b = await connect(member);
  assert.deepEqual(await emit(a, 'join', chId), { ok: true });
  assert.deepEqual(await emit(b, 'join', chId), { ok: true });
  const got = once(a, 'message');
  assert.deepEqual(await emit(b, 'message', { channelId: chId, body: 'BTC breaking out 🚀' }), { ok: true });
  const m = await got;
  assert.equal(m.body, 'BTC breaking out 🚀'); assert.equal(m.username, 'member1'); assert.equal(m.role, 'member');
  assert.equal((await emit(b, 'message', { channelId: chId, body: '   ' })).ok, false);
  assert.match((await emit(b, 'message', { channelId: chId, body: 'x'.repeat(501) })).error, /500/);
  assert.match((await emit(b, 'message', { channelId: chId, body: 'check www.pump.com' })).error, /Links/);
  // owner (staff) deletes a message -> broadcast
  const del = once(b, 'deleted');
  await owner.post(`/g/${gid}/c/${chId}/m/${m.id}/delete`);
  assert.equal((await del).id, m.id);
  assert.equal(app.db.prepare('SELECT deleted FROM messages WHERE id = ?').get(m.id).deleted, 1);
  // removed member stops receiving and cannot send
  const removed = new Promise((r) => b.once('message', () => r('received')));
  await owner.post(`/g/${gid}/member/${uid('member1')}/remove`);
  const reply = await emit(b, 'message', { channelId: chId, body: 'still here?' });
  assert.equal(reply.ok, false);
  await emit(a, 'message', { channelId: chId, body: 'owner only now' });
  const winner = await Promise.race([removed, new Promise((r) => setTimeout(() => r('silent'), 300))]);
  assert.equal(winner, 'silent');
  a.close(); b.close();
});

test('message rate limit', async () => {
  const a = await connect(owner);
  await emit(a, 'join', chId);
  let blocked = false;
  for (let i = 0; i < 30 && !blocked; i++) blocked = (await emit(a, 'message', { channelId: chId, body: 'spam ' + i })).ok === false;
  assert.ok(blocked, 'rate limiter kicked in');
  a.close();
});
