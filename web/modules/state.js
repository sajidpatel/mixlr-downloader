export const state = {
  libraryItems: [],
  playCounts: {},
  playSeenSession: {},
  libraryIsPlaying: false,
  libraryHasLoaded: false,
  libraryLoading: false,
  libraryPage: 1,
  pollInterval: null,
  liveHlsMap: new WeakMap(),
  liveMseMap: new WeakMap(),
  liveProgressiveCache: new Map(),
};

export const getLibraryPageSize = () => (window.matchMedia('(max-width: 640px)').matches ? 5 : 12);
