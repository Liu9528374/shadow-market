/**
 * 市场探索（#/market，及 #/search、#/category/:id、#/tag/:tag 复用）
 * 设计依据：design/mockups/market.html（左筛选 / 主区 2 列资源卡 / 右栏进入工作台 + 热门分类 + 创作者与投稿）。
 */

import { el, debounce } from '../dom.js';
import { icon } from '../icons.js';
import { t, pickLang } from '../i18n.js';
import {
  getState, resourcesByCategory, resourcesByTag, searchResources, sortResources,
  categoryById, tagInfo, pluginFor,
} from '../data.js';
import { resourceCard, sectionHead, emptyCard, nextPaint } from './ui.js';
import { navigate, replaceRoute } from '../router.js';

const SORTS = Object.freeze([
  { id: 'updated', label: '最近更新', labelEn: 'Recently updated' },
  { id: 'name', label: '名称', labelEn: 'Name' },
  { id: 'downloads', label: '下载', labelEn: 'Downloads' },
]);

function currentPath() {
  const raw = String(window.location.hash || '#/market').replace(/^#/, '');
  const path = raw.split('?')[0] || '/market';
  return path.startsWith('/') ? path : `/${path}`;
}

function setQuery(patch) {
  const raw = String(window.location.hash || '').replace(/^#/, '');
  const [path, queryPart = ''] = raw.split('?');
  const params = new URLSearchParams(queryPart);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === '') params.delete(key);
    else params.set(key, String(value));
  }
  const target = path || '/market';
  navigate(target, params.toString());
}

function countsByType() {
  const map = new Map();
  for (const r of getState().catalog?.resources || []) map.set(r.type, (map.get(r.type) || 0) + 1);
  return map;
}

function countsByLevel() {
  const map = new Map();
  for (const r of getState().catalog?.resources || []) if (r.level) map.set(r.level, (map.get(r.level) || 0) + 1);
  return map;
}

/* ---------------- 左栏：筛选 ---------------- */

function filterItem({ href, label, count, checked = false, onClick = null }) {
  const node = el('a', {
    class: `filter-item${checked ? ' is-checked' : ''}`,
    href: href || '#/market',
    onclick: onClick ? (e) => { e.preventDefault(); onClick(); } : null,
  },
    el('span', { class: 'box' }, icon('check', 12)),
    label,
    el('span', { class: 'count', text: String(count ?? '') }),
  );
  return node;
}

export function renderSidebar(route) {
  const state = getState();
  const params = route.query || new URLSearchParams();
  const activeType = params.get('type') || '';
  const activeLevel = params.get('level') || '';
  const activeCategory = route.name === 'category' ? route.params.id : '';
  const activeTag = route.name === 'tag' ? tagInfo(route.params.tag).tag : '';
  const frag = document.createDocumentFragment();

  const nav = el('nav', { class: 'side-group', 'aria-label': t('筛选资源') });
  nav.append(el('p', { class: 'side-label eyebrow', text: t('筛选资源') }));

  const group = (title, count, open, children) => {
    const details = el('details', { class: 'filter-group', open: open ? true : null },
      el('summary', { class: 'filter-summary' },
        title,
        el('span', { class: 'count', text: String(count) }),
        icon('chevron-down', 16, 'chev'),
      ),
      el('div', { class: 'filter-list' }, children),
    );
    return details;
  };

  const typeCounts = countsByType();
  nav.append(group(t('类型'), state.catalog?.resources?.length || 0, true, [
    filterItem({ label: t('全部类型'), count: state.catalog?.resources?.length || 0, checked: !activeType, href: '#/market' }),
    ...Array.from(typeCounts.entries()).map(([type, count]) => filterItem({
      label: pickLang(pluginFor(type).label, pluginFor(type).labelEn),
      count,
      checked: activeType === type,
      href: `#/market?type=${encodeURIComponent(type)}`,
    })),
  ]));

  const levelCounts = countsByLevel();
  nav.append(group(t('难度'), Array.from(levelCounts.values()).reduce((a, b) => a + b, 0), false,
    Array.from(levelCounts.entries()).map(([level, count]) => filterItem({
      label: level,
      count,
      checked: activeLevel === level,
      href: `#/market?level=${encodeURIComponent(level)}`,
    }))));

  nav.append(group(t('分类'), state.catalog?.categories?.length || 0, false,
    (state.catalog?.categories || []).map((cat) => filterItem({
      label: pickLang(cat.label, cat.labelEn),
      count: cat.count || 0,
      checked: activeCategory === cat.id,
      href: `#/category/${encodeURIComponent(cat.id)}`,
    }))));

  const tags = (state.catalog?.tags || []).slice().sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 8);
  nav.append(group(t('标签'), tags.length, false,
    tags.map((tag) => filterItem({
      label: pickLang(tag.label, tag.labelEn),
      count: tag.count || 0,
      checked: activeTag === tag.tag,
      href: `#/tag/${encodeURIComponent(tag.tag)}`,
    }))));

  nav.append(el('a', { class: 'filter-clear', href: '#/market' }, icon('x', 16), t('清除筛选')));
  nav.append(el('p', { class: 'filter-foot tiny faint', text: t('筛选只作用于本机目录 · 共 {n} 个资源', { n: state.catalog?.resources?.length || 0 }) }));
  frag.append(nav);
  return frag;
}

