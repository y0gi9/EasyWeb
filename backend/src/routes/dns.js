const express = require('express');
const net = require('net');
const { body, validationResult } = require('express-validator');
const { db } = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
const { cacheGet, cacheSet, cacheDel } = require('../config/redis');

const router = express.Router();
const ALLOWED_RECORD_TYPES = ['A', 'AAAA', 'CNAME'];

async function bumpDnsConfigVersion({ bumpBlocklists = false } = {}) {
  const now = new Date();
  const version = String(now.getTime());

  await db()('settings')
    .where({ key: 'dns_config_version' })
    .update({ value: version, updated_at: now });

  if (bumpBlocklists) {
    await db()('settings')
      .where({ key: 'dns_blocklist_version' })
      .update({ value: version, updated_at: now });
  }
}

async function triggerDnsCacheFlush() {
  const now = new Date();
  await db()('settings')
    .where({ key: 'dns_cache_flush_token' })
    .update({ value: String(now.getTime()), updated_at: now });
}

const HOSTNAME_REGEX = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/;

function normalizeDomain(domain) {
  return (domain || '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '');
}

function isValidHostname(domain) {
  if (!domain) return false;
  if (domain === 'localhost') return true;
  return HOSTNAME_REGEX.test(domain);
}

function normalizeRecordValue(recordType, value) {
  if (recordType === 'CNAME') {
    return normalizeDomain(value);
  }
  return (value || '').trim();
}

function sanitizeTtl(ttl) {
  const parsed = parseInt(ttl, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 300;
  }
  return Math.min(86400, Math.max(30, parsed));
}

function toBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }
  }
  return Boolean(value);
}

// Get DNS statistics
router.get('/stats', async (req, res) => {
  try {
    const cacheKey = 'dns:stats';
    let stats = await cacheGet(cacheKey);
    
    if (!stats) {
      const [
        totalQueries,
        blockedQueries,
        allowedQueries,
        forwardedQueries,
        cachedQueries,
        localQueries
      ] = await Promise.all([
        db()('dns_queries').count('* as count').first(),
        db()('dns_queries').where('response', 'blocked').count('* as count').first(),
        db()('dns_queries').where('response', 'allowed').count('* as count').first(),
        db()('dns_queries').where('response', 'forwarded').count('* as count').first(),
        db()('dns_queries').where('response', 'cached').count('* as count').first(),
        db()('dns_queries').where('response', 'local').count('* as count').first()
      ]);

      const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [queries24h, blocked24h, local24h] = await Promise.all([
        db()('dns_queries').where('timestamp', '>=', last24Hours).count('* as count').first(),
        db()('dns_queries').where('timestamp', '>=', last24Hours).where('response', 'blocked').count('* as count').first(),
        db()('dns_queries').where('timestamp', '>=', last24Hours).where('response', 'local').count('* as count').first()
      ]);

      const totalCount = Number(totalQueries?.count || 0);
      const blockedCount = Number(blockedQueries?.count || 0);
      const allowedCount = Number(allowedQueries?.count || 0);
      const forwardedCount = Number(forwardedQueries?.count || 0);
      const cachedCount = Number(cachedQueries?.count || 0);
      const localCount = Number(localQueries?.count || 0);
      const queries24hCount = Number(queries24h?.count || 0);
      const blocked24hCount = Number(blocked24h?.count || 0);
      const local24hCount = Number(local24h?.count || 0);

      const totalAllowed = allowedCount + forwardedCount + cachedCount + localCount;

      stats = {
        total_queries: totalCount,
        blocked_queries: blockedCount,
        allowed_queries: totalAllowed,
        forwarded_queries: forwardedCount,
        cached_queries: cachedCount,
        local_queries: localCount,
        queries_24h: queries24hCount,
        blocked_24h: blocked24hCount,
        local_24h: local24hCount,
        block_percentage: totalCount > 0 ? ((blockedCount / totalCount) * 100).toFixed(2) : '0'
      };

      await cacheSet(cacheKey, stats, 300); // Cache for 5 minutes
    }

    res.json(stats);
  } catch (error) {
    console.error('Error fetching DNS stats:', error);
    res.status(500).json({ error: 'Failed to fetch DNS statistics' });
  }
});

