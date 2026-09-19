/**
 * dsh-canvas — the browser half's call surface.
 *
 * The gateway hands back a `RemoteResult` envelope on every call, and every
 * component here wants either a value or an exception. This module is that one
 * translation point: it wraps the two mounted namespaces in plain async
 * functions, so no component carries `result.ok` plumbing and no failure
 * message is invented twice.
 *
 * It also owns the lifetime rule the components cannot: one `AbortSignal` per
 * plugin fiber, threaded through every call, so unloading the plugin cancels
 * in-flight board reads instead of letting them resolve into a dead tree.
 */
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ArrangeStrategy,
  ArtifactView,
  BoardCard,
  BoardSnapshot,
  BoardSource,
  CardSummary,
  ExportFormat,
  ExportResult,
  FolderEntry,
  LastPrompt,
  Note,
  PendingIntent,
  Point,
  Project,
  ProjectBinding,
  SessionBinding,
  SourceChain,
  StyleProfile,
  Viewport,
  WriteResult,
} from '../types.ts'
import type { CanvasFace, CardFace } from './remote.ts'
import type { ModelSelectionView } from './model-memory.ts'

/** How long a session-list read is reused for the model projection lookup. */
const SESSION_LIST_TTL_MS = 2_000

/** A failed canvas call, carrying the protocol's stable `<domain>/<reason>` code. */
export class CanvasRemoteError extends Error {
  /** The protocol's code-discriminated failure, kept whole for `details` narrowing. */
  readonly failure: RemoteFailure

  /**
   * @param failure - the failure the gateway returned.
   */
  constructor(failure: RemoteFailure) {
    super(failure.message)
    this.name = 'CanvasRemoteError'
    this.failure = failure
  }

  /** The stable failure code, e.g. `canvas/project-not-found`. */
  get code(): string {
    return this.failure.code
  }
}

/** Resolve the envelope to its value, or throw the failure it carried. */
async function unwrap<T>(call: Promise<RemoteResult<T>>): Promise<T> {
  const result = await call
  if (result.ok) return result.value
  throw new CanvasRemoteError(result.error)
}

// ── the host session namespace's model face ────────────────────────────────
//
// The card composer's model picker reads the Host-generation catalog and
// writes a per-session durable selection through the framework's own
// `session` Remote namespace (`dsh-api-session-controller`). The face is
// declared locally and minimally: that package is not a dependency here, and
// its global Typert augmentation is not part of this program.

/** One model inside a provider group of the Host catalog. */
export interface CatalogModel {
  readonly id: string
  readonly name: string
  readonly description?: string
}

/** One provider's slice of the Host catalog. */
export interface CatalogGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly CatalogModel[]
}

/** The Host-generation model catalog, as the picker renders it. */
export interface ModelCatalog {
  /** The selection unconfigured sessions use. */
  readonly default: { readonly provider: string; readonly model: string }
  readonly groups: readonly CatalogGroup[]
}

/** One row of the host's session list, as far as this bridge reads it. */
interface SessionListRow {
  readonly sessionId: string
  /** The host's projection values for that row; `modelSelection` is the one read here. */
  readonly projections?: { readonly values?: Record<string, unknown> }
}

/** Minimal view of the mounted `session` Remote namespace. */
interface SessionModelFace {
  modelCatalog(): Promise<RemoteResult<ModelCatalog>>
  selectModel(request: {
    sessionId: string
    provider: string
    model: string
    reasoningEffort?: string
  }): Promise<RemoteResult<unknown>>
  list(request: { cursor?: string }, signal?: AbortSignal): Promise<RemoteResult<{ items: readonly SessionListRow[] }>>
}

/** One card located on the board, with the project that owns it. */
export interface LocatedCard {
  project: Project
  card: BoardCard
}

/**
 * The plugin's whole call surface, unwrapped.
 *
 * Grouped by the namespace it wraps rather than by the screen that uses it:
 * the board and the card panel both read cards, and a grouping by caller would
 * have duplicated every method.
 *
 * The namespaces arrive after `ctx.remote.$mount` resolves, which is later than
 * the seats are registered, so the bridge is constructed empty and attached to.
 * A call made before the mount reports that plainly instead of failing with a
 * `TypeError` about an undefined property.
 */
