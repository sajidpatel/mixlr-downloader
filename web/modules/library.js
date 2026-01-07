import {
  libraryBody,
  libraryCount,
  librarySearch,
  librarySort,
  libraryChannel,
  libraryReset,
  libraryFrom,
  libraryTo,
  libraryRangeToggle,
  libraryRangePopover,
  libraryRangeClear,
  libraryRangeButtonLabel,
  libraryPrev,
  libraryNext,
  libraryPageLabel,
  paginationDesktop,
} from './dom.js';
import { state, getLibraryPageSize } from './state.js';
import { escapeAttr, formatClock, formatDuration, formatSize, formatTime, clamp } from './ui.js';
import { isAbortError } from './api.js';
import { fetchProgressiveStreamUrl, stopAllLiveAudio } from './live.js';

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

let currentAudio = null;
let currentCard = null;
let progressRaf = null;
const SKIP_INTERVAL_SECONDS = 10;

const resetProgressUi = (card) => {
  if (!card) return;
  const fill = card.querySelector('.player-progress__fill');
  const thumb = card.querySelector('.player-progress__thumb');
  const time = card.querySelector('[data-progress-time]');
  if (fill) fill.style.width = '0%';
  if (thumb) thumb.style.left = '0%';
  if (time) time.textContent = '00:00';
};

const setCardPlayingState = (card, playing) => {
  if (!card) return;
  card.classList.toggle('is-playing', playing);
  const btn = card.querySelector('.play-btn');
  const icon = card.querySelector('.player-main-btn__icon');
  if (btn) {
    btn.classList.toggle('active', playing);
    btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
  }
  // Use innerHTML so the SVG renders instead of showing escaped text
  if (icon) icon.innerHTML = playing ?
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"></path></svg>' :
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>';
};

const stopCurrentLibraryAudio = () => {
  if (progressRaf) cancelAnimationFrame(progressRaf);
  progressRaf = null;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }
  if (currentCard) {
    setCardPlayingState(currentCard, false);
    resetProgressUi(currentCard);
  }
  currentAudio = null;
  currentCard = null;
  state.libraryIsPlaying = false;
};

const startProgressLoop = () => {
  if (!currentAudio || currentAudio.paused) return;
  if (progressRaf) cancelAnimationFrame(progressRaf);
  const step = () => {
    if (!currentAudio || currentAudio.paused) return;
    const duration = Number.isFinite(currentAudio.duration) ? currentAudio.duration : 0;
    const currentTime = Number.isFinite(currentAudio.currentTime) ? currentAudio.currentTime : 0;
    const pct = duration ? Math.min((currentTime / duration) * 100, 100) : 0;
    if (currentCard) {
      const fill = currentCard.querySelector('.player-progress__fill');
      const thumb = currentCard.querySelector('.player-progress__thumb');
      const time = currentCard.querySelector('[data-progress-time]');
      if (fill) fill.style.width = `${pct}%`;
      if (thumb) thumb.style.left = `${pct}%`;
      if (time) time.textContent = formatClock(currentTime);
    }
    progressRaf = requestAnimationFrame(step);
  };
  progressRaf = requestAnimationFrame(step);
};

const attachAudioHandlers = (audio, card, playKey, deps) => {
  audio.addEventListener('play', () => {
    state.libraryIsPlaying = true;
    setCardPlayingState(card, true);
    startProgressLoop();
    recordPlay(playKey, deps).then((cnt) => {
      const playPill = card.querySelector('.play-pill');
      if (playPill) {
        const updated = cnt ?? state.playCounts[playKey] ?? 0;
        playPill.textContent = `${updated}`;
      }
    });
  });

  audio.addEventListener('pause', () => {
    if (progressRaf) cancelAnimationFrame(progressRaf);
    progressRaf = null;
    setCardPlayingState(card, false);
    state.libraryIsPlaying = false;
  });

  audio.addEventListener('ended', () => {
    stopCurrentLibraryAudio();
  });

  audio.addEventListener('loadedmetadata', () => {
    const total = card.querySelector('[data-progress-total]');
    if (total && Number.isFinite(audio.duration)) {
      total.textContent = formatClock(audio.duration);
    }
  });
};

