/** Ctrl+K 命令面板：页面跳转 / 资源搜索 / 快捷操作（GitHub 式 command palette）
 *  a11y：combobox + aria-expanded / aria-controls / aria-activedescendant + ↑↓/Enter/Esc。 */

import { el, debounce } from './dom.js';
import { icon } from './icons.js';
import { getState, searchResources } from './data.js';
import { MarketPoints } from './points.js';
import { navigate } from './router.js';
import { toast } from './components.js';
import { toggleTheme, resolveTheme } from './theme.js';
import { t, getLang } from './i18n.js';

let openHandle = null;

function pageActions() {
  return [
    { group: t('页面'), label: t('探索市场'), hint: '#/', iconName: 'compass', run: () => navigate('/') },
    { group: t('页面'), label: t('我的收藏'), hint: '#/favorites', iconName: 'star', run: () => navigate('/favorites') },
    { group: t('页面'), label: t('投稿指南'), hint: '#/contribute', iconName: 'book', run: () => navigate('/contribute') },
    { group: t('页面'), label: t('一键导入说明'), hint: '#/import', iconName: 'upload', run: () => navigate('/import') },
    { group: t('页面'), label: t('更新日志'), hint: '#/changelog', iconName: 'history', run: () => navigate('/changelog') },
    { group: t('页面'), label: t('关于 SHADOW 市场'), hint: '#/about', iconName: 'info', run: () => navigate('/about') },
    { group: t('页面'), label: t('隐私说明'), hint: '#/privacy', iconName: 'shield', run: () => navigate('/privacy') },
    { group: t('页面'), label: t('版权与投诉'), hint: '#/complaint', iconName: 'scale', run: () => navigate('/complaint') },
    { group: t('页面'), label: t('设置'), hint: '#/settings', iconName: 'gear', run: () => navigate('/settings') },
    { group: t('页面'), label: t('积分（P1 预览）'), hint: '#/points', iconName: 'diamond', run: () => navigate('/points') },
  ];
}

function commandActions(repaint) {
  return [
    {
      group: t('操作'), label: `${t('切换深浅色')}（${resolveTheme() === 'dark' ? t('深色') : t('浅色')}）`, hint: t('主题'), iconName: 'sun',
      run: () => { toggleTheme(); toast(t('已切换外观主题（保存在本机）'), { kind: 'success' }); repaint(); },
    },
    {
      group: t('操作'), label: `${t('切换语言')}（${getLang() === 'en' ? 'English' : '中文'} → ${getLang() === 'en' ? '中文' : 'English'}）`, hint: '中 / EN', iconName: 'globe',
      run: () => { window.dispatchEvent(new CustomEvent('market:togglelang')); },
    },
    {
      group: t('操作'), label: `${t('每日签到')} +${MarketPoints.ruleLabel.signIn}`, hint: t('P1 本地演示'), iconName: 'check',
      run: () => {
        const result = MarketPoints.signIn();
        if (result.ok) toast(t('签到成功 +{n} 积分（本地演示）', { n: MarketPoints.ruleLabel.signIn }), { kind: 'success' });
        else toast(t('今天已经签到过了'), { kind: 'warn' });
      },
    },
    {
      group: t('操作'), label: `${t('练习打卡')} +${MarketPoints.ruleLabel.practice}`, hint: t('P1 本地演示'), iconName: 'play',
      run: () => {
        const result = MarketPoints.practiceCheckIn();
        if (result.ok) toast(t('打卡成功 +{n} 积分（本地演示）', { n: MarketPoints.ruleLabel.practice }), { kind: 'success' });
        else toast(t('今天已经打过卡了'), { kind: 'warn' });
      },
    },
    {
      group: t('操作'), label: t('重新加载目录数据'), hint: t('开发者'), iconName: 'refresh',
      run: () => window.dispatchEvent(new CustomEvent('market:reload')),
    },
  ];
}

function buildItems(query, repaint) {
  const q = String(query || '').trim().toLowerCase();
  const match = (text) => !q || String(text).toLowerCase().includes(q);
  const state = getState();
  const items = [];

  items.push(...pageActions().filter((a) => match(a.label) || match(a.hint)));
  items.push(...commandActions(repaint).filter((a) => match(a.label) || match(a.group)));

  if (state.catalog) {
    const resources = (q ? searchResources(q) : state.catalog.resources).slice(0, 8);
    for (const resource of resources) {
      items.push({
        group: t('资源'),
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
  const listId = 'palette-listbox';

  const backdrop = el('div', { class: 'palette-backdrop' });
  const palette = el('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('命令面板'), 'data-testid': 'command-palette' });
  const input = el('input', {
    class: 'palette-input', type: 'text', autocomplete: 'off', spellcheck: 'false',
    role: 'combobox',
    'aria-label': t('命令面板搜索'),
    'aria-autocomplete': 'list',
    'aria-expanded': 'true',
    'aria-controls': listId,
    'aria-activedescendant': '',
    'data-testid': 'palette-input',
  });
  input.placeholder = t('搜索资源或输入命令…');
  const inputRow = el('div', { class: 'palette-input-row' }, icon('search', 16), input, el('kbd', { class: 'kbd palette-esc' }, 'Esc'));
  const list = el('div', { class: 'palette-list', role: 'listbox', id: listId, 'aria-label': t('命令与资源列表'), 'data-testid': 'palette-list' });
  const foot = el('div', { class: 'palette-foot' },
    el('span', {}, el('kbd', { class: 'kbd' }, '↑'), el('kbd', { class: 'kbd' }, '↓'), ` ${t('选择')}`),
    el('span', {}, el('kbd', { class: 'kbd' }, 'Enter'), ` ${t('打开')}`),
    el('span', {}, el('kbd', { class: 'kbd' }, 'Esc'), ` ${t('关闭')}`),
    el('span', { class: 'spacer' }),
    el('span', { class: 'subtle', text: t('Ctrl+K 打开 · / 聚焦搜索') }),
  );
  palette.append(inputRow, list, foot);

  const optionId = (idx) => `palette-option-${idx}`;

  const updateActive = () => {
    const nodes = list.querySelectorAll('.palette-item');
    for (const node of nodes) {
      const idx = Number(node.dataset.index);
      const active = idx === activeIndex;
      node.dataset.active = active ? 'true' : 'false';
      node.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) {
        node.scrollIntoView({ block: 'nearest' });
        input.setAttribute('aria-activedescendant', optionId(idx));
      }
    }
    if (!nodes.length) input.setAttribute('aria-activedescendant', '');
  };

  const repaint = () => {
    items = buildItems(input.value, repaint);
    if (activeIndex >= items.length) activeIndex = Math.max(0, items.length - 1);
    list.replaceChildren();
    if (items.length === 0) {
      list.append(el('div', { class: 'palette-empty', role: 'status', text: t('没有匹配的命令或资源。试试资源标题、分类或「设置」。') }));
      input.setAttribute('aria-activedescendant', '');
      return;
    }
    let currentGroup = null;
    items.forEach((item, idx) => {
      if (item.group !== currentGroup) {
        currentGroup = item.group;
        list.append(el('div', { class: 'palette-group-label', role: 'presentation', text: currentGroup }));
      }
      const btn = el('button', {
        class: 'palette-item', type: 'button', role: 'option',
        id: optionId(idx),
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
    input.setAttribute('aria-expanded', 'false');
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
