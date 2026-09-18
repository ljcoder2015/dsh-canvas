# DeepSeek Harness 通用创作画布插件 · 产品文档

**版本**：v1.24
**状态**：产品设计定稿；技术架构已按 `dsh-plugin-template` 与 Harness 子系统文档校准
**v1.24 变更**：**预览弹窗去掉「在右栏打开」**（F3.8 修订）——弹窗头部只剩产物名、形态与关闭 ×。超限文件的提示不再指路（`canvas.viewer.tooLarge` 改口径），`onOpenTab` 与它在客户端一路的接线（`openArtifactTab`、`CanvasBoardProps.openResource`、管理区依赖项、入口处 `ctx.sidebarRight.openResource`）连同 `canvas.viewer.openTab` 文案键一并撤掉；右栏的产物标签页类型照旧注册，仍可由宿主的标签页入口按地址打开
**v1.23 变更**：**双击预览铺满画布**（F3.8 修订）——预览弹窗从「近满屏的居中对话框」改为**整块画布大小**（与画布区同宽同高、不留边距、不切角），Markdown / 图片 / 视频 / iframe / 表格各形态的阅读区因此拿到画布的全部面积；Esc 关闭与「在右栏打开」不变。连带修掉一个既有缺陷：预览的宽度声明被通用对话框规则（同权重、文件里更靠后）顶掉，实际一直是 520px 宽——选择器改为双类压过它
**v1.22 变更**：左下角缩放条里那枚**「适应画布」换成「自动排版」**（F1.7 修订 + F4.6）——点它把整块画布交给 host 的 `organize` 策略重排（与 agent 工具 `canvas_arrange_on_board` 同一条通道、同一份算法，不经过模型），排完自动取景（**只缩不放**：装不下才缩，装得下停在 100%）并把视口落盘；空画布上按钮禁用
**v1.21 变更**：①**流光在「减少动态效果」下不再熄灭**（F3.7 修订）——旧样式在 `prefers-reduced-motion: reduce` 时写的是 `animation:none` 加光带停在正中，而用户的系统正开着这个开关，于是卡片看着像固定不动、与「卡住」无从区分；现在 reduce 下照扫，只把动感降下来（一趟 1.8s → 3.6s、光带减淡到 60%）；②运行态**去掉黄色边框**（F3.7）——卡面只微亮一档，边框归悬停与选中，不再随运行变色；③**去掉卡片上的状态点**（F3.5 修订 + F3.11）——运行由流光说，控制带的模型席位旁也不再有那枚灯；状态点只剩左侧的实时卡片（tool-view）在用
**v1.20 变更**：①提示词输入框**回归控制带**（F3.11 重写）——选中卡片下方的条里重新有了输入框与发送钮，⤢ 弹窗降为同一份草稿的全屏编辑器（一盒两尺寸，不是两盒）；②取材 chips 加大一号并挂上**右上角删除钮**（新增 F4.9）——一条 chip 就是一条取材边，点删除钮即删掉这条关系（`canvas/unlink_source` 通道首获 UI 入口），chips 从此只列**直接**边；③连带修掉一个既有缺陷：⊕ 引入的「已声明」判断原拿摘要表（含间接上游）作数，选间接上游会被静默跳过不建线，改按画布的直接边判。
**v1.19 变更**：①生成中反馈（F3.7 重写）——运行态卡片由骨架图改为**流光**：斜切 25° 的光带整卡扫过（独立子层，卡片不能裁剪——端口悬在卡外），名字与预览照常显示，回合结束即停、卡面回显新产物；②卡片控制带（新增 F3.11）——选中卡片下方去掉提示词输入框与「还没有消息。」状态文字，只留取材 ⊕、⤢、模型席位与状态点（v1.20 已把输入框请回来）
**v1.18 变更**：取材线收敛为一副样子（F4.4 重写）——两个节点之间的连线改成与**拖拽中**完全同款：1px 细线、实线、无箭头，选中卡片只提亮不透明度；**去掉点线的交互**，线层 `pointer-events:none` 只负责看，解除取材走 agent 工具
**v1.17 变更**：修复拖线闪动——取消一次拖拽后再次从锚点按下时，指针状态还停留在上次的终点，pending 线会先按旧位置画一帧再跳回锚点；现在按下即把线钉到本次锚点（`onConnectStart` 随事件同步重置指针）
**v1.16 变更**：锚点拖线交互改版（F4.2 重写 + 新增 F4.8）——拖拽中的线改从**锚点（端口圆心）起笔**、终点就是指针，样式是**细线、无箭头**；放到空白处不再直接作废，而是就地弹出**「新增节点」弹窗**，点一种形态即当场建卡并连线（新卡的端口正好接住线头，落成后连线两端回到卡片上），点空白处 / Esc / 点弹层外任何地方则取消。实测同场翻出并修掉一个既有缺陷：手动连线的存储键 `a<-b` 不满足介质的路径安全校验，**取材边从未落过盘**；键改为与卡片表同一套转义（F4.3）
**v1.15 变更**：dock 与快捷键弹层打磨（F1.7 修订）——dock 的新增按钮移到**最左**并改为**实心圆 + 画布强调色**，快捷键按钮退为幽灵钮；快捷键 Popover 改**一个键一行**（10 行，方向与缩放各配一句自己的话），键帽列对齐
**v1.13 变更**：左栏画布区改版（F1.5 重写）——不再一行画布一枚按钮地铺进 `sidebar.panellist`，改为**一个包裹**：header（标题 + 右侧新建按钮）与画布列表；收起时整棵包裹让位给一枚图标，点图标即新建
**v1.12 变更**：画布即工作区（F1.6）——创建画布时把画布根目录登记为宿主工作区，卡片会话开启即挂账，对话归到画布名下而不是「未分组」；新增 `src/core/workspace.ts`
**v1.11 变更**：生成中反馈改版（F3.7）——运行态卡片由「边框流光 + 预览压暗」改为**骨架图闪光**：整卡转占位底色，名字与预览换成会跑光的骨架条；撤掉 conic 光弧与卡面扫光
**v1.10 变更**：操作胶囊收敛——去掉「打开」与「建立取材」两枚按钮，只留没有其它入口的动作（§3.3 F3.10）；全屏预览头部新增「在右栏打开」，承接超限文件的去处
**v1.9 变更**：输入框回填（F3.9）——未编辑时卡片提示词输入框显示用户最近一条自己发出的消息；新增 Host 读会话事件日志的 `card/read_last_prompt` 通道与 `src/core/session-log.ts`
**v1.8 变更**：对话页面去掉画布卡片标签页——不再注册 `conversation.view` 席位，删除 `card-panel.tsx`；卡片内容展示走 F3.8 全屏预览与右栏产物 tab
**v1.5 变更**：①卡片会话的**工具来源**（§4.5）——Web 面把模型面向的文件工具行从宿主组装移出、改由 agent preset 提供，自建卡片会话不加入 preset 就没有任何写盘手段；新增 `src/core/agent-preset.ts` 承载组装。②生成中反馈（F3.7）——运行态卡片加流光，信号直接取会话状态，不新造客户端乐观标志
**v1.4 变更**：卡片会话的**模型来源**（§4.5）——自建 agent 必须补 `AgentOptions.provider/model`，且已记录的会话选择要在开卡时装回；新增 `src/core/model-routing.ts` 承载该策略
**v1.3 变更**：工具名由 `canvas.xxx` 全量改为 `canvas_xxx`——供应商对 `tools[].name` 的字符集限制为 `^[a-zA-Z0-9_-]+$`，点号会被 400 拒绝（§3.6、§4.12 第 1 项）
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
| F1.5 | 左栏画布区 | 一个包裹而非一排按钮：header 是「画布」标题 + **右侧新建按钮**（点它弹系统文件夹选择器，选定即建画布），下面列出已有画布、点行切换。侧栏收成 rail 时包裹整棵隐藏，只剩一枚画布图标（宿主那一行），**点图标即新建**。选中高亮由宿主全局标准席位 `usePanelInfo`（`activePanelId`）驱动 |
| F1.6 | 画布即工作区 | 创建画布时同步把画布根目录登记为宿主工作区（标题=画布名，幂等：用户手动加过的同名目录解析到同一条记录、不改名），卡片会话开启时挂到该工作区账下——对话从此归到画布名下而不是「未分组」；重开旧画布时已绑会话一并补挂。全链路尽力而为：无工作区名册的部署整体空操作，注册/挂账失败只记日志不上抛 |
| F1.7 | 指针与键盘 | 指针默认**选择箭头**：点卡片即选中、拖卡片即移动，空白处一按只是取消选择；平移握在**空格**里——按住空格整块表面（含卡片上方）变抓手，拖的是取景框而不是卡片（在捕获阶段拦下按压，卡片收不到）。键盘：W A S D 上左下右平移、Q / E 缩小 / 放大（按键重复照收，按住即连续）；键盘改的视口按停顿落盘（半秒无声提交一次），指针仍在抬手时提交。底部 dock 两枚按钮：**新增在最左**，实心圆 + 画布强调色（与卡片上的 primary 胶囊同源），旁边是快捷键按钮（幽灵钮）——点开 Popover 印出键位表，**一个键一行**、各配一句自己的话；表体与分派同源（`src/client/shortcuts.ts`），印出来的每一行都按得动。左下角是缩放条：− / 当前百分比 / +，以及**自动排版**（F4.6）——空画布上禁用 |

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
| F3.5 | 会话状态指示 | 卡片上**没有状态点**：运行中由流光说（F3.7），流光不在就是「没事发生」。卡面因此只有名字与产物预览两行信息，四态里的空闲/有通知/文件已不在不再各占一枚灯（文件不存在的卡片仍以预览变淡示意） |
| F3.6 | 卡片切换 | 卡片胶囊上的「对话」按钮把主区域切到该卡片会话（对话页面本身不再有画布卡片标签页，见 §4.8 注） |
| F3.7 | 生成中反馈 | 会话运行中时卡片亮起**流光**：一道斜切 25° 的光带从左扫到右（1.8s 一趟、匀速不停顿），画在独立子层 `.dsh-canvas-shimmer` 上盖住整卡——卡片自身不能 `overflow:hidden`（取材端口悬在卡外）；名字与预览照常显示（卡上留着的是最近一次真正存在的产物），光的往复就是「正在产出」的整句话。卡面只微亮一档、**边框不变色**（边框归悬停与选中）。回合结束流光即停，画布按会话域的变动重读产物摘要、卡面回显新产物。`prefers-reduced-motion` 下**不熄灭**：同一条光带照扫，只把动感降下来（3.6s 一趟、光带减淡）——光在动是这张卡唯一的进行中信号，停摆的光与「卡住」无从区分 |
| F3.8 | 双击全屏预览 | 双击卡片全屏展示产物内容，**弹窗就是整块画布大小**（与画布区同宽同高、不留边距、不切角——旧版是 520px 宽的居中对话框，宽度声明被通用对话框规则顶掉）；头部只三样：产物名、形态、关闭 ×（**没有**任何其它按钮）；按形态从查看器注册表取组件：Markdown 渲染、图片/视频、HTML/Deck 沙箱 iframe、CSV/JSON 表格、其余纯文本；产物全文经 `card/read_artifact` 传输（文本 2MB 截断、二进制 16MB 内转 data URL，超限如实提示，不再提示去别处看） |
| F3.9 | 提示词回填 | 控制带的输入框与 ⤢ 全屏弹窗**共用同一份草稿**（一盒两尺寸，见 F3.11）：两者在用户未编辑时都显示该卡片**最近一条自己发出的消息**（逐字保留换行）——来自 Host 读会话事件日志的通道 `card/read_last_prompt`，冷会话（本页从未打开过）照读；插件注入的取材上下文不算用户的话，不回填。用户键入的草稿优先于回填、按卡片各自保留 |
| F3.10 | 操作胶囊收敛 | 选中卡片上方的动作胶囊只留**没有其它入口的动作**：对话、导出、从画布移除。「打开」删除——产物展示归双击全屏预览（F3.8）；「建立取材」删除——取材已由卡片两侧端口（拖拽连线）与控制带 ⊕ 菜单两个入口覆盖，胶囊不再放第二扇更弱的门 |
| F3.11 | 卡片控制带 | 选中卡片下方是一条**控制带**：提示词**输入框**（⌘/Ctrl+Enter 发送，空稿禁用发送）与取材 chips、⊕ 引入入口、⤢ 全屏编辑器、模型席位一行排开。卡片上没有「还没有消息。」一类的状态文字，**也没有状态点**——进度由卡片自己的流光（F3.7）说，产物由卡面预览说；发送入口是条内输入框、⤢ 弹窗与「对话」胶囊三条 |

