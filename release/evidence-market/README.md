# SHADOW 市场 · Phase 2 P0 证据（release/evidence-market）

> 质量门：`D:\FOLLOWSPEAK\docs\111-market-architecture.md` §9。
> 本目录由 `tools/qa/market/collect-evidence.mjs` 生成/更新；**不提交大录屏/视频**（单文件 >5 MiB 不应入库）。

## 预期内容

| 文件/目录 | 内容 |
|---|---|
| `report-market.json` | Playwright E2E 报告（M0–M9 检查项、失败项、console/pageerror、截图清单、baseUrl/端口） |
| `report-data-contract.json` | catalog v2 数据契约（六文件/引用/sha256+size/importFiles） |
| `report-static-audit.json` | 静态审计（品牌/PWA/离线页/无上传/无可执行插件/合规页/无 CDN/部署配置） |
| `phase2-summary.md` | 汇总：时间/环境/通过-失败数/失败项清单/Lighthouse 状态/console 错误数 |
| `shots/` | 精选截图（首页/详情/移动/PWA 离线/导入成功/合约页等，PNG） |
| `lighthouse/` | Lighthouse 移动端 JSON/HTML 报告（若取得）；不可用时见 `lighthouse-status.json`（如实标注，不伪造分数） |
| `SHA256SUMS.txt` | 证据文件 + 站点 catalog/包/关键产物的 SHA256 清单（供应链完整性） |

## 重新生成

```powershell
# 1) 全量 QA（串行；独立端口 189xx，不碰用户 18765/8765 进程）
powershell -ExecutionPolicy Bypass -File .\tools\qa\market\run-phase2.ps1 -Port 18921

# 2) 仅归档证据（报告/截图已存在时）
D:\NODE\node.exe tools\qa\market\collect-evidence.mjs

# 3) 单独尝试 Lighthouse（网络/二进制不可用会如实写 UNAVAILABLE）
powershell -ExecutionPolicy Bypass -File .\tools\qa\market\lighthouse-run.ps1 -Url http://127.0.0.1:18921/
```

## 说明

- 报告中的 PASS 必须来自实际运行；**失败项如实保留**（报告 `pass=false`，退出码非 0）。
- e2e 的 M3.8/M4.4 成功路径使用本进程临时启动的「假 SHADOW Studio」健康服务验证 `?import=` 深链协议，**不会连接/触碰用户真实进程**（18765–18775 端口被测试路由拦截并记录）。
- Lighthouse 若因 npm 网络不可用/浏览器二进制缺失无法获取，`lighthouse-status.json` 记录 `status:"unavailable"` 与原因；不写入任何虚构分数（docs/111 §10 风险 5）。
