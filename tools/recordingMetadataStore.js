import fs from 'fs/promises';
import path from 'path';

class RecordingMetadataStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.meta = new Map();
    this.ready = this.load();
  }

  async load() {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(data || '{}');
      this.meta = new Map(Object.entries(parsed));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`metadata load failed: ${err.message}`);
      }
      this.meta = new Map();
    }
  }

  async save() {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    // Convert Map to object for JSON serialization
    // We sort keys to keep the file stable
    const obj = Object.fromEntries(
      [...this.meta.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    );
    await fs.writeFile(this.filePath, JSON.stringify(obj, null, 2), 'utf8');
  }

  async set(key, value) {
    if (!key) return;
    await this.ready;
    this.meta.set(key, value);
  }

  get(key) {
    return this.meta.get(key);
  }

  async saveAll() {
    await this.save();
  }
}

export default RecordingMetadataStore;
