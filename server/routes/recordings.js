import path from 'path';
import fs from 'fs/promises';
import { API_TOKEN, isTruthy } from '../config.js';
import { buildAltRelPath, playKeyForItem } from '../utils.js';

export function registerRecordingRoutes(app, {
  recorderService,
  processAdapter,
  streamGrowingFile,
  serveFileWithRange,
  recordingsRoot,
  playCountStore,
}) {
  app.get('/recordings/*', async (req, res) => {
    const relPath = req.params[0];
    if (!relPath) return res.status(400).json({ error: 'path is required' });

    let filePath;
    let stats;
    try {
      filePath = recorderService.resolveRecordingPath(relPath);
      stats = await fs.stat(filePath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        const altRel = buildAltRelPath(relPath);
        if (altRel) {
          try {
            filePath = recorderService.resolveRecordingPath(altRel);
            stats = await fs.stat(filePath);
          } catch (altErr) {
            if (altErr.code === 'ENOENT') return res.status(404).end();
            return res.status(500).json({ error: altErr.message });
          }
        } else {
          return res.status(404).end();
        }
      } else {
        return res.status(400).json({ error: 'Invalid path' });
      }
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
    let stats;
    try {
      filePath = recorderService.resolveRecordingPath(relPath);
      stats = await fs.stat(filePath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        const altRel = buildAltRelPath(relPath);
        if (altRel) {
          try {
            filePath = recorderService.resolveRecordingPath(altRel);
            stats = await fs.stat(filePath);
          } catch (altErr) {
            if (altErr.code === 'ENOENT') return res.status(404).end();
            return res.status(500).json({ error: altErr.message });
          }
        } else {
          return res.status(404).end();
        }
      } else {
        return res.status(400).json({ error: 'Invalid path' });
      }
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

  app.get('/api/recordings', async (_req, res) => {
    try {
      const items = await recorderService.listRecordingsFlat({
        rootDir: recordingsRoot,
        getMediaForChannel: (channel) => recorderService.getChannelMedia(channel),
      });
      const enriched = items.map((item) => {
        const key = playKeyForItem(item);
        return { ...item, playCount: key ? playCountStore.get(key) : 0, playKey: key };
      });
      res.json({ items: enriched });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/recordings', async (req, res) => {
    if (!API_TOKEN) return res.status(401).json({ error: 'Unauthorized' });

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
      const dir = path.dirname(filePath);
      try {
        const remaining = await fs.readdir(dir);
       if (!remaining.length) await fs.rmdir(dir);
      } catch {}
      await recorderService.refreshRecordingsList();
      res.json({ ok: true });
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
      res.status(500).json({ error: err.message });
    }
  });
}
