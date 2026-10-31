/**
 * make-fixtures.mjs - 生成桌面导入 E2E 独立 fixtures（qa-verify 自有，不依赖 market 数据）
 *
 * 产物（tools/qa/market/fixtures/）：
 *   qa-course-basic.shadowcourse     合法：4 句、时间轴已知、byom、readme 含标题
 *   qa-course-min.shadowcourse       合法：1 句最小包
 *   qa-bad-endltstart.shadowcourse   非法：end < start（应被拒 E_SCHEMA）
 *   qa-bad-json.shadowcourse         非法：坏 JSON（应被拒 E_JSON）
 *   qa-bad-script.shadowcourse       非法：readme/字段含 <script>（纯数据规则，应被拒）
 *   qa-media-3s.wav                  3s 16kHz mono 16-bit 测试媒体（正弦波+静音），仅用于 BYOM 绑定
 *
 * 用法：D:\NODE\node.exe tools\qa\market\fixtures\make-fixtures.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

const base = {
  spec: 'shadow.course',
  schemaVersion: 1,
  id: 'com.qa.course.basic',
  version: '1.0.0',
  title: 'QA 咖啡店点单',
  subtitle: 'QA Ordering at a Café · B1',
  description: 'qa-verify 独立 fixture：4 句已知时间轴，用于桌面导入/保存重开验证。',
  category: 'daily',
  tags: ['B1', 'QA', 'fixture'],
  level: 'B1',
  language: ['en', 'zh'],
  creator: { name: 'QA Verify', url: '', handle: 'qa-verify' },
  license: 'CC-BY-4.0',
  rights: { basis: 'own', evidenceUrl: '', note: 'QA fixture' },
  mediaPolicy: 'byom',
  media: [{ id: 'm1', kind: 'video', duration: 0, hint: 'BYOM：任意本地英语视频/音频' }],
  sentences: [
    { sentenceId: 's_0001', start: 0.2, end: 1.5, text: 'Hi, could I get a medium latte, please?', translation: '你好，我要一杯中杯拿铁。', notes: '连读 could I' },
    { sentenceId: 's_0002', start: 1.6, end: 3.0, text: 'Sure. Would you like it hot or iced?', translation: '好的，你要热的还是冰的？', notes: '' },
    { sentenceId: 's_0003', start: 3.2, end: 4.8, text: 'Iced, please. And a blueberry muffin.', translation: '冰的，谢谢。再来一个蓝莓松饼。', notes: '' },
    { sentenceId: 's_0004', start: 5.0, end: 7.5, text: 'That will be eight fifty. Here is your receipt.', translation: '一共八块五。这是你的收据。', notes: '数字听力' },
  ],
  exercises: {
    spec: 'shadow.exercises', schemaVersion: 1,
    default: { mode: 'shadow', loopCount: 3, speed: 1.0, scoring: { enabled: true }, subtitle: { en: true, zh: true, position: 'bottom' } },
  },
  requires: { shadow: '>=0.7.0' },
  createdAt: '2026-10-25T00:00:00Z',
  updatedAt: '2026-10-25T00:00:00Z',
  readme: '## QA 课程介绍\n\n这是 qa-verify 的独立测试课程包（非市场数据）。\n\n- 4 句，时间轴 0.2–7.5s\n- mediaPolicy: byom（不含任何媒体）\n- 用于验证拖拽导入、BYOM、保存重开、无 ASR\n',
};

const min = {
  spec: 'shadow.course', schemaVersion: 1, id: 'com.qa.course.min', version: '0.0.1',
  title: 'QA 最小包', subtitle: '', description: '最小合法包（1 句）。',
  category: 'daily', tags: [], level: 'A1', language: ['en'],
  creator: { name: 'QA Verify', url: '', handle: 'qa-verify' },
  license: 'CC-BY-4.0', mediaPolicy: 'byom', media: [],
  sentences: [{ sentenceId: 's_0001', start: 0.0, end: 1.0, text: 'Hello there.', translation: '你好。' }],
  createdAt: '2026-10-25T00:00:00Z', updatedAt: '2026-10-25T00:00:00Z',
  readme: '## 最小包\n\n只有一句。',
};

/** 16-bit PCM mono WAV；正弦波 3s + 首尾 100ms 静音 */
function makeWav({ seconds = 3, sampleRate = 16000, freq = 440 }) {
  const n = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let v = 0;
    if (t > 0.1 && t < seconds - 0.1) v = Math.sin(2 * Math.PI * freq * t) * 0.25;
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22); h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii'); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const files = [];
function w(name, obj) {
  const file = path.join(DIR, name);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
  files.push({ name, bytes: fs.statSync(file).size, valid: name.includes('basic') || name.includes('min') });
}
w('qa-course-basic.shadowcourse', base);
w('qa-course-min.shadowcourse', min);

// 非法 1：end < start
const bad1 = JSON.parse(JSON.stringify(base));
bad1.id = 'com.qa.course.badend';
bad1.sentences[0].end = 0.05;
bad1.sentences[0].start = 2.0;
fs.writeFileSync(path.join(DIR, 'qa-bad-endltstart.shadowcourse'), JSON.stringify(bad1, null, 2), 'utf8');
files.push({ name: 'qa-bad-endltstart.shadowcourse', bytes: fs.statSync(path.join(DIR, 'qa-bad-endltstart.shadowcourse')).size, valid: false });

// 非法 2：坏 JSON
fs.writeFileSync(path.join(DIR, 'qa-bad-json.shadowcourse'), '{"spec":"shadow.course", "sentences":[', 'utf8');
files.push({ name: 'qa-bad-json.shadowcourse', bytes: fs.statSync(path.join(DIR, 'qa-bad-json.shadowcourse')).size, valid: false });

// 非法 3：含 <script> 活动内容（纯数据规则）
const bad3 = JSON.parse(JSON.stringify(base));
bad3.id = 'com.qa.course.script';
bad3.readme = '## 恶意 readme\n\n<script>window.__pwned = 1;</script>\n';
fs.writeFileSync(path.join(DIR, 'qa-bad-script.shadowcourse'), JSON.stringify(bad3, null, 2), 'utf8');
files.push({ name: 'qa-bad-script.shadowcourse', bytes: fs.statSync(path.join(DIR, 'qa-bad-script.shadowcourse')).size, valid: false });

const wav = path.join(DIR, 'qa-media-3s.wav');
fs.writeFileSync(wav, makeWav({}));
files.push({ name: 'qa-media-3s.wav', bytes: fs.statSync(wav).size, kind: 'media' });

console.log(JSON.stringify({ dir: DIR, files }, null, 2));
