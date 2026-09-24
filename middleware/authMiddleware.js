const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'akshaya_deluxe_hostel_secret_key_2026';

function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Access Denied: No Token Provided' });
  }

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid or Expired Token' });
  }
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient Permissions' });
    }

    next();
  };
}

module.exports = { verifyToken, requireRole, JWT_SECRET };
