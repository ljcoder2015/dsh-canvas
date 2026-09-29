/**
 * dsh-canvas — 模型席位那颗下拉框。
 *
 * 两处要用同一个东西：卡片控制带底栏（`card-overlay.tsx`）与设计预览的 AI 标签页
 * （`design-panels.tsx`）。两处说的都是同一句话——**这张卡的会话下一次请求用哪个模型**
 * ——所以只有这一份实现：读同一份目录、走同一条会话选择投影、写同一个按类型记住的偏好。
 * 复制一份出来就会有两套「记忆」的写法，而记忆这种东西一旦分裂，用户看到的就是「在这里
 * 选过的模型，到那边不认」。
 *
 * 它只认 {@link ModelBridge} 这四件事：目录、会话选择投影、写选择、开会话。卡片那边给的是
 * 整个 `CanvasBridge`，弹窗那边给的是产物弹窗的桥（同一批方法的结构型），两处都不必多写
 * 一层适配。
 */
import { useEffect, useState } from 'react'
import type { CatalogModel, ModelCatalog } from '../wire/bridge.ts'
import {
  recallModel,
  rememberModel,
  selectionOf,
  type ModelChoice,
  type ModelSelectionView,
} from '../wire/model-memory.ts'
import type { Translate } from './locales.ts'

/**
 * 席位需要的全部外部能力。
 *
 * `openSession` 返回什么不作要求，只要有 `sessionId`——这里只用它把「会话已经开着」这件
 * 事变成一个 id（见 {@link ModelPicker} 的补种那一段）。
 */
export interface ModelBridge {
  /** The Host-generation model catalog, shared by every session's picker. */
  modelCatalog(): Promise<ModelCatalog>
  /** Open, or re-attach, the Agent session bound to a card. */
  openSession(projectId: string, cardId: string): Promise<{ sessionId: string }>
  /** Read one session's model-selection projection. */
  readModelSelection(sessionId: string): Promise<ModelSelectionView | undefined>
  /** Write a durable per-session model selection. */
  selectModel(sessionId: string, provider: string, model: string): Promise<void>
}

/**
 * The Host catalog, loaded at most once per client page and shared by every
 * seat. A failed load clears the cache so the next open retries.
 */
let catalogCache: Promise<ModelCatalog> | undefined

function loadCatalog(bridge: ModelBridge): Promise<ModelCatalog> {
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
 * What the seat can say about the session's model.
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
 * The model seat: one pill that opens the catalog, for one card's session.
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
export function ModelPicker({
  bridge,
  projectId,
  cardId,
  sessionId,
  kind,
  t,
}: {
  bridge: ModelBridge
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

  const pick = (provider: string, model: CatalogModel): void => {
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