const dns = require('dns2');
const { Packet } = dns;

const { initDatabase } = require('./config/database');
const { logger } = require('./config/logger');
const { BlocklistManager } = require('./services/blocklistManager');
const { QueryLogger } = require('./services/queryLogger');
const { ScheduledTasks } = require('./services/scheduledTasks');
const { SettingsManager } = require('./services/settingsManager');
const { ResponseCache } = require('./services/responseCache');
const { UpstreamResolver } = require('./services/upstreamResolver');
const { StatsTracker } = require('./services/statsTracker');
const { LocalRecordManager } = require('./services/localRecordManager');

const DEFAULT_BLOCK_IPv4 = '0.0.0.0';
const DEFAULT_BLOCK_IPv6 = '::';

async function start() {
  await initDatabase();

  const settingsManager = new SettingsManager();
  const settings = await settingsManager.load();

  const blocklistManager = new BlocklistManager();
  await blocklistManager.initialize();

  const responseCache = new ResponseCache(settings.cache);
  const upstreamResolver = new UpstreamResolver({
    upstreams: settings.upstreams,
    timeout: settings.resolverTimeoutMs
  });

  const queryLogger = new QueryLogger();
  queryLogger.setEnabled(settings.loggingEnabled);

  const statsTracker = new StatsTracker();
  const localRecordManager = new LocalRecordManager();
  await localRecordManager.initialize();

  const scheduledTasks = new ScheduledTasks(blocklistManager);
  scheduledTasks.start();

  settingsManager.startPolling({
    onConfigChange: (snapshot) => {
      responseCache.applyConfig(snapshot.cache);
      upstreamResolver.updateUpstreams(snapshot.upstreams);
      upstreamResolver.updateTimeout(snapshot.resolverTimeoutMs);
      queryLogger.setEnabled(snapshot.loggingEnabled);
      localRecordManager.reload().catch((error) => {
        logger.error('Failed to reload local DNS records after config change:', error);
      });
    },
    onBlocklistChange: async () => {
      try {
        await blocklistManager.reloadOverrides();
        await blocklistManager.reloadBlocklists();
      } catch (error) {
        logger.error('Failed to reload blocklists after configuration change:', error);
      }
    },
    onCacheFlush: () => {
      responseCache.flush();
      logger.info('DNS cache flushed in response to control command');
    }
  });

  const port = Number(process.env.DNS_PORT || 53);

  const server = dns.createServer({
    udp: true,
    tcp: true,
    handle: async (request, send, rinfo) => {
      await handleRequest({
        request,
        send,
        rinfo,
        settingsManager,
        blocklistManager,
        responseCache,
        upstreamResolver,
        queryLogger,
        statsTracker,
        localRecordManager
      });
    }
  });

  server.on('requestError', (error) => {
    logger.error('Client sent invalid DNS request:', error.message);
  });

  server.on('listening', () => {
    const addresses = server.addresses();
    logger.info(`DNS server listening on ${JSON.stringify(addresses)}`);
  });

  server.on('close', () => {
    logger.info('DNS server closed');
  });

  await server.listen({
    udp: port,
    tcp: port
  });

  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down DNS server');
    settingsManager.stopPolling();
    scheduledTasks.stop();
    await queryLogger.flushBatch();
    await server.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down DNS server');
    settingsManager.stopPolling();
    scheduledTasks.stop();
    await queryLogger.flushBatch();
    await server.close();
    process.exit(0);
  });
}

