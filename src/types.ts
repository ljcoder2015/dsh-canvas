/**
 * dsh-canvas — shared types for both halves of the plugin.
 *
 * These are the values that actually cross the wire or land in the storage
 * domain. The zod schemas that validate them live in `contract.ts` (wire) and
 * `domain.ts` (durable records); this module only names the shapes.
 */

/** Branded project identifier. */
export type ProjectId = string
/** Card identity: the path of the bound file, relative to the project root. */
export type CardId = string
/** Storage key of a card record — project-qualified so two projects may hold the same relative path. */
export type CardKey = string
/** Storage key of a source edge. */
export type SourceId = string
/** Storage key of a shared note. */
export type NoteId = string
/** Bound Agent session identity. */
export type SessionId = string

/** Where a card sits on the infinite canvas, in canvas coordinates. */
export interface Point {
  x: number
  y: number
}

/** Persisted view state of one canvas (F1.4). */
export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** Per-project style profile (F9.1) — injected into every card session prompt. */
export interface StyleProfile {
  /** Named colour tokens the project standardises on, e.g. `['#FF7A17', '#0A0A0A']`. */
  palette: string[]
  /** Preferred type family, e.g. `'Inter / Noto Sans SC'`. */
  font: string
  /** Tone-of-voice instruction, e.g. `'克制、结论先行'`. */
  tone: string
}

/** One canvas project: a name, a workspace root on disk, and its own view state. */
export interface Project {
  id: ProjectId
  name: string
  /** Absolute directory the project's cards are relative to. */
  root: string
  viewport: Viewport
  style: StyleProfile
  createdAt: number
}

/** One artifact card (F1.2) — a file on disk plus its board position and bound session. */
export interface Card {
  /** Path relative to the owning project's root. */
  id: CardId
  project: ProjectId
  /** Kind id resolved by the kind registry (F2.2). */
  kind: string
  position: Point
  /** Bound Agent session; empty until the session is created through the agent lifecycle. */
  sessionId: SessionId
  /** Epoch millis of the last observed write, used for staleness hints. */
  updatedAt: number
}

/** The single directed edge type (F4.1): the downstream card sources from the upstream card. */
export interface Source {
  id: SourceId
  project: ProjectId
  /** The card whose artifact builds on the other. */
  downstream: CardId
  /** The card whose artifact is used as material. */
  upstream: CardId
  /** Manual connection, or produced by artifact reconciliation (F4.5). */
  origin: 'manual' | 'reconciled'
}

/** A shared board note (F9.3). */
export interface Note {
  id: NoteId
  project: ProjectId
  text: string
  author: string
  position: Point
  createdAt: number
}

/** Aggregate card state derived from its session and its file (F3.5). */
export type CardStatus = 'idle' | 'running' | 'notified'

/**
 * One card as the board renders it.
 *
 * Deliberately carries no session *state*: whether the bound session is idle,
 * running or holding a notification is read live from the session itself by
 * the browser half (§4.8 — subscribe, do not poll or mirror). The board
 * snapshot is seating and binding only.
 */
export interface BoardCard {
  id: CardId
  project: ProjectId
  kind: string
  /** Human label of the kind, for the card's caption. */
  kindLabel: string
  position: Point
  sessionId: SessionId
  /** Whether the bound file currently exists on disk. */
  present: boolean
}

/** One source edge as the board renders it. */
export interface BoardSource {
  id: SourceId
  downstream: CardId
  upstream: CardId
  origin: Source['origin']
}

/** Everything the client needs to paint one board (F1.3). */
export interface BoardSnapshot {
  project: Project
  cards: readonly BoardCard[]
  sources: readonly BoardSource[]
  notes: readonly Note[]
}

/** Content summary of one artifact, used both for injection and for card previews (F5.2). */
export interface CardSummary {
  cardId: CardId
  kind: string
  /** Absolute path on disk. */
  path: string
  /** Bounded prose/plain-text digest of the artifact. */
  summary: string
  /** Structural outline — headings, slide titles, top-level keys. */
  outline: string[]
  /** Byte size, or 0 when unknown. */
  bytes: number
  updatedAt: number
}

