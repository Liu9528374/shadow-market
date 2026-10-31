# 53 · `.shadowcourse` P0 课程包规范（单文件 JSON · BYOM）

> 生成：2026-10-25（Asia/Shanghai）｜负责人：`shadowcourse`（Agent Teams）
> 上游契约（**唯一真相**）：`docs/52-market-mvp-p0.md` §2（包格式与硬性规则）、§3.2（`catalog.json`）
> 参考：`docs/43-marketplace-architecture-proposal.md` §3（ZIP spec，作为 v2 展望与字段来源）、`docs/49-market-simple-points-direction.md`（方向）
> 实现：`tools/shadowcourse/validate.mjs`（校验器）、`tools/shadowcourse/build-packages.mjs`（打包器 + catalog 生成）
> 示例产物：`market/data/catalog.json`、`market/data/packages/*.shadowcourse`（5 个 BYOM 包）
> 状态：**P0 冻结**（`schemaVersion: 1`）。本文档是 docs/52 §2/§3.2 的**实现细则与说明**；如本文档与 docs/52 有任何冲突，**以 docs/52 为准**，并应修正本文档。

---

## 1. 定位与范围

### 1.1 一句话

`.shadowcourse` 是 SHADOW 的课程包格式：**纯数据、单文件 JSON、BYOM（媒体用户自备）**；随包携带句子时间轴 / 原文 / 翻译 / 教学提示 / 练习配置——导入 SHADOW Studio 后**直接建句、不跑 ASR**，媒体由用户从本地选择。

### 1.2 为什么 P0 用单文件 JSON（而不是 ZIP）

| 理由 | 说明 |
|---|---|
| 一键导入免解包器 | 拖入 / `?import=<url>` 后只需 `JSON.parse` + 校验 + 入库；不需要 ZIP 解包、路径穿越防御、zip bomb 防御（这些留到 v2）。 |
| 可签名、可 diff | 纯 UTF-8 文本，Git 可 diff、代码评审可读；后续签名直接覆盖整文件字节（v2 扩展）。 |
| 完全满足 P0 需求 | "媒体引用 + 句子时间轴 + 翻译 + 练习配置" 全部可在单文件内表达；BYOM 本来就不打包媒体。 |
| 第三方可生成 | 规范公开，任何工具 / 脚本 / 创作者都能生成同格式包；市场不垄断格式。 |

### 1.3 产品边界（不可违反，来自 docs/52 §1 与 docs/49）

- **两个产品**：市场（`market/` 独立静态站）与 SHADOW Studio 是两个产品；桌面端只保留"导入课程包 / 深链"薄接口。
- **BYOM（Bring Your Own Media）**：市场**不托管**影视媒体、**不上传**用户媒体；课程包默认不含媒体。这是中国区合规的关键形态（不发媒体 = 不构成内容分发）。
- **P0 全免费**：`points: 0` + `free: true`；积分只是免费获取的兑换凭证，不可购买 / 提现 / 转让。包内**不含**价格 / 订单 / 买家信息。
- **一切即插件**：市场侧资源类型是声明式插件清单（`market/plugins/<type>/manifest.json`），本包 `type = "course"`；`market/data/*` 与 `tools/shadowcourse/*` 只依赖 docs/52 契约。

### 1.4 与 docs/43 ZIP spec 的关系

docs/43 §3 的 ZIP 形态（`manifest.json` + `sentences.json` + `translations/` + `media/` + 签名）保留为 **v2 目标**；P0 单文件 JSON 是其字段的**子集内联化**（见 §10 映射表）。P0 包可以无损转换为 v2 结构，反之 v2 包的多文件/媒体形态 P0 校验器不识别（按未知/不支持处理）。

---

## 2. 文件形态

| 项 | 规定 |
|---|---|
| 扩展名 | `.shadowcourse`（内容为 JSON）；校验器与桌面导入**同时接受** `.json` |
| 编码 | UTF-8；校验器容忍 UTF-8 BOM，但建议无 BOM |
| 内容 | 单个 JSON **对象**（顶层不能是数组 / 字符串 / null） |
| JSON 方言 | 严格 JSON：**不允许**注释（JSONC）、尾逗号、`NaN`/`Infinity` |
| 单包体积 | **≤ 2 MiB（2,097,152 字节）**——docs/52 §2 硬性规则 4；BYOM 包通常 < 200 KB |
| 包内媒体 | **0 个媒体文件 / 0 个二进制**：不内嵌 base64、不引用远程 URL（P0 只允许 `mediaPolicy: "byom"`） |
| 可执行内容 | **禁止**：脚本、`<script>`/`<iframe>`/`<object>`/`<embed>`、`javascript:`、`data:text/html`、内联事件属性（`onclick` 等）、`eval(`/`new Function(` |
| 文件命名 | 建议 `<id>.shadowcourse`（市场静态目录即如此）；`id` 全局唯一 |
| 发行 | 包一旦发布，`id` 不变；内容更新用 `version`（semver）递增；市场记录每次发布（不可覆盖的历史由市场侧保证，P1+） |

---

## 3. 顶层字段表

> 本表字段与 docs/52 §2 示例一一对应；"必需"列：✅ = 缺失判 **FAIL**；⭕ = 缺失只 **warn**（docs/52 规则"未识别字段忽略/向前兼容"的落地方式见 §5.3）。
> 打包器实际生成的全部字段见 `market/data/packages/*.shadowcourse`。

