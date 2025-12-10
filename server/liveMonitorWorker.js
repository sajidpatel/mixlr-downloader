#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { setTimeout as sleep } from 'timers/promises';
import fetch from 'node-fetch';
import RecorderService, { DEFAULT_CHANNELS } from '../tools/recorder/recorderService.js';

const fetchFn = globalThis.fetch || fetch;

function parseChannels(raw) {
  if (!raw) return null;
  return raw
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}

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

async function saveState(state) {
  const payload = JSON.stringify(state, null, 2);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, payload, 'utf8');
}

function makeKey(item) {
  return (item.stage || item.channel || '').toLowerCase();
}

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
