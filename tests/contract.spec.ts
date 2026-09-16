/**
 * The plane the whole plugin rests on: host and client must describe exactly
 * the same wire contract, and no descriptor may drift from the method it names.
 */
import { describe, expect, it } from 'vitest'
import { DSH_CANVAS_INVOCATIONS, TOOL_NAMES, TOOL_NAME_LIST, boardSnapshotSchema } from '../src/contract.ts'
import { CANVAS_DOMAIN } from '../src/domain.ts'
import { TYPERT_MANIFEST } from '../src/typert.ts'

describe('dsh-canvas wire contract', () => {
  it('shares one descriptor list between the host manifest and the package', () => {
    expect(TYPERT_MANIFEST.invocations).toBe(DSH_CANVAS_INVOCATIONS)
    expect(TYPERT_MANIFEST.package).toBe('dsh-canvas')
    expect(TYPERT_MANIFEST.face).toBe('host')
  })

  it('uses unique, namespaced identities', () => {
    const ids = DSH_CANVAS_INVOCATIONS.map((descriptor) => descriptor.id)
    expect(new Set(ids).size).toBe(ids.length)

    for (const descriptor of DSH_CANVAS_INVOCATIONS) {
      expect(descriptor.id.startsWith('dsh-canvas#')).toBe(true)
      expect(['canvas', 'card']).toContain(descriptor.namespace)
      // The wire namespace and the owning service key are the same value in
      // this plugin, which is what lets one `bindTypertRemote` cover both.
      expect(descriptor.service).toBe(descriptor.namespace)
    }
  })

  it('declares cancellation on every method, so no call can hang un-cancellably', () => {
    for (const descriptor of DSH_CANVAS_INVOCATIONS) {
      expect(descriptor.cancellation).toEqual({ parameter: 'signal' })
      expect(descriptor.invocation).toEqual({ kind: 'direct' })
    }
  })

  it('names every model-facing tool exactly once and with the canvas prefix', () => {
    expect(new Set(TOOL_NAME_LIST).size).toBe(TOOL_NAME_LIST.length)
    expect(TOOL_NAME_LIST).toHaveLength(13)
    for (const tool of TOOL_NAME_LIST) expect(tool.startsWith('canvas.')).toBe(true)
    // The dotted name is the one the product doc specifies; it is legal as a
    // Harness tool name (the PTC SDK generator quotes it).
    expect(TOOL_NAMES.readCard).toBe('canvas.read_card')
    expect(TOOL_NAMES.linkSourceOnBoard).toBe('canvas.link_source_on_board')
  })

  it('publishes a manifest whose member list matches the descriptor set', () => {
    const declared = new Set(
      TYPERT_MANIFEST.model.services.flatMap((service) => service.members.map((member) => member.name)),
    )
    for (const descriptor of DSH_CANVAS_INVOCATIONS) {
      expect(declared.has(descriptor.method)).toBe(true)
    }
  })

  it('validates a board snapshot and rejects a card with a malformed seat', () => {
    const snapshot = {
      project: {
        id: 'p1',
        name: 'deck',
        root: '/tmp/deck',
        viewport: { x: 0, y: 0, zoom: 1 },
        style: { palette: [], font: '', tone: '' },
        createdAt: 1,
      },
      cards: [
        {
          id: 'brief.md',
          project: 'p1',
          kind: 'markdown',
          kindLabel: 'Markdown',
          position: { x: 0, y: 0 },
          sessionId: '',
          present: true,
        },
      ],
      sources: [],
      notes: [],
    }
    expect(boardSnapshotSchema.parse(snapshot).cards).toHaveLength(1)
    expect(() =>
      boardSnapshotSchema.parse({ ...snapshot, cards: [{ ...snapshot.cards[0], position: { x: 'left', y: 0 } }] }),
    ).toThrow()
  })
})

describe('dsh-canvas storage domain', () => {
  // Importing the module is itself the assertion: `defineDomain` validates at
  // module load and throws on a name the medium rejects, which takes the whole
  // host half down at boot (`plugin tree failed to load`). The package name
  // `dsh-canvas` is not a legal unit name, so the domain cannot mirror it.
  it('declares a unit name the medium accepts, and it is not the package name', () => {
    expect(CANVAS_DOMAIN.name).toMatch(/^[a-z][a-z0-9_]*$/)
    expect(CANVAS_DOMAIN.name).not.toBe('dsh-canvas')
    expect(Object.keys(CANVAS_DOMAIN.tables)).toEqual(['projects', 'cards', 'sources', 'notes', 'intents'])
  })

  it('keeps the global non-nullable so a written global round-trips', () => {
    expect(CANVAS_DOMAIN.global?.schema.safeParse(null).success).toBe(false)
  })
})
