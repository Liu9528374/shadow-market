/**
 * collect-evidence.mjs - 把 Phase 2 QA 报告/截图/SHA256 清单归档到 release/evidence-market/
 *
 * 输入（默认）：
 *   tools/qa/market/report-market.json（E2E）
 *   tools/qa/market/report-data-contract.json
 *   tools/qa/market/report-static-audit.json
 *   tools/qa/market/shots/<report-market.screenshots[]>（PNG）
 *   release/evidence-market/lighthouse/*（若已由 lighthouse-run.ps1 生成）
 *
 * 输出（默认 release/evidence-market/）：
 *   report-*.json、shots/*.png、phase2-summary.md、SHA256SUMS.txt（证据 + 站点产物 sha256）
 *
 * 用法：D:\NODE\node.exe tools\qa\market\collect-evidence.mjs [--out=release/evidence-market] [--qa=tools/qa/market]
 * 退出码：0 成功（无报告时也成功但 summary 标注“未运行”）；1 归档过程异常。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');
const argv = process.argv.slice(2);
const argOf = (name) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const QA = path.resolve(REPO, argOf('qa') || 'tools/qa/market');
const OUT = path.resolve(REPO, argOf('out') || 'release/evidence-market');
const MARKET = path.join(REPO, 'market');
const SHOTS = path.join(QA, 'shots');
const LH = path.join(OUT, 'lighthouse');
const NOTE = argOf('note') || '';   // 可选：在 phase2-summary.md 写入本轮备注（如「修复后重跑」）

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
const relRepo = (p) => path.relative(REPO, p).split(path.sep).join('/');
const copyIfExists = (src, destRel) => {
  if (!fs.existsSync(src)) return false;
  const dest = path.join(OUT, destRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
};

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });

const reports = {};
for (const name of ['report-market.json', 'report-data-contract.json', 'report-static-audit.json']) {
  const src = path.join(QA, name);
  if (copyIfExists(src, name)) reports[name] = readJson(src);
}

// 截图：优先 report-market.screenshots 列表；无报告时拷 shots 根目录 PNG（不拷子目录历史批次）
const copiedShots = [];
let shotNames = [];
if (reports['report-market.json'] && Array.isArray(reports['report-market.json'].screenshots)) {
  shotNames = reports['report-market.json'].screenshots;
} else if (fs.existsSync(SHOTS)) {
  shotNames = fs.readdirSync(SHOTS).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f)).slice(0, 40);
}
for (const name of shotNames) {
  const base = path.basename(name);
  if (copyIfExists(path.join(SHOTS, base), path.join('shots', base))) copiedShots.push(base);
}
// 清掉上一轮遗留、本轮不在报告清单里的截图（避免证据新旧混杂）
const shotsOut = path.join(OUT, 'shots');
if (fs.existsSync(shotsOut)) {
  for (const f of fs.readdirSync(shotsOut)) {
    if (!copiedShots.includes(f)) { try { fs.rmSync(path.join(shotsOut, f), { force: true }); } catch { } }
  }
}

// Lighthouse 产物（脚本输出在 lighthouse/ 子目录）
// 关键：summary 的 Lighthouse 行必须与真实报告一致——即使 status 文件缺失/写坏/带 BOM，
// 也直接从 market-mobile-*.report.json 解析分数兜底；status ok 时清掉遗留的 UNAVAILABLE.md。
let lhStatus = null;
const lhStatusFile = path.join(LH, 'lighthouse-status.json');
if (fs.existsSync(lhStatusFile)) lhStatus = readJson(lhStatusFile);
const lhReportFiles = fs.existsSync(LH)
  ? fs.readdirSync(LH).filter((f) => /^market-mobile-\d+\.report\.json$/i.test(f)).sort()
  : [];
const lhReportRuns = lhReportFiles.map((f, i) => {
  const rep = readJson(path.join(LH, f));
  const cat = rep && rep.categories;
  if (!cat) return { index: i + 1, jsonFile: f, htmlFile: f.replace(/\.report\.json$/i, '.report.html'), status: 'failed', scores: null, reason: '报告不可解析', url: '' };
  const pick = (k) => (cat[k] && typeof cat[k].score === 'number' ? Math.round(cat[k].score * 100) / 100 : null);
  return {
    index: i + 1, jsonFile: f, htmlFile: f.replace(/\.report\.json$/i, '.report.html'),
    url: rep.finalUrl || rep.requestedUrl || '', status: 'ok',
    scores: { performance: pick('performance'), accessibility: pick('accessibility'), 'best-practices': pick('best-practices'), seo: pick('seo') },
  };
}).filter((r) => r.status === 'ok');
if (!lhStatus && lhReportRuns.length) {
  lhStatus = { tool: 'lighthouse', status: 'ok', reason: '由报告 JSON 推导（status 文件缺失）', url: lhReportRuns[0].url, scores: lhReportRuns[0].scores, runs: lhReportRuns, checkedAt: null, runner: 'unknown' };
} else if (lhStatus) {
  if (!Array.isArray(lhStatus.runs) || !lhStatus.runs.length) lhStatus.runs = lhReportRuns;
  if (!lhStatus.scores) lhStatus.scores = (lhStatus.runs.find((r) => r.scores) || {}).scores || null;
}
if (fs.existsSync(LH)) {
  // 成功状态时清掉上一轮失败遗留的 UNAVAILABLE.md（避免证据自相矛盾）
  if (lhStatus && (lhStatus.status === 'ok' || lhStatus.status === 'partial')) {
    try { fs.rmSync(path.join(LH, 'UNAVAILABLE.md'), { force: true }); } catch { }
  }
  // 清掉工具内部探测/运行日志（_detect*/_run*），只保留报告/HTML/status/README
  for (const f of fs.readdirSync(LH)) {
    if (/^_/.test(f) || /\.(out|err)\.log$/i.test(f)) { try { fs.rmSync(path.join(LH, f), { force: true }); } catch { } }
  }
}
const lhFiles = [];
if (fs.existsSync(LH)) {
  for (const f of fs.readdirSync(LH)) {
    if (/\.(json|html|md)$/i.test(f)) lhFiles.push(f);
  }
}
// 生成/覆盖 lighthouse/README.md：始终与当前真实报告一致（避免上一轮旧分数残留误导）
{
  const lhRunsForReadme = (lhStatus && Array.isArray(lhStatus.runs) ? lhStatus.runs : []).filter((r) => r.scores);
  const rows = lhRunsForReadme.map((r) => {
    const s = r.scores;
    const gate = (s.performance >= 0.9 && s.accessibility >= 0.9) ? '✅ 达标' : '❌ 未达标';
    return `| ${r.index === 1 ? '首页' : r.index === 2 ? '详情页' : '#' + r.index} | \`${r.url || ''}\` | ${Math.round(s.performance * 100)} | ${Math.round(s.accessibility * 100)} | ${Math.round(s['best-practices'] * 100)} | ${Math.round(s.seo * 100)} | ${gate} |`;
  });
  const md = [
    '# Lighthouse 证据（移动端 · 自动生成）',
    '',
    `> 由 \`tools/qa/market/collect-evidence.mjs\` 依据 \`lighthouse-status.json\` 与 \`market-mobile-*.report.json\` 自动生成，分数为真实报告值，未做任何改写。`,
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 工具：Lighthouse ${lhStatus && lhStatus.runner ? '（' + lhStatus.runner + '）' : ''} · Edge headless · 默认 mobile preset（未使用 --preset=desktop）`,
    `- 检测记录：${lhStatus && lhStatus.detected ? (Array.isArray(lhStatus.detected) ? lhStatus.detected.join('；') : lhStatus.detected) : 'n/a'}`,
    `- 质量门（docs/111 §9）：Performance ≥90、Accessibility ≥90；结论：**${lhStatus ? (lhStatus.pass ? 'PASS' : 'FAIL（如实记录）') : '未运行'}**`,
    '',
    ...(rows.length
      ? ['| 页面 | URL | Performance | Accessibility | Best Practices | SEO | 门槛 |', '|---|---|---|---|---|---|---|', ...rows]
      : [`- Lighthouse 状态：${lhStatus ? lhStatus.status + (lhStatus.reason ? ' — ' + lhStatus.reason : '') : '未运行（工具不可用或未执行；不伪造分数）'}`]),
    '',
    '原始报告：',
    ...(lhFiles.filter((f) => /\.(json|html)$/i.test(f)).map((f) => `- \`${f}\``)),
    '',
    '说明：本地静态服务（\`market/serve.mjs\`）已支持 gzip 与 webmanifest MIME；线上 Cloudflare Pages / GitHub Pages 另有长缓存与压缩。',
  ].join('\n');
  fs.writeFileSync(path.join(LH, 'README.md'), md + '\n', 'utf8');
}

