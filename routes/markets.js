// Global Markets picker, live markets panel and live sports scoreboard
// (pages + JSON endpoints used by the auto-refresh script in public/live.js).
module.exports = function (app, ctx) {
  const { db, config } = ctx;
  const { marketdata, scores } = ctx.services;

  app.get('/api/markets', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(marketdata.snapshot()); });
  app.get('/api/scores', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(scores.snapshot()); });

  app.get('/markets', (req, res) => {
    res.render('markets', { snap: marketdata.snapshot(), selected: null, marketCards: ctx.featuredMarketCards(req.user), backUrl: req.originalUrl, pageTitle: 'Markets', sidebar: false });
  });

  app.get('/markets/:key', (req, res) => {
    const snap = marketdata.snapshot();
    const sel = snap.world.find(w => w.key === req.params.key);
    if (!sel) return res.status(404).render('error', { title: 'Not found', message: 'Unknown market.' });
    const me = req.user ? req.user.id : 0;
    const posts = db.prepare(ctx.postSelect('AND p.exchange = @ex AND (p.group_id IS NULL OR g.privacy = \'public\')') + ' LIMIT 20').all({ me, ex: sel.key });
    sel.channels = db.prepare(`SELECT c.id, c.name, c.group_id, g.name AS group_name, (g.privacy = 'private') AS private
      FROM group_channels c JOIN user_groups g ON g.id = c.group_id
      WHERE c.exchange = @ex AND g.deleted = 0 AND (g.privacy = 'public' OR EXISTS(SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = @me AND m.status = 'active'))
      ORDER BY g.name LIMIT 30`).all({ me, ex: sel.key });
    const cat = require('../services/votes').catalog();
    const voteCards = Object.values(cat).filter(i => i.market === sel.key && /^\^/.test(i.symbol)).map(i => ctx.marketCard(i, req.user, null));
    res.render('markets', { snap, selected: sel, voteCards, posts, backUrl: req.originalUrl, pageTitle: sel.name + ' market', sidebar: false });
  });
};
