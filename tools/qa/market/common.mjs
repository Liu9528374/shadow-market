/**
 * common.mjs - r11 市场/桌面独立验证公共工具（qa-verify 范围：tools/qa/market/**）
 * 只读产品代码，不启动用户正在用的进程，不碰用户数据。
 *
 * 约定：
 * - 测试 root 用 tools/qa/v07/.tmp/r11-verify*；端口避开 18765..18775 / 8765 / 18920。
 * - Playwright 从 tools/qa/node_modules 解析；Edge 固定路径。
 * - 截图/报告落 tools/qa/market/shots 与 tools/qa/market/*.json。
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MARKET_QA_DIR = __dirname;
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
export const MARKET_DIR = path.join(REPO_ROOT, 'market');
export const SHOTS_DIR = path.join(__dirname, 'shots');
export const NODE = 'D:\\NODE\\node.exe';

/* ---------- 环境常量（与 docs/50 §4 一致） ---------- */
export const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
export const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
export const USER_PKG_ROOT = 'C:\\Users\\A pig\\OneDrive\\桌面\\SHADOW-Studio-0.7.0'; // 只读，绝不修改
export const DEFAULT_MARKET_URL = 'http://127.0.0.1:18920';
/** 用户/测试常占用端口，本 QA 不自用 */
export const RESERVED_PORTS = [18765, 18766, 18767, 18768, 18769, 18770, 18771, 18772, 18773, 18774, 18775, 8765, 18920];
/** 市场一键导入探测的端口段（docs/52 §4） */
export const SHADOW_PORT_RANGE = { from: 18765, to: 18775 };

/* ---------- 基础 ---------- */
export function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
export function log(...a) { console.log(...a); }
export function logErr(...a) { console.error(...a); }
export function nowIso() { return new Date().toISOString(); }

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

export function hasMarket() {
  return fs.existsSync(path.join(MARKET_DIR, 'index.html'));
}

export function readJsonFile(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJsonReport(file, obj) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
  log(`report -> ${file}`);
}

/** playwright-core 动态解析（从 tools/qa/node_modules） */
export function loadPlaywright() {
  const require = createRequire(path.join(__dirname, 'x.js'));
  return require('playwright-core');
}

export function findBrowser(prefer = 'edge') {
  const list = prefer === 'chrome'
    ? [{ name: 'chrome', path: CHROME }, { name: 'edge', path: EDGE }]
    : [{ name: 'edge', path: EDGE }, { name: 'chrome', path: CHROME }];
  for (const b of list) {
    if (fs.existsSync(b.path)) return b;
  }
  return null;
}

/* ---------- 端口 ---------- */
export function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

/** 从 start 起找空闲端口，且避开保留端口 */
export async function findFreePort(start = 18930, tries = 60) {
  for (let p = start; p < start + tries; p++) {
    if (RESERVED_PORTS.includes(p)) continue;
    if (await isPortFree(p)) return p;
  }
  throw new Error(`找不到空闲端口（从 ${start} 起试了 ${tries} 个）`);
}

export function waitTcp(port, host = '127.0.0.1', timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (function attempt() {
      const sock = net.connect(port, host);
      sock.setTimeout(1000);
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      const retry = () => {
        sock.destroy();
        if (Date.now() > deadline) return reject(new Error(`等待 127.0.0.1:${port} 超时 ${timeoutMs}ms`));
        setTimeout(attempt, 200);
      };
      sock.once('error', retry);
      sock.once('timeout', retry);
    })();
  });
}

export function killTree(proc) {
  if (!proc || !proc.pid) return;
  try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { }
}

/* ---------- HTTP ---------- */
export async function httpRequest(url, { method = 'GET', headers = {}, timeoutMs = 20000, followRedirect = true } = {}) {
  const t0 = Date.now();
  const res = await fetch(url, { method, headers, signal: AbortSignal.timeout(timeoutMs), redirect: followRedirect ? 'follow' : 'manual' });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('utf8');
  let json = null;
  try { json = JSON.parse(text); } catch { }
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: buf, text, json, elapsedMs: Date.now() - t0, url };
}

export async function waitHttpOk(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const r = await httpRequest(url, { timeoutMs: 3000 });
      if (r.status >= 200 && r.status < 500) return r;
      last = `status=${r.status}`;
    } catch (e) { last = String(e && (e.message || e)); }
    await sleep(250);
  }
  throw new Error(`等待 ${url} 可访问超时：${last}`);
}

