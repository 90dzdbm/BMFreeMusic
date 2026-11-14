/**
 * app.js — 应用入口：路由、播放条、全局交互
 */

import { store, SOURCES } from './core/store.js';
import { initTheme, toggleTheme, applyTheme } from './core/theme.js';
import { player } from './core/player.js';
import { hydrateIcons, icon, setIcon } from './ui/icons.js';
import { toast, toastSuccess, toastError, toastInfo } from './ui/toast.js';
import {
  lists, getList, openMenu, openDialog, closeDialog,
  coverOf, placeholderCover, trackRowHTML,
} from './ui/components.js';
import { esc, fmtTime, uid } from './core/util.js';
import { jobs } from './core/jobs.js';
import { openNowPlaying, closeNowPlaying, isOpen as npIsOpen } from './views/nowplaying.js';
import { showArtistBio } from './ui/artistbio.js';
import { resolveTrack } from './api/sources.js';

import * as discoverView from './views/discover.js';
import * as searchView from './views/search.js';
import * as libraryView from './views/library.js';
import * as playlistView from './views/playlist.js';
import * as accountsView from './views/accounts.js';
import * as transferView from './views/transfer.js';
import * as settingsView from './views/settings.js';
import * as sponsorView from './views/sponsor.js';

/* ==========================================================================
   导航定义
   ========================================================================== */
const NAV = [
  { key: 'discover', label: '发现', icon: 'explore', hash: '#/discover' },
  { key: 'search', label: '搜索', icon: 'search', hash: '#/search' },
  { key: 'library', label: '音乐库', icon: 'library', hash: '#/library' },
  { key: 'transfer', label: '迁移', icon: 'transfer', hash: '#/transfer' },
  { key: 'accounts', label: '账号', icon: 'account', hash: '#/accounts' },
  { key: 'settings', label: '设置', icon: 'settings', hash: '#/settings' },
];

const viewRoot = () => document.getElementById('view');
const mainEl = () => document.getElementById('main');

let currentRoute = null;

/* ==========================================================================
   路由
   ========================================================================== */
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/discover';
  const [pathPart, queryPart] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  const seg = pathPart.split('/').filter(Boolean);

  if (!seg.length) return { name: 'discover', params: {} };
  const [first, second, third] = seg;

  if (first === 'discover') return { name: 'discover', params: query };
  if (first === 'search') return { name: 'search', params: { ...query, q: query.q || '' } };
  if (first === 'library') return { name: 'library', params: query };
  if (first === 'playlist' && second && third) return { name: 'playlist', params: { source: second, id: third } };
  if (first === 'local' && second) return { name: 'playlist', params: { local: second } };
  if (first === 'liked') return { name: 'playlist', params: { liked: true } };
  if (first === 'recent') return { name: 'library', params: { tab: 'recent' } };
  if (first === 'accounts') return { name: 'accounts', params: query };
  if (first === 'transfer') return { name: 'transfer', params: query };
  if (first === 'settings') return { name: 'settings', params: query };
  if (first === 'sponsor') return { name: 'sponsor', params: query };

  return { name: 'discover', params: {} };
}

const VIEWS = {
  discover: discoverView,
  search: searchView,
  library: libraryView,
  playlist: playlistView,
  accounts: accountsView,
  transfer: transferView,
  settings: settingsView,
  sponsor: sponsorView,
};

let cleanup = null;

