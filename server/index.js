#!/usr/bin/env node
/**
 * BM Free Music — 本地服务
 *
 * 职责：
 *   1. 托管前端静态文件（无需构建）
 *   2. 反向代理音乐站接口（绕过浏览器 CORS / Referer 限制）
 *   3. 流式转发音频与图片（支持 Range，可拖动进度）
 *
 * 用法：
 *   node server/index.js            # 默认 http://127.0.0.1:5173
 *   PORT=8080 node server/index.js
 */

import http from 'node:http';
import https from 'node:https';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { exec } from 'node:child_process';
import { aggrSearch, aggrResolve, AGGREGATORS, AGGREGATOR_KEYS } from './aggregator.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolvePath(__dirname, '..');

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';
const OPEN_BROWSER = process.env.NO_OPEN !== '1';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/* --------------------------------------------------------------------------
   安全：阻止代理访问内网（本地网关的 SSRF 防护）
   -------------------------------------------------------------------------- */
const PRIVATE_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /^\[?fd[0-9a-f]{2}:/i,
  /^\[?fe80:/i,
];

function isPrivateHost(hostname) {
  const h = hostname.toLowerCase();
  return PRIVATE_PATTERNS.some((re) => re.test(h));
}

function assertSafeTarget(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('目标地址无效');
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('仅支持 http/https');
  if (isPrivateHost(u.hostname)) throw new Error('禁止访问内网地址');
  return u;
}

/* --------------------------------------------------------------------------
   请求上游
   -------------------------------------------------------------------------- */
function buildHeaders({ referer, cookie, headers = {}, extra = {} }) {
  const out = {
    'user-agent': UA,
    accept: '*/*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...extra,
  };
  if (referer) out.referer = referer;
  if (cookie) out.cookie = cookie;
  for (const [k, v] of Object.entries(headers || {})) {
    if (v === undefined || v === null) continue;
    out[k.toLowerCase()] = String(v);
  }
  // 去掉 hop-by-hop
  delete out['content-length'];
  delete out['accept-encoding'];
  return out;
}

async function upstream(target, opts) {
  const ctrl = new AbortController();
  const timeout = opts.timeout || 20000;
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(target, {
      method: opts.method || 'GET',
      headers: buildHeaders(opts),
      body: opts.body || undefined,
      redirect: 'follow',
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------------------------------------------------
   工具
   -------------------------------------------------------------------------- */
function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'access-control-allow-origin': '*',
  });
  res.end(text);
}

async function readBody(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/* --------------------------------------------------------------------------
   API 处理
   -------------------------------------------------------------------------- */
async function handleRaw(req, res) {
  const raw = await readBody(req);
  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    return sendJSON(res, 400, { ok: false, error: '请求体必须是 JSON' });
  }
  const { url, referer, cookie, method = 'GET', body = null, headers = {}, timeout } = payload;
  if (!url) return sendJSON(res, 400, { ok: false, error: '缺少 url' });

  let target;
  try {
    target = assertSafeTarget(url);
  } catch (e) {
    return sendJSON(res, 400, { ok: false, error: e.message });
  }

  try {
    const up = await upstream(target.href, { method, referer, cookie, body, headers, timeout });
    const buf = Buffer.from(await up.arrayBuffer());
    res.writeHead(up.status, {
      'content-type': up.headers.get('content-type') || 'text/plain; charset=utf-8',
      'content-length': buf.length,
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
      'x-upstream-status': String(up.status),
    });
    res.end(buf);
  } catch (e) {
    sendJSON(res, 502, { ok: false, error: `上游请求失败: ${e.message}` });
  }
}

async function handleStream(req, res, searchParams) {
  const target = searchParams.get('u');
  const referer = searchParams.get('ref') || '';
  if (!target) return sendText(res, 400, 'missing u');

  let safe;
  try {
    safe = assertSafeTarget(target);
  } catch (e) {
    return sendText(res, 400, e.message);
  }

  const headers = {};
  const range = req.headers.range;
  if (range) headers.range = range;

  try {
    const up = await upstream(safe.href, {
      method: 'GET',
      referer: referer || undefined,
      headers,
      timeout: 30000,
    });

    if (!up.ok && up.status !== 206) {
      // 上游 302 到 404 页之类，直接返回状态
      return sendText(res, up.status, `upstream ${up.status}`);
    }

    const outHeaders = {
      'content-type': up.headers.get('content-type') || 'audio/mpeg',
      'accept-ranges': 'bytes',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
      'cross-origin-resource-policy': 'cross-origin',
    };
    const len = up.headers.get('content-length');
    const cr = up.headers.get('content-range');
    if (len) outHeaders['content-length'] = len;
    if (cr) outHeaders['content-range'] = cr;

    res.writeHead(up.status, outHeaders);
    if (!up.body) return res.end();

    const body = Readable.fromWeb(up.body);
    body.on('error', () => { try { res.destroy(); } catch { /* noop */ } });
    res.on('close', () => {
      // 客户端提前断开：销毁源流，避免句柄泄漏（流已被 pipe 锁定，直接 destroy）
      try { body.destroy(); } catch { /* noop */ }
    });
    body.pipe(res);
  } catch (e) {
    if (!res.headersSent) sendText(res, 502, `stream failed: ${e.message}`);
    else res.destroy();
  }
}

const imgCache = new Map();

async function handleImage(req, res, searchParams) {
  const target = searchParams.get('u');
  const referer = searchParams.get('ref') || '';
  if (!target) return sendText(res, 400, 'missing u');

  const cacheKey = target + '|' + referer;
  const hit = imgCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 3600_000) {
    res.writeHead(200, {
      'content-type': hit.type,
      'cache-control': 'public, max-age=86400',
      'access-control-allow-origin': '*',
    });
    return res.end(hit.buf);
  }

  let safe;
  try {
    safe = assertSafeTarget(target);
  } catch (e) {
    return sendText(res, 400, e.message);
  }

  try {
    const up = await upstream(safe.href, { method: 'GET', referer: referer || undefined, timeout: 15000 });
    if (!up.ok) return sendText(res, up.status, 'upstream error');
    const buf = Buffer.from(await up.arrayBuffer());
    const type = up.headers.get('content-type') || 'image/jpeg';
    if (buf.length < 4 * 1024 * 1024) {
      if (imgCache.size > 400) imgCache.clear();
      imgCache.set(cacheKey, { buf, type, at: Date.now() });
    }
    res.writeHead(200, {
      'content-type': type,
      'content-length': buf.length,
      'cache-control': 'public, max-age=86400',
      'access-control-allow-origin': '*',
    });
    res.end(buf);
  } catch (e) {
    sendText(res, 502, `image failed: ${e.message}`);
  }
}

