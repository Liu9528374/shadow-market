#!/usr/bin/env node
/**
 * tools/import/build-shadow-json.mjs
 * SHADOW 派生导入产物构建器（docs/111 §5.2 / §5.3）：
 *   .shadowcourse  →  market/data/import/<id>.shadow.json  （r19 工程 JSON，唯一带中文翻译的主路径）
 *                  →  market/data/import/<id>.srt          （备选：句级 SRT，无翻译）
 *                  →  market/data/import/README-<id>.txt   （5 步 + 3 个坑，逐字可复制）
 *
 * 纯 Node（>=18）ESM，无第三方依赖。
 *
 * 用法：
 *   node tools/import/build-shadow-json.mjs
 *   node tools/import/build-shadow-json.mjs --packages market/data/packages --out market/data/import
 *   node tools/import/build-shadow-json.mjs --now 2026-10-31T15:30:00Z --json
 *   node tools/import/build-shadow-json.mjs --check      # 只校验已生成产物（lint），不写盘
 *
 * 失败策略：先在内存生成全部产物并跑 lint，任何一项失败 → 不写任何文件；写盘后回读再 lint。
 * 内置 lint 规则（docs/111 §5.3）：clips 数组≥1、name 唯一 ASCII、sentences≥1、start/end 数字且 end>start 升序、
 * en 非空、无绝对路径 / wavPath / 媒体字节 / base64 / 脚本 / 内联事件、单文件 ≤2 MiB。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateText } from '../shadowcourse/validate.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const DEFAULT_PACKAGES = path.join(REPO_ROOT, 'market', 'data', 'packages');
const DEFAULT_OUT = path.join(REPO_ROOT, 'market', 'data', 'import');

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const ASCII_MEDIA_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const ABSOLUTE_PATH_RE = /(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/](?![\\/])|\\\\[A-Za-z0-9._-]+\\|\/(?:home|Users|mnt|tmp|var)\/)/;
const FORBIDDEN_STRINGS = [
  [/<\s*script\b/i, '<script> 标签'],
  [/<\s*iframe\b/i, '<iframe> 标签'],
  [/\bjavascript\s*:/i, 'javascript: 伪协议'],
  [/\bdata\s*:\s*(?:audio|video|application\/octet-stream)/i, 'data: 媒体内联'],
  [/\bon(?:error|load|click|mouseover|focus|submit)\s*=/i, '内联事件处理器'],
  [/\bwavPath\b/, 'wavPath 本地录音路径'],
];
const FORBIDDEN_KEYS = new Set(['wavPath', 'script', 'scripts', 'eval', 'srcdoc', '__proto__', 'constructor', 'prototype']);

const USAGE = `SHADOW 导入产物构建器（.shadow.json / .srt / README）· 契约 docs/111 §5.2 / §5.3

用法：
  node tools/import/build-shadow-json.mjs [选项]

选项：
  --packages <dir>  .shadowcourse 包目录（默认 market/data/packages）
  --out <dir>       产物输出目录（默认 market/data/import）
  --now <ISO8601>   固定生成时间（便于可复现构建，默认当前 UTC 时间）
  --check           只校验已生成产物（lint），不写盘
  --json            stdout 只输出机器可读 JSON 摘要
  --help            显示帮助

产物（每个包 3 个文件）：
  <id>.shadow.json    r19 工程（clips[].sentences en/zh、duration=max(end)+1.5、scores/recordings 空）
  <id>.srt            句级字幕（HH:MM:SS,mmm --> HH:MM:SS,mmm，UTF-8，无翻译）
  README-<id>.txt     5 步导入 + 3 个坑 + 备选路径 + 授权说明`;

export const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

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

function timestamp(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} 时间格式非法：${JSON.stringify(value)}`);
  return new Date(parsed).toISOString();
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function pad(value, width) {
  return String(value).padStart(width, '0');
}

function srtTime(seconds) {
  const total = Math.round(Number(seconds) * 1000);
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const secs = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)},${pad(millis, 3)}`;
}

/** 句级 SRT（无翻译，英文原文） */
export function buildSrt(pkg) {
  const blocks = [];
  (pkg.sentences || []).forEach((sentence, index) => {
    blocks.push(`${index + 1}\n${srtTime(sentence.start)} --> ${srtTime(sentence.end)}\n${String(sentence.text || '').trim()}`);
  });
  return `${blocks.join('\n\n')}\n`;
}

