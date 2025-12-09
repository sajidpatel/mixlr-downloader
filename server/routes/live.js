import path from 'path';
import fs from 'fs/promises';

export function registerLiveRoutes(app, { recorderService, hlsService, processAdapter, streamGrowingFile }) {
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
}
