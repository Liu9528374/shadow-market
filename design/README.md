# SHADOW 市场 · Design Package（Obsidian & Amber）

> 2026-11-01｜UI 重设计交付包（**设计阶段完成，产品代码未改动**）
> 用户要求：学习 5 个网站布局（要美感）；进站首先是个人界面（像 GitHub）；右侧栏进入市场；去 GitHub 搜索并下载设计 skill/素材后再动手。

## 1. 怎么看

- **设计稿**：浏览器打开 `mockups/index.html`（个人工作台）、`market.html`、`resource.html`、`library.html`、`points.html`、`contribute.html`、`mobile-home.html`、`mobile-market.html`；任意页加 `?theme=light` 看浅色。
- **截图（16 张）**：`screenshots/`（1440×900 深/浅 + 390×844 深/浅）。
- **规范**：`DESIGN.md`（完整）；方向 brief：`DESIGN-BRIEF.md`；研究：`research/`；skill：`skills/`；素材与许可：`assets/INVENTORY.md`。

## 2. 设计系统

- `mockups/styles/tokens.css`：颜色/字阶/间距/圆角/阴影/动效/焦点（深「黑曜石」+ 浅「暖纸」）。
- `mockups/styles/base.css`：顶栏/左栏/右栏/卡片/按钮/资源卡/Hero/Tabs/列表/空态/移动底栏等组件。
- 页面级样式：`pages-dashboard.css`（Lead）、`pages-market.css`、`pages-personal.css`。
- 字体：`assets/fonts/`（InterVariable + JetBrains Mono，OFL-1.1）；图标：`assets/icons/`（Lucide 43 个，ISC）。

## 3. 关键数字

| 项 | 值 |
|---|---|
| 容器/栅格 | 内容 1360、页边 40、header 64、左栏 248、主列 744、右栏 320、gap 24 |
| 字阶 | display 34 / h1 28 / h2 22 / h3 17 / body 14 / small 13 / micro 12（11 仅 uppercase 标签） |
| 密度预算 | 渲染色 ≤14、字号档 ≤7、带边框元素 ≤30（非交互 ≤10）、pill ≤12、容器类型 ≤2、主 CTA 1、右栏块 ≤3、移动首卡 y≤480 |
| 对比度 | 全页深/浅实测 0 失败（WCAG AA 正文 4.5:1） |
| 独立评审 | 加权 3.77/5（通过线 3.6）、5 红线 0 触发；S1 4 项已修，S2/S3 留实施时收口 |

## 4. 设计取舍

- 默认**深色**（与 Voice Wave 图标同源）；浅色为「暖纸」，不是冷白。
- 「进入市场」是全站**唯一渐变面**；市场页镜像「进入工作台」同尺寸卡。
- 无边框卡片 + 单一阴影；边框只给可交互控件；强调色只琥珀。
- 详情页 H1 唯一、徽标 ≤3；下载导入统一放右栏决策卡；文件 Tab 只做核对清单。
- 不采用第三方插画（open-peeps 系无明确许可），改用 CSS/SVG 声波母题。

## 5. 素材来源（GitHub，全部可追溯）

| 内容 | 来源 | License |
|---|---|---|
| 设计 skill | anthropics/skills（frontend-design 等 4 个）、ui-ux-pro-max-skill、hallmark、huashu-design、awesome-design 索引 | Apache-2.0 / MIT（逐项见 `skills/README.md`） |
| 图标 | lucide-icons/lucide ×43 | ISC |
| 字体 | rsms/inter（Inter）、JetBrains Mono | OFL-1.1 |
| 参考 | radix-ui/colors、argyleink/open-props、modern-normalize | MIT |

完整 commit/文件/大小/是否随产品分发：`assets/INVENTORY.md`；许可原文：`assets/LICENSES/`。无 GPL / 来源不明素材。
