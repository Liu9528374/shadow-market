# design/skills · 设计 Skill 与规则提炼（GitHub 下载 · 2026-11-01）

> 用途：为 SHADOW 市场 UI 重设计（`design/DESIGN-BRIEF.md` · Obsidian & Amber）提供**可执行的设计规则**。
> 下载方式：raw.githubusercontent.com / GitHub API / npm registry，全部经本机代理 `http://127.0.0.1:7897`；**未整仓克隆、未下载 node_modules**。
> 许可清单与文件级明细见 `design/assets/INVENTORY.md` 与 `design/assets/LICENSES/`。

## 0. 一句话结论

7 份 skill 文档 + 1 份资源索引已入库；我们吸收的是**规则与检查清单**（不是视觉风格）：反模板默认、单一记忆点、字阶/留白/颜色纪律、8 态控件、动效硬约束、无障碍底线、两遍式自评。它们与 DESIGN-BRIEF §2/§6/§9 高度一致，下文第 2 节给出 15 条可执行规则及对应 Brief 条款。

## 1. 下载清单（来源 · 许可 · 体量）

| # | Skill / 文档 | 来源 | License | 本地路径 | 大小 | 采用方式 |
|---|---|---|---|---|---|---|
| 1 | **anthropics/skills → frontend-design** | https://github.com/anthropics/skills/tree/main/skills/frontend-design | Apache-2.0 | `anthropics-skills/frontend-design/`（SKILL.md + LICENSE.txt） | 9.4 KB | 规则：反模板、字样/文案、单一记忆点、两遍式批评 |
| 2 | **anthropics/skills → brand-guidelines** | 同仓库 /brand-guidelines | Apache-2.0 | `anthropics-skills/brand-guidelines/` | 2.2 KB | 规则：品牌色/字体角色固定成 token（不采用 Anthropic 配色） |
| 3 | **anthropics/skills → canvas-design** | 同仓库 /canvas-design | Apache-2.0 | `anthropics-skills/canvas-design/` | 11.9 KB | 规则：视觉哲学先行、空间叙事、少字；用于 hero / 声波母题 |
| 4 | **anthropics/skills → theme-factory** | 同仓库 /theme-factory | Apache-2.0 | `anthropics-skills/theme-factory/`（含 themes/*.md ×10） | 3.1 KB + 5.4 KB | 结构参考：主题=4–6 色 + 字体配对 + 适用场景；其紫/蓝主题按 Brief §2 禁用 |
| 5 | **nextlevelbuilder/ui-ux-pro-max-skill** | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill | MIT | `ui-ux-pro-max-skill/`（SKILL.md、pro-rules、quick-reference、README、LICENSE） | 90.3 KB | 规则：10 类优先级矩阵、8 态控件、交付前 checklist |
| 6 | **Nutlope/hallmark**（anti-AI-slop design skill） | https://github.com/Nutlope/hallmark | MIT | `hallmark/`（SKILL.md、craft/layout/patterns/interaction/dark-mode/gates、themes 索引） | 128.1 KB | 规则：Floor 硬约束（token/动效/焦点/overflow）、hero 首屏、gates 自检 |
| 7 | **alchaincyf/huashu-design**（花叔 Design） | https://github.com/alchaincyf/huashu-design | MIT | `huashu-design/`（SKILL.md、README、LICENSE） | 45.8 KB | 规则：先出 3 个方向再执行、反 AI 默认审美、工作室角色分工 |
| 8 | **brandonhimpfen/awesome-design**（资源索引） | https://github.com/brandonhimpfen/awesome-design | 无 LICENSE（仅索引） | `awesome-design.md` | 7.1 KB | 只作资源索引；不随产品分发 |

下载时的 commit（HEAD）：
`anthropics/skills @ ca45fc496a3436251f191354091d557da31c15b5`（4 个 skill 目录各自带 Apache-2.0 LICENSE.txt）、
`ui-ux-pro-max-skill @ bf41cbc3ce63e30c922e58ef48741ba6133f9aa9`、
`hallmark @ 4f6a46c6dc325d40ab268c93e25c7b96676ebccd`、
`huashu-design @ 9b01ee8751679724dd43d855a532944aaa2c2b59`、
`awesome-design @ d48158e2617f6454a5ae7d660a6d5bf7e1ca79f8`。

> ⚠️ anthropics/skills 仓库级 LICENSE 为 null（无统一许可），但 4 个 skill 目录内各带 `LICENSE.txt`（Apache-2.0），已随目录保存。
> ⚠️ awesome-design 仓库无 LICENSE：因此只保存 README 作**离线索引**，不复制其中任何素材、不随产品分发。

## 2. 提炼：15 条可执行设计规则（已对照 DESIGN-BRIEF）

> 规则来自上述 skill 的共性约束 + DESIGN-BRIEF 拍板方向；括号内为来源与 Brief 对应条款。**P0 mockup/重设计必须逐条可检查**。

1. **把胆量花在一个地方**：每屏只有 1 个「记忆点」（工作台 = 问候语 + 数据 tile；市场 = 进入市场大卡；详情 = Hero），其余保持安静克制；不自证「有设计」，砍掉不服务 brief 的装饰。（frontend-design §Restraint；Brief §2/§7）
2. **禁掉模板默认**：不得出现「暖奶油底 + 高反差衬线 + 陶土橙」「近黑底 + 酸性绿/朱红单强调」「所有卡片同一圆角同一柔灰阴影」「每段标题上全大写 eyebrow」「meta 用 · 连接」「链接文字后粘 →」「emoji 当图标」「紫→蓝渐变」。（frontend-design §calibration + hallmark Floor；Brief §2 反模板）
3. **字阶必须可见 ≥4 级**：display/h1/h2/body/micro 差异明确；正文 ≥14px（建议 16px）、行高 ≥1.5、行宽 <80ch；全站 ≤2 个字族；标签/表头/导航用正文字族小一号、句首大写、不加大字距；标题里不得只有一两个词变斜/变色。（frontend-design §Type + hallmark Floor 9；Brief §6.2）
4. **间距与容器有唯一节奏**：4 基数（4/8/12/16/24/32/48/64），区块间 32，卡片内 20–24；页面最大宽 1440、外边距 32，内容容器居中且到 1920 只增 gutter 不增内容宽；一屏 ≤2 种容器类型。（Brief §5/§6.3 + hallmark 14 + 一屏一主意）
5. **颜色纪律 = 琥珀 + 中性 + 1 个状态色**：所有颜色经 `:root` token；正文对比 ≥4.5:1、非文字 ≥3:1；一个主 CTA 用强调色，状态色不铺满；深色/浅色分别调对比，不直接复用。（Brief §6.1 + hallmark Floor 1 + ui-ux Priority 1）
6. **边框与嵌套减法**：默认无边框卡片（表面色差 + 阴影分层）；只有可交互控件出现边框；禁止 card-in-card；圆角按层级（控件 10 / 卡片 16 / 大卡 20 / 头像圆）。（Brief §2/§6.4 + hallmark Floor 11）
7. **交互 8 态齐全**：default / hover / active / focus-visible（立即可见，不用 outline:none）/ disabled / loading / error / selected；焦点环 `2px var(--amber)` + offset 2；触控目标关键 ≥44×44（最小 ≥24）。（ui-ux pro-rules + hallmark Floor 6；Brief §6.3/7.4）
8. **动效硬约束**：160ms `cubic-bezier(.2,.7,.2,1)`；只动 `transform`/`opacity`；**禁止 `transition: all`**，禁止动 width/height/top/left；全站最多 1 个编排式入场，不做「每节 fade-and-slide-up + 每卡 hover 位移」；`prefers-reduced-motion` 全关且内容默认可见。（hallmark Floor 2/7 + Brief §6.3）
9. **文案即界面**：主动语态、同一动作全流程同名（「下载导入」→ toast「已下载」）；空态/错误给方向而非情绪（空屏=邀请行动）；不写「提交」写「保存更改」；不编造 metric/证言/logo 墙。（frontend-design §Writing + hallmark Floor 8；Brief §7）
10. **Hero / 首屏规则**：1280×800 内可见标题 + 一句说明 + 主 CTA；标题 ≤7 词（≤50 字符）、说明 ≤12 词、1–2 个动作；每屏文案约 ≤80 词；全页 1 个 h1。（hallmark 12/13；Brief §9）
11. **一屏一主意 + 容器预算**：左栏 ≤7 项、右栏 ≤4 卡、主区同时 ≤2 种容器；页面 6–9 个区块（含 header/footer）即可，丰满来自尺度与真实内容，不靠堆模块/堆字。（hallmark 134 + Brief §9）
12. **图标系统统一**：只用 SVG（本项目 = `design/assets/icons/` Lucide 子集），禁止 emoji/位图图标；尺寸 16/18/24，stroke 一致；纯装饰 `aria-hidden="true"`，icon-only 按钮必须有 `aria-label`。（ui-ux Priority 4 + Brief §8）
13. **无障碍底线（WCAG 2.2 AA）**：landmark/标题层级/列表语义；键盘可达 + skip-link + 焦点不被遮挡；英文句子 `lang="en"`；状态区用 `aria-live` 而整页不播报；Tabs/命令面板方向键 + `aria-controls`；深浅主题都过对比。（ui-ux Priority 1 + Brief §7.4/§9）
14. **响应式只做移动优先**：360/375/390/768/1024/1440 无页面级横溢（`overflow-x: clip`，禁 `100vw`）；网格轨 `minmax(0,1fr)`；市场筛选 chips 单行横滑（不得三行）；bottom nav ≤5 项；详情操作吸底。（hallmark Floor 4/5 + Brief §7.7）
15. **真实内容 + 两遍自评**：mockup 用真实 catalog 7 条数据与真实文案，不占位 Lorem/假数字；先出方案→对照 brief 批评→再写代码；交付前按 checklist 过一遍（对比度/焦点/横溢/主题切换/空态/错误态），并做「拿掉一件配饰」删减。（frontend-design §Process + ui-ux Pre-Delivery Checklist + Brief §9）

## 3. 在 mockup 里怎么用这些素材

```css
/* Inter（本目录 design/assets/fonts/，相对路径按页面位置调整） */
@font-face{font-family:Inter;src:url("../../assets/fonts/InterVariable.woff2") format("woff2-variations");font-weight:100 900;font-style:normal;font-display:swap}
@font-face{font-family:Inter;src:url("../../assets/fonts/Inter-Regular.woff2") format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"JetBrains Mono";src:url("../../assets/fonts/JetBrainsMono-Regular.woff2") format("woff2");font-weight:400;font-display:swap}
```

```html
<!-- 图标：内联 design/assets/icons/<name>.svg 的 <svg> 内容；或 mockup 构建期读取 -->
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><!-- lucide path --></svg>
```

- 颜色/间距/阴影：**不要直接引 reference CSS**（radix / open-props / modern-normalize 仅作离线参考，Lead 的 `design/mockups/styles/tokens.css` 是唯一事实源）。
- 主题参考：`anthropics-skills/theme-factory/themes/*.md` 展示「4–6 色 + 字体配对 + 适用场景」的描述格式，可照格式补充 Obsidian & Amber 的设计说明；其中紫/蓝主题与 Brief §2 冲突，禁用。
- 自检清单：`hallmark/hallmark/references/gates.md`（Floor + 交付前 gates）、`ui-ux-pro-max-skill/ui-ux-pro-max/references/pro-rules.md`（8 态 + Pre-Delivery Checklist）。
- 反模板校准：`anthropics-skills/frontend-design/SKILL.md` §calibration 与 `hallmark/hallmark/SKILL.md` §The Floor 是最快的「AI 味」排查表。

## 4. 未采用 / 明确不做

- **Anthropic 品牌色/字体（brand-guidelines 的 `#d97757` + Poppins/Lora）**：只借「品牌规范结构」，不借其视觉身份（避免与他人品牌混淆）。
- **theme-factory 的 10 套主题**：紫/蓝系与本项目 Obsidian & Amber 冲突，仅当主题描述模板参考。
- **canvas-design 的 canvas-fonts/（约 6 MB TTF）与 theme-showcase.pdf**：体积/用途不符，未下载。
- **Hallmark 的 sloplint/render 脚本、huashu 的 python 脚本**：本阶段是设计稿（纯 HTML/CSS），不引入执行脚本；规则直接人工执行。
- **awesome-design 中的外部素材**：仅作索引，未下载任何第三方素材。
