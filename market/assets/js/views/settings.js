/** 设置页（P0 简化：账户与数据 / 外观 / 语言 / 数据与隐私 / 关于 / 开发者 + 危险区）
 *  GitHub 设置逻辑：左侧分组导航 + 右侧行式表单 + Danger Zone；全部只作用于本机。 */

import { el, fmtDate } from '../dom.js';
import { icon } from '../icons.js';
import { getState, enabledPlugins } from '../data.js';
import { pageHead, toast, confirmDialog, copyButton, demoBanner } from '../components.js';
import { MarketPoints, POINTS_RULES, POINTS_STORAGE_KEY } from '../points.js';
import { getPrefs, setPref } from '../prefs.js';
import { applyTheme, getThemePref, THEME_PREFS } from '../theme.js';
import { navigate, scrollIntoViewRespectingMotion } from '../router.js';
import { t, getLang, setLang, LANGS } from '../i18n.js';
import { applyUpdate, checkForUpdate, canInstall, promptInstall } from '../pwa.js';

const APP_VERSION = 'market-p0.2';

const SECTION_ICONS = {
  account: 'user',
  appearance: 'sun',
  language: 'globe',
  data: 'database',
  about: 'info',
  developer: 'terminal',
  danger: 'alert',
};

function sections() {
  return [
    { id: 'account', label: t('账户与数据') },
    { id: 'appearance', label: t('外观') },
    { id: 'language', label: t('语言') },
    { id: 'data', label: t('数据与隐私') },
    { id: 'about', label: t('关于市场') },
    { id: 'developer', label: t('开发者') },
    { id: 'danger', label: t('危险区'), danger: true },
  ];
}

function sectionEl({ id, title, desc }, ...rows) {
  return el('section', { class: 'settings-section', id: `settings-${id}`, 'data-testid': `settings-section-${id}` },
    el('div', { class: 'settings-section-head' },
      el('h2', { class: 'settings-section-title', text: title }),
      desc ? el('p', { class: 'settings-section-desc', text: desc }) : null,
    ),
    ...rows,
  );
}

function row(label, desc, control, { id = '' } = {}) {
  const labelId = id ? `setting-label-${id}` : null;
  return el('div', { class: 'setting-row' },
    el('div', {},
      el('div', { class: 'setting-label', id: labelId || undefined, text: label }),
      desc ? el('div', { class: 'setting-desc', text: desc }) : null,
    ),
    el('div', { class: 'setting-control' }, control),
  );
}

function readonlyField(text) {
  return el('span', { class: 'field-readonly', title: text, text });
}

