/** 许可证页：#/resource/<id>/license（也接受 #/license/<id>）——许可全文 / 权利依据 / 免责声明 */

import { el, fmtDate } from '../dom.js';
import { icon } from '../icons.js';
import { pageHead, prose, proseSection, asideCard, asideRow, breadcrumb, emptyState } from '../components.js';
import { getState, resourceById, licenseById } from '../data.js';
import { t } from '../i18n.js';

export function renderLicense(view, route) {
  const state = getState();
  const id = route.params.id;
  const resource = resourceById(id);
  view.replaceChildren();

  if (!resource) {
    view.append(pageHead({
      title: t('找不到这个资源'),
      sub: t('资源 id {id} 不在当前目录中。', { id }),
      actions: [{ label: t('回到探索'), href: '#/', icon: 'compass' }],
    }), emptyState({
      iconName: 'scale',
      title: t('许可信息不可用'),
      desc: t('可能资源已下架，或链接来自其它版本的市场。'),
      actions: [{ label: t('浏览全部资源'), href: '#/', kind: 'primary', icon: 'compass' }],
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

  view.append(breadcrumb([
    { label: t('市场'), href: '#/' },
    { label: resource.title, href: `#/resource/${encodeURIComponent(resource.id)}` },
    { label: t('许可证') },
  ]));

  view.append(pageHead({
    title: `${t('许可证')} · ${name}`,
    sub: t('每个资源都必须展示许可标识、权利依据与免责声明。'),
    actions: [{ label: t('返回资源详情'), href: `#/resource/${encodeURIComponent(resource.id)}`, icon: 'arrow-right' }],
  }));

  const main = prose(
    proseSection(t('许可标识'),
      el('div', { class: 'license-badge-row' },
        el('span', { class: 'badge badge-type' }, icon('scale', 12), name),
        license?.url ? el('a', { class: 'btn btn-sm', href: license.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, icon('external', 13), t('许可原文')) : null,
      ),
      el('p', {}, `${t('许可 ID')}：`, el('code', { text: resource.license || '—' })),
      el('p', {}, `${t('权利依据')}：`, el('strong', { text: basisLabel })),
      rights.note ? el('p', {}, `${t('说明')}：${rights.note}`) : null,
      rights.evidenceUrl
        ? el('p', {}, `${t('证据链接')}：`, el('a', { href: rights.evidenceUrl, target: '_blank', rel: 'noopener noreferrer nofollow' }, rights.evidenceUrl))
        : null,
    ),
    proseSection(t('许可全文'),
      license?.fullText
        ? el('pre', { class: 'code-block license-fulltext' }, license.fullText)
        : el('p', { class: 'muted' }, t('该许可的全文以外部链接为准；市场记录其标识与用途说明。')),
      license?.rightsNotes ? el('p', {}, license.rightsNotes) : null,
      license?.url ? el('p', {}, el('a', { href: license.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, t('查看许可原文'), icon('external', 12))) : null,
    ),
    proseSection(t('资源内容'),
      el('ul', { class: 'prose-list' },
        el('li', {}, `${t('标题')}：${resource.title}`),
        el('li', {}, `${t('作者')}：${resource.authorName || resource.author || '—'}`),
        el('li', {}, `${t('版本')}：v${version.version || '—'}`),
        el('li', {}, `${t('发布')}：${fmtDate(version.publishedAt) || '—'}`),
        el('li', {}, `${t('媒体策略')}：BYOM · ${t('包内不含媒体')}`),
      ),
    ),
    proseSection(t('免责声明'),
      el('p', {}, t('市场仅提供索引与下载，不托管影视媒体。用户自备媒体的版权由用户自行负责；如发现侵权请通过版权投诉渠道联系。')),
      el('div', { class: 'static-links' },
        el('a', { class: 'btn', href: '#/complaint' }, icon('mail', 14), t('版权与投诉')),
        el('a', { class: 'btn', href: '#/privacy' }, icon('shield', 14), t('隐私说明')),
      ),
    ),
  );

  const aside = el('aside', { class: 'license-aside' },
    asideCard(t('许可信息'),
      asideRow(t('许可'), el('span', { class: 'mono', text: resource.license || '—' })),
      asideRow(t('权利依据'), basisLabel),
      asideRow(t('作者'), resource.authorName || resource.author || '—'),
      asideRow(t('资源类型'), resource.type),
      asideRow(t('许可页面'), license?.url ? el('a', { href: license.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, t('外部链接')) : '—'),
    ),
    asideCard(t('相关链接'),
      el('a', { class: 'aside-link', href: `#/resource/${encodeURIComponent(resource.id)}` }, t('返回资源详情')),
      el('a', { class: 'aside-link', href: '#/contribute' }, t('投稿指南')),
      el('a', { class: 'aside-link', href: '#/about' }, t('关于 SHADOW 市场')),
    ),
  );

  // 许可证页本身是独立路由；返回按钮指向资源详情
  view.append(el('div', { class: 'license-grid' }, main, aside));
}
