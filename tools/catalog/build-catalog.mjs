#!/usr/bin/env node
/**
 * tools/catalog/build-catalog.mjs
 * SHADOW 市场 catalog v2 构建器（docs/111 §3）：
 *   content/market.json + content/resources/*.json + market/data/packages/*.shadowcourse
 *   → market/catalog/{site,categories,tags,authors,licenses,resources}.json
 *   → market/data/plugins/builtin-whitelist.json（插件类资源的声明式下载物）
 *   → market/data/plugins/README-builtin-whitelist.txt（白名单说明）
 *
 * 纯 Node（>=18）ESM，无第三方依赖。
 *
 * 用法：
 *   node tools/catalog/build-catalog.mjs
 *   node tools/catalog/build-catalog.mjs --now 2026-10-31T15:30:00Z --json
 *   node tools/catalog/build-catalog.mjs --market market
 *
 * 原则：
 *   - 包 / 导入产物必须在盘上（由 build-packages.mjs + build-shadow-json.mjs 先生成）；
 *   - 构建期计算 sha256 / sizeBytes / stats（不手填）；
 *   - 先在内存构建全部产物并用 validate-catalog.mjs 全量校验（含 sha256/size 与文件一致），
 *     任何失败 → 不写盘；写盘后再回读校验一次；
 *   - --now 固定 generatedAt / savedAt 可复现（同字节）。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { computeStats, validatePackage } from '../shadowcourse/validate.mjs';
import {
  CATALOG_SCHEMA_VERSION,
  CATALOG_SPECS,
  PLUGIN_WHITELIST_SPEC,
  RESOURCE_TYPES,
  validateCatalogSet,
  validatePluginDeclarations,
} from './validate-catalog.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_MARKET = path.join(REPO_ROOT, 'market');
const DEFAULT_CONTENT = path.join(REPO_ROOT, 'content');
const DEFAULT_PLUGINS_ROOT = path.join(REPO_ROOT, 'market');

const USAGE = `SHADOW 市场 catalog v2 构建器（6 个 catalog 文件 + 插件白名单 JSON）

用法：
  node tools/catalog/build-catalog.mjs [选项]

选项：
  --repo <dir>       仓库根目录（默认脚本所在仓库）
  --market <dir>     市场根目录（默认 <repo>/market；catalog/ 与 data/ 都在其下）
  --content <dir>    内容源目录（默认 <repo>/content）
  --now <ISO8601>    固定 generatedAt（可复现构建，默认当前 UTC 时间）
  --json             stdout 只输出机器可读 JSON 摘要
  --help             显示帮助

产物：
  <market>/catalog/site.json / categories.json / tags.json / authors.json / licenses.json / resources.json
  <market>/data/plugins/builtin-whitelist.json（声明式 · 无可执行代码 · 权限全 false）
  <market>/data/plugins/README-builtin-whitelist.txt

依赖（需先生成）：
  node tools/shadowcourse/build-packages.mjs
  node tools/import/build-shadow-json.mjs`;

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function readJson(file, label) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`${label} 读取失败（${file}）：${error.message}`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} 不是合法 JSON（${file}）：${error.message}`);
  }
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function rel(file) {
  const relative = path.relative(REPO_ROOT, file);
  return relative && !relative.startsWith('..') ? relative : file;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function timestamp(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} 时间格式非法：${JSON.stringify(value)}`);
  return new Date(parsed).toISOString();
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function escapeCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// 内容源读取
// ---------------------------------------------------------------------------

function readContentSources({ contentDir }) {
  const marketFile = path.join(contentDir, 'market.json');
  const sources = readJson(marketFile, '内容源 content/market.json');
  if (sources.spec !== 'shadow.market.catalog-sources') throw new Error('content/market.json 的 spec 必须为 "shadow.market.catalog-sources"');
  if (sources.schemaVersion !== 2) throw new Error('content/market.json 的 schemaVersion 必须为 2');
  if (!sources.site || typeof sources.site !== 'object') throw new Error('content/market.json 缺少 site');
  if (!Array.isArray(sources.categories) || sources.categories.length === 0) throw new Error('content/market.json 缺少 categories');
  if (!Array.isArray(sources.authors) || sources.authors.length === 0) throw new Error('content/market.json 缺少 authors');
  if (!Array.isArray(sources.licenses) || sources.licenses.length === 0) throw new Error('content/market.json 缺少 licenses');
  if (!Array.isArray(sources.tags)) throw new Error('content/market.json 缺少 tags');
  if (!Array.isArray(sources.resourceOrder) || sources.resourceOrder.length === 0) throw new Error('content/market.json 缺少 resourceOrder');

  const resourcesDir = path.join(contentDir, 'resources');
  if (!fs.existsSync(resourcesDir)) throw new Error(`资源元数据目录不存在：${resourcesDir}`);
  const files = fs.readdirSync(resourcesDir).filter((name) => name.endsWith('.json')).sort();
  if (files.length === 0) throw new Error(`资源元数据目录没有 *.json：${resourcesDir}`);

  const resourceSources = files.map((name) => {
    const file = path.join(resourcesDir, name);
    const source = readJson(file, `资源元数据 ${name}`);
    if (source.spec !== 'shadow.market.resource-source') throw new Error(`${name} 的 spec 必须为 "shadow.market.resource-source"`);
    if (source.schemaVersion !== 2) throw new Error(`${name} 的 schemaVersion 必须为 2`);
    if (!isNonEmptyString(source.id)) throw new Error(`${name} 缺少 id`);
    if (!isNonEmptyString(source.type) || !RESOURCE_TYPES.includes(source.type)) throw new Error(`${name} 的 type 必须是 ${RESOURCE_TYPES.join(' / ')} 之一`);
    if (source.type !== 'plugin' && !source.package) throw new Error(`${name} 缺少 package（course/subtitle 必须有 .shadowcourse 包）`);
    return { file, source };
  });

  const seen = new Set();
  for (const { source } of resourceSources) {
    if (seen.has(source.id)) throw new Error(`资源 id 重复：${source.id}`);
    seen.add(source.id);
  }
  const order = sources.resourceOrder;
  if (order.length !== resourceSources.length || uniqueStrings(order).length !== order.length) {
    throw new Error(`resourceOrder（${order.length}）必须与资源元数据条数（${resourceSources.length}）一致且无重复`);
  }
  const byId = new Map(resourceSources.map((item) => [item.source.id, item]));
  const missing = order.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new Error(`resourceOrder 中的资源没有元数据文件：${missing.join(', ')}`);
  const ordered = order.map((id) => byId.get(id));
  if (ordered.length < 7) throw new Error(`P0 至少需要 7 条资源（当前 ${ordered.length}）`);
  return { sources, ordered };
}

// ---------------------------------------------------------------------------
// README / 插件白名单
// ---------------------------------------------------------------------------

function buildCatalogReadmeSummary({ title, description, audience, level, categoryLabel, stats, readmeNote, mediaName, kindLabel }) {
  const lines = [];
  lines.push(`## ${title}`);
  lines.push('');
  lines.push(description);
  lines.push('');
  if (audience) lines.push(`**适合人群**：${audience}`);
  lines.push('');
  lines.push(
    [
      `- **${stats.sentences} 句** · 时长约 **${stats.durationSec} 秒** · 难度 ${level || '—'} · 分类「${categoryLabel}」`,
      '- 许可 **CC-BY-4.0** · **BYOM 纯数据包（不含媒体）** · 导入免 ASR',
      '- 逐句英文原文 / 中文翻译 / 教学提示齐备',
      mediaName ? `- 推荐导入：下载 \`.shadow.json\` 后用 SHADOW STUDIO 打开，媒体需重命名为 \`${mediaName}\`` : '',
    ].filter(Boolean).join('\n'),
  );
  if (readmeNote) {
    lines.push('');
    lines.push(`> ${readmeNote}`);
  }
  lines.push('');
  lines.push(`> 完整 README、逐句时间轴与包元数据在 \`.shadowcourse\` 包内；下载区同时提供 \`.srt\`（备选）与 \`.shadowcourse\`（规范，${kindLabel || '课程'}）。`);
  return `${lines.join('\n')}\n`;
}

function buildPluginReadme({ source, whitelistRel }) {
  const lines = [];
  lines.push('SHADOW 市场 · 插件白名单说明');
  lines.push('====================================================');
  lines.push(`资源：${source.title}`);
  lines.push(`ID：${source.id}`);
  lines.push('版本：1.0.0');
  lines.push('类型：plugin（声明式资源类型）');
  lines.push('许可：CC-BY-4.0 · 权利依据 rights.basis = own');
  lines.push(`下载物：${whitelistRel}`);
  lines.push('');
  lines.push('【5 步查看 / 核验】');
  lines.push('1. 在资源详情页下载「builtin-whitelist.json」。');
  lines.push('2. 用任意文本编辑器或 JSON 查看器打开。');
  lines.push('3. 检查 executable 为 false，permissions 权限声明全部为 false。');
  lines.push('4. 对照类型清单：types[] 与 market/plugins/index.json 的登记完全一致。');
  lines.push('5. 检查没有脚本字段、没有远程 URL —— 本文件不含任何可执行代码。');
  lines.push('');
  lines.push('【三个坑】');
  lines.push('① 这不是可执行插件：市场只读取声明来渲染类型卡片，不会在浏览器里加载或运行任何插件代码。');
  lines.push('② 不提供任意 URL 安装：资源类型只能来自人工审核的白名单（plugins/index.json），P0 没有任意安装入口。');
  lines.push('③ permissions 只是声明：P0 没有插件运行时权限系统，权限全 false 也不代表桌面端插件会自动获得授权。');
  lines.push('');
  lines.push('【BYOM】本资源不含媒体；SHADOW 市场不托管、不分发任何影视 / 音乐媒体。');
  lines.push('【许可】CC-BY-4.0；可自由分发与改编，需署名 SHADOW Studio。');
  lines.push('【校验】node tools/catalog/validate-catalog.mjs');
  return `${lines.join('\n')}\n`;
}

/**
 * 用 content 源的 pluginWhitelist + market/plugins 白名单生成声明式 JSON（无可执行代码）。
 * @param {{ source: object, pluginDecl: {ids: string[], manifests: Map<string, object>}, index: object, generatedAt: string }} options
 */
