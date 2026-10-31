# 52 · 极简积分市场 MVP · P0 免费资源站 + 一键导入（工作日契约 + 交付记录）

> 生成：2026-10-25 深夜（Asia/Shanghai）｜负责人：Lead（Agent Teams）
> 上游：`docs/49-market-simple-points-direction.md`（用户拍板方向）、`docs/51-next-session-prompt.md`（本轮任务）
> 状态：**契约先行**——本文件 §2–§5 是并行开发期间唯一的接口真相（single source of truth）；交付完成后 Lead 在 §10 追加结果、证据与限制。

---

## 1. 产品边界（用户 2026-10-25 深夜再次明确，不可违反）

| # | 原则 | 落地 |
|---|---|---|
| 1 | 宗旨 | **服务于全人类的软件**——开源、本地优先、不绑架用户、可离线。 |
| 2 | 两个产品 | **市场** 与 **SHADOW Studio** 是两个产品，**不做在一起**。市场先做 **Web 端**；桌面端只保留"导入课程包/深链"这一个薄接口，不在工具里塞商店 UI。 |
| 3 | 两个不做在一起 | 代码目录独立（`market/` 独立静态站 + 独立本地服务）；不随桌面包打包；桌面包删掉市场相关代码后功能完整。 |
| 4 | 设计参照 | **学习 GitHub 的网页设计逻辑**做市场 Web：顶部导航 + 搜索（`/` 聚焦）+ 资源卡（repo 卡式）+ 详情页 Tabs（README/句子预览/文件/版本）+ 侧栏 About + 设置页左侧分类导航 + `Ctrl+K` 命令面板 + 深浅色。 |
| 5 | 工具性软件底线 | **一切即插件**：市场里每种资源类型（课程/插件/字幕包/主题…）都是一个**插件清单**（`market/plugins/<type>/manifest.json`），前端启动时读取并注册渲染器；SHADOW Studio 侧继续插件化（本轮：内置插件 manifest + 设置深链）。 |
| 6 | 收费 | **P0 全免费**：积分只是兑换凭证，免费获取，不可购买/提现/转让；不做支付/分账/发票/抽成/DRM/复杂审核。 |
| 7 | 媒体 | **BYOM（Bring Your Own Media）**：市场**不托管**影视媒体，也不上传用户媒体；课程包默认不含媒体。 |
| 8 | 离线 | 工具离线可用；市场只是可选入口，本地导入的文件断网可用。 |

---

## 2. `.shadowcourse` P0 包格式（单文件 JSON，UTF-8）

> 说明：docs/43 §3 的 ZIP spec 保留为 v2 目标；**P0 采用单文件 JSON**（扩展名 `.shadowcourse`，内容为 JSON；同时接受 `.json`），因为它是纯数据、可签名、可 diff、**无需解包器即可一键导入**，且完全满足"媒体引用 + 句子时间轴 + 翻译 + 练习配置"。
> 校验器：`node tools/shadowcourse/validate.mjs <file>`（打包器同目录）。

