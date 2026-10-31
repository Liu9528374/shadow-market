/** 深浅色主题：三态（light / dark / system），localStorage 持久化，跟随系统变化。 */

export const THEME_KEY = 'shadow.market.theme.v1';
export const THEME_PREFS = ['light', 'dark', 'system'];

let mediaQuery = null;

export function getThemePref() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch { /* 隐私模式 */ }
  return 'system';
}

export function resolveTheme(pref = getThemePref()) {
  if (pref === 'dark') return 'dark';
  if (pref === 'light') return 'light';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(pref = getThemePref(), { persist = false } = {}) {
  const normalized = THEME_PREFS.includes(pref) ? pref : 'system';
  if (persist) {
    try { localStorage.setItem(THEME_KEY, normalized); } catch { /* ignore */ }
  }
  const theme = resolveTheme(normalized);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePref = normalized;
  // theme-color 与品牌一致：浅色用品牌橙，深色用品牌深色底（APP 图标 #0C0C0E）
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0C0C0E' : '#E88A2E');
  window.dispatchEvent(new CustomEvent('market:themechange', { detail: { pref: normalized, theme } }));
  return theme;
}

export function toggleTheme() {
  const next = resolveTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next, { persist: true });
  return next;
}

/** 监听系统主题变化（仅 system 模式生效） */
export function watchSystemTheme() {
  if (!window.matchMedia) return;
  if (mediaQuery) return;
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (getThemePref() === 'system') applyTheme('system');
  };
  if (typeof mediaQuery.addEventListener === 'function') mediaQuery.addEventListener('change', onChange);
  else if (typeof mediaQuery.addListener === 'function') mediaQuery.addListener(onChange);
}
