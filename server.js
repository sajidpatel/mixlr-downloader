import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { createReadStream, constants as fsConstants } from 'fs';
import RecorderService from './tools/recorder/recorderService.js';
import ConverterService from './tools/converter/converterService.js';
import HlsService from './tools/recorder/hlsService.js';
import { convertDirectory, formatSummary } from './tools/converter/converter.js';
import processAdapter from './tools/process/processAdapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const webRoot = path.join(__dirname, 'web');
const recordingsEnv = process.env.RECORDINGS_DIR;
const hlsEnv = process.env.HLS_DIR;

const MAX_PORT_ATTEMPTS = 50; // safety cap to avoid infinite loops
const FOLLOW_IDLE_TIMEOUT_MS = 300_000; // 5 minutes idle before closing a follow stream
const FOLLOW_POLL_INTERVAL_MS = 800;
const HLS_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const HLS_SEGMENT_SECONDS = 4;

async function resolveWritableDir(preferred, fallback) {
  const tryDir = async (dir) => {
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.access(dir, fsConstants.W_OK);
      // Verify we can create inside the directory.
      const probe = path.join(dir, '.write-test');
      await fs.mkdir(probe, { recursive: true });
      await fs.rm(probe, { recursive: true, force: true });
      return dir;
    } catch (err) {
      if (err.code === 'EACCES' || err.code === 'EPERM') return null;
      throw err;
    }
  };

  const primary = await tryDir(preferred);
  if (primary) return primary;
  if (!fallback) throw new Error(`Directory not writable: ${preferred}`);
  const alt = await tryDir(fallback);
  if (alt) {
    console.warn(`Falling back to writable dir ${alt} (could not use ${preferred})`);
    return alt;
  }
  throw new Error(`Directory not writable: ${preferred} (fallback also failed)`);
}

const recordingsRoot = await resolveWritableDir(
  recordingsEnv ? path.resolve(recordingsEnv) : path.join(__dirname, 'recordings'),
  path.join('/tmp', 'mixlr-recordings'),
);
const hlsRoot = await resolveWritableDir(
  hlsEnv ? path.resolve(hlsEnv) : path.join(__dirname, 'hls'),
  path.join('/tmp', 'mixlr-hls'),
);

const recorderService = new RecorderService({ recordingsDir: recordingsRoot, processAdapter });
const converterService = new ConverterService({
  convertFn: convertDirectory,
  summaryFn: formatSummary,
  defaultInputDir: recordingsRoot,
});
const hlsService = new HlsService({
  recorderService,
  hlsRoot,
  idleTimeoutMs: HLS_IDLE_TIMEOUT_MS,
  segmentSeconds: HLS_SEGMENT_SECONDS,
  processAdapter,
});

// Start monitoring automatically on boot (skip in tests).
if (process.env.NODE_ENV !== 'test') {
  recorderService.startMonitoring();
}

function isTruthy(val) {
  return val === true || val === '1' || (typeof val === 'string' && val.toLowerCase() === 'true');
}

async function streamGrowingFile(req, res, filePath) {
  let position = 0;
  let aborted = false;
  let idleTimer;

  const contentType = recorderService.contentTypeFor(filePath);

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
  res.setHeader('Content-Type', recorderService.contentTypeFor(filePath));
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
    filePath = recorderService.resolveRecordingPath(safePath);
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
    filePath = recorderService.resolveRecordingPath(relPath);
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
  const ext = recorderService.normalizedExt(filePath);
  if (follow) {
    return streamGrowingFile(req, res, filePath);
  }

  if (ext === '.aac') {
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    const ff = processAdapter.spawnProcess({
      name: 'ffmpeg:aac-proxy',
      cmd: 'ffmpeg',
      args: [
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
      ],
      stdio: ['ignore', 'pipe', 'pipe'],
      timeoutMs: null,
      onStderr: () => {},
      onExit: ({ code }) => {
        if (code !== 0 && !res.headersSent) res.status(500).end();
      },
    });
    ff.on('error', (err) => {
      console.error('ffmpeg error', err.message);
      if (!res.headersSent) res.status(500).end();
    });
    req.on('close', () => {
      try { ff.kill('SIGKILL'); } catch {}
    });
    ff.stdout?.pipe(res);
  } else {
    serveFileWithRange(req, res, filePath, stats);
  }
});

