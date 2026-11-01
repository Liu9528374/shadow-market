# design/assets · 素材清单与许可（INVENTORY）

> 用途：SHADOW 市场 UI 重设计（`design/DESIGN-BRIEF.md` · Obsidian & Amber）的设计 skill 与开源素材。
> 下载：2026-11-01，经本机代理 `http://127.0.0.1:7897`；GitHub raw / GitHub API / npm registry tarball；**未整仓克隆、未下载 node_modules**。
> 规则：只接受 MIT / OFL-1.1 / CC0 / Apache-2.0 / ISC 等级宽松许可；**无 GPL**；来源与 commit 全部可追溯。

## 0. 总量与验证

| 范围 | 文件数 | 大小 |
|---|---|---|
| `design/skills/**`（skill 文档 + 许可证） | 40 | 416,496 B（约 407 KB） |
| `design/assets/**`（含本清单与 illustrations/README） | 79 | 1,074,769 B（约 1,050 KB） |
| **合计** | **119** | **1,491,265 B ≈ 1.42 MiB**（预算 ≤30 MB，✅ 远低于上限） |

验证（2026-11-01，脚本/命令实测）：
- 字体 7 个 `.woff2` 文件头均为 `wOF2`（Inter ×5、JetBrains Mono ×2），大小 92,380–352,240 B。
- 图标 43 个 `.svg` 全部可被 XML 解析（`[xml]` 强校验 0 失败）、非 0 字节、以 `<svg` 开始且含 `</svg>`。
- 参考 CSS 16 个文件均非 0 字节；LICENSES 11 个文件均非 0 字节。
- 未引入任何 GPL / 来源不明素材；`.gitignore` 等无关文件未下载。

## 1. 设计素材（随产品分发：是）

### 1.1 图标 · Lucide

| 项 | 值 |
|---|---|
| 来源 | https://github.com/lucide-icons/lucide |
| 下载方式 | raw.githubusercontent.com（按 HEAD 固定） |
| commit | `a630cec77eac6568b989e87e4947a8bfe45caacd` |
| License（SPDX） | **ISC**（`design/assets/LICENSES/lucide.txt`；源码头部为 `ISC License`） |
| 文件 | `design/assets/icons/*.svg` ×43，合计 15,178 B |
| 用途 | mockup / 产品内联 SVG 图标（Brief §8 指定） |
| 随产品分发 | **是**（ISC 允许商用/分发，保留版权与许可声明即可） |

> ⚠️ 任务书写「lucide（MIT）」，但仓库当前 LICENSE 实际为 **ISC**（与 MIT 同为宽松许可、要求保留版权声明；可商用/可分发）。如需严格限制在 MIT/OFL/CC0/Apache-2.0 白名单内，可换 Tabler Icons（MIT）——目前按任务指定保留 Lucide 并在许可清单如实标注 ISC。

图标清单（43）：`home compass search star download upload settings sun moon arrow-right arrow-left book-open file-text clock sparkles chevron-down plus x menu user check external-link tag layers gift shield heart play pause folder grid list filter rotate trash help-circle info mail link eye copy terminal zap`。

Lucide 现版本更名映射（本地文件已用「任务要求的文件名」保存，内容取对应新图标）：
`home→house` · `grid→grid-2x2` · `filter→funnel` · `rotate→rotate-cw` · `help-circle→circle-question-mark`（其余同名）。

### 1.2 字体 · Inter（拉丁正文/标题）

| 项 | 值 |
|---|---|
| 来源 | https://github.com/rsms/inter |
| 下载方式 | raw.githubusercontent.com `docs/font-files/*.woff2` |
| commit | `353b61b9f4430d5f420d56605a6e7993e0941470`（release v4.1 同源字体文件） |
| License（SPDX） | **OFL-1.1**（`design/assets/LICENSES/inter.txt`） |
| 文件 | `InterVariable.woff2` 352,240 B；`Inter-Regular.woff2` 111,268 B；`Inter-Medium.woff2` 114,348 B；`Inter-SemiBold.woff2` 114,812 B；`Inter-Bold.woff2` 114,840 B（合计 808 KB） |
| 用途 | Brief §6.2 拉丁字体：正文 400 / 标题 600；可变字体优先 |
| 随产品分发 | **是**（OFL-1.1 允许嵌入/分发；不单独售卖字体，保留许可文本） |

