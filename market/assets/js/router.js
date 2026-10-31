/**
 * hash 路由（纯前端，无依赖）。
 * 支持：#/、#/resource/<id>、#/category/<id>、#/creator/<handle>、#/search?q=、
 *       #/points、#/settings、#/settings/<section>、#/import、#/404，未知路由 → notFound。
 * 刷新 / 直达 / 前进后退均由 hashchange 驱动。
 */

export const ROUTES = Object.freeze(['home', 'resource', 'category', 'creator', 'search', 'points', 'settings', 'import', 'notFound']);

function safeDecode(value) {
  try { return decodeURIComponent(String(value ?? '')); } catch { return String(value ?? ''); }
}

/** 解析 hash → { name, params, query, raw } */
export function parseHash(hash = window.location.hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const query = new URLSearchParams(queryPart);
  const path = pathPart.replace(/^\/+/, '');
  const segments = path.split('/').filter((s) => s.length > 0).map(safeDecode);

  if (segments.length === 0) return { name: 'home', params: {}, query, raw };
  const head = segments[0];
  switch (head) {
    case 'resource':
      return segments[1]
        ? { name: 'resource', params: { id: segments[1] }, query, raw }
        : { name: 'notFound', params: {}, query, raw };
    case 'category':
      return segments[1]
        ? { name: 'category', params: { id: segments[1] }, query, raw }
        : { name: 'notFound', params: {}, query, raw };
    case 'creator':
      return segments[1]
        ? { name: 'creator', params: { handle: segments[1].replace(/^@/, '') }, query, raw }
        : { name: 'notFound', params: {}, query, raw };
    case 'search':
      return { name: 'search', params: {}, query, raw };
    case 'points':
      return { name: 'points', params: {}, query, raw };
    case 'settings':
      return { name: 'settings', params: { section: segments[1] || '' }, query, raw };
    case 'import':
      return { name: 'import', params: {}, query, raw };
    case '404':
      return { name: 'notFound', params: {}, query, raw };
    default:
      return { name: 'notFound', params: { path }, query, raw };
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
    try { history.replaceState(null, '', buildHash('')); } catch { window.location.hash = '#/'; }
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

/** 替换当前历史项（搜索框实时过滤、Tabs 切换用，不污染后退栈） */
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
