/**
 * 一键导入（docs/52 §4）
 *
 * 1) 探测本机 SHADOW Studio 本地服务：
 *    - 默认扫描 http://127.0.0.1:18765..18775/api/health（no-cors，单次 300ms 超时）；
 *    - 可选覆盖：URL query `?appPort=<port>`（页面 query 或 hash 路由内 query 均可），
 *      给了就只探测该端口，方便用户自定义端口 / 团队联调而不碰用户进程。
 * 2) 探测到 → 打开 http://127.0.0.1:<port>/?import=<包绝对URL>（工具侧导入后提示 BYOM 选媒体）。
 * 3) 探测不到 → 降级为下载 .shadowcourse + 3 步说明（不报错）。
 *
 * 注意：页面若部署在 https，浏览器会拦截对 http://127.0.0.1 的探测/跳转（混合内容），
 *       此时同样走降级下载（README 有说明）。市场不上传任何数据。
 */

import { absUrl } from './dom.js';

export const LOCAL_APP_DEFAULT_RANGE = Object.freeze({ start: 18765, end: 18775 });
export const PROBE_TIMEOUT_MS = 300;
export const APP_PORT_QUERY_KEY = 'appPort';

/** 解析 ?appPort= 覆盖（页面 query 或 hash 内 query）；非法值返回 null */
export function getAppPortOverride(hash = window.location.hash) {
  const candidates = [];
  try {
    const pageQuery = new URLSearchParams(window.location.search || '');
    candidates.push(pageQuery.get(APP_PORT_QUERY_KEY));
  } catch { /* ignore */ }
  try {
    const hashRaw = String(hash || '').replace(/^#/, '');
    const qIndex = hashRaw.indexOf('?');
    if (qIndex >= 0) {
      const hashQuery = new URLSearchParams(hashRaw.slice(qIndex + 1));
      candidates.push(hashQuery.get(APP_PORT_QUERY_KEY));
    }
  } catch { /* ignore */ }
  for (const raw of candidates) {
    if (raw === null || raw === undefined || raw === '') continue;
    const port = Number(raw);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
  }
  return null;
}

/** 本次探测要尝试的端口列表（升序） */
export function probePorts(hash = window.location.hash) {
  const override = getAppPortOverride(hash);
  if (override) return { ports: [override], override };
  const ports = [];
  for (let p = LOCAL_APP_DEFAULT_RANGE.start; p <= LOCAL_APP_DEFAULT_RANGE.end; p += 1) ports.push(p);
  return { ports, override: null };
}

function probePort(port, timeoutMs) {
  return new Promise((resolve) => {
    const controller = new AbortController();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { controller.abort(); } catch { /* ignore */ }
      resolve({ port, ok });
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      fetch(`http://127.0.0.1:${port}/api/health`, {
        mode: 'no-cors',
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      }).then(() => finish(true), () => finish(false));
    } catch {
      finish(false);
    }
  });
}

/**
 * 探测本地 SHADOW Studio。
 * @returns {Promise<{port:number|null, override:number|null, tried:number[], mixedContent:boolean}>}
 */
export async function probeLocalStudio({ hash = window.location.hash, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const { ports, override } = probePorts(hash);
  const results = await Promise.all(ports.map((p) => probePort(p, timeoutMs)));
  const hits = results.filter((r) => r.ok).map((r) => r.port).sort((a, b) => a - b);
  return {
    port: hits.length ? hits[0] : null,
    override,
    tried: ports,
    mixedContent: window.location.protocol === 'https:',
  };
}

/** 构造工具侧深链：http://127.0.0.1:<port>/?import=<包绝对 URL> */
export function buildDeepLink(port, packageUrl) {
  const absolute = absUrl(packageUrl);
  if (!absolute) return null;
  return `http://127.0.0.1:${port}/?import=${encodeURIComponent(absolute)}`;
}

/**
 * 执行一键导入（探测 → 深链打开 / 降级下载）。
 * 注意：调用方应在用户点击时同步预留窗口（window.open），避免异步探测后被弹窗拦截。
 * @param {object} resource
 * @param {Window|null} reservedWindow 同步打开的空白窗口
 */
export async function importToStudio(resource, reservedWindow = null) {
  const packageUrl = resource?.packageUrl;
  if (!packageUrl) {
    if (reservedWindow) { try { reservedWindow.close(); } catch { /* ignore */ } }
    return { mode: 'error', reason: 'E_NO_PACKAGE', message: '该资源没有可导入的包文件（packageUrl 缺失）' };
  }
  const probe = await probeLocalStudio();
  if (probe.port) {
    const deepLink = buildDeepLink(probe.port, packageUrl);
    let opened = false;
    if (reservedWindow && !reservedWindow.closed) {
      try { reservedWindow.location.href = deepLink; opened = true; } catch { opened = false; }
    }
    if (!opened) {
      try {
        const win = window.open(deepLink, '_blank', 'noopener');
        opened = Boolean(win);
      } catch { opened = false; }
    }
    if (!opened) {
      // 弹窗被拦截：退化为下载 + 给出可手动点击的深链
      return { mode: 'download-fallback', reason: 'E_POPUP', port: probe.port, deepLink, probe, packageUrl };
    }
    return { mode: 'desktop', port: probe.port, deepLink, probe, packageUrl };
  }
  if (reservedWindow) { try { reservedWindow.close(); } catch { /* ignore */ } }
  return {
    mode: 'download-fallback',
    reason: probe.override ? 'E_OVERRIDE_NOT_FOUND' : 'E_NO_LOCAL_APP',
    probe,
    packageUrl,
  };
}

/** 自动降级下载（同源静态文件；a[download] 保存 .shadowcourse） */
export function downloadPackage(resource) {
  const url = absUrl(resource?.packageUrl || '');
  if (!url) return { ok: false, reason: 'E_NO_PACKAGE' };
  const a = document.createElement('a');
  a.href = url;
  a.download = resource?.packageUrl?.split('/').pop() || `${resource?.id || 'course'}.shadowcourse`;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  return { ok: true, url, filename: a.download };
}
