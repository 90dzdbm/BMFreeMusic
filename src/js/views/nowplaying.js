/**
 * views/nowplaying.js — 全屏正在播放
 *
 * 歌词两种形态：
 *   · 窗口模式（默认）：封面 + 信息 + 「上一行 / 当前行 / 下一行」三行歌词，当前行居中
 *   · 展开模式：点歌词隐藏封面，铺满整屏显示全部歌词，当前行高亮并自动居中滚动
 */

import { player } from '../core/player.js';
import { store, SOURCES } from '../core/store.js';
import { coverOf, placeholderCover } from '../ui/components.js';
import { esc, fmtTime } from '../core/util.js';
import { icon } from '../ui/icons.js';
import { showArtistBio } from '../ui/artistbio.js';
import { openMenu } from '../ui/components.js';
import { deskLyrics } from '../ui/desklyrics.js';
import { toast } from '../ui/toast.js';

let layer = null;
let offs = [];
let expanded = false;
let lastIdx = -2;

export function isOpen() {
  return !!layer;
}

export function isExpanded() {
  return expanded;
}

export function openNowPlaying() {
  if (layer) return;
  expanded = false;
  lastIdx = -2;

  layer = document.createElement('div');
  layer.className = 'nowplaying';
  layer.id = 'nowplaying';
  layer.innerHTML = `
    <div class="nowplaying__bg" id="npBg"></div>
    <div class="nowplaying__inner">
      <div class="nowplaying__bar">
        <button class="icon-btn" id="npClose" title="收起">${icon('collapse')}</button>
        <span class="nowplaying__label" id="npLabel">正在播放</span>
        <button class="icon-btn" id="npQueue" title="播放队列">${icon('queue')}</button>
        <button class="icon-btn" id="npMore" title="更多">${icon('more')}</button>
      </div>

      <div class="nowplaying__body">
        <div class="np-art" id="npArt">
          <img id="npCover" src="" alt="">
        </div>
        <div class="np-info">
          <h1 class="np-title" id="npTitle">未在播放</h1>
          <div class="np-artist" id="npArtist">选择一首歌开始</div>
          <div class="np-lyrics is-window" id="npLyrics" role="button" tabindex="0"
               title="点击切换到全屏歌词"></div>
        </div>
      </div>

      <div class="np-controls">
        <div class="progress">
          <span class="progress__time" id="npCur">0:00</span>
          <input class="slider" type="range" id="npSeek" min="0" max="1000" value="0">
          <span class="progress__time" id="npDur">0:00</span>
        </div>
        <div class="transport" style="justify-content:center">
          <button class="transport__btn" id="npShuffle" title="随机">${icon('shuffle', 'icon-sm')}</button>
          <button class="transport__btn" id="npPrev" title="上一首">${icon('prev')}</button>
          <button class="transport__btn transport__play" id="npPlay" title="播放/暂停">
            ${icon('play')}
          </button>
          <button class="transport__btn" id="npNext" title="下一首">${icon('next')}</button>
          <button class="transport__btn" id="npRepeat" title="循环">${icon('repeat', 'icon-sm')}</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(layer);
  applyNpStyle();
  bind();
  syncTrack(player.current);
  renderLyric(player.lyric);
  syncState(player.state);
  syncVolume();

  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKey);
}

export function closeNowPlaying() {
  if (!layer) return;
  layer.remove();
  layer = null;
  expanded = false;
  offs.forEach((fn) => fn());
  offs = [];
  document.body.style.overflow = '';
  document.removeEventListener('keydown', onKey);
}

function onKey(e) {
  if (e.key === 'Escape') {
    if (expanded) toggleLyrics();
    else closeNowPlaying();
  }
}

function bind() {
  const $ = (id) => layer.querySelector(id);

  $('#npClose').addEventListener('click', closeNowPlaying);
  $('#npMore').addEventListener('click', (e) => {
    e.stopPropagation();
    openMoreMenu($('#npMore'));
  });

  $('#npQueue').addEventListener('click', () => {
    document.getElementById('btnQueue')?.click();
  });
  $('#npPlay').addEventListener('click', () => player.toggle());
  $('#npPrev').addEventListener('click', () => player.prev());
  $('#npNext').addEventListener('click', () => player.next(true));
  $('#npShuffle').addEventListener('click', () => {
    const on = player.toggleShuffle();
    $('#npShuffle').classList.toggle('is-on', on);
  });
  $('#npRepeat').addEventListener('click', () => {
    const mode = player.cycleRepeat();
    $('#npRepeat').classList.toggle('is-on', mode !== 'off');
    toastMini($('#npRepeat'), mode === 'one' ? '单曲循环' : mode === 'all' ? '列表循环' : '不循环');
  });

  // 点歌词 → 展开 / 收起
  $('#npLyrics').addEventListener('click', toggleLyrics);
  $('#npLyrics').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleLyrics(); }
  });
  // 收起时点封面区域也能回来
  $('#npArt').addEventListener('click', () => {
    if (expanded) toggleLyrics();
  });

  const seek = $('#npSeek');
  seek.addEventListener('input', () => {
    const d = player.audio.duration || 0;
    if (!d) return;
    $('#npCur').textContent = fmtTime((seek.value / 1000) * d * 1000);
  });
  seek.addEventListener('change', () => {
    const d = player.audio.duration || 0;
    if (!d) return;
    player.seek((seek.value / 1000) * d * 1000);
  });

  offs.push(player.on('track', syncTrack));
  offs.push(player.on('state', syncState));
  offs.push(player.on('time', onTime));
  offs.push(player.on('lyric', () => renderLyric(player.lyric)));
  offs.push(player.on('volume', syncVolume));
}

/* ==========================================================================
   歌词：窗口 / 展开 两种形态
   ========================================================================== */
function toggleLyrics() {
  if (!layer) return;
  const lines = player.lyric?.lines || [];
  if (!lines.length) {
    toastMini(layer.querySelector('#npLabel'), '这首歌暂无歌词');
    return;
  }
  expanded = !expanded;
  layer.classList.toggle('is-lyrics-open', expanded);
  const box = layer.querySelector('#npLyrics');
  box.classList.toggle('is-window', !expanded);
  box.title = expanded ? '点击收起歌词' : '点击展开全部歌词';
  layer.querySelector('#npLabel').textContent = expanded ? '全部歌词' : '正在播放';

  lastIdx = -2;
  renderLyric(player.lyric);
  onTime({
    current: player.audio.currentTime * 1000,
    duration: (player.audio.duration || 0) * 1000,
  });
}

function renderLyric(lyr) {
  if (!layer) return;
  const box = layer.querySelector('#npLyrics');
  if (!box) return;
  const lines = lyr?.lines || [];

  if (!lines.length) {
    box.innerHTML = `<p class="lyric-plain np-lyric-empty">纯音乐，请欣赏</p>`;
    return;
  }

  if (expanded) {
    box.innerHTML = lines
      .map((l, i) => `<p class="np-lyric-line" data-i="${i}">${esc(l.text)}</p>`)
      .join('');
    // 立即定位到当前行，避免展开瞬间从第一行跳
    const idx = Math.max(0, player.currentLyricIndex());
    const cur = box.children[idx];
    if (cur) {
      cur.classList.add('is-active');
      box.scrollTop = cur.offsetTop - box.clientHeight * 0.45;
      lastIdx = idx;
    }
  } else {
    lastIdx = -2;
    paintWindow();
  }
}

/** 三行窗口：上一行 / 当前行 / 下一行，固定三个槽位避免高度跳动 */
function paintWindow() {
  if (!layer || expanded) return;
  const box = layer.querySelector('#npLyrics');
  const lines = player.lyric?.lines || [];
  if (!box || !lines.length) return;

  const idx = Math.max(0, player.currentLyricIndex());
  const cells = [-1, 0, 1].map((d) => {
    const i = idx + d;
    const text = (i >= 0 && i < lines.length) ? lines[i].text : '';
    const cls = d === 0 ? 'is-active' : '';
    return `<p class="np-lyric-line ${cls}">${text ? esc(text) : '&nbsp;'}</p>`;
  });
  box.innerHTML = cells.join('');
  lastIdx = idx;
}

function onTime({ current, duration }) {
  if (!layer) return;
  const seek = layer.querySelector('#npSeek');
  const d = duration || player.audio.duration * 1000 || 0;
  if (d > 0) {
    seek.style.setProperty('--val', `${(current / d) * 100}%`);
    if (!seek.matches(':active')) seek.value = String(Math.round((current / d) * 1000));
  }
  layer.querySelector('#npCur').textContent = fmtTime(current);
  layer.querySelector('#npDur').textContent = fmtTime(d);

  const lines = player.lyric?.lines || [];
  if (!lines.length) return;

  const idx = player.currentLyricIndex();

  if (expanded) {
    if (idx === lastIdx) return;
    const box = layer.querySelector('#npLyrics');
    const prev = box.querySelector('.np-lyric-line.is-active');
    prev?.classList.remove('is-active');
    const cur = box.children[idx];
    if (cur) {
      cur.classList.add('is-active');
      const top = cur.offsetTop - box.clientHeight * 0.45;
      box.scrollTo({ top, behavior: 'smooth' });
    }
    lastIdx = idx;
  } else if (idx !== lastIdx) {
    paintWindow();
  }
}

/* ==========================================================================
   曲目 / 状态同步
   ========================================================================== */
function syncTrack(track) {
  if (!layer || !track) return;
  const cover = coverOf(track);
  layer.querySelector('#npCover').src = cover;
  layer.querySelector('#npBg').style.backgroundImage = `url("${cover}")`;
  layer.querySelector('#npTitle').textContent = track.name;
  const artistEl = layer.querySelector('#npArtist');
  if (artistEl) {
    artistEl.textContent = `${track.artist}${track.album ? ' · ' + track.album : ''}`;
    artistEl.classList.add('is-link');
    artistEl.title = '查看歌手简介';
    artistEl.onclick = (e) => {
      e.stopPropagation();
      showArtistBio(track.artist);
    };
  }
  document.title = `${track.name} - ${track.artist} · BM Free Music`;
}

function syncState(state) {
  if (!layer) return;
  const btn = layer.querySelector('#npPlay');
  const path = btn?.querySelector('path');
  if (path) path.setAttribute('d', state === 'playing'
    ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z'
    : 'M8 5v14l11-7z');
  const art = layer.querySelector('#npArt');
  art.style.transform = state === 'playing' ? 'scale(1)' : 'scale(.94)';
  art.style.transition = 'transform 420ms cubic-bezier(.2,0,0,1)';
}

function syncVolume() {
  if (!layer) return;
  layer.querySelector('#npShuffle').classList.toggle('is-on', !!store.settings.shuffle);
  const mode = store.settings.repeat || 'off';
  layer.querySelector('#npRepeat').classList.toggle('is-on', mode !== 'off');
}

function toastMini(anchor, text) {
  if (!anchor) return;
  const tip = document.createElement('div');
  tip.textContent = text;
  tip.style.cssText = `position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);
    background:var(--surface-inverse);color:var(--on-surface-inverse);font-size:12px;
    padding:6px 12px;border-radius:999px;white-space:nowrap;pointer-events:none;z-index:10`;
  if (getComputedStyle(anchor).position === 'static') anchor.style.position = 'relative';
  anchor.appendChild(tip);
  setTimeout(() => tip.remove(), 1400);
}


/* ==========================================================================
   更多菜单：播放器样式 / 桌面歌词 / 字号
   ========================================================================== */
function openMoreMenu(anchor) {
  const s = store.settings;
  const style = s.npStyle || 'blur';

  openMenu(anchor, [
    {
      icon: 'palette',
      label: `播放器样式：${style === 'blur' ? '模糊' : style === 'gradient' ? '渐变' : '纯色'}`,
      onClick: () => setNpStyle(style === 'blur' ? 'gradient' : style === 'gradient' ? 'plain' : 'blur'),
    },
    {
      icon: 'font',
      label: `歌词字号：${Number(s.npFontSize) || 16} px`,
      onClick: () => setNpFontSize((Number(s.npFontSize) || 16) >= 28 ? 12 : (Number(s.npFontSize) || 16) + 2),
    },
    { separator: true },
    {
      icon: 'lyrics',
      label: s.deskLyrics ? '关闭桌面歌词' : '开启桌面歌词',
      onClick: () => toggleDeskLyrics(),
    },
    {
      icon: 'settings',
      label: '打开外观设置',
      onClick: () => { location.hash = '#/settings/appearance'; },
    },
  ], { align: 'end' });
}

function setNpStyle(style) {
  store.setSettings({ npStyle: style });
  applyNpStyle();
  toast( `播放器样式：${style === 'blur' ? '模糊' : style === 'gradient' ? '渐变' : '纯色'}`);
}

function setNpFontSize(size) {
  const v = Math.min(28, Math.max(12, size));
  store.setSettings({ npFontSize: v });
  applyNpStyle();
  toast( `歌词字号：${v} px`);
}

function applyNpStyle() {
  const s = store.settings;
  layer?.setAttribute('data-np-style', s.npStyle || 'blur');
  layer?.style.setProperty('--np-font-size', `${Number(s.npFontSize) || 16}px`);
}

function toggleDeskLyrics() {
  const on = !store.settings.deskLyrics;
  if (on) {
    const ok = deskLyrics.enable();
    if (!ok) {
      toast( '需要悬浮窗权限');
      return;
    }
    store.setSettings({ deskLyrics: true });
    toast( '桌面歌词已开启');
  } else {
    deskLyrics.disable();
    store.setSettings({ deskLyrics: false });
    toast( '桌面歌词已关闭');
  }
}
