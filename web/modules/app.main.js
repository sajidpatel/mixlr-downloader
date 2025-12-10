import { createApi, isAbortError } from './api.js';
import { createToast } from './ui.js';
import {
  toastEl,
  convertStatus,
  convertBadge,
  lastConversion,
} from './dom.js';
import { bindTabs, showTab } from './tabs.js';
import { bindRecorderForm } from './recorder.js';
import { bindConverterForm } from './converter.js';
import { renderLibrary, loadLibrary } from './library.js';
import { bindLibraryControls, ensureLibraryLoaded } from './libraryControls.js';
import { loadStatus, startPolling } from './status.js';

const showToast = createToast(toastEl);
const api = createApi(showToast);

const deps = {
  api,
  showToast,
  convertStatus,
  convertBadge,
  lastConversion,
  render: () => renderLibrary(),
  loadStatus: () => loadStatus(deps),
};

window.addEventListener('unhandledrejection', (event) => {
  if (isAbortError(event.reason)) {
    event.preventDefault();
  }
});

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

const bootstrap = () => {
  bindTabs((tab) => {
    showTab(tab);
    ensureLibraryLoaded(tab, deps);
  });

  bindRecorderForm(deps);
  bindConverterForm(deps);
  bindLibraryControls(deps);

  loadStatus(deps);
  startPolling(deps, 7000);

  showTab('library');
  ensureLibraryLoaded('library', deps);
  loadLibrary({ markLoaded: true }, deps);
};

bootstrap();
