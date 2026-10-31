# SHADOW 市场 · P0（独立 Web 产品）

> 全免费的影子跟读课程资源站：浏览 / 搜索 / 详情 / 下载 `.shadowcourse` / 一键导入 SHADOW Studio。
> P0 静态站：**纯 HTML/CSS/JS、无构建、无第三方依赖、无外网 CDN**；本地演示用 `serve.mjs`（零依赖 Node）。
>
> 接口契约：`docs/52-market-mvp-p0.md` §1–§4 / §6 / §7（唯一真相）。产品方向：`docs/49-market-simple-points-direction.md`。
>
> **市场与 SHADOW Studio 是两个产品，不做在一起。** 市场是 Web 端资源入口；桌面端只保留「导入课程包」这一个薄接口（拖拽 / 文件选择 / `?import=<url>` 深链），不在工具里塞商店 UI。

---

## 1. 快速开始

```bash
# 仓库根目录执行
node market/serve.mjs
# → http://127.0.0.1:18920/
```

- 默认监听 `127.0.0.1:18920`；被占用时自动 +1..+20（最多试到 18940），启动日志会打印实际端口。
- `--port 19000` 指定起始端口；`--host 0.0.0.0` 局域网预览（默认只绑本机）。
- 日志一行一请求；带 CORS `*`、HEAD、Range（206）、正确 MIME、路径穿越防护。
- **数据前提**：`market/data/catalog.json` 与 `market/data/packages/*.shadowcourse` 由课程包打包器生成：

```bash
node tools/shadowcourse/build-packages.mjs          # 生成 5 个示例包 + catalog.json
node tools/shadowcourse/validate.mjs --dir market/data/packages   # 校验（应 PASS 5 / FAIL 0）
node market/serve.mjs                                # 再启动市场
```

数据缺失时市场不白屏：会显示「数据未生成」错误页，并可**加载演示夹具**（`assets/dev-fixtures/`，页面持续显示「演示夹具」标记，绝不冒充真实数据）。

---

## 2. 目录结构

```
market/
  index.html                 # SPA 外壳（顶栏 / 页脚 / toast / 命令面板 / 模态框挂载点）
  assets/
    styles/tokens.css        # design tokens：深浅色、品牌色、间距、圆角、字体
    styles/app.css           # GitHub 式布局与组件样式
    js/app.js                # 启动、路由分发、顶栏交互、数据缺失降级
    js/router.js             # hash 路由解析 / 导航 / 替换
    js/data.js               # catalog / 插件清单 / 课程包 fetch 与降级、搜索排序
    js/points.js             # P1 本地积分 MarketPoints 适配器（localStorage）
    js/importer.js           # 一键导入探测（18765..18775 / ?appPort= 覆盖）与降级下载
    js/markdown.js           # 自写安全 Markdown 渲染（白名单标签，禁止内联 HTML/脚本）
    js/components.js         # toast / modal / 资源卡 / 徽标 / 骨架屏 / 空状态
    js/palette.js            # Ctrl+K 命令面板
    js/icons.js              # 内联 SVG 图标（插件清单 icon 只允许内置名）
    js/theme.js              # 深浅色三态（light/dark/system）+ 持久化
    js/prefs.js              # 本机偏好（签到提示、导入积分提示）
    js/views/*.js            # 各路由视图：home / resource / creator / points / settings / import / notfound
    dev-fixtures/            # 演示夹具（数据缺失降级演示，非真实数据）
  plugins/
    index.json               # 资源类型插件登记表
    course/manifest.json     # 课程包类型声明
    plugin/manifest.json     # 插件类型声明
    subtitle/manifest.json   # 字幕包类型声明
  data/                      # ← 打包器生成，不要手改（写者：shadowcourse）
    catalog.json
    packages/*.shadowcourse
  serve.mjs                  # 本地零依赖静态服务
  README.md                  # 本文件
```

---

## 3. 路由表（hash 路由，刷新 / 直达 / 前进后退都可用）

| 路由 | 页面 | 说明 |
|---|---|---|
| `#/` | Explore 首页 | 左侧 Topics 分类过滤 + 资源卡列表 + 类型 chip + 排序；`?sort=` `?type=` 可深链 |
| `#/resource/<id>` | 资源详情 | 标题栏 + 收藏/下载/一键导入 + Tabs（README / 句子预览 / 文件 / 版本）+ About 侧栏；`?tab=` 保留分区 |
| `#/category/<id>` | 分类页 | 同 Explore 布局，按 `catalog.categories` 过滤 |
| `#/creator/<handle>` | 作者主页 | 头像 / 简介 / 资源列表 |
| `#/search?q=` | 搜索结果 | 标题/描述/标签/作者/分类匹配，含少量中英别名（咖啡 ↔ coffee、问路 ↔ directions…） |
| `#/points` | 积分（P1 本地演示） | 余额、签到、练习打卡、兑换演示、我的资源、积分流水 |
| `#/settings` | 设置 | 左侧分组导航（账户/积分/外观/提醒/开发者/危险区）+ 行式表单；`#/settings/<section>` 深链滚动 |
| `#/import` | 导入说明 | 一键导入协议、探测演示、降级 3 步、BYOM、部署注意 |
| `#/404` | 404 | 未知路由统一渲染 404 页 |

