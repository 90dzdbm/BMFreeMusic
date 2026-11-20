/**
 * views/settings.js — 设置（多级菜单）
 *
 * 一级：只列大分类，点进去是二级页面。
 * 二级页面由 #/settings/<page> 打开，顶栏有返回按钮。
 *
 *   #/settings              → 分类列表
 *   #/settings/appearance   → 外观
 *   #/settings/audio        → 音源
 *   #/settings/playback     → 播放
 *   #/settings/data         → 数据
 *   #/settings/about        → 关于
 */

import { store, SOURCES, ALL_SOURCE_KEYS, GENRES } from '../core/store.js';
import { applyTheme, resolvedTheme, ACCENTS, applyAccent } from '../core/theme.js';
import { pingProxy } from '../api/gateway.js';
import { confirmDialog, openDialog } from '../ui/components.js';
import { esc, download } from '../core/util.js';
import { icon } from '../ui/icons.js';
import { toast, toastSuccess, toastError } from '../ui/toast.js';
import { deskLyrics } from '../ui/desklyrics.js';
import { pickSplashMedia } from '../ui/splash.js';

const PAGES = [
  { key: 'appearance', label: '外观', desc: '主题、配色、开屏页、播放器样式', icon: 'palette' },
  { key: 'audio', label: '音源', desc: '启用的平台、偏好平台与曲风、音质', icon: 'equalizer' },
  { key: 'playback', label: '播放', desc: '播放行为与音量', icon: 'headset' },
  { key: 'data', label: '数据', desc: '备份、导入、清理', icon: 'storage' },
  { key: 'about', label: '关于', desc: '版本、仓库与配置文件位置', icon: 'info' },
];

export async function render(root, params = {}) {
  const page = params.page || '';

  if (!page) return renderIndex(root);
  if (page === 'appearance') return renderAppearance(root);
  if (page === 'audio') return renderAudio(root);
  if (page === 'playback') return renderPlayback(root);
  if (page === 'data') return renderData(root);
  if (page === 'about') return renderAbout(root);
  return renderIndex(root);
}

/* ==========================================================================
   一级：分类列表
   ========================================================================== */
async function renderIndex(root) {
  const s = store.settings;

  root.innerHTML = `
    <div class="view">
      <div class="view-head">
        <div class="view-head__text">
          <h1>设置</h1>
          <p>所有配置都存在本机</p>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group__head">分类</div>
        ${PAGES.map((p, i) => `
          <a class="setting-row setting-row--link" href="#/settings/${p.key}" data-link
             style="text-decoration:none;${i ? 'border-top:1px solid var(--outline-variant);' : ''}">
            <span class="setting-row__icon">${icon(p.icon)}</span>
            <div class="setting-row__text">
              <div class="setting-row__title">${esc(p.label)}</div>
              <div class="setting-row__desc">${esc(p.desc)}</div>
            </div>
            <div class="setting-row__control">
              <span class="icon-btn icon-btn--sm" style="pointer-events:none">${icon('chevron', 'icon-sm')}</span>
            </div>
          </a>`).join('')}
      </div>

      <div class="settings-group">
        <div class="settings-group__head">支持</div>
        <a class="setting-row" href="#/sponsor" data-link style="text-decoration:none">
          <div class="setting-row__text">
            <div class="setting-row__title">赞助支持</div>
            <div class="setting-row__desc">扫码打赏，多少都是心意 · 无论是否赞助都永远免费</div>
          </div>
          <div class="setting-row__control">
            <span class="btn btn--tonal btn--sm">${icon('heart_filled', 'icon-sm')} 去看看</span>
          </div>
        </a>
      </div>
    </div>`;
}

/* ==========================================================================
   通用：二级页头部
   ========================================================================== */
function subHead(title, desc) {
  return `
    <div class="view-head">
      <button class="icon-btn" id="setBack" title="返回">${icon('back')}</button>
      <div class="view-head__text">
        <h1>${esc(title)}</h1>
        <p>${esc(desc || '')}</p>
      </div>
    </div>`;
}

function bindBack(root) {
  root.querySelector('#setBack')?.addEventListener('click', () => {
    location.hash = '#/settings';
  });
}

/* ==========================================================================
   外观
   ========================================================================== */
