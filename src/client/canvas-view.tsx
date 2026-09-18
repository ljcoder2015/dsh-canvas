/**
 * dsh-canvas — the infinite board (design screen 03).
 *
 * The board itself — `CanvasBoard` — is seat-agnostic: one transformed surface
 * that holds the cards, the source edges, the shared notes and the floating
 * selection cluster, with nothing over it but the zoom / minimap controls in the
 * corners, the creation dock (new card, shortcut sheet) at the foot and the
 * transient confirm strip. There is no header: naming, creating
 * and switching canvases belong to the sidebar's canvas management area, so the
 * page is the board and only the board. Two seats host it: the right pane's
 * canvas tab (`CanvasView`, which adds what a tab knows) and the main column's
 * canvas panel, one per canvas, named by a row in that management area.
 *
 * Three rules shape the board:
 *
 * 1. It never mirrors session state. A card's status — which is what draws its
 *    shimmer — is read through the framework's own live face, `useSessions`,
 *    so the board stays correct while a card's agent is running, without
 *    polling anything.
 * 2. The board itself has no push channel, so it re-reads on the signals that
 *    can actually mean "the board changed": the seat was navigated to, the
 *    sessions domain moved (a tool call re-seated a card), or one of our own
 *    actions completed.
 * 3. Pan, zoom and drag stay local until commit. One pointer-up produces one
 *    wire call, never one per frame — and keys, which have no pointer-up, are
 *    saved once they go quiet (see `VIEW_SAVE_DELAY`).
 *
 * The pointer has two modes and the keyboard drives the second: by default the
 * cursor is a plain arrow and a press only ever selects a card; holding space
 * turns the whole surface into a hand (drag pans), and W A S D / Q / E move the
 * viewport from the keyboard. The shortcut sheet on the dock prints exactly the
 * rows `shortcuts.ts` dispatches, so what it says is what the keys do.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { BoardCard, BoardSnapshot, CardSummary, LastPrompt, Point, Project, Viewport } from '../types.ts'
import { kindById } from '../core/kind-registry.ts'
import type { CanvasBridge } from './bridge.ts'
import type { CanvasKey, Translate } from './locales.ts'
import { activityOf, cardStateOf, summaryOf } from './session-read.ts'
import { CardTile } from './card-tile.tsx'
import { CardSelection, type MaterialRef } from './card-overlay.tsx'
import { SourceEdges, seatAtAnchor, type PendingEdge } from './source-edges.tsx'
import { FolderPicker } from './folder-picker.tsx'
import { ArtifactModal } from './artifact-view.tsx'
import { basenameOf, isInside, parseFileAddress } from './address.ts'
import { isTypingTarget, shortcutOf, SHORTCUT_SHEET, SPACE_KEY, type KeyCap } from './shortcuts.ts'

/** Card geometry, mirroring `core/board.ts` so host seating and drawing agree. */
const CARD_W = 200
const CARD_H = 140
const MIN_ZOOM = 0.35
const MAX_ZOOM = 2.4
/** Cards whose digest is read for a preview; a bigger board keeps names only. */
const SUMMARY_BUDGET = 24

/**
 * 键盘盘面上「停顿多久算说完了」：键盘平移没有抬手这个终点，只能按停顿落盘。
 */
const VIEW_SAVE_DELAY = 400

/**
 * 已挂载的画布表面，以及用户最后碰过的那一块。
 *
 * 同屏可以有两块画布（右栏标签页一块、主面板一块），而挂在 window 上的键盘监听
 * 自己分不清它们——每一块在这里登记自己，按键归「最后碰过且仍然可见」的那一块；
 * 都没碰过时归唯一可见的那一块。这块登记表是模块级的，所以进程里同时只存在一份。
 */
const LIVE_SURFACES = new Set<HTMLElement>()
let lastTouchedSurface: HTMLElement | null = null

/**
 * 这一拍键盘该归哪一块画布。
 *
 * 可见性用 `offsetParent` 判：宿主切走主面板或收掉右栏时，那一块仍在树上但没有布局，
 * 此时不该再抢按键。都没有布局（画布不在屏上）就返回 undefined——键盘交给宿主。
 */
function keyboardOwner(): HTMLElement | undefined {
  const visible = [...LIVE_SURFACES].filter((surface) => surface.isConnected && surface.offsetParent !== null)
  if (visible.length === 0) return undefined
  if (lastTouchedSurface !== null && visible.includes(lastTouchedSurface)) return lastTouchedSurface
  // 没碰过就听焦点：点过卡片的那一块，焦点在它的子树里。
  return visible.find((surface) => surface.contains(document.activeElement)) ?? visible[0]
}

/**
 * One creation option of the bottom dock.
 *
 * A card is a seat for a file, so "create" is two calls: seat the card, then —
 * when the kind has a text form — seed the file through `card.write_text`. A
 * bitmap has no text form, so its card is seated empty (`present: false`) and
 * stays honest until a generation run or a copy fills the file in.
 */
interface DockSpec {
  /** Dictionary key of the menu label. */
  readonly label: CanvasKey
  /** File extension; also the card id's suffix, since a card id is a path. */
  readonly extension: string
  /** The kind passed to `card.create_card` while no file exists yet. */
  readonly kind: string
  /** Seed content for the artifact; absent means the card is seated without one. */
  readonly seed?: string
}

/** The dock's three options, in menu order. */
const DOCK_SPECS: readonly DockSpec[] = [
  { label: 'canvas.dock.text', extension: 'md', kind: 'markdown', seed: '# 未命名\n' },
  { label: 'canvas.dock.image', extension: 'png', kind: 'image' },
  {
    label: 'canvas.dock.vector',
    extension: 'svg',
    kind: 'image',
    seed: '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"></svg>',
  },
]

