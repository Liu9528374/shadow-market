// QA-verify r11：既有脚本副本（逻辑未改，仅把硬编码镜像/截图路径指向最终 r11 包与 tools/qa/market/shots）。原脚本 tools/qa/v07/ 未修改。
// r8A verification: drag no-jump + left move; subtitle plugin toggle; style panel; Alt+arrow; per-video layout.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/FOLLOWSPEAK/tools/qa/node_modules/playwright-core');
const qa = await import('file:///D:/FOLLOWSPEAK/tools/qa/v07/qa-common.mjs');

const SHOTS = 'D:/FOLLOWSPEAK/tools/qa/market/shots/final-r8';
fs.mkdirSync(SHOTS, { recursive: true });
const checks = [];
function check(n, ok, d) { checks.push({ n, ok: !!ok, d }); console.log((ok ? 'PASS ' : 'FAIL ') + n + ' :: ' + d); }
async function waitFn(page, fn, arg, timeout = 20000) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { try { const v = await page.evaluate(fn, arg); if (v) return v; } catch (e) { } await qa.sleep(150); } return null; }
let server = null, browser = null;
const result = { checks, errors: [], startedAt: new Date().toISOString() };
try {
  const PACKAGED = process.env.SUB_PACKAGED === '1';
  const MIRROR = 'D:/FOLLOWSPEAK/tools/qa/v07/.tmp/r11-final-mirror';
  const ROOT = PACKAGED ? MIRROR : 'D:/FOLLOWSPEAK/prototype';
  try { fs.rmSync(path.join(ROOT, 'data/settings.json'), { force: true }); } catch (e) { }
  server = await qa.startShadowServer({
    rootDir: ROOT, port: 18885, dev: !PACKAGED,
    scriptPath: PACKAGED ? path.join(MIRROR, 'tools/launcher/shadow-server.py') : 'D:/FOLLOWSPEAK/tools/launcher/shadow-server.py',
    pythonCmd: PACKAGED ? path.join(MIRROR, 'runtime/python.exe') : undefined
  });
  const bi = qa.findBrowser();
  browser = await chromium.launch({ executablePath: bi.path, headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto(server.baseUrl + '/', { waitUntil: 'domcontentloaded' });
  await waitFn(page, () => !!(window.SHADOW_APP && window.SHADOW_APP.ready), null, 30000);
  const b64 = fs.readFileSync(path.join(os.tmpdir(), 'shadow-qa', 'e2e-12s.wav')).toString('base64');
  await page.evaluate((s) => window.__SHADOW_TEST__.ingestWavBase64(s, 'sub-r8.wav'), b64);
  await page.evaluate(() => window.__SHADOW_TEST__.setSentence(0, { en: 'Short line.', zh: '短句。' }));
  const refresh = async () => { await page.click('body', { position: { x: 5, y: 5 } }).catch(() => { }); await page.keyboard.press('t'); await qa.sleep(120); await page.keyboard.press('t'); await qa.sleep(350); };
  await refresh();
  await page.screenshot({ path: path.join(SHOTS, '01-subtitle-plugin-on.png') });

  // ---- 1) click handle must NOT jump; drag right then left ----
  let s = await page.evaluate(() => window.__SHADOW_TEST__.subtitle());
  const startX = s.prefs.x, startY = s.prefs.y;
  let hb = await page.locator('#sub-handle').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down(); await page.mouse.up();
  await qa.sleep(300);
  s = await page.evaluate(() => window.__SHADOW_TEST__.subtitle());
  check('click handle alone does not jump', Math.abs(s.prefs.x - startX) < 0.6 && Math.abs(s.prefs.y - startY) < 0.6, `x ${startX}->${s.prefs.x} y ${startY}->${s.prefs.y}`);
  hb = await page.locator('#sub-handle').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 70, hb.y + hb.height / 2 - 30, { steps: 12 });
  await page.mouse.up(); await qa.sleep(400);
  s = await page.evaluate(() => window.__SHADOW_TEST__.subtitle());
  const rightX = s.prefs.x, rightY = s.prefs.y;
  check('drag right moves subtitle right (no teleport)', rightX > startX + 3 && rightX < 95 && rightY < startY, `x ${startX}->${rightX} y ${startY}->${rightY}`);
  await page.screenshot({ path: path.join(SHOTS, '02-drag-right.png') });
  hb = await page.locator('#sub-handle').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 - 160, hb.y + hb.height / 2 + 20, { steps: 14 });
  await page.mouse.up(); await qa.sleep(400);
  s = await page.evaluate(() => window.__SHADOW_TEST__.subtitle());
  check('drag left works after right (no lock)', s.prefs.x < rightX - 10, `x ${rightX}->${s.prefs.x}`);
  await page.screenshot({ path: path.join(SHOTS, '03-drag-left.png') });

  // ---- 2) plugin toggle ----
  const off = await page.evaluate(() => window.__SHADOW_TEST__.setPlugin('subtitle-overlay', false));
  await qa.sleep(400);
  let st = await page.evaluate(() => window.__SHADOW_TEST__.subtitle());
  check('subtitle plugin off hides subtitle + layer', off === false && st.visible === false, JSON.stringify({ visible: st.visible }));
  const offState = await page.evaluate(() => ({ visible: window.__SHADOW_TEST__.subtitle().visible, layerHidden: document.querySelector('#subtitle-layer').hidden, plugin: window.__SHADOW_TEST__.prefs().subtitlePlugin, banner: !!document.querySelector('[data-action="sub-enable"]') }));
  check('plugin off state reflected in UI', offState.visible === false && offState.layerHidden === true && offState.plugin === false, JSON.stringify(offState));
  await page.screenshot({ path: path.join(SHOTS, '04-plugin-off.png') });
  const on = await page.evaluate(() => window.__SHADOW_TEST__.setPlugin('subtitle-overlay', true));
  await qa.sleep(400);
  const onState = await page.evaluate(() => ({ visible: window.__SHADOW_TEST__.subtitle().visible, layerHidden: document.querySelector('#subtitle-layer').hidden, plugin: window.__SHADOW_TEST__.prefs().subtitlePlugin }));
  check('plugin re-enable restores subtitle', on === true && onState.visible === true && onState.layerHidden === false && onState.plugin === true, JSON.stringify(onState));
  // Plugin Manager UI：字幕作为内置插件出现在列表并可开关
  await page.locator('button.tool[data-cmd="plugins"]').first().click().catch(async () => { await page.locator('[data-cmd="plugins"]').last().click().catch(() => { }); });
  await page.waitForSelector('#plugin-manager-body', { timeout: 8000 }).catch(() => { });
  await qa.sleep(400);
  const pm = await page.evaluate(() => {
    var modal = document.querySelector('.modal');
    var t = modal ? modal.textContent : '';
    return { hasPlugin: /Subtitle Overlay|字幕/.test(t), text: t.slice(0, 400) };
  });
  check('Plugin Manager lists subtitle plugin', pm.hasPlugin, pm.hasPlugin ? (pm.text.match(/Subtitle Overlay[^\n]{0,40}/) || ['ok'])[0] : 'modal=' + pm.text.slice(0, 80));
  await page.locator('[data-plugin-toggle="subtitle-overlay"]').first().click().catch(() => { });
  await qa.sleep(500);
  const pmOff = await page.evaluate(() => ({ plugin: window.__SHADOW_TEST__.prefs().subtitlePlugin, visible: window.__SHADOW_TEST__.subtitle().visible }));
  check('Plugin Manager toggle turns subtitle plugin off', pmOff.plugin === false && pmOff.visible === false, JSON.stringify(pmOff));
  await page.locator('[data-plugin-toggle="subtitle-overlay"]').first().click().catch(() => { });
  await qa.sleep(500);
  const pmOn = await page.evaluate(() => ({ plugin: window.__SHADOW_TEST__.prefs().subtitlePlugin, visible: window.__SHADOW_TEST__.subtitle().visible }));
  check('Plugin Manager toggle turns subtitle plugin back on', pmOn.plugin === true && pmOn.visible === true, JSON.stringify(pmOn));
  await page.keyboard.press('Escape'); await qa.sleep(300);

  // ---- 3) style panel ----
  await page.evaluate(() => {
    const sel = document.querySelector('#sub-font-family'); if (sel) { sel.value = 'serif'; sel.dispatchEvent(new Event('input', { bubbles: true })); }
    const c1 = document.querySelector('#sub-color-en'); if (c1) { c1.value = '#ff8800'; c1.dispatchEvent(new Event('input', { bubbles: true })); }
    const c2 = document.querySelector('#sub-color-zh'); if (c2) { c2.value = '#00e5ff'; c2.dispatchEvent(new Event('input', { bubbles: true })); }
    const st = document.querySelector('#sub-stroke'); if (st) { st.value = '4'; st.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await qa.sleep(400);
  const style = await page.evaluate(() => {
    const en = document.querySelector('#subtitle-en');
    const cs = getComputedStyle(en);
    return { fontFamily: cs.fontFamily, color: cs.color, textShadow: cs.textShadow, prefs: window.__SHADOW_TEST__.subtitle().prefs };
  });
  check('font family applied (serif/Georgia)', /Georgia|serif/i.test(style.fontFamily), style.fontFamily);
  check('english color applied', style.color === 'rgb(255, 136, 0)', style.color);
  check('stroke width applied (text-shadow)', /rgba\(0, 0, 0/.test(style.textShadow) && style.prefs.strokeWidth === 4, style.prefs.strokeWidth + 'px');
  check('style prefs persisted in S.sub', style.prefs.fontFamily === 'serif' && style.prefs.colorEn === '#ff8800' && style.prefs.colorZh === '#00e5ff', JSON.stringify({ f: style.prefs.fontFamily, en: style.prefs.colorEn, zh: style.prefs.colorZh }));
  await page.screenshot({ path: path.join(SHOTS, '05-style-panel.png') });

  // ---- 4) Alt+arrow nudge ----
  const p0 = await page.evaluate(() => window.__SHADOW_TEST__.subtitle().prefs);
  await page.click('body', { position: { x: 5, y: 5 } }).catch(() => { });
  await page.keyboard.press('Alt+ArrowLeft'); await qa.sleep(250);
  const p1 = await page.evaluate(() => window.__SHADOW_TEST__.subtitle().prefs);
  check('Alt+ArrowLeft moves subtitle left 1%', Math.abs(p1.x - (p0.x - 1)) < 0.2 || p1.x < p0.x - 0.5, `x ${p0.x}->${p1.x}`);
  await page.keyboard.press('Alt+ArrowDown'); await qa.sleep(250);
  const p2 = await page.evaluate(() => window.__SHADOW_TEST__.subtitle().prefs);
  check('Alt+ArrowDown moves subtitle down 1%', p2.y > p1.y + 0.5, `y ${p1.y}->${p2.y}`);
  const w0 = p2.w;
  await page.keyboard.press('Alt+Shift+ArrowRight'); await qa.sleep(250);
  const p3 = await page.evaluate(() => window.__SHADOW_TEST__.subtitle().prefs);
  check('Alt+Shift+ArrowRight widens fixed width by 2%', p3.widthMode === 'fixed' && p3.w > w0 + 1, `w ${w0}->${p3.w}`);
  await page.screenshot({ path: path.join(SHOTS, '06-alt-nudge.png') });

  // ---- 5) per-video layout ----
  const media = 'C:/Users/A pig/OneDrive/桌面/xzg_730510.mp4';
  await page.setInputFiles('#file-input', media);
  const ok = await waitFn(page, () => { const st = window.__SHADOW_TEST__.state(); return st.clips.length >= 2 && st.clips[1].status === 'analyzed'; }, null, 90000);
  check('second (video) clip imported', !!ok);
  const ids = await page.evaluate(() => window.__SHADOW_TEST__.state().clips.map((c) => c.id));
  await page.locator('#media-list .mp-clip-tab').last().click(); await qa.sleep(900);
  const cur = await page.evaluate(() => window.__SHADOW_TEST__.state().currentClipId);
  check('switched to video clip', cur === ids[1], cur);
  const sc = await page.locator('[data-action="sub-scope"][data-scope="clip"]').first();
  check('scope control exists', await sc.count() > 0);
  await sc.click(); await qa.sleep(400);
  const beforeClip = await page.evaluate(() => window.__SHADOW_TEST__.subtitle().prefs);
  await page.keyboard.press('Alt+ArrowLeft'); await qa.sleep(250);
  const videoPrefs = await page.evaluate(() => window.__SHADOW_TEST__.subtitle().prefs);
  check('video clip override changed', videoPrefs.x < beforeClip.x - 0.5, `x ${beforeClip.x}->${videoPrefs.x}`);
  await page.locator('#media-list .mp-clip-tab').first().click(); await qa.sleep(700);
  const audioPrefs = await page.evaluate(() => window.__SHADOW_TEST__.subtitle().prefs);
  check('switching back to first clip uses global layout (no override leak)', Math.abs(audioPrefs.x - videoPrefs.x) > 0.5 || audioPrefs.x !== videoPrefs.x, `audio=${audioPrefs.x} video=${videoPrefs.x}`);
  await page.locator('#media-list .mp-clip-tab').last().click(); await qa.sleep(700);
  const videoAgain = await page.evaluate(() => window.__SHADOW_TEST__.subtitle().prefs);
  check('switching back to video restores its override', Math.abs(videoAgain.x - videoPrefs.x) < 0.6, `video ${videoPrefs.x} -> ${videoAgain.x}`);
  await page.screenshot({ path: path.join(SHOTS, '07-per-video.png') });

  // project snapshot contains per-clip subtitle
  const dlP = page.waitForEvent('download', { timeout: 20000 });
  await page.click('body', { position: { x: 5, y: 5 } }).catch(() => { });
  await page.keyboard.press('Control+s');
  const dl = await dlP; const projFile = path.join(os.tmpdir(), 'sub-r8-project.json'); await dl.saveAs(projFile);
  const proj = JSON.parse(fs.readFileSync(projFile, 'utf8'));
  const withSub = (proj.clips || []).filter((c) => c.subtitle);
  check('project JSON stores per-video subtitle override', withSub.length === 1 && withSub[0].subtitle.fontFamily === 'serif', 'clips with subtitle=' + withSub.length);
  check('project JSON stores global subtitle', proj.subtitle && proj.subtitle.x != null, JSON.stringify({ x: proj.subtitle && proj.subtitle.x }));

  check('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  result.errors = errors;
} catch (e) {
  check('unexpected exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
} finally {
  result.finishedAt = new Date().toISOString();
  result.pass = checks.every((c) => c.ok);
  fs.writeFileSync(path.join(SHOTS, 'subtitle-r8-result.json'), JSON.stringify(result, null, 2));
  try { if (browser) await browser.close(); } catch (e) { }
  try { if (server) server.stop(); } catch (e) { }
  console.log('\nR8 SUBTITLE ' + (result.pass ? 'PASS' : 'FAIL') + ' ' + checks.filter((c) => c.ok).length + '/' + checks.length + ' -> ' + SHOTS);
  if (!result.pass) process.exitCode = 1;
}

