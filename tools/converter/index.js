#!/usr/bin/env node
import { pathToFileURL } from 'url';
import { convertDirectory, formatSummary } from './converter.js';

function printHelp() {
  console.log(`Usage: convert_aac_to_mp3.js [directory] [--delete-source]

  directory        Folder to scan (defaults to "./recordings")
  --delete-source  Remove the original .aac files after successful conversion
  -h, --help       Show this help text`);
}

function parseArgs(args) {
  let inputDir = 'recordings';
  let deleteSource = false;

  for (const arg of args) {
    switch (arg) {
      case '-h':
      case '--help':
        return { showHelp: true };
      case '--delete-source':
      case '--rm-source':
        deleteSource = true;
        break;
      default:
        inputDir = arg;
    }
  }

  return { inputDir, deleteSource, showHelp: false };
}

async function runCli() {
  const { inputDir, deleteSource, showHelp } = parseArgs(process.argv.slice(2));
  if (showHelp) {
    printHelp();
    process.exit(0);
  }

  try {
    const summary = await convertDirectory({ inputDir, deleteSource, onLog: console.log });
    console.log(`Done. ${formatSummary(summary)}.`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

const runAsCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runAsCli) {
  runCli();
}