async function route() {
  const { name, params } = parseHash();
  currentRoute = name;

  // 高亮导航
  document.querySelectorAll('.rail__item').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.nav === name);
  });

  const root = viewRoot();
  if (cleanup) { try { cleanup(); } catch { /* noop */ } cleanup = null; }
  root.innerHTML = '';

  const view = VIEWS[name] || discoverView;
  try {
    cleanup = await view.render(root, params);
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="view"><div class="empty">${icon('error', 'icon-lg')}
      <h3>页面加载出错</h3><p>${esc(e.message)}</p></div></div>`;
  }

  hydrateIcons(root);
  mainEl().scrollTop = 0;
  document.title = name === 'discover' ? 'BM Free Music' : titleOf(name);
}

function titleOf(name) {
  const map = {
    discover: '发现', search: '搜索', library: '我的音乐',
    playlist: '歌单', accounts: '平台账号', transfer: '歌单迁移',
    settings: '设置', sponsor: '赞助支持',
  };
  return `${map[name] || ''} · BM Free Music`;
}

/* ==========================================================================
   导航栏渲染
   ========================================================================== */
function renderRail() {
  const rail = document.getElementById('rail');
  rail.innerHTML = NAV.map((n) => `
    <a class="rail__item" href="${n.hash}" data-nav="${n.key}" data-link title="${n.label}">
      <span class="rail__pill"></span>
      ${icon(n.icon)}
      <span>${n.label}</span>
    </a>`).join('');
}

/* ==========================================================================
   顶栏
   ========================================================================== */
function initTopbar() {
  const form = document.getElementById('globalSearch');
  const input = document.getElementById('searchInput');
  const clearBtn = document.getElementById('searchClear');

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  const kbd = document.getElementById('searchKbd');
  if (kbd) kbd.textContent = isMac ? '⌘ K' : 'Ctrl K';

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    location.hash = `#/search?q=${encodeURIComponent(q)}`;
    input.blur();
  });

  input.addEventListener('input', () => {
    clearBtn.hidden = !input.value;
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.hidden = true;
    input.focus();
  });

  // 搜索页时同步输入框
  document.addEventListener('route-change', () => {
    const { name, params } = parseHash();
    if (name === 'search' && params.q) {
      input.value = params.q;
      clearBtn.hidden = false;
    }
  });

  document.getElementById('btnTheme').addEventListener('click', (e) => {
    const next = toggleTheme(e);
    toastInfo(next === 'dark' ? '已切换到暗色主题' : '已切换到亮色主题');
  });

  document.getElementById('btnTransfer').addEventListener('click', () => {
    location.hash = '#/transfer';
  });
  document.getElementById('btnAccounts').addEventListener('click', () => {
    location.hash = '#/accounts';
  });
  document.getElementById('btnSettings').addEventListener('click', () => {
    location.hash = '#/settings';
  });

  // 滚动时给顶栏加分隔线
  mainEl().addEventListener('scroll', () => {
    document.getElementById('topbar').classList.toggle('is-scrolled', mainEl().scrollTop > 4);
  }, { passive: true });
}

/* ==========================================================================
   播放条
   ========================================================================== */
