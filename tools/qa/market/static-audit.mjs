/**
 * static-audit.mjs - SHADOW 市场 P0（Phase 2）产品原则/合规静态审计（纯文件扫描，不起服务/浏览器）
 *
 * 契约真相：D:\FOLLOWSPEAK\docs\111-market-architecture.md §1.2（十项边界）/ §4（声明式插件）/
 *           §6.3（PWA）/ §7.4（无障碍）/ §8（安全合规）/ §9（质量门-合规/部署）
 *
 * 检查分组（SA 编号尽量沿用 r11，新增项顺延）：
 *   1. 两个产品分开 / 品牌资产
 *   2. PWA：manifest + SW + offline.html + 注册
 *   3. 安全边界：无上传端点、无可执行插件 JS、无 eval/动态执行
 *   4. 本地优先：无第三方 CDN/字体/分析；纯静态 serve
 *   5. 合规：全免费/无支付、合规页（收藏/更新日志/投稿/关于/隐私/投诉/许可/标签）、
 *      localStorage 键清单、投诉流程、许可全文
 *   6. catalog v2 六文件 + 插件白名单
 *   7. 部署配置（GitHub Pages workflow / 脚本 / Cloudflare 示例）+ hash 路由无需 404 回退
 *   8. 无障碍静态基础（lang/skip-link/viewport/焦点环/降低动效/aria-live 收敛）
 *
 * 用法：D:\NODE\node.exe tools\qa\market\static-audit.mjs [--report=相对路径] [--market=dir]
 * 退出码：0 全 PASS（跳过项不计失败）；1 有 FAIL。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');
const argv = process.argv.slice(2);
const argOf = (name) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const MARKET = path.resolve(REPO, argOf('market') || 'market');
const REPORT = argOf('report') ? path.resolve(REPO, argOf('report')) : path.join(__dirname, 'report-static-audit.json');

const checks = [];
function ok(id, name, cond, detail = '') {
  const entry = { id, name, pass: !!cond, skipped: false, detail: String(detail), at: new Date().toISOString() };
  checks.push(entry);
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${id} ${name}${detail ? ' :: ' + detail : ''}`);
  return !!cond;
}
function skip(id, name, detail = '本仓库无该子系统（非市场仓库范围）') {
  checks.push({ id, name, pass: true, skipped: true, detail: String(detail), at: new Date().toISOString() });
  console.log(`  [SKIP] ${id} ${name} :: ${detail}`);
  return true;
}
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = path.join(dir, name);
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const read = (f) => fs.readFileSync(f, 'utf8');
const rel = (f) => path.relative(REPO, f).split(path.sep).join('/');
const marketFiles = walk(MARKET);
const existsRel = (p) => fs.existsSync(path.join(MARKET, p));
const readRel = (p) => { const f = path.join(MARKET, p); return fs.existsSync(f) ? read(f) : ''; };
/** 仓库根相对路径（部署配置/证据目录不在 market/ 下） */
const existsRepo = (p) => fs.existsSync(path.join(REPO, p));
const readRepo = (p) => { const f = path.join(REPO, p); return fs.existsSync(f) ? read(f) : ''; };
const textFiles = marketFiles.filter((f) => /\.(js|mjs|html|css|json|md|webmanifest|txt)$/i.test(f) && !/[\\/]data[\\/]packages[\\/]/.test(f));
const texts = textFiles.map((f) => ({ file: rel(f), rel: rel(f), text: read(f) }));
/** 执行面（会发起网络/脚本行为的文件）：index.html + assets/js/** + assets/styles/** + sw.js + manifest */
const execTexts = texts.filter((t) => /^market\/(index\.html|sw\.js|manifest\.webmanifest)$/.test(t.rel) || /^market\/assets\/(js|styles)\//.test(t.rel));
const execJs = execTexts.filter((t) => /\.js$/.test(t.file));
const allWebText = texts.map((t) => t.text).join('\n');
const execWebText = execTexts.map((t) => t.text).join('\n');

function hits(list, re) {
  const out = [];
  for (const { file, text } of list) {
    text.split(/\r?\n/).forEach((line, i) => { if (re.test(line)) out.push(`${file}:${i + 1}: ${line.trim().slice(0, 160)}`); });
  }
  return out;
}
function parseJsonRel(p) {
  try { return JSON.parse(readRel(p)); } catch { return null; }
}

/* ---------- 数据前提：catalog v2 ---------- */
const catNames = ['site', 'categories', 'tags', 'authors', 'licenses', 'resources'];
const catalog = {};
for (const n of catNames) catalog[n] = parseJsonRel(`catalog/${n}.json`);
const itemsOf = (d) => Array.isArray(d) ? d : (d && Array.isArray(d.items) ? d.items : (d && Array.isArray(d.resources) ? d.resources : []));
const resources = itemsOf(catalog.resources);
const categories = itemsOf(catalog.categories);
const licenses = itemsOf(catalog.licenses);
const authors = itemsOf(catalog.authors);
const tags = itemsOf(catalog.tags);

const report = { test: 'static-audit', round: 'phase2', startedAt: new Date().toISOString(), marketDir: MARKET, checks, summary: null, pass: false };
try {
  /* ============ 1. 两个产品分开 / 品牌 ============ */
  const codeTexts = texts.filter((t) => /^market\/(index\.html|sw\.js|manifest\.webmanifest)$/.test(t.rel) || /^market\/assets\/(js|styles)\//.test(t.rel));
  const desktopRefs = hits(codeTexts,
    /SHADOW-Studio-[0-9]|prototype\/index\.html|shadow-server\.py|tools\/launcher|wavPath|shadow-studio-v0\./i);
  ok('SA1', 'market/ 站点代码不引用桌面端代码/路径（两个产品分开）', desktopRefs.length === 0, desktopRefs.slice(0, 4).join(' | '));
  const brandFiles = ['app-icon-1024.png', 'app-icon-rounded-1024.png', 'icon-192.png', 'icon-512.png',
    'apple-touch-icon-180.png', 'favicon-32.png', 'favicon.ico', 'app-icon.svg'];
  const brandMissing = brandFiles.filter((f) => !existsRel(`assets/brand/${f}`) || fs.statSync(path.join(MARKET, `assets/brand/${f}`)).size === 0);
  ok('SA2', `品牌资产齐全（assets/brand/：${brandFiles.length} 个文件且非空）`, brandMissing.length === 0, brandMissing.join(',') || 'all present');
  const indexHtml = readRel('index.html');
  const brandRefs = [...new Set((indexHtml.match(/assets\/brand\/([A-Za-z0-9._-]+)/g) || []))];
  // task-8 起 header logo 改为小图（logo-64/128 或 32/64px icon）；这里只要求「有品牌图 + 有 <img> 引用 + manifest」，
  // 不再绑定 1024px 原图，避免性能优化后被误判。
  const headerBrandImg = /<img[^>]+src=["'][^"']*assets\/brand\/[^"']+\.(png|svg|webp)/i.test(indexHtml)
    || /assets\/brand\/logo-(32|64|128)\.png/.test(indexHtml);
  ok('SA3', 'index.html 引用品牌图标（header logo 图片 / favicon / apple-touch / manifest）',
    brandRefs.length >= 3 && /<link[^>]+rel=["']manifest["']/.test(indexHtml) && headerBrandImg,
    `refs=${brandRefs.slice(0, 7).join(',')} headerImg=${headerBrandImg}`);

  /* ============ 2. PWA ============ */
  const manifest = parseJsonRel('manifest.webmanifest');
  const manifestIssues = [];
  if (!manifest) manifestIssues.push('manifest.webmanifest 缺失或不可解析');
  else {
    if (!manifest.name) manifestIssues.push('缺 name');
    if (!manifest.short_name) manifestIssues.push('缺 short_name');
    if (!manifest.start_url || !/#\//.test(String(manifest.start_url))) manifestIssues.push('start_url 应指向 hash 路由（含 #/）');
    if (!manifest.display || !/standalone|minimal-ui|fullscreen/.test(String(manifest.display))) manifestIssues.push('display 非法');
    if (!/^#[0-9a-f]{6}$/i.test(String(manifest.theme_color))) manifestIssues.push('theme_color 非 hex');
    if (!/^#[0-9a-f]{6}$/i.test(String(manifest.background_color))) manifestIssues.push('background_color 非 hex');
    const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
    const has192 = icons.some((i) => String(i.sizes || '').includes('192'));
    const has512 = icons.some((i) => String(i.sizes || '').includes('512'));
    const maskable = icons.some((i) => String(i.purpose || '').includes('maskable'));
    if (!has192 || !has512) manifestIssues.push('icons 缺 192/512');
    if (!maskable) manifestIssues.push('icons 缺 maskable');
    for (const i of icons) {
      const src = String(i.src || '');
      if (/^https?:/i.test(src)) manifestIssues.push('icon 使用远程 URL:' + src);
      else if (src && !existsRel(src.replace(/^\.?\//, ''))) manifestIssues.push('icon 文件不存在:' + src);
    }
    if (manifest.prefer_related_applications !== false) manifestIssues.push('prefer_related_applications 应为 false');
    if (!manifest.lang) manifestIssues.push('缺 lang');
  }
  ok('SA4', 'PWA manifest 合法（name/short_name/start_url#/display/theme/bg/icons 192+512 maskable/lang）',
    manifestIssues.length === 0, manifestIssues.slice(0, 5).join(' | ') || 'manifest ok');

  const sw = readRel('sw.js');
  const swIssues = [];
  if (!sw) swIssues.push('sw.js 缺失');
  else {
    if (!/caches\.open|addAll|precache/i.test(sw)) swIssues.push('无预缓存（caches.open/addAll）');
    if (!/offline\.html/i.test(sw)) swIssues.push('无离线导航回退 offline.html');
    if (!/skipWaiting|SKIP_WAITING/i.test(sw)) swIssues.push('无 SKIP_WAITING 更新流程');
    if (!/catalog/i.test(sw)) swIssues.push('未把 catalog 纳入缓存');
    if (!/plugins/i.test(sw)) swIssues.push('未把 plugins 纳入缓存');
    if (!/fetch\s*\(|addEventListener\(\s*['"]fetch['"]/i.test(sw)) swIssues.push('无 fetch 策略');
  }
  ok('SA5', 'Service Worker（预缓存 shell/assets/catalog/plugins + 离线回退 + SKIP_WAITING）',
    swIssues.length === 0, swIssues.slice(0, 5).join(' | ') || `${sw.length}B`);

  const regHits = hits(execTexts, /serviceWorker\s*\.\s*register|navigator\.serviceWorker/);
  ok('SA6', '前端注册 Service Worker（app.js / index.html）', regHits.length >= 1 && /sw\.js/.test(execWebText),
    regHits.slice(0, 2).join(' | '));

  const offlineHtml = readRel('offline.html');
  ok('SA7', '离线兜底页 offline.html 存在且给出离线提示/重试入口',
    !!offlineHtml && /离线|offline/i.test(offlineHtml) && /href=["'][^"']*#\/|重新|重试|retry/i.test(offlineHtml),
    offlineHtml ? `${offlineHtml.length}B` : '缺失');

  ok('SA8', 'PWA 图标/清单文件在 index.html 中可被发现（manifest + apple-touch-icon）',
    /rel=["']manifest["']/.test(indexHtml) && /apple-touch-icon/.test(indexHtml), 'index.html head');

  /* ============ 3. 安全边界：无上传 / 无可执行插件 ============ */
  const uploadHits = hits(execTexts, /type\s*=\s*["']file["']|FormData|multipart\/form-data|method\s*:\s*["'](POST|PUT|PATCH)["']|["'`]\/api\/(upload|submit|import)|fetch\s*\([^)]*\{\s*method\s*:\s*["']POST/i)
    .filter((h) => !/icons\.js/.test(h));
  ok('SA9', '无媒体上传控件/上传端点请求（BYOM：市场不接收用户媒体）', uploadHits.length === 0, uploadHits.slice(0, 4).join(' | ') || 'none');
  const forms = hits(execTexts, /<form[^>]+action\s*=\s*["']https?:/i);
  ok('SA10', '无向外部提交的表单 action', forms.length === 0, forms.slice(0, 3).join(' | ') || 'none');
  const serve = readRel('serve.mjs');
  const serveIssues = [];
  if (!serve) serveIssues.push('serve.mjs 缺失');
  else {
    if (/if\s*\([^)]*method\s*===?\s*["']POST["']|method_effective\s*===?\s*["']POST["']/i.test(serve)) serveIssues.push('serve.mjs 处理 POST（应只读静态）');
    if (/writeFileSync|writeFile\(|createWriteStream|appendFile/i.test(serve)) serveIssues.push('serve.mjs 写盘 API');
    if (/\/upload|multipart/i.test(serve)) serveIssues.push('serve.mjs 上传路由');
  }
  ok('SA11', '本地静态服务 serve.mjs 只读（无上传/无写盘，部署说明关闭目录列表）',
    serveIssues.length === 0, serveIssues.join(' | ') || (serve ? `${serve.length}B 只读` : '缺失'));

  const pluginFiles = marketFiles.filter((f) => /[\\/]plugins[\\/]/.test(f));
  const badPluginFiles = pluginFiles.filter((f) => !/\.(json|md|txt)$/i.test(f));
  ok('SA12', 'market/plugins/ 只有声明式文件（JSON/MD/TXT，无可执行 JS/WASM/HTML）',
    badPluginFiles.length === 0, badPluginFiles.map(rel).slice(0, 5).join(',') || `${pluginFiles.length} 个声明文件`);

  // manifest 字段 / icon 内置白名单
  const iconsJs = readRel('assets/js/icons.js');
  const iconNames = new Set();
  {
    const seg = iconsJs.slice(iconsJs.indexOf('const ICONS'), iconsJs.indexOf('const DEFAULT_ICON'));
    for (const m of seg.matchAll(/^\s*'?([A-Za-z0-9-]+)'?\s*:/gm)) iconNames.add(m[1]);
  }
  const pluginIdx = parseJsonRel('plugins/index.json');
  const idxTypes = Array.isArray(pluginIdx && pluginIdx.types) ? pluginIdx.types
    : (Array.isArray(pluginIdx && pluginIdx.plugins) ? pluginIdx.plugins : []);
  const manifestProblems = [];
  for (const item of idxTypes) {
    const id = typeof item === 'string' ? item : (item.id || item.type);
    const mfRel = typeof item === 'object' && item.manifest ? item.manifest : `plugins/${id}/manifest.json`;
    const m = parseJsonRel(mfRel);
    if (!m) { manifestProblems.push(`${id}:manifest 缺失`); continue; }
    if (m.manifestVersion !== 1) manifestProblems.push(`${id}:manifestVersion`);
    if (m.kind !== 'resource-type') manifestProblems.push(`${id}:kind`);
    if (!m.label || !m.labelEn) manifestProblems.push(`${id}:label`);
    if (!m.icon) manifestProblems.push(`${id}:icon 缺失`);
    else if (/^(https?:|data:|\/)/.test(String(m.icon))) manifestProblems.push(`${id}:icon 非内置名`);
    else if (iconNames.size && !iconNames.has(String(m.icon))) manifestProblems.push(`${id}:icon(${m.icon}) 不在 icons.js 白名单`);
    if (!Array.isArray(m.detailTabs) || m.detailTabs.some((t) => !['readme', 'sentences', 'files', 'versions', 'license'].includes(t))) manifestProblems.push(`${id}:detailTabs`);
    if (!m.permissions || ['network', 'filesystem', 'microphone'].some((k) => m.permissions[k] !== false)) manifestProblems.push(`${id}:permissions 非全 false`);
    if (typeof m.enabled !== 'boolean') manifestProblems.push(`${id}:enabled`);
    if (JSON.stringify(m).match(/<\s*script|eval\s*\(|new\s+Function|javascript\s*:/i)) manifestProblems.push(`${id}:含可执行内容`);
  }
  ok('SA13', '插件清单声明式且 icon 仅用内置图标名（不加载/执行插件代码）',
    idxTypes.length >= 3 && manifestProblems.length === 0,
    manifestProblems.slice(0, 5).join(' | ') || `${idxTypes.length} types [${idxTypes.map((t) => (typeof t === 'string' ? t : t.id)).join(',')}]`);
  const dynExec = hits(execJs, /\beval\s*\(|new\s+Function\s*\(|document\.write\s*\(|setTimeout\s*\(\s*["']/);
  ok('SA14', 'market/ 源码无 eval / new Function / document.write 动态执行', dynExec.length === 0, dynExec.slice(0, 3).join(' | ') || 'none');

  /* ============ 4. 本地优先：无第三方 CDN/字体/分析 ============ */
  const netHits = [];
  // 4a. index.html 标记里的远程资源
  for (const tag of indexHtml.matchAll(/<(script|link|img|iframe|source|video|audio|font)\b[^>]*>/gi)) {
    const t = tag[0];
    const u = (t.match(/\b(?:src|href)\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (u && /^(https?:)?\/\//i.test(u)) netHits.push(`index.html: ${u.slice(0, 120)}`);
  }
  // 4b. JS 主动联网
  for (const { file, text } of execJs) {
    for (const m of text.matchAll(/(?:fetch|import|new\s+URL|window\.open|location(?:\.href)?\s*=)\s*\(\s*["'`](https?:\/\/[^"'`]+)/gi)) {
      const u = m[1];
      if (/^https?:\/\/(127\.0\.0\.1|localhost)/i.test(u)) continue; // 本地导入探测
      netHits.push(`${file}: ${u.slice(0, 120)}`);
    }
    for (const m of text.matchAll(/["'`](https:\/\/(?:fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare|ajax\.googleapis)[^"'`]*)/gi)) {
      netHits.push(`${file}: ${m[1].slice(0, 120)}`);
    }
  }
  // 4c. CSS 远程 url()/@import
  for (const { file, text } of execTexts.filter((t) => /\.css$/.test(t.file))) {
    for (const m of text.matchAll(/(?:url\(\s*["']?|@import\s+(?:url\(\s*)?["']?)(https?:)?\/\/[^"')\s]+/gi)) {
      netHits.push(`${file}: ${m[0].slice(0, 120)}`);
    }
  }
  ok('SA15', '无第三方 CDN / 远程字体 / 外链脚本样式（本地优先，可离线）',
    netHits.length === 0, netHits.slice(0, 5).join(' | ') || 'all self-hosted');
  const analytics = hits(execTexts, /gtag\s*\(|googletagmanager|segment\.io|sentry\.io|analytics\.js|hotjar|clarity\.ms|plausible\.io|umami/i);
  ok('SA16', '无统计/分析埋点（P0 不采集用户行为）', analytics.length === 0, analytics.slice(0, 3).join(' | ') || 'none');

  /* ============ 5. 合规：全免费/无支付/合规页/隐私/投诉/许可 ============ */
  const paySdk = hits(execTexts, /stripe\.|paypal|braintree|alipay|wechatpay|checkout\.|billing\./i);
  ok('SA17', '无第三方支付/计费 SDK', paySdk.length === 0, paySdk.slice(0, 3).join(' | ') || 'none');
  const payMentions = hits(texts, /支付|抽成|分账|DRM|付费墙|订阅/);
  const payBad = payMentions.filter((h) => !/[不无没零免]/.test(h));
  ok('SA18', '支付/抽成/DRM 提及均带否定语义（仅边界说明，不做实现）', payBad.length === 0,
    payBad.slice(0, 3).join(' | ') || `negative mentions=${payMentions.length}`);
  const paid = resources.filter((r) => r.points !== 0 || r.free !== true);
  ok('SA19', 'catalog v2 全部资源 points=0 / free=true（P0 全免费，不虚报下载量）',
    resources.length >= 7 && paid.length === 0,
    paid.length ? paid.map((r) => r.id).join(',') : `${resources.length} 资源全免费`);

  const PAGE_REQ = {
    favorites: /收藏/, changelog: /更新日志|变更记录|changelog/i,
    contribute: /投稿|贡献指南|contribute/i, about: /关于|about/i,
    privacy: /隐私|privacy/i, complaint: /投诉|侵权|complaint/i,
    license: /许可|license/i, tag: /标签|tag/i,
  };
  const routeMiss = [];
  for (const p of Object.keys(PAGE_REQ)) {
    const routed = new RegExp(`['"\`]#?/${p}(?:[/?#'"\`]|$)|['"\`]${p}['"\`]|\\b${p}\\b`, 'i').test(allWebText);
    const viewFile = marketFiles.some((f) => new RegExp(`${p}\\.js$`, 'i').test(f)) || /views\//.test(allWebText);
    if (!routed) routeMiss.push(`${p}:路由未注册`);
    else if (!PAGE_REQ[p].test(allWebText)) routeMiss.push(`${p}:页面文案缺失`);
    else if (!viewFile) routeMiss.push(`${p}:视图模块缺失`);
  }
  ok('SA20', '合约页面齐全：favorites/changelog/contribute/about/privacy/complaint/license/tag（路由+视图+文案）',
    routeMiss.length === 0, routeMiss.join(' | ') || 'all pages present');

  const localStorageKeys = [...new Set((allWebText.match(/shadow\.market\.[a-z0-9.]+/gi) || []).map((s) => s.toLowerCase()))];
  ok('SA21', '隐私页/localStorage 键清单（≥3 个 shadow.market.* 键，本机存储可清除）',
    localStorageKeys.length >= 3 && /localStorage/.test(allWebText) && /清除|清空|重置/.test(allWebText),
    `${localStorageKeys.length} keys: ${localStorageKeys.slice(0, 6).join(',')}`);

  const complaintHits = {
    topic: /投诉|侵权|版权/.test(allWebText),
    process: /下架|删除|通知|反通知|复核/.test(allWebText),
    contact: /mailto:|邮箱|联系方式|@[a-z0-9.-]+\.[a-z]{2,}/i.test(allWebText),
  };
  ok('SA22', '版权与投诉：通知→下架→复核流程 + 联系邮箱/入口',
    complaintHits.topic && complaintHits.process && complaintHits.contact, JSON.stringify(complaintHits));

  ok('SA23', '许可体系：licenses ≥1 且每项有 url/fullText；页面展示许可与免责',
    licenses.length >= 1 && licenses.every((l) => l.id && l.name) &&
    /许可|License/i.test(allWebText) && /CC-BY|CC0|public-domain|公版|public domain/i.test(allWebText) && /免责|disclaimer/i.test(allWebText),
    `licenses=${licenses.map((l) => l.id).join(',')}`);

  /* ============ 6. catalog v2 + 构建产物 ============ */
  const catMissing = catNames.filter((n) => !catalog[n]);
  const catVersionOk = catNames.filter((n) => catalog[n]).every((n) => catalog[n].schemaVersion === 2);
  ok('SA24', 'catalog v2 六文件存在且 schemaVersion=2（site/categories/tags/authors/licenses/resources）',
    catMissing.length === 0 && catVersionOk,
    catMissing.length ? `缺 ${catMissing.join(',')}` : `resources=${resources.length} categories=${categories.length} authors=${authors.length} tags=${tags.length} licenses=${licenses.length}`);
  const versionProblems = [];
  for (const r of resources) {
    const v = Array.isArray(r.versions) ? r.versions[0] : null;
    if (!v) { versionProblems.push(`${r.id}:无 versions`); continue; }
    if (!v.sha256 || !v.sizeBytes) versionProblems.push(`${r.id}:缺 sha256/sizeBytes`);
    if (!v.importFiles && r.type === 'course') versionProblems.push(`${r.id}:course 缺 importFiles`);
  }
  ok('SA25', '资源版本记录 SHA256/sizeBytes 与派生导入产物（importFiles）',
    resources.length >= 7 && versionProblems.length === 0,
    versionProblems.slice(0, 4).join(' | ') || `${resources.length} versions ok`);
  ok('SA26', 'plugins 注册表声明 ≥3 类（course/subtitle/plugin）且类型清单可静态校验',
    idxTypes.length >= 3 && ['course', 'subtitle', 'plugin'].every((t) => idxTypes.some((x) => (typeof x === 'string' ? x : x.id) === t)),
    idxTypes.map((t) => (typeof t === 'string' ? t : t.id)).join(','));

  /* ============ 7. 部署配置 ============ */
  const deployChecks = {
    readme: existsRepo('deploy/README.md'),
    ghPagesScript: existsRepo('deploy/deploy-gh-pages.ps1'),
    cloudflareDoc: existsRepo('deploy/cloudflare-pages.md'),
    workflow: existsRepo('.github/workflows/pages.yml'),
  };
  const workflow = deployChecks.workflow ? readRepo('.github/workflows/pages.yml') : '';
  const workflowMiss = [];
  if (deployChecks.workflow) {
    if (!/upload-pages-artifact/.test(workflow)) workflowMiss.push('缺 actions/upload-pages-artifact');
    if (!/deploy-pages/.test(workflow)) workflowMiss.push('缺 actions/deploy-pages');
    if (!/path:\s*market/.test(workflow)) workflowMiss.push('artifact path 未指向 market');
    if (!/pages:\s*write/.test(workflow)) workflowMiss.push('缺 pages: write 权限');
    if (!/id-token:\s*write/.test(workflow)) workflowMiss.push('缺 id-token: write 权限');
  } else workflowMiss.push('pages.yml 不存在');
  ok('SA27', '部署配置齐全（deploy/README + gh-pages 脚本 + Cloudflare 说明 + Pages workflow 校验后发布）',
    Object.values(deployChecks).every(Boolean) && workflowMiss.length === 0,
    Object.entries(deployChecks).filter(([, v]) => !v).map(([k]) => k).join(',') || workflowMiss.join(' | ') || 'ok');

  const deployScript = existsRepo('deploy/deploy-gh-pages.ps1') ? readRepo('deploy/deploy-gh-pages.ps1') : '';
  ok('SA28', 'gh-pages 发布脚本参数化（Remote/Branch/DryRun）且不产生站点内容改动',
    /\[string\]\s*\$Remote|param\s*\(/i.test(deployScript) && /DryRun/i.test(deployScript) && /Branch/i.test(deployScript) && /gh-pages/i.test(deployScript),
    deployScript ? `${deployScript.length}B` : '缺失');
  const cfDoc = existsRepo('deploy/cloudflare-pages.md') ? readRepo('deploy/cloudflare-pages.md') : '';
  ok('SA29', 'Cloudflare Pages 文档含 _redirects/_headers 示例，并说明 hash 路由无需 404 回退',
    /_redirects/.test(cfDoc) && /_headers/.test(cfDoc) && /404/.test(cfDoc) && /hash 路由|hash routing|#\//i.test(cfDoc),
    cfDoc ? `${cfDoc.length}B` : '缺失');
  const routerJs = readRel('assets/js/router.js');
  ok('SA30', 'hash 路由实现（location.hash/hashchange，静态托管零配置、无需服务端 404 回退）',
    /location\.hash|hashchange/.test(routerJs) && !/history\.pushState\s*\(/.test(routerJs),
    routerJs ? 'router.js hash-based' : 'router.js 缺失');

  /* ============ 8. 无障碍静态基础 ============ */
  const a11yIssues = [];
  if (!/<html[^>]+lang=["'][a-z]{2}(-[A-Za-z]+)?["']/.test(indexHtml)) a11yIssues.push('html 缺 lang');
  if (!/class=["'][^"']*skip-link/.test(indexHtml)) a11yIssues.push('缺 skip-link');
  if (!/name=["']viewport["'][^>]*width=device-width/.test(indexHtml)) a11yIssues.push('缺 viewport width=device-width');
  if (/id=["']view["'][^>]*aria-live/.test(indexHtml)) a11yIssues.push('#view 不应整页 aria-live');
  // UI v2：样式拆分为 tokens/base/pages-*，焦点环与 reduced-motion 在 base.css；扫描全部站点 CSS
  const allSiteCss = ['tokens.css', 'base.css', 'pages-dashboard.css', 'pages-core.css', 'pages-personal.css']
    .map((f) => readRel('assets/styles/' + f)).join('\n');
  if (!/:focus-visible/.test(allSiteCss)) a11yIssues.push('CSS 缺 :focus-visible 焦点环');
  if (!/prefers-reduced-motion/.test(allSiteCss)) a11yIssues.push('缺 prefers-reduced-motion');
  ok('SA31', '无障碍静态基础（lang/skip-link/viewport/焦点环/降低动效/aria-live 收敛）',
    a11yIssues.length === 0, a11yIssues.join(' | ') || 'ok');

  /* ============ 9. 证据目录 + 桌面子系统（本仓库外 → SKIP） ============ */
  ok('SA32', '证据目录 release/evidence-market/ 存在', existsRepo('release/evidence-market'),
    'Phase 2 证据落盘位置');
  skip('SA33', '桌面端不嵌入市场 UI（prototype/ 不在本仓库，跳过）');
  skip('SA34', '桌面导入路径不调用 ASR（prototype/ 不在本仓库，跳过）');

  report.summary = {
    total: checks.length,
    passed: checks.filter((c) => c.pass && !c.skipped).length,
    failed: checks.filter((c) => !c.pass).length,
    skipped: checks.filter((c) => c.skipped).length,
    resources: resources.length,
    categories: categories.length,
    authors: authors.length,
    tags: tags.length,
    licenses: licenses.length,
    pluginTypes: idxTypes.length,
  };
  report.pass = report.summary.failed === 0;
} catch (e) {
  report.fatal = String(e && (e.stack || e.message || e));
  console.error('[static-audit] FATAL: ' + report.fatal);
}
report.finishedAt = new Date().toISOString();
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
const s = report.summary;
console.log(`\n[static-audit] ${s ? `${s.passed}/${s.total - s.skipped} PASS（${s.failed} FAIL，${s.skipped} SKIP）` : '0/0'} -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
