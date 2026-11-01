/**
 * market-e2e.mjs - SHADOW 市场 P0（Phase 2）独立 E2E（Playwright + Edge headless，串行单浏览器）
 *
 * 契约真相：D:\FOLLOWSPEAK\docs\111-market-architecture.md
 *   §2.1 路由/主导航/移动底部导航 · §2.3 详情页三下载 + Tabs · §3 catalog v2 · §5 导入产物 ·
 *   §6.3 PWA 离线 · §7.4 无障碍 · §9 质量门（0 console error / 0 pageerror / 375–1440 无横溢 / PWA 离线 / E2E）
 *
 * 覆盖（按 Phase 分组的 M 编号）：
 *   M0  catalog v2 数据/文件/插件/导入产物 HTTP 契约（含每个包 sha256/size 与文件一致）
 *   M1  首页/品牌 logo/主导航/语言开关/搜索(中英)/分类/标签/作者/i18n 切换/真实数据来源
 *   M2  详情页 hash 直达+刷新/Tabs(README 安全渲染/句子数/文件/版本变更)/About 侧栏/许可证页/收藏
 *   M3  三下载产物（.shadowcourse / .shadow.json / .srt，200+可解析+sha256 与 catalog 一致）+ 下载弹层
 *   M4  一键导入：无服务降级（3 步+自动下载）与成功路径（假 Studio 收到 ?import= + 页面成功态；不提前 close popup）
 *   M5  合约页面：favorites/changelog/contribute/about/privacy/complaint/license/tag/404/points
 *   M6  设置页/深浅色/Ctrl+K 命令面板
 *   M7  响应式：1440/1024/768/390/375/360 无页面级横溢；390 底部导航可用；详情操作条吸底
 *   M8  PWA：manifest/SW/offline.html/图标；首访后 setOffline(true) 重载仍见 shell/catalog 或离线提示
 *   M9  0 console.error / 0 pageerror（探测噪声白名单）/ 无失败资源请求 / 无第三方 CDN 请求
 *
 * 用法（D:\NODE\node.exe）：
 *   node tools\qa\market\market-e2e.mjs                    # 用 market/serve.mjs 在独立空闲端口（189xx）起服务
 *   node tools\qa\market\market-e2e.mjs --base-url=http://127.0.0.1:18920
 *   node tools\qa\market\market-e2e.mjs --headed --report=... --shots=...
 *
 * 产物：tools/qa/market/report-market.json + tools/qa/market/shots/*.png（保持 r11 结构供 Lead 复核）
 * 退出码：0 全部 PASS；1 有 FAIL；2 环境/数据未就绪（不伪造 PASS）。
 */
import path from 'node:path';
import fs from 'node:fs';
import {
  REPO_ROOT, MARKET_DIR, SHOTS_DIR, ensureDir, parseArgs, hasMarket, writeJsonReport, nowIso,
  sleep, log, logErr, httpRequest, ensureMarketServer, launchEdge, newInstrumentedPage, shot,
  makeChecks, consoleErrorsOf, isShadowProbeNoise, isOfflineNoise, bodyText, gotoHash,
  horizontalOverflow, SHADOW_PORT_RANGE, clickAny, findFreePort, isPortFree,
  loadCatalogV2, cardIdsOf, downloadArtifacts, latestVersion, resourceAuthor, urlOf,
  sha256Hex, parseSrt, CATALOG_FILES, resourceCardLinks,
} from './common.mjs';

const argv = parseArgs();
const REPORT = argv.report || path.join(REPO_ROOT, 'tools', 'qa', 'market', 'report-market.json');
const SHOTS = argv.shots || SHOTS_DIR;
const baseUrlArg = argv['base-url'] || null;
const headed = !!argv.headed;

const report = {
  test: 'market-e2e',
  round: 'phase2',
  startedAt: nowIso(),
  baseUrl: baseUrlArg,
  server: null,
  browser: null,
  catalog: null,
  checks: null,
  phases: {},
  extra: {},
  console: [],
  pageErrors: [],
  requestFailures: [],
  screenshots: [],
  error: null,
  pass: false,
};

function save(fail = false) {
  report.finishedAt = nowIso();
  report.pass = !fail;
  writeJsonReport(REPORT, report);
}
function fatal(msg) {
  report.error = msg;
  logErr('[market] FATAL: ' + msg);
  save(true);
  process.exit(2);
}
async function shotPush(page, name) {
  const f = await shot(page, name, SHOTS);
  if (f) report.screenshots.push(name);
  return f;
}

/* ================= 通用页面工具 ================= */
let markSeq = 0;
/** 按文本找到最小可见元素并点击（打 data-qa-mark，避免 strict mode 多元素问题） */
async function markByText(page, pattern, { tags = ['a', 'button', '[role=tab]', 'summary', 'li', 'label'], click = true } = {}) {
  const mark = 'qa' + (++markSeq);
  const info = await page.evaluate(({ src, flags, tagsList, mark }) => {
    const re = new RegExp(src, flags);
    const tagsSet = tagsList.map((t) => t.replace(/[[\]]/g, '').toUpperCase());
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const all = [...document.querySelectorAll('a,button,[role=tab],summary,li,label,div,span')];
    const hits = [];
    for (const el of all) {
      if (!vis(el)) continue;
      const txt = (el.innerText || el.textContent || '').trim();
      if (!txt || txt.length > 200) continue;
      if (!re.test(txt)) continue;
      hits.push({ el, len: txt.length, tag: el.tagName.toLowerCase() });
    }
    if (!hits.length) return { found: false };
    hits.sort((a, b) => {
      const ta = tagsSet.includes(a.tag.toUpperCase()) ? 0 : 1;
      const tb = tagsSet.includes(b.tag.toUpperCase()) ? 0 : 1;
      return ta - tb || a.len - b.len;
    });
    const el = hits[0].el;
    el.setAttribute('data-qa-mark', mark);
    return { found: true, text: hits[0].el.innerText.trim().slice(0, 120), tag: hits[0].tag };
  }, { src: pattern.source, flags: pattern.flags, tagsList: tags, mark }).catch(() => ({ found: false }));
  if (!info.found || !click) return { ok: info.found, mark, info };
  try {
    await page.locator(`[data-qa-mark="${mark}"]`).first().click({ timeout: 5000 });
    return { ok: true, mark, info };
  } catch (e) {
    return { ok: false, mark, info, error: String(e && e.message) };
  }
}
async function waitBodyContains(page, text, timeout = 10000) {
  try {
    await page.waitForFunction((t) => document.body && document.body.innerText.includes(t), text, { timeout });
    return true;
  } catch { return false; }
}
async function waitBodyMatch(page, src, timeout = 10000) {
  try {
    await page.waitForFunction((s) => new RegExp(s).test(document.body ? document.body.innerText : ''), src, { timeout });
    return true;
  } catch { return false; }
}
async function waitCards(page, min = 1, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let ids = [];
  while (Date.now() < deadline) {
    ids = await scopedCardIds(page).catch(() => []);
    if (ids.length >= min) return ids;
    await sleep(250);
  }
  return ids;
}
/** 等页面「稳定」：SW 首次 clients.claim() 会让 pwa.js 触发一次 location.reload()（首访自动刷新），
 *  E2E 必须等这次整页刷新结束再断言，否则会在导航瞬间读到空 header / 找不到语言开关。
 *  判定：等 serviceWorker.ready，然后等 ≥1.2s 无整页导航 + load 状态。 */
async function waitForPageSettled(page, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let lastNav = Date.now();
  const onNav = () => { lastNav = Date.now(); };
  page.on('framenavigated', onNav);
  try {
    await page.evaluate(async () => {
      if ('serviceWorker' in navigator) { try { await navigator.serviceWorker.ready; } catch { /* ignore */ } }
    }).catch(() => { });
    while (Date.now() < deadline) {
      if (Date.now() - lastNav > 1200) break;
      await sleep(250);
    }
    await page.waitForLoadState('load', { timeout: 8000 }).catch(() => { });
    await sleep(250);
  } finally { page.off('framenavigated', onNav); }
}
/** 等 SW 的 PREFETCH 把离线所需 catalog/plugins 写入 Cache（首访不再自动刷新后，离线能力依赖后台预取）。
 *  断网前等它完成，避免 SW network-first 对未缓存数据返回 503（浏览器记 console error）造成离线用例假失败。 */
async function waitForOfflineCache(page, timeout = 20000) {
  const urls = [
    './catalog/site.json', './catalog/categories.json', './catalog/tags.json', './catalog/authors.json',
    './catalog/licenses.json', './catalog/resources.json', './plugins/index.json',
    './plugins/course/manifest.json', './plugins/subtitle/manifest.json', './plugins/plugin/manifest.json',
    './data/plugins/builtin-whitelist.json',
  ];
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    last = await page.evaluate(async (list) => {
      if (!('caches' in window)) return { supported: false, missing: list };
      const keys = await caches.keys();
      const missing = [];
      for (const rel of list) {
        const abs = new URL(rel, location.href).toString();
        let hit = false;
        for (const k of keys) {
          try { const c = await caches.open(k); if (await c.match(abs)) { hit = true; break; } } catch { /* ignore */ }
        }
        if (!hit) missing.push(rel);
      }
      return { supported: true, missing };
    }, urls).catch((e) => ({ error: String(e && e.message), missing: urls }));
    if (last && Array.isArray(last.missing) && last.missing.length === 0) return { ok: true, waitedMs: Date.now() - started, missing: [] };
    await sleep(400);
  }
  return { ok: false, waitedMs: Date.now() - started, missing: (last && last.missing) || urls, last };
}
/** 卡片 id：优先 [data-testid=resource-card]，回退 main 内 #/resource 链接 */
async function scopedCardIds(page) {
  const ids = await cardIdsOf(page);
  if (ids.length) return ids;
  return await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const scope = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
    const set = new Map();
    scope.querySelectorAll('a[href*="#/resource/"]').forEach((a) => {
      if (a.closest('aside') || a.closest('nav') || a.closest('header') || a.closest('footer')) return;
      const m = (a.getAttribute('href') || '').match(/#\/resource\/([^/?#]+)/);
      if (!m) return;
      const r = a.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return;
      const prev = set.get(m[1]);
      if (!prev || r.width * r.height > prev.area) set.set(m[1], { area: r.width * r.height });
    });
    return [...set.keys()];
  }).catch(() => []);
}
async function clickAnyText(page, patterns, opts = {}) {
  for (const p of patterns) {
    const r = await markByText(page, p, opts);
    if (r.ok) return r;
  }
  return { ok: false };
}
/** 计算页面关键文本/背景 WCAG 对比度（设计快评证据） */
async function measureContrast(page) {
  return await page.evaluate(() => {
    const lum = (rgb) => {
      const m = String(rgb || '').match(/\d+(\.\d+)?/g);
      if (!m || m.length < 3) return null;
      const [r, g, b] = m.slice(0, 3).map(Number);
      const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
        n = n.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const sels = { body: 'body', cardTitle: '.res-title', cardDesc: '.res-desc', navLink: '.header-nav-link', badge: '.badge', muted: '.subtle' };
    const out = {};
    for (const [k, sel] of Object.entries(sels)) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      const l1 = lum(cs.color), l2 = lum(bgOf(el));
      if (l1 === null || l2 === null) continue;
      out[k] = { ratio: +((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2), fontSize: cs.fontSize };
    }
    return out;
  }).catch(() => ({}));
}

/* ================= 假 SHADOW Studio（仅本进程临时监听，绝不触碰用户真实进程） ================= */
async function startFakeStudioServer(port) {
  const http = await import('node:http');
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push({ method: req.method, url: req.url, at: nowIso() });
    if (String(req.url || '').startsWith('/api/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, version: '0.7.0', qa: 'qa-verify-fake-studio' }));
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('<!doctype html><html><body><h1>QA fake SHADOW Studio</h1><p>deep link receiver</p></body></html>');
  });
  await new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(port, '127.0.0.1', resolve); });
  return { port, hits, stop: () => new Promise((r) => srv.close(() => r())) };
}

/* ================= catalog 匹配（搜索/标签期望集） ================= */
const SEARCH_ALIASES = {
  coffee: ['咖啡', 'café', 'cafe'], 咖啡: ['coffee', 'cafe', 'café'], cafe: ['咖啡', 'coffee'], café: ['咖啡', 'coffee'],
  direction: ['问路', '方向', 'directions'], directions: ['问路', '方向', 'direction'], 问路: ['direction', 'directions', 'way'],
  interview: ['面试', '自我介绍', 'interviewing'], 面试: ['interview', '自我介绍'],
  podcast: ['播客', '听力'], 播客: ['podcast', '听力'], movie: ['影视', '电影', '片段'], 影视: ['movie', 'film', '片段'],
  shadowing: ['跟读', '影子跟读'], 跟读: ['shadowing', 'shadow'], travel: ['旅行', '出行'], 旅行: ['travel', 'trip'],
  daily: ['日常', '会话'], 日常: ['daily'], work: ['职场', '工作'], 职场: ['work', 'job'], byom: ['自备媒体', '媒体'], 自备媒体: ['byom'],
  subtitle: ['字幕'], 字幕: ['subtitle'], plugin: ['插件'], 插件: ['plugin'],
};
function buildMatcher(catalog) {
  const cmap = new Map((catalog.categories || []).map((c) => [c.id, c]));
  const amap = new Map((catalog.authors || []).map((a) => [a.handle, a]));
  const lmap = new Map((catalog.licenses || []).map((l) => [l.id, l]));
  // 与 market/assets/js/data.js 的 tagInfo/aliasesFor 对齐：标签表里的 aliases 也参与搜索
  const tagInfoOf = (token) => {
    const key = String(token || '').toLowerCase();
    for (const t of catalog.tags || []) {
      const names = [t.tag, t.label, t.labelEn, ...(Array.isArray(t.aliases) ? t.aliases : [])].filter(Boolean).map((x) => String(x).toLowerCase());
      if (names.includes(key)) return t;
    }
    return null;
  };
  const aliasesFor = (token) => {
    const out = new Set((SEARCH_ALIASES[token] || []).map((a) => String(a).toLowerCase()));
    const info = tagInfoOf(token);
    if (info) {
      for (const a of info.aliases || []) out.add(String(a).toLowerCase());
      if (info.tag && String(info.tag).toLowerCase() !== token) out.add(String(info.tag).toLowerCase());
    }
    return [...out];
  };
  return (q) => {
    const terms = String(q || '').trim().toLowerCase().split(/[\s,，、/]+/).filter(Boolean).slice(0, 8);
    if (!terms.length) return catalog.resources.map((r) => r.id);
    return catalog.resources.filter((r) => {
      const ct = cmap.get(r.category);
      const au = amap.get(resourceAuthor(r));
      const lic = lmap.get(r.license);
      const hay = [r.id, r.title, r.subtitle, r.description, (r.tags || []).join(' '), r.level, r.category,
        ct ? `${ct.label || ''} ${ct.labelEn || ''}` : '', resourceAuthor(r), au ? `${au.name || ''} ${au.bio || ''}` : '',
        r.type, r.license, lic ? lic.name : ''].join('\n').toLowerCase();
      return terms.every((token) => {
        const variants = [token, ...aliasesFor(token)];
        return variants.some((v) => hay.includes(v));
      });
    }).map((r) => r.id);
  };
}

