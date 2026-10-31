/** 共享 UI 组件：Toast / Modal / 资源卡 / 徽标 / 骨架屏 / 空状态 / 错误态 / 头像 / Tabs / 静态页文字 */

import { el, frag, fmtNum, fmtRelative, fmtDuration, initials, copyText } from './dom.js';
import { icon, hasIcon } from './icons.js';
import { pluginFor, getState } from './data.js';
import { MarketPoints } from './points.js';
import { t, pickLang } from './i18n.js';

/* ---------------- Toast ---------------- */

const TOAST_ICONS = { default: 'info', success: 'check-circle', error: 'x', warn: 'alert' };

export function toast(message, { kind = 'default', timeout = 3600, iconName = null } = {}) {
  const region = document.getElementById('toast-region');
  if (!region) return null;
  const node = el('div', { class: 'toast', dataset: { kind }, role: kind === 'error' ? 'alert' : 'status' },
    icon(iconName || TOAST_ICONS[kind] || 'info', 15, 'toast-icon'),
    el('div', { class: 'toast-text' }, String(message)),
    el('button', {
      class: 'toast-close', type: 'button', 'aria-label': t('关闭提示'),
      onclick: () => remove(),
    }, '×'),
  );
  let timer = null;
  const remove = () => {
    clearTimeout(timer);
    node.remove();
  };
  region.append(node);
  if (timeout > 0) timer = setTimeout(remove, timeout);
  while (region.children.length > 4) region.firstElementChild.remove();
  return { node, close: remove };
}

/* ---------------- Modal ---------------- */

let openModalCount = 0;

export function openModal({ title = '', body = null, actions = [], onClose = null, labelledBy = null, width, extraClass = '' } = {}) {
  const root = document.getElementById('modal-root');
  if (!root) return null;
  const previousFocus = document.activeElement;
  const titleId = `modal-title-${Date.now().toString(36)}-${openModalCount}`;
  const backdrop = el('div', { class: 'modal-backdrop' });
  const modal = el('div', {
    class: `modal${extraClass ? ` ${extraClass}` : ''}`, role: 'dialog', 'aria-modal': 'true',
    'aria-label': labelledBy ? undefined : (title || t('对话框')),
    'aria-labelledby': labelledBy ? undefined : titleId,
  });
  if (width) modal.style.width = `min(${width}, 100%)`;

  const close = () => {
    backdrop.remove();
    openModalCount = Math.max(0, openModalCount - 1);
    document.removeEventListener('keydown', onKeydown, true);
    if (previousFocus && typeof previousFocus.focus === 'function') {
      try { previousFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
    if (typeof onClose === 'function') onClose();
  };

  const head = el('div', { class: 'modal-head' },
    el('div', { class: 'modal-title', id: titleId }, title || t('提示')),
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('关闭对话框'), onclick: close }, icon('x', 15)),
  );
  const bodyNode = el('div', { class: 'modal-body' });
  if (body instanceof Node) bodyNode.append(body);
  else if (typeof body === 'string') bodyNode.append(el('p', { text: body }));
  else if (Array.isArray(body)) bodyNode.append(frag(body));
  modal.append(head, bodyNode);

  if (actions.length) {
    const foot = el('div', { class: 'modal-foot' });
    for (const action of actions) {
      const btn = el('button', {
        class: `btn ${action.kind === 'primary' ? 'btn-primary' : action.kind === 'danger' ? 'btn-danger' : ''}`.trim(),
        type: 'button',
        'data-testid': action.testid || undefined,
        onclick: () => {
          if (action.keepOpen) { action.onClick?.(); return; }
          const result = action.onClick?.();
          if (result === false) return;
          close();
        },
      }, action.icon ? icon(action.icon, 14) : null, action.label);
      foot.append(btn);
    }
    modal.append(foot);
  }

  const onKeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const focusables = Array.from(modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter((n) => !n.disabled && n.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  backdrop.append(modal);
  root.append(backdrop);
  openModalCount += 1;
  document.addEventListener('keydown', onKeydown, true);
  const firstFocusable = modal.querySelector('button, [href], input, select, textarea');
  if (firstFocusable) setTimeout(() => firstFocusable.focus({ preventScroll: true }), 0);
  return { close, element: modal, body: bodyNode };
}

/** 确认对话框 → Promise<boolean> */
export function confirmDialog({ title, message, confirmLabel = t('确认'), cancelLabel = t('取消'), danger = false, details = null }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const body = el('div', {},
      el('p', { text: message }),
      details ? el('div', { class: 'state-detail', text: details }) : null,
    );
    const handle = openModal({
      title,
      body,
      onClose: () => done(false),
      actions: [
        { label: cancelLabel, onClick: () => done(false) },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: () => done(true) },
      ],
    });
    if (!handle) done(false);
  });
}

