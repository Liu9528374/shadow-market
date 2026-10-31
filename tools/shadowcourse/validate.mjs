#!/usr/bin/env node
/**
 * tools/shadowcourse/validate.mjs
 * SHADOW 课程包 P0 校验器（`.shadowcourse` = 单文件 JSON）
 *
 * 唯一接口契约：docs/52-market-mvp-p0.md §2（字段/硬性规则）与 §3.2（catalog）
 * 完整规范：docs/53-shadowcourse-package-spec.md
 *
 * 无第三方依赖，只用 Node 内置模块；Node >= 18（本仓库实测 v24.19）。
 *
 * 用法：
 *   node tools/shadowcourse/validate.mjs <file.shadowcourse|file.json> [...]
 *   node tools/shadowcourse/validate.mjs --dir market/data/packages
 *   node tools/shadowcourse/validate.mjs <file> --json          # 机器可读输出
 *   node tools/shadowcourse/validate.mjs --selftest             # 内置正反例自测
 *
 * 退出码：0 = 全部 PASS；1 = 存在 FAIL（含用法错误/文件读取失败）。
 *
 * 同时作为模块被 build-packages.mjs 复用：
 *   import { validatePackage, validateText, computeStats } from './validate.mjs';
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// 常量（与 docs/52 §2 对齐）
// ---------------------------------------------------------------------------

export const SPEC = 'shadow.course';
export const SCHEMA_VERSION = 1;
/** 单包上限：docs/52 §2 硬性规则 4「单包 ≤ 2 MB」，按 2 MiB = 2,097,152 字节实现 */
export const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
/** README 长度上限（校验器实现约定，见 docs/53 §5；docs/52 未给数值，取 20,000 字符） */
export const MAX_README_CHARS = 20000;
export const MAX_ID_CHARS = 128;

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const CATEGORY_RE = /^[a-z][a-z0-9-]*$/;
const LANGUAGE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** CEFR 等级（未知等级只 warn，不 fail） */
const KNOWN_LEVELS = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
/** 常见许可标识（自定义 URL 也合法，仅提示） */
const KNOWN_LICENSES = new Set([
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC-BY-NC-4.0',
  'CC-BY-NC-SA-4.0',
  'CC0-1.0',
  'proprietary',
  'all-rights-reserved',
]);
const MEDIA_POLICIES = new Set(['byom', 'embedded', 'external']);
const MEDIA_KINDS = new Set(['audio', 'video']);
const EXERCISE_MODES = new Set(['shadow', 'loop', 'record', 'mixed']);
const SUBTITLE_POSITIONS = new Set(['bottom', 'top']);
const RIGHTS_BASES = new Set(['own', 'licensed', 'public-domain', 'CC']);

/** 必填顶层字段（docs/52 §2 示例中的契约字段；subtitle/tags/rights/exercises/requires 缺失只 warn） */
const REQUIRED_TOP_FIELDS = [
  'spec',
  'schemaVersion',
  'id',
  'version',
  'title',
  'description',
  'category',
  'level',
  'language',
  'creator',
  'license',
  'mediaPolicy',
  'media',
  'sentences',
  'createdAt',
  'updatedAt',
  'readme',
];
const OPTIONAL_TOP_FIELDS = ['subtitle', 'tags', 'rights', 'exercises', 'requires'];
const KNOWN_TOP_FIELDS = new Set([...REQUIRED_TOP_FIELDS, ...OPTIONAL_TOP_FIELDS]);

/** 纯数据安全扫描：危险字段名 */
const FORBIDDEN_KEY_RE = /^on[a-z]+$/i;
const FORBIDDEN_KEYS = new Set([
  'script',
  'scripts',
  'javascript',
  'eval',
  'srcdoc',
  '__proto__',
  'constructor',
  'prototype',
]);

