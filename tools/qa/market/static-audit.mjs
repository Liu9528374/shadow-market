/**
 * static-audit.mjs - r11 产品原则静态审计（纯文件扫描，不起服务/浏览器）
 *
 * 对 docs/52 §1 的产品边界做可复核的静态证据检查：
 *   1) 两个产品分开：market/ 不引用桌面包代码；prototype/ 不嵌入商店 UI / market 路由。
 *   2) P0 全免费：目录 points 全 0 / free=true；market 源码无支付/抽成/DRM 文案与第三方支付脚本。
 *   3) BYOM：包内 mediaPolicy=byom；market/prototype 不托管用户媒体（无上传接口/无 multipart 上传代码）。
 *   4) 本地优先：market 无第三方 CDN/外链请求；无统计/分析 SDK；桌面端导入不联网（除 ?import= 取包）。
 *   5) 一切即插件：market 有 plugins/<type>/manifest.json 且前端读取；桌面端有插件 manifest + #plugin= 深链。
 *
 * 用法：D:\NODE\node.exe tools\qa\market\static-audit.mjs
 * 退出码：0 全 PASS；1 有 FAIL。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');
const MARKET = path.join(REPO, 'market');
const PROTO = path.join(REPO, 'prototype', 'index.html');
const LAUNCHER = path.join(REPO, 'tools', 'launcher', 'shadow-server.py');
const REPORT = path.join(__dirname, 'report-static-audit.json');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (name === 'node_modules' || name === '.git') continue; walk(p, out); }
    else out.push(p);
  }
  return out;
}
const read = (f) => fs.readFileSync(f, 'utf8');
const marketFiles = fs.existsSync(MARKET) ? walk(MARKET) : [];
const jsFiles = marketFiles.filter((f) => /\.(js|mjs|html|css|json|md)$/i.test(f) && !/data[\\/]packages[\\/]/.test(f));
const jsText = jsFiles.map((f) => ({ file: path.relative(REPO, f), text: read(f) }));

const checks = [];
function ok(id, name, cond, detail = '') {
  checks.push({ id, name, pass: !!cond, detail: String(detail) });
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${id} ${name}${detail ? ' :: ' + detail : ''}`);
  return !!cond;
}
function hits(files, re) {
  const out = [];
  for (const { file, text } of files) {
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => { if (re.test(line)) out.push(`${file}:${i + 1}: ${line.trim().slice(0, 140)}`); });
  }
  return out;
}
const report = { test: 'static-audit', round: 'r11', startedAt: new Date().toISOString(), checks, pass: false };
try {
  // 1) 两个产品分开
  const marketRefsDesktop = hits(jsText, /SHADOW-Studio-0\.7\.0\.html|prototype\/(index|src)|tools\/launcher/);
  ok('SA1', 'market/ 不引用桌面端代码（两个产品分开）', marketRefsDesktop.length === 0, marketRefsDesktop.slice(0, 3).join(' | '));
  const protoText = fs.existsSync(PROTO) ? read(PROTO) : '';
  const protoMarketRefs = (protoText.match(/#\/resource\/|shadow\.market|市场（|市场 P0|market\/assets/gi) || []).slice(0, 5);
  ok('SA2', 'prototype/ 不嵌入市场商店 UI/路由（桌面只保留导入薄接口）', protoMarketRefs.length === 0, protoMarketRefs.join(' | '));

  // 2) P0 全免费 / 无支付
  const paySdk = hits(jsText, /stripe\.|paypal|braintree|alipay|wechatpay|checkout\.|billing\./i);
  ok('SA3a', 'market/ 无第三方支付/计费 SDK 集成', paySdk.length === 0, paySdk.slice(0, 3).join(' | '));
  const payMentions = hits(jsText, /支付|抽成|分账|DRM|付费墙|订阅/);
  const payBad = payMentions.filter((h) => !/[不无没]/.test(h));
  ok('SA3b', 'market/ 关于支付/抽成/DRM 的提及均带否定（不做实现，只是边界说明）', payBad.length === 0,
    payBad.length ? payBad.slice(0, 3).join(' | ') : `negative mentions=${payMentions.length}`);
  const catalog = JSON.parse(read(path.join(MARKET, 'data', 'catalog.json')));
  const paid = (catalog.resources || []).filter((r) => r.points !== 0 || r.free !== true);
  ok('SA4', '目录资源全部 points=0 / free=true（P0 全免费）', paid.length === 0, paid.map((r) => r.id).join(',') || `${catalog.resources.length} 个资源全免费`);

  // 3) BYOM：不托管/不上传媒体
  const uploadHits = hits(jsText, /type=["']file["'][^>]*accept=["'][^"']*(video|audio|mp4|mp3)|<input[^>]+type=["']file["']/i)
    .filter((h) => !/course-input|shadow\.course/.test(h));
  ok('SA5', 'market/ 页面无媒体上传控件（BYOM：不接收用户媒体）', uploadHits.length === 0, uploadHits.slice(0, 3).join(' | '));
  const postHits = hits(jsText, /method:\s*['"]POST['"]/i);
  ok('SA6', 'market/ 无 POST 上传/提交请求（纯静态站，无后端）', postHits.length === 0, postHits.slice(0, 3).join(' | '));

  // 4) 本地优先：无第三方 CDN/分析
  const externalUrls = [];
  for (const { file, text } of jsText) {
    const ms = text.match(/https?:\/\/[^\s"'<>)]+/g) || [];
    for (const u of ms) {
      if (u.includes('${')) continue; // 模板字符串里的运行时 host（非真实外链）
      let hostname = '', host = '';
      try { const parsed = new URL(u); hostname = parsed.hostname; host = parsed.host; } catch { continue; }
      if (['127.0.0.1', 'localhost', '::1'].includes(hostname) || /^127\./.test(hostname)) continue;
      if (hostname === 'www.w3.org') continue; // SVG/XML 命名空间字符串，不是网络请求
      if (/\.invalid$/i.test(hostname)) continue; // 保留测试域名（不会解析）
      if (/example\.(com|org)$/i.test(hostname) || /jianguoyun\.com$/i.test(hostname)) continue; // 文档示例
      externalUrls.push(`${file}: ${u.slice(0, 120)}`);
    }
  }
  ok('SA7', 'market/ 无第三方 CDN/分析 SDK 外链（本地优先，可离线）', externalUrls.length === 0, externalUrls.slice(0, 5).join(' | '));
  const analytics = hits(jsText, /gtag\(|googletagmanager|segment\.io|sentry\.io|analytics\.js|hotjar|clarity\.ms/i);
  ok('SA8', 'market/ 无统计/分析埋点', analytics.length === 0, analytics.slice(0, 3).join(' | '));

  // 5) 一切即插件
  const pluginIdx = JSON.parse(read(path.join(MARKET, 'plugins', 'index.json')));
  const pluginList = pluginIdx.plugins || pluginIdx.types || [];
  ok('SA9', 'market/ 资源类型插件清单存在（一切即插件）', pluginList.length >= 1, pluginList.join(','));
  const appJs = read(path.join(MARKET, 'assets', 'js', 'app.js'));
  ok('SA10', 'market 前端启动时读取插件清单并注册类型渲染器', /plugins\/index\.json|loadPlugins|registerPlugin|pluginFor/.test(appJs),
    'app.js/data.js 引用 plugins/index.json');
  if (fs.existsSync(PROTO)) {
    const protoPlugins = /PLUGIN_MANIFEST_META|pluginManifestFor|PLUGIN_DEFAULTS/.test(protoText);
    const deepLink = /#plugin=|parsePluginDeepLink|openPluginSettings/.test(protoText);
    ok('SA11', '桌面端内置插件 manifest + #plugin= 设置深链（一切即插件继续深化）', protoPlugins && deepLink,
      `manifest=${protoPlugins} deepLink=${deepLink}`);
  } else ok('SA11', '桌面端内置插件 manifest', false, 'prototype/index.html 不存在');
  // 6) 桌面导入不跑 ASR（静态证据：导入路径不调用转写函数）
  if (fs.existsSync(PROTO)) {
    const starter = protoText.indexOf('function ingestCourseText');
    const ender = protoText.indexOf('function importCourseFile');
    const seg = starter >= 0 && ender > starter ? protoText.slice(starter, ender) : '';
    const asrCall = /transcribeTake\(|asrUrl\(|asrTranscribe\(|\/api\/asr/.test(seg);
    ok('SA12', '桌面导入路径代码不调用 ASR 转写（静态证据）', starter >= 0 && !asrCall,
      starter >= 0 ? `ingestCourseText 段内 asrCall=${asrCall}` : '未找到 ingestCourseText');
  } else ok('SA12', '桌面导入路径代码不调用 ASR', false, 'prototype/index.html 不存在');

  // 7) /api/font 只读静态证据
  if (fs.existsSync(LAUNCHER)) {
    const launcher = read(LAUNCHER);
    const hasList = /\/api\/font\/list/.test(launcher);
    const hasFile = /\/api\/font\/file/.test(launcher);
    const fontStart = launcher.indexOf('def api_font_list');
    const fontEnd = launcher.indexOf('def api_asr_proxy');
    const fontSeg = fontStart >= 0 && fontEnd > fontStart ? launcher.slice(fontStart, fontEnd) : '';
    const diskWrites = /open\([^)]*["'][wa][^"']*["']|os\.(remove|unlink|rename|makedirs?)\(|shutil\.(copy|move|copyfile)\(/.test(fontSeg);
    const whitelist = /FONT_WHITELIST|_font_directories|Windows\\+Fonts|Fonts/i.test(launcher);
    const getOnly = /path == "\/api\/font\/list"[\s\S]{0,200}method_effective != "GET"/.test(launcher)
      && /path == "\/api\/font\/file"[\s\S]{0,200}method_effective != "GET"/.test(launcher);
    ok('SA13', 'shadow-server.py 提供只读 /api/font/list + /api/font/file（GET-only，非 GET→405）', hasList && hasFile && getOnly,
      `list=${hasList} file=${hasFile} getOnly=${getOnly}`);
    ok('SA14', '字体接口白名单限定系统字体目录 + 处理函数无磁盘写入', whitelist && !diskWrites && fontSeg.length > 400,
      `whitelist=${whitelist} diskWrites=${diskWrites} fontSeg=${fontSeg.length}B`);
    const basename = /resolve_font_file|basename/i.test(fontSeg) || /白名单/.test(fontSeg);
    ok('SA15', '字体文件名走白名单/ basename 解析（路径穿越防护静态证据）', basename, `basenameOrWhitelist=${basename}`);
  } else ok('SA13', '/api/font 只读', false, 'shadow-server.py 不存在');

  report.summary = { total: checks.length, passed: checks.filter((c) => c.pass).length, failed: checks.filter((c) => !c.pass).length };
  report.pass = report.summary.failed === 0;
} catch (e) {
  report.fatal = String(e && (e.stack || e.message || e));
  console.error('[static-audit] FATAL: ' + report.fatal);
}
report.finishedAt = new Date().toISOString();
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
console.log(`\n[static-audit] ${report.summary ? `${report.summary.passed}/${report.summary.total} PASS` : '0/0'} -> ${REPORT}`);
process.exit(report.pass ? 0 : 1);
