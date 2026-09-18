/**
 * dsh-canvas — one card on the board.
 *
 * 200×140, matching `CARD_WIDTH`/`CARD_HEIGHT` in `core/board.ts` so the
 * seating the host computes and the seating the browser draws agree. Three
 * bands, top to bottom: the artifact preview, the name and kind, and the
 * session line with its status dot — the design's card, and nothing else on it.
 *
 * The tile owns exactly one piece of local state, the drag offset, so a drag
 * never round-trips through the host: the position is committed once, on
 * release. Everything else arrives as props.
 *
 * While the card's session runs, the tile adds one child: `.dsh-canvas-shimmer`,
 * a skewed light band sweeping across the card (see `styles.ts`). It is a layer
 * of its own rather than the card's `::after`, because the card cannot clip its
 * overflow — its ports hang outside its border. The content underneath stays
 * where it is: the sweep is the whole signal, and what the preview shows is
 * still the last artifact that actually exists.
 */
import { useRef, useState } from 'react'
import type { BoardCard, CardSummary, Point } from '../types.ts'
import type { CardState } from './session-read.ts'
import type { Translate } from './locales.ts'

/** Props of one board tile. */
export interface CardTileProps {
  card: BoardCard
  /** Derived from the card's session and its file (see `session-read.ts`). */
  state: CardState
  /** The artifact's digest, once read; the preview shows its outline. */
  summary: CardSummary | undefined
  selected: boolean
  /** Which port the user is currently dragging a source edge from, if any. */
  connecting: 'in' | 'out' | undefined
  /** Board zoom, so a pointer delta in screen px becomes a canvas delta. */
  zoom: number
  t: Translate
  onSelect: (cardId: string) => void
  /** Commit a drag. */
  onMove: (cardId: string, position: Point) => void
  /** Called while a drag is in flight so the source edges can follow the card; `undefined` ends it. */
  onDragMove: (cardId: string, position: Point | undefined) => void
  /** Start dragging a source edge from one of this card's ports. */
  onConnectStart: (cardId: string, side: 'in' | 'out', at: { clientX: number; clientY: number }) => void
  /** Finish a source edge on one of this card's ports. */
  onConnectDrop: (cardId: string, side: 'in' | 'out') => void
  /** Double-click: select the card and open its artifact fullscreen (F3.8). */
  onActivate: (cardId: string) => void
}

/** The translation key of one card state. */
const STATE_KEY = {
  running: 'canvas.status.running',
  notified: 'canvas.status.notified',
  idle: 'canvas.status.idle',
  missing: 'canvas.status.missing',
} as const

/** Up to four preview lines: the artifact's outline, or a fallback. */
function previewLines(summary: CardSummary | undefined, fallback: string): string[] {
  if (summary === undefined) return [fallback]
  const outline = summary.outline.filter((line) => line.trim() !== '').slice(0, 4)
  if (outline.length > 0) return outline
  const prose = summary.summary.split(/\r?\n/).filter((line) => line.trim() !== '')
  return prose.length > 0 ? prose.slice(0, 4) : [fallback]
}

/** Render one artifact card. */
export function CardTile(props: CardTileProps) {
  const { card, state, summary, selected, connecting, zoom, t, onSelect, onMove, onDragMove, onConnectStart, onConnectDrop, onActivate } = props
  const [offset, setOffset] = useState<Point | undefined>(undefined)
  const drag = useRef<{ x: number; y: number; moved: boolean } | undefined>(undefined)

  const position = offset ?? card.position
  const lines = previewLines(summary, card.kindLabel)

  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    onSelect(card.id)
    drag.current = { x: event.clientX, y: event.clientY, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const started = drag.current
    if (started === undefined) return
    const dx = (event.clientX - started.x) / zoom
    const dy = (event.clientY - started.y) / zoom
    if (!started.moved && Math.abs(dx) + Math.abs(dy) < 3) return
    started.moved = true
    const next = { x: card.position.x + dx, y: card.position.y + dy }
    setOffset(next)
    onDragMove(card.id, next)
  }

  const pointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const started = drag.current
    drag.current = undefined
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (started === undefined || !started.moved) {
      setOffset(undefined)
      return
    }
    const landed = offset
    setOffset(undefined)
    onDragMove(card.id, undefined)
    if (landed !== undefined) onMove(card.id, { x: Math.round(landed.x), y: Math.round(landed.y) })
  }

  const className = ['dsh-canvas-card']
  if (selected) className.push('is-selected')
  if (state === 'missing') className.push('is-absent')
  // 会话 running = 这张卡片正在产出内容，卡面亮起流光（见 styles.ts 的 is-working）。
  // 不另设本地的「已发送」标志：会话状态就是唯一真源，光在扫与模型在跑始终同义。
  if (state === 'running') className.push('is-working')

  return (
    <div
      className={className.join(' ')}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      aria-busy={state === 'running'}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onDoubleClick={() => onActivate(card.id)}
      role="button"
      tabIndex={0}
      title={card.id}
    >
      {/* 流光层画在内容之前：它是绝对定位的，因此盖在名字与预览之上（那道光是「正在
          跑」的整句话），而同样绝对定位、排在他后面的两个端口仍压在最上面。 */}
      {state === 'running' ? <span className="dsh-canvas-shimmer" aria-hidden="true" /> : null}

      <div className="dsh-canvas-card-head">
        <div className="dsh-canvas-card-name">{card.id.split('/').pop() ?? card.id}</div>
        <span className="dsh-canvas-dot" data-state={state} title={t(STATE_KEY[state])} />
      </div>

      <div className="dsh-canvas-card-preview">
        {lines.map((line, index) => (
          <div className="dsh-canvas-card-preview-line" key={`${index}:${line}`}>
            {line}
          </div>
        ))}
      </div>

      {/* Ports: `out` declares this card as material, `in` declares it as the consumer. */}
      <span
        className="dsh-canvas-port"
        data-side="out"
        role="button"
        title={t('canvas.action.link')}
        onPointerDown={(event) => {
          event.stopPropagation()
          onConnectStart(card.id, 'out', event)
        }}
        onPointerUp={(event) => {
          event.stopPropagation()
          onConnectDrop(card.id, 'out')
        }}
      >
        +
      </span>
      <span
        className="dsh-canvas-port"
        data-side="in"
        role="button"
        title={t('canvas.action.link')}
        onPointerUp={(event) => {
          event.stopPropagation()
          onConnectDrop(card.id, 'in')
        }}
        onPointerDown={(event) => {
          event.stopPropagation()
          onConnectStart(card.id, 'in', event)
        }}
      >
        {connecting === undefined ? '+' : '→'}
      </span>
    </div>
  )
}
