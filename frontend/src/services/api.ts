import axios, { AxiosError, AxiosResponse } from 'axios';
import type {
  User,
  DnsQuery,
  DnsStats,
  DnsTrend,
  DnsOverview,
  DnsOverride,
  DnsLocalRecord,
  DnsClientStat,
  BlockList,
  ProxyUpstream,
  ProxyStats,
  ProxyNginxConfig,
  ProxyReloadResponse,
  DashboardStats,
  SystemHealth,
  PaginationInfo,
  BlockListForm,
  ProxyUpstreamForm,
  ProxyUpstreamPublicInfo,
  DnsSettingsForm,
  UpdateUserPayload,
  CreateUserPayload,
  GeneralSettings,
  SecuritySettings,
} from '../types';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'REACT_APP_API_URL_PLACEHOLDER';

const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  withCredentials: true,
  timeout: 30000,
});

const normalizeProxyUpstream = (upstream: any): ProxyUpstream => ({
  ...upstream,
  headers: upstream.headers ?? undefined,
  domains: upstream.domains ?? [],
  allowed_emails: upstream.allowed_emails ?? [],
  preserve_host: Boolean(upstream.preserve_host),
  auth_customization: upstream.auth_customization ?? null,
});

const normalizePublicUpstream = (upstream: any): ProxyUpstreamPublicInfo => ({
  ...upstream,
  enabled: Boolean(upstream.enabled),
  auth_required: Boolean(upstream.auth_required),
  auth_customization: upstream.auth_customization ?? null,
});

type AuthEvent = 'refreshFailed' | 'refreshSucceeded';

type AuthListener = (event: AuthEvent) => void;

const authListeners = new Set<AuthListener>();

export const authEvents = {
  subscribe(listener: AuthListener) {
    authListeners.add(listener);
    return () => {
      authListeners.delete(listener);
    };
  },
  emit(event: AuthEvent) {
    authListeners.forEach((listener) => listener(event));
  }
};

let refreshInFlight: Promise<void> | null = null;
let refreshFailed = false;

// Response interceptor to handle errors
api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as any;
    const isRefreshRequest = originalRequest?.url?.includes('/auth/refresh');

    if (error.response?.status === 401) {
      if (isRefreshRequest) {
        refreshFailed = true;
        authEvents.emit('refreshFailed');
        return Promise.reject(error);
      }

      if (refreshFailed) {
        return Promise.reject(error);
      }

      if (!originalRequest._retry) {
        originalRequest._retry = true;

        if (!refreshInFlight) {
          refreshInFlight = authApi.refreshToken()
            .then(() => {
              refreshFailed = false;
              authEvents.emit('refreshSucceeded');
            })
            .catch((refreshError) => {
              refreshFailed = true;
              authEvents.emit('refreshFailed');
              throw refreshError;
            })
            .finally(() => {
              refreshInFlight = null;
            });
        }

        try {
          await refreshInFlight;
          if (!refreshFailed) {
            return api(originalRequest);
          }
        } catch (refreshError) {
          return Promise.reject(refreshError);
        }
      }

      return Promise.reject(error);
    }

    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  getMe: (): Promise<User> =>
    api.get('/auth/me').then(res => res.data),

  logout: (): Promise<void> =>
    api.post('/auth/logout').then(() => {
      localStorage.removeItem('authToken');
    }),

  refreshToken: (): Promise<void> =>
    api.post('/auth/refresh').then(() => {
      // Token is set via httpOnly cookie
    }),

  loginUrl: (provider: 'google' | 'github' | 'microsoft', redirect?: string): string => {
    const url = new URL(`${API_BASE_URL}/api/auth/${provider}`);
    if (redirect) {
      url.searchParams.set('redirect', redirect);
    }
    return url.toString();
  },
};

