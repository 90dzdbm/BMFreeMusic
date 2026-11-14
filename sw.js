/**
 * sw.js — Service Worker
 * 只缓存应用外壳与静态资源；音乐接口与音频流永远走网络。
 */

const VERSION = 'bmfm-v1.0.0';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/icon-180.png',
  './assets/favicon.ico',
  './src/css/tokens.css',
  './src/css/base.css',
  './src/css/layout.css',
  './src/css/components.css',
  './src/css/views.css',
  './src/js/app.js',
  './src/js/core/store.js',
  './src/js/core/util.js',
  './src/js/core/theme.js',
  './src/js/core/player.js',
  './src/js/api/gateway.js',
  './src/js/api/sources.js',
  './src/js/ui/icons.js',
  './src/js/ui/toast.js',
  './src/js/ui/components.js',
  './src/js/views/discover.js',
  './src/js/views/search.js',
  './src/js/views/library.js',
  './src/js/views/playlist.js',
  './src/js/views/accounts.js',
  './src/js/views/transfer.js',
  './src/js/views/settings.js',
  './src/js/views/nowplaying.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL).catch(() => { /* 个别文件缺失不阻塞安装 */ }))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // 接口与流媒体：不缓存
  if (url.pathname.startsWith('/api/')) return;

  // 导航请求：网络优先，离线回落到壳
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html').then((r) => r || Response.error())),
    );
    return;
  }

  // 静态资源：缓存优先 + 后台更新
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const clone = res.clone();
            caches.open(VERSION).then((cache) => cache.put(request, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
