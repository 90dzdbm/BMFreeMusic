/**
 * views/playlist.js — 歌单详情（在线歌单 / 本地歌单 / 我喜欢的）
 */

import { store, SOURCES } from '../core/store.js';
import { getPlaylist, probePlayable } from '../api/sources.js';
import { imgUrl } from '../api/gateway.js';
import { isFailed, markFailed, clearFailed } from '../core/playfail.js';
import { jobs } from '../core/jobs.js';
import {
  tracklistHTML, skeletonTracks, emptyState, coverOf, placeholderCover,
  openMenu, confirmDialog, promptDialog,
} from '../ui/components.js';
import { esc, download, uid, pMap } from '../core/util.js';
import { icon } from '../ui/icons.js';
import { player } from '../core/player.js';
import { toast, toastSuccess, toastError } from '../ui/toast.js';

export async function render(root, params = {}) {
  if (params.local) return renderLocal(root, params.local);
  if (params.source && params.id) return renderOnline(root, params.source, params.id);
  if (params.liked) return renderLiked(root);
}

/* ==========================================================================
   在线歌单
   ========================================================================== */
async function renderOnline(root, source, id) {
  const srcInfo = SOURCES[source] || { name: source, short: source };

  root.innerHTML = `
    <div class="view">
      <div class="pl-head">
        <div class="pl-head__art skeleton" style="border-radius:20px"></div>
        <div class="pl-head__info">
          <div class="skeleton" style="height:12px;width:80px;border-radius:6px"></div>
          <div class="skeleton" style="height:34px;width:60%;border-radius:8px;margin-top:8px"></div>
          <div class="skeleton" style="height:14px;width:40%;border-radius:6px;margin-top:8px"></div>
        </div>
      </div>
      <div class="tracklist">${skeletonTracks(8)}</div>
    </div>`;

  let pl;
  try {
    pl = await getPlaylist(source, id);
  } catch (e) {
    root.innerHTML = `
      <div class="view">
        <div class="view-head">
          <div class="view-head__text">
            <h1>歌单加载失败</h1>
            <p>${esc(e.message)}</p>
          </div>
        </div>
        ${emptyState({
          iconName: 'wifi_off',
          title: '拿不到这个歌单',
          desc: '可能是歌单已删除、需要登录，或当前音源暂时不可用。可以试着在「平台账号」里绑定该平台后重试。',
        })}
        <div style="display:flex;gap:8px;justify-content:center">
          <button class="btn btn--outline" onclick="location.hash='#/accounts'">去绑定账号</button>
          <button class="btn btn--text" onclick="history.back()">返回</button>
        </div>
      </div>`;
    return;
  }

  const cover = pl.cover ? imgUrl(pl.cover) : placeholderCover();

  root.innerHTML = `
    <div class="view">
      <div class="pl-head">
        <div class="pl-head__art"><img src="${esc(cover)}" alt=""></div>
        <div class="pl-head__info">
          <div class="pl-head__kind">${esc(srcInfo.name)} · 歌单</div>
          <h1 class="pl-head__title">${esc(pl.name)}</h1>
          <div class="pl-head__meta">
            ${pl.creator ? `<span>${icon('person', 'icon-xs')} ${esc(pl.creator)}</span>` : ''}
            <span>${pl.trackCount || pl.tracks.length} 首</span>
            ${pl.desc ? `<span class="truncate" style="max-width:46ch">${esc(pl.desc)}</span>` : ''}
          </div>
          <div class="pl-head__actions">
            <button class="btn btn--filled" id="playAll">${icon('play')} 播放全部</button>
            <button class="btn btn--outline" id="importToMine">${icon('download')} 收藏到我的歌单</button>
            <button class="btn btn--text" id="exportJson">${icon('upload')} 导出</button>
          </div>
        </div>
      </div>
      <div class="tracklist" id="tracks">${tracklistHTML(pl.tracks, { showAlbum: true })}</div>
    </div>`;

  root.querySelector('#playAll')?.addEventListener('click', () => {
    if (!pl.tracks.length) return toast('这个歌单是空的');
    player.playList(pl.tracks, 0);
  });

  root.querySelector('#importToMine')?.addEventListener('click', async () => {
    const choice = await openMenuChoice(root.querySelector('#importToMine'), pl);
    if (!choice) return;
    if (choice.create) {
      const created = store.createPlaylist(pl.name);
      store.addTracksToPlaylist(created.id, pl.tracks);
      toastSuccess(`已保存为「${created.name}」（${pl.tracks.length} 首）`);
    } else {
      const added = store.addTracksToPlaylist(choice.id, pl.tracks);
      toastSuccess(`已加入歌单，新增 ${added} 首`);
    }
  });

  root.querySelector('#exportJson')?.addEventListener('click', () => {
    download(`${pl.name.replace(/[\\/:*?"<>|]/g, '_')}.json`, JSON.stringify({
      name: pl.name, desc: pl.desc, source, id, tracks: pl.tracks,
    }, null, 2));
    toastSuccess('已导出歌单 JSON');
  });
}

