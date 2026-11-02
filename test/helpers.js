// Test helpers: boots the real app on an ephemeral port with a throw-away database and offers a
// cookie-jar HTTP client that handles the CSRF double-submit token like a browser would.
const os = require('os');
const path = require('path');
const fs = require('fs');

function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pickpost-test-'));
  process.env.NODE_ENV = 'test';
  process.env.MARKET_DATA = 'off';
  process.env.AUTH_RATE_LIMIT = '1000';
  process.env.DB_FILE = path.join(dir, 'test.db');
  process.env.DATA_DIR = dir;
  const mod = require('../server');
  return mod.startServer(0, '127.0.0.1').then((server) => ({
    server, ctx: mod.ctx, db: require('../db'), base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => { const done = () => r(); if (mod.ctx.io) mod.ctx.io.close(done); else server.close(done); server.closeAllConnections && server.closeAllConnections(); }),
  }));
}

class Client {
  constructor(base) { this.base = base; this.jar = {}; }
  cookieHeader() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) {
    const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of list) {
      const [pair, ...attrs] = c.split(';'); const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim(), val = decodeURIComponent(pair.slice(i + 1));
      if (/max-age=0/i.test(attrs.join(';')) || val === '') delete this.jar[name]; else this.jar[name] = val;
    }
  }
  async req(method, url, body, opts = {}) {
    const headers = { Cookie: this.cookieHeader() };
    let payload;
    if (method === 'POST') {
      if (!this.jar.csrf && !opts.noCsrf) { await this.get('/login'); headers.Cookie = this.cookieHeader(); }
      const form = new URLSearchParams();
      const data = opts.noCsrf ? (body || {}) : { _csrf: this.jar.csrf, ...(body || {}) };
      for (const [k, v] of Object.entries(data)) (Array.isArray(v) ? v : [v]).forEach(x => form.append(k, x));
      payload = form.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const res = await fetch(this.base + url, { method, headers, body: payload, redirect: 'manual' });
    this.store(res);
    const text = await res.text();
    return { status: res.status, location: res.headers.get('location'), text, headers: res.headers };
  }
  get(url) { return this.req('GET', url); }
  post(url, body, opts) { return this.req('POST', url, body, opts); }
  async signup(username, password = 'password123') {
    return this.post('/signup', { username, password, password2: password, age21: 'on' });
  }
  async login(username, password = 'password123') { return this.post('/login', { username, password }); }
}

const stockPost = (o = {}) => ({ category: 'stocks', subject: 'AAPL', pick: 'Long', entry: '100', target: '110', stop: '95', timeframe: 'Swing', reasoning: 'Breakout above resistance with volume.', ...o });
const sportsPost = (o = {}) => ({ category: 'sports', subject: 'Cowboys vs Cardinals', pick: 'Cardinals +3.5', odds: '-110', units: '1', reasoning: 'Cardinals defense is healthy this week.', ...o });
// Create a post and return its numeric id (from the redirect).
async function createPost(client, data) {
  const r = await client.post('/post/new', data);
  if (r.status !== 302) throw new Error('post failed: ' + r.status + ' ' + (r.text.match(/class="alert">([^<]*)/) || [])[1]);
  return Number(r.location.match(/\/post\/(\d+)/)[1]);
}
module.exports = { boot, Client, stockPost, sportsPost, createPost };
