/**
 * dsh-canvas — 设计稿的四条出路（F10.1，v1.59）。
 *
 * 四样：**Figma 文件**（`.fig`）、**图片**（PNG）、**PDF**、**PPT**。它们全都跑在浏览器里，
 * 也全都由 open-pencil 的 io 层画出来——这一层只负责「翻译」：把一份场景图快照，按用户的
 * 选择交给哪一个导出器、按什么粒度切、以及切不出来时怎么如实说。
 *
 * 三件事值得写在这里，因为它们都不是显而易见的：
 *
 * **一、一律走 `IOContext`，绝不走 headless。** open-pencil 有条「headless」的路
 * （`headlessRenderNodes`），它在 node/bun 里靠 `import.meta.resolve('canvaskit-wasm/full')`
 * 找 wasm——浏览器里 `import.meta.resolve` 根本不存在，一调就炸。所以图片、PPT 的降级栅格
 * 化都必须拿到**我们自己的**渲染器（`createExportRenderer`），走 `context` 递进去。
 *
 * **二、粒度是「一样东西一份」。** 图片一容器一张、PPT 一页面一份幻灯片序列——而 `.fig` 与
 * PDF 是**整份文档一个文件**（PDF 一容器一页，页在文档里面）。这不是美学：open-pencil 的
 * 导出器按**选区**取节点，而选区不许跨页面（跨页它会直接抛）。所以「按容器切」既是产物该有
 * 的样子（海报系列、幻灯片每一页各是一张），也正好落在导出器能接受的形状里；PDF 那些页再
 * 一起写进同一份文档（见 `design-pdf.ts`）。
 *
 * **三、切不动就说，不交半份。** 任何一个可见容器画不出来，整趟就当没导成（`kind: 'error'`，
 * 名字报出来）。悄悄少一张图比导不出来坏得多——这条规矩与 v1.57 的文本导出、v1.58 的应用
 * 打包是同一条。
 *
 * **四、交出去之前要换字体名——PPT、fig、PDF 三条都要。** 三者的理由不同但同源：那个名字
 * 是**我们自己这边的东西**（拉丁 `Inter`、汉字靠 vendored 的 Noto Sans SC 回落），而这三条
 * 交出去的产物会被别人的软件解析——PowerPoint 拿它排原生文本、Figma 拿它取字形轮廓、jsPDF
 * 拿它在自己的字体表里查。只有图片那条不换：字是我们自己画的，那个名字在那边就是「拿去
 * `fontManager` 找字面」用的。理由、选名与「PDF 还要顺手收字重」见
 * `core/artifact/design/export-font.ts`。
 *
 * 这个模块**只住在引擎 chunk 里**（`lib/assets/design-engine.js`）：它 import 的是
 * `@open-pencil/core/io`，而场景图的类身份必须全页唯一（见 `design-engine.ts` 开头的两条
 * 理由）。client.js 那边只看 `design-engine-types.ts` 里声明的形状。
 */
import {
  BUILTIN_IO_FORMATS,
  IORegistry,
  computeContentBounds,
  renderNodesToSVG,
} from '@open-pencil/core/io'
import type { ExportTarget, IOContext } from '@open-pencil/core/io'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { containersOf, decodeDesignFile, pageOf } from '../../../core/artifact/design/document.ts'
import {
  exportTextRetarget,
  pdfTextStyles,
  retargetTextFonts,
} from '../../../core/artifact/design/export-font.ts'
import { createExportRenderer, ensureCJKFont, type ExportRenderer } from './design-skia.ts'
import { renderPdfDocument, type PdfPageSource } from './design-pdf.ts'
import type { DesignExportOutcome, DesignExportRequest, DesignExportUnit } from './design-engine-types.ts'

/**
 * 导出器登记表。
 *
 * 用 open-pencil 自己的那个门面（`IORegistry` + 内置格式表）而不是逐个 import 各家
 * `exportXxx`：`fig` / `svg` / `raster` 三条子路径在包的 exports map 里，而 **pdf 与 pptx
 * 不在**（`renderNodesToPDF`、`renderNodesToPPTX` 都没从 `@open-pencil/core/io` 的顶层露
 * 出来，只有格式表里那两个 adapter 认得它们）。门面是唯一处处露着的那一面，也是这个包
 * 自己给外部用的那一面。
 */
