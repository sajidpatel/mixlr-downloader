import { STATUS_POLL_INTERVAL_MS } from './config.js';

export class StatusPoller {
  constructor({
    recorderService,
    converterService,
    recordingsRoot,
    intervalMs = STATUS_POLL_INTERVAL_MS,
    logger = console,
  }) {
    this.recorderService = recorderService;
    this.converterService = converterService;
    this.recordingsRoot = recordingsRoot;
    this.intervalMs = intervalMs;
    this.logger = logger;
    this.timer = null;
    this.latest = null;
  }

  async poll() {
    const status = await this.recorderService.buildStatusPayload({
      recordingsRoot: this.recordingsRoot,
    });
    const payload = { ...status, converter: this.converterService.getLastSummary() };
    this.latest = payload;
    return payload;
  }

  async getLatest({ refresh = false } = {}) {
    if (!refresh && this.latest) return this.latest;
    try {
      return await this.poll();
    } catch (err) {
      this.logger.error?.(`Background status poll failed: ${err.message}`);
      return this.latest;
    }
  }

  start() {
    if (this.timer) return;
    this.getLatest({ refresh: true });
    this.timer = setInterval(() => {
      this.getLatest({ refresh: true });
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getCached() {
    return this.latest;
  }
}

export default StatusPoller;
