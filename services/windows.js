// Vote windows for market (trading) votes. A window has a start (votes LOCK here) and an end (graded here).
// day  = the next session / trading day;   week = the next full trading week.
// Session markets use the exchange's own time zone and hours; crypto uses UTC days; forex/futures use the
// 17:00 New York rollover. Only US holidays are modelled.
const config = require('../config');

const NYSE_HOLIDAYS = require('./marketstatus').NYSE_HOLIDAYS;

function offsetMs(tz, atMs) { // tz offset (ms) at an instant: local wall time minus UTC
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(atMs)).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(atMs / 1000) * 1000;
}
// Local wall-clock time in tz -> UTC Date
function zoned(tz, y, mo, d, hh, mm) {
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  let t = guess - offsetMs(tz, guess);
  t = guess - offsetMs(tz, t); // second pass handles DST edges
  return new Date(t);
}
function localYmd(tz, date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}
const dow = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const addDays = (y, m, d, n) => { const t = new Date(Date.UTC(y, m - 1, d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const ymdStr = (o) => `${o.y}-${String(o.m).padStart(2, '0')}-${String(o.d).padStart(2, '0')}`;
const isHoliday = (info, o) => info.holidays === 'nyse' && NYSE_HOLIDAYS.includes(ymdStr(o));
const fmtDay = (tz, date) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(date);

const hm = (s) => s.split(':').map(Number);

// info: { kind: 'session'|'crypto'|'forex', tz, open:'09:30', close:'16:00', holidays }
function nextWindow(info, timeframe, now = new Date()) {
  const tz = info.tz;
  if (info.kind === 'crypto') {
    const t = localYmd('UTC', now); let start = zoned('UTC', t.y, t.m, t.d + 1, 0, 0);
    if (timeframe === 'day') return { starts: start, ends: new Date(start.getTime() + 86400e3), label: `${fmtDay('UTC', start)} (UTC day)` };
    // week: next Monday 00:00 UTC strictly after now
    let o = addDays(t.y, t.m, t.d, 1); while (dow(o.y, o.m, o.d) !== 1) o = addDays(o.y, o.m, o.d, 1);
    start = zoned('UTC', o.y, o.m, o.d, 0, 0);
    return { starts: start, ends: new Date(start.getTime() + 7 * 86400e3), label: `Week of ${fmtDay('UTC', start)}` };
  }
  if (info.kind === 'forex') { // Sun 17:00 ET -> Fri 17:00 ET; daily rollover 17:00 ET
    const t = localYmd(tz, now);
    for (let i = 0; i < 9; i++) {
      const o = addDays(t.y, t.m, t.d, i), w = dow(o.y, o.m, o.d);
      if (timeframe === 'day' && w === 5) continue; if (w === 6) continue;          // no round starting Fri/Sat 17:00
      if (timeframe === 'week' && w !== 0) continue;
      const start = zoned(tz, o.y, o.m, o.d, 17, 0);
      if (start <= now) continue;
      let end;
      if (timeframe === 'day') { const e = addDays(o.y, o.m, o.d, 1); end = zoned(tz, e.y, e.m, e.d, 17, 0); }
      else { const e = addDays(o.y, o.m, o.d, 5); end = zoned(tz, e.y, e.m, e.d, 17, 0); }
      return { starts: start, ends: end, label: timeframe === 'day' ? `Session closing ${fmtDay(tz, end)}` : `Week of ${fmtDay(tz, start)}` };
    }
  }
  // session markets
  const [oh, om] = hm(info.open), [ch, cm] = hm(info.close);
  const t = localYmd(tz, now);
  if (timeframe === 'day') {
    for (let i = 0; i < 12; i++) {
      const o = addDays(t.y, t.m, t.d, i), w = dow(o.y, o.m, o.d);
      if (w === 0 || w === 6 || isHoliday(info, o)) continue;
      const start = zoned(tz, o.y, o.m, o.d, oh, om);
      if (start <= now) continue;
      const isToday = i === 0;
      return { starts: start, ends: zoned(tz, o.y, o.m, o.d, ch, cm), label: isToday ? "Today's close" : `Close of ${fmtDay(tz, start)}` };
    }
  } else {
    for (let i = 0; i < 21; i++) {
      const o = addDays(t.y, t.m, t.d, i);
      if (dow(o.y, o.m, o.d) !== 1) continue;
      // first/last trading days of that Mon-Fri week
      let first = null, last = null;
      for (let k = 0; k < 5; k++) { const dd = addDays(o.y, o.m, o.d, k); if (!isHoliday(info, dd)) { first = first || dd; last = dd; } }
      if (!first) continue;
      const start = zoned(tz, first.y, first.m, first.d, oh, om);
      if (start <= now) continue;
      return { starts: start, ends: zoned(tz, last.y, last.m, last.d, ch, cm), label: `Week of ${fmtDay(tz, start)}` };
    }
  }
  throw new Error('no window found');
}

// ---- symbol catalog (Yahoo-style symbols) ----
function catalog() {
  const d = config.data, out = {};
  const sess = { kind: 'session', tz: 'America/New_York', open: '09:30', close: '16:00', holidays: 'nyse', category: 'stocks', market: 'us' };
  d.stocks.forEach(s => { out[s.symbol] = { ...sess, symbol: s.symbol, label: s.name === s.symbol ? s.symbol : `${s.symbol} · ${s.name}` }; });
  d.worldMarkets.filter(w => w.index).forEach(w => {
    const first = w.sessions[0][0], last = w.sessions[w.sessions.length - 1][1];
    [[w.index, w.indexName], w.index2 ? [w.index2, w.index2Name] : null].filter(Boolean).forEach(([sym, name]) => {
      out[sym] = { kind: 'session', tz: w.tz, open: first, close: last, holidays: w.holidays, category: 'stocks', market: w.key, symbol: sym, label: `${w.flag} ${name}` };
    });
  });
  d.crypto.forEach(c => { out[`${c.symbol}-USD`] = { kind: 'crypto', tz: 'UTC', category: 'crypto', market: 'crypto', symbol: `${c.symbol}-USD`, label: `${c.name} (${c.symbol})` }; });
  d.forex.forEach(f => { out[f.symbol] = { kind: 'forex', tz: 'America/New_York', category: 'forex', market: 'forex', symbol: f.symbol, label: f.name }; });
  d.futures.forEach(f => { out[f.symbol] = { kind: 'forex', tz: 'America/New_York', category: 'futures', market: 'us', symbol: f.symbol, label: f.name }; });
  return out;
}
module.exports = { nextWindow, catalog, zoned, localYmd, fmtDay };