// Get recent DNS queries
router.get('/queries', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const filter = req.query.filter; // legacy support
    const status = req.query.status || filter; // blocked, allowed, forwarded, cached, error
    const search = req.query.search;
    const clientIp = req.query.client || req.query.client_ip;
    const cacheFilter = req.query.cache; // hit, miss, any
    const from = req.query.from || req.query.start;
    const to = req.query.to || req.query.end;

    let query = db()('dns_queries')
      .select('*')
      .orderBy('timestamp', 'desc');

    if (status) {
      query = query.where('response', status);
    }

    if (search) {
      query = query.where('domain', 'like', `%${search}%`);
    }

    if (clientIp) {
      query = query.where('client_ip', clientIp);
    }

    if (cacheFilter === 'hit') {
      query = query.where('cache_hit', 1);
    } else if (cacheFilter === 'miss') {
      query = query.where('cache_hit', 0);
    }

    if (from) {
      const fromDate = new Date(from);
      if (!Number.isNaN(fromDate.getTime())) {
        query = query.where('timestamp', '>=', fromDate);
      }
    }

    if (to) {
      const toDate = new Date(to);
      if (!Number.isNaN(toDate.getTime())) {
        query = query.where('timestamp', '<=', toDate);
      }
    }

    const total = await query.clone().count('* as count').first();
    const queries = await query
      .limit(limit)
      .offset((page - 1) * limit);

    res.json({
      queries: queries.map((row) => ({
        ...row,
        cache_hit: Boolean(row.cache_hit),
      })),
      pagination: {
        page,
        limit,
        total: Number(total.count || 0),
        pages: Math.ceil((Number(total.count || 0)) / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching DNS queries:', error);
    res.status(500).json({ error: 'Failed to fetch DNS queries' });
  }
});

// Get top blocked domains
router.get('/top-blocked', async (req, res) => {
  try {
    const cacheKey = 'dns:top-blocked';
    let topBlocked = await cacheGet(cacheKey);

    if (!topBlocked) {
      topBlocked = await db()('dns_queries')
        .select('domain')
        .count('* as count')
        .where('response', 'blocked')
        .groupBy('domain')
        .orderBy('count', 'desc')
        .limit(20);

      await cacheSet(cacheKey, topBlocked, 3600); // Cache for 1 hour
    }

    res.json(topBlocked);
  } catch (error) {
    console.error('Error fetching top blocked domains:', error);
    res.status(500).json({ error: 'Failed to fetch top blocked domains' });
  }
});

// Get DNS query trends (hourly for last 24h)
router.get('/trends', async (req, res) => {
  try {
    const cacheKey = 'dns:trends';
    let trends = await cacheGet(cacheKey);

    if (!trends) {
      const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const queries = await db()('dns_queries')
        .select(
          db().raw("strftime('%Y-%m-%d %H:00:00', timestamp) as hour"),
          db().raw("COUNT(*) as total"),
          db().raw("SUM(CASE WHEN response = 'blocked' THEN 1 ELSE 0 END) as blocked")
        )
        .where('timestamp', '>=', last24Hours)
        .groupByRaw("strftime('%Y-%m-%d %H:00:00', timestamp)")
        .orderBy('hour');

      trends = queries.map(q => ({
        hour: q.hour,
        total: parseInt(q.total),
        blocked: parseInt(q.blocked),
        allowed: parseInt(q.total) - parseInt(q.blocked)
      }));

      await cacheSet(cacheKey, trends, 900); // Cache for 15 minutes
    }

    res.json(trends);
  } catch (error) {
    console.error('Error fetching DNS trends:', error);
    res.status(500).json({ error: 'Failed to fetch DNS trends' });
  }
});

// Get blocklists (admin only)
router.get('/blocklists', requireAdmin, async (req, res) => {
  try {
    const blocklists = await db()('dns_blocklists')
      .select('*')
      .orderBy('name');

    res.json(blocklists);
  } catch (error) {
    console.error('Error fetching blocklists:', error);
    res.status(500).json({ error: 'Failed to fetch blocklists' });
  }
});

// Add blocklist (admin only)
router.post('/blocklists', 
  requireAdmin,
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('url').isURL().withMessage('Valid URL is required'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation failed', details: errors.array() });
      }

      const { name, url, enabled = true } = req.body;

      // Check if blocklist already exists
      const existing = await db()('dns_blocklists')
        .where({ name })
        .orWhere({ url })
        .first();

      if (existing) {
        return res.status(400).json({ error: 'Blocklist with this name or URL already exists' });
      }

      const [id] = await db()('dns_blocklists').insert({
        name,
        url,
        enabled,
        created_at: new Date(),
        updated_at: new Date()
      });

      const blocklist = await db()('dns_blocklists').where({ id }).first();
      
      // Clear cache
      await cacheDel('dns:stats');
      
      await bumpDnsConfigVersion({ bumpBlocklists: true });

      res.status(201).json(blocklist);
    } catch (error) {
      console.error('Error adding blocklist:', error);
      res.status(500).json({ error: 'Failed to add blocklist' });
    }
  }
);

