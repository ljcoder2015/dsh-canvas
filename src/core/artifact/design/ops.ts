/**
 * dsh-canvas — 结构化改稿 op（F2.6，v2 底座）。
 *
 * 模型不直写设计文件：改稿永远是这一组 op，落到 `@open-pencil/scene-graph`
 * 的变更 API（`createNode` / `reparentNode` / `reorderChild` / `deleteNode`）。
 * 场景图的变更方法对非法输入**静默 no-op**——那对模型是最坏的应答（改了以为
 * 改成了），所以这里每个 op 先自己校验，失败进 `errors`，一个 op 的失败不拦
 * 批里其余的 op。
 *
 * op 的形状与 `contract.ts` 的 `designOpSchema` 逐字对齐；颜色是 css 文本，
 * 类型是小写 wire 名（`rect`），在边界处翻成场景图的枚举。与 v1 的差别：
 * 图不再是「一份拷贝」，op 直接作用在调用方持有的 `SceneGraph` 上——caller
 * （card-runtime）仍然握着版本闸与写盘。
 */
import {
  colorFromCss,
  NODE_TYPES_BY_WIRE,
  type DesignGraph,
  type SceneNode,
} from './document.ts'
import type { Color } from '@open-pencil/scene-graph'

/** One structured edit op — mirrors `designOpSchema` in `contract.ts`. */
export interface DesignOpInput {
  kind: 'upsert' | 'setProps' | 'move' | 'delete' | 'reorder'
  /** Required for everything except `upsert` (where it mints an id when absent). */
  id?: string
  /** `upsert` only: the wire type to create (`rect`, `ellipse`, `text`, …). */
  type?: string
  parentId?: string
  name?: string
  x?: number
  y?: number
  rotation?: number
  width?: number
  height?: number
  cornerRadius?: number
  opacity?: number
  /** CSS color; `''` clears the fills. */
  fill?: string
  /** CSS color; sets the first stroke. */
  stroke?: string
  strokeWidth?: number
  text?: string
  fontSize?: number
  fontFamily?: string
  align?: 'left' | 'center' | 'right' | 'justified'
  visible?: boolean
  /** `reorder` only: z-order index; default is top of the parent's stack. */
  index?: number
}

/** Container types an `upsert`/`move` may target — same rule as Figma: pages, frames, groups, sections. */
const CONTAINER_TYPES: ReadonlySet<string> = new Set(['CANVAS', 'FRAME', 'GROUP', 'SECTION'])

/** Apply a batch of ops in place; a failing op records one error line and the batch carries on. */
export function applyDesignOps(graph: DesignGraph, ops: readonly DesignOpInput[]): { applied: number; errors: string[] } {
  let applied = 0
  const errors: string[] = []
  ops.forEach((op, position) => {
    try {
      applyOne(graph, op)
      applied += 1
    } catch (error) {
      errors.push(`op#${position}（${op.kind}${op.id === undefined ? '' : ` ${op.id}`}）：${error instanceof Error ? error.message : String(error)}`)
    }
  })
  return { applied, errors }
}

function applyOne(graph: DesignGraph, op: DesignOpInput): void {
  switch (op.kind) {
    case 'upsert':
      upsert(graph, op)
      return
    case 'setProps':
      setProps(graph, requireNode(graph, op.id), op)
      return
    case 'move':
      move(graph, op)
      return
    case 'delete':
      remove(graph, op)
      return
    case 'reorder':
      reorder(graph, op)
      return
  }
}

// ── upsert ─────────────────────────────────────────────────────────────────

function upsert(graph: DesignGraph, op: DesignOpInput): void {
  if (op.id !== undefined) {
    const existing = graph.nodes.get(op.id)
    if (existing !== undefined) {
      // An upsert with a known id is a props update — the model does not have
      // to distinguish "create" from "set" when regenerating a layer.
      setProps(graph, existing, op)
      return
    }
  }
  const type = op.type === undefined ? undefined : NODE_TYPES_BY_WIRE[op.type]
  if (type === undefined) {
    throw new Error(`upsert 需要可创建的 type，收到「${op.type ?? '（缺）'}」`)
  }
  if (op.parentId === undefined) throw new Error('upsert 需要 parentId')
  const parent = graph.nodes.get(op.parentId)
  if (parent === undefined) throw new Error(`父节点不存在：${op.parentId}`)
  if (!CONTAINER_TYPES.has(parent.type)) throw new Error(`父节点不是容器（${parent.type}）：${op.parentId}`)
  const node = op.id === undefined ? graph.createNode(type, op.parentId) : graph.createNodeWithId(op.id, type, op.parentId)
  if (node.parentId !== op.parentId) throw new Error(`节点创建失败：${op.id ?? type}`)
  setProps(graph, node, op, true)
}

