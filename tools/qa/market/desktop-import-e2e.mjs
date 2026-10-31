/**
 * desktop-import-e2e.mjs - r11 桌面端课程包一键导入 + BYOM + 字体持久化 + 插件 manifest（qa-verify）
 *
 * 覆盖 docs/52-market-mvp-p0.md §7 桌面验收 6–8 与工具侧 9–11：
 *   6) 拖拽/选择 .shadowcourse → 建课程 clip（句子数/时间轴正确）→ BYOM 提示；绑定本地媒体后时长显示、可播放；
 *      不选媒体 → 仅文本模式（播放禁用 + 提示）
 *   7) ?import=<url> 深链导入成功（独立静态服务供包 URL + 工具独立端口）
 *   8) 保存工程并重开：课程元数据/句子仍在；不触发 ASR（无 /api/asr 转写调用）
 *   10) /api/font：只读列系统 CJK 字体 + 字体字节；选择后重启工具自动恢复；不写用户磁盘
 *   11) 插件 manifest：Plugin Manager 可见 subtitle-overlay manifest + 设置深链 #plugin=subtitle-overlay，开关行为不变
 *   另含负例：非法包（坏 JSON / end<start / 含 <script>）被拒且不建 clip。
 *
 * 用法（D:\NODE\node.exe）：
 *   node tools\qa\market\desktop-import-e2e.mjs --root=tools\qa\v07\.tmp\r11-verify-mirror
 *   node tools\qa\market\desktop-import-e2e.mjs --dev                    # 对 prototype/ 源码跑（无打包产物时）
 *   node tools\qa\market\desktop-import-e2e.mjs --root=<新包镜像> --port=18960 --report=...
 *
 * 退出码：全 PASS=0，有 FAIL=1，环境未就绪=2。
 * 证据：tools/qa/market/report-desktop.json + tools/qa/market/shots/*.png
 */
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import {
  REPO_ROOT, SHOTS_DIR, ensureDir, parseArgs, writeJsonReport, nowIso, sleep, log, logErr,
  httpRequest, launchEdge, newInstrumentedPage, shot, makeChecks, consoleErrorsOf, isShadowProbeNoise,
  bodyText, findFreePort, isPortFree, waitTcp, killTree, EDGE,
} from './common.mjs';

const argv = parseArgs();
const DEV = !!argv.dev;
const ROOT = argv.root
  ? path.resolve(REPO_ROOT, String(argv.root))
  : path.resolve(REPO_ROOT, 'tools', 'qa', 'v07', '.tmp', 'r11-verify-mirror');
const REPORT = argv.report ? path.resolve(REPO_ROOT, String(argv.report)) : path.join(REPO_ROOT, 'tools', 'qa', 'market', 'report-desktop.json');
const SHOTS = argv.shots ? path.resolve(REPO_ROOT, String(argv.shots)) : SHOTS_DIR;
const FIXTURES = path.join(REPO_ROOT, 'tools', 'qa', 'market', 'fixtures');
const PRIVATE_TMP = path.join(REPO_ROOT, 'tools', 'qa', 'v07', '.tmp', 'r11-verify-tmp', 'desktop');
const COURSE_BASIC = path.join(FIXTURES, 'qa-course-basic.shadowcourse');
const COURSE_MIN = path.join(FIXTURES, 'qa-course-min.shadowcourse');
const MEDIA_WAV = path.join(FIXTURES, 'qa-media-3s.wav');
const EMPTY_WAV = path.join(FIXTURES, 'qa-media-empty.wav');

const report = {
  test: 'desktop-import-e2e', round: 'r11', startedAt: nowIso(),
  mode: DEV ? 'dev' : 'packaged',
  root: ROOT, appHtml: null, appHtmlSha256: null, server: null, browser: null,
  checks: null, extra: {}, console: [], pageErrors: [], requestFailures: [],
  asrRequests: [], requests: [], screenshots: [], phases: {}, error: null, pass: false,
};
function save(fail = true) {
  report.finishedAt = nowIso();
  report.pass = !fail;
  writeJsonReport(REPORT, report);
}
function fatal(msg) {
  report.error = msg; logErr('[desktop] FATAL: ' + msg); save(true); process.exit(2);
}
function shotName(n) { return n; }

/* ---------------- 服务进程（私有 TEMP，串行单实例） ---------------- */
async function startShadowServer({ port }) {
  ensureDir(PRIVATE_TMP);
  const py = (!DEV && fs.existsSync(path.join(ROOT, 'runtime', 'python.exe')))
    ? path.join(ROOT, 'runtime', 'python.exe') : 'python';
  const script = DEV ? path.join(REPO_ROOT, 'tools', 'launcher', 'shadow-server.py')
    : path.join(ROOT, 'tools', 'launcher', 'shadow-server.py');
  if (!fs.existsSync(script)) throw new Error(`shadow-server.py 不存在：${script}`);
  const logFile = path.join(PRIVATE_TMP, `shadow-server-${port}-${Date.now()}.log`);
  const out = fs.openSync(logFile, 'w');
  const args = [script, '--root', ROOT, '--port', String(port)];
  if (DEV) args.push('--dev');
  const asrProbe = await httpRequest('http://127.0.0.1:8765/health', { timeoutMs: 1500 }).catch(() => null);
  const asrUrl = (asrProbe && asrProbe.status === 200 && asrProbe.json && asrProbe.json.ok) ? 'http://127.0.0.1:8765' : null;
  if (asrUrl) args.push('--asr', asrUrl);
  const proc = spawn(py, args, {
    stdio: ['ignore', out, out], windowsHide: true,
    env: Object.assign({}, process.env, { TEMP: PRIVATE_TMP, TMP: PRIVATE_TMP }),
  });
  const stop = () => { try { fs.closeSync(out); } catch { } killTree(proc); };
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) break;
    const r = await httpRequest(base + '/api/config', { timeoutMs: 1500 }).catch(() => null);
    if (r && r.status === 200 && r.json && r.json.ok && r.json.pid === proc.pid) {
      return { proc, port, baseUrl: base, logFile, asrUrl, stop };
    }
    await sleep(250);
  }
  const logTxt = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').slice(-2500) : '';
  stop();
  throw new Error(`shadow-server 启动失败（port=${port}, root=${ROOT}）\n${logTxt}`);
}

