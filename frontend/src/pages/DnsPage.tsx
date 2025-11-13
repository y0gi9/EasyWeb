import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  dnsApi,
  handleApiError
} from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import { PlusIcon, ArrowTopRightOnSquareIcon, TrashIcon } from '@heroicons/react/24/outline';
import type {
  BlockList,
  BlockListForm,
  DnsOverview,
  DnsOverride,
  DnsQuery,
  DnsLocalRecord,
  PaginationInfo
} from '../types';
import { useAuth } from '../contexts/AuthContext';

type TabId = 'overview' | 'queries' | 'records' | 'blocklists' | 'overrides' | 'settings';

interface QueryFilters {
  page: number;
  search: string;
  client: string;
  status: 'all' | 'allowed' | 'blocked' | 'forwarded' | 'cached' | 'local' | 'error';
  cache: 'all' | 'hit' | 'miss';
}

interface OverrideFormState {
  domain: string;
  mode: 'allow' | 'block';
  match_type: 'exact' | 'wildcard';
  enabled: boolean;
  comment: string;
}

interface LocalRecordFormState {
  domain: string;
  record_type: 'A' | 'AAAA' | 'CNAME';
  value: string;
  ttl: string;
  enabled: boolean;
  comment: string;
}

const statusOptions: Array<{ label: string; value: QueryFilters['status'] }> = [
  { label: 'All results', value: 'all' },
  { label: 'Allowed', value: 'allowed' },
  { label: 'Blocked', value: 'blocked' },
  { label: 'Forwarded', value: 'forwarded' },
  { label: 'Cached', value: 'cached' },
  { label: 'Local overrides', value: 'local' },
  { label: 'Errors', value: 'error' },
];

const cacheOptions: Array<{ label: string; value: QueryFilters['cache'] }> = [
  { label: 'All responses', value: 'all' },
  { label: 'Cache hits', value: 'hit' },
  { label: 'Cache misses', value: 'miss' },
];

const defaultBlocklistForm: BlockListForm = {
  name: '',
  url: '',
  enabled: true,
};

const defaultOverrideForm: OverrideFormState = {
  domain: '',
  mode: 'block',
  match_type: 'exact',
  enabled: true,
  comment: ''
};

const defaultRecordForm: LocalRecordFormState = {
  domain: '',
  record_type: 'A',
  value: '',
  ttl: '300',
  enabled: true,
  comment: ''
};

const DnsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const tabs = useMemo(() => {
    const allTabs: Array<{ id: TabId; name: string; adminOnly?: boolean }> = [
      { id: 'overview', name: 'Overview' },
      { id: 'queries', name: 'Queries' },
      { id: 'records', name: 'Local Records', adminOnly: true },
      { id: 'blocklists', name: 'Blocklists', adminOnly: true },
      { id: 'overrides', name: 'Overrides', adminOnly: true },
      { id: 'settings', name: 'Settings', adminOnly: true }
    ];
    return allTabs.filter(tab => !tab.adminOnly || isAdmin);
  }, [isAdmin]);

  const [activeTab, setActiveTab] = useState<TabId>('overview');

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab('overview');
    }
  }, [tabs, activeTab]);

  const [queryFilters, setQueryFilters] = useState<QueryFilters>({
    page: 1,
    search: '',
    client: '',
    status: 'all',
    cache: 'all'
  });
  const [pendingFilters, setPendingFilters] = useState<QueryFilters>(queryFilters);

  const [isBlocklistModalOpen, setBlocklistModalOpen] = useState(false);
  const [editingBlocklist, setEditingBlocklist] = useState<BlockList | null>(null);
  const [blocklistForm, setBlocklistForm] = useState<BlockListForm>(defaultBlocklistForm);

  const [isOverrideModalOpen, setOverrideModalOpen] = useState(false);
  const [editingOverride, setEditingOverride] = useState<DnsOverride | null>(null);
  const [overrideForm, setOverrideForm] = useState<OverrideFormState>(defaultOverrideForm);

  const [isRecordModalOpen, setRecordModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<DnsLocalRecord | null>(null);
  const [recordForm, setRecordForm] = useState<LocalRecordFormState>(defaultRecordForm);

  const [settingsForm, setSettingsForm] = useState({
    upstreams: '',
    cacheEnabled: true,
    cacheMaxTtl: '3600',
    cacheMinTtl: '60',
    cacheMaxItems: '5000',
    resolverTimeout: '2000'
  });

  const overviewQuery = useQuery<DnsOverview>({
    queryKey: ['dns', 'overview'],
    queryFn: dnsApi.getOverview,
    refetchInterval: 30000,
  });

  const queriesQuery = useQuery<{ queries: DnsQuery[]; pagination: PaginationInfo }>({
    queryKey: ['dns', 'queries', queryFilters],
    queryFn: () => dnsApi.getQueries({
      page: queryFilters.page,
      limit: 50,
      search: queryFilters.search || undefined,
      client: queryFilters.client || undefined,
      status: queryFilters.status !== 'all' ? queryFilters.status : undefined,
      cache: queryFilters.cache !== 'all' ? queryFilters.cache : undefined,
    }),
    placeholderData: (previousData) => previousData,
    enabled: activeTab === 'queries'
  });

  const blocklistsQuery = useQuery<BlockList[]>({
    queryKey: ['dns', 'blocklists'],
    queryFn: dnsApi.getBlocklists,
    enabled: activeTab === 'blocklists'
  });

  const overridesQuery = useQuery<DnsOverride[]>({
    queryKey: ['dns', 'overrides'],
    queryFn: () => dnsApi.getOverrides(true),
    enabled: activeTab === 'overrides'
  });

  const localRecordsQuery = useQuery<DnsLocalRecord[]>({
    queryKey: ['dns', 'local-records'],
    queryFn: dnsApi.getLocalRecords,
    enabled: isAdmin && activeTab === 'records'
  });

  const settingsQuery = useQuery<Record<string, string>>({
    queryKey: ['dns', 'settings'],
    queryFn: dnsApi.getSettings,
    staleTime: 60_000,
    enabled: activeTab === 'settings'
  });

  useEffect(() => {
    if (settingsQuery.data) {
      const data = settingsQuery.data;
      setSettingsForm({
        upstreams: data.dns_upstream_servers || '',
        cacheEnabled: (data.dns_cache_enabled ?? 'true') !== 'false',
        cacheMaxTtl: data.dns_cache_max_ttl || '3600',
        cacheMinTtl: data.dns_cache_min_ttl || '60',
        cacheMaxItems: data.dns_cache_max_items || '5000',
        resolverTimeout: data.dns_resolver_timeout_ms || '2000'
      });
    }
  }, [settingsQuery.data]);

  const toggleFilterMutation = useMutation({
    mutationFn: dnsApi.toggleFilter,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dns', 'overview'] });
      toast.success('Filter state updated');
    },
    onError: (err) => toast.error(handleApiError(err))
  });

  const flushCacheMutation = useMutation({
    mutationFn: dnsApi.flushCache,
    onSuccess: () => {
      toast.success('DNS cache flush requested');
      queryClient.invalidateQueries({ queryKey: ['dns', 'overview'] });
    },
    onError: (err) => toast.error(handleApiError(err))
  });

  const reloadBlocklistsMutation = useMutation({
    mutationFn: dnsApi.reloadBlocklists,
    onSuccess: () => {
      toast.success('Blocklist reload requested');
      queryClient.invalidateQueries({ queryKey: ['dns', 'overview'] });
    },
    onError: (err) => toast.error(handleApiError(err))
  });

  const blocklistSaveMutation = useMutation({
    mutationFn: (form: BlockListForm) =>
      editingBlocklist ? dnsApi.updateBlocklist(editingBlocklist.id, form) : dnsApi.addBlocklist(form),
    onSuccess: () => {
      setBlocklistModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['dns', 'blocklists'] });
      queryClient.invalidateQueries({ queryKey: ['dns', 'overview'] });
      toast.success(`Blocklist ${editingBlocklist ? 'updated' : 'added'}`);
    },
    onError: (err) => toast.error(handleApiError(err))
  });

  const blocklistDeleteMutation = useMutation({
    mutationFn: (id: number) => dnsApi.deleteBlocklist(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dns', 'blocklists'] });
      queryClient.invalidateQueries({ queryKey: ['dns', 'overview'] });
      toast.success('Blocklist removed');
    },
    onError: (err) => toast.error(handleApiError(err))
  });

  const blocklistRefreshMutation = useMutation({
    mutationFn: (id: number) => dnsApi.updateBlocklistEntries(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dns', 'overview'] });
      toast.success('Blocklist refresh triggered');
    },
    onError: (err) => toast.error(handleApiError(err))
  });

  const overrideSaveMutation = useMutation({
    mutationFn: (form: OverrideFormState) => {
      const payload = {
        domain: form.domain.trim(),
        mode: form.mode,
        match_type: form.match_type,
        enabled: form.enabled,
        comment: form.comment.trim() || undefined,
      };

      return editingOverride
        ? dnsApi.updateOverride(editingOverride.id, payload)
        : dnsApi.createOverride(payload);
    },
    onSuccess: () => {
      setOverrideModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['dns', 'overrides'] });
      queryClient.invalidateQueries({ queryKey: ['dns', 'overview'] });
      toast.success(`Override ${editingOverride ? 'updated' : 'created'}`);
    },
    onError: (err) => toast.error(handleApiError(err))
  });

  const overrideDeleteMutation = useMutation({
    mutationFn: (id: number) => dnsApi.deleteOverride(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dns', 'overrides'] });
      queryClient.invalidateQueries({ queryKey: ['dns', 'overview'] });
      toast.success('Override removed');
    },
    onError: (err) => toast.error(handleApiError(err))
  });

  const recordSaveMutation = useMutation({
    mutationFn: (form: LocalRecordFormState) => {
      const parsedTtl = Number(form.ttl);
      const ttl = Number.isFinite(parsedTtl) ? parsedTtl : 300;
      const safeTtl = Math.min(86400, Math.max(30, Math.round(ttl)));

      const payload = {
        domain: form.domain.trim().toLowerCase(),
        record_type: form.record_type,
        value: form.value.trim(),
        ttl: safeTtl,
        enabled: form.enabled,
        comment: form.comment.trim() || undefined,
      } as {
        domain: string;
        record_type: 'A' | 'AAAA' | 'CNAME';
        value: string;
        ttl?: number;
        enabled?: boolean;
        comment?: string;
      };

      return editingRecord
        ? dnsApi.updateLocalRecord(editingRecord.id, payload)
        : dnsApi.createLocalRecord(payload);
    },
    onSuccess: () => {
      setRecordModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['dns', 'local-records'] });
      queryClient.invalidateQueries({ queryKey: ['dns', 'overview'] });
      toast.success(`Record ${editingRecord ? 'updated' : 'created'}`);
    },
    onError: (err) => toast.error(handleApiError(err))
  });

  const recordToggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      dnsApi.updateLocalRecord(id, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dns', 'local-records'] });
      queryClient.invalidateQueries({ queryKey: ['dns', 'overview'] });
    },
    onError: (err) => toast.error(handleApiError(err))
  });

  const recordDeleteMutation = useMutation({
    mutationFn: (id: number) => dnsApi.deleteLocalRecord(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dns', 'local-records'] });
      queryClient.invalidateQueries({ queryKey: ['dns', 'overview'] });
      toast.success('Record removed');
    },
    onError: (err) => toast.error(handleApiError(err))
  });

  const updateSettingsMutation = useMutation({
    mutationFn: dnsApi.updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dns', 'settings'] });
      queryClient.invalidateQueries({ queryKey: ['dns', 'overview'] });
      toast.success('DNS settings saved');
    },
    onError: (err) => toast.error(handleApiError(err))
  });

  const deleteQueriesMutation = useMutation({
    mutationFn: dnsApi.deleteQueries,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['dns', 'queries'] });
      queryClient.invalidateQueries({ queryKey: ['dns', 'overview'] });
      toast.success(data.message);
    },
    onError: (err) => toast.error(handleApiError(err))
  });

  const overview = overviewQuery.data;
  const blocklists = useMemo(() => blocklistsQuery.data ?? [], [blocklistsQuery.data]);
  const localRecords = useMemo(() => localRecordsQuery.data ?? [], [localRecordsQuery.data]);
  const overrides = overridesQuery.data || [];
  const queries = queriesQuery.data?.queries || [];
  const pagination = queriesQuery.data?.pagination;

  const filterDisabled = useMemo(() => {
    if (!overview) return false;
    if (!overview.runtime.filter_enabled) return true;
    if (overview.runtime.disabled_until) {
      const until = new Date(overview.runtime.disabled_until);
      return until.getTime() > Date.now();
    }
    return false;
  }, [overview]);

  const disabledUntil = useMemo(() => {
    if (!overview?.runtime.disabled_until) return null;
    const until = new Date(overview.runtime.disabled_until);
    return Number.isNaN(until.getTime()) ? null : until;
  }, [overview]);

  const blocklistStats = useMemo(() => ({
    total: overview?.blocklists.total ?? blocklists.length,
    enabled: overview?.blocklists.enabled ?? blocklists.filter(list => list.enabled).length
  }), [overview, blocklists]);

  const localRecordStats = useMemo(() => ({
    total: overview?.local_records.total ?? localRecords.length,
    enabled: overview?.local_records.enabled ?? localRecords.filter(record => record.enabled).length
  }), [overview, localRecords]);

  const handleBlocklistSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!blocklistForm.name.trim() || !blocklistForm.url.trim()) {
      toast.error('Name and URL are required');
      return;
    }
    blocklistSaveMutation.mutate(blocklistForm);
  };

  const openAddBlocklist = () => {
    if (!isAdmin) {
      toast.error('Administrator access required');
      return;
    }
    setEditingBlocklist(null);
    setBlocklistForm(defaultBlocklistForm);
    setBlocklistModalOpen(true);
  };

  const openEditBlocklist = (blocklist: BlockList) => {
    if (!isAdmin) {
      toast.error('Administrator access required');
      return;
    }
    setEditingBlocklist(blocklist);
    setBlocklistForm({
      name: blocklist.name,
      url: blocklist.url,
      enabled: blocklist.enabled
    });
    setBlocklistModalOpen(true);
  };

  const openAddOverride = () => {
    if (!isAdmin) {
      toast.error('Administrator access required');
      return;
    }
    setEditingOverride(null);
    setOverrideForm(defaultOverrideForm);
    setOverrideModalOpen(true);
  };

  const openEditOverride = (override: DnsOverride) => {
    if (!isAdmin) {
      toast.error('Administrator access required');
      return;
    }
    setEditingOverride(override);
    setOverrideForm({
      domain: override.domain,
      mode: override.mode,
      match_type: override.match_type,
      enabled: override.enabled,
      comment: override.comment || ''
    });
    setOverrideModalOpen(true);
  };

  const openAddRecord = () => {
    if (!isAdmin) {
      toast.error('Administrator access required');
      return;
    }
    setEditingRecord(null);
    setRecordForm(defaultRecordForm);
    setRecordModalOpen(true);
  };

  const openEditRecord = (record: DnsLocalRecord) => {
    if (!isAdmin) {
      toast.error('Administrator access required');
      return;
    }
    setEditingRecord(record);
    setRecordForm({
      domain: record.domain,
      record_type: record.record_type,
      value: record.value,
      ttl: String(record.ttl ?? 300),
      enabled: record.enabled,
      comment: record.comment || ''
    });
    setRecordModalOpen(true);
  };

  const handleOverrideSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!overrideForm.domain.trim()) {
      toast.error('Domain is required');
      return;
    }
    overrideSaveMutation.mutate(overrideForm);
  };

  const handleRecordSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!recordForm.domain.trim()) {
      toast.error('Domain is required');
      return;
    }
    if (!recordForm.value.trim()) {
      toast.error('Record value is required');
      return;
    }
    recordSaveMutation.mutate(recordForm);
  };

  const closeRecordModal = () => {
    setRecordModalOpen(false);
    setEditingRecord(null);
    setRecordForm(defaultRecordForm);
  };

  const toggleRecordEnabled = (record: DnsLocalRecord) => {
    recordToggleMutation.mutate({ id: record.id, enabled: !record.enabled });
  };

  const handleDeleteRecord = (record: DnsLocalRecord) => {
    if (!isAdmin) {
      toast.error('Administrator access required');
      return;
    }
    if (window.confirm(`Delete DNS record for ${record.domain}?`)) {
      recordDeleteMutation.mutate(record.id);
    }
  };

  const applyQueryFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setQueryFilters(prev => ({
      ...pendingFilters,
      page: 1
    }));
  };

  const clearQueryFilters = () => {
    const defaults: QueryFilters = { page: 1, search: '', client: '', status: 'all', cache: 'all' };
    setPendingFilters(defaults);
    setQueryFilters(defaults);
  };

  const handleDeleteQueries = () => {
    if (!isAdmin) {
      toast.error('Administrator access required');
      return;
    }

    if (!window.confirm('Are you sure you want to delete DNS queries? This action cannot be undone.')) {
      return;
    }

    // Apply current filters as deletion criteria
    const deleteParams: any = {};

    if (queryFilters.search) {
      deleteParams.domain = queryFilters.search;
    }

    if (queryFilters.client) {
      deleteParams.client_ip = queryFilters.client;
    }

    if (queryFilters.status && queryFilters.status !== 'all') {
      deleteParams.response = queryFilters.status;
    }

    deleteQueriesMutation.mutate(deleteParams);
  };

  const renderOverviewTab = () => {
    if (overviewQuery.isError) {
      return (
        <div className="p-6">
          <div className="card p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Unable to load DNS overview</h2>
            <p className="text-sm text-gray-500">{handleApiError(overviewQuery.error)}</p>
            <button
              className="btn-primary w-fit"
              onClick={() => overviewQuery.refetch()}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    if (overviewQuery.isLoading || !overview) {
      return (
        <div className="p-6 flex justify-center">
          <LoadingSpinner size="lg" />
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <section className="card p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Filter Status</h2>
              <p className="text-sm text-gray-500">
                {filterDisabled
                  ? disabledUntil
                    ? `Filtering paused until ${disabledUntil.toLocaleString()}`
                    : 'DNS filtering is disabled'
                  : 'DNS filtering is active'}
              </p>
            </div>
            {isAdmin && (
              <div className="flex flex-wrap gap-3">
                <button
                  className="btn-primary"
                  disabled={toggleFilterMutation.isPending}
                  onClick={() => toggleFilterMutation.mutate({ enabled: true })}
                >
                  Enable
                </button>
                <button
                  className="btn-outline"
                  disabled={toggleFilterMutation.isPending}
                  onClick={() => toggleFilterMutation.mutate({ enabled: false })}
                >
                  Disable
                </button>
                <button
                  className="btn-outline"
                  disabled={toggleFilterMutation.isPending}
                  onClick={() => toggleFilterMutation.mutate({ enabled: false, duration_minutes: 5 })}
                >
                  Disable 5m
                </button>
                <button
                  className="btn-outline"
                  disabled={toggleFilterMutation.isPending}
                  onClick={() => toggleFilterMutation.mutate({ enabled: false, duration_minutes: 15 })}
                >
                  Disable 15m
                </button>
                <button
                  className="btn-outline"
                  disabled={flushCacheMutation.isPending}
                  onClick={() => flushCacheMutation.mutate()}
                >
                  {flushCacheMutation.isPending ? 'Flushing…' : 'Flush Cache'}
                </button>
                <button
                  className="btn-outline"
                  disabled={reloadBlocklistsMutation.isPending}
                  onClick={() => reloadBlocklistsMutation.mutate()}
                >
                  {reloadBlocklistsMutation.isPending ? 'Reloading…' : 'Reload Blocklists'}
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatisticCard
            title="Total Queries"
            value={overview.totals.total_queries.toLocaleString()}
            description="Across all time"
          />
          <StatisticCard
            title="Blocked"
            value={overview.totals.blocked_queries.toLocaleString()}
            description={`${overview.totals.blocked_percentage}% of requests`}
          />
          <StatisticCard
            title="Cache Hit Rate"
            value={`${overview.totals.cache_hit_percentage}%`}
            description="Answers served from cache"
          />
          <StatisticCard
            title="Blocklists"
            value={`${blocklistStats.enabled}/${blocklistStats.total}`}
            description="Enabled / total sources"
          />
          <StatisticCard
            title="Local Records"
            value={`${localRecordStats.enabled}/${localRecordStats.total}`}
            description="Active / total overrides"
          />
        </section>

        <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">Top Clients (24h)</h3>
              <button
                className="btn-ghost text-sm"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['dns', 'overview'] })}
              >
                Refresh
              </button>
            </div>
            <div className="space-y-3">
              {overview.top_clients.length === 0 && (
                <p className="text-sm text-gray-500">No recent client activity.</p>
              )}
              {overview.top_clients.map((client) => {
                const blockedRatio = client.query_count
                  ? Math.round((client.blocked_count / client.query_count) * 100)
                  : 0;
                return (
                  <div key={client.client_ip} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-md">
                    <div>
                      <p className="font-medium text-gray-900">{client.client_ip}</p>
                      <p className="text-xs text-gray-500">{client.query_count.toLocaleString()} queries</p>
                    </div>
                    <span className="text-sm text-gray-600">{blockedRatio}% blocked</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">Top Blocked Domains</h3>
              <button
                className="btn-ghost text-sm"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['dns', 'overview'] })}
              >
                Refresh
              </button>
            </div>
            <div className="space-y-3">
              {overview.top_blocked_domains.length === 0 && (
                <p className="text-sm text-gray-500">No domains blocked in the last 24 hours.</p>
              )}
              {overview.top_blocked_domains.map((domain) => (
                <div key={domain.domain} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-md">
                  <span className="font-medium text-gray-900">{domain.domain}</span>
                  <span className="text-sm text-gray-600">{domain.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">Top Allowed Domains</h3>
              <button
                className="btn-ghost text-sm"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['dns', 'overview'] })}
              >
                Refresh
              </button>
            </div>
            <div className="space-y-3">
              {overview.top_allowed_domains.length === 0 && (
                <p className="text-sm text-gray-500">No domains resolved locally or forwarded in the last 24 hours.</p>
              )}
              {overview.top_allowed_domains.map((domain) => (
                <div key={domain.domain} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded-md">
                  <span className="font-medium text-gray-900">{domain.domain}</span>
                  <span className="text-sm text-gray-600">{domain.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    );
  };

  const renderQueriesTab = () => {
    if (queriesQuery.isLoading) {
      return (
        <div className="p-6 flex justify-center">
          <LoadingSpinner size="lg" />
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <form className="card p-6" onSubmit={applyQueryFilters}>
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Search domain</label>
              <div className="mt-1">
                <input
                  type="text"
                  className="input"
                  value={pendingFilters.search}
                  onChange={(event) => setPendingFilters(prev => ({ ...prev, search: event.target.value }))}
                  placeholder="example.com"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Client IP</label>
              <div className="mt-1">
                <input
                  type="text"
                  className="input"
                  value={pendingFilters.client}
                  onChange={(event) => setPendingFilters(prev => ({ ...prev, client: event.target.value }))}
                  placeholder="192.168.1.10"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Result</label>
              <div className="mt-1">
                <select
                  className="input"
                  value={pendingFilters.status}
                  onChange={(event) => setPendingFilters(prev => ({ ...prev, status: event.target.value as QueryFilters['status'] }))}
                >
                  {statusOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Cache</label>
              <div className="mt-1">
                <select
                  className="input"
                  value={pendingFilters.cache}
                  onChange={(event) => setPendingFilters(prev => ({ ...prev, cache: event.target.value as QueryFilters['cache'] }))}
                >
                  {cacheOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button type="submit" className="btn-primary" disabled={queriesQuery.isFetching}>
              {queriesQuery.isFetching ? 'Filtering…' : 'Apply filters'}
            </button>
            <button type="button" className="btn-ghost" onClick={clearQueryFilters}>Reset</button>
          </div>
        </form>

        <div className="card">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">Recent Queries</h3>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <button
                  className="btn-ghost text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
                  onClick={handleDeleteQueries}
                  disabled={queries.length === 0 || deleteQueriesMutation.isPending}
                >
                  <TrashIcon className="w-4 h-4 mr-1 inline" />
                  Delete
                </button>
              )}
              <button
                className="btn-ghost text-sm"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['dns', 'queries'] })}
              >
                Refresh
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            {queries.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500">No queries match the current filters.</div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Domain</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Result</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reason</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Upstream</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Latency</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cache</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200 text-sm text-gray-800">
                  {queries.map((query) => (
                    <tr key={`${query.id}-${query.timestamp}`}>
                      <td className="px-4 py-2 whitespace-nowrap text-gray-500">
                        {new Date(query.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap font-medium text-gray-900">
                        {query.domain}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-gray-600">
                        {query.client_ip}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-gray-600">{query.query_type}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className={`inline-flex rounded-full px-2 text-xs font-semibold ${getResponseBadgeClass(query.response)}`}>
                          {query.response.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-gray-600">
                        {query.reason || '—'}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-gray-600">
                        {query.upstream || '—'}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-gray-600">
                        {query.response_time != null ? `${query.response_time} ms` : '—'}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-gray-600">
                        {query.cache_hit ? 'Hit' : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {pagination && pagination.pages > 1 && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-sm">
              <div>
                Page {pagination.page} of {pagination.pages}
              </div>
              <div className="space-x-2">
                <button
                  className="btn-ghost"
                  disabled={pagination.page <= 1}
                  onClick={() => setQueryFilters(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                >
                  Previous
                </button>
                <button
                  className="btn-ghost"
                  disabled={pagination.page >= pagination.pages}
                  onClick={() => setQueryFilters(prev => ({ ...prev, page: Math.min(pagination.pages, prev.page + 1) }))}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderRecordsTab = () => {
    if (!isAdmin) {
      return (
        <div className="p-6">
          <div className="card p-6">
            <p className="text-sm text-gray-600">Administrator access is required to manage local DNS records.</p>
          </div>
        </div>
      );
    }

    if (localRecordsQuery.isLoading) {
      return (
        <div className="p-6 flex justify-center">
          <LoadingSpinner size="lg" />
        </div>
      );
    }

    if (localRecordsQuery.isError) {
      return (
        <div className="p-6">
          <div className="card p-6 space-y-3">
            <h3 className="text-lg font-semibold text-gray-900">Unable to load local DNS records</h3>
            <p className="text-sm text-gray-500">{handleApiError(localRecordsQuery.error)}</p>
            <button className="btn-primary w-fit" onClick={() => localRecordsQuery.refetch()}>Retry</button>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="card p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Local DNS Records</h3>
              <p className="text-sm text-gray-500">Define static responses before queries reach upstream resolvers.</p>
            </div>
            <button className="btn-primary self-start" onClick={openAddRecord}>
              <PlusIcon className="h-4 w-4" aria-hidden="true" />
              <span className="ml-2">Add record</span>
            </button>
          </div>

          <div className="mt-6 overflow-x-auto">
            {localRecords.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500">No local records defined yet.</div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200 text-sm text-gray-800">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium uppercase tracking-wider text-xs text-gray-500">Domain</th>
                    <th className="px-4 py-2 text-left font-medium uppercase tracking-wider text-xs text-gray-500">Type</th>
                    <th className="px-4 py-2 text-left font-medium uppercase tracking-wider text-xs text-gray-500">Value</th>
                    <th className="px-4 py-2 text-left font-medium uppercase tracking-wider text-xs text-gray-500">TTL</th>
                    <th className="px-4 py-2 text-left font-medium uppercase tracking-wider text-xs text-gray-500">Status</th>
                    <th className="px-4 py-2 text-left font-medium uppercase tracking-wider text-xs text-gray-500">Comment</th>
                    <th className="px-4 py-2 text-right font-medium uppercase tracking-wider text-xs text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {localRecords.map((record) => (
                    <tr key={record.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{record.domain}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{record.record_type}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{record.value}</td>
                      <td className="px-4 py-3 text-gray-600">{record.ttl}s</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 text-xs font-semibold ${record.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                          {record.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{record.comment || '—'}</td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <button
                          className="btn-ghost text-sm"
                          onClick={() => openEditRecord(record)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn-ghost text-sm"
                          disabled={recordToggleMutation.isPending}
                          onClick={() => toggleRecordEnabled(record)}
                        >
                          {record.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          className="btn-ghost text-sm text-red-600"
                          disabled={recordDeleteMutation.isPending}
                          onClick={() => handleDeleteRecord(record)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderBlocklistsTab = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Blocklists</h2>
          <p className="text-sm text-gray-500">Manage remote blocklist sources used for DNS filtering.</p>
        </div>
        {isAdmin && (
          <button className="btn-primary" onClick={openAddBlocklist}>
            <PlusIcon className="h-4 w-4 mr-2" /> Add blocklist
          </button>
        )}
      </div>

      <div className="card">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {blocklistStats.enabled} of {blocklistStats.total} blocklists enabled
          </div>
          {isAdmin && (
            <button
              className="btn-ghost text-sm"
              disabled={reloadBlocklistsMutation.isPending}
              onClick={() => reloadBlocklistsMutation.mutate()}
            >
              {reloadBlocklistsMutation.isPending ? 'Reloading…' : 'Reload All'}
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          {blocklistsQuery.isLoading ? (
            <div className="p-6 flex justify-center"><LoadingSpinner /></div>
          ) : blocklists.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">No blocklists configured.</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">URL</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200 text-sm">
                {blocklists.map((blocklist) => (
                  <tr key={blocklist.id}>
                    <td className="px-4 py-2 font-medium text-gray-900">{blocklist.name}</td>
                    <td className="px-4 py-2 text-gray-600 max-w-xs truncate">
                      <a href={blocklist.url} target="_blank" rel="noreferrer" className="inline-flex items-center text-blue-600 hover:text-blue-500">
                        {blocklist.url}
                        <ArrowTopRightOnSquareIcon className="h-4 w-4 ml-1" />
                      </a>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex rounded-full px-2 text-xs font-semibold ${blocklist.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                        {blocklist.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right space-x-3">
                      {isAdmin && (
                        <>
                          <button
                            className="text-blue-600 hover:text-blue-800"
                            onClick={() => blocklistRefreshMutation.mutate(blocklist.id)}
                          >
                            Refresh
                          </button>
                          <button
                            className="text-gray-600 hover:text-gray-900"
                            onClick={() => openEditBlocklist(blocklist)}
                          >
                            Edit
                          </button>
                          <button
                            className="text-red-600 hover:text-red-800"
                            onClick={() => {
                              if (window.confirm(`Delete blocklist ${blocklist.name}?`)) {
                                blocklistDeleteMutation.mutate(blocklist.id);
                              }
                            }}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );

  const renderOverridesTab = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Overrides</h2>
          <p className="text-sm text-gray-500">Create explicit allow or block rules that take precedence over blocklists.</p>
        </div>
        {isAdmin && (
          <button className="btn-primary" onClick={openAddOverride}>
            <PlusIcon className="h-4 w-4 mr-2" /> Add override
          </button>
        )}
      </div>
      <div className="card">
        <div className="p-4 border-b border-gray-200">
          <p className="text-sm text-gray-600">Overrides are evaluated before blocklists. Allow rules always win over block rules.</p>
        </div>
        <div className="overflow-x-auto">
          {overridesQuery.isLoading ? (
            <div className="p-6 flex justify-center"><LoadingSpinner /></div>
          ) : overrides.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">No custom overrides configured.</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Domain</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mode</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Match</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Comment</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200 text-sm">
                {overrides.map((override) => (
                  <tr key={override.id}>
                    <td className="px-4 py-2 font-medium text-gray-900">{override.domain}</td>
                    <td className="px-4 py-2 text-gray-600 capitalize">{override.mode}</td>
                    <td className="px-4 py-2 text-gray-600 capitalize">{override.match_type}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex rounded-full px-2 text-xs font-semibold ${override.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                        {override.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-600 max-w-sm truncate">{override.comment || '—'}</td>
                    <td className="px-4 py-2 text-right space-x-3">
                      {isAdmin && (
                        <>
                          <button
                            className="text-gray-600 hover:text-gray-900"
                            onClick={() => openEditOverride(override)}
                          >
                            Edit
                          </button>
                          <button
                            className="text-red-600 hover:text-red-800"
                            onClick={() => {
                              if (window.confirm(`Delete override for ${override.domain}?`)) {
                                overrideDeleteMutation.mutate(override.id);
                              }
                            }}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );

  const renderSettingsTab = () => {
    if (settingsQuery.isLoading) {
      return (
        <div className="p-6 flex justify-center">
          <LoadingSpinner size="lg" />
        </div>
      );
    }

    const settings = settingsQuery.data || {};

    const handleSubmit = (event: React.FormEvent) => {
      event.preventDefault();
      if (!isAdmin) {
        toast.error('Administrator access required');
        return;
      }

      updateSettingsMutation.mutate({
        dns_upstream_servers: settingsForm.upstreams,
        dns_cache_enabled: settingsForm.cacheEnabled ? 'true' : 'false',
        dns_cache_max_ttl: settingsForm.cacheMaxTtl,
        dns_cache_min_ttl: settingsForm.cacheMinTtl,
        dns_cache_max_items: settingsForm.cacheMaxItems,
        dns_resolver_timeout_ms: settingsForm.resolverTimeout,
        dns_port: settings.dns_port || '53',
        blocklist_update_interval: settings.blocklist_update_interval || '24',
        log_retention_days: settings.log_retention_days || '30'
      });
    };

    return (
      <div className="card p-6 max-w-3xl">
        <h2 className="text-2xl font-semibold text-gray-900 mb-6">DNS settings</h2>
        <form className="space-y-6" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-medium text-gray-700">Upstream DNS servers</label>
            <p className="text-xs text-gray-500">Comma-separated list of upstream resolvers used when forwarding queries.</p>
            <textarea
              className="input mt-1"
              rows={2}
              value={settingsForm.upstreams}
              onChange={(event) => setSettingsForm(prev => ({ ...prev, upstreams: event.target.value }))}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">Resolver timeout (ms)</label>
              <input
                type="number"
                className="input mt-1"
                value={settingsForm.resolverTimeout}
                min={100}
                onChange={(event) => setSettingsForm(prev => ({ ...prev, resolverTimeout: event.target.value }))}
              />
            </div>
            <div>
              <label className="flex items-center space-x-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                  checked={settingsForm.cacheEnabled}
                  onChange={(event) => setSettingsForm(prev => ({ ...prev, cacheEnabled: event.target.checked }))}
                />
                <span>Enable response cache</span>
              </label>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">Cache max TTL (seconds)</label>
              <input
                type="number"
                className="input mt-1"
                min={60}
                value={settingsForm.cacheMaxTtl}
                onChange={(event) => setSettingsForm(prev => ({ ...prev, cacheMaxTtl: event.target.value }))}
                disabled={!settingsForm.cacheEnabled}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Cache min TTL (seconds)</label>
              <input
                type="number"
                className="input mt-1"
                min={0}
                value={settingsForm.cacheMinTtl}
                onChange={(event) => setSettingsForm(prev => ({ ...prev, cacheMinTtl: event.target.value }))}
                disabled={!settingsForm.cacheEnabled}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Cache size (entries)</label>
              <input
                type="number"
                className="input mt-1"
                min={100}
                value={settingsForm.cacheMaxItems}
                onChange={(event) => setSettingsForm(prev => ({ ...prev, cacheMaxItems: event.target.value }))}
                disabled={!settingsForm.cacheEnabled}
              />
            </div>
          </div>

          <div className="flex justify-end space-x-3">
            <button type="submit" className="btn-primary" disabled={updateSettingsMutation.isPending}>
              {updateSettingsMutation.isPending ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="pb-5 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold leading-6 text-gray-900">DNS Filtering</h1>
          <p className="mt-2 max-w-3xl text-sm text-gray-500">
            Monitor and control the EasyWeb DNS resolver. Block advertising domains, inspect query activity, and manage overrides.
          </p>
        </div>
      </div>

      <nav className="mt-6 flex space-x-8" aria-label="Tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.name}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {activeTab === 'overview' && renderOverviewTab()}
        {activeTab === 'queries' && renderQueriesTab()}
        {activeTab === 'records' && renderRecordsTab()}
        {activeTab === 'blocklists' && renderBlocklistsTab()}
        {activeTab === 'overrides' && renderOverridesTab()}
        {activeTab === 'settings' && renderSettingsTab()}
      </div>

      {isBlocklistModalOpen && (
        <Modal title={editingBlocklist ? 'Edit blocklist' : 'Add blocklist'} onClose={() => setBlocklistModalOpen(false)}>
          <form className="space-y-4" onSubmit={handleBlocklistSubmit}>
            <div>
              <label className="block text-sm font-medium text-gray-700">Name</label>
              <input
                type="text"
                className="input mt-1"
                value={blocklistForm.name}
                onChange={(event) => setBlocklistForm(prev => ({ ...prev, name: event.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">URL</label>
              <input
                type="url"
                className="input mt-1"
                value={blocklistForm.url}
                onChange={(event) => setBlocklistForm(prev => ({ ...prev, url: event.target.value }))}
                required
              />
            </div>
            <label className="inline-flex items-center text-sm text-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4 text-blue-600 border-gray-300 rounded mr-2"
                checked={blocklistForm.enabled}
                onChange={(event) => setBlocklistForm(prev => ({ ...prev, enabled: event.target.checked }))}
              />
              Enable blocklist
            </label>
            <div className="flex justify-end space-x-3">
              <button type="button" className="btn-ghost" onClick={() => setBlocklistModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={blocklistSaveMutation.isPending}>
                {blocklistSaveMutation.isPending ? 'Saving…' : editingBlocklist ? 'Save changes' : 'Add blocklist'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {isOverrideModalOpen && (
        <Modal title={editingOverride ? 'Edit override' : 'Add override'} onClose={() => setOverrideModalOpen(false)}>
          <form className="space-y-4" onSubmit={handleOverrideSubmit}>
            <div>
              <label className="block text-sm font-medium text-gray-700">Domain</label>
              <input
                type="text"
                className="input mt-1"
                value={overrideForm.domain}
                onChange={(event) => setOverrideForm(prev => ({ ...prev, domain: event.target.value }))}
                required
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Mode</label>
                <select
                  className="input mt-1"
                  value={overrideForm.mode}
                  onChange={(event) => setOverrideForm(prev => ({ ...prev, mode: event.target.value as 'allow' | 'block' }))}
                >
                  <option value="allow">Allow</option>
                  <option value="block">Block</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Match type</label>
                <select
                  className="input mt-1"
                  value={overrideForm.match_type}
                  onChange={(event) => setOverrideForm(prev => ({ ...prev, match_type: event.target.value as 'exact' | 'wildcard' }))}
                >
                  <option value="exact">Exact domain</option>
                  <option value="wildcard">Wildcard (*.domain.com)</option>
                </select>
              </div>
            </div>
            <label className="inline-flex items-center text-sm text-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4 text-blue-600 border-gray-300 rounded mr-2"
                checked={overrideForm.enabled}
                onChange={(event) => setOverrideForm(prev => ({ ...prev, enabled: event.target.checked }))}
              />
              Enabled
            </label>
            <div>
              <label className="block text-sm font-medium text-gray-700">Comment</label>
              <textarea
                className="input mt-1"
                rows={2}
                value={overrideForm.comment}
                onChange={(event) => setOverrideForm(prev => ({ ...prev, comment: event.target.value }))}
              />
            </div>
            <div className="flex justify-end space-x-3">
              <button type="button" className="btn-ghost" onClick={() => setOverrideModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={overrideSaveMutation.isPending}>
                {overrideSaveMutation.isPending ? 'Saving…' : editingOverride ? 'Save changes' : 'Add override'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {isRecordModalOpen && (
        <Modal title={editingRecord ? 'Edit DNS Record' : 'Add DNS Record'} onClose={closeRecordModal}>
          <form className="space-y-4" onSubmit={handleRecordSubmit}>
            <div>
              <label className="block text-sm font-medium text-gray-700">Domain</label>
              <input
                type="text"
                className="input mt-1"
                value={recordForm.domain}
                onChange={(event) => setRecordForm(prev => ({ ...prev, domain: event.target.value }))}
                placeholder="example.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Record Type</label>
              <select
                className="input mt-1"
                value={recordForm.record_type}
                onChange={(event) => setRecordForm(prev => ({ ...prev, record_type: event.target.value as 'A' | 'AAAA' | 'CNAME' }))}
              >
                <option value="A">A (IPv4 Address)</option>
                <option value="AAAA">AAAA (IPv6 Address)</option>
                <option value="CNAME">CNAME (Canonical Name)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Value</label>
              <input
                type="text"
                className="input mt-1"
                value={recordForm.value}
                onChange={(event) => setRecordForm(prev => ({ ...prev, value: event.target.value }))}
                placeholder={recordForm.record_type === 'A' ? '192.168.1.1' : recordForm.record_type === 'AAAA' ? '2001:db8::1' : 'target.example.com'}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">TTL (seconds)</label>
              <input
                type="number"
                className="input mt-1"
                value={recordForm.ttl}
                onChange={(event) => setRecordForm(prev => ({ ...prev, ttl: event.target.value }))}
                min="30"
                max="86400"
                placeholder="300"
              />
            </div>
            <label className="inline-flex items-center text-sm text-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4 text-blue-600 border-gray-300 rounded mr-2"
                checked={recordForm.enabled}
                onChange={(event) => setRecordForm(prev => ({ ...prev, enabled: event.target.checked }))}
              />
              Enabled
            </label>
            <div>
              <label className="block text-sm font-medium text-gray-700">Comment</label>
              <textarea
                className="input mt-1"
                rows={2}
                value={recordForm.comment}
                onChange={(event) => setRecordForm(prev => ({ ...prev, comment: event.target.value }))}
                placeholder="Optional comment"
              />
            </div>
            <div className="flex justify-end space-x-3">
              <button type="button" className="btn-ghost" onClick={closeRecordModal}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={recordSaveMutation.isPending}>
                {recordSaveMutation.isPending ? 'Saving…' : editingRecord ? 'Save changes' : 'Add record'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};

const StatisticCard: React.FC<{ title: string; value: string; description: string }> = ({ title, value, description }) => (
  <div className="card p-6">
    <p className="text-sm text-gray-500">{title}</p>
    <p className="mt-2 text-3xl font-semibold text-gray-900">{value}</p>
    <p className="text-xs text-gray-500 mt-1">{description}</p>
  </div>
);

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-50 p-4">
    <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900">{title}</h3>
        <button className="text-gray-400 hover:text-gray-600" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="px-6 py-5">
        {children}
      </div>
    </div>
  </div>
);

function getResponseBadgeClass(response: DnsQuery['response']) {
  switch (response) {
    case 'blocked':
      return 'bg-red-100 text-red-800';
    case 'cached':
      return 'bg-indigo-100 text-indigo-800';
    case 'forwarded':
      return 'bg-blue-100 text-blue-800';
    case 'error':
      return 'bg-yellow-100 text-yellow-800';
    default:
      return 'bg-green-100 text-green-800';
  }
}

export default DnsPage;