function initPlaybar() {
  const cover = document.getElementById('pbCover');
  const coverImg = document.getElementById('pbCoverImg');
  const titleEl = document.getElementById('pbTitle');
  const artistEl = document.getElementById('pbArtist');
  const likeBtn = document.getElementById('pbLike');
  const btnPlay = document.getElementById('btnPlay');
  const btnPlayIcon = document.getElementById('btnPlayIcon');
  const seek = document.getElementById('seek');
  const timeCur = document.getElementById('timeCur');
  const timeDur = document.getElementById('timeDur');
  const volume = document.getElementById('volume');
  const btnMute = document.getElementById('btnMute');
  const btnShuffle = document.getElementById('btnShuffle');
  const btnRepeat = document.getElementById('btnRepeat');
  const btnQueue = document.getElementById('btnQueue');
  const btnNext = document.getElementById('btnNext');
  const btnPrev = document.getElementById('btnPrev');
  const btnExpand = document.getElementById('btnExpand');

  /* --- 曲目变化 --- */
  player.on('track', (track) => {
    if (!track) return;
    coverImg.src = coverOf(track);
    titleEl.textContent = track.name;
    artistEl.textContent = `${track.artist}`;
    cover.classList.add('is-playing');
    document.title = `${track.name} - ${track.artist} · BM Free Music`;
    updateLike();
    renderQueue();
  });

  player.on('state', (state) => {
    setIcon(btnPlayIcon, state === 'playing' ? 'pause' : 'play');
    cover.classList.toggle('is-playing', state === 'playing');
    if (state === 'error') {
      cover.classList.remove('is-playing');
    }
  });

  player.on('time', ({ current, duration }) => {
    const d = duration || 0;
    if (d > 0) {
      timeCur.textContent = fmtTime(current);
      timeDur.textContent = fmtTime(d);
      seek.style.setProperty('--val', `${(current / d) * 100}%`);
      if (!seek.matches(':active')) seek.value = String(Math.round((current / d) * 1000));
    } else {
      timeCur.textContent = '0:00';
    }
  });

  player.on('error', ({ message, track }) => {
    toastError(`${track?.name || '曲目'} 播放失败：${message}`);
    updateTrackBadge(track, true, message);
  });

  player.on('playable', (track) => {
    updateTrackBadge(track, false);
  });

  player.on('fallback', ({ matched }) => {
    if (matched) toastInfo(`已自动换源：${SOURCES[matched.source]?.short || matched.source}`);
  });

  player.on('blocked', () => {
    toastInfo('已暂停，点击页面任意处继续');
  });

  /* --- 控件 --- */
  btnPlay.addEventListener('click', () => player.toggle());
  btnNext.addEventListener('click', () => player.next(true));
  btnPrev.addEventListener('click', () => player.prev());

  btnShuffle.addEventListener('click', () => {
    const on = player.toggleShuffle();
    btnShuffle.classList.toggle('is-on', on);
    toastInfo(on ? '随机播放已开启' : '随机播放已关闭');
  });

  btnRepeat.addEventListener('click', () => {
    const mode = player.cycleRepeat();
    btnRepeat.classList.toggle('is-on', mode !== 'off');
    setIcon(btnRepeat.querySelector('svg'), mode === 'one' ? 'repeat_one' : 'repeat');
    toastInfo(mode === 'one' ? '单曲循环' : mode === 'all' ? '列表循环' : '不循环');
  });

  seek.addEventListener('input', () => {
    const d = player.audio.duration || 0;
    if (d) timeCur.textContent = fmtTime((seek.value / 1000) * d * 1000);
    seek.style.setProperty('--val', `${(seek.value / 1000) * 100}%`);
  });
  seek.addEventListener('change', () => {
    const d = player.audio.duration || 0;
    if (d) player.seek((seek.value / 1000) * d * 1000);
  });

  volume.addEventListener('input', () => {
    const v = Number(volume.value) / 100;
    player.setVolume(v);
    volume.style.setProperty('--val', `${volume.value}%`);
    setIcon(btnMute.querySelector('svg'), v === 0 ? 'mute' : 'volume');
  });

  btnMute.addEventListener('click', () => {
    const muted = player.toggleMute();
    setIcon(btnMute.querySelector('svg'), muted ? 'mute' : 'volume');
    volume.value = muted ? 0 : Math.round(player.audio.volume * 100);
    volume.style.setProperty('--val', `${volume.value}%`);
  });

  btnQueue.addEventListener('click', () => toggleQueue());
  document.getElementById('queueClose').addEventListener('click', () => toggleQueue(false));
  document.getElementById('queueClear').addEventListener('click', () => {
    player.pause();
    store.clearQueue();
    renderQueue();
    toast('队列已清空');
  });

  btnExpand.addEventListener('click', () => openNowPlaying());
  cover.addEventListener('click', () => openNowPlaying());
  titleEl.addEventListener('click', () => openNowPlaying());

  /* --- 喜欢 --- */
  const updateLike = () => {
    const t = player.current;
    const liked = t ? store.isLiked(t) : false;
    likeBtn.classList.toggle('is-liked', liked);
    setIcon(likeBtn.querySelector('svg'), liked ? 'heart_filled' : 'heart');
  };

  likeBtn.addEventListener('click', () => {
    const t = player.current;
    if (!t) return toastInfo('还没有在播放的歌曲');
    const liked = store.toggleLike(t);
    updateLike();
    toastSuccess(liked ? '已加入我喜欢的音乐' : '已取消喜欢');
  });

  store.on('liked', updateLike);

  /* --- 初始化状态 --- */
  const s = store.settings;
  volume.value = Math.round((s.muted ? 0 : (s.volume ?? 0.8)) * 100);
  volume.style.setProperty('--val', `${volume.value}%`);
  btnShuffle.classList.toggle('is-on', !!s.shuffle);
  btnRepeat.classList.toggle('is-on', (s.repeat || 'off') !== 'off');
  setIcon(btnRepeat.querySelector('svg'), s.repeat === 'one' ? 'repeat_one' : 'repeat');

  if (store.state.queue.length && store.state.queueIndex >= 0) {
    const t = store.state.queue[store.state.queueIndex];
    coverImg.src = coverOf(t);
    titleEl.textContent = t.name;
    artistEl.textContent = t.artist;
  }

  // 队列抽屉
  renderQueue();
  store.on('queue', renderQueue);
}

