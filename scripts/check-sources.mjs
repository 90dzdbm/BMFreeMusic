#!/usr/bin/env node
/**
 * scripts/check-sources.mjs — 音源自检
 *
 * 用法：node scripts/check-sources.mjs [关键词]
 * 需要本地服务已在运行（node server/index.js）
 *
 * 依次验证：搜索 → 歌单 → 播放地址，输出每个源的状态。
 */

const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const KEYWORD = process.argv[2] || '周杰伦';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

const C = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', blue: '\x1b[36m', dim: '\x1b[2m',
};

async function raw(url, { referer = '', cookie = '', method = 'GET', body = null, headers = {} } = {}) {
  const res = await fetch(`${BASE}/api/raw`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, referer, cookie, method, body, headers }),
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: null, text }; }
}

function ok(label, extra = '') {
  console.log(`  ${C.green}✔${C.reset} ${label}${extra ? C.dim + ' ' + extra + C.reset : ''}`);
}
function fail(label, extra = '') {
  console.log(`  ${C.red}✘${C.reset} ${label}${extra ? C.dim + ' ' + extra + C.reset : ''}`);
}
function info(label) {
  console.log(`  ${C.dim}·${C.reset} ${label}`);
}

/* ---------------- 网易云 ---------------- */
async function checkNetease() {
  console.log(`\n${C.blue}网易云音乐${C.reset}`);
  const kw = encodeURIComponent(KEYWORD);

  const s = await raw('https://music.163.com/api/cloudsearch/pc', {
    method: 'POST',
    body: `s=${kw}&type=1&limit=5&offset=0&total=true`,
    referer: 'https://music.163.com/',
    cookie: 'appver=2.0.2; os=pc',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
  });
  const songs = s.data?.result?.songs || [];
  if (songs.length) ok('搜索', `${songs.length} 条 · 首条「${songs[0].name}」`);
  else fail('搜索', JSON.stringify(s.data)?.slice(0, 120));
  if (!songs.length) return;

  const id = songs[0].id;
  const url = await raw(`https://music.163.com/api/song/enhance/player/url/v1?ids=[${id}]&level=standard&encodeType=flac`, {
    method: 'POST',
    body: `ids=[${id}]&level=standard&encodeType=flac`,
    referer: 'https://music.163.com/',
    cookie: 'appver=2.0.2; os=pc',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
  });
  const playUrl = url.data?.data?.[0]?.url;
  if (playUrl) ok('播放地址', playUrl.slice(0, 60) + '…');
  else info('播放地址为空（可能为付费曲目），走 outer url 兜底');

  const pl = await raw('https://music.163.com/api/v6/playlist/detail?id=3778678&n=3&s=8', {
    referer: 'https://music.163.com/', cookie: 'appver=2.0.2; os=pc',
  });
  if (pl.data?.playlist) ok('歌单', `「${pl.data.playlist.name}」${pl.data.playlist.trackCount} 首`);
  else fail('歌单');

  const ly = await raw(`https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`, {
    referer: 'https://music.163.com/', cookie: 'appver=2.0.2; os=pc',
  });
  if (ly.data?.lrc?.lyric) ok('歌词', `${ly.data.lrc.lyric.length} 字符`);
  else info('无歌词');
}

/* ---------------- QQ 音乐 ---------------- */
async function checkQQ() {
  console.log(`\n${C.blue}QQ 音乐${C.reset}`);
  const payload = {
    comm: { ct: '19', cv: '1859', uin: '0' },
    req: {
      method: 'DoSearchForQQMusicDesktop',
      module: 'music.search.SearchCgiService',
      param: { grp: 1, num_per_page: 5, page_num: 1, query: KEYWORD, search_type: 0 },
    },
  };
  const s = await raw(`https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=${encodeURIComponent(JSON.stringify(payload))}`, {
    referer: 'https://y.qq.com/', headers: { 'user-agent': UA },
  });
  const list = s.data?.req?.data?.body?.song?.list || [];
  if (list.length) ok('搜索', `${list.length} 条 · 首条「${list[0].name || list[0].title}」`);
  else fail('搜索', '返回空列表');
  if (!list.length) return;

  const mid = list[0].mid;
  const vk = {
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param: { guid: '10000', songmid: [mid], songtype: [0], uin: '0', loginflag: 1, platform: '20' },
    },
    comm: { uin: 0, format: 'json', ct: 24, cv: 0 },
  };
  const v = await raw(`https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=${encodeURIComponent(JSON.stringify(vk))}`, {
    referer: 'https://y.qq.com/', headers: { 'user-agent': UA },
  });
  const purl = v.data?.req_0?.data?.midurlinfo?.[0]?.purl;
  if (purl) ok('播放地址', purl.slice(0, 60) + '…');
  else info('该曲 purl 为空（付费曲目），免费曲目可播');
}

