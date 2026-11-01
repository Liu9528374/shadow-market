/** 版权与投诉页（#/complaint）：投诉流程 / 联系邮箱 / 内容责任（静态合规页） */

import { el, copyText } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { toast } from '../components.js';

export const CONTACT_EMAIL = 'market@shadowmarket.app';

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

function section(title, num, ...children) {
  return el('section', {},
    el('h2', {}, num ? el('span', { class: 'sec-num', text: num }) : null, title),
    ...children,
  );
}

function bullets(...items) {
  return el('ul', { class: 'bullets' }, items.map((text) => el('li', {}, text)));
}

function copyEmailButton() {
  const btn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-testid': 'copy-email' },
    icon('copy', 13), t('复制邮箱'));
  btn.addEventListener('click', async () => {
    const ok = await copyText(CONTACT_EMAIL);
    toast(ok ? t('已复制邮箱：{email}', { email: CONTACT_EMAIL }) : t('复制失败：请手动选择'), { kind: ok ? 'success' : 'warn' });
  });
  return btn;
}

export function renderComplaint(view) {
  view.replaceChildren();
  view.append(pageHead({
    eyebrow: t('COPYRIGHT · 通知—下架'),
    title: t('版权与投诉'),
    lead: t('我们尊重版权。若你认为站内资源侵犯了你的权利，请通过以下方式联系我们。'),
    actions: [
      el('a', { class: 'btn btn-secondary btn-sm', href: '#/about' }, icon('info', 14), t('关于市场')),
      el('a', { class: 'btn btn-ghost btn-sm', href: '#/privacy' }, icon('shield', 14), t('隐私说明')),
    ],
  }));

  view.append(el('div', { class: 'prose' },
    section(t('投诉流程'), '01',
      el('ol', { class: 'steps' },
        el('li', {},
          el('span', { class: 'step-title', text: t('发送邮件（标题注明「版权投诉」），附资源链接、权利证明与联系方式。') }),
          el('span', { class: 'step-desc' },
            el('a', { class: 'btn btn-sm btn-primary', href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('[SHADOW 市场] 版权投诉')}` }, icon('mail', 13), t('发送版权投诉邮件')),
            ' ',
            copyEmailButton(),
          ),
        ),
        el('li', {},
          el('span', { class: 'step-title', text: t('24 小时内确认受理。') }),
          el('span', { class: 'step-desc', text: t('我们会在 24 小时内回复确认收到你的投诉。') }),
        ),
        el('li', {},
          el('span', { class: 'step-title', text: t('疑似侵权资源 48 小时内下架。') }),
          el('span', { class: 'step-desc', text: t('下架期间会保留处理记录；如证据不足会与你沟通补充。') }),
        ),
        el('li', {},
          el('span', { class: 'step-title', text: t('7 日内复核，并告知处理结果；如有异议可反通知。') }),
          el('span', { class: 'step-desc', text: t('复核后会告知恢复或维持下架；投稿人可提交反通知。') }),
        ),
      ),
      el('p', {}, t('同一权利人的重复侵权累计 3 次将封禁对应投稿者。')),
    ),
    section(t('联系邮箱'), '02',
      el('p', {}, el('strong', { text: CONTACT_EMAIL })),
      el('p', { class: 'hint' }, t('该邮箱同时接收资源失效 / 内容问题 / 一般反馈；建议在标题中注明资源 id。')),
      el('div', { class: 'static-links' },
        el('a', { class: 'btn btn-primary', href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('[SHADOW 市场] 版权投诉')}` }, icon('mail', 14), t('提交版权投诉')),
        copyEmailButton(),
      ),
    ),
    section(t('资源内容责任'), '03',
      el('p', {}, t('资源由创作者投稿并声明权利依据（own / licensed / public-domain / CC）；市场仅提供索引与下载，用户自备媒体的版权由用户自行负责。')),
      bullets(
        t('市场不托管影视媒体、不上传、不分发；课程包内只有文本 / 时间轴 / 翻译 / 练习配置。'),
        t('每个资源都展示许可与权利依据；CC / licensed 类资源附带来源说明。'),
        t('禁止第三方影视 / YouTube 片段及其字幕、未授权教材 / 音频、AI 生成但含他人 IP 的内容。'),
      ),
      el('div', { class: 'quote' },
        el('span', { class: 'quote-label' }, icon('shield', 14), t('我们的承诺')),
        el('p', { text: t('通知 → 删除 → 反通知 → 恢复：所有流程人工处理并留痕；投诉不收取任何费用。') }),
      ),
    ),
  ));

  view.append(el('p', { class: 'footer-note' },
    el('span', { text: t('通知—下架 · 24h 受理 / 48h 下架 / 7 日复核') }),
    el('a', { class: 'text-link', href: '#/contribute' }, t('投稿指南')),
    el('a', { class: 'text-link', href: '#/privacy' }, t('隐私说明')),
  ));
}
