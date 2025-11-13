const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { db } = require('../config/database');
const { logger } = require('../config/logger');

class BlocklistManager {
  constructor() {
    this.blockedDomains = new Set();
    this.blockedWildcards = new Set();
    this.customAllowExact = new Set();
    this.customAllowWildcard = new Set();
    this.customBlockExact = new Set();
    this.customBlockWildcard = new Set();
    this.blocklistsPath = '/app/blocklists';
    this.defaultUpstreamsLoaded = false;
    this.lastBlocklistVersion = null;
    this.lastOverrideVersion = null;
    this.initialized = false;
  }

  async initialize() {
    try {
      await fs.ensureDir(this.blocklistsPath);
      await this.reloadOverrides();
      await this.reloadBlocklists();

      if (this.blockedDomains.size === 0 && !this.defaultUpstreamsLoaded) {
        await this.addDefaultBlocklists();
        await this.reloadBlocklists();
      }

      this.initialized = true;
      logger.info(`Blocklist manager ready (${this.blockedDomains.size.toLocaleString()} domains loaded)`);
    } catch (error) {
      logger.error('Failed to initialize blocklist manager:', error);
      throw error;
    }
  }

  async reloadBlocklists() {
    const blocklists = await db()('dns_blocklists').where('enabled', true);

    this.blockedDomains.clear();
    this.blockedWildcards.clear();

    for (const blocklist of blocklists) {
      try {
        await this._loadBlocklistFile(blocklist);
      } catch (error) {
        logger.error(`Failed to load blocklist ${blocklist.name}: ${error.message}`);
      }
    }

    const latestUpdate = await db()('dns_blocklists')
      .max('updated_at as updated_at')
      .first();

    this.lastBlocklistVersion = latestUpdate?.updated_at || new Date();
  }

  async reloadOverrides() {
    const overrides = await db()('dns_domain_overrides').select('*');

    this.customAllowExact.clear();
    this.customAllowWildcard.clear();
    this.customBlockExact.clear();
    this.customBlockWildcard.clear();

    for (const override of overrides) {
      if (!override.enabled) continue;
      const domain = (override.domain || '').toLowerCase().trim();
      if (!domain) continue;

      const isWildcard = override.match_type === 'wildcard';

      if (override.mode === 'allow') {
        if (isWildcard) {
          this.customAllowWildcard.add(domain);
        } else {
          this.customAllowExact.add(domain);
        }
      } else if (override.mode === 'block') {
        if (isWildcard) {
          this.customBlockWildcard.add(domain);
        } else {
          this.customBlockExact.add(domain);
        }
      }
    }

    const latestUpdate = await db()('dns_domain_overrides')
      .max('updated_at as updated_at')
      .first();

    this.lastOverrideVersion = latestUpdate?.updated_at || new Date();
  }

  async syncIfChanged() {
    const [blocklistVersion, overrideVersion] = await Promise.all([
      db()('settings').where({ key: 'dns_blocklist_version' }).first(),
      db()('settings').where({ key: 'dns_config_version' }).first()
    ]);

    if (blocklistVersion && blocklistVersion.value) {
      const versionDate = new Date(Number(blocklistVersion.value));
      if (!Number.isNaN(versionDate.getTime()) && (!this.lastBlocklistVersion || versionDate > this.lastBlocklistVersion)) {
        logger.info('Detected blocklist version change, reloading datasets...');
        await this.reloadBlocklists();
      }
    }

    if (overrideVersion && overrideVersion.value) {
      const versionDate = new Date(Number(overrideVersion.value));
      if (!Number.isNaN(versionDate.getTime()) && (!this.lastOverrideVersion || versionDate > this.lastOverrideVersion)) {
        logger.info('Detected DNS override change, reloading overrides...');
        await this.reloadOverrides();
      }
    }
  }

  evaluate(domain) {
    if (!this.initialized) {
      return { action: 'allow', reason: 'not_initialized' };
    }

    if (!domain || typeof domain !== 'string') {
      return { action: 'allow', reason: 'invalid_domain' };
    }

    const normalized = domain.toLowerCase();

    if (this.customAllowExact.has(normalized)) {
      return { action: 'allow', reason: 'custom_allow_exact' };
    }

    const allowWildcardMatch = this._matchWildcard(normalized, this.customAllowWildcard);
    if (allowWildcardMatch) {
      return { action: 'allow', reason: 'custom_allow_wildcard', rule: allowWildcardMatch };
    }

    if (this.customBlockExact.has(normalized)) {
      return { action: 'block', reason: 'custom_block_exact' };
    }

    const customBlockWildcard = this._matchWildcard(normalized, this.customBlockWildcard);
    if (customBlockWildcard) {
      return { action: 'block', reason: 'custom_block_wildcard', rule: customBlockWildcard };
    }

    if (this.blockedDomains.has(normalized)) {
      return { action: 'block', reason: 'blocklist_exact' };
    }

    const blocklistWildcard = this._matchWildcard(normalized, this.blockedWildcards) || this._matchByParent(normalized);
    if (blocklistWildcard) {
      return { action: 'block', reason: 'blocklist_wildcard', rule: blocklistWildcard };
    }

    return { action: 'allow', reason: 'not_listed' };
  }

