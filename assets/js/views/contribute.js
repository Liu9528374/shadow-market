/** 投稿指南页：内容规范 / 版权要求 / 格式与校验命令 / 媒体政策 / 审核流程 / 联系方式 */

import { el } from '../dom.js';
import { icon } from '../icons.js';
import { pageHead, prose, proseSection, copyButton } from '../components.js';
import { t } from '../i18n.js';

const CONTACT_EMAIL = 'market@shadowmarket.app';

const METADATA_TEMPLATE = `{
  "title": "课程标题（中文）",
  "subtitle": "English subtitle",
  "description": "1–3 句描述（中文）",
  "category": "daily",              // categories[].id
  "level": "B1",
  "tags": ["B1", "日常", "coffee"],
  "author": "your-handle",          // authors[].handle
  "license": "CC-BY-4.0",           // licenses[].id
  "rights": { "basis": "own" },     // own | licensed | public-domain | cc
  "mediaPolicy": "byom",
  "language": ["en", "zh"],
  "readme": "# 课程说明\\n…",
  "versions": [{
    "version": "1.0.0",
    "packageUrl": "data/packages/<id>.shadowcourse",
    "changelog": ["首个版本"],
    "compat": { "shadow": ">=0.7.0", "schemaVersion": 1 }
  }]
}`;

export function renderContribute(view) {
  view.replaceChildren();
  view.append(pageHead({
    title: t('投稿指南'),
    sub: t('欢迎投稿全免费、可离线、合法授权的影子跟读课程包。'),
    actions: [
      { label: t('导入说明'), href: '#/import', icon: 'upload' },
      { label: t('版权与投诉'), href: '#/complaint', icon: 'scale' },
    ],
  }));

  view.append(prose(
    proseSection(t('内容规范'),
      el('ul', { class: 'prose-list' },
        el('li', {}, t('必须声明权利依据（own / licensed / public-domain / CC），并附证据链接。')),
        el('li', {}, t('禁止第三方影视 / YouTube 片段及其字幕、未授权教材 / 音频、AI 生成但含他人 IP 的内容。')),
        el('li', {}, t('包必须是纯数据 JSON（无脚本 / 无内联事件 / 无外链媒体），单包 ≤ 2 MiB。')),
        el('li', {}, t('句子时间轴必须与媒体同源；公开媒体名必须与实际文件一致。')),
      ),
    ),
    proseSection(t('格式规范与校验'),
      el('p', {}, t('使用 .shadowcourse 规范（spec="shadow.course"、schemaVersion=1、mediaPolicy="byom"）。')),
      el('p', {}, t('提交前请本地运行校验命令（见下方命令块），全部 PASS 后再投稿。')),
      el('pre', { class: 'code-block' }, `# 1) 校验课程包（零依赖，selftest 35/35）
node tools/shadowcourse/validate.mjs --dir market/data/packages

# 2) 生成本地预览（可选）
node tools/shadowcourse/build-packages.mjs
node market/serve.mjs`),
      el('div', { class: 'row' }, copyButton('node tools/shadowcourse/validate.mjs --dir market/data/packages', t('复制校验命令'))),
    ),
    proseSection(t('审核流程'),
      el('p', {}, t('人工初审（≤ 3 个工作日）→ 元数据 / 许可 / 纯数据检查 → 上架并纳入更新日志。')),
      el('ul', { class: 'prose-list' },
        el('li', {}, t('初审：内容合法性、版权依据、无第三方媒体。')),
        el('li', {}, t('技术检查：包校验 PASS、catalog 字段完整、sha256 / sizeBytes 一致。')),
        el('li', {}, t('上架：进入资源目录、分类与标签；之后的版本变更写入版本与变更 Tab。')),
      ),
    ),
    proseSection(t('投稿方式'),
      el('p', {}, t('通过邮件提交包文件、元数据（标题 / 分类 / 标签 / 作者 / 许可 / 权利依据）与联系方式。')),
      el('p', {},
        el('a', { class: 'btn btn-primary', href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('[SHADOW 市场] 投稿')}` }, icon('mail', 14), t('邮件投稿')),
        ' ',
        copyButton(CONTACT_EMAIL, t('复制邮箱')),
      ),
      el('h3', { class: 'prose-subtitle', text: t('元数据模板（catalog/resources.json 字段）') }),
      el('pre', { class: 'code-block' }, METADATA_TEMPLATE),
      el('p', { class: 'subtle' }, t('下载投稿模板（元数据字段说明）') + ' · ' + t('模板以本页代码块为准；P0 无上传入口，邮件提交即可。')),
    ),
  ));
}
