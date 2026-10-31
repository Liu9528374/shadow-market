/** Explore 首页 / 分类页 / 标签页 / 搜索页（GitHub Explore 逻辑：侧栏 Topics + 资源卡列表 + 排序 + 推荐位） */

import { el, fmtNum, fmtDate, fmtRelative } from '../dom.js';
import { icon } from '../icons.js';
import {
  getState, enabledPlugins, searchResources, sortResources, SORTS, pluginFor,
  categoryById, tagInfo, resourcesByTag, featuredResources, latestResources, resourceById,
} from '../data.js';
import { pageHead, resourceCard, emptyState, tagLinks } from '../components.js';
import { replaceRoute, navigate } from '../router.js';
import { t, pickLang } from '../i18n.js';

const DEFAULT_SORT = 'updated';

function counts(state) {
  const categoryCounts = new Map();
  const typeTotals = new Map();
  for (const r of state.catalog.resources) {
    categoryCounts.set(r.category, (categoryCounts.get(r.category) || 0) + 1);
    typeTotals.set(r.type, (typeTotals.get(r.type) || 0) + 1);
  }
  return { categoryCounts, typeTotals };
}

function currentPathParts() {
  const raw = (window.location.hash || '#/').replace(/^#/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  return { pathPart: pathPart.startsWith('/') ? pathPart : `/${pathPart}`, queryPart };
}

function updateQuery(patch) {
  const { pathPart, queryPart } = currentPathParts();
  const params = new URLSearchParams(queryPart);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '') params.delete(key);
    else params.set(key, String(value));
  }
  replaceRoute(pathPart, params.toString());
}

/* ---------------- 侧栏 ---------------- */

function sidebar(state, { mode, categoryId, activeTag }) {
  const { categoryCounts, typeTotals } = counts(state);
  const nav = el('nav', { class: 'side-nav', 'aria-label': t('资源分类与筛选'), 'data-testid': 'explore-sidebar' });

  const topicGroup = el('div', { class: 'side-group' }, el('h2', { class: 'side-title', text: t('分类') }));
  const allActive = mode !== 'category' && !categoryId;
  topicGroup.append(el('a', {
    class: 'side-link',
    href: '#/',
    'aria-current': allActive ? 'page' : null,
    'data-testid': 'sidebar-all',
  },
    icon('compass', 14, 'side-icon'),
    t('全部资源'),
    el('span', { class: 'side-count', text: String(state.catalog.resources.length) }),
  ));

  for (const category of state.catalog.categories) {
    topicGroup.append(el('a', {
      class: 'side-link',
      href: `#/category/${encodeURIComponent(category.id)}`,
      'aria-current': mode === 'category' && categoryId === category.id ? 'page' : null,
      'data-testid': 'sidebar-category',
      dataset: { categoryId: category.id },
    },
      el('span', { class: 'side-dot', style: { background: 'var(--border-strong)' } }),
      el('span', { text: pickLang(category.label, category.labelEn) }),
      el('span', { class: 'side-count', text: String(categoryCounts.get(category.id) || 0) }),
    ));
  }
  nav.append(topicGroup);

  // 标签入口（GitHub Topics 逻辑：标签页 #/tag/<tag>）
  const tags = (state.catalog.tags || []).slice().sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 18);
  if (tags.length) {
    const tagGroup = el('div', { class: 'side-group' }, el('h2', { class: 'side-title', text: t('标签') }));
    const cloud = el('div', { class: 'side-tags', 'data-testid': 'sidebar-tags' });
    for (const tag of tags) {
      cloud.append(el('a', {
        class: 'tag tag-plain',
        href: `#/tag/${encodeURIComponent(tag.tag)}`,
        'aria-current': activeTag && tagInfo(activeTag).tag === tag.tag ? 'true' : null,
        title: `${t('标签：{tag}', { tag: tag.tag })} · ${t('共 {n} 个资源', { n: tag.count || 0 })}`,
      }, pickLang(tag.label, tag.labelEn)));
    }
    tagGroup.append(cloud);
    nav.append(tagGroup);
  }

  const typeGroup = el('div', { class: 'side-group' }, el('h2', { class: 'side-title', text: t('资源类型') }));
  for (const plugin of enabledPlugins()) {
    typeGroup.append(el('a', {
      class: 'side-link',
      href: `#/search?q=&type=${encodeURIComponent(plugin.id)}`,
      'data-testid': 'sidebar-type',
      title: `${pickLang(plugin.label, plugin.labelEn)}：plugins/${plugin.id}/manifest.json`,
    }, icon(plugin.icon, 14, 'side-icon'), pickLang(plugin.label, plugin.labelEn), el('span', { class: 'side-count', text: String(typeTotals.get(plugin.id) || 0) })));
  }
  nav.append(typeGroup);

  const aboutGroup = el('div', { class: 'side-group' }, el('h2', { class: 'side-title', text: t('关于市场') }));
  aboutGroup.append(
    el('a', { class: 'side-link', href: '#/import' }, icon('upload', 14, 'side-icon'), t('一键导入说明')),
    el('a', { class: 'side-link', href: '#/contribute' }, icon('book', 14, 'side-icon'), t('投稿指南')),
    el('a', { class: 'side-link', href: '#/changelog' }, icon('history', 14, 'side-icon'), t('更新日志')),
    el('a', { class: 'side-link', href: '#/favorites' }, icon('star', 14, 'side-icon'), t('我的收藏')),
  );
  nav.append(aboutGroup);
  return nav;
}