搜索框：按 `/` 聚焦；`Ctrl+K` / `⌘K` 打开命令面板（页面跳转 / 资源搜索 / 快捷操作）。

---

## 4. 数据契约（只读静态 JSON）

- **`data/catalog.json`**（`spec: "shadow.market.catalog"`）：站点信息 + categories + creators + resources 索引。卡片只用索引字段；`downloads` P0 为真实 0（不虚报），`stats` 为打包器真实计算值。
- **`data/packages/<id>.shadowcourse`**：单文件 JSON（`spec: "shadow.course"`，schemaVersion 1）。**详情页必须再 fetch 包文件**，句子预览条数 / 时长 / 词数 / README 一律以包为准；fetch 失败时显示可读错误 + 重试，README 会退回目录摘要兜底，不白屏。
- **`plugins/index.json` + `plugins/<type>/manifest.json`**：资源类型 = 声明式插件。市场启动时逐个 fetch；未知类型降级为通用卡片（徽标「类型未注册」）与通用详情（README/文件/版本），不崩溃。
- 市场**不执行插件代码**，只读声明（诚实说明：这是声明式类型插件，不是任意代码插件）。

### 搜索

演示级子串匹配 + 少量中英别名（见 `data.js` 的 `SEARCH_ALIASES`）：多词为 AND；匹配标题、副标题、描述、标签、难度、分类、作者、类型。P0 无全文索引、无拼音转换。

### 排序

`updated`（默认）/ `name` / `downloads` / `sentences`，通过 `?sort=` 深链。

---

## 5. 一切即插件：怎么加一个资源类型

1. 在 `market/plugins/` 下新建 `<type>/manifest.json`（字段见 `docs/52 §3.3`）：

```jsonc
{
  "manifestVersion": 1,
  "kind": "resource-type",
  "id": "course",                       // 与 resources[].type 对应
  "label": "课程包", "labelEn": "Course",
  "icon": "book",                       // 只允许内置图标名（assets/js/icons.js）
  "fileExt": [".shadowcourse", ".json"],
  "detailTabs": ["readme", "sentences", "files", "versions"], // 可选：readme/sentences/files/versions
  "cardBadges": ["free", "level"],
  "install": { "mode": "desktop-import", "deepLink": "shadow-import" },
  "permissions": { "network": false, "filesystem": false, "microphone": false },
  "enabled": true
}
```

2. 把类型 id 加进 `market/plugins/index.json` 的 `plugins` 数组。
3. 在 `catalog.json` 中新增该类型的资源条目（`type` 填同 id）。

未知 / 缺失清单的类型不会让页面崩溃：使用通用卡片与通用详情渲染。`detailTabs` 决定详情页出现哪些 Tab；`statsFields` 决定卡片显示哪些统计。

---

## 6. 怎么加资源（课程包）

推荐用打包器（契约与校验都在 `tools/shadowcourse/`）：

```bash
# 编辑源描述 / content/lessons 后重新生成
node tools/shadowcourse/build-packages.mjs
node tools/shadowcourse/validate.mjs --dir market/data/packages
```

手工方式：

1. 按 `docs/52 §2` 写一个 `.shadowcourse` 单文件 JSON（`spec: "shadow.course"`；`sentences` ≥1，`start<end`、升序、`text` 非空；`mediaPolicy: "byom"`，不打包媒体）；
2. 放到 `market/data/packages/<id>.shadowcourse`；
3. 在 `market/data/catalog.json` 的 `resources` 加索引条目（`packageUrl` 用相对 `market/` 根的路径，如 `data/packages/<id>.shadowcourse`）；
4. 运行校验器确认 PASS；刷新市场即可看到（无需构建）。

> 包是**纯数据**：不允许脚本/可执行内容/外链 iframe；详情页 README 走自写白名单 Markdown 渲染（禁止内联 HTML、`script`、`on*`、`javascript:` 链接）。

---

## 7. 一键导入（docs/52 §4）

详情页「一键导入到 SHADOW Studio」：

