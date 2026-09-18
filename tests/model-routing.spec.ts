/**
 * Card conversations and the deployment's model policy: what a new one is
 * created with, which recorded intent it keeps, and that the install happens
 * once per agent rather than on every open.
 *
 * The regression this pins is the turn that failed with `prompt variable
 * "{{model}}" has no value for this assembly`: an agent created without
 * `AgentOptions.provider/model` cannot assemble the deployment persona, because
 * the prompt's `{{provider}}`/`{{model}}` read exactly that field.
 */
import { describe, expect, it, vi } from 'vitest'
import { ModelRouting, modelFaces, type ModelFaces } from '../src/core/model-routing.ts'

/** A session stand-in: only the log the projection is keyed by is read. */
function session(id = 'cv-test'): never {
  return { id } as never
}

/** An agent stand-in exposing the two fields the routing reads. */
function agent(provider: string, model: string) {
  return { options: { provider, model }, session: session() } as never
}

/** A working selection sink; `align` calls it with whatever it decides. */
function sink() {
  return vi.fn(async () => undefined)
}

/** The three faces, with one projection state for every session read. */
function faces(state: unknown, overrides: Partial<ModelFaces> = {}): ModelFaces {
  return {
    defaultModel: { currentSelection: () => ({ provider: 'gw', model: 'deepseek' }) },
    controller: { selectModel: sink() },
    projections: { stateOf: () => state },
    ...overrides,
  }
}

describe('ModelRouting.agentOptions', () => {
  it('offers the deployment default as the pair a new agent is created with', () => {
    expect(new ModelRouting(faces(undefined)).agentOptions()).toEqual({ provider: 'gw', model: 'deepseek' })
  })

  it('offers nothing when the deployment default is unreadable', () => {
    const routing = new ModelRouting(faces(undefined, { defaultModel: undefined }))
    expect(routing.agentOptions()).toBeUndefined()
  })
})

describe('ModelRouting.intentOf', () => {
  it('prefers a pick that has not been consumed yet', () => {
    const state = { pending: { provider: 'gw', model: 'picked' }, lastUsed: { provider: 'gw', model: 'ran' } }
    expect(new ModelRouting(faces(state)).intentOf(session())).toEqual({ provider: 'gw', model: 'picked' })
  })

  it('falls back to the model the last request ran with', () => {
    const state = { pending: null, lastUsed: { provider: 'gw', model: 'ran' } }
    expect(new ModelRouting(faces(state)).intentOf(session())).toEqual({ provider: 'gw', model: 'ran' })
  })

  it('has no intent for a session that never picked and never ran', () => {
    expect(new ModelRouting(faces({ pending: null, lastUsed: null })).intentOf(session())).toBeUndefined()
  })

  it('has no intent when the projection registry is absent', () => {
    expect(new ModelRouting(faces(undefined, { projections: undefined })).intentOf(session())).toBeUndefined()
  })
})

describe('ModelRouting.align', () => {
  it('installs the session intent when the agent was created on another model', async () => {
    const selectModel = sink()
    const routing = new ModelRouting(
      faces({ pending: null, lastUsed: { provider: 'gw', model: 'ran' } }, { controller: { selectModel } }),
    )
    await expect(routing.align(agent('gw', 'default'), 'cv-test')).resolves.toBe(true)
    expect(selectModel).toHaveBeenCalledWith({ sessionId: 'cv-test', provider: 'gw', model: 'ran' })
  })

  it('passes a pinned effort through', async () => {
    const selectModel = sink()
    const state = { pending: { provider: 'gw', model: 'ran', reasoningEffort: 'high' }, lastUsed: null }
    const routing = new ModelRouting(faces(state, { controller: { selectModel } }))
    await routing.align(agent('gw', 'default'), 'cv-test')
    expect(selectModel).toHaveBeenCalledWith({
      sessionId: 'cv-test',
      provider: 'gw',
      model: 'ran',
      reasoningEffort: 'high',
    })
  })

  it('leaves an agent that already runs the intended model alone', async () => {
    const selectModel = sink()
    const routing = new ModelRouting(
      faces({ pending: null, lastUsed: { provider: 'gw', model: 'ran' } }, { controller: { selectModel } }),
    )
    await expect(routing.align(agent('gw', 'ran'), 'cv-test')).resolves.toBe(false)
    expect(selectModel).not.toHaveBeenCalled()
  })

  it('aligns each agent once, even when the session intent keeps differing', async () => {
    const selectModel = sink()
    const routing = new ModelRouting(
      faces({ pending: null, lastUsed: { provider: 'gw', model: 'ran' } }, { controller: { selectModel } }),
    )
    const live = agent('gw', 'default')
    await routing.align(live, 'cv-test')
    await routing.align(live, 'cv-test')
    expect(selectModel).toHaveBeenCalledTimes(1)
  })

  it('does nothing when no controller is registered to install through', async () => {
    const routing = new ModelRouting(
      faces({ pending: null, lastUsed: { provider: 'gw', model: 'ran' } }, { controller: undefined }),
    )
    await expect(routing.align(agent('gw', 'default'), 'cv-test')).resolves.toBe(false)
  })

  it('propagates a refused install so the caller can decide', async () => {
    const selectModel = vi.fn(async () => {
      throw new Error('session/not-found')
    })
    const routing = new ModelRouting(
      faces({ pending: null, lastUsed: { provider: 'gw', model: 'ran' } }, { controller: { selectModel } }),
    )
    await expect(routing.align(agent('gw', 'default'), 'cv-test')).rejects.toThrow('session/not-found')
  })
})

describe('modelFaces', () => {
  it('reads the container lazily, so a service that registers later still reaches a card', () => {
    const registry = new Map<string, unknown>()
    const ctx = { get: (name: string) => registry.get(name) } as never
    const resolved = modelFaces(ctx)
    expect(resolved.controller).toBeUndefined()
    registry.set('sessionController', { selectModel: sink() })
    expect(resolved.controller).toBeDefined()
  })
})
