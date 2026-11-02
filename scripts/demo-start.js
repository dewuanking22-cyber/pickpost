// Demo/free-hosting start: `node scripts/demo-start.js`
// Free hosts (e.g. Render free) have no persistent disk, so the database starts empty after every deploy/restart.
// When DEMO_SEED=true and the database has no users, this seeds demo content, creates an admin login from
// DEMO_ADMIN_USER / DEMO_ADMIN_PASSWORD (env vars - never commit them), randomises the seeded "admin" password,
// then starts the normal server and adds demo votes once the scoreboard has loaded some games.
const { execFileSync, spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const root = path.join(__dirname, '..');
const db = require('../db');

if (process.env.DEMO_SEED === 'true' && db.prepare('SELECT COUNT(*) n FROM users').get().n === 0) {
  console.log('[demo] empty database - seeding demo content');
  execFileSync(process.execPath, [path.join(__dirname, 'seed.js')], { cwd: root, stdio: 'inherit', env: process.env });
  const adminUser = (process.env.DEMO_ADMIN_USER || 'malik').toLowerCase();
  const pw = process.env.DEMO_ADMIN_PASSWORD;
  if (pw && pw.length >= 8) {
    db.prepare('INSERT OR REPLACE INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run(adminUser, bcrypt.hashSync(pw, 11));
    console.log('[demo] admin login created for', adminUser);
  } else console.log('[demo] DEMO_ADMIN_PASSWORD not set (8+ chars) - no admin login created');
  // The seeded "admin" account has a published demo password: randomise it.
  db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 11), 'admin');
  // Votes need games from the scoreboard, which loads shortly after boot.
  setTimeout(() => {
    spawn(process.execPath, [path.join(__dirname, 'seed-votes.js')], { cwd: root, stdio: 'inherit', env: process.env });
  }, 25000).unref();
}
require('../server').startServer().then((server) => {
  console.log('PickPost running on port', require('../config').port);
  const stop = () => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
});
