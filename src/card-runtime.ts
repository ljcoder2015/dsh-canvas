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
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ArtifactView,
  BoardCard,
  CardId,
  CardSummary,
  ExportFormat,
  LastPrompt,
  PendingIntent,
  Point,
  Project,
  ProjectId,
  ReferencedFiles,
  SessionBinding,
  UpstreamPolicy,
  WriteResult,
} from './types.ts'
import type { CanvasDomain } from './domain.ts'
import type { CanvasCapabilities } from './capabilities.ts'
import type { ArtifactIo } from './core/artifact-io.ts'
import { cardKeyOf, SessionManager, type CardSession } from './core/session-manager.ts'
import { slugify } from './core/ids.ts'
import { cardPreset, composeCardAgent } from './core/agent-preset.ts'
import { lastUserPromptOfEvents, sessionQueryFace } from './core/session-log.ts'
import type { ModelRouting } from './core/model-routing.ts'
import { kindById, kindLabel, kindSupportsExport } from './core/kind-registry.ts'
import {
  injectionMessage,
  installCardScope,
  PLUGIN_ID,
  referenceMessage,
  renderMaterial,
  upstreamChangedMessage,
  userPromptMessage,
} from './prompt.ts'
import { attachCanvasSession } from './core/workspace.ts'
import { transitiveUpstreams } from './core/source-store.ts'
import { nameFileReferences, nameWithoutProbe, type FileReferenceTarget } from './core/file-reference.ts'
import { TOOL_NAMES } from './contract.ts'

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
  /**
   * The deployment's model policy, borrowed by every card conversation this
   * runtime opens. See `core/model-routing.ts` for why a card session needs it
   * supplied rather than inherited.
   */
  routing: ModelRouting
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

  /**
   * Scaffold a webapp into a fresh folder and seat its entry as a card (应用节点).
   *
   * One call, one folder: `name` is slugged into a directory under the project
   * root, the scaffold (manifest, entry page, shadcn token stylesheet, web
   * components) is written into it, and the entry `index.html` is seated with
   * the kind the manifest's evidence resolves to — `webapp`. Naming collisions
   * are settled here, against the disk rather than the board: a folder that
   * already exists (even one whose card was removed) gets a numeric suffix, so
   * a scaffold never overwrites a file it did not just create.
   */
  @Remote
  async scaffoldWebapp(projectId: ProjectId, name: string, position: Point, signal?: AbortSignal): Promise<BoardCard> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const base = slugify(name)
    let folder = base
    for (let n = 2; await this.deps.io.probe(project.root, folder, signal).then((probe) => probe.present); n += 1) {
      folder = `${base}-${n}`
    }
    await this.deps.io.writeScaffold(project.root, folder, name, signal)
    return this.createCard(projectId, `${folder}/index.html`, 'webapp', position, signal)
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
   * The fullscreen view payload of one artifact (F3.8).
   *
   * Where {@link readSummary} bounds its read for a prompt, this one reads the
   * artifact whole within the wire caps — it is what a person opens to *read*.
   * An absent artifact is answered, not failed: a seated card whose file has
   * not been written yet gets its viewer with an absent state.
   */
  @Remote
  async readArtifact(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<ArtifactView> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    this.requireCard(projectId, cardId)
    return this.deps.io.view(project.root, cardId, signal)
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
    return this.injectDigest(project, cardId, sourceCardId, mode, this.liveSession(projectId, cardId), signal)
  }

  /**
   * Hand this card's material over as **file references** (F5.3).
   *
   * A 取材 edge says "this artifact builds on that artifact", and the harness
   * already has a way to say that inside a prompt: an `@` token holding a
   * workspace-relative path. Every card id *is* such a path — the file sits at
   * `<project root>/<cardId>`, which is the card session's own working directory
   * — so this method names upstream artifacts rather than copying them.
   *
   * Nothing is read here and no content is attached, and that is the point of a
   * reference: the material stays the one file it already is, so it cannot go
   * stale, the model chooses whether it is worth the context, and the plugin
   * escapes the whole class of problems a copy brings — truncation the model
   * cannot see, a digest budget to negotiate, a service to be missing. The
   * convention is not invented here either: `@deepseek-ai/dsh-file-reference-local`
   * installs exactly this grammar whenever the agent has a `read` tool, which
   * every card conversation does.
   *
   * The two channels answer different questions and both are kept. A reference
   * says *where* the material is and leaves reading to the model; a digest puts
   * a bounded summary *in* the context whether or not anyone asks
   * ({@link injectDigest}, `canvas_inject_card`). The answer never blurs them:
   * `files` lists what was named, `skipped` names what the `@file` grammar
   * cannot carry (a quote or a control character in the path), so a board that
   * could not name something says so instead of quietly dropping it.
   *
   * The chain is walked from this card, indirect upstreams included, for the
   * same reason {@link readSources} includes them: a card three hops from the
   * brief still needs the brief, and making the model walk the chain itself
   * would cost a turn per hop.
   */
  @Remote
  async referenceFiles(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<ReferencedFiles> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    this.requireCard(projectId, cardId)
    const session = this.liveSession(projectId, cardId)

    const targets = await this.fileReferenceTargets(project, cardId, signal)
    const { references, skipped } = nameFileReferences(targets)
    // Injected when there is anything to say — including "some of your material
    // could not be named", which a silent return would hide.
    if (references.length > 0 || skipped.length > 0) session.agent.inject(referenceMessage(references, skipped))
    return { cardId, files: references, skipped }
  }

  // ── sessions ────────────────────────────────────────────────────────────

  /**
   * Open — or re-attach to — the card's conversation (F3.1).
   *
   * Created through the agent factory, which is what makes the log durable
   * (§4.5). When the stored binding no longer resolves, a fresh conversation is
   * created rather than the stale one being overwritten: the old log stays on
   * disk, so nothing a user said is destroyed by a read failure.
   *
   * The agent is composed from the deployment's agent preset before anything
   * else happens, because that composition is where its file tools live: a card
   * conversation writes its artifact with the ordinary `write`/`edit` tools, and
   * on the Web surface those come from the preset rather than the host
   * composition (`core/agent-preset.ts` carries the reasoning). Only then is it
   * created with the deployment's default model and — still before this method
   * returns — told the model its own session already intends, if it has one.
   * Without the model the turn cannot even assemble its prompt; without the
   * selection a choice made before a reload would be silently dropped
   * ({@link align} carries that reasoning).
   */
  @Remote
  async openSession(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<SessionBinding> {
    signal?.throwIfAborted()
    const project = this.requireProject(projectId)
    const key = cardKeyOf(projectId, cardId)
    const record = this.requireCard(projectId, cardId)

    const live = this.deps.sessions.live(projectId, cardId)
    if (live !== undefined) {
      await this.align(live)
      await this.claim(project, live.sessionId)
      return { cardId, sessionId: live.sessionId, created: false }
    }

    let binding = record.sessionId
    let created = binding === ''

    // The preset a card conversation composes from, resolved before anything is
    // created — see `core/agent-preset.ts` for why it is not optional to the
    // card's job. Neither create nor resume carries it in its options: the join
    // is a scope parentage installed by the setup callback, and it is the same
    // join for a resumed conversation as for a fresh one.
    const presetId = await cardPreset(this.ctx)

    const attach = async (ownerCtx: Context, resumeId: SessionId | undefined, fresh: boolean) => {
      const setup = async (agentCtx: Context): Promise<void> => {
        await composeCardAgent(this.ctx, agentCtx, presetId)
        this.scopeFor(agentCtx, project, cardId, record.kind)
      }
      const options = this.deps.routing.agentOptions()
      const agentOptions = options === undefined ? {} : { agentOptions: options }
      const meta = presetId === undefined ? { cwd: project.root } : { cwd: project.root, agentPreset: presetId }
      const handle = fresh
        ? await ownerCtx.agents.create({
            sessionId: resumeId ?? mintSessionId(projectId, cardId),
            meta,
            ...agentOptions,
            setup,
          })
        : await ownerCtx.agents.resume({
            resumeSessionId: resumeId as SessionId,
            ...agentOptions,
            setup,
          })
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

    await this.align(opened.session)
    await this.claim(project, opened.session.sessionId)
    if (created || binding !== opened.session.sessionId) {
      await this.cards.put(key, { ...record, sessionId: opened.session.sessionId })
    }
    return { cardId, sessionId: opened.session.sessionId, created: opened.created }
  }

  /**
   * Put this card's conversation under the canvas's Workspace (F1.6).
   *
   * The conversation's own cwd is already the canvas root, so the only thing
   * missing for the sidebar to file it under that folder instead of 未分组 is
   * the Workspace account — `core/workspace.ts` owns both moves. Failure is
   * logged there and never raised: a conversation that cannot be grouped is
   * still a usable conversation, and refusing to open one over a sidebar
   * grouping would trade a real capability for a cosmetic one.
   */
  private async claim(project: { root: string; name: string }, sessionId: string): Promise<void> {
    await attachCanvasSession(this.ctx, { root: project.root, title: project.name }, sessionId)
  }

  /**
   * Hand one live card conversation the model its session intends.
   *
   * A failure here is logged, not raised: the conversation is open and usable on
   * the deployment default, and refusing to open it would turn a model-policy
   * problem into "this card has no conversation". A resumed conversation never
   * needs a second attempt — the selection lives on the session, so the next
   * open reads it back from the projection.
   */
  private async align(session: CardSession): Promise<void> {
    try {
      await this.deps.routing.align(session.agent, session.sessionId)
    } catch (error) {
      this.ctx.logger(PLUGIN_ID).warn(
        `card ${session.cardId}: the session's model selection could not be installed`,
        error,
      )
    }
  }

  /** Release the live conversation. The log and the binding both survive (F3.4). */
  @Remote
  async releaseSession(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    return this.deps.sessions.release(projectId, cardId)
  }

  /**
   * Submit the user's own prompt to a card's conversation (F3.2 — composer).
   *
   * The board's composer is a full conversation entry point, not a mirror of
   * the host's chat surface: this opens (or re-attaches) the session like
   * {@link openSession} does, then hands the text to `agent.followup` — the
   * same admission path the harness's own composer uses. `followup` queues the
   * prompt as the next turn's sole ordinary message, so a prompt typed while
   * the agent is running waits its turn instead of steering or erroring.
   */
  @Remote
  async sendMessage(projectId: ProjectId, cardId: CardId, prompt: string, signal?: AbortSignal): Promise<SessionBinding> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    this.requireCard(projectId, cardId)
    const binding = await this.openSession(projectId, cardId, signal)
    const session = this.deps.sessions.live(projectId, cardId)
    if (session === undefined) {
      throw new RemoteError('card/session-missing', `card ${cardId} has no conversation to receive the prompt`, {
        projectId,
        cardId,
      })
    }
    session.agent.followup(userPromptMessage(prompt))
    return binding
  }

  /**
   * The user's own latest message to this card's session, verbatim (F3.9).
   *
   * This is what an untouched composer shows. Reading it from the *session log*
   * rather than from the browser's live projection is the whole point: the
   * projection only exists for sessions this page has opened, and the composer
   * must answer for a card the user has not opened yet — the common case.
   * Plugin-pushed context (`agent.inject`) rides the same log; the reader
   * distinguishes by message source, so it is never offered back as the user's
   * words.
   */
  @Remote
  async readLastPrompt(projectId: ProjectId, cardId: CardId, signal?: AbortSignal): Promise<LastPrompt> {
    signal?.throwIfAborted()
    this.requireProject(projectId)
    const record = this.requireCard(projectId, cardId)
    if (record.sessionId === '') return { text: '', time: 0 }
    // A failure here means the conversation's log is not readable right now
    // (never flushed, storage absent). The composer still works — it just has
    // nothing to seed from — so this read answers "nobody has spoken" instead
    // of failing the selection.
    try {
      const query = sessionQueryFace(this.ctx)
      if (query !== undefined) {
        const read = await query.readSession(record.sessionId)
        return lastUserPromptOfEvents(read.events)
      }
    } catch {
      if (signal?.aborted) throw signal.reason
      return { text: '', time: 0 }
    }
    // No session-query service in this deployment (bare harness): a live
    // session is still readable, and a cold one has nothing to say.
    const live = liveSessionEvents(this.ctx, record.sessionId)
    return live === undefined ? { text: '', time: 0 } : lastUserPromptOfEvents(live)
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
   * Generate an image artifact for one card (F7.2 / `canvas_generate_image`).
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

  /** The card's live conversation, or the refusal every injection path shares. */
  private liveSession(projectId: ProjectId, cardId: CardId): CardSession {
    const session = this.deps.sessions.live(projectId, cardId)
    if (session === undefined) {
      throw new RemoteError('card/session-missing', `card ${cardId} has no open conversation to inject into`, {
        projectId,
        cardId,
      })
    }
    return session
  }

  /** Read one upstream artifact and hand it over as durable context (F5.2). */
  private async injectDigest(
    project: Project,
    cardId: CardId,
    sourceCardId: CardId,
    mode: 'summary' | 'full',
    session: CardSession,
    signal?: AbortSignal,
  ): Promise<CardSummary> {
    const summary = await this.deps.io.summarize(project.root, sourceCardId, this.deps.summaryBudget, signal)
    const body =
      mode === 'full'
        ? (await this.deps.io.readText(project.root, sourceCardId, signal)).text.slice(0, 200_000)
        : renderMaterial([summary])
    session.agent.inject(injectionMessage(summary, mode, body))
    return summary
  }

  /**
   * The upstream artifacts of one card, nearest first, as reference targets.
   *
   * Indirect upstreams are included for the same reason {@link readSources}
   * includes them: a card three hops from the brief still needs the brief, and
   * making the model walk the chain itself wastes a turn per hop.
   *
   * Each upstream is *probed* rather than assumed: whether it is a directory
   * decides the mention's shape (a directory keeps a trailing slash), and a card
   * that is seated but has not been written yet is a real board state worth
   * naming with `present: false` instead of hiding — the model can see that the
   * material is not there yet, which is different from the board forgetting to
   * mention it.
   */
  private async fileReferenceTargets(
    project: Project,
    cardId: CardId,
    signal?: AbortSignal,
  ): Promise<FileReferenceTarget[]> {
    const { direct, indirect } = transitiveUpstreams(cardId, this.edgesOf(project.id), this.deps.sourceDepth)
    const targets: FileReferenceTarget[] = []
    for (const upstream of [...direct, ...indirect]) {
      const kind = this.cards.get(cardKeyOf(project.id, upstream))?.kind ?? 'text'
      let directory = false
      let present = false
      let bytes = 0
      try {
        const probe = await this.deps.io.probe(project.root, upstream, signal)
        directory = probe.directory
        present = probe.present
        bytes = probe.bytes
      } catch (error) {
        if (signal?.aborted === true) throw signal.reason
        this.ctx.logger(PLUGIN_ID).debug(`card ${cardId}: cannot probe upstream ${upstream}`, error)
      }
      // The card id *is* the workspace-relative path: the artifact lives at
      // `<project root>/<cardId>`, which is exactly the session's cwd, so the
      // name is one the model's own `read` resolves without translation.
      targets.push({ cardId: upstream, path: upstream, directory, kind, kindLabel: kindLabel(kind), present, bytes })
    }
    return targets
  }

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
    // Resolved synchronously against cached facts, so this block carries *names*
    // and never file bodies: the card id is the workspace-relative path, which
    // is exactly what the harness's `@file` grammar denotes, and the material
    // itself arrives when somebody reads it. A digest served from here would
    // have to be cached — and nothing invalidates such a cache, so a card whose
    // upstream was rewritten by an ordinary file edit would keep feeding the
    // prompt a stale summary.
    const lines = [...direct, ...indirect].map((upstream) => {
      const record = this.cards.get(cardKeyOf(projectId, upstream))
      // `nameWithoutProbe` and not the kind: this block is assembled without
      // I/O, and a `site`/`webapp` card is a *file* even though its kind is a
      // directory — see that helper. `canvas_reference_files` probes, so it
      // owns the exact token; this block just names the files.
      const name = nameWithoutProbe(upstream)
      return record === undefined ? `- ${name}` : `- ${name} (${kindLabel(record.kind)})`
    })
    if (lines.length === 0) return ''
    return [
      `Sourced material — the files this artifact builds on. Read one with the ordinary file tools when you need it; call \`${TOOL_NAMES.readSources}\` for digests of all of them, or \`${TOOL_NAMES.readCard}\` for one artifact directly:`,
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

/**
 * A live session's full event log, read structurally.
 *
 * The fallback for deployments without the session-query service: only sessions
 * currently in the store can be read there, which is honest degradation — a
 * deployment that composition cannot query is also one whose card sessions are
 * short-lived.
 */
function liveSessionEvents(ctx: Context, sessionId: string): readonly SessionEvent[] | undefined {
  const store = ctx.get('sessions') as { get(id: string): { snapshotEvents(): readonly SessionEvent[] } | undefined } | undefined
  return store?.get(sessionId)?.snapshotEvents()
}

/** One line of human-readable cause, for the structured export/publish result. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