/** 纯数据安全扫描：危险字符串模式（docs/52 §2 硬性规则 2） */
const FORBIDDEN_STRINGS = [
  [/<\s*script\b/i, '<script> 标签'],
  [/<\s*iframe\b/i, '<iframe> 标签'],
  [/<\s*object\b/i, '<object> 标签'],
  [/<\s*embed\b/i, '<embed> 标签'],
  [/\bjavascript\s*:/i, 'javascript: 伪协议'],
  [/\bdata\s*:\s*text\/html/i, 'data:text/html 内联页面'],
  [/\bsrcdoc\s*=/i, 'srcdoc= 内联页面'],
  [/\bon(?:error|load|click|mouseover|mouseenter|focus|submit|toggle)\s*=/i, '内联事件处理器属性'],
  [/\beval\s*\(/i, 'eval( 动态执行'],
  [/\bnew\s+Function\s*\(/i, 'new Function 动态执行'],
];

// 已知的其他字段（docs/43 v2 展望），出现时不当作未知字段告警
const V2_KNOWN_FIELDS = new Set([
  'homepage',
  'support',
  'rating',
  'compat',
  'translations',
  'integrity',
  'signature',
  'cover',
  'author',
]);
const KNOWN_TOP_FIELDS_ALL = new Set([...KNOWN_TOP_FIELDS, ...V2_KNOWN_FIELDS]);

const USAGE = `SHADOW 课程包 P0 校验器（.shadowcourse 单文件 JSON）· 契约 docs/52 §2

用法：
  node tools/shadowcourse/validate.mjs <file...>            校验指定文件
  node tools/shadowcourse/validate.mjs --dir <dir>          批量校验目录内 .shadowcourse / *.json
  node tools/shadowcourse/validate.mjs <file...> --json     机器可读 JSON 输出（stdout 仅 JSON）
  node tools/shadowcourse/validate.mjs --selftest           运行内置正反例自测
  node tools/shadowcourse/validate.mjs --help

说明：
  --dir 批量模式会跳过 catalog.json / index.json / sources.json / package.json（它们不是课程包）；
  同一批内 id 重复会被判 FAIL。所有 PASS 文件退出码 0，任一 FAIL 退出码 1。`;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/** 统计句数 / 时长（秒，1 位小数）/ 词数（按空白切分，真实计算） */
export function computeStats(sentences) {
  const list = Array.isArray(sentences) ? sentences : [];
  let words = 0;
  let lastEnd = 0;
  for (const sentence of list) {
    if (sentence && typeof sentence.text === 'string') {
      const trimmed = sentence.text.trim();
      if (trimmed) words += trimmed.split(/\s+/).length;
    }
    if (sentence && isFiniteNumber(sentence.end)) {
      lastEnd = Math.max(lastEnd, sentence.end);
    }
  }
  return { sentences: list.length, durationSec: round1(lastEnd), words };
}

function byteLengthOfJson(data) {
  try {
    return Buffer.byteLength(JSON.stringify(data) ?? '', 'utf8');
  } catch {
    return 0;
  }
}

function addError(errors, code, at, message, hint) {
  const item = { code, path: at, message };
  if (hint) item.hint = hint;
  errors.push(item);
}

function addWarning(warnings, code, at, message) {
  warnings.push({ code, path: at, message });
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '? B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// 核心校验
// ---------------------------------------------------------------------------

/**
 * 校验一个已解析的课程包对象。
 * @param {unknown} data 已 JSON.parse 的包对象
 * @param {{ sizeBytes?: number }} [options] sizeBytes 为真实文件字节数（缺省按 JSON 序列化估算）
 * @returns {{ ok: boolean, errors: Array, warnings: Array, info: object }}
 */
export function validatePackage(data, options = {}) {
  const errors = [];
  const warnings = [];
  const info = {
    bytes: Number.isFinite(options.sizeBytes) ? options.sizeBytes : byteLengthOfJson(data),
  };
  const fail = (code, at, message, hint) => addError(errors, code, at, message, hint);
  const warn = (code, at, message) => addWarning(warnings, code, at, message);
  const finish = () => ({ ok: errors.length === 0, errors, warnings, info });

  // ---- 0. 体积（docs/52 §2 硬性规则 4） ----
  if (info.bytes > MAX_PACKAGE_BYTES) {
    fail(
      'E_SIZE',
      '$',
      `包体积 ${info.bytes} 字节（${formatBytes(info.bytes)}）超过上限 ${MAX_PACKAGE_BYTES} 字节（2 MiB）`,
      'BYOM 包通常 <200 KB；请精简 readme 或不打包任何媒体数据',
    );
  }

  // ---- 1. 顶层结构 ----
  if (!isPlainObject(data)) {
    fail('E_TOPLEVEL', '$', '包根节点必须是 JSON 对象（object）');
    return finish();
  }

  for (const key of Object.keys(data)) {
    if (!KNOWN_TOP_FIELDS_ALL.has(key)) {
      warn(
        'W_UNKNOWN_FIELD',
        key,
        `未识别字段 "${key}" 将被忽略（docs/52 §2 规则 5：向前兼容）`,
      );
    }
  }

  const missingRequired = REQUIRED_TOP_FIELDS.filter((field) => !(field in data));
  for (const field of missingRequired) {
    if (['spec', 'schemaVersion', 'mediaPolicy', 'media', 'sentences'].includes(field)) continue;
    const codeMap = {
      id: 'E_ID',
      version: 'E_VERSION',
      title: 'E_TITLE',
      description: 'E_DESCRIPTION',
      category: 'E_CATEGORY',
      level: 'E_LEVEL',
      language: 'E_LANGUAGE',
      creator: 'E_CREATOR',
      license: 'E_LICENSE',
      createdAt: 'E_TIMESTAMP',
      updatedAt: 'E_TIMESTAMP',
      readme: 'E_README',
    };
    fail(codeMap[field] || 'E_REQUIRED', field, `缺少必填字段 ${field}`);
  }
  for (const field of ['subtitle', 'tags', 'rights', 'exercises', 'requires']) {
    if (!(field in data)) {
      warn('W_OPTIONAL_FIELD', field, `可选字段 ${field} 缺失（不阻塞校验，建议补充）`);
    }
  }

  // ---- 2. spec / schemaVersion / id / version ----
  if (!('spec' in data)) {
    fail('E_SPEC', 'spec', `缺少必填字段 spec（固定值 "${SPEC}"）`);
  } else if (data.spec !== SPEC) {
    fail('E_SPEC', 'spec', `spec 必须为字符串 "${SPEC}"，实际为 ${JSON.stringify(data.spec)}`);
  }

  if (!('schemaVersion' in data)) {
    fail('E_SCHEMA', 'schemaVersion', `缺少必填字段 schemaVersion（P0 固定 ${SCHEMA_VERSION}）`);
  } else if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 1) {
    fail('E_SCHEMA', 'schemaVersion', `schemaVersion 必须是 >= 1 的整数，实际为 ${JSON.stringify(data.schemaVersion)}`);
  } else if (data.schemaVersion !== SCHEMA_VERSION) {
    fail(
      'E_SCHEMA_VERSION',
      'schemaVersion',
      `不识别 schemaVersion=${data.schemaVersion}（P0 只支持 ${SCHEMA_VERSION}），请升级工具/校验器`,
      'docs/52 §2 规则 5：schemaVersion 不识别时提示升级工具',
    );
  }

  if ('id' in data) {
    if (typeof data.id !== 'string') {
      fail('E_ID', 'id', 'id 必须是字符串');
    } else if (!ID_RE.test(data.id)) {
      fail(
        'E_ID',
        'id',
        `id "${data.id}" 不合法：必须匹配 ${ID_RE}（小写字母/数字开头，仅含 a-z 0-9 . _ -）`,
      );
    } else if (data.id.length > MAX_ID_CHARS) {
      fail('E_ID', 'id', `id 长度 ${data.id.length} 超过上限 ${MAX_ID_CHARS}`);
    } else {
      info.id = data.id;
    }
  }

  if ('version' in data) {
    if (typeof data.version !== 'string' || !SEMVER_RE.test(data.version)) {
      fail('E_VERSION', 'version', `version 必须是 semver（如 "1.0.0"），实际为 ${JSON.stringify(data.version)}`);
    } else {
      info.version = data.version;
    }
  }

  // ---- 3. 描述性字段 ----
  if ('title' in data) {
    if (!isNonEmptyString(data.title)) {
      fail('E_TITLE', 'title', 'title 必须是非空字符串');
    } else {
      info.title = data.title;
      if (data.title.length > 120) warn('W_TITLE_LONG', 'title', `title 长度 ${data.title.length} 较长（>120 字符）`);
    }
  }

  if ('description' in data) {
    if (!isNonEmptyString(data.description)) {
      fail('E_DESCRIPTION', 'description', 'description 必须是非空字符串（1–3 句话）');
    } else if (data.description.length > 1000) {
      warn('W_DESCRIPTION_LONG', 'description', `description 长度 ${data.description.length}（建议 1–3 句话）`);
    }
  }

  if ('category' in data) {
    if (!isNonEmptyString(data.category)) {
      fail('E_CATEGORY', 'category', 'category 必须是非空字符串（对应 catalog.categories 的 id）');
    } else if (!CATEGORY_RE.test(data.category)) {
      warn('W_CATEGORY_FORMAT', 'category', `category "${data.category}" 建议使用小写 kebab-case（如 "daily"）`);
    }
  }

  if ('level' in data) {
    if (!isNonEmptyString(data.level)) {
      fail('E_LEVEL', 'level', 'level 必须是非空字符串（如 "A1"…"C2"）');
    } else if (!KNOWN_LEVELS.has(data.level)) {
      warn('W_LEVEL_UNKNOWN', 'level', `level "${data.level}" 不是标准 CEFR 等级（A1–C2）`);
    }
  }

  if ('language' in data) {
    if (!Array.isArray(data.language) || data.language.length === 0) {
      fail('E_LANGUAGE', 'language', 'language 必须是非空字符串数组（如 ["en","zh"]）');
    } else {
      data.language.forEach((lang, index) => {
        const at = `language[${index}]`;
        if (!isNonEmptyString(lang)) {
          fail('E_LANGUAGE', at, '语言代码必须是非空字符串');
        } else if (!LANGUAGE_RE.test(lang)) {
          warn('W_LANGUAGE_FORMAT', at, `语言代码 "${lang}" 建议使用 BCP-47 风格（如 en / zh / en-US）`);
        }
      });
    }
  }

  if ('creator' in data) {
    if (!isPlainObject(data.creator)) {
      fail('E_CREATOR', 'creator', 'creator 必须是对象');
    } else {
      if (!isNonEmptyString(data.creator.name)) {
        fail('E_CREATOR', 'creator.name', 'creator.name 必须是非空字符串');
      }
      if (!isNonEmptyString(data.creator.handle)) {
        warn('W_CREATOR_HANDLE', 'creator.handle', 'creator.handle 缺失（市场按 handle 聚合作者页，建议补充）');
      }
      if ('url' in data.creator && typeof data.creator.url !== 'string') {
        fail('E_CREATOR', 'creator.url', 'creator.url 必须是字符串');
      }
    }
  }

  if ('license' in data) {
    if (!isNonEmptyString(data.license)) {
      fail('E_LICENSE', 'license', 'license 必须是非空字符串（如 "CC-BY-4.0"）');
    } else if (!KNOWN_LICENSES.has(data.license) && !/^https?:\/\//i.test(data.license)) {
      warn('W_LICENSE_UNKNOWN', 'license', `license "${data.license}" 不是常见许可标识，也不是 URL（请确认合法性）`);
    }
  }

  // ---- 4. 权利声明（BYOM / 合规相关） ----
  if ('rights' in data) {
    if (!isPlainObject(data.rights)) {
      fail('E_RIGHTS', 'rights', 'rights 必须是对象');
    } else {
      if (data.rights.basis === undefined) {
        warn('W_RIGHTS_BASIS', 'rights.basis', 'rights.basis 缺失（own / licensed / public-domain / CC）');
      } else if (!RIGHTS_BASES.has(data.rights.basis)) {
        fail('E_RIGHTS', 'rights.basis', `rights.basis "${data.rights.basis}" 不是合法枚举（own / licensed / public-domain / CC）`);
      } else if (data.rights.basis !== 'own' && !isNonEmptyString(data.rights.evidenceUrl)) {
        warn('W_RIGHTS_EVIDENCE', 'rights.evidenceUrl', `rights.basis=${data.rights.basis} 建议提供 evidenceUrl 授权证据`);
      }
      if ('evidenceUrl' in data.rights && typeof data.rights.evidenceUrl !== 'string') {
        fail('E_RIGHTS', 'rights.evidenceUrl', 'rights.evidenceUrl 必须是字符串');
      }
    }
  }

  // ---- 5. mediaPolicy / media：P0 固定 BYOM、不含媒体 ----
  let mediaPolicy = null;
  if ('mediaPolicy' in data) {
    if (typeof data.mediaPolicy !== 'string' || !MEDIA_POLICIES.has(data.mediaPolicy)) {
      fail('E_MEDIA_POLICY', 'mediaPolicy', `mediaPolicy 必须是 ${[...MEDIA_POLICIES].join(' / ')} 之一，实际为 ${JSON.stringify(data.mediaPolicy)}`);
    } else {
      mediaPolicy = data.mediaPolicy;
      if (mediaPolicy !== 'byom') {
        fail(
          'E_MEDIA_POLICY_P0',
          'mediaPolicy',
          `P0 市场/导入只接受 mediaPolicy="byom"（不含媒体），实际为 "${mediaPolicy}"`,
          'docs/52 §2 规则 3 + docs/43 §3.5：embedded/external 留到 v2',
        );
      }
      info.mediaPolicy = mediaPolicy;
    }
  }

  const mediaList = Array.isArray(data.media) ? data.media : null;
  if (!('media' in data)) {
    fail('E_MEDIA', 'media', '缺少必填字段 media（BYOM 至少给 1 条媒体提示；也可为空数组）');
  } else if (mediaList === null) {
    fail('E_MEDIA', 'media', 'media 必须是数组');
  } else {
    if (mediaList.length === 0) {
      warn('W_MEDIA_EMPTY', 'media', 'media 为空数组：BYOM 包建议声明至少 1 条媒体提示（kind/hint）');
    }
    const mediaIds = new Set();
    mediaList.forEach((item, index) => {
      const at = `media[${index}]`;
      if (!isPlainObject(item)) {
        fail('E_MEDIA', at, 'media 数组元素必须是对象');
        return;
      }
      if (!isNonEmptyString(item.id)) {
        fail('E_MEDIA', `${at}.id`, 'media[].id 必须是非空字符串');
      } else if (mediaIds.has(item.id)) {
        fail('E_DUP_MEDIA_ID', `${at}.id`, `media[].id "${item.id}" 重复`);
      } else {
        mediaIds.add(item.id);
      }
      if (item.kind !== undefined && !MEDIA_KINDS.has(item.kind)) {
        warn('W_MEDIA_KIND', `${at}.kind`, `media[].kind "${item.kind}" 不是 audio/video（未知类型按提示处理）`);
      }
      if (item.duration === undefined) {
        warn('W_MEDIA_DURATION', `${at}.duration`, 'media[].duration 缺失（未知请填 0，见 docs/52 §2 示例）');
      } else if (!isFiniteNumber(item.duration) || item.duration < 0) {
        fail('E_MEDIA_DURATION', `${at}.duration`, 'media[].duration 必须是 >= 0 的数字（秒；未知填 0）');
      }
      // BYOM 包内不得含媒体二进制；也不得引用远程媒体 URL
      if (item.url !== undefined && item.url !== null && item.url !== '') {
        fail('E_MEDIA_URL', `${at}.url`, 'BYOM 包不得引用远程媒体 URL（P0 只允许本地自备媒体）');
      }
      if (item.embedded === true) {
        fail('E_MEDIA_EMBEDDED', `${at}.embedded`, 'BYOM 包不得内嵌媒体（embedded=true）');
      }
      for (const key of ['data', 'base64', 'content', 'bytes']) {
        if (item[key] !== undefined && item[key] !== null && item[key] !== '') {
          fail('E_MEDIA_EMBEDDED', `${at}.${key}`, `BYOM 包不得内嵌媒体数据（发现 "${key}" 字段）`);
        }
      }
    });
  }

  // ---- 6. sentences：免 ASR 的核心数据 ----
  const sentences = Array.isArray(data.sentences) ? data.sentences : null;
  if (!('sentences' in data)) {
    fail('E_SENTENCES', 'sentences', '缺少必填字段 sentences（至少 1 条）');
  } else if (sentences === null) {
    fail('E_SENTENCES', 'sentences', 'sentences 必须是数组');
  } else if (sentences.length === 0) {
    fail('E_SENTENCES_EMPTY', 'sentences', 'sentences 至少要有 1 条（docs/52 §2 规则 1）');
  } else {
    const sentenceIds = new Set();
    let prevStart = null;
    let prevEnd = null;
    let missingTranslation = 0;
    let missingSentenceId = 0;

    sentences.forEach((sentence, index) => {
      const at = `sentences[${index}]`;
      if (!isPlainObject(sentence)) {
        fail('E_SENTENCE_OBJECT', at, 'sentences 数组元素必须是对象');
        return;
      }
      // 句子标识（可选；重复则 fail）
      if (sentence.sentenceId === undefined) {
        missingSentenceId += 1;
      } else if (typeof sentence.sentenceId !== 'string' || sentence.sentenceId.trim() === '') {
        fail('E_SENTENCE_ID', `${at}.sentenceId`, 'sentenceId 必须是非空字符串');
      } else if (sentenceIds.has(sentence.sentenceId)) {
        fail('E_DUP_SENTENCE_ID', `${at}.sentenceId`, `sentenceId "${sentence.sentenceId}" 在包内重复`);
      } else {
        sentenceIds.add(sentence.sentenceId);
      }
      // 文本（必填、非空）
      if (!isNonEmptyString(sentence.text)) {
        fail('E_TEXT', `${at}.text`, 'text 必须是非空字符串');
      }
      // 时间轴（必填、数字、end > start）
      const { start, end } = sentence;
      if (!isFiniteNumber(start)) {
        fail('E_TIME', `${at}.start`, `start 必须是有限数字（秒），实际为 ${JSON.stringify(start)}`);
      } else if (start < 0) {
        fail('E_TIME', `${at}.start`, `start 必须 >= 0，实际为 ${start}`);
      }
      if (!isFiniteNumber(end)) {
        fail('E_TIME', `${at}.end`, `end 必须是有限数字（秒），实际为 ${JSON.stringify(end)}`);
      }
      if (isFiniteNumber(start) && isFiniteNumber(end) && end <= start) {
        fail('E_TIME', `${at}.end`, `end（${end}）必须大于 start（${start}）`);
      }
      // 升序（按 start 非递减）
      if (isFiniteNumber(start)) {
        if (prevStart !== null && start < prevStart) {
          fail('E_ORDER', `${at}.start`, `sentences 必须按 start 升序：当前 ${start} < 上一条 ${prevStart}`);
        }
        if (prevEnd !== null && start < prevEnd - 1e-6) {
          warn('W_OVERLAP', `${at}.start`, `句子与前一条时间重叠（start ${start} < 上一条 end ${prevEnd}）`);
        }
        prevStart = start;
      }
      if (isFiniteNumber(end)) prevEnd = end;
      // 翻译（可选；缺失只汇总 warn）
      if (sentence.translation === undefined) {
        missingTranslation += 1;
      } else if (typeof sentence.translation !== 'string') {
        fail('E_TRANSLATION', `${at}.translation`, 'translation 必须是字符串');
      } else if (sentence.translation.trim() === '') {
        warn('W_TRANSLATION_EMPTY', `${at}.translation`, 'translation 为空字符串（建议删除或填写翻译）');
      }
      // 词级时间（可选；出现即校验结构）
      if (sentence.words !== undefined) {
        if (!Array.isArray(sentence.words)) {
          fail('E_WORDS', `${at}.words`, 'words 必须是数组');
        } else {
          sentence.words.forEach((word, wordIndex) => {
            const wordAt = `${at}.words[${wordIndex}]`;
            if (!isPlainObject(word)) {
              fail('E_WORDS', wordAt, 'words 元素必须是对象');
              return;
            }
            if (!isNonEmptyString(word.w)) fail('E_WORDS', `${wordAt}.w`, 'words[].w 必须是非空字符串');
            if (!isFiniteNumber(word.s)) fail('E_WORDS', `${wordAt}.s`, 'words[].s 必须是数字（秒）');
            if (!isFiniteNumber(word.e)) fail('E_WORDS', `${wordAt}.e`, 'words[].e 必须是数字（秒）');
            if (isFiniteNumber(word.s) && isFiniteNumber(word.e) && word.e <= word.s) {
              fail('E_WORDS', `${wordAt}.e`, `words[].e（${word.e}）必须大于 words[].s（${word.s}）`);
            }
          });
        }
      }
      if (sentence.notes !== undefined && typeof sentence.notes !== 'string') {
        fail('E_NOTES', `${at}.notes`, 'notes 必须是字符串（教学提示）');
      }
    });

    if (missingTranslation > 0) {
      warn('W_TRANSLATION_MISSING', 'sentences', `${missingTranslation}/${sentences.length} 句缺少 translation（可选，建议补充）`);
    }
    if (missingSentenceId > 0) {
      warn(
        'W_SENTENCE_ID_MISSING',
        'sentences',
        `${missingSentenceId}/${sentences.length} 句缺少 sentenceId（可选；建议使用 s_0001 形式，导入器会按顺序生成）`,
      );
    }

    const stats = computeStats(sentences);
    info.sentences = stats.sentences;
    info.durationSec = stats.durationSec;
    info.words = stats.words;

    // 媒体时长一致性（仅当媒体声明了已知时长）
    if (mediaList && mediaList.length > 0 && stats.durationSec > 0) {
      const mediaDuration = mediaList.reduce(
        (max, item) => (isPlainObject(item) && isFiniteNumber(item.duration) && item.duration > 0 ? Math.max(max, item.duration) : max),
        0,
      );
      if (mediaDuration > 0 && stats.durationSec > mediaDuration + 0.5) {
        warn(
          'W_MEDIA_SHORTER',
          'media',
          `最后一句结束于 ${stats.durationSec}s，超过媒体声明时长 ${round1(mediaDuration)}s（BYOM 可忽略）`,
        );
      }
    }
  }

  // ---- 7. exercises（可选，纯配置） ----
  if ('exercises' in data) {
    const exercises = data.exercises;
    if (!isPlainObject(exercises)) {
      fail('E_EXERCISES', 'exercises', 'exercises 必须是对象');
    } else {
      if (exercises.spec !== undefined && exercises.spec !== 'shadow.exercises') {
        fail('E_EXERCISES', 'exercises.spec', `exercises.spec 必须为 "shadow.exercises"，实际为 ${JSON.stringify(exercises.spec)}`);
      }
      if (exercises.schemaVersion !== undefined && (!Number.isInteger(exercises.schemaVersion) || exercises.schemaVersion < 1)) {
        fail('E_EXERCISES', 'exercises.schemaVersion', 'exercises.schemaVersion 必须是 >= 1 的整数');
      }
      const preset = exercises.default;
      if (preset !== undefined) {
        if (!isPlainObject(preset)) {
          fail('E_EXERCISES', 'exercises.default', 'exercises.default 必须是对象');
        } else {
          if (preset.mode !== undefined && !EXERCISE_MODES.has(preset.mode)) {
            warn('W_EXERCISE_MODE', 'exercises.default.mode', `mode "${preset.mode}" 不是 shadow/loop/record/mixed（未知模式由工具降级处理）`);
          }
          if (preset.loopCount !== undefined && (!Number.isInteger(preset.loopCount) || preset.loopCount < 1)) {
            warn('W_EXERCISE_LOOP', 'exercises.default.loopCount', 'loopCount 建议为 >= 1 的整数');
          }
          if (preset.speed !== undefined && (!isFiniteNumber(preset.speed) || preset.speed <= 0)) {
            warn('W_EXERCISE_SPEED', 'exercises.default.speed', 'speed 建议为 > 0 的数字');
          }
          const subtitle = preset.subtitle;
          if (subtitle !== undefined) {
            if (!isPlainObject(subtitle)) {
              fail('E_EXERCISES', 'exercises.default.subtitle', 'subtitle 必须是对象');
            } else if (subtitle.position !== undefined && !SUBTITLE_POSITIONS.has(subtitle.position)) {
              warn('W_SUBTITLE_POSITION', 'exercises.default.subtitle.position', 'position 建议为 bottom/top');
            }
          }
        }
      }
    }
  }

  // ---- 8. requires（可选） ----
  if ('requires' in data) {
    if (!isPlainObject(data.requires)) {
      fail('E_REQUIRES', 'requires', 'requires 必须是对象');
    } else {
      if (data.requires.shadow !== undefined) {
        if (typeof data.requires.shadow !== 'string') {
          fail('E_REQUIRES', 'requires.shadow', 'requires.shadow 必须是 semver range 字符串（如 ">=0.7.0"）');
        } else if (!/^[<>=^~*\s]*v?\d+\.\d+\.\d+/.test(data.requires.shadow) && !/^[\^~]?\d+(\.\d+){0,2}$/.test(data.requires.shadow)) {
          warn('W_REQUIRES_FORMAT', 'requires.shadow', `requires.shadow "${data.requires.shadow}" 不像 semver range，请确认（如 ">=0.7.0"）`);
        }
      }
      if (data.requires.plugins !== undefined && !Array.isArray(data.requires.plugins)) {
        fail('E_REQUIRES', 'requires.plugins', 'requires.plugins 必须是数组');
      }
    }
  }

  // ---- 9. tags / subtitle（可选） ----
  if ('tags' in data) {
    if (!Array.isArray(data.tags)) {
      fail('E_TAGS', 'tags', 'tags 必须是字符串数组');
    } else {
      if (data.tags.length > 12) warn('W_TAGS_LONG', 'tags', `tags 数量 ${data.tags.length} 较多（建议 <= 12）`);
      data.tags.forEach((tag, index) => {
        if (!isNonEmptyString(tag)) fail('E_TAGS', `tags[${index}]`, 'tags 元素必须是非空字符串');
      });
    }
  }
  if ('subtitle' in data && typeof data.subtitle !== 'string') {
    fail('E_SUBTITLE', 'subtitle', 'subtitle 必须是字符串');
  }

  // ---- 10. 时间戳 ----
  for (const field of ['createdAt', 'updatedAt']) {
    if (!(field in data)) continue;
    const value = data[field];
    if (typeof value !== 'string' || !ISO_RE.test(value) || Number.isNaN(Date.parse(value))) {
      fail('E_TIMESTAMP', field, `${field} 必须是 ISO8601 时间字符串（如 "2026-10-25T00:00:00Z"），实际为 ${JSON.stringify(value)}`);
    }
  }
  if (
    typeof data.createdAt === 'string' &&
    typeof data.updatedAt === 'string' &&
    !Number.isNaN(Date.parse(data.createdAt)) &&
    !Number.isNaN(Date.parse(data.updatedAt)) &&
    Date.parse(data.updatedAt) < Date.parse(data.createdAt)
  ) {
    warn('W_TIMESTAMP_ORDER', 'updatedAt', 'updatedAt 早于 createdAt（请确认是否写反）');
  }

  // ---- 11. readme（必填、长度上限、安全渲染前提） ----
  if ('readme' in data) {
    if (typeof data.readme !== 'string') {
      fail('E_README', 'readme', 'readme 必须是 Markdown 字符串');
    } else {
      if (data.readme.trim() === '') {
        fail('E_README', 'readme', 'readme 不能为空（详情页 README 直接渲染）');
      }
      if (data.readme.length > MAX_README_CHARS) {
        fail(
          'E_README_TOO_LONG',
          'readme',
          `readme 长度 ${data.readme.length} 超过上限 ${MAX_README_CHARS} 字符`,
          '请把长文放到课程句子/外部链接（外链只作文字说明），README 保持摘要级',
        );
      }
    }
  }

  // ---- 12. 纯数据安全扫描（递归；docs/52 §2 硬性规则 2） ----
  scanForbiddenContent(data, '$', errors, 0, { count: 0 });

  // info 兜底（体积以真实文件为准）
  info.bytes = Number.isFinite(options.sizeBytes) ? options.sizeBytes : info.bytes;
  return finish();
}

/**
 * 递归扫描脚本/可执行/内联页面痕迹。最多报 20 条，避免刷屏。
 */
function scanForbiddenContent(value, at, errors, depth, budget) {
  if (budget.count >= 20 || depth > 30) return;
  if (typeof value === 'string') {
    for (const [pattern, label] of FORBIDDEN_STRINGS) {
      if (pattern.test(value)) {
        addError(errors, 'E_SCRIPT', at, `禁止的脚本/可执行内容：${label}`, 'docs/52 §2 规则 2：课程包必须是纯数据');
        budget.count += 1;
        return; // 同一字符串只报第一条
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenContent(item, `${at}[${index}]`, errors, depth + 1, budget));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (budget.count >= 20) return;
      const childAt = at === '$' ? key : `${at}.${key}`;
      if (FORBIDDEN_KEY_RE.test(key) || FORBIDDEN_KEYS.has(key)) {
        addError(errors, 'E_SCRIPT', childAt, `禁止的字段名 "${key}"（疑似脚本/事件处理器）`, 'docs/52 §2 规则 2：课程包必须是纯数据');
        budget.count += 1;
      }
      scanForbiddenContent(child, childAt, errors, depth + 1, budget);
    }
  }
}

/**
 * 校验一段（文件）文本：UTF-8 JSON → 对象 → validatePackage。
 * @param {string} text 文件内容
 * @param {{ sizeBytes?: number, source?: string }} [options]
 */
export function validateText(text, options = {}) {
  let content = text;
  if (typeof content !== 'string') {
    return {
      ok: false,
      errors: [{ code: 'E_JSON', path: '$', message: '文件内容不是字符串' }],
      warnings: [],
      info: { bytes: 0 },
    };
  }
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1); // 容忍 UTF-8 BOM
  const sizeBytes = Number.isFinite(options.sizeBytes) ? options.sizeBytes : Buffer.byteLength(content, 'utf8');
  let data;
  try {
    data = JSON.parse(content);
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          code: 'E_JSON',
          path: '$',
          message: `JSON 解析失败：${error.message}`,
          hint: '扩展名 .shadowcourse 只是约定，内容必须是合法 UTF-8 JSON（不要用 JSONC 注释/尾逗号）',
        },
      ],
      warnings: [],
      info: { bytes: sizeBytes, source: options.source },
    };
  }
  return validatePackage(data, { ...options, sizeBytes });
}

