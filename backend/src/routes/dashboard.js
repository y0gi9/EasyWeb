const express = require('express');
const { db } = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
const { cacheGet, cacheSet, cacheDel, cacheFlush } = require('../config/redis');
const { syncNginxConfig } = require('../services/proxyConfig');

const router = express.Router();

// Get overall dashboard statistics
router.get('/stats', async (req, res) => {
  try {
    const cacheKey = 'dashboard:stats';
    let stats = await cacheGet(cacheKey);
    
    if (!stats) {
      const [
        totalUsers,
        activeUsers,
        totalQueries,
        blockedQueries,
        totalUpstreams,
        enabledUpstreams
      ] = await Promise.all([
        db()('users').count('* as count').first(),
        db()('users').where('active', true).count('* as count').first(),
        db()('dns_queries').count('* as count').first(),
        db()('dns_queries').where('response', 'blocked').count('* as count').first(),
        db()('proxy_upstreams').count('* as count').first(),
        db()('proxy_upstreams').where('enabled', true).count('* as count').first()
      ]);

      const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [queries24h, blocked24h] = await Promise.all([
        db()('dns_queries').where('timestamp', '>=', last24Hours).count('* as count').first(),
        db()('dns_queries').where('timestamp', '>=', last24Hours).where('response', 'blocked').count('* as count').first()
      ]);

      stats = {
        users: {
          total: totalUsers.count,
          active: activeUsers.count
        },
        dns: {
          total_queries: totalQueries.count,
          blocked_queries: blockedQueries.count,
          queries_24h: queries24h.count,
          blocked_24h: blocked24h.count,
          block_rate: totalQueries.count > 0 ? ((blockedQueries.count / totalQueries.count) * 100).toFixed(2) : 0
        },
        proxy: {
          total_upstreams: totalUpstreams.count,
          enabled_upstreams: enabledUpstreams.count
        },
        system: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          node_version: process.version
        }
      };

      await cacheSet(cacheKey, stats, 300); // Cache for 5 minutes
    }

    res.json(stats);
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
  }
});

// Get recent activity
router.get('/activity', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    
    // Get recent DNS queries
    const recentQueries = await db()('dns_queries')
      .select('domain', 'response', 'client_ip', 'timestamp')
      .orderBy('timestamp', 'desc')
      .limit(limit);

    // Get recent user logins (if we had a login log table)
    // For now, we'll use user creation/update times
    const recentUsers = await db()('users')
      .select('name', 'email', 'provider', 'updated_at as timestamp')
      .orderBy('updated_at', 'desc')
      .limit(5);

    const activity = {
      dns_queries: recentQueries.map(q => ({
        ...q,
        type: 'dns_query'
      })),
      user_activity: recentUsers.map(u => ({
        ...u,
        type: 'user_login'
      }))
    };

    res.json(activity);
  } catch (error) {
    console.error('Error fetching recent activity:', error);
    res.status(500).json({ error: 'Failed to fetch recent activity' });
  }
});

// Get system health
router.get('/health', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'unknown',
        redis: 'unknown',
        dns_service: 'unknown'
      }
    };

    // Test database connection
    try {
      await db().raw('SELECT 1');
      health.checks.database = 'healthy';
    } catch (error) {
      health.checks.database = 'unhealthy';
      health.status = 'degraded';
    }

    // Test Redis connection
    try {
      const redisClient = require('../config/redis').getRedisClient();
      if (redisClient) {
        await redisClient.ping();
        health.checks.redis = 'healthy';
      } else {
        health.checks.redis = 'unavailable';
      }
    } catch (error) {
      health.checks.redis = 'unhealthy';
      health.status = 'degraded';
    }

    // Test DNS service (simplified check)
    // In a real implementation, you'd ping the DNS service
    health.checks.dns_service = 'healthy';

    res.json(health);
  } catch (error) {
    console.error('Error checking system health:', error);
    res.status(500).json({ 
      status: 'unhealthy',
      error: 'Failed to check system health' 
    });
  }
});

