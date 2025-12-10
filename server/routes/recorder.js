/**
 * Register HTTP POST routes under /api/recorder to control a recorder service.
 *
 * Registers endpoints that start/stop monitoring, refresh channel checks,
 * start/stop individual recordings, and stop all recordings.
 *
 * @param {import('express').Application} app - Express application instance to attach routes to.
 * @param {{ recorderService: {
 *   startMonitoring: (opts: {channels?: any}) => any,
 *   stopMonitoring: (opts: {stopRecordings?: boolean}) => Promise<any>,
 *   checkChannels: () => Promise<any>,
 *   startChannel: (channel: any) => Promise<any>,
 *   stopRecording: (stage: any) => Promise<any>,
 *   stopAll: () => Promise<void>,
 *   getStatus: () => any
 * } }} options - Options object containing the `recorderService` used by the routes.
 */
export function registerRecorderRoutes(app, { recorderService }) {
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
}