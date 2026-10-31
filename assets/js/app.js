/**
 * SHADOW 市场 · SPA 入口（原生 ES Modules，无构建、零第三方依赖）
 *
 * 职责：语言/主题启动 → 插件清单 + 资源目录加载 → hash 路由渲染 → 顶栏交互（搜索 / 主题 / 语言 / 更多菜单）
 *      → PWA 注册与更新提示 → 数据缺失降级 → 全局错误兜底。页面视图在 views/ 下按路由拆分。
 */

import { $, el, clear, debounce } from './dom.js';
import { icon } from './icons.js';
import {
  loadPlugins, loadCatalog, getState, DATA_HINT, DATA_URLS,
} from './data.js';
import { startRouter, onRouteChange, navigate, replaceRoute, currentRoute, scrollToY } from './router.js';
import { watchSystemTheme, toggleTheme, resolveTheme } from './theme.js';
import { MarketPoints } from './points.js';
import { toast, pageHead, errorState, openModal, skeletonCards } from './components.js';
import { getPrefs } from './prefs.js';
import {
  initI18n, applyStaticI18n, setLang, getLang, t, langButtonLabel, onLangChange, isEnglish,
} from './i18n.js';
import {
  registerPWA, applyUpdate, watchInstallPrompt, onInstallAvailability, promptInstall, canInstall, isIosSafari,
} from './pwa.js';

/* ---------------- 路由级懒加载（P0 性能：首屏只加载所需视图） ---------------- */
const VIEW_LOADERS = {
  home: () => import('./views/home.js'),
  search: () => import('./views/home.js'),
  category: () => import('./views/home.js'),
  tag: () => import('./views/home.js'),
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
  const promise = loader().catch((err) => {
    viewCache.delete(name);
    throw err;
  });
  viewCache.set(name, promise);
  return promise;
}

let palettePromise = null;
function loadPalette() {
  if (!palettePromise) palettePromise = import('./palette.js');
  return palettePromise;
}
async function openCommandPalette() {
  try { (await loadPalette()).openCommandPalette(); } catch (err) { console.warn('[market] 命令面板加载失败', err); }
}
async function closeCommandPalette() {
  if (!palettePromise) return;
  try { (await palettePromise).closeCommandPalette(); } catch { /* ignore */ }
}

const APP_VERSION = 'market-p0.2';
const SITE_TITLE = () => t('SHADOW 市场');

const viewEl = $('#view');
const mainEl = $('#main');
const searchInput = $('#global-search');
const bannerEl = $('#global-banner');
const pwaBannerEl = $('#pwa-banner');
const statusEl = $('#view-status');

let booted = false;
let fixtureLoading = false;
let moreMenuOpen = false;

/* ---------------- 数据缺失 / 夹具降级 ---------------- */

