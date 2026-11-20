/**
 * store.js — 全局状态 + localStorage 持久化 + 轻量事件总线
 */

const STORAGE_KEY = 'bmfm:state:v1';

export const SOURCES = {
  netease: { name: '网易云音乐', short: '网易云', color: '#c20c0c', logo: '网' },
  qq: { name: 'QQ 音乐', short: 'QQ', color: '#1aab5a', logo: 'Q' },
  kugou: { name: '酷狗音乐', short: '酷狗', color: '#1e6fff', logo: '酷' },
  kuwo: { name: '酷我音乐', short: '酷我', color: '#ff7500', logo: 'K' },
  migu: { name: '咪咕音乐', short: '咪咕', color: '#e6005c', logo: '咪' },
  bilibili: { name: '哔哩哔哩音频', short: 'B站', color: '#ff6699', logo: 'B' },
  gequbao: { name: '歌曲宝', short: '歌曲宝', color: '#31c27c', logo: '宝', aggregator: true },
  xiagebao: { name: '下歌宝', short: '下歌宝', color: '#0aa1ed', logo: '下', aggregator: true },
  gequhai: { name: '歌曲海', short: '歌曲海', color: '#2b6cb0', logo: '海', aggregator: true },
  local: { name: '本地文件', short: '本地', color: '#0b57d0', logo: '本' },
};

/** 偏好曲风：key 用于存储，q 是实际丢给搜索引擎的关键词 */
export const GENRES = [
  { key: 'cn', name: '华语流行', q: '华语流行' },
  { key: 'en', name: '欧美流行', q: '欧美流行' },
  { key: 'jp', name: '日语', q: '日语歌曲' },
  { key: 'kr', name: '韩语', q: '韩语歌曲' },
  { key: 'rock', name: '摇滚', q: '摇滚' },
  { key: 'folk', name: '民谣', q: '民谣' },
  { key: 'electronic', name: '电子', q: '电子音乐' },
  { key: 'rap', name: '说唱', q: '说唱' },
  { key: 'guofeng', name: '古风', q: '古风' },
  { key: 'jazz', name: '爵士', q: '爵士乐' },
  { key: 'rnb', name: 'R&B', q: 'R&B' },
  { key: 'acg', name: 'ACG', q: '动漫歌曲' },
  { key: 'cantonese', name: '粤语', q: '粤语经典' },
  { key: 'piano', name: '纯音乐', q: '纯音乐' },
];

export const ALL_SOURCE_KEYS = Object.keys(SOURCES);

/** 第三方聚合站：能拿到转存的完整音频，适合在会员曲目上兜底 */
export const AGG_SOURCE_KEYS = ['gequbao', 'xiagebao', 'gequhai'];

/** 平台账号可绑定的平台（本地与聚合站都不需要绑定） */
export const BINDABLE_SOURCES = ALL_SOURCE_KEYS.filter(
  (k) => k !== 'local' && !SOURCES[k].aggregator,
);

const DEFAULT_STATE = {
  version: 1,
  settings: {
    theme: 'system',        // light | dark | system
    accent: 'blue',
    quality: 'standard',    // standard | higher | exhigh | lossless
    volume: 0.8,
    muted: false,
    repeat: 'off',          // off | all | one
    shuffle: false,
    enabledSources: ['netease', 'qq', 'kugou', 'kuwo', 'migu', 'bilibili', 'gequbao', 'xiagebao', 'gequhai'],
    autoNext: true,
    searchLimit: 30,
    proxyPrefix: '/api',
    apiBases: { netease: '', qq: '', kugou: '', kuwo: '', migu: '', bilibili: '' },
    showLyrics: true,
    animations: true,
    // 偏好的音源：非空时搜索与换源都优先走这些平台
    prefSources: [],
    // 偏好的曲风：随便听听按这些关键词抓歌
    prefGenres: [],
    // 已下载到本机的曲目索引：key -> {name, path, savedAt}
    downloads: [],
    // 上次检查更新的时间戳，避免每次启动都请求
    lastUpdateCheck: 0,
    // 全屏播放页样式：blur 模糊封面 / gradient 渐变 / plain 纯色
    npStyle: 'blur',
    // 全屏播放页歌词字号（px）
    npFontSize: 16,
    // 桌面歌词开关
    deskLyrics: false,
    deskLyricsColor: '#ffffff',
    deskLyricsAlpha: 0.9,
    deskLyricsDraggable: false,
    // 开屏页
    splashEnabled: false,
    splashMedia: '',        // 图片或视频的 URL/文件名
    splashType: 'image',    // image | video
    splashDuration: 2.5,    // 秒
    splashMuted: true,      // 视频静音
    // 播放器样式：classic 经典 / minimal 极简
    playerStyle: 'classic',
  },
  accounts: {},
  liked: [],
  playlists: [],
  queue: [],
  queueIndex: -1,
  recent: [],
  recentSearches: [],
  stats: { plays: 0, since: Date.now() },
};

