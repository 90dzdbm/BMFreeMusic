/**
 * ui/desklyrics.js — 桌面歌词
 *
 * APK 里用原生悬浮窗（LyricsService）显示当前歌词；
 * 浏览器里退化成页面内的一个浮动小窗，行为一致。
 *
 * 用法：
 *   import { deskLyrics } from './ui/desklyrics.js';
 *   deskLyrics.enable();   // 打开
 *   deskLyrics.disable();  // 关闭
 */

import { player } from '../core/player.js';

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

/** 取当前歌词行与下一行 */
function currentLines() {
  const lines = player.lyric?.lines || [];
  if (!lines.length) return { cur: '', next: '' };
  const idx = Math.max(0, player.currentLyricIndex());
  return {
    cur: lines[idx]?.text || '',
    next: lines[idx + 1]?.text || '',
  };
}

function push() {
  const { cur, next } = currentLines();
  const b = bridge();
  if (b) {
    b.updateDeskLyrics(cur, next);
    return;
  }
  if (domNode) {
    domNode.querySelector('.desklyrics__cur').textContent = cur || '♪';
    domNode.querySelector('.desklyrics__next').textContent = next || '';
  }
}

function onTime() {
  const idx = player.currentLyricIndex();
  if (idx === lastIdx) return;
  lastIdx = idx;
  push();
}

/** 浏览器里的浮动小窗 */
function mountDom() {
  if (domNode || bridge()) return;
  domNode = document.createElement('div');
  domNode.className = 'desklyrics';
  domNode.id = 'desklyrics';
  domNode.innerHTML = `
    <div class="desklyrics__cur"></div>
    <div class="desklyrics__next"></div>`;
  document.body.appendChild(domNode);
}

function unmountDom() {
  domNode?.remove();
  domNode = null;
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
    push();
    return true;
  },

  disable() {
    if (!enabled) return;
    enabled = false;
    offs.forEach((fn) => fn());
    offs = [];
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
};
