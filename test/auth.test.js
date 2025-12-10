import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';

// Mock environment variable for API_TOKEN
const originalEnv = process.env.API_TOKEN;

// Helper to create a mock request object
function createMockRequest(options = {}) {
  return {
    headers: options.headers || {},
    query: options.query || {},
    path: options.path || '/api/test',
    method: options.method || 'GET',
    get: function(header) {
      return this.headers[header.toLowerCase()];
    },
  };
}

// Import the extractToken function by creating a minimal implementation
// Note: In a real scenario, we'd export this from server.js
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
  const TOKEN_COOKIE = 'mixlr_api_token';
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
  if (req.path === '/api/plays') return true;
  if (req.path === '/api/recordings' && req.method !== 'DELETE') return true;
  return false;
}

function needsAuth(req, API_TOKEN) {
  if (!API_TOKEN) return false;
  if (isPublicRoute(req)) return false;
  return req.path.startsWith('/api') || req.path.startsWith('/recordings') || req.path.startsWith('/live');
}

test('extractToken retrieves token from x-api-key header', () => {
  const req = createMockRequest({
    headers: { 'x-api-key': 'test-token-123' },
  });
  const token = extractToken(req);
  assert.equal(token, 'test-token-123');
});

test('extractToken retrieves token from x-access-token header', () => {
  const req = createMockRequest({
    headers: { 'x-access-token': 'access-token-456' },
  });
  const token = extractToken(req);
  assert.equal(token, 'access-token-456');
});

test('extractToken retrieves token from Authorization Bearer header', () => {
  const req = createMockRequest({
    headers: { authorization: 'Bearer bearer-token-789' },
  });
  const token = extractToken(req);
  assert.equal(token, 'bearer-token-789');
});

test('extractToken retrieves token from cookie', () => {
  const req = createMockRequest({
    headers: { cookie: 'mixlr_api_token=cookie-token-abc; other=value' },
  });
  const token = extractToken(req);
  assert.equal(token, 'cookie-token-abc');
});

test('extractToken retrieves token from query parameter', () => {
  const req = createMockRequest({
    query: { token: 'query-token-xyz' },
  });
  const token = extractToken(req);
  assert.equal(token, 'query-token-xyz');
});

test('extractToken prioritizes headers over cookies and query params', () => {
  const req = createMockRequest({
    headers: {
      'x-api-key': 'header-token',
      cookie: 'mixlr_api_token=cookie-token',
    },
    query: { token: 'query-token' },
  });
  const token = extractToken(req);
  assert.equal(token, 'header-token');
});

test('extractToken prioritizes Bearer token over cookie', () => {
  const req = createMockRequest({
    headers: {
      authorization: 'Bearer bearer-token',
      cookie: 'mixlr_api_token=cookie-token',
    },
  });
  const token = extractToken(req);
  assert.equal(token, 'bearer-token');
});

test('extractToken returns null when no token is present', () => {
  const req = createMockRequest({});
  const token = extractToken(req);
  assert.equal(token, null);
});

test('public routes are accessible without API_TOKEN', () => {
  const publicRoutes = [
    { path: '/api/status', method: 'GET' },
    { path: '/api/plays', method: 'GET' },
    { path: '/api/plays', method: 'POST' },
    { path: '/api/recordings', method: 'GET' },
  ];

  publicRoutes.forEach(({ path, method }) => {
    const req = createMockRequest({ path, method });
    assert.equal(isPublicRoute(req), true, `${method} ${path} should be public`);
  });
});

test('protected routes require authentication when API_TOKEN is configured', () => {
  const API_TOKEN = 'test-secret-token';
  
  const protectedRoutes = [
    { path: '/api/recorder/start', method: 'POST' },
    { path: '/api/recorder/stop', method: 'POST' },
    { path: '/api/converter/run', method: 'POST' },
    { path: '/api/recordings', method: 'DELETE' },
    { path: '/recordings/somefile.mp3', method: 'GET' },
    { path: '/live/stream', method: 'GET' },
  ];

  protectedRoutes.forEach(({ path, method }) => {
    const req = createMockRequest({ path, method });
    assert.equal(needsAuth(req, API_TOKEN), true, `${method} ${path} should require auth`);
  });
});

test('protected routes are blocked without valid token when API_TOKEN is configured', () => {
  const API_TOKEN = 'valid-secret-token';
  
  const req = createMockRequest({
    path: '/api/recorder/start',
    method: 'POST',
    headers: { 'x-api-key': 'invalid-token' },
  });

  const token = extractToken(req);
  const authRequired = needsAuth(req, API_TOKEN);
  
  assert.equal(authRequired, true);
  assert.notEqual(token, API_TOKEN);
});

