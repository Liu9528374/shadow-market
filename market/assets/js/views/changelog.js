/** 更新日志（#/changelog）：站点版本 + 资源版本历史（Release 逻辑，新设计时间线） */

import { el, elFromHtml, fmtDate, fmtRelative } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { getState, siteChangelog } from '../data.js';

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

function waveArt(cls = 'empty-art') {
  return elFromHtml(`<svg class="${cls}" viewBox="0 0 200 80" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><rect x="10" y="32" width="26" height="16" rx="8"/><rect x="50" y="18" width="12" height="44" rx="6"/><rect x="76" y="4" width="12" height="72" rx="6"/><rect x="102" y="22" width="12" height="36" rx="6"/><rect x="128" y="32" width="26" height="16" rx="8"/></svg>`);
}

function emptyBlock({ title, desc, actions = [] }) {
  return el('div', { class: 'card empty-inline', 'data-testid': 'empty-state' },
    el('div', { class: 'empty' },
      waveArt(),
      el('span', { class: 'empty-title', text: title }),
      el('span', { class: 'empty-text', text: desc }),
      actions.length ? el('div', { class: 'static-links' }, actions) : null,
    ),
  );
}

export function renderChangelog(view) {
  const state = getState();
  view.replaceChildren();

  view.append(pageHead({
    eyebrow: t('RELEASES · 版本变更'),
    title: t('更新日志'),
    lead: t('站点与资源的版本变更记录。资源版本以目录中的 versions[] 为准。'),
    actions: [
      el('a', { class: 'btn btn-secondary btn-sm', href: '#/market' }, icon('compass', 14), t('去市场')),
      el('a', { class: 'btn btn-ghost btn-sm', href: '#/contribute' }, icon('book-open', 14), t('投稿指南')),
    ],
  }));

  const layout = el('div', { class: 'changelog-layout' });

  /* 站点版本 */
  const siteSection = el('section', { class: 'changelog-section', 'data-testid': 'changelog-site' },
    el('div', { class: 'section-head' },
      el('div', {},
        el('h2', { class: 'section-title' }, icon('rotate', 16), t('站点版本')),
        el('p', { class: 'section-sub' }, t('静态站构建与合并的版本记录。')),
      ),
    ),
  );
  const siteRows = siteChangelog();
  if (siteRows.length === 0) {
    siteSection.append(el('p', { class: 'muted', text: t('暂无站点版本记录。') }));
  } else {
    const timeline = el('div', { class: 'timeline' });
    for (const row of siteRows) {
      timeline.append(el('div', { class: 'timeline-item' },
        el('div', { class: 'timeline-body' },
          el('div', { class: 'timeline-version-head' },
            el('span', { class: 'version-tag' }, icon('tag', 11), row.version),
            el('span', { class: 'muted', text: `${fmtDate(row.date)}${row.date ? ' · ' + fmtRelative(row.date) : ''}` }),
          ),
          el('ul', { class: 'version-changes' }, row.changes.map((line) => el('li', { text: line }))),
        ),
      ));
    }
    siteSection.append(timeline);
  }
  layout.append(siteSection);

  /* 资源版本 */
  const resSection = el('section', { class: 'changelog-section', 'data-testid': 'changelog-resources' },
    el('div', { class: 'section-head' },
      el('div', {},
        el('h2', { class: 'section-title' }, icon('file-text', 16), t('资源版本')),
        el('p', { class: 'section-sub' }, t('按更新时间排序；每个资源展示最新版本的 changelog。')),
      ),
    ),
  );
  const resources = (state.catalog?.resources || []).slice()
    .filter((r) => (r.versions || []).length)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if (resources.length === 0) {
    resSection.append(emptyBlock({
      title: t('暂无资源版本记录'),
      desc: t('资源上架或更新后，这里会显示版本与变更。'),
      actions: [el('a', { class: 'btn btn-primary', href: '#/market' }, icon('compass', 14), t('浏览全部资源'))],
    }));
  } else {
    const timeline = el('div', { class: 'timeline' });
    for (const resource of resources) {
      const version = resource.versions[0] || {};
      const changes = Array.isArray(version.changelog) && version.changelog.length
        ? version.changelog
        : [t('首个发布版本')];
      timeline.append(el('div', { class: 'timeline-item', 'data-testid': 'changelog-resource-row' },
        el('div', { class: 'timeline-body' },
          el('div', { class: 'timeline-version-head' },
            el('span', { class: 'version-tag' }, icon('tag', 11), `v${version.version || '—'}`),
            el('a', { class: 'timeline-title', href: `#/resource/${encodeURIComponent(resource.id)}` }, resource.title),
            version.publishedAt ? el('span', { class: 'muted', text: fmtDate(version.publishedAt) }) : null,
          ),
          el('ul', { class: 'version-changes' }, changes.map((line) => el('li', { text: line }))),
        ),
      ));
    }
    resSection.append(timeline);
  }
  layout.append(resSection);

  view.append(layout);
  view.append(el('p', { class: 'footer-note' },
    el('span', { text: t('目录生成于 {d}', { d: state.catalog?.generatedAt ? fmtDate(state.catalog.generatedAt) : '—' }) }),
    el('span', { text: state.schemaVersion === 2 ? 'catalog/*.json · schemaVersion 2' : 'data/catalog.json · schemaVersion 1' }),
    el('a', { class: 'text-link', href: '#/market' }, t('浏览资源')),
  ));
}
