/**
 * dsh-canvas — plugin asset route (design node, §渲染层).
 *
 * The web harness's `/plugins` route serves exactly the composed client
 * bundles — any other path under it 404s, so a plugin cannot fetch its own
 * files from there. A design previewer needs runtime assets (the CanvasKit
 * WASM and its fonts above all), so this module claims a route of its own:
 * `/dsh-canvas/assets/<file>`, served from the plugin's `lib/assets/`
 * directory.
 *
 * The route is read-only over a fixed directory and names are sanitized
 * (single path segment, no dot-dot), so the handler never touches anything
 * outside `lib/assets/` — the workspace seam stays untouched too, because
 * these are the plugin's own bundled files, not user artifacts.
 *
 * The `webServer` service is resolved **structurally, by name**, exactly like
 * `core/agent-preset.ts` resolves the preset roster: this bundle must run in
 * a composition that has an HTTP surface and in one that does not, and the
 * host package that owns the service is a companion rather than a dependency.
 * Absence is a no-op — the design viewer's CanvasKit load attempt then fails
 * and falls back to 2D, the same degradation as any other asset-less surface.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

/** The route prefix the browser fetches plugin assets under. */
export const ASSET_ROUTE = '/dsh-canvas/assets'

/** The slice of the webServer service this module uses. */
interface WebServerFace {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: AssetRequest, res: AssetResponse) => void
  }): () => void
}

/** Minimal request/response shapes the handler touches. */
interface AssetRequest {
  method?: string
  url?: string
  /** Node's lower-cased header map; only the conditional-request headers are read. */
  headers?: Readonly<Record<string, string | string[] | undefined>>
}
interface AssetResponse {
  writeHead(status: number, headers: Record<string, string | number>): unknown
  end(body?: unknown): unknown
}

function webServerFace(ctx: Context): WebServerFace | undefined {
  // `ctx.get` (like `presetFace` in core/session/agent-preset.ts), not a
  // property access: cordis throws `cannot get property … without inject` on
  // `ctx.webServer` when the service is declared but not injected here, which
  // would kill the whole plugin tree at load time instead of degrading.
  const face = ctx.get('webServer') as WebServerFace | undefined
  return face !== undefined && typeof face.register === 'function' ? face : undefined
}

/**
 * Directory this plugin's runtime assets are built into (`lib/assets/`).
 *
 * `lib/assets/` sits **beside** `lib/index.js`, not beside the package root —
 * `../assets/` from the module URL resolves to `<plugin>/assets/`, which never
 * exists, and every asset request 404s (this shipped once: canvaskit silently
 * fell back to 2D for weeks until the engine chunk made the failure visible).
 */
export function assetsDir(from: string = import.meta.url): string {
  return fileURLToPath(new URL('./assets/', from))
}

/** Resolve one asset file path next to the compiled module. Testable seam. */
export function assetFilePath(name: string, from: string = import.meta.url): string {
  return join(assetsDir(from), name)
}

/**
 * 这一条路由的缓存策略（v1.59 修）。
 *
 * 从前是 `public, max-age=31536000, immutable`，理由写在当时那句注释里：「名字是内容稳定的
 * 构建产物，重建就换一份插件包」。前半句对，后半句错得恰到好处——**重建换的是包，不是这里
 * 的 URL**：`design-engine.js` 这个名字跨构建一字不变，而它的内容每一版都在改。于是浏览器
 * 把旧 chunk 按「永不过期」存了一年，新的客户端在新 chunk 里要的那个函数根本不在旧 chunk
 * 里，用户拿到的是 `n.designExport is not a function`（v1.59 的真机反馈）。
 *
 * 现在**每次问一句**：`no-cache` 是「可以存，用之前必须回验」，配上 ETag——没变就是一次
 * 304（几十字节），变了立刻拿到新的。那 28MB 资产不因此变慢：它们只在设计预览器打开时取，
 * 且日常都是 304。
 */
export const ASSET_CACHE_CONTROL = 'no-cache'

/**
 * 一个文件实体的 ETag：**长度 + mtime** 就够。
 *
 * 不读内容算哈希：这两个数在「内容变了」时必然变（任何一次重建都写新文件），而算哈希要把
 * 8MB 的 wasm 读一遍——那才是这条路由原本想省掉的东西。
 */
