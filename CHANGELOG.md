# SHADOW 市场 · CHANGELOG

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