### 3.4 取材关系

| 编号 | 功能点 | 说明 |
|------|--------|------|
| F4.1 | 取材关系 | 卡片之间唯一的连线类型：B 取材于 A。有向、可多重（一张卡片可有多个上游、也可被多张卡片取材） |
| F4.2 | 取材建立 | **从锚点拖线**：按住卡片侧边的端口拖出去，拖拽中的线从**锚点（端口圆心）**起笔、终点跟随指针，样式为**细线、无箭头**——它还不是一条关系，只是一个还没落地的动作。松手落在另一张卡片的端口上即直接建立（只需定方向，不需要选类型）；落在空白处则就地弹出「新增节点」弹窗（F4.8） |
| F4.3 | 取材持久化 | 取材数据作为画布元数据独立存储。存储键由两端卡片 id 转义拼成（卡片 id 是路径、带点带杠，而 per-record 介质的键必须落在 `[a-zA-Z0-9_-]+`，与卡片表共用同一套定宽 `_xxxx` 转义），不安全键会在写盘时被介质整体拒绝 |
| F4.4 | 取材可视化 | 落定的取材线与**拖拽中的线同款**：1px 细线、实线、无箭头、breeze 色（F4.2）——线上没有第二个样子，选中卡片时只把不透明度提亮一档。**线不可交互**：整层 `pointer-events:none`，线只负责看，永不拦截跨越它的拖拽（解除取材走 chip 上的删除钮，F4.9；不在画布上点线） |
| F4.5 | 自动对账 | 产物中真实引用的素材自动生成取材边（HTML 里的 `src`、Markdown 里的图片链接等） |
| F4.6 | 上游链排布 | 按取材链分层：上游在左、下游在右，同层对齐。三种策略——`source-chain`（按深度成列）、`grid`（纯网格）、`organize`（整理：链上的卡按链排、散卡在下方网格收拢）——由 agent 工具 `canvas_arrange_on_board` 调用；**画布左下角的「自动排版」按钮**走同一条通道、用 `organize`（v1.22） |
| F4.7 | 上游追溯 | 查看当前卡片的完整上游链（含间接上游），以及取材于它的下游卡片 |
| F4.8 | 空白落笔建卡 | 拖线放到**空白处**不再直接作废：放手点就地弹出「新增节点」弹窗（文本 / 图片 / 矢量图片，与 dock 新增同一份菜单），点一种形态即**当场建卡并连线**——新卡片按放手点落位，让它的端口正好接住刚才的线头，于是细线不是「跳」到卡片上、而是就地变成取材边（两端回到卡片边框锚点）；弹层向屏上空间更大的那一侧张开，线头不被自己盖住。**点弹层以外的任何地方（含卡片）、按 Esc、或手松在画布之外，都取消这一笔**——不留卡片也不留线 |
| F4.9 | 取材解除 | 控制带里每枚取材 chip 的**右上角挂一枚删除钮**：一条 chip 就是一条**直接**取材边，点删除即经 `canvas/unlink_source` 删掉这条关系，画布与存储同步退场（这是该通道的第一个 UI 入口）。chips 从此只列直接边——`read_sources` 返回的**间接**上游是更上面某张卡的关系、删无可删，不进 chips（agent 仍经 `canvas_get_sources` 读到它们）；chip 加大一号（26px 高 / 12px 字 / 170px 宽），卡片不裁剪，角标探出上缘 |

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

