/**
 * dsh-canvas — resource addresses, read without inventing a syntax.
 *
 * The host owns the resource grammar, and its documented file forms are the
 * only two this module accepts:
 *
 *   - `dsh-resource://file/session/<sessionId>/<relativePath>` — a path inside
 *     a session's workspace.
 *   - `dsh-resource://file/absolute/<absolutePath>` — a path anywhere the host
 *     is allowed to read.
 *
 * A card's identity is already a project-relative path, so the session form
 * yields a card id directly; the absolute form is turned into one by stripping
 * the project root. An address outside both forms is *not* a canvas address,
 * and every caller here treats that as "decline", never as a parse failure —
 * declining is what lets the built-in file viewers keep their tabs.
 */

/** A file address the canvas understands. */
export type FileAddress =
  | { readonly scope: 'session'; readonly sessionId: string; readonly cardId: string }
  | { readonly scope: 'absolute'; readonly path: string }

const FILE_PREFIX = 'dsh-resource://file/'

/**
 * Parse one `dsh-resource://file/…` address.
 *
 * @param address - an address a tab was opened with.
 * @returns the parsed address, or `undefined` when the canvas has no business
 *   with it (another protocol, another resource type, or an unknown scope).
 */
export function parseFileAddress(address: string): FileAddress | undefined {
  if (!address.startsWith(FILE_PREFIX)) return undefined
  const rest = address.slice(FILE_PREFIX.length)

  const session = /^session\/([^/]+)\/(.+)$/.exec(rest)
  if (session !== null) {
    const [, sessionId, cardId] = session
    if (sessionId === undefined || cardId === undefined || cardId === '') return undefined
    return { scope: 'session', sessionId: decodeURIComponent(sessionId), cardId: decodeURIComponent(cardId) }
  }

  const absolute = /^absolute\/(.+)$/.exec(rest)
  if (absolute !== null) {
    const [, path] = absolute
    if (path === undefined || path === '') return undefined
    return { scope: 'absolute', path: decodeURIComponent(path) }
  }

  return undefined
}

/** Normalise a path for comparison: forward slashes, no trailing separator. */
export function normalisePath(path: string): string {
  const unified = path.replace(/\\/g, '/')
  return unified.length > 1 && unified.endsWith('/') ? unified.slice(0, -1) : unified
}

/** Whether `path` sits at or under `root`. Separate from the browser's `path.relative` on purpose: this runs in the browser. */
export function isInside(root: string, path: string): boolean {
  const base = normalisePath(root)
  const target = normalisePath(path)
  return target === base || target.startsWith(`${base}/`)
}

/**
 * The project-relative id of an absolute path inside a project root.
 *
 * @param root - the project's absolute root.
 * @param path - an absolute path inside it (checked by the caller).
 * @returns the relative path, using forward slashes.
 */
export function relativeTo(root: string, path: string): string {
  const base = normalisePath(root)
  const target = normalisePath(path)
  return target === base ? '' : target.slice(base.length + 1)
}

/** The file name at the end of a path, for a tab title or a card caption. */
export function basenameOf(path: string): string {
  const target = normalisePath(path)
  const cut = target.lastIndexOf('/')
  return cut === -1 ? target : target.slice(cut + 1)
}

/** The parent directory of a path, or `''` when it has none. */
export function dirnameOf(path: string): string {
  const target = normalisePath(path)
  const cut = target.lastIndexOf('/')
  if (cut === -1) return ''
  if (cut === 0) return '/'
  return target.slice(0, cut)
}