async function renderAppearance(root) {
  const s = store.settings;
  const theme = s.theme || 'system';
  const accent = s.accent || 'blue';

  root.innerHTML = `
    <div class="view">
      ${subHead('外观', '主题、配色、开屏页与播放器样式')}

      <!-- 主题 -->
      <div class="settings-group">
        <div class="settings-group__head">主题</div>
        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">明暗模式</div>
            <div class="setting-row__desc">跟随系统时，会随操作系统的深浅色自动切换</div>
          </div>
          <div class="setting-row__control">
            <div class="segmented" id="themeSeg">
              <button data-theme-opt="light" class="${theme === 'light' ? 'is-active' : ''}">
                ${icon('light', 'icon-xs')} 亮色
              </button>
              <button data-theme-opt="dark" class="${theme === 'dark' ? 'is-active' : ''}">
                ${icon('dark', 'icon-xs')} 暗色
              </button>
              <button data-theme-opt="system" class="${theme === 'system' ? 'is-active' : ''}">
                ${icon('settings', 'icon-xs')} 跟随系统
              </button>
            </div>
          </div>
        </div>

        <div class="setting-row setting-row--stack">
          <div class="setting-row__text">
            <div class="setting-row__title">主题配色</div>
            <div class="setting-row__desc">换一组主色，界面里的强调色会一起变</div>
          </div>
          <div class="setting-row__control">
            <div class="chip-row chip-row--scroll" id="accentChips">
              ${ACCENTS.map((a) => `
                <button class="chip accent-chip ${accent === a.key ? 'is-active' : ''}"
                        data-accent-opt="${a.key}" title="${esc(a.name)}">
                  <i style="background:${a.color}"></i>${esc(a.name)}
                </button>`).join('')}
            </div>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">界面动效</div>
            <div class="setting-row__desc">关闭后会减少过渡与动画，低端机上更流畅</div>
          </div>
          <div class="setting-row__control">
            <label class="switch">
              <input type="checkbox" id="swAnim" ${s.animations !== false ? 'checked' : ''}>
              <span class="switch__track"><span class="switch__thumb"></span></span>
            </label>
          </div>
        </div>
      </div>

      <!-- 开屏页 -->
      <div class="settings-group">
        <div class="settings-group__head">开屏页</div>
        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">显示开屏页</div>
            <div class="setting-row__desc">启动时先显示一张图片或一段视频</div>
          </div>
          <div class="setting-row__control">
            <label class="switch">
              <input type="checkbox" id="swSplash" ${s.splashEnabled ? 'checked' : ''}>
              <span class="switch__track"><span class="switch__thumb"></span></span>
            </label>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">开屏素材</div>
            <div class="setting-row__desc" id="splashDesc">${s.splashMedia ? '已设置' : '还没有选择'}</div>
          </div>
          <div class="setting-row__control">
            <button class="btn btn--outline btn--sm" id="btnPickSplash">${icon('image', 'icon-sm')} 选择</button>
            ${s.splashMedia ? `<button class="btn btn--text btn--sm" id="btnClearSplash">清除</button>` : ''}
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">显示时长</div>
            <div class="setting-row__desc">当前 ${(Number(s.splashDuration) || 2.5).toFixed(1)} 秒</div>
          </div>
          <div class="setting-row__control" style="min-width:180px">
            <input class="slider" type="range" id="splashDur" min="1" max="10" step="0.5"
                   value="${Number(s.splashDuration) || 2.5}">
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">视频静音</div>
            <div class="setting-row__desc">开屏视频默认静音，避免突然出声</div>
          </div>
          <div class="setting-row__control">
            <label class="switch">
              <input type="checkbox" id="swSplashMute" ${s.splashMuted !== false ? 'checked' : ''}>
              <span class="switch__track"><span class="switch__thumb"></span></span>
            </label>
          </div>
        </div>
      </div>

      <!-- 播放器 -->
      <div class="settings-group">
        <div class="settings-group__head">播放器</div>
        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">播放器样式</div>
            <div class="setting-row__desc">控制全屏播放页的视觉风格</div>
          </div>
          <div class="setting-row__control">
            <div class="segmented" id="npStyleSeg">
              <button data-np-style="blur" class="${(s.npStyle || 'blur') === 'blur' ? 'is-active' : ''}">模糊</button>
              <button data-np-style="gradient" class="${s.npStyle === 'gradient' ? 'is-active' : ''}">渐变</button>
              <button data-np-style="plain" class="${s.npStyle === 'plain' ? 'is-active' : ''}">纯色</button>
            </div>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">歌词字号</div>
            <div class="setting-row__desc">当前 ${Number(s.npFontSize) || 16} px</div>
          </div>
          <div class="setting-row__control" style="min-width:180px">
            <input class="slider" type="range" id="npFontSize" min="12" max="28" step="1"
                   value="${Number(s.npFontSize) || 16}">
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">桌面歌词</div>
            <div class="setting-row__desc" id="deskDesc">在应用上层显示当前歌词</div>
          </div>
          <div class="setting-row__control">
            <label class="switch">
              <input type="checkbox" id="swDeskLyrics" ${s.deskLyrics ? 'checked' : ''}>
              <span class="switch__track"><span class="switch__thumb"></span></span>
            </label>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">歌词颜色</div>
            <div class="setting-row__desc">桌面歌词文字颜色</div>
          </div>
          <div class="setting-row__control">
            <input type="color" id="deskColor" value="${esc(String(s.deskLyricsColor || '#ffffff'))}"
                   style="width:52px;height:34px;border:1px solid var(--outline);border-radius:8px;background:none;padding:2px">
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">歌词透明度</div>
            <div class="setting-row__desc" id="deskAlphaDesc">当前 ${Math.round((Number(s.deskLyricsAlpha ?? 0.9)) * 100)}%</div>
          </div>
          <div class="setting-row__control" style="min-width:180px">
            <input class="slider" type="range" id="deskAlpha" min="10" max="100" step="5"
                   value="${Math.round((Number(s.deskLyricsAlpha ?? 0.9)) * 100)}">
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">歌词可拖动</div>
            <div class="setting-row__desc" id="deskDragDesc">${s.deskLyricsDraggable ? '可拖动（此时会挡住下层应用的点击）' : '关闭（不接收触摸，绝不挡点击）'}</div>
          </div>
          <div class="setting-row__control">
            <label class="switch">
              <input type="checkbox" id="swDeskDraggable" ${s.deskLyricsDraggable ? 'checked' : ''}>
              <span class="switch__track"><span class="switch__thumb"></span></span>
            </label>
          </div>
        </div>
      </div>
    </div>`;

  bindBack(root);

  /* ---- 主题 ---- */
  root.querySelector('#themeSeg')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-theme-opt]');
    if (!btn) return;
    applyTheme(btn.dataset.themeOpt);
    root.querySelectorAll('[data-theme-opt]').forEach((b) => b.classList.toggle('is-active', b === btn));
  });

  /* ---- 配色 ---- */
  root.querySelector('#accentChips')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-accent-opt]');
    if (!chip) return;
    const key = chip.dataset.accentOpt;
    applyAccent(key);
    root.querySelectorAll('[data-accent-opt]').forEach((b) => b.classList.toggle('is-active', b === chip));
    toastSuccess(`配色已切换为${ACCENTS.find((a) => a.key === key)?.name || key}`);
  });

  /* ---- 动效 ---- */
  root.querySelector('#swAnim')?.addEventListener('change', (e) => {
    store.setSettings({ animations: e.target.checked });
    document.documentElement.classList.toggle('no-anim', !e.target.checked);
    toastSuccess(e.target.checked ? '已开启动效' : '已关闭动效');
  });

  /* ---- 开屏 ---- */
  root.querySelector('#swSplash')?.addEventListener('change', (e) => {
    store.setSettings({ splashEnabled: e.target.checked });
    toastSuccess(e.target.checked ? '开屏页已开启' : '开屏页已关闭');
  });

  root.querySelector('#btnPickSplash')?.addEventListener('click', async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const picked = await pickSplashMedia(f);
      if (!picked) return toastError('素材读取失败');
      store.setSettings({ splashMedia: picked.name, splashType: picked.type });
      store.flush();
      const desc = root.querySelector('#splashDesc');
      if (desc) desc.textContent = `已设置（${picked.type === 'video' ? '视频' : '图片'}）`;
      toastSuccess('开屏素材已更新');
      root.querySelector('#btnClearSplash')?.remove();
    };
    input.click();
  });

  root.querySelector('#btnClearSplash')?.addEventListener('click', () => {
    store.setSettings({ splashMedia: '', splashType: 'image' });
    store.flush();
    const desc = root.querySelector('#splashDesc');
    if (desc) desc.textContent = '还没有选择';
    toastSuccess('已清除');
    renderAppearance(root);
  });

  const dur = root.querySelector('#splashDur');
  dur?.style.setProperty('--val', `${((Number(s.splashDuration) || 2.5) - 1) / 9 * 100}%`);
  dur?.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    e.target.style.setProperty('--val', `${(v - 1) / 9 * 100}%`);
    store.setSettings({ splashDuration: v });
    e.target.closest('.setting-row')?.querySelector('.setting-row__desc')
      ?.replaceChildren(`当前 ${v.toFixed(1)} 秒`);
  });

  root.querySelector('#swSplashMute')?.addEventListener('change', (e) => {
    store.setSettings({ splashMuted: e.target.checked });
  });

  /* ---- 播放器样式 ---- */
  root.querySelector('#npStyleSeg')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-np-style]');
    if (!btn) return;
    store.setSettings({ npStyle: btn.dataset.npStyle });
    root.querySelectorAll('[data-np-style]').forEach((b) => b.classList.toggle('is-active', b === btn));
    // 立刻作用到已经打开的播放页
    document.querySelector('#nowplaying')?.setAttribute('data-np-style', btn.dataset.npStyle);
  });

  const fs = root.querySelector('#npFontSize');
  fs?.style.setProperty('--val', `${((Number(s.npFontSize) || 16) - 12) / 16 * 100}%`);
  fs?.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    e.target.style.setProperty('--val', `${(v - 12) / 16 * 100}%`);
    store.setSettings({ npFontSize: v });
    e.target.closest('.setting-row')?.querySelector('.setting-row__desc')
      ?.replaceChildren(`当前 ${v} px`);
  });

  /* ---- 桌面歌词：颜色 / 透明度 / 可拖动 ---- */
  const dc = root.querySelector('#deskColor');
  dc?.addEventListener('input', (e) => {
    store.setSettings({ deskLyricsColor: e.target.value });
    deskLyrics.applyStyle?.();
  });

  const da = root.querySelector('#deskAlpha');
  if (da) {
    const v0 = Math.round((Number(s.deskLyricsAlpha ?? 0.9)) * 100);
    da.style.setProperty('--val', `${(v0 - 10) / 90 * 100}%`);
    da.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      e.target.style.setProperty('--val', `${(v - 10) / 90 * 100}%`);
      store.setSettings({ deskLyricsAlpha: v / 100 });
      root.querySelector('#deskAlphaDesc')?.replaceChildren(`当前 ${v}%`);
      deskLyrics.applyStyle?.();
    });
  }

  root.querySelector('#swDeskDraggable')?.addEventListener('change', (e) => {
    const on = e.target.checked;
    store.setSettings({ deskLyricsDraggable: on });
    root.querySelector('#deskDragDesc')?.replaceChildren(
      on ? '可拖动（此时会挡住下层应用的点击）' : '关闭（不接收触摸，绝不挡点击）');
    deskLyrics.applyStyle?.();
  });

  root.querySelector('#swDeskLyrics')?.addEventListener('change', (e) => {
    const on = e.target.checked;
    if (on) {
      const ok = deskLyrics.enable();
      if (!ok) {
        e.target.checked = false;
        const desc = root.querySelector('#deskDesc');
        if (desc) desc.textContent = '需要悬浮窗权限，已跳转到系统设置';
        toast('请允许「显示在其他应用上层」');
        return;
      }
      store.setSettings({ deskLyrics: true });
      toastSuccess('桌面歌词已开启');
    } else {
      deskLyrics.disable();
      store.setSettings({ deskLyrics: false });
      toastSuccess('桌面歌词已关闭');
    }
  });
}

