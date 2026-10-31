// 探针：file:// 打开 prototype/index.html，确认 __SHADOW_TEST__ 与全局 S 可从 page.evaluate 访问
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, 'x.js'));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const out = { ok: false };
try {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-first-run', '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text()); });
  await page.goto('file:///D:/FOLLOWSPEAK/prototype/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.SHADOW_APP && window.SHADOW_APP.ready === true, null, { timeout: 30000 }).catch(() => { });
  out.ready = await page.evaluate(() => !!(window.SHADOW_APP && window.SHADOW_APP.ready));
  out.version = await page.evaluate(() => window.SHADOW_APP && window.SHADOW_APP.version);
  out.clips = await page.evaluate(() => {
    try { return { ok: true, n: S.clips.length, keys: Object.keys(S).slice(0, 10) }; } catch (e) { return { ok: false, error: String(e) }; }
  });
  out.plugins = await page.evaluate(() => { try { return window.__SHADOW_TEST__.plugins(); } catch (e) { return String(e); } });
  out.errors = errs.slice(0, 10);
  out.ok = out.ready === true && out.clips && out.clips.ok === true;
  await browser.close();
} catch (e) { out.error = String(e && (e.stack || e.message)); }
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
