import path from 'path';

export function registerFallbackRoute(app, { webRoot }) {
  app.get('*', (_req, res) => {
    res.sendFile(path.join(webRoot, 'index.html'));
  });
}
