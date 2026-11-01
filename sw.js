/**
 * SHADOW 市场 · Service Worker（手写，零依赖，无第三方 CDN）
 *
 * 性能优先的分层缓存（Obsidian & Amber 重设计后）：
 *   1) install：只预缓存「首屏关键外壳」（HTML/CSS/字体/核心 JS/dashboard 视图/品牌小图），
 *      不在首访时批量预取全部资源，避免抢占 FCP/LCP 带宽；
 *   2) 页面 load 且首屏渲染后，app.js postMessage {type:'PREFETCH'}，
 *      SW 后台低并发预取其余视图模块 / 英文词典 / catalog / plugins（不抢首屏，离线仍可用）；
 *   3) 静态资源 cache-first + 后台回填（SWR），JSON network-first（3s 超时）回退缓存，
 *      导航 network-first → index.html → offline.html；
 *   4) 跨域（127.0.0.1 探测/深链）不拦截；只处理同源 GET；
 *   5) 更新：页面发 {type:'SKIP_WAITING'} → 新 SW 立即接管。
 *
 * 不缓存：用户媒体（市场没有媒体）、POST 请求、跨域请求。
 */

const VERSION = 'v2026.11.03.1';
const CACHE = `shadow-market-${VERSION}`;
const OFFLINE_URL = './offline.html';

// 首屏关键外壳：必须全部成功（数量已压缩到最小）
const SHELL_CRITICAL = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './assets/styles/tokens.css',
  './assets/styles/base.css',
  './assets/styles/pages-dashboard.css',
  './assets/styles/pages-core.css',
  './assets/fonts/InterVariable-latin.woff2',
  './assets/brand/logo-64.png',
  './assets/brand/logo-128.png',
  './assets/brand/icon-192.png',
  './assets/brand/favicon-32.png',
  './assets/brand/apple-touch-icon-180.png',
  './assets/js/app.js',
  './assets/js/i18n.js',
  './assets/js/dom.js',
  './assets/js/icons.js',
  './assets/js/data.js',
  './assets/js/router.js',
  './assets/js/theme.js',
  './assets/js/points.js',
  './assets/js/components.js',
  './assets/js/prefs.js',
  './assets/js/pwa.js',
  './assets/js/views/home.js',
  './assets/js/views/ui.js',
];

// 后台预取：其余路由模块 / 英文词典 / catalog / plugins（页面 load 后由 app.js 触发）
const PREFETCH = [
  './assets/styles/pages-personal.css',
  './assets/js/i18n-en.js',
  './assets/js/importer.js',
  './assets/js/markdown.js',
  './assets/js/palette.js',
  './assets/js/views/market.js',
  './assets/js/views/resource.js',
  './assets/js/views/about.js',
  './assets/js/views/changelog.js',
  './assets/js/views/complaint.js',
  './assets/js/views/contribute.js',
  './assets/js/views/creator.js',
  './assets/js/views/favorites.js',
  './assets/js/views/import.js',
  './assets/js/views/license.js',
  './assets/js/views/notfound.js',
  './assets/js/views/points.js',
  './assets/js/views/privacy.js',
  './assets/js/views/settings.js',
  './assets/brand/favicon.ico',
  './assets/brand/icon-512.png',
  './catalog/site.json',
  './catalog/categories.json',
  './catalog/tags.json',
  './catalog/authors.json',
  './catalog/licenses.json',
  './catalog/resources.json',
  './plugins/index.json',
  './plugins/course/manifest.json',
  './plugins/subtitle/manifest.json',
  './plugins/plugin/manifest.json',
  './data/plugins/builtin-whitelist.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL_CRITICAL.map((url) => new Request(url, { cache: 'reload' })));
    // 首屏渲染所需的数据尽量在安装期轻量补齐（失败不阻塞安装）
    const light = ['./catalog/resources.json', './catalog/site.json'];
    await Promise.allSettled(light.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res.ok) await cache.put(url, res);
      } catch { /* 数据缺失不影响安装 */ }
    }));
    // 不自动 skipWaiting：由页面提示「新版本可用」，用户确认后发消息
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('shadow-market-') && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (data.type === 'PREFETCH') {
    if (typeof event.waitUntil === 'function') event.waitUntil(prefetchAll());
    else prefetchAll();
    return;
  }
  if (data.type === 'CLEAR_CACHES') {
    event.waitUntil(caches.delete(CACHE));
  }
});

/* ---------------- 工具 ---------------- */

const STATIC_EXT = /\.(?:css|js|mjs|png|jpe?g|webp|svg|ico|woff2?|ttf|otf)$/i;
const DATA_EXT = /\.(?:json|shadowcourse|srt|txt|md)$/i;

function isSameOrigin(url) { return url.origin === self.location.origin; }
function isNavigation(request) {
  return request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');
}
function isDataRequest(url) {
  return DATA_EXT.test(url.pathname) || /\/(?:catalog|data|plugins)\//.test(url.pathname);
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('network-timeout')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/** 后台低并发预取（4 路），只写缓存、不阻塞页面 */
async function prefetchAll() {
  const cache = await caches.open(CACHE);
  const queue = PREFETCH.slice();
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        const cached = await cache.match(url);
        if (cached) continue;
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res.ok) await cache.put(url, res);
      } catch { /* 缺失/离线时忽略 */ }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

/** 网络优先：成功写缓存；失败/超时回退缓存 */
async function networkFirst(request, { timeoutMs = 3000, fallbackUrl = null } = {}) {
  const cache = await caches.open(CACHE);
  try {
    const response = await withTimeout(fetch(request), timeoutMs);
    if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw new Error('offline');
  }
}

/** 导航：network-first → 已缓存页面 / index.html → offline.html */
async function handleNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await withTimeout(fetch(request), 4000);
    if (response && response.ok) {
      const indexUrl = new URL('./index.html', self.location.href).href;
      cache.put(indexUrl, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const direct = await cache.match(request);
    if (direct) return direct;
    const cached = await cache.match('./index.html') || await cache.match('./');
    if (cached) return cached;
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response('离线：SHADOW 市场尚未缓存。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

/** 静态：cache-first + 后台回填（stale-while-revalidate） */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  }).catch(() => null);
  return cached || (await network) || new Response('offline', { status: 503 });
}

/** 数据：network-first 超时回退缓存（JSON 变动较频繁） */
async function handleData(request) {
  try {
    return await networkFirst(request, { timeoutMs: 3000 });
  } catch {
    return new Response(JSON.stringify({ error: 'offline', message: '当前离线且没有缓存这份数据。' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (!/^https?:$/.test(url.protocol)) return;
  // 跨域请求（本机 SHADOW Studio 探测 / 深链 / 工具取包）不拦截，避免破坏一键导入
  if (!isSameOrigin(url)) return;

  if (isNavigation(request)) { event.respondWith(handleNavigation(request)); return; }
  if (isDataRequest(url)) { event.respondWith(handleData(request)); return; }
  if (STATIC_EXT.test(url.pathname)) { event.respondWith(staleWhileRevalidate(request)); return; }
  event.respondWith(networkFirst(request, { timeoutMs: 5000 }).catch(() => new Response('', { status: 504 })));
});
