# 设计节点技术方案 v2（Figma 架构：Kiwi 存储 + CanvasKit 渲染）

> 状态：**方案评审稿，未动代码**。v2 推翻 v1 的「SVG 本体 + 路由到 HTML 形态」路线：设计节点是**全新 kind**，与 SVG 无关；存储用 **Kiwi**（Figma 同款 schema 化二进制），渲染与编辑用 **CanvasKit**（Skia 的 WASM 移植，Figma 同款渲染引擎）。评审通过后按约定拆回两份正式文档。

## 〇、一句话结论

dock 上替换原「矢量图片」为**设计节点**：产物是一个 `.design` 文件——Kiwi 二进制编码的多画板设计文档。渲染与编辑走 CanvasKit（画图形）+ DOM 覆盖层（选择框、文本编辑）。模型**不直接写二进制**，通过**结构化设计编辑工具**（读文档 / 批量改节点）读写；元素级选择由自研命中测试驱动，圈选 → 提示词框 → 结构化编辑，改稿闭环与 F3.14 同构。App 页、官网、海报、插画、PPT 都是**同一份设计文档里的画板（artboard）**，靠画板模板预设区分，不再路由到 webapp/site/html-deck。

## 一、v1 → v2 改了什么（及为什么）

| v1（已废弃） | v2（本方案） | 原因 |
|------|------|------|
| SVG 为设计本体 | 新 kind `design`，Kiwi 二进制文档 | SVG 的「可编辑」停留在文本层，图层/填充/约束系统表达力不够；Figma 证明结构化文档才是专业编辑的地基 |
| 海报 SVG 画在卡上，App/官网/PPT 路由到 webapp/site/html-deck | 全部是设计文档内的**画板**，一卡多画板 | ardot 的本质是「设计稿」不是「真网页」；路由让 App 页长成 HTML 应用，语义就错了。多画板天然支持 PPT=画板序列 |
| 元素选择复用探针（iframe 注入） | 自研命中测试（CanvasKit + 逆变换） | 画布不是 DOM 页面，探针不适用；但 chrome 插槽、两摞协商、流光、一笔跨关闭等**预览器级机制全部复用** |
| 模型用文件工具直写文本 | 模型用**结构化编辑工具**改文档 | 二进制不可直写；结构化 op 也是改稿质量的保障（改哪个图层是显式的，不靠模型重猜全篇） |

保持不变的：文件即产物（产物就是那个 `.design` 文件）、kind 由文件证据认定、卡片-会话绑定、取材/连线/F5 摘要通道、预览器外壳的插槽与协商机制、导出与发布框架。

## 二、数据层：Kiwi 存储

### 2.1 选型

Kiwi 是 Figma 开源的 schema 化二进制序列化格式（github.com/evanw/kiwi，有官方 TS 实现），正是为「大型设计文档」设计：紧凑（比 JSON 小一个量级）、有 schema 演进规则（**只允许追加字段/枚举值**，老文档在新代码下可读）、编解码成本低。编解码是纯 TS，`tests/` 可做零依赖单测。

### 2.2 文档模型（schema 草案要点）

- `Document { schemaVersion, artboards[], nodes[], textStyles[], paintStyles[] }`
- `Node { id, type(enum: frame|rect|ellipse|text|vector|image|group), parentId, order, transform(a,b,c,d,tx,ty), size, fills[], strokes[], cornerRadius, opacity, blendMode, clipsContent, text{content,font,fontSize,lineHeight,color}, vectorNetwork{vertices,segments,regions} }`
- 画板即根级 frame；`parentId` + `order` 构成图层树。

### 2.3 kind 与证据认定

**新 kind 由扩展名证据认定**：`.design` → `design`。`kind-registry.ts` 的 `BUILTIN_KINDS` 加一个条目、`detectKind` 加一行判定——F2.4「加形态=加条目、不改散落分支」的第一次真实用例。**不动 `HTML_KINDS`/`DIRECT_TEXT_KINDS`**。

### 2.4 关键设计：模型的「写笔」是结构化工具，不是文件写

文件即产物仍然成立——产物就是 `.design` 文件；但它**不可被模型的文本写工具直写**（二进制）。因此为卡片会话提供两个卡片作用域的新工具（`TOOL_NAMES` 14→16，`contract.spec.ts` 的清单断言会盯住 `dsh.plugin.json` 同步）：

