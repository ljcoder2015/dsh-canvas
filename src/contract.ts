/**
 * dsh-canvas — the strict Typert wire contract, shared by both halves.
 *
 * This module is the single source of truth: the host manifest (`typert.ts`)
 * and the browser contribution (`client/remote.ts`) both point at
 * {@link DSH_CANVAS_INVOCATIONS}, so the two halves cannot drift apart. Every
 * Remote method has exactly one descriptor here, and every canonical board or
 * artifact value that crosses the wire is validated by a codec declared here.
 */
import { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

/**
 * Model-facing tool names, declared once.
 *
 * Harness tool names are free-form: the PTC SDK generator quotes any name that
 * is not a valid identifier (`tools["canvas.read_card"](args)`), so the dotted
 * names from the product doc's §3.6 are legal. They are kept here rather than
 * inline at each registration so the tool registry, the client's
 * `tool.call.toolview` slots and the doc's tool table stay one edit apart.
 */
export const TOOL_NAMES = {
  readCard: 'canvas.read_card',
  readSources: 'canvas.read_sources',
  linkSource: 'canvas.link_source',
  getSources: 'canvas.get_sources',
  injectCard: 'canvas.inject_card',
  readBoard: 'canvas.read_board',
  arrangeOnBoard: 'canvas.arrange_on_board',
  createOnBoard: 'canvas.create_on_board',
  organizeBoard: 'canvas.organize_board',
  linkSourceOnBoard: 'canvas.link_source_on_board',
  generateImage: 'canvas.generate_image',
  export: 'canvas.export',
  publish: 'canvas.publish',
} as const

/** Every model-facing tool name this plugin registers. */
export const TOOL_NAME_LIST: readonly string[] = Object.values(TOOL_NAMES)

/** Identifiers that address one canvas project. */
export const projectIdSchema = z.string().trim().min(1).max(120)
/** Card identity: a path relative to the owning project's root. */
export const cardIdSchema = z.string().trim().min(1).max(400)
/** Storage identity of one source edge. */
export const sourceIdSchema = z.string().trim().min(1).max(500)
/** Storage identity of one shared note. */
export const noteIdSchema = z.string().trim().min(1).max(200)
/** Absolute directory of a project root, or a directory inside it. */
export const directoryPathSchema = z.string().trim().min(1).max(1024)

/** One canvas coordinate pair. */
export const pointSchema = z.object({ x: z.number(), y: z.number() }).readonly()
/** Persisted canvas view state. */
export const viewportSchema = z
  .object({ x: z.number(), y: z.number(), zoom: z.number().positive() })
  .readonly()
/** The project style profile injected into card sessions. */
export const styleProfileSchema = z
  .object({ palette: z.array(z.string()), font: z.string(), tone: z.string() })
  .readonly()
/** One canvas project. */
export const projectSchema = z
  .object({
    id: projectIdSchema,
    name: z.string(),
    root: z.string(),
    viewport: viewportSchema,
    style: styleProfileSchema,
    createdAt: z.number(),
  })
  .readonly()
/** One card as the board renders it. Seating and binding only — session state is read live. */
export const boardCardSchema = z
  .object({
    id: cardIdSchema,
    project: projectIdSchema,
    kind: z.string(),
    kindLabel: z.string(),
    position: pointSchema,
    sessionId: z.string(),
    present: z.boolean(),
  })
  .readonly()
/** One source edge as the board renders it. */
export const boardSourceSchema = z
  .object({
    id: sourceIdSchema,
    downstream: cardIdSchema,
    upstream: cardIdSchema,
    origin: z.enum(['manual', 'reconciled']),
  })
  .readonly()
/** One shared board note. */
export const noteSchema = z
  .object({
    id: noteIdSchema,
    project: projectIdSchema,
    text: z.string(),
    author: z.string(),
    position: pointSchema,
    createdAt: z.number(),
  })
  .readonly()
/** Everything needed to paint one board. */
export const boardSnapshotSchema = z
  .object({
    project: projectSchema,
    cards: z.array(boardCardSchema),
    sources: z.array(boardSourceSchema),
    notes: z.array(noteSchema),
  })
  .readonly()
/** Bounded digest of one artifact. */
export const cardSummarySchema = z
  .object({
    cardId: cardIdSchema,
    kind: z.string(),
    path: z.string(),
    summary: z.string(),
    outline: z.array(z.string()),
    bytes: z.number(),
    updatedAt: z.number(),
  })
  .readonly()
/** Resolved upstream/downstream neighborhood of one card (F4.7). */
export const sourceChainSchema = z
  .object({
    cardId: cardIdSchema,
    direct: z.array(cardIdSchema),
    indirect: z.array(cardIdSchema),
    downstream: z.array(cardIdSchema),
  })
  .readonly()
/** One entry of the folder picker listing (design screen 02). */
export const folderEntrySchema = z
  .object({
    name: z.string(),
    path: z.string(),
    /** Whether the entry is a directory the picker can descend into or select. */
    selectable: z.boolean(),
    /** Direct child count for directories, byte size for files. */
    size: z.number(),
  })
  .readonly()
/** Result of binding a project to a directory (design screen 02 → 03). */
export const projectBindingSchema = z
  .object({ project: projectSchema, discovered: z.number() })
  .readonly()
/** Result of an artifact write (F8.1). */
export const writeResultSchema = z
  .object({
    cardId: cardIdSchema,
    operation: z.enum(['create', 'update']),
    /** Opaque freshness token, echoed back on the next guarded write. */
    version: z.string(),
    /** Content before the write; `null` when the file did not exist. */
    before: z.string().nullable(),
  })
  .readonly()
/** Structured outcome of an export attempt (F10.1). */
export const exportResultSchema = z
  .object({
    cardId: cardIdSchema,
    format: z.string(),
    ok: z.boolean(),
    /** Path of the produced artifact when `ok`. */
    path: z.string(),
    /** Machine-readable reason when not `ok`. */
    reason: z.string(),
  })
  .readonly()
/** One queued region-of-interest intent, fed to the card's next turn (F8.2/F8.4). */
export const pendingIntentSchema = z
  .object({
    id: z.string(),
    cardId: cardIdSchema,
    kind: z.enum(['text-edit', 'region-comment', 'element-style', 'reorder']),
    /** The structured intent payload, JSON-shaped by convention. */
    payload: z.string(),
    /** Data-URL of the circled screenshot, when the intent carries one. */
    image: z.string(),
    createdAt: z.number(),
  })
  .readonly()
/** Outcome of opening (or re-attaching) a card's Agent session (F3.1). */
export const sessionBindingSchema = z
  .object({ cardId: cardIdSchema, sessionId: z.string(), created: z.boolean() })
  .readonly()

/** Constrain an artifact digest to a canonical, wire-safe object. */
const json = (name: string, wire: string, typeSymbol: string, schema: z.ZodType) => ({
  name,
  wire,
  source: 'json' as const,
  codec: { mode: 'strict' as const, typeSymbol, schema },
})
const resultOf = (typeSymbol: string, schema: z.ZodType) => ({
  mode: 'strict' as const,
  typeSymbol,
  schema,
})

const P = {
  projectId: json('projectId', 'projectId', 'dsh-canvas#ProjectId', projectIdSchema),
  cardId: json('cardId', 'cardId', 'dsh-canvas#CardId', cardIdSchema),
  upstream: json('upstream', 'upstream', 'dsh-canvas#CardId', cardIdSchema),
  downstream: json('downstream', 'downstream', 'dsh-canvas#CardId', cardIdSchema),
  sourceCardId: json('sourceCardId', 'sourceCardId', 'dsh-canvas#CardId', cardIdSchema),
  sourceId: json('sourceId', 'sourceId', 'dsh-canvas#SourceId', sourceIdSchema),
  noteId: json('noteId', 'noteId', 'dsh-canvas#NoteId', noteIdSchema),
  path: json('path', 'path', 'dsh-canvas#DirectoryPath', directoryPathSchema),
  name: json('name', 'name', 'dsh-canvas#ProjectName', z.string().trim().min(1).max(120)),
  content: json('content', 'content', 'dsh-canvas#FileContent', z.string().max(2_000_000)),
  text: json('text', 'text', 'dsh-canvas#NoteText', z.string().trim().min(1).max(2_000)),
  mode: json('mode', 'mode', 'dsh-canvas#InjectionMode', z.enum(['summary', 'full'])),
  format: json('format', 'format', 'dsh-canvas#ExportFormat', z.enum(['html', 'pdf', 'pptx', 'png', 'svg', 'zip'])),
  strategy: json('strategy', 'strategy', 'dsh-canvas#ArrangeStrategy', z.enum(['source-chain', 'grid', 'organize'])),
  position: json('position', 'position', 'dsh-canvas#Point', pointSchema),
  viewport: json('viewport', 'viewport', 'dsh-canvas#Viewport', viewportSchema),
  kind: json('kind', 'kind', 'dsh-canvas#KindId', z.string().trim().min(1).max(80)),
  intentKind: json(
    'kind',
    'kind',
    'dsh-canvas#PendingIntentKind',
    z.enum(['text-edit', 'region-comment', 'element-style', 'reorder']),
  ),
  intentPayload: json('payload', 'payload', 'dsh-canvas#IntentPayload', z.string().max(200_000)),
  intentImage: json('image', 'image', 'dsh-canvas#IntentImage', z.string().max(4_000_000)),
  version: json('version', 'version', 'dsh-canvas#FsVersion', z.string().min(1).max(200)),
  style: json('style', 'style', 'dsh-canvas#StyleProfile', styleProfileSchema),
}

const R = {
  board: resultOf('dsh-canvas#BoardSnapshot', boardSnapshotSchema),
  project: resultOf('dsh-canvas#Project', projectSchema),
  projectList: resultOf('dsh-canvas#ProjectList', z.array(projectSchema)),
  binding: resultOf('dsh-canvas#ProjectBinding', projectBindingSchema),
  folders: resultOf('dsh-canvas#FolderEntryList', z.array(folderEntrySchema)),
  card: resultOf('dsh-canvas#BoardCard', boardCardSchema),
  cardList: resultOf('dsh-canvas#BoardCardList', z.array(boardCardSchema)),
  source: resultOf('dsh-canvas#BoardSource', boardSourceSchema),
  sourceList: resultOf('dsh-canvas#BoardSourceList', z.array(boardSourceSchema)),
  chain: resultOf('dsh-canvas#SourceChain', sourceChainSchema),
  note: resultOf('dsh-canvas#Note', noteSchema),
  style: resultOf('dsh-canvas#StyleProfile', styleProfileSchema),
  summary: resultOf('dsh-canvas#CardSummary', cardSummarySchema),
  summaryList: resultOf('dsh-canvas#CardSummaryList', z.array(cardSummarySchema)),
  write: resultOf('dsh-canvas#WriteResult', writeResultSchema),
  export: resultOf('dsh-canvas#ExportResult', exportResultSchema),
  session: resultOf('dsh-canvas#SessionBinding', sessionBindingSchema),
  pending: resultOf('dsh-canvas#PendingIntentList', z.array(pendingIntentSchema)),
  boolean: resultOf('dsh-canvas#Boolean', z.boolean()),
  count: resultOf('dsh-canvas#Count', z.number()),
  text: resultOf('dsh-canvas#Text', z.string()),
}

const signal = { parameter: 'signal' as const }

/**
 * Every Remote method of the plugin, one descriptor each.
 *
 * `canvas` carries board-level work — projects, seating, source edges, notes.
 * `card` carries artifact-level work — digests, injection, writes, exports.
 * Card-scoped behavior that needs to know *which* card is speaking is resolved
 * from the calling Agent in `tools.ts`, not from a Remote context parameter:
 * the browser half always passes the project and card it is acting on.
 */
export const DSH_CANVAS_INVOCATIONS: readonly InvocationDescriptor[] = [
  // ── canvas: projects ────────────────────────────────────────────────────
  {
    id: 'dsh-canvas#canvas/list_projects', service: 'canvas', namespace: 'canvas', method: 'listProjects',
    invocation: { kind: 'direct' }, parameters: [], cancellation: signal, result: R.projectList,
  },
  {
    id: 'dsh-canvas#canvas/create_project', service: 'canvas', namespace: 'canvas', method: 'createProject',
    invocation: { kind: 'direct' }, parameters: [P.name, P.path], cancellation: signal, result: R.binding,
  },
  {
    id: 'dsh-canvas#canvas/remove_project', service: 'canvas', namespace: 'canvas', method: 'removeProject',
    invocation: { kind: 'direct' }, parameters: [P.projectId], cancellation: signal, result: R.boolean,
  },
  {
    id: 'dsh-canvas#canvas/list_folders', service: 'canvas', namespace: 'canvas', method: 'listFolders',
    invocation: { kind: 'direct' }, parameters: [P.path], cancellation: signal, result: R.folders,
  },

  // ── canvas: board ───────────────────────────────────────────────────────
  {
    id: 'dsh-canvas#canvas/read_board', service: 'canvas', namespace: 'canvas', method: 'readBoard',
    invocation: { kind: 'direct' }, parameters: [P.projectId], cancellation: signal, result: R.board,
  },
  {
    id: 'dsh-canvas#canvas/set_viewport', service: 'canvas', namespace: 'canvas', method: 'setViewport',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.viewport], cancellation: signal, result: R.project,
  },
  {
    id: 'dsh-canvas#canvas/set_style', service: 'canvas', namespace: 'canvas', method: 'setStyle',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.style], cancellation: signal, result: R.style,
  },
  {
    id: 'dsh-canvas#canvas/move_card', service: 'canvas', namespace: 'canvas', method: 'moveCard',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId, P.position], cancellation: signal, result: R.card,
  },
  {
    id: 'dsh-canvas#canvas/arrange', service: 'canvas', namespace: 'canvas', method: 'arrange',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.strategy], cancellation: signal, result: R.board,
  },

  // ── canvas: source edges ────────────────────────────────────────────────
  {
    id: 'dsh-canvas#canvas/link_source', service: 'canvas', namespace: 'canvas', method: 'linkSource',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.upstream, P.downstream], cancellation: signal, result: R.source,
  },
  {
    id: 'dsh-canvas#canvas/unlink_source', service: 'canvas', namespace: 'canvas', method: 'unlinkSource',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.sourceId], cancellation: signal, result: R.boolean,
  },
  {
    id: 'dsh-canvas#canvas/get_sources', service: 'canvas', namespace: 'canvas', method: 'getSources',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.chain,
  },
  {
    id: 'dsh-canvas#canvas/reconcile', service: 'canvas', namespace: 'canvas', method: 'reconcile',
    invocation: { kind: 'direct' }, parameters: [P.projectId], cancellation: signal, result: R.sourceList,
  },

  // ── canvas: notes ───────────────────────────────────────────────────────
  {
    id: 'dsh-canvas#canvas/create_note', service: 'canvas', namespace: 'canvas', method: 'createNote',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.text, P.position], cancellation: signal, result: R.note,
  },
  {
    id: 'dsh-canvas#canvas/remove_note', service: 'canvas', namespace: 'canvas', method: 'removeNote',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.noteId], cancellation: signal, result: R.boolean,
  },

  // ── card: artifacts ─────────────────────────────────────────────────────
  {
    id: 'dsh-canvas#card/create_card', service: 'card', namespace: 'card', method: 'createCard',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId, P.kind, P.position], cancellation: signal, result: R.card,
  },
  {
    id: 'dsh-canvas#card/remove_card', service: 'card', namespace: 'card', method: 'removeCard',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.boolean,
  },
  {
    id: 'dsh-canvas#card/read_summary', service: 'card', namespace: 'card', method: 'readSummary',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.summary,
  },
  {
    id: 'dsh-canvas#card/read_sources', service: 'card', namespace: 'card', method: 'readSources',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.summaryList,
  },
  {
    id: 'dsh-canvas#card/inject_card', service: 'card', namespace: 'card', method: 'injectCard',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId, P.sourceCardId, P.mode], cancellation: signal, result: R.summary,
  },
  {
    id: 'dsh-canvas#card/open_session', service: 'card', namespace: 'card', method: 'openSession',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.session,
  },
  {
    id: 'dsh-canvas#card/release_session', service: 'card', namespace: 'card', method: 'releaseSession',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.boolean,
  },
  {
    id: 'dsh-canvas#card/write_text', service: 'card', namespace: 'card', method: 'writeText',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId, P.content], cancellation: signal, result: R.write,
  },
  {
    id: 'dsh-canvas#card/edit_text', service: 'card', namespace: 'card', method: 'editText',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId, P.content, P.version], cancellation: signal, result: R.write,
  },
  {
    id: 'dsh-canvas#card/queue_intent', service: 'card', namespace: 'card', method: 'queueIntent',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId, P.intentKind, P.intentPayload, P.intentImage], cancellation: signal, result: R.pending,
  },
  {
    id: 'dsh-canvas#card/read_pending', service: 'card', namespace: 'card', method: 'readPending',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.pending,
  },
  {
    id: 'dsh-canvas#card/export_card', service: 'card', namespace: 'card', method: 'exportCard',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId, P.format], cancellation: signal, result: R.export,
  },
  {
    id: 'dsh-canvas#card/publish_card', service: 'card', namespace: 'card', method: 'publishCard',
    invocation: { kind: 'direct' }, parameters: [P.projectId, P.cardId], cancellation: signal, result: R.export,
  },
]

