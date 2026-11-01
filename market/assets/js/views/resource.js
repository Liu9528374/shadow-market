/**
 * 资源详情页（#/resource/:id）
 * 设计依据：design/mockups/resource.html（Hero 徽标≤3 + 3 操作 + 4 Tabs + 右栏 3 块）。
 * 数据：catalog resource + versions[0]（.shadowcourse 包在首屏前 fetch，README/句子以包为准）；
 *      plugin 声明式资源不 fetch 包，README 用目录摘要，文件只给 README + 声明 JSON。
 */

import { el, elFromHtml, fmtDuration, fmtBytes, fmtDate, baseName, copyText } from '../dom.js';
import { nextPaint } from './ui.js';
import { icon } from '../icons.js';
import { t, pickLang } from '../i18n.js';
import {
  getState, resourceById, pluginFor, loadPackage, creatorByHandle, categoryById, licenseById,
  isDeclarativeResource,
} from '../data.js';
import { MarketPoints } from '../points.js';
import { renderMarkdownInto } from '../markdown.js';
import { toast, openModal } from '../components.js';
import {
  importToStudio, downloadPackage, downloadImportFile, importFileEntries,
} from '../importer.js';

const CONTACT_EMAIL = 'market@shadowmarket.app';

const IMPORT_STEPS = [
  '第 1 步：下载 .shadow.json',
  '第 2 步：打开 SHADOW Studio（r19）',
  '第 3 步：File → Open Project…（Ctrl+O）',
  '第 4 步：把同名媒体拖进窗口',
  '第 5 步：播放 / 影子跟读练习',
];
const IMPORT_STEP_DESCS = [
  '.shadow.json 是带翻译的工程文件：句子时间轴 + 中文翻译 + 练习配置。',
  '市场与 SHADOW Studio 是两个产品：市场只负责浏览与下载，桌面端负责导入与练习。',
  '在桌面端菜单选择 File → Open Project…，选中刚下载的 .shadow.json。',
  '桌面端会提示「把同名媒体拖进窗口」；把自备媒体重命名后拖入。没有媒体时可用「仅文本模式」。',
  '播放时按句子高亮与翻译做影子跟读练习；录音/评分以桌面端版本能力为准。',
];
const IMPORT_PITFALLS = [
  '① 媒体名必须与课程页公示的媒体名逐字一致，否则会新建重复 clip。',
  '② 打开后不要点 Analyze / Generate Subtitles —— 会用「待转写」覆盖包里的句子。',
  '③ 媒体必须与句子时间轴同源（同一版本视频/音频），否则对不上口型。',
];

function escapeH1(md) {
  return String(md || '').replace(/^\s*#\s+[^\n]*\n+/, '');
}

function timeRange(start, end) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(1) : '?');
  return `${n(start)}–${n(end)}s`;
}

function statsOf(resource, pkgEntry) {
  if (pkgEntry?.status === 'ok' && pkgEntry.stats) return { ...pkgEntry.stats, source: 'package' };
  return { ...resource.stats, source: 'catalog' };
}

function versionOf(resource) {
  return (Array.isArray(resource.versions) && resource.versions[0]) || {};
}

function typeLabelOf(resource) {
  const plugin = pluginFor(resource.type);
  return pickLang(plugin.label, plugin.labelEn);
}

/* ---------------- 收藏 / 分享 ---------------- */

function favoriteToggle(resource) {
  const on = MarketPoints.isFavorite(resource.id);
  const btn = el('button', {
    class: 'btn btn-ghost', type: 'button', 'aria-pressed': on ? 'true' : 'false',
    'data-testid': 'favorite-btn',
    onclick: () => {
      const result = MarketPoints.toggleFavorite(resource.id);
      const now = Boolean(result.favorite);
      btn.setAttribute('aria-pressed', now ? 'true' : 'false');
      btn.replaceChildren(icon('star', 16), now ? t('已收藏') : t('收藏'));
      toast(now ? t('已收藏（仅保存在本机浏览器）') : t('已取消收藏'), { kind: 'success', timeout: 2200 });
    },
  }, icon('star', 16), on ? t('已收藏') : t('收藏'));
  return btn;
}

async function shareResource() {
  const ok = await copyText(window.location.href);
  toast(ok ? t('链接已复制') : t('复制失败，请手动选择地址栏'), { kind: ok ? 'success' : 'error' });
}

/* ---------------- 下载导入弹层 ---------------- */

let modalResourceRef = null;

