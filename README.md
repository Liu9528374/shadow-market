# SHADOW 市场（SHADOW MARKET）· 独立 Web 资源站

> 与 **SHADOW STUDIO**（本地跟读工具）并列的第二款产品：全免费的影子跟读资源市场（课程包 / 字幕包 / 插件白名单说明），BYOM（媒体由用户本地自备），不托管影视媒体。
> **两个产品不做在一起**：市场是 Web 资源站；工具不内嵌市场逻辑，市场不内嵌工具逻辑；二者只通过 `.shadowcourse` 资源包与派生导入产物（`.shadow.json` / `.srt`）相遇。

- 远程仓库：<https://github.com/Liu9528374/shadow-market>（public）
- **P0 演示地址**：<https://liu9528374.github.io/shadow-market/>（GitHub Pages；国内访问可能不稳定，需要时用代理；暂不购买域名）
- 决策/架构文档（源真相）：`D:\FOLLOWSPEAK\docs/49`、`docs/52`、`docs/53`、`docs/110`（Phase 0 审计与方案）、`docs/111`（架构）。
- 视觉：使用用户提供的「声波 · Voice Wave」正式 App 图标包（源：`C:\Users\A pig\OneDrive\桌面\APP\`；已归档 `market/assets/brand/`）；品牌橙 `#E88A2E`，深浅双主题。
- 许可：MPL-2.0（`LICENSE`）；官方示例资源 CC-BY-4.0（以包内 `license`/`rights` 为准）。

## 1. 快速开始（本地预览）

```bash
node market/serve.mjs
# → http://127.0.0.1:18920/（被占用时自动 +1..+20）
```

## 2. 构建 / 校验（零依赖 Node）

```bash
# 一键链（构建包 + catalog + 导入产物 + 全量校验；以 tools/catalog/build-all.mjs 为准）
node tools/catalog/build-all.mjs

# 分步
node tools/shadowcourse/build-packages.mjs                   # 课程包/字幕包 → market/data/packages
node tools/catalog/build-catalog.mjs                         # 源+包 → market/catalog/*.json（含 sha256/size）
node tools/import/build-shadow-json.mjs                      # → market/data/import/*.shadow.json + *.srt + README
node tools/shadowcourse/validate.mjs --dir market/data/packages   # 全部 PASS
node tools/catalog/validate-catalog.mjs                      # schema + 引用 + sha256/size 一致性
```

## 3. 目录结构（P0）

```
market/                    # 独立静态站（纯 HTML/CSS/ESM，零构建/零依赖/无 CDN/无后端）
  index.html
  assets/
    brand/                 # 用户 APP 图标包（favicon/PWA/logo）
    js/                    # 原生 ES Modules（app/router/data/i18n/views/components/importer/sw 注册…）
    styles/                # tokens.css（品牌橙）+ app.css
  catalog/                 # 资源目录 v2（site/categories/tags/authors/licenses/resources）
  data/
    packages/*.shadowcourse          # 规范载体（BYOM，无媒体）
    import/*.shadow.json + *.srt     # 派生导入产物（SHADOW STUDIO r19 免改导入）
    plugins/builtin-whitelist.json   # 插件白名单说明（声明式，无可执行代码）
  plugins/                 # 资源类型插件清单（course/subtitle/plugin）
  sw.js / manifest.webmanifest / offline.html   # PWA
  serve.mjs                # 本地零依赖静态服务
tools/shadowcourse/        # 包校验器（selftest 35/35）/ 打包器
tools/catalog/             # catalog 构建 + schema/SHA256 校验
tools/import/              # .shadowcourse → .shadow.json/.srt 转换 + lint
tools/qa/market/           # 独立 QA（E2E / 静态审计 / 数据契约）
deploy/                    # 部署说明与脚本（GitHub Pages gh-pages；CF Pages 备选）
docs/references/           # 迁移时点的 52/53/54 文档快照
release/evidence-market/   # 质量证据（Lighthouse/E2E/截图/SHA256 清单）
```

## 4. 边界与红线（不可违反）

- 全免费：不做支付/分账/抽成/发票/退款/DRM/复杂审核；积分免费获取、不可购买/转让/提现。
- BYOM：不托管影视媒体、不上传用户媒体、不提供站内视频播放；资源包 0 媒体/0 二进制。
- 版权：只允许自有/授权/公版/CC；每资源 `license` + `rights.basis`；保留投诉-下架。
- 无强制登录；P0 无账号后端；P1 邮箱验证码（P0 验收后启动）。
- 「一切即插件」= P0/P1 **声明式资源类型清单**，不加载执行插件代码；未知类型降级通用卡。
- 不改 SHADOW STUDIO（r19）桌面产物/桌面红线；市场是独立仓库。

## 5. 部署（P0 演示）

- GitHub Pages：`main` 是源码；`market/` 目录通过 `git subtree push --prefix market origin gh-pages` 发布到 `gh-pages` 分支，Pages 从该分支根目录构建。详见 `deploy/README.md`。
- 暂不购买域名、暂不备案；国内正式站后续再评估（ICP 备案 + 阿里云 OSS/CDN）。

## 6. P0 验收状态（2026-11-01）

| 质量门 | 结果 |
|---|---|
| Lighthouse 移动端（首页） | **Performance 99 · Accessibility 100 · BP 100 · SEO 100**；FCP 1.4s / LCP 1.7s / CLS 0 |
| Lighthouse 移动端（详情页） | **Performance 98 · Accessibility 100**；FCP 1.4s / LCP 2.4s / CLS 0 |
| Playwright E2E | **78/78 PASS**（详情/列表/搜索/下载/一键导入/收藏/合规页/移动/PWA 离线/console） |
| 数据契约 | **40/40 PASS**（catalog v2、sha256/size、versions/importFiles、plugin 声明式） |
| 静态审计 | **32/32 PASS + 2 SKIP**（品牌/PWA/无上传/无可执行插件/合规/部署/无障碍） |
| console / pageerror | **0 / 0**；0 失败请求、0 第三方外网请求 |

证据：`release/evidence-market/`（汇总/报告/截图/Lighthouse/workspace SHA256）。
**已知限制**：详情页 LCP ≈3.2s（预渲染可改善，P1）；全量 i18n 与积分正文为 P1；`.shadowcourse` 导入器移植（C）需用户批准桌面红线变更。
**P1 下一步**：邮箱验证码账号 + 积分获取/流水/兑换/我的资源 + 防刷 + 最小审核后台（用户 2026-10-31 拍板 P0 后启动）。