/** 开关：aria-labelledby 关联设置名（a11y 审计 A3 修复） */
function toggleSwitch({ checked, onChange, testid, labelId, descId }) {
  const btn = el('button', {
    class: 'switch', type: 'button', role: 'switch',
    'aria-checked': checked ? 'true' : 'false',
    'aria-labelledby': labelId || undefined,
    'aria-describedby': descId || undefined,
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
  const group = el('div', { class: 'radio-group', role: 'radiogroup', 'aria-label': t('主题外观') });
  const labels = { light: t('浅色'), dark: t('深色'), system: t('跟随系统') };
  const icons = { light: 'sun', dark: 'moon', system: 'monitor' };
  for (const pref of THEME_PREFS) {
    const input = el('input', {
      type: 'radio', name: 'theme', value: pref,
      checked: pref === current ? true : null,
      onchange: () => { applyTheme(pref, { persist: true }); repaint(); },
    });
    group.append(el('label', { title: `${t('主题')}：${labels[pref]}` }, input, icon(icons[pref], 13), labels[pref]));
  }
  return group;
}

function languageRadios() {
  const current = getLang();
  const group = el('div', { class: 'radio-group', role: 'radiogroup', 'aria-label': t('语言') });
  for (const lang of LANGS) {
    const input = el('input', {
      type: 'radio', name: 'lang', value: lang.id,
      checked: lang.id === current ? true : null,
      onchange: () => {
        setLang(lang.id);
        toast(lang.id === 'en' ? 'Language switched to English' : '界面语言已切换为中文', { kind: 'success' });
      },
    });
    group.append(el('label', {}, input, icon('globe', 13), lang.label));
  }
  return group;
}

export function renderSettings(view, route) {
  view.replaceChildren();
  const state = getState();
  const repaint = () => renderSettings(view, route);
  const prefs = getPrefs();
  const points = MarketPoints.getPoints();
  const navSections = sections();

  view.append(pageHead({
    title: t('设置'),
    sub: t('P0 简化设置：账户与数据 / 外观 / 语言 / 数据与隐私 / 关于 / 开发者。全部设置只作用于本机浏览器，无后端账号。'),
    actions: [{ label: t('返回探索'), href: '#/', icon: 'compass' }],
  }));

  view.append(demoBanner(
    `<strong>${t('本机设置')}</strong>　${t('这些选项只保存在本机浏览器（localStorage），换设备或清除缓存会恢复默认；P0 没有账户后端。')}`,
    { iconName: 'info' },
  ));

  const nav = el('nav', { class: 'settings-nav', 'aria-label': t('设置分类'), 'data-testid': 'settings-nav' });
  const navButtons = [];
  for (const section of navSections) {
    const link = el('a', {
      href: `#/settings/${section.id}`,
      class: section.danger ? 'nav-danger' : '',
      'data-testid': `settings-nav-${section.id}`,
      onclick: (e) => {
        e.preventDefault();
        scrollIntoViewRespectingMotion(document.getElementById(`settings-${section.id}`));
        setActive(section.id);
      },
    }, icon(SECTION_ICONS[section.id] || 'gear', 14, 'side-icon'), section.label);
    navButtons.push({ id: section.id, node: link });
    nav.append(link);
  }
  const setActive = (id) => {
    for (const btn of navButtons) btn.node.setAttribute('aria-current', btn.id === id ? 'true' : 'false');
  };

  const main = el('div', { class: 'settings-main' });

  /* 账户与数据 */
  const deviceId = MarketPoints.getDeviceId();
  main.append(sectionEl({ id: 'account', title: t('账户与数据'), desc: t('P0 没有账号后端：市场用匿名设备 ID 区分本机演示数据，不收集邮箱 / 手机号 / 行为数据。') },
    row(t('匿名设备 ID'), t('本机生成、仅保存在 localStorage；不可跨设备识别，也不会上传。'),
      el('span', { class: 'input-inline' }, readonlyField(deviceId), copyButton(deviceId, t('复制'), { testid: 'copy-device-id' }))),
    row(t('登录状态'), t('P1 将支持可选账户（邮箱验证码）；当前是匿名本地演示，浏览与下载不需要登录。'),
      el('span', { class: 'input-inline' },
        el('span', { class: 'badge' }, t('未登录 · 本地演示')),
        el('button', {
          class: 'btn btn-sm', type: 'button', 'data-testid': 'login-placeholder',
          onclick: () => toast(t('P1 将支持可选账户；P0 全免费、浏览/下载无需登录，当前只有匿名设备本地演示。'), { kind: 'warn', timeout: 4800 }),
        }, icon('sign-in', 13), t('登录（占位）')),
      )),
    row(t('数据存储位置'), t('偏好、收藏、主题、积分演示数据全部只在本机；没有服务器同步。'),
      readonlyField('localStorage · 本机浏览器')),
  ));

  /* 外观 */
  main.append(sectionEl({ id: 'appearance', title: t('外观'), desc: t('深浅色通过 CSS 变量（design tokens）实现，立即生效并持久化到本机。') },
    row(t('主题外观'), t('默认跟随系统，可随时切换；保存在本机并立即生效。'), themeRadios(repaint)),
    row(t('品牌色'), t('品牌橙（声波 / Voice Wave 图标）仅做标识与高亮点缀；正文链接使用可读性达标的强调色。'),
      el('span', { class: 'input-inline' },
        el('span', { style: { width: '18px', height: '18px', borderRadius: '5px', background: 'var(--brand-gradient)', display: 'inline-block' } }),
        readonlyField('--brand: #E88A2E'),
      )),
    row(t('动效'), t('尊重系统「减少动态效果」设置；开启后过渡、骨架动画与 JS 平滑滚动会被禁用。'), readonlyField('prefers-reduced-motion')),
  ));

  /* 语言 */
  main.append(sectionEl({ id: 'language', title: t('语言'), desc: t('界面语言：中文 / English。切换后页面立即更新，不需要刷新。') },
    row(t('语言'), t('覆盖导航、按钮、空态、导入说明与静态合规页；资源内容按数据字段渲染。'), languageRadios()),
    row(t('语言存储键'), t('仅保存在本机；清除本地数据会恢复中文。'), readonlyField('shadow.market.lang.v1')),
  ));

  /* 数据与隐私 */
  main.append(sectionEl({ id: 'data', title: t('数据与隐私'), desc: t('P0 没有埋点、没有第三方分析，数据只在本机；这里可以导出或清除。') },
    row(t('积分演示数据'), t('来自本机 MarketPoints 适配器；P1 换 /api 后不再使用这些键。'),
      el('span', { class: 'input-inline' },
        el('strong', { style: { fontSize: '16px', fontVariantNumeric: 'tabular-nums' }, 'data-testid': 'settings-points', text: `${points} ${t('分')}` }),
        el('a', { class: 'btn btn-sm', href: '#/points' }, icon('diamond', 13), t('去积分页')),
      )),
    row(t('积分规则'), t('每日签到 +{sign} · 练习打卡 +{practice} · 导入成功 +{reward}（每资源一次）。', { sign: POINTS_RULES.signIn, practice: POINTS_RULES.practice, reward: POINTS_RULES.importReward }), readonlyField('P1 本地演示规则')),
    row(t('积分存储键'), t('正式版把适配器换成 /api 后，此键不再使用。'), readonlyField(POINTS_STORAGE_KEY)),
    row(t('导出本地数据'), t('导出本机演示数据 JSON（积分 / 流水 / 收藏 / 我的资源）。'),
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
          toast(t('已导出本地演示数据（JSON）'), { kind: 'success' });
        },
      }, icon('download', 13), t('导出数据'))),
    row(t('隐私说明'), t('localStorage 键清单、数据流与不收集承诺。'), el('a', { class: 'btn btn-sm', href: '#/privacy' }, icon('shield', 13), t('查看隐私说明'))),
    row(t('每日签到本地提示'),
      t('开启后，若今天还没签到，首页会显示一条本地提示（不弹系统通知、不联网）。'),
      toggleSwitch({
        checked: Boolean(prefs.dailyReminder), testid: 'pref-daily-reminder',
        labelId: 'setting-label-daily-reminder',
        onChange: (next) => {
          setPref('dailyReminder', next);
          toast(next ? t('已开启每日签到本地提示') : t('已关闭每日签到本地提示'), { kind: 'success' });
        },
      }), { id: 'daily-reminder' }),
    row(t('导入成功后提示记录积分'),
      t('导入成功后提示可记录 +20 积分（P1 本地演示，每个资源一次）。'),
      toggleSwitch({
        checked: Boolean(prefs.importRewardHint), testid: 'pref-import-hint',
        labelId: 'setting-label-import-hint',
        onChange: (next) => {
          setPref('importRewardHint', next);
          toast(next ? t('已开启导入积分提示') : t('已关闭导入积分提示'), { kind: 'success' });
        },
      }), { id: 'import-hint' }),
  ));

  /* 关于市场 */
  main.append(sectionEl({ id: 'about', title: t('关于市场'), desc: t('版本、数据源与产品边界。') },
    row(t('版本'), t('市场前端版本（P0 静态版）。'), readonlyField(`SHADOW Market ${APP_VERSION}`)),
    row(t('数据源'), state.catalog
      ? `${state.schemaVersion === 2 ? 'catalog/*.json（schemaVersion 2）' : 'data/catalog.json（schemaVersion 1 兼容层）'} · ${t('生成于')} ${fmtDate(state.catalog.generatedAt)}`
      : t('资源目录未加载'),
      el('span', { class: 'input-inline' },
        el('span', { class: `badge ${state.catalog && !state.fixture ? 'badge-free' : ''}`.trim() }, state.fixture ? t('演示夹具') : (state.catalog ? t('真实目录') : t('未加载'))),
        el('button', { class: 'btn btn-sm', type: 'button', 'data-testid': 'reload-data', onclick: () => window.dispatchEvent(new CustomEvent('market:reload')) }, icon('refresh', 13), t('重新加载数据')),
      )),
    row(t('安装到主屏幕'), t('P0 是手写 PWA：可安装、离线浏览已缓存页面（不缓存任何用户媒体）。'),
      el('span', { class: 'input-inline' },
        el('button', {
          class: 'btn btn-sm', type: 'button', 'data-testid': 'install-pwa',
          onclick: async () => {
            const result = await promptInstall();
            if (result === 'accepted') toast(t('开始安装 SHADOW 市场…'), { kind: 'success' });
            else if (result === 'unavailable') toast(canInstall() ? t('请稍后再试') : t('当前浏览器暂未提供安装入口：可用浏览器菜单「安装应用 / 添加到主屏幕」。'), { kind: 'warn', timeout: 4800 });
          },
        }, icon('download', 13), t('安装')))),
    row(t('关于 / 隐私 / 投诉'), t('产品定位、隐私说明与版权投诉入口。'),
      el('span', { class: 'input-inline' },
        el('a', { class: 'btn btn-sm', href: '#/about' }, t('关于')),
        el('a', { class: 'btn btn-sm', href: '#/privacy' }, t('隐私')),
        el('a', { class: 'btn btn-sm', href: '#/complaint' }, t('投诉')),
      )),
  ));

  /* 开发者 */
  const pluginRows = el('div', { class: 'stack', style: { marginTop: '10px' } });
  const plugins = enabledPlugins();
  if (plugins.length === 0) pluginRows.append(el('p', { class: 'muted', text: t('没有加载到插件清单（plugins/index.json）。') }));
  for (const plugin of plugins) {
    pluginRows.append(el('div', { class: 'my-resource' },
      el('span', { class: 'res-icon', style: { width: '28px', height: '28px', borderRadius: '6px', background: 'var(--accent-muted)', color: 'var(--accent)' } }, icon(plugin.icon, 15)),
      el('div', { class: 'my-resource-body' },
        el('div', { style: { fontWeight: '600', fontSize: '13px' } }, `${plugin.label}（${plugin.id}）`),
        el('div', { class: 'my-resource-meta' },
          `tabs: ${plugin.detailTabs.join(' / ')} · ext: ${plugin.fileExt.join(' ') || '—'} · manifestVersion ${plugin.manifestVersion}`,
        ),
      ),
      el('a', { class: 'btn btn-sm', href: `plugins/${encodeURIComponent(plugin.id)}/manifest.json`, target: '_blank', rel: 'noopener' }, icon('code', 13), 'manifest'),
    ));
  }
  main.append(sectionEl({ id: 'developer', title: t('开发者'), desc: t('只读调试信息：数据源、插件清单、PWA 状态。市场是纯静态站，无构建步骤。') },
    row(t('资源类型插件'), t('启动时 fetch plugins/index.json 并逐个读取 manifest.json 注册渲染器；市场不执行插件代码，只读声明。当前 {n} 个类型。', { n: plugins.length }), pluginRows),
    row(t('离线缓存（PWA）'), t('手写 Service Worker：预缓存站点外壳与数据，JSON 网络优先、静态资源缓存优先；新版本可在此手动检查。'),
      el('span', { class: 'input-inline' },
        el('button', {
          class: 'btn btn-sm', type: 'button', 'data-testid': 'check-update',
          onclick: async () => {
            const found = await checkForUpdate();
            toast(found ? t('发现新版本，顶部会显示更新提示') : t('当前已是最新版本（或离线不可检查）'), { kind: found ? 'success' : 'default' });
          },
        }, icon('refresh', 13), t('检查更新')),
        el('button', { class: 'btn btn-sm', type: 'button', 'data-testid': 'apply-update', onclick: () => applyUpdate() }, icon('download', 13), t('应用更新')),
      )),
    row(t('命令面板'), t('Ctrl+K（macOS 为 ⌘K）打开命令面板；/ 聚焦搜索框；? 打开快捷键说明。'),
      el('button', {
        class: 'btn btn-sm', type: 'button',
        onclick: () => window.dispatchEvent(new CustomEvent('market:openpalette')),
      }, icon('command', 13), t('打开命令面板'))),
    row(t('本地数据适配器'), t('P1 用 localStorage 实现；正式版整体替换为 /api，不动页面逻辑。'),
      readonlyField('MarketPoints → localStorage')),
  ));

  /* 危险区 */
  main.append(sectionEl({ id: 'danger', title: t('危险区'), desc: t('清除本机市场演示数据。不影响 catalog/ 与 data/ 下的静态文件，也不影响已下载到磁盘的课程包。') },
    el('div', { class: 'danger-zone' },
      row(t('清除本地演示数据'), t('删除本机积分、流水、收藏、我的资源、偏好、语言与主题设置（localStorage 中以 shadow.market. 开头的键）。不可撤销。'),
        el('button', {
          class: 'btn btn-danger btn-sm', type: 'button', 'data-testid': 'reset-local-data',
          onclick: async () => {
            const ok = await confirmDialog({
              title: t('清除本地演示数据？'),
              message: t('将删除本机浏览器里的积分、流水、收藏、我的资源、偏好、语言与主题设置（不会删除已下载的文件，也不影响服务器文件）。'),
              details: 'localStorage keys: shadow.market.*',
              confirmLabel: t('清除数据'),
              cancelLabel: t('取消'),
              danger: true,
            });
            if (!ok) return;
            clearLocalData();
            setLang('zh-CN');
            toast(t('已清除本地演示数据'), { kind: 'success', timeout: 4200 });
            repaint();
          },
        }, icon('trash', 14), t('清除本地演示数据'))),
    ),
  ));

  view.append(el('div', { class: 'settings-grid' }, nav, main));

  const targetId = route?.params?.section;
  if (targetId && navSections.some((s) => s.id === targetId)) {
    setActive(targetId);
    requestAnimationFrame(() => {
      const node = document.getElementById(`settings-${targetId}`);
      try { node?.scrollIntoView({ behavior: 'auto', block: 'start' }); } catch { /* ignore */ }
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