1. **探测**：依次 `fetch('http://127.0.0.1:18765..18775/api/health', { mode: 'no-cors' })`，单端口超时 300ms（并行探测，取最小可用端口）。
2. **探测到**：新开窗口打开 `http://127.0.0.1:<port>/?import=<课程包绝对URL>`；工具侧导入后提示选择本地媒体（BYOM）。
3. **探测不到**：自动降级为**下载** `.shadowcourse` + 3 步说明（下载 → 打开 SHADOW Studio → 拖进窗口或菜单导入），按钮有 loading/成功/失败态；「下载 .shadowcourse」入口永远可用。
4. **可选端口覆盖（高级，团队联调用）**：URL 参数 `?appPort=<port>`（页面 query 或 hash 内 query 均可），给了就**只探测该端口**，不再扫描 18765..18775；语义示例：
   - `http://127.0.0.1:18920/?appPort=18770#/resource/com.shadow.course.cafe-order`
   - `http://127.0.0.1:18920/#/resource/com.shadow.course.cafe-order?appPort=18770`
5. 包 URL 同源静态文件；工具跨域 fetch 包时需要 CORS（`serve.mjs` 已带 `Access-Control-Allow-Origin: *`；部署时见 §9）。
6. 导入不跑 ASR、不上传数据、不联网（除了 `?import=` 取包）。

**已知浏览器限制**：页面部署在 `https` 时，浏览器会拦截对 `http://127.0.0.1` 的探测与跳转（混合内容），此时自动走下载降级；探测本机服务时浏览器控制台可能出现 `net::ERR_CONNECTION_REFUSED` 网络层日志（浏览器固有，不是脚本错误，JS 侧已捕获并降级）。

---

## 8. P1 本地积分演示（无后端）

页面显著标注：**「P1 本地演示 · 无账号后端 · 积分不可购买 / 提现 / 转让」**。

| 动作 | 积分 | 规则 |
|---|---|---|
| 每日签到 | +5 | 本机日历日一次 |
| 练习打卡 | +10 | 本机日历日一次（P1 无练习器回传，按钮模拟） |
| 导入成功 | +20 | 每个资源一次（详情页导入/下载后手动记录） |
| 兑换 | -所需积分 | P0 真实资源全部 `points: 0`（全免费）；`points>0` 的演示资源才需兑换 |

- 数据只存 `localStorage`：`shadow.market.points.v1`（匿名设备 ID / 流水 / 我的资源 / 收藏），上限 300 条流水。
- 适配器封装在 `assets/js/points.js` 的 `MarketPoints`（`getPoints / earn / spend / getLedger / signIn / practiceCheckIn / rewardImport / redeem / addMyResource / resetAll / exportData`）；正式版整体替换为 `/api` 实现即可，页面逻辑不动。
- 设置 → 危险区 → 「清除本地演示数据」可清空（积分/流水/我的资源/收藏/偏好/主题）。
- **不做**：充值、支付、提现、转让、排行榜、风控、账户注册。

---

## 9. 部署（静态托管）

市场是纯静态站，把 `market/` 目录整体上传即可（`index.html` 在根）：

- **GitHub Pages**：把 `market/` 作为 Pages 根目录（或子路径）；hash 路由无需 404 回退配置；`.shadowcourse` 建议配 `application/json` MIME（GitHub Pages 对未知扩展名返回 `application/octet-stream`，`fetch().json()` 仍可用，下载也正常）。
- **任意 https 静态托管**（对象存储 / Nginx / Caddy）：同上；确保 `data/catalog.json`、`data/packages/*`、`plugins/**` 一起上传且可匿名 GET。
- **CORS**：SHADOW Studio 通过 `?import=<url>` 跨域 fetch 课程包时，静态站必须返回 `Access-Control-Allow-Origin: *`（`serve.mjs` 已带；GitHub Pages 默认 `*`；自建 Nginx 需加 `add_header Access-Control-Allow-Origin *;`）。
- **路径**：所有资源引用均是相对路径（`assets/...`、`data/...`、`plugins/...`），放在子路径也能用；不要用 `file://` 直接打开（ES Modules / fetch 会被浏览器拦截）。
- **https 混合内容**：https 页面无法探测 http://127.0.0.1，自动降级下载（见 §7）。

---

## 10. 界面与设计

