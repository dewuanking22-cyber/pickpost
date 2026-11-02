const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('./config');
const db = require('./db');
const lib = require('./lib');
const marketdata = require('./services/marketdata');
const scores = require('./services/scores');
const marketstatus = require('./services/marketstatus');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');
if (process.env.NODE_ENV !== 'test') app.use((req, res, next) => { const t = Date.now(); res.on('finish', () => { if (!/^\/(style\.css|app\.js|live\.js|chat\.js|icons|sw\.js)/.test(req.path) && !req.path.startsWith('/api/')) console.log(`${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${Date.now() - t}ms`); }); next(); });
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// ---------- security headers ----------
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...(config.secureCookies ? { 'Strict-Transport-Security': 'max-age=15552000; includeSubDomains' } : {}),
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; form-action 'self'; frame-ancestors 'none'",
  });
  next();
});

// ---------- cookies / session / csrf ----------
function parseCookies(h) {
  const out = {};
  (h || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function setCookie(res, name, value, maxAgeSec) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
  if (config.secureCookies) c += '; Secure';
  res.append('Set-Cookie', c);
}
const hashSid = (sid) => crypto.createHash('sha256').update(String(sid)).digest('hex'); // only a hash of the cookie token is stored
const q = {
  session: db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > datetime('now') AND u.banned = 0`),
  newSession: db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`),
  delSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
  purge: db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`),
};
setInterval(() => q.purge.run(), 3600e3).unref();

app.use((req, res, next) => {
  const ck = parseCookies(req.headers.cookie);
  let csrf = ck.csrf;
  if (!/^[a-f0-9]{48}$/.test(csrf || '')) { csrf = crypto.randomBytes(24).toString('hex'); setCookie(res, 'csrf', csrf, 86400 * 365); }
  req.csrf = csrf;
  req.sid = ck.sid;
  req.user = ck.sid ? q.session.get(hashSid(ck.sid)) || null : null;
  if (req.method === 'POST') {
    const sent = req.body && req.body._csrf;
    if (!sent || sent.length !== csrf.length || !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(csrf)))
      return res.status(403).render('error', { title: 'Session expired', message: 'Your form expired. Go back, refresh the page and try again.', ...base(req) });
  }
  // Two-sided layout: 'markets' | 'sports' | 'split'. Visiting a side-specific page remembers that side.
  let mode = ['markets', 'sports', 'split'].includes(ck.mode) ? ck.mode : 'markets';
  const pageSide = SPORTS_PATH.test(req.path) ? 'sports' : MARKETS_PATH.test(req.path) ? 'markets' : null;
  if (pageSide && mode !== 'split' && mode !== pageSide) { mode = pageSide; setCookie(res, 'mode', mode, 86400 * 365); }
  req.mode = mode;
  req.side = pageSide || (mode === 'sports' ? 'sports' : 'markets');
  Object.assign(res.locals, base(req));
  res.locals.flash = null;
  next();
});
const SPORTS_PATH = /^\/(sports|game|team|scores)(\/|$)/;
const MARKETS_PATH = /^\/(markets|t)(\/|$)/;
app.get('/mode/:m', (req, res) => {
  const m = ['markets', 'sports', 'split'].includes(req.params.m) ? req.params.m : 'markets';
  setCookie(res, 'mode', m, 86400 * 365);
  let next = safeBack(req.query.next, '/');
  if (SPORTS_PATH.test(next.split('?')[0]) || MARKETS_PATH.test(next.split('?')[0])) next = '/';
  res.redirect(next);
});

function base(req) {
  return {
    config, lib, me: req.user, csrf: req.csrf, path: req.path,
    markets: config.markets, mkt: lib.marketByKey,
    OPTION_PICKS: lib.OPTION_PICKS, TIMEFRAMES: lib.TIMEFRAMES,
    flash: null, pageTitle: null,
    worldMarkets: config.data.worldMarkets, wm: (k) => config.data.worldMarkets.find(w => w.key === k),
    reactions: config.reactions, marketStatus: marketstatus.all(),
    ticker: config.data.enabled ? tickerItems() : [],
    sideWorld: config.data.enabled ? marketdata.snapshot().world.map(w => ({ key: w.key, flag: w.flag, name: w.name, status: w.status, idx: w.indices[0] || null })) : [],
    sideLive: config.data.enabled ? scores.snapshot().live.slice(0, 5) : [],
    pendingFriends: req.user ? db.prepare(`SELECT COUNT(*) n FROM friendships WHERE addressee_id = ? AND status = 'pending'`).get(req.user.id).n : 0,
    sidebar: true,
    mode: req.mode || 'markets', side: req.side || 'markets',
    getShareTargets: (() => { let c; return () => c || (c = ctx.shareTargets ? ctx.shareTargets(req.user) : []); })(),
    modeNext: (SPORTS_PATH.test(req.path) || MARKETS_PATH.test(req.path) || req.method !== 'GET') ? '/' : req.originalUrl,
    unread: req.user ? db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read = 0').get(req.user.id).n : 0,
    strip: config.data.enabled ? scores.snapshot() : { live: [], leagues: [], total: 0 },
  };
}

// Flat list of quotes for the ticker strip shown on every page.
function tickerItems() {
  const snap = marketdata.snapshot();
  const pick = (key, n) => (snap.sections.find(s => s.key === key) || { items: [] }).items.slice(0, n);
  return [...pick('indices', 3), ...pick('crypto', 3), ...pick('forex', 2), ...pick('stocks', 4)];
}

// ---------- tiny in-memory rate limiter for auth ----------
const hits = new Map();
function authLimiter(req, res, next) {
  const key = req.ip, now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < 15 * 60e3);
  if (arr.length >= config.authAttemptsPer15Min) return res.status(429).render('error', { title: 'Slow down', message: 'Too many attempts. Try again in 15 minutes.' });
  arr.push(now); hits.set(key, arr); next();
}
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (!v.some(t => n - t < 15 * 60e3)) hits.delete(k); }, 600e3).unref();

const requireLogin = (req, res, next) => req.user ? next() : res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
const requireAdmin = (req, res, next) => (req.user && req.user.is_admin) ? next() : res.status(403).render('error', { title: 'Forbidden', message: 'Admins only.' });
const safeBack = (u, fallback = '/') => (typeof u === 'string' && /^\/(?!\/)[^\r\n\\]*$/.test(u)) ? u : fallback;

function login(res, userId) {
  const sid = crypto.randomBytes(32).toString('hex');
  q.newSession.run(hashSid(sid), userId, `+${config.sessionDays} days`);
  setCookie(res, 'sid', sid, config.sessionDays * 86400);
}

// ---------- queries ----------
// Visibility: a post is visible if it is not in a group, or its group is public, or the viewer is an active member.
const FROM_POSTS = `FROM posts p JOIN users u ON u.id = p.user_id LEFT JOIN user_groups g ON g.id = p.group_id`;
const BASE_WHERE = `p.deleted = 0 AND p.hidden = 0 AND u.banned = 0`;
const VIS = `AND (p.group_id IS NULL OR (g.deleted = 0 AND (g.privacy = 'public' OR EXISTS(SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = @me AND m.status = 'active'))))`;
const PUBLIC_ONLY = `AND (p.group_id IS NULL OR (g.deleted = 0 AND g.privacy = 'public'))`;

function postSelect(extraWhere = '', order = 'p.created_at DESC, p.id DESC') {
  return `SELECT p.*, u.username, g.name AS group_name, g.privacy AS group_privacy,
    (SELECT COUNT(*) FROM reactions r WHERE r.post_id = p.id) AS likes,
    (SELECT group_concat(kind || ':' || n) FROM (SELECT kind, COUNT(*) n FROM reactions r WHERE r.post_id = p.id GROUP BY kind)) AS rx,
    (SELECT kind FROM reactions r WHERE r.post_id = p.id AND r.user_id = @me) AS my_reaction,
    (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.deleted = 0) AS comments
    ${FROM_POSTS} WHERE ${BASE_WHERE} ${VIS} ${extraWhere} ORDER BY ${order}`;
}
// win/loss stats only ever use publicly visible posts, so private-group picks never leak into leaderboards.
function statsFor(where, params) {
  return db.prepare(`SELECT p.user_id, u.username,
      SUM(p.status='won') AS w, SUM(p.status='lost') AS l, SUM(p.status='push') AS p, SUM(p.status='open') AS open
    ${FROM_POSTS} WHERE ${BASE_WHERE} AND p.kind = 'idea' ${PUBLIC_ONLY} ${where} GROUP BY p.user_id`).all(params);
}

// ---------- groups: access helpers ----------
const getGroup = (id) => gq.get.get(id);
const gq = {
  get: db.prepare('SELECT g.*, u.username AS owner FROM user_groups g JOIN users u ON u.id = g.owner_id WHERE g.id = ? AND g.deleted = 0'),
  member: db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?'),
};
function membership(gid, user) { return user ? gq.member.get(gid, user.id) || null : null; }
function canViewGroup(g, user) {
  if (g.privacy === 'public') return true;
  const m = membership(g.id, user);
  return !!(m && m.status === 'active');
}
function canViewPostRow(p, user) {
  if (!p.group_id) return true;
  const g = getGroup(p.group_id);
  if (!g) return false;
  return canViewGroup(g, user) || !!(user && user.is_admin); // site admins can review reported posts
}
const isGroupOwner = (g, user) => !!user && g.owner_id === user.id;
function groupRole(g, user) { const m = membership(g.id, user); return m && m.status === 'active' ? m.role : null; }
const isGroupStaff = (g, user) => ['owner', 'mod'].includes(groupRole(g, user));
const channelsOf = (gid) => db.prepare('SELECT * FROM group_channels WHERE group_id = ? ORDER BY position, id').all(gid);
function myGroups(user) {
  if (!user) return [];
  return db.prepare(`SELECT g.id, g.name FROM group_members m JOIN user_groups g ON g.id = m.group_id
    WHERE m.user_id = ? AND m.status = 'active' AND g.deleted = 0 ORDER BY g.name`).all(user.id);
}

// ---------- feed ----------
function renderFeed(req, res, { group = null, basePath = '/', side = null, data = false, limit = config.pageSize } = {}) {
  const market = config.markets.find(m => m.key === req.query.market) ? req.query.market : 'all';
  const sort = req.query.sort === 'top' ? 'top' : 'new';
  const status = ['open', 'won', 'lost', 'push'].includes(req.query.status) ? req.query.status : '';
  const following = req.query.following === '1' && req.user;
  const search = String(req.query.q || '').trim().slice(0, 40);
  const exch = config.data.worldMarkets.find(w => w.key === req.query.mkt) ? req.query.mkt : '';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const params = { me: req.user ? req.user.id : 0 };
  // global feed: ungrouped posts + posts from public groups. group feed: only that group.
  let where = group ? ' AND p.group_id = @gid' : " AND (p.group_id IS NULL OR g.privacy = 'public')";
  if (group) params.gid = group.id;
  if (side === 'markets') where += " AND p.category != 'sports'";
  if (side === 'sports') where += " AND p.category = 'sports'";
  if (market !== 'all') { where += ' AND p.category = @market'; params.market = market; }
  if (status) { where += ' AND p.status = @status'; params.status = status; }
  if (exch) { where += ' AND p.exchange = @exch'; params.exch = exch; }
  if (following) where += ` AND (p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = @me)
      OR p.user_id IN (SELECT CASE WHEN requester_id = @me THEN addressee_id ELSE requester_id END FROM friendships WHERE status = 'accepted' AND (requester_id = @me OR addressee_id = @me)))`;
  if (search) { where += ` AND (p.subject LIKE @s ESCAPE '\\' OR p.pick LIKE @s ESCAPE '\\' OR u.username LIKE @s ESCAPE '\\')`; params.s = '%' + search.replace(/[\\%_]/g, '\\$&') + '%'; }
  const order = sort === 'top' ? 'likes DESC, p.created_at DESC' : 'p.created_at DESC, p.id DESC';
  const total = db.prepare(`SELECT COUNT(*) n ${FROM_POSTS} WHERE ${BASE_WHERE} ${VIS} ${where}`).get(params).n;
  const posts = db.prepare(postSelect(where, order) + ' LIMIT @lim OFFSET @off').all({ ...params, lim: limit, off: (page - 1) * limit });
  const cparams = { me: params.me }; if (group) cparams.gid = group.id;
  const counts = Object.fromEntries(db.prepare(`SELECT p.category c, COUNT(*) n ${FROM_POSTS} WHERE ${BASE_WHERE} ${VIS} ${group ? ' AND p.group_id = @gid' : " AND (p.group_id IS NULL OR g.privacy = 'public')"} GROUP BY p.category`).all(cparams).map(r => [r.c, r.n]));
  const out = { posts, market, sort, status, exch, following: !!following, search, page, pages: Math.max(1, Math.ceil(total / limit)), total, counts, pageTitle: group ? group.name : null, backUrl: req.originalUrl, group, basePath, feedSide: side, feedMarkets: config.markets.filter(m => side === 'markets' ? m.kind !== 'sports' : side === 'sports' ? m.kind === 'sports' : true) };
  if (data) return out;
  res.render('feed', out);
}
app.get('/', (req, res) => {
  if (req.query.market === 'sports' && req.mode !== 'sports') { const p = new URLSearchParams(req.query); p.delete('market'); return res.redirect('/sports/feed' + (p.toString() ? '?' + p : '')); }
  if (req.mode === 'sports') return ctx.sportsHub(req, res);
  if (req.mode === 'split') {
    const feed = renderFeed(req, res, { side: 'markets', data: true, limit: 8 });
    return res.render('split', { feed, hub: ctx.sportsHubData(req, { limit: 8 }), marketCards: ctx.featuredMarketCards ? ctx.featuredMarketCards(req.user) : [], backUrl: req.originalUrl, sidebar: false, pageTitle: 'Markets + Sports' });
  }
  const out = renderFeed(req, res, { side: 'markets', data: true });
  out.marketCards = ctx.featuredMarketCards ? ctx.featuredMarketCards(req.user) : [];
  res.render('feed', out);
});

// ---------- auth ----------
app.get('/signup', (req, res) => res.render('signup', { error: null, form: {}, pageTitle: 'Sign up' }));
app.post('/signup', authLimiter, (req, res) => {
  const f = { username: String(req.body.username || '').trim() };
  const fail = (error) => res.status(400).render('signup', { error, form: f, pageTitle: 'Sign up' });
  if (!config.allowSignups) return fail('Sign-ups are currently closed.');
  if (!/^[A-Za-z0-9_]{3,20}$/.test(f.username)) return fail('Username must be 3-20 letters, numbers or underscores.');
  const pw = String(req.body.password || '');
  if (pw.length < 8 || pw.length > 72) return fail('Password must be 8-72 characters.');
  if (pw !== req.body.password2) return fail('Passwords do not match.');
  if (req.body.age21 !== 'on') return fail('You must confirm you are 21 or older.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(f.username)) return fail('That username is taken.');
  const first = db.prepare('SELECT COUNT(*) n FROM users').get().n === 0;
  const isAdmin = first || config.adminUsernames.includes(f.username.toLowerCase());
  const info = db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)').run(f.username, bcrypt.hashSync(pw, 11), isAdmin ? 1 : 0);
  login(res, info.lastInsertRowid);
  res.redirect('/');
});

app.get('/login', (req, res) => res.render('login', { error: null, next: safeBack(req.query.next), form: {}, pageTitle: 'Log in' }));
const failedLogins = new Map(); // username -> [timestamps]; slows password guessing on a single account
app.post('/login', authLimiter, (req, res) => {
  const username = String(req.body.username || '').trim();
  const fails = (failedLogins.get(username.toLowerCase()) || []).filter(t => Date.now() - t < 15 * 60e3);
  if (fails.length >= 8) return res.status(429).render('login', { error: 'Too many failed attempts for this account. Try again in 15 minutes.', next: '/', form: { username }, pageTitle: 'Log in' });
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const ok = u && bcrypt.compareSync(String(req.body.password || ''), u.password_hash);
  if (!ok) { failedLogins.set(username.toLowerCase(), [...fails, Date.now()]); }
  else failedLogins.delete(username.toLowerCase());
  if (!ok) return res.status(401).render('login', { error: 'Wrong username or password.', next: safeBack(req.body.next), form: { username }, pageTitle: 'Log in' });
  if (u.banned) return res.status(403).render('login', { error: 'This account has been suspended.', next: '/', form: { username }, pageTitle: 'Log in' });
  if (config.adminUsernames.includes(u.username.toLowerCase()) && !u.is_admin) db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(u.id);
  login(res, u.id);
  res.redirect(safeBack(req.body.next));
});
app.post('/logout', (req, res) => {
  if (req.sid) q.delSession.run(hashSid(req.sid));
  setCookie(res, 'sid', '', 0);
  res.redirect('/');
});

// ---------- posts ----------
app.get('/post/new', requireLogin, (req, res) => {
  const m = config.markets.find(x => x.key === req.query.market) ? req.query.market : config.markets[0].key;
  const groups = myGroups(req.user);
  const gid = groups.find(g => String(g.id) === String(req.query.group)) ? String(req.query.group) : '';
  res.render('new', { error: null, form: { category: m, group_id: gid, exchange: String(req.query.mkt || ''), subject: String(req.query.subject || '').slice(0, 80), game_id: db.prepare('SELECT id FROM games WHERE id = ?').get(String(req.query.game || '')) ? String(req.query.game) : '' }, groups, pageTitle: 'New post' });
});
app.post('/post/new', requireLogin, (req, res) => {
  const form = req.body;
  const recent = db.prepare(`SELECT COUNT(*) n FROM posts WHERE user_id = ? AND created_at > datetime('now','-1 hour')`).get(req.user.id).n;
  const groups = myGroups(req.user);
  let gid = null;
  let r = recent >= config.maxPostsPerHour ? { error: 'Posting limit reached. Try again later.' } : lib.validatePost(form);
  if (!r.error && form.group_id) {
    const g = groups.find(x => String(x.id) === String(form.group_id));
    if (!g) r = { error: 'You can only post to groups you are an active member of.' }; else gid = g.id;
  }
  if (r.error) return res.status(400).render('new', { error: r.error, form, groups, pageTitle: 'New post' });
  const v = r.value;
  const gameRow = form.game_id && v.category === 'sports' ? db.prepare('SELECT id FROM games WHERE id = ?').get(String(form.game_id)) : null;
  const info = db.prepare(`INSERT INTO posts (user_id, group_id, category, exchange, subject, pick, odds, units, entry, target, stop, timeframe, reasoning, game_id)
    VALUES (@uid, @gid, @category, @exchange, @subject, @pick, @odds, @units, @entry, @target, @stop, @timeframe, @reasoning, @game_id)`).run({ uid: req.user.id, gid, subject: v.subject, pick: v.pick, ...v, game_id: gameRow ? gameRow.id : null });
  res.redirect('/post/' + info.lastInsertRowid);
});

function loadPost(id, me) {
  return db.prepare(postSelect('AND p.id = @id')).get({ me: me ? me.id : 0, id });
}
app.get('/post/:id(\\d+)', (req, res, next) => {
  let post = loadPost(req.params.id, req.user);
  // owners and admins can still see a hidden post
  if (!post) {
    const raw = db.prepare('SELECT p.*, u.username, g.name AS group_name, g.privacy AS group_privacy FROM posts p JOIN users u ON u.id=p.user_id LEFT JOIN user_groups g ON g.id = p.group_id WHERE p.id = ? AND p.deleted = 0').get(req.params.id);
    if (raw && req.user && (req.user.is_admin || req.user.id === raw.user_id) && canViewPostRow(raw, req.user)) {
      post = { ...raw, likes: 0, rx: null, my_reaction: null, comments: 0 };
    }
  }
  if (!post) return res.status(404).render('error', { title: 'Not found', message: 'That post does not exist or was removed.' });
  const comments = db.prepare(`SELECT c.*, u.username FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id = ? AND c.deleted = 0 AND u.banned = 0 ORDER BY c.created_at, c.id`).all(post.id);
  const reported = req.user ? !!db.prepare('SELECT 1 FROM reports WHERE post_id=? AND reporter_id=?').get(post.id, req.user.id) : false;
  res.render('post', { post, comments, reported, error: req.query.err || null, pageTitle: `${post.subject} - ${post.pick}` });
});

// Loads a post for an action; returns undefined if missing or the user may not see it (private group).
function ownedPost(req) {
  const p = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted = 0').get(req.params.id);
  return p && canViewPostRow(p, req.user) ? p : undefined;
}
const back = (req, fallback) => safeBack(req.body.back, fallback);

app.post('/post/:id(\\d+)/react', requireLogin, (req, res) => {
  const p = ownedPost(req);
  if (!p) return res.redirect('/');
  const kind = config.reactions.find(r => r.key === req.body.kind) ? req.body.kind : 'like';
  const cur = db.prepare('SELECT kind FROM reactions WHERE user_id = ? AND post_id = ?').get(req.user.id, p.id);
  if (cur && cur.kind === kind) db.prepare('DELETE FROM reactions WHERE user_id = ? AND post_id = ?').run(req.user.id, p.id); // click again to remove
  else db.prepare('INSERT INTO reactions (user_id, post_id, kind) VALUES (?, ?, ?) ON CONFLICT(user_id, post_id) DO UPDATE SET kind = excluded.kind').run(req.user.id, p.id, kind);
  res.redirect(back(req, '/post/' + p.id) + '#p' + p.id);
});

app.post('/post/:id(\\d+)/comment', requireLogin, (req, res) => {
  const p = ownedPost(req);
  if (!p) return res.redirect('/');
  const body = String(req.body.body || '').trim();
  const err = (m) => res.redirect(`/post/${p.id}?err=${encodeURIComponent(m)}#comments`);
  if (!body) return err('Write something first.');
  if (body.length > 500) return err('Comments are limited to 500 characters.');
  if (lib.hasLink(body)) return err('Links are not allowed in comments.');
  const recent = db.prepare(`SELECT COUNT(*) n FROM comments WHERE user_id=? AND created_at > datetime('now','-1 hour')`).get(req.user.id).n;
  if (recent >= config.maxCommentsPerHour) return err('Comment limit reached. Try again later.');
  db.prepare('INSERT INTO comments (post_id, user_id, body) VALUES (?, ?, ?)').run(p.id, req.user.id, body);
  if (p.user_id !== req.user.id) require('./services/notify').notify(p.user_id, 'comment', `@${req.user.username} commented on your post "${p.subject}"`, `/post/${p.id}#comments`);
  res.redirect(`/post/${p.id}#comments`);
});
app.post('/comment/:id(\\d+)/delete', requireLogin, (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (c && (c.user_id === req.user.id || req.user.is_admin)) db.prepare('UPDATE comments SET deleted = 1 WHERE id = ?').run(c.id);
  res.redirect(c ? `/post/${c.post_id}#comments` : '/');
});

