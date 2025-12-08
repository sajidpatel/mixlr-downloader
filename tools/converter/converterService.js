import EventEmitter from 'events';
import { convertDirectory, formatSummary } from './converter.js';

class ConverterService extends EventEmitter {
  constructor({
    convertFn = convertDirectory,
    summaryFn = formatSummary,
    logger = console,
    defaultInputDir = 'recordings',
  } = {}) {
    super();
    this.convertFn = convertFn;
    this.summaryFn = summaryFn;
    this.logger = logger;
    this.defaultInputDir = defaultInputDir;
    this.queue = [];
    this.running = false;
    this.lastSummary = null;
  }

  enqueue(options = {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({ options, resolve, reject });
      this.#processQueue();
    });
  }

  getLastSummary() {
    return this.lastSummary;
  }

  isRunning() {
    return this.running;
  }

  pendingCount() {
    return this.queue.length + (this.running ? 1 : 0);
  }

  async #processQueue() {
    if (this.running) return;
    const job = this.queue.shift();
    if (!job) return;

    this.running = true;
    const { options, resolve, reject } = job;
    const normalized = this.#normalizeOptions(options);
    this.emit('start', normalized);

    try {
      const summary = await this.convertFn({
        ...normalized,
        onLog: normalized.onLog,
      });
      const enriched = this.#buildSummary(summary, normalized);
      this.lastSummary = enriched;
      this.emit('finish', enriched);
      this.emit('summary', enriched);
      resolve(enriched);
    } catch (err) {
      if (this.listenerCount('error') > 0) {
        this.emit('error', err);
      }
      reject(err);
    } finally {
      this.running = false;
      setImmediate(() => this.#processQueue());
    }
  }

  #normalizeOptions(options) {
    const {
      inputDir = this.defaultInputDir,
      deleteSource = false,
      onLog = this.logger?.log ? this.logger.log.bind(this.logger) : console.log,
    } = options || {};
    return { inputDir, deleteSource, onLog };
  }

  #buildSummary(summary, { inputDir, deleteSource }) {
    return {
      ...summary,
      inputDir,
      deleteSource,
      ranAt: new Date().toISOString(),
      summaryText: this.summaryFn(summary),
    };
  }
}

export default ConverterService;
