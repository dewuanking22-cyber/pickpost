// Fetches and caches live-ish prices. Every fetch is wrapped so a failure never breaks a page:
// the panel simply reports "unavailable" and keeps the last good values (marked stale).
const config = require('../config');
const status = require('./marketstatus');

const cfg = config.data;
const UA = 'Mozilla/5.0 (compatible; PickPost/1.0)';
const cache = { world: null, crypto: null, stocks: null, indices: null, forex: null, futures: null, updatedAt: null, errors: {} };

async function getJson(url, headers = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: ctl.signal, redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
const round = (n, d = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);

async function fetchCrypto() {
  const ids = cfg.crypto.map(c => c.id).join(',');
  const j = await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`);
  return cfg.crypto.filter(c => j[c.id]).map(c => ({ symbol: c.symbol, ysym: c.symbol + '-USD', name: c.name, price: j[c.id].usd, changePct: round(j[c.id].usd_24h_change) }));
}

async function yahooQuote(item) {
  const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.symbol)}?interval=1d&range=1d`);
  const m = j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
  if (!m || !Number.isFinite(m.regularMarketPrice)) throw new Error('no data for ' + item.symbol);
  const prev = m.chartPreviousClose || m.previousClose;
  return { symbol: item.symbol.replace(/=X$|=F$/, '').replace(/^\^/, ''), ysym: item.symbol, name: item.name, price: m.regularMarketPrice, changePct: prev ? round(((m.regularMarketPrice - prev) / prev) * 100) : null };
}
async function finnhubQuote(item) {
  const j = await getJson(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(item.symbol)}&token=${encodeURIComponent(cfg.finnhubKey)}`);
  if (!j || !j.c) throw new Error('no data for ' + item.symbol);
  return { symbol: item.symbol, ysym: item.symbol, name: item.name, price: j.c, changePct: round(j.dp) };
}
async function many(items, fn) {
  const res = await Promise.allSettled(items.map(fn));
  const ok = res.filter(r => r.status === 'fulfilled').map(r => r.value);
  if (!ok.length) throw new Error(res[0].reason && res[0].reason.message || 'no data');
  return ok;
}
async function fetchStocks() {
  if (cfg.finnhubKey) { try { return await many(cfg.stocks, finnhubQuote); } catch (e) { if (!cfg.useYahooFallback) throw e; } }
  if (!cfg.useYahooFallback) throw new Error('No FINNHUB_API_KEY set');
  return many(cfg.stocks, yahooQuote);
}
async function fetchYahooList(list) {
  if (!cfg.useYahooFallback) throw new Error('Yahoo fallback disabled');
  return many(list, yahooQuote);
}
async function fetchForex() {
  try { return await fetchYahooList(cfg.forex); }
  catch (e) {
    // Fallback: daily ECB reference rates (not live).
    const bases = [...new Set(cfg.forex.map(f => f.base))];
    const out = [];
    for (const f of cfg.forex) {
      const j = await getJson(`https://api.frankfurter.dev/v1/latest?base=${f.base}&symbols=${f.quote}`);
      if (j.rates && j.rates[f.quote]) out.push({ symbol: f.name, name: f.name + ' (daily)', price: j.rates[f.quote], changePct: null });
    }
    if (!out.length) throw e;
    return out;
  }
}

async function fetchWorld() {
  const out = {};
  await Promise.all(cfg.worldMarkets.filter(w => w.index).map(async (w) => {
    const entry = { indices: [] };
    const tries = [[w.index, w.indexName], w.index2 ? [w.index2, w.index2Name] : null].filter(Boolean);
    for (const [sym, name] of tries) {
      let q = null;
      if (cfg.useYahooFallback) { try { q = await yahooQuote({ symbol: sym, name }); } catch (e) { /* try proxy */ } }
      if (!q && cfg.finnhubKey && w.proxy) { try { q = { ...(await finnhubQuote({ symbol: w.proxy, name: name + ' (' + w.proxy + ' ETF proxy)' })), proxy: true }; } catch (e) { /* unavailable */ } }
      if (q) entry.indices.push({ ...q, ysym: sym, symbol: sym.replace(/^\^/, ''), name: q.proxy ? q.name : name });
    }
    out[w.key] = entry;
  }));
  if (!Object.values(out).some(e => e.indices.length)) throw new Error('No index data (Yahoo disabled/blocked and no Finnhub key)');
  return out;
}

const jobs = {
  world: fetchWorld,
  crypto: fetchCrypto, stocks: fetchStocks, indices: () => fetchYahooList(cfg.indices),
  forex: fetchForex, futures: () => fetchYahooList(cfg.futures),
};
async function refresh() {
  if (!cfg.enabled) return;
  await Promise.all(Object.entries(jobs).map(async ([k, fn]) => {
    try { cache[k] = { items: await fn(), at: new Date().toISOString() }; delete cache.errors[k]; }
    catch (e) { cache.errors[k] = e.message; }
  }));
  cache.updatedAt = new Date().toISOString();
}

let timer;
function start() {
  if (!cfg.enabled || timer) return;
  refresh().catch(() => {});
  timer = setInterval(() => refresh().catch(() => {}), cfg.refreshSeconds * 1000);
  timer.unref();
}

function snapshot() {
  const s = status.all();
  const sect = (key, label, st) => ({
    key, label, status: st,
    items: cache[key] ? cache[key].items : [],
    stale: !!cache.errors[key] && !!cache[key],
    unavailable: !cache[key],
    error: cache.errors[key] || null,
    at: cache[key] ? cache[key].at : null,
  });
  const now = new Date();
  const worldData = cache.world ? cache.world.items : {};
  const findQ = (key, sym) => ((cache[key] && cache[key].items) || []).find(i => i.symbol === sym);
  const world = cfg.worldMarkets.map(w => {
    let indices = (worldData[w.key] || {}).indices || [];
    if (w.always === 'crypto') indices = [findQ('crypto', 'BTC'), findQ('crypto', 'ETH')].filter(Boolean);
    if (w.always === 'forex') indices = [findQ('forex', 'EURUSD'), findQ('forex', 'USDJPY')].filter(Boolean).map(i => ({ ...i, symbol: i.name }));
    return { key: w.key, flag: w.flag, name: w.name, exchange: w.exchange, tz: w.tz, always: w.always || null,
      sessions: w.sessions || null, status: status.world(w, now), indices, hasData: indices.length > 0 };
  });
  return {
    world, enabled: cfg.enabled, updatedAt: cache.updatedAt, source: cfg.finnhubKey ? 'Finnhub + CoinGecko' : (cfg.useYahooFallback ? 'Yahoo Finance (unofficial) + CoinGecko' : 'CoinGecko only'),
    sections: [
      sect('indices', 'Indices', s.stocks), sect('stocks', 'Stocks & ETFs', s.stocks),
      sect('crypto', 'Crypto', s.crypto), sect('forex', 'Forex', s.forex), sect('futures', 'Futures', s.futures),
    ],
    status: s,
  };
}
module.exports = { start, refresh, snapshot };
