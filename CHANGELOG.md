# SHADOW 市场 · CHANGELOG

## 0.3.0 · 2026-11-01（UI v2 重设计「Obsidian & Amber」实施）

### 新增 / 变更
- **个人工作台优先**：进站默认 `#/` = 个人工作台（问候 + 匿名资料 + 数据 tile + 继续上次 + 为你推荐 + 最近动态）；市场独立 `#/market`；新增 `#/search`、`#/category`、`#/tag` 复用市场视图。
- **三栏新壳**：topbar + 248 左栏（工作台/市场/收藏/我的资源/积分/投稿/设置）+ 744 主列 + 320 右栏（「进入市场」/热门标签/合规）；移动端 5 项底栏（工作台/市场/收藏/积分/更多）+「更多」菜单。
- **设计系统 v2**：暖黑 `#0A0A0C` + 琥珀 `#FFB55C`（默认深色）/ 暖纸浅色；7 档字阶；无边框卡片 + 单一阴影；强调色纪律；密度预算（渲染色 ≤14、字阶 ≤7、右栏块 ≤3、主 CTA 1）。
- **8 页高保真设计稿**（design/）：个人工作台、市场、详情、我的资源/收藏、积分、投稿、移动工作台/市场；16 张截图；5 站布局研究（GitHub/Linear/Vercel/Stripe/Raycast）；GitHub 设计 skill + Lucide 图标（ISC）+ Inter 字体（OFL-1.1）。
- **页面重排**：工作台/市场/详情重写；我的资源·收藏（Tabs 收藏/已下载/最近导入）、积分中心（签到/打卡/首次导入 + 流水）、投稿指南（编辑式 sticky 目录）、关于/隐私/投诉/更新日志/导入/设置/许可/作者/404 全部改用 tokens/base 组件。
- **性能收口**：Inter 字体子集化（352KB → 99KB）、`pages-personal.css` 按需加载、favicon/LOGO 精简、`app.css` 移除、SW 缓存版本升级；移动端 Lighthouse 首页 P93 / 市场 P94 / 详情 P93（A100）。
- **测试适配**：E2E 78/78、数据契约 40/40、静态审计 32/32+2 SKIP 全过；新增 76 项产品自测（13 桌面路由 + 5 移动 + 功能交互）。

### 修复
- 语言切换后侧栏（静态快照克隆）不重译的问题（`restoreSidebar/setSidebar` 重建后重新 `applyStaticI18n`）。
- 顶栏搜索回车统一到 `#/search?q=`（此前 `#/market?q=` 不过滤）。
- 投稿指南占位地址改为真实投稿入口（GitHub Issues / 邮件）。
- 主题/语言按钮、更多菜单、收藏计数、详情 Tabs 键盘、PWA 离线回归。

## 0.2.0 · 2026-11-01（Phase 2 P0：免费资源站 + 一键导入，可演示）