const IO = new IORegistry(BUILTIN_IO_FORMATS)

/** 位图倍率：设计稿是 1× 逻辑像素，2× 是清晰度与体量的平衡点（v1.59 定，用户拍的）。 */
export const DESIGN_EXPORT_SCALE = 2

/** 一次导出：把信封解成图，按格式画出来。被拒是答案，不是异常。 */
export async function exportDesignDocument(request: DesignExportRequest): Promise<DesignExportOutcome> {
  let graph: SceneGraph
  try {
    graph = decodeDesignFile(request.envelope)
  } catch {
    // 三条报错各有各的说法（旧 v1 信封 / JSON 坏 / 快照结构不对），但用户的下一步
    // 只有一件事：让模型重新生成这份设计。所以合成一个理由。
    return { kind: 'refused', reason: 'broken' }
  }

  const containers = containersOf(graph).filter((node) => node.visible)
  if (containers.length === 0) return { kind: 'refused', reason: 'empty' }

  // 交出去之前把字体名换掉（三条路各有各的理由，见 `core/artifact/design/export-font.ts`）。
  // **必须在这一步之前**——fig 那边写器就是按这个字段去取字形轮廓的，晚了就取的是旧名字。
  const retarget = exportTextRetarget(request.format)
  if (retarget !== null) retargetTextFonts(graph, retarget)

  // 渲染器**先起**：fig 用它画缩略图（没有也照导，只是缩略图退成 1×1），图片与 PPT 则
  // 非要它不可。一条路起一次，四种格式共用同一个判断。
  const canvas = await createExportRenderer()
  if (canvas === null && (request.format === 'png' || request.format === 'pptx')) {
    return { kind: 'refused', reason: 'no-engine' }
  }

  try {
    switch (request.format) {
      case 'fig':
        return await figDocument(graph, canvas)
      case 'png':
        return await perContainer(graph, containers, { scale: request.scale ?? DESIGN_EXPORT_SCALE }, canvas)
      case 'pdf':
        return await pdfDocument(graph, containers)
      default:
        return await perPage(graph, containers, canvas)
    }
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
  } finally {
    canvas?.dispose()
  }
}

/** 整份文档 → 一个 `.fig`。 */
async function figDocument(graph: SceneGraph, canvas: ExportRenderer | null): Promise<DesignExportOutcome> {
  const result = await IO.writeDocument(
    'fig',
    graph,
    {
      // 有渲染器就画一张真的缩略图（Figma 的文件列表上就是它），没有就让 open-pencil 放
      // 它自己那张 1×1 的占位图——这不是失败，是「这台机器上没取到 CanvasKit」。
      renderThumbnail: canvas !== null,
      // **页必须点名**：`writeDocument` 那条路（整份文档，没有选区可提取）不会替我们猜是
      // 哪一页，而 fig 写器在拿不到页 id 时**直接交那张 1×1 的占位图**——于是「导出成功」
      // 而 Figma 里的缩略图是一片空白，两处都不报错。上游的兜底只认一个叫 `cover` 的页
      // （Figma 的封面页约定），我们的文档没有这个约定，于是取第一页：一份设计文档里，
      // 它就是整体的那一眼。
      thumbnailPageId: graph.getPages()[0]?.id,
    },
    contextOf(canvas),
  )
  return { kind: 'done', units: [{ name: '', bytes: bytesOf(result.data) }] }
}

/** 图片的粒度：一张一个容器。 */
async function perContainer(
  graph: SceneGraph,
  containers: readonly SceneNode[],
  options: Record<string, unknown>,
  canvas: ExportRenderer | null,
): Promise<DesignExportOutcome> {
  const units: DesignExportUnit[] = []
  for (const container of containers) {
    const data = await draw(graph, 'png', nodeTarget(container.id), options, canvas)
    if (data === undefined) throw new Error(`容器「${container.name}」画不出来，这一趟先不导出了。`)
    units.push({ name: container.name, bytes: data })
  }
  return { kind: 'done', units }
}

/**
 * PDF 的粒度：**一容器一页，全在一份文档里**。
 *
 * 与图片那条分开写，是因为这一条根本没走 `IORegistry`——上游那个 `renderNodesToPDF` 不在包
 * 的 exports map 里，而它内部那句 `new jsPDF(...)` 又够不着（字体必须注册在正要写的那一份
 * 文档上），于是我们自己建（`design-pdf.ts`）。好在零件都露着：矢量图是
 * `renderNodesToSVG`、量尺是 `computeContentBounds`。
 *
 * 一份文档而不是一页一份再拼：少一次 18MB 字面的解析，产物里也少几份重复的字体子集。
 * 于是这一条交回**一件**字节——客户端那边按「一件就是一件」直接给他，不必合并。
 */