// Get query trends (last 7 days)
router.get('/trends', async (req, res) => {
  try {
    const cacheKey = 'dashboard:trends';
    let trends = await cacheGet(cacheKey);

    if (!trends) {
      const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      const dailyStats = await db()('dns_queries')
        .select(
          db().raw("DATE(timestamp) as date"),
          db().raw("COUNT(*) as total"),
          db().raw("SUM(CASE WHEN response = 'blocked' THEN 1 ELSE 0 END) as blocked")
        )
        .where('timestamp', '>=', last7Days)
        .groupByRaw("DATE(timestamp)")
        .orderBy('date');

      trends = dailyStats.map(stat => ({
        date: stat.date,
        total: parseInt(stat.total),
        blocked: parseInt(stat.blocked),
        allowed: parseInt(stat.total) - parseInt(stat.blocked)
      }));

      await cacheSet(cacheKey, trends, 3600); // Cache for 1 hour
    }

    res.json(trends);
  } catch (error) {
    console.error('Error fetching trends:', error);
    res.status(500).json({ error: 'Failed to fetch trends' });
  }
});

// Get top clients by query count
router.get('/top-clients', async (req, res) => {
  try {
    const cacheKey = 'dashboard:top-clients';
    let topClients = await cacheGet(cacheKey);

    if (!topClients) {
      const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      topClients = await db()('dns_queries')
        .select('client_ip')
        .count('* as query_count')
        .sum(db().raw("CASE WHEN response = 'blocked' THEN 1 ELSE 0 END as blocked_count"))
        .where('timestamp', '>=', last24Hours)
        .groupBy('client_ip')
        .orderBy('query_count', 'desc')
        .limit(10);

      topClients = topClients.map(client => ({
        ...client,
        query_count: parseInt(client.query_count),
        blocked_count: parseInt(client.blocked_count),
        allowed_count: parseInt(client.query_count) - parseInt(client.blocked_count)
      }));

      await cacheSet(cacheKey, topClients, 900); // Cache for 15 minutes
    }

    res.json(topClients);
  } catch (error) {
    console.error('Error fetching top clients:', error);
    res.status(500).json({ error: 'Failed to fetch top clients' });
  }
});

// Get users management data (admin only)
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const users = await db()('users')
      .select('id', 'email', 'name', 'provider', 'role', 'active', 'created_at', 'updated_at')
      .orderBy('created_at', 'desc');

    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.get('/settings/general', requireAdmin, async (_req, res) => {
  try {
    const keys = ['app_name', 'app_domain', 'admin_email', 'registration_enabled'];
    const settings = await db()('settings').whereIn('key', keys);

    const settingsMap = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});

    const response = {
      appName: settingsMap.app_name || 'EasyWeb',
      appDomain: settingsMap.app_domain || process.env.DOMAIN || '',
      adminEmail: settingsMap.admin_email || process.env.EMAIL || '',
      registrationEnabled: (settingsMap.registration_enabled || 'false') === 'true',
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching general settings:', error);
    res.status(500).json({ error: 'Failed to fetch general settings' });
  }
});

router.put('/settings/general', requireAdmin, async (req, res) => {
  try {
    const {
      appName,
      appDomain,
      adminEmail,
      registrationEnabled,
    } = req.body || {};

    if (!appName || typeof appName !== 'string') {
      return res.status(400).json({ error: 'Application name is required' });
    }

    if (appDomain && typeof appDomain !== 'string') {
      return res.status(400).json({ error: 'Domain must be a string' });
    }

    if (adminEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (typeof adminEmail !== 'string' || !emailRegex.test(adminEmail)) {
        return res.status(400).json({ error: 'Administrator email must be a valid email address' });
      }
    }

    if (registrationEnabled !== undefined && typeof registrationEnabled !== 'boolean') {
      return res.status(400).json({ error: 'Registration enabled flag must be boolean' });
    }

    const now = new Date();
    const updates = [
      { key: 'app_name', value: appName.trim() },
      { key: 'app_domain', value: (appDomain || '').trim() },
      { key: 'admin_email', value: (adminEmail || '').trim() },
      { key: 'registration_enabled', value: registrationEnabled ? 'true' : 'false' },
    ];

    for (const entry of updates) {
      const existing = await db()('settings').where({ key: entry.key }).first();
      if (existing) {
        await db()('settings')
          .where({ key: entry.key })
          .update({ value: entry.value, updated_at: now });
      } else {
        await db()('settings').insert({
          key: entry.key,
          value: entry.value,
          description: null,
          created_at: now,
          updated_at: now,
        });
      }
    }

    process.env.APP_NAME = appName.trim();
    process.env.DOMAIN = (appDomain || '').trim() || process.env.DOMAIN || '';
    process.env.EMAIL = (adminEmail || '').trim() || process.env.EMAIL || '';
    process.env.REGISTRATION_ENABLED = registrationEnabled ? 'true' : 'false';

    res.json({
      appName: appName.trim(),
      appDomain: (appDomain || '').trim(),
      adminEmail: (adminEmail || '').trim(),
      registrationEnabled: Boolean(registrationEnabled),
    });
  } catch (error) {
    console.error('Error updating general settings:', error);
    res.status(500).json({ error: 'Failed to update general settings' });
  }
});

