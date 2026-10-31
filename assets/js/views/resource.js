/** 资源详情页：标题栏 + 收藏/下载/一键导入 + Tabs（README / 句子预览 / 文件 / 版本）+ About 侧栏 */

import { el, frag, fmtDuration, fmtBytes, fmtDate, fmtRelative, baseName, fmtNum } from '../dom.js';
import { icon } from '../icons.js';
import {
  getState, resourceById, pluginFor, loadPackage, creatorByHandle, categoryById,
} from '../data.js';
import {
  breadcrumb, coverIcon, freeBadge, fixtureBadge, unknownTypeBadge, favoriteButton,
  asideCard, asideRow, inlineError, openModal, toast, metaItem,
} from '../components.js';
import { importToStudio, downloadPackage, getAppPortOverride } from '../importer.js';
import { MarketPoints } from '../points.js';
import { renderMarkdownInto } from '../markdown.js';
import { replaceRoute } from '../router.js';

const TAB_META = {
  readme: { label: 'README', icon: 'book' },
  sentences: { label: '句子预览', icon: 'message' },
  files: { label: '文件', icon: 'file' },
  versions: { label: '版本', icon: 'versions' },
};

function timeRange(start, end) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(1) : '?');
  return `${n(start)}–${n(end)}s`;
}

function tabIcon(tab) { return TAB_META[tab]?.icon || 'file'; }

function tabLabel(tab) { return TAB_META[tab]?.label || tab; }

function statsFrom(resource, pkgEntry) {
  if (pkgEntry?.status === 'ok' && pkgEntry.stats) return { ...pkgEntry.stats, source: 'package' };
  return { ...resource.stats, source: 'catalog' };
}

/* ---------------- 导入 / 下载 ---------------- */

function recordImportReward(resource) {
  const status = MarketPoints.importRewardStatus(resource.id);
  if (status.done) {
    toast('本次导入已记录过 +20 积分（每个资源一次）', { kind: 'warn' });
    return;
  }
  const result = MarketPoints.rewardImport(resource.id, resource.title);
  if (result.ok) {
    MarketPoints.addMyResource(resource, 'import');
    toast(`已记录导入成功 +20 积分（P1 本地演示，当前 ${result.balance} 分）`, { kind: 'success', timeout: 4200 });
  } else {
    toast('记录失败：' + (result.reason === 'E_DUPLICATE' ? '已记录过' : '未知原因'), { kind: 'error' });
  }
}

function makeRewardButton(resource) {
  const done = MarketPoints.importRewardStatus(resource.id).done;
  return el('button', {
    class: 'btn', type: 'button', disabled: done ? true : null,
    'data-testid': 'record-import-reward',
    onclick: () => recordImportReward(resource),
  }, icon(done ? 'check' : 'diamond', 14), done ? '导入积分已记录（每资源一次）' : '记录导入成功 +20 积分（本地演示）');
}

