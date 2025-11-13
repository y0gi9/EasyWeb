import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { dashboardApi, handleApiError } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import { CogIcon, ShieldCheckIcon, ServerIcon, GlobeAltIcon } from '@heroicons/react/24/outline';

const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'general' | 'dns' | 'proxy' | 'security'>('general');
  const queryClient = useQueryClient();
  const isAdmin = useMemo(() => user?.role === 'admin', [user]);

  const [appName, setAppName] = useState('EasyWeb');
  const [appDomain, setAppDomain] = useState('');
  const [adminEmail, setAdminEmail] = useState(user?.email ?? '');
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [generalSuccess, setGeneralSuccess] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const [sessionTimeout, setSessionTimeout] = useState(1440);
  const [requireAuthForAll, setRequireAuthForAll] = useState(true);
  const [requireAdminMfa, setRequireAdminMfa] = useState(false);
  const [securitySuccess, setSecuritySuccess] = useState<string | null>(null);
  const [securityError, setSecurityError] = useState<string | null>(null);

  const { data: generalSettings, isLoading: generalLoading } = useQuery({
    queryKey: ['settings', 'general'],
    queryFn: dashboardApi.getGeneralSettings,
    enabled: isAdmin,
  });

  const { data: securitySettings, isLoading: securityLoading } = useQuery({
    queryKey: ['settings', 'security'],
    queryFn: dashboardApi.getSecuritySettings,
    enabled: isAdmin,
  });

  useEffect(() => {
    if (generalSettings) {
      setAppName(generalSettings.appName || 'EasyWeb');
      setAppDomain(generalSettings.appDomain || '');
      setAdminEmail(generalSettings.adminEmail || user?.email || '');
      setRegistrationEnabled(!!generalSettings.registrationEnabled);
    }
  }, [generalSettings, user]);

  const generalMutation = useMutation({
    mutationFn: dashboardApi.updateGeneralSettings,
    onSuccess: (data) => {
      setGeneralError(null);
      setGeneralSuccess('General settings saved successfully.');
      setAppName(data.appName || 'EasyWeb');
      setAppDomain(data.appDomain || '');
      setAdminEmail(data.adminEmail || '');
      setRegistrationEnabled(!!data.registrationEnabled);
      queryClient.setQueryData(['settings', 'general'], data);
    },
    onError: (error) => {
      setGeneralSuccess(null);
      setGeneralError(handleApiError(error));
    }
  });

  const handleGeneralSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isAdmin) {
      return;
    }

    setGeneralSuccess(null);
    setGeneralError(null);

    generalMutation.mutate({
      appName: appName.trim() || 'EasyWeb',
      appDomain: appDomain.trim(),
      adminEmail: adminEmail.trim(),
      registrationEnabled,
    });
  };

  useEffect(() => {
    if (securitySettings) {
      setSessionTimeout(securitySettings.sessionTimeoutMinutes || 1440);
      setRequireAuthForAll(!!securitySettings.requireAuthForAll);
      setRequireAdminMfa(!!securitySettings.requireAdminMfa);
    }
  }, [securitySettings]);

  const securityMutation = useMutation({
    mutationFn: dashboardApi.updateSecuritySettings,
    onSuccess: (data) => {
      setSecurityError(null);
      setSecuritySuccess('Security settings saved successfully.');
      setSessionTimeout(data.sessionTimeoutMinutes || 1440);
      setRequireAuthForAll(!!data.requireAuthForAll);
      setRequireAdminMfa(!!data.requireAdminMfa);
      queryClient.setQueryData(['settings', 'security'], data);
    },
    onError: (error) => {
      setSecuritySuccess(null);
      setSecurityError(handleApiError(error));
    }
  });

  const handleSecuritySubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isAdmin) {
      return;
    }

    setSecuritySuccess(null);
    setSecurityError(null);

    const normalizedTimeout = Number.isFinite(sessionTimeout) && sessionTimeout > 0
      ? Math.round(sessionTimeout)
      : 1440;

    securityMutation.mutate({
      sessionTimeoutMinutes: normalizedTimeout,
      requireAuthForAll,
      requireAdminMfa,
    });
  };

  const tabs = [
    { id: 'general', name: 'General', icon: CogIcon },
    { id: 'dns', name: 'DNS Settings', icon: GlobeAltIcon },
    { id: 'proxy', name: 'Proxy Settings', icon: ServerIcon },
    { id: 'security', name: 'Security', icon: ShieldCheckIcon },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="pb-5 border-b border-gray-200">
        <h1 className="text-3xl font-bold leading-6 text-gray-900">Settings</h1>
        <p className="mt-2 max-w-4xl text-sm text-gray-500">
          Configure system settings and preferences
        </p>
      </div>

      <div className="mt-6 lg:flex lg:gap-8">
        {/* Sidebar */}
        <div className="lg:w-1/4">
          <nav className="space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`w-full group rounded-md px-3 py-2 flex items-center text-sm font-medium ${
                  activeTab === tab.id
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-900 hover:bg-gray-50'
                }`}
              >
                <tab.icon className="h-5 w-5 mr-3 flex-shrink-0" />
                {tab.name}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="mt-6 lg:mt-0 lg:flex-1">
          {activeTab === 'general' && (
            <div className="space-y-6">
              {!isAdmin ? (
                <div className="card">
                  <div className="p-6 text-center">
                    <ShieldCheckIcon className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-4 text-sm font-medium text-gray-900">Access Denied</h3>
                    <p className="mt-2 text-sm text-gray-500">
                      You need administrator privileges to manage general settings.
                    </p>
                  </div>
                </div>
              ) : generalLoading ? (
                <div className="flex items-center justify-center h-64">
                  <LoadingSpinner size="lg" />
                </div>
              ) : (
                <>
                  <div className="card">
                    <div className="p-6 border-b border-gray-200">
                      <h3 className="text-lg font-medium text-gray-900">Application Settings</h3>
                    </div>
                    <form className="p-6 space-y-6" onSubmit={handleGeneralSubmit}>
                      {generalError && (
                        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
                          {generalError}
                        </div>
                      )}
                      {generalSuccess && (
                        <div className="rounded-md bg-green-50 p-4 text-sm text-green-700">
                          {generalSuccess}
                        </div>
                      )}

                      <div>
                        <label className="block text-sm font-medium text-gray-700" htmlFor="app-name">
                          Application Name
                        </label>
                        <input
                          id="app-name"
                          type="text"
                          className="input mt-1"
                          value={appName}
                          onChange={(event) => setAppName(event.target.value)}
                          required
                          disabled={generalMutation.isPending}
                        />
                        <p className="mt-2 text-sm text-gray-500">
                          Display name shown throughout the dashboard
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700" htmlFor="app-domain">
                          Domain
                        </label>
                        <input
                          id="app-domain"
                          type="text"
                          className="input mt-1"
                          placeholder="your-domain.com"
                          value={appDomain}
                          onChange={(event) => setAppDomain(event.target.value)}
                          disabled={generalMutation.isPending}
                        />
                        <p className="mt-2 text-sm text-gray-500">
                          Primary domain where users access EasyWeb
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700" htmlFor="admin-email">
                          Administrator Email
                        </label>
                        <input
                          id="admin-email"
                          type="email"
                          className="input mt-1"
                          value={adminEmail}
                          onChange={(event) => setAdminEmail(event.target.value)}
                          disabled={generalMutation.isPending}
                          placeholder="admin@example.com"
                        />
                        <p className="mt-2 text-sm text-gray-500">
                          Notifications and alerts will be sent here
                        </p>
                      </div>

                      <div className="flex items-start">
                        <div className="flex items-center h-5">
                          <input
                            id="registration-enabled"
                            type="checkbox"
                            className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300 rounded"
                            checked={registrationEnabled}
                            onChange={(event) => setRegistrationEnabled(event.target.checked)}
                            disabled={generalMutation.isPending}
                          />
                        </div>
                        <div className="ml-3 text-sm">
                          <label className="font-medium text-gray-700" htmlFor="registration-enabled">
                            Enable registration
                          </label>
                          <p className="text-gray-500">Allow pre-approved users to provision access by signing in with SSO.</p>
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="submit"
                          className="btn-primary disabled:opacity-60"
                          disabled={generalMutation.isPending}
                        >
                          {generalMutation.isPending ? 'Saving…' : 'Save Changes'}
                        </button>
                      </div>
                    </form>
                  </div>

                  <div className="card">
                    <div className="p-6 border-b border-gray-200">
                      <h3 className="text-lg font-medium text-gray-900">Appearance</h3>
                    </div>
                    <div className="p-6 space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          Theme
                        </label>
                        <select className="input mt-1" disabled>
                          <option>Light</option>
                          <option>Dark</option>
                          <option>Auto</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          Language
                        </label>
                        <select className="input mt-1" disabled>
                          <option>English</option>
                          <option>Spanish</option>
                          <option>French</option>
                          <option>German</option>
                        </select>
                      </div>
                      <div className="flex justify-end">
                        <button className="btn-primary" disabled>
                          Save Changes
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'dns' && (
            <div className="card">
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-lg font-medium text-gray-900">DNS Configuration</h3>
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Upstream DNS Servers
                  </label>
                  <input
                    type="text"
                    className="input mt-1"
                    defaultValue="8.8.8.8,1.1.1.1"
                  />
                  <p className="mt-2 text-sm text-gray-500">
                    Comma-separated list of upstream DNS servers
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    DNS Port
                  </label>
                  <input
                    type="number"
                    className="input mt-1"
                    defaultValue="53"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Blocklist Update Interval (hours)
                  </label>
                  <input
                    type="number"
                    className="input mt-1"
                    defaultValue="24"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Query Log Retention (days)
                  </label>
                  <input
                    type="number"
                    className="input mt-1"
                    defaultValue="30"
                  />
                </div>
                <div className="flex items-start">
                  <div className="flex items-center h-5">
                    <input
                      type="checkbox"
                      className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300 rounded"
                      defaultChecked
                    />
                  </div>
                  <div className="ml-3 text-sm">
                    <label className="font-medium text-gray-700">
                      Enable DNS caching
                    </label>
                    <p className="text-gray-500">Cache DNS responses to improve performance</p>
                  </div>
                </div>
                <div className="flex items-start">
                  <div className="flex items-center h-5">
                    <input
                      type="checkbox"
                      className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300 rounded"
                      defaultChecked
                    />
                  </div>
                  <div className="ml-3 text-sm">
                    <label className="font-medium text-gray-700">
                      Log DNS queries
                    </label>
                    <p className="text-gray-500">Keep a log of all DNS queries for monitoring</p>
                  </div>
                </div>
                <div className="flex justify-end space-x-3">
                  <button className="btn-outline">Test Configuration</button>
                  <button className="btn-primary">Save Changes</button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'proxy' && (
            <div className="card">
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-lg font-medium text-gray-900">Proxy Configuration</h3>
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Default Timeout (seconds)
                  </label>
                  <input
                    type="number"
                    className="input mt-1"
                    defaultValue="30"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Maximum Body Size (MB)
                  </label>
                  <input
                    type="number"
                    className="input mt-1"
                    defaultValue="100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Health Check Interval (seconds)
                  </label>
                  <input
                    type="number"
                    className="input mt-1"
                    defaultValue="30"
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
                      defaultChecked
                    />
                  </div>
                  <div className="ml-3 text-sm">
                    <label className="font-medium text-gray-700">
                      Automatic failover
                    </label>
                    <p className="text-gray-500">Automatically switch to backup upstreams</p>
                  </div>
                </div>
                <div className="flex justify-end space-x-3">
                  <button className="btn-outline">Reload Nginx</button>
                  <button className="btn-primary">Save Changes</button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-6">
              {!isAdmin ? (
                <div className="card">
                  <div className="p-6 text-center">
                    <ShieldCheckIcon className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-4 text-sm font-medium text-gray-900">Access Denied</h3>
                    <p className="mt-2 text-sm text-gray-500">
                      You need administrator privileges to manage security settings.
                    </p>
                  </div>
                </div>
              ) : securityLoading ? (
                <div className="flex items-center justify-center h-64">
                  <LoadingSpinner size="lg" />
                </div>
              ) : (
                <>
                  <div className="card">
                    <div className="p-6 border-b border-gray-200">
                      <h3 className="text-lg font-medium text-gray-900">Authentication</h3>
                    </div>
                    <form className="p-6 space-y-6" onSubmit={handleSecuritySubmit}>
                      {securityError && (
                        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
                          {securityError}
                        </div>
                      )}
                      {securitySuccess && (
                        <div className="rounded-md bg-green-50 p-4 text-sm text-green-700">
                          {securitySuccess}
                        </div>
                      )}

                      <div>
                        <label className="block text-sm font-medium text-gray-700" htmlFor="session-timeout">
                          Session Timeout (minutes)
                        </label>
                        <input
                          id="session-timeout"
                          type="number"
                          min={5}
                          className="input mt-1"
                          value={sessionTimeout}
                          onChange={(event) => setSessionTimeout(Number(event.target.value))}
                          disabled={securityMutation.isPending}
                        />
                        <p className="mt-2 text-sm text-gray-500">
                          Tokens and sessions expire after this many minutes.
                        </p>
                      </div>

                      <div className="flex items-start">
                        <div className="flex items-center h-5">
                          <input
                            id="require-auth"
                            type="checkbox"
                            className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300 rounded"
                            checked={requireAuthForAll}
                            onChange={(event) => setRequireAuthForAll(event.target.checked)}
                            disabled={securityMutation.isPending}
                          />
                        </div>
                        <div className="ml-3 text-sm">
                          <label className="font-medium text-gray-700" htmlFor="require-auth">
                            Require authentication for all services
                          </label>
                          <p className="text-gray-500">
                            Automatically updates every proxy upstream to enforce login and reloads Nginx.
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start">
                        <div className="flex items-center h-5">
                          <input
                            id="require-mfa"
                            type="checkbox"
                            className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300 rounded"
                            checked={requireAdminMfa}
                            onChange={(event) => setRequireAdminMfa(event.target.checked)}
                            disabled={securityMutation.isPending}
                          />
                        </div>
                        <div className="ml-3 text-sm">
                          <label className="font-medium text-gray-700" htmlFor="require-mfa">
                            Enable two-factor authentication
                          </label>
                          <p className="text-gray-500">
                            When enabled, administrators must complete 2FA during sign-in (coming soon).
                          </p>
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="submit"
                          className="btn-primary disabled:opacity-60"
                          disabled={securityMutation.isPending}
                        >
                          {securityMutation.isPending ? 'Saving…' : 'Save Changes'}
                        </button>
                      </div>
                    </form>
                  </div>

                  <div className="card">
                    <div className="p-6 border-b border-gray-200">
                      <h3 className="text-lg font-medium text-gray-900">SSL/TLS</h3>
                    </div>
                    <div className="p-6 space-y-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          Force HTTPS redirect
                        </label>
                        <p className="mt-1 text-sm text-gray-500">
                          Enforce HTTPS for all HTTP requests through the proxy.
                        </p>
                        <button className="btn-outline mt-3" disabled>
                          Configure SSL
                        </button>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          Certificate Renewal
                        </label>
                        <p className="mt-1 text-sm text-gray-500">
                          Automated renewal is enabled for Let's Encrypt certificates.
                        </p>
                        <button className="btn-outline mt-3" disabled>
                          Renew Now
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
