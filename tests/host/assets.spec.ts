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
import { mkdirSync, mkdtempSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { once } from 'node:events'
import { Writable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import {
  ASSET_CACHE_CONTROL,
  ASSET_ROUTE,
  assetFilePath,
  entityTagOf,
  isNotModified,
  registerAssetRoute,
} from '../../src/host/assets.ts'

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

/**
 * 这一组判据要的是**真磁盘上的真文件**（`from` 那个参数就是为它开的）：这一条路由回答的
 * 东西（ETag、304、MIME）全都与文件的长度与 mtime 有关，内存桩答不了。
 *
 * 它们盯的是 v1.59 的一次真机事故：路由从前回 `max-age=31536000, immutable`，而 chunk 的
 * 名字跨构建一字不变——浏览器于是把旧 chunk 存了一年，新客户端在它里面要的函数不存在，
 * 用户看到 `n.designExport is not a function`。所以这里判的是**策略本身**：不许再出现
 * 「永不过期」，且回验要真的能省下那几十 MB。
 */
describe('asset route: 缓存与回验', () => {
  /** 一个可读的假响应：`writeHead` 记头，`_write` 收 body（`pipe` 要一个可写流）。 */
  class FakeResponse extends Writable {
    status = 0
    headers: Record<string, string | number> = {}
    private readonly chunks: Buffer[] = []

    writeHead(status: number, headers: Record<string, string | number> = {}): this {
      this.status = status
      Object.assign(this.headers, headers)
      return this
    }

    override _write(chunk: Buffer, _encoding: string, done: () => void): void {
      this.chunks.push(Buffer.from(chunk))
      done()
    }

    text(): string {
      return Buffer.concat(this.chunks).toString('utf8')
    }
  }

  /** 一份真磁盘资产目录：`<tmp>/lib/assets/`，入口是 `<tmp>/lib/index.js`。 */
  function realAssets(files: Record<string, string>) {
    const lib = join(mkdtempSync(join(tmpdir(), 'dsh-assets-')), 'lib')
    mkdirSync(join(lib, 'assets'), { recursive: true })
    for (const [name, body] of Object.entries(files)) writeFileSync(join(lib, 'assets', name), body)
    const registered: RegisteredRoute[] = []
    const { ctx } = fakeCtx(recordingServer(registered))
    registerAssetRoute(ctx, pathToFileURL(join(lib, 'index.js')).href)
    return { handler: registered[0]?.handler, dir: join(lib, 'assets') }
  }

  async function request(
    handler: RegisteredRoute['handler'] | undefined,
    req: { method?: string; url?: string; headers?: Record<string, string> },
  ): Promise<FakeResponse> {
    const res = new FakeResponse()
    handler?.(req, res)
    await once(res, 'finish')
    return res
  }

  it('回一份带 ETag 的响应，且策略是「用之前先回验」', async () => {
    const { handler, dir } = realAssets({ 'design-engine.js': 'export const x = 1\n' })
    const res = await request(handler, { url: `${ASSET_ROUTE}/design-engine.js` })
    expect(res.status).toBe(200)
    expect(res.text()).toBe('export const x = 1\n')
    expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(res.headers['cache-control']).toBe(ASSET_CACHE_CONTROL)
    // 事故那一版的两个字面量，一个都不许回来。
    expect(String(res.headers['cache-control'])).not.toContain('immutable')
    expect(String(res.headers['cache-control'])).not.toContain('31536000')
    const stat = statSync(join(dir, 'design-engine.js'))
    expect(res.headers.etag).toBe(entityTagOf(stat.size, stat.mtimeMs))
  })

  it('回验命中就只回 304，不带正文', async () => {
    const { handler } = realAssets({ 'design-engine.js': 'export const x = 1\n' })
    const first = await request(handler, { url: `${ASSET_ROUTE}/design-engine.js` })
    const revalidated = await request(handler, {
      url: `${ASSET_ROUTE}/design-engine.js`,
      headers: { 'if-none-match': String(first.headers.etag) },
    })
    expect(revalidated.status).toBe(304)
    expect(revalidated.text()).toBe('')
    expect(revalidated.headers.etag).toBe(first.headers.etag)
    expect(revalidated.headers['cache-control']).toBe(ASSET_CACHE_CONTROL)
  })

  it('内容变了就是新的 ETag，回验不会再命中', async () => {
    const { handler, dir } = realAssets({ 'design-engine.js': 'export const x = 1\n' })
    const first = await request(handler, { url: `${ASSET_ROUTE}/design-engine.js` })
    // 长度与 mtime 都要变（ETag 只用这两个数）：换一段更长的内容，再把 mtime 往前推。
    writeFileSync(join(dir, 'design-engine.js'), 'export const x = 1\nexport const y = 2\n')
    const later = new Date(Date.now() + 2000)
    utimesSync(join(dir, 'design-engine.js'), later, later)

    const again = await request(handler, {
      url: `${ASSET_ROUTE}/design-engine.js`,
      headers: { 'if-none-match': String(first.headers.etag) },
    })
    expect(again.status).toBe(200)
    expect(String(again.headers.etag)).not.toBe(String(first.headers.etag))
    expect(again.text()).toContain('export const y = 2')
  })

  it('fig 的压缩 worker 按 JavaScript 发（`.ts` 的名字，模块 worker 要这个 MIME）', async () => {
    const { handler } = realAssets({ 'export-worker.ts': 'self.onmessage = () => {}\n' })
    const res = await request(handler, { url: `${ASSET_ROUTE}/export-worker.ts` })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8')
  })

  it('ETag 只看长度与 mtime；`If-None-Match` 认 `*`、认原样、认 `W/` 前缀与候选串', () => {
    expect(entityTagOf(10, 1000.7)).toBe(entityTagOf(10, 1000.2))
    expect(entityTagOf(10, 1000)).not.toBe(entityTagOf(11, 1000))
    const tag = entityTagOf(10, 1000)
    expect(isNotModified(undefined, tag)).toBe(false)
    expect(isNotModified('', tag)).toBe(false)
    expect(isNotModified('*', tag)).toBe(true)
    expect(isNotModified(tag, tag)).toBe(true)
    expect(isNotModified(`W/${tag}`, tag)).toBe(true)
    expect(isNotModified(`"other", ${tag}`, tag)).toBe(true)
    expect(isNotModified('"other"', tag)).toBe(false)
  })
})
