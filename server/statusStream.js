const defaultIntervalMs = 5000;
const heartbeatMs = 25_000;

export class StatusBroadcaster {
  constructor({ recorderService, converterService, recordingsRoot, intervalMs = defaultIntervalMs, logger = console }) {
    this.recorderService = recorderService;
    this.converterService = converterService;
    this.recordingsRoot = recordingsRoot;
    this.intervalMs = intervalMs;
    this.logger = logger;
    this.clients = new Set();
    this.timer = null;
    this.heartbeatTimer = null;
    this.lastPayloadString = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.broadcast(), this.intervalMs);
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), heartbeatMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.timer = null;
    this.heartbeatTimer = null;
  }

  async buildPayload() {
    const status = await this.recorderService.buildStatusPayload({ recordingsRoot: this.recordingsRoot });
    return { ...status, converter: this.converterService.getLastSummary() };
  }

  async broadcast(force = false) {
    if (!this.clients.size) return;
    try {
      const payload = await this.buildPayload();
      const serialized = JSON.stringify(payload);
      if (!force && serialized === this.lastPayloadString) return;
      this.lastPayloadString = serialized;
      const data = `data: ${serialized}\n\n`;
      this.clients.forEach((res) => {
        try {
          res.write(data);
        } catch (err) {
          this.logger.warn?.(`Status stream write failed: ${err.message}`);
        }
      });
    } catch (err) {
      this.logger.error?.(`Status stream broadcast failed: ${err.message}`);
    }
  }

  sendHeartbeat() {
    if (!this.clients.size) return;
    const line = ': keep-alive\n\n';
    this.clients.forEach((res) => {
      try {
        res.write(line);
      } catch (err) {
        this.logger.warn?.(`Status heartbeat failed: ${err.message}`);
      }
    });
  }

  addClient(res) {
    this.clients.add(res);
    const cleanup = () => this.clients.delete(res);
    res.on('close', cleanup);
    res.on('error', cleanup);
    // send initial payload immediately
    this.broadcast(true);
  }
}

export default StatusBroadcaster;








