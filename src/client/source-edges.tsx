/**
 * dsh-canvas — the source edges (F4.1).
 *
 * There is exactly one relation on this board: 取材. A downstream artifact
 * takes its material from an upstream one, so the line runs material → product
 * and the arrowhead sits at the product end. Type and colour carry the whole
 * meaning — dashed breeze — which is why nothing here draws a legend or a
 * label on the line.
 *
 * The layer is one SVG that shares the board's transformed coordinate space, so
 * every path is written in canvas coordinates and needs no screen-space maths.
 * While the user drags a card or a new edge, the affected path is drawn from
 * the live pointer position instead of the committed one.
 */
import type { BoardCard, BoardSource, Point } from '../types.ts'

/** Half the rendered card size, for anchoring a line to a card's edge. */
const CARD_W = 200
const CARD_H = 140

/** Where the user is dragging a brand-new edge from. */
export interface PendingEdge {
  /** The card the drag started on. */
  cardId: string
  /** `out` = that card is the material; `in` = that card is the consumer. */
  side: 'in' | 'out'
  /** Live pointer position, in canvas coordinates. */
  at: Point
}

/** Props of the edge layer. */
export interface SourceEdgesProps {
  cards: readonly BoardCard[]
  sources: readonly BoardSource[]
  /** The card currently being dragged, whose drawn position overrides its seat. */
  dragging: { cardId: string; position: Point } | undefined
  /** The selected card, whose edges are drawn solid to read the chain at a glance. */
  selectedCardId: string | undefined
  /** The rubber band while a new edge is being dragged. */
  pending: PendingEdge | undefined
  /** Click an edge to be offered its removal. */
  onPick: (sourceId: string) => void
}

/** Centre of a card's right edge. */
function outAnchor(position: Point): Point {
  return { x: position.x + CARD_W, y: position.y + CARD_H / 2 }
}

/** Centre of a card's left edge. */
function inAnchor(position: Point): Point {
  return { x: position.x, y: position.y + CARD_H / 2 }
}

/**
 * A cubic path between two anchors.
 *
 * Left-to-right pairs get horizontal handles, which reads as "material flows
 * into product". Everything else (the same column, or a downstream that sits
 * to the left) gets vertical handles, because a horizontal handle would double
 * back through the cards.
 */
function edgePath(from: Point, to: Point): string {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    const bend = Math.max(36, Math.abs(dx) * 0.45)
    return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`
  }
  const bend = Math.max(36, Math.abs(dy) * 0.45)
  return `M ${from.x} ${from.y} C ${from.x} ${from.y + bend}, ${to.x} ${to.y - bend}, ${to.x} ${to.y}`
}

/** Render the board's source edges. */
export function SourceEdges(props: SourceEdgesProps) {
  const { cards, sources, dragging, selectedCardId, pending, onPick } = props

  const seatOf = (cardId: string): Point | undefined => {
    if (dragging !== undefined && dragging.cardId === cardId) return dragging.position
    return cards.find((card) => card.id === cardId)?.position
  }

  return (
    <svg className="dsh-canvas-edges" style={{ left: '-4000px', top: '-4000px' }} width="12000" height="12000" viewBox="-4000 -4000 12000 12000">
      <defs>
        {/* The breeze accent, hard-coded because a marker's paint is read outside the path's cascade. */}
        <marker id="dsh-canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 9 5 L 0 9 z" fill="#A0C3EC" />
        </marker>
      </defs>

      {sources.map((source) => {
        const upstream = seatOf(source.upstream)
        const downstream = seatOf(source.downstream)
        if (upstream === undefined || downstream === undefined) return null

        const from = outAnchor(upstream)
        const to = inAnchor(downstream)
        const path = edgePath(from, to)
        const active = selectedCardId === source.upstream || selectedCardId === source.downstream

        return (
          <g key={source.id}>
            <path className={active ? 'dsh-canvas-edge is-active' : 'dsh-canvas-edge'} d={path} markerEnd="url(#dsh-canvas-arrow)" />
            <path className="dsh-canvas-edge-hit" d={path} onClick={() => onPick(source.id)} />
          </g>
        )
      })}

      {pending === undefined
        ? null
        : (() => {
            const start = seatOf(pending.cardId)
            if (start === undefined) return null
            const from = pending.side === 'out' ? outAnchor(start) : inAnchor(start)
            const to = pending.side === 'out' ? inAnchor({ x: pending.at.x, y: pending.at.y }) : outAnchor({ x: pending.at.x, y: pending.at.y })
            return <path className="dsh-canvas-edge is-active" d={edgePath(from, to)} markerEnd="url(#dsh-canvas-arrow)" />
          })()}
    </svg>
  )
}
