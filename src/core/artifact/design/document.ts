/**
 * dsh-canvas — 设计文档（v2 底座：`@open-pencil/scene-graph`）。
 *
 * v1 是一套自研 Kiwi schema（24 字段 + 自写编解码）；v2 拍板改道 OpenPencil
 * （方案 A，格式破坏性切换，见 `docs/DeepSeek-Harness-Canvas-OpenPencil-接入方案.md`）：
 * 文档模型直接用场景图 `SceneGraph`（plain 数据 + 现成的命中/选择/undo 面），
 * v1 文件**不做转换器**——设计卡是模型生成的，重新生成成本≈0。
 *
 * 文件信封保留 v1 的形态判据：workspace seam 是 text-write-only，`.design`
 * 文件 = 一行头 + 正文。v1 的正文是 base64 的 Kiwi；v2 换成**场景图 JSON 快照**
 * （`SceneNode` 是可 structuredClone 的 plain 数据，JSON 天然无损），可读、
 * 可 diff、isomorphic，二进制（.fig 互通）留给确有刚需的那天。
 */
import { SceneGraph, type Color, type NodeType, type SceneNode } from '@open-pencil/scene-graph'

/** The envelope header every `.design` file starts with. */
export const DESIGN_FILE_PREFIX = 'dsh-design-'
/** The envelope version this code writes; v1 files are refused, not migrated. */
export const DESIGN_FILE_VERSION = 2

/** The design document model — the OpenPencil scene graph. */
export type DesignGraph = SceneGraph
export type { Color, NodeType, SceneNode }

// ── scaffold ───────────────────────────────────────────────────────────────

const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 }

/**
 * A brand-new design document: one blank 1024×1024 artboard (§四.2 scaffold)
 * on the scene graph's default page. The artboard is a white FRAME so it reads
 * as a sheet on the canvas grid.
 */
export function scaffoldDesignDocument(): SceneGraph {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  if (page !== undefined) page.name = '页面 1'
  graph.createNode('FRAME', page.id, {
    name: '画板 1',
    x: 0,
    y: 0,
    width: 1024,
    height: 1024,
    fills: [{ type: 'SOLID', color: WHITE, opacity: 1, visible: true }],
  })
  return graph
}

// ── walks ──────────────────────────────────────────────────────────────────

/** The artboards of a document: the FRAME children of its pages, in z-order. */
export function artboardsOf(graph: SceneGraph): SceneNode[] {
  return graph.getPages().flatMap((page) => graph.getChildren(page.id).filter((node) => node.type === 'FRAME'))
}

/** The children of one node, in z-order. */
export function childrenOf(graph: SceneGraph, id: string): SceneNode[] {
  return graph.getChildren(id)
}

// ── digest ─────────────────────────────────────────────────────────────────

/**
 * Bounded digest for the board and card summaries (F5.2): pages, artboards
 * and their shape counts — the structure a model needs to decide what to read.
 */
export function designDigest(graph: SceneGraph, budget = 40): { summary: string; outline: string[] } {
  const pages = graph.getPages()
  const lines: string[] = []
  let used = 0
  for (const page of pages) {
    const boards = graph.getChildren(page.id).filter((node) => node.type === 'FRAME')
    lines.push(`页面 ${page.name}：${boards.length} 个画板`)
    used += 1
    for (const board of boards) {
      if (used >= budget) {
        lines.push('…（其余从略）')
        return { summary: lines.join('\n'), outline: lines }
      }
      const shapes = graph.getChildren(board.id)
      lines.push(`  画板 ${board.name}（${Math.round(board.width)}×${Math.round(board.height)}）：${shapes.length} 个图层`)
      used += 1
    }
  }
  return { summary: lines.join('\n'), outline: lines }
}

// ── envelope ───────────────────────────────────────────────────────────────

/** One JSON snapshot of a scene graph — the v2 payload. */
interface DesignSnapshot {
  format: 'dsh-design'
  version: 2
  rootId: string
  nodes: SceneNode[]
}

/** Encode a document into the text envelope: one header line, JSON body. */
export function encodeDesignFile(graph: SceneGraph): string {
  const snapshot: DesignSnapshot = {
    format: 'dsh-design',
    version: 2,
    rootId: graph.rootId,
    nodes: [...graph.nodes.values()],
  }
  return `${DESIGN_FILE_PREFIX}${DESIGN_FILE_VERSION}\n${JSON.stringify(snapshot)}`
}

/** Decode a `.design` file's text into a scene graph. Throws `Error` on any malformed envelope. */
export function decodeDesignFile(text: string): SceneGraph {
  const [header, ...rest] = text.split('\n')
  if (header === undefined || !header.startsWith(DESIGN_FILE_PREFIX)) {
    throw new Error('不是一份设计文档（缺少文件头）')
  }
  const version = Number.parseInt(header.slice(DESIGN_FILE_PREFIX.length), 10)
  if (version === 1) {
    throw new Error('旧版设计文件（v1），请让模型重新生成这份设计')
  }
  if (!Number.isInteger(version) || version > DESIGN_FILE_VERSION) {
    throw new Error(`设计文档版本过新：${header}`)
  }
  let snapshot: DesignSnapshot
  try {
    snapshot = JSON.parse(rest.join('\n')) as DesignSnapshot
  } catch {
    throw new Error('设计文档内容损坏（JSON 解不开）')
  }
  if (snapshot?.format !== 'dsh-design' || snapshot?.version !== 2 || !Array.isArray(snapshot?.nodes)) {
    throw new Error('设计文档内容损坏（快照结构不对）')
  }
  const graph = new SceneGraph()
  graph.nodes.clear()
  graph.rootId = snapshot.rootId
  for (const node of snapshot.nodes) {
    if (typeof node?.id !== 'string') throw new Error('设计文档内容损坏（节点缺 id）')
    graph.nodes.set(node.id, node)
  }
  return graph
}