// DNS API
export const dnsApi = {
  getStats: (): Promise<DnsStats> =>
    api.get('/dns/stats').then(res => res.data),

  getQueries: (params: {
    page?: number;
    limit?: number;
    filter?: 'blocked' | 'allowed'; // legacy support
    status?: 'blocked' | 'allowed' | 'forwarded' | 'cached' | 'local' | 'error';
    search?: string;
    client?: string;
    cache?: 'hit' | 'miss';
    from?: string;
    to?: string;
  } = {}): Promise<{
    queries: DnsQuery[];
    pagination: PaginationInfo;
  }> =>
    api.get('/dns/queries', { params }).then(res => res.data),

  deleteQueries: (params: {
    before?: string;
    domain?: string;
    client_ip?: string;
    response?: 'blocked' | 'allowed' | 'forwarded' | 'cached' | 'local' | 'error';
  } = {}): Promise<{ message: string; deleted_count: number }> =>
    api.delete('/dns/queries', { params }).then(res => res.data),

  getTrends: (): Promise<DnsTrend[]> =>
    api.get('/dns/trends').then(res => res.data),

  getTopBlocked: (): Promise<Array<{ domain: string; count: number }>> =>
    api.get('/dns/top-blocked').then(res => res.data),

  getBlocklists: (): Promise<BlockList[]> =>
    api.get('/dns/blocklists').then(res => res.data),

  addBlocklist: (data: BlockListForm): Promise<BlockList> =>
    api.post('/dns/blocklists', data).then(res => res.data),

  updateBlocklist: (id: number, data: Partial<BlockListForm>): Promise<BlockList> =>
    api.put(`/dns/blocklists/${id}`, data).then(res => res.data),

  deleteBlocklist: (id: number): Promise<void> =>
    api.delete(`/dns/blocklists/${id}`).then(() => {}),

  updateBlocklistEntries: (id: number): Promise<void> =>
    api.post(`/dns/blocklists/${id}/update`).then(() => {}),

  getSettings: (): Promise<Record<string, string>> =>
    api.get('/dns/settings').then(res => res.data),

  updateSettings: (settings: DnsSettingsForm): Promise<void> =>
    api.put('/dns/settings', settings).then(() => {}),

  getOverview: (): Promise<DnsOverview> =>
    api.get('/dns/overview').then(res => res.data),

  toggleFilter: (payload: { enabled: boolean; duration_minutes?: number }): Promise<{ enabled: boolean; disabled_until: string | null }> =>
    api.post('/dns/control/toggle', payload).then(res => res.data),

  flushCache: (): Promise<void> =>
    api.post('/dns/control/cache/flush').then(() => {}),

  reloadBlocklists: (): Promise<void> =>
    api.post('/dns/control/blocklists/reload').then(() => {}),

  getOverrides: (includeDisabled = true): Promise<DnsOverride[]> =>
    api.get('/dns/overrides', { params: { include_disabled: includeDisabled } }).then(res => res.data),

  createOverride: (data: { domain: string; mode: 'allow' | 'block'; match_type?: 'exact' | 'wildcard'; enabled?: boolean; comment?: string }): Promise<DnsOverride> =>
    api.post('/dns/overrides', data).then(res => res.data),

  updateOverride: (id: number, data: Partial<{ domain: string; mode: 'allow' | 'block'; match_type: 'exact' | 'wildcard'; enabled: boolean; comment?: string }>): Promise<DnsOverride> =>
    api.put(`/dns/overrides/${id}`, data).then(res => res.data),

  deleteOverride: (id: number): Promise<void> =>
    api.delete(`/dns/overrides/${id}`).then(() => {}),

  getLocalRecords: (): Promise<DnsLocalRecord[]> =>
    api.get('/dns/local-records').then(res => res.data),

  createLocalRecord: (data: { domain: string; record_type: 'A' | 'AAAA' | 'CNAME'; value: string; ttl?: number; enabled?: boolean; comment?: string }): Promise<DnsLocalRecord> =>
    api.post('/dns/local-records', data).then(res => res.data),

  updateLocalRecord: (id: number, data: Partial<{ domain: string; record_type: 'A' | 'AAAA' | 'CNAME'; value: string; ttl: number; enabled: boolean; comment?: string }>): Promise<DnsLocalRecord> =>
    api.put(`/dns/local-records/${id}`, data).then(res => res.data),

  deleteLocalRecord: (id: number): Promise<void> =>
    api.delete(`/dns/local-records/${id}`).then(() => {}),

  getClients: (params: { limit?: number; days?: number } = {}): Promise<DnsClientStat[]> =>
    api.get('/dns/clients', { params }).then(res => res.data),
};