/* ==========================================================================
   音源
   ========================================================================== */
async function renderAudio(root) {
  const s = store.settings;
  const pref = s.prefSources || [];
  const genres = s.prefGenres || [];

  root.innerHTML = `
    <div class="view">
      ${subHead('音源', '启用的平台、偏好平台与曲风')}

      <div class="settings-group">
        <div class="settings-group__head">启用的音源</div>
        <div class="setting-row setting-row--stack">
          <div class="setting-row__text">
            <div class="setting-row__title">参与搜索与换源的平台</div>
            <div class="setting-row__desc">至少保留一个</div>
          </div>
          <div class="setting-row__control">
            <div class="chip-row chip-row--scroll" id="sourceChips">
              ${Object.entries(SOURCES).filter(([k]) => k !== 'local').map(([k, v]) => `
                <button class="chip ${(s.enabledSources || []).includes(k) ? 'is-active' : ''}" data-src-chip="${k}">
                  ${esc(v.name)}
                </button>`).join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group__head">偏好</div>
        <div class="setting-row setting-row--stack">
          <div class="setting-row__text">
            <div class="setting-row__title">偏好音源</div>
            <div class="setting-row__desc">换源和搜索优先走这里选中的平台，留空表示一视同仁</div>
          </div>
          <div class="setting-row__control">
            <div class="chip-row chip-row--scroll" id="prefSourceChips">
              ${Object.entries(SOURCES).filter(([k]) => k !== 'local').map(([k, v]) => `
                <button class="chip ${pref.includes(k) ? 'is-active' : ''}" data-pref-src="${k}">
                  ${esc(v.name)}
                </button>`).join('')}
            </div>
          </div>
        </div>
        <div class="setting-row setting-row--stack">
          <div class="setting-row__text">
            <div class="setting-row__title">偏好曲风</div>
            <div class="setting-row__desc">「随便听听」会从这些曲风里挑歌</div>
          </div>
          <div class="setting-row__control">
            <div class="chip-row chip-row--scroll" id="prefGenreChips">
              ${GENRES.map((g) => `
                <button class="chip ${genres.includes(g.key) ? 'is-active' : ''}" data-pref-genre="${g.key}">
                  ${esc(g.name)}
                </button>`).join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group__head">音质与数量</div>
        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">首选音质</div>
            <div class="setting-row__desc">平台不支持时会自动降级</div>
          </div>
          <div class="setting-row__control">
            <select class="input" id="quality" style="width:180px;height:40px">
              <option value="standard" ${s.quality === 'standard' ? 'selected' : ''}>标准 (128k)</option>
              <option value="higher" ${s.quality === 'higher' ? 'selected' : ''}>较高 (192k)</option>
              <option value="exhigh" ${s.quality === 'exhigh' ? 'selected' : ''}>极高 (320k)</option>
              <option value="lossless" ${s.quality === 'lossless' ? 'selected' : ''}>无损</option>
            </select>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">每个音源返回条数</div>
            <div class="setting-row__desc">默认 30</div>
          </div>
          <div class="setting-row__control">
            <select class="input" id="searchLimit" style="width:120px;height:40px">
              ${[10, 20, 30, 50, 100].map((n) => `
                <option value="${n}" ${s.searchLimit === n ? 'selected' : ''}>${n}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
    </div>`;

  bindBack(root);

  root.querySelector('#sourceChips')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-src-chip]');
    if (!chip) return;
    const key = chip.dataset.srcChip;
    const list = new Set(store.settings.enabledSources || []);
    if (list.has(key)) {
      if (list.size === 1) return toast('至少保留一个音源');
      list.delete(key);
      chip.classList.remove('is-active');
    } else {
      list.add(key);
      chip.classList.add('is-active');
    }
    store.setSettings({ enabledSources: Array.from(list) });
  });

  root.querySelector('#prefSourceChips')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-pref-src]');
    if (!chip) return;
    const key = chip.dataset.prefSrc;
    const list = new Set(store.settings.prefSources || []);
    if (list.has(key)) list.delete(key); else list.add(key);
    chip.classList.toggle('is-active', list.has(key));
    store.setSettings({ prefSources: Array.from(list) });
  });

  root.querySelector('#prefGenreChips')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-pref-genre]');
    if (!chip) return;
    const key = chip.dataset.prefGenre;
    const list = new Set(store.settings.prefGenres || []);
    if (list.has(key)) list.delete(key); else list.add(key);
    chip.classList.toggle('is-active', list.has(key));
    store.setSettings({ prefGenres: Array.from(list) });
  });

  root.querySelector('#quality')?.addEventListener('change', (e) => {
    store.setSettings({ quality: e.target.value });
    toastSuccess('音质偏好已更新');
  });

  root.querySelector('#searchLimit')?.addEventListener('change', (e) => {
    store.setSettings({ searchLimit: Number(e.target.value) });
  });
}

/* ==========================================================================
   播放
   ========================================================================== */
async function renderPlayback(root) {
  const s = store.settings;

  root.innerHTML = `
    <div class="view">
      ${subHead('播放', '播放行为与音量')}
      <div class="settings-group">
        <div class="settings-group__head">播放</div>
        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">自动播放下一首</div>
            <div class="setting-row__desc">当前曲目结束后继续播放队列</div>
          </div>
          <div class="setting-row__control">
            <label class="switch">
              <input type="checkbox" id="swAutoNext" ${s.autoNext !== false ? 'checked' : ''}>
              <span class="switch__track"><span class="switch__thumb"></span></span>
            </label>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">随机播放</div>
            <div class="setting-row__desc">打乱当前队列的播放顺序</div>
          </div>
          <div class="setting-row__control">
            <label class="switch">
              <input type="checkbox" id="swShuffle" ${s.shuffle ? 'checked' : ''}>
              <span class="switch__track"><span class="switch__thumb"></span></span>
            </label>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">音量</div>
            <div class="setting-row__desc">当前 ${Math.round((s.volume ?? 0.8) * 100)}%</div>
          </div>
          <div class="setting-row__control" style="min-width:180px">
            <input class="slider" type="range" id="volSlider" min="0" max="100"
                   value="${Math.round((s.volume ?? 0.8) * 100)}">
          </div>
        </div>
      </div>
    </div>`;

  bindBack(root);

  root.querySelector('#swAutoNext')?.addEventListener('change', (e) => {
    store.setSettings({ autoNext: e.target.checked });
  });

  root.querySelector('#swShuffle')?.addEventListener('change', (e) => {
    store.setSettings({ shuffle: e.target.checked });
    document.getElementById('btnShuffle')?.classList.toggle('is-on', e.target.checked);
  });

  const vol = root.querySelector('#volSlider');
  vol?.style.setProperty('--val', `${Math.round((s.volume ?? 0.8) * 100)}%`);
  vol?.addEventListener('input', (e) => {
    const v = Number(e.target.value) / 100;
    store.setSettings({ volume: v, muted: v === 0 });
    const audio = document.getElementById('audio');
    if (audio) { audio.volume = v; audio.muted = v === 0; }
    const slider = document.getElementById('volume');
    if (slider) { slider.value = e.target.value; slider.style.setProperty('--val', `${e.target.value}%`); }
    e.target.style.setProperty('--val', `${e.target.value}%`);
    e.target.closest('.setting-row')?.querySelector('.setting-row__desc')
      ?.replaceChildren(`当前 ${e.target.value}%`);
  });
}

/* ==========================================================================
   数据
   ========================================================================== */
async function renderData(root) {
  const s = store.settings;

  root.innerHTML = `
    <div class="view">
      ${subHead('数据', '备份、导入与清理')}
      <div class="settings-group">
        <div class="settings-group__head">备份</div>
        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">导出全部数据</div>
            <div class="setting-row__desc">包含喜欢、歌单、设置与账号凭证（JSON）</div>
          </div>
          <div class="setting-row__control">
            <button class="btn btn--outline btn--sm" id="btnExport">${icon('download')} 导出</button>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">导入数据</div>
            <div class="setting-row__desc">从备份文件恢复，重复曲目会自动跳过</div>
          </div>
          <div class="setting-row__control">
            <button class="btn btn--outline btn--sm" id="btnImport">${icon('upload')} 导入</button>
          </div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group__head">清理</div>
        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">清空最近播放</div>
            <div class="setting-row__desc">只清记录，不影响喜欢与歌单</div>
          </div>
          <div class="setting-row__control">
            <button class="btn btn--text btn--sm" id="btnClearRecent">清空</button>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title" style="color:var(--error)">重置所有数据</div>
            <div class="setting-row__desc">恢复到首次打开的状态，操作不可撤销</div>
          </div>
          <div class="setting-row__control">
            <button class="btn btn--text btn--sm" id="btnReset" style="color:var(--error)">重置</button>
          </div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group__head">配置文件</div>
        <div class="setting-row setting-row--stack">
          <div class="setting-row__text">
            <div class="setting-row__title">当前配置文件位置</div>
            <div class="setting-row__desc" id="cfgPath">${esc(window.BMFMAndroid?.configPath?.() || '本机内部存储')}</div>
          </div>
        </div>
      </div>
    </div>`;

  bindBack(root);

  root.querySelector('#btnExport')?.addEventListener('click', () => {
    download(`BMFreeMusic-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(store.exportData(), null, 2));
    toastSuccess('备份已下载');
  });

  root.querySelector('#btnImport')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        store.importData(data, { merge: true });
        toastSuccess('数据已导入');
        renderData(root);
      } catch (e) {
        toastError(`导入失败：${e.message}`);
      }
    };
    input.click();
  });

  root.querySelector('#btnClearRecent')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: '清空最近播放？', desc: '只清除播放记录', okLabel: '清空', danger: true });
    if (ok) { store.clearRecent(); toastSuccess('已清空'); }
  });

  root.querySelector('#btnReset')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '重置所有数据？',
      desc: '喜欢、歌单、账号凭证、设置都会被清空，且不可恢复。建议先导出备份。',
      okLabel: '我确定，重置',
      danger: true,
    });
    if (!ok) return;
    store.resetAll();
    location.reload();
  });
}

