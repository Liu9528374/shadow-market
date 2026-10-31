/**
 * data-contract-check.mjs - SHADOW 市场 P0（Phase 2）数据契约独立静态校验
 *
 * 纯文件 I/O：不起服务、不开浏览器；独立于 tools/catalog/validate-catalog.mjs 实现（交叉验证）。
 * 契约真相：D:\FOLLOWSPEAK\docs\111-market-architecture.md §3（catalog v2）/ §5（导入产物）/ §4（插件清单）
 *
 * 覆盖：
 *   A. market/catalog/ 六文件（site/categories/tags/authors/licenses/resources）：
 *      spec/schemaVersion=2/generatedAt/items 结构 + 非空 + 字段齐全。
 *   B. resources 引用完整性：category→categories.id、author→authors.handle、license→licenses.id、
 *      type→plugins/index.json+manifest；tag→tags.json（level 标签如 B1 除外）；id 唯一/正则。
 *   C. 资源字段：type/title/description/rights/mediaMode=byom/language/points=0/free=true/
 *      stats{sentences,durationSec,words,sizeBytes,sha256}/versions[]/createdAt/updatedAt。
 *   D. 版本与文件一致：versions[0].packageUrl 存在、sha256 64hex 且与真实文件一致、sizeBytes=真实字节、
 *      downloads=0、changelog≥1、compat；派生导入产物 .shadow.json/.srt/readme 存在且可解析。
 *   E. 包内容：course/subtitle 包 spec=shadow.course/schemaVersion=1/mediaPolicy=byom/句子时间轴/
 *      stats 与包一致（sentences/words/size/duration）；plugin 类型为纯声明 JSON（无脚本/iframe）。
 *   F. .shadow.json 工程 lint（docs/111 §5.3）：clips≥1、id 唯一、name ASCII 无空格、duration>0、
 *      sentences en 非空/end>start/升序、无绝对路径/wavPath/媒体字节、≤2MB。
 *   G. .srt：cue 数=包内句子数、时间轴可解析；README-导入说明存在。
 *   H. 可复现性辅助：catalog.generatedAt 可解析（--now 固定时同字节由构建侧保证）。
 *
 * 用法：D:\NODE\node.exe tools\qa\market\data-contract-check.mjs [--report=相对路径] [--market=dir]
 * 退出码：0 全 PASS；1 有 FAIL；2 数据未就绪（catalog v2 缺失/不可解析，不伪造 PASS）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');
const argv = process.argv.slice(2);
const argOf = (name) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const MARKET = path.resolve(REPO, argOf('market') || 'market');
const REPORT = argOf('report') ? path.resolve(REPO, argOf('report')) : path.join(__dirname, 'report-data-contract.json');
const CATALOG = path.join(MARKET, 'catalog');

const checks = [];
function ok(id, name, cond, detail = '') {
  const entry = { id, name, pass: !!cond, detail: String(detail), at: new Date().toISOString() };
  checks.push(entry);
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${id} ${name}${detail ? ' :: ' + detail : ''}`);
  return !!cond;
}
function readJson(file) {
  const text = fs.readFileSync(file, 'utf8');
  return { json: JSON.parse(text), bytes: Buffer.from(text, 'utf8'), text };
}
function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const HEX64_RE = /^[a-f0-9]{64}$/i;
const SENT_LEVEL_RE = /^(A1|A2|B1|B2|C1|C2)$/i;
const ACTIVE_RE = /<\s*script|<\s*iframe|javascript\s*:|on(?:error|load|click|mouseover|focus|submit)\s*=/i;
const RIGHTS_BASIS = ['own', 'licensed', 'public-domain', 'cc'];
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

function findActive(value, pathStr = '$', found = [], depth = 0) {
  if (found.length >= 8 || depth > 12) return found;
  if (typeof value === 'string') { if (ACTIVE_RE.test(value)) found.push(pathStr); return found; }
  if (Array.isArray(value)) { value.forEach((v, i) => findActive(v, `${pathStr}[${i}]`, found, depth + 1)); return found; }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      if (FORBIDDEN_KEYS.includes(k)) { found.push(`${pathStr}.${k}`); continue; }
      if (/^(script|scripts|code|exec|entry|main|module|src)$/i.test(k)) found.push(`${pathStr}.${k}(可执行字段)`);
      findActive(value[k], `${pathStr}.${k}`, found, depth + 1);
    }
  }
  return found;
}
function findAbsPath(value, pathStr = '$', found = [], depth = 0) {
  if (found.length >= 8 || depth > 12) return found;
  if (typeof value === 'string') {
    if (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) || /^file:\/\//i.test(value) || /base64,/i.test(value)) found.push(pathStr);
    return found;
  }
  if (Array.isArray(value)) { value.forEach((v, i) => findAbsPath(v, `${pathStr}[${i}]`, found, depth + 1)); return found; }
  if (value && typeof value === 'object') { for (const k of Object.keys(value)) findAbsPath(value[k], `${pathStr}.${k}`, found, depth + 1); }
  return found;
}
function isIso(s) { return typeof s === 'string' && s.length >= 10 && !Number.isNaN(Date.parse(s)); }
function rel(file) { return path.relative(MARKET, file).split(path.sep).join('/'); }
function resolveMarket(p) {
  if (!p) return null;
  const clean = String(p).replace(/^\.?\//, '');
  return path.join(MARKET, clean);
}
/** 字段可能是字符串 URL 或 {url,sha256,sizeBytes,readme?} 对象 */
function fileInfoOf(v) {
  if (!v) return null;
  if (typeof v === 'string') return { url: v, sha256: null, sizeBytes: null };
  if (Array.isArray(v)) return fileInfoOf(v[0]);
  if (typeof v === 'object') return { url: v.url || v.href || v.path || v.packageUrl || null, sha256: v.sha256 || null, sizeBytes: typeof v.sizeBytes === 'number' ? v.sizeBytes : null, readme: v.readme || null };
  return null;
}

