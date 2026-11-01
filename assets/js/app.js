/**
 * SHADOW 市场 · SPA 入口（原生 ES Modules，无构建、零第三方依赖）
 *
 * 重设计后壳（Obsidian & Amber）：
 * - 顶栏 topbar（搜索表单 / 主题 / 语言 / 积分 pill / 头像）
 * - 三栏 .app > aside.sidebar + main#view + aside#rail
 * - 移动 .mobile-nav + #bottom-more + #more-menu
 * - 静态首屏（工作台骨架）在 index.html 内，首次渲染被路由内容替换
 *
 * 路由视图：dashboard（views/home.js）、market/search/category/tag（views/market.js）、
 *          resource（views/resource.js）；其余旧路由保留接口（qa-deploy 负责内部重写）。
 */

import { $, el } from './dom.js';
import { icon } from './icons.js';
import { loadPlugins, loadCatalog, getState, DATA_HINT } from './data.js';
import { startRouter, onRouteChange, navigate, replaceRoute, currentRoute, scrollToY } from './router.js';
import { watchSystemTheme, toggleTheme, resolveTheme, applyTheme } from './theme.js';
import { MarketPoints } from './points.js';
import { initI18n, applyStaticI18n, setLang, getLang, t, langButtonLabel, onLangChange } from './i18n.js';

const APP_VERSION = 'market-p0.3';

/* ---------------- 路由级懒加载 ---------------- */
const VIEW_LOADERS = {
  dashboard: () => import('./views/home.js'),
  market: () => import('./views/market.js'),
  search: () => import('./views/market.js'),
  category: () => import('./views/market.js'),
  tag: () => import('./views/market.js'),
  resource: () => import('./views/resource.js'),
  license: () => import('./views/license.js'),
  creator: () => import('./views/creator.js'),
  favorites: () => import('./views/favorites.js'),
  changelog: () => import('./views/changelog.js'),
  contribute: () => import('./views/contribute.js'),
  about: () => import('./views/about.js'),
  privacy: () => import('./views/privacy.js'),
  complaint: () => import('./views/complaint.js'),
  import: () => import('./views/import.js'),
  points: () => import('./views/points.js'),
  settings: () => import('./views/settings.js'),
  notFound: () => import('./views/notfound.js'),
};
const viewCache = new Map();
function loadView(name) {
  if (viewCache.has(name)) return viewCache.get(name);
  const loader = VIEW_LOADERS[name] || VIEW_LOADERS.notFound;
  const promise = loader().catch((err) => { viewCache.delete(name); throw err; });
  viewCache.set(name, promise);
  return promise;
}

/* ---------------- 壳元素 ---------------- */
const viewEl = $('#view');
const railEl = $('#rail');
const sidebarEl = $('.sidebar');
const searchForm = $('#header-search-form');
const searchInput = $('#header-search-input');
const statusEl = $('#view-status');
const moreMenu = $('#more-menu');
const bottomMore = $('#bottom-more');
const pointsPill = $('#points-pill-value');

// 二级页面样式（个人/静态页）按需加载：首屏工作台/市场/详情不下载 ~34KB 的 pages-personal.css
const PERSONAL_ROUTES = new Set(['favorites', 'points', 'contribute', 'about', 'privacy', 'complaint', 'changelog', 'import', 'settings', 'license', 'creator', 'notFound']);
let personalCssPromise = null;
function ensurePersonalStyles(route) {
  if (!PERSONAL_ROUTES.has(route.name)) return;
  if (personalCssPromise) return;
  personalCssPromise = new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'assets/styles/pages-personal.css';
    link.onload = resolve;
    link.onerror = resolve;
    document.head.appendChild(link);
  });
}

const defaultSidebar = sidebarEl ? Array.from(sidebarEl.childNodes).map((n) => n.cloneNode(true)) : [];
let booted = false;
let renderSeq = 0;
let prefsCache = null;

/** 按需加载 UI 组件（toast/modal）：不进入首屏关键路径 */
async function toastLazy(message, opts) {
  try { const mod = await import('./components.js'); mod.toast(message, opts); } catch { /* ignore */ }
}

/* ---------------- 侧栏 / 右栏 ---------------- */

