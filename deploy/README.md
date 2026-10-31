# SHADOW 市场 · 部署说明（Phase 2 P0）

> 契约：`D:\FOLLOWSPEAK\docs\111-market-architecture.md` §2.4（hash 路由决策）、§6.3（PWA）、§6.4（部署拓扑）、§8.4（供应链/完整性）、§9（部署质量门）。
> 本目录只放**部署配置与脚本**，不修改 `market/` 任何站点代码。

## 0. 结论（P0 默认拓扑）

| 环境 | 方案 | 说明 |
|---|---|---|
| 本地开发 / QA | `node market/serve.mjs --port 18920`（或 189xx 空闲端口） | 零依赖只读静态服务；QA 脚本自起独立端口，不碰用户进程 |
| P0 演示（主） | **Cloudflare Pages** | 免费、自动 HTTPS、可绑自定义域名；`_headers`/`_redirects` 见 [`cloudflare-pages.md`](cloudflare-pages.md) |
| P0 演示（备） | **GitHub Pages** | 本目录脚本 + `.github/workflows/pages.yml`；注意 GitHub 免费主机条款，长期正式运营前评估 |
| 国内正式（后置） | 阿里云 OSS + CDN / 腾讯云 COS + CDN | 需 ICP 备案（域名实名、备案服务码、公安备案、页脚备案号），完成前不迁 |

**URL 策略：P0 使用 hash 路由（`#/…`）** —— 静态托管零配置、刷新/深链/离线都稳定，**不需要** `404.html`、`_redirects` SPA fallback 或任何服务端 rewrite。
（若 P1 迁移 history 路由，再在 Cloudflare 加 `/* /index.html 200`、在 GitHub Pages 加 `404.html` 兜底。）

## 1. 发布前校验（硬门，失败不发布）

在本仓库根目录、用 `D:\NODE\node.exe`（CI 用 runner 的 node 20）：

```powershell
# 0) 包规范 + 校验器自检（PASS 5 / FAIL 0 起步）
D:\NODE\node.exe tools\shadowcourse\validate.mjs --dir market/data/packages

# 1) catalog v2 构建期校验（schema/引用完整性/sha256+size 与真实文件一致）
D:\NODE\node.exe tools\catalog\validate-catalog.mjs

# 2) QA 独立数据契约（交叉验证，不依赖构建侧实现）
D:\NODE\node.exe tools\qa\market\data-contract-check.mjs

# 3) 静态审计（品牌/PWA/离线页/无上传/无可执行插件/合规页/无 CDN/部署配置）
D:\NODE\node.exe tools\qa\market\static-audit.mjs

# 4) （可选，较慢）浏览器 E2E 全量：catalog v2 + 三下载 + 导入 + 移动 + PWA 离线
D:\NODE\node.exe tools\qa\market\market-e2e.mjs
```

`deploy/deploy-gh-pages.ps1` 默认会执行 1)–3)（`-SkipValidate` 可跳过，不推荐）。

## 2. GitHub Pages（Actions，推荐）

一次性设置：仓库 **Settings → Pages → Source = GitHub Actions**。

- 工作流：[`../.github/workflows/pages.yml`](../.github/workflows/pages.yml)
  - `push main`（`market/**`、`tools/**`、`deploy/**` 变更）或 `workflow_dispatch` 触发；
  - 先跑：JS 语法检查 → 包校验 → catalog v2 校验 → 数据契约 → 静态审计；**任一失败即不发布**；
  - 通过后 `actions/upload-pages-artifact@v3` 上传 `market/` 目录为站点根（hash 路由无需 404.html），`actions/deploy-pages@v4` 发布；
  - QA JSON 作为 `qa-reports` artifact 保留 7 天。
- 首次部署后用无痕窗口验证：`https://<owner>.github.io/<repo>/`（项目站点是子路径，站内全部使用相对路径，满足子路径部署）。

### 2.1 备用：手动 gh-pages 脚本