/* ---------------- 徽标 / 资源卡 ---------------- */

export function avatar(creator, size = 'md') {
  const color = creator?.avatarColor || '#E88A2E';
  const node = el('span', {
    class: `avatar avatar-${size}`,
    style: { background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 55%, #0d1117))` },
    'aria-hidden': 'true',
  }, initials(creator?.name || creator?.handle || '?'));
  return node;
}

export function typeLabel(type) {
  const plugin = pluginFor(type);
  return pickLang(plugin.label, plugin.labelEn);
}

export function freeBadge(resource) {
  if (resource.points > 0) {
    return el('span', { class: 'badge badge-points', title: t('P1 积分兑换演示：本地演示，积分不可购买') },
      icon('diamond', 11), t('{n} 积分', { n: resource.points }));
  }
  return el('span', { class: 'badge badge-free', title: t('P0 全免费资源') }, icon('check', 11), t('Free'));
}

export function fixtureBadge() {
  return el('span', { class: 'badge badge-demo', title: t('演示夹具数据：不是线上真实资源') }, t('演示夹具'));
}

export function unknownTypeBadge() {
  return el('span', { class: 'badge', title: t('该资源类型没有可用的插件清单，已降级为通用卡片') }, icon('alert', 11), t('类型未注册'));
}

export function coverIcon(resource, { size = 'md' } = {}) {
  const plugin = pluginFor(resource?.type);
  const color1 = resource?.cover?.color1 || '#3A2410';
  const color2 = resource?.cover?.color2 || '#E88A2E';
  return el('span', {
    class: size === 'lg' ? 'repo-icon' : 'res-icon',
    style: { background: `linear-gradient(135deg, ${color1}, ${color2})` },
    'aria-hidden': 'true',
  }, icon(hasIcon(plugin.icon) ? plugin.icon : 'box', size === 'lg' ? 26 : 22));
}

export function statsMeta(resource, { limit = 3 } = {}) {
  const plugin = pluginFor(resource.type);
  const out = [];
  const stats = resource.stats || {};
  const fields = plugin.statsFields?.length ? plugin.statsFields : ['sentences', 'durationSec', 'words'];
  if (fields.includes('sentences') && stats.sentences) out.push({ iconName: 'message', text: t('{n} 句', { n: fmtNum(stats.sentences) }) });
  if (fields.includes('durationSec') && stats.durationSec) out.push({ iconName: 'clock', text: fmtDuration(stats.durationSec) });
  if (fields.includes('words') && stats.words) out.push({ iconName: 'terminal', text: t('{n} 词', { n: fmtNum(stats.words) }) });
  return out.slice(0, limit);
}

export function metaItem(iconName, text, title = '') {
  return el('span', { class: 'res-meta', title: title || undefined }, icon(iconName, 13), el('span', { text }));
}

/** 标签链接（GitHub Topics 逻辑：指向 #/tag/<tag>） */
export function tagLinks(tags, { limit = 6, className = 'tag tag-plain' } = {}) {
  const wrap = el('div', { class: 'res-tags' });
  for (const tag of (tags || []).slice(0, limit)) {
    wrap.append(el('a', { class: className, href: `#/tag/${encodeURIComponent(tag)}`, title: t('标签：{tag}', { tag }) }, tag));
  }
  return wrap;
}

/** GitHub repo 卡式的资源卡（列表里配合 role=list 使用，卡片本身 role=listitem） */
export function resourceCard(resource) {
  const plugin = pluginFor(resource.type);
  const creator = getState().catalog?.authorMap.get(resource.author);
  const href = `#/resource/${encodeURIComponent(resource.id)}`;
  const showFixture = getState().fixture || resource.fixture;

  const titleRow = el('div', { class: 'res-title-row' },
    el('a', { class: 'res-title', href }, resource.title),
    resource.free !== false ? freeBadge(resource) : null,
    plugin.fallback ? unknownTypeBadge() : el('span', { class: 'badge badge-type', title: `${t('资源类型')}：${plugin.id}` }, pickLang(plugin.label, plugin.labelEn)),
    showFixture ? fixtureBadge() : null,
  );

  const meta = el('div', { class: 'res-meta-row' });
  for (const item of statsMeta(resource)) meta.append(metaItem(item.iconName, item.text));
  meta.append(metaItem('download', t('下载 {n} 次', { n: fmtNum(resource.downloads) }), t('P0 静态站示例统计（无后端，不虚报下载量）')));
  meta.append(metaItem('history', t('更新于 {time}', { time: fmtRelative(resource.updatedAt) }), resource.updatedAt));

  const tags = resource.tags.length ? tagLinks(resource.tags, { limit: 6 }) : null;

  return el('div', {
    class: 'res-card',
    dataset: { resourceId: resource.id, type: resource.type },
    'data-testid': 'resource-card',
    role: 'listitem',
    'aria-label': `${resource.title}（${pickLang(plugin.label, plugin.labelEn)}${resource.free !== false ? ` · ${t('免费')}` : ''}）`,
  },
    el('div', { class: 'res-card-head' },
      coverIcon(resource),
      el('div', { class: 'res-head-text' },
        titleRow,
        el('div', { class: 'res-sub' },
          resource.subtitle ? el('span', { lang: 'en', text: resource.subtitle }) : '',
          creator ? el('span', { class: 'res-byline' }, ' · ', el('a', { href: `#/creator/${encodeURIComponent(creator.handle)}` }, creator.name)) : null,
        ),
      ),
      resource.level ? el('span', { class: 'badge badge-level', title: t('难度等级') }, resource.level) : null,
    ),
    resource.description ? el('p', { class: 'res-desc', text: resource.description }) : null,
    tags,
    meta,
  );
}

/* ---------------- 骨架屏 / 状态 ---------------- */

export function skeletonCards(count = 3) {
  const fragNode = document.createDocumentFragment();
  for (let i = 0; i < count; i += 1) {
    fragNode.append(el('div', { class: 'sk-card', 'aria-hidden': 'true' },
      el('div', { class: 'row' }, el('div', { class: 'sk sk-icon' }),
        el('div', { style: { flex: '1 1 auto' } },
          el('div', { class: 'sk sk-line sk-title' }),
          el('div', { class: 'sk sk-line sk-sub' }))),
      el('div', { class: 'sk sk-line sk-text' }),
      el('div', { class: 'sk sk-line sk-text short' }),
      el('div', { class: 'sk sk-line sk-meta' }),
    ));
  }
  return fragNode;
}

export function emptyState({ iconName = 'search', title, desc = '', actions = [], id = null }) {
  return el('div', { class: 'state-box', id: id || undefined, 'data-testid': 'empty-state', role: 'status' },
    el('div', { class: 'state-icon' }, icon(iconName, 24)),
    el('div', { class: 'state-title', text: title }),
    desc ? el('p', { class: 'state-desc', text: desc }) : null,
    actions.length ? el('div', { class: 'state-actions' }, actions.map((a) => actionButton(a))) : null,
  );
}

export function actionButton(action) {
  if (action.href) {
    return el('a', {
      class: `btn ${action.kind === 'primary' ? 'btn-primary' : ''}`.trim(),
      href: action.href,
      'data-testid': action.testid || undefined,
      target: action.external ? '_blank' : undefined,
      rel: action.external ? 'noopener noreferrer' : undefined,
    },
      action.icon ? icon(action.icon, 14) : null, action.label);
  }
  return el('button', {
    class: `btn ${action.kind === 'primary' ? 'btn-primary' : action.kind === 'danger' ? 'btn-danger' : ''}`.trim(),
    type: 'button',
    onclick: action.onClick,
    disabled: action.disabled ? true : undefined,
    'data-testid': action.testid || undefined,
  }, action.icon ? icon(action.icon, 14) : null, action.label);
}

export function errorState({ title = t('加载失败'), desc = '', detail = '', actions = [], testid = 'error-state' }) {
  return el('div', { class: 'state-box', 'data-testid': testid, role: 'alert' },
    el('div', { class: 'state-icon', style: { background: 'var(--danger-soft)', color: 'var(--danger)' } }, icon('alert', 24)),
    el('div', { class: 'state-title', text: title }),
    desc ? el('p', { class: 'state-desc', text: desc }) : null,
    detail ? el('code', { class: 'state-detail', text: detail }) : null,
    actions.length ? el('div', { class: 'state-actions' }, actions.map((a) => actionButton(a))) : null,
  );
}

export function inlineError({ title, message, retry = null, actions = [] }) {
  const acts = el('div', { class: 'state-inline-actions' });
  if (retry) acts.append(actionButton({ label: t('重试'), icon: 'refresh', onClick: retry, testid: 'retry-btn' }));
  for (const a of actions) acts.append(actionButton(a));
  return el('div', { class: 'state-inline', 'data-testid': 'inline-error', role: 'alert' },
    el('span', { class: 'state-inline-icon' }, icon('alert', 16)),
    el('div', { style: { minWidth: '0', flex: '1 1 auto' } },
      el('div', { class: 'state-inline-title', text: title }),
      message ? el('div', { class: 'state-inline-desc', text: message }) : null,
      acts.children.length ? acts : null,
    ),
  );
}

/* ---------------- 页面结构 ---------- */

export function pageHead({ title, sub = '', actions = [], count = null }) {
  const titleNode = el('h1', { class: 'page-title' }, title, count !== null ? el('span', { class: 'page-title-count', text: count }) : null);
  return el('div', { class: 'page-head' },
    el('div', { class: 'page-head-text' }, titleNode, sub ? el('p', { class: 'page-sub', text: sub }) : null),
    actions.length ? el('div', { class: 'page-head-actions' }, actions.map((a) => actionButton(a))) : null,
  );
}

/** 静态页 / 长文容器 */
export function prose(...children) {
  return el('div', { class: 'prose' }, ...children);
}

export function proseSection(title, ...children) {
  return el('section', { class: 'prose-section' },
    title ? el('h2', { class: 'prose-title', text: title }) : null,
    ...children,
  );
}

export function breadcrumb(items) {
  const node = el('nav', { class: 'breadcrumb', 'aria-label': t('面包屑导航') });
  items.forEach((item, idx) => {
    if (idx > 0) node.append(el('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '/'));
    if (item.href) node.append(el('a', { href: item.href }, item.label));
    else node.append(el('span', { class: 'crumb-current', 'aria-current': 'page' }, item.label));
  });
  return node;
}

export function asideCard(title, ...children) {
  return el('section', { class: 'aside-card' },
    title ? el('h2', { class: 'aside-title', text: title }) : null,
    ...children,
  );
}

export function asideRow(key, value) {
  return el('div', { class: 'aside-row' },
    el('span', { class: 'aside-k', text: key }),
    el('span', { class: 'aside-v' }, value instanceof Node ? value : String(value ?? '—')),
  );
}

export function copyButton(text, label = t('复制'), { testid = null } = {}) {
  return el('button', {
    class: 'btn btn-sm', type: 'button', 'data-testid': testid || undefined,
    onclick: async (e) => {
      const ok = await copyText(text);
      const btn = e.currentTarget;
      btn.textContent = ok ? t('已复制') : t('复制失败');
      setTimeout(() => { btn.textContent = label; }, 1400);
    },
  }, icon('copy', 13), label);
}

/* ---------------- 收藏 ---------------- */

export function favoriteButton(resource, { className = '' } = {}) {
  const favorite = MarketPoints.isFavorite(resource.id);
  const btn = el('button', {
    class: `btn${className ? ` ${className}` : ''}`, type: 'button', 'aria-pressed': favorite ? 'true' : 'false',
    'data-testid': 'favorite-btn',
    'aria-label': favorite ? t('取消收藏') : t('收藏'),
    onclick: () => {
      const result = MarketPoints.toggleFavorite(resource.id);
      const now = result.favorite;
      btn.setAttribute('aria-pressed', now ? 'true' : 'false');
      btn.setAttribute('aria-label', now ? t('取消收藏') : t('收藏'));
      btn.replaceChildren(icon(now ? 'star-fill' : 'star', 14), now ? t('已收藏') : t('收藏'));
      btn.style.color = now ? 'var(--attention)' : '';
      toast(now ? t('已收藏（仅保存在本机浏览器）') : t('已取消收藏'), { kind: 'success' });
      window.dispatchEvent(new CustomEvent('market:favoriteschange', { detail: { id: resource.id, favorite: now } }));
    },
  }, icon(favorite ? 'star-fill' : 'star', 14), favorite ? t('已收藏') : t('收藏'));
  if (favorite) btn.style.color = 'var(--attention)';
  return btn;
}

export function demoBanner(text, { iconName = 'alert' } = {}) {
  return el('div', { class: 'demo-banner', role: 'note' },
    el('span', { class: 'demo-icon' }, icon(iconName, 16)),
    el('div', { html: text }),
  );
}

/* ---------------- Tabs（可访问：方向键 / Home / End / roving tabindex / 常驻 panel） ---------------- */

/**
 * 构建可访问 Tabs。
 * - tablist 方向键循环、Home/End 跳转、roving tabindex；
 * - panel 常驻 DOM（hidden 切换），aria-controls 始终指向存在的 panel（审计 A2/A6 修复）；
 * - 点击 / 键盘切换时回调 onSelect(key)，不刷新页面。
 * @returns {{tablist:HTMLElement, panelHost:HTMLElement, setActive:(key:string)=>void, buttons:Map<string,HTMLElement>}}
 */
export function createTabs({ idPrefix = 'tab', items, active = null, onSelect = null, selectOnArrow = true, label = t('分区') }) {
  const tablist = el('div', { class: 'tabbar', role: 'tablist', 'aria-label': label, 'data-testid': 'detail-tabs' });
  const panelHost = el('div', { class: 'tab-panel-host' });
  const buttons = new Map();
  let current = active && items.some((i) => i.key === active) ? active : items[0]?.key;

  const select = (key) => {
    if (!key || !items.some((i) => i.key === key)) return;
    current = key;
    for (const [k, btn] of buttons) {
      const isActive = k === key;
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      btn.setAttribute('tabindex', isActive ? '0' : '-1');
    }
    for (const panel of panelHost.querySelectorAll('[role="tabpanel"]')) {
      panel.hidden = panel.id !== `${idPrefix}-panel-${key}`;
    }
    if (typeof onSelect === 'function') onSelect(key);
  };

  const focusTab = (key) => {
    const btn = buttons.get(key);
    if (btn) btn.focus();
  };

  const onKeydown = (e) => {
    const keys = items.map((i) => i.key);
    const idx = keys.indexOf(current);
    let next = null;
    if (e.key === 'ArrowRight') next = keys[(idx + 1) % keys.length];
    else if (e.key === 'ArrowLeft') next = keys[(idx - 1 + keys.length) % keys.length];
    else if (e.key === 'Home') next = keys[0];
    else if (e.key === 'End') next = keys[keys.length - 1];
    if (!next) return;
    e.preventDefault();
    if (selectOnArrow) select(next);
    focusTab(next);
  };
  tablist.addEventListener('keydown', onKeydown);

  for (const item of items) {
    const btn = el('button', {
      class: 'tab', type: 'button', role: 'tab',
      id: `${idPrefix}-tab-${item.key}`,
      'aria-controls': `${idPrefix}-panel-${item.key}`,
      'aria-selected': 'false',
      tabindex: '-1',
      'data-testid': `tab-${item.key}`,
      onclick: () => select(item.key),
    }, item.icon ? icon(item.icon, 14, 'tab-icon') : null, item.label,
    item.count !== null && item.count !== undefined ? el('span', { class: 'tab-count', text: String(item.count) }) : null);
    buttons.set(item.key, btn);
    tablist.append(btn);
  }
  // aria-controls 指向常驻 panel：占位 panel 先建好，视图随后填充内容
  for (const item of items) {
    const panel = el('div', {
      class: 'tab-panel', role: 'tabpanel', id: `${idPrefix}-panel-${item.key}`,
      'aria-labelledby': `${idPrefix}-tab-${item.key}`, 'data-testid': `tab-panel-${item.key}`,
      hidden: true,
    });
    panelHost.append(panel);
  }
  select(current);
  return { tablist, panelHost, setActive: select, get active() { return current; }, buttons };
}
