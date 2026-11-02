const { test } = require('node:test');
const assert = require('node:assert/strict');
const ms = require('../services/marketstatus');
const config = require('../config');
const lib = require('../lib');
const W = (k) => config.data.worldMarkets.find(w => w.key === k);
const at = (iso) => new Date(iso);

test('US equities hours (ET, DST aware, holidays)', () => {
  assert.equal(ms.usEquities(at('2026-11-02T15:00:00Z')).label, 'Open');            // Mon 10:00 ET (EST)
  assert.equal(ms.usEquities(at('2026-07-06T13:45:00Z')).label, 'Open');            // Mon 09:45 EDT
  assert.equal(ms.usEquities(at('2026-11-02T13:00:00Z')).label, 'Pre-market');      // 08:00 ET
  assert.equal(ms.usEquities(at('2026-11-02T22:00:00Z')).label, 'After-hours');     // 17:00 ET
  assert.equal(ms.usEquities(at('2026-11-02T03:00:00Z')).open, false);              // Sun night
  assert.match(ms.usEquities(at('2026-11-07T17:00:00Z')).label, /weekend/);
  assert.match(ms.usEquities(at('2026-11-26T15:00:00Z')).label, /holiday/);         // Thanksgiving
});
test('crypto is always open; forex 24/5 (Sun 17:00 ET -> Fri 17:00 ET)', () => {
  assert.equal(ms.crypto().open, true);
  assert.equal(ms.forex(at('2026-11-07T12:00:00Z')).open, false);   // Saturday
  assert.equal(ms.forex(at('2026-11-08T21:59:00Z')).open, false);   // Sun 16:59 ET
  assert.equal(ms.forex(at('2026-11-08T22:01:00Z')).open, true);    // Sun 17:01 ET
  assert.equal(ms.forex(at('2026-11-06T21:59:00Z')).open, true);    // Fri 16:59 ET
  assert.equal(ms.forex(at('2026-11-06T22:01:00Z')).open, false);   // Fri 17:01 ET
});
test('world markets: sessions, lunch break, countdowns, weekends, time zones', () => {
  const tokyoAm = ms.world(W('jp'), at('2026-11-02T01:00:00Z'));    // 10:00 JST
  assert.equal(tokyoAm.open, true); assert.equal(tokyoAm.localTime, '10:00'); assert.match(tokyoAm.next, /Closes in 1h 30m/);
  const lunch = ms.world(W('jp'), at('2026-11-02T03:00:00Z'));      // 12:00 JST
  assert.equal(lunch.label, 'Lunch break'); assert.match(lunch.next, /Opens in 30m/);
});
test('world markets: after-close and weekend', () => {
  assert.equal(ms.world(W('jp'), at('2026-11-02T06:45:00Z')).open, false);        // 15:45 JST closed
  assert.equal(ms.world(W('jp'), at('2026-11-02T05:00:00Z')).open, true);         // 14:00 JST open (afternoon session)
  const uk = ms.world(W('uk'), at('2026-11-02T09:00:00Z'));
  assert.equal(uk.open, true);
  const sat = ms.world(W('de'), at('2026-11-07T10:00:00Z'));
  assert.equal(sat.open, false); assert.match(sat.label, /weekend/); assert.match(sat.next, /Opens in/);
  assert.equal(ms.world(W('au'), at('2026-11-02T00:30:00Z')).open, true);         // 11:30 AEDT
  assert.equal(ms.world(W('in'), at('2026-11-02T04:00:00Z')).open, true);         // 09:30 IST
  assert.equal(ms.world(W('in'), at('2026-11-02T03:30:00Z')).open, false);        // 09:00 IST (before 9:15)
  assert.equal(ms.world(W('hk'), at('2026-11-02T04:30:00Z')).label, 'Lunch break'); // 12:30 HKT
  assert.equal(ms.world(W('ca'), at('2026-11-02T15:00:00Z')).open, true);
  assert.equal(ms.world(W('crypto'), at('2026-11-07T10:00:00Z')).open, true);
  assert.match(ms.world(W('us'), at('2026-11-26T15:00:00Z')).label, /holiday/);
});
test('every configured world market has a valid time zone and sessions', () => {
  for (const w of config.data.worldMarkets) {
    assert.doesNotThrow(() => ms.world(w), w.key);
    if (!w.always) assert.ok(w.sessions.length && w.index, w.key);
  }
  assert.equal(config.data.worldMarkets.length, 12);
});
test('post validation helpers', () => {
  assert.equal(lib.validatePost({ category: 'forex', subject: 'gbpusd', pick: 'Short', entry: '1.30', target: '1.28', stop: '1.31', timeframe: 'Swing', reasoning: 'Dollar strength continues.' }).value.subject, 'GBP/USD');
  assert.ok(lib.validatePost({ category: 'options', subject: 'AAPL 200P', pick: 'Long Put', entry: '4', target: '8', stop: '2', timeframe: 'Day trade', reasoning: 'Earnings hedge idea here.' }).value);
  assert.ok(lib.validatePost({ category: 'options', subject: 'AAPL', pick: 'Long', entry: '4', target: '8', stop: '2', timeframe: 'Swing', reasoning: 'Needs an option position.' }).error);
  assert.ok(lib.validatePost({ category: 'sports', subject: 'Lakers vs Celtics', pick: 'Lakers ML', odds: '+150', reasoning: 'Rest advantage matters here.' }).value);
  assert.ok(lib.validatePost({ category: 'sports', subject: 'Lakers vs Celtics', pick: 'Lakers ML', odds: '+150', units: '50', reasoning: 'Rest advantage matters here.' }).error);
  assert.equal(lib.fmtPct(1.234), '+1.23%'); assert.equal(lib.fmtPct(null), '—');
});