| 字段 | 类型 | 必需 | 约束 / 说明 |
|---|---|---|---|
| `spec` | string | ✅ | 固定 `"shadow.course"`；值不对判 FAIL |
| `schemaVersion` | int | ✅ | P0 固定 `1`；`>=1` 的整数，遇到更高版本 → FAIL 并提示升级工具（docs/52 §2 规则 5） |
| `id` | string | ✅ | 匹配 `^[a-z0-9][a-z0-9._-]*$`；全局唯一、发布后不变；长度 ≤128 |
| `version` | string | ✅ | 严格 semver（`MAJOR.MINOR.PATCH[-prerelease][+build]`），如 `"1.0.0"` |
| `title` | string | ✅ | 非空；建议 ≤120 字符 |
| `subtitle` | string | ⭕ | 副标题，如 `"Ordering at a Café · B1"`；市场卡片使用 |
| `description` | string | ✅ | 1–3 句话（详情页 / 卡片摘要）；>1000 字符 warn |
| `category` | string | ✅ | 必须是 `catalog.categories[].id`（如 `daily`）；建议小写 kebab-case |
| `tags` | string[] | ⭕ | 字符串数组（建议含 level，如 `["B1","日常","连读"]`） |
| `level` | string | ✅ | CEFR 等级 `A1`–`C2`；非标准值 warn |
| `language` | string[] | ✅ | 非空数组，如 `["en","zh"]`；建议 BCP-47 |
| `creator` | object | ✅ | `{ name ✅非空, url ⭕, handle ⭕ }`；`handle` 对应 `catalog.creators[].handle` |
| `license` | string | ✅ | 内容许可，如 `"CC-BY-4.0"`；未知标识 / 非 URL 时 warn |
| `rights` | object | ⭕ | 权利声明：`basis` ∈ `own / licensed / public-domain / CC`；`licensed/public-domain/CC` 建议给 `evidenceUrl` |
| `mediaPolicy` | string | ✅ | **P0 固定 `"byom"`**；`embedded`/`external` 判 FAIL（留到 v2，见 docs/52 §2 规则 3、docs/43 §3.5） |
| `media` | array | ✅ | 媒体**提示**数组（可空数组但建议 ≥1 条提示）；元素见 §4.2；BYOM 时 `duration` 未知填 `0` |
| `sentences` | array | ✅ | **至少 1 条**；元素见 §4.1 |
| `exercises` | object | ⭕ | 练习默认配置，见 §4.4；打包器默认生成 |
| `requires` | object | ⭕ | 兼容性声明，如 `{ "shadow": ">=0.7.0" }` |
| `createdAt` | string | ✅ | ISO8601（带时区，如 `2026-10-25T00:00:00Z`） |
| `updatedAt` | string | ✅ | ISO8601；早于 `createdAt` 时 warn |
| `readme` | string | ✅ | Markdown 字符串，详情页直接渲染；**≤ 20,000 字符**（见 §5.3）；禁止脚本/内联事件 |
| 其它字段 | any | — | **未识别字段按 docs/52 §2 规则 5 忽略**；校验器给 `W_UNKNOWN_FIELD` 提示（不 FAIL） |

> 说明：`subtitle / tags / rights / exercises / requires` 在 docs/52 §2 示例中都出现，但 docs/52 的"硬性规则"未把它们列为必须；为了让**第三方最小包**也能导入，P0 校验器把它们视为**可选字段**（缺失只 warn）。我们自己的示例包全部带齐（warnings = 0）。

---

## 4. 子结构字段表

### 4.1 `sentences[]`（免 ASR 的核心）

| 字段 | 类型 | 必需 | 约束 / 说明 |
|---|---|---|---|
| `sentenceId` | string | ⭕ | 包内唯一（推荐 `s_0001`）；缺失时导入器按顺序生成，重复判 FAIL |
| `start` | number | ✅ | 秒；必须是有限数字且 `>= 0` |
| `end` | number | ✅ | 秒；必须是有限数字且 **`end > start`** |
| `text` | string | ✅ | 英文原文，**非空**（纯空白也判 FAIL） |
| `translation` | string | ⭕ | 中文/其它翻译；缺失只汇总 warn |
| `words` | array | ⭕ | 词级时间：`[{ "w": "Hi", "s": 0.1, "e": 0.25 }]`；若提供则要求 `w` 非空、`s`/`e` 数字且 `e > s`。**没有则评分退化为整句**（docs/43 §3.5 降级策略） |
| `notes` | string | ⭕ | 教学提示（可多行）；P0 由 lesson 的 `stress/linking/tip` 映射而来 |
| `speaker` | string | ⭕ | 角色/说话人（v2 字段，P0 可存，校验器按未知字段忽略） |

**时间轴规则（docs/52 §2 硬性规则 1）**

1. `sentences[]` 至少 1 条；
2. 每条 `start`/`end` 为秒（数字），`end > start`；
3. 按 `start` **升序**（非递减）；相邻句 `start < 上一条 end` 只给 `W_OVERLAP` 警告（不 FAIL，因为口语瞬时重叠可接受）；
4. `text` 非空。

**本次 5 个示例包的句子数 / 时长（真实计算，非占位）**

| 包 | 句数 | 时长（max end） | 词数 | 来源 |
|---|---|---|---|---|
| `com.shadow.course.cafe-order` | 5 | 21.6s（末句 end 21.634） | 40 | `content/lessons/cafe-order.json` |
| `com.shadow.course.asking-directions` | 5 | 13.5s（13.509） | 33 | `content/lessons/asking-directions.json` |
| `com.shadow.course.interview-intro` | 5 | 17.5s（17.496） | 43 | `content/lessons/interview-intro.json` |
| `com.shadow.course.podcast-shadow-daily` | 5 | 19.6s | 43 | 原创演示（源描述内联） |
| `com.shadow.course.movie-scene-byom` | 5 | 15.0s | 37 | 原创演示（源描述内联） |

### 4.2 `media[]`（BYOM 提示）

| 字段 | 类型 | 必需 | 约束 / 说明 |
|---|---|---|---|
| `id` | string | ✅ | 媒体标识（P0 固定 `"m1"`），包内唯一 |
| `kind` | string | ⭕ | `audio` / `video`；未知值只 warn |
| `duration` | number | ⭕ | 秒；**未知填 `0`**（docs/52 §2 示例）；BYOM 用户自备媒体，实际时长以绑定后为准 |
| `hint` | string | ⭕ | 给用户的提示，如"任意英语音频/视频；句子时间轴按秒对齐" |
| `url` | string | ❌ | **禁止非空**（BYOM 包不得引用远程媒体） |
| `embedded` / `data` / `base64` / `content` / `bytes` | — | ❌ | **禁止**（包内不得含媒体二进制） |
| `sha256` | string | ⭕ | v2 媒体匹配用；P0 可保留（只是哈希，不是媒体数据） |

