/**
 * player.js — 播放内核
 *
 * 负责：队列调度、URL 解析、播放控制、循环/随机、MediaSession、事件广播
 */

import { store } from './store.js';
import { resolveTrack, getLyric, parseLrc } from '../api/sources.js';
import { markFailed, clearFailed } from './playfail.js';

class Player {
  constructor() {
    this.audio = document.getElementById('audio');
    this.state = 'idle';          // idle | loading | playing | paused | error
    this.current = null;
    this.lyric = { lines: [], raw: '', tlyric: '' };
    this._listeners = new Map();
    this._resolveToken = 0;
    this._waitingGesture = false;   // 自动播放被拦，等待用户手势
    this._bindAudio();
    this._restoreVolume();
  }

  /* ---------------- 事件 ---------------- */
  on(evt, fn) {
    if (!this._listeners.has(evt)) this._listeners.set(evt, new Set());
    this._listeners.get(evt).add(fn);
    return () => this._listeners.get(evt)?.delete(fn);
  }

  emit(evt, payload) {
    this._listeners.get(evt)?.forEach((fn) => {
      try { fn(payload); } catch (e) { console.error(`[player] ${evt}`, e); }
    });
  }

  /* ---------------- 初始化 ---------------- */
  _restoreVolume() {
    const s = store.settings;
    this.audio.volume = Math.min(1, Math.max(0, s.volume ?? 0.8));
    this.audio.muted = !!s.muted;
  }

  _bindAudio() {
    const a = this.audio;

    a.addEventListener('play', () => {
      this.state = 'playing';
      this.emit('state', this.state);
      this._updateMediaSession();
    });

    a.addEventListener('pause', () => {
      if (this.state === 'error') return;
      this.state = 'paused';
      this.emit('state', this.state);
    });

    a.addEventListener('timeupdate', () => {
      this.emit('time', { current: a.currentTime * 1000, duration: (a.duration || 0) * 1000 });
    });

    a.addEventListener('durationchange', () => {
      this.emit('duration', (a.duration || 0) * 1000);
    });

    a.addEventListener('ended', () => {
      this.emit('ended');
      this._handleEnded();
    });

    a.addEventListener('error', () => {
      const err = a.error;
      const msg = err ? `音频错误 (code ${err.code})` : '音频加载失败';
      this.state = 'error';
      if (this.current) markFailed(this.current, msg);
      this.emit('error', { message: msg, track: this.current });
    });

    a.addEventListener('waiting', () => this.emit('buffering', true));
    a.addEventListener('canplay', () => this.emit('buffering', false));
    a.addEventListener('playing', () => this.emit('buffering', false));
  }

  /* ---------------- 队列 ---------------- */
  get queue() {
    return store.state.queue;
  }

  get index() {
    return store.state.queueIndex;
  }

  get isPlaying() {
    return this.state === 'playing';
  }

  /** 播放单曲并替换队列 */
  async playTrack(track, { queue = null, index = 0 } = {}) {
    if (queue) {
      store.setQueue(queue, index);
      this.emit('queue', store.state.queue);
    }
    await this._load(track);
  }

  /** 播放整个列表 */
  async playList(tracks, startIndex = 0) {
    const list = (tracks || []).filter(Boolean);
    if (!list.length) return;
    const idx = Math.max(0, Math.min(startIndex, list.length - 1));
    store.setQueue(list, idx);
    this.emit('queue', list);
    await this._load(list[idx]);
  }

  /** 加载并播放 */
  async _load(track, { autoplay = true } = {}) {
    if (!track) return;
    const token = ++this._resolveToken;

    this.current = track;
    this.state = 'loading';
    this.lyric = { lines: [], raw: '', tlyric: '' };
    this.emit('track', track);
    this.emit('state', this.state);
    this.emit('lyric', this.lyric);

    // 歌词并行拉取
    this._loadLyric(track);

    let res;
    try {
      res = await resolveTrack(track, { allowFallback: true });
    } catch (e) {
      if (token !== this._resolveToken) return;
      markFailed(track, e.message);
      this.state = 'error';
      this.emit('error', { message: e.message, track });
      this.emit('state', this.state);
      return;
    }
    if (token !== this._resolveToken) return; // 已被更新的请求取代

    clearFailed(track);
    this.emit('playable', track);

    if (res.cover && !track.cover) {
      track.cover = res.cover;
      this.emit('track', track);
    }
    if (res.fallbackFrom) {
      this.emit('fallback', { from: track.source, via: res.matched, track });
    }

    this.audio.src = res.url;
    this.audio.load();

    if (autoplay) {
      try {
        await this.audio.play();
      } catch (e) {
        this._markBlocked(track, e);
        return;
      }
    }
    store.recordPlay(track);
  }

  async _loadLyric(track) {
    const token = this._resolveToken;
    try {
      const { lrc, tlyric } = await getLyric(track);
      if (token !== this._resolveToken) return;
      this.lyric = {
        raw: lrc,
        tlyric,
        lines: parseLrc(lrc),
      };
      this.emit('lyric', this.lyric);
    } catch {
      // 拉不到歌词也要通知界面，否则会一直停在初始的「…」
      if (token !== this._resolveToken) return;
      this.lyric = { raw: '', tlyric: '', lines: [] };
      this.emit('lyric', this.lyric);
    }
  }

