const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const MicrosoftStrategy = require('passport-microsoft').Strategy;
const { db } = require('../config/database');
const { generateToken, generateRefreshToken, authenticateToken } = require('../middleware/auth');
const { cacheSet, cacheDel } = require('../config/redis');

const router = express.Router();

const ALLOWED_USER_EMAILS = process.env.ALLOWED_USER_EMAILS || process.env.EASYWEB_ALLOWED_USERS || '';

function parseAllowedEmailRules(raw) {
  if (!raw) {
    return [];
  }

  return raw
    .split(/[\s,]+/)
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);
}

const allowedEmailRules = parseAllowedEmailRules(ALLOWED_USER_EMAILS);

function isEmailAllowedByEnv(email) {
  if (!email) {
    return false;
  }

  const normalized = email.trim().toLowerCase();

  if (!allowedEmailRules.length) {
    return true;
  }

  return allowedEmailRules.some(rule => {
    if (rule.startsWith('*@')) {
      return normalized.endsWith(rule.slice(1));
    }

    if (rule.startsWith('@')) {
      return normalized.endsWith(rule);
    }

    return normalized === rule;
  });
}

function createUnauthorizedError(message = 'User is not authorized to access EasyWeb') {
  const error = new Error(message);
  error.statusCode = 403;
  error.code = 'EASYWEB_UNAUTHORIZED';
  return error;
}

async function isRegistrationEnabledSetting() {
  if (process.env.REGISTRATION_ENABLED !== undefined) {
    return process.env.REGISTRATION_ENABLED === 'true';
  }

  try {
    const record = await db()('settings').where({ key: 'registration_enabled' }).first();
    if (record) {
      return record.value === 'true';
    }
  } catch (error) {
    console.warn('Failed to read registration setting:', error.message);
  }

  return false;
}

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const githubClientId = process.env.GITHUB_CLIENT_ID;
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
const microsoftClientId = process.env.MICROSOFT_CLIENT_ID;
const microsoftClientSecret = process.env.MICROSOFT_CLIENT_SECRET;
const callbackBaseUrl = process.env.OAUTH_BASE_URL || 'http://localhost:3001';

const buildCallbackUrl = (path) => {
  try {
    return new URL(path, callbackBaseUrl).toString();
  } catch (error) {
    console.warn('Invalid OAUTH_BASE_URL; falling back to default http://localhost:3001', error);
    return new URL(path, 'http://localhost:3001').toString();
  }
};

const configuredProviders = {
  google: Boolean(googleClientId && googleClientSecret),
  github: Boolean(githubClientId && githubClientSecret),
  microsoft: Boolean(microsoftClientId && microsoftClientSecret)
};

// Passport configuration
if (configuredProviders.google) {
  passport.use(new GoogleStrategy({
    clientID: googleClientId,
    clientSecret: googleClientSecret,
    callbackURL: buildCallbackUrl('/api/auth/google/callback')
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const userData = {
        provider: 'google',
        provider_id: profile.id,
        email: profile.emails[0].value,
        name: profile.displayName,
        avatar_url: profile.photos[0].value
      };

      const user = await findOrCreateUser(userData);
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }));
} else {
  console.warn('Google OAuth credentials not configured. Google login disabled.');
}

if (configuredProviders.github) {
  passport.use(new GitHubStrategy({
    clientID: githubClientId,
    clientSecret: githubClientSecret,
    callbackURL: buildCallbackUrl('/api/auth/github/callback')
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const userData = {
        provider: 'github',
        provider_id: profile.id,
        email: profile.emails && profile.emails[0] ? profile.emails[0].value : `${profile.username}@github.local`,
        name: profile.displayName || profile.username,
        avatar_url: profile.photos[0].value
      };

      const user = await findOrCreateUser(userData);
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }));
} else {
  console.warn('GitHub OAuth credentials not configured. GitHub login disabled.');
}

if (configuredProviders.microsoft) {
  passport.use(new MicrosoftStrategy({
    clientID: microsoftClientId,
    clientSecret: microsoftClientSecret,
    callbackURL: buildCallbackUrl('/api/auth/microsoft/callback')
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const userData = {
        provider: 'microsoft',
        provider_id: profile.id,
        email: profile.emails[0].value,
        name: profile.displayName,
        avatar_url: profile.photos[0].value
      };

      const user = await findOrCreateUser(userData);
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }));
} else {
  console.warn('Microsoft OAuth credentials not configured. Microsoft login disabled.');
}

