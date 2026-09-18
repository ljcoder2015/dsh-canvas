/**
 * dsh-canvas — `canvas` Remote service: projects, seating, source edges, notes.
 *
 * Everything the board *is* lives here; everything a card *contains* lives in
 * `card-runtime.ts`. Ownership of durable state is one-directional: this class
 * reads and writes the storage domain and never touches artifact contents
 * beyond the bounded probe the kind registry needs.
 *
 * Failure surface follows §4.4: one class (`RemoteError`), domain-qualified
 * codes, never a local exception family.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ArrangeStrategy,
  BoardCard,
  BoardSnapshot,
  BoardSource,
  CardId,
  FolderEntry,
  Note,
  NoteId,
  Point,
  Project,
  ProjectId,
  Source,
  SourceChain,
  SourceId,
  StyleProfile,
  Viewport,
} from './types.ts'
import type { CanvasDomain } from './domain.ts'
import { ArtifactIo } from './core/artifact-io.ts'
import { arrangeSeats, nextFreeSeat, type SeatInput } from './core/board.ts'
import { projectIdOf } from './core/ids.ts'
import { cardIdOfKey, cardKeyOf, SessionManager } from './core/session-manager.ts'
import { kindLabel } from './core/kind-registry.ts'
import { claimCanvasWorkspace } from './core/workspace.ts'
import {
  reconcileEdges,
  referencedPaths,
  sourceIdOf,
  transitiveUpstreams,
  validateEdge,
} from './core/source-store.ts'

/** What {@link CanvasRuntime} needs from the plugin's composition root. */
export interface CanvasRuntimeDeps {
  domain: CanvasDomain
  io: ArtifactIo
  sessions: SessionManager
  /** Horizontal gap used when arranging, in canvas px. */
  arrangeGap: number
  /** Depth of the chain `getSources` resolves. */
  sourceDepth: number
  /** Root the folder picker starts from. */
  pickerRoot: string
}

/** A stored card record, as the domain keeps it. */
interface CardRecord {
  project: string
  kind: string
  position: Point
  sessionId: string
  updatedAt: number
}

/** A stored project record. */
interface ProjectRecord {
  name: string
  root: string
  viewport: Viewport
  style: StyleProfile
  createdAt: number
}

/**
 * Where new work goes when the picker starts from the configured root.
 *
 * The picker is deliberately shallow-on-open and deep-on-demand: handing the
 * client a full recursive tree would be both slow and unhelpful, and the
 * deployment's root may be a home directory.
 */
const MAX_FOLDER_ENTRIES = 500

export class CanvasRuntime extends TypertRemoteService {
  constructor(ctx: Context, private readonly deps: CanvasRuntimeDeps) {
    // The service key doubles as the wire namespace; `canvas` is the hex
    // namespace base recorded in §4.3.
    super(ctx, 'canvas')
  }

  private get projects() {
    return this.deps.domain.table('projects')
  }

  private get cards() {
    return this.deps.domain.table('cards')
  }

  private get sources() {
    return this.deps.domain.table('sources')
  }

  private get notes() {
    return this.deps.domain.table('notes')
  }

  // ── projects ────────────────────────────────────────────────────────────

