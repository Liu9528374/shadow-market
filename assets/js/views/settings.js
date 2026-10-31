/** 设置页（GitHub 设置逻辑：左侧分组导航 + 右侧行式表单 + Danger Zone） */

import { el, fmtDate } from '../dom.js';
import { icon } from '../icons.js';
import { getState, enabledPlugins } from '../data.js';
import { pageHead, toast, openModal, confirmDialog, copyButton, demoBanner } from '../components.js';
import { MarketPoints, POINTS_RULES, POINTS_STORAGE_KEY } from '../points.js';
import { getPrefs, setPref } from '../prefs.js';
import { applyTheme, getThemePref, THEME_PREFS } from '../theme.js';
import { navigate } from '../router.js';

const SECTIONS = [
  { id: 'account', label: '账户', icon: 'user' },
  { id: 'points', label: '积分', icon: 'diamond' },
  { id: 'appearance', label: '外观', icon: 'sun' },
  { id: 'notifications', label: '提醒', icon: 'bell' },
  { id: 'developer', label: '开发者', icon: 'terminal' },
  { id: 'danger', label: '危险区', icon: 'alert', danger: true },
];

function sectionEl({ id, title, desc }, ...rows) {
  return el('section', { class: 'settings-section', id: `settings-${id}`, 'data-testid': `settings-section-${id}` },
    el('div', { class: 'settings-section-head' },
      el('h2', { class: 'settings-section-title', text: title }),
      desc ? el('p', { class: 'settings-section-desc', text: desc }) : null,
    ),
    ...rows,
  );
}

function row(label, desc, control) {
  return el('div', { class: 'setting-row' },
    el('div', {}, el('div', { class: 'setting-label', text: label }), desc ? el('div', { class: 'setting-desc', text: desc }) : null),
    el('div', { class: 'setting-control' }, control),
  );
}

function readonlyField(text) {
  return el('span', { class: 'field-readonly', title: text, text });
}

function toggleSwitch({ checked, onChange, testid }) {
  const btn = el('button', {
    class: 'switch', type: 'button', role: 'switch',
    'aria-checked': checked ? 'true' : 'false',
    'aria-label': '开关',
    'data-testid': testid || undefined,
    onclick: () => {
      const next = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', next ? 'true' : 'false');
      onChange(next);
    },
  });
  return btn;
}

function themeRadios(repaint) {
  const current = getThemePref();
  const group = el('div', { class: 'radio-group', role: 'radiogroup', 'aria-label': '主题外观' });
  const labels = { light: '浅色', dark: '深色', system: '跟随系统' };
  const icons = { light: 'sun', dark: 'moon', system: 'monitor' };
  for (const pref of THEME_PREFS) {
    const input = el('input', {
      type: 'radio', name: 'theme', value: pref,
      checked: pref === current ? true : null,
      onchange: () => { applyTheme(pref, { persist: true }); repaint(); },
    });
    group.append(el('label', { title: `外观：${labels[pref]}` }, input, icon(icons[pref], 13), labels[pref]));
  }
  return group;
}