function typeChips(state, activeType) {
  const { typeTotals } = counts(state);
  const chips = el('div', { class: 'chip-list', 'data-testid': 'type-chips', role: 'group', 'aria-label': t('资源类型') });
  chips.append(el('button', {
    class: 'chip', type: 'button', 'data-active': activeType ? 'false' : 'true',
    'data-testid': 'type-chip-all',
    'aria-pressed': activeType ? 'false' : 'true',
    onclick: () => updateQuery({ type: null }),
  }, t('全部类型')));
  for (const type of typeTotals.keys()) {
    const plugin = pluginFor(type);
    const active = activeType === type;
    chips.append(el('button', {
      class: 'chip', type: 'button', 'data-active': active ? 'true' : 'false',
      'data-testid': 'type-chip',
      'aria-pressed': active ? 'true' : 'false',
      dataset: { type },
      title: plugin.fallback ? t('未注册类型的降级通用渲染') : `plugins/${plugin.id}/manifest.json`,
      onclick: () => updateQuery({ type: active ? null : type }),
    }, pickLang(plugin.label, plugin.labelEn), el('span', { class: 'side-count', text: String(typeTotals.get(type) || 0) })));
  }
  return chips;
}

function sortSelector(current) {
  const select = el('select', {
    class: 'sort-select',
    'aria-label': t('排序方式'),
    'data-testid': 'sort-select',
    onchange: (e) => {
      const value = e.currentTarget.value;
      updateQuery({ sort: value === DEFAULT_SORT ? null : value });
    },
  });
  for (const sort of SORTS) {
    const option = el('option', { value: sort.id, text: pickLang(sort.label, sort.labelEn) });
    if (sort.id === current) option.selected = true;
    select.append(option);
  }
  return select;
}

function toolbar({ total, shown, sort, hasFilters }) {
  return el('div', { class: 'list-toolbar', 'data-testid': 'list-toolbar' },
    el('span', { class: 'toolbar-count', 'aria-live': 'polite' },
      t('共 {n} 个资源', { n: shown }),
      total !== shown ? el('span', { class: 'subtle', text: ` / ${total}` }) : null),
    el('span', { class: 'toolbar-spacer' }),
    hasFilters
      ? el('button', {
        class: 'chip chip-muted', type: 'button', 'data-testid': 'clear-filters',
        onclick: () => {
          const { pathPart } = currentPathParts();
          navigate(pathPart, '');
        },
      }, t('清除筛选'), icon('x', 11))
      : null,
    sortSelector(sort),
  );
}