router.get('/settings/security', requireAdmin, async (_req, res) => {
  try {
    const keys = ['session_timeout_minutes', 'require_auth_for_all', 'require_admin_mfa'];
    const settings = await db()('settings').whereIn('key', keys);

    const settingsMap = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});

    const response = {
      sessionTimeoutMinutes: parseInt(settingsMap.session_timeout_minutes, 10) || 1440,
      requireAuthForAll: (settingsMap.require_auth_for_all || 'true') === 'true',
      requireAdminMfa: (settingsMap.require_admin_mfa || 'false') === 'true',
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching security settings:', error);
    res.status(500).json({ error: 'Failed to fetch security settings' });
  }
});

router.put('/settings/security', requireAdmin, async (req, res) => {
  try {
    const {
      sessionTimeoutMinutes,
      requireAuthForAll,
      requireAdminMfa,
    } = req.body || {};

    let timeoutMinutes = parseInt(sessionTimeoutMinutes, 10);
    if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
      timeoutMinutes = 1440;
    }

    const existingSettings = await db()('settings').whereIn('key', [
      'session_timeout_minutes',
      'require_auth_for_all',
      'require_admin_mfa',
    ]);

    const previousRequireAuth = existingSettings.find((setting) => setting.key === 'require_auth_for_all');
    const previousRequireAuthValue = previousRequireAuth ? previousRequireAuth.value === 'true' : false;
    const previousRequireMfa = existingSettings.find((setting) => setting.key === 'require_admin_mfa');
    const previousRequireMfaValue = previousRequireMfa ? previousRequireMfa.value === 'true' : false;

    const requireAuthFlag = typeof requireAuthForAll === 'boolean'
      ? requireAuthForAll
      : previousRequireAuthValue;

    const requireMfaFlag = typeof requireAdminMfa === 'boolean'
      ? requireAdminMfa
      : previousRequireMfaValue;

    const now = new Date();
    const updates = [
      { key: 'session_timeout_minutes', value: String(timeoutMinutes) },
      { key: 'require_auth_for_all', value: requireAuthFlag ? 'true' : 'false' },
      { key: 'require_admin_mfa', value: requireMfaFlag ? 'true' : 'false' },
    ];

    for (const entry of updates) {
      const existing = existingSettings.find((setting) => setting.key === entry.key);
      if (existing) {
        await db()('settings')
          .where({ key: entry.key })
          .update({ value: entry.value, updated_at: now });
      } else {
        await db()('settings').insert({
          key: entry.key,
          value: entry.value,
          description: null,
          created_at: now,
          updated_at: now,
        });
      }
    }

    process.env.SESSION_TIMEOUT_MINUTES = String(timeoutMinutes);
    process.env.REQUIRE_AUTH_FOR_ALL = requireAuthFlag ? 'true' : 'false';
    process.env.REQUIRE_ADMIN_MFA = requireMfaFlag ? 'true' : 'false';

    if (requireAuthFlag !== previousRequireAuthValue) {
      await db()('proxy_upstreams').update({ auth_required: requireAuthFlag ? 1 : 0 });
      try {
        await syncNginxConfig();
      } catch (syncError) {
        console.error('Failed to sync nginx config after security update:', syncError);
      }
    }

    res.json({
      sessionTimeoutMinutes: timeoutMinutes,
      requireAuthForAll: requireAuthFlag,
      requireAdminMfa: requireMfaFlag,
    });
  } catch (error) {
    console.error('Error updating security settings:', error);
    res.status(500).json({ error: 'Failed to update security settings' });
  }
});

