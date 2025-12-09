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
import { escapeAttr, formatDuration, formatSize, formatTime } from './ui.js';
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

    const playBtn = card.querySelector('.play-btn');
    const playPill = card.querySelector('.play-pill');
    const playLiveBtn = card.querySelector('.play-live-btn');
    const downloadBtn = card.querySelector('.download-btn');
    const deleteBtn = card.querySelector('.delete-btn');

    if (playBtn && playbackUrl) {
      playBtn.addEventListener('click', () => {
        stopAllLiveAudio();
        const audio = new Audio(playbackUrl);
        audio.play().catch((err) => {
          if (isAbortError(err)) return;
          deps.showToast(err.message || 'Could not start playback', 'error');
        });
        fetchProgressiveStreamUrl(channel).then((prog) => {
          if (!prog) return;
          if (state.liveProgressiveCache.get(channelKey) === prog) return;
          state.liveProgressiveCache.set(channelKey, prog);
        });
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
          await deps.api('/api/recordings', { method: 'DELETE', body: JSON.stringify({ path: itemPath }) });
          state.libraryItems = state.libraryItems.filter((libItem) => (libItem.path || libItem.relativePath) !== itemPath);
          deps.render();
          deps.showToast('Recording deleted');
        } catch (err) {
          if (err?.isUnauthorized) return;
          deps.showToast(err.message, 'error');
        } finally {
          deleteBtn.disabled = false;
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

    const progress = item.waveform && item.waveform.length
      ? `<div class="sparkline" data-points="${escapeAttr(waveform)}"></div>`
      : '<div class="h-3 bg-white/10 rounded-full"></div>';

    return `
      <div class="library-card player-card p-0" data-song-index="${startIdx + idx}">
        <div class="player-shell">
          <div class="player-upper">
            <div class="player-head">
              <div class="player-meta">
                <div class="player-cover">
                  <div class="player-cover__inner"></div>
                </div>
                <div class="player-text">
                  <div class="player-topline">
                    <p class="player-kicker">${channel}</p>
                    <div class="flex items-center gap-2">
                      <span class="player-icon-btn  bg-white/10 border border-white/15 text-[11px] font-semibold play-pill">${plays}</span>
                      <span class="player-icon-btn border border-white/10 bg-white/5 text-[11px] font-semibold">${stage}</span>
                    </div>
                  </div>
                  <div class="player-title">
                    <p class="text-lg font-semibold text-white">${fileSafe}</p>
                  </div>
                  <div class="player-subtitle">
                    <p class="text-sm text-slate-300">${when}</p>
                  </div>
                </div>
              </div>
            </div>
            <div class="player-progress">
              ${progress}
            </div>
          </div>
          <div class="player-divider"></div>
          <div class="player-bottom">
            <div class="player-pill">${durationLabel}</div>
            <div class="player-icon-row">
              <button class="player-icon-btn play-btn" data-url="${escapeAttr(playbackUrl)}" data-key="${escapeAttr(playKey)}" data-channel="${escapeAttr(channel)}">
                ▶
              </button>
              <button class="player-icon-btn play-live-btn" data-channel="${escapeAttr(channel)}" data-key="${escapeAttr(playKey)}">
                🔴
              </button>
              <a class="player-icon-btn download-btn" href="/recordings/${escapeAttr(itemPath)}" download="${escapeAttr(fileName)}">⬇</a>
              <button class="player-icon-btn delete-btn" data-path="${escapeAttr(itemPath)}" aria-label="Delete ${escapeAttr(fileName)}">🗑</button>
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
