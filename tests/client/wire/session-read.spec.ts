/**
 * The board's reading layer: what a card's conversation looks like from outside.
 *
 * These cases exist because of one crash: the overlay's line reader assumed
 * `snapshot.nodes` was always an array, and a session whose window had not been
 * assembled yet handed it `undefined` — which took down the whole slot hosting
 * the board. Every "missing" case below is a shape the store really produces.
 *
 * The composer's prompt seed is a different reader over a different source (the
 * Host's session logs, `core/session-log.ts`); its cases live in
 * `tests/session-log.spec.ts`.
 */
import { describe, expect, it } from 'vitest'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { activityOf, cardStateOf, latestLine, summaryOf } from '../../../src/client/wire/session-read.ts'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'

/** A snapshot as the store hands it over; only the fields under test are set. */
const snapshot = (fields: Record<string, unknown>): ConversationSnapshot =>
  fields as unknown as ConversationSnapshot

const user = (text: string) => ({ kind: 'user', seq: 1, time: 0, content: [{ type: 'text', text }], source: null })
const assistant = (text: string) => ({ kind: 'assistant', seq: 2, time: 0, blocks: [{ kind: 'text', text }] })

describe('latestLine', () => {
  it('reads nothing out of an absent snapshot', () => {
    expect(latestLine(undefined)).toEqual({ from: '', text: '' })
  })

  it('survives a snapshot whose node list has not been assembled yet', () => {
    // The reported crash: a listed session whose window is still cold/loading.
    expect(latestLine(snapshot({ openState: 'loading' }))).toEqual({ from: '', text: '' })
  })

  it('survives a node list that is not an array', () => {
    // `chat.nodes` is a live keyed store, not a list; it must not crash either.
    expect(latestLine(snapshot({ nodes: { get: () => undefined, values: () => [] } }))).toEqual({
      from: '',
      text: '',
    })
  })

  it('reads an empty conversation as nobody having spoken', () => {
    expect(latestLine(snapshot({ nodes: [], partial: null }))).toEqual({ from: '', text: '' })
  })

  it('takes the last thing said, skipping nodes that carry no text', () => {
    const value = snapshot({
      nodes: [
        user('first question'),
        { kind: 'tool-result', seq: 2, time: 0, callId: 'c1', content: [{ type: 'text', text: 'raw output' }] },
        assistant('the answer'),
      ],
      partial: null,
    })
    expect(latestLine(value)).toEqual({ from: 'assistant', text: 'the answer' })
  })

  it('prefers a steering message over the assistant turn it interrupted', () => {
    const value = snapshot({
      nodes: [
        assistant('start of a turn'),
        { kind: 'steering', seq: 3, time: 0, content: [{ type: 'text', text: 'actually, hold on' }] },
      ],
      partial: null,
    })
    expect(latestLine(value)).toEqual({ from: 'user', text: 'actually, hold on' })
  })

  it('survives a node whose block list is missing', () => {
    const value = snapshot({ nodes: [{ kind: 'assistant', seq: 1, time: 0 }, user('fallback')], partial: null })
    expect(latestLine(value)).toEqual({ from: 'user', text: 'fallback' })
  })

  it('falls back to the in-flight partial when no node carries text', () => {
    const value = snapshot({ nodes: [], partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: 'typing…' }] } })
    expect(latestLine(value)).toEqual({ from: 'assistant', text: 'typing…' })
  })

  it('survives a partial with no blocks', () => {
    expect(latestLine(snapshot({ nodes: [], partial: { turn: 1, step: 1 } }))).toEqual({ from: '', text: '' })
  })

  it('collapses a line to single spaces', () => {
    const value = snapshot({ nodes: [assistant('one\n  two   three')], partial: null })
    expect(latestLine(value)).toEqual({ from: 'assistant', text: 'one two three' })
  })
})

describe('cardStateOf', () => {
  const row = (fields: Partial<SessionSummary>): SessionSummary => fields as SessionSummary

  it('lets an artifact proven gone outrank every session state', () => {
    expect(cardStateOf(row({ running: true }), true)).toBe('missing')
  })

  it('reads a bound session that is running as running', () => {
    expect(cardStateOf(row({ running: true }), false)).toBe('running')
  })

  it('reads a finished or pending session as notified', () => {
    expect(cardStateOf(row({ running: false, completed: true }), false)).toBe('notified')
  })

  it('reads a card with no session as idle', () => {
    expect(cardStateOf(undefined, false)).toBe('idle')
  })
})

describe('summaryOf and activityOf', () => {
  const state: SessionListState = {
    ids: ['a', 'b'],
    byId: { a: { running: false, updatedAt: 10 } as SessionSummary, b: { running: true, updatedAt: 20 } as SessionSummary },
  } as unknown as SessionListState

  it('finds the session row bound to a card, and nothing for an unbound card', () => {
    expect(summaryOf(state, 'b')?.updatedAt).toBe(20)
    expect(summaryOf(state, '')).toBeUndefined()
    expect(summaryOf(state, 'nope')).toBeUndefined()
  })

  it('signals a change when a session starts running', () => {
    const idle: SessionListState = { ids: ['a'], byId: { a: { running: false, updatedAt: 10 } as SessionSummary } } as unknown as SessionListState
    expect(activityOf(state)).not.toBe(activityOf(idle))
  })

  it('says nothing changed when the rows are identical', () => {
    expect(activityOf(state)).toBe(activityOf({ ...state }))
  })

  it('survives a list the store has not assembled yet', () => {
    // Same failure mode as the node list: the type says required, the store says otherwise.
    const bare = {} as unknown as SessionListState
    expect(activityOf(bare)).toBe(0)
    expect(summaryOf(bare, 'a')).toBeUndefined()
  })
})
