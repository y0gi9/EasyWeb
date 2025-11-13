const { Packet } = require('dns2');
const { db } = require('../config/database');
const { logger } = require('../config/logger');

const SUPPORTED_RECORD_TYPES = new Set(['A', 'AAAA', 'CNAME']);

const TYPE_MAP = {
  A: Packet.TYPE.A,
  AAAA: Packet.TYPE.AAAA,
  CNAME: Packet.TYPE.CNAME,
};

const MATCHING_TYPES = {
  [Packet.TYPE.A]: ['A'],
  [Packet.TYPE.AAAA]: ['AAAA'],
  [Packet.TYPE.CNAME]: ['CNAME'],
  [Packet.TYPE.ANY]: ['A', 'AAAA', 'CNAME']
};

class LocalRecordManager {
  constructor() {
    this.records = new Map();
    this.loadedAt = null;
  }

  async initialize() {
    await this.reload();
    logger.info(`Local record manager ready (${this.records.size} domains loaded)`);
  }

  async reload() {
    const rows = await db()('dns_local_records').where({ enabled: true });
    const next = new Map();

    for (const row of rows) {
      const type = (row.record_type || '').toUpperCase();
      if (!SUPPORTED_RECORD_TYPES.has(type)) {
        continue;
      }

      const domain = (row.domain || '').toLowerCase().trim();
      const value = (row.value || '').trim();

      if (!domain || !value) {
        continue;
      }

      const ttl = this.#sanitizeTtl(row.ttl);

      if (!next.has(domain)) {
        next.set(domain, []);
      }

      next.get(domain).push({
        type,
        value,
        ttl,
      });
    }

    this.records = next;
    this.loadedAt = new Date();
    logger.info(`Loaded ${rows.length} local DNS record${rows.length === 1 ? '' : 's'}`);
  }

  getAnswers(question) {
    if (!question || !question.name) {
      return null;
    }

    const domain = question.name.toLowerCase();
    const records = this.records.get(domain);
    if (!records || !records.length) {
      return null;
    }

    const supportedTypes = MATCHING_TYPES[question.type] || [];
    const answers = [];

    for (const record of records) {
      if (!supportedTypes.includes(record.type)) {
        continue;
      }

      const answer = this.#buildAnswer(question.name, record);
      if (answer) {
        answers.push(answer);
      }
    }

    return answers.length > 0 ? answers : null;
  }

  #buildAnswer(name, record) {
    const ttl = this.#sanitizeTtl(record.ttl);

    switch (record.type) {
      case 'A':
        return {
          name,
          type: TYPE_MAP.A,
          class: Packet.CLASS.IN,
          ttl,
          address: record.value
        };
      case 'AAAA':
        return {
          name,
          type: TYPE_MAP.AAAA,
          class: Packet.CLASS.IN,
          ttl,
          address: record.value
        };
      case 'CNAME':
        return {
          name,
          type: TYPE_MAP.CNAME,
          class: Packet.CLASS.IN,
          ttl,
          domain: record.value.endsWith('.') ? record.value : `${record.value}.`
        };
      default:
        return null;
    }
  }

  #sanitizeTtl(ttl) {
    const parsed = Number(ttl);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 300;
    }
    return Math.min(86400, Math.max(30, Math.floor(parsed)));
  }
}

module.exports = {
  LocalRecordManager
};