function downloadFallbackModal(resource, result) {
  const downloadHref = resource.packageUrl;
  const reasonText = (() => {
    if (result.reason === 'E_POPUP') return '检测到了 SHADOW Studio，但浏览器拦截了自动打开的新窗口。';
    if (result.reason === 'E_OVERRIDE_NOT_FOUND') return `指定端口 ${result.probe?.override} 上没有检测到 SHADOW Studio（未扫描默认端口区间）。`;
    if (result.probe?.mixedContent) return '页面在 https 下无法探测本机 http 服务（浏览器混合内容限制）。';
    return '没有在本机检测到 SHADOW Studio 的本地服务（已扫描 127.0.0.1:18765–18775）。';
  })();

  const body = el('div', {},
    el('p', { text: reasonText }),
    el('p', { style: { marginTop: '10px' } },
      el('strong', { text: '已自动降级为下载 + 手动导入：' }),
      '课程包是纯数据 JSON，不跑 ASR、不含媒体。',
    ),
    el('ol', { class: 'steps', style: { marginTop: '12px', counterReset: 'step' } },
      el('li', {},
        el('div', {},
          el('div', { class: 'step-title', text: '下载课程包' }),
          el('div', { class: 'step-desc' }, '点击下方「下载 .shadowcourse」，文件会保存到本机（约几十 KB）。'),
        )),
      el('li', {},
        el('div', {},
          el('div', { class: 'step-title', text: '打开 SHADOW Studio 桌面应用' }),
          el('div', { class: 'step-desc' }, '市场与 SHADOW Studio 是两个产品：市场只负责浏览与下载，桌面端只保留「导入课程包」这一个薄接口。'),
        )),
      el('li', {},
        el('div', {},
          el('div', { class: 'step-title', text: '把文件拖进窗口（或菜单导入）' }),
          el('div', { class: 'step-desc' }, '拖入后选一句课程包，工具会提示你选择本地媒体（BYOM）；没有媒体也可以先用「仅文本模式」。'),
        )),
    ),
    result.deepLink ? el('div', {},
      el('p', { style: { marginTop: '12px' } }, el('strong', { text: '手动打开深链：' })),
      el('div', { class: 'copy-field' },
        el('code', { text: result.deepLink }),
        el('button', {
          class: 'btn btn-sm', type: 'button',
          onclick: async (e) => {
            try { await navigator.clipboard.writeText(result.deepLink); toast('深链已复制', { kind: 'success' }); } catch { toast('复制失败，请手动选择文本', { kind: 'error' }); }
          },
        }, icon('copy', 13), '复制'),
      ),
    ) : null,
    el('p', { class: 'points-note', style: { marginTop: '12px' } },
      '高级用法：如果 SHADOW Studio 监听在自定义端口，可在市场地址后加 ?appPort=<端口>（例如 ',
      el('code', { text: '#/resource/' + resource.id + '?appPort=18770' }),
      '）后重试一键导入；默认仍扫描 18765–18775。',
    ),
  );

  const modal = openModal({ title: '一键导入：已降级为下载', body, actions: [] });
  const foot = modal.element.querySelector('.modal-foot') || el('div', { class: 'modal-foot' });
  foot.append(
    el('a', {
      class: 'btn btn-primary', href: downloadHref, download: baseName(downloadHref),
      'data-testid': 'fallback-download', onclick: () => { trackDownload(resource); },
    }, icon('download', 14), '下载 .shadowcourse'),
    makeRewardButton(resource),
    el('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, '关闭'),
  );
  modal.element.append(foot);
}

function successModal(resource, result) {
  const body = el('div', {},
    el('p', {},
      '已在 ', el('strong', { text: `127.0.0.1:${result.port}` }), ' 打开导入深链，SHADOW Studio 会接收课程包并提示你选择本地媒体（BYOM）。',
    ),
    el('p', { style: { marginTop: '8px' } }, '导入不跑 ASR、不联网（仅取包）、不上传任何数据；没有合适媒体时可选「仅文本模式」。'),
    el('div', { class: 'copy-field', style: { marginTop: '12px' } },
      el('code', { text: result.deepLink }),
      el('button', {
        class: 'btn btn-sm', type: 'button',
        onclick: async () => {
          try { await navigator.clipboard.writeText(result.deepLink); toast('深链已复制', { kind: 'success' }); } catch { toast('复制失败', { kind: 'error' }); }
        },
      }, icon('copy', 13), '复制深链'),
    ),
    el('p', { class: 'points-note', style: { marginTop: '12px' } }, '如果工具里导入成功，可点下方按钮记录 +20 积分（P1 本地演示，每个资源一次）。'),
  );
  const modal = openModal({ title: '已发送到 SHADOW Studio', body, actions: [] });
  let foot = modal.element.querySelector('.modal-foot');
  if (!foot) { foot = el('div', { class: 'modal-foot' }); modal.element.append(foot); }
  foot.append(
    el('a', { class: 'btn', href: resource.packageUrl, download: baseName(resource.packageUrl), onclick: () => trackDownload(resource) }, icon('download', 14), '同时下载一份'),
    makeRewardButton(resource),
    el('button', { class: 'btn btn-primary', type: 'button', onclick: () => modal.close() }, '完成'),
  );
}

function trackDownload(resource) {
  const added = MarketPoints.addMyResource(resource, 'download');
  toast(added.ok ? '已开始下载，并加入「我的资源」（本地演示）' : '已开始下载 .shadowcourse', {
    kind: 'success',
    timeout: 3000,
  });
}

async function runImport(resource, button) {
  const setBusy = (busy, label) => {
    if (!button) return;
    button.disabled = busy;
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
    button.replaceChildren(
      busy ? el('span', { class: 'spinner' }) : icon('upload', 14),
      busy ? (label || '正在探测…') : '一键导入到 SHADOW Studio',
    );
  };
  // 同步预留窗口，避免异步探测后弹窗被拦截
  let reserved = null;
  try { reserved = window.open('', '_blank'); } catch { reserved = null; }
  setBusy(true);
  let result;
  try {
    result = await importToStudio(resource, reserved);
  } catch (err) {
    if (reserved) { try { reserved.close(); } catch { /* ignore */ } }
    setBusy(false);
    toast('导入失败：' + (err && err.message ? err.message : String(err)), { kind: 'error' });
    return;
  }
  setBusy(false);
  if (result.mode === 'desktop') {
    MarketPoints.addMyResource(resource, 'import');
    toast(`已检测到 SHADOW Studio（127.0.0.1:${result.port}），正在打开导入深链…`, { kind: 'success', timeout: 4200 });
    successModal(resource, result);
  } else if (result.mode === 'download-fallback') {
    downloadPackage(resource);
    trackDownload(resource);
    downloadFallbackModal(resource, result);
  } else {
    toast(result.message || '该资源没有可导入的包文件', { kind: 'error' });
  }
}

/* ---------------- 各 Tab 面板 ---------------- */

function readmePanel(resource, pkgEntry, { reload }) {
  const panel = el('div', { class: 'tab-panel', role: 'tabpanel', id: 'panel-readme', 'aria-label': 'README', 'data-testid': 'tab-panel-readme' });
  const head = el('div', { class: 'readme-head' },
    icon('book', 14),
    el('span', { class: 'mono', text: 'README.md' }),
    el('span', { class: 'subtle', text: pkgEntry?.status === 'ok' ? '· 来自课程包（包内 readme 为准）' : '· 来自资源目录摘要' }),
  );
  panel.append(head);

  if (pkgEntry?.status === 'ok') {
    const body = el('div', { class: 'md', 'data-testid': 'readme-content' });
    renderMarkdownInto(body, pkgEntry.pkg.readme || '', { emptyText: '课程包没有提供 README。' });
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

  // 包加载失败：展示可读错误 + 目录摘要兜底，不白屏
  if (pkgEntry?.status === 'error') {
    panel.append(inlineError({
      title: '课程包加载失败，以下为目录摘要（非完整 README）',
      message: `${pkgEntry.error?.message || '未知错误'} · ${pkgEntry.url || resource.packageUrl}`,
      retry: () => reload(),
    }));
  }
  if (resource.readme) {
    const body = el('div', { class: 'md', style: { marginTop: '16px' }, 'data-testid': 'readme-content' });
    renderMarkdownInto(body, resource.readme);
    panel.append(body);
  } else if (pkgEntry?.status !== 'loading') {
    panel.append(el('p', { class: 'muted', style: { marginTop: '16px' }, text: '这个资源没有提供 README。' }));
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
    if (match) {
      node.append(el('b', { text: `${match[1]}：` }), match[2]);
    } else {
      node.append(document.createTextNode(line));
    }
  });
  return node;
}

function sentencesPanel(resource, pkgEntry, { reload }) {
  const panel = el('div', { class: 'tab-panel', role: 'tabpanel', id: 'panel-sentences', 'aria-label': '句子预览', 'data-testid': 'tab-panel-sentences' });

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
      title: '句子预览不可用（课程包未加载）',
      message: pkgEntry.status === 'missing' ? (pkgEntry.error || '该资源没有 packageUrl') : (pkgEntry.error?.message || '未知错误'),
      retry: pkgEntry.status === 'error' ? () => reload() : null,
      actions: [{ label: '查看文件 / 下载包', href: resource.packageUrl ? '#/resource/' + encodeURIComponent(resource.id) + '?tab=files' : undefined }],
    }));
    if (resource.stats?.sentences) {
      panel.append(el('p', { class: 'muted', style: { marginTop: '12px' } },
        `目录统计：${resource.stats.sentences} 句 · 时长约 ${fmtDuration(resource.stats.durationSec)}（详情页以包为准，包未加载）`));
    }
    return panel;
  }

  const pkg = pkgEntry.pkg;
  const stats = pkgEntry.stats;
  const summaries = el('div', { class: 'sent-summary' },
    el('span', {}, '共 ', el('b', { text: String(stats.sentences) }), ' 句'),
    el('span', {}, '时间轴 ', el('b', { text: fmtDuration(stats.durationSec) })),
    el('span', {}, '约 ', el('b', { text: String(stats.words) }), ' 词'),
    el('span', {}, '词级时间：', el('b', { text: stats.hasWords ? '有' : '无（整句评分）' })),
    el('span', {}, '媒体：', el('b', { text: pkg.mediaPolicy === 'byom' ? 'BYOM（包内不含媒体）' : String(pkg.mediaPolicy || '—') })),
  );
  const filter = el('input', {
    class: 'panel-filter', type: 'search', placeholder: '过滤句子（英文 / 中文）', 'aria-label': '过滤句子', 'data-testid': 'sentence-filter',
  });
  const list = el('div', { class: 'sent-list', 'data-testid': 'sentence-list' });

  const rows = pkg.sentences.map((sentence, idx) => {
    const row = el('div', {
      class: 'sent-item',
      'data-testid': 'sentence-row',
      dataset: { index: String(idx + 1) },
    },
      el('div', { class: 'sent-index' },
        el('span', { class: 'sent-time', title: `start ${sentence.start}s → end ${sentence.end}s`, text: timeRange(sentence.start, sentence.end) }),
        el('span', { class: 'sent-num', text: `#${String(idx + 1).padStart(2, '0')}` })),
      el('div', { class: 'sent-body' },
        el('div', { class: 'sent-en', text: sentence.text || '' }),
        sentence.translation ? el('div', { class: 'sent-zh', text: sentence.translation }) : null,
        sentenceNotes(sentence.notes)),
    );
    row.__search = `${sentence.text || ''} ${sentence.translation || ''} ${sentence.notes || ''}`.toLowerCase();
    return row;
  });

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
  const emptyHint = el('p', { class: 'muted', hidden: true, style: { marginTop: '12px' }, text: '没有匹配的句子，换个关键词试试。' });

  rows.forEach((row) => list.append(row));
  panel.append(summaries, el('div', { class: 'panel-toolbar' }, filter, el('span', { class: 'panel-toolbar-title', text: '过滤只影响显示，不改变课程包内容' })), list, emptyHint);
  return panel;
}