export function buildPluginWhitelistDocument({ source, pluginDecl, index, generatedAt }) {
  const config = source.pluginWhitelist;
  if (!config || typeof config !== 'object') throw new Error(`插件资源 ${source.id} 缺少 pluginWhitelist 配置`);
  const permissions = Object.fromEntries(
    Object.entries(config.permissions || { network: false, filesystem: false, microphone: false }).map(([key, value]) => {
      if (value !== false) throw new Error(`插件白名单权限 ${key} 必须为 false（P0 不执行插件代码）`);
      return [key, false];
    }),
  );
  const types = pluginDecl.ids.map((id) => {
    const manifest = pluginDecl.manifests.get(id) || {};
    return {
      id,
      label: manifest.label || id,
      labelEn: manifest.labelEn || id,
      description: manifest.description || '',
      manifestVersion: manifest.manifestVersion ?? 1,
      manifest: (Array.isArray(index.types) ? index.types.find((entry) => entry.id === id)?.manifest : null) || `plugins/${id}/manifest.json`,
      enabled: manifest.enabled !== false,
      executable: false,
      permissions: Object.fromEntries(Object.entries(manifest.permissions || { network: false, filesystem: false, microphone: false }).map(([key]) => [key, false])),
      fileExt: Array.isArray(manifest.fileExt) ? manifest.fileExt : [],
      detailTabs: Array.isArray(manifest.detailTabs) ? manifest.detailTabs : [],
      cardBadges: Array.isArray(manifest.cardBadges) ? manifest.cardBadges : [],
      statsFields: Array.isArray(manifest.statsFields) ? manifest.statsFields : [],
      install: manifest.install || { mode: 'download', deepLink: '' },
      notes: manifest.notes || '',
    };
  });
  return {
    spec: PLUGIN_WHITELIST_SPEC,
    schemaVersion: 1,
    generatedAt,
    title: config.title || 'SHADOW 市场内置插件白名单',
    titleEn: config.titleEn || 'SHADOW Market Builtin Plugin Whitelist',
    statement: config.statement,
    statementEn: config.statementEn || '',
    executable: false,
    permissions,
    installPolicy: {
      mode: 'whitelist-only',
      arbitraryUrlInstall: false,
      arbitraryCodeInstall: false,
      executesRemoteCode: false,
      note: config.installPolicy?.note || '',
    },
    boundary: {
      layer: 'declarative-resource-type',
      marketSandbox: false,
      reason: config.boundary?.reason || '',
      unrelatedTo: config.boundary?.unrelatedTo || '',
    },
    resource: { id: source.id, version: '1.0.0', license: source.license, rights: source.rights },
    types,
  };
}

