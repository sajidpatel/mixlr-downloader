import path from 'path';
import blessed from 'blessed';
import contrib from 'blessed-contrib';
import RecorderService from './recorderService.js';

const RECORDINGS_DIR = 'recordings';
const TUI_UPDATE_INTERVAL_MS = 2 * 1000; // 2 seconds

const recorderService = new RecorderService({ recordingsDir: RECORDINGS_DIR, logger: console });

// TUI Elements
const screen = blessed.screen();
const grid = new contrib.grid({ rows: 12, cols: 12, screen: screen });
const recordingsTable = grid.set(0, 0, 8, 12, contrib.table, {
  keys: true,
  fg: 'white',
  selectedFg: 'white',
  selectedBg: 'blue',
  interactive: true,
  label: 'Live Recordings',
  width: '100%',
  height: '100%',
  border: { type: 'line', fg: 'cyan' },
  columnSpacing: 10,
  columnWidth: [30, 50, 20],
});
const logOutput = grid.set(8, 0, 4, 12, contrib.log, {
  fg: 'green',
  selectedFg: 'green',
  label: 'Logs',
});

// Redirect console to log widget
console.log = (d) => logOutput.log(d);
console.error = (d) => logOutput.log(`{red-fg}${d}{/red-fg}`);
console.warn = (d) => logOutput.log(`{yellow-fg}${d}{/yellow-fg}`);

let intervals = [];
let isShuttingDown = false;

function formatBytes(bytes, decimals = 2) {
  if (!bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

async function updateTuiTable() {
  const running = await recorderService.getRunning();
  const tableData = running.map((info) => [info.stage, info.fileName, formatBytes(info.size)]);
  recordingsTable.setData({ headers: ['Stage', 'File Name', 'Size'], data: tableData });
  screen.render();
}

async function refreshNow() {
  console.log(`--- Checking channels at ${new Date().toLocaleTimeString()} ---`);
  await recorderService.checkChannels();
  await updateTuiTable();
}

async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('--- Gracefully shutting down ---');
  intervals.forEach(clearInterval);
  try {
    await recorderService.stopMonitoring({ stopRecordings: true });
  } catch (err) {
    console.error(`Error while stopping recordings: ${err.message}`);
  }
  screen.destroy();
  process.exit(0);
}

async function main() {
  screen.key(['escape', 'q', 'C-c'], gracefulShutdown);
  screen.key(['r'], refreshNow);
  recordingsTable.focus();
  screen.render();

  console.log('--- Starting Stream Recorder ---');
  try {
    await recorderService.ensureRecordingDir();
    console.log(`Recordings saved in: ${path.resolve(RECORDINGS_DIR)}`);
  } catch (error) {
    console.error(`Could not create recordings directory: ${error.message}`);
    return;
  }

  recorderService.startMonitoring();
  await refreshNow();

  intervals.push(setInterval(() => {
    updateTuiTable().catch((err) => console.error(`Failed to update table: ${err.message}`));
  }, TUI_UPDATE_INTERVAL_MS));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
