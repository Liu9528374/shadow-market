# content/ · 市场内容源（自有内容 · CC-BY-4.0 · 无媒体）

本目录是 SHADOW 市场的**内容源**：市场 catalog v2（`market/catalog/*.json`）与 `.shadowcourse` 包都由
`tools/catalog/build-all.mjs` 从这里读取并生成。所有内容为 SHADOW Studio 自有（`rights.basis = own`），
许可 **CC-BY-4.0**，**不含任何媒体 / 第三方影视素材**；媒体由用户自备（BYOM）。

```
content/
├── market.json               # 站点 / 分类 / 标签 / 作者 / 许可 / 资源顺序（catalog 元数据源）
├── lessons/                  # 课程包句子源（3 个课程，句级时间轴 + 中文翻译 + 教学提示）
│   ├── cafe-order.json
│   ├── asking-directions.json
│   └── interview-intro.json
├── subtitles/                # 字幕包句子源（原创听力字幕，≥8 句）
│   └── daily-listening-b1.json
└── resources/                # 7 条资源元数据（每条一个 JSON：type/分类/标签/许可/平台/changelog…）
    ├── cafe-order.json
    ├── asking-directions.json
    ├── interview-intro.json
    ├── podcast-shadow-daily.json
    ├── movie-scene-byom.json
    ├── daily-listening-b1.json
    └── builtin-whitelist.json
```

## 7 条资源（≥3 类）

| type | id | 说明 |
|---|---|---|
| course | `com.shadow.course.cafe-order` | 咖啡店点单（5 句，B1） |
| course | `com.shadow.course.asking-directions` | 问路（5 句，A2） |
| course | `com.shadow.course.interview-intro` | 面试自我介绍（5 句，B2） |
| course | `com.shadow.course.podcast-shadow-daily` | 播客跟读演示（5 句，原创占位） |
| course | `com.shadow.course.movie-scene-byom` | 影视跟读 BYOM 演示（5 句，原创占位，不含影视素材） |
| subtitle | `com.shadow.subtitle.daily-listening-b1` | 社区图书馆听力字幕（9 句，原创） |
| plugin | `com.shadow.plugin.builtin-whitelist` | 内置插件白名单说明（声明式 JSON，无可执行代码，权限全 false） |

## 编辑约定

- 新增/修改资源：先改 `content/market.json`（分类 / 标签 / 作者 / 许可 / `resourceOrder`）与 `content/resources/<slug>.json`，
  句子源放 `content/lessons|subtitles/`，包源登记在 `tools/shadowcourse/sources/courses.json`。
- `resourceOrder` 必须覆盖且只覆盖 `content/resources/*.json` 的全部 id；资源数 P0 ≥7，类型至少含 course / subtitle / plugin。
- 包内 `title/description/category/tags/level/license/rights` 与资源元数据保持同源；`id` / `version` 必须一致（构建期强校验）。
- 媒体名统一为 `<资源 id>.mp4`（由构建器自动生成到导入产物，资源页 / README 公示）。
- 改完运行：`node tools/catalog/build-all.mjs --now <ISO8601>`，全部 PASS 再提交。

## 版权

- 所有文本 / 翻译 / 句级时间轴：SHADOW Studio 原创，CC-BY-4.0；`rights.basis = own`。
- 不含音频 / 视频 / 图片等媒体；不含第三方影视 / YouTube / 教材内容；用户自备媒体的版权由用户自行负责。
- 插件白名单 JSON：纯声明式数据，不含可执行代码（无 JS / WASM / 二进制 / 脚本字段），权限声明全为 `false`。
