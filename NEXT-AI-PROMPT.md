# 给下一任 AI 的提示词（SHADOW 市场 · 从 P1 开始）

> 用法：把下面整段（从「你是……」到结尾）复制给下一个 AI；它应能独立接续，不需要本对话上下文。
> 完整交付说明在 `D:\FOLLOWSPEAK\docs\114-market-v2-delivery-handoff.md`，开工前必须先读。

---

你是「SHADOW 市场」项目的下一任工程 AI。请先读完 `D:\FOLLOWSPEAK\docs\114-market-v2-delivery-handoff.md`（交付说明）和 `D:\SHADOW-MARKET\README.md`、`CHANGELOG.md`、`D:\FOLLOWSPEAK\docs/113-market-ui-redesign.md`，再开始工作。

## 一、项目现状（已交付，不要重做）

- 产品：SHADOW 市场，全免费影子跟读课程资源站（课程包 / 字幕包 / 插件说明；BYOM 不托管媒体；无强制登录；无支付/DRM）。独立 Web 产品，与 SHADOW STUDIO（r19 桌面工具）只通过 `.shadowcourse/.shadow.json/.srt` 相遇。
- 线上：https://liu9528374.github.io/shadow-market/ （GitHub Pages，gh-pages 分支）；仓库 https://github.com/Liu9528374/shadow-market。
- 已完成：P0 功能 + **UI v2「Obsidian & Amber」重设计已上线**。设计资料在 `D:\SHADOW-MARKET\design\`，代码在 `D:\SHADOW-MARKET\market\`。
- 质量基线（必须保持）：Lighthouse 移动端首页 P94 / 详情 P95（A100，CLS 0）；E2E 78/78；数据契约 40/40；静态审计 32/32+2 SKIP；0 console error / 0 pageerror。
- P1（账号+积分+我的资源+审核）**尚未开始**，这是你的任务。

## 二、硬红线（任何情况下不得违反）

1. 全免费：不做支付/分账/抽成/退款/DRM；积分免费获取，不可购买/转让/提现。
2. BYOM：不托管影视媒体、不允许用户上传媒体、不提供站内视频播放；资源包 0 媒体。
3. 版权：只允许自有/授权/公版/CC；每资源必须有 license + rights.basis；保留投诉-下架。
4. 无强制登录；P0 无后端无埋点；P1 账号必须可选——未登录仍能完整浏览/下载。
5. 「一切即插件」只是声明式资源类型清单，不加载执行第三方插件代码。
6. 不改 SHADOW STUDIO（r19）桌面产物/红线；市场独立仓库。
7. 站内无第三方 CDN / 无外网请求（字体/图标自托管）。
8. 不伪造数据/截图/QA 分数；所有验证必须真跑；失败如实报告。

## 三、工作区与环境

- 代码/产品：`D:\SHADOW-MARKET`（`main` 源码；`market/` 通过 `git subtree push --prefix market origin gh-pages` 发布）。
- 文档源真相：`D:\FOLLOWSPEAK\docs`（中文）。
- 本地预览：`cd D:\SHADOW-MARKET; node market/serve.mjs --port 18920` → http://127.0.0.1:18920/
- Node：`D:\NODE\node.exe`；浏览器：Edge `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`。
- 外网需要代理 `http://127.0.0.1:7897`；本地站不用代理。
- QA：`$env:NODE_PATH='D:\SHADOW-MARKET\tools\qa\node_modules'`；`node tools/qa/market/data-contract-check.mjs`、`static-audit.mjs`、`market-e2e.mjs --base-url=...`；全套 `powershell -ExecutionPolicy Bypass -File tools/qa/market/run-phase2.ps1 -Port 18921`；Lighthouse CLI 在 `D:\SHADOW-MARKET\.tmp\lh\node_modules\lighthouse\cli\index.js`（临时目录，新环境需重装，设置 `CHROME_PATH`）。
- 部署：改完 `git push origin main`，再 `git subtree push --prefix market origin gh-pages`；等 1–2 分钟 Pages 构建，用代理打开线上验证。旧访客 SW 由 `index.html` 内联迁移脚本自动处理（`shadow.market.shell.v1` 版本门，见 `app.js`/`sw.js`）。
- ⚠️ **GitHub Pages 部署目前有问题（接手先修）**：仓库同时存在 Actions workflow（`main` 推送触发，Deploy job 一直失败）和 gh-pages 分支构建（实际生效）；2026-11-01 09:23 UTC 起分支构建的 deploy job 也失败，线上仍是旧构建（`419bbc4`），`gh-pages` 已到 `fc1ba29`。先查 Settings → Pages / 部署环境，二选一部署机制（建议只保留分支部署），重试并验证；`main` 与 `gh-pages` 的 `market/` 必须一致。详见 docs/114 §7。另外 Pages CDN 更新有 1–2 分钟延迟，验证时用 `?cb=时间戳` 或等待重试。

