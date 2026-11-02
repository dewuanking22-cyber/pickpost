const config = require('./config');

const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|bet|co|app|me|ly|gg)\b\/?)/i;

function hasLink(s) { return config.blockLinks && LINK_RE.test(s || ''); }

function timeAgo(sqlDate) {
  const d = new Date(sqlDate.replace(' ', 'T') + 'Z');
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
  return d.toISOString().slice(0, 10);
}

function winPct(w, l) { return w + l === 0 ? null : Math.round((w / (w + l)) * 1000) / 10; }

function num(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function marketByKey(k) { return config.markets.find(m => m.key === k); }

const OPTION_PICKS = ['Long Call', 'Long Put', 'Short Call', 'Short Put'];
const TIMEFRAMES = ['Day trade', 'Swing', 'Long term'];

// Validate and normalise a new-post form. Returns { error } or { value }.
function validatePost(b) {
  const market = marketByKey(b.category);
  if (!market) return { error: 'Choose a category.' };
  const category = market.key;
  // Without JavaScript both the trading and sports "pick" fields are submitted; choose the right one.
  if (Array.isArray(b.pick)) b = { ...b, pick: market.kind === 'trading' ? b.pick[0] : b.pick[b.pick.length - 1] };
  const reasoning = String(b.reasoning || '').trim();
  if (reasoning.length < 10) return { error: 'Add some reasoning (at least 10 characters).' };
  if (reasoning.length > 2000) return { error: 'Reasoning is limited to 2000 characters.' };
  if (hasLink(reasoning)) return { error: 'Links are not allowed in posts.' };
  const exchange = b.exchange ? String(b.exchange) : null;
  if (exchange && !config.data.worldMarkets.some(w => w.key === exchange)) return { error: 'Unknown market tag.' };
  const v = { category, exchange, reasoning, odds: null, units: null, entry: null, target: null, stop: null, timeframe: null };

  if (market.kind === 'trading') {
    let subject = String(b.subject || '').trim().toUpperCase().replace(/^\$/, '').replace(/\s+/g, ' ');
    const re = category === 'options' ? /^[A-Z0-9.\-\/ ]{1,30}$/
             : category === 'forex' ? /^[A-Z]{3}\/?[A-Z]{3}$/
             : /^[A-Z0-9.\-\/]{1,14}$/;
    if (!re.test(subject)) {
      const hint = { options: 'e.g. SPY 520C 12/20', forex: 'e.g. EUR/USD', crypto: 'e.g. BTC or ETH/USDT', futures: 'e.g. ES, NQ or CLZ6', stocks: 'e.g. AAPL' }[category] || '';
      return { error: `Enter a valid ${market.subjectLabel.toLowerCase()} (${hint}).` };
    }
    if (category === 'forex' && !subject.includes('/')) subject = subject.slice(0, 3) + '/' + subject.slice(3);
    if (hasLink(subject)) return { error: 'Links are not allowed in posts.' };
    let pick = b.pick;
    if (category === 'options') { if (!OPTION_PICKS.includes(pick)) return { error: 'Choose the option position.' }; }
    else if (!['Long', 'Short'].includes(pick)) return { error: 'Choose Long or Short.' };
    const entry = num(b.entry), target = num(b.target), stop = num(b.stop);
    if ([entry, target, stop].some(x => x === null || Number.isNaN(x) || x <= 0))
      return { error: 'Entry, target and stop must be positive numbers.' };
    const long = pick.startsWith('Long');
    const ok = long ? (stop < entry && entry < target) : (target < entry && entry < stop);
    if (!ok) return { error: long ? 'For a long position: stop < entry < target.' : 'For a short position: target < entry < stop.' };
    if (!TIMEFRAMES.includes(b.timeframe)) return { error: 'Choose a timeframe.' };
    Object.assign(v, { subject, pick, entry, target, stop, timeframe: b.timeframe });
  } else {
    const subject = String(b.subject || '').trim();
    const pick = String(b.pick || '').trim();
    if (subject.length < 3 || subject.length > 80) return { error: 'Enter the game (e.g. "Cowboys vs Cardinals").' };
    if (pick.length < 2 || pick.length > 60) return { error: 'Enter your pick (e.g. "Cardinals +3.5").' };
    if (hasLink(subject) || hasLink(pick)) return { error: 'Links are not allowed in posts.' };
    const odds = String(b.odds || '').trim();
    if (!/^[+-]\d{2,4}$/.test(odds)) return { error: 'Odds must be American format with a sign, e.g. -110 or +150.' };
    const units = num(b.units);
    if (units !== null && (Number.isNaN(units) || units <= 0 || units > 10)) return { error: 'Units must be between 0.1 and 10.' };
    Object.assign(v, { subject, pick, odds, units });
  }
  return { value: v };
}

function fmtPrice(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  n = Number(n);
  const d = Math.abs(n) >= 1000 ? 2 : Math.abs(n) >= 10 ? 2 : 4;
  return n.toLocaleString('en-US', { minimumFractionDigits: d === 4 && Math.abs(n) < 10 ? 4 : 2, maximumFractionDigits: d });
}
function fmtPct(n) { return n === null || n === undefined ? '—' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
const ET = (o) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...o });
// Server-rendered times are in US Eastern; public/live.js swaps them for the viewer's local time.
function fmtGameTime(iso) { const d = new Date(iso); return ET({ weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(d) + ' ET'; }
function fmtDateTime(iso) { const d = new Date(iso); return ET({ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d) + ' ET'; }
const fmtSigned = (n) => (n > 0 ? '+' : '') + n;

module.exports = { fmtGameTime, fmtDateTime, fmtSigned, fmtPrice, fmtPct, timeAgo, winPct, validatePost, hasLink, marketByKey, OPTION_PICKS, TIMEFRAMES };