// ── setProps ───────────────────────────────────────────────────────────────

function setProps(graph: DesignGraph, node: SceneNode, op: DesignOpInput, minting = false): void {
  void graph
  if (op.name !== undefined) node.name = op.name
  if (op.x !== undefined) node.x = op.x
  if (op.y !== undefined) node.y = op.y
  if (op.width !== undefined) node.width = op.width
  if (op.height !== undefined) node.height = op.height
  if (op.rotation !== undefined) node.rotation = op.rotation
  if (op.opacity !== undefined) node.opacity = clamp01(op.opacity)
  if (op.cornerRadius !== undefined) {
    node.cornerRadius = op.cornerRadius
    node.topLeftRadius = op.cornerRadius
    node.topRightRadius = op.cornerRadius
    node.bottomRightRadius = op.cornerRadius
    node.bottomLeftRadius = op.cornerRadius
    node.independentCorners = false
  }
  if (op.visible !== undefined) node.visible = op.visible
  if (op.text !== undefined) node.text = op.text
  if (op.fontSize !== undefined) node.fontSize = op.fontSize
  if (op.fontFamily !== undefined) node.fontFamily = op.fontFamily
  if (op.align !== undefined) node.textAlignHorizontal = op.align.toUpperCase() as SceneNode['textAlignHorizontal']
  if (op.fill !== undefined) node.fills = fillsFromCss(op.fill)
  if (op.stroke !== undefined) {
    node.strokes = [{
      color: parseColor(op.stroke, 'stroke'),
      weight: op.strokeWidth ?? node.strokes[0]?.weight ?? 1,
      opacity: 1,
      visible: true,
      align: 'INSIDE',
    }]
  } else if (op.strokeWidth !== undefined) {
    const stroke = node.strokes[0]
    if (stroke === undefined) {
      if (!minting) throw new Error('该节点没有描边，strokeWidth 无处可设')
    } else {
      stroke.weight = op.strokeWidth
    }
  }
}

// ── move / delete / reorder ────────────────────────────────────────────────

function move(graph: DesignGraph, op: DesignOpInput): void {
  if (op.id === undefined) throw new Error('move 需要 id')
  const node = requireNode(graph, op.id)
  if (op.parentId === undefined) throw new Error('move 需要 parentId')
  const parent = graph.nodes.get(op.parentId)
  if (parent === undefined) throw new Error(`父节点不存在：${op.parentId}`)
  if (!CONTAINER_TYPES.has(parent.type)) throw new Error(`父节点不是容器（${parent.type}）`)
  if (isDescendant(graph, op.id, op.parentId)) throw new Error('不能把节点移进它自己的后代')
  graph.reparentNode(op.id, op.parentId)
  if (node.parentId !== op.parentId) throw new Error('移动未生效')
}

function remove(graph: DesignGraph, op: DesignOpInput): void {
  if (op.id === undefined) throw new Error('delete 需要 id')
  requireNode(graph, op.id)
  graph.deleteNode(op.id)
  if (graph.nodes.get(op.id) !== undefined) throw new Error('删除未生效')
}

function reorder(graph: DesignGraph, op: DesignOpInput): void {
  if (op.id === undefined) throw new Error('reorder 需要 id')
  const node = requireNode(graph, op.id)
  const parentId = op.parentId ?? node.parentId
  if (parentId === null || parentId === undefined) throw new Error('reorder 需要父节点')
  const parent = graph.nodes.get(parentId)
  if (parent === undefined) throw new Error(`父节点不存在：${parentId}`)
  // Default lands the node on top of its (new or current) parent's stack.
  const index = op.index ?? parent.childIds.length
  graph.reorderChild(op.id, parentId, index)
  if (!parent.childIds.includes(op.id)) throw new Error('重排未生效')
}

// ── helpers ────────────────────────────────────────────────────────────────

function requireNode(graph: DesignGraph, id: string | undefined): SceneNode {
  if (id === undefined) throw new Error('需要节点 id')
  const node = graph.nodes.get(id)
  if (node === undefined) throw new Error(`节点不存在：${id}`)
  return node
}

function isDescendant(graph: DesignGraph, ancestorId: string, candidateId: string): boolean {
  let current = graph.nodes.get(candidateId)
  while (current !== undefined && current.parentId !== null) {
    if (current.parentId === ancestorId) return true
    current = current.parentId === undefined ? undefined : graph.nodes.get(current.parentId)
  }
  return false
}

function fillsFromCss(text: string): SceneNode['fills'] {
  if (text.trim() === '') return []
  return [{ type: 'SOLID', color: parseColor(text, 'fill'), opacity: 1, visible: true }]
}

function parseColor(text: string, what: string): Color {
  const color = colorFromCss(text)
  if (color === undefined) throw new Error(`无法解析的${what}颜色：${text}`)
  return color
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}