/* ==========================================================================
   曲目「无法播放」标记的即时更新
   ========================================================================== */
export function updateTrackBadge(track, failed, reason = '') {
  if (!track?.key) return;
  const selector = `.track[data-key="${(window.CSS && CSS.escape) ? CSS.escape(track.key) : track.key.replace(/"/g, '\\"')}"]`;
  document.querySelectorAll(selector).forEach((row) => {
    row.classList.toggle('is-unplayable', !!failed);
    const title = row.querySelector('.track__title');
    if (!title) return;

    let warn = title.querySelector('.track__warn');
    if (failed) {
      if (!warn) {
        warn = document.createElement('span');
        warn.className = 'track__warn';
        warn.innerHTML = `${icon('error', 'icon-xs')}无法播放`;
        title.appendChild(warn);
      }
      warn.title = reason || '该音源无法播放';
    } else if (warn) {
      warn.remove();
    }
  });
}

/* ==========================================================================
   播放队列
   ========================================================================== */
function toggleQueue(force) {
  const drawer = document.getElementById('queueDrawer');
  const open = force === undefined ? !drawer.classList.contains('is-open') : force;
  drawer.classList.toggle('is-open', open);
  drawer.setAttribute('aria-hidden', String(!open));
  if (open) renderQueue();
}

function renderQueue() {
  const list = document.getElementById('queueList');
  if (!list) return;
  const q = store.state.queue;
  const idx = store.state.queueIndex;
  document.getElementById('queueCount').textContent = `${q.length} 首`;

  if (!q.length) {
    list.innerHTML = `<div class="empty" style="padding:var(--sp-10) var(--sp-4)">
      ${icon('queue', 'icon-lg')}
      <h3>队列是空的</h3>
      <p>在任意歌曲上点「加入播放队列」即可</p>
    </div>`;
    return;
  }

  list.innerHTML = q.map((t, i) => `
    <div class="track ${i === idx ? 'is-current' : ''}" data-q-index="${i}" tabindex="0">
      <div class="track__index">
        ${i === idx ? '<span class="eq"><i></i><i></i><i></i></span>' : String(i + 1).padStart(2, '0')}
      </div>
      <div class="track__main">
        <img class="track__cover" loading="lazy" src="${esc(coverOf(t))}" alt="">
        <div class="track__text">
          <div class="track__title">${esc(t.name)}</div>
          <div class="track__artist">${esc(t.artist)}</div>
        </div>
      </div>
      <div class="track__album"></div>
      <div class="track__dur">${t.duration ? fmtTime(t.duration) : ''}</div>
      <div class="track__actions">
        <button class="icon-btn icon-btn--sm" data-q-act="remove" title="从队列移除">
          ${icon('close', 'icon-sm')}
        </button>
      </div>
    </div>`).join('');
}