function filesPanel(resource, pkgEntry, { reload }) {
  const panel = el('div', { class: 'tab-panel', role: 'tabpanel', id: 'panel-files', 'aria-label': '文件', 'data-testid': 'tab-panel-files' });
  const note = el('div', { class: 'notice', style: { marginBottom: '14px' } },
    icon('shield', 16, 'notice-icon'),
    el('div', {}, el('strong', { text: 'BYOM · 包内不含媒体。' }), 'P0 的 ', el('code', { text: '.shadowcourse' }), ' 是单文件 JSON（句子时间轴 + 翻译 + 练习配置），媒体由用户在桌面端自备；市场不托管也不上传任何媒体。'),
  );
  panel.append(note);

  if (!resource.packageUrl) {
    panel.append(el('div', { class: 'file-empty', text: '该资源没有 packageUrl（可能不是课程包类型，或由未知类型插件降级展示）。' }));
    return panel;
  }

  const fileName = baseName(resource.packageUrl);
  const size = pkgEntry?.status === 'ok' ? pkgEntry.bytes : null;
  const rows = el('tbody');
  const tr = el('tr', { 'data-testid': 'file-row' },
    el('td', {},
      el('span', { class: 'file-name' },
        icon('file', 15, 'file-icon'),
        el('code', { text: fileName }),
      ),
      el('div', { class: 'subtle', style: { fontSize: '11px', marginLeft: '23px' }, text: '课程包 · 单文件 JSON（UTF-8）' }),
    ),
    el('td', {}, el('span', { class: 'file-size', text: size ? fmtBytes(size) : (pkgEntry?.status === 'loading' ? '加载中…' : '—') })),
    el('td', { style: { textAlign: 'right' } },
      el('a', { class: 'btn btn-sm', href: resource.packageUrl, download: fileName, 'data-testid': 'file-download', onclick: () => trackDownload(resource) }, icon('download', 13), '下载')),
  );
  rows.append(tr);
  panel.append(el('table', { class: 'file-table', 'aria-label': '课程包文件列表' },
    el('thead', {}, el('tr', {}, el('th', { text: '文件' }), el('th', { text: '大小' }), el('th', { text: '操作' }))),
    rows,
  ));

  const meta = el('dl', { class: 'aside-card', style: { marginTop: '16px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.6fr)', gap: '4px 16px', fontSize: '12.5px' } });
  const pushMeta = (k, v) => { meta.append(el('dt', { class: 'subtle', text: k }), el('dd', { class: 'mono', style: { margin: '0', overflowWrap: 'anywhere' }, text: v })); };
  pushMeta('packageUrl', resource.packageUrl);
  pushMeta('类型插件', `${pluginFor(resource.type).id} · plugins/${pluginFor(resource.type).id}/manifest.json`);
  if (pkgEntry?.status === 'ok') {
    const pkg = pkgEntry.pkg;
    pushMeta('spec', String(pkg.spec || '—'));
    pushMeta('schemaVersion', String(pkg.schemaVersion ?? '—'));
    pushMeta('package id', String(pkg.id || resource.id));
    pushMeta('mediaPolicy', String(pkg.mediaPolicy || '—'));
    pushMeta('sentences', String(pkg.sentences.length));
  }
  pushMeta('文件后缀', pluginFor(resource.type).fileExt.join(' · ') || '—');
  panel.append(meta);

  if (pkgEntry?.status === 'error') {
    panel.append(el('div', { style: { marginTop: '14px' } }, inlineError({
      title: '课程包文件读取失败（下载仍可用）',
      message: pkgEntry.error?.message || '未知错误',
      retry: () => reload(),
    })));
  }
  return panel;
}