// ---------------------------------------------------------------------------
// CLI：批量校验
// ---------------------------------------------------------------------------

const DIR_EXCLUDED_JSON = new Set(['catalog.json', 'index.json', 'sources.json', 'package.json']);

function parseCli(argv) {
  const opts = { files: [], dirs: [], json: false, selftest: false, help: false, error: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') opts.json = true;
    else if (arg === '--selftest') opts.selftest = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--dir') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        opts.error = '--dir 需要一个目录参数';
        break;
      }
      opts.dirs.push(value);
      index += 1;
    } else if (arg.startsWith('--dir=')) {
      const value = arg.slice('--dir='.length);
      if (!value) {
        opts.error = '--dir= 后需要目录路径';
        break;
      }
      opts.dirs.push(value);
    } else if (arg.startsWith('-')) {
      opts.error = `未知参数：${arg}`;
      break;
    } else {
      opts.files.push(arg);
    }
  }
  return opts;
}

function listPackageFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    return { files: [], error: `无法读取目录 ${dir}：${error.message}` };
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    const full = path.resolve(dir, entry.name);
    if (lower.endsWith('.shadowcourse')) files.push(full);
    else if (lower.endsWith('.json') && !DIR_EXCLUDED_JSON.has(lower)) files.push(full);
  }
  files.sort();
  return { files, error: null };
}

