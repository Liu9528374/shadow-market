/** 版权与投诉页：投诉流程 / 联系邮箱 / 内容责任（静态合规页） */

import { el } from '../dom.js';
import { icon } from '../icons.js';
import { pageHead, prose, proseSection, copyButton } from '../components.js';
import { t } from '../i18n.js';

export const CONTACT_EMAIL = 'market@shadowmarket.app';

export function renderComplaint(view) {
  view.replaceChildren();
  view.append(pageHead({
    title: t('版权与投诉'),
    sub: t('我们尊重版权。若你认为站内资源侵犯了你的权利，请通过以下方式联系我们。'),
    actions: [
      { label: t('关于'), href: '#/about', icon: 'info' },
      { label: t('许可'), href: '#/privacy', icon: 'shield' },
    ],
  }));

  view.append(prose(
    proseSection(t('投诉流程'),
      el('ol', { class: 'steps complaint-steps' },
        el('li', {}, el('div', {},
          el('div', { class: 'step-title', text: t('发送邮件（标题注明「版权投诉」），附资源链接、权利证明与联系方式。') }),
          el('div', { class: 'step-desc' },
            el('a', { class: 'btn btn-sm btn-primary', href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('[SHADOW 市场] 版权投诉')}` }, icon('mail', 13), t('发送版权投诉邮件')),
            ' ',
            copyButton(CONTACT_EMAIL, t('复制邮箱')),
          ),
        )),
        el('li', {}, el('div', {},
          el('div', { class: 'step-title', text: t('24 小时内确认受理。') }),
          el('div', { class: 'step-desc', text: t('我们会在 24 小时内回复确认收到你的投诉。') }),
        )),
        el('li', {}, el('div', {},
          el('div', { class: 'step-title', text: t('疑似侵权资源 48 小时内下架。') }),
          el('div', { class: 'step-desc', text: t('下架期间会保留处理记录；如证据不足会与你沟通补充。') }),
        )),
        el('li', {}, el('div', {},
          el('div', { class: 'step-title', text: t('7 日内复核，并告知处理结果；如有异议可反通知。') }),
          el('div', { class: 'step-desc', text: t('复核后会告知恢复或维持下架；投稿人可提交反通知。') }),
        )),
      ),
      el('p', {}, t('同一权利人的重复侵权累计 3 次将封禁对应投稿者。')),
    ),
    proseSection(t('联系邮箱'),
      el('p', {}, el('strong', { text: CONTACT_EMAIL })),
      el('p', { class: 'subtle' }, t('该邮箱同时接收资源失效 / 内容问题 / 一般反馈；建议在标题中注明资源 id。')),
    ),
    proseSection(t('资源内容责任'),
      el('p', {}, t('资源由创作者投稿并声明权利依据（own / licensed / public-domain / CC）；市场仅提供索引与下载，用户自备媒体的版权由用户自行负责。')),
      el('ul', { class: 'prose-list' },
        el('li', {}, t('市场不托管影视媒体、不上传、不分发；课程包内只有文本 / 时间轴 / 翻译 / 练习配置。')),
        el('li', {}, t('每个资源都展示许可与权利依据；CC / licensed 类资源附带来源说明。')),
        el('li', {}, t('禁止第三方影视 / YouTube 片段及其字幕、未授权教材 / 音频、AI 生成但含他人 IP 的内容。')),
      ),
    ),
    proseSection(t('投诉入口'),
      el('div', { class: 'static-links' },
        el('a', { class: 'btn btn-primary', href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('[SHADOW 市场] 版权投诉')}` }, icon('mail', 14), t('提交版权投诉')),
        el('a', { class: 'btn', href: '#/contribute' }, icon('book', 14), t('投稿指南')),
        el('a', { class: 'btn', href: '#/privacy' }, icon('shield', 14), t('隐私说明')),
      ),
    ),
  ));
}
