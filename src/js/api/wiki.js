/**
 * api/wiki.js — 歌手简介
 *
 * 主源：维基百科（zh / en）
 * 兜底：百度百科（国内网络可达，结构化字段更全）
 */

import { proxyJSON } from './gateway.js';
import { stripHTML } from '../core/util.js';

const cache = new Map();

const WIKI_HOSTS = [
  'https://zh.wikipedia.org',
  'https://zh.wikipedia.org',   // 重试一次，网络抖动时有用
];

/**
 * @returns {Promise<{title,extract,description,thumb,url,fields,source}|null>}
 */
export async function getArtistBio(rawName) {
  const name = String(rawName || '').split('/')[0].trim();
  if (!name) return null;
  if (cache.has(name)) return cache.get(name);

  let bio = await wikiBio(name);
  if (!bio) bio = await baiduBio(name);

  cache.set(name, bio);
  return bio;
}

/* --------------------------------------------------------------------------
   维基百科
   -------------------------------------------------------------------------- */
async function wikiBio(name) {
  for (const host of WIKI_HOSTS) {
    const hit = await wikiSummary(host, 'zh', name);
    if (hit) return hit;
  }
  // 中文没有词条时试英文
  return wikiSummary('https://en.wikipedia.org', 'en', name);
}

async function wikiSummary(host, lang, title) {
  try {
    const url = `${host}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;
    const data = await proxyJSON(url, {
      headers: { accept: 'application/json' },
      timeout: 9000,
    });
    if (!data?.extract || data.type === 'disambiguation') return null;
    return {
      title: data.title || title,
      extract: data.extract,
      description: data.description || '',
      thumb: data.thumbnail?.source || '',
      url: data.content_urls?.desktop?.page ||
        `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(data.title || title)}`,
      fields: [],
      source: lang === 'zh' ? '维基百科' : 'Wikipedia',
    };
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------------
   百度百科（兜底）
   -------------------------------------------------------------------------- */
async function baiduBio(name) {
  try {
    const url = 'https://baike.baidu.com/api/openapi/BaikeLemmaCardApi' +
      `?scope=103&format=json&appid=379020&bk_key=${encodeURIComponent(name)}&bk_length=600`;
    const data = await proxyJSON(url, { timeout: 12000 });
    if (!data || data.errno || !data.key) return null;

    const fields = [];
    for (const c of data.card || []) {
      const value = stripHTML((c.format && c.format.length ? c.format : c.value || []).join('、'));
      if (!value || !c.name) continue;
      if (/^展开$/.test(c.name)) continue;
      fields.push({ label: stripHTML(c.name), value });
      if (fields.length >= 8) break;
    }

    if (!data.desc && !fields.length) return null;

    return {
      title: data.title || data.key,
      extract: data.desc || '',
      description: '',
      thumb: '',
      url: `https://baike.baidu.com/item/${encodeURIComponent(data.key)}`,
      fields,
      source: '百度百科',
    };
  } catch {
    return null;
  }
}