工具名一律用 `canvas_` 前缀 + 下划线分隔（如 `canvas_read_card`）：名字会作为 `tools[].name` 发给模型供应商，字符集被限死在 `^[a-zA-Z0-9_-]+$`，带 `.` 的名字会被直接 400 拒绝。§4.12 的第 1 项开放项由此关闭。

| 工具名 | 功能 | 参数 |
|--------|------|------|
| `canvas_read_card` | 读取指定卡片产物摘要 | `cardId` |
| `canvas_read_sources` | 读取当前卡片所有上游（取材来源）的产物摘要 | 无 |
| `canvas_link_source` | 声明本卡片取材于另一张卡片 | `sourceCardId` |
| `canvas_get_sources` | 获取当前卡片的取材链（直接上游、间接上游、下游） | 无 |
| `canvas_inject_card` | 将指定卡片产物注入当前会话 | `cardId, mode: 'summary' \| 'full'` |
| `canvas_read_board` | 读取画布当前座次与取材边 | 无 |
| `canvas_arrange_on_board` | 按取材链语义化摆位 | `strategy` |
| `canvas_create_on_board` | 创建便签或卡片 | `type, content` |
| `canvas_organize_board` | 归纳收纳 | 无 |
| `canvas_link_source_on_board` | 画取材线 | `from, to` |
| `canvas_generate_image` | 生图 | `prompt, cardId` |
| `canvas_export` | 导出产物 | `cardId, format` |
| `canvas_publish` | 发布产物 | `cardId` |

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
| `model-routing` | 卡片会话的模型来源：新会话用部署默认 `agentOptions`，已记录的会话选择在开卡时交回控制器 | `src/core/` |
| `agent-preset` | 卡片会话的**工具来源**：从部署的 agent preset 组装，否则该会话没有任何文件写入工具（见 §4.5「卡片会话的工具从哪里来」） | `src/core/` |
| `session-log` | 输入框回填的取数侧：从会话事件日志读用户最近一条**自己发出的**消息（`source.kind === 'user'` 才算），冷会话经部署的 `ctx.sessionQuery.readSession` 读持久化（见 §3.3 F3.9） | `src/core/` |
| `workspace` | 画布即工作区（F1.6）：经部署的 `ctx.workspaceRegistry` 把画布根目录登记为工作区（`create(root, title)` 幂等）并把卡片会话挂账（`attachSession`，要求会话头 cwd 规范化后等于工作区路径）；无名册部署整体空操作，失败只记日志 | `src/core/` |

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

**卡片会话的模型从哪里来**（本条是上一条的代价，落地于 `src/core/model-routing.ts`）：普通会话由 `dsh-api-session-controller` 组装，组装内容除 agent 本身还有两样——`AgentOptions.provider/model`（取自 `agentDefaultModel.currentSelection()`）与"本会话的模型选择"（控制器在 agent 作用域上装一个选择引用）。卡片会话由插件自己经工厂创建，**这两样都得自己补**：

1. **`agentOptions` 必须给**：agent loop 用 `AgentOptions.provider/model` 构建每一次请求，缺失时直接报 `agent "<id>" has no provider/model`；同时部署的提示词段落（persona prefix）用 `{{provider}}`/`{{model}}` 取同一个字段，缺了连**系统提示词装配都过不去**（`prompt variable "{{model}}" has no value for this assembly`）。所以创建与恢复卡片 agent 时都带上部署默认模型。
2. **本会话已记录的选择要装回去**：选择活在会话日志里（`modelSelection` 投影的 `pending`／`lastUsed`），而 agent 每次重开都是新的。控制器装选择的那个内部方法不是公开 API，但**触发它的调用是公开的**——`sessionController.selectModel`，与宿主输入框模型席位同一条 wire 调用。插件的做法：agent 一发布就把会话自己的选择交给这次调用（每个 agent 一次），于是"上次选的模型"跨插件重载仍然生效，而策略本身始终归控制器所有。
3. **顺序即优先级**：全新会话用部署默认 → 有记录的选择覆盖它 → 会话存活期间的模型切换（输入框选的那次）覆盖以上两者（控制器的选择引用在装配与请求两处都生效）。

