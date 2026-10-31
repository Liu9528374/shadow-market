#!/usr/bin/env node
/**
 * tools/catalog/validate-catalog.mjs
 * SHADOW 市场 catalog v2 独立校验器（只读；构建期硬门）
 *
 * 校验对象（docs/111 §3）：
 *   market/catalog/{site,categories,tags,authors,licenses,resources}.json
 *   market/data/packages/<id>.shadowcourse（包存在 / sha256 / sizeBytes / stats 与文件一致）
 *   market/data/import/<id>.shadow.json + <id>.srt + README-<id>.txt（导入产物 lint）
 *   market/data/plugins/builtin-whitelist.json（声明式白名单：无可执行代码 / 权限全 false）
 *   market/plugins/index.json + market/plugins/<type>/manifest.json（声明式资源类型白名单）
 *
 * 用法：
 *   node tools/catalog/validate-catalog.mjs
 *   node tools/catalog/validate-catalog.mjs --root market --json
 *   node tools/catalog/validate-catalog.mjs --selftest        # 内置正反例自测
 *
 * 退出码：0 = 全部 PASS；1 = 存在 FAIL（含用法错误 / 读文件失败）。
 * 同时作为模块被 build-catalog.mjs / build-all.mjs 复用：
 *   import { validateCatalogSet, CATALOG_SPECS } from './validate-catalog.mjs';
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildImportReadme,
  buildSrt,
  convertPackageToShadowJson,
  lintReadme,
  lintShadowJson,
  lintSrt,
  mediaNameFor,
} from '../import/build-shadow-json.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

export const CATALOG_SCHEMA_VERSION = 2;
export const CATALOG_SPECS = Object.freeze({
  site: 'shadow.market.site',
  categories: 'shadow.market.categories',
  tags: 'shadow.market.tags',
  authors: 'shadow.market.authors',
  licenses: 'shadow.market.licenses',
  resources: 'shadow.market.resources',
});
export const PLUGIN_INDEX_SPEC = 'shadow.market.plugins';
export const PLUGIN_WHITELIST_SPEC = 'shadow.market.builtin-plugin-whitelist';
export const RESOURCE_TYPES = Object.freeze(['course', 'subtitle', 'plugin']);
export const MEDIA_MODES = Object.freeze(['byom']);
export const RIGHTS_BASES = Object.freeze(['own', 'licensed', 'public-domain', 'CC', 'cc']);
export const DETAIL_TABS = Object.freeze(['readme', 'sentences', 'files', 'versions', 'license']);
export const CARD_BADGES = Object.freeze(['free', 'level', 'type', 'bym', 'compat', 'downloads']);
export const INSTALL_MODES = Object.freeze(['download', 'desktop-import']);
export const PLATFORMS = Object.freeze(['windows', 'harmonyos', 'web', 'macos', 'linux']);
export const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const HANDLE_RE = /^[a-z0-9][a-z0-9-]*$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const ICON_RE = /^[a-z][a-z0-9-]*$/;
const REL_PATH_RE = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]+$/;
const ABS_PATH_RE = /(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/](?![\\/])|\\\\[A-Za-z0-9._-]+\\|\/(?:home|Users|mnt|tmp|var)\/)/;
const FORBIDDEN_TEXT = [
  [/<\s*script\b/i, '<script> 标签'],
  [/<\s*iframe\b/i, '<iframe> 标签'],
  [/<\s*object\b/i, '<object> 标签'],
  [/<\s*embed\b/i, '<embed> 标签'],
  [/\bjavascript\s*:/i, 'javascript: 伪协议'],
  [/\bdata\s*:\s*text\/html/i, 'data:text/html 内联页面'],
  [/\bsrcdoc\s*=/i, 'srcdoc= 内联页面'],
  [/\bon(?:error|load|click|mouseover|focus|submit)\s*=/i, '内联事件处理器属性'],
  [/\beval\s*\(/i, 'eval( 动态执行'],
  [/<\?php/i, 'PHP 片段'],
];
const FORBIDDEN_KEYS = new Set(['script', 'scripts', 'javascript', 'eval', 'srcdoc', '__proto__', 'constructor', 'prototype']);
const FORBIDDEN_KEY_RE = /^on[a-z]+$/i;

const USAGE = `SHADOW 市场 catalog v2 校验器（只读）

用法：
  node tools/catalog/validate-catalog.mjs [选项]

选项：
  --root <dir>      市场根目录（默认 market；catalog/ 与 data/ 都在其下）
  --catalog <dir>   catalog 目录（默认 <root>/catalog）
  --data <dir>      data 目录（默认 <root>/data）
  --json            stdout 只输出机器可读 JSON
  --selftest        运行内置正反例自测（不需要真实 catalog）
  --help            显示帮助

校验：6 个 catalog 文件的 spec/schemaVersion/字段/枚举/引用完整性；
每资源的 versions[].sha256/sizeBytes 与真实文件一致；stats 与包内句子一致；
importFiles（.shadow.json / .srt / README）存在且通过导入 lint；
插件白名单 JSON「无可执行代码 / 权限全 false」；plugins/index.json + manifest 白名单合法。`;

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIsoTime(value) {
  return typeof value === 'string' && ISO_RE.test(value) && !Number.isNaN(Date.parse(value));
}

function addError(errors, code, at, message) {
  errors.push({ code, path: at, message });
}

function addWarning(warnings, code, at, message) {
  warnings.push({ code, path: at, message });
}

function readJsonFile(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\ufeff/, '');
  return JSON.parse(text);
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function relFromRoot(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

/** 递归扫描 catalog 值：纯数据 / 无绝对路径 / 无脚本。 */
function scanForbidden(value, at, errors, depth = 0) {
  if (depth > 24 || errors.length > 40) return;
  if (typeof value === 'string') {
    if (ABS_PATH_RE.test(value)) addError(errors, 'E_ABS_PATH', at, `发现本地绝对路径：${value.slice(0, 100)}`);
    for (const [pattern, label] of FORBIDDEN_TEXT) {
      if (pattern.test(value)) {
        addError(errors, 'E_SCRIPT', at, `禁止的脚本 / 可执行内容（${label}）：${value.slice(0, 100)}`);
        return;
      }
    }
    if (/wavPath/.test(value)) addError(errors, 'E_WAV_PATH', at, '禁止的 wavPath 本地录音路径');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbidden(item, `${at}[${index}]`, errors, depth + 1));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key) || FORBIDDEN_KEY_RE.test(key)) {
        addError(errors, 'E_SCRIPT_KEY', `${at}.${key}`, `禁止的字段名 "${key}"（疑似脚本 / 事件处理器）`);
      }
      scanForbidden(child, at === '$' ? key : `${at}.${key}`, errors, depth + 1);
    }
  }
}

/** 读取文件（支持 virtualFiles 覆盖，用于「尚未写盘」的构建期校验）。 */
function makeFileReader(root, virtualFiles) {
  const virtual = virtualFiles instanceof Map ? virtualFiles : new Map(Object.entries(virtualFiles || {}));
  return function read(relPath) {
    const normalized = String(relPath).split(path.sep).join('/');
    if (virtual.has(normalized)) {
      const content = virtual.get(normalized);
      return Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    }
    const file = path.resolve(root, normalized);
    return fs.readFileSync(file);
  };
}

// ---------------------------------------------------------------------------
// 插件声明（plugins/index.json + manifest）
// ---------------------------------------------------------------------------

/**
 * @returns {{ ok: boolean, errors: Array, ids: string[], manifests: Map<string, object>, index: object|null }}
 */