export class CanvasBridge {
  #canvas: CanvasFace | undefined
  #card: CardFace | undefined
  #session: SessionModelFace | undefined
  /** Last session-list read, so a burst of composer mounts is one wire call. */
  #sessionList: { at: number; rows: readonly SessionListRow[] } | undefined

  /** @param signal - aborted when the plugin unloads; every call carries it. */
  constructor(private readonly signal: AbortSignal) {}

  /**
   * Hand the mounted namespaces to the bridge.
   * @param canvas - the mounted `canvas` namespace.
   * @param card - the mounted `card` namespace.
   * @param session - the framework's `session` namespace, when mounted; only
   *   the model picker consults it, so its absence degrades that one control.
   */
  attach(canvas: CanvasFace, card: CardFace, session?: SessionModelFace): void {
    this.#canvas = canvas
    this.#card = card
    this.#session = session
  }

  /** The `canvas` namespace, or a clear failure while it is not mounted. */
  private get canvas(): CanvasFace {
    if (this.#canvas === undefined) throw new Error('dsh-canvas: the canvas Remote namespace is not mounted yet')
    return this.#canvas
  }

  /** The `card` namespace, or a clear failure while it is not mounted. */
  private get card(): CardFace {
    if (this.#card === undefined) throw new Error('dsh-canvas: the card Remote namespace is not mounted yet')
    return this.#card
  }

  // ── canvas: projects ──────────────────────────────────────────────────────

  /** All canvas projects, in host order. */
  listProjects(): Promise<Project[]> {
    return unwrap(this.canvas.listProjects(this.signal))
  }

  /** Bind a directory to a new project and run the initial artifact scan. */
  createProject(name: string, path: string): Promise<ProjectBinding> {
    return unwrap(this.canvas.createProject(name, path, this.signal))
  }

  /** Forget a project. Files on disk are never touched. */
  removeProject(projectId: string): Promise<boolean> {
    return unwrap(this.canvas.removeProject(projectId, this.signal))
  }

  /** List the directories the picker may descend into or select. */
  listFolders(path: string): Promise<FolderEntry[]> {
    return unwrap(this.canvas.listFolders(path, this.signal))
  }

  // ── canvas: board ─────────────────────────────────────────────────────────

  /** Everything needed to paint one board. */
  readBoard(projectId: string): Promise<BoardSnapshot> {
    return unwrap(this.canvas.readBoard(projectId, this.signal))
  }

  /** Record where the user left the canvas. */
  setViewport(projectId: string, viewport: Viewport): Promise<Project> {
    return unwrap(this.canvas.setViewport(projectId, viewport, this.signal))
  }

  /** Replace the project's style profile. */
  setStyle(projectId: string, style: StyleProfile): Promise<StyleProfile> {
    return unwrap(this.canvas.setStyle(projectId, style, this.signal))
  }

  /** Commit one card's position after a drag. */
  moveCard(projectId: string, cardId: string, position: Point): Promise<BoardCard> {
    return unwrap(this.canvas.moveCard(projectId, cardId, position, this.signal))
  }

  /** Re-seat every card under one strategy. */
  arrange(projectId: string, strategy: ArrangeStrategy): Promise<BoardSnapshot> {
    return unwrap(this.canvas.arrange(projectId, strategy, this.signal))
  }

  // ── canvas: source edges ──────────────────────────────────────────────────

  /** Declare that `downstream` takes its material from `upstream`. */
  linkSource(projectId: string, upstream: string, downstream: string): Promise<BoardSource> {
    return unwrap(this.canvas.linkSource(projectId, upstream, downstream, this.signal))
  }

  /** Remove one source edge. */
  unlinkSource(projectId: string, sourceId: string): Promise<boolean> {
    return unwrap(this.canvas.unlinkSource(projectId, sourceId, this.signal))
  }

  /** Resolve one card's material chain. */
  getSources(projectId: string, cardId: string): Promise<SourceChain> {
    return unwrap(this.canvas.getSources(projectId, cardId, this.signal))
  }

  /** Add the edges the artifacts' own references imply. */
  reconcile(projectId: string): Promise<BoardSource[]> {
    return unwrap(this.canvas.reconcile(projectId, this.signal))
  }

  // ── canvas: notes ─────────────────────────────────────────────────────────

  /** Drop a shared note on the board. */
  createNote(projectId: string, text: string, position: Point): Promise<Note> {
    return unwrap(this.canvas.createNote(projectId, text, position, this.signal))
  }

  /** Remove a note. */
  removeNote(projectId: string, noteId: string): Promise<boolean> {
    return unwrap(this.canvas.removeNote(projectId, noteId, this.signal))
  }

  // ── card: artifacts ───────────────────────────────────────────────────────

  /** Put a card for an existing artifact on the board. */
  createCard(projectId: string, cardId: string, kind: string, position: Point): Promise<BoardCard> {
    return unwrap(this.card.createCard(projectId, cardId, kind, position, this.signal))
  }

  /**
   * Scaffold a webapp into a fresh folder and seat its entry (应用节点).
   *
   * The host settles the folder name — the answer's card id carries the
   * folder actually written, which only differs from the request when a
   * folder of that name was already on disk.
   */
  scaffoldWebapp(projectId: string, name: string, position: Point): Promise<BoardCard> {
    return unwrap(this.card.scaffoldWebapp(projectId, name, position, this.signal))
  }

  /** Take a card off the board. The file stays. */
  removeCard(projectId: string, cardId: string): Promise<boolean> {
    return unwrap(this.card.removeCard(projectId, cardId, this.signal))
  }

  /** The bounded digest of one artifact. */
  readSummary(projectId: string, cardId: string): Promise<CardSummary> {
    return unwrap(this.card.readSummary(projectId, cardId, this.signal))
  }

  /** The fullscreen view payload of one artifact (F3.8). */
  readArtifact(projectId: string, cardId: string): Promise<ArtifactView> {
    return unwrap(this.card.readArtifact(projectId, cardId, this.signal))
  }

  /** The digests of one card's direct materials. */
  readSources(projectId: string, cardId: string): Promise<CardSummary[]> {
    return unwrap(this.card.readSources(projectId, cardId, this.signal))
  }

  /** Push an upstream digest into a card's session. */
  injectCard(projectId: string, cardId: string, sourceCardId: string, mode: 'summary' | 'full'): Promise<CardSummary> {
    return unwrap(this.card.injectCard(projectId, cardId, sourceCardId, mode, this.signal))
  }

  /** Open, or re-attach, the Agent session bound to a card (F3.1). */
  openSession(projectId: string, cardId: string): Promise<SessionBinding> {
    return unwrap(this.card.openSession(projectId, cardId, this.signal))
  }

  /** Submit the user's prompt typed in the card composer as the session's next turn (F3.2). */
  sendMessage(projectId: string, cardId: string, prompt: string): Promise<SessionBinding> {
    return unwrap(this.card.sendMessage(projectId, cardId, prompt, this.signal))
  }

  /**
   * The user's own latest message to a card's session, verbatim (F3.9).
   *
   * Read from the session log on the Host, so it answers for a card whose
   * conversation this page has never opened — the case the composer's seed
   * exists for.
   */
  readLastPrompt(projectId: string, cardId: string): Promise<LastPrompt> {
    return unwrap(this.card.readLastPrompt(projectId, cardId, this.signal))
  }

  // ── session: model selection ──────────────────────────────────────────────

  /** The Host-generation model catalog, shared by every session's picker. */
  modelCatalog(): Promise<ModelCatalog> {
    if (this.#session === undefined) throw new Error('dsh-canvas: the session Remote namespace is not mounted')
    return unwrap(this.#session.modelCatalog())
  }

  /**
   * Make a durable per-session model selection. The choice lands in the
   * session's selection projection and governs its next model request — the
   * same wire call the host composer's model seat makes.
   */
  async selectModel(sessionId: string, provider: string, model: string): Promise<void> {
    if (this.#session === undefined) throw new Error('dsh-canvas: the session Remote namespace is not mounted')
    await unwrap(this.#session.selectModel({ sessionId, provider, model }))
  }

  /**
   * Read one session's model-selection projection.
   *
   * `session/list` carries every row's projection values, so this is the
   * authoritative answer for a session the client may never have opened —
   * unlike the client-side projection store, which is seeded from a session's
   * history and therefore says nothing about a card nobody has looked at yet.
   * The list read is memoised for a moment, because the composer mounts once
   * per selected card and clicking around a board should not be one wire call
   * per click.
   *
   * @param sessionId - the card session being shown.
   * @returns the projection view, or `undefined` when the session is not in the
   *   list (nothing to say) — see `selectionOf` for reading the view itself.
   */
  async readModelSelection(sessionId: string): Promise<ModelSelectionView | undefined> {
    if (this.#session === undefined) throw new Error('dsh-canvas: the session Remote namespace is not mounted')
    const cached = this.#sessionList
    const fresh = cached !== undefined && Date.now() - cached.at < SESSION_LIST_TTL_MS
    // The cache only ever answers a *hit*. A miss — a card whose session was
    // created a moment ago — reads through, so "not found" can never come from
    // a snapshot taken before the session existed.
    const hit = fresh ? cached.rows.find((entry) => entry.sessionId === sessionId) : undefined
    const row = hit ?? (await this.fetchSessionList()).find((entry) => entry.sessionId === sessionId)
    const value = row?.projections?.values?.modelSelection
    return value === undefined || value === null ? undefined : (value as ModelSelectionView)
  }

  /** Read the session list and keep it as the projection lookup's snapshot. */
  private async fetchSessionList(): Promise<readonly SessionListRow[]> {
    const rows = (await unwrap(this.session.list({}, this.signal))).items
    this.#sessionList = { at: Date.now(), rows }
    return rows
  }

  /** The `session` Remote namespace, or a clear failure while it is not mounted. */
  private get session(): SessionModelFace {
    if (this.#session === undefined) throw new Error('dsh-canvas: the session Remote namespace is not mounted')
    return this.#session
  }

  /** Stop the card's live agent. Its log stays on disk. */
  releaseSession(projectId: string, cardId: string): Promise<boolean> {
    return unwrap(this.card.releaseSession(projectId, cardId, this.signal))
  }

  /** Whole-file write-back (F8.1). */
  writeText(projectId: string, cardId: string, content: string): Promise<WriteResult> {
    return unwrap(this.card.writeText(projectId, cardId, content, this.signal))
  }

  /** Whole-file write-back guarded by a freshness token. */
  editText(projectId: string, cardId: string, content: string, version: string): Promise<WriteResult> {
    return unwrap(this.card.editText(projectId, cardId, content, version, this.signal))
  }

  /** Queue a structured edit intent for the card's next turn (F8.2). */
  queueIntent(
    projectId: string,
    cardId: string,
    kind: PendingIntent['kind'],
    payload: string,
    image = '',
  ): Promise<PendingIntent[]> {
    return unwrap(this.card.queueIntent(projectId, cardId, kind, payload, image, this.signal))
  }

  /** Read the intents still queued. */
  readPending(projectId: string, cardId: string): Promise<PendingIntent[]> {
    return unwrap(this.card.readPending(projectId, cardId, this.signal))
  }

  /** Produce an export in one of the kind's supported formats. */
  exportCard(projectId: string, cardId: string, format: ExportFormat): Promise<ExportResult> {
    return unwrap(this.card.exportCard(projectId, cardId, format, this.signal))
  }

  /** Publish the artifact and get back its URL (F10.3). */
  publishCard(projectId: string, cardId: string): Promise<ExportResult> {
    return unwrap(this.card.publishCard(projectId, cardId, this.signal))
  }

  // ── derived reads ─────────────────────────────────────────────────────────

  /**
   * Find the card a session is bound to.
   *
   * The session view ring knows only a session id, and the board is the only
   * place the binding is visible from the browser, so this walks the projects
   * and reads each board. The board count is the user's project count — a
   * handful — so the walk is cheaper than a second wire method would be, and
   * it keeps the frozen contract untouched.
   *
   * @param sessionId - the session to locate.
   * @returns the owning project and card, or `undefined` for an unbound session.
   */
  async findCardBySession(sessionId: string): Promise<LocatedCard | undefined> {
    if (sessionId === '') return undefined
    for (const project of await this.listProjects()) {
      const board = await this.readBoard(project.id)
      const card = board.cards.find((entry) => entry.sessionId === sessionId)
      if (card !== undefined) return { project, card }
    }
    return undefined
  }
}