// Update blocklist (admin only)
router.put('/blocklists/:id',
  requireAdmin,
  [
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('url').optional().isURL().withMessage('Valid URL is required'),
    body('enabled').optional().isBoolean().withMessage('Enabled must be boolean')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation failed', details: errors.array() });
      }

      const { id } = req.params;
      const updates = { ...req.body, updated_at: new Date() };

      const updated = await db()('dns_blocklists')
        .where({ id })
        .update(updates);

      if (!updated) {
        return res.status(404).json({ error: 'Blocklist not found' });
      }

      const blocklist = await db()('dns_blocklists').where({ id }).first();

      // Clear cache
      await cacheDel('dns:stats');

      await bumpDnsConfigVersion({ bumpBlocklists: true });

      res.json(blocklist);
    } catch (error) {
      console.error('Error updating blocklist:', error);
      res.status(500).json({ error: 'Failed to update blocklist' });
    }
  }
);

// Delete blocklist (admin only)
router.delete('/blocklists/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await db()('dns_blocklists')
      .where({ id })
      .del();

    if (!deleted) {
      return res.status(404).json({ error: 'Blocklist not found' });
    }

    // Clear cache
    await cacheDel('dns:stats');
    
    await bumpDnsConfigVersion({ bumpBlocklists: true });

    res.json({ message: 'Blocklist deleted successfully' });
  } catch (error) {
    console.error('Error deleting blocklist:', error);
    res.status(500).json({ error: 'Failed to delete blocklist' });
  }
});

// Update blocklist entries (admin only)
router.post('/blocklists/:id/update', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const blocklist = await db()('dns_blocklists').where({ id }).first();
    if (!blocklist) {
      return res.status(404).json({ error: 'Blocklist not found' });
    }

    // This would trigger the DNS service to update the blocklist
    // For now, we'll just update the last_updated timestamp
    await db()('dns_blocklists')
      .where({ id })
      .update({ last_updated: new Date() });

    // Clear cache
    await cacheDel('dns:stats');
    await bumpDnsConfigVersion({ bumpBlocklists: true });
    
    res.json({ message: 'Blocklist update triggered' });
  } catch (error) {
    console.error('Error updating blocklist entries:', error);
    res.status(500).json({ error: 'Failed to update blocklist entries' });
  }
});

// Get DNS settings (admin only)
router.get('/settings', requireAdmin, async (req, res) => {
  try {
    const settings = await db()('settings')
      .whereIn('key', [
        'dns_upstream_servers',
        'dns_port',
        'blocklist_update_interval',
        'log_retention_days'
      ]);

    const settingsObj = {};
    settings.forEach(setting => {
      settingsObj[setting.key] = setting.value;
    });

    res.json(settingsObj);
  } catch (error) {
    console.error('Error fetching DNS settings:', error);
    res.status(500).json({ error: 'Failed to fetch DNS settings' });
  }
});

