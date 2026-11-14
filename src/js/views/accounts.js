/**
 * views/accounts.js — 平台账号绑定
 */

import { store, SOURCES, BINDABLE_SOURCES } from '../core/store.js';
import { proxyJSON } from '../api/gateway.js';
import { openDialog, closeDialog, confirmDialog } from '../ui/components.js';
import { esc } from '../core/util.js';
import { icon } from '../ui/icons.js';
import { toastSuccess, toastError, toast } from '../ui/toast.js';

const GUIDE = {
  netease: {
    site: 'https://music.163.com',
    steps: '登录 music.163.com → F12 打开开发者工具 → Application/存储 → Cookies → 复制 MUSIC_U 与 __csrf 两项的值，拼成 MUSIC_U=xxx; __csrf=yyy',
    hint: '绑定后可读取你的歌单、每日推荐，并提升音质上限。',
  },
  qq: {
    site: 'https://y.qq.com',
    steps: '登录 y.qq.com → F12 → Application → Cookies → 复制 qm_keyst 与 uin 两项，拼成 uin=xxx; qm_keyst=yyy',
    hint: 'QQ 音乐的付费曲目仍需会员权限，绑定后能拿到更多 vkey。',
  },
  kugou: {
    site: 'https://www.kugou.com',
    steps: '登录 kugou.com → F12 → Application → Cookies → 复制 KuGoo 与 token 两项',
    hint: '绑定后可读取酷狗收藏歌单。',
  },
  kuwo: {
    site: 'https://www.kuwo.cn',
    steps: '登录 kuwo.cn → F12 → Application → Cookies → 复制 kw_token 与 Hm_lvt 两项',
    hint: '绑定后可读取酷我歌单。',
  },
  migu: {
    site: 'https://music.migu.cn',
    steps: '登录 music.migu.cn → F12 → Application → Cookies → 复制 uid 与 token 两项',
    hint: '咪咕主要用于搜索补全，绑定后可用曲库更完整。',
  },
  bilibili: {
    site: 'https://www.bilibili.com',
    steps: '登录 bilibili.com → F12 → Application → Cookies → 复制 SESSDATA 一项',
    hint: 'B 站音源为实验性功能，绑定后可解析高清音频流。',
  },
};

export async function render(root) {
  const accounts = store.state.accounts || {};
  const native = hasNative();

  // 安卓端：网页登录成功后的回调
  window.__bmfmLoginResult = (raw) => {
    let data;
    try {
      data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      toastError('登录结果解析失败');
      return;
    }
    if (!data?.source || !data.cookie) {
      toastError('未获取到登录凭证');
      return;
    }
    applyNativeLogin(root, data.source, data.cookie);
  };

  root.innerHTML = `
    <div class="view">
      <div class="view-head">
        <div class="view-head__text">
          <h1>平台账号</h1>
          <p>${native
            ? '登录后即可读取该平台上的歌单'
            : '绑定后可读取该平台上的歌单，凭证只存在本机'}</p>
        </div>
        <div class="view-head__actions">
          <button class="btn btn--outline" id="exportAcc">${icon('download')} 导出凭证</button>
        </div>
      </div>

      <div class="platform-grid" id="grid">
        ${BINDABLE_SOURCES.map((key) => platformCard(key, accounts[key], native)).join('')}
      </div>

      <p class="muted-note">
        ${icon('info', 'icon-xs')} 凭证只存在本机，清空应用数据即删除
      </p>
    </div>`;

  root.querySelector('#grid')?.addEventListener('click', async (e) => {
    // 网页登录（仅 APK）
    const webBtn = e.target.closest('[data-weblogin]');
    if (webBtn) {
      const key = webBtn.dataset.weblogin;
      if (!window.BMFMAndroid?.openLogin) {
        toast('当前环境不支持网页登录');
        return;
      }
      window.BMFMAndroid.openLogin(key);
      return;
    }

    const bindBtn = e.target.closest('[data-bind]');
    if (bindBtn) return openBindDialog(root, bindBtn.dataset.bind);

    const unbindBtn = e.target.closest('[data-unbind]');
    if (unbindBtn) {
      const key = unbindBtn.dataset.unbind;
      const ok = await confirmDialog({
        title: `解绑 ${SOURCES[key].name}？`,
        desc: '解绑后无法读取该平台的私人歌单，已导入到本地的歌曲不受影响。',
        okLabel: '解绑',
        danger: true,
      });
      if (ok) {
        store.clearAccount(key);
        toastSuccess('已解绑');
        render(root);
      }
      return;
    }

    const verifyBtn = e.target.closest('[data-verify]');
    if (verifyBtn) {
      const key = verifyBtn.dataset.verify;
      const acc = store.getAccount(key);
      if (!acc) return;
      verifyBtn.disabled = true;
      const res = await verifyAccount(key, acc.cookie);
      verifyBtn.disabled = false;
      if (res.ok) {
        store.setAccount(key, { ...acc, ...res.profile, cookie: acc.cookie });
        toastSuccess(`验证通过：${res.profile.nickname || '已登录'}`);
        render(root);
      } else {
        toastError(`验证失败：${res.error}`);
      }
    }
  });

  root.querySelector('#exportAcc')?.addEventListener('click', () => {
    const data = JSON.stringify(store.state.accounts, null, 2);
    navigator.clipboard?.writeText(data).then(
      () => toastSuccess('凭证已复制到剪贴板'),
      () => toast('复制失败，可手动在开发者工具中查看 localStorage'),
    );
  });
}