async function findOrCreateUser(userData) {
  try {
    const isActiveRecord = (record) => {
      if (record === undefined || record === null) {
        return false;
      }
      if (typeof record === 'boolean') {
        return record;
      }
      if (typeof record === 'string') {
        return record === '1' || record.toLowerCase() === 'true';
      }
      if (typeof record === 'number') {
        return record === 1;
      }
      return Boolean(record);
    };

    // First try to find user by provider and provider_id
    let user = await db()('users')
      .where({ provider: userData.provider, provider_id: userData.provider_id })
      .first();

    if (user) {
      // Update user info if changed
      await db()('users')
        .where({ id: user.id })
        .update({
          name: userData.name,
          email: userData.email,
          avatar_url: userData.avatar_url,
          updated_at: new Date()
        });
      
      if (!isActiveRecord(user.active)) {
        throw createUnauthorizedError('This account has been deactivated');
      }

      return { ...user, ...userData };
    }

    // Try to find by email (account linking)
    user = await db()('users')
      .where({ email: userData.email })
      .first();

    if (user) {
      if (!isActiveRecord(user.active)) {
        throw createUnauthorizedError('This account has been deactivated');
      }

      // Link this provider to existing account
      await db()('users')
        .where({ id: user.id })
        .update({
          provider: userData.provider,
          provider_id: userData.provider_id,
          avatar_url: userData.avatar_url,
          updated_at: new Date()
        });
      
      return { ...user, ...userData };
    }

    const [{ count }] = await db()('users').count('* as count');
    const totalUsers = Number(count) || 0;
    const isFirstUser = totalUsers === 0;

    if (!isFirstUser) {
      const registrationEnabled = await isRegistrationEnabledSetting();
      if (!registrationEnabled) {
        throw createUnauthorizedError('User registration is disabled');
      }

      if (!isEmailAllowedByEnv(userData.email)) {
        throw createUnauthorizedError();
      }
    }

    const now = new Date();
    const baseRole = isFirstUser ? 'admin' : 'user';

    const [userId] = await db()('users').insert({
      ...userData,
      role: baseRole,
      active: true,
      created_at: now,
      updated_at: now
    });

    if (isFirstUser) {
      userData.role = 'admin';
    }

    return { id: userId, ...userData, role: userData.role || baseRole };
  } catch (error) {
    console.error('Error finding or creating user:', error);
    throw error;
  }
}

// Auth routes
const FRONTEND_REDIRECT = process.env.FRONTEND_URL || 'http://localhost:3000';
const OAUTH_REDIRECT_COOKIE = 'oauth_redirect';

function deriveCookieDomain(url) {
  try {
    const { hostname } = new URL(url);
    if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') {
      return undefined;
    }

    if (hostname.split('.').length <= 2) {
      return `.${hostname}`;
    }

    const parts = hostname.split('.');
    return `.${parts.slice(-2).join('.')}`;
  } catch (error) {
    console.warn('Failed to derive auth cookie domain:', error.message);
    return undefined;
  }
}

const AUTH_COOKIE_DOMAIN = process.env.AUTH_COOKIE_DOMAIN || deriveCookieDomain(FRONTEND_REDIRECT);

const baseCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
};

const sharedCookieOptions = AUTH_COOKIE_DOMAIN
  ? { ...baseCookieOptions, domain: AUTH_COOKIE_DOMAIN }
  : baseCookieOptions;

function sendNotConfigured(provider, res) {
  return res.status(501).json({
    error: `${provider} OAuth is not configured. Set client credentials to enable this provider.`
  });
}

function initiateAuth(provider, options) {
  return (req, res, next) => {
    const redirectTarget = sanitizeRedirect(req.query.redirect);
    rememberRedirect(res, redirectTarget);
    passport.authenticate(provider, options)(req, res, next);
  };
}

function buildLoginRedirectUrl(target, reason) {
  const loginUrl = new URL('/login', FRONTEND_REDIRECT);
  if (target) {
    loginUrl.searchParams.set('redirect', target);
  }
  if (reason) {
    loginUrl.searchParams.set('error', reason);
  }
  return loginUrl.toString();
}

function buildUnauthorizedRedirectUrl(target, reason) {
  const unauthorizedUrl = new URL('/unauthorized', FRONTEND_REDIRECT);
  if (target) {
    unauthorizedUrl.searchParams.set('redirect', target);
  }
  if (reason) {
    unauthorizedUrl.searchParams.set('error', reason);
  }
  return unauthorizedUrl.toString();
}

function isUnauthorizedError(error) {
  if (!error) {
    return false;
  }

  if (typeof error === 'string') {
    const normalized = error.toLowerCase();
    return normalized.includes('unauthorized')
      || normalized.includes('not authorized')
      || normalized.includes('registration is disabled')
      || normalized.includes('deactivated');
  }

  const code = typeof error.code === 'string' ? error.code.toUpperCase() : null;
  if (code === 'EASYWEB_UNAUTHORIZED' || code === 'UNAUTHORIZED') {
    return true;
  }

  const statusLike = error.status ?? error.statusCode ?? error.status_code;
  if (statusLike && Number(statusLike) === 403) {
    return true;
  }

  const message = String(error.message || '').toLowerCase();
  return message.includes('unauthorized')
    || message.includes('not authorized')
    || message.includes('registration is disabled')
    || message.includes('deactivated');
}

