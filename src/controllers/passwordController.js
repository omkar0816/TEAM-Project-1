const { db } = require('../models/database');
const bcrypt = require('bcrypt');

async function changePassword(req, res) {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long.' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    await db.execute('UPDATE teachers SET password_hash = ?, password_changed = TRUE WHERE id = ?', [passwordHash, req.session.userId]);
    req.session.mustChangePassword = false;
    return res.json({ success: true });
  } catch (err) {
    console.error('Password change error:', err);
    return res.status(500).json({ success: false, message: 'Unable to update password' });
  }
}

module.exports = {
  changePassword,
};
