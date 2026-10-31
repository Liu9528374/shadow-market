/**
 * PWA 注册 / 更新提示 / 安装提示（手写，无第三方依赖）
 *
 * - 注册 sw.js（站点根作用域）；
 * - 检测到新版本（waiting 或 updatefound → installed）→ 回调 onUpdate，由 app.js 显示「新版本可用」提示；
 * - applyUpdate()：向 waiting worker 发送 {type:'SKIP_WAITING'}，controllerchange 后只刷新一次；
 * - beforeinstallprompt 捕获 → 暴露 install 事件给「安装到主屏幕」按钮；
 * - iOS / 不支持的环境静默降级，不影响浏览。
 */

export const SW_URL = 'sw.js';
export const SW_SCOPE = './';

let registration = null;
let refreshing = false;
let updateHandler = null;
let installEvent = null;
const installListeners = new Set();
// 页面加载时是否已处于 SW 控制之下（老访客=true；首次访问=false）。
// 首次访问时 sw.js activate 里的 clients.claim() 也会触发 controllerchange，
// 但页面本身就是最新版，不应自动刷新（否则首访会莫名整页闪一下）。
const hadControllerAtStart = !!(typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller);
// 只有用户主动点「更新」或"已受控页面收到新版本"时才允许 controllerchange 刷新。
let reloadOnControllerChange = false;

function notifyUpdate(payload) {
  if (typeof updateHandler === 'function') {
    try { updateHandler(payload); } catch (err) { console.warn('[market:pwa] 更新回调异常', err); }
  }
}

/** 注册 Service Worker；返回 registration（不支持时返回 null） */
export async function registerPWA({ onUpdate = null, onInstalledState = null } = {}) {
  if (onUpdate) updateHandler = onUpdate;
  if (!('serviceWorker' in navigator)) {
    if (typeof onInstalledState === 'function') onInstalledState({ supported: false });
    return null;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    // 首次访问：clients.claim() 触发 controllerchange，但当前页面已是最新，忽略。
    if (!hadControllerAtStart && !reloadOnControllerChange) return;
    refreshing = true;
    window.location.reload();
  });

  try {
    registration = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
  } catch (err) {
    console.warn('[market:pwa] Service Worker 注册失败（离线能力不可用，不影响在线浏览）：', err?.message || err);
    if (typeof onInstalledState === 'function') onInstalledState({ supported: true, registered: false, error: String(err?.message || err) });
    return null;
  }

  if (typeof onInstalledState === 'function') onInstalledState({ supported: true, registered: true });

  // 已有等待中的新版本（例如上次打开时下载完成）
  if (registration.waiting && navigator.serviceWorker.controller) {
    notifyUpdate({ source: 'waiting', registration });
  }

  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        notifyUpdate({ source: 'updatefound', registration });
      }
    });
  });

  // 页面重新可见时主动检查一次更新（低频、无网络请求泛滥）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && registration) {
      registration.update().catch(() => { /* 离线时忽略 */ });
    }
  });

  return registration;
}

/** 应用更新：通知 waiting worker 跳过等待，controllerchange 后自动刷新 */
export function applyUpdate() {
  const waiting = registration?.waiting;
  if (!waiting) {
    reloadOnControllerChange = true;
    window.location.reload();
    return false;
  }
  try {
    reloadOnControllerChange = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
    return true;
  } catch {
    reloadOnControllerChange = true;
    window.location.reload();
    return false;
  }
}

/** 手动检查更新（设置页/命令面板可用）→ Promise<boolean> 是否发现新版本 */
export async function checkForUpdate() {
  if (!registration) return false;
  try {
    await registration.update();
    return Boolean(registration.waiting || registration.installing);
  } catch {
    return false;
  }
}

/* ---------------- 安装提示 ---------------- */

export function watchInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installEvent = event;
    for (const fn of installListeners) { try { fn({ available: true }); } catch { /* ignore */ } }
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    for (const fn of installListeners) { try { fn({ available: false, installed: true }); } catch { /* ignore */ } }
  });
}

export function onInstallAvailability(fn) {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}

export function canInstall() { return Boolean(installEvent); }

/** 触发安装提示；返回 'accepted' | 'dismissed' | 'unavailable' */
export async function promptInstall() {
  if (!installEvent) return 'unavailable';
  try {
    installEvent.prompt();
    const choice = await installEvent.userChoice;
    installEvent = null;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    installEvent = null;
    return 'unavailable';
  }
}

/** 是否 iOS Safari（用于「添加到主屏幕」文字说明） */
export function isIosSafari() {
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return iOS && !/CriOS|FxiOS|EdgiOS/.test(ua);
}
