/**
 * 投稿指南（#/contribute）· 编辑式长文布局
 * 左 sticky 目录 + 右正文（≤720）· 引用块 / 编号步骤 / 代码块 / 表格
 * 内容沿用原有合规文案，并补充 P0 真实数据（7 资源 / 6 包 / 校验命令）。
 */

import { el, elFromHtml, copyText, fmtDate } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { getState } from '../data.js';
import { toast } from '../components.js';

const CONTACT_EMAIL = 'market@shadowmarket.app';

const SECTIONS = [
  { id: 'what', num: '01', title: t('可以投什么') },
  { id: 'rights', num: '02', title: t('版权与 BYOM') },
  { id: 'format', num: '03', title: t('格式与校验') },
  { id: 'review', num: '04', title: t('审核与下架') },
  { id: 'submit', num: '05', title: t('提交方式') },
];

function waveSvg(cls = 'wave-line') {
  return elFromHtml(`<svg class="${cls}" viewBox="0 0 160 60" aria-hidden="true"><g fill="currentColor"><rect x="2" y="23" width="22" height="10" rx="5"/><rect x="36" y="14" width="9" height="34" rx="4.5"/><rect x="55" y="4" width="9" height="52" rx="4.5"/><rect x="74" y="17" width="9" height="28" rx="4.5"/><rect x="93" y="23" width="22" height="10" rx="5"/></g></svg>`);
}

function copyButton(text, label) {
  const btn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, icon('copy', 13), label);
  btn.addEventListener('click', async () => {
    const ok = await copyText(text);
    toast(ok ? t('已复制到剪贴板') : t('复制失败：请手动选择文本'), { kind: ok ? 'success' : 'warn' });
  });
  return btn;
}

function codeBlock({ head, body }) {
  return el('div', { class: 'codeblock' },
    el('div', { class: 'codeblock-head' },
      el('span', { text: head }),
      el('span', { text: 'PowerShell / bash' }),
    ),
    el('pre', {}, body),
  );
}

function sectionEl({ id, num, title }, ...children) {
  return el('section', { id, 'data-doc-section': id },
    el('h2', {}, el('span', { class: 'sec-num', text: num }), title),
    ...children,
  );
}

function quote(label, text, iconName = 'info') {
  return el('blockquote', { class: 'quote' },
    el('span', { class: 'quote-label' }, icon(iconName, 14), label),
    el('p', { text }),
  );
}

function step(title, desc) {
  return el('li', {}, el('span', { class: 'step-title', text: title }), el('span', { class: 'step-desc', text: desc }));
}