async function pdfDocument(
  graph: SceneGraph,
  containers: readonly SceneNode[],
): Promise<DesignExportOutcome> {
  const pages: PdfPageSource[] = []
  for (const container of containers) {
    // SVG 里根元素就写着 width/height/viewBox（上游照选区算好的），页面按这个尺寸建。
    const svg = renderNodesToSVG(graph, pageOf(graph, container.id) ?? '', [container.id], {
      xmlDeclaration: false,
    })
    const bounds = computeContentBounds(graph, [container.id])
    // 量不到内容就是 0×0，落到下面那句「画不出来」上——别写成 `=== undefined`（它给的是
    // `null`，那样会直接走进 `bounds.maxX` 而抛一个谁也读不懂的 TypeError）。
    const width = bounds === null ? 0 : bounds.maxX - bounds.minX
    const height = bounds === null ? 0 : bounds.maxY - bounds.minY
    if (svg === null || width <= 0 || height <= 0) {
      throw new Error(`容器「${container.name}」画不出来，这一趟先不导出了。`)
    }
    pages.push({ svg, width, height })
  }

  // 字体是这一条的命门：不嵌它，svg2pdf 会回落 `times`，中文变成内容流里的乱码（见
  // `design-pdf.ts`）。取不到就照实说，不交一份没有字的产物。
  const font = await ensureCJKFont()
  if (font === null) throw new Error('取不到中文字面（插件资产没装上），这一趟先不导出了。')

  const bytes = await renderPdfDocument(pages, pdfTextStyles(graph), font)
  return { kind: 'done', units: [{ name: '', bytes }] }
}

/**
 * PPT 的粒度是**页面**：一页的容器就是这一段幻灯片的每一张。
 *
 * 为什么按页面切而不是把所有容器一次交出去：导出器的选区不许跨页面（跨了直接抛），而页面
 * 正是「一叠幻灯片」这件事的天然单位。多页文档于是就得到多份 pptx——按全仓同一条规矩，
 * 多份打成包（见 `client/canvas/design-export.ts`），不丢也不合并。
 */
async function perPage(
  graph: SceneGraph,
  containers: readonly SceneNode[],
  canvas: ExportRenderer | null,
): Promise<DesignExportOutcome> {
  const units: DesignExportUnit[] = []
  for (const page of graph.getPages()) {
    const ids = containers.filter((node) => pageOf(graph, node.id) === page.id).map((node) => node.id)
    if (ids.length === 0) continue
    const data = await draw(graph, 'pptx', { scope: 'selection', nodeIds: ids }, {}, canvas)
    if (data === undefined) throw new Error(`页面「${page.name}」画不出来，这一趟先不导出了。`)
    units.push({ name: page.name, bytes: data })
  }
  if (units.length === 0) return { kind: 'refused', reason: 'empty' }
  return { kind: 'done', units }
}

/** 交给门面画一次，把结果统一成字节。 */
async function draw(
  graph: SceneGraph,
  format: string,
  target: ExportTarget,
  options: Record<string, unknown>,
  canvas: ExportRenderer | null,
): Promise<Uint8Array | undefined> {
  const result = await IO.exportContent(format, { graph, target }, options, contextOf(canvas))
  const data = result.data
  if (typeof data === 'string') return new TextEncoder().encode(data)
  return data.byteLength === 0 ? undefined : data
}

/** 一个节点就是一份选区（导出器四种 target 里最小的那一种）。 */
function nodeTarget(nodeId: string): ExportTarget {
  return { scope: 'node', nodeId }
}

/** 有渲染器就把它作为 context 递进去；没有就交 `undefined`（让格式自己决定能不能画）。 */
function contextOf(canvas: ExportRenderer | null): IOContext | undefined {
  return canvas === null ? undefined : { canvasKit: canvas.ck, renderer: canvas.renderer }
}

/** `ExportResult.data` 是字节或文本二选一；这几条路都是字节。 */
function bytesOf(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? new TextEncoder().encode(data) : data
}
