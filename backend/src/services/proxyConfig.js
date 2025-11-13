const fs = require('fs/promises');
const { existsSync } = require('fs');
const path = require('path');
const { promisify } = require('util');
const { exec } = require('child_process');
const Docker = require('dockerode');

const { db } = require('../config/database');

const execAsync = promisify(exec);

const DEFAULT_PATH_CONFIG_PATH = process.env.NGINX_CONFIG_PATH
  || path.resolve(__dirname, '../../../nginx/includes/proxy_upstreams.inc');
const DEFAULT_SERVER_CONFIG_PATH = process.env.NGINX_SERVER_CONFIG_PATH
  || path.resolve(__dirname, '../../../nginx/includes/proxy_servers.conf');
const DEFAULT_ROOT_CONFIG_PATH = process.env.NGINX_ROOT_CONFIG_PATH
  || path.resolve(__dirname, '../../../nginx/includes/proxy_root.inc');
const LOCALHOST_FORWARD_HOST = process.env.NGINX_LOCALHOST_FORWARD_HOST || 'host.docker.internal';
const DEFAULT_FRONTEND_ROOT_SNIPPET = [
  '    set $easyweb_upstream_id "";',
  '    proxy_pass http://easyweb-frontend:80;',
  '    proxy_set_header Host $host;',
  '    proxy_set_header X-Real-IP $remote_addr;',
  '    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
  '    proxy_set_header X-Forwarded-Proto $scheme;',
  '    proxy_set_header X-Forwarded-Host $host;',
  '',
  '    # WebSocket support',
  '    proxy_http_version 1.1;',
  '    proxy_set_header Upgrade $http_upgrade;',
  '    proxy_set_header Connection "upgrade";'
].join('\n');
const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock';
const DEFAULT_CONTAINER_NAME = process.env.NGINX_CONTAINER_NAME || 'easyweb-nginx';

const dockerEnabled = !process.env.NGINX_DISABLE_DOCKER && existsSync(DOCKER_SOCKET_PATH);
const reloadCommand = process.env.NGINX_RELOAD_COMMAND;

let docker = null;
if (dockerEnabled) {
  docker = new Docker({ socketPath: DOCKER_SOCKET_PATH });
}

function parseHeaders(raw) {
  if (!raw) {
    return {};
  }

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) || {};
    } catch (error) {
      console.warn('Failed to parse proxy headers JSON:', error.message);
      return {};
    }
  }

  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw;
  }

  return {};
}

function escapeHeaderValue(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/"/g, '\\"');
}

function parseDomains(raw) {
  if (!raw) {
    return [];
  }

  if (Array.isArray(raw)) {
    return raw;
  }

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (error) {
      return raw.split(/[,\s]+/).filter(Boolean);
    }
  }

  return [];
}

function ensureHttpScheme(targetUrl) {
  if (typeof targetUrl !== 'string') {
    return targetUrl;
  }

  const trimmed = targetUrl.trim();
  if (!trimmed) {
    return targetUrl;
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return trimmed;
  }

  if (/^(?:unix|http\+unix):/.test(trimmed)) {
    return trimmed;
  }

  return `http://${trimmed}`;
}

function getTargetDetails(targetUrl) {
  try {
    const normalized = ensureHttpScheme(targetUrl);
    const parsed = new URL(normalized);
    return {
      host: parsed.host,
      isHttps: parsed.protocol === 'https:'
    };
  } catch (error) {
    console.warn('Failed to parse proxy target URL:', error.message);
    return {
      host: null,
      isHttps: false
    };
  }
}

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function rewriteLocalhostTarget(targetUrl) {
  const normalized = ensureHttpScheme(targetUrl);

  try {
    const parsed = new URL(normalized);
    if (LOCALHOST_HOSTNAMES.has(parsed.hostname.toLowerCase())) {
      parsed.hostname = LOCALHOST_FORWARD_HOST;
      return parsed.toString();
    }
    return normalized;
  } catch (error) {
    return normalized;
  }
}

function ensureProxyPassTarget(targetUrl, path) {
  const rewrittenTarget = rewriteLocalhostTarget(targetUrl);

  if (path === '/' || path === undefined) {
    return rewrittenTarget;
  }

  try {
    const parsed = new URL(rewrittenTarget);
    if (!parsed.pathname.endsWith('/')) {
      parsed.pathname = `${parsed.pathname}/`;
    }
    return parsed.toString();
  } catch (error) {
    return rewrittenTarget.endsWith('/') ? rewrittenTarget : `${rewrittenTarget}/`;
  }
}

