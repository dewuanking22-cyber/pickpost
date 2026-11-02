// Usage: npm run reset-password -- <username> <new-password>
const bcrypt = require('bcryptjs');
const db = require('../db');
const [username, pw] = process.argv.slice(2);
if (!username || !pw || pw.length < 8) { console.error('Usage: npm run reset-password -- <username> <new-password (8+ chars)>'); process.exit(1); }
const r = db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(bcrypt.hashSync(pw, 11), username);
if (!r.changes) { console.error('No such user:', username); process.exit(1); }
db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(username);
console.log('Password updated for', username);