  /* ---------------- 控制 ---------------- */
  async toggle() {
    if (!this.current) {
      // 没有当前曲目时，从队列或喜欢的歌开始
      const q = store.state.queue;
      if (q.length) return this._load(q[Math.max(0, store.state.queueIndex)]);
      if (store.state.liked.length) return this.playList(store.state.liked, 0);
      return;
    }
    if (this.audio.paused) {
      this._waitingGesture = false;
      try {
        await this.audio.play();
      } catch (e) {
        this._markBlocked(this.current, e);
      }
    } else {
      this._waitingGesture = false;
      this.audio.pause();
    }
  }

  pause() {
    this.audio.pause();
  }

  async resume() {
    if (!this.current) return this.toggle();
    this._waitingGesture = false;
    try {
      await this.audio.play();
      this.state = 'playing';
      this.emit('state', this.state);
    } catch (e) {
      this._markBlocked(this.current, e);
    }
  }

  /** 自动播放被浏览器/WebView 拦截：记住状态，等下一次用户手势自动续播 */
  _markBlocked(track, error) {
    this._waitingGesture = true;
    this.state = 'paused';
    this.emit('state', this.state);
    this.emit('blocked', { track, error });
  }

  /** 下一首；manual=true 表示用户主动切歌（单曲循环时不重复同一首） */
  async next(manual = false) {
    const q = store.state.queue;
    if (!q.length) return;

    if (store.settings.repeat === 'one' && !manual) {
      this.audio.currentTime = 0;
      return this.audio.play().catch(() => {});
    }

    let nextIndex;
    if (store.settings.shuffle) {
      nextIndex = this._randomIndex(q.length, store.state.queueIndex);
    } else {
      nextIndex = store.state.queueIndex + 1;
    }

    if (nextIndex >= q.length) {
      if (store.settings.repeat === 'all' || manual) {
        nextIndex = 0;
      } else {
        this.state = 'paused';
        this.emit('state', this.state);
        return;
      }
    }
    store.state.queueIndex = nextIndex;
    store.save();
    this.emit('queueindex', nextIndex);
    await this._load(q[nextIndex]);
  }

  async prev() {
    const q = store.state.queue;
    if (!q.length) return;
    // 播放超过 3 秒时，先回到本曲开头
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }
    let prevIndex = store.state.queueIndex - 1;
    if (prevIndex < 0) prevIndex = store.settings.repeat === 'all' ? q.length - 1 : 0;
    store.state.queueIndex = prevIndex;
    store.save();
    this.emit('queueindex', prevIndex);
    await this._load(q[prevIndex]);
  }

  _randomIndex(len, exclude) {
    if (len <= 1) return 0;
    let idx = exclude;
    let guard = 0;
    while (idx === exclude && guard++ < 12) idx = Math.floor(Math.random() * len);
    return idx;
  }

  async _handleEnded() {
    if (!store.settings.autoNext) {
      this.state = 'paused';
      this.emit('state', this.state);
      return;
    }
    await this.next(false);
  }

  /** 跳到列表中的某一首 */
  async jumpTo(index) {
    const q = store.state.queue;
    if (index < 0 || index >= q.length) return;
    store.state.queueIndex = index;
    store.save();
    this.emit('queueindex', index);
    await this._load(q[index]);
  }

  /* ---------------- 进度 / 音量 ---------------- */
  seek(ms) {
    const d = this.audio.duration;
    if (!d || !isFinite(d)) return;
    this.audio.currentTime = Math.max(0, Math.min(d - 0.05, ms / 1000));
  }

  setVolume(v) {
    const vol = Math.max(0, Math.min(1, v));
    this.audio.volume = vol;
    this.audio.muted = vol === 0;
    store.setSettings({ volume: vol, muted: this.audio.muted });
    this.emit('volume', vol);
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    store.setSettings({ muted: this.audio.muted });
    this.emit('volume', this.audio.muted ? 0 : this.audio.volume);
    return this.audio.muted;
  }

  setRepeat(mode) {
    store.setSettings({ repeat: mode });
    this.emit('repeat', mode);
  }

  cycleRepeat() {
    const order = ['off', 'all', 'one'];
    const cur = store.settings.repeat || 'off';
    const next = order[(order.indexOf(cur) + 1) % order.length];
    this.setRepeat(next);
    return next;
  }

  toggleShuffle() {
    const next = !store.settings.shuffle;
    store.setSettings({ shuffle: next });
    this.emit('shuffle', next);
    return next;
  }

  /* ---------------- MediaSession ---------------- */
  _updateMediaSession() {
    if (!('mediaSession' in navigator) || !this.current) return;
    const t = this.current;
    const artwork = t.cover ? [{ src: t.cover, sizes: '512x512', type: 'image/jpeg' }] : [];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.name,
        artist: t.artist,
        album: t.album,
        artwork,
      });
      navigator.mediaSession.setActionHandler('play', () => this.resume());
      navigator.mediaSession.setActionHandler('pause', () => this.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.next(true));
      navigator.mediaSession.setActionHandler('seekto', (d) => {
        if (d.seekTime != null) this.seek(d.seekTime * 1000);
      });
    } catch {
      /* 某些浏览器不支持 */
    }
  }

  /** 当前播放进度对应的歌词行索引 */
  currentLyricIndex() {
    const lines = this.lyric?.lines || [];
    if (!lines.length) return -1;
    const t = this.audio.currentTime * 1000 + 120;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].t <= t) idx = i;
      else break;
    }
    return idx;
  }
}

export const player = new Player();
export default player;