// ---------------------------------------------------------------------------
// 构建
// ---------------------------------------------------------------------------

/**
 * 构建 catalog v2（内存 → 全量校验 → 写盘 → 回读校验）。
 * @param {{ repoRoot?: string, marketRoot?: string, contentDir?: string, pluginsSourceRoot?: string, nowArg?: string|null, json?: boolean, quiet?: boolean }} options
 */
export function buildCatalog(options = {}) {
  const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : REPO_ROOT;
  const marketRoot = options.marketRoot ? path.resolve(options.marketRoot) : path.join(repoRoot, 'market');
  const contentDir = options.contentDir ? path.resolve(options.contentDir) : path.join(repoRoot, 'content');
  const pluginsSourceRoot = options.pluginsSourceRoot ? path.resolve(options.pluginsSourceRoot) : DEFAULT_PLUGINS_ROOT;
  const now = options.nowArg ? timestamp(options.nowArg, '--now') : new Date().toISOString();
  const quiet = options.quiet === true;
  const json = options.json === true;

  const packagesDir = path.join(marketRoot, 'data', 'packages');
  const importDir = path.join(marketRoot, 'data', 'import');
  const catalogDir = path.join(marketRoot, 'catalog');
  const dataPluginsDir = path.join(marketRoot, 'data', 'plugins');

  const { sources, ordered } = readContentSources({ contentDir });

  // 插件声明（以 market/plugins/index.json + manifest 为源；root 为市场根）
  const pluginDecl = validatePluginDeclarations({ root: pluginsSourceRoot });
  if (!pluginDecl.ok) {
    throw new Error(`plugins/index.json / manifest 校验失败：\n${pluginDecl.errors.map((error) => `- [${error.code}] ${error.path} ${error.message}`).join('\n')}`);
  }

  const errors = [];
  const warnings = [];
  const virtualFiles = new Map();
  const resources = [];
  const changedFiles = [];
  const statsTotal = { sentences: 0, words: 0, durationSec: 0 };

  const categoryIds = new Set(sources.categories.map((category) => category.id));
  const authorHandles = new Set(sources.authors.map((author) => author.handle));
  const licenseIds = new Set(sources.licenses.map((license) => license.id));
  const declaredTags = new Set(sources.tags.map((tag) => tag.tag));

  for (const { file: sourceFile, source } of ordered) {
    const category = sources.categories.find((item) => item.id === source.category);
    if (!category) {
      errors.push({ file: rel(sourceFile), message: `分类 ${JSON.stringify(source.category)} 未在 content/market.json.categories 中登记` });
      continue;
    }
    if (!authorHandles.has(source.author)) {
      errors.push({ file: rel(sourceFile), message: `作者 ${JSON.stringify(source.author)} 未在 content/market.json.authors 中登记` });
      continue;
    }
    if (!licenseIds.has(source.license)) {
      errors.push({ file: rel(sourceFile), message: `许可 ${JSON.stringify(source.license)} 未在 content/market.json.licenses 中登记` });
      continue;
    }
    for (const tag of Array.isArray(source.tags) ? source.tags : []) {
      if (!declaredTags.has(tag)) errors.push({ file: rel(sourceFile), message: `标签 ${JSON.stringify(tag)} 未在 content/market.json.tags 中登记` });
    }

    const mediaName = source.type === 'plugin' ? null : `${source.id}.mp4`;
    const importFiles = source.type === 'plugin'
      ? { shadowJson: null, srt: null, readme: 'data/plugins/README-builtin-whitelist.txt' }
      : {
        shadowJson: `data/import/${source.id}.shadow.json`,
        srt: `data/import/${source.id}.srt`,
        readme: `data/import/README-${source.id}.txt`,
      };

    let stats;
    let versions;
    let readme;
    if (source.type === 'course' || source.type === 'subtitle') {
      const expectedPackageRel = `data/packages/${source.id}.shadowcourse`;
      if (!source.package || source.package.kind !== 'shadowcourse' || source.package.file !== expectedPackageRel) {
        errors.push({ file: rel(sourceFile), message: `package.file 必须为 ${expectedPackageRel}（kind=shadowcourse）` });
        continue;
      }
      const packageFile = path.join(marketRoot, expectedPackageRel);
      if (!fs.existsSync(packageFile)) {
        errors.push({ file: rel(sourceFile), message: `包文件不存在：${expectedPackageRel}（请先运行 build-packages.mjs）` });
        continue;
      }
      const buffer = fs.readFileSync(packageFile);
      let pkg;
      try {
        pkg = JSON.parse(buffer.toString('utf8').replace(/^\ufeff/, ''));
      } catch (error) {
        errors.push({ file: rel(sourceFile), message: `包不是合法 JSON：${error.message}` });
        continue;
      }
      const packageCheck = validatePackage(pkg, { sizeBytes: buffer.length });
      if (!packageCheck.ok) {
        errors.push({ file: rel(sourceFile), message: `包校验失败：${packageCheck.errors.map((error) => `[${error.code}] ${error.path} ${error.message}`).join('；')}` });
        continue;
      }
      if (pkg.id !== source.id) errors.push({ file: rel(sourceFile), message: `包 id（${pkg.id}）与资源 id（${source.id}）不一致` });
      if (pkg.version !== source.package.version) errors.push({ file: rel(sourceFile), message: `包版本（${pkg.version}）与元数据版本（${source.package.version}）不一致` });
      if (pkg.category !== source.category) errors.push({ file: rel(sourceFile), message: `包 category（${pkg.category}）与元数据 category（${source.category}）不一致` });
      if (pkg.license !== source.license) errors.push({ file: rel(sourceFile), message: `包 license（${pkg.license}）与元数据 license（${source.license}）不一致` });
      if (pkg.mediaPolicy !== 'byom') errors.push({ file: rel(sourceFile), message: '包 mediaPolicy 必须为 byom' });
      if (errors.length > 0) continue;

      const computed = computeStats(pkg.sentences);
      stats = {
        sentences: computed.sentences,
        durationSec: computed.durationSec,
        words: computed.words,
        sizeBytes: buffer.length,
        sha256: sha256(buffer),
      };
      statsTotal.sentences += stats.sentences;
      statsTotal.words += stats.words;
      statsTotal.durationSec = Math.round((statsTotal.durationSec + stats.durationSec) * 10) / 10;

      // 导入产物必须已生成
      for (const [kind, importRel] of Object.entries(importFiles)) {
        const importFile = path.join(marketRoot, importRel);
        if (!fs.existsSync(importFile)) errors.push({ file: rel(sourceFile), message: `导入产物不存在：${importRel}（请先运行 build-shadow-json.mjs）` });
        else changedFiles.push({ kind, file: importRel });
      }
      if (errors.length > 0) continue;

      versions = [{
        version: pkg.version,
        packageUrl: expectedPackageRel,
        sha256: stats.sha256,
        sizeBytes: stats.sizeBytes,
        compat: { shadow: pkg.requires?.shadow || '>=0.7.0', schemaVersion: pkg.schemaVersion },
        changelog: Array.isArray(source.changelog) && source.changelog.length > 0 ? source.changelog : ['首个版本'],
        publishedAt: timestamp(source.publishedAt || source.createdAt, `${source.id}.publishedAt`),
        downloads: 0,
        importFiles,
      }];
      readme = buildCatalogReadmeSummary({
        title: source.title,
        description: source.description,
        audience: source.audience,
        level: source.level || pkg.level,
        categoryLabel: `${category.label}（${category.labelEn}）`,
        stats,
        readmeNote: source.readmeNote,
        mediaName,
        kindLabel: source.type === 'subtitle' ? '字幕包' : '课程',
      });
    } else {
      // plugin：先生成声明式白名单 JSON（内存），再计算 hash/size
      if (!source.package || source.package.kind !== 'plugin-whitelist' || !/^data\/plugins\/[a-z0-9][a-z0-9._-]*\.json$/.test(source.package.file || '')) {
        errors.push({ file: rel(sourceFile), message: '插件资源 package.file 必须为 data/plugins/<name>.json（kind=plugin-whitelist）' });
        continue;
      }
      const whitelistDoc = buildPluginWhitelistDocument({ source, pluginDecl, index: pluginDecl.index, generatedAt: now });
      const whitelistText = `${JSON.stringify(whitelistDoc, null, 2)}\n`;
      const whitelistBuffer = Buffer.from(whitelistText, 'utf8');
      stats = { sentences: 0, durationSec: 0, words: 0, sizeBytes: whitelistBuffer.length, sha256: sha256(whitelistBuffer) };
      versions = [{
        version: '1.0.0',
        packageUrl: source.package.file,
        sha256: stats.sha256,
        sizeBytes: stats.sizeBytes,
        compat: { shadow: source.requires?.shadow || '>=0.7.0', schemaVersion: 1 },
        changelog: Array.isArray(source.changelog) && source.changelog.length > 0 ? source.changelog : ['首个版本'],
        publishedAt: timestamp(source.publishedAt || source.createdAt, `${source.id}.publishedAt`),
        downloads: 0,
        importFiles,
      }];
      readme = isNonEmptyString(source.readme) ? source.readme : buildCatalogReadmeSummary({
        title: source.title,
        description: source.description,
        audience: source.audience,
        level: source.level || '',
        categoryLabel: `${category.label}（${category.labelEn}）`,
        stats,
        readmeNote: '',
        mediaName: null,
        kindLabel: '插件',
      });
      // 写入内存虚拟文件（用于写盘前的全量校验 + 实际写盘）
      virtualFiles.set(source.package.file, whitelistText);
      virtualFiles.set(importFiles.readme, buildPluginReadme({ source, whitelistRel: source.package.file }));
    }

    resources.push({
      id: source.id,
      type: source.type,
      title: source.title,
      subtitle: source.subtitle || '',
      description: source.description,
      category: source.category,
      level: source.level || '',
      tags: Array.isArray(source.tags) ? source.tags : [],
      author: source.author,
      license: source.license,
      rights: source.rights,
      mediaMode: 'byom',
      language: Array.isArray(source.language) ? source.language : ['en', 'zh'],
      points: 0,
      free: true,
      platforms: Array.isArray(source.platforms) ? source.platforms : ['windows', 'web'],
      requires: source.requires || { shadow: '>=0.7.0' },
      cover: source.cover,
      mediaName,
      stats,
      versions,
      readme,
      createdAt: timestamp(source.createdAt || source.publishedAt, `${source.id}.createdAt`),
      updatedAt: now,
    });
  }

  if (errors.length > 0) {
    throw new Error(`contents 源校验失败（未写盘）：\n${errors.map((error) => `- ${error.file}: ${error.message}`).join('\n')}`);
  }

  // 分类 / 标签 / 作者 / 许可 / 站点
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
  const categories = sources.categories
    .slice()
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map((category) => ({
      id: category.id,
      label: category.label,
      labelEn: category.labelEn,
      order: category.order,
      description: category.description || '',
      count: resources.filter((resource) => resource.category === category.id).length,
    }));
  for (const category of categories) {
    if (category.count === 0) warnings.push(`分类 ${category.id} 没有资源（count=0）`);
  }

  const tags = sources.tags.map((tag) => ({
    tag: tag.tag,
    label: tag.label || tag.tag,
    labelEn: tag.labelEn || tag.label || tag.tag,
    aliases: Array.isArray(tag.aliases) ? tag.aliases : [],
    count: resources.filter((resource) => resource.tags.includes(tag.tag)).length,
  }));
  const undeclaredTagCounts = new Map();
  for (const resource of resources) {
    for (const tag of resource.tags) {
      if (!tags.some((entry) => entry.tag === tag)) undeclaredTagCounts.set(tag, (undeclaredTagCounts.get(tag) || 0) + 1);
    }
  }
  if (undeclaredTagCounts.size > 0) {
    for (const tag of undeclaredTagCounts.keys()) warnings.push(`标签 ${tag} 未在 content/market.json.tags 登记（已自动加入 tags.json）`);
    for (const [tag, count] of undeclaredTagCounts) tags.push({ tag, label: tag, labelEn: tag, aliases: [], count });
  }

  const authors = sources.authors.map((author) => ({
    handle: author.handle,
    name: author.name,
    nameEn: author.nameEn || author.name,
    bio: author.bio,
    bioEn: author.bioEn || '',
    url: author.url || '',
    licenseDefault: author.licenseDefault,
    avatarColor: author.avatarColor || '#E88A2E',
  }));
  const licenses = sources.licenses.map((license) => ({
    id: license.id,
    name: license.name,
    nameEn: license.nameEn || license.name,
    url: license.url || '',
    fullText: license.fullText,
    rightsNotes: license.rightsNotes,
  }));

  const site = {
    ...sources.site,
    build: {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      generator: 'tools/catalog/build-catalog.mjs',
      generatedAt: now,
      resources: resources.length,
      types: uniqueStrings(resources.map((resource) => resource.type)),
    },
  };

  const docs = {
    site: { spec: CATALOG_SPECS.site, schemaVersion: CATALOG_SCHEMA_VERSION, generatedAt: now, items: [site] },
    categories: { spec: CATALOG_SPECS.categories, schemaVersion: CATALOG_SCHEMA_VERSION, generatedAt: now, items: categories },
    tags: { spec: CATALOG_SPECS.tags, schemaVersion: CATALOG_SCHEMA_VERSION, generatedAt: now, items: tags },
    authors: { spec: CATALOG_SPECS.authors, schemaVersion: CATALOG_SCHEMA_VERSION, generatedAt: now, items: authors },
    licenses: { spec: CATALOG_SPECS.licenses, schemaVersion: CATALOG_SCHEMA_VERSION, generatedAt: now, items: licenses },
    resources: { spec: CATALOG_SPECS.resources, schemaVersion: CATALOG_SCHEMA_VERSION, generatedAt: now, items: resources },
  };
  const catalogTexts = Object.fromEntries(Object.entries(docs).map(([name, doc]) => [name, `${JSON.stringify(doc, null, 2)}\n`]));

  // 写盘前：全量校验（virtualFiles 含尚未落盘的 catalog 文本、插件 JSON / README；包与导入产物已在盘上）
  const virtualForValidation = new Map();
  for (const [relPath, text] of virtualFiles) virtualForValidation.set(path.relative(marketRoot, path.resolve(marketRoot, relPath)).split(path.sep).join('/'), text);
  for (const [name, text] of Object.entries(catalogTexts)) virtualForValidation.set(`catalog/${name}.json`, text);
  const preflight = validateCatalogSet({ root: marketRoot, catalogDir: null, pluginsRoot: pluginsSourceRoot, virtualFiles: virtualForValidation });
  if (!preflight.ok) {
    throw new Error(
      `catalog 写盘前校验失败（未写盘）：\n${preflight.errors.map((error) => `- [${error.code}] ${error.path} ${error.message}`).join('\n')}`,
    );
  }

  // 写盘
  const written = [];
  for (const [name, text] of Object.entries(catalogTexts)) {
    const file = path.join(catalogDir, `${name}.json`);
    writeText(file, text);
    written.push({ kind: 'catalog', file: rel(file), bytes: Buffer.byteLength(text, 'utf8') });
  }
  for (const [relPath, text] of virtualFiles) {
    const file = path.join(marketRoot, relPath);
    writeText(file, text);
    written.push({ kind: relPath.includes('/plugins/') ? 'plugin' : 'import', file: rel(file), bytes: Buffer.byteLength(text, 'utf8') });
  }

  // 回读校验
  const reread = validateCatalogSet({ root: marketRoot, pluginsRoot: pluginsSourceRoot });
  if (!reread.ok) {
    throw new Error(
      `catalog 写盘后回读校验失败：\n${reread.errors.map((error) => `- [${error.code}] ${error.path} ${error.message}`).join('\n')}`,
    );
  }

  const summary = {
    ok: true,
    generatedAt: now,
    marketRoot,
    contentDir,
    catalogDir,
    resources: resources.length,
    types: uniqueStrings(resources.map((resource) => resource.type)),
    categories: categories.map((category) => ({ id: category.id, count: category.count })),
    tags: tags.length,
    authors: authors.length,
    licenses: licenses.length,
    stats: {
      sentences: statsTotal.sentences,
      words: statsTotal.words,
      durationSec: statsTotal.durationSec,
    },
    files: written,
    validation: { errors: 0, warnings: reread.warnings.length },
    warnings: [...warnings, ...reread.warnings.map((warning) => `${warning.code} ${warning.path} ${warning.message}`)],
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else if (!quiet) {
    console.log('SHADOW 市场 catalog v2 构建器（6 文件 + 插件白名单 JSON）');
    console.log(`市场目录：${marketRoot}`);
    console.log(`内容源：${contentDir}`);
    console.log(`生成时间：${now}`);
    console.log('');
    console.log(`  资源：${resources.length} 条（${summary.types.join(' / ')}） · 分类 ${categories.length} · 标签 ${tags.length} · 作者 ${authors.length} · 许可 ${licenses.length}`);
    console.log(`  句子合计：${statsTotal.sentences} 句 · ${statsTotal.words} 词 · 时长合计 ${statsTotal.durationSec}s`);
    for (const item of written) console.log(`  ${item.file} · ${item.bytes} B`);
    if (warnings.length > 0) {
      console.log('');
      for (const warning of warnings) console.log(`  [WARN] ${warning}`);
    }
    console.log('');
    console.log('catalog 写盘前 / 回读校验：0 error · PASS ✅');
    console.log('校验命令：node tools/catalog/validate-catalog.mjs');
  }

  return summary;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseCli(argv) {
  const opts = { repo: REPO_ROOT, market: null, content: null, now: null, json: false, quiet: false, help: false, error: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') opts.json = true;
    else if (arg === '--quiet') opts.quiet = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--repo' || arg === '--market' || arg === '--content' || arg === '--now') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        opts.error = `${arg} 需要一个参数`;
        break;
      }
      if (arg === '--repo') opts.repo = path.resolve(process.cwd(), value);
      if (arg === '--market') opts.market = path.resolve(process.cwd(), value);
      if (arg === '--content') opts.content = path.resolve(process.cwd(), value);
      if (arg === '--now') opts.now = value;
      index += 1;
    } else if (arg.startsWith('--repo=')) opts.repo = path.resolve(process.cwd(), arg.slice('--repo='.length));
    else if (arg.startsWith('--market=')) opts.market = path.resolve(process.cwd(), arg.slice('--market='.length));
    else if (arg.startsWith('--content=')) opts.content = path.resolve(process.cwd(), arg.slice('--content='.length));
    else if (arg.startsWith('--now=')) opts.now = arg.slice('--now='.length);
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
    console.error(`[catalog] ${opts.error}`);
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
    buildCatalog({
      repoRoot: opts.repo,
      marketRoot: opts.market || path.join(opts.repo, 'market'),
      contentDir: opts.content || path.join(opts.repo, 'content'),
      nowArg: opts.now,
      json: opts.json,
      quiet: opts.quiet,
    });
    process.exitCode = 0;
  } catch (error) {
    console.error(`[catalog] 构建失败：${error && error.message ? error.message : error}`);
    if (opts.json) process.stdout.write(`${JSON.stringify({ ok: false, error: String(error && error.message ? error.message : error) }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (isMain) main();
