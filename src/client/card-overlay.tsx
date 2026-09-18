/**
 * dsh-canvas — what appears around a selected card.
 *
 * Two pieces, both following the card: the action pill just above it, and the
 * card's control strip just below it. The strip is not a text box: the prompt
 * is written in the modal the ⤢ control opens (the board's cards show progress
 * and their artifact themselves, so an inline box only repeated them). What the
 * strip carries is what the card cannot say on its own — which materials feed
 * it, which model runs its turns, and how to get to the prompt.
 *
 * The prompt modal is a mirror as much as an editor: with nothing of the user's
 * own in it, it holds that card's latest message from the user, so the prompt a
 * card was most recently asked with is the one sitting in front of them to
 * refine. See `ComposerDraft` in `canvas-view.tsx` for how that is resolved
 * without the box fighting the user's typing.
 *
 * The material row is how one node consumes another node's artifact: the ⊕
 * menu lists the board's other cards, and picking one declares the source edge
 * and pushes its digest into the session in the same gesture.
 */
import { useEffect, useState } from 'react'
import type { BoardCard, CardSummary } from '../types.ts'
import type { CanvasBridge, CatalogModel, ModelCatalog } from './bridge.ts'
import type { CardState } from './session-read.ts'
import {
  nodeTypeOf,
  recallModel,
  rememberModel,
  selectionOf,
  type ModelChoice,
  type ModelSelectionView,
} from './model-memory.ts'
import type { Translate } from './locales.ts'

/** Props of the selected-card cluster. */
export interface CardSelectionProps {
  bridge: CanvasBridge
  card: BoardCard
  summary: CardSummary | undefined
  state: CardState
  /** Digests of the card's declared material chain, nearest first. */
  materials: readonly CardSummary[]
  /** Every other card on the board — what the add-material menu offers. */
  others: readonly BoardCard[]
  t: Translate
  /** Make the card's session current so its conversation becomes the main surface. */
  onChat: () => void
  /** Export in the kind's first supported format. */
  onExport: () => void
  /** Take the card off the board; the file stays. */
  onRemove: () => void
  /** Declare an edge from `sourceId` and push its digest into the session. */
  onAddMaterial: (sourceId: string) => void
  /** Open the prompt modal (⤢) — the one place a prompt is written. */
  onExpand: () => void
}

/**
 * The action pill's translation keys, in display order.
 *
 * Only the actions with no other home sit here. Opening the artifact belongs to
 * the card itself (double-click → fullscreen viewer, which carries its own way
 * into the sidebar), and declaring a material edge belongs to the card's ports
 * and the composer's ⊕ menu — repeating either as a pill button just put a
 * second, weaker door next to the real one.
 */
const PILL = [
  ['canvas.action.chat', 'onChat'],
  ['canvas.action.export', 'onExport'],
  ['canvas.action.remove', 'onRemove'],
] as const

/**
 * The Host catalog, loaded at most once per client page and shared by every
 * card's picker. A failed load clears the cache so the next open retries.
 */
let catalogCache: Promise<ModelCatalog> | undefined

function loadCatalog(bridge: CanvasBridge): Promise<ModelCatalog> {
  catalogCache ??= bridge.modelCatalog().catch((error: unknown) => {
    catalogCache = undefined
    throw error
  })
  return catalogCache
}

/** Resolve a model id to its catalog display name, falling back to the id. */
function modelName(catalog: ModelCatalog | undefined, choice: ModelChoice | undefined): string {
  if (choice === undefined) return ''
  const group = catalog?.groups.find((entry) => entry.id === choice.provider)
  return group?.models.find((model) => model.id === choice.model)?.name ?? choice.model
}

/**
 * What the composer can say about the session's model.
 *
 * - `pending` — nothing read yet (catalog loading, or the list read in flight).
 * - `chosen` — the session has a selection; it is what its next request uses.
 * - `none` — the session has never picked a model and never run, so the node
 *   type's memory may speak for it.
 * - `unknown` — the session is not in the host's list, so nothing can be said.
 *
 * `pending` and `unknown` both keep the label at its placeholder rather than
 * printing the catalog default: an unverified default reads as a fact, and that
 * is exactly the claim this seat must not make.
 */
type ModelSeat =
  | { status: 'pending' }
  | { status: 'chosen'; choice: ModelChoice }
  | { status: 'none' }
  | { status: 'unknown' }

/** Cards this page has already seeded from the type memory; one write each. */
const seededCards = new Set<string>()