/** 媒体名 = <包 id>.mp4（ASCII，课程页 / README / .shadow.json 三处逐字一致） */
export function mediaNameFor(pkg) {
  return `${pkg.id}.mp4`;
}

/** .shadowcourse → r19 工程 JSON（docs/111 §5.2；不带任何本地路径 / 媒体 / 用户数据） */
export function convertPackageToShadowJson(pkg, { savedAt, mediaName = mediaNameFor(pkg) } = {}) {
  const sentences = Array.isArray(pkg.sentences) ? pkg.sentences : [];
  const ends = sentences.map((sentence) => Number(sentence.end)).filter((value) => Number.isFinite(value));
  const maxEnd = ends.length > 0 ? Math.max(...ends) : 0;
  return {
    app: 'SHADOW STUDIO',
    version: 1,
    savedAt,
    projectName: pkg.title,
    clips: [
      {
        id: `clip_${pkg.id}`,
        name: mediaName,
        size: 0,
        type: 'video/mp4',
        kind: 'video',
        duration: round1(maxEnd + 1.5),
        resolution: '—',
        segmentation: 'subtitle',
        sentences: sentences.map((sentence) => ({
          start: sentence.start,
          end: sentence.end,
          en: String(sentence.text || ''),
          zh: String(sentence.translation || ''),
          words: String(sentence.text || '')
            .split(/\s+/)
            .filter(Boolean),
          linking: '',
          tip: String(sentence.notes || ''),
          score: null,
        })),
        units: [],
        peaks: [],
        thumb: null,
        subtitle: null,
        assSubtitle: null,
        asrSegments: [],
        asrSentences: [],
        asrMeta: null,
        asrTranscribedAt: 0,
        asrStale: false,
      },
    ],
    scores: {},
    recordings: {},
  };
}