```powershell
# 前置：main 上站点代码已提交；脚本默认发布工作区当前 market/ 内容
D:\NODE\node.exe --version   # 需要 Node（脚本自带校验时用）

# 演练：只校验 + 打印发布清单，不改任何 git / 不联网
powershell -ExecutionPolicy Bypass -File .\deploy\deploy-gh-pages.ps1 -DryRun

# 正式发布到 origin 的 gh-pages 分支（临时克隆方式：不改工作区、不建本地分支）
powershell -ExecutionPolicy Bypass -File .\deploy\deploy-gh-pages.ps1 -Remote origin -Branch gh-pages

# 绑定自定义域名（可选）：写入 CNAME 文件（域名需在 DNS 配置 CNAME 记录）
powershell -ExecutionPolicy Bypass -File .\deploy\deploy-gh-pages.ps1 -Cname shadowmarket.example

# 发布前有未提交改动且希望中止：加 -RequireClean
```

脚本行为：`git init` 一个临时目录 → 复制 `market/` 内容（含 `.nojekyll`，杜绝 Jekyll 处理）→ 单提交 → `git push --force <remote-url> HEAD:gh-pages` → 清理临时目录。
**不写工作区 git（不建分支、不动 index/HEAD）**；`gh-pages` 是生成分支，会被整体替换。

## 3. Cloudflare Pages（主演示）

见 [`cloudflare-pages.md`](cloudflare-pages.md)。要点：

- Dashboard：Build command 留空，**Build output directory = `market`**；
- CLI：`npx wrangler pages deploy market --project-name shadow-market`；
- `_headers`/`_redirects` 模板在 [`cloudflare/`](cloudflare/)：复制到发布根（`market/`）后生效（P0 因 hash 路由**不需要** SPA fallback）；
- 缓存策略：`assets/**` 长缓存、`catalog/*.json` 60s、`sw.js` 不缓存、`.shadowcourse` 允许跨域（未来工具 `?import=` 读取）。

## 4. 缓存与安全头（两端一致口径）

- `assets/**`（JS/CSS/图片）：`Cache-Control: public, max-age=31536000, immutable`（P0 无指纹，发版靠 SW 版本化 cache 与文件名不变策略；若后续加 ?v= 再细分）；
- `catalog/*.json`：`public, max-age=60`；
- `sw.js`：`no-cache`（保证更新探测）；
- `data/packages/*.shadowcourse`：`Access-Control-Allow-Origin: *`（纯数据包，工具/第三方阅读器可读取；不涉及用户数据）；
- 安全头：`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy` 关闭麦克风/摄像头/定位、CSP 自托管（模板见 `cloudflare/_headers`；CSP 需保留内联主题脚本，故 `script-src 'self' 'unsafe-inline'`，后续可改为 sha256 白名单）。

## 5. 回滚

- GitHub Pages：Actions → 选择历史成功 run → Re-run deployment（artifact 与提交绑定）；或 `git revert` 数据/站点提交后重跑。
- gh-pages 分支方式：重新用上一个提交的 `market/` 内容执行 `deploy-gh-pages.ps1`。
- Cloudflare Pages：Dashboard → Deployments → 选择历史部署 → Rollback。
- 数据回滚风险：`.shadowcourse` 包与 catalog 的 `sha256/sizeBytes` 必须同步回滚，**不要**只回滚 catalog（否则 `data-contract-check` 失败、用户下载校验不一致）。

## 6. 证据与验收（发布后必做）

```powershell
# 通过 QA 后一键归档证据（报告/截图/SHA256 清单）
D:\NODE\node.exe tools\qa\market\collect-evidence.mjs

# 尝试 Lighthouse（移动端；网络/二进制不可用会如实写 UNAVAILABLE，不伪造分数）
powershell -ExecutionPolicy Bypass -File .\tools\qa\market\lighthouse-run.ps1 -Url http://127.0.0.1:18921/
```

证据目录：`release/evidence-market/`（报告 JSON、精选截图、`SHA256SUMS.txt`、`lighthouse/`；**不提交大录屏/视频**）。
部署质量门（docs/111 §9）：CF/GH 演示 URL 可访问 + 部署脚本/说明可复现 + 截图/报告入证据目录。
