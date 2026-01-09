/**
 * Register HTTP routes for reading and incrementing play counts on the given app.
 *
 * Registers:
 * - GET /api/plays: responds with `{ counts }` from `playCountStore.getAll()`.
 * - POST /api/plays: accepts `{ key }` in the JSON body, validates presence of `key` (400 if missing),
 *   increments the count via `playCountStore.increment(key)`, and responds with `{ ok: true, key, count }`.
 * Errors from the store are returned as HTTP 500 with `{ error: <message> }`.
 *
 * @param {object} app - An Express-compatible app or router to register routes on.
 * @param {object} deps - Dependency bag.
 * @param {{ getAll: function(): Promise<object>, increment: function(string): Promise<number> }} deps.playCountStore - Store providing `getAll` and `increment` methods for play counts.
 */
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