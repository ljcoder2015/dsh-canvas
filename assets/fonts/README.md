# Noto Sans SC（vendored）

- 文件：`NotoSansSC-Regular.ttf`（可变字重，默认实例 400）
- 来源：<https://github.com/google/fonts/tree/main/ofl/notosanssc>（经 jsdelivr 下载）
- 许可：SIL Open Font License 1.1（<https://openfontlicense.org>）
- 用途：设计预览（OpenPencil 渲染器）的 CJK 回落字体。core 自带的 bundled
  字体无中文字形，其远程回落走 Google Fonts 在宿主环境不可达；本文件由
  `build.mjs` 拷入 `lib/assets/`，预览器经 `fontManager.markLoaded` +
  `setCJKFallbackFamily` 本地注入。

升级方式：重新下载同源文件覆盖即可；构建时若文件缺失则跳过拷贝，
中文回落退回远程路径（不可达时中文渲染空白）。
