# tools/qa/market · SHADOW 市场 P0 QA 套件（Phase 2）

> 契约真相：`D:\FOLLOWSPEAK\docs\111-market-architecture.md` §9 质量门。
> 本目录只做**独立验证**（不改站点代码）；发现站点 bug 只报告给 Lead，不直接修 `market/`。

## 环境

- Node：`D:\NODE\node.exe`（v24）
- Playwright：`D:\SHADOW-MARKET\tools\qa\node_modules`（junction → `D:\FOLLOWSPEAK\tools\qa\node_modules`，playwright-core 1.64）
- 浏览器：Edge `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`（headless）
- 浏览器套件**串行**；服务用独立端口（189xx/190xx）；**绝不触碰/杀用户 18765/8765/18920 进程**

## 快速运行（串行，推荐）

```powershell
# 一条命令：起 189xx 服务 → data-contract → static-audit → market-e2e → lighthouse → 证据归档
powershell -ExecutionPolicy Bypass -File .\tools\qa\market\run-phase2.ps1 -Port 18921
# 性能收口后的最终重跑（Lead 指定 18922，避免与上一轮/他人端口冲突）
powershell -ExecutionPolicy Bypass -File .\tools\qa\market\run-phase2.ps1 -Port 18922
```

质量门（docs/111 §9，`collect-evidence.mjs` 会自动写入 `phase2-summary.md` 的「质量门核对」表）：
Lighthouse 移动端 Performance ≥90、Accessibility ≥90；E2E 全 PASS；0 console.error / 0 pageerror；数据契约/静态审计全 PASS。

产物：
- 报告：`tools/qa/market/report-{market,data-contract,static-audit}.json`
- 截图：`tools/qa/market/shots/*.png`（本轮新增：home/detail/mobile/PWA 离线/导入/合约页等）
- 证据：`release/evidence-market/`（`collect-evidence.mjs` 生成 `phase2-summary.md`、`workspace-git.txt`、`workspace-sha256.txt`、`SHA256SUMS.txt`、`lighthouse/README.md`）

## 单独运行

```powershell
# 数据契约（纯文件；catalog v2 未就绪时 exit=2 并 FATAL，不伪造 PASS）
D:\NODE\node.exe tools\qa\market\data-contract-check.mjs [--market=market] [--report=rel.json]

# 静态审计（品牌/PWA/离线页/无上传/无可执行插件/合规页/无 CDN/部署配置/无障碍基础）
D:\NODE\node.exe tools\qa\market\static-audit.mjs [--report=rel.json]

# E2E（自己起独立端口；也可 --base-url 复用已有服务；--headed 可观察）
D:\NODE\node.exe tools\qa\market\market-e2e.mjs
D:\NODE\node.exe tools\qa\market\market-e2e.mjs --base-url=http://127.0.0.1:18920
D:\NODE\node.exe tools\qa\market\market-e2e.mjs --headed --report=... --shots=...

# Lighthouse（移动端；**优先本机 .tmp/lh 预装 12.6.1** → 本地安装 → npx --no-install → npx --yes；不可用如实写 UNAVAILABLE）
powershell -ExecutionPolicy Bypass -File .\tools\qa\market\lighthouse-run.ps1 -Url http://127.0.0.1:18922/
# 固定本机工具（Lead/CI 可显式指定；run-phase2.ps1 检测到 .tmp/lh 会自动传）
powershell -ExecutionPolicy Bypass -File .\tools\qa\market\lighthouse-run.ps1 -Url http://127.0.0.1:18922/ -LighthouseCli .tmp/lh/node_modules/lighthouse/cli/index.js
# 首页 + 详情页各一次（run-phase2.ps1 会自动从 catalog 取首个课程详情 URL 传入 -Url2）
powershell -ExecutionPolicy Bypass -File .\tools\qa\market\lighthouse-run.ps1 -Url http://127.0.0.1:18922/ -Url2 "http://127.0.0.1:18922/#/resource/com.shadow.course.cafe-order"
# 只测工具探测（不起站点、不写状态）：-CheckOnly
# 产物：release/evidence-market/lighthouse/market-mobile-1.report.json|.html（首页）、market-mobile-2.*（详情页）、lighthouse-status.json（含 runs[]）

# 证据归档（报告/截图/SHA256 清单 → release/evidence-market）
D:\NODE\node.exe tools\qa\market\collect-evidence.mjs
```

## E2E 覆盖（Phase 2 对齐 docs/111 §9）

| 分组 | 内容 |
|---|---|
| M0 | catalog v2 六文件 HTTP/JSON/schemaVersion、资源 ≥7、包 200 + sha256/size 与 catalog 一致、插件声明、三导入产物 |
| M1 | 首页卡片/品牌 logo 图片/主导航/语言开关/中英搜索/分类/标签/作者真实数据/i18n 切换 |
| M2 | 详情 hash 直达+刷新、README 安全渲染、句子数、文件、版本+changelog、About、许可证页、收藏流程 |
| M3 | 下载弹层三产物（`.shadow.json`/`.srt`/`.shadowcourse`）+ 页面 download 事件 |
| M4 | 一键导入：无服务降级（3 步+自动下载）；成功路径用**假 Studio** 验证 `?import=` 深链（修复 M3.8：不提前 close popup、等页面成功态） |
| M5 | favorites/changelog/contribute/about/privacy/complaint/license/tag/404/points |
| M6 | 设置/深浅色/Ctrl+K |
| M7 | 1440/1024/768/390/375/360 无横溢；390 底部导航可用 + 触控 ≥24px；详情操作条吸底 |
| M8 | PWA manifest/SW/offline.html/图标；首访后 `context.setOffline(true)` 重载仍见 shell/catalog 或离线提示 |
| M9 | 0 console.error / 0 pageerror / 无失败请求 / 无第三方 CDN |

## 说明

- **不伪造通过**：`report.pass=false` 且退出码非 0；FATAL/数据未就绪 exit=2。
- 探测噪声白名单（`common.mjs isShadowProbeNoise`）只覆盖「探测本地 18765–18775 未监听端口」的预期网络错误；离线阶段使用 `isOfflineNoise` 单独过滤，并在报告中分别记录。
- 成功导入测试只在监听 `190xx` 段临时起假 Studio；测试路由会拦截 18765–18775 请求并计数，断言 `blocked=0`。
- 截图默认写 `shots/`；子目录（`shots/final-r8` 等）为历史批次证据，不会被覆盖。
