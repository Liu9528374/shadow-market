# tools/import · 派生导入产物（`.shadow.json` / `.srt` / README）

P0 导入路径（`docs/111-market-architecture.md` §5.2–5.4，不改 SHADOW Studio r19 代码）：
每个课程包 / 字幕包生成 **3 个导入产物**，用户下载后在本地工具打开；媒体由用户自备（BYOM）。

```
.shadowcourse（规范载体） → market/data/import/
   ├── <id>.shadow.json   r19 工程 JSON（主路径，唯一带中文翻译）
   ├── <id>.srt           SRT 句级字幕（备选，无翻译）
   └── README-<id>.txt    导入说明（5 步 + 3 个坑，逐字可复制）
```

> 纯 Node（≥18）零依赖；写盘前先在内存生成全部产物并跑 lint，任何失败 → 不写任何文件；写盘后回读再 lint。

## 命令

```powershell
# 生成全部导入产物（默认读 market/data/packages，写 market/data/import）
node tools/import/build-shadow-json.mjs

# 只校验已生成产物（不写盘）
node tools/import/build-shadow-json.mjs --check
# 等价独立入口
node tools/import/validate-import.mjs

# 固定生成时间可复现
node tools/import/build-shadow-json.mjs --now 2026-10-31T15:30:00Z --json

# 指定目录（构建链 / 测试用）
node tools/import/build-shadow-json.mjs --packages <packagesDir> --out <importDir>
```

## `.shadow.json` 规范速查（r19 工程 JSON）

```jsonc
{
  "app": "SHADOW STUDIO",
  "version": 1,
  "savedAt": "<catalog generatedAt>",
  "projectName": "<资源标题>",
  "clips": [{
    "id": "clip_<包 id>",
    "name": "<包 id>.mp4",          // ASCII 媒体名（课程页 / README 三处逐字一致）
    "size": 0, "type": "video/mp4", "kind": "video",
    "duration": <max(end) + 1.5>,
    "resolution": "—", "segmentation": "subtitle",
    "sentences": [{ "start", "end", "en", "zh", "words", "linking": "", "tip": "", "score": null }],
    "units": [], "peaks": [], "thumb": null, "subtitle": null, "assSubtitle": null,
    "asrSegments": [], "asrSentences": [], "asrMeta": null, "asrTranscribedAt": 0, "asrStale": false
  }],
  "scores": {},
  "recordings": {}
}
```

**lint 规则**（`build-shadow-json.mjs` 内置）：`clips` 数组 ≥1、`clip.id` 唯一稳定、`clip.name` 唯一 ASCII（字母/数字/._-，无空格）、`kind` video/audio、`duration > 0`、`sentences ≥1`、`start/end` 数字且 `end > start` 升序、`en` 非空；**禁止**本地绝对路径、`wavPath`、媒体字节 / base64 / data: 媒体、脚本 / 内联事件；单文件 ≤ 2 MiB。

## SRT

- 句级 cue：`HH:MM:SS,mmm --> HH:MM:SS,mmm`，UTF-8 无 BOM，无中文翻译。
- 用途：用户先导入媒体（文件名任意）→ `File → Import Subtitle…` → 建句。

## README-<id>.txt（用户可见，5 步 + 3 坑）

1. 下载工程文件（推荐）→ 2. 打开 SHADOW STUDIO（≥0.7.0）→ 3. `File → Open Project…`（Ctrl+O）→
4. 把自备媒体重命名为 `<包 id>.mp4` 拖入窗口 → 5. 播放 / 跟读（数据全在本机）。
> 坑：① 媒体名逐字一致；② 不要点 Analyze / Generate Subtitles；③ 媒体必须与时间轴同源。
> 另附：`.srt` 备选路径、`.shadowcourse` 规范包说明、授权与 BYOM 合规、校验命令。

## 退出码

| 命令 | 0 | 1 |
|---|---|---|
| `build-shadow-json.mjs` | 生成并回读 lint 全部 PASS | 包校验 / lint 失败（不写盘） |
| `build-shadow-json.mjs --check` | 全部产物存在且 lint PASS | 缺失文件 / lint FAIL |
| `validate-import.mjs` | 同上（独立入口） | 同上 |