const renderLibrarySkeleton = (count = 3) => {
  libraryBody.innerHTML = '';
  const cards = Array.from({ length: count }).map(() => {
    const card = document.createElement('div');
    card.className = 'library-card player-card p-0 shimmer-card';
    card.innerHTML = `
      <div class="library-card__glow"></div>
      <div class="player-card__shimmer"></div>
      <div class="player-shell">
        <div class="player-upper">
          <div class="player-head">
            <div class="player-meta">
              <div class="player-cover skeleton-block"></div>
              <div class="player-text">
                <div class="player-topline skeleton-line w-28"></div>
                <div class="player-topline skeleton-line w-36 mt-2"></div>
              </div>
            </div>
          </div>
          <div class="player-progress skeleton-line w-full h-3 mt-3"></div>
        </div>
        <div class="player-divider"></div>
        <div class="player-bottom">
          <div class="skeleton-pill w-24 h-10"></div>
          <div class="player-icon-row">
            <div class="skeleton-pill w-11 h-11"></div>
            <div class="skeleton-pill w-11 h-11"></div>
            <div class="skeleton-pill w-11 h-11"></div>
          </div>
        </div>
      </div>
    `;
    return card;
  });
  cards.forEach((card) => libraryBody.appendChild(card));
};

const recordPlay = async (key, { api }) => {
  if (!key) return;
  const optimistic = (state.playCounts[key] || 0) + 1;
  state.playCounts[key] = optimistic;
  state.playSeenSession[key] = true;
  try {
    const res = await api('/api/plays', { method: 'POST', body: JSON.stringify({ key }) });
    if (res?.count !== undefined) {
      state.playCounts[key] = res.count;
      return res.count;
    }
  } catch {
    // ignore network errors, keep optimistic count
  }
  return state.playCounts[key];
};

const syncPlayCountsFromItems = (items = []) => {
  state.playCounts = {};
  items.forEach((item) => {
    const key = item.playKey || item.path || item.relativePath || item.downloadUrl || item.url;
    if (!key) return;
    state.playCounts[key] = item.playCount || 0;
  });
};

const updateLibraryPaginationControls = (page, totalPages, totalItems) => {
  if (libraryPageLabel) {
    if (totalItems === 0) {
      libraryPageLabel.textContent = '0 / 0';
    } else {
      libraryPageLabel.textContent = `${page} / ${totalPages}`;
    }
  }
  if (libraryPrev) libraryPrev.disabled = totalItems === 0 || page <= 1;
  if (libraryNext) libraryNext.disabled = totalItems === 0 || page >= totalPages;
  const anyItems = totalItems > 0;
  if (paginationDesktop) paginationDesktop.classList.toggle('hidden', !anyItems);
};

