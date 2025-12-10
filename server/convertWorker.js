#!/usr/bin/env node
import 'dotenv/config';
import path from 'path';
import { convertDirectory, formatSummary } from '../tools/converter/converter.js';
import { recordingsRoot, isTruthy } from './config.js';

const usage = `Usage: node server/convertWorker.js [directory] [--delete-source]

directory        Folder to scan (defaults to CONVERT_INPUT_DIR or recordings root)
--delete-source  Remove original .aac files after successful conversion
-h, --help       Show this help text
`;

function parseArgs(args) {
  let inputDirArg = null;
  let deleteSourceArg = false;
  let showHelp = false;

  for (const arg of args) {
    switch (arg) {
      case '-h':
      case '--help':
        showHelp = true;
        break;
      case '--delete-source':
      case '--rm-source':
        deleteSourceArg = true;
        break;
      default:
        inputDirArg = arg;
    }
  }

  return { inputDirArg, deleteSourceArg, showHelp };
}

const { inputDirArg, deleteSourceArg, showHelp } = parseArgs(process.argv.slice(2));

if (showHelp) {
  console.log(usage);
  process.exit(0);
}

const envInputDir = process.env.CONVERT_INPUT_DIR || process.env.INPUT_DIR;
const inputDir = inputDirArg
  ? path.resolve(inputDirArg)
  : envInputDir
    ? path.resolve(envInputDir)
    : recordingsRoot;

const deleteSource = deleteSourceArg
  || isTruthy(process.env.CONVERT_DELETE_SOURCE)
  || isTruthy(process.env.DELETE_SOURCE);

const log = (msg) => console.log(`[convert-worker] ${msg}`);

async function run() {
  log(`Starting conversion in ${inputDir}${deleteSource ? ' (delete source enabled)' : ''}`);
  try {
    const summary = await convertDirectory({ inputDir, deleteSource, onLog: log });
    log(`Done. ${formatSummary(summary)}.`);
    if (summary.failed > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`[convert-worker] Error: ${err.message}`);
    process.exit(1);
  }
}

run();
