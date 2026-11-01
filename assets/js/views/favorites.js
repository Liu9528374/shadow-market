/**
 * 我的资源 · 收藏（#/favorites）
 * Tabs：收藏 / 已下载 / 最近导入（本地 localStorage，无账号、不上传）
 * 数据源：MarketPoints（收藏 / 我的资源）+ catalog（资源标题与链接）
 */

import { el, elFromHtml, fmtRelative, fmtDate } from '../dom.js';
import { icon } from '../icons.js';
import { t, pickLang } from '../i18n.js';
import { getState, resourceById } from '../data.js';
import { MarketPoints, POINTS_STORAGE_KEY } from '../points.js';
import { toast, confirmDialog } from '../components.js';
import { currentRoute } from '../router.js';

const TABS = [
  { id: 'favorites', label: t('收藏'), iconName: 'star' },
  { id: 'downloads', label: t('已下载'), iconName: 'download' },
  { id: 'imports', label: t('最近导入'), iconName: 'upload' },
];

function waveArt(cls = 'empty-art') {
  return elFromHtml(`<svg class="${cls}" viewBox="0 0 200 80" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><rect x="10" y="32" width="26" height="16" rx="8"/><rect x="50" y="18" width="12" height="44" rx="6"/><rect x="76" y="4" width="12" height="72" rx="6"/><rect x="102" y="22" width="12" height="36" rx="6"/><rect x="128" y="32" width="26" height="16" rx="8"/><path d="M168 40h22" stroke-dasharray="3 6"/><path d="m180 30 10 10-10 10"/></svg>`);
}

function pageHead({ eyebrow, title, lead, actions = [] }) {
  return el('div', { class: 'page-head-row' },
    el('section', { class: 'page-head' },
      eyebrow ? el('span', { class: 'eyebrow', text: eyebrow }) : null,
      el('h1', { text: title }),
      lead ? el('p', { class: 'lead', text: lead }) : null,
    ),
    actions.length ? el('div', { class: 'page-actions' }, actions) : null,
  );
}

function emptyBlock({ iconName = 'star', title, desc, actions = [], testid = 'empty-state' }) {
  return el('div', { class: 'empty', 'data-testid': testid },
    waveArt(),
    el('span', { class: 'empty-title', text: title }),
    el('span', { class: 'empty-text', text: desc }),
    actions.length ? el('div', { class: 'static-links' }, actions) : null,
  );
}

function resourceMeta(resource) {
  if (!resource) return '';
  const type = resource.type === 'course' ? t('课程包') : resource.type === 'subtitle' ? t('字幕包') : t('插件说明');
  const sentences = resource.stats?.sentences || 0;
  return [type, resource.level || '', sentences ? `${sentences} ${t('句')}` : ''].filter(Boolean).join(' · ');
}

function rowCover(iconName, variant = '') {
  const cover = el('div', { class: `list-cover ${variant}`.trim(), 'aria-hidden': 'true' });
  cover.innerHTML = `<svg class="wave" viewBox="0 0 160 60"><g fill="currentColor"><rect x="2" y="23" width="22" height="10" rx="5"/><rect x="36" y="14" width="9" height="34" rx="4.5"/><rect x="55" y="4" width="9" height="52" rx="4.5"/><rect x="74" y="17" width="9" height="28" rx="4.5"/><rect x="93" y="23" width="22" height="10" rx="5"/></g></svg><span class="cover-tag"></span>`;
  if (iconName) {
    cover.classList.add('is-file');
    cover.replaceChildren(icon(iconName, 18));
  }
  return cover;
}

function listRow({ resource, fallbackTitle, iconName, variant, sub, actions, badges = [] }) {
  const href = resource ? `#/resource/${encodeURIComponent(resource.id)}` : null;
  const titleNode = el('span', { class: 'list-title' },
    iconName === 'star' ? elFromHtml('<svg class="fav-star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>') : null,
    el('span', { text: resource ? (pickLang(resource.title, resource.title) || fallbackTitle) : fallbackTitle }),
    ...badges.map((b) => el('span', { class: 'badge badge-outline', text: b })),
  );
  return el('div', { class: 'list-row', 'data-testid': 'favorites-row', 'data-resource-id': resource?.id || '' },
    rowCover(iconName, variant),
    el('div', { class: 'list-body' },
      titleNode,
      el('span', { class: 'list-sub' }, el('span', { text: sub })),
    ),
    el('div', { class: 'list-actions' }, ...actions),
  );
}

function openLink(resource) {
  return resource
    ? el('a', { class: 'btn btn-secondary btn-sm', href: `#/resource/${encodeURIComponent(resource.id)}` }, t('打开'))
    : null;
}

