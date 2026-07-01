function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = requireAuth;