function homeNotice() {
  return el('div', { class: 'notice', 'data-testid': 'home-notice' },
    icon('shield', 16, 'notice-icon'),
    el('div', {},
      el('strong', { text: t('P0 全免费') }), ' · ',
      t('积分只是兑换凭证（免费获取，不可购买 / 提现 / 转让）'), ' · ',
      el('strong', { text: 'BYOM' }), '：',
      t('市场不托管影视媒体、不上传用户媒体'), ' · ',
      el('a', { href: '#/import' }, t('如何一键导入 →')),
    ),
  );
}

function emptyFor({ mode, hasFilters }) {
  return emptyState({
    iconName: mode === 'search' ? 'search' : 'folder',
    title: mode === 'search' ? t('没有找到匹配的资源') : t('这里还没有资源'),
    desc: mode === 'search'
      ? t('试试更短的关键词、中文或英文（例如「咖啡 / coffee」「问路 / directions」），或清除类型筛选。')
      : t('可以切换分类，或回到探索查看全部资源。'),
    actions: [
      { label: t('浏览全部资源'), href: '#/', kind: 'primary', icon: 'compass' },
      hasFilters ? { label: t('清除筛选'), icon: 'x', onClick: () => navigate('/') } : null,
      { label: t('投稿指南'), href: '#/contribute', icon: 'upload' },
    ].filter(Boolean),
  });
}

/* ---------------- 首页推荐 / 最新 ---------------- */

function featuredSection(state) {
  const list = featuredResources(3);
  if (!list.length) return null;
  const grid = el('div', { class: 'res-list featured-list', role: 'list', 'aria-label': t('推荐资源') });
  for (const resource of list) grid.append(resourceCard(resource));
  return el('section', { class: 'home-section', 'data-testid': 'home-featured' },
    el('div', { class: 'section-head' },
      el('h2', { class: 'section-title' }, icon('sparkles', 16, 'section-icon'), t('推荐资源')),
      el('a', { class: 'section-more', href: '#/' }, t('查看全部'), icon('chevron-right', 12)),
    ),
    grid,
  );
}

function latestRows(state) {
  const list = latestResources(6);
  if (!list.length) return null;
  const rows = el('ul', { class: 'latest-list', 'data-testid': 'home-latest' });
  for (const resource of list) {
    rows.append(el('li', { class: 'latest-item' },
      el('a', { class: 'latest-title', href: `#/resource/${encodeURIComponent(resource.id)}` }, resource.title),
      el('span', { class: 'latest-meta' },
        el('span', { class: 'badge badge-type' }, pickLang(pluginFor(resource.type).label, pluginFor(resource.type).labelEn)),
        el('span', { class: 'subtle', text: fmtDate(resource.updatedAt) }),
        el('span', { class: 'subtle', lang: 'en', text: resource.subtitle }),
      ),
    ));
  }
  return el('section', { class: 'home-section home-latest', 'data-testid': 'home-latest-section' },
    el('div', { class: 'section-head' },
      el('h2', { class: 'section-title' }, icon('history', 16, 'section-icon'), t('最新更新')),
    ),
    rows,
  );
}

function homeHero(state) {
  return pageHead({
    title: t('探索市场'),
    sub: `${t('全免费课程资源')} · ${t('一键导入')} SHADOW Studio · ${t('共 {n} 个资源', { n: state.catalog.resources.length })}`,
    actions: [
      { label: t('一键导入说明'), href: '#/import', icon: 'upload' },
      { label: t('投稿指南'), href: '#/contribute', icon: 'book' },
    ],
  });
}

function categoryHead(category, list) {
  return pageHead({
    title: category ? pickLang(category.label, category.labelEn) : t('分类不存在'),
    sub: category
      ? `${category.labelEn && category.labelEn !== category.label ? category.labelEn : ''} · ${t('共 {n} 个资源', { n: list.length })}${category.description ? ` · ${category.description}` : ''}`
      : t('目录里没有这个分类，可能链接过期。'),
    actions: [{ label: t('返回探索'), href: '#/', icon: 'compass' }],
  });
}

function tagHead(state, activeTag, list) {
  const info = tagInfo(activeTag);
  return pageHead({
    title: `${t('标签：{tag}', { tag: info.tag })}`,
    sub: `${t('共 {n} 个资源', { n: list.length })}${info.labelEn && info.labelEn !== info.tag ? ` · ${info.labelEn}` : ''}`,
    actions: [{ label: t('按标签浏览'), href: '#/', icon: 'tag' }],
  });
}

