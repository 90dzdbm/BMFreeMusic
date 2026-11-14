/**
 * components.js — 通用 UI 构件（返回 HTML 片段 + 交互帮助函数）
 */

import { icon } from './icons.js';
import { esc, fmtDuration } from '../core/util.js';
import { store, SOURCES } from '../core/store.js';
import { imgUrl } from '../api/gateway.js';
import { failInfo } from '../core/playfail.js';

/* --------------------------------------------------------------------------
   列表注册表：把渲染出的曲目数组按 listId 存放，供事件委托取用
   -------------------------------------------------------------------------- */
export const lists = new Map();
let listSeq = 0;

export function registerList(tracks) {
  const id = `L${++listSeq}`;
  lists.set(id, tracks);
  if (lists.size > 60) {
    // 简单回收最旧的
    const firstKey = lists.keys().next().value;
    if (firstKey !== id) lists.delete(firstKey);
  }
  return id;
}

export function getList(id) {
  return lists.get(id) || [];
}

/* --------------------------------------------------------------------------
   封面
   -------------------------------------------------------------------------- */
export function coverOf(track, size = 120) {
  if (!track) return placeholderCover();
  if (!track.cover) return placeholderCover();
  if (track.cover.startsWith('data:') || track.cover.startsWith('blob:')) return track.cover;
  return imgUrl(track.cover);
}

const PLACEHOLDER = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
     <rect width="100" height="100" fill="#d8dde6"/>
     <path d="M44 26v32.6A9.5 9.5 0 1 0 50 67V38h14V26H44z" fill="#8f96a3"/>
   </svg>`,
)}`;

export function placeholderCover() {
  return PLACEHOLDER;
}

/* --------------------------------------------------------------------------
   曲目行
   -------------------------------------------------------------------------- */
export function trackRowHTML(track, {
  index = 0,
  listId = '',
  active = false,
  liked = false,
  showAlbum = true,
  showSource = true,
  showCover = true,
  actions = true,
} = {}) {
  const src = SOURCES[track.source] || { short: track.source };
  const fail = failInfo(track);

  return `
  <div class="track ${active ? 'is-current' : ''} ${fail ? 'is-unplayable' : ''}"
       data-index="${index}" data-list="${esc(listId)}" data-key="${esc(track.key)}"
       style="--i:${Math.min(index, 12)}" role="row" tabindex="0">
    <div class="track__index">
      ${active ? '<span class="eq"><i></i><i></i><i></i></span>' : String(index + 1).padStart(2, '0')}
    </div>
    <div class="track__main">
      ${showCover ? `<img class="track__cover" loading="lazy" src="${esc(coverOf(track))}" alt=""
             onerror="this.classList.add('is-broken')">` : ''}
      <div class="track__text">
        <div class="track__title">
          <span class="track__name">${esc(track.name)}</span>
          ${showSource ? `<span class="source-tag" data-src="${esc(track.source)}">${esc(src.short)}</span>` : ''}
          ${fail ? `<span class="track__warn" title="${esc(fail.reason)}">${icon('error', 'icon-xs')}无法播放</span>` : ''}
        </div>
        <div class="track__artist">${esc(track.artist)}${showAlbum && track.album ? `<span class="track__album-inline"> · ${esc(track.album)}</span>` : ''}</div>
      </div>
    </div>
    <div class="track__album">${showAlbum ? esc(track.album || '—') : ''}</div>
    <div class="track__dur">${track.duration ? fmtDuration(track.duration) : '--:--'}</div>
    <div class="track__actions">
      <button class="icon-btn icon-btn--sm" data-act="like" title="${liked ? '取消喜欢' : '喜欢'}"
              style="${liked ? 'color:var(--google-red-500)' : ''}">
        ${icon(liked ? 'heart_filled' : 'heart', 'icon-sm')}
      </button>
      <button class="icon-btn icon-btn--sm" data-act="queue-add" title="加入播放队列">
        ${icon('queue', 'icon-sm')}
      </button>
      <button class="icon-btn icon-btn--sm" data-act="more" title="更多">
        ${icon('more', 'icon-sm')}
      </button>
    </div>
  </div>`;
}

