/**
 * sources.js — 各音乐平台的适配层
 *
 * 统一 Track 模型：
 * {
 *   key:      "netease:123456"      唯一键
 *   id:       "123456"              平台内 id / hash / songmid
 *   source:   "netease"
 *   name:     "歌名"
 *   artist:   "歌手 A / 歌手 B"
 *   album:    "专辑名"
 *   duration: 213000                毫秒
 *   cover:    "https://..."         封面（可能为空）
 *   extra:    { ... }               平台私有字段
 * }
 */

import { proxyJSON, proxyFetch, streamUrl, imgUrl, looseJSON, localAPI } from './gateway.js';
import { store, SOURCES, AGG_SOURCE_KEYS } from '../core/store.js';
import { similarity, normalize, pMap, stripHTML } from '../core/util.js';

/* ==========================================================================
   工具
   ========================================================================== */

export function makeTrack(source, data) {
  const t = {
    key: `${source}:${data.id}`,
    id: String(data.id),
    source,
    name: data.name || '未知曲目',
    artist: data.artist || '未知歌手',
    album: data.album || '',
    duration: Number(data.duration) || 0,
    cover: data.cover || '',
    extra: data.extra || {},
  };
  return t;
}

function artistsOf(arr) {
  if (!Array.isArray(arr)) return String(arr || '');
  return arr.map((a) => a?.name || a).filter(Boolean).join(' / ');
}

function md5Like(seed) {
  // 酷狗只要一个稳定的 32 位十六进制串
  let h1 = 0x811c9dc5;
  let h2 = 0xc2b2ae35;
  for (let i = 0; i < seed.length; i++) {
    h1 = (h1 ^ seed.charCodeAt(i)) * 16777619 >>> 0;
    h2 = (h2 + seed.charCodeAt(i) * (i + 7)) >>> 0;
  }
  const part = (n) => n.toString(16).padStart(8, '0');
  return part(h1) + part(h2) + part((h1 ^ h2) >>> 0) + part((h1 + h2) >>> 0);
}

const UUID = (() => {
  try { return crypto.randomUUID().replace(/-/g, ''); } catch { return md5Like(String(Date.now())); }
})();

/* ==========================================================================
   1. 网易云音乐
   ========================================================================== */
const NETEASE_REF = 'https://music.163.com/';
const NETEASE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

function neCookie() {
  const acc = store.getAccount('netease');
  const base = 'appver=2.0.2; os=pc; osver=Microsoft-Windows-10; deviceId=bmfm';
  return acc?.cookie ? `${base}; ${acc.cookie}` : base;
}

function neTrack(s) {
  const al = s.al || s.album || {};
  const ar = s.ar || s.artists || [];
  return makeTrack('netease', {
    id: s.id,
    name: s.name,
    artist: artistsOf(ar),
    album: al.name || '',
    duration: s.dt || s.duration || 0,
    cover: al.picUrl || s.picUrl || '',
    extra: { fee: s.fee, mv: s.mv },
  });
}

