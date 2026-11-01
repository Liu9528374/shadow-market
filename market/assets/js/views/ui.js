/**
 * 视图共享 UI 小件（重设计：资源卡 / 封面 / 收藏按钮 / 区块头）
 * 供 views/home.js（工作台）、views/market.js（市场）、views/resource.js（详情）复用。
 */

import { el, elFromHtml, fmtDuration, fmtDate } from '../dom.js';
import { icon } from '../icons.js';
import { t, pickLang } from '../i18n.js';
import { MarketPoints } from '../points.js';
import { pluginFor, getState } from '../data.js';

/** 品牌母题：五段声波（取自 APP 图标），装饰性图形，颜色随 currentColor */
export const WAVE_SVG = '<svg class="wave" viewBox="0 0 160 60" aria-hidden="true"><g fill="currentColor"><rect x="2" y="23" width="22" height="10" rx="5"/><rect x="36" y="14" width="9" height="34" rx="4.5"/><rect x="55" y="4" width="9" height="52" rx="4.5"/><rect x="74" y="17" width="9" height="28" rx="4.5"/><rect x="93" y="23" width="22" height="10" rx="5"/></g></svg>';

function hashCover(id) {
  const s = String(id || '');
  let n = 0;
  for (let i = 0; i < s.length; i += 1) n = (n + s.charCodeAt(i) * (i + 3)) % 997;
  return n % 5;
}

export function typeLabel(resource) {
  const plugin = pluginFor(resource?.type);
  return pickLang(plugin.label, plugin.labelEn);
}

export function authorName(resource) {
  const catalog = getState().catalog;
  return catalog?.authorMap.get(resource?.author)?.name || resource?.authorName || resource?.author || '';
}

function favoriteButton(resource) {
  const on = MarketPoints.isFavorite(resource.id);
  const btn = el('button', {
    class: `res-fav${on ? ' is-on' : ''}`,
    type: 'button',
    'aria-pressed': on ? 'true' : 'false',
    'aria-label': on ? t('取消收藏') : t('收藏'),
    title: on ? t('取消收藏') : t('收藏'),
    onclick: async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const result = MarketPoints.toggleFavorite(resource.id);
      const now = Boolean(result.favorite);
      btn.classList.toggle('is-on', now);
      btn.setAttribute('aria-pressed', now ? 'true' : 'false');
      btn.setAttribute('aria-label', now ? t('取消收藏') : t('收藏'));
      btn.replaceChildren(icon('star', 16));
      try { const { toast } = await import('../components.js'); toast(now ? t('已收藏（仅保存在本机浏览器）') : t('已取消收藏'), { kind: 'success', timeout: 2200 }); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent('market:favoriteschange', { detail: { id: resource.id, favorite: now } }));
    },
  }, icon('star', 16));
  return btn;
}

/** 资源封面：cover-1..5 + 声波母题；market 变体显示类型文字，dashboard 变体显示 Free 徽标 */
export function coverNode(resource, { variant = 'market' } = {}) {
  const n = hashCover(resource.id);
  const cover = el('div', { class: `cover${n ? ` cover-${n + 1}` : ''}` });
  cover.append(elFromHtml(WAVE_SVG));
  if (variant === 'dashboard') {
    if (resource.free !== false) cover.append(el('span', { class: 'badge badge-soft' }, 'Free'));
  } else {
    cover.append(el('span', { class: 'cover-type', text: typeLabel(resource) }));
  }
  return cover;
}

/**
 * 资源卡（设计稿卡片）：
 * - variant=market：封面左上类型文字，无 chip 云；标题+等级，描述 2 行，meta 句数/时长/收藏
 * - variant=dashboard：封面 Free 徽标 + 标签 chip 行（工作台「为你推荐」用）
 */
export function resourceCard(resource, { variant = 'market', index = 0 } = {}) {
  const href = `#/resource/${encodeURIComponent(resource.id)}`;
  const meta = el('div', { class: 'res-meta' });
  const stats = resource.stats || {};
  if (stats.sentences) meta.append(el('span', {}, icon('file-text', 14), t('{n} 句', { n: stats.sentences })));
  if (stats.durationSec) meta.append(el('span', {}, icon('clock', 14), fmtDuration(stats.durationSec)));
  if (resource.type === 'course' || resource.type === 'subtitle') meta.append(el('span', { class: 'nowrap' }, resource.mediaMode === 'byom' || !resource.mediaMode ? 'BYOM' : resource.mediaMode));
  meta.append(favoriteButton(resource));

  const body = el('div', { class: 'res-body' },
    el('span', { class: 'res-title' }, resource.title, resource.level ? el('span', { class: 'badge badge-outline' }, resource.level) : null),
    el('span', { class: 'res-sub', text: [resource.subtitle, authorName(resource)].filter(Boolean).join(' · ') }),
    el('p', { class: 'res-desc', text: resource.description || '' }),
    variant === 'dashboard' && resource.tags?.length
      ? el('div', { class: 'tag-row' }, resource.tags.slice(0, 3).map((tag) => el('span', { class: 'chip', text: tag })))
      : null,
    meta,
  );

  return el('a', { class: 'res-card', href, 'data-resource-id': resource.id, 'data-testid': 'resource-card', dataset: { index: String(index) } },
    coverNode(resource, { variant }),
    body,
  );
}

/** 区块头：标题 + 副标 + 右侧链接 */
export function sectionHead(title, sub = '', link = null) {
  const head = el('div', { class: 'section-head' },
    el('div', {},
      el('h2', { class: 'section-title', text: title }),
      sub ? el('p', { class: 'section-sub', text: sub }) : null,
    ),
  );
  if (link) {
    head.append(el('a', { class: 'section-link', href: link.href },
      link.label,
      icon('arrow-right', 16),
    ));
  }
  return head;
}

/** 空状态卡（工作台/市场共用） */
export function emptyCard({ iconName = 'info', title, desc = '', action = null }) {
  return el('div', { class: 'card', style: { textAlign: 'center', padding: '34px 24px' } },
    el('div', { class: 'empty', style: { padding: '0' } },
      el('span', { class: 'empty-art', style: { width: '58px', height: '58px', borderRadius: '16px', background: 'var(--amber-soft)', display: 'grid', placeItems: 'center', margin: '0 auto 14px', color: 'var(--amber)' } }, icon(iconName, 26)),
      el('p', { class: 'empty-title', text: title }),
      desc ? el('p', { class: 'empty-text', text: desc }) : null,
      action ? el('div', { style: { marginTop: '14px' } },
        el('a', { class: `btn ${action.kind === 'primary' ? 'btn-primary' : 'btn-secondary'}`, href: action.href, onclick: action.onClick || null }, action.label)) : null,
    ),
  );
}

export function fmtUpdated(resource) {
  const d = resource?.updatedAt || resource?.versions?.[0]?.publishedAt;
  return d ? fmtDate(d) : '';
}

/** 让出两帧：已插入的头部/首屏先绘制（LCP 优化），再继续插入网格等重内容 */
export function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
