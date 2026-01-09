import { spawn } from 'child_process';
import { mkdir, readdir, stat, unlink } from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import processAdapter from '../process/processAdapter.js';

const API_BASE_URL = 'https://apicdn.mixlr.com/v3/channel_view/';

export const DEFAULT_CHANNELS = [
  'shaykh-bilal',
  'tafseerraheemi',
  'idauk',
  'khanqahblackburn',
  'spiritual-light',
  'attabligweb',
  'shaykhyunushaleebi',
  'croydonmosque',
  'muftiahmedkhanpuri',
];

const safeFetch = (...args) => (globalThis.fetch ? globalThis.fetch(...args) : fetch(...args));

/**
 * Convert a channel identifier or display name into a normalized slug used by the API.
 *
 * @param {string|any} channel - Channel name, slug, or value coercible to string; null/undefined returns an empty string.
 * @returns {string} The normalized slug (lowercased and trimmed) or a mapped alias; returns an empty string for falsy input.
 */
function normalizeChannelSlug(channel) {
  if (!channel) return '';
  const raw = channel.toString().trim().toLowerCase();
  const aliases = {
    'dhikr majlis live': 'sufiuk', // user-facing name maps to slug
    "islamic da'wah academy": 'idauk',
  };
  if (aliases[raw]) return aliases[raw];
  return raw;
}

/**
 * Resolve a recordings root directory to an absolute filesystem path.
 *
 * @param {string} [rootDir] - Path to the recordings root; if omitted or falsy, the current working directory is used.
 * @returns {string} The resolved absolute path. 
 */
function normalizeRoot(rootDir) {
  return path.resolve(rootDir || '.');
}

function parseDateFromFilename(fileName) {
  const match = fileName.match(/_(\d{4}-\d{2}-\d{2}T[\d.-]+)\./);
  if (!match) return null;
  const normalized = match[1].replace(
    /T(\d{2})-(\d{2})-(\d{2})(\.\d+)?Z?/,
    (_m, h, m, s, frac = '') => `T${h}:${m}:${s}${frac}Z`,
  );
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function probeDurationSeconds(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', ['-v', 'quiet', '-of', 'csv=p=0', '-show_entries', 'format=duration', filePath]);
    let output = '';
    proc.stdout.on('data', (d) => {
      output += d.toString();
    });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      const seconds = parseFloat(output.trim());
      if (Number.isFinite(seconds)) resolve(seconds);
      else resolve(null);
    });
  });
}

function buildSafeRel(recordingsRoot, absPath) {
  const rel = path.relative(recordingsRoot, absPath);
  const safeRel = rel.split(path.sep).map(encodeURIComponent).join('/');
  const isSafe = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  return isSafe ? safeRel : null;
}

function normalizedExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.part') {
    const withoutPart = filePath.slice(0, -ext.length);
    return path.extname(withoutPart).toLowerCase();
  }
  return ext;
}

function contentTypeFor(filePath) {
  const ext = normalizedExt(filePath);
  switch (ext) {
    case '.mp3':
      return 'audio/mpeg';
    case '.aac':
      return 'audio/aac';
    case '.m4a':
      return 'audio/mp4';
    case '.webm':
      return 'audio/webm';
    default:
      return 'application/octet-stream';
  }
}

export class RecorderService {
  constructor(options = {}) {
    this.channels = options.channels ?? DEFAULT_CHANNELS;
    this.recordingsDir = options.recordingsDir ?? 'recordings';
    this.checkIntervalMs = options.checkIntervalMs ?? 60_000;
    this.stalledCheckIntervalMs = options.stalledCheckIntervalMs ?? 30_000;
    this.stalledTimeoutMs = options.stalledTimeoutMs ?? 60_000;
    this.runningProcesses = new Map();
    this.intervals = [];
    this.isMonitoring = false;
    this.logger = options.logger ?? console;
    this.processAdapter = options.processAdapter || processAdapter;
    this.mediaCache = new Map();
    this.mediaPrimed = false;
  }

  getRecordingsRoot() {
    return normalizeRoot(this.recordingsDir);
  }