export const netease = {
  async search(kw, { limit = 30, page = 1 } = {}) {
    const offset = (page - 1) * limit;
    const body = `s=${encodeURIComponent(kw)}&type=1&limit=${limit}&offset=${offset}&total=true`;
    const data = await proxyJSON('https://music.163.com/api/cloudsearch/pc', {
      method: 'POST',
      body,
      referer: NETEASE_REF,
      cookie: neCookie(),
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': NETEASE_UA },
    });
    const songs = data?.result?.songs || [];
    return songs.map(neTrack);
  },

  async playlist(id) {
    const data = await proxyJSON(`https://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(id)}&n=1000&s=8`, {
      referer: NETEASE_REF,
      cookie: neCookie(),
      headers: { 'user-agent': NETEASE_UA },
    });
    const pl = data?.playlist;
    if (!pl) throw new Error('歌单不存在或不可访问');
    let tracks = (pl.tracks || []).map(neTrack);

    // v6 接口有时只返回前若干首，用 trackIds 补齐
    const ids = (pl.trackIds || []).map((x) => x.id);
    if (ids.length > tracks.length) {
      const have = new Set(tracks.map((t) => t.id));
      const missing = ids.filter((x) => !have.has(String(x)));
      const chunks = [];
      for (let i = 0; i < missing.length; i += 400) chunks.push(missing.slice(i, i + 400));
      const details = await pMap(chunks, (chunk) =>
        proxyJSON(`https://music.163.com/api/song/detail?ids=[${chunk.join(',')}]`, {
          referer: NETEASE_REF, cookie: neCookie(), headers: { 'user-agent': NETEASE_UA },
        }), 3);
      for (const d of details) {
        (d?.songs || []).forEach((s) => tracks.push(neTrack(s)));
      }
      // 保持原顺序
      const map = new Map(tracks.map((t) => [t.id, t]));
      tracks = ids.map((x) => map.get(String(x))).filter(Boolean);
    }

    return {
      id: String(pl.id),
      source: 'netease',
      name: pl.name,
      desc: pl.description || '',
      cover: pl.coverImgUrl || '',
      creator: pl.creator?.nickname || '',
      trackCount: pl.trackCount || tracks.length,
      tracks,
    };
  },

  async resolve(track, { quality = 'standard' } = {}) {
    const levelMap = { standard: 'standard', higher: 'higher', exhigh: 'exhigh', lossless: 'lossless' };
    const level = levelMap[quality] || 'standard';
    try {
      const data = await proxyJSON(
        `https://music.163.com/api/song/enhance/player/url/v1?ids=[${track.id}]&level=${level}&encodeType=flac`,
        {
          method: 'POST',
          body: `ids=[${track.id}]&level=${level}&encodeType=flac`,
          referer: NETEASE_REF,
          cookie: neCookie(),
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': NETEASE_UA },
        },
      );
      const url = data?.data?.[0]?.url;
      if (url) return { url: streamUrl(url, 'https://music.163.com/'), rawUrl: url };
    } catch { /* 走外链兜底 */ }

    const fallback = `https://music.163.com/song/media/outer/url?id=${track.id}.mp3`;
    // outer url 对下架/付费曲目会返回一个 HTML 提示页，必须探测 content-type
    try {
      const probe = await proxyFetch(fallback, {
        referer: NETEASE_REF,
        headers: { 'user-agent': NETEASE_UA, range: 'bytes=0-1' },
        timeout: 8000,
      });
      if (!/audio|octet-stream|mpegurl/i.test(probe.contentType)) {
        throw new Error('该曲目在网易云需要会员或已下架');
      }
    } catch (e) {
      throw new Error(e.message.includes('会员') ? e.message : '网易云未返回可用音频');
    }
    return { url: streamUrl(fallback, NETEASE_REF), rawUrl: fallback };
  },

  async lyric(track) {
    const data = await proxyJSON(`https://music.163.com/api/song/lyric?id=${track.id}&lv=1&kv=1&tv=-1`, {
      referer: NETEASE_REF, cookie: neCookie(), headers: { 'user-agent': NETEASE_UA },
    });
    return { lrc: data?.lrc?.lyric || '', tlyric: data?.tlyric?.lyric || '' };
  },

  /** 首页榜单 */
  async toplist(id) {
    return this.playlist(id);
  },
};

/* ==========================================================================
   2. QQ 音乐
   ========================================================================== */
const QQ_REF = 'https://y.qq.com/';
const QQ_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

