// ============================================================
//  PickPost configuration  --  edit this file to rebrand.
//  Every value can also be set with an environment variable.
// ============================================================
const path = require('path');

module.exports = {
  // ---- Branding -------------------------------------------
  appName: process.env.APP_NAME || 'PickPost',
  tagline: process.env.TAGLINE || 'Share trading ideas and sports picks. Build a public track record.',
  accentColor: process.env.ACCENT_COLOR || '#4f46e5', // any hex color
  logoEmoji: process.env.LOGO_EMOJI || '📈',          // shown next to the name; set '' to hide

  // ---- Required legal footer (shown on every page) --------
  // Keep this text (or your own equivalent) - it is a responsible-use notice.
  footerText:
    '21+ | Bet responsibly | 1-800-GAMBLER | Not financial advice. For entertainment and education only.',

  // ---- Server ---------------------------------------------
  port: parseInt(process.env.PORT, 10) || 3000,
  // Where the SQLite database lives. On Render/Railway point this at a persistent disk/volume.
  dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
  // Set true automatically in production; forces "Secure" cookies (needs HTTPS).
  secureCookies: process.env.SECURE_COOKIES
    ? process.env.SECURE_COOKIES === 'true'
    : process.env.NODE_ENV === 'production',
  // Behind a proxy (Render, Railway, Heroku, nginx)? Leave true in production.
  trustProxy: process.env.TRUST_PROXY ? process.env.TRUST_PROXY === 'true' : process.env.NODE_ENV === 'production',

  // ---- Categories / markets -------------------------------
  // 'kind' decides which form fields are used: 'trading' (entry/target/stop) or 'sports' (game/odds/units).
  // You can rename labels or remove a market (keys are stored in the database - don't reuse a key for something else).
  markets: [
    { key: 'stocks',  label: 'Stocks',       kind: 'trading', icon: '🏢', subjectLabel: 'Ticker', placeholder: 'AAPL' },
    { key: 'crypto',  label: 'Crypto',       kind: 'trading', icon: '🪙', subjectLabel: 'Coin / pair', placeholder: 'BTC' },
    { key: 'forex',   label: 'Forex',        kind: 'trading', icon: '💱', subjectLabel: 'Currency pair', placeholder: 'EUR/USD' },
    { key: 'options', label: 'Options',      kind: 'trading', icon: '🧩', subjectLabel: 'Underlying + contract', placeholder: 'SPY 520C 12/20' },
    { key: 'futures', label: 'Futures',      kind: 'trading', icon: '📊', subjectLabel: 'Contract', placeholder: 'ES' },
    { key: 'sports',  label: 'Sports Picks', kind: 'sports',  icon: '🏟️', subjectLabel: 'Game', placeholder: 'Cowboys vs Cardinals' },
  ],

  // ---- Reactions (Facebook-style) --------------------------
  reactions: [
    { key: 'like',  emoji: '👍', label: 'Like' },
    { key: 'bull',  emoji: '🐂', label: 'Bullish' },
    { key: 'bear',  emoji: '🐻', label: 'Bearish' },
    { key: 'fire',  emoji: '🔥', label: 'Fire' },
    { key: 'money', emoji: '💰', label: 'Money' },
  ],

  // ---- Group channels (Discord-style) ----------------------
  // Channels created automatically for every new group. Owners/mods can add more.
  defaultChannels: [
    { name: 'general', topic: 'Welcome! Chat about anything here.' },
    { name: 'stocks', topic: 'Stocks & indices', exchange: 'us' },
    { name: 'crypto', topic: 'Crypto ideas and chat', exchange: 'crypto' },
    { name: 'forex', topic: 'Currency pairs', exchange: 'forex' },
    { name: 'options', topic: 'Options flow & setups' },
    { name: 'futures', topic: 'Futures contracts' },
    { name: 'sports-picks', topic: 'Sports picks and game talk' },
  ],
  maxChannelsPerGroup: 20,
  maxMessagesPerMinute: 20,

  // ---- Live data panels -----------------------------------
  // Everything below uses free public sources and degrades gracefully (panels show
  // "unavailable" instead of breaking) if a source is down or blocked.
  data: {
    enabled: process.env.MARKET_DATA !== 'off',
    // Optional free key from https://finnhub.io (60 calls/min on the free plan). If empty,
    // stock/index/forex/futures quotes fall back to Yahoo Finance's unofficial chart endpoint.
    finnhubKey: process.env.FINNHUB_API_KEY || '',
    useYahooFallback: process.env.USE_YAHOO_FALLBACK !== 'false',
    refreshSeconds: 60,
    // Edit these lists to change what appears on the ticker / markets page.
    stocks: [
      { symbol: 'SPY', name: 'S&P 500 ETF' }, { symbol: 'QQQ', name: 'Nasdaq 100 ETF' },
      { symbol: 'DIA', name: 'Dow ETF' }, { symbol: 'IWM', name: 'Russell 2000 ETF' },
      { symbol: 'AAPL', name: 'Apple' }, { symbol: 'MSFT', name: 'Microsoft' }, { symbol: 'NVDA', name: 'NVIDIA' },
      { symbol: 'TSLA', name: 'Tesla' }, { symbol: 'AMZN', name: 'Amazon' }, { symbol: 'META', name: 'Meta' },
    ],
    // Yahoo symbols (^GSPC etc) - only used when Yahoo fallback is on.
    indices: [
      { symbol: '^GSPC', name: 'S&P 500' }, { symbol: '^IXIC', name: 'Nasdaq' }, { symbol: '^DJI', name: 'Dow' }, { symbol: '^VIX', name: 'VIX' },
    ],
    crypto: [ // CoinGecko ids
      { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' }, { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
      { id: 'solana', symbol: 'SOL', name: 'Solana' }, { id: 'ripple', symbol: 'XRP', name: 'XRP' },
      { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin' }, { id: 'cardano', symbol: 'ADA', name: 'Cardano' },
    ],
    forex: [ // Yahoo symbols; falls back to daily ECB rates (frankfurter.dev) if Yahoo is off
      { symbol: 'EURUSD=X', name: 'EUR/USD', base: 'EUR', quote: 'USD' }, { symbol: 'GBPUSD=X', name: 'GBP/USD', base: 'GBP', quote: 'USD' },
      { symbol: 'USDJPY=X', name: 'USD/JPY', base: 'USD', quote: 'JPY' }, { symbol: 'AUDUSD=X', name: 'AUD/USD', base: 'AUD', quote: 'USD' },
      { symbol: 'USDCAD=X', name: 'USD/CAD', base: 'USD', quote: 'CAD' },
    ],
    futures: [
      { symbol: 'ES=F', name: 'S&P 500 futures' }, { symbol: 'NQ=F', name: 'Nasdaq futures' },
      { symbol: 'CL=F', name: 'Crude oil' }, { symbol: 'GC=F', name: 'Gold' },
    ],
    // ESPN public scoreboard JSON (unofficial but widely used; no key).
    leagues: [
      { key: 'nfl', label: 'NFL', path: 'football/nfl' },
      { key: 'nba', label: 'NBA', path: 'basketball/nba' },
      { key: 'mlb', label: 'MLB', path: 'baseball/mlb' },
      { key: 'nhl', label: 'NHL', path: 'hockey/nhl' },
      { key: 'ncaaf', label: 'NCAA Football', path: 'football/college-football' },
      { key: 'ncaam', label: 'NCAA Basketball', path: 'basketball/mens-college-basketball' },
      { key: 'epl', label: 'Premier League', path: 'soccer/eng.1' },
      { key: 'mls', label: 'MLS', path: 'soccer/usa.1' },
      { key: 'ucl', label: 'Champions League', path: 'soccer/uefa.champions' },
      { key: 'laliga', label: 'La Liga', path: 'soccer/esp.1' },
    ],
    scoresRefreshSeconds: 30,

    // ---- Global markets (picker on /markets, tags on posts & channels) ----
    // sessions are local-time [open, close] pairs (24h "HH:MM"); lunch breaks are just two sessions.
    // 'index' is a Yahoo Finance symbol (no key needed). 'proxy' is an ETF Finnhub can quote if you set
    // FINNHUB_API_KEY and Yahoo is unavailable. Public holidays are NOT modelled except the US (see
    // services/marketstatus.js) - the status can show "Open" on a local holiday.
    worldMarkets: [
      { key: 'us', flag: '🇺🇸', name: 'US', exchange: 'NYSE / Nasdaq', index: '^GSPC', indexName: 'S&P 500', index2: '^IXIC', index2Name: 'Nasdaq Comp.', proxy: 'SPY', tz: 'America/New_York', sessions: [['09:30', '16:00']], holidays: 'nyse' },
      { key: 'uk', flag: '🇬🇧', name: 'London', exchange: 'LSE', index: '^FTSE', indexName: 'FTSE 100', proxy: 'EWU', tz: 'Europe/London', sessions: [['08:00', '16:30']] },
      { key: 'de', flag: '🇩🇪', name: 'Frankfurt', exchange: 'Xetra', index: '^GDAXI', indexName: 'DAX', proxy: 'EWG', tz: 'Europe/Berlin', sessions: [['09:00', '17:30']] },
      { key: 'fr', flag: '🇫🇷', name: 'Paris', exchange: 'Euronext Paris', index: '^FCHI', indexName: 'CAC 40', proxy: 'EWQ', tz: 'Europe/Paris', sessions: [['09:00', '17:30']] },
      { key: 'jp', flag: '🇯🇵', name: 'Tokyo', exchange: 'TSE', index: '^N225', indexName: 'Nikkei 225', proxy: 'EWJ', tz: 'Asia/Tokyo', sessions: [['09:00', '11:30'], ['12:30', '15:30']] },
      { key: 'hk', flag: '🇭🇰', name: 'Hong Kong', exchange: 'HKEX', index: '^HSI', indexName: 'Hang Seng', proxy: 'EWH', tz: 'Asia/Hong_Kong', sessions: [['09:30', '12:00'], ['13:00', '16:00']] },
      { key: 'cn', flag: '🇨🇳', name: 'Shanghai', exchange: 'SSE', index: '000001.SS', indexName: 'SSE Composite', proxy: 'ASHR', tz: 'Asia/Shanghai', sessions: [['09:30', '11:30'], ['13:00', '15:00']] },
      { key: 'in', flag: '🇮🇳', name: 'India', exchange: 'NSE / BSE', index: '^NSEI', indexName: 'Nifty 50', index2: '^BSESN', index2Name: 'Sensex', proxy: 'INDA', tz: 'Asia/Kolkata', sessions: [['09:15', '15:30']] },
      { key: 'ca', flag: '🇨🇦', name: 'Toronto', exchange: 'TSX', index: '^GSPTSE', indexName: 'S&P/TSX', proxy: 'EWC', tz: 'America/Toronto', sessions: [['09:30', '16:00']] },
      { key: 'au', flag: '🇦🇺', name: 'Sydney', exchange: 'ASX', index: '^AXJO', indexName: 'ASX 200', proxy: 'EWA', tz: 'Australia/Sydney', sessions: [['10:00', '16:00']] },
      // Always-on asset classes (status comes from the 24/7 and 24/5 rules)
      { key: 'crypto', flag: '🪙', name: 'Crypto', exchange: '24/7', always: 'crypto', tz: 'UTC' },
      { key: 'forex', flag: '💱', name: 'Forex', exchange: '24/5', always: 'forex', tz: 'America/New_York' },
    ],
  },

  // ---- Accounts -------------------------------------------
  // The first account that signs up becomes admin. You can also list
  // usernames here (comma separated) that are always admins.
  adminUsernames: (process.env.ADMIN_USERNAMES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  allowSignups: process.env.ALLOW_SIGNUPS !== 'false',
  sessionDays: 30,
  authAttemptsPer15Min: parseInt(process.env.AUTH_RATE_LIMIT, 10) || 20, // login/signup attempts per IP

  // ---- Content rules --------------------------------------
  // Blocks http(s):// and www. links in posts/comments/bios (keeps the site free of gambling/affiliate links).
  blockLinks: process.env.BLOCK_LINKS !== 'false',
  maxPostsPerHour: 20,
  maxCommentsPerHour: 60,
  // Owners may delete their own posts only while the pick is still open
  // (stops people hiding losing picks from their record). Admins can always delete.
  allowDeleteSettled: false,
  // Reports needed before a post is auto-hidden pending admin review (0 = never auto-hide).
  autoHideAfterReports: 3,

  // ---- Groups ---------------------------------------------
  maxGroupsPerUser: 5,
  maxFriends: 500,

  // ---- Voting (tracking only - no money, no odds, no payouts) ----
  votes: {
    leaderboardMin: parseInt(process.env.VOTE_LEADERBOARD_MIN, 10) || 3, // graded votes needed to rank
    maxCommunityLine: 500,
    // Leagues where a draw is a valid moneyline outcome (3-way).
    drawLeagues: ['epl', 'mls', 'ucl', 'laliga'],
    // Market vote symbols shown as vote cards on the Markets side (Yahoo-style symbols)
    featured: [
      { symbol: '^GSPC', label: 'S&P 500' }, { symbol: '^IXIC', label: 'Nasdaq' }, { symbol: 'BTC-USD', label: 'Bitcoin' },
      { symbol: 'ETH-USD', label: 'Ethereum' }, { symbol: 'EURUSD=X', label: 'EUR/USD' }, { symbol: 'AAPL', label: 'Apple' },
    ],
    gradeDelayMinutes: 10,   // wait after a window ends before grading from price data
    voidAfterDays: 14,       // ungradable (no price data) market votes are voided after this long
  },

  // ---- Leaderboard ----------------------------------------
  leaderboardMinSettled: parseInt(process.env.LEADERBOARD_MIN_SETTLED, 10) || 3,
  pageSize: 15,
};