```jsonc
{
  "spec": "shadow.course",
  "schemaVersion": 1,
  "id": "com.shadow.course.cafe-order",          // ^[a-z0-9][a-z0-9._-]*$，全局唯一、发布后不变
  "version": "1.0.0",                            // semver
  "title": "在咖啡店点单",
  "subtitle": "Ordering at a Café · B1",
  "description": "1–3 句话，市场详情页与卡片使用。",
  "category": "daily",                           // 见 catalog.categories
  "tags": ["B1", "日常", "连读"],
  "level": "B1",
  "language": ["en", "zh"],
  "creator": { "name": "SHADOW Studio", "url": "", "handle": "shadow-studio" },
  "license": "CC-BY-4.0",
  "rights": { "basis": "own", "evidenceUrl": "", "note": "" },
  "mediaPolicy": "byom",                         // P0 固定 byom（不含媒体）
  "media": [
    { "id": "m1", "kind": "video", "duration": 0, "hint": "任意英语视频/音频；时间轴按秒对齐" }
  ],
  "sentences": [
    { "sentenceId": "s_0001", "start": 0.104, "end": 3.667,
      "text": "Hi, could I get a medium oat milk latte, please?",
      "translation": "你好，我要一杯中杯燕麦拿铁。",
      "words": [ { "w": "Hi", "s": 0.1, "e": 0.25 } ],   // 可选；缺省则整句评分
      "notes": "" }                                       // 可选：教学提示
  ],
  "exercises": {
    "spec": "shadow.exercises", "schemaVersion": 1,
    "default": { "mode": "shadow", "loopCount": 3, "speed": 1.0,
                 "scoring": { "enabled": true },
                 "subtitle": { "en": true, "zh": true, "position": "bottom" } }
  },
  "requires": { "shadow": ">=0.7.0" },
  "createdAt": "2026-10-25T00:00:00Z",
  "updatedAt": "2026-10-25T00:00:00Z",
  "readme": "## 课程介绍\n……（Markdown，详情页 README 直接渲染；纯文本安全渲染，禁止内联脚本/HTML 事件）"
}
```

**硬性规则**

1. `sentences[]` 至少 1 条；`start`/`end` 为秒（数字，`end > start`），按 `start` 升序；`text` 非空。
2. 包是**纯数据**：不允许脚本、可执行内容、外链 iframe；README 按 Markdown 白名单渲染。
3. `mediaPolicy` 为 `byom` 时 `media[]` 可只作提示；导入**不需要 ASR**，直接拿 `sentences` 建句。
4. 单包 ≤ 2 MB（BYOM 包通常 <200 KB）。
5. 未识别字段忽略（向前兼容）；`schemaVersion` 不识别时提示升级工具。

---

## 3. 市场数据契约（静态站，无后端）

### 3.1 目录（`market/` 独立产品，不进入桌面包）

```
market/
  index.html            # 单页应用（hash 路由：#/ #/resource/<id> #/category/<id> #/creator/<handle> #/search?q= #/points #/settings #/import #/404）
  assets/               # 样式/脚本/图标（手写 CSS，GitHub 式设计令牌；不引第三方 CDN）
  data/catalog.json     # 资源目录（见 3.2）
  data/packages/*.shadowcourse   # 课程包（纯数据，静态可下载）
  plugins/<type>/manifest.json   # 资源类型=插件清单（见 3.3）
  serve.mjs             # 本地静态服务（默认 127.0.0.1:18920，允许跨域，供本地预览/深链联调）
  README.md             # 怎么跑/怎么部署/怎么加资源
```

### 3.2 `data/catalog.json`

```jsonc
{
  "spec": "shadow.market.catalog",
  "schemaVersion": 1,
  "generatedAt": "2026-10-25T00:00:00Z",
  "site": { "name": "SHADOW 市场", "tagline": "全免费 · 积分兑换 · 本地优先", "baseUrl": "" },
  "categories": [ { "id": "daily", "label": "日常会话", "labelEn": "Daily", "count": 2 } ],
  "creators": [ { "handle": "shadow-studio", "name": "SHADOW Studio", "bio": "官方示例课程", "avatarColor": "#2EE6A8" } ],
  "resources": [
    {
      "id": "com.shadow.course.cafe-order",
      "type": "course",                       // 对应 market/plugins/<type>/manifest.json
      "title": "在咖啡店点单",
      "subtitle": "Ordering at a Café · B1",
      "description": "……",
      "category": "daily",
      "level": "B1",
      "tags": ["B1", "日常", "连读"],
      "creator": "shadow-studio",
      "license": "CC-BY-4.0",
      "version": "1.0.0",
      "points": 0,
      "free": true,
      "updatedAt": "2026-10-25T00:00:00Z",
      "downloads": 0,
      "stats": { "sentences": 12, "durationSec": 0, "words": 160 },
      "cover": { "color1": "#1B4D3E", "color2": "#2EE6A8" },
      "packageUrl": "data/packages/com.shadow.course.cafe-order.shadowcourse",
      "readme": "## ……（Markdown 摘要，详情页用包内 readme 亦可）"
    }
  ]
}
```

