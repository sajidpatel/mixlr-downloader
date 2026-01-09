import path from 'path';

/**
 * Registers a catch-all GET route that serves the web root's index.html for any request path.
 *
 * @param {object} app - Express-compatible application instance.
 * @param {{ webRoot: string }} options - Options object.
 * @param {string} options.webRoot - Filesystem path to the web root directory containing index.html.
 */
export function registerFallbackRoute(app, { webRoot }) {
  app.get('*', (_req, res) => {
    res.sendFile(path.join(webRoot, 'index.html'));
  });
}