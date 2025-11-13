const express = require('express');
const { body, validationResult } = require('express-validator');
const { db } = require('../config/database');
const { requireAdmin, authenticateToken } = require('../middleware/auth');
const {
  DEFAULT_PATH_CONFIG_PATH,
  DEFAULT_SERVER_CONFIG_PATH,
  DEFAULT_ROOT_CONFIG_PATH,
  generateNginxConfig,
  syncNginxConfig,
  reloadNginx,
  readStoredConfig,
} = require('../services/proxyConfig');

const urlValidationOptions = {
  require_valid_protocol: true,
  require_tld: false,
  allow_underscores: true,
  allow_trailing_dot: true,
  protocols: ['http', 'https']
};

const domainValidationRegex = /^(\*\.)?([a-z0-9]+(-[a-z0-9]+)*\.)*[a-z0-9-]+$/;

function normalizeDomains(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map(domain => String(domain).trim().toLowerCase())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/[,\s]+/)
      .map(domain => domain.trim().toLowerCase())
      .filter(Boolean);
  }

  return [];
}

function serializeHeaders(headers) {
  return headers ? JSON.stringify(headers) : null;
}

function serializeDomains(domains) {
  const normalised = normalizeDomains(domains);
  return normalised.length ? JSON.stringify(normalised) : null;
}

function normalizeEmails(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map(email => String(email).trim().toLowerCase())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/[,\s]+/)
      .map(email => email.trim().toLowerCase())
      .filter(Boolean);
  }

  return [];
}

function serializeEmails(emails) {
  const normalized = normalizeEmails(emails);
  return normalized.length ? JSON.stringify(normalized) : null;
}

