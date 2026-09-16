# DeepSeek Harness 通用创作画布插件 · 产品文档

**版本**：v1.2
**状态**：产品设计定稿；技术架构已按 `dsh-plugin-template` 与 Harness 子系统文档校准
**定位**：以文件卡片为最小创作单元、以独立 Agent 会话为执行引擎、以取材关系为数据通道的无限画布工作台
**参考**：[dsh-plugin-template](https://github.com/bugmaker2/dsh-plugin-template)（双端插件模板）、[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`docs/cookbook/*`、`docs/subsystems/*`）


## 一、产品概述

### 1.1 一句话定义

一个运行在 DeepSeek Harness 上的插件，把项目组织成一张无限画布，画布上的每张文件卡片绑定一个独立的 Agent 会话，取材关系在卡片之间传递数据，最终产出 PPT、网页、文档、图表等任意文件形态。

### 1.2 核心设计理念

**文件即产物，卡片即会话，取材即数据。**

- **文件即产物**：画布上的一切与磁盘一一对应，产物形态由文件证据认定，不需要预先声明“这是 PPT 模式”或“这是网页模式”。
- **卡片即会话**：每张卡片绑定一个独立 Agent 会话，会话只负责当前卡片的产物生成，上下文天然隔离，互不污染。
- **取材即数据**：卡片之间只有一种连线——**取材**。B 取材于 A，表示 B 的产物建立在 A 的产物之上，这是唯一的显式数据通道：Agent 通过它拿上游产物作输入，而非自动感知全画布。

连线的语义被刻意收窄到只剩取样一个方向。改自、接着、对照、批注这些协作语义不再由连线表达，而是交给卡片命名、产物内引用与共享便利贴承载——**能靠约定表达的，就不该变成画布上的结构负担**。

### 1.3 与同类方案的区别

| 维度 | 传统 AI 创作工具 | 本插件 |
|------|----------------|--------|
| 上下文 | 单一长会话，上下文膨胀 | 每张卡片独立会话，按需注入 |
| 产物形态 | 预定义模式 | 文件证据自动认定，可扩展 |
| 协作方式 | 聊天框描述 | 取材关系显式传递数据 |
| Agent 可见范围 | 全部内容 | 仅当前卡片 + 显式引用 |
| 扩展方式 | 加功能分支 | 加形态注册表条目 |


## 二、核心概念

### 2.1 项目（Project）

一个项目对应一张无限画布，底层绑定一个工作区目录。项目是持久化、可分享、可复用的容器。

### 2.2 卡片（Card）

画布上的最小创作单元，与磁盘文件一一对应。卡片 id 即文件路径。卡片绑定的产物可以是单文件（如 `deck.html`），也可以是含 `index.html` 的目录（如站点）。

### 2.3 会话（Session）

每张卡片绑定一个独立的 Agent 会话。会话的 system prompt 注入当前卡片的元信息（路径、形态、项目风格），工具调用只作用于当前卡片绑定的文件。

### 2.4 取材（Source）

卡片之间的唯一有向连线：**B 取材于 A**，即 A 是 B 的上游产物来源。一张卡片可以有多个上游，也可以被多张卡片取材。

取材有两个来源：用户手动连线，以及**自动对账**——产物里真实引用到的素材，反向生成取材边。

取材数据独立于文件系统，作为画布元数据持久化。

### 2.5 形态（Kind）

产物的类型，由文件证据自动认定。一种形态对应注册表中的一个条目，定义寻址、预览、导出、发布方式。


## 三、功能点清单

### 3.1 无限画布空间

| 编号 | 功能点 | 说明 |
|------|--------|------|
| F1.1 | 无限延伸画布 | 节点可自由拖拽定位，支持缩放、框选、打组 |
| F1.2 | 文件系统映射 | 卡片 id 即文件路径，拖卡片进文件夹等于 `mv` |
| F1.3 | 实时同步 | 画布内容与磁盘文件系统双向实时同步 |
| F1.4 | 视图持久化 | 画布布局、缩放状态、卡片位置自动保存 |

### 3.2 文件形态注册表

| 编号 | 功能点 | 说明 |
|------|--------|------|
| F2.1 | 形态注册机制 | 一种产物形态一个注册表条目，含 detect/preview/export/publish |
| F2.2 | 文件证据认定 | 形态由文件扩展名和内容自动认定，不由用户声明 |
| F2.3 | 内置形态 | HTML Deck、站点、Markdown、图片、视频、数据图表 |
| F2.4 | 形态扩展 | 新增形态只需加注册表条目，不改散落分支 |

### 3.3 卡片-会话绑定

| 编号 | 功能点 | 说明 |
|------|--------|------|
| F3.1 | 会话自动创建 | 创建卡片时自动创建独立 Agent 会话 |
| F3.2 | 会话元信息注入 | system prompt 注入卡片路径、形态、项目风格档案 |
| F3.3 | 会话隔离 | 卡片 A 的会话看不到卡片 B 的对话历史和文件内容 |
| F3.4 | 会话持久化 | 对话历史持久化，卡片重开时自动恢复 |
| F3.5 | 会话状态指示 | 卡片上显示会话状态（空闲/运行中/有通知） |
| F3.6 | 卡片切换 | 点击卡片切换到对应会话面板 |

### 3.4 取材关系

| 编号 | 功能点 | 说明 |
|------|--------|------|
| F4.1 | 取材关系 | 卡片之间唯一的连线类型：B 取材于 A。有向、可多重（一张卡片可有多个上游、也可被多张卡片取材） |
| F4.2 | 取材建立 | 从卡片拖线到另一张卡片即建立，不需要选择类型，只需要定方向 |
| F4.3 | 取材持久化 | 取材数据作为画布元数据独立存储 |
| F4.4 | 取材可视化 | 统一线型展示（虚线 + breeze 色），箭头由上游指向下游 |
| F4.5 | 自动对账 | 产物中真实引用的素材自动生成取材边（HTML 里的 `src`、Markdown 里的图片链接等） |
| F4.6 | 上游链排布 | 按取材链分层：上游在左、下游在右，同层对齐 |
| F4.7 | 上游追溯 | 查看当前卡片的完整上游链（含间接上游），以及取材于它的下游卡片 |

### 3.5 取材作为输入通道

| 编号 | 功能点 | 说明 |
|------|--------|------|
| F5.1 | 拉模式注入 | Agent 或用户主动调用工具获取上游产物摘要 |
| F5.2 | 摘要注入 | 注入内容为文件路径+内容摘要+关键结构，非全文 |
| F5.3 | 显式引用 | 用户可通过 `@cardId` 将指定卡片注入当前会话 |
| F5.4 | 快照式引用 | 注入的是引用时的内容快照，非实时同步 |
| F5.5 | 引用追溯 | 可查看哪些卡片被当前会话引用过 |
| F5.6 | 变更通知 | 上游变更时向下游发送轻量事件 |
| F5.7 | 响应策略 | 每张卡片可配置：静默忽略/注入提醒/自动拉取 |

### 3.6 Agent 跨卡片工具集

| 工具名 | 功能 | 参数 |
|--------|------|------|
| `canvas.read_card` | 读取指定卡片产物摘要 | `cardId` |
| `canvas.read_sources` | 读取当前卡片所有上游（取材来源）的产物摘要 | 无 |
| `canvas.link_source` | 声明本卡片取材于另一张卡片 | `sourceCardId` |
| `canvas.get_sources` | 获取当前卡片的取材链（直接上游、间接上游、下游） | 无 |
| `canvas.inject_card` | 将指定卡片产物注入当前会话 | `cardId, mode: 'summary' \| 'full'` |
| `canvas.read_board` | 读取画布当前座次与取材边 | 无 |
| `canvas.arrange_on_board` | 按取材链语义化摆位 | `strategy` |
| `canvas.create_on_board` | 创建便签或卡片 | `type, content` |
| `canvas.organize_board` | 归纳收纳 | 无 |
| `canvas.link_source_on_board` | 画取材线 | `from, to` |
| `canvas.generate_image` | 生图 | `prompt, cardId` |
| `canvas.export` | 导出产物 | `cardId, format` |
| `canvas.publish` | 发布产物 | `cardId` |

### 3.7 Agent 在画布上“在场”

| 编号 | 功能点 | 说明 |
|------|--------|------|
| F7.1 | 可见角色 | Agent 以角色形象出现在画布上 |
| F7.2 | 工作跟随 | 干活时贴着正在编辑的卡片，显示代码直播框 |
| F7.3 | 空闲态 | 空闲时停在视野内，写一句“刚才干了什么” |
| F7.4 | 直接对话 | 用户可点击 Agent 搭话，不等它闲下来 |
| F7.5 | 操作映射 | 每步行动映射为画布视觉事件 |

### 3.8 产物级直接编辑

| 编号 | 功能点 | 说明 |
|------|--------|------|
| F8.1 | 双击改字 | 直接写回源文件 |
| F8.2 | 元素评论与圈选 | 截图进 pending buffer，下轮 Agent 自动带上 |
| F8.3 | 拖拽与样式调整 | 以结构化意图落地 |
| F8.4 | 意图回流 | 用户操作作为结构化意图注入 Agent 下一轮上下文 |

### 3.9 项目级记忆

| 编号 | 功能点 | 说明 |
|------|--------|------|
| F9.1 | 风格档案 | 每个项目独立的配色、字体、语气偏好 |
| F9.2 | 用户偏好继承 | 用户偏好跨项目可继承 |
| F9.3 | 共享便利贴 | 画布上的便利贴作为共享决策记录 |
| F9.4 | 会话恢复 | 恢复会话时自动加载项目记忆 |

### 3.10 导出与发布

| 编号 | 功能点 | 说明 |
|------|--------|------|
| F10.1 | 多格式导出 | HTML / PDF / PPTX / PNG / SVG / zip |
| F10.2 | 即时导出 | 可编辑 PPTX 导出应在一秒级完成 |
| F10.3 | 一键发布 | 发布到子域名，下线即回收 |
| F10.4 | Agent 触发 | 导出和发布注册为工具，Agent 可自动调用 |


## 四、技术架构

> 本章已按官方双端插件模板 [`dsh-plugin-template`](https://github.com/bugmaker2/dsh-plugin-template) 与 DeepSeek Harness 子系统文档校准（模板源码、`docs/cookbook/*`、`docs/subsystems/*`）。**§4.11 集中列出与初版技术设想不一致之处及其影响**，请优先阅读。

### 4.1 技术底座：双端插件

本插件是一个**双端插件**：Host 半跑在 Node（Cordis 插件），Client 半跑在浏览器（Web harness 模块）。

| 项 | 结论 |
|----|------|
| Host 入口 | `src/index.ts`，导出 `name` / `inject` / `Config`（schemastery 校验 + 默认值）/ `apply(ctx, config)` |
| Client 入口 | `src/client/index.tsx`，导出 `inject`（`slots` / `remote` / `locale`）/ `apply(ctx: ClientContext)` |
| 双端通信 | Typert Remote：Host 侧 `TypertRemoteService` + `@Remote` 方法，浏览器侧经 `ctx.remote.<namespace>` 调用 |
| 浏览器加载 | 打包为 `lib/client.js`，由 `window.__ModuleLoader__.load` 注册，Web harness 的模块加载器按 `dsh.client` 扫描结果加载 |
| 依赖要求 | Node `^22.19 \|\| >=24`，pnpm `>=9`（模板用 10），`dsh >=0.1.0-rc.6` |
| 插件清单 | Harness 唯一必需的是 `package.json`；`dsh.plugin.json` 面向 dsh.so 注册表，`cordis.patch.yml` 负责把 Host 插件行挂进 profile |

### 4.2 插件目录结构

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
├── .github/workflows/ci.yml
├── src/
│   ├── index.ts              # Host 入口：Config schema + apply
│   ├── runtime.ts            # CanvasRuntime：画布/取材链/排布（Remote 服务）
│   ├── card-runtime.ts       # CardRuntime：卡片产物读写/注入/导出/发布
│   ├── contract.ts           # 双端共享的严格 wire 契约（唯一真源）
│   ├── typert.ts             # Host Typert manifest
│   ├── types.ts              # 双端共享类型
│   ├── domain.ts             # 画布持久化领域声明（defineDomain）
│   ├── tools.ts              # canvas.* 工具注册（defineTool）
│   ├── prompt.ts             # 卡片会话的 prompt 注入段落
│   ├── core/                 # 纯逻辑层，不依赖 Cordis
│   │   ├── kind-registry.ts
│   │   ├── source-store.ts
│   │   └── session-manager.ts
│   └── client/
│       ├── index.tsx         # Client 入口：mount Remote + 注册席位
│       ├── remote.ts         # Client Remote 贡献 + 类型化 namespace
│       ├── canvas-tab.ts     # 右栏 tab 类型的静态定义（形态认领）
│       ├── canvas-view.tsx   # 无限画布正文
│       ├── card-component.tsx
│       ├── session-panel.tsx
│       ├── tool-view.tsx     # canvas.* 的实时工具卡片（代码直播框）
│       ├── locales.ts
│       └── styles.ts
├── skills/                   # 可选：随包的 Agent 行为技能
│   └── canvas-operations/SKILL.md
└── tests/
    ├── contract.spec.ts
    └── runtime.spec.ts
```

与初版设想的差别：UI 不放在独立 `ui/` 目录，而是 `src/client/`（浏览器半）；Host 能力的落点不是 `tools/*.ts` 里的裸函数，而是**两个 Remote 服务类 + 一个工具注册模块**。

### 4.3 清单三件套与命名一致性

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
        "@deepseek-ai/dsh-client-ui-primitives"
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
  "contributes": { "tools": ["canvas.read_card", "canvas.read_related", "..."], "skills": ["canvas-operations"] }
}
```

> `contributes` 字段本身在模板中存在（模板填的是空数组），其**条目格式**尚未核对注册表文档——发布前需确认这里是工具名清单还是完整贡献对象。

**改名时必须同步的位置**（模板经验，缺一处即加载失败或运行期失联）：

| 位置 | 字段 |
|------|------|
| `package.json` | `name`、`exports`、`files` |
| `build.mjs` | `__ModuleLoader__.load` 的 `id` |
| `src/index.ts` | `name`（须与包名、`cordis.patch.yml` 一致） |
| `src/client/remote.ts` | `TypertRemoteNamespace$<hex>` 十六进制命名空间名 |
| `src/client/locales.ts` | locale namespace key |
| `src/client/canvas-tab.ts` | tab 类型 `id` / `kind` |
| `src/typert.ts` | `package` |
| `src/contract.ts` | invocation `id` |
| `cordis.patch.yml` | `id`、`name` |
| `dsh.plugin.json` | `id` |

包名为 `dsh-canvas` 不是随意的：服务键 `canvas` 的十六进制命名空间名是 `TypertRemoteNamespace$63616e766173`，`card` 是 `TypertRemoteNamespace$63617264`（`canvas` → 63 61 6e 76 61 73）。

### 4.4 契约层：一份 descriptors，三处引用

双端不漂移的机制是**单一真源**：一份 wire 契约同时被 Host manifest 与 Client 贡献引用。

```typescript
// src/contract.ts —— 双端共享的严格 wire 契约（唯一真源）
import { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

export const cardIdSchema = z.string().trim().min(1).max(200)
export const cardSummarySchema = z.object({
  path: z.string(), kind: z.string(),
  summary: z.string(), outline: z.array(z.string()),
  lastModified: z.number(),
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
// src/client/remote.ts —— Client 贡献：与 Host manifest 指向同一个数组
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

### 4.5 Host 侧：服务划分与核心模块

| 模块 | 职责 | 归属 |
|------|------|------|
| `CanvasRuntime`（namespace `canvas`） | 画布座次、取材边增删查、上游链排布、归纳收纳、便签创建 | `src/runtime.ts` |
| `CardRuntime`（namespace `card`） | 卡片产物摘要读取、上游（取材来源）读取、跨卡片注入、导出、发布、生图 | `src/card-runtime.ts` |
| `kind-registry` | 文件证据 → 形态认定（纯函数：扩展名 + 内容嗅探） | `src/core/` |
| `source-store` | 取材边的增删查与自动对账，落在存储领域之上 | `src/core/` |
| `session-manager` | `cardId → sessionId` 绑定、会话状态（空闲/运行中/有通知） | `src/core/` |

```typescript
// src/runtime.ts —— Host Remote 服务
export class CanvasRuntime extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'canvas') }

  /** 读取画布当前座次与取材边。 */
  @Remote
  async readBoard(signal?: AbortSignal): Promise<BoardSnapshot> { /* … */ }

  /** 按取材链分层摆位。 */
  @Remote
  async arrange(strategy: ArrangeStrategy, signal?: AbortSignal): Promise<BoardSnapshot> { /* … */ }
}
```

**Agent 工具注册**用的是 Harness 的工具流水线，而不是裸函数（`inject: ['tools']`）：

```typescript
// src/tools.ts
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-canvas'
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'canvas.read_sources',
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

**卡片元信息注入系统提示词**：用 `ctx.systemPrompt.section()` / `.context()` / `.variable()` 在卡片会话的作用域内注册段落与动态上下文（路径、形态、项目风格档案、上游取材来源摘要），作用域内条目遮蔽全局同名条目；一次性提醒走 `agent.inject({ content, source: { kind: 'plugin', plugin: 'dsh-canvas' } })`——它追加的是持久化上下文，下一次模型请求即可见，但**不会唤醒空闲 agent**。

### 4.6 数据模型与持久化

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

### 4.7 形态注册表落在哪个席位

初版把形态注册表设想成一个自造 registry。校准后的结论是：**形态的两半分别落在已有机制上**。

| 半 | 机制 | 说明 |
|----|------|------|
| Host 认定 | `src/core/kind-registry.ts` + `ctx.fs` | 由扩展名与内容证据判定 `kind`，结果写进 domain 的 `cards` 记录 |
| Client 认领与预览 | **右栏 tab 类型注册表** `ctx.sidebarRightTabs.register()` | 按资源地址 glob 认领，用 `priority` 分档压过内置查看器 |

```typescript
// src/client/canvas-tab.ts —— 一种形态 = 一个 tab 类型
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

### 4.8 Client 侧：席位、props 与实时呈现

画布不是「主区域」——Web Client 的 `main` 席位属于对话。可用的承载席位是：

| 需求 | 席位 | 说明 |
|------|------|------|
| 停靠式画布（与对话同屏） | `rightbar.session` → `sidebar.right.pane.tab` | 每个会话一份的停靠面，可打开/分栏/浮出/关闭；最贴近「画布工作台」的形态 |
| 全屏画布覆盖层 | `shell.overlay` | root 作用域覆盖层，适合沉浸式编辑与演示 |
| 卡片会话面板 | `conversation.view` | `list` + `session` 作用域，会话视图环里的一个 tab，点卡片即切到该会话 |
| canvas.* 的实时卡片 | `tool.call.toolview` | `keyed` 槽位，按 wire 工具名接管渲染，即 F7.2 的「代码直播框」 |

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
- 样式走主题 token（`--dsw-*` / `--ds-*`）并只留中性兜底值，跟随宿主主题；样式表注入一次、类名加包前缀。
- 文案走 `ctx.locale.register(NS, { zh, en })` + `LocaleNamespaceMap` 声明合并，两个字典键必须齐全。
- 别的功能插件只以 `import type` 引入声明，**绝不导入其运行时值或组件**。

### 4.9 文件读写与编辑回流

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

### 4.10 构建、质量与安装

`build.mjs` 用 esbuild 出两个 bundle：

```javascript
const dshExternal = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-*']

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

CI：GitHub Actions + corepack + Node 22，`pnpm install --frozen-lockfile` 后执行 `pnpm run check`。

安装与调试：

```sh
pnpm install && pnpm run build
dsh plugin --profile web add .              # 本地目录安装
dsh plugin --profile web add github:you/dsh-canvas   # 从 Git 安装（会跑 prepare 构建）
dsh plugin --profile web remove dsh-canvas
```

Git 安装时 pnpm ≥10 会拦截 `prepare` 构建，需按 `dsh` 的提示在该 profile 的 `pnpm-workspace.yaml` 里加 `allowBuilds: { dsh-canvas: true }`——**该授权允许包在安装时执行代码，只对可信来源开放并锁定 commit**。开发期把包加进工作区软链后，`dsh-client-hmr` 会轮询客户端 bundle 变化并热重载（仅 sourcemap 变化不触发），Host 侧改动需重启 Web Harness。

### 4.11 与初版技术设想的差异（必读）

| 项 | 初版设想 | 校准后机制 | 影响 |
|----|----------|------------|------|
| 插件清单 | `.deepseek-plugin/plugin.json` 声明 `inject: [tools, storage, ui, session]` | Harness 只认 `package.json` 的 `dsh.bundle` / `dsh.client`；`cordis.patch.yml` 挂载；`dsh.plugin.json` 面向注册表；依赖注入用 Cordis 的 `export const inject` | 清单写法重写，**无「ui」这类注入项** |
| Host 工具 | `ctx.tools.register('canvas.read_card', {...})` | `ctx.tools.register(defineTool({ name, description, parameters, output, execute }))`，需要 `inject: ['tools']` | 工具定义补 `output.schema` + `render` |
| 跨卡片调用 | Agent 直接持有 `canvas.getCard()` | 双端一律经 Typert Remote：契约 → Host manifest → Client 贡献 | 每个方法一条 descriptor，三处引用同一数组 |
| 页面/预览 | 自造 `preview(path) => Component` | 右栏 tab 类型注册表 + 资源地址认领 | 形态注册表一半落到宿主已有席位 |
| 取材存储 | 自建「画布元数据文件」 | `defineDomain` + `ctx.storageDomain.open()`，`domain/changed` 通知 | 不需要自造持久化与变更广播 |
| 会话创建 | 「创建卡片时自动创建独立会话」 | `ctx.sessions.create()` 归调用方 fiber；**不落盘**，必须经 agent 生命周期事务 | P0 的会话绑定需先打通 agent 工厂，工作量重估 |
| 会话隔离 | 靠 system prompt 约定 | 工具注册作用域 + `restrict` / `schemas(scope)` 的可见性过滤 | 隔离可被结构性保证，不必靠提示词 |
| 取材注入 | `agent.inject()` 抽象调用 | `agent.inject({ content, source: { kind: 'plugin', plugin } })`，追加持久化上下文但**不唤醒空闲 agent** | 响应策略（F5.7）需自行决定用 `inject` 还是直接发起轮次 |
| 文件访问 | 直接 `fs.read` | `ctx.fs.*`（统一 seam，带版本守卫、沙箱策略、写前 waterfall） | 编辑回流与冲突处理有现成挂点 |
| 目录结构 | `ui/` + `tools/` 平铺 | Host 在 `src/`，浏览器在 `src/client/`，纯逻辑在 `src/core/` | 目录树重排 |

### 4.12 需要在动手前钉死的开放项

1. **工具名是否允许 `.`**：`canvas.read_card` 这类名字需与宿主工具名的字符集约定核对；不允许则改用 `canvas_read_card`，但影响 §3.6 的工具清单与 `tool.call.toolview` 的 keys。
2. **多卡片会话的并发与归属**：每张卡片一个 agent 是否可行（数量上限、并发轮次、资源占用），以及画布面板切换会话时的 fiber 生命周期。
3. **形态认定与 tab 认领的一致性**：Host 侧 `kind-registry` 的判定结果与 Client 侧 `patterns` / `canOpen` 必须给出一致答案，否则会出现「卡片显示为 A 形态、点开却是内置查看器」。
4. **PPTX 一秒级导出**（F10.2）的落地者：这取决于宿主是否已有 PPTX 生成能力，插件不应自带重型渲染引擎。
5. **发布**（F10.3）与子域名/回收的归属：需确认走宿主既有发布能力还是插件自建，避免与 Harness 的生命周期冲突。
6. **取材注入的上下文预算**（§3.5 F5.2）：摘要在域记录里缓存，还是每次注入现算；缓存则需定义失效时机。


## 五、MVP 范围

### 第一版实现

| 优先级 | 功能 |
|--------|------|
| P0 | 双端插件骨架：清单三件套 + 契约层（一份 descriptors）+ 一个 Remote 服务跑通 |
| P0 | 画布席位落地：右栏停靠席位渲染无限画布，卡片位置写入存储领域 |
| P0 | 卡片-会话绑定：创建卡片时经 agent 生命周期创建会话，关闭时保留 |
| P0 | 文件驱动画布：卡片 ↔ 磁盘文件一一对应（经 `ctx.fs`，卡片 id 为工作区相对路径） |
| P0 | 形态注册表：至少支持 `html-deck` 和 `site`（Host 认定 + Client tab 类型认领） |
| P0 | `canvas.read_sources` 工具：Agent 能读取上游取材卡片产物摘要 |
| P0 | 取材边：唯一连线类型，手动连线 + 自动对账两条来源都要通 |
| P0 | 取材数据持久化：存入画布存储领域，`domain/changed` 驱动画布刷新 |
| P1 | 直接编辑：双击改字经 `ctx.fs.writeText`（带版本守卫）写回源文件 |
| P1 | 导出：HTML / PDF / PPTX |
| P1 | Agent 在场：`tool.call.toolview` 实时呈现 canvas.* 调用，文件写入时卡片内容实时更新 |

### 技术前置条件（v1.1 新增）

- 卡片会话必须走 **agent 生命周期事务**创建，否则不落盘——这是 P0 里技术风险最高的一项，建议最先打通最小闭环（建一张卡片 → 建一个会话 → 会话落盘 → 重开恢复）。
- 形态认定必须在 Host 与 Client 两侧给出一致答案（见 §4.12 第 3 条），否则预览会错位。
- 工具名字符集（§4.12 第 1 条）未定前，先不要冻结 §3.6 的工具清单与工具卡片槽位键。

### 后续迭代

- 取材边的手动连线交互完善（拖拽改接、批量连线）
- 自动变更通知与响应策略
- 会话间 `@引用`
- 取材链可视化：链路高亮、层级折叠、上游追溯面板
- 项目级记忆
- 一键发布
- 更多形态注册表条目


## 六、设计决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 取材注入模式 | 拉模式优先 | 会话隔离干净，上下文可控，避免膨胀 |
| 会话可见范围 | 仅当前卡片 + 显式引用 | 防止上下文污染，聚焦单一产物 |
| 连线范畴 | 只保留「取材」一种 | 语义被收窄后，画布结构不会随协作话术膨胀；其余语义交给命名、产物内引用与便利贴 |
| 形态认定 | 文件证据自动认定 | 通用性自然获得，加形态不改分支 |
| 卡片 id | 文件路径 | 与文件系统一一对应，无需额外映射 |
| 取材存储 | 画布元数据独立于文件 | 文件系统不擅长表达跨文件依赖 |
| 引用方式 | 快照式 | 可追溯，避免实时同步的复杂性 |
| 双端形态 | 双端插件（Host Cordis + Client Web） | 画布是重交互 UI，必须跑在浏览器半；Host 半持有文件、会话与工具 |
| 双端通信 | 一份 wire 契约，三处引用 | Host manifest 与 Client 贡献指向同一 descriptor 数组，结构上不可能漂移 |
| 数据落点 | 存储领域（domain）而非自建文件 | 复用后端路由、版本校验、写链与 `domain/changed` 通知 |
| 会话隔离手段 | 工具注册作用域 + 可见性过滤 | 把隔离做成结构约束，而不是提示词约定 |
| 文件访问 | 统一走 `ctx.fs` seam | 自带版本守卫、沙箱策略与写前 waterfall，直接可用 |
| 画布承载席位 | 右栏停靠面为主、全屏覆盖层为辅 | Web Client 主区域属于对话，不自造席位 |
| 产物预览 | 复用右栏 tab 类型注册表 | 按资源地址认领，`extension` 档压过内置查看器，卸载即恢复 |


## 七、产品边界

### 做什么

- 通用文件产物的创作与管理
- 卡片级会话隔离与取材驱动协作
- 任意形态的产物生成（PPT、网页、文档、图表等）

### 不做什么

- 不做实时多人协作编辑
- 不做文件版本控制系统（依赖底层文件系统）
- 不做独立的模型服务（复用 Harness 模型适配层）
- 不做重型渲染引擎（预览依赖浏览器能力）
- 不做通用关系图谱／语义网络（连线只有取材一种，其余协作语义不由结构承载）

---

## 附录 · 修订记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | — | 产品设计定稿：七大章节，功能点清单 F1.1–F10.4 |
| v1.1 | 2026-09-15 | 按 `dsh-plugin-template` 与 Harness 子系统文档校准**第四章技术架构**：改为双端插件（Host Cordis + Client Web）；清单从 `.deepseek-plugin/plugin.json` 改为 `package.json` + `cordis.patch.yml` + `dsh.plugin.json`；工具注册改为 `defineTool` + `ctx.tools.register`；双端通信确立为「一份 wire 契约、三处引用」；关系存储落到存储领域（`defineDomain` + `domain/changed`）；形态注册表拆为 Host 认定 + Client 右栏 tab 类型认领；新增席位选择、文件读写与编辑回流、构建质量与安装三节；新增 §4.11 差异纪要与 §4.12 六个开放项；§五 补双端骨架与画布席位两条 P0 及技术前置条件；§六 补四条决策。 |
| v1.2 | 2026-09-15 | **去掉关系线系统，只保留「取材」一种连线。** §1.1／§1.2／§1.3 改为「取材即数据」；§2.4「关系」改为「取材」（含手动连线与自动对账两个来源）；§3.4 由七条六类关系改为 F4.1–F4.7 的取材边清单（建立、持久化、可视化、自动对账、上游链排布、上游追溯）；§3.5 标题改为「取材作为输入通道」；§3.6 工具改名（`read_related`→`read_sources`、`link_card`→`link_source`、`get_relations`→`get_sources`、`relate_on_board`→`link_source_on_board`，去掉 `relationType` 参数）；§4 同步：`core/relation-store.ts`→`source-store.ts`、domain 的 `relations` 表→`sources` 表（`downstream`/`upstream`/`origin`）、`Relation` 接口→`Source`、契约示例改为 `dsh-canvas#card/read_sources`；§5 删除「先支持取材关系」与「六类关系完整支持」，改为取材边两条来源；§6 增「连线范畴」决策；§7 增「不做通用关系图谱」边界。 |

**文档结束。**

如需进一步展开某个模块的详细设计（形态注册表的完整 TypeScript 接口、会话管理器的状态机、取材注入的上下文预算策略、契约层完整 descriptor 表），可以继续讨论。
