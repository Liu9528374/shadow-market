/**
 * 一键导入 + 下载导入产物（docs/52 §4 · docs/111 §5.4）
 *
 * 1) 一键导入：
 *    - 探测本机 SHADOW Studio 本地服务：默认扫描 http://127.0.0.1:18765..18775/api/health
 *      （no-cors，单次 300ms 超时）；可选 `?appPort=<port>`（页面 query 或 hash 内 query）覆盖。
 *    - 探测到 → 打开 http://127.0.0.1:<port>/?import=<包绝对URL>（工具侧 BYOM 选媒体）。
 *    - 探测不到 → 降级为下载 .shadowcourse + 3 步说明（不报错）。
 *
 *    M3.8 修复（产品 bug）：旧实现用 `window.open(deepLink,'_blank','noopener')` 并检查返回值，
 *    但 Chromium 在带 noopener/新标签页打开成功时仍返回 null → 被误判为「弹窗拦截」，
 *    导致「已成功打开却提示拦截 + 又触发一次下载」。现改为：
 *      ① 优先复用用户点击时同步预留的窗口（最可靠，绝不被拦截）；
 *      ② 回退到 `window.open(deepLink,'_blank')`（不带 noopener），成功后立即 `win.opener = null`
 *         守住安全性；只有真正返回 null（被拦截）才降级下载；
 *      ③ 记录 openedVia = 'reserved' | 'new-tab' | 'blocked'，成功路径不再降级、不再多余下载。
 *
 * 2) 下载导入产物（版本详情页弹层）：.shadow.json（推荐）/ .srt（备选）/ .shadowcourse（规范）。
 *
 * 注意：页面若部署在 https，浏览器会拦截对 http://127.0.0.1 的探测/跳转（混合内容），
 *       此时同样走降级下载（README 有说明）。市场不上传任何数据、不缓存用户媒体。
 */

import { absUrl, baseName } from './dom.js';

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
 * 打开深链（M3.8 修复后逻辑）。
 * @returns {{via: 'reserved'|'new-tab'|null, win: Window|null}}
 */
export function openDeepLink(deepLink, reservedWindow = null) {
  // ① 复用同步预留的空白窗口：用户手势内创建，最可靠
  if (reservedWindow && !reservedWindow.closed) {
    try {
      reservedWindow.location.replace(deepLink);
      return { via: 'reserved', win: reservedWindow };
    } catch {
      try {
        reservedWindow.location.href = deepLink;
        return { via: 'reserved', win: reservedWindow };
      } catch { /* 继续回退 */ }
    }
  }
  // ② 不带 noopener 打开（否则 Chromium 返回 null 被误判拦截）；打开后立即断开 opener
  let win = null;
  try { win = window.open(deepLink, '_blank'); } catch { win = null; }
  if (win) {
    try { win.opener = null; } catch { /* 跨域后不可写，忽略 */ }
    return { via: 'new-tab', win };
  }
  // ③ 真正被拦截
  return { via: null, win: null };
}

/**
 * 执行一键导入（探测 → 深链打开 / 降级下载）。
 * 调用方应在用户点击时同步预留窗口（window.open('', '_blank')），避免异步探测后被弹窗拦截。
 * @param {object} resource
 * @param {Window|null} reservedWindow 同步打开的空白窗口
 * @returns {Promise<{mode:'desktop'|'download-fallback'|'error', openedVia?:'reserved'|'new-tab', ...}>}
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
    const opened = openDeepLink(deepLink, reservedWindow);
    if (opened.via) {
      return { mode: 'desktop', port: probe.port, deepLink, probe, packageUrl, openedVia: opened.via };
    }
    // 弹窗被真正拦截：退化为下载 + 给出可手动点击的深链
    return { mode: 'download-fallback', reason: 'E_POPUP', port: probe.port, deepLink, probe, packageUrl, openedVia: 'blocked' };
  }
  if (reservedWindow) { try { reservedWindow.close(); } catch { /* ignore */ } }
  return {
    mode: 'download-fallback',
    reason: probe.override ? 'E_OVERRIDE_NOT_FOUND' : 'E_NO_LOCAL_APP',
    probe,
    packageUrl,
    openedVia: null,
  };
}

