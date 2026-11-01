/** 关于页（#/about）：产品定位 / 两个产品边界 / 使命 / 技术说明（静态合规页） */

import { el } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { getState } from '../data.js';

const APP_VERSION = 'market-p0.2';

function pageHead({ eyebrow, title, lead, actions = [] }) {
  return el('div', { class: 'page-head-row' },
    el('section', { class: 'page-head' },
      eyebrow ? el('span', { class: 'eyebrow', text: eyebrow }) : null,
      el('h1', { text: title }),
      lead ? el('p', { class: 'lead', text: lead }) : null,
    ),
    actions.length ? el('div', { class: 'page-actions' }, actions) : null,
  );
}

function section(title, num, ...children) {
  return el('section', {},
    el('h2', {}, num ? el('span', { class: 'sec-num', text: num }) : null, title),
    ...children,
  );
}

function bullets(...items) {
  return el('ul', { class: 'bullets' }, items.map((text) => el('li', {}, text)));
}

export function renderAbout(view) {
  const state = getState();
  view.replaceChildren();

  view.append(pageHead({
    eyebrow: t('ABOUT · 两产品边界'),
    title: t('关于 SHADOW 市场'),
    lead: t('全免费的影子跟读课程资源站：浏览、搜索、下载课程包，一键导入 SHADOW Studio。'),
    actions: [
      el('a', { class: 'btn btn-secondary btn-sm', href: '#/contribute' }, icon('book-open', 14), t('投稿指南')),
      el('a', { class: 'btn btn-ghost btn-sm', href: '#/privacy' }, icon('shield', 14), t('隐私说明')),
    ],
  }));

  view.append(el('div', { class: 'prose' },
    section(t('两个产品，一条薄接口'), '',
      el('p', {}, t('市场是独立 Web 产品：只读静态数据、无账号、无支付、无 DRM；桌面端只保留「导入课程包」这一薄接口。')),
      el('p', {}, t('市场与 SHADOW Studio 是两个独立产品：市场是 Web 端资源入口，桌面端只保留「导入课程包」薄接口。')),
    ),
    section(t('全免费，不含隐藏收费'), '',
      el('p', {}, t('P0 的积分只是兑换凭证（免费获取、不可购买 / 提现 / 转让），资源本身全免费。')),
    ),
    section(t('BYOM：不托管媒体'), '',
      el('p', {}, t('课程包只含文本、时间轴、翻译与练习配置；影视媒体由用户自备，市场不托管、不上传、不分发。')),
    ),
    section(t('本地优先'), '',
      el('p', {}, t('无需账号即可浏览、下载、导入。所有偏好与收藏只保存在本机浏览器。')),
      bullets(
        t('无账号、无后端、无埋点、无第三方 CDN / 字体 / 分析。'),
        t('可安装为 PWA，离线浏览已缓存的列表与详情。'),
        t('一键导入只在点击时探测本机 SHADOW Studio（127.0.0.1），不上传数据。'),
      ),
    ),
    section(t('技术说明'), '',
      el('p', {}, t('纯静态站 · 零构建 · 原生 ES Modules · 无第三方 CDN / 分析 / 字体 · 手写 Service Worker 支持离线。')),
      el('p', { class: 'hint' }, `${t('版本')} ${APP_VERSION} · ${t('数据源')}：${state.catalog ? (state.schemaVersion === 2 ? 'catalog/ (schemaVersion 2)' : 'data/catalog.json (schemaVersion 1 兼容层)') : '—'}`),
      el('div', { class: 'static-links' },
        el('a', { class: 'btn btn-ghost btn-sm', href: 'plugins/index.json' }, icon('layers', 13), t('插件清单（JSON）')),
        el('a', { class: 'btn btn-ghost btn-sm', href: 'catalog/resources.json' }, icon('file-text', 13), t('资源目录（JSON）')),
        el('a', { class: 'btn btn-ghost btn-sm', href: '#/changelog' }, icon('rotate', 13), t('更新日志')),
      ),
    ),
    section(t('未成年人提示'), '',
      el('p', {}, t('建议 18+ 或征得监护人同意后使用；市场不做社交、排行榜与付费内容。')),
    ),
  ));

  view.append(el('p', { class: 'footer-note' },
    el('span', { text: t('SHADOW 市场 · P0 静态版') }),
    el('span', { text: t('全免费 · BYOM · 本地优先') }),
    el('a', { class: 'text-link', href: '#/contribute' }, t('投稿指南')),
    el('a', { class: 'text-link', href: '#/complaint' }, t('版权与投诉')),
  ));
}