function searchHead(query, list) {
  const q = String(query || '').trim();
  return pageHead({
    title: q ? `${t('搜索')} “${q}”` : t('搜索资源'),
    sub: q
      ? t('找到 {n} 个匹配资源（标题 / 描述 / 标签 / 作者 / 分类，含少量中英别名）', { n: list.length })
      : t('输入关键词，按标题、描述、标签、作者搜索全部免费资源（按 / 聚焦搜索框）'),
    actions: q ? [{ label: t('清除搜索'), href: '#/', icon: 'x' }] : [],
  });
}

/** 主渲染：mode = home | category | tag | search */
export function renderExplore(view, { mode, categoryId = '', tag = '', query = '', queryParams }) {
  const state = getState();
  if (!state.catalog) { view.replaceChildren(); return; } // 数据缺失兜底由 app.js 统一处理
  // home 首屏：复用 index.html 的静态 page-head / notice（LCP 节点不重绘 → LCP 提前、CLS 稳定）
  const staticRoot = mode === 'home' ? view.querySelector('[data-first-paint]:not([data-rendered])') : null;
  if (!staticRoot) view.replaceChildren();

  const params = queryParams instanceof URLSearchParams ? queryParams : new URLSearchParams();
  const activeType = params.get('type') || '';
  const sort = params.get('sort') || DEFAULT_SORT;
  const category = mode === 'category' ? categoryById(categoryId) : null;

  let baseList;
  if (mode === 'category') baseList = category ? searchResources('', { category: categoryId, type: activeType }) : [];
  else if (mode === 'tag') baseList = resourcesByTag(tag).filter((r) => !activeType || r.type === activeType);
  else if (mode === 'search') baseList = searchResources(query, { type: activeType });
  else baseList = searchResources('', { type: activeType });

  const list = sortResources(baseList, sort);
  const total = state.catalog.resources.length;
  const hasFilters = Boolean(activeType || sort !== DEFAULT_SORT || mode === 'search' || mode === 'tag');

  let head;
  if (mode === 'category') head = categoryHead(category, list);
  else if (mode === 'tag') head = tagHead(state, tag, list);
  else if (mode === 'search') head = searchHead(query, list);
  else head = homeHero(state);

  const main = el('div', { class: 'explore-main' });
  if (mode === 'home') {
    if (!staticRoot) main.append(homeNotice());
    const featured = featuredSection(state);
    if (featured) main.append(featured);
    const latest = latestRows(state);
    if (latest) main.append(latest);
    main.append(el('div', { class: 'section-head section-head-list' },
      el('h2', { class: 'section-title' }, icon('layers', 16, 'section-icon'), t('全部资源')),
    ));
  }

  if ((mode === 'category' && !category) || (mode === 'tag' && !resourcesByTag(tag).length && !tagInfo(tag).tag)) {
    main.append(emptyState({
      iconName: 'folder',
      title: mode === 'category' ? t('分类不存在') : t('标签不存在'),
      desc: t('可能链接写错了，或资源已从目录中移除。'),
      actions: [{ label: t('回到探索'), href: '#/', kind: 'primary', icon: 'compass' }],
    }));
  } else {
    main.append(typeChips(state, activeType));
    main.append(toolbar({ total, shown: list.length, sort, hasFilters }));
    const listNode = el('div', { class: 'res-list', 'data-testid': 'resource-list', role: 'list', 'aria-label': t('资源列表') });
    if (list.length === 0) listNode.append(emptyFor({ mode, hasFilters }));
    else for (const resource of list) listNode.append(resourceCard(resource));
    main.append(listNode);
  }

  const grid = el('div', { class: 'explore-grid' }, sidebar(state, { mode, categoryId, activeTag: mode === 'tag' ? tag : '' }), main);
  if (staticRoot) {
    staticRoot.dataset.rendered = '1';
    staticRoot.querySelector('.first-paint-list')?.remove();
    staticRoot.append(grid);
  } else {
    view.append(head, grid);
  }
}