app.post('/post/:id(\\d+)/settle', requireLogin, (req, res) => {
  const p = ownedPost(req);
  const result = req.body.result;
  if (!p) return res.redirect('/');
  if (p.user_id === req.user.id && p.status === 'open' && ['won', 'lost', 'push'].includes(result)) {
    db.prepare(`UPDATE posts SET status = ?, settled_at = datetime('now') WHERE id = ?`).run(result, p.id);
  } else if (req.user.is_admin && result === 'open') {
    db.prepare(`UPDATE posts SET status = 'open', settled_at = NULL WHERE id = ?`).run(p.id);
  }
  res.redirect(back(req, '/post/' + p.id));
});

app.post('/post/:id(\\d+)/delete', requireLogin, (req, res) => {
  const p = ownedPost(req);
  if (p) {
    const mine = p.user_id === req.user.id && (p.status === 'open' || config.allowDeleteSettled);
    if (mine || req.user.is_admin) db.prepare('UPDATE posts SET deleted = 1 WHERE id = ?').run(p.id);
  }
  res.redirect(safeBack(req.body.back, '/'));
});

app.post('/post/:id(\\d+)/report', requireLogin, (req, res) => {
  const p = ownedPost(req);
  if (!p) return res.redirect('/');
  const reason = String(req.body.reason || '').trim().slice(0, 300) || 'No reason given';
  db.prepare('INSERT OR IGNORE INTO reports (post_id, reporter_id, reason) VALUES (?, ?, ?)').run(p.id, req.user.id, reason);
  if (config.autoHideAfterReports > 0) {
    const n = db.prepare('SELECT COUNT(*) n FROM reports WHERE post_id = ? AND resolved = 0').get(p.id).n;
    if (n >= config.autoHideAfterReports) db.prepare('UPDATE posts SET hidden = 1 WHERE id = ?').run(p.id);
  }
  res.redirect(`/post/${p.id}?err=${encodeURIComponent('Thanks - the post was reported to the moderators.')}`);
});

