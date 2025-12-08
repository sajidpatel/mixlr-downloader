import test from 'node:test';
import assert from 'node:assert/strict';

import {
  recorderService,
  buildStatusPayload,
  handleRecorderStart,
  handleConverterRun,
  __setConverterFns,
} from '../server.js';
import { convertDirectory as realConvertDirectory, formatSummary as realFormatSummary } from '../tools/converter/converter.js';

const realStartChannel = recorderService.startChannel;
const realGetRunning = recorderService.getRunning;
const realListLiveStreams = recorderService.listLiveStreams;

const resetStubs = () => {
  recorderService.startChannel = realStartChannel;
  recorderService.getRunning = realGetRunning;
  recorderService.listLiveStreams = realListLiveStreams;
  __setConverterFns({ convert: realConvertDirectory, summary: realFormatSummary });
};

test('recorder start handler returns expected statuses', async () => {
  let result = await handleRecorderStart(recorderService, {});
  assert.equal(result.status, 400);
  assert.equal(result.payload.error, 'channel is required');

  recorderService.startChannel = async (channel) => ({ started: true, channel, stage: 'stage-one' });
  result = await handleRecorderStart(recorderService, { channel: 'demo' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.payload, { started: true, channel: 'demo', stage: 'stage-one' });

  recorderService.startChannel = async (channel) => ({ started: false, channel, stage: 'demo', reason: 'not-live' });
  result = await handleRecorderStart(recorderService, { channel: 'demo' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.payload, { started: false, channel: 'demo', stage: 'demo', reason: 'not-live' });

  resetStubs();
});

test('status payload includes running items and live streams', async () => {
  recorderService.getRunning = async () => ([{
    stage: 'live-stage',
    channel: 'demo',
    fileName: 'demo.mp3',
    path: `${process.cwd()}/recordings/demo/demo.mp3`,
    size: 1234,
    startedAt: Date.now(),
    sourceUrl: 'http://example.com/stream',
  }]);

  recorderService.listLiveStreams = async () => ([{
    stage: 'live-stage',
    channel: 'demo',
    streamUrl: 'http://example.com/stream',
    title: 'Live Demo',
  }]);

  const payload = await buildStatusPayload(recorderService);
  assert.equal(payload.recorder.running[0].stage, 'live-stage');
  assert.equal(payload.recorder.running[0].fileName, 'demo.mp3');
  assert.equal(payload.live[0].source, 'local-recording');

  resetStubs();
});

test('converter handler returns success and failure payloads', async () => {
  __setConverterFns({
    convert: async ({ inputDir, deleteSource }) => {
      assert.equal(inputDir, 'recordings');
      assert.equal(deleteSource, true);
      return { total: 1, converted: 1, skipped: 0, failed: 0, deleteSource };
    },
    summary: () => 'ok',
  });
  const success = await handleConverterRun({ inputDir: 'recordings', deleteSource: true });
  assert.equal(success.status, 200);
  assert.equal(success.payload.ok, true);
  assert.equal(success.payload.summary.summaryText, 'ok');
  assert.equal(success.payload.summary.deleteSource, true);
  assert.ok(success.payload.summary.ranAt);

  __setConverterFns({
    convert: async () => { throw new Error('boom'); },
    summary: realFormatSummary,
  });
  await assert.rejects(
    () => handleConverterRun({ inputDir: 'recordings', deleteSource: false }),
    /boom/,
  );

  resetStubs();
});
