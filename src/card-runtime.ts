/**
 * dsh-canvas — `card` Remote service: artifact digests, writes, injection, export.
 *
 * Every method here answers for *one named card*, passed in by the caller. The
 * agent-facing tools are different: they resolve the card from the calling
 * agent instead (see `tools.ts`), which is what makes card isolation structural
 * rather than a prompt convention.
 *
 * Session creation goes through the agent lifecycle, never
 * `ctx.sessions.create()` — see `core/session-manager.ts` for why that
 * distinction is the difference between a durable conversation and one that
 * vanishes with the plugin fiber.
 */
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  BoardCard,
  CardId,
  CardSummary,
  ExportFormat,
  PendingIntent,
  Point,
  Project,
  ProjectId,
  SessionBinding,
  UpstreamPolicy,
  WriteResult,
} from './types.ts'
import type { CanvasDomain } from './domain.ts'
import type { CanvasCapabilities } from './capabilities.ts'
import type { ArtifactIo } from './core/artifact-io.ts'
import { cardKeyOf, SessionManager } from './core/session-manager.ts'
import { kindById, kindLabel, kindSupportsExport } from './core/kind-registry.ts'
import { injectionMessage, installCardScope, PLUGIN_ID, renderMaterial, upstreamChangedMessage } from './prompt.ts'
import { transitiveUpstreams } from './core/source-store.ts'

/** What {@link CardRuntime} needs from the plugin's composition root. */
export interface CardRuntimeDeps {
  domain: CanvasDomain
  io: ArtifactIo
  sessions: SessionManager
  /** Character budget of one artifact digest. */
  summaryBudget: number
  /** Depth of the chain used when a card pulls its material. */
  sourceDepth: number
  /** What happens to a downstream card's session when this card's artifact changes (F5.7). */
  upstreamPolicy: UpstreamPolicy
  /** Deployment-provided export / publish / image generation, when present. */
  capabilities?: CanvasCapabilities | undefined
}

/** A stored card record, as the domain keeps it. */
interface CardRecord {
  project: string
  kind: string
  position: Point
  sessionId: string
  updatedAt: number
}

/** Mint an id for a card's brand-new conversation. */
function mintSessionId(projectId: ProjectId, cardId: CardId): SessionId {
  const nonce = Math.random().toString(36).slice(2, 8)
  return SessionId(`cv-${Date.now().toString(36)}-${nonce}-${projectId.length}${cardId.length}`)
}

export class CardRuntime extends TypertRemoteService {
  constructor(ctx: Context, private readonly deps: CardRuntimeDeps) {
    super(ctx, 'card')
  }

  private get cards() {
    return this.deps.domain.table('cards')
  }

  private get projects() {
    return this.deps.domain.table('projects')
  }

  private get sources() {
    return this.deps.domain.table('sources')
  }

  private get intents() {
    return this.deps.domain.table('intents')
  }

  // ── seating ─────────────────────────────────────────────────────────────