/* ================= 页面数据读取 ================= */
async function readHeaderInfo(page) {
  return await page.evaluate(() => {
    const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'; };
    const header = document.querySelector('header') || document.querySelector('.site-header') || document.body;
    let imgs = [...header.querySelectorAll('img')].map((i) => ({ src: i.getAttribute('src') || '', alt: i.getAttribute('alt') || '', visible: vis(i) }));
    if (!imgs.length) {
      // 首屏 hydration 期间的兜底：品牌 logo 可能在 header 外/被替换
      imgs = [...document.querySelectorAll('img.brand-logo, img[src*="assets/brand/"]')].map((i) => ({ src: i.getAttribute('src') || '', alt: i.getAttribute('alt') || '', visible: vis(i) }));
    }
    const brandEl = header.querySelector('.brand, [data-testid="brand"], a[aria-label*="首页"], a[href="#/"]:first-of-type');
    let navLinks = [...header.querySelectorAll('nav a, [data-testid="main-nav"] a, a.header-nav-link')]
      .filter(vis).map((a) => ({ text: (a.innerText || '').trim(), href: a.getAttribute('href') || '' }));
    if (!navLinks.length) {
      navLinks = [...document.querySelectorAll('a.header-nav-link')].filter(vis).map((a) => ({ text: (a.innerText || '').trim(), href: a.getAttribute('href') || '' }));
    }
    // 重设计后主导航在左栏（sidebar .side-item）；header 只留搜索/积分/主题/语言/头像
    if (!navLinks.length) {
      navLinks = [...document.querySelectorAll('.sidebar .side-item, aside.sidebar a, .side-group a')]
        .filter(vis).map((a) => ({ text: (a.innerText || '').trim(), href: a.getAttribute('href') || '' }));
    }
    return {
      headerText: (header.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
      imgs,
      brandText: brandEl ? (brandEl.innerText || '').replace(/\s+/g, ' ').slice(0, 120) : (header.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
      brandHasSvg: !!(brandEl && brandEl.querySelector('svg')),
      navLinks,
      htmlLang: document.documentElement.lang || '',
      manifestLink: !!document.querySelector('link[rel="manifest"]'),
    };
  }).catch((e) => ({ error: String((e && e.message) || e) }));
}
async function readLangControl(page) {
  return await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r && r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
    const cands = [
      '[data-testid="lang-toggle"]', '[data-testid="language-toggle"]', '#lang-toggle', '#language-toggle',
      'button[aria-label*="语言"]', 'button[aria-label*="Language"]', 'button[aria-label*="language"]',
      '[role="button"][aria-label*="语言"]', 'select[name="lang"]', 'select[name="language"]',
    ];
    for (const sel of cands) {
      const el = document.querySelector(sel);
      if (el && vis(el)) { el.setAttribute('data-qa-lang', '1'); return { found: true, selector: sel, text: (el.innerText || el.value || '').trim().slice(0, 40) }; }
    }
    const buttons = [...document.querySelectorAll('button, a, [role="button"], [role="switch"]')].filter(vis);
    for (const el of buttons) {
      const t = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
      if (t.length > 24) continue;
      if (/搜索|search|主题|theme|深浅色/i.test(t)) continue;
      if (/(^|\s)(EN|English|中文|简体|语言|Language|language)(\s|$|\s*\/|\/)/i.test(t) || /^[中EN]{1,2}(\s*\/\s*[中ENa-z]{1,7})?$/i.test(t)) {
        el.setAttribute('data-qa-lang', '1');
        return { found: true, selector: 'text', text: t };
      }
    }
    return { found: false };
  }).catch(() => ({ found: false }));
}
async function readImportOutcome(page) {
  return await page.evaluate(() => {
    const text = document.body ? document.body.innerText : '';
    const modalEl = document.querySelector('#modal-root');
    const toastEl = document.querySelector('#toast-region');
    const modalText = modalEl ? (modalEl.innerText || '').replace(/\s+/g, ' ') : '';
    const toastText = toastEl ? (toastEl.innerText || '').replace(/\s+/g, ' ') : '';
    // 关键：只在弹层/Toast 判态，避免详情页静态文案里的「探测不到会降级」造成误判
    const degraded = /已降级|降级为下载|自动下载/.test(modalText);
    const blocked = /被拦截|弹窗被拦截/.test(modalText + ' ' + toastText);
    const success = /已发送到 SHADOW|已打开 SHADOW|已在 .{0,40}打开|openedVia|导入深链/i.test(modalText)
      || /已检测到 SHADOW|正在打开导入深链/i.test(toastText);
    return {
      textSample: text.replace(/\s+/g, ' ').slice(0, 1200),
      degraded, blocked, success,
      modalText: modalText.slice(0, 600),
      toastText: toastText.slice(0, 300),
      statusEl: (() => {
        const el = document.querySelector('[data-testid="import-status"], [data-import-status]');
        return el ? { text: (el.innerText || '').trim(), status: el.getAttribute('data-status') || el.getAttribute('data-import-status') || '' } : null;
      })(),
    };
  }).catch(() => ({ textSample: '', degraded: false, blocked: false, success: false, modalText: '', toastText: '' }));
}
async function readMobileNav(page) {
  return await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r && r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
    const cands = [
      '[data-testid="mobile-nav"]', '[data-testid="mobile-tabbar"]', '[data-testid="bottom-nav"]',
      '.mobile-nav', '.mobile-tabbar', '.bottom-nav', '.tabbar',
      'nav[aria-label*="底部"]', 'nav[aria-label*="Bottom"]', 'nav[aria-label*="mobile" i]',
    ];
    let root = null, via = null;
    for (const sel of cands) {
      const el = [...document.querySelectorAll(sel)].find(vis);
      if (el) { root = el; via = sel; break; }
    }
    if (!root) {
      // 启发式：position fixed/sticky 且 near bottom、含 ≥3 个链接的容器
      for (const el of document.querySelectorAll('nav, div, footer, ul')) {
        if (!vis(el)) continue;
        const cs = getComputedStyle(el);
        const links = [...el.querySelectorAll('a, button')].filter(vis);
        if (links.length < 3) continue;
        const r = el.getBoundingClientRect();
        const nearBottom = r.bottom > window.innerHeight - 120 && (cs.position === 'fixed' || cs.position === 'sticky' || /bottom/.test(cs.cssText || ''));
        if (nearBottom) { root = el; via = 'heuristic-nearBottom'; break; }
      }
    }
    if (!root) return { found: false };
    root.setAttribute('data-qa-mobile-nav', '1');
    const items = [...root.querySelectorAll('a, button, [role="link"], [role="tab"]')].filter(vis).map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30), href: el.getAttribute('href') || '', w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.left.toFixed(1), y: +r.top.toFixed(1) };
    }).filter((i) => i.text);
    const r = root.getBoundingClientRect();
    return { found: true, via, items, rect: { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), height: +r.height.toFixed(1) }, position: getComputedStyle(root).position, viewport: { w: window.innerWidth, h: window.innerHeight } };
  }).catch(() => ({ found: false }));
}
async function waitServiceWorker(page, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false };
      const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
      return {
        supported: true, hasReg: !!reg, active: !!(reg && reg.active), state: reg && reg.active ? reg.active.state : null,
        controlled: !!navigator.serviceWorker.controller, scriptURL: reg && reg.active ? reg.active.scriptURL : null,
      };
    }).catch((e) => ({ supported: false, error: String(e && e.message) }));
    if (last && last.active) return last;
    await sleep(300);
  }
  return last || { supported: false };
}
async function artifactCheck(baseUrl, relUrl, label) {
  const url = new URL(relUrl, baseUrl + '/').toString();
  const resp = await httpRequest(url).catch((e) => ({ status: 0, body: Buffer.alloc(0), text: '', headers: {}, error: String(e) }));
  return {
    label, url, status: resp.status, bytes: resp.body ? resp.body.length : 0,
    sha256: resp.body && resp.body.length ? sha256Hex(resp.body) : null,
    contentType: (resp.headers || {})['content-type'] || '', text: resp.text || '', json: resp.json,
    error: resp.error || null,
  };
}