// Update DNS settings (admin only)
router.put('/settings', requireAdmin, async (req, res) => {
  try {
    const allowedSettings = [
      'dns_upstream_servers',
      'dns_port',
      'blocklist_update_interval',
      'log_retention_days',
      'dns_filter_enabled',
      'dns_filter_disabled_until',
      'dns_block_response',
      'dns_cache_enabled',
      'dns_cache_max_ttl',
      'dns_cache_min_ttl',
      'dns_cache_max_items',
      'dns_resolver_timeout_ms',
      'dns_logging_enabled'
    ];

    for (const [key, value] of Object.entries(req.body)) {
      if (allowedSettings.includes(key)) {
        await db()('settings')
          .where({ key })
          .update({ value: String(value), updated_at: new Date() });
      }
    }

    await bumpDnsConfigVersion();

    res.json({ message: 'DNS settings updated successfully' });
  } catch (error) {
    console.error('Error updating DNS settings:', error);
    res.status(500).json({ error: 'Failed to update DNS settings' });
  }
});

// DNS overview (authenticated)
router.get('/overview', async (req, res) => {
  try {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [totalQueries, blockedQueries, cacheHits, localQueryCount] = await Promise.all([
      db()('dns_queries').count('* as count').first(),
      db()('dns_queries').where('response', 'blocked').count('* as count').first(),
      db()('dns_queries').where('cache_hit', 1).count('* as count').first(),
      db()('dns_queries').where('response', 'local').count('* as count').first()
    ]);

    const [queries24h, blocked24h, local24h] = await Promise.all([
      db()('dns_queries').where('timestamp', '>=', last24Hours).count('* as count').first(),
      db()('dns_queries').where('timestamp', '>=', last24Hours).where('response', 'blocked').count('* as count').first(),
      db()('dns_queries').where('timestamp', '>=', last24Hours).where('response', 'local').count('* as count').first()
    ]);

    const topClients = await db()('dns_queries')
      .select(
        'client_ip',
        db().raw('COUNT(*) as count'),
        db().raw("SUM(CASE WHEN response = 'blocked' THEN 1 ELSE 0 END) as blocked")
      )
      .where('timestamp', '>=', last24Hours)
      .groupBy('client_ip')
      .orderBy('count', 'desc')
      .limit(6);

    const topBlockedDomains = await db()('dns_queries')
      .select('domain')
      .count('* as count')
      .where('response', 'blocked')
      .groupBy('domain')
      .orderBy('count', 'desc')
      .limit(10);

    const topAllowedDomains = await db()('dns_queries')
      .select('domain')
      .count('* as count')
      .whereIn('response', ['forwarded', 'cached', 'allowed', 'local'])
      .groupBy('domain')
      .orderBy('count', 'desc')
      .limit(10);

    const blocklistCounts = await Promise.all([
      db()('dns_blocklists').count('* as count').first(),
      db()('dns_blocklists').where('enabled', true).count('* as count').first()
    ]);

    const localRecordCounts = await Promise.all([
      db()('dns_local_records').count('* as count').first(),
      db()('dns_local_records').where('enabled', true).count('* as count').first()
    ]);

    const overrideCounts = await db()('dns_domain_overrides')
      .select('mode')
      .count('* as count')
      .where('enabled', true)
      .groupBy('mode');

    const settingsRows = await db()('settings')
      .whereIn('key', [
        'dns_filter_enabled',
        'dns_filter_disabled_until',
        'dns_cache_enabled',
        'dns_upstream_servers'
      ]);

    const settingsMap = settingsRows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});

    const filterEnabled = settingsMap.dns_filter_enabled !== 'false';
    const disabledUntil = settingsMap.dns_filter_disabled_until
      ? new Date(settingsMap.dns_filter_disabled_until)
      : null;
    const effectiveDisabledUntil = disabledUntil && !Number.isNaN(disabledUntil.getTime()) ? disabledUntil : null;
    const cacheEnabled = settingsMap.dns_cache_enabled !== 'false';
    const upstreams = (settingsMap.dns_upstream_servers || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const total = Number(totalQueries.count || 0);
    const blocked = Number(blockedQueries.count || 0);
    const local = Number(localQueryCount.count || 0);
    const allowed = total - blocked;
    const total24h = Number(queries24h.count || 0);
    const blockedCount24h = Number(blocked24h.count || 0);
    const localCount24h = Number(local24h.count || 0);
    const localRecordsTotal = Number(localRecordCounts[0].count || 0);
    const localRecordsEnabled = Number(localRecordCounts[1].count || 0);

    const overview = {
      totals: {
        total_queries: total,
        blocked_queries: blocked,
        allowed_queries: allowed,
        local_queries: local,
        blocked_percentage: total > 0 ? Number(((blocked / total) * 100).toFixed(2)) : 0,
        cache_hit_percentage: total > 0 ? Number((Number(cacheHits.count || 0) / total * 100).toFixed(2)) : 0
      },
      last24h: {
        total_queries: total24h,
        blocked_queries: blockedCount24h,
        allowed_queries: total24h - blockedCount24h,
        local_queries: localCount24h,
        blocked_percentage: total24h > 0 ? Number(((blockedCount24h / total24h) * 100).toFixed(2)) : 0
      },
      runtime: {
        filter_enabled: filterEnabled,
        disabled_until: effectiveDisabledUntil ? effectiveDisabledUntil.toISOString() : null,
        cache_enabled: cacheEnabled,
        upstream_servers: upstreams
      },
      blocklists: {
        total: Number(blocklistCounts[0].count || 0),
        enabled: Number(blocklistCounts[1].count || 0)
      },
      local_records: {
        total: localRecordsTotal,
        enabled: localRecordsEnabled
      },
      overrides: {
        allow: overrideCounts
          .filter(row => row.mode === 'allow')
          .reduce((acc, row) => acc + Number(row.count || 0), 0),
        block: overrideCounts
          .filter(row => row.mode === 'block')
          .reduce((acc, row) => acc + Number(row.count || 0), 0)
      },
      top_clients: topClients.map((row) => ({
        client_ip: row.client_ip,
        query_count: Number(row.count || 0),
        blocked_count: Number(row.blocked || 0)
      })),
      top_blocked_domains: topBlockedDomains.map((row) => ({
        domain: row.domain,
        count: Number(row.count || 0)
      })),
      top_allowed_domains: topAllowedDomains.map((row) => ({
        domain: row.domain,
        count: Number(row.count || 0)
      }))
    };

    res.json(overview);
  } catch (error) {
    console.error('Error fetching DNS overview:', error);
    res.status(500).json({ error: 'Failed to fetch DNS overview' });
  }
});

