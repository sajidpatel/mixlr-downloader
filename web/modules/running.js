import { runningBody } from './dom.js';
import { formatBytes } from './ui.js';
import { isAbortError } from './api.js';

export const renderRunning = (running, { showToast }) => {
  if (!runningBody) return;
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
    audio.preload = 'none';
    audio.src = '';
    audio.type = 'audio/mpeg';
    audio.className = 'hidden w-full rounded-xl border border-white/10 bg-white/5';
    controls.appendChild(audio);

    let shouldResume = false;
    let failureCount = 0;
    const maxFailures = 5;
    const attemptResume = () => {
      if (!shouldResume) return;
      if (failureCount >= maxFailures) return;
      setTimeout(() => {
        if (!shouldResume) return;
        if (!audio.src) audio.src = streamSrc;
        audio.load();
        audio.play().catch((err) => {
          if (isAbortError(err)) return;
          failureCount += 1;
          setTimeout(attemptResume, 1200);
        });
      }, 300);
    };

    const updateBtn = () => {
      btn.textContent = audio.paused ? 'Play' : 'Stop';
    };

    btn.addEventListener('click', () => {
      if (!streamSrc) {
        showToast('Stream not available yet', 'error');
        return;
      }
      if (audio.paused) {
        failureCount = 0;
        if (!audio.src) audio.src = streamSrc;
        audio.load();
        audio.play().catch((err) => {
          if (isAbortError(err)) return;
          showToast(err.message, 'error');
        });
      } else {
        shouldResume = false;
        audio.pause();
      }
      updateBtn();
    });

    audio.addEventListener('play', () => {
      audio.classList.remove('hidden');
      shouldResume = true;
      failureCount = 0;
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
    ['error', 'stalled', 'abort'].forEach((evt) => {
      audio.addEventListener(evt, () => {
        if (!shouldResume) return;
        failureCount += 1;
        if (failureCount >= maxFailures) {
          shouldResume = false;
          return;
        }
        attemptResume();
      });
    });

    runningBody.appendChild(tr);
  });
};