export function renderFavorites(view, route = {}) {
  const activeRoute = route && route.query ? route : currentRoute();
  const requested = activeRoute?.query?.get ? activeRoute.query.get('tab') : null;
  const active = TABS.some((x) => x.id === requested) ? requested : 'favorites';
  view.replaceChildren();

  const favorites = MarketPoints.getFavorites();
  const myResources = MarketPoints.getMyResources();
  const downloads = myResources.filter((r) => r.via !== 'import');
  const imports = myResources.filter((r) => r.via === 'import');
  const counts = { favorites: favorites.length, downloads: downloads.length, imports: imports.length };
  const repaint = () => renderFavorites(view, route);

  view.append(pageHead({
    eyebrow: t('LIBRARY · 本机'),
    title: t('我的资源'),
    lead: t('下载、收藏与最近导入都只保存在这台设备的浏览器里，不会上传，也不会被别人看到。'),
    actions: [
      el('a', { class: 'btn btn-secondary btn-sm', href: '#/market' }, icon('compass', 14), t('浏览市场')),
      favorites.length
        ? el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button', 'data-testid': 'clear-favorites',
          onclick: async () => {
            const ok = await confirmDialog({
              title: t('清除全部收藏？'),
              message: t('将取消收藏所有资源；已下载文件与我的资源记录不受影响。'),
              confirmLabel: t('清除收藏'), cancelLabel: t('取消'), danger: true,
            });
            if (!ok) return;
            for (const id of MarketPoints.getFavorites()) {
              if (MarketPoints.isFavorite(id)) MarketPoints.toggleFavorite(id);
            }
            window.dispatchEvent(new CustomEvent('market:favoriteschange', { detail: { cleared: true } }));
            toast(t('已清除全部收藏（仅本机）'), { kind: 'success' });
            repaint();
          },
        }, icon('trash', 14), t('清除全部收藏'))
        : null,
    ],
  }));

  const tabs = el('div', { class: 'tabs lib-tabs', role: 'tablist', 'aria-label': t('我的资源分类'), 'data-testid': 'library-tabs' });
  const panels = {};
  const tabButtons = [];
  for (const tab of TABS) {
    const btn = el('button', {
      class: 'tab', type: 'button', role: 'tab',
      id: `library-tab-${tab.id}`, 'aria-controls': `library-panel-${tab.id}`,
      'aria-selected': tab.id === active ? 'true' : 'false',
      tabindex: tab.id === active ? '0' : '-1',
      'data-testid': `library-tab-${tab.id}`,
    }, icon(tab.iconName, 14), tab.label, el('span', { class: 'count', text: String(counts[tab.id]) }));
    tabButtons.push(btn);
    tabs.append(btn);
    panels[tab.id] = el('section', {
      class: 'card tab-panel', role: 'tabpanel',
      id: `library-panel-${tab.id}`, 'aria-labelledby': `library-tab-${tab.id}`,
      hidden: tab.id === active ? null : true,
    });
  }

  /* ---- 收藏面板 ---- */
  const favPanel = panels.favorites;
  if (favorites.length === 0) {
    favPanel.append(emptyBlock({
      iconName: 'star',
      title: t('还没有收藏任何资源'),
      desc: t('在资源详情页点「收藏」，它会出现在这里；收藏只保存在本机浏览器，不会上传。'),
      actions: [el('a', { class: 'btn btn-primary', href: '#/market' }, icon('compass', 14), t('去市场逛逛'))],
    }));
  } else {
    const list = el('div', { class: 'list', role: 'list', 'aria-label': t('我的收藏'), 'data-testid': 'favorites-list' });
    for (const id of favorites) {
      const resource = resourceById(id);
      list.append(listRow({
        resource, fallbackTitle: id, iconName: 'star', sub: resource ? `${resourceMeta(resource)} · ${t('收藏于')} ${fmtDate(new Date()).slice(5)}` : t('资源已不在当前目录（可能已下架）'),
        actions: [
          el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', 'data-testid': 'favorite-remove',
            onclick: () => {
              MarketPoints.toggleFavorite(id);
              window.dispatchEvent(new CustomEvent('market:favoriteschange', { detail: { id, favorite: false } }));
              toast(t('已取消收藏（仅本机）'), { kind: 'success' });
              repaint();
            },
          }, t('取消收藏')),
          openLink(resource),
        ].filter(Boolean),
      }));
    }
    favPanel.append(list);
    favPanel.append(el('div', { class: 'lib-summary' },
      el('span', { class: 'row' }, icon('shield', 13), t('收藏是本地功能，不会上传，也不会被别人看到')),
      el('span', { text: t('共 {n} 个 · 本机数据', { n: favorites.length }) }),
    ));
  }

  /* ---- 已下载面板 ---- */
  const dlPanel = panels.downloads;
  if (downloads.length === 0) {
    dlPanel.append(emptyBlock({
      iconName: 'download',
      title: t('还没有下载记录'),
      desc: t('在资源详情页下载任意产物后，这里会出现记录；下载记录只保存在本机。'),
      actions: [el('a', { class: 'btn btn-primary', href: '#/market' }, icon('compass', 14), t('去市场逛逛'))],
    }));
  } else {
    const list = el('div', { class: 'list', role: 'list', 'aria-label': t('已下载'), 'data-testid': 'downloads-list' });
    for (const item of downloads) {
      const resource = resourceById(item.id);
      list.append(listRow({
        resource, fallbackTitle: item.title, iconName: null, variant: 'cover-2',
        sub: `${item.via === 'redeem' ? t('积分兑换') : t('已下载')} · ${fmtRelative(item.addedAt)}`,
        actions: [
          el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', 'data-testid': 'download-remove',
            onclick: async () => {
              const ok = await confirmDialog({
                title: t('删除这条本机记录？'),
                message: t('只删除本机的下载记录，不会删除已下载到磁盘的文件。'),
                confirmLabel: t('删除记录'), cancelLabel: t('取消'), danger: true,
              });
              if (!ok) return;
              removeMyResource(item.id);
              toast(t('已删除本机下载记录'), { kind: 'success' });
              repaint();
            },
          }, icon('trash', 13), t('删除')),
          openLink(resource),
        ],
      }));
    }
    dlPanel.append(list);
    dlPanel.append(el('div', { class: 'lib-summary' },
      el('span', { class: 'row' }, icon('folder', 13), t('已下载文件保存在浏览器下载目录，市场不保留副本')),
      el('span', { text: t('共 {n} 个 · 本机数据', { n: downloads.length }) }),
    ));
  }

  /* ---- 最近导入面板 ---- */
  const imPanel = panels.imports;
  if (imports.length === 0) {
    imPanel.append(emptyBlock({
      iconName: 'upload',
      title: t('还没有导入记录'),
      desc: t('在资源详情页点「下载导入」并在 SHADOW Studio 完成导入后，这里会出现记录；也可以查看导入说明。'),
      actions: [
        el('a', { class: 'btn btn-primary', href: '#/import' }, icon('upload', 14), t('查看导入说明')),
        el('a', { class: 'btn btn-secondary', href: '#/market' }, icon('compass', 14), t('去市场逛逛')),
      ],
    }));
  } else {
    const list = el('div', { class: 'list', role: 'list', 'aria-label': t('最近导入'), 'data-testid': 'imports-list' });
    for (const item of imports) {
      const resource = resourceById(item.id);
      list.append(listRow({
        resource, fallbackTitle: item.title, iconName: 'file-text', variant: 'cover-4',
        sub: `${t('导入工程')} · ${fmtRelative(item.addedAt)}`,
        actions: [
          el('a', { class: 'btn btn-ghost btn-sm', href: '#/import' }, t('导入说明')),
          openLink(resource),
        ],
      }));
    }
    imPanel.append(list);
    imPanel.append(el('div', { class: 'lib-summary' },
      el('span', { class: 'row' }, icon('shield', 13), t('导入记录只记录资源与时间，不记录媒体内容')),
      el('span', { text: t('共 {n} 个 · 本机数据', { n: imports.length }) }),
    ));
  }

  view.append(tabs, ...TABS.map((tab) => panels[tab.id]));

  /* ---- Tabs 交互（点击 + 方向键/Home/End） ---- */
  function selectTab(tab) {
    const idx = TABS.findIndex((x) => x.id === tab.id);
    TABS.forEach((item, i) => {
      tabButtons[i].classList.toggle('is-active', i === idx);
      tabButtons[i].setAttribute('aria-selected', i === idx ? 'true' : 'false');
      tabButtons[i].tabIndex = i === idx ? 0 : -1;
      panels[item.id].hidden = i !== idx;
    });
    const query = new URLSearchParams(route?.query?.toString ? route.query.toString() : '');
    if (idx === 0) query.delete('tab'); else query.set('tab', tab.id);
    const qs = query.toString();
    try { history.replaceState(null, '', `#/favorites${qs ? '?' + qs : ''}`); } catch { /* ignore */ }
    tabButtons[idx].focus();
  }
  tabButtons.forEach((btn, i) => {
    btn.classList.toggle('is-active', TABS[i].id === active);
    btn.addEventListener('click', () => selectTab(TABS[i]));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); selectTab(TABS[(i + 1) % TABS.length]); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); selectTab(TABS[(i - 1 + TABS.length) % TABS.length]); }
      if (e.key === 'Home') { e.preventDefault(); selectTab(TABS[0]); }
      if (e.key === 'End') { e.preventDefault(); selectTab(TABS[TABS.length - 1]); }
    });
  });
}

/**
 * 删除本机「我的资源」记录：MarketPoints 公开 API 不含单个删除，
 * 这里直接改同样的 localStorage 存储并刷新页面，保证与适配器缓存一致（P1 本地演示）。
 */
function removeMyResource(id) {
  try {
    const raw = JSON.parse(localStorage.getItem(POINTS_STORAGE_KEY) || 'null');
    if (!raw || !Array.isArray(raw.myResources)) return false;
    raw.myResources = raw.myResources.filter((r) => String(r.id) !== String(id));
    localStorage.setItem(POINTS_STORAGE_KEY, JSON.stringify(raw));
    window.setTimeout(() => { try { window.location.reload(); } catch { /* ignore */ } }, 120);
    return true;
  } catch { return false; }
}
