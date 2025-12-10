/**
 * Registers converter-related API routes on the given application.
 *
 * Attaches POST /api/converter/run which accepts `{ inputDir, deleteSource }` in the request body,
 * enqueues a conversion job via `converterService.enqueue`, and responds with `{ ok: true, summary }` on success
 * or `{ ok: false, error }` and HTTP 500 on failure.
 *
 * @param {object} app - Express-like application instance with routing methods (e.g., `app.post`).
 * @param {{ converterService: { enqueue: function } }} deps - Dependency bag.
 * @param {{ enqueue: function }} deps.converterService - Service exposing an `enqueue({ inputDir, deleteSource })` method that returns a summary.
 */
export function registerConverterRoutes(app, { converterService }) {
  app.post('/api/converter/run', async (req, res) => {
    try {
      const { inputDir, deleteSource = false } = req.body || {};
      const summary = await converterService.enqueue({ inputDir, deleteSource });
      res.status(200).json({ ok: true, summary });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}