// Create user (admin only)
router.post('/users', requireAdmin, async (req, res) => {
  try {
    const { email, name, role } = req.body || {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }

    const displayName = typeof name === 'string' && name.trim().length > 0 ? name.trim() : normalizedEmail;
    const normalizedRole = role === 'admin' ? 'admin' : 'user';

    const existing = await db()('users').where({ email: normalizedEmail }).first();
    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    const now = new Date();

    const [userId] = await db()('users').insert({
      email: normalizedEmail,
      name: displayName,
      provider: 'manual',
      provider_id: `manual:${normalizedEmail}`,
      role: normalizedRole,
      active: true,
      created_at: now,
      updated_at: now,
    });

    const user = await db()('users')
      .select('id', 'email', 'name', 'provider', 'role', 'active', 'created_at', 'updated_at')
      .where({ id: userId })
      .first();

    res.status(201).json(user);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user (admin only)
router.put('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { role, active } = req.body;

    // Validate input
    if (role && !['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be admin or user.' });
    }

    if (active !== undefined && typeof active !== 'boolean') {
      return res.status(400).json({ error: 'Active field must be boolean' });
    }

    const updates = {};
    if (role !== undefined) updates.role = role;
    if (active !== undefined) updates.active = active;
    updates.updated_at = new Date();

    const updated = await db()('users')
      .where({ id })
      .update(updates);

    if (!updated) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = await db()('users')
      .select('id', 'email', 'name', 'provider', 'role', 'active', 'created_at', 'updated_at')
      .where({ id })
      .first();

    res.json(user);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete user (admin only)
router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent self-deletion
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const deleted = await db()('users')
      .where({ id })
      .del();

    if (!deleted) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Get system logs (admin only)
router.get('/logs', requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const level = req.query.level; // error, warn, info
    
    // This is a simplified log endpoint
    // In a real implementation, you might read from log files or a logging service
    const logs = [
      {
        timestamp: new Date(),
        level: 'info',
        message: 'DNS service started',
        component: 'dns'
      },
      {
        timestamp: new Date(Date.now() - 60000),
        level: 'info', 
        message: 'User authentication successful',
        component: 'auth'
      },
      {
        timestamp: new Date(Date.now() - 120000),
        level: 'warn',
        message: 'High DNS query rate detected',
        component: 'dns'
      }
    ];

    const filteredLogs = level ? logs.filter(log => log.level === level) : logs;
    const paginatedLogs = filteredLogs.slice((page - 1) * limit, page * limit);

    res.json({
      logs: paginatedLogs,
      pagination: {
        page,
        limit,
        total: filteredLogs.length,
        pages: Math.ceil(filteredLogs.length / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// Get configuration summary
router.get('/config', async (req, res) => {
  try {
    const [dnsSettings, blocklists, upstreams] = await Promise.all([
      db()('settings').whereIn('key', ['dns_upstream_servers', 'dns_port']),
      db()('dns_blocklists').where('enabled', true).count('* as count').first(),
      db()('proxy_upstreams').where('enabled', true).count('* as count').first()
    ]);

    const config = {
      dns: {
        upstream_servers: dnsSettings.find(s => s.key === 'dns_upstream_servers')?.value || 'Not configured',
        port: dnsSettings.find(s => s.key === 'dns_port')?.value || '53',
        blocklists_count: blocklists.count
      },
      proxy: {
        upstreams_count: upstreams.count
      }
    };

    res.json(config);
  } catch (error) {
    console.error('Error fetching configuration summary:', error);
    res.status(500).json({ error: 'Failed to fetch configuration summary' });
  }
});

// Quick actions
router.post('/actions/blocklists/update', requireAdmin, async (_req, res) => {
  try {
    const blocklists = await db()('dns_blocklists').select('id');

    if (!blocklists.length) {
      return res.status(404).json({ error: 'No blocklists configured' });
    }

    const now = new Date();
    await db()('dns_blocklists').update({ last_updated: now, updated_at: now });

    // Clear cached dashboard data so fresh stats are retrieved
    await Promise.all([
      cacheDel('dashboard:stats'),
      cacheDel('dashboard:trends'),
      cacheDel('dashboard:top-clients'),
      cacheDel('dns:stats')
    ]);

    res.json({
      message: 'Blocklist refresh triggered',
      updated: blocklists.length,
      timestamp: now.toISOString()
    });
  } catch (error) {
    console.error('Error triggering blocklist refresh:', error);
    res.status(500).json({ error: 'Failed to trigger blocklist refresh' });
  }
});

router.post('/actions/cache/clear', requireAdmin, async (_req, res) => {
  try {
    const success = await cacheFlush();

    if (!success) {
      return res.status(503).json({ error: 'Cache service is unavailable' });
    }

    res.json({ message: 'Cache cleared successfully' });
  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

module.exports = router;
