/**
 * theme.js — 亮/暗主题管理
 * 支持 light / dark / system 三档，跟随系统时监听 prefers-color-scheme
 */

import { store } from './store.js';

const mq = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();
let current = 'light';

export function resolvedTheme() {
  const pref = store.settings.theme || 'system';
  if (pref === 'system') return mq.matches ? 'dark' : 'light';
  return pref === 'dark' ? 'dark' : 'light';
}

export function applyTheme(pref) {
  if (pref) store.setSettings({ theme: pref });
  const mode = resolvedTheme();
  current = mode;
  document.documentElement.setAttribute('data-theme', mode);
  document.documentElement.style.colorScheme = mode;

  // 同步浏览器 UI 颜色：保留/创建一个不带 media 的 meta
  document.querySelectorAll('meta[name="theme-color"][media]').forEach((m) => m.remove());
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', mode === 'dark' ? '#131314' : '#f8fafd');

  updateThemeButton(mode);
  listeners.forEach((fn) => fn(mode));
  return mode;
}

export function toggleTheme(event) {
  const next = resolvedTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  if (event) rippleFromEvent(event);
  store.emit('theme', next);
  return next;
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getCurrent() {
  return current;
}

function updateThemeButton(mode) {
  const btn = document.getElementById('btnTheme');
  if (!btn) return;
  const svg = btn.querySelector('svg');
  if (!svg) return;
  const path = svg.querySelector('path');
  if (!path) return;
  // 亮色时显示月亮（点了变暗），暗色时显示太阳
  const d = mode === 'dark'
    ? 'M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 0 0-1.41 0 .996.996 0 0 0 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 0 0-1.41 0 .996.996 0 0 0 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0a.996.996 0 0 0 0-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 0 0 0-1.41.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36a.996.996 0 0 0 0-1.41.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z'
    : 'M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z';
  path.setAttribute('d', d);
  btn.setAttribute('title', mode === 'dark' ? '切换到亮色主题' : '切换到暗色主题');
}

function rippleFromEvent(e) {
  const target = e.currentTarget;
  if (!target || !document.body.contains(target)) return;
  const rect = target.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const span = document.createElement('span');
  span.className = 'ripple';
  span.style.width = span.style.height = `${size}px`;
  span.style.left = `${e.clientX - rect.left - size / 2}px`;
  span.style.top = `${e.clientY - rect.top - size / 2}px`;
  if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
  target.appendChild(span);
  setTimeout(() => span.remove(), 600);
}

/** 初始化：应用一次 + 监听系统变化 */
export function initTheme() {
  applyTheme(store.settings.theme || 'system');
  mq.addEventListener('change', () => {
    if ((store.settings.theme || 'system') === 'system') applyTheme();
  });
  store.on('settings', (s) => {
    if (s.theme) applyTheme(s.theme);
  });
}
