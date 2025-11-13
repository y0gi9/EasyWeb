import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useAuth } from './AuthContext';
import type { WebSocketMessage } from '../types';

interface WebSocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  subscribe: (channels: string[]) => void;
  unsubscribe: (channels: string[]) => void;
  sendMessage: (event: string, data: any) => void;
  messages: WebSocketMessage[];
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (context === undefined) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

interface WebSocketProviderProps {
  children: ReactNode;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<WebSocketMessage[]>([]);

  useEffect(() => {
    if (isAuthenticated && user) {
      const newSocket = io(process.env.REACT_APP_API_URL || 'REACT_APP_API_URL_PLACEHOLDER', {
        withCredentials: true,
      });

        newSocket.on('connect', () => {
          console.log('WebSocket connected');
          setIsConnected(true);
        });

        newSocket.on('disconnect', (reason) => {
          console.log('WebSocket disconnected:', reason);
          setIsConnected(false);
        });

        newSocket.on('connect_error', (error) => {
          console.error('WebSocket connection error:', error);
          setIsConnected(false);
          if (error.message.includes('Authentication')) {
            toast.error('WebSocket authentication failed');
          }
        });

        newSocket.on('welcome', (data) => {
          console.log('WebSocket welcome:', data);
          toast.success('Connected to real-time updates');
        });

        // Handle real-time DNS updates
        newSocket.on('dns:new_query', (data) => {
          setMessages(prev => [...prev.slice(-99), {
            type: 'dns:new_query',
            data,
            timestamp: new Date().toISOString(),
          }]);
        });

        newSocket.on('dns:stats_update', (data) => {
          setMessages(prev => [...prev.slice(-99), {
            type: 'dns:stats_update',
            data,
            timestamp: new Date().toISOString(),
          }]);
        });

        newSocket.on('proxy:stats_update', (data) => {
          setMessages(prev => [...prev.slice(-99), {
            type: 'proxy:stats_update',
            data,
            timestamp: new Date().toISOString(),
          }]);
        });

        newSocket.on('system:health_update', (data) => {
          setMessages(prev => [...prev.slice(-99), {
            type: 'system:health_update',
            data,
            timestamp: new Date().toISOString(),
          }]);
        });

        newSocket.on('admin:notification', (data) => {
          setMessages(prev => [...prev.slice(-99), {
            type: 'admin:notification',
            data,
            timestamp: new Date().toISOString(),
          }]);
          
          // Show toast notification for admin messages
          if (user.role === 'admin') {
            const { type = 'info', title, message } = data;
            const toastFn = type === 'error' ? toast.error : 
                           type === 'warning' ? toast.error : 
                           type === 'success' ? toast.success : toast;
            toastFn(`${title}: ${message}`);
          }
        });

      setSocket(newSocket);

      return () => {
        newSocket.close();
        setSocket(null);
        setIsConnected(false);
      };
    }
  }, [isAuthenticated, user]);

  const subscribe = (channels: string[]) => {
    if (socket) {
      socket.emit('subscribe', { channels });
    }
  };

  const unsubscribe = (channels: string[]) => {
    if (socket) {
      socket.emit('unsubscribe', { channels });
    }
  };

  const sendMessage = (event: string, data: any) => {
    if (socket) {
      socket.emit(event, data);
    }
  };

  const value: WebSocketContextType = {
    socket,
    isConnected,
    subscribe,
    unsubscribe,
    sendMessage,
    messages,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
};
