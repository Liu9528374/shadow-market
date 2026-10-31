#!/usr/bin/env node
/**
 * tools/catalog/build-all.mjs
 * SHADOW 市场 P0 数据层一键构建链（失败不写盘）：
 *
 *   1. node tools/shadowcourse/build-packages.mjs   → .shadowcourse（course + subtitle）
 *   2. 内存/回读校验全部包（validate.mjs）
 *   3. node tools/import/build-shadow-json.mjs      → .shadow.json / .srt / README + lint
 *   4. node tools/catalog/build-catalog.mjs         → catalog v2 + 插件白名单 JSON（写盘前全量校验）
 *   5. 独立校验：validate.mjs / validate-import / validate-catalog
 *   6. 全部通过后，把暂存目录复制到 market/（任何失败 → market/ 下不写任何文件）
 *   7. 落盘后再次全量校验（in-place）
 *
 * 纯 Node（>=18）ESM，无第三方依赖。
 *
 * 用法：
 *   node tools/catalog/build-all.mjs
 *   node tools/catalog/build-all.mjs --now 2026-10-31T15:30:00Z
 *   node tools/catalog/build-all.mjs --now 2026-10-31T15:30:00Z --json
 *
 * 可复现：固定 --now 时，所有 generatedAt / savedAt / updatedAt 相同 → 产物同字节。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build as buildPackages } from '../shadowcourse/build-packages.mjs';
import { validateText } from '../shadowcourse/validate.mjs';
import { buildImports, checkImports } from '../import/build-shadow-json.mjs';
import { buildCatalog } from './build-catalog.mjs';
import { validateCatalogSet } from './validate-catalog.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const MARKET = path.join(REPO_ROOT, 'market');
const CONTENT = path.join(REPO_ROOT, 'content');
const PLUGINS_ROOT = path.join(REPO_ROOT, 'market');

const USAGE = `SHADOW 市场 P0 数据层一键构建链（失败不写盘）

用法：
  node tools/catalog/build-all.mjs [选项]

选项：
  --now <ISO8601>  固定生成时间（可复现构建；默认当前 UTC 时间）
  --json           stdout 只输出机器可读 JSON 摘要
  --quiet          只输出最终摘要
  --help           显示帮助

流程：build-packages → 校验包 → build-shadow-json（lint）→ build-catalog（写盘前全量校验）
     → 暂存目录独立校验 → 复制到 market/ → 落盘后再全量校验。
说明：旧 market/data/catalog.json 保留为 legacy（不读写），新前端只读 market/catalog/*.json。`;

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function listRelativeFiles(dir) {
  const output = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else output.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return output.sort();
}

function timestamp(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} 时间格式非法：${JSON.stringify(value)}`);
  return new Date(parsed).toISOString();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function stepLog(quiet, text) {
  if (!quiet) console.log(text);
}

/** 校验目录内全部 .shadowcourse（返回逐包结果）。 */
function validatePackagesDir(packagesDir) {
  if (!fs.existsSync(packagesDir)) throw new Error(`包目录不存在：${packagesDir}`);
  const files = fs.readdirSync(packagesDir).filter((name) => name.endsWith('.shadowcourse')).sort();
  const results = [];
  const failures = [];
  for (const name of files) {
    const file = path.join(packagesDir, name);
    const size = fs.statSync(file).size;
    const result = validateText(fs.readFileSync(file, 'utf8'), { sizeBytes: size, source: file });
    const record = {
      id: name.replace(/\.shadowcourse$/, ''),
      file: name,
      bytes: size,
      sha256: sha256File(file),
      sentences: result.info.sentences ?? 0,
      durationSec: result.info.durationSec ?? 0,
      words: result.info.words ?? 0,
      ok: result.ok,
    };
    results.push(record);
    if (!result.ok) failures.push({ id: record.id, errors: result.errors });
  }
  if (failures.length > 0) {
    throw new Error(
      `包校验失败：\n${failures
        .map((item) => `- ${item.id}: ${item.errors.map((error) => `[${error.code}] ${error.path} ${error.message}`).join('；')}`)
        .join('\n')}`,
    );
  }
  return results;
}

