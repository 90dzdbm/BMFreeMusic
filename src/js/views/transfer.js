/**
 * views/transfer.js — 歌单一键迁移（后台执行）
 *
 * 迁移放到 jobs 里跑，切页面不中断；回到本页会接着显示进度。
 */

import { store, SOURCES, AGG_SOURCE_KEYS } from '../core/store.js';
import { getPlaylist, searchOne, SOURCE_IMPL } from '../api/sources.js';
import { parsePlaylistUrl, similarity, esc, download, pMap } from '../core/util.js';
import { imgUrl } from '../api/gateway.js';
import { jobs } from '../core/jobs.js';
import { toast, toastSuccess, toastError } from '../ui/toast.js';
import { icon } from '../ui/icons.js';

const state = {
  step: 1,
  parsed: null,
  playlist: null,
  mode: 'rematch',
  targetName: '',
  created: null,
};

const CONCURRENCY = 4;   // 同时处理的曲目数
const MAX_SOURCES = 4;   // 每首歌最多查几个音源

export async function render(root) {
  // 有正在跑的迁移就直接显示它的进度
  const running = jobs.jobs.find((j) => j.type === 'transfer' && j.status === 'running');
  if (running) {
    return paintProgress(root, running);
  }

  if (state.step === 3 && state.created) {
    return paintDone(root);
  }

  state.step = 1;
  state.parsed = null;
  state.playlist = null;
  return paintStep1(root);
}

function shell(root, inner) {
  root.innerHTML = `
    <div class="view">
      <div class="view-head">
        <div class="view-head__text">
          <h1>歌单一键迁移</h1>
          <p>把外部歌单搬到本地，自动匹配可用音源。迁移在后台跑，你可以随时离开这个页面。</p>
        </div>
      </div>
      ${inner}
    </div>`;
}

/* ==========================================================================
   步骤 1：输入链接
   ========================================================================== */
function paintStep1(root) {
  shell(root, `
    <div class="stepper">
      <div class="step is-active"><span class="step__num">1</span> 粘贴链接</div>
      <div class="step__line"></div>
      <div class="step"><span class="step__num">2</span> 预览与设置</div>
      <div class="step__line"></div>
      <div class="step"><span class="step__num">3</span> 后台迁移</div>
    </div>

    <div class="card" style="padding:var(--sp-6)">
      <div class="field">
        <label class="field__label" for="plUrl">外部歌单链接或 ID</label>
        <input class="input" id="plUrl" placeholder="直接粘整段分享文案也行，会自动认出链接"
               spellcheck="false" autocomplete="off">
        <span class="field__hint">
          支持 music.163.com、y.qq.com、kugou.com、kuwo.cn、music.migu.cn、bilibili.com；
          带中文的分享文案、<code>#/playlist?id=</code> 这类 hash 链接、<code>平台:ID</code> 与裸 ID 都能识别。
        </span>
      </div>

      <div class="chip-row" style="margin-top:var(--sp-4)">
        <button class="chip" data-example="https://music.163.com/#/playlist?id=3778678">网易云歌单</button>
        <button class="chip" data-example="19723756">榜单 id</button>
      </div>

      <div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-6);flex-wrap:wrap">
        <button class="btn btn--filled" id="btnParse">${icon('search')} 解析歌单</button>
        <button class="btn btn--text" id="btnLocalFile">${icon('upload')} 从本地 JSON 导入</button>
      </div>

      <div id="parseStatus" style="margin-top:var(--sp-4)"></div>
    </div>`);

  const body = root.querySelector('.view');
  const input = body.querySelector('#plUrl');
  body.querySelectorAll('[data-example]').forEach((b) => {
    b.addEventListener('click', () => { input.value = b.dataset.example; input.focus(); });
  });

  const handleParse = async () => {
    const raw = input.value.trim();
    if (!raw) return toastError('先粘贴一个歌单链接');
    const status = body.querySelector('#parseStatus');
    const parsed = parsePlaylistUrl(raw);
    if (!parsed || parsed.source === 'unknown') {
      status.innerHTML = `<p style="color:var(--error)">没能从这段内容里认出受支持的歌单链接。</p>`;
      return;
    }
    if (parsed.type === 'song') {
      status.innerHTML = `<p style="color:var(--error)">这是单曲链接，迁移需要歌单链接。可以先用平台的「收藏到歌单」再迁移。</p>`;
      return;
    }
    if (!SOURCE_IMPL[parsed.source]) {
      status.innerHTML = `<p style="color:var(--error)">暂不支持该平台的歌单解析。</p>`;
      return;
    }

    status.innerHTML = `<div class="loading-block"><span class="spinner"></span> 正在读取 ${esc(SOURCES[parsed.source]?.name || parsed.source)} 歌单…</div>`;
    try {
      const pl = await getPlaylist(parsed.source, parsed.id);
      if (!pl.tracks?.length) throw new Error('歌单里没有曲目');
      state.parsed = parsed;
      state.playlist = pl;
      state.targetName = pl.name;
      state.step = 2;
      paintStep2(root);
    } catch (e) {
      status.innerHTML = `<p style="color:var(--error)">读取失败：${esc(e.message)}</p>`;
    }
  };

  body.querySelector('#btnParse').addEventListener('click', handleParse);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleParse(); });

  body.querySelector('#btnLocalFile')?.addEventListener('click', () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const tracks = data.tracks || data.songs || [];
        if (!Array.isArray(tracks) || !tracks.length) throw new Error('文件里没有曲目');
        const pl = store.createPlaylist(data.name || file.name.replace(/\.json$/i, ''));
        store.addTracksToPlaylist(pl.id, tracks);
        toastSuccess(`已导入 ${tracks.length} 首到「${pl.name}」`);
        location.hash = `#/local/${pl.id}`;
      } catch (e) {
        toastError(`导入失败：${e.message}`);
      }
    };
    fileInput.click();
  });
}