function getHostHeaderValue(upstream, targetHost) {
  if (upstream.preserve_host) {
    return '$host';
  }
  return targetHost || '$host';
}

function buildPathLocationBlock(upstream) {
  const headers = parseHeaders(upstream.headers);
  const headerEntries = Object.entries(headers);
  const hasCustomHostHeader = headerEntries.some(([key]) => key.toLowerCase() === 'host');
  const { host: targetHost, isHttps } = getTargetDetails(upstream.target_url);
  const resolvedHostHeader = getHostHeaderValue(upstream, targetHost);
  const path = upstream.path;
  const hasDomains = parseDomains(upstream.domains).length > 0;

  // Skip if this is a domain-only proxy (empty path) or root path
  if (!path || path === '/' || hasDomains) {
    return null;
  }
  const pathWithSlash = `${path}/`;
  const locationDirective = `^~ ${pathWithSlash}`;
  const proxyTarget = ensureProxyPassTarget(upstream.target_url, path);

  const sections = [`# ${upstream.name}`];

  // Generate redirect block for path-based proxies
  sections.push(
    `location = ${path} {`,
    `    return 307 ${pathWithSlash};`,
    `}`,
    ''
  );

  const lines = [
    `location ${locationDirective} {`
  ];

  if (upstream.auth_required) {
    lines.push(`    set $easyweb_upstream_id "${upstream.id}";`);
    lines.push('    set $easyweb_original_uri $request_uri;');
    lines.push('    set $easyweb_original_host $host;');
    lines.push('    set $easyweb_auth_redirect "";');
    lines.push('    auth_request_set $easyweb_auth_redirect $upstream_http_x_easyweb_auth_redirect;');
    lines.push('    auth_request /__easyweb/proxy-auth;');
    lines.push('    error_page 401 = @easyweb_auth_unauthorized;');
    lines.push('    error_page 403 = @easyweb_auth_forbidden;');
  }

  lines.push(`    proxy_pass ${proxyTarget};`);

  if (!hasCustomHostHeader) {
    lines.push(`    proxy_set_header Host ${resolvedHostHeader};`);
  }

  lines.push(
    '    proxy_set_header X-Real-IP $remote_addr;',
    '    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '    proxy_set_header X-Forwarded-Proto $scheme;',
    '    proxy_set_header X-Forwarded-Host $host;',
    '',
    '    # WebSocket support',
    '    proxy_http_version 1.1;',
    '    proxy_set_header Upgrade $http_upgrade;',
    '    proxy_set_header Connection "upgrade";'
  );

  if (isHttps) {
    lines.push('    proxy_ssl_server_name on;');
  }

  headerEntries.forEach(([key, value]) => {
    lines.push(`    proxy_set_header ${key} "${escapeHeaderValue(value)}";`);
  });

  if (upstream.auth_required) {
    lines.push('    # Authentication required');
  }

  lines.push('}');

  sections.push(lines.join('\n'));

  return sections.join('\n');
}

