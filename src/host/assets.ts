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

/** Content types for the extensions a design previewer may ask for. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.wasm': 'application/wasm',
  '.js': 'text/javascript; charset=utf-8',
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
 */
export function registerAssetRoute(ctx: Context): void {
  const register = (host: Context): void => {
    const server = webServerFace(host)
    if (server === undefined) return
    host.effect(() => {
      const dispose = server.register({
        kind: 'prefix',
        path: ASSET_ROUTE,
        handler: (req, res) => serveAsset(req, res),
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
function serveAsset(req: AssetRequest, res: AssetResponse): void {
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
  const path = assetFilePath(safe)
  if (!existsSync(path) || !statSync(path).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }
  const size = statSync(path).size
  const contentType = CONTENT_TYPES[extname(safe).toLowerCase()] ?? 'application/octet-stream'
  res.writeHead(200, { 'content-type': contentType, 'content-length': String(size), 'cache-control': 'immutable' })
  if (method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(path).pipe(res as never)
}