/* ---------------- 酷狗 ---------------- */
async function checkKugou() {
  console.log(`\n${C.blue}酷狗音乐${C.reset}`);
  const s = await raw(`http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=${encodeURIComponent(KEYWORD)}&page=1&pagesize=5&showtype=1`, {
    referer: 'https://www.kugou.com/', headers: { 'user-agent': UA },
  });
  const info_ = s.data?.data?.info || [];
  if (info_.length) ok('搜索', `${info_.length} 条 · 首条「${info_[0].songname}」`);
  else return fail('搜索', JSON.stringify(s.data)?.slice(0, 120));

  const hash = info_[0].hash;
  const p = await raw(`https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${hash}`, {
    referer: 'https://m.kugou.com/',
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' },
  });
  const play = p.data?.url || p.data?.backup_url?.[0];
  if (play) ok('播放地址', String(play).slice(0, 60) + '…');
  else info(`该曲需 VIP 或已下架（privilege=${p.data?.privilege ?? '?'}），免费曲可播`);
}

/* ---------------- 酷我 ---------------- */
async function checkKuwo() {
  console.log(`\n${C.blue}酷我音乐${C.reset}`);
  const res = await fetch(`${BASE}/api/raw`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: `http://search.kuwo.cn/r.s?all=${encodeURIComponent(KEYWORD)}&ft=music&itemset=web_2013&client=kt&pn=0&rn=5&rformat=json&encoding=utf8`,
      referer: 'https://www.kuwo.cn/',
      headers: { 'user-agent': UA },
    }),
  });
  const text = await res.text();
  // 单引号 JSON，直接抓 MUSICRID
  const ids = [...text.matchAll(/MUSICRID':'MUSIC_(\d+)'/g)].map((m) => m[1]);
  const names = [...text.matchAll(/SONGNAME':'([^']*)'/g)].map((m) => m[1]);
  if (ids.length) ok('搜索', `${ids.length} 条 · 首条「${names[0] || ''}」`);
  else return fail('搜索', text.slice(0, 120));

  const p = await raw(`https://antiserver.kuwo.cn/anti.s?type=convert_url&format=mp3&response=url&rid=MUSIC_${ids[0]}`, {
    referer: 'https://www.kuwo.cn/', headers: { 'user-agent': UA },
  });
  const play = (p.text || '').trim();
  if (play.startsWith('http')) ok('播放地址', play.slice(0, 60) + '…');
  else info('播放地址不可用（可能需会员）');
}

/* ---------------- 咪咕 ---------------- */
async function checkMigu() {
  console.log(`\n${C.blue}咪咕音乐${C.reset}`);
  const sw = encodeURIComponent('{"song":1,"album":0,"singer":0,"tag":0,"playlist":0}');
  const s = await raw(`https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do?isCorrect=1&text=${encodeURIComponent(KEYWORD)}&pageNo=1&pageSize=5&channel=014000D&searchSwitch=${sw}`, {
    referer: 'https://music.migu.cn/',
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', channel: '014000D' },
  });
  const list = s.data?.songResultData?.result || [];
  if (list.length) ok('搜索', `${list.length} 条 · 首条「${list[0].name || list[0].songName}」`);
  else fail('搜索', '返回空（接口可能已变更）');
}

/* ---------------- B 站 ---------------- */
async function checkBilibili() {
  console.log(`\n${C.blue}哔哩哔哩${C.reset}`);
  const s = await raw(`https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(KEYWORD)}&page=1&page_size=5`, {
    referer: 'https://search.bilibili.com/',
    cookie: 'buvid3=00000000-0000-0000-0000-000000000000infoc',
    headers: { 'user-agent': UA },
  });
  const list = s.data?.data?.result || [];
  if (list.length) ok('搜索', `${list.length} 条 · 首条「${String(list[0].title).replace(/<[^>]+>/g, '')}」`);
  else fail('搜索', `code=${s.data?.code} ${s.data?.message || ''}`);
}

/* ---------------- 主流程 ---------------- */
(async () => {
  console.log(`${C.yellow}BM Free Music — 音源自检${C.reset}`);
  console.log(`${C.dim}关键词：${KEYWORD}   代理：${BASE}${C.reset}`);

  try {
    const h = await fetch(`${BASE}/api/health`).then((r) => r.json());
    console.log(`${C.dim}服务：${h.app} v${h.version} / Node ${h.node}${C.reset}`);
  } catch {
    console.error(`\n${C.red}本地服务未运行。请先执行：node server/index.js${C.reset}\n`);
    process.exit(1);
  }

  const checks = [checkNetease, checkQQ, checkKugou, checkKuwo, checkMigu, checkBilibili];
  let failed = 0;
  for (const fn of checks) {
    try { await fn(); } catch (e) { failed++; console.log(`  ${C.red}✘ 异常：${e.message}${C.reset}`); }
  }
  console.log(`\n${C.dim}完成。若某源失败，多为上游接口变更或存在网络限制。${C.reset}\n`);
})();
