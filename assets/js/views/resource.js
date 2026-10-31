/** 资源详情页：标题区 + 下载导入弹层 + Tabs（README / 句子预览 / 文件 / 版本与变更）+ About 侧栏 */

import { el, fmtDuration, fmtBytes, fmtDate, fmtRelative, baseName, fmtNum, copyText } from '../dom.js';
import { icon } from '../icons.js';
import {
  getState, resourceById, pluginFor, loadPackage, loadReadmeText, creatorByHandle, categoryById,
  licenseById, isDeclarativeResource, isCoursePackage,
} from '../data.js';
import {
  breadcrumb, coverIcon, freeBadge, fixtureBadge, unknownTypeBadge, favoriteButton, tagLinks,
  asideCard, asideRow, inlineError, openModal, toast, metaItem, createTabs,
} from '../components.js';
import { importToStudio, downloadPackage, downloadImportFile, importFileEntries, getAppPortOverride } from '../importer.js';
import { MarketPoints } from '../points.js';
import { renderMarkdownInto } from '../markdown.js';
import { replaceRoute, buildHash } from '../router.js';
import { t, pickLang } from '../i18n.js';

const CONTACT_EMAIL = 'market@shadowmarket.app';
const TAB_META = {
  readme: { label: 'README', icon: 'book' },
  sentences: { label: '句子预览', icon: 'message' },
  files: { label: '文件', icon: 'file' },
  versions: { label: '版本与变更', icon: 'versions' },
  license: { label: '许可', icon: 'scale' },
};

function timeRange(start, end) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(1) : '?');
  return `${n(start)}–${n(end)}s`;
}

function tabIcon(tab) { return TAB_META[tab]?.icon || 'file'; }

function tabLabel(tab) { return t(TAB_META[tab]?.label || tab); }

function statsFrom(resource, pkgEntry) {
  if (pkgEntry?.status === 'ok' && pkgEntry.stats) return { ...pkgEntry.stats, source: 'package' };
  return { ...resource.stats, source: 'catalog' };
}

function currentVersion(resource) {
  return (Array.isArray(resource.versions) && resource.versions[0]) || {};
}

/* ---------------- 积分演示（P1 预览） ---------------- */

function recordImportReward(resource) {
  const status = MarketPoints.importRewardStatus(resource.id);
  if (status.done) {
    toast(t('本次导入已记录过 +20 积分（每个资源一次）'), { kind: 'warn' });
    return;
  }
  const result = MarketPoints.rewardImport(resource.id, resource.title);
  if (result.ok) {
    MarketPoints.addMyResource(resource, 'import');
    toast(t('已记录导入成功 +20 积分（P1 本地演示，当前 {n} 分）', { n: result.balance }), { kind: 'success', timeout: 4200 });
  } else {
    toast(t('记录失败：{reason}', { reason: result.reason === 'E_DUPLICATE' ? t('已记录过') : t('未知原因') }), { kind: 'error' });
  }
}

function makeRewardButton(resource) {
  const done = MarketPoints.importRewardStatus(resource.id).done;
  return el('button', {
    class: 'btn', type: 'button', disabled: done ? true : null,
    'data-testid': 'record-import-reward',
    onclick: () => recordImportReward(resource),
  }, icon(done ? 'check' : 'diamond', 14), done ? t('导入积分已记录（每资源一次）') : t('记录导入成功 +20 积分（本地演示）'));
}

function trackDownload(resource) {
  const added = MarketPoints.addMyResource(resource, 'download');
  toast(added.ok ? t('已开始下载，并加入「我的资源」（本地演示）') : t('已开始下载'), {
    kind: 'success', timeout: 3000,
  });
}

function copyField(text, label = t('复制深链')) {
  return el('div', { class: 'copy-field' },
    el('code', { text }),
    el('button', {
      class: 'btn btn-sm', type: 'button',
      onclick: async () => {
        const ok = await copyText(text);
        toast(ok ? t('深链已复制') : t('复制失败，请手动选择文本'), { kind: ok ? 'success' : 'error' });
      },
    }, icon('copy', 13), label),
  );
}

/* ---------------- 下载导入弹层 ---------------- */

const IMPORT_STEPS = [
  '第 1 步：下载 .shadow.json',
  '第 2 步：打开 SHADOW Studio（r19）',
  '第 3 步：File → Open Project…（Ctrl+O）',
  '第 4 步：把同名媒体拖进窗口',
  '第 5 步：播放 / 影子跟读练习',
];
const IMPORT_STEP_DESCS = [
  '带翻译的工程文件（含句子时间轴 / 翻译 / 练习配置），是本页推荐主路径。',
  '市场与 SHADOW Studio 是两个产品：市场只负责浏览与下载，桌面端负责导入与练习。',
  '在桌面端菜单选择 File → Open Project…，选中刚下载的 .shadow.json。',
  '桌面端会提示「把同名媒体拖进窗口」；把自备媒体重命名为指定名后拖入。没有媒体时可选「仅文本模式」先看句子与翻译。',
  '播放时按句子高亮与翻译做影子跟读练习；录音/评分以桌面端版本能力为准。',
];
const IMPORT_PITFALLS = [
  '① 媒体名必须与课程页公示的媒体名逐字一致，否则会新建重复 clip。',
  '② 打开后不要点 Analyze / Generate Subtitles —— 会用「待转写」覆盖包里的句子。',
  '③ 媒体必须与句子时间轴同源（同一版本视频/音频），否则对不上口型。',
];

function importOptionCard({ kind, title, desc, badge, filename, disabled }) {
  const testidMap = {
    shadowJson: 'download-shadow-json',
    srt: 'download-srt',
    shadowcourse: 'download-shadowcourse',
    readme: 'download-readme',
    declaration: 'download-declaration',
  };
  const testid = testidMap[kind] || `download-${kind}`;
  return el('div', { class: 'import-option', dataset: { kind } },
    el('div', { class: 'import-option-head' },
      el('div', { class: 'import-option-title' }, title, badge ? el('span', { class: `badge ${kind === 'shadowJson' || kind === 'declaration' ? 'badge-free' : 'badge-type'}` }, badge) : null),
      el('div', { class: 'import-option-file mono', text: filename || '—' }),
    ),
    el('p', { class: 'import-option-desc', text: desc }),
    el('button', {
      class: `btn ${kind === 'shadowJson' || kind === 'declaration' ? 'btn-primary' : ''}`, type: 'button',
      'data-testid': testid,
      disabled: disabled ? true : null,
      onclick: () => {
        if (disabled) return;
        const result = downloadImportFile(resourceRef, kind);
        if (result.ok) trackDownload(resourceRef);
        else toast(t('该资源暂未提供这个文件'), { kind: 'warn' });
      },
    }, icon('download', 14), disabled ? t('暂不可用') : t('下载')),
  );
}