// ── model-facing JSON (wire) ───────────────────────────────────────────────

/** The wire's node type names — scene-graph types, lowercased. */
const WIRE_TYPES: Readonly<Record<NodeType, string>> = {
  CANVAS: 'canvas',
  FRAME: 'frame',
  RECTANGLE: 'rect',
  ROUNDED_RECTANGLE: 'rounded-rect',
  ELLIPSE: 'ellipse',
  TEXT: 'text',
  LINE: 'line',
  STAR: 'star',
  POLYGON: 'polygon',
  VECTOR: 'vector',
  BOOLEAN_OPERATION: 'boolean-operation',
  GROUP: 'group',
  SECTION: 'section',
  COMPONENT: 'component',
  COMPONENT_SET: 'component-set',
  INSTANCE: 'instance',
  CONNECTOR: 'connector',
  SHAPE_WITH_TEXT: 'shape-with-text',
}

/** Wire type → scene-graph type, for the ops that mint nodes. */
export const NODE_TYPES_BY_WIRE: Readonly<Record<string, NodeType>> = Object.fromEntries(
  Object.entries(WIRE_TYPES)
    .map(([scene, wire]) => [wire, scene as NodeType])
    .filter(([wire]) => !['canvas', 'component-set', 'boolean-operation', 'connector', 'shape-with-text'].includes(wire)),
) as Readonly<Record<string, NodeType>>

/** First visible solid fill of a node as CSS (`#rrggbb`); `''` when painted by nothing. */
export function fillToCss(node: SceneNode): string {
  const paint = node.fills.find((fill) => fill.visible && fill.type === 'SOLID')
  return paint === undefined ? '' : colorToCss(paint.color)
}

/** First visible stroke of a node as CSS (`#rrggbb`); `''` when unstroked. */
export function strokeToCss(node: SceneNode): string {
  const stroke = node.strokes.find((stroke) => stroke.visible)
  return stroke === undefined ? '' : colorToCss(stroke.color)
}

/** `{r,g,b,a}` (0–1 floats) → `#rrggbb`, alpha folded in only when it matters. */
export function colorToCss(color: Color): string {
  const byte = (channel: number): string => Math.round(Math.min(Math.max(channel, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0')
  const hex = `#${byte(color.r)}${byte(color.g)}${byte(color.b)}`
  return color.a >= 1 ? hex : `${hex}${byte(color.a)}`
}

/** `#rgb` / `#rrggbb` / `#rrggbbaa` → Color, or `undefined` when unparsable. */
export function colorFromCss(text: string): Color | undefined {
  const match = /^#([0-9a-f]{3,8})$/i.exec(text.trim())
  if (match === null) return undefined
  const hex = match[1]
  const expand = (pair: string): number => Number.parseInt(pair, 16) / 255
  if (hex.length === 3) {
    return { r: expand(hex[0] + hex[0]), g: expand(hex[1] + hex[1]), b: expand(hex[2] + hex[2]), a: 1 }
  }
  if (hex.length === 6) {
    return { r: expand(hex.slice(0, 2)), g: expand(hex.slice(2, 4)), b: expand(hex.slice(4, 6)), a: 1 }
  }
  if (hex.length === 8) {
    return { r: expand(hex.slice(0, 2)), g: expand(hex.slice(2, 4)), b: expand(hex.slice(4, 6)), a: expand(hex.slice(6, 8)) }
  }
  return undefined
}

/** One node as the model sees it (F2.6): flat, css colors, lowercase types. */
export function designNodeToJson(node: SceneNode): {
  id: string
  type: string
  parentId: string
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  cornerRadius: number
  visible: boolean
  fill: string
  stroke: string
  strokeWidth: number
  text: string
  fontSize: number
  fontFamily: string
  align: 'left' | 'center' | 'right' | 'justified'
} {
  return {
    id: node.id,
    type: WIRE_TYPES[node.type],
    // The model never sees the graph's synthetic root — the caller filters it
    // out — so a parent here is always a real, addressable node id.
    parentId: node.parentId ?? '',
    name: node.name,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: node.rotation,
    opacity: node.opacity,
    cornerRadius: node.cornerRadius,
    visible: node.visible,
    fill: fillToCss(node),
    stroke: strokeToCss(node),
    strokeWidth: node.strokes.find((stroke) => stroke.visible)?.weight ?? 0,
    text: node.text,
    fontSize: node.fontSize,
    fontFamily: node.fontFamily,
    align: node.textAlignHorizontal.toLowerCase() as 'left' | 'center' | 'right' | 'justified',
  }
}
