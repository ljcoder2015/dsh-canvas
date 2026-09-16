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
