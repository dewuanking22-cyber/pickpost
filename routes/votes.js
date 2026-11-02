// Market votes (up/down for today or this week), vote pages, sharing votes to the feed / group channels, "my votes".
module.exports = function (app, ctx) {
  const { db, config, lib, requireLogin } = ctx;
  const { marketdata } = ctx.services;
  const votes = require('../services/votes');
  const prices = require('../services/prices');
  const CAT = votes.catalog();
  const wantsJson = (req) => /json/.test(req.get('accept') || '') || req.get('x-requested-with') === 'fetch';

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  ctx.voteRecord = votes.voteRecord;

  // quote shown on a vote card: cached ticker data first, then the price provider (short timeout)
  function cachedQuote(sym) {
    const snap = marketdata.snapshot();
    for (const s of snap.sections) { const i = s.items.find(x => x.ysym === sym); if (i) return { price: i.price, changePct: i.changePct }; }
    for (const w of snap.world) { const i = (w.indices || []).find(x => x.ysym === sym); if (i) return { price: i.price, changePct: i.changePct }; }
    return null;
  }
  async function quoteFor(sym) {
    const c = cachedQuote(sym); if (c) return c;
    if (!config.data.enabled) return null;
    try { return await Promise.race([prices.provider.quote(sym), new Promise((_, rej) => setTimeout(() => rej(new Error('t')), 2500))]); } catch (e) { return null; }
  }
  const mcard = (info, user, quote) => ({ info, rounds: votes.marketCard(info, user ? user.id : 0), quote });

  ctx.featuredMarketCards = (user) => config.votes.featured.map(f => CAT[f.symbol]).filter(Boolean).map(info => mcard(info, user, cachedQuote(info.symbol)));
  ctx.marketCard = mcard;

  ctx.shareTargets = function (user) {
    if (!user) return [];
    const out = [{ value: 'feed', label: '📰 Main feed' }];
    db.prepare(`SELECT g.id, g.name FROM group_members m JOIN user_groups g ON g.id = m.group_id WHERE m.user_id = ? AND m.status = 'active' AND g.deleted = 0 ORDER BY g.name LIMIT 12`).all(user.id).forEach(g => {
      out.push({ value: 'g:' + g.id, label: '👥 ' + g.name + ' (group feed)' });
      db.prepare('SELECT id, name FROM group_channels WHERE group_id = ? ORDER BY position, id LIMIT 12').all(g.id).forEach(c => out.push({ value: `c:${g.id}:${c.id}`, label: `# ${c.name} · ${g.name}` }));
    });
    return out;
  };

  // Unknown tickers cost an outbound lookup, so they are rate limited per IP (catalog symbols are free).
  const looks = new Map();
  const lookupOk = (req) => {
    const now = Date.now(), arr = (looks.get(req.ip) || []).filter(t => now - t < 60000);
    if (arr.length >= 20) { looks.set(req.ip, arr); return false; }
    arr.push(now); looks.set(req.ip, arr); return true;
  };
  setInterval(() => { const n = Date.now(); for (const [k, v] of looks) if (!v.some(t => n - t < 60000)) looks.delete(k); }, 120000).unref();
  const resolve = async (req, sym) => {
    const key = Object.keys(CAT).find(k => k.toLowerCase() === String(sym).toLowerCase());
    if (!key && !lookupOk(req)) return null;
    return votes.resolveSymbol(sym);
  };

  // ---- ticker / market page with the vote card ----
  app.get('/t/:sym', wrap(async (req, res) => {
    const info = await resolve(req, req.params.sym);
    if (!info) return res.status(404).render('error', { title: 'Not found', message: 'We can only run votes on tickers from the market list or US-listed symbols (1-5 letters).' });
    const me = req.user ? req.user.id : 0;
    const quote = await quoteFor(info.symbol);
    const base = info.symbol.replace(/-USD$|=X$|=F$/, '').replace(/^\^/, '');
    const like = '%' + base.replace(/[\\%_]/g, '\\$&') + '%';
    const posts = db.prepare(ctx.postSelect(`AND p.kind = 'idea' AND p.category != 'sports' AND p.subject LIKE @like ESCAPE '\\' AND (p.group_id IS NULL OR g.privacy = 'public')`) + ' LIMIT 10').all({ me, like });
    const history = me ? db.prepare('SELECT * FROM market_votes WHERE user_id = ? AND symbol = ? ORDER BY starts_at DESC LIMIT 10').all(me, info.symbol) : [];
    res.render('ticker-page', { c: mcard(info, req.user, quote), posts, history, backUrl: req.originalUrl, error: req.query.err || null, ok: req.query.ok || null, pageTitle: info.label, sidebar: true });
  }));
  app.get('/t/:sym/card', wrap(async (req, res) => {
    const info = await resolve(req, req.params.sym); if (!info) return res.status(404).send('');
    res.render('partials/mvcard', { c: mcard(info, req.user, cachedQuote(info.symbol)), back: ctx.safeBack(req.query.back, '/t/' + encodeURIComponent(info.symbol)) });
  }));
  app.post('/t/:sym/vote', requireLogin, wrap(async (req, res) => {
    const info = await resolve(req, req.params.sym);
    if (!info) return res.status(404).render('error', { title: 'Not found', message: 'Unknown symbol.' });
    const b = req.body;
    const r = b.remove === '1' ? votes.removeMarketVote(req.user.id, info.symbol, b.timeframe, b.starts) : votes.castMarketVote({ userId: req.user.id, info, timeframe: b.timeframe, starts: b.starts, direction: b.direction, target: b.target });
    const back = ctx.safeBack(b.back, '/t/' + encodeURIComponent(info.symbol));
    if (wantsJson(req)) {
      if (r.error) return res.status(400).json({ error: r.error });
      return res.render('partials/mvcard', { c: mcard(info, req.user, cachedQuote(info.symbol)), back }, (e, html) => e ? res.status(500).json({ error: 'render' }) : res.json({ ok: true, html }));
    }
    const sep = back.includes('?') ? '&' : '?';
    res.redirect(r.error ? `${back}${sep}err=${encodeURIComponent(r.error)}` : back);
  }));

  // ---- share a vote to the feed / a group / a channel ----
  app.post('/votes/share', requireLogin, (req, res) => {
    const b = req.body;
    const back = ctx.safeBack(b.back, '/votes');
    const fail = (m) => {
      if (wantsJson(req)) return res.status(400).json({ error: m });
      res.redirect(`${back}${back.includes('?') ? '&' : '?'}err=${encodeURIComponent(m)}`);
    };
    const type = b.type === 'market' ? 'market' : 'game';
    const v = db.prepare(`SELECT * FROM ${type === 'market' ? 'market_votes' : 'game_votes'} WHERE id = ? AND user_id = ?`).get(Number(b.id) || 0, req.user.id);
    if (!v) return fail('Pick one of your own votes to share.');
    const comment = String(b.comment || '').replace(/\s+/g, ' ').trim();
    if (comment.length > 240) return fail('Keep the note under 240 characters.');
    if (lib.hasLink(comment)) return fail('Links are not allowed.');
    let card;
    if (type === 'game') {
      const g = votes.getGame(v.game_id);
      card = { kind: 'game', title: `${g.away_name} @ ${g.home_name}`, pick: `${votes.voteDescr(g, v)} · ${{ moneyline: 'Winner', total: 'Over/Under', spread: 'Spread' }[v.market]}`, href: '/game/' + g.id, ref: g.id, category: 'sports', voteId: v.id, type: 'game' };
    } else {
      const info = CAT[v.symbol] || { category: 'stocks' };
      card = { kind: 'market', title: v.label, pick: votes.marketText(v), href: '/t/' + encodeURIComponent(v.symbol), ref: v.symbol, category: info.category, voteId: v.id, type: 'market' };
    }
    const status = v.result === 'pending' ? 'open' : v.result === 'void' ? 'push' : v.result;
    const dest = String(b.dest || 'feed');
    if (dest.startsWith('c:')) {
      const [, gid, cid] = dest.split(':');
      const g = ctx.group.get(Number(gid)), m = g && ctx.group.membership(g.id, req.user);
      const ch = g && db.prepare('SELECT * FROM group_channels WHERE id = ? AND group_id = ?').get(Number(cid), g.id);
      if (!m || m.status !== 'active' || !ch) return fail('You can only share to groups you are a member of.');
      ctx.shareToChannel(g, ch, req.user, comment, { ...card, status });
      return done(`Shared to #${ch.name}.`, `/g/${g.id}/c/${ch.id}`);
    }
    let gid = null;
    if (dest.startsWith('g:')) {
      const g = ctx.group.get(Number(dest.slice(2))), m = g && ctx.group.membership(g.id, req.user);
      if (!m || m.status !== 'active') return fail('You can only share to groups you are a member of.');
      gid = g.id;
    } else if (dest !== 'feed') return fail('Choose where to share.');
    const kind = type === 'market' ? 'market_vote' : 'game_vote';
    if (db.prepare('SELECT 1 FROM posts WHERE kind = ? AND vote_id = ? AND deleted = 0 AND COALESCE(group_id, 0) = ?').get(kind, v.id, gid || 0)) return fail('You already shared this vote there.');
    const recent = db.prepare(`SELECT COUNT(*) n FROM posts WHERE user_id = ? AND created_at > datetime('now','-1 hour')`).get(req.user.id).n;
    if (recent >= config.maxPostsPerHour) return fail('Posting limit reached. Try again later.');
    const info = db.prepare(`INSERT INTO posts (user_id, group_id, category, subject, pick, reasoning, status, kind, vote_id, game_id, settled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${status === 'open' ? 'NULL' : "datetime('now')"})`)
      .run(req.user.id, gid, card.category, card.title, card.pick, comment || (type === 'market' ? 'My market vote.' : 'My game vote.'), status, kind, v.id, card.ref);
    return done('Shared!', gid ? '/g/' + gid : '/#p' + info.lastInsertRowid);
    function done(msg, to) {
      if (wantsJson(req)) return res.json({ ok: true, message: msg, href: to });
      res.redirect(`${back}${back.includes('?') ? '&' : '?'}ok=${encodeURIComponent(msg)}`);
    }
  });

  // ---- my votes ----
  app.get('/votes', requireLogin, (req, res) => {
    const games = db.prepare(`SELECT v.*, g.home_name, g.away_name, g.starts_at, g.league, g.state, g.home_score, g.away_score FROM game_votes v JOIN games g ON g.id = v.game_id WHERE v.user_id = ?
      ORDER BY (v.result = 'pending') DESC, g.starts_at DESC LIMIT 80`).all(req.user.id).map(v => ({ ...v, text: votes.voteDescr({ home_name: v.home_name, away_name: v.away_name }, v) }));
    const markets = db.prepare(`SELECT * FROM market_votes WHERE user_id = ? ORDER BY (result = 'pending') DESC, starts_at DESC LIMIT 80`).all(req.user.id);
    res.render('my-votes', { games, markets, rec: votes.voteRecord(req.user.id), shareTargets: ctx.shareTargets(req.user), backUrl: req.originalUrl, error: req.query.err || null, ok: req.query.ok || null, pageTitle: 'My votes', sidebar: false });
  });
};
