# 54 · 桌面端：课程包一键导入（BYOM）+ /api/font 中文字体持久化 + 插件 manifest/设置深链

> 生成：2026-10-25 深夜（Asia/Shanghai）｜负责人：`desktop-app`（Agent Teams）｜集成/构建：Lead
> 上游契约：`docs/52-market-mvp-p0.md` §2/§4/§7、`docs/50-handoff-2026-10-25-r8-r9.md` §2/§4/§5
> 改动文件：`prototype/index.html`（编辑源文件，构建由 `tools/build-v07.mjs` 内联 src）、`tools/launcher/shadow-server.py`、新增 `tools/qa/v07/r11-import-check.mjs`、本文件
> 未改动：媒体导入 / ASR / 评分 / 录音自动停 / 生产构建脚本 / 既有 r5·r8·r9·r10 测试脚本；用户桌面包 `takes\`、`data\` 未触碰（全部测试在镜像 root 或 dev 模式下执行）

---

## 0. 结论摘要

| 项 | 状态 | 证据 |
|---|---|---|
| A. `.shadowcourse` 一键导入（拖拽 / 按钮 / `?import=<url>`）→ 建课程 clip，**不跑 ASR** | ✅ | `r11-import-check.mjs` 42/42（dev + packaged）；`shots/r11/01–08*.png` |
| A. BYOM 向导：选择本地媒体绑定 → 按句播放；或「仅文本模式」降级 | ✅ | 绑定后时长=媒体时长、播放键可用、`currentTime` 前进；仅文本模式播放禁用 + viewer 明确提示 |
| A. 课程元数据进工程保存/恢复；旧工程兼容 | ✅ | 工程 JSON 含 `clip.course`；重开后 id/title/句子仍在、mediaMissing=true；旧工程（无 course）不报错 |
| B. `GET /api/font/list` + `GET /api/font/file?name=` 只读系统 CJK 字体 | ✅ | 16 个系统字体；白名单 + realpath + 穿越/绝对路径/空名拒绝；HEAD / 长缓存 |
| B. 字体选择器优先服务器字体，选择存设置，重开自动恢复；失败静默回退 | ✅ | 选 SimHei → `shadowStudio.assFont.v1` → `/api/settings` 落盘 → reload 自动 fetch 恢复；无服务时回退原文件选择器 |
| C. 内置插件 manifest（10 个）+ Plugin Manager「设置」入口 + `#plugin=<id>` 深链 | ✅ | 每行 manifest 摘要 + 设置按钮；subtitle-overlay → 现有字幕样式面板；其他插件 → manifest 弹窗；开关行为不变（r8 25/25 复跑） |
| 回归 | ✅ | r11 42/42（dev + packaged）；r8 字幕 25/25；r8 ASS 12/12；r9 录音自动停 10/10；r10 A/B 14/14；`run-all -Takes 5 -Packaged` 4/4 步全过（app E2E 97/97、takes 5/5、0 console.error） |

---

## 1. A · 课程包一键导入（P0 核心）

### 1.1 三个入口

| 入口 | 实现 | 说明 |
|---|---|---|
| 拖拽 `.shadowcourse` 到窗口 | `window` drop → `handleFiles()` 先按扩展名分流到课程导入（`isShadowcourseFile`），不进入媒体分析链路 | 拖拽 overlay 文案已注明“视频 / 音频 / .shadowcourse 课程包” |
| 按钮 / 菜单选择文件 | 媒体面板头「导入课程包」图标、媒体空态「导入课程包…」、File → `Import Course (.shadowcourse)…`、隐藏 `#course-input`（accept `.shadowcourse,.json`） | `.json` 扩展名先按内容嗅探 `spec=shadow.course`，不是课程包时提示改用 File → Open Project |
| 启动 URL 参数 `?import=<url>` | `init()` 里 `importCourseUrl()`：`fetchTimeout(url, 15s)` 后走同一套校验/导入 | 同源相对路径或跨源 http(s)；市场静态服务 `market/serve.mjs` 带 `Access-Control-Allow-Origin: *` 即可跨域取包；失败 toast 可读错误（`课程包下载失败：HTTP xxx / Failed to fetch…`） |

**只下载这一个包**：除 `?import=` 取包外，导入过程不联网；不调用 ASR、不上传任何数据。