function fixtureBanner() {
  if (!bannerEl) return;
  const state = getState();
  if (state.fixture) {
    bannerEl.hidden = false;
    clear(bannerEl);
    bannerEl.append(
      el('span', {}, t('当前为'), ' ', el('strong', { text: t('演示夹具') }), `（assets/dev-fixtures）：${t('真实目录未生成或未加载，页面内容是界面演示数据，不是线上资源。')}`),
      el('button', {
        class: 'banner-action', type: 'button', 'data-testid': 'exit-fixture',
        onclick: async () => {
          const raw = (window.location.hash || '#/').replace(/^#/, '');
          const [pathPart, queryPart = ''] = raw.split('?');
          const params = new URLSearchParams(queryPart);
          params.delete('fixture');
          replaceRoute(pathPart.startsWith('/') ? pathPart : `/${pathPart}`, params.toString());
          try {
            await loadCatalog({ fixture: false });
            toast(t('已切回真实数据'), { kind: 'success' });
          } catch (err) {
            toast(t('真实目录仍不可用：{message}', { message: err.message || err }), { kind: 'error', timeout: 5200 });
          }
          renderCurrent({ scroll: false });
        },
      }, t('退出夹具 · 重试真实数据')),
    );
  } else {
    bannerEl.hidden = true;
    clear(bannerEl);
  }
}

function enterFixtureMode() {
  if (fixtureLoading) return;
  fixtureLoading = true;
  loadCatalog({ fixture: true })
    .then(() => toast(t('已加载演示夹具（界面演示数据，非真实资源）'), { kind: 'warn', timeout: 4800 }))
    .catch((err) => toast(t('演示夹具也不可用：{message}', { message: err.message || err }), { kind: 'error' }))
    .finally(() => {
      fixtureLoading = false;
      renderCurrent({ scroll: false });
    });
}

function showDataHelp() {
  openModal({
    title: t('生成市场数据（catalog + 课程包）'),
    body: el('div', {},
      el('p', {}, t('市场是纯静态站，只读 catalog/ 目录（schemaVersion 2）与 data/packages/*.shadowcourse。数据由构建流水线生成：')),
      el('pre', { class: 'code-block' }, `# 1) 生成课程包与导入产物（仓库根目录执行）
node tools/shadowcourse/build-packages.mjs
node tools/import/build-shadow-json.mjs

# 2) 生成 catalog/（site/categories/tags/authors/licenses/resources）
node tools/catalog/build-catalog.mjs
node tools/catalog/validate-catalog.mjs

# 3) 本地预览市场
node market/serve.mjs`),
      el('p', { class: 'points-note', style: { marginTop: '10px' } }, t('生成后可点「重试」重新加载；数据未生成时也可以用演示夹具浏览界面（页面会持续显示「演示夹具」标记）。')),
    ),
    actions: [
      { label: t('加载演示夹具'), onClick: () => { setTimeout(enterFixtureMode, 0); } },
      { label: t('重试加载'), kind: 'primary', onClick: () => { setTimeout(async () => { try { await loadCatalog(); } catch { /* 保持错误态 */ } renderCurrent({ scroll: false }); }, 0); } },
    ],
  });
}

function renderDataMissing(view) {
  const state = getState();
  const err = state.catalogError;
  view.replaceChildren(
    pageHead({
      title: t('数据未生成'),
      sub: t('市场是纯静态站：需要 catalog/resources.json（v2）或 data/catalog.json（兼容）才能浏览资源。搜索 / 设置 / 静态页仍可用。'),
    }),
    errorState({
      title: t('读不到资源目录'),
      desc: t('可能数据还没生成，或静态托管的相对路径不对。可以重试，或先加载演示夹具查看/验收界面（夹具会一直显示「演示夹具」标记，不冒充真实数据）。'),
      detail: `${err?.url || DATA_URLS.resources}${err?.message ? ` · ${err.message}` : ''}`,
      actions: [
        {
          label: t('重试加载'), icon: 'refresh', testid: 'retry-catalog',
          onClick: async () => {
            try { await loadCatalog(); toast(t('真实数据已加载'), { kind: 'success' }); } catch (e) { toast(t('仍然失败：{message}', { message: e.message || e }), { kind: 'error' }); }
            renderCurrent({ scroll: false });
          },
        },
        { label: t('加载演示夹具（界面演示）'), icon: 'layers', testid: 'load-fixture', onClick: enterFixtureMode },
        { label: t('查看数据生成命令'), icon: 'terminal', onClick: showDataHelp },
      ],
    }),
    el('p', { class: 'points-note', style: { marginTop: '16px' } },
      t('生成命令：'), el('code', { text: DATA_HINT }),
    ),
  );
}

/* ---------------- 路由渲染 ---------------- */

function activeNavKey(route) {
  if (['home', 'category', 'tag', 'search', 'resource', 'license', 'points', 'favorites', 'changelog', 'contribute', 'about', 'privacy', 'complaint', 'import', 'settings'].includes(route.name)) {
    if (route.name === 'favorites') return 'favorites';
    if (route.name === 'contribute') return 'contribute';
    if (['about', 'privacy', 'complaint', 'changelog'].includes(route.name)) return 'about';
    if (['points', 'settings', 'import', 'license'].includes(route.name)) return 'more';
    return 'home';
  }
  return null;
}

function setActiveNav(route) {
  const currentKey = activeNavKey(route);
  const moreActive = ['more'].includes(currentKey);
  for (const link of document.querySelectorAll('.header-nav-link[data-nav], .bottom-nav-link[data-nav]')) {
    const key = link.dataset.nav;
    const active = key === currentKey;
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const bottomMore = $('#bottom-more');
  if (bottomMore) {
    if (moreActive) bottomMore.setAttribute('aria-current', 'page');
    else bottomMore.removeAttribute('aria-current');
  }
  const moreToggle = $('#more-toggle');
  if (moreToggle) {
    if (moreActive) moreToggle.setAttribute('data-active', 'true');
    else moreToggle.removeAttribute('data-active');
  }
}

function setDocumentTitle(route) {
  const state = getState();
  let title = `${SITE_TITLE()} · ${t('全免费影子跟读课程资源站')}`;
  if (route.name === 'home') title = `${SITE_TITLE()} · ${t('全免费影子跟读课程资源站')}`;
  else if (route.name === 'search') title = `${t('搜索')} ${route.query.get('q') || ''} · ${SITE_TITLE()}`;
  else if (route.name === 'category') {
    const category = state.catalog?.categoryMap.get(route.params.id);
    title = `${category ? category.label : t('分类')} · ${SITE_TITLE()}`;
  } else if (route.name === 'tag') title = `${t('标签：{tag}', { tag: route.params.tag || '' })} · ${SITE_TITLE()}`;
  else if (route.name === 'resource') {
    const resource = state.catalog?.resources.find((r) => r.id === route.params.id);
    title = resource ? `${resource.title} · ${SITE_TITLE()}` : `${t('资源不存在')} · ${SITE_TITLE()}`;
  } else if (route.name === 'license') {
    const resource = state.catalog?.resources.find((r) => r.id === route.params.id);
    title = `${t('许可证')}${resource ? ` · ${resource.title}` : ''} · ${SITE_TITLE()}`;
  } else if (route.name === 'creator') {
    const creator = state.catalog?.authorMap.get(route.params.handle);
    title = creator ? `${creator.name} · ${SITE_TITLE()}` : `${t('作者不存在')} · ${SITE_TITLE()}`;
  } else if (route.name === 'points') title = `${t('积分（P1 预览）')} · ${SITE_TITLE()}`;
  else if (route.name === 'settings') title = `${t('设置')} · ${SITE_TITLE()}`;
  else if (route.name === 'import') title = `${t('一键导入说明')} · ${SITE_TITLE()}`;
  else if (route.name === 'favorites') title = `${t('我的收藏')} · ${SITE_TITLE()}`;
  else if (route.name === 'changelog') title = `${t('更新日志')} · ${SITE_TITLE()}`;
  else if (route.name === 'contribute') title = `${t('投稿指南')} · ${SITE_TITLE()}`;
  else if (route.name === 'about') title = `${t('关于 SHADOW 市场')} · ${SITE_TITLE()}`;
  else if (route.name === 'privacy') title = `${t('隐私说明')} · ${SITE_TITLE()}`;
  else if (route.name === 'complaint') title = `${t('版权与投诉')} · ${SITE_TITLE()}`;
  else if (route.name === 'notFound') title = `404 · ${SITE_TITLE()}`;
  document.title = title;
}

function syncSearchInput(route) {
  if (!searchInput) return;
  if (document.activeElement === searchInput) return;
  if (route.name === 'search') {
    const q = route.query.get('q') || '';
    if (searchInput.value !== q) searchInput.value = q;
  } else if (searchInput.value) {
    searchInput.value = '';
  }
}

function announceRoute(route) {
  if (!statusEl) return;
  statusEl.textContent = document.title;
}

let renderSeq = 0;
const VIEW_RENDERERS = {
  resource: 'renderResource',
  license: 'renderLicense',
  creator: 'renderCreator',
  favorites: 'renderFavorites',
  changelog: 'renderChangelog',
  contribute: 'renderContribute',
  about: 'renderAbout',
  privacy: 'renderPrivacy',
  complaint: 'renderComplaint',
  import: 'renderImport',
  points: 'renderPoints',
  settings: 'renderSettings',
  notFound: 'renderNotFound',
};

async function renderRoute(route, { reason = 'hashchange' } = {}) {
  if (!viewEl) return;
  const state = getState();
  if (route.query.get('fixture') === '1' && !state.fixture && !state.loading && !fixtureLoading) {
    enterFixtureMode();
    return;
  }
  const seq = ++renderSeq;
  closeMoreMenu();
  setActiveNav(route);
  syncSearchInput(route);
  fixtureBanner();
  viewEl.setAttribute('aria-busy', 'true');
  try {
    if (!state.catalog) {
      renderDataMissing(viewEl);
    } else {
      // 路由级动态 import：首屏只加载当前路由的视图模块（性能优化）
      const mod = await loadView(route.name);
      if (seq !== renderSeq) return;
      if (route.name === 'home') {
        mod.renderExplore(viewEl, { mode: 'home', queryParams: route.query });
      } else if (route.name === 'search') {
        mod.renderExplore(viewEl, { mode: 'search', query: route.query.get('q') || '', queryParams: route.query });
      } else if (route.name === 'category') {
        mod.renderExplore(viewEl, { mode: 'category', categoryId: route.params.id, queryParams: route.query });
      } else if (route.name === 'tag') {
        mod.renderExplore(viewEl, { mode: 'tag', tag: route.params.tag, queryParams: route.query });
      } else {
        const renderName = VIEW_RENDERERS[route.name] || 'renderNotFound';
        const renderFn = mod[renderName];
        if (typeof renderFn !== 'function') throw new Error(`视图模块缺少 ${renderName}（${route.name}）`);
        if (['resource', 'license', 'creator', 'settings', 'notFound'].includes(route.name)) await renderFn(viewEl, route);
        else await renderFn(viewEl);
      }
    }
  } catch (err) {
    console.warn('[market] 页面渲染异常，已显示错误兜底：', err);
    viewEl.replaceChildren(errorState({
      title: t('页面渲染失败'),
      desc: t('这是市场前端的兜底错误页（不会白屏）。可以回到首页重试，或在设置里重新加载数据。'),
      detail: err && err.message ? err.message : String(err),
      actions: [
        { label: t('回到首页'), href: '#/', icon: 'compass', kind: 'primary' },
        { label: t('重新加载数据'), icon: 'refresh', onClick: () => window.dispatchEvent(new CustomEvent('market:reload')) },
      ],
    }));
  } finally {
    if (seq !== renderSeq) return;
    viewEl.setAttribute('aria-busy', 'false');
    document.body.dataset.route = route.name;
    setDocumentTitle(route);
    announceRoute(route);
    if (reason !== 'replace') scrollToY(0, { behavior: 'auto' });
    document.body.dataset.appReady = 'true';
  }
}

function renderCurrent(opts = {}) {
  renderRoute(currentRoute(), opts).catch((err) => console.warn('[market] 渲染调度失败', err));
}

/* ---------------- 顶栏 / 全局交互 ---------------- */

function updateThemeButton() {
  const btn = $('#theme-toggle');
  if (!btn) return;
  const dark = resolveTheme() === 'dark';
  btn.replaceChildren(icon(dark ? 'sun' : 'moon', 16));
  const label = dark ? t('切换到浅色模式') : t('切换到深色模式');
  btn.setAttribute('title', label);
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
}

function updateLangButton() {
  const btn = $('#lang-toggle');
  if (!btn) return;
  const labelEl = $('#lang-toggle-label');
  if (labelEl) labelEl.textContent = langButtonLabel();
  btn.setAttribute('lang', isEnglish() ? 'zh-CN' : 'en');
  // 可见文字（EN / 中文）必须包含在可访问名中（axe label-content-name-mismatch）
  btn.setAttribute('aria-label', `${t('切换语言')} · ${langButtonLabel()}`);
  btn.setAttribute('title', isEnglish() ? '切换为中文界面' : 'Switch to English');
}

function closeMoreMenu() {
  const menu = $('#more-menu');
  const toggle = $('#more-toggle');
  const bottom = $('#bottom-more');
  moreMenuOpen = false;
  if (menu) menu.hidden = true;
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
  if (bottom) bottom.setAttribute('aria-expanded', 'false');
}

function openMoreMenu() {
  const menu = $('#more-menu');
  const toggle = $('#more-toggle');
  if (!menu) return;
  moreMenuOpen = true;
  menu.hidden = false;
  if (toggle) toggle.setAttribute('aria-expanded', 'true');
  const first = menu.querySelector('a');
  if (first) first.focus({ preventScroll: true });
}

function bindHeader() {
  // 主题
  const themeBtn = $('#theme-toggle');
  themeBtn?.addEventListener('click', () => {
    toggleTheme();
    updateThemeButton();
    toast(t('已切换到{mode}模式（保存在本机）', { mode: resolveTheme() === 'dark' ? t('深色') : t('浅色') }), { kind: 'success', timeout: 2200 });
  });
  window.addEventListener('market:themechange', updateThemeButton);
  updateThemeButton();
  watchSystemTheme();

  // 语言（不刷新页面：更新静态文案 + 重渲染当前视图）
  const langBtn = $('#lang-toggle');
  langBtn?.addEventListener('click', () => {
    setLang(getLang() === 'en' ? 'zh-CN' : 'en');
  });
  updateLangButton();
  onLangChange(() => {
    applyStaticI18n();
    updateLangButton();
    updateThemeButton();
    renderCurrent({ scroll: false });
  });
  window.addEventListener('market:togglelang', () => {
    setLang(getLang() === 'en' ? 'zh-CN' : 'en');
  });

  // 搜索：输入实时过滤（replaceState，不污染后退栈）；回车跳转；Esc 清空
  const form = $('#header-search-form');
  const doSearch = debounce((rawValue) => {
    const q = String(rawValue || '').trim();
    const route = currentRoute();
    if (route.name === 'search') {
      const params = new URLSearchParams(route.query.toString());
      if (q) params.set('q', q); else params.delete('q');
      replaceRoute('/search', params.toString());
    } else if (q) {
      replaceRoute('/search', new URLSearchParams({ q }).toString());
    }
  }, 180);

  searchInput?.addEventListener('input', (e) => doSearch(e.target.value));
  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = searchInput.value.trim();
      navigate('/search', new URLSearchParams(q ? { q } : {}).toString());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      searchInput.value = '';
      const route = currentRoute();
      if (route.name === 'search') navigate('/');
      else searchInput.blur();
    }
  });
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    navigate('/search', new URLSearchParams(q ? { q } : {}).toString());
  });

  // 快捷键：/ 聚焦搜索；Ctrl+K / ⌘K 命令面板；? 显示快捷键说明
  document.addEventListener('keydown', (e) => {
    const target = e.target;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    const modalOpen = $('#modal-root')?.childElementCount > 0 || $('#palette-root')?.childElementCount > 0;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (modalOpen) return;
      openCommandPalette();
      return;
    }
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !modalOpen) {
      e.preventDefault();
      searchInput?.focus();
      searchInput?.select();
    }
    if (e.key === '?' && !typing && !modalOpen) {
      e.preventDefault();
      openShortcutsModal();
    }
  });

  // 命令面板按钮
  $('#open-palette')?.addEventListener('click', () => openCommandPalette());
  window.addEventListener('market:openpalette', () => openCommandPalette());
  window.addEventListener('market:close-palette', () => closeCommandPalette());

  // 「更多」菜单（桌面 popover + 移动端底部导航按钮 → 弹层）
  const moreToggle = $('#more-toggle');
  moreToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (moreMenuOpen) closeMoreMenu();
    else openMoreMenu();
  });
  $('#more-menu')?.addEventListener('click', () => closeMoreMenu());
  document.addEventListener('click', (e) => {
    if (!moreMenuOpen) return;
    const menu = $('#more-menu');
    if (menu && !menu.contains(e.target) && !moreToggle?.contains(e.target)) closeMoreMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && moreMenuOpen) closeMoreMenu();
  });
  $('#bottom-more')?.addEventListener('click', () => {
    const bottom = $('#bottom-more');
    if (bottom) bottom.setAttribute('aria-expanded', 'true');
    openMoreSheet(() => bottom?.setAttribute('aria-expanded', 'false'));
  });

  // 安装到主屏幕（PWA）
  watchInstallPrompt();
  const installBtn = $('#install-btn');
  onInstallAvailability(({ available, installed }) => {
    if (installBtn) installBtn.hidden = !available;
    if (installed) toast(t('已安装到主屏幕'), { kind: 'success' });
  });
  installBtn?.addEventListener('click', async () => {
    const result = await promptInstall();
    if (result === 'accepted') toast(t('开始安装 SHADOW 市场…'), { kind: 'success' });
    else if (result === 'unavailable') {
      toast(isIosSafari()
        ? t('iOS Safari：点「分享」按钮 →「添加到主屏幕」即可安装。')
        : t('当前浏览器暂未提供安装入口：可用地址栏菜单「安装应用 / 添加到主屏幕」。'), { kind: 'warn', timeout: 5200 });
    }
  });

  // 登录占位（P0 无账号）
  $('#login-btn')?.addEventListener('click', () => {
    toast(t('P1 将支持可选账户（邮箱验证码）；P0 全免费，浏览 / 下载 / 导入都不需要登录。'), { kind: 'warn', timeout: 5600 });
  });

  // 重新加载数据（设置页 / 命令面板触发）
  window.addEventListener('market:reload', async () => {
    try {
      await loadPlugins();
      await loadCatalog();
      toast(t('已重新加载插件清单与资源目录'), { kind: 'success' });
    } catch (err) {
      toast(t('重新加载失败：{message}', { message: err.message || err }), { kind: 'error' });
    }
    renderCurrent({ scroll: false });
  });
}

