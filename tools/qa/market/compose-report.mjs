/**
 * compose-report.mjs - 汇总 r11 独立验证证据 → tools/qa/market/report-r11.json
 *
 * 输入（全部真实运行产物，缺哪个就标记 missing，不编造）：
 *   tools/qa/market/report-market.json          market-e2e.mjs 输出
 *   tools/qa/market/report-desktop.json         desktop-import-e2e.mjs 输出
 *   tools/qa/market/report-app-packaged-r10.json app-smoke 打包版报告（基线）
 *   tools/qa/v07/.tmp/verify-runall.log         run-all 基线日志
 *   tools/qa/v07/.tmp/verify-r8-subtitle-check.mjs.log 等 r8/r9 日志
 *   tools/qa/market/report-app-packaged-r11.json（若跑过 r11 最终包）
 *
 * 用法：D:\NODE\node.exe tools\qa\market\compose-report.mjs [--final-root=<r11-final-mirror>] [--report=<out.json>]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const QA = path.join(REPO_ROOT, 'tools', 'qa', 'market');
const V07TMP = path.join(REPO_ROOT, 'tools', 'qa', 'v07', '.tmp');
const argv = process.argv.slice(2);
const getArg = (k) => { for (const a of argv) if (a.startsWith(`--${k}=`)) return a.slice(k.length + 3); return null; };
const OUT = getArg('report') ? path.resolve(REPO_ROOT, getArg('report')) : path.join(QA, 'report-r11.json');
const FINAL_ROOT = getArg('final-root') ? path.resolve(REPO_ROOT, getArg('final-root')) : path.join(V07TMP, 'r11-final-mirror');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function readText(file) {
  try {
    const b = fs.readFileSync(file);
    // PowerShell 5.1 的 *> 重定向是 UTF-16LE（带 BOM），直接 utf8 读会是乱码
    if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return b.toString('utf16le');
    if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) {
      const sw = Buffer.from(b); sw.swap16(); return sw.toString('utf16le');
    }
    return b.toString('utf8');
  } catch { return ''; }
}
function sha256File(file) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase(); } catch { return null; }
}
function logSummary(file, patterns) {
  const text = readText(file);
  const out = { file: path.relative(REPO_ROOT, file), exists: !!text, bytes: text.length, lines: {} };
  for (const [key, re] of Object.entries(patterns)) {
    const m = text.match(re);
    if (m) out.lines[key] = m[0];
  }
  out.passCount = (text.match(/^PASS /gm) || []).length;
  out.failCount = (text.match(/^FAIL /gm) || []).length;
  return out;
}

const now = new Date().toISOString();
const finalApp = path.join(FINAL_ROOT, 'app', 'SHADOW-Studio-0.7.0.html');
const finalExit = fs.existsSync(FINAL_ROOT);

const market = readJson(path.join(QA, 'report-market.json'));
const desktop = readJson(path.join(QA, 'report-desktop.json'));
const dataContract = readJson(path.join(QA, 'report-data-contract.json'));
const staticAudit = readJson(path.join(QA, 'report-static-audit.json'));
const appR10 = readJson(path.join(QA, 'report-app-packaged-r10.json'));
const appR11 = readJson(path.join(QA, 'report-app-packaged-r11.json'));
const userPkgApp = 'C:\\Users\\A pig\\OneDrive\\桌面\\SHADOW-Studio-0.7.0\\app\\SHADOW-Studio-0.7.0.html';

const runAll = logSummary(path.join(V07TMP, 'verify-runall.log'), {
  summary: /\[run-all\] 通过 .*?项；失败 \d+ 项/g,
  allPass: /\[run-all\] ALL PASS/,
  appE2E: /---- app PACKAGED E2E[^\n]*/,
  appNumbers: /\[app\] 关键数字:[^\n]*/,
});
const subtitle = logSummary(path.join(V07TMP, 'verify-r8-subtitle-check.mjs.log'), { result: /R8 SUBTITLE PASS \d+\/\d+/ });
const ass = logSummary(path.join(V07TMP, 'verify-r8-ass-check.mjs.log'), { result: /R8B ASS PASS \d+\/\d+/ });
const record = logSummary(path.join(V07TMP, 'verify-r9-record-check.mjs.log'), { result: /R9 RECORD PASS \d+\/\d+/ });

