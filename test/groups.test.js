const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, Client, stockPost, createPost } = require('./helpers');

let app, owner, mod, member, outsider, requester;
const names = ['owner', 'modguy', 'member1', 'outsider', 'requester'];
const uid = (n) => app.db.prepare('SELECT id FROM users WHERE username = ?').get(n).id;
const gidOf = (name) => app.db.prepare('SELECT id FROM user_groups WHERE name = ?').get(name).id;
before(async () => {
  app = await boot();
  [owner, mod, member, outsider, requester] = names.map(() => new Client(app.base));
  for (const [i, c] of [owner, mod, member, outsider, requester].entries()) await c.signup(names[i]);
});
after(async () => { await app.close(); });

test('create public + private groups with default channels and validation', async () => {
  assert.match((await owner.post('/groups/new', { name: 'x', privacy: 'public' })).text, /Group name must be/);
  assert.match((await owner.post('/groups/new', { name: 'Spam www.x.com', privacy: 'public' })).text, /Links are not allowed/);
  const r = await owner.post('/groups/new', { name: 'Open Traders', description: 'Everyone welcome', privacy: 'public' });
  assert.equal(r.status, 302);
  await owner.post('/groups/new', { name: 'Inner Circle', description: 'Invite only', privacy: 'private' });
  assert.match((await outsider.post('/groups/new', { name: 'open traders', privacy: 'public' })).text, /already exists/i);
  const g = gidOf('Open Traders');
  const chans = app.db.prepare('SELECT name, exchange FROM group_channels WHERE group_id = ? ORDER BY position').all(g);
  assert.deepEqual(chans.map(c => c.name), ['general', 'stocks', 'crypto', 'forex', 'options', 'futures', 'sports-picks']);
  assert.equal(chans.find(c => c.name === 'crypto').exchange, 'crypto');
  assert.equal(app.db.prepare("SELECT role FROM group_members WHERE group_id = ? AND user_id = ?").get(g, uid('owner')).role, 'owner');
});

test('public group: anyone can join instantly, post to the group feed, and see posts', async () => {
  const g = gidOf('Open Traders');
  assert.match((await outsider.get(`/g/${g}`)).text, /Join group/);
  await member.post(`/g/${g}/join`);
  assert.equal(app.db.prepare('SELECT status FROM group_members WHERE group_id = ? AND user_id = ?').get(g, uid('member1')).status, 'active');
  const id = await createPost(member, stockPost({ subject: 'GRPPUB', group_id: String(g) }));
  assert.match((await outsider.get(`/g/${g}`)).text, /GRPPUB/);
  assert.match((await outsider.get('/')).text, /GRPPUB/, 'public group posts appear in the main feed');
  assert.equal((await outsider.get(`/post/${id}`)).status, 200);
  // non-member cannot post into the group
  const bad = await outsider.post('/post/new', stockPost({ group_id: String(g) }));
  assert.equal(bad.status, 400); assert.match(bad.text, /active member/);
  // member leaves; owner cannot leave
  await member.post(`/g/${g}/leave`);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM group_members WHERE group_id = ? AND user_id = ?').get(g, uid('member1')).n, 0);
  await owner.post(`/g/${g}/leave`);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM group_members WHERE group_id = ? AND user_id = ?').get(g, uid('owner')).n, 1);
});

test('private group: posts hidden from non-members, request/approve and invite link flows', async () => {
  const g = gidOf('Inner Circle');
  const id = await createPost(owner, stockPost({ subject: 'SECRET1', group_id: String(g) }));
  for (const c of [outsider, new Client(app.base)]) {
    assert.doesNotMatch((await c.get(`/g/${g}`)).text, /SECRET1/);
    assert.doesNotMatch((await c.get('/')).text, /SECRET1/);
    assert.equal((await c.get(`/post/${id}`)).status, 404);
  }
  assert.match((await outsider.get(`/g/${g}`)).text, /Request to join/);
  assert.doesNotMatch((await outsider.get('/leaderboard')).text, /SECRET1/);
  // private posts can't be reacted to / commented on by outsiders
  await outsider.post(`/post/${id}/react`, { kind: 'like' });
  await outsider.post(`/post/${id}/comment`, { body: 'let me in please' });
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM reactions WHERE post_id = ?').get(id).n, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM comments WHERE post_id = ?').get(id).n, 0);
  // request -> pending -> still hidden -> approved
  await requester.post(`/g/${g}/join`);
  assert.equal(app.db.prepare('SELECT status FROM group_members WHERE group_id = ? AND user_id = ?').get(g, uid('requester')).status, 'pending');
  assert.doesNotMatch((await requester.get(`/g/${g}`)).text, /SECRET1/);
  assert.equal((await outsider.get(`/g/${g}/manage`)).status, 403, 'non-staff cannot manage');
  assert.match((await owner.get(`/g/${g}/manage`)).text, /Join requests \(1\)/);
  await owner.post(`/g/${g}/member/${uid('requester')}/approve`);
  assert.match((await requester.get(`/g/${g}`)).text, /SECRET1/);
  assert.equal((await requester.get(`/post/${id}`)).status, 200);
  // invite link: wrong code fails, right code joins instantly, reset kills the old link
  const code = app.db.prepare('SELECT invite_code FROM user_groups WHERE id = ?').get(g).invite_code;
  assert.match((await member.get(`/g/${g}/invite/deadbeef`)).text, /not valid/);
  await member.post(`/g/${g}/invite/deadbeef`);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM group_members WHERE group_id = ? AND user_id = ?').get(g, uid('member1')).n, 0);
  assert.match((await member.get(`/g/${g}/invite/${code}`)).text, /Join Inner Circle/);
  await member.post(`/g/${g}/invite/${code}`);
  assert.equal(app.db.prepare('SELECT status FROM group_members WHERE group_id = ? AND user_id = ?').get(g, uid('member1')).status, 'active');
  await owner.post(`/g/${g}/invite-reset`);
  assert.notEqual(app.db.prepare('SELECT invite_code FROM user_groups WHERE id = ?').get(g).invite_code, code);
  // deny
  await outsider.post(`/g/${g}/join`);
  await owner.post(`/g/${g}/member/${uid('outsider')}/deny`);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM group_members WHERE group_id = ? AND user_id = ?').get(g, uid('outsider')).n, 0);
});

