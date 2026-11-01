/**
 * hash 路由（纯前端，无依赖 · 静态托管/离线缓存友好）。
 *
 * 重设计后的路由表：
 *   #/                          工作台 dashboard（进入网站默认页）
 *   #/market                    市场 market（探索/筛选/搜索主入口）
 *   #/search?q=&type=&level=&sort=   市场搜索（复用 market 视图）
 *   #/category/<id>             市场分类（复用 market 视图）
 *   #/tag/<tag>                 市场标签（复用 market 视图）
 *   #/resource/<id>             资源详情（?tab=readme|sentences|files|versions）
 *   #/resource/<id>/license     许可证页（也接受 #/license/<id>）
 *   #/creator/<handle>          作者页
 *   #/favorites                 我的收藏（本地）
 *   #/changelog  #/contribute  #/about  #/privacy  #/complaint  #/import
 *   #/points                    积分（P1 本地演示）
 *   #/settings[/<section>]      设置
 *   #/404 或未知路由 → notFound
 * 刷新 / 直达 / 前进后退均由 hashchange 驱动。
 */

export const ROUTES = Object.freeze([
  'dashboard', 'market', 'category', 'tag', 'search',
  'resource', 'license', 'creator',
  'favorites', 'changelog', 'contribute', 'about', 'privacy', 'complaint',
  'import', 'points', 'settings', 'notFound',
]);

function safeDecode(value) {
  try { return decodeURIComponent(String(value ?? '')); } catch { return String(value ?? ''); }
}

function notFound(query, raw) { return { name: 'notFound', params: {}, query, raw }; }

/** 解析 hash → { name, params, query, raw } */
export function parseHash(hash = window.location.hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const query = new URLSearchParams(queryPart);
  const path = pathPart.replace(/^\/+/, '');
  const segments = path.split('/').filter((s) => s.length > 0).map(safeDecode);

  if (segments.length === 0) return { name: 'dashboard', params: {}, query, raw };
  const head = segments[0];
  switch (head) {
    case 'market': return { name: 'market', params: {}, query, raw };
    case 'resource':
      if (!segments[1]) return notFound(query, raw);
      if (segments[2] === 'license') return { name: 'license', params: { id: segments[1], from: 'resource' }, query, raw };
      return { name: 'resource', params: { id: segments[1] }, query, raw };
    case 'license':
      return segments[1]
        ? { name: 'license', params: { id: segments[1], from: 'license' }, query, raw }
        : notFound(query, raw);
    case 'category':
      return segments[1]
        ? { name: 'category', params: { id: segments[1] }, query, raw }
        : notFound(query, raw);
    case 'tag':
      return segments[1]
        ? { name: 'tag', params: { tag: segments[1] }, query, raw }
        : notFound(query, raw);
    case 'creator':
      return segments[1]
        ? { name: 'creator', params: { handle: segments[1].replace(/^@/, '') }, query, raw }
        : notFound(query, raw);
    case 'search': return { name: 'search', params: {}, query, raw };
    case 'favorites': return { name: 'favorites', params: {}, query, raw };
    case 'changelog': return { name: 'changelog', params: {}, query, raw };
    case 'contribute': return { name: 'contribute', params: {}, query, raw };
    case 'about': return { name: 'about', params: {}, query, raw };
    case 'privacy': return { name: 'privacy', params: {}, query, raw };
    case 'complaint': return { name: 'complaint', params: {}, query, raw };
    case 'points': return { name: 'points', params: {}, query, raw };
    case 'settings': return { name: 'settings', params: { section: segments[1] || '' }, query, raw };
    case 'import': return { name: 'import', params: {}, query, raw };
    case 'home': return { name: 'dashboard', params: {}, query, raw }; // 旧链接兼容
    case '404': return notFound(query, raw);
    default: return { name: 'notFound', params: { path }, query, raw };
  }
}

/** 构造 hash 字符串 */
export function buildHash(path, query) {
  let h = path.startsWith('#') ? path : `#${path.startsWith('/') ? '' : '/'}${path}`;
  if (query) {
    const qs = query instanceof URLSearchParams ? query.toString() : String(query).replace(/^\?/, '');
    if (qs) h += (h.includes('?') ? '&' : '?') + qs;
  }
  return h;
}

const listeners = new Set();

export function onRouteChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function emit(reason) {
  const route = parseHash();
  for (const fn of listeners) {
    try { fn(route, reason); } catch (err) { console.error('[market] 路由渲染失败', err); }
  }
  return route;
}

export function startRouter() {
  if (!window.location.hash) {
    try { history.replaceState(null, '', buildHash('/')); } catch { window.location.hash = '#/'; }
  }
  window.addEventListener('hashchange', () => emit('hashchange'));
  return emit('start');
}

/** 普通跳转（写入历史） */
export function navigate(path, query) {
  const target = buildHash(path, query);
  if (window.location.hash === target) { emit('same'); return; }
  window.location.hash = target;
}

/** 替换当前历史项（搜索实时过滤 / Tab 切换用，不污染后退栈） */
export function replaceRoute(path, query) {
  const target = buildHash(path, query);
  if (window.location.hash === target) return;
  try {
    history.replaceState(null, '', target);
  } catch {
    window.location.hash = target;
    return;
  }
  emit('replace');
}

export function currentRoute() { return parseHash(); }

/** 尊重 prefers-reduced-motion 的滚动（JS smooth 降级） */
export function scrollToY(y = 0, { behavior = 'auto' } = {}) {
  let reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
  const opts = { top: y, left: 0, behavior: reduce ? 'auto' : behavior };
  try { window.scrollTo(opts); } catch { window.scrollTo(0, y); }
}

/** 元素滚动到可见（尊重 reduced-motion） */
export function scrollIntoViewRespectingMotion(node, { block = 'start' } = {}) {
  if (!node) return;
  let reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
  try { node.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block }); } catch { /* ignore */ }
}
