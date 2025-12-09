import { API_TOKEN, TOKEN_COOKIE, isTruthy } from './config.js';

function parseCookies(header) {
  if (!header) return {};
  return header.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[decodeURIComponent(key)] = decodeURIComponent(rest.join('=') || '');
    return acc;
  }, {});
}

function extractToken(req, cookies = null) {
  const cookieBag = cookies || parseCookies(req.headers.cookie || '');
  const headerToken = req.get('x-api-key') || req.get('x-access-token');
  const authHeader = req.get('authorization');
  const bearerToken = authHeader && authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice('bearer '.length).trim()
    : null;
  const queryToken = req.query?.token;
  return headerToken || bearerToken || cookieBag[TOKEN_COOKIE] || queryToken || null;
}

function isPublicRoute(req) {
  if (req.method === 'GET' && req.path === '/api/status') return true;
  if (req.method === 'GET' && req.path === '/api/status/stream') return true;
  if (req.path === '/api/plays') return true; // allow both GET and POST
  if (req.path === '/api/recordings' && req.method !== 'DELETE') return true; // list is public; deletion is protected
  return false;
}

function needsAuth(req, apiToken) {
  if (!apiToken) return false;
  if (isPublicRoute(req)) return false;
  return req.path.startsWith('/api') || req.path.startsWith('/recordings') || req.path.startsWith('/live');
}

export function createAuthMiddleware({ apiToken = API_TOKEN, cookieName = TOKEN_COOKIE } = {}) {
  return (req, res, next) => {
    if (!apiToken) return next();
    const cookies = parseCookies(req.headers.cookie || '');
    const queryToken = req.query?.token;
    if (queryToken === apiToken && !cookies[cookieName]) {
      res.cookie(cookieName, apiToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isTruthy(process.env.COOKIE_SECURE ?? (process.env.NODE_ENV === 'production')),
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
    }
    if (!needsAuth(req, apiToken)) return next();
    const token = extractToken(req, cookies);
    if (token === apiToken) {
      if (!cookies[cookieName]) {
        res.cookie(cookieName, apiToken, {
          httpOnly: true,
          sameSite: 'lax',
          secure: isTruthy(process.env.COOKIE_SECURE ?? (process.env.NODE_ENV === 'production')),
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });
      }
      return next();
    }
    res.setHeader('WWW-Authenticate', 'Bearer realm="mixlr-tools"');
    return res.status(401).json({ error: 'Unauthorized' });
  };
}