function checkFile(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) {
      return {
        file,
        ok: false,
        bytes: 0,
        errors: [{ code: 'E_READ', path: '$', message: '不是常规文件' }],
        warnings: [],
        info: {},
      };
    }
    if (stat.size > MAX_PACKAGE_BYTES) {
      const result = validateText('{}', { sizeBytes: stat.size });
      // 体积超限直接判 FAIL，无需解析（避免超大文件开销），但仍给出结构化错误
      return {
        file,
        ok: false,
        bytes: stat.size,
        errors: [
          {
            code: 'E_SIZE',
            path: '$',
            message: `包体积 ${stat.size} 字节（${formatBytes(stat.size)}）超过上限 ${MAX_PACKAGE_BYTES} 字节（2 MiB）`,
            hint: 'BYOM 包通常 <200 KB；请精简 readme 或不打包任何媒体数据',
          },
        ],
        warnings: result.warnings || [],
        info: { bytes: stat.size },
      };
    }
    const text = fs.readFileSync(file, 'utf8');
    const result = validateText(text, { sizeBytes: stat.size, source: file });
    return {
      file,
      ok: result.ok,
      bytes: stat.size,
      errors: result.errors,
      warnings: result.warnings,
      info: result.info,
    };
  } catch (error) {
    return {
      file,
      ok: false,
      bytes: 0,
      errors: [{ code: 'E_READ', path: '$', message: `读取失败：${error.message}` }],
      warnings: [],
      info: {},
    };
  }
}

