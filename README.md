# mixlr-downloader

Web dashboard + tools for recording Mixlr streams, monitoring live channels, and converting AAC captures to MP3. Ships with a browser UI and CLI helpers.

## Features
- Web UI to start/stop monitoring and view live status
- Library tab to browse/play/download recordings
- AAC → MP3 batch converter
- FFMPEG-powered streaming/serving with range support

## Quick start (local)
Requirements: Node.js 18+, FFmpeg installed and on PATH.

```bash
git clone https://github.com/sajidpatel/mixlr-downloader.git
cd mixlr-downloader
npm install
npm run build:css   # only needed if you change CSS; dist is committed
cp .env.example .env  # adjust PORT if desired
npm start            # serves http://localhost:3000 (binds to 127.0.0.1)
```

## Environment
Create a `.env` (or set vars in your host):
- `PORT` (default 3000)
- `BIND_ADDRESS` (default 127.0.0.1; set to 0.0.0.0 only if you intend remote access)
- `API_TOKEN` (optional). When set, all `/api`, `/recordings`, and `/live` routes require this token via `X-API-Key`, `Authorization: Bearer`, `token` query param, or a `mixlr_api_token` cookie.
  - Exceptions (public even with `API_TOKEN`): `GET /api/status`, `GET/POST /api/plays`, `GET /api/recordings` (but `DELETE /api/recordings` remains protected).
  - `DELETE /api/recordings` is blocked unless `API_TOKEN` is configured.

## Deploying on Coolify (Hetzner VPS)
- Build with `Dockerfile.coolify`.
- Set environment: `PORT=3000`, `BIND_ADDRESS=0.0.0.0` so the proxy can reach the container, and **set `API_TOKEN`** to protect the API.
- Configure your Coolify proxy or upstream (e.g., Nginx) to add `X-API-Key: $API_TOKEN` to requests, or append `?token=...` on first load to seed an HttpOnly cookie.
- Map persistent volumes to `/app/recordings` and `/app/hls` for data and HLS output.
- Keep the app behind Coolify’s routing/auth/security settings to avoid exposing the API directly to the public internet.

## Scripts
- `npm start` – run server + web UI
- `npm run build:css` – build Tailwind CSS
- `npm run dev:css` – watch Tailwind during development
- `npm run recorder:tui` – terminal UI recorder (legacy helper)

## Docs
- Detailed setup, usage, and troubleshooting: `docs/guide.md`

## License
MIT.
