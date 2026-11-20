/**
 * core/ranking.js — 搜索结果的去重与排序
 *
 * 两个问题：
 *   1. 同一首歌在多个平台各有一条，歌名/专辑/歌手都一样 → 只留一条
 *   2. 现场版、翻唱、纯音乐、DJ 版混在原曲中间 → 全部沉到后面
 *
 * 去重时选谁留下，按这个优先级：
 *   用户偏好的音源 > 网易云 > QQ 音乐 > 其它（按平台顺序）
 *   同一个平台内部则保留原曲（没有变体标记的那条）。
 */

/** 变体标记：命中任意一个就认为不是原曲 */
const VARIANT_PATTERNS = [
  /纯音乐/i,
  /instrumental/i,
  /伴奏/i,
  /钢琴版/i,
  /吉他版/i,
  /翻唱/i,
  /cover/i,
  /\blive\b/i,
  /现场/i,
  /演唱会/i,
  /dj\s*版?/i,
  /\bremix\b/i,
  /remix/i,
  /extended/i,
  /extended\s*mix/i,
  /电影剪辑/i,
  /影视剪辑/i,
  /高音质/i,
  /无损/i,
  /消音/i,
  /人声消除/i,
  /加速/i,
  /慢速/i,
  /八音盒/i,
  /钢琴/i,
  /\bbeat\b/i,
  /铃声/i,
  /彩铃/i,
  /版$/,
];

/** 歌名里的括号内容 */
const BRACKET_RE = /[（(\[【][^）)\]】]{0,20}[）)\]】]/g;

/**
 * 判定是不是「非原曲」。
 * 返回 { variant: bool, reason: string }
 */
export function variantInfo(track) {
  const name = String(track?.name || '');
  const album = String(track?.album || '');
  const artist = String(track?.artist || '');

  // 括号里写了这些词，一定是变体
  const brackets = name.match(BRACKET_RE) || [];
  for (const b of brackets) {
    for (const re of VARIANT_PATTERNS) {
      if (re.test(b)) return { variant: true, reason: b };
    }
  }

  // 歌名整体命中
  for (const re of VARIANT_PATTERNS) {
    if (re.test(name)) return { variant: true, reason: name };
  }

  // 专辑名带这些词，多半是现场/合辑版本
  if (album) {
    for (const re of [/\blive\b/i, /现场/i, /演唱会/i, /精选/i, /合辑/i, /翻唱/i, /dj/i, /remix/i]) {
      if (re.test(album)) return { variant: true, reason: album };
    }
  }

  // 歌手名带「翻唱」「Cover」之类
  if (artist && /(翻唱|cover\s*band|原唱)/i.test(artist)) {
    return { variant: true, reason: artist };
  }

  return { variant: false, reason: '' };
}

/** 把歌名里的括号内容去掉，得到「可用于比对的主名」 */
export function baseName(name) {
  return String(name || '').replace(BRACKET_RE, ' ').replace(/\s+/g, ' ').trim();
}

/** 归一化：去空格、去括号内容、小写、去常见噪声词 */
function normKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\-_·・,，.。、/\\|]+/g, '')
    .replace(/(官方|完整版|高音质|无损|hi-?res|remaster(ed)?)/g, '');
}

/**
 * 去重键：主名 + 歌手 + 专辑。
 * 三个都相同基本就是同一条。
 */
export function dedupeKey(track) {
  const name = normKey(baseName(track.name));
  const artist = normKey(String(track.artist || '').split('/')[0]);
  const album = normKey(track.album || '');
  return `${name}|${artist}|${album}`;
}

/** 宽松键：主名 + 歌手，用来识别「专辑名不同但其实是同一首」 */
export function looseKey(track) {
  const name = normKey(baseName(track.name));
  const artist = normKey(String(track.artist || '').split('/')[0]);
  return `${name}|${artist}`;
}

/**
 * 音源优先级：数字越小越优先。
 * 偏好音源排最前，然后网易云、QQ，最后其它。
 */
export function sourceRank(track, prefSources = []) {
  const src = track.source;
  if (prefSources.includes(src)) return 0;
  if (src === 'netease') return 1;
  if (src === 'qq') return 2;
  if (src === 'kugou') return 3;
  if (src === 'kuwo') return 4;
  if (src === 'migu') return 5;
  if (src === 'bilibili') return 6;
  return 9;   // 聚合站
}

/**
 * 去重 + 排序。
 * @param {Array} list 原始结果
 * @param {Array} prefSources 用户偏好的音源
 */
export function dedupeAndRank(list, prefSources = []) {
  const seen = new Map();   // dedupeKey -> track
  const loose = new Map();  // looseKey -> dedupeKey

  for (const t of list) {
    if (!t) continue;
    const dk = dedupeKey(t);
    const prev = seen.get(dk);
    if (prev) {
      // 已有一条，留更好的那条
      if (betterThan(t, prev, prefSources)) seen.set(dk, t);
      continue;
    }
    // 宽松比对：主名+歌手相同但专辑不同，很可能是同一条
    const lk = looseKey(t);
    const linked = loose.get(lk);
    if (linked && seen.has(linked)) {
      const prev2 = seen.get(linked);
      if (betterThan(t, prev2, prefSources)) seen.set(linked, t);
      continue;
    }
    seen.set(dk, t);
    loose.set(lk, dk);
  }

  const out = Array.from(seen.values());

  // 排序：原曲在前，同组内按音源优先级
  out.sort((a, b) => {
    const va = variantInfo(a).variant ? 1 : 0;
    const vb = variantInfo(b).variant ? 1 : 0;
    if (va !== vb) return va - vb;

    const ra = sourceRank(a, prefSources);
    const rb = sourceRank(b, prefSources);
    if (ra !== rb) return ra - rb;

    // 同优先级：原曲度高的、名字更短的排前面
    const la = baseName(a.name).length;
    const lb = baseName(b.name).length;
    if (la !== lb) return la - lb;
    return String(a.name).localeCompare(String(b.name));
  });

  return out;
}

/** a 是否比 b 更值得保留 */
function betterThan(a, b, prefSources) {
  const va = variantInfo(a).variant;
  const vb = variantInfo(b).variant;
  if (va !== vb) return !va;               // 原曲优先
  const ra = sourceRank(a, prefSources);
  const rb = sourceRank(b, prefSources);
  if (ra !== rb) return ra < rb;
  // 同源时专辑更完整的保留（有专辑名说明是正式版本）
  const aa = a.album ? 1 : 0;
  const ab = b.album ? 1 : 0;
  if (aa !== ab) return aa > ab;
  return baseName(a.name).length < baseName(b.name).length;
}
