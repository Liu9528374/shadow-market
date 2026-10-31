/** 共享 UI 组件：Toast / Modal / 资源卡 / 徽标 / 骨架屏 / 空状态 / 错误态 / 头像 / Markdown 外框 */

import { el, frag, fmtNum, fmtRelative, fmtDuration, initials, copyText } from './dom.js';
import { icon, hasIcon } from './icons.js';
import { pluginFor, getState } from './data.js';
import { MarketPoints } from './points.js';

/* ---------------- Toast ---------------- */

const TOAST_ICONS = { default: 'info', success: 'check-circle', error: 'x', warn: 'alert' };

export function toast(message, { kind = 'default', timeout = 3600, iconName = null } = {}) {
  const region = document.getElementById('toast-region');
  if (!region) return null;
  const node = el('div', { class: 'toast', dataset: { kind }, role: kind === 'error' ? 'alert' : 'status' },
    icon(iconName || TOAST_ICONS[kind] || 'info', 15, 'toast-icon'),
    el('div', { class: 'toast-text' }, String(message)),
    el('button', {
      class: 'toast-close', type: 'button', 'aria-label': '关闭提示',
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

export function openModal({ title = '', body = null, actions = [], onClose = null, labelledBy = null, width } = {}) {
  const root = document.getElementById('modal-root');
  if (!root) return null;
  const previousFocus = document.activeElement;
  const titleId = `modal-title-${Date.now().toString(36)}-${openModalCount}`;
  const backdrop = el('div', { class: 'modal-backdrop' });
  const modal = el('div', {
    class: 'modal', role: 'dialog', 'aria-modal': 'true',
    'aria-label': labelledBy ? undefined : (title || '对话框'),
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
    el('div', { class: 'modal-title', id: titleId }, title || '提示'),
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': '关闭对话框', onclick: close }, icon('x', 15)),
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
export function confirmDialog({ title, message, confirmLabel = '确认', cancelLabel = '取消', danger = false, details = null }) {
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
  const color = creator?.avatarColor || '#2EE6A8';
  const node = el('span', {
    class: `avatar avatar-${size}`,
    style: { background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 55%, #0d1117))` },
    'aria-hidden': 'true',
  }, initials(creator?.name || creator?.handle || '?'));
  return node;
}

export function typeLabel(type) {
  const plugin = pluginFor(type);
  return plugin.label;
}

export function freeBadge(resource) {
  if (resource.points > 0) {
    return el('span', { class: 'badge badge-points', title: 'P1 积分兑换演示：本地演示，积分不可购买' },
      icon('diamond', 11), `${resource.points} 积分`);
  }
  return el('span', { class: 'badge badge-free', title: 'P0 全免费资源' }, icon('check', 11), 'Free');
}

export function fixtureBadge() {
  return el('span', { class: 'badge badge-demo', title: '演示夹具数据：不是线上真实资源' }, '演示夹具');
}

export function unknownTypeBadge() {
  return el('span', { class: 'badge', title: '该资源类型没有可用的插件清单，已降级为通用卡片' }, icon('alert', 11), '类型未注册');
}

export function coverIcon(resource, { size = 'md' } = {}) {
  const plugin = pluginFor(resource?.type);
  const color1 = resource?.cover?.color1 || '#1B4D3E';
  const color2 = resource?.cover?.color2 || '#2EE6A8';
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
  if (fields.includes('sentences') && stats.sentences) out.push({ iconName: 'message', text: `${fmtNum(stats.sentences)} 句` });
  if (fields.includes('durationSec') && stats.durationSec) out.push({ iconName: 'clock', text: fmtDuration(stats.durationSec) });
  if (fields.includes('words') && stats.words) out.push({ iconName: 'terminal', text: `${fmtNum(stats.words)} 词` });
  return out.slice(0, limit);
}

export function metaItem(iconName, text, title = '') {
  return el('span', { class: 'res-meta', title: title || undefined }, icon(iconName, 13), el('span', { text }));
}

/** GitHub repo 卡式的资源卡 */
export function resourceCard(resource) {
  const plugin = pluginFor(resource.type);
  const creator = getState().catalog?.creatorMap.get(resource.creator);
  const href = `#/resource/${encodeURIComponent(resource.id)}`;
  const showFixture = getState().fixture || resource.fixture;

  const titleRow = el('div', { class: 'res-title-row' },
    el('a', { class: 'res-title', href }, resource.title),
    resource.free !== false ? freeBadge(resource) : null,
    plugin.fallback ? unknownTypeBadge() : el('span', { class: 'badge badge-type', title: `资源类型插件：${plugin.id}` }, plugin.label),
    showFixture ? fixtureBadge() : null,
  );

  const meta = el('div', { class: 'res-meta-row' });
  for (const item of statsMeta(resource)) meta.append(metaItem(item.iconName, item.text));
  meta.append(metaItem('download', `${fmtNum(resource.downloads)} 次下载`, 'P0 静态站示例统计（无后端，不虚报下载量）'));
  meta.append(metaItem('history', `更新于 ${fmtRelative(resource.updatedAt)}`, resource.updatedAt));

  const tags = el('div', { class: 'res-tags' });
  for (const tag of resource.tags.slice(0, 6)) {
    tags.append(el('a', { class: 'tag tag-plain', href: `#/search?q=${encodeURIComponent(tag)}`, title: `搜索标签：${tag}` }, tag));
  }

  return el('article', {
    class: 'res-card',
    dataset: { resourceId: resource.id, type: resource.type },
    'data-testid': 'resource-card',
    'aria-label': `${resource.title}（${plugin.label}${resource.free !== false ? ' · 免费' : ''}）`,
  },
    el('div', { class: 'res-card-head' },
      coverIcon(resource),
      el('div', { class: 'res-head-text' },
        titleRow,
        el('div', { class: 'res-sub' },
          resource.subtitle || '',
          creator ? el('span', {}, ' · ', el('a', { href: `#/creator/${encodeURIComponent(creator.handle)}` }, creator.name)) : null,
        ),
      ),
      el('span', { class: 'badge badge-level', title: '难度等级' }, resource.level || '—'),
    ),
    resource.description ? el('p', { class: 'res-desc' }, resource.description) : null,
    tags.children.length ? tags : null,
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

function actionButton(action) {
  if (action.href) {
    return el('a', { class: `btn ${action.kind === 'primary' ? 'btn-primary' : ''}`.trim(), href: action.href },
      action.icon ? icon(action.icon, 14) : null, action.label);
  }
  return el('button', {
    class: `btn ${action.kind === 'primary' ? 'btn-primary' : action.kind === 'danger' ? 'btn-danger' : ''}`.trim(),
    type: 'button',
    onclick: action.onClick,
    'data-testid': action.testid || undefined,
  }, action.icon ? icon(action.icon, 14) : null, action.label);
}

export function errorState({ title = '加载失败', desc = '', detail = '', actions = [], testid = 'error-state' }) {
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
  if (retry) acts.append(actionButton({ label: '重试', icon: 'refresh', onClick: retry, testid: 'retry-btn' }));
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
    el('div', { style: { minWidth: '0' } }, titleNode, sub ? el('p', { class: 'page-sub', text: sub }) : null),
    actions.length ? el('div', { class: 'page-head-actions' }, actions.map((a) => actionButton(a))) : null,
  );
}

export function breadcrumb(items) {
  const node = el('nav', { class: 'breadcrumb', 'aria-label': '面包屑导航' });
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
    children,
  );
}

export function asideRow(key, value) {
  return el('div', { class: 'aside-row' },
    el('span', { class: 'aside-k', text: key }),
    el('span', { class: 'aside-v' }, value instanceof Node ? value : String(value ?? '—')),
  );
}

export function copyButton(text, label = '复制', { testid = null } = {}) {
  return el('button', {
    class: 'btn btn-sm', type: 'button', 'data-testid': testid || undefined,
    onclick: async (e) => {
      const ok = await copyText(text);
      const btn = e.currentTarget;
      btn.textContent = ok ? '已复制' : '复制失败';
      setTimeout(() => { btn.textContent = label; }, 1400);
    },
  }, icon('copy', 13), label);
}

/* ---------------- 收藏按钮 ---------------- */

export function favoriteButton(resource) {
  const favorite = MarketPoints.isFavorite(resource.id);
  const btn = el('button', {
    class: 'btn', type: 'button', 'aria-pressed': favorite ? 'true' : 'false',
    'data-testid': 'favorite-btn',
    onclick: () => {
      const result = MarketPoints.toggleFavorite(resource.id);
      const now = result.favorite;
      btn.setAttribute('aria-pressed', now ? 'true' : 'false');
      btn.replaceChildren(icon(now ? 'star-fill' : 'star', 14), now ? '已收藏' : '收藏');
      if (now) btn.style.color = 'var(--attention)';
      else btn.style.color = '';
      toast(now ? '已收藏（仅保存在本机浏览器）' : '已取消收藏', { kind: 'success' });
    },
  }, icon(favorite ? 'star-fill' : 'star', 14), favorite ? '已收藏' : '收藏');
  if (favorite) btn.style.color = 'var(--attention)';
  return btn;
}

export function demoBanner(text, { iconName = 'alert' } = {}) {
  return el('div', { class: 'demo-banner', role: 'note' },
    el('span', { class: 'demo-icon' }, icon(iconName, 16)),
    el('div', { html: text }),
  );
}
