export function registerStatusRoutes(app, { recorderService, converterService, recordingsRoot, statusBroadcaster }) {
  app.get('/api/status', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const payload = await recorderService.buildStatusPayload({ recordingsRoot });
      res.json({ ...payload, converter: converterService.getLastSummary() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/status/stream', async (_req, res) => {
    if (!statusBroadcaster) return res.status(503).json({ error: 'Status stream unavailable' });
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    statusBroadcaster.addClient(res);
  });

  app.get('/api/recorder/running', async (_req, res) => {
    res.json({ running: await recorderService.getRunning() });
  });
}
