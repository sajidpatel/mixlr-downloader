import 'dotenv/config';
import express from 'express';
import fs from 'fs/promises';
import {
  webRoot,
  hlsRoot,
  recordingsRoot,
  PORT,
  HOST,
  MAX_PORT_ATTEMPTS,
  FOLLOW_IDLE_TIMEOUT_MS,
  FOLLOW_POLL_INTERVAL_MS,
} from './server/config.js';
import { createAuthMiddleware } from './server/auth.js';
import { createStreamHelpers } from './server/streaming.js';
import {
  recorderService,
  converterService,
  playCountStore,
  hlsService,
  processAdapter,
} from './server/services.js';
import { registerRecordingRoutes } from './server/routes/recordings.js';
import { registerLiveRoutes } from './server/routes/live.js';
import { registerPlayRoutes } from './server/routes/plays.js';
import { registerFallbackRoute } from './server/routes/fallback.js';

const app = express();

const { streamGrowingFile, serveFileWithRange } = createStreamHelpers({
  recorderService,
  followIdleTimeoutMs: FOLLOW_IDLE_TIMEOUT_MS,
  followPollIntervalMs: FOLLOW_POLL_INTERVAL_MS,
});
app.use(createAuthMiddleware());
app.use(express.json());
app.use(express.static(webRoot));
app.use('/live', express.static(hlsRoot));

registerRecordingRoutes(app, {
  recorderService,
  processAdapter,
  streamGrowingFile,
  serveFileWithRange,
  recordingsRoot,
  playCountStore,
});
registerLiveRoutes(app, { recorderService, hlsService, processAdapter, streamGrowingFile });
registerPlayRoutes(app, { playCountStore });
registerFallbackRoute(app, { webRoot });

export function startServer(port = PORT, host = HOST, attempt = 0) {
  const server = app
    .listen(port, host, () => {
      const displayHost = host === '0.0.0.0' ? 'localhost' : host;
      console.log(`Web UI available at http://${displayHost}:${port}`);
      Promise.all([
        recorderService.ensureRecordingDir(),
        fs.mkdir(hlsRoot, { recursive: true }),
      ])
        .catch((err) => console.error(`Failed to ensure directories: ${err.message}`));
    })
    .on('error', (err) => {
      if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS) {
        const nextPort = port + 1;
        console.warn(`Port ${port} in use on ${host}, retrying on ${nextPort}...`);
        startServer(nextPort, host, attempt + 1);
      } else {
        console.error(`Failed to start server after ${attempt + 1} attempts: ${err.message}`);
        process.exit(1);
      }
    });

  return server;
}

if (process.env.NODE_ENV !== 'test') {
  startServer(PORT, HOST);
}

export { app, recorderService, converterService };