function runValidation(files) {
  const results = files.map(checkFile);

  // 同一批内 id 唯一性（docs/52 §2：全局唯一）
  const byId = new Map();
  for (const result of results) {
    const id = result.info && result.info.id;
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(result);
  }
  for (const [id, group] of byId) {
    if (group.length <= 1) continue;
    for (const result of group) {
      result.errors.push({
        code: 'E_DUP_ID',
        path: 'id',
        message: `id "${id}" 在同一批中出现 ${group.length} 次（全局唯一）`,
      });
      result.ok = false;
    }
  }

  const summary = {
    total: results.length,
    pass: results.filter((result) => result.ok).length,
    fail: results.filter((result) => !result.ok).length,
    warnings: results.reduce((sum, result) => sum + result.warnings.length, 0),
  };
  return { ok: summary.fail === 0 && results.length > 0, summary, results };
}

function displayPath(file) {
  const relative = path.relative(process.cwd(), file);
  return relative && !relative.startsWith('..') ? relative : file;
}

function printResult(result) {
  const status = result.ok ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${displayPath(result.file)}`);
  if (result.ok && result.info) {
    const parts = [];
    if (result.info.sentences !== undefined) parts.push(`${result.info.sentences} 句`);
    if (result.info.durationSec !== undefined) parts.push(`${result.info.durationSec}s`);
    if (result.info.words !== undefined) parts.push(`${result.info.words} 词`);
    if (result.info.mediaPolicy) parts.push(result.info.mediaPolicy);
    parts.push(formatBytes(result.bytes));
    if (result.info.id) parts.push(`id=${result.info.id}`);
    if (result.info.version) parts.push(`v${result.info.version}`);
    console.log(`       ${parts.join(' · ')}`);
  }
  for (const error of result.errors) {
    console.log(`       ✗ [${error.code}] ${error.path}：${error.message}`);
    if (error.hint && !result.ok) console.log(`         ↳ ${error.hint}`);
  }
  for (const warning of result.warnings) {
    console.log(`       ⚠ [${warning.code}] ${warning.path}：${warning.message}`);
  }
}

function printHuman(result) {
  console.log('SHADOW 课程包 P0 校验（契约 docs/52 §2）');
  console.log('');
  for (const item of result.results) printResult(item);
  console.log('');
  console.log(
    `汇总：PASS ${result.summary.pass} / FAIL ${result.summary.fail} · warnings ${result.summary.warnings} · 共 ${result.summary.total} 个文件`,
  );
  console.log(result.ok ? '结果：全部通过 ✅' : '结果：存在 FAIL ❌');
}

// ---------------------------------------------------------------------------
// 自测（--selftest）：内置正反例，必须全过
// ---------------------------------------------------------------------------

function makeSentence(index, overrides = {}) {
  const start = (index - 1) * 3;
  return {
    sentenceId: `s_${String(index).padStart(4, '0')}`,
    start,
    end: start + 2.2,
    text: `This is test sentence number ${index}.`,
    translation: `这是测试句子 ${index}。`,
    notes: '',
    ...overrides,
  };
}

function makeBasePackage(overrides = {}) {
  return {
    spec: 'shadow.course',
    schemaVersion: 1,
    id: 'com.shadow.course.selftest',
    version: '1.0.0',
    title: '自测课程包',
    subtitle: 'Selftest Course · A2',
    description: '用于校验器自测的合法课程包。',
    category: 'daily',
    tags: ['A2', '自测'],
    level: 'A2',
    language: ['en', 'zh'],
    creator: { name: 'SHADOW Studio', url: '', handle: 'shadow-studio' },
    license: 'CC-BY-4.0',
    rights: { basis: 'own', evidenceUrl: '', note: '自测数据' },
    mediaPolicy: 'byom',
    media: [{ id: 'm1', kind: 'audio', duration: 0, hint: '任意英语音频；时间轴按秒对齐' }],
    sentences: [makeSentence(1), makeSentence(2)],
    exercises: {
      spec: 'shadow.exercises',
      schemaVersion: 1,
      default: {
        mode: 'shadow',
        loopCount: 3,
        speed: 1.0,
        scoring: { enabled: true },
        subtitle: { en: true, zh: true, position: 'bottom' },
      },
    },
    requires: { shadow: '>=0.7.0' },
    createdAt: '2026-10-25T00:00:00Z',
    updatedAt: '2026-10-25T00:00:00Z',
    readme: '# 自测课程包\n\n这是一个合法的课程包，用于 `--selftest`。',
    ...overrides,
  };
}

function buildSelftestCases() {
  const cases = [];
  const add = (name, expect, data, options = {}, expectCode = null) => {
    cases.push({ name, expect, data, options, expectCode });
  };
  const addText = (name, expect, text, expectCode = null) => {
    cases.push({ name, expect, text, options: {}, expectCode });
  };
  const variant = (mutator, options = {}) => {
    const pkg = makeBasePackage();
    mutator(pkg);
    return { data: pkg, options };
  };

  // ---- 正例 ----
  add('完整合法包通过（含 exercises/requires/rights/tags）', 'pass', makeBasePackage());
  add(
    '最小合法包（缺可选字段）通过并 warn',
    'pass',
    (() => {
      const pkg = makeBasePackage();
      delete pkg.subtitle;
      delete pkg.tags;
      delete pkg.rights;
      delete pkg.exercises;
      delete pkg.requires;
      return pkg;
    })(),
  );
  add(
    '未知顶层字段忽略（warn 不 fail）',
    'pass',
    makeBasePackage({ futureField: { hello: 'world' } }),
  );
  add(
    'BYOM media 空数组通过并 warn',
    'pass',
    makeBasePackage({ media: [] }),
  );
  add(
    'media[].duration=0（未知时长）通过',
    'pass',
    makeBasePackage({ media: [{ id: 'm1', kind: 'video', duration: 0, hint: '自备任意视频' }] }),
  );

  // ---- 反例：结构/字段 ----
  add('缺 spec', 'fail', variant((pkg) => delete pkg.spec).data, {}, 'E_SPEC');
  add('spec 值错误', 'fail', makeBasePackage({ spec: 'shadow.course.v2' }), {}, 'E_SPEC');
  add('缺 schemaVersion', 'fail', variant((pkg) => delete pkg.schemaVersion).data, {}, 'E_SCHEMA');
  add('schemaVersion=2（提示升级）', 'fail', makeBasePackage({ schemaVersion: 2 }), {}, 'E_SCHEMA_VERSION');
  add('缺 id', 'fail', variant((pkg) => delete pkg.id).data, {}, 'E_ID');
  add('id 含大写字母（非法）', 'fail', makeBasePackage({ id: 'com.Shadow.Course.Bad' }), {}, 'E_ID');
  add('id 以点开头（非法）', 'fail', makeBasePackage({ id: '.shadow.course.bad' }), {}, 'E_ID');
  add('version 非 semver（1.0）', 'fail', makeBasePackage({ version: '1.0' }), {}, 'E_VERSION');
  add('缺 title', 'fail', variant((pkg) => delete pkg.title).data, {}, 'E_TITLE');
  add('缺 readme', 'fail', variant((pkg) => delete pkg.readme).data, {}, 'E_README');
  add('创建时间非法 ISO', 'fail', makeBasePackage({ createdAt: '2026/10/25' }), {}, 'E_TIMESTAMP');
  add('顶层是数组（非对象）', 'fail', [], {}, 'E_TOPLEVEL');

  // ---- 反例：sentences 硬性规则 ----
  add('sentences 为空数组', 'fail', makeBasePackage({ sentences: [] }), {}, 'E_SENTENCES_EMPTY');
  add('sentences 非数组', 'fail', makeBasePackage({ sentences: 'nope' }), {}, 'E_SENTENCES');
  add('end == start', 'fail', makeBasePackage({ sentences: [makeSentence(1, { start: 1, end: 1 })] }), {}, 'E_TIME');
  add('end < start', 'fail', makeBasePackage({ sentences: [makeSentence(1, { start: 5, end: 2 })] }), {}, 'E_TIME');
  add('start 是字符串', 'fail', makeBasePackage({ sentences: [makeSentence(1, { start: '0.1' })] }), {}, 'E_TIME');
  add('text 为空白', 'fail', makeBasePackage({ sentences: [makeSentence(1, { text: '   ' })] }), {}, 'E_TEXT');
  add('句子未按 start 升序', 'fail', makeBasePackage({ sentences: [makeSentence(2), makeSentence(1)] }), {}, 'E_ORDER');
  add(
    'sentenceId 重复',
    'fail',
    makeBasePackage({ sentences: [makeSentence(1), makeSentence(2, { sentenceId: 's_0001' })] }),
    {},
    'E_DUP_SENTENCE_ID',
  );
  add(
    'words 结构错误（e <= s）',
    'fail',
    makeBasePackage({ sentences: [makeSentence(1, { words: [{ w: 'This', s: 0.2, e: 0.2 }] })] }),
    {},
    'E_WORDS',
  );

  // ---- 反例：纯数据安全 ----
  add(
    'readme 含 <script>',
    'fail',
    makeBasePackage({ readme: '# 标题\n\n<script>alert(1)</script>' }),
    {},
    'E_SCRIPT',
  );
  add(
    '句子 notes 含内联事件处理器',
    'fail',
    makeBasePackage({ sentences: [makeSentence(1, { notes: '<img src=x onerror=alert(1)>' })] }),
    {},
    'E_SCRIPT',
  );
  add(
    '顶层含 onClick 事件字段',
    'fail',
    makeBasePackage({ onClick: 'doSomething()' }),
    {},
    'E_SCRIPT',
  );

  // ---- 反例：媒体/体积 ----
  add(
    'BYOM 包引用远程媒体 URL',
    'fail',
    makeBasePackage({ media: [{ id: 'm1', kind: 'video', duration: 0, url: 'https://example.com/a.mp4' }] }),
    {},
    'E_MEDIA_URL',
  );
  add(
    'mediaPolicy=embedded（P0 不支持）',
    'fail',
    makeBasePackage({ mediaPolicy: 'embedded' }),
    {},
    'E_MEDIA_POLICY_P0',
  );
  add('单包超过 2MB', 'fail', makeBasePackage(), { sizeBytes: MAX_PACKAGE_BYTES + 1 }, 'E_SIZE');
  add(
    'readme 超过长度上限',
    'fail',
    makeBasePackage({ readme: `# 超长\n\n${'a'.repeat(MAX_README_CHARS + 1)}` }),
    {},
    'E_README_TOO_LONG',
  );

  // ---- 反例：JSON 本身坏掉 ----
  addText('JSON 解析失败（截断）', 'fail', '{ "spec": "shadow.course", ', 'E_JSON');
  addText('JSON 解析失败（尾逗号）', 'fail', '{"spec":"shadow.course",}', 'E_JSON');

  return cases;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function runSelftest() {
  const cases = buildSelftestCases();
  const results = cases.map((testCase) => {
    let outcome;
    if (testCase.text !== undefined) {
      outcome = validateText(testCase.text, testCase.options || {});
    } else {
      outcome = validatePackage(clone(testCase.data), testCase.options || {});
    }
    const codeHit = !testCase.expectCode || outcome.errors.some((error) => error.code === testCase.expectCode);
    const matched = testCase.expect === 'pass' ? outcome.ok === true : outcome.ok === false && codeHit;
    return {
      name: testCase.name,
      expected: testCase.expect,
      expectedCode: testCase.expectCode,
      actual: outcome.ok ? 'pass' : 'fail',
      ok: matched,
      errorCodes: outcome.errors.map((error) => error.code),
      warningCodes: outcome.warnings.map((warning) => warning.code),
    };
  });
  const fail = results.filter((result) => !result.ok).length;
  return {
    selftest: true,
    ok: fail === 0,
    summary: { cases: results.length, pass: results.length - fail, fail },
    cases: results,
  };
}

