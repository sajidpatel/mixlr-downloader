import { tabButtons, tabPanels } from './dom.js';

export const showTab = (tab) => {
  const activeClasses = 'border border-white/10 bg-white/15 text-white';
  const inactiveClasses = 'border border-transparent text-slate-300';
  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.tab === tab;
    btn.className = `tab-btn px-3 py-2 rounded-xl text-sm font-semibold transition ${isActive ? activeClasses : inactiveClasses}`;
  });
  tabPanels.forEach((panel) => {
    const active = panel.dataset.tabPanel === tab;
    panel.hidden = !active;
  });
};

export const bindTabs = (handler = showTab) => {
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => handler(btn.dataset.tab));
  });
};