/** README-<id>.txt：5 步 + 3 个坑 + 备选 + 授权（逐字可复制，中文） */
export function buildImportReadme(pkg, { mediaName = mediaNameFor(pkg) } = {}) {
  const sentences = Array.isArray(pkg.sentences) ? pkg.sentences : [];
  const ends = sentences.map((sentence) => Number(sentence.end)).filter((value) => Number.isFinite(value));
  const maxEnd = ends.length > 0 ? Math.max(...ends) : 0;
  const lines = [];
  lines.push('SHADOW 市场 · 导入说明（READ ME FIRST）');
  lines.push('====================================================');
  lines.push(`资源：${pkg.title}`);
  lines.push(`ID：${pkg.id}`);
  lines.push(`版本：${pkg.version}`);
  lines.push(`内容：${sentences.length} 句 · 时间轴 0–${round1(maxEnd)} 秒 · 英文原句 + 中文翻译`);
  lines.push('许可：CC-BY-4.0（文本 / 翻译 / 时间轴；不含媒体）');
  lines.push(`媒体名（必须逐字一致）：${mediaName}`);
  lines.push('');
  lines.push('【5 步导入 · 推荐路径 .shadow.json】');
  lines.push(`1. 在市场详情页下载工程文件「${pkg.id}.shadow.json」（推荐：自带中文翻译）。`);
  lines.push('2. 打开 SHADOW STUDIO（工具版本需 >= 0.7.0）。');
  lines.push(`3. 菜单 File → Open Project…（Ctrl+O），选择刚下载的「${pkg.id}.shadow.json」。`);
  lines.push(`4. 把你自备的英语音视频重命名为「${mediaName}」，直接拖入 SHADOW STUDIO 窗口完成媒体绑定。`);
  lines.push('5. 按句播放 / 跟读练习；所有数据保存在本机，市场不会上传任何内容。');
  lines.push('');
  lines.push('【三个坑（务必看）】');
  lines.push(`① 媒体文件名必须与「${mediaName}」逐字一致（含大小写与扩展名）；不一致时工具会新建重复 clip，句子不会自动对齐。`);
  lines.push('② 打开工程后不要点 Analyze / Generate Subtitles：这会重新分析并把包内句子替换成「待转写」。');
  lines.push('③ 媒体必须与句子时间轴同源（同一段音视频）；否则边界 / 口型对不上。没有合适媒体时可用「仅文本模式」先看句子与翻译，但播放 / 录音 / 评分不保证可用。');
  lines.push('');
  lines.push('【备选路径 · .srt】');
  lines.push(`先导入你的媒体（文件名任意）→ File → Import Subtitle… → 选择「${pkg.id}.srt」→ 建句后手动跟读（.srt 不含中文翻译）。`);
  lines.push('');
  lines.push('【规范包 · .shadowcourse】');
  lines.push(`「${pkg.id}.shadowcourse」是规范载体（Web 校验 / 归档 / 未来一键导入用），当前桌面工具版本不识别，不要用它替代上面的 .shadow.json。`);
  lines.push('');
  lines.push('【授权与合规】');
  lines.push('本资源文本 / 翻译 / 时间轴由 SHADOW Studio 创作，采用 CC-BY-4.0；不含任何第三方影视 / 音乐素材，不含媒体（BYOM）。媒体版权与授权由使用者自行负责。');
  lines.push('');
  lines.push('【校验】');
  lines.push(`node tools/shadowcourse/validate.mjs market/data/packages/${pkg.id}.shadowcourse`);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// lint（docs/111 §5.3）
// ---------------------------------------------------------------------------

function pushError(errors, code, at, message) {
  errors.push({ code, path: at, message });
}

/**
 * 校验 r19 工程 JSON（doc 对象）。
 * @returns {{ ok: boolean, errors: Array<{code:string,path:string,message:string}>, warnings: Array }}
 */
export function lintShadowJson(doc, { source = '' } = {}) {
  const errors = [];
  const warnings = [];
  const fail = (code, at, message) => pushError(errors, code, at, message);

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    fail('E_TOPLEVEL', '$', '工程 JSON 根节点必须是对象');
    return { ok: false, errors, warnings };
  }
  if (doc.app !== 'SHADOW STUDIO') fail('E_APP', 'app', `app 必须为 "SHADOW STUDIO"，实际为 ${JSON.stringify(doc.app)}`);
  if (doc.version !== 1) fail('E_VERSION', 'version', `version 必须为 1，实际为 ${JSON.stringify(doc.version)}`);
  if (typeof doc.savedAt !== 'string' || !ISO_RE.test(doc.savedAt) || Number.isNaN(Date.parse(doc.savedAt))) {
    fail('E_SAVED_AT', 'savedAt', 'savedAt 必须是 ISO8601 时间字符串');
  }
  if (typeof doc.projectName !== 'string' || doc.projectName.trim() === '') fail('E_PROJECT_NAME', 'projectName', 'projectName 必须是非空字符串');
  if (!doc.scores || typeof doc.scores !== 'object' || Array.isArray(doc.scores)) fail('E_SCORES', 'scores', 'scores 必须是对象');
  if (!doc.recordings || typeof doc.recordings !== 'object' || Array.isArray(doc.recordings)) fail('E_RECORDINGS', 'recordings', 'recordings 必须是对象');

  const clips = doc.clips;
  if (!Array.isArray(clips) || clips.length < 1) {
    fail('E_CLIPS', 'clips', 'clips 必须是数组且至少含 1 个 clip');
    return { ok: errors.length === 0, errors, warnings };
  }

  const names = new Set();
  const ids = new Set();
  clips.forEach((clip, index) => {
    const at = `clips[${index}]`;
    if (!clip || typeof clip !== 'object' || Array.isArray(clip)) {
      fail('E_CLIP_OBJECT', at, 'clip 必须是对象');
      return;
    }
    if (typeof clip.id !== 'string' || clip.id.trim() === '') fail('E_CLIP_ID', `${at}.id`, 'clip.id 必须是非空字符串');
    else if (ids.has(clip.id)) fail('E_CLIP_ID_DUP', `${at}.id`, `clip.id 重复：${clip.id}`);
    else ids.add(clip.id);

    if (typeof clip.name !== 'string' || !ASCII_MEDIA_RE.test(clip.name)) {
      fail('E_CLIP_NAME', `${at}.name`, `clip.name 必须是 ASCII 媒体文件名（字母/数字/._-，无空格），实际为 ${JSON.stringify(clip.name)}`);
    } else if (names.has(clip.name)) {
      fail('E_CLIP_NAME_DUP', `${at}.name`, `clip.name 唯一性被破坏：${clip.name}`);
    } else {
      names.add(clip.name);
    }

    if (!['video', 'audio'].includes(clip.kind)) fail('E_CLIP_KIND', `${at}.kind`, 'clip.kind 必须是 video / audio');
    if (typeof clip.type !== 'string' || !clip.type.includes('/')) fail('E_CLIP_TYPE', `${at}.type`, 'clip.type 必须是 MIME 类型（如 video/mp4）');
    if (typeof clip.duration !== 'number' || !Number.isFinite(clip.duration) || clip.duration <= 0) {
      fail('E_CLIP_DURATION', `${at}.duration`, 'clip.duration 必须是 > 0 的数字（秒）');
    }

    const sentences = clip.sentences;
    if (!Array.isArray(sentences) || sentences.length < 1) {
      fail('E_SENTENCES', `${at}.sentences`, 'sentences 必须是数组且至少 1 条');
      return;
    }
    let previousStart = null;
    sentences.forEach((sentence, sentenceIndex) => {
      const sentenceAt = `${at}.sentences[${sentenceIndex}]`;
      if (!sentence || typeof sentence !== 'object' || Array.isArray(sentence)) {
        fail('E_SENTENCE_OBJECT', sentenceAt, 'sentences 元素必须是对象');
        return;
      }
      if (typeof sentence.start !== 'number' || !Number.isFinite(sentence.start)) fail('E_SENTENCE_START', `${sentenceAt}.start`, 'start 必须是有限数字');
      if (typeof sentence.end !== 'number' || !Number.isFinite(sentence.end)) fail('E_SENTENCE_END', `${sentenceAt}.end`, 'end 必须是有限数字');
      if (typeof sentence.start === 'number' && typeof sentence.end === 'number' && !(sentence.end > sentence.start)) {
        fail('E_SENTENCE_TIME', `${sentenceAt}.end`, `end（${sentence.end}）必须大于 start（${sentence.start}）`);
      }
      if (typeof sentence.start === 'number' && previousStart !== null && sentence.start < previousStart) {
        fail('E_SENTENCE_ORDER', `${sentenceAt}.start`, `sentences 必须按 start 升序：当前 ${sentence.start} < 上一条 ${previousStart}`);
      }
      if (typeof sentence.start === 'number') previousStart = sentence.start;
      if (typeof sentence.en !== 'string' || sentence.en.trim() === '') fail('E_SENTENCE_EN', `${sentenceAt}.en`, 'en 必须是非空字符串');
      if (sentence.zh !== undefined && typeof sentence.zh !== 'string') fail('E_SENTENCE_ZH', `${sentenceAt}.zh`, 'zh 必须是字符串（可缺省）');
      if (sentence.words !== undefined && !Array.isArray(sentence.words)) fail('E_SENTENCE_WORDS', `${sentenceAt}.words`, 'words 必须是数组（可缺省）');
      if (sentence.score !== null && sentence.score !== undefined && typeof sentence.score !== 'number' && typeof sentence.score !== 'object') {
        fail('E_SENTENCE_SCORE', `${sentenceAt}.score`, 'score 必须是 null / number / object');
      }
    });

    for (const field of ['units', 'peaks', 'asrSegments', 'asrSentences']) {
      if (clip[field] !== undefined && !Array.isArray(clip[field])) fail('E_CLIP_ARRAY', `${at}.${field}`, `${field} 必须是数组`);
    }
  });

  // 纯数据扫描：禁止本地绝对路径 / wavPath / 媒体字节 / base64 / 脚本
  const scan = (value, at, depth) => {
    if (depth > 20) return;
    if (typeof value === 'string') {
      if (ABSOLUTE_PATH_RE.test(value)) fail('E_ABS_PATH', at, `发现本地绝对路径：${value.slice(0, 80)}`);
      for (const [pattern, label] of FORBIDDEN_STRINGS) {
        if (pattern.test(value)) fail('E_FORBIDDEN', at, `禁止的字符串（${label}）：${value.slice(0, 80)}`);
      }
      if (value.length > 2048 && /^[A-Za-z0-9+/=]{1024,}$/.test(value)) fail('E_BASE64', at, '疑似内联 base64 媒体数据');
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => scan(item, `${at}[${index}]`, depth + 1));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(key) || /^on[a-z]+$/i.test(key)) fail('E_FORBIDDEN_KEY', `${at}.${key}`, `禁止的字段名 "${key}"（疑似脚本 / 本地路径）`);
        scan(child, `${at}.${key}`, depth + 1);
      }
    }
  };
  scan(doc, '$', 0);

  const bytes = Buffer.byteLength(JSON.stringify(doc), 'utf8');
  if (bytes > MAX_IMPORT_BYTES) fail('E_SIZE', '$', `.shadow.json 体积 ${bytes} 字节超过 2 MiB（${MAX_IMPORT_BYTES}）`);
  if (errors.length === 0 && source) warnings.push({ code: 'W_INFO', path: '$', message: `${source} lint PASS（${bytes} 字节）` });
  return { ok: errors.length === 0, errors, warnings, bytes };
}