- `media` 数组**可以只有提示**（甚至空数组，但空数组给 `W_MEDIA_EMPTY`）；BYOM 导入**不需要**媒体即可建句。
- 若某条 `media[].duration > 0` 且小于最后一句 `end`，只给 `W_MEDIA_SHORTER` 警告。

### 4.3 `creator` / `rights`

```jsonc
// creator（✅ 必填对象；handle 建议提供，市场按 handle 聚合作者页）
{ "name": "SHADOW Studio", "url": "", "handle": "shadow-studio" }

// rights（⭕ 权利声明；BYOM 合规关键：声明内容权利来源）
{ "basis": "own", "evidenceUrl": "", "note": "文本/翻译/句级时间轴由 SHADOW Studio 创作；媒体由用户自备" }
```

- `basis` 枚举：`own`（自有）/ `licensed`（已授权）/ `public-domain`（公版）/ `CC`（CC 许可）；其它值 FAIL。
- `licensed / public-domain / CC` 建议填 `evidenceUrl`，否则给 `W_RIGHTS_EVIDENCE`（不 FAIL）。
- 市场 / 审核侧可用它做版权合规抽查与"投诉-下架"取证；包内不承担交易元数据（docs/43 §3.9）。

### 4.4 `exercises`（练习配置，纯数据）

```jsonc
{
  "spec": "shadow.exercises",
  "schemaVersion": 1,
  "default": {
    "mode": "shadow",              // shadow | loop | record | mixed
    "loopCount": 3,
    "speed": 1.0,
    "scoring": { "enabled": true },
    "subtitle": { "en": true, "zh": true, "position": "bottom" }
  }
}
```

- 只提供**默认值**，用户设置优先；**不含任何脚本**；评分引擎以 id/内置能力引用，不执行外部代码。
- `groups` / `checkpoints` 是 docs/43 §3.6 的 v2 扩展字段，P0 可带（校验器按未知字段忽略），P0 打包器不生成。

### 4.5 `requires`

```jsonc
{ "shadow": ">=0.7.0" }
```

- `shadow`：semver range 字符串，桌面导入时用于提示"工具版本过旧"；非法格式只 warn。
- `plugins` / `platforms` 为 v2 字段，P0 可省略。

---

## 5. 硬性规则与校验实现

### 5.1 docs/52 §2 五条硬性规则 → 校验器行为

| # | docs/52 §2 规则 | 校验器实现 | 失败错误码 |
|---|---|---|---|
| 1 | `sentences[]` 至少 1 条；`start`/`end` 为秒（数字，`end > start`），按 `start` 升序；`text` 非空 | 逐条校验类型 / 范围 / 顺序 / 文本 | `E_SENTENCES`、`E_SENTENCES_EMPTY`、`E_TIME`、`E_ORDER`、`E_TEXT` |
| 2 | 包是**纯数据**：不允许脚本、可执行内容、外链 iframe；README 按 Markdown 白名单渲染 | 递归扫描字段名与字符串值（`on*` 键、`script/iframe/object/embed`、`javascript:`、`data:text/html`、`srcdoc=`、内联事件、`eval(`、`new Function(`） | `E_SCRIPT` |
| 3 | `mediaPolicy: "byom"` 时 `media[]` 可只作提示；导入不需要 ASR，直接拿 `sentences` 建句 | `mediaPolicy` 必须 `byom`；`media` 作提示校验；禁止远程 URL / 内嵌媒体 | `E_MEDIA_POLICY*`、`E_MEDIA_URL`、`E_MEDIA_EMBEDDED` |
| 4 | 单包 ≤ 2 MB（BYOM 包通常 < 200 KB） | 按**真实文件字节数**（`stat().size`）判断，上限 2 MiB | `E_SIZE` |
| 5 | 未识别字段忽略（向前兼容）；`schemaVersion` 不识别时提示升级工具 | 未知顶层字段 warn 后忽略；`schemaVersion != 1` FAIL 并提示升级 | `W_UNKNOWN_FIELD`、`E_SCHEMA_VERSION` |

### 5.2 校验器补充检查（均为数据完整性，不新增业务约束）

| 检查 | 错误码 | 级别 |
|---|---|---|
| JSON 可解析、顶层是对象 | `E_JSON` / `E_TOPLEVEL` | FAIL |
| `spec` 值、`id` 正则 / 长度、`version` semver | `E_SPEC` / `E_ID` / `E_VERSION` | FAIL |
| 必填字段缺失 / 类型错误 | `E_TITLE`、`E_DESCRIPTION`、`E_CATEGORY`、`E_LEVEL`、`E_LANGUAGE`、`E_CREATOR`、`E_LICENSE`、`E_TIMESTAMP`、`E_README` 等 | FAIL |
| `creator.name` 非空；`rights.basis` 枚举 | `E_CREATOR` / `E_RIGHTS` | FAIL |
| `media[].id` 重复；`media[].duration` 非数字/负数 | `E_DUP_MEDIA_ID` / `E_MEDIA_DURATION` | FAIL |
| `sentenceId` 重复；`translation`/`notes`/`words` 类型错误 | `E_DUP_SENTENCE_ID` / `E_TRANSLATION` / `E_NOTES` / `E_WORDS` | FAIL |
| `exercises` 结构 / `requires` 类型 / `tags` 元素类型 | `E_EXERCISES` / `E_REQUIRES` / `E_TAGS` | FAIL |
| README 超长 | `E_README_TOO_LONG` | FAIL |
| 同一批 `--dir` / 多文件内 `id` 重复 | `E_DUP_ID` | FAIL |
| 可选字段缺失 / 非标准值 / 时间重叠 / README 过长描述等 | `W_*`（见 §6.4） | warn（不影响退出码） |

### 5.3 P0 实现约定（docs/52 未给数值，校验器取此值；可调，不构成新契约）