function artifactCard({ kind, title, desc, size, primary, disabled, filename }) {
  const testids = { shadowJson: 'download-shadow-json', srt: 'download-srt', shadowcourse: 'download-shadowcourse', readme: 'download-readme', declaration: 'download-declaration' };
  return el('div', { class: 'artifact' + (primary ? ' is-primary' : ''), dataset: { kind } },
    el('span', { class: 'artifact-icon' }, icon(kind === 'shadowcourse' ? 'layers' : 'file-text', 16)),
    el('div', { class: 'artifact-body' },
      el('span', { class: 'artifact-name' }, title, primary ? el('span', { class: 'badge badge-soft', text: t('推荐') }) : null),
      el('span', { class: 'artifact-desc', text: desc }),
    ),
    el('span', { class: 'artifact-size', text: size || '—' }),
    el('button', {
      class: 'icon-btn', type: 'button', 'data-testid': testids[kind] || `download-${kind}`,
      disabled: disabled ? true : null,
      'aria-label': `${t('下载')} ${filename || title}`,
      onclick: () => {
        if (disabled || !modalResourceRef) return;
        const result = downloadImportFile(modalResourceRef, kind);
        if (result.ok) toast(t('已开始下载，并加入「我的资源」（本地演示）'), { kind: 'success' });
        else toast(t('该资源暂未提供这个文件'), { kind: 'warn' });
      },
    }, icon('download', 16)),
  );
}

function importModal(resource) {
  modalResourceRef = resource;
  const version = versionOf(resource);
  const entries = importFileEntries(resource);
  const byKind = new Map(entries.map((e) => [e.kind, e]));
  const fileNote = (kind) => {
    const entry = byKind.get(kind);
    return { filename: entry?.filename || '', disabled: !entry, size: kind === 'shadowcourse' && version.sizeBytes ? fmtBytes(version.sizeBytes) : '' };
  };
  const declarative = isDeclarativeResource(resource);
  const body = el('div', { class: 'import-modal', style: { display: 'flex', flexDirection: 'column', gap: '16px' } });

  if (declarative) {
    body.append(el('div', { class: 'notice' }, el('span', { class: 'dot' }),
      el('span', {}, el('b', { text: t('声明式插件资源') }), ' ', t('纯 JSON 声明清单：不含可执行代码，市场只读声明、不加载执行。'))));
    body.append(el('div', { class: 'artifact-list' },
      artifactCard({ kind: 'readme', title: t('下载白名单说明（README）'), desc: t('声明式插件白名单的说明文档：资源类型、权限、边界与审核规则。'), ...fileNote('readme') }),
      artifactCard({ kind: 'declaration', title: t('下载声明式 JSON'), desc: t('builtin-whitelist.json：市场认可的资源类型与权限声明，纯数据、不可执行。'), primary: true, ...fileNote('declaration') }),
    ));
  } else {
    body.append(el('div', { class: 'notice' }, el('span', { class: 'dot' }),
      el('span', {}, el('b', { text: t('BYOM：媒体需自备') }), ' ', t('课程包只含句子时间轴 / 翻译 / 练习配置，不含影视媒体。请在桌面端选择你有权使用的本地媒体。'),
        resource.mediaName ? el('span', { class: 'media-name', style: { marginLeft: '8px' } }, resource.mediaName) : null)));
    body.append(el('div', { class: 'artifact-list' },
      artifactCard({ kind: 'shadowJson', title: t('下载 .shadow.json'), desc: t('带翻译的工程文件，桌面端 File → Open Project… 打开后可保留中文翻译与时间轴。'), primary: true, ...fileNote('shadowJson') }),
      artifactCard({ kind: 'srt', title: t('下载 .srt'), desc: t('无翻译的通用字幕，任何播放器/工具都能用；先导入媒体，再 Import Subtitle。'), ...fileNote('srt') }),
      artifactCard({ kind: 'shadowcourse', title: t('下载 .shadowcourse'), desc: t('规范载体与归档格式（当前桌面端 r19 不直接识别），用于校验、存档与未来版本。'), ...fileNote('shadowcourse') }),
    ));
    body.append(el('div', { class: 'import-guide', style: { display: 'grid', gap: '18px' } },
      el('div', {},
        el('h3', { class: 'h3', style: { marginBottom: '10px' } }, icon('upload', 16), ` ${t('5 步导入')}`),
        el('ol', { class: 'steps' }, IMPORT_STEPS.map((title, idx) => el('li', {}, el('div', {},
          el('div', { class: 'step-title', text: t(title) }),
          el('div', { class: 'step-desc', text: t(IMPORT_STEP_DESCS[idx]) }),
        )))),
      ),
      el('div', {},
        el('h3', { class: 'h3', style: { marginBottom: '10px' } }, icon('help-circle', 16), ` ${t('3 个坑')}`),
        el('ul', { class: 'pitfalls' }, IMPORT_PITFALLS.map((text) => el('li', { text: t(text) }))),
      ),
    ));
  }

  const modal = openModal({ title: t('下载导入'), body, actions: [] });
  const foot = modal.element.querySelector('.modal-foot') || el('div', { class: 'modal-foot' });
  if (!declarative) {
    foot.append(el('button', {
      class: 'btn btn-secondary', type: 'button', 'data-testid': 'import-btn',
      onclick: () => oneClickImport(resource),
    }, icon('upload', 16), t('一键导入 SHADOW Studio')));
  }
  foot.append(el('a', { class: 'btn btn-ghost', href: '#/import' }, t('导入原理与降级说明')));
  foot.append(el('button', { class: 'btn btn-primary', type: 'button', onclick: () => modal.close() }, t('完成')));
  modal.element.append(foot);
  return modal;
}

