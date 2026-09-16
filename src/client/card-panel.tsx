/**
 * dsh-canvas — the card's tab in the conversation view ring (design screen 04).
 *
 * The product doc puts the card conversation panel on `conversation.view`: a
 * session-scoped list seat, so the card's face rides beside the conversation
 * itself rather than replacing it. Opening a card makes its session current;
 * this is what the user then sees next to that conversation.
 *
 * The card is found from the session id, which is the only identity this seat
 * receives. Sessions that belong to no card render a plain explanation instead
 * of disappearing — the entry is a list item, and a list item cannot decline.
 */
import { useEffect, useState } from 'react'
import type { CanvasBridge, LocatedCard } from './bridge.ts'
import type { Translate } from './locales.ts'
import { CardFace, useCardFacts } from './card-face.tsx'

/** Props injected into the card tab. */
export interface CardSessionViewProps {
  /** The framework-resolved session of the view ring. */
  sessionId: string
  bridge: CanvasBridge
  t: Translate
  /** Open a `dsh-resource://` address in the right pane. */
  openResource: (address: string) => void
}

/** Render the canvas card that the current session is bound to. */
export function CardSessionView(props: CardSessionViewProps) {
  const { sessionId, bridge, t, openResource } = props
  const [located, setLocated] = useState<LocatedCard | undefined>()
  const [resolving, setResolving] = useState(true)

  useEffect(() => {
    if (sessionId === '') {
      setLocated(undefined)
      setResolving(false)
      return
    }
    let cancelled = false
    setResolving(true)
    void bridge
      .findCardBySession(sessionId)
      .then((found) => {
        if (!cancelled) setLocated(found)
      })
      .catch(() => {
        if (!cancelled) setLocated(undefined)
      })
      .finally(() => {
        if (!cancelled) setResolving(false)
      })
    return () => {
      cancelled = true
    }
  }, [bridge, sessionId])

  const facts = useCardFacts(bridge, located, t)

  if (resolving) {
    return (
      <div className="dsh-canvas-panel">
        <span className="dsh-canvas-muted">{t('canvas.loading')}</span>
      </div>
    )
  }

  if (located === undefined) {
    return (
      <div className="dsh-canvas-panel">
        <div className="dsh-canvas-empty-title">{t('canvas.view.unbound')}</div>
        <span className="dsh-canvas-muted">{t('canvas.view.noSession')}</span>
      </div>
    )
  }

  return (
    <CardFace located={located} facts={facts} t={t}>
      <button
        className="dsh-canvas-chipbtn"
        onClick={() => openResource(`dsh-resource://file/absolute/${located.project.root}/${located.card.id}`)}
      >
        {t('canvas.action.open')}
      </button>
    </CardFace>
  )
}