function validateAuthCustomization(value) {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Auth customization must be an object');
  }

  const allowedKeys = new Set([
    'headerImageUrl',
    'logoUrl',
    'headline',
    'bodyText',
    'fontFamily'
  ]);

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unsupported auth customization field: ${key}`);
    }

    const fieldValue = value[key];
    if (fieldValue !== null && fieldValue !== undefined && typeof fieldValue !== 'string') {
      throw new Error(`Auth customization field ${key} must be a string`);
    }
  }

  return true;
}

function normalizeAuthCustomization(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const fields = [
    { key: 'headerImageUrl', maxLength: 2048 },
    { key: 'logoUrl', maxLength: 2048 },
    { key: 'headline', maxLength: 200 },
    { key: 'bodyText', maxLength: 1000 },
    { key: 'fontFamily', maxLength: 200 }
  ];

  const result = {};

  fields.forEach(({ key, maxLength }) => {
    const raw = value[key];
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed) {
        result[key] = trimmed.slice(0, maxLength);
      }
    }
  });

  return Object.keys(result).length > 0 ? result : null;
}

function serializeAuthCustomization(customization) {
  if (!customization) {
    return null;
  }
  const normalized = normalizeAuthCustomization(customization);
  return normalized ? JSON.stringify(normalized) : null;
}

function parseAuthCustomization(raw) {
  if (!raw) {
    return null;
  }

  try {
    const value = JSON.parse(raw);
    return normalizeAuthCustomization(value);
  } catch (error) {
    console.warn('Failed to parse auth customization payload:', error.message);
    return null;
  }
}

function hydrateUpstream(row) {
  return {
    ...row,
    headers: row.headers ? JSON.parse(row.headers) : null,
    domains: row.domains ? JSON.parse(row.domains) : [],
    allowed_emails: row.allowed_emails ? JSON.parse(row.allowed_emails) : [],
    preserve_host: Boolean(row.preserve_host),
    auth_customization: parseAuthCustomization(row.auth_customization)
  };
}

const router = express.Router();
const publicRouter = express.Router();

// Get all proxy upstreams
router.get('/upstreams', async (req, res) => {
  try {
    const upstreams = await db()('proxy_upstreams')
      .select('*')
      .orderBy('path');

    res.json(upstreams.map(hydrateUpstream));
  } catch (error) {
    console.error('Error fetching proxy upstreams:', error);
    res.status(500).json({ error: 'Failed to fetch proxy upstreams' });
  }
});

publicRouter.get('/upstreams/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const upstream = await db()('proxy_upstreams')
      .select('id', 'name', 'enabled', 'auth_required', 'auth_customization')
      .where({ id })
      .first();

    if (!upstream || !upstream.enabled) {
      return res.status(404).json({ error: 'Upstream not found' });
    }

    return res.json({
      id: upstream.id,
      name: upstream.name,
      enabled: Boolean(upstream.enabled),
      auth_required: Boolean(upstream.auth_required),
      auth_customization: parseAuthCustomization(upstream.auth_customization)
    });
  } catch (error) {
    console.error('Error fetching upstream customization:', error);
    res.status(500).json({ error: 'Failed to fetch upstream customization' });
  }
});

// Add new upstream (admin only)
router.post('/upstreams',
  requireAdmin,
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('path').custom((value, { req }) => {
      try {
        const domains = normalizeDomains(req.body.domains);
        const hasDomains = domains.length > 0;

        if (!hasDomains && (!value || !value.trim())) {
          throw new Error('Path is required when no domains are specified');
        }

        if (value && value.trim()) {
          const trimmed = value.trim();
          if (!trimmed.startsWith('/')) {
            throw new Error('Path must start with /');
          }
          if (!/^\/[a-zA-Z0-9\-_\/]*$/.test(trimmed)) {
            throw new Error('Path must contain only alphanumeric, dash, underscore, and slash characters');
          }
        }

        return true;
      } catch (error) {
        throw new Error(`Path validation error: ${error.message}`);
      }
    }),
    body('domains').custom((value, { req }) => {
      try {
        const domains = normalizeDomains(value);
        const hasPath = req.body.path && req.body.path.trim();

        if (!hasPath && domains.length === 0) {
          throw new Error('Either path or domains must be specified');
        }

        const isValid = domains.every(domain => domainValidationRegex.test(domain));
        if (!isValid) {
          throw new Error('Domains must be a comma or space separated list of hostnames');
        }
        return true;
      } catch (error) {
        throw new Error(`Domains validation error: ${error.message}`);
      }
    }),
    body('target_url').isURL(urlValidationOptions).withMessage('Valid target URL is required'),
    body('auth_required').optional().isBoolean().withMessage('Auth required must be boolean'),
    body('headers').optional().isObject().withMessage('Headers must be an object'),
    body('allowed_emails').optional().custom(value => {
      const emails = normalizeEmails(value);
      const isValid = emails.every(email => /^\S+@\S+\.\S+$/.test(email));
      if (!isValid) {
        throw new Error('Allowed emails must be comma or space separated email addresses');
      }
      return true;
    }),
    body('preserve_host').optional().isBoolean().withMessage('Preserve host must be boolean'),
    body('auth_customization').optional({ nullable: true }).custom(validateAuthCustomization)
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation failed', details: errors.array() });
      }

      const {
        name,
        path: rawPath,
        target_url,
        enabled = true,
        auth_required = true,
        headers,
        domains,
        allowed_emails,
        preserve_host = false,
        auth_customization
      } = req.body;
      const authCustomizationNormalized = normalizeAuthCustomization(auth_customization);

      // For domain-only proxies, use empty path
      const hasDomains = normalizeDomains(domains).length > 0;
      let normalizedPath;

      if (rawPath && rawPath.trim()) {
        normalizedPath = rawPath.endsWith('/') && rawPath !== '/' ? rawPath.slice(0, -1) : rawPath;
      } else if (hasDomains) {
        // For domain-only proxies, use empty path
        normalizedPath = '';
      } else {
        // For path-based proxies, default to root
        normalizedPath = '/';
      }

      let createdUpstream;

      await db().transaction(async (trx) => {
        // For domain-only proxies, check conflicts differently
        const hasDomains = normalizeDomains(domains).length > 0;
        let existing;

        if (hasDomains) {
          // For domain-based proxies, check if any of the domains conflict
          const conflictingUpstreams = await trx('proxy_upstreams')
            .whereNotNull('domains')
            .andWhereRaw("json_extract(domains, '$[0]') IS NOT NULL");

          existing = conflictingUpstreams.find(upstream => {
            if (!upstream.domains) return false;
            try {
              const existingDomains = JSON.parse(upstream.domains);
              const newDomains = normalizeDomains(domains);
              return existingDomains.some(domain => newDomains.includes(domain));
            } catch {
              return false;
            }
          });
        } else {
          // For path-based proxies, check path conflicts
          existing = await trx('proxy_upstreams')
            .where({ path: normalizedPath })
            .first();
        }

        if (existing) {
          const conflictError = new Error(hasDomains
            ? 'One or more domains are already configured'
            : 'Path already exists');
          conflictError.statusCode = 400;
          throw conflictError;
        }

        const [id] = await trx('proxy_upstreams').insert({
          name,
          path: normalizedPath,
          target_url,
          enabled,
          auth_required,
          headers: serializeHeaders(headers),
          domains: serializeDomains(domains),
          allowed_emails: serializeEmails(allowed_emails),
          preserve_host,
          auth_customization: serializeAuthCustomization(authCustomizationNormalized),
          created_at: new Date(),
          updated_at: new Date()
        });

        createdUpstream = await trx('proxy_upstreams').where({ id }).first();

        await syncNginxConfig(trx);
      });

      res.status(201).json({
        ...hydrateUpstream(createdUpstream)
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Error adding upstream:', error);
      res.status(500).json({ error: 'Failed to add upstream' });
    }
  }
);

// Update upstream (admin only)
router.put('/upstreams/:id',
  requireAdmin,
  [
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('path').optional().custom((value, { req }) => {
      if (value === undefined || value === null) return true;

      try {
        console.log('Path validation - value:', value, 'domains:', req.body.domains);
        const domains = normalizeDomains(req.body.domains);
        const hasDomains = domains.length > 0;

        console.log('Path validation - hasDomains:', hasDomains, 'hasPath:', value && value.trim());

        if (!hasDomains && (!value || !value.trim())) {
          throw new Error('Path is required when no domains are specified');
        }

        // Allow empty path when domains are provided
        if (value && value.trim()) {
          const trimmed = value.trim();
          if (!trimmed.startsWith('/')) {
            throw new Error('Path must start with /');
          }
          if (!/^\/[a-zA-Z0-9\-_\/]*$/.test(trimmed)) {
            throw new Error('Path must contain only alphanumeric, dash, underscore, and slash characters');
          }
        }

        return true;
      } catch (error) {
        throw new Error(`Path validation error: ${error.message}`);
      }
    }),
    body('target_url').optional().isURL(urlValidationOptions).withMessage('Valid target URL is required'),
    body('enabled').optional().isBoolean().withMessage('Enabled must be boolean'),
    body('auth_required').optional().isBoolean().withMessage('Auth required must be boolean'),
    body('headers').optional().isObject().withMessage('Headers must be an object'),
    body('domains').optional().custom((value, { req }) => {
      try {
        const domains = normalizeDomains(value);
        const hasPath = req.body.path && req.body.path.trim();

        if (!hasPath && domains.length === 0) {
          throw new Error('Either path or domains must be specified');
        }

        const isValid = domains.every(domain => domainValidationRegex.test(domain));
        if (!isValid) {
          throw new Error('Domains must be a comma or space separated list of hostnames');
        }
        return true;
      } catch (error) {
        throw new Error(`Domains validation error: ${error.message}`);
      }
    }),
    body('allowed_emails').optional().custom(value => {
      const emails = normalizeEmails(value);
      const isValid = emails.every(email => /^\S+@\S+\.\S+$/.test(email));
      if (!isValid) {
        throw new Error('Allowed emails must be comma or space separated email addresses');
      }
      return true;
    }),
    body('preserve_host').optional().isBoolean().withMessage('Preserve host must be boolean'),
    body('auth_customization').optional({ nullable: true }).custom(validateAuthCustomization)
  ],
  async (req, res) => {
    try {
      console.log('DEBUG: PUT request body:', JSON.stringify(req.body, null, 2));

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.log('DEBUG: Validation errors:', JSON.stringify(errors.array(), null, 2));
        return res.status(400).json({ error: 'Validation failed', details: errors.array() });
      }

      const { id } = req.params;
      let updatedUpstream;

      await db().transaction(async (trx) => {
        const existingUpstream = await trx('proxy_upstreams').where({ id }).first();
        if (!existingUpstream) {
          const notFoundError = new Error('Upstream not found');
          notFoundError.statusCode = 404;
          throw notFoundError;
        }

        const updates = { ...req.body, updated_at: new Date() };

        // Handle path updates for domain-only proxies
        if (updates.path !== undefined) {
          const hasDomains = normalizeDomains(updates.domains || existingUpstream.domains).length > 0;

          if (updates.path && updates.path.trim()) {
            updates.path = updates.path.endsWith('/') && updates.path !== '/' ? updates.path.slice(0, -1) : updates.path;
          } else if (hasDomains) {
            // For domain-only proxies, allow empty path
            updates.path = '';
          } else {
            // For path-based proxies, default to root if empty
            updates.path = '/';
          }

          // Check conflicts based on whether it's domain-based or path-based

          if (hasDomains) {
            // For domain-based proxies, check domain conflicts
            const newDomains = normalizeDomains(updates.domains || existingUpstream.domains);
            const conflictingUpstreams = await trx('proxy_upstreams')
              .whereNotNull('domains')
              .andWhereNot({ id })
              .andWhereRaw("json_extract(domains, '$[0]') IS NOT NULL");

            const conflict = conflictingUpstreams.find(upstream => {
              if (!upstream.domains) return false;
              try {
                const existingDomains = JSON.parse(upstream.domains);
                return existingDomains.some(domain => newDomains.includes(domain));
              } catch {
                return false;
              }
            });

            if (conflict) {
              const conflictError = new Error('One or more domains are already configured');
              conflictError.statusCode = 400;
              throw conflictError;
            }
          } else {
            // For path-based proxies, check path conflicts
            const conflict = await trx('proxy_upstreams')
              .where({ path: updates.path })
              .whereNot({ id })
              .first();

            if (conflict) {
              const conflictError = new Error('Path already exists');
              conflictError.statusCode = 400;
              throw conflictError;
            }
          }
        }

        if (updates.headers !== undefined) {
          updates.headers = serializeHeaders(updates.headers);
        }

        if (updates.domains !== undefined) {
          updates.domains = serializeDomains(updates.domains);
        }

        if (updates.allowed_emails !== undefined) {
          updates.allowed_emails = serializeEmails(updates.allowed_emails);
        }

        if (updates.preserve_host !== undefined) {
          const preserveHostBool = typeof updates.preserve_host === 'string'
            ? updates.preserve_host === 'true'
            : Boolean(updates.preserve_host);
          updates.preserve_host = preserveHostBool;
        }

        if (updates.auth_customization !== undefined) {
          updates.auth_customization = serializeAuthCustomization(updates.auth_customization);
        }

        await trx('proxy_upstreams')
          .where({ id })
          .update(updates);

        updatedUpstream = await trx('proxy_upstreams').where({ id }).first();

        await syncNginxConfig(trx);
      });

      res.json({
        ...hydrateUpstream(updatedUpstream)
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Error updating upstream:', error);
      res.status(500).json({ error: 'Failed to update upstream' });
    }
  }
);

// Delete upstream (admin only)
router.delete('/upstreams/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await db().transaction(async (trx) => {
      const deleted = await trx('proxy_upstreams')
        .where({ id })
        .del();

      if (!deleted) {
        const notFoundError = new Error('Upstream not found');
        notFoundError.statusCode = 404;
        throw notFoundError;
      }

      await syncNginxConfig(trx);
    });

    res.json({ message: 'Upstream deleted successfully' });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Error deleting upstream:', error);
    res.status(500).json({ error: 'Failed to delete upstream' });
  }
});

// Test upstream connectivity (admin only)
router.post('/upstreams/:id/test', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const upstream = await db()('proxy_upstreams').where({ id }).first();
    if (!upstream) {
      return res.status(404).json({ error: 'Upstream not found' });
    }

    // Test connectivity to the target URL
    const axios = require('axios');
    const startTime = Date.now();
    
    try {
      const response = await axios.get(upstream.target_url, {
        timeout: 5000,
        validateStatus: () => true // Accept any status code
      });
      
      const responseTime = Date.now() - startTime;
      
      res.json({
        status: 'success',
        response_code: response.status,
        response_time: responseTime,
        message: `Successfully connected to ${upstream.target_url}`
      });
    } catch (error) {
      res.json({
        status: 'error',
        response_time: Date.now() - startTime,
        message: error.message,
        error_code: error.code
      });
    }
  } catch (error) {
    console.error('Error testing upstream:', error);
    res.status(500).json({ error: 'Failed to test upstream' });
  }
});

// Get proxy statistics
router.get('/stats', async (req, res) => {
  try {
    const [totalUpstreams, enabledUpstreams] = await Promise.all([
      db()('proxy_upstreams').count('* as count').first(),
      db()('proxy_upstreams').where('enabled', true).count('* as count').first()
    ]);

    // In a real implementation, you might track request counts, response times, etc.
    const stats = {
      total_upstreams: totalUpstreams.count,
      enabled_upstreams: enabledUpstreams.count,
      disabled_upstreams: totalUpstreams.count - enabledUpstreams.count
    };

    res.json(stats);
  } catch (error) {
    console.error('Error fetching proxy stats:', error);
    res.status(500).json({ error: 'Failed to fetch proxy statistics' });
  }
});

// Get nginx configuration (admin only)
router.get('/nginx-config', requireAdmin, async (req, res) => {
  try {
    const upstreams = await db()('proxy_upstreams')
      .where('enabled', true)
      .orderBy('path');

    const { pathConfig, domainConfig, rootConfig } = generateNginxConfig(upstreams);
    const storedPathConfig = await readStoredConfig(DEFAULT_PATH_CONFIG_PATH);
    const storedDomainConfig = await readStoredConfig(DEFAULT_SERVER_CONFIG_PATH);
    const storedRootConfig = await readStoredConfig(DEFAULT_ROOT_CONFIG_PATH);

    const normalize = (value) => (value || '').trim();
    const pathInSync = storedPathConfig !== null && normalize(storedPathConfig) === normalize(pathConfig);
    const domainInSync = storedDomainConfig !== null && normalize(storedDomainConfig) === normalize(domainConfig);
    const rootInSync = storedRootConfig !== null && normalize(storedRootConfig) === normalize(rootConfig);

    res.json({
      path_config: pathConfig,
      domain_config: domainConfig,
      root_config: rootConfig,
      upstreams_count: upstreams.length,
      generated_at: new Date().toISOString(),
      path_file_path: DEFAULT_PATH_CONFIG_PATH,
      domain_file_path: DEFAULT_SERVER_CONFIG_PATH,
      root_file_path: DEFAULT_ROOT_CONFIG_PATH,
      stored_path_config: storedPathConfig,
      stored_domain_config: storedDomainConfig,
      stored_root_config: storedRootConfig,
      in_sync: {
        path: pathInSync,
        domain: domainInSync,
        root: rootInSync
      }
    });
  } catch (error) {
    console.error('Error generating nginx config:', error);
    res.status(500).json({ error: 'Failed to generate nginx configuration' });
  }
});

// Reload nginx configuration (admin only)
router.post('/nginx/reload', requireAdmin, async (req, res) => {
  try {
    const result = await reloadNginx();

    if (result.success) {
      return res.json({
        message: result.strategy === 'command'
          ? 'Nginx reloaded via command'
          : `Nginx reloaded (${result.strategy})`,
        reloaded: true,
        strategy: result.strategy,
        ...(result.command ? { command: result.command } : {}),
        ...(result.container ? { container: result.container } : {})
      });
    }

    res.json({
      message: result.reason || 'Nginx reload skipped (no strategy configured)',
      reloaded: false,
      strategy: result.strategy
    });
  } catch (error) {
    console.error('Error reloading nginx:', error);
    res.status(500).json({ error: 'Failed to reload nginx', message: error.message });
  }
});

// Export upstreams configuration (admin only)
router.get('/export', requireAdmin, async (req, res) => {
  try {
    const upstreams = await db()('proxy_upstreams')
      .select('name', 'path', 'target_url', 'enabled', 'auth_required', 'headers', 'domains', 'allowed_emails', 'preserve_host', 'auth_customization')
      .orderBy('path');

    const exportData = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      upstreams: upstreams.map(upstream => ({
        ...upstream,
        headers: upstream.headers ? JSON.parse(upstream.headers) : null,
        domains: upstream.domains ? JSON.parse(upstream.domains) : null,
        allowed_emails: upstream.allowed_emails ? JSON.parse(upstream.allowed_emails) : null,
        preserve_host: Boolean(upstream.preserve_host),
        auth_customization: parseAuthCustomization(upstream.auth_customization)
      }))
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="easyweb-proxy-config.json"');
    res.json(exportData);
  } catch (error) {
    console.error('Error exporting configuration:', error);
    res.status(500).json({ error: 'Failed to export configuration' });
  }
});

// Import upstreams configuration (admin only)
router.post('/import', requireAdmin, async (req, res) => {
  try {
    const { upstreams, replace = false } = req.body;

    if (!Array.isArray(upstreams)) {
      return res.status(400).json({ error: 'Upstreams must be an array' });
    }

    let imported = 0;
    const errors = [];

    await db().transaction(async (trx) => {
      if (replace) {
        await trx('proxy_upstreams').del();
      }

      for (const upstream of upstreams) {
        try {
          if (!upstream.name || !upstream.path || !upstream.target_url) {
            errors.push('Invalid upstream: missing required fields');
            continue;
          }

          const normalizedPath = upstream.path.endsWith('/') && upstream.path !== '/' ? upstream.path.slice(0, -1) : upstream.path;

          if (!replace) {
            const existing = await trx('proxy_upstreams')
              .where({ path: normalizedPath })
              .first();

            if (existing) {
              errors.push(`Path ${normalizedPath} already exists`);
              continue;
            }
          }

          validateAuthCustomization(upstream.auth_customization);
          const authCustomizationNormalized = normalizeAuthCustomization(upstream.auth_customization);

          await trx('proxy_upstreams').insert({
            name: upstream.name,
            path: normalizedPath,
            target_url: upstream.target_url,
            enabled: upstream.enabled !== undefined ? upstream.enabled : true,
            auth_required: upstream.auth_required !== undefined ? upstream.auth_required : true,
            headers: serializeHeaders(upstream.headers),
            domains: serializeDomains(upstream.domains),
            allowed_emails: serializeEmails(upstream.allowed_emails),
            preserve_host: upstream.preserve_host ? 1 : 0,
            auth_customization: serializeAuthCustomization(authCustomizationNormalized),
            created_at: new Date(),
            updated_at: new Date()
          });

          imported++;
        } catch (error) {
          errors.push(`Error importing upstream ${upstream.name || 'unknown'}: ${error.message}`);
        }
      }

      await syncNginxConfig(trx);
    });

    res.json({
      message: `Import completed. ${imported} upstreams imported.`,
      imported,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Error importing configuration:', error);
    res.status(500).json({ error: 'Failed to import configuration' });
  }
});

// Auth check for protected upstreams (used by nginx auth_request)
router.get('/auth-check', authenticateToken, async (req, res) => {
  try {
    const upstreamId = req.get('x-easyweb-upstream-id');

    if (!upstreamId) {
      return res.status(400).end();
    }

    const upstream = await db()('proxy_upstreams')
      .where({ id: upstreamId })
      .first();

    if (!upstream || !upstream.enabled) {
      return res.status(403).end();
    }

    if (!upstream.auth_required) {
      return res.status(204).end();
    }

    const emailsRaw = upstream.allowed_emails ? JSON.parse(upstream.allowed_emails) : [];
    const allowedEmails = Array.isArray(emailsRaw) ? emailsRaw.map(email => String(email).trim().toLowerCase()).filter(Boolean) : [];

    if (allowedEmails.length > 0 && !allowedEmails.includes('*')) {
      const userEmail = req.user?.email?.toLowerCase();
      if (!userEmail || !allowedEmails.includes(userEmail)) {
        return res.status(403).end();
      }
    }

    return res.status(204).end();
  } catch (error) {
    console.error('Proxy auth check failed:', error);
    return res.status(500).end();
  }
});

module.exports = {
  router,
  publicRouter,
};
