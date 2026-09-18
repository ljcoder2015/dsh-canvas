/**
 * dsh-canvas — reading a card session's own words back (F3.9).
 *
 * The card composer shows the user's latest message to that card. On the wire
 * this is one small read, but the reading itself has a real distinction to
 * uphold: a session's log carries the user's messages *and* every message a
 * plugin pushed in (`agent.inject` — how the canvas hands a card its sourced
 * material). Those ride the same `user/message` event type, told apart only by
 * the message's `source`. Only `source.kind === 'user'` is the user talking;
 * everything else is context and must never be offered back for editing.
 *
 * The log is read through the deployment's `ctx.sessionQuery` service, which
 * serves both live sessions and cold ones straight from persistence — a card
 * whose conversation nobody has opened on this page is exactly the case the
 * composer needs, and the browser's live projection cannot answer it.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { LastPrompt } from '../types.ts'

/** The `ctx.sessionQuery` service, at the one method this plugin needs. */
export interface SessionQueryFace {
  /**
   * Read one session's complete event log — live or persisted — without making
   * it live. Mirrors the documented `sessionQuery.readSession` contract.
   */
  readSession(sessionId: string): Promise<{ events: readonly SessionEvent[] }>
}

/**
 * Read the service by name. It is deployment-provided rather than a dependency
 * of this package, and a deployment without it still runs — the composer then
 * simply has nothing to seed from.
 */
export function sessionQueryFace(ctx: Context): SessionQueryFace | undefined {
  return ctx.get('sessionQuery') as SessionQueryFace | undefined
}

/** Pull the verbatim text out of one message's content blocks. */
function verbatimOf(content: readonly ContentBlock[] | undefined): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block !== undefined && block !== null && block.type === 'text' && block.text.trim() !== '') parts.push(block.text)
  }
  return parts.join('\n\n').trim()
}

/**
 * The newest message the user typed, from a session's raw event log.
 *
 * Walks backwards and takes the first `user/message` whose source is the user.
 * Plugin-sourced messages are skipped, not treated as failure — the walk
 * continues past them, because the user's words may sit below a stack of
 * injected context.
 *
 * The text comes back verbatim, newlines and all: the caller fills an editable
 * box with it, and flattening it would silently rewrite a prompt the user may
 * send again.
 *
 * The read is defensive on purpose: persistence replays are validated, but the
 * vocabulary is plugin-extensible and this reader must never be the code that
 * turns an unexpected shape into a failed card selection.
 *
 * @param events - one session's raw event log, oldest first.
 * @returns the newest user-typed message, or the empty reading.
 */
export function lastUserPromptOfEvents(events: readonly SessionEvent[]): LastPrompt {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined || event.type !== 'user/message') continue
    const data = event.data as { source?: { kind?: unknown }; content?: readonly ContentBlock[] } | undefined | null
    if (data === undefined || data === null || data.source === undefined || data.source === null) continue
    if (data.source.kind !== 'user') continue
    const text = verbatimOf(data.content)
    if (text !== '') return { text, time: typeof event.time === 'number' ? event.time : 0 }
  }
  return { text: '', time: 0 }
}
