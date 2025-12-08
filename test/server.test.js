import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import ConverterService from '../tools/converter/converterService.js';
import { recorderService } from '../server.js';

const realGetRunning = recorderService.getRunning;
const realListLiveStreams = recorderService.listLiveStreams;

test('recorder status payload includes running items and live streams', async () => {
  recorderService.getRunning = async () => ([{
    stage: 'live-stage',
    channel: 'demo',
    fileName: 'demo.mp3',
    path: path.join(process.cwd(), 'recordings/demo/demo.mp3'),
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

  try {
    const payload = await recorderService.buildStatusPayload({ recordingsRoot: process.cwd() });
    assert.equal(payload.recorder.running[0].stage, 'live-stage');
    assert.equal(payload.recorder.running[0].fileName, 'demo.mp3');
    assert.equal(payload.live[0].source, 'local-recording');
  } finally {
    recorderService.getRunning = realGetRunning;
    recorderService.listLiveStreams = realListLiveStreams;
  }
});

test('converter service enriches summaries and tracks last run', async () => {
  const svc = new ConverterService({
    convertFn: async ({ inputDir, deleteSource }) => {
      assert.equal(inputDir, 'recordings');
      assert.equal(deleteSource, true);
      return { total: 1, converted: 1, skipped: 0, failed: 0 };
    },
    summaryFn: (summary) => `done ${summary.converted}`,
  });

  const summary = await svc.enqueue({ inputDir: 'recordings', deleteSource: true });
  assert.equal(summary.summaryText, 'done 1');
  assert.equal(summary.deleteSource, true);
  assert.ok(summary.ranAt);
  assert.deepEqual(svc.getLastSummary(), summary);
});

test('converter service propagates conversion failures', async () => {
  const svc = new ConverterService({
    convertFn: async () => { throw new Error('boom'); },
  });

  await assert.rejects(svc.enqueue({ inputDir: 'recordings' }), /boom/);
});
