/**
 * dsh-canvas — what appears around a selected card.
 *
 * Two pieces, both following the card: the action pill just above it, and the
 * card's control strip just below it. The strip carries what the card cannot
 * say on its own — the prompt box, the materials that feed it, the model that
 * runs its turns, and the way into the fullscreen editor (⤢).
 *
 * The prompt box is a mirror as much as an editor: with nothing of the user's
 * own in it, it holds that card's latest message from the user, so the prompt a
 * card was most recently asked with is the one sitting in front of them to
 * refine. See `ComposerDraft` in `canvas-view.tsx` for how that is resolved
 * without the box fighting the user's typing. The ⤢ modal edits that same draft
 * at full size — one box at two sizes, not two boxes.
 *
 * The strip has two sizes, too: the grip in its bottom-right corner drags it
 * bigger. What grows is room, not looks — the type, the gaps, the radius and
 * the three rows are the same at every size (see `composer-size.ts`), so a
 * bigger strip is the same console with more place to write, never a different
 * one. It grows out of the card's centre line, both sides at once: a wider box
 * is still *that* card's box, still centred under it. It stays in memory for
 * the session, keyed per card: not a property of the board, just how this user
 * happens to like this card's box right now.
 *
 * The material row is how one node consumes another node's artifact: the ⊕
 * menu lists the board's other cards, and picking one declares the source edge
 * and pushes its digest into the session in the same gesture. Each chip is one
 * declared edge and carries the delete button at its top-right: a chip and an
 * edge are the same thing, so removing a chip removes exactly the relationship
 * it stands for.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { formatFileMention } from '../../core/artifact/file-reference.ts'
import { isDirectTextKind } from '../../core/artifact/kind-registry.ts'
import { referenceTypeOf, scanFileMentions } from '../../core/artifact/prompt-blocks.ts'
import type { ReferenceFacts, ReferenceType } from '../../core/artifact/prompt-blocks.ts'
import type { BoardCard, CardSummary } from '../../types.ts'
import type { CanvasBridge, CatalogModel, ModelCatalog } from '../wire/bridge.ts'
import {
  nodeTypeOf,
  recallModel,
  rememberModel,
  selectionOf,
  type ModelChoice,
  type ModelSelectionView,
} from '../wire/model-memory.ts'
import type { Translate } from '../ui/locales.ts'
import { PromptInput } from '../ui/prompt-input.tsx'
import type { PromptInputHandle } from '../ui/prompt-input.tsx'
import { composerSizeOf, resizedComposerSize, type ComposerSize } from './composer-size.ts'

/** `@` 候选最多摆几枚：提示词框是个小地方，够挑就行，翻找交给继续打字。 */
const REFERENCE_LIMIT = 8

/**
 * 菜单里的一枚候选——它就是提示词里那枚 `@路径` 的由来。
 *
 * `mention` 里那串字**已经过宿主记号语法的安检**（`formatFileMention`）：带不动的路径
 * （含引号或控制字符）宁可不出现，也不插一枚读不出来的引用进去。
 */
interface ReferenceOption {
  /** 工作区相对路径（卡片 id 就是它）。 */
  path: string
  mention: string
  /** 显示名：路径最后一段（与取材 chips 同一套写法）。 */
  label: string
  /** 引用类型——按扩展名定（`referenceTypeOf`），决定标签的长相。 */
  type: ReferenceType
  /** 这张卡已经取材的来源，还是画布上别的卡片。 */
  fromMaterial: boolean
}

/** 类型的中文名，给候选行右侧那枚小注用（与标签自己的长相是同一件事）。 */
const REFERENCE_TYPE_LABEL = {
  code: 'canvas.ref.type.code',
  image: 'canvas.ref.type.image',
  video: 'canvas.ref.type.video',
  audio: 'canvas.ref.type.audio',
  mark: 'canvas.ref.type.mark',
  region: 'canvas.ref.type.region',
} as const

