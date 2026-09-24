/**
 * dsh-canvas — 设计预览引擎的共享类型（零依赖，浏览器/宿主两侧都可见）。
 *
 * 设计预览的渲染引擎整体打进独立 ESM chunk（`lib/assets/design-engine.js`，
 * build.mjs 第三步）：场景图 + OpenPencil 渲染器 + yoga 布局都住那边，
 * client.js 只经动态 `import()` 取这里声明的能力面。类型放独立模块，
 * 双方 `import type` 引用—— erased，不把 scene-graph 拖进任何一侧。
 */

/** The UMD `canvaskit.js` runtime's slice the engine touches. */
export interface CanvasKitRuntime {
  MakeWebGLCanvasSurface?: (element: HTMLCanvasElement) => SurfaceLike | null
  MakeCanvasSurface?: (element: HTMLCanvasElement) => SurfaceLike | null
}

export interface SurfaceLike {
  getCanvas(): unknown
  flush(): void
  delete(): void
  width(): number
  height(): number
}

/** The viewer's pan/zoom camera: screen = world·scale + offset. */
export interface DesignViewport {
  x: number
  y: number
  scale: number
}

/** One rendering backend (the Skia engine implements it; 2D lives inline). */
export interface DesignBackend {
  /** Paint one frame at CSS size `width×height` (device pixels from `dpr`). */
  paint(
    viewport: DesignViewport,
    width: number,
    height: number,
    dpr: number,
    selectedIds: ReadonlySet<string>,
    sceneVersion: number,
    currentPageId: string,
    hoveredId: string | null,
  ): void
  /** Release engine resources (GL contexts, fonts, caches). */
  dispose(): void
}

/** What the viewer drives the engine with: one paint, one fit, one release. */
export interface DesignEngine {
  /** Paint one frame at CSS size `width×height` (device pixels derived from `dpr`). */
  render(viewport: DesignViewport, width: number, height: number, dpr: number): void
  /** The zoom-to-fit camera for a viewport of the given CSS size. */
  fit(width: number, height: number): DesignViewport
  /** Release engine resources (GL contexts, fonts, caches). */
  dispose(): void

  // —— 编辑闭环（P4）。所有坐标都是**世界坐标**（屏幕 = 世界·scale + 视口偏移，
  //    屏→世界由引擎换算），改稿全部走 headless editor：选中/undo/布局都长在那边。
  /** 命中测试：屏幕点 → 最上层节点 id（没打中返回 null）。 */
  pick(sx: number, sy: number, viewport: DesignViewport): string | null
  /** 悬停高亮（编辑模式指针跟随）：null = 清除。id 变化才重画。 */
  hover(id: string | null): void
  /** 当前选中的节点 id。 */
  selection(): string[]
  /** 设置选中；`additive` = shift 多选切换。 */
  select(ids: readonly string[], additive: boolean): void
  /** 一个节点当前的可见属性（属性条的数据源）。 */
  nodeProps(id: string): DesignNodeRead | null
  /** 开始拖移：对当前选中拍位置快照（拖移中的每次 {@link nudgeSelection} 都直接落图）。 */
  beginMove(): void
  /** 拖移中：把选中整体平移 `dx`/`dy` 世界单位（相对拖移起点，可负）。 */
  nudgeSelection(dx: number, dy: number): void
  /** 结束拖移：提交一条 Move undo。 */
  endMove(): void
  /** 改一个节点的属性（css 颜色等），返回是否真的变了。每项都进 undo。 */
  updateProps(id: string, props: DesignNodeProps): boolean
  /** 删除当前选中（带 undo）。 */
  deleteSelection(): void
  undo(): void
  redo(): void
  /** 面板数据快照：页面列表、当前页图层树、选中。每次渲染时现取，图小不贵。 */
  snapshot(): DesignSnapshot
  /** 切换当前页（异步：core 会做字体/layout 准备），完成后引擎自会请求重画。 */
  setPage(pageId: string): void
  /** 新建页面并切过去。 */
  addPage(): void
  /** 重命名页面。 */
  renamePage(pageId: string, name: string): void
  /** 删除页面（最后一页拒删；删当前页 core 会自动切到相邻页）。 */
  deletePage(pageId: string): void
  /** 把当前图序列化回 `.design` 信封文本（写盘用）。 */
  serialize(): string
  /** 图变了（undo/redo/命令提交）→ 该写盘了。注册返回解绑函数。 */
  onDirty(cb: () => void): () => void
}