function versionsPanel(resource, pkgEntry) {
  const panel = el('div', { class: 'tab-panel', role: 'tabpanel', id: 'panel-versions', 'aria-label': '版本', 'data-testid': 'tab-panel-versions' });
  const pkg = pkgEntry?.status === 'ok' ? pkgEntry.pkg : null;
  const version = pkg?.version || resource.version || '1.0.0';
  const updated = pkg?.updatedAt || resource.updatedAt;
  const created = pkg?.createdAt || resource.createdAt;

  panel.append(el('div', { class: 'version-row', 'data-testid': 'version-row' },
    el('span', { class: 'version-tag' }, icon('tag', 11), `v${version}`),
    el('div', { class: 'version-meta' },
      el('div', {}, el('b', { text: '当前发布版本' }), ' · 更新于 ', fmtDate(updated), '（', fmtRelative(updated), '）'),
      el('div', { class: 'subtle', style: { fontSize: '11.5px', marginTop: '2px' } },
        `spec ${pkg?.spec || 'shadow.course'} · schemaVersion ${pkg?.schemaVersion ?? '—'} · 许可 ${resource.license || pkg?.license || '—'}`,
      ),
    ),
    el('span', { class: 'version-date', text: fmtDate(updated) }),
  ));
  panel.append(el('div', { class: 'version-row' },
    el('span', { class: 'version-tag', style: { opacity: '0.6' } }, icon('clock', 11), 'v—'),
    el('div', { class: 'version-meta' },
      el('div', {}, el('b', { text: '历史版本' }), '：P0 静态目录每个资源只发布 1 个版本'),
      el('div', { class: 'subtle', style: { fontSize: '11.5px', marginTop: '2px' } }, '多版本目录与回滚是后续版本能力（当前 catalog 契约未定义版本数组）。'),
    ),
    el('span', { class: 'version-date', text: '—' }),
  ));
  const info = el('div', { class: 'notice', style: { marginTop: '14px' } },
    icon('info', 16, 'notice-icon'),
    el('div', {},
      '包 id：', el('code', { text: pkg?.id || resource.id }),
      pkg ? [' · 包内声明：', pkg.requires?.shadow ? `需要 SHADOW ${pkg.requires.shadow}` : '未声明工具版本要求'].join('') : '',
      el('br'),
      '创建于 ', fmtDate(created), ' · 版本号遵循 semver；发布后包 id 不变。',
    ),
  );
  panel.append(info);
  return panel;
}

