const knex = require('knex');
const path = require('path');

let db;

const dbConfig = {
  client: 'sqlite3',
  connection: {
    filename: path.join('/app/data/easyweb.db')
  },
  useNullAsDefault: true
};

async function initDatabase() {
  try {
    db = knex(dbConfig);
    
    // Test connection
    await db.raw('SELECT 1');
    
    console.log('DNS Server database connection established');
    await ensureSchema();
    return db;
  } catch (error) {
    console.error('DNS Server database connection failed:', error);
    throw error;
  }
}

async function ensureSchema() {
  async function ensureSetting(key, value, description) {
    const existing = await db('settings').where({ key }).first();
    if (!existing) {
      await db('settings').insert({
        key,
        value: value == null ? '' : String(value),
        description,
        created_at: new Date(),
        updated_at: new Date()
      });
    }
  }

  const hasBlocklists = await db.schema.hasTable('dns_blocklists');
  if (!hasBlocklists) {
    await db.schema.createTable('dns_blocklists', table => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.text('url').notNullable();
      table.boolean('enabled').defaultTo(true);
      table.integer('entries_count').defaultTo(0);
      table.timestamp('last_updated');
      table.timestamps(true, true);
    });
  }

  const hasDnsQueries = await db.schema.hasTable('dns_queries');
  if (!hasDnsQueries) {
    await db.schema.createTable('dns_queries', table => {
      table.increments('id').primary();
      table.string('client_ip').notNullable();
      table.string('domain').notNullable();
      table.string('query_type').notNullable();
      table.string('response').notNullable();
      table.string('reason');
      table.integer('response_time');
      table.string('upstream');
      table.boolean('cache_hit').defaultTo(false);
      table.timestamp('timestamp').defaultTo(db.fn.now());
      table.index(['timestamp', 'client_ip']);
      table.index(['domain']);
    });
  } else {
    const columns = [
      { name: 'response_time', builder: table => table.integer('response_time') },
      { name: 'upstream', builder: table => table.string('upstream') },
      { name: 'cache_hit', builder: table => table.boolean('cache_hit').defaultTo(false) }
    ];

    for (const column of columns) {
      const exists = await db.schema.hasColumn('dns_queries', column.name);
      if (!exists) {
        await db.schema.alterTable('dns_queries', column.builder);
      }
    }
  }

  const hasOverrides = await db.schema.hasTable('dns_domain_overrides');
  if (!hasOverrides) {
    await db.schema.createTable('dns_domain_overrides', table => {
      table.increments('id').primary();
      table.string('domain').notNullable();
      table.string('mode').notNullable();
      table.string('match_type').defaultTo('exact');
      table.boolean('enabled').defaultTo(true);
      table.string('comment');
      table.timestamps(true, true);
      table.unique(['domain', 'mode', 'match_type']);
    });
  }

  const hasLocalRecords = await db.schema.hasTable('dns_local_records');
  if (!hasLocalRecords) {
    await db.schema.createTable('dns_local_records', table => {
      table.increments('id').primary();
      table.string('domain').notNullable();
      table.string('record_type').notNullable();
      table.string('value').notNullable();
      table.integer('ttl').defaultTo(300);
      table.boolean('enabled').defaultTo(true);
      table.string('comment');
      table.timestamps(true, true);
      table.unique(['domain', 'record_type', 'value']);
    });
  }

  const hasSettings = await db.schema.hasTable('settings');
  if (!hasSettings) {
    await db.schema.createTable('settings', table => {
      table.increments('id').primary();
      table.string('key').unique().notNullable();
      table.text('value');
      table.text('description');
      table.timestamps(true, true);
    });
  }

  await ensureSetting('dns_upstream_servers', '8.8.8.8,1.1.1.1', 'Upstream DNS servers');
  await ensureSetting('dns_port', '53', 'DNS server port');
  await ensureSetting('blocklist_update_interval', '24', 'Blocklist update interval in hours');
  await ensureSetting('log_retention_days', '30', 'DNS query log retention in days');
  await ensureSetting('dns_filter_enabled', 'true', 'Enable DNS filtering');
  await ensureSetting('dns_filter_disabled_until', '', 'Timestamp when DNS filtering should be re-enabled');
  await ensureSetting('dns_block_response', 'null_route', 'Block response strategy');
  await ensureSetting('dns_cache_enabled', 'true', 'Enable DNS response caching');
  await ensureSetting('dns_cache_max_ttl', '3600', 'Maximum TTL for cached responses (seconds)');
  await ensureSetting('dns_cache_min_ttl', '60', 'Minimum TTL for cached responses (seconds)');
  await ensureSetting('dns_cache_max_items', '5000', 'Maximum number of cached responses');
  await ensureSetting('dns_resolver_timeout_ms', '2000', 'Upstream resolver timeout in milliseconds');
  await ensureSetting('dns_cache_flush_token', '0', 'Token updated to trigger DNS cache flush');
  await ensureSetting('dns_logging_enabled', 'true', 'Enable DNS query logging');
  await ensureSetting('dns_config_version', String(Date.now()), 'Incremented when DNS configuration changes');
  await ensureSetting('dns_blocklist_version', String(Date.now()), 'Incremented when DNS blocklists change');
}

function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

module.exports = {
  initDatabase,
  getDatabase,
  db: () => getDatabase()
};