/* ==========================================================================
   步骤 2：预览与设置
   ========================================================================== */
function paintStep2(root) {
  const pl = state.playlist;
  const cover = pl.cover ? imgUrl(pl.cover) : '';

  shell(root, `
    <div class="stepper">
      <div class="step is-done"><span class="step__num">✓</span> 粘贴链接</div>
      <div class="step__line"></div>
      <div class="step is-active"><span class="step__num">2</span> 预览与设置</div>
      <div class="step__line"></div>
      <div class="step"><span class="step__num">3</span> 后台迁移</div>
    </div>

    <div class="transfer-panel">
      <div class="transfer-box">
        <div class="transfer-box__title">${icon('cloud', 'icon-sm')} 来源歌单</div>
        <div style="display:flex;gap:var(--sp-3);align-items:center">
          ${cover ? `<img src="${esc(cover)}" alt="" style="width:64px;height:64px;border-radius:12px;object-fit:cover">` : ''}
          <div style="min-width:0">
            <div style="font:var(--text-h3);word-break:break-word">${esc(pl.name)}</div>
            <div style="font:var(--text-caption);color:var(--on-surface-muted);margin-top:2px">
              ${esc(SOURCES[state.parsed.source]?.name || '')} · ${pl.tracks.length} 首
            </div>
          </div>
        </div>
        <div style="margin-top:auto;display:flex;gap:8px">
          <button class="btn btn--text btn--sm" id="btnBack">${icon('back')} 换一个</button>
        </div>
      </div>

      <div class="transfer-box">
        <div class="transfer-box__title">${icon('download', 'icon-sm')} 写入到</div>
        <div class="field">
          <label class="field__label">歌单名称</label>
          <input class="input" id="targetName" value="${esc(state.targetName)}">
        </div>
        <div class="field">
          <label class="field__label">处理方式</label>
          <select class="input" id="mode">
            <option value="rematch" ${state.mode === 'rematch' ? 'selected' : ''}>智能换源（保证每首都能播）</option>
            <option value="keep" ${state.mode === 'keep' ? 'selected' : ''}>原样保留（最快，不改音源）</option>
          </select>
        </div>
        <div style="margin-top:auto;display:flex;gap:8px">
          <button class="btn btn--filled" id="btnStart">${icon('sync')} 开始迁移</button>
        </div>
      </div>
    </div>

    <div class="section" style="margin-top:var(--sp-6)">
      <div class="section__head">
        <h2 class="section__title">曲目预览（${pl.tracks.length} 首）</h2>
      </div>
      <div style="max-height:340px;overflow-y:auto">
        ${pl.tracks.map((t, i) => `
          <div class="match-row" style="grid-template-columns:28px 1fr">
            <span style="color:var(--on-surface-muted);font-variant-numeric:tabular-nums">${i + 1}</span>
            <span class="from">${esc(t.name)}
              <span style="color:var(--on-surface-muted)">— ${esc(t.artist)}</span>
              <span class="source-tag" data-src="${esc(t.source)}">${esc(SOURCES[t.source]?.short || t.source)}</span>
            </span>
          </div>`).join('')}
      </div>
    </div>`);

  const body = root.querySelector('.view');
  body.querySelector('#btnBack').addEventListener('click', () => {
    state.step = 1;
    paintStep1(root);
  });
  body.querySelector('#mode').addEventListener('change', (e) => { state.mode = e.target.value; });
  body.querySelector('#btnStart').addEventListener('click', () => {
    state.targetName = body.querySelector('#targetName').value.trim() || pl.name;
    startTransferJob(root);
  });
}

