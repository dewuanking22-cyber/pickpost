-- Sports games cache (upserted from the ESPN scoreboard) + community voting + notifications

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,                 -- "<league>-<espn event id>", e.g. nfl-401873036
  league TEXT NOT NULL,
  event_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,             -- ISO UTC
  state TEXT NOT NULL DEFAULT 'pre' CHECK (state IN ('pre','in','post')),
  status_name TEXT NOT NULL DEFAULT '',-- e.g. STATUS_FINAL, STATUS_POSTPONED
  detail TEXT NOT NULL DEFAULT '',
  completed INTEGER NOT NULL DEFAULT 0,
  home_id TEXT, home_name TEXT NOT NULL, home_abbr TEXT NOT NULL DEFAULT '', home_score INTEGER,
  away_id TEXT, away_name TEXT NOT NULL, away_abbr TEXT NOT NULL DEFAULT '', away_score INTEGER,
  home_record TEXT, away_record TEXT,
  venue TEXT, broadcast TEXT,
  espn_spread REAL,                    -- spread from the HOME team's perspective (home -3 => -3)
  espn_total REAL,
  espn_ml_home TEXT, espn_ml_away TEXT, espn_ml_draw TEXT,   -- shown for reference only
  graded INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_games_start ON games(starts_at);
CREATE INDEX IF NOT EXISTS idx_games_league ON games(league, starts_at);

-- Community / admin lines used when ESPN has none (or admin overrides)
CREATE TABLE IF NOT EXISTS game_lines (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  market TEXT NOT NULL CHECK (market IN ('total','spread')),
  line REAL NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('admin','community')),
  set_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (game_id, market)
);

CREATE TABLE IF NOT EXISTS game_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  market TEXT NOT NULL CHECK (market IN ('moneyline','total','spread')),
  pick TEXT NOT NULL CHECK (pick IN ('home','away','draw','over','under')),
  line REAL,                           -- line in force when the vote was cast (total, or home spread)
  result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','won','lost','push','void')),
  graded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, game_id, market)
);
CREATE INDEX IF NOT EXISTS idx_gv_game ON game_votes(game_id);
CREATE INDEX IF NOT EXISTS idx_gv_user ON game_votes(user_id, result);

CREATE TABLE IF NOT EXISTS market_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,                -- Yahoo-style symbol: AAPL, ^GSPC, BTC-USD, EURUSD=X
  label TEXT NOT NULL DEFAULT '',
  timeframe TEXT NOT NULL CHECK (timeframe IN ('day','week')),
  starts_at TEXT NOT NULL,             -- window start (votes lock here), ISO UTC
  ends_at TEXT NOT NULL,               -- window end (graded here), ISO UTC
  direction TEXT NOT NULL CHECK (direction IN ('up','down')),
  target_pct REAL,                     -- optional minimum % move
  start_price REAL, end_price REAL, change_pct REAL,
  result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','won','lost','push','void')),
  graded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, symbol, timeframe, starts_at)
);
CREATE INDEX IF NOT EXISTS idx_mv_window ON market_votes(symbol, timeframe, starts_at);
CREATE INDEX IF NOT EXISTS idx_mv_pending ON market_votes(result, ends_at);

-- Shared votes: feed posts and channel messages that embed a vote card
ALTER TABLE posts ADD COLUMN kind TEXT NOT NULL DEFAULT 'idea';      -- idea | game_vote | market_vote
ALTER TABLE posts ADD COLUMN vote_id INTEGER;
ALTER TABLE posts ADD COLUMN game_id TEXT;                           -- idea posts can be linked to a game
CREATE INDEX IF NOT EXISTS idx_posts_game ON posts(game_id);
ALTER TABLE messages ADD COLUMN card TEXT;                           -- JSON snapshot for shared vote cards

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  href TEXT NOT NULL DEFAULT '/',
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, id DESC);
