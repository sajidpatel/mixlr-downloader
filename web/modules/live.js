import { liveBody, liveCount } from './dom.js';
import { state } from './state.js';
import { isAbortError } from './api.js';

export const destroyLiveHls = (audio) => {
  const existing = state.liveHlsMap.get(audio);
  if (existing) {
    try { existing.stopLoad?.(); } catch {}
    try { existing.detachMedia?.(); } catch {}
    try { existing.destroy?.(); } catch {}
    state.liveHlsMap.delete(audio);
  }
};

export const destroyLiveMse = (_audio) => {};

export const stopAllLiveAudio = () => {
  document.querySelectorAll('.live-audio').forEach((audio) => {
    audio._manualStop = true;
    audio.pause();
    audio.currentTime = 0;
    destroyLiveHls(audio);
    destroyLiveMse(audio);
  });
};

export const fetchProgressiveStreamUrl = async (channel) => {
  if (!channel) return null;
  const key = channel.toString().toLowerCase();
  if (state.liveProgressiveCache.has(key)) return state.liveProgressiveCache.get(key);
  try {
    const res = await fetch(`https://apicdn.mixlr.com/v3/channel_view/${encodeURIComponent(channel)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    const broadcasts = Array.isArray(data?.included) ? data.included.filter((item) => item.type === 'broadcast') : [];
    const progressive = broadcasts
      .map((b) => b.attributes?.progressive_stream_url)
      .find((url) => typeof url === 'string' && url.length);
    if (progressive) {
      state.liveProgressiveCache.set(key, progressive);
      return progressive;
    }
  } catch {
    return null;
  }
  return null;
};

export const renderLive = (live = [], { api, showToast }) => {
  if (!liveBody || !liveCount) return;
  liveBody.innerHTML = '';

  if (!live.length) {
    liveBody.innerHTML = '<p class="text-slate-400">No live feeds right now.</p>';
    liveCount.textContent = '0';
    return;
  }

  liveCount.textContent = String(live.length);

  live.forEach((stream) => {
    const card = document.createElement('div');
    card.className = 'bg-slate-900/70 border border-white/10 rounded-2xl p-4 shadow-lg space-y-3';
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.className = 'live-audio hidden w-full';
    audio.src = stream.streamUrl;
    audio.setAttribute('controlsList', 'nodownload');

    const streamSrc = stream.streamUrl;
    let shouldResume = false;
    let failureCount = 0;
    const maxFailures = 3;

    const btn = document.createElement('button');
    btn.className = 'px-3 py-1.5 rounded-lg border border-white/15 bg-white/5 text-sm font-semibold hover:bg-white/10 transition';
    btn.textContent = 'Play';

    const setState = (playing) => {
      btn.textContent = playing ? 'Stop' : 'Play';
    };

    const scheduleResume = () => {
      if (!shouldResume) return;
      if (failureCount >= maxFailures) return;
      setTimeout(() => {
        if (!shouldResume) return;
        if (!audio.src) audio.src = streamSrc;
        audio.load();
        audio.play().catch((err) => {
          if (isAbortError(err)) return;
          failureCount += 1;
          scheduleResume();
        });
      }, 300);
    };

    btn.addEventListener('click', () => {
      if (audio.paused) {
        shouldResume = true;
        failureCount = 0;
        if (!audio.src) audio.src = streamSrc;
        audio.load();
        audio.play().catch((err) => {
          if (isAbortError(err)) return;
          showToast(err.message, 'error');
        });
        setState(true);
      } else {
        shouldResume = false;
        audio.pause();
        setState(false);
      }
    });

    audio.addEventListener('play', () => {
      audio.classList.remove('hidden');
      setState(true);
      shouldResume = true;
      failureCount = 0;
    });
    ['pause', 'ended'].forEach((evt) => {
      audio.addEventListener(evt, () => {
        setState(false);
        shouldResume = false;
      });
    });
    ['error', 'stalled', 'abort'].forEach((evt) => {
      audio.addEventListener(evt, () => {
        if (!shouldResume) return;
        failureCount += 1;
        if (failureCount >= maxFailures) {
          shouldResume = false;
          return;
        }
        scheduleResume();
      });
    });

    const followBtn = document.createElement('button');
    followBtn.className = 'px-3 py-1.5 rounded-lg border border-white/15 bg-white/5 text-sm font-semibold hover:bg-white/10 transition';
    followBtn.textContent = 'Follow live';
    followBtn.addEventListener('click', async () => {
      stopAllLiveAudio();
      try {
        const res = await api(`/api/live/stream?channel=${encodeURIComponent(stream.channel || '')}`);
        if (!res?.streamUrl) throw new Error('No live stream found');
        audio.src = res.streamUrl;
        await audio.play();
      } catch (err) {
        if (isAbortError(err)) return;
        showToast(err.message || 'Could not start live stream', 'error');
      }
    });

    card.appendChild(btn);
    card.appendChild(followBtn);
    card.appendChild(audio);
    liveBody.appendChild(card);
  });
};