export function tracklistHTML(tracks, opts = {}) {
  const listId = registerList(tracks);
  const head = `
    <div class="tracklist__head">
      <span style="text-align:center">#</span>
      <span>标题</span>
      <span>专辑</span>
      <span style="text-align:right">时长</span>
      <span></span>
    </div>`;
  const rows = tracks.map((t, i) => trackRowHTML(t, {
    ...opts,
    index: i,
    listId,
    active: opts.activeKey === t.key,
    liked: store.isLiked(t),
  })).join('');
  return `${head}${rows}`;
}

/* --------------------------------------------------------------------------
   磁贴
   -------------------------------------------------------------------------- */
export function tileHTML({ href = '#', cover = '', title = '', sub = '', source = '', playable = true, index = 0 }) {
  return `
  <a class="tile" href="${esc(href)}" data-link style="--i:${Math.min(index, 10)}">
    <div class="tile__art">
      <img loading="lazy" src="${esc(cover || PLACEHOLDER)}" alt="">
      ${playable ? `<button class="tile__play" data-act="tile-play" title="立即播放">${icon('play', 'icon-sm')}</button>` : ''}
    </div>
    <div class="tile__body">
      <div class="tile__title">${esc(title)}</div>
      <div class="tile__sub">${sub ? esc(sub) : (source ? esc(SOURCES[source]?.short || source) : '')}</div>
    </div>
  </a>`;
}

/* --------------------------------------------------------------------------
   骨架
   -------------------------------------------------------------------------- */
export function skeletonTiles(n = 6) {
  return Array.from({ length: n }, () => `
    <div class="tile">
      <div class="tile__art skeleton"></div>
      <div class="tile__body">
        <div class="skeleton" style="height:14px;width:80%;border-radius:6px"></div>
        <div class="skeleton" style="height:11px;width:50%;margin-top:8px;border-radius:6px"></div>
      </div>
    </div>`).join('');
}

export function skeletonTracks(n = 8) {
  return Array.from({ length: n }, () => `
    <div class="track" style="pointer-events:none">
      <div class="track__index"><span class="skeleton" style="width:14px;height:12px;display:block"></span></div>
      <div class="track__main">
        <div class="skeleton" style="width:40px;height:40px;border-radius:8px"></div>
        <div style="flex:1">
          <div class="skeleton" style="height:13px;width:60%;border-radius:6px"></div>
          <div class="skeleton" style="height:11px;width:35%;margin-top:7px;border-radius:6px"></div>
        </div>
      </div>
      <div class="skeleton" style="height:11px;width:70%"></div>
      <div></div>
      <div></div>
    </div>`).join('');
}

export function emptyState({ iconName = 'music', title = '这里空空如也', desc = '' } = {}) {
  return `<div class="empty">
    ${icon(iconName, 'icon-lg')}
    <h3>${esc(title)}</h3>
    ${desc ? `<p>${esc(desc)}</p>` : ''}
  </div>`;
}

/* --------------------------------------------------------------------------
   对话框
   -------------------------------------------------------------------------- */
let activeDialog = null;