// Proxy API
export const proxyApi = {
  getUpstreams: (): Promise<ProxyUpstream[]> =>
    api.get('/proxy/upstreams').then(res => res.data.map(normalizeProxyUpstream)),

  addUpstream: (data: ProxyUpstreamForm): Promise<ProxyUpstream> =>
    api.post('/proxy/upstreams', data).then(res => normalizeProxyUpstream(res.data)),

  updateUpstream: (id: number, data: Partial<ProxyUpstreamForm>): Promise<ProxyUpstream> =>
    api.put(`/proxy/upstreams/${id}`, data).then(res => normalizeProxyUpstream(res.data)),

  deleteUpstream: (id: number): Promise<void> =>
    api.delete(`/proxy/upstreams/${id}`).then(() => {}),

  testUpstream: (id: number): Promise<{
    status: 'success' | 'error';
    response_code?: number;
    response_time: number;
    message: string;
    error_code?: string;
  }> =>
    api.post(`/proxy/upstreams/${id}/test`).then(res => res.data),

  getStats: (): Promise<ProxyStats> =>
    api.get('/proxy/stats').then(res => res.data),

  getNginxConfig: (): Promise<ProxyNginxConfig> =>
    api.get('/proxy/nginx-config').then(res => res.data),

  exportConfig: (): Promise<Blob> =>
    api.get('/proxy/export', { responseType: 'blob' }).then(res => res.data),

  importConfig: (data: {
    upstreams: ProxyUpstreamForm[];
    replace?: boolean;
  }): Promise<{
    message: string;
    imported: number;
    errors?: string[];
  }> =>
    api.post('/proxy/import', data).then(res => res.data),

  getUpstreamPublic: (id: number): Promise<ProxyUpstreamPublicInfo> =>
    api.get(`/proxy/public/upstreams/${id}`).then(res => normalizePublicUpstream(res.data)),

  reloadNginx: (): Promise<ProxyReloadResponse> =>
    api.post('/proxy/nginx/reload').then(res => res.data),
};

// Dashboard API
export const dashboardApi = {
  getStats: (): Promise<DashboardStats> =>
    api.get('/dashboard/stats').then(res => res.data),

  getActivity: (limit?: number): Promise<{
    dns_queries: Array<DnsQuery & { type: 'dns_query' }>;
    user_activity: Array<User & { type: 'user_login'; timestamp: string }>;
  }> =>
    api.get('/dashboard/activity', { params: { limit } }).then(res => res.data),

  getHealth: (): Promise<SystemHealth> =>
    api.get('/dashboard/health').then(res => res.data),

  getTrends: (): Promise<Array<{
    date: string;
    total: number;
    blocked: number;
    allowed: number;
  }>> =>
    api.get('/dashboard/trends').then(res => res.data),

  getTopClients: (): Promise<Array<{
    client_ip: string;
    query_count: number;
    blocked_count: number;
    allowed_count: number;
  }>> =>
    api.get('/dashboard/top-clients').then(res => res.data),

  getUsers: (): Promise<User[]> =>
    api.get('/dashboard/users').then(res => res.data),

  createUser: (payload: CreateUserPayload): Promise<User> =>
    api.post('/dashboard/users', payload).then(res => res.data),

  updateUser: (id: number, data: UpdateUserPayload): Promise<User> =>
    api.put(`/dashboard/users/${id}`, data).then(res => res.data),

  deleteUser: (id: number): Promise<void> =>
    api.delete(`/dashboard/users/${id}`).then(() => {}),

  getGeneralSettings: (): Promise<GeneralSettings> =>
    api.get('/dashboard/settings/general').then(res => res.data),

  updateGeneralSettings: (payload: GeneralSettings): Promise<GeneralSettings> =>
    api.put('/dashboard/settings/general', payload).then(res => res.data),

  getSecuritySettings: (): Promise<SecuritySettings> =>
    api.get('/dashboard/settings/security').then(res => res.data),

  updateSecuritySettings: (payload: SecuritySettings): Promise<SecuritySettings> =>
    api.put('/dashboard/settings/security', payload).then(res => res.data),

  getLogs: (params: {
    page?: number;
    limit?: number;
    level?: 'error' | 'warn' | 'info';
  } = {}): Promise<{
    logs: Array<{
      timestamp: string;
      level: string;
      message: string;
      component: string;
    }>;
    pagination: PaginationInfo;
  }> =>
    api.get('/dashboard/logs', { params }).then(res => res.data),

  getConfig: (): Promise<{
    dns: {
      upstream_servers: string;
      port: string;
      blocklists_count: number;
    };
    proxy: {
      upstreams_count: number;
    };
  }> =>
    api.get('/dashboard/config').then(res => res.data),

  triggerBlocklistRefresh: (): Promise<{ message: string; updated: number; timestamp: string }> =>
    api.post('/dashboard/actions/blocklists/update').then(res => res.data),

  clearCache: (): Promise<{ message: string }> =>
    api.post('/dashboard/actions/cache/clear').then(res => res.data),
};

// Error handler utility
export const handleApiError = (error: any): string => {
  if (error.response?.data?.message) {
    return error.response.data.message;
  }
  if (error.response?.data?.error) {
    return error.response.data.error;
  }
  if (error.message) {
    return error.message;
  }
  return 'An unexpected error occurred';
};

// Health check
export const healthCheck = (): Promise<{
  status: string;
  timestamp: string;
  uptime: number;
  memory: any;
  version: string;
}> =>
  api.get('/health', { baseURL: API_BASE_URL }).then(res => res.data);

export default api;
