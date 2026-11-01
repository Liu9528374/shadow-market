# Lighthouse 证据（移动端 · 自动生成）

> 由 `tools/qa/market/collect-evidence.mjs` 依据 `lighthouse-status.json` 与 `market-mobile-*.report.json` 自动生成，分数为真实报告值，未做任何改写。

- 生成时间：2026-11-01T08:16:02.279Z
- 工具：Lighthouse  · Edge headless · 默认 mobile preset（未使用 --preset=desktop）
- 检测记录：n/a
- 质量门（docs/111 §9）：Performance ≥90、Accessibility ≥90；结论：**PASS**

| 页面 | URL | Performance | Accessibility | Best Practices | SEO | 门槛 |
|---|---|---|---|---|---|---|
| 首页 | `http://127.0.0.1:18991/#/` | 94 | 100 | 100 | 100 | ✅ 达标 |
| 详情页 | `http://127.0.0.1:18991/#/resource/com.shadow.course.cafe-order` | 95 | 100 | 100 | 100 | ✅ 达标 |

原始报告：
- `lighthouse-status.json`
- `market-mobile-1.report.html`
- `market-mobile-1.report.json`
- `market-mobile-2.report.html`
- `market-mobile-2.report.json`

说明：本地静态服务（`market/serve.mjs`）已支持 gzip 与 webmanifest MIME；线上 Cloudflare Pages / GitHub Pages 另有长缓存与压缩。
