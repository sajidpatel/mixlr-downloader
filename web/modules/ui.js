const badgeBase = 'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold';
const badgeMuted = 'border-white/15 bg-white/5 text-slate-200';
const badgeSuccess = 'border-emerald-400/60 bg-emerald-500/20 text-emerald-50';
const badgeDanger = 'border-rose-400/60 bg-rose-500/15 text-rose-50';

const toastBase = 'fixed bottom-4 right-4 z-50 rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg max-w-xs';
const toastInfo = 'border-white/10 bg-slate-900/90 text-slate-50';
const toastError = 'border-rose-400/60 bg-rose-500/20 text-rose-50';

export const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${['B', 'KB', 'MB', 'GB', 'TB'][i]}`;
};

export const formatTime = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
};

export const formatDateInput = (val) => {
  if (!val) return null;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

export const escapeAttr = (value = '') => String(value).replace(/"/g, '&quot;');

export const formatDuration = (seconds) => {
  if (!seconds && seconds !== 0) return '—';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

export const formatSize = (bytes) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

export const formatClock = (seconds) => {
  if (!Number.isFinite(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

export const setBadge = (el, active, label) => {
  if (!el) return;
  const variant = active ? badgeSuccess : badgeMuted;
  el.className = `${badgeBase} ${variant}`;
  el.textContent = label;
};

export const setBadgeVariant = (el, label, variant = 'muted') => {
  if (!el) return;
  const map = { muted: badgeMuted, success: badgeSuccess, danger: badgeDanger };
  el.className = `${badgeBase} ${map[variant] || badgeMuted}`;
  el.textContent = label;
};

export const createToast = (toastEl) => (message, type = 'info') => {
  if (!toastEl) return;
  const tone = type === 'error' ? toastError : toastInfo;
  toastEl.className = `${toastBase} ${tone}`;
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  setTimeout(() => toastEl.classList.add('hidden'), 2200);
};