/* ---------------- 主内容 ---------------- */

function headNode({ mode, route, list }) {
  const state = getState();
  const params = route.query || new URLSearchParams();
  let title = t('发现资源');
  let sub = t('全免费 · BYOM · 无需登录。所有资源均可离线导入 SHADOW Studio。');
  const q = params.get('q') || '';
  if (mode === 'search' || (mode === 'market' && q)) {
    title = q ? `${t('搜索')} “${q}”` : t('发现资源');
    sub = t('标题 / 描述 / 标签 / 作者均可搜索，支持少量中英别名。');
  } else if (mode === 'category') {
    const category = categoryById(route.params.id);
    title = category ? pickLang(category.label, category.labelEn) : t('分类不存在');
    sub = category?.description || sub;
  } else if (mode === 'tag') {
    const info = tagInfo(route.params.tag);
    title = `${t('标签')}：${info.tag}`;
    sub = t('按标签筛选全部免费资源 · 共 {n} 个资源', { n: list.length });
  }

  const head = el('section', { class: 'page-head market-head' },
    el('div', { class: 'market-head-title' },
      el('div', {},
        el('h1', {}, title, el('span', { class: 'market-count', text: `${list.length} ${t('个')}` })),
        el('p', { class: 'lead', style: { marginTop: '6px' }, text: sub }),
      ),
      el('a', { class: 'section-link', href: '#/contribute' }, t('投稿指南'), icon('arrow-right', 16)),
    ),
  );

  // 市场页主搜索框：回车/输入实时跳转 #/search?q=
  const search = el('label', { class: 'search search-lg' },
    icon('search', 18),
    el('input', {
      type: 'search',
      'aria-label': t('在市场内搜索'),
      placeholder: t('搜索标题、场景、标签或作者…'),
      value: params.get('q') || '',
    }),
    el('span', { class: 'kbd', text: '/' }),
  );
  const input = search.querySelector('input');
  const go = debounce(() => {
    const q = input.value.trim();
    navigate('/market', q ? new URLSearchParams({ q }).toString() : '');
  }, 260);
  input.addEventListener('input', go);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim();
      navigate('/market', q ? new URLSearchParams({ q }).toString() : '');
    }
  });
  head.append(search);

  // 移动端：单行横滑快捷筛选（桌面向左栏折叠分组）
  head.append(el('div', { class: 'mobile-filters', role: 'group', 'aria-label': t('快捷筛选') },
    el('a', { class: 'chip', href: '#/market', 'aria-current': mode === 'market' ? 'true' : null }, t('全部')),
    el('a', { class: 'chip', href: '#/market?type=course' }, t('课程包')),
    el('a', { class: 'chip', href: '#/market?type=subtitle' }, t('字幕包')),
    el('a', { class: 'chip', href: '#/market?type=plugin' }, t('插件')),
    ...(state.catalog?.tags || []).slice(0, 4).map((tag) => el('a', { class: 'chip', href: `#/tag/${encodeURIComponent(tag.tag)}` }, pickLang(tag.label, tag.labelEn))),
  ));
  return head;
}

