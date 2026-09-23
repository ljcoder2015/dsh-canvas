/**
 * dsh-canvas — board seating (F4.6).
 *
 * Arrangement is geometry over the graph and nothing else: it takes the cards,
 * the source edges and a strategy, and returns the positions the cards should
 * move to. It touches no storage, so `canvas_arrange_on_board` can be reasoned
 * about (and tested) as one pure function, and a drag that the user has already
 * done by hand is never silently undone unless the caller asks for `organize`.
 */
import type { ArrangeStrategy, CardId, Point, Source } from '../../types.ts'

/** Rendered size of one card, matching the board's card component. */
export const CARD_WIDTH = 200
/** Rendered height of one card. */
export const CARD_HEIGHT = 140

/** Top-left corner a fresh board lays its first card at. */
export const BOARD_ORIGIN: Point = { x: 48, y: 170 }

/** One card's seating input: its identity and, optionally, where it already is. */
export interface SeatInput {
  id: CardId
  /** Artifact path the card binds, when the caller knows it (id/path split: the id is not a path). */
  file?: string
  /** Current position, used as a stable tiebreaker so re-arranging is idempotent. */
  position?: Point
}

/** A decided position for one card. */
export interface Seat {
  id: CardId
  position: Point
}

/** Lay cards out in a left-to-right, top-to-bottom grid. */
function gridSeats(cards: readonly SeatInput[], gap: number, columns?: number): Seat[] {
  if (cards.length === 0) return []
  const perRow = columns ?? Math.max(1, Math.ceil(Math.sqrt(cards.length)))
  return cards.map((card, index) => ({
    id: card.id,
    position: {
      x: BOARD_ORIGIN.x + (index % perRow) * (CARD_WIDTH + gap),
      y: BOARD_ORIGIN.y + Math.floor(index / perRow) * (CARD_HEIGHT + gap),
    },
  }))
}

/**
 * Longest-path depth of every card over the source edges.
 *
 * Depth is the length of the longest upstream chain ending at the card, so a
 * card that builds on two materials always sits one column to the right of the
 * furthest material — the layout reads left to right as "material → product".
 * Cards inside a cycle (impossible to store, possible in a corrupted record)
 * keep depth 0 rather than hanging the walk.
 */
export function depthsOf(cards: readonly SeatInput[], sources: Iterable<Source>): Map<CardId, number> {
  const parents = new Map<CardId, CardId[]>()
  for (const card of cards) parents.set(card.id, [])
  for (const source of sources) {
    const list = parents.get(source.downstream)
    if (list !== undefined) list.push(source.upstream)
  }

  const depths = new Map<CardId, number>()
  const visiting = new Set<CardId>()
  const depthOf = (id: CardId): number => {
    const cached = depths.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return 0
    visiting.add(id)
    let depth = 0
    for (const parent of parents.get(id) ?? []) depth = Math.max(depth, depthOf(parent) + 1)
    visiting.delete(id)
    depths.set(id, depth)
    return depth
  }

  for (const card of cards) depthOf(card.id)
  return depths
}

/** Whether a card participates in any source edge. */
function connected(cards: readonly SeatInput[], sources: readonly Source[]): Set<CardId> {
  const linked = new Set<CardId>()
  for (const source of sources) {
    linked.add(source.upstream)
    linked.add(source.downstream)
  }
  return new Set(cards.filter((card) => linked.has(card.id)).map((card) => card.id))
}

/** Stable ordering: by current position, so a rebuild does not shuffle the board. */
function readingOrder(cards: readonly SeatInput[]): SeatInput[] {
  return [...cards].sort((left, right) => {
    const ly = left.position?.y ?? 0
    const ry = right.position?.y ?? 0
    if (ly !== ry) return ly - ry
    const lx = left.position?.x ?? 0
    const rx = right.position?.x ?? 0
    if (lx !== rx) return lx - rx
    return left.id.localeCompare(right.id)
  })
}

/**
 * Compute the seats for one strategy (F4.6).
 *
 * - `source-chain` places every card by its depth, one column per hop.
 * - `grid` is a plain compact grid, for a board with no edges worth reading.
 * - `organize` is the "tidy up" pass: cards that take part in a chain keep the
 *   chain layout, and the loose ones (notes-as-cards, orphans) are packed into
 *   a grid underneath, so a board that has accumulated strays ends up legible
 *   without any card's relationship being redefined.
 */
export function arrangeSeats(
  cards: readonly SeatInput[],
  sources: readonly Source[],
  strategy: ArrangeStrategy,
  gap: number,
): Seat[] {
  if (cards.length === 0) return []
  const ordered = readingOrder(cards)

  if (strategy === 'grid') return gridSeats(ordered, gap)

  if (strategy === 'source-chain') {
    const depths = depthsOf(ordered, sources)
    const columns = new Map<number, SeatInput[]>()
    for (const card of ordered) {
      const depth = depths.get(card.id) ?? 0
      const column = columns.get(depth)
      if (column === undefined) columns.set(depth, [card])
      else column.push(card)
    }
    const seats: Seat[] = []
    for (const [depth, column] of [...columns].sort((left, right) => left[0] - right[0])) {
      column.forEach((card, row) => {
        seats.push({
          id: card.id,
          position: {
            x: BOARD_ORIGIN.x + depth * (CARD_WIDTH + gap),
            y: BOARD_ORIGIN.y + row * (CARD_HEIGHT + gap),
          },
        })
      })
    }
    return seats
  }

  // organize: chains first (unchanged semantics), loose cards packed below.
  const linked = connected(ordered, sources)
  const chained = ordered.filter((card) => linked.has(card.id))
  const loose = ordered.filter((card) => !linked.has(card.id))

  const seats = chained.length === 0 ? [] : arrangeSeats(chained, sources, 'source-chain', gap)
  const chainRows = new Set(seats.map((seat) => seat.position.y)).size
  const looseOrigin = {
    x: BOARD_ORIGIN.x,
    y: BOARD_ORIGIN.y + Math.max(chainRows, 1) * (CARD_HEIGHT + gap),
  }
  const perRow = Math.max(1, Math.ceil(Math.sqrt(Math.max(loose.length, 1))))
  loose.forEach((card, index) => {
    seats.push({
      id: card.id,
      position: {
        x: looseOrigin.x + (index % perRow) * (CARD_WIDTH + gap),
        y: looseOrigin.y + Math.floor(index / perRow) * (CARD_HEIGHT + gap),
      },
    })
  })
  return seats
}

/**
 * The seat a newly discovered card takes when it is appended to an occupied
 * board: one step right of the right-most card, so a new file never lands on
 * top of an existing one.
 */
export function nextFreeSeat(cards: readonly SeatInput[], gap: number): Point {
  if (cards.length === 0) return { ...BOARD_ORIGIN }
  const rightMost = cards.reduce((max, card) => Math.max(max, card.position?.x ?? 0), 0)
  const bottomMost = cards.reduce((max, card) => Math.max(max, card.position?.y ?? 0), 0)
  return { x: rightMost + CARD_WIDTH + gap, y: bottomMost }
}
