/** 更新日志：站点版本 + 资源版本历史（Release 逻辑） */

import { el, fmtDate, fmtRelative } from '../dom.js';
import { icon } from '../icons.js';
import { pageHead, emptyState, asideCard, asideRow } from '../components.js';
import { getState, siteChangelog } from '../data.js';
import { t, pickLang } from '../i18n.js';

export function renderChangelog(view) {
  const state = getState();
  view.replaceChildren();
  view.append(pageHead({
    title: t('更新日志'),
    sub: t('站点与资源的版本变更记录。资源版本以目录中的 versions[] 为准。'),
    actions: [
      { label: t('探索'), href: '#/', icon: 'compass' },
      { label: t('投稿指南'), href: '#/contribute', icon: 'book' },
    ],
  }));

  const main = el('div', { class: 'changelog-main' });

  // 站点版本
  const siteSection = el('section', { class: 'changelog-section', 'data-testid': 'changelog-site' },
    el('h2', { class: 'section-title' }, icon('versions', 16, 'section-icon'), t('站点版本')),
  );
  const siteRows = siteChangelog();
  if (siteRows.length === 0) {
    siteSection.append(el('p', { class: 'muted', text: t('暂无站点版本记录。') }));
  } else {
    const timeline = el('div', { class: 'timeline' });
    for (const row of siteRows) {
      timeline.append(el('div', { class: 'timeline-item' },
        el('div', { class: 'timeline-dot', 'aria-hidden': 'true' }),
        el('div', { class: 'timeline-body' },
          el('div', { class: 'timeline-head' },
            el('span', { class: 'version-tag' }, icon('tag', 11), row.version),
            el('span', { class: 'subtle', text: `${fmtDate(row.date)}${row.date ? ` · ${fmtRelative(row.date)}` : ''}` }),
          ),
          el('ul', { class: 'version-changes' }, row.changes.map((line) => el('li', { text: line }))),
        ),
      ));
    }
    siteSection.append(timeline);
  }
  main.append(siteSection);

  // 资源版本
  const resSection = el('section', { class: 'changelog-section', 'data-testid': 'changelog-resources' },
    el('h2', { class: 'section-title' }, icon('history', 16, 'section-icon'), t('资源版本')),
  );
  const resources = (state.catalog?.resources || []).slice().filter((r) => (r.versions || []).length).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if (resources.length === 0) {
    resSection.append(emptyState({
      iconName: 'history',
      title: t('暂无资源版本记录。'),
      desc: t('资源上架或更新后，这里会显示版本与变更。'),
      actions: [{ label: t('浏览全部资源'), href: '#/', kind: 'primary', icon: 'compass' }],
    }));
  } else {
    const timeline = el('div', { class: 'timeline' });
    for (const resource of resources) {
      const version = resource.versions[0] || {};
      const changes = Array.isArray(version.changelog) && version.changelog.length
        ? version.changelog
        : [t('首个发布版本')];
      timeline.append(el('div', { class: 'timeline-item', 'data-testid': 'changelog-resource-row' },
        el('div', { class: 'timeline-dot', 'aria-hidden': 'true' }),
        el('div', { class: 'timeline-body' },
          el('div', { class: 'timeline-head' },
            el('span', { class: 'version-tag' }, icon('tag', 11), `v${version.version || '—'}`),
            el('a', { class: 'timeline-resource', href: `#/resource/${encodeURIComponent(resource.id)}` }, resource.title),
            version.publishedAt ? el('span', { class: 'subtle', text: fmtDate(version.publishedAt) }) : null,
          ),
          el('ul', { class: 'version-changes' }, changes.map((line) => el('li', { text: line }))),
        ),
      ));
    }
    resSection.append(timeline);
  }
  main.append(resSection);

  const aside = el('aside', { class: 'changelog-aside' },
    asideCard(t('发布信息'),
      asideRow(t('目录生成时间'), state.catalog?.generatedAt ? fmtDate(state.catalog.generatedAt) : '—'),
      asideRow(t('数据契约'), state.schemaVersion === 2 ? 'schemaVersion 2' : 'schemaVersion 1（兼容层）'),
      asideRow(t('数据源'), state.schemaVersion === 2 ? 'catalog/*.json' : 'data/catalog.json'),
      asideRow(t('资源总数'), String(state.catalog?.resources?.length || 0)),
    ),
    asideCard(t('版本说明'),
      el('p', { class: 'aside-desc', text: t('P0 静态目录每个资源只发布 1 个版本；多版本与回滚是后续能力。') }),
      el('p', { class: 'aside-desc' }, t('版本号遵循 semver；发布后包 id 不变。'), ' ',
        el('a', { href: '#/import' }, t('导入说明'))),
    ),
  );

  view.append(el('div', { class: 'changelog-grid' }, main, aside));
}
