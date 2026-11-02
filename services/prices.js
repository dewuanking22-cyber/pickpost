// Price lookups for market votes (Yahoo Finance's unofficial chart endpoint - no key). Replaceable: tests and
// buyers can call setProvider() with their own { quote(symbol), between(symbol, startMs, endMs) }.
const config = require('../config');
const clock = require('./clock');

const UA = 'Mozilla/5.0 (compatible; PickPost/1.0)';
let provider = null;
const quoteCache = new Map();

async function chart(symbol, params) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`, { headers: { 'User-Agent': UA }, signal: ctl.signal });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return j.chart && j.chart.result && j.chart.result[0] || null;
  } finally { clearTimeout(t); }
}

const yahoo = {
  async quote(symbol) {
    const hit = quoteCache.get(symbol);
    if (hit && Date.now() - hit.at < (hit.v ? 60000 : 600000)) return hit.v;   // misses are cached longer
    const res = await chart(symbol, 'interval=1d&range=1d');
    let v = null;
    if (res && res.meta && Number.isFinite(res.meta.regularMarketPrice)) {
      const m = res.meta, prev = m.chartPreviousClose || m.previousClose;
      v = { price: m.regularMarketPrice, name: m.shortName || m.longName || symbol, changePct: prev ? ((m.regularMarketPrice - prev) / prev) * 100 : null, currency: m.currency };
    }
    if (quoteCache.size > 1000) quoteCache.delete(quoteCache.keys().next().value);
    quoteCache.set(symbol, { at: Date.now(), v });
    return v;
  },
  // Returns { start, end } prices for the window, { void: true } if the window has no trading data, or throws to retry later.
  async between(symbol, startMs, endMs) {
    const ageDays = (clock.now().getTime() - startMs) / 86400e3;
    const interval = ageDays > 50 ? '1d' : '5m';
    const res = await chart(symbol, `interval=${interval}&period1=${Math.floor(startMs / 1000) - 3600}&period2=${Math.floor(endMs / 1000) + 3600}`);
    const ts = (res && res.timestamp) || [], q = res && res.indicators && res.indicators.quote && res.indicators.quote[0];
    if (!q) { if (clock.now().getTime() - endMs > 2 * 86400e3) return { void: true }; throw new Error('no data yet'); }
    let first = null, last = null;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i] * 1000;
      if (t >= startMs && t < endMs) {
        if (first === null && q.open[i] != null) first = { t, p: q.open[i] };
        if (q.close[i] != null) last = { t, p: q.close[i] };
      }
    }
    if (!first || !last) { if (clock.now().getTime() - endMs > 2 * 86400e3) return { void: true }; throw new Error('window bars missing'); }
    if (first.t - startMs > 4 * 3600e3 || endMs - last.t > 4 * 3600e3) return { void: true }; // closed all/most of the window (holiday etc.)
    return { start: first.p, end: last.p };
  },
};

module.exports = {
  setProvider(p) { provider = p; },
  get provider() { return provider || (config.data.enabled ? yahoo : { quote: async () => null, between: async () => { throw new Error('market data disabled'); } }); },
};
