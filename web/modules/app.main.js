import { createApi, isAbortError } from './api.js';
import { createToast } from './ui.js';
import { toastEl } from './dom.js';
import { renderLibrary, loadLibrary } from './library.js';
import { bindLibraryControls, ensureLibraryLoaded } from './libraryControls.js';

const showToast = createToast(toastEl);
const api = createApi(showToast);

const deps = {
  api,
  showToast,
  render: () => renderLibrary(),
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
  bindLibraryControls(deps);

  ensureLibraryLoaded('library', deps);
};

bootstrap();