export function validatePluginDeclarations({ root, virtualFiles } = {}) {
  const errors = [];
  const warnings = [];
  const read = makeFileReader(root, virtualFiles);
  const indexRel = 'plugins/index.json';
  let index;
  try {
    index = JSON.parse(read(indexRel).toString('utf8').replace(/^\ufeff/, ''));
  } catch (error) {
    addError(errors, 'E_PLUGIN_INDEX', indexRel, `插件登记表读取/解析失败：${error.message}`);
    return { ok: false, errors, warnings, ids: [], manifests: new Map(), index: null };
  }
  if (index.spec !== PLUGIN_INDEX_SPEC) addError(errors, 'E_PLUGIN_INDEX_SPEC', 'plugins/index.json.spec', `spec 必须为 "${PLUGIN_INDEX_SPEC}"，实际为 ${JSON.stringify(index.spec)}`);
  if (!Number.isInteger(index.schemaVersion) || index.schemaVersion < 1) addError(errors, 'E_PLUGIN_INDEX_SCHEMA', 'plugins/index.json.schemaVersion', 'schemaVersion 必须是 >= 1 的整数');

  const typeEntries = [];
  if (Array.isArray(index.types)) {
    index.types.forEach((entry, at) => {
      if (!isPlainObject(entry) || !isNonEmptyString(entry.id)) addError(errors, 'E_PLUGIN_TYPE', `plugins/index.json.types[${at}]`, 'type 条目必须是 { id, manifest, enabled }');
      else typeEntries.push({ id: entry.id, manifest: entry.manifest, enabled: entry.enabled !== false, at: `types[${at}]` });
    });
  }
  const legacyIds = Array.isArray(index.plugins) ? index.plugins.filter((id) => typeof id === 'string') : [];
  if (typeEntries.length === 0 && legacyIds.length > 0) {
    legacyIds.forEach((id, at) => typeEntries.push({ id, manifest: `plugins/${id}/manifest.json`, enabled: true, at: `plugins[${at}]` }));
  }
  if (typeEntries.length === 0) addError(errors, 'E_PLUGIN_TYPES', 'plugins/index.json', '必须通过 types[]（或兼容 plugins[]）声明至少 1 个资源类型');
  if (typeEntries.length > 0 && legacyIds.length > 0) {
    const fromTypes = typeEntries.map((entry) => entry.id).sort();
    const fromLegacy = legacyIds.slice().sort();
    if (JSON.stringify(fromTypes) !== JSON.stringify(fromLegacy)) {
      addError(errors, 'E_PLUGIN_TYPES_MISMATCH', 'plugins/index.json', `types[] 与兼容字段 plugins[] 的类型不一致（types=${fromTypes.join(',')} / plugins=${fromLegacy.join(',')}）`);
    }
  }

  const seen = new Set();
  const manifests = new Map();
  for (const entry of typeEntries) {
    if (seen.has(entry.id)) {
      addError(errors, 'E_PLUGIN_TYPE_DUP', `plugins/index.json.${entry.at}`, `资源类型 id 重复：${entry.id}`);
      continue;
    }
    seen.add(entry.id);
    const manifestRel = isNonEmptyString(entry.manifest) ? entry.manifest : `plugins/${entry.id}/manifest.json`;
    if (!REL_PATH_RE.test(manifestRel)) {
      addError(errors, 'E_PLUGIN_MANIFEST_PATH', `plugins/index.json.${entry.at}.manifest`, `manifest 路径必须是 market 根下的相对路径（现在 ${JSON.stringify(manifestRel)}）`);
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(read(manifestRel).toString('utf8').replace(/^\ufeff/, ''));
    } catch (error) {
      addError(errors, 'E_PLUGIN_MANIFEST', manifestRel, `manifest 读取/解析失败：${error.message}`);
      continue;
    }
    manifests.set(entry.id, manifest);
    const at = manifestRel;
    if (manifest.manifestVersion !== 1) addError(errors, 'E_PLUGIN_MANIFEST_VERSION', `${at}.manifestVersion`, `manifestVersion 必须为 1，实际为 ${JSON.stringify(manifest.manifestVersion)}`);
    if (manifest.kind !== 'resource-type') addError(errors, 'E_PLUGIN_MANIFEST_KIND', `${at}.kind`, `kind 必须为 "resource-type"，实际为 ${JSON.stringify(manifest.kind)}`);
    if (manifest.id !== entry.id) addError(errors, 'E_PLUGIN_MANIFEST_ID', `${at}.id`, `manifest.id（${manifest.id}）必须与登记表 id（${entry.id}）一致`);
    if (!isNonEmptyString(manifest.label)) addError(errors, 'E_PLUGIN_MANIFEST_LABEL', `${at}.label`, 'label 必须是非空字符串');
    if (!isNonEmptyString(manifest.labelEn)) addError(errors, 'E_PLUGIN_MANIFEST_LABEL_EN', `${at}.labelEn`, 'labelEn 必须是非空字符串');
    if (!isNonEmptyString(manifest.icon) || !ICON_RE.test(manifest.icon)) {
      addError(errors, 'E_PLUGIN_ICON', `${at}.icon`, 'icon 必须是内置图标名（kebab-case，不得为 URL / 路径）');
    }
    if (!Array.isArray(manifest.fileExt) || manifest.fileExt.length === 0 || manifest.fileExt.some((ext) => typeof ext !== 'string' || !ext.startsWith('.'))) {
      addError(errors, 'E_PLUGIN_FILEEXT', `${at}.fileExt`, 'fileExt 必须是非空数组，元素为 ".xxx" 形式');
    }
    if (!Array.isArray(manifest.detailTabs) || manifest.detailTabs.length === 0 || manifest.detailTabs.some((tab) => !DETAIL_TABS.includes(tab))) {
      addError(errors, 'E_PLUGIN_TABS', `${at}.detailTabs`, `detailTabs 必须是白名单子集：${DETAIL_TABS.join(' / ')}`);
    }
    if (manifest.cardBadges !== undefined && (!Array.isArray(manifest.cardBadges) || manifest.cardBadges.some((badge) => !CARD_BADGES.includes(badge)))) {
      addError(errors, 'E_PLUGIN_BADGES', `${at}.cardBadges`, `cardBadges 必须是白名单子集：${CARD_BADGES.join(' / ')}`);
    }
    if (!isPlainObject(manifest.install)) {
      addError(errors, 'E_PLUGIN_INSTALL', `${at}.install`, 'install 必须是对象');
    } else {
      if (!INSTALL_MODES.includes(manifest.install.mode)) addError(errors, 'E_PLUGIN_INSTALL_MODE', `${at}.install.mode`, `install.mode 必须是 ${INSTALL_MODES.join(' / ')} 之一`);
      if (manifest.install.deepLink !== undefined && typeof manifest.install.deepLink !== 'string') addError(errors, 'E_PLUGIN_DEEPLINK', `${at}.install.deepLink`, 'install.deepLink 必须是字符串');
      if (manifest.install.mode === 'desktop-import' && !isNonEmptyString(manifest.install.deepLink)) addError(errors, 'E_PLUGIN_DEEPLINK', `${at}.install.deepLink`, 'install.mode=desktop-import 时 deepLink 必须是非空字符串');
    }
    if (!isPlainObject(manifest.permissions)) {
      addError(errors, 'E_PLUGIN_PERMISSIONS', `${at}.permissions`, 'permissions 必须是对象');
    } else {
      for (const [key, value] of Object.entries(manifest.permissions)) {
        if (typeof value !== 'boolean') addError(errors, 'E_PLUGIN_PERMISSION_TYPE', `${at}.permissions.${key}`, '权限声明必须是布尔值');
        else if (value !== false) addError(errors, 'E_PLUGIN_PERMISSION_FALSE', `${at}.permissions.${key}`, 'P0 不执行插件代码：所有权限声明必须为 false');
      }
      for (const key of ['network', 'filesystem', 'microphone']) {
        if (manifest.permissions[key] !== false) addError(errors, 'E_PLUGIN_PERMISSION_REQUIRED', `${at}.permissions.${key}`, `必须显式声明 ${key}: false`);
      }
    }
    if (typeof manifest.enabled !== 'boolean') addError(errors, 'E_PLUGIN_ENABLED', `${at}.enabled`, 'enabled 必须是布尔值');
    if (manifest.enabled !== entry.enabled) addError(errors, 'E_PLUGIN_ENABLED_MISMATCH', `${at}.enabled`, `manifest.enabled（${manifest.enabled}）必须与 plugins/index.json 的 enabled（${entry.enabled}）一致`);
    // 清理：不得含远程 URL / 脚本
    scanPluginManifest(manifest, at, errors);
  }

  return { ok: errors.length === 0, errors, warnings, ids: [...seen], manifests, index };
}

function scanPluginManifest(value, at, errors, depth = 0) {
  if (depth > 12 || errors.length > 60) return;
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) addError(errors, 'E_PLUGIN_REMOTE_URL', at, `manifest 不得含远程 URL：${value.slice(0, 100)}`);
    for (const [pattern, label] of FORBIDDEN_TEXT) {
      if (pattern.test(value)) addError(errors, 'E_PLUGIN_SCRIPT', at, `manifest 含禁止内容（${label}）`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanPluginManifest(item, `${at}[${index}]`, errors, depth + 1));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key) || FORBIDDEN_KEY_RE.test(key)) addError(errors, 'E_PLUGIN_SCRIPT_KEY', `${at}.${key}`, `禁止的字段名 "${key}"`);
      scanPluginManifest(child, at === '$' ? key : `${at}.${key}`, errors, depth + 1);
    }
  }
}

// ---------------------------------------------------------------------------
// 插件白名单 JSON（声明式 · 无可执行代码）
// ---------------------------------------------------------------------------

export function validatePluginWhitelist(buffer, { relPath = 'data/plugins/builtin-whitelist.json', declaredTypeIds = [] } = {}) {
  const errors = [];
  let doc;
  try {
    doc = JSON.parse(buffer.toString('utf8').replace(/^\ufeff/, ''));
  } catch (error) {
    return { ok: false, errors: [{ code: 'E_WHITELIST_JSON', path: relPath, message: `白名单 JSON 解析失败：${error.message}` }], doc: null };
  }
  if (doc.spec !== PLUGIN_WHITELIST_SPEC) addError(errors, 'E_WHITELIST_SPEC', `${relPath}.spec`, `spec 必须为 "${PLUGIN_WHITELIST_SPEC}"，实际为 ${JSON.stringify(doc.spec)}`);
  if (!Number.isInteger(doc.schemaVersion) || doc.schemaVersion < 1) addError(errors, 'E_WHITELIST_SCHEMA', `${relPath}.schemaVersion`, 'schemaVersion 必须是 >= 1 的整数');
  if (!isIsoTime(doc.generatedAt)) addError(errors, 'E_WHITELIST_TIME', `${relPath}.generatedAt`, 'generatedAt 必须是 ISO8601 时间');
  if (!isNonEmptyString(doc.title)) addError(errors, 'E_WHITELIST_TITLE', `${relPath}.title`, 'title 必须是非空字符串');
  if (!isNonEmptyString(doc.statement)) addError(errors, 'E_WHITELIST_STATEMENT', `${relPath}.statement`, 'statement 必须说明「无可执行代码 / 只读声明」');
  if (doc.executable !== false) addError(errors, 'E_WHITELIST_EXECUTABLE', `${relPath}.executable`, 'executable 必须显式为 false（声明式白名单，不含可执行代码）');
  if (!isPlainObject(doc.permissions)) {
    addError(errors, 'E_WHITELIST_PERMISSIONS', `${relPath}.permissions`, 'permissions 必须是对象');
  } else {
    for (const [key, value] of Object.entries(doc.permissions)) {
      if (typeof value !== 'boolean') addError(errors, 'E_WHITELIST_PERMISSION_TYPE', `${relPath}.permissions.${key}`, '权限声明必须是布尔值');
      else if (value !== false) addError(errors, 'E_WHITELIST_PERMISSION_FALSE', `${relPath}.permissions.${key}`, '白名单权限必须全部为 false');
    }
    for (const key of ['network', 'filesystem', 'microphone']) {
      if (doc.permissions[key] !== false) addError(errors, 'E_WHITELIST_PERMISSION_REQUIRED', `${relPath}.permissions.${key}`, `必须显式声明 ${key}: false`);
    }
  }
  if (!isPlainObject(doc.installPolicy)) {
    addError(errors, 'E_WHITELIST_POLICY', `${relPath}.installPolicy`, 'installPolicy 必须是对象');
  } else {
    if (doc.installPolicy.mode !== 'whitelist-only') addError(errors, 'E_WHITELIST_POLICY_MODE', `${relPath}.installPolicy.mode`, 'installPolicy.mode 必须为 "whitelist-only"');
    for (const key of ['arbitraryUrlInstall', 'arbitraryCodeInstall', 'executesRemoteCode']) {
      if (doc.installPolicy[key] !== false) addError(errors, 'E_WHITELIST_POLICY_FALSE', `${relPath}.installPolicy.${key}`, `${key} 必须为 false`);
    }
  }
  if (!Array.isArray(doc.types) || doc.types.length === 0) {
    addError(errors, 'E_WHITELIST_TYPES', `${relPath}.types`, 'types 必须是数组且至少 1 条');
  } else {
    const seen = new Set();
    doc.types.forEach((item, index) => {
      const at = `${relPath}.types[${index}]`;
      if (!isPlainObject(item) || !isNonEmptyString(item.id)) {
        addError(errors, 'E_WHITELIST_TYPE', at, 'type 条目必须含非空 id');
        return;
      }
      if (seen.has(item.id)) addError(errors, 'E_WHITELIST_TYPE_DUP', at, `type id 重复：${item.id}`);
      seen.add(item.id);
      if (item.enabled !== true) addError(errors, 'E_WHITELIST_TYPE_ENABLED', `${at}.enabled`, '白名单内类型 enabled 必须为 true');
      if (!isPlainObject(item.permissions) || Object.values(item.permissions).some((value) => value !== false)) {
        addError(errors, 'E_WHITELIST_TYPE_PERMISSIONS', `${at}.permissions`, `类型 ${item.id} 的权限必须全部为 false`);
      }
    });
    if (declaredTypeIds.length > 0) {
      const declared = declaredTypeIds.slice().sort();
      const listed = [...seen].sort();
      if (JSON.stringify(declared) !== JSON.stringify(listed)) {
        addError(errors, 'E_WHITELIST_TYPE_MISMATCH', `${relPath}.types`, `白名单类型（${listed.join(',')}）必须与 plugins/index.json（${declared.join(',')}）完全一致`);
      }
    }
  }
  scanForbidden(doc, relPath, errors);
  return { ok: errors.length === 0, errors, doc };
}

