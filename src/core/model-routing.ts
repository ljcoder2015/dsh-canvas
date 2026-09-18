/**
 * dsh-canvas — the model policy a card conversation borrows from the Host.
 *
 * A card's conversation is created by this plugin through the agent factory
 * (see `core/session-manager.ts`), so it never passes through
 * `dsh-api-session-controller`'s composition for an *ordinary* session. Two
 * things that composition normally supplies therefore have to be supplied here:
 *
 * 1. **`AgentOptions.provider`/`model`.** The agent loop reads them for every
 *    request and refuses to build one without them (`agent "<id>" has no
 *    provider/model: set AgentOptions.provider and AgentOptions.model or supply
 *    both via the agent/request waterfall`). The deployment's prompt sections
 *    interpolate `{{provider}}`/`{{model}}` from the same field — the persona
 *    prefix does — so an agent created without options cannot even assemble its
 *    system prompt: it fails the turn with `prompt variable "{{model}}" has no
 *    value for this assembly`. Ordinary sessions get the pair from
 *    `agentDefaultModel.currentSelection()` at creation time.
 * 2. **The session's own selection.** A conversation that has picked a model,
 *    or already run with one, must keep it across a reload. Ordinary sessions
 *    get that from a selection reference the controller installs on the agent;
 *    the installation itself is not public API, but *the call that creates it*
 *    is — `sessionController.selectModel`, the same wire call the host
 *    composer's model seat makes. Card sessions go through that call, so the
 *    policy stays the controller's rather than being re-derived here.
 *
 * The two are ordered by specificity: a fresh conversation starts on the
 * deployment default, a conversation with recorded intent keeps it, and a pick
 * made while it is live (the composer's picker) overrides both — the selection
 * the controller installs rewrites the assembled prompt variables *and* the
 * request, so it wins over whatever options the agent was created with.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'

/** One provider/model pair, as the catalog and the selection projection name it. */
export interface ModelChoice {
  provider: string
  model: string
  /** Adapter-owned effort, present only when the route pins one. */
  reasoningEffort?: string
}

/**
 * The `modelSelection` projection state for one session
 * (`dsh-api-session-controller`'s own view schema, ported as data).
 *
 * `pending` is a choice recorded but not yet consumed by a request; `lastUsed`
 * is what the last request ran with. Both `null` means the conversation has no
 * model intent at all — the only state in which the deployment default speaks.
 */
interface ModelSelectionState {
  readonly pending: ModelChoice | null
  readonly lastUsed: ModelChoice | null
}

/**
 * The host services this module reads, resolved once at plugin load.
 *
 * Each is optional on purpose: a deployment that ships the canvas without the
 * session controller (or a unit test) still composes the board — the card
 * conversations then run on whatever the loop's own waterfall supplies.
 */
export interface ModelFaces {
  /** `agentDefaultModel`: the pair a brand-new conversation starts on. */
  defaultModel?: { currentSelection(): ModelChoice } | undefined
  /** `sessionController`: the Host's own selection door. */
  controller?:
    | {
        selectModel(request: {
          sessionId: string
          provider: string
          model: string
          reasoningEffort?: string
        }): Promise<unknown>
      }
    | undefined
  /** `sessionProjections`: the durable model intent of one loaded session. */
  projections?: { stateOf(session: Session, key: string): unknown } | undefined
}

/**
 * Resolve the faces from a Host context.
 *
 * Read through getters rather than captured once: this plugin's own `inject`
 * list does not name the session controller (it is not a hard requirement — a
 * deployment may compose the canvas without it), so it may well register
 * *after* this plugin loads. A captured `undefined` would silently leave every
 * card conversation unable to assemble its prompt.
 */
export function modelFaces(ctx: Context): ModelFaces {
  return {
    get defaultModel() {
      return ctx.get('agentDefaultModel') as ModelFaces['defaultModel']
    },
    get controller() {
      return ctx.get('sessionController') as ModelFaces['controller']
    },
    get projections() {
      return ctx.get('sessionProjections') as ModelFaces['projections']
    },
  }
}

/**
 * The model a card conversation runs on, kept in step with the Host's own rule.
 *
 * Stateless apart from one weak set: {@link align} is about *agents*, which the
 * factory mints fresh on every create and resume, so "already aligned" can only
 * be a property of the agent itself — and a weak key means a released
 * conversation leaves nothing behind.
 */
export class ModelRouting {
  /** Agents that have already been handed their session's intent. */
  private readonly aligned = new WeakSet<Agent>()

  constructor(private readonly faces: ModelFaces) {}

  /**
   * The options a brand-new card conversation should be created with.
   *
   * `undefined` when the deployment default is unreadable — the caller then
   * omits `agentOptions` rather than inventing a route: a wrong provider would
   * fail deeper, at the adapter, with a message about the wrong thing.
   */
  agentOptions(): Pick<AgentOptions, 'provider' | 'model'> | undefined {
    const selection = this.faces.defaultModel?.currentSelection()
    if (selection === undefined || selection === null) return undefined
    return { provider: selection.provider, model: selection.model }
  }

  /**
   * The model a session already intends to use, if it has one.
   *
   * Read from the session's own projection rather than from a list request: the
   * log is already loaded by the time an agent is live, and the projection is
   * folded from it, so this cannot disagree with what the conversation shows.
   */
  intentOf(session: Session): ModelChoice | undefined {
    const state = this.faces.projections?.stateOf(session, 'modelSelection') as
      | ModelSelectionState
      | undefined
    if (state === undefined || state === null) return undefined
    return state.pending ?? state.lastUsed ?? undefined
  }

  /**
   * Give one freshly opened agent the model its session already intends.
   *
   * This is what carries a choice across a plugin reload: the selection lives in
   * the session log, the live agent does not, and a resumed agent is created
   * with the deployment default. It is also why the install is idempotent per
   * agent — the second open of the same conversation finds a selection the
   * controller already installed (and a `pending` cleared by the run that
   * consumed it), so the guard is "already aligned", not "already selected".
   *
   * @param agent - the live card agent, already published.
   * @param sessionId - its durable identity, for the controller's call.
   * @returns whether a selection was installed.
   * @throws whatever the controller throws: the caller decides whether a
   *   conversation that cannot be re-pointed is worth failing the open for.
   */
  async align(agent: Agent, sessionId: string): Promise<boolean> {
    if (this.faces.controller === undefined || this.aligned.has(agent)) return false
    this.aligned.add(agent)
    const intent = this.intentOf(agent.session)
    if (intent === undefined) return false
    const routed = agent.options
    if (routed.provider === intent.provider && routed.model === intent.model) return false
    await this.faces.controller.selectModel({
      sessionId,
      provider: intent.provider,
      model: intent.model,
      ...intent.reasoningEffort === undefined ? {} : { reasoningEffort: intent.reasoningEffort },
    })
    return true
  }
}
