import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi, authEvents } from '../services/api';
import type { User } from '../types';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (provider: 'google' | 'github' | 'microsoft', redirectUrl?: string) => void;
  logout: () => Promise<void>;
  refetch: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

type SessionState = 'unknown' | 'invalid';

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [error, setError] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>('unknown');
  const queryClient = useQueryClient();

  const {
    data: user,
    isLoading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: authApi.getMe,
    retry: false,
    refetchOnMount: sessionState !== 'invalid',
    refetchOnWindowFocus: false,
    enabled: sessionState !== 'invalid',
  });

  useEffect(() => {
    if (queryError) {
      setError('Failed to authenticate. Please log in again.');
    } else {
      setError(null);
    }
  }, [queryError]);

  useEffect(() => {
    const unsubscribe = authEvents.subscribe((event) => {
      if (event === 'refreshFailed') {
        setSessionState('invalid');
        queryClient.removeQueries({ queryKey: ['auth', 'me'], exact: true });
      } else if (event === 'refreshSucceeded') {
        setSessionState('unknown');
      }
    });

    return unsubscribe;
  }, [queryClient]);

  useEffect(() => {
    if (user) {
      setSessionState('unknown');
    }
  }, [user]);

  const login = (provider: 'google' | 'github' | 'microsoft', redirectUrl?: string) => {
    try {
      setSessionState('unknown');
      window.location.href = authApi.loginUrl(provider, redirectUrl);
    } catch (err) {
      setError('Failed to initiate login');
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
      queryClient.clear();
      queryClient.invalidateQueries();
      setSessionState('invalid');
      window.location.href = '/login';
    } catch (err) {
      setError('Failed to log out');
    }
  };

  const value: AuthContextType = {
    user: user || null,
    isAuthenticated: !!user && !queryError,
    isLoading,
    error,
    login,
    logout,
    refetch,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