### 1.2 校验（docs/52 §2 硬性规则，桌面侧独立实现）

`validateShadowcourse()` 返回 `{ok, errors:[{code,message,path}], course}`；错误码与文案：

| 错误码 | 触发条件 |
|---|---|
| `E_JSON` | 不是合法 JSON（含 BOM 清理后解析失败） |
| `E_SIZE` | 包 > **2 MB**（按文件字节；`file.size`） |
| `E_SCHEMA` | `spec !== "shadow.course"`；`schemaVersion` 缺失/非法/高于工具支持版本（提示升级）；`id` 不匹配 `^[a-z0-9][a-z0-9._-]*$`；`version` 非 semver；`title` 空；`mediaPolicy !== "byom"`；`sentences` 空/超 20000；句子不是对象、`start/end` 非数字、`end <= start`、`start < 0`、未按 `start` 升序、`text` 空；**纯数据扫描**命中 `<script`、`<iframe`、`javascript:`、`onerror=/onload=/onclick=/onmouseover=/onfocus=`、`__proto__` 等 |

失败时**拒不导入**、不产生 clip，toast 显示 `[E_XXX] 消息（路径）`（最多 4 条），`console.warn` 记录拒绝原因供诊断。

### 1.3 导入后的课程 clip

```js
{
  id: 'clip_xxx', name: <title>, kind: 'course',
  status: 'analyzed', analyzed: true,        // 跳过分析/ASR，直接用包内句子
  duration: 0,                               // 媒体未知；时间轴按最后一句 end 显示（BYOM 绑定后由媒体覆盖）
  sentences: [{ start, end, en: text, zh: translation, words, tip: notes, score: null, courseSentenceId }],
  mediaMissing: true, courseMediaBound: false, textOnly: false,
  course: { spec, schemaVersion, id, version, title, subtitle, description, category, tags, level,
            language, creator, license, mediaPolicy: 'byom', media, exercises, requires,
            createdAt, updatedAt, readme, sourceName, sourceUrl, importedAt }
}
```

- 句子字段与现有 `parseSubtitleText` / 工程恢复后的句子结构一致（`start/end/en/zh/words/tip`），因此媒体池、时间轴、Inspector、评分、录音链路无需改动即可工作；
- `words` 包内没有时按空格拆分（词级时间轴缺省 → 评分退化为整句，符合 docs/43 降级策略）；
- 练习配置：`course.exercises.default` 的 `speed` / `scoring.enabled` 会即时应用（toast 提示“已应用课程练习配置”），完整配置保留在 `clip.course.exercises` 并在 Clip 面板展示；
- 课程 clip 的 `Analyze` 按钮禁用（避免覆盖课程时间轴）；有媒体后「Re-analyze」不出现，只保留 Remove clip。

### 1.4 BYOM（Bring Your Own Media）向导

导入成功后自动弹出向导：

- 课程信息：标题/副标题/ID/version/句子数/总时长/授权/作者/mediaPolicy；
- **「选择本地媒体（BYOM）」**：设置 `S.pendingRelinkClipId` + 弹系统文件选择（复用 `#file-input`）→ `handleFiles` 优先把选中的媒体绑定到该课程 clip（复用 `relinkClip`）→ `mediaMissing=false`、`courseMediaBound=true`、`duration` 取媒体真实时长、播放键恢复；实测绑定 `content/audio/cafe-order.mp3` 后 `Space` 播放 `currentTime` 前进；
- **「仅文本模式」**（或向导“稍后（仅文本）”）→ `textOnly=true`：句子/翻译/时间轴/录音可用，但**播放键禁用**，viewer 显示“仅文本模式（BYOM）…点「选择本地媒体」绑定”的明确提示；媒体池课程行显示 `COURSE · 待绑定媒体` 徽标；
- **「查看课程 README」**：README 以**纯文本 escape 渲染**（`<pre>` + `esc()`，不执行 HTML/脚本），不引入 markdown 渲染器；
- 观看区在媒体未绑定时显示「课程已导入 · 等待绑定本地媒体」+「选择本地媒体（BYOM）」按钮；Clip 面板同样有绑定入口。

### 1.5 工程保存 / 恢复