- `canvas_design_read`：读文档（全部或某画板/子树）为 JSON——模型眼里的文档永远是人类可读的；
- `canvas_design_edit`：批量结构化 op（`upsertNode / setProps / moveNode / deleteNode / reorder`），Host 侧 decode → apply → encode 整文件落盘。

收益：改稿是**显式的**（模型改的是图层 id，不是重猜全篇）；F5 摘要通道对 `design` kind 返回「画板清单 + 图层树摘要」（`outlineOf`/`digestOf` 按 kind 分支，Host 解码）；元素选择的「改动要求」提示框里嵌的是**节点路径 + JSON 片段**（给定位不给补丁，原则同 F3.14，且选中的 JSON 天然就是 `setProps` 的入参形状）。

### 2.5 版本与兼容

文档头带 `schemaVersion`；schema 演进只追加字段/枚举值（Kiwi 规则保证老文档可读），未知字段跳过不报错；破坏性变更走显式迁移函数（本期不实现，预留入口）。

## 三、渲染与编辑层：CanvasKit + DOM 覆盖层

### 3.1 渲染

- `canvaskit-wasm`，**wasm 与字体资产随插件打包**（`lib/assets/`），预览器首次打开时懒加载初始化（不阻塞画布主界面），一次初始化全插件共享。
- 渲染循环 rAF + 脏标记（只有文档或视口变化才重绘）；视口平移/缩放走矩阵，预览弹窗内自成一套手势。
- **安全面是赢的**：内容画在 canvas 上，没有 iframe、没有 HTML 注入面（对比 html-deck 沙箱那一整层顾虑）。

### 3.2 编辑交互（复用 F3.14 的骨架，替换它的「腿」）

可复用的（预览器级，与渲染引擎无关）：chrome 三插槽两通道、`useEscapeLayer`/`useCloseGate` 协商、发送后流光、框不收、一笔跨关闭（`pending.ts`）、提示条浮在预览上不占排版位。

需要自研的（探针的替代品）：

- **命中测试**：指针事件 → 视口逆变换 → 图层树自顶向下逐节点几何包含（rect/ellipse 数学判定，vector 走 skia path `contains`）。
- **选择/悬停 overlay**：独立绝对定位 SVG 层画圈与框（不污染 canvas；颜色骑真宿主令牌，白名单判据沿用）；框锚随视口矩阵重算（对应 F3.14 的「活量」，变量只剩视口矩阵，比 iframe 场景简单）。
- **文本编辑**：双击文本节点 → HTML 覆盖层（textarea 定位/缩放对齐节点）→ 提交即 `setProps` 结构化编辑。
- **改稿回传**：圈选 → 提示词框（嵌节点 id、类型、几何、样式 JSON）→ 发送走卡片会话 → 模型回 `canvas_design_edit` → 文档变 → 脏标记重绘 → 框收起。

### 3.3 中文字体（M2 关键决策点）

CanvasKit 画文本需要内嵌字体（无系统字体访问）。中文场景两条路，M2 评审时定：

- **A（推荐起步）**：文本节点由 **DOM 覆盖层渲染**（系统字体，中文零成本、可选可编辑），CanvasKit 只画图形与位图；代价是文本与图形分两层，导出 PNG 时文本要在 canvas 上补画（届时内嵌一份字体）。
- **B**：内嵌 Noto Sans SC 子集（常用字 ~2–4MB 额外体积），CanvasKit 直绘文本。导出免补画，但包体与字体覆盖面是长期税。

## 四、接线（按模块落点，未写代码）

