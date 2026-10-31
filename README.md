# SHADOW 市场（SHADOW MARKET）· 独立 Web 资源站

> 与 **SHADOW STUDIO**（本地跟读工具）并列的第二款产品：全免费的影子跟读资源市场（课程包 / 字幕包 / 插件白名单说明），BYOM（媒体由用户本地自备），不托管影视媒体。
> **两个产品不做在一起**：市场是 Web 资源站；工具不内嵌市场逻辑，市场不内嵌工具逻辑；二者只通过 `.shadowcourse` 资源包与派生导入产物（`.shadow.json` / `.srt`）相遇。

- 产品/决策文档（源真相）：`D:\FOLLOWSPEAK\docs\49`、`docs/52`、`docs/53`、`docs/110`（Phase 0 审计与方案）、`docs/111`（架构）。
- 本仓库是 **Phase 0.5 迁移种子**：从 `D:\FOLLOWSPEAK` master `6056def` 的 `market/`（P0 静态站）+ `tools/shadowcourse/` + `tools/qa/market/` 复制而来，**未重写**；历史文档快照见 `docs/references/`。
- 迁移来源：commit `4c842e3`（市场 P0：113 files, +24,636）与 `6056def`（交付记录 + README 入口）。

## 1. 快速开始（本地预览）

```bash
node market/serve.mjs
# → http://127.0.0.1:18920/（被占用时自动 +1..+20）
```

数据前提（由打包器生成，不要手改）：

```bash
node tools/shadowcourse/build-packages.mjs            # 生成 5 个示例包 + catalog
node tools/shadowcourse/validate.mjs --dir market/data/packages   # 应 PASS 5 / FAIL 0
```

## 2. 目录结构（种子现状）

```
market/                  # P0 独立静态站（纯 HTML/CSS/ESM，无构建/无 CDN/无后端）
  index.html
  assets/{styles,js}/    # tokens.css + app.css + 原生 ES Modules
  data/{catalog.json,packages/*.shadowcourse}
  plugins/{index.json,<type>/manifest.json}
  serve.mjs              # 零依赖本地静态服务
tools/shadowcourse/      # 课程包校验器 / 打包器 / 源描述
tools/qa/market/         # 市场独立 QA（E2E / 静态审计 / 数据契约）
docs/references/         # 迁移时点的 52/53/54 文档快照（以 FOLLOWSPEAK 为准）
```

## 3. 边界与红线（不可违反）

- 全免费：不做支付/分账/抽成/发票/退款/DRM/复杂审核；积分免费获取、不可购买/转让/提现。
- BYOM：不托管影视媒体、不上传用户媒体、不提供站内视频播放；课程包 0 媒体/0 二进制。
- 版权：只允许自有/授权/公版/CC；每资源 `license` + `rights.basis`；保留投诉-下架。
- 无强制登录；P0 无账号后端；P1 邮箱验证码。
- 「一切即插件」= P0/P1 **声明式资源类型清单**，不加载执行插件代码；未知类型降级通用卡。
- 不改 SHADOW STUDIO（r19）桌面产物/桌面红线；本次为独立仓库。

## 4. 下一步（Phase 2 · P0 见 `docs/110`/`docs/111`）

- [ ] 修 M3.8（产品成功态检测 + E2E 时序）→ 市场 E2E 43/43
- [ ] catalog v2（`sizeBytes/sha256/versions/changelog`）+ schema 校验
- [ ] 字幕包 + 插件白名单说明示例资源（≥3 类）
- [ ] 移动优先 / PWA 离线 / 中英 / 收藏 / 投稿 / 关于 / 隐私 / 版本变更页
- [ ] `.shadow.json` + `.srt` 导出器与导入说明（r19 免改导入）
- [ ] E2E / Lighthouse / 部署（Cloudflare Pages 演示）/ 证据 `release/evidence-market/`

## 5. 许可

- 市场站点代码与官方示例资源：见各文件/包内许可声明；默认 **CC-BY-4.0**（官方课程包）与项目许可保持一致。
- 不包含任何第三方影视媒体；第三方组件见 `THIRD_PARTY_NOTICES`（如后续引入）。