function qqCover(albummid) {
  if (!albummid) return '';
  return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albummid}.jpg`;
}

function qqTrack(s) {
  const id = s.songmid || s.mid || s.id;
  return makeTrack('qq', {
    id,
    name: s.songname || s.name || s.title,
    artist: artistsOf(s.singer),
    album: s.albumname || s.album?.name || '',
    duration: (s.interval || 0) * 1000,
    cover: qqCover(s.albummid || s.album?.mid),
    extra: { songmid: id, albummid: s.albummid || s.album?.mid },
  });
}

function qqCookie() {
  const acc = store.getAccount('qq');
  return acc?.cookie || 'uin=; qqmusic_key=';
}

export const qq = {
  async search(kw, { limit = 30, page = 1 } = {}) {
    // 注意：u.y.qq.com 的 musicu.fcg 只接受 GET + data= 形式（POST 会被静默返回空列表）
    const payload = {
      comm: { ct: '19', cv: '1859', uin: '0' },
      req: {
        method: 'DoSearchForQQMusicDesktop',
        module: 'music.search.SearchCgiService',
        param: { grp: 1, num_per_page: limit, page_num: page, query: kw, search_type: 0 },
      },
    };
    const url = `https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=${encodeURIComponent(JSON.stringify(payload))}`;
    const data = await proxyJSON(url, { referer: QQ_REF, cookie: qqCookie(), headers: { 'user-agent': QQ_UA } });
    const list = data?.req?.data?.body?.song?.list || [];
    return list.map(qqTrack).filter((t) => t.id);
  },

  async playlist(id) {
    const url = 'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?' + new URLSearchParams({
      type: 1, json: 1, utf8: 1, onlysong: 0, disstid: id, format: 'json',
      g_tk: 5381, loginUin: 0, hostUin: 0, inCharset: 'utf8', outCharset: 'utf-8',
      notice: 0, platform: 'yqq.json', needNewCode: 0,
    }).toString();
    const data = await proxyJSON(url, { referer: QQ_REF, cookie: qqCookie(), headers: { 'user-agent': QQ_UA } });
    const cd = data?.cdlist?.[0];
    if (!cd) throw new Error('歌单不存在或需要登录');
    const tracks = (cd.songlist || []).map(qqTrack);
    return {
      id: String(id),
      source: 'qq',
      name: cd.dissname || cd.dissname_zh || 'QQ 歌单',
      desc: cd.desc || '',
      cover: cd.logo || '',
      creator: cd.nickname || '',
      trackCount: tracks.length,
      tracks,
    };
  },

  async resolve(track) {
    const mid = track.extra?.songmid || track.id;
    const payload = {
      req_0: {
        module: 'vkey.GetVkeyServer',
        method: 'CgiGetVkey',
        param: {
          guid: UUID,
          songmid: [mid],
          songtype: [0],
          uin: '0',
          loginflag: 1,
          platform: '20',
        },
      },
      comm: { uin: 0, format: 'json', ct: 24, cv: 0 },
    };
    const url = `https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=${encodeURIComponent(JSON.stringify(payload))}`;
    const data = await proxyJSON(url, { referer: QQ_REF, cookie: qqCookie(), headers: { 'user-agent': QQ_UA } });
    const info = data?.req_0?.data?.midurlinfo?.[0];
    const purl = info?.purl;
    if (!purl) throw new Error('QQ 音乐未返回播放地址（付费或版权受限曲目）');
    const sip = data?.req_0?.data?.sip?.[0] || 'https://ws.stream.qqmusic.qq.com/';
    const raw = sip.replace(/\/$/, '') + '/' + purl.replace(/^\//, '');
    return { url: streamUrl(raw, 'https://y.qq.com/'), rawUrl: raw };
  },

  async lyric(track) {
    const mid = track.extra?.songmid || track.id;
    const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${mid}&format=json&nobase64=1&g_tk=5381`;
    const data = await proxyJSON(url, { referer: QQ_REF, cookie: qqCookie(), headers: { 'user-agent': QQ_UA } });
    return { lrc: data?.lyric || '', tlyric: data?.trans || '' };
  },
};

/* ==========================================================================
   3. 酷狗音乐
   ========================================================================== */
const KG_REF = 'https://www.kugou.com/';
const KG_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

function kgTrack(s) {
  const name = s.songname || s.filename?.replace(/\.\w+$/, '') || '未知曲目';
  return makeTrack('kugou', {
    id: s.hash || s.HASH || s.audio_id,
    name,
    artist: s.singername || s.author_name || '',
    album: s.album_name || '',
    duration: (Number(s.duration) || 0) * 1000,
    cover: s.album_id ? `https://imge.kugou.com/stdmusic/240/${s.album_id}.jpg` : '',
    extra: { hash: s.hash || s.HASH, albumId: s.album_id, albumAudioId: s.album_audio_id },
  });
}

export const kugou = {
  async search(kw, { limit = 30, page = 1 } = {}) {
    // mobilecdn.kugou.com 的 HTTPS 端点在部分网络下握手失败，统一走 HTTP
    const url = `http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(kw)}&page=${page}&pagesize=${limit}&showtype=1`;
    const data = await proxyJSON(url, { referer: KG_REF, headers: { 'user-agent': KG_UA } });
    const info = data?.data?.info || [];
    return info.map(kgTrack).filter((t) => t.id);
  },

  async playlist(id) {
    const url = `http://mobilecdn.kugou.com/api/v3/special/song?specialid=${id}&page=1&pagesize=200&version=9108&plat=0&area_code=1`;
    const data = await proxyJSON(url, { referer: KG_REF, headers: { 'user-agent': KG_UA } });
    const info = data?.data?.info || [];
    const tracks = info.map(kgTrack).filter((t) => t.id);
    return {
      id: String(id),
      source: 'kugou',
      name: `酷狗歌单 ${id}`,
      desc: '',
      cover: tracks[0]?.cover || '',
      creator: '',
      trackCount: tracks.length,
      tracks,
    };
  },

  async resolve(track) {
    const hash = track.extra?.hash || track.id;
    // 移动端接口无需 cookie，且比 www.kugou.com/yy/index.php 稳定得多
    const data = await proxyJSON(`https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${hash}`, {
      referer: 'https://m.kugou.com/',
      headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' },
    });
    const play = data?.url || (Array.isArray(data?.backup_url) ? data.backup_url[0] : data?.backup_url);
    if (!play) {
      const priv = data?.privilege || data?.sqprivilege;
      throw new Error(priv ? '酷狗该曲目需要 VIP 或已下架' : '酷狗未返回播放地址');
    }
    const cover = data?.imgUrl ? String(data.imgUrl).replace('{size}', '240') : '';
    return { url: streamUrl(play, 'https://www.kugou.com/'), rawUrl: play, cover };
  },

  async lyric(track) {
    const hash = track.extra?.hash || track.id;
    try {
      const search = await proxyJSON(
        `https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=&duration=&hash=${hash}`,
        { referer: KG_REF, headers: { 'user-agent': KG_UA } },
      );
      const cand = search?.candidates?.[0];
      if (!cand) return { lrc: '', tlyric: '' };
      const dl = await proxyJSON(
        `https://lyrics.kugou.com/download?ver=1&client=pc&id=${cand.id}&accesskey=${cand.accesskey}&fmt=lrc&charset=utf8`,
        { referer: KG_REF, headers: { 'user-agent': KG_UA } },
      );
      const lrc = dl?.content ? decodeURIComponent(escape(atob(dl.content))) : '';
      return { lrc, tlyric: '' };
    } catch {
      return { lrc: '', tlyric: '' };
    }
  },
};