/* 最终 r11 包上的回归（qa-verify 串行链产物） */
const finalRunAll = logSummary(path.join(QA, 'final-runall.log'), {
  summary: /\[run-all\] 通过 .*?项；失败 \d+ 项/g,
  allPass: /\[run-all\] ALL PASS/,
  appE2E: /---- app PACKAGED E2E[^\n]*/,
  appNumbers: /\[app\] 关键数字:[^\n]*/,
});
const finalSubtitle = logSummary(path.join(QA, 'final-r8-subtitle.log'), { result: /R8 SUBTITLE PASS \d+\/\d+/ });
const finalAss = logSummary(path.join(QA, 'final-r8-ass.log'), { result: /R8B ASS PASS \d+\/\d+/ });
const finalRecord = logSummary(path.join(QA, 'final-r9-record.log'), { result: /R9 RECORD PASS \d+\/\d+/ });

const report = {
  round: 'r11',
  title: 'r11 独立验证报告（市场 Web P0 + 桌面课程包导入 + 工具侧字体/插件 + 既有回归）',
  generatedAt: now,
  verifier: 'qa-verify',
  environment: {
    os: process.platform,
    node: process.version,
    repoRoot: REPO_ROOT,
    userPackage: {
      path: 'C:\\Users\\A pig\\OneDrive\\桌面\\SHADOW-Studio-0.7.0',
      appHtmlSha256: sha256File(userPkgApp),
      note: '用户桌面包在 23:20 被外部替换为 r9（非本轮写入）；qa-verify 只读该目录，所有测试使用隔离镜像 root，未修改/未基于其内容做验收。',
    },
    edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    playwrightCore: 'tools/qa/node_modules/playwright-core',
    isolatedPorts: { used: '18930+/18960+ 动态空闲端口；避开 18765-18775/8765/18920', privateTemp: 'tools/qa/v07/.tmp/r11-verify-tmp' },
  },
  baseline: {
    mirror: 'tools/qa/v07/.tmp/r11-verify-mirror',
    appHtmlSha256: sha256File(path.join(V07TMP, 'r11-verify-mirror', 'app', 'SHADOW-Studio-0.7.0.html')),
    runAll,
    appSmoke: appR10 ? { mode: appR10.mode, version: appR10.version, root: appR10.root, checks: appR10.checks, takesSummary: appR10.takesSummary, pass: appR10.pass, finishedAt: appR10.finishedAt } : null,
    subtitle,
    ass,
    record,
    notes: 'r8/r9 既有脚本内硬编码镜像 .tmp/r5-mirror；该目录当前 SHA 与用户 r10 包一致（C781DB97…），故 SUB_PACKAGED=1 复跑即 r10 等价包。',
  },
  finalPackage: finalExit ? {
    root: path.relative(REPO_ROOT, FINAL_ROOT),
    appHtmlSha256: sha256File(finalApp),
    appHtmlSize: (() => { try { return fs.statSync(finalApp).size; } catch { return null; } })(),
    reportAppParity: '见 baseline.appSmoke（原脚本硬编码 .tmp/r5-mirror，r11 最终包用 final-runall + final-r8/r9 证据）',
  } : { root: path.relative(REPO_ROOT, FINAL_ROOT), exists: false },
  finalRegressions: {
    note: '在 Lead 构建的最终 r11 镜像上串行复跑；r8/r9 用 tools/qa/market/final-*.mjs（既有脚本副本，仅替换硬编码镜像/截图路径，断言逻辑未改）。',
    runAll: finalRunAll,
    subtitle: finalSubtitle,
    ass: finalAss,
    record: finalRecord,
    appSmoke: appR11 ? { checks: appR11.checks, takesSummary: appR11.takesSummary, root: appR11.root, pass: appR11.pass, finishedAt: appR11.finishedAt } : null,
  },
  dataContract: dataContract ? {
    status: dataContract.pass ? 'PASS' : 'FAIL',
    summary: dataContract.summary,
    checks: dataContract.checks,
    reportPath: 'tools/qa/market/report-data-contract.json',
  } : { status: 'NOT_RUN', reportPath: 'tools/qa/market/report-data-contract.json' },
  market: market ? {
    status: market.pass ? 'PASS' : 'FAIL',
    summary: market.summary,
    baseUrl: market.baseUrl,
    checks: market.checks,
    extra: market.extra,
    phases: market.phases,
    screenshots: market.screenshots,
    finishedAt: market.finishedAt,
    error: market.error,
    reportPath: 'tools/qa/market/report-market.json',
  } : { status: 'NOT_RUN', reportPath: 'tools/qa/market/report-market.json' },
  desktop: desktop ? {
    status: desktop.pass ? 'PASS' : 'FAIL',
    summary: desktop.summary,
    mode: desktop.mode,
    root: desktop.root,
    appHtmlSha256: desktop.appHtmlSha256,
    checks: desktop.checks,
    phases: desktop.phases,
    extra: desktop.extra,
    screenshots: desktop.screenshots,
    finishedAt: desktop.finishedAt,
    error: desktop.error,
    reportPath: 'tools/qa/market/report-desktop.json',
  } : { status: 'NOT_RUN', reportPath: 'tools/qa/market/report-desktop.json' },
  productPrinciples: {
    note: '由 qa-verify 依据测试证据判定：是否违反 docs/52 §1 产品边界。',
    staticAudit: staticAudit ? { status: staticAudit.pass ? 'PASS' : 'FAIL', summary: staticAudit.summary, checks: staticAudit.checks, reportPath: 'tools/qa/market/report-static-audit.json' } : { status: 'NOT_RUN' },
    twoProducts: '见 staticAudit SA1/SA2 + market.extra.dataMode / desktop.checks（市场独立静态站；桌面只做导入薄接口）',
    freeByomLocalFirst: '见 staticAudit SA3–SA8、SA12 与 market.checks M1.3/M3.x、desktop.checks D6.x/D8.4（P0 全免费、BYOM 不含媒体、无 ASR/无上传）',
    pluginEverything: '见 market.checks M0.5（plugins manifest）与 desktop.checks D11.x（内置插件 manifest + #plugin= 深链）',
  },
  evidenceFiles: {
    dataContractReport: 'tools/qa/market/report-data-contract.json',
    marketReport: 'tools/qa/market/report-market.json',
    desktopReport: 'tools/qa/market/report-desktop.json',
    baselineRunAllLog: 'tools/qa/v07/.tmp/verify-runall.log',
    baselineR8SubtitleLog: 'tools/qa/v07/.tmp/verify-r8-subtitle-check.mjs.log',
    baselineR8AssLog: 'tools/qa/v07/.tmp/verify-r8-ass-check.mjs.log',
    baselineR9RecordLog: 'tools/qa/v07/.tmp/verify-r9-record-check.mjs.log',
    shots: 'tools/qa/market/shots/',
    appSmokeReport: 'tools/qa/market/report-app-packaged-r10.json',
    finalRunAllLog: 'tools/qa/market/final-runall.log',
    finalR8SubtitleLog: 'tools/qa/market/final-r8-subtitle.log',
    finalR8AssLog: 'tools/qa/market/final-r8-ass.log',
    finalR9RecordLog: 'tools/qa/market/final-r9-record.log',
    finalAppSmokeReport: 'tools/qa/market/report-app-packaged-r11.json',
    finalDesktopReport: 'tools/qa/market/report-desktop.json',
  },
  summary: {
    dataContract: dataContract ? `${dataContract.summary.passed}/${dataContract.summary.total} PASS` : 'NOT_RUN',
    staticAudit: staticAudit ? `${staticAudit.summary.passed}/${staticAudit.summary.total} PASS` : 'NOT_RUN',
    market: market ? `${market.summary.passed}/${market.summary.total} PASS` : 'NOT_RUN',
    desktop: desktop ? `${desktop.summary.passed}/${desktop.summary.total} PASS` : 'NOT_RUN',
    baselineRunAll: runAll.lines.allPass ? '4/4 PASS' : (runAll.exists ? '见日志' : 'NOT_RUN'),
    appE2E: appR10 && appR10.checks ? `${appR10.checks.passed}/${appR10.checks.total} PASS` : 'NOT_RUN',
    r8Subtitle: subtitle.lines.result || (subtitle.exists ? '见日志' : 'NOT_RUN'),
    r8Ass: ass.lines.result || (ass.exists ? '见日志' : 'NOT_RUN'),
    r9Record: record.lines.result || (record.exists ? '见日志' : 'NOT_RUN'),
    finalRunAll: finalRunAll.lines.allPass ? '4/4 PASS' : (finalRunAll.exists ? finalRunAll.lines.summary || '见日志' : 'NOT_RUN'),
    finalAppE2E: appR11 && appR11.checks ? `${appR11.checks.passed}/${appR11.checks.total} PASS` : 'NOT_RUN',
    finalR8Subtitle: finalSubtitle.lines.result || (finalSubtitle.exists ? '见日志' : 'NOT_RUN'),
    finalR8Ass: finalAss.lines.result || (finalAss.exists ? '见日志' : 'NOT_RUN'),
    finalR9Record: finalRecord.lines.result || (finalRecord.exists ? '见日志' : 'NOT_RUN'),
  },
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ out: path.relative(REPO_ROOT, OUT), summary: report.summary, finalPackage: report.finalPackage }, null, 2));
