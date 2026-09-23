/**
 * The board file: the canvas a folder carries with it (F1.9 / F1.10).
 *
 * Two regressions are pinned here.
 *
 * **A rename used to mint a new canvas.** A project id was the digest of its
 * root path, so `mv notes canvas` produced a second canvas with an empty board
 * while the first one kept its records but no longer had a directory — and
 * nothing ever cleaned it up. The fix is an identity *inside* the folder (the
 * `id` in its board file), so the folder can be moved, renamed, copied or
 * handed to another machine and still be recognized as the same canvas.
 *
 * **A carried board had to be importable.** Positions, edges and notes now
 * travel; the rules for what to take from the file and what to keep from the
 * storage domain are the interesting part, so they are pure functions and are
 * tested as such — the authority split is the whole content of `planSeats`.
 */
import { describe, expect, it } from 'vitest'
import {
  BOARD_FILE_FORMAT,
  BOARD_FILE_VERSION,
  composeBoardFile,
  mintId,
  parseBoardFile,
  planEdges,
  planIdentity,
  planNotes,
  planSeats,
  type BoardFileContent,
} from '../../../src/core/canvas/board-file.ts'
import type { Source } from '../../../src/types.ts'

/** A board with the shape a real one has: two cards, one edge, one note. */
function board(overrides: Partial<BoardFileContent> = {}): BoardFileContent {
  return {
    id: 'notes-1a2b3c',
    name: 'notes',
    style: { palette: ['#FF7A17'], font: 'Inter', tone: '克制' },
    cards: [
      { id: 'brief.md', position: { x: 48, y: 170 } },
      { id: 'deck.html', position: { x: 336, y: 170 } },
    ],
    sources: [{ downstream: 'deck.html', upstream: 'brief.md', origin: 'manual' }],
    notes: [{ id: 'note-1-a', text: '先定大纲', author: 'user', position: { x: 10, y: 10 }, createdAt: 1 }],
    ...overrides,
  }
}

describe('board file envelope', () => {
  it('round-trips a board through its own text', () => {
    const text = composeBoardFile(board())
    const read = parseBoardFile(text)
    expect(read.kind).toBe('parsed')
    expect(read.kind === 'parsed' ? read.content : undefined).toEqual(board())
  })

  it('writes the same bytes for the same board, whatever order it is handed', () => {
    const shuffled = board({
      cards: [
        { id: 'deck.html', position: { x: 336, y: 170 } },
        { id: 'brief.md', position: { x: 48, y: 170 } },
      ],
    })
    // Byte-identical output is what lets the writer skip a write that would
    // change nothing but a timestamp — no watcher churn, no empty git diff.
    expect(composeBoardFile(shuffled)).toBe(composeBoardFile(board()))
  })

  it('carries an empty seat, and writes nothing at all for a filled one', () => {
    // The exemption a bulk cleanup needs (F1.11) has to survive the folder
    // leaving this machine, so it travels in the board file — as an exception
    // flag rather than a field on every card.
    const filed = board({ cards: [{ id: 'untitled.md', position: { x: 48, y: 170 }, empty: true }] })
    const text = composeBoardFile(filed)
    expect(text).toContain('"empty": true')
    expect(parseBoardFile(text)).toEqual({ kind: 'parsed', content: filed })

    const filled = board({ cards: [{ id: 'brief.md', position: { x: 48, y: 170 } }] })
    expect(composeBoardFile(filled)).not.toContain('empty')
  })

  it('is plain JSON a person can read and edit', () => {
    const text = composeBoardFile(board())
    const raw = JSON.parse(text) as { format: string; version: number; cards: unknown[] }
    expect(raw.format).toBe(BOARD_FILE_FORMAT)
    expect(raw.version).toBe(BOARD_FILE_VERSION)
    expect(raw.cards).toHaveLength(2)
    expect(text.endsWith('\n')).toBe(true)
  })

  it('refuses anything it did not write, rather than guessing', () => {
    expect(parseBoardFile('{').kind).toBe('unreadable')
    expect(parseBoardFile('[]').kind).toBe('unreadable')
    expect(parseBoardFile('{"format":"something-else","version":1,"id":"p"}').kind).toBe('unreadable')
    // A newer format must not be reinterpreted, and must not be overwritten.
    expect(parseBoardFile('{"format":"dsh-canvas-board","version":2,"id":"p"}').kind).toBe('unreadable')
    expect(parseBoardFile('{"format":"dsh-canvas-board","version":1,"id":"  "}').kind).toBe('unreadable')
  })

  it('drops one malformed entry instead of the whole board', () => {
    const text = JSON.stringify({
      format: BOARD_FILE_FORMAT,
      version: BOARD_FILE_VERSION,
      id: 'notes-1a2b3c',
      name: 'notes',
      cards: [{ id: 'brief.md', position: { x: 1, y: 2 } }, { id: 'no-position.md' }, { position: { x: 1, y: 1 } }],
      sources: [{ downstream: 'a.md' }],
      notes: [],
    })
    const read = parseBoardFile(text)
    expect(read.kind).toBe('parsed')
    if (read.kind !== 'parsed') return
    // A half-typed entry costs its own row, not the user's layout.
    expect(read.content.cards).toHaveLength(1)
    // An edge with one end missing is not an edge; dropping it here keeps a
    // dangling reference out of the domain.
    expect(read.content.sources).toHaveLength(0)
    expect(read.content.style).toEqual({ palette: [], font: '', tone: '' })
  })
})

