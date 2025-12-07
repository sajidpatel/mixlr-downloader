const channelSelect = document.getElementById('channel-select');
const manualChannelInput = document.getElementById('manual-channel');
const runningBody = document.getElementById('running-body');
const monitoringToggle = document.getElementById('monitor-toggle');
const monitoringBadge = document.getElementById('monitoring-badge');
const monitoringState = document.getElementById('monitoring-state');
const runningCount = document.getElementById('running-count');
const lastConversion = document.getElementById('last-conversion');
const convertStatus = document.getElementById('convert-status');
const convertBadge = document.getElementById('convert-badge');
const toastEl = document.getElementById('toast');
const convertBtn = document.getElementById('convert-btn');
const inputDirField = document.getElementById('input-dir');
const deleteSourceField = document.getElementById('delete-source');
const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
const liveBody = document.getElementById('live-body');
const liveCount = document.getElementById('live-count');
const libraryBody = document.getElementById('library-body');
const libraryCount = document.getElementById('library-count');
const librarySearch = document.getElementById('library-search');
const librarySort = document.getElementById('library-sort');
const libraryChannel = document.getElementById('library-channel');
const libraryReset = document.getElementById('library-reset');
const libraryFrom = document.getElementById('library-from');
const libraryTo = document.getElementById('library-to');
let libraryItems = [];
let playCounts = {};
let libraryIsPlaying = false;
let playSeenSession = {};
let libraryHasLoaded = false;
let monitoringActive = false;
const liveHlsMap = new WeakMap();
const liveMseMap = new WeakMap();

const destroyLiveHls = (audio) => {
  const existing = liveHlsMap.get(audio);
  if (existing) {
    try { existing.stopLoad?.(); } catch {}
    try { existing.detachMedia?.(); } catch {}
    try { existing.destroy?.(); } catch {}
    liveHlsMap.delete(audio);
  }
};

// MSE worker path is currently disabled; rely on HLS for stability.
const destroyLiveMse = (_audio) => {};

const isAbortError = (err) => err && (err.name === 'AbortError' || err.code === 20);

window.addEventListener('unhandledrejection', (event) => {
  if (isAbortError(event.reason)) {
    event.preventDefault();
  }
});

// Swallow play() abort rejections globally; these happen when a play is interrupted by a quick pause.
if (typeof HTMLMediaElement !== 'undefined') {
  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function patchedPlay(...args) {
    const playPromise = originalPlay.apply(this, args);
    if (playPromise && typeof playPromise.catch === 'function') {
      return playPromise.catch((err) => {
        if (isAbortError(err)) return undefined;
        return Promise.reject(err);
      });
    }
    return playPromise;
  };
}

let pollInterval;

const api = async (path, options = {}) => {
  const opts = { ...options };
  if (opts.body && !opts.headers) {
    opts.headers = { 'Content-Type': 'application/json' };
  }
  const response = await fetch(path, opts);
  const raw = await response.text();
  const parse = () => {
    try {
      return JSON.parse(raw);
    } catch (err) {
      const message = raw?.trim() || response.statusText;
      throw new Error(message || 'Request failed');
    }
  };
  if (!response.ok) {
    const message = raw?.trim() || response.statusText;
    throw new Error(message || 'Request failed');
  }
  return parse();
};