/* --------------------------------------------------------------------------
   静态文件
   -------------------------------------------------------------------------- */
async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  const filePath = resolvePath(join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, '')));
  if (!filePath.startsWith(ROOT)) return sendText(res, 403, 'forbidden');

  let stat;
  try {
    stat = statSync(filePath);
    if (stat.isDirectory()) {
      const idx = join(filePath, 'index.html');
      if (existsSync(idx)) return serveFile(req, res, idx);
      return sendText(res, 404, 'not found');
    }
  } catch {
    // SPA fallback：未知路径回落到 index.html（hash 路由用不到，但更稳）
    if (!extname(filePath)) return serveFile(req, res, join(ROOT, 'index.html'));
    return sendText(res, 404, 'not found');
  }
  return serveFile(req, res, filePath);
}

function serveFile(req, res, filePath) {
  const ext = extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const stat = statSync(filePath);

  const noCache = ['.html', '.webmanifest'].includes(ext);
  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'cache-control': noCache ? 'no-cache' : 'public, max-age=3600',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(filePath).pipe(res);
}

/* --------------------------------------------------------------------------
   主服务
   -------------------------------------------------------------------------- */
const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    });
    return res.end();
  }

  try {
    if (url.pathname === '/api/health') {
      return sendJSON(res, 200, {
        ok: true,
        app: 'BM Free Music',
        version: '1.0.0',
        node: process.version,
        uptime: Math.round(process.uptime()),
      });
    }
    if (url.pathname === '/api/raw') return await handleRaw(req, res);
    if (url.pathname === '/api/stream') return await handleStream(req, res, url.searchParams);
    if (url.pathname === '/api/img') return await handleImage(req, res, url.searchParams);

    /* ---- 聚合音乐站（歌曲宝 / 下歌宝 / 歌曲海） ---- */
    if (url.pathname === '/api/aggr/sites') {
      return sendJSON(res, 200, {
        ok: true,
        sites: AGGREGATOR_KEYS.map((k) => ({
          key: k,
          base: AGGREGATORS[k].base,
          name: AGGREGATORS[k].displayBase,
        })),
      });
    }

    if (url.pathname === '/api/aggr/search') {
      const site = url.searchParams.get('site');
      const kw = url.searchParams.get('kw');
      const limit = Math.min(Number(url.searchParams.get('limit')) || 30, 60);
      if (!site || !kw) return sendJSON(res, 400, { ok: false, error: '缺少 site 或 kw' });
      try {
        const list = await aggrSearch(site, kw, { limit });
        return sendJSON(res, 200, { ok: true, site, list });
      } catch (e) {
        return sendJSON(res, 502, { ok: false, site, error: e.message });
      }
    }

    if (url.pathname === '/api/aggr/play') {
      const site = url.searchParams.get('site');
      const id = url.searchParams.get('id');
      if (!site || !id) return sendJSON(res, 400, { ok: false, error: '缺少 site 或 id' });
      try {
        const data = await aggrResolve(site, id);
        return sendJSON(res, 200, { ok: true, site, ...data });
      } catch (e) {
        return sendJSON(res, 502, { ok: false, site, error: e.message });
      }
    }

    if (url.pathname.startsWith('/api/')) return sendJSON(res, 404, { ok: false, error: 'unknown endpoint' });

    return await serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error('[server]', e);
    if (!res.headersSent) sendText(res, 500, 'internal error');
    else res.destroy();
  } finally {
    if (process.env.LOG === '1') {
      console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  }
});