### 新增
- **IA 页面（18 条 hash 路由）**：探索（推荐 + 最新 + 分类/标签）、分类、标签、搜索（中英别名）、资源详情（Tabs：README / 句子预览 / 文件 / 版本与变更；About 侧栏；许可页）、作者页、我的收藏（本地）、更新日志、投稿指南、关于、隐私、版权与投诉、导入说明、设置（外观/语言/数据）、404。
- **品牌视觉**：接入用户提供的「声波 · Voice Wave」正式 App 图标包（`market/assets/brand/`）；品牌橙 `#E88A2E`（深色底 `#0C0C0E`）、深浅双主题；favicon / apple-touch-icon / PWA 图标 / header logo（优化小图 4.6KB）。
- **PWA**：`manifest.webmanifest` + 手写 `sw.js`（关键外壳预缓存 + 首屏后后台预取、离线导航回退 `offline.html`、更新提示、安装入口）；断网可浏览已缓存应用。
- **中英双语**：i18n 词典（中文核心 5.9KB + 英文按需 73KB）、`t()`、localStorage 持久化、`html lang` 切换、静态页 data-i18n；EN 静态合规页全译。
- **移动优先**：≤820px 底部导航（探索/收藏/投稿/更多）、header 精简、详情操作条吸底、Tabs 横滑提示、触摸目标 ≥24px；375–1440 无页面级横向溢出。
- **无障碍**：Tabs 键盘导航 + roving tabindex、开关 aria-labelledby、命令面板 aria-activedescendant、英文 `lang="en"`、列表语义、对比度 ≥4.5、reduced-motion、焦点环统一；Lighthouse Accessibility 100。
- **数据层 catalog v2**：`market/catalog/{site,categories,tags,authors,licenses,resources}.json`，7 资源 = 5 课程 + 1 字幕包 + 1 插件白名单说明；构建期计算 `sha256/sizeBytes`、版本与 changelog、BYOM/许可/权利依据字段；schema + 引用完整性 + SHA256 校验。
- **导入产物**：每课程/字幕产出 `.shadowcourse`（规范）+ `.shadow.json`（SHADOW STUDIO r19 工程，唯一带翻译的免改通道）+ `.srt`（备选）+ `README-导入说明`（5 步 + 3 坑）；工具零改动即可导入。
- **插件契约（声明式）**：`market.resource-type` 清单 + `plugins/index.json` 白名单；plugin 类型为纯声明（无可执行代码、权限全 false），未知类型降级通用卡。
- **一键导入修复**：M3.8「预留窗口 + `noopener` 返回值误判」修复，成功路径不再误报拦截/多余下载；探测 18765–18775 + `?import=` 深链，未探测到自动降级下载 + 3 步说明。
- **部署**：GitHub Pages（`main` 源码 → `gh-pages` 分支发布 `market/`；`deploy/` 脚本与说明、CF Pages 备选配置、`.github/workflows/pages.yml`）。
- **QA/证据**：Playwright E2E 78 项、数据契约 40 项、静态审计 32 项、Lighthouse 移动端（首页 perf≥90 / a11y 100 / CLS 0）；证据 `release/evidence-market/`。

### 变更
- `market/serve.mjs` 增加 gzip 压缩与 `.webmanifest` MIME；`market/catalog/` 取代旧 `data/catalog.json`（旧文件保留兼容层）。
- 一键导入文档明确：媒体需重命名一致、勿点 Analyze/Generate Subtitles、媒体须与时间轴同源。

### 已知限制（P1 范围）
- 详情页 LCP 约 3.2s（README 正文需等视图+catalog+包），P1 可通过预渲染/SSR 改善。
- 全量 i18n（数据长文英文）与积分正文为 P1；积分页当前为「P1 预览」。
- `.shadowcourse` 导入器移植到 SHADOW STUDIO（C）仍推迟，需用户批准并接受桌面红线变更。

## 0.1.0 · 2026-10-31（Phase 0.5 迁移种子，未发布）

- 从 `D:\FOLLOWSPEAK` master `6056def` 迁移市场 P0 种子（来源 `4c842e3` / `6056def`）：
  - `market/` 独立静态站（GitHub 式 IA：探索/搜索/分类/作者/详情 Tabs/设置/深浅色/Ctrl+K/本地积分演示/404；零构建、零依赖、无 CDN）
  - `tools/shadowcourse/` 课程包校验器（selftest 35/35）与打包器（5 个 BYOM 示例包 PASS 5/0）
  - `tools/qa/market/` 市场独立 QA（E2E 43 项 / 静态审计 / 数据契约）
  - `docs/references/` 迁移时点的 52/53/54 文档快照
- 说明：本种子未包含上一轮未提交的桌面导入 WIP（`prototype/index.html` 等，属 SHADOW STUDIO 仓库）；P0 导入路径按 `docs/111 §5` 走 `.shadow.json` + `.srt` 免改工具方案。
