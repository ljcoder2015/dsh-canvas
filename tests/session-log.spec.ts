/**
 * The composer's seed (F3.9): reading a card session's own words off its raw
 * event log.
 *
 * The distinction under test is the feature: a session's log carries the
 * user's messages *and* every message a plugin pushed in (`agent.inject` —
 * the canvas's own sourced-material injection writes there), told apart only
 * by the message's `source`. Offering a plugin's words back to the user as
 * their own would be the one way this feature could be wrong.
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { lastUserPromptOfEvents } from '../src/core/session-log.ts'

/** One `user/message` event as the log stores it. */
const userEvent = (text: string, time = 0, source: unknown = { kind: 'user' }): SessionEvent =>
  ({
    type: 'user/message',
    seq: 1,
    time,
    data: { id: 'm1', role: 'user', content: [{ type: 'text', text }], source },
  }) as unknown as SessionEvent

const assistantEvent = (text: string): SessionEvent =>
  ({
    type: 'assistant/message',
    seq: 2,
    time: 0,
    data: { id: 'm2', role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model' } },
  }) as unknown as SessionEvent

const toolResultEvent = (text: string): SessionEvent =>
  ({
    type: 'tool/result',
    seq: 3,
    time: 0,
    data: { id: 'm3', content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text }] }] },
  }) as unknown as SessionEvent

describe('lastUserPromptOfEvents', () => {
  it('reads nothing out of an empty log', () => {
    expect(lastUserPromptOfEvents([])).toEqual({ text: '', time: 0 })
  })

  it('takes the newest message the user typed, skipping replies and tool traffic', () => {
    const events = [
      userEvent('first question'),
      assistantEvent('the answer'),
      toolResultEvent('raw output'),
      userEvent('second question', 9_000),
      assistantEvent('the second answer'),
    ]
    expect(lastUserPromptOfEvents(events)).toEqual({ text: 'second question', time: 9_000 })
  })

  it('walks past injected context, which is the plugin talking and not the user', () => {
    // `agent.inject` writes a plugin-sourced user-role message; the composer
    // must not offer it back for editing, and must still find the user's own
    // words beneath it.
    const events = [
      userEvent('write a poem'),
      userEvent('Material injected from canvas card `a.md` (markdown).', 1_000, {
        kind: 'plugin',
        plugin: 'dsh-canvas',
        form: 'notice',
        summary: '取材 a.md',
      }),
    ]
    expect(lastUserPromptOfEvents(events)).toEqual({ text: 'write a poem', time: 0 })
  })

  it('keeps line breaks, because the composer hands the text back for editing', () => {
    // The opposite of the overlay line reader, which flattens: collapsing here
    // would silently rewrite a prompt the user might send again.
    const events = [userEvent('line one\nline two\n\nline four')]
    expect(lastUserPromptOfEvents(events).text).toBe('line one\nline two\n\nline four')
  })

  it('joins multiple text blocks with their paragraph breaks kept', () => {
    const event = {
      type: 'user/message',
      seq: 1,
      time: 4_000,
      data: {
        id: 'm1',
        role: 'user',
        content: [{ type: 'text', text: 'part one' }, { type: 'text', text: 'part two' }],
        source: { kind: 'user' },
      },
    } as unknown as SessionEvent
    expect(lastUserPromptOfEvents([event])).toEqual({ text: 'part one\n\npart two', time: 4_000 })
  })

  it('reads nothing when only the assistant has spoken', () => {
    expect(lastUserPromptOfEvents([assistantEvent('hello')])).toEqual({ text: '', time: 0 })
  })

  it('skips a user-role message whose text is empty rather than stopping the walk', () => {
    const events = [userEvent('the real one'), userEvent('   ')]
    expect(lastUserPromptOfEvents(events)).toEqual({ text: 'the real one', time: 0 })
  })

  it('survives a malformed entry without letting it take down the read', () => {
    const broken = { type: 'user/message', seq: 1, time: 0, data: null } as unknown as SessionEvent
    expect(lastUserPromptOfEvents([broken, userEvent('still works')])).toEqual({ text: 'still works', time: 0 })
  })
})
