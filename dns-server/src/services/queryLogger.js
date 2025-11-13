const { db } = require('../config/database');
const { logger } = require('../config/logger');

class QueryLogger {
  constructor() {
    this.batchSize = 100;
    this.flushInterval = 5000; // 5 seconds
    this.queryBatch = [];
    this.flushTimer = null;
    this.enabled = true;
    
    this.startBatchFlushing();
  }

  async logQuery(queryData) {
    if (!this.enabled) {
      return;
    }

    try {
      // Add to batch
      this.queryBatch.push({
        client_ip: queryData.client_ip,
        domain: queryData.domain,
        query_type: queryData.query_type,
        response: queryData.response,
        reason: queryData.reason,
        response_time: queryData.response_time || 0,
         upstream: queryData.upstream || null,
         cache_hit: queryData.cache_hit ? 1 : 0,
        timestamp: queryData.timestamp || new Date()
      });

      // Flush if batch is full
      if (this.queryBatch.length >= this.batchSize) {
        await this.flushBatch();
      }
    } catch (error) {
      logger.error('Failed to log DNS query:', error);
    }
  }

  async flushBatch() {
    if (this.queryBatch.length === 0) return;

    let batch;
    try {
      batch = this.queryBatch.splice(0);
      if (batch.length === 0) {
        return;
      }
      await db()('dns_queries').insert(batch);
      logger.debug(`Flushed ${batch.length} DNS queries to database`);
    } catch (error) {
      logger.error('Failed to flush query batch:', error);
      if (error && error.message && error.message.includes('no such table')) {
        // table might not be ready yet – drop the entries rather than crashing
        return;
      }
      // Put queries back in batch on failure if possible
      if (Array.isArray(batch) && batch.length > 0) {
        this.queryBatch.unshift(...batch);
      }
    }
  }

  startBatchFlushing() {
    this.flushTimer = setInterval(async () => {
      await this.flushBatch();
    }, this.flushInterval);
  }

  async stop() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    
    // Flush any remaining queries
    await this.flushBatch();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  async getQueryStats(timeframe = '24h') {
    try {
      const timeframes = {
        '1h': 1,
        '24h': 24,
        '7d': 24 * 7,
        '30d': 24 * 30
      };

      const hours = timeframes[timeframe] || 24;
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      const stats = await db()('dns_queries')
        .where('timestamp', '>=', since)
        .select(
          db().raw('COUNT(*) as total_queries'),
          db().raw("SUM(CASE WHEN response = 'blocked' THEN 1 ELSE 0 END) as blocked_queries"),
          db().raw("SUM(CASE WHEN response = 'allowed' OR response = 'forwarded' THEN 1 ELSE 0 END) as allowed_queries"),
          db().raw('AVG(response_time) as avg_response_time')
        )
        .first();

      return {
        total_queries: parseInt(stats.total_queries),
        blocked_queries: parseInt(stats.blocked_queries),
        allowed_queries: parseInt(stats.allowed_queries),
        avg_response_time: parseFloat(stats.avg_response_time).toFixed(2),
        timeframe
      };
    } catch (error) {
      logger.error('Failed to get query stats:', error);
      throw error;
    }
  }

  async getTopDomains(limit = 10, blocked = false) {
    try {
      let query = db()('dns_queries')
        .select('domain')
        .count('* as query_count')
        .groupBy('domain')
        .orderBy('query_count', 'desc')
        .limit(limit);

      if (blocked) {
        query = query.where('response', 'blocked');
      }

      const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
      query = query.where('timestamp', '>=', last24Hours);

      const results = await query;
      return results.map(row => ({
        domain: row.domain,
        count: parseInt(row.query_count)
      }));
    } catch (error) {
      logger.error('Failed to get top domains:', error);
      throw error;
    }
  }

  async getTopClients(limit = 10) {
    try {
      const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const results = await db()('dns_queries')
        .select('client_ip')
        .count('* as query_count')
        .sum(db().raw("CASE WHEN response = 'blocked' THEN 1 ELSE 0 END as blocked_count"))
        .where('timestamp', '>=', last24Hours)
        .groupBy('client_ip')
        .orderBy('query_count', 'desc')
        .limit(limit);

      return results.map(row => ({
        client_ip: row.client_ip,
        query_count: parseInt(row.query_count),
        blocked_count: parseInt(row.blocked_count),
        allowed_count: parseInt(row.query_count) - parseInt(row.blocked_count)
      }));
    } catch (error) {
      logger.error('Failed to get top clients:', error);
      throw error;
    }
  }

  async cleanOldQueries(retentionDays = 30) {
    try {
      const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      
      const deleted = await db()('dns_queries')
        .where('timestamp', '<', cutoffDate)
        .del();

      if (deleted > 0) {
        logger.info(`Cleaned up ${deleted} old DNS queries (older than ${retentionDays} days)`);
      }

      return deleted;
    } catch (error) {
      logger.error('Failed to clean old queries:', error);
      throw error;
    }
  }
}

module.exports = { QueryLogger };
