export function registerPlayRoutes(app, { playCountStore }) {
  app.get('/api/plays', async (_req, res) => {
    try {
      const counts = await playCountStore.getAll();
      res.json({ counts });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/plays', async (req, res) => {
    const { key } = req.body || {};
    if (!key) return res.status(400).json({ error: 'key is required' });
    try {
      const count = await playCountStore.increment(key);
      res.json({ ok: true, key, count });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