| 约定 | 值 | 理由 |
|---|---|---|
| README 长度上限 | **20,000 字符** | 防止单包膨胀、详情页渲染卡顿；超过应把长文放句子 / 外部说明 |
| `id` 长度上限 | 128 字符 | 反向域名式 id 足够，防御异常输入 |
| 单包上限 | 2,097,152 字节（2 MiB） | docs/52 "≤ 2 MB" 的字节实现 |
| 时间重叠 | 只 warn | 口语/对话类课程允许少量重叠；升序才是硬规则 |
| `subtitle/tags/rights/exercises/requires` | 缺失只 warn | docs/52 硬性规则未列为必须，保证第三方最小包可导入 |
| `schemaVersion > 1` | FAIL + 提示升级 | docs/52 §2 规则 5："不识别时提示升级工具"，校验器不猜未知字段语义 |

---

## 6. 校验器 `tools/shadowcourse/validate.mjs`

### 6.1 CLI

```powershell
# 单个 / 多个文件
node tools/shadowcourse/validate.mjs market/data/packages/com.shadow.course.cafe-order.shadowcourse
node tools/shadowcourse/validate.mjs a.shadowcourse b.json

# 批量目录（*.shadowcourse 与 *.json；自动跳过 catalog.json/index.json/sources.json/package.json）
node tools/shadowcourse/validate.mjs --dir market/data/packages

# 机器可读（stdout 仅 JSON，适合 CI / QA）
node tools/shadowcourse/validate.mjs --dir market/data/packages --json

# 自测（内置正反例；必须全过）
node tools/shadowcourse/validate.mjs --selftest

# 帮助
node tools/shadowcourse/validate.mjs --help
```

### 6.2 人类可读输出示例（真实运行）

```text
SHADOW 课程包 P0 校验（契约 docs/52 §2）

[PASS] market\data\packages\com.shadow.course.cafe-order.shadowcourse
       5 句 · 21.6s · 40 词 · byom · 6.1 KB · id=com.shadow.course.cafe-order · v1.0.0
[FAIL] bad.shadowcourse
       ✗ [E_TIME] sentences[1].end：end（2）必须大于 start（5）
       ⚠ [W_OPTIONAL_FIELD] subtitle：可选字段 subtitle 缺失（不阻塞校验，建议补充）

汇总：PASS 5 / FAIL 1 · warnings 1 · 共 6 个文件
结果：存在 FAIL ❌
```

### 6.3 `--json` 输出结构

```jsonc
{
  "ok": true,
  "summary": { "total": 5, "pass": 5, "fail": 0, "warnings": 0 },
  "results": [
    {
      "file": "D:\\FOLLOWSPEAK\\market\\data\\packages\\com.shadow.course.cafe-order.shadowcourse",
      "ok": true,
      "bytes": 6259,
      "errors": [],
      "warnings": [],
      "info": {
        "id": "com.shadow.course.cafe-order",
        "version": "1.0.0",
        "title": "在咖啡店点单",
        "sentences": 5,
        "durationSec": 21.6,
        "words": 40,
        "mediaPolicy": "byom",
        "bytes": 6259
      }
    }
  ]
}
```

`--selftest --json` 输出 `{ selftest: true, ok, summary: { cases, pass, fail }, cases: [...] }`。

### 6.4 退出码与错误 / 警告码

**退出码**：`0` = 全部 PASS；`1` = 存在 FAIL（含读取失败、用法错误、自测不匹配）。不提供退出码 2，避免调用方（脚本 / CI）多分支。

**错误码（FAIL）**

| 错误码 | 含义 |
|---|---|
| `E_JSON` | JSON 解析失败（截断 / 注释 / 尾逗号等） |
| `E_READ` | 文件读取失败 / 不是常规文件 |
| `E_TOPLEVEL` | 顶层不是 JSON 对象 |
| `E_SPEC` / `E_SCHEMA` / `E_SCHEMA_VERSION` | `spec` 值错误 / `schemaVersion` 缺失或非法 / 不识别版本（提示升级） |
| `E_ID` / `E_VERSION` | `id` 正则/长度非法；`version` 非 semver |
| `E_TITLE` / `E_DESCRIPTION` / `E_CATEGORY` / `E_LEVEL` / `E_LANGUAGE` / `E_CREATOR` / `E_LICENSE` / `E_TIMESTAMP` / `E_README` | 必填字段缺失或类型错误 |
| `E_RIGHTS` / `E_TAGS` / `E_SUBTITLE` / `E_EXERCISES` / `E_REQUIRES` | 可选字段出现但结构非法 |
| `E_MEDIA` / `E_MEDIA_POLICY` / `E_MEDIA_POLICY_P0` / `E_MEDIA_DURATION` / `E_MEDIA_URL` / `E_MEDIA_EMBEDDED` / `E_DUP_MEDIA_ID` | `media` 结构 / P0 仅 byom / 时长非法 / 远程 URL / 内嵌媒体 / 媒体 id 重复 |
| `E_SENTENCES` / `E_SENTENCES_EMPTY` / `E_SENTENCE_OBJECT` / `E_SENTENCE_ID` / `E_DUP_SENTENCE_ID` | `sentences` 结构 / 为空 / 元素非对象 / sentenceId 非法 / 重复 |
| `E_TEXT` / `E_TIME` / `E_ORDER` / `E_TRANSLATION` / `E_WORDS` / `E_NOTES` | 文本空 / 时间非法 / 未升序 / 翻译类型错误 / 词级时间结构错误 / notes 类型错误 |
| `E_SIZE` / `E_README_TOO_LONG` | 包超过 2 MiB；README 超过 20,000 字符 |
| `E_SCRIPT` | 纯数据安全扫描命中（脚本 / 可执行 / 内联页面 / 事件处理器） |
| `E_DUP_ID` | 同一批校验内 `id` 重复 |
| `E_REQUIRED` | 兜底（新增必填字段时使用） |

**警告码（warn，不影响退出码）**

