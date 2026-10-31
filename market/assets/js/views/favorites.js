/** 我的收藏：本地收藏列表 + 空态（GitHub Star 列表逻辑，无需登录） */

import { el } from '../dom.js';
import { icon } from '../icons.js';
import { pageHead, resourceCard, emptyState, toast } from '../components.js';
import { getState } from '../data.js';
import { MarketPoints } from '../points.js';
import { t } from '../i18n.js';

export function renderFavorites(view) {
  const state = getState();
  view.replaceChildren();
  const ids = MarketPoints.getFavorites();
  const resources = ids.map((id) => state.catalog?.resources.find((r) => r.id === id)).filter(Boolean);

  view.append(pageHead({
    title: t('我的收藏'),
    sub: t('收藏是本地功能：收藏的资源只保存在这台设备的浏览器里，不会上传。'),
    count: resources.length,
    actions: [
      { label: t('去探索资源'), href: '#/', icon: 'compass', kind: resources.length ? '' : 'primary' },
      { label: t('清除全部收藏'), icon: 'trash', onClick: () => clearAll(view), disabled: resources.length === 0 },
    ],
  }));

  if (resources.length === 0) {
    view.append(emptyState({
      iconName: 'star',
      title: t('还没有收藏'),
      desc: t('在资源详情页点「收藏」，资源会出现在这里；收藏只保存在本机浏览器。'),
      actions: [
        { label: t('去探索资源'), href: '#/', kind: 'primary', icon: 'compass' },
        { label: t('投稿指南'), href: '#/contribute', icon: 'book' },
        { label: t('一键导入说明'), href: '#/import', icon: 'upload' },
      ],
    }));
    return;
  }

  const removed = new Set(ids.filter((id) => !state.catalog?.resources.find((r) => r.id === id)));
  if (removed.size) {
    view.append(el('div', { class: 'notice', style: { marginTop: '12px' } },
      icon('alert', 16, 'notice-icon'),
      el('div', {}, t('有 {n} 个收藏的资源已不在当前目录中（可能已下架）。', { n: removed.size })),
    ));
  }

  view.append(el('div', { class: 'res-list', role: 'list', 'aria-label': t('我的收藏'), 'data-testid': 'favorites-list' },
    resources.map((resource) => resourceCard(resource)),
  ));
}

function clearAll(view) {
  const ids = MarketPoints.getFavorites();
  for (const id of ids) {
    if (MarketPoints.isFavorite(id)) MarketPoints.toggleFavorite(id);
  }
  window.dispatchEvent(new CustomEvent('market:favoriteschange', { detail: { cleared: true } }));
  toast(t('已清除全部收藏（仅本机）'), { kind: 'success' });
  renderFavorites(view);
}
