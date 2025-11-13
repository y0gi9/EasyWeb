const jwt = require('jsonwebtoken');
const { db } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';

// Store connected clients
const connectedClients = new Map();

function extractTokenFromCookies(cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    if (cookie.startsWith('token=')) {
      return cookie.substring('token='.length);
    }
  }
  return null;
}

function setupWebSocket(io) {
  // Authentication middleware for WebSocket
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token
        || socket.handshake.headers.authorization?.split(' ')[1]
        || extractTokenFromCookies(socket.handshake.headers.cookie);
      
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await db()('users')
        .where({ id: decoded.userId, active: true })
        .first();

      if (!user) {
        return next(new Error('User not found or inactive'));
      }

      socket.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      };

      next();
    } catch (error) {
      next(new Error('Invalid authentication token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user.email} (${socket.id})`);
    
    // Store client connection
    connectedClients.set(socket.id, {
      socket,
      user: socket.user,
      connectedAt: new Date()
    });

    // Join user to appropriate rooms based on role
    socket.join('authenticated');
    if (socket.user.role === 'admin') {
      socket.join('admin');
    }

    // Send welcome message
    socket.emit('welcome', {
      message: 'Connected to EasyWeb WebSocket',
      user: socket.user,
      timestamp: new Date().toISOString()
    });

    // Handle client events
    socket.on('subscribe', (data) => {
      const { channels } = data;
      
      if (Array.isArray(channels)) {
        channels.forEach(channel => {
          if (isChannelAllowed(channel, socket.user.role)) {
            socket.join(channel);
            console.log(`User ${socket.user.email} subscribed to ${channel}`);
          }
        });
      }
    });

    socket.on('unsubscribe', (data) => {
      const { channels } = data;
      
      if (Array.isArray(channels)) {
        channels.forEach(channel => {
          socket.leave(channel);
          console.log(`User ${socket.user.email} unsubscribed from ${channel}`);
        });
      }
    });

    socket.on('ping', () => {
      socket.emit('pong', { timestamp: new Date().toISOString() });
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      console.log(`User disconnected: ${socket.user.email} (${socket.id}) - Reason: ${reason}`);
      connectedClients.delete(socket.id);
    });

    socket.on('error', (error) => {
      console.error(`WebSocket error for user ${socket.user.email}:`, error);
    });
  });

  // Store io instance for use in other modules
  global.io = io;

  return io;
}

// Check if user is allowed to subscribe to a channel
function isChannelAllowed(channel, userRole) {
  const publicChannels = [
    'dns:stats',
    'proxy:stats',
    'system:health'
  ];
  
  const adminChannels = [
    'dns:queries',
    'admin:users',
    'admin:logs',
    'admin:config'
  ];

  if (publicChannels.includes(channel)) {
    return true;
  }

  if (adminChannels.includes(channel) && userRole === 'admin') {
    return true;
  }

  return false;
}

// Broadcast functions for use in other modules
function broadcastToAll(event, data) {
  if (global.io) {
    global.io.to('authenticated').emit(event, data);
  }
}

function broadcastToAdmins(event, data) {
  if (global.io) {
    global.io.to('admin').emit(event, data);
  }
}

function broadcastToChannel(channel, event, data) {
  if (global.io) {
    global.io.to(channel).emit(event, data);
  }
}

// Get connected clients info (for admin dashboard)
function getConnectedClients() {
  const clients = Array.from(connectedClients.values()).map(client => ({
    id: client.socket.id,
    user: client.user,
    connectedAt: client.connectedAt,
    rooms: Array.from(client.socket.rooms)
  }));
  
  return clients;
}

// Send real-time DNS query updates
function broadcastDnsQuery(query) {
  broadcastToChannel('dns:queries', 'dns:new_query', {
    ...query,
    timestamp: new Date().toISOString()
  });
}

// Send real-time DNS stats updates
function broadcastDnsStats(stats) {
  broadcastToChannel('dns:stats', 'dns:stats_update', {
    ...stats,
    timestamp: new Date().toISOString()
  });
}

// Send system health updates
function broadcastSystemHealth(health) {
  broadcastToChannel('system:health', 'system:health_update', {
    ...health,
    timestamp: new Date().toISOString()
  });
}

// Send proxy stats updates
function broadcastProxyStats(stats) {
  broadcastToChannel('proxy:stats', 'proxy:stats_update', {
    ...stats,
    timestamp: new Date().toISOString()
  });
}

// Send admin notifications
function broadcastAdminNotification(notification) {
  broadcastToAdmins('admin:notification', {
    ...notification,
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  setupWebSocket,
  broadcastToAll,
  broadcastToAdmins,
  broadcastToChannel,
  getConnectedClients,
  broadcastDnsQuery,
  broadcastDnsStats,
  broadcastSystemHealth,
  broadcastProxyStats,
  broadcastAdminNotification
};