  /** Every project, oldest first. */
  @Remote
  async listProjects(signal?: AbortSignal): Promise<Project[]> {
    signal?.throwIfAborted()
    return [...this.projects.entries()]
      .map(([id, record]) => this.projectOf(id, record))
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  /**
   * Bind a directory as a project and discover the artifacts already in it
   * (F1.3).
   *
   * Re-binding an existing root is idempotent: it returns the stored project
   * and only adds cards for artifacts that are not seated yet, so a second
   * "new project" on the same folder never duplicates the board.
   */
  @Remote
  async createProject(name: string, path: string, signal?: AbortSignal): Promise<{ project: Project; discovered: number }> {
    signal?.throwIfAborted()
    // The picker's empty path means "start where the configured root starts".
    const directory = path.trim() === '' ? this.deps.pickerRoot : path
    const scan = await this.deps.io.scanProject(directory, signal)
    const root = await this.deps.io.displayPathOf(directory, '.', signal).catch(() => directory)
    const id = projectIdOf(root)

    const existing = this.projects.get(id)
    if (existing === undefined) {
      await this.projects.put(id, {
        name: name.trim() === '' ? (root.split('/').pop() ?? 'canvas') : name.trim(),
        root,
        viewport: { x: 0, y: 0, zoom: 1 },
        style: { palette: [], font: '', tone: '' },
        createdAt: Date.now(),
      })
    }

    const seated = this.cardsOf(id)
    const known = new Set(seated.map(([key]) => cardIdOfKey(id, key)))
    const fresh = scan.filter((cardId) => !known.has(cardId))
    const seats: SeatInput[] = seated.map(([key, record]) => ({
      id: cardIdOfKey(id, key),
      position: record.position,
    }))

    for (const cardId of fresh) {
      const position = nextFreeSeat(seats, this.deps.arrangeGap)
      const facts = await this.deps.io.facts(root, cardId, signal)
      await this.cards.put(cardKeyOf(id, cardId), {
        project: id,
        kind: facts.kind,
        position,
        sessionId: '',
        updatedAt: Date.now(),
      })
      seats.push({ id: cardId, position })
    }

    const record = this.projects.get(id)
    const project = this.projectOf(id, record as ProjectRecord)
    // 画布即工作区（F1.6）：建画布的同时把这个根目录登记成宿主工作区，并把已经绑过
    // 会话的卡片一并交账——重开一张旧画布，它的对话也就当场从「未分组」挪到这张画布
    // 名下。尽力而为，没有工作区名册的部署里整体是空操作。
    await claimCanvasWorkspace(
      this.ctx,
      { root: project.root, title: project.name },
      this.cardsOf(id).map(([, card]) => card.sessionId),
    )
    return { project, discovered: fresh.length }
  }

  /** Forget a project. The files on disk are never touched. */
  @Remote
  async removeProject(projectId: ProjectId, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    for (const [key] of this.cardsOf(projectId)) await this.cards.delete(key)
    for (const [id, record] of [...this.sources.entries()]) {
      if (record.project === projectId) await this.sources.delete(id)
    }
    for (const [id, record] of [...this.notes.entries()]) {
      if (record.project === projectId) await this.notes.delete(id)
    }
    return this.projects.delete(projectId)
  }

  /** Direct subdirectories of a path, for the folder picker (design screen 02). */
  @Remote
  async listFolders(path: string, signal?: AbortSignal): Promise<FolderEntry[]> {
    signal?.throwIfAborted()
    const start = path.trim() === '' ? this.deps.pickerRoot : path
    const entries = await this.deps.io.listFolders(start, signal)
    return entries.slice(0, MAX_FOLDER_ENTRIES)
  }

  // ── board ───────────────────────────────────────────────────────────────

  /** The whole board: seating, edges, notes (F1.3). */
  @Remote
  async readBoard(projectId: ProjectId, signal?: AbortSignal): Promise<BoardSnapshot> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const cards = await Promise.all(
      this.cardsOf(projectId).map(async ([key, record]) => {
        const cardId = cardIdOfKey(projectId, key)
        const probe = await this.deps.io.probe(project.root, cardId, signal)
        return {
          id: cardId,
          project: projectId,
          kind: record.kind,
          kindLabel: kindLabel(record.kind),
          position: record.position,
          sessionId: record.sessionId,
          present: probe.present,
        } satisfies BoardCard
      }),
    )
    return {
      project,
      cards,
      sources: this.sourcesOf(projectId),
      notes: [...this.notes.entries()]
        .filter(([, record]) => record.project === projectId)
        .map(([id, record]) => ({ id, ...record })),
    }
  }

  /** Remember where the user left the viewport (F1.4). */
  @Remote
  async setViewport(projectId: ProjectId, viewport: Viewport, signal?: AbortSignal): Promise<Project> {
    signal?.throwIfAborted()
    const record = this.requireProjectRecord(projectId)
    await this.projects.put(projectId, { ...record, viewport })
    return this.projectOf(projectId, { ...record, viewport })
  }

  /** Remember the project's palette, font and tone (F9.1). */
  @Remote
  async setStyle(projectId: ProjectId, style: StyleProfile, signal?: AbortSignal): Promise<StyleProfile> {
    signal?.throwIfAborted()
    const record = this.requireProjectRecord(projectId)
    await this.projects.put(projectId, { ...record, style })
    return style
  }