/* ---------------- 导入产物 / 下载 ---------------- */

export const IMPORT_FILE_KINDS = Object.freeze(['shadowJson', 'srt', 'shadowcourse', 'readme', 'declaration']);

/**
 * 推导资源可下载的文件条目。
 * - course / subtitle（.shadowcourse 载体）：推荐 .shadow.json → 备选 .srt → 规范 .shadowcourse → README；
 * - plugin（声明式 JSON 载体）：README（白名单说明）+ 声明式 JSON，不提供 .shadow.json/.srt（数据层为 null）；
 * - 兼容过渡：目录未生成 importFiles 时按构建约定推导 data/import/<id>.shadow.json / .srt（仅课程包载体）。
 * 数据源：versions[0].importFiles + versions[0].packageUrl。
 * @returns {Array<{kind:string,url:string,filename:string,derived:boolean}>}
 */
export function importFileEntries(resource) {
  if (!resource) return [];
  const version = Array.isArray(resource.versions) && resource.versions.length ? resource.versions[0] : {};
  const importFiles = version.importFiles || resource.importFiles || {};
  const packageUrl = String(resource.packageUrl || version.packageUrl || '');
  const id = String(resource.id || 'resource');
  const isCourse = /\.shadowcourse$/i.test(packageUrl);
  const declarative = resource.type === 'plugin' || (Boolean(packageUrl) && !isCourse);
  const readme = String(importFiles.readme || '');

  if (declarative) {
    const out = [];
    if (readme) out.push({ kind: 'readme', url: readme, filename: baseName(readme) || `${id}-README.txt`, derived: false });
    if (packageUrl) out.push({ kind: 'declaration', url: packageUrl, filename: baseName(packageUrl) || `${id}.json`, derived: false });
    return out;
  }

  const shadowJson = String(importFiles.shadowJson || (isCourse ? `data/import/${id}.shadow.json` : ''));
  const srt = String(importFiles.srt || (isCourse ? `data/import/${id}.srt` : ''));
  const out = [];
  if (shadowJson) out.push({ kind: 'shadowJson', url: shadowJson, filename: baseName(shadowJson) || `${id}.shadow.json`, derived: !importFiles.shadowJson });
  if (srt) out.push({ kind: 'srt', url: srt, filename: baseName(srt) || `${id}.srt`, derived: !importFiles.srt });
  if (packageUrl) out.push({ kind: 'shadowcourse', url: packageUrl, filename: baseName(packageUrl) || `${id}.shadowcourse`, derived: false });
  if (readme) out.push({ kind: 'readme', url: readme, filename: baseName(readme) || `${id}-README.txt`, derived: false });
  return out;
}

/** 触发浏览器下载（同源静态文件；a[download] 保存） */
export function triggerDownload(url, filename) {
  const target = absUrl(url);
  if (!target) return { ok: false, reason: 'E_BAD_URL' };
  const a = document.createElement('a');
  a.href = target;
  a.download = filename || baseName(url) || 'download';
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  return { ok: true, url: target, filename: a.download };
}

/** 下载指定导入产物；kind = shadowJson | srt | shadowcourse */
export function downloadImportFile(resource, kind = 'shadowJson') {
  const entry = importFileEntries(resource).find((x) => x.kind === kind);
  if (!entry) return { ok: false, reason: 'E_NO_FILE' };
  return triggerDownload(entry.url, entry.filename);
}

/** 自动降级下载（同源静态文件；a[download] 保存 .shadowcourse） */
export function downloadPackage(resource) {
  const url = resource?.packageUrl;
  if (!url) return { ok: false, reason: 'E_NO_PACKAGE' };
  const result = triggerDownload(url, baseName(url) || `${resource?.id || 'course'}.shadowcourse`);
  return result.ok ? { ok: true, url: result.url, filename: result.filename } : { ok: false, reason: result.reason };
}
