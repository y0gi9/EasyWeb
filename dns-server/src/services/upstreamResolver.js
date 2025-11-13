const dgram = require('dgram');
const { Packet } = require('dns2');
const { logger } = require('../config/logger');

class UpstreamResolver {
  constructor({ upstreams = ['8.8.8.8', '1.1.1.1'], timeout = 2000 } = {}) {
    this.upstreams = Array.isArray(upstreams) && upstreams.length > 0
      ? upstreams
      : ['8.8.8.8', '1.1.1.1'];
    this.timeout = timeout;
  }

  updateUpstreams(upstreams = []) {
    if (Array.isArray(upstreams) && upstreams.length > 0) {
      this.upstreams = upstreams;
      logger.info(`Updated upstream DNS servers: ${this.upstreams.join(', ')}`);
    }
  }

  updateTimeout(timeout) {
    const parsed = Number(timeout);
    if (!Number.isNaN(parsed) && parsed > 0) {
      this.timeout = parsed;
    }
  }

  async resolve(request) {
    if (!request || !Array.isArray(request.questions) || request.questions.length === 0) {
      throw new Error('Invalid DNS request');
    }

    const payload = this._encodeRequest(request);

    const attempted = [];
    for (const upstream of this.upstreams) {
      const startedAt = Date.now();
      try {
        const buffer = await this._sendUdp(payload, upstream);
        const elapsed = Date.now() - startedAt;
        const packet = Packet.parse(buffer);
        return {
          buffer,
          packet,
          upstream,
          elapsed
        };
      } catch (error) {
        attempted.push({ upstream, error: error.message });
        logger.warn(`Upstream ${upstream} failed: ${error.message}`);
      }
    }

    const detail = attempted.map((item) => `${item.upstream} (${item.error})`).join(', ');
    throw new Error(`All upstream servers failed: ${detail}`);
  }

  _encodeRequest(request) {
    try {
      // dns2 Packet exposes toBuffer for serialization
      return request.toBuffer();
    } catch (error) {
      throw new Error(`Failed to encode DNS request: ${error.message}`);
    }
  }

  _sendUdp(message, upstream) {
    return new Promise((resolve, reject) => {
      const client = dgram.createSocket('udp4');
      let timeoutHandle;

      const cleanUp = (err, data) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        client.removeAllListeners('message');
        client.removeAllListeners('error');
        client.close();
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      };

      client.once('message', (response) => {
        if (!response || response.length === 0) {
          cleanUp(new Error('Empty response'));
          return;
        }
        cleanUp(null, Buffer.from(response));
      });

      client.once('error', (error) => {
        cleanUp(error);
      });

      timeoutHandle = setTimeout(() => {
        cleanUp(new Error('Upstream timeout'));
      }, this.timeout);

      const [host, maybePort] = upstream.split(':');
      const port = maybePort ? Number(maybePort) : 53;

      client.send(message, port, host, (error) => {
        if (error) {
          cleanUp(error);
        }
      });
    });
  }
}

module.exports = { UpstreamResolver };