// ---------- profiles / follow ----------
app.get('/u/:username', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND banned = 0').get(req.params.username);
  if (!u) return res.status(404).render('error', { title: 'Not found', message: 'No such user.' });
  const me = req.user ? req.user.id : 0;
  const posts = db.prepare(postSelect('AND p.user_id = @uid') + ' LIMIT 50').all({ me, uid: u.id });
  const rows = db.prepare(`SELECT p.category, SUM(p.status='won') w, SUM(p.status='lost') l, SUM(p.status='push') p, SUM(p.status='open') open
    ${FROM_POSTS} WHERE ${BASE_WHERE} AND p.kind = 'idea' ${PUBLIC_ONLY} AND p.user_id = ? GROUP BY p.category`).all(u.id);
  const total = rows.reduce((a, r) => ({ w: a.w + r.w, l: a.l + r.l, p: a.p + r.p, open: a.open + r.open }), { w: 0, l: 0, p: 0, open: 0 });
  const followers = db.prepare('SELECT COUNT(*) n FROM follows WHERE followee_id = ?').get(u.id).n;
  const followingN = db.prepare('SELECT COUNT(*) n FROM follows WHERE follower_id = ?').get(u.id).n;
  const isFollowing = !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(me, u.id);
  res.render('profile', { u, posts, voteRec: ctx.voteRecord ? ctx.voteRecord(u.id) : null, byMarket: rows, total, followers, followingN, isFollowing, friendState: ctx.friendState(req.user ? req.user.id : 0, u.id), pageTitle: '@' + u.username, backUrl: req.originalUrl });
});
app.post('/u/:username/follow', requireLogin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND banned = 0').get(req.params.username);
  if (u && u.id !== req.user.id) {
    const del = db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(req.user.id, u.id);
    if (!del.changes) db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)').run(req.user.id, u.id);
  }
  res.redirect(u ? '/u/' + u.username : '/');
});

