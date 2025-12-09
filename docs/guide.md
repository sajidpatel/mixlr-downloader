# mixlr-downloader guide

This doc covers installation, usage, and quick troubleshooting for the web dashboard and CLI helpers.

## Installation (local)
Requirements: Node.js 18+ and FFmpeg installed and available on PATH.

```bash
git clone https://github.com/sajidpatel/mixlr-downloader.git
cd mixlr-downloader
cp .env.example .env        # adjust PORT if desired
npm install
npm run build:css           # only if you change CSS; dist is already committed
npm start                   # serves http://localhost:3000 (binds to 127.0.0.1)
```

The server binds to the loopback interface by default so the UI/API are local-only. Set `BIND_ADDRESS=0.0.0.0` only if you intentionally want remote access.

Environment (common):
- `PORT=3000`
- `BIND_ADDRESS=0.0.0.0` only if you intentionally want remote access.
- `API_TOKEN` (recommended for remote deployments). Protects all `/api`, `/recordings`, and `/live` endpoints. Supply via `X-API-Key`, `Authorization: Bearer`, a `token` query param (sets an HttpOnly cookie), or a `mixlr_api_token` cookie.
  - Public even when `API_TOKEN` is set: `GET /api/status`, `GET/POST /api/plays`, `GET /api/recordings` (but `DELETE /api/recordings` stays protected).
  - `DELETE /api/recordings` is blocked unless `API_TOKEN` is configured.

## Deploying on Coolify (Hetzner)
- Use `Dockerfile.coolify` when creating the service.
- Set `PORT=3000`, `BIND_ADDRESS=0.0.0.0`, and `API_TOKEN` so Coolify’s proxy can reach and authenticate to the container.
- Attach persistent volumes to `/app/recordings` and `/app/hls`.
- Keep routing restricted (e.g., Coolify auth, IP allowlists) if you don’t want the API exposed broadly.
- Example: configure your proxy to inject `X-API-Key: <token>` for upstream requests, or hit `https://your.domain/?token=<token>` once to set an HttpOnly cookie for browser use.

## Usage
- Open `http://localhost:3000`.
- **Control tab**
  - Toggle monitoring with the single Start/Stop button.
  - Start a channel from the dropdown or paste a channel slug and submit.
  - Stop all recordings and refresh status from the header buttons.
  - Live cards let you play current streams.
- **Converter tab**
  - Set the folder to scan (default `recordings`), choose whether to delete sources, and run the converter.
- **Library tab**
  - Search, filter by channel/date, sort, and play/download recordings.
  - Library data loads once when opening the tab; click Refresh to fetch new recordings without losing filters.

## Headless live monitor (no browser)
- Purpose: run on a separate worker/cron host to detect when channels go live and send a webhook once per new live event.
- Command: `npm run monitor:live` (loops forever). Use `node server/liveMonitorWorker.js` for a single run (e.g., cron).
- Env vars:
  - `MONITOR_CHANNELS=chan1,chan2` (default uses built-in channel list)
  - `MONITOR_WEBHOOK_URL=https://example.com/hook` (required to actually alert)
  - `MONITOR_INTERVAL_MS=60000` (loop interval; default 60s)
  - `MONITOR_STATE_FILE=/var/tmp/mixlr-live-state.json` (tracks what was already announced; default `./live-monitor-state.json`)
  - `MONITOR_LOOP=1` (set to loop when not using `npm run monitor:live`)
- Cron example (every minute, single-run with persisted state + webhook):
```
* * * * * cd /path/to/mixlr && MONITOR_WEBHOOK_URL=https://example.com/hook MONITOR_STATE_FILE=/var/tmp/mixlr-live-state.json node server/liveMonitorWorker.js >> /var/log/mixlr-live-monitor.log 2>&1
```

## Troubleshooting
- **Port already in use**: change `PORT` in `.env` or free the port and restart.
- **FFmpeg not found**: install FFmpeg and ensure it is on PATH (`brew install ffmpeg`, `apt-get install ffmpeg`, or download binaries).
- **No recordings appear**: verify monitoring is running, the Mixlr channel is live, and the `recordings/` directory is writable.
- **Playback issues**: if seeking fails or stalls, ensure you are playing the downloadable URL (Library uses it by default); check network and file integrity.
- **Converter errors**: confirm AAC sources exist in the input folder and FFmpeg is installed; see server logs for details.
- **Logs**: watch the server console where you ran `npm start` for errors and status output.