function openBrowser(target) {
  const cmd = process.platform === 'win32'
    ? `start "" "${target}"`
    : process.platform === 'darwin'
      ? `open "${target}"`
      : `xdg-open "${target}"`;
  exec(cmd, () => { /* 忽略打开失败 */ });
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  端口 ${PORT} 已被占用，尝试 ${PORT + 1} ...\n`);
    server.listen(PORT + 1, HOST);
  } else {
    console.error(e);
    process.exit(1);
  }
});

// 本地小服务：单个请求的意外错误不应带走整个进程
process.on('uncaughtException', (e) => {
  console.error('[uncaught]', e?.message || e);
});
process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', e?.message || e);
});

server.listen(PORT, HOST, () => {
  const addr = server.address();
  const url = `http://${HOST}:${addr.port}`;
  console.log('');
  console.log('  ╭──────────────────────────────────────────╮');
  console.log('  │   BM Free Music · 多平台聚合音乐播放器    │');
  console.log('  ╰──────────────────────────────────────────╯');
  console.log(`   本地地址 : ${url}`);
  console.log(`   静态目录 : ${ROOT}`);
  console.log(`   代理接口 : ${url}/api/health`);
  console.log('');
  console.log('   按 Ctrl+C 停止服务');
  console.log('');
  if (OPEN_BROWSER && !process.env.NO_OPEN) openBrowser(url);
});
