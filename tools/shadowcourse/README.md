# tools/shadowcourse · `.shadowcourse` 包工具（构建器 + 校验器）

SHADOW 的课程包 / 字幕包是**纯数据、BYOM（媒体用户自备）的单文件 JSON**：导入 SHADOW Studio 直接拿句子时间轴建句，**不跑 ASR**；市场只托管包文件，不托管影视媒体、不上传用户媒体。

> **唯一接口契约**：`docs/53-shadowcourse-package-spec.md`（包格式）、`docs/111-market-architecture.md` §3（catalog v2）/ §5（导入产物）。
> 本目录脚本**不引第三方依赖**，只用 Node 内置模块（Node ≥ 18，仓库实测 v24.19 / `D:\NODE\node.exe`）。
> **市场目录 catalog v2** 由 `tools/catalog/build-catalog.mjs` 生成（本目录不再写 `market/data/catalog.json`，旧文件保留为 legacy）。
> **导入产物**（`.shadow.json` / `.srt` / `README`）由 `tools/import/build-shadow-json.mjs` 生成。

## 目录

```
tools/shadowcourse/
├── validate.mjs            # 校验器：CLI + 可 import 的校验函数（--selftest 内置 35 个正反例）
├── build-packages.mjs      # 包构建器：content/lessons + content/subtitles + sources → market/data/packages/*.shadowcourse
├── sources/courses.json    # 包源描述（5 个课程包 + 1 个字幕包；kind=lesson / inline）
└── README.md               # 本文件
```

生成物（写入 `market/data/packages/`，全部由 `tools/catalog/build-all.mjs` 统一编排）：

```
market/data/packages/
├── com.shadow.course.cafe-order.shadowcourse
├── com.shadow.course.asking-directions.shadowcourse
├── com.shadow.course.interview-intro.shadowcourse
├── com.shadow.course.podcast-shadow-daily.shadowcourse   # 原创演示
├── com.shadow.course.movie-scene-byom.shadowcourse        # 原创演示（无影视素材）
└── com.shadow.subtitle.daily-listening-b1.shadowcourse    # 字幕包（course 同容器，type 由 catalog 标注）
```

## 常用命令

```powershell
# 一条链构建全部数据层（包 → 导入产物 → catalog，失败不写盘；推荐）
node tools/catalog/build-all.mjs --now 2026-10-31T15:30:00Z

# 1) 只重新生成 6 个包（幂等；会更新 updatedAt）
node tools/shadowcourse/build-packages.mjs

# 2) 校验单个包（PASS/FAIL 明细 + 退出码 0/1）
node tools/shadowcourse/validate.mjs market/data/packages/com.shadow.course.cafe-order.shadowcourse

# 3) 批量校验目录（0 FAIL 才算过）
node tools/shadowcourse/validate.mjs --dir market/data/packages

# 4) 机器可读输出（stdout 只有 JSON，适合 CI / QA 断言）
node tools/shadowcourse/validate.mjs --dir market/data/packages --json

# 5) 校验器自测（内置 35 个正反例，必须全过）
node tools/shadowcourse/validate.mjs --selftest

# 6) 可复现构建（固定生成时间，便于 diff；不传 --now 则用当前 UTC 时间）
node tools/shadowcourse/build-packages.mjs --now 2026-10-25T00:00:00Z
```

> Windows 上用 `D:\NODE\node.exe` 也可，例如 `D:\NODE\node.exe tools\shadowcourse\build-packages.mjs`。

## 作为模块复用

```js
import { validatePackage, validateText, computeStats } from './tools/shadowcourse/validate.mjs';

const result = validateText(jsonText, { sizeBytes: Buffer.byteLength(jsonText) });
console.log(result.ok, result.errors, result.warnings, result.info);
// result.info = { id, version, title, sentences, durationSec, words, mediaPolicy, bytes }
```

`tools/catalog/build-catalog.mjs` 也复用 `validatePackage` / `computeStats` 做包级交叉校验。

## 打包流程（加新课程 / 字幕包）

1. 内容源：句子时间轴放 `content/lessons/<name>.json`（课程）或 `content/subtitles/<name>.json`（字幕包），字段 `sentences[].{text,translation,start,end}`，可选 `stress/linking/tip/notes`。
2. 包源：在 `tools/shadowcourse/sources/courses.json` 的 `courses` 里加一条 `kind:"lesson"`（引用内容源）或 `kind:"inline"`（内联句子，做原创演示包）。
3. 市场元数据：在 `content/resources/<slug>.json` 加一条资源（type/标题/分类/标签/许可/平台/changelog…）；在 `content/market.json.resourceOrder` 登记 id。
4. 运行 `node tools/catalog/build-all.mjs --now <ISO>` → 包 + 导入产物 + catalog 一次生成并全量校验。
5. 提交 `market/data/**`、`market/catalog/**`、`content/**`（由 Lead 统一提交）。

## 规则速查（详见 docs/53）

- 必填：`spec`（固定 `"shadow.course"`）、`schemaVersion`（`1`）、`id`、`version`（semver）、`title`、`description`、`category`、`level`、`language`、`creator`、`license`、`mediaPolicy`、`media`、`sentences`（≥1）、`createdAt`/`updatedAt`、`readme`。
- 句子：`start`/`end` 为秒数字、`end > start`、按 `start` 升序、`text` 非空。
- 纯数据：不允许脚本、`<script>`/`<iframe>`、`javascript:`、内联事件（`onclick` 等）；README 按 Markdown 白名单渲染。
- BYOM：`mediaPolicy:"byom"`、`media[].duration` 未知填 `0`、不打包任何媒体、不允许远程 URL/内嵌 base64。
- 体积：单包 ≤ 2 MiB（BYOM 包通常 <10 KB）；README ≤ 20,000 字符。
- `schemaVersion` 只认 `1`：遇到更高版本会提示升级工具（fail，不猜字段）。

## 退出码

| 命令 | 0 | 1 |
|---|---|---|
| `validate.mjs` | 全部 PASS | 任一 FAIL / 读取失败 / 用法错误 |
| `validate.mjs --selftest` | 35/35 全部匹配 | 存在不匹配 |
| `build-packages.mjs` | 生成并回读校验全部 PASS | 源/内容源错误、生成包校验失败 |
| `tools/catalog/build-all.mjs` | 包 + 导入产物 + catalog 全 PASS 并复制到 `market/` | 任一步失败（**不写 `market/`**） |