  /** Move one card by hand. */
  @Remote
  async moveCard(projectId: ProjectId, cardId: CardId, position: Point, signal?: AbortSignal): Promise<BoardCard> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const key = cardKeyOf(projectId, cardId)
    const record = this.cards.get(key)
    if (record === undefined) throw this.cardNotFound(projectId, cardId)
    await this.cards.put(key, { ...record, position })
    const probe = await this.deps.io.probe(project.root, cardId, signal)
    return {
      id: cardId,
      project: projectId,
      kind: record.kind,
      kindLabel: kindLabel(record.kind),
      position,
      sessionId: record.sessionId,
      present: probe.present,
    }
  }

  /**
   * Re-seat every card by strategy (F4.6).
   *
   * Positions are written one record at a time; the domain's write chain
   * serializes them, so an interrupted arrange leaves a partially moved board
   * rather than a corrupt one, and re-running it converges.
   */
  @Remote
  async arrange(projectId: ProjectId, strategy: ArrangeStrategy, signal?: AbortSignal): Promise<BoardSnapshot> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    const entries = this.cardsOf(projectId)
    const seats = arrangeSeats(
      entries.map(([key, record]) => ({ id: cardIdOfKey(projectId, key), position: record.position })),
      [...this.sources.entries()].filter(([, record]) => record.project === projectId).map(([id, record]) => ({ id, ...record })),
      strategy,
      this.deps.arrangeGap,
    )
    for (const seat of seats) {
      const key = cardKeyOf(projectId, seat.id)
      const record = this.cards.get(key)
      if (record === undefined) continue
      await this.cards.put(key, { ...record, position: seat.position })
    }
    return this.readBoard(projectId, signal)
  }

  // ── source edges ────────────────────────────────────────────────────────

  /** Declare that an artifact builds on another (F4.1–F4.3). */
  @Remote
  async linkSource(
    projectId: ProjectId,
    upstream: CardId,
    downstream: CardId,
    signal?: AbortSignal,
  ): Promise<BoardSource> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    const known = this.cardsOf(projectId).map(([key]) => cardIdOfKey(projectId, key))
    const existing = this.edgeList(projectId)
    const verdict = validateEdge({ upstream, downstream }, known, existing)
    if (!verdict.ok) {
      throw new RemoteError('canvas/source-invalid', `refused to link ${downstream} ← ${upstream}: ${verdict.reason}`, {
        upstream,
        downstream,
        reason: verdict.reason,
      })
    }
    const id = sourceIdOf(downstream, upstream)
    const record = { project: projectId, downstream, upstream, origin: 'manual' as const }
    await this.sources.put(id, record)
    return { id, downstream, upstream, origin: record.origin }
  }

  /** Remove one edge by storage id. */
  @Remote
  async unlinkSource(projectId: ProjectId, sourceId: SourceId, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    const record = this.sources.get(sourceId)
    if (record === undefined || record.project !== projectId) {
      throw new RemoteError('canvas/source-not-found', `no source edge ${sourceId} in ${projectId}`, { projectId, sourceId })
    }
    return this.sources.delete(sourceId)
  }

  /** Resolve one card's source chain (F4.7). */
  @Remote
  async getSources(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<SourceChain> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    if (this.cards.get(cardKeyOf(projectId, cardId)) === undefined) throw this.cardNotFound(projectId, cardId)
    const edges = this.edgeList(projectId)
    const { direct, indirect } = transitiveUpstreams(cardId, edges, this.deps.sourceDepth)
    return {
      cardId,
      direct,
      indirect,
      downstream: edges.filter((edge) => edge.upstream === cardId).map((edge) => edge.downstream),
    }
  }

  /**
   * Add the edges artifact evidence implies (F4.5).
   *
   * Only adds, never removes, and only for cards whose artifact actually
   * references a path that resolves to another seated card — a reference the
   * user drew by hand stays even if the artifact stops mentioning it. Returns
   * the edges this pass created, so the caller can announce just the deltas.
   */
  @Remote
  async reconcile(projectId: ProjectId, signal?: AbortSignal): Promise<BoardSource[]> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const entries = this.cardsOf(projectId)
    const known = entries.map(([key]) => cardIdOfKey(projectId, key))
    const knownSet = new Set(known)
    const existing = this.edgeList(projectId)
    const addedEdges: Source[] = []
    const added: BoardSource[] = []

    for (const cardId of known) {
      const facts = await this.deps.io.facts(project.root, cardId, signal)
      if (!facts.present || facts.kind === 'image' || facts.kind === 'video' || facts.kind === 'folder') continue
      const extension = cardId.includes('.') ? (cardId.split('.').pop() ?? '') : ''
      let text = ''
      try {
        text = (await this.deps.io.readText(project.root, cardId, signal)).text
      } catch {
        continue
      }
      // A reference is only a candidate once it resolves to a seated card:
      // resolving is relative to the referencing artifact's own directory.
      const base = cardId.includes('/') ? cardId.slice(0, cardId.lastIndexOf('/') + 1) : ''
      const referenced = referencedPaths(facts.kind, text, extension)
        .map((raw) => normaliseRelative(base, raw))
        .filter((candidate) => knownSet.has(candidate))

      for (const edge of reconcileEdges(cardId, referenced, known, [...existing, ...addedEdges])) {
        const id = sourceIdOf(edge.downstream, edge.upstream)
        const record = {
          project: projectId,
          downstream: edge.downstream,
          upstream: edge.upstream,
          origin: 'reconciled' as const,
        }
        await this.sources.put(id, record)
        addedEdges.push({ id, ...record })
        added.push({ id, downstream: edge.downstream, upstream: edge.upstream, origin: 'reconciled' })
      }
    }
    return added
  }

  // ── notes ───────────────────────────────────────────────────────────────

  /** Drop a shared note on the board (F9.3). */
  @Remote
  async createNote(projectId: ProjectId, text: string, position: Point, signal?: AbortSignal): Promise<Note> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    const id: NoteId = `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const note: Note = { id, project: projectId, text, author: 'user', position, createdAt: Date.now() }
    await this.notes.put(id, {
      project: projectId,
      text: note.text,
      author: note.author,
      position,
      createdAt: note.createdAt,
    })
    return note
  }

  /** Remove a note. */
  @Remote
  async removeNote(projectId: ProjectId, noteId: NoteId, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    const record = this.notes.get(noteId)
    if (record === undefined || record.project !== projectId) return false
    return this.notes.delete(noteId)
  }

  // ── internals ───────────────────────────────────────────────────────────

  /** The stored project record, or a typed refusal. */
  private requireProjectRecord(projectId: ProjectId): ProjectRecord {
    const record = this.projects.get(projectId)
    if (record === undefined) {
      throw new RemoteError('canvas/project-not-found', `no canvas project ${projectId}`, { projectId })
    }
    return record
  }

  /** The stored project, projected for the wire. */
  private requireProject(projectId: ProjectId): Project {
    return this.projectOf(projectId, this.requireProjectRecord(projectId))
  }

  private projectOf(id: ProjectId, record: ProjectRecord): Project {
    return {
      id,
      name: record.name,
      root: record.root,
      viewport: record.viewport,
      style: record.style,
      createdAt: record.createdAt,
    }
  }

  private cardsOf(projectId: ProjectId): [string, CardRecord][] {
    return [...this.cards.entries()].filter(([, record]) => record.project === projectId)
  }

  /** Every stored edge of a project, shaped as the pure layer expects. */
  private edgeList(projectId: ProjectId): Source[] {
    return [...this.sources.entries()]
      .filter(([, record]) => record.project === projectId)
      .map(([id, record]) => ({ id, ...record }))
  }

  private sourcesOf(projectId: ProjectId): BoardSource[] {
    return this.edgeList(projectId).map((source) => ({
      id: source.id,
      downstream: source.downstream,
      upstream: source.upstream,
      origin: source.origin,
    }))
  }

  private cardNotFound(projectId: ProjectId, cardId: CardId): RemoteError<'canvas/card-not-found'> {
    return new RemoteError('canvas/card-not-found', `no card ${cardId} in project ${projectId}`, { projectId, cardId })
  }
}

/**
 * Resolve a reference found inside `base`'s artifact to a project-relative
 * card id, collapsing `.`/`..` segments.
 *
 * Kept local rather than shared: it exists so the reconciliation pass can turn
 * what an artifact *says* into what the board *means*, and nothing else in the
 * plugin needs that translation. A reference that escapes the project root is
 * simply not a seated card, so the traversal is clamped rather than rejected.
 */
function normaliseRelative(base: string, reference: string): string {
  const segments = reference.startsWith('/') ? [] : base.split('/').filter((part) => part !== '')
  for (const part of reference.replace(/^\/+/, '').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') segments.pop()
    else segments.push(part)
  }
  return segments.join('/')
}
