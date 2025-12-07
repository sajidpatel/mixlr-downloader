import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { spawn } from 'child_process';
import RecorderService from './tools/recorder/recorderService.js';
import { convertDirectory, formatSummary } from './tools/converter/converter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const recorderService = new RecorderService();
const webRoot = path.join(__dirname, 'web');
const recordingsRoot = path.join(__dirname, 'recordings');
const hlsRoot = path.join(__dirname, 'hls');

const MAX_PORT_ATTEMPTS = 50; // safety cap to avoid infinite loops
const FOLLOW_IDLE_TIMEOUT_MS = 300_000; // 5 minutes idle before closing a follow stream
const FOLLOW_POLL_INTERVAL_MS = 800;
const HLS_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const HLS_SEGMENT_SECONDS = 4;

const hlsSessions = new Map();

async function listRecordings(rootDir) {
  const results = {};
  let entries;
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return results; // no recordings yet
    throw err;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const channelDir = path.join(rootDir, entry.name);
    let files;
    try {
      files = await fs.readdir(channelDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }

    const audioFiles = files
      .filter((f) => f.isFile() && /\.(mp3|aac|m4a|webm)$/i.test(f.name))
      .map((f) => ({
        name: f.name,
        url: `/recordings/${entry.name}/${encodeURIComponent(f.name)}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (audioFiles.length) {
      results[entry.name] = audioFiles;
    }
  }

  return results;
}

function parseDateFromFilename(fileName) {
  const match = fileName.match(/_(\d{4}-\d{2}-\d{2}T[\d.-]+)\./);
  if (!match) return null;
  const normalized = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})(\.\d+)?Z?/, (_m, h, m, s, frac = '') => `T${h}:${m}:${s}${frac}Z`);
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

async function listRecordingsFlat(rootDir, { getMediaForChannel } = {}) {
  const items = [];
  const mediaCache = new Map();
  let entries;
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
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
          console.warn(`channel media lookup failed for ${channel}: ${err.message}`);
          channelMedia = null;
        }
        mediaCache.set(channel, channelMedia);
      }
    }
    let files;
    try {
      files = await fs.readdir(channelDir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }

    for (const file of files) {
      if (!file.isFile() || !/\.(mp3|aac|m4a|webm)$/i.test(file.name)) continue;
      const abs = path.join(channelDir, file.name);
      let stats;
      try {
        stats = await fs.stat(abs);
      } catch {
        continue;
      }

      const dateGuess = parseDateFromFilename(file.name) || stats.mtime.toISOString();
      const duration = await probeDurationSeconds(abs);

      const relativePath = path.relative(recordingsRoot, abs);
      const artwork = channelMedia?.artwork || null;
      const logo = channelMedia?.logo || null;
      const cover = artwork || logo || null;
      items.push({
        channel: entry.name,
        file: file.name,
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
      });
    }
  }

  items.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
  return items;
}

function resolveRecordingPath(relPath) {
  const decoded = decodeURIComponent(relPath || '');
  const normalized = path.normalize(decoded);
  const filePath = path.join(recordingsRoot, normalized);
  if (!filePath.startsWith(recordingsRoot)) {
    throw new Error('Invalid path');
  }
  return filePath;
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

function isTruthy(val) {
  return val === true || val === '1' || (typeof val === 'string' && val.toLowerCase() === 'true');
}

async function ensureHlsDir(channelDir) {
  await fs.mkdir(channelDir, { recursive: true });
}

async function waitForFileExists(filePath, { timeoutMs = 8000, pollMs = 200 } = {}) {
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

async function stopHlsSession(channel) {
  const session = hlsSessions.get(channel);
  if (!session) return;
  if (session.timer) clearTimeout(session.timer);
  try {
    session.proc.kill('SIGKILL');
  } catch {}
  try {
    await fs.rm(session.outDir, { recursive: true, force: true });
  } catch {}
  hlsSessions.delete(channel);
}

async function startHlsSession(channel) {
  const existing = hlsSessions.get(channel);
  if (existing) {
    existing.lastUsed = Date.now();
    if (existing.timer) clearTimeout(existing.timer);
    existing.timer = setTimeout(() => stopHlsSession(channel), HLS_IDLE_TIMEOUT_MS);
    return existing;
  }

  const live = await recorderService.listLiveStreams([channel]);
  const stream = live?.[0];
  if (!stream) throw new Error('Channel not live');

  const outDir = path.join(hlsRoot, channel);
  await fs.rm(outDir, { recursive: true, force: true });
  await ensureHlsDir(outDir);

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
    '-hls_time', String(HLS_SEGMENT_SECONDS),
    '-hls_list_size', '12',
    '-hls_flags', 'append_list+omit_endlist+program_date_time+independent_segments+discont_start',
    '-hls_segment_filename', segmentPattern,
    playlistFile,
  ];

  const proc = spawn('ffmpeg', args, { stdio: 'ignore' });

  const session = {
    channel,
    streamUrl: stream.streamUrl,
    outDir,
    playlistFile,
    playlistUrl: `/live/${encodeURIComponent(channel)}/playlist.m3u8`,
    proc,
    lastUsed: Date.now(),
    timer: null,
  };

  session.timer = setTimeout(() => stopHlsSession(channel), HLS_IDLE_TIMEOUT_MS);

  proc.on('close', () => {
    if (session.timer) clearTimeout(session.timer);
    hlsSessions.delete(channel);
  });
  proc.on('error', () => {
    if (session.timer) clearTimeout(session.timer);
    hlsSessions.delete(channel);
  });

  hlsSessions.set(channel, session);
  const ready = await waitForFileExists(playlistFile, { timeoutMs: 8000, pollMs: 200 });
  if (!ready) {
    await stopHlsSession(channel);
    throw new Error('HLS playlist not ready');
  }
  return session;
}

async function streamGrowingFile(req, res, filePath) {
  let position = 0;
  let aborted = false;
  let idleTimer;

  const contentType = contentTypeFor(filePath);

  const clearIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
  };

  const scheduleIdle = () => {
    clearIdle();
    idleTimer = setTimeout(() => {
      if (!aborted) {
        res.end();
        aborted = true;
      }
    }, FOLLOW_IDLE_TIMEOUT_MS);
  };

  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
    'Transfer-Encoding': 'chunked',
    'Accept-Ranges': 'bytes',
  });

  req.on('close', () => {
    aborted = true;
    clearIdle();
  });

  const pump = async () => {
    if (aborted) return;

    let stats;
    try {
      stats = await fs.stat(filePath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        res.end();
        return;
      }
      res.destroy(err);
      return;
    }

    if (position < stats.size) {
      const stream = createReadStream(filePath, { start: position });
      stream.on('data', (chunk) => {
        position += chunk.length;
        scheduleIdle();
      });
      stream.on('error', (err) => {
        if (!aborted) res.destroy(err);
      });
      stream.on('end', () => {
        if (aborted) return;
        setTimeout(pump, FOLLOW_POLL_INTERVAL_MS);
      });
      stream.pipe(res, { end: false });
    } else {
      setTimeout(pump, FOLLOW_POLL_INTERVAL_MS);
    }
  };

  scheduleIdle();
  pump();
}

function buildSafeRel(absPath) {
  const rel = path.relative(recordingsRoot, absPath);
  const safeRel = rel.split(path.sep).map(encodeURIComponent).join('/');
  const isSafe = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  return isSafe ? safeRel : null;
}

function serveFileWithRange(req, res, filePath, stats) {
  const range = req.headers.range;
  const total = stats.size;
  let start = 0;
  let end = total - 1;

  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (match) {
      start = parseInt(match[1], 10);
      end = match[2] ? parseInt(match[2], 10) : end;
      if (Number.isNaN(start) || start >= total) start = 0;
      if (Number.isNaN(end) || end >= total) end = total - 1;
    }
  }

  const chunkSize = end - start + 1;
  res.status(range ? 206 : 200);
  res.setHeader('Content-Type', contentTypeFor(filePath));
  res.setHeader('Content-Length', chunkSize);
  res.setHeader('Accept-Ranges', 'bytes');
  if (range) {
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
  }

  const stream = createReadStream(filePath, { start, end });
  stream.on('error', (err) => {
    if (err.code === 'ENOENT') return res.status(404).end();
    res.status(500).end();
  });
  stream.pipe(res);
}

app.get('/recordings/*', async (req, res) => {
  let filePath;
  try {
    const safePath = path.normalize(req.path.replace(/^\/recordings\//, ''));
    filePath = resolveRecordingPath(safePath);
  } catch (err) {
    return res.status(404).end();
  }

  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).end();
    return res.status(500).json({ error: err.message });
  }

  serveFileWithRange(req, res, filePath, stats);
});

app.get('/api/stream', async (req, res) => {
  const { path: relPath } = req.query;
  if (!relPath) return res.status(400).json({ error: 'path is required' });

  let filePath;
  try {
    filePath = resolveRecordingPath(relPath);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).end();
    return res.status(500).json({ error: err.message });
  }

  const follow = isTruthy(req.query.follow);
  const ext = normalizedExt(filePath);
  if (follow) {
    return streamGrowingFile(req, res, filePath);
  }

  if (ext === '.aac') {
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    const ff = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'warning',
      '-fflags', '+discardcorrupt',
      '-err_detect', 'ignore_err',
      '-i', filePath,
      '-vn',
      '-f', 'mp3',
      '-acodec', 'libmp3lame',
      '-q:a', '4',
      '-'
    ]);
    ff.on('error', (err) => {
      console.error('ffmpeg error', err.message);
      if (!res.headersSent) res.status(500).end();
    });
    ff.stdout.pipe(res);
    ff.stderr.on('data', () => {}); // keep quiet
    ff.on('close', (code) => {
      if (code !== 0 && !res.headersSent) res.status(500).end();
    });
  } else {
    serveFileWithRange(req, res, filePath, stats);
  }
});

app.get('/api/stream/recording', async (req, res) => {
  const { path: relPath, live } = req.query;
  if (!relPath) return res.status(400).json({ error: 'path is required' });

  let filePath;
  try {
    filePath = resolveRecordingPath(relPath);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  let stats;
  try {
    stats = await fs.stat(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).end();
    return res.status(500).json({ error: err.message });
  }

  const useLive = live && typeof live === 'string';
  const follow = !useLive && isTruthy(req.query.follow);

  if (follow) {
    return streamGrowingFile(req, res, filePath);
  }

  const ffArgs = useLive
    ? [
        '-hide_banner', '-loglevel', 'warning',
        '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_at_eof', '1', '-reconnect_delay_max', '2',
        '-fflags', '+discardcorrupt', '-err_detect', 'ignore_err',
        '-i', live,
        '-vn', '-f', 'mp3', '-acodec', 'libmp3lame', '-q:a', '4', '-'
      ]
    : [
        '-hide_banner', '-loglevel', 'warning',
        '-fflags', '+discardcorrupt', '-err_detect', 'ignore_err',
        '-re',
        '-i', filePath,
        '-vn', '-f', 'mp3', '-acodec', 'libmp3lame', '-q:a', '4', '-'
      ];

  res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
  const ff = spawn('ffmpeg', ffArgs);

  ff.on('error', (err) => {
    console.error('ffmpeg recording stream error', err.message);
    if (!res.headersSent) res.status(500).end();
  });

  ff.stdout.pipe(res);
  ff.stderr.on('data', () => {});
  ff.on('close', (code) => {
    if (code !== 0 && !res.headersSent) res.status(500).end();
  });
});

let lastConversion = null;

app.use(express.json());
app.use(express.static(webRoot));
app.use('/live', express.static(hlsRoot));

app.get('/api/status', async (_req, res) => {
  const runningRaw = await recorderService.getRunning();
  const running = runningRaw.map((item) => {
    // Normalize to an absolute path before computing a safe relative path.
    const absPath = path.isAbsolute(item.path) ? item.path : path.resolve(process.cwd(), item.path);
    const safeRel = buildSafeRel(absPath);
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

  const liveRaw = await recorderService.listLiveStreams();
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
  res.json({
    recorder: { ...recorderService.getStatus(), running },
    converter: lastConversion,
    live,
  });
});

app.get('/api/recorder/running', async (_req, res) => {
  res.json({ running: await recorderService.getRunning() });
});

app.post('/api/recorder/monitor/start', (req, res) => {
  const { channels } = req.body || {};
  const status = recorderService.startMonitoring({ channels });
  res.json({ started: true, status });
});

app.post('/api/recorder/monitor/stop', async (req, res) => {
  const { stopRecordings = false } = req.body || {};
  await recorderService.stopMonitoring({ stopRecordings });
  res.json({ stopped: true, status: recorderService.getStatus() });
});

app.post('/api/recorder/refresh', async (_req, res) => {
  const results = await recorderService.checkChannels();
  res.json({ results, status: recorderService.getStatus() });
});

app.post('/api/recorder/start', async (req, res) => {
  const { channel } = req.body || {};
  if (!channel) return res.status(400).json({ error: 'channel is required' });
  const result = await recorderService.startChannel(channel);
  res.json(result);
});

app.post('/api/recorder/stop', async (req, res) => {
  const { stage } = req.body || {};
  if (!stage) return res.status(400).json({ error: 'stage is required' });
  const result = await recorderService.stopRecording(stage);
  res.json(result);
});

app.post('/api/recorder/stop-all', async (_req, res) => {
  await recorderService.stopAll();
  res.json({ stopped: true });
});

app.post('/api/converter/run', async (req, res) => {
  const { inputDir = 'recordings', deleteSource = false } = req.body || {};
  try {
    const summary = await convertDirectory({ inputDir, deleteSource, onLog: console.log });
    lastConversion = { ...summary, inputDir, ranAt: new Date().toISOString(), summaryText: formatSummary(summary) };
    res.json({ ok: true, summary: lastConversion });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/recordings', async (_req, res) => {
  try {
    const items = await listRecordingsFlat(recordingsRoot, {
      getMediaForChannel: (channel) => recorderService.getChannelMedia(channel),
    });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/live/stream', async (req, res) => {
  const { channel } = req.query;
  if (!channel) return res.status(400).json({ error: 'channel is required' });

  const channelKey = channel.toString().toLowerCase();
  try {
    const runningNow = await recorderService.getRunning();
    const match = (runningNow || []).find((item) => {
      const keys = [item.stage, item.channel].filter(Boolean).map((k) => k.toLowerCase());
      return keys.includes(channelKey);
    });
    if (match?.path) {
      const absPath = path.isAbsolute(match.path) ? match.path : path.resolve(process.cwd(), match.path);
      try {
        await fs.stat(absPath);
        return streamGrowingFile(req, res, absPath);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error('live stream local follow error', err.message);
        }
        // fall through to live edge
      }
    }
  } catch (err) {
    console.error('live stream running lookup error', err.message);
  }

  let live;
  try {
    const streams = await recorderService.listLiveStreams([channel]);
    live = streams[0];
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  if (!live) return res.status(404).json({ error: 'Channel not live' });

  res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
  const ff = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'warning',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_at_eof', '1',
    '-reconnect_delay_max', '2',
    '-fflags', '+discardcorrupt',
    '-err_detect', 'ignore_err',
    '-i', live.streamUrl,
    '-vn',
    '-f', 'mp3',
    '-acodec', 'libmp3lame',
    '-q:a', '4',
    '-'
  ]);

  ff.on('error', (err) => {
    console.error('ffmpeg live error', err.message);
    if (!res.headersSent) res.status(500).end();
  });

  ff.stdout.pipe(res);
  ff.stderr.on('data', () => {});
  ff.on('close', (code) => {
    if (code !== 0 && !res.headersSent) res.status(500).end();
  });
});

app.get('/api/live/hls/:channel', async (req, res) => {
  const { channel } = req.params;
  if (!channel) return res.status(400).json({ error: 'channel is required' });
  try {
    const session = await startHlsSession(channel);
    res.json({ playlist: `${session.playlistUrl}?t=${Date.now()}` });
  } catch (err) {
    const status = err.message === 'Channel not live' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(webRoot, 'index.html'));
});

function startServer(port, attempt = 0) {
  const server = app
    .listen(port, () => {
      console.log(`Web UI available at http://localhost:${port}`);
      Promise.all([
        recorderService.ensureRecordingDir(),
        fs.mkdir(hlsRoot, { recursive: true }),
      ]).catch((err) => console.error(`Failed to ensure directories: ${err.message}`));
    })
    .on('error', (err) => {
      if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS) {
        const nextPort = port + 1;
        console.warn(`Port ${port} in use, retrying on ${nextPort}...`);
        startServer(nextPort, attempt + 1);
      } else {
        console.error(`Failed to start server after ${attempt + 1} attempts: ${err.message}`);
        process.exit(1);
      }
    });

  return server;
}

startServer(PORT);