router.post('/control/toggle', requireAdmin, async (req, res) => {
  try {
    const { enabled, duration_minutes: durationMinutes } = req.body;
    const now = new Date();

    if (enabled === false) {
      if (durationMinutes && Number(durationMinutes) > 0) {
        const until = new Date(now.getTime() + Number(durationMinutes) * 60 * 1000);
        await db()('settings').where({ key: 'dns_filter_enabled' }).update({ value: 'true', updated_at: now });
        await db()('settings').where({ key: 'dns_filter_disabled_until' }).update({ value: until.toISOString(), updated_at: now });
        await bumpDnsConfigVersion();
        return res.json({ enabled: true, disabled_until: until.toISOString() });
      }

      await db()('settings').where({ key: 'dns_filter_enabled' }).update({ value: 'false', updated_at: now });
      await db()('settings').where({ key: 'dns_filter_disabled_until' }).update({ value: '', updated_at: now });
      await bumpDnsConfigVersion();
      return res.json({ enabled: false, disabled_until: null });
    }

    await db()('settings').where({ key: 'dns_filter_enabled' }).update({ value: 'true', updated_at: now });
    await db()('settings').where({ key: 'dns_filter_disabled_until' }).update({ value: '', updated_at: now });

    await bumpDnsConfigVersion();

    res.json({ enabled: true, disabled_until: null });
  } catch (error) {
    console.error('Error toggling DNS filter:', error);
    res.status(500).json({ error: 'Failed to toggle DNS filter' });
  }
});

router.post('/control/cache/flush', requireAdmin, async (_req, res) => {
  try {
    await triggerDnsCacheFlush();
    res.json({ message: 'DNS cache flush triggered' });
  } catch (error) {
    console.error('Error triggering DNS cache flush:', error);
    res.status(500).json({ error: 'Failed to trigger DNS cache flush' });
  }
});

