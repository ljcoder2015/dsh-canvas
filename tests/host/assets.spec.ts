/**
 * The plugin asset route (§渲染层): registration is best-effort by deployment
 * shape, and it must never take the plugin tree down with it.
 *
 * That rule has already failed once in production: the first version read the
 * service as a property (`ctx.webServer`), and real cordis throws
 * `cannot get property "webServer" without inject` on a declared-but-not-
 * injected service — `dsh web` died at load time. The rule is therefore pinned
 * here in both directions:
 *
 * - a deployment **with** a `webServer` gets exactly one prefix route registered
 *   under a labeled effect, and its handler refuses anything that is not a
 *   single sanitized path segment (no traversal, no subdirectories, GET/HEAD);
 * - a deployment **without** one must not throw — it waits on `inject`, and the
 *   design viewer degrades to 2D the same way it does for any asset-less surface.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ASSET_ROUTE, assetFilePath, registerAssetRoute } from '../../src/host/assets.ts'

/** The route shape the module hands to the webServer's `register`. */
interface RegisteredRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: unknown, res: unknown) => void
}

/** The slice of the webServer face the module uses. */
interface FakeServer {
  register(route: RegisteredRoute): () => void
}

/**
 * A context fake with just the three members the module touches: `get`
 * (the inject-free service read), `inject` (runs its callback immediately),
 * and `effect` (records the label, captures the registration).
 */
function fakeCtx(webServer?: FakeServer) {
  const registered: RegisteredRoute[] = []
  const labels: string[] = []
  const ctx = {
    get(name: string) {
      return name === 'webServer' ? webServer : undefined
    },
    inject(_deps: readonly string[], callback: (host: unknown) => void) {
      callback(ctx)
    },
    effect(fn: () => () => void, label: string) {
      labels.push(label)
      return fn()
    },
  }
  return { ctx: ctx as unknown as Context, registered, labels }
}

/** A webServer face that records every registration. */
const recordingServer = (registered: RegisteredRoute[]): FakeServer => ({
  register(route) {
    registered.push(route)
    return () => {}
  },
})

describe('registerAssetRoute', () => {
  it('resolves asset files beside lib/index.js, not at the package root', () => {
    // The bug this pins: `../assets/` from lib/index.js is <plugin>/assets/ —
    // a directory that never exists, so every asset 404'd while canvaskit
    // silently degraded to 2D. The assets live INSIDE lib/, beside index.js.
    expect(assetFilePath('design-engine.js', 'file:///srv/plugin/lib/index.js')).toBe('/srv/plugin/lib/assets/design-engine.js')
  })

  it('registers exactly one prefix route when the deployment has a webServer', () => {
    const registered: RegisteredRoute[] = []
    const { ctx, labels } = fakeCtx(recordingServer(registered))
    expect(() => registerAssetRoute(ctx)).not.toThrow()
    expect(registered).toHaveLength(1)
    expect(registered[0]?.kind).toBe('prefix')
    expect(registered[0]?.path).toBe(ASSET_ROUTE)
    expect(labels).toEqual(['dsh-canvas: asset route'])
  })

  it('waits on inject instead of throwing when there is no webServer yet', () => {
    const { ctx, registered } = fakeCtx()
    expect(() => registerAssetRoute(ctx)).not.toThrow()
    expect(registered).toEqual([])
  })

  it('refuses non-GET methods, traversal, and multi-segment paths', () => {
    const registered: RegisteredRoute[] = []
    const { ctx } = fakeCtx(recordingServer(registered))
    registerAssetRoute(ctx)
    const handler = registered[0]?.handler
    expect(typeof handler).toBe('function')
    const respond = (req: { method?: string; url?: string }) => {
      const out = { status: 0 }
      handler?.(req, {
        writeHead(status: number) {
          out.status = status
        },
        end() {},
      })
      return out.status
    }
    expect(respond({ method: 'PUT', url: '/canvaskit.js' })).toBe(405)
    expect(respond({ url: '/../etc/passwd' })).toBe(404)
    expect(respond({ url: '/sub/file.js' })).toBe(404)
    expect(respond({ url: '' })).toBe(404)
  })
})
