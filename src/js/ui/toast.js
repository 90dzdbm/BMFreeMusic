/**
 * toast.js — 轻提示
 */

import { icon } from './icons.js';

const host = () => document.getElementById('toastHost');

const ICON_MAP = {
  success: 'check_circle',
  error: 'error',
  info: 'info',
  loading: null,
};

export function toast(message, { type = 'info', duration = 2600, iconName = null } = {}) {
  const h = host();
  if (!h) return () => {};

  const el = document.createElement('div');
  el.className = 'toast';

  const name = iconName || ICON_MAP[type];
  el.innerHTML = `${name ? icon(name) : '<span class="spinner" style="width:16px;height:16px;border-width:2px"></span>'}
    <span>${escapeHTML(message)}</span>`;

  h.appendChild(el);

  const kill = () => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 260);
  };
  const timer = duration > 0 ? setTimeout(kill, duration) : null;

  el.addEventListener('click', () => {
    if (timer) clearTimeout(timer);
    kill();
  });

  return kill;
}

export const toastSuccess = (m) => toast(m, { type: 'success' });
export const toastError = (m) => toast(m, { type: 'error', duration: 3400 });
export const toastInfo = (m) => toast(m, { type: 'info' });

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
