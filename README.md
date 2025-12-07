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
npm start            # serves http://localhost:3000
```

## Environment
Create a `.env` (or set vars in your host):
- `PORT` (default 3000)

## Deploy to cPanel (Node.js app)
1) In cPanel, open **Setup Node.js App** (or similar).  
2) Set App Directory to your uploaded project folder and Startup file to `server.js`.  
3) Install deps in that directory: `npm install` (via terminal or the panel’s button).  
4) Set env vars (PORT) in the app config or via `.env` in the app directory.  
5) Start/Restart the app. If a subdomain needs proxying, point it to the app using Apache/Passenger or an `.htaccess` proxy to `127.0.0.1:PORT`.

## Scripts
- `npm start` – run server + web UI
- `npm run build:css` – build Tailwind CSS
- `npm run dev:css` – watch Tailwind during development
- `npm run recorder:tui` – terminal UI recorder (legacy helper)

## License
MIT.