app.get('/settings', requireLogin, (req, res) => res.render('settings', { msg: null, error: null, pageTitle: 'Settings' }));
app.post('/settings', requireLogin, (req, res) => {
  const bio = String(req.body.bio || '').trim();
  if (bio.length > 160) return res.status(400).render('settings', { msg: null, error: 'Bio is limited to 160 characters.', pageTitle: 'Settings' });
  if (lib.hasLink(bio)) return res.status(400).render('settings', { msg: null, error: 'Links are not allowed in bios.', pageTitle: 'Settings' });
  db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, req.user.id);
  res.redirect('/u/' + req.user.username);
});
app.post('/settings/password', requireLogin, (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const fail = (error) => res.status(400).render('settings', { msg: null, error, pageTitle: 'Settings' });
  if (!bcrypt.compareSync(String(req.body.current || ''), me.password_hash)) return fail('Current password is wrong.');
  const pw = String(req.body.password || '');
  if (pw.length < 8 || pw.length > 72) return fail('New password must be 8-72 characters.');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(pw, 11), me.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(me.id, hashSid(req.sid));
  res.render('settings', { msg: 'Password changed.', error: null, pageTitle: 'Settings' });
});

// ---------- leaderboard ----------
function picksBoard(market) {
  const where = !market || market === 'all' ? '' : ' AND p.category = @market';
  return statsFor(where, !market || market === 'all' ? {} : { market })
    .map(r => ({ ...r, settled: r.w + r.l + r.p, pct: lib.winPct(r.w, r.l) }))
    .filter(r => r.settled >= config.leaderboardMinSettled && r.pct !== null)
    .sort((a, b) => b.pct - a.pct || b.w - a.w || a.l - b.l);
}
app.get('/leaderboard', (req, res) => {
  const market = config.markets.find(m => m.key === req.query.market) ? req.query.market : 'all';
  const board = req.query.board === 'votes' ? 'votes' : 'picks';
  const timeframe = req.query.timeframe === 'week' ? 'week' : req.query.timeframe === 'day' ? 'day' : '';
  const rows = board === 'votes' ? require('./services/votes').boardMarkets({ timeframe }) : picksBoard(market);
  res.render('leaderboard', { rows, market, board, timeframe, minVotes: config.votes.leaderboardMin, pageTitle: 'Leaderboard' });
});