describe('planIdentity', () => {
  const base = { derivedId: 'notes-1a2b3c', taken: [] as string[] }

  it('keeps a canvas that already exists on this deployment', () => {
    expect(
      planIdentity({ ...base, recorded: true, recordedRootIsHere: true, recordedRootPresent: true }),
    ).toEqual({ kind: 'reuse', id: 'notes-1a2b3c' })
  })

  it('follows a folder that was renamed or moved', () => {
    // The record names another path and that path is gone: same canvas, new
    // home. This is the case that used to fork into a second, empty canvas.
    expect(
      planIdentity({ ...base, recorded: true, recordedRootIsHere: false, recordedRootPresent: false }),
    ).toEqual({ kind: 'move', id: 'notes-1a2b3c' })
  })

  it('gives a copy an identity of its own', () => {
    // The original is still there, so this is a second folder claiming the same
    // id — sharing it would mean one board and two folders, where removing a
    // card in one makes it vanish from the other.
    expect(
      planIdentity({
        ...base,
        fileId: 'notes-1a2b3c',
        recorded: true,
        recordedRootIsHere: false,
        recordedRootPresent: true,
        taken: ['notes-1a2b3c'],
      }),
    ).toEqual({ kind: 'copy', id: 'notes-1a2b3c-2' })
  })

  it('takes the id a carried folder claims, and the path digest when there is none', () => {
    expect(planIdentity({ ...base, fileId: 'from-another-machine', recorded: false, recordedRootIsHere: false, recordedRootPresent: false }))
      .toEqual({ kind: 'fresh', id: 'from-another-machine' })
    expect(planIdentity({ ...base, recorded: false, recordedRootIsHere: false, recordedRootPresent: false }))
      .toEqual({ kind: 'fresh', id: 'notes-1a2b3c' })
  })

  it('mints the first free suffix', () => {
    expect(mintId('a', [])).toBe('a')
    expect(mintId('a', ['a'])).toBe('a-2')
    expect(mintId('a', ['a', 'a-2', 'a-3'])).toBe('a-4')
  })
})