// ---------------------------------------------------------------------------
// resources 校验
// ---------------------------------------------------------------------------

function resolveFile(root, virtualFiles, relPath) {
  const normalized = String(relPath).split(path.sep).join('/');
  const virtual = virtualFiles instanceof Map ? virtualFiles : new Map(Object.entries(virtualFiles || {}));
  if (virtual.has(normalized)) return Buffer.isBuffer(virtual.get(normalized)) ? virtual.get(normalized) : Buffer.from(String(virtual.get(normalized)), 'utf8');
  return fs.readFileSync(path.resolve(root, normalized));
}

function validateRelativePath(errors, at, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    addError(errors, 'E_PATH', at, '路径必须是非空字符串');
    return false;
  }
  if (!REL_PATH_RE.test(value)) {
    addError(errors, 'E_PATH', at, `路径必须是 market 根下的相对路径（不得以 / 开头或含 ..）：${JSON.stringify(value)}`);
    return false;
  }
  return true;
}

/**
 * 校验单个资源对象（含其文件 hash / 包内容 / 导入产物 / 插件白名单）。
 * 依赖已在外部校验过的 type/category/author/license/tag 引用集合。
 */
export function validateResource(resource, context) {
  const {
    at,
    errors,
    warnings: warningsArray,
    root,
    virtualFiles,
    generatedAt,
    categoryIds,
    authorHandles,
    licenseIds,
    tagNames,
    declaredTypes,
  } = context;

  if (!isPlainObject(resource)) {
    addError(errors, 'E_RESOURCE', at, '资源必须是对象');
    return;
  }
  const id = resource.id;
  if (!isNonEmptyString(id) || !ID_RE.test(id)) addError(errors, 'E_ID', `${at}.id`, `id 必须匹配 ${ID_RE}：${JSON.stringify(id)}`);
  const idAt = isNonEmptyString(id) ? id : at;

  if (!RESOURCE_TYPES.includes(resource.type)) addError(errors, 'E_TYPE', `${at}.type`, `type 必须是 ${RESOURCE_TYPES.join(' / ')} 之一，实际为 ${JSON.stringify(resource.type)}`);
  if (declaredTypes.length > 0 && !declaredTypes.includes(resource.type)) addError(errors, 'E_TYPE_UNREGISTERED', `${at}.type`, `type ${resource.type} 未在 plugins/index.json 白名单中登记`);

  if (!isNonEmptyString(resource.title)) addError(errors, 'E_TITLE', `${at}.title`, 'title 必须是非空字符串');
  if (!isNonEmptyString(resource.description)) addError(errors, 'E_DESCRIPTION', `${at}.description`, 'description 必须是非空字符串');
  if (resource.subtitle !== undefined && typeof resource.subtitle !== 'string') addError(errors, 'E_SUBTITLE', `${at}.subtitle`, 'subtitle 必须是字符串');
  if (!categoryIds.has(resource.category)) addError(errors, 'E_CATEGORY_REF', `${at}.category`, `category ${JSON.stringify(resource.category)} 未在 categories.json 中登记`);
  if (!Array.isArray(resource.tags) || resource.tags.length === 0) addError(errors, 'E_TAGS', `${at}.tags`, 'tags 必须是非空字符串数组');
  else {
    resource.tags.forEach((tag, index) => {
      if (!isNonEmptyString(tag)) addError(errors, 'E_TAGS', `${at}.tags[${index}]`, 'tag 必须是非空字符串');
      else if (tagNames.size > 0 && !tagNames.has(tag)) addError(errors, 'E_TAG_REF', `${at}.tags[${index}]`, `tag ${tag} 未在 tags.json 中登记`);
    });
  }
  if (!authorHandles.has(resource.author)) addError(errors, 'E_AUTHOR_REF', `${at}.author`, `author ${JSON.stringify(resource.author)} 未在 authors.json 中登记`);
  if (!licenseIds.has(resource.license)) addError(errors, 'E_LICENSE_REF', `${at}.license`, `license ${JSON.stringify(resource.license)} 未在 licenses.json 中登记`);
  if (!isPlainObject(resource.rights)) addError(errors, 'E_RIGHTS', `${at}.rights`, 'rights 必须是对象');
  else {
    if (!RIGHTS_BASES.includes(resource.rights.basis)) addError(errors, 'E_RIGHTS_BASIS', `${at}.rights.basis`, `rights.basis 必须是 ${RIGHTS_BASES.join(' / ')} 之一`);
    if (resource.rights.basis !== 'own' && !isNonEmptyString(resource.rights.evidenceUrl)) addError(errors, 'E_RIGHTS_EVIDENCE', `${at}.rights.evidenceUrl`, 'rights.basis 非 own 时必须提供 evidenceUrl');
    if (resource.rights.evidenceUrl !== undefined && typeof resource.rights.evidenceUrl !== 'string') addError(errors, 'E_RIGHTS', `${at}.rights.evidenceUrl`, 'evidenceUrl 必须是字符串');
  }
  if (resource.mediaMode !== 'byom') addError(errors, 'E_MEDIA_MODE', `${at}.mediaMode`, `P0 固定 mediaMode="byom"，实际为 ${JSON.stringify(resource.mediaMode)}`);
  if (!Array.isArray(resource.language) || resource.language.length === 0 || resource.language.some((lang) => !isNonEmptyString(lang))) {
    addError(errors, 'E_LANGUAGE', `${at}.language`, 'language 必须是非空字符串数组（如 ["en","zh"]）');
  }
  if (resource.points !== 0) addError(errors, 'E_POINTS', `${at}.points`, 'P0 全免费：points 必须为 0');
  if (resource.free !== true) addError(errors, 'E_FREE', `${at}.free`, 'P0 全免费：free 必须为 true');
  if (!Array.isArray(resource.platforms) || resource.platforms.length === 0 || resource.platforms.some((platform) => !PLATFORMS.includes(platform))) {
    addError(errors, 'E_PLATFORMS', `${at}.platforms`, `platforms 必须是 ${PLATFORMS.join(' / ')} 的非空子集`);
  }
  if (!isPlainObject(resource.requires)) addError(errors, 'E_REQUIRES', `${at}.requires`, 'requires 必须是对象（如 { shadow: ">=0.7.0" }）');
  else if (!isNonEmptyString(resource.requires.shadow)) addError(errors, 'E_REQUIRES', `${at}.requires.shadow`, 'requires.shadow 必须是非空 semver range 字符串');
  if (resource.level !== undefined && typeof resource.level !== 'string') addError(errors, 'E_LEVEL', `${at}.level`, 'level 必须是字符串（插件类可留空）');
  if (!isNonEmptyString(resource.readme)) addError(errors, 'E_README', `${at}.readme`, 'readme 必须是非空 Markdown 字符串');
  if (isNonEmptyString(resource.readme) && resource.readme.length > 20000) addError(errors, 'E_README_SIZE', `${at}.readme`, 'readme 超过 20000 字符');
  if (resource.cover !== undefined) {
    if (!isPlainObject(resource.cover) || !HEX_COLOR_RE.test(String(resource.cover.color1 || '')) || !HEX_COLOR_RE.test(String(resource.cover.color2 || ''))) {
      addError(errors, 'E_COVER', `${at}.cover`, 'cover 必须是 { color1, color2 } 十六进制颜色');
    }
  }
  if (!isIsoTime(resource.createdAt)) addError(errors, 'E_TIMESTAMP', `${at}.createdAt`, 'createdAt 必须是 ISO8601 时间');
  if (!isIsoTime(resource.updatedAt)) addError(errors, 'E_TIMESTAMP', `${at}.updatedAt`, 'updatedAt 必须是 ISO8601 时间');
  if (isIsoTime(resource.createdAt) && isIsoTime(resource.updatedAt) && Date.parse(resource.updatedAt) < Date.parse(resource.createdAt)) {
    addError(errors, 'E_TIMESTAMP_ORDER', `${at}.updatedAt`, 'updatedAt 不得早于 createdAt');
  }
  if (!isPlainObject(resource.stats)) addError(errors, 'E_STATS', `${at}.stats`, 'stats 必须是对象');
  else {
    for (const field of ['sentences', 'durationSec', 'words', 'sizeBytes']) {
      if (!isFiniteNumber(resource.stats[field]) || resource.stats[field] < 0) addError(errors, 'E_STATS', `${at}.stats.${field}`, `${field} 必须是 >= 0 的数字`);
    }
    if (resource.stats.sizeBytes > MAX_PACKAGE_BYTES) addError(errors, 'E_STATS_SIZE', `${at}.stats.sizeBytes`, '资源文件超过 2 MiB 上限');
    if (typeof resource.stats.sha256 !== 'string' || !SHA256_RE.test(resource.stats.sha256)) addError(errors, 'E_STATS_SHA', `${at}.stats.sha256`, 'sha256 必须是 64 位小写十六进制');
  }

  if (!Array.isArray(resource.versions) || resource.versions.length === 0) {
    addError(errors, 'E_VERSIONS', `${at}.versions`, 'versions 必须是数组且至少 1 条');
    return;
  }
  resource.versions.forEach((version, versionIndex) => {
    const versionAt = `${at}.versions[${versionIndex}]`;
    if (!isPlainObject(version)) {
      addError(errors, 'E_VERSION_OBJECT', versionAt, '版本必须是对象');
      return;
    }
    if (typeof version.version !== 'string' || !SEMVER_RE.test(version.version)) addError(errors, 'E_VERSION_SEMVER', `${versionAt}.version`, `version 必须是 semver：${JSON.stringify(version.version)}`);
    if (!validateRelativePath(errors, `${versionAt}.packageUrl`, version.packageUrl)) return;
    if (typeof version.sha256 !== 'string' || !SHA256_RE.test(version.sha256)) addError(errors, 'E_VERSION_SHA', `${versionAt}.sha256`, 'sha256 必须是 64 位小写十六进制');
    if (!Number.isInteger(version.sizeBytes) || version.sizeBytes <= 0 || version.sizeBytes > MAX_PACKAGE_BYTES) {
      addError(errors, 'E_VERSION_SIZE', `${versionAt}.sizeBytes`, 'sizeBytes 必须是 1..2 MiB 的整数');
    }
    if (!isPlainObject(version.compat)) addError(errors, 'E_COMPAT', `${versionAt}.compat`, 'compat 必须是对象');
    else {
      if (!isNonEmptyString(version.compat.shadow)) addError(errors, 'E_COMPAT', `${versionAt}.compat.shadow`, 'compat.shadow 必须是非空 semver range 字符串');
      if (!Number.isInteger(version.compat.schemaVersion) || version.compat.schemaVersion < 1) addError(errors, 'E_COMPAT', `${versionAt}.compat.schemaVersion`, 'compat.schemaVersion 必须是 >= 1 的整数');
    }
    if (!Array.isArray(version.changelog) || version.changelog.length === 0 || version.changelog.some((line) => !isNonEmptyString(line))) {
      addError(errors, 'E_CHANGELOG', `${versionAt}.changelog`, 'changelog 必须是非空字符串数组');
    }
    if (!isIsoTime(version.publishedAt)) addError(errors, 'E_PUBLISHED_AT', `${versionAt}.publishedAt`, 'publishedAt 必须是 ISO8601 时间');
    if (version.downloads !== 0) addError(errors, 'E_DOWNLOADS', `${versionAt}.downloads`, '示例数据不得虚构下载量：downloads 必须为 0');

    // ---- 文件 hash / size ----
    let fileBuffer = null;
    try {
      fileBuffer = resolveFile(root, virtualFiles, version.packageUrl);
    } catch (error) {
      addError(errors, 'E_FILE_MISSING', `${versionAt}.packageUrl`, `文件不存在或不可读：${version.packageUrl}（${error.message}）`);
    }
    if (fileBuffer) {
      const sha = sha256Buffer(fileBuffer);
      if (sha !== version.sha256) addError(errors, 'E_SHA_MISMATCH', `${versionAt}.sha256`, `sha256 与文件不一致：catalog=${version.sha256} / 文件=${sha}`);
      if (fileBuffer.length !== version.sizeBytes) addError(errors, 'E_SIZE_MISMATCH', `${versionAt}.sizeBytes`, `sizeBytes 与文件不一致：catalog=${version.sizeBytes} / 文件=${fileBuffer.length}`);
      if (fileBuffer.length > MAX_PACKAGE_BYTES) addError(errors, 'E_SIZE_LIMIT', `${versionAt}.sizeBytes`, '文件超过 2 MiB 上限');
      if (isPlainObject(resource.stats)) {
        if (resource.stats.sha256 !== version.sha256) addError(errors, 'E_STATS_SHA', `${at}.stats.sha256`, 'stats.sha256 必须与 versions[0].sha256 一致（单版本 P0）');
        if (resource.stats.sizeBytes !== version.sizeBytes) addError(errors, 'E_STATS_SIZE', `${at}.stats.sizeBytes`, 'stats.sizeBytes 必须与 versions[0].sizeBytes 一致（单版本 P0）');
      }
    }

    // ---- 类型化内容校验 ----
    if (resource.type === 'course' || resource.type === 'subtitle') {
      const expectedPackageUrl = `data/packages/${resource.id}.shadowcourse`;
      if (version.packageUrl !== expectedPackageUrl) addError(errors, 'E_PACKAGE_URL', `${versionAt}.packageUrl`, `包路径必须为 ${expectedPackageUrl}`);
      if (fileBuffer) {
        let pkg = null;
        try {
          pkg = JSON.parse(fileBuffer.toString('utf8').replace(/^\ufeff/, ''));
        } catch (error) {
          addError(errors, 'E_PACKAGE_JSON', `${versionAt}.packageUrl`, `包不是合法 JSON：${error.message}`);
        }
        if (pkg) {
          if (pkg.spec !== 'shadow.course') addError(errors, 'E_PACKAGE_SPEC', `${versionAt}.packageUrl`, `包 spec 必须为 "shadow.course"，实际为 ${JSON.stringify(pkg.spec)}`);
          if (pkg.schemaVersion !== 1) addError(errors, 'E_PACKAGE_SCHEMA', `${versionAt}.packageUrl`, '包 schemaVersion 必须为 1');
          if (pkg.id !== resource.id) addError(errors, 'E_PACKAGE_ID', `${versionAt}.packageUrl`, `包 id（${pkg.id}）必须与资源 id（${resource.id}）一致`);
          if (pkg.version !== version.version) addError(errors, 'E_PACKAGE_VERSION', `${versionAt}.version`, `catalog 版本（${version.version}）必须与包内版本（${pkg.version}）一致`);
          if (pkg.mediaPolicy !== 'byom') addError(errors, 'E_PACKAGE_MEDIA', `${versionAt}.packageUrl`, '包 mediaPolicy 必须为 "byom"');
          if (pkg.license !== resource.license) addError(errors, 'E_PACKAGE_LICENSE', `${versionAt}.packageUrl`, `包 license（${pkg.license}）必须与资源 license（${resource.license}）一致`);
          if (!Array.isArray(pkg.sentences) || pkg.sentences.length === 0) addError(errors, 'E_PACKAGE_SENTENCES', `${versionAt}.packageUrl`, '包 sentences 必须非空');
          const sentences = Array.isArray(pkg.sentences) ? pkg.sentences : [];
          let lastStart = -Infinity;
          let durationSec = 0;
          let words = 0;
          sentences.forEach((sentence, sentenceIndex) => {
            const sentenceAt = `${versionAt}.packageUrl.sentences[${sentenceIndex}]`;
            if (!isPlainObject(sentence)) {
              addError(errors, 'E_PACKAGE_SENTENCE', sentenceAt, '句子必须是对象');
              return;
            }
            if (!isFiniteNumber(sentence.start) || !isFiniteNumber(sentence.end) || sentence.end <= sentence.start) addError(errors, 'E_PACKAGE_SENTENCE_TIME', sentenceAt, '句子时间轴必须为数字且 end > start');
            if (isFiniteNumber(sentence.start) && sentence.start < lastStart) addError(errors, 'E_PACKAGE_SENTENCE_ORDER', sentenceAt, '句子必须按 start 升序');
            if (isFiniteNumber(sentence.start)) lastStart = sentence.start;
            if (isFiniteNumber(sentence.end)) durationSec = Math.max(durationSec, sentence.end);
            if (!isNonEmptyString(sentence.text)) addError(errors, 'E_PACKAGE_SENTENCE_TEXT', sentenceAt, '句子 text 必须非空');
            else words += String(sentence.text).trim().split(/\s+/).length;
          });
          durationSec = Math.round(durationSec * 10) / 10;
          if (isPlainObject(resource.stats)) {
            if (resource.stats.sentences !== sentences.length) addError(errors, 'E_STATS_SENTENCES', `${at}.stats.sentences`, `stats.sentences（${resource.stats.sentences}）与包内句子数（${sentences.length}）不一致`);
            if (resource.stats.durationSec !== durationSec) addError(errors, 'E_STATS_DURATION', `${at}.stats.durationSec`, `stats.durationSec（${resource.stats.durationSec}）与包内 max(end)（${durationSec}）不一致`);
            if (resource.stats.words !== words) addError(errors, 'E_STATS_WORDS', `${at}.stats.words`, `stats.words（${resource.stats.words}）与包内词数（${words}）不一致`);
          }
          validateImportFiles(resource, pkg, { at, versionAt, root, virtualFiles, errors, generatedAt });
        }
      }
    } else if (resource.type === 'plugin') {
      if (!/^data\/plugins\/[a-z0-9][a-z0-9._-]*\.json$/.test(String(version.packageUrl))) {
        addError(errors, 'E_PACKAGE_URL', `${versionAt}.packageUrl`, '插件类资源下载物必须是 data/plugins/<name>.json');
      }
      if (fileBuffer) {
        const whitelist = validatePluginWhitelist(fileBuffer, { relPath: version.packageUrl, declaredTypeIds: declaredTypes });
        errors.push(...whitelist.errors);
      }
      if (isPlainObject(resource.stats)) {
        if (resource.stats.sentences !== 0) addError(errors, 'E_STATS_SENTENCES', `${at}.stats.sentences`, '插件类资源 stats.sentences 必须为 0');
        if (resource.stats.durationSec !== 0) addError(errors, 'E_STATS_DURATION', `${at}.stats.durationSec`, '插件类资源 stats.durationSec 必须为 0');
        if (resource.stats.words !== 0) addError(errors, 'E_STATS_WORDS', `${at}.stats.words`, '插件类资源 stats.words 必须为 0');
      }
    }

    // ---- importFiles ----
    if (!isPlainObject(version.importFiles)) {
      addError(errors, 'E_IMPORT_FILES', `${versionAt}.importFiles`, 'importFiles 必须是对象（含 shadowJson / srt / readme 三个键）');
    } else {
      for (const key of ['shadowJson', 'srt', 'readme']) {
        if (!(key in version.importFiles)) addError(errors, 'E_IMPORT_FILES', `${versionAt}.importFiles.${key}`, `importFiles 必须包含 ${key} 键`);
      }
      if (resource.type === 'course' || resource.type === 'subtitle') {
        if (!isNonEmptyString(version.importFiles.shadowJson)) addError(errors, 'E_IMPORT_FILES', `${versionAt}.importFiles.shadowJson`, '课程 / 字幕类资源必须有 .shadow.json 导入产物');
        if (!isNonEmptyString(version.importFiles.srt)) addError(errors, 'E_IMPORT_FILES', `${versionAt}.importFiles.srt`, '课程 / 字幕类资源必须有 .srt 导入产物');
        if (!isNonEmptyString(version.importFiles.readme)) addError(errors, 'E_IMPORT_FILES', `${versionAt}.importFiles.readme`, '课程 / 字幕类资源必须有导入说明');
      } else {
        if (version.importFiles.shadowJson !== null) addError(errors, 'E_IMPORT_FILES', `${versionAt}.importFiles.shadowJson`, '插件类资源没有 .shadow.json 导入产物：必须为 null');
        if (version.importFiles.srt !== null) addError(errors, 'E_IMPORT_FILES', `${versionAt}.importFiles.srt`, '插件类资源没有 .srt 导入产物：必须为 null');
        if (!isNonEmptyString(version.importFiles.readme)) addError(errors, 'E_IMPORT_FILES', `${versionAt}.importFiles.readme`, '插件类资源必须有白名单说明 README');
        else {
          const readmeBuffer = safeResolve(root, virtualFiles, version.importFiles.readme);
          if (!readmeBuffer) addError(errors, 'E_IMPORT_MISSING', `${versionAt}.importFiles.readme`, `白名单说明 README 不存在：${version.importFiles.readme}`);
          else {
            const readmeText = readmeBuffer.toString('utf8');
            const needles = [
              ['5 步', '白名单说明需包含「5 步」使用说明'],
              ['三个坑', '白名单说明需包含「三个坑」注意事项'],
              ['可执行代码', '白名单说明必须明确「无可执行代码」'],
              ['permissions', '白名单说明必须说明 permissions 权限声明'],
              ['CC-BY-4.0', '白名单说明需包含许可（CC-BY-4.0）'],
            ];
            for (const [needle, message] of needles) {
              if (!readmeText.includes(needle)) addError(errors, 'E_IMPORT_README', `${versionAt}.importFiles.readme`, message);
            }
            for (const mark of ['①', '②', '③']) {
              if (!readmeText.includes(mark)) addError(errors, 'E_IMPORT_README', `${versionAt}.importFiles.readme`, `白名单说明三个坑需逐条编号（缺 ${mark}）`);
            }
          }
        }
      }
      // 路径类型：不得含绝对路径
      for (const key of ['shadowJson', 'srt', 'readme']) {
        const value = version.importFiles[key];
        if (isNonEmptyString(value)) validateRelativePath(errors, `${versionAt}.importFiles.${key}`, value);
      }
    }
  });

  // 单版本 P0：stats.sha256 已在上面核对；这里补 id/版本排序
  if (resource.versions.length > 1) addWarning(warningsArray, 'W_MULTI_VERSION', `${at}.versions`, 'P0 目前只发布单版本；多版本时 stats 只描述最新版');
}