/** 一个还不存在的卡片 id：以扩展名为后缀，撞名就加序号——绝不覆盖已有产物的席位。 */
function freeCardId(cards: readonly BoardCard[], extension: string): string {
  let cardId = `untitled.${extension}`
  for (let n = 2; cards.some((card) => card.id === cardId); n += 1) cardId = `untitled-${n}.${extension}`
  return cardId
}

/**
 * 取材线拖到空白处放手时，就地弹出的「新增节点」。
 *
 * `at` 是放手的那一点（画布坐标）：新卡片会按它落位，让它的端口正好接在这条线
 * 的线头上；`flip` 是弹层往哪一侧张开，在放手那一刻按屏上空间算定——线头因此
 * 不会被弹层自己盖住。
 */
interface DropNode {
  /** 起笔的那张卡片。 */
  cardId: string
  /** 是从它的哪个端口拖出来的（决定新卡片在上游还是下游）。 */
  side: 'in' | 'out'
  /** 放手点，画布坐标。 */
  at: Point
  /** 弹层向左侧 / 上方张开而不是右下。 */
  flip: { x: boolean; y: boolean }
}

/** Services the board's components reach through the inject face. */
export interface CanvasInject {
  bridge: CanvasBridge
  /** Make one session current, so the host's conversation surface shows it. */
  activateSession: (sessionId: string) => void
}

/** Composed props of the canvas workbench tab. */
export type CanvasViewProps = PropsRuntime<'sidebar.right.pane.tab'> & InjectFace<CanvasInject> & { t: Translate }

/**
 * Composed props of the board, minus what each hosting seat decides for it.
 *
 * The workbench tab and the main column's canvas panel draw the same board;
 * what differs is what a seat can say. The tab knows the address it was opened
 * at and can follow a re-navigation; the main panel is named by a sidebar row,
 * so it hands every canvas change back to the row list that owns it.
 */
export type CanvasBoardProps = InjectFace<CanvasInject> & {
  t: Translate
  /** The session list, read whole: the board needs every row for card state. */
  useSessions: SnapshotSelectorHook<SessionListState>
  /** Open one artifact address. */
  openResource: (address: string) => void
  /** Re-read trigger for a seat that can be navigated again. */
  revision?: number
  /** The address the seat was opened at, used to pick the canvas to draw. */
  address?: string
  /** The canvas this seat draws; absent lets the board resolve one itself. */
  projectId?: string
  /** Hand a chosen canvas to the seat; absent switches this board's own selection. */
  onSelectProject?: (projectId: string) => void
}

/** Clamp a zoom factor into the board's working range. */
function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/**
 * What one card's composer holds beyond the conversation itself.
 *
 * The two cases are not the same thing and must not be collapsed into one:
 *
 * - `edit` — text the user typed and has not sent. It outranks the conversation
 *   because it is work in progress that no other surface knows about.
 * - `echo` — the prompt just sent, standing in for the session until the
 *   session's own snapshot reports it. The gap is real: a card's first prompt
 *   is sent *before* its session exists, so without an echo the box would empty
 *   itself for a frame and then refill.
 *
 * No entry at all means the composer is a pure mirror of the card's
 * conversation — which is the state that makes it show the user's latest
 * message to that card, even one sent from the host's conversation page.
 */
type ComposerDraft =
  | { kind: 'edit'; text: string }
  | { kind: 'echo'; text: string; sentAt: number }

/** The project a file address belongs to, when it lands inside one. */
function projectHolding(projects: readonly Project[], path: string): Project | undefined {
  return projects.find((project) => isInside(project.root, path))
}

/**
 * Render the canvas in the right pane's workbench tab.
 *
 * The tab knows the address it was opened at — a card's `locate` action opens
 * the tab at that file — and its navigation revision doubles as the board's
 * re-read trigger. Opening an artifact is the tab's own documented action.
 *
 * @param props - the tab's composed props, including this entry's inject face.
 * @returns the board, hosted by the tab.
 */
export function CanvasView(props: CanvasViewProps) {
  const { bridge, t, activateSession, useTabInfo, useSessions } = props

  const tab = useTabInfo()
  const actions = tab.tab.actions
  const openResource = useCallback((address: string) => actions.openResource(address), [actions])

  return (
    <CanvasBoard
      bridge={bridge}
      t={t}
      activateSession={activateSession}
      useSessions={useSessions}
      openResource={openResource}
      revision={tab.tab.navigation.revision}
      address={tab.tab.navigation.address}
    />
  )
}