| 警告码 | 含义 |
|---|---|
| `W_UNKNOWN_FIELD` | 未识别字段被忽略（向前兼容） |
| `W_OPTIONAL_FIELD` | 可选字段缺失（subtitle/tags/rights/exercises/requires） |
| `W_TITLE_LONG` / `W_DESCRIPTION_LONG` / `W_TAGS_LONG` | 文本过长（建议值） |
| `W_CATEGORY_FORMAT` / `W_LEVEL_UNKNOWN` / `W_LANGUAGE_FORMAT` / `W_CREATOR_HANDLE` / `W_LICENSE_UNKNOWN` | 非标准值提示 |
| `W_RIGHTS_BASIS` / `W_RIGHTS_EVIDENCE` | 权利声明缺失 / 非 own 但无授权证据 |
| `W_MEDIA_EMPTY` / `W_MEDIA_KIND` / `W_MEDIA_DURATION` / `W_MEDIA_SHORTER` | 媒体提示缺失 / kind 未知 / duration 缺失 / 媒体短于时间轴 |
| `W_OVERLAP` / `W_TRANSLATION_MISSING` / `W_TRANSLATION_EMPTY` / `W_SENTENCE_ID_MISSING` | 句子时间重叠 / 缺翻译 / 空翻译 / 缺 sentenceId |
| `W_EXERCISE_MODE` / `W_EXERCISE_LOOP` / `W_EXERCISE_SPEED` / `W_SUBTITLE_POSITION` / `W_REQUIRES_FORMAT` | exercises/requires 的取值提示 |
| `W_TIMESTAMP_ORDER` | `updatedAt` 早于 `createdAt` |

### 6.5 作为模块复用（桌面端 / QA / 第三方工具）

```js
import { validatePackage, validateText, computeStats } from './tools/shadowcourse/validate.mjs';

// 已有解析后的对象
const r1 = validatePackage(obj, { sizeBytes: Buffer.byteLength(raw, 'utf8') });

// 直接校验文件文本（推荐：真实文件字节数参与 2 MiB 判定）
const r2 = validateText(raw);
// r.ok === true；r.errors / r.warnings 为 { code, path, message, hint? } 数组
// r.info = { id, version, title, sentences, durationSec, words, mediaPolicy, bytes }

computeStats(sentences); // { sentences, durationSec, words }
```

### 6.6 `--selftest`（内置 35 个正反例，当前 PASS 35 / FAIL 0）

覆盖：完整合法包 / 最小合法包 / 未知字段忽略；缺 `spec`、`schemaVersion=2`、`id` 大写/点开头、`version=1.0`、缺 `title`/`readme`、坏 ISO 时间、顶层数组；`sentences` 为空/非数组、`end==start`、`end<start`、`start` 字符串、空白 `text`、未升序、重复 `sentenceId`、`words` 结构错误；README 含 `<script>`、内联 `onerror`、顶层 `onClick`；BYOM 引用远程 URL、`mediaPolicy=embedded`、超 2 MiB、README 超长；JSON 截断 / 尾逗号。

```powershell
node tools/shadowcourse/validate.mjs --selftest
# 汇总：PASS 35 / FAIL 0 · 共 35 个用例
# 自测：全部通过 ✅
```

---

## 7. 打包器 `tools/shadowcourse/build-packages.mjs`

### 7.1 源描述

打包器读取 `tools/shadowcourse/sources/courses.json`（`spec: "shadow.market.sources"`）：

```jsonc
{
  "spec": "shadow.market.sources",
  "schemaVersion": 1,
  "site": { "name": "SHADOW 市场", "tagline": "全免费 · 积分兑换 · 本地优先", "baseUrl": "" },
  "creator": { "handle": "shadow-studio", "name": "SHADOW Studio", "bio": "官方示例课程", "avatarColor": "#2EE6A8" },
  "categories": [
    { "id": "daily", "label": "日常会话", "labelEn": "Daily" }
    // travel / work / podcast / movie …
  ],
  "courses": [
    { "kind": "lesson", "lesson": "content/lessons/cafe-order.json", "packageId": "com.shadow.course.cafe-order",
      "version": "1.0.0", "category": "daily", "tags": ["B1","日常","连读","美音"],
      "description": "…", "audience": "…", "mediaKind": "audio", "mediaHint": "…",
      "createdAt": "2026-10-25T00:00:00Z" },
    { "kind": "inline", "packageId": "com.shadow.course.movie-scene-byom",
      "title": "…", "subtitle": "…", "level": "A2", "language": ["en","zh"], "category": "movie",
      "tags": ["A2","影视","对话","BYOM演示"], "description": "…", "audience": "…",
      "cover": ["#2B1B33","#B388FF"], "expressions": ["…"], "mediaHint": "…",
      "readmeNote": "本包为原创演示占位内容，不含任何影视素材…",
      "sentences": [ { "start": 0.0, "end": 2.2, "text": "…", "translation": "…", "notes": "…" } ] }
  ]
}
```

| `kind` | 含义 | 句子来源 |
|---|---|---|
| `lesson` | 复用仓库已有课程（真实句子时间轴） | `content/lessons/<name>.json` 的 `sentences[]` |
| `inline` | 原创演示 / 外部供稿（句子直接写在源描述里） | 源描述 `sentences[]`（时间轴自洽，不得伪造版权素材） |

### 7.2 lesson → 包字段映射

| lesson 字段 | 包内字段 | 说明 |
|---|---|---|
| `id` | 由源描述 `packageId` 决定（如 `com.shadow.course.cafe-order`） | 不直接使用 lesson.id |
| `title` / `title_en` / `level` | `title` / `subtitle`=`<title_en> · <level>` / `level` | 中文标题 + 英文副标题 |
| `sentences[].text` | `sentences[].text` | 原样 |
| `sentences[].translation` | `sentences[].translation` | 原样 |
| `sentences[].start` / `end` | `sentences[].start` / `end` | 原样（免 ASR 的核心） |
| `sentences[].stress` / `linking` / `tip` | `sentences[].notes`（多行：`重音：…` / `连读：…` / `提示：…`） | 教学提示不丢 |
| `cover` | `catalog.resources[].cover`（包内不重复存） | 市场卡片色 |
| `expressions` | `readme` 的「你会练到」 | 场景句式 |
| — | `media[] = [{ id:"m1", kind, duration:0, hint }]` | `duration: 0` = 未知（BYOM） |
| — | `exercises` / `requires` / `license` / `rights` / `readme` / 时间戳 | 打包器按 P0 契约生成 |

- **词级时间**：lesson 无 `words`，包内不编造词级时间 → 评分退化为整句（docs/43 §3.5）。
- **媒体**：不打包任何音频/视频（`content/audio/*.mp3` 仅作为"官方示范音频"时长提示写进 `media[].hint`，不进包）。