/**
 * `@` 能引用哪些东西：**这张卡已有的取材来源在前**（它们的关系是板上画着的），画布其余
 * 卡片在后。两处去重、按查询过滤，再截到上限。
 *
 * 与 ⊕ 菜单同一份数据、同一个念头：能引用的是**文件**，而卡片 id 就是它在工作区里的路径。
 * 区别只在动作——⊕ 是替本卡会话把上游的路径报一遍，这里是往提示词里插一枚引用。
 */
function referenceOptions(
  materials: readonly MaterialRef[],
  others: readonly BoardCard[],
  query: string,
): ReferenceOption[] {
  const seen = new Set<string>()
  const all: ReferenceOption[] = []
  const add = (path: string, fromMaterial: boolean): void => {
    if (seen.has(path)) return
    seen.add(path)
    const mention = formatFileMention({ path, kind: 'file' })
    if (mention === undefined) return
    all.push({
      path,
      mention,
      label: path.split('/').pop() ?? path,
      type: referenceTypeOf(path),
      fromMaterial,
    })
  }
  for (const entry of materials) add(entry.cardId, true)
  for (const other of others) add(other.id, false)
  const needle = query.trim().toLowerCase()
  if (needle === '') return all.slice(0, REFERENCE_LIMIT)
  return all.filter((option) => option.mention.toLowerCase().includes(needle)).slice(0, REFERENCE_LIMIT)
}

/**
 * 一次最多取几枚缩略图。
 *
 * 缩略图走的是读产物那条通道（媒体是**整份** data URL，插件这条线上没有流、也没有资源
 * 地址），所以它不能敞开取：一张 4 MB 的 PNG 过来就是 5 MB 的 base64。给看得见的那几枚
 * 取（草稿里已引用的 + 菜单候选），一批几枚，取不到就退回图标——**缩略图是锦上添花，
 * 不是引用的前提**。
 */
const THUMBNAIL_BATCH = 4

/**
 * One declared material edge of the selected card, as its chip renders it.
 *
 * A chip is an edge, and only an edge: the strip lists exactly the direct edges
 * the board reports, so every chip's delete button has an edge of its own to
 * remove, and each is joined to its digest for the tooltip. (The digests are a
 * convenience — one that could not be read leaves the tooltip empty, not the
 * chip missing.)
 */
export interface MaterialRef {
  /** Storage id of the edge — the handle `unlinkSource` takes. */
  id: string
  /** The upstream card id. */
  cardId: string
  /** Bounded digest of the upstream artifact; `''` when it could not be read. */
  summary: string
}

/** Props of the selected-card cluster. */
export interface CardSelectionProps {
  bridge: CanvasBridge
  card: BoardCard
  summary: CardSummary | undefined
  /** This card's declared upstream edges, one chip each. */
  materials: readonly MaterialRef[]
  /** Every other card on the board — what the add-material menu offers. */
  others: readonly BoardCard[]
  t: Translate
  /** What the prompt box holds: the user's unsent edit, or the card's latest message. */
  draft: string
  /** Make the card's session current so its conversation becomes the main surface. */
  onChat: () => void
  /** Open a text node's artifact in the viewer's editor — 手动输入. */
  onManualEdit: () => void
  /** Export in the kind's first supported format. */
  onExport: () => void
  /** Take the card off the board; the file stays. */
  onRemove: () => void
  /** Declare an edge from `sourceId` and push its digest into the session. */
  onAddMaterial: (sourceId: string) => void
  /**
   * Hand this card's materials over as file references.
   *
   * A different channel from {@link CardSelectionProps.onAddMaterial}, and its
   * own entry rather than a second meaning for the same click: that one picks a
   * card and pushes a **digest** of its artifact into this conversation, while
   * this one names the upstream files that are *already* sourced — `@paths` the
   * model reads when it wants them, no content copied. See
   * `canvas_reference_files`.
   */
  onReferenceMaterials: () => void
  /** Delete the material edge carrying this storage id. */
  onDropMaterial: (sourceId: string) => void
  /** Open the prompt modal (⤢) — the same draft, at full size. */
  onExpand: () => void
  /** Record the user's text without sending it. */
  onDraftChange: (text: string) => void
  /** Send the draft as the card session's next turn. */
  onSend: () => void
  /**
   * Canvas zoom.
   *
   * The strip sits inside the `scale(zoom)` layer, so every pointer distance
   * has to be divided by this before it becomes a size: at 200% the grip must
   * still follow the cursor one-to-one, not twice as fast. Same reason
   * `CardTile` takes it.
   */
  zoom: number
  /** What this card's strip was dragged to; `undefined` = never dragged. */
  size: ComposerSize | undefined
  /** Remember the size a drag ended on. */
  onResize: (size: ComposerSize) => void
}