function openMenuChoice(anchor, pl) {
  return new Promise((resolve) => {
    const items = [
      { label: `新建歌单「${pl.name.slice(0, 12)}…」`, icon: 'add', onClick: () => resolve({ create: true }) },
      { separator: true },
      ...store.state.playlists.map((p) => ({
        label: p.name,
        icon: 'library',
        onClick: () => resolve({ id: p.id }),
      })),
    ];
    if (!store.state.playlists.length) {
      items.push({ label: '暂无已有歌单', icon: 'info', onClick: () => resolve(null) });
    }
    openMenu(anchor, items, { onClose: () => resolve(null) });
  });
}

/* ==========================================================================
   本地歌单
   ========================================================================== */
function renderLocal(root, id) {
  const pl = store.getPlaylist(id);
  if (!pl) {
    root.innerHTML = `<div class="view">${emptyState({ iconName: 'library', title: '歌单不存在', desc: '它可能已被删除' })}</div>`;
    return;
  }

  const cover = pl.cover ? coverOf({ cover: pl.cover }) : placeholderCover();
  const totalMs = pl.tracks.reduce((a, t) => a + (t.duration || 0), 0);
  const mins = Math.round(totalMs / 60000);
  const unplayable = pl.tracks.filter((t) => isFailed(t)).length;

  root.innerHTML = `
    <div class="view">
      <div class="pl-head">
        <div class="pl-head__art"><img src="${esc(cover)}" alt=""></div>
        <div class="pl-head__info">
          <div class="pl-head__kind">我的歌单</div>
          <h1 class="pl-head__title">${esc(pl.name)}</h1>
          <div class="pl-head__meta">
            <span>${pl.tracks.length} 首</span>
            ${mins ? `<span>约 ${mins} 分钟</span>` : ''}
            <span>创建于 ${new Date(pl.createdAt).toLocaleDateString('zh-CN')}</span>
          </div>
          ${pl.desc ? `<p style="color:var(--on-surface-muted);font-size:14px">${esc(pl.desc)}</p>` : ''}
          <div class="pl-head__actions">
            <button class="btn btn--filled" id="playAll">${icon('play')} 播放全部</button>
            <button class="btn btn--outline" id="checkHealth">${icon('check_circle')} 检查可用性</button>
            <button class="btn btn--text" id="addFiles">${icon('upload')} 添加本地文件</button>
            <button class="btn btn--text" id="renamePl">${icon('settings')} 重命名</button>
            <button class="btn btn--text" id="deletePl" style="color:var(--error)">${icon('trash')} 删除</button>
          </div>
        </div>
      </div>

      ${unplayable ? `
        <div class="health-banner">
          <span>${icon('error', 'icon-sm')} 有 ${unplayable} 首标记为不可播放</span>
          <button class="btn btn--text btn--sm" id="purgeBad">一键移除</button>
        </div>` : ''}

      ${pl.tracks.length
        ? `<div class="tracklist" id="tracks">${tracklistHTML(pl.tracks, { showAlbum: true })}</div>`
        : emptyState({
          iconName: 'music',
          title: '歌单还是空的',
          desc: '去搜索页面找几首歌，或者从其它平台一键迁移过来',
        })}
    </div>`;

  root.querySelector('#playAll')?.addEventListener('click', () => {
    if (!pl.tracks.length) return toast('歌单是空的');
    player.playList(pl.tracks, 0);
  });

  root.querySelector('#checkHealth')?.addEventListener('click', () => {
    startHealthCheck(root, pl);
  });

  root.querySelector('#purgeBad')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: `移除 ${unplayable} 首不可播放的曲目？`,
      desc: '只是从这个歌单里去掉，不影响你的喜欢列表和其它歌单。',
      okLabel: '移除',
      danger: true,
    });
    if (!ok) return;
    const before = pl.tracks.length;
    pl.tracks = pl.tracks.filter((t) => !isFailed(t));
    store.save();
    toastSuccess(`已移除 ${before - pl.tracks.length} 首`);
    renderLocal(root, id);
  });

  root.querySelector('#renamePl')?.addEventListener('click', async () => {
    const name = await promptDialog({ title: '重命名歌单', value: pl.name, okLabel: '保存' });
    if (!name) return;
    store.updatePlaylist(id, { name });
    renderLocal(root, id);
  });

  root.querySelector('#deletePl')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: `删除「${pl.name}」？`,
      desc: '这个操作不可撤销，歌单内的曲目不会从你的喜欢列表中移除。',
      okLabel: '删除',
      danger: true,
    });
    if (!ok) return;
    store.deletePlaylist(id);
    toastSuccess('歌单已删除');
    location.hash = '#/library?tab=playlists';
  });

  root.querySelector('#addFiles')?.addEventListener('click', () => {
    window.__bmfmAddFilesTo = id;
    document.getElementById('localFileInput')?.click();
  });
}

