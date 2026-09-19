/**
 * dsh-canvas — the browser half of the Typert wire contract.
 *
 * The descriptors come from {@link DSH_CANVAS_INVOCATIONS}, the same array the
 * host manifest publishes, so the two halves cannot describe different
 * contracts. What this module adds is the *consumer* face: the two namespace
 * classes the gateway materializes (`canvas`, `card`), keyed by the hex
 * encoding of their service keys.
 *
 * The two hex names (`TypertRemoteNamespace$63616e766173` = "canvas",
 * `$63617264` = "card") are the wire identity of the namespaces. Renaming a
 * service means renaming its hex class here and its `id` in `contract.ts` in
 * the same edit — `tests/contract.spec.ts` pins the pair.
 */
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ArtifactView,
  BoardCard,
  BoardSnapshot,
  BoardSource,
  CardSummary,
  ExportResult,
  FolderEntry,
  LastPrompt,
  Note,
  PendingIntent,
  Point,
  Project,
  ProjectBinding,
  SessionBinding,
  SourceChain,
  StyleProfile,
  Viewport,
  WriteResult,
} from '../types.ts'
import { DSH_CANVAS_INVOCATIONS } from '../contract.ts'

/** What the browser mounts to obtain `ctx.remote.canvas` and `ctx.remote.card`. */
export const DSH_CANVAS_REMOTE: TypertRemoteContribution = {
  package: 'dsh-canvas',
  descriptors: DSH_CANVAS_INVOCATIONS,
}

/**
 * The `canvas` namespace — projects, seating, source edges, notes.
 *
 * Every method is the exact shape the host runtime implements: the leading
 * business parameters, the injected trailing `signal` the protocol appends to
 * a cancellable endpoint, and the `RemoteResult` envelope the gateway always
 * returns. Callers that want a plain value or an exception go through
 * `bridge.ts` instead of unwrapping the envelope at each call site.
 */
export interface CanvasFace {
  listProjects(signal?: AbortSignal): Promise<RemoteResult<Project[]>>
  createProject(name: string, path: string, signal?: AbortSignal): Promise<RemoteResult<ProjectBinding>>
  removeProject(projectId: string, signal?: AbortSignal): Promise<RemoteResult<boolean>>
  listFolders(path: string, signal?: AbortSignal): Promise<RemoteResult<FolderEntry[]>>
  readBoard(projectId: string, signal?: AbortSignal): Promise<RemoteResult<BoardSnapshot>>
  setViewport(projectId: string, viewport: Viewport, signal?: AbortSignal): Promise<RemoteResult<Project>>
  setStyle(projectId: string, style: StyleProfile, signal?: AbortSignal): Promise<RemoteResult<StyleProfile>>
  moveCard(projectId: string, cardId: string, position: Point, signal?: AbortSignal): Promise<RemoteResult<BoardCard>>
  arrange(projectId: string, strategy: string, signal?: AbortSignal): Promise<RemoteResult<BoardSnapshot>>
  linkSource(projectId: string, upstream: string, downstream: string, signal?: AbortSignal): Promise<RemoteResult<BoardSource>>
  unlinkSource(projectId: string, sourceId: string, signal?: AbortSignal): Promise<RemoteResult<boolean>>
  getSources(projectId: string, cardId: string, signal?: AbortSignal): Promise<RemoteResult<SourceChain>>
  reconcile(projectId: string, signal?: AbortSignal): Promise<RemoteResult<BoardSource[]>>
  createNote(projectId: string, text: string, position: Point, signal?: AbortSignal): Promise<RemoteResult<Note>>
  removeNote(projectId: string, noteId: string, signal?: AbortSignal): Promise<RemoteResult<boolean>>
}