// 站点产物 SHA256（catalog / packages / import 产物 / PWA 文件）
const siteFiles = [];
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
for (const sub of ['catalog', path.join('data', 'packages'), path.join('data', 'import')]) {
  for (const f of walk(path.join(MARKET, sub))) siteFiles.push(f);
}
for (const f of ['sw.js', 'manifest.webmanifest', 'offline.html', 'index.html']) {
  const p = path.join(MARKET, f);
  if (fs.existsSync(p)) siteFiles.push(p);
}
siteFiles.sort();
const siteSums = siteFiles.map((f) => {
  const bytes = fs.readFileSync(f);
  return `${sha256(bytes)}  ${relRepo(f)}`;
});

/* ---------- 被测工作区快照（commit 待定时记录 HEAD / diff / 临时 SHA 清单；只读 git 命令） ---------- */
const genAt = new Date().toISOString();
function git(args) {
  try { return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', windowsHide: true }).trim(); }
  catch (e) { return `(git error: ${String((e && e.message) || e).slice(0, 200)})`; }
}
const headShort = git(['rev-parse', '--short', 'HEAD']);
const headFull = git(['rev-parse', 'HEAD']);
const wsScopes = ['market', 'tools/qa/market', 'deploy', '.github'];
const wsFiles = [];
for (const sub of wsScopes) for (const f of walk(path.join(REPO, sub))) wsFiles.push(f);
wsFiles.sort();
const wsGit = [
  '# SHADOW 市场 Phase 2 · 被测工作区快照（由 QA 只读生成，无 git 写操作）',
  `generatedAt=${genAt}`,
  `被测对象=D:\\SHADOW-MARKET`,
  `git branch: ${git(['rev-parse', '--abbrev-ref', 'HEAD'])}`,
  `HEAD: ${headFull}`,
  `HEAD short: ${headShort}`,
  `HEAD commit date: ${git(['show', '-s', '--format=%cI', 'HEAD'])}`,
  '',
  '## git status --porcelain=v1',
  git(['status', '--porcelain=v1']),
  '',
  '## git diff --stat（工作区 vs HEAD：本轮未提交改动摘要）',
  git(['diff', '--stat']),
  '',
  '## git diff --stat --cached（暂存区 vs HEAD）',
  git(['diff', '--stat', '--cached']),
  '',
].join('\n') + '\n';
fs.writeFileSync(path.join(OUT, 'workspace-git.txt'), wsGit, 'utf8');
const wsSums = wsFiles.map((f) => `${sha256(fs.readFileSync(f))}  ${relRepo(f)}`);
fs.writeFileSync(path.join(OUT, 'workspace-sha256.txt'),
  ['# 被测工作区文件 SHA256（market/ + tools/qa/market/ + deploy/ + .github/）',
    `# generatedAt=${genAt}`, `# HEAD=${headFull}（提交待定：本次测试的是工作区内容）`,
    ...wsSums].join('\n') + '\n', 'utf8');

// 证据文件 SHA256
const evidenceFiles = [];
function walkEvidence(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'SHA256SUMS.txt') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkEvidence(p, out); else out.push(p);
  }
  return out;
}
const evidenceSums = [];
for (const f of walkEvidence(OUT).sort()) {
  evidenceFiles.push(f);
  evidenceSums.push(`${sha256(fs.readFileSync(f))}  ${path.relative(OUT, f).split(path.sep).join('/')}`);
}

