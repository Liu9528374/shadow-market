#!/usr/bin/env node
/**
 * SHADOW 市场 · 本地静态服务（零依赖）
 *
 * 用途：本地预览市场 Web / 深链联调 / 让 SHADOW Studio 能通过 CORS fetch 课程包。
 * 用法：
 *   node market/serve.mjs                 # 默认 http://127.0.0.1:18920/
 *   node market/serve.mjs --port 19000    # 指定起始端口（占用则 +1..+20）
 *   node market/serve.mjs --host 0.0.0.0  # 局域网预览（默认只绑 127.0.0.1）
 *
 * 特性：CORS *、正确 MIME、HEAD、Range（206，大文件/断点）、目录 index、路径穿越防护、
 *      404 友好提示、一行一请求日志。纯静态、无构建、无第三方依赖。
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 18920;
const MAX_PORT_OFFSET = 20;

const MIME = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.shadowcourse': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
  '.map': 'application/json; charset=utf-8',
}));

function parseArgs(argv) {
  const opts = { host: '127.0.0.1', port: DEFAULT_PORT };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if ((a === '--port' || a === '-p') && argv[i + 1]) { opts.port = Number(argv[++i]); }
    else if ((a === '--host' || a === '-h') && argv[i + 1]) { opts.host = argv[++i]; }
    else if (a === '--help') { opts.help = true; }
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) opts.port = DEFAULT_PORT;
  return opts;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function log(...args) { process.stdout.write(`[${stamp()}] ${args.join(' ')}\n`); }
function errLog(...args) { process.stderr.write(`[${stamp()}] ${args.join(' ')}\n`); }

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '?';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

/** 把 URL pathname 解析成 ROOT 内的绝对文件路径；越界返回 null。 */
function resolvePath(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const clean = decoded.replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(ROOT, clean);
  const rel = path.relative(ROOT, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, X-Market-File',
    'Access-Control-Allow-Private-Network': 'true',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
    ...extra,
  };
}

async function sendFile(req, res, filePath, stat) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME.get(ext) || 'application/octet-stream';
  const total = stat.size;
  const baseHeaders = corsHeaders({
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Last-Modified': stat.mtime.toUTCString(),
    'X-Market-File': path.relative(ROOT, filePath).split(path.sep).join('/'),
  });
  // 资源哈希目录可长缓存，HTML/JSON 始终回源，避免本地开发缓存干扰。
  if (/\/index\.html?$/i.test(filePath) || /\.(json|shadowcourse)$/i.test(filePath) || filePath === path.join(ROOT, 'index.html')) {
    baseHeaders['Cache-Control'] = 'no-cache, must-revalidate';
  } else {
    baseHeaders['Cache-Control'] = 'public, max-age=300';
  }

  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (m && (m[1] || m[2])) {
      let start = m[1] === '' ? null : Number(m[1]);
      let end = m[2] === '' ? null : Number(m[2]);
      if (start === null) { start = Math.max(0, total - (end || 0)); end = total - 1; }
      else if (end === null || end >= total) { end = total - 1; }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
        res.writeHead(416, corsHeaders({ 'Content-Range': `bytes */${total}` }));
        res.end();
        return { status: 416, bytes: 0 };
      }
      const len = end - start + 1;
      res.writeHead(206, { ...baseHeaders, 'Content-Length': String(len), 'Content-Range': `bytes ${start}-${end}/${total}` });
      if (req.method === 'HEAD') { res.end(); return { status: 206, bytes: 0 }; }
      await pipeFile(filePath, res, { start, end });
      return { status: 206, bytes: len };
    }
  }

  res.writeHead(200, { ...baseHeaders, 'Content-Length': String(total) });
  if (req.method === 'HEAD') { res.end(); return { status: 200, bytes: 0 }; }
  await pipeFile(filePath, res);
  return { status: 200, bytes: total };
}

function pipeFile(filePath, res, opts) {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, opts);
    stream.on('error', () => { try { res.destroy(); } catch { /* ignore */ } resolve(); });
    stream.on('end', resolve);
    stream.pipe(res);
  });
}