export function openDialog({ title, desc = '', bodyHTML = '', actions = [], width = null, onMount = null }) {
  closeDialog();
  const host = document.getElementById('modalHost');
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = `
    <div class="dialog" role="dialog" aria-modal="true" ${width ? `style="width:${width}"` : ''}>
      ${title ? `<h2 class="dialog__title">${esc(title)}</h2>` : ''}
      ${desc ? `<p class="dialog__desc">${esc(desc)}</p>` : ''}
      <div class="dialog__body">${bodyHTML}</div>
      <div class="dialog__actions"></div>
    </div>`;

  const actionsEl = scrim.querySelector('.dialog__actions');
  actions.forEach((a) => {
    const btn = document.createElement('button');
    btn.className = `btn ${a.primary ? 'btn--filled' : 'btn--text'}`;
    btn.textContent = a.label;
    btn.addEventListener('click', async () => {
      if (a.onClick) {
        const r = await a.onClick({ dialog: scrim, close: closeDialog, button: btn });
        if (r === false) return;
      }
      if (a.keepOpen !== true) closeDialog();
    });
    actionsEl.appendChild(btn);
  });

  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) closeDialog();
  });

  host.appendChild(scrim);
  activeDialog = scrim;

  const onKey = (e) => {
    if (e.key === 'Escape') {
      closeDialog();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
  scrim._onKey = onKey;

  if (onMount) onMount(scrim);
  const firstInput = scrim.querySelector('input, textarea, select');
  setTimeout(() => firstInput?.focus(), 60);

  return { el: scrim, close: closeDialog };
}

export function closeDialog() {
  if (!activeDialog) return;
  const el = activeDialog;
  activeDialog = null;
  if (el._onKey) document.removeEventListener('keydown', el._onKey);
  el.style.opacity = '0';
  el.style.transition = 'opacity 140ms';
  setTimeout(() => el.remove(), 150);
}

export function confirmDialog({ title, desc = '', okLabel = '确定', danger = false }) {
  return new Promise((resolve) => {
    openDialog({
      title,
      desc,
      actions: [
        { label: '取消', onClick: () => resolve(false) },
        {
          label: okLabel,
          primary: !danger,
          onClick: () => resolve(true),
        },
      ],
    });
  });
}

export function promptDialog({ title, desc = '', value = '', placeholder = '', okLabel = '确定', multiline = false }) {
  return new Promise((resolve) => {
    const field = multiline
      ? `<textarea class="input" id="dlgInput" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input class="input" id="dlgInput" value="${esc(value)}" placeholder="${esc(placeholder)}">`;
    openDialog({
      title,
      desc,
      bodyHTML: field,
      actions: [
        { label: '取消', onClick: () => resolve(null) },
        {
          label: okLabel,
          primary: true,
          onClick: ({ dialog }) => {
            const v = dialog.querySelector('#dlgInput')?.value?.trim();
            resolve(v || null);
          },
        },
      ],
      onMount: (dialog) => {
        const input = dialog.querySelector('#dlgInput');
        input?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !multiline) {
            e.preventDefault();
            const v = input.value.trim();
            resolve(v || null);
            closeDialog();
          }
        });
      },
    });
  });
}

/* --------------------------------------------------------------------------
   下拉菜单
   -------------------------------------------------------------------------- */
let activeMenu = null;

export function openMenu(anchorEl, items, { align = 'end', onClose = null } = {}) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu._onClose = onClose;
  items.forEach((item) => {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'menu__sep';
      menu.appendChild(sep);
      return;
    }
    const btn = document.createElement('button');
    btn.className = 'menu__item';
    btn.innerHTML = `${item.icon ? icon(item.icon, 'icon-sm') : ''}<span>${esc(item.label)}</span>`;
    btn.addEventListener('click', () => {
      menu._onClose = null; // 主动选择时不触发 onClose，避免抢先 resolve
      closeMenu();
      item.onClick?.();
    });
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  const rect = anchorEl.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = align === 'end' ? rect.right - mw : rect.left;
  let top = rect.bottom + 6;
  left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
  if (top + mh > window.innerHeight - 8) top = Math.max(8, rect.top - mh - 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  activeMenu = menu;

  const onDocClick = (e) => {
    if (!menu.contains(e.target) && e.target !== anchorEl) closeMenu();
  };
  setTimeout(() => document.addEventListener('click', onDocClick), 0);
  menu._onDocClick = onDocClick;
  return menu;
}

export function closeMenu() {
  if (!activeMenu) return;
  const { _onDocClick, _onClose } = activeMenu;
  document.removeEventListener('click', _onDocClick);
  activeMenu.remove();
  activeMenu = null;
  try { _onClose?.(); } catch { /* noop */ }
}

/* --------------------------------------------------------------------------
   其它
   -------------------------------------------------------------------------- */
export function sourceChips(activeSources, onToggle) {
  return `<div class="chip-row">
    ${Object.entries(SOURCES).filter(([k]) => k !== 'local').map(([k, v]) => `
      <button class="chip ${activeSources.includes(k) ? 'is-active' : ''}" data-source-chip="${k}">
        ${esc(v.short)}
      </button>`).join('')}
  </div>`;
}

export function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}
