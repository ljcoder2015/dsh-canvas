# 设计节点接入 OpenPencil 方案（评估稿，未动代码）

> 结论先行：**可行，且值得做**。OpenPencil（MIT，8.5k★，活跃维护，npm 已发布 0.15.1）的分层恰好能补上我们 M2 最贵的一块——编辑闭环（命中测试/选择/变换/undo）。推荐**渐进替换底座、保留 React 面貌**（方案 A），整编辑器嵌入（方案 B）留作备选，iframe 隔离（方案 C）不推荐。

## 一、OpenPencil 是什么

AI 原生设计编辑器，开源 Figma 替代品。`Tauri v2` 桌面壳 + Web（Vite/Bun），UI 用 **Vue**，渲染 **CanvasKit WASM (Skia) over WebGL2**，支持 sRGB/Display-P3。Monorepo，核心包全部发布 npm（均为 MIT）：

| 包 | 内容 | 对我们的价值 |
|---|---|---|
| `@open-pencil/scene-graph` | 场景图：Frame/Rect/Ellipse/Line/Vector/Text、auto-layout、constraints、effects、blend、variables、**undo、snap、copy、instances** | 直接顶替我们要自研的文档模型 + M2 编辑状态 |
| `@open-pencil/core` | **headless editor**（`createEditor`：选择/变换/对齐/nudge/text/history/viewport）、CanvasKit 渲染、AI 工具面（`toolsToAI`、RPC 命令、XPath 查询、CODEGEN_PROMPT、design-jsx） | 编辑闭环现成；AI 操作面与我们的结构化 op 哲学同构 |
| `@open-pencil/kiwi` | Kiwi schema-runtime + **.fig codec**（读写真 Figma 文件） | 可替换我们手写的 kiwi.ts；打开 .fig 互通的大门 |
| `@open-pencil/pen` | 钢笔工具（peer: scene-graph） | 后续矢量编辑 |
| `@open-pencil/vue` | 完整编辑器 UI（reka-ui、tanstack-table、atlaskit-dnd、nanostores） | 方案 B 的载体 |
| io formats | **fig / svg / pdf / pptx / raster** 读写 | 导出管线（F3 倍率导出）可以直接借 |

依赖轻：scene-graph 只带 `es-toolkit`、`nanoevents`、`svgpath`；core 带几何/文本/Canvaskit 渲染。ESM、sideEffects:false，esbuild 打包无障碍。

## 二、与 dsh-canvas 现状的对照

M1 已自研：kiwi.ts（零依赖编解码）+ document.ts（24 字段自定义 schema + 信封）+ ops.ts（5 种结构化 op）+ 2D 只读渲染器。**M2（命中测试/选择/变换/undo）是编辑器最难啃的部分，OpenPencil 全部现成。**

关键判据逐条核对：

- ✅ **模型不直写二进制、改稿走结构化 op**：他们的 headless editor + tools/RPC 天生就是这个形态（甚至更强：XPath 选节点、对齐命令、组件/变量操作）。
- ✅ **信封机制保留**：workspace seam 仍是 text-write-only，`.design` 信封（header + base64）不动，只换 payload 的序列化格式。
- ✅ **CanvasKit 资产路由**：`/dsh-canvas/assets` 已就位，canvaskit-wasm 已装。
- ⚠️ **UI 是 Vue**：嵌全套 UI 会与 React 双框架共存，且他们的面板样式不守宿主主题令牌白名单（`theme-tokens.spec.ts` 判据）。
- ⚠️ **0.x 快速演进**（几乎每日提交）：需锁小版本 + 升级跑 check。
- ⚠️ **破坏性格式变更**：换文档模型 = `.design` payload 换格式，M1 产出的旧文件需要迁移或只读兼容。

## 三、三个方案

### 方案 A（推荐）：core + scene-graph 做底座，React UI 自持

- **文档模型**：`DesignDocument` 换成 `SceneGraph`；`.design` payload 用他们的 io 序列化（信封版本 1→2，旧文件做一次性转换或只读降级）。
- **预览**：`design-render.ts` 换成 core 的 canvas 渲染（CanvasKit/WebGL2）；我们 M1 的 2D 后端保留为无 WebGL 环境的降级。
- **编辑（M2）**：headless `createEditor` 提供选择/命中/变换/undo；我们用 React 画选中框、工具条、属性条（继续守宿主令牌判据）。
- **AI 面**：`canvas_design_read` 直读 scene-graph JSON；`canvas_design_edit` 的 op 映射到 editor 命令（可顺势升级 op 集：对齐、文本、组件、变量）。
- 代价：中（底座替换 + 格式迁移）；收益：最贵的编辑闭环 + `.fig` 互通 + 导出管线；保住 React/宿主主题一致性。

### 方案 B：整编辑器嵌入（`@open-pencil/vue` 挂进预览容器）

- React 只留外壳（头部/关闭/Esc 协商），编辑器整体 `createApp` 挂到预览 div；卡片 agent 通过 headless editor 单例桥接 op。
- 收益：全功能编辑器一步到位，demo 最快。
- 代价/风险：Vue + 全家桶进 client bundle（现在 1MB，会显著涨）；主题与浮层判据破功；与宿主交互（选中、元素选择探针语义）要跨框架桥。

### 方案 C：iframe + RPC 隔离（不推荐）