export function renderContribute(view) {
  view.replaceChildren();
  const state = getState();
  const resourceCount = state.catalog?.resources?.length || 7;
  const packageCount = 6;
  const version = state.catalog?.version || '2.0.0';
  const tocLinks = [];

  const toc = el('aside', { class: 'doc-toc', 'aria-label': t('本页目录') },
    el('div', {},
      el('p', { class: 'eyebrow', text: t('本页目录') }),
      el('nav', { class: 'doc-toc-list' },
        SECTIONS.map((sec) => {
          const link = el('a', { class: 'doc-toc-link', href: `#/contribute#${sec.id}` },
            el('span', { class: 'num', text: sec.num }), sec.title);
          link.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.getElementById(sec.id);
            if (!target) return;
            try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { target.scrollIntoView(); }
            try { history.replaceState(null, '', `#/contribute#${sec.id}`); } catch { /* ignore */ }
          });
          tocLinks.push({ id: sec.id, node: link });
          return link;
        }),
      ),
    ),
    el('div', { class: 'doc-submit' },
      el('span', { class: 'doc-submit-title' }, icon('mail', 16), t('投稿入口')),
      el('p', { text: t('邮件提交课程包 + 元数据 + 权利依据，≤3 个工作日人工初审。P0 不收任何费用。') }),
      el('a', { class: 'btn btn-secondary btn-sm btn-block', href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('[SHADOW 市场] 投稿')}` },
        icon('mail', 14), t('发送投稿邮件')),
      el('p', { class: 'hint', style: { marginTop: '9px' } },
        t('也可在 GitHub 仓库提交 Issue / PR：'),
        el('a', {
          href: 'https://github.com/Liu9528374/shadow-market/issues',
          target: '_blank', rel: 'noopener noreferrer',
          style: { color: 'var(--amber-text)', textDecoration: 'underline', textUnderlineOffset: '2px' },
        }, 'github.com/Liu9528374/shadow-market/issues'),
      ),
    ),
  );

  const article = el('article', { class: 'doc-article' },
    el('header', { class: 'doc-head' },
      el('span', { class: 'eyebrow', text: t('CONTRIBUTING · 编辑审核') }),
      el('h1', { text: t('投稿指南') }),
      el('p', { class: 'lead' }, t('把你做的影子跟读课程包放进 SHADOW 市场。我们只收录'), el('b', { text: t('自有 / 授权 / 公版 / CC') }), t(' 的纯数据包，由人工审核后上架。')),
      el('div', { class: 'doc-meta' },
        el('span', { class: 'row' }, icon('shield', 13), t('全免费')),
        el('span', { class: 'row' }, icon('clock', 13), t('人工审核 · ≤3 个工作日')),
        el('span', { class: 'row' }, icon('info', 13), t('保留投诉下架')),
        el('span', { text: t('更新于 {date}', { date: fmtDate('2026-11-01') }) }),
      ),
    ),

    el('div', { class: 'prose' },
      /* 01 可以投什么 */
      sectionEl(SECTIONS[0],
        el('p', {}, t('市场只分发'), el('b', { text: t('纯数据资源包') }), t('：句子时间轴 + 中英翻译 + 练习配置，'), el('b', { text: t('不包含任何媒体文件') }), t('。用户用自己的媒体（BYOM）在 SHADOW Studio 里完成绑定与练习。')),
        el('table', { class: 'doc-table' },
          el('thead', {}, el('tr', {},
            el('th', { style: { width: '23%' }, text: t('类型') }),
            el('th', { text: t('内容与要求') }),
            el('th', { style: { width: '26%' }, text: t('参考资源') }),
          )),
          el('tbody', {},
            el('tr', {},
              el('td', { class: 'tag-cell', text: t('课程包') }),
              el('td', {}, t('5–20 句；句级时间轴（start/end）；英文原文 + 中文翻译；可选重音 / 连读提示。对应 '), el('code', { text: 'type: "course"' }), '。'),
              el('td', { text: t('在咖啡店点单 · B1') }),
            ),
            el('tr', {},
              el('td', { class: 'tag-cell', text: t('字幕包') }),
              el('td', {}, t('SRT 时间轴或字幕 JSON；中文翻译可选；不得含影视原片片段或第三方字幕。')),
              el('td', { text: t('社区图书馆的一天 · B1') }),
            ),
            el('tr', {},
              el('td', { class: 'tag-cell', text: t('插件说明') }),
              el('td', {}, t('只收'), el('b', { text: t('声明式 JSON') }), t('：内置类型 / 能力 / 权限声明，权限全部为 false，不含任何 JS / WASM / 二进制。')),
              el('td', { text: t('内置插件白名单') }),
            ),
          ),
        ),
        quote(t('什么不适合市场'),
          t('影视原片、YouTube / 播客的第三方片段及其字幕；未授权教材、音频或付费课程内容；需要联网执行、上传用户数据的插件；任何以 DRM、付费墙为前提的内容。市场本身不做 DRM、不做付费墙、不抽成，也没有支付或充值入口。'),
          'help-circle'),
      ),

      /* 02 版权与 BYOM */
      sectionEl(SECTIONS[1],
        el('p', {}, t('每一个资源都必须在元数据里声明 '), el('b', { text: 'license' }), t(' 与 '), el('b', { text: 'rights.basis' }), t('，并保留可核验的权利依据。人工审核会逐条确认；无法说明来源的投稿会被退回。')),
        el('h3', { text: t('允许的许可') }),
        el('ul', { class: 'bullets' },
          el('li', {}, el('code', { text: 'own' }), t(' · 自有内容（文本、翻译、时间轴均为你创作）。')),
          el('li', {}, el('code', { text: 'licensed' }), t(' · 已获得书面授权，需附证据链接或授权说明。')),
          el('li', {}, el('code', { text: 'public-domain' }), t(' · 公有领域，注明来源与判定依据。')),
          el('li', {}, el('code', { text: 'CC-BY / CC-BY-SA / CC0' }), t(' 等 CC 系列，注明版本与署名要求。')),
        ),
        el('h3', { text: t('BYOM：媒体由用户自备') }),
        el('p', {}, t('包内'), el('b', { text: t('不得') }), t('包含视频、音频、截图或 base64 媒体；也不得记录作者本机的绝对路径。'), el('code', { text: 'mediaMode' }), t(' 固定为 '), el('code', { text: 'byom' }), t('，用户导入后用同名媒体完成绑定。')),
        el('ul', { class: 'checklist' },
          el('li', {}, icon('check', 16), el('span', {}, t('已声明 '), el('code', { text: 'license' }), t(' 与 '), el('code', { text: 'rights.basis' }))),
          el('li', {}, icon('check', 16), el('span', {}, t('文本 / 翻译 / 时间轴均为原创或已授权'))),
          el('li', {}, icon('check', 16), el('span', {}, t('包内无媒体、无第三方影视片段、无外链媒体'))),
          el('li', {}, icon('check', 16), el('span', {}, t('README 中说明媒体名（与 '), el('code', { text: 'clip.name' }), t(' 逐字一致）'))),
        ),
      ),

      /* 03 格式与校验 */
      sectionEl(SECTIONS[2],
        el('p', {}, t('课程包为单个 JSON（'), el('code', { text: '.shadowcourse' }), t('，'), el('code', { text: 'spec: "shadow.course"' }), t('，UTF-8 无 BOM，≤2 MiB）。提交前请在本机跑一次校验，确保时间轴、字段与纯数据约束全部通过。')),
        el('ol', { class: 'steps' },
          step(t('准备资源包与元数据'), t('按 docs/53 的字段生成 .shadowcourse；同时准备标题、副标、分类、难度、标签、作者、许可与更新说明。')),
          step(t('运行校验器'), t('任何 FAIL 都先修复；校验器同时检查 end > start、时间轴升序、纯数据（无脚本 / iframe / 内联事件）与 ≤2 MiB。')),
          step(t('生成导入产物（可选，推荐）'), t('同时提供 .shadow.json（带翻译的 r19 工程）与 .srt（备选），并在 README 写清 5 步 + 3 个坑。')),
        ),
        codeBlock({
          head: t('终端 · 本地校验'),
          body: '# 1) 校验课程包（或整个目录）\nnode tools/shadowcourse/validate.mjs --dir market/data/packages\n\n# 2) 生成 / 校验 catalog（构建期写入 sha256 与 sizeBytes）\nnode tools/catalog/build-catalog.mjs\nnode tools/catalog/validate-catalog.mjs\n\n# 3) 生成 .shadow.json 与 .srt 导入产物（可选）\nnode tools/import/build-shadow-json.mjs',
        }),
        el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
          copyButton('node tools/shadowcourse/validate.mjs --dir market/data/packages', t('复制校验命令')),
          copyButton('node tools/catalog/validate-catalog.mjs', t('复制 catalog 校验')),
        ),
        el('p', { class: 'hint', text: t('校验通过后，构建脚本会为每个版本写入 sha256 与 sizeBytes，用户下载时可核对完整性。当前目录：{r} 个资源 / {p} 个包 / {v}。', { r: resourceCount, p: packageCount, v: `v${version}` }) }),
      ),

      /* 04 审核与下架 */
      sectionEl(SECTIONS[3],
        el('p', {}, t('市场是人工运营的免费资源站，不设自动上架。审核关注三件事：'), el('b', { text: t('版权可核验') }), t('、'), el('b', { text: t('纯数据无媒体') }), t('、'), el('b', { text: t('内容质量与安全') }), t('。')),
        el('ol', { class: 'steps' },
          step(t('机器预检'), t('构建期自动检查 schema、引用完整性、SHA256 / 文件大小、纯数据扫描（脚本 / iframe / 外链媒体）与敏感词初筛。')),
          step(t('人工初审（≤3 个工作日）'), t('核对 license / rights / evidenceUrl、内容质量、标签与分类准确性；必要时邮件沟通修改。')),
          step(t('上架与版本更新'), t('首次上架记为 v1.0.0；后续更新递增版本并在 changelog 写明变更。')),
        ),
        quote(t('投诉与下架（始终保留）'),
          t('投诉邮箱 24 小时内确认受理；疑似侵权资源 48 小时内下架；7 日内完成复核与反通知流程。重复侵权累计 3 次封禁投稿资格。'),
          'shield'),
      ),

      /* 05 提交方式 */
      sectionEl(SECTIONS[4],
        el('p', {}, t('把以下内容打包成一封邮件（或按仓库 PR 流程提交），审核通过后会给你一个上架确认与资源链接。')),
        el('ul', { class: 'checklist' },
          el('li', {}, icon('check', 16), el('span', {}, el('code', { text: '.shadowcourse' }), t(' 资源包（校验器 PASS）'))),
          el('li', {}, icon('check', 16), el('span', {}, t('元数据 JSON：标题 / 副标 / 描述 / 分类 / 难度 / 标签 / 语言 / 作者 / 许可'))),
          el('li', {}, icon('check', 16), el('span', {}, el('code', { text: 'rights.basis' }), t(' 与证据链接（自有可写 own + 说明）'))),
          el('li', {}, icon('check', 16), el('span', {}, t('可选：'), el('code', { text: '.shadow.json' }), ' / ', el('code', { text: '.srt' }), t(' / 导入说明 README / 媒体名提示'))),
        ),
        codeBlock({
          head: t('邮件格式'),
          body: '主题： [投稿] 在咖啡店点单 · 课程包 · B1\n\n正文：\n- 资源名称 / 副标 / 一句话描述\n- 类型： course | subtitle | plugin\n- 许可： CC-BY-4.0（rights.basis: own）\n- 校验结果： validate.mjs PASS（粘贴最后 10 行输出）\n- 附件： resource.shadowcourse / metadata.json / README.md',
        }),
        el('p', {}, t('提交后如 3 个工作日未收到回复，可再发一封跟进邮件；不收取任何费用，也没有加急通道。')),
        el('div', { class: 'static-links', style: { marginTop: '4px' } },
          el('a', { class: 'btn btn-primary', href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('[SHADOW 市场] 投稿')}` }, icon('mail', 14), t('邮件投稿')),
          el('a', { class: 'btn btn-secondary', href: '#/complaint' }, icon('shield', 14), t('版权与投诉')),
          el('a', { class: 'btn btn-ghost', href: '#/import' }, icon('upload', 14), t('导入说明')),
        ),
        el('div', { class: 'doc-foot' },
          el('span', { text: t('SHADOW 市场 · 投稿指南 · {v}', { v: `v${version}` }) }),
          el('a', { class: 'text-link small', href: '#/' }, t('返回工作台')),
        ),
      ),
    ),
  );

  view.append(el('div', { class: 'doc-view' },
    el('div', { class: 'doc-layout' }, toc, article),
  ));

  // 目录滚动高亮（IntersectionObserver，尊重减少动效）
  try {
    const sections = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean);
    if (sections.length && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          for (const item of tocLinks) item.node.classList.toggle('is-active', item.id === entry.target.id);
        }
      }, { rootMargin: '-96px 0px -62% 0px', threshold: 0 });
      sections.forEach((s) => io.observe(s));
    } else if (tocLinks[0]) {
      tocLinks[0].node.classList.add('is-active');
    }
  } catch { /* ignore */ }
}