- 详情页**必须**再 fetch `packageUrl` 拿完整数据（句子预览/字数/时长以包为准），catalog 只做索引与卡片。
- `points: 0` + `free: true` = 免费资源；P1 兑换演示也读同一字段（`points > 0` 时需"兑换"）。

### 3.3 资源类型插件清单 `market/plugins/<type>/manifest.json`（"一切即插件"）

```jsonc
{
  "manifestVersion": 1,
  "kind": "resource-type",
  "id": "course",
  "label": "课程包",
  "labelEn": "Course",
  "icon": "book",                    // 前端内置图标名（不执远程代码）
  "fileExt": [".shadowcourse", ".json"],
  "detailTabs": ["readme", "sentences", "files", "versions"],
  "cardBadges": ["free", "level"],
  "install": { "mode": "desktop-import", "deepLink": "shadow-import" },
  "permissions": { "network": false, "filesystem": false, "microphone": false },
  "enabled": true
}
```

- 前端启动时 `fetch('plugins/index.json')` → 逐个 fetch 清单 → 注册类型渲染器；未知类型降级为通用卡片（不崩）。
- 市场**不执行插件代码**，只读声明（诚实说明：这是声明式类型插件，不是任意代码插件）。

---

## 4. 一键导入协议（P0 实现方式，避开注册表/协议注册）

Web 详情页"一键导入到 SHADOW Studio"按钮：

1. 探测本机 SHADOW Studio 本地服务：依次 `fetch('http://127.0.0.1:18765..18775/api/health', {mode:'no-cors'})`（超时 300ms）。
2. 探测到 → `location.href = 'http://127.0.0.1:<port>/?import=' + encodeURIComponent(<包绝对URL>)`（新开窗口），工具侧导入后提示"选择本地媒体（BYOM）"。
3. 探测不到 → 自动降级为**下载** `.shadowcourse`，并给出 3 步说明（下载 → 打开 SHADOW Studio → 把文件拖进窗口）。
4. 包 URL 同源静态文件；部署到 https 时需允许工具页跨域 fetch（静态站加 `Access-Control-Allow-Origin: *`，`serve.mjs` 已带）。
5. 工具侧也支持：拖拽 `.shadowcourse` 到窗口、按钮选择文件、启动 URL 参数 `?import=<url>`。**导入不跑 ASR、不联网（除 ?import= 取包）、不上传任何数据。**

---

## 5. 目录/写入分工（并行期间避免撞车）

| 范围 | 写者 | 说明 |
|---|---|---|
| `market/index.html`、`market/assets/**`、`market/plugins/**`、`market/serve.mjs`、`market/README.md` | `market-web` | 市场 Web 全部前端 |
| `tools/shadowcourse/**`、`market/data/**`、`docs/53-*` | `shadowcourse` | 课程包 spec/打包/校验/示例包/catalog |
| `prototype/index.html`、`tools/launcher/shadow-server.py`、`docs/54-*` | `desktop-app` | 桌面导入 + 字体持久化 + 插件 manifest |
| `tools/qa/market/**` | `qa-verify` | 独立 E2E 验证脚本与报告 |
| `docs/52-*`、根 `README`、构建/发布、`tools/qa/v07` 既有回归 | Lead | 集成、基线、重建包、最终回归 |

---

## 6. P1 积分（本轮只做"本地演示"，明确标注无后端）

- 仅 `market/` 前端用 `localStorage` 演示：匿名设备 ID、每日签到 +5、完成练习打卡 +10（手动按钮/导入成功后回调 +20）、兑换扣积分、我的资源、积分流水表。
- 页面显著标注：**"P1 本地演示 · 无账号后端 · 积分不可购买/提现/转让"**；接口层留 `MarketPoints` 适配器（`getPoints/earn/spend/ledger`），正式版换 `/api` 即可。
- 不做：充值、支付、提现、转让、排行榜、复杂风控。

