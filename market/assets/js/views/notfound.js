/** 404 页（未知路由 / 未知资源 / 未知作者共用） */

import { el } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';

export function renderNotFound(view, route) {
  const raw = String(route?.raw || '');
  view.replaceChildren(el('div', { class: 'notfound', 'data-testid': 'not-found' },
    el('div', { class: 'notfound-code', 'aria-hidden': 'true', text: '404' }),
    el('h1', { class: 'notfound-title', text: t('这里没有你要找的页面') }),
    el('p', { class: 'notfound-desc' },
      t('SHADOW 市场是 hash 路由的纯静态站。'),
      raw ? el('span', {}, ` ${t('无法识别')} `, el('code', { text: `#/${raw}` }), '。') : '',
      ` ${t('可能链接写错了，或资源已从目录中移除。')}`,
    ),
    el('div', { class: 'notfound-actions' },
      el('a', { class: 'btn btn-primary', href: '#/' }, icon('home', 14), t('回到工作台')),
      el('a', { class: 'btn btn-secondary', href: '#/market' }, icon('compass', 14), t('去市场逛逛')),
      el('a', { class: 'btn btn-ghost', href: '#/import' }, icon('upload', 14), t('导入说明')),
    ),
    el('div', { class: 'notfound-links' },
      `${t('常用入口：')}`,
      el('a', { href: '#/favorites' }, t('我的收藏')),
      el('a', { href: '#/points' }, t('积分')),
      el('a', { href: '#/settings' }, t('设置')),
      el('a', { href: '#/about' }, t('关于')),
      el('a', { href: '#/creator/shadow-studio' }, t('官方作者')),
    ),
  ));
}
