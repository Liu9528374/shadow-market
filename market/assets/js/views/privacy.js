/** 隐私页：localStorage 键清单 / 无账号 / 数据流 / 清除方式（静态合规页） */

import { el } from '../dom.js';
import { icon } from '../icons.js';
import { pageHead, prose, proseSection, copyButton } from '../components.js';
import { PREFS_KEY } from '../prefs.js';
import { THEME_KEY } from '../theme.js';
import { LANG_KEY } from '../i18n.js';
import { POINTS_STORAGE_KEY } from '../points.js';
import { t } from '../i18n.js';

export function storageKeys() {
  return [
    { key: THEME_KEY, purpose: t('深浅色主题偏好（light / dark / system）') },
    { key: LANG_KEY, purpose: t('界面语言（zh-CN / en）') },
    { key: PREFS_KEY, purpose: t('本地提示偏好（签到提示、导入积分提示）') },
    { key: POINTS_STORAGE_KEY, purpose: t('P1 积分预览：余额 / 流水 / 收藏 / 我的资源 / 匿名设备 ID') },
    { key: 'shadow.market.fixture.v1', purpose: t('演示夹具标记（sessionStorage，关闭标签页即失效）') },
  ];
}

export function renderPrivacy(view) {
  view.replaceChildren();
  view.append(pageHead({
    title: t('隐私说明'),
    sub: t('P0 没有账号、没有后端、没有埋点。市场不收集、不上传任何用户数据。'),
    actions: [
      { label: t('关于'), href: '#/about', icon: 'info' },
      { label: t('设置 · 清除本地数据'), href: '#/settings/data', icon: 'trash' },
    ],
  }));

  view.append(prose(
    proseSection(t('本机 localStorage 键清单'),
      el('p', {}, t('这些键都只存在于你的浏览器中，不会同步到服务器；可在设置页一键清除。')),
      el('div', { class: 'key-table-wrap', tabindex: '0', role: 'region', 'aria-label': t('本机 localStorage 键清单') },
        el('table', { class: 'key-table' },
          el('thead', {}, el('tr', {}, el('th', { text: t('键') }), el('th', { text: t('用途') }), el('th', { text: t('说明') }))),
          el('tbody', {}, storageKeys().map((row) => el('tr', {},
            el('td', {}, el('code', { text: row.key })),
            el('td', { text: row.purpose }),
            el('td', { class: 'subtle', text: t('仅本机 · 不上传') }),
          ))),
        ),
      ),
      el('p', { class: 'subtle' }, t('收藏与积分演示数据使用同一份本机存储（MarketPoints 适配器）；P1 换 /api 后这些键会迁移或弃用。')),
    ),
    proseSection(t('数据流'),
      el('ul', { class: 'prose-list' },
        el('li', {}, t('浏览与下载：浏览器直接读取静态 JSON 与 .shadowcourse 文件，不经过任何用户数据接口。')),
        el('li', {}, t('一键导入：仅在点击时探测本机 SHADOW Studio（127.0.0.1），不向外网发送任何内容。')),
        el('li', {}, t('离线缓存：Service Worker 只缓存站点自身资源，不缓存用户媒体。')),
        el('li', {}, t('托管商日志：静态托管方可能保留常规访问日志，适用其隐私政策。')),
      ),
    ),
    proseSection(t('我们不做的事'),
      el('ul', { class: 'prose-list' },
        el('li', {}, t('不要求登录、不收集邮箱 / 手机号 / 实名信息。')),
        el('li', {}, t('不做行为分析、不接第三方统计、不加载第三方 CDN / 字体。')),
        el('li', {}, t('不上传、不托管、不分发任何用户媒体与学习内容。')),
        el('li', {}, t('数据默认可一键清除；P1 若引入账号会提供注销与导出。')),
      ),
    ),
    proseSection(t('清除本地数据'),
      el('p', {}, t('可在设置页「数据与隐私」一键清除所有以 shadow.market. 开头的本机键；清除后主题、语言、收藏、积分演示数据恢复默认。')),
      el('a', { class: 'btn btn-primary', href: '#/settings/data' }, icon('trash', 14), t('去清除本地数据')),
    ),
  ));
}