let resourceRef = null;

/** 声明式资源（plugin / JSON 白名单）的下载弹层：只给 README + 声明 JSON，不展示 .shadow.json/.srt */
function declarativeDownloadModal(resource, entries) {
  const byKind = new Map(entries.map((e) => [e.kind, e]));
  const fileNote = (kind) => {
    const entry = byKind.get(kind);
    return { filename: entry?.filename || '', disabled: !entry };
  };
  const body = el('div', { class: 'import-modal' },
    el('div', { class: 'notice' },
      icon('puzzle', 16, 'notice-icon'),
      el('div', {},
        el('strong', { text: t('声明式插件资源') }),
        ' ',
        t('这是纯 JSON 声明清单：不含可执行代码、不联网、权限声明全为 false；市场只读声明，不加载也不执行任何插件代码。'),
      ),
    ),
    el('div', { class: 'import-options' },
      importOptionCard({
        kind: 'readme', title: t('下载白名单说明（README）'), badge: 'README',
        desc: t('声明式插件白名单的说明文档：资源类型、权限、边界与审核规则（纯文本）。'),
        ...fileNote('readme'),
      }),
      importOptionCard({
        kind: 'declaration', title: t('下载声明式 JSON'), badge: t('规范 / 归档'),
        desc: t('builtin-whitelist.json：市场认可的资源类型与权限声明，纯数据、不可执行。'),
        ...fileNote('declaration'),
      }),
    ),
    el('p', { class: 'points-note' }, t('插件类资源不需要 .shadow.json / .srt 导入流程：它描述的是资源类型与权限，而不是课程包。')),
    el('a', { class: 'aside-link', href: '#/about' }, t('市场与 SHADOW Studio 的产品边界 →')),
  );
  const modal = openModal({ title: t('下载插件声明文件'), body, actions: [] });
  const foot = modal?.element.querySelector('.modal-foot') || el('div', { class: 'modal-foot' });
  foot.append(el('button', { class: 'btn', type: 'button', onclick: () => modal?.close() }, t('关闭')));
  modal?.element.append(foot);
  return modal;
}

function downloadImportModal(resource) {
  resourceRef = resource;
  const entries = importFileEntries(resource);
  const byKind = new Map(entries.map((e) => [e.kind, e]));
  const fileNote = (kind) => {
    const entry = byKind.get(kind);
    if (!entry) return { url: '', filename: '', disabled: true };
    return { url: entry.url, filename: entry.filename, disabled: false };
  };
  if (isDeclarativeResource(resource)) return declarativeDownloadModal(resource, entries);

  const body = el('div', { class: 'import-modal' },
    el('div', { class: 'notice' },
      icon('shield', 16, 'notice-icon'),
      el('div', {},
        el('strong', { text: t('BYOM：媒体需自备') }),
        ' ',
        t('课程包只含句子时间轴 / 翻译 / 练习配置，不含影视媒体。请在桌面端选择你有权使用的本地媒体。'),
        resource.mediaName
          ? el('div', { class: 'media-name-note' }, icon('tag', 12), ` ${t('请把媒体重命名为：')}`, el('code', { text: resource.mediaName }))
          : null,
      ),
    ),
    el('div', { class: 'import-options' },
      importOptionCard({
        kind: 'shadowJson', title: t('下载 .shadow.json'), badge: t('推荐'),
        desc: t('带翻译的工程文件，桌面端 File → Open Project… 打开后可保留中文翻译与句子时间轴。'),
        ...fileNote('shadowJson'),
      }),
      importOptionCard({
        kind: 'srt', title: t('下载 .srt'), badge: t('备选'),
        desc: t('无翻译的通用字幕，任何播放器/工具都能用；先导入媒体，再 Import Subtitle。'),
        ...fileNote('srt'),
      }),
      importOptionCard({
        kind: 'shadowcourse', title: t('下载 .shadowcourse'), badge: t('规范 / 归档'),
        desc: t('规范载体与归档格式（当前桌面端 r19 不直接识别），用于校验、存档与未来版本。'),
        ...fileNote('shadowcourse'),
      }),
    ),
    el('div', { class: 'import-guide' },
      el('div', { class: 'import-guide-col' },
        el('h3', { class: 'import-guide-title' }, icon('upload', 14), t('5 步导入')),
        el('ol', { class: 'steps' }, IMPORT_STEPS.map((title, idx) => el('li', {},
          el('div', {},
            el('div', { class: 'step-title', text: t(title) }),
            el('div', { class: 'step-desc', text: t(IMPORT_STEP_DESCS[idx]) }),
          ),
        ))),
      ),
      el('div', { class: 'import-guide-col' },
        el('h3', { class: 'import-guide-title' }, icon('alert', 14), t('3 个坑')),
        el('ul', { class: 'pitfalls' }, IMPORT_PITFALLS.map((text) => el('li', { text: t(text) }))),
        el('p', { class: 'points-note' }, t('没有媒体时可以先看句子与翻译；录音/评分是否可用取决于桌面端版本，市场不作承诺。')),
        el('a', { class: 'aside-link', href: '#/import' }, t('导入原理与降级说明 →')),
      ),
    ),
  );

  const modal = openModal({ title: t('下载导入文件'), body, actions: [] });
  const foot = modal?.element.querySelector('.modal-foot') || el('div', { class: 'modal-foot' });
  foot.append(el('button', { class: 'btn', type: 'button', onclick: () => modal?.close() }, t('关闭')));
  modal?.element.append(foot);
  return modal;
}

/* ---------------- 一键导入（M3.8 修复路径） ---------------- */

function fallbackReasonText(result) {
  if (result.reason === 'E_POPUP') return t('检测到了 SHADOW Studio，但浏览器拦截了自动打开的新窗口。');
  if (result.reason === 'E_OVERRIDE_NOT_FOUND') return t('指定端口 {port} 上没有检测到 SHADOW Studio（未扫描默认端口区间）。', { port: result.probe?.override });
  if (result.probe?.mixedContent) return t('页面在 https 下无法探测本机 http 服务（浏览器混合内容限制）。');
  return t('没有在本机检测到 SHADOW Studio 的本地服务（已扫描 127.0.0.1:18765–18775）。');
}

