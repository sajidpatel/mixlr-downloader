/**
 * Register status-related HTTP endpoints on the given Express app.
 *
 * Registers three routes:
 * - GET /api/status: responds with a merged status payload from the recorder and the converter summary; sets Cache-Control to no-store and returns 500 with an error message on failure.
 * - GET /api/status/stream: opens a Server-Sent Events stream when a statusBroadcaster is provided; responds 503 with an error when unavailable.
 * - GET /api/recorder/running: responds with the recorder's current running state as JSON.
 *
 * @param {import('express').Application} app - The Express application to register routes on.
 * @param {Object} deps - Dependency bag.
 * @param {Object} deps.recorderService - Service providing recorder operations (e.g., buildStatusPayload, getRunning).
 * @param {Object} deps.converterService - Service providing converter state (e.g., getLastSummary).
 * @param {string} deps.recordingsRoot - Filesystem path used by the recorderService when building status payloads.
 * @param {Object} [deps.statusBroadcaster] - Optional broadcaster that manages SSE clients; when provided, its addClient(res) is used to register stream clients.
 */
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