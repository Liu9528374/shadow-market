// QA-verify r11：既有脚本副本（逻辑未改，仅把硬编码镜像/截图路径指向最终 r11 包与 tools/qa/market/shots）。原脚本 tools/qa/v07/ 未修改。
// r9 recording auto-stop cap verification.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/FOLLOWSPEAK/tools/qa/node_modules/playwright-core');
const qa = await import('file:///D:/FOLLOWSPEAK/tools/qa/v07/qa-common.mjs');

const SHOTS = 'D:/FOLLOWSPEAK/tools/qa/market/shots/final-r9';
fs.mkdirSync(SHOTS, { recursive: true });
const checks = [];
function check(n, ok, d) { checks.push({ n, ok: !!ok, d }); console.log((ok ? 'PASS ' : 'FAIL ') + n + ' :: ' + d); }
async function waitFn(page, fn, arg, timeout = 30000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { try { const v = await page.evaluate(fn, arg); if (v) return v; } catch (e) { } await qa.sleep(150); } return null; }
let server = null, browser = null;
const result = { checks, errors: [], startedAt: new Date().toISOString() };
try {
  const PACKAGED = process.env.SUB_PACKAGED === '1';
  const MIRROR = 'D:/FOLLOWSPEAK/tools/qa/v07/.tmp/r11-final-mirror';
  server = await qa.startShadowServer({
    rootDir: PACKAGED ? MIRROR : 'D:/FOLLOWSPEAK/prototype', port: 18889, dev: !PACKAGED,
    scriptPath: PACKAGED ? path.join(MIRROR, 'tools/launcher/shadow-server.py') : 'D:/FOLLOWSPEAK/tools/launcher/shadow-server.py',
    pythonCmd: PACKAGED ? path.join(MIRROR, 'runtime/python.exe') : undefined
  });
  const bi = qa.findBrowser();
  browser = await chromium.launch({ executablePath: bi.path, headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto(server.baseUrl + '/', { waitUntil: 'domcontentloaded' });
  await waitFn(page, () => !!(window.SHADOW_APP && window.SHADOW_APP.ready), null, 30000);
  const b64 = fs.readFileSync(path.join(os.tmpdir(), 'shadow-qa', 'e2e-12s.wav')).toString('base64');
  const ing = await page.evaluate((s) => window.__SHADOW_TEST__.ingestWavBase64(s, 'rec-r9.wav'), b64);
  check('media ingested', !!(ing && ing.ok), JSON.stringify(ing && ing.sentences));
  // scoring off to avoid ASR waits (offline in dev)
  await page.click('body', { position: { x: 5, y: 5 } }).catch(() => { });
  await page.keyboard.press('s'); await qa.sleep(250);
  const sen = (ing.sentences && ing.sentences[0]) || { start: 0, end: 5 };
  const senDur = Math.max(1, sen.end - sen.start);
  // 1) normal sentence: no manual stop -> must auto stop near target, not run long
  let t0 = Date.now();
  await page.keyboard.press('r');
  const started = await waitFn(page, () => window.__SHADOW_TEST__.state().recording === true && window.__SHADOW_TEST__.state().phase === 'recording', null, 12000);
  check('recording started', !!started);
  const stopped = await waitFn(page, () => window.__SHADOW_TEST__.state().recording === false, null, 32000);
  const wall = (Date.now() - t0) / 1000;
  await qa.sleep(600);
  const st1 = await page.evaluate(() => window.__SHADOW_TEST__.state());
  const takeDur = st1.lastTake ? st1.lastTake.duration : 0;
  check('normal take auto-stopped without manual stop', !!stopped && !!st1.lastTake, 'take=' + takeDur);
  check('normal take not excessively long (wall < sentence+7s, take < preRoll+sentence+6s)', wall < senDur + 7 && takeDur < 2 + senDur + 6, 'sen=' + senDur.toFixed(1) + ' wall=' + wall.toFixed(1) + ' take=' + takeDur.toFixed(1));
  check('take has valid rms/duration', st1.lastTake && st1.lastTake.rms > 0.01 && takeDur > 1, JSON.stringify(st1.lastTake && { rms: st1.lastTake.rms, dur: st1.lastTake.duration }));
  await page.screenshot({ path: path.join(SHOTS, '01-normal-auto-stop.png') });

  // 2) very long target (set sentence end 60s): must hit 20s hard cap, not run 60s+
  await page.evaluate(() => window.__SHADOW_TEST__.setSentence(0, { en: 'Long target line for cap test.', start: 0, end: 60 }));
  await qa.sleep(300);
  t0 = Date.now();
  await page.keyboard.press('r');
  const started2 = await waitFn(page, () => window.__SHADOW_TEST__.state().recording === true && window.__SHADOW_TEST__.state().phase === 'recording', null, 12000);
  check('long-target recording started', !!started2);
  const stopped2 = await waitFn(page, () => window.__SHADOW_TEST__.state().recording === false, null, 40000);
  const wall2 = (Date.now() - t0) / 1000;
  await qa.sleep(500);
  const st2 = await page.evaluate(() => window.__SHADOW_TEST__.state());
  check('long target hits 20s cap, not 60s', !!stopped2 && wall2 < 26, 'wall=' + wall2.toFixed(1) + 's');
  check('long target take still stored with valid duration', st2.lastTake && st2.lastTake.duration > 15 && st2.lastTake.duration < 25, st2.lastTake && st2.lastTake.duration);
  await page.screenshot({ path: path.join(SHOTS, '02-long-target-cap.png') });

  // 3) manual stop still immediate
  t0 = Date.now();
  await page.keyboard.press('r');
  await waitFn(page, () => window.__SHADOW_TEST__.state().recording === true && window.__SHADOW_TEST__.state().phase === 'recording', null, 12000);
  await qa.sleep(1200);
  await page.keyboard.press(' ');
  const stopped3 = await waitFn(page, () => window.__SHADOW_TEST__.state().recording === false, null, 8000);
  const wall3 = (Date.now() - t0) / 1000;
  check('manual Space stop still immediate (<4s total)', !!stopped3 && wall3 < 4, 'wall=' + wall3.toFixed(1));
  check('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  result.errors = errors;
} catch (e) {
  check('unexpected exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
} finally {
  result.finishedAt = new Date().toISOString();
  result.pass = checks.every((c) => c.ok);
  fs.writeFileSync(path.join(SHOTS, 'record-r9-result.json'), JSON.stringify(result, null, 2));
  try { if (browser) await browser.close(); } catch (e) { }
  try { if (server) server.stop(); } catch (e) { }
  console.log('\nR9 RECORD ' + (result.pass ? 'PASS' : 'FAIL') + ' ' + checks.filter((c) => c.ok).length + '/' + checks.length + ' -> ' + SHOTS);
  if (!result.pass) process.exitCode = 1;
}

