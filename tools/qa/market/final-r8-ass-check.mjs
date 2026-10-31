// QA-verify r11：既有脚本副本（逻辑未改，仅把硬编码镜像/截图路径指向最终 r11 包与 tools/qa/market/shots）。原脚本 tools/qa/v07/ 未修改。
// r8B test: import .ass via subtitle input -> JASSUB canvas renders; DOM subtitle hides; save/restore; close ASS; plugin off.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/FOLLOWSPEAK/tools/qa/node_modules/playwright-core');
const qa = await import('file:///D:/FOLLOWSPEAK/tools/qa/v07/qa-common.mjs');

const SHOTS = 'D:/FOLLOWSPEAK/tools/qa/market/shots/final-r8';
const ASS = 'D:/FOLLOWSPEAK/tools/qa/v07/assets/sample-jassub.ass';
fs.mkdirSync(SHOTS, { recursive: true });
const checks = [];
function check(n, ok, d) { checks.push({ n, ok: !!ok, d }); console.log((ok ? 'PASS ' : 'FAIL ') + n + ' :: ' + d); }
async function waitFn(page, fn, arg, timeout = 30000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { try { const v = await page.evaluate(fn, arg); if (v) return v; } catch (e) { } await qa.sleep(200); } return null; }
let server = null, browser = null;
const result = { checks, consoleAll: [], pageErrors: [], startedAt: new Date().toISOString() };
try {
  const PACKAGED = process.env.SUB_PACKAGED === '1';
  const MIRROR = 'D:/FOLLOWSPEAK/tools/qa/v07/.tmp/r11-final-mirror';
  const ROOT = PACKAGED ? MIRROR : 'D:/FOLLOWSPEAK/prototype';
  try { fs.rmSync(path.join(ROOT, 'data/settings.json'), { force: true }); } catch (e) { }
  server = await qa.startShadowServer({
    rootDir: ROOT, port: 18887, dev: !PACKAGED,
    scriptPath: PACKAGED ? path.join(MIRROR, 'tools/launcher/shadow-server.py') : 'D:/FOLLOWSPEAK/tools/launcher/shadow-server.py',
    pythonCmd: PACKAGED ? path.join(MIRROR, 'runtime/python.exe') : undefined
  });
  const bi = qa.findBrowser();
  browser = await chromium.launch({ executablePath: bi.path, headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [], warns = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warns.push(m.text()); result.consoleAll.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => result.pageErrors.push(String(e)));
  await page.goto(server.baseUrl + '/', { waitUntil: 'domcontentloaded' });
  await waitFn(page, () => !!(window.SHADOW_APP && window.SHADOW_APP.ready), null, 30000);
  // video clip
  const media = 'C:/Users/A pig/OneDrive/桌面/xzg_730510.mp4';
  await page.setInputFiles('#file-input', media);
  const ok = await waitFn(page, () => { const st = window.__SHADOW_TEST__.state(); return st.clips.length && st.clips[0].status === 'analyzed'; }, null, 120000);
  check('video imported+analyzed', !!ok);
  await page.evaluate(() => { const v = document.querySelector('#viewer-media video'); if (v) { v.muted = true; } });
  // import .ass
  await page.setInputFiles('#subtitle-input', ASS);
  const assReady = await waitFn(page, () => {
    const s = window.__SHADOW_TEST__.subtitle();
    return s.ass && s.ass.active && s.ass.canvas;
  }, null, 45000);
  const assState = await page.evaluate(() => window.__SHADOW_TEST__.subtitle());
  check('JASSUB instance active + canvas exists', !!assReady, JSON.stringify(assState.ass));
  const hidden = await page.evaluate(() => ({ dom: document.querySelector('#subtitle').hidden, layer: document.querySelector('#subtitle-layer').hidden }));
  check('DOM bilingual subtitle hidden while ASS renders', hidden.dom === true && hidden.layer === true, JSON.stringify(hidden));
  const canvasBox = await page.locator('canvas.JASSUB').boundingBox().catch(() => null);
  check('ASS canvas positioned over video', !!canvasBox && canvasBox.width > 400 && canvasBox.height > 200, JSON.stringify(canvasBox));
  // play 2.5s to render a frame
  await page.evaluate(() => { const v = document.querySelector('#viewer-media video'); if (v) { v.currentTime = 1.2; return v.play(); } });
  await qa.sleep(2500);
  await page.screenshot({ path: path.join(SHOTS, '08-ass-jassub-top.png') });
  await page.evaluate(() => { const v = document.querySelector('#viewer-media video'); if (v) v.currentTime = 6.2; });
  await qa.sleep(1800);
  await page.screenshot({ path: path.join(SHOTS, '09-ass-jassub-middle.png') });
  // save project -> assSubtitle persisted
  const dlP = page.waitForEvent('download', { timeout: 20000 });
  await page.click('body', { position: { x: 5, y: 5 } }).catch(() => { });
  await page.keyboard.press('Control+s');
  const dl = await dlP; const projFile = path.join(os.tmpdir(), 'ass-r8-project.json'); await dl.saveAs(projFile);
  const proj = JSON.parse(fs.readFileSync(projFile, 'utf8'));
  check('project JSON stores assSubtitle text', !!(proj.clips[0] && proj.clips[0].assSubtitle && /Script Info/.test(proj.clips[0].assSubtitle.text)), 'name=' + (proj.clips[0].assSubtitle || {}).name);
  // close ASS -> DOM may show placeholder subtitle for sentence
  await page.locator('[data-action="ass-off"]').first().click().catch(() => { });
  const closed = await waitFn(page, () => { const s = window.__SHADOW_TEST__.subtitle(); return !s.ass.active && !document.querySelector('canvas.JASSUB'); }, null, 15000);
  check('close ASS removes canvas and returns to DOM subtitle', !!closed, JSON.stringify(await page.evaluate(() => window.__SHADOW_TEST__.subtitle().ass)));
  await page.screenshot({ path: path.join(SHOTS, '10-ass-closed.png') });
  // re-import then plugin off destroys renderer
  await page.setInputFiles('#subtitle-input', ASS);
  await waitFn(page, () => window.__SHADOW_TEST__.subtitle().ass.active, null, 45000);
  await page.evaluate(() => window.__SHADOW_TEST__.setPlugin('subtitle-overlay', false));
  await qa.sleep(800);
  const offState = await page.evaluate(() => ({ ass: window.__SHADOW_TEST__.subtitle().ass, plugin: window.__SHADOW_TEST__.prefs().subtitlePlugin }));
  check('plugin off destroys JASSUB + hides subtitle', offState.ass.active === false && offState.ass.canvas === false && offState.plugin === false, JSON.stringify(offState));
  await page.evaluate(() => window.__SHADOW_TEST__.setPlugin('subtitle-overlay', true));
  await qa.sleep(1500);
  const onState = await page.evaluate(() => window.__SHADOW_TEST__.subtitle().ass);
  check('plugin on re-creates JASSUB', onState.active === true && onState.canvas === true, JSON.stringify(onState));
  // ---- CJK ASS + 本机中文字体（避免豆腐块） ----
  const CJK_ASS = 'D:/FOLLOWSPEAK/tools/qa/v07/assets/sample-jassub-cjk.ass';
  const CJK_FONT = 'C:/Windows/Fonts/simhei.ttf';
  await page.setInputFiles('#subtitle-input', CJK_ASS);
  const cjk = await waitFn(page, () => {
    const s = window.__SHADOW_TEST__.subtitle();
    return s.ass.active && /cjk/i.test(s.ass.name) ? s : null;
  }, null, 45000);
  check('CJK .ass imported and rendered', !!cjk, cjk ? cjk.ass.name : 'timeout');
  if (fs.existsSync(CJK_FONT)) {
    await page.setInputFiles('#ass-font-input', CJK_FONT);
    const loaded = await waitFn(page, () => window.__SHADOW_TEST__.subtitle().ass.fontLoaded, null, 25000);
    const assFont = await page.evaluate(() => window.__SHADOW_TEST__.subtitle().ass);
    check('local CJK font loaded into JASSUB', !!loaded, JSON.stringify(assFont));
    await page.evaluate(() => { const v = document.querySelector('#viewer-media video'); if (v) { v.currentTime = 2.0; return v.play(); } });
    await qa.sleep(1800);
    await page.screenshot({ path: path.join(SHOTS, '11-ass-cjk-font.png') });
  } else {
    check('local CJK font exists on this machine', false, CJK_FONT);
  }
  check('no page errors', result.pageErrors.length === 0, result.pageErrors.slice(0, 2).join(' | '));
  const realErrors = errors.filter((e) => !/favicon/i.test(e));
  check('no fatal console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
  result.warns = warns;
  result.errors = realErrors;
} catch (e) {
  check('unexpected exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
} finally {
  result.finishedAt = new Date().toISOString();
  result.pass = checks.every((c) => c.ok);
  fs.writeFileSync(path.join(SHOTS, 'ass-r8-result.json'), JSON.stringify(result, null, 2));
  try { if (browser) await browser.close(); } catch (e) { }
  try { if (server) server.stop(); } catch (e) { }
  console.log('\nR8B ASS ' + (result.pass ? 'PASS' : 'FAIL') + ' ' + checks.filter((c) => c.ok).length + '/' + checks.length + ' -> ' + SHOTS);
  if (!result.pass) process.exitCode = 1;
}

