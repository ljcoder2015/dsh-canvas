/**
 * The write path's sandbox boundary.
 *
 * A project root is chosen by the user in the folder picker, and it *is* the
 * workspace this plugin writes into — so a mutation must carry that root as its
 * `workspace-write` boundary rather than inherit the standing one. The standing
 * policy holds the deployment fallback root (or a calling session's cwd), and a
 * canvas opened anywhere else is refused outright by the seam's fence
 * (`FS_SANDBOX_DENIED`, "file access denied under workspace-write mode"). A dock
 * click is an agentless write, so it has no session cwd to inherit and hits that
 * refusal every time.
 *
 * The MODE must travel untouched: this layer resolves no escalations, so a
 * `read-only` composition keeps refusing and `danger-full-access` keeps
 * delegating unfenced. `ArtifactIo` is the single junction every write goes
 * through, so the whole policy decision is pinned here rather than at callers.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { FsVersion } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { ArtifactIo } from '../src/core/artifact-io.ts'

/** A project root the user picked outside the agent's own workspace. */
const PROJECT_ROOT = '/projects/flow-test'

/** What a confined composition resolves for an agentless call. */
const STANDING: SandboxExecutionPolicy = { mode: 'workspace-write', workspaceRoot: '/agent/workspace' }

/** One `writeText` call, as the seam saw it. */
interface WriteCall {
  content: string
  intent: unknown
  policy: SandboxExecutionPolicy | undefined
}

/**
 * An `ArtifactIo` over a stub seam that records the policy each write carried.
 *
 * `sandboxPolicy` is resolved by name, so passing `undefined` models a
 * composition whose filesystem does not confine at all.
 */
function harness(standing: SandboxExecutionPolicy | undefined) {
  const calls: WriteCall[] = []
  const ctx = {
    fs: {
      resolve: (path: string) => Promise.resolve({ targetKey: `/resolved/${path}`, displayPath: `/resolved/${path}` }),
      writeText: (
        _target: unknown,
        content: string,
        intent: unknown,
        _signal: unknown,
        policy: SandboxExecutionPolicy | undefined,
      ) => {
        calls.push({ content, intent, policy })
        return Promise.resolve({ operation: 'create' as const, version: FsVersion('v1'), before: null })
      },
    },
    get: (name: string) =>
      name === 'sandboxPolicy' && standing !== undefined ? { resolve: () => standing } : undefined,
  } as unknown as Context
  return { io: new ArtifactIo(ctx), calls }
}

describe('artifact write sandbox policy', () => {
  it('stamps the project root as the workspace-write boundary', async () => {
    const { io, calls } = harness(STANDING)

    await io.write(PROJECT_ROOT, 'untitled.md', '# 未命名\n')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.policy).toEqual({ mode: 'workspace-write', workspaceRoot: PROJECT_ROOT })
  })

  it('leaves the standing root alone when the mode does not read one', async () => {
    for (const mode of ['read-only', 'danger-full-access'] as const) {
      const { io, calls } = harness({ mode, workspaceRoot: '/agent/workspace' })

      await io.write(PROJECT_ROOT, 'untitled.md', '')

      expect(calls[0]?.policy).toEqual({ mode, workspaceRoot: '/agent/workspace' })
    }
  })

  it('passes no policy at all when the composition does not confine', async () => {
    const { io, calls } = harness(undefined)

    await io.write(PROJECT_ROOT, 'untitled.md', '')

    expect(calls[0]?.policy).toBeUndefined()
  })

  it('forwards the version guard and the outcome alongside the policy', async () => {
    const { io, calls } = harness(STANDING)

    const result = await io.write('/proj', 'a.md', 'body', { version: FsVersion('v7') })

    expect(calls[0]?.intent).toEqual({ kind: 'replaceIfVersion', version: 'v7' })
    expect(result).toEqual({ operation: 'create', version: 'v1', before: null })
  })
})
