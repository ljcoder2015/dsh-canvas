/**
 * dsh-canvas — source edge store (F4.1–F4.5).
 *
 * The store owns the *rules* of the one edge type and the storage domain owns
 * durability. Keeping the rules here — pure functions over a plain view of the
 * edges — means the invariants (no self-edge, no duplicate, no cycle) are
 * testable without a container, and both the Remote service and the
 * reconciliation pass share one implementation.
 */
import type { CardId, Source, SourceId } from '../types.ts'

/** A reference to one edge, without its storage identity. */
export interface EdgeRef {
  downstream: CardId
  upstream: CardId
}

/** Why an edge was refused. */
export type EdgeRejection = 'self' | 'duplicate' | 'cycle' | 'unknown-card'

/** Outcome of validating one prospective edge. */
export type EdgeValidation = { ok: true } | { ok: false; reason: EdgeRejection }

/** Stable storage id for an edge, so re-linking the same pair is idempotent. */
export function sourceIdOf(downstream: CardId, upstream: CardId): SourceId {
  return `${downstream}<-${upstream}`
}

/** Project every stored edge down to its endpoints. */
export function edgeRefs(sources: Iterable<Source>): EdgeRef[] {
  return [...sources].map((source) => ({ downstream: source.downstream, upstream: source.upstream }))
}

/** Direct upstreams of one card. */
export function upstreamsOf(cardId: CardId, sources: Iterable<Source>): CardId[] {
  return [...sources].filter((source) => source.downstream === cardId).map((source) => source.upstream)
}

/** Direct downstreams of one card. */
export function downstreamsOf(cardId: CardId, sources: Iterable<Source>): CardId[] {
  return [...sources].filter((source) => source.upstream === cardId).map((source) => source.downstream)
}

/**
 * Walk the upstream chain transitively (F4.7).
 *
 * Breadth-first from the card, so `indirect` comes back nearest-first, which is
 * the order a digest should be injected in. Cycles cannot be stored, but the
 * traversal still guards with `seen` so a corrupted record cannot hang it.
 */
export function transitiveUpstreams(
  cardId: CardId,
  sources: Iterable<Source>,
  depth: number,
): { direct: CardId[]; indirect: CardId[] } {
  const edges = [...sources]
  const direct = upstreamsOf(cardId, edges)
  const indirect: CardId[] = []
  const seen = new Set<CardId>([cardId, ...direct])
  let frontier = direct
  for (let level = 1; level < depth; level += 1) {
    const next: CardId[] = []
    for (const node of frontier) {
      for (const parent of upstreamsOf(node, edges)) {
        if (seen.has(parent)) continue
        seen.add(parent)
        indirect.push(parent)
        next.push(parent)
      }
    }
    if (next.length === 0) break
    frontier = next
  }
  return { direct, indirect }
}

/**
 * Validate a prospective edge against the rules of §3.4.
 *
 * `known` is the set of card ids that actually exist; a link to a card that is
 * not on the board is a caller mistake, not a data state, so it is refused here
 * rather than stored and discovered later.
 */
export function validateEdge(candidate: EdgeRef, known: Iterable<CardId>, sources: Iterable<Source>): EdgeValidation {
  if (candidate.downstream === candidate.upstream) return { ok: false, reason: 'self' }

  const cards = new Set(known)
  if (!cards.has(candidate.downstream) || !cards.has(candidate.upstream)) {
    return { ok: false, reason: 'unknown-card' }
  }

  const edges = [...sources]
  if (edges.some((edge) => edge.downstream === candidate.downstream && edge.upstream === candidate.upstream)) {
    return { ok: false, reason: 'duplicate' }
  }

  // The edge says "downstream builds on upstream", so following it must never
  // arrive back at `downstream`. Walk upstream from the prospective parent.
  const seen = new Set<CardId>()
  const stack: CardId[] = [candidate.upstream]
  while (stack.length > 0) {
    const node = stack.pop() as CardId
    if (node === candidate.downstream) return { ok: false, reason: 'cycle' }
    if (seen.has(node)) continue
    seen.add(node)
    stack.push(...upstreamsOf(node, edges))
  }

  return { ok: true }
}

/**
 * Reconcile edges against artifact evidence (F4.5).
 *
 * Given, for one card, the card ids its artifact actually references, return
 * the edges that evidence implies: every reference that resolves to a known
 * card and passes {@link validateEdge} becomes a `reconciled` edge. Edges the
 * user drew by hand are never removed here — reconciliation only adds, and only
 * reports what it added, so the caller can announce just the deltas.
 */
export function reconcileEdges(
  downstream: CardId,
  referenced: Iterable<CardId>,
  known: Iterable<CardId>,
  existing: Iterable<Source>,
): EdgeRef[] {
  const edges = [...existing]
  const added: EdgeRef[] = []
  for (const upstream of referenced) {
    const candidate: EdgeRef = { downstream, upstream }
    if (!validateEdge(candidate, known, edges).ok) continue
    edges.push({
      id: sourceIdOf(downstream, upstream),
      project: '',
      downstream,
      upstream,
      origin: 'reconciled',
    })
    added.push(candidate)
  }
  return added
}

/**
 * Extract the artifact references that could imply a source edge.
 *
 * Cheap and deliberate: `src`/`href` attributes in markup, image links and
 * relative links in Markdown, and `path`-ish values in data files. Resolving a
 * reference to a card id is the caller's job — this only surfaces candidates,
 * because only the caller knows the project root.
 */
export function referencedPaths(kind: string, text: string, extension: string): string[] {
  const found = new Set<string>()
  const collect = (raw: string): void => {
    const value = raw.trim()
    if (value === '' || /^(https?:)?\/\//.test(value) || value.startsWith('data:')) return
    found.add(value.split('#')[0].split('?')[0])
  }

  if (kind === 'html-deck' || kind === 'site') {
    for (const match of text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) collect(match[1] ?? '')
  } else if (kind === 'markdown') {
    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gi)) collect(match[1] ?? '')
  } else if (kind === 'data' && extension === 'json') {
    for (const match of text.matchAll(/"([^"]+\.(?:png|jpe?g|webp|svg|csv|json|html|md))"/gi)) collect(match[1] ?? '')
  }
  return [...found]
}