/* ==========================================================================
   全局列表交互
   ========================================================================== */
function initListInteraction() {
  const handler = async (e) => {
    // 队列抽屉
    const qRow = e.target.closest('[data-q-index]');
    if (qRow) {
      const i = Number(qRow.dataset.qIndex);
      const act = e.target.closest('[data-q-act]');
      if (act?.dataset.qAct === 'remove') {
        store.removeFromQueue(i);
        return;
      }
      player.jumpTo(i);
      return;
    }

    const row = e.target.closest('.track');
    if (!row) return;

    const act = e.target.closest('[data-act]');
    const listId = row.dataset.list;
    const index = Number(row.dataset.index);
    const trackList = listId ? getList(listId) : [];
    const track = trackList[index];
    if (!track) return;

    if (act) {
      e.preventDefault();
      e.stopPropagation();
      switch (act.dataset.act) {
        case 'like': {
          const liked = store.toggleLike(track);
          act.style.color = liked ? 'var(--google-red-500)' : '';
          act.innerHTML = icon(liked ? 'heart_filled' : 'heart', 'icon-sm');
          toastSuccess(liked ? '已加入我喜欢的音乐' : '已取消喜欢');
          break;
        }
        case 'queue-add': {
          store.enqueue(track, { next: false });
          toastSuccess('已加入播放队列');
          break;
        }
        case 'more': {
          openTrackMenu(act, track);
          break;
        }
        default:
          break;
      }
      return;
    }

    // 点击行 → 播放
    if (trackList.length) {
      await player.playList(trackList, index);
    }
  };

  document.getElementById('view').addEventListener('click', handler);
  document.getElementById('queueList').addEventListener('click', handler);

  // 键盘可达
  document.getElementById('view').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.track');
    if (!row) return;
    e.preventDefault();
    const listId = row.dataset.list;
    const index = Number(row.dataset.index);
    const list = listId ? getList(listId) : [];
    if (list[index]) player.playList(list, index);
  });
}

/* ==========================================================================
   下载：优先走原生 DownloadManager，网页版退化成 blob 下载
   ========================================================================== */
