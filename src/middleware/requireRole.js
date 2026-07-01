function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    if (req.session.role !== role) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = requireRole;