/* ==========================================================================
   4. 酷我音乐
   ========================================================================== */
const KW_REF = 'https://www.kuwo.cn/';
const KW_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

function kwTrack(s) {
  const ridRaw = s.MUSICRID || s.rid || '';
  const rid = String(ridRaw).replace(/^MUSIC_/, '');
  const cover = s.web_albumpic_short
    ? `https://img1.kuwo.cn/star/albumcover/${s.web_albumpic_short}`
    : (s.albumpic || s.pic || '');
  return makeTrack('kuwo', {
    id: rid,
    name: (s.SONGNAME || s.name || '').replace(/&nbsp;/g, ' '),
    artist: (s.ARTIST || s.artist || '').replace(/&nbsp;/g, ' '),
    album: (s.ALBUM || s.album || '').replace(/&nbsp;/g, ' '),
    duration: (Number(s.DURATION) || 0) * 1000,
    cover,
    extra: { rid },
  });
}

export const kuwo = {
  async search(kw, { limit = 30, page = 1 } = {}) {
    const url = `http://search.kuwo.cn/r.s?all=${encodeURIComponent(kw)}&ft=music&itemset=web_2013&client=kt&pn=${page - 1}&rn=${limit}&rformat=json&encoding=utf8`;
    const r = await proxyFetch(url, { referer: KW_REF, headers: { 'user-agent': KW_UA } });
    const data = looseJSON(r.text);
    const list = data?.abslist || [];
    return list.map(kwTrack).filter((t) => t.id);
  },

  async playlist(id) {
    const url = `http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${id}&pn=0&rn=200&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.3.0_W1&newver=1`;
    const r = await proxyFetch(url, { referer: KW_REF, headers: { 'user-agent': KW_UA } });
    const data = looseJSON(r.text);
    const list = data?.musiclist || data?.abslist || [];
    const tracks = list.map(kwTrack).filter((t) => t.id);
    return {
      id: String(id),
      source: 'kuwo',
      name: data?.title || `酷我歌单 ${id}`,
      desc: data?.info || '',
      cover: data?.pic || tracks[0]?.cover || '',
      creator: data?.uname || '',
      trackCount: tracks.length,
      tracks,
    };
  },

  async resolve(track) {
    const rid = track.extra?.rid || track.id;
    const url = `https://antiserver.kuwo.cn/anti.s?type=convert_url&format=mp3&response=url&rid=MUSIC_${rid}`;
    const r = await proxyFetch(url, { referer: KW_REF, headers: { 'user-agent': KW_UA } });
    const play = (r.text || '').trim();
    if (!play.startsWith('http')) throw new Error('酷我未返回可用播放地址');
    return { url: streamUrl(play, KW_REF), rawUrl: play };
  },

  async lyric(track) {
    try {
      const rid = track.extra?.rid || track.id;
      const url = `https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${rid}`;
      const data = await proxyJSON(url, { referer: 'https://m.kuwo.cn/', headers: { 'user-agent': KW_UA } });
      const lrclist = data?.data?.lrclist || [];
      const lrc = lrclist
        .map((l) => `[${String(Math.floor(l.time / 60)).padStart(2, '0')}:${String(Math.floor(l.time % 60)).padStart(2, '0')}.${String(Math.round((l.time % 1) * 100)).padStart(2, '0')}]${l.lineLyric}`)
        .join('\n');
      return { lrc, tlyric: '' };
    } catch {
      return { lrc: '', tlyric: '' };
    }
  },
};