function fallbackDownloadModal(resource, result) {
  const downloadHref = currentVersion(resource).packageUrl || resource.packageUrl;
  const body = el('div', {},
    el('p', { text: fallbackReasonText(result) }),
    el('p', { style: { marginTop: '10px' } },
      el('strong', { text: t('已自动降级为下载 + 手动导入：') }),
      t('课程包是纯数据 JSON，不跑 ASR、不含媒体。'),
    ),
    el('ol', { class: 'steps', style: { marginTop: '12px' } },
      el('li', {}, el('div', {},
        el('div', { class: 'step-title', text: t('下载课程包') }),
        el('div', { class: 'step-desc' }, t('点击下方「下载 .shadowcourse」，文件会保存到本机（约几十 KB）。')),
      )),
      el('li', {}, el('div', {},
        el('div', { class: 'step-title', text: t('打开 SHADOW Studio 桌面应用') }),
        el('div', { class: 'step-desc' }, t('市场与 SHADOW Studio 是两个产品：市场只负责浏览与下载，桌面端只保留「导入课程包」这一个薄接口。')),
      )),
      el('li', {}, el('div', {},
        el('div', { class: 'step-title', text: t('把文件拖进窗口（或菜单导入）') }),
        el('div', { class: 'step-desc' }, t('拖入后选一句课程包，工具会提示你选择本地媒体（BYOM）；没有媒体也可以先用「仅文本模式」。')),
      )),
    ),
    result.deepLink ? el('div', {},
      el('p', { style: { marginTop: '12px' } }, el('strong', { text: t('手动打开深链：') })),
      copyField(result.deepLink),
    ) : null,
    el('p', { class: 'points-note', style: { marginTop: '12px' } },
      t('高级用法：如果 SHADOW Studio 监听在自定义端口，可在市场地址后加 ?appPort=<端口> 后重试一键导入；默认仍扫描 18765–18775。'),
    ),
  );

  const modal = openModal({ title: t('一键导入：已降级为下载'), body, actions: [] });
  const foot = modal.element.querySelector('.modal-foot') || el('div', { class: 'modal-foot' });
  foot.append(
    el('a', {
      class: 'btn btn-primary', href: downloadHref, download: baseName(downloadHref),
      'data-testid': 'fallback-download', onclick: () => { trackDownload(resource); },
    }, icon('download', 14), t('下载 .shadowcourse')),
    makeRewardButton(resource),
    el('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, t('关闭')),
  );
  modal.element.append(foot);
  return modal;
}

function successModal(resource, result) {
  const viaLabel = result.openedVia === 'reserved' ? t('新标签页（预留窗口）') : t('新标签页');
  const body = el('div', {},
    el('p', {},
      t('已在 {addr} 打开导入深链，SHADOW Studio 会接收课程包并提示你选择本地媒体（BYOM）。', { addr: `127.0.0.1:${result.port}` }),
    ),
    el('p', { class: 'subtle', style: { marginTop: '6px' }, text: t('打开方式：{via}', { via: viaLabel }) }),
    el('p', { style: { marginTop: '8px' } }, t('导入不跑 ASR、不联网（仅取包）、不上传任何数据；没有合适媒体时可选「仅文本模式」。')),
    result.deepLink ? copyField(result.deepLink) : null,
    el('p', { class: 'points-note', style: { marginTop: '12px' } }, t('如果工具里导入成功，可点下方按钮记录 +20 积分（P1 本地演示，每个资源一次）。')),
  );
  const modal = openModal({ title: t('已发送到 SHADOW Studio'), body, actions: [] });
  let foot = modal.element.querySelector('.modal-foot');
  if (!foot) { foot = el('div', { class: 'modal-foot' }); modal.element.append(foot); }
  foot.append(
    makeRewardButton(resource),
    el('button', { class: 'btn btn-primary', type: 'button', onclick: () => modal.close() }, t('完成')),
  );
  return modal;
}

async function runImport(resource, button) {
  const setBusy = (busy) => {
    if (!button) return;
    button.disabled = busy;
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
    button.replaceChildren(
      busy ? el('span', { class: 'spinner' }) : icon('upload', 14),
      busy ? t('正在探测…') : t('一键导入到 SHADOW Studio'),
    );
  };
  setBusy(true);
  let result;
  try {
    // M3.8：不预开 about:blank 预留窗口（否则弹窗事件抓到的是 about:blank），
    // 直接在用户激活窗口内（探测约 300ms）window.open 深链；只有真正 blocked 才降级下载。
    result = await importToStudio(resource, null);
  } catch (err) {
    setBusy(false);
    toast(t('导入失败：{message}', { message: err && err.message ? err.message : String(err) }), { kind: 'error' });
    return;
  }
  setBusy(false);

  if (result.mode === 'desktop') {
    // 成功路径：不降级下载、不误报拦截；openedVia 记录在结果里（reserved / new-tab）
    MarketPoints.addMyResource(resource, 'import');
    toast(t('已检测到 SHADOW Studio（127.0.0.1:{port}），正在打开导入深链…', { port: result.port }), { kind: 'success', timeout: 4200 });
    successModal(resource, result);
    return;
  }
  if (result.mode === 'download-fallback') {
    downloadPackage(resource); // 仅真正 blocked / 未探测到时降级一次
    trackDownload(resource);
    fallbackDownloadModal(resource, result);
    return;
  }
  toast(result.message || t('该资源没有可导入的包文件'), { kind: 'error' });
}

/* ---------------- 各 Tab 面板 ---------------- */

function readmePanel(resource, pkgEntry, { reload, onFallbackReadme }) {
  const panel = el('div', { class: 'panel-inner' });
  const declarative = isDeclarativeResource(resource);
  const head = el('div', { class: 'readme-head' },
    icon('book', 14),
    el('span', { class: 'mono', text: 'README.md' }),
    el('span', { class: 'subtle', text: declarative
      ? `· ${t('来自目录（声明式资源，README 为完整说明）')}`
      : pkgEntry?.status === 'ok' ? `· ${t('来自课程包（包内 readme 为准）')}` : `· ${t('来自资源目录摘要')}` }),
  );
  panel.append(head);

  if (declarative) {
    const body = el('div', { class: 'md', 'data-testid': 'readme-content' });
    renderMarkdownInto(body, resource.readme || '', { emptyText: t('该资源没有提供 README。') });
    panel.append(body);
    return panel;
  }

  if (pkgEntry?.status === 'ok') {
    const body = el('div', { class: 'md', 'data-testid': 'readme-content' });
    renderMarkdownInto(body, pkgEntry.pkg.readme || '', { emptyText: t('课程包没有提供 README。') });
    panel.append(body);
    return panel;
  }
  if (pkgEntry?.status === 'loading') {
    panel.append(el('div', { class: 'readme-loading' },
      el('div', { class: 'sk sk-line', style: { width: '38%', height: '22px', marginBottom: '16px' } }),
      ...Array.from({ length: 6 }, (_, i) => el('div', { class: 'sk sk-line', style: { width: `${[96, 88, 92, 60, 94, 72][i]}%` } })),
    ));
    return panel;
  }

  if (pkgEntry?.status === 'error') {
    panel.append(inlineError({
      title: t('课程包加载失败，以下为目录摘要（非完整 README）'),
      message: `${pkgEntry.error?.message || t('未知错误')} · ${pkgEntry.url || resource.packageUrl}`,
      retry: () => reload(),
    }));
  }
  if (resource.readme) {
    const body = el('div', { class: 'md', style: { marginTop: '16px' }, 'data-testid': 'readme-content' });
    renderMarkdownInto(body, resource.readme);
    panel.append(body);
  } else if (pkgEntry?.status !== 'loading') {
    if (resource.importFiles?.readme) {
      panel.append(el('p', { class: 'muted', 'data-testid': 'readme-loading-note', text: t('正在读取导入说明 README…') }));
      onFallbackReadme?.(resource);
    } else {
      panel.append(el('p', { class: 'muted', style: { marginTop: '16px' }, text: t('这个资源没有提供 README。') }));
    }
  }
  return panel;
}

function sentenceNotes(notes) {
  const text = String(notes || '').trim();
  if (!text) return null;
  const node = el('div', { class: 'sent-note' });
  text.split('\n').filter(Boolean).slice(0, 6).forEach((line, idx) => {
    if (idx > 0) node.append(el('br'));
    const match = /^([^：:]{1,8})[：:]\s*(.*)$/.exec(line);
    if (match) node.append(el('b', { text: `${match[1]}：` }), match[2]);
    else node.append(document.createTextNode(line));
  });
  return node;
}

function sentencesPanel(resource, pkgEntry, { reload }) {
  const panel = el('div', { class: 'panel-inner' });

  if (pkgEntry?.status === 'loading') {
    panel.append(el('div', { class: 'sk sk-line', style: { width: '36%', height: '16px', marginBottom: '12px' } }));
    for (let i = 0; i < 3; i += 1) {
      panel.append(el('div', { class: 'sk-card', style: { marginTop: '8px' } },
        el('div', { class: 'sk sk-line', style: { width: '70%', height: '16px' } }),
        el('div', { class: 'sk sk-line', style: { width: '45%' } })));
    }
    return panel;
  }

  if (pkgEntry?.status === 'error' || pkgEntry?.status === 'missing') {
    panel.append(inlineError({
      title: t('句子预览不可用（课程包未加载）'),
      message: pkgEntry.status === 'missing' ? (pkgEntry.error || t('该资源没有 packageUrl')) : (pkgEntry.error?.message || t('未知错误')),
      retry: pkgEntry.status === 'error' ? () => reload() : null,
      actions: [{ label: t('查看文件 / 下载包'), href: resource.packageUrl ? `#/resource/${encodeURIComponent(resource.id)}?tab=files` : undefined }],
    }));
    if (resource.stats?.sentences) {
      panel.append(el('p', { class: 'muted', style: { marginTop: '12px' } },
        t('目录统计：{n} 句 · 时长约 {time}（详情页以包为准，包未加载）', { n: resource.stats.sentences, time: fmtDuration(resource.stats.durationSec) })));
    }
    return panel;
  }

  const pkg = pkgEntry.pkg;
  const stats = pkgEntry.stats;
  const summaries = el('div', { class: 'sent-summary' },
    el('span', {}, t('共 {n} 句', { n: stats.sentences })),
    el('span', {}, t('时间轴 {time}', { time: fmtDuration(stats.durationSec) })),
    el('span', {}, t('约 {n} 词', { n: stats.words })),
    el('span', {}, `${t('词级时间：')}${stats.hasWords ? t('有') : t('无（整句评分）')}`),
    el('span', {}, `${t('媒体：')}${pkg.mediaPolicy === 'byom' ? t('BYOM（包内不含媒体）') : String(pkg.mediaPolicy || '—')}`),
  );
  const filter = el('input', {
    class: 'panel-filter', type: 'search', 'aria-label': t('过滤句子'), 'data-testid': 'sentence-filter',
  });
  filter.placeholder = t('过滤句子（英文 / 中文）');
  const list = el('div', { class: 'sent-list', 'data-testid': 'sentence-list' });

  const rows = pkg.sentences.map((sentence, idx) => {
    const row = el('div', {
      class: 'sent-item', 'data-testid': 'sentence-row', dataset: { index: String(idx + 1) },
    },
      el('div', { class: 'sent-index' },
        el('span', { class: 'sent-time', title: `start ${sentence.start}s → end ${sentence.end}s`, text: timeRange(sentence.start, sentence.end) }),
        el('span', { class: 'sent-num', text: `#${String(idx + 1).padStart(2, '0')}` })),
      el('div', { class: 'sent-body' },
        el('div', { class: 'sent-en', lang: 'en', text: sentence.text || '' }),
        sentence.translation ? el('div', { class: 'sent-zh', text: sentence.translation }) : null,
        sentenceNotes(sentence.notes)),
    );
    row.__search = `${sentence.text || ''} ${sentence.translation || ''} ${sentence.notes || ''}`.toLowerCase();
    return row;
  });

  const emptyHint = el('p', { class: 'muted', hidden: true, style: { marginTop: '12px' }, text: t('没有匹配的句子，换个关键词试试。') });
  const applyFilter = () => {
    const q = filter.value.trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      const visible = !q || row.__search.includes(q);
      row.style.display = visible ? '' : 'none';
      if (visible) shown += 1;
    }
    emptyHint.hidden = shown !== 0;
  };
  filter.addEventListener('input', applyFilter);

  rows.forEach((row) => list.append(row));
  panel.append(summaries, el('div', { class: 'panel-toolbar' }, filter, el('span', { class: 'panel-toolbar-title', text: t('过滤只影响显示，不改变课程包内容') })), list, emptyHint);
  return panel;
}