/* --------------------------------------------------------------------------
   安卓网页登录：拿到 Cookie 后校验并落库
   -------------------------------------------------------------------------- */
async function applyNativeLogin(root, source, cookie) {
  const name = SOURCES[source]?.name || source;
  store.setAccount(source, { cookie, nickname: '登录中…', verified: false });

  const res = await verifyAccount(source, cookie);
  if (res.ok) {
    store.setAccount(source, { cookie, ...res.profile, verified: true });
    toastSuccess(`${name} 登录成功${res.profile.nickname ? '：' + res.profile.nickname : ''}`);
  } else {
    store.setAccount(source, { cookie, nickname: '已登录', verified: false });
    toast(`${name} 凭证已保存（校验接口暂无响应）`);
  }

  // 当前就在账号页就原地刷新，否则不动
  if (location.hash.startsWith('#/accounts')) {
    render(root);
  }
}

function hasNative() {
  try {
    return !!(window.BMFMAndroid && window.BMFMAndroid.available && window.BMFMAndroid.available());
  } catch {
    return false;
  }
}

function platformCard(key, acc, native) {
  const info = SOURCES[key];
  const linked = !!acc;
  return `
    <div class="platform-card ${linked ? 'is-linked' : ''}">
      <div class="platform-card__head">
        <div class="platform-card__logo" style="background:${info.color}">${esc(info.logo)}</div>
        <div style="min-width:0">
          <div class="platform-card__name">
            ${esc(info.name)}
            ${linked ? `<span class="source-tag" data-src="${key}">已绑定</span>` : ''}
          </div>
          <div class="platform-card__status ${linked ? 'is-on' : ''}">
            <span class="dot"></span>
            ${linked ? esc(acc.nickname || '已登录') : '未绑定'}
          </div>
        </div>
      </div>
      <p class="platform-card__desc">${esc(GUIDE[key]?.hint || '')}</p>
      <div class="platform-card__foot">
        ${native
          ? `<button class="btn btn--filled btn--sm" data-weblogin="${key}">
               ${icon('link', 'icon-sm')} 网页登录
             </button>`
          : ''}
        <button class="btn ${native ? 'btn--text' : 'btn--tonal'} btn--sm" data-bind="${key}">
          ${linked ? '重新绑定' : (native ? '粘贴 Cookie' : '绑定账号')}
        </button>
        ${linked ? `<button class="btn btn--text btn--sm" data-verify="${key}">验证</button>
                    <button class="btn btn--text btn--sm" data-unbind="${key}"
                            style="color:var(--error)">解绑</button>` : ''}
      </div>
    </div>`;
}