router.post('/control/blocklists/reload', requireAdmin, async (_req, res) => {
  try {
    await bumpDnsConfigVersion({ bumpBlocklists: true });
    res.json({ message: 'DNS blocklist reload requested' });
  } catch (error) {
    console.error('Error requesting blocklist reload:', error);
    res.status(500).json({ error: 'Failed to request blocklist reload' });
  }
});

router.get('/overrides', requireAdmin, async (req, res) => {
  try {
    const includeDisabled = req.query.include_disabled === 'true';
    let query = db()('dns_domain_overrides').select('*').orderBy('created_at', 'desc');
    if (!includeDisabled) {
      query = query.where('enabled', true);
    }
    const overrides = await query;
    res.json(overrides);
  } catch (error) {
    console.error('Error fetching DNS overrides:', error);
    res.status(500).json({ error: 'Failed to fetch DNS overrides' });
  }
});

router.post('/overrides',
  requireAdmin,
  [
    body('domain').trim().notEmpty().withMessage('Domain is required'),
    body('mode').isIn(['allow', 'block']).withMessage('Mode must be allow or block'),
    body('match_type').optional().isIn(['exact', 'wildcard']).withMessage('Match type must be exact or wildcard'),
    body('enabled').optional().isBoolean().withMessage('Enabled must be boolean')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation failed', details: errors.array() });
      }

      const { domain, mode, match_type: matchType = 'exact', enabled = true, comment } = req.body;

      const [id] = await db()('dns_domain_overrides').insert({
        domain: domain.toLowerCase(),
        mode,
        match_type: matchType,
        enabled,
        comment,
        created_at: new Date(),
        updated_at: new Date()
      });

      await bumpDnsConfigVersion({ bumpBlocklists: true });

      const override = await db()('dns_domain_overrides').where({ id }).first();
      res.status(201).json(override);
    } catch (error) {
      console.error('Error creating DNS override:', error);
      res.status(500).json({ error: 'Failed to create DNS override' });
    }
  }
);

router.put('/overrides/:id',
  requireAdmin,
  [
    body('domain').optional().trim().notEmpty().withMessage('Domain cannot be empty'),
    body('mode').optional().isIn(['allow', 'block']).withMessage('Mode must be allow or block'),
    body('match_type').optional().isIn(['exact', 'wildcard']).withMessage('Match type must be exact or wildcard'),
    body('enabled').optional().isBoolean().withMessage('Enabled must be boolean')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation failed', details: errors.array() });
      }

      const { id } = req.params;
      const updates = {
        ...req.body,
        ...(req.body.domain ? { domain: req.body.domain.toLowerCase() } : {}),
        updated_at: new Date()
      };

      const updated = await db()('dns_domain_overrides')
        .where({ id })
        .update(updates);

      if (!updated) {
        return res.status(404).json({ error: 'Override not found' });
      }

      await bumpDnsConfigVersion({ bumpBlocklists: true });

      const override = await db()('dns_domain_overrides').where({ id }).first();
      res.json(override);
    } catch (error) {
      console.error('Error updating DNS override:', error);
      res.status(500).json({ error: 'Failed to update DNS override' });
    }
  }
);

router.delete('/overrides/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await db()('dns_domain_overrides').where({ id }).del();

    if (!deleted) {
      return res.status(404).json({ error: 'Override not found' });
    }

    await bumpDnsConfigVersion({ bumpBlocklists: true });

    res.json({ message: 'Override removed' });
  } catch (error) {
    console.error('Error deleting DNS override:', error);
    res.status(500).json({ error: 'Failed to delete DNS override' });
  }
});

router.get('/local-records', requireAdmin, async (req, res) => {
  try {
    const records = await db()('dns_local_records')
      .select('*')
      .orderBy('domain')
      .orderBy('record_type');

    res.json(records.map((record) => ({
      ...record,
      ttl: Number(record.ttl || 0)
    })));
  } catch (error) {
    console.error('Error fetching local DNS records:', error);
    res.status(500).json({ error: 'Failed to fetch local DNS records' });
  }
});