---

## 7. 验收标准（qa-verify 独立执行，Lead 复核）

**市场 Web（Playwright/Edge headless）**

1. 首页渲染 ≥3 张资源卡；搜索 `coffee`/`咖啡` 过滤正确；分类/作者页可达；刷新 hash 路由直达详情页不 404。
2. 详情页 Tabs：README 渲染、句子预览条数 = 包内句子数、文件清单含 packageUrl、版本信息正确。
3. 下载按钮返回 200 且 JSON 可解析、`spec=shadow.course`；一键导入在无本地服务时走降级（不报错、给 3 步说明）。
4. 设置页左侧分类导航 + 深浅色切换 + `Ctrl+K` 命令面板可用；无 console error/pageerror。
5. 1440×900 与 1024×768 两分辨率无横向溢出。

**桌面导入**

6. 拖拽/选择 `.shadowcourse` → 生成课程 clip（句子数、时间轴正确）→ 提示 BYOM 选媒体；绑定本地媒体后时长显示、可播放；不选媒体进入"仅文本模式"（播放禁用 + 提示）。
7. `?import=<url>` 深链导入成功（本地市场服务 + 工具独立端口）。
8. 导入后保存工程并重开，课程元数据与句子仍在；不触发 ASR（无 /api/asr 调用）。

**工具侧回归（既有脚本）**

9. 工具基线不改坏：r12 基线套件全过（`r12-run-all.ps1` 8 套件、`r12-packaged-feature-check.mjs` 16/16、`r9-ab-hotfix-check.mjs` 19/19、打包版 app E2E 97/97、0 console.error）；**禁止重新引入 r10 纯净录音/A-B 改动**（录音保持 r9/r12 行为）。
10. `/api/font`：重启工具后 ASS 中文字体仍自动恢复；字体文件只读列出系统字体，不写用户磁盘；无服务时静默回退原文件选择器。
11. 插件能力（r12 P0-1 已交付）不退化：Plugin Manager 的 manifest/“插件开关管 UI 框架”行为保持不变；本分支不重复实现插件 manifest。

---

## 8. 交付记录（Lead 完成后回填）

### 8.1 用户拍板（2026-10-25 深夜，本会话确认）

- docs/49 §6 的 5 个小问题：**全部接受默认** ——①积分获取=每日签到+完成练习 ②课程包默认 BYOM 不含媒体 ③Web 先做浏览/搜索/兑换/下载/一键导入，浏览器内练习器放 P2 ④先上课程包、白名单插件后 ⑤账号 P1 用邮箱验证码。
- 积分做法：**先做本地演示层（无后端账号）**，页面明确标注；P0 不卡在账号后端上。

### 8.2 基线（本轮改动前，r10 桌面包 · 镜像 root `.tmp/r11-baseline`）

