/** 本地偏好（无后端；P1 演示用，正式版可同步账户设置） */

export const PREFS_KEY = 'shadow.market.prefs.v1';

export const DEFAULT_PREFS = Object.freeze({
  dailyReminder: true,   // 首页提示今日未签到（本地提示，不是系统通知）
  importRewardHint: true, // 导入成功后提示可记录 +20 积分
});

let cache = null;

export function getPrefs() {
  if (cache) return cache;
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null'); } catch { stored = null; }
  cache = { ...DEFAULT_PREFS, ...(stored && typeof stored === 'object' ? stored : {}) };
  return cache;
}

export function getPref(key) {
  const prefs = getPrefs();
  return key in DEFAULT_PREFS ? prefs[key] : undefined;
}

export function setPref(key, value) {
  if (!(key in DEFAULT_PREFS)) return false;
  const prefs = { ...getPrefs(), [key]: value };
  cache = prefs;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('market:prefschange', { detail: { key, value, prefs } }));
  return true;
}

export function resetPrefs() {
  cache = { ...DEFAULT_PREFS };
  try { localStorage.removeItem(PREFS_KEY); } catch { /* ignore */ }
}