const localRecordCreateValidators = [
  body('domain')
    .trim()
    .notEmpty()
    .withMessage('Domain is required')
    .bail()
    .custom((value) => {
      const normalized = normalizeDomain(value);
      if (!isValidHostname(normalized)) {
        throw new Error('Domain must be a valid hostname');
      }
      return true;
    }),
  body('record_type')
    .trim()
    .notEmpty()
    .withMessage('Record type is required')
    .bail()
    .custom((value) => {
      const upper = (value || '').toUpperCase();
      if (!ALLOWED_RECORD_TYPES.includes(upper)) {
        throw new Error(`Record type must be one of: ${ALLOWED_RECORD_TYPES.join(', ')}`);
      }
      return true;
    }),
  body('value')
    .trim()
    .notEmpty()
    .withMessage('Record value is required')
    .bail()
    .custom((value, { req }) => {
      const type = (req.body.record_type || '').toUpperCase();
      if (!ALLOWED_RECORD_TYPES.includes(type)) {
        return true;
      }

      if (type === 'A' && net.isIP(value) !== 4) {
        throw new Error('Value must be a valid IPv4 address');
      }
      if (type === 'AAAA' && net.isIP(value) !== 6) {
        throw new Error('Value must be a valid IPv6 address');
      }
      if (type === 'CNAME') {
        const normalizedTarget = normalizeDomain(value);
        if (!isValidHostname(normalizedTarget)) {
          throw new Error('CNAME value must be a valid hostname');
        }
      }
      return true;
    }),
  body('ttl')
    .optional()
    .isInt({ min: 30, max: 86400 })
    .withMessage('TTL must be between 30 and 86400 seconds'),
  body('enabled')
    .optional()
    .isBoolean()
    .withMessage('Enabled must be a boolean'),
  body('comment')
    .optional()
    .isLength({ max: 255 })
    .withMessage('Comments must be 255 characters or less')
];

const localRecordUpdateValidators = [
  body('domain')
    .optional()
    .trim()
    .custom((value) => {
      if (value === undefined) return true;
      const normalized = normalizeDomain(value);
      if (!isValidHostname(normalized)) {
        throw new Error('Domain must be a valid hostname');
      }
      return true;
    }),
  body('record_type')
    .optional()
    .trim()
    .custom((value) => {
      if (value === undefined) return true;
      const upper = (value || '').toUpperCase();
      if (!ALLOWED_RECORD_TYPES.includes(upper)) {
        throw new Error(`Record type must be one of: ${ALLOWED_RECORD_TYPES.join(', ')}`);
      }
      return true;
    }),
  body('value').optional().trim(),
  body('ttl')
    .optional()
    .isInt({ min: 30, max: 86400 })
    .withMessage('TTL must be between 30 and 86400 seconds'),
  body('enabled')
    .optional()
    .isBoolean()
    .withMessage('Enabled must be a boolean'),
  body('comment')
    .optional()
    .isLength({ max: 255 })
    .withMessage('Comments must be 255 characters or less')
];

router.post('/local-records', requireAdmin, localRecordCreateValidators, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const recordType = (req.body.record_type || '').toUpperCase();
    const domain = normalizeDomain(req.body.domain);
    const value = normalizeRecordValue(recordType, req.body.value);
    const ttl = sanitizeTtl(req.body.ttl);
    const enabled = toBoolean(req.body.enabled, true);
    const comment = req.body.comment ? req.body.comment.trim() : null;

    const now = new Date();

    const [id] = await db()('dns_local_records').insert({
      domain,
      record_type: recordType,
      value,
      ttl,
      enabled,
      comment,
      created_at: now,
      updated_at: now
    });

    await bumpDnsConfigVersion();

    const record = await db()('dns_local_records').where({ id }).first();
    return res.status(201).json({
      ...record,
      ttl: Number(record.ttl || ttl)
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT') {
      return res.status(400).json({ error: 'A record with the same domain, type, and value already exists' });
    }
    console.error('Error creating local DNS record:', error);
    return res.status(500).json({ error: 'Failed to create local DNS record' });
  }
});

