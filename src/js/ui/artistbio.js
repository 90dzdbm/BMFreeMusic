/**
 * ui/artistbio.js — 歌手简介弹窗
 */

import { openDialog, closeDialog } from './components.js';
import { getArtistBio } from '../api/wiki.js';
import { esc } from '../core/util.js';
import { icon } from './icons.js';

export async function showArtistBio(rawName) {
  const name = String(rawName || '').split('/')[0].trim();
  if (!name) return;

  openDialog({
    title: '歌手简介',
    bodyHTML: `
      <div class="bio" id="bioBox">
        <div class="bio__loading">${icon('sync', 'icon-sm')} 正在查询「${esc(name)}」…</div>
      </div>`,
    actions: [{ label: '关闭', onClick: closeDialog }],
    width: 'min(560px, 92vw)',
  });

  const box = document.getElementById('bioBox');
  if (!box) return;

  const bio = await getArtistBio(name);
  const current = document.getElementById('bioBox');
  if (!current) return; // 用户已经关掉了

  if (!bio) {
    current.innerHTML = `
      <div class="bio__empty">
        ${icon('info', 'icon-lg')}
        <p>没有找到「${esc(name)}」的简介</p>
      </div>`;
    return;
  }

  current.innerHTML = `
    <div class="bio__head">
      ${bio.thumb
        ? `<img class="bio__avatar" src="${esc(bio.thumb)}" alt="" onerror="this.remove()">`
        : `<div class="bio__avatar bio__avatar--empty">${icon('artist', 'icon-lg')}</div>`}
      <div class="bio__meta">
        <div class="bio__name">${esc(bio.title || name)}</div>
        ${bio.description ? `<div class="bio__desc">${esc(bio.description)}</div>` : ''}
      </div>
    </div>
    ${bio.extract ? `<div class="bio__text">${esc(bio.extract)}</div>` : ''}
    ${bio.fields?.length ? `
      <div class="bio__fields">
        ${bio.fields.map((f) => `
          <div class="bio__field">
            <span class="bio__field-label">${esc(f.label)}</span>
            <span class="bio__field-value">${esc(f.value)}</span>
          </div>`).join('')}
      </div>` : ''}
    <a class="bio__source" href="${esc(bio.url)}" target="_blank" rel="noopener noreferrer">
      ${icon('link', 'icon-xs')} 内容来自${esc(bio.source || '维基百科')}
    </a>`;
}