function fallbackDownloadModal(resource, result) {
  const packageUrl = versionOf(resource).packageUrl || resource.packageUrl;
  const reason = (() => {
    if (result.reason === 'E_POPUP') return t('检测到了 SHADOW Studio，但浏览器拦截了自动打开的新窗口。');
    if (result.reason === 'E_OVERRIDE_NOT_FOUND') return t('指定端口 {port} 上没有检测到 SHADOW Studio（未扫描默认端口区间）。', { port: result.probe?.override });
    if (result.probe?.mixedContent) return t('页面在 https 下无法探测本机 http 服务（浏览器混合内容限制）。');
    return t('没有在本机检测到 SHADOW Studio 的本地服务（已扫描 127.0.0.1:18765–18775）。');
  })();
  const body = el('div', {},
    el('p', { text: reason }),
    el('p', { style: { marginTop: '8px' } }, el('strong', { text: t('已自动降级为下载 + 手动导入：') }), t('课程包是纯数据 JSON，不跑 ASR、不含媒体。')),
    el('ol', { class: 'steps', style: { marginTop: '12px' } },
      el('li', {}, el('div', {}, el('div', { class: 'step-title', text: t('下载课程包') }), el('div', { class: 'step-desc', text: t('点击下方「下载 .shadowcourse」，文件会保存到本机。') }))),
      el('li', {}, el('div', {}, el('div', { class: 'step-title', text: t('打开 SHADOW Studio 桌面应用') }), el('div', { class: 'step-desc', text: t('市场只负责浏览与下载，桌面端只保留「导入课程包」薄接口。') }))),
      el('li', {}, el('div', {}, el('div', { class: 'step-title', text: t('把文件拖进窗口（或菜单导入）') }), el('div', { class: 'step-desc', text: t('拖入后按提示选择本地媒体（BYOM）；没有媒体可先用「仅文本模式」。') }))),
    ),
  );
  const modal = openModal({ title: t('一键导入：已降级为下载'), body, actions: [] });
  const foot = modal.element.querySelector('.modal-foot') || el('div', { class: 'modal-foot' });
  if (packageUrl) {
    foot.append(el('a', { class: 'btn btn-primary', href: packageUrl, download: baseName(packageUrl), 'data-testid': 'fallback-download', onclick: () => MarketPoints.addMyResource(resource, 'download') }, icon('download', 16), t('下载 .shadowcourse')));
  }
  foot.append(el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => modal.close() }, t('关闭')));
  modal.element.append(foot);
}

async function oneClickImport(resource) {
  const result = await importToStudio(resource, null).catch((err) => ({ mode: 'error', message: String(err?.message || err) }));
  if (result.mode === 'desktop') {
    return openModal({
      title: t('已发送到 SHADOW Studio'),
      body: el('div', {},
        el('p', { text: t('已在 {addr} 打开导入深链，桌面端会接收课程包并提示你选择本地媒体（BYOM）。', { addr: `127.0.0.1:${result.port}` }) }),
        el('p', { class: 'small muted', style: { marginTop: '6px' }, text: t('打开方式：{via}', { via: result.openedVia === 'reserved' ? t('新标签页（预留窗口）') : t('新标签页') }) }),
        el('p', { class: 'small muted', style: { marginTop: '6px' }, text: t('不会重复下载，也不会误报拦截。') }),
      ),
      actions: [{ label: t('完成'), kind: 'primary' }],
    });
  }
  if (result.mode === 'download-fallback') {
    downloadPackage(resource);
    MarketPoints.addMyResource(resource, 'download');
    fallbackDownloadModal(resource, result);
    return null;
  }
  toast(result.message || t('该资源没有可导入的包文件'), { kind: 'error' });
  return null;
}

/* ---------------- 各 Tab 内容 ---------------- */

function readmePanel(resource, pkgEntry) {
  const md = pkgEntry?.status === 'ok' ? String(pkgEntry.pkg.readme || '') : String(resource.readme || '');
  const body = el('div', { class: 'md', 'data-testid': 'readme-content' });
  if (md.trim()) renderMarkdownInto(body, escapeH1(md));
  else body.append(el('p', { class: 'muted', text: t('这个资源没有提供 README。') }));
  return el('div', { class: 'readme' }, body);
}

