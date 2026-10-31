# tools/shadowcourse · `.shadowcourse` P0 课程包工具（校验器 + 打包器）

SHADOW 的课程包是**纯数据、BYOM（媒体用户自备）的单文件 JSON**：导入 SHADOW Studio 直接拿句子时间轴建句，**不跑 ASR**；市场只托管包文件，不托管影视媒体、不上传用户媒体。

> **唯一接口契约**：`docs/52-market-mvp-p0.md` §2（包格式与硬性规则）、§3.2（`catalog.json`）。
> **完整规范**：`docs/53-shadowcourse-package-spec.md`（字段表、校验规则、错误码、示例、catalog、与 docs/43 ZIP v2 的关系、许可与 BYOM 合规）。
> 本目录内校验器/打包器**不引第三方依赖**，只用 Node 内置模块（`node:fs` / `node:path`；Node ≥ 18，仓库实测 v24.19）。

## 目录

```
tools/shadowcourse/
├── validate.mjs            # 校验器：CLI + 可 import 的校验函数（--selftest 内置 35 个正反例）
├── build-packages.mjs      # 打包器：content/lessons + sources → market/data/packages + catalog.json
├── sources/courses.json    # 市场源描述（3 个真实课程 + 2 个原创 BYOM 演示包）
└── README.md               # 本文件
```

生成物（写入范围 `market/data/**`）：

```
market/data/
├── catalog.json                          # 市场目录（docs/52 §3.2）
└── packages/
    ├── com.shadow.course.cafe-order.shadowcourse
    ├── com.shadow.course.asking-directions.shadowcourse
    ├── com.shadow.course.interview-intro.shadowcourse
    ├── com.shadow.course.podcast-shadow-daily.shadowcourse   # 原创演示
    └── com.shadow.course.movie-scene-byom.shadowcourse        # 原创演示（无影视素材）
```

## 常用命令

```powershell
# 1) 生成/重生成 5 个包 + catalog.json（幂等；会更新 updatedAt/generatedAt）
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

## 打包流程（加新课程）

1. 内容源：把句子时间轴放进 `content/lessons/<name>.json`（字段 `sentences[].{text,translation,stress,linking,tip,start,end}`）。
2. 市场源：在 `tools/shadowcourse/sources/courses.json` 的 `courses` 里加一条 `kind:"lesson"`（或 `kind:"inline"` 直接内联句子，做原创演示包）。
3. 运行 `node tools/shadowcourse/build-packages.mjs` → 自动生成包 + 更新 `catalog.json`（stats 从句子真实计算）。
4. 运行 `node tools/shadowcourse/validate.mjs --dir market/data/packages`，必须 `FAIL 0`。
5. 提交 `market/data/**`（由 Lead 统一提交）。

## 规则速查（详见 docs/53）

- 必填：`spec`（固定 `"shadow.course"`）、`schemaVersion`（`1`）、`id`、`version`（semver）、`title`、`description`、`category`、`level`、`language`、`creator`、`license`、`mediaPolicy`、`media`、`sentences`（≥1）、`createdAt`/`updatedAt`、`readme`。
- 句子：`start`/`end` 为秒数字、`end > start`、按 `start` 升序、`text` 非空。
- 纯数据：不允许脚本、`<script>`/`<iframe>`、`javascript:`、内联事件（`onclick` 等）；README 按 Markdown 白名单渲染。
- BYOM：`mediaPolicy:"byom"`、`media[].duration` 未知填 `0`、不打包任何媒体、不允许远程 URL/内嵌 base64。
- 体积：单包 ≤ 2 MiB（BYOM 包通常 <200 KB）；README ≤ 20,000 字符。
- `schemaVersion` 只认 `1`：遇到更高版本会提示升级工具（fail，不猜字段）。

## 退出码

| 命令 | 0 | 1 |
|---|---|---|
| `validate.mjs` | 全部 PASS | 任一 FAIL / 读取失败 / 用法错误 |
| `validate.mjs --selftest` | 35/35 全部匹配 | 存在不匹配 |
| `build-packages.mjs` | 生成并回读校验全部 PASS | 源/lesson 错误、生成包校验失败、catalog 契约断言失败 |