/** The `card` namespace — artifact digests, session binding, writes, export. */
export interface CardFace {
  createCard(projectId: string, cardId: string, kind: string, position: Point, signal?: AbortSignal): Promise<RemoteResult<BoardCard>>
  scaffoldWebapp(projectId: string, name: string, position: Point, signal?: AbortSignal): Promise<RemoteResult<BoardCard>>
  removeCard(projectId: string, cardId: string, signal?: AbortSignal): Promise<RemoteResult<boolean>>
  readSummary(projectId: string, cardId: string, signal?: AbortSignal): Promise<RemoteResult<CardSummary>>
  readArtifact(projectId: string, cardId: string, signal?: AbortSignal): Promise<RemoteResult<ArtifactView>>
  readSources(projectId: string, cardId: string, signal?: AbortSignal): Promise<RemoteResult<CardSummary[]>>
  injectCard(
    projectId: string,
    cardId: string,
    sourceCardId: string,
    mode: string,
    signal?: AbortSignal,
  ): Promise<RemoteResult<CardSummary>>
  openSession(projectId: string, cardId: string, signal?: AbortSignal): Promise<RemoteResult<SessionBinding>>
  releaseSession(projectId: string, cardId: string, signal?: AbortSignal): Promise<RemoteResult<boolean>>
  writeText(projectId: string, cardId: string, content: string, signal?: AbortSignal): Promise<RemoteResult<WriteResult>>
  editText(
    projectId: string,
    cardId: string,
    content: string,
    version: string,
    signal?: AbortSignal,
  ): Promise<RemoteResult<WriteResult>>
  queueIntent(
    projectId: string,
    cardId: string,
    kind: string,
    payload: string,
    image: string,
    signal?: AbortSignal,
  ): Promise<RemoteResult<PendingIntent[]>>
  readPending(projectId: string, cardId: string, signal?: AbortSignal): Promise<RemoteResult<PendingIntent[]>>
  exportCard(projectId: string, cardId: string, format: string, signal?: AbortSignal): Promise<RemoteResult<ExportResult>>
  publishCard(projectId: string, cardId: string, signal?: AbortSignal): Promise<RemoteResult<ExportResult>>
  sendMessage(projectId: string, cardId: string, prompt: string, signal?: AbortSignal): Promise<RemoteResult<SessionBinding>>
  readLastPrompt(projectId: string, cardId: string, signal?: AbortSignal): Promise<RemoteResult<LastPrompt>>
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  /** Mounted `canvas` namespace face (hex of "canvas"). */
  interface TypertRemoteNamespace$63616e766173 extends CanvasFace {}
  /** Mounted `card` namespace face (hex of "card"). */
  interface TypertRemoteNamespace$63617264 extends CardFace {}

  interface TypertRemoteMap {
    'canvas/listProjects': CanvasFace['listProjects']
    'canvas/createProject': CanvasFace['createProject']
    'canvas/removeProject': CanvasFace['removeProject']
    'canvas/listFolders': CanvasFace['listFolders']
    'canvas/readBoard': CanvasFace['readBoard']
    'canvas/setViewport': CanvasFace['setViewport']
    'canvas/setStyle': CanvasFace['setStyle']
    'canvas/moveCard': CanvasFace['moveCard']
    'canvas/arrange': CanvasFace['arrange']
    'canvas/linkSource': CanvasFace['linkSource']
    'canvas/unlinkSource': CanvasFace['unlinkSource']
    'canvas/getSources': CanvasFace['getSources']
    'canvas/reconcile': CanvasFace['reconcile']
    'canvas/createNote': CanvasFace['createNote']
    'canvas/removeNote': CanvasFace['removeNote']

    'card/createCard': CardFace['createCard']
    'card/scaffoldWebapp': CardFace['scaffoldWebapp']
    'card/removeCard': CardFace['removeCard']
    'card/readSummary': CardFace['readSummary']
    'card/readArtifact': CardFace['readArtifact']
    'card/readSources': CardFace['readSources']
    'card/injectCard': CardFace['injectCard']
    'card/openSession': CardFace['openSession']
    'card/releaseSession': CardFace['releaseSession']
    'card/writeText': CardFace['writeText']
    'card/editText': CardFace['editText']
    'card/queueIntent': CardFace['queueIntent']
    'card/readPending': CardFace['readPending']
    'card/exportCard': CardFace['exportCard']
    'card/publishCard': CardFace['publishCard']
    'card/sendMessage': CardFace['sendMessage']
    'card/readLastPrompt': CardFace['readLastPrompt']
  }

  interface TypertRemoteNamespaceMap {
    canvas: CanvasFace
    card: CardFace
  }
}
