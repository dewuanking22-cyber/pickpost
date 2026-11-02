const db = require('../db');
const ins = db.prepare('INSERT INTO notifications (user_id, type, text, href) VALUES (?, ?, ?, ?)');
function notify(userId, type, text, href = '/') {
  if (!userId) return;
  try { ins.run(userId, type, String(text).slice(0, 200), href); } catch (e) { /* user deleted */ }
}
module.exports = { notify };
