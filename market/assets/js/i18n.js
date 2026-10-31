/**
 * i18n · 中英双语（P0 框架级）
 *
 * 设计：以「中文原文」作为词典 key（zh-CN 是源语言，原文即文案），en 词典给出英文译文。
 * - t('探索') → 中文返回 '探索'，英文返回 'Explore'；
 * - t('共 {n} 个资源', { n: 5 }) → 支持 {name} 占位符插值；
 * - 语言持久化 key：shadow.market.lang.v1（本机 localStorage，无账号、无上传）；
 * - 切换语言：html lang 同步 + 所有 [data-i18n] 静态节点重绘 + dispatch market:langchange（视图重渲染，不刷新页面）；
 * - 缺词回退中文（永不出现 undefined / key 泄漏）。
 *
 * 范围（P0）：导航 / 按钮 / 空态 / 导入说明 / 静态合规页 / 详情页外壳；
 * 资源内容（标题 / 句子 / 翻译）按数据字段渲染，不翻译用户内容。
 */

export const LANGS = Object.freeze([
  { id: 'zh-CN', label: '中文', short: '中', htmlLang: 'zh-CN' },
  { id: 'en', label: 'English', short: 'EN', htmlLang: 'en' },
]);

export const LANG_KEY = 'shadow.market.lang.v1';

/** 英文词典（懒加载）：中文界面默认不加载 i18n-en.js（~80KB 源码） */
let enDict = null;

/** 按需加载英文词典（幂等）。lang=en 时必须在首屏渲染前 await */
export async function loadEnDictionary() {
  if (enDict) return enDict;
  try {
    const mod = await import('./i18n-en.js');
    enDict = mod.EN || {};
  } catch (err) {
    console.warn('[market:i18n] 英文词典加载失败，回退中文：', err?.message || err);
    enDict = {};
  }
  return enDict;
}

let currentLang = 'zh-CN';
const listeners = new Set();

function normalizeLang(value) {
  return value === 'en' ? 'en' : 'zh-CN';
}

export function getLang() {
  return currentLang;
}

export function isEnglish() {
  return currentLang === 'en';
}

/** 初始化语言（启动时调用一次）：读取 localStorage → 同步 html lang */
export function initLang() {
  let stored = null;
  try { stored = localStorage.getItem(LANG_KEY); } catch { /* 隐私模式 */ }
  currentLang = normalizeLang(stored);
  const lang = LANGS.find((l) => l.id === currentLang) || LANGS[0];
  if (document.documentElement) {
    document.documentElement.lang = lang.htmlLang;
    document.documentElement.dataset.lang = currentLang;
  }
  return currentLang;
}

/** 启动初始化：语言 + （英文时）词典加载 + 静态文案 */
export async function initI18n() {
  initLang();
  if (currentLang === 'en') await loadEnDictionary();
  applyStaticI18n();
  return currentLang;
}

/** 设置语言：持久化 + html lang + 静态文案 + 通知视图重渲染（不刷新页面） */
export async function setLang(next, { persist = true } = {}) {
  currentLang = normalizeLang(next);
  const lang = LANGS.find((l) => l.id === currentLang) || LANGS[0];
  if (persist) {
    try { localStorage.setItem(LANG_KEY, currentLang); } catch { /* ignore */ }
  }
  if (currentLang === 'en') await loadEnDictionary();
  if (document.documentElement) {
    document.documentElement.lang = lang.htmlLang;
    document.documentElement.dataset.lang = currentLang;
  }
  applyStaticI18n();
  for (const fn of listeners) {
    try { fn(currentLang); } catch (err) { console.error('[market] i18n listener failed', err); }
  }
  window.dispatchEvent(new CustomEvent('market:langchange', { detail: { lang: currentLang } }));
  return currentLang;
}

export async function toggleLang() {
  return setLang(currentLang === 'en' ? 'zh-CN' : 'en');
}

export function onLangChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/**
 * 翻译。key 为中文源文案；缺省回退中文。
 * @param {string} key 中文原文（含 {name} 占位符）
 * @param {object} vars 插值变量
 */
export function t(key, vars) {
  const source = String(key ?? '');
  let text = source;
  if (currentLang === 'en') text = enDict && Object.prototype.hasOwnProperty.call(enDict, source) ? enDict[source] : source;
  if (vars && typeof vars === 'object') {
    text = text.replace(/\{(\w+)\}/g, (m, name) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m));
  }
  return text;
}

/** 按语言取数据字段（例如 label / labelEn） */
export function pickLang(zh, en) {
  if (currentLang === 'en' && en) return String(en);
  return String(zh ?? '');
}

/**
 * 应用静态 HTML 中的 i18n 标记：
 *   data-i18n="中文原文"                    → textContent
 *   data-i18n-placeholder="..."            → placeholder 属性
 *   data-i18n-aria-label="..."             → aria-label 属性
 *   data-i18n-title="..."                  → title 属性
 */
export function applyStaticI18n(root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  for (const node of root.querySelectorAll('[data-i18n]')) {
    const key = node.getAttribute('data-i18n');
    if (!key) continue;
    const value = t(key);
    // 值未变化时不触碰 DOM：避免无意义的重绘（首页静态 LCP 节点保持首屏时间）
    if (node.textContent !== value) node.textContent = value;
  }
  const attrs = [
    ['[data-i18n-placeholder]', 'data-i18n-placeholder', 'placeholder'],
    ['[data-i18n-aria-label]', 'data-i18n-aria-label', 'aria-label'],
    ['[data-i18n-title]', 'data-i18n-title', 'title'],
  ];
  for (const [selector, dataAttr, attr] of attrs) {
    for (const node of root.querySelectorAll(selector)) {
      const key = node.getAttribute(dataAttr);
      if (!key) continue;
      const value = t(key);
      if (node.getAttribute(attr) !== value) node.setAttribute(attr, value);
    }
  }
}

/** 语言切换按钮的可见文案：当前语言显示「另一个语言」 */
export function langButtonLabel() {
  return currentLang === 'en' ? '中文' : 'EN';
}

/* --------------------------------------------------------------------------
   P0 扩展词条（导航 / 按钮 / 空态 / 导入说明 / 静态合规页 / 详情页外壳）。
   以中文原文为 key；英文缺词时回退中文。新增文案时在同一区块补充即可。
   -------------------------------------------------------------------------- */
