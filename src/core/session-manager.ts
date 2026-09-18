/**
 * dsh-canvas — card ⇄ session binding (F3.1–F3.6).
 *
 * The one hard constraint (§4.5, §5): a session created with
 * `ctx.sessions.create()` is owned by the calling fiber and is **not
 * persisted**. A card's conversation must survive the card being closed and
 * the view being reloaded, so every card session is created through the agent
 * lifecycle — `ctx.agents.create()` — which runs the prepare/enter/announce
 * transaction and attaches the log writer.
 *
 * This manager owns nothing durable: the binding is already a field of the card
 * record. What it owns is the *process* side — which agents are currently live,
 * and the reverse lookup that lets a tool answer "which card is asking?".
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CardId, ProjectId, SessionId } from '../types.ts'
import { encodeSegment } from './ids.ts'

/** One live card session. */
export interface CardSession {
  project: ProjectId
  cardId: CardId
  sessionId: SessionId
  /** The agent driving the session; its `ctx` is the card's prompt/tool scope. */
  agent: Agent
  /** Releases the agent; the persisted log stays on disk. */
  dispose: () => Promise<void>
}

/** Creates one card's agent. Injected so this manager stays container-free. */
export type CardSessionFactory = (ownerCtx: Context) => Promise<{ agent: Agent; dispose: () => Promise<void> }>

/**
 * Storage key of a card inside its project.
 *
 * Per-record storage turns keys into file-path segments, so a key may only
 * hold `[a-zA-Z0-9_-]` — the card id (a relative path with `/` and `.`) is
 * hex-escaped, `_` itself included, which keeps the mapping reversible
 * without a lookup table.
 */
export function cardKeyOf(project: ProjectId, cardId: CardId): string {
  return `${project}-${encodeSegment(cardId)}`
}

/**
 * Card id of a key stored under one known project (reverse of
 * {@link cardKeyOf}). The caller always has the project at hand — it comes
 * from the record's own `project` field, so the key needs no delimiter.
 */
export function cardIdOfKey(project: ProjectId, key: string): CardId {
  return decodeSegment(key.slice(project.length + 1))
}

/** Undo {@link encodeSegment}; fixed-width escapes cannot be ambiguous. */
function decodeSegment(segment: string): string {
  return segment.replace(/_([0-9a-f]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
}

/**
 * Tracks the live card sessions of one plugin instance.
 *
 * Both directions are indexed: the board asks "does this card have a session
 * yet?", and a tool run by that session asks "which card am I?". The second
 * lookup is what makes session isolation structural rather than a prompt
 * convention (§4.5): a tool that cannot resolve a card refuses to run.
 */
export class SessionManager {
  private readonly byKey = new Map<string, CardSession>()
  private readonly bySession = new Map<SessionId, CardSession>()

  constructor(private readonly ctx: Context) {}

  /** The live session of a card, if one is currently open. */
  live(project: ProjectId, cardId: CardId): CardSession | undefined {
    return this.byKey.get(cardKeyOf(project, cardId))
  }

  /** The card a live session belongs to — the identity check every tool performs. */
  cardOf(sessionId: SessionId): CardSession | undefined {
    return this.bySession.get(sessionId)
  }

  /** Every live card session, for disposal on unload. */
  all(): CardSession[] {
    return [...this.byKey.values()]
  }

  /**
   * Open a card's session, or return the one already open.
   *
   * `create` is injected rather than called directly so the manager stays
   * testable without a container, and so the caller owns the decision of
   * *which* session a card re-attaches to and how that agent's scope is
   * composed.
   */
  async open(
    project: ProjectId,
    cardId: CardId,
    create: CardSessionFactory,
  ): Promise<{ session: CardSession; created: boolean }> {
    const existing = this.live(project, cardId)
    if (existing !== undefined) {
      // A live agent already drives this card. Re-attaching is the caller's
      // job (the sidebar focuses the session); here it is simply reused.
      return { session: existing, created: false }
    }

    const handle = await create(this.ctx)
    const session: CardSession = {
      project,
      cardId,
      sessionId: handle.agent.id,
      agent: handle.agent,
      dispose: handle.dispose,
    }
    this.byKey.set(cardKeyOf(project, cardId), session)
    this.bySession.set(session.sessionId, session)
    return { session, created: true }
  }

  /**
   * Close a card's session (F3.4).
   *
   * The binding recorded on the card record is left alone: the log is durable,
   * so reopening the card re-attaches to the same conversation. This only
   * releases the process-side agent.
   */
  async release(project: ProjectId, cardId: CardId): Promise<boolean> {
    const key = cardKeyOf(project, cardId)
    const session = this.byKey.get(key)
    if (session === undefined) return false
    await this.forget(session)
    return true
  }

  /** Release every live session; the plugin's unload path. */
  async releaseAll(): Promise<void> {
    for (const session of this.all()) await this.forget(session)
  }

  private async forget(session: CardSession): Promise<void> {
    this.byKey.delete(cardKeyOf(session.project, session.cardId))
    this.bySession.delete(session.sessionId)
    try {
      await session.dispose()
    } catch {
      // A session that already died is not an error worth surfacing: the
      // durable log is the source of truth and the binding is unaffected.
    }
  }
}