export function renderSettings(view, route) {
  view.replaceChildren();
  const state = getState();
  const repaint = () => renderSettings(view, route);
  const prefs = getPrefs();
  const points = MarketPoints.getPoints();

  view.append(pageHead({
    title: '设置',
    sub: 'GitHub 式分组设置：账户 / 积分 / 外观 / 提醒 / 开发者 / 危险区。P0 全部设置只作用于本机浏览器，无后端账号。',
    actions: [{ label: '返回探索', href: '#/', icon: 'compass' }],
  }));

  view.append(demoBanner(
    '<strong>P0/P1 本地设置</strong>　这些选项保存在本机浏览器（localStorage），换设备 / 清缓存会恢复默认；P1 没有账户后端，也不会同步到服务器。',
    { iconName: 'info' },
  ));

  const nav = el('nav', { class: 'settings-nav', 'aria-label': '设置分类', 'data-testid': 'settings-nav' });
  const navButtons = [];
  for (const section of SECTIONS) {
    const link = el('a', {
      href: `#/settings/${section.id}`,
      class: section.danger ? 'nav-danger' : '',
      'data-testid': `settings-nav-${section.id}`,
      onclick: (e) => {
        e.preventDefault();
        document.getElementById(`settings-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActive(section.id);
      },
    }, icon(section.icon, 14, 'side-icon'), section.label);
    navButtons.push({ id: section.id, node: link });
    nav.append(link);
  }
  const setActive = (id) => {
    for (const btn of navButtons) btn.node.setAttribute('aria-current', btn.id === id ? 'true' : 'false');
  };

  const main = el('div', { class: 'settings-main' });

  /* 账户 */
  const deviceId = MarketPoints.getDeviceId();
  main.append(sectionEl({ id: 'account', title: '账户', desc: 'P0 没有账号后端：市场用匿名设备 ID 区分本机演示数据，不收集邮箱 / 手机号 / 行为数据。' },
    row('匿名设备 ID', '本机生成、仅保存在 localStorage；不可跨设备识别，也不会上传。',
      el('span', { class: 'input-inline' }, readonlyField(deviceId), copyButton(deviceId, '复制', { testid: 'copy-device-id' }))),
    row('登录状态', 'P1 将支持可选账户（邮箱验证码 / 第三方登录）；当前是匿名本地演示，浏览与下载不需要登录。',
      el('span', { class: 'input-inline' },
        el('span', { class: 'badge' }, '未登录 · 本地演示'),
        el('button', {
          class: 'btn btn-sm', type: 'button', 'data-testid': 'login-placeholder',
          onclick: () => toast('P1 将支持可选账户；P0 全免费、浏览/下载无需登录，当前只有匿名设备本地演示。', { kind: 'warn', timeout: 4800 }),
        }, icon('sign-in', 13), '登录（占位）'),
      )),
    row('数据存储位置', '积分 / 我的资源 / 收藏 / 偏好全部只在本机；没有服务器同步，也不上传任何数据。',
      readonlyField('localStorage · 本机浏览器')),
  ));

  /* 积分 */
  main.append(sectionEl({ id: 'points', title: '积分', desc: '积分只是全免费资源的兑换凭证：免费获取、不可购买 / 提现 / 转让。P1 为本地演示。' },
    row('当前积分', '来自本机演示数据（MarketPoints 适配器）。', el('span', { class: 'input-inline' },
      el('strong', { style: { fontSize: '16px', fontVariantNumeric: 'tabular-nums' }, 'data-testid': 'settings-points', text: `${points} 分` }),
      el('a', { class: 'btn btn-sm', href: '#/points' }, icon('diamond', 13), '去积分页'),
    )),
    row('获取规则', `每日签到 +${POINTS_RULES.signIn} · 练习打卡 +${POINTS_RULES.practice} · 导入成功 +${POINTS_RULES.importReward}（每资源一次）。`, readonlyField('P1 本地演示规则')),
    row('积分存储键', '正式版把适配器换成 /api 后，此键不再使用。', readonlyField(POINTS_STORAGE_KEY)),
  ));

  /* 外观 */
  main.append(sectionEl({ id: 'appearance', title: '外观', desc: '深浅色通过 CSS 变量（design tokens）实现，立即生效并持久化到本机。' },
    row('主题', '浅色 / 深色 / 跟随系统。默认跟随系统，可随时切换。', themeRadios(repaint)),
    row('品牌色', 'SHADOW 青绿 #2EE6A8 仅做标识与高亮点缀，正文链接使用可读性更高的对比色。',
      el('span', { class: 'input-inline' },
        el('span', { style: { width: '18px', height: '18px', borderRadius: '5px', background: 'linear-gradient(135deg,#2EE6A8,#1BA8FF)', display: 'inline-block' } }),
        readonlyField('--brand: #2EE6A8'),
      )),
    row('动效', '尊重系统「减少动态效果」设置；开启后过渡与骨架动画会被禁用。', readonlyField('跟随系统 prefers-reduced-motion')),
  ));

  /* 提醒 */
  main.append(sectionEl({ id: 'notifications', title: '提醒', desc: 'P1 没有后端推送权限：这里只是本机提示开关，不会发送系统通知、不会联网。' },
    row('每日签到提醒', '开启后，若今天还没签到，首页会显示一条本地提示（不弹系统通知）。',
      toggleSwitch({
        checked: Boolean(prefs.dailyReminder), testid: 'pref-daily-reminder',
        onChange: (next) => {
          setPref('dailyReminder', next);
          toast(next ? '已开启每日签到本地提示' : '已关闭每日签到本地提示', { kind: 'success' });
        },
      })),
    row('导入成功后提示记录积分', '导入成功后提示可记录 +20 积分（P1 本地演示，每个资源一次）。',
      toggleSwitch({
        checked: Boolean(prefs.importRewardHint), testid: 'pref-import-hint',
        onChange: (next) => {
          setPref('importRewardHint', next);
          toast(next ? '已开启导入积分提示' : '已关闭导入积分提示', { kind: 'success' });
        },
      })),
  ));

  /* 开发者 */
  const pluginRows = el('div', { class: 'stack', style: { marginTop: '10px' } });
  const plugins = enabledPlugins();
  if (plugins.length === 0) pluginRows.append(el('p', { class: 'muted', text: '没有加载到插件清单（plugins/index.json）。' }));
  for (const plugin of plugins) {
    pluginRows.append(el('div', { class: 'my-resource' },
      el('span', { class: 'res-icon', style: { width: '28px', height: '28px', borderRadius: '6px', background: 'var(--accent-muted)', color: 'var(--accent)' } }, icon(plugin.icon, 15)),
      el('div', { class: 'my-resource-body' },
        el('div', { style: { fontWeight: '600', fontSize: '13px' } }, `${plugin.label}（${plugin.id}）`),
        el('div', { class: 'my-resource-meta' },
          `tabs: ${plugin.detailTabs.join(' / ')} · 额度文件: ${plugin.fileExt.join(' ') || '—'} · manifestVersion ${plugin.manifestVersion}`,
        ),
      ),
      el('a', { class: 'btn btn-sm', href: `plugins/${encodeURIComponent(plugin.id)}/manifest.json`, target: '_blank', rel: 'noopener' }, icon('code', 13), 'manifest'),
    ));
  }
  const dataStatus = state.catalog
    ? (state.fixture ? '演示夹具（assets/dev-fixtures）' : '真实目录 data/catalog.json')
    : (state.catalogError ? `加载失败：${state.catalogError.message}` : '未加载');
  main.append(sectionEl({ id: 'developer', title: '开发者', desc: '只读调试信息：数据源、插件清单、本地适配器。市场是纯静态站，无构建步骤。' },
    row('数据源', `目录生成时间：${state.catalog?.generatedAt ? fmtDate(state.catalog.generatedAt) : '—'}。数据缺失时可用演示夹具降级。`,
      el('span', { class: 'input-inline' },
        el('span', { class: `badge ${state.catalog && !state.fixture ? 'badge-free' : ''}`.trim() }, dataStatus),
        el('button', { class: 'btn btn-sm', type: 'button', 'data-testid': 'reload-data', onclick: () => window.dispatchEvent(new CustomEvent('market:reload')) }, icon('refresh', 13), '重新加载数据'),
      )),
    row('资源类型插件（一切即插件）', `启动时 fetch plugins/index.json 并逐个读取 manifest.json 注册渲染器；市场不执行插件代码，只读声明。当前 ${plugins.length} 个类型。`, pluginRows),
    row('MarketPoints 适配器', 'P1 用 localStorage 实现 getPoints / earn / spend / ledger；正式版整体替换为 /api，不动页面逻辑。',
      el('span', { class: 'input-inline' },
        readonlyField('localStorage · market-points'),
        el('button', {
          class: 'btn btn-sm', type: 'button', 'data-testid': 'export-local-data',
          onclick: () => {
            const data = MarketPoints.exportData();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'shadow-market-local-data.json';
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            toast('已导出本地演示数据（JSON）', { kind: 'success' });
          },
        }, icon('download', 13), '导出数据'),
      )),
    row('命令面板', 'Ctrl+K（macOS 为 ⌘K）打开命令面板；/ 聚焦搜索框。',
      el('button', {
        class: 'btn btn-sm', type: 'button',
        onclick: () => window.dispatchEvent(new CustomEvent('market:openpalette')),
      }, icon('command', 13), '打开命令面板')),
  ));

  /* 危险区 */
  main.append(sectionEl({ id: 'danger', title: '危险区', desc: '清除本机市场演示数据。不影响 market/data 下的课程包文件，也不影响任何下载到磁盘的文件。' },
    el('div', { class: 'danger-zone' },
      row('清除本地演示数据', '删除本机积分、流水、我的资源、收藏、偏好与主题设置（localStorage 中以 shadow.market. 开头的键）。不可撤销。',
        el('button', {
          class: 'btn btn-danger btn-sm', type: 'button', 'data-testid': 'reset-local-data',
          onclick: async () => {
            const ok = await confirmDialog({
              title: '清除本地演示数据？',
              message: '将删除本机浏览器里的积分、流水、我的资源、收藏和偏好设置（不会删除已下载的课程包文件，也不影响服务器文件）。',
              details: 'localStorage keys: shadow.market.points.v1, shadow.market.prefs.v1, shadow.market.theme.v1, shadow.market.fixture.v1',
              confirmLabel: '清除数据',
              danger: true,
            });
            if (!ok) return;
            clearLocalData();
            toast('已清除本地演示数据（积分 / 流水 / 我的资源 / 收藏 / 偏好）', { kind: 'success', timeout: 4200 });
            repaint();
          },
        }, icon('trash', 14), '清除本地演示数据')),
    )),
  );

  view.append(el('div', { class: 'settings-grid' }, nav, main));

  // 深链 #/settings/<section>：滚动到对应分组
  const targetId = route?.params?.section;
  if (targetId && SECTIONS.some((s) => s.id === targetId)) {
    setActive(targetId);
    requestAnimationFrame(() => {
      document.getElementById(`settings-${targetId}`)?.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
  } else {
    setActive('account');
  }
}

function clearLocalData() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('shadow.market.')) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch { /* ignore */ }
  MarketPoints.resetAll();
  applyTheme('system', { persist: false });
}
