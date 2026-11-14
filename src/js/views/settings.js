/**
 * views/settings.js — 设置
 */

import { store, SOURCES, ALL_SOURCE_KEYS } from '../core/store.js';
import { applyTheme, resolvedTheme } from '../core/theme.js';
import { pingProxy } from '../api/gateway.js';
import { confirmDialog, openDialog } from '../ui/components.js';
import { esc, download } from '../core/util.js';
import { icon } from '../ui/icons.js';
import { toast, toastSuccess, toastError } from '../ui/toast.js';

export async function render(root) {
  const s = store.settings;
  const theme = s.theme || 'system';

  root.innerHTML = `
    <div class="view">
      <div class="view-head">
        <div class="view-head__text">
          <h1>设置</h1>
          <p>所有配置都存在本机</p>
        </div>
      </div>

      <!-- 外观 -->
      <div class="settings-group">
        <div class="settings-group__head">外观</div>
        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">主题</div>
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
        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">界面动效</div>
            <div class="setting-row__desc">关闭后会减少过渡与动画</div>
          </div>
          <div class="setting-row__control">
            <label class="switch">
              <input type="checkbox" id="swAnim" ${s.animations !== false ? 'checked' : ''}>
              <span class="switch__track"><span class="switch__thumb"></span></span>
            </label>
          </div>
        </div>
      </div>

      <!-- 音源 -->
      <div class="settings-group">
        <div class="settings-group__head">音源</div>
        <div class="setting-row setting-row--stack">
          <div class="setting-row__text">
            <div class="setting-row__title">启用的音源</div>
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
        <div class="setting-row">
          <div class="setting-row__text">
            <div class="setting-row__title">首选音质</div>
            
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

      <!-- 播放 -->
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

      <!-- 数据 -->
      <div class="settings-group">
        <div class="settings-group__head">数据</div>
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

      <!-- 关于 -->
      <div class="settings-group">
        <div class="settings-group__head">关于</div>
        <div class="setting-row">
          <div class="about-card" style="border:none;padding:0;width:100%">
            <img src="./assets/icon-192.png" alt="" style="border-radius:14px;box-shadow:var(--shadow-1)">
            <div style="flex:1;min-width:0">
              <div style="font:var(--text-h3);margin-bottom:4px">BM Free Music <span style="color:var(--on-surface-muted);font-weight:400;font-size:13px">v1.1.0</span></div>
              <p style="color:var(--on-surface-muted);font-size:13px;line-height:1.7">
                多平台聚合音乐播放器 · Material 3 设计语言 · 支持 PWA 安装
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
      </div>

      <!-- 赞助入口 -->
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

  /* ---------------- 事件 ---------------- */
  root.querySelector('#themeSeg')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-theme-opt]');
    if (!btn) return;
    applyTheme(btn.dataset.themeOpt);
    root.querySelectorAll('[data-theme-opt]').forEach((b) => b.classList.toggle('is-active', b === btn));
  });

  root.querySelector('#swAnim')?.addEventListener('change', (e) => {
    store.setSettings({ animations: e.target.checked });
    document.documentElement.classList.toggle('no-anim', !e.target.checked);
    toastSuccess(e.target.checked ? '已开启动效' : '已关闭动效');
  });

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

  root.querySelector('#quality')?.addEventListener('change', (e) => {
    store.setSettings({ quality: e.target.value });
    toastSuccess('音质偏好已更新');
  });

  root.querySelector('#searchLimit')?.addEventListener('change', (e) => {
    store.setSettings({ searchLimit: Number(e.target.value) });
  });

  root.querySelector('#swAutoNext')?.addEventListener('change', (e) => {
    store.setSettings({ autoNext: e.target.checked });
  });

  root.querySelector('#swShuffle')?.addEventListener('change', (e) => {
    store.setSettings({ shuffle: e.target.checked });
    document.getElementById('btnShuffle')?.classList.toggle('is-on', e.target.checked);
  });

  root.querySelector('#volSlider')?.addEventListener('input', (e) => {
    const v = Number(e.target.value) / 100;
    store.setSettings({ volume: v, muted: v === 0 });
    const audio = document.getElementById('audio');
    if (audio) { audio.volume = v; audio.muted = v === 0; }
    const vol = document.getElementById('volume');
    if (vol) { vol.value = e.target.value; vol.style.setProperty('--val', `${e.target.value}%`); }
    e.target.style.setProperty('--val', `${e.target.value}%`);
    e.target.closest('.setting-row')?.querySelector('.setting-row__desc')
      ?.replaceChildren(`当前 ${e.target.value}%`);
  });
  root.querySelector('#volSlider')?.style.setProperty('--val', `${Math.round((s.volume ?? 0.8) * 100)}%`);

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
        render(root);
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

  /* ---------------- 赞助二维码放大 ---------------- */
  root.querySelectorAll('[data-qr]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const zoom = document.createElement('div');
      zoom.className = 'qr-zoom';
      zoom.innerHTML = `<img src="${esc(btn.dataset.qr)}" alt="收款二维码">`;
      zoom.addEventListener('click', () => zoom.remove());
      document.body.appendChild(zoom);
    });
  });

  /* ---------------- 代理状态 ---------------- */
  const statusEl = root.querySelector('#proxyStatus');
  const check = async () => {
    statusEl.textContent = '检测中…';
    statusEl.style.color = '';
    const ok = await pingProxy();
    statusEl.textContent = ok ? '本地代理运行正常' : '本地代理未连接（请用 node server/index.js 启动）';
    statusEl.style.color = ok ? 'var(--success)' : 'var(--error)';
  };
  check();
  root.querySelector('#btnRecheckProxy')?.addEventListener('click', check);
}