function openMoreSheet(onClose) {
  const links = [
    { href: '#/import', label: t('一键导入说明'), icon: 'upload' },
    { href: '#/changelog', label: t('更新日志'), icon: 'history' },
    { href: '#/favorites', label: t('我的收藏'), icon: 'star' },
    { href: '#/points', label: t('积分（P1 预览）'), icon: 'diamond' },
    { href: '#/settings', label: t('设置'), icon: 'gear' },
    { href: '#/about', label: t('关于'), icon: 'info' },
    { href: '#/privacy', label: t('隐私说明'), icon: 'shield' },
    { href: '#/complaint', label: t('版权与投诉'), icon: 'scale' },
  ];
  let handle = null;
  handle = openModal({
    title: t('更多'),
    body: el('nav', { class: 'more-sheet', 'aria-label': t('更多菜单') },
      links.map((link) => el('a', {
        class: 'more-sheet-link',
        href: link.href,
        onclick: () => setTimeout(() => handle?.close(), 0),
      }, icon(link.icon, 16), link.label)),
    ),
    onClose,
    extraClass: 'modal-sheet',
  });
  if (handle) handle.element.style.width = 'min(420px, 100%)';
}

function openShortcutsModal() {
  openModal({
    title: t('键盘快捷键'),
    body: el('div', {},
      el('p', {}, t('市场支持键盘完成全部浏览操作：')),
      el('ul', { class: 'points-rule-list' },
        el('li', {}, el('kbd', { class: 'kbd' }, '/'), ` ${t('聚焦搜索框')}`),
        el('li', {}, el('kbd', { class: 'kbd' }, 'Ctrl'), ' + ', el('kbd', { class: 'kbd' }, 'K'), ` ${t('打开命令面板')}`),
        el('li', {}, el('kbd', { class: 'kbd' }, '?'), ` ${t('打开本说明')}`),
        el('li', {}, el('kbd', { class: 'kbd' }, 'Tab'), ` ${t('在链接/按钮/Tabs 间移动')}`),
        el('li', {}, el('kbd', { class: 'kbd' }, '←'), ' ', el('kbd', { class: 'kbd' }, '→'), ` ${t('详情页 Tabs 切换')}`),
        el('li', {}, el('kbd', { class: 'kbd' }, 'Esc'), ` ${t('关闭弹层 / 菜单 / 清空搜索')}`),
      ),
    ),
    actions: [{ label: t('关闭'), kind: 'primary' }],
  });
}