/* ==========================================================================
   5. 咪咕音乐（以搜索为主）
   ========================================================================== */
const MG_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

/** 咪咕的封面在 imgItems 里（按尺寸类型排），没有 img1/img2 字段 */
function miguCover(s) {
  const items = s.imgItems || [];
  const pick =
    items.find((i) => i.imgSizeType === '03') ||
    items.find((i) => i.imgSizeType === '02') ||
    items[0];
  return pick?.img || s.img3 || s.img2 || s.img1 || s.albumImg || '';
}

export const migu = {
  async search(kw, { limit = 30, page = 1 } = {}) {
    const sw = encodeURIComponent('{"song":1,"album":0,"singer":0,"tag":0,"playlist":0}');
    // channel 参数缺失时接口会返回空结果，必须带上
    const url = `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do?isCorrect=1&text=${encodeURIComponent(kw)}&pageNo=${page}&pageSize=${limit}&channel=014000D&searchSwitch=${sw}`;
    const data = await proxyJSON(url, {
      referer: 'https://music.migu.cn/',
      headers: { 'user-agent': MG_UA, channel: '014000D' },
    });
    const list = data?.songResultData?.result || data?.songResultData?.resultList || [];
    return list.map((s) => makeTrack('migu', {
      id: s.id || s.copyrightId,
      name: s.name || s.songName,
      artist: artistsOf((s.singers || s.singerList || []).map((x) => ({ name: x.name }))),
      album: s.albums?.[0]?.name || s.albumName || '',
      duration: Number(s.duration || s.length) || 0,
      cover: miguCover(s),
      extra: { copyrightId: s.copyrightId, contentId: s.contentId },
    })).filter((t) => t.id);
  },

  async playlist(id) {
    const url = `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/query_playlist_detail.do?playlistId=${id}`;
    const data = await proxyJSON(url, { referer: 'https://music.migu.cn/', headers: { 'user-agent': MG_UA } });
    const list = data?.data?.songList || [];
    const tracks = list.map((s) => makeTrack('migu', {
      id: s.copyrightId || s.id,
      name: s.songName || s.name,
      artist: artistsOf(s.singerList?.map((x) => ({ name: x.name }))),
      album: s.albumName || '',
      duration: Number(s.duration) || 0,
      cover: miguCover(s),
    })).filter((t) => t.id);
    return {
      id: String(id), source: 'migu',
      name: data?.data?.playListName || `咪咕歌单 ${id}`,
      desc: data?.data?.summary || '',
      cover: data?.data?.img3 || tracks[0]?.cover || '',
      creator: '', trackCount: tracks.length, tracks,
    };
  },

  async resolve() {
    throw new Error('咪咕音频地址需要鉴权，已自动尝试其它音源');
  },

  async lyric() {
    return { lrc: '', tlyric: '' };
  },
};

/* ==========================================================================
   6. 哔哩哔哩（实验性）
   ========================================================================== */
const BILI_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
const BILI_COOKIE = () => {
  const acc = store.getAccount('bilibili');
  return acc?.cookie || `buvid3=${UUID}-infoc`;
};

function biliTrack(v) {
  const title = stripHTML(v.title || '');
  return makeTrack('bilibili', {
    id: v.bvid,
    name: title,
    artist: v.author || 'B站 UP 主',
    album: '哔哩哔哩',
    duration: typeof v.duration === 'string'
      ? v.duration.split(':').reduce((acc, x) => acc * 60 + Number(x), 0) * 1000
      : Number(v.duration) * 1000,
    cover: v.pic ? (v.pic.startsWith('//') ? `https:${v.pic}` : v.pic) : '',
    extra: { bvid: v.bvid, aid: v.aid },
  });
}