- `projectSnapshot()` 每个 clip 增加：`course`（完整元数据 JSON）、`courseMediaBound`、`textOnly`；
- `restoreProject()` 读取并用 `normalizeCourseMeta()` 白名单归一化（未知字段忽略、缺字段补默认），恢复后 `mediaMissing=true`（BYOM 语义：媒体永不由工程携带），课程/句子/README/授权信息仍可查看，重新绑定即可播放；
- 旧工程（`clips[].course` 不存在）→ `course: null`，行为与 r10 完全一致，不报错。

---

## 2. B · `/api/font` 中文字体持久化（P1 修复）

### 2.1 服务端（`tools/launcher/shadow-server.py`，只读）

| 接口 | 行为 |
|---|---|
| `GET /api/font/list` | 只读枚举系统 CJK 字体（先 listdir，再按绝对白名单校验存在性）：返回 `{ok,count,readOnly,dir,fonts:[{name,file,family,cjk,size,ext,url}]}`；缓存 60s；不写任何文件 |
| `GET /api/font/file?name=<basename>` | 只允许**白名单内**、实际存在于 `%WINDIR%\Fonts`（及 `%LOCALAPPDATA%\Microsoft\Windows\Fonts`）的 `.ttf/.otf/.ttc`；`Content-Type: font/ttf|font/otf|font/collection`；`Cache-Control: public, max-age=31536000, immutable`；支持 HEAD（无 body） |

**白名单（16 项，逐个存在性校验）**：`msyh.ttc`、`msyhbd.ttc`、`msyhl.ttc`、`msjhl.ttc`、`simsun.ttc`、`simsunb.ttf`、`simhei.ttf`、`simkai.ttf`、`simfang.ttf`、`STKAITI.TTF`、`STSONG.TTF`、`STXIHEI.TTF`、`STFANGSO.TTF`、`Deng.ttf`、`Dengb.ttf`、`Dengl.ttf`。

**安全措施**：①绝对白名单（未枚举到的一律 404，`win.ini`/任意 `.ttf` 均不可读）；②`name` 只允许 `[A-Za-z0-9._-]+`、拒绝 `/ \ : ..`/空名/超长（400）；③命中后再按字体目录做一次存在性+大小校验（404），全程不拼接用户输入到目录外；④只 GET/HEAD（POST → 405）；⑤不写盘、不执行外部程序、不上传；⑥只绑 `127.0.0.1`（沿用服务既有安全边界）。`/api/config` 增加 `fontListUrl` / `fontFileUrl` 供前端发现。

### 2.2 前端行为

- **优先系统字体**：ASS 行「字体」→ 前端先 `GET /api/font/list`，弹窗列出 16 个系统 CJK 字体（名称/文件名/大小，当前项标记“当前”）；点选后 `GET /api/font/file?name=` 取字节 → `JASSUB fonts:[Uint8Array]`（重建渲染器，与 r8 的 `#ass-font-input` 路径共用 `applyAssFontBytes`）；
- **持久化**：选择写入 `localStorage['shadowStudio.assFont.v1']`，并加入 `PERSISTED_SETTING_KEYS` 随 `/api/settings` 落盘（换端口 origin 变化也不丢）；
- **重开自动恢复**：`init()` 在 `loadApiConfig` / 服务端偏好恢复之后调用 `restoreAssFont()`：读偏好 → `GET /api/font/list` 找到同名字体 → `GET /api/font/file` 取字节 → 注入 `S.assFontBytes`（后续 `ensureAssRenderer()` 直接带字体创建），Inspector ASS 行显示“已记住”；
- **离线/独立文件回退**：静态单文件打开（无 `/api/config`）或接口失败 → `chooseAssFont()` 直接走原「选择本机字体文件」流程（行为与 r8 一致，仅本次会话）；所有恢复失败静默（仅 console.warn），**不阻塞任何主链路**；
- **旧行为保留**：r8 的 `#ass-font-input` 直接选文件路径完全未改（r8-ass 12/12 复跑通过）。

---

## 3. C · 插件 manifest + 设置深链（“一切即插件”）

### 3.1 manifest 元数据

`PLUGIN_DEFAULTS` 既有字段（`id/name/type/desc/cap/enabled/builtin/fields`）**保持不变**，每个插件新增 `manifest` 子对象：