async function handleRequest(context) {
  const {
    request,
    send,
    rinfo,
    settingsManager,
    blocklistManager,
    responseCache,
    upstreamResolver,
    queryLogger,
    statsTracker,
    localRecordManager
  } = context;

  const start = Date.now();
  const snapshot = settingsManager.getSnapshot();
  const question = (request.questions || [])[0];

  if (!question || !question.name) {
    return;
  }

  const domain = question.name.toLowerCase();
  const typeName = getTypeName(question.type);
  const clientIp = rinfo?.address || '0.0.0.0';

  let outcome = 'forwarded';
  let reason = 'not_listed';
  let upstream = null;
  let latencyMs = 0;
  let cacheHit = false;

  try {
    // Attempt cache lookup first
    if (snapshot.cache.enabled) {
      const cached = responseCache.get(question);
      if (cached) {
        const response = Packet.createResponseFromRequest(request);
        response.header.rcode = cached.header.rcode ?? 0;
        response.header.aa = cached.header.aa ?? 0;
        response.header.ra = cached.header.ra ?? 1;
        response.header.rd = request.header.rd;

        response.answers = cached.answers.map((answer) => ({
          ...answer,
          ttl: Math.max(1, Math.min(answer.ttl, cached.remainingTtl))
        }));
        response.authority = cached.authority.map((record) => ({ ...record }));
        response.additional = cached.additional.map((record) => ({ ...record }));

        send(response);

        cacheHit = true;
        outcome = 'cached';
        reason = 'cache_hit';
        latencyMs = Date.now() - start;

        queryLogger.logQuery({
          client_ip: clientIp,
          domain,
          query_type: typeName,
          response: outcome,
          reason,
          response_time: latencyMs,
          upstream: null,
          cache_hit: true,
          timestamp: new Date()
        });

        statsTracker.record({ outcome, latencyMs });
        return;
      }
    }

    const localAnswers = localRecordManager.getAnswers(question);
    if (localAnswers) {
      const response = Packet.createResponseFromRequest(request);
      response.header.rcode = 0;
      response.header.aa = 1;
      response.header.ra = 1;
      response.answers = localAnswers;
      response.authority = [];
      response.additional = [];
      send(response);

      outcome = 'local';
      reason = 'local_record';
      latencyMs = Date.now() - start;

      queryLogger.logQuery({
        client_ip: clientIp,
        domain,
        query_type: typeName,
        response: outcome,
        reason,
        response_time: latencyMs,
        upstream: 'local',
        cache_hit: false,
        timestamp: new Date()
      });

      statsTracker.record({ outcome, latencyMs });
      return;
    }

    const filterActive = settingsManager.shouldFilter();
    let evaluation = { action: 'allow', reason: 'not_listed' };

    if (filterActive) {
      evaluation = blocklistManager.evaluate(domain);
    } else {
      reason = 'filter_disabled';
    }

    if (filterActive && evaluation.action === 'block') {
      const response = buildBlockedResponse(request, question, snapshot.blockResponse);
      send(response);
      outcome = 'blocked';
      reason = evaluation.reason;
      latencyMs = Date.now() - start;

      queryLogger.logQuery({
        client_ip: clientIp,
        domain,
        query_type: typeName,
        response: outcome,
        reason,
        response_time: latencyMs,
        upstream: null,
        cache_hit: false,
        timestamp: new Date()
      });

      statsTracker.record({ outcome, latencyMs });
      return;
    }

    // Forward to upstream resolver
    let upstreamResponse;
    try {
      upstreamResponse = await upstreamResolver.resolve(request);
      upstream = upstreamResponse.upstream;
      latencyMs = upstreamResponse.elapsed;
    } catch (error) {
      logger.error(`Upstream resolution failed for ${domain}: ${error.message}`);
      const response = Packet.createResponseFromRequest(request);
      response.header.rcode = 2; // SERVFAIL
      response.answers = [];
      response.authority = [];
      response.additional = [];
      send(response);

      outcome = 'error';
      reason = 'upstream_error';
      latencyMs = Date.now() - start;

      queryLogger.logQuery({
        client_ip: clientIp,
        domain,
        query_type: typeName,
        response: outcome,
        reason,
        response_time: latencyMs,
        upstream: null,
        cache_hit: false,
        timestamp: new Date()
      });

      statsTracker.record({ outcome, latencyMs });
      return;
    }

    if (!upstreamResponse || !upstreamResponse.packet) {
      const response = Packet.createResponseFromRequest(request);
      response.header.rcode = 2;
      send(response);

      outcome = 'error';
      reason = 'empty_upstream_response';
      latencyMs = Date.now() - start;

      queryLogger.logQuery({
        client_ip: clientIp,
        domain,
        query_type: typeName,
        response: outcome,
        reason,
        response_time: latencyMs,
        upstream: upstream,
        cache_hit: false,
        timestamp: new Date()
      });

      statsTracker.record({ outcome, latencyMs });
      return;
    }

    const upstreamPacket = upstreamResponse.packet;
    send(upstreamPacket);

    if (snapshot.cache.enabled && upstreamPacket.answers && upstreamPacket.answers.length > 0) {
      responseCache.set(question, upstreamPacket);
    }

    outcome = 'forwarded';
    reason = evaluation.reason || 'forwarded';

    queryLogger.logQuery({
      client_ip: clientIp,
      domain,
      query_type: typeName,
      response: outcome,
      reason,
      response_time: latencyMs,
      upstream,
      cache_hit: false,
      timestamp: new Date()
    });

    statsTracker.record({ outcome, latencyMs });
  } catch (error) {
    logger.error('Unhandled error processing DNS request:', error);
    const response = Packet.createResponseFromRequest(request);
    response.header.rcode = 2;
    send(response);

    outcome = 'error';
    reason = 'unexpected_error';
    latencyMs = Date.now() - start;

    queryLogger.logQuery({
      client_ip: clientIp,
      domain,
      query_type: typeName,
      response: outcome,
      reason,
      response_time: latencyMs,
      upstream: null,
      cache_hit: false,
      timestamp: new Date()
    });

    statsTracker.record({ outcome, latencyMs });
  }
}

function buildBlockedResponse(request, question, blockResponseMode) {
  const response = Packet.createResponseFromRequest(request);
  response.answers = [];
  response.authority = [];
  response.additional = [];
  response.header.aa = 1;
  response.header.ra = 1;

  if (blockResponseMode === 'nxdomain') {
    response.header.rcode = 3; // NXDOMAIN
    return response;
  }

  response.header.rcode = 0;

  if (question.type === Packet.TYPE.A) {
    response.answers.push({
      name: question.name,
      type: Packet.TYPE.A,
      class: Packet.CLASS.IN,
      ttl: 60,
      address: DEFAULT_BLOCK_IPv4
    });
  } else if (question.type === Packet.TYPE.AAAA) {
    response.answers.push({
      name: question.name,
      type: Packet.TYPE.AAAA,
      class: Packet.CLASS.IN,
      ttl: 60,
      address: DEFAULT_BLOCK_IPv6
    });
  }

  return response;
}

function getTypeName(type) {
  const entries = Object.entries(Packet.TYPE || {});
  for (const [name, value] of entries) {
    if (value === type) {
      return name;
    }
  }
  return `TYPE_${type}`;
}

start().catch((error) => {
  logger.error('Fatal error starting DNS server:', error);
  process.exit(1);
});
