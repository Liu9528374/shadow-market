/**
 * SHADOW 市场 · SPA 入口（原生 ES Modules，无构建、无第三方依赖）
 *
 * 职责：启动加载（插件清单 + 资源目录）→ hash 路由渲染 → 顶栏绑定（搜索 / 主题 / 命令面板 / 登录占位）
 *      → 数据缺失降级 → 全局错误兜底。页面视图在 views/ 下按路由拆分。
 */

import { $, el, clear, debounce } from './dom.js';
import { icon } from './icons.js';
import {
  loadPlugins, loadCatalog, getState, DATA_HINT, DATA_URLS,
} from './data.js';
import { startRouter, onRouteChange, parseHash, navigate, replaceRoute, currentRoute } from './router.js';
import { watchSystemTheme, toggleTheme, applyTheme, resolveTheme } from './theme.js';
import { MarketPoints } from './points.js';
import { toast, pageHead, errorState, openModal, skeletonCards } from './components.js';
import { openCommandPalette, closeCommandPalette } from './palette.js';
import { renderExplore } from './views/home.js';
import { renderResource } from './views/resource.js';
import { renderCreator } from './views/creator.js';
import { renderPoints } from './views/points.js';
import { renderSettings } from './views/settings.js';
import { renderImport } from './views/import.js';
import { renderNotFound } from './views/notfound.js';
import { getPrefs } from './prefs.js';

const APP_VERSION = 'market-p0.1';
const SITE_TITLE = 'SHADOW 市场';

const viewEl = $('#view');
const mainEl = $('#main');
const searchInput = $('#global-search');
const bannerEl = $('#global-banner');

let booted = false;
let fixtureLoading = false;

/* ---------------- 数据缺失 / 夹具降级 ---------------- */