```jsonc
{
  "manifestVersion": 1,
  "kind": "builtin-plugin",
  "id": "subtitle-overlay",
  "name": "Subtitle Overlay · 双语字幕",
  "version": "1.1.0",
  "type": "OVERLAY",
  "builtin": true,
  "capabilities": ["SUBTITLE", "OVERLAY", "BILINGUAL", "DEEP_LINK", "PERSISTED_STYLE"],
  "permissions": { "network": false, "filesystem": false, "microphone": false },
  "settingsSchema": { "type": "object", "panel": "subtitle-style", "properties": { /* 字体/颜色/描边/x/y/w/align/showZh/hidden */ } },
  "compat": { "shadow": ">=0.7.0" },
  "deepLink": "#plugin=subtitle-overlay"
}
```

10 个内置插件的 `settingsSchema.panel` 分别指向：`asr-engine`（local-whisper / web-speech）、`score-api`（讯飞/Azure/Custom API）、`storage`（local-storage/WebDAV）、`export`（SRT/Media Exporter）、`subtitle-style`（字幕）；自定义安装插件按 `cap` 动态生成（`panel: 'plugin-info'`）。旧 `localStorage['shadowStudio.plugins.v1']` 中缺 manifest 的内置插件在 `loadConfig()` 时自动补齐，不动 `enabled` 等旧字段。

### 3.2 Plugin Manager（UI）

- 每行新增：**manifest 摘要**（`manifest v1 · <id>@<version> · N caps · perms · 深链`）与 **「设置」按钮**（`data-plugin-settings="<id>"`，便于测试）；原「Settings」展开改名为「参数」（仍为 `data-plugin-config`，r8 选择器不受影响）；
- 「设置」行为：
  - `subtitle-overlay` → 关闭 Plugin Manager、切到右栏 **SENTENCE** tab、滚动并高亮现有**字幕样式面板**（字体族/颜色/描边/位置/宽度/中英开关），同时把 URL hash 写成 `#plugin=subtitle-overlay`；
  - 其他插件 → 弹 manifest 设置弹窗（只读声明、能力/权限/设置面板/可配置字段提示）；
- **深链**：`#plugin=<id>` 启动直达（init 后 750ms）+ `hashchange` 监听；`?plugin=<id>` 亦兼容。读写 URL 用 `history.replaceState`，不会造成 hashchange 死循环；

### 3.3 不影响既有行为

- 插件开关（`data-plugin-toggle`）逻辑、`localStorage` 持久化、关闭字幕插件后隐藏字幕/销毁 JASSUB 等全部保持 r8 行为；r8 的 `r8-subtitle-check.mjs` 25/25 与 `r8-ass-check.mjs` 12/12 已复跑通过；
- 深链只做“打开/聚焦设置”，不改变插件 enabled 状态（字幕插件原本被关时，打开设置会先启用它——这与右栏“启用字幕插件”入口一致，属预期）。

---

## 4. 代码位置（`prototype/index.html` 行号，编辑后以实际文件为准）

| 内容 | 位置 |
|---|---|
| r11 CSS（课程徽标/BYOM/字体列表/manifest JSON 等） | 约 758–790（`</style>` 前） |
| File 菜单「Import Course」/ 媒体面板导入按钮 / 观看区绑定按钮 / `#course-input` | 约 1109 / 1247–1263 / 1320 / 1459 |
| `PLUGIN_DEFAULTS` + manifest 元数据（`PLUGIN_MANIFEST_META` / `pluginManifestFor`） | 约 1743–1835 |
| 状态新增（pendingRelink/assFontPref/serverFonts 等） | 约 1680–1695 |
| `handleFiles` / `relinkClip`（课程分流 + BYOM 绑定 + 分析守卫） | 约 2003 / 2072 |
| 课程包模块（校验/建 clip/向导/README/URL 导入/exercises） | 约 2396–2970 |
| 字体持久化模块（readPref/loadServerFonts/restoreAssFont/openAssFontPicker/chooseAssFont/onAssFontChosen） | 约 2971–3175 |
| `PERSISTED_SETTING_KEYS`（新增 assFont） | 约 3204 |
| `renderViewer` / `renderViewerMeta`（课程 BYOM 提示） | 约 5406 |
| `renderClipPane`（课程包信息/绑定/README） | 约 6096 |
| `pluginManifestSummaryHTML` / Plugin Manager / `openPluginSettings` / manifest 弹窗 | 约 8688–8785 |
| `projectSnapshot` / `restoreProject`（course 字段） | 约 8993 / 9075 |
| 启动深链（`?import=` / `#plugin=` / `restoreAssFont`） | 约 10146–10170 |
| QA 测试钩子（course/courseClips/fonts/pluginManifests/openPluginSettings…） | 约 9984–10075（`buildTestHooks` 内） |
| 服务端 `/api/font`（白名单/枚举/安全/路由/config） | `shadow-server.py` 约 20–21、66–75、291–400、973–1040、1124–1138 |