### 1.3 字体 · JetBrains Mono（数字/代码，可选）

| 项 | 值 |
|---|---|
| 来源 | https://github.com/JetBrains/JetBrainsMono |
| 下载方式 | raw.githubusercontent.com `fonts/webfonts/*.woff2` |
| commit | `19371302b95d218af43299bce79ddbddd0bc364d` |
| License（SPDX） | **OFL-1.1**（`design/assets/LICENSES/jetbrains-mono.txt`） |
| 文件 | `JetBrainsMono-Regular.woff2` 92,380 B；`JetBrainsMono-Medium.woff2` 94,284 B（合计 182 KB） |
| 用途 | 数字/统计 tabular-nums、代码块、SHA256 等 |
| 随产品分发 | **是**（OFL-1.1） |

## 2. 参考素材（随产品分发：否，仅离线参考）

> 只用于设计阶段对照 token/间距/色阶，**不直接引用进 mockup 或产品**；产品色值以 Lead 的 `design/mockups/styles/tokens.css` 为准。

| 资源 | 来源 | License | commit/tag | 文件 | 用途 |
|---|---|---|---|---|---|
| **radix-ui/colors** | https://github.com/radix-ui/colors ；npm `@radix-ui/colors@3.0.0` tarball | **MIT**（`LICENSES/radix-colors.txt`） | repo `dbdb85470547c7d34b9001f48fddb08ded335979`；npm 3.0.0 | `reference/radix-colors/*.css` ×6（gray / gray-dark / gray-alpha / amber / amber-dark / amber-alpha，合计 6.3 KB） | 暗色/浅色灰阶与琥珀 alpha 阶参考 |
| **argyleink/open-props** | https://github.com/argyleink/open-props | **MIT**（`LICENSES/open-props.txt`） | `f39ab7c377a0e047f930982e3611bbc95254a260` | `reference/open-props/` 8 个 CSS（colors/fonts/easing/borders/sizes/shadows/zindex/index）+ README，合计 25.5 KB | 间距/缓动/阴影/字号比例参考 |
| **modern-normalize** | https://github.com/sindresorhus/modern-normalize | **MIT**（`LICENSES/modern-normalize.txt`） | `076c61bd806ba4770a8d766d8e63903e4fb0dfa6` | `reference/modern-normalize.css` 3.4 KB | 跨浏览器 reset 参考（mockup 用自有 base.css） |

> radix 仓库 GitHub HEAD 已改为 TS 源（`src/light.ts`/`dark.ts`，无 CSS）；为保证「CSS 文件」要求，取其在 npm 发布的同版本官方产物 `@radix-ui/colors@3.0.0` 的 CSS（MIT，作者同源），并在上表同时记录 repo commit 与 npm 版本。

## 3. 插画 / 纹理（未下载 · 按 Brief 改用 CSS）

- **插画/空态**：检索 `open-peeps` 等插画包（GitHub API 搜索 2026-11-01）：`opeepsfun/open-peeps`、`CeamKrier/peeps-generator` 等均**无 LICENSE 声明**；`hello-efficiency-inc/openpeeps-generator` 是 MIT **生成器**（不是插画素材）。为规避来源不明素材，**不使用第三方插画**；按 Brief §2/§6.4 改用 **CSS/SVG 声波母题 + 线稿空态**（`design/assets/icons/` 的 Lucide 图标可组合）。
- **纹理/图案**：按任务「优先 CSS 生成」，**不下载 hero-patterns**；声波纹理由 CSS `repeating-linear-gradient` / 内联 SVG 生成。
- `design/assets/illustrations/` 目录保留为空（占位），如后续用户提供插画再放入。

## 4. 设计 Skill 文档（随产品分发：否，仅内部设计参考）