export function entityTagOf(size: number, mtimeMs: number): string {
  return `"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}"`
}

/**
 * 请求里的 `If-None-Match` 认不认这个 ETag。
 *
 * 三种都认：`*`（有就行）、原样相等、以及弱比较前缀 `W/`（我们不产生弱标签，但代理可能给它
 * 加前缀）。候选可以是一串逗号分隔的值，任一命中即算命中。
 */
export function isNotModified(ifNoneMatch: string | string[] | undefined, etag: string): boolean {
  const raw = Array.isArray(ifNoneMatch) ? ifNoneMatch.join(',') : ifNoneMatch
  if (raw === undefined || raw === '') return false
  return raw.split(',').some((candidate) => {
    const value = candidate.trim().replace(/^W\//, '')
    return value === '*' || value === etag
  })
}

/** Content types for the extensions a design previewer may ask for. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.wasm': 'application/wasm',
  '.js': 'text/javascript; charset=utf-8',
  /**
   * `.ts` —— 那不是 TypeScript 源码，是 fig 导出器的压缩 worker（v1.59）。
   *
   * 上游的 fig 写器在浏览器里用 `new URL('./export-worker.ts', import.meta.url)` 找自己的
   * worker，打进我们那份 chunk 之后这个名字就定死在 `/dsh-canvas/assets/export-worker.ts`
   * 上了，所以 `build.mjs` 就按它点名的名字产出（内容是普通 ESM）。module worker 对 MIME
   * 有硬要求，不认这个类型它连脚本都不执行——**于是 fig 导出会静默地整趟失败**，而这正是
   * 用户点名要的四样之一。
   */
  '.ts': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
}

/**
 * Register the asset route for the lifetime of the plugin.
 *
 * Registration is best-effort by deployment shape: a web deployment provides
 * `webServer` (directly or on injection), anything else is a no-op — the
 * plugin's canvas features must not depend on having an HTTP surface.
 *
 * `from` is the module URL the assets sit beside; it is a parameter for the
 * same reason {@link assetFilePath} takes one — a judgement about what this
 * route *answers* (ETag, 304, MIME) needs a real file on a real disk, and the
 * assets beside the test runner do not exist.
 */
export function registerAssetRoute(ctx: Context, from: string = import.meta.url): void {
  const register = (host: Context): void => {
    const server = webServerFace(host)
    if (server === undefined) return
    host.effect(() => {
      const dispose = server.register({
        kind: 'prefix',
        path: ASSET_ROUTE,
        handler: (req, res) => serveAsset(req, res, from),
      })
      return () => dispose()
    }, 'dsh-canvas: asset route')
  }
  if (webServerFace(ctx) !== undefined) {
    register(ctx)
  } else {
    ctx.inject(['webServer'], register as never)
  }
}

/** Serve one file from `lib/assets/`, or 404 anything else. */
function serveAsset(req: AssetRequest, res: AssetResponse, from: string): void {
  const method = req.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain' })
    res.end('method not allowed')
    return
  }
  const url = req.url ?? '/'
  const pathname = url.slice(ASSET_ROUTE.length).split('?')[0]
  // One path segment, no traversal: everything after the prefix must resolve
  // inside the assets directory or the request is refused outright.
  const name = decodeURIComponent(pathname.replace(/^\/+/, ''))
  const safe = normalize(name)
  if (safe === '' || safe === '.' || safe.includes('/') || safe.includes('..') || safe.startsWith('.')) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }
  const path = assetFilePath(safe, from)
  if (!existsSync(path)) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }
  const stat = statSync(path)
  if (!stat.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }
  const etag = entityTagOf(stat.size, stat.mtimeMs)
  // 回验命中：一个字都不用发，但**验证器要照旧带上**（下一次的回验还要用它）。
  if (isNotModified(req.headers?.['if-none-match'], etag)) {
    res.writeHead(304, { etag, 'cache-control': ASSET_CACHE_CONTROL })
    res.end()
    return
  }
  const contentType = CONTENT_TYPES[extname(safe).toLowerCase()] ?? 'application/octet-stream'
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': String(stat.size),
    etag,
    'cache-control': ASSET_CACHE_CONTROL,
  })
  if (method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(path).pipe(res as never)
}
