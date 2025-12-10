import { manualChannelInput } from './dom.js';

export const bindRecorderForm = (deps) => {
  document.getElementById('manual-channel-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const channel = manualChannelInput.value.trim();
    if (!channel) return;
    try {
      await deps.api('/api/recorder/start', { method: 'POST', body: JSON.stringify({ channel }) });
      deps.showToast(`Triggered ${channel}`);
      manualChannelInput.value = '';
      deps.loadStatus();
    } catch (err) {
      if (err?.isUnauthorized) return;
      deps.showToast(err.message, 'error');
    }
  });
};