/**
 * The action pill's translation keys, in display order.
 *
 * Only the actions with no other home sit here. Opening the artifact belongs to
 * the card itself (double-click → fullscreen viewer, which carries its own way
 * into the sidebar), and declaring a material edge belongs to the card's ports
 * and the composer's ⊕ menu — repeating either as a pill button just put a
 * second, weaker door next to the real one. 手动输入 is the exception that
 * proves the rule: editing a text node by hand is not the same act as opening
 * it, and nothing else on the board offers it — the pill is its only entry, and
 * it opens the viewer *in its editor* rather than at the top of the file.
 */
const PILL = [
  ['canvas.action.chat', 'onChat'],
  ['canvas.action.manual', 'onManualEdit'],
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
 * 右下角那三道斜杠——拖它就是把控制带放大。
 *
 * 三道（而不是一个箭头）是「可拖」这件事最短的一句话：系统文件管理器、终端、各种
 * 编辑器都这么画，用户不用学。颜色吃 `currentColor`，所以在亮暗两套配色下都跟着把手
 * 自己的令牌走。
 */
function GripIcon() {
  const tick = { stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', fill: 'none' } as const
  return (
    <svg viewBox="0 0 11 11" width="11" height="11" aria-hidden="true" focusable="false">
      <path d="M10 3.2L3.2 10" {...tick} />
      <path d="M10 6.4L6.4 10" {...tick} />
      <path d="M10 9.6L9.6 10" {...tick} />
    </svg>
  )
}

/**
 * 控制带的那三行：材料行、输入框、底栏。**一处写、两处用**。
 *
 * 放大（⤢）不是换一副界面，只是同一个控制台换了个外壳：行内那条带子与放大后的弹窗
 * 里装的都是这三行，所以这里只写一份——「放大之后布局与缩小态一致」是结构给的，而不
 * 是靠两处手抄对齐。字号、行高、内边距、圆角同样只有一份：放大态只是外壳更高、输入框
 * 占得更多（`data-fullscreen` 那两条 flex 规则），不是换一套更大的字。
 *
 * 材料行右上角那颗〔放大〕（⤢）**只有行内有**：它管的是这条带子的开合，长在带子里。
 * 放大之后要把壳收回去的那颗叫〔缩小〕（⤡），它站在**弹窗头部右上角**——管的是壳的
 * 开合，所以站在壳的头上，而不是混进这碗三行里。
 */
export interface ComposerBodyProps {
  t: Translate
  bridge: CanvasBridge
  card: BoardCard
  /** What this card *is* — the model memory is keyed by it, not by the card. */
  summary: CardSummary | undefined
  /** This card's declared upstream edges, one chip each. */
  materials: readonly MaterialRef[]
  /** Every other card on the board — what the add-material menu offers. */
  others: readonly BoardCard[]
  draft: string
  onDraftChange: (text: string) => void
  onSend: () => void
  onAddMaterial: (sourceId: string) => void
  onReferenceMaterials: () => void
  onDropMaterial: (sourceId: string) => void
  /**
   * 材料行右上角那颗〔放大〕（⤢）——**只有行内有**。
   *
   * 它开合的是这条带子，所以长在带子里；放大态那颗〔缩小〕不在这儿，它站在弹窗头部
   * 右上角（见 `PromptModal`），因为那颗开合的是**外壳**。一颗按钮管一个方向、各站各
   * 的地盘，用户不必在别处再替「退回去」另找一条路。
   */
  corner?: { readonly glyph: string; readonly label: string; readonly onClick: () => void }
  /** 放大态：输入框填满外壳（`data-fullscreen`），并接住焦点。 */
  fullscreen?: boolean
  /** 行内拖出来的输入框高（画布单位）；没拖过就没有。 */
  inputHeight?: number
  /**
   * 交给调用方的一只把手：量输入框的高（把手起笔那一下要拿它当起点）。
   *
   * 它也是这一侧插引用要用的那只——`PromptInput` 把「量高、摆光标、插一枚引用」三件事
   * 收成一个 handle，正文换成 `contenteditable` 之后调用方本来也不该再拿 `textarea` 的 ref。
   */
  inputRef?: MutableRefObject<PromptInputHandle | null>
  /** 右下角那颗把手——**只有行内有**：弹窗的大小由外壳说了算，不给拖。 */
  grip?: ReactNode
}

export function ComposerBody(props: ComposerBodyProps) {
  const {
    t, bridge, card, summary, materials, others, draft, onDraftChange, onSend,
    onAddMaterial, onReferenceMaterials, onDropMaterial, corner, fullscreen, inputHeight, inputRef, grip,
  } = props
  const [menu, setMenu] = useState(false)
  /** 输入框里光标前那半枚 `@查询`；`null` = 没在打引用。菜单开不开就看它。 */
  const [query, setQuery] = useState<string | null>(null)
  /** 候选里高亮到第几枚（键盘上下键走）。 */
  const [picked, setPicked] = useState(0)
  /** 输入框那只把手。调用方给了槽位就用它，没给（放大态）就自己揣一只。 */
  const own = useRef<PromptInputHandle | null>(null)
  const slot = inputRef ?? own
  const options = useMemo(
    () => (query === null ? [] : referenceOptions(materials, others, query)),
    [materials, others, query],
  )
  /** 高亮那一枚；候选变短时收回界内，免得越界。 */
  const at = options.length === 0 ? 0 : Math.min(picked, options.length - 1)
  /**
   * 已经取回来的缩略图，按路径记着。
   *
   * 按路径而不是按卡片：同一张图被两张卡引用时就只取一次，而引用它的那句话在哪张卡上
   * 都一样该看见它。
   */
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const pendingThumbs = useRef(new Set<string>())
  /**
   * 该给谁取缩略图：**草稿里已经引用的**（用户正在看的那几枚标签）+ **菜单候选里的**。
   *
   * 只挑图片：视频的 data URL 是整段片子，取来当 20px 的小图是拿几十 MB 换几十个像素，
   * 不值——它照样有自己的类型图标。
   */
  const wantedKey = useMemo(() => {
    const paths = new Set<string>()
    for (const segment of scanFileMentions(draft)) {
      if (segment.kind === 'file' && referenceTypeOf(segment.path) === 'image') paths.add(segment.path)
    }
    for (const option of options) {
      if (option.type === 'image') paths.add(option.path)
    }
    return [...paths].join('\n')
  }, [draft, options])

  useEffect(() => {
    const missing = (wantedKey === '' ? [] : wantedKey.split('\n'))
      .filter((path) => thumbs[path] === undefined && !pendingThumbs.current.has(path))
      .slice(0, THUMBNAIL_BATCH)
    if (missing.length === 0) return undefined
    let cancelled = false
    for (const path of missing) pendingThumbs.current.add(path)
    void (async () => {
      const loaded: [string, string][] = []
      for (const path of missing) {
        try {
          const view = await bridge.readArtifact(card.project, path)
          if (view.dataUrl !== '') loaded.push([path, view.dataUrl])
        } catch {
          // 读不到就没有缩略图（图标照样画）：它是锦上添花，不是引用的前提。
        } finally {
          pendingThumbs.current.delete(path)
        }
      }
      if (cancelled || loaded.length === 0) return
      setThumbs((now) => ({ ...now, ...Object.fromEntries(loaded) }))
    })()
    return () => {
      cancelled = true
    }
  }, [bridge, card.project, thumbs, wantedKey])

  /** 交给输入框的「文件之外的事实」：今天只有缩略图这一项（行号还没有哪个界面知道）。 */
  const refs = useMemo<Record<string, ReferenceFacts>>(() => {
    const facts: Record<string, ReferenceFacts> = {}
    for (const [path, url] of Object.entries(thumbs)) facts[path] = { thumbnail: url }
    return facts
  }, [thumbs])
  /** 选中一枚：插进输入框（插完查询那半枚已被顶掉），菜单收起。 */
  const choose = (option: ReferenceOption | undefined): void => {
    if (option === undefined) return
    slot.current?.insertMention(option.mention)
    setQuery(null)
    setPicked(0)
  }
  const canSend = draft.trim() !== ''
  // The memory is keyed by what the card *is*, not by which card it is: that is
  // what lets the next node of the same type start from the last choice.
  const nodeType = nodeTypeOf(card, summary)

  return (
    <>
      <div className="dsh-canvas-composer-materials">
        {materials.map((entry) => (
          <span className="dsh-canvas-chip" key={entry.id} title={entry.summary === '' ? entry.cardId : entry.summary}>
            <span className="dsh-canvas-chip-label">{entry.cardId.split('/').pop() ?? entry.cardId}</span>
            <button
              className="dsh-canvas-chipdrop"
              title={t('canvas.composer.drop')}
              aria-label={t('canvas.composer.drop')}
              onClick={() => onDropMaterial(entry.id)}
            >
              ×
            </button>
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
              {/* 文件引用不是「挑一张卡片」：它交的是本卡片**已有**取材来源的 @路径，
                  所以它是一枚独立入口，而不是给每一行再加一个更弱的按钮。 */}
              <button
                className="dsh-canvas-row"
                onClick={() => {
                  setMenu(false)
                  onReferenceMaterials()
                }}
              >
                {t('canvas.composer.reference')}
                <span className="dsh-canvas-row-meta">{t('canvas.composer.referenceMeta')}</span>
              </button>
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
        {corner === undefined ? null : (
          <button
            className="dsh-canvas-chipbtn dsh-canvas-composer-corner"
            onClick={corner.onClick}
            title={corner.label}
            aria-label={corner.label}
          >
            {corner.glyph}
          </button>
        )}

        {/* `@` 候选：在输入框里打一个 `@`，光标前那半枚查询就是过滤条件（内容随打字变，
            所以菜单不用自己收——查询一散它就散了）。候选是**能引用的文件**：这张卡已经
            取材的上游在前、画布别的卡片在后，与 ⊕ 菜单同一份数据。选中插进去的是一枚
            **引用标签**，而它落到提示词里的仍只是那串 `@路径`——发出去的逐字不变。 */}
        {query === null ? null : (
          <div className="dsh-canvas-menu dsh-canvas-refmenu" role="listbox" aria-label={t('canvas.composer.reference')}>
            {options.length === 0 ? (
              <span className="dsh-canvas-composer-menuempty">{t('canvas.composer.noReference')}</span>
            ) : (
              options.map((option, index) => (
                <button
                  className="dsh-canvas-row"
                  key={option.mention}
                  role="option"
                  aria-selected={index === at}
                  data-at={index === at ? 'true' : undefined}
                  title={option.fromMaterial ? t('canvas.composer.referenceMeta') : option.path}
                  // 按住不夺焦点：这一下点的是候选，光标该留在框里（松开才是选）。
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  {thumbs[option.path] === undefined ? null : (
                    <img className="dsh-canvas-refthumb" src={thumbs[option.path]} alt="" />
                  )}
                  {option.label}
                  <span className="dsh-canvas-row-meta">{t(REFERENCE_TYPE_LABEL[option.type])}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* 输入框是公共件 PromptInput：`@文件` 记号在这里画成一枚引用标签（图标 + 文件名 +
          可选行号），行内与放大弹窗共用这一个（见 ../ui/prompt-input.tsx）。 */}
      <PromptInput
        className="dsh-canvas-composer-input"
        data-fullscreen={fullscreen === true ? 'true' : undefined}
        handleRef={slot}
        autoFocus={fullscreen === true}
        data-sized={inputHeight === undefined ? undefined : 'true'}
        style={inputHeight === undefined ? undefined : { height: `${inputHeight}px` }}
        placeholder={t('canvas.composer.placeholder')}
        value={draft}
        onChange={onDraftChange}
        refs={refs}
        onQueryChange={(next) => {
          setQuery(next)
          setPicked(0)
        }}
        onKeyDown={(event) => {
          // 菜单开着时方向键与 Enter 归菜单；Esc 只收菜单（这一下不该顺手把弹窗关了），
          // 输入法正在选字时那一下 Enter 也不算选中。
          if (query !== null && !event.nativeEvent.isComposing) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (options.length > 0) {
                const step = event.key === 'ArrowDown' ? 1 : -1
                setPicked((now) => (Math.min(now, options.length - 1) + step + options.length) % options.length)
              }
              return
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault()
              choose(options[at])
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setQuery(null)
              return
            }
          }
          // ⌘/Ctrl + Enter sends; a bare Enter belongs to the text, because a
          // prompt is usually several lines. Same chord in both sizes.
          if (event.key === 'Enter' && !event.shiftKey && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            if (canSend) onSend()
          }
        }}
      />

      <div className="dsh-canvas-composer-foot">
        <ModelPicker
          bridge={bridge}
          projectId={card.project}
          cardId={card.id}
          sessionId={card.sessionId}
          kind={nodeType}
          t={t}
        />
        <span className="dsh-canvas-spacer" />
        <button className="dsh-canvas-chipbtn" data-primary="true" disabled={!canSend} onClick={onSend}>
          {t('canvas.composer.send')}
        </button>
      </div>

      {grip}
    </>
  )
}

/**
 * Render the action pill and the card's control strip for one selected card.
 *
 * The strip is the card's whole console: the prompt box and its send button,
 * the materials feeding it (chips with their own delete buttons, then ⊕ to add
 * one), the way into the fullscreen editor (⤢), and the model running its
 * turns. The card face is where progress and the artifact are read.
 */
export function CardSelection(props: CardSelectionProps) {
  const {
    bridge, card, summary, materials, others, t, draft, onAddMaterial, onReferenceMaterials, onDropMaterial,
    onExpand, onDraftChange, onSend, zoom, size, onResize,
  } = props

  // 手里正拖着的那一份尺寸。拖动期间它是活的、由这里说了算（不然每动一下都要往画布
  // 塞一次状态），放手才落进记忆——与卡片自己的拖动同一个套路（见 `card-tile.tsx`）。
  const [dragged, setDragged] = useState<ComposerSize | undefined>(undefined)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<PromptInputHandle | null>(null)
  const gripDrag = useRef<{ x: number; y: number; start: ComposerSize } | undefined>(undefined)
  const live = dragged ?? size

  /**
   * 握上右下角那颗把手。
   *
   * 起笔先量一次「现在多大」——那是这一笔的起点：第一下拖动因此不会让控制带跳一下，
   * 拖多少涨多少。量到的是屏幕像素、存的是画布单位，所以量完立刻除一次 zoom。
   */
  const gripDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return
    // 这一下是把手的事：不冒泡（画布把空白处的一按读成「取消选择」）、也不让浏览器
    // 把它当成开始选字。
    event.stopPropagation()
    event.preventDefault()
    const box = boxRef.current?.getBoundingClientRect()
    const input = inputRef.current?.el?.getBoundingClientRect()
    if (box === undefined || input === undefined) return
    gripDrag.current = {
      x: event.clientX,
      y: event.clientY,
      start: composerSizeOf(box.width, input.height, zoom),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const gripMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const started = gripDrag.current
    if (started === undefined) return
    setDragged(
      resizedComposerSize(
        started.start,
        { dx: event.clientX - started.x, dy: event.clientY - started.y },
        zoom,
      ),
    )
  }

  /** 放手：这一笔定下来，记进卡片的那份尺寸里。 */
  const gripUp = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const started = gripDrag.current
    gripDrag.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (started === undefined) return
    const landed = dragged
    setDragged(undefined)
    // 按下又直接放开＝一次误触，不该把控制带改成某个尺寸。
    if (landed !== undefined) onResize(landed)
  }

  /** 这一笔被外面打断了（系统抢走指针、手势被取消）：原样退回，不落进记忆。 */
  const gripCancel = () => {
    gripDrag.current = undefined
    setDragged(undefined)
  }

  const hasExport = (summary?.kind ?? '') !== 'folder'
  // 手动输入 是文本节点的门：编辑器整篇写回文件，所以只在「产物就是它自己的文字」的
  // 形态上出现——文件夹、图片、Deck 都没有可打字的地方，给它们一枚按钮只是一枚点了没
  // 反应（或更糟：把别的形态覆盖成文本）的按钮。这个事实住在宿主的 kind 表上
  // （`isDirectTextKind`），弹窗里的编辑面读的是同一份，两边不会各说各话。
  const canEditText = isDirectTextKind(summary?.kind ?? '')

  return (
    <>
      <div className="dsh-canvas-toolbar is-horizontal" style={{ left: `${card.position.x + 100}px`, top: `${card.position.y - 44}px`, transform: 'translateX(-50%)' }}>
        {PILL.map(([key, handler]) => {
          if (key === 'canvas.action.export' && !hasExport) return null
          if (key === 'canvas.action.manual' && !canEditText) return null
          return (
            <button className="dsh-canvas-chipbtn" key={key} onClick={props[handler]}>
              {t(key)}
            </button>
          )
        })}
      </div>

      {/*
        锚点：控制带从卡片的中心起算，**钉住的也是中心**（`translateX(-50%)`，卡片宽
        200 ⇒ 与 `position.x + 100` 是同一条竖线）。放大时左右两侧对称地长，输入区因
        此始终在节点正下方——这是它的归属，拖多大都不改。

        代价落在右下角那颗把手上：同一个鼠标位移只有一半落在右沿（另一半去了左沿），
        所以宽要按两倍吃位移，把手才跟得住光标（`composer-size.ts` 的
        `CENTERED_WIDTH_GAIN`）。高度没有这一层：锚在上沿，向下长。
      */}
      <div
        className="dsh-canvas-overlay dsh-canvas-composer"
        ref={boxRef}
        data-sized={live === undefined ? undefined : 'true'}
        data-resizing={dragged === undefined ? undefined : 'true'}
        style={{
          left: `${card.position.x + 100}px`,
          top: `${card.position.y + 156}px`,
          transform: 'translateX(-50%)',
          width: live === undefined ? undefined : `${live.width}px`,
        }}
      >
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
          corner={{ glyph: '⤢', label: t('canvas.composer.enlarge'), onClick: onExpand }}
          inputHeight={live?.inputHeight}
          inputRef={inputRef}
          grip={
            /* 右下角那颗把手：拖它就是把这条带子放大。它贴着外角（与 chip 的删除钮同一套
               做法），所以不占带里的位置、也不跟发送钮抢那一下点击。放大态没有它——弹窗的
               大小由外壳说了算。 */
            <span
              className="dsh-canvas-composer-grip"
              role="separator"
              aria-label={t('canvas.composer.resize')}
              title={t('canvas.composer.resize')}
              onPointerDown={gripDown}
              onPointerMove={gripMove}
              onPointerUp={gripUp}
              onPointerCancel={gripCancel}
            >
              <GripIcon />
            </span>
          }
        />
      </div>
    </>
  )
}
