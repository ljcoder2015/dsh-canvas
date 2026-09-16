/**
 * dsh-canvas — deployment capabilities the plugin does not own.
 *
 * Three product features cannot be implemented from the packages the harness
 * base actually ships: rendering an artifact to PDF/PPTX/PNG, publishing it to
 * a subdomain, and generating an image. They are deployment concerns — the
 * backend that can rasterise a page and the one that can publish a site live
 * outside this plugin — so the plugin declares the *shape* of the capability
 * and looks it up at runtime instead of inventing a fake implementation.
 *
 * This is an honest seam, not a stub: when nothing provides it, the operation
 * fails with `card/unsupported` and a reason the UI can show, and the moment a
 * deployment (or a sibling plugin) provides it under
 * {@link CAPABILITIES_SERVICE_KEY}, every code path starts working with no
 * change to the wire contract or the tools.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CardId, ExportFormat, Project, PublishResult } from './types.ts'

/** Cordis service key a deployment provides the canvas capability under. */
export const CAPABILITIES_SERVICE_KEY = 'dsh-canvas.capabilities'

/** One artifact about to be turned into another representation. */
export interface ArtifactRef {
  project: Project
  cardId: CardId
  /** Kind id resolved by the plugin's kind registry. */
  kind: string
  /** Absolute path of the artifact in the deployment's execution world. */
  path: string
}

/** A request to render or archive one artifact. */
export interface ExportRequest extends ArtifactRef {
  format: ExportFormat
}

/** A request to make one artifact reachable at a URL. */
export interface PublishRequest extends ArtifactRef {
  /** Human-facing name of the card, used when the backend needs one. */
  title: string
}

/** A request to generate an image artifact. */
export interface GenerateImageRequest {
  project: Project
  /** Project-relative path the generated artifact should be written to. */
  cardId: CardId
  prompt: string
  /** Absolute path of an artifact whose look the image should follow, when any. */
  referencePath?: string
}

/** What a deployment may provide. Every member is optional. */
export interface CanvasCapabilities {
  /** Produce one derived file and return its absolute path. */
  export?(request: ExportRequest, signal?: AbortSignal): Promise<{ path: string }>
  /** Publish one artifact and return its URL. */
  publish?(request: PublishRequest, signal?: AbortSignal): Promise<PublishResult>
  /** Generate an image and write it to `request.cardId`, returning its path. */
  generateImage?(request: GenerateImageRequest, signal?: AbortSignal): Promise<{ path: string }>
}

/**
 * Read the deployment's capabilities, if any.
 *
 * `strict: true` means only a capability whose providing fiber is currently
 * active is returned, so a plugin that loaded and then unloaded cannot leave a
 * dead backend behind — the calls correctly fall back to `card/unsupported`.
 */
export function resolveCapabilities(ctx: Context): CanvasCapabilities | undefined {
  const provided = ctx.get(CAPABILITIES_SERVICE_KEY, true) as CanvasCapabilities | undefined
  return provided
}
