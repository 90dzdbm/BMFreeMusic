/**
 * views/library.js — 我的音乐
 */

import { store } from '../core/store.js';
import {
  tracklistHTML, emptyState, openDialog, promptDialog, confirmDialog,
  coverOf, placeholderCover, relativeTime, openMenu,
} from '../ui/components.js';
import { esc } from '../core/util.js';
import { icon } from '../ui/icons.js';
import { player } from '../core/player.js';
import { toast, toastSuccess } from '../ui/toast.js';

export async function render(root, params = {}) {
  const tab = ['liked', 'playlists', 'recent'].includes(params.tab) ? params.tab : 'liked';
  const s = store.state;

  root.innerHTML = `
    <div class="view">
      <div class="view-head">
        <div class="view-head__text">
          <h1>我的音乐</h1>
          <p>喜欢 ${s.liked.length} 首 · ${s.playlists.length} 个歌单 · 累计播放 ${s.stats.plays || 0} 次</p>
        </div>
        <div class="view-head__actions">
          <button class="btn btn--tonal" id="newPlaylist">${icon('add')} 新建歌单</button>
          <a class="btn btn--text" href="#/transfer" data-link>${icon('transfer')} 导入外部歌单</a>
        </div>
      </div>

      <div class="search-tabs">
        <button class="chip ${tab === 'liked' ? 'is-active' : ''}" data-tab="liked">
          ${icon('heart', 'icon-xs')} 我喜欢的音乐
        </button>
        <button class="chip ${tab === 'playlists' ? 'is-active' : ''}" data-tab="playlists">
          ${icon('library', 'icon-xs')} 我的歌单
        </button>
        <button class="chip ${tab === 'recent' ? 'is-active' : ''}" data-tab="recent">
          ${icon('history', 'icon-xs')} 最近播放
        </button>
      </div>

      <div id="libBody"></div>
    </div>`;

  root.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      location.hash = `#/library?tab=${btn.dataset.tab}`;
    });
  });

  const body = root.querySelector('#libBody');

  if (tab === 'liked') {
    body.innerHTML = s.liked.length
      ? `<div class="tracklist">${tracklistHTML(s.liked, { showAlbum: true })}</div>`
      : emptyState({
        iconName: 'heart',
        title: '还没有喜欢的歌',
        desc: '在任意曲目右侧点一下爱心，它就会出现在这里',
      });
  }

  if (tab === 'playlists') {
    if (!s.playlists.length) {
      body.innerHTML = emptyState({
        iconName: 'library',
        title: '还没有创建歌单',
        desc: '点右上角「新建歌单」，或者从其它平台一键迁移过来',
      });
    } else {
      body.innerHTML = `<div class="tile-grid">
        ${s.playlists.map((pl) => `
          <div class="tile" data-pl-id="${esc(pl.id)}" style="cursor:pointer">
            <div class="tile__art">
              <img loading="lazy" src="${esc(pl.cover ? coverOf({ cover: pl.cover }) : placeholderCover())}" alt="">
              <button class="tile__play" data-act="pl-play" data-pl="${esc(pl.id)}" title="播放歌单">
                ${icon('play', 'icon-sm')}
              </button>
            </div>
            <div class="tile__body">
              <div class="tile__title">${esc(pl.name)}</div>
              <div class="tile__sub">${pl.tracks.length} 首 · ${esc(relativeTime(pl.createdAt))}</div>
            </div>
          </div>`).join('')}
      </div>`;
    }
  }

  if (tab === 'recent') {
    body.innerHTML = s.recent.length
      ? `<div class="tracklist">${tracklistHTML(s.recent, { showAlbum: true })}</div>`
      : emptyState({ iconName: 'history', title: '暂无播放记录', desc: '播放过的歌曲会自动记录在这里' });
  }

  /* ---------- 事件 ---------- */
  root.querySelector('#newPlaylist')?.addEventListener('click', async () => {
    const name = await promptDialog({
      title: '新建歌单',
      desc: '给它起个名字',
      placeholder: '例如：通勤路上',
      okLabel: '创建',
    });
    if (!name) return;
    const pl = store.createPlaylist(name);
    toastSuccess(`已创建歌单「${pl.name}」`);
    location.hash = `#/local/${pl.id}`;
  });

  body.addEventListener('click', async (e) => {
    const playBtn = e.target.closest('[data-act="pl-play"]');
    if (playBtn) {
      e.preventDefault();
      e.stopPropagation();
      const pl = store.getPlaylist(playBtn.dataset.pl);
      if (!pl || !pl.tracks.length) return toast('歌单是空的');
      await player.playList(pl.tracks, 0);
      return;
    }
    const tile = e.target.closest('[data-pl-id]');
    if (tile) {
      location.hash = `#/local/${tile.dataset.plId}`;
    }
  });
}