test('roles: owner promotes a mod; mods approve/remove members but not mods; members cannot manage', async () => {
  const g = gidOf('Inner Circle');
  await mod.post(`/g/${g}/invite/${app.db.prepare('SELECT invite_code FROM user_groups WHERE id = ?').get(g).invite_code}`);
  assert.equal((await member.post(`/g/${g}/member/${uid('modguy')}/promote`)).status, 403, 'plain member cannot promote');
  await owner.post(`/g/${g}/member/${uid('modguy')}/promote`);
  assert.equal(app.db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?').get(g, uid('modguy')).role, 'mod');
  assert.equal((await mod.get(`/g/${g}/manage`)).status, 200);
  // mod can remove a plain member, cannot touch the owner, cannot promote, cannot edit/delete the group
  await mod.post(`/g/${g}/member/${uid('owner')}/remove`);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM group_members WHERE group_id = ? AND user_id = ?').get(g, uid('owner')).n, 1);
  await mod.post(`/g/${g}/member/${uid('member1')}/promote`);
  assert.equal(app.db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?').get(g, uid('member1')).role, 'member');
  assert.equal((await mod.post(`/g/${g}/edit`, { name: 'Hijacked', privacy: 'public' })).status, 403);
  assert.equal((await mod.post(`/g/${g}/delete`)).status, 403);
  await mod.post(`/g/${g}/member/${uid('requester')}/remove`);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM group_members WHERE group_id = ? AND user_id = ?').get(g, uid('requester')).n, 0);
  // owner can demote mod
  await owner.post(`/g/${g}/member/${uid('modguy')}/demote`);
  assert.equal(app.db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?').get(g, uid('modguy')).role, 'member');
  await owner.post(`/g/${g}/member/${uid('modguy')}/promote`);
});

test('channels: staff add/delete, names validated, market tag stored; edit privacy; delete group', async () => {
  const g = gidOf('Inner Circle');
  assert.equal((await member.post(`/g/${g}/channels`, { name: 'nope' })).status, 403);
  await mod.post(`/g/${g}/channels`, { name: '#Nikkei Watch', topic: 'Asia open', exchange: 'jp' });
  const ch = app.db.prepare("SELECT * FROM group_channels WHERE group_id = ? AND name = 'nikkei-watch'").get(g);
  assert.ok(ch); assert.equal(ch.exchange, 'jp');
  const r = await owner.post(`/g/${g}/channels`, { name: 'bad name!!' });
  assert.match(decodeURIComponent(r.location), /Channel names/);
  assert.match((await owner.get('/markets/jp')).text, /nikkei-watch/, 'tagged channel listed on the market page for members');
  assert.doesNotMatch((await outsider.get('/markets/jp')).text, /nikkei-watch/, 'private channel hidden from non-members');
  await mod.post(`/g/${g}/channels/${ch.id}/delete`);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM group_channels WHERE id = ?').get(ch.id).n, 0);
  // edit: privacy flip
  await owner.post(`/g/${g}/edit`, { name: 'Inner Circle', description: 'Now open', privacy: 'public' });
  assert.equal(app.db.prepare('SELECT privacy FROM user_groups WHERE id = ?').get(g).privacy, 'public');
  await owner.post(`/g/${g}/edit`, { name: 'Inner Circle', description: 'Closed again', privacy: 'private' });
  // delete group hides it and its posts
  await owner.post(`/g/${g}/delete`);
  assert.equal((await owner.get(`/g/${g}`)).status, 404);
  assert.doesNotMatch((await owner.get('/')).text, /SECRET1/);
  assert.doesNotMatch((await owner.get('/groups')).text, /Inner Circle/);
});