router.put('/local-records/:id', requireAdmin, localRecordUpdateValidators, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { id } = req.params;
    const record = await db()('dns_local_records').where({ id }).first();
    if (!record) {
      return res.status(404).json({ error: 'Local DNS record not found' });
    }

    const updates = {};

    if (req.body.domain !== undefined) {
      const domain = normalizeDomain(req.body.domain);
      if (!isValidHostname(domain)) {
        return res.status(400).json({ error: 'Domain must be a valid hostname' });
      }
      updates.domain = domain;
    }

    if (req.body.record_type !== undefined) {
      const recordType = (req.body.record_type || '').toUpperCase();
      if (!ALLOWED_RECORD_TYPES.includes(recordType)) {
        return res.status(400).json({ error: `Record type must be one of: ${ALLOWED_RECORD_TYPES.join(', ')}` });
      }
      updates.record_type = recordType;
    }

    if (req.body.value !== undefined) {
      const type = (updates.record_type || record.record_type || '').toUpperCase();
      const value = normalizeRecordValue(type, req.body.value);
      if (type === 'A' && net.isIP(value) !== 4) {
        return res.status(400).json({ error: 'Value must be a valid IPv4 address' });
      }
      if (type === 'AAAA' && net.isIP(value) !== 6) {
        return res.status(400).json({ error: 'Value must be a valid IPv6 address' });
      }
      if (type === 'CNAME' && !isValidHostname(value)) {
        return res.status(400).json({ error: 'CNAME value must be a valid hostname' });
      }
      updates.value = value;
    }

    if (req.body.ttl !== undefined) {
      updates.ttl = sanitizeTtl(req.body.ttl);
    }

    if (req.body.enabled !== undefined) {
      updates.enabled = toBoolean(req.body.enabled);
    }

    if (req.body.comment !== undefined) {
      const comment = req.body.comment ? req.body.comment.trim() : null;
      updates.comment = comment;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No changes provided' });
    }

    updates.updated_at = new Date();

    await db()('dns_local_records').where({ id }).update(updates);
    await bumpDnsConfigVersion();

    const updated = await db()('dns_local_records').where({ id }).first();
    return res.json({
      ...updated,
      ttl: Number(updated.ttl || updates.ttl)
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT') {
      return res.status(400).json({ error: 'A record with the same domain, type, and value already exists' });
    }
    console.error('Error updating local DNS record:', error);
    return res.status(500).json({ error: 'Failed to update local DNS record' });
  }
});

router.delete('/local-records/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await db()('dns_local_records').where({ id }).del();

    if (!deleted) {
      return res.status(404).json({ error: 'Local DNS record not found' });
    }

    await bumpDnsConfigVersion();

    res.json({ message: 'Local DNS record removed' });
  } catch (error) {
    console.error('Error deleting local DNS record:', error);
    res.status(500).json({ error: 'Failed to delete local DNS record' });
  }
});

router.get('/clients', requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const days = parseInt(req.query.days) || 1;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const clients = await db()('dns_queries')
      .select('client_ip')
      .count('* as total')
      .sum(db().raw("CASE WHEN response = 'blocked' THEN 1 ELSE 0 END as blocked"))
      .where('timestamp', '>=', since)
      .groupBy('client_ip')
      .orderBy('total', 'desc')
      .limit(limit);

    res.json(clients.map(row => ({
      client_ip: row.client_ip,
      total_queries: Number(row.total || 0),
      blocked_queries: Number(row.blocked || 0)
    })));
  } catch (error) {
    console.error('Error fetching DNS clients:', error);
    res.status(500).json({ error: 'Failed to fetch DNS clients' });
  }
});

// Delete DNS queries (admin only)
router.delete('/queries', requireAdmin, async (req, res) => {
  try {
    const { before, domain, client_ip, response } = req.query;

    let query = db()('dns_queries');

    // Apply filters if provided
    if (before) {
      const beforeDate = new Date(before);
      if (!isNaN(beforeDate.getTime())) {
        query = query.where('timestamp', '<', beforeDate);
      }
    }

    if (domain) {
      query = query.where('domain', 'like', `%${domain}%`);
    }

    if (client_ip) {
      query = query.where('client_ip', client_ip);
    }

    if (response && response !== 'all') {
      query = query.where('response', response);
    }

    // Count deleted records for response
    const result = await query.del();

    res.json({
      message: `Deleted ${result} DNS queries`,
      deleted_count: result
    });
  } catch (error) {
    console.error('Error deleting DNS queries:', error);
    res.status(500).json({ error: 'Failed to delete DNS queries' });
  }
});

module.exports = router;