function resultsBar(route, shown) {
  const params = route.query || new URLSearchParams();
  const activeSort = params.get('sort') || 'updated';
  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': t('排序方式') });
  for (const sort of SORTS) {
    seg.append(el('button', {
      class: `seg-item${activeSort === sort.id ? ' is-active' : ''}`,
      type: 'button',
      'aria-pressed': activeSort === sort.id ? 'true' : 'false',
      onclick: () => setQuery({ sort: sort.id === 'updated' ? null : sort.id }),
    }, pickLang(sort.label, sort.labelEn)));
  }
  return el('div', { class: 'results-bar' },
    el('div', { class: 'results-left' }, seg, el('span', { class: 'result-count' }, el('b', { text: String(shown) }), ` ${t('个资源 · 全部免费')}`)),
    el('div', { class: 'view-toggle', role: 'group', 'aria-label': t('视图切换') },
      el('button', { class: 'icon-btn is-active', type: 'button', 'aria-label': t('网格视图'), 'aria-pressed': 'true' }, icon('grid', 18)),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('列表视图'), 'aria-pressed': 'false' }, icon('list', 18)),
    ),
  );
}

function marketList(route) {
  const state = getState();
  const params = route.query || new URLSearchParams();
  const mode = route.name;
  const type = params.get('type') || '';
  const level = params.get('level') || '';
  const sort = params.get('sort') || 'updated';
  const q = params.get('q') || '';

  let list;
  if (mode === 'category') list = resourcesByCategory(route.params.id);
  else if (mode === 'tag') list = resourcesByTag(route.params.tag);
  else if (mode === 'search') list = searchResources(q);
  else list = (state.catalog?.resources || []).slice();
  if (type) list = list.filter((r) => r.type === type);
  if (level) list = list.filter((r) => r.level === level);
  return sortResources(list, sort);
}

export async function renderMarket(view, route) {
  const state = getState();
  view.replaceChildren();

  if (!state.catalog) {
    view.append(el('section', { class: 'page-head market-head' },
      el('div', { class: 'market-head-title' }, el('div', {},
        el('h1', {}, t('发现资源')),
        el('p', { class: 'lead', text: t('资源目录未加载，请稍后重试或启动本地服务。') }),
      )),
    ));
    view.append(emptyCard({ iconName: 'help-circle', title: t('数据未加载'), desc: t('node market/serve.mjs 后刷新页面。'), action: { href: '#/', label: t('回工作台') } }));
    return;
  }

  const category = route.name === 'category' ? categoryById(route.params.id) : null;
  const crumbs = [el('a', { href: '#/' }, t('工作台')), el('span', { class: 'sep', text: '/' }), el('a', { href: '#/market' }, t('市场'))];
  if (route.name === 'search') crumbs.push(el('span', { class: 'sep', text: '/' }), el('span', { class: 'current', text: t('搜索') }));
  else if (category) crumbs.push(el('span', { class: 'sep', text: '/' }), el('span', { class: 'current', text: pickLang(category.label, category.labelEn) }));
  else if (route.name === 'tag') crumbs.push(el('span', { class: 'sep', text: '/' }), el('span', { class: 'current', text: route.params.tag }));

  const list = marketList(route);
  view.append(el('nav', { class: 'breadcrumb', 'aria-label': t('面包屑') }, crumbs));
  view.append(headNode({ mode: route.name, route, list }));
  await nextPaint(); // 先绘制 h1/副标/搜索（LCP），再插入网格
  view.append(resultsBar(route, list.length));

  if (list.length === 0) {
    view.append(emptyCard({
      iconName: 'search',
      title: t('没有找到匹配的资源'),
      desc: t('试试更短的关键词、切换到「全部类型」，或者清除筛选后再看一次。'),
      action: { href: '#/market', label: t('清除筛选'), kind: 'primary' },
    }));
  } else {
    const grid = el('div', { class: 'market-grid', 'data-testid': 'resource-list', role: 'list', 'aria-label': t('资源列表') });
    list.forEach((resource, idx) => {
      const card = resourceCard(resource, { variant: 'market', index: idx });
      card.setAttribute('role', 'listitem');
      grid.append(card);
    });
    view.append(grid);
  }

  view.append(el('p', { class: 'footer-note' },
    el('span', { text: `SHADOW ${t('市场')} · ${state.catalog.resources.length} ${t('个资源')}` }),
    el('span', { text: t('全免费 · BYOM · 不托管媒体') }),
    el('span', { text: t('无强制登录 · 数据只在本机') }),
  ));
}