/** 校验课程 / 字幕类资源的导入产物（存在 + lint + 与包一致）。 */
function validateImportFiles(resource, pkg, { at, versionAt, root, virtualFiles, errors, generatedAt }) {
  const version = resource.versions[0];
  const importFiles = version.importFiles;
  if (!isPlainObject(importFiles)) return;
  const mediaName = mediaNameFor(pkg);
  const expected = {
    shadowJson: `data/import/${resource.id}.shadow.json`,
    srt: `data/import/${resource.id}.srt`,
    readme: `data/import/README-${resource.id}.txt`,
  };
  for (const [key, expectedPath] of Object.entries(expected)) {
    if (importFiles[key] !== expectedPath) addError(errors, 'E_IMPORT_PATH', `${versionAt}.importFiles.${key}`, `导入产物路径必须为 ${expectedPath}（实际 ${JSON.stringify(importFiles[key])}）`);
  }

  // .shadow.json
  const shadowBuffer = safeResolve(root, virtualFiles, importFiles.shadowJson);
  if (!shadowBuffer) addError(errors, 'E_IMPORT_MISSING', `${versionAt}.importFiles.shadowJson`, `导入产物不存在：${importFiles.shadowJson}`);
  else {
    let shadowDoc = null;
    try {
      shadowDoc = JSON.parse(shadowBuffer.toString('utf8').replace(/^\ufeff/, ''));
    } catch (error) {
      addError(errors, 'E_IMPORT_JSON', `${versionAt}.importFiles.shadowJson`, `.shadow.json 不是合法 JSON：${error.message}`);
    }
    if (shadowDoc) {
      const lint = lintShadowJson(shadowDoc, { source: importFiles.shadowJson });
      errors.push(...lint.errors.map((error) => ({ ...error, path: `${importFiles.shadowJson}:${error.path}` })));
      if (shadowDoc.clips?.[0]?.id !== `clip_${resource.id}`) addError(errors, 'E_IMPORT_CLIP_ID', `${versionAt}.importFiles.shadowJson`, `clip.id 必须为 clip_${resource.id}`);
      if (shadowDoc.clips?.[0]?.name !== mediaName) addError(errors, 'E_IMPORT_MEDIA_NAME', `${versionAt}.importFiles.shadowJson`, `clip.name 必须为 ${mediaName}`);
      if (shadowDoc.savedAt !== generatedAt) addError(errors, 'E_IMPORT_SAVED_AT', `${versionAt}.importFiles.shadowJson`, `.shadow.json savedAt 必须等于 catalog generatedAt（可复现构建）`);
    }
  }

  // .srt
  const srtBuffer = safeResolve(root, virtualFiles, importFiles.srt);
  if (!srtBuffer) addError(errors, 'E_IMPORT_MISSING', `${versionAt}.importFiles.srt`, `导入产物不存在：${importFiles.srt}`);
  else {
    const sentences = Array.isArray(pkg.sentences) ? pkg.sentences : [];
    const lint = lintSrt(srtBuffer.toString('utf8'), { expectedSentences: sentences.length });
    errors.push(...lint.errors.map((error) => ({ ...error, path: `${importFiles.srt}:${error.path}` })));
  }

  // README
  const readmeBuffer = safeResolve(root, virtualFiles, importFiles.readme);
  if (!readmeBuffer) addError(errors, 'E_IMPORT_MISSING', `${versionAt}.importFiles.readme`, `导入说明不存在：${importFiles.readme}`);
  else {
    const lint = lintReadme(readmeBuffer.toString('utf8'), { pkg, mediaName });
    errors.push(...lint.errors.map((error) => ({ ...error, path: `${importFiles.readme}:${error.path}` })));
  }
}

