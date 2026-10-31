#!/usr/bin/env node
/**
 * tools/shadowcourse/build-packages.mjs
 * SHADOW 包构建器（P0 Phase 2）：从内容源 + 包源描述生成
 *   - market/data/packages/<id>.shadowcourse  （docs/53 单文件 JSON；course / subtitle 共用同一容器，类型由市场 catalog 标注）
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
 *   kind="lesson" → 读取 content/lessons/<name>.json 或 content/subtitles/<name>.json（真实句子时间轴）
 *   kind="inline" → 源描述内直接给出 sentences（原创演示包，时间轴自洽）
 *
 * 说明：本脚本只产包；市场目录 catalog v2 由 tools/catalog/build-catalog.mjs 生成。
 * 写盘前先做全量内存校验（含体积 / 纯数据 / 时间轴），写盘后再回读校验；任一失败退出码 1。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { computeStats, validatePackage, validateText } from './validate.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_SOURCES = path.join(SCRIPT_DIR, 'sources', 'courses.json');
const DEFAULT_OUT = path.join(REPO_ROOT, 'market', 'data');
const PACKAGES_REL = 'packages';

const USAGE = `SHADOW 包构建器（.shadowcourse · course + subtitle）· 契约 docs/53 + docs/111 §5.1

用法：
  node tools/shadowcourse/build-packages.mjs [选项]

选项：
  --out <dir>       输出目录（默认 market/data；包写入 <out>/packages/）
  --sources <file>  包源描述 JSON（默认 tools/shadowcourse/sources/courses.json）
  --now <ISO8601>   固定生成时间（便于可复现构建，默认当前 UTC 时间）
  --json            stdout 只输出机器可读 JSON 摘要
  --help            显示帮助

产物：
  market/data/packages/<id>.shadowcourse（5 个课程包 + 1 个字幕包，全部 BYOM 纯数据、≤2 MiB）
  catalog v2 由 node tools/catalog/build-catalog.mjs 生成（本脚本不再写 catalog.json）。`;

export const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

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

function timestamp(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} 时间格式非法：${JSON.stringify(value)}`);
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

// ---------------------------------------------------------------------------
// 句子转换
// ---------------------------------------------------------------------------

/** content/lessons 与 content/subtitles 的教学提示 → 包内 notes */
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
  if (typeof sentence.notes === 'string' && sentence.notes.trim()) {
    parts.push(sentence.notes.trim());
  }
  return parts.join('\n');
}

/** lesson.sentences / subtitles.sentences → 包内 sentences（保留 text/translation/start/end 与教学提示） */
function sentencesFromLesson(lesson, packageId) {
  if (!Array.isArray(lesson.sentences) || lesson.sentences.length === 0) {
    throw new Error(`内容源 ${packageId} 的 sentences 为空，无法打包`);
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
// README / 包构建
// ---------------------------------------------------------------------------

const BYOM_SECTION = `## 如何使用（BYOM · 自带媒体）

本资源包是**纯数据包，不含任何音频 / 视频文件**。导入 SHADOW Studio 后：

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

function buildPackageReadme({ packageId, version, createdAt, updatedAt, title, subtitle, description, audience, expressions, categoryLabel, sentences, readmeNote, kindLabel }) {
  const stats = computeStats(sentences);
  const kind = kindLabel || '课程';
  const blocks = [];
  blocks.push(`# ${title}`);
  blocks.push(`> ${subtitle} · 由 SHADOW Studio 发布 · 许可 CC-BY-4.0`);
  blocks.push(`## ${kind}介绍`);
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
      '- 媒体：BYOM，包内不含音频 / 视频（media[].duration = 0 表示未知）',
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
      '- 格式：`.shadowcourse` 单文件 JSON（`schemaVersion: 1`）',
      '- 校验：`node tools/shadowcourse/validate.mjs <file>`',
    ].join('\n'),
  );
  return `${blocks.join('\n\n')}\n`;
}

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
  const isInline = source.kind === 'inline';
  if (!isLesson && !isInline) throw new Error(`源描述 ${packageId} 的 kind 必须是 lesson / inline，实际为 ${JSON.stringify(source.kind)}`);

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
        duration: 0, // BYOM：用户自备媒体，时长未知填 0（docs/53 示例）
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
      kindLabel: source.kindLabel,
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
// 主流程
// ---------------------------------------------------------------------------

/**
 * 构建全部包（不写 catalog）。失败抛错；成功返回摘要。
 * @param {{ outDir: string, sourcesFile: string, nowArg: string|null, json?: boolean, quiet?: boolean }} options
 */
export function build({ outDir, sourcesFile, nowArg, json = false, quiet = false }) {
  const sources = readJson(sourcesFile, '包源描述');
  if (sources.spec !== 'shadow.market.sources') throw new Error('包源描述 spec 必须为 "shadow.market.sources"');
  if (!Array.isArray(sources.courses) || sources.courses.length === 0) throw new Error('包源描述 courses 为空');
  if (!Array.isArray(sources.categories) || sources.categories.length === 0) throw new Error('包源描述 categories 为空');
  if (!sources.creator || !sources.creator.handle) throw new Error('包源描述 creator 缺失');

  const now = nowArg ? timestamp(nowArg, '--now') : new Date().toISOString();
  const requested = sources.courses.length;

  // 1. 构建 + 内存校验（失败 → 不写任何文件）
  const built = sources.courses.map((source) => {
    const category = sources.categories.find((item) => item.id === source.category);
    const categoryLabel = category ? `${category.label}（${category.labelEn}）` : source.category;
    const lesson = source.kind === 'lesson' ? readJson(path.resolve(REPO_ROOT, source.lesson), `内容源 ${source.lesson}`) : null;
    return makePackage({ source, lesson, categoryLabel, now });
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

  // 3. 保留提示：目录内已有但本次未生成的文件（不删除，只提示）
  const generatedNames = new Set(written.map((item) => path.basename(item.relativeFile)));
  const leftover = fs
    .readdirSync(packagesDir)
    .filter((name) => name.endsWith('.shadowcourse') && !generatedNames.has(name));

  const summary = {
    ok: true,
    generatedAt: now,
    outDir,
    sourcesFile,
    requested,
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
    leftover,
    totalSentences: written.reduce((sum, item) => sum + item.stats.sentences, 0),
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else if (!quiet) {
    console.log('SHADOW 包构建器（.shadowcourse · course + subtitle）· 契约 docs/53 + docs/111 §5.1');
    console.log(`源描述：${rel(sourcesFile)}`);
    console.log(`输出目录：${outDir}`);
    console.log(`生成时间：${now}`);
    console.log('');
    for (const item of written) {
      console.log(`  [${item.ordinal}/${written.length}] ${item.id}`);
      console.log(
        `        ${item.relativeFile} · ${formatBytes(item.bytes)} · ${item.stats.sentences} 句 · ${item.stats.durationSec}s · ${item.stats.words} 词 · PASS${item.warnings.length > 0 ? `（${item.warnings.length} warning）` : ''}`,
      );
    }
    if (leftover.length > 0) {
      console.log('');
      console.log(`  提示：${packagesDir} 下另有 ${leftover.length} 个非本次生成的 .shadowcourse（已保留）：${leftover.join('、')}`);
    }
    console.log('');
    console.log(`  句子合计：${summary.totalSentences} 句`);
    console.log('校验命令：node tools/shadowcourse/validate.mjs --dir market/data/packages');
    console.log(`完成：${written.length} 包 / 0 error ✅`);
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

if (isMain) main();
