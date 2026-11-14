/**
 * gateway.js — 统一的 HTTP 网关
 *
 * 浏览器直连音乐站会被 CORS 与 Referer 校验拦下，因此所有上游请求都交给
 * 本地服务端（server/index.js）转发：
 *   POST /api/raw     { url, referer, cookie, method, body, headers }  → 原始响应
 *   GET  /api/stream  ?u=...&ref=...                                    → 音频流（支持 Range）
 *   GET  /api/img     ?u=...&ref=...                                    → 图片流
 *
 * 若用户在设置里配置了第三方 API 实例（如自建 NeteaseCloudMusicApi），
 * 也可以把它当作 apiBase 走直连。
 */

import { store } from '../core/store.js';

function prefix() {
  return (store.settings.proxyPrefix || '/api').replace(/\/$/, '');
}

/** 宽松 JSON 解析（酷我等老接口返回单引号对象） */
export function looseJSON(text) {
  const src = String(text || '').trim();
  if (!src) return null;
  try {
    return JSON.parse(src);
  } catch { /* 继续尝试修复 */ }

  const fixed = src
    .replace(/^\s*[a-zA-Z_$][\w$.]*\s*\(/, '')
    .replace(/\)\s*;?\s*$/, '')
    .replace(/([{,]\s*)'([^'\\]*(?:\\.[^'\\]*)*)'(\s*:)/g, (m, a, b, c) => `${a}"${b.replace(/"/g, '\\"')}"${c}`)
    .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (m, b) => `:"${b.replace(/"/g, '\\"')}"`)
    .replace(/&nbsp;/g, ' ')
    .replace(/\\'/g, "'");

  try {
    return JSON.parse(fixed);
  } catch {
    try {
      // 最后手段：用 Function 求值（仅本地可信数据流，加沙箱限制）
      // eslint-disable-next-line no-new-func
      return new Function(`"use strict";return (${fixed});`)();
    } catch {
      return null;
    }
  }
}

/**
 * 通过本地代理请求上游，返回 { status, contentType, text }
 */
export async function proxyFetch(target, opts = {}) {
  const { referer = '', cookie = '', method = 'GET', body = null, headers = {}, timeout = 15000 } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${prefix()}/raw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: target, referer, cookie, method, body, headers }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    return {
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      text,
      ok: res.ok,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 请求并解析 JSON（自动处理 JSONP / 宽松格式） */
export async function proxyJSON(target, opts = {}) {
  const r = await proxyFetch(target, opts);
  if (!r.text) throw new Error(`空响应 (HTTP ${r.status})`);
  let data;
  try {
    data = JSON.parse(r.text);
  } catch {
    data = looseJSON(r.text);
  }
  if (data === null) throw new Error(`无法解析响应 (HTTP ${r.status})`);
  return data;
}

/** 把上游 URL 包成可被 <audio> 直接播放的同源地址 */
export function streamUrl(target, referer = '') {
  if (!target) return '';
  const q = new URLSearchParams({ u: target });
  if (referer) q.set('ref', referer);
  return `${prefix()}/stream?${q.toString()}`;
}

/** 把上游图片包成同源地址 */
export function imgUrl(target, referer = '') {
  if (!target) return '';
  if (target.startsWith('data:') || target.startsWith('blob:')) return target;
  const q = new URLSearchParams({ u: target });
  if (referer) q.set('ref', referer);
  return `${prefix()}/img?${q.toString()}`;
}

/** 直接请求第三方 API 实例（设置里配置的 apiBase） */
export async function apiFetch(base, path, opts = {}) {
  const clean = base.replace(/\/$/, '');
  const url = `${clean}${path}`;
  return proxyJSON(url, { timeout: 12000, ...opts });
}

/** 直接请求本地服务自己的扩展端点（聚合站适配等） */
export async function localAPI(path, params = {}, timeout = 20000) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, v);
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${prefix()}${path}?${q.toString()}`, { signal: ctrl.signal });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: `响应解析失败 (HTTP ${res.status})` };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

/** 检测本地代理是否可用 */
export async function pingProxy() {
  try {
    const res = await fetch(`${prefix()}/health`, { method: 'GET' });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.ok;
  } catch {
    return false;
  }
}