function fixtureBanner() {
  if (!bannerEl) return;
  const state = getState();
  if (state.fixture) {
    bannerEl.hidden = false;
    clear(bannerEl);
    bannerEl.append(
      el('span', {}, '当前为 ', el('strong', { text: '演示夹具' }), '（assets/dev-fixtures）：真实 data/catalog.json 未生成或未加载，页面内容是界面演示数据，不是线上资源。'),
      el('button', {
        class: 'banner-action', type: 'button', 'data-testid': 'exit-fixture',
        onclick: async () => {
          // 先去掉当前路由里的 fixture=1，避免退出后又被 router 重新拉回夹具模式
          const raw = (window.location.hash || '#/').replace(/^#/, '');
          const [pathPart, queryPart = ''] = raw.split('?');
          const params = new URLSearchParams(queryPart);
          params.delete('fixture');
          replaceRoute(pathPart.startsWith('/') ? pathPart : `/${pathPart}`, params.toString());
          try {
            await loadCatalog({ fixture: false });
            toast('已切回真实数据（data/catalog.json）', { kind: 'success' });
          } catch (err) {
            toast(`真实目录仍不可用：${err.message || err}`, { kind: 'error', timeout: 5200 });
          }
          renderCurrent({ scroll: false });
        },
      }, '退出夹具 · 重试真实数据'),
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
    .then(() => {
      toast('已加载演示夹具（界面演示数据，非真实资源）', { kind: 'warn', timeout: 4800 });
    })
    .catch((err) => {
      toast(`演示夹具也不可用：${err.message || err}`, { kind: 'error' });
    })
    .finally(() => {
      fixtureLoading = false;
      renderCurrent({ scroll: false });
    });
}

function showDataHelp() {
  openModal({
    title: '生成市场数据（catalog + 课程包）',
    body: el('div', {},
      el('p', {}, '市场是纯静态站，只读 ', el('code', { text: 'market/data/catalog.json' }), ' 与 ', el('code', { text: 'market/data/packages/*.shadowcourse' }), '。数据由课程包工具链生成：'),
      el('pre', { class: 'code-block' }, `# 1) 生成课程包与目录（仓库根目录执行）
node tools/shadowcourse/build-packages.mjs

# 2) 校验全部课程包
node tools/shadowcourse/validate.mjs --dir market/data/packages

# 3) 本地预览市场
node market/serve.mjs`),
      el('p', { class: 'points-note', style: { marginTop: '10px' } }, '生成后可点「重试」重新加载；数据未生成时也可以用演示夹具浏览界面（会有明显「演示夹具」标记，不冒充真实数据）。'),
    ),
    actions: [
      { label: '加载演示夹具', onClick: () => { setTimeout(enterFixtureMode, 0); } },
      { label: '重试加载', kind: 'primary', onClick: () => { setTimeout(async () => { try { await loadCatalog(); } catch { /* 保持错误态 */ } renderCurrent({ scroll: false }); }, 0); } },
    ],
  });
}

function renderDataMissing(view) {
  const state = getState();
  const err = state.catalogError;
  view.replaceChildren(
    pageHead({
      title: '数据未生成',
      sub: '市场是纯静态站：需要 data/catalog.json（资源目录）与 data/packages/（课程包）才能浏览资源。页面其余部分（搜索 / 设置 / 命令面板）仍可用。',
    }),
    errorState({
      title: '读不到资源目录 data/catalog.json',
      desc: '可能数据还没生成，或静态托管的相对路径不对。可以重试，或先加载演示夹具查看/验收界面（夹具会一直显示「演示夹具」标记，不冒充真实数据）。',
      detail: `${err?.url || DATA_URLS.catalog}${err?.message ? ` · ${err.message}` : ''}`,
      actions: [
        {
          label: '重试加载',
          icon: 'refresh',
          testid: 'retry-catalog',
          onClick: async () => {
            try {
              await loadCatalog();
              toast('真实数据已加载', { kind: 'success' });
            } catch (e) {
              toast(`仍然失败：${e.message || e}`, { kind: 'error' });
            }
            renderCurrent({ scroll: false });
          },
        },
        { label: '加载演示夹具（界面演示）', icon: 'layers', testid: 'load-fixture', onClick: enterFixtureMode },
        { label: '查看数据生成命令', icon: 'terminal', onClick: showDataHelp },
      ],
    }),
    el('p', { class: 'points-note', style: { marginTop: '16px' } },
      '生成命令：', el('code', { text: DATA_HINT }),
      ' · 详见 market/README.md 与 docs/52 §3。',
    ),
  );
}

/* ---------------- 路由渲染 ---------------- */

function setActiveNav(route) {
  const map = {
    home: 'home', category: 'home', search: 'home', resource: 'home', creator: 'home',
    points: 'points', settings: 'settings', import: 'import', notFound: null,
  };
  const current = map[route.name] || null;
  for (const link of document.querySelectorAll('.header-nav-link[data-nav]')) {
    if (link.dataset.nav === current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function setDocumentTitle(route) {
  const state = getState();
  let title = `${SITE_TITLE} · 全免费课程资源站`;
  if (route.name === 'home') title = `${SITE_TITLE} · 全免费课程资源站`;
  else if (route.name === 'search') title = `搜索 ${route.query.get('q') || ''} · ${SITE_TITLE}`;
  else if (route.name === 'category') {
    const category = state.catalog?.categoryMap.get(route.params.id);
    title = `${category ? category.label : '分类'} · ${SITE_TITLE}`;
  } else if (route.name === 'resource') {
    const resource = state.catalog?.resources.find((r) => r.id === route.params.id);
    title = resource ? `${resource.title} · ${SITE_TITLE}` : `资源不存在 · ${SITE_TITLE}`;
  } else if (route.name === 'creator') {
    const creator = state.catalog?.creatorMap.get(route.params.handle);
    title = creator ? `${creator.name} · ${SITE_TITLE}` : `作者不存在 · ${SITE_TITLE}`;
  } else if (route.name === 'points') title = `积分（P1 本地演示） · ${SITE_TITLE}`;
  else if (route.name === 'settings') title = `设置 · ${SITE_TITLE}`;
  else if (route.name === 'import') title = `一键导入说明 · ${SITE_TITLE}`;
  else if (route.name === 'notFound') title = `404 · ${SITE_TITLE}`;
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

function renderRoute(route, { reason = 'hashchange' } = {}) {
  if (!viewEl) return;
  const state = getState();
  // 运行时支持 #/...?fixture=1（hash 内 query）：切到演示夹具后重渲染当前路由
  if (route.query.get('fixture') === '1' && !state.fixture && !state.loading && !fixtureLoading) {
    enterFixtureMode();
    return;
  }
  setActiveNav(route);
  syncSearchInput(route);
  fixtureBanner();
  viewEl.setAttribute('aria-busy', 'true');
  try {
    if (!getState().catalog) {
      renderDataMissing(viewEl);
    } else {
      switch (route.name) {
        case 'home':
          renderExplore(viewEl, { mode: 'home', queryParams: route.query });
          break;
        case 'search':
          renderExplore(viewEl, { mode: 'search', query: route.query.get('q') || '', queryParams: route.query });
          break;
        case 'category':
          renderExplore(viewEl, { mode: 'category', categoryId: route.params.id, queryParams: route.query });
          break;
        case 'resource':
          renderResource(viewEl, route);
          break;
        case 'creator':
          renderCreator(viewEl, route);
          break;
        case 'points':
          renderPoints(viewEl);
          break;
        case 'settings':
          renderSettings(viewEl, route);
          break;
        case 'import':
          renderImport(viewEl);
          break;
        case 'notFound':
        default:
          renderNotFound(viewEl, route);
          break;
      }
    }
  } catch (err) {
    console.warn('[market] 页面渲染异常，已显示错误兜底：', err);
    viewEl.replaceChildren(errorState({
      title: '页面渲染失败',
      desc: '这是市场前端的兜底错误页（不会白屏）。可以回到首页重试，或在开发者设置里重新加载数据。',
      detail: err && err.message ? err.message : String(err),
      actions: [
        { label: '回到首页', href: '#/', icon: 'compass', kind: 'primary' },
        { label: '重新加载数据', icon: 'refresh', onClick: () => window.dispatchEvent(new CustomEvent('market:reload')) },
      ],
    }));
  } finally {
    viewEl.setAttribute('aria-busy', 'false');
    setDocumentTitle(route);
    if (reason !== 'replace') {
      try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch { window.scrollTo(0, 0); }
    }
    document.body.dataset.appReady = 'true';
  }
}

function renderCurrent(opts = {}) {
  renderRoute(currentRoute(), opts);
}

/* ---------------- 顶栏 / 全局交互 ---------------- */

function updateThemeButton() {
  const btn = $('#theme-toggle');
  if (!btn) return;
  const dark = resolveTheme() === 'dark';
  btn.replaceChildren(icon(dark ? 'sun' : 'moon', 16));
  btn.setAttribute('title', dark ? '切换到浅色模式' : '切换到深色模式');
  btn.setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到深色模式');
  btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
}

function bindHeader() {
  // 主题
  const themeBtn = $('#theme-toggle');
  themeBtn?.addEventListener('click', () => {
    toggleTheme();
    updateThemeButton();
    toast(`已切换到${resolveTheme() === 'dark' ? '深色' : '浅色'}模式（保存在本机）`, { kind: 'success', timeout: 2200 });
  });
  window.addEventListener('market:themechange', updateThemeButton);
  updateThemeButton();
  watchSystemTheme();

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
    } else if (route.name !== 'search') {
      // 清空时留在原页面
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

  // 快捷键：/ 聚焦搜索；Ctrl+K / ⌘K 命令面板
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
  });

  // 命令面板按钮
  $('#open-palette')?.addEventListener('click', () => openCommandPalette());
  window.addEventListener('market:openpalette', () => openCommandPalette());
  window.addEventListener('market:close-palette', () => closeCommandPalette());

  // 登录占位
  $('#login-btn')?.addEventListener('click', () => {
    toast('P1 将支持可选账户（邮箱验证码 / 第三方登录）；P0 全免费，浏览 / 下载 / 导入都不需要登录。当前只有匿名设备本地演示。', { kind: 'warn', timeout: 5600 });
  });

  // 重新加载数据（设置页 / 命令面板触发）
  window.addEventListener('market:reload', async () => {
    try {
      await loadPlugins();
      await loadCatalog();
      toast('已重新加载插件清单与资源目录', { kind: 'success' });
    } catch (err) {
      toast(`重新加载失败：${err.message || err}`, { kind: 'error' });
    }
    renderCurrent({ scroll: false });
  });
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

async function boot() {
  if (booted) return;
  booted = true;
  if (viewEl) {
    viewEl.replaceChildren(initialSkeleton());
    viewEl.setAttribute('aria-busy', 'true');
  }
  bindHeader();

  try {
    // 插件清单与目录并行加载；插件失败不阻塞页面（内置降级渲染器）
    const pluginsPromise = loadPlugins();
    let catalogError = null;
    try {
      await loadCatalog({ fixture: isFixtureRequested() });
    } catch (err) {
      catalogError = err;
      // 曾进过夹具模式（sessionStorage）则自动回退夹具，避免开发期每次刷新都白屏
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
  onRouteChange((route, reason) => renderRoute(route, { reason }));
  renderCurrent({ scroll: true });

  // 自测 / 调试入口（只读 + 适配器，不改变页面行为）
  window.__MARKET__ = {
    version: APP_VERSION,
    get ready() { return document.body.dataset.appReady === 'true'; },
    get state() { return getState(); },
    points: MarketPoints,
    router: { parseHash, navigate, replaceRoute, currentRoute },
    refresh: () => renderCurrent({ scroll: false }),
    openPalette: () => openCommandPalette(),
    closePalette: () => closeCommandPalette(),
    get prefs() { return getPrefs(); },
  };
  document.body.dataset.appReady = 'true';
}

boot();