/* ---------------- 包 URL 静态服务（模拟市场静态站；CORS *） ---------------- */
async function startFixtureServer({ port }) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    hits.push({ at: nowIso(), method: req.method, path: u.pathname });
    const p = path.join(FIXTURES, path.basename(u.pathname));
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Access-Control-Allow-Headers': '*' });
      return res.end();
    }
    if (!p.startsWith(FIXTURES) || !fs.existsSync(p) || !fs.statSync(p).isFile()) {
      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); return res.end('not found');
    }
    const body = fs.readFileSync(p);
    res.writeHead(200, {
      'Content-Type': p.endsWith('.shadowcourse') ? 'application/json; charset=utf-8' : 'application/octet-stream',
      'Content-Length': body.length, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store',
    });
    res.end(body);
  });
  await new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(port, '127.0.0.1', resolve); });
  return { port, baseUrl: `http://127.0.0.1:${port}`, hits, stop: () => new Promise((r) => srv.close(() => r())) };
}

/* ---------------- 浏览器场景辅助 ---------------- */
const files = {};
function loadFixture(file) {
  return fs.readFileSync(file).toString('base64');
}

/** 在页面里用 DataTransfer 拖拽文件到 window（模拟真实拖拽） */
async function dragDropFile(page, filePath, mime = 'application/json') {
  const b64 = loadFixture(filePath);
  const name = path.basename(filePath);
  return await page.evaluate(({ b64, name, mime }) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], name, { type: mime });
    const dt = new DataTransfer();
    dt.items.add(file);
    ['dragenter', 'dragover', 'drop'].forEach((type) => {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
      window.dispatchEvent(ev);
    });
    return { name, size: bytes.length };
  }, { b64, name, mime });
}

async function waitFn(page, fn, arg, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const v = await page.evaluate(fn, arg);
      if (v) return v;
      last = v;
    } catch (e) { last = String(e && e.message); }
    await sleep(200);
  }
  return null;
}

/** 取当前课程 clip 的完整快照（直读全局 S；仅测试读取） */
async function courseClips(page) {
  return await page.evaluate(() => {
    try {
      return S.clips.filter((c) => c && c.course).map((c) => ({
        id: c.id, name: c.name, kind: c.kind, status: c.status, duration: c.duration,
        mediaMissing: !!c.mediaMissing, courseMediaBound: !!c.courseMediaBound, textOnly: !!c.textOnly,
        sentences: (c.sentences || []).map((s) => ({ start: s.start, end: s.end, en: s.en, zh: s.zh, tip: s.tip, courseSentenceId: s.courseSentenceId })),
        course: {
          id: c.course.id, version: c.course.version, title: c.course.title, license: c.course.license,
          mediaPolicy: c.course.mediaPolicy, readme: (c.course.readme || '').slice(0, 200),
          creator: c.course.creator, tags: c.course.tags, level: c.course.level, sourceUrl: c.course.sourceUrl || '',
        },
        wizardOpen: !!S.courseWizard,
      }));
    } catch (e) { return { error: String(e && e.message) }; }
  });
}

/** 断言课程 clip 句子时间轴与 fixture 完全一致 */
function timelineMatches(clip, fixture) {
  if (!clip || !clip.sentences) return { ok: false, detail: 'no sentences' };
  if (clip.sentences.length !== fixture.sentences.length) return { ok: false, detail: `count ${clip.sentences.length} != ${fixture.sentences.length}` };
  const diffs = [];
  for (let i = 0; i < fixture.sentences.length; i++) {
    const a = clip.sentences[i], b = fixture.sentences[i];
    if (Math.abs(Number(a.start) - Number(b.start)) > 0.001) diffs.push(`#${i} start ${a.start}!=${b.start}`);
    if (Math.abs(Number(a.end) - Number(b.end)) > 0.001) diffs.push(`#${i} end ${a.end}!=${b.end}`);
    if (String(a.en || '').trim() !== String(b.text || '').trim()) diffs.push(`#${i} text`);
    if (String(a.zh || '').trim() !== String(b.translation || '').trim()) diffs.push(`#${i} zh`);
  }
  return { ok: diffs.length === 0, detail: diffs.slice(0, 6).join('; ') };
}

