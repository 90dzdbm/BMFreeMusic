/**
 * playfail.js — 记录哪些曲目解析失败过
 *
 * 用途：
 *   1. 列表里给播不了的歌打上「无法播放」标记
 *   2. 再次点击时直接跳过原源，优先走兜底链路
 *
 * 只存在内存里，刷新即清空 —— 网络恢复后应该重新尝试。
 */

const failed = new Map(); // key -> { reason, at }
const MAX = 600;

export function markFailed(track, reason = '无法获取音频') {
  if (!track) return;
  if (failed.size > MAX) failed.clear();
  failed.set(track.key, { reason, at: Date.now() });
}

export function clearFailed(track) {
  if (!track) return;
  failed.delete(track.key);
}

export function failInfo(track) {
  if (!track) return null;
  return failed.get(track.key) || null;
}

export function isFailed(track) {
  return !!failInfo(track);
}

export function failedCount() {
  return failed.size;
}

export function resetAll() {
  failed.clear();
}