function buildDomainServerBlock(upstream) {
  const domains = parseDomains(upstream.domains);
  if (!domains.length) {
    return null;
  }

  const headers = parseHeaders(upstream.headers);
  const headerEntries = Object.entries(headers);
  const hasCustomHostHeader = headerEntries.some(([key]) => key.toLowerCase() === 'host');
  const { host: targetHost, isHttps } = getTargetDetails(upstream.target_url);
  const resolvedHostHeader = getHostHeaderValue(upstream, targetHost);
  const proxyTarget = ensureProxyPassTarget(upstream.target_url, '/');

  const lines = [
    `# ${upstream.name} (${domains.join(', ')})`,
    'server {',
    '    listen 80;',
    '    listen 443 ssl;',
    '    http2 on;',
    `    server_name ${domains.join(' ')};`,
    '',
    '    ssl_certificate /etc/nginx/ssl/cert.pem;',
    '    ssl_certificate_key /etc/nginx/ssl/key.pem;',
    '',
    '    location / {'
  ];

  if (upstream.auth_required) {
    lines.push(`        set $easyweb_upstream_id "${upstream.id}";`);
    lines.push('        set $easyweb_original_uri $request_uri;');
    lines.push('        set $easyweb_original_host $host;');
    lines.push('        set $easyweb_auth_redirect "";');
    lines.push('        auth_request_set $easyweb_auth_redirect $upstream_http_x_easyweb_auth_redirect;');
    lines.push('        auth_request /__easyweb/proxy-auth;');
    lines.push('        error_page 401 = @easyweb_auth_unauthorized;');
    lines.push('        error_page 403 = @easyweb_auth_forbidden;');
  }

  lines.push(`        proxy_pass ${proxyTarget};`);

  if (!hasCustomHostHeader) {
    lines.push(`        proxy_set_header Host ${resolvedHostHeader};`);
  }

  lines.push(
    '        proxy_set_header X-Real-IP $remote_addr;',
    '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '        proxy_set_header X-Forwarded-Proto $scheme;',
    '        proxy_set_header X-Forwarded-Host $host;',
    '',
    '        # WebSocket support',
    '        proxy_http_version 1.1;',
    '        proxy_set_header Upgrade $http_upgrade;',
    '        proxy_set_header Connection "upgrade";'
  );

  if (isHttps) {
    lines.push('        proxy_ssl_server_name on;');
  }

  headerEntries.forEach(([key, value]) => {
    lines.push(`        proxy_set_header ${key} "${escapeHeaderValue(value)}";`);
  });

  if (upstream.auth_required) {
    lines.push('        # Authentication required');
  }

  lines.push('    }');

  if (upstream.auth_required) {
    lines.push(
      '',
      '    location = /__easyweb/proxy-auth {',
      '        internal;',
      '        proxy_pass http://easyweb-backend:3001/api/proxy/auth-check;',
      '        proxy_pass_request_body off;',
      '        proxy_set_header Content-Length "";',
      '        proxy_set_header Cookie $http_cookie;',
      '        proxy_set_header Authorization $http_authorization;',
      '        proxy_set_header X-Easyweb-Upstream-Id $easyweb_upstream_id;',
      '        proxy_set_header X-Original-URI $easyweb_original_uri;',
      '        proxy_set_header X-Easyweb-Original-Host $easyweb_original_host;',
      '        proxy_set_header X-Forwarded-Proto $scheme;',
      '        proxy_set_header X-Easyweb-Auth-Request "1";',
      '    }',
      '',
      '    location @easyweb_auth_unauthorized {',
      '        if ($easyweb_auth_redirect = "") {',
      '            return 401;',
      '        }',
      '        return 302 $easyweb_auth_redirect;',
      '    }',
      '',
      '    location @easyweb_auth_forbidden {',
      '        return 403;',
      '    }'
    );
  }

  lines.push('}');

  return lines.join('\n');
}

function buildRootConfig(upstream) {
  const headers = parseHeaders(upstream.headers);
  const headerEntries = Object.entries(headers);
  const hasCustomHostHeader = headerEntries.some(([key]) => key.toLowerCase() === 'host');
  const { host: targetHost, isHttps } = getTargetDetails(upstream.target_url);
  const resolvedHostHeader = getHostHeaderValue(upstream, targetHost);
  const proxyTarget = ensureProxyPassTarget(upstream.target_url, '/');

  const lines = [`    # ${upstream.name}`];

  if (upstream.auth_required) {
    lines.push(`    set $easyweb_upstream_id "${upstream.id}";`);
    lines.push('    auth_request /__easyweb/proxy-auth;');
    lines.push('    error_page 401 = @easyweb_auth_unauthorized;');
    lines.push('    error_page 403 = @easyweb_auth_forbidden;');
  }

  lines.push(`    proxy_pass ${proxyTarget};`);

  if (!hasCustomHostHeader) {
    lines.push(`    proxy_set_header Host ${resolvedHostHeader};`);
  }

  lines.push(
    '    proxy_set_header X-Real-IP $remote_addr;',
    '    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '    proxy_set_header X-Forwarded-Proto $scheme;',
    '    proxy_set_header X-Forwarded-Host $host;',
    '',
    '    # WebSocket support',
    '    proxy_http_version 1.1;',
    '    proxy_set_header Upgrade $http_upgrade;',
    '    proxy_set_header Connection "upgrade";'
  );

  if (isHttps) {
    lines.push('    proxy_ssl_server_name on;');
  }

  headerEntries.forEach(([key, value]) => {
    lines.push(`    proxy_set_header ${key} "${escapeHeaderValue(value)}";`);
  });

  if (upstream.auth_required) {
    lines.push('    # Authentication required');
  }

  return lines.join('\n');
}

