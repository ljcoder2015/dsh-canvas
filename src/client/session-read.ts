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

/** The session row bound to a card, or `undefined` before the session exists. */
export function summaryOf(state: SessionListState, sessionId: string): SessionSummary | undefined {
  if (sessionId === '') return undefined
  return state.byId[sessionId]
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
  let running = 0
  let latest = 0
  for (const id of state.ids) {
    const row = state.byId[id]
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

/** Pull the readable text out of one block list, in order. */
function textOf(blocks: readonly unknown[]): string {
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
 * @param snapshot - one session's conversation snapshot.
 * @returns the speaker and the line.
 */
export function latestLine(snapshot: ConversationSnapshot | undefined): LatestLine {
  if (snapshot === undefined) return { from: '', text: '' }
  const nodes = snapshot.nodes

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

  const partial = snapshot.partial
  if (partial !== null) {
    const text = textOf(partial.blocks)
    if (text !== '') return { from: 'assistant', text }
  }

  return { from: '', text: '' }
}
