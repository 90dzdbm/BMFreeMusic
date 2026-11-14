/**
 * util.js — 零依赖小工具
 */

/** 毫秒 → m:ss */
export function fmtTime(ms) {
  if (!ms || !isFinite(ms) || ms < 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 秒或毫秒自适应 */
export function fmtDuration(d) {
  if (!d) return '0:00';
  return fmtTime(d > 10000 ? d : d * 1000);
}

/** 唯一 id */
export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** HTML 转义 */
export function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** HTML 实体解码（B 站等接口会返回 &quot; 之类的转义） */
export function decodeEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

/** 去标签 + 解码实体 */
export function stripHTML(s) {
  return decodeEntities(String(s || '').replace(/<[^>]*>/g, '')).trim();
}

/** 防抖 */
export function debounce(fn, wait = 260) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

/** 节流 */
export function throttle(fn, wait = 120) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const now = Date.now();
    const remain = wait - (now - last);
    if (remain <= 0) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn(...args);
      }, remain);
    }
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 并发受限 map */
export async function pMap(items, mapper, limit = 5) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        out[i] = await mapper(items[i], i);
      } catch (e) {
        out[i] = { __error: e };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

/** 带超时的 fetch JSON */
export async function fetchJSON(url, opts = {}, timeout = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text) return null;
    // 兼容 JSONP 风格的裸回调包装
    const cleaned = text.trim().replace(/^[a-zA-Z_$][\w$.]*\s*\(/, '').replace(/\)\s*;?$/, '');
    try {
      return JSON.parse(cleaned);
    } catch {
      return JSON.parse(text);
    }
  } finally {
    clearTimeout(t);
  }
}

/** 构造查询串 */
export function qs(params) {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') u.set(k, v);
  });
  return u.toString();
}

/** 频率归一化 */
export function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[()[\]【】「」《》<>~～!！?？,，.。·'"`]/g, '')
    .replace(/&/g, 'and');
}

/** 相似度（0~1），用于歌单迁移匹配 */
export function similarity(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;

  const grams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const gx = grams(x);
  const gy = grams(y);
  if (!gx.size || !gy.size) return 0;
  let inter = 0;
  gx.forEach((g) => { if (gy.has(g)) inter++; });
  return (2 * inter) / (gx.size + gy.size);
}

/**
 * 从任意文本里抠出一个 URL
 * 分享文案经常是「分享xxx的单曲《歌名》: https://... （来自@网易云音乐）」这种，
 * 直接 new URL 整段文本必然失败，得先把链接摘出来。
 */
