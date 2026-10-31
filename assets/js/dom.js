/** DOM / 格式化小工具（无依赖） */

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

/**
 * 创建元素。
 * attrs 约定：class/text（textContent）/html（仅限代码内可信静态标记）/dataset/style 对象/
 * on* 事件函数/其余一律 setAttribute；值为 true 时写空属性，null/undefined/false 跳过。
 */
export function el(tag, attrs = null, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class' || k === 'className') { node.className = v; continue; }
      if (k === 'text') { node.textContent = v; continue; }
      if (k === 'html') { node.innerHTML = v; continue; }
      if (k === 'dataset') { Object.assign(node.dataset, v); continue; }
      if (k === 'style' && typeof v === 'object') { Object.assign(node.style, v); continue; }
      if (k === 'ref' && typeof v === 'function') { v(node); continue; }
      if (k.startsWith('on') && typeof v === 'function') { node.addEventListener(k.slice(2).toLowerCase(), v); continue; }
      if (v === true) { node.setAttribute(k, ''); continue; }
      node.setAttribute(k, String(v));
    }
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) { append(node, child); continue; }
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
export function mount(node, ...children) { clear(node); append(node, children); return node; }

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function debounce(fn, ms = 160) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
  wrapped.cancel = () => { clearTimeout(timer); timer = null; };
  return wrapped;
}

const MINUS = '−';

export function fmtNum(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('zh-CN');
}

/** 秒 → m:ss / h:mm:ss */
export function fmtDuration(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return '—';
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function fmtBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 本地化日期：2026-10-25 */
export function fmtDate(value) {
  const d = parseDate(value);
  if (!d) return '—';
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 相对时间：刚刚 / 12 分钟前 / 3 天前 / 2026-10-25（超过 30 天回退日期） */
export function fmtRelative(value) {
  const d = parseDate(value);
  if (!d) return '—';
  const diff = Date.now() - d.getTime();
  if (diff < 0) return fmtDate(value);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days <= 30) return `${days} 天前`;
  return fmtDate(value);
}

/** 本地日历日 key：2026-10-25（签到去重用） */
export function dayKey(date = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function initials(name, max = 2) {
  const s = String(name || '?').trim();
  if (!s) return '?';
  const chars = Array.from(s.replace(/\s+/g, ''));
  return chars.slice(0, max).join('').toUpperCase();
}

export function signed(n) {
  const num = Number(n) || 0;
  return num > 0 ? `+${num}` : num < 0 ? `${MINUS}${Math.abs(num)}` : '0';
}

export async function copyText(text) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* 回退下面 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

/** 把 URL 相对路径解析成绝对 URL；失败返回 null */
export function absUrl(url) {
  try { return new URL(String(url), window.location.href).href; } catch { return null; }
}

/** 安全外链属性：非 http(s) 返回 null */
export function safeExternalUrl(url) {
  try {
    const u = new URL(String(url));
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch { return null; }
}

/** 从 npm 风格/文件路径里取文件名 */
export function baseName(p) {
  const s = String(p || '');
  return s.split(/[\\/]/).filter(Boolean).pop() || s;
}

/** 简易 query string 解析（hash 路由用） */
export function parseQuery(qs) {
  const out = new URLSearchParams();
  const s = String(qs || '').replace(/^\?/, '');
  if (!s) return out;
  try {
    return new URLSearchParams(s);
  } catch {
    return out;
  }
}

export function elFromHtml(html) {
  const t = document.createElement('template');
  t.innerHTML = String(html).trim();
  return t.content.firstElementChild;
}