**卡片会话的工具从哪里来**（与前一条同源，落地于 `src/core/agent-preset.ts`）：模型面向的**文件工具不在 Host 组装里**。`dsh-web-app` 的 patch 把基座的 `tool-fs`／`tool-bash`／`tool-pwsh`／`tool-jobs`／`tool-fs-search`／`skill-filesystem`／`tool-skill`／`tool-goal`／`plan-mode`／`tool-subagent*` 全部 disable，改由每个会话**挂载一个 agent preset** 来组装——这是 Web 面的既定分工，不是配置疏漏。

卡片会话既然是普通会话，就必须同样走 preset，而它的产物**只能靠普通文件工具写出来**（它自己的提示词段落就是这么告诉它的）。不加入 preset 的后果是：会话只继承宿主组装，即本插件全局注册的 `canvas_*`，而模型被要求用 `write`／`edit` 编辑产物文件，每一次调用都返回 `unknown tool`，产物停在 absent，整个回合以"解释自己为什么交不出文件"收尾——从模型视角看这个失败极其莫名，因为它并不知道自己的工具表是怎么组装的。

因此：

1. **加入 preset 是卡片会话的成立条件，不是优化**。preset 在常驻作用域下组装一次，agent"加入"的方式是让它的作用域键 parent 到那个挂载点；**唯一受支持的调用点是 agent 工厂的 `setup(agentCtx)` 回调**——只有在那里组装尚未发布，preset 组装失败才能让整次创建回滚，而不是发布一个半组装的 agent。创建与恢复两条路径共用同一个 setup。
2. **preset 在任何 agent 创建之前解析并预校验**（`resolve()` 取部署默认，`standingKeyFor()` 验组装）。失败**故意不被吞掉**：一个 preset 坏掉的部署同样给不了卡片会话写盘能力，诚实的答复是"那条配置坏了"，而不是开出一条默默干不了活的会话。
3. **无 roster 的部署是 no-op 而非失败**：裸 harness、单测这类环境没有 `agentPresets` 服务，此时模型面向的工具行本来就留在宿主组装里、全局层人人可见，没有可加入的东西。服务按名结构读取（`ctx.get('agentPresets')`），同一份 bundle 同时跑在有 roster 与无 roster 两种部署下。

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
| Host 工具 | `ctx.tools.register('canvas_read_card', {...})` | `ctx.tools.register(defineTool({ name, description, parameters, output, execute }))`，需要 `inject: ['tools']` | 工具定义补 `output.schema` + `render`；名字须落在 `^[a-zA-Z0-9_-]+$`（§3.6） |
| 跨卡片调用 | Agent 直接持有 `canvas.getCard()` | 双端一律经 Typert Remote：契约 → Host manifest → Client 贡献 | 每个方法一条 descriptor，三处引用同一数组 |
| 页面/预览 | 自造 `preview(path) => Component` | 右栏 tab 类型注册表 + 资源地址认领 | 形态注册表一半落到宿主已有席位 |
| 取材存储 | 自建「画布元数据文件」 | `defineDomain` + `ctx.storageDomain.open()`，`domain/changed` 通知 | 不需要自造持久化与变更广播 |
| 会话创建 | 「创建卡片时自动创建独立会话」 | `ctx.sessions.create()` 归调用方 fiber；**不落盘**，必须经 agent 生命周期事务 | P0 的会话绑定需先打通 agent 工厂，工作量重估 |
| 会话隔离 | 靠 system prompt 约定 | 工具注册作用域 + `restrict` / `schemas(scope)` 的可见性过滤 | 隔离可被结构性保证，不必靠提示词 |
| 取材注入 | `agent.inject()` 抽象调用 | `agent.inject({ content, source: { kind: 'plugin', plugin } })`，追加持久化上下文但**不唤醒空闲 agent** | 响应策略（F5.7）需自行决定用 `inject` 还是直接发起轮次 |
| 文件访问 | 直接 `fs.read` | `ctx.fs.*`（统一 seam，带版本守卫、沙箱策略、写前 waterfall） | 编辑回流与冲突处理有现成挂点 |
| 目录结构 | `ui/` + `tools/` 平铺 | Host 在 `src/`，浏览器在 `src/client/`，纯逻辑在 `src/core/` | 目录树重排 |

### 4.12 需要在动手前钉死的开放项