const attachCardHandlers = (cardEls, paged, startIdx, deps) => {
  cardEls.forEach((card) => {
    const songIndex = Number(card.dataset.songIndex);
    const item = paged[songIndex - startIdx];
    const itemPath = item.path || item.relativePath || item.downloadUrl;
    const playKey = item.playKey || item.path || item.relativePath || item.downloadUrl || item.url;
    const fileName = item.file || 'Unknown file';
    const channel = item.channel || 'Unknown channel';
    const playbackUrl = item.downloadUrl || item.url;
    const channelKey = channel.toString().toLowerCase();
    const ensureLibraryAudio = () => {
      if (card._libraryAudio) return card._libraryAudio;
      if (!playbackUrl) return null;
      const audio = document.createElement('audio');
      audio.className = 'library-hidden-audio';
      audio.preload = 'metadata';
      audio.src = playbackUrl;
      audio.load();
      card.querySelector('.player-shell')?.appendChild(audio);
      card._libraryAudio = audio;
      attachAudioHandlers(audio, card, playKey, deps);
      return audio;
    };
    const seekLibraryAudio = (deltaSeconds = 0) => {
      const audio = ensureLibraryAudio();
      if (!audio) return;
      const duration = Number.isFinite(audio.duration) ? audio.duration : Infinity;
      let nextTime = audio.currentTime + deltaSeconds;
      if (nextTime < 0) nextTime = 0;
      if (Number.isFinite(duration)) nextTime = Math.min(nextTime, duration);
      audio.currentTime = nextTime;
    };

    const playBtn = card.querySelector('.play-btn');
    const playPill = card.querySelector('.play-pill');
    const playLiveBtn = card.querySelector('.play-live-btn');
    const downloadBtn = card.querySelector('.download-btn');
    const deleteBtn = card.querySelector('.delete-btn');
    const skipBackBtn = card.querySelector('.player-skip-back-btn');
    const skipForwardBtn = card.querySelector('.player-skip-forward-btn');

    if (playBtn && playbackUrl) {
      playBtn.addEventListener('click', () => {
        stopAllLiveAudio();
        fetchProgressiveStreamUrl(channel).then((prog) => {
          if (!prog) return;
          if (state.liveProgressiveCache.get(channelKey) === prog) return;
          state.liveProgressiveCache.set(channelKey, prog);
        });

        const audio = ensureLibraryAudio();
        if (!audio) return;

        if (currentAudio && currentCard === card) {
          if (currentAudio.paused) {
            currentAudio.play().catch((err) => {
              if (isAbortError(err)) return;
              deps.showToast(err.message || 'Could not resume playback', 'error');
            });
          } else {
            currentAudio.pause();
          }
          return;
        }

        stopCurrentLibraryAudio();
        currentAudio = audio;
        currentCard = card;
        audio.src = playbackUrl;
        audio.play().catch((err) => {
          if (isAbortError(err)) return;
          deps.showToast(err.message || 'Could not start playback', 'error');
          stopCurrentLibraryAudio();
        });
      });
    }

    if (skipBackBtn) {
      skipBackBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!playbackUrl) return;
        seekLibraryAudio(-SKIP_INTERVAL_SECONDS);
      });
    }

    if (skipForwardBtn) {
      skipForwardBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!playbackUrl) return;
        seekLibraryAudio(SKIP_INTERVAL_SECONDS);
      });
    }

    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => recordPlay(playKey, deps));
    }

    if (playLiveBtn) {
      playLiveBtn.addEventListener('click', () => {
        if (!channel) return;
        stopAllLiveAudio();
        const audio = document.createElement('audio');
        audio.className = 'live-audio';
        audio.controls = true;
        audio.setAttribute('controlsList', 'nodownload');
        audio._manualStop = false;

        const tryPlay = async () => {
          try {
            const res = await deps.api(`/api/live/stream?channel=${encodeURIComponent(channel)}`);
            if (!res?.streamUrl) throw new Error('No live stream found');
            audio.src = res.streamUrl;
            await audio.play();
          } catch (err) {
            if (isAbortError(err)) return;
            deps.showToast(err.message || 'Could not start live stream', 'error');
          }
        };

        audio.addEventListener('play', () => {
          if (audio._manualStop) return;
          recordPlay(playKey, deps).then((cnt) => {
            const updated = cnt ?? state.playCounts[playKey] ?? 0;
            if (playPill) playPill.textContent = `${updated}`;
          });
        });

        audio.addEventListener('ended', () => {
          if (audio._manualStop) return;
          tryPlay();
        });

        audio.addEventListener('error', (err) => {
          if (audio._manualStop) return;
          console.error('Live audio error', err);
        });

        audio.addEventListener('abort', () => {
          if (audio._manualStop) return;
          tryPlay();
        });

        tryPlay();
        card.querySelector('.player-shell')?.appendChild(audio);
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (!itemPath) return deps.showToast('Missing file path', 'error');
        const confirmDelete = window.confirm(`Delete ${fileName}? This cannot be undone.`);
        if (!confirmDelete) return;
        deleteBtn.disabled = true;
        try {
          const res = await deps.api('/api/recordings', { method: 'DELETE', body: JSON.stringify({ path: itemPath }) });
          if (res?.error) {
            const err = new Error(res.error);
            if (res.error.toLowerCase().includes('unauthorized')) err.isUnauthorized = true;
            throw err;
          }
          state.libraryItems = state.libraryItems.filter((libItem) => (libItem.path || libItem.relativePath) !== itemPath);
          deps.render();
          deps.showToast('Recording deleted');
        } catch (err) {
          const msg = err?.message || 'Could not delete recording';
          deps.showToast(err?.isUnauthorized ? `Unauthorized: ${msg}` : msg, 'error');
        } finally {
          deleteBtn.disabled = false;
        }
      });
    }

    const progressBar = card.querySelector('.player-progress-bar');
    if (progressBar) {
      progressBar.style.cursor = 'pointer';
      progressBar.addEventListener('click', (e) => {
        e.stopPropagation();
        const audio = ensureLibraryAudio();
        if (!audio) return;

        const track = card.querySelector('.player-progress__track');
        if (!track) return;

        const rect = track.getBoundingClientRect();
        const relativeX = e.clientX - rect.left;
        const pos = clamp(relativeX / rect.width, 0, 1);

        const seek = () => {
          const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
          if (duration > 0) {
             const targetTime = duration * pos;

             // Logic to switch track if needed
             if (currentCard !== card) {
                stopAllLiveAudio();
                stopCurrentLibraryAudio();
                currentCard = card;
                currentAudio = audio;
             }

             // Always ensure we are playing
             if (audio.paused) {
                audio.play().catch((err) => {
                  if (isAbortError(err)) return;
                  deps.showToast(err.message || 'Could not start playback', 'error');
                });
             }

             audio.currentTime = targetTime;

             // Immediate visual update for responsiveness
             const fill = card.querySelector('.player-progress__fill');
             const thumb = card.querySelector('.player-progress__thumb');
             const time = card.querySelector('[data-progress-time]');
             const pct = Math.min(pos * 100, 100);
             if (fill) fill.style.width = `${pct}%`;
             if (thumb) thumb.style.left = `${pct}%`;
             if (time) time.textContent = formatClock(targetTime);
          }
        };

        if (audio.readyState > 0) {
          seek();
        } else {
          audio.addEventListener('loadedmetadata', seek, { once: true });
        }
      });
    }
  });
};

