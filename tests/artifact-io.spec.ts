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
 *
 * The second half pins the *read* side of the same junction: which artifacts
 * get their local assets inlined before their text becomes a `srcDoc`. That
 * decision used to name one kind instead of the whole HTML family, so a page
 * whose kind came out `site` rather than `webapp` reached the iframe with a
 * `styles.css` it had no way to resolve — rendered unstyled, with nothing in
 * the payload saying why.
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

/** The two fields `ArtifactIo` reads off a resolved path. */
interface StubTarget {
  targetKey: string
  displayPath: string
}

/**
 * An `ArtifactIo` over a stub seam backed by an in-memory tree.
 *
 * `view()` classifies *and* reads, so a real seam means files. A tree keyed by
 * card-relative path keeps the test about the inlining decision instead of
 * about a fixture directory, and the directory/entry-page split stays visible
 * in the keys (`site/index.html` beside `site/styles.css`).
 */
function viewHarness(files: Record<string, string>) {
  const keys = Object.keys(files)
  const target = (key: string): StubTarget => ({ targetKey: key, displayPath: `/root/${key}` })
  const statOf = (key: string) =>
    files[key] === undefined
      ? keys.some((candidate) => candidate.startsWith(`${key}/`))
        ? { type: 'directory' as const, size: 0, version: FsVersion('v1') }
        : undefined
      : { type: 'file' as const, size: files[key]?.length ?? 0, version: FsVersion('v1') }

  const ctx = {
    fs: {
      resolve: (path: string) => Promise.resolve(target(path)),
      stat: (resolved: StubTarget) => Promise.resolve(statOf(resolved.targetKey)),
      processPath: (resolved: StubTarget) => resolved.displayPath,
      listDir: (resolved: StubTarget) =>
        Promise.resolve(
          keys
            .filter((key) => key.startsWith(`${resolved.targetKey}/`))
            .map((key) => ({ name: key.slice(resolved.targetKey.length + 1).split('/')[0] ?? '' })),
        ),
      readText: (resolved: StubTarget) => {
        const text = files[resolved.targetKey]
        return text === undefined ? Promise.reject(new Error('FS_NOT_FOUND')) : Promise.resolve(text)
      },
    },
    get: () => undefined,
  } as unknown as Context

  return new ArtifactIo(ctx)
}

describe('artifact view inlining', () => {
  const PAGE = `<!doctype html>
<html>
<head><link rel="stylesheet" href="styles.css"></head>
<body><h1>站点</h1><script src="app.js"></script></body>
</html>`

  it('inlines a site entry page’s own stylesheet and script', async () => {
    const io = viewHarness({
      'site/index.html': PAGE,
      'site/styles.css': 'h1 { color: red; }',
      'site/app.js': 'console.log(1)',
    })

    const view = await io.view('/root', 'site/index.html')

    expect(view.kind).toBe('site')
    expect(view.text).toContain('<style>\nh1 { color: red; }\n</style>')
    expect(view.text).toContain('console.log(1)')
    expect(view.text).not.toContain('href="styles.css"')
  })

  it('resolves a deck’s assets against the deck’s own directory', async () => {
    const io = viewHarness({
      'decks/talk.html': '<section class="slide">一</section><link rel="stylesheet" href="talk.css">',
      'decks/talk.css': '.slide { font-size: 40px; }',
      'talk.css': '.slide { font-size: 1px; }',
    })

    const view = await io.view('/root', 'decks/talk.html')

    expect(view.kind).toBe('html-deck')
    expect(view.text).toContain('font-size: 40px')
    expect(view.text).not.toContain('font-size: 1px')
  })

  it('leaves a page alone when it references nothing local', async () => {
    const remote = '<link rel="stylesheet" href="https://cdn.example.com/x.css">'

    const view = await viewHarness({ 'a.html': remote }).view('/root', 'a.html')

    expect(view.kind).toBe('site')
    expect(view.text).toBe(remote)
  })

  it('does not touch a kind the iframe does not render', async () => {
    const io = viewHarness({ 'notes.md': '# 标题\n\n<link rel="stylesheet" href="s.css">' })

    const view = await io.view('/root', 'notes.md')

    expect(view.kind).toBe('markdown')
    expect(view.text).toContain('href="s.css"')
  })
})
