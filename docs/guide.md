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
npm start                   # serves http://localhost:3000
```

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

## Troubleshooting
- **Port already in use**: change `PORT` in `.env` or free the port and restart.
- **FFmpeg not found**: install FFmpeg and ensure it is on PATH (`brew install ffmpeg`, `apt-get install ffmpeg`, or download binaries).
- **No recordings appear**: verify monitoring is running, the Mixlr channel is live, and the `recordings/` directory is writable.
- **Playback issues**: if seeking fails or stalls, ensure you are playing the downloadable URL (Library uses it by default); check network and file integrity.
- **Converter errors**: confirm AAC sources exist in the input folder and FFmpeg is installed; see server logs for details.
- **Logs**: watch the server console where you ran `npm start` for errors and status output.
