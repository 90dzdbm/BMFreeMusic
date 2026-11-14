/**
 * views/sponsor.js — 赞助页（独立界面）
 */

import { icon } from '../ui/icons.js';
import { esc } from '../core/util.js';

export async function render(root) {
  root.innerHTML = `
    <div class="view">
      <div class="sponsor-page">
        <div class="sponsor-page__top">
          <button class="btn btn--text btn--sm" id="sponsorBack">
            ${icon('back', 'icon-sm')} 返回
          </button>
        </div>

        <div class="sponsor-page__head">
          <span class="sponsor__badge">${icon('heart_filled', 'icon-xs')} 支持这个项目</span>
          <h1 class="sponsor-page__title">如果它替你省下了一点会员费</h1>
          <p class="sponsor-page__desc">
            没有广告，没有会员，也没有埋点。
          </p>
        </div>

        <div class="sponsor__grid">
          <div class="sponsor-card">
            <button class="sponsor-card__qr" data-qr="./assets/sponsor-alipay.jpg" aria-label="放大支付宝收款码">
              <img src="./assets/sponsor-alipay.jpg" alt="支付宝收款码" loading="lazy">
            </button>
            <span class="sponsor-card__tag" data-pay="alipay">支付宝</span>
          </div>
          <div class="sponsor-card">
            <button class="sponsor-card__qr" data-qr="./assets/sponsor-wechat.jpg" aria-label="放大微信收款码">
              <img src="./assets/sponsor-wechat.jpg" alt="微信收款码" loading="lazy">
            </button>
            <span class="sponsor-card__tag" data-pay="wechat">微信支付</span>
          </div>
        </div>

        <p class="sponsor-page__note">
          无论你是否赞助，<strong>本播放器永远免费使用</strong>，开源万岁
        </p>

        <div class="sponsor-page__facts">
          <div class="sponsor-fact">
            <span class="sponsor-fact__num">9</span>
            <span class="sponsor-fact__label">个音源</span>
          </div>
          <div class="sponsor-fact">
            <span class="sponsor-fact__num">0</span>
            <span class="sponsor-fact__label">条广告</span>
          </div>
          <div class="sponsor-fact">
            <span class="sponsor-fact__num">0</span>
            <span class="sponsor-fact__label">元收费</span>
          </div>
        </div>
      </div>
    </div>`;

  root.querySelector('#sponsorBack')?.addEventListener('click', () => {
    if (history.length > 1) history.back();
    else location.hash = '#/discover';
  });

  root.querySelectorAll('[data-qr]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const zoom = document.createElement('div');
      zoom.className = 'qr-zoom';
      zoom.innerHTML = `<img src="${esc(btn.dataset.qr)}" alt="收款二维码">`;
      zoom.addEventListener('click', () => zoom.remove());
      document.body.appendChild(zoom);
    });
  });
}