function safeFilename(s) {
  return String(s || '')
    .replace(/[\\/:*?"<>|\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'audio';
}

async function downloadTrack(track) {
  toast(`正在准备「${track.name}」…`, { duration: 5000 });
  try {
    const res = await resolveTrack(track, { allowFallback: true });
    const url = res.rawUrl || res.url;
    if (!url || url.startsWith('blob:')) throw new Error('该曲目没有可直接下载的地址');

    const extMatch = url.match(/\.(flac|m4a|wav)(\?|$)/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'mp3';
    const filename = `${safeFilename(track.name)} - ${safeFilename(track.artist)}.${ext}`;

    if (window.BMFMAndroid?.download) {
      window.BMFMAndroid.download(url, filename);
      toastSuccess('已加入下载队列，在通知栏查看进度');
      return;
    }

    toast('正在下载…', { duration: 4000 });
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 15000);
    toastSuccess('下载完成');
  } catch (e) {
    toastError(`下载失败：${e.message}`);
  }
}

function openTrackMenu(anchor, track) {
  const liked = store.isLiked(track);
  const playlists = store.state.playlists;
  const items = [
    {
      label: '立即播放',
      icon: 'play',
      onClick: () => player.playList([track], 0),
    },
    {
      label: '下一首播放',
      icon: 'queue',
      onClick: () => {
        store.enqueue(track, { next: true });
        toastSuccess('已插到下一首');
      },
    },
    {
      label: '加入播放队列',
      icon: 'add',
      onClick: () => {
        store.enqueue(track, { next: false });
        toastSuccess('已加入播放队列');
      },
    },
    {
      label: liked ? '取消喜欢' : '加入我喜欢的音乐',
      icon: liked ? 'heart_filled' : 'heart',
      onClick: () => {
        store.toggleLike(track);
        toastSuccess(store.isLiked(track) ? '已加入喜欢' : '已取消喜欢');
      },
    },
    {
      label: '下载到本地',
      icon: 'download',
      onClick: () => downloadTrack(track),
    },
    {
      label: '歌手简介',
      icon: 'artist',
      onClick: () => showArtistBio(track.artist),
    },
    { separator: true },
    {
      label: '复制歌曲信息',
      icon: 'link',
      onClick: async () => {
        const text = `${track.name} - ${track.artist} [${SOURCES[track.source]?.name || track.source}]`;
        try {
          await navigator.clipboard.writeText(text);
          toastSuccess('已复制到剪贴板');
        } catch {
          toast(text);
        }
      },
    },
  ];

  if (playlists.length) {
    items.push({ separator: true });
    playlists.slice(0, 8).forEach((pl) => {
      items.push({
        label: `加入「${pl.name}」`,
        icon: 'library',
        onClick: () => {
          const n = store.addTracksToPlaylist(pl.id, [track]);
          toastSuccess(n ? `已加入「${pl.name}」` : '这首歌已在歌单里');
        },
      });
    });
  } else {
    items.push({ separator: true });
    items.push({
      label: '新建歌单并加入',
      icon: 'add',
      onClick: () => {
        const pl = store.createPlaylist(`歌单 ${store.state.playlists.length + 1}`);
        store.addTracksToPlaylist(pl.id, [track]);
        toastSuccess(`已创建并加入「${pl.name}」`);
      },
    });
  }

  openMenu(anchor, items);
}

/* ==========================================================================
   本地文件
   ========================================================================== */
function initLocalFiles() {
  const input = document.getElementById('localFileInput');

  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    input.value = '';

    const tracks = files.map((file) => {
      const base = file.name.replace(/\.[^.]+$/, '');
      const m = base.match(/^(.+?)\s*[-–—]\s*(.+)$/);
      const artist = m ? m[1].trim() : '本地音乐';
      const name = m ? m[2].trim() : base;
      return {
        key: `local:${uid('f')}`,
        id: uid('f'),
        source: 'local',
        name,
        artist,
        album: '本地文件',
        duration: 0,
        cover: '',
        extra: { blobUrl: URL.createObjectURL(file), fileName: file.name, size: file.size },
      };
    });

    const targetPl = window.__bmfmAddFilesTo;
    if (targetPl) {
      const pl = store.getPlaylist(targetPl);
      if (pl) {
        store.addTracksToPlaylist(targetPl, tracks);
        toastSuccess(`已添加 ${tracks.length} 个文件到「${pl.name}」`);
        window.__bmfmAddFilesTo = null;
        if (currentRoute === 'playlist') route();
        return;
      }
    }

    store.enqueue(tracks);
    player.playList(tracks, 0);
    toastSuccess(`已开始播放 ${tracks.length} 个本地文件`);
  });
}

/* ==========================================================================
   快捷键
   ========================================================================== */
