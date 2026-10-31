# tools/catalog · 市场 catalog v2 构建与校验

P0 市场数据层：`content/` 源 + `market/data/packages/*.shadowcourse` + 导入产物 → `market/catalog/*.json`（schemaVersion 2）。

> 契约：`docs/111-market-architecture.md` §3（数据模型）/ §4（插件契约）/ §5（导入产物）。
> 纯 Node（≥18）零依赖；构建期计算 `sha256` / `sizeBytes` / `stats`；失败不写盘；`--now` 固定时间可复现。

## 文件

```
tools/catalog/
├── build-catalog.mjs       # 内容源 + 包 + 导入产物 → catalog v2 + 插件白名单 JSON（写盘前全量校验）
├── validate-catalog.mjs    # 独立校验器：JSON schema + 引用完整性 + sha256/size 与文件一致 + 导入 lint + 插件白名单
├── build-all.mjs           # 一条链：包 → 导入产物 → catalog → 校验 → 复制到 market/ → 再校验（失败不写盘）
└── README.md
```

## 产物

```
market/catalog/
├── site.json          { spec:"shadow.market.site",       schemaVersion:2, generatedAt, items:[站点信息] }
├── categories.json    { spec:"shadow.market.categories", schemaVersion:2, generatedAt, items:[分类+count] }
├── tags.json          { spec:"shadow.market.tags",       schemaVersion:2, generatedAt, items:[标签+aliases+count] }
├── authors.json       { spec:"shadow.market.authors",    schemaVersion:2, generatedAt, items:[作者] }
├── licenses.json      { spec:"shadow.market.licenses",   schemaVersion:2, generatedAt, items:[许可+fullText] }
└── resources.json     { spec:"shadow.market.resources",  schemaVersion:2, generatedAt, items:[7 条资源] }
market/data/plugins/
├── builtin-whitelist.json       # 插件类资源的声明式下载物（无可执行代码 / 权限全 false / 白名单）
└── README-builtin-whitelist.txt # 白名单说明（5 步 + 3 个坑）
```

`resources[].versions[0]` 含 `version / packageUrl / sha256 / sizeBytes / compat{shadow,schemaVersion} / changelog / publishedAt / downloads:0 / importFiles{shadowJson,srt,readme}`；
`stats{ sentences, durationSec, words, sizeBytes, sha256 }` 由构建期从包真实计算；课程/字幕的资源还有 `mediaMode:"byom"`、`points:0`、`free:true`、`rights{...}`、`license`、`category`、`author`、`tags`、`platforms`、`requires`。

## 命令

```powershell
# 一条链（推荐）：包 → 导入产物 → catalog → 校验 → 复制到 market/ → 再校验
node tools/catalog/build-all.mjs --now 2026-10-31T15:30:00Z

# 只重建 catalog（前提：包与导入产物已在盘上）
node tools/catalog/build-catalog.mjs --now 2026-10-31T15:30:00Z

# 独立校验（PASS/FAIL + 退出码 0/1）
node tools/catalog/validate-catalog.mjs
node tools/catalog/validate-catalog.mjs --json
node tools/catalog/validate-catalog.mjs --selftest   # 28 个正反例自测
```

`build-all` 的暂存目录在系统临时目录：**任何一步校验失败都不会写入 `market/`**；全部通过后才把
`catalog/`、`data/packages/`、`data/import/`、`data/plugins/` 复制到市场仓库。

## 校验口径（validate-catalog.mjs）

- 6 个 catalog 文件：spec / schemaVersion:2 / generatedAt 一致 / items 类型 / 字段与枚举。
- 引用完整性：`category` / `author` / `license` / `tags` / `type` 必须能在对应文件与 `market/plugins` 白名单中找到。
- 文件一致性：`versions[].sha256` / `sizeBytes` 与真实文件逐一比对；`course/subtitle` 的 `stats` 与包内句子数 / 时长 / 词数一致；`packageUrl` 必须是 market 相对路径。
- 导入产物：`.shadow.json`（r19 工程 lint：clips/媒体名/sentences/无绝对路径与媒体字节/≤2 MiB）、`.srt`（cue 数 = 句数）、`README-<id>.txt`（5 步 + 3 坑 + 媒体名）。
- 插件：`plugins/index.json` + manifest 白名单（manifestVersion 1 / 权限全 false / 无远程 URL / 无脚本字段）；`data/plugins/builtin-whitelist.json` 必须 `executable:false`、`permissions` 全 false、类型集合与登记表一致。
- 纯数据扫描：catalog 任何字符串不得含 `<script>` / `iframe` / `javascript:` / 内联事件 / 本地绝对路径 / `wavPath`。

## 退出码

| 命令 | 0 | 1 |
|---|---|---|
| `validate-catalog.mjs` | 全部 PASS | 任一 FAIL / 读文件失败 / 用法错误 |
| `validate-catalog.mjs --selftest` | 28/28 全部匹配 | 存在不匹配 |
| `build-catalog.mjs` | 生成并回读校验 PASS | 内容源 / 包 / 导入产物 / 校验失败（不写盘） |
| `build-all.mjs` | 全链路 PASS 且 `market/` 已更新 | 任一步失败（`market/` 不写入新产物） |