function restoreSidebar() {
  if (!sidebarEl) return;
  sidebarEl.replaceChildren(...defaultSidebar.map((n) => n.cloneNode(true)));
  sidebarEl.removeAttribute('data-market-filters');
  // 侧栏是静态快照克隆：每次重建后按当前语言重绘 data-i18n 文案（否则切 EN 后侧栏仍是中文）
  applyStaticI18n(sidebarEl);
}

function setSidebar(nodes) {
  if (!sidebarEl) return;
  const list = nodes instanceof DocumentFragment ? Array.from(nodes.childNodes) : (Array.isArray(nodes) ? nodes : []);
  sidebarEl.replaceChildren(...list);
  sidebarEl.setAttribute('data-market-filters', 'true');
  applyStaticI18n(sidebarEl);
}

/** 旧路由的兜底右栏：进入市场 CTA + 合规 */
function defaultRail() {
  const frag = document.createDocumentFragment();
  frag.append(el('a', { class: 'cta-market', href: '#/market' },
    el('span', { class: 'cta-eyebrow', text: 'Market' }),
    el('h3', { text: t('进入市场') }),
    el('p', { text: t('发现免费课程 / 字幕 / 插件资源，全部 BYOM、下载即用。') }),
    el('span', { class: 'cta-foot' },
      el('span', { class: 'micro', style: { opacity: '.8' }, text: t('全免费 · 无抽成') }),
      el('span', { class: 'cta-arrow' }, icon('arrow-right', 18)),
    ),
  ));
  frag.append(el('div', { class: 'rail-card compliance-card' },
    el('p', { class: 'rail-title', text: t('为什么可以放心用') }),
    el('ul', { class: 'stack-8' },
      el('li', { class: 'row small muted', style: { gap: '9px' } }, icon('shield', 16, 'rail-check'), t('不托管任何影视媒体（BYOM）')),
      el('li', { class: 'row small muted', style: { gap: '9px' } }, icon('gift', 16, 'rail-check'), t('全免费 · 积分不可购买/转让')),
      el('li', { class: 'row small muted', style: { gap: '9px' } }, icon('user', 16, 'rail-check'), t('无强制登录 · 数据只在本机')),
    ),
    el('a', { class: 'text-link small', href: '#/privacy', style: { marginTop: '12px', display: 'inline-block' }, text: t('隐私与合规说明') }),
  ));
  return frag;
}

async function renderRail(route, mod) {
  if (!railEl) return;
  try {
    railEl.replaceChildren();
    const frag = mod && typeof mod.renderRail === 'function' ? mod.renderRail(route) : defaultRail();
    railEl.append(frag);
  } catch (err) {
    console.warn('[market] 右栏渲染失败', err);
    railEl.replaceChildren(defaultRail());
  }
}

/* ---------------- 导航高亮 / 头栏状态 ---------------- */

const NAV_FOR_ROUTE = {
  dashboard: 'dashboard',
  market: 'market', search: 'market', category: 'market', tag: 'market',
  resource: 'market',
  favorites: 'favorites',
  points: 'points',
  settings: 'settings',
  contribute: 'contribute',
};

