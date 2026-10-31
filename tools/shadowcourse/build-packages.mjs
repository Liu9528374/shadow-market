#!/usr/bin/env node
/**
 * tools/shadowcourse/build-packages.mjs
 * SHADOW 课程包 P0 打包器：从内容源 + 市场源描述生成
 *   - market/data/packages/<id>.shadowcourse  （docs/52 §2 单文件 JSON）
 *   - market/data/catalog.json                （docs/52 §3.2 市场目录）
 *
 * 纯 Node（>=18）ESM，无第三方依赖。
 *
 * 用法：
 *   node tools/shadowcourse/build-packages.mjs
 *   node tools/shadowcourse/build-packages.mjs --out market/data
 *   node tools/shadowcourse/build-packages.mjs --sources tools/shadowcourse/sources/courses.json
 *   node tools/shadowcourse/build-packages.mjs --now 2026-10-25T15:00:00Z --json
 *
 * 源描述：tools/shadowcourse/sources/courses.json
 *   kind="lesson" → 读取 content/lessons/<name>.json（已有真实句子时间轴）
 *   kind="inline" → 源描述内直接给出 sentences（原创演示包，时间轴自洽）
 *
 * 生成后会用 validate.mjs 再校验一遍（内存 + 回读落盘文件），全部 PASS 才退出 0。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeStats, validatePackage, validateText } from './validate.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_SOURCES = path.join(SCRIPT_DIR, 'sources', 'courses.json');
const DEFAULT_OUT = path.join(REPO_ROOT, 'market', 'data');
const PACKAGES_REL = 'packages';

const USAGE = `SHADOW 课程包 P0 打包器（.shadowcourse + catalog.json）· 契约 docs/52 §2/§3.2

用法：
  node tools/shadowcourse/build-packages.mjs [选项]

选项：
  --out <dir>       输出目录（默认 market/data；包写入 <out>/packages/，目录写入 <out>/catalog.json）
  --sources <file>  市场源描述 JSON（默认 tools/shadowcourse/sources/courses.json）
  --now <ISO8601>   固定生成时间（便于可复现构建，默认当前 UTC 时间）
  --json            stdout 只输出机器可读 JSON 摘要
  --help            显示帮助

产物：
  market/data/packages/com.shadow.course.<slug>.shadowcourse × 5（3 个真实课程 + 2 个 BYOM 演示）
  market/data/catalog.json（categories / creators / resources；stats 从句子真实计算）`;

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function parseCli(argv) {
  const opts = {
    out: DEFAULT_OUT,
    sources: DEFAULT_SOURCES,
    now: null,
    json: false,
    help: false,
    error: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--out' || arg === '--sources' || arg === '--now') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        opts.error = `${arg} 需要一个参数`;
        break;
      }
      if (arg === '--out') opts.out = path.resolve(process.cwd(), value);
      if (arg === '--sources') opts.sources = path.resolve(process.cwd(), value);
      if (arg === '--now') opts.now = value;
      index += 1;
    } else if (arg.startsWith('--out=')) {
      opts.out = path.resolve(process.cwd(), arg.slice('--out='.length));
    } else if (arg.startsWith('--sources=')) {
      opts.sources = path.resolve(process.cwd(), arg.slice('--sources='.length));
    } else if (arg.startsWith('--now=')) {
      opts.now = arg.slice('--now='.length);
    } else {
      opts.error = `未知参数：${arg}`;
      break;
    }
  }
  return opts;
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

function textBytes(text) {
  return Buffer.byteLength(text, 'utf8');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function timestamp(value, fallbackLabel) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${fallbackLabel} 时间格式非法：${JSON.stringify(value)}`);
  return new Date(parsed).toISOString();
}

function pad4(index) {
  return String(index).padStart(4, '0');
}

function escapeCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

function uniqueStrings(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      output.push(item);
    }
  }
  return output;
}

// ---------------------------------------------------------------------------
// 句子转换
// ---------------------------------------------------------------------------

/** content/lessons 的 stress/linking/tip → 包内 notes（教学提示） */
function notesFromLessonSentence(sentence) {
  const parts = [];
  if (Array.isArray(sentence.stress) && sentence.stress.length > 0) {
    parts.push(`重音：${sentence.stress.join(' · ')}`);
  }
  if (Array.isArray(sentence.linking) && sentence.linking.length > 0) {
    parts.push(`连读：${sentence.linking.join('；')}`);
  }
  if (typeof sentence.tip === 'string' && sentence.tip.trim()) {
    parts.push(`提示：${sentence.tip.trim()}`);
  }
  return parts.join('\n');
}

