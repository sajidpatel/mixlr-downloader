import { API_TOKEN, TOKEN_COOKIE, isTruthy } from './config.js';

/**
 * Parse an HTTP Cookie header into an object mapping cookie names to their values.
 * @param {string|undefined|null} header - The raw Cookie header string from an HTTP request.
 * @returns {Object<string,string>} An object whose keys are decoded cookie names and values are decoded cookie values; cookies with no value yield an empty string and entries with empty names are ignored.
 */
function parseCookies(header) {
  if (!header) return {};
  return header.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[decodeURIComponent(key)] = decodeURIComponent(rest.join('=') || '');
    return acc;
  }, {});
}

/**
 * Locate an authentication token in the request from headers, cookies, or query.
 *
 * @param {Object<string,string>} [cookies] - Optional pre-parsed cookie map; if omitted, cookies are parsed from `req.headers.cookie`.
 * @returns {string|null} The first token found from `x-api-key` / `x-access-token` header, Bearer `Authorization` header, the token cookie, or the `token` query parameter; `null` if none is present.
 */
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

/**
 * Determine whether a request targets a public API route that does not require authentication.
 * @param {object} req - Express-like request object with `method` and `path` properties.
 * @returns {boolean} `true` if the request targets a public route that doesn't require authentication, `false` otherwise.
 */
function isPublicRoute(req) {
  if (req.method === 'GET' && req.path === '/api/status') return true;
  if (req.method === 'GET' && req.path === '/api/status/stream') return true;
  if (req.path === '/api/plays') return true; // allow both GET and POST
  if (req.path === '/api/recordings' && req.method !== 'DELETE') return true; // list is public; deletion is protected
  return false;
}

/**
 * Determine whether the incoming request requires authentication.
 *
 * @param {import('express').Request} req - HTTP request whose path and method are evaluated.
 * @param {string|null|undefined} apiToken - Configured API token; when falsy, authentication is not required.
 * @returns {boolean} `true` if the request targets a protected route under `/api`, `/recordings`, or `/live` and an API token is configured; `false` otherwise.
 */
function needsAuth(req, apiToken) {
  if (!apiToken) return false;
  if (isPublicRoute(req)) return false;
  return req.path.startsWith('/api') || req.path.startsWith('/recordings') || req.path.startsWith('/live');
}

/**
 * Create an Express-style middleware that enforces an API token and manages a persistent auth cookie.
 *
 * @param {Object} [options] - Configuration for the middleware.
 * @param {string} [options.apiToken] - The API token to validate against; if falsy, middleware skips authentication.
 * @param {string} [options.cookieName] - Name of the cookie used to store the API token.
 * @returns {Function} An Express middleware function (req, res, next) that allows requests when a valid token is present
 * in headers, Authorization Bearer, cookie, or query; sets the auth cookie when appropriate; otherwise responds with 401
 * and a `WWW-Authenticate: Bearer realm="mixlr-tools"` header.
 */
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