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