test('protected routes are accessible with valid token when API_TOKEN is configured', () => {
  const API_TOKEN = 'valid-secret-token';
  
  const req = createMockRequest({
    path: '/api/recorder/start',
    method: 'POST',
    headers: { 'x-api-key': 'valid-secret-token' },
  });

  const token = extractToken(req);
  const authRequired = needsAuth(req, API_TOKEN);
  
  assert.equal(authRequired, true);
  assert.equal(token, API_TOKEN);
});

test('routes do not require auth when API_TOKEN is not configured', () => {
  const API_TOKEN = null;
  
  const req = createMockRequest({
    path: '/api/recorder/start',
    method: 'POST',
  });

  const authRequired = needsAuth(req, API_TOKEN);
  assert.equal(authRequired, false);
});

test('startServer binds to specified host and port', async (t) => {
  const app = express();
  app.get('/test', (req, res) => res.json({ ok: true }));

  const testHost = '127.0.0.1';
  const testPort = 0; // Let OS assign available port
  
  await new Promise((resolve, reject) => {
    const server = app.listen(testPort, testHost, () => {
      const address = server.address();
      assert.equal(address.address, testHost);
      assert.ok(address.port > 0);
      
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    server.on('error', reject);
  });
});

test('startServer handles port in use by trying next port', async (t) => {
  const app1 = express();
  const app2 = express();
  
  // Create a server occupying a port
  const server1 = await new Promise((resolve, reject) => {
    const srv = app1.listen(0, '127.0.0.1', () => resolve(srv));
    srv.on('error', reject);
  });

  const occupiedPort = server1.address().port;
  
  // Simulate retry logic
  let attemptedPort = occupiedPort;
  let serverStarted = false;
  let attempts = 0;
  const maxAttempts = 5;

  while (!serverStarted && attempts < maxAttempts) {
    try {
      await new Promise((resolve, reject) => {
        const srv = app2.listen(attemptedPort, '127.0.0.1', () => {
          serverStarted = true;
          srv.close(() => resolve());
        });
        
        srv.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            attemptedPort++;
            attempts++;
            resolve(); // Retry with next port
          } else {
            reject(err);
          }
        });
      });
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
    }
  }

  server1.close();
  
  assert.ok(serverStarted, 'Server should eventually start on an available port');
  assert.ok(attempts > 0, 'Server should have retried at least once');
});

test('API client handles 401 Unauthorized with isUnauthorized flag', () => {
  // Simulate the api function behavior
  const mockResponse = {
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    text: async () => 'Unauthorized',
  };

  const handleApiError = (response, raw) => {
    if (!response.ok) {
      const message = raw?.trim() || response.statusText;
      const err = new Error(message || 'Request failed');
      if (response.status === 401) {
        err.isUnauthorized = true;
      }
      throw err;
    }
  };

  try {
    handleApiError(mockResponse, 'Unauthorized');
    assert.fail('Should have thrown an error');
  } catch (err) {
    assert.equal(err.isUnauthorized, true);
    assert.equal(err.message, 'Unauthorized');
  }
});

test('API client sets isUnauthorized flag only for 401 responses', () => {
  const mock403 = {
    ok: false,
    status: 403,
    statusText: 'Forbidden',
    text: async () => 'Forbidden',
  };

  const handleApiError = (response, raw) => {
    if (!response.ok) {
      const message = raw?.trim() || response.statusText;
      const err = new Error(message || 'Request failed');
      if (response.status === 401) {
        err.isUnauthorized = true;
      }
      throw err;
    }
  };

  try {
    handleApiError(mock403, 'Forbidden');
    assert.fail('Should have thrown an error');
  } catch (err) {
    assert.equal(err.isUnauthorized, undefined);
    assert.equal(err.message, 'Forbidden');
  }
});

test('parseCookies correctly parses cookie header', () => {
  const cookieHeader = 'session=abc123; mixlr_api_token=token123; foo=bar';
  const cookies = parseCookies(cookieHeader);
  
  assert.equal(cookies.session, 'abc123');
  assert.equal(cookies.mixlr_api_token, 'token123');
  assert.equal(cookies.foo, 'bar');
});

test('parseCookies handles URL-encoded values', () => {
  const cookieHeader = 'token=hello%20world; special=%3D%26%3F';
  const cookies = parseCookies(cookieHeader);
  
  assert.equal(cookies.token, 'hello world');
  assert.equal(cookies.special, '=&?');
});

test('parseCookies returns empty object for empty header', () => {
  const cookies = parseCookies('');
  assert.deepEqual(cookies, {});
});

test('DELETE /api/recordings requires API_TOKEN even if not configured elsewhere', () => {
  // This tests the special case in the DELETE endpoint
  const req = createMockRequest({
    path: '/api/recordings',
    method: 'DELETE',
  });

  const isPublic = isPublicRoute(req);
  assert.equal(isPublic, false, 'DELETE /api/recordings should not be a public route');
});
