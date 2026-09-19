const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'sahayak_jwt_secret_key_2026';

/**
 * Verifies a Bearer JWT issued by /api/auth/login.
 * Populates req.user = { id, role }.
 */
function authenticateToken(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: { code: 'NO_TOKEN', message: 'Authorization header with Bearer token is required' }
    });
  }

  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) {
      const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
      return res.status(401).json({ success: false, error: { code, message: 'Invalid or expired token' } });
    }
    req.user = payload; // { id, role }
    next();
  });
}

/**
 * Verifies a static API key (used by trusted server-to-server callers,
 * e.g. the voice/IVR platform submitting assistance requests on behalf
 * of a senior citizen who has no login session).
 */
function authenticateApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  const expected = process.env.VOICE_API_KEY || 'voice_platform_secret_key';

  if (!key || key !== expected) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_API_KEY', message: 'Missing or invalid x-api-key header' }
    });
  }
  next();
}

/**
 * Restricts a route to one or more roles. Must run after authenticateToken.
 * Usage: requireRole('police_admin') or requireRole('police_admin', 'volunteer')
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: `Requires role: ${allowedRoles.join(' or ')}` }
      });
    }
    next();
  };
}

module.exports = { authenticateToken, authenticateApiKey, requireRole };