- 自托管他们的 web build，postMessage 桥文件与命令。
- 包零增长、升级独立，但「读产物→传文件→改→存回」要自建 RPC 协议，元素选择与宿主一体化全断，长期数据管道成本最高。

## 四、迁移要点（方案 A 视角）

1. **格式迁移**：envelope 版本 2；读取时识别 v1（旧 schema）→ 转换成 SceneGraph；不再产 v1。
2. **判据不变**：模型不直写二进制；工具名/schema/contract 钉死机制不变，只是 op 集扩充。
3. **M1 资产的处置**：kiwi.ts 可换 `@open-pencil/kiwi`；document.ts/ops.ts 大部分退役——沉没成本明确接受，换来 M2 不用自研。
4. **版本策略**：锁定 `0.15.x`，升级视为一次 check + 视觉回归。
5. **渲染验证顺序**：先确认宿主预览环境 WebGL2 可用（2D 降级已在）。

## 五、风险

- 上游 API 未稳定（0.x）：接口漂移靠锁版本 + 升级演练吸收。
- 文档稀薄（README 正文薄，细节在源码与 packages/docs）：前期要靠读源码推进。
- bundle 增量：scene-graph + core 估几百 KB（不含 Vue）；canvaskit-wasm 已按需加载不受影响。
- 双框架（若走 B）的长期维护成本。

## 六、待拍板

1. UI 走 A 还是 B？（建议 A）
2. 文档格式破坏性切换 v2，还是保留 v1 只读兼容？（建议切换 + 转换器）
3. M2 是否就此改道 open-pencil，不再自研命中/选择/undo？（建议改道）

## 七、执行计划（2026-09-22 拍板：方案 A / 格式破坏性切 v2 / M2 改道）

> 每阶段出口判据一律 `npm run check` 全绿。依赖安装一律 `--legacy-peer-deps`（dsh-agent peer 冲突是既有状态）。

### P0 依赖与基线
- `npm install -D @open-pencil/core @open-pencil/scene-graph @open-pencil/kiwi --legacy-peer-deps`，**锁 `0.15.x`**（package.json 用 `~0.15.1`）。
- 冒烟：单测里 import `@open-pencil/scene-graph` 建一个 SceneGraph、读写一轮——确认 esbuild/bun 环境无平台问题。
- 读 `core/src/io/formats.ts` 与 `io/formats/fig`，**定格式 v2 的 payload**：优先 plain Kiwi 序列化的 scene-graph（自己掌控），`.fig` 容器只在确有互通刚需时启用。

### P1 文档模型与格式 v2（core 层）
- 重写 `src/core/artifact/design/document.ts`：信封结构保留（`dsh-design-` 头 + base64，**版本字段 2**），payload 换 P0 定下的序列化；`scaffoldDesignDocument` 用 scene-graph 默认值建一张空白画板。
- **删除 `kiwi.ts`、`ops.ts`** 及其测试；`artifact-io.ts` 的 read/write/digest 改走新格式。
- **不做 v1 转换器**（破坏性切换已拍板）：读到 v1 信封直接报「旧版设计文件，请让模型重新生成」——设计卡是 AI 产的，重生成成本≈0。
- 测试重写：信封 v2 round-trip、v1 拒绝、scaffold 形状、digest 走 scene-graph。

### P2 Host 工具面
- `card-runtime` 的 `scaffoldDesign` / `readDesign` / `editDesign` 换底座：read 吐 scene-graph JSON（`documentToJson` 替换为 scene-graph 的读 API）；edit 的 5 种 op（upsert/setProps/move/delete/reorder）映射到 headless editor 命令，**工具名与 16 项清单不动**，只扩 op schema。
- `contract.ts` 的 `designOpSchema` 扩 v2 op 集（新增对齐/文本/组件按 editor 能力逐步开放）；`dsh.plugin.json` 不动（`contract.spec.ts` 继续钉 16）。

### P3 预览换渲染
- `design-viewer.tsx`：主路径换 core 的 CanvasKit/WebGL2 渲染（走 `/dsh-canvas/assets` 的 wasm），保留 M1 的 2D paint 作为无 WebGL 降级——painter 输入从自定义 `DesignDocument` 换成 scene-graph JSON。
- 平移/缩放/点阵视口逻辑保留（ref 视口那一套与渲染引擎无关）。
- **真实宿主验证 WebGL2**：重启 `dsh web` 实测；这是改道后第一个「必须见真章」的点。

### P4 M2 编辑闭环（改道后正主）
- 选中/命中：headless editor 的 selection + viewport；React 画选中框与手柄（守宿主令牌判据）。
- undo 走 editor history（inverse command batching 现成）；属性条（填充/圆角/不透明度/文本）第一批。
- 中文字体决策重开：core 的 text 层自带 unifont/Fontsource 回退（CJK 缺字回退是他们修过的 #89），M2 原计划「DOM 覆盖层渲染文本」可能不再需要。

### P5 收尾
- `docs/…设计节点方案.md` 加修订记录（v3：格式 v2、底座 OpenPencil）；`toolchain.md` 记 OpenPencil 版本锁定与升级演练判据。
- 记忆更新（长期判据：core 层同构、锁 0.15.x、升级=check+视觉回归）。

### 风险闸
- 上游 API 漂移：只在 P0/P1 各对一次 0.15.1 源码，之后冻结。
- WebGL2 不可用的宿主环境：P3 的 2D 降级是硬保底，不是可选项。
- bundle 增量：P0 完成后量一次 client.js 尺寸，写进日志做基线。
