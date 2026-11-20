/**
 * views/search.js — 搜索页
 */

import { store, SOURCES } from '../core/store.js';
import { searchAll } from '../api/sources.js';
import { tracklistHTML, skeletonTracks, emptyState } from '../ui/components.js';
import { esc } from '../core/util.js';
import { dedupeAndRank, variantInfo } from '../core/ranking.js';
import { icon } from '../ui/icons.js';
import { toastError } from '../ui/toast.js';

export async function render(root, params) {
  const q = (params.q || '').trim();
  const settings = store.settings;

  if (!q) {
    renderEmpty(root);
    return;
  }

  const enabled = settings.enabledSources || [];

  root.innerHTML = `
    <div class="view">
      <div class="view-head">
        <div class="view-head__text">
          <h1>搜索「${esc(q)}」</h1>
          <p id="searchMeta">搜索中…</p>
        </div>
        <div class="view-head__actions">
          <div class="chip-row" id="sourceFilter">
            ${Object.entries(SOURCES).filter(([k]) => k !== 'local').map(([k, v]) => `
              <button class="chip ${enabled.includes(k) ? 'is-active' : ''}" data-filter="${k}">
                ${esc(v.short)}
              </button>`).join('')}
          </div>
        </div>
      </div>
      <div id="resultBody" class="tracklist">${skeletonTracks(10)}</div>
    </div>`;

  const body = root.querySelector('#resultBody');
  const meta = root.querySelector('#searchMeta');
  let activeSources = new Set(enabled);
  let allResults = [];

  store.addSearchHistory(q);

  let loadToken = 0;
  let loading = false;

  /** 渐进式搜索：网易云 + QQ 先出结果，其余音源后补 */
  async function load() {
    const token = ++loadToken;
    const sources = Array.from(activeSources);
    const limit = settings.searchLimit || 30;

    loading = true;
    allResults = [];
    body.innerHTML = `<div class="tracklist">${skeletonTracks(6)}</div>`;
    meta.textContent = '搜索中…';

    const FAST = ['netease', 'qq'];
    const fastList = sources.filter((x) => FAST.includes(x));
    const slowList = sources.filter((x) => !FAST.includes(x));

    const apply = (partial, append) => {
      if (token !== loadToken) return;
      if (append) {
        const seen = new Set(allResults.map((t) => t.key));
        allResults = allResults.concat(partial.filter((t) => !seen.has(t.key)));
      } else {
        allResults = partial;
      }
      // 去重 + 原曲优先排序
      allResults = dedupeAndRank(allResults, store.settings.prefSources || []);
      paint();
    };

    const jobs = [];
    if (fastList.length) {
      jobs.push(
        searchAll(q, { sources: fastList, limit })
          .then((list) => apply(list, false))
          .catch(() => {}),
      );
    }
    if (slowList.length) {
      jobs.push(
        searchAll(q, { sources: slowList, limit })
          .then((list) => apply(list, true))
          .catch(() => {}),
      );
    }

    await Promise.all(jobs);

    if (token === loadToken) {
      loading = false;
      if (!allResults.length) {
        body.innerHTML = emptyState({ iconName: 'search', title: '没有找到相关歌曲', desc: '换个关键词试试' });
        meta.textContent = '0 条结果';
        updateChips({});
      }
    }
  }

  function paint() {
    if (!allResults.length) {
      if (loading) return;
      body.innerHTML = emptyState({
        iconName: 'search',
        title: '没有找到相关歌曲',
        desc: '换个关键词试试',
      });
      meta.textContent = '0 条结果';
      updateChips({});
      return;
    }
    const grouped = {};
    allResults.forEach((t) => { (grouped[t.source] ||= []).push(t); });
    const variants = allResults.filter((t) => variantInfo(t).variant).length;
    const summary = Object.entries(grouped)
      .map(([s, arr]) => `${SOURCES[s]?.short || s} ${arr.length}`)
      .join(' · ');
    meta.textContent = variants
      ? `${allResults.length} 条结果（${variants} 条为变体版本）— ${summary}`
      : `${allResults.length} 条结果 — ${summary}`;
    body.innerHTML = tracklistHTML(allResults, { showAlbum: true });
    updateChips(grouped);
  }

  /** 在音源筛选按钮上显示各自命中数量，没命中的置灰 */
  function updateChips(grouped) {
    const wrap = root.querySelector('#sourceFilter');
    if (!wrap) return;
    wrap.querySelectorAll('[data-filter]').forEach((btn) => {
      const key = btn.dataset.filter;
      const n = grouped[key]?.length || 0;
      let badge = btn.querySelector('.chip__count');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'chip__count';
        btn.appendChild(badge);
      }
      badge.textContent = String(n);
      btn.classList.toggle('is-empty', n === 0);
      btn.title = n === 0 ? '本次搜索该音源没有结果' : `${SOURCES[key]?.name || key}：${n} 条`;
    });
  }

  root.querySelector('#sourceFilter')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    const src = btn.dataset.filter;
    if (activeSources.has(src)) {
      if (activeSources.size === 1) return;
      activeSources.delete(src);
      btn.classList.remove('is-active');
    } else {
      activeSources.add(src);
      btn.classList.add('is-active');
    }
    load();
  });

  await load();
}

function renderEmpty(root) {
  const history = store.state.recentSearches || [];
  const hot = ['周杰伦', '陈奕迅', '林俊杰', '五月天', '告五人', 'Taylor Swift', '久石让', '华语流行'];
  root.innerHTML = `
    <div class="view">
      <div class="view-head">
        <div class="view-head__text">
          <h1>搜索音乐</h1>
          <p>歌名、歌手、专辑都可以</p>
        </div>
      </div>

      <section class="section">
        <div class="section__head"><h2 class="section__title">热门搜索</h2></div>
        <div class="chip-row">
          ${hot.map((h) => `<button class="chip" data-hot="${esc(h)}">${esc(h)}</button>`).join('')}
        </div>
      </section>

      ${history.length ? `
      <section class="section">
        <div class="section__head">
          <h2 class="section__title">搜索历史</h2>
          <button class="btn btn--text btn--sm" id="clearHistory">清空</button>
        </div>
        <div class="chip-row">
          ${history.map((h) => `<button class="chip" data-hot="${esc(h)}">${esc(h)}</button>`).join('')}
        </div>
      </section>` : ''}
    </div>`;

  root.querySelectorAll('[data-hot]').forEach((btn) => {
    btn.addEventListener('click', () => {
      location.hash = `#/search?q=${encodeURIComponent(btn.dataset.hot)}`;
    });
  });

  root.querySelector('#clearHistory')?.addEventListener('click', () => {
    store.clearSearchHistory();
    renderEmpty(root);
  });
}
