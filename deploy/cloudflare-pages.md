# Cloudflare Pages 部署说明（SHADOW 市场 P0）

> 契约：`D:\FOLLOWSPEAK\docs\111-market-architecture.md` §2.4（hash 路由决策）、§6.4（部署拓扑）、§8.4（供应链）。
> 本文件是**部署操作文档**；`_headers` / `_redirects` 模板见同目录 [`cloudflare/`](cloudflare/)。

## 1. 为什么用 Cloudflare Pages（P0 主演示）

- 免费、自动 HTTPS、全球 CDN、PR 预览、回滚；不要求仓库公开。
- 静态站纯自托管资源（无第三方 CDN/字体/分析），`market/` 目录即站点根。
- **hash 路由（`#/…`）→ 不需要 SPA fallback / 404 rewrite**（刷新任意 `#/resource/<id>` 都由 `index.html` 自行解析 hash）。
- 境内访问速度可能不稳；正式国内站需 ICP 备案后再迁 OSS/COS+CDN。

## 2. 两种部署方式

### 2.1 Dashboard（Git 集成，推荐）

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git；
2. 选择 `SHADOW-MARKET` 仓库，Production branch = `main`；
3. **Build command 留空**；**Build output directory = `market`**（Frame 预设 None）；
4. Save and Deploy。后续 `main` 推送自动发布，PR 有预览 URL。
5. 自定义域名：Pages → Custom domains → 添加（`.app` 域名强制 HTTPS；`shadowmarket.app` 为首选候选，注册可用性需在注册商核对）。

### 2.2 CLI（wrangler，一次性/CI 发布）

```powershell
# 发布 market/ 目录为站点根（无需构建）
npx wrangler pages deploy market --project-name shadow-market --branch main
```

- CI 中可用 `CLOUDFLARE_API_TOKEN`（Pages:Edit 权限）+ `CLOUDFLARE_ACCOUNT_ID`；
- 每次部署输出 `https://<hash>.shadow-market.pages.dev` 与生产别名；Deployments 页可回滚到任一历史版本。

## 3. `_headers`（缓存/安全/CORS）

Cloudflare Pages 从**发布根**读取 `_headers`；模板：[`cloudflare/_headers`](cloudflare/_headers)。
部署前复制到发布根（即 `market/_headers`；由发布/前端负责人加入，本仓库不直接改 `market/`）：

```text
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  ...
```

要点：

| 路径 | 头 | 理由 |
|---|---|---|
| `/assets/*` | `Cache-Control: public, max-age=31536000, immutable` | 静态资源长缓存；发版通过 SW 版本化 cache + 页面刷新 |
| `/catalog/*.json` | `Cache-Control: public, max-age=60` | 数据更新需较快生效（docs/111 §6.4 短缓存） |
| `/sw.js` | `Cache-Control: no-cache` | Service Worker 更新探测（不缓存） |
| `/data/packages/*.shadowcourse` | `Access-Control-Allow-Origin: *` + `application/json` | 纯数据包允许跨域读取（未来工具 `?import=`）；**不涉及用户数据**；含 BYOM 课程包，不托管媒体 |
| `/*` | CSP / nosniff / Permissions-Policy | 无第三方脚本；关闭麦克风/摄像头/定位；CSP 保留内联主题脚本（`script-src 'self' 'unsafe-inline'`），后续可改 sha256 白名单 |

> CSP 注意：`connect-src` 需允许 `http://127.0.0.1:*`，否则「一键导入」探测本地 SHADOW Studio 的 fetch 会被 CSP 拦截（https 页面探测本机 http 属混合内容，P0 只降级为下载，页面已文档化）。

## 4. `_redirects`（hash 路由无需 SPA fallback）

模板：[`cloudflare/_redirects`](cloudflare/_redirects)。

- **P0（hash 路由）**：不需要任何 rewrite。Cloudflare Pages 对 `/` 自动返回 `/index.html`，`/#/resource/<id>` 的 hash 部分不发送给服务器，天然可用。
- 仅保留一个可选根路径 200 规则与注释即可；**不要**加 `/* /index.html 200`——那会在 P1 迁 history 路由前掩盖 404，且影响静态资源缺失的真实报错。
- 未来 P1 若迁 history 路由（docs/111 §2.4 决策表），再启用：

```text
# P1 迁移 history 路由后启用（P0 不启用）：
# /*  /index.html  200
```

## 5. 目录与部署边界

- 发布根 = `market/`（含 `index.html`、`assets/`、`catalog/`、`data/packages/`、`data/import/`、`plugins/`、`sw.js`、`manifest.webmanifest`、`offline.html`）。
- **不要**发布仓库其它目录（`tools/`、`deploy/`、`release/`、`docs/`）。
- `data/packages/*.shadowcourse` 为纯数据 JSON（BYOM，不含媒体）；构建期已计算 `sha256/sizeBytes` 写入 catalog，发布后可用 `tools/qa/market/data-contract-check.mjs` 复核。
- 证据归档：`release/evidence-market/`（报告/截图/SHA256 清单），不要提交大录屏。

## 6. 发布前校验（质量门，失败不发布）

```powershell
D:\NODE\node.exe tools\shadowcourse\validate.mjs --dir market/data/packages
D:\NODE\node.exe tools\catalog\validate-catalog.mjs
D:\NODE\node.exe tools\qa\market\data-contract-check.mjs
D:\NODE\node.exe tools\qa\market\static-audit.mjs
```

任一失败不要点 Deploy；Cloudflare Git 集成场景建议在仓库加 CI 后再由 CI 触发发布（或使用 GitHub Actions + wrangler）。

## 7. 回滚

Dashboard → Workers & Pages → `shadow-market` → Deployments → 目标历史部署 → Rollback。
注意：catalog 与 `.shadowcourse` 包必须**成对回滚**（否则 sha256/sizeBytes 不一致，用户下载校验失败）。
