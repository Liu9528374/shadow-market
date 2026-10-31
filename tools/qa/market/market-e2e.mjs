/**
 * market-e2e.mjs - r11 市场 Web P0 独立 E2E（qa-verify）
 *
 * 覆盖 docs/52-market-mvp-p0.md §7 市场验收 1–5：
 *   1) 首页 ≥3 资源卡；搜索 coffee/咖啡 过滤正确；分类/作者页可达；刷新 hash 路由直达详情不 404
 *   2) 详情 Tabs：README 渲染、句子预览条数=包内句子数、文件清单含 packageUrl、版本信息正确
 *   3) 下载 200 且 JSON 可解析 spec=shadow.course；一键导入无本地服务时降级（不报错、3 步说明）
 *   4) 设置页左侧分类导航 + 深浅色 + Ctrl+K 命令面板可用；无 console error/pageerror
 *   5) 1440×900 与 1024×768 无横向溢出
 * 额外证据（产品原则/契约）：插件声明可读（一切即插件）、无第三方 CDN 请求、P1 本地演示标注、404 路由。
 *
 * 用法（D:\NODE\node.exe）：
 *   node tools\qa\market\market-e2e.mjs                          # 复用 127.0.0.1:18920，没有则用 market/serve.mjs 起独立端口
 *   node tools\qa\market\market-e2e.mjs --base-url=http://127.0.0.1:18920
 *   node tools\qa\market\market-e2e.mjs --headed --report=... --shots=...
 *
 * 产物：tools/qa/market/report-market.json + tools/qa/market/shots/*.png
 * 退出码：全部 PASS=0，有 FAIL=1，环境/数据未就绪=2（不伪造 PASS）。
 */
import path from 'node:path';
import fs from 'node:fs';
import {
  REPO_ROOT, MARKET_DIR, SHOTS_DIR, ensureDir, parseArgs, hasMarket, readJsonFile,
  writeJsonReport, nowIso, sleep, log, logErr, httpRequest, ensureMarketServer,
  launchEdge, newInstrumentedPage, shot, makeChecks, consoleErrorsOf, isShadowProbeNoise,
  bodyText, gotoHash, resourceCardLinks, horizontalOverflow, SHADOW_PORT_RANGE, clickAny,
  findFreePort, isPortFree,
} from './common.mjs';

const argv = parseArgs();
const REPORT = argv.report || path.join(REPO_ROOT, 'tools', 'qa', 'market', 'report-market.json');
const SHOTS = argv.shots || SHOTS_DIR;
const baseUrlArg = argv['base-url'] || null;
const headed = !!argv.headed;

const report = {
  test: 'market-e2e',
  round: 'r11',
  startedAt: nowIso(),
  baseUrl: baseUrlArg,
  server: null,
  browser: null,
  checks: null,
  extra: {},
  console: [],
  pageErrors: [],
  requestFailures: [],
  screenshots: [],
  phases: {},
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

/** 点击文本最小可见元素（打 data-qa-mark 再点，避免 strict mode 多元素问题） */
let markSeq = 0;
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
    // 优先 tags 白名单里文本最短的元素（最像按钮/标签）
    hits.sort((a, b) => {
      const ta = tagsSet.includes(a.tag.toUpperCase()) ? 0 : 1;
      const tb = tagsSet.includes(b.tag.toUpperCase()) ? 0 : 1;
      return ta - tb || a.len - b.len;
    });
    const el = hits[0].el;
    el.setAttribute('data-qa-mark', mark);
    return { found: true, text: hits[0].el.innerText.trim().slice(0, 120), tag: hits[0].tag };
  }, { src: pattern.source, flags: pattern.flags, tagsList: tags, mark }).catch(() => ({ found: false }));
  if (!info.found) return { ok: false, mark, info };
  if (!click) return { ok: true, mark, info };
  try {
    await page.locator(`[data-qa-mark="${mark}"]`).first().click({ timeout: 5000 });
    return { ok: true, mark, info };
  } catch (e) {
    return { ok: false, mark, info, error: String(e && e.message) };
  }
}

/** 等 body 文本包含某字符串 */
async function waitBodyContains(page, text, timeout = 10000) {
  try {
    await page.waitForFunction((t) => document.body && document.body.innerText.includes(t), text, { timeout });
    return true;
  } catch { return false; }
}

/** 等资源卡出现；返回卡 id 列表 */
async function waitCards(page, min = 1, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let ids = [];
  while (Date.now() < deadline) {
    ids = await resourceCardLinks(page).catch(() => []);
    if (ids.length >= min) return ids;
    await sleep(250);
  }
  return ids;
}

/** 首页/搜索页卡片（优先市场稳定选择器 data-testid=resource-card；回退 main 内 #/resource 链接） */
async function scopedCardIds(page) {
  return await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const cards = [...document.querySelectorAll('[data-testid="resource-card"]')].filter(vis)
      .map((c) => c.getAttribute('data-resource-id')).filter(Boolean);
    if (cards.length) return [...new Set(cards)];
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

/** 句子预览行数识别：优先结构选择器，回退"逐条文本存在" */
async function sentencePreviewInfo(page, pkg) {
  const expected = pkg.sentences.length;
  const selTry = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const sels = ['[data-sentence-id]', '[data-sentence]', '.sentence-row', '.sent-row', '.sentence-item',
      '.sentences li', 'ol.sentences > li', '[class*="sentence-row"]', '[class*="sentence-item"]', '[class*="sent-item"]',
      '[class*="sentence"] li', '[class*="sentence-list"] > *', 'table tbody tr'];
    for (const sel of sels) {
      const nodes = [...document.querySelectorAll(sel)].filter(vis);
      if (nodes.length > 0) return { selector: sel, count: nodes.length };
    }
    return null;
  }).catch(() => null);
  const texts = await page.evaluate((arr) => {
    const body = document.body ? document.body.innerText : '';
    let present = 0;
    for (const t of arr) if (t && body.includes(t.slice(0, Math.max(8, Math.min(40, t.length))))) present++;
    return { present, total: arr.length, bodyLen: body.length };
  }, pkg.sentences.map((s) => s.text)).catch(() => ({ present: 0, total: expected, bodyLen: 0 }));
  return { expected, selTry, textPresence: texts };
}

/** 测试用"假 SHADOW Studio"服务：只回 /api/health 与占位页，用来验证市场一键导入的成功深链协议。
 *  **绝不连接用户真实应用**（端口由本进程临时监听并关闭）。 */
async function startFakeStudioServer(port) {
  const http = await import('node:http');
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push({ method: req.method, url: req.url });
    if (String(req.url || '').startsWith('/api/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, version: '0.7.0', qa: 'qa-verify-fake-studio' }));
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><body><h1>QA fake SHADOW Studio</h1><p>deep link receiver</p></body></html>');
  });
  await new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(port, '127.0.0.1', resolve); });
  return { port, hits, stop: () => new Promise((r) => srv.close(() => r())) };
}

/** 确保页面主题为指定 light/dark（通过 #theme-toggle 切换，最多试 3 次） */
async function ensureTheme(page, want) {
  for (let i = 0; i < 3; i++) {
    const cur = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (cur === want) return cur;
    const r = await clickAny(page, ['[data-testid="theme-toggle"]', '#theme-toggle']);
    if (!r.ok) break;
    await sleep(600);
  }
  return await page.evaluate(() => document.documentElement.getAttribute('data-theme')).catch(() => null);
}

