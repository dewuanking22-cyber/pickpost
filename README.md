# PickPost — a self-hosted social platform for trading ideas & sports picks

A Facebook + Discord style community for markets and sports, with **trading front and center**:

* **Two sides, one app** – a prominent **Markets | Sports | Split** switcher at the top. **Markets** side: live scrolling price ticker pinned at the top, then the markets feed, market vote cards and groups. **Sports** side: live scores strip pinned at the top, then the sports feed, game vote cards, teams and leaderboard. On wide desktops (≥1100px) **Split** shows both sides side by side, each with its own strip; on phones tap the switcher/bottom tabs or **swipe** to change sides. Profile, groups, notifications and settings are reachable from both sides.
* **Sports hub** – leagues (NFL, NBA, MLB, NHL, NCAA football & basketball, Premier League, MLS, Champions League, La Liga), today's/live/final games from ESPN, **game pages**, **team pages** (record, schedule & results, next-game vote card, picks mentioning the team), a sports feed and a **sports leaderboard**. Text only – no team logos.
* **Vote card on every game** – pick the **winner** (or **Draw** in soccer), **Over/Under** and the **Spread**, like a sportsbook card but **for tracking only: no money, no odds, no payouts**. Lines come from ESPN when available, otherwise the first voter sets a community line (admins can override/clear). Live split percentages, votes **lock at kickoff**, and results are **graded automatically** from the final score into each user's Won/Lost/Push record, accuracy and the leaderboards. Postponed/cancelled games void the vote.
* **Same vote card for markets** – **Up/Down** for the next session (or next week) on indices, crypto, forex and any US ticker, with an optional **target %** (right direction *and* a big enough move = won). Locks when the window starts, graded automatically from price data.
* **Share votes** to the feed and to group channels as cards (they update when graded), **My votes** history, and **notifications** (friend requests, comments on your posts, group approvals, graded votes).
* **Home feed** – ideas in 6 categories: **Stocks, Crypto, Forex, Options, Futures, Sports Picks**. Filter by category, world market, result, search, "following & friends".
* **Profiles, follows, friends** (request/accept), **reactions** (👍 🐂 🐻 🔥 💰), **comments**, per-user **track record** (W-L-P, win rate) and a **leaderboard** (overall or per market).
* **Mark picks Won / Lost / Push** (owner only, locked once settled so records stay honest).
* **Groups work like Discord servers** – public or private, with **text channels** (#general, #stocks, #crypto, #forex, #options, #futures, #sports-picks – editable), **real-time chat** over WebSockets, and roles: **owner / mod / member**. Private groups: members-only posts and chat, join by invite link or by request the owner/mods approve.
* **Global Markets** – pick US (NYSE/Nasdaq), London, Frankfurt, Paris, Tokyo, Hong Kong, Shanghai, India, Toronto, Sydney, plus Crypto and Forex. Each shows index level + change, **local time** and **Open / Closed / Lunch break** computed from its trading hours with a countdown. Posts and chat channels can be **tagged to a market**.
* **Live ticker + markets panel** (CoinGecko for crypto; Finnhub *or* Yahoo for stocks/indices/forex/futures) and a **live sports scoreboard** (ESPN public JSON: NFL, NBA, MLB, NHL, NCAA football & basketball, Premier League, MLS, Champions League, La Liga). Auto-refreshing. Text only – no team logos.
* **Moderation** – report posts (auto-hide after 3 reports), delete own open posts, mods delete chat messages, site admin dashboard (report queue, ban/unban, promote).
* **Installable PWA**, mobile-first with a bottom tab bar, dark mode, offline page.
* **Responsible-use footer on every page**: `21+ | Bet responsibly | 1-800-GAMBLER | Not financial advice. For entertainment and education only.` Sign-up requires confirming 21+. **No real payments, no trade execution, no gambling links** (links are blocked in posts, comments, chat, bios).

## Quick start (one command)

Requires **Node.js 18 or newer** (20 LTS recommended).

```bash
npm install
npm start          # http://localhost:3000
```

The first account that signs up becomes the **admin**. Want demo content? `npm run seed` (before anyone signs up) creates sample users, posts, groups and chat (password `demo12345` — delete before going live).

Other commands: `npm test` (58 automated tests), `npm run seed:votes` (demo votes, run after `npm run seed`), `npm run dev` (auto-restart), `npm run reset-password -- <user> <new-password>`.

## Customize / rebrand

Everything lives in **`config.js`** (and can be overridden with environment variables – see `.env.example`):

| What | Where |
|---|---|
| App name, tagline, accent colour, logo emoji | `appName`, `tagline`, `accentColor`, `logoEmoji` (or `APP_NAME`, `TAGLINE`, `ACCENT_COLOR`, `LOGO_EMOJI`) |
| Footer disclaimer | `footerText` – keep a responsible-use notice |
| Categories / markets | `markets` (stocks, crypto, forex, options, futures, sports) |
| World markets, hours, index symbols | `data.worldMarkets` |
| Ticker/quote lists, leagues | `data.stocks`, `data.crypto`, `data.forex`, `data.futures`, `data.leagues` |
| Reactions, default channels | `reactions`, `defaultChannels` |
| Voting: draw leagues, featured market cards, grading delay, leaderboard minimum | `votes.*` (`VOTE_LEADERBOARD_MIN`) |
| Link blocking, rate limits, limits per user | `blockLinks`, `maxPostsPerHour`, `maxGroupsPerUser`, … |
| Colours/layout | `public/style.css` (CSS variables at the top), icons in `public/icons/` |
| Page templates | `views/*.ejs` |

## Live data: sources, keys and limits (read this)

| Data | Source | Key? | Notes |
|---|---|---|---|
| Crypto | CoinGecko public API | none | Rate limited by CoinGecko; refreshed every 60 s |
| Stocks / ETFs | **Finnhub** if `FINNHUB_API_KEY` is set (free key at finnhub.io), otherwise Yahoo Finance's *unofficial* chart endpoint | optional | Yahoo's endpoint is undocumented and can change or block servers at any time |
| World indices, forex, futures | Yahoo Finance (unofficial). With a Finnhub key, indices fall back to an ETF proxy (e.g. EWU for London) | none / optional | Prices may be delayed 15 min or more |
| Sports scores, schedules, lines (spread / over-under) | ESPN public scoreboard JSON (unofficial) | none | Undocumented; may change. Not every game carries a line – then the community/admin line is used |
| Market vote grading | Yahoo Finance 5-minute bars (unofficial) | none | Graded ~10 min after a window ends; a vote that cannot be graded is voided after 14 days |

If a source is down or blocked the panel shows "unavailable"/last good values — the app never crashes. Set `MARKET_DATA=off` to disable all outbound data calls. **Check each provider's terms before commercial use;** for a production business consider a paid licensed data feed (swap the code in `services/`). Market-hours status uses regular sessions and the NYSE holiday list in `services/marketstatus.js`; **holidays for non-US exchanges and early closes are not modelled.**

## Deploy

### Render
1. Push this folder to a Git repo. 2. Render → *New → Blueprint* → select the repo (uses `render.yaml`). 3. The Blueprint attaches a 1 GB **persistent disk** at `/var/data` (needed for SQLite – requires a paid instance). 4. Open the URL, sign up – the first account is admin.

### Render free plan (demo only)
`render.yaml` is set to the **free** plan with no disk: the database lives in `/tmp` and is re-created and re-seeded with demo content (`DEMO_SEED=true`, via `scripts/demo-start.js`) on every deploy/restart. Set `DEMO_ADMIN_PASSWORD` in the Render dashboard to create an admin login (`DEMO_ADMIN_USER`, default `malik`). The free service sleeps after ~15 min idle. For a real community switch to a paid instance, add a disk at `/var/data`, set `DATA_DIR=/var/data`, use `npm start` and remove `DEMO_SEED`.

### Railway
1. *New Project → Deploy from GitHub repo* (or `railway up`). 2. Add a **Volume** mounted at `/data`, then set variables `DATA_DIR=/data`, `NODE_ENV=production`. 3. Generate a domain. `railway.json` sets the start command and `/healthz` check.

### Docker / any VPS
```bash
docker build -t pickpost .
docker run -d -p 3000:3000 -v pickpost-data:/data pickpost
```
Without Docker: `npm ci --omit=dev && NODE_ENV=production npm start` behind nginx/Caddy (terminate HTTPS, pass `Upgrade`/`Connection` headers for WebSockets) and keep it alive with pm2/systemd.

**Important deployment notes**
* Serve over **HTTPS** in production (`NODE_ENV=production` turns on Secure cookies + HSTS and trusts one proxy hop).
* Run **one instance** (SQLite + in-process WebSocket rooms). Back up the `DATA_DIR` folder (the `.db`, `-wal` and `-shm` files).
* Free hosting tiers with ephemeral disks will lose your data on restart.

## Architecture & adding features

```
server.js            core: auth, sessions, CSRF, feed, posts, groups, moderation, plugin loader
config.js            all branding/limits/data lists
db.js + migrations/  SQLite (better-sqlite3), versioned migrations (NNN_name.sql, applied once, in a transaction)
lib.js               validation + formatting helpers
services/            marketstatus.js (hours), marketdata.js (quotes), scores.js (ESPN), votes.js (lines, locking, grading), prices.js (price provider), clock.js
routes/*.js          auto-loaded plugins: chat.js (socket.io), markets.js, sports.js, votes.js, notifications.js, friends.js, pwa.js
views/*.ejs          server-rendered templates      public/  CSS, client JS, PWA assets
test/                node:test suites (npm test)
```
**To add a feature:** drop a file in `routes/` exporting `function (app, ctx)`; `ctx` gives you `db`, `config`, `lib`, middleware (`requireLogin`, `requireAdmin`), group helpers and services. Need new tables? add `migrations/003_your_change.sql` — it runs automatically on next start. Real-time hooks: push a function to `ctx.onServer` to attach to the HTTP server (see `routes/chat.js`).

## Security model
bcrypt-hashed passwords (cost 11); random 256-bit session tokens in HttpOnly + SameSite=Lax (+Secure in production) cookies, **only a SHA-256 hash is stored**; CSRF double-submit token on every POST; same-origin check + cookie auth on WebSockets; IP rate limit on login/sign-up and per-account failed-login throttle; parameterised SQL everywhere; EJS auto-escaping; CSP (`script-src 'self'`), `X-Frame-Options: DENY`, `nosniff`; input validation on every form; links blocked in user content; private-group content enforced server-side in every query.

## Known limits (honest list)
* **SQLite only**, single instance. There is no Postgres adapter (the DB layer is synchronous `better-sqlite3`; a Postgres port means an async rewrite of `server.js` queries).
* **Plain JavaScript**, not TypeScript.
* No email: **no password reset by email** (admin uses `npm run reset-password`), no email verification, no push notifications (in-app only), no DMs, no image uploads, no search beyond the feed filters.
* Vote cards (game and market) are **auto-graded**; ordinary written picks/ideas (Won/Lost buttons) are still **self-reported**.
* Game data is limited to what ESPN's scoreboard returns (no box scores/player stats). Games without an ESPN line use a community line set by the first voter (admins can override) – a determined user can set a silly line; no vote-spam or multi-account protection beyond the sign-up/login rate limit.
* Market votes are always for the **next** session or week (you cannot vote on a session that has already opened). Windows follow regular exchange hours: non-US holidays are not modelled and US half-days use the normal close. Crypto and forex windows are approximations (UTC day / Mon–Fri). Arbitrary tickers are limited to US-style 1–5 letter symbols that the quote provider recognises. If Yahoo has no data, the vote is voided after 14 days.
* Swipe-to-switch on phones is tested with synthetic touch events, not on physical devices.
* Live data comes from free, unofficial, rate-limited endpoints — fine for a community site, not for anything that needs guaranteed accuracy or licensing.
* No real payments, trading, brokerage or sportsbook integration — by design.
* Not load-tested; sized for a community of thousands, not millions. English only. Accessibility basics only (labels, skip link, contrast), not audited.
* You are responsible for the legal side of running a betting/finance-adjacent community in your jurisdiction (age gating, disclosures, takedown process, privacy policy/terms).

## Tests
`npm test` boots the real app on a temp database and runs 58 tests: auth/CSRF/session hashing/throttling, post validation for every market, feed filters, reactions, comments, settling & records, follows/friends, reports/ban, public/private groups, invite/approve/roles, channels, real-time chat over WebSockets (auth, origin check, membership, moderation, rate limit), market-hours logic across time zones/DST, migrations, PWA assets and graceful degradation without data sources, **vote cards (line priority, soccer draws, change/clear, split %, locking at kickoff/window start), automatic grading (won/lost/push/void, targets, retries), ESPN refresh pipeline, sharing to feed/groups/chat, notifications, Markets/Sports/Split layout and mode safety**.

---

## Payhip listing (copy/paste)

**Title:** PickPost – Self-Hosted Trading & Sports Picks Community (Discord + Facebook style) with Live Markets

**Short description:** Launch your own members-only community for trading ideas and sports picks – with a clickable vote card on every game and market. Groups with real-time chat channels, public/private communities, a world-markets dashboard with open/closed status, live scores, track records and leaderboards — in a one-command Node.js app you own.

**Description:**
Build the community your followers actually want to live in.

**What you get**
- Home feed with Stocks, Crypto, Forex, Options, Futures and Sports Picks – entry/target/stop or odds + reasoning
- Friends, follows, reactions, comments, profiles
- Verified-by-record Won/Lost/Push tracking and leaderboards (overall and per market)
- Discord-style groups: public or private, text channels, real-time chat, owner/mod/member roles, invite links & join approvals
- Global Markets: US, London, Frankfurt, Paris, Tokyo, Hong Kong, Shanghai, India, Toronto, Sydney, Crypto, Forex — index level, local time, Open/Closed status
- NEW: one app, two sides – Markets (live price ticker, markets feed, groups) and Sports (live scores strip, sports feed, teams, leaderboard) with a Markets | Sports | Split switcher; side-by-side split view on desktop, swipe/tap on mobile
- NEW: Sports hub with a clickable vote card on every game – winner (or draw), over/under and spread – for tracking only (no money, no odds, no payouts). Locks at kickoff, auto-graded from final scores, split percentages, accuracy and sports leaderboard
- NEW: the same vote card for markets – Up/Down for the next session or week with an optional target %, auto-graded from price data
- NEW: share votes to the feed or group channels, My votes history, in-app notifications
- Live price ticker and live scores (NFL, NBA, MLB, NHL, NCAA, Premier League, MLS, Champions League, La Liga)
- Moderation tools, admin dashboard, report queue
- Installable mobile PWA, dark mode, clean modern UI, fully rebrandable from one config file
- Includes deploy files for Render, Railway and Docker, 58 automated tests, and a step-by-step README

**Built-in responsible-use design:** voting is tracking only (no wagers, odds payouts or money of any kind), 21+ sign-up confirmation, "Bet responsibly | 1-800-GAMBLER | Not financial advice" footer on every page, no real payments, no trade execution, no gambling links.

**Requirements:** Node.js 18+, any VPS/PaaS with a persistent disk. SQLite database included – no external services needed. Free market-data sources are used (optional free Finnhub key).

**Please note:** this is a community *platform* – it does not give financial or betting advice, execute trades or take bets. Live data comes from free third-party endpoints that can change or be rate limited. You are responsible for the legal compliance of your community in your jurisdiction.

**Suggested price:** **$59** (suggested launch price $39; $79–99 if you add a commercial/white-label license tier).

**Delivery:** one ZIP – unzip, `npm install`, `npm start` (optional: `npm run seed && npm run seed:votes` for demo content).
