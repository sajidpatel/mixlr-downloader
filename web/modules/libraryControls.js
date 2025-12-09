import {
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
} from './dom.js';
import { state } from './state.js';
import { loadLibrary, renderLibrary } from './library.js';
import { formatDateInput } from './ui.js';

const updateRangeLabel = () => {
  const fromVal = formatDateInput(libraryFrom?.value);
  const toVal = formatDateInput(libraryTo?.value);
  if (fromVal && toVal) {
    const text = `${fromVal} → ${toVal}`;
    if (libraryRangeButtonLabel) libraryRangeButtonLabel.textContent = text;
  } else if (fromVal) {
    const text = `From ${fromVal}`;
    if (libraryRangeButtonLabel) libraryRangeButtonLabel.textContent = text;
  } else if (toVal) {
    const text = `Until ${toVal}`;
    if (libraryRangeButtonLabel) libraryRangeButtonLabel.textContent = text;
  } else {
    if (libraryRangeButtonLabel) libraryRangeButtonLabel.textContent = 'Pick start and end';
  }
};

export const bindLibraryControls = (deps) => {
  updateRangeLabel();

  document.getElementById('library-refresh')?.addEventListener('click', () => {
    state.libraryPage = 1;
    loadLibrary({ markLoaded: true }, deps);
  });

  librarySearch?.addEventListener('input', () => {
    state.libraryPage = 1;
    renderLibrary(state.libraryItems, librarySearch.value, libraryChannel.value, librarySort.value, libraryFrom?.value, libraryTo?.value, deps);
  });

  const openRangePopover = () => {
    if (!libraryRangePopover) return;
    libraryRangePopover.classList.add('open');
  };

  const closeRangePopover = () => {
    if (!libraryRangePopover) return;
    libraryRangePopover.classList.remove('open');
  };

  libraryRangeToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (libraryRangePopover?.classList.contains('open')) {
      closeRangePopover();
    } else {
      openRangePopover();
    }
  });

  document.addEventListener('click', (event) => {
    if (!libraryRangePopover) return;
    if (!libraryRangePopover.contains(event.target) && !libraryRangeToggle?.contains(event.target)) {
      closeRangePopover();
    }
  });

  libraryRangeClear?.addEventListener('click', () => {
    libraryFrom.value = '';
    libraryTo.value = '';
    state.libraryPage = 1;
    renderLibrary(state.libraryItems, librarySearch.value, libraryChannel.value, librarySort.value, libraryFrom?.value, libraryTo?.value, deps);
    updateRangeLabel();
  });

  ['change', 'input'].forEach((evt) => {
    libraryFrom?.addEventListener(evt, () => {
      state.libraryPage = 1;
      renderLibrary(state.libraryItems, librarySearch.value, libraryChannel.value, librarySort.value, libraryFrom?.value, libraryTo?.value, deps);
      updateRangeLabel();
    });
    libraryTo?.addEventListener(evt, () => {
      state.libraryPage = 1;
      renderLibrary(state.libraryItems, librarySearch.value, libraryChannel.value, librarySort.value, libraryFrom?.value, libraryTo?.value, deps);
      updateRangeLabel();
    });
  });

  libraryChannel?.addEventListener('change', () => {
    state.libraryPage = 1;
    renderLibrary(state.libraryItems, librarySearch.value, libraryChannel.value, librarySort.value, libraryFrom?.value, libraryTo?.value, deps);
  });

  librarySort?.addEventListener('change', () => {
    state.libraryPage = 1;
    renderLibrary(state.libraryItems, librarySearch.value, libraryChannel.value, librarySort.value, libraryFrom?.value, libraryTo?.value, deps);
  });

  libraryReset?.addEventListener('click', () => {
    librarySearch.value = '';
    libraryChannel.value = 'all';
    librarySort.value = 'date-desc';
    libraryFrom.value = '';
    libraryTo.value = '';
    state.libraryPage = 1;
    renderLibrary(state.libraryItems, librarySearch.value, libraryChannel.value, librarySort.value, libraryFrom?.value, libraryTo?.value, deps);
    updateRangeLabel();
  });

  libraryPrev?.addEventListener('click', () => {
    if (state.libraryPage > 1) {
      state.libraryPage -= 1;
      renderLibrary(state.libraryItems, librarySearch.value, libraryChannel.value, librarySort.value, libraryFrom?.value, libraryTo?.value, deps);
    }
  });

  libraryNext?.addEventListener('click', () => {
    state.libraryPage += 1;
    renderLibrary(state.libraryItems, librarySearch.value, libraryChannel.value, librarySort.value, libraryFrom?.value, libraryTo?.value, deps);
  });

  window.addEventListener('resize', () => {
    renderLibrary(state.libraryItems, librarySearch.value, libraryChannel.value, librarySort.value, libraryFrom?.value, libraryTo?.value, deps);
  });
};

export const ensureLibraryLoaded = (tab, deps) => {
  if (tab === 'library' && !state.libraryHasLoaded) {
    loadLibrary({ markLoaded: true }, deps);
  }
};