  /** Seat a new card on the board. Its artifact may be created later. */
  @Remote
  async createCard(
    projectId: ProjectId,
    cardId: CardId,
    kind: string,
    position: Point,
    signal?: AbortSignal,
  ): Promise<BoardCard> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const key = cardKeyOf(projectId, cardId)
    if (this.cards.get(key) !== undefined) {
      throw new RemoteError('canvas/card-exists', `card ${cardId} is already seated in ${projectId}`, { projectId, cardId })
    }
    const facts = await this.deps.io.facts(project.root, cardId, signal)
    const resolved = facts.present ? facts.kind : kind
    await this.cards.put(key, {
      project: projectId,
      kind: resolved,
      position,
      sessionId: '',
      updatedAt: Date.now(),
    })
    return {
      id: cardId,
      project: projectId,
      kind: resolved,
      kindLabel: kindLabel(resolved),
      position,
      sessionId: '',
      present: facts.present,
    }
  }

  /** Unseat a card. The artifact on disk is never deleted (F1.2). */
  @Remote
  async removeCard(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    const key = cardKeyOf(projectId, cardId)
    if (this.cards.get(key) === undefined) return false
    await this.deps.sessions.release(projectId, cardId)
    for (const [id, record] of [...this.sources.entries()]) {
      if (record.project === projectId && (record.upstream === cardId || record.downstream === cardId)) {
        await this.sources.delete(id)
      }
    }
    await this.cards.delete(key)
    return true
  }

  // ── digests ─────────────────────────────────────────────────────────────

  /** Bounded digest of one artifact (F5.2). */
  @Remote
  async readSummary(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<CardSummary> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    this.requireCard(projectId, cardId)
    return this.deps.io.summarize(project.root, cardId, this.deps.summaryBudget, signal)
  }

  /**
   * Digests of every artifact this card sources from, nearest first.
   *
   * Indirect upstreams are included on purpose: a card three hops from the
   * brief still needs to know what the brief said, and making the model walk
   * the chain itself wastes a turn and often loses a hop.
   */
  @Remote
  async readSources(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<CardSummary[]> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    this.requireCard(projectId, cardId)
    const edges = this.edgesOf(projectId)
    const { direct, indirect } = transitiveUpstreams(cardId, edges, this.deps.sourceDepth)
    const order = [...direct, ...indirect]
    const summaries: CardSummary[] = []
    for (const upstream of order) {
      if (this.cards.get(cardKeyOf(projectId, upstream)) === undefined) continue
      try {
        summaries.push(await this.deps.io.summarize(project.root, upstream, this.deps.summaryBudget, signal))
      } catch {
        // A card whose artifact is missing is a real board state (seated, not
        // yet written). It contributes nothing to the material list rather
        // than failing the whole read.
      }
    }
    return summaries
  }

  /**
   * Push one artifact into a card's conversation (F5.3).
   *
   * The injection is durable context, not a turn: `agent.inject` appends to the
   * session without waking an idle agent, so a background material update never
   * spends the user's tokens behind their back.
   *
   * `summary` mode carries the F5.2 digest — path, structure, bounded body —
   * rather than the bare summary text, because the path and the outline are the
   * two things an agent cannot reconstruct from the prose alone.
   */
  @Remote
  async injectCard(
    projectId: ProjectId,
    cardId: CardId,
    sourceCardId: CardId,
    mode: 'summary' | 'full',
    signal?: AbortSignal,
  ): Promise<CardSummary> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    this.requireCard(projectId, cardId)
    this.requireCard(projectId, sourceCardId)

    const summary = await this.deps.io.summarize(project.root, sourceCardId, this.deps.summaryBudget, signal)
    const body =
      mode === 'full'
        ? (await this.deps.io.readText(project.root, sourceCardId, signal)).text.slice(0, 200_000)
        : renderMaterial([summary])

    const session = this.deps.sessions.live(projectId, cardId)
    if (session === undefined) {
      throw new RemoteError('card/session-missing', `card ${cardId} has no open conversation to inject into`, {
        projectId,
        cardId,
      })
    }
    session.agent.inject(injectionMessage(summary, mode, body))
    return summary
  }

  // ── sessions ────────────────────────────────────────────────────────────

  /**
   * Open — or re-attach to — the card's conversation (F3.1).
   *
   * Created through the agent factory, which is what makes the log durable
   * (§4.5). When the stored binding no longer resolves, a fresh conversation is
   * created rather than the stale one being overwritten: the old log stays on
   * disk, so nothing a user said is destroyed by a read failure.
   */
  @Remote
  async openSession(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<SessionBinding> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const key = cardKeyOf(projectId, cardId)
    const record = this.requireCard(projectId, cardId)

    const live = this.deps.sessions.live(projectId, cardId)
    if (live !== undefined) return { cardId, sessionId: live.sessionId, created: false }

    let binding = record.sessionId
    let created = binding === ''

    const attach = async (ownerCtx: Context, resumeId: SessionId | undefined, fresh: boolean) => {
      const setup = (agentCtx: Context): void => this.scopeFor(agentCtx, project, cardId, record.kind)
      const handle = fresh
        ? await ownerCtx.agents.create({
            sessionId: resumeId ?? mintSessionId(projectId, cardId),
            meta: { cwd: project.root },
            setup,
          })
        : await ownerCtx.agents.resume({ resumeSessionId: resumeId as SessionId, setup })
      return { agent: handle.agent, dispose: () => handle.dispose() }
    }

    let opened: Awaited<ReturnType<SessionManager['open']>>
    if (created) {
      opened = await this.deps.sessions.open(projectId, cardId, (ownerCtx) => attach(ownerCtx, undefined, true))
    } else {
      try {
        opened = await this.deps.sessions.open(projectId, cardId, (ownerCtx) =>
          attach(ownerCtx, SessionId(binding), false),
        )
      } catch (error) {
        this.ctx.logger(PLUGIN_ID).warn(
          `card ${cardId}: stored conversation ${binding} could not be resumed, starting a new one`,
          error,
        )
        binding = ''
        created = true
        opened = await this.deps.sessions.open(projectId, cardId, (ownerCtx) => attach(ownerCtx, undefined, true))
      }
    }

    if (created || binding !== opened.session.sessionId) {
      await this.cards.put(key, { ...record, sessionId: opened.session.sessionId })
    }
    return { cardId, sessionId: opened.session.sessionId, created: opened.created }
  }

  /** Release the live conversation. The log and the binding both survive (F3.4). */
  @Remote
  async releaseSession(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    return this.deps.sessions.release(projectId, cardId)
  }

  // ── writes ──────────────────────────────────────────────────────────────

  /**
   * Replace the whole artifact (F8.1 — double-click, edit, write back).
   *
   * Unguarded on purpose: this is the user's own edit of the file they are
   * looking at, and the canvas has already shown them the content they are
   * replacing. The guarded path is {@link editText}, which is what automation
   * uses.
   */
  @Remote
  async writeText(projectId: ProjectId, cardId: CardId, content: string, signal?: AbortSignal): Promise<WriteResult> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const record = this.requireCard(projectId, cardId)
    const outcome = await this.deps.io.write(project.root, cardId, content, undefined, signal)
    await this.touch(projectId, cardId, record)
    return { cardId, ...outcome }
  }

  /**
   * Replace the artifact only if it still holds the version the caller saw.
   *
   * `version` comes from a previous `WriteResult` or `readSummary`; a mismatch
   * is `card/stale-version` rather than a silent overwrite, which is what keeps
   * a user's concurrent edit and an agent's write from destroying each other
   * (§4.9).
   */
  @Remote
  async editText(
    projectId: ProjectId,
    cardId: CardId,
    content: string,
    version: string,
    signal?: AbortSignal,
  ): Promise<WriteResult> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const record = this.requireCard(projectId, cardId)
    const current = await this.deps.io.readText(project.root, cardId, signal)
    if (String(current.version) !== version) {
      throw new RemoteError(
        'card/stale-version',
        `card ${cardId} changed on disk since it was read`,
        { cardId, expected: version, actual: String(current.version) },
      )
    }
    const outcome = await this.deps.io.write(project.root, cardId, content, { version: current.version }, signal)
    await this.touch(projectId, cardId, record)
    await this.notifyDownstream(project, cardId)
    return { cardId, ...outcome }
  }

  // ── structured intents (F8.2/F8.4) ───────────────────────────────────────

  /** Queue one structured edit intent for the card's next turn. */
  @Remote
  async queueIntent(
    projectId: ProjectId,
    cardId: CardId,
    kind: PendingIntent['kind'],
    payload: string,
    image: string,
    signal?: AbortSignal,
  ): Promise<PendingIntent[]> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    this.requireCard(projectId, cardId)
    const id = `intent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    await this.intents.put(id, { project: projectId, cardId, kind, payload, image, createdAt: Date.now() })
    return this.readPending(projectId, cardId, signal)
  }

  /** Every intent still queued for one card, oldest first. */
  @Remote
  async readPending(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<PendingIntent[]> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    return [...this.intents.entries()]
      .filter(([, record]) => record.project === projectId && record.cardId === cardId)
      .map(([id, record]) => ({
        id,
        cardId: record.cardId,
        kind: record.kind,
        payload: record.payload,
        image: record.image,
        createdAt: record.createdAt,
      }))
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  /** Drop every queued intent of one card, after they have been consumed. */
  async clearPending(projectId: ProjectId, cardId: CardId): Promise<void> {
    for (const [id, record] of [...this.intents.entries()]) {
      if (record.project === projectId && record.cardId === cardId) await this.intents.delete(id)
    }
  }

  // ── export / publish (F10) ───────────────────────────────────────────────

  /**
   * Render one artifact to another format.
   *
   * The kind decides whether the format is even meaningful (an `.mp4` has no
   * `pptx`), and the deployment decides whether it can be produced at all.
   * Both refusals are reported as a structured result rather than a throw,
   * because "this kind cannot be exported to PDF" is an answer the UI shows,
   * not an error the user should have to interpret.
   */
  @Remote
  async exportCard(
    projectId: ProjectId,
    cardId: CardId,
    format: ExportFormat,
    signal?: AbortSignal,
  ): Promise<{ cardId: CardId; format: string; ok: boolean; path: string; reason: string }> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const record = this.requireCard(projectId, cardId)
    return this.runExport(project, cardId, record.kind, format, signal)
  }

  /** Publish one artifact and return its URL (F10.3). */
  @Remote
  async publishCard(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<{ cardId: CardId; format: string; ok: boolean; path: string; reason: string }> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const record = this.requireCard(projectId, cardId)
    const definition = kindById(record.kind)
    if (definition?.publishable !== true) {
      return { cardId, format: 'publish', ok: false, path: '', reason: `${record.kind} 形态不支持发布` }
    }
    const publish = this.deps.capabilities?.publish
    if (publish === undefined) {
      return {
        cardId,
        format: 'publish',
        ok: false,
        path: '',
        reason: `部署未提供发布能力（服务键 ${'dsh-canvas.capabilities'}）`,
      }
    }
    try {
      const result = await publish(
        { project, cardId, kind: record.kind, path: await this.deps.io.displayPathOf(project.root, cardId, signal), title: cardId },
        signal,
      )
      return { cardId, format: 'publish', ok: true, path: result.url, reason: '' }
    } catch (error) {
      return { cardId, format: 'publish', ok: false, path: '', reason: describe(error) }
    }
  }

  /**
   * Run one export, shared by the Remote method and the tool layer.
   *
   * Kept public (not `@Remote`) so `tools.ts` can reuse it without going back
   * over the wire — the tool runs in the same process.
   */
  async runExport(
    project: Project,
    cardId: CardId,
    kind: string,
    format: ExportFormat,
    signal?: AbortSignal,
  ): Promise<{ cardId: CardId; format: string; ok: boolean; path: string; reason: string }> {
    if (!kindSupportsExport(kind, format)) {
      const supported = kindById(kind)?.exportFormats ?? []
      return {
        cardId,
        format,
        ok: false,
        path: '',
        reason: supported.length === 0 ? `${kind} 形态不支持导出` : `${kind} 形态不支持导出为 ${format}（支持：${supported.join(' / ')}）`,
      }
    }
    const exporter = this.deps.capabilities?.export
    if (exporter === undefined) {
      return { cardId, format, ok: false, path: '', reason: '部署未提供导出能力（服务键 dsh-canvas.capabilities）' }
    }
    try {
      const artifact = await this.deps.io.facts(project.root, cardId, signal)
      if (!artifact.present) {
        throw new RemoteError('card/artifact-absent', `artifact ${cardId} is not on disk`, {
          cardId,
          path: artifact.displayPath,
        })
      }
      const result = await exporter(
        { project, cardId, kind, path: artifact.displayPath, format },
        signal,
      )
      return { cardId, format, ok: true, path: result.path, reason: '' }
    } catch (error) {
      return { cardId, format, ok: false, path: '', reason: describe(error) }
    }
  }

  /**
   * Generate an image artifact for one card (F7.2 / `canvas.generate_image`).
   *
   * Writes into an existing card when the caller names one, so the image lands
   * as material on the board rather than as an orphan file.
   */
  async generateImage(
    project: Project,
    cardId: CardId,
    prompt: string,
    referencePath: string | undefined,
    signal?: AbortSignal,
  ): Promise<{ cardId: CardId; ok: boolean; path: string; reason: string }> {
    const generate = this.deps.capabilities?.generateImage
    if (generate === undefined) {
      return { cardId, ok: false, path: '', reason: '部署未提供生图能力（服务键 dsh-canvas.capabilities）' }
    }
    try {
      const result = await generate({ project, cardId, prompt, referencePath }, signal)
      const key = cardKeyOf(project.id, cardId)
      const record = this.cards.get(key)
      if (record !== undefined) {
        const facts = await this.deps.io.facts(project.root, cardId, signal)
        await this.cards.put(key, { ...record, kind: facts.kind, updatedAt: Date.now() })
      }
      return { cardId, ok: true, path: result.path, reason: '' }
    } catch (error) {
      return { cardId, ok: false, path: '', reason: describe(error) }
    }
  }

  // ── internals ───────────────────────────────────────────────────────────

  /**
   * Tell every open downstream conversation that its material changed (F5.7).
   *
   * Only *live* sessions are told, and only by injection: a closed card has no
   * context to become stale, and an idle one must not be woken by a background
   * write. `notify` reports the change; `pull` also carries the fresh digest, so
   * a downstream card does not have to spend a tool call rediscovering it.
   */
  private async notifyDownstream(project: Project, cardId: CardId): Promise<void> {
    if (this.deps.upstreamPolicy === 'silent') return
    const downstreams = this.edgesOf(project.id)
      .filter((edge) => edge.upstream === cardId)
      .map((edge) => edge.downstream)

    for (const downstream of downstreams) {
      const session = this.deps.sessions.live(project.id, downstream)
      if (session === undefined) continue
      let digest = ''
      if (this.deps.upstreamPolicy === 'pull') {
        try {
          digest = (await this.deps.io.summarize(project.root, cardId, this.deps.summaryBudget)).summary
        } catch {
          // A digest that cannot be produced still leaves a useful notice.
          digest = ''
        }
      }
      session.agent.inject(upstreamChangedMessage(cardId, downstream, digest))
    }
  }

  /** Compose the card's prompt facts; used from the agent setup callback. */
  private scopeFor(agentCtx: Context, project: Project, cardId: CardId, kind: string): void {
    installCardScope(agentCtx, {
      project,
      cardId,
      kind,
      kindLabel: kindLabel(kind),
      material: () => this.materialText(project.id, cardId),
    })
  }

  /** The material block, rendered from the card's current chain. */
  private materialText(projectId: ProjectId, cardId: CardId): string {
    const project = this.projects.get(projectId)
    if (project === undefined) return ''
    const { direct, indirect } = transitiveUpstreams(cardId, this.edgesOf(projectId), this.deps.sourceDepth)
    // Resolved synchronously against cached facts: an assembly must not await
    // I/O, so the digest here is the chain and the paths, not the file bodies.
    const lines = [...direct, ...indirect].map((upstream) => {
      const record = this.cards.get(cardKeyOf(projectId, upstream))
      return record === undefined ? `- ${upstream}` : `- ${upstream} (${kindLabel(record.kind)})`
    })
    if (lines.length === 0) return ''
    return [
      'Sourced material — call `canvas.read_sources` for the digests, `canvas.read_card` for one artifact:',
      ...lines,
    ].join('\n')
  }

  private edgesOf(projectId: ProjectId) {
    return [...this.sources.entries()]
      .filter(([, record]) => record.project === projectId)
      .map(([id, record]) => ({ id, ...record }))
  }

  private async touch(projectId: ProjectId, cardId: CardId, record: CardRecord): Promise<void> {
    const facts = await this.deps.io.facts(this.requireProject(projectId).root, cardId)
    await this.cards.put(cardKeyOf(projectId, cardId), {
      ...record,
      kind: facts.kind,
      updatedAt: Date.now(),
    })
  }

  private requireProject(projectId: ProjectId): Project {
    const record = this.projects.get(projectId)
    if (record === undefined) {
      throw new RemoteError('canvas/project-not-found', `no canvas project ${projectId}`, { projectId })
    }
    return { id: projectId, ...record }
  }

  private requireCard(projectId: ProjectId, cardId: CardId): CardRecord {
    const record = this.cards.get(cardKeyOf(projectId, cardId))
    if (record === undefined) {
      throw new RemoteError('canvas/card-not-found', `no card ${cardId} in project ${projectId}`, { projectId, cardId })
    }
    return record
  }
}

/** One line of human-readable cause, for the structured export/publish result. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
