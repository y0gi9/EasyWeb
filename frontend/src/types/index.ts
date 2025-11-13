export interface User {
  id: number;
  email: string;
  name: string;
  avatar_url?: string;
  role: 'admin' | 'user';
  provider: 'google' | 'github' | 'microsoft';
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DnsQuery {
  id: number;
  client_ip: string;
  domain: string;
  query_type: string;
  response: 'allowed' | 'blocked' | 'forwarded' | 'cached' | 'local' | 'error';
  reason?: string;
  response_time?: number;
  upstream?: string | null;
  cache_hit?: boolean;
  timestamp: string;
}

export interface DnsStats {
  total_queries: number;
  blocked_queries: number;
  allowed_queries: number;
  forwarded_queries: number;
  cached_queries: number;
  local_queries: number;
  queries_24h: number;
  blocked_24h: number;
  local_24h: number;
  block_percentage: string;
}

export interface DnsTrend {
  hour: string;
  total: number;
  blocked: number;
  allowed: number;
}

export interface DnsClientStat {
  client_ip: string;
  total_queries: number;
  blocked_queries: number;
}

export interface DnsOverview {
  totals: {
    total_queries: number;
    blocked_queries: number;
    allowed_queries: number;
    local_queries: number;
    blocked_percentage: number;
    cache_hit_percentage: number;
  };
  last24h: {
    total_queries: number;
    blocked_queries: number;
    allowed_queries: number;
    local_queries: number;
    blocked_percentage: number;
  };
  runtime: {
    filter_enabled: boolean;
    disabled_until: string | null;
    cache_enabled: boolean;
    upstream_servers: string[];
  };
  blocklists: {
    total: number;
    enabled: number;
  };
  local_records: {
    total: number;
    enabled: number;
  };
  overrides: {
    allow: number;
    block: number;
  };
  top_clients: Array<{
    client_ip: string;
    query_count: number;
    blocked_count: number;
  }>;
  top_blocked_domains: Array<{
    domain: string;
    count: number;
  }>;
  top_allowed_domains: Array<{
    domain: string;
    count: number;
  }>;
}

export interface DnsLocalRecord {
  id: number;
  domain: string;
  record_type: 'A' | 'AAAA' | 'CNAME';
  value: string;
  ttl: number;
  enabled: boolean;
  comment?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DnsOverride {
  id: number;
  domain: string;
  mode: 'allow' | 'block';
  match_type: 'exact' | 'wildcard';
  enabled: boolean;
  comment?: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlockList {
  id: number;
  name: string;
  url: string;
  enabled: boolean;
  entries_count: number;
  last_updated?: string;
  created_at: string;
  updated_at: string;
}

export interface ProxyUpstream {
  id: number;
  name: string;
  path: string;
  target_url: string;
  enabled: boolean;
  auth_required: boolean;
  headers?: Record<string, string>;
  domains: string[];
  allowed_emails: string[];
  preserve_host: boolean;
  auth_customization?: ProxyAuthCustomization | null;
  created_at: string;
  updated_at: string;
}

export interface ProxyAuthCustomization {
  headerImageUrl?: string;
  logoUrl?: string;
  headline?: string;
  bodyText?: string;
  fontFamily?: string;
}

export interface ProxyUpstreamPublicInfo {
  id: number;
  name: string;
  enabled: boolean;
  auth_required: boolean;
  auth_customization?: ProxyAuthCustomization | null;
}

export interface ProxyStats {
  total_upstreams: number;
  enabled_upstreams: number;
  disabled_upstreams: number;
}

export interface ProxyNginxConfig {
  path_config: string;
  domain_config: string;
  root_config: string;
  upstreams_count: number;
  generated_at: string;
  path_file_path?: string;
  domain_file_path?: string;
  root_file_path?: string;
  stored_path_config?: string | null;
  stored_domain_config?: string | null;
  stored_root_config?: string | null;
  in_sync?: {
    path: boolean;
    domain: boolean;
    root: boolean;
  };
}

export interface ProxyReloadResponse {
  message: string;
  reloaded: boolean;
  strategy?: string;
  command?: string;
  container?: string;
  reason?: string;
}

export interface DashboardStats {
  users: {
    total: number;
    active: number;
  };
  dns: {
    total_queries: number;
    blocked_queries: number;
    queries_24h: number;
    blocked_24h: number;
    block_rate: string;
  };
  proxy: {
    total_upstreams: number;
    enabled_upstreams: number;
  };
  system: {
    uptime: number;
    memory: {
      rss: number;
      heapUsed: number;
      heapTotal: number;
      external: number;
    };
    node_version: string;
  };
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    database: 'healthy' | 'unhealthy' | 'unknown';
    redis: 'healthy' | 'unhealthy' | 'unavailable' | 'unknown';
    dns_service: 'healthy' | 'unhealthy' | 'unknown';
  };
}

export interface ApiError {
  error: string;
  message?: string;
  details?: any[];
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface WebSocketMessage {
  type: string;
  data: any;
  timestamp: string;
}

export interface ConnectedClient {
  id: string;
  user: User;
  connectedAt: string;
  rooms: string[];
}

export interface NotificationData {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: string;
  read?: boolean;
}

// Form types
export interface LoginForm {
  provider: 'google' | 'github' | 'microsoft';
}

export interface BlockListForm {
  name: string;
  url: string;
  enabled: boolean;
}

export interface ProxyUpstreamForm {
  name: string;
  path: string;
  target_url: string;
  enabled: boolean;
  auth_required: boolean;
  headers?: Record<string, string>;
  domains?: string[];
  allowed_emails?: string[];
  preserve_host?: boolean;
  auth_customization?: ProxyAuthCustomization | null;
}

export interface DnsSettingsForm {
  dns_upstream_servers?: string;
  dns_port?: string;
  blocklist_update_interval?: string;
  log_retention_days?: string;
  dns_cache_enabled?: string;
  dns_cache_max_ttl?: string;
  dns_cache_min_ttl?: string;
  dns_cache_max_items?: string;
  dns_resolver_timeout_ms?: string;
  dns_filter_enabled?: string;
  dns_filter_disabled_until?: string;
  dns_block_response?: string;
  dns_logging_enabled?: string;
}

export interface UserForm {
  role: 'admin' | 'user';
  active: boolean;
}

export type UpdateUserPayload = Partial<UserForm>;

export interface CreateUserPayload {
  email: string;
  name?: string;
  role?: 'admin' | 'user';
}

export interface GeneralSettings {
  appName: string;
  appDomain: string;
  adminEmail: string;
  registrationEnabled: boolean;
}

export interface SecuritySettings {
  sessionTimeoutMinutes: number;
  requireAuthForAll: boolean;
  requireAdminMfa: boolean;
}

// Chart data types
export interface ChartDataPoint {
  name: string;
  value: number;
  [key: string]: any;
}

export interface TimeSeriesDataPoint {
  timestamp: string;
  value: number;
  [key: string]: any;
}
