/**
 * ui/taskbar.js — 屏幕顶部的任务进度条
 *
 * 有任务在跑时，这条窄条常驻屏幕最上方，显示任务名和进度。
 * 任务完成后条上会闪一下「已完成」，停留一秒再收起。
 *
 * 不用 jobs 中心也能用，可以直接 push 一个临时任务：
 *   const t = taskbar.push('正在下载', { indeterminate: true });
 *   t.progress(40); t.setLabel('正在下载 40%'); t.done();
 */

import { jobs } from '../core/jobs.js';

let el = null;
let fill = null;
let label = null;
let sub = null;
let hideTimer = null;
let current = null;
let flashDone = false;

/** 当前临时任务（不经过 jobs 中心的） */
class TempTask {
  constructor(title, opts = {}) {
    this.title = title;
    this.percent = opts.percent ?? 0;
    this.indeterminate = !!opts.indeterminate;
    this.message = opts.message || '';
    this.done_ = false;
  }
  progress(p, msg) {
    this.percent = Math.max(0, Math.min(100, Math.round(p)));
    if (msg !== undefined) this.message = msg;
    paint();
    return this;
  }
  setLabel(text) {
    this.title = text;
    paint();
    return this;
  }
  setMessage(msg) {
    this.message = msg;
    paint();
    return this;
  }
  done(text = '已完成') {
    this.done_ = true;
    this.title = text;
    this.percent = 100;
    this.indeterminate = false;
    paint(true);
    return this;
  }
  fail(text = '失败') {
    this.done_ = true;
    this.title = text;
    this.indeterminate = false;
    paint(true);
    return this;
  }
}

function ensure() {
  if (el) return;
  el = document.createElement('div');
  el.className = 'taskbar';
  el.id = 'taskbar';
  el.innerHTML = `
    <div class="taskbar__bar"><i class="taskbar__fill"></i></div>
    <div class="taskbar__text">
      <span class="taskbar__label"></span>
      <span class="taskbar__sub"></span>
    </div>`;
  fill = el.querySelector('.taskbar__fill');
  label = el.querySelector('.taskbar__label');
  sub = el.querySelector('.taskbar__sub');

  // 放在 .app 的最前面 —— 它是 flex 列的第一个子元素，
  // 会把顶栏整体往下推，所以永远不可能和搜索栏重叠。
  // （之前是 position:fixed; top:0，结果直接盖在顶栏上）
  const app = document.querySelector('.app');
  if (app) app.insertBefore(el, app.firstChild);
  else document.body.insertBefore(el, document.body.firstChild);
}

/** 刷新显示 */
function paint(flash = false) {
  ensure();
  const info = current ? describe(current) : null;

  if (!info) {
    el.classList.remove('is-visible');
    el.classList.remove('is-done');
    return;
  }

  el.classList.add('is-visible');
  el.classList.toggle('is-done', !!info.done);
  el.classList.toggle('is-indeterminate', !!info.indeterminate);

  fill.style.width = info.indeterminate ? '100%' : info.percent + '%';
  label.textContent = info.title;
  sub.textContent = info.message || '';

  if (flash) {
    // 完成后停留一秒再收起
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      current = null;
      flashDone = false;
      paint();
    }, 1000);
  }
}

function describe(t) {
  if (t instanceof TempTask) {
    return {
      title: t.title,
      message: t.message,
      percent: t.percent,
      indeterminate: t.indeterminate,
      done: t.done_,
    };
  }
  // jobs 里的任务
  return {
    title: t.title,
    message: t.message || '',
    percent: t.percent,
    indeterminate: false,
    done: t.status !== 'running',
  };
}

/** 挑出当前该显示的任务：临时任务优先，否则用最新的运行中任务 */
function pick() {
  if (current instanceof TempTask) return current;
  const running = jobs.running;
  if (!running.length) return null;
  return running[0];
}

export const taskbar = {
  /** 注册临时任务 */
  push(title, opts) {
    clearTimeout(hideTimer);
    current = new TempTask(title, opts);
    paint();
    return current;
  },

  /** 结束当前临时任务 */
  end(text = '已完成') {
    if (current instanceof TempTask) current.done(text);
    else {
      current = null;
      paint();
    }
  },

  /** 从 jobs 中心同步 */
  sync() {
    if (current instanceof TempTask) { paint(); return; }

    const running = jobs.running;
    const next = running[0] || null;

    if (next) {
      current = next;
      flashDone = false;
      paint();
      return;
    }

    // 没有运行中的任务了
    if (current && current.status !== 'running' && !flashDone) {
      // 刚刚完成：闪一下再收
      flashDone = true;
      paint(true);
      return;
    }
    if (!current || (current.status !== 'running' && flashDone)) {
      // 停留期结束后清掉
      if (!hideTimer) { current = null; paint(); }
    }
  },

  init() {
    ensure();
    jobs.on(() => this.sync());
    this.sync();
  },
};