1. **kind 注册**：`BUILTIN_KINDS` 加 `design` 条目（label 设计，`exportFormats: ['png']`，publishable 暂 false）；`detectKind` 认定 `.design`。
2. **契约**：`contract.ts` 加 `dsh-canvas#card/scaffold_design`（新建设计卡：Host 写入最小合法 Kiwi 文档——一块 1024×1024 空画板）。dock 的 `DOCK_SPECS` 第 4 项替换：`label: 'canvas.dock.design'`、`extension: 'design'`、`kind: 'design'`、走 `scaffoldDesign`——与 `webapp: true` 同款特例路径（**seed 是文本机制，装不下二进制**，这正是 v1 seed 方案作废的原因）。locales 加 `canvas.dock.design`，删 `canvas.dock.vector`。
3. **Host 侧 Kiwi 服务**：`src/core/artifact/design/`（纯逻辑：schema 编译产物 + 文档模型 + 编辑 op 应用器，零宿主依赖、可单测）；`card-runtime` 挂 scaffold 与读写。
4. **Client 预览器**：`viewers/design-viewer.tsx`（CanvasKit 初始化、渲染循环、视口、命中测试、overlay、文本覆盖层）；`registry.ts` 认领 `design` kind；图层树面板（折叠/选中双向联动）M2 末尾加。
5. **工具注册**：`tools.ts` 加 `canvas_design_read` / `canvas_design_edit`（卡片作用域，身份解析沿用前六项规则，`additionalProperties:false` 逐字对齐）；prompt 补设计预设——画板模板清单：App 页 375×812、官网首屏 1440×900、海报 1242×1660、社交图 1080×1080、PPT 1920×1080，**都是文档内画板预设**，一句指令可加画板。
6. **导出**：`canvas_export` 加 design→PNG（CanvasKit `makeImageSnapshot`，1x/2x/4x 倍率参数）。SVG/PPTX（矢量网络→路径、画板序列→可编辑形状）**远期**。
7. **测试**：Kiwi 编解码 roundtrip、编辑 op 语义、文档摘要（纯模块单测）；E2E `design-editor.js`（渲染冒烟、选择框、文本编辑、结构化改稿闭环、导出像素）；dock 文案断言改名；`npm run check` 全绿。

## 五、分阶段

| 阶段 | 内容 | 出口判据 |
|------|------|----------|
| M1 | kind + 契约 + Kiwi schema/编解码 + 只读渲染器 | 新建设计卡 → 预览里画板与图形渲染正确；`design_read` 能吐 JSON |
| M2 | 选择/命中/overlay + `canvas_design_edit` 闭环 + 文本（方案 A） | 「圈着改」全链路通：圈选 → 提示词 → 模型 op → 重绘 → 框收 |
| M3 | 图层树面板、画板模板预设、PNG 倍率导出、多画板管理 | 一句指令加画板并按模板落；导出像素与预览一致 |
| M4（远期） | 矢量网络绘制、约束系统、增量历史/撤销栈、SVG/PPTX 导出、多模态判稿（渲染 PNG 回喂模型） | 另行评审 |

## 六、风险与取舍

1. **包体**：canvaskit-wasm ~6–7MB + JS ~300KB，是 `lib/client.js` 现体积的量级跃升。懒加载兜住首屏；**wasm 能否从插件资产路径加载需在真实宿主验证**（webserver 是否服务 `lib/assets/`——M1 第一件事，不通则走「首帧用 base64 内嵌 + 后续落盘」或 Host 侧新资产路由）。
2. **编辑基建全自研**：命中测试、变换、overlay、（远期）撤销栈都是 Figma 用几年堆出来的部分；本期只做「选择 + 属性/文本编辑 + 移动」，明确不做约束系统与布尔运算。
3. **中文字体**（§3.3）：方案 A 有「导出补画」的二次实现；方案 B 有包体税。M2 评审定。
4. **改稿质量依赖 op 表达力**：op 集太弱模型会绕路（反复 delete+upsert）；M2 按「提示框里的选中 JSON 即 op 入参」对齐设计。
5. **存量 `.svg` 卡**：保持 image kind 原样（证据认定不变，无迁移）；dock 替换后不再有新建入口。

## 七、验收判据（M2 出口）

- 新建设计卡，输入「一块 375×812 的手机屏画板，顶部导航栏、标题文本、两张圆角卡片」，画板树与渲染正确，文本可双击改字。
- 圈选标题 → 提示词框内嵌节点 JSON → 写「改成 #6B4226、24px」→ 发送后**只有该节点属性变化**（Kiwi 文档 diff 可验），渲染即时更新，框收起。
- `canvas_design_read` 吐出的 JSON 与 `canvas_design_edit` 接受的 op 逐字段对齐；`npm run check` 全绿；`design-editor.js` 判据集全过。
