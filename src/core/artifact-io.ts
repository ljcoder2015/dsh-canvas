/**
 * dsh-canvas — artifact access through the host filesystem seam (§4.9).
 *
 * Every read and write goes through `ctx.fs`, never `node:fs`: the same code
 * then works against a local, remote or sandboxed workspace, and it inherits
 * the seam's version guards, sandbox policy parameters and the
 * `fs/write-intent` / `fs/edit-intent` waterfalls that F8.4 hooks into.
 *
 * A card id *is* a path relative to its project root (§2.2), so each operation
 * resolves the card id against the project root rather than concatenating
 * strings — the seam owns the join and the containment rules.
 */
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsTarget, FsVersion, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import type { CardId, CardSummary, FolderEntry } from '../types.ts'
import { PROBE_HEAD_LIMIT, digestOf, detectKind, kindLabel, outlineOf, type KindProbe } from './kind-registry.ts'

/** A classified artifact: the kind plus the facts the board and the digest need. */
export interface ArtifactFacts {
  cardId: CardId
  kind: string
  kindLabel: string
  /** Absolute display path, for the card caption and error messages. */
  displayPath: string
  present: boolean
  /** Byte size when the target is a regular file. */
  bytes: number
  /** Freshness token of the content the facts were read from. */
  version: string
}

/** A directory that can host a project, as the folder picker lists it. */
export interface ProjectCandidate {
  name: string
  root: string
}

/** Filesystem-facing helpers shared by both runtimes and the tool layer. */
export class ArtifactIo {
  constructor(private readonly ctx: Context) {}

  /** Resolve a project-relative card id to a seam target. */
  private async targetOf(root: string, cardId: CardId, signal?: AbortSignal): Promise<FsTarget> {
    return this.ctx.fs.resolve(cardId, { cwd: root, signal })
  }

  /**
   * Gather the evidence a kind decision needs (F2.2).
   *
   * Bounded on purpose: at most {@link PROBE_HEAD_LIMIT} characters of text and
   * a directory listing, so classifying a large artifact never reads it whole.
   * A missing target is not an error here — a card may be seated on the board
   * before its file exists — so the caller learns `present: false` instead of
   * catching.
   */
  async probe(root: string, cardId: CardId, signal?: AbortSignal): Promise<KindProbe & { present: boolean; bytes: number; version: string }> {
    const base = {
      path: cardId,
      basename: cardId.split('/').pop() ?? cardId,
      extension: (cardId.split('.').length > 1 ? cardId.split('.').pop() ?? '' : '').toLowerCase(),
    }

    let target: FsTarget
    try {
      target = await this.targetOf(root, cardId, signal)
    } catch {
      return { ...base, directory: false, head: '', children: [], present: false, bytes: 0, version: '' }
    }

    const info = await this.ctx.fs.stat(target, signal)
    if (info === undefined) {
      return { ...base, directory: false, head: '', children: [], present: false, bytes: 0, version: '' }
    }

    if (info.type === 'directory') {
      const children = await this.ctx.fs.listDir(target, signal)
      return {
        ...base,
        directory: true,
        head: '',
        children: children.map((child) => child.name),
        present: true,
        bytes: 0,
        version: String(info.version),
      }
    }

    let head = ''
    try {
      head = (await this.ctx.fs.readText(target, signal)).slice(0, PROBE_HEAD_LIMIT)
    } catch (error) {
      // Binary or over-budget content still has a decidable kind from its
      // extension; only the deck-vs-page refinement is lost.
      if (!(error instanceof FsError)) throw error
    }

    return {
      ...base,
      directory: false,
      head,
      children: [],
      present: true,
      bytes: info.size ?? 0,
      version: String(info.version),
    }
  }

  /** Classify one card from its evidence. */
  async facts(root: string, cardId: CardId, signal?: AbortSignal): Promise<ArtifactFacts> {
    const probe = await this.probe(root, cardId, signal)
    const kind = detectKind(probe)
    return {
      cardId,
      kind,
      kindLabel: kindLabel(kind),
      displayPath: probe.present ? await this.displayPathOf(root, cardId, signal) : cardId,
      present: probe.present,
      bytes: probe.bytes,
      version: probe.version,
    }
  }

  /** Absolute, host-facing path of a card id. */
  async displayPathOf(root: string, cardId: CardId, signal?: AbortSignal): Promise<string> {
    const target = await this.targetOf(root, cardId, signal)
    return this.ctx.fs.processPath(target)
  }

  /**
   * Read an artifact's text.
   *
   * Rejects a missing target and a non-text target with the seam's own
   * `FsError`, so callers get consistent codes rather than a plugin-specific
   * vocabulary.
   */
  async readText(root: string, cardId: CardId, signal?: AbortSignal): Promise<{ text: string; version: FsVersion }> {
    const target = await this.targetOf(root, cardId, signal)
    const info = await this.ctx.fs.stat(target, signal)
    if (info === undefined) throw new FsError(`artifact is absent: ${cardId}`, 'FS_NOT_FOUND')
    if (info.type !== 'file') throw new FsError(`artifact is not a regular file: ${cardId}`, 'FS_NOT_REGULAR_FILE')
    const text = await this.ctx.fs.readText(target, signal)
    return { text, version: info.version }
  }

