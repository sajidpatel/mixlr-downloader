import fs from 'fs/promises';
import { constants } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import processAdapter from '../process/processAdapter.js';

async function checkCommand(cmd) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, ['-version']);
    proc.on('error', (err) => resolve({ ok: false, error: err }));
    proc.on('exit', (code, signal) => resolve({ ok: code === 0 || code === 1, code, signal }));
  });
}

async function ensureDirectoryExists(dir) {
  const stats = await fs.stat(dir).catch((err) => {
    if (err.code === 'ENOENT') {
      throw new Error(`Directory not found: ${dir}`);
    }
    throw err;
  });

  if (!stats.isDirectory()) {
    throw new Error(`Path exists but is not a directory: ${dir}`);
  }
}

async function collectAacFiles(dir) {
  const results = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectAacFiles(fullPath);
      results.push(...nested);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.aac')) {
      results.push(fullPath);
    }
  }
  return results;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function convertFile(inputFile, outputFile, { processAdapterInstance = processAdapter } = {}) {
  const args = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-fflags', '+discardcorrupt',
    '-err_detect', 'ignore_err',
    '-y',
    '-i', inputFile,
    '-vn',
    '-acodec', 'libmp3lame',
    '-q:a', '2',
    outputFile,
  ];

  await processAdapterInstance.runProcess({
    name: 'ffmpeg:convert',
    cmd: 'ffmpeg',
    args,
    stdio: 'inherit',
    timeoutMs: 10 * 60 * 1000,
  });
}

export async function convertDirectory({
  inputDir = 'recordings',
  deleteSource = false,
  onLog = console.log,
  checkCommandFn = checkCommand,
  convertFileFn = convertFile,
} = {}) {
  const check = await checkCommandFn('ffmpeg');
  if (!check.ok) {
    if (check.error?.code === 'ENOENT') {
      throw new Error('ffmpeg is required but was not found in PATH.');
    }
    throw new Error(`ffmpeg was found but failed to execute (code: ${check.code}, signal: ${check.signal}). Please reinstall ffmpeg.`);
  }

  await ensureDirectoryExists(inputDir);

  const files = await collectAacFiles(inputDir);
  if (files.length === 0) {
    onLog(`No .aac files found in ${inputDir}`);
    return { total: 0, converted: 0, skipped: 0, failed: 0, deleteSource };
  }

  let total = 0;
  let converted = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    total += 1;
    const outputFile = file.replace(/\.aac$/i, '.mp3');

    if (await fileExists(outputFile)) {
      onLog(`Skipping (mp3 exists): ${outputFile}`);
      skipped += 1;
      continue;
    }

    onLog(`Converting: ${file} -> ${outputFile}`);
    try {
      await convertFileFn(file, outputFile);
      converted += 1;
      if (deleteSource) {
        await fs.unlink(file);
      }
    } catch (err) {
      failed += 1;
      onLog(`Failed to convert ${file}: ${err.message}`);
    }
  }

  return { total, converted, skipped, failed, deleteSource };
}

export function formatSummary(summary) {
  const { total, converted, skipped, failed, deleteSource } = summary;
  const pieces = [
    `Found: ${total}`,
    `converted: ${converted}`,
    `skipped: ${skipped}`,
  ];
  if (failed) pieces.push(`failed: ${failed}`);
  if (deleteSource) pieces.push('source AAC deleted');
  return pieces.join(', ');
}