function filesPanel(resource, pkgEntry, { reload }) {
  const panel = el('div', { class: 'panel-inner' });
  const version = currentVersion(resource);
  const declarative = isDeclarativeResource(resource);
  panel.append(el('div', { class: 'notice', style: { marginBottom: '14px' } },
    icon(declarative ? 'puzzle' : 'shield', 16, 'notice-icon'),
    el('div', {}, declarative
      ? `${t('声明式资源')}：${t('纯 JSON 白名单 / README，不含可执行代码；市场只读声明，不加载也不执行。')}`
      : el('span', {}, el('strong', { text: `${t('BYOM')} · ${t('包内不含媒体')}。` }), t('P0 的 .shadowcourse 是单文件 JSON（句子时间轴 + 翻译 + 练习配置），媒体由用户在桌面端自备；市场不托管也不上传任何媒体。'))),
  ));

  const entries = importFileEntries(resource);
  if (!entries.length) {
    panel.append(el('div', { class: 'file-empty', text: t('该资源没有可下载的文件（可能不是课程包类型，或由未知类型插件降级展示）。') }));
    return panel;
  }

  const hash = version.sha256 || resource.stats?.sha256 || '';
  const bytes = version.sizeBytes || resource.stats?.sizeBytes || (pkgEntry?.status === 'ok' ? pkgEntry.bytes : 0);
  const kindLabel = (kind) => {
    if (kind === 'shadowcourse') return t('课程包 · 单文件 JSON（UTF-8）');
    if (kind === 'shadowJson') return t('导入工程 · 带翻译（推荐）');
    if (kind === 'srt') return t('备选字幕 · 无翻译');
    if (kind === 'readme') return t('导入 / 白名单说明（纯文本）');
    if (kind === 'declaration') return t('声明式白名单 JSON（纯数据，不可执行）');
    return kind;
  };
  const tbody = el('tbody');
  for (const entry of entries) {
    const isPackage = entry.kind === 'shadowcourse';
    const hasBytes = isPackage || entry.kind === 'declaration';
    const tr = el('tr', { 'data-testid': isPackage ? 'file-row' : `file-row-${entry.kind}` },
      el('td', {},
        el('span', { class: 'file-name' },
          icon('file', 15, 'file-icon'),
          el('code', { text: entry.filename }),
        ),
        el('div', { class: 'subtle', style: { fontSize: '11px', marginLeft: '23px' } }, kindLabel(entry.kind)),
      ),
      el('td', {}, el('span', { class: 'file-size', text: hasBytes && bytes ? fmtBytes(bytes) : '—' })),
      el('td', { class: 'file-hash-cell' }, hasBytes && hash ? el('code', { class: 'hash', title: hash, text: `${hash.slice(0, 10)}…` }) : el('span', { class: 'subtle', text: '—' })),
      el('td', { style: { textAlign: 'right' } },
        el('a', {
          class: 'btn btn-sm', href: entry.url, download: entry.filename,
          'data-testid': isPackage ? 'file-download' : `file-download-${entry.kind}`,
          onclick: () => trackDownload(resource),
        }, icon('download', 13), t('下载')),
      ),
    );
    tbody.append(tr);
  }
  panel.append(el('div', { class: 'file-table-wrap', tabindex: '0', role: 'region', 'aria-label': t('资源文件列表') },
    el('table', { class: 'file-table' },
      el('thead', {}, el('tr', {},
        el('th', { text: t('文件') }), el('th', { text: t('大小') }), el('th', { text: t('校验（SHA256）') }), el('th', { text: t('操作') }))),
      tbody,
    ),
  ));

  const meta = el('dl', { class: 'file-meta' });
  const pushMeta = (k, v) => { meta.append(el('dt', { class: 'subtle', text: k }), el('dd', { class: 'mono', text: v })); };
  pushMeta('packageUrl', version.packageUrl || resource.packageUrl || '—');
  pushMeta(t('文件后缀'), pluginFor(resource.type).fileExt.join(' · ') || '—');
  pushMeta('SHA256', hash || '—');
  pushMeta(t('大小'), bytes ? fmtBytes(bytes) : '—');
  if (resource.mediaName) pushMeta(t('媒体命名'), resource.mediaName);
  if (pkgEntry?.status === 'ok') {
    const pkg = pkgEntry.pkg;
    pushMeta('spec', String(pkg.spec || '—'));
    pushMeta('schemaVersion', String(pkg.schemaVersion ?? '—'));
    pushMeta('mediaPolicy', String(pkg.mediaPolicy || '—'));
    pushMeta('sentences', String((pkg.sentences || []).length));
  }
  panel.append(meta);

  if (pkgEntry?.status === 'error') {
    panel.append(el('div', { style: { marginTop: '14px' } }, inlineError({
      title: t('课程包文件读取失败（下载仍可用）'),
      message: pkgEntry.error?.message || t('未知错误'),
      retry: () => reload(),
    })));
  }
  return panel;
}

