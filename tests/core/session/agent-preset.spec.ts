/**
 * Card conversations and the deployment's agent preset: what a card agent
 * inherits, and what happens when the deployment composes no roster.
 *
 * The regression this pins is an artifact that could not be created. A card
 * conversation is created by this plugin through the agent factory, so it never
 * passes through the composition an ordinary session gets. On the Web surface
 * that composition is an *agent preset* — `dsh-web-app` disables the base's
 * `tool-fs` rows and the preset mounts them — so an agent created without one
 * inherits the canvas tools and nothing else. The model, told by its own prompt
 * section to edit the artifact file, found every write tool answering
 * `unknown tool`, and the card stayed empty.
 */
import { describe, expect, it, vi } from 'vitest'
import { cardPreset, composeCardAgent, presetFace, type AgentPresetFace } from '../../../src/core/session/agent-preset.ts'

/** A context that resolves the named services from a mutable map. */
function container(entries: Record<string, unknown> = {}): { get(name: string): unknown } {
  return { get: (name: string) => entries[name] }
}

/** A roster with one preset, recording every call it receives. */
function roster(id = 'standard'): AgentPresetFace & {
  resolve: ReturnType<typeof vi.fn>
  standingKeyFor: ReturnType<typeof vi.fn>
  mount: ReturnType<typeof vi.fn>
} {
  return {
    resolve: vi.fn(async () => ({ id })),
    standingKeyFor: vi.fn(async () => 'key'),
    mount: vi.fn(async () => ({ id })),
  }
}

describe('presetFace', () => {
  it('reads the container lazily, so a roster mounted later still reaches a card', () => {
    const entries: Record<string, unknown> = {}
    const ctx = container(entries) as never
    expect(presetFace(ctx)).toBeUndefined()
    const face = roster()
    entries.agentPresets = face
    expect(presetFace(ctx)).toBe(face)
  })
})

describe('cardPreset', () => {
  it('resolves the deployment default and proves it composes before any agent exists', async () => {
    const face = roster('standard')
    await expect(cardPreset(container({ agentPresets: face }) as never)).resolves.toBe('standard')
    expect(face.resolve).toHaveBeenCalledWith()
    expect(face.standingKeyFor).toHaveBeenCalledWith('standard')
    expect(face.mount).not.toHaveBeenCalled()
  })

  it('resolves nothing in a rosterless deployment, where the host composition already supplies the tools', async () => {
    await expect(cardPreset(container() as never)).resolves.toBeUndefined()
  })

  it('does not swallow an unusable preset: the card cannot do its job without it', async () => {
    const face = roster()
    face.resolve.mockRejectedValueOnce(new Error('agent-preset/not-found'))
    await expect(cardPreset(container({ agentPresets: face }) as never)).rejects.toThrow('agent-preset/not-found')
  })

  it('reports a preset that resolves but cannot be composed', async () => {
    const face = roster()
    face.standingKeyFor.mockRejectedValueOnce(new Error('row unusable: tool-fs'))
    await expect(cardPreset(container({ agentPresets: face }) as never)).rejects.toThrow('row unusable')
  })
})

describe('composeCardAgent', () => {
  it('joins the agent to the resolved preset', async () => {
    const face = roster('standard')
    const agentCtx = { scoped: true } as never
    await composeCardAgent(container({ agentPresets: face }) as never, agentCtx, 'standard')
    expect(face.mount).toHaveBeenCalledWith(agentCtx, 'standard')
  })

  it('is a no-op in a rosterless deployment', async () => {
    await expect(composeCardAgent(container() as never, {} as never, 'standard')).resolves.toBeUndefined()
  })

  it('is a no-op when no preset was resolved, so a deployment without a roster still opens cards', async () => {
    const face = roster()
    await composeCardAgent(container({ agentPresets: face }) as never, {} as never, undefined)
    expect(face.mount).not.toHaveBeenCalled()
  })

  it('propagates a refused mount so the factory can roll the creation back', async () => {
    const face = roster()
    face.mount.mockRejectedValueOnce(new Error('row unusable: tool-fs'))
    await expect(
      composeCardAgent(container({ agentPresets: face }) as never, {} as never, 'standard'),
    ).rejects.toThrow('row unusable')
  })
})
