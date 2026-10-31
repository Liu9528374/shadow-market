/** Ctrl+K 命令面板：页面跳转 / 资源搜索 / 快捷操作（GitHub 式 command palette） */

import { el, debounce } from './dom.js';
import { icon } from './icons.js';
import { getState, searchResources } from './data.js';
import { MarketPoints } from './points.js';
import { navigate } from './router.js';
import { toast } from './components.js';
import { toggleTheme, resolveTheme } from './theme.js';

let openHandle = null;

function pageActions() {
  return [
    { group: '页面', label: '探索市场', hint: '#/', iconName: 'compass', run: () => navigate('/') },
    { group: '页面', label: '积分（P1 本地演示）', hint: '#/points', iconName: 'diamond', run: () => navigate('/points') },
    { group: '页面', label: '一键导入说明', hint: '#/import', iconName: 'upload', run: () => navigate('/import') },
    { group: '页面', label: '设置', hint: '#/settings', iconName: 'gear', run: () => navigate('/settings') },
    { group: '页面', label: '我的资源 / 我的收藏', hint: '#/points', iconName: 'book', run: () => navigate('/points') },
    { group: '页面', label: '看不到的页面（404 示例）', hint: '#/404', iconName: 'alert', run: () => navigate('/404') },
  ];
}

function commandActions(repaint) {
  return [
    {
      group: '操作', label: `切换深浅色（当前 ${resolveTheme() === 'dark' ? '深色' : '浅色'}）`, hint: '主题', iconName: 'sun',
      run: () => { toggleTheme(); toast('已切换外观主题（保存在本机）', { kind: 'success' }); repaint(); },
    },
    {
      group: '操作', label: `每日签到 +${MarketPoints.ruleLabel.signIn}`, hint: 'P1 本地演示', iconName: 'check',
      run: () => {
        const result = MarketPoints.signIn();
        if (result.ok) toast(`签到成功 +5 积分（本地演示）`, { kind: 'success' });
        else toast('今天已经签到过了', { kind: 'warn' });
      },
    },
    {
      group: '操作', label: '练习打卡 +10（P1 本地演示）', hint: '积分', iconName: 'play',
      run: () => {
        const result = MarketPoints.practiceCheckIn();
        if (result.ok) toast('打卡成功 +10 积分（本地演示）', { kind: 'success' });
        else toast('今天已经打过卡了', { kind: 'warn' });
      },
    },
    {
      group: '操作', label: '重新加载目录数据（data/catalog.json）', hint: '开发者', iconName: 'refresh',
      run: () => window.dispatchEvent(new CustomEvent('market:reload')),
    },
  ];
}

function buildItems(query, repaint) {
  const q = String(query || '').trim().toLowerCase();
  const match = (text) => !q || String(text).toLowerCase().includes(q);
  const state = getState();
  const items = [];

  const pages = pageActions().filter((a) => match(a.label) || match(a.hint));
  items.push(...pages);
  const commands = commandActions(repaint).filter((a) => match(a.label) || match(a.group));
  items.push(...commands);

  if (state.catalog) {
    const resources = (q ? searchResources(q) : state.catalog.resources).slice(0, 8);
    for (const resource of resources) {
      items.push({
        group: '资源',
        label: resource.title,
        hint: `${resource.categoryLabel || resource.category || ''} · ${resource.level || ''}`.replace(/^ · /, ''),
        iconName: 'book',
        run: () => navigate(`/resource/${encodeURIComponent(resource.id)}`),
      });
    }
  }
  return items;
}

export function openCommandPalette({ onAfterAction = null } = {}) {
  if (openHandle) { openHandle.close(); return; }
  const root = document.getElementById('palette-root');
  if (!root) return;

  const previousFocus = document.activeElement;
  let items = [];
  let activeIndex = 0;
  let closed = false;

  const backdrop = el('div', { class: 'palette-backdrop' });
  const palette = el('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': '命令面板', 'data-testid': 'command-palette' });
  const input = el('input', {
    class: 'palette-input', type: 'text', placeholder: '搜索资源或输入命令…', autocomplete: 'off', spellcheck: 'false',
    'aria-label': '命令面板搜索', 'data-testid': 'palette-input',
  });
  const inputRow = el('div', { class: 'palette-input-row' }, icon('search', 16), input, el('kbd', { class: 'kbd palette-esc' }, 'Esc'));
  const list = el('div', { class: 'palette-list', role: 'listbox', 'aria-label': '命令与资源列表', 'data-testid': 'palette-list' });
  const foot = el('div', { class: 'palette-foot' },
    el('span', {}, el('kbd', { class: 'kbd' }, '↑'), el('kbd', { class: 'kbd' }, '↓'), ' 选择'),
    el('span', {}, el('kbd', { class: 'kbd' }, 'Enter'), ' 打开'),
    el('span', {}, el('kbd', { class: 'kbd' }, 'Esc'), ' 关闭'),
    el('span', { class: 'spacer' }),
    el('span', { class: 'subtle', text: 'Ctrl+K 打开 · / 聚焦搜索' }),
  );
  palette.append(inputRow, list, foot);

  const repaint = () => {
    items = buildItems(input.value, repaint);
    if (activeIndex >= items.length) activeIndex = Math.max(0, items.length - 1);
    list.replaceChildren();
    if (items.length === 0) {
      list.append(el('div', { class: 'palette-empty', text: '没有匹配的命令或资源。试试资源标题、分类或「设置」。' }));
      return;
    }
    let currentGroup = null;
    items.forEach((item, idx) => {
      if (item.group !== currentGroup) {
        currentGroup = item.group;
        list.append(el('div', { class: 'palette-group-label', text: currentGroup }));
      }
      const btn = el('button', {
        class: 'palette-item', type: 'button', role: 'option',
        'aria-selected': idx === activeIndex ? 'true' : 'false',
        'data-active': idx === activeIndex ? 'true' : 'false',
        dataset: { index: String(idx) },
        onclick: () => runItem(idx),
        onmousemove: () => { if (activeIndex !== idx) { activeIndex = idx; updateActive(); } },
      }, icon(item.iconName || 'arrow-right', 15, 'palette-item-icon'),
        el('span', { class: 'palette-item-text', text: item.label }),
        item.hint ? el('span', { class: 'palette-item-hint', text: item.hint }) : null);
      list.append(btn);
    });
    updateActive();
  };

  const updateActive = () => {
    for (const node of list.querySelectorAll('.palette-item')) {
      const idx = Number(node.dataset.index);
      const active = idx === activeIndex;
      node.dataset.active = active ? 'true' : 'false';
      node.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) node.scrollIntoView({ block: 'nearest' });
    }
  };

  const runItem = (idx) => {
    const item = items[idx];
    if (!item) return;
    close();
    try { item.run(); } finally { if (typeof onAfterAction === 'function') onAfterAction(); }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKeydown, true);
    openHandle = null;
    if (previousFocus && typeof previousFocus.focus === 'function') {
      try { previousFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
  };

  const onKeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = items.length ? (activeIndex + 1) % items.length : 0;
      updateActive();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = items.length ? (activeIndex - 1 + items.length) % items.length : 0;
      updateActive();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      runItem(activeIndex);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      input.focus();
    }
  };

  const debouncedRepaint = debounce(repaint, 60);
  input.addEventListener('input', () => { activeIndex = 0; debouncedRepaint(); });
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKeydown, true);
  backdrop.append(palette);
  root.replaceChildren(backdrop);
  openHandle = { close, repaint };
  repaint();
  setTimeout(() => input.focus({ preventScroll: true }), 0);
}

export function closeCommandPalette() {
  if (openHandle) openHandle.close();
}
