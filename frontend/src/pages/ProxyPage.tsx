import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  proxyApi,
  handleApiError
} from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import { PlusIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import type { ProxyUpstream, ProxyUpstreamForm, ProxyNginxConfig, ProxyAuthCustomization } from '../types';
import { useAuth } from '../contexts/AuthContext';

type CustomizationFormState = {
  headerImageUrl: string;
  logoUrl: string;
  headline: string;
  bodyText: string;
  fontFamily: string;
};

const createEmptyCustomizationForm = (): CustomizationFormState => ({
  headerImageUrl: '',
  logoUrl: '',
  headline: '',
  bodyText: '',
  fontFamily: '',
});

const ProxyPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'upstreams' | 'config' | 'settings'>('upstreams');
  const [isUpstreamModalOpen, setUpstreamModalOpen] = useState(false);
  const [editingUpstream, setEditingUpstream] = useState<ProxyUpstream | null>(null);
  const [importing, setImporting] = useState(false);
  const [replaceImport, setReplaceImport] = useState(false);
  const [upstreamForm, setUpstreamForm] = useState<ProxyUpstreamForm>({
    name: '',
    path: '/service',
    target_url: 'http://',
    enabled: true,
    auth_required: true,
    headers: undefined,
    domains: [],
    allowed_emails: [],
    preserve_host: false,
  });
  const [headersInput, setHeadersInput] = useState('');
  const [domainsInput, setDomainsInput] = useState('');
  const [allowedEmailsInput, setAllowedEmailsInput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isCustomizeModalOpen, setCustomizeModalOpen] = useState(false);
  const [customizingUpstream, setCustomizingUpstream] = useState<ProxyUpstream | null>(null);
  const [customizationForm, setCustomizationForm] = useState<CustomizationFormState>(createEmptyCustomizationForm);

  const resolvedTargetHost = useMemo(() => {
    try {
      return new URL(upstreamForm.target_url).host || 'target host';
    } catch (error) {
      return 'target host';
    }
  }, [upstreamForm.target_url]);

  const domainList = useMemo(() => normalizeDomainInput(domainsInput), [domainsInput]);
  const firstCustomDomain = domainList[0];
  const baseOrigin = useMemo(() => (typeof window !== 'undefined' ? window.location.origin : ''), []);
  const baseHostname = useMemo(() => {
    try {
      return baseOrigin ? new URL(baseOrigin).hostname : '';
    } catch (error) {
      return '';
    }
  }, [baseOrigin]);
  const isLocalTarget = useMemo(() => {
    try {
      const hostname = new URL(upstreamForm.target_url).hostname.toLowerCase();
      return ['localhost', '127.0.0.1', '::1'].includes(hostname);
    } catch (error) {
      return false;
    }
  }, [upstreamForm.target_url]);

  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const { data: upstreams, isLoading: upstreamsLoading } = useQuery({
    queryKey: ['proxy', 'upstreams'],
    queryFn: proxyApi.getUpstreams,
  });

  const { data: stats } = useQuery({
    queryKey: ['proxy', 'stats'],
    queryFn: proxyApi.getStats,
    refetchInterval: 30000,
  });

  const { data: nginxConfig, isLoading: nginxConfigLoading, refetch: refetchNginxConfig } = useQuery<ProxyNginxConfig>({
    queryKey: ['proxy', 'nginx-config'],
    queryFn: proxyApi.getNginxConfig,
    enabled: isAdmin && activeTab === 'config',
  });

  const pathInSync = nginxConfig?.in_sync?.path ?? true;
  const domainInSync = nginxConfig?.in_sync?.domain ?? true;
  const rootInSync = nginxConfig?.in_sync?.root ?? true;

  const upstreamsSorted = useMemo(() => (upstreams || []).slice().sort((a, b) => a.path.localeCompare(b.path)), [upstreams]);

  const refetchUpstreams = () => {
    queryClient.invalidateQueries({ queryKey: ['proxy', 'upstreams'] });
    queryClient.invalidateQueries({ queryKey: ['proxy', 'stats'] });
    refetchNginxConfig();
  };

  const closeCustomizeModal = () => {
    setCustomizeModalOpen(false);
    setCustomizingUpstream(null);
    setCustomizationForm(createEmptyCustomizationForm());
  };

  const addUpstreamMutation = useMutation({
    mutationFn: (form: ProxyUpstreamForm) => proxyApi.addUpstream(form),
    onSuccess: () => {
      toast.success('Upstream added');
      setUpstreamModalOpen(false);
      refetchUpstreams();
    },
    onError: (err) => toast.error(handleApiError(err)),
  });

  const updateUpstreamMutation = useMutation({
    mutationFn: ({ id, form }: { id: number; form: Partial<ProxyUpstreamForm> }) => proxyApi.updateUpstream(id, form),
    onSuccess: () => {
      toast.success('Upstream updated');
      setUpstreamModalOpen(false);
      refetchUpstreams();
    },
    onError: (err) => toast.error(handleApiError(err)),
  });

  const deleteUpstreamMutation = useMutation({
    mutationFn: (id: number) => proxyApi.deleteUpstream(id),
    onSuccess: () => {
      toast.success('Upstream deleted');
      refetchUpstreams();
    },
    onError: (err) => toast.error(handleApiError(err)),
  });

  const testUpstreamMutation = useMutation({
    mutationFn: (id: number) => proxyApi.testUpstream(id),
    onSuccess: (result) => {
      if (result.status === 'success') {
        toast.success(`Upstream reachable (${result.response_code}) – ${result.response_time}ms`);
      } else {
        toast.error(`Test failed: ${result.message}`);
      }
    },
    onError: (err) => toast.error(handleApiError(err)),
  });

  const exportConfigMutation = useMutation({
    mutationFn: proxyApi.exportConfig,
    onSuccess: (blob) => {
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `easyweb-proxy-config-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('Configuration exported');
    },
    onError: (err) => toast.error(handleApiError(err)),
  });

  const reloadNginxMutation = useMutation({
    mutationFn: () => proxyApi.reloadNginx(),
    onSuccess: (result) => {
      if (result.reloaded) {
        toast.success(result.message || 'Nginx reloaded');
      } else {
        toast(result.message || 'Reload skipped', { icon: 'ℹ️' });
      }
      refetchNginxConfig();
    },
    onError: (err) => toast.error(handleApiError(err)),
  });

  const importConfigMutation = useMutation({
    mutationFn: ({ upstreams, replace }: { upstreams: ProxyUpstreamForm[]; replace: boolean }) =>
      proxyApi.importConfig({ upstreams, replace }),
    onSuccess: (res) => {
      toast.success(res.message || 'Import completed');
      refetchUpstreams();
      setImporting(false);
    },
    onError: (err) => {
      toast.error(handleApiError(err));
      setImporting(false);
    },
  });

  const updateCustomizationMutation = useMutation({
    mutationFn: ({ id, customization }: { id: number; customization: ProxyAuthCustomization | null }) =>
      proxyApi.updateUpstream(id, { auth_customization: customization }),
    onSuccess: () => {
      toast.success('Login experience updated');
      closeCustomizeModal();
      refetchUpstreams();
    },
    onError: (err) => toast.error(handleApiError(err)),
  });

  const openAddUpstream = () => {
    setEditingUpstream(null);
    setUpstreamForm({
      name: '',
      path: '/service',
      target_url: 'http://',
      enabled: true,
      auth_required: true,
      headers: undefined,
      domains: [],
      allowed_emails: [],
      preserve_host: false,
    });
    setHeadersInput('');
    setDomainsInput('');
    setAllowedEmailsInput('');
    setShowAdvanced(false);
    setUpstreamModalOpen(true);
  };

  const openCustomizeUpstream = (upstream: ProxyUpstream) => {
    setCustomizingUpstream(upstream);
    const customization = upstream.auth_customization || null;
    setCustomizationForm({
      headerImageUrl: customization?.headerImageUrl || '',
      logoUrl: customization?.logoUrl || '',
      headline: customization?.headline || '',
      bodyText: customization?.bodyText || '',
      fontFamily: customization?.fontFamily || '',
    });
    setCustomizeModalOpen(true);
  };

  function normalizeDomainInput(value: string): string[] {
    return value
      .split(/[,\s]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }

  function normalizeEmailInput(value: string): string[] {
    return value
      .split(/[,\s]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }

  const handleCustomizationSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!customizingUpstream) {
      return;
    }

    if (!isAdmin) {
      toast.error('Administrator access required');
      return;
    }

    const trimmedEntries = (Object.entries(customizationForm) as Array<[
      keyof CustomizationFormState,
      string
    ]>)
      .map(([key, value]) => [key, value.trim()] as const)
      .filter(([, value]) => value.length > 0);

    const customizationPayload = trimmedEntries.length > 0
      ? trimmedEntries.reduce((acc, [key, value]) => ({
        ...acc,
        [key]: value,
      }), {} as ProxyAuthCustomization)
      : null;

    updateCustomizationMutation.mutate({
      id: customizingUpstream.id,
      customization: customizationPayload,
    });
  };

  const openEditUpstream = (upstream: ProxyUpstream) => {
    setEditingUpstream(upstream);
    setUpstreamForm({
      name: upstream.name,
      path: upstream.path,
      target_url: upstream.target_url,
      enabled: upstream.enabled,
      auth_required: upstream.auth_required,
      headers: upstream.headers || undefined,
      domains: upstream.domains,
      allowed_emails: upstream.allowed_emails,
      preserve_host: upstream.preserve_host,
    });
    setHeadersInput(upstream.headers ? JSON.stringify(upstream.headers, null, 2) : '');
    setDomainsInput(upstream.domains.length > 0 ? upstream.domains.join(', ') : '');
    setAllowedEmailsInput(upstream.allowed_emails.length > 0 ? upstream.allowed_emails.join(', ') : '');
    setShowAdvanced(Boolean(upstream.headers || upstream.domains.length > 0 || upstream.allowed_emails.length > 0 || upstream.preserve_host));
    setUpstreamModalOpen(true);
  };

  const handleUpstreamSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const hasDomains = domainList.length > 0;
    const hasPath = upstreamForm.path.trim();

    if (!upstreamForm.name.trim() || !upstreamForm.target_url.trim()) {
      toast.error('Name and target URL are required');
      return;
    }

    if (!hasDomains && !hasPath) {
      toast.error('Either path or domains must be specified');
      return;
    }

    if (hasPath && !upstreamForm.path.startsWith('/')) {
      toast.error('Path must start with /');
      return;
    }

    let headersObj: Record<string, string> | undefined = undefined;
    if (headersInput.trim()) {
      try {
        const parsed = JSON.parse(headersInput);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          headersObj = parsed;
        } else {
          toast.error('Headers must be a JSON object');
          return;
        }
      } catch (err) {
        toast.error('Invalid headers JSON');
        return;
      }
    }

    const domainsList = domainList;
    const emailsList = normalizeEmailInput(allowedEmailsInput);

    const payload: ProxyUpstreamForm = {
      ...upstreamForm,
      headers: headersObj,
      domains: domainsList,
      allowed_emails: emailsList,
      preserve_host: Boolean(upstreamForm.preserve_host),
    };

    if (editingUpstream) {
      updateUpstreamMutation.mutate({ id: editingUpstream.id, form: payload });
    } else {
      addUpstreamMutation.mutate(payload);
    }
  };

  const handleDeleteUpstream = (upstream: ProxyUpstream) => {
    if (window.confirm(`Delete upstream ${upstream.name}?`)) {
      deleteUpstreamMutation.mutate(upstream.id);
    }
  };

  const handleTestUpstream = (upstream: ProxyUpstream) => {
    testUpstreamMutation.mutate(upstream.id);
  };

  const handleExportConfig = () => {
    if (!isAdmin) {
      toast.error('Administrator access required');
      return;
    }
    exportConfigMutation.mutate();
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setImporting(true);
      const text = await file.text();
      const json = JSON.parse(text);
      const upstreamsToImport = Array.isArray(json.upstreams) ? json.upstreams : json;
      importConfigMutation.mutate({ upstreams: upstreamsToImport, replace: replaceImport });
    } catch (err) {
      setImporting(false);
      toast.error('Failed to read configuration file');
    } finally {
      event.target.value = '';
    }
  };

  const handleReloadNginx = () => {
    if (!isAdmin) {
      toast.error('Administrator access required');
      return;
    }
    reloadNginxMutation.mutate();
  };

  const tabs = [
    { id: 'upstreams', name: 'Upstreams', count: upstreamsSorted.length },
    { id: 'config', name: 'Configuration', count: null },
    { id: 'settings', name: 'Settings', count: null },
  ];

  const savingUpstream = addUpstreamMutation.isPending || updateUpstreamMutation.isPending;
  const customizationSaving = updateCustomizationMutation.isPending;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="pb-5 border-b border-gray-200">
        <h1 className="text-3xl font-bold leading-6 text-gray-900">Proxy Management</h1>
        <p className="mt-2 max-w-4xl text-sm text-gray-500">
          Configure reverse proxy upstreams and routing
        </p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="card p-5">
            <div className="text-sm font-medium text-gray-500">Total Upstreams</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">
              {stats.total_upstreams}
            </div>
          </div>
          <div className="card p-5">
            <div className="text-sm font-medium text-gray-500">Enabled</div>
            <div className="mt-1 text-2xl font-semibold text-green-600">
              {stats.enabled_upstreams}
            </div>
          </div>
          <div className="card p-5">
            <div className="text-sm font-medium text-gray-500">Disabled</div>
            <div className="mt-1 text-2xl font-semibold text-red-600">
              {stats.disabled_upstreams}
            </div>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="mt-6">
        <nav className="flex space-x-8" aria-label="Tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.name}
              {tab.count !== null && (
                <span className={`ml-2 py-0.5 px-2 rounded-full text-xs ${
                  activeTab === tab.id
                    ? 'bg-blue-100 text-blue-600'
                    : 'bg-gray-100 text-gray-900'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {activeTab === 'upstreams' && (
          <div className="card">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">Proxy Upstreams</h3>
                <button
                  className="btn-primary"
                  onClick={() => {
                    if (!isAdmin) {
                      toast.error('Administrator access required');
                      return;
                    }
                    openAddUpstream();
                  }}
                >
                  <PlusIcon className="h-4 w-4 mr-2" />
                  Add Upstream
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              {upstreamsLoading ? (
                <div className="p-6 flex justify-center">
                  <LoadingSpinner />
                </div>
              ) : upstreamsSorted.length > 0 ? (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Service
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Path
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Target
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Domains
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Host Header
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Allowed Emails
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Auth Required
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {upstreamsSorted.map((upstream) => (
                      <tr key={upstream.id}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{upstream.name}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <code className="text-sm bg-gray-100 px-2 py-1 rounded">
                            {upstream.path}
                          </code>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900 flex items-center space-x-2">
                            <span>{upstream.target_url}</span>
                            <a
                              href={upstream.target_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-gray-400 hover:text-gray-600"
                            >
                              <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                            </a>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            Proxy URL: {baseOrigin}{upstream.path}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {upstream.domains.length > 0 ? (
                            <div className="text-sm text-gray-900">
                              {upstream.domains.join(', ')}
                            </div>
                          ) : (
                            <span className="text-sm text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm text-gray-900">
                            {upstream.preserve_host ? 'Preserve original host' : 'Send upstream host'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {upstream.allowed_emails.length > 0 ? (
                            <div className="text-sm text-gray-900">
                              {upstream.allowed_emails.join(', ')}
                            </div>
                          ) : (
                            <span className="text-sm text-gray-400">All authenticated users</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            upstream.enabled
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}>
                            {upstream.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            upstream.auth_required
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}>
                            {upstream.auth_required ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                          <button
                            className="text-blue-600 hover:text-blue-900"
                            onClick={() => handleTestUpstream(upstream)}
                            disabled={testUpstreamMutation.isPending}
                          >
                            {testUpstreamMutation.isPending ? 'Testing…' : 'Test'}
                          </button>
                          <button
                            className="text-gray-600 hover:text-gray-900"
                            onClick={() => {
                              if (!isAdmin) {
                                toast.error('Administrator access required');
                                return;
                              }
                              openEditUpstream(upstream);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="text-indigo-600 hover:text-indigo-900"
                            onClick={() => {
                              if (!isAdmin) {
                                toast.error('Administrator access required');
                                return;
                              }
                              openCustomizeUpstream(upstream);
                            }}
                            disabled={customizationSaving && customizingUpstream?.id === upstream.id}
                          >
                            Customize
                          </button>
                          <button
                            className="text-red-600 hover:text-red-900"
                            onClick={() => {
                              if (!isAdmin) {
                                toast.error('Administrator access required');
                                return;
                              }
                              handleDeleteUpstream(upstream);
                            }}
                            disabled={deleteUpstreamMutation.isPending}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-6 text-center">
                  <div className="text-gray-500">No upstreams configured</div>
                  <button
                    className="mt-4 btn-primary"
                    onClick={() => {
                      if (!isAdmin) {
                        toast.error('Administrator access required');
                        return;
                      }
                      openAddUpstream();
                    }}
                  >
                    <PlusIcon className="h-4 w-4 mr-2" />
                    Add Your First Upstream
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'config' && (
          <div className="space-y-6">
            <div className="card">
              <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium text-gray-900">Nginx Configuration</h3>
                  <div className="space-x-3">
                    <button
                      className="btn-outline"
                      onClick={handleExportConfig}
                      disabled={!isAdmin || exportConfigMutation.isPending}
                    >
                      {exportConfigMutation.isPending ? 'Downloading…' : 'Download JSON'}
                    </button>
                    <button
                      className="btn-outline"
                      onClick={handleReloadNginx}
                      disabled={!isAdmin || reloadNginxMutation.isPending}
                    >
                      {reloadNginxMutation.isPending ? 'Reloading…' : 'Reload Nginx'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="p-6">
                {!nginxConfigLoading && nginxConfig && (
                  <div className="mb-4 space-y-1 text-xs text-gray-500">
                    {(!pathInSync || !domainInSync || !rootInSync) && (
                      <div className="text-sm text-amber-500">
                        Configuration updated; reload nginx to apply changes.
                      </div>
                    )}
                    {nginxConfig.path_file_path && (
                      <div>Path config file: {nginxConfig.path_file_path}</div>
                    )}
                    {nginxConfig.domain_file_path && (
                      <div>Domain config file: {nginxConfig.domain_file_path}</div>
                    )}
                    {nginxConfig.root_file_path && (
                      <div>Root handler file: {nginxConfig.root_file_path}</div>
                    )}
                  </div>
                )}
                {nginxConfigLoading ? (
                  <div className="flex justify-center py-10">
                    <LoadingSpinner />
                  </div>
                ) : nginxConfig ? (
                  <div className="space-y-6">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 mb-2">Default Root Handler</h4>
                      <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm overflow-x-auto whitespace-pre">
                        # Auto-generated root config for EasyWeb
                        {'\n'}# Generated at {nginxConfig.generated_at}
                        {'\n\n'}
                        {nginxConfig.root_config || '# Using frontend fallback'}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 mb-2">Path-based Locations</h4>
                      <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm overflow-x-auto whitespace-pre">
                        # Auto-generated path config for EasyWeb
                        {'\n'}# Generated at {nginxConfig.generated_at}
                        {'\n\n'}
                        {nginxConfig.path_config || '# No upstreams enabled'}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 mb-2">Custom Domain Server Blocks</h4>
                      <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm overflow-x-auto whitespace-pre">
                        # Auto-generated domain config for EasyWeb
                        {'\n'}# Generated at {nginxConfig.generated_at}
                        {'\n\n'}
                        {nginxConfig.domain_config || '# No domain-based upstreams configured'}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-gray-500">Enable at least one upstream to generate configuration.</div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="card">
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-medium text-gray-900">Import Configuration</h3>
                </div>
                <div className="p-6">
                  <p className="text-sm text-gray-600 mb-4">
                    Upload a JSON configuration file to import multiple upstreams at once.
                  </p>
                  <div className="flex items-center justify-center w-full">
                    <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <svg className="w-8 h-8 mb-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
                        </svg>
                        <p className="mb-2 text-sm text-gray-500">Click to upload</p>
                        <p className="text-xs text-gray-500">JSON files only</p>
                      </div>
                      <input
                        type="file"
                        className="hidden"
                        accept=".json"
                        onChange={handleImportFile}
                        disabled={!isAdmin || importing || importConfigMutation.isPending}
                      />
                    </label>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <label className="flex items-center text-sm text-gray-600">
                      <input
                        type="checkbox"
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded mr-2"
                        checked={replaceImport}
                        onChange={(e) => setReplaceImport(e.target.checked)}
                        disabled={!isAdmin || importConfigMutation.isPending}
                      />
                      Replace existing upstreams
                    </label>
                    {(importing || importConfigMutation.isPending) && (
                      <span className="text-xs text-gray-500">Importing…</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-medium text-gray-900">Export Configuration</h3>
                </div>
                <div className="p-6">
                  <p className="text-sm text-gray-600 mb-4">
                    Download your current proxy configuration as a JSON file for backup or migration.
                  </p>
                  <button
                    className="btn-primary w-full"
                    onClick={handleExportConfig}
                    disabled={!isAdmin || exportConfigMutation.isPending}
                  >
                    {exportConfigMutation.isPending ? 'Exporting…' : 'Export Configuration'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-2xl">
            <div className="card">
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-lg font-medium text-gray-900">Proxy Settings</h3>
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Default Timeout (seconds)
                  </label>
                  <input
                    type="number"
                    className="input mt-1"
                    placeholder="30"
                  />
                  <p className="mt-2 text-sm text-gray-500">
                    Default timeout for upstream connections
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Max Body Size (MB)
                  </label>
                  <input
                    type="number"
                    className="input mt-1"
                    placeholder="100"
                  />
                </div>
                <div className="flex items-start">
                  <div className="flex items-center h-5">
                    <input
                      type="checkbox"
                      className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300 rounded"
                    />
                  </div>
                  <div className="ml-3 text-sm">
                    <label className="font-medium text-gray-700">
                      Enable request logging
                    </label>
                    <p className="text-gray-500">Log all proxy requests for debugging</p>
                  </div>
                </div>
                <div className="flex items-start">
                  <div className="flex items-center h-5">
                    <input
                      type="checkbox"
                      className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300 rounded"
                    />
                  </div>
                  <div className="ml-3 text-sm">
                    <label className="font-medium text-gray-700">
                      Health check enabled
                    </label>
                    <p className="text-gray-500">Automatically check upstream health</p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button className="btn-primary">
                    Save Settings
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {isCustomizeModalOpen && customizingUpstream && (
        <div className="fixed z-50 inset-0 overflow-y-auto">
          <div className="flex items-end sm:items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={closeCustomizeModal} />
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">
              &#8203;
            </span>
            <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full sm:p-6">
              <div className="sm:flex sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-lg leading-6 font-medium text-gray-900">
                    Customize Login Experience
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Brand the EasyWeb login screen users see before reaching <span className="font-medium">{customizingUpstream.name}</span>.
                  </p>
                </div>
                <button
                  type="button"
                  className="text-gray-400 hover:text-gray-600"
                  onClick={closeCustomizeModal}
                  aria-label="Close customization dialog"
                >
                  ×
                </button>
              </div>

              <form className="mt-6 space-y-6" onSubmit={handleCustomizationSubmit}>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700" htmlFor="customization-header-image">
                      Header image URL
                    </label>
                    <input
                      id="customization-header-image"
                      type="url"
                      className="input mt-1"
                      placeholder="https://cdn.example.com/banner.jpg"
                      value={customizationForm.headerImageUrl}
                      onChange={(event) => setCustomizationForm((prev) => ({
                        ...prev,
                        headerImageUrl: event.target.value,
                      }))}
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Shows across the top of the login card. Use a wide image (1200×400 recommended).
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700" htmlFor="customization-logo">
                      Logo URL
                    </label>
                    <input
                      id="customization-logo"
                      type="url"
                      className="input mt-1"
                      placeholder="https://cdn.example.com/logo.png"
                      value={customizationForm.logoUrl}
                      onChange={(event) => setCustomizationForm((prev) => ({
                        ...prev,
                        logoUrl: event.target.value,
                      }))}
                    />
                    <p className="mt-1 text-xs text-gray-500">Square images (at least 128×128) look best.</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700" htmlFor="customization-font">
                      Font family
                    </label>
                    <input
                      id="customization-font"
                      type="text"
                      className="input mt-1"
                      placeholder="'Inter', 'Helvetica', sans-serif"
                      value={customizationForm.fontFamily}
                      onChange={(event) => setCustomizationForm((prev) => ({
                        ...prev,
                        fontFamily: event.target.value,
                      }))}
                    />
                    <p className="mt-1 text-xs text-gray-500">Applied to headings and body text on the login screen.</p>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="customization-headline">
                    Headline text
                  </label>
                  <input
                    id="customization-headline"
                    type="text"
                    className="input mt-1"
                    placeholder="Welcome to the Support Portal"
                    value={customizationForm.headline}
                    onChange={(event) => setCustomizationForm((prev) => ({
                      ...prev,
                      headline: event.target.value,
                    }))}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="customization-body-text">
                    Supporting text
                  </label>
                  <textarea
                    id="customization-body-text"
                    className="input mt-1"
                    rows={3}
                    placeholder="Only employees with a company account can access this service."
                    value={customizationForm.bodyText}
                    onChange={(event) => setCustomizationForm((prev) => ({
                      ...prev,
                      bodyText: event.target.value,
                    }))}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Leave any field blank to fall back to the default EasyWeb styling.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-gray-200">
                  <button
                    type="button"
                    className="text-sm text-gray-500 hover:text-gray-700"
                    onClick={() => setCustomizationForm(createEmptyCustomizationForm())}
                  >
                    Clear all branding
                  </button>
                  <div className="flex justify-end space-x-3">
                    <button
                      type="button"
                      className="btn-outline"
                      onClick={closeCustomizeModal}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={customizationSaving}
                    >
                      {customizationSaving ? 'Saving…' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {isUpstreamModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900">
                {editingUpstream ? 'Edit Upstream' : 'Add Upstream'}
              </h3>
              <button
                className="text-gray-400 hover:text-gray-600"
                onClick={() => setUpstreamModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleUpstreamSubmit} className="px-6 py-5 space-y-5">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Name</label>
                  <input
                    type="text"
                    className="input mt-1"
                    value={upstreamForm.name}
                    onChange={(e) => setUpstreamForm(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Path {domainList.length > 0 && <span className="text-gray-400 font-normal">(optional when domains are specified)</span>}
                  </label>
                  <input
                    type="text"
                    className="input mt-1"
                    value={upstreamForm.path}
                    onChange={(e) => setUpstreamForm(prev => ({ ...prev, path: e.target.value }))}
                    placeholder={domainList.length > 0 ? "/service (leave empty for domain-only)" : "/service"}
                  />
                  {domainList.length > 0 && (
                    <p className="mt-1 text-xs text-gray-500">
                      Leave empty to use domains only, or specify a path for additional access via {window.location.origin}/path
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Target URL</label>
                <input
                  type="url"
                  className="input mt-1"
                  value={upstreamForm.target_url}
                  onChange={(e) => setUpstreamForm(prev => ({ ...prev, target_url: e.target.value }))}
                  placeholder="http://service:8080"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Custom Headers (JSON object)
                </label>
                <textarea
                  className="input mt-1 font-mono text-sm"
                  rows={4}
                  value={headersInput}
                  onChange={(e) => setHeadersInput(e.target.value)}
                  placeholder='{"X-Forwarded-Host": "example.com"}'
                />
              </div>

              <div className="border border-gray-200 rounded-lg">
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  onClick={() => setShowAdvanced((prev) => !prev)}
                >
                  Advanced routing options
                  <span className="text-gray-400">{showAdvanced ? '–' : '+'}</span>
                </button>
                {showAdvanced && (
                  <div className="px-4 pb-4 pt-2 space-y-4 bg-gray-50 border-t border-gray-200">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Custom Domains {!upstreamForm.path.trim() && <span className="text-blue-600 font-normal">(domain-only mode)</span>}
                      </label>
                      <textarea
                        className="input mt-1 font-mono text-sm"
                        rows={2}
                        value={domainsInput}
                        onChange={(e) => setDomainsInput(e.target.value)}
                        placeholder="myapp.local api.internal"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Provide space or comma separated hostnames. Point those domains at this EasyWeb server (via DNS or /etc/hosts). Requests for these hosts proxy directly to the target service.
                      </p>
                      {!upstreamForm.path.trim() && (
                        <p className="mt-1 text-xs text-blue-600 bg-blue-50 p-2 rounded">
                          <strong>Domain-only mode:</strong> Only specified domains will access this service. No path-based access will be created.
                        </p>
                      )}
                      {domainList.length > 0 && (
                        <div className="mt-2 space-y-2 rounded-md bg-blue-50 p-3 text-xs text-blue-700">
                          <p className="font-semibold">DNS quick guide for {domainList.join(', ')}:</p>
                          <ul className="space-y-1 list-disc list-inside">
                            <li>
                              <span className="font-medium">Direct (no Cloudflare):</span> create an <code>A</code> (or <code>AAAA</code>) record pointing to your EasyWeb host {baseHostname ? `(${baseHostname})` : ''}, or add <code>{domainList.join(', ')}</code> to <code>/etc/hosts</code> while testing.
                            </li>
                            <li>
                              <span className="font-medium">With Cloudflare:</span> set the record to your EasyWeb host and disable proxy (grey cloud) while you’re testing. If you keep the orange cloud enabled, ensure Cloudflare can reach this service (tunnel or public port) and that TLS certificates match the proxied domain.
                            </li>
                            <li>
                              Verify with <code>curl -I http://{domainList[0] || 'example.local'}/ --resolve {domainList[0] || 'example.local'}:80:&lt;EASYWEB_IP&gt;</code> (or visit in a browser once DNS propagates).
                            </li>
                          </ul>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Allowed Emails
                      </label>
                      <textarea
                        className="input mt-1 font-mono text-sm"
                        rows={2}
                        value={allowedEmailsInput}
                        onChange={(e) => setAllowedEmailsInput(e.target.value)}
                        disabled={!upstreamForm.auth_required}
                        placeholder="user@example.com admin@example.com"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Leave blank to allow any authenticated user. Provide space or comma separated email addresses to restrict access.
                      </p>
                    </div>

                    <label className="flex items-center text-sm text-gray-700">
                      <input
                        type="checkbox"
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded mr-2"
                        checked={Boolean(upstreamForm.preserve_host)}
                        onChange={(e) => setUpstreamForm((prev) => ({
                          ...prev,
                          preserve_host: e.target.checked,
                        }))}
                      />
                      Preserve original `Host` header when proxying
                    </label>
                    <p className="text-xs text-gray-500">
                      Leave unchecked to automatically send the upstream&apos;s host ({firstCustomDomain || resolvedTargetHost}) so CDNs and TLS backends accept the request.
                    </p>
                    {isLocalTarget && (
                      <p className="text-xs text-blue-600">
                        Local service detected – EasyWeb proxies to `host.docker.internal` automatically. Ensure your app listens on the host network.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="flex items-center text-sm text-gray-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded mr-2"
                    checked={upstreamForm.enabled}
                    onChange={(e) => setUpstreamForm(prev => ({ ...prev, enabled: e.target.checked }))}
                  />
                  Enable upstream
                </label>
                <label className="flex items-center text-sm text-gray-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded mr-2"
                    checked={upstreamForm.auth_required}
                    onChange={(e) => setUpstreamForm(prev => ({ ...prev, auth_required: e.target.checked }))}
                  />
                  Require authentication
                </label>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => setUpstreamModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={savingUpstream}
                >
                  {savingUpstream ? 'Saving…' : editingUpstream ? 'Save Changes' : 'Add Upstream'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProxyPage;
