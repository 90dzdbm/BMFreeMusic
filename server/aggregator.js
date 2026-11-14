/**
 * aggregator.js — 第三方聚合音乐站适配（歌曲宝 / 下歌宝 / 歌曲海）
 *
 * 这类站点的共同套路：
 *   1. 搜索是 HTML 页面，需要正则解析
 *   2. 播放地址要先访问详情页拿一次性 play_id 与 Session Cookie，
 *      再 POST 到取址接口，两次请求必须在同一个会话里
 *
 * 因为它们把各平台的音频转存了一遍（多为酷我 CDN 的 128k mp3），
 * 所以会员曲目在这里往往能直接播 —— 这正好补上主音源的付费缺口。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/* --------------------------------------------------------------------------
   极简 Cookie Jar
   -------------------------------------------------------------------------- */
const jars = new Map();

function jarKey(url) {
  try { return new URL(url).hostname; } catch { return 'unknown'; }
}

function absorbCookies(url, setCookieList) {
  if (!setCookieList || !setCookieList.length) return;
  const host = jarKey(url);
  if (!jars.has(host)) jars.set(host, new Map());
  const jar = jars.get(host);
  for (const raw of setCookieList) {
    const [pair] = String(raw).split(';');
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  // 简单的容量控制
  if (jars.size > 40) {
    const first = jars.keys().next().value;
    if (first !== host) jars.delete(first);
  }
}

function cookieHeader(url) {
  const jar = jars.get(jarKey(url));
  if (!jar || !jar.size) return '';
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

/* --------------------------------------------------------------------------
   请求封装
   -------------------------------------------------------------------------- */
async function request(url, {
  method = 'GET',
  body = null,
  referer = '',
  extraHeaders = {},
  timeout = 15000,
} = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const headers = {
      'user-agent': UA,
      accept: 'text/html,application/json,*/*',
      'accept-language': 'zh-CN,zh;q=0.9',
      ...extraHeaders,
    };
    if (referer) headers.referer = referer;
    const cookie = cookieHeader(url);
    if (cookie) headers.cookie = cookie;
    if (body && !headers['content-type']) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
    }

    const res = await fetch(url, { method, headers, body: body || undefined, redirect: 'follow', signal: ctrl.signal });

    // Node 18+ 提供 getSetCookie，兜底解析原始头
    let setCookies = [];
    if (typeof res.headers.getSetCookie === 'function') setCookies = res.headers.getSetCookie();
    else {
      const raw = res.headers.get('set-cookie');
      if (raw) setCookies = raw.split(/,(?=[^;]+=[^;]+)/);
    }
    absorbCookies(url, setCookies);

    const text = await res.text();
    return { status: res.status, text, contentType: res.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

async function requestJSON(url, opts) {
  const r = await request(url, opts);
  try {
    return JSON.parse(r.text);
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------------
   工具
   -------------------------------------------------------------------------- */
function stripTags(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** "稻香 - 周杰伦" → { name, artist } */
function splitTitle(title) {
  const t = stripTags(title);
  const idx = t.lastIndexOf(' - ');
  if (idx > 0) return { name: cleanName(t.slice(0, idx)), artist: t.slice(idx + 3).trim() };
  const idx2 = t.lastIndexOf('－');
  if (idx2 > 0) return { name: cleanName(t.slice(0, idx2)), artist: t.slice(idx2 + 1).trim() };
  return { name: cleanName(t), artist: '未知歌手' };
}

/** 去掉聚合站标题里常见的前置编号，如 "160502河北墨麒麟" */
function cleanName(name) {
  return String(name || '')
    .replace(/^\d{5,}\s*(?=[\u4e00-\u9fa5])/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ==========================================================================
   歌曲宝 / 下歌宝（同一套 Laravel 模板）
   ========================================================================== */
function laravelSite(base) {
  return {
    base,
    displayBase: base.replace('https://', ''),

    async search(keyword, { limit = 30 } = {}) {
      const url = `${base}/s/${encodeURIComponent(keyword)}`;
      const r = await request(url, { referer: `${base}/` });
      if (r.status !== 200) throw new Error(`搜索页返回 ${r.status}`);

      const out = [];
      const seen = new Set();
      const re = /href="\/music\/(\d+)"[^>]*title="([^"]*)"/g;
      let m;
      while ((m = re.exec(r.text)) !== null) {
        const id = m[1];
        if (seen.has(id)) continue;
        seen.add(id);
        const { name, artist } = splitTitle(m[2]);
        if (!name) continue;
        out.push({ id, name, artist, album: '', duration: 0, cover: '' });
        if (out.length >= limit) break;
      }
      return out;
    },

    async resolve(id) {
      const detailUrl = `${base}/music/${id}`;
      const r = await request(detailUrl, { referer: `${base}/` });
      if (r.status !== 200) throw new Error(`详情页返回 ${r.status}`);

      const playId =
        (r.text.match(/\\u0022play_id\\u0022:\\u0022([^\\]+)\\u0022/) || [])[1] ||
        (r.text.match(/"play_id":"([^"]+)"/) || [])[1];
      if (!playId) throw new Error('未能从详情页解析出 play_id');

      const cover =
        (r.text.match(/\\u0022mp3_cover\\u0022:\\u0022([^\\]+)\\u0022/) || [])[1] ||
        (r.text.match(/"mp3_cover":"([^"]+)"/) || [])[1] || '';
      const duration = (r.text.match(/\\u0022mp3_duration\\u0022:\\u0022([^\\]+)\\u0022/) || [])[1] || '';

      const json = await requestJSON(`${base}/member/common-play-url`, {
        method: 'POST',
        body: `id=${encodeURIComponent(playId)}&purpose=play`,
        referer: detailUrl,
        extraHeaders: {
          origin: base,
          'x-requested-with': 'XMLHttpRequest',
          accept: 'application/json, text/javascript, */*; q=0.01',
        },
      });

      const url = json?.data?.url;
      if (!url) throw new Error(json?.msg || '取址接口未返回播放地址');

      return {
        url,
        cover: cover ? cover.replace(/\\\//g, '/').replace(/^http:/, 'https:') : '',
        duration: parseDuration(duration),
      };
    },
  };
}

function parseDuration(str) {
  const m = String(str || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return (Number(m[1]) * 60 + Number(m[2])) * 1000;
}

/* ==========================================================================
   歌曲海
   ========================================================================== */
const gequhai = {
  base: 'https://www.gequhai.com',
  displayBase: 'gequhai.com',

  async search(keyword, { limit = 30 } = {}) {
    const url = `${this.base}/search?s=${encodeURIComponent(keyword)}`;
    const r = await request(url, { referer: `${this.base}/` });
    if (r.status !== 200) throw new Error(`搜索页返回 ${r.status}`);

    const out = [];
    const seen = new Set();
    // 行结构：<a href="/play/326" ...> 晴天 </a></td><td ...>周杰伦</td>
    const re = /<a[^>]+href="\/play\/(\d+)"[^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
    let m;
    while ((m = re.exec(r.text)) !== null) {
      const id = m[1];
      if (seen.has(id)) continue;
      seen.add(id);
      const name = cleanName(stripTags(m[2]));
      const artist = stripTags(m[3]) || '未知歌手';
      if (!name) continue;
      out.push({ id, name, artist, album: '', duration: 0, cover: '' });
      if (out.length >= limit) break;
    }
    return out;
  },

  async resolve(id) {
    const detailUrl = `${this.base}/play/${id}`;
    const r = await request(detailUrl, { referer: `${this.base}/` });
    if (r.status !== 200) throw new Error(`播放页返回 ${r.status}`);

    const playId = (r.text.match(/play_id\s*=\s*'([^']+)'/) || [])[1];
    if (!playId) throw new Error('未能从播放页解析出 play_id');

    const cover = (r.text.match(/mp3_cover\s*=\s*'([^']*)'/) || [])[1] || '';
    const type = (r.text.match(/mp3_type\s*=\s*(\d+)/) || [])[1] || '0';

    const json = await requestJSON(`${this.base}/api/music`, {
      method: 'POST',
      body: `id=${encodeURIComponent(playId)}&type=${type}`,
      referer: detailUrl,
      extraHeaders: {
        origin: this.base,
        'x-requested-with': 'http',
        'x-custom-header': 'Key',
      },
    });

    if (json?.code !== 200 || !json?.data?.url) {
      throw new Error(json?.msg || '取址接口未返回播放地址');
    }
    return { url: json.data.url, cover };
  },
};

/* ==========================================================================
   导出
   ========================================================================== */
export const AGGREGATORS = {
  gequbao: laravelSite('https://www.gequbao.com'),
  xiagebao: laravelSite('https://www.xiagebao.com'),
  gequhai,
};

export const AGGREGATOR_KEYS = Object.keys(AGGREGATORS);

export async function aggrSearch(site, keyword, opts) {
  const impl = AGGREGATORS[site];
  if (!impl) throw new Error(`未知聚合站 ${site}`);
  return impl.search(keyword, opts);
}

export async function aggrResolve(site, id) {
  const impl = AGGREGATORS[site];
  if (!impl) throw new Error(`未知聚合站 ${site}`);
  return impl.resolve(id);
}