function deepMerge(base, patch) {
  if (Array.isArray(patch)) return patch.slice();
  if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
    const out = Array.isArray(base) ? {} : { ...(base || {}) };
    for (const k of Object.keys(patch)) {
      out[k] = deepMerge(base ? base[k] : undefined, patch[k]);
    }
    return out;
  }
  return patch === undefined ? base : patch;
}

/* --------------------------------------------------------------------------
   双通道持久化
   · localStorage：网页版与 APK 都可用，按 origin 隔离
   · BMFMAndroid.saveStore：APK 原生 SharedPreferences，origin 变了也不会丢
   -------------------------------------------------------------------------- */
const NATIVE_BRIDGE = () => {
  try {
    const b = window.BMFMAndroid;
    return (b && typeof b.loadStore === 'function') ? b : null;
  } catch {
    return null;
  }
};

function readNative() {
  const bridge = NATIVE_BRIDGE();
  if (!bridge) return null;
  try {
    const raw = bridge.loadStore();
    if (!raw || raw.length < 2) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function load() {
  const native = readNative();
  const local = readLocal();

  let best = null;
  if (native && local) {
    // 两边都有时取写入时间更新的那一份
    best = (Number(native._savedAt) || 0) >= (Number(local._savedAt) || 0) ? native : local;
  } else {
    best = native || local;
  }

  if (!best) return structuredClone(DEFAULT_STATE);
  try {
    return deepMerge(structuredClone(DEFAULT_STATE), best);
  } catch (e) {
    console.warn('[store] 数据损坏，使用默认状态', e);
    return structuredClone(DEFAULT_STATE);
  }
}

class Store {
  constructor() {
    this.state = load();
    this._listeners = new Map();
    this._saveTimer = null;
  }

  /* ---------- 订阅 ---------- */
  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this._listeners.get(event)?.delete(fn);
  }

  emit(event, payload) {
    this._listeners.get(event)?.forEach((fn) => {
      try { fn(payload); } catch (e) { console.error(`[store] ${event} 处理异常`, e); }
    });
  }

  /* ---------- 原生存储补读 ----------
   * 模块加载时 BMFMAndroid 可能还没注入（取决于 WebView 时机），
   * 所以启动完成后再补一次：谁的时间戳更新就用谁。
   */
  tryRestoreFromNative() {
    const bridge = NATIVE_BRIDGE();
    if (!bridge) return false;

    const native = readNative();
    if (!native) return false;

    const localSaved = Number(this.state._savedAt) || 0;
    const nativeSaved = Number(native._savedAt) || 0;
    if (nativeSaved <= localSaved) return false;

    try {
      this.state = deepMerge(structuredClone(DEFAULT_STATE), native);
    } catch {
      return false;
    }
    this.flush();
    this.emit('imported', this.state);
    return true;
  }

  /* ---------- 持久化 ---------- */
  save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.flush(), 400);
  }

  /** 立即落盘：同时写 localStorage 与原生存储 */
  flush() {
    clearTimeout(this._saveTimer);
    this.state._savedAt = Date.now();

    let json;
    try {
      json = JSON.stringify(this.state);
    } catch (e) {
      console.warn('[store] 序列化失败', e);
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, json);
    } catch (e) {
      console.warn('[store] localStorage 写入失败（可能超出配额）', e);
      if (this.state.recent.length > 50) {
        this.state.recent = this.state.recent.slice(0, 50);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch { /* noop */ }
      }
    }

    const bridge = NATIVE_BRIDGE();
    if (bridge) {
      try { bridge.saveStore(json); } catch { /* noop */ }
    }
  }

  /* ---------- 设置 ---------- */
  setSettings(patch) {
    // 值没变就别折腾：开关来回点、滑块抖动都会走到这里，
    // 每次都 stringify 全量状态再写两处存储，状态一大就是肉眼可见的卡。
    let changed = false;
    for (const k of Object.keys(patch)) {
      const a = this.state.settings[k];
      const b = patch[k];
      if (JSON.stringify(a) !== JSON.stringify(b)) { changed = true; break; }
    }
    if (!changed) return;

    this.state.settings = deepMerge(this.state.settings, patch);
    // 设置项不是关键数据，交给 debounce 合并写入；
    // 真正退到后台时 onPause 会强制 flush，不会丢。
    this.save();
    this.emit('settings', this.state.settings);
  }

  get settings() {
    return this.state.settings;
  }

  /* ---------- 账号 ---------- */
  getAccount(source) {
    return this.state.accounts[source] || null;
  }

  setAccount(source, data) {
    this.state.accounts[source] = { ...data, updatedAt: Date.now() };
    this.flush();
    this.emit('accounts', this.state.accounts);
  }

  clearAccount(source) {
    delete this.state.accounts[source];
    this.flush();
    this.emit('accounts', this.state.accounts);
  }

  /* ---------- 喜欢 ---------- */
  static keyOf(track) {
    if (!track) return '';
    return `${track.source}:${track.id}`;
  }

  isLiked(track) {
    const k = Store.keyOf(track);
    return this.state.liked.some((t) => Store.keyOf(t) === k);
  }

  toggleLike(track) {
    const k = Store.keyOf(track);
    const idx = this.state.liked.findIndex((t) => Store.keyOf(t) === k);
    let liked;
    if (idx >= 0) {
      this.state.liked.splice(idx, 1);
      liked = false;
    } else {
      this.state.liked.unshift({ ...track, likedAt: Date.now() });
      liked = true;
    }
    this.flush();
    this.emit('liked', this.state.liked);
    return liked;
  }

  /* ---------- 本地歌单 ---------- */
  createPlaylist(name, desc = '') {
    const pl = {
      id: `pl_${Date.now().toString(36)}`,
      name: name || '新建歌单',
      desc,
      cover: '',
      createdAt: Date.now(),
      tracks: [],
    };
    this.state.playlists.unshift(pl);
    this.flush();
    this.emit('playlists', this.state.playlists);
    return pl;
  }

  getPlaylist(id) {
    return this.state.playlists.find((p) => p.id === id) || null;
  }

  updatePlaylist(id, patch) {
    const pl = this.getPlaylist(id);
    if (!pl) return null;
    Object.assign(pl, patch);
    this.flush();
    this.emit('playlists', this.state.playlists);
    return pl;
  }

  deletePlaylist(id) {
    this.state.playlists = this.state.playlists.filter((p) => p.id !== id);
    this.flush();
    this.emit('playlists', this.state.playlists);
  }

  addTracksToPlaylist(id, tracks) {
    const pl = this.getPlaylist(id);
    if (!pl) return 0;
    const existing = new Set(pl.tracks.map(Store.keyOf));
    let added = 0;
    for (const t of tracks) {
      const k = Store.keyOf(t);
      if (existing.has(k)) continue;
      existing.add(k);
      pl.tracks.push(t);
      added++;
    }
    if (!pl.cover && pl.tracks[0]?.cover) pl.cover = pl.tracks[0].cover;
    this.flush();
    this.emit('playlists', this.state.playlists);
    return added;
  }

  removeTrackFromPlaylist(id, track) {
    const pl = this.getPlaylist(id);
    if (!pl) return;
    const k = Store.keyOf(track);
    pl.tracks = pl.tracks.filter((t) => Store.keyOf(t) !== k);
    this.flush();
    this.emit('playlists', this.state.playlists);
  }

  /* ---------- 最近播放 ---------- */
  recordPlay(track) {
    if (!track) return;
    const k = Store.keyOf(track);
    this.state.recent = [track, ...this.state.recent.filter((t) => Store.keyOf(t) !== k)].slice(0, 100);
    this.state.stats.plays = (this.state.stats.plays || 0) + 1;
    this.flush();
    this.emit('recent', this.state.recent);
  }

  clearRecent() {
    this.state.recent = [];
    this.flush();
    this.emit('recent', this.state.recent);
  }

  /* ---------- 搜索历史 ---------- */
  addSearchHistory(q) {
    const s = String(q || '').trim();
    if (!s) return;
    this.state.recentSearches = [s, ...this.state.recentSearches.filter((x) => x !== s)].slice(0, 12);
    this.flush();
  }

  clearSearchHistory() {
    this.state.recentSearches = [];
    this.flush();
    this.emit('searchHistory', []);
  }

  /* ---------- 队列 ---------- */
  setQueue(tracks, index = 0) {
    this.state.queue = tracks.slice();
    this.state.queueIndex = index;
    this.flush();
    this.emit('queue', this.state.queue);
  }

  enqueue(tracks, { next = false } = {}) {
    const list = Array.isArray(tracks) ? tracks : [tracks];
    if (next && this.state.queue.length) {
      this.state.queue.splice(this.state.queueIndex + 1, 0, ...list);
    } else {
      this.state.queue.push(...list);
    }
    this.flush();
    this.emit('queue', this.state.queue);
  }

  removeFromQueue(index) {
    if (index < 0 || index >= this.state.queue.length) return;
    this.state.queue.splice(index, 1);
    if (index < this.state.queueIndex) this.state.queueIndex--;
    else if (index === this.state.queueIndex) {
      this.state.queueIndex = Math.min(this.state.queueIndex, this.state.queue.length - 1);
    }
    this.flush();
    this.emit('queue', this.state.queue);
  }

  clearQueue() {
    this.state.queue = [];
    this.state.queueIndex = -1;
    this.flush();
    this.emit('queue', this.state.queue);
  }

  /* ---------- 数据导入导出 ---------- */
  exportData() {
    return {
      ...this.state,
      exportedAt: new Date().toISOString(),
      app: 'BM Free Music',
    };
  }

  importData(data, { merge = true } = {}) {
    if (!data || typeof data !== 'object') throw new Error('数据格式无效');
    if (!merge) {
      this.state = deepMerge(structuredClone(DEFAULT_STATE), data);
    } else {
      if (Array.isArray(data.playlists)) {
        const ids = new Set(this.state.playlists.map((p) => p.id));
        data.playlists.forEach((p) => { if (!ids.has(p.id)) this.state.playlists.push(p); });
      }
      if (Array.isArray(data.liked)) {
        const keys = new Set(this.state.liked.map(Store.keyOf));
        data.liked.forEach((t) => { if (!keys.has(Store.keyOf(t))) this.state.liked.push(t); });
      }
      if (data.settings) this.state.settings = deepMerge(this.state.settings, data.settings);
      if (data.accounts) this.state.accounts = { ...this.state.accounts, ...data.accounts };
    }
    this.flush();
    this.emit('imported', this.state);
    return this.state;
  }

  resetAll() {
    this.state = structuredClone(DEFAULT_STATE);
    this.flush();
    const bridge = NATIVE_BRIDGE();
    if (bridge?.clearStore) {
      try { bridge.clearStore(); } catch { /* noop */ }
    }
    this.emit('reset', this.state);
  }
}

export const store = new Store();
export { DEFAULT_STATE };