function printSelftest(result) {
  console.log('SHADOW 课程包校验器 · 自测（--selftest）');
  console.log('');
  for (const item of result.cases) {
    const status = item.ok ? 'PASS' : 'FAIL';
    console.log(`  [${status}] ${item.name}`);
    if (!item.ok) {
      console.log(`         期望 ${item.expected}${item.expectedCode ? `（${item.expectedCode}）` : ''}，实际 ${item.actual}（${item.errorCodes.join(', ') || '无错误'}）`);
    }
  }
  console.log('');
  console.log(`汇总：PASS ${result.summary.pass} / FAIL ${result.summary.fail} · 共 ${result.summary.cases} 个用例`);
  console.log(result.ok ? '自测：全部通过 ✅' : '自测：存在不匹配 ❌');
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

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
  if (opts.selftest) {
    const result = runSelftest();
    if (opts.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else printSelftest(result);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  const files = opts.files.map((file) => path.resolve(process.cwd(), file));
  for (const dir of opts.dirs) {
    const absoluteDir = path.resolve(process.cwd(), dir);
    const listed = listPackageFiles(absoluteDir);
    if (listed.error) {
      console.error(`[shadowcourse] ${listed.error}`);
      process.exitCode = 1;
      return;
    }
    if (listed.files.length === 0) {
      console.error(`[shadowcourse] 目录 ${absoluteDir} 下没有可校验的 .shadowcourse / *.json 文件`);
      process.exitCode = 1;
      return;
    }
    files.push(...listed.files);
  }

  if (files.length === 0) {
    console.error('[shadowcourse] 没有输入文件');
    console.error('');
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const result = runValidation(files);
  if (opts.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else printHuman(result);
  process.exitCode = result.ok ? 0 : 1;
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(`[shadowcourse] 校验器内部错误：${error && error.stack ? error.stack : error}`);
    process.exitCode = 1;
  }
}
