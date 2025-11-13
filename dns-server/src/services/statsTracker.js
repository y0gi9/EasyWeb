class StatsTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.startedAt = Date.now();
    this.counters = {
      total: 0,
      blocked: 0,
      forwarded: 0,
      cached: 0,
      local: 0,
      errors: 0
    };
    this.latency = {
      totalMs: 0,
      samples: 0
    };
  }

  record({ outcome, latencyMs }) {
    this.counters.total += 1;

    switch (outcome) {
      case 'blocked':
        this.counters.blocked += 1;
        break;
      case 'forwarded':
        this.counters.forwarded += 1;
        break;
      case 'cached':
        this.counters.cached += 1;
        break;
      case 'local':
        this.counters.local += 1;
        break;
      case 'error':
        this.counters.errors += 1;
        break;
      default:
        break;
    }

    if (typeof latencyMs === 'number' && latencyMs >= 0) {
      this.latency.totalMs += latencyMs;
      this.latency.samples += 1;
    }
  }

  getSnapshot() {
    const uptimeSeconds = Math.floor((Date.now() - this.startedAt) / 1000);
    const averageLatency = this.latency.samples > 0
      ? Number((this.latency.totalMs / this.latency.samples).toFixed(2))
      : 0;

    return {
      uptime_seconds: uptimeSeconds,
      total_queries: this.counters.total,
      blocked_queries: this.counters.blocked,
      forwarded_queries: this.counters.forwarded,
      cached_queries: this.counters.cached,
      local_queries: this.counters.local,
      error_count: this.counters.errors,
      average_latency_ms: averageLatency
    };
  }
}

module.exports = { StatsTracker };
