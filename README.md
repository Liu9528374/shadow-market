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

## 3. 目录结构（P0 + UI v2）

```
market/                    # 独立静态站（纯 HTML/CSS/ESM，零构建/零依赖/无 CDN/无后端）
  index.html               # 新壳：topbar + 三栏（sidebar / main / rail）+ 移动底栏 + 静态首屏
  assets/
    brand/                 # 用户 APP 图标包（favicon/PWA/logo）
    fonts/                 # InterVariable-latin.woff2（OFL，Latin subset）+ 许可
    icons/                 # Lucide 43 个 SVG（ISC，内联到 icons.js）
    js/                    # 原生 ES Modules（app/router/data/i18n/views/ui/components/importer…）
    styles/                # tokens.css + base.css + pages-dashboard.css + pages-core.css + pages-personal.css（按需加载）
  catalog/                 # 资源目录 v2（site/categories/tags/authors/licenses/resources）
  data/
    packages/*.shadowcourse          # 规范载体（BYOM，无媒体）
    import/*.shadow.json + *.srt     # 派生导入产物（SHADOW STUDIO r19 免改导入）
    plugins/builtin-whitelist.json   # 插件白名单说明（声明式，无可执行代码）
  plugins/                 # 资源类型插件清单（course/subtitle/plugin）
  sw.js / manifest.webmanifest / offline.html   # PWA
  serve.mjs                # 本地零依赖静态服务
design/                    # UI v2 设计包：DESIGN.md / DESIGN-BRIEF.md / research / skills / assets / mockups / screenshots
tools/shadowcourse/        # 包校验器（selftest 35/35）/ 打包器
tools/catalog/             # catalog 构建 + schema/SHA256 校验
tools/import/              # .shadowcourse → .shadow.json/.srt 转换 + lint
tools/qa/market/           # 独立 QA（E2E / 静态审计 / 数据契约 / Lighthouse / 证据）
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

## 6. P0 初版验收（2026-11-01，视觉已由 v2 重设计取代）

| 质量门 | 结果 |
|---|---|
| Lighthouse 移动端（初版 P0） | 首页 P99 / 详情 P98；A100；CLS 0 |
| Playwright E2E（初版） | 78/78 PASS；数据契约 40/40；静态审计 32/32+2 SKIP |
| console / pageerror | 0 / 0 |
| 内容 | 7 资源（5 课程 + 1 字幕包 + 1 插件说明）、6 包、18 导入产物 |

证据：`release/evidence-market/`（历史报告与截图仍保留）。

## 7. UI v2 重设计（Obsidian & Amber，2026-11-01 实施）

- **方向**：进站 = **个人工作台**（问候 + 匿名资料 + 数据 tile + 继续上次 + 为你推荐 + 最近动态）；市场移到 `#/market`；所有桌面页统一 **248 / 744 / 320** 三栏，**右栏第一卡 = 「进入市场」**（唯一渐变面）。
- **视觉**：暖黑 `#0A0A0C` + 琥珀 `#FFB55C`（默认深色），暖纸浅色；7 档字阶；无边框卡片 + 单一阴影；琥珀强调色纪律；移动底栏 5 项。
- **设计研究/素材（GitHub 下载，许可见 design/assets/INVENTORY.md）**：5 站布局实测（GitHub / Linear / Vercel / Stripe / Raycast）+ 设计 skill（anthropics/skills、hallmark 等）+ Lucide 图标（ISC）+ Inter 字体（OFL-1.1）。
- **设计包**：`design/DESIGN.md`（规范）、`design/screenshots/`（16 张设计稿）、`design/mockups/`（8 页高保真）、`design/research/`（5 站实测 + 现站诊断）。
- **实施**：`market/index.html` 新壳 + `app.js/router.js` 新路由 + `views/{home,market,resource,ui}.js` 重写 + 12 个二级视图重排；PWA 缓存版本升级、`pages-personal.css` 按需加载、Inter 字体子集化（352KB→99KB）、favicon/LOGO 精简。
- **验收（移动端 Lighthouse，模拟）**：首页 **P93 / A100 / BP100 / SEO100**（LCP 2.7s / CLS 0.055）；市场 **P94 / A100**；详情 **P93 / A100**；E2E **78/78**；数据契约 **40/40**；静态审计 **32/32（+2 SKIP）**；0 console error / 0 pageerror。
- **已知限制**：详情页/市场首屏仍有客户端渲染延迟（P1 可预渲染）；全量 i18n 长文与积分正文属 P1；`.shadowcourse` 导入器移植（C）需用户批准桌面红线变更。
