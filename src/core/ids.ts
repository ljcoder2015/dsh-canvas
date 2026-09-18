/**
 * dsh-canvas — stable identities.
 *
 * Card ids are paths *relative* to a project root, so they are already stable
 * and readable. Project ids cannot be paths (they cross the wire and are
 * schema-bounded), and they must stay stable across restarts, so they are
 * derived from the root: a readable slug plus a short digest of the full path.
 * Two projects named `deck` under different parents therefore stay distinct,
 * and re-binding the same directory reuses the same project.
 */

/**
 * 32-bit FNV-1a, rendered base 36.
 *
 * A digest is only used to disambiguate sibling-named roots, so collision
 * resistance at 32 bits is far beyond what the board needs; using a real
 * cryptographic hash here would cost the plugin a dependency for nothing.
 */
export function shortDigest(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

/** Turn an arbitrary directory name into a wire-safe slug. */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return slug === '' ? 'canvas' : slug.slice(0, 40)
}

/** Deterministic project id for one workspace root. */
export function projectIdOf(root: string): string {
  const normalised = root.replace(/\/+$/, '')
  const base = normalised.split('/').pop() ?? 'canvas'
  return `${slugify(base)}-${shortDigest(normalised)}`
}

/**
 * Escape everything outside the storage key alphabet as fixed-width `_xxxx`.
 *
 * The JSON medium's `per-record` layout turns a record key into a path segment
 * and rejects everything outside `[a-zA-Z0-9_-]+` at write — and card ids are
 * paths, so they carry dots and slashes. The escape is fixed-width, so it can
 * neither be ambiguous nor collide with a separator that also avoids `_`:
 * a literal `_` in the input always comes out as `_005f`, which means the
 * sequence `__` can only ever be a delimiter someone put there on purpose.
 */
export function encodeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9-]/g, (char) => `_${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
}
