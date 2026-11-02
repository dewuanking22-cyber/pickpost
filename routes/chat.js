// Discord-style channels + real-time chat (socket.io) inside groups.
// Access rule: you must be an ACTIVE member of the group to read or write its channels.
const { Server } = require('socket.io');

module.exports = function (app, ctx) {
  const { db, config, lib, requireLogin, group } = ctx;
  const NAME_RE = /^[a-z0-9][a-z0-9-]{1,23}$/;

  const getChannel = (gid, cid) => db.prepare('SELECT * FROM group_channels WHERE id = ? AND group_id = ?').get(cid, gid);
  const msgRows = (cid, limit = 60) => db.prepare(`SELECT * FROM (
      SELECT m.id, m.body, m.card, m.created_at, m.user_id, u.username,
             (SELECT role FROM group_members gm JOIN group_channels c ON c.group_id = gm.group_id WHERE c.id = m.channel_id AND gm.user_id = m.user_id AND gm.status = 'active') AS role
      FROM messages m JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? AND m.deleted = 0 ORDER BY m.id DESC LIMIT ?) ORDER BY id`).all(cid, limit).map(r => ({ ...r, card: r.card ? safeJson(r.card) : null }));
  const safeJson = (t) => { try { return JSON.parse(t); } catch (e) { return null; } };
  const rateHits = new Map();
  function rateOk(userId) {
    const now = Date.now();
    const arr = (rateHits.get(userId) || []).filter(t => now - t < 60000);
    if (arr.length >= config.maxMessagesPerMinute) { rateHits.set(userId, arr); return false; }
    arr.push(now); rateHits.set(userId, arr); return true;
  }
  function validateBody(raw) {
    const body = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!body) return { error: 'Message is empty.' };
    if (body.length > 500) return { error: 'Messages are limited to 500 characters.' };
    if (lib.hasLink(body)) return { error: 'Links are not allowed in chat.' };
    return { body };
  }
  function saveMessage(g, ch, user, body, card = null) {
    const info = db.prepare('INSERT INTO messages (channel_id, user_id, body, card) VALUES (?, ?, ?, ?)').run(ch.id, user.id, body, card ? JSON.stringify(card) : null);
    const row = db.prepare('SELECT created_at FROM messages WHERE id = ?').get(info.lastInsertRowid);
    return { id: info.lastInsertRowid, channelId: ch.id, userId: user.id, username: user.username, role: group.role(g, user), body, card, created_at: row.created_at };
  }
  // Used by the vote-sharing route: post a vote card into a channel (caller has already checked membership).
  ctx.shareToChannel = (g, ch, user, body, card) => { const m = saveMessage(g, ch, user, body, card); emit('message', ch.id, m); return m; };
  let io = null;
  const emit = (ev, cid, payload) => { if (io) io.to('ch:' + cid).emit(ev, payload); };

  // ----- pages -----
  app.get('/g/:id(\\d+)/c/:cid(\\d+)', requireLogin, (req, res) => {
    const g = group.load(req, res); if (!g) return;
    const m = group.membership(g.id, req.user);
    if (!m || m.status !== 'active') return res.redirect('/g/' + g.id);
    const ch = getChannel(g.id, req.params.cid);
    if (!ch) return res.status(404).render('error', { title: 'Not found', message: 'No such channel.' });
    const members = db.prepare(`SELECT u.username, m.role FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? AND m.status = 'active' ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'mod' THEN 1 ELSE 2 END, u.username LIMIT 100`).all(g.id);
    res.render('channel', {
      g, ch, channels: group.channelsOf(g.id), messages: msgRows(ch.id), members, error: req.query.err || null,
      isStaff: group.isStaff(g, req.user), pageTitle: `#${ch.name} · ${g.name}`, sidebar: false,
    });
  });

  // No-JS fallback + used by the form when sockets are unavailable.
  app.post('/g/:id(\\d+)/c/:cid(\\d+)/send', requireLogin, (req, res) => {
    const g = group.load(req, res); if (!g) return;
    const m = group.membership(g.id, req.user), ch = getChannel(g.id, req.params.cid);
    if (!m || m.status !== 'active' || !ch) return res.redirect('/g/' + g.id);
    const back = `/g/${g.id}/c/${ch.id}`;
    const v = validateBody(req.body.body);
    if (v.error) return res.redirect(back + '?err=' + encodeURIComponent(v.error));
    if (!rateOk(req.user.id)) return res.redirect(back + '?err=' + encodeURIComponent('Slow down a little.'));
    emit('message', ch.id, saveMessage(g, ch, req.user, v.body));
    res.redirect(back);
  });

  app.post('/g/:id(\\d+)/c/:cid(\\d+)/m/:mid(\\d+)/delete', requireLogin, (req, res) => {
    const g = group.load(req, res); if (!g) return;
    const ch = getChannel(g.id, req.params.cid);
    const msg = ch && db.prepare('SELECT * FROM messages WHERE id = ? AND channel_id = ?').get(req.params.mid, ch.id);
    if (msg && (msg.user_id === req.user.id || group.isStaff(g, req.user))) {
      db.prepare('UPDATE messages SET deleted = 1 WHERE id = ?').run(msg.id);
      emit('deleted', ch.id, { id: msg.id, channelId: ch.id });
    }
    res.redirect(ch ? `/g/${g.id}/c/${ch.id}` : '/g/' + g.id);
  });

  // ----- channel management (owner + mods) -----
  const staff = (req, res) => {
    const g = group.load(req, res); if (!g) return null;
    if (!group.isStaff(g, req.user) && !req.user.is_admin) { res.status(403).render('error', { title: 'Forbidden', message: 'Only owners and moderators can manage channels.' }); return null; }
    return g;
  };
  app.post('/g/:id(\\d+)/channels', requireLogin, (req, res) => {
    const g = staff(req, res); if (!g) return;
    const name = String(req.body.name || '').trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-');
    const topic = String(req.body.topic || '').trim().slice(0, 80);
    const err = (m) => res.redirect(`/g/${g.id}/manage?err=${encodeURIComponent(m)}`);
    const exchange = config.data.worldMarkets.some(w => w.key === req.body.exchange) ? req.body.exchange : null;
    if (!NAME_RE.test(name)) return err('Channel names are 2-24 characters: letters, numbers and dashes.');
    if (lib.hasLink(topic)) return err('Links are not allowed in topics.');
    if (db.prepare('SELECT COUNT(*) n FROM group_channels WHERE group_id = ?').get(g.id).n >= config.maxChannelsPerGroup) return err('Channel limit reached.');
    if (db.prepare('SELECT 1 FROM group_channels WHERE group_id = ? AND name = ?').get(g.id, name)) return err('That channel already exists.');
    const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 p FROM group_channels WHERE group_id = ?').get(g.id).p;
    db.prepare('INSERT INTO group_channels (group_id, name, topic, position, exchange) VALUES (?, ?, ?, ?, ?)').run(g.id, name, topic, pos, exchange);
    res.redirect(`/g/${g.id}/manage?ok=${encodeURIComponent('Channel #' + name + ' created.')}`);
  });
  app.post('/g/:id(\\d+)/channels/:cid(\\d+)/delete', requireLogin, (req, res) => {
    const g = staff(req, res); if (!g) return;
    const n = db.prepare('SELECT COUNT(*) n FROM group_channels WHERE group_id = ?').get(g.id).n;
    if (n > 1) {
      db.prepare('DELETE FROM group_channels WHERE id = ? AND group_id = ?').run(req.params.cid, g.id);
      emit('channel-removed', req.params.cid, { channelId: Number(req.params.cid) });
    }
    res.redirect(`/g/${g.id}/manage`);
  });

  // ----- real-time (socket.io) -----
  ctx.onServer.push(function (server) {
    io = new Server(server, { serveClient: true, maxHttpBufferSize: 4e3 });
    ctx.io = io;
    // Same-origin only (prevents cross-site WebSocket hijacking) + cookie session auth.
    io.use((socket, next) => {
      const h = socket.request.headers;
      if (h.origin) { try { if (new URL(h.origin).host !== h.host) return next(new Error('bad origin')); } catch (e) { return next(new Error('bad origin')); } }
      const user = ctx.sessionUser(ctx.parseCookies(h.cookie).sid);
      if (!user) return next(new Error('login required'));
      socket.user = user;
      next();
    });
    io.on('connection', (socket) => {
      socket.on('join', (cid, ack) => {
        const ch = db.prepare('SELECT c.*, g.deleted FROM group_channels c JOIN user_groups g ON g.id = c.group_id WHERE c.id = ?').get(Number(cid));
        const m = ch && !ch.deleted && group.membership(ch.group_id, socket.user);
        if (!m || m.status !== 'active') return ack && ack({ ok: false });
        socket.join('ch:' + ch.id);
        ack && ack({ ok: true });
      });
      socket.on('message', (payload, ack) => {
        payload = payload || {};
        const ch = db.prepare('SELECT c.* FROM group_channels c JOIN user_groups g ON g.id = c.group_id WHERE c.id = ? AND g.deleted = 0').get(Number(payload.channelId));
        const m = ch && group.membership(ch.group_id, socket.user);
        const reply = (o) => typeof ack === 'function' && ack(o);
        if (!m || m.status !== 'active') return reply({ ok: false, error: 'You are not a member of this group.' });
        const v = validateBody(payload.body);
        if (v.error) return reply({ ok: false, error: v.error });
        if (!rateOk(socket.user.id)) return reply({ ok: false, error: 'Slow down a little.' });
        const g = group.get(ch.group_id);
        emit('message', ch.id, saveMessage(g, ch, socket.user, v.body));
        reply({ ok: true });
      });
    });
  });
  // Called by the server when someone is removed from a group so they stop receiving messages immediately.
  ctx.kick = function (userId, groupId) {
    if (!io) return;
    const chans = db.prepare('SELECT id FROM group_channels WHERE group_id = ?').all(groupId).map(c => 'ch:' + c.id);
    for (const [, s] of io.sockets.sockets) if (s.user && s.user.id === userId) chans.forEach(r => s.leave(r));
  };
};