/* ---------- 市场静态服务 ---------- */
/**
 * 复用已启动的市场服务（默认 127.0.0.1:18920），否则用 market/serve.mjs 在独立空闲端口起一个。
 * 返回 { baseUrl, port, proc, logFile, reused, stop() }
 */
export async function ensureMarketServer({ baseUrl = null, port = null, serveScript = null, reuseDefault = false } = {}) {
  const candidates = [];
  if (baseUrl) candidates.push(baseUrl);
  if (!baseUrl && reuseDefault) {
    try {
      const r = await httpRequest(DEFAULT_MARKET_URL + '/', { timeoutMs: 1500 });
      if (r.status === 200) candidates.push(DEFAULT_MARKET_URL);
    } catch { /* 市场服务未起 */ }
  }
  for (const b of candidates) {
    const r = await httpRequest(b.replace(/\/$/, '') + '/index.html', { timeoutMs: 3000 }).catch(() => null);
    if (r && r.status === 200) return { baseUrl: b.replace(/\/$/, ''), port: new URL(b).port ? +new URL(b).port : 80, proc: null, reused: true, stop() { } };
  }
  if (baseUrl) throw new Error(`--base-url=${baseUrl} 不可访问（市场服务没起来？）`);
  const script = serveScript || path.join(MARKET_DIR, 'serve.mjs');
  if (!fs.existsSync(script)) throw new Error(`market/serve.mjs 不存在，市场 Web 尚未交付（缺 ${script}）`);
  const p = port || await findFreePort(18930);
  const logFile = path.join(process.env.TEMP || 'C:\\Windows\\Temp', `market-qa-${p}.log`);
  const out = fs.openSync(logFile, 'w');
  const proc = spawn(NODE, [script, '--port', String(p), '--host', '127.0.0.1'], {
    cwd: MARKET_DIR, stdio: ['ignore', out, out], windowsHide: true,
  });
  const stop = () => { try { fs.closeSync(out); } catch { } killTree(proc); };
  try {
    await waitTcp(p, '127.0.0.1', 20000);
    const r = await waitHttpOk(`http://127.0.0.1:${p}/index.html`, 20000);
    if (r.status !== 200) throw new Error(`index.html status=${r.status}`);
  } catch (e) {
    const logTxt = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').slice(-3000) : '';
    stop();
    throw new Error(`market/serve.mjs 启动失败（port=${p}）：${e.message}\n--- serve log ---\n${logTxt}`);
  }
  return { baseUrl: `http://127.0.0.1:${p}`, port: p, proc, logFile, reused: false, stop };
}

/* ---------- 断言收集 ---------- */
export function makeChecks(title) {
  const checks = [];
  const api = {
    title,
    checks,
    ok(id, name, cond, detail = '', screenshot = null) {
      const entry = { id, name, pass: !!cond, detail: String(detail), screenshot, at: nowIso() };
      checks.push(entry);
      const mark = cond ? 'PASS' : 'FAIL';
      log(`  [${mark}] ${id} ${name}${detail ? ' :: ' + detail : ''}`);
      return !!cond;
    },
    summary() {
      const passed = checks.filter((c) => c.pass).length;
      const failed = checks.length - passed;
      log(`  ---- ${title}: ${passed}/${checks.length} PASS, ${failed} FAIL`);
      return { title, total: checks.length, passed, failed, checks };
    },
  };
  return api;
}

/* ---------- 浏览器 ---------- */
export const LAUNCH_ARGS = [
  '--no-first-run', '--no-default-browser-check', '--mute-audio',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  '--window-position=-2000,-2000',
];

export async function launchEdge({ headless = true, args = null } = {}) {
  const pw = loadPlaywright();
  const bi = findBrowser('edge');
  if (!bi) throw new Error('本机找不到 Edge/Chrome');
  const browser = await pw.chromium.launch({
    executablePath: bi.path, headless, args: args || LAUNCH_ARGS, timeout: 60000,
  });
  return { browser, browserInfo: { name: bi.name, path: bi.path, version: browser.version(), headless } };
}

