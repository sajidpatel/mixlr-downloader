export const isAbortError = (err) => err && (err.name === 'AbortError' || err.code === 20);

export const createApi = (showToast) => async (path, options = {}) => {
  const opts = { cache: 'no-store', ...options };
  if (opts.body && !opts.headers) {
    opts.headers = { 'Content-Type': 'application/json' };
  }

  const response = await fetch(path, opts);
  const raw = await response.text();
  const parse = () => {
    try {
      return JSON.parse(raw);
    } catch {
      const message = raw?.trim() || response.statusText;
      throw new Error(message || 'Request failed');
    }
  };
  if (!response.ok) {
    const message = raw?.trim() || response.statusText;
    const err = new Error(message || 'Request failed');
    if (response.status === 401) {
      err.isUnauthorized = true;
      showToast?.('Unauthorized: add ?token=<API_TOKEN> to your URL or configure X-API-Key.', 'error');
    }
    throw err;
  }
  return parse();
};
