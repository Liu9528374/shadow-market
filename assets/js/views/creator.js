/** 作者主页：头像 / 简介 / 资源列表（GitHub profile 式信息层级） */

import { el, fmtNum, fmtDate } from '../dom.js';
import { icon } from '../icons.js';
import { getState, creatorByHandle, sortResources } from '../data.js';
import { avatar, pageHead, resourceCard, emptyState } from '../components.js';

export function renderCreator(view, route) {
  const state = getState();
  const handle = route.params.handle;
  const creator = creatorByHandle(handle);
  view.replaceChildren();
  if (!state.catalog) return;

  if (!creator) {
    view.append(pageHead({ title: '找不到这位作者', sub: `目录里没有 handle 为 “${handle}” 的创作者。`, actions: [{ label: '回到探索', href: '#/', icon: 'compass' }] }),
      emptyState({
        iconName: 'user',
        title: '作者不存在',
        desc: '可能链接过期，或创作者已从 catalog.json 移除。市场 P0 的创作者信息由资源目录声明。',
        actions: [{ label: '浏览全部资源', href: '#/', kind: 'primary', icon: 'compass' }],
      }));
    return;
  }

  const resources = sortResources(state.catalog.resources.filter((r) => r.creator === creator.handle), 'updated');
  const totalSentences = resources.reduce((sum, r) => sum + (r.stats?.sentences || 0), 0);
  const freeCount = resources.filter((r) => r.points === 0).length;
  const isOfficial = creator.handle === 'shadow-studio';

  const head = el('header', { class: 'creator-head', 'data-testid': 'creator-head' },
    avatar(creator, 'xl'),
    el('div', { class: 'creator-body' },
      el('h1', { class: 'creator-name' },
        creator.name,
        isOfficial ? el('span', { class: 'badge badge-official' }, icon('check', 11), '官方示例') : null,
      ),
      el('div', { class: 'creator-handle', text: `@${creator.handle}` }),
      creator.bio ? el('p', { class: 'creator-bio', text: creator.bio }) : null,
      el('div', { class: 'creator-stats' },
        el('span', { class: 'creator-stat' }, el('b', { text: String(resources.length) }), ' 个资源'),
        el('span', { class: 'creator-stat' }, el('b', { text: String(freeCount) }), ' 个全免费'),
        el('span', { class: 'creator-stat' }, el('b', { text: fmtNum(totalSentences) }), ' 句课程内容'),
      ),
      el('div', { class: 'creator-meta' },
        el('span', {}, icon('database', 12), ' 创作者信息来自 data/catalog.json 的 creators'),
        el('span', {}, icon('shield', 12), ' P0 全免费：不抽成、不设付费墙'),
      ),
    ),
  );

  const headRow = el('div', { class: 'list-toolbar' },
    el('span', { class: 'toolbar-count' }, '共 ', el('strong', { text: String(resources.length) }), ' 个资源'),
    el('span', { class: 'toolbar-spacer' }),
    el('a', { class: 'btn btn-sm', href: `#/search?q=${encodeURIComponent(creator.name)}` }, icon('search', 13), '按作者搜索'),
  );

  const list = el('div', { class: 'res-list', 'data-testid': 'creator-resource-list' });
  if (resources.length === 0) {
    list.append(emptyState({
      iconName: 'book',
      title: '这位作者还没有公开资源',
      desc: '创作者资源由 catalog.json 声明；P0 静态站没有上传入口。',
      actions: [{ label: '浏览全部资源', href: '#/', kind: 'primary', icon: 'compass' }],
    }));
  } else {
    for (const resource of resources) list.append(resourceCard(resource));
  }

  view.append(head, el('div', { style: { height: '20px' } }), headRow, list);
}
