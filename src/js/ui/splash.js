/**
 * ui/splash.js — 启动开屏页
 *
 * 设置 → 外观 → 开屏页 里可以指定一张图片或一段视频作为开屏，
 * 可调显示时长，视频可以静音。设置保存在 store.settings.*，
 * 媒体文件本身通过原生桥存到「手机存储/BMFreeMusic/」，这里只存路径。
 */

import { store } from '../core/store.js';
import { icon } from './icons.js';

/** 原生：保存媒体文件，返回文件名 */
async function nativeSaveMedia(file) {
  const b = window.BMFMAndroid;
  if (!b || typeof b.saveMedia !== 'function') return null;
  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    // 分块转 base64，避免一次 apply 太大把 WebView 撑爆
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    const b64 = btoa(bin);
    return b.saveMedia(file.name, file.type || '', b64);
  } catch {
    return null;
  }
}

function nativeMediaUrl(name) {
  const b = window.BMFMAndroid;
  if (!b || typeof b.mediaUrl !== 'function') return null;
  try {
    return b.mediaUrl(name);
  } catch {
    return null;
  }
}

/**
 * 读取用户设置的开屏媒体。
 * 支持三种来源：
 *   1. 原生保存过的文件（mediaName）
 *   2. 直接填写的 http(s) 链接
 *   3. web 环境下用户现场选的文件（临时 blob URL，只本次有效）
 */
export function currentSplashMedia() {
  const s = store.settings;
  if (!s.splashEnabled || !s.splashMedia) return null;

  // blob URL 是本次会话临时选的
  if (s.splashMedia.startsWith('blob:')) return { url: s.splashMedia, type: s.splashType || 'image' };

  // 原生文件
  const native = nativeMediaUrl(s.splashMedia);
  if (native) return { url: native, type: s.splashType || 'image' };

  // 直接的链接
  if (/^https?:\/\//.test(s.splashMedia)) return { url: s.splashMedia, type: s.splashType || 'image' };

  return null;
}

/** 在应用启动时调用；没配开屏就什么都不做 */
export function playSplash() {
  const media = currentSplashMedia();
  if (!media) return;

  const s = store.settings;
  const duration = Math.max(0.5, Number(s.splashDuration) || 2.5);

  const layer = document.createElement('div');
  layer.className = 'splash';
  layer.id = 'splash';

  if (media.type === 'video') {
    layer.innerHTML = `
      <video class="splash__video" id="splashVideo"
             src="${media.url}" autoplay playsinline></video>
      <button class="splash__skip" id="splashSkip">跳过</button>`;
  } else {
    layer.innerHTML = `
      <img class="splash__img" id="splashImg" src="${media.url}" alt="">
      <button class="splash__skip" id="splashSkip">跳过</button>`;
  }

  document.body.appendChild(layer);

  const video = layer.querySelector('#splashVideo');
  if (video) {
    video.muted = s.splashMuted !== false;
    // 自动播放被拦时退回到静音再试一次
    video.play?.().catch(() => {
      try { video.muted = true; video.play?.(); } catch { /* noop */ }
    });
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    try {
      if (video) { video.pause(); video.removeAttribute('src'); }
    } catch { /* noop */ }
    layer.classList.add('is-closing');
    setTimeout(() => layer.remove(), 320);
  };

  const timer = setTimeout(close, duration * 1000);
  layer.querySelector('#splashSkip')?.addEventListener('click', close);
  // 点画面也能跳过
  layer.addEventListener('click', (e) => {
    if (e.target.id !== 'splashSkip') close();
  });
}

/** 选择开屏媒体（设置页用），返回 {name, type} 或 null */
export async function pickSplashMedia(file) {
  if (!file) return null;
  const type = /video\//.test(file.type) ? 'video' : 'image';

  // APK：存到「手机存储/BMFreeMusic/」，只留文件名
  if (window.BMFMAndroid?.saveMedia) {
    const name = await nativeSaveMedia(file);
    if (name) return { name, type };
  }

  // 网页：临时 blob URL，本次会话有效
  try {
    return { name: URL.createObjectURL(file), type };
  } catch {
    return null;
  }
}

export { icon };
