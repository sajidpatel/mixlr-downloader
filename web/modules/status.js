import { monitoringBadge, monitoringState, runningCount } from './dom.js';
import { setBadge, setBadgeVariant, formatTime } from './ui.js';
import { renderRunning } from './running.js';
import { renderLive } from './live.js';
import { state } from './state.js';

export const renderStatus = (data, deps) => {
  const { recorder, live } = data;
  setBadge(monitoringBadge, recorder.monitoring, recorder.monitoring ? 'Monitoring' : 'Stopped');
  if (monitoringState) monitoringState.textContent = recorder.monitoring ? 'Monitoring' : 'Idle';
  if (runningCount) runningCount.textContent = recorder.running?.length ?? 0;
  renderRunning(recorder.running, deps);

  renderLive(live || [], deps);
};

export const loadStatus = async (deps) => {
  try {
    const data = await deps.api('/api/status');
    renderStatus(data, deps);
  } catch (err) {
    if (err?.isUnauthorized) return;
    deps.showToast(err.message, 'error');
  }
};

export const startPolling = (deps, intervalMs = 7000) => {
  state.pollInterval = setInterval(() => loadStatus(deps), intervalMs);
};
