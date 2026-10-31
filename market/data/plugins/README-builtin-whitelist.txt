SHADOW 市场 · 插件白名单说明
====================================================
资源：内置插件白名单 · 声明式说明
ID：com.shadow.plugin.builtin-whitelist
版本：1.0.0
类型：plugin（声明式资源类型）
许可：CC-BY-4.0 · 权利依据 rights.basis = own
下载物：data/plugins/builtin-whitelist.json

【5 步查看 / 核验】
1. 在资源详情页下载「builtin-whitelist.json」。
2. 用任意文本编辑器或 JSON 查看器打开。
3. 检查 executable 为 false，permissions 权限声明全部为 false。
4. 对照类型清单：types[] 与 market/plugins/index.json 的登记完全一致。
5. 检查没有脚本字段、没有远程 URL —— 本文件不含任何可执行代码。

【三个坑】
① 这不是可执行插件：市场只读取声明来渲染类型卡片，不会在浏览器里加载或运行任何插件代码。
② 不提供任意 URL 安装：资源类型只能来自人工审核的白名单（plugins/index.json），P0 没有任意安装入口。
③ permissions 只是声明：P0 没有插件运行时权限系统，权限全 false 也不代表桌面端插件会自动获得授权。

【BYOM】本资源不含媒体；SHADOW 市场不托管、不分发任何影视 / 音乐媒体。
【许可】CC-BY-4.0；可自由分发与改编，需署名 SHADOW Studio。
【校验】node tools/catalog/validate-catalog.mjs
