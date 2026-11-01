/** 许可证页（#/resource/<id>/license 或 #/license/<id>）：许可全文 / 权利依据 / 免责声明 */

import { el, fmtDate } from '../dom.js';
import { icon } from '../icons.js';
import { t, pickLang } from '../i18n.js';
import { getState, resourceById, licenseById } from '../data.js';

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

function asideCard(title, ...rows) {
  return el('div', { class: 'card', style: { padding: '18px 20px' } },
    el('p', { class: 'rail-title', text: title }),
    ...rows,
  );
}

export function renderLicense(view, route) {
  const state = getState();
  const id = route?.params?.id;
  const resource = resourceById(id);
  view.replaceChildren();

  if (!resource) {
    view.append(el('div', { class: 'page-head' },
      el('span', { class: 'eyebrow', text: t('LICENSE · 许可') }),
      el('h1', { text: t('找不到这个资源') }),
      el('p', { class: 'lead', text: t('资源 id {id} 不在当前目录中。', { id: id || '—' }) }),
    ));
    view.append(emptyBlock({
      title: t('许可信息不可用'),
      desc: t('可能资源已下架，或链接来自其它版本的市场。'),
      actions: [el('a', { class: 'btn btn-primary', href: '#/market' }, icon('compass', 14), t('浏览全部资源'))],
    }));
    return;
  }

  const license = licenseById(resource.license);
  const name = license?.name || resource.license || t('未声明');
  const rights = resource.rights && typeof resource.rights === 'object' ? resource.rights : {};
  const version = resource.versions?.[0] || {};
  const basisLabel = rights.basis === 'own' ? t('自有')
    : rights.basis === 'licensed' ? t('书面授权')
      : rights.basis === 'public-domain' ? t('公共领域')
        : rights.basis === 'cc' ? t('CC 许可')
          : (rights.basis || '—');
  const authorName = resource.authorName || resource.author || '—';

  view.append(breadcrumb([
    { label: t('市场'), href: '#/market' },
    { label: resource.title, href: `#/resource/${encodeURIComponent(resource.id)}` },
    { label: t('许可证') },
  ]));

  view.append(el('div', { class: 'page-head-row' },
    el('section', { class: 'page-head' },
      el('span', { class: 'eyebrow', text: t('LICENSE · 许可') }),
      el('h1', { text: `${t('许可证')} · ${name}` }),
      el('p', { class: 'lead', text: t('每个资源都必须展示许可标识、权利依据与免责声明。') }),
    ),
    el('div', { class: 'page-actions' },
      el('a', { class: 'btn btn-secondary btn-sm', href: `#/resource/${encodeURIComponent(resource.id)}` }, icon('arrow-left', 14), t('返回资源详情')),
    ),
  ));

  const main = el('div', { class: 'license-main' },
    el('div', { class: 'prose' },
      el('section', {},
        el('h2', {}, el('span', { class: 'sec-num', text: '01' }), t('许可标识')),
        el('div', { class: 'license-badge-row' },
          el('span', { class: 'badge badge-soft' }, icon('shield', 12), name),
          license?.url ? el('a', { class: 'btn btn-secondary btn-sm', href: license.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, icon('external-link', 13), t('许可原文')) : null,
        ),
        el('p', {}, `${t('许可 ID')}：`, el('code', { text: resource.license || '—' })),
        el('p', {}, `${t('权利依据')}：`, el('strong', { text: basisLabel })),
        rights.note ? el('p', {}, `${t('说明')}：${rights.note}`) : null,
        rights.evidenceUrl
          ? el('p', {}, `${t('证据链接')}：`, el('a', { class: 'text-link', href: rights.evidenceUrl, target: '_blank', rel: 'noopener noreferrer nofollow' }, rights.evidenceUrl))
          : null,
      ),
      el('section', {},
        el('h2', {}, el('span', { class: 'sec-num', text: '02' }), t('许可全文')),
        license?.fullText
          ? el('div', { class: 'codeblock' },
            el('div', { class: 'codeblock-head' }, el('span', { text: name }), el('span', { text: resource.license || '' })),
            el('pre', { class: 'license-fulltext' }, license.fullText),
          )
          : el('p', { class: 'muted', text: t('该许可的全文以外部链接为准；市场记录其标识与用途说明。') }),
        license?.rightsNotes ? el('p', {}, license.rightsNotes) : null,
      ),
      el('section', {},
        el('h2', {}, el('span', { class: 'sec-num', text: '03' }), t('资源内容')),
        el('ul', { class: 'bullets' },
          el('li', {}, `${t('标题')}：${resource.title}`),
          el('li', {}, `${t('作者')}：${authorName}`),
          el('li', {}, `${t('版本')}：v${version.version || '—'}`),
          el('li', {}, `${t('发布')}：${fmtDate(version.publishedAt) || '—'}`),
          el('li', {}, `${t('媒体策略')}：BYOM · ${t('包内不含媒体')}`),
        ),
      ),
      el('section', {},
        el('h2', {}, el('span', { class: 'sec-num', text: '04' }), t('免责声明')),
        el('div', { class: 'quote' },
          el('span', { class: 'quote-label' }, icon('info', 14), t('免责声明')),
          el('p', { text: t('市场仅提供索引与下载，不托管影视媒体。用户自备媒体的版权由用户自行负责；如发现侵权请通过版权投诉渠道联系。') }),
        ),
        el('div', { class: 'static-links' },
          el('a', { class: 'btn btn-secondary btn-sm', href: '#/complaint' }, icon('mail', 14), t('版权与投诉')),
          el('a', { class: 'btn btn-ghost btn-sm', href: '#/privacy' }, icon('shield', 14), t('隐私说明')),
        ),
      ),
    ),
  );

  const aside = el('aside', { class: 'license-aside' },
    asideCard(t('许可信息'),
      el('div', { class: 'list' },
        el('div', { class: 'list-row', style: { padding: '8px 0' } },
          el('span', { class: 'list-sub', text: t('许可') }), el('span', { class: 'mono', style: { marginLeft: 'auto' }, text: resource.license || '—' })),
        el('div', { class: 'list-row', style: { padding: '8px 0' } },
          el('span', { class: 'list-sub', text: t('权利依据') }), el('span', { style: { marginLeft: 'auto' }, text: basisLabel })),
        el('div', { class: 'list-row', style: { padding: '8px 0' } },
          el('span', { class: 'list-sub', text: t('作者') }), el('span', { style: { marginLeft: 'auto' }, text: authorName })),
        el('div', { class: 'list-row', style: { padding: '8px 0' } },
          el('span', { class: 'list-sub', text: t('资源类型') }), el('span', { style: { marginLeft: 'auto' }, text: resource.type })),
      ),
    ),
    asideCard(t('相关链接'),
      el('div', { class: 'static-links', style: { flexDirection: 'column', alignItems: 'flex-start' } },
        el('a', { class: 'section-link', href: `#/resource/${encodeURIComponent(resource.id)}` }, icon('arrow-left', 14), t('返回资源详情')),
        el('a', { class: 'section-link', href: '#/contribute' }, icon('book-open', 14), t('投稿指南')),
        el('a', { class: 'section-link', href: '#/about' }, icon('info', 14), t('关于 SHADOW 市场')),
      ),
    ),
  );

  view.append(el('div', { class: 'license-layout' }, main, aside));
}