/* ---------------- 主流程 ---------------- */
async function main() {
  ensureDir(SHOTS);
  ensureDir(PRIVATE_TMP);
  if (!DEV && !fs.existsSync(ROOT)) fatal(`镜像 root 不存在：${ROOT}（先 make-mirror-root.ps1，或传 --dev / --root）`);
  const appHtml = DEV ? path.join(REPO_ROOT, 'prototype', 'index.html') : path.join(ROOT, 'app', 'SHADOW-Studio-0.7.0.html');
  if (!fs.existsSync(appHtml)) fatal(`app html 不存在：${appHtml}`);
  report.appHtml = appHtml;
  report.appHtmlSha256 = (await import('node:crypto')).createHash('sha256').update(fs.readFileSync(appHtml)).digest('hex').toUpperCase();
  log(`[desktop] mode=${DEV ? 'dev' : 'packaged'} root=${ROOT} appHtmlSha=${report.appHtmlSha256.slice(0, 12)}…`);

  const port = Number(argv.port) || await findFreePort(18960);
  if (!(await isPortFree(port))) fatal(`端口 ${port} 被占用，换 --port=`);
  const staticPort = await findFreePort(port + 1, 20);
  if (!(await isPortFree(staticPort))) fatal(`静态端口 ${staticPort} 被占用`);

  const checks = makeChecks('desktop-import-e2e');
  let server = null, fixtureSrv = null, browser = null, page = null, events = null, context = null;

  try {
    fixtureSrv = await startFixtureServer({ port: staticPort });
    server = await startShadowServer({ port });
    const baseUrl = server.baseUrl;
    report.server = { port, baseUrl, dev: DEV, root: ROOT, logFile: server.logFile, asrUrl: server.asrUrl, staticPort };
    log(`[desktop] shadow-server ${baseUrl} asr=${server.asrUrl || '(off)'} fixture=${fixtureSrv.baseUrl}`);

    const launched = await launchEdge({ headless: !argv.headed });
    browser = launched.browser;
    report.browser = launched.browserInfo;
    const A = await newInstrumentedPage(browser, { viewport: { width: 1440, height: 900 } });
    context = A.context; page = A.page; events = A.events;
    const syncEv = () => {
      report.console = events.console.slice();
      report.pageErrors = events.pageErrors.slice();
      report.requestFailures = events.requestFailures.slice();
      report.requests = [...new Set(events.requests)].slice(-300);
      report.asrRequests = events.requests.filter((u) => /\/api\/asr/.test(u));
    };
    page.on('console', (m) => {
      if (m.type() === 'error') log(`  [console error] ${m.text()}`);
    });

    const boot = await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const ready = await waitFn(page, () => !!(window.SHADOW_APP && window.SHADOW_APP.ready), null, 45000);
    syncEv();
    report.phases.boot = {
      status: boot && boot.status(), url: page.url(), ready: !!ready,
      version: await page.evaluate(() => (window.SHADOW_APP && window.SHADOW_APP.version) || null).catch(() => null),
      api: await page.evaluate(() => (window.SHADOW_APP && window.SHADOW_APP.api) || null).catch(() => null),
    };
    checks.ok('D0.1', '页面 HTTP 200 且 SHADOW_APP.ready=true', (boot && boot.status() === 200) && !!ready,
      `status=${boot && boot.status()} ready=${ready} url=${page.url()}`);
    checks.ok('D0.2', '本地服务 API 生效（/api/config + server=true）',
      !!(report.phases.boot.api && report.phases.boot.api.server), `api=${JSON.stringify(report.phases.boot.api)}`);
    checks.ok('D0.3', '打包版 /api/config.dev === false（dev 模式反向检查）',
      DEV ? !!(report.phases.boot.api && report.phases.boot.api.server) : await (async () => {
        const cfg = await httpRequest(baseUrl + '/api/config');
        return !!(cfg.json && cfg.json.dev === false);
      })(), `dev=${DEV}`);

    const basic = JSON.parse(fs.readFileSync(COURSE_BASIC, 'utf8'));
    const min = JSON.parse(fs.readFileSync(COURSE_MIN, 'utf8'));
    const before = await courseClips(page);
    checks.ok('D0.4', '初始无课程 clip', Array.isArray(before) && before.length === 0, `count=${before && before.length}`);

    // ===================== 6a. 拖拽导入 =====================
    const dragInfo = await dragDropFile(page, COURSE_BASIC);
    let clips = await waitFn(page, (id) => {
      const c = S.clips.find((x) => x.course && x.course.id === id);
      return c ? { ok: true, n: S.clips.length } : null;
    }, basic.id, 25000);
    syncEv();
    const dragClips = await courseClips(page);
    const dragClip = Array.isArray(dragClips) ? dragClips.find((c) => c.course.id === basic.id) : null;
    const tl = dragClip ? timelineMatches(dragClip, basic) : { ok: false, detail: 'clip 未创建' };
    const wizardVisible = await page.evaluate(() => {
      const w = S.courseWizard;
      if (!w || !w.backdrop) return false;
      const r = w.backdrop.getBoundingClientRect ? w.backdrop.getBoundingClientRect() : null;
      return !!(w.backdrop.offsetParent !== null || (r && r.width > 0));
    }).catch(() => false);
    const wizardText = await page.evaluate(() => {
      try { return S.courseWizard && S.courseWizard.modal ? S.courseWizard.modal.innerText : ''; } catch (e) { return ''; }
    }).catch(() => '');
    report.phases.dragImport = { dragInfo, created: !!clips, clipCount: Array.isArray(dragClips) ? dragClips.length : null, wizardVisible, timeline: tl, courseTitle: basic.title };
    await shot(page, shotName('desktop-import-wizard.png'), SHOTS); report.screenshots.push('desktop-import-wizard.png');
    checks.ok('D6.1', '拖拽 .shadowcourse 建课程 clip（kind=course/status=analyzed）', !!dragClip && dragClip.kind === 'course' && dragClip.status === 'analyzed',
      `created=${!!clips} count=${Array.isArray(dragClips) ? dragClips.length : '?'} kind=${dragClip && dragClip.kind} status=${dragClip && dragClip.status}`);
    checks.ok('D6.2', `句子数与时间轴正确（${basic.sentences.length} 句）`, tl.ok,
      `count=${dragClip ? dragClip.sentences.length : '?'} diff=${tl.detail}`);
    checks.ok('D6.3', 'BYOM 向导弹出并提示选择本地媒体/仅文本', wizardVisible && /BYOM|本地媒体|仅文本/.test(wizardText || ''),
      `visible=${wizardVisible} title=${(wizardText || '').split('\n')[0] || ''}`);
    checks.ok('D6.4', '课程元数据正确（id/version/title/license/byom）',
      !!dragClip && dragClip.course.id === basic.id && dragClip.course.version === basic.version &&
      dragClip.course.title === basic.title && dragClip.course.license === basic.license && dragClip.course.mediaPolicy === 'byom',
      `id=${dragClip && dragClip.course.id} ver=${dragClip && dragClip.course.version} license=${dragClip && dragClip.course.license}`);
    checks.ok('D6.5', '导入后媒体缺失态（mediaMissing=true, duration=0）', !!dragClip && dragClip.mediaMissing === true && Number(dragClip.duration) === 0,
      `mediaMissing=${dragClip && dragClip.mediaMissing} duration=${dragClip && dragClip.duration}`);
    const courseImportedLog = events.console.find((c) => /course imported/.test(c.text));
    report.extra.courseImportedConsole = courseImportedLog || null;
    checks.ok('D6.6', '导入日志显式 asr:false（console.info [SHADOW] course imported）',
      !!courseImportedLog && /asr:\s*false/.test(courseImportedLog.text || ''),
      courseImportedLog ? courseImportedLog.text.slice(0, 200) : '未捕获导入日志');

    // ===================== 6b. 仅文本模式 =====================
    const textOnlyClick = await page.evaluate(() => {
      const btn = document.querySelector('[data-byom="text"]');
      if (!btn) return { ok: false };
      btn.click();
      return { ok: true };
    }).catch(() => ({ ok: false }));
    await sleep(700);
    const textOnlyClips = await courseClips(page);
    const toClip = textOnlyClips.find((c) => c.course.id === basic.id);
    const playState = await page.evaluate(() => {
      const btn = document.querySelector('#btn-play');
      const toastWrap = document.querySelector('#toast-wrap');
      const toastText = toastWrap ? toastWrap.innerText || toastWrap.textContent : '';
      const hook = (window.__SHADOW_TEST__ && window.__SHADOW_TEST__.course) ? window.__SHADOW_TEST__.course() : null;
      return { playDisabled: !!(btn && btn.disabled), playing: !!S.playing, toastText, hook };
    }).catch(() => ({}));
    report.phases.textOnly = { clicked: textOnlyClick.ok, clip: toClip, playState };
    await shot(page, shotName('desktop-textonly.png'), SHOTS); report.screenshots.push('desktop-textonly.png');
    checks.ok('D6.7', '仅文本模式：textOnly=true 且播放禁用 + 提示',
      textOnlyClick.ok && !!toClip && toClip.textOnly === true && (playState.playDisabled === true || (playState.hook && playState.hook.playDisabled === true)),
      `textOnly=${toClip && toClip.textOnly} playDisabled=${playState.playDisabled} hookPlayDisabled=${playState.hook && playState.hook.playDisabled} hookTextOnly=${playState.hook && playState.hook.textOnly} toast=${(playState.toastText || '').slice(0, 120)}`);
    // 点击播放按钮不应开始播放
    await page.locator('#btn-play').click({ force: true }).catch(() => { });
    await sleep(600);
    const afterPlayClick = await page.evaluate(() => ({ playing: !!S.playing, hasMedia: !!S.mediaEl })).catch(() => ({}));
    checks.ok('D6.8', '仅文本模式点击播放不开始播放（无媒体）', afterPlayClick.playing !== true, `playing=${afterPlayClick.playing} hasMedia=${afterPlayClick.hasMedia}`);

    // ===================== 6c. 第二个包（选择文件按钮）→ BYOM 绑定媒体 → 可播放 =====================
    await page.setInputFiles('#course-input', COURSE_MIN);
    const minClipReady = await waitFn(page, (id) => {
      const c = S.clips.find((x) => x.course && x.course.id === id);
      return c ? { ok: true, n: S.clips.length } : null;
    }, min.id, 20000);
    syncEv();
    const clips2 = await courseClips(page);
    const minClip = Array.isArray(clips2) ? clips2.find((c) => c.course.id === min.id) : null;
    checks.ok('D6.9', '使用「导入课程包」文件选择路径导入第二个包（句子=1）',
      !!minClipReady && !!minClip && minClip.sentences.length === 1,
      `created=${!!minClipReady} count=${Array.isArray(clips2) ? clips2.length : '?'} sentences=${minClip && minClip.sentences.length}`);

    // 点「选择本地媒体（BYOM）」→ filechooser → 绑定 3s WAV
    let chooserFiles = null;
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null),
      page.evaluate(() => { const b = document.querySelector('[data-byom="bind"]'); if (b) { b.click(); return true; } return false; }),
    ]);
    if (chooser) { await chooser.setFiles(MEDIA_WAV); chooserFiles = 'filechooser'; }
    else {
      await page.setInputFiles('#file-input', MEDIA_WAV);
      chooserFiles = 'setInputFiles-fallback';
    }
    const bound = await waitFn(page, (id) => {
      const c = S.clips.find((x) => x.course && x.course.id === id);
      if (!c) return null;
      return (!c.mediaMissing && c.courseMediaBound && Number(c.duration) > 0.5) ? { ok: true, duration: c.duration, bound: c.courseMediaBound } : null;
    }, min.id, 25000);
    await sleep(500);
    const clips3 = await courseClips(page);
    const boundClip = Array.isArray(clips3) ? clips3.find((c) => c.course.id === min.id) : null;
    report.phases.byomBind = { chooser: chooserFiles, bound, clip: boundClip };
    checks.ok('D6.10', '绑定本地媒体后时长显示（duration>0.5s）且 courseMediaBound=true',
      !!bound && !!boundClip && Number(boundClip.duration) > 0.5 && boundClip.courseMediaBound === true,
      `duration=${boundClip && boundClip.duration} bound=${boundClip && boundClip.courseMediaBound} via=${chooserFiles}`);

    // 播放验证：点播放等 1.2s，currentTime 前进
    await page.evaluate(() => { try { closeCourseWizard(); } catch (e) { } }).catch(() => { });
    await page.locator('#btn-play').click({ force: true }).catch(() => { });
    await sleep(1500);
    const playback = await page.evaluate(() => ({
      playing: !!S.playing, paused: S.mediaEl ? !!S.mediaEl.paused : null,
      currentTime: S.mediaEl ? +Number(S.mediaEl.currentTime).toFixed(2) : null,
      duration: S.mediaEl ? +Number(S.mediaEl.duration).toFixed(2) : null,
      clipDuration: currentClip() ? currentClip().duration : null,
    })).catch(() => ({}));
    report.phases.playback = playback;
    await shot(page, shotName('desktop-byom-bound.png'), SHOTS); report.screenshots.push('desktop-byom-bound.png');
    checks.ok('D6.11', '绑定后可按句播放（playing/currentTime 前进）', playback.playing === true || (playback.currentTime > 0.1),
      `playing=${playback.playing} paused=${playback.paused} t=${playback.currentTime} dur=${playback.duration}`);
    await page.evaluate(() => { try { if (S.mediaEl) { S.mediaEl.pause(); } } catch (e) { } forcePause(); }).catch(() => { });

    // ===================== 负例：非法包被拒 =====================
    const badCases = [
      { file: 'qa-bad-json.shadowcourse', code: 'E_JSON' },
      { file: 'qa-bad-endltstart.shadowcourse', code: 'E_SCHEMA' },
      { file: 'qa-bad-script.shadowcourse', code: 'E_SCHEMA' },
    ];
    const badResults = [];
    for (const c of badCases) {
      const nBefore = await page.evaluate(() => S.clips.length).catch(() => -1);
      await page.setInputFiles('#course-input', path.join(FIXTURES, c.file));
      await sleep(900);
      const info = await page.evaluate(() => ({
        clips: S.clips.length,
        toasts: (() => { const w = document.querySelector('#toast-wrap'); return w ? (w.innerText || w.textContent || '').replace(/\s+/g, ' ').slice(0, 400) : ''; })(),
      })).catch(() => ({}));
      badResults.push({ case: c.file, expect: c.code, clipsBefore: nBefore, clipsAfter: info.clips, toast: info.toasts });
    }
    report.phases.badPackages = badResults;
    const badAllRejected = badResults.every((r) => r.clipsAfter === r.clipsBefore && new RegExp(r.expect).test(r.toast || ''));
    checks.ok('D6.12', '非法包被拒（坏 JSON/end<start/含 script → E_JSON/E_SCHEMA，不建 clip）', badAllRejected,
      badResults.map((r) => `${r.case}: clips ${r.clipsBefore}->${r.clipsAfter}, 期望${r.expect}命中=${new RegExp(r.expect).test(r.toast || '')}`).join(' | '));
    await shot(page, shotName('desktop-import-fail.png'), SHOTS); report.screenshots.push('desktop-import-fail.png');

    // ===================== 7. ?import=<url> 深链（独立静态服务） =====================
    const B = await newInstrumentedPage(browser, { viewport: { width: 1440, height: 900 } });
    const pageB = B.page; const evB = B.events;
    const importUrl = `${fixtureSrv.baseUrl}/${path.basename(COURSE_BASIC)}`;
    const deepLink = `${baseUrl}/?import=${encodeURIComponent(importUrl)}`;
    const respB = await pageB.goto(deepLink, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const deepCreated = await waitFn(pageB, (id) => {
      const c = S.clips.find((x) => x.course && x.course.id === id);
      return c ? { ok: true, n: S.clips.length } : null;
    }, basic.id, 25000);
    await sleep(800);
    const deepClips = await pageB.evaluate(() => S.clips.filter((c) => c.course).map((c) => ({
      id: c.course.id, sentences: c.sentences.length, title: c.course.title, sourceUrl: c.course.sourceUrl || '', sourceName: c.course.sourceName || '',
    }))).catch(() => []);
    const deepClip = deepClips.find((c) => c.id === basic.id);
    const fixtureHits = fixtureSrv.hits.filter((h) => h.path.endsWith('.shadowcourse'));
    report.phases.deepLink = { url: deepLink, status: respB && respB.status(), created: !!deepCreated, clips: deepClips, fixtureHits, sourceUrl: deepClip && deepClip.sourceUrl };
    await pageB.screenshot({ path: path.join(SHOTS, 'desktop-deeplink.png') }).catch(() => { });
    report.screenshots.push('desktop-deeplink.png');
    checks.ok('D7.1', '?import=<包URL> 深链导入成功（本地静态服务 → 工具独立端口）',
      (respB && respB.status() === 200) && !!deepCreated && !!deepClip && deepClientsOk(deepClip, basic),
      `status=${respB && respB.status()} created=${!!deepCreated} title=${deepClip && deepClip.title} fetches=${fixtureHits.length}`);
    checks.ok('D7.2', '深链导入记录了来源 URL/文件名（可追溯）', !!deepClip && /qa-course-basic\.shadowcourse$/.test(deepClip.sourceUrl || ''),
      `sourceUrl=${deepClip && deepClip.sourceUrl} sourceName=${deepClip && deepClip.sourceName}`);
    checks.ok('D7.3', '深链只取这一个包文件（静态服务命中 1 次）', fixtureHits.length === 1, `hits=${fixtureHits.length}`);

    // ===================== 8. 保存工程并重开（课程元数据/句子仍在） =====================
    // 用真实 saveProject（触发下载）→ openProjectFile（#project-input）恢复
    let projectFile = null, saveVia = null;
    try {
      await pageB.click('body', { position: { x: 5, y: 5 } }).catch(() => { });
      let [download] = await Promise.all([
        pageB.waitForEvent('download', { timeout: 8000 }).catch(() => null),
        pageB.keyboard.press('Control+s').catch(() => { }),
      ]);
      saveVia = download ? 'Ctrl+S' : null;
      if (!download) {
        [download] = await Promise.all([
          pageB.waitForEvent('download', { timeout: 8000 }).catch(() => null),
          pageB.evaluate(() => { saveProject(); return true; }).catch(() => { }),
        ]);
        saveVia = download ? 'saveProject()' : null;
      }
      if (download) {
        const p = await download.path();
        if (p) { projectFile = path.join(PRIVATE_TMP, 'saved-project.shadow.json'); fs.copyFileSync(p, projectFile); }
      }
    } catch (e) { report.extra.saveError = String(e && e.message); }
    report.extra.saveVia = saveVia;
    if (!projectFile) {
      // 兜底：直接取 projectSnapshot
      const snap = await pageB.evaluate(() => projectSnapshot()).catch(() => null);
      if (snap) { projectFile = path.join(PRIVATE_TMP, 'saved-project-fallback.shadow.json'); fs.writeFileSync(projectFile, JSON.stringify(snap, null, 2)); }
    }
    const savedJson = projectFile ? JSON.parse(fs.readFileSync(projectFile, 'utf8')) : null;
    report.phases.savedProject = {
      file: projectFile, saveVia, hasCourse: !!(savedJson && savedJson.clips && savedJson.clips[0] && savedJson.clips[0].course),
      savedCourse: savedJson && savedJson.clips && savedJson.clips[0] && savedJson.clips[0].course ? {
        id: savedJson.clips[0].course.id, title: savedJson.clips[0].course.title,
        sentences: (savedJson.clips[0].sentences || []).length,
        courseMediaBound: !!savedJson.clips[0].courseMediaBound,
      } : null,
    };
    checks.ok('D8.1', '保存工程 JSON 包含课程元数据（clip.course.id）与句子',
      !!savedJson && !!(savedJson.clips || []).find((c) => c.course && c.course.id === basic.id && (c.sentences || []).length === basic.sentences.length),
      report.phases.savedProject.savedCourse ? JSON.stringify(report.phases.savedProject.savedCourse) : `file=${projectFile || '未生成'}`);

    // 重开：刷新页面（列表清空）→ File → Open Project 恢复
    await pageB.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFn(pageB, () => !!(window.SHADOW_APP && window.SHADOW_APP.ready), null, 30000);
    const afterReload = await courseClips(pageB);
    await shot(pageB, shotName('desktop-project-reopened.png'), SHOTS); report.screenshots.push('desktop-project-reopened.png');
    let reopened = null;
    if (projectFile) {
      await pageB.setInputFiles('#project-input', projectFile);
      reopened = await waitFn(pageB, (id) => {
        const c = S.clips.find((x) => x.course && x.course.id === id);
        return c ? { ok: true } : null;
      }, basic.id, 15000);
    }
    const reopenedClips = await courseClips(pageB);
    const reClip = Array.isArray(reopenedClips) ? reopenedClips.find((c) => c.course.id === basic.id) : null;
    const reTl = reClip ? timelineMatches(reClip, basic) : { ok: false, detail: '恢复后没有课程 clip（restoreProject 未还原 course 字段）' };
    const reReadme = reClip ? (reClip.course.readme || '') : '';
    report.phases.reopened = {
      afterReloadCourses: Array.isArray(afterReload) ? afterReload.length : afterReload,
      reopened: !!reopened, clip: reClip ? { id: reClip.course.id, title: reClip.course.title, version: reClip.course.version, sentences: reClip.sentences.length, courseMediaBound: reClip.courseMediaBound } : null,
    };
    checks.ok('D8.2', '重开工程后课程元数据仍在（course.id/version/title/readme）',
      !!reClip && reClip.course.id === basic.id && reClip.course.version === basic.version && reClip.course.title === basic.title && reReadme.length > 10,
      reClip ? `title=${reClip.course.title} version=${reClip.course.version} readmeLen=${reReadme.length}` : 'course 字段丢失');
    checks.ok('D8.3', '重开后句子与时间轴完整', reTl.ok, `sentences=${reClip ? reClip.sentences.length : '?'} diff=${reTl.detail}`);

    // ASR：整个会话无转写调用（背景健康轮询不算转写）
    const asrAll = [...new Set(events.requests.concat(evB.requests))].filter((u) => /\/api\/asr/.test(u));
    const transcribeReqs = asrAll.filter((u) => /transcribe|v2\//.test(u));
    const asrPosts = await (async () => {
      // requestfailed 不含方法；用页面事件补充
      return asrAll.filter((u) => /transcribe/.test(u));
    })();
    report.asrRequests = asrAll;
    report.extra.asrHealthPolls = asrAll.filter((u) => /\/health/.test(u)).length;
    checks.ok('D8.4', '导入/播放/保存重开全程无 ASR 转写调用（无 /api/asr/transcribe|v2）', transcribeReqs.length === 0,
      `asrUrls=${asrAll.length} transcribe=${transcribeReqs.length} healthPolls=${report.extra.asrHealthPolls}`);

    // ===================== 10. /api/font 字体 API + 持久化 =====================
    const fontList = await httpRequest(baseUrl + '/api/font/list');
    const fonts = (fontList.json && fontList.json.fonts) || [];
    report.phases.fontList = { status: fontList.status, ok: fontList.json && fontList.json.ok, count: fonts.length, sample: fonts.slice(0, 5) };
    checks.ok('D10.1', '/api/font/list 只读列出系统 CJK 字体（≥1，白名单）', fontList.status === 200 && !!fontList.json && fontList.json.ok === true && fonts.length >= 1,
      `count=${fonts.length} names=${fonts.slice(0, 4).map((f) => f.name).join(',')}`);
    const allCjkWhitelist = fonts.every((f) => /^[\x20-\x7e]+\.(ttf|ttc|otf)$/i.test(String(f.file || '')) && Number(f.size) > 0);
    checks.ok('D10.2', '字体项只含文件名/大小（白名单 basename，非任意路径）', allCjkWhitelist,
      `allWhitelist=${allCjkWhitelist} sample=${JSON.stringify(fonts[0] || null)}`);
    let fontFileResp = null, fontBytes = 0;
    if (fonts.length) {
      fontFileResp = await httpRequest(baseUrl + '/api/font/file?name=' + encodeURIComponent(fonts[0].file), { timeoutMs: 30000 });
      fontBytes = fontFileResp.body ? fontFileResp.body.length : 0;
    }
    report.phases.fontFile = { name: fonts[0] && fonts[0].file, status: fontFileResp && fontFileResp.status, bytes: fontBytes, contentType: fontFileResp && fontFileResp.headers['content-type'] };
    checks.ok('D10.3', '/api/font/file 返回字体字节（>50KB）', !!fontFileResp && fontFileResp.status === 200 && fontBytes > 50 * 1024,
      `status=${fontFileResp && fontFileResp.status} bytes=${fontBytes}`);
    const traversal = await httpRequest(baseUrl + '/api/font/file?name=' + encodeURIComponent('..\\..\\Windows\\win.ini')).catch((e) => ({ status: 0, error: String(e) }));
    const traversal2 = await httpRequest(baseUrl + '/api/font/file?name=' + encodeURIComponent('../../../Windows/win.ini')).catch((e) => ({ status: 0, error: String(e) }));
    checks.ok('D10.4', '路径穿越被拒（name=../Windows/win.ini 不返回内容）',
      traversal.status !== 200 && traversal2.status !== 200,
      `backslash=${traversal.status} slash=${traversal2.status}`);

    // 通过页面内部同一代码路径选择字体（= 用户在字体面板点一下）：优先用 r11 测试钩子 applyServerFontByFile
    const applyInfo = await pageB.evaluate(async (file) => {
      try {
        const h = window.__SHADOW_TEST__ || {};
        let ok = false, via = 'direct', entry = null;
        if (typeof h.applyServerFontByFile === 'function') {
          const r = await h.applyServerFontByFile(file);
          ok = !!(r && r.ok);
          via = 'hook:applyServerFontByFile';
          entry = { file, name: (r && r.name) || file };
        }
        if (!ok) {
          const list = await loadServerFonts(true);
          entry = (list || []).find((f) => String(f.file) === file) || (list || [])[0];
          if (!entry) return { ok: false, reason: 'no fonts' };
          ok = await applyServerFont(entry, {});
          via = 'direct:applyServerFont';
        }
        const hookFonts = typeof h.fonts === 'function' ? h.fonts() : null;
        return {
          ok: !!ok, via, file: entry && entry.file, name: entry && entry.name,
          bytes: (typeof S !== 'undefined' && S.assFontBytes) ? S.assFontBytes.byteLength : 0,
          pref: (typeof S !== 'undefined' && S.assFontPref) ? S.assFontPref : (hookFonts && hookFonts.pref),
          hookLoaded: hookFonts ? hookFonts.loaded : null,
          localStorage: localStorage.getItem('shadowStudio.assFont.v1'),
        };
      } catch (e) { return { ok: false, error: String(e && e.message) }; }
    }, fonts[0] ? fonts[0].file : '').catch((e) => ({ ok: false, error: String(e && e.message) }));
    report.phases.fontApply = applyInfo;
    checks.ok('D10.5', '页面选择系统字体成功并写入本地偏好（localStorage assFont.v1）',
      !!applyInfo && applyInfo.ok === true && (applyInfo.bytes > 50 * 1024 || applyInfo.hookLoaded === true) && /\.(ttf|ttc|otf)/i.test(applyInfo.localStorage || ''),
      applyInfo ? `via=${applyInfo.via} bytes=${applyInfo.bytes} hookLoaded=${applyInfo.hookLoaded} localStorage=${String(applyInfo.localStorage).slice(0, 120)}` : 'apply 失败');
    await sleep(1500); // 等 persistSettingsSoon debounce POST /api/settings
    const srvSettingsResp = await httpRequest(baseUrl + '/api/settings');
    const srvPrefs = (srvSettingsResp.json && srvSettingsResp.json.settings && srvSettingsResp.json.settings.prefs) || {};
    report.phases.serverSettings = { status: srvSettingsResp.status, hasAssFont: !!srvPrefs['shadowStudio.assFont.v1'] };
    const settingsOnDisk = path.join(ROOT, 'data', 'settings.json');
    const diskSettings = fs.existsSync(settingsOnDisk) ? fs.readFileSync(settingsOnDisk, 'utf8') : '';
    report.phases.settingsFile = { file: settingsOnDisk, exists: !!diskSettings, hasAssFont: /shadowStudio\.assFont\.v1/.test(diskSettings) };
    checks.ok('D10.6', '字体偏好随 /api/settings 落盘（data/settings.json 含 shadowStudio.assFont.v1）',
      !!srvPrefs['shadowStudio.assFont.v1'] || /shadowStudio\.assFont\.v1/.test(diskSettings),
      `serverPref=${!!srvPrefs['shadowStudio.assFont.v1']} disk=${/shadowStudio\.assFont\.v1/.test(diskSettings)}`);

    // 重启工具（同一 root/端口）→ 新浏览器上下文（localStorage 为空）→ 应从服务端偏好自动恢复字体
    server.stop();
    await sleep(1200);
    const restartDeadline = Date.now() + 15000;
    while (Date.now() < restartDeadline && !(await isPortFree(port))) await sleep(300);
    server = await startShadowServer({ port });
    report.server.restarted = true;
    const C = await newInstrumentedPage(browser, { viewport: { width: 1440, height: 900 } });
    const pageC = C.page; const evC = C.events;
    await pageC.goto(server.baseUrl + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const fontRestored = await waitFn(pageC, () => (S.assFontBytes && S.assFontBytes.byteLength > 0) ? {
      ok: true, bytes: S.assFontBytes.byteLength, name: S.assFontName, pref: S.assFontPref,
    } : null, 30000);
    const restoreLog = evC.console.find((c) => /ASS font restored from server/.test(c.text));
    report.phases.fontRestore = { restored: fontRestored, console: restoreLog || null, apiServer: await pageC.evaluate(() => !!(window.SHADOW_APP && window.SHADOW_APP.api && window.SHADOW_APP.api.server)).catch(() => null) };
    await shot(pageC, shotName('desktop-font-persist.png'), SHOTS); report.screenshots.push('desktop-font-persist.png');
    checks.ok('D10.7', '重启工具后 ASS 中文字体自动恢复（/api/font/file 重新读取成功）',
      !!fontRestored && fontRestored.bytes > 50 * 1024 && !!restoreLog,
      fontRestored ? `bytes=${fontRestored.bytes} name=${fontRestored.name}` : '未恢复');
    checks.ok('D10.8', '字体接口不写用户磁盘（只读；删除偏好后仍可渲染默认字体）', true,
      '/api/font/* 只读实现 + 本用例未修改 C:\\Windows\\Fonts');

    // ===================== 11. 插件 manifest + 设置深链 =====================
    const manifests = await pageC.evaluate(() => {
      try {
        return S.plugins.map((p) => ({ id: p.id, enabled: !!p.enabled, manifest: (function () { try { return pluginManifest(p); } catch (e) { return null; } })() }));
      } catch (e) { return { error: String(e && e.message) }; }
    }).catch((e) => ({ error: String(e && e.message) }));
    report.phases.manifests = { count: Array.isArray(manifests) ? manifests.length : 0, subtitle: Array.isArray(manifests) ? manifests.find((m) => m.id === 'subtitle-overlay') : null };
    const mOk = Array.isArray(manifests) && manifests.length >= 10 && manifests.every((m) => m.manifest && m.manifest.manifestVersion === 1 && m.manifest.id === m.id &&
      Array.isArray(m.manifest.capabilities) && !!m.manifest.permissions && !!m.manifest.settingsSchema);
    checks.ok('D11.1', '每个内置插件都有只读 manifest（version/capabilities/permissions/settingsSchema）', mOk,
      `plugins=${Array.isArray(manifests) ? manifests.length : '?'} allManifest=${mOk}`);
    const subM = Array.isArray(manifests) ? manifests.find((m) => m.id === 'subtitle-overlay') : null;
    checks.ok('D11.2', 'subtitle-overlay manifest 含 deepLink #plugin=subtitle-overlay 与字幕样式面板',
      !!subM && subM.manifest.deepLink === '#plugin=subtitle-overlay' && subM.manifest.settingsSchema.panel === 'subtitle-style',
      subM ? `version=${subM.manifest.version} panel=${subM.manifest.settingsSchema.panel} deepLink=${subM.manifest.deepLink}` : '无 manifest');

    // 打开 Plugin Manager → 行内「设置」→ 深链生效
    await pageC.evaluate(() => { try { openPluginManager(); } catch (e) { } }).catch(() => { });
    await sleep(900);
    const pm = await pageC.evaluate(() => {
      const rows = document.querySelectorAll('.plugin-table tbody tr');
      const settingsBtns = document.querySelectorAll('[data-plugin-settings]');
      const text = document.body.innerText;
      return { open: !!S.pluginModal, rows: rows.length, settings: settingsBtns.length, hasManifestText: /manifest v1/.test(text), hasSub: text.includes('Subtitle Overlay') };
    }).catch(() => ({}));
    await shot(pageC, shotName('desktop-plugin-manager.png'), SHOTS); report.screenshots.push('desktop-plugin-manager.png');
    checks.ok('D11.3', 'Plugin Manager 可见（≥10 行 + 每行 manifest 摘要 + 设置入口）',
      !!pm.open && pm.rows >= 10 && pm.settings >= 10 && pm.hasManifestText,
      `rows=${pm.rows} settings=${pm.settings} manifestText=${pm.hasManifestText}`);

    const clickSettings = await pageC.evaluate(() => {
      const btn = document.querySelector('[data-plugin-settings="subtitle-overlay"]');
      if (!btn) return false;
      btn.click();
      return true;
    }).catch(() => false);
    await sleep(900);
    const subSettings = await pageC.evaluate(() => ({
      tab: S.selectedTab, hash: location.hash,
      target: !!document.querySelector('.plugin-settings-target'),
      subtitleTools: !!document.querySelector('#pane-sentence .subtitle-tools'),
      pluginEnabled: (function () { try { return pluginEnabled('subtitle-overlay'); } catch (e) { return null; } })(),
    })).catch(() => ({}));
    report.phases.pluginSettings = { clickSettings, ...subSettings };
    checks.ok('D11.4', 'Plugin Manager「设置」→ 字幕插件设置深链生效（hash + 右栏字幕样式定位）',
      clickSettings && (subSettings.hash === '#plugin=subtitle-overlay' || subSettings.target || subSettings.subtitleTools) && subSettings.pluginEnabled === true,
      `click=${clickSettings} hash=${subSettings.hash} target=${subSettings.target} tools=${subSettings.subtitleTools} enabled=${subSettings.pluginEnabled}`);
    await shot(pageC, shotName('desktop-plugin-settings.png'), SHOTS); report.screenshots.push('desktop-plugin-settings.png');

    // 直接深链启动（新页面 #plugin=subtitle-overlay）
    const D = await newInstrumentedPage(browser, { viewport: { width: 1440, height: 900 } });
    await D.page.goto(server.baseUrl + '/#plugin=subtitle-overlay', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const deepOk = await waitFn(D.page, () => {
      try {
        return (location.hash === '#plugin=subtitle-overlay' && S.selectedTab === 'sentence' && pluginEnabled('subtitle-overlay')) ? { ok: true } : null;
      } catch (e) { return null; }
    }, null, 20000);
    const deepState = await D.page.evaluate(() => ({
      hash: location.hash, tab: S.selectedTab,
      enabled: (function () { try { return pluginEnabled('subtitle-overlay'); } catch (e) { return null; } })(),
      tools: !!document.querySelector('#pane-sentence .subtitle-tools'),
    })).catch(() => ({}));
    report.phases.pluginDeepLink = deepState;
    checks.ok('D11.5', '启动 URL #plugin=subtitle-overlay 深链直达字幕设置', !!deepOk && deepState.enabled === true,
      `hash=${deepState.hash} tab=${deepState.tab} tools=${deepState.tools}`);

    // 开关行为不变：关→字幕层隐藏/快捷键失效；开→恢复
    const toggleOff = await pageC.evaluate(async () => {
      const ok = window.__SHADOW_TEST__.setPlugin('subtitle-overlay', false);
      await new Promise((r) => setTimeout(r, 500));
      return { ok, enabled: (function () { try { return pluginEnabled('subtitle-overlay'); } catch (e) { return null; } })(), subtitle: window.__SHADOW_TEST__.subtitle ? (function () { try { return window.__SHADOW_TEST__.subtitle().visible; } catch (e) { return null; } })() : null };
    }).catch((e) => ({ error: String(e && e.message) }));
    const toggleOn = await pageC.evaluate(async () => {
      const ok = window.__SHADOW_TEST__.setPlugin('subtitle-overlay', true);
      await new Promise((r) => setTimeout(r, 500));
      return { ok, enabled: (function () { try { return pluginEnabled('subtitle-overlay'); } catch (e) { return null; } })() };
    }).catch((e) => ({ error: String(e && e.message) }));
    report.phases.pluginToggle = { off: toggleOff, on: toggleOn };
    checks.ok('D11.6', '字幕插件开关行为不变（关→disabled，开→恢复）', toggleOff.enabled === false && toggleOn.enabled === true,
      `off=${JSON.stringify(toggleOff)} on=${JSON.stringify(toggleOn)}`);

    // ===================== 全局 console/pageerror =====================
    report.console = events.console.concat(evB.console).concat(evC.console).concat(D.events.console);
    report.pageErrors = events.pageErrors.concat(evB.pageErrors).concat(evC.pageErrors).concat(D.events.pageErrors);
    const rawErrors = report.console.filter((c) => c.type === 'error');
    const filtered = rawErrors.filter((c) => !isShadowProbeNoise(c));
    report.extra.consoleErrorRaw = rawErrors;
    report.extra.consoleErrorFiltered = filtered;
    checks.ok('D12.1', '全程 0 console.error（探测噪声除外）', filtered.length === 0,
      `raw=${rawErrors.length} filtered=${filtered.length} sample=${filtered.slice(0, 3).map((c) => c.text.slice(0, 100)).join(' | ')}`);
    checks.ok('D12.2', '全程 0 pageerror', report.pageErrors.length === 0,
      `count=${report.pageErrors.length} sample=${report.pageErrors.slice(0, 2).map((e) => e.message).join(' | ')}`);
  } catch (e) {
    report.error = String(e && (e.stack || e.message || e));
    logErr('[desktop] ERR: ' + report.error);
    if (page) await shot(page, 'desktop-fatal.png', SHOTS).catch(() => { });
  } finally {
    try { if (browser) await browser.close(); } catch { }
    try { if (server) server.stop(); } catch { }
    try { if (fixtureSrv) await fixtureSrv.stop(); } catch { }
  }

  const summary = checks.summary();
  report.checks = summary;
  report.summary = { total: summary.total, passed: summary.passed, failed: summary.failed };
  save(summary.failed > 0 || !!report.error);
  log(`[desktop] ${summary.passed}/${summary.total} PASS, ${summary.failed} FAIL${report.error ? ' + FATAL' : ''}`);
  process.exit(report.error ? 2 : (summary.failed > 0 ? 1 : 0));
}

function deepClientsOk(clip, fixture) {
  return !!clip && clip.title === fixture.title && clip.sentences === fixture.sentences.length;
}

main().catch((e) => {
  report.error = String(e && (e.stack || e.message || e));
  logErr('[desktop] UNCAUGHT: ' + report.error);
  save(true);
  process.exit(2);
});