function sentencesPanel(resource, pkgEntry) {
  if (pkgEntry?.status !== 'ok') {
    return el('div', {},
      el('p', { class: 'muted', text: t('句子预览不可用（课程包未加载）') }),
      resource.stats?.sentences ? el('p', { class: 'muted', style: { marginTop: '8px' }, text: t('目录统计：{n} 句 · 时长约 {time}（以包为准）', { n: resource.stats.sentences, time: fmtDuration(resource.stats.durationSec) }) }) : null,
    );
  }
  const pkg = pkgEntry.pkg;
  const stats = pkgEntry.stats;
  const summary = el('div', { class: 'sent-summary' },
    el('span', { class: 'badge badge-neutral', text: t('{n} 句', { n: stats.sentences }) }),
    el('span', { class: 'badge badge-neutral', text: fmtDuration(stats.durationSec) }),
    el('span', { class: 'badge badge-neutral', text: t('{n} 词', { n: stats.words }) }),
    el('span', { text: t('词级时间：无（整句评分）') }),
    el('span', { text: '·' }),
    el('span', { text: `${t('媒体：')}${pkg.mediaPolicy === 'byom' ? t('BYOM（包内不含媒体）') : String(pkg.mediaPolicy || '—')}` }),
  );
  const list = el('div', { class: 'sent-list', 'data-testid': 'sentence-list' });
  (pkg.sentences || []).forEach((sentence, idx) => {
    const notes = String(sentence.notes || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const chips = notes.filter((line) => /^(重音|连读|发音|提示|stress|linking)/i.test(line)).slice(0, 3).map((line) => {
      const m = /^([^：:]{1,6})[：:]\s*(.*)$/.exec(line);
      return el('span', { class: 'note-chip' }, m ? el('b', { text: `${m[1]}：${m[2]}` }) : line);
    });
    list.append(el('div', { class: 'sent-row', 'data-testid': 'sentence-row' },
      el('div', { class: 'sent-time' },
        el('span', { class: 't', text: timeRange(sentence.start, sentence.end) }),
        el('span', { class: 'n', text: `#${String(idx + 1).padStart(2, '0')}` }),
      ),
      el('div', { class: 'sent-body' },
        el('p', { class: 'sent-en', lang: 'en', text: sentence.text || '' }),
        sentence.translation ? el('p', { class: 'sent-zh', text: sentence.translation }) : null,
        chips.length ? el('div', { class: 'sent-notes' }, chips) : null,
      ),
    ));
  });
  return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } }, summary, list);
}

function filesPanel(resource) {
  const version = versionOf(resource);
  const entries = importFileEntries(resource);
  const rows = el('div', { class: 'file-list' });
  const descMap = {
    shadowJson: t('带翻译的导入工程文件 · 桌面端 File → Open Project… 打开（推荐）'),
    srt: t('无翻译的通用字幕 · 先导入媒体，再 Import Subtitle（备选）'),
    shadowcourse: t('规范载体 / 归档格式 · 单文件 JSON，含完整句子、翻译与练习配置'),
    readme: t('导入说明 · 5 步 + 3 个坑 + 失败排查（纯文本，可离线保存）'),
    declaration: t('声明式白名单 JSON（纯数据，不可执行）'),
  };
  for (const entry of entries) {
    const isPackage = entry.kind === 'shadowcourse';
    const sizeNode = el('span', { class: 'file-size', text: isPackage && version.sizeBytes ? fmtBytes(version.sizeBytes) : '…' });
    if (!isPackage) {
      fetch(entry.url, { method: 'HEAD', cache: 'no-cache' }).then((res) => {
        const len = Number(res.headers.get('content-length'));
        if (Number.isFinite(len) && len > 0) sizeNode.textContent = fmtBytes(len);
        else sizeNode.textContent = '—';
      }).catch(() => { sizeNode.textContent = '—'; });
    }
    rows.append(el('div', { class: 'file-row', 'data-testid': isPackage ? 'file-row' : `file-row-${entry.kind}` },
      el('span', { class: 'file-icon' }, icon(isPackage ? 'layers' : 'file-text', 17)),
      el('div', { class: 'file-body' },
        el('span', { class: 'file-name', text: entry.filename }),
        el('span', { class: 'file-desc', text: descMap[entry.kind] || '' }),
      ),
      el('div', { class: 'file-side' }, sizeNode, el('span', { class: 'badge badge-neutral' }, isPackage ? t('规范') : entry.kind === 'shadowJson' ? t('推荐') : t('文件'))),
    ));
  }
  return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, rows,
    el('div', { class: 'notice' }, el('span', { class: 'dot' }),
      el('span', { text: t('下载入口统一在右侧「下载导入」卡；这里用于核对文件名与大小。SHA256 与目录记录一致。') })),
  );
}

