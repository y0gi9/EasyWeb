const jwt = require('jsonwebtoken');
const { db } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
const FRONTEND_LOGIN_BASE = process.env.FRONTEND_URL || 'http://localhost:3000';

function getSessionTimeoutMinutes() {
  const raw = process.env.SESSION_TIMEOUT_MINUTES;
  const parsed = parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 24 * 60; // default to 24 hours
}

function getRefreshTokenDays() {
  const raw = process.env.REFRESH_TOKEN_DAYS;
  const parsed = parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 7;
}

function buildProxyLoginRedirect(req) {
  try {
    const loginUrl = new URL('/login', FRONTEND_LOGIN_BASE);
    const originalHost = req.get('x-easyweb-original-host')
      || req.get('x-forwarded-host')
      || req.get('host');
    const originalUri = req.get('x-original-uri') || '/';
    const originalScheme = req.get('x-forwarded-proto') || req.protocol || 'https';
    const upstreamIdHeader = req.get('x-easyweb-upstream-id');

    if (!originalHost) {
      return loginUrl.toString();
    }

    const target = `${originalScheme}://${originalHost}${originalUri}`;
    loginUrl.searchParams.set('redirect', target);

    if (upstreamIdHeader && /^\d+$/.test(upstreamIdHeader)) {
      loginUrl.searchParams.set('upstreamId', upstreamIdHeader);
    }

    return loginUrl.toString();
  } catch (error) {
    console.warn('Failed to build proxy login redirect:', error.message);
    return FRONTEND_LOGIN_BASE;
  }
}

function sendProxyUnauthorized(res, req, statusCode) {
  const redirectUrl = buildProxyLoginRedirect(req);
  res.set('X-Easyweb-Auth-Redirect', redirectUrl);
  res.status(statusCode).end();
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const tokenFromHeader = authHeader && authHeader.split(' ')[1];
  const token = tokenFromHeader || req.cookies?.token;
  const isProxyAuthRequest = req.get('x-easyweb-auth-request') === '1';

  if (!token) {
    if (isProxyAuthRequest) {
      return sendProxyUnauthorized(res, req, 401);
    }
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err) {
      if (isProxyAuthRequest) {
        return sendProxyUnauthorized(res, req, 401);
      }
      return res.status(403).json({ error: 'Invalid token' });
    }

    try {
      // Get user from database to ensure they still exist and are active
      const user = await db()('users')
        .where({ id: decoded.userId, active: true })
        .first();

      if (!user) {
        if (isProxyAuthRequest) {
          return sendProxyUnauthorized(res, req, 401);
        }
        return res.status(403).json({ error: 'User not found or inactive' });
      }

      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      };
      
      next();
    } catch (error) {
      console.error('Authentication error:', error);
      if (isProxyAuthRequest) {
        return sendProxyUnauthorized(res, req, 500);
      }
      return res.status(500).json({ error: 'Authentication failed' });
    }
  });
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function generateToken(userId) {
  const timeoutMinutes = getSessionTimeoutMinutes();
  return jwt.sign(
    { userId },
    JWT_SECRET,
    { expiresIn: `${timeoutMinutes}m` }
  );
}

function generateRefreshToken(userId) {
  const refreshDays = getRefreshTokenDays();
  return jwt.sign(
    { userId, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: `${refreshDays}d` }
  );
}

module.exports = {
  authenticateToken,
  requireAdmin,
  generateToken,
  generateRefreshToken
};