/**
 * Failure codes this plugin raises.
 *
 * Merged into the protocol's `RemoteErrorDetailsMap` so `RemoteErrorCode`
 * accepts them: the plugin keeps one failure class (`RemoteError`) and encodes
 * the domain in the code, exactly as the protocol intends.
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No project is stored under this id. */
    'canvas/project-not-found': { readonly projectId: string }
    /** No card is stored under this id inside the named project. */
    'canvas/card-not-found': { readonly projectId: string; readonly cardId: string }
    /** A card is already seated under this id inside the named project. */
    'canvas/card-exists': { readonly projectId: string; readonly cardId: string }
    /** No source edge is stored under this id inside the named project. */
    'canvas/source-not-found': { readonly projectId: string; readonly sourceId: string }
    /** The edge would duplicate an existing one, or would close a cycle. */
    'canvas/source-invalid': { readonly downstream: string; readonly upstream: string; readonly reason: string }
    /** The directory cannot serve as a project root. */
    'canvas/root-unusable': { readonly path: string; readonly reason: string }
    /** The artifact's kind has no implementation for the requested operation. */
    'card/unsupported': { readonly kind: string; readonly operation: string }
    /** The card has no bound session yet. */
    'card/session-missing': { readonly projectId: string; readonly cardId: string }
    /** A guarded write lost a race against a newer version. */
    'card/stale-version': { readonly cardId: string; readonly expected: string; readonly actual: string }
    /** The artifact is absent, or is a directory where a file is required. */
    'card/artifact-absent': { readonly cardId: string; readonly path: string }
  }
}
