/** 404 页（未知路由 / 未知资源 / 未知作者共用的 GitHub 式 404） */

import { el } from '../dom.js';
import { icon } from '../icons.js';

export function renderNotFound(view, route) {
  const raw = String(route?.raw || '');
  view.replaceChildren(el('div', { class: 'notfound', 'data-testid': 'not-found' },
    el('div', { class: 'notfound-code', 'aria-hidden': 'true', text: '404' }),
    el('h1', { class: 'notfound-title', text: '这里没有你要找的页面' }),
    el('p', { class: 'notfound-desc' },
      'SHADOW 市场是 hash 路由的纯静态站。',
      raw ? [' 无法识别 ', el('code', { text: `#/${raw}` }), '。'].join('') : '',
      ' 可能链接写错了，或资源已从目录中移除。',
    ),
    el('div', { class: 'notfound-actions' },
      el('a', { class: 'btn btn-primary', href: '#/' }, icon('compass', 14), '回到探索'),
      el('a', { class: 'btn', href: '#/search?q=' }, icon('search', 14), '搜索资源'),
      el('a', { class: 'btn', href: '#/import' }, icon('upload', 14), '一键导入说明'),
    ),
    el('div', { class: 'notfound-links' },
      '常用入口：',
      el('a', { href: '#/points' }, '积分（P1 本地演示）'),
      el('a', { href: '#/settings' }, '设置'),
      el('a', { href: '#/creator/shadow-studio' }, '官方作者'),
    ),
  ));
}
