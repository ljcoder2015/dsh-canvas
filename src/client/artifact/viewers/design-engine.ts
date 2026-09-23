/**
 * dsh-canvas — 设计预览引擎入口（独立 ESM chunk，`lib/assets/design-engine.js`）。
 *
 * 这个文件是 build.mjs 的第三步入口：场景图（`@open-pencil/scene-graph`）、
 * OpenPencil 渲染器（`@open-pencil/core/canvas`）、**headless editor**
 * （`@open-pencil/core/editor`，P4 编辑闭环的底座：选中/undo/命中）、yoga 布局、
 * 2D 回退 painter 全部打进一个 ESM chunk，经宿主的资产路由出。client.js 只用
 * 动态 `import()` 取 `createDesignEngine` —— 打成两半是被迫的清醒：
 *
 * 1. client.js 是 CJS（宿主 ModuleLoader 合同），而 yoga-layout 的入口带
 *    顶层 await，CJS 输出装不下；ESM chunk 原生支持。
 * 2. 场景图类身份必须唯一：graph 在引擎 chunk 里创建、也在那里渲染；
 *    client.js 不 import 任何 scene-graph 代码，杜绝双拷贝互不认识。
 *
 * 失败语义：CanvasKit WASM 加载失败 → 2D 后端顶上（同一个引擎对象，内部
 * 换腿）；引擎 chunk 本身加载失败 → viewer 报错（2D painter 也住在里面，
 * 没有更深的降级了）。
 */
import { createEditor } from '@open-pencil/core/editor'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { colorFromCss, colorToCss, decodeDesignFile, encodeDesignFile } from '../../../core/artifact/design/document.ts'
import { canvas2dBackend, fitTransform, paintDocument } from './design-render.ts'
import { createSkiaBackend } from './design-skia.ts'
import type {
  CreateDesignEngineArgs,
  DesignBackend,
  DesignEngine,
  DesignLayerNode,
  DesignNodeProps,
  DesignNodeRead,
  DesignViewport,
  EngineOutcome,
} from './design-engine-types.ts'

/** The engine is the module's whole surface — the viewer imports nothing else. */
export function createDesignEngine(args: CreateDesignEngineArgs): Promise<EngineOutcome> {
  return buildEngine(args).catch((error: unknown) => ({
    kind: 'error',
    message: error instanceof Error ? error.message : '设计预览引擎初始化失败。',
  }))
}

