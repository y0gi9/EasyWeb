const cron = require('node-cron');
const { db } = require('../config/database');
const { logger } = require('../config/logger');

class ScheduledTasks {
  constructor(blocklistManager) {
    this.blocklistManager = blocklistManager;
    this.tasks = [];
  }

  start() {
    logger.info('Starting scheduled tasks...');

    // Update blocklists every 24 hours at 2 AM
    const blocklistUpdateTask = cron.schedule('0 2 * * *', async () => {
      try {
        logger.info('Starting scheduled blocklist update...');
        await this.blocklistManager.updateAllBlocklists();
        logger.info('Scheduled blocklist update completed');
      } catch (error) {
        logger.error('Scheduled blocklist update failed:', error);
      }
    }, {
      scheduled: false
    });

    // Clean old DNS queries every day at 3 AM
    const queryCleanupTask = cron.schedule('0 3 * * *', async () => {
      try {
        logger.info('Starting scheduled query cleanup...');
        await this.cleanupOldQueries();
        logger.info('Scheduled query cleanup completed');
      } catch (error) {
        logger.error('Scheduled query cleanup failed:', error);
      }
    }, {
      scheduled: false
    });

    // Update statistics cache every 15 minutes
    const statsUpdateTask = cron.schedule('*/15 * * * *', async () => {
      try {
        logger.debug('Updating DNS statistics...');
        await this.updateStatistics();
      } catch (error) {
        logger.error('Statistics update failed:', error);
      }
    }, {
      scheduled: false
    });

    // Health check every 5 minutes
    const healthCheckTask = cron.schedule('*/5 * * * *', async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        logger.error('Health check failed:', error);
      }
    }, {
      scheduled: false
    });

    this.tasks = [
      { name: 'blocklist-update', task: blocklistUpdateTask },
      { name: 'query-cleanup', task: queryCleanupTask },
      { name: 'stats-update', task: statsUpdateTask },
      { name: 'health-check', task: healthCheckTask }
    ];

    // Start all tasks
    this.tasks.forEach(({ name, task }) => {
      task.start();
      logger.info(`Started scheduled task: ${name}`);
    });

    // Run initial updates
    this.initialUpdate();
  }

  async initialUpdate() {
    try {
      // Update statistics immediately on startup
      await this.updateStatistics();
      
      // Perform initial health check
      await this.performHealthCheck();
    } catch (error) {
      logger.error('Initial update failed:', error);
    }
  }

  async cleanupOldQueries() {
    try {
      // Get retention setting from database
      const retentionSetting = await db()('settings')
        .where('key', 'log_retention_days')
        .first();

      const retentionDays = retentionSetting ? parseInt(retentionSetting.value) : 30;
      const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      const deletedCount = await db()('dns_queries')
        .where('timestamp', '<', cutoffDate)
        .del();

      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} old DNS queries (older than ${retentionDays} days)`);
      }

      // Also clean up old session data
      const sessionDeletedCount = await db()('sessions')
        .where('expires_at', '<', new Date())
        .del();

      if (sessionDeletedCount > 0) {
        logger.info(`Cleaned up ${sessionDeletedCount} expired sessions`);
      }

      return { queries: deletedCount, sessions: sessionDeletedCount };
    } catch (error) {
      logger.error('Failed to cleanup old data:', error);
      throw error;
    }
  }

  async updateStatistics() {
    try {
      // This could update cached statistics or trigger WebSocket updates
      // For now, we'll just log that we're updating
      logger.debug('Statistics update completed');
    } catch (error) {
      logger.error('Failed to update statistics:', error);
      throw error;
    }
  }

  async performHealthCheck() {
    try {
      // Check database connectivity
      await db().raw('SELECT 1');
      
      // Check blocklist manager status
      const blocklistStats = this.blocklistManager.getStats();
      
      if (!blocklistStats.initialized) {
        logger.warn('Blocklist manager not initialized');
      }
      
      if (blocklistStats.blocked_domains === 0) {
        logger.warn('No blocked domains loaded');
      }
      
      logger.debug(`Health check passed - ${blocklistStats.blocked_domains} blocked domains loaded`);
    } catch (error) {
      logger.error('Health check failed:', error);
      throw error;
    }
  }

  async triggerBlocklistUpdate() {
    try {
      logger.info('Manual blocklist update triggered...');
      await this.blocklistManager.updateAllBlocklists();
      logger.info('Manual blocklist update completed');
      return true;
    } catch (error) {
      logger.error('Manual blocklist update failed:', error);
      throw error;
    }
  }

  stop() {
    logger.info('Stopping scheduled tasks...');
    
    this.tasks.forEach(({ name, task }) => {
      task.stop();
      logger.info(`Stopped scheduled task: ${name}`);
    });
    
    this.tasks = [];
  }

  getTaskStatus() {
    return this.tasks.map(({ name, task }) => ({
      name,
      running: task.running || false,
      scheduled: task.scheduled || false
    }));
  }
}

module.exports = { ScheduledTasks };