| 项 | 数字/证据 |
|---|---|
| 源包 | 用户桌面包 r10，`app/SHADOW-Studio-0.7.0.html` SHA256 `c781db97bdbe1cc3e002add30ab581784d0ab6a859a8c6b9ddefcd5db4589b94`（镜像校验 match=true） |
| `run-all -Takes 5 -Packaged` | **4/4 PASS**（fake-mic、capture-harness 22.4s、server-test 11.5s、app-smoke 71.4s）→ `ALL PASS` |
| 打包版 app E2E | **97/97 PASS，0 FAIL**；takes 5/5；rms min/avg/max=**0.0458/0.0487/0.0505**；preRollMin=**1.875s**；WAV 0→5；0 console.error/pageerror |
| 用户真实数据 | `takes\` **19 条 WAV**（快照存 `%TEMP%\user-takes-snapshot-r11.txt`，全程未改）；`data\` 未动 |
| 用户进程 | 未杀 18765/8765；所有测试用镜像 root + 独立端口（18865/18866） |

### 8.3 市场 P0 交付（2026-10-26 复工后，**master commit `4c842e3`**）

> 交付形态：市场是**独立 Web 产品**，代码/数据/工具在 `market/`、`tools/shadowcourse/`，**不进入桌面构建**（两产品分开）。

| 项 | 状态/证据 |
|---|---|
| 市场 Web（P0） | ✅ 独立静态 SPA（无构建/无 CDN/无后端）：GitHub 式信息架构（顶栏搜索 `/` + Explore 左 Topics + 资源卡 + 详情 Tabs[README/句子预览/文件/版本] + About 侧栏 + 作者页 + 设置页 + `Ctrl+K` 命令面板 + 深浅色 + 404）；一键导入（探测 18765–18775 / `?appPort=` 覆盖 → 深链；未探测到自动降级下载+3 步说明）；P1 本地积分演示（签到/打卡/兑换/流水，标注无后端、不可购买/提现/转让）；README 安全 Markdown 渲染 |
| 一切即插件（市场侧） | ✅ `market/plugins/{course,plugin,subtitle}/manifest.json` 声明式资源类型清单；未知类型降级通用卡；市场不执行插件代码 |
| 课程包 P0（`.shadowcourse` 单文件 JSON） | ✅ 规范 docs/53（684 行）+ `tools/shadowcourse/validate.mjs`（`--selftest` **35/35**）+ `build-packages.mjs`（可复现）+ 5 个 BYOM 示例包 + `market/data/catalog.json`；`validate --dir` → **PASS 5 / FAIL 0 / warnings 0** |
| 市场自测 | ✅ **31/31 PASS**（Playwright+Edge headless，真实 data：首页/搜索/分类/作者/详情 Tabs/下载 200/spec 校验/一键导入降级/设置/深浅色/Ctrl+K/0 console.error/1440 与 1024 无横向溢出） |
| 独立 QA | 数据契约 **12/12**、产品原则静态审计 **16/16**（`tools/qa/market/`）；市场 E2E 复跑见 §8.6 |
| 启动方式 | `node market/serve.mjs` → `http://127.0.0.1:18920/`（被占 +1..+20）；`node tools/shadowcourse/build-packages.mjs` 重新生成数据 |

### 8.4 工具侧移植（`feat/market-import` 分支，基线 = 用户已确认的 r12.1）

> 背景：用户 2026-10-26 已通过另一会话把桌面回滚到 r9 行为并交付 r12/r12.1（**禁止重新引入 r10 纯净录音/A-B 改动**）。本任务只把市场的**薄接口**移植到 r12.1 基线：课程包一键导入（+BYOM/深链/工程保存）与 `/api/font` 字体持久化；r12 已有的插件 UI/P0-1 不重复。

- [ ] 移植提交（`D:\FOLLOWSPEAK-market-import`）
- [ ] 导入 E2E 数字（42 项等价）
- [ ] 字体 API/持久化数字
- [ ] r12 基线回归不回退（r12-run-all 8 套件 / packaged 16/16 / r9-ab-hotfix 19/19 / app-smoke 97/97）
- [ ] 新 app html SHA + 打包版镜像验证
- [ ] 是否部署到用户桌面（**待用户确认**）

### 8.5 剩余风险 / 下一步 / 待拍板

- 市场 Web 尚无真实域名部署（P0 交付为本地静态站 + 静态托管说明）；上线需用户提供域名/托管。
- `?import=` 深链在 https 部署下探测本机受混合内容限制 → 自动降级下载（已文档化）。
- P1 积分仍是本机 localStorage 演示，接真后端需账号/服务（用户已同意先本地演示）。
- 课程包媒体需与句子时间轴同源（BYOM 语义）；自动对齐/逐词评分需 ASR，本轮不做。
- 待用户拍板：①是否把 `feat/market-import` 构建部署到桌面（会替换 r12.1 app）；②市场是否要真实部署域名。
