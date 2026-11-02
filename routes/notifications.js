// In-app notifications (bell in the header): comments, friend requests, group approvals, graded votes.
module.exports = function (app, ctx) {
  const { db, requireLogin } = ctx;
  app.get('/notifications', requireLogin, (req, res) => {
    const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 60').all(req.user.id);
    res.render('notifications', { rows, pageTitle: 'Notifications', sidebar: false });
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(req.user.id);
  });
  app.post('/notifications/clear', requireLogin, (req, res) => {
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
    res.redirect('/notifications');
  });
};
