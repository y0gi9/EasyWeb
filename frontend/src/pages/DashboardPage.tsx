import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import { dashboardApi, dnsApi, proxyApi, handleApiError } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import {
  ShieldCheckIcon,
  GlobeAltIcon,
  ServerIcon,
  UsersIcon
} from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';

const DashboardPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: dashboardApi.getStats,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const { data: health } = useQuery({
    queryKey: ['dashboard', 'health'],
    queryFn: dashboardApi.getHealth,
    refetchInterval: 60000, // Refetch every minute
  });

  const { data: activity, isLoading: activityLoading } = useQuery({
    queryKey: ['dashboard', 'activity', 10],
    queryFn: () => dashboardApi.getActivity(10),
    staleTime: 30000,
  });

  const { data: topBlocked, isLoading: topBlockedLoading } = useQuery({
    queryKey: ['dns', 'top-blocked'],
    queryFn: dnsApi.getTopBlocked,
    staleTime: 60000,
  });

  const blocklistMutation = useMutation({
    mutationFn: dashboardApi.triggerBlocklistRefresh,
    onSuccess: (response) => {
      toast.success(response?.message || 'Blocklist refresh triggered');
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'activity', 10] });
      queryClient.invalidateQueries({ queryKey: ['dns', 'top-blocked'] });
    },
    onError: (err) => {
      toast.error(handleApiError(err));
    }
  });

  const clearCacheMutation = useMutation({
    mutationFn: dashboardApi.clearCache,
    onSuccess: (response) => {
      toast.success(response?.message || 'Cache cleared');
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'health'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'trends'] });
    },
    onError: (err) => {
      toast.error(handleApiError(err));
    }
  });

  const exportConfigMutation = useMutation({
    mutationFn: proxyApi.exportConfig,
    onSuccess: (blob) => {
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `easyweb-config-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('Configuration exported');
    },
    onError: (err) => {
      toast.error(handleApiError(err));
    }
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600">Failed to load dashboard data</div>
      </div>
    );
  }

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  };

  const formatMemory = (bytes: number) => {
    return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  };

  const recentDnsQueries = activity?.dns_queries?.slice(0, 8) || [];
  const recentUserActivity = activity?.user_activity?.slice(0, 5) || [];
  const topBlockedDomains = topBlocked?.slice(0, 8) || [];

  const handleBlocklistRefresh = () => {
    if (!isAdmin) {
      toast.error('Only administrators can run this action');
      return;
    }
    blocklistMutation.mutate();
  };

  const handleClearCache = () => {
    if (!isAdmin) {
      toast.error('Only administrators can run this action');
      return;
    }
    clearCacheMutation.mutate();
  };

  const handleExportConfig = () => {
    if (!isAdmin) {
      toast.error('Only administrators can run this action');
      return;
    }
    exportConfigMutation.mutate();
  };

  const renderResponseBadge = (response: string) => {
    const base = 'inline-flex px-2 py-0.5 rounded-full text-xs font-medium';
    if (response === 'blocked') {
      return <span className={`${base} bg-red-100 text-red-700`}>Blocked</span>;
    }
    if (response === 'forwarded') {
      return <span className={`${base} bg-blue-100 text-blue-700`}>Forwarded</span>;
    }
    return <span className={`${base} bg-green-100 text-green-700`}>Allowed</span>;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="pb-5 border-b border-gray-200">
        <h1 className="text-3xl font-bold leading-6 text-gray-900">Dashboard</h1>
        <p className="mt-2 max-w-4xl text-sm text-gray-500">
          Monitor your network security and proxy status
        </p>
      </div>

      {/* Stats Grid */}
      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {/* DNS Stats */}
        <div className="card p-5">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <GlobeAltIcon className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-5 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-gray-500 truncate">
                  DNS Queries (24h)
                </dt>
                <dd className="text-lg font-medium text-gray-900">
                  {stats?.dns.queries_24h.toLocaleString() || '0'}
                </dd>
                <dd className="text-sm text-gray-500">
                  {stats?.dns.blocked_24h.toLocaleString() || '0'} blocked
                </dd>
              </dl>
            </div>
          </div>
        </div>

        {/* Block Rate */}
        <div className="card p-5">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <ShieldCheckIcon className="h-6 w-6 text-green-600" />
            </div>
            <div className="ml-5 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-gray-500 truncate">
                  Block Rate
                </dt>
                <dd className="text-lg font-medium text-gray-900">
                  {stats?.dns.block_rate}%
                </dd>
                <dd className="text-sm text-gray-500">
                  Total: {stats?.dns.total_queries.toLocaleString() || '0'}
                </dd>
              </dl>
            </div>
          </div>
        </div>

        {/* Proxy Upstreams */}
        <div className="card p-5">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <ServerIcon className="h-6 w-6 text-purple-600" />
            </div>
            <div className="ml-5 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-gray-500 truncate">
                  Proxy Upstreams
                </dt>
                <dd className="text-lg font-medium text-gray-900">
                  {stats?.proxy.enabled_upstreams || '0'}
                </dd>
                <dd className="text-sm text-gray-500">
                  {stats?.proxy.total_upstreams || '0'} configured
                </dd>
              </dl>
            </div>
          </div>
        </div>

        {/* Users */}
        <div className="card p-5">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <UsersIcon className="h-6 w-6 text-indigo-600" />
            </div>
            <div className="ml-5 w-0 flex-1">
              <dl>
                <dt className="text-sm font-medium text-gray-500 truncate">
                  Active Users
                </dt>
                <dd className="text-lg font-medium text-gray-900">
                  {stats?.users.active || '0'}
                </dd>
                <dd className="text-sm text-gray-500">
                  {stats?.users.total || '0'} total
                </dd>
              </dl>
            </div>
          </div>
        </div>
      </div>

      {/* System Status */}
      <div className="mt-8">
        <div className="card">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-lg font-medium leading-6 text-gray-900">
              System Status
            </h3>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {/* System Health */}
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">Health Status</h4>
                <div className="flex items-center">
                  <div className={`h-3 w-3 rounded-full mr-2 ${
                    health?.status === 'healthy' ? 'bg-green-400' :
                    health?.status === 'degraded' ? 'bg-yellow-400' : 'bg-red-400'
                  }`} />
                  <span className="text-sm capitalize text-gray-600">
                    {health?.status || 'Unknown'}
                  </span>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  Database: {health?.checks.database || 'unknown'}<br />
                  Redis: {health?.checks.redis || 'unknown'}<br />
                  DNS: {health?.checks.dns_service || 'unknown'}
                </div>
              </div>

              {/* System Info */}
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">System Info</h4>
                <div className="text-sm text-gray-600">
                  Uptime: {stats?.system.uptime ? formatUptime(stats.system.uptime) : 'N/A'}<br />
                  Memory: {stats?.system.memory ? formatMemory(stats.system.memory.heapUsed) : 'N/A'}<br />
                  Node.js: {stats?.system.node_version || 'N/A'}
                </div>
              </div>

              {/* Quick Actions */}
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">Quick Actions</h4>
                {isAdmin ? (
                  <div className="space-y-2">
                    <button
                      className="btn-outline text-xs py-1 px-2 h-auto"
                      onClick={handleBlocklistRefresh}
                      disabled={blocklistMutation.isPending}
                    >
                    Update Blocklists
                      {blocklistMutation.isPending && '…'}
                    </button>
                    <button
                      className="btn-outline text-xs py-1 px-2 h-auto"
                      onClick={handleClearCache}
                      disabled={clearCacheMutation.isPending}
                    >
                    Clear Cache
                      {clearCacheMutation.isPending && '…'}
                    </button>
                    <button
                      className="btn-outline text-xs py-1 px-2 h-auto"
                      onClick={handleExportConfig}
                      disabled={exportConfigMutation.isPending}
                    >
                    Export Config
                      {exportConfigMutation.isPending && '…'}
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">
                    Sign in as an administrator to run quick maintenance actions.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="mt-8 grid grid-cols-1 gap-8 xl:grid-cols-2">
        <div className="card">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-lg font-medium leading-6 text-gray-900">
              Recent DNS Queries
            </h3>
          </div>
          <div className="p-6">
            {activityLoading ? (
              <div className="flex justify-center py-6">
                <LoadingSpinner size="sm" />
              </div>
            ) : recentDnsQueries.length ? (
              <ul className="divide-y divide-gray-200">
                {recentDnsQueries.map((query, index) => (
                  <li key={`${query.domain}-${query.timestamp}-${index}`} className="py-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{query.domain}</p>
                        <p className="text-xs text-gray-500">{query.client_ip}</p>
                      </div>
                      <div className="text-right">
                        {renderResponseBadge(query.response)}
                        <div className="text-xs text-gray-400 mt-1">
                          {formatDistanceToNow(new Date(query.timestamp), { addSuffix: true })}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">No recent DNS queries recorded.</p>
            )}
          </div>
        </div>

        <div className="card">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-lg font-medium leading-6 text-gray-900">
              Insights
            </h3>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 gap-6">
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">Top Blocked Domains</h4>
                {topBlockedLoading ? (
                  <div className="flex justify-center py-4">
                    <LoadingSpinner size="sm" />
                  </div>
                ) : topBlockedDomains.length ? (
                  <ul className="space-y-2">
                    {topBlockedDomains.map((entry, index) => (
                      <li key={`${entry.domain}-${index}`} className="flex items-center justify-between text-sm text-gray-700">
                        <span className="truncate mr-3">{entry.domain}</span>
                        <span className="text-gray-500">{entry.count.toLocaleString()} blocked</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500">No block events recorded yet.</p>
                )}
              </div>

              {isAdmin && (
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Recent User Activity</h4>
                  {activityLoading ? (
                    <div className="flex justify-center py-4">
                      <LoadingSpinner size="sm" />
                    </div>
                  ) : recentUserActivity.length ? (
                    <ul className="space-y-2">
                      {recentUserActivity.map((entry, index) => (
                        <li key={`${entry.email}-${entry.timestamp}-${index}`} className="flex items-center justify-between text-sm text-gray-700">
                          <div className="truncate mr-3">
                            <span className="font-medium text-gray-900">{entry.name}</span>
                            <span className="text-gray-500 block text-xs">{entry.email}</span>
                          </div>
                          <span className="text-xs text-gray-400">
                            {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-500">No user changes recorded yet.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