/** lesson.sentences → 包内 sentences（保留 text/translation/start/end；教学提示进 notes） */
function sentencesFromLesson(lesson, packageId) {
  if (!Array.isArray(lesson.sentences) || lesson.sentences.length === 0) {
    throw new Error(`课程 ${packageId} 的 lesson.sentences 为空，无法打包`);
  }
  return lesson.sentences.map((sentence, index) => ({
    sentenceId: `s_${pad4(index + 1)}`,
    start: sentence.start,
    end: sentence.end,
    text: sentence.text,
    translation: sentence.translation || '',
    notes: notesFromLessonSentence(sentence),
  }));
}

/** 源描述内联 sentences → 包内 sentences */
function sentencesFromInline(source) {
  if (!Array.isArray(source.sentences) || source.sentences.length === 0) {
    throw new Error(`演示包 ${source.packageId} 缺少 sentences`);
  }
  return source.sentences.map((sentence, index) => ({
    sentenceId: sentence.sentenceId || `s_${pad4(index + 1)}`,
    start: sentence.start,
    end: sentence.end,
    text: sentence.text,
    translation: sentence.translation || '',
    notes: sentence.notes || '',
  }));
}

// ---------------------------------------------------------------------------
// README / 目录摘要
// ---------------------------------------------------------------------------

const BYOM_SECTION = `## 如何使用（BYOM · 自带媒体）

本课程包是**纯数据包，不含任何音频 / 视频文件**。导入 SHADOW Studio 后：

1. 把 \`.shadowcourse\` 拖入 SHADOW Studio 窗口（或在市场详情页点「一键导入」）；
2. 按提示选择**你本地**的英语音频 / 视频作为练习媒体；
3. 句子时间轴已随包提供，导入**不跑 ASR**，直接开始跟读；
4. 暂时没有合适媒体时，可用「仅文本模式」查看句子、翻译与时间轴。

> **BYOM（Bring Your Own Media）**：市场不托管影视媒体、不上传用户媒体。媒体版权由使用者自行负责；本包不含任何第三方影视 / 音乐素材。`;

const LICENSE_SECTION = `## 授权与素材说明

- 包内文本、翻译、句级时间轴：由 SHADOW Studio 创作，许可 **CC-BY-4.0**。
- 包内**不含媒体**；媒体由用户自备（BYOM），其版权与授权由用户自行负责。
- 本包不包含任何第三方影视作品台词、画面或音频。
- 权利依据：\`rights.basis = own\`。如需商用或再分发，请遵循 CC-BY-4.0 并署名 SHADOW Studio。`;

function sentencePreviewTable(sentences) {
  const lines = ['| # | 时间（秒） | 英文 | 中文 |', '|---|---|---|---|'];
  sentences.forEach((sentence, index) => {
    const time = `${sentence.start}–${sentence.end}`;
    lines.push(`| ${index + 1} | ${time} | ${escapeCell(sentence.text)} | ${escapeCell(sentence.translation) || '—'} |`);
  });
  return lines.join('\n');
}

