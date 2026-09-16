/**
 * dsh-canvas — the infinite board (design screen 03).
 *
 * The workbench the right pane's canvas tab draws: three bands of chrome around
 * one transformed surface that holds the cards, the source edges, the shared
 * notes and the floating selection cluster.
 *
 * Three rules shape this component:
 *
 * 1. It never mirrors session state. A card's status and its latest message are
 *    read through the framework's own live faces — `useSessions` for the rows,
 *    the keyed `cardSession` hook for one conversation — so the board stays
 *    correct while a card's agent is running, without polling anything.
 * 2. The board itself has no push channel, so it re-reads on the signals that
 *    can actually mean "the board changed": the tab was navigated to, the
 *    sessions domain moved (a tool call re-seated a card), or one of our own
 *    actions completed. The refresh control covers the fourth case, where a
 *    host-side write produced no session event at all.
 * 3. Pan, zoom and drag stay local until commit. One pointer-up produces one
 *    wire call, never one per frame.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import type { ConversationSnapshot, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, KeyedSnapshotSelectorHook, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardCard, BoardSnapshot, CardSummary, Point, Project, Viewport } from '../types.ts'
import { kindById } from '../core/kind-registry.ts'
import type { CanvasBridge } from './bridge.ts'
import type { Translate } from './locales.ts'
import { activityOf, cardStateOf, latestLine, summaryOf, type LatestLine } from './session-read.ts'
import { CardTile } from './card-tile.tsx'
import { CardSelection } from './card-overlay.tsx'
import { SourceEdges, type PendingEdge } from './source-edges.tsx'
import { FolderPicker } from './folder-picker.tsx'
import { basenameOf, isInside, parseFileAddress } from './address.ts'

/** Card geometry, mirroring `core/board.ts` so host seating and drawing agree. */
const CARD_W = 200
const CARD_H = 140
const MIN_ZOOM = 0.35
const MAX_ZOOM = 2.4
/** Cards whose digest is read for a preview; a bigger board keeps names only. */
const SUMMARY_BUDGET = 24

/**
 * The minimal live source the board needs from a card's session face.
 *
 * Declared locally rather than imported: the board only ever calls
 * `getSnapshot` and `subscribe`, and naming the shape here keeps this file from
 * depending on the store package's full observable contract.
 */
export interface SessionFeed<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** Services the board's components reach through the inject face. */
export interface CanvasInject {
  bridge: CanvasBridge
  /** Make one session current, so the host's conversation surface shows it. */
  activateSession: (sessionId: string) => void
  /** The card-session feed, addressed by session id. */
  keyedHooks: {
    cardSession: (sessionId: string) => SessionFeed<ConversationSnapshot> | undefined
  }
}

/** Composed props of the canvas workbench tab. */
export type CanvasViewProps = PropsRuntime<'sidebar.right.pane.tab'> & InjectFace<CanvasInject> & { t: Translate }

/** Clamp a zoom factor into the board's working range. */
function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** The project a file address belongs to, when it lands inside one. */
function projectHolding(projects: readonly Project[], path: string): Project | undefined {
  return projects.find((project) => isInside(project.root, path))
}