export const renderLibrary = (items = [], query = '', channelFilter = 'all', sortKey = 'date-desc', fromDate = '', toDate = '', deps) => {
  if (state.libraryLoading) {
    renderLibrarySkeleton();
    libraryCount.textContent = '—';
    updateLibraryPaginationControls(1, 1, 0);
    return;
  }
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
    libraryBody.innerHTML = '<p class="text-slate-400">No recordings found.</p>';
    libraryCount.textContent = '0';
    updateLibraryPaginationControls(0, 0, 0);
    return;
  }

  const pageSize = getLibraryPageSize();
  const totalPages = Math.ceil(sorted.length / pageSize);
  if (state.libraryPage > totalPages) state.libraryPage = totalPages || 1;
  const startIdx = (state.libraryPage - 1) * pageSize;
  const paged = sorted.slice(startIdx, startIdx + pageSize);

  const cards = paged.map((item, idx) => {
    const durationSeconds = Number.isFinite(item.duration) ? item.duration : 0;
    const duration = durationSeconds ? formatDuration(durationSeconds) : null;
    const playbackUrl = item.downloadUrl || item.url;
    const logo = item.logo || '';
    const playKey = item.playKey || item.path || item.relativePath || playbackUrl || item.url;
    const plays = state.playCounts[playKey] ?? item.playCount ?? 0;
    const when = formatTime(item.date ?? item.mtime);
    const size = item.size ? formatSize(item.size) : '—';
    const waveform = Array.isArray(item.waveform) && item.waveform.length ? item.waveform.join(',') : null;
    const itemPath = item.path || item.relativePath || item.downloadUrl;
    const channel = item.channel || 'Unknown channel';
    const fileName = item.file || 'Unknown file';
    const fileSafe = escapeAttr(fileName);
    const stage = item.stage || 'Unknown stage';
    const durationLabel = duration ? `${duration} • ${size}` : size;

    const progressVisual = item.waveform && item.waveform.length
      ? `<div class="sparkline" data-points="${escapeAttr(waveform)}"></div>`
      : '';
    const progressMarkup = `
      <div class="player-progress-bar">
        ${progressVisual}
        <div class="player-progress__track">
          <div class="player-progress__fill"></div>
          <div class="player-progress__thumb"></div>
        </div>
        <div class="player-progress__time">
          <span class="player-time player-time--current" data-progress-time>00:00</span>
          <span class="player-time player-time--total" data-progress-total>${duration || '—'}</span>
        </div>
      </div>
    `;

    return `
      <div class="library-card player-card p-0" data-song-index="${startIdx + idx}">
        <div class="player-shell">
          <div class="player-upper">
            <div class="player-head">
              <div class="player-meta">
                <div class="player-cover">
                  <div class="player-cover__inner">${logo ? `<img src="${logo}" alt="${escapeAttr(fileName)}" class="w-full h-full object-cover">` : ''}</div>
                </div>
                <div class="player-text">
                  <div class="player-topline">
                    <div class="flex items-center justify-between w-full">
                      <div class="flex items-center gap-2">
                        <span class="player-icon-btn  bg-white/10 border border-white/15 text-[11px] font-semibold play-pill">${plays}</span>
                      </div>
                      <div class="player-icon-group flex items-center gap-1">
                        <a class="player-icon-btn download-btn" href="/recordings/${escapeAttr(itemPath)}" download="${escapeAttr(fileName)}" aria-label="Download ${escapeAttr(fileName)}">
                          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12"></path><path d="m7 11 5 5 5-5"></path><path d="M5 19h14"></path></svg>
                        </a>
                        <button class="player-icon-btn delete-btn" data-path="${escapeAttr(itemPath)}" aria-label="Delete ${escapeAttr(fileName)}">
                        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 7h12"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12"></path><path d="M9 7V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3"></path></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                  <div class="player-title">
                    <p class="text-lg font-semibold text-white">${channel}</p>
                  </div>
                  <div class="player-subtitle">
                    <p class="text-sm text-slate-300">${when}</p>
                  </div>
                </div>
              </div>
            </div>
          <div class="player-progress">
              ${progressMarkup}
            </div>
          </div>
          <div class="player-divider"></div>
          <div class="player-bottom">
            <div class="player-icon-row player-icon-row--wide">
              <button class="player-icon-btn player-skip-btn player-skip-back-btn" aria-label="Rewind 10 seconds">
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M19 5 12 12l7 7"></path>
                  <path d="M12 5 5 12l7 7"></path>
                </svg>
              </button>
              <button class="player-main-btn play-btn" aria-pressed="false" aria-label="Play ${escapeAttr(fileName)}">
                <span class="player-main-btn__icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>
                </span>
              </button>
              <button class="player-icon-btn player-skip-btn player-skip-forward-btn" aria-label="Fast-forward 10 seconds">
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 5 12 12 5 19"></path>
                  <path d="M12 5 19 12 12 19"></path>
                </svg>
              </button>

            </div>
          </div>
        </div>
      </div>
    `;
  });

  libraryBody.innerHTML = cards.join('');
  libraryCount.textContent = String(sorted.length);
  updateLibraryPaginationControls(state.libraryPage, totalPages, sorted.length);

  const cardEls = libraryBody.querySelectorAll('.library-card');
  attachCardHandlers(cardEls, paged, startIdx, deps);
};

export const populateChannelFilter = (items = []) => {
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

export const loadLibrary = async ({ skipIfPlaying = false, markLoaded = false } = {}, deps) => {
  if (skipIfPlaying && state.libraryIsPlaying) return;
  if (markLoaded) state.libraryHasLoaded = true;
  state.libraryLoading = true;
  renderLibrary([], '', 'all', 'date-desc', '', '', deps);
  try {
    const data = await deps.api('/api/recordings');
    state.libraryItems = data.items || [];
    populateChannelFilter(state.libraryItems);
    syncPlayCountsFromItems(state.libraryItems);
    state.libraryPage = 1;
    renderLibrary(state.libraryItems, librarySearch.value, libraryChannel.value, librarySort.value, libraryFrom?.value, libraryTo?.value, deps);
  } catch (err) {
    if (err?.isUnauthorized) return;
    deps.showToast(err.message, 'error');
  } finally {
    state.libraryLoading = false;
    renderLibrary(state.libraryItems, librarySearch.value, libraryChannel.value, librarySort.value, libraryFrom?.value, libraryTo?.value, deps);
  }
};

export const recordPlayCounts = { recordPlay, syncPlayCountsFromItems };