app.get('/api/stream/recording', async (req, res) => {
  const { path: relPath, live } = req.query;
  if (!relPath) return res.status(400).json({ error: 'path is required' });

  let filePath;
  try {
    filePath = recorderService.resolveRecordingPath(relPath);
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
  const ff = processAdapter.spawnProcess({
    name: 'ffmpeg:recording-stream',
    cmd: 'ffmpeg',
    args: ffArgs,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeoutMs: null,
    onStderr: () => {},
    onExit: ({ code }) => {
      if (code !== 0 && !res.headersSent) res.status(500).end();
    },
  });

  ff.on('error', (err) => {
    console.error('ffmpeg recording stream error', err.message);
    if (!res.headersSent) res.status(500).end();
  });

  req.on('close', () => {
    try { ff.kill('SIGKILL'); } catch {}
  });

  ff.stdout?.pipe(res);
});

app.use(express.json());
app.use(express.static(webRoot));
app.use('/live', express.static(hlsRoot));

app.get('/api/status', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const payload = await recorderService.buildStatusPayload({ recordingsRoot });
    res.json({ ...payload, converter: converterService.getLastSummary() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  res.status(200).json(result);
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
  try {
    const { inputDir, deleteSource = false } = req.body || {};
    const summary = await converterService.enqueue({ inputDir, deleteSource });
    res.status(200).json({ ok: true, summary });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/recordings', async (_req, res) => {
  try {
    const items = await recorderService.listRecordingsFlat({
      rootDir: recordingsRoot,
      getMediaForChannel: (channel) => recorderService.getChannelMedia(channel),
    });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/recordings', async (req, res) => {
  const relPath = req.body?.path;
  if (!relPath) return res.status(400).json({ error: 'path is required' });

  let filePath;
  try {
    filePath = recorderService.resolveRecordingPath(relPath);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      return res.status(400).json({ error: 'Not a file' });
    }
    await fs.unlink(filePath);
    // Attempt to clean up empty channel directory; ignore errors.
    const dir = path.dirname(filePath);
    try {
      const remaining = await fs.readdir(dir);
      if (!remaining.length) await fs.rmdir(dir);
    } catch {}
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
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
  const ff = processAdapter.spawnProcess({
    name: `ffmpeg:live-proxy:${channel}`,
    cmd: 'ffmpeg',
    args: [
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
    ],
    stdio: ['ignore', 'pipe', 'pipe'],
    timeoutMs: null,
    onStderr: () => {},
    onExit: ({ code }) => {
      if (code !== 0 && !res.headersSent) res.status(500).end();
    },
  });

  ff.on('error', (err) => {
    console.error('ffmpeg live error', err.message);
    if (!res.headersSent) res.status(500).end();
  });

  req.on('close', () => {
    try { ff.kill('SIGKILL'); } catch {}
  });

  ff.stdout?.pipe(res);
});

app.get('/api/live/hls/:channel', async (req, res) => {
  const { channel } = req.params;
  if (!channel) return res.status(400).json({ error: 'channel is required' });
  try {
    const session = await hlsService.startSession(channel);
    res.json({ playlist: `${session.playlistUrl}?t=${Date.now()}` });
  } catch (err) {
    const status = err.message === 'Channel not live' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(webRoot, 'index.html'));
});

export function startServer(port = PORT, attempt = 0) {
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

if (process.env.NODE_ENV !== 'test') {
  startServer(PORT);
}

export { app, recorderService, converterService };
