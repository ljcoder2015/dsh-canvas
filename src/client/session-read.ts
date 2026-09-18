/**
 * dsh-canvas — reading card state off the sessions domain.
 *
 * The board is deliberately silent about how a card's conversation is doing
 * (§4.8: subscribe, never mirror). Everything in this module derives a card's
 * face from the two live faces the framework already owns:
 *
 *   - `ctx.sessions.list` — the session rows, which carry `running`, the
 *     pending-interaction flag and the finished-while-away flag.
 *   - `SessionFace` — the per-session `ObservableSnapshot<ConversationSnapshot>`
 *     obtained from `ctx.sessions.binding(id).session`, which is how a card's
 *     last message is read without that card being the current session.
 *
 * Both are read-only here: nothing in this file writes to a session.
 */
import type { ConversationSnapshot, SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'

/** The card state the board draws as a status dot. */
export type CardState = 'running' | 'notified' | 'idle' | 'missing'

/**
 * Derive one card's state (F3.5).
 *
 * A file that is gone outranks every session state: the card's dot must say
 * "this artifact is missing" even if its conversation is still running,
 * because the missing file is the thing the user has to fix.
 *
 * @param summary - the session row, or `undefined` when no session is bound.
 * @param present - whether the bound file currently exists on disk.
 * @returns the state to draw.
 */
export function cardStateOf(summary: SessionSummary | undefined, present: boolean): CardState {
  if (!present) return 'missing'
  if (summary === undefined) return 'idle'
  if (summary.running) return 'running'
  if (summary.pendingInteraction !== undefined || summary.completed === true) return 'notified'
  return 'idle'
}

/**
 * Structural view of the session list, for the same reason as
 * {@link SnapshotShape}: the fields the type calls required are still fields
 * the store can hand over before it has assembled them.
 */
interface ListShape {
  readonly ids?: unknown
  readonly byId?: Record<string, SessionSummary | undefined>
}

/** The session row bound to a card, or `undefined` before the session exists. */
export function summaryOf(state: SessionListState, sessionId: string): SessionSummary | undefined {
  if (sessionId === '') return undefined
  return (state as ListShape).byId?.[sessionId]
}

/**
 * A cheap monotonic signal that the sessions domain moved.
 *
 * Used as a refresh trigger for board reads: a tool call that moved a card is
 * recorded in the domain, and the conversation event that carried it is the
 * only thing the browser can observe. Counting running sessions and summing
 * update stamps gives an integer that changes when either does, without
 * diffing anything.
 *
 * @param state - the session list snapshot.
 * @returns an integer that changes whenever the list meaningfully changed.
 */
export function activityOf(state: SessionListState): number {
  const view = state as ListShape
  const ids: readonly string[] = Array.isArray(view.ids) ? (view.ids as readonly string[]) : []
  let running = 0
  let latest = 0
  for (const id of ids) {
    const row = view.byId?.[id]
    if (row === undefined) continue
    if (row.running) running += 1
    if (row.updatedAt > latest) latest = row.updatedAt
  }
  return running * 1_000_000_003 + (latest % 1_000_000_003)
}

/** Structural view of a content/assistant block, for text extraction without naming the LLM's block union. */
interface TextBearing {
  readonly text?: unknown
  readonly name?: unknown
}

/**
 * Structural view of one conversation node: only the fields this module reads.
 *
 * Every field is `unknown` on purpose. The node union is the framework's, and
 * a node built by a view target this module does not know is still a node the
 * store will hand over; naming a narrower shape here would only move the lie
 * from the checker to the runtime.
 */
interface NodeShape {
  readonly kind?: unknown
  readonly content?: unknown
  readonly blocks?: unknown
}

/**
 * Structural view of a conversation snapshot.
 *
 * The board is handed snapshots the store may not have finished assembling: a
 * session row can be listed while its window is still `cold`/`loading`, and
 * the `nodes` list the overlay reads is documented as a *legacy compatibility
 * mirror* that exists only once the conversation has been assembled. Reading
 * through this shape is what keeps a half-built snapshot from throwing — a
 * selector that throws takes down the whole slot hosting the board, which is
 * how a cold session took the canvas page with it.
 */
interface SnapshotShape {
  readonly nodes?: unknown
  readonly partial?: unknown
}

/**
 * Pull the readable text out of one block list, in order.
 *
 * Tolerates an absent or malformed list: the caller is reading a store that
 * may hand over a partially assembled snapshot, and "no blocks" is a normal
 * state, not an error.
 */
function textOf(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const block of blocks) {
    const candidate = block as TextBearing
    if (typeof candidate.text === 'string' && candidate.text.trim() !== '') parts.push(candidate.text.trim())
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** The last thing said in a conversation, whatever kind of node said it. */
export interface LatestLine {
  /** Who said it: `user`, `assistant`, or `''` when nobody has spoken. */
  readonly from: 'user' | 'assistant' | ''
  /** One flattened line of text, already collapsed to single spaces. */
  readonly text: string
}

/**
 * Read the most recent message of a conversation.
 *
 * Walks the node list backwards and takes the first node that carries text.
 * Tool calls and other structural nodes are skipped rather than rendered as
 * noise: the overlay is one line, and a tool name is not something the user
 * said. The caller decides what to show when nobody has spoken yet.
 *
 * Every read here is defensive. A snapshot with no node list (window still
 * cold, or a session whose conversation has not been assembled yet) reads as
 * "nobody has spoken", which is exactly what the caller draws — the overlay
 * would rather show its empty state than crash the board it sits on.
 *
 * @param snapshot - one session's conversation snapshot.
 * @returns the speaker and the line.
 */
export function latestLine(snapshot: ConversationSnapshot | undefined): LatestLine {
  if (snapshot === undefined) return { from: '', text: '' }
  const view = snapshot as SnapshotShape
  const nodes: readonly NodeShape[] = Array.isArray(view.nodes) ? (view.nodes as readonly NodeShape[]) : []

  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (node === undefined) continue
    if (node.kind === 'user' || node.kind === 'steering') {
      const text = textOf(node.content)
      if (text !== '') return { from: 'user', text }
      continue
    }
    if (node.kind === 'assistant') {
      const text = textOf(node.blocks)
      if (text !== '') return { from: 'assistant', text }
      continue
    }
  }

  const partial = view.partial
  if (partial !== null && partial !== undefined) {
    const text = textOf((partial as { blocks?: unknown }).blocks)
    if (text !== '') return { from: 'assistant', text }
  }

  return { from: '', text: '' }
}