function setActiveNav(route) {
  const key = NAV_FOR_ROUTE[route.name] || null;
  for (const link of document.querySelectorAll('[data-nav]')) {
    const on = link.dataset.nav === key;
    link.classList.toggle('is-active', on);
    if (on) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (bottomMore) {
    const extra = ['contribute', 'changelog', 'about', 'privacy', 'complaint', 'import', 'license', 'creator', 'notFound'].includes(route.name);
    bottomMore.classList.toggle('is-active', extra);
    if (extra) bottomMore.setAttribute('aria-current', 'page');
    else bottomMore.removeAttribute('aria-current');
  }
}

function updateChrome() {
  const state = getState();
  if (pointsPill) pointsPill.textContent = String(MarketPoints.getPoints());
  const marketCount = $('#nav-count-market');
  if (marketCount) marketCount.textContent = String(state.catalog?.resources?.length || 0);
  const favCount = $('#nav-count-favorites');
  if (favCount) favCount.textContent = String(MarketPoints.getFavorites().length);
  const libCount = $('#nav-count-library');
  if (libCount) libCount.textContent = String(MarketPoints.getMyResources().length);
  const pointsCount = $('#nav-count-points');
  if (pointsCount) pointsCount.textContent = String(MarketPoints.getPoints());
  const langLabel = $('#lang-toggle-label');
  if (langLabel) langLabel.textContent = langButtonLabel();
}

function updateThemeButton() {
  const btn = $('#theme-toggle');
  if (!btn) return;
  const dark = resolveTheme() === 'dark';
  btn.setAttribute('aria-label', dark ? t('切换到浅色模式') : t('切换到深色模式'));
  btn.setAttribute('title', dark ? t('切换到浅色模式') : t('切换到深色模式'));
}

/* ---------------- More 菜单 ---------------- */

function setMoreMenu(open) {
  if (!moreMenu || !bottomMore) return;
  moreMenu.hidden = !open;
  bottomMore.setAttribute('aria-expanded', open ? 'true' : 'false');
}

/* ---------------- 文档标题 / 播报 ---------------- */

function setTitle(route) {
  const state = getState();
  let title = `SHADOW ${t('市场')} · ${t('个人工作台')}`;
  if (route.name === 'dashboard') title = `SHADOW ${t('市场')} · ${t('个人工作台')}`;
  else if (route.name === 'market') title = `${t('发现资源')} · SHADOW ${t('市场')}`;
  else if (route.name === 'search') title = `${t('搜索')} “${route.query.get('q') || ''}” · SHADOW ${t('市场')}`;
  else if (route.name === 'category') {
    const cat = state.catalog?.categoryMap?.get(route.params.id);
    title = `${cat ? cat.label : t('分类')} · SHADOW ${t('市场')}`;
  } else if (route.name === 'tag') title = `${t('标签')}：${route.params.tag} · SHADOW ${t('市场')}`;
  else if (route.name === 'resource' || route.name === 'license') {
    const res = state.catalog?.resources.find((r) => r.id === route.params.id);
    title = `${res ? res.title : t('资源不存在')} · SHADOW ${t('市场')}`;
  } else if (route.name === 'creator') {
    const author = state.catalog?.authorMap?.get(route.params.handle);
    title = `${author ? author.name : t('作者不存在')} · SHADOW ${t('市场')}`;
  } else if (route.name === 'favorites') title = `${t('我的收藏')} · SHADOW ${t('市场')}`;
  else if (route.name === 'points') title = `${t('积分')} · SHADOW ${t('市场')}`;
  else if (route.name === 'settings') title = `${t('设置')} · SHADOW ${t('市场')}`;
  else if (route.name === 'contribute') title = `${t('投稿指南')} · SHADOW ${t('市场')}`;
  else if (route.name === 'about') title = `${t('关于')} · SHADOW ${t('市场')}`;
  else if (route.name === 'privacy') title = `${t('隐私说明')} · SHADOW ${t('市场')}`;
  else if (route.name === 'complaint') title = `${t('版权与投诉')} · SHADOW ${t('市场')}`;
  else if (route.name === 'changelog') title = `${t('更新日志')} · SHADOW ${t('市场')}`;
  else if (route.name === 'import') title = `${t('导入说明')} · SHADOW ${t('市场')}`;
  else if (route.name === 'notFound') title = `404 · SHADOW ${t('市场')}`;
  document.title = title;
  if (statusEl) statusEl.textContent = title;
}

/* ---------------- 渲染 ---------------- */

function dataMissingNode() {
  return el('section', { class: 'page-head' },
    el('div', { class: 'profile-name' },
      el('h1', { class: 'name', text: t('数据未加载') }),
      el('span', { class: 'meta', text: t('市场是纯静态站：需要 catalog/resources.json（或兼容的 data/catalog.json）才能浏览资源。') }),
    ),
    el('div', { class: 'card', style: { textAlign: 'center', padding: '36px 24px' } },
      el('p', { class: 'small muted', text: `${t('数据源')}：catalog/ · ${t('生成命令')}：${DATA_HINT}` }),
      el('div', { class: 'row', style: { justifyContent: 'center', gap: '10px', marginTop: '14px' } },
        el('button', {
          class: 'btn btn-primary', type: 'button',
          onclick: async () => { try { await loadCatalog(); toastLazy(t('已重新加载目录'), { kind: 'success' }); } catch (e) { toastLazy(t('仍然失败：{message}', { message: e.message || e }), { kind: 'error' }); } renderRoute(currentRoute(), { reason: 'reload' }); },
        }, icon('rotate', 16), t('重新加载数据')),
        el('a', { class: 'btn btn-secondary', href: '#/settings' }, t('设置')),
      ),
    ),
  );
}

async function renderRoute(route, { reason = 'hashchange' } = {}) {
  if (!viewEl) return;
  ensurePersonalStyles(route);
  const state = getState();
  const seq = ++renderSeq;
  setMoreMenu(false);
  updateChrome();
  document.documentElement.dataset.route = route.name;
  document.body.dataset.route = route.name;
  viewEl.setAttribute('aria-busy', 'true');

  try {
    const mod = await loadView(route.name);
    if (seq !== renderSeq) return;

    // 侧栏：市场路由 = 筛选；其他恢复导航
    if (['market', 'search', 'category', 'tag'].includes(route.name) && typeof mod.renderSidebar === 'function') {
      // 市场：主导航 + 筛选（保留侧栏导航高亮，筛选在下方）
      const filters = mod.renderSidebar(route);
      const filterNodes = filters instanceof DocumentFragment ? Array.from(filters.childNodes) : [];
      const navSource = defaultSidebar.find((n) => n.nodeType === 1 && n.classList && n.classList.contains('side-item'))?.parentElement
        || defaultSidebar.find((n) => n.nodeType === 1);
      const navClone = navSource ? navSource.cloneNode(true) : null;
      setSidebar([navClone, ...filterNodes].filter(Boolean));
    } else {
      restoreSidebar();
    }
    setActiveNav(route);
    updateChrome(); // 侧栏 DOM 替换后重新写入高亮与计数

    if (!state.catalog && !['about', 'privacy', 'complaint', 'settings', 'import'].includes(route.name)) {
      viewEl.replaceChildren(dataMissingNode());
    } else if (route.name === 'dashboard') {
      mod.renderDashboard(viewEl, route);
    } else if (['market', 'search', 'category', 'tag'].includes(route.name)) {
      await mod.renderMarket(viewEl, route);
    } else if (route.name === 'resource') {
      await mod.renderResource(viewEl, route);
    } else {
      // 旧路由：保持接口不变（二级页面由 qa-deploy 重写）
      const legacyName = { license: 'renderLicense', creator: 'renderCreator', favorites: 'renderFavorites', changelog: 'renderChangelog', contribute: 'renderContribute', about: 'renderAbout', privacy: 'renderPrivacy', complaint: 'renderComplaint', import: 'renderImport', points: 'renderPoints', settings: 'renderSettings', notFound: 'renderNotFound' }[route.name] || 'renderNotFound';
      const fn = mod[legacyName];
      if (typeof fn !== 'function') throw new Error(`视图模块缺少 ${legacyName}`);
      if (['resource', 'license', 'creator', 'settings', 'notFound'].includes(route.name)) await fn(viewEl, route);
      else await fn(viewEl);
    }

    if (seq === renderSeq) await renderRail(route, mod);
  } catch (err) {
    console.warn('[market] 页面渲染异常，已显示兜底：', err);
    viewEl.replaceChildren(el('section', { class: 'page-head' },
      el('div', { class: 'profile-name' },
        el('h1', { class: 'name', text: t('页面渲染失败') }),
        el('span', { class: 'meta', text: err && err.message ? err.message : String(err) }),
      ),
      el('div', { class: 'row', style: { gap: '10px', marginTop: '12px' } },
        el('a', { class: 'btn btn-primary', href: '#/' }, t('回到工作台')),
        el('a', { class: 'btn btn-secondary', href: '#/market' }, t('打开市场')),
      ),
    ));
    if (seq === renderSeq) await renderRail(route, null);
  } finally {
    if (seq === renderSeq) {
      viewEl.setAttribute('aria-busy', 'false');
      setTitle(route);
      if (reason !== 'replace' && reason !== 'same') scrollToY(0, { behavior: 'auto' });
      document.body.dataset.appReady = 'true';
    }
  }
}

function renderCurrent(opts = {}) {
  renderRoute(currentRoute(), opts).catch((err) => console.warn('[market] 渲染调度失败', err));
}

/* ---------------- 头栏交互 ---------------- */

function bindChrome() {
  // 搜索
  searchForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = searchInput?.value.trim() || '';
    navigate('/search', q ? new URLSearchParams({ q }).toString() : '');
  });
  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      searchInput.value = '';
      searchInput.blur();
    }
  });

  // 主题
  $('#theme-toggle')?.addEventListener('click', () => {
    toggleTheme();
    updateThemeButton();
  });
  window.addEventListener('market:themechange', updateThemeButton);
  updateThemeButton();
  watchSystemTheme();

  // 语言（不刷新）
  $('#lang-toggle')?.addEventListener('click', () => {
    setLang(getLang() === 'en' ? 'zh-CN' : 'en');
  });
  onLangChange(() => {
    applyStaticI18n();
    updateChrome();
    updateThemeButton();
    renderCurrent({ reason: 'replace' });
  });

  // 更多菜单
  bottomMore?.addEventListener('click', (e) => {
    e.stopPropagation();
    setMoreMenu(moreMenu?.hidden !== false);
  });
  document.addEventListener('click', (e) => {
    if (!moreMenu || moreMenu.hidden) return;
    if (moreMenu.contains(e.target) || bottomMore?.contains(e.target)) return;
    setMoreMenu(false);
  });
  moreMenu?.addEventListener('click', (e) => {
    if (e.target.closest('a')) setMoreMenu(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMoreMenu(false); });

  // 快捷键：/ 聚焦搜索
  document.addEventListener('keydown', (e) => {
    const target = e.target;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      searchInput?.focus();
    }
  });

  // 本机数据变化：更新顶栏 pill / 侧栏计数
  for (const evt of ['market:favoriteschange', 'market:prefschange']) {
    window.addEventListener(evt, () => { updateChrome(); });
  }
  MarketPoints.subscribe(() => { updateChrome(); });
  window.addEventListener('storage', () => { updateChrome(); });
}