const now = new Date().toISOString();
const marketReport = reports['report-market.json'];
const dc = reports['report-data-contract.json'];
const sa = reports['report-static-audit.json'];
const failedMarket = marketReport && marketReport.checks ? (marketReport.checks.checks || []).filter((c) => !c.pass) : [];
const scoreOrNA = (v) => (v == null ? 'n/a' : String(v));
const lhScores = lhStatus && lhStatus.scores ? lhStatus.scores : null;
const lhRuns = lhStatus && Array.isArray(lhStatus.runs) ? lhStatus.runs : [];
const e2eChecks = marketReport && marketReport.checks ? (marketReport.checks.checks || []) : [];
const blockLabels = {
  M0: '数据/产物 HTTP 契约（catalog v2/sha256/三产物）', M1: '首页/品牌/搜索/分类/标签/作者/i18n',
  M2: '详情页/Tabs/许可/收藏', M3: '三下载产物/弹层/下载事件', M4: '一键导入（降级+成功）',
  M5: '合约页面（favorites/changelog/contribute/about/privacy/complaint/license/tag/404）',
  M6: '设置/主题/Ctrl+K', M7: '响应式/移动底部导航/吸底操作条', M8: 'PWA/离线', M9: 'console/请求汇总',
};
const blockStats = {};
for (const c of e2eChecks) {
  const m = String(c.id).match(/^(M\d+)/);
  if (!m) continue;
  const k = m[1];
  if (!blockStats[k]) blockStats[k] = { total: 0, passed: 0 };
  blockStats[k].total++;
  if (c.pass) blockStats[k].passed++;
}
// 质量门核对（docs/111 §9）
const pct = (v) => (v == null ? 'n/a' : (Math.round(Number(v) * 100) / 100).toFixed(2));
const lhPerf = lhScores ? lhScores.performance : null;
const lhA11y = lhScores ? lhScores.accessibility : null;
const lhPerfPass = typeof lhPerf === 'number' && lhPerf >= 0.9;
const lhA11yPass = typeof lhA11y === 'number' && lhA11y >= 0.9;
const e2ePass = !!(marketReport && marketReport.summary && marketReport.summary.failed === 0 && !marketReport.error);
const dcPass = !!(dc && dc.pass === true);
const saPass = !!(sa && sa.pass === true);
const consoleFiltered = marketReport && marketReport.extra ? (marketReport.extra.consoleErrorFiltered || []).length : null;
const pageErrorCount = marketReport ? (marketReport.pageErrors || []).length : null;
// 下载产物 fetch 由浏览器接管后主动中断（net::ERR_ABORTED），属预期行为，不计入失败请求
const rawRequestFailures = marketReport ? (marketReport.requestFailures || []) : [];
const requestFailures = rawRequestFailures.filter((f) => !(f && /ERR_ABORTED/.test(String(f.error || '')) && /\/data\/(import|packages)\//.test(String(f.url || ''))));
const reqFailCount = marketReport ? requestFailures.length : null;
const abortedDownloads = rawRequestFailures.length - requestFailures.length;
const consoleOk = consoleFiltered === 0 && pageErrorCount === 0 && reqFailCount === 0;
const m7 = blockStats.M7 || { passed: 0, total: 0 };
const m8 = blockStats.M8 || { passed: 0, total: 0 };
const responsiveOk = m7.total > 0 && m7.passed === m7.total;
const pwaOk = m8.total > 0 && m8.passed === m8.total;
const gateRow = (label, standard, actual, ok) => `| ${label} | ${standard} | ${actual} | ${ok ? '✅ PASS' : '❌ FAIL'} |`;

const summaryLines = [
  '# SHADOW 市场 Phase 2 P0 · QA/部署证据汇总',
  '',
  `- 生成时间：${now}`,
  `- 被测对象：D:\\SHADOW-MARKET（工作区内容，非提交）· HEAD \`${headShort}\`（提交待定，快照见下）`,
  ...(NOTE ? [`- 备注：${NOTE}`] : []),
  `- 站点：${marketReport ? marketReport.baseUrl : '(未运行 E2E)'}`,
  `- 环境：Node ${process.version} · Edge headless（Playwright）· 独立端口（189xx）`,
  `- 工作区快照：\`workspace-git.txt\`（HEAD / git status / git diff --stat）+ \`workspace-sha256.txt\`（${wsFiles.length} 个被测文件临时 SHA256，提交后可与 commit 对照）`,
  '',
  '## 结果',
  '',
  '| 套件 | 结果 | 报告 |',
  '|---|---|---|',
  marketReport
    ? `| market-e2e | ${marketReport.summary ? `${marketReport.summary.passed}/${marketReport.summary.total} PASS，${marketReport.summary.failed} FAIL` : 'n/a'} | \`report-market.json\` |`
    : '| market-e2e | 未运行 | - |',
  dc
    ? `| data-contract | ${dc.summary ? `${dc.summary.passed}/${dc.summary.total} PASS，${dc.summary.failed} FAIL` : (dc.fatal ? 'FATAL（数据未就绪）' : 'n/a')} | \`report-data-contract.json\` |`
    : '| data-contract | 未运行 | - |',
  sa
    ? `| static-audit | ${sa.summary ? `${sa.summary.passed}/${sa.summary.total - (sa.summary.skipped || 0)} PASS，${sa.summary.failed} FAIL，${sa.summary.skipped || 0} SKIP` : 'n/a'} | \`report-static-audit.json\` |`
    : '| static-audit | 未运行 | - |',
  '',
  '### E2E 按区块',
  '',
  '| 区块 | 内容 | PASS/总数 |',
  '|---|---|---|',
  ...Object.entries(blockStats).map(([k, v]) => `| ${k} | ${blockLabels[k] || ''} | ${v.passed}/${v.total} |`),
  '',
  '## 质量门核对（docs/111 §9）',
  '',
  '| 门 | 标准 | 实测 | 结论 |',
  '|---|---|---|---|',
  gateRow('Lighthouse Performance（首页）', '移动端 ≥90', pct(lhPerf), lhPerfPass),
  gateRow('Lighthouse Accessibility（首页）', '移动端 ≥90', pct(lhA11y), lhA11yPass),
  gateRow('E2E（Playwright / Edge headless）', '全 PASS', marketReport && marketReport.summary ? `${marketReport.summary.passed}/${marketReport.summary.total} PASS，${marketReport.summary.failed} FAIL` : '未运行', e2ePass),
  gateRow('数据契约（catalog v2 / sha256 / importFiles）', '全 PASS', dc && dc.summary ? `${dc.summary.passed}/${dc.summary.total} PASS，${dc.summary.failed} FAIL` : '未运行', dcPass),
  gateRow('静态审计（品牌/PWA/合规/CDN/部署）', '全 PASS（SKIP 不计）', sa && sa.summary ? `${sa.summary.passed}/${sa.summary.total - (sa.summary.skipped || 0)} PASS，${sa.summary.failed} FAIL` : '未运行', saPass),
  gateRow('console.error / pageerror / 失败请求', '0 / 0 / 0', `${consoleFiltered ?? 'n/a'} / ${pageErrorCount ?? 'n/a'} / ${reqFailCount ?? 'n/a'}${abortedDownloads ? `（另 ${abortedDownloads} 条下载中断为预期）` : ''}`, consoleOk),
  gateRow('响应式（1440/1024/768/390/375/360 无页面级横溢）', 'M7 全 PASS', `${m7.passed}/${m7.total}`, responsiveOk),
  gateRow('PWA 离线（首访后断网重载列表/详情）', 'M8 全 PASS', `${m8.passed}/${m8.total}`, pwaOk),
  '',
  '## 关键数字（质量门）',
  '',
  `- console.error：${marketReport && marketReport.extra ? (marketReport.extra.consoleErrorFiltered || []).length : 'n/a'}（原始 ${marketReport && marketReport.extra ? (marketReport.extra.consoleErrorRaw || []).length : 'n/a'}，端口探测噪声白名单）`,
  `- pageerror：${marketReport ? (marketReport.pageErrors || []).length : 'n/a'}`,
  ...(lhRuns.length
    ? ['- Lighthouse（移动端 / Edge headless / 默认 mobile preset，不传 --preset=desktop）：',
      ...lhRuns.map((r) => `  - ${r.index === 1 ? '首页' : '详情页'} \`${r.url}\` → ${r.status === 'ok' ? `P ${r.scores.performance} / A ${r.scores.accessibility} / BP ${r.scores['best-practices']} / SEO ${r.scores.seo}` : `未取得（${r.reason || r.status}）`}`)]
    : [`- Lighthouse：未运行（${lhStatus ? lhStatus.status + (lhStatus.reason ? ' — ' + lhStatus.reason : '') : 'network/二进制限制时如实标注，不伪造'}）`]),
  `- 截图：${copiedShots.length} 张（\`shots/\`）`,
  `- 证据文件：${evidenceFiles.length} 个，SHA256 清单见 \`SHA256SUMS.txt\``,
  '',
  '## 失败项（如实记录）',
  '',
];
if (failedMarket.length) {
  for (const c of failedMarket) summaryLines.push(`- [E2E] ${c.id} ${c.name} :: ${String(c.detail).slice(0, 300)}`);
} else if (marketReport) summaryLines.push('- E2E 无失败项');
else summaryLines.push('- E2E 未运行');
if (dc && dc.summary && dc.summary.failed > 0) {
  for (const c of (dc.checks || []).filter((x) => !x.pass)) summaryLines.push(`- [数据契约] ${c.id} ${c.name} :: ${String(c.detail).slice(0, 240)}`);
}
if (sa && sa.summary && sa.summary.failed > 0) {
  for (const c of (sa.checks || []).filter((x) => !x.pass)) summaryLines.push(`- [静态审计] ${c.id} ${c.name} :: ${String(c.detail).slice(0, 240)}`);
}
summaryLines.push('', '## 说明', '',
  '- 本汇总由 `tools/qa/market/collect-evidence.mjs` 从真实报告生成；FAIL 不会被隐藏或改写为 PASS。',
  '- 成功导入路径使用临时「假 SHADOW Studio」服务验证 `?import=` 深链协议；未触碰用户真实进程/端口。',
  '- 不提交大录屏/视频；截图均为页面级 PNG。');

const summary = summaryLines.join('\n') + '\n';
fs.writeFileSync(path.join(OUT, 'phase2-summary.md'), summary, 'utf8');
fs.writeFileSync(path.join(OUT, 'SHA256SUMS.txt'),
  ['# SHADOW 市场 Phase 2 证据 + 站点产物 SHA256 清单', `# generatedAt=${now}`, '',
    '## 站点产物（market/）', ...siteSums, '', '## 证据文件（release/evidence-market/）', ...evidenceSums].join('\n') + '\n',
  'utf8');

console.log(`[evidence] out=${OUT}`);
console.log(`[evidence] reports=${Object.keys(reports).join(',') || 'none'} shots=${copiedShots.length} lighthouse=${lhStatus ? lhStatus.status : 'none'} files=${evidenceFiles.length}`);
console.log(`[evidence] summary -> ${path.join(OUT, 'phase2-summary.md')}`);
console.log(`[evidence] sums    -> ${path.join(OUT, 'SHA256SUMS.txt')}`);
// 归档本身不算失败：失败信息已在报告与 phase2-summary.md 中如实保留
process.exit(0);
