/**
 * api/wiki.js — 歌手简介
 *
 * 单一数据源：百度百科开放接口。
 * 维基百科在境内网络不可达（zh/en/wikidata/镜像全部超时），
 * 留着只会让每次查简介先白等 9 秒，直接砍掉。
 */

import { proxyJSON } from './gateway.js';
import { stripHTML } from '../core/util.js';

const cache = new Map();

/**
 * @returns {Promise<{title,extract,description,thumb,url,fields,source}|null>}
 */
export async function getArtistBio(rawName) {
  const name = String(rawName || '').split('/')[0].trim();
  if (!name) return null;
  if (cache.has(name)) return cache.get(name);

  const bio = await baiduBio(name);
  cache.set(name, bio);
  return bio;
}

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