/* ==========================================================================
   启动后台迁移
   ========================================================================== */
function startTransferJob(root) {
  const pl = state.playlist;
  const job = jobs.create('transfer', `迁移「${state.targetName}」`, pl.tracks.length);
  job.log(`开始迁移「${state.targetName}」，共 ${pl.tracks.length} 首`);
  job.log(state.mode === 'rematch' ? '处理方式：智能换源' : '处理方式：原样保留');

  runTransferJob(job, {
    tracks: pl.tracks,
    mode: state.mode,
    targetName: state.targetName,
  }).catch((e) => job.fail(e));

  paintProgress(root, job);
}

/** 真正干活的函数：不碰 DOM，可以独立跑完 */
async function runTransferJob(job, { tracks, mode, targetName }) {
  const enabled = store.settings.enabledSources || [];
  const sources = pickSources(enabled);
  const allowRematch = mode === 'rematch';

  const results = await pMap(tracks, async (track) => {
    if (job.canceled) return track;

    let out = track;
    let replaced = false;

    if (allowRematch) {
      const best = await findBestMatch(track, sources);
      if (best) {
        out = best;
        replaced = true;
      }
    }

    if (replaced) {
      job.log(`✔ ${track.name} → ${SOURCES[out.source]?.short || out.source}`, 'ok');
    } else if (allowRematch) {
      job.log(`· ${track.name} — 未找到更合适的音源，保留原样`, 'warn');
    }
    job.step(`${job.done + 1}/${job.total}`);
    return out;
  }, CONCURRENCY);

  if (job.canceled) {
    job.finish(null);
    return;
  }

  const clean = results.filter((t) => t && !t.__error);

  let created;
  const existing = store.state.playlists.find((p) => p.name === targetName);
  if (existing) {
    const added = store.addTracksToPlaylist(existing.id, clean);
    job.log(`已合并进「${existing.name}」，新增 ${added} 首`);
    created = existing;
  } else {
    created = store.createPlaylist(targetName);
    store.addTracksToPlaylist(created.id, clean);
    job.log(`已创建「${created.name}」，写入 ${clean.length} 首`);
  }

  state.created = created;
  job.finish({ playlistId: created.id, count: clean.length });
  toastSuccess(`迁移完成：${clean.length} 首已写入「${created.name}」`);
}

/** 挑 4 个最有可能命中的源：聚合站优先，再补原源与常规源 */
function pickSources(enabled) {
  const aggs = enabled.filter((k) => AGG_SOURCE_KEYS.includes(k));
  const normal = enabled.filter((k) => !AGG_SOURCE_KEYS.includes(k) && SOURCE_IMPL[k]);
  return [...aggs, ...normal].slice(0, MAX_SOURCES);
}

async function findBestMatch(track, sources) {
  const query = `${track.name} ${String(track.artist).split('/')[0]}`.trim();
  let best = null;
  let bestScore = 0;

  // 顺序查，命中高分就提前退出，省请求
  for (const src of sources) {
    try {
      const list = await searchOne(src, query, { limit: 6 });
      for (const cand of list) {
        const score = similarity(cand.name, track.name) * 0.65 +
                      similarity(cand.artist, track.artist) * 0.35;
        if (score > bestScore) { bestScore = score; best = cand; }
      }
      if (bestScore >= 0.9) break;
    } catch { /* 换下一个源 */ }
  }
  return bestScore >= 0.62 ? best : null;
}

/* ==========================================================================
   进度视图
   ========================================================================== */