function buildPackageReadme({ packageId, version, createdAt, updatedAt, title, subtitle, description, audience, expressions, categoryLabel, sentences, readmeNote }) {
  const stats = computeStats(sentences);
  const blocks = [];
  blocks.push(`# ${title}`);
  blocks.push(`> ${subtitle} · 由 SHADOW Studio 发布 · 许可 CC-BY-4.0`);
  blocks.push('## 课程介绍');
  blocks.push(description);
  if (audience) blocks.push(`**适合人群**：${audience}`);
  if (Array.isArray(expressions) && expressions.length > 0) {
    blocks.push('## 你会练到');
    blocks.push(expressions.map((expr) => `- \`${expr}\``).join('\n'));
  }
  if (readmeNote) {
    blocks.push('## 演示说明');
    blocks.push(readmeNote);
  }
  blocks.push('## 内容结构');
  blocks.push(
    [
      `- 句子数量：**${stats.sentences} 句**`,
      `- 时间轴：第 1 句 ${sentences[0]?.start ?? 0}s → 最后一句 ${sentences[sentences.length - 1]?.end ?? 0}s（时长约 **${stats.durationSec} 秒**）`,
      `- 英文词数：约 **${stats.words} 词**`,
      '- 每句包含：英文原文、中文翻译、教学提示（重音 / 连读 / 发音要点）',
      '- 词级时间：本包未提供（评分退化为整句参考）',
      `- 媒体：BYOM，包内不含音频 / 视频（media[].duration = 0 表示未知）`,
      `- 分类：${categoryLabel}`,
    ].join('\n'),
  );
  blocks.push('## 逐句预览');
  blocks.push(sentencePreviewTable(sentences));
  blocks.push(BYOM_SECTION);
  blocks.push(LICENSE_SECTION);
  blocks.push('## 版本');
  blocks.push(
    [
      `- 包 id：\`${packageId}\``,
      `- 版本：\`${version}\`（创建 ${createdAt}，更新 ${updatedAt}）`,
      '- 格式：`.shadowcourse` P0 单文件 JSON（`schemaVersion: 1`）',
      '- 校验：`node tools/shadowcourse/validate.mjs <file>`',
    ].join('\n'),
  );
  return `${blocks.join('\n\n')}\n`;
}

