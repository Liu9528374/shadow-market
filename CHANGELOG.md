# SHADOW 市场 · CHANGELOG

## 0.1.0 · 2026-10-31（Phase 0.5 迁移种子，未发布）

- 从 `D:\FOLLOWSPEAK` master `6056def` 迁移市场 P0 种子（来源 `4c842e3` / `6056def`）：
  - `market/` 独立静态站（GitHub 式 IA：探索/搜索/分类/作者/详情 Tabs/设置/深浅色/Ctrl+K/本地积分演示/404；零构建、零依赖、无 CDN）
  - `tools/shadowcourse/` 课程包校验器（selftest 35/35）与打包器（5 个 BYOM 示例包 PASS 5/0）
  - `tools/qa/market/` 市场独立 QA（E2E 43 项 / 静态审计 / 数据契约）
  - `docs/references/` 迁移时点的 52/53/54 文档快照
- 说明：本种子未包含上一轮未提交的桌面导入 WIP（`prototype/index.html` 等，属 SHADOW STUDIO 仓库）；P0 导入路径按 `docs/111 §5` 走 `.shadow.json` + `.srt` 免改工具方案。
- 未完成（Phase 2）：M3.8 修复、catalog v2 + SHA256、≥3 类示例资源、移动优先/PWA/中英、新页面、E2E/Lighthouse/部署。
