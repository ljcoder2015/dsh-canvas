/**
 * dsh-canvas — what appears around a selected card.
 *
 * Two pieces, both following the card: the action pill just above it, and the
 * card's conversation overlay just below it. The overlay is deliberately thin —
 * one message, the latest — because the full conversation has an owner already
 * (the host's conversation surface), and the canvas's job is to say *what is
 * happening there*, not to become a second chat client.
 *
 * The expand control does the one thing the overlay cannot: it takes the user
 * into that conversation, which is also what makes a card's session current.
 */
import type { BoardCard, CardSummary } from '../types.ts'
import type { CardState, LatestLine } from './session-read.ts'
import type { Translate } from './locales.ts'

/** Props of the selected-card cluster. */
export interface CardSelectionProps {
  card: BoardCard
  summary: CardSummary | undefined
  state: CardState
  /** The card session's latest message, read live from its session face. */
  latest: LatestLine
  t: Translate
  /** Open the bound artifact as a resource tab. */
  onOpen: () => void
  /** Make the card's session current so its conversation becomes the main surface. */
  onChat: () => void
  /** Start dragging a new material edge from this card. */
  onLink: () => void
  /** Export in the kind's first supported format. */
  onExport: () => void
  /** Take the card off the board; the file stays. */
  onRemove: () => void
}

/** Render the action pill and the conversation overlay for one selected card. */
export function CardSelection(props: CardSelectionProps) {
  const { card, summary, state, latest, t, onOpen, onChat, onLink, onExport, onRemove } = props
  const hasExport = (summary?.kind ?? '') !== 'folder'

  return (
    <>
      <div className="dsh-canvas-toolbar is-horizontal" style={{ left: `${card.position.x}px`, top: `${card.position.y - 44}px` }}>
        <button className="dsh-canvas-chipbtn" data-primary="true" onClick={onChat}>
          {t('canvas.action.chat')}
        </button>
        <button className="dsh-canvas-chipbtn" onClick={onOpen}>
          {t('canvas.action.open')}
        </button>
        <button className="dsh-canvas-chipbtn" onClick={onLink}>
          {t('canvas.action.link')}
        </button>
        {hasExport ? (
          <button className="dsh-canvas-chipbtn" onClick={onExport}>
            {t('canvas.action.export')}
          </button>
        ) : null}
        <button className="dsh-canvas-chipbtn" onClick={onRemove}>
          {t('canvas.action.remove')}
        </button>
      </div>

      <div className="dsh-canvas-overlay" style={{ left: `${card.position.x}px`, top: `${card.position.y + 156}px` }}>
        <div className="dsh-canvas-overlay-head">
          <span className="dsh-canvas-dot" data-state={state} />
          <span>{t('canvas.panel.latest')}</span>
          <span className="dsh-canvas-spacer" />
          <button className="dsh-canvas-chipbtn" onClick={onChat} title={t('canvas.action.expand')}>
            ⤢
          </button>
        </div>
        <div className={latest.text === '' ? 'dsh-canvas-overlay-line is-muted' : 'dsh-canvas-overlay-line'}>
          {latest.text === '' ? t('canvas.panel.none') : latest.text}
        </div>
      </div>
    </>
  )
}