export const bilibili = {
  async search(kw, { limit = 30, page = 1 } = {}) {
    const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(kw)}&page=${page}&page_size=${Math.min(limit, 50)}`;
    const data = await proxyJSON(url, {
      referer: 'https://search.bilibili.com/',
      cookie: BILI_COOKIE(),
      headers: { 'user-agent': BILI_UA },
    });
    const list = data?.data?.result || [];
    return list.map(biliTrack).filter((t) => t.id);
  },

  async playlist() {
    throw new Error('B 站收藏夹需要登录 Cookie，请在「平台账号」中绑定');
  },

  async resolve(track) {
    const bvid = track.extra?.bvid || track.id;
    const view = await proxyJSON(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
      referer: 'https://www.bilibili.com/',
      cookie: BILI_COOKIE(),
      headers: { 'user-agent': BILI_UA },
    });
    const cid = view?.data?.cid || view?.data?.pages?.[0]?.cid;
    if (!cid) throw new Error('无法获取视频 cid');

    const play = await proxyJSON(
      `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=16&fnver=0&fourk=1`,
      { referer: `https://www.bilibili.com/video/${bvid}`, cookie: BILI_COOKIE(), headers: { 'user-agent': BILI_UA } },
    );
    const dash = play?.data?.dash;
    let raw = '';
    if (dash?.audio?.length) {
      const best = dash.audio.slice().sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
      raw = best.baseUrl || best.base_url || '';
    } else if (play?.data?.durl?.[0]?.url) {
      raw = play.data.durl[0].url;
    }
    if (!raw) throw new Error('B 站未返回音频流');
    return { url: streamUrl(raw, `https://www.bilibili.com/video/${bvid}`), rawUrl: raw };
  },

  async lyric() {
    return { lrc: '', tlyric: '' };
  },
};

/* ==========================================================================
   7~9. 第三方聚合站（歌曲宝 / 下歌宝 / 歌曲海）
   这类站点把各平台的音频转存了一遍，会员/付费曲目往往能直接拿到完整直链，
   因此作为「主音源放不了」时的第一顺位兜底。
   ========================================================================== */
function aggregatorSource(key) {
  return {
    async search(kw, { limit = 30 } = {}) {
      const data = await localAPI('/aggr/search', { site: key, kw, limit }, 22000);
      if (!data?.ok) throw new Error(data?.error || '聚合站搜索失败');
      return (data.list || []).map((s) => makeTrack(key, {
        id: s.id,
        name: s.name,
        artist: s.artist,
        album: s.album || '',
        duration: s.duration || 0,
        cover: s.cover || '',
      })).filter((t) => t.id);
    },

    async playlist() {
      throw new Error(`${SOURCES[key].name} 不支持歌单读取`);
    },

    async resolve(track) {
      const data = await localAPI('/aggr/play', { site: key, id: track.id }, 28000);
      if (!data?.ok || !data.url) throw new Error(data?.error || '取址失败');
      return {
        url: streamUrl(data.url, ''),
        rawUrl: data.url,
        cover: data.cover || '',
        duration: data.duration || 0,
      };
    },

    async lyric() {
      return { lrc: '', tlyric: '' };
    },
  };
}

export const gequbao = aggregatorSource('gequbao');
export const xiagebao = aggregatorSource('xiagebao');
export const gequhai = aggregatorSource('gequhai');

/* ==========================================================================
   统一入口
   ========================================================================== */
export const SOURCE_IMPL = {
  netease, qq, kugou, kuwo, migu, bilibili,
  gequbao, xiagebao, gequhai,
};

/** 并行搜索多个音源，失败静默跳过 */
export async function searchAll(keyword, opts = {}) {
  const kw = String(keyword || '').trim();
  if (!kw) return [];
  const enabled = opts.sources || store.settings.enabledSources || Object.keys(SOURCE_IMPL);
  const limit = opts.limit || store.settings.searchLimit || 30;
  const page = opts.page || 1;

  // 偏好音源排到最前：并发队列先跑它们，交错合并时也先出它们的结果
  const pref = new Set(store.settings.prefSources || []);
  const ordered = Array.from(enabled).sort(
    (a, b) => (pref.has(a) ? 0 : 1) - (pref.has(b) ? 0 : 1)
  );

  const results = await pMap(ordered, async (src) => {
    const impl = SOURCE_IMPL[src];
    if (!impl) return [];
    try {
      const list = await impl.search(kw, { limit, page });
      return list.map((t) => ({ ...t, source: src }));
    } catch (e) {
      console.warn(`[search] ${SOURCES[src]?.name || src} 失败：`, e.message);
      return [];
    }
  }, 4);

  // 交错合并，让各平台结果都有露面机会
  const buckets = results.map((r) => (r && !r.__error ? r : []));
  const merged = [];
  const maxLen = Math.max(0, ...buckets.map((b) => b.length));
  for (let i = 0; i < maxLen; i++) {
    for (const b of buckets) if (b[i]) merged.push(b[i]);
  }
  return merged;
}

/** 单源搜索 */
export async function searchOne(source, keyword, opts = {}) {
  const impl = SOURCE_IMPL[source];
  if (!impl) throw new Error(`未知音源 ${source}`);
  return impl.search(keyword, opts);
}