function openBindDialog(root, key) {
  const info = SOURCES[key];
  const guide = GUIDE[key];
  const existing = store.getAccount(key);

  openDialog({
    title: `绑定 ${info.name}`,
    desc: '把浏览器里该网站的 Cookie 粘贴到下面即可，格式为 key=value; key2=value2',
    bodyHTML: `
      <div class="field">
        <label class="field__label" for="cookieInput">Cookie</label>
        <textarea class="input" id="cookieInput" placeholder="例如：MUSIC_U=xxxxx; __csrf=yyyyy"
          spellcheck="false" style="font-family:var(--font-mono);font-size:12px">${esc(existing?.cookie || '')}</textarea>
        <span class="field__hint">${esc(guide.steps)}</span>
      </div>
      <div class="field" style="margin-top:var(--sp-4)">
        <label class="field__label" for="nickInput">备注昵称（可选）</label>
        <input class="input" id="nickInput" value="${esc(existing?.nickname || '')}" placeholder="例如：我的小号">
      </div>
      <p style="margin-top:var(--sp-3);font-size:12px;color:var(--on-surface-muted)">
        提示：在 <a href="${guide.site}" target="_blank" rel="noopener">${guide.site.replace('https://', '')}</a>
        登录后按 F12 打开开发者工具即可看到 Cookie。
      </p>`,
    actions: [
      { label: '取消' },
      {
        label: '保存并验证',
        primary: true,
        keepOpen: true,
        onClick: async ({ dialog }) => {
          const cookie = dialog.querySelector('#cookieInput')?.value?.trim();
          const nickname = dialog.querySelector('#nickInput')?.value?.trim();
          if (!cookie) {
            toastError('请先粘贴 Cookie');
            return false;
          }
          const btn = dialog.querySelector('.dialog__actions .btn--filled');
          if (btn) { btn.disabled = true; btn.textContent = '验证中…'; }
          const res = await verifyAccount(key, cookie);
          if (btn) { btn.disabled = false; btn.textContent = '保存并验证'; }

          store.setAccount(key, {
            cookie,
            nickname: res.ok ? (res.profile.nickname || nickname || '已登录') : (nickname || '已保存'),
            avatar: res.ok ? res.profile.avatar : '',
            uid: res.ok ? res.profile.uid : '',
            verified: res.ok,
            error: res.ok ? '' : res.error,
          });

          if (res.ok) {
            toastSuccess(`${info.name} 绑定成功`);
          } else {
            toast(`凭证已保存，但验证未通过：${res.error}`);
          }
          closeDialog();
          render(root);
          return false;
        },
      },
    ],
  });
}

/* --------------------------------------------------------------------------
   验证
   -------------------------------------------------------------------------- */
export async function verifyAccount(key, cookie) {
  try {
    if (key === 'netease') {
      const data = await proxyJSON('https://music.163.com/api/nuser/account/get', {
        method: 'POST',
        body: '',
        referer: 'https://music.163.com/',
        cookie: `appver=2.0.2; os=pc; ${cookie}`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      if (data?.account?.id) {
        return {
          ok: true,
          profile: {
            nickname: data.profile?.nickname || `用户${data.account.id}`,
            avatar: data.profile?.avatarUrl || '',
            uid: String(data.account.id),
          },
        };
      }
      return { ok: false, error: data?.msg || 'Cookie 无效或已过期' };
    }

    if (key === 'bilibili') {
      const data = await proxyJSON('https://api.bilibili.com/x/web-interface/nav', {
        referer: 'https://www.bilibili.com/',
        cookie,
        headers: { 'user-agent': 'Mozilla/5.0' },
      });
      if (data?.data?.isLogin) {
        return {
          ok: true,
          profile: {
            nickname: data.data.uname,
            avatar: data.data.face || '',
            uid: String(data.data.mid || ''),
          },
        };
      }
      return { ok: false, error: '未登录或 SESSDATA 已失效' };
    }

    if (key === 'kugou') {
      const data = await proxyJSON('https://www.kugou.com/yy/index.php?r=user/get_user_info', {
        referer: 'https://www.kugou.com/',
        cookie,
        headers: { 'user-agent': 'Mozilla/5.0' },
      });
      if (data?.data?.nickname) {
        return { ok: true, profile: { nickname: data.data.nickname, avatar: data.data.pic || '', uid: String(data.data.userid || '') } };
      }
      return { ok: false, error: 'Cookie 无效' };
    }

    if (key === 'qq') {
      // QQ 音乐没有稳定的公开用户信息接口，这里做格式校验
      if (/uin=\d+/.test(cookie) && /qm_keyst=/.test(cookie)) {
        const uin = cookie.match(/uin=(\d+)/)?.[1] || '';
        return { ok: true, profile: { nickname: `QQ ${uin.slice(0, 3)}***${uin.slice(-2)}`, avatar: '', uid: uin } };
      }
      return { ok: false, error: 'Cookie 中缺少 uin 或 qm_keyst' };
    }

    if (key === 'kuwo' || key === 'migu') {
      if (cookie.length < 8) return { ok: false, error: 'Cookie 过短' };
      return { ok: true, profile: { nickname: '已保存凭证', avatar: '', uid: '' } };
    }

    return { ok: true, profile: { nickname: '已保存凭证', avatar: '', uid: '' } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
