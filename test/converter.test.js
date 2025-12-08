import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { convertDirectory, formatSummary } from '../tools/converter/converter.js';

const tempDirs = [];

const makeTempDir = async () => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'mixlr-test-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('formatSummary reports counts and delete flag', () => {
  const summary = formatSummary({ total: 5, converted: 3, skipped: 1, failed: 1, deleteSource: true });
  assert.equal(summary, 'Found: 5, converted: 3, skipped: 1, failed: 1, source AAC deleted');
});

test('convertDirectory converts AAC files and deletes sources when requested', async () => {
  const root = await makeTempDir();
  const nested = path.join(root, 'nested');
  await fs.mkdir(nested);

  const first = path.join(root, 'first.aac');
  const second = path.join(nested, 'second.aac');
  await fs.writeFile(first, 'aac-data');
  await fs.writeFile(second, 'more-aac');

  const convertCalls = [];
  const stubConvert = async (inputFile, outputFile) => {
    convertCalls.push({ inputFile, outputFile });
    await fs.writeFile(outputFile, 'mp3-data');
  };

  const summary = await convertDirectory({
    inputDir: root,
    deleteSource: true,
    onLog: () => {},
    commandExistsFn: async () => true,
    convertFileFn: stubConvert,
  });

  assert.equal(summary.total, 2);
  assert.equal(summary.converted, 2);
  assert.equal(summary.skipped, 0);
  assert.equal(summary.failed, 0);
  assert.equal(summary.deleteSource, true);
  assert.equal(convertCalls.length, 2);

  await assert.rejects(fs.access(first));
  await assert.rejects(fs.access(second));
  await assert.doesNotReject(fs.access(path.join(root, 'first.mp3')));
  await assert.doesNotReject(fs.access(path.join(nested, 'second.mp3')));
});

test('convertDirectory skips existing mp3 files and counts failures without deleting sources', async () => {
  const root = await makeTempDir();

  const skipAac = path.join(root, 'skip.aac');
  const skipMp3 = path.join(root, 'skip.mp3');
  const failAac = path.join(root, 'fail.aac');

  await fs.writeFile(skipAac, 'aac');
  await fs.writeFile(skipMp3, 'mp3');
  await fs.writeFile(failAac, 'aac');

  let convertAttempts = 0;
  const stubConvert = async (inputFile, outputFile) => {
    convertAttempts += 1;
    if (inputFile === failAac) {
      throw new Error('ffmpeg failure');
    }
    await fs.writeFile(outputFile, 'mp3');
  };

  const summary = await convertDirectory({
    inputDir: root,
    deleteSource: false,
    onLog: () => {},
    commandExistsFn: async () => true,
    convertFileFn: stubConvert,
  });

  assert.equal(summary.total, 2);
  assert.equal(summary.converted, 0);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.failed, 1);
  assert.equal(convertAttempts, 1);

  await assert.doesNotReject(fs.access(skipAac));
  await assert.doesNotReject(fs.access(skipMp3));
  await assert.doesNotReject(fs.access(failAac));
});
