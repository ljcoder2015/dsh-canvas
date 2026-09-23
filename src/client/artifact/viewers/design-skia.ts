/**
 * dsh-canvas — 设计预览的 Skia 后端（F2.6，P3 保真路径）。
 *
 * 渲染引擎是 `@open-pencil/core` 的 `SkiaRenderer`（CanvasKit on WebGL2，
 * CPU raster 兜底）——OpenPencil 换底座后，命中/文本/图形保真都长在它身上，
 * 预览直接复用，不再自维护一套 painter。2D canvas 后端（`design-render.ts`）
 * 仍是降级路径：本模块任何一步失败都返回 `null`，viewer 原地用 2D 画。
 *
 * 字体：core 的 bundled 字体走根路径 `/Inter-Regular.ttf`，宿主路由下必然
 * 404；这里改从插件资产路由预载并通过 `fontManager.markLoaded` 注入。
 * 中文等缺字回落 fontResolver 的在线 provider，settled 后经回调重画。
 *
 * 本文件与加载器（`design-canvaskit.ts`）一样「optional by construction」：
 * 不 throw，失败即降级。
 */
import { SkiaRenderer } from '@open-pencil/core/canvas'
import { fontManager } from '@open-pencil/core/text'
import type { CanvasKit, Surface } from 'canvaskit-wasm'
import type { SceneGraph } from '@open-pencil/scene-graph'
import { ASSET_BASE } from './design-canvaskit.ts'
import { type CanvasKitRuntime, type DesignBackend } from './design-engine-types.ts'

/** The page backdrop behind the artboards — matches `.dsh-canvas-design` CSS. */
const CANVAS_COLOR = { r: 233 / 255, g: 235 / 255, b: 239 / 255, a: 1 }

let fontsPreloaded: Promise<void> | undefined

/**
 * Inject the bundled Inter faces from the plugin's asset route into core's
 * font manager, once per page. Best effort: a 404 (assets not shipped) just
 * leaves the resolver's remote path as the second chance.
 *
 * CJK（中文回落）：core 的 bundled 字体没有中文字形，它自己的 CJK 回落
 * 走 Google Fonts——宿主环境不可达，中文会渲染成空白。这里注册仓库
 * vendored 的 Noto Sans SC（build.mjs 拷进资产路由），并用
 * `setCJKFallbackFamily` 把它声明进段落排版的回落链——该链路是每次排版
 * 实时读取的，注册后中文完全本地解决，不触发任何远程请求。
 */
function preloadBundledFonts(): Promise<void> {
  fontsPreloaded ??= Promise.all(
    (
      [
        ['Inter', 'Regular', 'Inter-Regular.ttf'],
        ['Inter', 'Medium', 'Inter-Medium.ttf'],
        ['Inter', 'SemiBold', 'Inter-SemiBold.ttf'],
        ['Inter', 'Bold', 'Inter-Bold.ttf'],
        ['Noto Sans SC', 'Regular', 'NotoSansSC-Regular.ttf'],
      ] as const
    ).map(async ([family, style, file]) => {
      try {
        const response = await fetch(`${ASSET_BASE}/${file}`)
        if (!response.ok) return
        fontManager.markLoaded(family, style, await response.arrayBuffer())
        if (family === 'Noto Sans SC') fontManager.setCJKFallbackFamily(family)
      } catch {
        // Offline or route missing — the font resolver's remote path is next.
      }
    }),
  ).then(() => undefined)
  return fontsPreloaded
}

/**
 * Build the Skia backend for one canvas element. Resolves `null` when the
 * engine cannot take the element (no WebGL2 *and* no CPU surface) — the
 * viewer keeps its 2D picture in that case.
 *
 * `onRepaint` fires when async font work settles (fallback fonts arriving),
 * so late-arriving glyphs trigger one extra frame instead of staying blank.
 */
export async function createSkiaBackend(
  canvas: HTMLCanvasElement,
  runtime: CanvasKitRuntime,
  graph: SceneGraph,
  onRepaint: () => void,
): Promise<DesignBackend | null> {
  await preloadBundledFonts()
  const ck = runtime as unknown as CanvasKit
  const webgl = runtime.MakeWebGLCanvasSurface?.(canvas) ?? null
  const surface = (webgl ?? runtime.MakeCanvasSurface?.(canvas) ?? null) as unknown as Surface | null
  if (surface === null) return null
  const gl = webgl !== null ? (canvas.getContext('webgl2') as WebGL2RenderingContext | null) : null

  const renderer = new SkiaRenderer(ck, surface, gl)
  renderer.showRulers = false
  renderer.pageColor = CANVAS_COLOR
  renderer.pageId = graph.getPages()[0]?.id ?? ''
  let disposed = false

  try {
    await renderer.loadFonts(onRepaint)
  } catch {
    // Fonts failed: shapes still draw; text falls to the resolver's remote path.
  }
  if (disposed) {
    renderer.destroy()
    return null
  }

  let activeSurface = surface
  return {
    paint(viewport, width, height, dpr, selectedIds, sceneVersion, currentPageId, hoveredId) {
      if (disposed) return
      const deviceWidth = Math.round(width * dpr)
      const deviceHeight = Math.round(height * dpr)
      // The surface is bound to the element at creation: a resize invalidates
      // it, so rebuild the surface and hand it to the renderer.
      if (activeSurface.width() !== deviceWidth || activeSurface.height() !== deviceHeight) {
        const next = (webgl !== null
          ? runtime.MakeWebGLCanvasSurface?.(canvas)
          : runtime.MakeCanvasSurface?.(canvas)) as unknown as Surface | null
        if (next === null) return
        // `replaceSurface` deletes the outgoing surface itself — deleting it
        // here too throws "Surface instance already deleted" on the next swap.
        activeSurface = next
        renderer.replaceSurface(next)
      }
      renderer.viewportWidth = width
      renderer.viewportHeight = height
      renderer.dpr = dpr
      renderer.panX = viewport.x
      renderer.panY = viewport.y
      renderer.zoom = viewport.scale
      // 渲染器按 pageId 圈定要画的页面——面板切页后每帧同步当前页。
      renderer.pageId = currentPageId
      // 选中框与悬停高亮由渲染器原生画（overlays 每帧叠加，不进场景
      // picture）；sceneVersion 来自 editor 的变更计数——图没变时 picture
      // cache 逐帧重放，变了才重录。
      renderer.render(graph, selectedIds as Set<string>, { hoveredNodeId: hoveredId }, sceneVersion, 'full')
    },
    dispose() {
      if (disposed) return
      disposed = true
      renderer.destroy()
    },
  }
}
