import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const serverDir = path.dirname(__filename);
export const rootDir = path.resolve(serverDir, '..');
export const webRoot = path.join(rootDir, 'web');

export const PORT = Number(process.env.PORT) || 3000;
export const HOST = process.env.BIND_ADDRESS || '127.0.0.1';
export const API_TOKEN = process.env.API_TOKEN?.trim() || null;
export const TOKEN_COOKIE = 'mixlr_api_token';

export const MAX_PORT_ATTEMPTS = 50; // safety cap to avoid infinite loops
export const FOLLOW_IDLE_TIMEOUT_MS = 300_000; // 5 minutes idle before closing a follow stream
export const FOLLOW_POLL_INTERVAL_MS = 800;
export const HLS_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const HLS_SEGMENT_SECONDS = 4;

const recordingsEnv = process.env.RECORDINGS_DIR;
const hlsEnv = process.env.HLS_DIR;

async function resolveWritableDir(preferred, fallback) {
  const tryDir = async (dir) => {
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.access(dir, fsConstants.W_OK);
      const probe = path.join(dir, '.write-test');
      await fs.mkdir(probe, { recursive: true });
      await fs.rm(probe, { recursive: true, force: true });
      return dir;
    } catch (err) {
      if (err.code === 'EACCES' || err.code === 'EPERM') return null;
      throw err;
    }
  };

  const primary = await tryDir(preferred);
  if (primary) return primary;
  if (!fallback) throw new Error(`Directory not writable: ${preferred}`);
  const alt = await tryDir(fallback);
  if (alt) {
    console.warn(`Falling back to writable dir ${alt} (could not use ${preferred})`);
    return alt;
  }
  throw new Error(`Directory not writable: ${preferred} (fallback also failed)`);
}

export const recordingsRoot = await resolveWritableDir(
  recordingsEnv ? path.resolve(recordingsEnv) : path.join(rootDir, 'recordings'),
  path.join('/tmp', 'mixlr-recordings'),
);

export const hlsRoot = await resolveWritableDir(
  hlsEnv ? path.resolve(hlsEnv) : path.join(rootDir, 'hls'),
  path.join('/tmp', 'mixlr-hls'),
);

export function isTruthy(val) {
  return val === true || val === '1' || (typeof val === 'string' && val.toLowerCase() === 'true');
}