function handleAuthCallback(provider) {
  return (req, res, next) => {
    passport.authenticate(provider, { session: false }, async (err, user, info) => {
      try {
        const cookieTarget = consumeRedirect(req, res);
        const queryTarget = sanitizeRedirect(req.query.redirect);
        const redirectTarget = cookieTarget || queryTarget || FRONTEND_REDIRECT;
        const unauthorized = isUnauthorizedError(err) || isUnauthorizedError(info);

        if (err || !user) {
          if (err) {
            console.warn(`OAuth callback error for ${provider}:`, err);
          }
          if (err && !unauthorized) {
            console.error(`OAuth callback for ${provider} failed:`, err);
          }

          if (unauthorized) {
            console.warn(`OAuth login denied for ${provider}: unauthorized user attempting to access ${redirectTarget}`);
            return res.redirect(buildUnauthorizedRedirectUrl(redirectTarget, 'unauthorized'));
          }

          return res.redirect(buildLoginRedirectUrl(redirectTarget, 'auth_failed'));
        }

        if (user.active === false) {
          console.warn(`OAuth login denied for ${provider}: inactive user ${user.email}`);
          return res.redirect(buildUnauthorizedRedirectUrl(redirectTarget, 'unauthorized'));
        }

        const token = generateToken(user.id);
        const refreshToken = generateRefreshToken(user.id);

        setAuthCookies(res, token, refreshToken);

        res.redirect(redirectTarget);
      } catch (callbackError) {
        console.error(`OAuth callback handler for ${provider} encountered an error:`, callbackError);
        next(callbackError);
      }
    })(req, res, next);
  };
}

function setAuthCookies(res, token, refreshToken) {
  res.cookie('token', token, {
    ...sharedCookieOptions,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  });

  res.cookie('refreshToken', refreshToken, {
    ...sharedCookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
}

function sanitizeRedirect(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return null;
    }
    return url.toString();
  } catch (error) {
    return null;
  }
}

function rememberRedirect(res, target) {
  if (!target) {
    res.clearCookie(OAUTH_REDIRECT_COOKIE, sharedCookieOptions);
    return;
  }

  res.cookie(OAUTH_REDIRECT_COOKIE, target, {
    ...sharedCookieOptions,
    maxAge: 10 * 60 * 1000,
  });
}

function consumeRedirect(req, res) {
  const raw = req.cookies?.[OAUTH_REDIRECT_COOKIE];
  res.clearCookie(OAUTH_REDIRECT_COOKIE, sharedCookieOptions);
  return sanitizeRedirect(raw);
}

if (configuredProviders.google) {
  router.get('/google', initiateAuth('google', { scope: ['profile', 'email'] }));

  router.get('/google/callback', handleAuthCallback('google'));
} else {
  router.get('/google', (_req, res) => sendNotConfigured('Google', res));
  router.get('/google/callback', (_req, res) => sendNotConfigured('Google', res));
}

if (configuredProviders.github) {
  router.get('/github', initiateAuth('github', { scope: ['user:email'] }));

  router.get('/github/callback', handleAuthCallback('github'));
} else {
  router.get('/github', (_req, res) => sendNotConfigured('GitHub', res));
  router.get('/github/callback', (_req, res) => sendNotConfigured('GitHub', res));
}

if (configuredProviders.microsoft) {
  router.get('/microsoft', initiateAuth('microsoft', { scope: ['user.read'] }));

  router.get('/microsoft/callback', handleAuthCallback('microsoft'));
} else {
  router.get('/microsoft', (_req, res) => sendNotConfigured('Microsoft', res));
  router.get('/microsoft/callback', (_req, res) => sendNotConfigured('Microsoft', res));
}

// Get current user info
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await db()('users')
      .select('id', 'email', 'name', 'avatar_url', 'role', 'provider')
      .where({ id: req.user.id })
      .first();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user information' });
  }
});

// Logout
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // Clear cache
    await cacheDel(`user:${req.user.id}`);
    
    // Clear cookies
    res.clearCookie('token', sharedCookieOptions);
    res.clearCookie('refreshToken', sharedCookieOptions);
    
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }

    jwt.verify(refreshToken, process.env.JWT_SECRET, async (err, decoded) => {
      if (err || decoded.type !== 'refresh') {
        return res.status(403).json({ error: 'Invalid refresh token' });
      }

      const user = await db()('users')
        .where({ id: decoded.userId, active: true })
        .first();

      if (!user) {
        return res.status(403).json({ error: 'User not found or inactive' });
      }

      const newToken = generateToken(user.id);
      const newRefreshToken = generateRefreshToken(user.id);

      res.cookie('token', newToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
      });
      
      res.cookie('refreshToken', newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      res.json({ message: 'Token refreshed successfully' });
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

module.exports = router;
