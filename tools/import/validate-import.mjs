#!/usr/bin/env node
/**
 * tools/import/validate-import.mjs
 * 导入产物独立校验脚本（只读）：校验 market/data/import/** 与包是否一致、lint 是否 PASS。
 *
 * 用法：
 *   node tools/import/validate-import.mjs
 *   node tools/import/validate-import.mjs --packages market/data/packages --dir market/data/import
 *   node tools/import/validate-import.mjs --json     # stdout 仅 JSON
 *
 * 退出码：0 = 全部 PASS；1 = 有 FAIL。
 * 说明：真正的 lint 规则在 build-shadow-json.mjs（lintShadowJson / lintSrt / lintReadme），本脚本只做批量编排。
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { checkImports } from './build-shadow-json.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

const USAGE = `SHADOW 导入产物校验（只读 · lint）

用法：
  node tools/import/validate-import.mjs [选项]

选项：
  --packages <dir>  .shadowcourse 包目录（默认 market/data/packages）
  --dir <dir>       导入产物目录（默认 market/data/import）
  --json            stdout 只输出机器可读 JSON
  --help            显示帮助

校验：每个包对应 3 个文件（<id>.shadow.json / <id>.srt / README-<id>.txt）存在；
.shadow.json lint（clips/媒体名/sentences/无绝对路径与媒体字节/≤2MiB）；
SRT 句级 cue 与句数一致；README 含 5 步 + 3 坑 + 媒体名。`;

function parseCli(argv) {
  const opts = { packages: path.join(REPO_ROOT, 'market', 'data', 'packages'), dir: path.join(REPO_ROOT, 'market', 'data', 'import'), json: false, help: false, error: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--packages' || arg === '--dir') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        opts.error = `${arg} 需要一个参数`;
        break;
      }
      if (arg === '--packages') opts.packages = path.resolve(process.cwd(), value);
      if (arg === '--dir') opts.dir = path.resolve(process.cwd(), value);
      index += 1;
    } else if (arg.startsWith('--packages=')) opts.packages = path.resolve(process.cwd(), arg.slice('--packages='.length));
    else if (arg.startsWith('--dir=')) opts.dir = path.resolve(process.cwd(), arg.slice('--dir='.length));
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
    console.error(`[import] ${opts.error}`);
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
    const summary = checkImports({ packagesDir: opts.packages, outDir: opts.dir, json: opts.json, quiet: opts.json });
    process.exitCode = summary.ok ? 0 : 1;
  } catch (error) {
    console.error(`[import] 校验失败：${error && error.message ? error.message : error}`);
    if (opts.json) process.stdout.write(`${JSON.stringify({ ok: false, error: String(error && error.message ? error.message : error) }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href) main();