async function buildEngine({ twoD, gl, runtime, envelope, onRepaint }: CreateDesignEngineArgs): Promise<EngineOutcome> {
  let graph: SceneGraph
  try {
    graph = decodeDesignFile(envelope)
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : '设计文档无法解码。' }
  }

  // The headless editor owns selection, undo and the scene-version counter —
  // its graph subscription turns every mutation into a render request, which
  // is exactly the "did the picture go stale" signal the paint loop needs.
  const editor = createEditor({ graph })

  // Fidelity first: the Skia engine takes the GL canvas when the WASM runtime
  // is present. Failure here (no WebGL2, no CPU surface, fonts blow up) is a
  // downgrade, not an error.
  let skia: DesignBackend | null = null
  if (runtime !== null) {
    try {
      skia = await createSkiaBackend(gl, runtime, graph, onRepaint)
    } catch {
      skia = null
    }
    if (skia !== null) gl.style.visibility = 'visible'
  }

  // 切页是异步的（字体/layout 准备），完成后补一帧；addPage/deletePage 内部
  // 也走 switchPage，这一个订阅把页面面板的所有重画都收口了。
  editor.onEditorEvent('page:changed', () => onRepaint())

  const fit = (width: number, height: number): DesignViewport => fitTransform(graph, width, height)

  /** The screen→world step every pointer coordinate takes before a hit test. */
  const toWorld = (sx: number, sy: number, viewport: DesignViewport): { x: number; y: number } => ({
    x: (sx - viewport.x) / viewport.scale,
    y: (sy - viewport.y) / viewport.scale,
  })

  // Move-drag state: positions captured at pointer-down, replayed per frame.
  let moveOriginals: Map<string, { x: number; y: number }> | null = null
  // 悬停高亮：编辑模式指针下的「将被选中」节点。渲染器按帧画 overlay，
  // 不进场景 picture——变更只触发重画，不 bump sceneVersion。
  let hoverId: string | null = null

  const readNode = (id: string): DesignNodeRead | null => {
    const node = graph.getNode(id)
    if (node === undefined) return null
    return {
      id: node.id,
      type: node.type.toLowerCase(),
      name: node.name,
      visible: node.visible,
      locked: node.locked,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      fill: firstSolidCss(node),
      opacity: node.opacity,
      cornerRadius: node.cornerRadius,
      text: node.text,
      fontSize: node.fontSize,
    }
  }

  /** 工具面：两种渲染后端共用同一套编辑语义。 */
  const editing = {
    pick(sx: number, sy: number, viewport: DesignViewport): string | null {
      const world = toWorld(sx, sy, viewport)
      return graph.hitTestDeep(world.x, world.y)?.id ?? null
    },
    hover: (id: string | null): void => {
      if (hoverId === id) return
      hoverId = id
      onRepaint()
    },
    selection: (): string[] => [...editor.state.selectedIds],
    select(ids: readonly string[], additive: boolean): void {
      editor.select([...ids], additive)
    },
    nodeProps: readNode,
    beginMove(): void {
      moveOriginals = new Map()
      for (const id of editor.state.selectedIds) {
        const node = graph.getNode(id)
        if (node !== undefined) moveOriginals.set(id, { x: node.x, y: node.y })
      }
    },
    nudgeSelection(dx: number, dy: number): void {
      if (moveOriginals === null) return
      for (const [id, origin] of moveOriginals) {
        graph.updateNode(id, { x: origin.x + dx, y: origin.y + dy })
      }
    },
    endMove(): void {
      if (moveOriginals === null) return
      // 原地点击（没有真拖动）不压 undo——core 的 commitMove 不做等值检查。
      let moved = false
      for (const [id, origin] of moveOriginals) {
        const node = graph.getNode(id)
        if (node === undefined) continue
        if (node.x !== origin.x || node.y !== origin.y) {
          moved = true
          break
        }
      }
      if (moved) {
        // `commitMove` captures the *current* positions as the forward side and
        // replays the originals as the inverse.
        editor.commitMove(moveOriginals)
      }
      moveOriginals = null
    },
    updateProps(id: string, props: DesignNodeProps): boolean {
      const node = graph.getNode(id)
      if (node === undefined) return false
      const changes: Record<string, unknown> = {}
      const previous: Record<string, unknown> = {}
      // 直接落在节点标量字段上的项（几何/显隐/命名）——同一套「先记旧值、
      // 后提交 undo」的节律。
      for (const key of ['name', 'visible', 'locked', 'x', 'y', 'width', 'height'] as const) {
        const next = props[key]
        if (next === undefined || node[key] === next) continue
        changes[key] = next
        previous[key] = node[key]
      }
      if (props.fill !== undefined) {
        const color = colorFromCss(props.fill)
        if (color !== undefined) {
          changes.fills = [{ type: 'SOLID', visible: true, color }]
          previous.fills = structuredClone(node.fills)
        }
      }
      if (props.opacity !== undefined && node.opacity !== props.opacity) {
        changes.opacity = props.opacity
        previous.opacity = node.opacity
      }
      if (props.cornerRadius !== undefined && node.cornerRadius !== props.cornerRadius) {
        changes.cornerRadius = props.cornerRadius
        previous.cornerRadius = node.cornerRadius
      }
      if (props.text !== undefined && node.text !== props.text) {
        changes.text = props.text
        previous.text = node.text
      }
      if (props.fontSize !== undefined && node.fontSize !== props.fontSize) {
        changes.fontSize = props.fontSize
        previous.fontSize = node.fontSize
      }
      if (Object.keys(changes).length === 0) return false
      graph.updateNode(id, changes)
      // The editor's own commit snapshots the post-write values for the
      // forward side and derives "did anything actually change" itself.
      editor.commitNodeUpdate(id, previous, '编辑属性')
      return true
    },
    deleteSelection(): void {
      if (editor.state.selectedIds.size === 0) return
      editor.deleteSelected()
    },
    undo(): void {
      editor.undoAction()
    },
    redo(): void {
      editor.redoAction()
    },
    snapshot: () => {
      const build = (parentId: string): DesignLayerNode[] =>
        graph.getChildren(parentId).map((node) => ({
          id: node.id,
          name: node.name,
          type: node.type.toLowerCase(),
          visible: node.visible,
          locked: node.locked,
          children: build(node.id),
        }))
      return {
        pages: graph.getPages().map((page) => ({ id: page.id, name: page.name })),
        currentPageId: editor.state.currentPageId,
        layers: build(editor.state.currentPageId),
        selection: [...editor.state.selectedIds],
      }
    },
    // 切页完成由 page:changed 事件统一收口（switchPage 异步：core 在切页前
    // 做字体/layout 准备），addPage/deletePage 内部也走 switchPage。
    setPage: (pageId: string) => {
      void editor.switchPage(pageId)
    },
    addPage: () => {
      editor.addPage()
    },
    renamePage: (pageId: string, name: string) => {
      const page = graph.getNode(pageId)
      if (page === undefined || page.name === name || name === '') return
      graph.updateNode(pageId, { name })
    },
    deletePage: (pageId: string) => {
      editor.deletePage(pageId)
    },
    serialize: (): string => encodeDesignFile(graph),
    onDirty(cb: () => void): () => void {
      // history:changed = 改稿/undo（写盘节律的信号源）；page:changed = 切页
      // 完成（异步 switchPage 的终点，viewer 借它重画并刷新面板）。
      const unbindHistory = editor.onEditorEvent('history:changed', cb)
      const unbindPage = editor.onEditorEvent('page:changed', () => cb())
      return () => {
        unbindHistory()
        unbindPage()
      }
    },
  }

  if (skia !== null) {
    const engine: DesignEngine = {
      render: (viewport, width, height, dpr) =>
        skia?.paint(viewport, width, height, dpr, editor.state.selectedIds, editor.state.sceneVersion, editor.state.currentPageId, hoverId),
      fit,
      dispose: () => {
        gl.style.visibility = 'hidden'
        skia?.dispose()
      },
      ...editing,
    }
    return { kind: 'ready', engine }
  }

  // The 2D path owns its canvas sizing (it re-contexts every frame) and draws
  // the world-aligned dot grid; the Skia path paints its own backdrop instead.
  const engine: DesignEngine = {
    render(viewport, width, height, dpr) {
      if (width === 0 || height === 0) return
      const deviceWidth = Math.round(width * dpr)
      const deviceHeight = Math.round(height * dpr)
      if (twoD.width !== deviceWidth) twoD.width = deviceWidth
      if (twoD.height !== deviceHeight) twoD.height = deviceHeight
      const context = twoD.getContext('2d')
      if (context === null) return
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)
      paintGrid(context, width, height, viewport)
      paintDocument(graph, canvas2dBackend(context), viewport)
      paint2DSelection(context, graph, editor.state.selectedIds, viewport)
      if (hoverId !== null) paint2DHover(context, graph, hoverId, viewport)
    },
    fit,
    dispose() {},
    ...editing,
  }
  return { kind: 'ready', engine }
}

