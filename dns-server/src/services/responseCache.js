const { LRUCache } = require('lru-cache');

class ResponseCache {
  constructor(config = {}) {
    this.enabled = true;
    this.maxItems = 5000;
    this.minTtl = 60; // seconds
    this.maxTtl = 3600; // seconds
    this.cache = null;
    this.applyConfig(config);
  }

  applyConfig(config = {}) {
    this.enabled = config.enabled !== false;
    this.maxItems = Number(config.maxItems || this.maxItems);
    this.minTtl = Number(config.minTtl || this.minTtl);
    this.maxTtl = Number(config.maxTtl || this.maxTtl);

    if (!this.enabled) {
      this.cache = null;
      return;
    }

    this.cache = new LRUCache({
      max: Math.max(this.maxItems, 0),
      ttl: this.maxTtl * 1000,
      updateAgeOnGet: true
    });
  }

  getKey(question) {
    if (!question) return null;
    return `${question.name.toLowerCase()}:${question.type}`;
  }

  get(question) {
    if (!this.enabled || !this.cache) {
      return null;
    }

    const key = this.getKey(question);
    if (!key) return null;

    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    const remainingMs = entry.expiresAt - now;
    if (remainingMs <= 0) {
      this.cache.delete(key);
      return null;
    }

    const remainingTtl = Math.max(1, Math.floor(remainingMs / 1000));

    return {
      ...entry,
      remainingTtl
    };
  }

  set(question, response) {
    if (!this.enabled || !this.cache) {
      return;
    }

    const key = this.getKey(question);
    if (!key) return;

    const ttlSeconds = this._getTtlSeconds(response.answers);
    if (ttlSeconds <= 0) {
      return;
    }

    const ttl = Math.min(this.maxTtl, Math.max(this.minTtl, ttlSeconds));

    const entry = {
      answers: (response.answers || []).map((answer) => ({ ...answer })),
      authority: (response.authority || []).map((record) => ({ ...record })),
      additional: (response.additional || []).map((record) => ({ ...record })),
      header: {
        aa: response.header.aa,
        ra: response.header.ra,
        rd: response.header.rd,
        rcode: response.header.rcode
      },
      storedAt: Date.now(),
      expiresAt: Date.now() + ttl * 1000
    };

    this.cache.set(key, entry, { ttl: ttl * 1000 });
  }

  flush() {
    if (this.cache) {
      this.cache.clear();
    }
  }

  getStats() {
    if (!this.cache) {
      return {
        enabled: this.enabled,
        size: 0,
        max: this.maxItems
      };
    }

    return {
      enabled: this.enabled,
      size: this.cache.size,
      max: this.cache.max
    };
  }

  _getTtlSeconds(answers = []) {
    if (!answers.length) {
      return 0;
    }

    let ttl = Number.MAX_SAFE_INTEGER;
    for (const answer of answers) {
      if (typeof answer.ttl === 'number') {
        ttl = Math.min(ttl, answer.ttl);
      }
    }

    if (ttl === Number.MAX_SAFE_INTEGER) {
      return 0;
    }

    return ttl;
  }
}

module.exports = { ResponseCache }; 