function buildCatalogReadme({ title, description, audience, level, categoryLabel, stats, readmeNote }) {
  const lines = [];
  lines.push(`## ${title}`);
  lines.push('');
  lines.push(description);
  lines.push('');
  if (audience) lines.push(`**适合人群**：${audience}`);
  lines.push('');
  lines.push(
    [
      `- **${stats.sentences} 句** · 时长约 **${stats.durationSec} 秒** · 难度 ${level} · 分类「${categoryLabel}」`,
      '- 许可 **CC-BY-4.0** · **BYOM 纯数据包（不含媒体）** · 导入免 ASR',
      '- 逐句英文原文 / 中文翻译 / 教学提示齐备',
    ].join('\n'),
  );
  if (readmeNote) {
    lines.push('');
    lines.push(`> ${readmeNote.replace(/\*\*/g, '**')}`);
  }
  lines.push('');
  lines.push('> 完整 README、逐句时间轴与包元数据在 `.shadowcourse` 包内；请在详情页「下载」或「一键导入」。');
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// 包构建
// ---------------------------------------------------------------------------

const DEFAULT_EXERCISES = {
  spec: 'shadow.exercises',
  schemaVersion: 1,
  default: {
    mode: 'shadow',
    loopCount: 3,
    speed: 1.0,
    scoring: { enabled: true },
    subtitle: { en: true, zh: true, position: 'bottom' },
  },
};

function makePackage({ source, lesson, categoryLabel, now }) {
  const packageId = source.packageId;
  if (typeof packageId !== 'string' || !packageId) throw new Error('源描述缺少 packageId');

  const isLesson = source.kind === 'lesson';
  const title = isLesson ? lesson.title : source.title;
  const subtitle = isLesson ? `${lesson.title_en} · ${lesson.level}` : source.subtitle;
  const level = isLesson ? lesson.level : source.level;
  const language = source.language || (isLesson && Array.isArray(lesson.language) ? lesson.language : ['en', 'zh']);
  const cover = (isLesson ? lesson.cover : source.cover) || ['#1B4D3E', '#2EE6A8'];
  const expressions = source.expressions || (isLesson && Array.isArray(lesson.expressions) ? lesson.expressions : []);
  const sentences = isLesson ? sentencesFromLesson(lesson, packageId) : sentencesFromInline(source);
  const createdAt = timestamp(source.createdAt || '2026-10-25T00:00:00Z', `${packageId}.createdAt`);
  const version = source.version || '1.0.0';

  const pkg = {
    spec: 'shadow.course',
    schemaVersion: 1,
    id: packageId,
    version,
    title,
    subtitle,
    description: source.description,
    category: source.category,
    tags: Array.isArray(source.tags) ? source.tags : [],
    level,
    language,
    creator: { name: 'SHADOW Studio', url: '', handle: 'shadow-studio' },
    license: 'CC-BY-4.0',
    rights: {
      basis: 'own',
      evidenceUrl: '',
      note: '文本、翻译与句级时间轴由 SHADOW Studio 创作；媒体由用户自备（BYOM），包内不含媒体。',
    },
    mediaPolicy: 'byom',
    media: [
      {
        id: 'm1',
        kind: source.mediaKind || 'audio',
        duration: 0, // BYOM：用户自备媒体，时长未知填 0（docs/52 §2 示例）
        hint: source.mediaHint || '任意英语音频 / 视频；句级时间轴按秒对齐',
      },
    ],
    sentences,
    exercises: source.exercises || DEFAULT_EXERCISES,
    requires: { shadow: source.requiresShadow || '>=0.7.0' },
    createdAt,
    updatedAt: now,
    readme: buildPackageReadme({
      packageId,
      version,
      createdAt,
      updatedAt: now,
      title,
      subtitle,
      description: source.description,
      audience: source.audience,
      expressions,
      categoryLabel,
      sentences,
      readmeNote: source.readmeNote,
    }),
  };

  return {
    source,
    package: pkg,
    cover: [cover[0] || '#1B4D3E', cover[1] || '#2EE6A8'],
    stats: computeStats(pkg.sentences),
  };
}

// ---------------------------------------------------------------------------
// catalog.json（docs/52 §3.2）
// ---------------------------------------------------------------------------

function buildCatalog(sources, built, generatedAt) {
  const usedCategoryIds = uniqueStrings(built.map((item) => item.package.category));
  const categories = [];
  for (const category of sources.categories) {
    const count = built.filter((item) => item.package.category === category.id).length;
    if (count > 0) categories.push({ id: category.id, label: category.label, labelEn: category.labelEn, count });
  }
  const unknownCategory = usedCategoryIds.find((id) => !sources.categories.some((category) => category.id === id));
  if (unknownCategory) throw new Error(`课程分类 "${unknownCategory}" 未在 sources.categories 中登记`);

  const creators = [sources.creator];
  const resources = built.map(({ package: pkg, stats, cover }) => {
    const category = sources.categories.find((item) => item.id === pkg.category);
    return {
      id: pkg.id,
      type: 'course',
      title: pkg.title,
      subtitle: pkg.subtitle,
      description: pkg.description,
      category: pkg.category,
      level: pkg.level,
      tags: pkg.tags,
      creator: pkg.creator.handle,
      license: pkg.license,
      version: pkg.version,
      points: 0,
      free: true,
      updatedAt: generatedAt,
      downloads: 0,
      stats: {
        sentences: stats.sentences,
        durationSec: stats.durationSec,
        words: stats.words,
      },
      cover: { color1: cover[0], color2: cover[1] },
      packageUrl: `data/${PACKAGES_REL}/${pkg.id}.shadowcourse`,
      readme: buildCatalogReadme({
        title: pkg.title,
        description: pkg.description,
        audience: built.find((item) => item.package.id === pkg.id)?.source.audience,
        level: pkg.level,
        categoryLabel: category ? `${category.label}（${category.labelEn}）` : pkg.category,
        stats,
        readmeNote: built.find((item) => item.package.id === pkg.id)?.source.readmeNote,
      }),
    };
  });

  const catalog = {
    spec: 'shadow.market.catalog',
    schemaVersion: 1,
    generatedAt,
    site: sources.site,
    categories,
    creators,
    resources,
  };
  validateCatalog(catalog, built);
  return catalog;
}

/** 打包器内部断言：catalog 必须符合 docs/52 §3.2，且 stats 与包内真实句子一致 */
function validateCatalog(catalog, built) {
  const problems = [];
  const requireField = (condition, message) => {
    if (!condition) problems.push(message);
  };
  requireField(catalog.spec === 'shadow.market.catalog', 'catalog.spec 必须为 "shadow.market.catalog"');
  requireField(catalog.schemaVersion === 1, 'catalog.schemaVersion 必须为 1');
  requireField(!Number.isNaN(Date.parse(catalog.generatedAt)), 'catalog.generatedAt 必须是 ISO8601');
  requireField(catalog.site && typeof catalog.site.name === 'string', 'catalog.site.name 缺失');
  requireField(Array.isArray(catalog.categories) && catalog.categories.length > 0, 'catalog.categories 不能为空');
  requireField(Array.isArray(catalog.creators) && catalog.creators.length > 0, 'catalog.creators 不能为空');
  requireField(Array.isArray(catalog.resources) && catalog.resources.length === built.length, 'catalog.resources 数量与包数量不一致');

  const categoryIds = new Set();
  for (const category of catalog.categories) {
    requireField(typeof category.id === 'string' && category.id, `catalog.categories 存在非法 id`);
    requireField(typeof category.label === 'string' && category.label, `category ${category.id} 缺 label`);
    requireField(typeof category.labelEn === 'string' && category.labelEn, `category ${category.id} 缺 labelEn`);
    requireField(Number.isInteger(category.count) && category.count > 0, `category ${category.id} count 非法`);
    if (!categoryIds.has(category.id)) categoryIds.add(category.id); else problems.push(`category ${category.id} 重复`);
  }
  const creatorHandles = new Set(catalog.creators.map((creator) => creator.handle));
  const counts = new Map();
  for (const resource of catalog.resources) counts.set(resource.category, (counts.get(resource.category) || 0) + 1);
  for (const category of catalog.categories) {
    if ((counts.get(category.id) || 0) !== category.count) problems.push(`category ${category.id} count 与资源数不一致`);
  }

  const seenIds = new Set();
  for (const [index, resource] of catalog.resources.entries()) {
    const builtItem = built[index];
    const expectedStats = builtItem.stats;
    const at = `resources[${index}]`;
    requireField(typeof resource.id === 'string' && resource.id, `${at}.id 缺失`);
    if (seenIds.has(resource.id)) problems.push(`${at}.id 重复：${resource.id}`);
    else seenIds.add(resource.id);
    requireField(resource.type === 'course', `${at}.type 必须为 "course"`);
    requireField(typeof resource.title === 'string' && resource.title, `${at}.title 缺失`);
    requireField(typeof resource.description === 'string' && resource.description, `${at}.description 缺失`);
    requireField(categoryIds.has(resource.category), `${at}.category ${resource.category} 不在 categories 中`);
    requireField(creatorHandles.has(resource.creator), `${at}.creator ${resource.creator} 不在 creators 中`);
    requireField(resource.points === 0, `${at}.points 必须为 0（P0 全免费）`);
    requireField(resource.free === true, `${at}.free 必须为 true（P0 全免费）`);
    requireField(resource.downloads === 0, `${at}.downloads 必须为 0（示例数据不虚构）`);
    requireField(!Number.isNaN(Date.parse(resource.updatedAt)), `${at}.updatedAt 必须是 ISO8601`);
    requireField(
      resource.packageUrl === `data/${PACKAGES_REL}/${resource.id}.shadowcourse`,
      `${at}.packageUrl 必须为相对路径 data/${PACKAGES_REL}/<id>.shadowcourse`,
    );
    requireField(Number.isInteger(resource.stats?.sentences) && resource.stats.sentences === expectedStats.sentences, `${at}.stats.sentences 与包内真实句子数不一致`);
    requireField(resource.stats?.durationSec === expectedStats.durationSec, `${at}.stats.durationSec 与包内真实时长不一致`);
    requireField(Number.isInteger(resource.stats?.words) && resource.stats.words === expectedStats.words, `${at}.stats.words 与包内真实词数不一致`);
    requireField(typeof resource.readme === 'string' && resource.readme.length > 0, `${at}.readme 缺失`);
    requireField(typeof resource.subtitle === 'string' && resource.subtitle, `${at}.subtitle 缺失`);
    requireField(Array.isArray(resource.tags) && resource.tags.length > 0, `${at}.tags 缺失`);
    requireField(resource.cover?.color1 && resource.cover?.color2, `${at}.cover 缺失`);
    if (resource.readme.length > 2000) problems.push(`${at}.readme 摘要超过 2000 字符（catalog 只放摘要）`);
  }

  if (problems.length > 0) {
    throw new Error(`catalog 契约校验失败：\n- ${problems.join('\n- ')}`);
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function build({ outDir, sourcesFile, nowArg, json }) {
  const sources = readJson(sourcesFile, '市场源描述');
  if (sources.spec !== 'shadow.market.sources') throw new Error('源描述 spec 必须为 "shadow.market.sources"');
  if (!Array.isArray(sources.courses) || sources.courses.length === 0) throw new Error('源描述 courses 为空');
  if (!Array.isArray(sources.categories) || sources.categories.length === 0) throw new Error('源描述 categories 为空');
  if (!sources.creator || !sources.creator.handle) throw new Error('源描述 creator 缺失');

  const now = nowArg ? timestamp(nowArg, '--now') : new Date().toISOString();
  const requested = sources.courses.length;

  // 1. 构建 + 内存校验
  const built = sources.courses.map((source, index) => {
    if (source.kind === 'lesson') {
      const lessonFile = path.resolve(REPO_ROOT, source.lesson);
      const lesson = readJson(lessonFile, `lesson ${source.lesson}`);
      const category = sources.categories.find((item) => item.id === source.category);
      const categoryLabel = category ? `${category.label}（${category.labelEn}）` : source.category;
      return makePackage({ source, lesson, categoryLabel, now });
    }
    const category = sources.categories.find((item) => item.id === source.category);
    const categoryLabel = category ? `${category.label}（${category.labelEn}）` : source.category;
    return makePackage({ source, lesson: null, categoryLabel, now });
  });

  const validationIssues = [];
  for (const item of built) {
    const result = validatePackage(item.package, { sizeBytes: textBytes(JSON.stringify(item.package, null, 2) + '\n') });
    if (!result.ok) validationIssues.push({ id: item.package.id, errors: result.errors });
    item.validation = result;
  }
  if (validationIssues.length > 0) {
    throw new Error(
      `生成的包未通过校验：\n${validationIssues
        .map((issue) => `- ${issue.id}: ${issue.errors.map((error) => `[${error.code}] ${error.path} ${error.message}`).join('；')}`)
        .join('\n')}`,
    );
  }

  // 2. 写包文件 + 回读校验
  const packagesDir = path.join(outDir, PACKAGES_REL);
  fs.mkdirSync(packagesDir, { recursive: true });
  const written = [];
  for (const [index, item] of built.entries()) {
    const text = `${JSON.stringify(item.package, null, 2)}\n`;
    const file = path.join(packagesDir, `${item.package.id}.shadowcourse`);
    writeText(file, text);
    const size = fs.statSync(file).size;
    const reread = validateText(fs.readFileSync(file, 'utf8'), { sizeBytes: size, source: file });
    if (!reread.ok) {
      throw new Error(
        `落盘包 ${rel(file)} 回读校验失败：${reread.errors.map((error) => `[${error.code}] ${error.path} ${error.message}`).join('；')}`,
      );
    }
    written.push({
      file,
      relativeFile: rel(file),
      id: item.package.id,
      title: item.package.title,
      bytes: size,
      stats: item.stats,
      warnings: reread.warnings,
      ordinal: index + 1,
    });
  }

  // 3. catalog
  const catalog = buildCatalog(sources, built, now);
  const catalogFile = path.join(outDir, 'catalog.json');
  writeText(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`);
  const catalogSize = fs.statSync(catalogFile).size;

  // 4. 保留提示：目录内已有但本次未生成的文件（不删除，只提示）
  const generatedNames = new Set(written.map((item) => path.basename(item.relativeFile)));
  const leftover = fs
    .readdirSync(packagesDir)
    .filter((name) => name.endsWith('.shadowcourse') && !generatedNames.has(name));

  const summary = {
    ok: true,
    generatedAt: now,
    outDir,
    sourcesFile,
    packages: written.map((item) => ({
      ordinal: item.ordinal,
      id: item.id,
      title: item.title,
      file: item.relativeFile,
      bytes: item.bytes,
      sentences: item.stats.sentences,
      durationSec: item.stats.durationSec,
      words: item.stats.words,
      validation: 'PASS',
      warnings: item.warnings.length,
    })),
    catalog: {
      file: rel(catalogFile),
      bytes: catalogSize,
      resources: catalog.resources.length,
      categories: catalog.categories.map((category) => ({ id: category.id, label: category.label, count: category.count })),
      creators: catalog.creators.length,
      totalSentences: catalog.resources.reduce((sum, resource) => sum + resource.stats.sentences, 0),
    },
    leftover,
    requested,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    console.log('SHADOW 课程包 P0 打包器（契约 docs/52 §2 / §3.2）');
    console.log(`源描述：${rel(sourcesFile)}`);
    console.log(`输出目录：${outDir}`);
    console.log(`生成时间：${now}`);
    console.log('');
    for (const item of written) {
      console.log(
        `  [${item.ordinal}/${written.length}] ${item.id}`,
      );
      console.log(
        `        ${item.relativeFile} · ${formatBytes(item.bytes)} · ${item.stats.sentences} 句 · ${item.stats.durationSec}s · ${item.stats.words} 词 · PASS${item.warnings.length > 0 ? `（${item.warnings.length} warning）` : ''}`,
      );
    }
    console.log('');
    console.log(
      `  catalog：${rel(catalogFile)} · ${formatBytes(catalogSize)} · ${catalog.resources.length} 个资源 · ${catalog.categories.length} 个分类 · ${catalog.creators.length} 个创作者`,
    );
    console.log(
      `  分类：${catalog.categories.map((category) => `${category.id}(${category.count})`).join('、')}`,
    );
    console.log(`  句子合计：${summary.catalog.totalSentences} 句`);
    if (leftover.length > 0) {
      console.log('');
      console.log(`  提示：${packagesDir} 下另有 ${leftover.length} 个非本次生成的 .shadowcourse（已保留）：${leftover.join('、')}`);
    }
    console.log('');
    console.log('校验命令：node tools/shadowcourse/validate.mjs --dir market/data/packages');
    console.log(`完成：${written.length} 包 / ${catalog.resources.length} 资源 / 0 error ✅`);
  }

  return summary;
}

function main() {
  const opts = parseCli(process.argv.slice(2));
  if (opts.error) {
    console.error(`[shadowcourse] ${opts.error}`);
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
    build({ outDir: opts.out, sourcesFile: opts.sources, nowArg: opts.now, json: opts.json });
    process.exitCode = 0;
  } catch (error) {
    console.error(`[shadowcourse] 打包失败：${error && error.message ? error.message : error}`);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: String(error && error.message ? error.message : error) }, null, 2)}\n`);
    }
    process.exitCode = 1;
  }
}

main();
