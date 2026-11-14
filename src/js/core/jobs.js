/**
 * jobs.js — 后台任务中心
 *
 * 歌单迁移、可用性体检这类「一跑就是几分钟」的活放到这里，
 * 用户切到别的页面也继续跑，顶栏实时显示进度，随时可以取消。
 */

let seq = 0;

export class Job {
  constructor({ type, title, total = 0 }) {
    this.id = `job_${++seq}_${Date.now().toString(36)}`;
    this.type = type;              // transfer | check
    this.title = title;
    this.total = total;
    this.done = 0;
    this.status = 'running';       // running | done | error | canceled
    this.message = '';
    this.result = null;
    this.error = '';
    this.logs = [];
    this.startedAt = Date.now();
    this.finishedAt = 0;
    this._canceled = false;
  }

  get canceled() {
    return this._canceled;
  }

  get percent() {
    if (!this.total) return 0;
    return Math.min(100, Math.round((this.done / this.total) * 100));
  }

  get duration() {
    return (this.finishedAt || Date.now()) - this.startedAt;
  }

  log(text, level = 'info') {
    this.logs.push({ text, level, at: Date.now() });
    if (this.logs.length > 400) this.logs.shift();
    jobs.changed(this);
    return this;
  }

  progress(done, message) {
    if (typeof done === 'number') this.done = done;
    if (message !== undefined) this.message = message;
    jobs.changed(this);
    return this;
  }

  step(message) {
    this.done += 1;
    if (message) this.message = message;
    jobs.changed(this);
    return this;
  }

  finish(result = null) {
    if (this.status !== 'running') return this;
    this.status = this._canceled ? 'canceled' : 'done';
    this.done = this.total || this.done;
    this.result = result;
    this.finishedAt = Date.now();
    this.message = this.status === 'canceled' ? '已取消' : (this.message || '已完成');
    jobs.changed(this);
    return this;
  }

  fail(err) {
    if (this.status !== 'running') return this;
    this.status = 'error';
    this.error = err?.message || String(err);
    this.finishedAt = Date.now();
    this.message = this.error;
    jobs.changed(this);
    return this;
  }

  cancel() {
    this._canceled = true;
    this.log('收到取消请求，收尾中…', 'warn');
    jobs.changed(this);
    return this;
  }
}

class JobCenter {
  constructor() {
    this.jobs = [];
    this._listeners = new Set();
  }

  create(type, title, total = 0) {
    const job = new Job({ type, title, total });
    this.jobs.unshift(job);
    if (this.jobs.length > 40) this.jobs.length = 40;
    this.changed(job);
    return job;
  }

  changed(job) {
    this._listeners.forEach((fn) => {
      try { fn(job, this); } catch (e) { console.error('[jobs]', e); }
    });
  }

  on(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  get running() {
    return this.jobs.filter((j) => j.status === 'running');
  }

  get latestRunning() {
    return this.running[0] || null;
  }

  byId(id) {
    return this.jobs.find((j) => j.id === id) || null;
  }

  clearFinished() {
    this.jobs = this.jobs.filter((j) => j.status === 'running');
    this.changed(null);
  }
}

export const jobs = new JobCenter();