/** Render the infinite board. */
export function CanvasBoard(props: CanvasBoardProps) {
  const { bridge, t, activateSession, useSessions, openResource, onSelectProject } = props

  const navigationRevision = props.revision ?? 0
  const openedAddress = props.address ?? ''

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
  // 席位能直接指定画布（左栏的画布行就是这样），指定不了才由下面的 effect 落位。
  const [projectId, setProjectId] = useState(props.projectId ?? '')
  const [board, setBoard] = useState<BoardSnapshot | undefined>()
  const [summaries, setSummaries] = useState<Record<string, CardSummary | undefined>>({})
  const [selected, setSelected] = useState<string | undefined>()
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const [dragging, setDragging] = useState<{ cardId: string; position: Point } | undefined>()
  const [linkFrom, setLinkFrom] = useState<{ cardId: string; side: 'in' | 'out' } | undefined>()
  /** 取材线拖到空白处放手后开着的那张「新增节点」；undefined = 没在等落笔。 */
  const [dropNode, setDropNode] = useState<DropNode | undefined>()
  const [pointer, setPointer] = useState<Point>({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const [removal, setRemoval] = useState<string | undefined>()
  const [picker, setPicker] = useState(false)
  /** 底部 dock 上开着的那一张浮层：新建卡片，或快捷键说明；undefined = 都关着。 */
  const [dockMenu, setDockMenu] = useState<'add' | 'keys' | undefined>(undefined)
  /** 空格是否按着：它把指针从「选择」切成「抓手」（见 styles.ts 的 is-space）。 */
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [error, setError] = useState('')
  const [stamp, setStamp] = useState(0)
  /** What each card's composer holds on its own account; see `ComposerDraft`. */
  const [drafts, setDrafts] = useState<Record<string, ComposerDraft | undefined>>({})
  /** Whether the fullscreen prompt modal is open (for the selected card). */
  const [expanded, setExpanded] = useState(false)
  /** The card whose artifact is open in the fullscreen viewer (F3.8). */
  const [viewing, setViewing] = useState<string | undefined>(undefined)
  /** Digests of each card's declared material chain, keyed by card id. */
  const [materials, setMaterials] = useState<Record<string, CardSummary[]>>({})

  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const panRef = useRef<{ pointerX: number; pointerY: number; originX: number; originY: number } | undefined>(undefined)
  /** 开着的「新增节点」弹层，用来判断一次按压算不算「点了别处」。 */
  const dropRef = useRef<HTMLDivElement | null>(null)
  /** The project whose persisted viewport has already been adopted. */
  const adoptedRef = useRef('')
  /** 键盘改过的视口还没落盘；见下面那个按停顿保存的 effect。 */
  const viewDirty = useRef(false)

  const project = projects.find((entry) => entry.id === projectId)
  const cards = board?.cards ?? []
  const sources = board?.sources ?? []
  const notes = board?.notes ?? []

  // The fullscreen prompt modal belongs to one selection; a new selection
  // starts with it closed. The artifact viewer follows the board instead: it
  // shows a file, and a file can survive a selection moving elsewhere.
  useEffect(() => setExpanded(false), [selected])

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
  // into, otherwise the first. A user's explicit choice always wins — and a
  // seat that named the canvas outright is never second-guessed.
  useEffect(() => {
    if (props.projectId !== undefined || projectId !== '' || projects.length === 0) return
    const address = parseFileAddress(openedAddress)
    const inside = address !== undefined && address.scope === 'absolute' ? projectHolding(projects, address.path) : undefined
    setProjectId((inside ?? projects[0] ?? undefined)?.id ?? '')
  }, [openedAddress, projectId, projects, props.projectId])

  /**
   * Move the board onto another canvas.
   *
   * A seat that owns canvas naming (the sidebar's rows) receives the choice and
   * re-seats the board in its own way; the docked tab, which owns nothing, just
   * switches what it draws.
   */
  const chooseProject = useCallback(
    (id: string) => {
      setSelected(undefined)
      setViewing(undefined)
      if (onSelectProject === undefined) setProjectId(id)
      else onSelectProject(id)
    },
    [onSelectProject],
  )

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
  // The selection cluster (pill + composer) follows the drag in flight, not the
  // last committed seat: `dragging` carries the live position — the same signal
  // the source edges use — so the whole cluster moves with the card per frame.
  const selectionCard =
    selectedCard !== undefined && dragging !== undefined && dragging.cardId === selectedCard.id
      ? { ...selectedCard, position: dragging.position }
      : selectedCard
  // ── the composer's seed (F3.9) ────────────────────────────────────────────

  /** The user's own last message per card, read from the Host's session logs. */
  const [prompts, setPrompts] = useState<Record<string, LastPrompt | undefined>>({})
  const selectedCardId = selectedCard?.id
  const selectedSessionId = selectedCard?.sessionId ?? ''
  // The seed moves when the card's own conversation moves — a send from the
  // canvas, or one typed on the host's conversation page. The session row's
  // `updatedAt` is exactly that signal, scoped to this one session, so the box
  // never refreshes on other sessions' traffic.
  const selectedSessionStamp = summaryOf(sessions, selectedSessionId)?.updatedAt ?? 0
  useEffect(() => {
    if (selectedCardId === undefined || projectId === '') return
    if (selectedSessionId === '') {
      setPrompts((current) => ({ ...current, [selectedCardId]: EMPTY_PROMPT }))
      return
    }
    let cancelled = false
    bridge
      .readLastPrompt(projectId, selectedCardId)
      .then((value) => {
        if (!cancelled) setPrompts((current) => ({ ...current, [selectedCardId]: value }))
      })
      .catch(() => {
        // An unreadable log still gets a composer; the box just keeps whatever
        // it had. The seed is presentation, not authority.
      })
    return () => {
      cancelled = true
    }
  }, [bridge, projectId, selectedCardId, selectedSessionId, selectedSessionStamp, stamp])

  const selectedDraft = selectedCard === undefined ? undefined : drafts[selectedCard.id]
  /** What the composer draws: the user's unsent words, their send in flight, or the conversation. */
  const promptDraft = selectedDraft?.text ?? (selectedCard === undefined ? '' : (prompts[selectedCard.id]?.text ?? ''))

  // Retire an echo once the session owns it. Two ways that happens: the read
  // reports the very prompt the echo stood for, or it reports a newer one (the
  // user wrote to this card from somewhere else in the meantime). Either way
  // the composer goes back to following the conversation, which is what keeps
  // it on the user's *latest* message rather than on a copy of an older one.
  // A prompt that never lands — send refused, card gone — keeps its echo, so
  // the words are still in the box to retry.
  useEffect(() => {
    if (selectedCardId === undefined || selectedSessionId === '') return
    const reported = prompts[selectedCardId]
    if (reported === undefined || reported.text === '') return
    setDrafts((current) => {
      const held = current[selectedCardId]
      if (held === undefined || held.kind !== 'echo') return current
      const settled = held.text === reported.text || reported.time > held.sentAt
      if (!settled) return current
      const next = { ...current }
      delete next[selectedCardId]
      return next
    })
  }, [selectedCardId, selectedSessionId, prompts])

  // 拖拽中的那条线：手还按着时跟着指针走，放空之后由「新增节点」弹窗接管——弹窗
  // 开着的那段时间线照旧钉在放手点上，好让人看见这一笔将连到哪里。
  const pending: PendingEdge | undefined =
    linkFrom !== undefined
      ? { cardId: linkFrom.cardId, side: linkFrom.side, at: pointer }
      : dropNode === undefined
        ? undefined
        : { cardId: dropNode.cardId, side: dropNode.side, at: dropNode.at }

  /**
   * 点别处 = 取消这一笔。
   *
   * 按压这条路必须做在**捕获**阶段：卡片与端口的 `pointerdown` 都会
   * `stopPropagation`，冒泡阶段收不到，而「点卡片也算点了别处」正是要的语义。
   * 弹层自己按下的那一下不算——所以先看事件源在不在弹层里。
   */
  useEffect(() => {
    if (dropNode === undefined) return
    const onDown = (event: PointerEvent) => {
      const layer = dropRef.current
      if (layer !== null && event.target instanceof Node && layer.contains(event.target)) return
      setDropNode(undefined)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [dropNode])

  // 手在画布之外松开：那里没有「放手点」，也就没有弹窗可弹，这一笔直接作废，别让
  // 线粘在指针最后停的地方。画布之内的事都由表面自己的 pointerup 处理，这里不插手。
  useEffect(() => {
    if (linkFrom === undefined) return
    const onUp = (event: PointerEvent) => {
      const surface = surfaceRef.current
      if (surface !== null && event.target instanceof Node && surface.contains(event.target)) return
      setLinkFrom(undefined)
    }
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [linkFrom])

  // ── board mutations ───────────────────────────────────────────────────────

  /**
   * Run one board action.
   *
   * The error strip is cleared before the call and set by the failure path; a
   * success bumps the re-read stamp, which is what makes the board show the
   * result of a write the sessions domain knows nothing about.
   */
  const run = useCallback(
    (action: () => Promise<unknown>) => {
      setError('')
      void action()
        .then(() => setStamp((value) => value + 1))
        .catch(report)
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

  /**
   * 在放手点上建一张新卡片，并把这一笔画成取材线。
   *
   * 建卡与连线是同一个动作的两半，所以放在同一次 `run` 里：id 在本地就算好
   * （路径即 id，撞名加序号），新卡片按放手点落位，于是它的端口正好接住刚才的线头
   * ——线因此不是「跳」到卡片上，而是就地由细线变成一条正常的取材边。
   */
  const createLinkedNode = useCallback(
    (spec: DockSpec) => {
      const drop = dropNode
      setDropNode(undefined)
      if (drop === undefined || projectId === '') return
      const position = seatAtAnchor(drop.at, drop.side)
      const cardId = freeCardId(cards, spec.extension)
      const upstream = drop.side === 'out' ? drop.cardId : cardId
      const downstream = drop.side === 'out' ? cardId : drop.cardId
      void run(async () => {
        await bridge.createCard(projectId, cardId, spec.kind, position)
        if (spec.seed !== undefined) await bridge.writeText(projectId, cardId, spec.seed)
        await bridge.linkSource(projectId, upstream, downstream)
        setSelected(cardId)
      })
    },
    [bridge, cards, dropNode, projectId, run],
  )

  const removeCard = useCallback(
    (cardId: string) => {
      if (projectId === '') return
      setSelected(undefined)
      setViewing((current) => (current === cardId ? undefined : current))
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

  /**
   * Open a card's artifact as a host resource tab. The only caller is the
   * fullscreen viewer (double-click), which needs it as the way out of the
   * cases it cannot render itself — over-cap files say so in as many words.
   * The host's own address builder owns this grammar; the canvas only
   * reproduces its documented absolute form, so the tab that opens is the same
   * one a built-in viewer would have produced for that path.
   */
  const openArtifactTab = useCallback(
    (cardId: string) => {
      if (project === undefined) return
      openResource(`dsh-resource://file/absolute/${project.root}/${cardId}`)
    },
    [project, openResource],
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

  // ── card composer ─────────────────────────────────────────────────────────

  // Read the selected card's material digests for the composer's chips. Re-read
  // on the same signals as the board, so an edge added elsewhere shows up here.
  useEffect(() => {
    if (project === undefined || selectedCard === undefined) return
    let cancelled = false
    bridge
      .readSources(project.id, selectedCard.id)
      .then((list) => {
        if (!cancelled) setMaterials((current) => ({ ...current, [selectedCard.id]: list }))
      })
      .catch(() => {
        // A card whose materials cannot be read still gets its composer; the
        // chips are presentation, not authority.
      })
    return () => {
      cancelled = true
    }
  }, [bridge, project, selectedCard, stamp, activity])

  /** Record what the user typed, without sending it. */
  const editDraft = useCallback((cardId: string, text: string) => {
    setDrafts((current) => ({ ...current, [cardId]: { kind: 'edit', text } }))
  }, [])

  /**
   * Send the composer's draft as the card session's next turn.
   *
   * The wire call opens the session when it is not live yet, so the very first
   * prompt works from a cold card. The prompt stays in the box — as an echo of
   * the send, not as a stale edit: it holds the place until the session reports
   * the message back, then the composer returns to following the conversation.
   * Either way the text the user typed is still there to iterate on, which is
   * the point; a prompt usually gets refined rather than replaced. The reply
   * and the artifact arrive through the board's existing live reads.
   */
  const sendPrompt = useCallback(
    (card: BoardCard, text: string) => {
      const prompt = text.trim()
      if (projectId === '' || prompt === '') return
      setDrafts((current) => ({ ...current, [card.id]: { kind: 'echo', text: prompt, sentAt: Date.now() } }))
      void run(async () => {
        await bridge.sendMessage(projectId, card.id, prompt)
      })
    },
    [bridge, projectId, run],
  )

  /**
   * Bring another node's artifact in as material: declare the edge (unless it
   * is already declared) and push its digest into the live session in the same
   * gesture, so the next turn sees it without a tool call.
   *
   * "Already declared" is asked of the board's **direct edges**, not of the
   * digest list: that list also carries indirect upstreams, and treating one of
   * those as already-linked silently skipped the link — picking a card from ⊕
   * would push its digest but draw no line.
   */
  const addMaterial = useCallback(
    (card: BoardCard, sourceCardId: string) => {
      if (projectId === '' || card.id === sourceCardId) return
      const declared = sources.some((edge) => edge.downstream === card.id && edge.upstream === sourceCardId)
      void run(async () => {
        if (!declared) await bridge.linkSource(projectId, sourceCardId, card.id)
        await bridge.openSession(projectId, card.id)
        await bridge.injectCard(projectId, card.id, sourceCardId, 'summary')
      })
    },
    [bridge, projectId, run, sources],
  )

  /**
   * 选中卡片的取材 chips：一条 chip 就是一条边。
   *
   * `readSources` 连**间接**上游一并返回（那是 agent 沿着链要读的东西），但间接上游
   * 是更上面某张卡的关系，删无可删——所以 chips 只列画布报出来的**直接边**，各自去
   * 摘要表里配一条 tooltip。这样「chip 上的删除按钮」永远有确定的对象。
   */
  const selectionMaterials: readonly MaterialRef[] = useMemo(() => {
    if (selectionCard === undefined) return []
    const digests = materials[selectionCard.id] ?? []
    return sources
      .filter((edge) => edge.downstream === selectionCard.id)
      .map((edge) => ({
        id: edge.id,
        cardId: edge.upstream,
        summary: digests.find((entry) => entry.cardId === edge.upstream)?.summary ?? '',
      }))
  }, [materials, selectionCard, sources])

  /**
   * 删掉一条取材边。
   *
   * chip 右上角那枚按钮是画布上唯一的解除入口——线本身不可点（F4.4），所以这里直接
   * 拿边的存储 id 去删。回读沿用所有改动共用的那一个触发器（`run` 成功即 +stamp），
   * 于是线随卡片一起从画布上退场。
   */
  const dropMaterial = useCallback(
    (sourceId: string) => {
      if (projectId === '') return
      void run(() => bridge.unlinkSource(projectId, sourceId))
    },
    [bridge, projectId, run],
  )

  // ── pan and zoom ──────────────────────────────────────────────────────────

  const persistView = useCallback(
    (next: Viewport) => {
      if (projectId === '') return
      void bridge.setViewport(projectId, next).catch(() => undefined)
    },
    [bridge, projectId],
  )

  const clientToCanvas = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = surfaceRef.current?.getBoundingClientRect()
      if (rect === undefined) return { x: 0, y: 0 }
      return { x: (clientX - rect.left - view.x) / view.zoom, y: (clientY - rect.top - view.y) / view.zoom }
    },
    [view],
  )

  const pointerToCanvas = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): Point => clientToCanvas(event.clientX, event.clientY),
    [clientToCanvas],
  )

  /**
   * 放手点，以及弹层该往哪一侧张开。
   *
   * 往空间更大的那一侧开：靠近右边 / 下边放手时弹层朝左上长，否则线头会被弹层
   * 自己压在底下——「新节点接在这里」这句话就看不见了。取景框在缩放，所以判断
   * 用的是放手点的屏幕位置。
   */
  const dropPlacement = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): { at: Point; flip: { x: boolean; y: boolean } } => {
      const at = pointerToCanvas(event)
      const rect = surfaceRef.current?.getBoundingClientRect()
      if (rect === undefined) return { at, flip: { x: false, y: false } }
      const sx = at.x * view.zoom + view.x
      const sy = at.y * view.zoom + view.y
      return { at, flip: { x: sx > rect.width * 0.62, y: sy > rect.height * 0.68 } }
    },
    [pointerToCanvas, view],
  )

  const surfacePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (linkFrom !== undefined) return
    setDockMenu(undefined)
    // 只有按在空白处才算画布自己的手势；按在卡片上是卡片的事。平移握在空格里
    // （见 surfacePressCapture），所以空白处的一按如今只意味着一件事：取消选择。
    if (event.target !== event.currentTarget) return
    // 药丸与输入框都只相对某张卡片存在，所以空白处的一按就是「什么都不选」。
    setSelected(undefined)
  }

  /** 起一次平移：空格 + 拖动是唯一入口，取景这段留给将来的其它手势共用。 */
  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    panRef.current = { pointerX: event.clientX, pointerY: event.clientY, originX: view.x, originY: view.y }
    setPanning(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  /**
   * 捕获阶段的按压：认领键盘所属，并在空格按住时把这一按变成平移。
   *
   * 卡片自己的按压会 `stopPropagation`，冒泡阶段轮不到画布；而「按住空格拖画布」
   * 要求在卡片上方也成立，所以这件事必须做在**捕获**阶段——那时代理还没下发到卡片，
   * 拦下的那一按卡片收不到，于是拖动的是画布而不是卡片。
   */
  const surfacePressCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    lastTouchedSurface = event.currentTarget
    if (!spaceHeld || event.button !== 0 || linkFrom !== undefined) return
    event.stopPropagation()
    event.preventDefault()
    setDockMenu(undefined)
    beginPan(event)
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

  /**
   * 放空在画布上：就地弹出「新增节点」，让这一笔有个着落。
   *
   * 落在别的卡片端口上不算放空——端口自己的 `pointerup` 会先认领（`finishLink`），
   * 冒泡到这里的已经是一次已完成的连线。剩下的落点（空白、卡片身上、便签上）都
   * 走弹窗：从这里建一张新卡片并把线连上，或者点别处把这一笔抹掉。
   */
  const surfacePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (linkFrom !== undefined) {
      setDropNode({ ...linkFrom, ...dropPlacement(event) })
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

  /**
   * 以画布中心缩放，于是取景框的中心点留在原地。
   *
   * 缩放按钮与 Q / E 都走这里。与指针那条路不同，它没有「抬手」可以落盘，所以
   * 举起 `viewDirty`，由下面那个按停顿保存的 effect 收尾。
   */
  const zoomBy = useCallback((factor: number) => {
    viewDirty.current = true
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
    // 左侧留 32、底部留 128：底部那一段要避开左下的缩略图与右下的缩放控件。
    setView({ zoom, x: 32 - minX * zoom, y: 32 - minY * zoom })
  }, [cards])

  // ── keyboard ──────────────────────────────────────────────────────────────

  // 把自己登记进盘面名册，并在卸载时收回；键盘该归哪一块由 keyboardOwner 判。
  useEffect(() => {
    const surface = surfaceRef.current
    if (surface === null) return
    LIVE_SURFACES.add(surface)
    return () => {
      LIVE_SURFACES.delete(surface)
      if (lastTouchedSurface === surface) lastTouchedSurface = null
    }
  }, [])

  /**
   * 画布的键盘：W A S D 平移、Q / E 缩放、空格按住取抓手指针。
   *
   * 监听挂在 window 上而不是表面上：焦点多半在卡片或提示词输入框里，两者都在同一棵
   * 子树内，挂在表面上会漏掉「焦点在卡片里」的按键。随之而来的责任是自己判断该不该
   * 管——可编辑控件有焦点时一个键都不碰（否则在输入框里打 a 会把画布推走），带修饰键
   * 时不碰（Ctrl/⌘ 组合是浏览器与宿主的），同屏多块画布时只归 keyboardOwner 那一块。
   *
   * 按键重复照收：按住 W 就是连续平移，这正是「移动取景框」该有的手感。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      const surface = surfaceRef.current
      if (surface === null || keyboardOwner() !== surface) return
      if (event.key === 'Escape') {
        setDockMenu(undefined)
        setDropNode(undefined)
        return
      }
      if (event.key === SPACE_KEY) {
        // 空格默认会滚动页面；按住它这里是「抓手」，所以连默认行为一起接管。
        event.preventDefault()
        setSpaceHeld(true)
        return
      }
      const action = shortcutOf(event.key)
      if (action === undefined) return
      event.preventDefault()
      if (action.kind === 'zoom') {
        zoomBy(action.factor)
        return
      }
      viewDirty.current = true
      setView((current) => ({ ...current, x: current.x + action.dx, y: current.y + action.dy }))
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === SPACE_KEY) setSpaceHeld(false)
    }
    // 松开空格之外，窗口失焦（切标签页、弹系统对话框）也要收回抓手，否则会卡在
    // 「按住」的状态里，指针一路都是抓手的形状。
    const onRelease = () => setSpaceHeld(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onRelease)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onRelease)
    }
  }, [zoomBy])

  /**
   * 键盘改过的视口，等键盘安静下来再落盘。
   *
   * 指针那条路在抬手时提交（一次拖动一次远调），键盘没有抬手这个终点，于是改成
   * 「停顿即提交」：每次变更重置计时器，按完半秒无声才写一次。`viewDirty` 让采纳
   * 项目里存着的视口、以及指针自己的提交都不走这条路——它们要么没改，要么已经写过。
   */
  useEffect(() => {
    if (!viewDirty.current) return
    const timer = window.setTimeout(() => {
      viewDirty.current = false
      persistView(view)
    }, VIEW_SAVE_DELAY)
    return () => window.clearTimeout(timer)
  }, [view, persistView])

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

  /**
   * Create one card from the dock, at the centre of what the user is looking at.
   *
   * The id is the file's path relative to the project root, so uniqueness is
   * resolved against the seated cards with a numeric suffix — never by
   * overwriting an existing artifact's seat.
   */
  const createDockCard = useCallback(
    (spec: DockSpec) => {
      if (projectId === '') return
      const rect = surfaceRef.current?.getBoundingClientRect()
      const position = {
        x: ((rect?.width ?? 400) / 2 - view.x) / view.zoom - CARD_W / 2,
        y: ((rect?.height ?? 300) / 2 - view.y) / view.zoom - CARD_H / 2,
      }
      const cardId = freeCardId(cards, spec.extension)
      setDockMenu(undefined)
      void run(async () => {
        const card = await bridge.createCard(projectId, cardId, spec.kind, position)
        if (spec.seed !== undefined) await bridge.writeText(projectId, cardId, spec.seed)
        setSelected(card.id)
        return card
      })
    },
    [bridge, cards, projectId, run, view],
  )

  /** 顶栏那条确认移除：目标只可能是卡片——线不再可点，画布上也没有摘线的入口。 */
  const confirmRemoval = useCallback(() => {
    const target = removal
    setRemoval(undefined)
    if (target === undefined) return
    removeCard(target)
  }, [removeCard, removal])

  return (
    <div className="dsh-canvas-root">
      <div className="dsh-canvas-body">
        <div
          className={`dsh-canvas-surface${panning ? ' is-panning' : ''}${spaceHeld ? ' is-space' : ''}${linkFrom === undefined ? '' : ' is-linking'}`}
          ref={surfaceRef}
          style={
            {
              '--dsh-px': `${view.x}px`,
              '--dsh-py': `${view.y}px`,
              '--dsh-z': `${view.zoom}`,
            } as CSSProperties
          }
          onPointerDownCapture={surfacePressCapture}
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
                onConnectStart={(cardId, side, at) => {
                  // 指针状态是跨拖拽复用的：不在这里同步重置，pending 线会先按
                  // 上一次拖拽的终点画一帧，再跳回本次锚点——肉眼可见地闪一下。
                  setLinkFrom({ cardId, side })
                  setPointer(clientToCanvas(at.clientX, at.clientY))
                }}
                onConnectDrop={finishLink}
                onActivate={() => {
                  setSelected(card.id)
                  setViewing(card.id)
                }}
              />
            ))}

            {/* 放空在空白处弹出的「新增节点」：位置钉在放手点（画布坐标），随画布
                平移；外层抵消取景缩放，字号不随视图变。 */}
            {dropNode === undefined ? null : (
              <div
                className="dsh-canvas-dropzone"
                ref={dropRef}
                style={
                  { left: `${dropNode.at.x}px`, top: `${dropNode.at.y}px`, '--dsh-inv': `${1 / view.zoom}` } as CSSProperties
                }
              >
                <div
                  className="dsh-canvas-menu dsh-canvas-dropmenu"
                  role="dialog"
                  aria-label={t('canvas.drop.title')}
                  data-flip-x={dropNode.flip.x ? 'true' : 'false'}
                  data-flip-y={dropNode.flip.y ? 'true' : 'false'}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <div className="dsh-canvas-dropmenu-title">{t('canvas.drop.title')}</div>
                  {DOCK_SPECS.map((spec) => (
                    <button className="dsh-canvas-row" key={spec.extension} onClick={() => createLinkedNode(spec)}>
                      <DockIcon extension={spec.extension} />
                      {t(spec.label)}
                    </button>
                  ))}
                  <div className="dsh-canvas-dropmenu-hint">{t('canvas.drop.hint')}</div>
                </div>
              </div>
            )}

            {selectionCard === undefined ? null : (
              <CardSelection
                bridge={bridge}
                card={selectionCard}
                summary={summaries[selectionCard.id]}
                materials={selectionMaterials}
                others={cards.filter((entry) => entry.id !== selectionCard.id)}
                t={t}
                draft={promptDraft}
                onChat={() => openCardSession(selectionCard)}
                onExport={() => exportCard(selectionCard)}
                onRemove={() => setRemoval(selectionCard.id)}
                onAddMaterial={(sourceId) => addMaterial(selectionCard, sourceId)}
                onDropMaterial={dropMaterial}
                onExpand={() => setExpanded(true)}
                onDraftChange={(text) => editDraft(selectionCard.id, text)}
                onSend={() => sendPrompt(selectionCard, promptDraft)}
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
          <button className="dsh-canvas-iconbtn" onClick={() => zoomBy(1 / 1.2)} title={t('canvas.zoom.out')}>
            −
          </button>
          <div className="dsh-canvas-zoomlevel">{Math.round(view.zoom * 100)}%</div>
          <button className="dsh-canvas-iconbtn" onClick={() => zoomBy(1.2)} title={t('canvas.zoom.in')}>
            +
          </button>
          <button className="dsh-canvas-chipbtn" onClick={fitBoard}>
            {t('canvas.zoom.reset')}
          </button>
        </div>

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

        {project === undefined ? null : (
          <div className="dsh-canvas-dockzone">
            {dockMenu === 'add' ? (
              <div className="dsh-canvas-menu">
                {DOCK_SPECS.map((spec) => (
                  <button className="dsh-canvas-row" key={spec.extension} onClick={() => createDockCard(spec)}>
                    <DockIcon extension={spec.extension} />
                    {t(spec.label)}
                  </button>
                ))}
              </div>
            ) : null}
            {dockMenu === 'keys' ? <ShortcutSheet t={t} /> : null}
            <div className="dsh-canvas-dock">
              {/* 新增在最左：它是 dock 的主入口（右边那枚是说明书），所以给它实心圆
                  与画布的强调色，别让它和幽灵钮混成一排等重的图标。 */}
              <button
                className="dsh-canvas-dockbtn dsh-canvas-dockadd"
                aria-label={t('canvas.dock.add')}
                title={t('canvas.dock.add')}
                aria-expanded={dockMenu === 'add'}
                onClick={() => setDockMenu((open) => (open === 'add' ? undefined : 'add'))}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M8 3.4v9.2M3.4 8h9.2" />
                </svg>
              </button>
              <button
                className="dsh-canvas-dockbtn"
                aria-label={t('canvas.dock.keys')}
                title={t('canvas.dock.keys')}
                aria-expanded={dockMenu === 'keys'}
                onClick={() => setDockMenu((open) => (open === 'keys' ? undefined : 'keys'))}
              >
                <KeyboardGlyph />
              </button>
            </div>
          </div>
        )}

        {error === '' ? null : <div className="dsh-canvas-error">{t('canvas.error', { message: error })}</div>}

        {removal === undefined ? null : (
          <div className="dsh-canvas-toolbar is-horizontal" style={{ left: '50%', top: '12px', transform: 'translateX(-50%)', zIndex: 6 }}>
            <span className="dsh-canvas-card-meta" style={{ padding: '0 8px' }}>
              {basenameOf(removal)}
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
              chooseProject(binding.project.id)
              setStamp((value) => value + 1)
            }}
          />
        ) : null}

        {expanded && selectedCard !== undefined ? (
          <PromptModal
            card={selectedCard}
            draft={promptDraft}
            onDraftChange={(text) => editDraft(selectedCard.id, text)}
            t={t}
            onClose={() => setExpanded(false)}
            onSend={() => {
              sendPrompt(selectedCard, promptDraft)
              setExpanded(false)
            }}
          />
        ) : null}

        {viewing !== undefined && projectId !== '' ? (
          <ArtifactModal
            projectId={projectId}
            cardId={viewing}
            bridge={bridge}
            t={t}
            onOpenTab={openArtifactTab}
            onClose={() => setViewing(undefined)}
          />
        ) : null}
      </div>
    </div>
  )
}

/**
 * The fullscreen prompt modal (⤢) — the only place a prompt is written.
 *
 * Reached from the selected card's control strip, not a navigation: the modal
 * owns the draft and sends through the same path the board always used, then
 * hands the user back to the board — where the card lights up while the turn
 * runs and the artifact it produced is on the card when it ends.
 */
function PromptModal(props: {
  card: BoardCard
  draft: string
  onDraftChange: (text: string) => void
  t: Translate
  onClose: () => void
  onSend: () => void
}) {
  const { card, draft, onDraftChange, t, onClose, onSend } = props
  const canSend = draft.trim() !== ''

  // Escape is the modal's dismiss; focus starts in the textarea.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="dsh-canvas-scrim is-modal"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dsh-canvas-dialog dsh-canvas-promptmodal">
        <div className="dsh-canvas-dialog-head">
          {card.id.split('/').pop() ?? card.id}
          <span className="dsh-canvas-spacer" />
          <button className="dsh-canvas-chipbtn" onClick={onClose} aria-label={t('canvas.action.collapse')}>
            ×
          </button>
        </div>
        <textarea
          className="dsh-canvas-composer-input is-modal"
          placeholder={t('canvas.composer.placeholder')}
          autoFocus
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              if (canSend) onSend()
            }
          }}
        />
        <div className="dsh-canvas-dialog-foot">
          <span className="dsh-canvas-muted">{card.id}</span>
          <span className="dsh-canvas-spacer" />
          <button className="dsh-canvas-chipbtn" onClick={onClose}>
            {t('canvas.action.collapse')}
          </button>
          <button className="dsh-canvas-chipbtn" data-primary="true" disabled={!canSend} onClick={onSend}>
            {t('canvas.composer.send')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** The dock menu's 14px glyph, drawn per creation option. */
function DockIcon({ extension }: { extension: string }) {
  const shared = {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.3,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (extension === 'png') {
    return (
      <svg {...shared}>
        <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
        <circle cx="6" cy="6.5" r="1.1" />
        <path d="M4 11.5l2.8-2.8 2.2 2.2 1.8-1.8 1.7 1.7" />
      </svg>
    )
  }
  if (extension === 'svg') {
    return (
      <svg {...shared}>
        <path d="M3.2 12.2c3.2-7.4 6.4-7.4 9.6 0" />
        <circle cx="3.2" cy="12.2" r="1.2" />
        <circle cx="12.8" cy="12.2" r="1.2" />
      </svg>
    )
  }
  return (
    <svg {...shared}>
      <rect x="3" y="2" width="10" height="12" rx="1.5" />
      <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
    </svg>
  )
}

/** The dock's keyboard glyph: a key cap with a space bar under it. */
function KeyboardGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.6" y="3.4" width="12.8" height="9.2" rx="1.6" />
      <path d="M5.2 10.9h5.6" />
      <circle cx="4.6" cy="6.9" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="7" cy="6.9" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="9.4" cy="6.9" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="11.6" cy="6.9" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** 一行键帽里的单个键：字面键名直接用，词（滚轮、双击卡片）走字典。 */
function Cap(props: { cap: KeyCap; t: Translate }) {
  return <kbd>{'literal' in props.cap ? props.cap.literal : props.t(props.cap.key)}</kbd>
}

/**
 * 快捷键说明弹层（dock 右侧那枚键盘按钮）。
 *
 * 表体来自 `shortcuts.ts` 的 `SHORTCUT_SHEET`——与分派键位用的是同一份声明，所以
 * 这里印出来的每一行都真的按得动。它只是个说明，不是控制器：`role="dialog"` + 标题
 * 让读屏知道这是一块浮层，关闭靠再点按钮、点画布或 Esc。
 */
function ShortcutSheet(props: { t: Translate }) {
  return (
    <div className="dsh-canvas-menu dsh-canvas-keys" role="dialog" aria-label={props.t('canvas.keys.title')}>
      <div className="dsh-canvas-keys-title">{props.t('canvas.keys.title')}</div>
      {SHORTCUT_SHEET.map((row) => (
        <div className="dsh-canvas-keys-row" key={row.label}>
          <span className="dsh-canvas-keys-caps">
            {row.caps.map((cap, index) => (
              <Cap cap={cap} t={props.t} key={`${index}:${'literal' in cap ? cap.literal : cap.key}`} />
            ))}
          </span>
          <span className="dsh-canvas-keys-label">{props.t(row.label)}</span>
        </div>
      ))}
    </div>
  )
}

/** The reading every untouched composer starts from: nobody has spoken here. */
const EMPTY_PROMPT: LastPrompt = { text: '', time: 0 }
