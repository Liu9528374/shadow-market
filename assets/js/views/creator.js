/** 作者主页（#/creator/<handle>）：Hero + 统计 + 资源网格 + 许可声明 */

import { el, fmtNum, initials } from '../dom.js';
import { icon } from '../icons.js';
import { t, pickLang } from '../i18n.js';
import { getState, authorByHandle, sortResources } from '../data.js';
import { resourceCard } from '../components.js';

function breadcrumb(items) {
  const nav = el('nav', { class: 'breadcrumb', 'aria-label': t('面包屑') });
  items.forEach((item, i) => {
    if (i > 0) nav.append(el('span', { class: 'sep', 'aria-hidden': 'true', text: '/' }));
    if (item.href) nav.append(el('a', { href: item.href }, item.label));
    else nav.append(el('span', { class: 'current', 'aria-current': 'page' }, item.label));
  });
  return nav;
}

function emptyBlock({ title, desc, actions = [] }) {
  return el('div', { class: 'card empty-inline', 'data-testid': 'empty-state' },
    el('div', { class: 'empty' },
      el('span', { class: 'empty-title', text: title }),
      el('span', { class: 'empty-text', text: desc }),
      actions.length ? el('div', { class: 'static-links' }, actions) : null,
    ),
  );
}

export function renderCreator(view, route) {
  const state = getState();
  const handle = route?.params?.handle;
  const author = authorByHandle(handle);
  view.replaceChildren();
  if (!state.catalog) return;

  if (!author) {
    view.append(breadcrumb([{ label: t('市场'), href: '#/market' }, { label: t('作者') }]));
    view.append(el('div', { class: 'page-head' },
      el('span', { class: 'eyebrow', text: t('CREATOR · 作者') }),
      el('h1', { text: t('找不到这位作者') }),
      el('p', { class: 'lead', text: t('目录里没有 handle 为 “{handle}” 的创作者。', { handle: handle || '—' }) }),
    ));
    view.append(emptyBlock({
      title: t('作者不存在'),
      desc: t('可能链接过期，或创作者已从目录移除。市场 P0 的创作者信息由 catalog/authors.json 声明。'),
      actions: [el('a', { class: 'btn btn-primary', href: '#/market' }, icon('compass', 14), t('浏览全部资源'))],
    }));
    return;
  }

  const resources = sortResources(state.catalog.resources.filter((r) => r.author === author.handle), 'updated');
  const totalSentences = resources.reduce((sum, r) => sum + (r.stats?.sentences || 0), 0);
  const freeCount = resources.filter((r) => r.free !== false).length;
  const isOfficial = author.handle === 'shadow-studio';
  const tagSet = new Set();
  for (const r of resources) for (const tag of r.tags || []) tagSet.add(tag);

  view.append(breadcrumb([{ label: t('市场'), href: '#/market' }, { label: author.name }]));

  const avatar = el('div', {
    class: 'avatar avatar-lg',
    style: {
      width: '72px', height: '72px', borderRadius: '20px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '24px', fontWeight: '650',
      background: 'var(--amber-soft)', color: 'var(--amber-text)',
      border: '1px solid var(--amber-line)',
    },
    'aria-hidden': 'true',
  }, initials(author.name || author.handle));

  const head = el('header', { class: 'profile-hero creator-head', 'data-testid': 'creator-head' },
    avatar,
    el('div', { class: 'profile-name' },
      el('h1', { class: 'name', style: { fontSize: 'var(--fs-h1)' } },
        author.name,
        isOfficial ? el('span', { class: 'badge badge-soft', style: { marginLeft: '10px', verticalAlign: 'middle' } }, icon('check', 11), t('官方作者')) : null,
      ),
      el('span', { class: 'meta' }, `@${author.handle}`),
      (author.bio ? el('p', { class: 'creator-bio', text: author.bio }) : null),
      el('div', { class: 'creator-stats' },
        el('span', {}, el('b', { text: String(resources.length) }), ` ${t('个资源')}`),
        el('span', {}, el('b', { text: String(freeCount) }), ` ${t('个全免费')}`),
        el('span', {}, el('b', { text: fmtNum(totalSentences) }), ` ${t('句课程内容')}`),
      ),
      el('div', { class: 'creator-meta' },
        el('span', {}, icon('layers', 13), ` ${t('创作者信息来自 catalog/authors.json')}`),
        el('span', {}, icon('shield', 13), ` ${t('P0 全免费：不抽成、不设付费墙')}`),
        author.url ? el('a', { href: author.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, icon('link', 13), ` ${t('主页')}`) : null,
        author.licenseDefault ? el('span', {}, icon('shield', 13), ` ${t('默认许可')} ${author.licenseDefault}`) : null,
      ),
    ),
  );

  const tagsRow = tagSet.size
    ? el('div', { class: 'creator-tags' }, Array.from(tagSet).slice(0, 12).map((tag) =>
      el('a', { class: 'chip', href: `#/tag/${encodeURIComponent(tag)}` }, tag)))
    : null;

  const toolbar = el('div', { class: 'creator-toolbar' },
    el('span', { class: 'toolbar-count', 'aria-live': 'polite' }, t('共 {n} 个资源', { n: resources.length })),
    el('a', { class: 'btn btn-secondary btn-sm', href: `#/search?q=${encodeURIComponent(author.name)}` }, icon('search', 13), t('按作者搜索')),
  );

  const grid = el('div', { class: 'res-grid', role: 'list', 'aria-label': t('资源列表'), 'data-testid': 'creator-resource-list' });
  if (resources.length === 0) {
    grid.append(emptyBlock({
      title: t('这位作者还没有公开资源'),
      desc: t('创作者资源由 catalog 声明；P0 静态站没有上传入口。'),
      actions: [el('a', { class: 'btn btn-primary', href: '#/market' }, icon('compass', 14), t('浏览全部资源'))],
    }));
  } else {
    for (const resource of resources) grid.append(resourceCard(resource));
  }

  view.append(el('div', { class: 'creator-view' },
    head,
    tagsRow,
    toolbar,
    grid,
    el('div', { class: 'notice' },
      el('span', { class: 'dot', 'aria-hidden': 'true' }),
      el('span', {}, t('该作者资源的许可与权利依据以每个资源详情页为准；如发现版权问题可通过'), ' ', el('a', { class: 'text-link', href: '#/complaint' }, t('版权投诉')), ' ', t('联系我们。')),
    ),
  ));
}