function initHotkeys() {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const editable = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

    // Ctrl/⌘ + K 聚焦搜索
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      document.getElementById('searchInput')?.focus();
      document.getElementById('searchInput')?.select();
      return;
    }

    if (editable) return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        player.toggle();
        break;
      case 'ArrowRight':
        e.preventDefault();
        player.seek((player.audio.currentTime + 5) * 1000);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        player.seek(Math.max(0, player.audio.currentTime - 5) * 1000);
        break;
      case 'ArrowUp':
        e.preventDefault();
        player.setVolume(Math.min(1, player.audio.volume + 0.05));
        document.getElementById('volume').value = Math.round(player.audio.volume * 100);
        break;
      case 'ArrowDown':
        e.preventDefault();
        player.setVolume(Math.max(0, player.audio.volume - 0.05));
        document.getElementById('volume').value = Math.round(player.audio.volume * 100);
        break;
      case 'f':
      case 'F':
        npIsOpen() ? closeNowPlaying() : openNowPlaying();
        break;
      case 'm':
      case 'M':
        player.toggleMute();
        break;
      case 's':
      case 'S':
        document.getElementById('btnShuffle').click();
        break;
      case 'r':
      case 'R':
        document.getElementById('btnRepeat').click();
        break;
      case 'q':
      case 'Q':
        toggleQueue();
        break;
      case 'n':
        if (e.shiftKey) player.next(true);
        break;
      case 'p':
        if (e.shiftKey) player.prev();
        break;
      case 'Escape':
        if (npIsOpen()) closeNowPlaying();
        else toggleQueue(false);
        break;
      default:
        break;
    }
  });
}

/* ==========================================================================
   后台任务
   ========================================================================== */
function initJobs() {
  const btn = document.getElementById('btnJobs');
  if (!btn) return;

  const update = () => {
    const running = jobs.running;
    btn.hidden = running.length === 0;
    btn.title = running.length
      ? `${running[0].title} · ${running[0].percent}%`
      : '后台任务';
  };

  jobs.on(update);
  update();

  btn.addEventListener('click', () => {
    const list = jobs.jobs;
    if (!list.length) return toast('暂无后台任务');

    const rows = list.map((j) => `
      <div style="padding:10px 0;border-bottom:1px solid var(--outline-variant)">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
          <span style="font:var(--text-body);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(j.title)}</span>
          <span style="font:var(--text-caption);color:var(--on-surface-muted);flex:0 0 auto">
            ${j.status === 'running' ? `${j.percent}%` : jobStatusText(j.status)}
          </span>
        </div>
        <div class="linear-progress" style="margin-top:6px"><i style="width:${j.percent}%"></i></div>
        <div style="font:var(--text-caption);color:var(--on-surface-muted);margin-top:4px;min-height:15px">${esc(j.message || '')}</div>
      </div>`).join('');

    openDialog({
      title: '后台任务',
      bodyHTML: `<div style="max-height:52vh;overflow-y:auto;margin:0 -4px">${rows}</div>`,
      actions: [
        { label: '清除已完成', onClick: () => jobs.clearFinished() },
        { label: '关闭' },
      ],
    });
  });
}

function jobStatusText(s) {
  if (s === 'done') return '已完成';
  if (s === 'canceled') return '已取消';
  if (s === 'error') return '失败';
  return '进行中';
}

/* ==========================================================================
   系统返回键桥接
   ========================================================================== */
function computeCanBack() {
  if (document.querySelector('.qr-zoom')) return true;
  if (npIsOpen()) return true;
  if (document.querySelector('.scrim')) return true;
  const drawer = document.getElementById('queueDrawer');
  if (drawer && drawer.classList.contains('is-open')) return true;
  return hasRouteHistory();
}

function hasRouteHistory() {
  const h = location.hash || '';
  return h !== '' && h !== '#/discover' && h !== '#/';
}

function initBackBridge() {
  // Android 返回键会调用它，返回 true 表示「已消费」，false 交给系统退出
  window.__bmfmBack = function () {
    const zoom = document.querySelector('.qr-zoom');
    if (zoom) { zoom.remove(); return true; }
    if (npIsOpen()) { closeNowPlaying(); return true; }
    if (document.querySelector('.scrim')) { closeDialog(); return true; }
    const drawer = document.getElementById('queueDrawer');
    if (drawer && drawer.classList.contains('is-open')) { toggleQueue(false); return true; }
    if (hasRouteHistory()) { history.back(); return true; }
    return false;
  };

  let last = null;
  setInterval(() => {
    const can = computeCanBack();
    if (can === last) return;
    last = can;
    try { window.BMFMAndroid?.setCanGoBack?.(can); } catch { /* 非 APK 环境 */ }
  }, 400);
}