/* ==========================================================================
   关于
   ========================================================================== */
async function renderAbout(root) {
  root.innerHTML = `
    <div class="view">
      ${subHead('关于', '版本与项目信息')}
      <div class="settings-group">
        <div class="settings-group__head">应用</div>
        <div class="setting-row">
          <div class="about-card" style="border:none;padding:0;width:100%">
            <img src="./assets/icon-192.png" alt="" style="border-radius:14px;box-shadow:var(--shadow-1)">
            <div style="flex:1;min-width:0">
              <div style="font:var(--text-h3);margin-bottom:4px">BM Free Music <span style="color:var(--on-surface-muted);font-weight:400;font-size:13px">v1.2.2</span></div>
              <p style="color:var(--on-surface-muted);font-size:13px;line-height:1.7">
                多平台聚合音乐播放器 · Material 3 设计语言
              </p>
              <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <span class="source-tag" id="proxyStatus">正在检测本地代理…</span>
                <button class="btn btn--text btn--sm" id="btnRecheckProxy">重新检测</button>
              </div>
            </div>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">开发者仓库</div>
            <div class="setting-row__desc">github.com/90dzdbm/BMFreeMusic</div>
          </div>
          <div class="setting-row__control">
            <a class="btn btn--outline btn--sm" id="btnGitHub"
               href="https://github.com/90dzdbm/BMFreeMusic" target="_blank" rel="noopener noreferrer">
              ${icon('github', 'icon-sm')} 在 GitHub 打开
            </a>
          </div>
        </div>

        <div class="setting-row setting-row--stack">
          <div class="setting-row__text">
            <div class="setting-row__title">配置文件位置</div>
            <div class="setting-row__desc">优先保存在「手机存储 / BMFreeMusic /」，放不下会自动换到其它统一路径</div>
          </div>
          <div class="setting-row__control">
            <span class="setting-row__desc" id="cfgPath2">${esc(window.BMFMAndroid?.configPath?.() || '本机内部存储')}</span>
          </div>
        </div>
      </div>
    </div>`;

  bindBack(root);

  const statusEl = root.querySelector('#proxyStatus');
  const check = async () => {
    statusEl.textContent = '检测中…';
    statusEl.style.color = '';
    const ok = await pingProxy();
    statusEl.textContent = ok ? '本地代理运行正常' : '本地代理未连接';
    statusEl.style.color = ok ? 'var(--success)' : 'var(--error)';
  };
  check();
  root.querySelector('#btnRecheckProxy')?.addEventListener('click', check);
}