function versionsPanel(resource) {
  const version = versionOf(resource);
  const compat = version.compat || {};
  const compatText = [compat.shadow ? `SHADOW ${compat.shadow}` : '', compat.schemaVersion ? `schemaVersion ${compat.schemaVersion}` : ''].filter(Boolean).join(' · ');
  const list = el('ul', { class: 'version-changes', style: { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' } });
  (version.changelog?.length ? version.changelog : [t('首个发布版本')]).forEach((line) => {
    list.append(el('li', {},
      el('span', { style: { display: 'inline-block', width: '5px', height: '5px', borderRadius: '50%', background: 'var(--amber)', marginRight: '9px', verticalAlign: 'middle' } }),
      line,
    ));
  });
  return el('div', { class: 'card version-card' },
    el('div', { class: 'version-head' },
      el('span', { class: 'version-num', text: `v${version.version || '—'}` }),
      el('span', { class: 'badge badge-soft', text: t('当前发布版本') }),
      el('span', { class: 'version-date', text: t('发布于 {date}', { date: fmtDate(version.publishedAt) }) }),
    ),
    list,
    el('div', { class: 'version-meta', style: { marginTop: '14px' } },
      compatText ? el('span', { class: 'badge badge-neutral mono', text: compatText }) : null,
      version.sha256 ? el('span', { class: 'badge badge-neutral mono', text: `SHA256 ${String(version.sha256).slice(0, 12)}…` }) : null,
      version.sizeBytes ? el('span', { class: 'badge badge-neutral mono', text: fmtBytes(version.sizeBytes) }) : null,
    ),
  );
}

/* ---------------- 右栏 3 块 ---------------- */

export function renderRail(route) {
  const resource = resourceById(route.params.id);
  if (!resource) return document.createDocumentFragment();
  const version = versionOf(resource);
  const stats = resource.stats || {};
  const declarative = isDeclarativeResource(resource);
  const entries = importFileEntries(resource);
  const frag = document.createDocumentFragment();

  const download = el('div', { class: 'rail-card rail-card--emphasis', id: 'rail-download' },
    el('div', { class: 'rail-card-head' },
      el('div', {},
        el('h2', { class: 'rail-card-title' }, icon('download', 18), t('下载导入')),
        el('p', { class: 'rail-card-sub', text: declarative ? t('声明式 JSON · 不含可执行代码') : t('纯数据包 · 不含媒体 · 3 个导入产物') }),
      ),
      el('span', { class: 'badge badge-neutral', text: declarative ? t('声明式') : 'BYOM' }),
    ),
  );
  const artifacts = el('div', { class: 'artifact-list' });
  const shortName = { shadowJson: '.shadow.json', srt: '.srt', shadowcourse: '.shadowcourse', readme: 'README', declaration: 'JSON 声明' };
  const descMap = {
    shadowJson: t('带翻译的工程文件，打开即可练习'),
    srt: t('无翻译的通用字幕，任何播放器都能用'),
    shadowcourse: t('规范载体 / 归档格式（含完整配置）'),
    readme: t('导入 / 白名单说明（纯文本）'),
    declaration: t('声明式白名单 JSON（纯数据，不可执行）'),
  };
  for (const entry of entries) {
    const primary = entry.kind === 'shadowJson' || entry.kind === 'declaration';
    artifacts.append(el('div', { class: `artifact${primary ? ' is-primary' : ''}` },
      el('span', { class: 'artifact-icon' }, icon(entry.kind === 'shadowcourse' ? 'layers' : 'file-text', 16)),
      el('div', { class: 'artifact-body' },
        el('span', { class: 'artifact-name' }, shortName[entry.kind] || entry.filename, primary ? el('span', { class: 'badge badge-soft', text: t('推荐') }) : null),
        el('span', { class: 'artifact-desc', text: descMap[entry.kind] || '' }),
      ),
      el('button', {
        class: 'icon-btn', type: 'button',
        'data-testid': `rail-download-${entry.kind}`,
        'aria-label': `${t('下载')} ${entry.filename}`,
        onclick: () => {
          const result = downloadImportFile(resource, entry.kind);
          if (result.ok) toast(t('已开始下载，并加入「我的资源」（本地演示）'), { kind: 'success' });
          else toast(t('下载失败'), { kind: 'error' });
        },
      }, icon('download', 16)),
    ));
  }
  download.append(artifacts);
  if (!declarative) {
    download.append(el('div', { class: 'media-note' }, icon('help-circle', 16),
      el('div', {}, t('媒体需自备，并逐字重命名为课程页公示的文件名：'),
        resource.mediaName ? el('span', { class: 'media-name' }, resource.mediaName) : null)));
  }
  download.append(el('details', { class: 'import-details' },
    el('summary', {}, icon('file-text', 16), t('查看导入步骤（5 步 · 3 个坑）'), icon('chevron-down', 16, 'chev')),
    el('div', { class: 'import-body' },
      el('ol', { class: 'steps' }, IMPORT_STEPS.map((title) => el('li', { text: t(title) }))),
      el('ul', { class: 'pitfalls' }, IMPORT_PITFALLS.map((text) => el('li', {}, icon('help-circle', 14), t(text)))),
    ),
  ));
  download.append(el('a', { class: 'rail-link', href: '#', onclick: (e) => { e.preventDefault(); importModal(resource); } }, t('打开下载导入说明'), icon('arrow-right', 16)));
  frag.append(download);

  const hash = version.sha256 || stats.sha256 || '';
  const stat = (value, unit, label) => el('div', { class: 'rail-stat' },
    el('div', { class: 'v' }, value, unit ? el('span', { class: 'unit' }, unit) : null),
    el('div', { class: 'k', text: label }),
  );
  frag.append(el('div', { class: 'rail-card' },
    el('p', { class: 'rail-title', text: t('统计') }),
    el('div', { class: 'rail-stats' },
      stat(String(stats.sentences || 0), t('句'), t('句子')),
      stat(fmtDuration(stats.durationSec), '', t('时间轴')),
      stat(String(stats.words || 0), t('词'), t('词数')),
      stat(fmtBytes(stats.sizeBytes || 0), '', t('包大小')),
    ),
    el('div', { class: 'rail-hash' },
      el('span', {}, 'SHA256 ', el('span', { class: 'mono', text: hash ? `${hash.slice(0, 12)}…` : '—' })),
      el('button', {
        class: 'icon-btn', type: 'button', 'aria-label': t('复制 SHA256'),
        onclick: async () => { const ok = await copyText(hash); toast(ok ? t('已复制 SHA256') : t('复制失败'), { kind: ok ? 'success' : 'error' }); },
      }, icon('copy', 14)),
    ),
    el('div', { class: 'rail-info-row' }, el('span', { class: 'k', text: t('格式') }), el('span', { class: 'v mono', text: declarative ? '.json' : '.shadowcourse · schemaVersion 1' })),
    el('div', { class: 'rail-info-row' }, el('span', { class: 'k', text: t('文件') }), el('span', { class: 'v', text: t('{n} 个', { n: entries.length }) })),
  ));

  const license = licenseById(resource.license);
  const author = creatorByHandle(resource.author);
  const category = categoryById(resource.category);
  frag.append(el('div', { class: 'rail-card' },
    el('p', { class: 'rail-title', text: t('许可与资源信息') }),
    el('div', { class: 'license-badge-row' },
      el('span', { class: 'badge badge-soft', text: license?.name || resource.license || t('未声明') }),
      el('a', { class: 'text-link tiny', href: `#/resource/${encodeURIComponent(resource.id)}/license`, text: t('查看许可全文') }),
    ),
    el('div', { class: 'rail-info-row' }, el('span', { class: 'k', text: t('类型') }), el('span', { class: 'v', text: `${typeLabelOf(resource)}${resource.level ? ` · ${resource.level}` : ''}${stats.sentences ? ` · ${t('{n} 句', { n: stats.sentences })}` : ''}` })),
    el('div', { class: 'rail-info-row' }, el('span', { class: 'k', text: t('分类') }), el('span', { class: 'v', text: category ? pickLang(category.label, category.labelEn) : (resource.category || '—') })),
    el('div', { class: 'rail-info-row' }, el('span', { class: 'k', text: t('作者') }), el('span', { class: 'v', text: author ? author.name : (resource.author || '—') })),
    el('div', { class: 'rail-info-row' }, el('span', { class: 'k', text: t('更新') }), el('span', { class: 'v', text: fmtDate(resource.updatedAt) })),
    el('div', { class: 'rail-info-row' }, el('span', { class: 'k', text: t('权利依据') }), el('span', { class: 'v' }, el('b', { text: resource.rights?.basis || '—' }))),
    el('div', { class: 'rail-info-row' }, el('span', { class: 'k', text: t('媒体') }), el('span', { class: 'v', text: declarative ? t('不适用（声明式资源）') : t('用户自备（BYOM），版权自负') })),
    el('div', { class: 'rail-divider' }),
    el('div', { class: 'feedback-links' },
      el('a', { class: 'feedback-link', href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`[SHADOW 市场] 资源反馈：${resource.id}`)}` }, icon('mail', 16), t('资源失效 / 内容问题反馈'), el('span', { class: 'ext', text: '↗' })),
      el('a', { class: 'feedback-link', href: '#/complaint' }, icon('shield', 16), t('版权投诉与下架流程'), el('span', { class: 'ext', text: '↗' })),
    ),
    el('div', { class: 'rail-foot-links' },
      el('a', { href: '#/' }, `← ${t('回到工作台')}`),
      el('span', { class: 'sep', text: '·' }),
      el('a', { href: '#/market' }, `${t('继续逛市场')} →`),
    ),
  ));
  return frag;
}

/* ---------------- 页面 ---------------- */

function notFound(view) {
  view.replaceChildren(el('section', { class: 'page-head' },
    el('div', { class: 'profile-name' },
      el('h1', { class: 'name', text: t('找不到这个资源') }),
      el('span', { class: 'meta', text: t('资源可能已下架，或链接来自其它版本的市场。') }),
    ),
  ), el('div', { class: 'card', style: { textAlign: 'center', padding: '40px' } },
    el('a', { class: 'btn btn-primary', href: '#/market' }, icon('compass', 16), t('去市场逛逛')),
  ));
}

export async function renderResource(view, route) {
  const resource = resourceById(route.params.id);
  view.replaceChildren();
  if (!resource) { notFound(view); return; }

  const plugin = pluginFor(resource.type);
  const declarative = isDeclarativeResource(resource);
  const version = versionOf(resource);
  const author = creatorByHandle(resource.author);
  const category = categoryById(resource.category);

  let pkgEntry = declarative
    ? { status: 'declarative' }
    : (resource.packageUrl ? { status: 'loading' } : { status: 'missing', error: t('该资源没有 packageUrl') });
  // 首屏不等待课程包：先渲染 Hero/Tabs（目录数据），包到达后再刷新 README/句子面板（LCP 优化）
  const pkgPromise = (!declarative && resource.packageUrl)
    ? loadPackage(resource.packageUrl).catch((err) => ({ status: 'error', error: String(err?.message || err) }))
    : null;
  const stats = statsOf(resource, pkgEntry);

  const heroBadges = el('div', { class: 'hero-title-row' },
    resource.free !== false ? el('span', { class: 'badge badge-soft', text: 'Free' }) : null,
    declarative ? el('span', { class: 'badge badge-neutral', text: t('声明式') }) : el('span', { class: 'badge badge-neutral', text: 'BYOM' }),
    version.version ? el('span', { class: 'badge badge-neutral mono', text: `v${version.version}` }) : null,
  );

  const heroMeta = [
    typeLabelOf(resource), resource.level,
    stats.sentences ? t('{n} 句', { n: stats.sentences }) : null,
    stats.durationSec ? fmtDuration(stats.durationSec) : null,
    stats.words ? t('{n} 词', { n: stats.words }) : null,
  ].filter(Boolean).map((text) => el('span', { text }));
  heroMeta.push(el('span', { class: 'hero-sep' }), el('span', { class: 'hero-author' },
    el('img', { src: 'assets/brand/logo-128.png', width: '18', height: '18', alt: '' }),
    el('b', { text: author ? author.name : resource.author }),
  ));
  heroMeta.push(el('span', { class: 'hero-sep' }), el('span', { text: t('更新于 {date}', { date: fmtDate(resource.updatedAt) }) }));
  if (resource.license) heroMeta.push(el('span', { class: 'hero-sep' }), el('span', {}, el('a', { class: 'text-link', href: `#/resource/${encodeURIComponent(resource.id)}/license`, text: resource.license })));

  const waveBg = elFromHtml('<svg class="hero-wave-bg" viewBox="0 0 320 160" aria-hidden="true"><g fill="currentColor"><rect x="4" y="64" width="44" height="22" rx="11"/><rect x="72" y="38" width="18" height="74" rx="9"/><rect x="110" y="10" width="18" height="130" rx="9"/><rect x="148" y="44" width="18" height="62" rx="9"/><rect x="186" y="62" width="44" height="26" rx="13"/></g></svg>');

  const hero = el('section', { class: 'detail-hero' },
    waveBg,
    el('div', { class: 'hero-top' },
      elFromHtml('<div class="hero-icon-lg" aria-hidden="true"><svg class="wave" viewBox="0 0 160 60"><g fill="currentColor"><rect x="2" y="23" width="22" height="10" rx="5"/><rect x="36" y="14" width="9" height="34" rx="4.5"/><rect x="55" y="4" width="9" height="52" rx="4.5"/><rect x="74" y="17" width="9" height="28" rx="4.5"/><rect x="93" y="23" width="22" height="10" rx="5"/></g></svg></div>'),
      el('div', { class: 'hero-text' },
        el('div', { class: 'hero-title-row' },
          el('h1', { class: 'hero-title', text: resource.title }),
          heroBadges,
        ),
        resource.subtitle ? el('p', { class: 'hero-sub', lang: 'en', text: resource.subtitle }) : null,
        el('div', { class: 'hero-meta' }, heroMeta),
      ),
    ),
    el('div', { class: 'hero-action-row' },
      el('button', { class: 'btn btn-primary', type: 'button', 'data-testid': 'download-import-btn', onclick: () => importModal(resource) }, icon('download', 16), t('下载导入')),
      favoriteToggle(resource),
      el('button', { class: 'btn btn-icon', type: 'button', 'aria-label': t('分享'), title: t('分享'), onclick: shareResource }, icon('link', 16)),
      el('span', { class: 'meta-hint' }, declarative ? t('纯 JSON 声明 · 无法执行') : t('{n} 个导入产物', { n: Math.max(1, importFileEntries(resource).length - 1) }), ' · ', t('全部免费')),
    ),
  );

  // Tabs（键盘可切换；panel 常驻 hidden）
  const tabKeys = declarative ? ['readme', 'files', 'versions'] : ['readme', 'sentences', 'files', 'versions'];
  const activeInitial = tabKeys.includes(route.query.get('tab')) ? route.query.get('tab') : 'readme';
  const labels = { readme: t('简介'), sentences: t('句子预览'), files: t('文件'), versions: t('版本与变更') };
  const counts = {
    readme: null,
    sentences: stats.sentences || null,
    files: importFileEntries(resource).length || null,
    versions: (resource.versions || []).length || 1,
  };
  const tabbar = el('div', { class: 'tabs detail-tabs', role: 'tablist', 'aria-label': t('资源详情分区') });
  const panelHost = el('div', {});
  const buttons = new Map();
  const panels = {};
  let activeTab = activeInitial;

  const select = (key, { focus = false, updateHash = true } = {}) => {
    if (!tabKeys.includes(key)) return;
    activeTab = key;
    for (const [k, btn] of buttons) {
      const on = k === key;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
      if (on && focus) btn.focus();
    }
    for (const [k, panel] of Object.entries(panels)) panel.hidden = k !== key;
    if (updateHash) {
      const params = new URLSearchParams(route.query.toString());
      params.set('tab', key);
      try { history.replaceState(null, '', `#/resource/${encodeURIComponent(resource.id)}?${params.toString()}`); } catch { /* ignore */ }
    }
  };

  const contentFor = (key) => {
    if (key === 'readme') return readmePanel(resource, pkgEntry);
    if (key === 'sentences') return sentencesPanel(resource, pkgEntry);
    if (key === 'files') return filesPanel(resource);
    return versionsPanel(resource);
  };

  for (const key of tabKeys) {
    const btn = el('button', {
      class: 'tab', type: 'button', role: 'tab', id: `tab-${key}`,
      'aria-controls': `panel-${key}`, 'aria-selected': 'false', tabindex: '-1',
      'data-testid': `tab-${key}`,
      onclick: () => select(key),
    }, labels[key], counts[key] !== null && counts[key] !== undefined ? el('span', { class: 'count', text: String(counts[key]) }) : null);
    buttons.set(key, btn);
    tabbar.append(btn);
    const panel = el('section', {
      class: 'panel', id: `panel-${key}`, role: 'tabpanel', 'aria-labelledby': `tab-${key}`,
      'data-testid': `tab-panel-${key}`, hidden: true,
    });
    panel.append(contentFor(key));
    panels[key] = panel;
    panelHost.append(panel);
  }
  tabbar.addEventListener('keydown', (e) => {
    const idx = tabKeys.indexOf(activeTab);
    let next = null;
    if (e.key === 'ArrowRight') next = tabKeys[(idx + 1) % tabKeys.length];
    else if (e.key === 'ArrowLeft') next = tabKeys[(idx - 1 + tabKeys.length) % tabKeys.length];
    else if (e.key === 'Home') next = tabKeys[0];
    else if (e.key === 'End') next = tabKeys[tabKeys.length - 1];
    if (next) { e.preventDefault(); select(next, { focus: true }); }
  });
  select(activeInitial, { updateHash: false });

  const breadcrumb = el('nav', { class: 'breadcrumb', 'aria-label': t('面包屑') },
    el('a', { href: '#/' }, t('工作台')),
    el('span', { class: 'sep', text: '/' }),
    el('a', { href: '#/market' }, t('市场')),
    category ? el('span', { class: 'sep', text: '/' }) : null,
    category ? el('a', { href: `#/category/${encodeURIComponent(category.id)}` }, pickLang(category.label, category.labelEn)) : null,
    el('span', { class: 'sep', text: '/' }),
    el('span', { class: 'current', text: resource.title }),
  );

  view.append(breadcrumb, hero);
  await nextPaint(); // 先绘制 Hero（LCP），再插入 Tabs/README
  view.append(tabbar, panelHost);

  // 课程包到达后原地刷新（README / 句子预览），不重排整页
  if (pkgPromise) {
    pkgPromise.then((loaded) => {
      if (!loaded || !view.isConnected) return;
      pkgEntry = loaded;
      if (panels.readme) panels.readme.replaceChildren(readmePanel(resource, pkgEntry));
      if (panels.sentences) panels.sentences.replaceChildren(sentencesPanel(resource, pkgEntry));
    }).catch(() => { /* 包不可用时保留目录数据 */ });
  }

  view.append(el('p', { class: 'footer-note' },
    el('span', { text: `SHADOW ${t('市场')} · ${t('全免费')}` }),
    el('span', { text: `BYOM · ${t('不托管媒体')}` }),
    el('span', { text: t('无强制登录') }),
  ));
}

export default { renderResource, renderRail };
