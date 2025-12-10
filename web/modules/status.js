import { monitoringBadge, monitoringState, runningCount } from './dom.js';
import { setBadge, setBadgeVariant, formatTime } from './ui.js';
import { renderRunning } from './running.js';
import { renderLive } from './live.js';
import { state } from './state.js';

export const renderStatus = (data, deps) => {
  const { recorder, converter, live } = data;
  setBadge(monitoringBadge, recorder.monitoring, recorder.monitoring ? 'Monitoring' : 'Stopped');
  monitoringState.textContent = recorder.monitoring ? 'Monitoring' : 'Idle';
  runningCount.textContent = recorder.running?.length ?? 0;
  renderRunning(recorder.running, deps);

  if (converter) {
    deps.convertStatus.textContent = `${converter.summaryText} @ ${formatTime(converter.ranAt)} (dir: ${converter.inputDir})`;
    setBadgeVariant(deps.convertBadge, 'Last run', 'success');
    deps.lastConversion.textContent = formatTime(converter.ranAt);
  } else {
    deps.convertStatus.textContent = 'No runs yet.';
    setBadgeVariant(deps.convertBadge, 'Idle', 'muted');
    deps.lastConversion.textContent = '—';
  }

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