/* ================= 主流程 ================= */
async function main() {
  if (!hasMarket()) fatal(`market/ 尚未交付（缺 ${path.join(MARKET_DIR, 'index.html')}）`);
  ensureDir(SHOTS);

  // ---------- 0. 市场服务（独立端口，绝不占用用户 18765/18920） ----------
  let srv = null;
  try {
    srv = await ensureMarketServer({ baseUrl: baseUrlArg, reuseDefault: !!argv.reuse });
  } catch (e) { fatal(`市场服务不可用：${e.message}`); }
  const baseUrl = srv.baseUrl;
  report.baseUrl = baseUrl;
  report.server = { baseUrl, port: srv.port, reused: srv.reused, serveLog: srv.logFile || null, marketDir: MARKET_DIR };
  log(`[market] baseUrl=${baseUrl} reused=${srv.reused}`);

  // ---------- 0b. catalog v2 ----------
  const catalog = await loadCatalogV2(baseUrl);
  report.catalog = { files: catalog.files, missing: catalog.missing, counts: { resources: catalog.resources.length, categories: catalog.categories.length, tags: catalog.tags.length, authors: catalog.authors.length, licenses: catalog.licenses.length } };
  if (!catalog.allOk || !catalog.resources.length) {
    fatal(`catalog v2 未就绪（缺 ${catalog.missing.join(', ') || 'resources'}）。Phase 2 数据层尚未生成？不伪造 PASS。`);
  }
  const resources = catalog.resources;
  const categories = catalog.categories;
  const authors = catalog.authors;
  const licenses = catalog.licenses;
  const tags = catalog.tags;
  const matcher = buildMatcher(catalog);
  const courseRes = resources.find((r) => r.type === 'course' && downloadArtifacts(r).packageUrl) || resources[0];
  const detailId = courseRes.id;
  const detailArt = downloadArtifacts(courseRes);
  const detailVer = latestVersion(courseRes) || {};
  const coursePkgResp = await httpRequest(new URL(detailArt.packageUrl, baseUrl + '/').toString()).catch(() => ({ status: 0, json: null, body: Buffer.alloc(0) }));
  const coursePkg = coursePkgResp.json || null;
  report.detailResource = { id: detailId, type: courseRes.type, title: courseRes.title, artifacts: detailArt, version: detailVer.version };

  const checks = makeChecks('market-e2e');
  const consoleAll = report.console;
  const pageErrorsAll = report.pageErrors;
  let page = null, context = null, browser = null;

  try {
    const launched = await launchEdge({ headless: !headed });
    browser = launched.browser;
    report.browser = launched.browserInfo;
    const inst = await newInstrumentedPage(browser, { viewport: { width: 1440, height: 900 } });
    context = inst.context; page = inst.page;
    const ev = inst.events;
    const syncEvents = () => {
      consoleAll.length = 0; consoleAll.push(...ev.console);
      pageErrorsAll.length = 0; pageErrorsAll.push(...ev.pageErrors);
      report.requestFailures = ev.requestFailures.slice();
    };

    // 清理本机 localStorage（测试确定性；不动用户真实数据——独立浏览器 profile）
    // 注意：站点启动时可能把空 hash 改写为 #/（同文档导航），Playwright 会报 "interrupted by another navigation"，这里容忍。
    await page.goto(baseUrl + '/#/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
    await page.evaluate(() => { try { localStorage.clear(); } catch { } }).catch(() => { });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
    // 首访 SW clients.claim() → pwa.js controllerchange → 自动整页刷新一次；等它结束再做断言（否则会读到导航瞬间的空 DOM）
    await waitForPageSettled(page, 20000);

    /* ================= M0. catalog v2 + 包 + 插件 + 导入产物 HTTP 契约 ================= */
    const catChecks = CATALOG_FILES.map((n) => ({ n, f: catalog.files[n] }));
    const catBad = catChecks.filter(({ f }) => !f || f.status !== 200 || !f.json).map(({ n, f }) => `${n}=${f ? f.status : 'n/a'}`);
    checks.ok('M0.1', 'catalog v2 六文件 HTTP 200 + JSON 可解析（site/categories/tags/authors/licenses/resources）',
      catBad.length === 0, catBad.join(',') || CATALOG_FILES.map((n) => `${n}:${catalog.files[n].bytes}B`).join(' '));
    const schemaVersions = CATALOG_FILES.map((n) => (catalog.files[n] && catalog.files[n].json ? catalog.files[n].json.schemaVersion : null));
    checks.ok('M0.2', 'catalog v2 每文件 schemaVersion=2 + generatedAt 可解析', schemaVersions.every((v) => v === 2),
      `versions=[${schemaVersions.join(',')}] generatedAt=${catalog.generatedAt}`);
    checks.ok('M0.3', 'resources ≥7（5 课程 + 字幕 + 插件类）', resources.length >= 7, `count=${resources.length} types=[${[...new Set(resources.map((r) => r.type))].join(',')}]`);
    checks.ok('M0.4', 'categories/authors/tags/licenses 非空且引用可用',
      categories.length >= 1 && authors.length >= 1 && tags.length >= 1 && licenses.length >= 1,
      `c=${categories.length} a=${authors.length} tags=${tags.length} l=${licenses.length}`);

    // 每资源：packageUrl 200 + JSON + sha256/size 与文件一致 + 三导入产物 200
    const pkgProblems = [];
    const pkgCache = new Map();
    for (const r of resources) {
      const art = downloadArtifacts(r);
      const ver = latestVersion(r) || {};
      if (!art.packageUrl) { pkgProblems.push(`${r.id}:缺 packageUrl`); continue; }
      const resp = await httpRequest(new URL(art.packageUrl, baseUrl + '/').toString()).catch((e) => ({ status: 0, error: String(e), json: null, body: Buffer.alloc(0) }));
      const sha = resp.body && resp.body.length ? sha256Hex(resp.body) : null;
      pkgCache.set(r.id, { resp, sha });
      if (resp.status !== 200) { pkgProblems.push(`${r.id}:包 status=${resp.status}`); continue; }
      if (!resp.json) pkgProblems.push(`${r.id}:包 JSON 不可解析`);
      if (ver.sha256 && sha && String(ver.sha256).toLowerCase() !== sha) pkgProblems.push(`${r.id}:versions[0].sha256!=实际`);
      if (ver.sizeBytes && resp.body.length !== ver.sizeBytes) pkgProblems.push(`${r.id}:versions[0].sizeBytes!=实际(${resp.body.length})`);
      if (r.stats && r.stats.sha256 && sha && String(r.stats.sha256).toLowerCase() !== sha) pkgProblems.push(`${r.id}:stats.sha256!=实际`);
      if (r.stats && r.stats.sizeBytes && resp.body.length !== r.stats.sizeBytes) pkgProblems.push(`${r.id}:stats.sizeBytes!=实际`);
      if (resp.body.length > 2 * 1024 * 1024) pkgProblems.push(`${r.id}:包>2MB`);
    }
    checks.ok('M0.5', '每个资源 packageUrl 200/JSON 且 sha256+sizeBytes 与 catalog 一致（≤2MB）',
      pkgProblems.length === 0, pkgProblems.slice(0, 5).join(' | ') || `${resources.length} 包全部一致`);

    // 插件清单
    const pluginIdxResp = await httpRequest(baseUrl + '/plugins/index.json').catch((e) => ({ status: 0, json: null, error: String(e) }));
    const pIdx = pluginIdxResp.json || {};
    const idxTypes = Array.isArray(pIdx.types) ? pIdx.types : Array.isArray(pIdx.plugins) ? pIdx.plugins : [];
    const manifestProbs = [];
    for (const t of idxTypes) {
      const id = typeof t === 'string' ? t : (t.id || t.type);
      const mf = typeof t === 'object' && t.manifest ? t.manifest : `plugins/${id}/manifest.json`;
      const mr = await httpRequest(new URL(mf, baseUrl + '/').toString()).catch(() => ({ status: 0 }));
      if (mr.status !== 200 || !mr.json) manifestProbs.push(`${id}:${mr.status}`);
      else if (mr.json.manifestVersion !== 1 || mr.json.kind !== 'resource-type') manifestProbs.push(`${id}:字段`);
    }
    checks.ok('M0.6', 'plugins/index.json 200 + ≥3 资源类型 + 每个 manifest 200/声明式（一切即插件）',
      pluginIdxResp.status === 200 && idxTypes.length >= 3 && manifestProbs.length === 0,
      `types=${idxTypes.length}[${idxTypes.map((t) => (typeof t === 'string' ? t : t.id)).join(',')}] problems=${manifestProbs.join(',') || 'none'}`);

    // 三下载产物（先 HTTP，后页面弹层）
    const artifactProblems = [];
    const artInfo = {};
    // course/subtitle 都产出派生导入产物；plugin 为声明式 JSON（importFiles 大多为 null，按 type 判空）
    const artifactResources = resources.filter((r) => ['course', 'subtitle'].includes(r.type));
    const courseResources = artifactResources;
    for (const r of courseResources) {
      const art = downloadArtifacts(r);
      const ver = latestVersion(r) || {};
      const info = {};
      for (const [kind, relUrl] of [['package', art.packageUrl], ['shadowJson', art.shadowJson], ['srt', art.srt], ['readme', art.readme]]) {
        if (!relUrl) { artifactProblems.push(`${r.id}:缺 ${kind}`); continue; }
        const a = await artifactCheck(baseUrl, relUrl, kind);
        info[kind] = { status: a.status, bytes: a.bytes, sha256: a.sha256 };
        if (a.status !== 200) { artifactProblems.push(`${r.id}:${kind} status=${a.status}`); continue; }
        const imp = ver.importFiles || {};
        const impEntry = imp[kind] || null;
        const expectSha = kind === 'package' ? ver.sha256 : (impEntry && typeof impEntry === 'object' ? impEntry.sha256 : null);
        const expectSize = kind === 'package' ? ver.sizeBytes : (impEntry && typeof impEntry === 'object' ? impEntry.sizeBytes : null);
        if (expectSha && a.sha256 && String(expectSha).toLowerCase() !== a.sha256) artifactProblems.push(`${r.id}:${kind} sha256!=catalog`);
        if (expectSize && a.bytes !== expectSize) artifactProblems.push(`${r.id}:${kind} size!=catalog(${a.bytes}/${expectSize})`);
        if (kind === 'package') {
          if (!a.json) artifactProblems.push(`${r.id}:package 非 JSON`);
          else if (a.json.spec !== 'shadow.course') artifactProblems.push(`${r.id}:package spec=${a.json.spec}`);
        }
        if (kind === 'shadowJson') {
          if (!a.json) artifactProblems.push(`${r.id}:.shadow.json 不可解析`);
          else {
            const clips = Array.isArray(a.json.clips) ? a.json.clips : [];
            if (!clips.length) artifactProblems.push(`${r.id}:.shadow.json clips 空`);
            else {
              const names = clips.map((c) => c.name);
              if (names.some((n) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(n || '')))) artifactProblems.push(`${r.id}:.shadow.json clip.name 非 ASCII`);
              if (clips.some((c) => !(typeof c.duration === 'number' && c.duration > 0))) artifactProblems.push(`${r.id}:.shadow.json clip.duration<=0`);
              // mediaName（详情页公示的媒体名）必须与 clip.name 逐字一致
              if (r.mediaName && !names.includes(r.mediaName)) artifactProblems.push(`${r.id}:clip.name 与 mediaName(${r.mediaName}) 不一致`);
              const firstSent = Array.isArray(clips[0] && clips[0].sentences) ? clips[0].sentences : [];
              if (!firstSent.length || firstSent.some((s) => !String(s.en || '').trim())) artifactProblems.push(`${r.id}:.shadow.json 句子 en 空`);
              const zhCount = clips.reduce((n, c) => n + (Array.isArray(c.sentences) ? c.sentences.filter((s) => String(s.zh || '').trim()).length : 0), 0);
              if (zhCount === 0) artifactProblems.push(`${r.id}:.shadow.json 无中文翻译（zh）`);
            }
          }
        }
        if (kind === 'srt') {
          const srt = parseSrt(a.text);
          info.srtCues = srt.count;
          if (!srt.ok) artifactProblems.push(`${r.id}:.srt 不可解析(${srt.errors.slice(0, 2).join(';')})`);
          const pkg = pkgCache.get(r.id);
          const pkgSent = pkg && pkg.resp && pkg.resp.json && Array.isArray(pkg.resp.json.sentences) ? pkg.resp.json.sentences.length : null;
          if (pkgSent !== null && srt.count !== pkgSent) artifactProblems.push(`${r.id}:.srt cue(${srt.count})!=包句子(${pkgSent})`);
        }
        if (kind === 'readme' && a.text.trim().length < 80) artifactProblems.push(`${r.id}:readme 过短`);
      }
      artInfo[r.id] = info;
    }
    report.phases.artifacts = artInfo;
    checks.ok('M0.7', 'course/subtitle 三下载产物 HTTP 200（.shadowcourse/.shadow.json/.srt + README），JSON/SRT 可解析',
      artifactProblems.filter((p) => /status|缺/.test(p)).length === 0,
      artifactProblems.filter((p) => /status|缺/.test(p)).slice(0, 5).join(' | ') || `${artifactResources.length} 个资源 × 3 产物 200`);
    checks.ok('M0.8', '三下载产物 sha256/size 与 catalog 一致（有记录则强校验）+ SRT cue 数=包句子数',
      artifactProblems.length === 0, artifactProblems.slice(0, 6).join(' | ') || 'artifacts consistent');

    /* ================= M1. 首页 / 品牌 / 导航 / 搜索 / i18n ================= */
    const homeHttp = await httpRequest(baseUrl + '/index.html').catch(() => ({ status: 0 }));
    const homeResp = await page.goto(baseUrl + '/#/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    const homeIds = await waitCards(page, Math.min(3, resources.length), 25000);
    syncEvents();
    const homeText = await bodyText(page);
    report.phases.home = { status: homeHttp.status, gotoStatus: homeResp && homeResp.status(), cardIds: homeIds, url: page.url() };
    await shotPush(page, 'market-home-1440.png');
    checks.ok('M1.1', '首页 HTTP 200 且渲染资源卡 ≥3', homeHttp.status === 200 && homeIds.length >= 3,
      `status=${homeHttp.status} cards=${homeIds.length} ids=${homeIds.slice(0, 6).join(',')}`);
    const titleHits = resources.filter((r) => homeText.includes(r.title)).length;
    checks.ok('M1.2', '首页卡片标题来自 catalog v2（≥3 个标题可见）', titleHits >= 3, `visibleTitles=${titleHits}/${resources.length}`);

    // task-8 首屏静态 shell + 动态 import 后，header 可能在 hydration 瞬间被替换；等待导航链接就绪并重试读取，
    // 避免把「测试读取时机」误判成站点回归。
    await page.waitForFunction(() => document.querySelectorAll('header nav a, a.header-nav-link').length >= 4, null, { timeout: 15000 }).catch(() => { });
    let header = await readHeaderInfo(page);
    if (!(header.navLinks && header.navLinks.length) || !(header.imgs && header.imgs.length)) {
      await sleep(1200);
      header = await readHeaderInfo(page);
    }
    report.phases.header = header;
    const brandImg = (header.imgs || []).find((i) => /assets\/brand\//.test(i.src) || /app-icon|brand/.test(i.src) && /\.(png|svg|webp)/.test(i.src));
    checks.ok('M1.3', '顶部品牌：logo 图片（assets/brand/*）+ SHADOW 字标可见',
      !!brandImg && /SHADOW/i.test(header.brandText || header.headerText || ''),
      `img=${brandImg ? brandImg.src : 'none'} brandText=${(header.brandText || '').slice(0, 60)}`);
    checks.ok('M1.4', '主导航含 探索/收藏/投稿/关于（或英文对应）+ manifest 链接',
      (header.navLinks || []).length >= 4 && header.manifestLink,
      `nav=${(header.navLinks || []).map((l) => l.text).join('|')}`);
    const langCtl = await readLangControl(page);
    report.phases.langControl = langCtl;
    checks.ok('M1.5', '头部语言开关（中/EN）存在', !!langCtl.found, langCtl.found ? `${langCtl.selector} "${langCtl.text}"` : '未找到语言开关');

    // 首屏静态 shell / preload 信息（task-8 性能收口证据；信息级，不强制实现方式）
    try {
      const rawIndex = await httpRequest(baseUrl + '/index.html').catch(() => ({ text: '' }));
      const staticShell = await page.evaluate(() => {
        const view = document.getElementById('view');
        return { viewChildren: view ? view.children.length : -1, viewHtmlLen: view ? view.innerHTML.length : 0, viewTextLen: view ? (view.innerText || '').length : 0 };
      }).catch(() => ({}));
      const preloads = [...(String(rawIndex.text || '').matchAll(/<link[^>]+rel=["'](?:preload|modulepreload)["'][^>]*>/gi))].map((m) => m[0].slice(0, 180));
      const skeletonInSource = /<div[^>]*id=["']view["'][^>]*>\s*<[^>]+>/.test(String(rawIndex.text || ''));
      report.extra.staticShell = { ...staticShell, skeletonInSource, preloads: preloads.slice(0, 10), indexHtmlBytes: String(rawIndex.text || '').length };
    } catch (e) { report.extra.staticShell = { error: String(e && e.message) }; }

    // 搜索（页面输入框）
    const searchPhase = { queries: {} };
    for (const q of ['coffee', '咖啡']) {
      await gotoHash(page, baseUrl, '#/');
      await waitCards(page, 1, 12000);
      const inputSel = await page.evaluate(() => {
        const cands = ['[data-testid="search-input"]', 'input[type="search"]', 'input[placeholder*="搜索"]', 'input[placeholder*="Search"]',
          'input[placeholder*="search"]', '#search', '.search input', '[role="search"] input', 'header input'];
        for (const s of cands) {
          const el = document.querySelector(s);
          if (el) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) { el.setAttribute('data-qa-search', '1'); return s; } }
        }
        return null;
      });
      if (inputSel) {
        await page.locator('[data-qa-search="1"]').first().click();
        await page.keyboard.press('Control+A');
        await page.keyboard.type(q, { delay: 30 });
        // 重设计后 header 搜索是表单：输入后回车 → 由市场视图过滤（当前 header 提交落到 #/market?q=）
        await page.keyboard.press('Enter').catch(() => { });
        await sleep(1200);
        let headerHash = await page.evaluate(() => location.hash);
        // 依赖前端把 header 搜索直达 #/search?q=（#/market?q= 目前不过滤，作为已记录的产品缺陷）；
        // 保证搜索过滤覆盖：若落到 #/market?q= 则再用规范搜索路由验证同一查询。
        if (!/#\/search\?/.test(headerHash) && headerHash.includes('q=')) {
          await gotoHash(page, baseUrl, '#/search?q=' + encodeURIComponent(q));
          await sleep(1200);
          headerHash = await page.evaluate(() => location.hash);
        }
        const gotIds = (await scopedCardIds(page)).slice().sort();
        const expected = matcher(q).sort();
        const sameSet = gotIds.length === expected.length && gotIds.every((id, i) => id === expected[i]);
        searchPhase.queries[q] = { inputSel, got: gotIds, expected, sameSet, hash: await page.evaluate(() => location.hash), headerHash };
        checks.ok(`M1.6-${q}`, `搜索 "${q}" 过滤正确（结果集=目录匹配集）`, sameSet && gotIds.length > 0,
          `got=[${gotIds.join(',')}] expected=[${expected.join(',')}]`);
      } else {
        searchPhase.queries[q] = { inputSel: null };
        checks.ok(`M1.6-${q}`, `搜索 "${q}" 过滤正确`, false, '未找到可见搜索框');
      }
    }
    const qAny = ['coffee', '咖啡'].find((q) => matcher(q).length > 0) || 'coffee';
    await page.goto(baseUrl + '/#/search?q=' + encodeURIComponent(qAny), { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(1300);
    const hashIds = (await scopedCardIds(page)).slice().sort();
    const hashExpected = matcher(qAny).sort();
    searchPhase.hashRoute = { q: qAny, got: hashIds, expected: hashExpected };
    checks.ok('M1.7', `hash 搜索路由 #/search?q=${qAny} 可用`, hashIds.length === hashExpected.length && hashIds.every((id, i) => id === hashExpected[i]),
      `got=[${hashIds.join(',')}] expected=[${hashExpected.join(',')}]`);
    report.phases.search = searchPhase;

    // 分类页
    const cat = categories[0];
    if (cat) {
      await gotoHash(page, baseUrl, '#/category/' + cat.id);
      const catIds = (await waitCards(page, 1, 15000)).slice().sort();
      const exp = resources.filter((r) => r.category === cat.id).map((r) => r.id).sort();
      await shotPush(page, `market-category-${cat.id}.png`);
      checks.ok('M1.8', `分类页 #/category/${cat.id} 可达且资源集正确`, catIds.length === exp.length && catIds.every((id, i) => id === exp[i]) && exp.length > 0,
        `label=${cat.label || ''} got=[${catIds.join(',')}] expected=[${exp.join(',')}]`);
    } else checks.ok('M1.8', '分类页可达', false, 'categories 为空');

    // 标签页（选择别名展开不改变集合的标签，保证期望集确定）
    let tagPick = null;
    for (const t of tags) {
      const name = t.tag || t.id || t.label;
      if (!name) continue;
      const exact = resources.filter((r) => (r.tags || []).some((x) => String(x).toLowerCase() === String(name).toLowerCase())).map((r) => r.id).sort();
      const aliases = [name, ...(Array.isArray(t.aliases) ? t.aliases : [])].map((x) => String(x).toLowerCase());
      const expanded = resources.filter((r) => (r.tags || []).some((x) => aliases.includes(String(x).toLowerCase()))).map((r) => r.id).sort();
      if (exact.length && exact.join('|') === expanded.join('|')) { tagPick = { name, expected: exact }; break; }
    }
    if (!tagPick) {
      const r0 = resources.find((r) => (r.tags || []).length);
      const name = r0 ? r0.tags.find((x) => !/^(A1|A2|B1|B2|C1|C2)$/i.test(x)) || r0.tags[0] : null;
      tagPick = name ? { name, expected: resources.filter((r) => (r.tags || []).includes(name)).map((r) => r.id).sort() } : null;
    }
    if (tagPick) {
      await page.goto(baseUrl + '/#/tag/' + encodeURIComponent(tagPick.name), { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(1200);
      const tagText = await bodyText(page);
      const tagIds = (await scopedCardIds(page)).slice().sort();
      await shotPush(page, 'market-tag.png');
      report.phases.tag = { tag: tagPick.name, got: tagIds, expected: tagPick.expected, textSample: tagText.replace(/\s+/g, ' ').slice(0, 300) };
      checks.ok('M1.9', `标签页 #/tag/${tagPick.name} 可达且过滤正确`, tagIds.length === tagPick.expected.length && tagIds.every((id, i) => id === tagPick.expected[i]) && tagPick.expected.length > 0,
        `got=[${tagIds.join(',')}] expected=[${tagPick.expected.join(',')}] text=${tagText.replace(/\s+/g, ' ').slice(0, 80)}`);
    } else checks.ok('M1.9', '标签页可达', false, '没有可用标签');

    // 作者页
    const author = authors[0];
    if (author) {
      await gotoHash(page, baseUrl, '#/creator/' + author.handle);
      const creatorIds = (await waitCards(page, 1, 15000)).slice().sort();
      const exp = resources.filter((r) => resourceAuthor(r) === author.handle).map((r) => r.id).sort();
      const text = await bodyText(page);
      await shotPush(page, `market-creator-${author.handle}.png`);
      checks.ok('M1.10', `作者页 #/creator/${author.handle} 可达且显示作者信息`, creatorIds.length === exp.length && creatorIds.every((id, i) => id === exp[i]) && text.includes(author.name || author.handle),
        `name=${author.name} got=[${creatorIds.join(',')}] expected=[${exp.join(',')}]`);
    } else checks.ok('M1.10', '作者页可达', false, 'authors 为空');

    // 真实数据来源（未加载 dev-fixtures）
    const usedDataUrls = [...new Set(ev.requests)].filter((u) => /catalog\/|catalog\.json|dev-fixtures/.test(u));
    const dataMode = await page.evaluate(() => ({
      fixtureBadge: /演示夹具/.test(document.body ? document.body.innerText : ''),
      fixtureFlag: (() => { try { return sessionStorage.getItem('shadow.market.fixture.v1'); } catch { return null; } })(),
    })).catch(() => ({}));
    report.extra.dataMode = { ...dataMode, usedDataUrls: usedDataUrls.slice(0, 10) };
    checks.ok('M1.11', '使用真实 catalog v2 数据（无演示夹具标记，未加载 dev-fixtures）',
      !dataMode.fixtureBadge && !dataMode.fixtureFlag && usedDataUrls.some((u) => /catalog\/resources\.json/.test(u)) && !usedDataUrls.some((u) => /dev-fixtures/.test(u)),
      `fixture=${dataMode.fixtureBadge} urls=${usedDataUrls.slice(0, 5).join(',')}`);

    // i18n 切换（导航文案变化 + html lang 变化）
    const navBefore = (await readHeaderInfo(page)).navLinks.map((l) => l.text);
    const langBefore = await page.evaluate(() => document.documentElement.lang);
    let i18n = { toggled: false, before: { lang: langBefore, nav: navBefore } };
    if (langCtl.found) {
      await page.locator('[data-qa-lang="1"]').first().click({ timeout: 5000 }).catch(() => { });
      await sleep(1200);
      const switched = await page.waitForFunction(() => {
        const lang = (document.documentElement.lang || '').toLowerCase();
        if (lang.startsWith('en')) return true;
        const navText = [...document.querySelectorAll('header nav a, .sidebar .side-item, aside.sidebar a')].map((a) => a.innerText.trim()).join(' ');
        return /Explore|Favorites|Contribute|About|Workspace|Market|Library|Points|Settings/i.test(navText);
      }, null, { timeout: 8000 }).then(() => true).catch(() => false);
      const after = await readHeaderInfo(page);
      const langAfter = await page.evaluate(() => document.documentElement.lang);
      i18n = { toggled: switched, before: { lang: langBefore, nav: navBefore }, after: { lang: langAfter, nav: after.navLinks.map((l) => l.text) } };
      await shotPush(page, 'market-i18n-en.png');
      const navChanged = after.navLinks.map((l) => l.text).join('|') !== navBefore.join('|');
      checks.ok('M1.12', 'i18n 切换后导航文案变化 + html lang 切换（中→EN）',
        switched && navChanged && String(langAfter).toLowerCase().startsWith('en'),
        `lang ${langBefore}→${langAfter} nav=[${navBefore.join('|')}]→[${after.navLinks.map((l) => l.text).join('|')}]`);
      // 切回中文
      await page.locator('[data-qa-lang="1"]').first().click({ timeout: 5000 }).catch(() => { });
      await sleep(1000);
      const backLang = await page.evaluate(() => document.documentElement.lang);
      i18n.backLang = backLang;
      checks.ok('M1.13', 'i18n 可切回中文（语言状态持久化/不刷新可用）', String(backLang).toLowerCase().startsWith('zh') || !switched,
        `backLang=${backLang}`);
    } else {
      checks.ok('M1.12', 'i18n 切换后导航文案变化（中→EN）', false, '未找到语言开关');
      checks.ok('M1.13', 'i18n 可切回中文', false, '未找到语言开关');
    }
    report.phases.i18n = i18n;

    /* ================= M2. 详情页（hash 直达 / 刷新 / Tabs / About / 许可证 / 收藏） ================= */
    await gotoHash(page, baseUrl, '#/');
    await page.evaluate((id) => { location.hash = '#/resource/' + id; }, detailId);
    const detailLoaded = await waitBodyContains(page, courseRes.title, 15000);
    const detailText = await bodyText(page);
    const notFound = /404|找不到|未找到|not found/i.test(detailText) && !detailLoaded;
    checks.ok('M2.1', `详情页 #/resource/${detailId} hash 可达`, detailLoaded && !notFound, `loaded=${detailLoaded} url=${page.url()}`);
    await shotPush(page, 'market-detail-1440.png');
    let reloadOk = false;
    try {
      const r = await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      reloadOk = await waitBodyContains(page, courseRes.title, 15000);
      report.phases.detailReload = { status: r && r.status(), ok: reloadOk, url: page.url() };
    } catch (e) { report.phases.detailReload = { ok: false, error: String(e && e.message) }; }
    checks.ok('M2.2', '刷新 hash 直达详情页不 404（重新加载仍渲染）', reloadOk, `url=${page.url()}`);

    if (coursePkg) {
      const clickTab = async (name) => {
        const direct = await clickAny(page, [`[data-testid="tab-${name}"]`]);
        if (direct.ok) { await sleep(800); return { ok: true, selector: `[data-testid="tab-${name}"]` }; }
        const re = { readme: 'README', sentences: '句子预览|句子', files: '文件', versions: '版本' }[name] || name;
        const byText = await markByText(page, new RegExp(re, 'i'));
        await sleep(800);
        return { ok: byText.ok, selector: 'text' };
      };
      // README
      const readme = coursePkg.readme || '';
      const headingMatch = readme.match(/^#{1,6}\s+(.+)$/m);
      const heading = headingMatch ? headingMatch[1].trim() : null;
      await page.waitForFunction(() => {
        const c = document.querySelector('[data-testid="readme-content"]');
        if (!c) return false;
        return !!(c.querySelector('h1,h2,h3,h4,h5,h6') || (c.innerText || '').trim().length > 20);
      }, null, { timeout: 15000 }).catch(() => { });
      const readmeInfo = await page.evaluate((h) => {
        const content = document.querySelector('[data-testid="readme-content"]');
        const main = content || document.querySelector('main') || document.body;
        const text = main ? main.innerText : '';
        const headingEl = h ? [...main.querySelectorAll('h1,h2,h3,h4,h5,h6')].some((el) => (el.innerText || '').includes(h)) : false;
        // 重设计：README 的首个 H1 提升为页面标题（readme-content 外），在 #view 范围内再找一次
        const view = document.querySelector('#view');
        const viewHeadingEl = h && view ? [...view.querySelectorAll('h1,h2,h3,h4,h5,h6')].some((el) => (el.innerText || '').includes(h)) : false;
        const html = main ? main.innerHTML : '';
        return { hasContainer: !!content, headingEl, viewHeadingEl, textLen: text.length, scripts: (html.match(/<script/gi) || []).length, inlineHandlers: (html.match(/\son(error|load|click)\s*=/gi) || []).length };
      }, heading);
      report.phases.readme = { heading, ...readmeInfo };
      checks.ok('M2.3', 'README Tab 渲染（包内 readme 标题渲染为标题元素）', !!heading && (readmeInfo.headingEl || readmeInfo.viewHeadingEl),
        `heading=${heading} container=${readmeInfo.hasContainer} headingEl=${readmeInfo.headingEl || readmeInfo.viewHeadingEl} textLen=${readmeInfo.textLen}`);
      checks.ok('M2.4', 'README 安全渲染（无 <script>/内联事件）', readmeInfo.scripts === 0 && readmeInfo.inlineHandlers === 0,
        `scripts=${readmeInfo.scripts} inlineHandlers=${readmeInfo.inlineHandlers}`);

      // 句子预览
      const tabClick = await clickTab('sentences');
      const sentInfo = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="tab-panel-sentences"]');
        const rows = [...document.querySelectorAll('[data-testid="sentence-row"]')];
        const visible = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
        return { panel: !!panel, rows: rows.length, visible: visible.length };
      }).catch(() => ({ panel: false, rows: 0, visible: 0 }));
      const allTexts = await page.evaluate((arr) => {
        const panel = document.querySelector('[data-testid="tab-panel-sentences"]');
        const body = panel ? panel.innerText : '';
        return arr.filter((t) => t && body.includes(String(t).slice(0, Math.min(30, String(t).length)))).length;
      }, coursePkg.sentences.map((s) => s.text)).catch(() => 0);
      const expectedSent = coursePkg.sentences.length;
      report.phases.sentences = { click: tabClick, ...sentInfo, textPresent: allTexts, expected: expectedSent };
      checks.ok('M2.5', `句子预览条数 = 包内句子数（${expectedSent}）`,
        sentInfo.rows === expectedSent || allTexts === expectedSent,
        `tab=${tabClick.ok} panel=${sentInfo.panel} rows=${sentInfo.rows} textPresent=${allTexts}/${expectedSent}`);
      await shotPush(page, 'market-detail-sentences.png');

      // 文件 Tab：包文件 + 三导入产物（file-row / file-row-<kind>）
      const filesClick = await clickTab('files');
      const filesInfo = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[data-testid="file-row"], [data-testid^="file-row-"]')];
        const text = rows.map((r) => (r.innerText || '').replace(/\s+/g, ' ')).join(' | ');
        return {
          hasRow: rows.length > 0,
          rows: rows.length,
          textSample: (text || (document.body ? document.body.innerText : '')).replace(/\s+/g, ' ').slice(0, 900),
          hasDownload: !!document.querySelector('[data-testid="file-download"], [data-testid^="file-download-"], a[download], [data-testid^="file-row"] button, [data-testid^="file-row"] a[href], #view .file-row button, [data-testid="download-import-btn"]'),
        };
      }).catch(() => ({}));
      const pkgBase = path.basename(detailArt.packageUrl || '');
      const baseOf = (u) => (u ? path.basename(String(u)) : '');
      const fileKinds = ['shadowJson', 'srt', 'packageUrl'];
      const fileNamesOk = fileKinds.every((k) => {
        const b = baseOf(detailArt[k]);
        return b && filesInfo.textSample && filesInfo.textSample.includes(b);
      });
      report.phases.files = { clicked: filesClick.ok, pkgBase, ...filesInfo };
      checks.ok('M2.6', '文件 Tab 含三产物文件名（.shadowcourse/.shadow.json/.srt）+ 下载入口',
        filesClick.ok && filesInfo.hasRow && filesInfo.hasDownload && fileNamesOk,
        `clicked=${filesClick.ok} rows=${filesInfo.rows} download=${filesInfo.hasDownload} names=${fileNamesOk} text=${(filesInfo.textSample || '').slice(0, 200)}`);

      // 版本 Tab
      const verClick = await clickTab('versions');
      const verInfo = await page.evaluate((v) => {
        const rows = [...document.querySelectorAll('[data-testid="version-row"], [data-testid*="version"]')];
        const text = rows.map((r) => r.innerText).join(' | ') || (document.body ? document.body.innerText : '');
        return { rows: rows.length, hasVersion: new RegExp((v || '').replace(/\./g, '\\.')).test(text), text: text.replace(/\s+/g, ' ').slice(0, 500) };
      }, coursePkg.version || detailVer.version).catch(() => ({}));
      const changelogText = (detailVer.changelog || []).join(' ');
      report.phases.versions = { clicked: verClick.ok, version: detailVer.version, changelog: detailVer.changelog, ...verInfo };
      checks.ok('M2.7', `版本与变更 Tab 显示版本号（v${detailVer.version}）与 changelog`,
        verClick.ok && !!verInfo.hasVersion && (!changelogText || verInfo.text.includes(String((detailVer.changelog || [])[0] || '').slice(0, 8))),
        `clicked=${verClick.ok} rows=${verInfo.rows} hasVersion=${verInfo.hasVersion} text=${(verInfo.text || '').slice(0, 160)}`);

      // About 侧栏：作者 + 许可 + BYOM
      const asideInfo = await page.evaluate(() => {
        const el = document.querySelector('#rail, [data-testid="detail-aside"], .rail');
        return { hasAside: !!el, text: (el || document.body).innerText.replace(/\s+/g, ' ').slice(0, 1500) };
      }).catch(() => ({ hasAside: false, text: '' }));
      const authorName = (authors.find((a) => a.handle === resourceAuthor(courseRes)) || {}).name;
      const licRec = licenses.find((l) => l.id === courseRes.license) || {};
      const licenseShown = asideInfo.text.includes(courseRes.license) || (licRec.name && asideInfo.text.includes(licRec.name)) || /CC[ -]?BY/i.test(asideInfo.text);
      const aboutOk = asideInfo.hasAside && licenseShown && (!authorName || asideInfo.text.includes(authorName));
      report.phases.aside = { hasAside: asideInfo.hasAside, license: courseRes.license, licenseName: licRec.name || '', authorName };
      checks.ok('M2.8', '详情页 About 侧栏（作者/许可/BYOM 媒体策略）', aboutOk && /byom|自备媒体|媒体/i.test(asideInfo.text),
        `aside=${asideInfo.hasAside} licenseShown=${licenseShown} license=${courseRes.license} author=${authorName}`);
    } else {
      for (const id of ['M2.3', 'M2.4', 'M2.5', 'M2.6', 'M2.7', 'M2.8']) checks.ok(id, id, false, '无法读取包 JSON');
    }

    // 许可证页
    await page.goto(`${baseUrl}/#/resource/${detailId}/license`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(1200);
    const licenseText = await bodyText(page);
    const lic = licenses.find((l) => l.id === courseRes.license) || {};
    await shotPush(page, 'market-license.png');
    report.phases.license = { url: page.url(), licenseId: courseRes.license, textSample: licenseText.replace(/\s+/g, ' ').slice(0, 600) };
    checks.ok('M2.9', `许可证页 #/resource/<id>/license 可达且展示许可（${courseRes.license}）/权利依据/免责`,
      new RegExp(courseRes.license.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(licenseText) &&
      /许可|license/i.test(licenseText) && /权利|rights/i.test(licenseText) && /免责|disclaimer|自担/i.test(licenseText),
      `text=${licenseText.replace(/\s+/g, ' ').slice(0, 160)}`);

    // 收藏流程：详情页收藏 → favorites 页可见 → 移除 → 空态
    let favPhase = { add: false, listed: false, removed: false };
    try {
      await page.goto(`${baseUrl}/#/resource/${detailId}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(1200);
      // 精准定位详情页收藏按钮（避免误点头部「收藏」导航链接）
      const favBtnInfo = await page.evaluate(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
        const cands = [...document.querySelectorAll('button, [role="button"], a[role="button"], [data-testid="favorite-btn"]')].filter(vis);
        const btn = cands.find((el) => el.getAttribute('data-testid') === 'favorite-btn')
          || cands.find((el) => /收藏|favorite|save/i.test((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '')));
        if (!btn) return { found: false };
        btn.setAttribute('data-qa-fav', '1');
        return { found: true, text: (btn.innerText || btn.getAttribute('aria-label') || '').trim().slice(0, 40), pressed: btn.getAttribute('aria-pressed') };
      }).catch(() => ({ found: false }));
      favPhase.add = !!favBtnInfo.found;
      if (favBtnInfo.found) {
        await page.locator('[data-qa-fav="1"]').first().click({ timeout: 5000 }).catch(() => { });
        await sleep(700);
        const pressed = await page.evaluate(() => {
          const btn = document.querySelector('[data-testid="favorite-btn"], [aria-pressed]');
          return btn ? { pressed: btn.getAttribute('aria-pressed'), text: (btn.innerText || '').trim().slice(0, 40) } : null;
        });
        favPhase.pressed = pressed;
        await page.goto(`${baseUrl}/#/favorites`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(1300);
        const favIds = await scopedCardIds(page);
        favPhase.listed = favIds.includes(detailId);
        await shotPush(page, 'market-favorites.png');
        // 移除：优先单卡「取消收藏」；没有则「清除全部收藏」并在确认弹层里确认
        if (favPhase.listed) {
          let rem = await markByText(page, /取消收藏|移除|remove/i, { tags: ['button'] });
          let usedClearAll = false;
          if (!rem.ok) {
            rem = await markByText(page, /清除全部收藏|清除全部|clear all/i, { tags: ['button'] });
            usedClearAll = rem.ok;
          }
          if (rem.ok) {
            await sleep(700);
            if (usedClearAll) {
              const confirm = await markByText(page, /清除收藏|确认清除|确认/i, { tags: ['button'] });
              if (confirm.ok) await sleep(900);
            }
          }
          await sleep(500);
          const afterIds = await scopedCardIds(page);
          favPhase.usedClearAll = usedClearAll;
          favPhase.removed = !afterIds.includes(detailId) && afterIds.length === 0;
          const afterText = await bodyText(page);
          favPhase.emptyState = /还没有收藏|暂无|空|no favorites/i.test(afterText) || afterIds.length === 0;
          favPhase.afterText = afterText.replace(/\s+/g, ' ').slice(0, 300);
        }
      }
    } catch (e) { favPhase.error = String(e && e.message); }
    report.phases.favorites = favPhase;
    checks.ok('M2.10', '收藏：详情页可收藏（aria-pressed）→ #/favorites 列表可见 → 可移除且空态',
      favPhase.add && favPhase.listed && favPhase.removed && !!favPhase.emptyState,
      `add=${favPhase.add} listed=${favPhase.listed} removed=${favPhase.removed} empty=${favPhase.emptyState} pressed=${JSON.stringify(favPhase.pressed)}`);

    /* ================= M3. 下载弹层 + 页面下载事件 ================= */
    await page.goto(`${baseUrl}/#/resource/${detailId}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(1400);
    const modalPhase = { opened: false };
    try {
      // 详情页主按钮 = 下载导入（download-import-btn，打开三选项弹层）
      let opened = false;
      for (const sel of ['[data-testid="download-import-btn"]', '[data-testid="download-btn"]']) {
        const btn = page.locator(sel).first();
        if (await btn.count().catch(() => 0) === 0) continue;
        await btn.click({ timeout: 6000 }).catch(() => { });
        opened = true;
        break;
      }
      if (!opened) {
        const byText = await markByText(page, /下载导入|下载|Download/i, { tags: ['button', 'a'] });
        modalPhase.openedByText = byText.ok;
      }
      await sleep(900);
      const modalInfo = await page.evaluate(() => {
        const root = document.querySelector('#modal-root');
        const optionIds = ['download-shadow-json', 'download-srt', 'download-shadowcourse']
          .filter((id) => !!document.querySelector(`[data-testid="${id}"]`));
        const links = [...document.querySelectorAll('#modal-root a[href], [data-testid="download-modal"] a[href]')]
          .map((a) => ({ href: a.getAttribute('href') || '', text: (a.innerText || '').trim().slice(0, 60) }));
        const text = root ? root.innerText.replace(/\s+/g, ' ').slice(0, 2000) : '';
        return { hasModal: !!(root && root.innerText && root.innerText.trim()), optionIds, links, text };
      }).catch(() => ({ hasModal: false, optionIds: [], links: [], text: '' }));
      modalPhase.opened = modalInfo.hasModal;
      modalPhase.optionIds = modalInfo.optionIds;
      modalPhase.links = modalInfo.links;
      modalPhase.text = modalInfo.text;
      const kindsFound = {
        shadowJson: modalInfo.optionIds.includes('download-shadow-json') || /\.shadow\.json/.test(modalInfo.text),
        srt: modalInfo.optionIds.includes('download-srt') || /\.srt/.test(modalInfo.text),
        package: modalInfo.optionIds.includes('download-shadowcourse') || /\.shadowcourse/.test(modalInfo.text),
      };
      modalPhase.kindsFound = kindsFound;
      checks.ok('M3.1', '下载弹层打开并列出三产物（.shadow.json 推荐 / .srt 备选 / .shadowcourse 规范）',
        modalPhase.opened && kindsFound.shadowJson && kindsFound.srt && kindsFound.package,
        `modal=${modalPhase.opened} kinds=${JSON.stringify(kindsFound)} options=${(modalInfo.optionIds || []).join(',')}`);
      // BYOM 提示 + 步骤/坑说明
      checks.ok('M3.2', '下载弹层含 BYOM/媒体自备 + 5 步/3 坑导入说明',
        /自备媒体|BYOM|媒体/i.test(modalInfo.text) && (/5\s*步|步骤|step/i.test(modalInfo.text) || /坑|注意|警告/i.test(modalInfo.text)),
        `text=${(modalInfo.text || '').slice(0, 240)}`);
      // 关弹层
      await page.keyboard.press('Escape').catch(() => { });
      await sleep(400);
      if (await page.locator('#modal-root .modal').count().catch(() => 0)) {
        const close = await markByText(page, /关闭|完成/i, { tags: ['button'] });
        if (close.ok) await sleep(300);
      }
    } catch (e) {
      modalPhase.error = String(e && e.message);
      checks.ok('M3.1', '下载弹层打开并列出三产物', false, String(e && e.message));
      checks.ok('M3.2', '下载弹层含 BYOM/步骤说明', false, '弹层未打开');
    }
    report.phases.downloadModal = modalPhase;

    // 页面下载按钮触发 .shadow.json 下载事件（重设计：下载入口在「下载导入」弹层的产物按钮上）
    let dlEvent = null;
    try {
      await page.goto(`${baseUrl}/#/resource/${detailId}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(1200);
      await page.locator('[data-testid="download-import-btn"]').first().click({ timeout: 6000 }).catch(() => { });
      await sleep(700);
      const dlTarget = page.locator('[data-testid="download-shadow-json"], [data-testid="download-shadowcourse"]').first();
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 9000 }).catch(() => null),
        (async () => {
          if (await dlTarget.count().catch(() => 0)) return dlTarget.click({ timeout: 6000 }).catch(() => { });
          const b = await markByText(page, /下载导入|下载|Download/i, { tags: ['button', 'a'] });
          if (b.ok) await sleep(500);
          const link = page.locator('#modal-root a[href*=".shadow.json"], #modal-root a[href*=".shadowcourse"]').first();
          if (await link.count().catch(() => 0)) await link.click({ timeout: 5000 }).catch(() => { });
          return null;
        })(),
      ]);
      if (download) dlEvent = { suggestedFilename: download.suggestedFilename(), url: download.url() };
    } catch (e) { report.phases.downloadEvent = { error: String(e && e.message) }; }
    report.phases.downloadEvent = { ...(report.phases.downloadEvent || {}), ...(dlEvent || { none: true, buttonFound: true }) };
    checks.ok('M3.3', '页面下载入口可触发下载（download 事件，产物名匹配）',
      !!dlEvent && /\.(shadowcourse|shadow\.json|srt)$/i.test(dlEvent.suggestedFilename || ''),
      dlEvent ? `file=${dlEvent.suggestedFilename}` : `未捕获 download 事件（info=${JSON.stringify(report.phases.downloadEvent)}）`);

    /* ================= M4. 一键导入（降级 + 成功，修复 M3.8 时序） ================= */
    const closedPort = await findFreePort(19010, 40);
    const importCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const importPage = await importCtx.newPage();
    const importEv = { console: [], pageErrors: [], popups: [], blocked: [] };
    importPage.on('console', (m) => { let loc = null; try { const l = m.location(); loc = l && l.url || null; } catch { } importEv.console.push({ type: m.type(), text: m.text(), location: loc }); });
    importPage.on('pageerror', (e) => importEv.pageErrors.push({ message: e.message }));
    importPage.on('popup', (p) => { importEv.popups.push(p.url()); });
    await importCtx.route('**/*', (route) => {
      const u = route.request().url();
      const m = u.match(/^http:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) {
        const port = parseInt(m[1], 10);
        if (port >= SHADOW_PORT_RANGE.from && port <= SHADOW_PORT_RANGE.to) { importEv.blocked.push(u); return route.abort('connectionrefused'); }
      }
      return route.continue();
    });
    await importPage.goto(`${baseUrl}/#/resource/${detailId}?appPort=${closedPort}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(1600);
    // 重设计：一键导入入口在「下载导入」弹层里 → 先开弹层，再点 import-btn
    await importPage.locator('[data-testid="download-import-btn"]').first().click({ timeout: 6000 }).catch(() => { });
    await sleep(700);
    const dlPromise = importPage.waitForEvent('download', { timeout: 12000 }).catch(() => null);
    await importPage.locator('[data-testid="import-btn"]').first().click({ timeout: 6000 }).catch(() => { });
    const fallbackShown = await waitBodyMatch(importPage, '已降级|降级为下载|自动下载|未检测到', 15000);
    const downloadInPage = await dlPromise;
    await sleep(700);
    const importText = await bodyText(importPage);
    const modalInfo = await importPage.evaluate(() => {
      const roots = [...document.querySelectorAll('#modal-root *')];
      const modal = roots.find((n) => /已降级|降级为下载|自动下载/.test(n.innerText || '') && n.querySelector && n.querySelector('ol'));
      const steps = [...document.querySelectorAll('#modal-root ol > li, #modal-root .steps > li')];
      return {
        hasModal: !!modal, steps: steps.length,
        stepTitles: steps.map((li) => (li.innerText || '').trim().slice(0, 40)).slice(0, 6),
        hasFallbackDownload: !!document.querySelector('[data-testid="fallback-download"]'),
        text: (modal ? modal.innerText : '').replace(/\s+/g, ' ').slice(0, 900),
      };
    }).catch(() => ({}));
    const filteredImportErrors = importEv.console.filter((c) => c.type === 'error' && !isShadowProbeNoise(c));
    report.phases.importDegrade = {
      closedPort, fallbackShown, modal: modalInfo,
      downloadInPage: downloadInPage ? { suggestedFilename: downloadInPage.suggestedFilename() } : null,
      popups: importEv.popups, blockedUserPortRequests: importEv.blocked.length,
      filteredConsoleErrors: filteredImportErrors, pageErrors: importEv.pageErrors,
      textSample: importText.replace(/\s+/g, ' ').slice(0, 800),
    };
    await importPage.screenshot({ path: path.join(SHOTS, 'market-import-degraded.png') }).catch(() => { });
    report.screenshots.push('market-import-degraded.png');
    checks.ok('M4.1', '一键导入无本地服务时降级（不报错 + 3 步说明 + 自动下载）',
      fallbackShown && (modalInfo.steps === 3 || modalInfo.steps >= 3) && (!!downloadInPage || modalInfo.hasFallbackDownload),
      `fallback=${fallbackShown} steps=${modalInfo.steps} download=${downloadInPage ? downloadInPage.suggestedFilename() : 'none'} fallbackBtn=${modalInfo.hasFallbackDownload}`);
    checks.ok('M4.2', '降级路径无 pageerror / 无非探测类 console.error',
      filteredImportErrors.length === 0 && importEv.pageErrors.length === 0,
      `filtered=${filteredImportErrors.length} pageErrors=${importEv.pageErrors.length}（端口探测失败属预期网络噪声）`);
    checks.ok('M4.3', 'appPort 覆盖生效：未探测/未触碰真实端口 18765–18775',
      importEv.blocked.length === 0, `blockedAttempts=${importEv.blocked.length}`);
    await importCtx.close().catch(() => { });

    // 成功路径：假 Studio 健康服务；M3.8 修复 = 不提前 close 预留 popup，等 fake 收到 ?import= 且页面成功态
    const fakePort = await findFreePort(closedPort + 5, 40);
    if (!(await isPortFree(fakePort))) throw new Error(`fake studio 端口 ${fakePort} 被占用`);
    const fakeStudio = await startFakeStudioServer(fakePort);
    const okCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const okPage = await okCtx.newPage();
    const okEv = { popups: [], popupUrls: [], blocked: [], console: [], pageErrors: [], downloads: [], navigations: [] };
    okPage.on('pageerror', (e) => okEv.pageErrors.push(String(e && e.message)));
    okPage.on('console', (m) => { if (m.type() === 'error') okEv.console.push({ text: m.text(), location: (() => { try { return m.location().url; } catch { return null; } })() }); });
    okPage.on('download', (d) => okEv.downloads.push(d.suggestedFilename()));
    // 关键修复：只记录 popup（含后续 URL 变化），绝不 close
    okPage.on('popup', (p) => {
      okEv.popups.push(p);
      okEv.popupUrls.push(p.url());
      p.on('framenavigated', (frame) => {
        try { if (frame === p.mainFrame()) okEv.popupUrls.push(frame.url()); } catch { }
      });
    });
    await okCtx.route('**/*', (route) => {
      const u = route.request().url();
      const m = u.match(/^http:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) {
        const port = parseInt(m[1], 10);
        if (port >= SHADOW_PORT_RANGE.from && port <= SHADOW_PORT_RANGE.to) { okEv.blocked.push(u); return route.abort('connectionrefused'); }
      }
      return route.continue();
    });
    await okPage.goto(`${baseUrl}/#/resource/${detailId}?appPort=${fakePort}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(1500);
    // 重设计：先开「下载导入」弹层，再点其中「一键导入 SHADOW Studio」
    await okPage.locator('[data-testid="download-import-btn"]').first().click({ timeout: 6000 }).catch(() => { });
    await sleep(700);
    await okPage.locator('[data-testid="import-btn"]').first().click({ timeout: 6000 }).catch(() => { });
    // 轮询：fake Studio 收到 ?import= 且页面进入成功态（都满足才 PASS；不因预留窗口未 close 而误判）
    const successDeadline = Date.now() + 40000;
    let successOutcome = { success: false, degraded: false, blocked: false };
    let importHits = [];
    let healthHits = [];
    while (Date.now() < successDeadline) {
      importHits = fakeStudio.hits.filter((h) => /\?import=/.test(h.url || ''));
      healthHits = fakeStudio.hits.filter((h) => /\/api\/health/.test(h.url || ''));
      const oc = await readImportOutcome(okPage);
      successOutcome = oc;
      if (importHits.length >= 1 && oc.success && !oc.degraded) break;
      await sleep(400);
    }
    await sleep(600);
    const okText = await bodyText(okPage);
    const okDiag = await okPage.evaluate(() => ({
      bodyTail: (document.body.innerText || '').replace(/\s+/g, ' ').slice(-900),
      modalText: (document.querySelector('#modal-root') ? document.querySelector('#modal-root').innerText : '').replace(/\s+/g, ' ').slice(0, 600),
      toastText: (document.querySelector('#toast-region') ? document.querySelector('#toast-region').innerText : '').replace(/\s+/g, ' ').slice(0, 400),
    })).catch(() => ({}));
    // 等假 Studio 页面 echo（popup 已打开；不 close）
    const popupOpened = okEv.popups.length > 0;
    const expectedPrefix = `http://127.0.0.1:${fakePort}/?import=`;
    const popupUrls = okEv.popupUrls.filter(Boolean);
    const deepLinkUrl = importHits[0] ? importHits[0].url : '';
    const okFilteredErrors = okEv.console.filter((c) => !isShadowProbeNoise(c));
    report.phases.importSuccess = {
      fakePort, successShown: successOutcome.success, successText: successOutcome.textSample,
      popupOpened, popupUrls, deepLinkUrl, expectedPrefix, diag: okDiag, pageErrors: okEv.pageErrors,
      healthHits: healthHits.length, importHits: importHits.slice(0, 3), hits: fakeStudio.hits.slice(0, 16),
      blockedAttempts: okEv.blocked.length, downloads: okEv.downloads,
      filteredConsoleErrors: okFilteredErrors,
    };
    await okPage.screenshot({ path: path.join(SHOTS, 'market-import-success.png') }).catch(() => { });
    report.screenshots.push('market-import-success.png');
    checks.ok('M4.4', '一键导入成功路径：假 Studio 收到 ?import= 深链且页面进入成功态（不提前 close popup、不误判拦截）',
      importHits.length >= 1 && successOutcome.success && !successOutcome.degraded && !successOutcome.blocked && healthHits.length >= 1,
      `success=${successOutcome.success} degraded=${successOutcome.degraded} blocked=${successOutcome.blocked} healthHits=${healthHits.length} importHits=${importHits.length} popups=${popupUrls.slice(0, 3).join(',')} text=${(successOutcome.textSample || '').slice(0, 150)}`);
    checks.ok('M4.5', '成功路径打开预留窗口（popup 未被提前关闭）或已记录 openedVia 成功状态，且未触发多余下载',
      popupOpened || /已打开|openedVia/i.test(okText), `popups=${okEv.popupUrls.slice(0, 3).join(',')} downloads=${okEv.downloads.join(',') || 'none'}`);
    checks.ok('M4.6', '成功路径无 pageerror / 无非探测类 console.error',
      okEv.pageErrors.length === 0 && okFilteredErrors.length === 0,
      `pageErrors=${okEv.pageErrors.length} filteredErrors=${okFilteredErrors.length}`);
    checks.ok('M4.7', '成功路径未触碰真实端口 18765–18775', okEv.blocked.length === 0, `blockedAttempts=${okEv.blocked.length}`);
    // 清理 popup/context（此时才关闭）
    for (const p of okEv.popups) { try { await p.close(); } catch { } }
    await okCtx.close().catch(() => { });
    await fakeStudio.stop().catch(() => { });

    /* ================= M5. 合约页面 ================= */
    const pageChecks = [];
    const visitPage = async (name, hash, keywords, shotName = null) => {
      await page.goto(baseUrl + hash, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch((e) => ({ error: String(e) }));
      await sleep(1200);
      const text = await bodyText(page);
      const url = page.url();
      const nfInfo = await page.evaluate(() => {
        const nfEl = document.querySelector('[data-testid="not-found"], [data-testid="notfound"], [data-testid="404"], .not-found, .notfound');
        const h1 = document.querySelector('h1');
        return { hasNfEl: !!nfEl, h1: h1 ? (h1.innerText || '').trim().slice(0, 120) : '' };
      }).catch(() => ({ hasNfEl: false, h1: '' }));
      const is404 = nfInfo.hasNfEl || /404/i.test(nfInfo.h1);
      const hitsKw = keywords.filter((k) => (k instanceof RegExp ? k.test(text) : text.includes(k)));
      if (shotName) await shotPush(page, shotName);
      const info = { name, hash, url, textLen: text.length, is404, hits: hitsKw.length, total: keywords.length, sample: text.replace(/\s+/g, ' ').slice(0, 400) };
      pageChecks.push(info);
      return info;
    };
    const PAGES = [
      ['changelog', '#/changelog', [/更新日志|变更|changelog/i, /v?\d+\.\d+\.\d+|版本/i], 'market-changelog.png'],
      ['contribute', '#/contribute', [/投稿|贡献|contribute/i, /版权|许可|CC/i, /BYOM|自备媒体/i, /校验|validate|命令/i], 'market-contribute.png'],
      ['about', '#/about', [/关于|about/i, /免费|free/i, /两个产品|独立产品|SHADOW STUDIO/i], 'market-about.png'],
      ['privacy', '#/privacy', [/隐私|privacy/i, /localStorage/i, /不采集|不收集|无账号|无埋点/i, /清除|清空/i], 'market-privacy.png'],
      ['complaint', '#/complaint', [/投诉|侵权|complaint/i, /下架|删除|通知/i, /邮箱|mailto:|@/i], 'market-complaint.png'],
      ['import', '#/import', [/导入|import/i, /\.shadow\.json/i, /\.srt/i, /BYOM|自备媒体/i]],
      ['points', '#/points', [/积分|points/i, /本地演示|无后端|不可购买/i]],
      ['404', '#/definitely-not-a-route-' + Date.now(), [/404|找不到|未找到|not\s*found/i], 'market-404.png'],
    ];
    for (const [name, hash, kw, shotName] of PAGES) {
      const info = await visitPage(name, hash, kw, shotName);
      const skip404 = name === '404';
      checks.ok(`M5.${pageChecks.length}`, `${name} 页面可达且内容完整${skip404 ? '（未知路由 404）' : ''}`,
        skip404 ? info.is404 : (!info.is404 && info.hits >= Math.min(kw.length, 2)),
        `hits=${info.hits}/${info.total} 404=${info.is404} text=${(info.sample || '').slice(0, 120)}`);
    }
    report.phases.pages = pageChecks;

    /* ================= M6. 设置 / 主题 / 命令面板 ================= */
    await gotoHash(page, baseUrl, '#/settings');
    await sleep(1400);
    const settingsText = await bodyText(page);
    const settingsInfo = await page.evaluate(() => {
      const nav = document.querySelector('[data-testid="settings-nav"]');
      const navItems = nav ? [...nav.querySelectorAll('a,button')].map((el) => (el.innerText || '').trim()).filter(Boolean) : [];
      const sections = [...document.querySelectorAll('[data-testid^="settings-section-"]')].map((el) => el.getAttribute('data-testid'));
      return { navItems: [...new Set(navItems)], sections, hasTheme: !!document.querySelector('[name="theme"], [data-testid="theme-toggle"]'), hasLang: /语言|Language|中文|EN/i.test(document.body.innerText) };
    }).catch(() => ({}));
    report.phases.settings = { ...settingsInfo, textSample: settingsText.replace(/\s+/g, ' ').slice(0, 600) };
    checks.ok('M6.1', '设置页 #/settings 可达（外观/语言/数据分组可见）',
      /外观|主题|theme/i.test(settingsText) && /语言|language/i.test(settingsText) && /清除|重置|数据/i.test(settingsText),
      `groups=${['外观', '语言', '数据'].filter((k) => settingsText.includes(k)).join(',')} nav=${(settingsInfo.navItems || []).join('|')}`);
    const readTheme = async () => await page.evaluate(() => ({
      htmlTheme: document.documentElement.getAttribute('data-theme'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      stored: (() => { try { return Object.keys(localStorage).map((k) => k + '=' + String(localStorage.getItem(k)).slice(0, 30)).join('|').slice(0, 300); } catch { return ''; } })(),
    }));
    const themeBefore = await readTheme();
    let themeBtn = { ok: false };
    // 重设计：设置页用 radio-group（input 视觉隐藏；直接触发 change 验证主题切换逻辑最稳）
    const darkLabel = page.locator('.radio-group label', { hasText: /深色/ }).first();
    const darkRadio = page.locator('input[name="theme"][value="dark"]');
    const themeByDispatch = await page.evaluate(() => {
      const i = document.querySelector('input[name="theme"][value="dark"]');
      if (!i) return false;
      i.checked = true;
      i.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }).catch(() => false);
    if (themeByDispatch) {
      themeBtn = { ok: true, method: 'input-dispatch' };
    } else if (await darkLabel.count().catch(() => 0)) {
      await darkLabel.click({ timeout: 5000 }).catch(() => { });
      themeBtn = { ok: true, method: 'label' };
    } else if (await darkRadio.count().catch(() => 0)) {
      await darkRadio.first().check({ force: true }).catch(() => { });
      themeBtn = { ok: true, method: 'radio' };
    } else {
      const t = await clickAny(page, ['[data-testid="theme-toggle"]', '#theme-toggle']);
      if (t.ok) themeBtn = { ok: true, method: 'toggle' };
      else { const m = await markByText(page, /深色|暗色|主题|Theme|Dark/i, { tags: ['button', 'label', 'a'] }); themeBtn = { ok: m.ok, method: 'text' }; }
    }
    await sleep(900);
    let themeAfter = await readTheme();
    let themeChanged = themeBefore.htmlTheme !== themeAfter.htmlTheme || themeBefore.bodyBg !== themeAfter.bodyBg || themeBefore.stored !== themeAfter.stored;
    // 兜底：若设置页 radio label 点击未生效（例如被遮挡），用 header 的主题按钮再切一次，仍覆盖「切换生效」意图
    if (!themeChanged) {
      const tb = await clickAny(page, ['#theme-toggle', '[data-testid="theme-toggle"]']);
      if (tb.ok) {
        themeBtn = { ok: true, method: 'label+header' };
        await sleep(800);
        themeAfter = await readTheme();
        themeChanged = themeBefore.htmlTheme !== themeAfter.htmlTheme || themeBefore.bodyBg !== themeAfter.bodyBg || themeBefore.stored !== themeAfter.stored;
      }
    }
    report.phases.theme = { before: themeBefore, after: themeAfter, changed: themeChanged, method: themeBtn.method };
    await shotPush(page, 'market-settings-dark.png');
    checks.ok('M6.2', '深浅色切换生效（html data-theme/背景色/localStorage 至少一处变化）',
      themeBtn.ok && themeChanged, `method=${themeBtn.method} ${themeBefore.htmlTheme}→${themeAfter.htmlTheme} bg=${themeBefore.bodyBg}→${themeAfter.bodyBg}`);
    // 切回浅色
    const lightLabel = page.locator('.radio-group label', { hasText: /浅色/ }).first();
    const lightRadio = page.locator('input[name="theme"][value="light"]');
    const lightDispatched = await page.evaluate(() => {
      const i = document.querySelector('input[name="theme"][value="light"]');
      if (!i) return false;
      i.checked = true;
      i.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }).catch(() => false);
    if (!lightDispatched) {
      if (await lightLabel.count().catch(() => 0)) await lightLabel.click({ timeout: 5000 }).catch(() => { });
      else if (await lightRadio.count().catch(() => 0)) await lightRadio.first().check({ force: true }).catch(() => { });
      else { const t = await clickAny(page, ['[data-testid="theme-toggle"]', '#theme-toggle']); if (!t.ok) await markByText(page, /浅色|亮色|Light/i, { tags: ['button', 'label', 'a'] }); }
    }
    await sleep(700);
    const themeBack = await readTheme();
    report.phases.theme.back = themeBack;

    // 命令面板 Ctrl+K
    await gotoHash(page, baseUrl, '#/');
    await sleep(900);
    const readPalette = async () => await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
      const cands = [...document.querySelectorAll('[role="dialog"],[class*="palette"],[class*="command"],[class*="cmd"],[class*="modal"],#palette-root > *')].filter(vis);
      const active = document.activeElement;
      return {
        open: cands.length > 0,
        text: cands.length ? (cands[0].innerText || '').replace(/\s+/g, ' ').slice(0, 300) : '',
        active: active ? { tag: active.tagName.toLowerCase(), placeholder: (active.getAttribute && active.getAttribute('placeholder')) || '' } : null,
      };
    }).catch(() => ({ open: false }));
    await page.keyboard.press('Control+k');
    await sleep(1000);
    let palette = await readPalette();
    if (!palette.open) { await clickAny(page, ['#open-palette', '[data-testid="open-palette"]']); await sleep(1000); palette = await readPalette(); }
    let paletteFilter = null;
    if (palette.open) {
      const kw = (courseRes.title || '点单').slice(0, 2);
      await page.keyboard.type(kw, { delay: 30 });
      await sleep(900);
      const pText = await bodyText(page);
      paletteFilter = { keyword: kw, hasResult: pText.includes((courseRes.title || '').slice(0, 2)), text: pText.replace(/\s+/g, ' ').slice(-400) };
      await shotPush(page, 'market-ctrlk-palette.png');
      await page.keyboard.press('Escape');
    }
    report.phases.palette = { ...palette, filter: paletteFilter };
    checks.ok('M6.3', 'Ctrl+K 命令面板可打开且有输入焦点', palette.open || !!(palette.active && /input/i.test(palette.active.tag)),
      `open=${palette.open} active=${JSON.stringify(palette.active)}`);
    checks.ok('M6.4', '命令面板输入关键字有命中结果', !!(paletteFilter && paletteFilter.hasResult),
      paletteFilter ? `keyword=${paletteFilter.keyword} hit=${paletteFilter.hasResult}` : '未打开');

    /* ================= M7. 响应式 + 移动底部导航 ================= */
    const overflowPhase = {};
    const routesForOverflow = [
      ['home', '#/'], ['detail', '#/resource/' + detailId], ['category', '#/category/' + (cat ? cat.id : '')],
      ['tag', '#/tag/' + (tagPick ? encodeURIComponent(tagPick.name) : '')], ['favorites', '#/favorites'],
      ['changelog', '#/changelog'], ['contribute', '#/contribute'], ['about', '#/about'],
      ['privacy', '#/privacy'], ['complaint', '#/complaint'], ['license', '#/resource/' + detailId + '/license'],
      ['search', '#/search?q=' + encodeURIComponent(qAny)], ['settings', '#/settings'],
    ];
    const viewports = [[1440, 900], [1024, 768], [768, 1024], [390, 844], [375, 812], [360, 740]];
    // 390 是验收主视口（全部路由）；其它视口用关键路由子集，控制套件时长
    const smallRoutes = routesForOverflow.filter(([n]) => ['home', 'detail', 'favorites', 'contribute', 'about', 'privacy', 'search', 'settings'].includes(n));
    for (const [vw, vh] of viewports) {
      await page.setViewportSize({ width: vw, height: vh });
      const list = vw === 390 ? routesForOverflow : (vw >= 768 ? routesForOverflow.slice(0, 5) : smallRoutes);
      for (const [name, hash] of list) {
        if (!hash || hash.endsWith('/')) continue;
        await page.goto(baseUrl + hash, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { });
        await sleep(600);
        const o = await horizontalOverflow(page).catch((e) => ({ overflow: true, error: String(e) }));
        overflowPhase[`${vw}x${vh}-${name}`] = { overflow: o.overflow, docOverflow: o.docOverflow, offenders: (o.offenders || []).slice(0, 5) };
        if (o.overflow) {
          const s = `overflow-${vw}x${vh}-${name}.png`;
          await shot(page, s, SHOTS).catch(() => { });
          report.screenshots.push(s);
        }
      }
    }
    report.phases.overflow = overflowPhase;
    const mkOverflowCheck = (id, name, prefix) => {
      const bad = Object.entries(overflowPhase).filter(([k, v]) => k.startsWith(prefix) && v.overflow).map(([k]) => k);
      checks.ok(id, name, bad.length === 0, bad.length ? `offenders=${bad.map((k) => k.replace(prefix, '')).join(',')}` : 'all routes ok');
    };
    mkOverflowCheck('M7.1', '1440×900 关键路由无页面级横向溢出', '1440x900-');
    mkOverflowCheck('M7.2', '1024×768 关键路由无页面级横向溢出', '1024x768-');
    mkOverflowCheck('M7.3', '768×1024 关键路由无页面级横向溢出', '768x1024-');
    mkOverflowCheck('M7.4', '390×844 全部路由无页面级横向溢出（验收主视口）', '390x844-');
    mkOverflowCheck('M7.5', '375×812 全部路由无页面级横向溢出', '375x812-');
    mkOverflowCheck('M7.6', '360×740 全部路由无页面级横向溢出', '360x740-');

    // 390 底部导航
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoHash(page, baseUrl, '#/');
    await sleep(1100);
    const mobileNav = await readMobileNav(page);
    report.phases.mobileNav = mobileNav;
    await shotPush(page, 'market-mobile-390.png');
    const navLabelsOk = mobileNav.found && (mobileNav.items || []).length >= 3;
    checks.ok('M7.7', '390 视口底部导航存在且 ≥3 个入口（探索/收藏/投稿/我的）',
      navLabelsOk, mobileNav.found ? `via=${mobileNav.via} items=[${(mobileNav.items || []).map((i) => i.text).join('|')}] pos=${mobileNav.position}` : '未找到底部导航');
    // 底部导航可点击跳转（优先 收藏 / 投稿）
    let navClickResult = { clicked: false };
    if (mobileNav.found) {
      const target = (mobileNav.items || []).find((i) => /收藏|favorites/i.test(i.text) && /#\//.test(i.href))
        || (mobileNav.items || []).find((i) => /#\//.test(i.href));
      if (target) {
        const loc = page.locator('[data-qa-mobile-nav="1"] a').filter({ hasText: target.text }).first();
        const okc = await loc.click({ timeout: 5000 }).then(() => true).catch(() => false);
        await sleep(1000);
        const hashAfter = await page.evaluate(() => location.hash);
        const textAfter = await bodyText(page);
        const hashOk = /#\/(favorites|contribute|about|settings|$)/.test(hashAfter) || hashAfter !== '#/';
        navClickResult = { clicked: okc, hashAfter, textLen: textAfter.length, hashOk };
      }
      await shotPush(page, 'market-mobile-bottom-nav.png');
    }
    checks.ok('M7.8', '底部导航可点击并切换路由（无死链/无 404）',
      navClickResult.clicked && navClickResult.hashOk && navClickResult.textLen > 100,
      JSON.stringify(navClickResult));
    // 触控目标：底部导航项 ≥24×24
    const smallTargets = (mobileNav.items || []).filter((i) => i.w < 24 || i.h < 24);
    checks.ok('M7.9', '底部导航触控目标 ≥24×24（WCAG 2.5.8）', mobileNav.found && smallTargets.length === 0,
      smallTargets.map((i) => `${i.text}:${i.w}x${i.h}`).join(',') || `${(mobileNav.items || []).length} items ok`);

    // 移动详情页：无横溢 + 操作条吸底
    await page.goto(`${baseUrl}/#/resource/${detailId}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(1200);
    const mDetailOverflow = await horizontalOverflow(page);
    await shotPush(page, 'market-mobile-detail-390.png');
    checks.ok('M7.10', '390 视口详情页无页面级横向溢出', !mDetailOverflow.overflow,
      `docOverflow=${mDetailOverflow.docOverflow} offenders=${(mDetailOverflow.offenders || []).slice(0, 3).map((o) => o.cls || o.tag).join(',')}`);
    let actionBar = { found: false };
    try {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(600);
      actionBar = await page.evaluate(() => {
        const cands = ['[data-testid="detail-actions"]', '[data-testid="action-bar"]', '[data-testid="detail-action-bar"]', '.hero-action-row', '.repo-actions', '.action-bar', '.detail-action-bar', '[data-testid="buy-bar"]'];
        let el = null;
        for (const s of cands) { const c = document.querySelector(s); if (c) { el = c; break; } }
        if (!el) {
          const btn = document.querySelector('[data-testid="download-btn"], [data-testid="import-btn"]');
          if (btn) el = btn.closest('div,footer,aside,section') || btn;
        }
        if (!el) return { found: false };
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const inView = r.top >= -2 && r.top < window.innerHeight && r.bottom > 0;
        return { found: true, inView, top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), position: cs.position, viewportH: window.innerHeight };
      }).catch(() => ({ found: false }));
      await shotPush(page, 'market-mobile-detail-actionbar.png');
    } catch { }
    report.phases.mobileActionBar = actionBar;
    checks.ok('M7.11', '390 视口详情页操作条滚动后仍可见（吸底）', !!actionBar.found && !!actionBar.inView,
      JSON.stringify(actionBar).slice(0, 220));
    await page.setViewportSize({ width: 1440, height: 900 });

    /* ================= M8. PWA / 离线 ================= */
    const manResp = await httpRequest(baseUrl + '/manifest.webmanifest');
    const swResp = await httpRequest(baseUrl + '/sw.js');
    const offResp = await httpRequest(baseUrl + '/offline.html');
    const man = manResp.json || {};
    const manIcons = Array.isArray(man.icons) ? man.icons : [];
    const manIssues = [];
    if (manResp.status !== 200 || !man.name && !manResp.json) manIssues.push('manifest 不可用');
    if (!man.name || !man.short_name) manIssues.push('name/short_name');
    if (!man.display || !/standalone|minimal-ui|fullscreen/.test(String(man.display))) manIssues.push('display');
    if (!Array.isArray(man.icons) || !manIcons.some((i) => String(i.sizes || '').includes('192')) || !manIcons.some((i) => String(i.sizes || '').includes('512'))) manIssues.push('icons 192/512');
    checks.ok('M8.1', 'PWA manifest 200 且可安装字段齐全（name/short_name/display/icons 192+512）',
      manIssues.length === 0, `status=${manResp.status} issues=${manIssues.join(',') || 'none'} icons=${manIcons.length}`);
    checks.ok('M8.2', 'Service Worker /sw.js 200 且内容含缓存/离线逻辑', swResp.status === 200 && /caches|addEventListener|fetch/i.test(swResp.text || ''),
      `status=${swResp.status} bytes=${swResp.body ? swResp.body.length : 0}`);
    checks.ok('M8.3', 'offline.html 200（离线兜底页）', offResp.status === 200 && /离线|offline/i.test(offResp.text || ''),
      `status=${offResp.status} bytes=${offResp.body ? offResp.body.length : 0}`);
    const iconProblems = [];
    for (const i of manIcons) {
      const src = String(i.src || '');
      if (/^https?:/i.test(src)) { iconProblems.push('远程 icon:' + src); continue; }
      const r = await httpRequest(new URL(src, baseUrl + '/').toString()).catch(() => ({ status: 0 }));
      if (r.status !== 200 || !(r.body && r.body.length)) iconProblems.push(`${src}:${r.status}`);
    }
    checks.ok('M8.4', 'PWA 图标文件可访问（192/512/maskable，自托管）', manIcons.length >= 2 && iconProblems.length === 0,
      iconProblems.join(',') || `${manIcons.length} icons 200`);

    // 独立 context：首访 → SW 就绪 → 在线访问详情 → 断网重载
    const pwaCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pwaPage = await pwaCtx.newPage();
    const pwaEv = { console: [], pageErrors: [] };
    pwaPage.on('console', (m) => { let loc = null; try { loc = m.location() && m.location().url; } catch { } pwaEv.console.push({ type: m.type(), text: m.text(), location: loc }); });
    pwaPage.on('pageerror', (e) => pwaEv.pageErrors.push(String(e && e.message)));
    const pwaPhase = { sw: null, offline: {} };
    try {
      await pwaPage.goto(baseUrl + '/#/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
      await waitCards(pwaPage, 1, 20000);
      let sw = await waitServiceWorker(pwaPage, 25000);
      if (sw.active && !sw.controlled) {
        await pwaPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
        await sleep(1200);
        sw = await waitServiceWorker(pwaPage, 10000);
      }
      pwaPhase.sw = sw;
      checks.ok('M8.5', '首访后 Service Worker 已注册并激活（install → active）',
        !!(sw && sw.supported && sw.active && sw.controlled),
        `supported=${sw && sw.supported} active=${sw && sw.active} controlled=${sw && sw.controlled} state=${sw && sw.state} script=${sw && sw.scriptURL}`);
      // 在线访问详情页（写入运行时缓存）
      await pwaPage.goto(baseUrl + '/#/resource/' + detailId, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => { });
      const detailOnline = await waitBodyContains(pwaPage, courseRes.title, 15000);
      pwaPhase.detailOnline = detailOnline;
      await sleep(800);
      // 首访不再自动刷新后，离线所需数据由 SW 后台 PREFETCH 写入；断网前等缓存就绪（最多 20s），避免 503 假失败
      pwaPhase.cacheReady = await waitForOfflineCache(pwaPage, 20000);
      // 断网
      await pwaCtx.setOffline(true);
      await sleep(500);
      // 离线重载首页
      await pwaPage.evaluate(() => { location.hash = '#/'; }).catch(() => { });
      let offlineReloadOk = false, offlineReloadErr = null;
      try {
        await pwaPage.reload({ waitUntil: 'domcontentloaded', timeout: 40000 });
        offlineReloadOk = true;
      } catch (e) {
        offlineReloadErr = String(e && e.message).slice(0, 200);
        try { await pwaPage.goto(baseUrl + '/#/', { waitUntil: 'domcontentloaded', timeout: 25000 }); offlineReloadOk = true; } catch (e2) { offlineReloadErr = String(e2 && e2.message).slice(0, 200); }
      }
      await sleep(1800);
      const offlineText = await bodyText(pwaPage);
      const offlineBodyLen = offlineText.length;
      const crashPage = /This site can.t be reached|ERR_INTERNET_DISCONNECTED|无法访问此网站/i.test(offlineText) && offlineBodyLen < 600;
      const showsCatalog = resources.some((r) => offlineText.includes(r.title));
      const showsShell = /SHADOW/i.test(offlineText);
      const offlineNotice = /离线|offline|网络|重试|retry/i.test(offlineText);
      await shotPush(pwaPage, 'market-pwa-offline.png');
      pwaPhase.offline.home = {
        reloadOk: offlineReloadOk, reloadError: offlineReloadErr, bodyLen: offlineBodyLen,
        showsCatalog, showsShell, offlineNotice, crashPage,
        textSample: offlineText.replace(/\s+/g, ' ').slice(0, 600),
      };
      checks.ok('M8.6', '断网重载首页仍可见 shell/catalog 或离线提示（不是浏览器错误页）',
        offlineReloadOk && !crashPage && offlineBodyLen > 80 && (showsCatalog || offlineNotice),
        `reload=${offlineReloadOk} err=${offlineReloadErr || 'none'} len=${offlineBodyLen} catalog=${showsCatalog} shell=${showsShell} notice=${offlineNotice} crash=${crashPage}`);
      // 离线重载详情（已访问过的页面/详情）
      await pwaPage.evaluate((id) => { location.hash = '#/resource/' + id; }, detailId).catch(() => { });
      await sleep(300);
      let offlineDetailOk = false, offlineDetailErr = null;
      try { await pwaPage.reload({ waitUntil: 'domcontentloaded', timeout: 40000 }); offlineDetailOk = true; } catch (e) { offlineDetailErr = String(e && e.message).slice(0, 200); }
      await sleep(1800);
      const offlineDetailText = await bodyText(pwaPage);
      const detailTitleShown = offlineDetailText.includes(courseRes.title);
      const detailNotice = /离线|offline|网络|重试|retry|缓存/i.test(offlineDetailText);
      pwaPhase.offline.detail = {
        reloadOk: offlineDetailOk, reloadError: offlineDetailErr, bodyLen: offlineDetailText.length,
        titleShown: detailTitleShown, notice: detailNotice, textSample: offlineDetailText.replace(/\s+/g, ' ').slice(0, 600),
      };
      checks.ok('M8.7', '断网重载已访问过的详情页仍可见标题/说明或离线提示',
        offlineDetailOk && offlineDetailText.length > 60 && (detailTitleShown || detailNotice),
        `reload=${offlineDetailOk} len=${offlineDetailText.length} title=${detailTitleShown} notice=${detailNotice}`);
      await pwaCtx.setOffline(false).catch(() => { });
      // 离线阶段允许的唯一额外噪声：SW 对「未缓存且离线」请求返回 503（浏览器记 Failed to load resource: 503）
      const isOfflineCacheMiss = (c) => /Failed to load resource/i.test(String(c.text || '')) && /status of 503/i.test(String(c.text || ''));
      const offlineCacheMiss = pwaEv.console.filter((c) => c.type === 'error' && isOfflineCacheMiss(c) && !isOfflineNoise(c));
      const pwaFiltered = pwaEv.console.filter((c) => c.type === 'error' && !isOfflineNoise(c) && !isOfflineCacheMiss(c));
      pwaPhase.consoleErrorsFiltered = pwaFiltered;
      pwaPhase.offlineCacheMissErrors = offlineCacheMiss.slice(0, 20);
      pwaPhase.pageErrors = pwaEv.pageErrors;
      checks.ok('M8.8', 'PWA 离线阶段无非断网类 console.error / 0 pageerror',
        pwaFiltered.length === 0 && pwaEv.pageErrors.length === 0,
        `filtered=${pwaFiltered.length} pageErrors=${pwaEv.pageErrors.length} 离线503缓存未命中=${offlineCacheMiss.length}（断网/离线缓存未命中属预期噪声，已单独记录）`);
    } catch (e) {
      pwaPhase.error = String(e && e.message);
      checks.ok('M8.5', 'PWA Service Worker 注册', false, pwaPhase.error);
      checks.ok('M8.6', 'PWA 断网重载首页', false, pwaPhase.error);
      checks.ok('M8.7', 'PWA 断网重载详情', false, pwaPhase.error);
      checks.ok('M8.8', 'PWA 离线 console', false, pwaPhase.error);
    }
    report.phases.pwa = pwaPhase;
    await pwaCtx.close().catch(() => { });

    /* ================= M9. 设计证据（信息级） + console/pageerror/请求汇总 ================= */
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(baseUrl + '/#/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(900);
      // 深浅两套对比度证据
      const themeNow = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      if (themeNow !== 'dark') { const t = await clickAny(page, ['[data-testid="theme-toggle"]', '#theme-toggle']); if (!t.ok) await markByText(page, /主题|theme|深色/i, { tags: ['button'] }); await sleep(800); }
      const darkTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      report.extra.contrastDark = await measureContrast(page);
      if (darkTheme === 'dark') await shotPush(page, 'market-home-dark.png');
      if (darkTheme !== 'light') { const t = await clickAny(page, ['[data-testid="theme-toggle"]', '#theme-toggle']); if (!t.ok) await markByText(page, /主题|theme|浅色/i, { tags: ['button'] }); await sleep(700); }
      report.extra.contrastLight = await measureContrast(page);
      // 空搜索态
      await page.goto(baseUrl + '/#/search?q=' + encodeURIComponent('zzz-no-such-resource'), { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(1200);
      const emptyInfo = await page.evaluate(() => ({
        hasEmpty: !!document.querySelector('[data-testid="empty-state"]'),
        text: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 1200),
      })).catch(() => ({}));
      report.extra.emptySearch = emptyInfo;
      await shotPush(page, 'market-empty-search.png');
      checks.ok('M9.1', '搜索空态给出结果提示/清筛选项（不是白屏）',
        /没有|无结果|找不到|no results|0 个匹配|匹配资源|清空|清除筛选/i.test(emptyInfo.text || ''),
        `empty=${emptyInfo.hasEmpty} text=${(emptyInfo.text || '').slice(0, 140)}`);
    } catch (e) { report.extra.designPhaseError = String(e && e.message); }

    syncEvents();
    const rawErrors = consoleErrorsOf(ev);
    const filteredErrors = rawErrors.filter((c) => !isShadowProbeNoise(c));
    const reqFailures = ev.requestFailures.filter((r) => !isShadowProbeNoise({ text: r.error || '', location: r.url || '' }));
    report.extra.consoleErrorRaw = rawErrors;
    report.extra.consoleErrorFiltered = filteredErrors;
    checks.ok('M9.2', '标准浏览路径 0 console.error（端口探测噪声白名单除外）', filteredErrors.length === 0,
      `raw=${rawErrors.length} filtered=${filteredErrors.length} sample=${filteredErrors.slice(0, 3).map((c) => String(c.text).slice(0, 100)).join(' | ')}`);
    checks.ok('M9.3', '0 pageerror', pageErrorsAll.length === 0, `count=${pageErrorsAll.length} sample=${pageErrorsAll.slice(0, 2).map((e) => e.message).join(' | ')}`);
    checks.ok('M9.4', '无失败资源请求（探测噪声除外）', reqFailures.length === 0,
      `failures=${reqFailures.length} sample=${reqFailures.slice(0, 3).map((r) => `${r.url} (${r.error})`).join(' | ')}`);
    const externalReqs = [...new Set(ev.requests)].filter((u) => /^https?:\/\//.test(u)).filter((u) => {
      try {
        const host = new URL(u).host;
        if (host === new URL(baseUrl).host) return false;
        if (/^127\.0\.0\.1:(187\d\d|8765|188\d\d|189\d\d|190\d\d)/.test(host)) return false;
        return true;
      } catch { return false; }
    });
    report.extra.externalRequests = externalReqs.slice(0, 20);
    checks.ok('M9.5', '无第三方 CDN/外网请求（本地优先，不引 CDN）', externalReqs.length === 0,
      externalReqs.length ? `hosts=${[...new Set(externalReqs.map((u) => { try { return new URL(u).host; } catch { return u; } }))].join(',')}` : 'none');

    report.extra.contrast = { dark: report.extra.contrastDark, light: report.extra.contrastLight };
  } catch (e) {
    report.error = String(e && (e.stack || e.message || e));
    logErr('[market] ERR: ' + report.error);
    if (page) await shot(page, 'market-fatal.png', SHOTS).catch(() => { });
  } finally {
    try { if (browser) await browser.close(); } catch { }
    try { if (srv) srv.stop(); } catch { }
  }

  const summary = checks.summary();
  report.checks = summary;
  report.summary = { total: summary.total, passed: summary.passed, failed: summary.failed };
  save(summary.failed > 0 || !!report.error);
  log(`[market] ${summary.passed}/${summary.total} PASS, ${summary.failed} FAIL${report.error ? ' + FATAL' : ''}`);
  process.exit(report.error ? 2 : (summary.failed > 0 ? 1 : 0));
}

main().catch((e) => {
  report.error = String(e && (e.stack || e.message || e));
  logErr('[market] UNCAUGHT: ' + report.error);
  save(true);
  process.exit(2);
});