/**
 * The model seat in the composer's bottom-left corner.
 *
 * Reads the Host-generation catalog through the framework's `session` Remote
 * namespace and writes a durable per-session selection with the same
 * `selectModel` wire call the host composer's model seat makes — the choice
 * governs the card session's next model request. What it *shows* comes from the
 * session's own selection projection, read from the host's session list rather
 * than kept locally, and a session that has no selection of its own inherits
 * the model its node type remembers (see `model-memory.ts`).
 *
 * Inheriting means *opening the card's conversation first*: the host's
 * `selectModel` resolves a session by resuming it, and a session resumed by
 * that call is composed outside this card's agent scope — the plugin would then
 * find a session it cannot re-open, and would start a second conversation for
 * the card. Opening through the board's own call keeps the agent, its scope and
 * the selection one conversation's worth of state.
 */
function ModelPicker({
  bridge,
  projectId,
  cardId,
  sessionId,
  kind,
  t,
}: {
  bridge: CanvasBridge
  projectId: string
  cardId: string
  /** The session the card is bound to, or `''` before it has one. */
  sessionId: string
  /** The node type whose remembered model this session may inherit. */
  kind: string
  t: Translate
}) {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<ModelCatalog | undefined>(undefined)
  const [seat, setSeat] = useState<ModelSeat>({ status: 'pending' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // The catalog is loaded on mount, not on first open: the label needs a name
  // for the session's model before the menu is ever consulted. The shared cache
  // makes every later card free.
  useEffect(() => {
    let cancelled = false
    loadCatalog(bridge)
      .then((value) => {
        if (!cancelled) setCatalog(value)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
    return () => {
      cancelled = true
    }
  }, [bridge])

  // Read the session's own projection. It is the only face that can say what
  // the next request will actually use, so the label is read from it rather
  // than guessed from the catalog default. A card that has no conversation yet
  // has no selection either — that is an answer, not a missing read.
  useEffect(() => {
    setSeat({ status: 'pending' })
    if (sessionId === '') {
      setSeat({ status: 'none' })
      return
    }
    let cancelled = false
    bridge
      .readModelSelection(sessionId)
      .then((view: ModelSelectionView | undefined) => {
        if (cancelled) return
        if (view === undefined) {
          setSeat({ status: 'unknown' })
          return
        }
        const choice = selectionOf(view)
        setSeat(choice === undefined ? { status: 'none' } : { status: 'chosen', choice })
      })
      .catch(() => {
        if (!cancelled) setSeat({ status: 'unknown' })
      })
    return () => {
      cancelled = true
    }
  }, [bridge, sessionId])

  // A session with no selection of its own inherits its node type's memory:
  // that is what makes remembering worth doing. The open comes first — see the
  // component doc — and the write happens once per card, and only on the
  // projection's own "nothing chosen yet" answer.
  useEffect(() => {
    if (seat.status !== 'none' || catalog === undefined || projectId === '' || cardId === '') return
    const remembered = recallModel(kind, catalog)
    if (remembered === undefined || seededCards.has(cardId)) return
    seededCards.add(cardId)
    setBusy(true)
    setError('')
    bridge
      .openSession(projectId, cardId)
      .then((binding) => bridge.selectModel(binding.sessionId, remembered.provider, remembered.model))
      .then(() => setSeat({ status: 'chosen', choice: remembered }))
      .catch((seedError: unknown) => setError(seedError instanceof Error ? seedError.message : String(seedError)))
      .finally(() => setBusy(false))
  }, [seat, catalog, kind, projectId, cardId, bridge])

  const pick = (provider: string, model: CatalogModel) => {
    if (busy || sessionId === '') return
    setBusy(true)
    setError('')
    const choice: ModelChoice = { provider, model: model.id }
    bridge
      .selectModel(sessionId, provider, model.id)
      .then(() => {
        // The memory is written only here: what the user picked, never a guess.
        rememberModel(kind, choice)
        setSeat({ status: 'chosen', choice })
        setOpen(false)
      })
      .catch((pickError: unknown) => setError(pickError instanceof Error ? pickError.message : String(pickError)))
      .finally(() => setBusy(false))
  }

  // What the label may state: the session's own selection, or — once the
  // projection has confirmed there is none — the model the next request will
  // start from. That is the type memory when there is one (it is about to be
  // installed), and the deployment default otherwise.
  const shown =
    seat.status === 'chosen'
      ? seat.choice
      : seat.status === 'none'
        ? recallModel(kind, catalog) ?? catalog?.default
        : undefined
  const label = shown === undefined ? t('canvas.composer.model') : modelName(catalog, shown)
  const current = seat.status === 'chosen' ? seat.choice : undefined

  return (
    <span className="dsh-canvas-modelzone">
      <button
        className="dsh-canvas-modelbtn"
        onClick={() => setOpen((value) => !value)}
        disabled={sessionId === ''}
        title={t('canvas.composer.model')}
      >
        {label}
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="dsh-canvas-menu is-raised dsh-canvas-modelmenu">
          {error !== '' ? <span className="dsh-canvas-composer-menuempty">{error}</span> : null}
          {error === '' && catalog === undefined ? (
            <span className="dsh-canvas-composer-menuempty">{t('canvas.composer.modelLoading')}</span>
          ) : null}
          {catalog?.groups.map((group) => (
            <div key={group.id}>
              <div className="dsh-canvas-modelgroup">{group.name}</div>
              {group.models.length === 0 ? (
                <span className="dsh-canvas-composer-menuempty">{t('canvas.composer.modelEmpty')}</span>
              ) : (
                group.models.map((model) => (
                  <button
                    className="dsh-canvas-row"
                    data-current={current?.provider === group.id && current?.model === model.id ? 'true' : 'false'}
                    disabled={busy}
                    key={model.id}
                    title={model.description}
                    onClick={() => pick(group.id, model)}
                  >
                    {model.name}
                  </button>
                ))
              )}
            </div>
          ))}
        </div>
      ) : null}
    </span>
  )
}

/**
 * Render the action pill and the card's composer strip for one selected card.
 *
 * The strip carries what the card itself cannot: which materials feed it (⊕),
 * which model runs its turns, and the way into the prompt modal (⤢). It has no
 * text box and no status line of its own — the prompt is written in the modal,
 * and the card face is where progress and the artifact are read.
 */
export function CardSelection(props: CardSelectionProps) {
  const {
    bridge, card, summary, state, materials, others, t, onAddMaterial, onExpand,
  } = props
  const [menu, setMenu] = useState(false)
  const hasExport = (summary?.kind ?? '') !== 'folder'
  // The memory is keyed by what the card *is*, not by which card it is: that is
  // what lets the next node of the same type start from the last choice.
  const nodeType = nodeTypeOf(card, summary)

  return (
    <>
      <div className="dsh-canvas-toolbar is-horizontal" style={{ left: `${card.position.x + 100}px`, top: `${card.position.y - 44}px`, transform: 'translateX(-50%)' }}>
        {PILL.map(([key, handler]) => {
          if (key === 'canvas.action.export' && !hasExport) return null
          return (
            <button className="dsh-canvas-chipbtn" key={key} onClick={props[handler]}>
              {t(key)}
            </button>
          )
        })}
      </div>

      <div className="dsh-canvas-overlay dsh-canvas-composer" style={{ left: `${card.position.x + 100}px`, top: `${card.position.y + 156}px`, transform: 'translateX(-50%)' }}>
        <div className="dsh-canvas-composer-materials">
          {materials.map((entry) => (
            <span className="dsh-canvas-chip" key={entry.cardId} title={entry.summary}>
              {entry.cardId.split('/').pop() ?? entry.cardId}
            </span>
          ))}
          <span className="dsh-canvas-composer-materialzone">
            <button
              className="dsh-canvas-chipbtn"
              data-primary="false"
              onClick={() => setMenu((open) => !open)}
              title={t('canvas.composer.material')}
            >
              ⊕
            </button>
            {menu ? (
              <div className="dsh-canvas-menu is-raised">
                {others.length === 0 ? (
                  <span className="dsh-canvas-composer-menuempty">{t('canvas.composer.empty')}</span>
                ) : (
                  others.map((other) => (
                    <button
                      className="dsh-canvas-row"
                      key={other.id}
                      onClick={() => {
                        setMenu(false)
                        onAddMaterial(other.id)
                      }}
                    >
                      {other.id.split('/').pop() ?? other.id}
                      <span className="dsh-canvas-row-meta">{other.kindLabel}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </span>
          <button className="dsh-canvas-chipbtn dsh-canvas-composer-expand" onClick={onExpand} title={t('canvas.action.expand')}>
            ⤢
          </button>
        </div>

        <div className="dsh-canvas-composer-foot">
          <ModelPicker
            bridge={bridge}
            projectId={card.project}
            cardId={card.id}
            sessionId={card.sessionId}
            kind={nodeType}
            t={t}
          />
          <span className="dsh-canvas-dot" data-state={state} />
        </div>
      </div>
    </>
  )
}