/** 市场右栏：进入工作台 CTA / 热门分类 / 创作者与投稿 */
export function renderRail() {
  const state = getState();
  const categories = (state.catalog?.categories || []).slice().sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 4);
  const total = state.catalog?.resources?.length || 0;
  const frag = document.createDocumentFragment();

  frag.append(el('a', { class: 'cta-market', href: '#/' },
    el('span', { class: 'cta-eyebrow', text: 'Workspace' }),
    el('h3', { text: t('进入工作台') }),
    el('p', { text: t('查看你的收藏、练习记录与最近导入的文件；所有数据只保存在本机。') }),
    el('span', { class: 'wave', html: '<svg viewBox="0 0 160 60" aria-hidden="true"><g fill="currentColor"><rect x="2" y="23" width="22" height="10" rx="5"/><rect x="36" y="14" width="9" height="34" rx="4.5"/><rect x="55" y="4" width="9" height="52" rx="4.5"/><rect x="74" y="17" width="9" height="28" rx="4.5"/><rect x="93" y="23" width="22" height="10" rx="5"/></g></svg>' }),
    el('span', { class: 'cta-foot' },
      el('span', { class: 'micro', style: { opacity: '.8' }, text: t('本机访客 · 无需登录') }),
      el('span', { class: 'cta-arrow' }, icon('arrow-right', 18)),
    ),
  ));

  frag.append(el('div', { class: 'rail-card' },
    el('p', { class: 'rail-title', text: t('热门分类') }),
    el('div', { class: 'rail-list' }, categories.map((cat) => el('a', {
      class: 'rail-item',
      href: `#/category/${encodeURIComponent(cat.id)}`,
    }, icon('layer', 16), pickLang(cat.label, cat.labelEn), el('span', { class: 'count', text: String(cat.count || 0) })))),
    el('a', { class: 'rail-link', href: '#/market' }, t('全部分类'), icon('arrow-right', 16)),
  ));

  frag.append(el('div', { class: 'rail-card' },
    el('p', { class: 'rail-title', text: t('创作者与投稿') }),
    el('div', { class: 'rail-creator' },
      el('img', { class: 'avatar', src: 'assets/brand/logo-128.png', width: '38', height: '38', alt: '' }),
      el('div', { class: 'flex-1' },
        el('div', { class: 'rail-creator-name', text: 'SHADOW Studio' }),
        el('div', { class: 'rail-creator-meta', text: t('官方示例团队 · {n} 个资源 · CC-BY-4.0', { n: total }) }),
      ),
    ),
    el('div', { class: 'rail-divider' }),
    el('p', { class: 'rail-tip-text', text: t('有好的影子跟读课程包？纯数据、BYOM、版权清晰即可投稿，人工审核通过后进入市场。') }),
    el('div', { class: 'rail-foot-links' },
      el('a', { href: '#/contribute' }, `${t('投稿指南')} →`),
      el('span', { class: 'sep', text: '·' }),
      el('a', { href: '#/favorites' }, t('我的收藏')),
    ),
  ));
  return frag;
}