/* ---------------- 启动 ---------------- */

async function boot() {
  if (booted) return;
  booted = true;
  await initI18n();
  applyStaticI18n();
  updateChrome();
  updateThemeButton();
  bindChrome();

  try {
    try { await loadCatalog(); } catch (err) { console.warn('[market] 资源目录不可用：', err?.message || err); }
  } catch (err) {
    console.warn('[market] 启动加载异常：', err);
  }

  startRouter();
  onRouteChange((route, reason) => { renderRoute(route, { reason }).catch((err) => console.warn('[market] 路由渲染失败', err)); });
  renderCurrent({ reason: 'start' });

  // 资源类型插件清单：首屏后再加载（内置类型标签已兜底，不阻塞 LCP）
  setTimeout(() => { loadPlugins().catch((err) => console.warn('[market] 插件清单加载失败', err)); }, 400);

  // QA / 调试入口（只读适配器）
  window.__MARKET__ = {
    version: APP_VERSION,
    get ready() { return document.body.dataset.appReady === 'true'; },
    get route() { return currentRoute(); },
    get state() { return getState(); },
    get lang() { return getLang(); },
    setLang,
    setTheme: (pref) => { applyTheme(pref, { persist: true }); updateThemeButton(); },
    points: MarketPoints,
    router: { navigate, replaceRoute, currentRoute },
    refresh: () => renderCurrent({ reason: 'replace' }),
    get prefs() { return prefsCache; },
  };
  document.body.dataset.appReady = 'true';

  // PWA：首屏后延迟注册，避免 install 预缓存抢占首屏带宽
  const schedulePWA = () => {
    setTimeout(async () => {
      try {
        const { registerPWA } = await import('./pwa.js');
        await registerPWA({ onUpdate: () => toastLazy(t('新版本可用，刷新页面后生效'), { kind: 'warn', timeout: 6000 }) });
      } catch (err) {
        console.warn('[market] PWA 注册失败', err);
      }
    }, 900);
  };
  import('./prefs.js').then((mod) => { prefsCache = mod.getPrefs(); }).catch(() => {});
  if (document.readyState === 'complete') schedulePWA();
  else window.addEventListener('load', schedulePWA, { once: true });
}

boot();