export function extractUrl(text) {
  const src = String(text || '');

  // 1. 带协议的链接
  const re = /https?:\/\/[^\s<>"'`]+/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    const cleaned = trimUrlTail(m[0]);
    if (cleaned) return cleaned;
  }

  // 2. 不带协议的域名
  const re2 = /(?:www\.)?[a-z0-9-]+\.(?:com|cn|net|cc|top|xyz|vip|io)\/[^\s<>"'`]*/i;
  const m2 = src.match(re2);
  if (m2) return trimUrlTail(m2[0]);

  return null;
}

/** 去掉 URL 末尾粘上来的中文和标点，直到能被 URL 解析为止 */
function trimUrlTail(raw) {
  let s = String(raw).replace(/[)\]）】》」』，,。；;：:！!？?"'、]+$/g, '');
  while (s.length > 10) {
    try {
      const u = new URL(/^https?:/i.test(s) ? s : `https://${s}`);
      return u.href;
    } catch {
      s = s.slice(0, -1);
    }
  }
  return null;
}

/** 从 URL 里同时读 query 和 hash 里的 query（网易云是 #/playlist?id=xxx 结构） */
function queriesOf(url) {
  const search = url.searchParams;
  let hashQuery = new URLSearchParams();
  let hashPath = '';
  if (url.hash && url.hash.length > 1) {
    const h = url.hash.slice(1);
    const qi = h.indexOf('?');
    if (qi >= 0) {
      hashPath = h.slice(0, qi);
      hashQuery = new URLSearchParams(h.slice(qi + 1));
    } else {
      hashPath = h;
    }
  }
  const get = (k) => search.get(k) || hashQuery.get(k) || null;
  return { search, hashQuery, hashPath, get };
}

/** 从任意歌单链接（含分享文案、中文、hash 路由）中抽取平台与 id */
export function parsePlaylistUrl(raw) {
  const input = String(raw || '').trim();
  if (!input) return null;

  // 纯数字 / 裸 id
  if (/^\d{4,}$/.test(input)) return { source: 'netease', id: input };
  if (/^[A-Za-z0-9]{8,}$/.test(input) && !input.includes('.')) {
    // QQ 歌单有时是纯字母数字的 disstid
    return { source: 'qq', id: input };
  }

  // 平台:ID 简写
  const bare = input.match(/^(netease|qq|kugou|kuwo|migu|bilibili)\s*[:：/]\s*(\S+)$/i);
  if (bare) return { source: bare[1].toLowerCase(), id: bare[2].trim() };

  // 从分享文案里抠链接
  const candidate = extractUrl(input) || input;

  let url;
  try {
    url = new URL(/^https?:/i.test(candidate) ? candidate : `https://${candidate}`);
  } catch {
    // 兜底：整段文字里只有一个 4 位以上数字时当作网易云歌单 id
    const nums = input.match(/\d{4,}/g);
    if (nums && nums.length === 1) return { source: 'netease', id: nums[0] };
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');
  const p = decodeURIComponent(url.pathname || '');
  const { hashPath, get } = queriesOf(url);
  const hp = decodeURIComponent(hashPath || '');
  const allPath = `${p} ${hp}`.trim();
  const ID = '([A-Za-z0-9\\u4e00-\\u9fa5_-]+)';   // 允许中文，避免带中文的分享链接直接解析失败

  // 网易云
  if (host.endsWith('music.163.com')) {
    const songId = get('id') && /\/song(\/|\?|$)/.test(allPath) ? get('id') : null;
    if (songId) return { source: 'netease', id: songId, type: 'song' };

    const id = get('id') ||
      (allPath.match(/\/playlist\/(\d+)/) || [])[1] ||
      (allPath.match(/\/discover\/toplist\/(\d+)/) || [])[1] ||
      (allPath.match(/\/toplist\/(\d+)/) || [])[1];
    if (id) return { source: 'netease', id };
  }

  // QQ 音乐
  if (host.endsWith('y.qq.com') || host.endsWith('i.y.qq.com') || host.endsWith('c6.y.qq.com')) {
    const id = get('id') || get('dissid') ||
      (allPath.match(new RegExp('/playsquare/' + ID)) || [])[1] ||
      (allPath.match(new RegExp('/taoge/' + ID)) || [])[1] ||
      (allPath.match(new RegExp('/playlist/' + ID)) || [])[1];
    if (id) return { source: 'qq', id };
  }

  // 酷狗
  if (host.endsWith('kugou.com')) {
    const id = get('specialid') || get('id') ||
      (allPath.match(new RegExp('/(?:special|plist)/(?:single|list)/' + ID)) || [])[1] ||
      (allPath.match(new RegExp('/songlist/' + ID)) || [])[1];
    if (id) return { source: 'kugou', id, raw: input };
  }

  // 酷我
  if (host.endsWith('kuwo.cn')) {
    const id = get('pid') || get('id') ||
      (allPath.match(/\/playlist_detail\/(\d+)/) || [])[1];
    if (id) return { source: 'kuwo', id };
  }

  // 咪咕
  if (host.endsWith('music.migu.cn')) {
    const id = (allPath.match(/\/v3\/music\/playlist\/(\d+)/) || [])[1] || get('id');
    if (id) return { source: 'migu', id };
  }

  // B 站
  if (host.endsWith('bilibili.com')) {
    const id = get('fid') || get('sid') || (allPath.match(new RegExp('/' + ID + '/?$')) || [])[1];
    return { source: 'bilibili', id, raw: input };
  }

  return { source: 'unknown', raw: input };
}

/** 颜色工具：从图片 URL 提取主色调（用 canvas，失败回退） */
export function dominantColor(imgUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        const size = 32;
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha < 128) continue;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
        if (!n) return resolve(null);
        resolve(`rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imgUrl;
  });
}

/** 安全下载文本 */
export function download(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
