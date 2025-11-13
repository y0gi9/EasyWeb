import React, { useMemo } from 'react';
import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import { useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const UnauthorizedPage: React.FC = () => {
  const location = useLocation();
  const { isAuthenticated } = useAuth();

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const redirectTarget = params.get('redirect') || undefined;
  const redirectHost = useMemo(() => {
    if (!redirectTarget) return null;
    try {
      const parsed = new URL(redirectTarget);
      return parsed.host;
    } catch (error) {
      return null;
    }
  }, [redirectTarget]);

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="mx-auto h-12 w-12 flex items-center justify-center">
          <ShieldCheckIcon className="h-12 w-12 text-red-500" />
        </div>
        <h2 className="text-3xl font-extrabold text-gray-900">Unauthorized</h2>
        <p className="text-sm text-gray-600">
          {redirectHost
            ? `Access to ${redirectHost} is restricted. Please contact an administrator to be added.`
            : 'This account is not allowed to access EasyWeb. Please try again or contact an administrator.'}
        </p>
        <div className="pt-4 space-y-3">
          <button
            onClick={() => window.location.href = '/login'}
            className="btn-primary w-full"
          >
            Try Again
          </button>
          <button
            onClick={() => window.location.href = '/'}
            className="btn-outline w-full"
          >
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
};

export default UnauthorizedPage;
