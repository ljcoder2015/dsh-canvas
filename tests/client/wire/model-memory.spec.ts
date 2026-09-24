/**
 * The node-type model memory: which key a card is filed under, that a stale
 * catalog entry never resurfaces, and that a browser without storage degrades
 * to "no memory" instead of breaking the composer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nodeTypeOf, recallModel, rememberModel, selectionOf } from '../../../src/client/wire/model-memory.ts'
import type { ModelCatalog } from '../../../src/client/wire/bridge.ts'
import type { BoardCard, CardSummary } from '../../../src/types.ts'

/** A minimal in-memory stand-in for `window.localStorage`. */
function installStorage(): void {
  const entries = new Map<string, string>()
  const store = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value)
    },
    removeItem: (key: string) => {
      entries.delete(key)
    },
  }
  vi.stubGlobal('window', { localStorage: store })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const catalog: ModelCatalog = {
  default: { provider: 'deepseek', model: 'chat' },
  groups: [
    { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }, { id: 'reasoner', name: 'Reasoner' }] },
    { id: 'anthropic', name: 'Anthropic', models: [] },
  ],
}

/** A card with only the fields the memory reads. */
function card(kind: string): BoardCard {
  return {
    id: 'untitled.md',
    file: 'untitled.md',
    name: 'untitled',
    project: 'p',
    kind,
    kindLabel: kind,
    position: { x: 0, y: 0 },
    sessionId: 's-1',
    missing: false,
  }
}

/** A digest with only the kind read. */
function summary(kind: string): CardSummary {
  return { cardId: 'untitled.md', kind, path: '/p/untitled.md', summary: '', outline: [], head: '', bytes: 0, updatedAt: 0 }
}

describe('node-type model memory', () => {
  it('files a card under its recognized kind, falling back to the seated one', () => {
    expect(nodeTypeOf(card('markdown'), summary('html-deck'))).toBe('html-deck')
    expect(nodeTypeOf(card('markdown'), undefined)).toBe('markdown')
    // A digest whose kind came back empty must not blank the key.
    expect(nodeTypeOf(card('image'), summary(''))).toBe('image')
  })

  it('carries a pick from one node type to the next, and only for that type', () => {
    installStorage()
    rememberModel('markdown', { provider: 'deepseek', model: 'reasoner' })
    expect(recallModel('markdown', catalog)).toEqual({ provider: 'deepseek', model: 'reasoner' })
    expect(recallModel('image', catalog)).toBeUndefined()
  })

  it('ignores a remembered model the current catalog no longer offers', () => {
    installStorage()
    rememberModel('markdown', { provider: 'deepseek', model: 'retired' })
    expect(recallModel('markdown', catalog)).toBeUndefined()

    rememberModel('markdown', { provider: 'removed-provider', model: 'chat' })
    expect(recallModel('markdown', catalog)).toBeUndefined()
  })

  it('needs a catalog to verify against, so an unavailable one recalls nothing', () => {
    installStorage()
    rememberModel('markdown', { provider: 'deepseek', model: 'chat' })
    expect(recallModel('markdown', undefined)).toBeUndefined()
  })

  it('treats unreadable storage as "no memory" rather than failing', () => {
    installStorage()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => '{ not json',
        setItem: () => {
          throw new Error('quota exceeded')
        },
      },
    })
    expect(recallModel('markdown', catalog)).toBeUndefined()
    expect(() => rememberModel('markdown', { provider: 'deepseek', model: 'chat' })).not.toThrow()
  })

  it('reads the pending selection first, then what the last request used', () => {
    expect(selectionOf(undefined)).toBeUndefined()
    expect(selectionOf({ lastUsed: null, next: null })).toBeUndefined()
    expect(selectionOf({ lastUsed: { provider: 'deepseek', model: 'chat' }, next: null })).toEqual({
      provider: 'deepseek',
      model: 'chat',
    })
    expect(
      selectionOf({
        lastUsed: { provider: 'deepseek', model: 'chat' },
        next: { provider: 'deepseek', model: 'reasoner' },
      }),
    ).toEqual({ provider: 'deepseek', model: 'reasoner' })
  })
})
