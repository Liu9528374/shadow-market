// 一次性探针：验证本会话能否用 playwright-core 从 tools/qa/node_modules 起 Edge headless
// 用法: D:\NODE\node.exe tools\qa\market\_probe-edge.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, 'x.js')); // 从 tools/qa/market/ 向上解析到 tools/qa/node_modules
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const out = { at: new Date().toISOString(), edgeExists: fs.existsSync(EDGE), ok: false };
try {
  const { chromium } = require('playwright-core');
  const t0 = Date.now();
  const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  out.launchMs = Date.now() - t0;
  const page = await browser.newPage();
  await page.setContent('<h1 id="t">edge-headless-ok</h1>');
  out.text = await page.textContent('#t');
  out.version = browser.version();
  out.ok = out.text === 'edge-headless-ok';
  await browser.close();
} catch (e) {
  out.error = String(e && (e.stack || e.message || e));
}
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