/** 取歌单详情 */
export async function getPlaylist(source, id) {
  const impl = SOURCE_IMPL[source];
  if (!impl) throw new Error(`未知音源 ${source}`);
  if (!impl.playlist) throw new Error(`${SOURCES[source]?.name || source} 暂不支持歌单读取`);
  const list = await impl.playlist(id);
  // 同一首歌在歌单里重复出现时去掉重复项
  const seen = new Set();
  const out = [];
  for (const t of list) {
    if (!t) continue;
    const k = t.key || `${t.source}:${t.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/**
 * 在聚合站里找可播放的转存版本
 * 这是「付费歌曲听不了自动切换」的第一道防线：聚合站手里有完整音频。
 */
export async function findAggregatorMatch(track) {
  const enabled = store.settings.enabledSources || [];
  const sites = AGG_SOURCE_KEYS.filter((k) => enabled.includes(k) && SOURCE_IMPL[k]);
  if (!sites.length) return null;

  const query = `${track.name} ${String(track.artist).split('/')[0]}`.trim();
  let best = null;
  let bestScore = 0;

  for (const site of sites) {
    try {
      const list = await SOURCE_IMPL[site].search(query, { limit: 10 });
      for (const cand of list) {
        const score = similarity(cand.name, track.name) * 0.65 +
                      similarity(cand.artist, track.artist) * 0.35;
        if (score > bestScore) { bestScore = score; best = cand; }
      }
      if (bestScore >= 0.88) break; // 已经足够确定，不必再问下一家
    } catch { /* 换下一家 */ }
  }
  return bestScore >= 0.62 ? best : null;
}

/** 拉两个字节确认这个地址真的是音频（有些源会返回 200 + HTML 错误页） */
export async function quickAudioCheck(url, timeout = 9000) {
  if (!url) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-1' },
      signal: ctrl.signal,
    });
    if (!r.ok && r.status !== 206) return false;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    return /audio|octet-stream|mpegurl|mp4|video/.test(ct);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 解析播放地址：原源 → 聚合站 → 其它音源，逐级降级（换源结果都会先验一次） */
export async function resolveTrack(track, opts = {}) {
  if (track.source === 'local' && track.extra?.blobUrl) {
    return { url: track.extra.blobUrl, rawUrl: track.extra.blobUrl };
  }

  // 下载过的曲目优先走本地文件，不走网络。
  // 文件被删或路径失效时才回落到在线音源。
  const localHit = (store.settings.downloads || []).find((d) => d.key === track.key && d.file);
  if (localHit) {
    const localUrl = `${store.settings.proxyPrefix || '/api'}/local?f=${encodeURIComponent(localHit.file)}`;
    try {
      if (await quickAudioCheck(localUrl, 5000)) {
        return { url: localUrl, rawUrl: localUrl, isLocal: true };
      }
    } catch { /* 落回在线 */ }
  }
  const impl = SOURCE_IMPL[track.source];
  if (!impl) throw new Error(`未知音源 ${track.source}`);

  let lastError = '';
  try {
    const direct = await impl.resolve(track, { quality: store.settings.quality });
    // 原源直接给的结果也不再盲信：确认是音频才交出去
    if (await quickAudioCheck(direct.url)) return direct;
    lastError = `${SOURCES[track.source]?.name || track.source} 返回的地址无法播放`;
  } catch (e) {
    if (opts.allowFallback === false) throw e;
    lastError = e.message;
  }

  const errors = [lastError || '原音源不可用'];

  // 第 1 级：聚合站（歌曲宝 / 下歌宝 / 歌曲海）
  if (!AGG_SOURCE_KEYS.includes(track.source)) {
    try {
      const agg = await findAggregatorMatch(track);
      if (agg) {
        const res = await SOURCE_IMPL[agg.source].resolve(agg, { quality: store.settings.quality });
        if (await quickAudioCheck(res.url)) {
          return { ...res, fallbackFrom: track.source, matched: agg };
        }
        errors.push(`${SOURCES[agg.source]?.short} 地址不可用`);
      }
    } catch (err) {
      errors.push(err.message);
    }
  }

  // 第 2 级：其它常规音源
  const alternatives = await findAlternatives(track);
  for (const alt of alternatives) {
    try {
      const res = await SOURCE_IMPL[alt.source].resolve(alt, { quality: store.settings.quality });
      if (!(await quickAudioCheck(res.url))) {
        errors.push(`${SOURCES[alt.source]?.short} 地址不可用`);
        continue;
      }
      return { ...res, fallbackFrom: track.source, matched: alt };
    } catch (err) {
      errors.push(err.message);
    }
  }

  throw new Error(`所有音源都无法播放（${errors[errors.length - 1]}）`);
}

/** 在其它常规音源里找同名歌曲，按相似度倒序返回前若干个候选 */
export async function findAlternatives(track) {
  const pref = new Set(store.settings.prefSources || []);
  const enabled = (store.settings.enabledSources || [])
    .filter((s) => s !== track.source && SOURCE_IMPL[s] && !AGG_SOURCE_KEYS.includes(s))
    .sort((a, b) => (pref.has(a) ? 0 : 1) - (pref.has(b) ? 0 : 1));
  const query = `${track.name} ${String(track.artist).split('/')[0]}`.trim();
  const scored = [];

  for (const src of enabled) {
    try {
      const list = await SOURCE_IMPL[src].search(query, { limit: 8 });
      for (const cand of list) {
        const score = similarity(cand.name, track.name) * 0.65 +
                      similarity(cand.artist, track.artist) * 0.35;
        if (score >= 0.62) scored.push({ ...cand, __score: score });
      }
    } catch { /* 换下一个源 */ }
  }

  // 偏好音源加一点点分：同分或略低时优先选它，但压不过明显更准的匹配
  scored.sort((a, b) => {
    const pa = pref.has(a.source) ? 0.08 : 0;
    const pb = pref.has(b.source) ? 0.08 : 0;
    return (b.__score + pb) - (a.__score + pa);
  });
  // 同一音源最多保留 2 个候选，避免连续在同一个源上失败
  const perSource = new Map();
  const out = [];
  for (const c of scored) {
    const n = perSource.get(c.source) || 0;
    if (n >= 2) continue;
    perSource.set(c.source, n + 1);
    out.push(c);
    if (out.length >= 6) break;
  }
  return out;
}

/** 兼容旧调用 */
export async function findAlternative(track) {
  const list = await findAlternatives(track);
  return list[0] || null;
}

/**
 * 探测一首歌是否真的能播
 * 解析地址 → 实际拉 2 个字节 → 看返回的 Content-Type 是不是音频
 * 光有 URL 不够：有些源会返回 200 + HTML 错误页
 */
export async function probePlayable(track) {
  if (!track) return { ok: false, reason: '空曲目' };
  let res;
  try {
    res = await resolveTrack(track, { allowFallback: true });
  } catch (e) {
    return { ok: false, reason: e.message };
  }
  if (!res?.url) return { ok: false, reason: '没有拿到播放地址' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const probe = await fetch(res.url, {
      method: 'GET',
      headers: { Range: 'bytes=0-1' },
      signal: ctrl.signal,
    });
    const ct = (probe.headers.get('content-type') || '').toLowerCase();
    if (!/audio|octet-stream|mpegurl|mp4|video/.test(ct)) {
      return { ok: false, reason: `返回的不是音频（${ct || '未知类型'}）` };
    }
    return { ok: true, via: res.matched?.source || track.source, url: res.url };
  } catch (e) {
    return { ok: false, reason: e.message.includes('abort') ? '探测超时' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

/** 取歌词 */
export async function getLyric(track) {
  const impl = SOURCE_IMPL[track.source];
  if (!impl?.lyric) return { lrc: '', tlyric: '' };
  try {
    return await impl.lyric(track);
  } catch {
    return { lrc: '', tlyric: '' };
  }
}

/** 解析 LRC 文本为 [{t, text}] */
export function parseLrc(lrc) {
  if (!lrc) return [];
  const lines = String(lrc).split(/\r?\n/);
  const out = [];
  const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const line of lines) {
    let matched = false;
    let m;
    re.lastIndex = 0;
    const times = [];
    while ((m = re.exec(line)) !== null) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const ms = m[3] ? Number(m[3].padEnd(3, '0')) : 0;
      times.push(min * 60000 + sec * 1000 + ms);
      matched = true;
    }
    if (!matched) continue;
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    if (!text) continue;
    times.forEach((t) => out.push({ t, text }));
  }
  return out.sort((a, b) => a.t - b.t);
}

/** 首页榜单定义（网易云榜单 id 长期稳定） */
export const TOPLISTS = [
  { id: '19723756', name: '飙升榜', source: 'netease' },
  { id: '3779629', name: '新歌榜', source: 'netease' },
  { id: '3778678', name: '热歌榜', source: 'netease' },
  { id: '2884035', name: '原创榜', source: 'netease' },
  { id: '3779629', name: '云音乐新歌榜', source: 'netease' },
];

/** 首页推荐用的固定优质歌单（网易云公开歌单 id） */
export const FEATURED = [
  { id: '3778678', name: '热歌榜', tag: '榜单' },
  { id: '19723756', name: '飙升榜', tag: '榜单' },
  { id: '2884035', name: '原创榜', tag: '榜单' },
  { id: '3779629', name: '新歌榜', tag: '榜单' },
];
