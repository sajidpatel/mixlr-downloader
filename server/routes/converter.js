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