新增测试：`tools/qa/v07/r11-import-check.mjs`（约 430 行；`R11_PACKAGED=1` 走镜像 root `.tmp/r11-desktop`，否则 dev 模式 `prototype`）。

---

## 5. 已知限制

1. **媒体时间轴必须与课程同源**：BYOM 绑定任意视频/音频不会自动对齐（没有 ASR/强制对齐）；请选择课程注明的同源媒体（示例包对应 `content/audio/*.mp3`）。绑定后按句播放的是“媒体时间轴 + 课程句子时间轴”直接对齐。
2. **课程包不含媒体/字体/插件代码**：`mediaPolicy=byom` 固定；媒体/字体内嵌不在 P0 范围。
3. **单包 ≤2 MB**：超限直接 `E_SIZE` 拒绝（BYOM 包通常 6–7 KB）。
4. **`.json` 扩展名嗅探**：只有内容含 `"spec":"shadow.course"` 才按课程包导入，其余给提示（项目 JSON 请走 File → Open Project）。
5. **ASS 字体家族名匹配**：JASSUB 仍按 .ass 内 `Fontname` 找字体；选错字体只会回退默认字体（r8 已知限制，未变）。
6. **ASS 与 DOM 字幕互斥**：r8 语义未变（导入 .ass 生效时隐藏内置双语字幕）。
7. **插件 manifest 是声明式元数据**：不执行插件外部代码；`permissions` 只是声明，当前运行时没有插件沙箱（与市场侧“声明式类型插件”一致，诚实标注）。
8. 仅文本模式下录音/评分链路可用（课程句子作为参照），但原声播放/混音对比需绑定媒体。

---

## 6. 用户怎么用

- **拿到课程包**：市场详情页「一键导入到 SHADOW Studio」→ 自动打开本地工具并导入；或下载 `.shadowcourse` 后**拖进窗口**、File → `Import Course…`。
- **导入后**：弹窗选「选择本地媒体（BYOM）」→ 选课程对应的视频/音频 → 按句播放/跟读；没有同源媒体时选「仅文本模式」，先看句子/翻译/时间轴。
- **字幕字体**：导入 `.ass` 后右栏 ASS 行点「字体」→ 系统字体列表选中文（如 SimHei/Microsoft YaHei）→ **重开工具自动恢复**；也可点弹窗下方「选择本机字体文件…」临时用（仅本次会话）。
- **插件设置**：Plugins → Plugin Manager → 每行「设置」；或直接访问 `http://127.0.0.1:<端口>/#plugin=subtitle-overlay`。

---

## 7. 自测与回归（真实执行记录）

命令（串行；浏览器回归期间独占端口，避免 `%TEMP%\shadow-port.txt` 冲突）：

```powershell
# 新增导入/字体/插件验收（dev 模式：prototype + 独立端口 18895）
node tools\qa\v07\r11-import-check.mjs
# 打包版（自动构建 --skip-runtime → 覆盖镜像 root .tmp/r11-desktop 的 app html/server → 独立端口 18896）
$env:R11_PACKAGED='1'; node tools\qa\v07\r11-import-check.mjs

# 既有回归（dev 模式，逐条串行）
node tools\qa\v07\r8-subtitle-check.mjs     # 字幕 25/25
node tools\qa\v07\r8-ass-check.mjs          # ASS 12/12
node tools\qa\v07\r9-record-check.mjs       # 录音自动停 10/10
node tools\qa\v07\r10-ab-check.mjs          # A/B 监控 14/14
# 打包版冒烟（镜像 root，5 连录）
powershell -NoProfile -ExecutionPolicy Bypass -File tools\qa\v07\run-all.ps1 -Takes 5 -Packaged -PkgRoot D:\FOLLOWSPEAK\tools\qa\v07\.tmp\r11-desktop
```