/** Render the canvas workbench. */
export function CanvasView(props: CanvasViewProps) {
  const { bridge, t, activateSession, useCardSession, useTabInfo, useSessions } = props

  const tab = useTabInfo()
  const navigationRevision = tab.tab.navigation.revision
  const openedAddress = tab.tab.navigation.address

  // The list store is read whole on purpose: the board needs the rows, and the
  // alternative — a selector per card id — is one hook inside a loop.
  const sessions = useSessions((state: SessionListState) => state)
  /**
   * A coarse integer that moves when the sessions domain moves. Used as the
   * board's re-read trigger: a card that was re-seated by a tool call shows up
   * here as changed activity long before anything else could notice.
   */
  const activity = useMemo(() => activityOf(sessions), [sessions])

  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [board, setBoard] = useState<BoardSnapshot | undefined>()
  const [summaries, setSummaries] = useState<Record<string, CardSummary | undefined>>({})
  const [selected, setSelected] = useState<string | undefined>()
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const [dragging, setDragging] = useState<{ cardId: string; position: Point } | undefined>()
  const [linkFrom, setLinkFrom] = useState<{ cardId: string; side: 'in' | 'out' } | undefined>()
  const [pointer, setPointer] = useState<Point>({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const [removal, setRemoval] = useState<{ kind: 'card' | 'edge'; id: string } | undefined>()
  const [picker, setPicker] = useState(false)
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stamp, setStamp] = useState(0)

  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const panRef = useRef<{ pointerX: number; pointerY: number; originX: number; originY: number } | undefined>(undefined)
  /** The project whose persisted viewport has already been adopted. */
  const adoptedRef = useRef('')

  const project = projects.find((entry) => entry.id === projectId)
  const cards = board?.cards ?? []
  const sources = board?.sources ?? []
  const notes = board?.notes ?? []

  /** Report one failure in the board's own strip. */
  const report = useCallback(
    (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : t('canvas.error.unknown'))
    },
    [t],
  )

  // ── projects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    bridge
      .listProjects()
      .then((list) => {
        if (!cancelled) setProjects(list)
      })
      .catch((reason: unknown) => {
        if (!cancelled) report(reason)
      })
    return () => {
      cancelled = true
    }
  }, [bridge, report, stamp])

  // Choose a project once the list is known: the one the opened address points
  // into, otherwise the first. A user's explicit choice always wins.
  useEffect(() => {
    if (projectId !== '' || projects.length === 0) return
    const address = parseFileAddress(openedAddress)
    const inside = address !== undefined && address.scope === 'absolute' ? projectHolding(projects, address.path) : undefined
    setProjectId((inside ?? projects[0] ?? undefined)?.id ?? '')
  }, [openedAddress, projectId, projects])

  // ── board ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (projectId === '') {
      setBoard(undefined)
      return
    }
    let cancelled = false
    bridge
      .readBoard(projectId)
      .then((snapshot) => {
        if (!cancelled) setBoard(snapshot)
      })
      .catch((reason: unknown) => {
        if (!cancelled) report(reason)
      })
    return () => {
      cancelled = true
    }
  }, [bridge, projectId, navigationRevision, activity, stamp, report])

  // Adopt a project's persisted viewport once, when its board first arrives.
  useEffect(() => {
    if (board === undefined || adoptedRef.current === board.project.id) return
    adoptedRef.current = board.project.id
    setView(board.project.viewport)
  }, [board])

  // Read the digests the previews show. Capped: past the budget a card keeps
  // its name and kind, which is the honest fallback for a very large folder.
  useEffect(() => {
    if (board === undefined) return
    const wanted = board.cards.slice(0, SUMMARY_BUDGET)
    if (wanted.length === 0) {
      setSummaries({})
      return
    }
    let cancelled = false
    void Promise.all(
      wanted.map(async (card) => {
        try {
          return [card.id, await bridge.readSummary(board.project.id, card.id)] as const
        } catch {
          return [card.id, undefined] as const
        }
      }),
    ).then((pairs) => {
      if (cancelled) return
      const next: Record<string, CardSummary | undefined> = {}
      for (const [cardId, summary] of pairs) next[cardId] = summary
      setSummaries(next)
    })
    return () => {
      cancelled = true
    }
  }, [board, bridge])

  // ── derived ───────────────────────────────────────────────────────────────

  const statusOf = useCallback(
    (card: BoardCard) => cardStateOf(summaryOf(sessions, card.sessionId), card.present),
    [sessions],
  )

  const selectedCard = cards.find((card) => card.id === selected)
  // The injected hook's snapshot type is traced back to the store package's
  // observable contract, so it is pinned here to what this board actually
  // reads: one card session's conversation.
  const readCardSession = useCardSession as unknown as KeyedSnapshotSelectorHook<ConversationSnapshot>
  const selectedLatest = readCardSession(selectedCard?.sessionId ?? '', latestLine, sameLine)

  const pending: PendingEdge | undefined =
    linkFrom === undefined ? undefined : { cardId: linkFrom.cardId, side: linkFrom.side, at: pointer }

  // ── board mutations ───────────────────────────────────────────────────────

  /** Run one board action, keeping the busy flag and the error strip honest. */
  const run = useCallback(
    (action: () => Promise<unknown>) => {
      setBusy(true)
      setError('')
      void action()
        .then(() => setStamp((value) => value + 1))
        .catch(report)
        .finally(() => setBusy(false))
    },
    [report],
  )

  const commitMove = useCallback(
    (cardId: string, position: Point) => {
      if (projectId === '') return
      // The card is already drawn at its new seat, so the local board moves
      // first and the host's answer only confirms it.
      setBoard((current) =>
        current === undefined
          ? current
          : { ...current, cards: current.cards.map((card) => (card.id === cardId ? { ...card, position } : card)) },
      )
      void run(() => bridge.moveCard(projectId, cardId, position))
    },
    [bridge, projectId, run],
  )

  /** Resolve a finished linking gesture into one edge, or decline it. */
  const finishLink = useCallback(
    (cardId: string) => {
      const from = linkFrom
      setLinkFrom(undefined)
      if (from === undefined || projectId === '' || from.cardId === cardId) return
      // The port the drag started from names which end of the edge it is: `out`
      // means the start card supplies material, `in` means it consumes.
      const upstream = from.side === 'out' ? from.cardId : cardId
      const downstream = from.side === 'out' ? cardId : from.cardId
      void run(() => bridge.linkSource(projectId, upstream, downstream))
    },
    [bridge, linkFrom, projectId, run],
  )

  const removeCard = useCallback(
    (cardId: string) => {
      if (projectId === '') return
      setSelected(undefined)
      void run(() => bridge.removeCard(projectId, cardId))
    },
    [bridge, projectId, run],
  )

  const openCardSession = useCallback(
    (card: BoardCard) => {
      if (projectId === '') return
      void bridge
        .openSession(projectId, card.id)
        .then((binding) => {
          activateSession(binding.sessionId)
          setStamp((value) => value + 1)
        })
        .catch(report)
    },
    [activateSession, bridge, projectId, report],
  )

  const openCardArtifact = useCallback(
    (card: BoardCard) => {
      if (project === undefined) return
      // The host's own address builder owns this grammar; the canvas only
      // reproduces its documented absolute form, so the tab that opens is the
      // same one a built-in viewer would have produced for that path.
      tab.tab.actions.openResource(`dsh-resource://file/absolute/${project.root}/${card.id}`)
    },
    [project, tab.tab.actions],
  )

  const exportCard = useCallback(
    (card: BoardCard) => {
      if (projectId === '') return
      // The kind table decides what a kind can become — the browser never
      // invents a format the host would then refuse.
      const format = kindById(summaries[card.id]?.kind ?? '')?.exportFormats[0]
      if (format === undefined) return
      void run(() => bridge.exportCard(projectId, card.id, format))
    },
    [bridge, projectId, run, summaries],
  )

  // ── pan and zoom ──────────────────────────────────────────────────────────

  const persistView = useCallback(
    (next: Viewport) => {
      if (projectId === '') return
      void bridge.setViewport(projectId, next).catch(() => undefined)
    },
    [bridge, projectId],
  )

  const pointerToCanvas = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): Point => {
      const rect = surfaceRef.current?.getBoundingClientRect()
      if (rect === undefined) return { x: 0, y: 0 }
      return { x: (event.clientX - rect.left - view.x) / view.zoom, y: (event.clientY - rect.top - view.y) / view.zoom }
    },
    [view],
  )

  const surfacePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (linkFrom !== undefined) return
    setMenu(false)
    // Only a press on the bare surface pans; a press on a card is the card's.
    if (event.target !== event.currentTarget) return
    panRef.current = { pointerX: event.clientX, pointerY: event.clientY, originX: view.x, originY: view.y }
    setPanning(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const surfacePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (linkFrom !== undefined) {
      setPointer(pointerToCanvas(event))
      return
    }
    const pan = panRef.current
    if (pan === undefined) return
    setView((current) => ({
      ...current,
      x: pan.originX + (event.clientX - pan.pointerX),
      y: pan.originY + (event.clientY - pan.pointerY),
    }))
  }

  const surfacePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (linkFrom !== undefined) {
      setLinkFrom(undefined)
      return
    }
    if (panRef.current === undefined) return
    panRef.current = undefined
    setPanning(false)
    event.currentTarget.releasePointerCapture(event.pointerId)
    persistView(view)
  }

  const surfaceWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) {
      setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }))
      return
    }
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08
    setView((current) => {
      const zoom = clampZoom(current.zoom * factor)
      const ratio = zoom / current.zoom
      return { zoom, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio }
    })
  }

  /** Zoom about the surface centre, so the middle of the board stays put. */
  const zoomBy = useCallback((factor: number) => {
    setView((current) => {
      const rect = surfaceRef.current?.getBoundingClientRect()
      const px = (rect?.width ?? 0) / 2
      const py = (rect?.height ?? 0) / 2
      const zoom = clampZoom(current.zoom * factor)
      const ratio = zoom / current.zoom
      return { zoom, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio }
    })
  }, [])

  const fitBoard = useCallback(() => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (rect === undefined || cards.length === 0) {
      setView({ x: 0, y: 0, zoom: 1 })
      return
    }
    const minX = Math.min(...cards.map((card) => card.position.x))
    const minY = Math.min(...cards.map((card) => card.position.y))
    const maxX = Math.max(...cards.map((card) => card.position.x)) + CARD_W
    const maxY = Math.max(...cards.map((card) => card.position.y)) + CARD_H
    const zoom = clampZoom(Math.min((rect.width - 64) / (maxX - minX), (rect.height - 128) / (maxY - minY)))
    setView({ zoom, x: 32 - minX * zoom, y: 56 - minY * zoom })
  }, [cards])

  // ── minimap ───────────────────────────────────────────────────────────────

  const minimap = useMemo(() => {
    if (cards.length === 0) return { scale: 1, minX: 0, minY: 0 }
    const minX = Math.min(...cards.map((card) => card.position.x))
    const minY = Math.min(...cards.map((card) => card.position.y))
    const maxX = Math.max(...cards.map((card) => card.position.x)) + CARD_W
    const maxY = Math.max(...cards.map((card) => card.position.y)) + CARD_H
    return { scale: Math.min(120 / Math.max(maxX - minX, 1), 72 / Math.max(maxY - minY, 1)), minX, minY }
  }, [cards])

  // ── chrome ────────────────────────────────────────────────────────────────

  const addNote = useCallback(() => {
    if (projectId === '') return
    const rect = surfaceRef.current?.getBoundingClientRect()
    const position = {
      x: ((rect?.width ?? 200) / 2 - view.x) / view.zoom,
      y: ((rect?.height ?? 200) / 2 - view.y) / view.zoom,
    }
    void run(() => bridge.createNote(projectId, t('canvas.note.add'), position))
  }, [bridge, projectId, run, t, view])

  const confirmRemoval = useCallback(() => {
    const target = removal
    setRemoval(undefined)
    if (target === undefined || projectId === '') return
    if (target.kind === 'edge') void run(() => bridge.unlinkSource(projectId, target.id))
    else removeCard(target.id)
  }, [bridge, projectId, removeCard, removal, run])

  return (
    <div className="dsh-canvas-root">
      <div className="dsh-canvas-head">
        <button className="dsh-canvas-picker-btn" onClick={() => setMenu((open) => !open)}>
          <span className="dsh-canvas-picker-name">{project?.name ?? t('canvas.empty.projects')}</span>
          <span aria-hidden="true">▾</span>
        </button>

        <span className="dsh-canvas-stats">{t('canvas.stats', { cards: cards.length, sources: sources.length })}</span>

        <button className="dsh-canvas-chipbtn" data-primary="true" onClick={() => setPicker(true)}>
          {t('canvas.action.newProject')}
        </button>
        <button className="dsh-canvas-chipbtn" onClick={() => setStamp((value) => value + 1)}>
          {t('canvas.action.refresh')}
        </button>
      </div>

      {menu ? (
        <div className="dsh-canvas-toolbar is-horizontal" style={{ position: 'absolute', left: '10px', top: '44px', zIndex: 4 }}>
          {projects.length === 0 ? (
            <span className="dsh-canvas-card-meta" style={{ padding: '0 8px' }}>
              {t('canvas.empty.projects')}
            </span>
          ) : (
            projects.map((entry) => (
              <button
                className="dsh-canvas-chipbtn"
                data-primary={entry.id === projectId ? 'true' : 'false'}
                key={entry.id}
                onClick={() => {
                  setProjectId(entry.id)
                  setSelected(undefined)
                  setMenu(false)
                }}
              >
                {entry.name}
              </button>
            ))
          )}
        </div>
      ) : null}

      <div className="dsh-canvas-body">
        <div
          className={`dsh-canvas-surface${panning ? ' is-panning' : ''}${linkFrom === undefined ? '' : ' is-linking'}`}
          ref={surfaceRef}
          style={
            {
              '--dsh-px': `${view.x}px`,
              '--dsh-py': `${view.y}px`,
              '--dsh-z': `${view.zoom}`,
            } as CSSProperties
          }
          onPointerDown={surfacePointerDown}
          onPointerMove={surfacePointerMove}
          onPointerUp={surfacePointerUp}
          onPointerCancel={surfacePointerUp}
          onWheel={surfaceWheel}
        >
          <div className="dsh-canvas-layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
            <SourceEdges
              cards={cards}
              sources={sources}
              dragging={dragging}
              selectedCardId={selected}
              pending={pending}
              onPick={(sourceId) => setRemoval({ kind: 'edge', id: sourceId })}
            />

            {notes.map((note) => (
              <div className="dsh-canvas-note" key={note.id} style={{ left: `${note.position.x}px`, top: `${note.position.y}px` }}>
                <div className="dsh-canvas-note-head">
                  <span>{note.author}</span>
                  <button className="dsh-canvas-chipbtn" onClick={() => void run(() => bridge.removeNote(note.project, note.id))}>
                    ×
                  </button>
                </div>
                {note.text}
              </div>
            ))}

            {cards.map((card) => (
              <CardTile
                key={card.id}
                card={card}
                state={statusOf(card)}
                summary={summaries[card.id]}
                selected={selected === card.id}
                connecting={linkFrom?.side}
                zoom={view.zoom}
                t={t}
                onSelect={setSelected}
                onMove={commitMove}
                onDragMove={(cardId, position) => setDragging(position === undefined ? undefined : { cardId, position })}
                onConnectStart={(cardId, side) => setLinkFrom({ cardId, side })}
                onConnectDrop={finishLink}
                onActivate={() => openCardSession(card)}
              />
            ))}

            {selectedCard === undefined ? null : (
              <CardSelection
                card={selectedCard}
                summary={summaries[selectedCard.id]}
                state={statusOf(selectedCard)}
                latest={selectedLatest}
                t={t}
                onOpen={() => openCardArtifact(selectedCard)}
                onChat={() => openCardSession(selectedCard)}
                onLink={() => setLinkFrom({ cardId: selectedCard.id, side: 'out' })}
                onExport={() => exportCard(selectedCard)}
                onRemove={() => setRemoval({ kind: 'card', id: selectedCard.id })}
              />
            )}
          </div>
        </div>

        {cards.length > 0 ? (
          <div className="dsh-canvas-minimap">
            {cards.map((card) => (
              <span
                className={selected === card.id ? 'dsh-canvas-minimap-card is-selected' : 'dsh-canvas-minimap-card'}
                key={card.id}
                style={{
                  left: `${(card.position.x - minimap.minX) * minimap.scale + 6}px`,
                  top: `${(card.position.y - minimap.minY) * minimap.scale + 6}px`,
                }}
              />
            ))}
          </div>
        ) : null}

        <div className="dsh-canvas-zoombar">
          <button className="dsh-canvas-iconbtn" onClick={() => zoomBy(1.2)} title={t('canvas.zoom.in')}>
            +
          </button>
          <div className="dsh-canvas-zoomlevel">{Math.round(view.zoom * 100)}%</div>
          <button className="dsh-canvas-iconbtn" onClick={() => zoomBy(1 / 1.2)} title={t('canvas.zoom.out')}>
            −
          </button>
          <button className="dsh-canvas-iconbtn" onClick={fitBoard} title={t('canvas.zoom.reset')}>
            ⤡
          </button>
        </div>

        {project === undefined ? null : (
          <div className="dsh-canvas-toolbar is-horizontal" style={{ left: '12px', top: '12px' }}>
            <button className="dsh-canvas-chipbtn" disabled={busy} onClick={() => void run(() => bridge.arrange(project.id, 'source-chain'))}>
              {t('canvas.action.arrange')}
            </button>
            <button className="dsh-canvas-chipbtn" disabled={busy} onClick={() => void run(() => bridge.arrange(project.id, 'organize'))}>
              {t('canvas.action.tidy')}
            </button>
            <button className="dsh-canvas-chipbtn" disabled={busy} onClick={() => void run(() => bridge.reconcile(project.id))}>
              {t('canvas.action.reconcile')}
            </button>
            <button className="dsh-canvas-chipbtn" disabled={busy} onClick={addNote}>
              {t('canvas.note.add')}
            </button>
          </div>
        )}

        {project === undefined && !picker ? (
          <div className="dsh-canvas-empty">
            <div className="dsh-canvas-empty-title">{t('canvas.empty.projects')}</div>
            <button className="dsh-canvas-chipbtn" data-primary="true" onClick={() => setPicker(true)}>
              {t('canvas.action.newProject')}
            </button>
          </div>
        ) : null}

        {project !== undefined && cards.length === 0 ? (
          <div className="dsh-canvas-empty">
            <div className="dsh-canvas-empty-title">{t('canvas.empty.board')}</div>
            <div>{t('canvas.guide.description')}</div>
          </div>
        ) : null}

        {error === '' ? null : <div className="dsh-canvas-error">{t('canvas.error', { message: error })}</div>}

        {removal === undefined ? null : (
          <div className="dsh-canvas-toolbar is-horizontal" style={{ left: '50%', top: '12px', transform: 'translateX(-50%)', zIndex: 6 }}>
            <span className="dsh-canvas-card-meta" style={{ padding: '0 8px' }}>
              {removal.kind === 'edge' ? t('canvas.action.unlink') : basenameOf(removal.id)}
            </span>
            <button className="dsh-canvas-chipbtn" data-primary="true" onClick={confirmRemoval}>
              {t('canvas.action.confirm')}
            </button>
            <button className="dsh-canvas-chipbtn" onClick={() => setRemoval(undefined)}>
              {t('canvas.action.cancel')}
            </button>
          </div>
        )}

        {picker ? (
          <FolderPicker
            bridge={bridge}
            t={t}
            onCancel={() => setPicker(false)}
            onBound={(binding) => {
              setPicker(false)
              adoptedRef.current = ''
              setProjectId(binding.project.id)
              setStamp((value) => value + 1)
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

/** Structural equality for the overlay line, so the keyed hook ignores identity churn. */
function sameLine(left: LatestLine, right: LatestLine): boolean {
  return left.from === right.from && left.text === right.text
}
