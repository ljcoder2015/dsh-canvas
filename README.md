# dsh-canvas

> 跑在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 上的**通用创作画布插件**。
> **文件即产物，卡片即会话，取材即数据。**

把一个项目铺成一张无限画布：画布上的每张**文件卡片**绑定一个**独立的 Agent 会话**，卡片之间只允许一种连线——**取材**。产物形态由文件证据自动认定，所以 PPT、网页、文档、图表、图片、站点都是同一个插件下的自然结果，不需要事先声明"现在是 PPT 模式"。

```
卡片 = 一个磁盘文件 + 一个独立会话       连线 = 取材（B 取材于 A）
产物形态 = 文件证据自动认定              扩展 = 加一条形态注册表条目
```

- 产品文档：[`docs/DeepSeek-Harness-Canvas-产品文档.md`](docs/DeepSeek-Harness-Canvas-产品文档.md)（版本号随每次改动更新）
- 质量：`npm run check` 全绿（typecheck + eslint + **154 项**单元测试 + 双端打包）

---

## 目录

- [为什么不是"又一个 AI 画布"](#为什么不是又一个-ai-画布)
- [功能一览](#功能一览)
- [快速开始](#快速开始)
- [画布操作](#画布操作)
- [配置项](#配置项)
- [Agent 工具集](#agent-工具集)
- [架构](#架构)
- [开发](#开发)
- [项目结构](#项目结构)
- [设计边界](#设计边界)
- [许可](#许可)

---

## 为什么不是"又一个 AI 画布"

| 维度 | 传统 AI 创作工具 | dsh-canvas |
|------|----------------|------------|
| 上下文 | 单一长会话，越用越膨胀 | **每张卡片独立会话**，按需注入、天然隔离 |
| 产物形态 | 预定义模式（"PPT 模式"/"网页模式"） | **文件证据自动认定**，加形态不改分支 |
| 协作方式 | 聊天框里用自然语言描述 | **取材关系**显式传递数据，有向、可追溯 |
| Agent 可见范围 | 全部内容 | **仅当前卡片 + 显式引用**的上游产物 |
| 扩展方式 | 加功能分支 | 加一条形态注册表条目 |

连线的语义被**刻意收窄**到只剩一个方向。改自、接着、对照、批注这些协作语义不再由连线表达，而是交给卡片命名、产物内引用与共享便利贴承载——**能靠约定表达的，就不该变成画布上的结构负担**。

---

## 功能一览

### 画布空间

| 编号 | 功能 | 要点 |
|------|------|------|
| F1.1 | 无限延伸画布 | 卡片自由拖拽定位，支持缩放与框选 |
| F1.2 | 文件系统映射 | **卡片 id 即文件路径**，零额外映射 |
| F1.3 | 实时同步 | 画布内容与磁盘文件双向实时同步 |
| F1.4 | 视图持久化 | 每个项目各自的布局、缩放、卡片位置自动保存 |
| F1.5 | 左栏画布区 | 一个**包裹**（标题 + 新建按钮 + 画布列表），而非一排按钮；侧栏收成 rail 时让位给一枚图标，点图标即新建 |
| F1.6 | 画布即工作区 | 创建画布时把画布根目录登记为宿主工作区，卡片会话挂到画布名下而非"未分组" |
| F1.7 | 指针与键盘 | 指针默认是**选择箭头**；平移握在**空格**里（捕获阶段拦下按压，卡片上方也成立）；WASD / QE 键盘操作；底部 dock：新增（最左，实心圆）+ 快捷键说明弹层；左下角缩放条：− / 百分比 / + / **自动排版** |

### 形态与产物

| 编号 | 功能 | 要点 |
|------|------|------|
| F2.1 | 形态注册机制 | 一种形态一个条目，含 detect / preview / export / publish |
| F2.2 | 文件证据认定 | 由扩展名与内容判定，**不由用户声明** |
| F2.3 | 内置形态 | HTML Deck、站点、Markdown、图片、视频、数据图表 |
| F3.8 | 双击全屏预览 | 弹窗**铺满整块画布**（同宽同高、不留边距），头部只有产物名 + 形态 + 关闭；按形态分派查看器：Markdown 渲染 / 图片视频 / **沙箱 iframe**（`allow-scripts` 无同源）/ CSV·JSON 表格 / 纯文本兜底 |
| F3.10 | 操作胶囊收敛 | 只留**没有其它入口**的动作：对话、导出、从画布移除 |

### 卡片与会话

| 编号 | 功能 | 要点 |
|------|------|------|
| F3.1–F3.4 | 会话绑定 | 建卡即建独立会话，system prompt 注入卡片路径 / 形态 / 项目风格；**A 卡看不到 B 卡的对话与文件**；历史持久化，重开自动恢复 |
| F3.5 | 状态指示 | 卡片上**没有状态点**：运行由流光说（F3.7），流光不在就是「没事发生」；文件已不在的卡片预览变淡示意 |
| F3.7 | **生成中反馈（流光）** | 回合进入 running，卡片亮起一道斜切 25° 的光带扫过（1.8s 一趟）；名字与预览照常显示，**边框不变色**（边框归悬停与选中）。**回合结束流光即停，卡面回显最新产物**。`prefers-reduced-motion` 下**不熄灭**：照扫，只是减速减淡（3.6s、60%）——光在动是唯一的进行中信号 |
| F3.9 | 提示词回填 | 控制带输入框与 ⤢ 全屏弹窗**共用同一份草稿**：未编辑时显示用户对该卡片**最近一条自己发出的消息**（逐字保留换行）；插件注入的取材上下文不算用户的话，**不回填** |
| F3.11 | 卡片控制带 | 选中卡片下方是一条控制带：**提示词输入框**（⌘/Ctrl+Enter 发送，空稿禁用）、取材 chips + ⊕、⤢ 全屏编辑器、模型席位。卡片上没有「还没有消息。」一类的状态文字，**也没有状态点**：进度由流光说，产物由卡面预览说 |

### 取材关系

| 编号 | 功能 | 要点 |
|------|------|------|
| F4.1 | 唯一连线 | B 取材于 A：有向、可多重（多上游 / 多下游） |
| F4.2 | 从锚点拖线 | 按住卡片侧边端口拖出，线从**锚点（端口圆心）起笔**、终点跟随指针，**细线、无箭头**——它还不是关系，只是一个没落地的动作 |
| F4.3 | 取材持久化 | 作为画布元数据独立存储（不落文件系统）；存储键经**定宽转义**落进 `^[a-zA-Z0-9_-]+$` |
| F4.4 | 取材可视化 | 落定线与拖拽中的线**同款**：1px、实线、无箭头、breeze 色；**线不可交互**（整层 `pointer-events:none`，永不拦截跨越它的拖拽） |
| F4.5 | 自动对账 | 产物里真实引用到的素材（HTML `src`、Markdown 图片链接）**反向生成取材边** |
| F4.6 | 上游链排布 | 按取材链分层：上游在左、下游在右，同层对齐。三种策略（按链成列 / 纯网格 / 整理）由 agent 工具调用；**画布左下角的「自动排版」按钮**走同一条通道、用「整理」策略——链上的卡按链排、散卡在下方网格收拢，排完自动取景（只缩不放） |
| F4.7 | 上游追溯 | 查看完整上游链（含间接）与下游卡片 |
| F4.8 | 空白落笔建卡 | 拖线放到空白处**不再作废**：就地弹出「新增节点」，点一种形态即**当场建卡并连线**，新卡端口正好接住线头；点弹层外任何地方 / Esc / 手松在画布外均取消这一笔 |
| F4.9 | 取材解除 | 每枚取材 chip 的**右上角挂删除钮**：一条 chip 就是一条**直接**取材边，点击即删掉这条关系（`canvas/unlink_source` 通道的 UI 入口），画布与存储同步退场。间接上游不是这张卡的关系、删无可删，不进 chips |

### 导出与发布

| 编号 | 功能 | 要点 |
|------|------|------|
| F10.1 | 多格式导出 | HTML / PDF / PPTX / PNG / SVG / zip |
| F10.4 | Agent 触发 | 导出与发布都注册为工具，Agent 可自动调用 |

---

## 快速开始

### 环境要求

| 项 | 要求 |
|----|------|
| Node | `^22.19 \|\| >=24` |
| 包管理器 | pnpm `>=9`（本仓库锁定 `pnpm@10.17.0`） |
| Harness | `dsh >= 0.1.0-rc.6` |

### 安装

```sh
# 1. 取材并构建（prepare 脚本会自动跑 build）
git clone git@github.com:ljcoder2015/dsh-canvas.git
cd dsh-canvas && pnpm install && pnpm run build

# 2. 从本地目录安装进 web profile
dsh plugin --profile web add .
```

也可以直接从 Git 安装：

```sh
dsh plugin --profile web add github:ljcoder2015/dsh-canvas
```

> pnpm ≥10 会拦截安装期的 `prepare` 构建。按 `dsh` 的提示在该 profile 的 `pnpm-workspace.yaml` 里加 `allowBuilds: { dsh-canvas: true }` —— **该授权允许包在安装时执行代码，只对可信来源开放并锁定 commit**。

### 启动与调试

```sh
dsh web --no-open      # 终端首行打印访问地址与 token（token 每次重启都会变）
dsh plugin --profile web remove dsh-canvas   # 卸载
```

开发期把包加进工作区软链后：

- **Client 半**（`src/client/**`）改动 → `dsh-client-hmr` 轮询客户端 bundle，**刷新页面即生效**
- **Host 半**（`src/**`、`src/core/**`）改动 → 需**重启 Web Harness**

---

## 画布操作

dock 上的快捷键弹层印的就是下表——键位表与按键分派共用同一份声明（`src/client/shortcuts.ts`），**印出来的每一行都按得动**。

| 键位 | 动作 |
|------|------|
| `Space` | 按住并拖动，平移画布（卡片上方也生效） |
| `W` / `A` / `S` / `D` | 画布上移 / 左移 / 下移 / 右移（每次 72px，按住连续） |
| `Q` / `E` | 缩小 / 放大画布（每次 ×1.12，按住连续） |
| 滚轮 | 平移视图；按住 `Ctrl` / `⌘` 即缩放 |
| 拖动卡片 | 移动卡片（点空白处仅取消选择） |
| 双击卡片 | 全屏预览产物 |
| 左下角「自动排版」 | 整理整块画布：链上的卡按取材链成列、散卡在下方网格收拢；排完自动取景（只缩不放）并落盘 |

键盘监听挂在 `window` 上，因此自带守门：`isTypingTarget` 排除一切吃文字的控件（在提示词里打 `a` 不会把画布平移走）、修饰键组合不碰、同屏多块画布由模块级名册判定归属。键盘改动的视口**停顿 400ms 后落盘**。

---

## 配置项

在 profile 的 `cordis.patch.yml` 里为 `dsh-canvas` 行加 `config` 块即可覆盖默认值：

```yaml
- insert:
    - id: dsh-canvas
      name: dsh-canvas
      config:
        arrangeGap: 88
        sourceDepth: 4
        upstreamPolicy: pull
```

| 键 | 类型 | 默认 | 说明 |
|----|------|------|------|
| `pickerRoot` | string | `''`（用 `$HOME`） | 系统文件夹选择器打开时的起始目录 |
| `arrangeGap` | number | `88` | 排布卡片时的水平间距（画布 px），范围 8–400 |
| `summaryBudget` | number | `4000` | 单次注入卡片会话的产物摘要字符预算，范围 200–200000 |
| `sourceDepth` | number | `3` | `getSources` 解析取材链的层数，范围 1–16 |
| `upstreamPolicy` | `silent` \| `notify` \| `pull` | `notify` | 上游产物变更时，下游卡片会话的响应策略（F5.7） |

---

## Agent 工具集

工具名一律 `canvas_` 前缀 + 下划线分隔——名字作为 `tools[].name` 发给供应商时字符集被限死在 `^[a-zA-Z0-9_-]+$`，**带 `.` 的名字会被直接 400 拒绝**（`tests/contract.spec.ts` 用 `TOOL_NAME_PATTERN` 钉死这条约束）。

| 工具 | 作用 |
|------|------|
| `canvas_read_card` | 读取指定卡片产物摘要 |
| `canvas_read_sources` | 读取当前卡片所有上游（取材来源）的产物摘要 |
| `canvas_link_source` | 声明本卡片取材于另一张卡片 |
| `canvas_get_sources` | 获取取材链：直接上游、间接上游与下游 |
| `canvas_inject_card` | 把指定卡片产物注入当前会话（`summary` / `full`） |
| `canvas_read_board` | 读取画布当前座次、卡片清单与取材边 |
| `canvas_arrange_on_board` | 按取材链语义化摆位（`source-chain` / `grid` / `organize`） |
| `canvas_create_on_board` | 创建便签或卡片 |
| `canvas_organize_board` | 归纳收纳：链条摆好、游离卡片打包到下方 |
| `canvas_link_source_on_board` | 在画布上直接画一条取材线（`from` 是素材、`to` 是产物） |
| `canvas_generate_image` | 为某张图片卡片生成画面 |
| `canvas_export` | 导出产物 |
| `canvas_publish` | 发布产物 |

工具分两类：**卡片内**工具（前五个与 `generate_image`）只在卡片会话里可用，调用方身份从会话解析，拿不到就直说"请先打开这张卡片的对话"；**画布级**工具（`read_board` 及其后）以画布为作用域。

---

## 架构

### 双端插件

```
┌──────────────────────────── Host (Node / Cordis) ────────────────────────────┐
│  src/index.ts        Config schema + apply()                                 │
│  src/runtime.ts      CanvasRuntime   画布 / 取材链 / 排布      ┐             │
│  src/card-runtime.ts CardRuntime     产物读写 / 注入 / 导出发布 ┘ Remote 服务  │
│  src/tools.ts        defineTool × 13                                          │
│  src/prompt.ts       卡片会话的 prompt 注入段落                                │
│  src/core/*          纯逻辑层（不依赖 Cordis）                                 │
│  src/domain.ts       存储领域 defineDomain（per-record）                       │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     │ Typert Remote
                      契约唯一真源 src/contract.ts（一份 descriptors，三处引用）
                                     │ 每个方法一条 descriptor
┌────────────────────────────────────┴─────────────────────────────────────────┐
│  src/client/index.tsx   席位注册（同步，先于 Remote mount 解析）               │
│  src/client/canvas-view.tsx   无限画布正文                                   │
│  src/client/artifact-view.tsx 按形态分派的查看器注册表                         │
│  src/client/source-edges.tsx  取材线几何（锚点 / 落位反推 / 细线）              │
│  src/client/locales.ts · styles.ts                                            │
└──────────────────────────── 浏览器 (lib/client.js, CJS) ──────────────────────┘
```

**关键机制**

- **打包**：`build.mjs` 用 esbuild 出两个 bundle。`external` 是**整个** `@deepseek-ai/*` 作用域——手写枚举曾把 `@deepseek-ai/schemastery` 打进宿主包，让插件多出一个 `Schema` 类身份；`zod` 则必须打进包。Client 半用 `window.__ModuleLoader__.load` 的 CJS 外壳包住，react 由宿主提供。
- **持久化**：`defineDomain` + `domainTable`（zod 校验），布局为 `per-record`。**取材数据刻意不进文件系统**——文件系统不擅长表达跨文件依赖，而存储领域自带后端路由、记录版本、串行写链与 `domain/changed` 广播，插件不必自造元数据文件。
- **存储键路径安全**：per-record 的键必须落在 `^[a-zA-Z0-9_-]+$`，而卡片 id 是**路径**（带点带杠）。凡拿 id 当键一律过 `src/core/ids.ts` 的 `encodeSegment`（定宽 `_xxxx` 转义，`_` 自身也转义，故 `__` 是无歧义分隔符）。不安全键会在写盘时被介质**整笔拒绝**。
- **卡片会话的两个来源**：卡片会话由本插件自建、不走控制器的组装路径，所以必须显式补两样东西——
  - `core/model-routing.ts`：补 `AgentOptions.provider/model`，并把已记录的会话选择装回（缺了会得到 `prompt variable "{{model}}" has no value`，整轮失败）
  - `core/agent-preset.ts`：在工厂 `setup(agentCtx)` 里 `mount` 部署 preset（缺了所有面向模型的写盘工具都是 `unknown tool`）
- **席位**：主面板、右栏停靠 tab、`tool.call.toolview` 实时工具卡片、`sidebar.panellist` 画布区。左栏画布区是**包裹**而非按钮：只注册一行，由 `canvas-nav.tsx` 经 `createPortal` 把 header 与画布列表挂进宿主 `<nav>`，从自己图形的钩子类上溯定位并挂 `MutationObserver` 应对容器重建。
- **文件访问**：一律走 `ctx.fs`（统一 seam，带版本守卫、沙箱策略与写前 waterfall）。写入必须携带**目标项目根**作为 `workspace-write` 边界，而不是继承现行策略——否则"在别处打开的画布"会被 seam 直接拒绝。

---

## 开发

| 脚本 | 内容 |
|------|------|
| `pnpm run build` | esbuild 双端打包 + `tsc` 产声明文件到 `lib/types` |
| `pnpm run typecheck` | 对 `src` 与 `tests` 两个 program 各跑一次 `tsc --noEmit`（双端类型都要过） |
| `pnpm run lint` | eslint（flat config） |
| `pnpm run test` | vitest |
| `pnpm run check` | typecheck → lint → test → build（提交前跑的就是它） |

当前基线：**14 个测试文件、154 项测试全绿**。

---

## 项目结构

```
dsh-canvas/
├── package.json            # 唯一 Harness 清单：dsh.bundle.patch + dsh.client
├── cordis.patch.yml        # 把 Host 插件行挂进 profile（可覆盖 Config 默认值）
├── dsh.plugin.json         # 注册表清单：id / engines / contributes
├── build.mjs               # esbuild 双端打包
├── eslint.config.js
├── tsconfig.json           # typecheck：src
├── tsconfig.build.json     # 只产声明 → lib/types
├── tsconfig.tests.json
├── vitest.config.ts
├── docs/
│   └── DeepSeek-Harness-Canvas-产品文档.md   # 唯一产品文档，版本号在头部
├── src/
│   ├── index.ts            # Host 入口：Config schema + apply
│   ├── runtime.ts          # CanvasRuntime：画布 / 取材链 / 排布
│   ├── card-runtime.ts     # CardRuntime：产物读写 / 注入 / 导出 / 发布
│   ├── contract.ts         # 双端共享的严格 wire 契约（唯一真源）
│   ├── typert.ts           # Host Typert manifest
│   ├── types.ts            # 双端共享类型
│   ├── domain.ts           # 画布持久化领域声明（defineDomain）
│   ├── tools.ts            # 13 个 canvas_* 工具注册
│   ├── prompt.ts           # 卡片会话的 prompt 注入段落
│   ├── capabilities.ts     # 部署能力探测（可选席位按能力降级）
│   ├── core/               # 纯逻辑层，不依赖 Cordis
│   │   ├── ids.ts              # 存储键的定宽转义
│   │   ├── kind-registry.ts    # 形态注册表
│   │   ├── artifact-io.ts      # 文件读写的唯一出口（沙箱策略在此定夺）
│   │   ├── source-store.ts     # 取材边存储
│   │   ├── session-manager.ts  # 卡片会话生命周期与归属
│   │   ├── session-log.ts      # 读会话事件日志（冷会话照读）
│   │   ├── model-routing.ts    # 卡片会话的模型来源
│   │   ├── agent-preset.ts     # 卡片会话的工具来源
│   │   ├── board.ts            # 排布策略
│   │   └── workspace.ts        # 画布即工作区（登记与挂账）
│   └── client/
│       ├── index.tsx           # Client 入口：席位注册 + Remote mount
│       ├── bridge.ts           # Remote 调用的类型化适配层
│       ├── canvas-view.tsx     # 无限画布正文（指针 / 键盘 / 落笔建卡）
│       ├── source-edges.tsx    # 取材线几何
│       ├── card-tile.tsx       # 卡片（含流光层）
│       ├── card-overlay.tsx    # 选中态控制带
│       ├── artifact-view.tsx   # 按形态分派的查看器
│       ├── canvas-nav.tsx      # 左栏画布包裹（Portal 挂载）
│       ├── canvas-panels.tsx   # 主面板 / 侧栏席位
│       ├── tool-view.tsx       # canvas_* 的实时工具卡片
│       ├── shortcuts.ts        # 键位真源 + 说明表
│       └── locales.ts · styles.ts
└── tests/                  # 14 个 spec
```

---

## 设计边界

**做**：通用文件产物的创作与管理；卡片级会话隔离与取材驱动协作；任意形态的产物生成。

**不做**：

- 不做实时多人协作编辑
- 不做文件版本控制系统（依赖底层文件系统）
- 不做独立的模型服务（复用 Harness 模型适配层）
- 不做重型渲染引擎（预览依赖浏览器能力）
- 不做通用关系图谱 / 语义网络——连线只有取材一种

---

## 许可

[MIT](LICENSE)