/** 校验 SRT 文本：句级 cue、时间码、升序、与包句子数一致（可选）。 */
export function lintSrt(text, { expectedSentences = null } = {}) {
  const errors = [];
  if (typeof text !== 'string' || text.trim() === '') {
    errors.push({ code: 'E_SRT_EMPTY', path: '$', message: 'SRT 内容为空' });
    return { ok: false, errors, cues: 0 };
  }
  const blocks = text.replace(/\ufeff/g, '').trim().split(/\r?\n\r?\n/);
  const cues = [];
  const timeRe = /^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$/;
  blocks.forEach((block, index) => {
    const lines = block.split(/\r?\n/);
    const at = `cue[${index}]`;
    if (!/^\d+$/.test(String(lines[0] || '').trim())) {
      errors.push({ code: 'E_SRT_INDEX', path: at, message: 'cue 首行必须是序号' });
      return;
    }
    const match = timeRe.exec(String(lines[1] || '').trim());
    if (!match) {
      errors.push({ code: 'E_SRT_TIME', path: at, message: `时间码格式非法（应为 HH:MM:SS,mmm --> HH:MM:SS,mmm）：${JSON.stringify(lines[1])}` });
      return;
    }
    const toSec = (h, m, s, ms) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
    const start = toSec(match[1], match[2], match[3], match[4]);
    const end = toSec(match[5], match[6], match[7], match[8]);
    const content = lines.slice(2).join('\n').trim();
    if (!(end > start)) errors.push({ code: 'E_SRT_RANGE', path: at, message: `end 必须大于 start（${start} → ${end}）` });
    if (!content) errors.push({ code: 'E_SRT_TEXT', path: at, message: 'cue 文本为空' });
    cues.push({ start, end, text: content });
  });
  for (let index = 1; index < cues.length; index += 1) {
    if (cues[index].start < cues[index - 1].start) errors.push({ code: 'E_SRT_ORDER', path: `cue[${index}]`, message: 'cue 未按时间升序' });
  }
  if (expectedSentences !== null && cues.length !== expectedSentences) {
    errors.push({ code: 'E_SRT_COUNT', path: '$', message: `cue 数（${cues.length}）与包句子数（${expectedSentences}）不一致` });
  }
  return { ok: errors.length === 0, errors, cues: cues.length };
}