  async addDefaultBlocklists() {
    const defaults = [
      {
        name: 'Steven Black Hosts',
        url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
        enabled: true
      },
      {
        name: 'AdGuard DNS Filter',
        url: 'https://raw.githubusercontent.com/AdguardTeam/AdguardFilters/master/BaseFilter/sections/adservers.txt',
        enabled: true
      },
      {
        name: 'EasyList',
        url: 'https://easylist.to/easylist/easylist.txt',
        enabled: false
      }
    ];

    for (const blocklist of defaults) {
      const existing = await db()('dns_blocklists').where({ name: blocklist.name }).first();
      if (!existing) {
        const [id] = await db()('dns_blocklists').insert({
          ...blocklist,
          created_at: new Date(),
          updated_at: new Date()
        });

        if (blocklist.enabled) {
          await this._downloadBlocklist({ ...blocklist, id });
        }
      }
    }

    this.defaultUpstreamsLoaded = true;
    logger.info('Default blocklists installed');
  }

  async updateAllBlocklists() {
    const blocklists = await db()('dns_blocklists').where('enabled', true);
    let updated = 0;

    for (const blocklist of blocklists) {
      try {
        await this._downloadBlocklist(blocklist);
        updated += 1;
      } catch (error) {
        logger.error(`Failed to update blocklist ${blocklist.name}: ${error.message}`);
      }
    }

    await this.reloadBlocklists();

    return updated;
  }

  getStats() {
    return {
      initialized: this.initialized,
      blocklisted_domains: this.blockedDomains.size,
      custom_allow_exact: this.customAllowExact.size,
      custom_allow_wildcard: this.customAllowWildcard.size,
      custom_block_exact: this.customBlockExact.size,
      custom_block_wildcard: this.customBlockWildcard.size
    };
  }

  async _loadBlocklistFile(blocklist) {
    const filename = `${blocklist.id}.txt`;
    const filepath = path.join(this.blocklistsPath, filename);

    if (!(await fs.pathExists(filepath))) {
      await this._downloadBlocklist(blocklist);
    }

    const content = await fs.readFile(filepath, 'utf8');
    const domains = this._parseBlocklistContent(content);
    let added = 0;

    domains.forEach(({ domain, wildcard }) => {
      if (!domain) return;
      if (wildcard) {
        if (!this.blockedWildcards.has(domain)) {
          this.blockedWildcards.add(domain);
        }
      } else if (!this.blockedDomains.has(domain)) {
        this.blockedDomains.add(domain);
        added += 1;
      }
    });

    logger.debug(`Loaded ${added} domains from blocklist ${blocklist.name}`);
  }

  async _downloadBlocklist(blocklist) {
    logger.info(`Downloading blocklist: ${blocklist.name}`);

    const response = await axios.get(blocklist.url, {
      timeout: 45000,
      headers: {
        'User-Agent': 'EasyWeb-DNS/1.0 (DNS Filtering Service)'
      }
    });

    const filename = `${blocklist.id}.txt`;
    const filepath = path.join(this.blocklistsPath, filename);

    await fs.writeFile(filepath, response.data);

    const domains = this._parseBlocklistContent(response.data);

    await db()('dns_blocklists')
      .where('id', blocklist.id)
      .update({
        entries_count: domains.length,
        last_updated: new Date()
      });

    return domains.length;
  }

  _parseBlocklistContent(content) {
    if (!content) return [];

    const results = [];
    const lines = content.split('\n');

    for (let rawLine of lines) {
      let line = rawLine.trim();

      if (!line || line.startsWith('#') || line.startsWith('!')) {
        continue;
      }

      let domain = null;
      let wildcard = false;

      if (line.startsWith('||') && line.includes('^')) {
        domain = line.substring(2, line.indexOf('^')).toLowerCase();
        wildcard = true;
      } else if (line.includes(' ')) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2 && (parts[0] === '0.0.0.0' || parts[0] === '127.0.0.1')) {
          domain = parts[1].toLowerCase();
        }
      } else {
        domain = line.toLowerCase();
      }

      if (!domain) continue;

      domain = domain.replace(/^\*\./, '');

      if (this._isValidDomain(domain)) {
        results.push({ domain, wildcard });
      }
    }

    return results;
  }

  _isValidDomain(domain) {
    if (!domain || typeof domain !== 'string') return false;
    if (domain.length > 253) return false;
    const regex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
    return regex.test(domain);
  }

  _matchWildcard(domain, wildcardSet) {
    for (const pattern of wildcardSet) {
      if (domain === pattern || domain.endsWith(`.${pattern}`)) {
        return pattern;
      }
    }
    return null;
  }

  _matchByParent(domain) {
    const parts = domain.split('.');
    for (let i = 1; i < parts.length; i++) {
      const suffix = parts.slice(i).join('.');
      if (this.blockedDomains.has(suffix) || this.blockedWildcards.has(suffix)) {
        return suffix;
      }
    }
    return null;
  }
}

module.exports = { BlocklistManager };
