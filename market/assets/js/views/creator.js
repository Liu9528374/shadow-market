/** 作者主页：头像 / 简介 / 资源列表 / 许可声明（GitHub profile 式信息层级） */

import { el, fmtNum, fmtDate } from '../dom.js';
import { icon } from '../icons.js';
import { getState, authorByHandle, sortResources } from '../data.js';
import { avatar, pageHead, resourceCard, emptyState, tagLinks } from '../components.js';
import { t, pickLang } from '../i18n.js';

export function renderCreator(view, route) {
  const state = getState();
  const handle = route.params.handle;
  const author = authorByHandle(handle);
  view.replaceChildren();
  if (!state.catalog) return;

  if (!author) {
    view.append(pageHead({
      title: t('找不到这位作者'),
      sub: t('目录里没有 handle 为 “{handle}” 的创作者。', { handle }),
      actions: [{ label: t('回到探索'), href: '#/', icon: 'compass' }],
    }), emptyState({
      iconName: 'user',
      title: t('作者不存在'),
      desc: t('可能链接过期，或创作者已从目录移除。市场 P0 的创作者信息由 catalog/authors.json 声明。'),
      actions: [{ label: t('浏览全部资源'), href: '#/', kind: 'primary', icon: 'compass' }],
    }));
    return;
  }

  const resources = sortResources(state.catalog.resources.filter((r) => r.author === author.handle), 'updated');
  const totalSentences = resources.reduce((sum, r) => sum + (r.stats?.sentences || 0), 0);
  const freeCount = resources.filter((r) => r.free !== false).length;
  const isOfficial = author.handle === 'shadow-studio';
  const tags = new Set();
  for (const r of resources) for (const tag of r.tags) tags.add(tag);

  const head = el('header', { class: 'creator-head', 'data-testid': 'creator-head' },
    avatar(author, 'xl'),
    el('div', { class: 'creator-body' },
      el('h1', { class: 'creator-name' },
        author.name,
        isOfficial ? el('span', { class: 'badge badge-official' }, icon('check', 11), t('官方示例')) : null,
      ),
      el('div', { class: 'creator-handle', text: `@${author.handle}` }),
      (author.bio ? el('p', { class: 'creator-bio', text: author.bio }) : null),
      el('div', { class: 'creator-stats' },
        el('span', { class: 'creator-stat' }, el('b', { text: String(resources.length) }), ` ${t('个资源')}`),
        el('span', { class: 'creator-stat' }, el('b', { text: String(freeCount) }), ` ${t('个全免费')}`),
        el('span', { class: 'creator-stat' }, el('b', { text: fmtNum(totalSentences) }), ` ${t('句课程内容')}`),
      ),
      el('div', { class: 'creator-meta' },
        el('span', {}, icon('database', 12), ` ${t('创作者信息来自 catalog/authors.json')}`),
        el('span', {}, icon('shield', 12), ` ${t('P0 全免费：不抽成、不设付费墙')}`),
        author.url ? el('a', { href: author.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, icon('link', 12), ` ${t('主页')}`) : null,
        author.licenseDefault ? el('span', {}, icon('scale', 12), ` ${t('默认许可')} ${author.licenseDefault}`) : null,
      ),
    ),
  );

  const tagsRow = tags.size ? el('div', { class: 'creator-tags' }, tagLinks(Array.from(tags).slice(0, 12), { limit: 12 })) : null;

  const headRow = el('div', { class: 'list-toolbar' },
    el('span', { class: 'toolbar-count', 'aria-live': 'polite' }, t('共 {n} 个资源', { n: resources.length })),
    el('span', { class: 'toolbar-spacer' }),
    el('a', { class: 'btn btn-sm', href: `#/search?q=${encodeURIComponent(author.name)}` }, icon('search', 13), t('按作者搜索')),
  );

  const list = el('div', { class: 'res-list', role: 'list', 'aria-label': t('资源列表'), 'data-testid': 'creator-resource-list' });
  if (resources.length === 0) {
    list.append(emptyState({
      iconName: 'book',
      title: t('这位作者还没有公开资源'),
      desc: t('创作者资源由 catalog 声明；P0 静态站没有上传入口。'),
      actions: [{ label: t('浏览全部资源'), href: '#/', kind: 'primary', icon: 'compass' }],
    }));
  } else {
    for (const resource of resources) list.append(resourceCard(resource));
  }

  const licenseNote = el('div', { class: 'notice', style: { marginTop: '16px' } },
    icon('scale', 16, 'notice-icon'),
    el('div', {}, t('该作者资源的许可与权利依据以每个资源详情页为准；如发现版权问题可通过'), ' ', el('a', { href: '#/complaint' }, t('版权投诉')), ' ', t('联系我们。')),
  );

  view.append(head, tagsRow, el('div', { style: { height: '20px' } }), headRow, list, licenseNote);
}