/** 新建 context + page，挂 console/pageerror/requestfailed 收集器 */
export async function newInstrumentedPage(browser, { viewport = { width: 1440, height: 900 }, permissions = [], extraHeaders = null } = {}) {
  const context = await browser.newContext({ viewport, permissions });
  if (extraHeaders) await context.setExtraHTTPHeaders(extraHeaders);
  const page = await context.newPage();
  const events = { console: [], pageErrors: [], requestFailures: [], requests: [] };
  page.on('console', (m) => {
    let loc = null;
    try { const l = m.location(); loc = l && l.url ? `${l.url}:${l.lineNumber || 0}` : null; } catch { }
    events.console.push({ type: m.type(), text: m.text(), location: loc, at: nowIso() });
  });
  page.on('pageerror', (e) => events.pageErrors.push({ message: e.message, stack: e.stack, at: nowIso() }));
  page.on('requestfailed', (req) => events.requestFailures.push({ url: req.url(), error: req.failure() && req.failure().errorText, at: nowIso() }));
  page.on('request', (req) => events.requests.push(req.url()));
  return { context, page, events };
}

/** 截图并返回路径（失败不抛） */
export async function shot(page, name, shotsDir = SHOTS_DIR) {
  ensureDir(shotsDir);
  const file = path.join(shotsDir, name);
  try { await page.screenshot({ path: file, fullPage: false }); return file; } catch { return null; }
}

export function consoleErrorsOf(events) {
  return events.console.filter((c) => c.type === 'error');
}

/** 过滤掉"探测本地服务端口失败"造成的浏览器网络噪声（import 降级路径的预期噪声） */
export function isShadowProbeNoise(entry) {
  const s = `${entry.text || ''} ${entry.location || ''}`;
  if (/127\.0\.0\.1:187[6-7]\d/.test(s)) return true;
  return /Failed to load resource: net::ERR_CONNECTION_REFUSED|net::ERR_CONNECTION_REFUSED|net::ERR_FAILED|net::ERR_ABORTED/i.test(s);
}

/* ---------- 页面小工具 ---------- */
/** 依次尝试多个选择器，返回第一个匹配元素数量 */
export async function countAny(page, selectors) {
  for (const sel of selectors) {
    try {
      const n = await page.locator(sel).count();
      if (n > 0) return { n, selector: sel };
    } catch { }
  }
  return { n: 0, selector: null };
}

/** 在候选选择器中找到可见元素并点击；返回 {ok, selector} */
export async function clickAny(page, selectors, { timeout = 4000 } = {}) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count() === 0) continue;
      if (!(await loc.isVisible().catch(() => false))) continue;
      await loc.click({ timeout });
      return { ok: true, selector: sel };
    } catch { }
  }
  return { ok: false, selector: null };
}

/** 深度遍历可见文本判断包含 */
export async function bodyText(page) {
  return await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
}

/** hash 直达（同页内改 hash 并等渲染） */
export async function gotoHash(page, baseUrl, hash, { timeout = 15000 } = {}) {
  await page.goto(baseUrl + '/' + hash, { waitUntil: 'domcontentloaded', timeout });
  await sleep(500);
}

/** 统计页面里指向资源详情卡片的链接（GitHub repo 卡式：a[href*="#/resource/"]）
 *  优先市场实现的稳定选择器 [data-testid="resource-card"][data-resource-id]，回退链接启发式。 */
export async function resourceCardLinks(page) {
  return await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const cardIds = [...new Set([...document.querySelectorAll('[data-testid="resource-card"]')]
      .filter(vis).map((c) => c.getAttribute('data-resource-id')).filter(Boolean))];
    if (cardIds.length) return cardIds;
    const set = new Map();
    document.querySelectorAll('a[href*="#/resource/"]').forEach((a) => {
      const h = a.getAttribute('href') || '';
      const m = h.match(/#\/resource\/([^/?#]+)/);
      if (!m) return;
      const r = a.getBoundingClientRect();
      if (!vis(a)) return;
      const prev = set.get(m[1]);
      // 保留面积最大的链接作为卡片主链接
      if (!prev || r.width * r.height > prev.area) set.set(m[1], { id: m[1], area: r.width * r.height, href: h });
    });
    return [...set.values()].map((v) => v.id);
  });
}

/** 是否有横向溢出；返回 {overflow, offenders:[{tag,cls,right,width}]} */
export async function horizontalOverflow(page) {
  return await page.evaluate(() => {
    const vw = window.innerWidth;
    const de = document.documentElement;
    const docOverflow = Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0) > vw + 1;
    const offenders = [];
    const all = document.querySelectorAll('body *');
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > vw + 1 || r.left < -1) {
        offenders.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 80), left: +r.left.toFixed(1), right: +r.right.toFixed(1) });
        if (offenders.length >= 10) break;
      }
    }
    return { overflow: docOverflow || offenders.length > 0, docOverflow, offenders, vw, scrollWidth: Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0) };
  });
}