const report = {
  test: 'market-data-contract', round: 'phase2', startedAt: new Date().toISOString(),
  marketDir: MARKET, catalogDir: CATALOG, files: {}, checks, summary: null, pass: false, fatal: null,
};

let fatal = null;
try {
  /* ---------- A. catalog v2 六文件 ---------- */
  const names = ['site', 'categories', 'tags', 'authors', 'licenses', 'resources'];
  const docs = {};
  for (const name of names) {
    const file = path.join(CATALOG, `${name}.json`);
    const exists = fs.existsSync(file);
    ok(`DC1.${name}`, `catalog/${name}.json 存在`, exists, rel(file));
    if (!exists) continue;
    try {
      const read = readJson(file);
      docs[name] = read.json;
      report.files[name] = { file: rel(file), bytes: read.bytes.length, sha256: sha256(read.bytes) };
      ok(`DC2.${name}`, `catalog/${name}.json 可解析 + spec 属于 shadow.market.*`,
        typeof read.json.spec === 'string' && /^shadow\.market/i.test(read.json.spec), `spec=${read.json.spec}`);
      ok(`DC3.${name}`, `catalog/${name}.json schemaVersion === 2`, read.json.schemaVersion === 2, `schemaVersion=${read.json.schemaVersion}`);
      ok(`DC4.${name}`, `catalog/${name}.json generatedAt 可解析`, isIso(read.json.generatedAt), `generatedAt=${read.json.generatedAt}`);
    } catch (e) {
      ok(`DC2.${name}`, `catalog/${name}.json 可解析`, false, String(e && e.message));
    }
  }
  if (Object.keys(docs).length < names.length) {
    throw new Error(`catalog v2 未就绪：缺 ${names.filter((n) => !docs[n]).map((n) => n + '.json').join(', ')}（Phase 2 数据层尚未生成？）`);
  }

  const itemsOf = (name) => {
    const d = docs[name] || {};
    if (Array.isArray(d.items)) return d.items;
    const alias = { categories: ['categories'], tags: ['tags'], authors: ['authors', 'creators'], licenses: ['licenses'], resources: ['resources'] }[name] || [];
    for (const a of alias) if (Array.isArray(d[a])) return d[a];
    return [];
  };
  // 契约：每文件 `{spec,schemaVersion,generatedAt,items:[...]}`；site 的站点信息在 items[0]
  const siteItems = docs.site && Array.isArray(docs.site.items) ? docs.site.items : [];
  const site = siteItems.length
    ? (siteItems[0] || {})
    : ((docs.site && typeof docs.site.items === 'object' && docs.site.items) || docs.site || {});
  const categories = itemsOf('categories');
  const tags = itemsOf('tags');
  const authors = itemsOf('authors');
  const licenses = itemsOf('licenses');
  const resources = itemsOf('resources');
  report.counts = { resources: resources.length, categories: categories.length, tags: tags.length, authors: authors.length, licenses: licenses.length };

  ok('DC5', 'site.json 有站点名/版本信息', !!(site && (site.name || site.title || site.siteName || site.version)),
    `keys=${Object.keys(site || {}).slice(0, 10).join(',')}`);
  ok('DC6', 'categories ≥1 且 id/label 齐全', categories.length >= 1 && categories.every((c) => c.id && c.label),
    `${categories.length} → ${categories.map((c) => c.id).join(',')}`);
  ok('DC7', 'authors ≥1 且 handle/name 齐全', authors.length >= 1 && authors.every((a) => a.handle && a.name),
    `${authors.length} → ${authors.map((a) => a.handle).join(',')}`);
  ok('DC8', 'licenses ≥1 且 id/name 齐全 + 有 url 或 fullText',
    licenses.length >= 1 && licenses.every((l) => l.id && l.name && (l.url || l.fullText || l.fullTextZh)),
    `${licenses.length} → ${licenses.map((l) => l.id).join(',')}`);
  ok('DC9', 'tags ≥1 且每项含 tag（或 id/label）',
    tags.length >= 1 && tags.every((t) => t.tag || t.id || t.label), `${tags.length}`);
  ok('DC10', 'resources ≥7（5 课程 + 字幕 + 插件类）', resources.length >= 7, `count=${resources.length}`);

  const catIds = new Set(categories.map((c) => c.id));
  const authorHandles = new Set(authors.map((a) => a.handle));
  const licenseIds = new Set(licenses.map((l) => l.id));
  const tagNames = new Set();
  for (const t of tags) {
    const vals = [t.tag, t.id, t.label, t.labelEn, ...(Array.isArray(t.aliases) ? t.aliases : [])].filter(Boolean);
    for (const v of vals) tagNames.add(String(v).toLowerCase());
  }

  /* ---------- 插件清单（type 引用） ---------- */
  const idxFile = path.join(MARKET, 'plugins', 'index.json');
  ok('DC11', 'plugins/index.json 存在', fs.existsSync(idxFile), rel(idxFile));
  let idx = {};
  try { idx = readJson(idxFile).json; } catch { /* 缺文件时后续断言会失败 */ }
  const typeList = Array.isArray(idx.types) ? idx.types : Array.isArray(idx.plugins) ? idx.plugins : Array.isArray(idx) ? idx : [];
  ok('DC12', 'plugins/index.json spec/schemaVersion + types ≥3（course/subtitle/plugin）',
    idx.spec === 'shadow.market.plugins' && typeList.length >= 3, `spec=${idx.spec} types=${typeList.map((t) => (typeof t === 'string' ? t : t.id)).join(',')}`);
  const manifests = new Map();
  const manifestProblems = [];
  for (const item of typeList) {
    const id = typeof item === 'string' ? item : (item.id || item.type);
    const mfRel = typeof item === 'object' && item.manifest ? item.manifest : `plugins/${id}/manifest.json`;
    const mf = path.join(MARKET, mfRel);
    if (!fs.existsSync(mf)) { manifestProblems.push(`${id}:缺 manifest`); continue; }
    let m;
    try { m = readJson(mf).json; } catch (e) { manifestProblems.push(`${id}:manifest 不可解析`); continue; }
    manifests.set(id, m);
    const p = [];
    if (m.manifestVersion !== 1) p.push('manifestVersion!=1');
    if (m.kind !== 'resource-type') p.push('kind!=resource-type');
    if (m.id !== id) p.push('id 与注册表不一致');
    if (!m.label || !m.labelEn) p.push('缺 label/labelEn');
    if (!m.icon || /^(https?:|\/|data:)/.test(String(m.icon))) p.push('icon 必须为内置图标名且非 URL');
    if (!Array.isArray(m.fileExt) || !m.fileExt.length) p.push('fileExt 空');
    if (!Array.isArray(m.detailTabs) || !m.detailTabs.length) p.push('detailTabs 空');
    const tabs = ['readme', 'sentences', 'files', 'versions', 'license'];
    if (Array.isArray(m.detailTabs) && m.detailTabs.some((t) => !tabs.includes(t))) p.push('detailTabs 含白名单外值');
    if (!m.permissions || typeof m.permissions !== 'object') p.push('缺 permissions');
    else if (['network', 'filesystem', 'microphone'].some((k) => m.permissions[k] !== false)) p.push('permissions 必须全 false');
    if (!m.install || !m.install.mode) p.push('缺 install.mode');
    else if (!['download', 'desktop-import'].includes(m.install.mode)) p.push('install.mode 非法');
    if (typeof m.enabled !== 'boolean') p.push('enabled 非布尔');
    if (findActive(m).length) p.push('manifest 含可执行内容:' + findActive(m).slice(0, 2).join(','));
    if (p.length) manifestProblems.push(`${id}:${p.join(';')}`);
  }
  ok('DC13', '每类 manifest 字段齐全（manifestVersion/kind/id/label/labelEn/icon/fileExt/detailTabs/install/permissions 全 false/enabled）',
    manifestProblems.length === 0, manifestProblems.slice(0, 4).join(' | ') || `${manifests.size} manifests ok`);
  const usedTypes = [...new Set(resources.map((r) => r.type))];
  ok('DC14', 'catalog 使用的每种资源类型都有 manifest（一切即插件，声明式）',
    usedTypes.every((t) => manifests.has(t)) && usedTypes.length >= 3,
    `used=${usedTypes.join(',')} declared=${[...manifests.keys()].join(',')}`);

  /* ---------- B/C/D. 资源字段 + 版本 + 文件 ---------- */
  const resourceProblems = [];
  const idSeen = new Set();
  const pkgCache = new Map(); // id -> { file, bytes, size, sha, pkg, resource, version }
  for (const r of resources) {
    const p = [];
    if (!ID_RE.test(String(r.id || ''))) p.push('id 正则');
    if (idSeen.has(r.id)) p.push('id 重复'); idSeen.add(r.id);
    if (!r.type) p.push('缺 type');
    if (!r.title) p.push('缺 title');
    if (!r.description) p.push('缺 description');
    if (!catIds.has(r.category)) p.push('category 未声明:' + r.category);
    if (!authorHandles.has(r.author || r.creator)) p.push('author 未声明:' + (r.author || r.creator));
    if (!licenseIds.has(r.license)) p.push('license 未声明:' + r.license);
    if (!r.rights || typeof r.rights !== 'object') p.push('缺 rights');
    else if (!RIGHTS_BASIS.includes(r.rights.basis)) p.push('rights.basis 非法:' + r.rights.basis);
    if (r.mediaMode !== 'byom') p.push('mediaMode!=byom');
    if (!Array.isArray(r.language) || !r.language.length) p.push('language 空');
    if (r.points !== 0) p.push('points!=0（P0 全免费）');
    if (r.free !== true) p.push('free!=true');
    if (!isIso(r.createdAt)) p.push('createdAt 非 ISO');
    if (!isIso(r.updatedAt)) p.push('updatedAt 非 ISO');
    if (!Array.isArray(r.tags) || !r.tags.length) p.push('tags 空');
    if (r.mediaName != null && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(r.mediaName))) p.push('mediaName 非 ASCII 媒体名');
    if ((r.type === 'course' || r.type === 'subtitle') && !r.mediaName) p.push('course/subtitle 缺 mediaName（媒体名公示与 clip.name 对齐用）');
    const st = r.stats || {};
    if (typeof st.sentences !== 'number') p.push('stats.sentences 非数字');
    if (typeof st.durationSec !== 'number') p.push('stats.durationSec 非数字');
    if (typeof st.words !== 'number') p.push('stats.words 非数字');
    if (typeof st.sizeBytes !== 'number') p.push('stats.sizeBytes 非数字');
    if (!HEX64_RE.test(String(st.sha256 || ''))) p.push('stats.sha256 非 64hex');
    const versions = Array.isArray(r.versions) ? r.versions : [];
    if (!versions.length) p.push('versions 空');
    const v = versions[0] || {};
    if (!SEMVER_RE.test(String(v.version || ''))) p.push('versions[0].version 非 semver');
    if (!v.packageUrl) p.push('versions[0].缺 packageUrl');
    if (!HEX64_RE.test(String(v.sha256 || ''))) p.push('versions[0].sha256 非 64hex');
    if (typeof v.sizeBytes !== 'number') p.push('versions[0].sizeBytes 非数字');
    if (typeof v.downloads !== 'number' || v.downloads !== 0) p.push('versions[0].downloads!=0（不虚报）');
    if (!Array.isArray(v.changelog) || !v.changelog.length) p.push('versions[0].changelog 空');
    if (!v.compat || typeof v.compat !== 'object' || !v.compat.shadow) p.push('versions[0].compat 缺 shadow');
    if (!isIso(v.publishedAt)) p.push('versions[0].publishedAt 非 ISO');
    // 至少 1 条 history 也不得虚报 downloads
    versions.forEach((vv, i) => {
      if (!SEMVER_RE.test(String(vv.version || ''))) p.push(`versions[${i}].version 非 semver`);
      if (typeof vv.downloads !== 'number' || vv.downloads !== 0) p.push(`versions[${i}].downloads!=0`);
    });

    if (versions.length && v.packageUrl) {
      const pf = resolveMarket(v.packageUrl);
      if (!fs.existsSync(pf)) p.push('包文件不存在:' + v.packageUrl);
      else {
        const bytes = fs.readFileSync(pf);
        const size = bytes.length;
        const hash = sha256(bytes);
        if (size > 2 * 1024 * 1024) p.push('包 >2MB');
        if (v.sizeBytes !== size) p.push(`versions[0].sizeBytes(${v.sizeBytes})!=文件(${size})`);
        if (String(v.sha256).toLowerCase() !== hash) p.push(`versions[0].sha256!=文件(${hash.slice(0, 12)}…)`);
        if (st.sizeBytes !== size) p.push(`stats.sizeBytes(${st.sizeBytes})!=文件(${size})`);
        if (String(st.sha256).toLowerCase() !== hash) p.push('stats.sha256!=文件');
        let pkg = null;
        try { pkg = JSON.parse(bytes.toString('utf8')); } catch { p.push('包 JSON 不可解析'); }
        if (pkg) {
          if (r.type === 'plugin') {
            // 契约：plugin 类下载物 = 声明式白名单 JSON（spec=shadow.market.builtin-plugin-whitelist、executable:false），
            // 不是 .shadowcourse；不断言包 id/version，但要断言「不可执行」。
            if (pkg.executable !== false) p.push('plugin 下载物 executable!==false');
            if (pkg.permissions && typeof pkg.permissions === 'object') {
              const permBad = ['network', 'filesystem', 'microphone'].filter((k) => k in pkg.permissions && pkg.permissions[k] !== false);
              if (permBad.length) p.push('plugin 下载物 permissions 非全 false:' + permBad.join(','));
            }
            if (pkg.spec === 'shadow.course') p.push('plugin 下载物不应为 shadow.course 包');
            const pkgActive = findActive(pkg);
            if (pkgActive.length) p.push('plugin 下载物含可执行内容:' + pkgActive.slice(0, 2).join(','));
          } else {
            if (!ID_RE.test(String(pkg.id || ''))) p.push('包 id 非法');
            if (pkg.id !== r.id) p.push(`包 id(${pkg.id})!=catalog id`);
            if (pkg.version !== v.version) p.push(`包 version(${pkg.version})!=catalog version(${v.version})`);
            if (pkg.spec !== 'shadow.course') p.push(`包 spec=${pkg.spec}`);
          }
          pkgCache.set(r.id, { file: pf, rel: rel(pf), bytes, size, sha: hash, pkg, resource: r, version: v });
        }
      }
    }
    if (p.length) resourceProblems.push({ id: r.id, problems: p });
  }
  ok('DC15', 'resources 字段/引用/版本完整（id/type/category/author/license/rights/byom/points/free/stats/versions）',
    resourceProblems.length === 0,
    resourceProblems.length ? JSON.stringify(resourceProblems.slice(0, 3)) : `${resources.length} resources ok`);

  // tag 引用完整性（level 标签如 B1 视为合法徽标标签）
  const unknownTags = [];
  for (const r of resources) {
    for (const t of (r.tags || [])) {
      const key = String(t).toLowerCase();
      if (tagNames.has(key) || SENT_LEVEL_RE.test(key)) continue;
      unknownTags.push(`${r.id}:${t}`);
    }
  }
  ok('DC16', '资源 tags 均在 tags.json 声明（level 标签 A1–C2 例外）', unknownTags.length === 0,
    unknownTags.slice(0, 6).join(',') || `tags.json=${tagNames.size}；资源标签全部可解析`);

  // 标签索引覆盖：tags.json 里的标签应至少被 1 个资源使用（反向完整性，信息级但纳入失败会太脆 → 用 60% 覆盖)
  const usedTagKeys = new Set();
  for (const r of resources) for (const t of (r.tags || [])) usedTagKeys.add(String(t).toLowerCase());
  const orphanTags = tags.filter((t) => {
    const vals = [t.tag, t.id, t.label, t.labelEn, ...(Array.isArray(t.aliases) ? t.aliases : [])].filter(Boolean).map((v) => String(v).toLowerCase());
    return vals.length > 0 && !vals.some((v) => usedTagKeys.has(v));
  });
  ok('DC17', 'tags.json 至少 60% 标签被资源使用（避免空标签表）',
    tags.length === 0 || orphanTags.length / tags.length <= 0.4, `orphan=${orphanTags.length}/${tags.length}`);

  /* ---------- E. 包内容校验 ---------- */
  const pkgProblems = [];
  for (const [id, info] of pkgCache) {
    const { pkg, resource } = info;
    const p = [];
    const type = resource.type;
    if (type === 'course' || type === 'subtitle') {
      if (pkg.spec !== 'shadow.course') p.push(`包 spec=${pkg.spec}`);
      if (pkg.schemaVersion !== 1) p.push(`包 schemaVersion=${pkg.schemaVersion}`);
      if (pkg.mediaPolicy !== 'byom') p.push(`mediaPolicy=${pkg.mediaPolicy}`);
      if (!Array.isArray(pkg.sentences) || !pkg.sentences.length) p.push('包 sentences 空');
      else {
        let last = -Infinity;
        pkg.sentences.forEach((s, i) => {
          if (typeof s.start !== 'number' || typeof s.end !== 'number') p.push(`s${i} start/end 非数字`);
          else if (!(s.end > s.start)) p.push(`s${i} end<=start`);
          else if (s.start < last) p.push(`s${i} start 乱序`);
          else last = s.start;
          if (!String(s.text || '').trim()) p.push(`s${i} text 空`);
        });
        const computedWords = pkg.sentences.reduce((n, s) => n + String(s.text || '').trim().split(/\s+/).filter(Boolean).length, 0);
        const maxEnd = pkg.sentences.reduce((m, s) => Math.max(m, Number(s.end) || 0), 0);
        const st = resource.stats || {};
        if (st.sentences !== pkg.sentences.length) p.push(`stats.sentences(${st.sentences})!=包(${pkg.sentences.length})`);
        if (st.words !== computedWords) p.push(`stats.words(${st.words})!=计算(${computedWords})`);
        if (Math.abs(Number(st.durationSec) - maxEnd) > 0.6) p.push(`stats.durationSec(${st.durationSec})!=maxEnd(${maxEnd})`);
        // 包内 license/rights 与 catalog 一致
        if (pkg.license !== resource.license) p.push(`包 license(${pkg.license})!=catalog(${resource.license})`);
      }
      const active = findActive(pkg);
      if (active.length) p.push('包内含可执行内容:' + active.slice(0, 2).join(','));
    } else if (type === 'plugin') {
      // 插件类型下载物 = 纯声明 JSON，不得含脚本/可执行字段
      const active = findActive(pkg);
      if (active.length) p.push('插件 JSON 含可执行内容/字段:' + active.slice(0, 3).join(','));
    } else {
      // 未知类型：允许但记录（P0 白名单外需人工审核；不阻断）
      p.push(`未知资源类型 ${type}（白名单外，需人工审核）`);
    }
    if (p.length) pkgProblems.push({ id, problems: p });
  }
  ok('DC18', '包内容：course/subtitle 为 shadow.course+byom+时间轴升序+stats 一致；plugin 为纯声明 JSON',
    pkgProblems.length === 0, pkgProblems.length ? JSON.stringify(pkgProblems.slice(0, 3)) : `${pkgCache.size} packages ok`);

  /* ---------- F/G. 派生导入产物 ---------- */
  const importProblems = [];
  const importStats = [];
  for (const r of resources) {
    const v = (r.versions || [])[0] || {};
    const imp = v.importFiles || r.importFiles || {};
    const packageInfo = pkgCache.get(r.id);
    const pkg = packageInfo ? packageInfo.pkg : null;
    const required = r.type === 'course';
    const kinds = [['shadowJson', imp.shadowJson || imp.shadowJSON], ['srt', imp.srt], ['readme', imp.readme]];
    const present = kinds.filter(([, vv]) => !!vv);
    if (!present.length) {
      if (required) importProblems.push(`${r.id}:course 缺全部 importFiles`);
      continue;
    }
    for (const [kind, raw] of kinds) {
      if (!raw) { if (required) importProblems.push(`${r.id}:缺 ${kind}`); continue; }
      const fi = fileInfoOf(raw);
      if (!fi || !fi.url) { importProblems.push(`${r.id}:${kind} URL 缺失`); continue; }
      const file = resolveMarket(fi.url);
      if (!fs.existsSync(file)) { importProblems.push(`${r.id}:${kind} 文件不存在 ${fi.url}`); continue; }
      const bytes = fs.readFileSync(file);
      if (!bytes.length) importProblems.push(`${r.id}:${kind} 空文件`);
      if (bytes.length > 2 * 1024 * 1024) importProblems.push(`${r.id}:${kind} >2MB`);
      const hash = sha256(bytes);
      if (fi.sha256 && String(fi.sha256).toLowerCase() !== hash) importProblems.push(`${r.id}:${kind} sha256 与 catalog 不一致`);
      if (typeof fi.sizeBytes === 'number' && fi.sizeBytes !== bytes.length) importProblems.push(`${r.id}:${kind} sizeBytes 不一致`);
      if (kind === 'shadowJson') {
        let proj = null;
        try { proj = JSON.parse(bytes.toString('utf8')); } catch { importProblems.push(`${r.id}:shadow.json 不可解析`); }
        if (proj) {
          const clips = Array.isArray(proj.clips) ? proj.clips : [];
          if (!clips.length) importProblems.push(`${r.id}:shadow.json clips 空`);
          const ids = new Set(); const names = new Set();
          for (const [i, c] of clips.entries()) {
            if (!c.id) importProblems.push(`${r.id}:clip[${i}] 缺 id`);
            else { if (ids.has(c.id)) importProblems.push(`${r.id}:clip id 重复 ${c.id}`); ids.add(c.id); }
            if (!c.name || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(c.name)) importProblems.push(`${r.id}:clip[${i}].name 非 ASCII/含空格`);
            else { if (names.has(c.name)) importProblems.push(`${r.id}:clip name 重复 ${c.name}`); names.add(c.name); }
            if (!['video', 'audio'].includes(c.kind)) importProblems.push(`${r.id}:clip[${i}].kind 非法`);
            if (!(typeof c.duration === 'number' && c.duration > 0)) importProblems.push(`${r.id}:clip[${i}].duration<=0`);
            const ss = Array.isArray(c.sentences) ? c.sentences : [];
            if (!ss.length) importProblems.push(`${r.id}:clip[${i}].sentences 空`);
            let last = -Infinity;
            ss.forEach((s, j) => {
              if (typeof s.start !== 'number' || typeof s.end !== 'number' || !(s.end > s.start)) importProblems.push(`${r.id}:clip${i}.s${j} 时间轴非法`);
              else if (s.start < last) importProblems.push(`${r.id}:clip${i}.s${j} 乱序`); else last = s.start;
              if (!String(s.en || '').trim()) importProblems.push(`${r.id}:clip${i}.s${j} en 空`);
            });
            if (pkg && Array.isArray(pkg.sentences)) {
              const zhCount = ss.filter((s) => String(s.zh || '').trim()).length;
              const pkgZh = pkg.sentences.filter((s) => String(s.translation || '').trim()).length;
              if (pkgZh > 0 && zhCount < pkgZh) importProblems.push(`${r.id}:clip[${i}] 中文翻译缺失(${zhCount}/${pkgZh})`);
            }
          }
          // 便利字段 mediaName（课程页公示的媒体名）：.shadow.json 的 clip.name 必须逐字一致
          if (r.mediaName && clips.length && !clips.some((c) => c.name === r.mediaName)) {
            importProblems.push(`${r.id}:clip.name 与 mediaName(${r.mediaName}) 不一致`);
          }
          if (pkg && Array.isArray(pkg.sentences) && clips.length) {
            const totalSent = clips.reduce((n, c) => n + (Array.isArray(c.sentences) ? c.sentences.length : 0), 0);
            if (totalSent !== pkg.sentences.length) importProblems.push(`${r.id}:shadow.json 句数(${totalSent})!=包(${pkg.sentences.length})`);
            const maxEnd = pkg.sentences.reduce((m, s) => Math.max(m, Number(s.end) || 0), 0);
            const dur = Number(clips[0].duration);
            if (!(dur >= maxEnd && dur <= maxEnd + 10)) importProblems.push(`${r.id}:clip.duration(${dur}) 与 maxEnd(${maxEnd}) 不符`);
            // projectName 为 docs/111 §5.3「建议」字段：缺失不阻断，仅记录到报告
            if (!proj.projectName) importStats.push({ id: r.id, note: 'shadow.json 无 projectName（建议字段）' });
          }
          const abs = findAbsPath(proj);
          if (abs.length) importProblems.push(`${r.id}:shadow.json 含本地绝对路径/base64:${abs.slice(0, 3).join(',')}`);
          if (/\bwavPath\b/.test(bytes.toString('utf8'))) importProblems.push(`${r.id}:shadow.json 含 wavPath`);
        }
      }
      if (kind === 'srt') {
        const text = bytes.toString('utf8');
        const blocks = text.replace(/\r\n?/g, '\n').trim().split(/\n{2,}/);
        const cueLines = blocks.map((b) => b.split('\n').find((l) => /-->/.test(l))).filter(Boolean);
        const validCues = cueLines.filter((l) => /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/.test(l));
        if (!cueLines.length) importProblems.push(`${r.id}:srt 无 cue`);
        else if (validCues.length !== cueLines.length) importProblems.push(`${r.id}:srt 存在非法时间轴`);
        if (pkg && Array.isArray(pkg.sentences) && cueLines.length !== pkg.sentences.length) importProblems.push(`${r.id}:srt cue 数(${cueLines.length})!=包句子数(${pkg.sentences.length})`);
        importStats.push({ id: r.id, cues: cueLines.length });
      }
      if (kind === 'readme') {
        const text = bytes.toString('utf8');
        if (text.trim().length < 80) importProblems.push(`${r.id}:readme 过短(${text.trim().length}B)`);
      }
    }
  }
  ok('DC19', 'course 资源派生导入产物齐全（.shadow.json/.srt/readme）且与包一致',
    importProblems.filter((x) => /缺|不存在|不可解析|空/.test(x)).length === 0,
    importProblems.slice(0, 5).join(' | ') || `import files ok（${resources.filter((r) => r.type === 'course').length} 门课程）`);
  ok('DC20', '.shadow.json 工程 lint（clips/name ASCII/时长/句子/无绝对路径/wavPath/base64）+ SRT 可解析',
    importProblems.length === 0, importProblems.slice(0, 6).join(' | ') || `${importStats.length} srt files ok`);

  /* ---------- H. 汇总 ---------- */
  report.summary = {
    total: checks.length,
    passed: checks.filter((c) => c.pass).length,
    failed: checks.filter((c) => !c.pass).length,
    resources: resources.length,
    packages: pkgCache.size,
    categories: categories.length,
    tags: tags.length,
    authors: authors.length,
    licenses: licenses.length,
    manifests: manifests.size,
    importFiles: resources.reduce((n, r) => {
      const imp = ((r.versions || [])[0] || {}).importFiles || {};
      return n + ['shadowJson', 'srt', 'readme'].filter((k) => imp[k]).length;
    }, 0),
  };
  report.pass = report.summary.failed === 0;
} catch (e) {
  fatal = String(e && (e.stack || e.message || e));
  report.fatal = fatal;
  console.error('[data-contract] FATAL: ' + fatal);
}

report.finishedAt = new Date().toISOString();
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
const sum = report.summary;
console.log(`\n[data-contract] ${sum ? `${sum.passed}/${sum.total} PASS` : `0/${checks.length} PASS（数据未就绪）`} -> ${REPORT}`);
process.exit(report.pass ? 0 : (fatal && !sum ? 2 : 1));