describe('planSeats', () => {
  it('seats what the file lists at the position the file remembers', () => {
    const seats = planSeats({ seated: [], filed: board().cards, scanned: [], gap: 88 })
    expect(seats).toEqual([
      { id: 'brief.md', position: { x: 48, y: 170 } },
      { id: 'deck.html', position: { x: 336, y: 170 } },
    ])
  })

  it('never moves a card this deployment already seated', () => {
    // The record is this machine's own, newest state; a stale file must not
    // drag a card the user just placed back to where it used to be.
    const seats = planSeats({
      seated: [{ id: 'brief.md', position: { x: 999, y: 999 } }],
      filed: board().cards,
      scanned: [],
      gap: 88,
    })
    expect(seats).toEqual([{ id: 'deck.html', position: { x: 336, y: 170 } }])
  })

  it('parks a file nobody has seen one step right of the board', () => {
    const seats = planSeats({
      seated: [{ id: 'brief.md', position: { x: 48, y: 170 } }],
      filed: [],
      scanned: ['pasted.html'],
      gap: 88,
    })
    // 48 + 200 (card width) + 88 (gap) — the same seat a first bind has always
    // given a newly discovered file.
    expect(seats).toEqual([{ id: 'pasted.html', position: { x: 336, y: 170 } }])
  })

  it('does not seat a card twice when the file and the disk agree', () => {
    const seats = planSeats({
      seated: [],
      filed: board().cards,
      scanned: ['brief.md', 'deck.html'],
      gap: 88,
    })
    expect(seats.map((seat) => seat.id)).toEqual(['brief.md', 'deck.html'])
  })

  it('keeps a card the file lists even when its artifact is gone', () => {
    // A missing card is a real board state carrying real edges (F3.5), and the
    // user removes it deliberately (F1.11) — an import must not decide that.
    const seats = planSeats({ seated: [], filed: [{ id: 'gone.md', position: { x: 1, y: 2 } }], scanned: [], gap: 88 })
    expect(seats).toEqual([{ id: 'gone.md', position: { x: 1, y: 2 } }])
  })

  it('hands the empty-seat exemption back to the caller, and only when the file claims it', () => {
    // Two filed cards that look identical to the disk, told apart by the file:
    // one was seated before its artifact existed, the other's artifact is gone.
    // Reading that difference back is what keeps a bulk cleanup honest on a
    // machine that never saw either card being created (F1.11).
    const seats = planSeats({
      seated: [],
      filed: [
        { id: 'untitled.md', position: { x: 1, y: 2 }, empty: true },
        { id: 'gone.md', position: { x: 300, y: 2 } },
      ],
      scanned: [],
      gap: 88,
    })
    expect(seats).toEqual([
      { id: 'untitled.md', position: { x: 1, y: 2 }, empty: true },
      { id: 'gone.md', position: { x: 300, y: 2 } },
    ])
  })
})

describe('planEdges / planNotes', () => {
  const existing: Source[] = [
    { id: 'x', project: 'p', downstream: 'b.md', upstream: 'a.md', origin: 'manual' },
  ]

  it('restores carried edges, keeping the origin each one had', () => {
    const added = planEdges({
      filed: [{ downstream: 'c.md', upstream: 'b.md', origin: 'reconciled' }],
      known: ['a.md', 'b.md', 'c.md'],
      existing,
    })
    expect(added).toEqual([{ downstream: 'c.md', upstream: 'b.md', origin: 'reconciled' }])
  })

  it('refuses every edge a hand-drawn link could not make', () => {
    const added = planEdges({
      filed: [
        { downstream: 'a.md', upstream: 'a.md', origin: 'manual' },
        { downstream: 'b.md', upstream: 'a.md', origin: 'manual' },
        { downstream: 'c.md', upstream: 'ghost.md', origin: 'manual' },
        // b ← c plus the existing b ← a is fine; c ← b then closes a cycle.
        { downstream: 'b.md', upstream: 'c.md', origin: 'manual' },
        { downstream: 'c.md', upstream: 'b.md', origin: 'manual' },
      ],
      known: ['a.md', 'b.md', 'c.md'],
      existing,
    })
    expect(added).toEqual([{ downstream: 'b.md', upstream: 'c.md', origin: 'manual' }])
  })

  it('adds only notes it does not already have', () => {
    const filed = board().notes
    expect(planNotes(filed, [])).toEqual(filed)
    expect(planNotes(filed, ['note-1-a'])).toEqual([])
  })
})
