const { db } = require('../config/database');
const { logger } = require('../config/logger');

const SETTINGS_KEYS = [
  'dns_filter_enabled',
  'dns_filter_disabled_until',
  'dns_block_response',
  'dns_upstream_servers',
  'dns_cache_enabled',
  'dns_cache_max_ttl',
  'dns_cache_min_ttl',
  'dns_cache_max_items',
  'dns_resolver_timeout_ms',
  'dns_logging_enabled',
  'dns_config_version',
  'dns_blocklist_version',
  'dns_cache_flush_token'
];

class SettingsManager {
  constructor({ pollIntervalMs = 5000 } = {}) {
    this.pollIntervalMs = pollIntervalMs;
    this.snapshot = {
      filterEnabled: true,
      disabledUntil: null,
      upstreams: ['8.8.8.8', '1.1.1.1'],
      blockResponse: 'null_route',
      cache: {
        enabled: true,
        maxTtl: 3600,
        minTtl: 60,
        maxItems: 5000
      },
      resolverTimeoutMs: 2000,
      loggingEnabled: true
    };
    this.configVersion = null;
    this.blocklistVersion = null;
    this.cacheFlushToken = null;
    this.pollTimer = null;
    this.callbacks = {
      onConfigChange: null,
      onBlocklistChange: null,
      onCacheFlush: null
    };
  }

  async load() {
    const rows = await db()('settings').whereIn('key', SETTINGS_KEYS);
    const map = rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});

    this.configVersion = map.dns_config_version || this.configVersion || String(Date.now());
    this.blocklistVersion = map.dns_blocklist_version || this.blocklistVersion || String(Date.now());
    this.cacheFlushToken = map.dns_cache_flush_token || this.cacheFlushToken || '0';

    const upstreams = (map.dns_upstream_servers || '8.8.8.8,1.1.1.1')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    const disabledUntil = map.dns_filter_disabled_until ? new Date(map.dns_filter_disabled_until) : null;

    this.snapshot = {
      filterEnabled: map.dns_filter_enabled !== 'false',
      disabledUntil: disabledUntil && !Number.isNaN(disabledUntil.getTime()) ? disabledUntil : null,
      upstreams: upstreams.length > 0 ? upstreams : ['8.8.8.8', '1.1.1.1'],
      blockResponse: map.dns_block_response === 'nxdomain' ? 'nxdomain' : 'null_route',
      cache: {
        enabled: map.dns_cache_enabled !== 'false',
        maxTtl: this._toNumber(map.dns_cache_max_ttl, 3600),
        minTtl: this._toNumber(map.dns_cache_min_ttl, 60),
        maxItems: this._toNumber(map.dns_cache_max_items, 5000)
      },
      resolverTimeoutMs: this._toNumber(map.dns_resolver_timeout_ms, 2000),
      loggingEnabled: map.dns_logging_enabled !== 'false'
    };

    return this.snapshot;
  }

  getSnapshot() {
    return {
      ...this.snapshot,
      upstreams: [...this.snapshot.upstreams],
      cache: { ...this.snapshot.cache }
    };
  }

  shouldFilter() {
    const { filterEnabled, disabledUntil } = this.snapshot;
    if (disabledUntil && disabledUntil instanceof Date) {
      if (disabledUntil.getTime() > Date.now()) {
        return false;
      }
    }
    return filterEnabled;
  }

  startPolling(callbacks = {}) {
    this.callbacks = {
      onConfigChange: callbacks.onConfigChange || null,
      onBlocklistChange: callbacks.onBlocklistChange || null,
      onCacheFlush: callbacks.onCacheFlush || null
    };

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }

    this.pollTimer = setInterval(async () => {
      try {
        await this._checkForUpdates();
      } catch (error) {
        logger.error('Failed to poll DNS settings:', error);
      }
    }, this.pollIntervalMs);
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async _checkForUpdates() {
    const rows = await db()('settings')
      .whereIn('key', ['dns_config_version', 'dns_blocklist_version', 'dns_cache_flush_token']);

    const map = rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});

    if (map.dns_config_version && map.dns_config_version !== this.configVersion) {
      this.configVersion = map.dns_config_version;
      await this.load();
      if (typeof this.callbacks.onConfigChange === 'function') {
        this.callbacks.onConfigChange(this.getSnapshot());
      }
    }

    if (map.dns_blocklist_version && map.dns_blocklist_version !== this.blocklistVersion) {
      this.blocklistVersion = map.dns_blocklist_version;
      if (typeof this.callbacks.onBlocklistChange === 'function') {
        this.callbacks.onBlocklistChange();
      }
    }

    if (map.dns_cache_flush_token && map.dns_cache_flush_token !== this.cacheFlushToken) {
      this.cacheFlushToken = map.dns_cache_flush_token;
      if (typeof this.callbacks.onCacheFlush === 'function') {
        this.callbacks.onCacheFlush();
      }
    }
  }

  _toNumber(value, fallback) {
    const parsed = Number(value);
    if (Number.isNaN(parsed) || parsed <= 0) {
      return fallback;
    }
    return parsed;
  }
}

module.exports = { SettingsManager };