/** 复制暂存产物到 market/（只复制白名单目录；旧 market/data/catalog.json 不动）。 */
function copyFromStaging(stagingMarket) {
  const targets = [
    ['data/packages', path.join(stagingMarket, 'data', 'packages'), path.join(MARKET, 'data', 'packages')],
    ['data/import', path.join(stagingMarket, 'data', 'import'), path.join(MARKET, 'data', 'import')],
    ['data/plugins', path.join(stagingMarket, 'data', 'plugins'), path.join(MARKET, 'data', 'plugins')],
    ['catalog', path.join(stagingMarket, 'catalog'), path.join(MARKET, 'catalog')],
  ];
  const copied = [];
  for (const [label, source, target] of targets) {
    if (!fs.existsSync(source)) throw new Error(`暂存目录缺少 ${label}：${source}`);
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(source, target, { recursive: true, force: true });
    copied.push({ label, files: listRelativeFiles(source) });
  }
  return copied;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

/**
 * 一条链构建全部数据层产物（staging → 校验 → 复制 → 回读校验）。
 * @param {{ nowArg?: string|null, json?: boolean, quiet?: boolean }} options
 */
export function buildAll(options = {}) {
  const quiet = options.quiet === true;
  const json = options.json === true;
  const now = options.nowArg ? timestamp(options.nowArg, '--now') : new Date().toISOString();
  const startedAt = Date.now();
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-market-build-'));
  const stagingMarket = path.join(stagingRoot, 'market');

  const steps = [];
  const record = (name, summary) => {
    steps.push({ step: name, ...summary });
    return summary;
  };

  try {
    stepLog(quiet, 'SHADOW 市场 P0 数据层构建链（失败不写盘）');
    stepLog(quiet, `生成时间：${now}`);
    stepLog(quiet, `暂存目录：${stagingMarket}`);
    stepLog(quiet, '');

    // 1. 包构建（写暂存目录）
    stepLog(quiet, '[1/7] 构建 .shadowcourse 包 …');
    const packagesSummary = buildPackages({
      outDir: path.join(stagingMarket, 'data'),
      sourcesFile: path.join(REPO_ROOT, 'tools', 'shadowcourse', 'sources', 'courses.json'),
      nowArg: now,
      quiet: true,
    });
    record('build-packages', { packages: packagesSummary.packages.length, sentences: packagesSummary.totalSentences });

    // 2. 包校验（validate.mjs 规则，内存 + 回读）
    stepLog(quiet, '[2/7] 校验全部包 …');
    const stagedPackages = validatePackagesDir(path.join(stagingMarket, 'data', 'packages'));
    record('validate-packages', { pass: stagedPackages.length, fail: 0 });

    // 3. 导入产物（.shadow.json / .srt / README + lint）
    stepLog(quiet, '[3/7] 生成导入产物（.shadow.json / .srt / README）+ lint …');
    const importSummary = buildImports({
      packagesDir: path.join(stagingMarket, 'data', 'packages'),
      outDir: path.join(stagingMarket, 'data', 'import'),
      nowArg: now,
      quiet: true,
    });
    record('build-import', { packages: importSummary.packages.length, sentences: importSummary.totalSentences, lint: 'PASS' });

    // 4. catalog v2 + 插件白名单 JSON（写盘前全量校验）
    stepLog(quiet, '[4/7] 构建 catalog v2 + 插件白名单 JSON …');
    const catalogSummary = buildCatalog({
      repoRoot: REPO_ROOT,
      marketRoot: stagingMarket,
      contentDir: CONTENT,
      pluginsSourceRoot: PLUGINS_ROOT,
      nowArg: now,
      quiet: true,
    });
    record('build-catalog', { resources: catalogSummary.resources, catalogFiles: catalogSummary.files.filter((file) => file.kind === 'catalog').length });

    // 5. 暂存目录独立校验（三套校验器）
    stepLog(quiet, '[5/7] 暂存目录独立校验 …');
    const stagedImportCheck = checkImports({
      packagesDir: path.join(stagingMarket, 'data', 'packages'),
      outDir: path.join(stagingMarket, 'data', 'import'),
      quiet: true,
    });
    if (!stagedImportCheck.ok) throw new Error('暂存目录 import lint 失败');
    const stagedCatalogCheck = validateCatalogSet({ root: stagingMarket, pluginsRoot: PLUGINS_ROOT });
    if (!stagedCatalogCheck.ok) {
      throw new Error(`暂存目录 catalog 校验失败：\n${stagedCatalogCheck.errors.map((error) => `- [${error.code}] ${error.path} ${error.message}`).join('\n')}`);
    }
    record('validate-staging', {
      packages: stagedPackages.length,
      importPackages: stagedImportCheck.checked.length,
      resources: stagedCatalogCheck.summary.resources,
      errors: 0,
    });

    // 6. 复制到 market/（只有此前全部通过才会执行）
    stepLog(quiet, '[6/7] 复制到 market/ …');
    const copied = copyFromStaging(stagingMarket);
    record('copy', { targets: copied.map((item) => ({ dir: item.label, files: item.files.length })) });

    // 7. 落盘后 in-place 全量校验
    stepLog(quiet, '[7/7] 落盘后全量校验 …');
    const finalPackages = validatePackagesDir(path.join(MARKET, 'data', 'packages'));
    const finalImportCheck = checkImports({
      packagesDir: path.join(MARKET, 'data', 'packages'),
      outDir: path.join(MARKET, 'data', 'import'),
      quiet: true,
    });
    if (!finalImportCheck.ok) throw new Error('market/data/import 校验失败');
    const finalCatalogCheck = validateCatalogSet({ root: MARKET, pluginsRoot: PLUGINS_ROOT });
    if (!finalCatalogCheck.ok) {
      throw new Error(`market/catalog 校验失败：\n${finalCatalogCheck.errors.map((error) => `- [${error.code}] ${error.path} ${error.message}`).join('\n')}`);
    }
    record('validate-final', {
      packages: finalPackages.length,
      importPackages: finalImportCheck.checked.length,
      resources: finalCatalogCheck.summary.resources,
      categories: finalCatalogCheck.summary.categories,
      tags: finalCatalogCheck.summary.tags,
      authors: finalCatalogCheck.summary.authors,
      licenses: finalCatalogCheck.summary.licenses,
      errors: 0,
    });

    const summary = {
      ok: true,
      generatedAt: now,
      elapsedMs: Date.now() - startedAt,
      repoRoot: REPO_ROOT,
      marketRoot: MARKET,
      steps,
      packageChecks: finalPackages.map((item) => ({
        id: item.id,
        bytes: item.bytes,
        sentences: item.sentences,
        durationSec: item.durationSec,
        words: item.words,
        sha256: item.sha256,
        sha256_12: item.sha256.slice(0, 12),
      })),
      import: {
        packages: finalImportCheck.checked.length,
        files: finalImportCheck.checked.length * 3,
      },
      catalog: {
        files: Object.keys(finalCatalogCheck.docs).length,
        resources: finalCatalogCheck.summary.resources,
        versions: finalCatalogCheck.summary.versions,
        types: [...new Set(finalCatalogCheck.docs.resources.items.map((resource) => resource.type))],
        generatedAt: finalCatalogCheck.summary.generatedAt,
        bytes: Object.fromEntries(Object.entries(finalCatalogCheck.summary.files).map(([name, info]) => [name, info.bytes])),
      },
      totals: {
        packages: finalPackages.length,
        sentences: finalPackages.reduce((sum, item) => sum + item.sentences, 0),
        bytesPackages: finalPackages.reduce((sum, item) => sum + item.bytes, 0),
      },
      commands: {
        build: 'node tools/catalog/build-all.mjs --now <ISO8601>',
        validatePackages: 'node tools/shadowcourse/validate.mjs --dir market/data/packages',
        validateImport: 'node tools/import/validate-import.mjs',
        validateCatalog: 'node tools/catalog/validate-catalog.mjs',
      },
    };

    if (json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
      console.log('');
      console.log('构建结果');
      console.log('--------');
      console.log(`  包：${summary.totals.packages} 个 · ${summary.totals.sentences} 句 · ${formatBytes(summary.totals.bytesPackages)}`);
      for (const item of summary.packageChecks) {
        console.log(`    ${item.id} · ${item.bytes} B · ${item.sentences} 句 · ${item.durationSec}s · sha256:${item.sha256_12}… · PASS`);
      }
      console.log(`  导入产物：${summary.import.files} 个文件（${summary.import.packages} 包 × .shadow.json/.srt/README）· lint PASS`);
      console.log(`  catalog：${summary.catalog.files} 个文件 · ${summary.catalog.resources} 资源（${summary.catalog.types.join(' / ')}）· ${summary.catalog.versions} 个版本`);
      console.log(`  生成时间：${now}`);
      console.log('');
      console.log('全部校验：0 error · PASS ✅');
      console.log('校验命令：');
      console.log('  node tools/shadowcourse/validate.mjs --dir market/data/packages');
      console.log('  node tools/import/validate-import.mjs');
      console.log('  node tools/catalog/validate-catalog.mjs');
    }
    return summary;
  } finally {
    try {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    } catch { /* 忽略清理失败 */ }
  }
}

function parseCli(argv) {
  const opts = { now: null, json: false, quiet: false, help: false, error: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') opts.json = true;
    else if (arg === '--quiet') opts.quiet = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--now') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        opts.error = '--now 需要一个参数';
        break;
      }
      opts.now = value;
      index += 1;
    } else if (arg.startsWith('--now=')) opts.now = arg.slice('--now='.length);
    else {
      opts.error = `未知参数：${arg}`;
      break;
    }
  }
  return opts;
}

function main() {
  const opts = parseCli(process.argv.slice(2));
  if (opts.error) {
    console.error(`[build-all] ${opts.error}`);
    console.error('');
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  try {
    buildAll({ nowArg: opts.now, json: opts.json, quiet: opts.quiet });
    process.exitCode = 0;
  } catch (error) {
    console.error(`[build-all] 构建失败（market/ 未写入新产物）：${error && error.message ? error.message : error}`);
    if (opts.json) process.stdout.write(`${JSON.stringify({ ok: false, error: String(error && error.message ? error.message : error) }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (isMain) main();
