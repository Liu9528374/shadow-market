/** Explore 首页 / 分类页 / 搜索页（GitHub Explore 式：左侧 Topics 过滤 + 资源卡列表 + 排序） */

import { el, fmtNum } from '../dom.js';
import { icon } from '../icons.js';
import {
  getState, enabledPlugins, searchResources, sortResources, SORTS, pluginFor,
} from '../data.js';
import { pageHead, resourceCard, emptyState } from '../components.js';
import { replaceRoute, navigate } from '../router.js';

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

function sidebar(state, { mode, categoryId, query }) {
  const { categoryCounts } = counts(state);
  const nav = el('nav', { class: 'side-nav', 'aria-label': '资源分类与筛选', 'data-testid': 'explore-sidebar' });

  const topicGroup = el('div', { class: 'side-group' }, el('h2', { class: 'side-title', text: 'Topics · 分类' }));
  const allActive = mode !== 'category' && !categoryId;
  topicGroup.append(el('a', {
    class: 'side-link',
    href: mode === 'search' && query ? `#/search?q=${encodeURIComponent(query)}` : '#/',
    'aria-current': allActive ? 'page' : null,
    'data-testid': 'sidebar-all',
  },
    icon('compass', 14, 'side-icon'),
    '全部资源',
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
      el('span', { text: category.label }),
      el('span', { class: 'side-count', text: String(categoryCounts.get(category.id) || 0) }),
    ));
  }
  nav.append(topicGroup);

  const { typeTotals } = counts(state);
  const typeGroup = el('div', { class: 'side-group' }, el('h2', { class: 'side-title', text: '资源类型 · 插件' }));
  for (const plugin of enabledPlugins()) {
    typeGroup.append(el('a', {
      class: 'side-link',
      href: `#/search?q=&type=${encodeURIComponent(plugin.id)}`,
      'data-testid': 'sidebar-type',
      title: `${plugin.label}：由 plugins/${plugin.id}/manifest.json 声明的资源类型`,
    }, icon(plugin.icon, 14, 'side-icon'), plugin.label, el('span', { class: 'side-count', text: String(typeTotals.get(plugin.id) || 0) })));
  }
  nav.append(typeGroup);

  const aboutGroup = el('div', { class: 'side-group' }, el('h2', { class: 'side-title', text: '关于市场' }));
  aboutGroup.append(
    el('a', { class: 'side-link', href: '#/import' }, icon('upload', 14, 'side-icon'), '一键导入原理'),
    el('a', { class: 'side-link', href: '#/points' }, icon('diamond', 14, 'side-icon'), '积分（P1 本地演示）'),
    el('a', { class: 'side-link', href: '#/settings' }, icon('gear', 14, 'side-icon'), '设置'),
  );
  nav.append(aboutGroup);
  return nav;
}

function typeChips(state, activeType) {
  const { typeTotals } = counts(state);
  const chips = el('div', { class: 'chip-list', 'data-testid': 'type-chips' });
  chips.append(el('button', {
    class: 'chip', type: 'button', 'data-active': activeType ? 'false' : 'true',
    'data-testid': 'type-chip-all',
    onclick: () => updateQuery({ type: null }),
  }, '全部类型'));
  for (const type of typeTotals.keys()) {
    const plugin = pluginFor(type);
    chips.append(el('button', {
      class: 'chip', type: 'button', 'data-active': activeType === type ? 'true' : 'false',
      'data-testid': 'type-chip',
      dataset: { type },
      title: plugin.fallback ? '未注册类型的降级通用渲染' : `插件清单：plugins/${plugin.id}/manifest.json`,
      onclick: () => updateQuery({ type: activeType === type ? null : type }),
    }, plugin.label, el('span', { class: 'side-count', text: String(typeTotals.get(type) || 0) })));
  }
  return chips;
}

function sortSelector(current) {
  const select = el('select', {
    class: 'sort-select',
    'aria-label': '排序方式',
    'data-testid': 'sort-select',
    onchange: (e) => {
      const value = e.currentTarget.value;
      updateQuery({ sort: value === DEFAULT_SORT ? null : value });
    },
  });
  for (const sort of SORTS) {
    const option = el('option', { value: sort.id, text: sort.label });
    if (sort.id === current) option.selected = true;
    select.append(option);
  }
  return select;
}

function toolbar({ total, shown, sort, hasFilters }) {
  const bar = el('div', { class: 'list-toolbar', 'data-testid': 'list-toolbar' },
    el('span', { class: 'toolbar-count' },
      '共 ', el('strong', { text: String(shown) }), ' 个资源',
      total !== shown ? el('span', { class: 'subtle', text: ` / 全部 ${total}` }) : null),
    el('span', { class: 'toolbar-spacer' }),
    hasFilters
      ? el('button', {
        class: 'chip chip-muted', type: 'button', 'data-testid': 'clear-filters',
        onclick: () => {
          const { pathPart } = currentPathParts();
          navigate(pathPart, '');
        },
      }, '清除筛选', icon('x', 11))
      : null,
    sortSelector(sort),
  );
  return bar;
}

