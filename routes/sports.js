// Sports side: hub (today's games with vote cards), game pages, team pages, sports feed + leaderboards, voting + lines.
module.exports = function (app, ctx) {
  const { db, config, lib, requireLogin } = ctx;
  const { scores } = ctx.services;
  const votes = require('../services/votes');
  const leagues = config.data.leagues;
  const league = (k) => leagues.find(l => l.key === k);

  const cardFor = (g, user) => votes.gameCard(db.prepare('SELECT * FROM games WHERE id = ?').get(g.id), user ? user.id : 0);
  const wantsJson = (req) => /json/.test(req.get('accept') || '') || req.get('x-requested-with') === 'fetch';
  const sportsPosts = (me, extra = '', params = {}, limit = 15) =>
    db.prepare(ctx.postSelect(`AND p.category = 'sports' AND (p.group_id IS NULL OR g.privacy = 'public') ${extra}`) + ' LIMIT @lim').all({ me, lim: limit, ...params });

  // data for the hub (used by /sports, by / in sports mode, and the split view)
  ctx.sportsHubData = function (req, { leagueKey = '', filter = '', limit = 60 } = {}) {
    const snap = scores.snapshot();
    let games = scores.slate(leagueKey || null);
    if (filter === 'live') games = games.filter(g => g.state === 'in');
    else if (filter === 'upcoming') games = games.filter(g => g.state === 'pre');
    else if (filter === 'final') games = games.filter(g => g.state === 'post');
    games = games.slice(0, limit);
    const cards = games.map(g => cardFor(g, req.user));
    return { snap, cards, leagueKey, filter, posts: sportsPosts(req.user ? req.user.id : 0, '', {}, 8) };
  };
  ctx.sportsHub = function (req, res) {
    const leagueKey = league(req.query.league) ? req.query.league : '';
    const filter = ['live', 'upcoming', 'final'].includes(req.query.filter) ? req.query.filter : '';
    res.render('sports', { ...ctx.sportsHubData(req, { leagueKey, filter }), pageTitle: 'Sports', backUrl: req.originalUrl, sidebar: true });
  };

  app.get('/sports', (req, res) => ctx.sportsHub(req, res));
  app.get('/scores', (req, res) => res.redirect(301, '/sports' + (req.query.league ? '?league=' + encodeURIComponent(req.query.league) : '')));

  // sports-only feed (same filters as the main feed, sports category)
  app.get('/sports/feed', (req, res) => ctx.renderFeed(req, res, { basePath: '/sports/feed', side: 'sports' }));

  // ---- teams ----
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  app.get('/sports/teams', wrap(async (req, res) => {
    const lk = league(req.query.league) ? req.query.league : 'nba';
    const teams = await scores.teamList(lk);
    const seen = db.prepare(`SELECT home_id id, home_name name, home_abbr abbr FROM games WHERE league = ? UNION SELECT away_id, away_name, away_abbr FROM games WHERE league = ? ORDER BY name`).all(lk, lk);
    res.render('teams', { lk, teams: teams.length ? teams : seen, pageTitle: 'Teams', sidebar: true });
  }));
  app.get('/team/:league/:id', wrap(async (req, res) => {
    const l = league(req.params.league);
    const t = l && /^\d+$/.test(req.params.id) ? await scores.teamInfo(l.key, req.params.id) : null;
    if (!t) return res.status(404).render('error', { title: 'Not found', message: 'Team not found.' });
    const me = req.user ? req.user.id : 0;
    const games = db.prepare(`SELECT * FROM games WHERE league = ? AND (home_id = ? OR away_id = ?) ORDER BY starts_at DESC LIMIT 12`).all(l.key, t.id, t.id).map(scores.toGame);
    const next = games.filter(g => g.state !== 'post').sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] || null;
    const posts = sportsPosts(me, `AND (p.subject LIKE @t ESCAPE '\\' OR p.pick LIKE @t ESCAPE '\\')`, { t: '%' + t.name.split(' ').pop().replace(/[\\\\%_]/g, '') + '%' }, 8);
    res.render('team', { t, games, nextCard: next ? cardFor(next, req.user) : null, posts, backUrl: req.originalUrl, pageTitle: t.name, sidebar: true });
  }));

  // ---- game page ----
  app.get('/game/:gid', (req, res) => {
    const g = scores.gameById(req.params.gid);
    if (!g) return res.status(404).render('error', { title: 'Not found', message: 'We have no record of that game (only games seen on the live scoreboard are tracked).' });
    const me = req.user ? req.user.id : 0;
    const posts = db.prepare(ctx.postSelect(`AND p.game_id = @gid AND p.kind = 'idea' AND (p.group_id IS NULL OR g.privacy = 'public')`) + ' LIMIT 20').all({ me, gid: g.id });
    const shared = db.prepare(ctx.postSelect(`AND p.game_id = @gid AND p.kind = 'game_vote' AND (p.group_id IS NULL OR g.privacy = 'public')`) + ' LIMIT 10').all({ me, gid: g.id });
    const recent = db.prepare(`SELECT u.username, v.market, v.pick, v.result FROM game_votes v JOIN users u ON u.id = v.user_id WHERE v.game_id = ? AND u.banned = 0 ORDER BY v.updated_at DESC LIMIT 12`).all(g.id);
    const lines = { total: db.prepare(`SELECT * FROM game_lines WHERE game_id = ? AND market = 'total'`).get(g.id), spread: db.prepare(`SELECT * FROM game_lines WHERE game_id = ? AND market = 'spread'`).get(g.id) };
    res.render('game', { g, card: cardFor(g, req.user), posts, shared, recent, lines, backUrl: req.originalUrl, error: req.query.err || null, ok: req.query.ok || null, pageTitle: `${g.away.name} @ ${g.home.name}`, sidebar: true });
  });
  // HTML fragment of a vote card (used to refresh cards in place)
  app.get('/game/:gid/card', (req, res) => {
    const g = scores.gameById(req.params.gid); if (!g) return res.status(404).send('');
    res.render('partials/gamecard', { c: cardFor(g, req.user), back: ctx.safeBack(req.query.back, '/game/' + g.id) });
  });

  // ---- voting ----
  app.post('/game/:gid/vote', requireLogin, (req, res) => {
    const g = scores.gameById(req.params.gid);
    if (!g) return res.status(404).render('error', { title: 'Not found', message: 'Unknown game.' });
    const b = req.body;
    const r = b.remove === '1' ? votes.removeGameVote(req.user.id, g.id, b.market)
      : votes.castGameVote({ userId: req.user.id, gameId: g.id, market: b.market, pick: b.pick, line: b.line === undefined || b.line === '' ? null : Number(b.line) });
    const back = ctx.safeBack(b.back, '/game/' + g.id);
    if (wantsJson(req)) {
      if (r.error) return res.status(400).json({ error: r.error });
      return res.render('partials/gamecard', { c: cardFor(g, req.user), back }, (e, html) => e ? res.status(500).json({ error: 'render' }) : res.json({ ok: true, html }));
    }
    const sep = back.includes('?') ? '&' : '?';
    res.redirect(r.error ? `${back}${sep}err=${encodeURIComponent(r.error)}#g-${g.id}` : `${back}#g-${g.id}`);
  });
  // admin sets / overrides a line
  app.post('/game/:gid/line', requireLogin, ctx.requireAdmin, (req, res) => {
    const g = scores.gameById(req.params.gid); if (!g) return res.redirect('/sports');
    if (req.body.clear === '1') db.prepare('DELETE FROM game_lines WHERE game_id = ? AND market = ?').run(g.id, req.body.market);
    else { const r = votes.setGameLine(g.id, req.body.market, Number(req.body.line), req.user.id, 'admin'); if (r.error) return res.redirect(`/game/${g.id}?err=${encodeURIComponent(r.error)}`); }
    res.redirect(`/game/${g.id}?ok=${encodeURIComponent('Line updated.')}`);
  });

  // ---- sports leaderboard (votes or picks) ----
  app.get('/sports/leaderboard', (req, res) => {
    const by = req.query.by === 'picks' ? 'picks' : 'votes';
    const lk = league(req.query.league) ? req.query.league : '';
    const market = ['moneyline', 'total', 'spread'].includes(req.query.market) ? req.query.market : '';
    let rows;
    if (by === 'votes') rows = votes.boardGames({ league: lk, market });
    else rows = ctx.picksBoard('sports');
    res.render('sports-leaderboard', { by, lk, market, rows, min: by === 'votes' ? config.votes.leaderboardMin : config.leaderboardMinSettled, pageTitle: 'Sports leaderboard', sidebar: true });
  });
};
