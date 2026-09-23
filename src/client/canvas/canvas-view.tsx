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
import type { BoardCard, BoardSnapshot, CardSummary, LastPrompt, Point, Project, Viewport } from '../../types.ts'
import { kindById } from '../../core/artifact/kind-registry.ts'
import type { CanvasBridge } from '../wire/bridge.ts'
import type { CanvasKey, Translate } from '../ui/locales.ts'
import { activityOf, cardStateOf, summaryOf } from '../wire/session-read.ts'
import { CardTile } from './card-tile.tsx'
import { CardSelection, ComposerBody, type MaterialRef } from './card-overlay.tsx'
import type { ComposerSize } from './composer-size.ts'
import { SourceEdges, seatAtAnchor, type PendingEdge } from './source-edges.tsx'
import { FolderPicker } from './folder-picker.tsx'
import { referenceNotice } from './material-notice.ts'
import { ArtifactModal } from '../artifact/artifact-view.tsx'
import { basenameOf, isInside, parseFileAddress } from '../wire/address.ts'
import { isTypingTarget, shortcutOf, SHORTCUT_SHEET, SPACE_KEY, type KeyCap } from '../ui/shortcuts.ts'

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
  /**
   * 应用节点：不是种一个文件，而是建一个文件夹、写入 web 应用脚手架
   * （web components + shadcn 风格），入口 `index.html` 落成卡片。创建走
   * `card.scaffoldWebapp`，文件夹名由 host 按磁盘撞名情况落定。
   */
  readonly webapp?: boolean
  /**
   * 设计节点（F2.6）：产物是场景图快照（.design v2），文本 seed 装不下，创建走
   * `card.scaffoldDesign`——host 写入一份含空白画板的 `.design` 文件，
   * 名字同样由 host 按磁盘撞名情况落定。
   */
  readonly design?: boolean
}

/** The dock's creation options, in menu order. */
const DOCK_SPECS: readonly DockSpec[] = [
  { label: 'canvas.dock.text', extension: 'md', kind: 'markdown', seed: '# 未命名\n' },
  { label: 'canvas.dock.webapp', extension: 'webapp', kind: 'webapp', webapp: true },
  { label: 'canvas.dock.design', extension: 'design', kind: 'design', design: true },
]

/** 一个还不存在的卡片 id：以扩展名为后缀，撞名就加序号——绝不覆盖已有产物的席位。 */
function freeCardId(cards: readonly BoardCard[], extension: string): string {
  let cardId = `untitled.${extension}`
  for (let n = 2; cards.some((card) => card.id === cardId); n += 1) cardId = `untitled-${n}.${extension}`
  return cardId
}

/**
 * 一个还没被占用的应用文件夹名。
 *
 * 预判只对**画布上已坐的卡**负责——磁盘上真正的撞名由 host 在落盘时再兜一遍
 * （撞了会自动加序号并回报实际 id），这里先挑一个大概率干净的名字，让连线
 * 能在发起前就指向正确的一端。
 */