/** 校验 README 导入说明（5 步 + 3 坑 + 关键信息）。 */
export function lintReadme(text, { pkg = null, mediaName = null } = {}) {
  const errors = [];
  const required = [
    ['【5 步导入', '缺少「5 步导入」小节'],
    ['【三个坑', '缺少「三个坑」小节'],
    ['File → Open Project', '缺少 File → Open Project 步骤'],
    ['BYOM', '缺少 BYOM 说明'],
    ['CC-BY-4.0', '缺少许可说明'],
  ];
  for (const [needle, message] of required) {
    if (!String(text || '').includes(needle)) errors.push({ code: 'E_README', path: '$', message });
  }
  if (!/①/.test(text) || !/②/.test(text) || !/③/.test(text)) errors.push({ code: 'E_README_PITFALLS', path: '$', message: '三个坑必须逐条编号（① ② ③）' });
  const steps = ['1. ', '2. ', '3. ', '4. ', '5. '];
  for (const step of steps) {
    if (!String(text || '').includes(step)) errors.push({ code: 'E_README_STEP', path: '$', message: `缺少导入步骤 ${step.trim()}` });
  }
  if (pkg) {
    if (!String(text).includes(pkg.id)) errors.push({ code: 'E_README_ID', path: '$', message: 'README 未包含资源 id' });
    if (!String(text).includes(pkg.title)) errors.push({ code: 'E_README_TITLE', path: '$', message: 'README 未包含资源标题' });
  }
  if (mediaName && !String(text).includes(mediaName)) errors.push({ code: 'E_README_MEDIA', path: '$', message: 'README 未包含媒体名（必须逐字一致）' });
  if (Buffer.byteLength(String(text || ''), 'utf8') > 64 * 1024) errors.push({ code: 'E_README_SIZE', path: '$', message: 'README 超过 64 KiB' });
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// 构建 / 校验
// ---------------------------------------------------------------------------

function listPackages(packagesDir) {
  if (!fs.existsSync(packagesDir)) throw new Error(`包目录不存在：${packagesDir}`);
  return fs
    .readdirSync(packagesDir)
    .filter((name) => name.endsWith('.shadowcourse'))
    .sort()
    .map((name) => path.join(packagesDir, name));
}

/**
 * 构建全部导入产物（内存生成 → lint → 写盘 → 回读 lint）。
 */
export function buildImports({ packagesDir = DEFAULT_PACKAGES, outDir = DEFAULT_OUT, nowArg = null, json = false, quiet = false } = {}) {
  const now = nowArg ? timestamp(nowArg, '--now') : new Date().toISOString();
  const packageFiles = listPackages(packagesDir);
  if (packageFiles.length === 0) throw new Error(`包目录没有 .shadowcourse：${packagesDir}`);

  const planned = [];
  const allErrors = [];
  for (const packageFile of packageFiles) {
    const text = fs.readFileSync(packageFile, 'utf8');
    const result = validateText(text, { sizeBytes: fs.statSync(packageFile).size, source: packageFile });
    if (!result.ok) {
      allErrors.push({ file: packageFile, errors: result.errors });
      continue;
    }
    const pkg = JSON.parse(text.replace(/^\ufeff/, ''));
    const mediaName = mediaNameFor(pkg);
    const shadowDoc = convertPackageToShadowJson(pkg, { savedAt: now, mediaName });
    const shadowText = `${JSON.stringify(shadowDoc, null, 2)}\n`;
    const srtText = buildSrt(pkg);
    const readmeText = buildImportReadme(pkg, { mediaName });

    const shadowLint = lintShadowJson(shadowDoc, { source: `${pkg.id}.shadow.json` });
    const srtLint = lintSrt(srtText, { expectedSentences: pkg.sentences.length });
    const readmeLint = lintReadme(readmeText, { pkg, mediaName });
    const lintErrors = [
      ...shadowLint.errors.map((error) => ({ ...error, path: `shadow.json:${error.path}` })),
      ...srtLint.errors.map((error) => ({ ...error, path: `srt:${error.path}` })),
      ...readmeLint.errors.map((error) => ({ ...error, path: `readme:${error.path}` })),
    ];
    if (lintErrors.length > 0) allErrors.push({ file: packageFile, errors: lintErrors });
    planned.push({
      packageFile,
      id: pkg.id,
      title: pkg.title,
      version: pkg.version,
      sentences: pkg.sentences.length,
      mediaName,
      shadowText,
      srtText,
      readmeText,
      shadowBytes: Buffer.byteLength(shadowText, 'utf8'),
      srtBytes: Buffer.byteLength(srtText, 'utf8'),
      readmeBytes: Buffer.byteLength(readmeText, 'utf8'),
      lint: { shadowJson: shadowLint.ok, srt: srtLint.ok, readme: readmeLint.ok },
    });
  }
  if (allErrors.length > 0) {
    throw new Error(
      `导入产物 lint 失败（未写盘）：\n${allErrors
        .map((item) => `- ${rel(item.file)}: ${item.errors.map((error) => `[${error.code}] ${error.path} ${error.message}`).join('；')}`)
        .join('\n')}`,
    );
  }

  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const item of planned) {
    const shadowFile = path.join(outDir, `${item.id}.shadow.json`);
    const srtFile = path.join(outDir, `${item.id}.srt`);
    const readmeFile = path.join(outDir, `README-${item.id}.txt`);
    writeText(shadowFile, item.shadowText);
    writeText(srtFile, item.srtText);
    writeText(readmeFile, item.readmeText);

    // 回读 lint
    const rereadShadow = lintShadowJson(JSON.parse(fs.readFileSync(shadowFile, 'utf8')), { source: rel(shadowFile) });
    const rereadSrt = lintSrt(fs.readFileSync(srtFile, 'utf8'), { expectedSentences: item.sentences });
    const rereadReadme = lintReadme(fs.readFileSync(readmeFile, 'utf8'), { pkg: { id: item.id, title: item.title }, mediaName: item.mediaName });
    if (!rereadShadow.ok || !rereadSrt.ok || !rereadReadme.ok) {
      throw new Error(`落盘产物回读 lint 失败：${rel(shadowFile)} / ${rel(srtFile)} / ${rel(readmeFile)}`);
    }
    written.push({
      id: item.id,
      shadowJson: { file: rel(shadowFile), bytes: item.shadowBytes, mediaName: item.mediaName },
      srt: { file: rel(srtFile), bytes: item.srtBytes, cues: item.sentences },
      readme: { file: rel(readmeFile), bytes: item.readmeBytes },
      sentences: item.sentences,
    });
  }

  const summary = {
    ok: true,
    generatedAt: now,
    packagesDir,
    outDir,
    format: { shadowJson: 'r19 project JSON', srt: 'HH:MM:SS,mmm', readme: '5 步 + 3 坑' },
    packages: written,
    totalSentences: planned.reduce((sum, item) => sum + item.sentences, 0),
    lint: 'PASS',
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else if (!quiet) {
    console.log('SHADOW 导入产物构建器（.shadow.json / .srt / README）· 契约 docs/111 §5.2 / §5.3');
    console.log(`包目录：${rel(packagesDir)}`);
    console.log(`输出目录：${rel(outDir)}`);
    console.log(`生成时间：${now}`);
    console.log('');
    for (const item of written) {
      console.log(`  ${item.id}`);
      console.log(`        ${item.shadowJson.file} · ${item.shadowJson.bytes} B · 媒体名 ${item.shadowJson.mediaName}`);
      console.log(`        ${item.srt.file} · ${item.srt.bytes} B · ${item.srt.cues} cues`);
      console.log(`        ${item.readme.file} · ${item.readme.bytes} B`);
    }
    console.log('');
    console.log(`  合计：${written.length} 个包 / ${summary.totalSentences} 句 / lint PASS ✅`);
  }
  return summary;
}

/**
 * 只校验已生成产物（不写盘）：每个包对应的 3 个文件存在且 lint PASS。
 */
export function checkImports({ packagesDir = DEFAULT_PACKAGES, outDir = DEFAULT_OUT, json = false, quiet = false } = {}) {
  const packageFiles = listPackages(packagesDir);
  const errors = [];
  const checked = [];
  for (const packageFile of packageFiles) {
    const packageText = fs.readFileSync(packageFile, 'utf8');
    const result = validateText(packageText, { sizeBytes: fs.statSync(packageFile).size, source: packageFile });
    if (!result.ok) {
      errors.push({ id: path.basename(packageFile), error: '包校验失败' });
      continue;
    }
    const pkg = JSON.parse(packageText.replace(/^\ufeff/, ''));
    const mediaName = mediaNameFor(pkg);
    const shadowFile = path.join(outDir, `${pkg.id}.shadow.json`);
    const srtFile = path.join(outDir, `${pkg.id}.srt`);
    const readmeFile = path.join(outDir, `README-${pkg.id}.txt`);
    const itemErrors = [];
    for (const [file, label] of [[shadowFile, 'shadow.json'], [srtFile, 'srt'], [readmeFile, 'readme']]) {
      if (!fs.existsSync(file)) itemErrors.push({ code: 'E_MISSING', path: label, message: `文件缺失：${rel(file)}` });
    }
    if (itemErrors.length === 0) {
      const shadow = JSON.parse(fs.readFileSync(shadowFile, 'utf8'));
      if (shadow.clips?.[0]?.name !== mediaName) itemErrors.push({ code: 'E_MEDIA_NAME', path: 'shadow.json', message: `clip.name 应为 ${mediaName}` });
      const shadowLint = lintShadowJson(shadow, { source: rel(shadowFile) });
      itemErrors.push(...shadowLint.errors.map((error) => ({ ...error, path: `shadow.json:${error.path}` })));
      itemErrors.push(...lintSrt(fs.readFileSync(srtFile, 'utf8'), { expectedSentences: pkg.sentences.length }).errors.map((error) => ({ ...error, path: `srt:${error.path}` })));
      itemErrors.push(...lintReadme(fs.readFileSync(readmeFile, 'utf8'), { pkg, mediaName }).errors.map((error) => ({ ...error, path: `readme:${error.path}` })));
      checked.push({ id: pkg.id, mediaName, sentences: pkg.sentences.length });
    }
    if (itemErrors.length > 0) errors.push({ id: pkg.id, errors: itemErrors });
  }
  const ok = errors.length === 0;
  const summary = { ok, outDir, packagesDir, checked, errors };
  if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else if (!quiet) {
    if (ok) {
      console.log(`import lint：${checked.length}/${packageFiles.length} 个包 · ${checked.reduce((sum, item) => sum + item.sentences, 0)} 句 · PASS ✅`);
      for (const item of checked) console.log(`  PASS ${item.id} · ${item.mediaName} · ${item.sentences} 句`);
    } else {
      console.error('import lint FAIL：');
      for (const item of errors) {
        console.error(`  ${item.id}:`);
        if (item.errors) for (const error of item.errors) console.error(`    [${error.code}] ${error.path} ${error.message}`);
        else console.error(`    ${item.error}`);
      }
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseCli(argv) {
  const opts = { packages: null, out: null, now: null, json: false, quiet: false, check: false, help: false, error: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') opts.json = true;
    else if (arg === '--quiet') opts.quiet = true;
    else if (arg === '--check') opts.check = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--packages' || arg === '--out' || arg === '--now') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        opts.error = `${arg} 需要一个参数`;
        break;
      }
      if (arg === '--packages') opts.packages = path.resolve(process.cwd(), value);
      if (arg === '--out') opts.out = path.resolve(process.cwd(), value);
      if (arg === '--now') opts.now = value;
      index += 1;
    } else if (arg.startsWith('--packages=')) opts.packages = path.resolve(process.cwd(), arg.slice('--packages='.length));
    else if (arg.startsWith('--out=')) opts.out = path.resolve(process.cwd(), arg.slice('--out='.length));
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
    const common = {
      packagesDir: opts.packages || DEFAULT_PACKAGES,
      outDir: opts.out || DEFAULT_OUT,
      json: opts.json,
      quiet: opts.quiet,
    };
    if (opts.check) {
      const summary = checkImports(common);
      process.exitCode = summary.ok ? 0 : 1;
    } else {
      buildImports({ ...common, nowArg: opts.now });
      process.exitCode = 0;
    }
  } catch (error) {
    console.error(`[import] 失败：${error && error.message ? error.message : error}`);
    if (opts.json) process.stdout.write(`${JSON.stringify({ ok: false, error: String(error && error.message ? error.message : error) }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (isMain) main();
