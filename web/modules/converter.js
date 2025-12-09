import { convertBtn, inputDirField, deleteSourceField, convertStatus, convertBadge, lastConversion } from './dom.js';
import { setBadgeVariant, formatTime } from './ui.js';

export const bindConverterForm = (deps) => {
  document.getElementById('convert-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    convertBtn.disabled = true;
    convertBtn.textContent = 'Running...';
    try {
      const payload = { inputDir: inputDirField.value || 'recordings', deleteSource: deleteSourceField.checked };
      const result = await deps.api('/api/converter/run', { method: 'POST', body: JSON.stringify(payload) });
      convertStatus.textContent = result.summary.summaryText;
      setBadgeVariant(convertBadge, 'Just ran', 'success');
      lastConversion.textContent = formatTime(result.summary.ranAt);
      deps.showToast('Conversion finished');
    } catch (err) {
      convertStatus.textContent = err.message;
      setBadgeVariant(convertBadge, 'Error', 'danger');
      if (err?.isUnauthorized) return;
      deps.showToast(err.message, 'error');
    } finally {
      convertBtn.disabled = false;
      convertBtn.textContent = 'Run converter';
    }
  });
};
