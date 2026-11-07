const jwt = require('jsonwebtoken');

const secret = () => process.env.JWT_SECRET || 'dev-secret-change-me';

const sign = (u) =>
  jwt.sign({ id: u.id, role: u.role, name: u.name }, secret(), { expiresIn: '12h' });

function authenticate(req, res, next) {
  let token = null;
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) token = h.slice(7);
  else if (req.query.token) token = req.query.token; // for <img>/PDF downloads
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, secret());
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Forbidden' });

module.exports = { sign, authenticate, requireRole };
