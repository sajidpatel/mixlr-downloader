import fs from 'fs/promises';
import path from 'path';

class PlayCountStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.counts = new Map();
    this.ready = this.load();
  }

  async load() {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(data || '{}');
      this.counts = new Map(Object.entries(parsed));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`play count load failed: ${err.message}`);
      }
      this.counts = new Map();
    }
  }

  async save() {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const obj = Object.fromEntries(this.counts);
    await fs.writeFile(this.filePath, JSON.stringify(obj, null, 2), 'utf8');
  }

  async increment(key) {
    if (!key) return 0;
    await this.ready;
    const next = (this.counts.get(key) || 0) + 1;
    this.counts.set(key, next);
    await this.save();
    return next;
  }

  async set(key, value) {
    if (!key) return;
    await this.ready;
    this.counts.set(key, value);
    await this.save();
  }

  get(key) {
    return this.counts.get(key) || 0;
  }

  async getAll() {
    await this.ready;
    return Object.fromEntries(this.counts);
  }
}

export default PlayCountStore;
