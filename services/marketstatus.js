// Open/closed status for the main market types. Pure functions, no network.
// US equities: Mon-Fri 9:30-16:00 America/New_York (pre-market 4:00, after-hours to 20:00), closed on NYSE holidays.
// Crypto: 24/7. Forex: Sunday 17:00 ET -> Friday 17:00 ET. Futures (CME equity/energy/metals): Sunday 18:00 ET -> Friday 17:00 ET, daily break 17:00-18:00 ET.
// Early-close days (e.g. day after Thanksgiving) are not modelled.

// NYSE full-day holidays. Add future years here.
const NYSE_HOLIDAYS = [
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
];

function etParts(date) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { dow, ymd: `${p.year}-${p.month}-${p.day}`, mins: (parseInt(p.hour, 10) % 24) * 60 + parseInt(p.minute, 10) };
}

function usEquities(now = new Date()) {
  const { dow, ymd, mins } = etParts(now);
  if (dow === 0 || dow === 6) return { open: false, state: 'closed', label: 'Closed (weekend)' };
  if (NYSE_HOLIDAYS.includes(ymd)) return { open: false, state: 'closed', label: 'Closed (market holiday)' };
  if (mins >= 570 && mins < 960) return { open: true, state: 'open', label: 'Open' };
  if (mins >= 240 && mins < 570) return { open: false, state: 'extended', label: 'Pre-market' };
  if (mins >= 960 && mins < 1200) return { open: false, state: 'extended', label: 'After-hours' };
  return { open: false, state: 'closed', label: 'Closed' };
}
function crypto() { return { open: true, state: 'open', label: 'Open 24/7' }; }
function forex(now = new Date()) {
  const { dow, mins } = etParts(now);
  const open = !(dow === 6 || (dow === 5 && mins >= 1020) || (dow === 0 && mins < 1020));
  return open ? { open: true, state: 'open', label: 'Open (24/5)' } : { open: false, state: 'closed', label: 'Closed (weekend)' };
}
function futures(now = new Date()) {
  const { dow, mins } = etParts(now);
  if (dow === 6 || (dow === 5 && mins >= 1020) || (dow === 0 && mins < 1080)) return { open: false, state: 'closed', label: 'Closed (weekend)' };
  if (mins >= 1020 && mins < 1080) return { open: false, state: 'closed', label: 'Daily break' };
  return { open: true, state: 'open', label: 'Open (23/5)' };
}
// ---- World markets: generic session-based status in the exchange's own time zone ----
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function localParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  return { dow: DOW.indexOf(p.weekday), y: +p.year, mo: +p.month, d: +p.day, ymd: `${p.year}-${p.month}-${p.day}`, mins: (parseInt(p.hour, 10) % 24) * 60 + parseInt(p.minute, 10) };
}
const toMin = (hhmm) => { const [h, mm] = hhmm.split(':').map(Number); return h * 60 + mm; };
function fmtIn(mins) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), mm = mins % 60;
  if (h < 48) return mm ? `${h}h ${mm}m` : `${h}h`;
  return `${Math.round(h / 24)}d`;
}
// Returns { open, state, label, next, localTime, localDay } for one world-market config entry.
function world(m, now = new Date()) {
  const lp = localParts(now, m.tz);
  const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: m.tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const base = { localTime, localDay: DOW[lp.dow] };
  if (m.always === 'crypto') return { ...base, ...crypto(), next: null };
  if (m.always === 'forex') return { ...base, ...forex(now), next: null };
  const holiday = m.holidays === 'nyse' && NYSE_HOLIDAYS.includes(lp.ymd);
  const sessions = m.sessions.map(([a, b]) => [toMin(a), toMin(b)]);
  if (lp.dow >= 1 && lp.dow <= 5 && !holiday) {
    const cur = sessions.find(([a, b]) => lp.mins >= a && lp.mins < b);
    if (cur) return { ...base, open: true, state: 'open', label: 'Open', next: `Closes in ${fmtIn(cur[1] - lp.mins)}` };
    const nextS = sessions.find(([a]) => lp.mins < a);
    if (nextS) {
      const lunch = lp.mins >= sessions[0][1];
      return { ...base, open: false, state: lunch ? 'break' : 'closed', label: lunch ? 'Lunch break' : 'Closed', next: `Opens in ${fmtIn(nextS[0] - lp.mins)}` };
    }
  }
  for (let add = 1; add <= 10; add++) {
    const dt = new Date(Date.UTC(lp.y, lp.mo - 1, lp.d + add));
    const dow = dt.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (m.holidays === 'nyse' && NYSE_HOLIDAYS.includes(dt.toISOString().slice(0, 10))) continue;
    const mins = add * 1440 + sessions[0][0] - lp.mins;
    return { ...base, open: false, state: 'closed', label: holiday ? 'Closed (holiday)' : (lp.dow === 0 || lp.dow === 6 ? 'Closed (weekend)' : 'Closed'), next: `Opens in ${fmtIn(mins)}` };
  }
  return { ...base, open: false, state: 'closed', label: 'Closed', next: null };
}

function all(now = new Date()) {
  return { stocks: usEquities(now), crypto: crypto(), forex: forex(now), futures: futures(now) };
}
module.exports = { NYSE_HOLIDAYS, world, all, usEquities, crypto, forex, futures };
