# DeepSeek Harness 通用创作画布插件 · 技术文档

**版本**：v1.57
**最近更新**：2026-09-24
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
│   │   ├── canvas-runtime.ts     # CanvasRuntime：画布/引用链/排布（Remote 服务）
│   │   ├── card-runtime.ts       # CardRuntime：卡片产物读写/注入/导出/发布
│   │   ├── tools.ts              # canvas_* 工具注册（defineTool × 16）
│   │   ├── prompt.ts             # 卡片会话的 prompt 注入段落
│   │   └── board-file.ts         # 板面投影的读写（接 ctx.fs + 从域的表组装）
│   ├── core/                 # 纯逻辑层，不依赖 Cordis
│   │   ├── canvas/               # 画布模型
│   │   │   ├── ids.ts                # 存储键的定宽转义 + 路径摘要身份
│   │   │   ├── board.ts              # 排布策略
│   │   │   ├── board-file.ts         # 板面文件：格式/编解码 + 身份与导入决策（纯）
│   │   │   ├── card-name.ts          # 卡片名与产物路径的对齐：默认名 / 建卡铸名 / 改名几何 / 撞名递补（纯）
│   │   │   ├── source-store.ts       # 引用边存储
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
│       │   ├── source-edges.tsx      # 引用线几何
│       │   ├── reference-options.ts  # @ 引用候选：路径 / 卡片名 / 座位 id 三件事各是各的（纯）
│       │   ├── card-tile.tsx         # 卡片（含流光层）
│       │   ├── card-face.tsx         # 卡面描述（画布 tab 与形态 tab 共用）
│       │   ├── card-overlay.tsx      # 选中态控制带（右下角把手：拖动改尺寸）
│       │   ├── composer-size.ts      # 把手的算术（纯）：上下限与 zoom 换算
│       │   ├── canvas-nav.tsx        # 左栏画布包裹（Portal）
│       │   ├── canvas-menu.tsx       # 画布行的操作菜单与删除确认
│       │   ├── row-actions.ts        # 那一行该给出哪几个动作（纯策略）
│       │   ├── open-folder.ts        # 交给文件管理器打开画布目录
│       │   ├── project-catalog.ts    # 活动画布清单（不轮询）
│       │   ├── canvas-panels.tsx     # 主面板 / 侧栏席位
│       │   ├── canvas-tab.ts         # 右栏 tab 类型（工作台页 + 每形态认领）
│       │   ├── folder-picker.tsx     # 新建画布时挑目录
│       │   └── material-notice.ts    # 引用提交后那句话（纯策略）
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
│       │   │   ├── seed-blank.ts             # 「手动输入」落到空座位：先落一份空文件再回读（纯，假 wire 可跑）
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
  "name": "@ljcoder2015/dsh-canvas",
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
    - id: '@ljcoder2015/dsh-canvas'
      name: '@ljcoder2015/dsh-canvas'
      # 可选：覆盖 src/index.ts 的 Config 默认值
      # config:
      #   workspaceRoot: ./canvas
```

`dsh.plugin.json` 是 dsh.so 注册表清单，也是工具/技能贡献的申报处：

```json
{
  "id": "@ljcoder2015/dsh-canvas",
  "version": "1.0.0",
  "main": "lib/index.js",
  "engines": { "dsh": ">=0.1.0-rc.6" },
  "contributes": { "tools": ["canvas_read_card", "canvas_read_sources", "..."], "skills": ["canvas-operations"] }
}
```

> `contributes` 字段本身在模板中存在（模板填的是空数组），其**条目格式**尚未核对注册表文档——发布前需确认这里是工具名清单还是完整贡献对象。

**改名时必须同步的位置**（v1.50 按实际落刀校准）：模板那份一张表列到底，实测要分两类——**包身份**必须逐字等于 npm 包名（模型层按它归因两侧贡献、profile 按它定位模块），**命名空间键**则是本插件内部的注册键，与包名没有解析关系。

**一、包身份**（`tests/contract.spec.ts` 钉死前缀，漏一处即模型层归因对不上）：

| 位置 | 字段 | 为什么 |
|------|------|--------|
| `package.json` | `name` | 唯一真源；profile 的依赖键与 `dsh.profile.bundles` 都按它 |
| `cordis.patch.yml` | `name`、`id` | `name` 是 profile 里的模块定位符，`id` 是 patch 层要覆盖的实例 id |
| `dsh.plugin.json` | `id` | 注册表清单 |
| `build.mjs` | `__ModuleLoader__.load` 的 `id` | 客户端 bundle 的装载键 |
| `src/index.ts` | `name` | 取 `PACKAGE_NAME`（cordis 视角的插件名） |
| `src/typert.ts` | `package` | 取 `PACKAGE_NAME` |
| `src/client/wire/remote.ts` | `package` | 取 `PACKAGE_NAME`——**最容易漏的一处**：两端各写一次，没有它就只有 Host 那半边归对包 |
| `src/contract.ts` | descriptor `id`（`<package>#<service>/<method>`，89 处） | 契约身份 |

后面四处都由一行常量兜住：`src/contract.ts` 的 **`PACKAGE_NAME`** 是包身份的唯一真源，`index.ts` / `typert.ts` / `remote.ts` 从它读，contract spec 另有一条断言钉「两侧贡献归同一个包」。

**二、命名空间键**（不随包名走，刻意留在短词上）：

| 位置 | 值 | 说明 |
|------|-----|------|
| `src/host/prompt.ts` | `PLUGIN_ID = 'dsh-canvas'` | 日志与 effect 标签、注入消息来源、提示词小节名前缀（`dsh-canvas:tools` 等） |
| `src/client/ui/locales.ts` | `NS = 'dsh-canvas'` | locale 命名空间（两端同一个常量，自洽） |
| `src/client/canvas/canvas-tab.ts` | `'dsh-canvas:workbench'` / `'dsh-canvas:kind:'` | tab 类型 id |
| `src/host/assets.ts` | `ASSET_ROUTE = '/dsh-canvas/assets'` | 资产**路由**（URL，不是包名） |
| `src/capabilities.ts` | `CAPABILITIES_SERVICE_KEY = 'dsh-canvas.capabilities'` | **部署侧**实现者按这个名字注册，改它等于改跨包契约 |
| `src/client/wire/model-memory.ts` | `'dsh-canvas:model-by-kind:v1'` | 浏览器本地存储键（改了会丢用户已选的模型） |
| 画布目录 / 样式 | `.dsh-canvas/board.json` / `.dsh-canvas-*` | 目录约定与 CSS 类前缀 |

> 包名现为 **scoped 的 `@ljcoder2015/dsh-canvas`**（v1.50）：裸名 `dsh-canvas` 在 npm 上被他人占位（2026-08-19 发布的 0.0.1），发布只能走 scope。服务键 `canvas` 的十六进制命名空间名仍是 `TypertRemoteNamespace$63616e766173`、`card` 是 `$63617264`——它由**服务键**决定，与包名无关。

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
    id: '@ljcoder2015/dsh-canvas#card/read_sources', service: 'card', namespace: 'card', method: 'readSources',
    invocation: { kind: 'direct' }, parameters: [], cancellation: { parameter: 'signal' },
    result: { mode: 'strict', typeSymbol: '@ljcoder2015/dsh-canvas#CardSummaryList', schema: z.array(cardSummarySchema) },
  },
  // …其余 canvas.* / card.* 方法同理，一个方法一条 descriptor
]
```

```typescript
// src/typert.ts —— Host manifest：告诉模型层这个插件提供了什么
import { DSH_CANVAS_INVOCATIONS } from './contract.ts'

export const TYPERT_MANIFEST: TypertContribution = {
  package: TYPERT_PACKAGE, face: 'host', schemas: [],
  model: {
    services: [
      { key: 'canvas', exportName: 'CanvasRuntime', description: '画布座次与引用链。', tags: [], members: [ /* 每个方法一条 */ ], types: [] },
      { key: 'card', exportName: 'CardRuntime', description: '卡片产物读写与引用。', tags: [], members: [ /* … */ ], types: [] },
    ], events: [], objects: [],
  },
  invocations: DSH_CANVAS_INVOCATIONS,
}
```

```typescript
// src/client/wire/remote.ts —— Client 贡献：与 Host manifest 指向同一个数组
import { DSH_CANVAS_INVOCATIONS } from '../contract.ts'