/** The first visible solid fill as a css string, or null (gradient/image/none). */
function firstSolidCss(node: SceneNode): string | null {
  const paint = node.fills.find((entry) => entry.visible !== false && entry.type === 'SOLID')
  return paint === undefined ? null : colorToCss(paint.color)
}

/** 2D 后端的选中高亮：给选中节点描一圈强调色（Skia 路径由渲染器原生画）。 */
function paint2DSelection(
  context: CanvasRenderingContext2D,
  graph: SceneGraph,
  selectedIds: ReadonlySet<string>,
  viewport: DesignViewport,
): void {
  if (selectedIds.size === 0) return
  context.strokeStyle = '#2563eb'
  context.lineWidth = 1.5
  for (const id of selectedIds) {
    const node = graph.getNode(id)
    if (node === undefined) continue
    // 节点坐标相对父级；顶层画板（parent 即根）的 x/y 就是世界坐标。P4 只在
    // 顶层图形上画框——进容器内部的精确世界矩形等 P5 的变换合成一起做。
    if (node.parentId !== graph.rootId && !graph.getPages().some((page) => page.id === node.parentId)) continue
    const x = node.x * viewport.scale + viewport.x
    const y = node.y * viewport.scale + viewport.y
    context.strokeRect(x - 1, y - 1, node.width * viewport.scale + 2, node.height * viewport.scale + 2)
  }
}

/** 2D 后端的悬停高亮：比选中框浅一档的同色描边（实线细框，区别于选中）。 */
function paint2DHover(
  context: CanvasRenderingContext2D,
  graph: SceneGraph,
  id: string,
  viewport: DesignViewport,
): void {
  const node = graph.getNode(id)
  if (node === undefined) return
  if (node.parentId !== graph.rootId && !graph.getPages().some((page) => page.id === node.parentId)) return
  context.strokeStyle = '#93b8f9'
  context.lineWidth = 1
  const x = node.x * viewport.scale + viewport.x
  const y = node.y * viewport.scale + viewport.y
  context.strokeRect(x - 1, y - 1, node.width * viewport.scale + 2, node.height * viewport.scale + 2)
}

/**
 * The 2D fallback's background dot grid, aligned to **world** coordinates: the
 * origin sits at the viewport transform, so panning slides the dots and zooming
 * rescales the spacing — the surface reads as infinite rather than as a static
 * wallpaper. Spacing doubles/halves at the clamps so it stays legible at any
 * zoom. (The Skia path paints its own page color; the grid is a 2D luxury.)
 */
function paintGrid(context: CanvasRenderingContext2D, width: number, height: number, viewport: DesignViewport): void {
  let spacing = 24 * viewport.scale
  while (spacing < 12) spacing *= 2
  while (spacing > 96) spacing /= 2
  context.fillStyle = 'rgba(100, 116, 139, 0.30)'
  const offsetX = ((viewport.x % spacing) + spacing) % spacing
  const offsetY = ((viewport.y % spacing) + spacing) % spacing
  for (let x = offsetX; x < width; x += spacing) {
    for (let y = offsetY; y < height; y += spacing) {
      context.fillRect(x, y, 1, 1)
    }
  }
}
