import React, { useEffect, useMemo, useState } from 'react';
import { authApi, proxyApi } from '../services/api';
import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import { useLocation } from 'react-router-dom';
import type { ProxyUpstreamPublicInfo } from '../types';

const LoginPage: React.FC = () => {
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const redirectTarget = useMemo(() => {
    const redirect = params.get('redirect');
    return redirect || undefined;
  }, [params]);

  const upstreamId = useMemo(() => {
    const raw = params.get('upstreamId');
    if (!raw) {
      return undefined;
    }

    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return undefined;
  }, [params]);

  const loginError = useMemo(() => {
    const code = params.get('error');
    if (!code) {
      return null;
    }

    switch (code) {
      case 'auth_failed':
        return 'Authentication failed. Please try again or use a different provider.';
      default:
        return 'Unable to sign in. Please try again.';
    }
  }, [params]);

  const [branding, setBranding] = useState<ProxyUpstreamPublicInfo | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!upstreamId) {
      setBranding(null);
      return () => {
        cancelled = true;
      };
    }

    proxyApi.getUpstreamPublic(upstreamId)
      .then((data) => {
        if (!cancelled) {
          setBranding(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBranding(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [upstreamId]);

  const customization = branding?.auth_customization;

  const fontFamilyStyle = useMemo(() => (
    customization?.fontFamily ? { fontFamily: customization.fontFamily } : undefined
  ), [customization?.fontFamily]);

  const serviceName = branding?.name || 'EasyWeb';
  const headlineText = customization?.headline?.trim() ? customization.headline : 'Sign in to EasyWeb';
  const supportingText = customization?.bodyText?.trim() ? customization.bodyText : 'Unified Network & Security Dashboard';
  const headerImageUrl = customization?.headerImageUrl;
  const logoUrl = customization?.logoUrl;

  const handleLogin = (provider: 'google' | 'github' | 'microsoft') => {
    window.location.href = authApi.loginUrl(provider, redirectTarget);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full" style={fontFamilyStyle}>
        <div className="bg-white border border-gray-100 shadow-md rounded-2xl overflow-hidden">
          {headerImageUrl && (
            <div className="h-32 bg-gray-100 overflow-hidden">
              <img
                src={headerImageUrl}
                alt={`${serviceName} login header`}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          <div className="px-8 py-8">
            <div className="flex flex-col items-center text-center space-y-4">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={`${serviceName} logo`}
                  className="h-16 w-16 rounded-full object-cover shadow-sm"
                />
              ) : (
                <div className="h-14 w-14 flex items-center justify-center rounded-full bg-blue-50">
                  <ShieldCheckIcon className="h-8 w-8 text-blue-600" />
                </div>
              )}

              <div>
                <h2 className="text-3xl font-extrabold text-gray-900">{headlineText}</h2>
                <p className="mt-2 text-sm text-gray-600">{supportingText}</p>
              </div>
            </div>

            {loginError && (
              <div className="mt-6 rounded-md bg-red-50 p-4 text-left">
                <div className="text-sm text-red-700">{loginError}</div>
              </div>
            )}

            <div className="mt-8 space-y-4">
              <button
                onClick={() => handleLogin('google')}
                className="group relative w-full flex justify-center py-3 px-4 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </button>

              <button
                onClick={() => handleLogin('github')}
                className="group relative w-full flex justify-center py-3 px-4 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 0C4.477 0 0 4.484 0 10.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0110 4.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.942.359.31.678.921.678 1.856 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0020 10.017C20 4.484 15.522 0 10 0z" clipRule="evenodd" />
                </svg>
                Continue with GitHub
              </button>

              <button
                onClick={() => handleLogin('microsoft')}
                className="group relative w-full flex justify-center py-3 px-4 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path fill="#f25022" d="M1 1h10v10H1z"/>
                  <path fill="#00a4ef" d="M13 1h10v10H13z"/>
                  <path fill="#7fba00" d="M1 13h10v10H1z"/>
                  <path fill="#ffb900" d="M13 13h10v10H13z"/>
                </svg>
                Continue with Microsoft
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