### 7.3 命令与产物

```powershell
# 生成到 market/data（默认）
node tools/shadowcourse/build-packages.mjs

# 指定输出目录 / 源描述 / 固定时间（可复现构建）
node tools/shadowcourse/build-packages.mjs --out market/data --now 2026-10-25T00:00:00Z

# 机器可读摘要（stdout 仅 JSON）
node tools/shadowcourse/build-packages.mjs --json
```

产物：

```text
market/data/
├── catalog.json                        # docs/52 §3.2（5 资源 / 5 分类 / 1 创作者）
└── packages/
    ├── com.shadow.course.cafe-order.shadowcourse
    ├── com.shadow.course.asking-directions.shadowcourse
    ├── com.shadow.course.interview-intro.shadowcourse
    ├── com.shadow.course.podcast-shadow-daily.shadowcourse
    └── com.shadow.course.movie-scene-byom.shadowcourse
```

**真实运行结果（2026-10-25，build 时间 `2026-10-25T15:16:17.448Z`）**

| # | 包 | 大小 | 句数 | 时长 | 词数 | 校验 |
|---|---|---|---|---|---|---|
| 1 | `com.shadow.course.cafe-order` | 6,259 B | 5 | 21.6s | 40 | PASS |
| 2 | `com.shadow.course.asking-directions` | 6,166 B | 5 | 13.5s | 33 | PASS |
| 3 | `com.shadow.course.interview-intro` | 6,657 B | 5 | 17.5s | 43 | PASS |
| 4 | `com.shadow.course.podcast-shadow-daily`（原创演示） | 6,365 B | 5 | 19.6s | 43 | PASS |
| 5 | `com.shadow.course.movie-scene-byom`（原创演示） | 6,194 B | 5 | 15.0s | 37 | PASS |

```text
catalog.json：9.9 KB（10,132 B）· 5 个资源 · 5 个分类 · 1 个创作者 · 句子合计 25 句
分类：daily(1)、travel(1)、work(1)、podcast(1)、movie(1)
```

### 7.4 打包器内部断言（生成即校验）

1. 每个生成的包先 `validatePackage()`（内存）→ 任一 error 则**不写盘**、退出码 1；
2. 写盘后**回读文件字节**再 `validateText()`（真实体积参与 2 MiB 判定）→ 失败同样退出 1；
3. `catalog` 生成后做 `validateCatalog()` 契约断言：`spec/schemaVersion/site/categories[].count/creators/resources[]` 字段齐全、`points=0`、`free=true`、`downloads=0`、`packageUrl` 相对路径、**stats 与包内句子真实计算值逐项一致**、catalog readme 摘要 ≤2000 字符；
4. 目录内已存在但非本次生成的 `.shadowcourse` 不删除，只提示（避免误删他人资源）。

---

## 8. `catalog.json` 契约（docs/52 §3.2）

> 市场前端只读 `market/data/catalog.json` 与 `market/data/packages/*.shadowcourse`；**详情页必须再 fetch `packageUrl` 拿完整数据**（句子预览/字数/时长以包为准，catalog 只做索引与卡片）——docs/52 §3.2 原文要求。

### 8.1 顶层

| 字段 | 类型 | 说明 |
|---|---|---|
| `spec` | string | 固定 `"shadow.market.catalog"` |
| `schemaVersion` | int | `1` |
| `generatedAt` | string | 生成时间 ISO8601（当前 UTC 时间） |
| `site` | object | `{ name, tagline, baseUrl }`；`baseUrl` 留空 = 同源相对路径 |
| `categories` | array | `[{ id, label, labelEn, count }]`；只列有资源的分类，`count = 该分类资源数` |
| `creators` | array | `[{ handle, name, bio, avatarColor }]` |
| `resources` | array | 资源卡索引，字段见 §8.2 |

### 8.2 `resources[]`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 与包内 `id` 一致 |
| `type` | string | `"course"`（对应 `market/plugins/course/manifest.json`） |
| `title` / `subtitle` / `description` | string | 来自包 |
| `category` | string | `categories[].id` |
| `level` | string | CEFR |
| `tags` | string[] | 来自包 |
| `creator` | string | `creators[].handle` |
| `license` | string | 来自包 |
| `version` | string | semver |
| `points` | int | **`0`**（P0 全免费） |
| `free` | bool | **`true`** |
| `updatedAt` | string | 生成时间（重建时更新） |
| `downloads` | int | **`0`**（示例数据，不虚构） |
| `stats` | object | `{ sentences, durationSec, words }`，**从包内 `sentences` 真实计算**（定义见 §8.3） |
| `cover` | object | `{ color1, color2 }`，来自 lesson `cover` / 源描述 `cover` |
| `packageUrl` | string | **相对路径** `data/packages/<id>.shadowcourse` |
| `readme` | string | Markdown **摘要**（≤2000 字符；完整 README 在包内） |

### 8.3 `stats` 计算公式（打包器实现，与校验器 `computeStats` 同一函数）

```text
sentences   = sentences.length
durationSec = round1(max(sentences[].end))        // 秒，保留 1 位小数
words       = sum( sentences[].text.trim().split(/\s+/).length )
```

> P0 的 `media[].duration = 0` 表示未知，**不参与** catalog 统计；`durationSec` 是"课程句子时间轴长度"，不是媒体时长。

---

## 9. 示例

### 9.1 最小合法包（可导入；省略可选字段会有 warn，但不影响 PASS）

```json
{
  "spec": "shadow.course",
  "schemaVersion": 1,
  "id": "com.example.course.minimal",
  "version": "1.0.0",
  "title": "最小课程包",
  "description": "一条句子也能导入。",
  "category": "daily",
  "level": "A1",
  "language": ["en", "zh"],
  "creator": { "name": "示例作者", "url": "", "handle": "example" },
  "license": "CC-BY-4.0",
  "mediaPolicy": "byom",
  "media": [{ "id": "m1", "kind": "audio", "duration": 0, "hint": "自备任意英语音频" }],
  "sentences": [
    { "sentenceId": "s_0001", "start": 0, "end": 2.5, "text": "Hello, world.", "translation": "你好，世界。" }
  ],
  "createdAt": "2026-10-25T00:00:00Z",
  "updatedAt": "2026-10-25T00:00:00Z",
  "readme": "# 最小课程包\n\n一条句子也能导入（P0 校验会提示缺少可选字段，但不阻塞）。"
}
```