function versionsPanel(resource) {
  const panel = el('div', { class: 'panel-inner' });
  const versions = Array.isArray(resource.versions) && resource.versions.length ? resource.versions : [currentVersion(resource)];
  if (!versions.length || !versions[0].version) {
    panel.append(el('p', { class: 'muted', text: t('暂无版本信息。') }));
  }
  for (let idx = 0; idx < versions.length; idx += 1) {
    const v = versions[idx];
    const compat = v.compat || {};
    const compatText = [
      compat.shadow ? `SHADOW ${compat.shadow}` : '',
      compat.schemaVersion ? `schemaVersion ${compat.schemaVersion}` : '',
    ].filter(Boolean).join(' · ');
    const row = el('div', { class: 'version-row', 'data-testid': 'version-row' },
      el('span', { class: 'version-tag' }, icon('tag', 11), `v${v.version || '—'}`),
      el('div', { class: 'version-meta' },
        el('div', {},
          el('b', { text: idx === 0 ? t('当前发布版本') : t('历史版本') }),
          ' · ',
          t('更新于 {date}（{rel}）', { date: fmtDate(v.publishedAt), rel: fmtRelative(v.publishedAt) }),
        ),
        compatText ? el('div', { class: 'subtle', style: { fontSize: '11.5px', marginTop: '2px' } }, `${t('兼容')}：${compatText}`) : null,
        v.sha256 ? el('div', { class: 'subtle mono', style: { fontSize: '11px', marginTop: '2px', overflowWrap: 'anywhere' } }, `SHA256 ${v.sha256}`) : null,
        Array.isArray(v.changelog) && v.changelog.length
          ? el('ul', { class: 'version-changes' }, v.changelog.map((line) => el('li', { text: line })))
          : null,
      ),
      el('span', { class: 'version-date', text: fmtDate(v.publishedAt) }),
    );
    panel.append(row);
  }

  panel.append(el('div', { class: 'notice', style: { marginTop: '14px' } },
    icon('info', 16, 'notice-icon'),
    el('div', {},
      'id：', el('code', { text: resource.id }),
      ' · ',
      t('版本号遵循 semver；发布后包 id 不变。'),
      ' ',
      t('P0 静态目录每个资源只发布 1 个版本'),
      `（${t('目录当前版本数')}：${versions.length}）。`,
    ),
  ));
  return panel;
}