  async primeMediaCache() {
    if (this.mediaPrimed) return;
    this.mediaPrimed = true;
    for (const slug of this.channels) {
      const key = slug.toLowerCase();
      const existing = this.mediaCache.get(key);
      if (existing) continue;
      try {
        await this.fetchAndCacheMedia(slug);
      } catch (err) {
        this.warn(`[${slug}] Media prime failed: ${err.message}`);
        if (!this.mediaCache.has(key)) this.mediaCache.set(key, null);
      }
    }
  }

  async fetchAndCacheMedia(channel) {
    const key = channel.toLowerCase();
    const data = await this.fetchStreamInfo(channel);
    const media = this.extractMedia(data);
    const stageName = this.resolveStageName(data);
    const stageKey = stageName?.toLowerCase();
    const withMeta = media ? { ...media, stageName, channelSlug: channel } : media;
    this.mediaCache.set(key, withMeta);
    if (stageKey && (!this.mediaCache.has(stageKey) || !this.mediaCache.get(stageKey))) {
      this.mediaCache.set(stageKey, withMeta);
    }
    return withMeta;
  }

  async resolveRecordingFile(info) {
    const { dir, name } = path.parse(info.path);
    const candidates = [
      path.join(dir, `${name}.aac`),
      path.join(dir, `${name}.aac.part`),
      info.path,
      `${info.path}.part`,
      path.join(dir, `${name}.webm`),
      path.join(dir, `${name}.webm.part`),
      path.join(dir, `${name}.m4a`),
      path.join(dir, `${name}.m4a.part`),
      path.join(dir, `${name}.mp4`),
      path.join(dir, `${name}.mp4.part`),
      path.join(dir, `${name}.unknown_video`),
      path.join(dir, `${name}.unknown_video.part`),
    ];

    for (const candidate of candidates) {
      try {
        const stats = await stat(candidate);
        return { path: candidate, stats };
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }

    return null;
  }

  log(message) {
    this.logger?.log ? this.logger.log(message) : console.log(message);
  }

  warn(message) {
    this.logger?.warn ? this.logger.warn(message) : console.warn(message);
  }

  error(message) {
    this.logger?.error ? this.logger.error(message) : console.error(message);
  }

  async ensureRecordingDir() {
    await mkdir(this.recordingsDir, { recursive: true });
  }

  resolveRecordingPath(relPath) {
    const decoded = decodeURIComponent(relPath || '');
    const normalized = path.normalize(decoded);
    const root = this.getRecordingsRoot();
    const filePath = path.join(root, normalized);
    if (!filePath.startsWith(root)) {
      throw new Error('Invalid path');
    }
    return filePath;
  }

  normalizedExt(filePath) {
    return normalizedExt(filePath);
  }

  contentTypeFor(filePath) {
    return contentTypeFor(filePath);
  }

  async getChannelMedia(channel) {
    if (!channel) return null;
    const key = channel.toLowerCase();
    const cached = this.mediaCache.get(key);
    if (cached) return cached;

    await this.primeMediaCache();

    try {
      const media = await this.fetchAndCacheMedia(channel);
      if (media) return media;
    } catch (err) {
      this.warn(`[${channel}] Media lookup failed: ${err.message}`);
      this.mediaCache.set(key, null);
    }

    // Fallback: try known channel slugs to find matching stage names.
    for (const slug of this.channels) {
      const slugKey = slug.toLowerCase();
      if (this.mediaCache.has(slugKey)) continue;
      try {
        await this.fetchAndCacheMedia(slug);
      } catch (err) {
        this.warn(`[${slug}] Media warmup failed: ${err.message}`);
        this.mediaCache.set(slugKey, null);
      }
    }

    // Direct cache hit (may be null) after warmup.
    if (this.mediaCache.has(key) && this.mediaCache.get(key)) return this.mediaCache.get(key);

    // Final fallback: search cache entries by stage name meta.
    for (const media of this.mediaCache.values()) {
      if (media?.stageName && media.stageName.toLowerCase() === key) {
        this.mediaCache.set(key, media);
        return media;
      }
    }

    return null;
  }

  extractMedia(data) {
    const attr = data?.data?.attributes || data?.attributes || {};
    const media = attr.media || data?.media || {};
    const pickImage = (entry) => {
      if (!entry) return null;
      if (typeof entry === 'string') return entry;
      const img = entry.image || entry;
      if (!img) return null;
      if (typeof img === 'string') return img;
      return img.medium || img.small || img.large || img.url || null;
    };
    const pickBlur = (entry) => {
      if (!entry) return null;
      const blur = entry.image_blur || entry.blur;
      if (!blur) return null;
      if (typeof blur === 'string') return blur;
      return blur.medium || blur.small || blur.large || blur.url || null;
    };

    const logo = pickImage(media.logo) || attr.profile_image_url || attr.logo_url || null;
    const logoBlur = pickBlur(media.logo) || null;
    const artwork = pickImage(media.artwork) || attr.artwork_url || null;
    const artworkBlur = pickBlur(media.artwork) || null;
    const themeColor = attr.theme_color || attr.themeColor || null;

    return { logo, logoBlur, artwork, artworkBlur, themeColor };
  }

  async fetchStreamInfo(channel) {
    try {
      const slug = normalizeChannelSlug(channel);
      const encodedSlug = slug ? encodeURIComponent(slug) : '';
      const response = await safeFetch(`${API_BASE_URL}${encodedSlug}`);
      if (!response.ok) {
        this.error(`[${slug}] Error fetching API: ${response.statusText}`);
        return null;
      }
      return await response.json();
    } catch (err) {
      const slug = channel?.toString().toLowerCase() || 'unknown-channel';
      this.error(`[${slug}] Error fetching data: ${err.message}`);
      return null;
    }
  }

  resolveStreamUrl(broadcast = {}) {
    const attr = broadcast.attributes || {};
    const streams = broadcast.streams || attr.streams || attr.stream || {};
    const candidates = [
      attr?.progressive_stream_url,
      broadcast.progressive_stream_url,
      streams?.mp3?.url,
      streams?.mp3,
      streams?.http_mp3_stream,
      streams?.http_stream,
      streams?.hls?.mp3?.url,
      streams?.hls?.url,
    ];
    return candidates.find((url) => typeof url === 'string' && url.length > 0) || null;
  }

  resolveStageName(data, broadcast = {}) {
    return (
      broadcast.channel
      || broadcast.stage
      || broadcast.attributes?.stage
      || broadcast.attributes?.username
      || data?.data?.attributes?.username
      || data?.username
      || data?.slug
      || data?.data?.attributes?.name
      || null
    );
  }

  findLiveBroadcast(data) {
    if (!data) return null;

    const stageFallback = this.resolveStageName(data);
    const fromBroadcast = (broadcast) => {
      if (!broadcast) return null;
      const liveFlag = broadcast.live ?? broadcast.is_live ?? broadcast.attributes?.live;
      if (liveFlag === false) return null;
      const streamUrl = this.resolveStreamUrl(broadcast);
      if (!streamUrl) return null;
      const stage = this.resolveStageName(data, broadcast) || stageFallback || 'mixlr-channel';
      const title = broadcast.title || broadcast.attributes?.title || stage;
      return { stage, streamUrl, title };
    };

    // Newer payload shape: { is_live, broadcasts: [...] }
    if ((data.is_live || data.live) && Array.isArray(data.broadcasts) && data.broadcasts.length) {
      const candidate = data.broadcasts.find((b) => (b.is_live ?? b.live ?? true)) || data.broadcasts[0];
      const resolved = fromBroadcast(candidate);
      if (resolved) return resolved;
    }

    // Sometimes the current broadcast is already expanded on the root.
    if (data.current_broadcast) {
      const resolved = fromBroadcast(data.current_broadcast);
      if (resolved) return resolved;
    }

    // Original JSON:API shape using relationships + included.
    const rel = data?.data?.relationships?.current_broadcast?.data;
    if (rel && Array.isArray(data.included)) {
      const broadcast = data.included.find((item) => item.type === 'broadcast' && item.id === rel.id)
        || data.included.find((item) => item.type === 'broadcast');
      const resolved = fromBroadcast(broadcast);
      if (resolved) return resolved;
    }

    // Fallback: occasionally tucked under attributes.current_broadcast.
    const attrCurrent = data?.data?.attributes?.current_broadcast;
    if (attrCurrent) {
      const resolved = fromBroadcast(attrCurrent);
      if (resolved) return resolved;
    }

    // Some payloads use public_current_broadcasts
    const publicRel = data?.data?.relationships?.public_current_broadcasts?.data;
    if (publicRel && Array.isArray(data.included)) {
      const broadcast = data.included.find((item) => item.type === 'broadcast' && item.id === publicRel[0]?.id)
        || data.included.find((item) => item.type === 'broadcast');
      const resolved = fromBroadcast(broadcast);
      if (resolved) return resolved;
    }

    // Fallback: take any included broadcast.
    if (Array.isArray(data?.included)) {
      const anyBroadcast = data.included.find((item) => item.type === 'broadcast');
      const resolved = fromBroadcast(anyBroadcast);
      if (resolved) return resolved;
    }

    return null;
  }

  async startRecording(stage, streamUrl, { channel } = {}) {
    if (this.runningProcesses.has(stage)) {
      return { started: false, reason: 'already-running', stage };
    }

    await this.ensureRecordingDir();

    const fileName = `${stage}_${new Date().toISOString().replace(/[/:]/g, '-')}.mp3`;
    const stageDir = path.join(this.recordingsDir, stage);
    const outputPath = path.join(stageDir, fileName);

    await mkdir(stageDir, { recursive: true });
    this.log(`[${stage}] Starting recording...`);

    const ytdlp = this.processAdapter.spawnProcess({
      name: `yt-dlp:${stage}`,
      cmd: 'yt-dlp',
      args: ['--no-part', '-f', 'bestaudio', '--extract-audio', '--audio-format', 'mp3', '--live-from-start', '-o', outputPath, streamUrl],
      stdio: ['ignore', 'ignore', 'pipe'],
      timeoutMs: null, // recordings can be long-lived
      onStderr: (data) => {
        const message = data.toString().trim();
        if (message.toLowerCase().includes('error')) {
          this.error(`[${stage}] yt-dlp: ${message}`);
        }
      },
      onExit: ({ code }) => {
        this.log(`[${stage}] Recording finished (code ${code}).`);
        if (code === 0) {
          const { dir, name } = path.parse(outputPath);
          const aacPath = path.join(dir, `${name}.aac`);
          unlink(aacPath).then(() => {
            this.log(`[${stage}] Removed source AAC file (${aacPath}).`);
          }).catch((error) => {
            if (error.code !== 'ENOENT') this.warn(`[${stage}] Could not remove AAC file (${aacPath}): ${error.message}`);
          });
        }
        this.runningProcesses.delete(stage);
      },
    });

    const info = {
      process: ytdlp,
      path: outputPath,
      stage,
      channel: channel || stage,
      fileName,
      lastSize: 0,
      lastCheck: Date.now(),
      startedAt: Date.now(),
      currentPath: null,
      sourceUrl: streamUrl,
    };

    this.runningProcesses.set(stage, info);

    return { started: true, stage, fileName, path: outputPath };
  }

  async stopRecording(stage, signal = 'SIGINT') {
    const info = this.runningProcesses.get(stage);
    if (!info) return { stopped: false, reason: 'not-found' };
    info.process.kill(signal);
    return { stopped: true, stage };
  }

  async stopAll(signal = 'SIGINT') {
    const promises = [];
    for (const [stage, info] of this.runningProcesses.entries()) {
      promises.push(new Promise((resolve) => info.process.on('close', resolve)));
      info.process.kill(signal);
    }
    if (promises.length > 0) {
      await Promise.all(promises);
    }
    this.runningProcesses.clear();
  }

  async monitorStalledRecordings() {
    for (const [stage, info] of this.runningProcesses.entries()) {
      try {
        const resolved = await this.resolveRecordingFile(info);
        const stats = resolved?.stats;
        if (!stats) continue;
        if (stats.size > info.lastSize) {
          info.lastSize = stats.size;
          info.lastCheck = Date.now();
          info.currentPath = resolved.path;
        } else if (Date.now() - info.lastCheck > this.stalledTimeoutMs) {
          this.warn(`[${stage}] Recording stalled. Restarting...`);
          info.process.kill('SIGKILL');
          this.runningProcesses.delete(stage);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') this.error(`[${stage}] Stat error: ${error.message}`);
      }
    }
  }

  async startChannel(channel) {
    const streamData = await this.fetchStreamInfo(channel);
    if (!streamData) return { started: false, channel, reason: 'fetch-failed' };

    const liveBroadcast = this.findLiveBroadcast(streamData);
    const stageName = streamData?.data?.attributes?.username || channel;
    if (!liveBroadcast) return { started: false, channel, stage: stageName, reason: 'not-live' };

    const result = await this.startRecording(liveBroadcast.stage, liveBroadcast.streamUrl, { channel });
    return { ...result, channel, stage: liveBroadcast.stage };
  }

  async listLiveStreams(channels = this.channels) {
    const lives = [];
    for (const channel of channels) {
      const streamData = await this.fetchStreamInfo(channel);
      const media = this.extractMedia(streamData);
      const liveBroadcast = streamData ? this.findLiveBroadcast(streamData) : null;
      if (liveBroadcast) {
        if (media) {
          const chanKey = channel.toLowerCase();
          const stageKey = liveBroadcast.stage?.toLowerCase();
          const withMeta = { ...media, stageName: liveBroadcast.stage, channelSlug: channel };
          this.mediaCache.set(chanKey, withMeta);
          if (stageKey && (!this.mediaCache.has(stageKey) || !this.mediaCache.get(stageKey))) {
            this.mediaCache.set(stageKey, withMeta);
          }
        }
        lives.push({
          channel,
          stage: liveBroadcast.stage,
          streamUrl: liveBroadcast.streamUrl,
          title: liveBroadcast.title,
          ...media,
        });
      }
    }
    return lives;
  }

  setChannels(channels = []) {
    if (Array.isArray(channels) && channels.length > 0) {
      this.channels = channels;
    }
    return this.channels;
  }

  async checkChannels() {
    const results = [];

    for (const channel of this.channels) {
      const streamData = await this.fetchStreamInfo(channel);
      const stageName = streamData?.data?.attributes?.username || channel;

      if (!streamData) {
        results.push({ channel, live: false, error: 'fetch-failed' });
        continue;
      }

      const liveBroadcast = this.findLiveBroadcast(streamData);
      if (liveBroadcast) {
        await this.startRecording(liveBroadcast.stage, liveBroadcast.streamUrl, { channel });
        results.push({ channel, stage: liveBroadcast.stage, live: true });
      } else {
        if (this.runningProcesses.has(stageName)) {
          this.log(`[${stageName}] Stream offline. Stopping recording.`);
          await this.stopRecording(stageName);
        }
        results.push({ channel, stage: stageName, live: false });
      }
    }

    return results;
  }

  startMonitoring({ channels } = {}) {
    if (channels?.length) this.channels = channels;
    if (this.isMonitoring) return this.getStatus();

    this.ensureRecordingDir()
      .then(() => this.checkChannels())
      .catch((err) => this.error(`Could not initialize monitoring: ${err.message}`));

    this.intervals.push(setInterval(() => this.checkChannels(), this.checkIntervalMs));
    this.intervals.push(setInterval(() => this.monitorStalledRecordings(), this.stalledCheckIntervalMs));
    this.isMonitoring = true;
    return this.getStatus();
  }

  stopMonitoring({ stopRecordings = false } = {}) {
    this.intervals.forEach(clearInterval);
    this.intervals = [];
    this.isMonitoring = false;
    if (stopRecordings) {
      return this.stopAll();
    }
    return Promise.resolve();
  }

  async getRunning() {
    const running = [];
    for (const [stage, info] of this.runningProcesses.entries()) {
      let size = 0;
      let resolvedPath = info.currentPath || info.path;
      try {
        const resolved = await this.resolveRecordingFile(info);
        if (resolved) {
          const { stats, path: pathToUse } = resolved;
          size = stats.size;
          resolvedPath = pathToUse;
          info.currentPath = pathToUse;
          info.lastSize = stats.size;
          info.lastCheck = Date.now();
        }
      } catch (err) {
        if (err.code !== 'ENOENT') this.warn(`[${stage}] Could not read size: ${err.message}`);
      }
      const fileNameForDisplay = resolvedPath ? path.basename(resolvedPath) : info.fileName;
      running.push({
        stage,
        channel: info.channel || stage,
        fileName: fileNameForDisplay,
        path: resolvedPath,
        size,
        startedAt: info.startedAt,
        sourceUrl: info.sourceUrl || null,
      });
    }
    return running;
  }

  async listRecordingsFlat({ rootDir = this.getRecordingsRoot(), getMediaForChannel } = {}) {
    const items = [];
    const mediaCache = new Map();
    let entries;
    try {
      entries = await readdir(rootDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return items;
      throw err;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const channelDir = path.join(rootDir, entry.name);
      const channel = entry.name;
      let channelMedia = null;
      if (typeof getMediaForChannel === 'function') {
        if (mediaCache.has(channel)) {
          channelMedia = mediaCache.get(channel);
        } else {
          try {
            channelMedia = await getMediaForChannel(channel);
          } catch (err) {
            this.warn(`channel media lookup failed for ${channel}: ${err.message}`);
            channelMedia = null;
          }
          mediaCache.set(channel, channelMedia);
        }
      }
      let files;
      try {
        files = await readdir(channelDir, { withFileTypes: true });
      } catch (err) {
        if (err.code === 'ENOENT') continue;
        throw err;
      }

      for (const file of files) {
        if (!file.isFile() || !/\.(mp3|aac|m4a|webm)$/i.test(file.name)) continue;
        const abs = path.join(channelDir, file.name);
        let stats;
        try {
          stats = await stat(abs);
        } catch {
          continue;
        }

        const dateGuess = parseDateFromFilename(file.name) || stats.mtime.toISOString();
        const duration = await probeDurationSeconds(abs);

        const relativePath = path.relative(rootDir, abs);
        const artwork = channelMedia?.artwork || null;
        const logo = channelMedia?.logo || null;
        const cover = artwork || logo || null;
        items.push({
          channel: entry.name,
          file: file.name,
          path: relativePath,
          url: `/api/stream?path=${encodeURIComponent(relativePath)}&follow=1`,
          downloadUrl: `/recordings/${entry.name}/${encodeURIComponent(file.name)}`,
          size: stats.size,
          mtime: stats.mtime.toISOString(),
          date: dateGuess,
          duration,
          artwork: artwork || null,
          cover,
          logo,
          themeColor: channelMedia?.themeColor || null,
          stage: channelMedia?.stageName || null,
        });
      }
    }

    items.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
    return items;
  }

  async buildStatusPayload({ recordingsRoot = this.getRecordingsRoot() } = {}) {
    const runningRaw = await this.getRunning();
    const root = normalizeRoot(recordingsRoot);
    const running = runningRaw.map((item) => {
      const absPath = path.isAbsolute(item.path) ? item.path : path.join(root, item.path);
      const safeRel = buildSafeRel(root, absPath);
      const followParam = '&follow=1';
      const liveParam = item.sourceUrl ? `&live=${encodeURIComponent(item.sourceUrl)}` : '';
      return {
        ...item,
        path: absPath,
        streamUrl: safeRel ? `/api/stream?path=${safeRel}${followParam}` : null,
        downloadUrl: safeRel ? `/recordings/${safeRel}` : null,
        streamProxy: safeRel ? `/api/stream/recording?path=${safeRel}${liveParam}${followParam}` : null,
      };
    });
    const runningLookup = new Map();
    running.forEach((item) => {
      const keys = [item.stage, item.channel].filter(Boolean).map((k) => k.toLowerCase());
      keys.forEach((key) => {
        if (!runningLookup.has(key)) runningLookup.set(key, item);
      });
    });

    const liveRaw = await this.listLiveStreams();
    const live = (liveRaw || []).map((item) => {
      const key = (item.stage || item.channel || '').toLowerCase();
      const match = key ? runningLookup.get(key) : null;
      const streamProxy = match?.streamProxy || null;
      const logo = item.logo || match?.logo || null;
      const artwork = item.artwork || item.cover || null;
      const themeColor = item.themeColor || null;
      return {
        ...item,
        streamProxy,
        source: streamProxy ? 'local-recording' : 'live-stream',
        title: item.title || item.name || match?.fileName || item.stage || item.channel || 'Live stream',
        logo,
        artwork,
        themeColor,
      };
    });

    return {
      recorder: { ...this.getStatus(), running },
      live,
    };
  }

  getStatus() {
    return {
      monitoring: this.isMonitoring,
      channels: this.channels,
      intervals: {
        checkIntervalMs: this.checkIntervalMs,
        stalledCheckIntervalMs: this.stalledCheckIntervalMs,
        stalledTimeoutMs: this.stalledTimeoutMs,
      },
      runningCount: this.runningProcesses.size,
    };
  }
}

export default RecorderService;