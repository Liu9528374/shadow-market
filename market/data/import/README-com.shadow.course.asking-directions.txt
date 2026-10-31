SHADOW 市场 · 导入说明（READ ME FIRST）
====================================================
资源：问路去火车站
ID：com.shadow.course.asking-directions
版本：1.0.0
内容：5 句 · 时间轴 0–13.5 秒 · 英文原句 + 中文翻译
许可：CC-BY-4.0（文本 / 翻译 / 时间轴；不含媒体）
媒体名（必须逐字一致）：com.shadow.course.asking-directions.mp4

【5 步导入 · 推荐路径 .shadow.json】
1. 在市场详情页下载工程文件「com.shadow.course.asking-directions.shadow.json」（推荐：自带中文翻译）。
2. 打开 SHADOW STUDIO（工具版本需 >= 0.7.0）。
3. 菜单 File → Open Project…（Ctrl+O），选择刚下载的「com.shadow.course.asking-directions.shadow.json」。
4. 把你自备的英语音视频重命名为「com.shadow.course.asking-directions.mp4」，直接拖入 SHADOW STUDIO 窗口完成媒体绑定。
5. 按句播放 / 跟读练习；所有数据保存在本机，市场不会上传任何内容。

【三个坑（务必看）】
① 媒体文件名必须与「com.shadow.course.asking-directions.mp4」逐字一致（含大小写与扩展名）；不一致时工具会新建重复 clip，句子不会自动对齐。
② 打开工程后不要点 Analyze / Generate Subtitles：这会重新分析并把包内句子替换成「待转写」。
③ 媒体必须与句子时间轴同源（同一段音视频）；否则边界 / 口型对不上。没有合适媒体时可用「仅文本模式」先看句子与翻译，但播放 / 录音 / 评分不保证可用。

【备选路径 · .srt】
先导入你的媒体（文件名任意）→ File → Import Subtitle… → 选择「com.shadow.course.asking-directions.srt」→ 建句后手动跟读（.srt 不含中文翻译）。

【规范包 · .shadowcourse】
「com.shadow.course.asking-directions.shadowcourse」是规范载体（Web 校验 / 归档 / 未来一键导入用），当前桌面工具版本不识别，不要用它替代上面的 .shadow.json。

【授权与合规】
本资源文本 / 翻译 / 时间轴由 SHADOW Studio 创作，采用 CC-BY-4.0；不含任何第三方影视 / 音乐素材，不含媒体（BYOM）。媒体版权与授权由使用者自行负责。

【校验】
node tools/shadowcourse/validate.mjs market/data/packages/com.shadow.course.asking-directions.shadowcourse
