#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { setTimeout as sleep } from 'timers/promises';
import fetch from 'node-fetch';
import RecorderService, { DEFAULT_CHANNELS } from '../tools/recorder/recorderService.js';

const fetchFn = globalThis.fetch || fetch;

/**
 * Parse a comma-separated list of channels into an array of channel names.
 * @param {string|null|undefined} raw - Comma-separated channel string (e.g., "a,b,c"); may be falsy.
 * @returns {string[]|null} `null` if `raw` is falsy; otherwise an array of trimmed, non-empty channel names.
 */
function parseChannels(raw) {
  if (!raw) return null;
  return raw
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * Determine whether a value represents an affirmative truth value.
 * @param {*} val - Value to evaluate; commonly a boolean or string.
 * @returns {boolean} `true` if `val` is the boolean `true`, the string `'1'`, or a string equal to `'1'`, `'true'`, `'yes'`, or `'on'` (case-insensitive); `false` otherwise.
 */
function parseBool(val) {
  return val === true
    || val === '1'
    || (typeof val === 'string' && ['1', 'true', 'yes', 'on'].includes(val.toLowerCase()));
}

const channels = parseChannels(process.env.MONITOR_CHANNELS) || DEFAULT_CHANNELS;
const webhookUrl = process.env.MONITOR_WEBHOOK_URL || process.env.WEBHOOK_URL || null;
const intervalMs = Number(process.env.MONITOR_INTERVAL_MS) || 60_000;
const statePath = path.resolve(process.env.MONITOR_STATE_FILE || 'live-monitor-state.json');
const loop = parseBool(process.env.MONITOR_LOOP) || process.argv.includes('--loop');

/**
 * Load persisted monitor state from disk, falling back to an empty state when unavailable.
 *
 * Attempts to read and parse JSON from the configured state file. If the file does not exist
 * or cannot be read, returns an object with an empty `live` array; a warning is logged for read
 * errors other than "file not found".
 * @returns {{ live: string[] }|any} The parsed state object from disk, or `{ live: [] }` when missing or unreadable.
 */
async function loadState() {
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[live-monitor] Could not read state file (${statePath}): ${err.message}`);
    }
    return { live: [] };
  }
}

/**
 * Persist monitoring state to disk as pretty-printed JSON.
 *
 * @param {Object} state - Monitoring state to save.
 * @param {string[]} state.live - Array of lowercased keys for currently live streams.
 * @param {number} [state.lastRun] - Timestamp of the last check in milliseconds since Unix epoch.
 */
async function saveState(state) {
  const payload = JSON.stringify(state, null, 2);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, payload, 'utf8');
}

/**
 * Derives a stable lookup key for a live item from its stage or channel.
 * @param {{stage?: string, channel?: string}} item - Object representing a live stream entry; may include `stage` or `channel`.
 * @returns {string} The `stage` value lowercased if present, otherwise the `channel` value lowercased, or an empty string if neither is set.
 */
function makeKey(item) {
  return (item.stage || item.channel || '').toLowerCase();
}

/**
 * Send a webhook notification for a newly detected live stream.
 *
 * @param {Object} live - Live stream metadata.
 * @param {string} [live.channel] - Channel identifier associated with the stream.
 * @param {string} [live.stage] - Stage or instance name of the stream.
 * @param {string} [live.title] - Human-readable title of the stream.
 * @param {string} [live.streamUrl] - URL where the stream can be viewed.
 * @throws {Error} If no fetch implementation is available to deliver the webhook.
 * @throws {Error} If the webhook HTTP response is not successful (non-OK status).
 */
async function sendNotification(live) {
  if (!webhookUrl) {
    console.log('[live-monitor] No webhook configured; skipping notification');
    return;
  }
  if (!fetchFn) {
    throw new Error('No fetch implementation available for webhook notification');
  }
  const payload = {
    channel: live.channel,
    stage: live.stage,
    title: live.title,
    streamUrl: live.streamUrl,
    seenAt: new Date().toISOString(),
  };
  const res = await fetchFn(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Webhook failed (${res.status} ${res.statusText})`);
  }
  console.log(`[live-monitor] Notified webhook for ${payload.stage || payload.channel}`);
}

/**
 * Check configured channels for currently live streams, notify about newly detected ones, and persist the updated live state.
 *
 * Calls the recorderService to list live streams for the configured channels, compares results with the previously saved state,
 * sends a webhook notification for each stream that is new since the last run, and saves the updated list of live keys and run timestamp.
 *
 * @param {object} recorderService - An instance providing listLiveStreams(channels) which returns an array of live stream items.
 * @returns {{ liveNow: Array<object>, newLives: Array<object> }} An object containing `liveNow` (all currently live stream items) and `newLives` (those detected as newly live since the previous run).
 */
async function checkOnce(recorderService) {
  console.log(`[live-monitor] Checking channels (${channels.join(', ')})`);
  const state = await loadState();
  const previous = new Set((state.live || []).map((x) => x.toLowerCase()));

  const liveNow = await recorderService.listLiveStreams(channels);
  const currentKeys = new Set();
  const newLives = [];

  liveNow.forEach((item) => {
    const key = makeKey(item);
    if (key) currentKeys.add(key);
    if (key && !previous.has(key)) {
      newLives.push(item);
    }
  });

  for (const live of newLives) {
    try {
      await sendNotification(live);
    } catch (err) {
      console.error(`[live-monitor] Notification failed for ${live.stage || live.channel}: ${err.message}`);
    }
  }

  await saveState({
    live: Array.from(currentKeys),
    lastRun: new Date().toISOString(),
  });

  console.log(`[live-monitor] Live now: ${liveNow.length}. New since last run: ${newLives.length}.`);
  return { liveNow, newLives };
}

/**
 * Start the live-monitor worker: instantiate the recorder service and perform monitoring checks either once or in a repeating loop.
 *
 * Runs checkOnce to detect live streams and send notifications; on check failures it logs the error and sets the process exit code to 1. When configured to loop, waits the configured interval between iterations.
 */
async function main() {
  const recorderService = new RecorderService({ channels, logger: console });

  do {
    try {
      await checkOnce(recorderService);
    } catch (err) {
      console.error(`[live-monitor] Check failed: ${err.message}`);
      process.exitCode = 1;
    }
    if (!loop) break;
    await sleep(intervalMs);
  } while (true);
}

main().catch((err) => {
  console.error(`[live-monitor] Fatal error: ${err.message}`);
  process.exit(1);
});