## 四、下一步任务：P1（账号 + 积分 + 我的资源 + 审核）

目标（来自既有战略文档 docs/49/52/53/110/111/112，需先读）：
1. 可选账号：邮箱验证码登录（无密码/无社交登录）；未登录可浏览/下载，本地数据继续可用；登录后可选合并/覆盖本地收藏/积分。
2. 积分：免费获取（签到/打卡/首次导入/投稿通过）、流水、兑换免费资源/权益；不可购买/转让/提现；防刷（频率/设备/验证码/风控阈值）。
3. 我的资源：云端收藏/已下载/最近导入，多设备同步。
4. 投稿/审核：投稿表单（元数据+权利依据+包校验）、最小人工审核后台（列表/通过/驳回/下架/投诉处理）。
5. 合规与安全：隐私政策更新、数据保留期、注销/删除、限流/防 CSRF/CSP、邮件发送合规。

### 开工前必须先做（不要直接写代码）
1. 读 P1 相关旧文档与现有代码，输出 **P1 技术方案对比 + 推荐**：后端选型（Cloudflare Workers+D1/KV、Supabase、Vercel+Postgres、阿里云/腾讯云等）对比「成本/国内访问/运维/数据合规/免费额度」；邮件服务选型；域名/备案建议；数据库 schema 与接口契约草案；安全与防刷设计；前端改动面；里程碑与验收标准。
2. **给用户拍板**：后端方案、邮件服务、域名/备案、审核后台范围、账号注销/导出要求、预算上限。用户没拍板前不要启动付费资源/备案/正式后端。
3. 用户批准后，再按「schema/契约 → 后端最小实现（auth/points/submissions）→ 前端登录/积分/我的资源/投稿表单 → 防刷安全 → 审核后台 → E2E/Lighthouse/安全回归 → 部署+文档」推进；每个阶段中文汇报「改了什么/关键数字/要拍板什么/风险」。

### P1 验收标准（建议）
- 未登录：现有 P0/v2 全部功能不回归（E2E 78/78、Lighthouse ≥90、PWA 离线、0 console error）。
- 登录：邮箱验证码可收/可验、会话安全（HttpOnly/SameSite、限流、验证码过期/重放防护）、注销与数据删除可用。
- 积分：仅免费获取、流水可核对、不可购买/转让/提现；刷分防护有阈值与日志；未登录积分仍本地演示。
- 我的资源：多设备一致；与本地数据合并策略有明确 UI 与回滚。
- 投稿/审核：真实包校验、权利依据必填、后台可操作、下架/投诉链路可走。
- 安全：无明文邮箱日志/无密钥进前端、接口限流/CSRF、CSP 不破坏 PWA；隐私政策覆盖新增数据。
- 文档/提交中文、证据更新到 `release/evidence-market/`。

## 五、工作方式（用户偏好）

- 中文沟通、中文文档/提交；先计划后动手；成本/后端/备案/账号范围先问。
- 设计不要重做：延续 `design/` 的 tokens/base 组件与三栏壳；新页面先复用现有组件。
- 不要改 SHADOW STUDIO r19；不要引入第三方 CDN、支付/DRM、强制登录、用户媒体上传。
- 每次交付给：①改了什么/怎么用 ②关键数字 ③路径 ④用户要拍板什么 ⑤风险/待办。
- 重要结论写进 `D:\FOLLOWSPEAK\docs`（编号文档）并在 README/CHANGELOG 留记录。
- 完成 P1 前先保持 P0/v2 质量门全绿；改产品代码前先确认用户已批准方案。

现在开始：先读文档与代码，给出 P1 技术方案对比和需要用户拍板的清单（不要先写代码）。
