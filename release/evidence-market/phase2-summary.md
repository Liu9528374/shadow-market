# SHADOW 市场 Phase 2 P0 · QA/部署证据汇总

- 生成时间：2026-11-01T08:18:18.269Z
- 被测对象：D:\SHADOW-MARKET（工作区内容，非提交）· HEAD `1fb0e92`（提交待定，快照见下）
- 备注：UI v2（Obsidian & Amber）重设计实施后全量回归：E2E 78/78 + 数据契约 40/40 + 静态审计 32/32+2 SKIP + Lighthouse 首页 P94/详情 P95（A100，CLS 0）+ 线上 GitHub Pages 实测通过
- 站点：http://127.0.0.1:18991
- 环境：Node v24.19.0 · Edge headless（Playwright）· 独立端口（189xx）
- 工作区快照：`workspace-git.txt`（HEAD / git status / git diff --stat）+ `workspace-sha256.txt`（240 个被测文件临时 SHA256，提交后可与 commit 对照）

## 结果

| 套件 | 结果 | 报告 |
|---|---|---|
| market-e2e | 78/78 PASS，0 FAIL | `report-market.json` |
| data-contract | 40/40 PASS，0 FAIL | `report-data-contract.json` |
| static-audit | 32/32 PASS，0 FAIL，2 SKIP | `report-static-audit.json` |

### E2E 按区块

| 区块 | 内容 | PASS/总数 |
|---|---|---|
| M0 | 数据/产物 HTTP 契约（catalog v2/sha256/三产物） | 8/8 |
| M1 | 首页/品牌/搜索/分类/标签/作者/i18n | 14/14 |
| M2 | 详情页/Tabs/许可/收藏 | 10/10 |
| M3 | 三下载产物/弹层/下载事件 | 3/3 |
| M4 | 一键导入（降级+成功） | 7/7 |
| M5 | 合约页面（favorites/changelog/contribute/about/privacy/complaint/license/tag/404） | 8/8 |
| M6 | 设置/主题/Ctrl+K | 4/4 |
| M7 | 响应式/移动底部导航/吸底操作条 | 11/11 |
| M8 | PWA/离线 | 8/8 |
| M9 | console/请求汇总 | 5/5 |

## 质量门核对（docs/111 §9）

| 门 | 标准 | 实测 | 结论 |
|---|---|---|---|
| Lighthouse Performance（首页） | 移动端 ≥90 | 0.94 | ✅ PASS |
| Lighthouse Accessibility（首页） | 移动端 ≥90 | 1.00 | ✅ PASS |
| E2E（Playwright / Edge headless） | 全 PASS | 78/78 PASS，0 FAIL | ✅ PASS |
| 数据契约（catalog v2 / sha256 / importFiles） | 全 PASS | 40/40 PASS，0 FAIL | ✅ PASS |
| 静态审计（品牌/PWA/合规/CDN/部署） | 全 PASS（SKIP 不计） | 32/32 PASS，0 FAIL | ✅ PASS |
| console.error / pageerror / 失败请求 | 0 / 0 / 0 | 0 / 0 / 0（另 33 条下载中断为预期） | ✅ PASS |
| 响应式（1440/1024/768/390/375/360 无页面级横溢） | M7 全 PASS | 11/11 | ✅ PASS |
| PWA 离线（首访后断网重载列表/详情） | M8 全 PASS | 8/8 | ✅ PASS |

## 关键数字（质量门）

- console.error：0（原始 0，端口探测噪声白名单）
- pageerror：0
- Lighthouse（移动端 / Edge headless / 默认 mobile preset，不传 --preset=desktop）：
  - 首页 `http://127.0.0.1:18991/#/` → P 0.94 / A 1 / BP 1 / SEO 1
  - 详情页 `http://127.0.0.1:18991/#/resource/com.shadow.course.cafe-order` → P 0.95 / A 1 / BP 1 / SEO 1
- 截图：26 张（`shots/`）
- 证据文件：57 个，SHA256 清单见 `SHA256SUMS.txt`

## 失败项（如实记录）

- E2E 无失败项

## 说明

- 本汇总由 `tools/qa/market/collect-evidence.mjs` 从真实报告生成；FAIL 不会被隐藏或改写为 PASS。
- 成功导入路径使用临时「假 SHADOW Studio」服务验证 `?import=` 深链协议；未触碰用户真实进程/端口。
- 不提交大录屏/视频；截图均为页面级 PNG。