// ---------- admin ----------
app.get('/admin', requireLogin, requireAdmin, (req, res) => {
  const reports = db.prepare(`SELECT r.*, ru.username AS reporter, p.subject, p.pick, p.hidden, p.deleted, p.category, pu.username AS author
    FROM reports r JOIN users ru ON ru.id = r.reporter_id JOIN posts p ON p.id = r.post_id JOIN users pu ON pu.id = p.user_id
    WHERE r.resolved = 0 ORDER BY r.created_at DESC`).all();
  const users = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.deleted = 0) AS posts FROM users u ORDER BY u.created_at DESC LIMIT 100`).all();
  const stats = {
    users: db.prepare('SELECT COUNT(*) n FROM users').get().n,
    posts: db.prepare('SELECT COUNT(*) n FROM posts WHERE deleted = 0').get().n,
    comments: db.prepare('SELECT COUNT(*) n FROM comments WHERE deleted = 0').get().n,
  };
  res.render('admin', { reports, users, stats, pageTitle: 'Admin' });
});
app.post('/admin/report/:id(\\d+)/resolve', requireLogin, requireAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (r) {
    const act = req.body.action;
    if (act === 'delete') db.prepare('UPDATE posts SET deleted = 1 WHERE id = ?').run(r.post_id);
    if (act === 'dismiss') db.prepare('UPDATE posts SET hidden = 0 WHERE id = ?').run(r.post_id);
    db.prepare('UPDATE reports SET resolved = 1 WHERE post_id = ?').run(r.post_id);
  }
  res.redirect('/admin');
});
app.post('/admin/user/:id(\\d+)/:action(ban|unban|promote|demote)', requireLogin, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id !== req.user.id) {
    const a = req.params.action;
    if (a === 'ban' || a === 'unban') {
      db.prepare('UPDATE users SET banned = ? WHERE id = ?').run(a === 'ban' ? 1 : 0, id);
      if (a === 'ban') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    } else db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(a === 'promote' ? 1 : 0, id);
  }
  res.redirect('/admin');
});


// ---------- groups ----------
const GROUP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _\-.&']{2,39}$/;
function validateGroup(b, excludeId) {
  const name = String(b.name || '').trim().replace(/\s+/g, ' ');
  const description = String(b.description || '').trim();
  const privacy = b.privacy === 'private' ? 'private' : 'public';
  if (!GROUP_NAME_RE.test(name)) return { error: 'Group name must be 3-40 characters (letters, numbers, spaces, - _ . & \').' };
  if (lib.hasLink(name) || lib.hasLink(description)) return { error: 'Links are not allowed in group names or descriptions.' };
  if (description.length > 300) return { error: 'Description is limited to 300 characters.' };
  const dup = db.prepare('SELECT id FROM user_groups WHERE name = ? AND deleted = 0').get(name);
  if (dup && dup.id !== excludeId) return { error: 'A group with that name already exists.' };
  return { value: { name, description, privacy } };
}
const newInvite = () => crypto.randomBytes(12).toString('hex');
function loadGroup(req, res) {
  const g = getGroup(req.params.id);
  if (!g) { res.status(404).render('error', { title: 'Not found', message: 'That group does not exist.' }); return null; }
  return g;
}
const groupCounts = (gid) => ({
  members: db.prepare(`SELECT COUNT(*) n FROM group_members WHERE group_id = ? AND status = 'active'`).get(gid).n,
  pending: db.prepare(`SELECT COUNT(*) n FROM group_members WHERE group_id = ? AND status = 'pending'`).get(gid).n,
});

app.get('/groups', (req, res) => {
  const search = String(req.query.q || '').trim().slice(0, 40);
  const me = req.user ? req.user.id : 0;
  const list = (where, extra = {}) => db.prepare(`SELECT g.*, u.username AS owner,
      (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id AND m.status = 'active') AS members,
      (SELECT COUNT(*) FROM posts p WHERE p.group_id = g.id AND p.deleted = 0 AND p.hidden = 0) AS posts,
      (SELECT status FROM group_members m WHERE m.group_id = g.id AND m.user_id = @me) AS my_status
    FROM user_groups g JOIN users u ON u.id = g.owner_id WHERE g.deleted = 0 ${where} ORDER BY members DESC, g.created_at DESC LIMIT 60`).all({ me, ...extra });
  const mine = req.user ? list(`AND EXISTS(SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = @me)`) : [];
  // private groups are listed (name + description) so people can request to join, but their posts stay hidden
  const discover = list(`AND (@s = '' OR g.name LIKE @sl ESCAPE '\\' )`, { s: search, sl: '%' + search.replace(/[\\%_]/g, '\\$&') + '%' });
  res.render('groups', { mine, discover, search, pageTitle: 'Groups' });
});

app.get('/groups/new', requireLogin, (req, res) => res.render('group-form', { g: null, form: { privacy: 'public' }, error: null, pageTitle: 'New group' }));
app.post('/groups/new', requireLogin, (req, res) => {
  const owned = db.prepare('SELECT COUNT(*) n FROM user_groups WHERE owner_id = ? AND deleted = 0').get(req.user.id).n;
  const r = owned >= config.maxGroupsPerUser ? { error: `You can own up to ${config.maxGroupsPerUser} groups.` } : validateGroup(req.body);
  if (r.error) return res.status(400).render('group-form', { g: null, form: req.body, error: r.error, pageTitle: 'New group' });
  const v = r.value;
  const info = db.prepare('INSERT INTO user_groups (owner_id, name, description, privacy, invite_code) VALUES (?, ?, ?, ?, ?)').run(req.user.id, v.name, v.description, v.privacy, newInvite());
  db.prepare(`INSERT INTO group_members (group_id, user_id, role, status) VALUES (?, ?, 'owner', 'active')`).run(info.lastInsertRowid, req.user.id);
  const addCh = db.prepare('INSERT OR IGNORE INTO group_channels (group_id, name, topic, position, exchange) VALUES (?, ?, ?, ?, ?)');
  config.defaultChannels.forEach((c, i) => addCh.run(info.lastInsertRowid, c.name, c.topic || '', i, c.exchange || null));
  res.redirect('/g/' + info.lastInsertRowid);
});

app.get('/g/:id(\\d+)', (req, res) => {
  const g = loadGroup(req, res); if (!g) return;
  const m = membership(g.id, req.user);
  const counts = groupCounts(g.id);
  const info = { m, counts, isOwner: isGroupOwner(g, req.user), isStaff: isGroupStaff(g, req.user), canView: canViewGroup(g, req.user), channels: channelsOf(g.id) };
  if (!info.canView) return res.render('group-locked', { g, ...info, pageTitle: g.name, msg: req.query.msg || null });
  res.locals.groupInfo = info;
  renderFeed(req, res, { group: Object.assign(g, info), basePath: '/g/' + g.id });
});

// joining: public = instant; private = request (owner approves) or invite link
app.post('/g/:id(\\d+)/join', requireLogin, (req, res) => {
  const g = loadGroup(req, res); if (!g) return;
  const m = membership(g.id, req.user);
  if (!m) {
    if (g.privacy === 'public') db.prepare(`INSERT INTO group_members (group_id, user_id, role, status) VALUES (?, ?, 'member', 'active')`).run(g.id, req.user.id);
    else {
      db.prepare(`INSERT INTO group_members (group_id, user_id, role, status) VALUES (?, ?, 'member', 'pending')`).run(g.id, req.user.id);
      db.prepare(`SELECT user_id FROM group_members WHERE group_id = ? AND role IN ('owner','mod') AND status = 'active'`).all(g.id).forEach(r => require('./services/notify').notify(r.user_id, 'group', `@${req.user.username} asked to join ${g.name}`, `/g/${g.id}/manage`));
    }
  }
  res.redirect('/g/' + g.id + (g.privacy === 'private' ? '?msg=' + encodeURIComponent('Request sent. The group admin will review it.') : ''));
});
app.post('/g/:id(\\d+)/leave', requireLogin, (req, res) => {
  const g = loadGroup(req, res); if (!g) return;
  if (!isGroupOwner(g, req.user)) { db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(g.id, req.user.id); if (ctx.kick) ctx.kick(req.user.id, g.id); }
  res.redirect(g.privacy === 'public' ? '/g/' + g.id : '/groups');
});
app.get('/g/:id(\\d+)/invite/:code', requireLogin, (req, res) => {
  const g = loadGroup(req, res); if (!g) return;
  const valid = req.params.code === g.invite_code;
  const m = membership(g.id, req.user);
  if (m && m.status === 'active') return res.redirect('/g/' + g.id);
  res.render('group-invite', { g, valid, counts: groupCounts(g.id), code: req.params.code, pageTitle: 'Join ' + g.name });
});
app.post('/g/:id(\\d+)/invite/:code', requireLogin, (req, res) => {
  const g = loadGroup(req, res); if (!g) return;
  if (req.params.code !== g.invite_code) return res.redirect('/g/' + g.id);
  db.prepare(`INSERT INTO group_members (group_id, user_id, role, status) VALUES (?, ?, 'member', 'active')
    ON CONFLICT(group_id, user_id) DO UPDATE SET status = 'active'`).run(g.id, req.user.id);
  res.redirect('/g/' + g.id);
});

// owner / moderator tools
function ownerOnly(req, res) {
  const g = loadGroup(req, res); if (!g) return null;
  if (!isGroupOwner(g, req.user) && !(req.user && req.user.is_admin)) { res.status(403).render('error', { title: 'Forbidden', message: 'Only the group owner can do that.' }); return null; }
  return g;
}
function staffOnly(req, res) {
  const g = loadGroup(req, res); if (!g) return null;
  if (!isGroupStaff(g, req.user) && !(req.user && req.user.is_admin)) { res.status(403).render('error', { title: 'Forbidden', message: 'Only the group owner or moderators can do that.' }); return null; }
  return g;
}
app.get('/g/:id(\\d+)/manage', requireLogin, (req, res) => {
  const g = staffOnly(req, res); if (!g) return;
  const members = db.prepare(`SELECT m.*, u.username FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? AND m.status = 'active' ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'mod' THEN 1 ELSE 2 END, m.created_at`).all(g.id);
  const pending = db.prepare(`SELECT m.*, u.username FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? AND m.status = 'pending' ORDER BY m.created_at`).all(g.id);
  const origin = `${req.protocol}://${req.get('host')}`;
  res.render('group-manage', { g, members, pending, channels: channelsOf(g.id), isOwner: isGroupOwner(g, req.user) || !!req.user.is_admin, inviteUrl: `${origin}/g/${g.id}/invite/${g.invite_code}`, error: req.query.err || null, ok: req.query.ok || null, pageTitle: 'Manage ' + g.name });
});
app.post('/g/:id(\\d+)/edit', requireLogin, (req, res) => {
  const g = ownerOnly(req, res); if (!g) return;
  const r = validateGroup(req.body, g.id);
  if (r.error) return res.redirect(`/g/${g.id}/manage?err=${encodeURIComponent(r.error)}`);
  db.prepare('UPDATE user_groups SET name = ?, description = ?, privacy = ? WHERE id = ?').run(r.value.name, r.value.description, r.value.privacy, g.id);
  res.redirect(`/g/${g.id}/manage?ok=${encodeURIComponent('Group updated.')}`);
});
app.post('/g/:id(\\d+)/invite-reset', requireLogin, (req, res) => {
  const g = ownerOnly(req, res); if (!g) return;
  db.prepare('UPDATE user_groups SET invite_code = ? WHERE id = ?').run(newInvite(), g.id);
  res.redirect(`/g/${g.id}/manage?ok=${encodeURIComponent('Invite link reset. The old link no longer works.')}`);
});
// approve / deny requests, remove members (staff); promote / demote moderators (owner only)
app.post('/g/:id(\\d+)/member/:uid(\\d+)/:action(approve|deny|remove|promote|demote)', requireLogin, (req, res) => {
  const g = staffOnly(req, res); if (!g) return;
  const uid = Number(req.params.uid), act = req.params.action;
  const target = db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(g.id, uid);
  const owner = isGroupOwner(g, req.user) || !!req.user.is_admin;
  if (target && uid !== g.owner_id) {
    if (act === 'approve') { const r = db.prepare(`UPDATE group_members SET status = 'active' WHERE group_id = ? AND user_id = ? AND status = 'pending'`).run(g.id, uid); if (r.changes) require('./services/notify').notify(uid, 'group', `You were approved to join ${g.name}`, '/g/' + g.id); }
    else if (act === 'deny') db.prepare(`DELETE FROM group_members WHERE group_id = ? AND user_id = ? AND status = 'pending'`).run(g.id, uid);
    else if (act === 'remove' && (owner || target.role === 'member')) { db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(g.id, uid); if (ctx.kick) ctx.kick(uid, g.id); }
    else if (owner && target.status === 'active' && (act === 'promote' || act === 'demote'))
      db.prepare('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?').run(act === 'promote' ? 'mod' : 'member', g.id, uid);
  }
  res.redirect('/g/' + g.id + '/manage');
});
app.post('/g/:id(\\d+)/delete', requireLogin, (req, res) => {
  const g = ownerOnly(req, res); if (!g) return;
  db.prepare(`UPDATE user_groups SET deleted = 1, name = name || ' [deleted ' || id || ']' WHERE id = ?`).run(g.id);
  res.redirect('/groups');
});