/* ==========================================================================
   自动播放被拦 → 任意手势续播
   ========================================================================== */
function initGestureResume() {
  let pending = false;

  document.addEventListener('pointerdown', () => {
    if (player._waitingGesture) pending = true;
  }, true);

  const settle = () => {
    if (!pending) return;
    pending = false;
    // 等一拍，让播放按钮自己的 toggle 先执行完
    setTimeout(() => {
      if (player._waitingGesture && player.state !== 'playing') {
        player._waitingGesture = false;
        player.resume();
      }
    }, 120);
  };

  document.addEventListener('click', settle, true);
  document.addEventListener('keydown', settle, true);
}

/* ==========================================================================
   通知栏播放控制
   ========================================================================== */
function initNotification() {
  if (!window.BMFMAndroid?.updatePlayback) return;

  let last = '';
  const push = () => {
    const t = player.current;
    if (!t) {
      try { window.BMFMAndroid.hidePlayback?.(); } catch { /* noop */ }
      return;
    }
    const cover = t.cover && !t.cover.startsWith('data:')
      ? `${location.origin}${coverOf(t)}`
      : '';

    const payload = JSON.stringify({
      title: t.name || '',
      artist: t.artist || '',
      album: t.album || '',
      cover,
      playing: player.isPlaying,
      duration: Math.round((player.audio.duration || 0) * 1000),
      position: Math.round((player.audio.currentTime || 0) * 1000),
    });
    if (payload === last) return;
    last = payload;
    try { window.BMFMAndroid.updatePlayback(payload); } catch { /* noop */ }
  };

  player.on('track', push);
  player.on('state', push);

  // 通知栏 / 锁屏 / 耳机线控发过来的命令
  window.__bmfmCommand = (action) => {
    try {
      if (action === 'play') player.resume();
      else if (action === 'pause') player.pause();
      else if (action === 'toggle') player.toggle();
      else if (action === 'next') player.next(true);
      else if (action === 'prev') player.prev();
    } catch { /* noop */ }
  };
}

/* ==========================================================================
   启动
   ========================================================================== */
function boot() {
  hydrateIcons(document);   // 先把静态 HTML 里的 data-icon 换成 SVG

  // APK 里 WebView 的原生桥可能晚于模块执行，这里补读一次历史数据
  try { store.tryRestoreFromNative(); } catch { /* noop */ }

  initTheme();              // 主题切换按钮要操作已存在的 svg
  renderRail();
  initTopbar();
  initPlaybar();
  initListInteraction();
  initLocalFiles();
  initHotkeys();
  initJobs();
  initBackBridge();
  initNotification();
  initGestureResume();

  window.addEventListener('hashchange', () => {
    document.dispatchEvent(new CustomEvent('route-change'));
    route();
  });

  // 内部链接接管（避免整页刷新）
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('#')) return;
    e.preventDefault();
    if (location.hash === href) {
      document.dispatchEvent(new CustomEvent('route-change'));
      route();
    } else {
      location.hash = href;
    }
  });

  // 图片加载失败统一兜底（封面挂了不要撑坏布局）
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG') t.classList.add('is-broken');
  }, true);

  if (!location.hash) location.hash = '#/discover';
  document.dispatchEvent(new CustomEvent('route-change'));
  route();

  // Service Worker（PWA 安装能力）
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* 静默 */ });
    });
  }

  // 首次提示
  if (!localStorage.getItem('bmfm:welcomed')) {
    localStorage.setItem('bmfm:welcomed', '1');
    setTimeout(() => {
      toastInfo('提示：按空格播放/暂停，按 F 打开全屏播放页');
    }, 1400);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

/* 调试入口（浏览器控制台可用） */
window.bmfm = {
  store, player, route, toast,
  openNowPlaying, closeNowPlaying,
  showArtistBio, downloadTrack,
};