function sendText(req, res, status, body, headers = {}) {
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(status, corsHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': String(buf.length), ...headers }));
  if (req.method === 'HEAD') res.end();
  else res.end(buf);
  return { status, bytes: buf.length };
}

const NOT_FOUND_HELP = `SHADOW 市场 · 本地静态服务

404 没有这个文件。可能原因：
  · 路径写错（市场是 hash 路由：请访问 http://<host>:<port>/#/ 而不是 /resource/xxx）
  · market/data/ 还没生成（catalog 与示例课程包由打包器产出）

可用入口：
  /                    市场首页
  /index.html          同上
  /data/catalog.json   资源目录（若已生成）
  /plugins/index.json  资源类型插件登记表
`;

const server = http.createServer(async (req, res) => {
  const t0 = process.hrtime.bigint();
  let urlPath = '/';
  try {
    const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    urlPath = u.pathname;
  } catch { urlPath = '/'; }

  let out = { status: 500, bytes: 0 };
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders({ 'Content-Length': '0' }));
      res.end();
      out = { status: 204, bytes: 0 };
    } else if (req.method !== 'GET' && req.method !== 'HEAD') {
      out = sendText(req, res, 405, '405 Method Not Allowed\n只支持 GET / HEAD / OPTIONS。\n', { Allow: 'GET, HEAD, OPTIONS' });
    } else {
      let filePath = resolvePath(urlPath);
      if (!filePath) {
        out = sendText(req, res, 403, '403 Forbidden\n路径越界。\n');
      } else {
        let st = null;
        try { st = await fsp.stat(filePath); } catch { st = null; }
        if (st && st.isDirectory()) {
          const indexPath = path.join(filePath, 'index.html');
          try { st = await fsp.stat(indexPath); filePath = indexPath; } catch { st = null; }
          if (!st) {
            // 目录列表只给一层，方便人工排查（不泄露上层目录）
            const entries = await fsp.readdir(filePath, { withFileTypes: true }).catch(() => []);
            const list = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort().join('\n');
            out = sendText(req, res, 200, `目录 ${urlPath}\n\n${list}\n`);
          }
        }
        if (st && st.isFile()) {
          out = await sendFile(req, res, filePath, st);
        } else if (st === null || (st && !st.isFile())) {
          if (urlPath === '/' || urlPath === '/index.html') {
            out = sendText(req, res, 500, '500 市场入口缺失：market/index.html 没找到。\n');
          } else {
            out = sendText(req, res, 404, NOT_FOUND_HELP);
          }
        }
      }
    }
  } catch (err) {
    errLog(`ERR ${req.method} ${urlPath} :: ${err && err.message ? err.message : String(err)}`);
    try { sendText(req, res, 500, '500 Internal Server Error\n'); } catch { /* response already sent */ }
    out = { status: 500, bytes: 0 };
  }

  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  log(`${req.method} ${urlPath} ${out.status} ${ms.toFixed(1)}ms ${fmtBytes(out.bytes)}`);
});

function listenOn(host, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => { server.removeListener('listening', onListening); reject(err); };
    const onListening = () => { server.removeListener('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write('用法: node market/serve.mjs [--port 18920] [--host 127.0.0.1]\n');
    return;
  }

  let lastErr = null;
  for (let offset = 0; offset <= MAX_PORT_OFFSET; offset += 1) {
    const port = opts.port + offset;
    try {
      await listenOn(opts.host, port);
      const actual = server.address().port;
      const catalogPath = path.join(ROOT, 'data', 'catalog.json');
      const hasCatalog = fs.existsSync(catalogPath);
      const pkgDir = path.join(ROOT, 'data', 'packages');
      let pkgCount = 0;
      try { pkgCount = fs.readdirSync(pkgDir).filter((f) => f.endsWith('.shadowcourse') || f.endsWith('.json')).length; } catch { pkgCount = 0; }

      log(`SHADOW 市场本地服务已启动: http://${opts.host === '0.0.0.0' ? '127.0.0.1' : opts.host}:${actual}/`);
      log(`静态根目录: ${ROOT}`);
      log(`CORS: * (允许 SHADOW Studio 跨域 fetch 课程包)`);
      if (hasCatalog) log(`数据: catalog.json 已就绪 · 示例课程包 ${pkgCount} 个`);
      else log(`数据: market/data/catalog.json 未生成 —— 市场会显示「数据未生成」并允许加载演示夹具（assets/dev-fixtures/）`);
      log('按 Ctrl+C 停止');
      return;
    } catch (err) {
      lastErr = err;
      if (err && err.code === 'EADDRINUSE') continue;
      if (err && err.code === 'EACCES') {
        errLog(`没有权限监听 ${opts.host}:${port}（换 --port 或提高权限）`);
        process.exitCode = 1;
        return;
      }
      errLog(`监听失败 ${opts.host}:${port} :: ${err && err.message ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }
  }
  errLog(`端口 ${opts.port}..${opts.port + MAX_PORT_OFFSET} 都被占用；请用 --port 指定其它端口。`);
  if (lastErr) errLog(String(lastErr.message || lastErr));
  process.exitCode = 1;
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log(`收到 ${sig}，关闭市场服务`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 800).unref();
  });
}

main();