1. ~~**工具名是否允许 `.`**~~ **已关闭（2026-09-17）**：实测把 `canvas.read_card` 这类名字发给模型供应商，请求被 400 拒绝——`Invalid 'tools[0].name': string does not match pattern. Expected a string that matches the pattern '^[a-zA-Z0-9_-]+$'`。宿主不对工具名做校验或改写，原样透传，所以字符集必须由插件自己守住。已全面改用 `canvas_read_card` 形式（§3.6 工具清单、`contract.ts` 的 `TOOL_NAMES`、`dsh.plugin.json` 的 `contributes.tools`、客户端 `tool.call.toolview` 的 keys 同步），并在 `tests/contract.spec.ts` 里用 `TOOL_NAME_PATTERN` 钉死。
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
| P0 | `canvas_read_sources` 工具：Agent 能读取上游取材卡片产物摘要 |
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
| 卡片会话的模型 | 自建 agent 时补 `agentOptions`，会话选择经 `sessionController.selectModel` 装回 | 卡片会话不走控制器的组装路径，缺前者装配即失败、缺后者跨重载丢选择；而选择策略本身仍归控制器 |
| 模型选择器写在哪 | 会话级（宿主投影）为真源，节点类型记忆只作"新会话继承" | 会话一旦自己选过就以会话为准，跨节点类型的记忆不覆盖已用过的卡片 |
| 卡片会话的工具 | 从部署的 agent preset 组装（`ctx.agentPresets.mount` 于工厂 `setup`） | Web 面已把面向模型的文件工具行从宿主组装移出、改由 preset 提供；自建会话不加入就一个写盘工具都没有，而产物只能靠普通文件工具写出来 |


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
| v1.3 | 2026-09-17 | 工具名去点号（实测供应商 400）：§3.6 表与字符集说明、`dsh.plugin.json` 的 `contributes.tools`、运行时提示消息改用 `TOOL_NAMES` 插值、`tests/contract.spec.ts` 钉死 `TOOL_NAME_PATTERN`；§4.12 第 1 项关闭。 |
| v1.4 | 2026-09-17 | **补齐卡片会话的模型来源**（实测 `prompt variable "{{model}}" has no value` 导致的整轮失败）：§4.5 新增「卡片会话的模型从哪里来」三段与 `model-routing` 模块；§6 增两条决策。成因是卡片会话由插件自建、不走控制器的组装路径，因此缺 `AgentOptions.provider/model`（装配与请求都要）与已记录选择的重装。 |
| v1.5 | 2026-09-17 | ①**补齐卡片会话的工具来源**（实测产物文件始终 absent、`write`/`edit`/`bash` 全返回 `unknown tool`）：§4.5 新增「卡片会话的工具从哪里来」三段与 `agent-preset` 模块。成因是 Web 面（`dsh-web-app`）把面向模型的工具行从宿主组装里 disable、改由每会话挂载 agent preset，而自建卡片会话未加入 preset，只继承全局 `canvas_*`。修法：`cardPreset()` 在创建前解析并预校验部署默认 preset，`composeCardAgent()` 在工厂 `setup(agentCtx)` 里 `mount`（创建与恢复同路），`meta.agentPreset` 记名；无 roster 部署整体 no-op。②新增 F3.7 生成中反馈（运行态卡片流光），信号取会话状态而非客户端乐观标志。 |
| v1.6 | 2026-09-17 | **新增 F3.8 双击全屏预览**：§3.3 加 F3.8。新增 wire 通道 `card/read_artifact`（descriptor、`ArtifactView` 类型与 schema、`ArtifactIo.view()`、`CardRuntime.readArtifact`、typert 成员、Client face/bridge）与 `src/client/artifact-view.tsx`——`VIEWERS` 注册表按 kind 分派（markdown 渲染 / 图片 / Deck 沙箱 iframe `allow-scripts` 无同源 / CSV·JSON 表格 / 纯文本兜底），`renderMarkdown` 先整体转义再拼标签，`parseDelimited` 处理引号与 CRLF；`tests/artifact-view.spec.ts` 16 项钉住映射、转义、解析与 schema。 |
| v1.7 | 2026-09-17 | **左栏管理区层级化（§3.1 加 F1.5）**：「新增画布」行更名「画布」（`canvas.manage.new`），升级为父节点；每个画布是其子行。父节点与子行用**同一枚板图标**（用户裁决：不加角标、不做层级肘线与尺寸差）；子行图形带 `dsh-canvas-glyph-child` 钩子类——纯把手不参与造型，styles.ts 在侧栏收成 rail 时以宿主发布的 `data-sidebar-collapsed` 为锚、`:has()` 反选整行隐藏（本表唯一的全局选择器，特此记名）。panellist 席位本身是平铺的行（无嵌套、不感知折叠），折叠隐藏只能落在插件自己的图形钩子 + 这条全局规则上。 |
| v1.8 | 2026-09-17 | **对话页面去掉画布卡片标签页**：`index.tsx` 不再向 `conversation.view` 注册 `dsh-canvas:card`，删除 `card-panel.tsx` 与仅供它使用的三个文案键；对话页标签条只剩宿主内置「对话 / 轨迹」。卡片会话本身不受影响，内容展示走 F3.8 全屏预览与右栏产物 tab；`bridge.findCardBySession` 保留（右栏产物 tab 仍在用）。 |
| v1.9 | 2026-09-17 | **输入框回填（§3.3 加 F3.9）**：未编辑时卡片提示词输入框显示用户对该卡片最近一条自己发出的消息。关键在「自己的」三个字：会话日志里 `user/message` 事件既承载用户输入也承载插件注入（`agent.inject` 的取材上下文），只以消息 `source` 区分，读侧只认 `source.kind === 'user'`。读的是**会话事件日志**而非浏览器实时投影——投影只对本页打开过的会话存在，而输入框恰恰要回答「这张我还没打开过的卡片上次让我干什么」。新增 `card/read_last_prompt` wire 通道（descriptor + `LastPrompt` 类型/schema、`src/core/session-log.ts` 的 `lastUserPromptOfEvents` + `sessionQueryFace`、`CardRuntime.readLastPrompt`、typert 成员、Client face/bridge）与 Client 侧按卡片的 `ComposerDraft`（edit / echo / 无）三层；`tests/session-log.spec.ts` 8 项钉住注入排除、逐字换行与坏行容错。 |
| v1.10 | 2026-09-17 | **操作胶囊收敛（§3.3 加 F3.10）**：卡片动作胶囊去掉「打开」（`canvas.action.open`，键随按钮一并删除）与「建立取材」（`canvas.action.link`），`CardSelectionProps` 的 `onOpen`/`onLink` 与 Client 侧 `openCardArtifact` 随之退役；保留 对话 / 导出 / 从画布移除。能力不丢：产物打开归双击全屏预览，`ArtifactModal` 头部新增「在右栏打开」（`canvas.viewer.openTab`，原已存在的闲置键），超限文件「请在右栏打开」的提示从此有了着落；取材仍走卡片端口与输入框 ⊕ 菜单。 |
| v1.11 | 2026-09-17 | **生成中反馈改版为骨架图闪光（F3.7 重写）**：运行态卡片由「conic 光弧绕边框 + 斜向扫光 + 预览压暗」改为整卡骨架——卡面落 `--dsh-slot` 占位底色，名字行由 `.dsh-canvas-card-name` 自己充任骨架条（文字转透明、条高 9px + 3.5px 上下外边距凑回 16px 行高，动画起落不引起回流，文本留在 DOM 供读屏），预览由 JSX 换成固定四根 `.dsh-canvas-skel`（条数不随产物内容变，免得被读成「内容的一部分」）；闪光是 400% 宽的 gradient（`--dsh-skel-fill`）以 `dsh-canvas-skeleton` 1.6s 匀速走位，名字条与占位条同拍。撤掉 `@property --dsh-flow-angle`、`dsh-canvas-flow`、`dsh-canvas-sheen` 与两个伪元素；`prefers-reduced-motion` 下条子在、闪光停。端到端实测（`/tmp/pptr/skeleton.js`）：running 态 5 条 `dsh-canvas-skeleton` 动画同时在跑，名字条 9px、四根占位条 88/70/82/46%。 |
| v1.24 | 2026-09-18 | **预览弹窗去掉「在右栏打开」（F3.8 修订）**：`ArtifactModal` 头部只剩产物名、形态与关闭 ×，`onOpenTab` prop 与那枚 `chipbtn` 一并删除；`canvas.viewer.tooLarge` 的文案随之改口径（原为「文件过大，无法在此预览；请在右栏打开。」→「文件过大，无法在此预览。」，因为它指的那扇门已经不在这个弹窗里），`canvas.viewer.openTab` 文案键（中英）删除。客户端一路的接线整体撤退：`canvas-view.tsx` 的 `openArtifactTab`（它复刻了宿主的 `dsh-resource://file/absolute/…` 地址语法）与 `CanvasBoardProps.openResource`、`canvas-panels.tsx` 的 `CanvasPanelsDeps.openResource` 与其注入、`index.tsx` 的 `ctx.sidebarRight.openResource(...)`；顺带发现 `CanvasView` 里那份 `actions.openResource` 包装始终被它自己覆盖（注入进来的那份从未被读），故 `CanvasView` 不再需要 `tab.tab.actions`。右栏的产物标签页类型仍照旧注册（`canvas-tab.ts`），按地址由宿主的标签页入口打开不受影响。端到端实测（`.workbuddy/e2e/viewer.js`）：预览头部的按钮集合为 `["×"]`（只剩关闭）、弹窗文本里不再出现「在右栏打开」、预览仍与画布区矩形逐像素相等、Esc 关闭正常、无页面错误。 |
| v1.23 | 2026-09-18 | **双击预览铺满画布（F3.8 修订）**：预览弹窗从「近满屏的居中对话框」改为**整块画布大小**——`.dsh-canvas-scrim.is-viewer` 的 24px 内边距归零，对话框 `width:100%;height:100%;border:none;border-radius:0`，与画布区（`.dsh-canvas-body`）同宽同高、不留边距、不切角；Markdown / 图片 / 视频 / iframe / 表格各形态的阅读区因此拿到画布的全部面积。连带修掉一个既有缺陷：`.dsh-canvas-viewer` 原来只写单类，与通用对话框的 `.dsh-canvas-dialog{width:min(520px,100%)}` 同权重且在文件里更靠后，宽度实际被顶成 520px——选择器改双类 `.dsh-canvas-dialog.dsh-canvas-viewer` 压过它。Esc 关闭、「在右栏打开」、scrim 点空白关闭路径不变。端到端实测（`.workbuddy/e2e/viewer.js`）：预览框与画布区矩形**逐像素相等**（1600×1000 视口下同为 1320×1000 @ (280,0)）、scrim padding 0px、圆角与边框 0px、Markdown 正文渲染正常、Esc 关闭后回到画布；无页面错误。**再次踩中 styles.ts 模板字符串的反引号坑**（CSS 注释里写了反引号包裹的选择器，esbuild 报 Expected ";"）——注释里禁用反引号，这条已在样式文件注脚里留了字据。 |
| v1.22 | 2026-09-18 | **左下角「适应画布」换成「自动排版」（F1.7 修订 + F4.6）**：zoombar 的第四枚按钮从「缩放到装下」改为「把画布交给 host 重排」——点击即调 `canvas/arrange` 的 **`organize`** 策略（与 agent 工具 `canvas_arrange_on_board` 同一条通道、同一份 `arrangeSeats` 算法，不经过模型）：链上的卡按取材深度成列、散卡在链下方网格收拢。排完**立刻按 host 返回的新卡位取景**（不等状态回灌，避免先按旧位取一次景再跳一下），取景**只缩不放**——装不下才缩小、装得下停在 100%（把三张卡放大到 146% 只是让卡片显得突兀，「看全」在 100% 已经成立），取景与键盘平移同一份视口、同样举起 `viewDirty` 落盘。空画布上按钮禁用（`chipbtn` 的既有 disabled 样式）。`fitBoard` 改为可传入卡位来源（默认仍是当前卡位），`canvas.zoom.reset` 键退役、新增 `canvas.board.arrange`（`canvas.action.arrange` 已被工具卡片的标题占用，不能撞名）。端到端实测（`.workbuddy/e2e/arrange.js`，播种链 mat-a→mat-b + 三张散卡、位置故意错乱）：按钮文案「自动排版」且非空可用；排版后 mat-a 落原点 (48,170)、mat-b 右移一列 (336,170)、三张散卡全在链下方两列网格（行距 228）；与 host `canvas/arrange` 复排结果**逐位一致**；排完 zoom=1、五张卡全落进可视区、视口落盘 zoom 1.000 与页面一致；清空后按钮 disabled=true；无页面错误。首轮脚本三处误报（画布残留卡把网格断言带偏 / 屏幕坐标漏加 surface 偏移 / reload 后未重开画布）均已修正——**教训：E2E 播种前先把画布既有卡片清掉**。 |
| v1.21 | 2026-09-18 | **流光在「减少动态效果」下不再熄灭（F3.7 修订）+ 去掉运行态黄边框与状态点（F3.5 修订、F3.11）**：①实测根因——用户的系统开着 `prefers-reduced-motion`，而 v1.19 的样式在 reduce 下写的是 `.dsh-canvas-shimmer::after{animation:none;transform:skewX(-25deg) translateX(0)}`，光带被钉在卡片正中，整张卡看上去毫无反馈、与「卡住」无从区分。探测脚本（`.workbuddy/e2e/probe-shimmer.js`）在两种媒体状态下各采样 `::after` 的 `animationName` 与连续两次 `transform`：reduce 下是 `none` 且两次 transform 逐字相同（moving=false）；no-preference 下是 `dsh-canvas-shimmer` 1.8s 且 -237.6 → -127.6（moving=true）——根因在样式，不在组件。修法：reduce 分支改为**降速减淡而不是停摆**（`animation-duration:3.6s;opacity:.6`），动画名与 keyframes 不动。②`.dsh-canvas-card.is-working` 去掉 `border-color:rgba(255,122,23,.4)`——运行态只微亮卡面（`--dsh-slot`），边框归悬停与选中，不再随运行变黄。③去掉卡片上的状态点：`card-tile.tsx` 删 `<span class="dsh-canvas-dot">` 与 `STATE_KEY` 常量，控制带里的那枚连 `state` prop 一并退役（`CardSelectionProps.state`、`card-overlay` 的 `CardState` 导入、`canvas-view` 的 `state={statusOf(selectionCard)}` 传参），`canvas.status.*` 四个文案键（中英）删除；`.dsh-canvas-dot` 的样式与 `dsh-canvas-pulse` 关键帧**保留**——左侧的实时卡片（`tool-view.tsx`）仍用它说工具调用成败，其脉动在 reduce 下照旧停。端到端实测（`.workbuddy/e2e/shimmer-fix.js`，**以 reduce 开局**、真发一条消息跑完整回合）：静止态与运行态的画布卡片状态点数均为 0、控制带状态点 0；运行中边框 `rgb(54,58,63)`（selected 灰，不再是 `rgba(255,122,23,.4)`）；reduce 下 `animation=dsh-canvas-shimmer`、`duration=3.6s`、`opacity=.6` 且连续两次 transform 变化（moving=true）；同一张卡切到 no-preference 后 duration 回到 1.8s、opacity 1 且仍在跑；回合结束流光层消失、卡面回显新产物、磁盘同步；无页面错误。 |
| v1.20 | 2026-09-18 | **输入框回归 + 取材 chip 挂删除钮（F3.11 重写 + 新增 F4.9）**：①控制带里**提示词输入框回来了**——`card-overlay.tsx` 重新渲染 textarea 与发送钮（⌘/Ctrl+Enter 发送、空稿禁用），沿用 F3.9 的 `ComposerDraft` 草稿机（edit/echo 两态与回填逻辑上一版只是没了消费者，原样保留）；⤢ 弹窗降为**同一份草稿的全屏编辑器**，一盒两尺寸而不是两盒。②取材 chips **加大一号**（高 22→26px、字 11→12px、宽 130→170px）并在**右上角挂删除钮**（`.dsh-canvas-chipdrop`，16px 圆钮压出上缘）：一条 chip 就是一条取材边，点击经 `canvas/unlink_source`（该通道此前无任何入口）删除这条关系；chips 改由画布的**直接边**驱动（`MaterialRef`），`read_sources` 的间接上游不再进 chips——它们是更上面卡片的关系、删无可删；截断从 chip 自身的 `overflow:hidden` 移到内部 `.dsh-canvas-chip-label`，否则角标会被裁掉。③连带修掉 ⊕ 引入的一个既有缺陷：「已声明」判断原拿摘要表（`read_sources` 含间接上游）作数，选一张间接上游会被误判成已有边、**静默不建线**——改按画布的直接边判（`linkSource` 本就幂等，判错只是白白不发请求）。端到端实测（`.workbuddy/e2e/composer.js`，真发一条消息跑完整回合）：条内 textarea=1、占位符/发送/模型/⤢ 俱在、空稿禁发；chip 77×26、font 12px、删除钮 16×16 且压在 chip 右上角；chips 只列直接边（间接上游 A 不在）；打字后值逐字一致且画布未被 WASD 平移；条内发送后该卡进入 running；点删除钮后存储里 B→C 消失、A→B 未受牵连、chips 1→0；⊕ 选间接上游 A 后直接边 A→C 真的建立；无页面错误。**勘误**：v1.18 的「解除取材走 agent 工具 `canvas_unlink_source`」不成立——该工具从未注册（`TOOL_NAMES` 13 项里没有），RPC 通道 `canvas/unlink_source` 一直在、缺的只是入口；v1.20 的 chip 删除钮补上了它。 |
| v1.19 | 2026-09-18 | **流光反馈与控制带（F3.7 重写 + 新增 F3.11，F3.9 改挂弹窗）**：①卡片监听会话状态（`useSessions`，唯一真源），用户发出消息、回合进入 running 即亮起**流光**——`skewX(-25deg)` 的光带从 -120% 扫到 +120%，1.8s 匀速往复；画在独立子层 `.dsh-canvas-shimmer` 上（卡片不能 `overflow:hidden`，端口悬在卡外），名字与预览照常显示。回合结束流光即停，画布按会话域变动重读产物摘要，**卡面回显最新产物**（端到端实测：预览 旧产物→流光验证完成，磁盘同步）。`prefers-reduced-motion` 下光带停在正中作静态提亮。骨架条的 `.dsh-canvas-skel`、`--dsh-skel*` 变量与 `dsh-canvas-skeleton` 关键帧全部退役。②选中卡片下方**去掉提示词输入框**与「还没有消息。」状态文字（`canvas.panel.none` 键删除），只留取材 chips + ⊕、⤢、模型席位、状态点；发送入口收敛为 ⤢ 全屏弹窗（草稿与回填逻辑原样保留）与「对话」胶囊。连带清理：`cardSession` 键控会话钩子与 `latestLine` 的读侧只剩无人使用，`CanvasInject.keyedHooks`、`SessionFeed`、`canvas.action` 外的整套接线（index/canvas-tab/canvas-panels）一并退役；`removal` 状态上一版已收敛，这次顺带删掉无消费者的 `.dsh-canvas-sendbtn` 与 `.dsh-canvas-overlay-line` 样式。端到端实测（`.workbuddy/e2e/shimmer.js`，真发一条消息跑完整回合）：控制带 textarea=0、无「还没有消息」、模型与 ⤢ 在；发送后 ≤0.3s 内 state=running、`dsh-canvas-shimmer` 1.8s linear 在跑；结束后流光层为 0、state=notified、预览回显新产物；无页面错误。注意测试卡要先选中**目标卡**（v1 的脚本选中了画布上第一张卡，读到的是别的卡的 missing 态）。 |
| v1.18 | 2026-09-18 | **取材线收敛为一副样子（§3.4 F4.4 重写）**：两个节点之间的连线改成与**拖拽中**完全同款——1px 细线、实线、无箭头、breeze 色，虚线与箭头一并退场；选中卡片时只把不透明度从 .85 提到 1（`is-active`），线型不变。**去掉点线的交互**：`onPick` 与 16px 命中带 `.dsh-canvas-edge-hit` 删除，线层本就 `pointer-events:none`，线只负责看、永不拦截跨越它的拖拽；解除取材走 agent 工具 `canvas_unlink_source`，画布上不再有点线入口（客户端 `removal` 状态随之收敛为仅卡片一种）。`is-pending` 类保留在拖拽线上但不挂样式，只作工具标记。端到端实测：两条落定线 computed style 与拖拽线逐项相同（width 1px / dash none / opacity .85 / marker null），线中点 `elementsFromPoint` 命中的是画布表面而非连线层，点线后边数与顶栏均无变化。 |
| v1.17 | 2026-09-18 | **修复拖线闪动**：取消一次拖拽后再次从锚点按下（未动鼠标）时，pending 线先按**上次的终点**画一帧再跳回锚点——`pointer` 状态跨拖拽复用，`onConnectStart` 只重置了「从哪连」没重置「连到哪」。修法：签名扩为 `(cardId, side, at)`，按下即把指针钉到本次锚点（`clientToCanvas` 抽出，与 `setLinkFrom` 同帧批处理）。回归实测：按下不动时 pending 终点-起点仅差控制点圆整的 2px，移动后照常跟随。 |
| v1.16 | 2026-09-18 | **锚点拖线交互改版（§3.4 F4.2 重写 + 新增 F4.8）**：①拖拽中的线改从**锚点（端口圆心，卡片边框外 20px——与 styles.ts 的端口悬出距离是一对）**起笔、终点就是指针本身，样式**细线、无箭头**（`.dsh-canvas-edge.is-pending`：1px 实线）——它还不是一条关系，只是一个没落地的动作；「拉一根细线」与「有一条取材」由此一眼可辨。②放到**空白处**不再直接作废：就地弹出「新增节点」弹窗（与 dock 同一份 DOCK_SPECS），点一种形态即建卡 + 连线——`seatAtAnchor` 按放手点反推卡位，让新卡片的端口正好接住线头，落成后连线两端回到卡片边框锚点（F4.4 的虚线 + 箭头）；弹窗钉在画布坐标上随画布平移、外层 `scale(1/z)` 抵消取景缩放，并按放手时屏上空间向更大的一侧张开。③取消路径：点弹层以外任何地方（捕获阶段收，卡片与端口的 `stopPropagation` 挡不住它）、Esc、手松在画布之外，都不留卡片也不留线；弹窗开着时细线钉在放手点上，让人看见这一笔将连到哪里。④**同场修掉一个既有缺陷**：`sourceIdOf` 产 `a<-b` 直作 per-record 存储键，被介质的路径安全校验（`^[a-zA-Z0-9_-]+$`）整笔拒绝——**手动取材从未落过盘**；卡片表早有 `encodeSegment` 定宽转义，收编进 `core/ids.ts` 后取材键改用同一套（`a__b`），记录体仍带明文两端、键不需要反解。`tests/source-edges.spec.ts` 13 项钉住锚点几何、落位反推、细线路径与键安全。端到端实测（`/tmp/pptr/drop.js`）：pending 起点=锚点 (1396,175)、终点=指针、1px 无箭头；放手弹层 3 行 + 提示、贴近右缘自动左翻；点「图片」后新卡座位与期望逐位一致 (1131,248)、边数 2→3 且新边从卡片锚点 (1376,175) 出发；再拖点空白后卡片数与边数纹丝不动；从 in 锚点拖出落卡在左、边方向新卡→本卡；落盘文件 `untitled-3_002epng__untitled-2_002emd.json` 等均为路径安全键。 |
| v1.15 | 2026-09-18 | **dock 与快捷键弹层打磨（F1.7 修订）**：① dock 的**新增按钮移到最左**，从幽灵钮改为**实心圆 + 画布强调色**（sunset，与卡片上 `data-primary` 胶囊同源；26px，hover 提亮、active 压暗），快捷键按钮退回幽灵钮居右——dock 由此有了一枚明确的主入口；② 快捷键 Popover 改**一个键一行**：原 W A S D 挤一行「上 / 左 / 下 / 右」、Q E 挤一行，读的时候要在脑子里拆开，现在 10 行各配一句自己的话（Space 行的「拖动」从键帽挪进说明句），键帽列钉 86px 下限让右列对齐（英文长键名宁可独行不齐也不截字）。实现：`SHORTCUT_SHEET` 一行一枚键帽（新键 canvas.keys.up/left/down/right/zoomOut/zoomIn，退 canvas.keys.move/zoom 与 canvas.key.drag），测试加「无一行并排两枚键帽」与「行文案互异（React key）」两条。中途走错过一次：先改到了侧栏画布区的 header（已还原——标题在左、幽灵新建钮在右不变）。 |
| v1.14 | 2026-09-18 | **画布交互改版（§3.1 加 F1.7）**：指针默认是**选择箭头**——此前表面 cursor:grab、空白一按即开始平移，与「点空白取消选择」两个语义挤在一次按压里；现在空白一按只取消选择，平移改按住**空格**拖动，且在捕获阶段拦下按压（卡片自己的拖动收不到它），于是「空格 + 拖」在卡片上方也成立。键盘：W A S D 上左下右、Q / E 缩放（`src/client/shortcuts.ts` 的 `shortcutOf`，PAN_STEP 72px、ZOOM_STEP 1.12，按键重复照收）；监听挂 window，因此要自己守门——`isTypingTarget` 排除一切吃文字的控件、修饰键组合不碰、同屏多块画布（右栏标签页 + 主面板）由模块级名册 + lastTouched 判归属。键盘没有抬手可提交，视口改为**停顿落盘**（400ms 计时重置）；缩放按钮同路。dock 在「新增」旁加键盘按钮，点开快捷键 Popover——表体 `SHORTCUT_SHEET` 与分派共用同一份声明，印出来的一定按得动。实测：空白拖不动、空格拖平移 120/70 且松开复位、卡片上空格拖卡片画布坐标不动、W/D 精确 ±72、E/Q 倍率精确 1.12/回退、输入框打 wasd 视口不动而文字进框、弹层 6 行齐备且 Esc/点空白关闭、刷新后视口保持 111%。 |
| v1.13 | 2026-09-18 | **左栏画布区改版为包裹（§3.1 F1.5 重写）**：`sidebar.panellist` 是宿主渲染的**按钮列表**，行里放不下第二枚按钮、更放不下列表子树，画布一多就是按钮墙。改法：只注册**一行**（画布区自己，id `dsh-canvas:canvas:new`，其 `main` 同名面板就是新建流程），由 `src/client/canvas-nav.tsx` 的席位组件把包裹经 `createPortal` 挂进宿主的面板列表——容器定位不靠类名（打包哈希），从自己那枚图形的钩子类 `dsh-canvas-nav-anchor` 上溯最近的 `<nav>`，挂 MutationObserver 在容器重建时重新定位。展开：header（标题 + 右侧加号新建按钮）+ 画布列表（选中态读宿主全局标准席位 `usePanelInfo` 的 `activePanelId`）；收起：宿主 `data-sidebar-collapsed` 一发布，包裹 `display:none`、宿主那一行还回来——图标即新建入口（styles.ts 仅有的两条全局选择器）。画布列表数据源抽为 `src/client/project-catalog.ts`（快照 + 订阅，喂 `useSyncExternalStore`）。端到端实测：展开态 header/加号/三行画布齐备且宿主行隐藏；点画布行主区域切换且行高亮；收起态包裹隐藏、图标可点。实现当日补一刀：实测发现点 header 标题也会触发新建——席位组件渲染在宿主新建行的按钮里，React Portal 的合成事件沿 **React 树**（而非 DOM）冒泡，点包裹任何处都被宿主行当成点了自己。包裹根部 `stopPropagation`（click 与 dblclick）拦掉；最终行为：header 区域不新增、加号才新增、收起态 rail 图标新增，包裹内按钮自身 onClick 不受影响；`tests/project-catalog.spec.ts` 7 项。 |
| v1.12 | 2026-09-17 | **画布即工作区（§3.1 加 F1.6）**：画布本是文件夹，卡片会话也以画布根为 cwd，但宿主侧栏按**工作区账目 + 会话头 cwd 双重匹配**分组（`@deepseek-ai/dsh-workspace`），只缺账目这一半，于是所有卡片会话都落在「未分组」。修法：新增 `src/core/workspace.ts` 承载 `claimCanvasWorkspace`——①`createProject` 时以 `workspaceRegistry.create(root, 画布名)` 登记工作区（幂等，手动加过的同名目录不改名），并把已绑会话一并 `attachSession`（重开旧画布即从「未分组」搬回）；②`card/openSession` 建会话/复用会话后即挂账（进程内按 `路径\u0000会话` 记忆，重开卡片免费）。全链路尽力而为：`ctx.workspaceRegistry` 不在 inject 列表（裸 harness 无名册）→ 整体空操作；注册/挂账失败（cwd 规范化不等等）只记日志不上抛。`tests/workspace.spec.ts` 7 项钉住登记参数、跳过空绑定、进程内幂等与两级静默降级。端到端实测：对既有 E2E 画布重跑 `canvas/createProject` → `storages/workspace.json` 出现 `提示词回填 E2E` 行并立即收编旧会话；`card/openSession` 新会话即时入账；侧栏截图确认对话在画布名下、「未分组」清空。 |

**文档结束。**

如需进一步展开某个模块的详细设计（形态注册表的完整 TypeScript 接口、会话管理器的状态机、取材注入的上下文预算策略、契约层完整 descriptor 表），可以继续讨论。
