# DeepSeek Harness 通用创作画布插件 · 技术文档

**版本**：v1.44
**最近更新**：2026-09-21
**状态**：技术架构已按 [`dsh-plugin-template`](https://github.com/bugmaker2/dsh-plugin-template) 与 DeepSeek Harness 子系统文档（`docs/cookbook/*`、`docs/subsystems/*`）校准，并在真机跑通
**产品文档**：[`DeepSeek-Harness-Canvas-产品文档.md`](./DeepSeek-Harness-Canvas-产品文档.md)——功能点清单（F1.1–F10.4）、MVP 范围、设计决策记录、修订记录都在那边
**定位**：这个双端插件的完整技术设计。底座的形态约束、源码分层、跨端契约、Host 与 Client 两侧的职责边界、数据落点、构建与安装，各占一章

## 阅读约定

- 本文档章节号是**中文数字**（一～十二）。文中出现的 `§<数字>.<数字>`（如 `§3.6`）与 `F<数字>.<数字>`（如 `F5.2`）**一律指产品文档**里的章节与功能点编号，本文档内互引则写作 `§<中文数字>`（如 `§11`）。
- **§11 集中列出与初版技术设想不一致之处及其影响，建议优先阅读。**
- 修订历史、功能口径与产品边界不在这里，见产品文档。

## 一、技术底座：双端插件

本插件是一个**双端插件**：Host 半跑在 Node（Cordis 插件），Client 半跑在浏览器（Web harness 模块）。

| 项 | 结论 |
|----|------|
| Host 入口 | `src/index.ts`，导出 `name` / `inject` / `Config`（schemastery 校验 + 默认值）/ `apply(ctx, config)` |
| Client 入口 | `src/client/index.tsx`，导出 `inject`（`slots` / `remote` / `locale`）/ `apply(ctx: ClientContext)` |
| 双端通信 | Typert Remote：Host 侧 `TypertRemoteService` + `@Remote` 方法，浏览器侧经 `ctx.remote.<namespace>` 调用 |
| 浏览器加载 | 打包为 `lib/client.js`，由 `window.__ModuleLoader__.load` 注册，Web harness 的模块加载器按 `dsh.client` 扫描结果加载 |
| 依赖要求 | Node `^22.19 \|\| >=24`，pnpm `>=9`（模板用 10），`dsh >=0.1.0-rc.6` |
| 插件清单 | Harness 唯一必需的是 `package.json`；`dsh.plugin.json` 面向 dsh.so 注册表，`cordis.patch.yml` 负责把 Host 插件行挂进 profile |

## 二、插件目录结构

```
dsh-canvas/
├── package.json              # 唯一 Harness 清单：dsh.bundle.patch + dsh.client
├── cordis.patch.yml          # 把 Host 插件行挂进 profile（可覆盖 Config 默认值）
├── dsh.plugin.json           # dsh.so 注册表清单：id / engines / contributes
├── build.mjs                 # esbuild 双端打包 + 声明文件
├── eslint.config.js
├── tsconfig.json             # typecheck：src
├── tsconfig.build.json       # 只产声明 → lib/types
├── tsconfig.tests.json
├── vitest.config.ts
├── src/
│   ├── index.ts              # Host 入口：Config schema + apply
│   ├── contract.ts           # 双端共享的严格 wire 契约（唯一真源）
│   ├── types.ts              # 双端共享类型
│   ├── domain.ts             # 画布持久化领域声明（defineDomain）
│   ├── typert.ts             # Host Typert manifest
│   ├── capabilities.ts       # 部署能力探测（可选席位按能力降级）
│   ├── host/                 # 宿主运行时：装配 + 两个 Remote 服务
│   │   ├── canvas-runtime.ts     # CanvasRuntime：画布/取材链/排布（Remote 服务）
│   │   ├── card-runtime.ts       # CardRuntime：卡片产物读写/注入/导出/发布
│   │   ├── tools.ts              # canvas_* 工具注册（defineTool × 14）
│   │   └── prompt.ts             # 卡片会话的 prompt 注入段落
│   ├── core/                 # 纯逻辑层，不依赖 Cordis
│   │   ├── canvas/               # 画布模型
│   │   │   ├── ids.ts                # 存储键的定宽转义
│   │   │   ├── board.ts              # 排布策略
│   │   │   ├── source-store.ts       # 取材边存储
│   │   │   └── workspace.ts          # 画布即工作区（登记与挂账）
│   │   ├── artifact/             # 产物：认定 / 读写 / 页面 / 引用
│   │   │   ├── kind-registry.ts      # 形态注册表（HTML_KINDS 的唯一出处）
│   │   │   ├── artifact-io.ts        # 文件读写唯一出口（沙箱策略在此定夺）
│   │   │   ├── webapp.ts             # 应用脚手架 + 预览链接闸门
│   │   │   ├── preview-picker.ts     # 预览元素探针（注入页面的脚本 + 纯函数）
│   │   │   └── file-reference.ts     # 连线底层：宿主 @file 语法的逐字节复刻
│   │   └── session/              # 卡片会话：绑定 / 日志 / 模型 / 工具
│   │       ├── session-manager.ts    # 卡片会话生命周期与归属
│   │       ├── session-log.ts        # 读会话事件日志（冷会话照读）
│   │       ├── model-routing.ts      # 卡片会话的模型来源
│   │       └── agent-preset.ts       # 卡片会话的工具来源
│   └── client/
│       ├── index.tsx             # Client 入口：mount Remote + 注册席位
│       ├── wire/                 # 通道层（bridge 与 model-memory 互引，必须同目录）
│       │   ├── bridge.ts             # Remote 调用的类型化适配层
│       │   ├── remote.ts             # Client Remote 贡献 + 类型化 namespace
│       │   ├── address.ts            # 读宿主的资源地址语法
│       │   ├── model-memory.ts       # 按节点类型记住用户上次选的模型
│       │   └── session-read.ts       # 从会话域推卡片的脸（订阅，不镜像）
│       ├── canvas/               # 画布面
│       │   ├── canvas-view.tsx       # 无限画布正文
│       │   ├── source-edges.tsx      # 取材线几何
│       │   ├── card-tile.tsx         # 卡片（含流光层）
│       │   ├── card-face.tsx         # 卡面描述（画布 tab 与形态 tab 共用）
│       │   ├── card-overlay.tsx      # 选中态控制带
│       │   ├── canvas-nav.tsx        # 左栏画布包裹（Portal）
│       │   ├── canvas-menu.tsx       # 画布行的操作菜单与删除确认
│       │   ├── row-actions.ts        # 那一行该给出哪几个动作（纯策略）
│       │   ├── open-folder.ts        # 交给文件管理器打开画布目录
│       │   ├── project-catalog.ts    # 活动画布清单（不轮询）
│       │   ├── canvas-panels.tsx     # 主面板 / 侧栏席位
│       │   ├── canvas-tab.ts         # 右栏 tab 类型（工作台页 + 每形态认领）
│       │   ├── folder-picker.tsx     # 新建画布时挑目录
│       │   └── material-notice.ts    # 取材提交后那句话（纯策略）
│       ├── artifact/             # 产物面
│       │   ├── registry.ts           # 预览注册表：kind → 预览器（只剩认领，没有能力）
│       │   ├── artifact-view.tsx     # 全屏弹窗外壳（读产物 / 分派 / 骨架 / Esc 与关闭裁决）
│       │   ├── chrome.tsx            # 交给预览器的壳：三个插槽 + 两条登记通道
│       │   ├── chrome-stack.ts       # 「这一下谁收」的顺位（纯）
│       │   ├── use-artifact-payload.ts   # 打开时读一次产物（payload 整窗共享）
│       │   ├── viewers/              # 每种形态一个子文件，注册项与组件同处
│       │   │   ├── types.ts              # 公共契约：ViewerId / ViewerProps / 注册项
│       │   │   ├── markdown.ts           # 渲染（纯）
│       │   │   ├── markdown-viewer.tsx
│       │   │   ├── media-viewer.tsx      # 图片 / 视频
│       │   │   ├── deck-viewer.tsx       # 沙箱 iframe + 链接闸门 + 元素选择（自己那套）
│       │   │   ├── delimited.ts          # 切行状态机（纯）
│       │   │   ├── data-viewer.tsx
│       │   │   └── text-viewer.tsx       # 兜底
│       │   ├── editing/              # markdown / 纯文本的编辑面
│       │   │   ├── use-text-editing.ts       # 状态机（hook）：草稿 / 自动保存 / 写被拒
│       │   │   ├── editable-text.tsx         # 头部控件 + 条带 + 编辑框（两个文本预览器共用）
│       │   │   ├── writable.ts               # 这份 payload 能不能整篇写回（纯）
│       │   │   ├── mode.ts                   # 预览↔编辑的方向键（纯）
│       │   │   └── autosave.ts               # 节律 / 退避 / 写被拒的形状（纯）
│       │   ├── element-pick/         # 元素选择 F3.14：开关 / 选中圈 / 提示词框 / 交给会话 / 跨关闭的那一笔
│       │   │   ├── element-pick.tsx          # 状态机（hook）：挑 → 写 → 等，含回读产物
│       │   │   └── pending.ts                # 这一笔跨关闭的记忆（纯；按卡记，不落盘）
│       │   ├── artifact-tab.tsx      # 形态 tab：认领地址后画卡面
│       │   └── tool-view.tsx         # canvas_* 的实时工具卡片（代码直播框）
│       └── ui/                   # 底座：文案 / 样式 / 席位 / 键位
│           ├── locales.ts
│           ├── styles.ts
│           ├── seats.ts              # 借用别包的席位（运行时只要一个字符串键）
│           └── shortcuts.ts          # 键位真源 + 说明表
└── tests/                    # 21 个 spec，镜像 src 分层
    ├── contract.spec.ts          # 协议基座（镜像 src/ 根）
    ├── core/                     # core.spec.ts 跨三域，另有 canvas/ artifact/ session/
    ├── host/                     # prompt · tools
    └── client/                   # wire/ canvas/ artifact/ ui/
```

**尚未落地的申报与不一致**（发布前需处理）：

- `dsh.plugin.json` 的 `contributes.skills` 申报了 `canvas-operations`，`package.json` 的 `files` 也收了 `skills/`，但**该技能包与 `skills/` 目录当前都不存在**；要么补上，要么从两处申报里撤掉。
- **CI 未落地**：仓库里没有 `.github/workflows/`，`check` 目前靠本地跑（见 §10）。
- `package.json` 声明 `packageManager: pnpm@10.17.0`，但仓库里跟踪的是 `package-lock.json`（npm）、没有 `pnpm-lock.yaml`——本地按 npm 跑、发布路径按 pnpm，需择一。

**拆分的判据**：`src/` 根只留**入口与协议基座**（零依赖、只被依赖），其余四层**依赖方向单向向下**——`host/` 依赖 `core/` 与协议，`core/` 谁都不依赖（它 import 到 `host/` 就是环），`client/` 自成一棵树。两个**构建入口路径刻意不动**，所以 `build.mjs`、`package.json` 的 `exports`、`dsh.plugin.json`、`cordis.patch.yml` 都不随目录调整而改动。

**产物面的判据**（`src/client/artifact/`）：`registry.ts` 是 kind → 预览器的**唯一分派点**——一行一个预览器，每行只说它**认领哪些 kind**（`claims`）与谁兜底（`fallback`，标出来而不靠排在最后——顺序是看不见的约定，重排一次就会静默截走所有 kind）。**表里没有能力**（v1.42）：弹窗给三个**插槽**（头部右侧、头部下方那一条、遮罩层）与两条登记通道（Esc 与关闭的顺位），按钮、提示条、选中圈由各预览器自己挂进去，连同它们的判断与状态——所以**加一种形态 = 加一个文件（注册项与组件同处）+ 在注册表 import 一行**，调用方一行都不用改。外壳因此完全不知道有哪些按钮。「产物是不是它自己的文字」也挪出了注册表，回到 kind 表上的事实（`isDirectTextKind`），由控制带与文本预览器各读一次同一份。此前这条纪律是散的——「谁能编辑」是 `artifact-view.tsx` 里另一个函数里的另一个 `if`，「谁有页面帧」是弹窗硬编码的 `viewerIdFor(kind) === 'deck'`，而 HTML 家族的 kind 清单在宿主与视图层各抄了一份。

与初版设想的差别：UI 不放在独立 `ui/` 目录，而是 `src/client/`（浏览器半，其内部再分 `wire` / `canvas` / `artifact` / `ui` 四层）；Host 能力的落点不是 `tools/*.ts` 里的裸函数，而是**两个 Remote 服务类 + 一个工具注册模块**（今天在 `src/host/`）。

## 三、清单三件套与命名一致性

Harness 只认 `package.json`。两个关键字段把它变成插件：

```json
{
  "name": "dsh-canvas",
  "version": "1.0.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-primitives",
        "@deepseek-ai/dsh-client-resources"
      ]
    }
  },
  "files": ["lib", "cordis.patch.yml", "dsh.plugin.json", "README.md", "LICENSE"],
  "engines": { "node": "^22.19 || >=24", "dsh": ">=0.1.0-rc.6" }
}
```

`cordis.patch.yml` 负责把 Host 插件挂进 profile，并可在此覆盖 `Config` 默认值：

```yaml
- insert:
    - id: dsh-canvas
      name: dsh-canvas
      # 可选：覆盖 src/index.ts 的 Config 默认值
      # config:
      #   workspaceRoot: ./canvas
```

`dsh.plugin.json` 是 dsh.so 注册表清单，也是工具/技能贡献的申报处：

```json
{
  "id": "dsh-canvas",
  "version": "1.0.0",
  "main": "lib/index.js",
  "engines": { "dsh": ">=0.1.0-rc.6" },
  "contributes": { "tools": ["canvas_read_card", "canvas_read_sources", "..."], "skills": ["canvas-operations"] }
}
```

> `contributes` 字段本身在模板中存在（模板填的是空数组），其**条目格式**尚未核对注册表文档——发布前需确认这里是工具名清单还是完整贡献对象。

**改名时必须同步的位置**（模板经验，缺一处即加载失败或运行期失联）：

| 位置 | 字段 |
|------|------|
| `package.json` | `name`、`exports`、`files` |
| `build.mjs` | `__ModuleLoader__.load` 的 `id` |
| `src/index.ts` | `name`（须与包名、`cordis.patch.yml` 一致） |
| `src/client/wire/remote.ts` | `TypertRemoteNamespace$<hex>` 十六进制命名空间名 |
| `src/client/ui/locales.ts` | locale namespace key |
| `src/client/canvas/canvas-tab.ts` | tab 类型 `id` / `kind` |
| `src/typert.ts` | `package` |
| `src/contract.ts` | invocation `id` |
| `cordis.patch.yml` | `id`、`name` |
| `dsh.plugin.json` | `id` |

包名为 `dsh-canvas` 不是随意的：服务键 `canvas` 的十六进制命名空间名是 `TypertRemoteNamespace$63616e766173`，`card` 是 `TypertRemoteNamespace$63617264`（`canvas` → 63 61 6e 76 61 73）。

## 四、契约层：一份 descriptors，三处引用

双端不漂移的机制是**单一真源**：一份 wire 契约同时被 Host manifest 与 Client 贡献引用。

```typescript
// src/contract.ts —— 双端共享的严格 wire 契约（唯一真源）
import { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

export const cardIdSchema = z.string().trim().min(1).max(400)
export const cardSummarySchema = z.object({
  cardId: cardIdSchema, kind: z.string(), path: z.string(),
  summary: z.string(), outline: z.array(z.string()),
  bytes: z.number(), updatedAt: z.number(),
}).readonly()

export const DSH_CANVAS_INVOCATIONS: readonly InvocationDescriptor[] = [
  {
    id: 'dsh-canvas#card/read_sources', service: 'card', namespace: 'card', method: 'readSources',
    invocation: { kind: 'direct' }, parameters: [], cancellation: { parameter: 'signal' },
    result: { mode: 'strict', typeSymbol: 'dsh-canvas#CardSummaryList', schema: z.array(cardSummarySchema) },
  },
  // …其余 canvas.* / card.* 方法同理，一个方法一条 descriptor
]
```

```typescript
// src/typert.ts —— Host manifest：告诉模型层这个插件提供了什么
import { DSH_CANVAS_INVOCATIONS } from './contract.ts'

export const TYPERT_MANIFEST: TypertContribution = {
  package: 'dsh-canvas', face: 'host', schemas: [],
  model: {
    services: [
      { key: 'canvas', exportName: 'CanvasRuntime', description: '画布座次与取材链。', tags: [], members: [ /* 每个方法一条 */ ], types: [] },
      { key: 'card', exportName: 'CardRuntime', description: '卡片产物读写与取材引用。', tags: [], members: [ /* … */ ], types: [] },
    ], events: [], objects: [],
  },
  invocations: DSH_CANVAS_INVOCATIONS,
}
```

```typescript
// src/client/wire/remote.ts —— Client 贡献：与 Host manifest 指向同一个数组
import { DSH_CANVAS_INVOCATIONS } from '../contract.ts'

export const DSH_CANVAS_REMOTE: TypertRemoteContribution = {
  package: 'dsh-canvas', descriptors: DSH_CANVAS_INVOCATIONS,
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$63617264 {
    readSources: (signal?: AbortSignal) => Promise<RemoteResult<CardSummary[]>>
    // …
  }
  interface TypertRemoteMap { 'card/read_sources': TypertRemoteNamespace$63617264['readSources'] }
  interface TypertRemoteNamespaceMap { card: TypertRemoteNamespace$63617264 }
}
```

**失败面只有一个类**：不建域异常家族，域码经 declaration merging 进 `RemoteErrorDetailsMap`，抛出点直接 `throw new RemoteError('<域>/<理由>', message, details)`；与端点无关的异常不预归类，由 Gateway 兜成 `gateway/internal`。Client 侧调用返回 `RemoteResult<T>`，`if (!result.ok)` 分支判 `code`（不要判 `instanceof`），本地缺陷继续上抛。

契约一致性可直接测死（模板同款断言）：

```typescript
it('host 与 client 共用同一份 descriptor 列表', () => {
  expect(TYPERT_MANIFEST.invocations).toBe(DSH_CANVAS_INVOCATIONS)
  expect(DSH_CANVAS_REMOTE.descriptors).toBe(DSH_CANVAS_INVOCATIONS)
})
```

## 五、Host 侧：服务划分与核心模块

| 模块 | 职责 | 归属 |
|------|------|------|
| `CanvasRuntime`（namespace `canvas`） | 画布座次、取材边增删查、上游链排布、归纳收纳、便签创建、**当前画布记账**（v1.31：`setActiveProject` 写领域全局 `activeProjectId`，画布级工具据此取项目） | `src/host/canvas-runtime.ts` |
| `CardRuntime`（namespace `card`） | 卡片产物摘要读取、上游（取材来源）读取、跨卡片注入、导出、发布、生图、**上游产物的文件引用提交**（v1.37：`referenceFiles`） | `src/host/card-runtime.ts` |
| `kind-registry` | 文件证据 → 形态认定（纯函数：扩展名 + 内容嗅探） | `src/core/artifact/kind-registry.ts` |
| `source-store` | 取材边的增删查与自动对账，落在存储领域之上 | `src/core/canvas/source-store.ts` |
| `file-reference` | **连线的底层**（v1.37）：Harness 自己的 `@file` mention 语法的逐字节复刻——`formatFileMention`（普通路径 / 带空白加引号 / 目录尾斜杠 / 引号不闭合 / 控制字符与双引号拒绝）、`nameFileReferences`（保序、去重、把写不出来的路径报进 `skipped`）、`nameWithoutProbe`（不探测 I/O 时一律文件形态——`site`/`webapp` 卡是**文件**不是目录）与引用块渲染；零依赖、不 import harness 包 | `src/core/artifact/file-reference.ts` |
| `session-manager` | `cardId → sessionId` 绑定、会话状态（空闲/运行中/有通知） | `src/core/session/session-manager.ts` |
| `model-routing` | 卡片会话的模型来源：新会话用部署默认 `agentOptions`，已记录的会话选择在开卡时交回控制器 | `src/core/session/model-routing.ts` |
| `agent-preset` | 卡片会话的**工具来源**：从部署的 agent preset 组装，否则该会话没有任何文件写入工具（见 §5「卡片会话的工具从哪里来」） | `src/core/session/agent-preset.ts` |
| `session-log` | 输入框回填的取数侧：从会话事件日志读用户最近一条**自己发出的**消息（`source.kind === 'user'` 才算），冷会话经部署的 `ctx.sessionQuery.readSession` 读持久化（见 §3.3 F3.9） | `src/core/session/session-log.ts` |
| `workspace` | 画布即工作区（F1.6）：经部署的 `ctx.workspaceRegistry` 把画布根目录登记为工作区（`create(root, title)` 幂等）并把卡片会话挂账（`attachSession`，要求会话头 cwd 规范化后等于工作区路径）；无名册部署整体空操作，失败只记日志 | `src/core/canvas/workspace.ts` |

```typescript
// src/host/canvas-runtime.ts —— Host Remote 服务
export class CanvasRuntime extends TypertRemoteService {
  constructor(ctx: Context, private readonly deps: CanvasRuntimeDeps) { super(ctx, 'canvas') }

  /** 记录用户当前打开的画布——画布级 agent 工具按它取项目（v1.31）。 */
  @Remote
  async setActiveProject(projectId: ProjectId, signal?: AbortSignal): Promise<Project> { /* … */ }

  /** 读取画布当前座次与取材边。 */
  @Remote
  async readBoard(projectId: ProjectId, signal?: AbortSignal): Promise<BoardSnapshot> { /* … */ }

  /** 按取材链分层摆位。 */
  @Remote
  async arrange(projectId: ProjectId, strategy: ArrangeStrategy, signal?: AbortSignal): Promise<BoardSnapshot> { /* … */ }
}
```

**Agent 工具注册**用的是 Harness 的工具流水线，而不是裸函数（`inject: ['tools']`）：

```typescript
// src/host/tools.ts
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-canvas'
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'canvas_read_sources',
    description: '读取当前卡片所有上游（取材来源）产物的摘要。',
    parameters: { depth: { type: 'number' } },
    output: {
      schema: { type: 'array' },                       // 规范 JSON 值
      render: (_args, value) => [{ type: 'text', text: renderSummaries(value) }],
    },
    async execute(args, exec) {
      // exec 携带调用身份与 signal；args 已按 schema 校验
      return await readUpstreamSources(ctx, exec.agent, args.depth)
    },
  }))
}
```

三条硬约束（来自工具参考文档）：

1. **参数已为你校验**，`execute` 内的 args 就是类型化结果；但非空字符串、正数、跨字段规则要自己查。
2. **`execute` 只返回规范 JSON 值**，不要返回内容块；人类可读解释放进 `output.render`。抛异常或返回非法值即 `isError`。
3. **必须遵守 `exec.signal`**，长任务走 `ctx.jobs.start(...)`（后台任务运行时）。

**按卡片收敛可见工具集**（会话隔离的落地手段）：工具注册表是分层的——`ctx.tools.register()` 可在调用方作用域内注册（作用域内工具遮蔽全局同名工具），`ctx.tools.restrict({ allow, deny })` 可为某个 agent 作用域裁剪全局工具，`ctx.tools.get(name, scope)` / `schemas(scope?)` 按作用域解析。因此「卡片 A 的会话拿不到卡片 B 的产物」不是靠 prompt 约定，而是靠**注册作用域 + 可见性过滤**。

**卡片会话的创建路径**（重要约束）：`ctx.sessions.create()` 由**调用方 fiber 拥有**，fiber 销毁即会话下架；而会话日志的持久化写入器由 **agent 生命周期**在发布时挂上——**脱离 agent 生命周期创建的会话不落盘**。所以卡片会话必须经 agent 工厂（`prepare` + `enter` + `announce` 事务）创建，插件只负责记录 `cardId → sessionId` 与生命周期编排。

**卡片会话的模型从哪里来**（本条是上一条的代价，落地于 `src/core/session/model-routing.ts`）：普通会话由 `dsh-api-session-controller` 组装，组装内容除 agent 本身还有两样——`AgentOptions.provider/model`（取自 `agentDefaultModel.currentSelection()`）与"本会话的模型选择"（控制器在 agent 作用域上装一个选择引用）。卡片会话由插件自己经工厂创建，**这两样都得自己补**：

1. **`agentOptions` 必须给**：agent loop 用 `AgentOptions.provider/model` 构建每一次请求，缺失时直接报 `agent "<id>" has no provider/model`；同时部署的提示词段落（persona prefix）用 `{{provider}}`/`{{model}}` 取同一个字段，缺了连**系统提示词装配都过不去**（`prompt variable "{{model}}" has no value for this assembly`）。所以创建与恢复卡片 agent 时都带上部署默认模型。
2. **本会话已记录的选择要装回去**：选择活在会话日志里（`modelSelection` 投影的 `pending`／`lastUsed`），而 agent 每次重开都是新的。控制器装选择的那个内部方法不是公开 API，但**触发它的调用是公开的**——`sessionController.selectModel`，与宿主输入框模型席位同一条 wire 调用。插件的做法：agent 一发布就把会话自己的选择交给这次调用（每个 agent 一次），于是"上次选的模型"跨插件重载仍然生效，而策略本身始终归控制器所有。
3. **顺序即优先级**：全新会话用部署默认 → 有记录的选择覆盖它 → 会话存活期间的模型切换（输入框选的那次）覆盖以上两者（控制器的选择引用在装配与请求两处都生效）。

**卡片会话的工具从哪里来**（与前一条同源，落地于 `src/core/session/agent-preset.ts`）：模型面向的**文件工具不在 Host 组装里**。`dsh-web-app` 的 patch 把基座的 `tool-fs`／`tool-bash`／`tool-pwsh`／`tool-jobs`／`tool-fs-search`／`skill-filesystem`／`tool-skill`／`tool-goal`／`plan-mode`／`tool-subagent*` 全部 disable，改由每个会话**挂载一个 agent preset** 来组装——这是 Web 面的既定分工，不是配置疏漏。

卡片会话既然是普通会话，就必须同样走 preset，而它的产物**只能靠普通文件工具写出来**（它自己的提示词段落就是这么告诉它的）。不加入 preset 的后果是：会话只继承宿主组装，即本插件全局注册的 `canvas_*`，而模型被要求用 `write`／`edit` 编辑产物文件，每一次调用都返回 `unknown tool`，产物停在 absent，整个回合以"解释自己为什么交不出文件"收尾——从模型视角看这个失败极其莫名，因为它并不知道自己的工具表是怎么组装的。

因此：

1. **加入 preset 是卡片会话的成立条件，不是优化**。preset 在常驻作用域下组装一次，agent"加入"的方式是让它的作用域键 parent 到那个挂载点；**唯一受支持的调用点是 agent 工厂的 `setup(agentCtx)` 回调**——只有在那里组装尚未发布，preset 组装失败才能让整次创建回滚，而不是发布一个半组装的 agent。创建与恢复两条路径共用同一个 setup。
2. **preset 在任何 agent 创建之前解析并预校验**（`resolve()` 取部署默认，`standingKeyFor()` 验组装）。失败**故意不被吞掉**：一个 preset 坏掉的部署同样给不了卡片会话写盘能力，诚实的答复是"那条配置坏了"，而不是开出一条默默干不了活的会话。
3. **无 roster 的部署是 no-op 而非失败**：裸 harness、单测这类环境没有 `agentPresets` 服务，此时模型面向的工具行本来就留在宿主组装里、全局层人人可见，没有可加入的东西。服务按名结构读取（`ctx.get('agentPresets')`），同一份 bundle 同时跑在有 roster 与无 roster 两种部署下。

**卡片元信息注入系统提示词**：用 `ctx.systemPrompt.section()` / `.context()` / `.variable()` 在卡片会话的作用域内注册段落与动态上下文（路径、形态、项目风格档案、上游取材来源摘要），作用域内条目遮蔽全局同名条目；一次性提醒走 `agent.inject({ content, source: { kind: 'plugin', plugin: 'dsh-canvas' } })`——它追加的是持久化上下文，下一次模型请求即可见，但**不会唤醒空闲 agent**。

**连线的底层 = 文件引用**（v1.37，替换掉 v1.35 的会话引用这一版）：一条取材边的两端确实都是会话（每张卡片一个，§2.3），但**边指向的东西是文件**，而这份文件**不一定是任何会话的产出**：节点可以**手动新建**（从来没有哪次会话生成过它），也可以是**对某次会话产物的二次编辑**（内容早已不等于那次会话的记录）。把「会话」当作「产物」的代理，等于预设「这份产物 = 某次会话的输出、且此后没人动过」——这个预设一破，模型拿到的就是**另一样东西**（过程记录、或者旧版本），而边明明指着那个文件。**文件引用把这个代理环节整个去掉**：名字直接指向磁盘上那一份，谁写的、怎么来的都不影响它指得对。所以插件交给新会话的是**名字**，不是内容，也不是快照。这份名字的语法**属于 Harness**：`@` token ＋ 工作区相对路径，带空白就 `@"…"`，目录带尾斜杠，`@deepseek-ai/dsh-file-reference-local` 在这条会话有 `read` 工具时装上这份引导（每张卡片会话都有 `read`，见上「卡片会话的工具从哪里来」）。插件**自造一套新词汇只会更差**：模型得为一个插件多学一种写法，而宿主 UI 与其它插件的 `@` 提示又各说各话。所以 `src/core/artifact/file-reference.ts` 把宿主那套语法**逐字节复刻**（零依赖、**不 import harness 包**——同一份 bundle 要跑在从未组合 file-reference 包的部署上），执行落在 Host 的 `CardRuntime.referenceFiles`：走这条卡的**间接**上游链 → 逐个 `probe`（只为判「是文件还是目录」与「写没写盘」）→ `nameFileReferences` 保序去重并分出 `skipped` → `referenceMessage` 以 `source.kind:'plugin'` 注入（**绝不是 `kind:'user'`**：是画布在给文件命名，不是在替用户说话）→ 返回 `{ cardId, files[], skipped[] }`。**名字必须真的解析得到**：卡片 id 就是工作区相对路径（产物落在 `<画布根>/<cardId>`，正好是会话 cwd）——这条既有事实是整个通道成立的前提，也是 §3.5 F5.4 那条「卡片是文件不是目录」的来处。**每轮提示里的取材块同源但更克制**：它**同步组装、不许 I/O**，所以走 `nameWithoutProbe()`（一律文件形态、不带由 kind 推出来的尾斜杠），只报**有哪些材料**，正文一个字都不带——从缓存里端出来的摘要没人负责失效，而上游随时可以被一次普通的文件编辑改写。**摘要通道照旧并存**（`canvas_read_sources` / `canvas_inject_card` / F5.7 `pull`）：它要的是「立刻把材料摆到眼前」，这件事引用做不到。

## 六、数据模型与持久化

「取材数据独立于文件系统」的落点是 Harness 的存储领域（domain），不是自建 JSON 文件。

```typescript
// src/domain.ts
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const cardRecord = z.object({                        // 记录 schema 用 zod 写，消费方类型由 z.infer 得到
  position: z.object({ x: z.number(), y: z.number() }),
  kind: z.string(),
  sessionId: z.string(),
})
const sourceRecord = z.object({                      // 一条取材边：下游 ← 上游
  downstream: z.string(),                            // 取材方 cardId
  upstream: z.string(),                              // 被取材方 cardId
  origin: z.enum(['manual', 'reconciled']),          // 手动连线 or 自动对账生成
})
const noteRecord = z.object({ text: z.string(), author: z.string() })

export const CANVAS_DOMAIN = defineDomain({
  name: 'dsh_canvas',                                // 单元名只允许 [a-z][a-z0-9_]*，故用下划线而非包名的连字符
  version: 1,
  layout: 'per-record',                              // 卡片/取材边记录大而稀疏，逐条成文档、逐条校验版本
  global: {                                          // 画布单例：视图状态 + 项目风格档案
    schema: z.object({
      viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }),
      style: z.object({ palette: z.array(z.string()), font: z.string(), tone: z.string() }),
    }),
    initial: DEFAULT_CANVAS_GLOBAL,
  },
  tables: {
    cards: domainTable<CardId, z.infer<typeof cardRecord>>(cardRecord),        // cardId → 座次/形态/会话
    sources: domainTable<SourceId, z.infer<typeof sourceRecord>>(sourceRecord), // 取材边
    notes: domainTable<NoteId, z.infer<typeof noteRecord>>(noteRecord),        // 共享便利贴
  },
})
```

| 特性 | 结论 |
|------|------|
| 打开方式 | `await ctx.storageDomain.open(CANVAS_DOMAIN)`，调用方拥有句柄并负责 `close()`（通常放进 `ctx.effect` 的 disposer） |
| 读取 | 同步、来自权威内存态：`table.get/entries/keys/size`；写入先落盘、再更新内存、最后发事件——**读取永不偏离介质** |
| 写入 | `put` / `update`（原子读-改-写）/ `delete`，同一领域内按写链串行 |
| 变更通知 | 每次持久写入后发 `domain/changed`（`put` 携带新快照，`deleted` 是墓碑），UI 与自动对账据此刷新 |
| 记录所有权 | 返回的是存储对象本身，**不得就地修改**，一律经 `put`/`update` 整体替换 |
| 后端 | 由部署侧路由决定（`json` 后端整文件重发布、`sqlite` 后端逐行存储），产品包不触碰后端 |

文件侧的数据模型相应简化（取材不再随卡片走）：

```typescript
interface Card {
  id: string                 // 即相对工作区根的路径（如 decks/intro.html）
  kind: string               // 由 kind-registry 认定
  position: { x: number; y: number }
  sessionId: string          // 绑定的 Agent 会话
}

interface Source {
  id: string
  upstream: string           // 被取材的 cardId
  downstream: string         // 取材方的 cardId
  origin: 'manual' | 'reconciled'
}

interface KindEntry {
  id: string                             // 如 'html-deck' / 'site'
  detect: (path: string, probe: FsProbe) => Promise<boolean>
  addressPatterns: string[]              // 认领用的地址 glob
  exportFormats: ExportFormat[]
  publishable: boolean
}
```

## 七、形态注册表落在哪个席位

初版把形态注册表设想成一个自造 registry。校准后的结论是：**形态的两半分别落在已有机制上**。

| 半 | 机制 | 说明 |
|----|------|------|
| Host 认定 | `src/core/artifact/kind-registry.ts` + `ctx.fs` | 由扩展名与内容证据判定 `kind`，结果写进 domain 的 `cards` 记录 |
| Client 认领与预览 | **右栏 tab 类型注册表** `ctx.sidebarRightTabs.register()` | 按资源地址 glob 认领，用 `priority` 分档压过内置查看器 |

```typescript
// src/client/canvas/canvas-tab.ts —— 一种形态 = 一个 tab 类型
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: 'dsh-canvas',
    kind: 'canvas-deck',                        // 打开该类型的判别名
    patterns: ['dsh-resource://file/**/*.html', '*.md'],   // 认领哪些地址
    priority: 'extension',                      // 压过内置 text/files 查看器
    canOpen: address => kindRegistry.claims(address),      // 同步否决
    title: address => cardTitleOf(address),
    guide: { order: 10, title: () => '画布' },  // 右栏引导页入口
  }), 'dsh-canvas: tab type')
}
```

配套的地址与资源体系（不要自造文件引用语法）：

- 资源地址：`dsh-resource://<protocol>/…`，文件协议为 `dsh-resource://file/session/<sessionId>/<相对路径>` 或 `dsh-resource://file/absolute/<绝对路径>`；构造/解析用宿主提供的 `fileAddressFor` / `parseFileAddress`。
- 页面地址：`sidebar://<kind>`，由 Sidebar 在 `openTab(kind)` 时自行写入，调用方从不拼。
- tab 身份是 `(kind, address)` 二元组；同一地址被两个类型打开就是两个 tab。
- 内置 kind 为 `guide` / `text` / `files`；`priority: 'extension'` 让插件认领先于内置查看器生效，插件注销后内置实现自动恢复。
- 产物预览数据走 `ctx.resources` + `useResource`（`file` 协议由 `workspaceFiles` 服务供数），不要自己起一套拉取。

## 八、Client 侧：席位、props 与实时呈现

画布不是「主区域」——Web Client 的 `main` 席位属于对话。可用的承载席位是：

| 需求 | 席位 | 说明 |
|------|------|------|
| 停靠式画布（与对话同屏） | `rightbar.session` → `sidebar.right.pane.tab` | 每个会话一份的停靠面，可打开/分栏/浮出/关闭；最贴近「画布工作台」的形态 |
| 全屏画布覆盖层 | `shell.overlay` | root 作用域覆盖层，适合沉浸式编辑与演示 |
| canvas.* 的实时卡片 | `tool.call.toolview` | `keyed` 槽位，按 wire 工具名接管渲染，即 F7.2 的「代码直播框」 |

> 注：`conversation.view`（会话视图环）**不再注册**——v1.8 起对话页面只保留宿主内置的「对话 / 轨迹」标签；卡片内容的展示走双击全屏预览（F3.8）与右栏产物 tab，`card-panel.tsx` 模块随之删除。

注册范式（模板同款，注意先 `inject` 再 `register`）：

```tsx
ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
  name: 'sidebar.right.pane.tab',
  id: 'dsh-canvas',
  order: 20,
  label: () => t('canvas.label'),
  inject: () => ({ actions, t, hooks: { board: boardSource } }),
}, (props: CanvasSlotProps) => <CanvasView {...props} />))
```

组件侧规则：

- 组件**拿不到 `ctx`**。数据从三条路进来：owner props、注册项的 `inject` 工厂（在 `apply` 世界里闭包捕获 Cordis service，只投影出数据与 callback）、以及声明的 slot store（仅承载共享的视图状态）。
- 框架标准 props 按作用域自动注入：`useSessions` / `useWorkspaces` / `usePanelInfo` 全域可用，`session` 作用域另有 `sessionId` / `useSession` / `useProjection` / `useConversation` / `useInput` / `inputActions`。画布对「卡片会话正在干什么」的实时呈现直接订阅 `useSession`，不需要自建轮询。
- 私有 observable 以裸 `getSnapshot` / `subscribe` 放进 `inject` 返回的 `hooks`，渲染层会转成 `useXxx(selector)` 并按其身份缓存绑定；**组件不直接调 `useSyncExternalStore`**。
- 样式**两套配色**：亮色是默认块，暗色由 `body[data-ds-dark-theme]` 覆盖（宿主在首帧前由预置引导写属性、之后由 ThemePresenter 维护，**亮色＝属性缺席**，插件不管理状态）。中性色骑宿主 `--dsw-alias-*` 真令牌（名字必须真存在——`tests/theme-tokens.spec.ts` 有白名单），画布专属面给两套显式值；样式表注入一次、类名加包前缀（v1.38）。
- 文案走 `ctx.locale.register(NS, { zh, en })` + `LocaleNamespaceMap` 声明合并，两个字典键必须齐全。
- 别的功能插件只以 `import type` 引入声明，**绝不导入其运行时值或组件**。

### 预览帧与元素选择探针

HTML 家族的预览是一个 `sandbox="allow-scripts"`、**不给** `allow-same-origin` 的 iframe：页面跑在不透明源里，父子互相看不见 DOM，`postMessage` 是唯一通道。元素选择（F3.14）因此被切成三块——**一份脚本源码 + 一段注入 + 一组纯决策**，与链接闸门同源同构（`core/artifact/preview-picker.ts`）：

- host 侧把探针脚本追加进预览文本（`injectPreviewPicker`，幂等，与 `injectPreviewLinkGuard` 同一套做法）；
- 客户端只发**目标态**（`pickOrder(pickMode(...))`：`enable` / `hold` / `disable`），帧回话一律按**不可信内容**逐字段校验并重建（`readsPick`、`isPickEscape`）；
- 探针默认是死的：不接到第一个目标态之前一个像素都不画、一条消息都不发。

**三个态**，`pickMode` 是它们唯一的命名处——框开着压过正在挑，两者都没有就是收起：

| 态 | 什么时候 | 帧里（探针） | 帧外（弹窗） |
|---|---|---|---|
| `aim` | 按下工具按钮之后 | 只读；跟随鼠标画高亮；**滚轮留给页面**；十字光标 | 一条浮在帧上的说明条 |
| `hold` | 一笔选定、提示词框开着 | 只读**且冻住**：不再跟随、十字收回、滚轮拦下、**滚动位置钉住** | 选中圈（改动在跑时亮流光）+ 提示词框 |
| `off` | × / Esc / 再按一次工具 | 探针收起，页面原样还回来 | 什么都没有 |

**开模式 = 页面只读**。参照物是浏览器调试工具的元素选择：指向哪儿圈哪儿，页面一动不动。这件事**逐层兑现，缺一层就漏**：

| 层 | 做什么 | 少这一层会漏掉什么 |
|---|---|---|
| 只读层 | 一块盖满视口的透明层：`position:fixed`、`z-index:2147483647`、`pointer-events:auto`——自己这几层浮层里**只有它接鼠标**；光标由它出示（`aim` 时十字，`hold` 时收回平常样子） | 页面元素继续收到悬停：`:hover` 照样亮、元素自己声明的 `cursor` 与 `title` 照样生效 |
| 捕获期拦截 | 在 `window` 捕获阶段拦下指针族、鼠标族（`contextmenu`、`dragstart`、`selectstart` 在内）**以及 `mousemove`** | 元素级处理器是收不到了，但页面挂在 `document` / `window` 上的**委托**处理器仍会收到从只读层冒上来的事件 |
| 焦点闸 | 进模式时请走页面已有的焦点；此后 `focusin` 一律请出去 | Tab 键能把焦点落到输入框上，键盘输入就进了页面 |
| 滚动冻结 | 只在 `hold`：`wheel` 拦下并吞掉，同时把 `pageXOffset/pageYOffset` 钉在进这一态那一刻 | 用户在框里写着要求，页面在底下滑走——圈住的位置不再是他说的那个元素 |

四处实现要点，都是踩过才知道的：

- **命中测试必须把自己筛掉**：只读层就在鼠标底下，`document.elementsFromPoint` 自上而下取第一个**不带** `data-dsh-canvas-picker` 记号的元素（`PREVIEW_PICKER_MARK`）；没有 `elementsFromPoint` 的老浏览器把只读层临时让开一次再问，**问完必须放回去**。少了这一步，「鼠标底下是谁」的答案永远是只读层自己。
- **指针那一族只挡不吞**：对一个 `pointerdown` 调 `preventDefault` 会连带压掉后续的兼容鼠标事件，而选择正靠 `click`。所以 `pointer*` 只 `stopPropagation`，`mouse*` 那一族才挡下并吞掉默认动作（焦点、选区、拖放、右键菜单都从那儿断）。**`mousemove` 跟着一起吞**：跟随是高亮的事、只在 `aim` 里做，但拦不拦是只读的事、三个态都要做。
- **滚轮分两档**：`aim` 时留给页面（不放行则下半页的元素根本够不着），`hold` 时拦下。写这一条必须显式 `{ passive: false }`——浏览器对 `window` 上的 `wheel` 监听**默认是 passive 的**，不写就等于 `preventDefault` 空转、页面照样滚。
- **位置也要钉**：拖滚动条与键盘滚动**不给页面任何可拦的事件**，只有位置能作准——进 `hold` 时记下滚动位置，`scroll` 事件里把它拨回去。滚轮那条管得住事件，这条管得住剩下的一切。

**这一笔的寿命**（`client/artifact/element-pick/`）：挑 → 写 → 等。发送之后框**不收**——圈上亮起与卡片**同一道**流光（同一个 `.dsh-canvas-shimmer`、同一趟 keyframes；动作只有一套语义：光在动 = 正在产出，卡片说的是「这张卡在生成」，这里说的是页面上那一段在改），框留在元素旁边等产物真的变（`revision` 每动一次回读一次，读到文本与发出时不同即落地）。落地后框自己收起，**除非**用户在这期间又写了下一句（`draft !== sent`）——那句还没发出去，不能替他丢掉。

而这一笔**跨得过去一次关闭**：弹窗是按卡挂载的，关掉就整棵卸掉，所以这一笔按 `projectId/cardId` 记在模块级的表里（`pending.ts`，**不落盘、不跨页刷新**，只是比组件活得久）。重开时圈、框与草稿摆回原样；**用户明确放手（框上的 × / Esc）或这一笔已经落地，记录就丢掉**——否则下次打开会弹出一个早办完的框。

**帧的矩形是这一笔的锚，而它是活的量，不是快照**。圈与提示词框写的是**视口坐标**，坐标在这一笔出生那一刻量好；而帧所在的那一栏是弹窗的最后一个可伸缩行——**任何**排到它上方的东西（我们的回话、截断提示、窗口被缩放、画布被拉动）都会把它整个挪走或压扁，覆盖层自己不会知道。所以拿着 iframe 的那一方在握着一笔时持续报告帧的矩形（`PickChannel.onMoved`）：每次提交量一遍（我们自己的界面变了就是这一次提交）、`ResizeObserver` 盯帧自己的大小、`window` 的 `resize` 盯视口；来了就换掉这一笔的锚——`frameMoved` 用半像素容差挡住亚像素抖动，否则每次排版都要白渲染一次。量在 `useLayoutEffect` 里做：量到新位置到重渲染之间不能让浏览器画一帧，不然圈会先错开一下再跳回去。

同一条判据管着提示条**自己**：元素选择那两条（`aim` 的「正在选元素」与发送之后的回话）都**浮在帧上、不占排版位**（`.dsh-canvas-frame-notestack`）。这两条说的都是**我们**正在做的这件事，而且都出现在圈已经画好之后——排进流里就会在出现或消失的那一瞬把帧顶走一整条（实测 43px），圈与框整个错开。链接闸门那条仍排在流里：它说的是页面自己的事，且页面可交互时才会出现（那时手里没有锚）。回话带一个可点的 ×，所以只有那一条自己把指针开回来——代价是它盖住帧顶上那一条，与它从前排在流里占掉的高度相当，随 × 收起。

**已知取舍**：只读层盖住整块视口，所以**页面自己的内层滚动容器在 `aim` 里滚不动**（滚轮到达的是只读层，默认动作只滚文档本身）；文档级滚动在 `aim` 里不受影响，在 `hold` 里连它也没有。验收判据在 `.workbuddy/e2e/element-pick.js`：所有「页面有没有动」都取自**页面自己的痕迹**（它自己的 `:hover` 计算色、它自己与委托两级的处理器计数器、`document.activeElement`、选区、滚动位置），并在开模式之前先跑一遍对照（证明这一页本来是活的）；判据一律判**增量**，不判「绝对值为零」。而「圈有没有被挪动」判的是**两个现量的差**：高亮框的视口矩形 vs 帧此刻的矩形加上元素此刻在帧里的位置（`framePoint` 一次量齐），再加一条「帧矩形一寸没变」；E2E 里 ⑦.2 那一组还会从外面往条带插槽里**塞一条 40px 的横条**再撤走——验的是「帧一旦挪窝，圈与框都跟着」这条**不变量**，而不是某一条特定提示。（修复前对照：这三条全红，帧 `top 51 → 94`。）

## 九、文件读写与编辑回流

一切文件访问走宿主的文件系统 seam `ctx.fs`（远程/沙箱工作区同样适用），不直接用 `node:fs`：

| 能力 | 接口 | 用途 |
|------|------|------|
| 定位与探测 | `resolve(path, { cwd })`、`stat`、`lstat`、`listDir` | 卡片 ↔ 文件的对应与存在性 |
| 读取 | `readText`、`streamText`、`readBytes`、`readByteRange` | 摘要提取、预览、缩略图 |
| 写入 | `writeText(target, content, expected?, signal?, sandboxPolicy?)` | F8.1 双击改字写回源文件 |
| 编辑 | `editText(target, edit, { version })` | 结构化就地编辑 |
| 地址 | `contains`、`fileUrl`、`processPath` | 路径越界与 URL 生成 |

三个策略事件正好承接「用户操作回流」：

- `fs/write-intent`（waterfall）：写入前的单槽决策，首个返回意图的监听者接管，可实现「画布内编辑落进 pending buffer 而不是直接落盘」。
- `fs/edit-intent`（waterfall）：编辑意图的拦截与改写，F8.4「意图回流」的天然挂点。
- `fs/observed`（emit）：权威的读写观测记录，用于把「谁改了这个文件」同步给下游卡片与取材对账（F4.5）。

写入带**版本守卫**（`expected: FsWriteIntent` / `{ version }`），因此「Agent 刚改完、用户同时手改」不会静默互相覆盖。写入还需携带沙箱执行策略参数，卡片编辑要遵守部署的权限预设。

## 十、构建、质量与安装

`build.mjs` 用 esbuild 出两个 bundle：

```javascript
// 整个 @deepseek-ai/* 都由宿主提供，不只是 dsh-*：cordis 与 schemastery 也一样。
// 逐个枚举会把 schemastery 打进 Host 半，让插件在宿主的 Schema 类之外多出一个身份。
const dshExternal = ['@deepseek-ai/*']

// Host：ESM，Node 22
await build({ entryPoints: ['src/index.ts'], outfile: 'lib/index.js', bundle: true,
  format: 'esm', platform: 'node', target: ['node22'], sourcemap: true, external: dshExternal })

// Client：CJS，浏览器；react 等由宿主提供，用模块加载器外壳包住
await build({ entryPoints: ['src/client/index.tsx'], outfile: 'lib/client.js', bundle: true,
  format: 'cjs', platform: 'browser', target: ['es2022'], sourcemap: true, jsx: 'automatic',
  external: [...dshExternal, 'react', 'react-dom', 'react-dom/client',
             'react/jsx-runtime', 'react/jsx-dev-runtime', 'scheduler'],
  banner: { js: "window.__ModuleLoader__.load({ id: 'dsh-canvas', factory: (require) => { var module = { exports: {} }; var exports = module.exports;" },
  footer: { js: 'return module.exports; } });' } })
```

声明文件由 `tsc -p tsconfig.build.json` 单独产出到 `lib/types`（`emitDeclarationOnly`）。

| 脚本 | 内容 |
|------|------|
| `pnpm run build` | `node build.mjs && tsc -p tsconfig.build.json` |
| `pnpm run typecheck` | 对 `src` 与 `tests` 两个 program 各跑一次 `tsc --noEmit`（双端类型都要过） |
| `pnpm run lint` | eslint（flat config） |
| `pnpm run test` | vitest |
| `pnpm run check` | typecheck → lint → test → build（CI 跑的就是它） |

CI：**尚未落地**——仓库里还没有 `.github/workflows/`，`check` 目前靠本地跑。既定方案是 GitHub Actions + corepack + Node 22，`pnpm install --frozen-lockfile` 后执行 `pnpm run check`。

安装与调试：

```sh
pnpm install && pnpm run build
dsh plugin --profile web add .              # 本地目录安装
dsh plugin --profile web add github:you/dsh-canvas   # 从 Git 安装（会跑 prepare 构建）
dsh plugin --profile web remove dsh-canvas
```

Git 安装时 pnpm ≥10 会拦截 `prepare` 构建，需按 `dsh` 的提示在该 profile 的 `pnpm-workspace.yaml` 里加 `allowBuilds: { dsh-canvas: true }`——**该授权允许包在安装时执行代码，只对可信来源开放并锁定 commit**。开发期把包加进工作区软链后，`dsh-client-hmr` 会轮询客户端 bundle 变化并热重载（仅 sourcemap 变化不触发），Host 侧改动需重启 Web Harness。

## 十一、与初版技术设想的差异（必读）

| 项 | 初版设想 | 校准后机制 | 影响 |
|----|----------|------------|------|
| 插件清单 | `.deepseek-plugin/plugin.json` 声明 `inject: [tools, storage, ui, session]` | Harness 只认 `package.json` 的 `dsh.bundle` / `dsh.client`；`cordis.patch.yml` 挂载；`dsh.plugin.json` 面向注册表；依赖注入用 Cordis 的 `export const inject` | 清单写法重写，**无「ui」这类注入项** |
| Host 工具 | `ctx.tools.register('canvas_read_card', {...})` | `ctx.tools.register(defineTool({ name, description, parameters, output, execute }))`，需要 `inject: ['tools']` | 工具定义补 `output.schema` + `render`；名字须落在 `^[a-zA-Z0-9_-]+$`（§3.6） |
| 跨卡片调用 | Agent 直接持有 `canvas.getCard()` | 双端一律经 Typert Remote：契约 → Host manifest → Client 贡献 | 每个方法一条 descriptor，三处引用同一数组 |
| 页面/预览 | 自造 `preview(path) => Component` | 右栏 tab 类型注册表 + 资源地址认领 | 形态注册表一半落到宿主已有席位 |
| 取材存储 | 自建「画布元数据文件」 | `defineDomain` + `ctx.storageDomain.open()`，`domain/changed` 通知 | 不需要自造持久化与变更广播 |
| 会话创建 | 「创建卡片时自动创建独立会话」 | `ctx.sessions.create()` 归调用方 fiber；**不落盘**，必须经 agent 生命周期事务 | P0 的会话绑定需先打通 agent 工厂，工作量重估 |
| 会话隔离 | 靠 system prompt 约定 | 工具注册作用域 + `restrict` / `schemas(scope)` 的可见性过滤 | 隔离可被结构性保证，不必靠提示词 |
| 取材注入 | `agent.inject()` 抽象调用 | `agent.inject({ content, source: { kind: 'plugin', plugin } })`，追加持久化上下文但**不唤醒空闲 agent** | 响应策略（F5.7）需自行决定用 `inject` 还是直接发起轮次 |
| 连线底层 | 「读上游产物摘要」 | **改用 Harness 自己的 `@file` 文件引入**（v1.37）：边的一端是产物文件、另一端是会话，插件把上游产物**以工作区相对路径命名**（`@brief.md` / `@"my brief.md"` / 目录 `@site/`，逐字节复刻宿主语法），模型按需 `read`；产物摘要**并列保留**（不是回落） | 引用不复制内容 ⇒ 不会失效、不占预算、不被截断、无缓存失效时机；摘要仍负责「立刻把材料摆到眼前」（`read_sources` / `inject_card` / F5.7 `pull`） |
| 文件访问 | 直接 `fs.read` | `ctx.fs.*`（统一 seam，带版本守卫、沙箱策略、写前 waterfall） | 编辑回流与冲突处理有现成挂点 |
| 目录结构 | `ui/` + `tools/` 平铺 | `src/` 根＝入口 + 协议基座；`src/host/`（装配与 Remote 服务）、`src/core/{canvas,artifact,session}/`（纯逻辑）、`src/client/{wire,canvas,artifact,ui}/`（浏览器半），其中 `client/artifact/` 再分 `registry.ts` + `chrome.tsx`（插槽与两条登记通道）+ `viewers/` + `editing/` + `element-pick/`（v1.40 分层，v1.41 细化产物面，v1.42 把能力从注册表挪进各预览器）；`tests/` 镜像之 | 依赖层落成目录，非法依赖（`core/` → `host/`）看得见；两个构建入口路径不动，打包与清单不受影响。产物面按「一行一个预览器，能力长在预览器自己身上」再分，加一种形态不必回头改弹窗 |

## 十二、开放项（含已关闭项）

> 这一章是动手前必须钉死的点。**已关闭的保留在原位并划掉**，便于回溯当时为什么这样定；仍未关闭的按顺序编号。

1. ~~**工具名是否允许 `.`**~~ **已关闭（2026-09-17）**：实测把 `canvas.read_card` 这类名字发给模型供应商，请求被 400 拒绝——`Invalid 'tools[0].name': string does not match pattern. Expected a string that matches the pattern '^[a-zA-Z0-9_-]+$'`。宿主不对工具名做校验或改写，原样透传，所以字符集必须由插件自己守住。已全面改用 `canvas_read_card` 形式（§3.6 工具清单、`contract.ts` 的 `TOOL_NAMES`、`dsh.plugin.json` 的 `contributes.tools`、客户端 `tool.call.toolview` 的 keys 同步），并在 `tests/contract.spec.ts` 里用 `TOOL_NAME_PATTERN` 钉死。
2. **多卡片会话的并发与归属**：每张卡片一个 agent 是否可行（数量上限、并发轮次、资源占用），以及画布面板切换会话时的 fiber 生命周期。
3. **形态认定与 tab 认领的一致性**：Host 侧 `kind-registry` 的判定结果与 Client 侧 `patterns` / `canOpen` 必须给出一致答案，否则会出现「卡片显示为 A 形态、点开却是内置查看器」。
4. **PPTX 一秒级导出**（F10.2）的落地者：这取决于宿主是否已有 PPTX 生成能力，插件不应自带重型渲染引擎。
5. **发布**（F10.3）与子域名/回收的归属：需确认走宿主既有发布能力还是插件自建，避免与 Harness 的生命周期冲突。
6. **取材注入的上下文预算**（§3.5 F5.2）：摘要在域记录里缓存，还是每次注入现算；缓存则需定义失效时机。——**v1.37 基本关闭**：**默认通道不再有预算问题**——文件引用一个字的材料都不进上下文，模型按需 `read`，读哪一段也由它决定。产物摘要这一路仍是**每次现算、域记录里不缓存**，因为上游文件随时可被改写，缓存就得再定义失效时机，而现算的代价只是一次文件读；`summaryBudget` 只作用在这一路。这段历史里 v1.35 曾把预算交给宿主的 session-reference 服务现算，v1.37 撤销该通道后此路不复存在——问题的形状从「预算归谁算」变成了「根本不必预置材料」。
7. **为了"页面别动"，探针与页面本身抢方向盘**（v1.44）：`hold` 态把滚动位置钉住（`scroll` 里拨回进入这一态时的位置），于是**页面自己用 JS 滚动会被按回去**（`scrollIntoView`、轮播、锚点跳转都算）——这是有意的（用户正指着某一处写要求，画面就不该自己走），代价是这类页面在框开着时看起来「卡住」。同一支上还有 `aim` 态那条：**页面自己的内层滚动容器滚不动**（只读层整块盖住视口，滚轮只落到文档本身；选不到的元素得先退出模式滚过去）。两条都写进了 §8 的取舍，目前没有更好的做法——真要让内层容器也滚，就得放弃"整块盖住"的只读方案，而那会漏掉悬停那一族。