const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${['B', 'KB', 'MB', 'GB', 'TB'][i]}`;
};

const formatTime = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
};

const formatDuration = (seconds) => {
  if (!seconds && seconds !== 0) return '—';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

const formatSize = (bytes) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

const formatClock = (seconds) => {
  if (!Number.isFinite(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const updateRangeProgress = (rangeEl, value, max) => {
  if (!rangeEl) return;
  const safeMax = max && Number.isFinite(max) ? max : Number(rangeEl.max) || 1;
  const pct = Math.min(100, Math.max(0, (value / safeMax) * 100));
  rangeEl.style.setProperty('--progress', `${pct}%`);
};

const pauseOtherLibraryAudio = (currentAudio) => {
  if (!libraryBody) return;
  libraryBody.querySelectorAll('.library-hidden-audio').forEach((audio) => {
    if (audio !== currentAudio) {
      audio.pause();
    }
  });
};

const destroyHlsForAudio = (audio) => {
  const existing = liveHlsMap.get(audio);
  if (existing) {
    existing.destroy();
    liveHlsMap.delete(audio);
  }
};

const ensureHlsForChannel = async (audio, channel, { force = false } = {}) => {
  // HLS disabled for now in favor of direct stream
  return Promise.resolve();
};

const updateLibraryPlayingFlag = () => {
  const anyPlaying = Array.from(document.querySelectorAll('.library-hidden-audio')).some((audio) => !audio.paused && !audio.ended);
  libraryIsPlaying = anyPlaying;
};

const playerIcons = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"></path></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s-6.5-4.35-9-9a5.5 5.5 0 0 1 9-6 5.5 5.5 0 0 1 9 6c-2.5 4.65-9 9-9 9Z"></path></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6.5 5v14"></path><path d="M18 5 9 12l9 7V5Z" fill="currentColor"></path></svg>',
  forward: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17.5 5v14"></path><path d="m6 5 9 7-9 7V5Z" fill="currentColor"></path></svg>',
  repeat: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 7H5a3 3 0 0 0-3 3v1.5"></path><path d="M7 10H5a3 3 0 0 0-3 3v1.5"></path><path d="M6 17H5l-2.5-2.5L5 12h1"></path><path d="M18 17h1a3 3 0 0 0 3-3v-1.5"></path><path d="M17 14h2a3 3 0 0 0 3-3V9.5"></path><path d="M18 7h1l2.5 2.5L19 12h-1"></path></svg>',
  queue: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M4 12h16M4 17h10"></path></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12"></path><path d="m7 11 5 5 5-5"></path><path d="M5 19h14"></path></svg>',
};

const loadPlayCounts = () => {
  try {
    const stored = localStorage.getItem('mixlr-play-counts');
    playCounts = stored ? JSON.parse(stored) : {};
  } catch {
    playCounts = {};
  }
};

const savePlayCounts = () => {
  localStorage.setItem('mixlr-play-counts', JSON.stringify(playCounts));
};

const bumpPlayCount = (url) => {
  playCounts[url] = (playCounts[url] || 0) + 1;
  playSeenSession[url] = true;
  savePlayCounts();
};

const showToast = (message, type = 'info') => {
  if (!toastEl) return;
  const tone = type === 'error' ? toastError : toastInfo;
  toastEl.className = `${toastBase} ${tone}`;
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  setTimeout(() => toastEl.classList.add('hidden'), 2200);
};

const badgeBase = 'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold';
const badgeMuted = 'border-white/15 bg-white/5 text-slate-200';
const badgeSuccess = 'border-emerald-400/60 bg-emerald-500/20 text-emerald-50';
const badgeDanger = 'border-rose-400/60 bg-rose-500/15 text-rose-50';

const toastBase = 'fixed bottom-4 right-4 z-50 rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg max-w-xs';
const toastInfo = 'border-white/10 bg-slate-900/90 text-slate-50';
const toastError = 'border-rose-400/60 bg-rose-500/20 text-rose-50';

const setBadge = (el, active, label) => {
  if (!el) return;
  const variant = active ? badgeSuccess : badgeMuted;
  el.className = `${badgeBase} ${variant}`;
  el.textContent = label;
};

const setBadgeVariant = (el, label, variant = 'muted') => {
  if (!el) return;
  const map = { muted: badgeMuted, success: badgeSuccess, danger: badgeDanger };
  el.className = `${badgeBase} ${map[variant] || badgeMuted}`;
  el.textContent = label;
};

const updateMonitoringToggle = () => {
  if (!monitoringToggle) return;
  const activeClasses = 'px-4 py-2 rounded-xl border border-white/15 bg-white/5 font-semibold';
  const inactiveClasses = 'px-4 py-2 rounded-xl bg-gradient-to-r from-orange-400 to-orange-500 text-slate-950 font-semibold shadow';
  monitoringToggle.textContent = monitoringActive ? 'Stop monitoring' : 'Start monitoring';
  monitoringToggle.className = monitoringActive ? activeClasses : inactiveClasses;
};

const stopAllLiveAudio = () => {
  document.querySelectorAll('.live-audio').forEach((audio) => {
    audio._manualStop = true; // mark so auto-restart is skipped
    audio.pause();
    audio.currentTime = 0;
    destroyLiveHls(audio);
    destroyLiveMse(audio);
  });
};

const renderLive = (live = []) => {
  if (!liveBody || !liveCount) return;
  liveBody.innerHTML = '';

  if (!live.length) {
    liveBody.innerHTML = '<p class="text-slate-400">No live feeds right now.</p>';
    liveCount.textContent = '0';
    return;
  }

  liveCount.textContent = String(live.length);

  live.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'library-card player-card live-card p-0';
    const channel = item.channel || item.stage || 'Unknown';
    const stage = item.stage || channel;
    const title = item.title || item.name || stage;
    const baseStreamUrl = item.streamProxy || `/api/live/stream?channel=${encodeURIComponent(channel)}`;
    const fallbackStreamUrl = item.streamUrl || item.stream || '';
    const coverImage = [item.logo, item.artwork, item.cover].find((val) => typeof val === 'string' && val.length) || null;
    const coverAlt = channel ? `${channel} logo` : 'Channel logo';
    const initial = (channel || stage || 'U').slice(0, 1).toUpperCase();
    const resolveStreamUrl = () => {
      const candidate = baseStreamUrl || fallbackStreamUrl || `/api/live/stream?channel=${encodeURIComponent(channel)}`;
      const sep = candidate.includes('?') ? '&' : '?';
      return `${candidate}${sep}t=${Date.now()}`;
    };
    const coverMarkup = coverImage
      ? `<img src="${coverImage}" alt="${coverAlt}" loading="lazy" class="player-cover__img" />`
      : `<div class="player-cover__fallback">${initial}</div>`;
    card.innerHTML = `
      <div class="library-card__glow"></div>
      <div class="player-card__shimmer"></div>
      <div class="player-shell live-shell">
        <div class="player-upper">
          <div class="player-head">
            <div class="player-meta">
              <div class="player-cover">${coverMarkup}</div>
              <div class="player-text">
                <div class="player-topline">
                  <span class="badge-pill bg-rose-500/20 border border-rose-400/50 text-[11px] font-semibold text-rose-50">LIVE</span>
                  <span class="badge-pill bg-white/10 border border-white/15 text-[11px] font-semibold">${stage}</span>
                </div>
                <h3 class="player-subtle">${channel}</h3>
              </div>
            </div>
          </div>
        </div>

        <div class="player-divider"></div>

        <div class="player-bottom">
          <button class="player-main-btn live-main-btn" type="button" aria-label="Play ${channel}">
            <span class="player-main-btn__icon">${playerIcons.play}</span>
          </button>
        </div>
      </div>
    `;

    const audio = document.createElement('audio');
    audio.className = 'live-audio library-hidden-audio';
    audio.dataset.channel = item.channel;
    audio.preload = 'auto';
    audio.src = baseStreamUrl || fallbackStreamUrl || '';
    audio._manualStop = false;
    card.appendChild(audio);

    const mainBtn = card.querySelector('.live-main-btn');
    const icon = card.querySelector('.player-main-btn__icon');
    const playBtn = card.querySelector('.live-play-btn');

    const setState = (playing) => {
      card.classList.toggle('is-playing', playing);
      if (icon) icon.innerHTML = playing ? playerIcons.pause : playerIcons.play;
      if (playBtn) playBtn.innerHTML = playing ? playerIcons.pause : playerIcons.play;
    };

    let lastRetryAt = 0;
    let shouldAutoRestart = false;
    let manualStop = false;
    const scheduleRestart = () => {
      if (!shouldAutoRestart || manualStop || audio._manualStop) return;
      const now = Date.now();
      if (now - lastRetryAt < 1200) return; // throttle retries
      lastRetryAt = now;
      setTimeout(() => {
        if (!shouldAutoRestart || manualStop || audio._manualStop) return;
        const nextUrl = resolveStreamUrl();
        if (nextUrl) audio.src = nextUrl;
        audio.load();
        audio.play().catch(() => {});
      }, 400);
    };

    const togglePlay = () => {
      if (audio.paused) {
        manualStop = false;
        audio._manualStop = false;
        stopAllLiveAudio();
        shouldAutoRestart = true;
        audio.src = resolveStreamUrl();
        audio.load();
        const playPromise = audio.play();
        Promise.resolve(playPromise).catch((err) => {
          if (isAbortError(err)) return;
          showToast(err.message || 'Could not start playback', 'error');
        });
      } else {
        manualStop = true;
        audio._manualStop = true;
        shouldAutoRestart = false;
        audio.pause();
      }
    };

    mainBtn?.addEventListener('click', togglePlay);
    playBtn?.addEventListener('click', togglePlay);

    audio.addEventListener('play', () => {
      setState(true);
      manualStop = false;
      audio._manualStop = false;
      shouldAutoRestart = true;
    });
    audio.addEventListener('pause', () => {
      setState(false);
      destroyLiveHls(audio);
      destroyLiveMse(audio);
      lastRetryAt = 0;
      if (manualStop || audio._manualStop) {
        shouldAutoRestart = false;
        return;
      }
      scheduleRestart();
    });
    ['ended', 'error', 'stalled', 'abort'].forEach((evt) => {
      audio.addEventListener(evt, () => {
        setState(false);
        manualStop = false;
        audio._manualStop = false;
        shouldAutoRestart = true;
        scheduleRestart();
      });
    });

    liveBody.appendChild(card);
  });
};

const renderRunning = (running) => {
  runningBody.innerHTML = '';
  if (!running || running.length === 0) {
    runningBody.innerHTML = '<tr><td class="px-3 py-3 text-center text-slate-400" colspan="4">No recordings yet.</td></tr>';
    return;
  }

  running.forEach((row) => {
    const tr = document.createElement('tr');
    const streamSrc = row.streamProxy || row.streamUrl || row.downloadUrl || '';
    tr.innerHTML = `
      <td class="px-3 py-2">${row.stage}</td>
      <td class="px-3 py-2">${row.fileName}</td>
      <td class="px-3 py-2">${formatBytes(row.size)}</td>
      <td class="px-3 py-2">
        <div class="flex flex-col gap-2 items-start">
          <button class="px-3 py-1.5 rounded-lg border border-white/15 bg-white/5 text-sm font-semibold hover:bg-white/10 transition play-recording">${streamSrc ? 'Play' : 'Unavailable'}</button>
        </div>
      </td>
    `;

    const btn = tr.querySelector('.play-recording');
    const controls = btn.parentElement;
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'auto';
    audio.src = streamSrc;
    audio.type = 'audio/mpeg';
    audio.className = 'hidden w-full rounded-xl border border-white/10 bg-white/5';
    controls.appendChild(audio);

    let shouldResume = false;
    const attemptResume = () => {
      if (!shouldResume) return;
      setTimeout(() => {
        if (!shouldResume) return;
        audio.load();
        audio.play().catch((err) => {
          if (isAbortError(err)) return;
          setTimeout(attemptResume, 1200);
        });
      }, 300);
    };

    const updateBtn = () => {
      btn.textContent = audio.paused ? 'Play' : 'Stop';
    };

    btn.addEventListener('click', () => {
      if (!audio.src) {
        showToast('No stream URL for this recording', 'error');
        return;
      }
      if (audio.paused) {
        audio.play().catch((err) => {
          if (isAbortError(err)) return;
          showToast(err.message, 'error');
        });
      } else {
        audio.pause();
      }
      updateBtn();
    });

    audio.addEventListener('play', () => {
      audio.classList.remove('hidden');
      shouldResume = true;
      updateBtn();
    });
    audio.addEventListener('pause', () => {
      shouldResume = false;
      updateBtn();
    });
    audio.addEventListener('ended', () => {
      updateBtn();
      attemptResume();
    });
    audio.addEventListener('error', attemptResume);

    runningBody.appendChild(tr);
  });
};

const populateChannels = (channels = []) => {
  channelSelect.innerHTML = '';
  channels.forEach((channel) => {
    const option = document.createElement('option');
    option.value = channel;
    option.textContent = channel;
    channelSelect.appendChild(option);
  });
};

const renderStatus = (data) => {
  const { recorder, converter, live } = data;
  populateChannels(recorder.channels);
  setBadge(monitoringBadge, recorder.monitoring, recorder.monitoring ? 'Monitoring' : 'Stopped');
  monitoringState.textContent = recorder.monitoring ? 'Watching channels' : 'Idle';
  monitoringActive = !!recorder.monitoring;
  updateMonitoringToggle();
  runningCount.textContent = recorder.running?.length ?? 0;
  renderRunning(recorder.running);

  if (converter) {
    convertStatus.textContent = `${converter.summaryText} @ ${formatTime(converter.ranAt)} (dir: ${converter.inputDir})`;
    setBadgeVariant(convertBadge, 'Last run', 'success');
    lastConversion.textContent = formatTime(converter.ranAt);
  } else {
    convertStatus.textContent = 'No runs yet.';
    setBadgeVariant(convertBadge, 'Idle', 'muted');
    lastConversion.textContent = '—';
  }

  renderLive(live || []);
};

const sortItems = (items, sortKey) => {
  const sorted = [...items];
  const getDate = (item) => new Date(item.date ?? item.mtime).getTime();
  switch (sortKey) {
    case 'date-asc':
      sorted.sort((a, b) => getDate(a) - getDate(b));
      break;
    case 'channel-asc':
      sorted.sort((a, b) => a.channel.localeCompare(b.channel) || getDate(b) - getDate(a));
      break;
    case 'channel-desc':
      sorted.sort((a, b) => b.channel.localeCompare(a.channel) || getDate(b) - getDate(a));
      break;
    case 'duration-desc':
      sorted.sort((a, b) => (b.duration ?? -1) - (a.duration ?? -1));
      break;
    case 'duration-asc':
      sorted.sort((a, b) => (a.duration ?? Number.MAX_SAFE_INTEGER) - (b.duration ?? Number.MAX_SAFE_INTEGER));
      break;
    case 'size-desc':
      sorted.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
      break;
    case 'size-asc':
      sorted.sort((a, b) => (a.size ?? 0) - (b.size ?? 0));
      break;
    case 'name-desc':
      sorted.sort((a, b) => b.file.localeCompare(a.file));
      break;
    case 'name-asc':
      sorted.sort((a, b) => a.file.localeCompare(b.file));
      break;
    case 'date-desc':
    default:
      sorted.sort((a, b) => getDate(b) - getDate(a));
      break;
  }
  return sorted;
};

const renderLibrary = (items = [], query = '', channelFilter = 'all', sortKey = 'date-desc', fromDate = '', toDate = '') => {
  libraryBody.innerHTML = '';
  const normalized = query.trim().toLowerCase();
  const fromTs = fromDate ? new Date(fromDate).getTime() : null;
  const toTs = toDate ? new Date(toDate).getTime() + 24 * 60 * 60 * 1000 - 1 : null;

  const filtered = items.filter((item) => {
    if (!normalized) return true;
    const haystack = `${item.channel} ${item.file} ${item.date ?? ''} ${formatTime(item.date ?? item.mtime)}`.toLowerCase();
    return haystack.includes(normalized);
  }).filter((item) => (channelFilter === 'all' ? true : item.channel === channelFilter))
    .filter((item) => {
      const ts = new Date(item.date ?? item.mtime).getTime();
      if (fromTs && ts < fromTs) return false;
      if (toTs && ts > toTs) return false;
      return true;
    });

  const sorted = sortItems(filtered, sortKey);

  if (sorted.length === 0) {
    libraryBody.innerHTML = '<p class="text-slate-400">No recordings match.</p>';
    libraryCount.textContent = '0';
    return;
  }

  libraryCount.textContent = sorted.length;

  sorted.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'library-card player-card p-0';
    card.dataset.songIndex = idx;
    const when = formatTime(item.date ?? item.mtime);
    const durationSeconds = Number.isFinite(item.duration) ? item.duration : 0;
    const duration = durationSeconds ? formatDuration(durationSeconds) : '—';
    const playbackUrl = item.downloadUrl || item.url;
    const playKey = playbackUrl || item.url;
    const plays = playCounts[playKey] || 0;
    const sizeLabel = formatSize(item.size);
    const displayName = item.file || 'Recording';
    const initial = (item.channel || displayName).slice(0, 1).toUpperCase();
    const artwork = item.cover || item.artwork || item.thumbnail;
    const downloadUrl = item.downloadUrl || item.url || null;
    const coverMarkup = artwork
      ? `<img src="${artwork}" alt="Cover art for ${displayName}" loading="lazy" class="player-cover__img" />`
      : `<div class="player-cover__fallback">${initial}</div>`;
    const downloadBtn = downloadUrl
      ? `<a class="player-icon-btn btn-download" href="${downloadUrl}" download title="Download">${playerIcons.download}</a>`
      : '';

    card.innerHTML = `
      <div class="library-card__glow"></div>
      <div class="player-card__shimmer"></div>
      <div class="player-shell">
        <div class="player-upper">
          <div class="player-head">
            <div class="player-meta">
              <div class="player-cover">${coverMarkup}</div>
              <div class="player-text">
                <div class="player-topline">
                  <p class="player-kicker">${item.channel || 'Recorded set'}</p>
                  <span class="badge-pill bg-white/10 border border-white/15 text-[11px] font-semibold play-pill">${plays} play${plays === 1 ? '' : 's'}</span>
                </div>
                <h3 class="player-sub">${item.channel || '—'}</h3>
                <p class="player-subtle">${when} • ${sizeLabel}</p>
              </div>
            </div>
          </div>

          <div class="player-progress">
            <input type="range" class="player-range" min="0" max="${Math.max(durationSeconds || 0, 1)}" value="0" step="0.01" aria-label="Scrub ${displayName}" />
            <div class="player-time-row">
              <span class="player-time player-time--current">00:00</span>
              <span class="player-time player-time--duration">${durationSeconds ? formatClock(durationSeconds) : '00:00'}</span>
            </div>
          </div>
        </div>

        <div class="player-divider"></div>

        <div class="player-bottom">
          <button class="player-main-btn" type="button" aria-label="Play ${displayName}">
            <span class="player-main-btn__icon">${playerIcons.play}</span>
          </button>
          <div class="player-icon-row">
            ${downloadBtn}
            <button class="player-icon-btn btn-like" type="button" title="Favorite">${playerIcons.heart}</button>
            <button class="player-icon-btn btn-back" type="button" title="Back 10s">${playerIcons.back}</button>
            <button class="player-icon-btn btn-forward" type="button" title="Forward 15s">${playerIcons.forward}</button>
            <button class="player-icon-btn btn-repeat" type="button" title="Loop">${playerIcons.repeat}</button>
          </div>
        </div>
      </div>
    `;

    const audio = document.createElement('audio');
    audio.className = 'library-hidden-audio';
    audio.preload = 'none';
    audio.src = playbackUrl;
    card.appendChild(audio);

    const playBtn = card.querySelector('.player-main-btn');
    const playIcon = card.querySelector('.player-main-btn__icon');
    const range = card.querySelector('.player-range');
    const currentEl = card.querySelector('.player-time--current');
    const playPill = card.querySelector('.play-pill');
    const backBtn = card.querySelector('.btn-back');
    const forwardBtn = card.querySelector('.btn-forward');
    const repeatBtn = card.querySelector('.btn-repeat');
    const likeBtn = card.querySelector('.btn-like');

    if (playSeenSession[item.url]) {
      if (playPill) playPill.textContent = `${plays} play${plays === 1 ? '' : 's'}`;
    }

    const setState = (playing) => {
      card.classList.toggle('is-playing', playing);
      if (playIcon) playIcon.innerHTML = playing ? playerIcons.pause : playerIcons.play;
    };

    const updateProgress = () => {
      if (!range) return;
      const max = audio.duration && Number.isFinite(audio.duration) ? audio.duration : Number(range.max) || durationSeconds || 1;
      const value = Math.min(max, audio.currentTime || 0);
      range.max = max;
      range.value = value;
      updateRangeProgress(range, value, max);
      if (currentEl) currentEl.textContent = formatClock(value);
      const durationEl = card.querySelector('.player-time--duration');
      if (durationEl && max) durationEl.textContent = formatClock(max);
    };

    const handlePlayCount = () => {
      if (!playKey) return;
      if (playSeenSession[playKey]) return;
      bumpPlayCount(playKey);
      const updated = playCounts[playKey] || 0;
      if (playPill) playPill.textContent = `${updated} play${updated === 1 ? '' : 's'}`;
    };

    playBtn?.addEventListener('click', () => {
      if (audio.paused) {
        pauseOtherLibraryAudio(audio);
        audio.play().catch((err) => {
          if (isAbortError(err)) return;
          showToast(err.message || 'Could not start playback', 'error');
        });
      } else {
        audio.pause();
      }
    });

    if (range) {
      updateRangeProgress(range, 0, Number(range.max));
      range.addEventListener('input', () => {
        const max = Number(range.max) || durationSeconds || 1;
        const next = Math.min(max, Number(range.value) || 0);
        audio.currentTime = next;
        updateRangeProgress(range, next, max);
        if (currentEl) currentEl.textContent = formatClock(next);
      });
    }

    backBtn?.addEventListener('click', () => {
      const next = Math.max(0, (audio.currentTime || 0) - 10);
      audio.currentTime = next;
      updateProgress();
    });

    forwardBtn?.addEventListener('click', () => {
      const max = audio.duration && Number.isFinite(audio.duration) ? audio.duration : (Number(range?.max) || durationSeconds || (audio.currentTime + 15));
      const next = Math.min(max, (audio.currentTime || 0) + 15);
      audio.currentTime = next;
      updateProgress();
    });

    repeatBtn?.addEventListener('click', () => {
      repeatBtn.classList.toggle('active');
      audio.loop = repeatBtn.classList.contains('active');
    });

    likeBtn?.addEventListener('click', () => {
      likeBtn.classList.toggle('active');
    });

    audio.addEventListener('loadedmetadata', updateProgress);
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('play', () => {
      pauseOtherLibraryAudio(audio);
      setState(true);
      handlePlayCount();
      updateLibraryPlayingFlag();
    });
    audio.addEventListener('pause', () => {
      setState(false);
      updateLibraryPlayingFlag();
    });
    audio.addEventListener('ended', () => {
      setState(false);
      updateLibraryPlayingFlag();
    });

    libraryBody.appendChild(card);
  });

  updateLibraryPlayingFlag();
};

const loadStatus = async () => {
  try {
    const data = await api('/api/status');
    renderStatus(data);
  } catch (err) {
    showToast(err.message, 'error');
  }
};

const loadLibrary = async ({ skipIfPlaying = false, markLoaded = false } = {}) => {
  if (skipIfPlaying && libraryIsPlaying) return;
  if (markLoaded) libraryHasLoaded = true;
  try {
    const data = await api('/api/recordings');
    libraryItems = data.items || [];
    populateChannelFilter(libraryItems);
    renderLibrary(libraryItems, librarySearch.value, libraryChannel.value, librarySort.value, libraryFrom?.value, libraryTo?.value);
  } catch (err) {
    showToast(err.message, 'error');
  }
};

const showTab = (tab) => {
  const activeClasses = 'border border-white/10 bg-white/15 text-white';
  const inactiveClasses = 'border border-transparent text-slate-300';
  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.tab === tab;
    btn.className = `tab-btn px-3 py-2 rounded-xl text-sm font-semibold transition ${isActive ? activeClasses : inactiveClasses}`;
  });
  tabPanels.forEach((panel) => {
    const active = panel.dataset.tabPanel === tab;
    panel.classList.toggle('hidden', !active);
  });
  if (tab === 'library' && !libraryHasLoaded) {
    loadLibrary({ markLoaded: true });
  }
};

const populateChannelFilter = (items = []) => {
  if (!libraryChannel) return;
  const previous = libraryChannel.value || 'all';
  const existing = new Set(['all']);
  const options = ['<option value="all">All channels</option>'];
  items.forEach((item) => {
    const channelName = item.channel;
    if (!channelName || existing.has(channelName)) return;
    existing.add(channelName);
    options.push(`<option value="${channelName}">${channelName}</option>`);
  });
  libraryChannel.innerHTML = options.join('');
  if (existing.has(previous)) {
    libraryChannel.value = previous;
  } else {
    libraryChannel.value = 'all';
  }
};

monitoringToggle?.addEventListener('click', async () => {
  if (monitoringToggle.disabled) return;
  const wasActive = monitoringActive;
  monitoringToggle.disabled = true;
  monitoringToggle.textContent = wasActive ? 'Stopping…' : 'Starting…';
  try {
    if (wasActive) {
      await api('/api/recorder/monitor/stop', { method: 'POST', body: JSON.stringify({ stopRecordings: false }) });
      showToast('Monitoring stopped');
    } else {
      await api('/api/recorder/monitor/start', { method: 'POST', body: JSON.stringify({}) });
      showToast('Monitoring started');
    }
    await loadStatus();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    monitoringToggle.disabled = false;
    updateMonitoringToggle();
  }
});

document.getElementById('refresh-status').addEventListener('click', async () => {
  try {
    await api('/api/recorder/refresh', { method: 'POST' });
    loadStatus();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('stop-all').addEventListener('click', async () => {
  try {
    await api('/api/recorder/stop-all', { method: 'POST' });
    showToast('Stopped all recordings');
    loadStatus();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('channel-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const channel = channelSelect.value;
  if (!channel) return;
  try {
    await api('/api/recorder/start', { method: 'POST', body: JSON.stringify({ channel }) });
    showToast(`Triggered ${channel}`);
    loadStatus();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('manual-channel-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const channel = manualChannelInput.value.trim();
  if (!channel) return;
  try {
    await api('/api/recorder/start', { method: 'POST', body: JSON.stringify({ channel }) });
    showToast(`Triggered ${channel}`);
    manualChannelInput.value = '';
    loadStatus();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('convert-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  convertBtn.disabled = true;
  convertBtn.textContent = 'Running...';
  try {
    const payload = { inputDir: inputDirField.value || 'recordings', deleteSource: deleteSourceField.checked };
    const result = await api('/api/converter/run', { method: 'POST', body: JSON.stringify(payload) });
    convertStatus.textContent = result.summary.summaryText;
    setBadgeVariant(convertBadge, 'Just ran', 'success');
    lastConversion.textContent = formatTime(result.summary.ranAt);
    showToast('Conversion finished');
  } catch (err) {
    convertStatus.textContent = err.message;
    setBadgeVariant(convertBadge, 'Error', 'danger');
    showToast(err.message, 'error');
  } finally {
    convertBtn.disabled = false;
    convertBtn.textContent = 'Run converter';
  }
});

const startPolling = () => {
  pollInterval = setInterval(loadStatus, 7000);
};

updateMonitoringToggle();
loadStatus();
startPolling();
loadPlayCounts();
showTab('control');

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

document.getElementById('library-refresh')?.addEventListener('click', () => {
  loadLibrary({ markLoaded: true });
});

librarySearch?.addEventListener('input', () => {
  renderLibrary(libraryItems, librarySearch.value, libraryChannel.value, librarySort.value, libraryFrom?.value, libraryTo?.value);
});

librarySort?.addEventListener('change', () => {
  renderLibrary(libraryItems, librarySearch.value, libraryChannel.value, librarySort.value, libraryFrom?.value, libraryTo?.value);
});

libraryChannel?.addEventListener('change', () => {
  renderLibrary(libraryItems, librarySearch.value, libraryChannel.value, librarySort.value, libraryFrom?.value, libraryTo?.value);
});

libraryFrom?.addEventListener('change', () => {
  renderLibrary(libraryItems, librarySearch.value, libraryChannel.value, librarySort.value, libraryFrom?.value, libraryTo?.value);
});

libraryTo?.addEventListener('change', () => {
  renderLibrary(libraryItems, librarySearch.value, libraryChannel.value, librarySort.value, libraryFrom?.value, libraryTo?.value);
});

libraryReset?.addEventListener('click', () => {
  librarySearch.value = '';
  libraryChannel.value = 'all';
  librarySort.value = 'date-desc';
  if (libraryFrom) libraryFrom.value = '';
  if (libraryTo) libraryTo.value = '';
  renderLibrary(libraryItems, '', 'all', 'date-desc', '', '');
});
