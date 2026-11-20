/**
 * ui/desklyrics.js — 桌面歌词
 *
 * APK 里用原生悬浮窗（LyricsService）显示当前这一句歌词：
 *   - 只显示当前一句，没有背景
 *   - 可以拖动（原生层实现的）
 *   - 软件在前台时自动隐藏
 *
 * 浏览器里退化成页面内的浮动小窗（只在页面切到后台时显示）。
 *
 * 用法：
 *   import { deskLyrics } from './ui/desklyrics.js';
 *   deskLyrics.enable();   // 打开
 *   deskLyrics.disable();  // 关闭
 */

import { player } from '../core/player.js';
import { store } from '../core/store.js';

let enabled = false;
let lastIdx = -1;
let domNode = null;
let offs = [];

function bridge() {
  try {
    const b = window.BMFMAndroid;
    return (b && typeof b.updateDeskLyrics === 'function') ? b : null;
  } catch {
    return null;
  }
}

/** 取当前歌词行（只取当前这一句） */
function currentLine() {
  const lines = player.lyric?.lines || [];
  if (!lines.length) return '';
  const idx = Math.max(0, player.currentLyricIndex());
  return lines[idx]?.text || '';
}

function push() {
  const cur = currentLine();
  const b = bridge();
  if (b) {
    try {
      b.updateDeskLyrics(cur);
    } catch { /* noop */ }
    return;
  }
  if (domNode) {
    const el = domNode.querySelector('.desklyrics__cur');
    if (el) el.textContent = cur || '♪';
  }
}

/** 浏览器降级小窗也套用颜色/透明度 */
function applyDomStyle() {
  if (!domNode) return;
  const st = store.settings || {};
  const color = st.deskLyricsColor || '#ffffff';
  const alpha = Number(st.deskLyricsAlpha ?? 0.9);
  domNode.style.color = color;
  domNode.style.opacity = String(alpha);
}

/** 把颜色/透明度/可拖动同步给原生悬浮窗 */
export function applyDeskLyricsStyle() {
  const b = bridge();
  if (!b) return;
  const st = store.settings || {};
  try {
    b.setDeskLyricsStyle?.(st.deskLyricsColor || '#ffffff',
      Number(st.deskLyricsAlpha ?? 0.9));
  } catch { /* noop */ }
  try {
    b.setDeskLyricsDraggable?.(!!st.deskLyricsDraggable);
  } catch { /* noop */ }
  applyDomStyle();
}

function onTime() {
  const idx = player.currentLyricIndex();
  if (idx === lastIdx) return;
  lastIdx = idx;
  push();
}

/** 浏览器里的浮动小窗（软件在前台时隐藏，页面在后台才显示） */
function mountDom() {
  if (domNode || bridge()) return;
  domNode = document.createElement('div');
  domNode.className = 'desklyrics';
  domNode.id = 'desklyrics';
  domNode.innerHTML = `<div class="desklyrics__cur"></div>`;
  document.body.appendChild(domNode);
  syncDomVisibility();
  applyDomStyle();
}

function unmountDom() {
  domNode?.remove();
  domNode = null;
}

function syncDomVisibility() {
  if (!domNode) return;
  // 页面可见 = 软件在前台 → 隐藏；页面隐藏 = 切到后台 → 显示
  const hidden = document.visibilityState === 'hidden';
  domNode.style.display = hidden ? '' : 'none';
}

export const deskLyrics = {
  get enabled() { return enabled; },

  /** 当前环境是否支持（APK 且有悬浮窗权限） */
  available() {
    const b = bridge();
    if (!b) return false;
    try {
      return !!b.canDrawOverlay?.();
    } catch {
      return false;
    }
  },

  /** 申请悬浮窗权限（只在 APK 里有意义） */
  requestPermission() {
    const b = bridge();
    if (!b) return false;
    try {
      b.requestOverlayPermission?.();
      return true;
    } catch {
      return false;
    }
  },

  enable() {
    if (enabled) return true;
    const b = bridge();
    if (b) {
      try {
        if (!b.canDrawOverlay?.()) {
          // 没权限就去要
          b.requestOverlayPermission?.();
          return false;
        }
        b.enableDeskLyrics?.();
      } catch {
        return false;
      }
    }
    enabled = true;
    lastIdx = -1;
    mountDom();
    offs.push(player.on('time', onTime));
    offs.push(player.on('lyric', () => { lastIdx = -1; push(); }));
    offs.push(player.on('track', () => { lastIdx = -1; push(); }));
    document.addEventListener('visibilitychange', syncDomVisibility);
    applyDeskLyricsStyle();
    push();
    return true;
  },

  disable() {
    if (!enabled) return;
    enabled = false;
    offs.forEach((fn) => fn());
    offs = [];
    document.removeEventListener('visibilitychange', syncDomVisibility);
    const b = bridge();
    if (b) {
      try { b.disableDeskLyrics?.(); } catch { /* noop */ }
    }
    unmountDom();
  },

  toggle() {
    if (enabled) { this.disable(); return false; }
    return this.enable();
  },

  /** 设置变化时重新套用样式 */
  applyStyle: applyDeskLyricsStyle,
};