| 目录 | 来源 | License | commit | 文件数 / 大小 | 用途 |
|---|---|---|---|---|---|
| `design/skills/anthropics-skills/` | https://github.com/anthropics/skills | 仓库级无统一 license；4 个 skill 目录各带 **Apache-2.0** `LICENSE.txt`（`LICENSES/anthropics-skills.txt` 为说明+代表许可） | `ca45fc496a3436251f191354091d557da31c15b5` | 20 文件 / 124.9 KB | frontend-design / brand-guidelines / canvas-design / theme-factory 规则提炼 |
| `design/skills/ui-ux-pro-max-skill/` | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill | **MIT**（`LICENSES/ui-ux-pro-max-skill.txt`） | `bf41cbc3ce63e30c922e58ef48741ba6133f9aa9` | 5 文件 / 90.3 KB | UI/UX 规则优先级、8 态控件、交付 checklist |
| `design/skills/hallmark/` | https://github.com/Nutlope/hallmark | **MIT**（`LICENSES/hallmark.txt`） | `4f6a46c6dc325d40ab268c93e25c7b96676ebccd` | 10 文件 / 128.1 KB | 反 AI 味硬约束（Floor）、布局/工艺/gates 自检 |
| `design/skills/huashu-design/` | https://github.com/alchaincyf/huashu-design | **MIT**（`LICENSES/huashu-design.txt`） | `9b01ee8751679724dd43d855a532944aaa2c2b59` | 3 文件 / 45.8 KB | 先出 3 方向再执行、反默认审美、工作室分工 |
| `design/skills/awesome-design.md` | https://github.com/brandonhimpfen/awesome-design | **无 LICENSE**（`LICENSES/awesome-design-NO-LICENSE.txt` 说明） | `d48158e2617f6454a5ae7d660a6d5bf7e1ca79f8` | 1 文件 / 7.1 KB | 仅离线资源索引；不随产品分发 |
| `design/skills/README.md` | 本仓库自述 | — | — | 规则提炼 + 采用说明 | 15 条可执行设计规则 |

## 5. 许可文件索引（`design/assets/LICENSES/`）

| 文件 | 对应资源 | SPDX |
|---|---|---|
| `lucide.txt` | Lucide Icons | ISC |
| `inter.txt` | Inter | OFL-1.1 |
| `jetbrains-mono.txt` | JetBrains Mono | OFL-1.1 |
| `radix-colors.txt` | @radix-ui/colors | MIT |
| `open-props.txt` | Open Props | MIT |
| `modern-normalize.txt` | modern-normalize | MIT |
| `anthropics-skills.txt` | anthropics/skills（说明 + 代表许可） | Apache-2.0（逐 skill） |
| `ui-ux-pro-max-skill.txt` | ui-ux-pro-max-skill | MIT |
| `hallmark.txt` | Hallmark | MIT |
| `huashu-design.txt` | huashu-design | MIT |
| `awesome-design-NO-LICENSE.txt` | awesome-design | 无许可（仅索引，不分发） |

各 skill 自身目录内还保存有原始 `LICENSE.txt` / `LICENSE`（如 `anthropics-skills/*/LICENSE.txt`）。

## 6. 风险与注意

1. **Lucide 实际为 ISC 而非任务写的 MIT**：同为宽松许可、可商用可分发，已按事实登记；若产品法务要求严格白名单，可换 Tabler Icons（MIT）——图标数量与风格接近，替换只影响 `design/assets/icons/`。
2. **anthropics/skills 仓库级无 LICENSE**：不可把该仓库整体当 Apache-2.0 分发；本目录只保存 4 个 skill 的文档+各自 LICENSE，且仅内部参考、不随产品分发。
3. **awesome-design 无 LICENSE**：只保留 README 索引，未复制任何素材。
4. **字体是「随产品分发」项**：若最终产品内嵌 Inter / JetBrains Mono，需在「关于/许可」页列出 OFL-1.1 与作者版权行（OFL 允许嵌入与再分发，禁止单独售卖字体本身）。
5. **参考素材（radix/open-props/modern-normalize）仅离线参考**：mockup 不要 `@import`，避免把第三方 CSS 带进产品构建。
6. 未下载任何整仓、node_modules、字体大包（Inter release zip 33.7 MB 未下载，改用 repo 内 woff2 原始文件）。
