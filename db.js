const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
const dbFile = process.env.DB_FILE || path.join(config.dataDir, 'pickpost.db');
const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// ---- Versioned migrations: migrations/NNN_name.sql, applied once, in order, each in a transaction ----
function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  const done = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
  const applied = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => { db.exec(sql); db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(f); })();
    } finally { db.pragma('foreign_keys = ON'); }
    applied.push(f);
  }
  return applied;
}
const applied = migrate();
if (applied.length && process.env.NODE_ENV !== 'test') console.log('Applied migrations:', applied.join(', '));

db.migrate = migrate;
module.exports = db;