function generateNginxConfig(rawUpstreams) {
  const upstreams = (rawUpstreams || []).map(upstream => {
    const domains = parseDomains(upstream.domains);
    return {
      ...upstream,
      headers: parseHeaders(upstream.headers),
      domains,
      preserve_host: Boolean(upstream.preserve_host)
    };
  });

  const nonRootUpstreams = upstreams.filter((upstream) => upstream.path !== '/');

  const pathBlocks = nonRootUpstreams
    .map((upstream) => buildPathLocationBlock(upstream))
    .filter(Boolean);

  const domainBlocks = upstreams
    .map((upstream) => buildDomainServerBlock(upstream))
    .filter(Boolean);

  const pathConfig = pathBlocks.length ? pathBlocks.join('\n\n') : '# No upstreams enabled';
  const domainConfig = domainBlocks.length ? domainBlocks.join('\n\n') : '# No domain-based upstreams configured';
  const rootConfig = DEFAULT_FRONTEND_ROOT_SNIPPET;

  return {
    pathConfig,
    domainConfig,
    rootConfig,
  };
}

async function ensureConfigDirectory(filePath) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
}

async function writeConfigFile(config, filePath = DEFAULT_PATH_CONFIG_PATH) {
  await ensureConfigDirectory(filePath);
  const hasContent = typeof config === 'string' && config.trim().length > 0;
  const baseContent = hasContent ? config.trimEnd() : '# No upstreams enabled';
  const normalized = baseContent.endsWith('\n') ? baseContent : `${baseContent}\n`;
  await fs.writeFile(filePath, normalized, 'utf-8');
  return filePath;
}

async function readStoredConfig(filePath = DEFAULT_PATH_CONFIG_PATH) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function syncNginxConfig(knexClient = db()) {
  const upstreams = await knexClient('proxy_upstreams')
    .where('enabled', true)
    .orderBy('path');

  const { pathConfig, domainConfig, rootConfig } = generateNginxConfig(upstreams);
  const pathFilePath = await writeConfigFile(pathConfig, DEFAULT_PATH_CONFIG_PATH);
  const serverFilePath = await writeConfigFile(domainConfig, DEFAULT_SERVER_CONFIG_PATH);
  const rootFilePath = await writeConfigFile(rootConfig, DEFAULT_ROOT_CONFIG_PATH);

  return {
    pathConfig,
    domainConfig,
    rootConfig,
    pathFilePath,
    serverFilePath,
    rootFilePath,
    upstreamsCount: upstreams.length,
  };
}

async function reloadViaDocker(containerName = DEFAULT_CONTAINER_NAME) {
  if (!docker || !containerName) {
    return { skipped: true, reason: 'Docker reload unavailable' };
  }

  try {
    const container = docker.getContainer(containerName);
    await container.kill({ signal: 'HUP' });
    return { success: true, strategy: 'docker-sighup', container: containerName };
  } catch (error) {
    if (error.statusCode === 404) {
      return { skipped: true, reason: `Container ${containerName} not found` };
    }
    throw Object.assign(new Error(`Failed to reload nginx via Docker: ${error.message}`), { cause: error });
  }
}

async function reloadViaCommand(command) {
  if (!command) {
    return { skipped: true, reason: 'Reload command not configured' };
  }

  await execAsync(command);
  return { success: true, strategy: 'command', command };
}

async function reloadNginx() {
  const attempts = [];

  try {
    const dockerResult = await reloadViaDocker();
    attempts.push(dockerResult);
    if (dockerResult.success) {
      return dockerResult;
    }
  } catch (error) {
    attempts.push({ success: false, strategy: 'docker-sighup', error });
  }

  try {
    const commandResult = await reloadViaCommand(reloadCommand);
    attempts.push(commandResult);
    if (commandResult.success) {
      return commandResult;
    }
  } catch (error) {
    attempts.push({ success: false, strategy: 'command', error });
  }

  const failures = attempts.filter((attempt) => attempt.success === false);
  if (failures.length > 0) {
    const message = failures.map((failure) => `${failure.strategy}: ${failure.error?.message || 'unknown error'}`).join('; ');
    throw new Error(`Failed to reload nginx - ${message}`);
  }

  const summaries = attempts
    .filter((attempt) => attempt.skipped)
    .map((attempt) => attempt.reason)
    .join('; ');

  return {
    success: false,
    strategy: 'none',
    reason: summaries || 'No reload strategies configured',
  };
}

module.exports = {
  DEFAULT_PATH_CONFIG_PATH,
  DEFAULT_SERVER_CONFIG_PATH,
  DEFAULT_ROOT_CONFIG_PATH,
  generateNginxConfig,
  syncNginxConfig,
  reloadNginx,
  readStoredConfig,
};
