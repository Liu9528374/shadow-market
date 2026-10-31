/**
 * data-contract-check.mjs - r11 市场数据契约独立静态校验（纯文件 I/O，不起服务/不开浏览器）
 *
 * 独立于 tools/shadowcourse/validate.mjs，按 docs/52 §2/§3 交叉校验：
 *   - catalog.json 结构/字段/分类/作者/版本/免费标记；
 *   - 每个 resource.packageUrl 在磁盘存在，且包内 sentences 数与 catalog.stats 一致；
 *   - 包内 spec=shadow.course、schemaVersion、id 正则、semver、mediaPolicy=byom、句子时间轴升序/end>start/text 非空/≤2MB；
 *   - 纯数据：README/句子等任何字符串不含 <script/iframe/on*= /javascript:；
 *   - plugins/index.json + 每类 manifest 字段齐全，catalog 用到的 type 都有清单。
 *
 * 用法：D:\NODE\node.exe tools\qa\market\data-contract-check.mjs [--report=...]
 * 退出码：0 全 PASS；1 有 FAIL。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');
const MARKET = path.join(REPO, 'market');
const argv = process.argv.slice(2);
const REPORT = (() => { const a = argv.find((x) => x.startsWith('--report=')); return a ? path.resolve(REPO, a.slice(9)) : path.join(__dirname, 'report-data-contract.json'); })();

const checks = [];
function ok(id, name, cond, detail = '') {
  checks.push({ id, name, pass: !!cond, detail: String(detail), at: new Date().toISOString() });
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${id} ${name}${detail ? ' :: ' + detail : ''}`);
  return !!cond;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function semver(s) { return /^\d+(\.\d+){1,2}([-+][0-9A-Za-z.-]+)?$/.test(String(s || '')); }
const ACTIVE = /<\s*script|<\s*iframe|javascript\s*:|on(?:error|load|click|mouseover|focus)\s*=/i;
function findActive(value, pathStr, found, depth) {
  if (found.length >= 5 || depth > 10) return found;
  if (typeof value === 'string') { if (ACTIVE.test(value)) found.push(pathStr); return found; }
  if (Array.isArray(value)) { value.forEach((v, i) => findActive(v, `${pathStr}[${i}]`, found, depth + 1)); return found; }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(k)) { found.push(`${pathStr}.${k}`); continue; }
      findActive(value[k], pathStr ? `${pathStr}.${k}` : k, found, depth + 1);
    }
  }
  return found;
}

const report = { test: 'market-data-contract', round: 'r11', startedAt: new Date().toISOString(), marketDir: MARKET, checks, pass: false };
let fatal = null;
try {
  const catalogFile = path.join(MARKET, 'data', 'catalog.json');
  ok('DC1', 'data/catalog.json 存在', fs.existsSync(catalogFile), catalogFile);
  const catalog = readJson(catalogFile);
  ok('DC2', 'catalog.spec === "shadow.market.catalog"', catalog.spec === 'shadow.market.catalog', `spec=${catalog.spec}`);
  ok('DC3', 'catalog.schemaVersion === 1', catalog.schemaVersion === 1, `schemaVersion=${catalog.schemaVersion}`);
  const resources = Array.isArray(catalog.resources) ? catalog.resources : [];
  const categories = Array.isArray(catalog.categories) ? catalog.categories : [];
  const creators = Array.isArray(catalog.creators) ? catalog.creators : [];
  ok('DC4', 'resources ≥ 3', resources.length >= 3, `count=${resources.length}`);
  ok('DC5', 'categories ≥ 1 且每个含 id/label', categories.length >= 1 && categories.every((c) => c.id && c.label),
    `categories=${categories.map((c) => c.id).join(',')}`);
  ok('DC6', 'creators ≥ 1 且 handle/name 齐全', creators.length >= 1 && creators.every((c) => c.handle && c.name),
    `creators=${creators.map((c) => c.handle).join(',')}`);

  const catIds = new Set(categories.map((c) => c.id));
  const creatorHandles = new Set(creators.map((c) => c.handle));
  const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
  const resourceProblems = [];
  const pkgCache = new Map();
  for (const r of resources) {
    const p = [];
    if (!ID_RE.test(String(r.id || ''))) p.push('id 正则');
    if (!r.title) p.push('title 空');
    if (!catIds.has(r.category)) p.push('category 未声明:' + r.category);
    if (!creatorHandles.has(r.creator)) p.push('creator 未声明:' + r.creator);
    if (!semver(r.version)) p.push('version 非 semver');
    if (r.points !== 0) p.push('points != 0（P0 全免费）');
    if (r.free !== true) p.push('free != true');
    if (r.downloads !== 0) p.push('downloads != 0（不得虚构下载量）');
    if (!r.packageUrl) p.push('缺 packageUrl');
    else {
      const pf = path.join(MARKET, r.packageUrl);
      if (!fs.existsSync(pf)) p.push('包文件不存在:' + r.packageUrl);
      else {
        const stat = fs.statSync(pf);
        if (stat.size > 2 * 1024 * 1024) p.push('包 >2MB');
        const pkg = readJson(pf);
        pkgCache.set(r.id, { pkg, size: stat.size, file: pf });
        if (pkg.spec !== 'shadow.course') p.push('包 spec!=' + pkg.spec);
        if (pkg.id !== r.id) p.push('包 id 与 catalog 不一致');
        if (pkg.version !== r.version) p.push('包 version 与 catalog 不一致');
        const ss = Array.isArray(pkg.sentences) ? pkg.sentences : [];
        if (!ss.length) p.push('sentences 空');
        let last = -Infinity;
        ss.forEach((s, i) => {
          if (typeof s.start !== 'number' || typeof s.end !== 'number') p.push(`s${i} start/end 非数字`);
          else if (!(s.end > s.start)) p.push(`s${i} end<=start`);
          else if (s.start < last) p.push(`s${i} start 乱序`);
          else last = s.start;
          if (!String(s.text || '').trim()) p.push(`s${i} text 空`);
        });
        if (r.stats && typeof r.stats.sentences === 'number' && r.stats.sentences !== ss.length) p.push('catalog.stats.sentences 与包不一致');
        if (r.stats && typeof r.stats.words === 'number') {
          const words = ss.reduce((n, s) => n + String(s.text || '').trim().split(/\s+/).filter(Boolean).length, 0);
          if (r.stats.words !== words) p.push(`catalog.stats.words(${r.stats.words}) != 计算(${words})`);
        }
        if (r.stats && typeof r.stats.durationSec === 'number') {
          const maxEnd = ss.reduce((m, s) => Math.max(m, Number(s.end) || 0), 0);
          if (Math.abs(r.stats.durationSec - maxEnd) > 0.2) p.push(`catalog.stats.durationSec(${r.stats.durationSec}) != maxEnd(${maxEnd})`);
        }
      }
    }
    if (p.length) resourceProblems.push({ id: r.id, problems: p });
  }
  ok('DC7', 'resources 字段/包引用一致（id/category/creator/version/free/purge 下载量）', resourceProblems.length === 0,
    resourceProblems.length ? JSON.stringify(resourceProblems.slice(0, 3)) : 'all ok');

  // 每包纯数据 + byom + schemaVersion
  const pkgProblems = [];
  for (const [id, { pkg, size }] of pkgCache) {
    const p = [];
    if (pkg.schemaVersion !== 1) p.push('schemaVersion!=' + pkg.schemaVersion);
    if (pkg.mediaPolicy !== 'byom') p.push('mediaPolicy!=' + pkg.mediaPolicy);
    if (!semver(pkg.version)) p.push('version 非 semver');
    if (pkg.license !== 'CC-BY-4.0') p.push('license=' + pkg.license);
    const active = findActive(pkg, '$', [], 0);
    if (active.length) p.push('活动内容:' + active.slice(0, 2).join(','));
    if (size > 2 * 1024 * 1024) p.push('size>2MB');
    if (p.length) pkgProblems.push({ id, problems: p });
  }
  ok('DC8', '全部包：schemaVersion=1 / byom / CC-BY-4.0 / ≤2MB / 纯数据（无脚本 iframe 事件属性）', pkgProblems.length === 0,
    pkgProblems.length ? JSON.stringify(pkgProblems.slice(0, 3)) : `${pkgCache.size} packages ok`);

  // 插件清单（一切即插件：catalog 用到的 type 必须有声明）
  const idxFile = path.join(MARKET, 'plugins', 'index.json');
  const idx = readJson(idxFile);
  const typeList = Array.isArray(idx.plugins) ? idx.plugins : Array.isArray(idx.types) ? idx.types : Array.isArray(idx) ? idx : [];
  ok('DC9', 'plugins/index.json 声明 ≥1 资源类型', typeList.length >= 1, JSON.stringify(idx).slice(0, 200));
  const manifests = [];
  for (const item of typeList) {
    const id = typeof item === 'string' ? item : (item.id || item.type);
    const mf = path.join(MARKET, 'plugins', id, 'manifest.json');
    if (!fs.existsSync(mf)) { manifests.push({ id, exists: false }); continue; }
    const m = readJson(mf);
    manifests.push({ id, exists: true, manifest: m });
  }
  const badManifests = manifests.filter((m) => !m.exists || !m.manifest
    || m.manifest.manifestVersion !== 1 || m.manifest.kind !== 'resource-type'
    || !m.manifest.label || !Array.isArray(m.manifest.fileExt) || !Array.isArray(m.manifest.detailTabs)
    || !m.manifest.permissions || typeof m.manifest.enabled !== 'boolean'
    || m.manifest.id !== m.id);
  ok('DC10', '每类 manifest 字段齐全（manifestVersion/kind/id/label/fileExt/detailTabs/permissions/enabled）',
    badManifests.length === 0, badManifests.length ? JSON.stringify(badManifests.map((b) => b.id)) : `${manifests.length} manifests ok`);
  const declaredTypes = new Set(manifests.filter((m) => m.exists).map((m) => m.id));
  const usedTypes = [...new Set(resources.map((r) => r.type))];
  const undeclared = usedTypes.filter((t) => !declaredTypes.has(t));
  ok('DC11', 'catalog 使用的每种资源类型都有 manifest 声明（一切即插件）', undeclared.length === 0,
    `used=${usedTypes.join(',')} declared=${[...declaredTypes].join(',')} missing=${undeclared.join(',')}`);

  // 详情契约要求：每个资源都有 readme（包内）以便详情页渲染
  const noReadme = [...pkgCache.entries()].filter(([, v]) => !String(v.pkg.readme || '').trim()).map(([id]) => id);
  ok('DC12', '每个包都有 readme（详情页 README Tab 数据来源）', noReadme.length === 0, noReadme.join(',') || `${pkgCache.size}/${pkgCache.size}`);

  report.summary = {
    total: checks.length,
    passed: checks.filter((c) => c.pass).length,
    failed: checks.filter((c) => !c.pass).length,
    resources: resources.length,
    packages: pkgCache.size,
    categories: categories.length,
    manifests: manifests.length,
  };
  report.pass = report.summary.failed === 0;
} catch (e) {
  fatal = String(e && (e.stack || e.message || e));
  report.fatal = fatal;
  console.error('[data-contract] FATAL: ' + fatal);
}
report.finishedAt = new Date().toISOString();
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`\n[data-contract] ${report.summary ? `${report.summary.passed}/${report.summary.total} PASS` : '0/0'} -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