  /**
   * Build the bounded digest injected into a card session (F5.2).
   *
   * `budget` is the caller's (`Config.summaryBudget`), so the same artifact can
   * be digested tightly for a prompt and loosely for a preview without a second
   * code path.
   */
  async summarize(root: string, cardId: CardId, budget: number, signal?: AbortSignal): Promise<CardSummary> {
    const facts = await this.facts(root, cardId, signal)
    if (!facts.present) {
      throw new FsError(`artifact is absent: ${cardId}`, 'FS_NOT_FOUND')
    }

    let text = ''
    if (!facts.kind.startsWith('image') && facts.kind !== 'video') {
      try {
        text = (await this.readText(root, cardId, signal)).text
      } catch (error) {
        if (!(error instanceof FsError)) throw error
      }
    }

    const isDirectory = facts.kind === 'site' || facts.kind === 'folder'
    return {
      cardId,
      kind: facts.kind,
      path: facts.displayPath,
      summary: isDirectory
        ? `${facts.kindLabel} · ${String(facts.bytes)} B`
        : digestOf(facts.kind, text, budget),
      outline: outlineOf(facts.kind, text),
      bytes: facts.bytes,
      updatedAt: Date.now(),
    }
  }

  /**
   * Write a card's artifact (F8.1).
   *
   * The seam's guard is passed straight through: `expected` carries the version
   * the caller last observed, so an Agent write and a concurrent user edit
   * cannot silently overwrite each other (§4.9). Passing `undefined` is an
   * unconditional write, which is what creating a brand-new card does.
   */
  async write(
    root: string,
    cardId: CardId,
    content: string,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
  ): Promise<{ operation: 'create' | 'update'; version: string; before: string | null }> {
    const target = await this.targetOf(root, cardId, signal)
    // The seam's guard is an *intent*, not a bare version: `replaceIfVersion`
    // is exactly the "I saw this content, fail if it moved" case the card
    // write path needs, and it is the only arm that both rejects absence and
    // detects a lost race (FS_STALE_VERSION).
    const intent: FsWriteIntent | undefined =
      expected === undefined ? undefined : { kind: 'replaceIfVersion', version: expected.version }
    const outcome = await this.ctx.fs.writeText(target, content, intent, signal)
    return {
      operation: outcome.operation,
      version: String(outcome.version),
      before: outcome.before,
    }
  }

  /**
   * List the directory entries the folder picker shows (design screen 02).
   *
   * Direct children only, and each one is marked selectable when it is a
   * directory. A directory the deployment cannot list yields an empty list
   * rather than throwing: the picker is a navigation surface, not a probe.
   */
  async listFolders(path: string, signal?: AbortSignal): Promise<FolderEntry[]> {
    let target: FsTarget
    try {
      target = await this.ctx.fs.resolve(path, { signal })
    } catch {
      return []
    }
    let children: Awaited<ReturnType<typeof this.ctx.fs.listDir>>
    try {
      children = await this.ctx.fs.listDir(target, signal)
    } catch {
      return []
    }
    return children
      .filter((child) => child.type === 'directory')
      .map((child) => ({
        name: child.name,
        path: child.name,
        selectable: true,
        size: child.size ?? 0,
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  /**
   * Discover the artifacts of a project root, so a freshly bound project is not
   * an empty board (F1.3).
   *
   * One level deep, skipping dotfiles and dependency directories. Deeper trees
   * stay reachable through the tool layer; the board's first paint only needs a
   * representative set rather than every file under `node_modules`.
   */
  async scanProject(root: string, signal?: AbortSignal): Promise<CardId[]> {
    const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '.cache'])
    const found: CardId[] = []
    let top: Awaited<ReturnType<typeof this.ctx.fs.listDir>>
    try {
      top = await this.ctx.fs.listDir(await this.ctx.fs.resolve(root, { signal }), signal)
    } catch {
      return []
    }

    for (const child of top) {
      if (child.name.startsWith('.') || ignored.has(child.name)) continue
      if (child.type === 'file') {
        found.push(child.name)
        continue
      }
      let inner: Awaited<ReturnType<typeof this.ctx.fs.listDir>>
      try {
        inner = await this.ctx.fs.listDir(child.target, signal)
      } catch {
        continue
      }
      const entry = inner.find((item) => item.name === 'index.html')
      if (entry !== undefined) {
        found.push(`${child.name}/index.html`)
        continue
      }
      for (const grandchild of inner) {
        if (grandchild.type !== 'file' || grandchild.name.startsWith('.')) continue
        found.push(`${child.name}/${grandchild.name}`)
      }
    }
    return found.sort()
  }

  /** Candidate project roots under the configured picker root. */
  async listProjectCandidates(pickerRoot: string, signal?: AbortSignal): Promise<ProjectCandidate[]> {
    const entries = await this.listFolders(pickerRoot, signal)
    return entries.map((entry) => ({ name: entry.name, root: `${pickerRoot.replace(/\/+$/, '')}/${entry.name}` }))
  }
}
