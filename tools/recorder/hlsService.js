import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

class HlsService {
  constructor({
    recorderService,
    hlsRoot,
    idleTimeoutMs = 10 * 60 * 1000,
    segmentSeconds = 4,
  } = {}) {
    this.recorderService = recorderService;
    this.hlsRoot = hlsRoot;
    this.idleTimeoutMs = idleTimeoutMs;
    this.segmentSeconds = segmentSeconds;
    this.sessions = new Map();
  }

  async startSession(channel) {
    const normalized = channel?.toString();
    if (!normalized) throw new Error('Channel not provided');

    const existing = this.sessions.get(normalized);
    if (existing) {
      existing.lastUsed = Date.now();
      if (existing.timer) clearTimeout(existing.timer);
      existing.timer = setTimeout(() => this.stopSession(normalized), this.idleTimeoutMs);
      return existing;
    }

    const live = await this.recorderService.listLiveStreams([normalized]);
    const stream = live?.[0];
    if (!stream) throw new Error('Channel not live');

    const outDir = path.join(this.hlsRoot, normalized);
    await fs.rm(outDir, { recursive: true, force: true });
    await this.ensureDir(outDir);

    const playlistFile = path.join(outDir, 'playlist.m3u8');
    const segmentPattern = path.join(outDir, 'segment_%05d.ts');

    const args = [
      '-hide_banner', '-loglevel', 'warning',
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_at_eof', '1', '-reconnect_delay_max', '2',
      '-i', stream.streamUrl,
      '-vn',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-f', 'hls',
      '-hls_time', String(this.segmentSeconds),
      '-hls_list_size', '12',
      '-hls_flags', 'append_list+omit_endlist+program_date_time+independent_segments+discont_start',
      '-hls_segment_filename', segmentPattern,
      playlistFile,
    ];

    const proc = spawn('ffmpeg', args, { stdio: 'ignore' });

    const session = {
      channel: normalized,
      streamUrl: stream.streamUrl,
      outDir,
      playlistFile,
      playlistUrl: `/live/${encodeURIComponent(normalized)}/playlist.m3u8`,
      proc,
      lastUsed: Date.now(),
      timer: null,
    };

    session.timer = setTimeout(() => this.stopSession(normalized), this.idleTimeoutMs);

    const cleanup = () => {
      if (session.timer) clearTimeout(session.timer);
      this.sessions.delete(normalized);
    };

    proc.on('close', cleanup);
    proc.on('error', cleanup);

    this.sessions.set(normalized, session);
    const ready = await this.waitForFileExists(playlistFile, { timeoutMs: 8000, pollMs: 200 });
    if (!ready) {
      await this.stopSession(normalized);
      throw new Error('HLS playlist not ready');
    }
    return session;
  }

  async stopSession(channel) {
    const session = this.sessions.get(channel);
    if (!session) return;
    if (session.timer) clearTimeout(session.timer);
    try {
      session.proc.kill('SIGKILL');
    } catch {}
    try {
      await fs.rm(session.outDir, { recursive: true, force: true });
    } catch {}
    this.sessions.delete(channel);
  }

  async ensureDir(dir) {
    await fs.mkdir(dir, { recursive: true });
  }

  async waitForFileExists(filePath, { timeoutMs = 8000, pollMs = 200 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await fs.access(filePath);
        return true;
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return false;
  }
}

export default HlsService;