function freeAppFolder(cards: readonly BoardCard[]): string {
  const taken = (folder: string) => cards.some((card) => card.id.startsWith(`${folder}/`))
  let folder = 'app'
  for (let n = 2; taken(folder); n += 1) folder = `app-${n}`
  return folder
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
 * Which control strip a remembered size belongs to.
 *
 * Keyed by project *and* card: a card id is a path, and `index.html` exists on
 * every board there is — keyed by the id alone, a strip dragged large on one
 * canvas would come back large on the next one the user opens.
 */
function composerKey(card: BoardCard): string {
  return `${card.project}/${card.id}`
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
 * re-read trigger. Everything the board can do with an artifact it does on the
 * board itself (double-click previews it); the board needs nothing from the
 * tab's own action set.
 *
 * @param props - the tab's composed props, including this entry's inject face.
 * @returns the board, hosted by the tab.
 */
export function CanvasView(props: CanvasViewProps) {
  const { bridge, t, activateSession, useTabInfo, useSessions } = props

  const tab = useTabInfo()

  return (
    <CanvasBoard
      bridge={bridge}
      t={t}
      activateSession={activateSession}
      useSessions={useSessions}
      revision={tab.tab.navigation.revision}
      address={tab.tab.navigation.address}
    />
  )
}

/** Render the infinite board. */
export function CanvasBoard(props: CanvasBoardProps) {
  const { bridge, t, activateSession, useSessions, onSelectProject } = props

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
  /** 缩放条上「清理失效卡片」的确认条开着（F1.11）；与单张移除的确认条互斥。 */
  const [pruning, setPruning] = useState(false)
  const [picker, setPicker] = useState(false)
  /** 底部 dock 上开着的那一张浮层：新建卡片，或快捷键说明；undefined = 都关着。 */
  const [dockMenu, setDockMenu] = useState<'add' | 'keys' | undefined>(undefined)
  /** 空格是否按着：它把指针从「选择」切成「抓手」（见 styles.ts 的 is-space）。 */
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [error, setError] = useState('')
  /**
   * The board's answer to the last material handoff, when there is one.
   *
   * A handoff leaves no visible trace on the card face — the names go into the
   * conversation, not into the artifact — so without this line the user cannot
   * tell whether anything happened, or how much of the material could be named.
   * Cleared by
   * every new action, exactly like the error strip, so the two never compete for
   * the same spot.
   */
  const [notice, setNotice] = useState('')
  const [stamp, setStamp] = useState(0)
  /** What each card's composer holds on its own account; see `ComposerDraft`. */
  const [drafts, setDrafts] = useState<Record<string, ComposerDraft | undefined>>({})
  /** Whether the fullscreen prompt modal is open (for the selected card). */
  const [expanded, setExpanded] = useState(false)
  /**
   * The card whose artifact is open in the fullscreen viewer (F3.8), and which
   * face of it to open: `edit` is 手动输入（文本节点操作栏那枚按钮）——
   * 同一个弹窗，直接落在编辑面上。
   */
  const [viewing, setViewing] = useState<{ cardId: string; edit: boolean } | undefined>(undefined)
  /** Digests of each card's material — its direct upstreams, one hop — keyed by card id. */
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

  /**
   * 记账「用户当前在看哪张画布」——画布级 agent 工具按这条全局取项目。
   *
   * 只在席位**不自持**画布命名时写。主面板一张画布一个，彼此同时挂着，每个面板挂
   * 载都写一遍的话，最后落账的是挂载顺序里的最后一个，而不是用户看着的那一个——那
   * 一块交给 `openCanvas`（用户显式切换的地方）记账；停靠的工作台标签页只有一个实
   * 例、自己选自己，写在这里才准。自动落位（按地址选中的画布、或第一个画布）同样
   * 是一次「当前画布」的变化，所以挂在 effect 上而不是塞进选择器。
   */
  useEffect(() => {
    if (props.projectId !== undefined || projectId === '') return
    void bridge.setActiveProject(projectId).catch(() => undefined)
  }, [bridge, projectId, props.projectId])

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
    (card: BoardCard) => cardStateOf(summaryOf(sessions, card.sessionId), card.missing),
    [sessions],
  )

  const selectedCard = cards.find((card) => card.id === selected)
  /**
   * 板上产物**确实丢了**的卡片数（F1.11），也就是那颗「清理失效卡片」会清掉的张数。
   *
   * 判据由 host 给（`BoardCard.missing`），不是「现在读不到这个文件」：产物还没写的空座位、
   * 以及探针答不上来的卡，都不算在内——按钮上的数字和点下去真正会少掉的张数必须是同一个集合，
   * 否则用户只会在「说 3 张、走了 2 张」里失去信任。
   *
   * 只在有人值时出现一颗按钮，所以空板上没有任何多余按钮；数字直接写在按钮上，是因为
   * 「有几张」正是决定要不要清的理由。
   */
  const missingCount = cards.filter((card) => card.missing).length
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
  /**
   * How big each card's control strip was dragged to.
   *
   * In memory only, and keyed per card: how big one card's prompt box happens to
   * be is a preference of this sitting, not a property of the artifact or of the
   * board — so it never reaches the domain and a reload starts from the default.
   * Not remembered across a project switch either, for the same reason the key
   * carries the project: a card id is a path (`index.html`), and that same path
   * exists on every board.
   */
  const [composerSizes, setComposerSizes] = useState<Record<string, ComposerSize | undefined>>({})
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
      setNotice('')
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
   * 按一种形态把产物落到画布上：普通形态是「席位 + 种子文件」两步；应用节点是
   * 一次脚手架调用——文件夹名先在本地预判，实际落定的名字以 host 回报的卡片 id
   * 为准（磁盘撞名时它会带序号），所以后续连线一律用返回的 id。
   */
  const spawnFromSpec = useCallback(
    async (spec: DockSpec, position: Point): Promise<BoardCard> => {
      if (spec.webapp === true) return bridge.scaffoldWebapp(projectId, freeAppFolder(cards), position)
      if (spec.design === true) {
        // The local preview name only has to be *probably* free — the host
        // settles the real name against the disk, and the returned card id
        // wins for anything downstream (linking included).
        const name = freeCardId(cards, 'design').replace(/\.design$/, '')
        return bridge.scaffoldDesign(projectId, name, position)
      }
      const cardId = freeCardId(cards, spec.extension)
      const card = await bridge.createCard(projectId, cardId, spec.kind, position)
      if (spec.seed !== undefined) await bridge.writeText(projectId, cardId, spec.seed)
      return card
    },
    [bridge, cards, projectId],
  )

  /**
   * 在放手点上建一张新卡片，并把这一笔画成取材线。
   *
   * 建卡与连线是同一个动作的两半，所以放在同一次 `run` 里：新卡片按放手点落位，
   * 于是它的端口正好接住刚才的线头——线因此不是「跳」到卡片上，而是就地由细线
   * 变成一条正常的取材边。
   */
  const createLinkedNode = useCallback(
    (spec: DockSpec) => {
      const drop = dropNode
      setDropNode(undefined)
      if (drop === undefined || projectId === '') return
      const position = seatAtAnchor(drop.at, drop.side)
      void run(async () => {
        const card = await spawnFromSpec(spec, position)
        const upstream = drop.side === 'out' ? drop.cardId : card.id
        const downstream = drop.side === 'out' ? card.id : drop.cardId
        await bridge.linkSource(projectId, upstream, downstream)
        setSelected(card.id)
      })
    },
    [bridge, dropNode, projectId, run, spawnFromSpec],
  )

  const removeCard = useCallback(
    (cardId: string) => {
      if (projectId === '') return
      setSelected(undefined)
      setViewing((current) => (current?.cardId === cardId ? undefined : current))
      void run(() => bridge.removeCard(projectId, cardId))
    },
    [bridge, projectId, run],
  )

  /**
   * 一次清掉板上产物**确实丢了**的卡片（F1.11）。
   *
   * 卡片是**故意比文件活得久**的（座位可能还没有产物，缺文件也是真实状态，F3.5），所以
   * 清理绝不自作主张：文件会在切分支时回来，而拿掉一张卡会连带忘掉它的对话绑定与取材
   * 关系。这里补的只是「一次做完」——十几张幽灵卡一张一张走选中面板，最后只会把人逼到
   * 去删整张画布。
   *
   * 清完报一句实数：host 只清「证明得了不存在」的那些，读不到的会留下来，所以报出的
   * 张数可能少于按钮上的数字——那就照实说，别让用户以为按了没反应。
   */
  const pruneMissing = useCallback(() => {
    if (projectId === '') return
    const promised = missingCount
    setSelected(undefined)
    setPruning(false)
    void run(async () => {
      const removed = await bridge.removeMissingCards(projectId)
      setNotice(
        removed < promised
          ? t('canvas.prune.partial', { removed, skipped: promised - removed })
          : t('canvas.prune.done', { count: removed }),
      )
    })
  }, [bridge, missingCount, projectId, run, t])

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
   * "Already declared" is asked of the board's **direct edges** rather than of
   * the digest list: the edge is the thing this is about to create, and the
   * board's edge list is its authority. (Asking the digest list is what v1.20
   * had to fix — back then that list also carried indirect upstreams, so picking
   * a card from ⊕ pushed its digest but drew no line.)
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
   * 把上游产物以**文件引用**交给本卡片的会话（F5.3）——取材的名字通道。
   *
   * 与 `addMaterial` 的区别不是粒度而是**交付的东西**：那条路把上游产物的**内容摘要**
   * 读出来塞进上下文（本插件自己读盘、自己截断），这条只把上游的**路径**交过去——按
   * Harness 自己的 `@file` 写法，模型要用时自己 `read`。所以它也不选卡片：一张卡片的
   * 取材来源就是它的取材来源，动作作用在**已有的**连线上。
   *
   * 结果必须说出来。文件引用进的是会话、不是产物，卡面上不留痕迹——不说「已把 N 个
   * 上游产物作为文件引用交给它」，用户就无从知道刚才那一下是否发生了；有路径写不成
   * `@引用` 时更要说，否则等于悄悄少给了一部分材料。
   */
  const referenceMaterials = useCallback(
    (card: BoardCard) => {
      if (projectId === '') return
      void run(async () => {
        await bridge.openSession(projectId, card.id)
        setNotice(referenceNotice(await bridge.referenceFiles(projectId, card.id), t))
      })
    },
    [bridge, projectId, run, t],
  )

  /**
   * 选中卡片的取材 chips：一条 chip 就是一条边。
   *
   * chips 只列画布报出来的**直接边**：一条 chip 就是一条边，右上角那枚删除按钮
   * 必须有确定的删除对象，而边才是存储里的东西。摘要表只用来配 tooltip——取不到就
   * 是空的，不影响这一枚 chip 该不该在。
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

  /**
   * 把整块画布纳入视野。
   *
   * **只缩不放**：装不下就缩小，装得下就停在 100%——把三张卡放大到 146% 只是让
   * 卡片显得突兀，而「看全」在 100% 已经成立。
   *
   * 默认按当前卡位算，也可以按**别处刚算出来的卡位**算——自动排版调它时手上已经有
   * host 返回的快照，不必等状态回灌（那会先按旧位取一次景、再跳一下）。取景也是要
   * 落盘的视口（与键盘平移同一份），所以同样举起 `viewDirty`。
   */
  const fitBoard = useCallback(
    (source: readonly BoardCard[] = cards) => {
      viewDirty.current = true
      const rect = surfaceRef.current?.getBoundingClientRect()
      if (rect === undefined || source.length === 0) {
        setView({ x: 0, y: 0, zoom: 1 })
        return
      }
      const minX = Math.min(...source.map((card) => card.position.x))
      const minY = Math.min(...source.map((card) => card.position.y))
      const maxX = Math.max(...source.map((card) => card.position.x)) + CARD_W
      const maxY = Math.max(...source.map((card) => card.position.y)) + CARD_H
      const zoom = Math.min(1, clampZoom(Math.min((rect.width - 64) / (maxX - minX), (rect.height - 128) / (maxY - minY))))
      // 左侧留 32、底部留 128：底部那一段要避开左下的缩放条与右下的缩略图。
      setView({ zoom, x: 32 - minX * zoom, y: 32 - minY * zoom })
    },
    [cards],
  )

  /**
   * 自动排版：左下角那枚按钮把画布交给 host 的 `organize` 策略重新摆位——链上的
   * 卡片按取材深度成列、散卡在下方网格收拢（与 agent 的 `canvas_arrange_on_board`
   * 是同一条通道、同一份算法，只是不经过模型）。排完立刻按**新卡位**取景，否则用户
   * 看到的是「卡片跳走了」而不是「整理好了」。
   */
  const arrangeBoard = useCallback(() => {
    if (projectId === '') return
    void run(async () => {
      const snapshot = await bridge.arrange(projectId, 'organize')
      fitBoard(snapshot.cards)
    })
  }, [bridge, fitBoard, projectId, run])

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
   * overwriting an existing artifact's seat. A webapp spec goes through the
   * scaffold call instead, and the seated id is whatever folder the host
   * actually wrote.
   */
  const createDockCard = useCallback(
    (spec: DockSpec) => {
      if (projectId === '') return
      const rect = surfaceRef.current?.getBoundingClientRect()
      const position = {
        x: ((rect?.width ?? 400) / 2 - view.x) / view.zoom - CARD_W / 2,
        y: ((rect?.height ?? 300) / 2 - view.y) / view.zoom - CARD_H / 2,
      }
      setDockMenu(undefined)
      void run(async () => {
        const card = await spawnFromSpec(spec, position)
        setSelected(card.id)
        return card
      })
    },
    [projectId, run, spawnFromSpec, view],
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
                  setViewing({ cardId: card.id, edit: false })
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
                onManualEdit={() => setViewing({ cardId: selectionCard.id, edit: true })}
                onExport={() => exportCard(selectionCard)}
                onRemove={() => {
                  setPruning(false)
                  setRemoval(selectionCard.id)
                }}
                onAddMaterial={(sourceId) => addMaterial(selectionCard, sourceId)}
                onReferenceMaterials={() => referenceMaterials(selectionCard)}
                onDropMaterial={dropMaterial}
                onExpand={() => setExpanded(true)}
                onDraftChange={(text) => editDraft(selectionCard.id, text)}
                onSend={() => sendPrompt(selectionCard, promptDraft)}
                zoom={view.zoom}
                size={composerSizes[composerKey(selectionCard)]}
                onResize={(size) =>
                  setComposerSizes((current) => ({ ...current, [composerKey(selectionCard)]: size }))
                }
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
          <button
            className="dsh-canvas-chipbtn"
            onClick={arrangeBoard}
            disabled={cards.length === 0}
            title={t('canvas.board.arrange')}
          >
            {t('canvas.board.arrange')}
          </button>
          {missingCount === 0 ? null : (
            <button
              className="dsh-canvas-chipbtn"
              onClick={() => {
                setRemoval(undefined)
                setPruning(true)
              }}
              title={t('canvas.board.prune.hint')}
            >
              {t('canvas.board.prune', { count: missingCount })}
            </button>
          )}
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
        {error !== '' || notice === '' ? null : <div className="dsh-canvas-notice">{notice}</div>}

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

        {!pruning ? null : (
          <div className="dsh-canvas-toolbar is-horizontal" style={{ left: '50%', top: '12px', transform: 'translateX(-50%)', zIndex: 6 }}>
            <span className="dsh-canvas-card-meta" style={{ padding: '0 8px' }}>
              {t('canvas.prune.title', { count: missingCount })}
            </span>
            <button className="dsh-canvas-chipbtn" data-primary="true" onClick={pruneMissing}>
              {t('canvas.action.confirm')}
            </button>
            <button className="dsh-canvas-chipbtn" onClick={() => setPruning(false)}>
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
            summary={summaries[selectedCard.id]}
            materials={selectionMaterials}
            others={cards.filter((entry) => entry.id !== selectedCard.id)}
            bridge={bridge}
            draft={promptDraft}
            onDraftChange={(text) => editDraft(selectedCard.id, text)}
            t={t}
            onAddMaterial={(sourceId) => addMaterial(selectedCard, sourceId)}
            onReferenceMaterials={() => referenceMaterials(selectedCard)}
            onDropMaterial={dropMaterial}
            onClose={() => setExpanded(false)}
            onSend={() => {
              sendPrompt(selectedCard, promptDraft)
              setExpanded(false)
            }}
          />
        ) : null}

        {viewing !== undefined && projectId !== '' ? (
          <ArtifactModal
            // 换卡即换一棵树：弹窗里那些状态（元素选择手里攥着的那一笔、编辑面的草稿）都
            // 是**这张卡的**，不能随着一次重新渲染漂到另一张卡上。
            key={`${projectId}/${viewing.cardId}`}
            projectId={projectId}
            cardId={viewing.cardId}
            bridge={bridge}
            t={t}
            initialMode={viewing.edit ? 'edit' : 'preview'}
            revision={activity}
            onSaved={() => setStamp((value) => value + 1)}
            onClose={() => setViewing(undefined)}
          />
        ) : null}
      </div>
    </div>
  )
}