function homeNotice() {
  return el('div', { class: 'notice', style: { marginBottom: '16px' } },
    icon('shield', 16, 'notice-icon'),
    el('div', {},
      el('strong', { text: 'P0 全免费' }), ' · 积分只是兑换凭证（免费获取，不可购买 / 提现 / 转让）· ',
      el('strong', { text: 'BYOM' }), '：市场不托管影视媒体、不上传用户媒体 · 下载数与时长为示例统计（P0 无后端）。',
      el('a', { href: '#/import', style: { marginLeft: '6px' } }, '如何一键导入 →'),
    ),
  );
}

function emptyFor({ mode }) {
  return emptyState({
    iconName: mode === 'search' ? 'search' : 'folder',
    title: mode === 'search' ? '没有找到匹配的资源' : '这里还没有资源',
    desc: mode === 'search'
      ? '试试更短的关键词、中文或英文（例如「咖啡 / coffee」「问路 / directions」），或清除类型筛选。'
      : '可以切换分类，或回到探索查看全部资源。',
    actions: [
      { label: '浏览全部资源', href: '#/', kind: 'primary', icon: 'compass' },
      { label: '查看积分说明', href: '#/points', icon: 'diamond' },
    ],
  });
}

/** 主渲染：mode = home | category | search */
export function renderExplore(view, { mode, categoryId = '', query = '', queryParams }) {
  const state = getState();
  view.replaceChildren();
  if (!state.catalog) return; // 数据缺失兜底由 app.js 统一处理

  const activeType = queryParams.get('type') || '';
  const sort = queryParams.get('sort') || DEFAULT_SORT;
  const category = mode === 'category' ? state.catalog.categoryMap.get(categoryId) : null;

  let baseList;
  if (mode === 'category') baseList = category ? searchResources('', { category: categoryId, type: activeType }) : [];
  else if (mode === 'search') baseList = searchResources(query, { type: activeType });
  else baseList = searchResources('', { type: activeType });

  const list = sortResources(baseList, sort);
  const total = state.catalog.resources.length;
  const hasFilters = Boolean(activeType || sort !== DEFAULT_SORT);

  let head;
  if (mode === 'category') {
    head = pageHead({
      title: category ? category.label : '分类不存在',
      sub: category ? `${category.labelEn || ''} · ${list.length} 个资源 · 分类由 data/catalog.json 的 categories 声明` : `目录里没有 id 为 “${categoryId}” 的分类`,
      actions: [{ label: '返回探索', href: '#/', icon: 'compass' }],
    });
  } else if (mode === 'search') {
    const q = query.trim();
    head = pageHead({
      title: q ? `搜索 “${q}”` : '搜索资源',
      sub: q
        ? `找到 ${fmtNum(list.length)} 个匹配资源（搜索范围：标题 / 描述 / 标签 / 作者 / 分类，含少量中英别名）`
        : '输入关键词，按标题、描述、标签、作者搜索全部免费资源（按 / 聚焦搜索框）',
      actions: q ? [{ label: '清除搜索', href: '#/', icon: 'x' }] : [],
    });
  } else {
    head = pageHead({
      title: '探索市场',
      sub: `全免费课程资源 · 一键导入 SHADOW Studio · 刷新 / 直达可用 · 共 ${total} 个资源`,
      actions: [
        { label: '一键导入说明', href: '#/import', icon: 'upload' },
        { label: '我的积分', href: '#/points', icon: 'diamond' },
      ],
    });
  }

  const main = el('div', { class: 'explore-main' });
  if (mode === 'home') main.append(homeNotice());

  if (mode === 'category' && !category) {
    main.append(emptyState({
      iconName: 'folder',
      title: '分类不存在',
      desc: `目录里没有 id 为 “${categoryId}” 的分类。可能链接过期，或 catalog.json 更新后分类被移除。`,
      actions: [{ label: '回到探索', href: '#/', kind: 'primary', icon: 'compass' }],
    }));
  } else {
    main.append(typeChips(state, activeType));
    main.append(toolbar({ total, shown: list.length, sort, hasFilters }));
    const listNode = el('div', { class: 'res-list', 'data-testid': 'resource-list', role: 'list', 'aria-label': '资源列表' });
    if (list.length === 0) listNode.append(emptyFor({ mode }));
    else for (const resource of list) listNode.append(resourceCard(resource));
    main.append(listNode);
  }

  view.append(head, el('div', { class: 'explore-grid' }, sidebar(state, { mode, categoryId, query }), main));
}
