import path from 'path';
import RecorderService from '../tools/recorder/recorderService.js';
import ConverterService from '../tools/converter/converterService.js';
import HlsService from '../tools/recorder/hlsService.js';
import { convertDirectory, formatSummary } from '../tools/converter/converter.js';
import processAdapter from '../tools/process/processAdapter.js';
import RecordingMetadataStore from '../tools/recordingMetadataStore.js';
import PlayCountStore from '../tools/playCountStore.js';
import {
  HLS_IDLE_TIMEOUT_MS,
  HLS_SEGMENT_SECONDS,
  recordingsRoot,
  hlsRoot,
} from './config.js';

const recordingMetadataStore = new RecordingMetadataStore(path.join(recordingsRoot, 'recordings-meta.json'));
const recorderService = new RecorderService({ recordingsDir: recordingsRoot, processAdapter, recordingMetadataStore });
const converterService = new ConverterService({
  convertFn: convertDirectory,
  summaryFn: formatSummary,
  defaultInputDir: recordingsRoot,
});
const playCountStore = new PlayCountStore(path.join(recordingsRoot, 'play-counts.json'));
const hlsService = new HlsService({
  recorderService,
  hlsRoot,
  idleTimeoutMs: HLS_IDLE_TIMEOUT_MS,
  segmentSeconds: HLS_SEGMENT_SECONDS,
  processAdapter,
});

if (process.env.NODE_ENV !== 'test') {
  recorderService.startMonitoring();
}

export {
  recorderService,
  converterService,
  playCountStore,
  hlsService,
  processAdapter,
};