/* ---------------- 页面 ---------------- */

function notFoundResource(view, id) {
  view.replaceChildren(el('div', { class: 'notfound', 'data-testid': 'not-found' },
    el('div', { class: 'notfound-code', 'aria-hidden': 'true', text: '404' }),
    el('h1', { class: 'notfound-title', text: t('找不到这个资源') }),
    el('p', { class: 'notfound-desc' }, t('资源 id {id} 不在当前目录中。可能已被下架，或链接来自其它版本的市场。', { id: String(id || '') })),
    el('div', { class: 'notfound-actions' },
      el('a', { class: 'btn btn-primary', href: '#/' }, icon('compass', 14), t('回到探索')),
      el('a', { class: 'btn', href: '#/search?q=' }, icon('search', 14), t('搜索资源')),
    ),
  ));
}

export async function renderResource(view, route) {
  const state = getState();
  const id = route.params.id;
  const resource = resourceById(id);
  view.replaceChildren();
  if (!resource) { notFoundResource(view, id); return; }

  const plugin = pluginFor(resource.type);
  const knownTabs = (plugin.detailTabs.length ? plugin.detailTabs : ['readme', 'sentences', 'files', 'versions']).filter((x) => TAB_META[x]);
  const tabs = knownTabs.length ? knownTabs : ['readme', 'files', 'versions'];
  if (!tabs.includes('sentences') && resource.type === 'course') tabs.splice(Math.min(1, tabs.length), 0, 'sentences');
  let activeTab = tabs.includes(route.query.get('tab')) ? route.query.get('tab') : tabs[0];
  const author = creatorByHandle(resource.author);
  const category = categoryById(resource.category);
  const license = licenseById(resource.license);
  const version = currentVersion(resource);
  const declarative = isDeclarativeResource(resource);
  const coursePackage = isCoursePackage(resource);

  // plugin / 声明式 JSON：不是 .shadowcourse，跳过包 fetch（否则会误报「包格式不识别」）
  // 课程包：首屏渲染前先取包（最多等 2.5s），一次渲染到位 → 避免包到达后重排导致 CLS；
  // 超时则先渲染骨架，包到达后再增量刷新（慢网兜底，CLS 风险可接受）。
  let initialEntry = declarative
    ? { status: 'declarative' }
    : (resource.packageUrl ? { status: 'loading' } : { status: 'missing', error: t('该资源没有 packageUrl') });
  if (!declarative && resource.packageUrl) {
    const loaded = await Promise.race([
      loadPackage(resource.packageUrl),
      new Promise((resolve) => { setTimeout(() => resolve(null), 2500); }),
    ]);
    if (loaded) initialEntry = loaded;
  }
  const pkgState = { entry: initialEntry };
  let readmeFallback = null;

  const titleBadges = el('span', { class: 'repo-title-badges' },
    freeBadge(resource),
    plugin.fallback ? unknownTypeBadge() : el('span', { class: 'badge badge-type', title: `${t('资源类型')}：${plugin.id}` }, pickLang(plugin.label, plugin.labelEn)),
    (state.fixture || resource.fixture) ? fixtureBadge() : null,
    resource.level ? el('span', { class: 'badge badge-level', title: t('难度') }, resource.level) : null,
    declarative
      ? el('span', { class: 'badge badge-bym', title: t('声明式资源：纯 JSON 声明，不含可执行代码') }, icon('puzzle', 11), t('声明式'))
      : el('span', { class: 'badge badge-bym', title: t('BYOM：媒体需自备') }, icon('shield', 11), 'BYOM'),
    version.version ? el('span', { class: 'badge badge-version mono', title: t('当前发布版本') }, `v${version.version}`) : null,
  );

  const actions = el('div', { class: 'repo-actions', 'data-testid': 'detail-actions' });
  const downloadImportBtn = el('button', {
    class: 'btn btn-primary btn-lg', type: 'button', 'data-testid': 'download-import-btn',
    onclick: () => downloadImportModal(resource),
  }, icon('download', 15), declarative ? t('下载文件') : t('下载导入'));
  actions.append(downloadImportBtn);

  let importBtn = null;
  if (!declarative) {
    importBtn = el('button', {
      class: 'btn btn-lg', type: 'button', 'data-testid': 'import-btn',
      onclick: () => runImport(resource, importBtn),
    }, icon('upload', 15), t('一键导入到 SHADOW Studio'));
    actions.append(importBtn);
  }

  const pkgUrl = version.packageUrl || resource.packageUrl;
  if (pkgUrl && coursePackage) {
    actions.append(el('a', {
      class: 'btn btn-lg', href: pkgUrl, download: baseName(pkgUrl),
      'data-testid': 'download-btn', onclick: () => trackDownload(resource),
    }, icon('download', 15), t('下载 .shadowcourse')));
  } else if (pkgUrl && declarative) {
    actions.append(el('a', {
      class: 'btn btn-lg', href: pkgUrl, download: baseName(pkgUrl),
      'data-testid': 'download-declaration-btn', onclick: () => trackDownload(resource),
    }, icon('download', 15), t('下载声明式 JSON')));
  }
  actions.append(favoriteButton(resource, { className: 'btn-lg' }));
  actions.append(el('button', {
    class: 'btn btn-lg', type: 'button', 'data-testid': 'share-btn',
    onclick: async () => {
      const ok = await copyText(window.location.href);
      toast(ok ? t('链接已复制') : t('复制失败，请手动选择地址栏'), { kind: ok ? 'success' : 'error' });
    },
  }, icon('link', 15), t('分享')));
  if (resource.points > 0) {
    actions.append(el('button', {
      class: 'btn btn-lg', type: 'button', 'data-testid': 'redeem-btn',
      onclick: () => {
        const result = MarketPoints.redeem(resource);
        if (result.ok) toast(t('兑换成功，扣除 {n} 积分（P1 本地演示，余额 {balance}）', { n: resource.points, balance: result.balance }), { kind: 'success' });
        else if (result.reason === 'E_INSUFFICIENT') toast(t('积分不足：需要 {n} 分，当前 {balance} 分。', { n: resource.points, balance: MarketPoints.getPoints() }), { kind: 'warn', timeout: 4800 });
        else if (result.reason === 'E_DUPLICATE') toast(t('这个资源已经兑换过了（P1 本地演示）'), { kind: 'warn' });
        else toast(t('兑换失败：{reason}', { reason: result.reason }), { kind: 'error' });
      },
    }, icon('diamond', 15), t('兑换（{n} 积分）', { n: resource.points })));
  }

  const appPortOverride = getAppPortOverride();
  const advancedHint = el('div', { class: 'repo-actions-note' },
    declarative
      ? t('声明式资源：纯 JSON 声明（资源类型 / 权限），不含可执行代码，没有课程包导入流程。')
      : pkgUrl
        ? t('会先探测本机 SHADOW Studio（127.0.0.1:18765–18775，单端口 300ms 超时）；未检测到会自动降级为下载 + 3 步说明。高级：')
        : t('该资源没有可导入的包文件。'),
    !declarative && pkgUrl ? el('a', { href: '#/import' }, t('导入原理')) : null,
    declarative ? el('a', { href: '#/about' }, t('产品边界')) : null,
    !declarative && pkgUrl ? el('span', { class: 'subtle', text: appPortOverride ? ` · ?appPort=${appPortOverride}` : ` · ${t('可用 ?appPort=<端口> 指定自定义端口')}` }) : null,
  );

  const tabHost = el('div', { class: 'tab-host' });
  const detailMain = el('div', { class: 'detail-main' });
  const aside = el('div', { class: 'detail-aside', 'data-testid': 'detail-aside' });
  let tabsCtl = null;
  let tabsReady = false;

  const tabCounts = () => ({
    readme: null,
    sentences: pkgState.entry?.status === 'ok' ? pkgState.entry.stats.sentences : (resource.stats?.sentences || null),
    files: importFileEntries(resource).length || null,
    versions: resource.versions?.length || 1,
    license: null,
  });

  const updateHashTab = (key) => {
    // 只替换地址栏 hash，不触发 router 重渲染：键盘切换 Tabs 时保持焦点不变（a11y）
    const params = new URLSearchParams(route.query.toString());
    params.set('tab', key);
    const target = buildHash(`/resource/${encodeURIComponent(resource.id)}`, params.toString());
    try { history.replaceState(null, '', target); } catch { /* 忽略 */ }
  };

  const reload = async () => {
    if (declarative) return;
    pkgState.entry = { status: 'loading' };
    renderTabs();
    renderAside();
    pkgState.entry = await loadPackage(resource.packageUrl, { force: true });
    renderTabs();
    renderAside();
  };

  const fallbackReadme = async (res) => {
    const text = await loadReadmeText(res);
    if (!text) return;
    readmeFallback = text;
    if (!view.isConnected) return;
    const panel = tabHost.querySelector('#panel-panel-readme .panel-inner');
    if (!panel) return;
    panel.querySelector('[data-testid="readme-loading-note"]')?.remove();
    const body = el('div', { class: 'md', style: { marginTop: '12px' }, 'data-testid': 'readme-content' });
    renderMarkdownInto(body, text);
    panel.append(body);
  };

  function renderTabs() {
    const counts = tabCounts();
    tabHost.replaceChildren();
    const items = tabs.map((key) => ({ key, label: tabLabel(key), icon: tabIcon(key), count: counts[key] }));
    tabsReady = false;
    tabsCtl = createTabs({
      idPrefix: 'panel',
      items,
      active: activeTab,
      label: t('资源详情分区'),
      onSelect: (key) => {
        activeTab = key;
        if (tabsReady) updateHashTab(key);
      },
    });
    tabsHostAppend();
    tabsReady = true;
  }

  function tabsHostAppend() {
    tabHost.append(tabsCtl.tablist, tabsCtl.panelHost);
    for (const key of tabs) {
      const panel = tabsCtl.panelHost.querySelector(`#panel-panel-${key}`);
      if (!panel) continue;
      const content = key === 'readme' ? readmePanel(resource, pkgState.entry, { reload, onFallbackReadme: fallbackReadme })
        : key === 'sentences' ? sentencesPanel(resource, pkgState.entry, { reload })
          : key === 'files' ? filesPanel(resource, pkgState.entry, { reload })
            : key === 'versions' ? versionsPanel(resource)
              : readmePanel(resource, pkgState.entry, { reload });
      panel.append(content);
    }
  }

  function renderAside() {
    aside.replaceChildren();
    const pkgEntry = pkgState.entry;
    const stats = statsFrom(resource, pkgEntry);
    aside.append(asideCard(t('关于'),
      el('p', { class: 'aside-desc', text: resource.description || t('暂无描述。') }),
      resource.tags.length ? tagLinks(resource.tags, { limit: 12 }) : null,
      el('div', { class: 'row', style: { marginTop: '4px' } },
        el('span', { class: 'byom-chip' }, icon('shield', 12), `${t('BYOM · 不含媒体')}`),
      ),
    ));

    aside.append(asideCard(t('统计（以包为准）'),
      el('div', { class: 'stat-grid' },
        el('div', { class: 'stat-cell' }, el('div', { class: 'stat-num', text: fmtNum(stats.sentences) }), el('div', { class: 'stat-label', text: t('句子') })),
        el('div', { class: 'stat-cell' }, el('div', { class: 'stat-num', text: fmtDuration(stats.durationSec) }), el('div', { class: 'stat-label', text: t('时间轴') })),
        el('div', { class: 'stat-cell' }, el('div', { class: 'stat-num', text: fmtNum(stats.words) }), el('div', { class: 'stat-label', text: t('词数') })),
      ),
      el('p', { class: 'points-note', text: stats.source === 'package' ? t('句子数与时长来自课程包（详情页以包为准）。') : t('课程包未加载，显示目录索引统计。') }),
      pkgEntry?.status === 'ok' ? asideRow(t('包大小'), fmtBytes(pkgEntry.bytes)) : null,
      version.sizeBytes ? asideRow(t('下载大小'), fmtBytes(version.sizeBytes)) : null,
    ));

    if (declarative) {
      aside.append(asideCard(t('声明文件'),
        el('p', { class: 'aside-desc', text: t('声明式资源：市场只读声明、不加载执行；权限声明全为 false。') }),
        asideRow(t('载体'), el('span', { class: 'mono', text: baseName(version.packageUrl || resource.packageUrl) || 'JSON' })),
        version.sizeBytes ? asideRow(t('大小'), fmtBytes(version.sizeBytes)) : null,
        asideRow(t('可执行代码'), t('无')),
        asideRow(t('权限'), Object.entries(plugin.permissions || {}).map(([k, v]) => `${k}: ${v ? t('是') : t('否')}`).join(' · ') || '—'),
        resource.mediaName ? asideRow(t('媒体命名'), el('code', { text: resource.mediaName })) : null,
      ));
    }

    const about = asideCard(t('资源信息'));
    about.append(
      asideRow(t('资源类型'), plugin.fallback ? plugin.label : el('a', { href: `#/search?q=&type=${encodeURIComponent(plugin.id)}` }, pickLang(plugin.label, plugin.labelEn))),
      asideRow(t('分类'), category ? el('a', { href: `#/category/${encodeURIComponent(category.id)}` }, pickLang(category.label, category.labelEn)) : (resource.category || '—')),
      asideRow(t('难度'), resource.level || '—'),
      asideRow(t('许可'), license
        ? el('a', { href: `#/resource/${encodeURIComponent(resource.id)}/license` }, license.name)
        : el('a', { href: `#/resource/${encodeURIComponent(resource.id)}/license` }, resource.license || '—')),
      asideRow(t('版本'), el('span', { class: 'mono', text: `v${version.version || '—'}` })),
      asideRow(t('作者'), author ? el('a', { href: `#/creator/${encodeURIComponent(author.handle)}` }, author.name) : (resource.author || '—')),
      asideRow(t('更新'), fmtDate(resource.updatedAt) || '—'),
      asideRow(t('下载数'), `${fmtNum(resource.downloads)} · ${t('示例统计')}`),
    );
    aside.append(about);

    // BYOM 说明（P0 硬边界）
    aside.append(asideCard(declarative ? t('声明式边界') : t('BYOM 与边界'),
      el('p', { class: 'aside-desc' }, declarative
        ? t('插件类资源是纯 JSON 声明清单：不含脚本 / 可执行代码，市场不加载也不执行；权限声明全为 false。')
        : t('包内不含媒体：市场不托管、不上传、不分发任何影视媒体。导入后由你在桌面端选择本地媒体。')),
      asideRow(t('媒体策略'), declarative ? t('不适用（声明式资源）') : 'BYOM'),
      asideRow(t('语言'), (resource.language || []).join(' / ') || '—'),
      asideRow(t('平台'), (resource.platforms || []).join(' · ') || '—'),
      resource.requires?.shadow ? asideRow(t('兼容'), `SHADOW ${resource.requires.shadow}`) : null,
    ));

    if (plugin.fallback) {
      aside.append(asideCard(t('插件状态'),
        el('p', { class: 'aside-desc', text: t('该资源类型没有找到可用的插件清单（plugins/<type>/manifest.json），市场已降级为通用卡片与通用详情渲染，不会崩溃。') }),
      ));
    } else {
      aside.append(asideCard(t('插件声明'),
        el('p', { class: 'aside-desc' }, t('资源类型由声明式插件清单注册，市场只读声明、不执行插件代码。'), ' ', el('code', { text: plugin.id })),
        asideRow(t('插件清单'), el('a', { href: `plugins/${encodeURIComponent(plugin.id)}/manifest.json`, target: '_blank', rel: 'noopener' }, 'manifest.json')),
        asideRow(t('导入方式'), plugin.install?.mode || 'download-only'),
      ));
    }

    aside.append(asideCard(t('反馈与投诉'),
      el('p', { class: 'aside-desc', text: t('资源失效、内容问题或版权投诉，都可以直接联系我们。') }),
      el('a', { class: 'aside-link', href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`[SHADOW 市场] 资源反馈：${resource.id}`)}` }, icon('mail', 13), t('发送邮件反馈')),
      el('a', { class: 'aside-link', href: '#/complaint' }, icon('scale', 13), t('版权投诉')),
    ));
  }

  const head = el('header', { class: 'repo-head' },
    breadcrumb([
      { label: t('市场'), href: '#/' },
      category ? { label: pickLang(category.label, category.labelEn), href: `#/category/${encodeURIComponent(category.id)}` } : null,
      { label: resource.title },
    ].filter(Boolean)),
    el('div', { class: 'repo-title-row' },
      coverIcon(resource, { size: 'lg' }),
      el('div', { class: 'repo-heading' },
        el('h1', { class: 'repo-title' }, resource.title, titleBadges),
        resource.subtitle ? el('p', { class: 'repo-subtitle', lang: 'en', text: resource.subtitle }) : null,
      ),
    ),
    resource.description ? el('p', { class: 'repo-description', text: resource.description }) : null,
    actions,
    advancedHint,
  );

  renderTabs();
  renderAside();
  detailMain.append(tabHost);
  view.append(head, el('div', { class: 'detail-grid' }, detailMain, aside));

  // 慢网兜底：首屏用了加载骨架、包随后才到 → 增量刷新（正常网络在首屏渲染前已取到包）
  if (!declarative && resource.packageUrl && pkgState.entry?.status === 'loading') {
    loadPackage(resource.packageUrl).then((entry) => {
      if (!view.isConnected) return;
      pkgState.entry = entry;
      renderTabs();
      renderAside();
      if (entry.status === 'ok' && !String(entry.pkg?.readme || '').trim() && resource.importFiles?.readme) {
        fallbackReadme(resource);
      }
    });
  }
}
