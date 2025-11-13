const redis = require('redis');

let redisClient;

async function initRedis() {
  try {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    redisClient = redis.createClient({
      url: redisUrl,
      retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
          console.error('Redis connection refused');
          return new Error('Redis connection refused');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
          return new Error('Redis retry time exhausted');
        }
        if (options.attempt > 10) {
          return new Error('Redis retry attempts exhausted');
        }
        return Math.min(options.attempt * 100, 3000);
      }
    });

    redisClient.on('error', (err) => {
      console.error('Redis client error:', err);
    });

    redisClient.on('connect', () => {
      console.log('Connected to Redis');
    });

    redisClient.on('ready', () => {
      console.log('Redis client ready');
    });

    redisClient.on('end', () => {
      console.log('Redis connection closed');
    });

    await redisClient.connect();
    
    // Test connection
    await redisClient.ping();
    console.log('Redis connection established');
    
    return redisClient;
  } catch (error) {
    console.error('Redis connection failed:', error);
    // Don't throw error, app can work without Redis (just less caching)
    redisClient = null;
    return null;
  }
}

function getRedisClient() {
  return redisClient;
}

// Cache helper functions
async function cacheSet(key, value, ttlSeconds = 3600) {
  if (!redisClient) return false;
  try {
    await redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error('Cache set error:', error);
    return false;
  }
}

async function cacheGet(key) {
  if (!redisClient) return null;
  try {
    const value = await redisClient.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error('Cache get error:', error);
    return null;
  }
}

async function cacheDel(key) {
  if (!redisClient) return false;
  try {
    await redisClient.del(key);
    return true;
  } catch (error) {
    console.error('Cache delete error:', error);
    return false;
  }
}

async function cacheFlush() {
  if (!redisClient) return false;
  try {
    await redisClient.flushAll();
    return true;
  } catch (error) {
    console.error('Cache flush error:', error);
    return false;
  }
}

module.exports = {
  initRedis,
  getRedisClient,
  cacheSet,
  cacheGet,
  cacheDel,
  cacheFlush
};