function safeResolve(root, virtualFiles, relPath) {
  if (!isNonEmptyString(relPath) || !REL_PATH_RE.test(relPath)) return null;
  try {
    return resolveFile(root, virtualFiles, relPath);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 顶层校验：6 文件 + 引用完整性 + 计数 + 插件
// ---------------------------------------------------------------------------

/**
 * 校验一整套 catalog v2。
 * @param {{
 *   root?: string, catalogDir?: string, dataDir?: string,
 *   virtualFiles?: Map<string, Buffer|string>|Record<string, Buffer|string>,
 *   requireTypes?: string[], minResources?: number, generatedAt?: string|null
 * }} options
 */
export function validateCatalogSet(options = {}) {
  const root = options.root ? path.resolve(options.root) : path.join(REPO_ROOT, 'market');
  const catalogDir = options.catalogDir ? path.resolve(options.catalogDir) : path.join(root, 'catalog');
  const pluginsRoot = options.pluginsRoot ? path.resolve(options.pluginsRoot) : root;
  const virtualFiles = options.virtualFiles || new Map();
  const requireTypes = Array.isArray(options.requireTypes) ? options.requireTypes : RESOURCE_TYPES;
  const minResources = Number.isInteger(options.minResources) ? options.minResources : 3;
  const errors = [];
  const warnings = [];
  const read = makeFileReader(root, virtualFiles);
  const summary = { root, catalogDir, pluginsRoot, files: {}, resources: 0, versions: 0, packages: 0, importFiles: 0, pluginTypes: 0 };

  // 1. 插件声明（先读，供 type 引用校验）
  const pluginDecl = validatePluginDeclarations({ root: pluginsRoot, virtualFiles });
  errors.push(...pluginDecl.errors);
  summary.pluginTypes = pluginDecl.ids.length;

  // 2. 读 6 个 catalog 文件
  const docs = {};
  for (const [name, spec] of Object.entries(CATALOG_SPECS)) {
    const relPath = `catalog/${name}.json`;
    let buffer;
    try {
      buffer = read(relPath);
    } catch (error) {
      addError(errors, 'E_CATALOG_MISSING', relPath, `文件不存在或不可读：${error.message}`);
      continue;
    }
    let doc;
    try {
      doc = JSON.parse(buffer.toString('utf8').replace(/^\ufeff/, ''));
    } catch (error) {
      addError(errors, 'E_CATALOG_JSON', relPath, `不是合法 JSON：${error.message}`);
      continue;
    }
    docs[name] = doc;
    summary.files[name] = { bytes: buffer.length, items: Array.isArray(doc.items) ? doc.items.length : 0 };
    if (!isPlainObject(doc)) {
      addError(errors, 'E_CATALOG_OBJECT', relPath, '根节点必须是对象');
      continue;
    }
    if (doc.spec !== spec) addError(errors, 'E_CATALOG_SPEC', `${relPath}.spec`, `spec 必须为 "${spec}"，实际为 ${JSON.stringify(doc.spec)}`);
    if (doc.schemaVersion !== CATALOG_SCHEMA_VERSION) addError(errors, 'E_CATALOG_SCHEMA', `${relPath}.schemaVersion`, `schemaVersion 必须为 ${CATALOG_SCHEMA_VERSION}，实际为 ${JSON.stringify(doc.schemaVersion)}`);
    if (!isIsoTime(doc.generatedAt)) addError(errors, 'E_CATALOG_TIME', `${relPath}.generatedAt`, 'generatedAt 必须是 ISO8601 时间');
    if (!Array.isArray(doc.items)) addError(errors, 'E_CATALOG_ITEMS', `${relPath}.items`, 'items 必须是数组');
    scanForbidden(doc, relPath, errors);
  }

  const generatedAtList = Object.entries(docs)
    .map(([name, doc]) => ({ name, generatedAt: doc.generatedAt }))
    .filter((entry) => isIsoTime(entry.generatedAt));
  if (generatedAtList.length === Object.keys(CATALOG_SPECS).length) {
    const first = generatedAtList[0].generatedAt;
    for (const entry of generatedAtList) {
      if (entry.generatedAt !== first) addError(errors, 'E_CATALOG_TIME_MISMATCH', `catalog/${entry.name}.json.generatedAt`, `6 个 catalog 文件的 generatedAt 必须一致（${first} vs ${entry.generatedAt}）`);
    }
    if (options.generatedAt && first !== options.generatedAt) addError(errors, 'E_CATALOG_TIME_EXPECTED', 'catalog.generatedAt', `generatedAt 必须为 ${options.generatedAt}（实际 ${first}）`);
  }
  const generatedAt = isIsoTime(docs.resources?.generatedAt) ? docs.resources.generatedAt : generatedAtList[0]?.generatedAt || '';

  // 3. site
  if (docs.site) {
    const items = Array.isArray(docs.site.items) ? docs.site.items : [];
    if (items.length !== 1) addError(errors, 'E_SITE_ITEMS', 'catalog/site.json.items', 'site.items 必须恰好 1 条');
    const site = items[0];
    if (!isPlainObject(site)) addError(errors, 'E_SITE', 'catalog/site.json.items[0]', '站点信息必须是对象');
    else {
      for (const field of ['name', 'nameEn', 'tagline', 'description']) {
        if (!isNonEmptyString(site[field])) addError(errors, 'E_SITE_FIELD', `catalog/site.json.items[0].${field}`, `${field} 必须是非空字符串`);
      }
      if (site.version !== undefined && (typeof site.version !== 'string' || !SEMVER_RE.test(site.version))) addError(errors, 'E_SITE_VERSION', 'catalog/site.json.items[0].version', 'version 必须是 semver');
      if (!Array.isArray(site.languages) || site.languages.length === 0) addError(errors, 'E_SITE_LANGUAGES', 'catalog/site.json.items[0].languages', 'languages 必须是非空数组');
      if (site.nav !== undefined && (!Array.isArray(site.nav) || site.nav.some((item) => !isPlainObject(item) || !isNonEmptyString(item.id) || !isNonEmptyString(item.href)))) {
        addError(errors, 'E_SITE_NAV', 'catalog/site.json.items[0].nav', 'nav 必须是 { id, label, labelEn, href } 数组');
      }
    }
  }

  // 4. categories
  const categoryIds = new Map();
  if (docs.categories) {
    const items = Array.isArray(docs.categories.items) ? docs.categories.items : [];
    if (items.length === 0) addError(errors, 'E_CATEGORIES_EMPTY', 'catalog/categories.json.items', 'categories 至少 1 条');
    const orders = new Set();
    items.forEach((category, index) => {
      const at = `catalog/categories.json.items[${index}]`;
      if (!isPlainObject(category) || !isNonEmptyString(category.id)) {
        addError(errors, 'E_CATEGORY', at, 'category 必须含非空 id');
        return;
      }
      if (categoryIds.has(category.id)) addError(errors, 'E_CATEGORY_DUP', `${at}.id`, `category id 重复：${category.id}`);
      categoryIds.set(category.id, category);
      if (!ID_RE.test(category.id)) addError(errors, 'E_CATEGORY_ID', `${at}.id`, 'category id 必须是 kebab-case（如 daily）');
      for (const field of ['label', 'labelEn']) if (!isNonEmptyString(category[field])) addError(errors, 'E_CATEGORY_FIELD', `${at}.${field}`, `${field} 必须是非空字符串`);
      if (category.order !== undefined) {
        if (!Number.isInteger(category.order) || category.order < 1) addError(errors, 'E_CATEGORY_ORDER', `${at}.order`, 'order 必须是 >= 1 的整数');
        else if (orders.has(category.order)) addError(errors, 'E_CATEGORY_ORDER_DUP', `${at}.order`, `order 重复：${category.order}`);
        else orders.add(category.order);
      }
      if (category.count !== undefined && (!Number.isInteger(category.count) || category.count < 0)) addError(errors, 'E_CATEGORY_COUNT', `${at}.count`, 'count 必须是 >= 0 的整数');
    });
    if (categoryIds.size !== items.length) addError(errors, 'E_CATEGORY_DUP', 'catalog/categories.json.items', '存在非法 / 重复的分类');
  }

  // 5. tags
  const tagNames = new Map();
  if (docs.tags) {
    const items = Array.isArray(docs.tags.items) ? docs.tags.items : [];
    items.forEach((tag, index) => {
      const at = `catalog/tags.json.items[${index}]`;
      if (!isPlainObject(tag) || !isNonEmptyString(tag.tag)) {
        addError(errors, 'E_TAG', at, 'tag 条目必须含非空 tag 字段');
        return;
      }
      if (tagNames.has(tag.tag)) addError(errors, 'E_TAG_DUP', `${at}.tag`, `tag 重复：${tag.tag}`);
      tagNames.set(tag.tag, tag);
      if (tag.aliases !== undefined && (!Array.isArray(tag.aliases) || tag.aliases.some((alias) => !isNonEmptyString(alias)))) {
        addError(errors, 'E_TAG_ALIASES', `${at}.aliases`, 'aliases 必须是非空字符串数组');
      }
      if (tag.count !== undefined && (!Number.isInteger(tag.count) || tag.count < 0)) addError(errors, 'E_TAG_COUNT', `${at}.count`, 'count 必须是 >= 0 的整数');
    });
  }

  // 6. authors
  const authorHandles = new Set();
  const authors = new Map();
  if (docs.authors) {
    const items = Array.isArray(docs.authors.items) ? docs.authors.items : [];
    if (items.length === 0) addError(errors, 'E_AUTHORS_EMPTY', 'catalog/authors.json.items', 'authors 至少 1 条');
    items.forEach((author, index) => {
      const at = `catalog/authors.json.items[${index}]`;
      if (!isPlainObject(author) || !isNonEmptyString(author.handle)) {
        addError(errors, 'E_AUTHOR', at, 'author 必须含非空 handle');
        return;
      }
      if (authorHandles.has(author.handle)) addError(errors, 'E_AUTHOR_DUP', `${at}.handle`, `author handle 重复：${author.handle}`);
      authorHandles.add(author.handle);
      authors.set(author.handle, author);
      if (!HANDLE_RE.test(author.handle)) addError(errors, 'E_AUTHOR_HANDLE', `${at}.handle`, 'handle 必须是 kebab-case（如 shadow-studio）');
      for (const field of ['name', 'bio']) if (!isNonEmptyString(author[field])) addError(errors, 'E_AUTHOR_FIELD', `${at}.${field}`, `${field} 必须是非空字符串`);
      if (author.url !== undefined && typeof author.url !== 'string') addError(errors, 'E_AUTHOR_URL', `${at}.url`, 'url 必须是字符串（可为空）');
      if (!isNonEmptyString(author.licenseDefault)) addError(errors, 'E_AUTHOR_LICENSE', `${at}.licenseDefault`, 'licenseDefault 必须是非空字符串');
    });
  }

  // 7. licenses
  const licenseIds = new Set();
  if (docs.licenses) {
    const items = Array.isArray(docs.licenses.items) ? docs.licenses.items : [];
    if (items.length === 0) addError(errors, 'E_LICENSES_EMPTY', 'catalog/licenses.json.items', 'licenses 至少 1 条');
    items.forEach((license, index) => {
      const at = `catalog/licenses.json.items[${index}]`;
      if (!isPlainObject(license) || !isNonEmptyString(license.id)) {
        addError(errors, 'E_LICENSE', at, 'license 必须含非空 id');
        return;
      }
      if (licenseIds.has(license.id)) addError(errors, 'E_LICENSE_DUP', `${at}.id`, `license id 重复：${license.id}`);
      licenseIds.add(license.id);
      for (const field of ['name', 'fullText', 'rightsNotes']) if (!isNonEmptyString(license[field])) addError(errors, 'E_LICENSE_FIELD', `${at}.${field}`, `${field} 必须是非空字符串`);
      if (license.url !== undefined) {
        if (typeof license.url !== 'string') addError(errors, 'E_LICENSE_URL', `${at}.url`, 'url 必须是字符串');
        else if (license.url !== '' && !/^https?:\/\//i.test(license.url)) addError(errors, 'E_LICENSE_URL', `${at}.url`, 'url 必须为空或 http(s) 链接');
      }
    });
  }
  for (const [handle, author] of authors) {
    if (isNonEmptyString(author.licenseDefault) && licenseIds.size > 0 && !licenseIds.has(author.licenseDefault)) {
      addError(errors, 'E_AUTHOR_LICENSE_REF', `catalog/authors.json:${handle}.licenseDefault`, `licenseDefault ${author.licenseDefault} 未在 licenses.json 中登记`);
    }
  }

  // 8. resources
  const resources = docs.resources && Array.isArray(docs.resources.items) ? docs.resources.items : null;
  const resourceIds = new Set();
  const usedCategoryCount = new Map();
  const usedTagCount = new Map();
  if (!resources) {
    if (docs.resources) addError(errors, 'E_RESOURCES', 'catalog/resources.json.items', 'resources.items 必须是数组');
  } else {
    summary.resources = resources.length;
    if (resources.length < minResources) addError(errors, 'E_RESOURCES_MIN', 'catalog/resources.json.items', `P0 至少需要 ${minResources} 条资源（实际 ${resources.length}）`);
    resources.forEach((resource, index) => {
      const at = `catalog/resources.json.items[${index}]`;
      validateResource(resource, {
        at,
        errors,
        warnings,
        root,
        virtualFiles,
        generatedAt,
        categoryIds: new Set(categoryIds.keys()),
        authorHandles,
        licenseIds,
        tagNames: new Set(tagNames.keys()),
        declaredTypes: pluginDecl.ids,
      });
      if (isPlainObject(resource)) {
        if (resourceIds.has(resource.id)) addError(errors, 'E_RESOURCE_DUP', `${at}.id`, `资源 id 重复：${resource.id}`);
        resourceIds.add(resource.id);
        usedCategoryCount.set(resource.category, (usedCategoryCount.get(resource.category) || 0) + 1);
        for (const tag of Array.isArray(resource.tags) ? resource.tags : []) usedTagCount.set(tag, (usedTagCount.get(tag) || 0) + 1);
        if (Array.isArray(resource.versions)) summary.versions += resource.versions.length;
        if (resource.type === 'course' || resource.type === 'subtitle') summary.packages += 1;
        if (isPlainObject(resource.versions?.[0]?.importFiles)) summary.importFiles += 3;
      }
    });

    // 计数一致性
    for (const [id, category] of categoryIds) {
      const actual = usedCategoryCount.get(id) || 0;
      if (category.count !== undefined && category.count !== actual) addError(errors, 'E_CATEGORY_COUNT_MISMATCH', `catalog/categories.json:${id}.count`, `count（${category.count}）与资源数（${actual}）不一致`);
    }
    for (const [tag, entry] of tagNames) {
      const actual = usedTagCount.get(tag) || 0;
      if (entry.count !== undefined && entry.count !== actual) addError(errors, 'E_TAG_COUNT_MISMATCH', `catalog/tags.json:${tag}.count`, `count（${entry.count}）与资源数（${actual}）不一致`);
      if (actual === 0) addWarning(warnings, 'W_TAG_UNUSED', `catalog/tags.json:${tag}`, '标签未被任何资源使用');
    }

    // P0 类型覆盖
    const usedTypes = new Set(resources.map((resource) => resource.type));
    for (const type of requireTypes) {
      if (!usedTypes.has(type)) addError(errors, 'E_TYPES_REQUIRED', 'catalog/resources.json.items', `P0 至少需要 1 条 type=${type} 的资源`);
    }
  }

  // 9. 插件白名单下载物必须存在（插件类资源引用）
  for (const resource of resources || []) {
    if (!isPlainObject(resource) || resource.type !== 'plugin') continue;
    for (const version of Array.isArray(resource.versions) ? resource.versions : []) {
      if (isPlainObject(version) && isNonEmptyString(version.packageUrl)) {
        // 文件存在性在 validateResource 中已校验
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      ...summary,
      generatedAt,
      categories: categoryIds.size,
      tags: tagNames.size,
      authors: authorHandles.size,
      licenses: licenseIds.size,
      errorCount: errors.length,
      warningCount: warnings.length,
    },
    docs,
  };
}

// ---------------------------------------------------------------------------
// 自测（--selftest）：构造一份合法 catalog，再逐项破坏，确认都能被检出
// ---------------------------------------------------------------------------

function makeSelftestFixture() {
  const generatedAt = '2026-10-31T15:30:00.000Z';
  const files = new Map();
  const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

  const manifests = {
    course: {
      manifestVersion: 1,
      kind: 'resource-type',
      id: 'course',
      label: '课程包',
      labelEn: 'Course',
      icon: 'book',
      color: '#2EE6A8',
      fileExt: ['.shadowcourse'],
      detailTabs: ['readme', 'sentences', 'files', 'versions'],
      cardBadges: ['free', 'level'],
      install: { mode: 'desktop-import', deepLink: 'shadow-import' },
      permissions: { network: false, filesystem: false, microphone: false },
      enabled: true,
    },
    subtitle: {
      manifestVersion: 1,
      kind: 'resource-type',
      id: 'subtitle',
      label: '字幕包',
      labelEn: 'Subtitle',
      icon: 'captions',
      color: '#C77DFF',
      fileExt: ['.srt', '.json'],
      detailTabs: ['readme', 'sentences'],
      cardBadges: ['free'],
      install: { mode: 'desktop-import', deepLink: 'shadow-import' },
      permissions: { network: false, filesystem: false, microphone: false },
      enabled: true,
    },
    plugin: {
      manifestVersion: 1,
      kind: 'resource-type',
      id: 'plugin',
      label: '插件说明',
      labelEn: 'Plugin',
      icon: 'puzzle',
      color: '#E88A2E',
      fileExt: ['.json'],
      detailTabs: ['readme', 'files'],
      cardBadges: ['free'],
      install: { mode: 'download', deepLink: '' },
      permissions: { network: false, filesystem: false, microphone: false },
      enabled: true,
    },
  };
  files.set('plugins/index.json', JSON.stringify({
    spec: PLUGIN_INDEX_SPEC,
    schemaVersion: 1,
    plugins: ['course', 'subtitle', 'plugin'],
    types: [
      { id: 'course', manifest: 'plugins/course/manifest.json', enabled: true },
      { id: 'subtitle', manifest: 'plugins/subtitle/manifest.json', enabled: true },
      { id: 'plugin', manifest: 'plugins/plugin/manifest.json', enabled: true },
    ],
  }, null, 2));
  for (const [id, manifest] of Object.entries(manifests)) files.set(`plugins/${id}/manifest.json`, JSON.stringify(manifest, null, 2));

  const makePkg = (id, title, type) => ({
    spec: 'shadow.course',
    schemaVersion: 1,
    id,
    version: '1.0.0',
    title,
    subtitle: `${title} · B1`,
    description: `${title} 示例描述。`,
    category: 'daily',
    tags: ['B1'],
    level: 'B1',
    language: ['en', 'zh'],
    creator: { name: 'SHADOW Studio', url: '', handle: 'shadow-studio' },
    license: 'CC-BY-4.0',
    rights: { basis: 'own', evidenceUrl: '', note: 'own' },
    mediaPolicy: 'byom',
    media: [{ id: 'm1', kind: 'audio', duration: 0, hint: '自备媒体' }],
    sentences: [
      { sentenceId: 's_0001', start: 0, end: 1.5, text: 'Hello world.', translation: '你好，世界。', notes: '' },
      { sentenceId: 's_0002', start: 2, end: 3.5, text: 'This is a test.', translation: '这是一个测试。', notes: '' },
    ],
    exercises: { spec: 'shadow.exercises', schemaVersion: 1, default: { mode: 'shadow' } },
    requires: { shadow: '>=0.7.0' },
    createdAt: '2026-10-31T00:00:00Z',
    updatedAt: generatedAt,
    readme: `# ${title}\n\n纯数据包示例。`,
  });

  const resourceBase = (id, type, title) => ({
    id,
    type,
    title,
    subtitle: `${title} · B1`,
    description: `${title} 的 1–3 句描述。`,
    category: 'daily',
    level: 'B1',
    tags: ['B1'],
    author: 'shadow-studio',
    license: 'CC-BY-4.0',
    rights: { basis: 'own', evidenceUrl: '', note: 'own' },
    mediaMode: 'byom',
    language: ['en', 'zh'],
    points: 0,
    free: true,
    platforms: ['windows', 'web'],
    requires: { shadow: '>=0.7.0' },
    cover: { color1: '#1B4D3E', color2: '#2EE6A8' },
    createdAt: '2026-10-31T00:00:00Z',
    updatedAt: generatedAt,
    readme: `## ${title}\n\n示例 README。`,
  });

  const addPackageResource = (id, type, title) => {
    const pkg = makePkg(id, title, type);
    const pkgBuffer = Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    const pkgRel = `data/packages/${id}.shadowcourse`;
    files.set(pkgRel, pkgBuffer.toString('utf8'));
    const mediaName = mediaNameFor(pkg);
    const shadowDoc = convertPackageToShadowJson(pkg, { savedAt: generatedAt, mediaName });
    const shadowRel = `data/import/${id}.shadow.json`;
    const srtRel = `data/import/${id}.srt`;
    const readmeRel = `data/import/README-${id}.txt`;
    files.set(shadowRel, `${JSON.stringify(shadowDoc, null, 2)}\n`);
    files.set(srtRel, buildSrt(pkg));
    files.set(readmeRel, buildImportReadme(pkg, { mediaName }));
    const computed = { sentences: pkg.sentences.length, durationSec: 3.5, words: 6 };
    return {
      ...resourceBase(id, type, title),
      stats: { ...computed, sizeBytes: pkgBuffer.length, sha256: sha256(pkgBuffer) },
      versions: [{
        version: '1.0.0',
        packageUrl: pkgRel,
        sha256: sha256(pkgBuffer),
        sizeBytes: pkgBuffer.length,
        compat: { shadow: '>=0.7.0', schemaVersion: 1 },
        changelog: ['首个版本'],
        publishedAt: '2026-10-31T00:00:00Z',
        downloads: 0,
        importFiles: { shadowJson: shadowRel, srt: srtRel, readme: readmeRel },
      }],
    };
  };

  const course = addPackageResource('com.shadow.course.demo-a', 'course', '示例课程 A');
  const subtitle = addPackageResource('com.shadow.subtitle.demo-b', 'subtitle', '示例字幕包 B');

  const whitelist = {
    spec: PLUGIN_WHITELIST_SPEC,
    schemaVersion: 1,
    generatedAt,
    title: 'SHADOW 市场内置插件白名单',
    statement: '纯声明白名单：不含任何可执行代码；permissions 全部为 false。',
    executable: false,
    permissions: { network: false, filesystem: false, microphone: false, clipboard: false },
    installPolicy: { mode: 'whitelist-only', arbitraryUrlInstall: false, arbitraryCodeInstall: false, executesRemoteCode: false },
    types: ['course', 'subtitle', 'plugin'].map((id) => ({ id, enabled: true, permissions: { network: false, filesystem: false, microphone: false } })),
    boundary: { layer: 'declarative-resource-type', marketSandbox: false, unrelatedTo: 'SHADOW Studio shadow-plugin/1' },
  };
  const whitelistBuffer = Buffer.from(`${JSON.stringify(whitelist, null, 2)}\n`, 'utf8');
  const whitelistRel = 'data/plugins/builtin-whitelist.json';
  files.set(whitelistRel, whitelistBuffer.toString('utf8'));
  const pluginReadmeRel = 'data/plugins/README-builtin-whitelist.txt';
  files.set(pluginReadmeRel, [
    'SHADOW 市场 · 插件白名单说明',
    '本白名单不含任何可执行代码，permissions 权限全部为 false。',
    '【5 步导入】',
    '1. 下载白名单 JSON。',
    '2. 用文本编辑器打开。',
    '3. 检查 executable=false。',
    '4. 检查 permissions 全 false。',
    '5. 与 market/plugins manifest 对照。',
    '【三个坑】',
    '① 不是可执行插件。',
    '② 不提供任意 URL 安装。',
    '③ 权限声明不代表运行时授权。',
    'BYOM · CC-BY-4.0',
  ].join('\n'));

  const plugin = {
    ...resourceBase('com.shadow.plugin.demo-bw', 'plugin', '内置插件白名单 · 示例'),
    level: '',
    stats: { sentences: 0, durationSec: 0, words: 0, sizeBytes: whitelistBuffer.length, sha256: sha256(whitelistBuffer) },
    readme: '## 内置插件白名单 · 示例\n\n纯声明式 JSON，无可执行代码，权限全 false。',
    versions: [{
      version: '1.0.0',
      packageUrl: whitelistRel,
      sha256: sha256(whitelistBuffer),
      sizeBytes: whitelistBuffer.length,
      compat: { shadow: '>=0.7.0', schemaVersion: 1 },
      changelog: ['首个版本'],
      publishedAt: '2026-10-31T00:00:00Z',
      downloads: 0,
      importFiles: { shadowJson: null, srt: null, readme: pluginReadmeRel },
    }],
  };

  files.set('catalog/site.json', JSON.stringify({
    spec: CATALOG_SPECS.site, schemaVersion: 2, generatedAt,
    items: [{
      id: 'shadow-market', name: 'SHADOW 市场', nameEn: 'SHADOW MARKET', tagline: '全免费 · BYOM', description: '示例站点',
      version: '2.0.0', languages: ['zh-CN', 'en'], nav: [{ id: 'explore', label: '探索', labelEn: 'Explore', href: '#/' }],
      footer: { statement: '全免费' },
    }],
  }, null, 2));
  files.set('catalog/categories.json', JSON.stringify({
    spec: CATALOG_SPECS.categories, schemaVersion: 2, generatedAt,
    items: [{ id: 'daily', label: '日常会话', labelEn: 'Daily', order: 1, count: 3 }],
  }, null, 2));
  files.set('catalog/tags.json', JSON.stringify({
    spec: CATALOG_SPECS.tags, schemaVersion: 2, generatedAt,
    items: [{ tag: 'B1', label: 'B1', labelEn: 'B1', aliases: ['b1'], count: 3 }],
  }, null, 2));
  files.set('catalog/authors.json', JSON.stringify({
    spec: CATALOG_SPECS.authors, schemaVersion: 2, generatedAt,
    items: [{ handle: 'shadow-studio', name: 'SHADOW Studio', bio: '官方示例', url: '', licenseDefault: 'CC-BY-4.0' }],
  }, null, 2));
  files.set('catalog/licenses.json', JSON.stringify({
    spec: CATALOG_SPECS.licenses, schemaVersion: 2, generatedAt,
    items: [{ id: 'CC-BY-4.0', name: 'CC BY 4.0', nameEn: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', fullText: '署名即可', rightsNotes: '无媒体' }],
  }, null, 2));
  files.set('catalog/resources.json', JSON.stringify({
    spec: CATALOG_SPECS.resources, schemaVersion: 2, generatedAt,
    items: [course, subtitle, plugin],
  }, null, 2));

  return { files, generatedAt };
}

function writeFixture(root, files) {
  fs.mkdirSync(root, { recursive: true });
  for (const [relPath, content] of files) {
    const file = path.resolve(root, relPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  }
}

function mutateJson(files, relPath, mutator) {
  const doc = JSON.parse(files.get(relPath));
  mutator(doc);
  files.set(relPath, JSON.stringify(doc, null, 2));
}

/** 运行内置自测：合法基线 PASS + 若干反例必须 FAIL。 */
export function runSelftest({ silent = false } = {}) {
  const fixture = makeSelftestFixture();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-catalog-selftest-'));
  const results = [];
  const record = (name, expectedOk, result) => {
    const pass = result.ok === expectedOk;
    results.push({ name, pass, expectedOk, ok: result.ok, errors: result.errors.map((error) => `${error.code} ${error.path}`).slice(0, 4) });
    return pass;
  };
  try {
    const baselineDir = path.join(tmpRoot, 'baseline');
    writeFixture(baselineDir, fixture.files);
    const baseline = validateCatalogSet({ root: baselineDir });
    record('基线合法 catalog → PASS', true, baseline);
    if (!baseline.ok && !silent) {
      console.error('基线本身未通过：');
      for (const error of baseline.errors) console.error(`  [${error.code}] ${error.path} ${error.message}`);
    }

    const cases = [
      ['缺少 catalog/site.json → FAIL', (files) => files.delete('catalog/site.json')],
      ['resources.spec 错误 → FAIL', (files) => mutateJson(files, 'catalog/resources.json', (doc) => { doc.spec = 'shadow.market.catalog'; })],
      ['resources.schemaVersion=1 → FAIL', (files) => mutateJson(files, 'catalog/resources.json', (doc) => { doc.schemaVersion = 1; })],
      ['资源 id 重复 → FAIL', (files) => mutateJson(files, 'catalog/resources.json', (doc) => { doc.items[1].id = doc.items[0].id; })],
      ['category 未登记 → FAIL', (files) => mutateJson(files, 'catalog/resources.json', (doc) => { doc.items[0].category = 'unknown'; })],
      ['author 未登记 → FAIL', (files) => mutateJson(files, 'catalog/resources.json', (doc) => { doc.items[0].author = 'nobody'; })],
      ['license 未登记 → FAIL', (files) => mutateJson(files, 'catalog/resources.json', (doc) => { doc.items[0].license = 'MIT'; })],
      ['points 非 0 → FAIL', (files) => mutateJson(files, 'catalog/resources.json', (doc) => { doc.items[0].points = 10; })],
      ['free 非 true → FAIL', (files) => mutateJson(files, 'catalog/resources.json', (doc) => { doc.items[0].free = false; })],
      ['mediaMode 非 byom → FAIL', (files) => mutateJson(files, 'catalog/resources.json', (doc) => { doc.items[0].mediaMode = 'embedded'; })],
      ['sha256 不匹配 → FAIL', (files) => mutateJson(files, 'catalog/resources.json', (doc) => { doc.items[0].versions[0].sha256 = '0'.repeat(64); })],
      ['sizeBytes 不匹配 → FAIL', (files) => mutateJson(files, 'catalog/resources.json', (doc) => { doc.items[0].versions[0].sizeBytes += 1; })],
      ['packageUrl 为绝对路径 → FAIL', (files) => mutateJson(files, 'catalog/resources.json', (doc) => { doc.items[0].versions[0].packageUrl = 'C:/x.shadowcourse'; })],
      ['stats.sentences 与包不一致 → FAIL', (files) => mutateJson(files, 'catalog/resources.json', (doc) => { doc.items[0].stats.sentences += 1; })],
      ['importFiles 缺 srt 文件 → FAIL', (files) => files.delete('data/import/com.shadow.course.demo-a.srt')],
      ['importFiles.srt 路径错误 → FAIL', (files) => mutateJson(files, 'catalog/resources.json', (doc) => { doc.items[0].versions[0].importFiles.srt = 'data/import/other.srt'; })],
      ['.shadow.json clips 缺失 → FAIL', (files) => files.set('data/import/com.shadow.course.demo-a.shadow.json', JSON.stringify({ app: 'SHADOW STUDIO', version: 1, clips: [] }))],
      ['插件白名单 permissions.network=true → FAIL', (files) => {
        const doc = JSON.parse(files.get('data/plugins/builtin-whitelist.json'));
        doc.permissions.network = true;
        files.set('data/plugins/builtin-whitelist.json', JSON.stringify(doc, null, 2));
        mutateJson(files, 'catalog/resources.json', (resources) => {
          const buffer = Buffer.from(files.get('data/plugins/builtin-whitelist.json'), 'utf8');
          const pluginResource = resources.items.find((item) => item.type === 'plugin');
          pluginResource.versions[0].sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
          pluginResource.versions[0].sizeBytes = buffer.length;
          pluginResource.stats.sha256 = pluginResource.versions[0].sha256;
          pluginResource.stats.sizeBytes = pluginResource.versions[0].sizeBytes;
        });
      }],
      ['插件白名单 executable=true → FAIL', (files) => {
        const doc = JSON.parse(files.get('data/plugins/builtin-whitelist.json'));
        doc.executable = true;
        files.set('data/plugins/builtin-whitelist.json', JSON.stringify(doc, null, 2));
        mutateJson(files, 'catalog/resources.json', (resources) => {
          const buffer = Buffer.from(files.get('data/plugins/builtin-whitelist.json'), 'utf8');
          const pluginResource = resources.items.find((item) => item.type === 'plugin');
          pluginResource.versions[0].sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
          pluginResource.versions[0].sizeBytes = buffer.length;
          pluginResource.stats.sha256 = pluginResource.versions[0].sha256;
          pluginResource.stats.sizeBytes = pluginResource.versions[0].sizeBytes;
        });
      }],
      ['未登记的资源类型 → FAIL', (files) => mutateJson(files, 'catalog/resources.json', (doc) => { doc.items[0].type = 'template'; })],
      ['manifest 权限 true → FAIL', (files) => mutateJson(files, 'plugins/course/manifest.json', (doc) => { doc.permissions.network = true; })],
      ['manifest 含远程 URL → FAIL', (files) => mutateJson(files, 'plugins/course/manifest.json', (doc) => { doc.homepage = 'https://example.com'; })],
      ['catalog generatedAt 不一致 → FAIL', (files) => mutateJson(files, 'catalog/tags.json', (doc) => { doc.generatedAt = '2026-11-01T00:00:00.000Z'; })],
      ['resources.readme 含绝对路径 → FAIL', (files) => mutateJson(files, 'catalog/resources.json', (doc) => { doc.items[0].readme = '路径 C:\\Users\\secret\\a.mp4'; })],
      ['tag 未登记 → FAIL', (files) => mutateJson(files, 'catalog/resources.json', (doc) => { doc.items[0].tags = ['ZZ']; })],
      ['category.count 不一致 → FAIL', (files) => mutateJson(files, 'catalog/categories.json', (doc) => { doc.items[0].count = 1; })],
      ['P0 类型缺失（无 subtitle）→ FAIL', (files) => mutateJson(files, 'catalog/resources.json', (doc) => { doc.items = doc.items.filter((item) => item.type !== 'subtitle'); })],
    ];

    let index = 0;
    for (const [name, mutator] of cases) {
      index += 1;
      const dir = path.join(tmpRoot, `case-${index}`);
      const files = new Map(fixture.files);
      mutator(files);
      writeFixture(dir, files);
      const result = validateCatalogSet({ root: dir });
      record(name, false, result);
    }
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch { /* 忽略清理失败 */ }
  }

  const passed = results.filter((result) => result.pass).length;
  const ok = passed === results.length;
  if (!silent) {
    console.log('SHADOW catalog v2 校验器 · 自测（--selftest）');
    for (const result of results) {
      console.log(`  [${result.pass ? 'PASS' : 'FAIL'}] ${result.name}${result.pass ? '' : `（实测 ok=${result.ok}；${result.errors.join('；')}）`}`);
    }
    console.log('');
    console.log(`${passed}/${results.length} ${ok ? 'PASS ✅' : 'FAIL ❌'}`);
  }
  return { ok, passed, total: results.length, results };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseCli(argv) {
  const opts = { root: path.join(REPO_ROOT, 'market'), catalog: null, data: null, json: false, selftest: false, help: false, error: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') opts.json = true;
    else if (arg === '--selftest') opts.selftest = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--root' || arg === '--catalog' || arg === '--data') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        opts.error = `${arg} 需要一个参数`;
        break;
      }
      if (arg === '--root') opts.root = path.resolve(process.cwd(), value);
      if (arg === '--catalog') opts.catalog = path.resolve(process.cwd(), value);
      if (arg === '--data') opts.data = path.resolve(process.cwd(), value);
      index += 1;
    } else if (arg.startsWith('--root=')) opts.root = path.resolve(process.cwd(), arg.slice('--root='.length));
    else if (arg.startsWith('--catalog=')) opts.catalog = path.resolve(process.cwd(), arg.slice('--catalog='.length));
    else if (arg.startsWith('--data=')) opts.data = path.resolve(process.cwd(), arg.slice('--data='.length));
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
  if (opts.selftest) {
    const result = runSelftest({ silent: opts.json });
    if (opts.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  try {
    const result = validateCatalogSet({
      root: opts.root,
      catalogDir: opts.catalog || undefined,
      dataDir: opts.data || undefined,
    });
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({ ok: result.ok, summary: result.summary, errors: result.errors, warnings: result.warnings }, null, 2)}\n`);
    } else {
      console.log('SHADOW 市场 catalog v2 校验器（6 文件 · 引用完整性 · sha256/size · 导入产物 · 插件白名单）');
      console.log(`根目录：${opts.root}`);
      console.log('');
      const lines = [
        ['catalog 文件', `${Object.keys(CATALOG_SPECS).length}/6`],
        ['资源数', result.summary.resources],
        ['版本数', result.summary.versions],
        ['包文件（course/subtitle）', result.summary.packages],
        ['导入产物文件', result.summary.importFiles],
        ['资源类型（插件白名单）', result.summary.pluginTypes],
      ];
      for (const [label, value] of lines) console.log(`  ${label}：${value}`);
      console.log(`  分类：${result.summary.categories} · 标签：${result.summary.tags} · 作者：${result.summary.authors} · 许可：${result.summary.licenses}`);
      console.log('');
      if (result.warnings.length > 0) {
        for (const warning of result.warnings.slice(0, 20)) console.log(`  [WARN] ${warning.code} ${warning.path} ${warning.message}`);
        console.log('');
      }
      if (result.ok) {
        console.log(`catalog v2 校验：${result.summary.errorCount} error · ${result.summary.warningCount} warning · PASS ✅`);
      } else {
        console.error(`catalog v2 校验：${result.summary.errorCount} error · FAIL ❌`);
        for (const error of result.errors) console.error(`  [${error.code}] ${error.path} ${error.message}`);
      }
    }
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(`[catalog] 校验失败：${error && error.message ? error.message : error}`);
    if (opts.json) process.stdout.write(`${JSON.stringify({ ok: false, error: String(error && error.message ? error.message : error) }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (isMain) main();