### 9.2 真实示例（节选自信封包 `market/data/packages/com.shadow.course.cafe-order.shadowcourse`）

```jsonc
{
  "spec": "shadow.course",
  "schemaVersion": 1,
  "id": "com.shadow.course.cafe-order",
  "version": "1.0.0",
  "title": "在咖啡店点单",
  "subtitle": "Ordering at a Café · B1",
  "description": "咖啡店点单场景的 5 句实用对话：点单、选冷热、加浓缩、问价、刷卡。…",
  "category": "daily",
  "tags": ["B1", "日常", "连读", "美音"],
  "level": "B1",
  "language": ["en", "zh"],
  "creator": { "name": "SHADOW Studio", "url": "", "handle": "shadow-studio" },
  "license": "CC-BY-4.0",
  "rights": { "basis": "own", "evidenceUrl": "", "note": "文本、翻译与句级时间轴由 SHADOW Studio 创作；媒体由用户自备（BYOM），包内不含媒体。" },
  "mediaPolicy": "byom",
  "media": [{ "id": "m1", "kind": "audio", "duration": 0, "hint": "任意英语音频或视频；句级时间轴按秒对齐（官方示范音频约 21.6 秒）" }],
  "sentences": [
    { "sentenceId": "s_0001", "start": 0.104, "end": 3.667,
      "text": "Hi, could I get a medium oat milk latte, please?",
      "translation": "你好，我要一杯中杯燕麦拿铁。",
      "notes": "重音：get · medium · oat · latte\n连读：could I → coul-dai\n提示：Could I get 连读成 coul-dai-get，语气上扬更礼貌。" }
    // … 共 5 句
  ],
  "exercises": { "spec": "shadow.exercises", "schemaVersion": 1,
    "default": { "mode": "shadow", "loopCount": 3, "speed": 1.0,
      "scoring": { "enabled": true },
      "subtitle": { "en": true, "zh": true, "position": "bottom" } } },
  "requires": { "shadow": ">=0.7.0" },
  "createdAt": "2026-10-25T00:00:00.000Z",
  "updatedAt": "2026-10-25T15:16:17.448Z",
  "readme": "# 在咖啡店点单\n\n> Ordering at a Café · B1 · 由 SHADOW Studio 发布 · 许可 CC-BY-4.0\n…"
}
```

