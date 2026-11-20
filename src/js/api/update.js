/**
 * api/update.js — 启动检查更新
 *
 * 流程：
 *   1. 依次请求公共 GitHub 加速代理去取 latest.json（境内直连 raw 基本不通）
 *   2. 全挂了再试直连
 *   3. 比对 versionCode，有新版就弹窗
 *   4. 用户确认后下载 APK 并拉起安装器
 *   5. 下载结束即释放连接，不再占用代理
 */

import { store } from '../core/store.js';
import { toast, toastError } from '../ui/toast.js';
import { openDialog, closeDialog } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { taskbar } from '../ui/taskbar.js';

const REPO = '90dzdbm/BMFreeMusic';
const BRANCH = 'main';
const RAW_URL = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/latest.json`;
const FALLBACK_URL = `https://github.com/${REPO}/raw/${BRANCH}/latest.json`;

/**
 * 公共 GitHub 加速代理，按本机实测可用性排序。
 * 2026-11-20 实测：
 *   gh-proxy.com  raw 200 且带 CORS 头，最稳，放第一个
 *   ghproxy.cn    能通但有时返回 HTML 错误页（靠 JSON.parse 兜掉）
 *   ghfast.top / ghproxy.cc / ghproxy.net 时通时不通
 */
const PROXIES = [
  'https://gh-proxy.com/',
  'https://ghproxy.cn/',
  'https://ghfast.top/',
  'https://ghproxy.cc/',
  'https://ghproxy.net/',
];

const CURRENT_CODE = 140;
const CURRENT_NAME = '1.4.0';

/* ------------------------------------------------------------------ */

async function fetchJSON(url, timeout = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 先探一下代理本身通不通（HEAD 一下代理根路径），通不过就不浪费时间去取文件。
 * 境内直连 GitHub 基本靠不住，所以顺序是：代理 -> 直连 raw -> github raw。
 */
async function pingProxy(base, timeout = 4000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(base, {
      method: 'HEAD',
      signal: ctrl.signal,
      cache: 'no-store',
      mode: 'cors',
    });
    // 405/403 也说明域名可达，代理只是不接受这个方法
    return res.status < 500 || res.status === 405;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 逐个尝试代理，返回 { data, base, via } */
async function fetchLatest(onStep) {
  for (const p of PROXIES) {
    try {
      if (onStep) onStep(`正在连接加速代理 ${p.replace('https://', '').replace(/\/$/, '')}`);
      // 先探连通性，不通就立刻换下一个
      if (!(await pingProxy(p))) continue;
      const data = await fetchJSON(p + RAW_URL, 6000);
      if (data && data.version) return { data, base: p, via: 'proxy' };
    } catch { /* 换下一个代理 */ }
  }
  try {
    if (onStep) onStep('代理不可用，尝试直连 GitHub');
    const data = await fetchJSON(RAW_URL, 8000);
    if (data && data.version) return { data, base: '', via: 'direct' };
  } catch { /* 继续 */ }
  try {
    if (onStep) onStep('尝试备用地址');
    const data = await fetchJSON(FALLBACK_URL, 8000);
    if (data && data.version) return { data, base: '', via: 'gh' };
  } catch { /* 全挂 */ }
  return null;
}

function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/**
 * GitHub 连不上：告诉用户开加速器，并给出手动下载入口。
 * 境内直连 GitHub 经常失败，这是最常见的情况，要说清楚。
 */
function showGithubUnreachable() {
  const repoUrl = `https://github.com/${REPO}/releases`;
  openDialog({
    title: '无法连接 GitHub',
    width: 460,
    bodyHTML: `
      <div class="update-dialog">
        <div class="update-dialog__notes">
          <p>检查更新需要访问 GitHub，当前网络无法连通（境内直连 GitHub 经常被限速或阻断）。</p>
          <p>解决办法：</p>
          <p>1. 开启加速器 / 换用可访问 GitHub 的网络；</p>
          <p>2. 也可以直接手动下载安装：</p>
        </div>
        <div class="update-dialog__row">
          <a class="btn btn--outline btn--sm" href="${repoUrl}" target="_blank" rel="noreferrer">打开 Releases 页面</a>
          <a class="btn btn--text btn--sm" href="https://github.com/${REPO}" target="_blank" rel="noreferrer">打开项目主页</a>
        </div>
      </div>`,
    actions: [{ label: '知道了' }],
  });
}

/* ------------------------------------------------------------------ */

export async function checkUpdate({ silent = true, onStep } = {}) {
  let hit;
  try {
    hit = await fetchLatest(onStep);
  } catch {
    hit = null;
  }

  if (!hit) {
    if (!silent) toast('检查更新失败，请稍后再试');
    else showGithubUnreachable();
    return null;
  }

  const { data, base } = hit;
  const remoteCode = Number(data.versionCode || 0);
  const remoteName = String(data.version || '0');

  const newer = remoteCode
    ? remoteCode > CURRENT_CODE
    : cmpVersion(remoteName, CURRENT_NAME) > 0;

  if (!newer) {
    if (!silent) toast(`已是最新版本 v${CURRENT_NAME}`);
    return null;
  }

  showUpdateDialog(data, base);
  return data;
}

function showUpdateDialog(data, base) {
  const notes = String(data.notes || '').trim();
  const sizeMB = data.size ? (data.size / 1048576).toFixed(1) + ' MB' : '';

  const body = `
    <div class="update-dialog">
      <div class="update-dialog__row">
        <span class="update-dialog__badge">v${escapeHtml(data.version)}</span>
        <span class="update-dialog__meta">当前 v${CURRENT_NAME}${sizeMB ? ' · ' + sizeMB : ''}</span>
      </div>
      ${notes ? `<div class="update-dialog__notes">${notes.split('\n').map(l => `<p>${escapeHtml(l)}</p>`).join('')}</div>` : ''}
    </div>`;

  openDialog({
    title: '发现新版本',
    bodyHTML: body,
    width: 480,
    actions: [
      { label: '以后再说', variant: 'text', onClick: () => closeDialog() },
      {
        label: '立即更新',
        variant: 'filled',
        onClick: () => {
          closeDialog();
          startDownload(data, base);
        },
      },
    ],
  });
}

/* ------------------------------------------------------------------ */

function startDownload(data, base) {
  let url = String(data.apk || '').trim();
  if (!url) {
    toastError('更新地址缺失');
    return;
  }
  // 走同一个代理，避免直连 GitHub Releases 超时
  if (base && !/^https?:\/\/gh/.test(url)) url = base + url;

  const filename = `BMFreeMusic-${data.version}.apk`;

  if (window.BMFMAndroid?.updateApk) {
    toast('开始下载更新…');
    window.__bmfmUpdateTask = taskbar.push('正在下载更新', { percent: 0, message: filename });
    window.BMFMAndroid.updateApk(url, filename);
    return;
  }

  // 网页环境：交给浏览器
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/* ------------------------------------------------------------------ */

/** 启动时调用：有缓存就不重复请求（12 小时内一次） */
export function initUpdateCheck() {
  const last = store.settings.lastUpdateCheck || 0;
  if (Date.now() - last < 12 * 3600 * 1000) return;
  setTimeout(() => {
    const t = taskbar.push('正在检查更新', { indeterminate: true });
    checkUpdate({
      silent: true,
      onStep: (msg) => t.setMessage(msg),
    }).then((r) => {
      if (r) {
        store.setSettings({ lastUpdateCheck: Date.now() });
        t.done('检查到新版本');
      } else {
        t.done('已是最新版本');
      }
    }).catch(() => {
      t.fail('检查更新失败');
    });
  }, 2600);
}
