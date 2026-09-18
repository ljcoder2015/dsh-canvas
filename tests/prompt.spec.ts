/**
 * The prompt layer: how a card describes itself and its material (F5.2).
 *
 * `renderMaterial` is the payload the pull path injects, so its shape is
 * checked literally: identity, path and structure lead, the body is indented
 * under them, and a card that sources from nothing contributes no heading at
 * all rather than an empty section.
 */
import { describe, expect, it } from 'vitest'
import { renderMaterial, userPromptMessage } from '../src/prompt.ts'
import type { CardSummary } from '../src/types.ts'

/** One digest, with only the fields under test spelled out. */
const digest = (over: Partial<CardSummary> = {}): CardSummary => ({
  cardId: 'brief.md',
  kind: 'markdown',
  path: '/proj/brief.md',
  summary: 'A short brief.',
  outline: ['Goal', 'Audience'],
  bytes: 16,
  updatedAt: 0,
  ...over,
})

describe('renderMaterial', () => {
  it('contributes nothing when the card sources from nothing', () => {
    expect(renderMaterial([])).toBe('')
  })

  it('leads with identity, path and structure, then the body', () => {
    const lines = renderMaterial([digest()]).split('\n')
    expect(lines[0]).toBe('### Sourced material')
    expect(lines[1]).toBe('')
    expect(lines[2]).toBe('- **brief.md** (markdown) → /proj/brief.md')
    expect(lines[3]).toBe('  结构：Goal / Audience')
    expect(lines[4]).toBe('  A short brief.')
  })

  it('indents every line of a multi-line body so it stays under its entry', () => {
    expect(renderMaterial([digest({ summary: 'first\nsecond' })])).toContain('  first\n  second')
  })

  it('omits the structure line when the artifact has no outline', () => {
    expect(renderMaterial([digest({ outline: [] })])).not.toContain('结构')
  })

  it('keeps one entry per digest, in the order given', () => {
    const text = renderMaterial([digest(), digest({ cardId: 'deck.html', kind: 'html-deck' })])
    expect(text.match(/^- \*\*/gm)).toHaveLength(2)
    expect(text.indexOf('brief.md')).toBeLessThan(text.indexOf('deck.html'))
  })
})

describe('userPromptMessage', () => {
  it('attributes the words to the user, not to the plugin', () => {
    const message = userPromptMessage('把封面改成横版')
    expect(message.role).toBe('user')
    expect(message.source).toEqual({ kind: 'user' })
  })

  it('carries the prompt as its single text block', () => {
    const message = userPromptMessage('按 brief 生成 deck')
    expect(message.content).toEqual([{ type: 'text', text: '按 brief 生成 deck' }])
  })
})