/* ---------------- PWA 更新提示 ---------------- */

function showUpdateBanner() {
  if (!pwaBannerEl) return;
  pwaBannerEl.hidden = false;
  clear(pwaBannerEl);
  pwaBannerEl.append(
    el('span', { class: 'pwa-banner-text' }, icon('refresh', 14), ` ${t('新版本可用')}：${t('刷新后生效。')}`),
    el('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => applyUpdate() }, t('立即更新')),
    el('button', { class: 'btn btn-sm', type: 'button', onclick: () => { pwaBannerEl.hidden = true; } }, t('稍后')),
  );
}

/* ---------------- 启动 ---------------- */

function initialSkeleton() {
  const wrap = el('div', {});
  wrap.append(
    el('div', { class: 'sk sk-line', style: { width: '28%', height: '26px', marginBottom: '10px' } }),
    el('div', { class: 'sk sk-line', style: { width: '52%', marginBottom: '24px' } }),
  );
  const list = el('div', { class: 'res-list' });
  list.append(skeletonCards(3));
  wrap.append(list);
  return wrap;
}

function isFixtureRequested() {
  try {
    const page = new URLSearchParams(window.location.search || '');
    if (page.get('fixture') === '1') return true;
    const raw = (window.location.hash || '').replace(/^#/, '');
    const q = raw.split('?')[1] || '';
    if (new URLSearchParams(q).get('fixture') === '1') return true;
    return sessionStorage.getItem('shadow.market.fixture.v1') === '1';
  } catch { return false; }
}

async function bootPWA() {
  if (location.protocol === 'file:') return null;
  const reg = await registerPWA({ onUpdate: () => showUpdateBanner() });
  return reg;
}

/** PWA 延迟注册：等首屏/load 之后再注册 SW，避免 install 预缓存抢占首屏带宽（Lighthouse 指标） */
function schedulePWA() {
  const run = () => {
    setTimeout(() => {
      bootPWA().then(() => {
        // 首屏渲染完成后再通知 SW 后台预取非关键资源（懒加载视图 / 数据 / 图标）
        setTimeout(async () => {
          try {
            const ready = await navigator.serviceWorker.ready;
            (ready.active || navigator.serviceWorker.controller)?.postMessage({ type: 'PREFETCH' });
          } catch { /* ignore */ }
        }, 2500);
      });
    }, 400);
  };
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
}

async function boot() {
  if (booted) return;
  booted = true;
  await initI18n();
  updateLangButton();
  if (viewEl) {
    // index.html 已内置静态首屏（LCP 早出现 + CLS 预留高度）；仅在缺失时用 JS 骨架兜底
    if (!viewEl.firstElementChild) viewEl.replaceChildren(initialSkeleton());
    viewEl.setAttribute('aria-busy', 'true');
  }
  bindHeader();

  try {
    const pluginsPromise = loadPlugins();
    let catalogError = null;
    try {
      await loadCatalog({ fixture: isFixtureRequested() });
    } catch (err) {
      catalogError = err;
      if (isFixtureRequested()) {
        try { await loadCatalog({ fixture: true }); catalogError = null; } catch { /* 保持错误态 */ }
      }
    }
    await pluginsPromise;
    if (catalogError) console.warn('[market] 资源目录不可用：', catalogError.message || catalogError);
  } catch (err) {
    console.warn('[market] 启动加载异常：', err);
  }

  startRouter();
  onRouteChange((route, reason) => { renderRoute(route, { reason }).catch((err) => console.warn('[market] 路由渲染失败', err)); });
  renderCurrent({ scroll: true });

  // 自测 / 调试入口（只读 + 适配器，不改变页面行为）
  window.__MARKET__ = {
    version: APP_VERSION,
    get ready() { return document.body.dataset.appReady === 'true'; },
    get state() { return getState(); },
    get lang() { return getLang(); },
    setLang,
    points: MarketPoints,
    router: { navigate, replaceRoute, currentRoute },
    refresh: () => renderCurrent({ scroll: false }),
    openPalette: () => openCommandPalette(),
    closePalette: () => closeCommandPalette(),
    get prefs() { return getPrefs(); },
    pwa: { applyUpdate, canInstall },
  };
  document.body.dataset.appReady = 'true';

  schedulePWA();
}

boot();