/**
 * 放大态的提示词框（⤢）——同一个控制台，换了个更大的壳。
 *
 * 里面装的还是那三行：**材料行 + 输入框 + 底栏**，由同一个 `ComposerBody` 画出来。
 * 所以「放大之后布局与缩小态一致」不是靠两处对齐出来的，而是**根本没有第二套布局**：
 * 字号、行高、内边距、取材 chips、模型席位、发送钮，两边逐字同一份。
 *
 * 两处按钮各站各的地盘：行内那条带子右上角是〔放大〕（⤢）——它开合的是带子；这里头
 * 部右上角是〔缩小〕（⤡）——它开合的是**这个壳**，所以站在壳的头上，不必混进那三行
 * 里（材料行因此与行内逐项相同，一颗多余的按钮都不多）。
 *
 * 退出的三条路各自独立：头部那颗〔缩小〕、Esc、点遮罩。发送之后同样交回画布——卡片亮
 * 起流光，产物落在卡面上。
 */
function PromptModal(props: {
  card: BoardCard
  summary: CardSummary | undefined
  materials: readonly MaterialRef[]
  others: readonly BoardCard[]
  bridge: CanvasBridge
  draft: string
  onDraftChange: (text: string) => void
  t: Translate
  onAddMaterial: (sourceId: string) => void
  onReferenceMaterials: () => void
  onDropMaterial: (sourceId: string) => void
  onClose: () => void
  onSend: () => void
}) {
  const {
    card, summary, materials, others, bridge, draft, onDraftChange, t,
    onAddMaterial, onReferenceMaterials, onDropMaterial, onClose, onSend,
  } = props

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
          {/* 把壳收回去的那颗（⤡）：它管的是这个弹窗的开合，所以站在壳的头上——三行里
              因此一颗多余的按钮都没有（那边右上角那颗 ⤢ 管的是带子，不是壳）。 */}
          <button
            className="dsh-canvas-chipbtn dsh-canvas-promptmodal-shrink"
            onClick={onClose}
            title={t('canvas.composer.shrink')}
            aria-label={t('canvas.composer.shrink')}
          >
            ⤡
          </button>
        </div>
        <div className="dsh-canvas-promptmodal-body">
          <ComposerBody
            t={t}
            bridge={bridge}
            card={card}
            summary={summary}
            materials={materials}
            others={others}
            draft={draft}
            onDraftChange={onDraftChange}
            onSend={onSend}
            onAddMaterial={onAddMaterial}
            onReferenceMaterials={onReferenceMaterials}
            onDropMaterial={onDropMaterial}
            fullscreen
          />
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
  if (extension === 'webapp') {
    // 应用：一个窗口里拼着组件方块——web 组件拼装成的应用，不是单页文档。
    return (
      <svg {...shared}>
        <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
        <path d="M2 5.2h12" />
        <rect x="4.4" y="7.2" width="3.2" height="3.2" rx="0.6" />
        <path d="M9.4 7.6h2.6M9.4 9h2.6M4.4 12h7.6" />
      </svg>
    )
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
