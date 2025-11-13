const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const { initDatabase } = require('./config/database');
const { initRedis } = require('./config/redis');
const authRoutes = require('./routes/auth');
const dnsRoutes = require('./routes/dns');
const { router: proxyRoutes, publicRouter: proxyPublicRoutes } = require('./routes/proxy');
const dashboardRoutes = require('./routes/dashboard');
const { authenticateToken } = require('./middleware/auth');
const { setupWebSocket } = require('./services/websocket');
const { syncNginxConfig } = require('./services/proxyConfig');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : '*',
    methods: ['GET', 'POST']
  }
});

const enableCloudflareTunnel = process.env.CLOUDFLARE_TUNNEL === 'true';

if (enableCloudflareTunnel) {
  app.set('trust proxy', 1); // respect x-forwarded-* headers when behind Cloudflare
}

const PORT = process.env.PORT || 3001;

// Rate limiting
const rateLimitEnabled = process.env.RATE_LIMIT_ENABLED !== 'false';
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || (5 * 60 * 1000); // default 5 minutes
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX) || 1000;

const limiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));
app.use(compression());
if (rateLimitEnabled) {
  app.use(limiter);
}
app.use(morgan('combined'));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? process.env.FRONTEND_URL : true,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/dns', authenticateToken, dnsRoutes);
app.use('/api/proxy/public', proxyPublicRoutes);
app.use('/api/proxy', authenticateToken, proxyRoutes);
app.use('/api/dashboard', authenticateToken, dashboardRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal Server Error' 
    : err.message;

  res.status(statusCode).json({
    error: true,
    message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// Initialize services and start server
async function startServer() {
  try {
    // Initialize database
    await initDatabase();
    console.log('Database initialized');

    // Initialize Redis
    await initRedis();
    console.log('Redis initialized');

    try {
      const { pathFilePath, serverFilePath, upstreamsCount } = await syncNginxConfig();
      console.log(`Proxy configuration synced to ${pathFilePath} & ${serverFilePath} (${upstreamsCount} upstreams)`);
    } catch (error) {
      console.error('Failed to sync proxy configuration on startup:', error);
    }

    // Setup WebSocket
    setupWebSocket(io);
    console.log('WebSocket initialized');

    // Start server
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`EasyWeb Backend running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV}`);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

startServer();