/* ---------------- 页面 ---------------- */

function notFoundResource(view, id) {
  view.replaceChildren(el('div', { class: 'notfound' },
    el('div', { class: 'notfound-code', text: '404' }),
    el('h1', { class: 'notfound-title', text: '找不到这个资源' }),
    el('p', { class: 'notfound-desc' }, '资源 id ', el('code', { text: String(id || '') }), ' 不在当前目录中。可能已被下架，或链接来自其它版本的市场。'),
    el('div', { class: 'notfound-actions' },
      el('a', { class: 'btn btn-primary', href: '#/' }, icon('compass', 14), '回到探索'),
      el('a', { class: 'btn', href: '#/search?q=' }, icon('search', 14), '搜索资源'),
    ),
  ));
}

export function renderResource(view, route) {
  const state = getState();
  const id = route.params.id;
  const resource = resourceById(id);
  view.replaceChildren();
  if (!resource) { notFoundResource(view, id); return; }

  const plugin = pluginFor(resource.type);
  const tabs = plugin.detailTabs.length ? plugin.detailTabs : ['readme', 'files', 'versions'];
  let activeTab = tabs.includes(route.query.get('tab')) ? route.query.get('tab') : tabs[0];
  const creator = creatorByHandle(resource.creator);
  const category = categoryById(resource.category);

  const pkgState = {
    entry: resource.packageUrl ? { status: 'loading' } : { status: 'missing', error: '该资源没有 packageUrl' },
  };

  const titleBadges = el('span', { class: 'repo-title-badges' },
    freeBadge(resource),
    plugin.fallback ? unknownTypeBadge() : el('span', { class: 'badge badge-type', title: `资源类型插件：${plugin.id}` }, plugin.label),
    (state.fixture || resource.fixture) ? fixtureBadge() : null,
    resource.level ? el('span', { class: 'badge badge-level' }, resource.level) : null,
  );

  const actions = el('div', { class: 'repo-actions' });
  const importBtn = el('button', {
    class: 'btn btn-primary btn-lg', type: 'button',
    'data-testid': 'import-btn',
    onclick: () => runImport(resource, importBtn),
  }, icon('upload', 15), '一键导入到 SHADOW Studio');
  if (resource.packageUrl) actions.append(importBtn);
  if (resource.packageUrl) {
    actions.append(el('a', {
      class: 'btn btn-lg', href: resource.packageUrl, download: baseName(resource.packageUrl),
      'data-testid': 'download-btn', onclick: () => trackDownload(resource),
    }, icon('download', 15), '下载 .shadowcourse'));
  }
  actions.append(favoriteButton(resource));
  if (resource.points > 0) {
    actions.append(el('button', {
      class: 'btn btn-lg', type: 'button', 'data-testid': 'redeem-btn',
      onclick: () => {
        const result = MarketPoints.redeem(resource);
        if (result.ok) toast(`兑换成功，扣除 ${resource.points} 积分（P1 本地演示，余额 ${result.balance}）`, { kind: 'success' });
        else if (result.reason === 'E_INSUFFICIENT') toast(`积分不足：需要 ${resource.points} 分，当前 ${MarketPoints.getPoints()} 分。去「积分」页签到赚积分（本地演示）。`, { kind: 'warn', timeout: 4800 });
        else if (result.reason === 'E_DUPLICATE') toast('这个资源已经兑换过了（P1 本地演示）', { kind: 'warn' });
        else toast('兑换失败：' + result.reason, { kind: 'error' });
      },
    }, icon('diamond', 15), `兑换（${resource.points} 积分）`));
  }
  const appPortOverride = getAppPortOverride();
  const advancedHint = el('div', { class: 'repo-actions-note' },
    resource.packageUrl
      ? '会先探测本机 SHADOW Studio（127.0.0.1:18765–18775，单端口 300ms 超时）；未检测到会自动降级为下载 + 3 步说明。高级：'
      : '该资源没有可导入的包文件。',
    resource.packageUrl ? el('a', { href: '#/import' }, '导入原理') : null,
    resource.packageUrl ? el('span', { class: 'subtle', text: appPortOverride ? ` · 当前使用 ?appPort=${appPortOverride}` : ' · 可用 ?appPort=<端口> 指定自定义端口' }) : null,
  );

  const tabCounts = () => ({
    readme: null,
    sentences: pkgState.entry?.status === 'ok' ? pkgState.entry.stats.sentences : (resource.stats?.sentences || null),
    files: resource.packageUrl ? 1 : 0,
    versions: 1,
  });

  const tabbar = el('div', { class: 'tabbar', role: 'tablist', 'aria-label': '资源详情分区', 'data-testid': 'detail-tabs' });
  const panelHost = el('div', { class: 'tab-panel-host' });
  const detailMain = el('div', { class: 'detail-main' });
  const aside = el('div', { class: 'detail-aside', 'data-testid': 'detail-aside' });

  const paintTabs = () => {
    const counts = tabCounts();
    tabbar.replaceChildren();
    for (const tab of tabs) {
      const meta = TAB_META[tab] || { label: tab, icon: 'file' };
      const count = counts[tab];
      const btn = el('button', {
        class: 'tab', type: 'button', role: 'tab',
        id: `tab-${tab}`, 'aria-controls': `panel-${tab}`,
        'aria-selected': tab === activeTab ? 'true' : 'false',
        'data-testid': `tab-${tab}`,
        onclick: () => selectTab(tab),
      }, icon(meta.icon, 14, 'tab-icon'), meta.label, count !== null && count !== undefined ? el('span', { class: 'tab-count', text: String(count) }) : null);
      tabbar.append(btn);
    }
  };

  const paintPanel = () => {
    panelHost.replaceChildren();
    if (activeTab === 'sentences' && !tabs.includes('sentences')) activeTab = tabs[0];
    let panel;
    const reload = async () => {
      pkgState.entry = { status: 'loading' };
      paintTabs();
      paintPanel();
      paintAside();
      pkgState.entry = await loadPackage(resource.packageUrl, { force: true });
      paintTabs();
      paintPanel();
      paintAside();
    };
    if (activeTab === 'readme') panel = readmePanel(resource, pkgState.entry, { reload });
    else if (activeTab === 'sentences') panel = sentencesPanel(resource, pkgState.entry, { reload });
    else if (activeTab === 'files') panel = filesPanel(resource, pkgState.entry, { reload });
    else if (activeTab === 'versions') panel = versionsPanel(resource, pkgState.entry);
    else panel = readmePanel(resource, pkgState.entry, { reload });
    panelHost.append(panel);
  };

  const selectTab = (tab, { updateHash = true } = {}) => {
    if (!tabs.includes(tab)) return;
    activeTab = tab;
    for (const btn of tabbar.querySelectorAll('[role="tab"]')) {
      btn.setAttribute('aria-selected', btn.id === `tab-${tab}` ? 'true' : 'false');
    }
    paintPanel();
    if (updateHash) {
      const params = new URLSearchParams(route.query.toString());
      params.set('tab', tab);
      replaceRoute(`/resource/${encodeURIComponent(resource.id)}`, params.toString());
    }
  };

  const paintAside = () => {
    aside.replaceChildren();
    const pkgEntry = pkgState.entry;
    const stats = statsFrom(resource, pkgEntry);
    aside.append(asideCard('关于',
      el('p', { class: 'aside-desc', text: resource.description || '暂无描述。' }),
      resource.tags.length
        ? el('div', { class: 'aside-tags' }, resource.tags.map((tag) => el('a', { class: 'tag', href: `#/search?q=${encodeURIComponent(tag)}` }, tag)))
        : null,
      el('div', { class: 'row', style: { marginTop: '4px' } },
        el('span', { class: 'byom-chip' }, icon('shield', 12), 'BYOM · 不含媒体'),
      ),
    ));

    aside.append(asideCard('统计（以包为准）',
      el('div', { class: 'stat-grid' },
        el('div', { class: 'stat-cell' }, el('div', { class: 'stat-num', text: fmtNum(stats.sentences) }), el('div', { class: 'stat-label', text: '句子' })),
        el('div', { class: 'stat-cell' }, el('div', { class: 'stat-num', text: fmtDuration(stats.durationSec) }), el('div', { class: 'stat-label', text: '时间轴' })),
        el('div', { class: 'stat-cell' }, el('div', { class: 'stat-num', text: fmtNum(stats.words) }), el('div', { class: 'stat-label', text: '词数' })),
      ),
      el('p', { class: 'points-note', text: stats.source === 'package' ? '句子数与时长来自课程包（详情页以包为准）。' : '课程包未加载，显示目录索引统计。' }),
      pkgEntry?.status === 'ok' ? asideRow('包大小', fmtBytes(pkgEntry.bytes)) : null,
    ));

    const about = asideCard('资源信息');
    about.append(
      asideRow('类型', el('a', { href: `#/search?q=&type=${encodeURIComponent(plugin.id)}` }, plugin.label)),
      asideRow('分类', category ? el('a', { href: `#/category/${encodeURIComponent(category.id)}` }, category.label) : (resource.category || '—')),
      asideRow('等级', resource.level || '—'),
      asideRow('许可', el('span', { class: 'aside-license', text: resource.license || '—' })),
      asideRow('版本', el('span', { class: 'mono', text: `v${(pkgEntry?.status === 'ok' ? pkgEntry.pkg.version : resource.version) || '—'}` })),
      asideRow('作者', creator ? el('a', { href: `#/creator/${encodeURIComponent(creator.handle)}` }, creator.name) : (resource.creator || '—')),
      asideRow('更新', fmtDate(resource.updatedAt) || '—'),
      asideRow('下载', `${fmtNum(resource.downloads)} 次（示例统计）`),
    );
    aside.append(about);

    if (plugin.fallback) {
      aside.append(asideCard('插件状态',
        el('p', { class: 'aside-desc', text: '该资源类型没有找到可用的插件清单（plugins/<type>/manifest.json），市场已降级为通用卡片与通用详情渲染，不会崩溃。' }),
      ));
    } else {
      aside.append(asideCard('插件声明',
        el('p', { class: 'aside-desc' }, '资源类型 ', el('code', { text: plugin.id }), ' 由声明式插件清单注册，市场只读声明、不执行插件代码。'),
        asideRow('清单', el('a', { href: `plugins/${encodeURIComponent(plugin.id)}/manifest.json`, target: '_blank', rel: 'noopener' }, 'manifest.json')),
        asideRow('权限', Object.entries(plugin.permissions || {}).map(([k, v]) => `${k}: ${v ? '是' : '否'}`).join(' · ') || '—'),
        asideRow('导入方式', plugin.install?.mode || 'download-only'),
      ));
    }

    aside.append(asideCard('安装到桌面端',
      el('p', { class: 'aside-desc' }, '市场与 SHADOW Studio 是两个产品：市场不内嵌商店，只提供「下载课程包 / 深链导入」这一个薄接口。桌面端离线可用。'),
      resource.packageUrl
        ? el('a', { class: 'btn btn-sm btn-block', href: resource.packageUrl, download: baseName(resource.packageUrl), onclick: () => trackDownload(resource) }, icon('download', 13), '下载包文件')
        : null,
      el('a', { class: 'aside-link', href: '#/import', style: { marginTop: '10px' } }, '导入原理与降级说明 →'),
    ));
  };

  // 头部
  const head = el('header', { class: 'repo-head' },
    breadcrumb([
      { label: '市场', href: '#/' },
      category ? { label: category.label, href: `#/category/${encodeURIComponent(category.id)}` } : null,
      { label: resource.title },
    ].filter(Boolean)),
    el('div', { class: 'repo-title-row' },
      coverIcon(resource, { size: 'lg' }),
      el('div', { class: 'repo-heading' },
        el('h1', { class: 'repo-title' }, resource.title, titleBadges),
        resource.subtitle ? el('p', { class: 'repo-subtitle', text: resource.subtitle }) : null,
      ),
    ),
    resource.description ? el('p', { class: 'repo-description', text: resource.description }) : null,
    actions,
    advancedHint,
  );

  paintTabs();
  paintPanel();
  paintAside();
  detailMain.append(tabbar, panelHost);
  view.append(head, el('div', { class: 'detail-grid' }, detailMain, aside));

  // 异步加载课程包（详情页必须以包为准）
  if (resource.packageUrl) {
    loadPackage(resource.packageUrl).then((entry) => {
      if (!view.isConnected) return;
      pkgState.entry = entry;
      paintTabs();
      paintPanel();
      paintAside();
    });
  }
}