/**
 * 描边作用边（属性面板「边框」一格）：ALL = 四边统一描边；其余为单边描边——
 * 场景图把单边宽度存在节点级（independentStrokeWeights + borderXxxWeight），
 * 面板按「每格一条边」的语义读写（见引擎的换算）。
 */
export type DesignStrokeSide = 'ALL' | 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT'

/**
 * 边框一格的读写面：css 颜色 + 场景图 Stroke 的语义子集（虚线折叠成布尔，
 * 作用边独立成字段）。整组数组提交时整体替换节点 strokes。
 */
export interface DesignStrokeItem {
  color: string
  weight: number
  align: 'INSIDE' | 'CENTER' | 'OUTSIDE'
  dashed: boolean
  side: DesignStrokeSide
}

/**
 * 效果一格的读写面（阴影/模糊）。模糊用 radius，忽略 x/y/spread；
 * 面板按 type 分桶展示（阴影/内阴影/模糊），提交时合并回一个数组。
 */
export interface DesignEffectItem {
  type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR'
  color: string
  x: number
  y: number
  radius: number
  spread: number
}

/** 属性面板可编辑项：几何/外观/文本/边框/效果，外加图层管理字段（名称/显隐/锁定）。 */
export interface DesignNodeProps {
  name?: string
  visible?: boolean
  locked?: boolean
  x?: number
  y?: number
  width?: number
  height?: number
  fill?: string
  opacity?: number
  /** 统一圆角：写入时联动四角并关掉 independentCorners（与 ops.setProps 同语义）。 */
  cornerRadius?: number
  /** 四角独立圆角；写任一角都会把 independentCorners 打开。 */
  topLeftRadius?: number
  topRightRadius?: number
  bottomRightRadius?: number
  bottomLeftRadius?: number
  independentCorners?: boolean
  /** frame 裁切溢出内容的开关（Figma 语义）。 */
  clipsContent?: boolean
  /** 边框数组：整组替换（含作用边 → 节点级独立边宽的换算）。 */
  strokes?: DesignStrokeItem[]
  /** 效果数组：整组替换（面板负责分桶合并）。 */
  effects?: DesignEffectItem[]
  text?: string
  fontSize?: number
}

/** {@link DesignEngine.nodeProps} 的读面（全部必填，调用方按 type 取用）。 */
export interface DesignNodeRead {
  id: string
  type: string
  name: string
  visible: boolean
  locked: boolean
  x: number
  y: number
  width: number
  height: number
  fill: string | null
  opacity: number
  cornerRadius: number
  topLeftRadius: number
  topRightRadius: number
  bottomRightRadius: number
  bottomLeftRadius: number
  independentCorners: boolean
  clipsContent: boolean
  strokes: DesignStrokeItem[]
  effects: DesignEffectItem[]
  text: string
  fontSize: number
}

/** 页面列表项（页面面板）。 */
export interface DesignPageInfo {
  id: string
  name: string
}

/** 图层树节点（图层面板）：递归 children，展开状态由面板自持。 */
export interface DesignLayerNode {
  id: string
  name: string
  type: string
  visible: boolean
  locked: boolean
  children: DesignLayerNode[]
}

/** {@link DesignEngine.snapshot} 的返回：面板一次渲染要用的全部图状态。 */
export interface DesignSnapshot {
  pages: DesignPageInfo[]
  currentPageId: string
  /** 当前页的子节点树（不是整棵文档树——跨页树没有意义）。 */
  layers: DesignLayerNode[]
  selection: string[]
}

/** Engine creation outcome: an honest error line, or a live engine. */
export type EngineOutcome = { kind: 'error'; message: string } | { kind: 'ready'; engine: DesignEngine }

export interface CreateDesignEngineArgs {
  /** The 2D-fallback canvas (also the pre-Skia picture while fonts settle). */
  twoD: HTMLCanvasElement
  /** The GL canvas for the Skia engine; stays invisible until it paints. */
  gl: HTMLCanvasElement
  /** The loaded CanvasKit runtime, or `null` when the WASM assets failed. */
  runtime: CanvasKitRuntime | null
  /** The raw `.design` envelope text (header line + JSON snapshot). */
  envelope: string
  /** Called when async work (font settling) needs one more frame. */
  onRepaint: () => void
}