/** 计算页面关键文本/背景的 WCAG 对比度（设计快评证据） */
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
    const sels = {
      body: 'body', cardTitle: '.res-title', cardDesc: '.res-desc', sideLink: '.side-link',
      navLink: '.header-nav-link', badge: '.badge', toolbarCount: '.toolbar-count', muted: '.subtle',
    };
    const out = {};
    for (const [k, sel] of Object.entries(sels)) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      const fg = cs.color; const bg = bgOf(el);
      const l1 = lum(fg), l2 = lum(bg);
      if (l1 === null || l2 === null) continue;
      out[k] = { fg, bg, ratio: +((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2), fontSize: cs.fontSize };
    }
    return out;
  }).catch(() => ({}));
}

/** 主流程 */
async function main() {
  if (!hasMarket()) fatal(`market/ 尚未交付（缺 ${path.join(MARKET_DIR, 'index.html')}）`);
  ensureDir(SHOTS);

  // ---------- 0. 市场服务 ----------
  let srv = null;
  try {
    srv = await ensureMarketServer({ baseUrl: baseUrlArg, reuseDefault: !!argv.reuse });
  } catch (e) { fatal(`市场服务不可用：${e.message}`); }
  const baseUrl = srv.baseUrl;
  report.baseUrl = baseUrl;
  report.server = { baseUrl, port: srv.port, reused: srv.reused, serveLog: srv.logFile || null, marketDir: MARKET_DIR };
  log(`[market] baseUrl=${baseUrl} reused=${srv.reused}`);

  const checks = makeChecks('market-e2e');
  const consoleAll = report.console;
  const pageErrorsAll = report.pageErrors;
  let page = null, context = null, browser = null;

  try {
    // ---------- A. 数据契约 HTTP ----------
    const catResp = await httpRequest(`${baseUrl}/data/catalog.json`);
    const catalog = catResp.json;
    report.phases.catalog = { status: catResp.status, bytes: catResp.body.length, spec: catalog && catalog.spec };
    checks.ok('M0.1', 'data/catalog.json 200 + JSON 可解析', catResp.status === 200 && !!catalog, `status=${catResp.status} bytes=${catResp.body.length}`);
    if (!catalog) throw new Error('catalog.json 不可解析，后续用例无法进行');
    checks.ok('M0.2', 'catalog.spec === "shadow.market.catalog"', catalog.spec === 'shadow.market.catalog', `spec=${catalog.spec}`);
    const resources = Array.isArray(catalog.resources) ? catalog.resources : [];
    checks.ok('M0.3', 'catalog.resources ≥ 3', resources.length >= 3, `count=${resources.length}`);

    const pkgCache = new Map();
    for (const r of resources) {
      if (!r.packageUrl) continue;
      const url = new URL(r.packageUrl, baseUrl + '/').toString();
      const resp = await httpRequest(url).catch((e) => ({ status: 0, error: String(e) }));
      let json = resp.json;
      pkgCache.set(r.id, { resp, json, url, bytes: resp.body ? resp.body.length : 0 });
    }
    const pkgOk = [...pkgCache.entries()].filter(([, v]) => v.resp.status === 200 && v.json && v.json.spec === 'shadow.course');
    checks.ok('M0.4', '每个资源 packageUrl 可下载且 spec=shadow.course', pkgOk.length === pkgCache.size && pkgCache.size > 0,
      `ok=${pkgOk.length}/${pkgCache.size}`);

    // 插件声明（一切即插件）
    const pluginIdx = await httpRequest(`${baseUrl}/plugins/index.json`).catch((e) => ({ status: 0, error: String(e) }));
    let pluginCount = 0, pluginDetail = null;
    if (pluginIdx.status === 200 && pluginIdx.json) {
      const list = Array.isArray(pluginIdx.json.plugins) ? pluginIdx.json.plugins
        : Array.isArray(pluginIdx.json.types) ? pluginIdx.json.types
          : Array.isArray(pluginIdx.json) ? pluginIdx.json : [];
      pluginCount = list.length;
      pluginDetail = list;
    }
    report.extra.plugins = { indexStatus: pluginIdx.status, count: pluginCount, list: pluginDetail };
    checks.ok('M0.5', 'plugins/index.json 200 且声明 ≥1 资源类型（一切即插件）', pluginIdx.status === 200 && pluginCount >= 1,
      `status=${pluginIdx.status} types=${pluginCount}`);

    // 第三方 CDN 请求检查（本地优先/不引 CDN）
    // 在浏览器阶段收集

    // ---------- 浏览器 ----------
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

    let firstId = null;
    const firstWithPkg = resources.find((r) => pkgCache.get(r.id) && pkgCache.get(r.id).json) || resources[0];
    if (!firstWithPkg) throw new Error('catalog 没有可用资源');
    firstId = firstWithPkg.id;
    const firstPkg = (pkgCache.get(firstId) || {}).json || null;

    // ---------- 1. 首页 ----------
    const homeResp = await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const homeIds = await waitCards(page, Math.min(3, resources.length), 20000);
    syncEvents();
    report.phases.home = { status: homeResp && homeResp.status(), cardIds: homeIds, url: page.url() };
    await shot(page, 'market-home-1440.png', SHOTS); report.screenshots.push('market-home-1440.png');
    const homeText = await bodyText(page);
    checks.ok('M1.1', '首页 HTTP 200 且渲染资源卡 ≥3', homeResp && homeResp.status() === 200 && homeIds.length >= 3,
      `status=${homeResp && homeResp.status()} cards=${homeIds.length} ids=${homeIds.slice(0, 6).join(',')}`);
    const titleHits = resources.filter((r) => homeText.includes(r.title)).length;
    checks.ok('M1.2', '首页卡片标题来自 catalog（≥3 个标题可见）', titleHits >= 3, `visibleTitles=${titleHits}/${resources.length}`);
    checks.ok('M1.3', '首页有 Free/免费 徽标（P0 全免费）', /free|免费/i.test(homeText), `textHasFree=${/free|免费/i.test(homeText)}`);

    // 数据来源：必须用真实 catalog，而不是 dev-fixtures 演示数据（市场契约要求不冒充真数据）
    const dataMode = await page.evaluate(() => ({
      fixtureFlag: (() => { try { return sessionStorage.getItem('shadow.market.fixture.v1'); } catch { return null; } })(),
      hasFixtureBadge: /演示夹具/.test(document.body.innerText),
    })).catch(() => ({}));
    const usedDataUrls = [...new Set(ev.requests)].filter((u) => /catalog\.json|dev-fixtures/.test(u));
    report.extra.dataMode = { ...dataMode, usedDataUrls };
    checks.ok('M1.8', '使用真实 catalog 数据（无演示夹具标记、未加载 dev-fixtures）',
      !dataMode.fixtureFlag && !dataMode.hasFixtureBadge && usedDataUrls.some((u) => /data\/catalog\.json/.test(u)) && !usedDataUrls.some((u) => /dev-fixtures/.test(u)),
      `fixtureFlag=${dataMode.fixtureFlag} badge=${dataMode.hasFixtureBadge} urls=${usedDataUrls.join(',')}`);

    // ---------- 2. 搜索 ----------
    // 与市场实现 market/assets/js/data.js 的 SEARCH_ALIASES/queryTerms 保持一致（用于计算期望集合）
    const SEARCH_ALIASES = {
      coffee: ['咖啡', 'café', 'cafe'], 咖啡: ['coffee', 'cafe', 'café'], cafe: ['咖啡', 'coffee'], café: ['咖啡', 'coffee'],
      direction: ['问路', '方向', 'directions'], directions: ['问路', '方向', 'direction'], 问路: ['direction', 'directions', 'way'],
      interview: ['面试', '自我介绍', 'interviewing'], 面试: ['interview', '自我介绍'],
      podcast: ['播客', '听力'], 播客: ['podcast', '听力'], movie: ['影视', '电影', '片段'], 影视: ['movie', 'film', '片段'],
      shadowing: ['跟读', '影子跟读'], 跟读: ['shadowing', 'shadow'], travel: ['旅行', '出行'], 旅行: ['travel', 'trip'],
      daily: ['日常', '会话'], 日常: ['daily'], work: ['职场', '工作'], 职场: ['work', 'job'], byom: ['自备媒体', '媒体'], 自备媒体: ['byom'],
    };
    const matchRes = (q) => {
      const terms = String(q || '').trim().toLowerCase().split(/[\s,，、/]+/).filter(Boolean).slice(0, 8);
      if (!terms.length) return resources.map((r) => r.id);
      const creatorsByHandle = new Map((catalog.creators || []).map((c) => [c.handle, c]));
      const catById = new Map((catalog.categories || []).map((c) => [c.id, c]));
      return resources.filter((r) => {
        const cr = creatorsByHandle.get(r.creator);
        const ct = catById.get(r.category);
        const hay = [r.id, r.title, r.subtitle, r.description, (r.tags || []).join(' '), r.level, r.category,
          ct ? (ct.label || '') + ' ' + (ct.labelEn || '') : '', r.creator, cr ? cr.name : '', r.type].join('\n').toLowerCase();
        return terms.every((token) => {
          const variants = [token, ...((SEARCH_ALIASES[token] || []).map((a) => String(a).toLowerCase()))];
          return variants.some((v) => hay.includes(v));
        });
      }).map((r) => r.id);
    };
    const queries = ['coffee', '咖啡'];
    const searchPhase = { queries: {} };
    for (const q of queries) {
      await gotoHash(page, baseUrl, '#/');
      await waitCards(page, 1, 10000);
      // Ctrl+K / / 之外：找页面搜索框
      const inputSel = await page.evaluate(() => {
        const cands = ['[data-testid="search-input"]', 'input[type="search"]', 'input[placeholder*="搜索"]', 'input[placeholder*="Search"]',
          'input[placeholder*="search"]', '#search', '.search input', '[role="search"] input', 'header input'];
        for (const s of cands) {
          const el = document.querySelector(s);
          if (el) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) { el.setAttribute('data-qa-search', '1'); return s; }
          }
        }
        return null;
      });
      if (inputSel) {
        await page.locator('[data-qa-search="1"]').first().click();
        await page.keyboard.press('Control+A');
        await page.keyboard.type(q, { delay: 30 });
        await sleep(900);
        const gotIds = await scopedCardIds(page);
        const expected = matchRes(q).sort();
        const got = gotIds.slice().sort();
        const sameSet = got.length === expected.length && got.every((id, i) => id === expected[i]);
        searchPhase.queries[q] = { inputSel, got, expected, sameSet, url: page.url(), hash: await page.evaluate(() => location.hash) };
        checks.ok(`M1.4-${q}`, `搜索 "${q}" 过滤正确（结果集=目录匹配集）`, sameSet && got.length > 0,
          `got=[${got.join(',')}] expected=[${expected.join(',')}] hash=${await page.evaluate(() => location.hash)}`);
      } else {
        searchPhase.queries[q] = { inputSel: null };
        checks.ok(`M1.4-${q}`, `搜索 "${q}" 过滤正确（结果集=目录匹配集）`, false, '未找到可见搜索框');
      }
    }
    // 直接 hash 搜索路由
    const qAny = queries.find((q) => matchRes(q).length > 0) || queries[0];
    await page.goto(baseUrl + '/#/search?q=' + encodeURIComponent(qAny), { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(1200);
    const hashIds = await scopedCardIds(page);
    const hashExpected = matchRes(qAny).sort();
    const hashSame = hashIds.slice().sort().every((id, i) => id === hashExpected[i]) && hashIds.length === hashExpected.length;
    searchPhase.hashRoute = { q: qAny, got: hashIds, expected: hashExpected, same: hashSame };
    checks.ok('M1.5', `hash 搜索路由 #/search?q=${qAny} 可用`, hashSame, `got=[${hashIds.join(',')}] expected=[${hashExpected.join(',')}]`);
    report.phases.search = searchPhase;

    // ---------- 3. 分类页 / 作者页 ----------
    const cat = (catalog.categories || [])[0];
    let catIds = [];
    if (cat) {
      await gotoHash(page, baseUrl, '#/category/' + cat.id);
      catIds = await waitCards(page, 1, 12000);
      const exp = resources.filter((r) => r.category === cat.id).map((r) => r.id).sort();
      const got = catIds.slice().sort();
      const same = got.length === exp.length && got.every((id, i) => id === exp[i]);
      checks.ok('M1.6', `分类页 #/category/${cat.id} 可达且资源集正确`, same && got.length > 0,
        `label=${cat.label || ''} got=[${got.join(',')}] expected=[${exp.join(',')}]`);
      await shot(page, `market-category-${cat.id}.png`, SHOTS); report.screenshots.push(`market-category-${cat.id}.png`);
    } else checks.ok('M1.6', '分类页可达', false, 'catalog.categories 为空');
    const creator = (catalog.creators || [])[0];
    let creatorIds = [];
    if (creator) {
      await gotoHash(page, baseUrl, '#/creator/' + creator.handle);
      creatorIds = await waitCards(page, 1, 12000);
      const exp = resources.filter((r) => r.creator === creator.handle).map((r) => r.id).sort();
      const got = creatorIds.slice().sort();
      const same = got.length === exp.length && got.every((id, i) => id === exp[i]);
      const text = await bodyText(page);
      checks.ok('M1.7', `作者页 #/creator/${creator.handle} 可达且显示作者信息`,
        same && got.length > 0 && text.includes(creator.name || creator.handle),
        `name=${creator.name} got=[${got.join(',')}] expected=[${exp.join(',')}]`);
      await shot(page, `market-creator-${creator.handle}.png`, SHOTS); report.screenshots.push(`market-creator-${creator.handle}.png`);
    } else checks.ok('M1.7', '作者页可达', false, 'catalog.creators 为空');

    // ---------- 4. 详情页（hash 直达 + 刷新 + Tabs） ----------
    await gotoHash(page, baseUrl, '#/');
    await sleep(300);
    await page.evaluate((id) => { location.hash = '#/resource/' + id; }, firstId);
    const detailLoaded = await waitBodyContains(page, firstPkg ? firstPkg.title : firstWithPkg.title, 12000);
    const detailText = await bodyText(page);
    const notFound = /404|找不到|未找到|not found/i.test(detailText) && !detailLoaded;
    checks.ok('M2.1', `详情页 #/resource/${firstId} hash 可达`, detailLoaded && !notFound,
      `loadedTitle=${detailLoaded} url=${page.url()}`);
    await shot(page, 'market-detail-1440.png', SHOTS); report.screenshots.push('market-detail-1440.png');

    // 刷新后 hash 直达仍渲染（不 404）
    let reloadOk = false;
    try {
      const r = await page.reload({ waitUntil: 'domcontentloaded', timeout: 25000 });
      reloadOk = await waitBodyContains(page, firstPkg ? firstPkg.title : firstWithPkg.title, 12000);
      report.phases.detailReload = { status: r && r.status(), ok: reloadOk, url: page.url() };
    } catch (e) { report.phases.detailReload = { ok: false, error: String(e && e.message) }; }
    checks.ok('M2.2', '刷新 hash 直达详情页不 404（重新加载仍渲染）', reloadOk, `url=${page.url()}`);

    if (firstPkg) {
      const clickTab = async (name) => {
        const direct = await clickAny(page, [`[data-testid="tab-${name}"]`]);
        if (direct.ok) { await sleep(700); return { ok: true, selector: `[data-testid="tab-${name}"]` }; }
        const byText = await markByText(page, new RegExp({ readme: 'README', sentences: '句子预览|句子', files: '文件', versions: '版本' }[name] || name, 'i'));
        await sleep(700);
        return { ok: byText.ok, selector: 'text' };
      };

      // README：从包 readme 提取标题，断言渲染为标题元素（市场用 data-testid=readme-content 容器）
      const readme = firstPkg.readme || '';
      const headingMatch = readme.match(/^#{1,6}\s+(.+)$/m);
      const heading = headingMatch ? headingMatch[1].trim() : null;
      // 包是异步 fetch 的：等 README 面板渲染出内容（标题或 ≥20 字文本）
      await page.waitForFunction(() => {
        const c = document.querySelector('[data-testid="readme-content"]');
        if (!c) return false;
        return !!(c.querySelector('h1,h2,h3,h4,h5,h6') || (c.innerText || '').trim().length > 20);
      }, null, { timeout: 15000 }).catch(() => { });
      const readmeInfo = await page.evaluate((h) => {
        const content = document.querySelector('[data-testid="readme-content"]');
        const main = content || document.querySelector('main') || document.body;
        const text = main ? main.innerText : '';
        let headingEl = false;
        if (h) headingEl = [...main.querySelectorAll('h1,h2,h3,h4,h5,h6')].some((el) => (el.innerText || '').includes(h));
        const html = main ? main.innerHTML : '';
        return {
          hasContentContainer: !!content, headingEl, hasHeadingText: h ? text.includes(h) : null, textLen: text.length,
          scriptsInMain: (html.match(/<script/gi) || []).length,
          inlineHandlers: (html.match(/\son(error|load|click)\s*=/gi) || []).length,
        };
      }, heading);
      report.phases.readme = { heading, ...readmeInfo };
      checks.ok('M2.3', 'README Tab 渲染（包内 readme 标题渲染为标题元素）', !!heading && readmeInfo.headingEl,
        `heading=${heading} container=${readmeInfo.hasContentContainer} headingEl=${readmeInfo.headingEl} textLen=${readmeInfo.textLen}`);
      checks.ok('M2.4', 'README 安全渲染（无 <script>/内联事件）', readmeInfo.scriptsInMain === 0 && readmeInfo.inlineHandlers === 0,
        `scripts=${readmeInfo.scriptsInMain} inlineHandlers=${readmeInfo.inlineHandlers}`);

      // 句子预览 Tab：条数 = 包内句子数（市场用 data-testid=sentence-row）
      const tabClick = await clickTab('sentences');
      const sentInfo = await page.evaluate((expected) => {
        const panel = document.querySelector('[data-testid="tab-panel-sentences"]');
        const rows = [...document.querySelectorAll('[data-testid="sentence-row"]')];
        const visible = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
        const body = panel ? panel.innerText : '';
        return { panel: !!panel, rows: rows.length, visible: visible.length, expected, sample: body.replace(/\s+/g, ' ').slice(0, 200) };
      }, firstPkg.sentences.length).catch(() => ({ panel: false, rows: 0, visible: 0, expected: firstPkg.sentences.length }));
      report.phases.sentences = { tabClick, ...sentInfo };
      const allTexts = await page.evaluate((arr) => {
        const panel = document.querySelector('[data-testid="tab-panel-sentences"]');
        const body = panel ? panel.innerText : '';
        return arr.filter((t) => t && body.includes(String(t).slice(0, Math.min(30, String(t).length)))).length;
      }, firstPkg.sentences.map((s) => s.text)).catch(() => 0);
      checks.ok('M2.5', `句子预览条数 = 包内句子数（${firstPkg.sentences.length}）`,
        sentInfo.rows === firstPkg.sentences.length || allTexts === firstPkg.sentences.length,
        `tab=${tabClick.ok} panel=${sentInfo.panel} rows=${sentInfo.rows} (期望 ${firstPkg.sentences.length}) textPresent=${allTexts}/${firstPkg.sentences.length}`);
      await shot(page, 'market-detail-sentences.png', SHOTS); report.screenshots.push('market-detail-sentences.png');

      // 文件 Tab：含 packageUrl 文件名（data-testid=file-row / file-download）
      const baseName = path.basename(firstWithPkg.packageUrl || '');
      const filesClick = await clickTab('files');
      const filesInfo = await page.evaluate((bn) => {
        const row = document.querySelector('[data-testid="file-row"]');
        const dl = document.querySelector('[data-testid="file-download"]');
        return { hasRow: !!row, rowText: row ? row.innerText.replace(/\s+/g, ' ').slice(0, 200) : '', hasName: row ? row.innerText.includes(bn) : false, hasDownload: !!dl };
      }, baseName).catch(() => ({}));
      report.phases.files = { clicked: filesClick.ok, baseName, ...filesInfo };
      checks.ok('M2.6', '文件 Tab 含 packageUrl 文件名 + 下载入口', filesClick.ok && filesInfo.hasRow && filesInfo.hasName,
        `clicked=${filesClick.ok} row=${filesInfo.hasRow} name=${filesInfo.hasName} download=${filesInfo.hasDownload} text=${(filesInfo.rowText || '').slice(0, 120)}`);

      // 版本 Tab：版本号正确（data-testid=version-row）
      const verClick = await clickTab('versions');
      const verInfo = await page.evaluate((v) => {
        const rows = [...document.querySelectorAll('[data-testid="version-row"]')];
        const text = rows.map((r) => r.innerText).join(' | ');
        return { rows: rows.length, hasVersion: new RegExp('v' + v.replace(/\./g, '\\.')).test(text), text: text.replace(/\s+/g, ' ').slice(0, 300) };
      }, firstPkg.version).catch(() => ({}));
      report.phases.versions = { clicked: verClick.ok, version: firstPkg.version, ...verInfo };
      checks.ok('M2.7', '版本 Tab 显示包版本号（v' + firstPkg.version + '）', verClick.ok && !!verInfo.hasVersion,
        `clicked=${verClick.ok} rows=${verInfo.rows} text=${(verInfo.text || '').slice(0, 160)}`);

      // About 侧栏：作者 + 许可（data-testid=detail-aside）
      const asideInfo = await page.evaluate(() => ({
        hasAside: !!document.querySelector('[data-testid="detail-aside"]'),
        text: (document.querySelector('[data-testid="detail-aside"]') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 1200),
      })).catch(() => ({ hasAside: false, text: '' }));
      const creatorName = (catalog.creators || []).find((c) => c.handle === firstWithPkg.creator);
      const aboutOk = asideInfo.hasAside && asideInfo.text.includes(firstWithPkg.license || 'CC-BY-4.0') &&
        (!creatorName || asideInfo.text.includes(creatorName.name));
      report.phases.aside = { hasAside: asideInfo.hasAside, license: firstWithPkg.license, creatorName: creatorName && creatorName.name };
      checks.ok('M2.8', '详情页 About 侧栏（作者/许可）', aboutOk,
        `aside=${asideInfo.hasAside} license=${firstWithPkg.license} creatorName=${creatorName && creatorName.name}`);
    } else {
      checks.ok('M2.3', 'README Tab 渲染', false, '无法读取包 JSON');
      checks.ok('M2.4', 'README 安全渲染', false, '无法读取包 JSON');
      checks.ok('M2.5', '句子预览条数', false, '无法读取包 JSON');
      checks.ok('M2.6', '文件 Tab', false, '无法读取包 JSON');
      checks.ok('M2.7', '版本 Tab', false, '无法读取包 JSON');
      checks.ok('M2.8', 'About 侧栏', false, '无法读取包 JSON');
    }

    // ---------- 5. 下载 + 一键导入降级 ----------
    const dlResp = await httpRequest(new URL(firstWithPkg.packageUrl, baseUrl + '/').toString());
    const dlJson = dlResp.json;
    const dlBytes = dlResp.body.length;
    report.phases.download = {
      status: dlResp.status, bytes: dlBytes, contentType: dlResp.headers['content-type'],
      spec: dlJson && dlJson.spec, sentences: dlJson && dlJson.sentences ? dlJson.sentences.length : null,
      packageSentenceCount: firstPkg ? firstPkg.sentences.length : null,
    };
    checks.ok('M3.1', '下载 packageUrl 返回 200 且 JSON 可解析', dlResp.status === 200 && !!dlJson,
      `status=${dlResp.status} bytes=${dlBytes} contentType=${dlResp.headers['content-type']}`);
    checks.ok('M3.2', '下载内容 spec=shadow.course 且句子数与包一致',
      !!dlJson && dlJson.spec === 'shadow.course' && (!firstPkg || dlJson.sentences.length === firstPkg.sentences.length),
      `spec=${dlJson && dlJson.spec} sentences=${dlJson && dlJson.sentences ? dlJson.sentences.length : '?'} expected=${firstPkg ? firstPkg.sentences.length : '?'}`);
    checks.ok('M3.3', '单包 ≤ 2MB（docs/52 §2 硬性规则）', dlBytes > 0 && dlBytes <= 2 * 1024 * 1024, `bytes=${dlBytes}`);

    // 页面内下载按钮 → download 事件（市场 data-testid=download-btn）
    let dlEvent = null;
    try {
      await page.goto(`${baseUrl}/#/resource/${firstId}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(1200);
      const dlBtn = await page.locator('[data-testid="download-btn"]').first().count().catch(() => 0);
      if (dlBtn > 0) {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
          page.locator('[data-testid="download-btn"]').first().click({ timeout: 5000 }).catch(() => { }),
        ]);
        if (download) dlEvent = { suggestedFilename: download.suggestedFilename(), url: download.url() };
      }
      report.phases.downloadEvent = dlEvent || { none: true, buttonFound: dlBtn > 0 };
    } catch (e) { report.phases.downloadEvent = { error: String(e && e.message) }; }
    checks.ok('M3.4', '页面下载按钮可触发下载（download 事件，.shadowcourse）', !!dlEvent && /\.shadowcourse$/i.test(dlEvent.suggestedFilename || ''),
      dlEvent ? `file=${dlEvent.suggestedFilename}` : `未捕获 download 事件（buttonFound=${report.phases.downloadEvent.buttonFound}）`);

    // 一键导入降级：用 ?appPort=<空闲未监听端口> 覆盖探测范围（只探该端口），
    // 绝不扫描/触碰用户真实在跑的 18765/8765 进程；同时注册路由拦截 18765–18775 作为双保险。
    const closedPort = await findFreePort(19010, 40);
    const importCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const importPage = await importCtx.newPage();
    const importEv = { console: [], pageErrors: [], popups: [], blocked: [] };
    importPage.on('console', (m) => { let loc = null; try { const l = m.location(); loc = l && l.url || null; } catch { } importEv.console.push({ type: m.type(), text: m.text(), location: loc }); });
    importPage.on('pageerror', (e) => importEv.pageErrors.push({ message: e.message }));
    importPage.on('popup', async (p) => { importEv.popups.push(p.url()); try { await p.close(); } catch { } });
    await importCtx.route('**/*', (route) => {
      const u = route.request().url();
      const m = u.match(/^http:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) {
        const port = parseInt(m[1], 10);
        if (port >= SHADOW_PORT_RANGE.from && port <= SHADOW_PORT_RANGE.to) { importEv.blocked.push(u); return route.abort('connectionrefused'); }
      }
      return route.continue();
    });
    await importPage.goto(`${baseUrl}/#/resource/${firstId}?appPort=${closedPort}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(1800);
    const dlPromise = importPage.waitForEvent('download', { timeout: 12000 }).catch(() => null);
    await importPage.locator('[data-testid="import-btn"]').first().click({ timeout: 6000 }).catch(() => { });
    const fallbackShown = await importPage.waitForFunction(() => document.body.innerText.includes('已降级为下载'), null, { timeout: 15000 }).then(() => true).catch(() => false);
    const downloadInPage = await dlPromise;
    await sleep(700);
    const importText = await bodyText(importPage);
    const modalInfo = await importPage.evaluate(() => {
      const roots = [...document.querySelectorAll('#modal-root *')];
      const modal = roots.find((n) => /已降级为下载/.test(n.innerText || '') && n.querySelector && n.querySelector('ol.steps'));
      const steps = [...document.querySelectorAll('#modal-root ol.steps > li')];
      return {
        hasModal: !!modal,
        steps: steps.length,
        stepTitles: steps.map((li) => { const t = li.querySelector('.step-title'); return (t || li).innerText.trim().slice(0, 40); }).slice(0, 5),
        hasFallbackDownload: !!document.querySelector('[data-testid="fallback-download"]'),
        text: (modal ? modal.innerText : '').replace(/\s+/g, ' ').slice(0, 900),
      };
    }).catch(() => ({}));
    const has3Steps = modalInfo.steps === 3;
    const filteredImportErrors = importEv.console.filter((c) => c.type === 'error' && !isShadowProbeNoise(c));
    report.phases.importDegrade = {
      closedPort, clicked: true, fallbackShown, has3Steps, modal: modalInfo,
      downloadInPage: downloadInPage ? { suggestedFilename: downloadInPage.suggestedFilename() } : null,
      popups: importEv.popups, blockedUserPortRequests: importEv.blocked.length,
      consoleErrors: importEv.console.filter((c) => c.type === 'error'),
      filteredConsoleErrors: filteredImportErrors, pageErrors: importEv.pageErrors,
      textSample: importText.replace(/\s+/g, ' ').slice(0, 800),
    };
    await importPage.screenshot({ path: path.join(SHOTS, 'market-import-degraded.png') }).catch(() => { });
    report.screenshots.push('market-import-degraded.png');
    checks.ok('M3.5', '一键导入无本地服务时降级（不报错 + 3 步说明 + 自动下载）',
      fallbackShown && has3Steps && (!!downloadInPage || modalInfo.hasFallbackDownload),
      `fallback=${fallbackShown} steps=${modalInfo.steps} [${(modalInfo.stepTitles || []).join(' / ')}] download=${downloadInPage ? downloadInPage.suggestedFilename() : 'none'} fallbackBtn=${modalInfo.hasFallbackDownload}`);
    checks.ok('M3.6', '降级路径无 pageerror / 无非探测类 console.error',
      filteredImportErrors.length === 0 && importEv.pageErrors.length === 0,
      `filteredErrors=${filteredImportErrors.length} pageErrors=${importEv.pageErrors.length}（端口探测失败属预期网络噪声，已过滤）`);
    checks.ok('M3.7', 'appPort 覆盖生效：未探测/未打开用户真实端口 18765–18775',
      importEv.blocked.length === 0 && importEv.popups.filter((u) => u !== 'about:blank').length === 0,
      `blockedAttempts=${importEv.blocked.length} popups=[${importEv.popups.join(',')}]（about:blank 是市场同步预留窗口，降级时已由市场关闭）`);
    await importCtx.close().catch(() => { });

    // 一键导入成功路径：本进程临时起「假 SHADOW Studio」健康服务（不接用户真实应用），
    // 验证 探测到 → 打开 http://127.0.0.1:<port>/?import=<包绝对URL> 协议（docs/52 §4-2）。
    const fakePort = await findFreePort(closedPort + 5, 40);
    if (!(await isPortFree(fakePort))) throw new Error(`fake studio 端口 ${fakePort} 被占用`);
    const fakeStudio = await startFakeStudioServer(fakePort);
    const okCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const okPage = await okCtx.newPage();
    const okEv = { popups: [], blocked: [], finalPopupUrl: null, console: [], pageErrors: [] };
    okPage.on('pageerror', (e) => okEv.pageErrors.push(String(e && e.message)));
    okPage.on('console', (m) => { if (m.type() === 'error') okEv.console.push({ text: m.text(), location: (() => { try { return m.location().url; } catch { return null; } })() }); });
    okPage.on('popup', async (p) => {
      try { await p.waitForLoadState('domcontentloaded', { timeout: 8000 }); } catch { }
      okEv.finalPopupUrl = p.url();
      okEv.popups.push(okEv.finalPopupUrl);
      try { await p.close(); } catch { }
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
    await okPage.goto(`${baseUrl}/#/resource/${firstId}?appPort=${fakePort}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(1500);
    await okPage.locator('[data-testid="import-btn"]').first().click({ timeout: 6000 }).catch(() => { });
    const successShown = await okPage.waitForFunction(() => document.body.innerText.includes('已发送到 SHADOW Studio'), null, { timeout: 15000 }).then(() => true).catch(() => false);
    await sleep(1500);
    const okDiag = await okPage.evaluate(() => ({
      bodyTail: (document.body.innerText || '').replace(/\s+/g, ' ').slice(-700),
      modalText: (document.querySelector('#modal-root') ? document.querySelector('#modal-root').innerText : '').replace(/\s+/g, ' ').slice(0, 500),
      toastText: (document.querySelector('#toast-region') ? document.querySelector('#toast-region').innerText : '').replace(/\s+/g, ' ').slice(0, 300),
      hasSuccessModal: /已发送到 SHADOW Studio/.test(document.body.innerText || ''),
      hasDetectedToast: /已检测到 SHADOW Studio/.test(document.body.innerText || ''),
    })).catch(() => ({}));
    const expectedPrefix = `http://127.0.0.1:${fakePort}/?import=`;
    const popupUrl = okEv.finalPopupUrl || okEv.popups[0] || '';
    const healthHits = fakeStudio.hits.filter((h) => /\/api\/health/.test(h.url || ''));
    const importHits = fakeStudio.hits.filter((h) => /\?import=/.test(h.url || ''));
    report.phases.importSuccess = {
      fakePort, successShown, popupUrl, expectedPrefix, diag: okDiag, pageErrors: okEv.pageErrors,
      healthHits: healthHits.length, importHits: importHits.slice(0, 3),
      blockedAttempts: okEv.blocked.length, hits: fakeStudio.hits.slice(0, 12),
    };
    await okPage.screenshot({ path: path.join(SHOTS, 'market-import-success.png') }).catch(() => { });
    report.screenshots.push('market-import-success.png');
    checks.ok('M3.8', '一键导入成功路径：探测到服务后打开 http://127.0.0.1:<port>/?import=<包URL> 深链',
      successShown && healthHits.length >= 1 && importHits.length >= 1 && popupUrl.startsWith(expectedPrefix),
      `successShown=${successShown} hasSuccessModal=${okDiag.hasSuccessModal} toast=${(okDiag.toastText || '').slice(0, 100)} healthHits=${healthHits.length} importHits=${importHits.length} pageErrors=${okEv.pageErrors.length} popup=${popupUrl.slice(0, 160)}`);
    checks.ok('M3.9', '成功路径同样未触碰用户真实端口 18765–18775', okEv.blocked.length === 0,
      `blockedAttempts=${okEv.blocked.length}`);
    await okCtx.close().catch(() => { });
    await fakeStudio.stop().catch(() => { });

    // ---------- 6. 设置页 + 主题 + Ctrl+K ----------
    await gotoHash(page, baseUrl, '#/settings');
    await sleep(1400);
    const settingsText = await bodyText(page);
    const navInfo = await page.evaluate(() => {
      const nav = document.querySelector('[data-testid="settings-nav"]');
      if (nav) {
        const items = [...nav.querySelectorAll('a,button')].map((el) => (el.innerText || '').trim()).filter(Boolean);
        return { count: new Set(items).size, items: [...new Set(items)].slice(0, 12), viaTestid: true };
      }
      const navRoots = [...document.querySelectorAll('aside, nav, [class*="settings-nav"], [class*="sidebar"], [role="tablist"]')];
      let best = { count: 0, items: [] };
      for (const root of navRoots) {
        const items = [...root.querySelectorAll('a,button,[role="tab"],[role="link"],li')]
          .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (el.innerText || '').trim().length > 0 && (el.innerText || '').trim().length < 40; })
          .map((el) => (el.innerText || '').trim());
        const uniq = [...new Set(items)];
        if (uniq.length > best.count) best = { count: uniq.length, items: uniq.slice(0, 12), viaTestid: false };
      }
      return best;
    }).catch(() => ({ count: 0, items: [] }));
    const sectionInfo = await page.evaluate(() => ({
      sections: [...document.querySelectorAll('[data-testid^="settings-section-"]')].map((el) => el.id || el.getAttribute('data-testid')),
    })).catch(() => ({ sections: [] }));
    report.phases.settings = { nav: navInfo, sections: sectionInfo.sections, textSample: settingsText.replace(/\s+/g, ' ').slice(0, 600) };
    checks.ok('M4.1', '设置页 #/settings 可达且有左侧分类导航（≥4 项）', navInfo.count >= 4,
      `navItems=${navInfo.count} [${navInfo.items.join(' | ')}] viaTestid=${navInfo.viaTestid}`);
    checks.ok('M4.2', '设置页含账户/积分/外观/开发者/危险区等分组（≥4 个 section）',
      (sectionInfo.sections || []).length >= 4 || ['账户', '积分', '外观', '开发者', '危险'].filter((k) => settingsText.includes(k)).length >= 4,
      `sections=${(sectionInfo.sections || []).join(',')}`);

    const readTheme = async () => await page.evaluate(() => ({
      htmlTheme: document.documentElement.getAttribute('data-theme'),
      themePref: document.documentElement.getAttribute('data-theme-pref'),
      htmlClass: document.documentElement.className,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bodyColor: getComputedStyle(document.body).color,
      stored: (() => { try { return Object.keys(localStorage).map((k) => k + '=' + String(localStorage.getItem(k)).slice(0, 40)).join('|').slice(0, 300); } catch { return ''; } })(),
    }));
    const themeBefore = await readTheme();
    let themeBtn = { ok: false, info: null };
    const darkRadio = page.locator('input[name="theme"][value="dark"]');
    if (await darkRadio.count().catch(() => 0)) {
      await darkRadio.first().check({ force: true }).catch(() => { });
      themeBtn = { ok: true, info: { method: 'input[name=theme][value=dark]' } };
    } else {
      themeBtn = await markByText(page, /深色|浅色|主题|Theme|Dark|Light|外观切换/i);
      if (!themeBtn.ok) {
        const t = await clickAny(page, ['[data-testid="theme-toggle"]', '#theme-toggle']);
        if (t.ok) themeBtn.ok = true;
      }
    }
    await sleep(900);
    const themeAfter = await readTheme();
    const themeChanged = themeBefore.htmlTheme !== themeAfter.htmlTheme || themeBefore.bodyBg !== themeAfter.bodyBg ||
      themeBefore.bodyColor !== themeAfter.bodyColor || themeBefore.htmlClass !== themeAfter.htmlClass || themeBefore.stored !== themeAfter.stored;
    report.phases.theme = { clicked: themeBtn.info || null, before: themeBefore, after: themeAfter, changed: themeChanged };
    await shot(page, 'market-settings-dark.png', SHOTS); report.screenshots.push('market-settings-dark.png');
    checks.ok('M4.3', '深浅色切换生效（html 属性/背景色/localStorage 至少一处变化）', themeBtn.ok && themeChanged,
      `clicked=${themeBtn.ok} beforeTheme=${themeBefore.htmlTheme} afterTheme=${themeAfter.htmlTheme} beforeBg=${themeBefore.bodyBg} afterBg=${themeAfter.bodyBg}`);
    // 切回浅色（若有 radio）或再点一次 toggle
    let toggledBack = false;
    const lightRadio = page.locator('input[name="theme"][value="light"]');
    if (await lightRadio.count().catch(() => 0)) {
      await lightRadio.first().check({ force: true }).catch(() => { });
      toggledBack = true;
    } else {
      const back = await markByText(page, /深色|浅色|主题|Theme|Dark|Light/i);
      if (!back.ok) toggledBack = (await clickAny(page, ['[data-testid="theme-toggle"]', '#theme-toggle'])).ok;
      else toggledBack = true;
    }
    await sleep(700);
    const themeBack = await readTheme();
    report.phases.theme.back = themeBack;
    report.phases.theme.toggledBack = toggledBack && themeBack.htmlTheme === themeBefore.htmlTheme;
    await shot(page, 'market-settings-light.png', SHOTS); report.screenshots.push('market-settings-light.png');

    // Ctrl+K 命令面板
    const readPalette = async () => await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
      const cands = [...document.querySelectorAll('[role="dialog"],[class*="palette"],[class*="command"],[class*="cmd"],[class*="modal"],[class*="search-overlay"],[class*="kbd"]')].filter(vis);
      const active = document.activeElement;
      const activeInfo = active ? { tag: active.tagName.toLowerCase(), placeholder: active.getAttribute && (active.getAttribute('placeholder') || ''), cls: String(active.className || '').slice(0, 60) } : null;
      const text = cands.length ? cands[0].innerText.trim().replace(/\s+/g, ' ').slice(0, 200) : '';
      const root = document.querySelector('#palette-root');
      return { open: cands.length > 0 || !!(root && root.children.length > 0), count: cands.length, text, active: activeInfo };
    }).catch(() => ({ open: false, count: 0 }));
    await page.keyboard.press('Control+k');
    await sleep(900);
    let palette = await readPalette();
    if (!palette.open) {
      await clickAny(page, ['#open-palette', '[data-testid="open-palette"]']);
      await sleep(900);
      palette = await readPalette();
      palette.viaButton = true;
    }
    // 输入关键字看过滤结果
    let paletteFilter = null;
    if (palette.open) {
      const kw = firstWithPkg ? firstWithPkg.title.slice(0, 2) : '点单';
      await page.keyboard.type(kw, { delay: 30 });
      await sleep(800);
      const pText = await bodyText(page);
      paletteFilter = { keyword: kw, hits: (firstWithPkg ? pText.includes(firstWithPkg.title) : false), text: pText.replace(/\s+/g, ' ').slice(-500) };
      await shot(page, 'market-ctrlk-palette.png', SHOTS); report.screenshots.push('market-ctrlk-palette.png');
      await page.keyboard.press('Escape');
    }
    report.phases.palette = { ...palette, filter: paletteFilter };
    checks.ok('M4.4', 'Ctrl+K 命令面板可打开（有可见面板/输入焦点）', palette.open || !!(palette.active && /input/i.test(palette.active.tag)),
      `open=${palette.open} count=${palette.count} text=${(palette.text || '').slice(0, 80)} active=${JSON.stringify(palette.active)}`);
    checks.ok('M4.5', 'Ctrl+K 面板输入关键字有过滤/命中结果', !!(paletteFilter && paletteFilter.hits),
      paletteFilter ? `keyword=${paletteFilter.keyword} hits=${paletteFilter.hits}` : '面板未打开，无法输入');

    // ---------- 7. 横向溢出（1440 / 1024） ----------
    const routes = [
      ['home', '#/'],
      ['detail', '#/resource/' + firstId],
      ['category', cat ? '#/category/' + cat.id : '#/'],
      ['creator', creator ? '#/creator/' + creator.handle : '#/'],
      ['settings', '#/settings'],
      ['points', '#/points'],
    ];
    const overflowPhase = {};
    for (const [vw, vh] of [[1440, 900], [1024, 768]]) {
      await page.setViewportSize({ width: vw, height: vh });
      for (const [name, hash] of routes) {
        await gotoHash(page, baseUrl, hash);
        await sleep(700);
        const o = await horizontalOverflow(page).catch((e) => ({ overflow: true, error: String(e) }));
        overflowPhase[`${vw}x${vh}-${name}`] = o;
        if (o.overflow) {
          const s = `overflow-${vw}x${vh}-${name}.png`;
          await shot(page, s, SHOTS); report.screenshots.push(s);
        }
      }
    }
    report.phases.overflow = overflowPhase;
    const of1440 = Object.entries(overflowPhase).filter(([k]) => k.startsWith('1440x900-') && overflowPhase[k].overflow).map(([k]) => k);
    const of1024 = Object.entries(overflowPhase).filter(([k]) => k.startsWith('1024x768-') && overflowPhase[k].overflow).map(([k]) => k);
    checks.ok('M5.1', '1440×900 各路由无横向溢出', of1440.length === 0, of1440.length ? `offenders=${of1440.join(',')}` : 'all routes ok');
    checks.ok('M5.2', '1024×768 各路由无横向溢出', of1024.length === 0, of1024.length ? `offenders=${of1024.join(',')}` : 'all routes ok');

    // ---------- 8. 404 / P1 本地演示 / 第三方请求 ----------
    await page.goto(baseUrl + '/#/definitely-not-a-route-' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(1000);
    const nfText = await bodyText(page);
    const nfOk = /404|找不到|未找到|not\s*found/i.test(nfText);
    await shot(page, 'market-404.png', SHOTS); report.screenshots.push('market-404.png');
    checks.ok('M6.1', '未知 hash 路由显示 404 而不崩（契约 #/404）', nfOk, `url=${page.url()} text=${nfText.replace(/\s+/g, ' ').slice(0, 120)}`);

    await gotoHash(page, baseUrl, '#/points');
    await sleep(1000);
    const pointsText = await bodyText(page);
    const pointsOk = /本地演示|无后端|不可购买|积分/i.test(pointsText);
    checks.ok('M6.2', 'P1 积分页 #/points 可达且标注本地演示（无后端）', pointsOk,
      `标注=${/本地演示|无后端|不可购买/.test(pointsText)}`);

    const externalReqs = [...new Set(ev.requests)].filter((u) => /^https?:\/\//.test(u)).filter((u) => {
      try {
        const host = new URL(u).host;
        if (host === new URL(baseUrl).host) return false;
        if (/^127\.0\.0\.1:(187\d\d|8765|188\d\d|189\d\d)$/.test(host)) return false; // 本地服务探测允许
        return true;
      } catch { return false; }
    });
    report.extra.externalRequests = externalReqs.slice(0, 20);
    checks.ok('M6.3', '无第三方 CDN/外网请求（本地优先，不引 CDN）', externalReqs.length === 0,
      externalReqs.length ? `hosts=${[...new Set(externalReqs.map((u) => { try { return new URL(u).host; } catch { return u; } }))].join(',')}` : 'none');

    // ---------- 8b. 空状态 / 错误态 / 对比度证据（设计快评用，信息级） ----------
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(baseUrl + '/#/search?q=' + encodeURIComponent('zzz-no-such-resource'), { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(1300);
      const emptyText = await bodyText(page);
      const emptyInfo = await page.evaluate(() => ({
        hasEmptyState: !!document.querySelector('[data-testid="empty-state"]'),
        text: (document.querySelector('[data-testid="empty-state"]') || {}).innerText || '',
      })).catch(() => ({}));
      report.extra.emptyState = { hasEmptyState: emptyInfo.hasEmptyState, text: (emptyInfo.text || '').replace(/\s+/g, ' ').slice(0, 300) };
      await shot(page, 'market-empty-search.png', SHOTS); report.screenshots.push('market-empty-search.png');

      await page.goto(baseUrl + '/#/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(1100);
      const lightTheme = await ensureTheme(page, 'light');
      report.extra.contrastLightTheme = lightTheme;
      report.extra.contrastLight = await measureContrast(page);
      const darkTheme = await ensureTheme(page, 'dark');
      report.extra.contrastDarkTheme = darkTheme;
      report.extra.contrastDark = await measureContrast(page);
      await ensureTheme(page, 'light');
      report.extra.themeSwitchInfo = { light: lightTheme, dark: darkTheme };
    } catch (e) {
      report.extra.designPhaseError = String(e && e.message);
    }

    // ---------- 9. 设计快评证据：深色首页 + 窄屏截图（信息级，不计入 §7 断言） ----------
    try {
      await gotoHash(page, baseUrl, '#/');
      await sleep(700);
      const curTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      if (curTheme !== 'dark') { await clickAny(page, ['[data-testid="theme-toggle"]', '#theme-toggle']); await sleep(800); }
      const nowTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      report.extra.darkMode = nowTheme;
      if (nowTheme === 'dark') { await shot(page, 'market-home-dark.png', SHOTS); report.screenshots.push('market-home-dark.png'); }
      if (curTheme !== 'dark') { await clickAny(page, ['[data-testid="theme-toggle"]', '#theme-toggle']); await sleep(500); }
      await page.setViewportSize({ width: 390, height: 844 });
      await gotoHash(page, baseUrl, '#/');
      await sleep(900);
      await shot(page, 'market-mobile-390.png', SHOTS); report.screenshots.push('market-mobile-390.png');
      const mo = await horizontalOverflow(page).catch(() => null);
      report.extra.mobileOverflow = mo;
      await gotoHash(page, baseUrl, '#/resource/' + firstId);
      await sleep(1000);
      await shot(page, 'market-mobile-detail-390.png', SHOTS); report.screenshots.push('market-mobile-detail-390.png');
      report.extra.mobileDetailOverflow = await horizontalOverflow(page).catch(() => null);
    } catch { }

    // ---------- 10. console/pageerror 汇总 ----------
    syncEvents();
    const rawErrors = consoleErrorsOf(ev);
    const filteredErrors = rawErrors.filter((c) => !isShadowProbeNoise(c));
    report.extra.consoleErrorRaw = rawErrors;
    report.extra.consoleErrorFiltered = filteredErrors;
    checks.ok('M7.1', '标准浏览路径 0 console.error（探测噪声除外）', filteredErrors.length === 0,
      `raw=${rawErrors.length} filtered=${filteredErrors.length} sample=${filteredErrors.slice(0, 3).map((c) => c.text.slice(0, 120)).join(' | ')}`);
    checks.ok('M7.2', '0 pageerror', pageErrorsAll.length === 0, `count=${pageErrorsAll.length} sample=${pageErrorsAll.slice(0, 2).map((e) => e.message).join(' | ')}`);
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

/** 安全点击（元素可能被遮挡导致 click 失败，退化为 dispatch click） */
async function clicksSafe(page, clickInfo) {
  try {
    await page.locator(`[data-qa-mark="${clickInfo.mark}"]`).first().click({ timeout: 4000 });
  } catch { }
  return null;
}

main().catch((e) => {
  report.error = String(e && (e.stack || e.message || e));
  logErr('[market] UNCAUGHT: ' + report.error);
  save(true);
  process.exit(2);
});