// ---------- plugins ----------
// Every file in /routes is loaded automatically. A plugin exports function (app, ctx) and may return nothing.
// ctx exposes the database, config, helpers and middleware so new features can be added without touching server.js.
const ctx = {
  app, db, config, lib, crypto, requireLogin, requireAdmin, safeBack, setCookie, parseCookies, q,
  group: { get: getGroup, membership, canView: canViewGroup, role: groupRole, isOwner: isGroupOwner, isStaff: isGroupStaff, channelsOf, load: loadGroup },
  services: { marketdata, scores, marketstatus },
  sessionUser: (sid) => (sid ? q.session.get(hashSid(sid)) || null : null),
  postSelect, renderFeed, picksBoard, onServer: [],
};
fs.readdirSync(path.join(__dirname, 'routes')).filter(f => f.endsWith('.js')).sort().forEach(f => require('./routes/' + f)(app, ctx));

app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.use((req, res) => res.status(404).render('error', { title: 'Not found', message: 'Page not found.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Server error', message: 'Something went wrong.' });
});

function startServer(port = config.port, host = process.env.HOST || '0.0.0.0') {
  const server = http.createServer(app);
  ctx.onServer.forEach(fn => fn(server));
  marketdata.start(); scores.start(); require('./services/votes').start();
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
if (require.main === module) {
  startServer().then((server) => {
    console.log(`${config.appName} running on http://localhost:${config.port}`);
    const stop = () => { console.log('Shutting down...'); server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
  });
}
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));
module.exports = app;
module.exports.ctx = ctx;
module.exports.startServer = startServer;
