// Facebook-style friends (mutual, request/accept). Follows (one-way) live in server.js.
module.exports = function (app, ctx) {
  const { db, config, requireLogin } = ctx;

  const findUser = (name) => db.prepare('SELECT id, username FROM users WHERE username = ? AND banned = 0').get(name);
  const rel = (a, b) => db.prepare('SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)').get(a, b, b, a);

  app.get('/friends', requireLogin, (req, res) => {
    const me = req.user.id;
    const incoming = db.prepare(`SELECT u.username, f.created_at FROM friendships f JOIN users u ON u.id = f.requester_id WHERE f.addressee_id = ? AND f.status = 'pending' AND u.banned = 0 ORDER BY f.created_at DESC`).all(me);
    const outgoing = db.prepare(`SELECT u.username FROM friendships f JOIN users u ON u.id = f.addressee_id WHERE f.requester_id = ? AND f.status = 'pending' AND u.banned = 0`).all(me);
    const friends = db.prepare(`SELECT u.username, u.bio FROM friendships f JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
      WHERE f.status = 'accepted' AND (f.requester_id = ? OR f.addressee_id = ?) AND u.banned = 0 ORDER BY u.username`).all(me, me, me);
    const following = db.prepare(`SELECT u.username FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ? AND u.banned = 0 ORDER BY u.username`).all(me);
    res.render('friends', { incoming, outgoing, friends, following, pageTitle: 'Friends', sidebar: false });
  });

  // One endpoint, state machine: none -> request, incoming -> accept, accepted/outgoing -> remove/cancel.
  app.post('/u/:username/friend', requireLogin, (req, res) => {
    const other = findUser(req.params.username);
    if (!other || other.id === req.user.id) return res.redirect('/');
    const r = rel(req.user.id, other.id);
    if (!r) {
      const n = db.prepare(`SELECT COUNT(*) n FROM friendships WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'`).get(req.user.id, req.user.id).n;
      if (n < config.maxFriends) { db.prepare('INSERT INTO friendships (requester_id, addressee_id) VALUES (?, ?)').run(req.user.id, other.id); require('../services/notify').notify(other.id, 'friend', `@${req.user.username} sent you a friend request`, '/friends'); }
    } else if (r.status === 'pending' && r.addressee_id === req.user.id) {
      db.prepare(`UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ?`).run(r.requester_id, r.addressee_id); require('../services/notify').notify(r.requester_id, 'friend', `@${req.user.username} accepted your friend request`, '/u/' + req.user.username);
    } else {
      db.prepare('DELETE FROM friendships WHERE requester_id = ? AND addressee_id = ?').run(r.requester_id, r.addressee_id);
    }
    res.redirect(ctx.safeBack(req.body.back, '/u/' + other.username));
  });
  app.post('/u/:username/friend/decline', requireLogin, (req, res) => {
    const other = findUser(req.params.username);
    if (other) db.prepare(`DELETE FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`).run(other.id, req.user.id);
    res.redirect(ctx.safeBack(req.body.back, '/friends'));
  });

  // exposed for the profile page
  ctx.friendState = function (meId, otherId) {
    if (!meId || meId === otherId) return 'self';
    const r = rel(meId, otherId);
    if (!r) return 'none';
    if (r.status === 'accepted') return 'friends';
    return r.requester_id === meId ? 'outgoing' : 'incoming';
  };
};