/* ==========================================================================
   我喜欢的音乐
   ========================================================================== */
function renderLiked(root) {
  const liked = store.state.liked;
  root.innerHTML = `
    <div class="view">
      <div class="pl-head">
        <div class="pl-head__art" style="display:grid;place-items:center;background:linear-gradient(135deg,var(--primary-container),var(--secondary-container))">
          ${icon('heart_filled', 'icon-lg')}
        </div>
        <div class="pl-head__info">
          <div class="pl-head__kind">自动歌单</div>
          <h1 class="pl-head__title">我喜欢的音乐</h1>
          <div class="pl-head__meta"><span>${liked.length} 首</span></div>
          <div class="pl-head__actions">
            <button class="btn btn--filled" id="playAll">${icon('play')} 播放全部</button>
            <button class="btn btn--outline" id="exportLiked">${icon('download')} 导出</button>
          </div>
        </div>
      </div>
      ${liked.length
        ? `<div class="tracklist">${tracklistHTML(liked, { showAlbum: true })}</div>`
        : emptyState({ iconName: 'heart', title: '还没有喜欢的歌', desc: '点曲目右侧的爱心即可收藏' })}
    </div>`;

  root.querySelector('#playAll')?.addEventListener('click', () => {
    if (!liked.length) return toast('还没有喜欢的歌');
    player.playList(liked, 0);
  });

  root.querySelector('#exportLiked')?.addEventListener('click', () => {
    download('我喜欢的音乐.json', JSON.stringify({ name: '我喜欢的音乐', tracks: liked }, null, 2));
    toastSuccess('已导出');
  });
}

/* ==========================================================================
   歌单体检（后台任务）
   ========================================================================== */
function startHealthCheck(root, pl) {
  const running = jobs.jobs.find((j) => j.type === 'check' && j.status === 'running');
  if (running) {
    toast(`${running.title} 还在跑，稍等一下`);
    return;
  }
  if (!pl.tracks.length) return toast('歌单是空的');

  const job = jobs.create('check', `体检「${pl.name}」`, pl.tracks.length);
  job.log(`开始检查 ${pl.tracks.length} 首曲目的播放可用性`);
  toastSuccess('体检已在后台开始，顶栏可以看进度');

  runHealthCheck(job, pl, () => {
    if (location.hash.startsWith('#/local/')) {
      renderLocal(root, pl.id);
    }
  }).catch((e) => job.fail(e));
}

async function runHealthCheck(job, pl, onDone) {
  let good = 0;
  let bad = 0;

  await pMap(pl.tracks, async (track) => {
    if (job.canceled) return;
    const r = await probePlayable(track);
    if (r.ok) {
      clearFailed(track);
      good++;
    } else {
      markFailed(track, r.reason);
      bad++;
      job.log(`✘ ${track.name} — ${r.reason}`, 'warn');
    }
    job.step(`${good} 可播 / ${bad} 不可播`);
  }, 3);

  job.log(`检查完毕：${good} 可播，${bad} 不可播`);
  job.finish({ total: pl.tracks.length, good, bad });
  toast(`体检完成：${good} 可播，${bad} 不可播`);
  try { onDone?.(); } catch { /* 页面可能已切走 */ }
}
