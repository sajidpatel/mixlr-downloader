import fs from 'fs/promises';
import { createReadStream } from 'fs';

/**
 * Create helpers for streaming files over HTTP: one that follows a file as it grows and one that serves files with HTTP Range support.
 * @param {{recorderService: Object, followIdleTimeoutMs: number, followPollIntervalMs: number}} options - Configuration.
 * @param {Object} options.recorderService - Service providing contentTypeFor(filePath).
 * @param {number} options.followIdleTimeoutMs - Milliseconds of idle time after which a growing-file stream is ended.
 * @param {number} options.followPollIntervalMs - Milliseconds between checks for new data when following a growing file.
 * @returns {{streamGrowingFile: function(req, res, filePath), serveFileWithRange: function(req, res, filePath, stats)}} An object with:
 *   - `streamGrowingFile(req, res, filePath)`: streams file data incrementally as the file grows, ends the response after the configured idle timeout, and stops when the client closes the connection or the file is removed.
 *   - `serveFileWithRange(req, res, filePath, stats)`: serves the file honoring the request's `Range` header (responds with 206 when a range is served), sets appropriate `Content-Type`, `Content-Length`, `Accept-Ranges` and `Content-Range` headers, and responds 404 if the file is missing or 500 on other read errors.
 */
export function createStreamHelpers({ recorderService, followIdleTimeoutMs, followPollIntervalMs }) {
  const streamGrowingFile = async (req, res, filePath) => {
    let position = 0;
    let aborted = false;
    let idleTimer;

    const contentType = recorderService.contentTypeFor(filePath);

    const clearIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
    };

    const scheduleIdle = () => {
      clearIdle();
      idleTimer = setTimeout(() => {
        if (!aborted) {
          res.end();
          aborted = true;
        }
      }, followIdleTimeoutMs);
    };

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'Transfer-Encoding': 'chunked',
      'Accept-Ranges': 'bytes',
    });

    req.on('close', () => {
      aborted = true;
      clearIdle();
    });

    const pump = async () => {
      if (aborted) return;

      let stats;
      try {
        stats = await fs.stat(filePath);
      } catch (err) {
        if (err.code === 'ENOENT') {
          res.end();
          return;
        }
        res.destroy(err);
        return;
      }

      if (position < stats.size) {
        const stream = createReadStream(filePath, { start: position });
        stream.on('data', (chunk) => {
          position += chunk.length;
          scheduleIdle();
        });
        stream.on('error', (err) => {
          if (!aborted) res.destroy(err);
        });
        stream.on('end', () => {
          if (aborted) return;
          setTimeout(pump, followPollIntervalMs);
        });
        stream.pipe(res, { end: false });
      } else {
        setTimeout(pump, followPollIntervalMs);
      }
    };

    scheduleIdle();
    pump();
  };

  const serveFileWithRange = (req, res, filePath, stats) => {
    const range = req.headers.range;
    const total = stats.size;
    let start = 0;
    let end = total - 1;

    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      if (match) {
        start = parseInt(match[1], 10);
        end = match[2] ? parseInt(match[2], 10) : end;
        if (Number.isNaN(start) || start >= total) start = 0;
        if (Number.isNaN(end) || end >= total) end = total - 1;
      }
    }

    const chunkSize = end - start + 1;
    res.status(range ? 206 : 200);
    res.setHeader('Content-Type', recorderService.contentTypeFor(filePath));
    res.setHeader('Content-Length', chunkSize);
    res.setHeader('Accept-Ranges', 'bytes');
    if (range) {
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    }

    const stream = createReadStream(filePath, { start, end });
    stream.on('error', (err) => {
      if (err.code === 'ENOENT') return res.status(404).end();
      res.status(500).end();
    });
    stream.pipe(res);
  };

  return { streamGrowingFile, serveFileWithRange };
}