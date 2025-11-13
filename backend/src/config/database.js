const knex = require('knex');
const path = require('path');

let db;

const dbConfig = {
  client: 'sqlite3',
  connection: {
    filename: process.env.DB_PATH || path.join(__dirname, '../../data/easyweb.db')
  },
  useNullAsDefault: true,
  migrations: {
    directory: path.join(__dirname, '../migrations')
  }
};

async function initDatabase() {
  try {
    db = knex(dbConfig);
    
    // Test connection
    await db.raw('SELECT 1');
    
    // Run migrations
    await createTables();
    
    console.log('Database connection established');
    return db;
  } catch (error) {
    console.error('Database connection failed:', error);
    throw error;
  }
}

async function createTables() {
  async function ensureSettingExists(key, value, description) {
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

  // Users table
  const hasUsersTable = await db.schema.hasTable('users');
  if (!hasUsersTable) {
    await db.schema.createTable('users', table => {
      table.increments('id').primary();
      table.string('email').unique().notNullable();
      table.string('name').notNullable();
      table.string('provider').notNullable(); // google, github, microsoft
      table.string('provider_id').notNullable();
      table.string('avatar_url');
      table.string('role').defaultTo('user'); // admin, user
      table.boolean('active').defaultTo(true);
      table.timestamps(true, true);
    });
    console.log('Created users table');
  }

  // DNS blocklists table
  const hasBlocklistsTable = await db.schema.hasTable('dns_blocklists');
  if (!hasBlocklistsTable) {
    await db.schema.createTable('dns_blocklists', table => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.text('url').notNullable();
      table.boolean('enabled').defaultTo(true);
      table.integer('entries_count').defaultTo(0);
      table.timestamp('last_updated');
      table.timestamps(true, true);
    });
    console.log('Created dns_blocklists table');
  }

  // DNS queries log table
  const hasDnsQueriesTable = await db.schema.hasTable('dns_queries');
  if (!hasDnsQueriesTable) {
    await db.schema.createTable('dns_queries', table => {
      table.increments('id').primary();
      table.string('client_ip').notNullable();
      table.string('domain').notNullable();
      table.string('query_type').notNullable();
      table.string('response').notNullable(); // allowed, blocked, forwarded
      table.string('reason'); // blocklist name or upstream
      table.integer('response_time');
      table.timestamp('timestamp').defaultTo(db.fn.now());
      table.index(['timestamp', 'client_ip']);
      table.index(['domain']);
    });
    console.log('Created dns_queries table');
  }

  const hasDnsQueriesResponseTime = await db.schema.hasColumn('dns_queries', 'response_time');
  if (!hasDnsQueriesResponseTime) {
    await db.schema.alterTable('dns_queries', table => {
      table.integer('response_time');
    });
    console.log('Added response_time column to dns_queries table');
  }

  const hasDnsQueriesUpstream = await db.schema.hasColumn('dns_queries', 'upstream');
  if (!hasDnsQueriesUpstream) {
    await db.schema.alterTable('dns_queries', table => {
      table.string('upstream');
    });
    console.log('Added upstream column to dns_queries table');
  }

  const hasDnsQueriesCacheHit = await db.schema.hasColumn('dns_queries', 'cache_hit');
  if (!hasDnsQueriesCacheHit) {
    await db.schema.alterTable('dns_queries', table => {
      table.boolean('cache_hit').defaultTo(false);
    });
    console.log('Added cache_hit column to dns_queries table');
  }

  // Proxy upstreams table
  const hasUpstreamsTable = await db.schema.hasTable('proxy_upstreams');
  if (!hasUpstreamsTable) {
    await db.schema.createTable('proxy_upstreams', table => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.string('path').notNullable(); // /service1, /app
      table.string('target_url').notNullable(); // http://service1:3000
      table.boolean('enabled').defaultTo(true);
      table.boolean('auth_required').defaultTo(true);
      table.json('headers'); // custom headers to add
      table.json('domains'); // optional custom domains
      table.json('allowed_emails'); // optional email allowlist
      table.boolean('preserve_host').defaultTo(false);
      table.timestamps(true, true);
    });
    console.log('Created proxy_upstreams table');
  }

  const hasDomainsColumn = await db.schema.hasColumn('proxy_upstreams', 'domains');
  if (!hasDomainsColumn) {
    await db.schema.alterTable('proxy_upstreams', table => {
      table.json('domains');
    });
    console.log('Added domains column to proxy_upstreams table');
  }

  const hasPreserveHostColumn = await db.schema.hasColumn('proxy_upstreams', 'preserve_host');
  if (!hasPreserveHostColumn) {
    await db.schema.alterTable('proxy_upstreams', table => {
      table.boolean('preserve_host').defaultTo(false);
    });
    await db('proxy_upstreams').whereNull('preserve_host').update({ preserve_host: false });
    console.log('Added preserve_host column to proxy_upstreams table');
  }

  const hasAllowedEmailsColumn = await db.schema.hasColumn('proxy_upstreams', 'allowed_emails');
  if (!hasAllowedEmailsColumn) {
    await db.schema.alterTable('proxy_upstreams', table => {
      table.json('allowed_emails');
    });
    console.log('Added allowed_emails column to proxy_upstreams table');
  }

  const hasAuthCustomizationColumn = await db.schema.hasColumn('proxy_upstreams', 'auth_customization');
  if (!hasAuthCustomizationColumn) {
    await db.schema.alterTable('proxy_upstreams', table => {
      table.json('auth_customization');
    });
    console.log('Added auth_customization column to proxy_upstreams table');
  }

  const hasDnsOverridesTable = await db.schema.hasTable('dns_domain_overrides');
  if (!hasDnsOverridesTable) {
    await db.schema.createTable('dns_domain_overrides', table => {
      table.increments('id').primary();
      table.string('domain').notNullable();
      table.string('mode').notNullable(); // allow or block
      table.string('match_type').defaultTo('exact'); // exact or wildcard
      table.boolean('enabled').defaultTo(true);
      table.string('comment');
      table.timestamps(true, true);
      table.unique(['domain', 'mode', 'match_type']);
    });
    console.log('Created dns_domain_overrides table');
  }

  const hasLocalRecordsTable = await db.schema.hasTable('dns_local_records');
  if (!hasLocalRecordsTable) {
    await db.schema.createTable('dns_local_records', table => {
      table.increments('id').primary();
      table.string('domain').notNullable();
      table.string('record_type').notNullable(); // A, AAAA, CNAME
      table.string('value').notNullable();
      table.integer('ttl').defaultTo(300);
      table.boolean('enabled').defaultTo(true);
      table.string('comment');
      table.timestamps(true, true);
      table.unique(['domain', 'record_type', 'value']);
    });
    console.log('Created dns_local_records table');
  }

  // System settings table
  const hasSettingsTable = await db.schema.hasTable('settings');
  if (!hasSettingsTable) {
    await db.schema.createTable('settings', table => {
      table.increments('id').primary();
      table.string('key').unique().notNullable();
      table.text('value');
      table.text('description');
      table.timestamps(true, true);
    });
    console.log('Created settings table');
    
    // Insert default settings
    await db('settings').insert([
      { key: 'dns_upstream_servers', value: '8.8.8.8,1.1.1.1', description: 'Upstream DNS servers' },
      { key: 'dns_port', value: '53', description: 'DNS server port' },
      { key: 'blocklist_update_interval', value: '24', description: 'Blocklist update interval in hours' },
      { key: 'log_retention_days', value: '30', description: 'DNS query log retention in days' }
    ]);
  }

  // Sessions table for authentication
  const hasSessionsTable = await db.schema.hasTable('sessions');
  if (!hasSessionsTable) {
    await db.schema.createTable('sessions', table => {
      table.string('session_id').primary();
      table.text('session_data');
      table.timestamp('expires_at');
      table.timestamps(true, true);
    });
    console.log('Created sessions table');
  }

  await ensureSettingExists('dns_upstream_servers', '8.8.8.8,1.1.1.1', 'Upstream DNS servers');
  await ensureSettingExists('dns_port', '53', 'DNS server port');
  await ensureSettingExists('blocklist_update_interval', '24', 'Blocklist update interval in hours');
  await ensureSettingExists('log_retention_days', '30', 'DNS query log retention in days');
  await ensureSettingExists('dns_filter_enabled', 'true', 'Enable DNS filtering');
  await ensureSettingExists('dns_filter_disabled_until', '', 'Timestamp when DNS filtering should be re-enabled');
  await ensureSettingExists('dns_block_response', 'null_route', 'Block response strategy (null_route or nxdomain)');
  await ensureSettingExists('dns_cache_enabled', 'true', 'Enable DNS response caching');
  await ensureSettingExists('dns_cache_max_ttl', '3600', 'Maximum TTL in seconds for cached entries');
  await ensureSettingExists('dns_cache_min_ttl', '60', 'Minimum TTL in seconds for cached entries');
  await ensureSettingExists('dns_cache_max_items', '5000', 'Maximum number of cached DNS responses');
  await ensureSettingExists('dns_resolver_timeout_ms', '2000', 'Timeout in milliseconds for upstream DNS resolver');
  await ensureSettingExists('dns_cache_flush_token', '0', 'Token updated to trigger DNS cache flush');
  await ensureSettingExists('dns_logging_enabled', 'true', 'Enable DNS query logging');
  await ensureSettingExists('dns_config_version', String(Date.now()), 'Incremented when DNS configuration changes');
  await ensureSettingExists('dns_blocklist_version', String(Date.now()), 'Incremented when DNS blocklists change');
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