export const DSH_CANVAS_REMOTE: TypertRemoteContribution = {
  package: PACKAGE_NAME, descriptors: DSH_CANVAS_INVOCATIONS,
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
| `CanvasRuntime`（namespace `canvas`） | 画布座次、引用边增删查、上游链排布、归纳收纳、便签创建、**当前画布记账**（v1.31：`setActiveProject` 写领域全局 `activeProjectId`，画布级工具据此取项目）、**绑定目录时的身份判定与板面导入**（v1.47：`createProject` 先读目录里的板面文件决定「这是哪张画布」，再按 `planSeats/planEdges/planNotes` 补齐板面；每个改动板面的方法末尾写回投影） | `src/host/canvas-runtime.ts` |
| `CardRuntime`（namespace `card`） | 卡片产物摘要读取、上游（引用来源）读取、跨卡片注入、导出、发布、生图、**上游产物的文件引用提交**（v1.37：`referenceFiles`）、**上下卡与批量清理**（v1.47：`removeCard` / `removeMissingCards` 共用一条 `unseat` 级联——先释放会话、再删它的边、最后删座位，顺序反了会留下删不掉的悬空线。批量清理只清**证明得了不存在**的卡：`presenceOf` 三态里 `unknown` 一律留下，`seatedEmpty` 的空座位留下，项目根自己探不到时整体拒绝——那时「所有卡都缺」既可能是真的、也可能是探针坏了，这里分辨不出，清空画布该走 `removeProject`）、**卡片改名**（v1.53：`renameCard` —— 名字与磁盘上那一项一起改，几何全在 `core/canvas/card-name.ts`，这里是唯一一处直调 `node:fs` 的地方，理由与三道闸见 §九） | `src/host/card-runtime.ts` |
| `board-file`（纯） | 板面文件的格式、编解码与两个决策：`planIdentity`（新画布 / 复用 / 搬家 / 复制四态）、`planSeats/planEdges/planNotes`（打开目录时该补哪些卡片、边、便利贴）。全部对普通数据的纯函数，于是每条规则都能在容器外测 | `src/core/canvas/board-file.ts` |
| `board-file`（宿主） | 把上面那份格式接到 `ctx.fs` seam（沙箱策略与写前 waterfall 照旧生效），并从 `projects/cards/sources/notes` 表组装投影；**内容未变则跳过写**，**读不懂的文件绝不覆盖**，写失败只记日志 | `src/host/board-file.ts` |
| `kind-registry` | 文件证据 → 形态认定（纯函数：扩展名 + 内容嗅探） | `src/core/artifact/kind-registry.ts` |
| `source-store` | 引用边的增删查与自动对账，落在存储领域之上 | `src/core/canvas/source-store.ts` |
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

  /** 读取画布当前座次与引用边。 */
  @Remote
  async readBoard(projectId: ProjectId, signal?: AbortSignal): Promise<BoardSnapshot> { /* … */ }

  /** 按引用链分层摆位。 */
  @Remote
  async arrange(projectId: ProjectId, strategy: ArrangeStrategy, signal?: AbortSignal): Promise<BoardSnapshot> { /* … */ }
}
```

**Agent 工具注册**用的是 Harness 的工具流水线，而不是裸函数（`inject: ['tools']`）：

```typescript
// src/host/tools.ts
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = PACKAGE_NAME
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'canvas_read_sources',
    description: '读取当前卡片引用来源（直接上游产物）的摘要。',
    parameters: {},                                    // 无参数：引用只取上一级，层数不是调用方可选的东西（v1.46 撤掉形同虚设的 depth）
    output: {
      schema: { type: 'array' },                       // 规范 JSON 值
      render: (_args, value) => [{ type: 'text', text: renderSummaries(value) }],
    },
    async execute(_args, exec) {
      // exec 携带调用身份与 signal；args 已按 schema 校验
      return await readUpstreamSources(ctx, exec.agent)
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

**卡片元信息注入系统提示词**：用 `ctx.systemPrompt.section()` / `.context()` / `.variable()` 在卡片会话的作用域内注册段落与动态上下文（路径、形态、项目风格档案、上游引用来源摘要、**改动归属**——一次改动落到本卡产物而不是另起一张卡，F3.17），作用域内条目遮蔽全局同名条目；一次性提醒走 `agent.inject({ content, source: { kind: 'plugin', plugin: 'dsh-canvas' } })`——它追加的是持久化上下文，下一次模型请求即可见，但**不会唤醒空闲 agent**。

**连线的底层 = 文件引用**（v1.37，替换掉 v1.35 的会话引用这一版）：一条引用边的两端确实都是会话（每张卡片一个，§2.3），但**边指向的东西是文件**，而这份文件**不一定是任何会话的产出**：节点可以**手动新建**（从来没有哪次会话生成过它），也可以是**对某次会话产物的二次编辑**（内容早已不等于那次会话的记录）。把「会话」当作「产物」的代理，等于预设「这份产物 = 某次会话的输出、且此后没人动过」——这个预设一破，模型拿到的就是**另一样东西**（过程记录、或者旧版本），而边明明指着那个文件。**文件引用把这个代理环节整个去掉**：名字直接指向磁盘上那一份，谁写的、怎么来的都不影响它指得对。所以插件交给新会话的是**名字**，不是内容，也不是快照。这份名字的语法**属于 Harness**：`@` token ＋ 工作区相对路径，带空白就 `@"…"`，目录带尾斜杠，`@deepseek-ai/dsh-file-reference-local` 在这条会话有 `read` 工具时装上这份引导（每张卡片会话都有 `read`，见上「卡片会话的工具从哪里来」）。插件**自造一套新词汇只会更差**：模型得为一个插件多学一种写法，而宿主 UI 与其它插件的 `@` 提示又各说各话。所以 `src/core/artifact/file-reference.ts` 把宿主那套语法**逐字节复刻**（零依赖、**不 import harness 包**——同一份 bundle 要跑在从未组合 file-reference 包的部署上），执行落在 Host 的 `CardRuntime.referenceFiles`：走这条卡的**直接**上游（上一级，**不做穿透引用**）→ 逐个 `probe`（只为判「是文件还是目录」与「写没写盘」）→ `nameFileReferences` 保序去重并分出 `skipped` → `referenceMessage` 以 `source.kind:'plugin'` 注入（**绝不是 `kind:'user'`**：是画布在给文件命名，不是在替用户说话）→ 返回 `{ cardId, files[], skipped[] }`。**名字必须真的解析得到**：卡片 id 就是工作区相对路径（产物落在 `<画布根>/<cardId>`，正好是会话 cwd）——这条既有事实是整个通道成立的前提，也是 §3.5 F5.4 那条「卡片是文件不是目录」的来处。**每轮提示里的引用块同源但更克制**：它**同步组装、不许 I/O**，所以走 `nameWithoutProbe()`（一律文件形态、不带由 kind 推出来的尾斜杠），只报**有哪些材料**，正文一个字都不带——从缓存里端出来的摘要没人负责失效，而上游随时可以被一次普通的文件编辑改写。**摘要通道照旧并存**（`canvas_read_sources` / `canvas_inject_card` / F5.7 `pull`）：它要的是「立刻把材料摆到眼前」，这件事引用做不到。

**引用深度分两种问法，答法不同**（v1.46）：`transitiveUpstreams`（`src/core/canvas/source-store.ts`）回答的是**图**的问题——「这张卡在谁的下游」，用于看形状的两处（F4.7 引用链面板 / `canvas_get_sources`、F4.6 按链排布），停在一级就是谎报画布的形状；`materialUpstreams`（同文件）回答的是**上下文**的问题——「这条会话可以读什么」，答案恒为**一级**。三条通道（每轮提示里的引用块、`canvas_read_sources` 的摘要、`canvas_reference_files` 的名字）全部走后者，**不做穿透引用**。理由是链要**折**不要**摊**：产物应当已经把上游材料消化进自己那一份，把祖父的产物塞进孙子的提示词，花的是上下文、拆的是画布自己画出来的那条流水线——而且「本产物建立在它之上」这句话，隔一层就不成立了。真要看更远的，`canvas_get_sources` 报全链、`canvas_read_card` 读其中任一份，属于**明确去取**，不是默认送到。配置项 `sourceDepth` 自此只作用于图的那一侧。

## 六、数据模型与持久化

「引用数据独立于产物文件」的落点是 Harness 的存储领域（domain），不是自建 JSON 文件。

```typescript
// src/domain.ts
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const point = z.object({ x: z.number(), y: z.number() })   // 记录 schema 用 zod 写，消费方类型由 z.infer 得到
const projectRecord = z.object({                          // 一张画布：名字、根目录、**它自己的**视图与风格
  name: z.string(),
  root: z.string(),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }),
  style: z.object({ palette: z.array(z.string()), font: z.string(), tone: z.string() }),
  createdAt: z.number(),
})
const cardRecord = z.object({                             // 一张卡片：座次 + 形态 + 绑定的会话
  project: z.string(),                                    // 记录自带 project，键与记录都要说得清自己属于谁
  kind: z.string(),
  position: point,
  sessionId: z.string(),
  updatedAt: z.number(),
  seatedEmpty: z.boolean().optional(),                    // v1.47：这个座位**生来就没有产物**（F1.11）
  file: z.string().optional(),                            // v1.49：产物路径。**可选**＝老记录读作「路径就是 id」，零迁移；新记录一律带
  name: z.string().optional(),                            // v1.53：卡片自己的名字（F1.12）。同样可选＝老记录读作「按产物起名」；**与推导默认相同就不写**
})
const sourceRecord = z.object({                           // 一条引用边：下游 ← 上游
  project: z.string(),
  downstream: z.string(),                                 // 引用方 cardId
  upstream: z.string(),                                   // 被引用方 cardId
  origin: z.enum(['manual', 'reconciled']),               // 手动连线 or 自动对账生成
})
const noteRecord = z.object({ project: z.string(), text: z.string(), author: z.string(), position: point, createdAt: z.number() })

export const CANVAS_DOMAIN = defineDomain({
  name: 'dsh_canvas',                                // 单元名只允许 [a-z][a-z0-9_]*，故用下划线而非包名的连字符
  version: 1,
  layout: 'per-record',                              // 卡片/引用边记录大而稀疏，逐条成文档、逐条校验版本
  global: {                                          // 画布单例：**只有「用户在看哪张画布」**
    schema: z.object({ activeProjectId: z.string(), viewport: z.object({ /* … */ }), style: z.object({ /* … */ }) }),
    initial: DEFAULT_CANVAS_GLOBAL,
  },
  tables: {
    projects: domainTable<string, z.infer<typeof projectRecord>>(projectRecord), // projectId → 名字/根目录/视图/风格
    cards: domainTable<string, z.infer<typeof cardRecord>>(cardRecord),          // projectId-cardId → 座次/形态/会话
    sources: domainTable<string, z.infer<typeof sourceRecord>>(sourceRecord),    // 引用边
    notes: domainTable<string, z.infer<typeof noteRecord>>(noteRecord),          // 共享便利贴
    intents: domainTable<string, z.infer<typeof intentRecord>>(intentRecord),    // 排队中的结构化编辑意图
  },
})
```

> 一处与初版的差别值得点明：视图与风格是**逐项目**的（表里那份 `projectRecord`），全局单例只留「当前打开的是哪张画布」——初版只设了单画布，而板上要并排摆好几张。

| 特性 | 结论 |
|------|------|
| 打开方式 | `await ctx.storageDomain.open(CANVAS_DOMAIN)`，调用方拥有句柄并负责 `close()`（通常放进 `ctx.effect` 的 disposer） |
| 读取 | 同步、来自权威内存态：`table.get/entries/keys/size`；写入先落盘、再更新内存、最后发事件——**读取永不偏离介质** |
| 写入 | `put` / `update`（原子读-改-写）/ `delete`，同一领域内按写链串行 |
| 变更通知 | 每次持久写入后发 `domain/changed`（`put` 携带新快照，`deleted` 是墓碑），UI 与自动对账据此刷新 |
| 记录所有权 | 返回的是存储对象本身，**不得就地修改**，一律经 `put`/`update` 整体替换 |
| 后端 | 由部署侧路由决定（`json` 后端整文件重发布、`sqlite` 后端逐行存储），产品包不触碰后端 |

文件侧的数据模型相应简化（引用不再随卡片走，而是随**板面投影**走，见下一小节）：

```typescript
interface Card {
  id: string                 // 即相对工作区根的路径（如 decks/intro.html）
  kind: string               // 由 kind-registry 认定
  position: { x: number; y: number }
  sessionId: string          // 绑定的 Agent 会话
}

interface Source {
  id: string
  upstream: string           // 被引用的 cardId
  downstream: string         // 引用方的 cardId
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

### 板面文件：随目录走的投影（F1.9 / F1.10，v1.47）

存储域让「本机怎么读写」这件事一个字节都不用操心，但它把画布放在了**部署里**而不是**目录里**，于是「画布＝这个文件夹」这句话有两个反例：目录改名即换一张画布（身份是路径摘要），换台机器即空板。补的那一半不取代存储域，而是给它加一份**投影**：

```
<root>/.dsh-canvas/board.json           # 点前缀目录，scanProject 跳过 ⇒ 永远不会被当成产物
{ "format": "dsh-canvas-board", "version": 1,
  "id": "dsh-flow-1wjec4f",             # 这张画布是谁：改名/搬家/换机器都靠它认回来
  "name": "dsh-flow", "style": { … },
  "cards":   [ { "id": "app/index.html", "position": { "x": 48, "y": 170 } },
               { "id": "untitled.md", "position": { "x": 336, "y": 170 }, "empty": true } ],  # empty：座位生来没有产物（F1.11）
  "sources": [ { "downstream": "deck.html", "upstream": "brief.md", "origin": "manual" } ],
  "notes":   [ { "id": "note-…", "text": "…", "position": { … }, "createdAt": 1 } ] }
```

| 问题 | 结论 |
|------|------|
| 谁是真源 | 存储域。读取、命中测试、排序都走它；投影可以慢一拍，也可以整体失败（目录只读、沙箱拦下、盘满）。**写投影失败不让用户的拖拽失败**，只记一行日志 |
| 什么时候写 | 改动板面的每个方法末尾（`moveCard`/`arrange`/`linkSource`/`unlinkSource`/`reconcile`/`createNote`/`removeNote`/`setStyle`/`createCard`/`removeCard`…）。组装文本与上次写过的逐字节比对，**没变就不写**——拖回原位、排布没改动的不惊动文件监视器，也不留空 diff |
| 什么时候读 | 只在绑定目录时（`createProject`）。读不懂（JSON 坏了、`format` 不对、版本不认识）就当**没有**，并且**再也不覆盖它**——手改到一半的文件或更新格式写的文件，被旧投影盖掉就是数据丢失 |
| 身份怎么判 | `planIdentity` 四态：文件里有 id ⇒ 用它；没有 ⇒ 退回 `projectIdOf(root)`（老画布因此零迁移）。记录存在且根目录就是这里 ⇒ **reuse**；记录指的旧路径已不存在 ⇒ **move**（改名/搬家，记录就地把 root 改过来）；旧路径还在 ⇒ **copy**（拷出来的一份），铸一个新 id 并改写它的板面文件，否则两个文件夹共用一个板面 |
| 板面怎么导入 | `planSeats`：**已落座的卡片保留存储域里的座位**（那是本机更新的状态，陈旧的投影不能把它拖回去），缺的卡片按文件里的座位补，文件没提过的文件按「最右一张右边一步」落座。`planEdges` 把每条边过一遍 `validateEdge`（自环/重复/成环/端点不在板上丢掉），`planNotes` 按 id 去重。卡片条目上的 `empty: true`（只在为真时写）随座位交回 `createProject`，于是「这个座位生来没有产物」这条豁免（F1.11）也过得去机器 |
| 什么不跟着走 | `sessionId`（换台机器就是另一个会话，带过去只会假装有对话）、视图状态、排队中的意图。划线处是**属性归谁**：作品的关系与布局走，本机态留下 |
| 删除画布呢 | 只删本机记录，**不碰目录里的板面文件**：重新绑定即从文件恢复。忘记与恢复互为逆操作 |
| 已知边界 | 快照是**整份覆盖**，没有逐条合并，所以同一份目录不该被两个部署同时编辑（产品文档 §六 已把实时协作划在界外）。拷贝出去的那一份**只继承布局与关系**，不继承会话 |

### 探针三态：什么时候才可以说一张卡「失效」（F1.11，v1.47）

板上「缺产物」看起来是一件事，实际是三件，而**批量操作只许碰其中一件**。`probe` 返回布尔，把所有失败都折进 `present: false`——画板面够用（说不清就先别下结论），但拿它去决定「把这张卡从板上拿掉」就是把「读不到」当成了「不存在」。于是另有 `ArtifactIo.presenceOf()`：

| 态 | 怎么来的 | 能做什么 |
|----|----------|----------|
| `present` | 目标解析成功、`stat` 有结果（目录也算） | 什么都不用做 |
| `absent` | 目标解析成功、`stat` 明确返回 `undefined`（协议原文：`undefined` 即不存在） | **唯一可以据此清卡的态** |
| `unknown` | `ctx.fs.resolve` 抛错（路径不可表示、沙箱把它映射到别处），或 `stat` 抛错（`FS_PERMISSION_DENIED` / `FS_SANDBOX_DENIED` / `FS_IO_ERROR`） | **一律留下**，写一行日志说跳过了哪几张 |

再叠两条：

- **空座位不是幽灵。** 座位允许先于产物存在（客户端 `spawnFromSpec` 是先落座再写种子、位图要等一次生成、`canvas_create_on_board` 可以由 Agent 给一个还没写的路径落座）。这类卡记 `seatedEmpty: true`，`missingOf(presence, seatedEmpty)` 于是把它们排除在外；**观察者是 `readBoard`**——因为产物也可能是模型用自己的文件工具写出来的，只有探针能看见填写这件事。这也顺手让 `readBoard` 从「每张卡都读一段正文」变成纯 `stat`。
- **根自己探不到就整体拒绝。** 那时每张卡都像缺了，而「目录真没了」与「路径解析坏了」在这里分辨不出；一次点击清空整块画板不是可以从一个失败的探针里推出的结论，所以抛 `canvas/root-unavailable`，请用户改用「移除画布」。

落点：判据抽成纯模块 `core/canvas/cleanup.ts` 的 `planCleanup(cards)`（`{ remove, unknown }`，容器内可测），host 只负责采集事实与执行级联删除。**变淡（F3.5）、计数、清理三者共用 `BoardCard.missing` 这一个判据**——按钮上的数字与点下去真正会少掉的卡必须是同一个集合，否则用户只会在「说 3 张、走了 2 张」里失去信任。

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

### 画布上的滚轮归谁（F1.7，v1.52）

整块画布表面都是手势面，于是「这一滚归谁」必须自己判——浏览器本来有一条规矩（内层还有余量就内层滚），在这儿不成立：React 的 wheel 监听挂在根容器上，画布这一层收到的永远是那一下，内层的滚动条根本没有先吃的机会。判据收在 `client/canvas/wheel-owner.ts`（纯模块、零依赖，node 单测直接读它）：

- **`wheelOwner`**：`ctrl` / `⌘` 压过一切 → `zoom`；否则问指针底下是不是**自己会滚的地方** → `self`（画布一个像素都不动、原样放行给浏览器去滚那个盒子），其余 → `board`（平移取景框）。认那三处用的是**类名**（`SELF_SCROLLING`：提示词正文、`@` 候选、模型菜单），**不量溢出量**——量 `scrollHeight` 会把同步布局逼出来，而平移恰恰最受不了这一下；何况输入框本来就**按设计**会滚，它当下滚不滚得动与「这一滚该不该归它」是两件事。
- **`wheelSwallowed`**：`zoom` 与 `board` 两档都要拦下（`preventDefault` + `stopPropagation`），`self` 那一滚**一个字都不碰**（滚动正是那个盒子的默认动作）。缩放这一档绕不过去：`ctrl` / `⌘` + 滚轮在浏览器里本来就是**页面缩放**，Chromium 里触控板捏合合成的也正是这样一条带 `ctrlKey` 的 wheel——不拦就是「画布放大一档，宿主整页也跟着放大一档」。

**拦默认动作必须用主动监听，这是这一条的全部要点**：react-dom 18.3.1 的 `addTrappedEventListener` 把 `wheel` / `touchstart` / `touchmove` 三兄弟一律注册成 `passive`（挂在根容器上，是它当年模拟浏览器对 document 上这三兄弟的默认被动化）。被动监听里 `preventDefault()` 不只是「没效果」——Chromium 认定没人拦得住，事件**到达时 `cancelable` 就是假**，浏览器连问都不问一声就把自己的事办了（实测控制台另记一句 `Unable to preventDefault inside passive event listener`）。所以这条监听挂在表面上、显式 `{ passive: false }`（与 `artifact/viewers/design-viewer.tsx` 同一手法），并且 `canvas-view.tsx` 里**不再挂** React 的 `onWheel`：留着也只是让同一滚被算两遍（`stopPropagation` 之后它本来也收不到）。

判据分两层。纯函数与**源码级三句**在 `tests/client/canvas/wheel-owner.spec.ts`（node 环境里没有 DOM，「挂法」只能看源码：必须挂原生且 `passive: false`、不许再出现 React 的 `onWheel`、拦的那两下都在——这三句在修复前逐条验过、全红）。端到端在 `.workbuddy/repro/wheel-zoom/`：`gen.cjs` 生成三张**只差一行**的页面（不挂监听 / 被动挂法 / 主动挂法），`check.cjs` 用真浏览器推滚轮判 11 项——对照组页面**确实被滚走**（这是后面全部判据的成立前提）、被动那张**照样被滚走**且控制台记那句 `Unable to preventDefault`、主动那张**页面一动不动**且窗口冒泡那条根本没被叫到，外加 `ctrl` 滚轮在两种挂法下的 `cancelable` 对照。⚠️ **无头模式里「页面缩放」这个默认动作本身量不到**（对照组的 `devicePixelRatio` 与 `innerWidth` 一样不动），所以判据落在同一条 DOM 语义（`cancelable` + 默认动作有没有被拦）上；真机复核只需把画布打开、按住 `⌘` / `Ctrl` 滚滚轮，看宿主那一栏有没有跟着变大。

### 控制带的尺寸（F3.11 右下角那颗把手）

控制带（`card-overlay.tsx`）能拖大，尺寸落在两处：整条带的宽写在内联 `width` 上、输入框的高写在输入框自己的根上（v1.48 起正文是 `contenteditable`、不再是 `textarea`，见下一节）。**带子的高从来不自己定**——它是「材料行 + 输入框 + 底栏」三行自然长出来的，所以放大能改的只有「输入框多占多少」；字号、行高、内边距、圆角一个都不动——放大态（⤢）走的是同一个 `ComposerBody` 与同一个输入框，变的只是外壳给它的余地（`data-fullscreen` 那两条 flex 规则），没有另一套更大的字。于是「放大之后还是同一副样子」是结构给的，不是靠人守的。

算术全在 `composer-size.ts`（纯模块、不碰宿主原语，单测直接读它）：起笔时按 `getBoundingClientRect` 量一次当下多大，那就是**起点**（所以第一下不跳）；之后每一个指针位移都先除 `zoom`——带子坐在 `scale(zoom)` 的层里，不除的话把画布放到 200% 再拖就是鼠标的两倍快。上下限在那里收口，下限是「装得下自己」而不是「刚才多大」，所以拖大过还拖得回默认。

**锚在卡片中心**（`translateX(-50%)`；卡片宽 200 ⇒ 与 `position.x + 100` 是同一条竖线）：放大时左右两侧对称地长，输入区始终在节点正下方。代价落在右沿——同一个鼠标位移只有一半落在它上面、另一半去了左沿，于是宽要按**两倍**吃位移（`CENTERED_WIDTH_GAIN`），右下角那颗把手才跟得住光标。**锚点与这个倍数是一对，改一个必须改另一个**：若换回左上锚（钉住左沿），倍数就得回到 1，否则要么把手跟不上鼠标、要么宽走过一倍。高的方向没有这一层，锚在上沿，一寸就是一寸。

拖动期间是组件内的本地 state（同 `card-tile.tsx` 的卡片拖动），**放手才落进画布的记忆**；按一下不移动＝一次误触，什么都不改。尺寸按「画布 / 卡片」记在 `CanvasBoard` 的内存里（卡片 id 是路径，跨画布会撞名），**不落盘、刷新回默认**——它是一时的偏好，不是产物的属性。把手的按下要 `stopPropagation`：画布把空白处的一按读成「取消选择」。

**放大态（右上角那颗 ⤢）不是另一副界面，是同一条控制带换了个壳**：那三行由同一个 `ComposerBody`（`card-overlay.tsx` 导出）画出来，卡片下方那条带子与放大后的弹窗都只是它的外壳——所以「放大之后布局与缩小态一致」不是靠两处对齐出来的，而是**根本没有第二套布局**。连输入框的高矮之别也走 `data-fullscreen` 这个属性而不是另一个类：三行的 class 序列在两种尺寸下逐字相同，真机探针直接比它（探针里那条「class 序列与行内一字不差」）。

**两处按钮各管各的壳**，所以各站各的地盘：行内带子右上角那颗是〔放大〕（⤢，`canvas.composer.enlarge`，`corner` prop 可选——**只有行内传**），弹窗**头部右上角**那颗是〔缩小〕（⤡，`canvas.composer.shrink`）。底层的〔缩小〕因此站到 `.dsh-canvas-dialog-head` 里去（`.dsh-canvas-promptmodal-shrink`：`margin-left:auto` 推右沿、`flex:none` 防被长标题挤扁、上下 `-4px` 把 26px 的胶囊塞进头部那一行，头部高度因此不变），而不是混进那三行——**材料行与行内逐项相同，一颗多余的按钮都没有**，探针里「放大态那三行里不再有那颗 ⤢」和「缩小那颗整颗落在头部里、在内容区之上」两条判据盯着这件事。弹窗底部那枚重复的「收起」也已删掉：退出去走头部那颗、Esc 或点遮罩。前一个版本里放大态另有一套 13px/21px 的字号（`.is-modal`），那正是「放大之后不像同一个东西」的根源，已撤。

### 提示词输入面：contenteditable 与原子引用标签（F3.18，v1.48）

正文（`client/ui/prompt-input.tsx`）是 `contenteditable`，`@文件` 记号画成 `contenteditable="false"` 的原子标签。三件东西分三层放：**纯解析**在 `core/artifact/prompt-blocks.ts`（零依赖、node 单测直接覆盖——类型表、坐标语法、原子切分都在这儿）；**DOM 层**在 `client/ui/prompt-dom.ts`（只碰 DOM、不碰 React、不做任何决定）；**决定**在组件里（删哪一段、插什么字，都按值算出新值再连同光标一起写回）。DOM 层只在有 DOM 的地方成立，node 单测够不到，判据在 `.workbuddy/repro/prompt-refs/`（真组件 + 真样式 + 真浏览器：21 项 + 两条反证，`gen.cjs` 生成、`check.cjs` 判，退出码非 0 即红）。

上一版是「透明 textarea + 同度量镜像层」：显示改得到、值改不到，但**画不出一枚真正的标签**——镜像只能重绘同一串字符，插不进图标、显不了缩略图，而一件事只有真做成原子节点才谈得上原子。换成 contenteditable 的代价是一条要自己守的边界：**内容就是值**。守在三处：

| 组 | 函数 | 规矩 |
|---|---|---|
| 写 | `writeAtoms` | 值 → 内容。**唯一的写入口**（别处一律不许碰它的 childNodes），且只在外面的值或事实真变了时才写——判据是组件里的 `markRef`（值 + 事实的键，键比**内容**不比对象身份：调用方每次渲染都新造一个对象，按身份比就会每渲染重画一遍、打字打到一半光标被拽走）。用户自己敲的字 DOM 已经是对的，重写一次就把光标与输入法一起打断；这也是它在中文输入法下安全的原因——合成期间 `change` 照发、DOM 一动不动 |
| 读 | `serializeHost` | 内容 → 值。标签吐回**它自己那串字符**（`@a.ts` / `@"my brief.md"` / `@img.png <point>420 380</point>`），**不是从路径重新拼的一份**——宿主记号有三种形态，从 `filePath` 反推不出用户写的是哪一种，重新拼一次就可能把发出去的提示词改掉一个字节。这条「拼回去逐字节等于原文」由单测（纯函数）与复现页（真 DOM，十六种记号形态）两头钉住 |
| 坐标 | `caretFlat` / `domPosition` / `setCaret` | 光标是「在第几个字符」，不是 DOM 的位置：**一枚标签占的字符数＝它 token 的长度**，与序列化逐字对齐——「界面上的位置」与「值里的位置」因此从一开始就是同一个坐标。删除、粘贴、落光标全部先换算成扁平偏移、改完再换回 DOM 位置；换算的规则只有一份（`lengthOf` 与 `flatten` 必须说同一句话，两处对不齐光标就从字底下错开） |

四条交互判据从这里长出来：**标签整体删除**（Backspace / Delete 在标签边界上删的是一枚引用——按值算完 `preventDefault`，不赌浏览器在 `contenteditable=false` 边界上的默认行为；标签正后方的下一次删除走浏览器默认、只少一个字，这条对照也在判据里）、**标签内部不可编辑**（非可编辑节点里没有光标）、**复制 / 剪切按原文**（标签在剪贴板里还原成 `@路径`——按画出来的样子复制，粘回去就少一截）、**粘贴只取纯文本**（富文本带进来的那棵 DOM 正是这条边界最容易被撕开的地方；拖放同理）。

**多模态的类型按扩展名定**（`referenceTypeOf`，判据只有一份、写在路径里——调用方手上的卡片可能已经离开画布，扩展名却还在，两处也就不会各说各话）：`code` / `image` / `video` / `audio` 指一份**文件**；`mark` / `region` 指一张图上的**一个点或一个框**，坐标归一化到 0–999（`markText` 是构造那一半、`promptAtoms` 是解析那一半，两边共用同一份语法）。紧跟在文件记号后面的 `<point>` / `<bbox>` 并进**同一枚**标签——「这张图上的这个点」是一件事，不是两件；并完它照样只剩一个字符区间，所以原子删除、复制、序列化三条路一个字都不用改。**标签写文件名，不写序号**：本插件的锚点就是路径（模型照 `read` 自己去取那一份），视觉内容不走第二条通道——参考文档里「图片另走一路、文本里留 `@图片1`」属于另一家的接线方式，不取。缩略图**只在真取得到时**才画：控制带分批读产物 data URL（一批 4 枚、只取图片——视频的整段片子拿来当一枚小图是拿几十 MB 换几十个像素），取不到退回类型图标，**缩略图是锦上添花，不是引用的前提**。

**折叠是第四种引用，也是唯一一种「原文由调用方生成」的**（v1.56）：`element` 指的不是文件、也不是图上的坐标，而是「产物里的这个节点」——元素选择（F3.14）把「产物 + 节点 + 位置 + 几十行源码」一整段定位写进提示词，那段话没有任何 `@` 记号语法能表达。`@文件` 是输入面**自己认出来**的（语法写在字符里），折叠则反过来：调用方**知道**那一段的确切位置与长度（它就是自己刚用 `buildEditPrompt` 写进去的），于是由 `PromptFold` 声明「值里第 `at` 个字符起 `length` 个是一枚引用」，`promptAtoms` 照着折。**`reference.id` 在这条路上不作数**——输入面一律拿值里那一段原文当自己的 token，于是「标签写出去的是它自己那串字符」在折叠这条路上是**结构性**成立的，不靠调用方守规矩。折的只是画法：元素标签 `◫ section.hero` 后面接的那句话，就是发出去的提示词末尾那一句。切不出来时（草稿被人动过）调用方不给 folds，整段按普通文本编辑——展示让路，值一个字不动。

**切哪一段＝草稿自己那段原文，不是照 `file`/`target` 再拼一份**（这一条是踩出来的）。原先那副长相是 `splitEditPrompt({file, target, text})`：切分时要把「这是哪个产物、哪个节点」**再交代一遍**，而那份交代与生成草稿那份是两个来源——元素选择当场拿 `view.file`（产物路径）生成草稿，切分却递了 `cardId`（卡片的 6 位 id，`artifact-view.tsx` 自己写着 `(view?.file ?? cardId)`，两者本就不是一回事），于是前缀永远对不上、**标签在真机上一次也没画出来过**，用户看见的始终是纯文本。改法不是把那一个词换对，而是**把「再交代一遍」这件事去掉**：谁生成的草稿，谁就把那段 head 留着（`HeldPick.head`，`buildEditPrompt` 空要求那一次的返回值），切分走 `cutEditPrompt({head, text})`——两份值在结构上就是同一份，这个坑从此没有地方可长。`splitEditPrompt` 留给「手上只有 file 与 target」的调用方，参数注释里写明**不是卡片 id**（单测里那条 `qkxwvd` 就是这一脚）。

**两处真问题，都是判据抓的**（修复前对照留档 `prompt-refs-before.log`）：

- **事实变富时光标会被端走**（实测 `16 → 0`）。缩略图回来那一刻 `refs` 变了、值没变，`writeAtoms` 仍要重画一次——而它换的是整棵子树，选区连着它那个容器节点一起没了，浏览器只好把光标扔回开头。修法是**先量后画**：只换事实的那一路，先把选区量下来，画完原样还回去——还的是**一整个选区**，不只是折叠的光标（用户可能正选着半句话）；值也变了的那一路（回填、切卡、清空）不还，光标照旧放到末尾。
- **20px 的缩略图会压掉标签的发丝边**。标签那一行是 18px（内边距 2+2、行高 14），20px 的图在 14px 的内容盒里上下各探出 1px，而那圈发丝边是画在盒子**外面**的 `box-shadow`——探出来的 1px 正好把它压掉一段（「标签的边缺了个口」，后代盖住祖先描边那一族）。缩略图因此与标签**同高**（18px），上下 `-2px` 的外边距把高差吃进内容盒（flex 容器的自动高按**外尺寸**取最大，负外边距于是真能把高差吃掉）。判据里有一条反证专门把 20px 那次注回去、看上下各 1px 的越界重现——这条尺子才有牙。

**行高是判据**：一枚标签（含缩略图）不许把正文那一行撑开，否则插进一句话中间就把整段的行距改了。量法是 `scrollHeight`，而且要先把皮肤类上的 `min-height` 按下去——不按的话读数被钉在 54px 上，两条当然相等，判据成了摆设；以「图标那一枚」与「缩略图那一枚」互为对照，各配一条反证。两处落点（控制带与元素选择的提示词框）是同一个组件，判据里两处都量。

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

**唯一的例外：改名（v1.53，F1.12）**。seam 只有「读 / 写 / 就地编辑」，没有 rename 动词，而改卡片名必须真的把产物在盘上换个名字（F5.3 的文件引用是按路径交出去的，路径不跟着变就等于引用失效）。所以 `ArtifactIo.renameEntry(root, from, to)` 直调 `node:fs/promises.rename`，但**把 seam 原本给的三样保证在本地复刻**，一道都不省：

1. 源与目标都过 `fs.contains(boundary)`，越界一律 `FS_PERMISSION_DENIED`；
2. 目标处的沙箱策略是 `read-only` 就直接拒（`FS_SANDBOX_DENIED`）——不改只读工作区；
3. `processPathOf` 证明「宿主路径 → 进程路径 → 宿主路径」回到**同一个 `targetKey`**才动手，证明不了就 `FS_NOT_OBSERVED`（同名不同物、符号链接、大小写折叠这类情况一律不动手）。

判据在 `tests/core/artifact/artifact-io.spec.ts`：真临时目录上移文件、移目录（入口页跟着走）、路径证不出是同一个文件时拒、越出工作区时拒、只读沙箱拒、源不存在时报 `FS_NOT_FOUND`。**这里不是「沙箱/远程用不上」——是 seam 缺这个动词**；将来 seam 补上 rename，这一处就该收回。

三个策略事件正好承接「用户操作回流」：

- `fs/write-intent`（waterfall）：写入前的单槽决策，首个返回意图的监听者接管，可实现「画布内编辑落进 pending buffer 而不是直接落盘」。
- `fs/edit-intent`（waterfall）：编辑意图的拦截与改写，F8.4「意图回流」的天然挂点。
- `fs/observed`（emit）：权威的读写观测记录，用于把「谁改了这个文件」同步给下游卡片与引用对账（F4.5）。

写入带**版本守卫**（`expected: FsWriteIntent` / `{ version }`），因此「Agent 刚改完、用户同时手改」不会静默互相覆盖。写入还需携带沙箱执行策略参数，卡片编辑要遵守部署的权限预设。

### 交给 IO 层的永远是**路径**（v1.49 的欠账，v1.57 补齐）

IO 层（`core/artifact/artifact-io.ts`）的入参是**项目根 + 项目内的相对路径**——`tests/core/artifact/artifact-io.spec.ts` 里的调用形态就是这句契约的判据（`io.write('/proj', 'a.md', …)`、`io.view('/root', 'site/index.html')`）。而卡片记录上的那条路径得经 `cardFileOf(record, id)` 翻出来：v1.49 之前卡片 id 就是路径，两者随便混；解耦之后混一处就是一次静默失败——喂进去的 id 被当成相对路径，于是要么写到一个以座位 id 命名的游离子文件上（`<root>/qkxwvd`），要么对着一个不存在的文件说「没有这份产物」。两种都不报错。

落刀的现场与受影响的方法见上表「卡片身份」那一行。**判据读源码**（`tests/host/card-paths.spec.ts`：凡是喂给 `io.*` 的实参里出现裸 `cardId` 的，必须同时出现 `fileOf(`），而不是跑一遍：这一层要跑起来得有整套宿主装配，而漏改的表现恰恰是「装配好了也照跑不误」。

### 「手动输入」落到空座位：先落一份空文件（F3.13，v1.57）

座位可以先于它的产物存在（F1.11 的 `seatedEmpty`），而这枚按钮的含义是「我要写字」。所以 `ArtifactModal` 在**以编辑面打开**、产物不在、且形态是「产物就是它自己的文字」时，**先落一份空文件再回读**，把读回来的那一份灌进 payload——编辑面因此被画出来，而不是先给一句「产物不存在」。

两步收成一个可单测的模块 `editing/seed-blank.ts`（`seedBlankText(wire, projectId, cardId)`，`wire` 只要 `writeText` / `readArtifact` 两个动作）。判据拿一个**假 wire** 真跑一遍，钉住次序与内容：**先写后读**（读在写之前拿到的只会是「没有」）、写进去的必须是**空**字符串、回读回来的那一份才是答案；写被拒时把错误原样抛给调用方（弹窗把它当读失败一样说人话，不退回「产物不存在」）。

要不要落空白的判据是一个纯函数 `needsBlankText(view, openInEditor)`（`editing/writable.ts`，与「这份 payload 能不能整篇写回」的 `writablePayload` 相邻）：**在编辑面打开** + **产物确实不在** + **形态就是它自己的文字**，三条同时成立才落——看预览不写盘、空文件（是**在**的）不补、别的形态不碰。

控制带上那枚按钮的可见性另有一半：`isDirectTextKind(summary?.kind ?? card.kind)`。摘要读不到（产物还没写过、或者已经丢了，两种都没有可摘要的东西）时回落问**卡片自己**记着的形态——少了这半句，这枚按钮会恰好在「还没有东西可写」的时候隐身，而它要开的那条路本来就是从无到有地写第一行字。

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
  banner: { js: "window.__ModuleLoader__.load({ id: '@ljcoder2015/dsh-canvas', factory: (require) => { var module = { exports: {} }; var exports = module.exports;" },
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
dsh plugin --profile web add https://github.com/ljcoder2015/dsh-canvas   # 从 Git 安装（会跑 prepare 构建）
dsh plugin --profile web remove @ljcoder2015/dsh-canvas
```

Git 安装时 pnpm ≥10 会拦截 `prepare` 构建，需按 `dsh` 的提示在该 profile 的 `pnpm-workspace.yaml` 里加 `allowBuilds: { '@ljcoder2015/dsh-canvas': true }`——**该授权允许包在安装时执行代码，只对可信来源开放并锁定 commit**。开发期把包加进工作区软链后，`dsh-client-hmr` 会轮询客户端 bundle 变化并热重载（仅 sourcemap 变化不触发），Host 侧改动需重启 Web Harness。

## 十一、与初版技术设想的差异（必读）

| 项 | 初版设想 | 校准后机制 | 影响 |
|----|----------|------------|------|
| 插件清单 | `.deepseek-plugin/plugin.json` 声明 `inject: [tools, storage, ui, session]` | Harness 只认 `package.json` 的 `dsh.bundle` / `dsh.client`；`cordis.patch.yml` 挂载；`dsh.plugin.json` 面向注册表；依赖注入用 Cordis 的 `export const inject` | 清单写法重写，**无「ui」这类注入项** |
| Host 工具 | `ctx.tools.register('canvas_read_card', {...})` | `ctx.tools.register(defineTool({ name, description, parameters, output, execute }))`，需要 `inject: ['tools']` | 工具定义补 `output.schema` + `render`；名字须落在 `^[a-zA-Z0-9_-]+$`（§3.6） |
| 跨卡片调用 | Agent 直接持有 `canvas.getCard()` | 双端一律经 Typert Remote：契约 → Host manifest → Client 贡献 | 每个方法一条 descriptor，三处引用同一数组 |
| 页面/预览 | 自造 `preview(path) => Component` | 右栏 tab 类型注册表 + 资源地址认领 | 形态注册表一半落到宿主已有席位 |
| 引用存储 | 自建「画布元数据文件」 | `defineDomain` + `ctx.storageDomain.open()`，`domain/changed` 通知 | 不需要自造持久化与变更广播。**v1.47 把「自建元数据文件」以另一种身份请了回来**：目录里那份 `.dsh-canvas/board.json` 是**投影不是真源**（见 §6），它存在的理由是跨机器/跨目录的可迁移性，而不是想自己管持久化——写链、校验、变更通知仍全在存储域那边 |
| 画布身份 | 「项目」由路径决定（隐含：目录不会动） | 身份写在**目录自己身上**（板面文件里的 `id`），绑定目录时先读它再决定是哪张画布（`planIdentity` 四态） | 改名不再等于新建一张画布，老画布零迁移（没有文件就退回路径摘要），复制出去的那份自动获得新身份 |
| 卡片身份 | 卡片 id＝产物文件的相对路径（隐含：id 与文件名互为因果） | **id 与文件解耦（2026-09-23）**：新卡的 id 由 host 铸成**6 位随机小写字母**（`core/canvas/ids.ts` 的 `mintCardId`），产物路径改记在卡记录的 `file` 字段（域 schema 可选，老记录 `undefined` 时回落读 id＝旧行为，**零迁移**）。所有文件读写走 `fileOf(record, id)`；板面投影只在 `file ≠ id` 时写 `file` 字段；扫描落座按 **file 对账**（`planSeats` 收 `mint` 回调铸新 id）；产物引用对账（F4.5）先由 file 映射回卡 id。**2026-09-24 补课**：解耦当时漏改了 Host 侧**八处**（`readSummary` / `writeText` / `editText` / `readDesign` / `editDesign` / 导出 / 下游通知），它们仍把座位 id 喂给 IO 层——而 IO 层收到的是**路径**，于是建卡那行种子文字落进了以 id 命名的游离子文件（现场：项目根上躺着 `lzyoke`，内容是 `# 文本`，对应卡的产物 `文本.md` 从未出现），产物摘要也永远读不到；两处都不报错、只是「没出现」。现已全部走 `fileOf`，并加一道**读源码**的守卫（`tests/host/card-paths.spec.ts`：喂给 `io.*` 的实参里出现裸 `cardId` 的，必须同时出现 `fileOf(`）——这一层跑起来要一整套宿主装配，而漏改的表现恰恰是「装配好了也照跑不误」 | 文件名不再进入身份，**文件可改名**而不动座位；旧板面/旧记录/旧投影全部原样可读；客户端展示：卡片名走 `name`、预览标题与 `@mention` 走 `file`，id 只作座位身份流转 |
| 卡片名 | 卡片没有名字，列表与预览都拿产物文件路径当标题 | **显示名与产物路径分开（v1.53，F1.12）**：卡记录带可选 `name`，**只在用户给的名字与推导默认不同时才写**（＝零迁移）；显示名一律走 `core/canvas/card-name.ts` 的 `cardNameOf({file, kind, name})`（目录类形态取文件夹名，其余取去扩展名的基名）；改名在同一模块里纯判——`planRename` 定「改哪一个条目、后缀留不留」，`settleRename` 收 `taken(candidate)` 回调做撞名递补，`renameStep` 定「真去移动还是只把记录重指」，host 只把结果落到盘与记录。**新建的卡在铸座位的同时铸名（v1.54）**：类型名 + 序号（`autoNameOf`，`文本1`、`应用1`），并且**直接当产物文件名用**——`cardNameOf` 推出来的正是它，记录里一个 `name` 都不用多写（这是「派生默认 + 只存差异」的极限形态：默认值连落库都省了）；序号的判据在调用方（建卡那侧看得到板上已占的文件），与撞名 `-2` 同一个分工 | 文件名彻底退出用户视野（既不是身份也不是显示名）；改名不动座位 id、不动会话；**引用是路径 ⇒ 改名不回改别人的历史与 `@mention`**，旧投影 / 旧记录照旧可读。反过来，**显示引用时也不能再拿 id 当路径**（v1.54 修掉 v1.49 的漏网缺陷）：`@` 候选插的是 `@产物路径`、显示的是卡片名、缩略图走卡片 id——三个字段各是各的（`client/canvas/reference-options.ts`，纯） |
| 会话创建 | 「创建卡片时自动创建独立会话」 | `ctx.sessions.create()` 归调用方 fiber；**不落盘**，必须经 agent 生命周期事务 | P0 的会话绑定需先打通 agent 工厂，工作量重估 |
| 会话隔离 | 靠 system prompt 约定 | 工具注册作用域 + `restrict` / `schemas(scope)` 的可见性过滤 | 隔离可被结构性保证，不必靠提示词 |
| 引用注入 | `agent.inject()` 抽象调用 | `agent.inject({ content, source: { kind: 'plugin', plugin } })`，追加持久化上下文但**不唤醒空闲 agent** | 响应策略（F5.7）需自行决定用 `inject` 还是直接发起轮次 |
| 连线底层 | 「读上游产物摘要」 | **改用 Harness 自己的 `@file` 文件引入**（v1.37）：边的一端是产物文件、另一端是会话，插件把上游产物**以工作区相对路径命名**（`@brief.md` / `@"my brief.md"` / 目录 `@site/`，逐字节复刻宿主语法），模型按需 `read`；产物摘要**并列保留**（不是回落） | 引用不复制内容 ⇒ 不会失效、不占预算、不被截断、无缓存失效时机；摘要仍负责「立刻把材料摆到眼前」（`read_sources` / `inject_card` / F5.7 `pull`） |
| 文件访问 | 直接 `fs.read` | `ctx.fs.*`（统一 seam，带版本守卫、沙箱策略、写前 waterfall）；**v1.53 起有唯一一处例外——「改名」**：seam 只有 `writeText` / `editText`，没有 rename 动词，于是改名走 `ArtifactIo.renameEntry` 直调 `node:fs/promises.rename`，同时把 seam 原本提供的保证**在本地复刻**成三道闸：源与目标都过 `fs.contains(boundary)`；目标沙箱策略是 `read-only` 直接拒（`FS_SANDBOX_DENIED`）；`processPathOf` 证明两端的宿主路径来回映射回**同一个** `targetKey` 才动手（证明不了就 `FS_NOT_OBSERVED`） | 编辑回流与冲突处理有现成挂点；越过 seam 的只有改名一处，且守卫不减——缺的是动词，不是沙箱/远程场景用不上 |
| 设计稿的画板尺寸 | 预设只给「一屏」的规格（手机屏 375×812、**官网首屏** 1440×900、海报……），模型于是按屏产稿 | **v1.55 起：宽度取菜单、高度随内容**（`DESIGN_PRESET`，`src/host/prompt.ts`）——菜单给**宽度**（手机 375 / 平板 834 / 桌面 1440）与「固定规格、整块给出」的那几项（海报 1242×1660、社交方图 1080×1080、幻灯片 1920×1080、横幅 1920×600），并明说网页与应用是**一块画板一整页**：多屏才看得完的内容在同一条画板上连续排下去，**禁止**拆成「首屏 / 第二屏 / 第三屏」，要多块画板只在用户点名多屏并排（多屏对比 / 流程走查）或交付物本身是序列（幻灯片的每一页、海报系列）时 | **分屏是产出侧的规矩，不是渲染器的行为**：画布与预览本来就把全部画板摆在同一条可平移的画布上（`design-render.ts` 的 `fitTransform` 按 `documentBounds` 取景、可平移可缩放），所以这条只在预设里校准，客户端一行不用改 |
| 目录结构 | `ui/` + `tools/` 平铺 | `src/` 根＝入口 + 协议基座；`src/host/`（装配与 Remote 服务）、`src/core/{canvas,artifact,session}/`（纯逻辑）、`src/client/{wire,canvas,artifact,ui}/`（浏览器半），其中 `client/artifact/` 再分 `registry.ts` + `chrome.tsx`（插槽与两条登记通道）+ `viewers/` + `editing/` + `element-pick/`（v1.40 分层，v1.41 细化产物面，v1.42 把能力从注册表挪进各预览器）；`tests/` 镜像之 | 依赖层落成目录，非法依赖（`core/` → `host/`）看得见；两个构建入口路径不动，打包与清单不受影响。产物面按「一行一个预览器，能力长在预览器自己身上」再分，加一种形态不必回头改弹窗 |

## 十二、开放项（含已关闭项）

> 这一章是动手前必须钉死的点。**已关闭的保留在原位并划掉**，便于回溯当时为什么这样定；仍未关闭的按顺序编号。

1. ~~**工具名是否允许 `.`**~~ **已关闭（2026-09-17）**：实测把 `canvas.read_card` 这类名字发给模型供应商，请求被 400 拒绝——`Invalid 'tools[0].name': string does not match pattern. Expected a string that matches the pattern '^[a-zA-Z0-9_-]+$'`。宿主不对工具名做校验或改写，原样透传，所以字符集必须由插件自己守住。已全面改用 `canvas_read_card` 形式（§3.6 工具清单、`contract.ts` 的 `TOOL_NAMES`、`dsh.plugin.json` 的 `contributes.tools`、客户端 `tool.call.toolview` 的 keys 同步），并在 `tests/contract.spec.ts` 里用 `TOOL_NAME_PATTERN` 钉死。
2. **多卡片会话的并发与归属**：每张卡片一个 agent 是否可行（数量上限、并发轮次、资源占用），以及画布面板切换会话时的 fiber 生命周期。
3. **形态认定与 tab 认领的一致性**：Host 侧 `kind-registry` 的判定结果与 Client 侧 `patterns` / `canOpen` 必须给出一致答案，否则会出现「卡片显示为 A 形态、点开却是内置查看器」。
4. **PPTX 一秒级导出**（F10.2）的落地者：这取决于宿主是否已有 PPTX 生成能力，插件不应自带重型渲染引擎。
5. **发布**（F10.3）与子域名/回收的归属：需确认走宿主既有发布能力还是插件自建，避免与 Harness 的生命周期冲突。
6. **引用注入的上下文预算**（§3.5 F5.2）：摘要在域记录里缓存，还是每次注入现算；缓存则需定义失效时机。——**v1.37 基本关闭**：**默认通道不再有预算问题**——文件引用一个字的材料都不进上下文，模型按需 `read`，读哪一段也由它决定。产物摘要这一路仍是**每次现算、域记录里不缓存**，因为上游文件随时可被改写，缓存就得再定义失效时机，而现算的代价只是一次文件读；`summaryBudget` 只作用在这一路。这段历史里 v1.35 曾把预算交给宿主的 session-reference 服务现算，v1.37 撤销该通道后此路不复存在——问题的形状从「预算归谁算」变成了「根本不必预置材料」。
7. **为了"页面别动"，探针与页面本身抢方向盘**（v1.44）：`hold` 态把滚动位置钉住（`scroll` 里拨回进入这一态时的位置），于是**页面自己用 JS 滚动会被按回去**（`scrollIntoView`、轮播、锚点跳转都算）——这是有意的（用户正指着某一处写要求，画面就不该自己走），代价是这类页面在框开着时看起来「卡住」。同一支上还有 `aim` 态那条：**页面自己的内层滚动容器滚不动**（只读层整块盖住视口，滚轮只落到文档本身；选不到的元素得先退出模式滚过去）。两条都写进了 §8 的取舍，目前没有更好的做法——真要让内层容器也滚，就得放弃"整块盖住"的只读方案，而那会漏掉悬停那一族。
8. **改名之后，已有的路径引用不会跟着改**（v1.53，F1.12）：引用边在底层是**按路径交出去的文件引入**（**§五**里的「连线的底层 = 文件引用」，F5.3）——`@brief.md` 这个字符串一旦进了某张卡片的历史、或写进了别的产物正文，它就是一个死掉的路径，产物改名不会回头把它们重写。这是「引用不复制内容」换来的固有代价（同一枚硬币的背面：不复制 ⇒ 便宜、不过期，但也 ⇒ 名字一改就断）。当前的处理是**只保证新发生的引用用新路径**，旧的留着、点了报 `FS_NOT_FOUND` 而不是静默给错内容。真要做，得有一个「按 file 映射回卡 id、再重写各处路径」的对账 pass（F4.5 的引用对账已经有 file→id 的映射能力，缺的是**跨会话历史与产物正文的回写**，后者的成本不只是改字符串——用户写在正文里的路径是用户的内容）。在那之前，这条限制不出现在界面上（改名不弹「会影响 N 处引用」），因为卡片自己并不知道谁引用过它。
9. **v1.49 漏改期间写歪的游离子文件不会自己回家**（v1.57 记录）：八处 id 当路径的调用修好之后，此前落到 `<root>/<座位 id>` 上的内容仍躺在项目根里（现场是 `lzyoke`、`bajgne` 两个文件，内容是建卡时那行种子文字：`# 文本`、`# 未命名`），而它们对应的卡至今没有产物。插件**不自动清理**：那是用户目录里的东西，而且「这个文件是垃圾」这件事只有人能确认。当前靠 F3.13 那张卡自己的路补上——「手动输入」在**正确路径**上重新落一份空文件，板面照旧（座位在、产物补上）。将来若要收，只能是一次**列清清单、由用户确认**的清理，判据是「文件名恰好是某个座位 id，且不在板面投影的 file 集合里」；在此之前，它们也不会被认回某张卡——扫描落座对的是 **file**，座位 id 不是路径（这正是这次踩到的那条线）。
