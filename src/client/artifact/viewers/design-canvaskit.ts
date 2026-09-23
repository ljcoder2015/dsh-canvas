/**
 * dsh-canvas — CanvasKit loader (design node, §渲染层).
 *
 * CanvasKit is Skia compiled to WASM — the engine Figma's web renderer uses.
 * The plugin ships its files in `lib/assets/` (copied at build time when the
 * `canvaskit-wasm` package is present) and serves them through the host's
 * own `/dsh-canvas/assets` route, because the harness's `/plugins` route only
 * serves composed bundles.
 *
 * The load is *optional by construction*: the design viewer works without it
 * (a plain 2D-canvas backend draws the same shape set), so every failure here
 * — no webServer, files not shipped, script error, init timeout — resolves to
 * `null` and the viewer degrades. Nothing in this file may throw.
 */

/** The UMD global the shipped `canvaskit.js` defines. */
interface CanvasKitInitGlobal {
  (options: { locateFile?: (file: string) => string }): Promise<CanvasKitRuntime>
}
export type { CanvasKitRuntime, SurfaceLike } from './design-engine-types.ts'

import { type CanvasKitRuntime } from './design-engine-types.ts'

/** The route the host's asset module serves (`src/host/assets.ts`). */
export const ASSET_BASE = '/dsh-canvas/assets'
/** Script-init timeout: an asset route that answers but never inits must not hang the viewer. */
const INIT_TIMEOUT_MS = 15_000

let inflight: Promise<CanvasKitRuntime | null> | undefined

/**
 * Load and initialize CanvasKit once per page; `null` when unavailable.
 *
 * Single-flight: several design viewers opening at once share one attempt.
 * The result is not cached negatively forever — a retry on the next viewer
 * open is cheap and honest (the assets may have appeared after an upgrade).
 */
export function loadCanvasKit(): Promise<CanvasKitRuntime | null> {
  if (inflight !== undefined) return inflight
  inflight = attemptLoad().catch(() => null)
  return inflight
}

async function attemptLoad(): Promise<CanvasKitRuntime | null> {
  if (typeof document === 'undefined') return null
  if (document.querySelector(`script[data-dsh-canvas-canvaskit]`) === null) {
    await injectScript(`${ASSET_BASE}/canvaskit.js`)
  }
  const init = (window as unknown as { CanvasKitInit?: CanvasKitInitGlobal }).CanvasKitInit
  if (init === undefined) return null
  const runtime = await withTimeout(
    init({
      locateFile: (file: string) => (file.endsWith('.wasm') ? `${ASSET_BASE}/${file}` : `${ASSET_BASE}/${file}`),
    }),
    INIT_TIMEOUT_MS,
  )
  return runtime ?? null
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.dataset['dshCanvasCanvaskit'] = ''
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`canvaskit script failed: ${src}`))
    document.head.appendChild(script)
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('canvaskit init timed out')), ms)
    void promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