### 7.1 本轮实测数字（2026-10-25 23:26–23:32，最终代码串行复跑）

| 项 | 结果 |
|---|---|
| `r11-import-check.mjs`（dev） | **42/42 PASS**（12.1s） |
| `r11-import-check.mjs`（packaged 镜像 root） | **42/42 PASS**（32.6s） |
| `r8-subtitle-check.mjs` | **25/25 PASS**（27.5s，0 console.error） |
| `r8-ass-check.mjs` | **12/12 PASS**（17.3s，含 CJK .ass + 本机字体载入） |
| `r9-record-check.mjs` | **10/10 PASS**（录音自动停回归） |
| `r10-ab-check.mjs` | **14/14 PASS**（A/B 监控回归） |
| `run-all.ps1 -Takes 5 -Packaged`（镜像 root 最终 app html） | **4/4 步全过**：capture-harness 68/68、server-test 49/49、app E2E **97/97**、0 console.error；takes ok=5/5，rms(min/avg/max)=**0.0475/0.0491/0.0504**，preRollMin=**1.861s**，WAV 5→10 |
| 新版 app html（`release/app/SHADOW-Studio-0.7.0.html`，`--skip-runtime` 构建）SHA256 | `6FAF8982031362529FFA9F5C9CA4C9BC0AA989FB4B07304CDF7EB9E39FB8B656`（Lead 的 `--full` 构建只多复制 runtime/模型，app html 内容一致） |

证据目录：`tools/qa/v07/shots/r11/`（`01-course-wizard`、`02-course-text-only`、`03-course-drag`、`04-course-bound-playing`、`05-course-project-restore`、`06-font-picker`、`07-plugin-settings`、`08-import-url` + `r11-import-result.json`）。

> 说明：`run-all` 里 `make-e2e-wav.py` 曾因 `%TEMP%\shadow-qa\e2e-12s.wav` 被上一进程占用（Windows 文件锁）打印 PermissionError，app-smoke 自动回退使用既有 12s WAV（`existing-e2e-wav`）后全过；这是本机并发/文件锁环境噪声，不是代码问题。

---

## 8. 给 Lead 的集成注意

1. **构建**：`node tools/build-v07.mjs --full`（Lead 执行）；本次改动无需改构建脚本/verify-package；`prototype/index.html` 内联 src 逻辑不变。最终源码 diff：`prototype/index.html` +1140/−40 行级改动、`shadow-server.py` +210 行；新增 `tools/qa/v07/r11-import-check.mjs`（约 430 行）、本文件。
2. **兼容性**：旧工程 / 旧 `localStorage` 插件列表 / 旧 `data/settings.json` 均向前兼容（自动补 manifest、`assFont` 偏好缺省为空）。
3. **服务端契约变化**：`shadow-server.py` 新增 2 个只读 GET 路由与 `/api/config` 两个字段（`fontListUrl`/`fontFileUrl`），既有路由/行为未改；`server-test.mjs` 未覆盖新路由（r11 覆盖 HTTP 契约，49/49 旧路由回归仍过）。
4. **待 Lead 复核**：新 app html SHA、`--full` 包大小、市场→桌面一键导入真实链路（`market/serve.mjs` + 工具独立端口）、用户桌面 `takes\`/`data\` 未被改动。
5. **剩余风险**：见 §5；其中“媒体时间轴需同源”是 BYOM 产品语义，不是缺陷；若后续要“任意媒体自动对齐”，需接 ASR/强制对齐（本轮明确不做）。
6. **构建产物 SHA**（`--skip-runtime` 构建，仅供 Lead 对比；`--full` 的 app html 应一致）：`6FAF8982031362529FFA9F5C9CA4C9BC0AA989FB4B07304CDF7EB9E39FB8B656`；旧 r10 包 app html SHA 为 `c781db97bdbe1cc3e002add30ab581784d0ab6a859a8c6b9ddefcd5db4589b94`。
