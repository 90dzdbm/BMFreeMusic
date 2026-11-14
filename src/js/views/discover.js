/**
 * views/discover.js — 发现页
 */

import { store, SOURCES } from '../core/store.js';
import { getPlaylist, searchAll } from '../api/sources.js';
import { imgUrl } from '../api/gateway.js';
import {
  tileHTML, skeletonTiles, skeletonTracks, tracklistHTML, emptyState,
  coverOf, placeholderCover,
} from '../ui/components.js';
import { esc } from '../core/util.js';
import { icon } from '../ui/icons.js';
import { player } from '../core/player.js';
import { toastError } from '../ui/toast.js';

const CHARTS = [
  { id: '19723756', name: '飙升榜', desc: '此刻涨幅最快' },
  { id: '3778678', name: '热歌榜', desc: '全民都在听' },
  { id: '3779629', name: '新歌榜', desc: '本周新发行' },
  { id: '2884035', name: '原创榜', desc: '独立音乐人' },
];

export async function render(root) {
  const s = store.state;
  const hour = new Date().getHours();
  const greeting = hour < 5 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  const enabledCount = (s.settings.enabledSources || []).length;

  root.innerHTML = `
    <div class="view">
      <section class="hero">
        <span class="hero__eyebrow">${icon('verified', 'icon-xs')} ${enabledCount} 个音源已接入</span>
        <h1>${greeting}，想听点什么？</h1>
        <p>九个音源，一次搜完</p>
        <div class="hero__actions">
          <button class="btn btn--filled" id="heroPlayRandom">
            ${icon('play')} 随便听听
          </button>
          <a class="btn btn--outline" href="#/transfer" data-link>
            ${icon('transfer')} 歌单一键迁移
          </a>
          <a class="btn btn--text" href="#/accounts" data-link>
            ${icon('account')} 绑定平台账号
          </a>
        </div>
        <img class="hero__deco" src="./assets/icon-512.png" alt="">
      </section>

      <section class="sponsor-entry">
        <div class="sponsor-entry__icon">${icon('heart_filled', 'icon-sm')}</div>
        <div class="sponsor-entry__text">
          <div class="sponsor-entry__title">用得顺手，就打赏一下</div>
          <div class="sponsor-entry__desc">没有广告、没有会员，所有功能都是免费的</div>
        </div>
        <a class="btn btn--tonal" href="#/sponsor" data-link>${icon('heart', 'icon-sm')} 赞助支持</a>
      </section>

      <section class="section" id="secRecent">
        <div class="section__head">
          <h2 class="section__title">${icon('history', 'icon-sm')} 继续播放</h2>
          <a class="btn btn--text btn--sm" href="#/recent" data-link>全部记录</a>
        </div>
        <div id="recentBody"><div class="tracklist">${skeletonTracks(3)}</div></div>
      </section>

      <section class="section" id="secCharts">
        <div class="section__head">
          <h2 class="section__title">${icon('explore', 'icon-sm')} 排行榜</h2>
          <span class="section__hint">数据来自网易云音乐公开榜单</span>
        </div>
        <div class="tile-grid" id="chartGrid">${skeletonTiles(4)}</div>
      </section>

      <section class="section" id="secPicks">
        <div class="section__head">
          <h2 class="section__title">${icon('music', 'icon-sm')} 为你挑选</h2>
          <span class="section__hint">基于你的收听记录</span>
        </div>
        <div class="tile-grid" id="pickGrid">${skeletonTiles(6)}</div>
      </section>

    </div>`;

  // ---------- 继续播放 ----------
  const recent = (s.recent || []).slice(0, 5);
  const recentBody = root.querySelector('#recentBody');
  if (recent.length) {
    recentBody.innerHTML = `<div class="tracklist">${tracklistHTML(recent, { showAlbum: true })}</div>`;
  } else {
    recentBody.innerHTML = emptyState({
      iconName: 'headset',
      title: '还没有播放记录',
      desc: '试着搜索一首歌，或者直接点「随便听听」',
    });
  }

  // ---------- 随便听听 ----------
  root.querySelector('#heroPlayRandom')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const old = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" style="width:16px;height:16px;border-width:2px"></span> 正在找歌…`;
    try {
      const pool = [];
      // 先塞入本地喜欢与最近
      pool.push(...(store.state.liked || []).slice(0, 20));
      pool.push(...(store.state.recent || []).slice(0, 20));
      if (pool.length < 8) {
        const hits = await searchAll('热歌', { limit: 10 });
        pool.push(...hits);
      }
      const unique = Array.from(new Map(pool.map((t) => [t.key, t])).values());
      if (!unique.length) throw new Error('没有可播放的曲目');
      // 洗牌
      for (let i = unique.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [unique[i], unique[j]] = [unique[j], unique[i]];
      }
      await player.playList(unique, 0);
    } catch (err) {
      toastError(`播放失败：${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = old;
    }
  });

  // ---------- 榜单 ----------
  const chartGrid = root.querySelector('#chartGrid');
  const charts = await Promise.allSettled(
    CHARTS.map((c) => getPlaylist('netease', c.id).then((pl) => ({ ...c, pl }))),
  );

  const chartCards = [];
  charts.forEach((r) => {
    if (r.status !== 'fulfilled' || !r.value?.pl) return;
    const { pl, name, desc } = r.value;
    chartCards.push(`
      <a class="tile" href="#/playlist/netease/${esc(pl.id)}" data-link>
        <div class="tile__art">
          <img loading="lazy" src="${esc(pl.cover ? imgUrl(pl.cover) : placeholderCover())}" alt="">
          <button class="tile__play" data-act="play-pl" data-source="netease" data-id="${esc(pl.id)}" title="播放榜单">
            ${icon('play', 'icon-sm')}
          </button>
        </div>
        <div class="tile__body">
          <div class="tile__title">${esc(name)}</div>
          <div class="tile__sub">${esc(desc)} · ${pl.trackCount || pl.tracks.length} 首</div>
        </div>
      </a>`);
  });

  chartGrid.innerHTML = chartCards.length
    ? chartCards.join('')
    : emptyState({ iconName: 'wifi_off', title: '榜单加载失败', desc: '请检查网络连接，或确认本地服务正在运行（node server/index.js）' });

  // ---------- 为你挑选 ----------
  const pickGrid = root.querySelector('#pickGrid');
  const liked = store.state.liked || [];
  const history = store.state.recent || [];
  const seeds = [...liked.slice(0, 3), ...history.slice(0, 3)];

  if (!seeds.length) {
    pickGrid.innerHTML = emptyState({
      iconName: 'music',
      title: '听几首歌之后，这里会变得更懂你',
      desc: '我们会按你的口味，从已启用的音源里挑出下一首',
    });
  } else {
    const keyword = seeds[Math.floor(Math.random() * seeds.length)];
    pickGrid.innerHTML = skeletonTiles(3);
    try {
      const hits = await searchAll(`${keyword.artist}`, { limit: 6 });
      const seen = new Set(seeds.map((t) => t.key));
      const picks = hits.filter((t) => !seen.has(t.key)).slice(0, 6);
      pickGrid.innerHTML = picks.length
        ? picks.map((t) => `
          <div class="tile" data-rec-key="${esc(t.key)}" style="cursor:pointer">
            <div class="tile__art">
              <img loading="lazy" src="${esc(coverOf(t))}" alt="">
              <button class="tile__play" data-act="play-rec" data-key="${esc(t.key)}" title="播放">
                ${icon('play', 'icon-sm')}
              </button>
            </div>
            <div class="tile__body">
              <div class="tile__title">${esc(t.name)}</div>
              <div class="tile__sub">${esc(t.artist)} · ${esc(SOURCES[t.source]?.short || t.source)}</div>
            </div>
          </div>`).join('')
        : emptyState({ iconName: 'music', title: '暂时没有更多推荐' });
      // 记录一份，供点击播放
      root._picks = picks;
    } catch {
      pickGrid.innerHTML = emptyState({ iconName: 'wifi_off', title: '推荐加载失败' });
    }
  }

  // ---------- 赞助入口：10 秒后自动收起 ----------
  const sponsorEl = root.querySelector('.sponsor-entry');
  let sponsorTimer = null;
  if (sponsorEl) {
    sponsorTimer = setTimeout(() => {
      sponsorEl.classList.add('is-hidden');
    }, 10000);
    // 用户主动点过就不再自动隐藏
    sponsorEl.addEventListener('click', () => {
      clearTimeout(sponsorTimer);
      sponsorTimer = null;
    }, { once: true });
  }

  return () => {
    if (sponsorTimer) clearTimeout(sponsorTimer);
  };
}