- 学习 **GitHub 的网页设计逻辑**（信息架构，不是抄皮肤）：顶部导航 + 搜索（`/` 聚焦）、Explore 式首页（左 Topics + 资源卡列表 + 排序）、repo 式资源卡、详情页 Tabs + About 侧栏、作者主页、GitHub 式设置页（左分组导航 + 行式表单 + Danger Zone）、`Ctrl+K` 命令面板、深浅色、404 页。
- 品牌色延续 SHADOW 青绿 `#2EE6A8`，仅用于标识与高亮点缀；正文链接/主按钮在浅色主题加深以保证 4.5:1 对比度。所有颜色/间距/圆角/字体都由 `assets/styles/tokens.css` 的 CSS 变量定义，深浅色切换只换 token。
- 可访问性：跳转主内容链接、可见 focus 环、Tabs `role=tablist/tab/tabpanel`、命令面板 `role=dialog` + 键盘上下/回车/Esc、`aria-live` toast、`aria-current` 导航、骨架屏 / 空状态 / 错误态（不白屏）。
- 响应式：1440 与 1024 无横向溢出（1024 仍保留左侧栏，≤1000px 折叠为顶部 chip 式过滤；移动端导航收进命令面板/页脚）。

### 截图（自测产物）

自测脚本会输出截图到 `%TEMP%\market-selfcheck\shots\`（`01-home-light-1440`、`02-home-dark-1440`、`04-detail-readme`、`05-detail-sentences`、`07-settings`、`08-points`、`11-home-1024`、`13-fixture-home`、`14-data-missing`、`15-import-fallback-modal` 等，共 16 张）。仓库内长期保留 4 张示意截图：

| 文件 | 内容 |
|---|---|
| `assets/screenshots/home-light.png` | Explore 首页（浅色，1440×900） |
| `assets/screenshots/resource-readme.png` | 资源详情页 README（Tabs + About 侧栏） |
| `assets/screenshots/settings-dark.png` | 设置页（深色，GitHub 式分组） |
| `assets/screenshots/points-light.png` | P1 本地积分演示页（浅色） |

---

## 11. 自测（Playwright + Edge headless）

```bash
node market/serve.mjs        # 先起服务（前台或后台）
# 自测脚本在 %TEMP%\market-selfcheck\market-selfcheck.mjs（本机验证用，产物不入库）
node %TEMP%\market-selfcheck\market-selfcheck.mjs
# 指定其它端口：MARKET_BASE=http://127.0.0.1:18921 node ...
```

覆盖：首页 ≥3 卡、搜索（中文/英文别名）、分类/作者、hash 直达 + 刷新、详情 Tabs（README 渲染/句子数=包内 5 句/文件含 packageUrl/版本 1.0.0）、5 个包 fetch 200 + `spec=shadow.course`、下载 200 + JSON + 下载事件、一键导入降级（3 步 + 自动下载 + 记录 +20）、`?appPort=` 覆盖（mock 服务深链打开）、设置页 6 分组、深浅色持久化、Ctrl+K 命令面板、P1 积分（签到/打卡/兑换/流水/我的资源/清空）、夹具模式、数据缺失降级、1440/1024 无横向溢出、0 `pageerror` / 0 JS `console.error`（导入探测时的浏览器网络层日志单独统计并说明）。

---

## 12. 已知限制（P0）

- **无后端、无账号、无上传入口**：资源由打包器预生成；没有创作者后台 / 审核后台 / 评论 / 评分。
- **搜索是演示级子串 + 少量中英别名**，不是全文索引；不处理拼音、拼写纠错。
- **下载数 / 统计**：`downloads` 真实为 0（不虚报），没有行为埋点；时长/句数/词数来自包，卡片统计来自 catalog。
- **P1 积分是本地演示**：换设备 / 清缓存会丢失；不是账户系统，也不构成支付业务。
- **一键导入**依赖浏览器允许探测本机端口；https 部署下自动降级下载（浏览器混合内容限制）。
- 仅在 Chromium/Edge（自测环境）验证；Safari/Firefox 未做专门适配（使用标准 ES2022 语法与 CSS 变量，理论可用）。
- 包格式为 P0 单文件 JSON；ZIP 多文件 / 签名 / 多版本目录是后续版本（见 `docs/52 §2`、`docs/53`）。

---

## 13. 边界与合规（不可违反）

- **全免费**：不向用户收费、不向创作者抽成；积分只是免费获取的兑换凭证（不可购买/提现/转让）；**不写支付/分账/发票/抽成/DRM**。
- **BYOM**：市场不托管影视媒体，也不上传用户媒体；课程包默认不含媒体。
- **一切即插件**：资源类型是声明式清单，市场只读声明、不执行远程代码。
- **两个产品**：市场不随桌面包打包；桌面端只保留「导入课程包」薄接口。
- 合规：只允许自有/授权/公版素材；保留投诉-下架流程（后续）；不采集学习内容。