function paintProgress(root, job) {
  shell(root, `
    <div class="stepper">
      <div class="step is-done"><span class="step__num">✓</span> 粘贴链接</div>
      <div class="step__line"></div>
      <div class="step is-done"><span class="step__num">✓</span> 预览与设置</div>
      <div class="step__line"></div>
      <div class="step is-active"><span class="step__num">3</span> 后台迁移</div>
    </div>

    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="min-width:0">
          <div style="font:var(--text-h3)">${esc(job.title)}</div>
          <div id="jobMsg" style="font:var(--text-caption);color:var(--on-surface-muted);margin-top:4px">
            ${esc(job.message || '准备中…')}
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span id="jobPct" style="font:500 20px/1 var(--font-sans);color:var(--primary);font-variant-numeric:tabular-nums">
            ${job.percent}%
          </span>
          <button class="btn btn--text btn--sm" id="btnCancelJob"
                  ${job.status === 'running' ? '' : 'hidden'}>取消</button>
        </div>
      </div>
      <div class="linear-progress" style="margin-top:var(--sp-4)">
        <i id="jobBar" style="width:${job.percent}%"></i>
      </div>
      <p style="margin-top:var(--sp-3);font:var(--text-caption);color:var(--on-surface-muted)">
        任务在后台运行，可以放心切到其它页面，顶栏会显示进度。
      </p>
    </div>

    <div class="section" style="margin-top:var(--sp-5)">
      <div class="section__head"><h2 class="section__title">实时日志</h2></div>
      <div class="transfer-log" id="jobLog" style="max-height:320px"></div>
    </div>

    <div id="jobDone" style="margin-top:var(--sp-4)" hidden></div>`);

  const body = root.querySelector('.view');
  const logEl = body.querySelector('#jobLog');
  const bar = body.querySelector('#jobBar');
  const pct = body.querySelector('#jobPct');
  const msg = body.querySelector('#jobMsg');
  const doneBox = body.querySelector('#jobDone');
  const cancelBtn = body.querySelector('#btnCancelJob');

  let shown = 0;
  const paintLogs = () => {
    if (job.logs.length === shown) return;
    logEl.innerHTML = job.logs
      .map((l) => `<div class="${l.level === 'ok' ? 'ok' : l.level === 'warn' ? 'miss' : ''}">${esc(l.text)}</div>`)
      .join('');
    logEl.scrollTop = logEl.scrollHeight;
    shown = job.logs.length;
  };

  const update = () => {
    bar.style.width = `${job.percent}%`;
    pct.textContent = `${job.percent}%`;
    msg.textContent = job.message || (job.status === 'running' ? '处理中…' : '');
    paintLogs();

    if (job.status !== 'running') {
      cancelBtn.hidden = true;
      if (!doneBox.dataset.shown) {
        doneBox.dataset.shown = '1';
        doneBox.hidden = false;
        const ok = job.status === 'done';
        doneBox.innerHTML = `
          <div class="card" style="display:flex;gap:var(--sp-4);align-items:center;flex-wrap:wrap">
            <div style="flex:1;min-width:200px">
              <div style="font:var(--text-h3)">${ok ? '迁移完成' : job.status === 'canceled' ? '已取消' : '迁移失败'}</div>
              <div style="color:var(--on-surface-muted);font-size:14px;margin-top:4px">
                ${ok ? `共 ${job.result?.count ?? 0} 首写入歌单` : esc(job.error || '')}
              </div>
            </div>
            ${ok && job.result?.playlistId
              ? `<a class="btn btn--filled" href="#/local/${job.result.playlistId}" data-link>${icon('play')} 打开歌单</a>`
              : ''}
            <button class="btn btn--text" id="btnAgain">再迁移一个</button>
          </div>`;
        doneBox.querySelector('#btnAgain')?.addEventListener('click', () => {
          state.step = 1;
          paintStep1(root);
        });
      }
    }
  };

  cancelBtn?.addEventListener('click', () => {
    job.cancel();
    cancelBtn.disabled = true;
    cancelBtn.textContent = '取消中…';
  });

  update();
  const off = jobs.on((changedJob) => {
    if (changedJob && changedJob.id !== job.id) return;
    update();
  });

  return () => off();
}

function paintDone(root) {
  const pl = state.created;
  shell(root, `
    <div class="card">
      <div style="font:var(--text-h3);margin-bottom:8px">迁移记录</div>
      <div style="color:var(--on-surface-muted);font-size:14px">
        歌单「${esc(pl?.name || '')}」已就绪，共 ${pl?.tracks?.length || 0} 首。
      </div>
      <div style="margin-top:var(--sp-4);display:flex;gap:var(--sp-2);flex-wrap:wrap">
        ${pl ? `<a class="btn btn--filled" href="#/local/${pl.id}" data-link>打开歌单</a>` : ''}
        <button class="btn btn--text" id="btnRestart">再迁移一个</button>
      </div>
    </div>`);
  root.querySelector('#btnRestart')?.addEventListener('click', () => {
    state.step = 1;
    state.created = null;
    paintStep1(root);
  });
}