> 注意：上面用 ```jsonc 只为在**文档中**展示注释/省略；实际包文件是严格 JSON。

---

## 10. 与 docs/43 ZIP spec（v1/v2）的关系与差异

### 10.1 字段映射

| docs/43 §3（ZIP v2 目标） | docs/52 §2（P0 单文件） | 说明 |
|---|---|---|
| `manifest.json`（元信息） | 顶层字段内联（`spec`…`requires`） | P0 单文件即"manifest + sentences 内联" |
| `sentences.json` | `sentences[]` | 同字段：`sentenceId/start/end/text/words/translation/notes` |
| `translations/zh.json`（语言 → 文件） | `sentences[].translation` 内联 | P0 每句一条翻译；多语言扩展留 v2 |
| `exercises.json` | `exercises` 内联 | 字段同 docs/43 §3.6（`mode/loopCount/speed/scoring/subtitle`） |
| `media/`（embedded） | `media[]` 仅提示 + `mediaPolicy:"byom"` | P0 **不含媒体**；媒体由用户本地自备 |
| `media.ref.json`（external：URL + sha256） | —（P0 禁止 `media[].url`） | v2 恢复 external 形态 |
| `preview/cover.jpg`、`sample.mp3` | catalog `cover` 色块 / readme 文案 | P0 不打包任何媒体（含预览） |
| `LICENSE`、`attribution.md` | `license`、`rights`、`readme` 授权段 | 合规信息内联 |
| `SIGNATURE`、`integrity.files` | —（P0 无签名） | v2：Ed25519 + sha256（docs/43 §3.7） |
| `compat` / `rating` / `homepage` / `support` | 未定义（未知字段忽略） | v2 扩展 |

### 10.2 差异总结

| 维度 | docs/43 ZIP v2 | docs/52 / P0 单文件 JSON |
|---|---|---|
| 形态 | ZIP 多文件（可含媒体） | 单文件纯 JSON（无媒体） |
| 媒体三态 | `embedded` / `external` / `byom` | **只 `byom`**（P0 固定） |
| 签名 / 完整性 | Ed25519 + 文件 sha256 | 无（P0 免费包；后续整文件签名） |
| 解包安全 | 路径穿越 / zip bomb / 文件数限制 | 无解包面；只校验 2 MiB + 纯数据扫描 |
| 体积上限 | 单包 ≤2 GB（BYOM 通常 <10 MB） | 单包 ≤2 MiB |
| 一键导入 | 解包 + 校验 + 入库（<3s） | `JSON.parse` + 校验 + 入库（毫秒级） |
| diff / 评审 | 需要 unzip 工具 | 文本可直接 diff |
| 版本 | `manifest.schemaVersion` | 顶层 `schemaVersion` |

### 10.3 v2 展望（P1 / P2）

1. **ZIP 化**：用 docs/43 §3.2 的目录结构承载 P0 顶层字段（`manifest.json` + `sentences.json` + `exercises.json`），P0 包可脚本无损转换；
2. **媒体三态**：恢复 `embedded` / `external`（中国区默认仍 `byom`）；
3. **完整性 + 签名**：`integrity.files`（sha256）+ Ed25519（官方 / 创作者 / 自签三级信任，docs/43 §3.7）；
4. **增量更新**：按文件 hash 只下变化部分（docs/43 §3.8）；
5. **多语言翻译文件** / 词级时间 / preview 试听；
6. **兼容策略**：工具支持 `schemaVersion` N 与 N-1；P0 校验器遇到 `>1` 提示升级（不猜语义）。

---

## 11. 许可、版权与 BYOM 合规

### 11.1 包内内容许可

- 示例包（3 个真实课程 + 2 个原创演示）的**文本、翻译、句级时间轴**由 SHADOW Studio 创作，许可 **CC-BY-4.0**（`license: "CC-BY-4.0"`，`rights.basis: "own"`）。
- **媒体不在包内**：`content/audio/*.mp3` 只是仓库内的官方示范音频，**不打包、不上传市场**；包内 `media[].hint` 仅给出"示范音频约 N 秒"的提示。
- 第三方创作者上传时必须在 `rights` 声明 `basis`，并在 `readme` 的授权段说明来源；`licensed / public-domain / CC` 建议给 `evidenceUrl`（审核抽查用，docs/49 §5、docs/52 §1 原则 7）。

### 11.2 BYOM 合规说明（中国区关键形态）

- **市场不托管影视媒体**、**不上传用户媒体**：包内只有文本/时间轴/翻译/配置，媒体由用户本地选择 → 不构成内容分发，规避"信息网络传播视听节目"等风险（docs/43 §3.1、docs/49 §5）。
- **导入即练、免 ASR**：句子时间轴随包提供；不联网（除 `?import=<url>` 取包本身）、不上传任何数据、不跑 ASR（docs/52 §4）。
- **用户媒体版权责任**：用户选择本地媒体时，其版权/授权由用户自行负责；工具不复制、不上传该媒体。包内 `readme` 明确此点。
- **禁止影视版权素材**：示例包**不包含**任何具体影视作品的台词、画面、音频；演示包（podcast / movie）为原创占位内容，`readme` 中明确标注，避免"伪造版权素材"。
- **P0 全免费**：包内无价格/订单/买家信息（docs/43 §3.9），市场 `points: 0` + `free: true`；积分不可购买/提现/转让（docs/52 §6）。
- **投诉-下架**：市场侧运营流程（docs/49 §5）；包内 `rights` 与 `readme` 授权段为审核/取证提供信息。

### 11.3 商业使用

CC-BY-4.0 允许再分发/改编（需署名）；创作者自有内容可声明 `proprietary`（P0 免费资源仍可声明全权利保留）。**媒体**（用户自备）不随包授权。

---

## 12. 版本与兼容

| 项 | 规则 |
|---|---|
| `schemaVersion` | 包格式版本；破坏性变更 +1。P0 = `1`；工具/校验器支持 N 与 N-1（P1 起）；更高版本 → 提示升级工具（校验器 FAIL，市场/桌面可不导入或只读弱解析） |
| `version` | 内容版本（semver）：纠错/更新递增；`id` 不变；市场按版本记录发布 |
| 未识别字段 | **忽略**（向前兼容，docs/52 §2 规则 5）；校验器只 warn |
| 未知类型资源 | 市场前端"一切即插件"：未知 `type` 降级通用卡片（market-web 负责）；未知包 `spec` 拒绝导入 |
| 迁移 | P0 → v2 ZIP：字段映射见 §10.1；工具内置迁移器方向（docs/06 §7.2） |

---

## 13. 安全模型

- **纯数据**：包内不允许脚本、可执行内容、外链 iframe（docs/52 §2 规则 2）；校验器递归扫描危险键名与字符串模式（`E_SCRIPT`）。
- **README 渲染**：包只保证不含危险内容；**市场前端负责 Markdown 白名单渲染**（禁止内联 HTML/事件；docs/52 §3.3/§2 规则 2）。桌面端同样按纯文本/Markdown 安全渲染。
- **导入端双重校验**：市场下载/导入前可校验；桌面导入时必须再校验一次（不信任目录文件），失败给可读错误码（`E_SCHEMA` / `E_JSON` / `E_SIZE` 等），拒绝导入。
- **无解包攻击面**：P0 单文件 JSON 没有路径穿越 / zip bomb；仅 2 MiB 体积与 JSON 解析深度限制。
- **v2 安全**：ZIP 解包限制（docs/43 §3.7：拒绝绝对路径/`..`/符号链接；解压后大小/文件数上限）+ sha256 完整性 + Ed25519 签名/吊销；P0 留好字段映射。

---

## 14. 已知限制与后续

1. **无词级时间**：示例包含 `notes`（重音/连读提示），但无 `words[]` → 评分退化为整句（docs/43 §3.5 明确可接受）。
2. **BYOM 对齐**：媒体由用户自备，`media[].duration = 0`（未知）；若用户媒体时长与时间轴不一致，桌面端按句子时间轴播放并提示越界（docs/43 §3.5 降级策略）。
3. **无签名 / 无完整性哈希**：P0 免费包可无签名；v2 补 Ed25519 + sha256。
4. **catalog 静态生成**：`downloads` 固定 0（不虚构），真实下载统计留 P1 后端；`generatedAt/updatedAt` 每次重建更新。
5. **样本规模**：5 个包各 5 句（演示流程够用）；真实上架需更多内容与更长课程。
6. **市场前端契约依赖**：README 安全渲染、"一键导入"降级、详情页 fetch 包等由 `market/`（market-web）实现，本目录只保证包数据合规。
7. **桌面端契约依赖**：导入器需按 docs/52 §2 校验并映射 `sentences`；`notes` 多行教学提示由桌面展示方式决定。
8. **积分兑换**：P0 全免费；P1 本地演示的积分逻辑不进入包格式（包内永远无价格/订单）。

---

## 15. 参考

- `docs/52-market-mvp-p0.md` §2（.shadowcourse P0 字段与硬性规则）、§3.2（catalog.json 契约）——**唯一接口契约**
- `docs/43-marketplace-architecture-proposal.md` §3（ZIP spec、媒体三态、签名、v2 展望）
- `docs/49-market-simple-points-direction.md`（全免费 + 积分兑换方向、BYOM 合规）
- 实现与示例：`tools/shadowcourse/validate.mjs`、`tools/shadowcourse/build-packages.mjs`、`tools/shadowcourse/sources/courses.json`、`market/data/**`
- SemVer：<https://semver.org/>；CC BY 4.0：<https://creativecommons.org/licenses/by/4.0/>
- 命令速查：`tools/shadowcourse/README.md`