/** One entry of the resolved source chain (F4.7). */
export interface SourceChain {
  cardId: CardId
  /** Cards this card directly sources from. */
  direct: string[]
  /** Transitive upstreams, ordered nearest first, excluding `direct`. */
  indirect: string[]
  /** Cards that source from this card. */
  downstream: string[]
}

/** Result of an artifact write (F8.1). */
export interface WriteResult {
  cardId: CardId
  /** Whether the write created the artifact or replaced an existing one. */
  operation: 'create' | 'update'
  /** Freshness token to echo back on the next guarded write. */
  version: string
  /** Content before the write; `null` when the artifact did not exist. */
  before: string | null
}

/** One queued region-of-interest intent, fed to the card's next turn (F8.2/F8.4). */
export interface PendingIntent {
  id: string
  cardId: CardId
  kind: 'text-edit' | 'region-comment' | 'element-style' | 'reorder'
  /** The structured intent payload, JSON-shaped by convention. */
  payload: string
  /** Data-URL of the circled screenshot, when the intent carries one. */
  image: string
  createdAt: number
}

/** Outcome of opening (or re-attaching) a card's Agent session (F3.1). */
export interface SessionBinding {
  cardId: CardId
  sessionId: SessionId
  /** Whether this call created the conversation, or reused a live one. */
  created: boolean
}

/** How `canvas.arrange_on_board` lays the board out (F4.6). */
export type ArrangeStrategy = 'source-chain' | 'grid' | 'organize'

/** Export formats a kind may offer (F10.1). */
export type ExportFormat = 'html' | 'pdf' | 'pptx' | 'png' | 'svg' | 'zip'

/** Session response policy when an upstream artifact changes (F5.7). */
export type UpstreamPolicy = 'silent' | 'notify' | 'pull'

/** Host configuration, validated and defaulted by `Config` in `index.ts`. */
export interface ResolvedConfig {
  /** Directory scanned for candidate workspace folders when the picker opens. */
  pickerRoot: string
  /** Horizontal gap between layered cards when arranging by source chain, in canvas px. */
  arrangeGap: number
  /** Cap on the characters of one upstream artifact digest injected into a card session (F5.2). */
  summaryBudget: number
  /** Depth of the transitive source chain resolved by `canvas.get_sources`. */
  sourceDepth: number
  /** Default response policy when an upstream artifact changes (F5.7). */
  upstreamPolicy: UpstreamPolicy
}

/** Result of binding a directory to a project (F1.1, design screen 02). */
export interface ProjectBinding {
  project: Project
  /** How many artifacts the initial scan discovered under the root. */
  discovered: number
}

/** Structured outcome of an export or publish attempt (F10.1/F10.3). */
export interface ExportResult {
  cardId: CardId
  /** Requested format, or the publishing backend's name for a publish. */
  format: string
  ok: boolean
  /** Path (or URL) of the produced artifact when `ok`. */
  path: string
  /** Machine-readable reason when not `ok`; `''` on success. */
  reason: string
}

/** Result of publishing one artifact (F10.3). */
export interface PublishResult {
  /** Public URL the artifact became reachable at. */
  url: string
  /** Name of the backend that served the publish, for the card's status line. */
  provider: string
}

/** One row of the folder picker listing (design screen 02). */
export interface FolderEntry {
  name: string
  /** Project-relative path of the entry. */
  path: string
  /** Whether the entry is a directory the picker can descend into or select. */
  selectable: boolean
  /** Direct child count for directories, byte size for files. */
  size: number
}

/** One entry of the kind registry (F2.1/F2.4). */
export interface KindDefinition {
  /** Stable kind id, e.g. `html-deck`. */
  id: string
  /** Human label shown on the card caption. */
  label: string
  /** Address globs the client tab claims for this kind (§4.7). */
  addressPatterns: readonly string[]
  /** Whether the artifact is a directory with an `index.html` entry, not a single file. */
  directory: boolean
  /** Formats this kind can export to (F10.1). */
  exportFormats: readonly ExportFormat[]
  /** Whether the artifact can be published (F10.3). */
  publishable: boolean
}
