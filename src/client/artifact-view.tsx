/**
 * dsh-canvas — the artifact's fullscreen view, one component per kind (F3.8).
 *
 * Double-clicking a card opens its artifact full screen, and *what* opens is
 * decided by the artifact's kind, not by one component full of `if (kind === …)`:
 * a `VIEWERS` table maps a kind id to its viewer, the way the kind registry maps
 * evidence to a kind. Adding a viewer is adding an entry — no scattered branch
 * (F2.4's rule, applied to the view layer).
 *
 * Content arrives as one `ArtifactView` payload over the plugin wire: text
 * kinds read whole within the wire cap, binary media as a data URL the browser
 * can hand to `<img>` / `<video>` directly. Nothing here fetches anything else,
 * and the markdown renderer escapes first and builds tags after, so artifact
 * content can never inject markup into the host page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, ReactElement } from 'react'
import type { ArtifactView } from '../types.ts'
import { isHtmlKind } from '../core/kind-registry.ts'
import type { Translate } from './locales.ts'

/** Props every kind viewer receives. */
export interface ViewerProps {
  view: ArtifactView
  t: Translate
}

/** The viewer ids the registry can hand out — stable strings, testable pure. */
export type ViewerId = 'markdown' | 'image' | 'deck' | 'data' | 'video' | 'text'

/**
 * Which viewer a kind opens with.
 *
 * Pure and total: every kind id the classifier can produce lands somewhere, so
 * a board is never one unhandled kind away from a blank modal.
 *
 * @param kind - the kind id from the artifact's read-time classification.
 */
export function viewerIdFor(kind: string): ViewerId {
  // 整个 HTML 家族（幻灯片 / 站点 / 应用）共用同一个 iframe 预览。它们的入口页
  // 由 host 把本地样式表与脚本内联进文本，沙箱 iframe 里直接就是跑起来的页面
  // ——kind 清单只有一份（HTML_KINDS），别在这里再抄一遍。
  if (isHtmlKind(kind)) return 'deck'
  switch (kind) {
    case 'markdown':
      return 'markdown'
    case 'image':
      return 'image'
    case 'data':
      return 'data'
    case 'video':
      return 'video'
    default:
      return 'text'
  }
}

// ── markdown ────────────────────────────────────────────────────────────────

/** Escape a string into text that cannot open or close a tag. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Render a bounded markdown subset to HTML.
 *
 * The input is artifact content — model-written, user-written, never trusted —
 * so the first transformation escapes *everything*, and every tag in the output
 * is one this function built. Supported: fenced code, headings, hr, blockquote,
 * ordered/unordered lists, bold / italic / inline code / links, paragraphs.
 * The exact subset is pinned by `tests/artifact-view.spec.ts`.
 *
 * @param source - the markdown text.
 * @returns an HTML fragment, safe by construction.
 */
export function renderMarkdown(source: string): string {
  const stash: string[] = []
  // Fenced code goes into placeholders first, so nothing inside a fence can be
  // re-interpreted as structure. A placeholder is only honoured once and only
  // while its slot exists, so artifact content cannot forge or replay one.
  const withFences = source.replace(/```[^\n]*\n[\s\S]*?```/g, (block) => {
    const inner = block.replace(/^```[^\n]*\n/, '').replace(/```\s*$/, '')
    stash.push(`<pre class="dsh-md-code"><code>${escapeHtml(inner.replace(/\n$/, ''))}</code></pre>`)
    return `\u0000${stash.length - 1}\u0000`
  })

  const inline = (text: string): string =>
    escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code class="dsh-md-inline">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')

  const out: string[] = []
  let list: 'ul' | 'ol' | undefined
  let paragraph: string[] = []
  // Each stash slot is consumed once: artifact content cannot forge a second
  // reference to a real fence, and a forged slot number resolves to nothing.
  const consumed = new Set<number>()
  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      out.push(`<p>${inline(paragraph.join(' '))}</p>`)
      paragraph = []
    }
  }
  const closeList = (): void => {
    if (list !== undefined) {
      out.push(`</${list}>`)
      list = undefined
    }
  }

  for (const raw of withFences.split(/\r?\n/)) {
    const line = raw.trimEnd()
    // The sentinel is NUL — a character real prose never starts a line with,
    // and one this function consumes exactly once per fence (see `consumed`).
    // eslint-disable-next-line no-control-regex
    const fence = /^\u0000(\d+)\u0000$/.exec(line)
    if (fence !== null && !consumed.has(Number(fence[1])) && Number(fence[1]) < stash.length) {
      consumed.add(Number(fence[1]))
      flushParagraph()
      closeList()
      out.push(stash[Number(fence[1])])
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      flushParagraph()
      closeList()
      const level = Math.min(heading[1].length, 4)
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushParagraph()
      closeList()
      out.push('<hr class="dsh-md-hr">')
      continue
    }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote !== null) {
      flushParagraph()
      closeList()
      out.push(`<blockquote class="dsh-md-quote">${inline(quote[1])}</blockquote>`)
      continue
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (bullet !== null) {
      flushParagraph()
      if (list !== 'ul') {
        closeList()
        out.push('<ul class="dsh-md-list">')
        list = 'ul'
      }
      out.push(`<li>${inline(bullet[1])}</li>`)
      continue
    }
    const ordered = /^\d+[.)]\s+(.*)$/.exec(line)
    if (ordered !== null) {
      flushParagraph()
      if (list !== 'ol') {
        closeList()
        out.push('<ol class="dsh-md-list">')
        list = 'ol'
      }
      out.push(`<li>${inline(ordered[1])}</li>`)
      continue
    }
    if (line.trim() === '') {
      flushParagraph()
      closeList()
      continue
    }
    paragraph.push(line.trim())
  }
  flushParagraph()
  closeList()
  return out.join('\n')
}

/** The markdown viewer: artifact prose, rendered. */
function MarkdownViewer({ view }: ViewerProps) {
  const html = useMemo(() => renderMarkdown(view.text), [view.text])
  return <div className="dsh-canvas-md" dangerouslySetInnerHTML={{ __html: html }} />
}

// ── image / video ───────────────────────────────────────────────────────────

/** The image viewer: the artifact, letterboxed on a plain surface. */
function ImageViewer({ view }: ViewerProps) {
  return (
    <div className="dsh-canvas-media">
      <img src={view.dataUrl} alt={view.cardId} />
    </div>
  )
}

/** The video viewer: native controls, keep it that way. */
function VideoViewer({ view }: ViewerProps) {
  return (
    <div className="dsh-canvas-media">
      <video src={view.dataUrl} controls />
    </div>
  )
}

// ── html / deck ─────────────────────────────────────────────────────────────

/**
 * The HTML / deck viewer: the artifact in a sandboxed iframe.
 *
 * `allow-scripts` without `allow-same-origin` is the working compromise: decks
 * run their own JS (revealing slides needs it), while the document sits in an
 * opaque origin that cannot reach the host page, its storage or its cookies.
 */
function DeckViewer({ view }: ViewerProps) {
  return (
    <iframe
      className="dsh-canvas-frame"
      sandbox="allow-scripts"
      srcDoc={view.text}
      title={view.cardId}
    />
  )
}

// ── data ────────────────────────────────────────────────────────────────────

/**
 * Parse delimited text into rows.
 *
 * Pure, and pinned by the tests: quoted cells with embedded commas and escaped
 * quotes (`""`) are the two cases a naive `split(',')` mangles, and a data
 * viewer that mangles rows is worse than none.
 *
 * @param text - the CSV / TSV body.
 * @param delimiter - the field delimiter.
 * @returns the rows, shortest-first normalised to the widest row's length.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 1
        } else quoted = false
      } else cell += char
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === delimiter) {
      row.push(cell)
      cell = ''
      continue
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell)
      cell = ''
      rows.push(row)
      row = []
      continue
    }
    cell += char
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

/** The data viewer: CSV / TSV as a table, JSON pretty-printed. */
function DataViewer({ view }: ViewerProps) {
  const extension = (view.cardId.split('.').pop() ?? '').toLowerCase()
  const content = useMemo(() => {
    if (extension === 'json') {
      try {
        return JSON.stringify(JSON.parse(view.text), null, 2)
      } catch {
        return view.text
      }
    }
    return undefined
  }, [extension, view.text])
  const rows = useMemo(() => {
    if (content !== undefined) return undefined
    const delimiter = extension === 'tsv' ? '\t' : ','
    return parseDelimited(view.text, delimiter).slice(0, 400)
  }, [content, extension, view.text])

  if (content !== undefined) return <pre className="dsh-canvas-pre">{content}</pre>
  if (rows === undefined || rows.length === 0) return <div className="dsh-canvas-viewer-note">{''}</div>
  const [head = [], ...body] = rows
  return (
    <div className="dsh-canvas-tablewrap">
      <table className="dsh-canvas-table">
        <thead>
          <tr>{head.map((cell, index) => <th key={index}>{cell}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── fallback ────────────────────────────────────────────────────────────────

/** The text viewer: everything else, as it is on disk. */
function TextViewer({ view }: ViewerProps) {
  return <pre className="dsh-canvas-pre">{view.text}</pre>
}

/**
 * Whether a kind's artifact is editable as text in place.
 *
 * Only the kinds whose whole payload *is* the file's own text: the editor hands
 * the artifact back in one piece, so the two that qualify are the two the
 * reader returns verbatim. `data` is deliberately out — its viewer renders a
 * table, and editing the raw body behind it is a different feature from editing
 * prose. The `truncated` gate lives at the call site (see {@link ArtifactModal}):
 * a part-read file must not be writable, or one save would replace everything
 * this page never saw.
 *
 * @param kind - the kind id from the artifact's read-time classification.
 */
export function isEditableText(kind: string): boolean {
  return kind === 'markdown' || kind === 'text'
}

// ── preview / edit mode (F3.12) ─────────────────────────────────────────────

/** Which face of the modal is up: the rendered artifact, or the editor. */
export type ViewerMode = 'preview' | 'edit'

/**
 * Where an arrow key moves the mode group, as a pure step.
 *
 * The group is one control with two choices, and the arrow keys are what make it
 * a radio group rather than two unrelated buttons: pressing an arrow *selects*
 * the neighbour rather than merely moving a cursor onto it. Left/Up mean "the
 * earlier option", Right/Down "the later one", which for a two-item group is the
 * whole of the semantics. A key already pointing at the end returns null — that
 * is the caller's cue to leave the event alone instead of swallowing it.
 *
 * @param current - the mode in force.
 * @param key - the `KeyboardEvent.key` that arrived.
 * @returns the mode to switch to, or null if this key is not the group's.
 */
export function modeAfterKey(current: ViewerMode, key: string): ViewerMode | null {
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      return current === 'edit' ? 'preview' : null
    case 'ArrowRight':
    case 'ArrowDown':
      return current === 'preview' ? 'edit' : null
    default:
      return null
  }
}

// ── autosave pacing ─────────────────────────────────────────────────────────

/**
 * How long typing must pause before the buffer is written on its own.
 *
 * A pure debounce never fires while the user keeps typing, so a long paragraph
 * could sit unwritten for minutes; a pure throttle writes mid-word and turns
 * every keystroke burst into disk traffic. These two numbers together are the
 * compromise: settle {@link AUTOSAVE_SETTLE_MS} after the last keystroke, but
 * never let a run of typing go past {@link AUTOSAVE_MAX_WAIT_MS} uncheckpointed.
 */
export const AUTOSAVE_SETTLE_MS = 800
export const AUTOSAVE_MAX_WAIT_MS = 5000

/**
 * How long to wait before the next autosave.
 *
 * Exported and pure so the pacing is pinned by a test rather than only being
 * observable by watching a browser: the two useful properties are "a pause is
 * followed by a write" and "the wait never exceeds the ceiling".
 *
 * @param elapsed - ms since the buffer first ran ahead of the disk.
 * @param settleMs - the quiet period a pause earns.
 * @param maxWaitMs - the longest a pending buffer may stay unwritten.
 * @returns the delay in ms; 0 means write now.
 */
export function autosaveDelay(
  elapsed: number,
  settleMs: number = AUTOSAVE_SETTLE_MS,
  maxWaitMs: number = AUTOSAVE_MAX_WAIT_MS,
): number {
  if (!Number.isFinite(elapsed) || elapsed < 0) return settleMs
  return Math.max(0, Math.min(settleMs, maxWaitMs - elapsed))
}

// ── failing writes ──────────────────────────────────────────────────────────

/**
 * What a refused write means for the autosave: try again later, or stop.
 *
 * The distinction is the whole reason this is a named decision rather than an
 * inline `catch`: a *transient* failure (the wire blipped, the file was held for
 * a moment) deserves another attempt, while a *blocked* one is the filesystem
 * saying no in a way that repeating cannot change — `EPERM` on the rename that
 * publishes the write, a read-only volume, a path that is no longer a regular
 * file. Retrying a blocked write on the autosave clock costs a staging file per
 * attempt (the host writes through a private temp dir, and a refused rename
 * leaves it behind) and tells the user nothing new.
 *
 * The markers are the errno names as the host spells them out in the message,
 * so this reads the wire rather than a structured code: only the message crosses
 * the RemoteError boundary.
 *
 * @param message - the failure's message, as the wire handed it over.
 * @returns `blocked` when another automatic attempt would be noise.
 */
export function writeFailureShape(message: string): 'blocked' | 'transient' {
  return /EPERM|EACCES|EROFS|ENOTDIR|not a regular file/i.test(message) ? 'blocked' : 'transient'
}

/** The first wait after a failed write; doubles per consecutive failure. */
export const AUTOSAVE_BACKOFF_MS = 2000
/** The longest wait between attempts, however long the failures run. */
export const AUTOSAVE_BACKOFF_CAP_MS = 30_000

/**
 * How long a *failed* write waits before trying again.
 *
 * The settle window suits a healthy wire and is far too eager for a wire that is
 * refusing: on a transient failure the retry backs off 2s, 4s, 8s … so a run of
 * failures cannot turn into a write every 800ms, and a cause that heals by
 * itself (a lock released, a service restarted) is picked up without the user
 * having to do anything.
 *
 * @param failures - consecutive failures so far; 0 means the last write landed.
 * @param baseMs - the first wait.
 * @param capMs - the ceiling on the wait.
 * @returns the delay in ms; 0 when there is nothing to wait for.
 */
export function autosaveRetryDelay(
  failures: number,
  baseMs: number = AUTOSAVE_BACKOFF_MS,
  capMs: number = AUTOSAVE_BACKOFF_CAP_MS,
): number {
  if (!Number.isFinite(failures) || failures < 1) return 0
  return Math.min(baseMs * 2 ** (Math.floor(failures) - 1), capMs)
}

/** Kind id → viewer. The whole branching of this feature is this table. */
const VIEWERS: Readonly<Record<ViewerId, ComponentType<ViewerProps>>> = {
  markdown: MarkdownViewer,
  image: ImageViewer,
  deck: DeckViewer,
  data: DataViewer,
  video: VideoViewer,
  text: TextViewer,
}

/**
 * The fullscreen artifact modal the board opens on double-click.
 *
 * Self-contained on purpose: it reads its own payload once per open (the board
 * re-reads summaries for previews, but a modal that appears on demand should
 * not piggyback on state the board keeps for every card), renders the state
 * machine around the content — absent, over-cap, load error — and hands the
 * kind to the registry for the view itself. Its head carries the artifact's
 * name, its kind, the way out, and — for a text node — the preview/edit group.
 *
 * Editing is a mode of this same modal rather than a second dialog, because
 * what the user edits and what they just read are the same artefact: `draft`
 * survives a hop back to the preview, so checking the rendered result never
 * costs the work, and a close with unsaved changes asks first instead of
 * dropping them silently.
 *
 * The buffer — not the payload — is what the preview renders, and it is written
 * on a throttle as well as on demand (see {@link autosaveDelay}): a preview that
 * showed the file on disk would look like the edit had been thrown away, and a
 * save that only happens when the user remembers to ask is a save that does not
 * happen. A write is always followed by a re-read, so "dirty" is a comparison
 * against the disk rather than a flag somebody has to remember to clear.
 */
export function ArtifactModal(props: {
  projectId: string
  cardId: string
  bridge: {
    readArtifact(projectId: string, cardId: string): Promise<ArtifactView>
    writeText(projectId: string, cardId: string, content: string): Promise<unknown>
  }
  t: Translate
  /** Open straight into the editor — the control strip's 手动输入 button. */
  initialMode?: ViewerMode
  /** A save landed; the board re-reads what it draws from this. */
  onSaved?: () => void
  onClose: () => void
}) {
  const { projectId, cardId, bridge, t, initialMode, onSaved, onClose } = props
  const [view, setView] = useState<ArtifactView | undefined>(undefined)
  const [error, setError] = useState('')
  /** `edit` while the textarea is up; the mode group moves between the two. */
  const [mode, setMode] = useState<ViewerMode>(initialMode ?? 'preview')
  /** The mode group, so an arrow key can hand the focus to the option it picked. */
  const modeGroup = useRef<HTMLDivElement | null>(null)
  /** The editor's text. Survives a hop back to the preview, by design. */
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  /**
   * Consecutive failed writes, and whether the failure was one that repeating
   * cannot fix. State rather than refs: both steer the autosave effect, so a
   * change has to re-arm (or stop) the timer.
   *
   * `blocked` is the answer to "the filesystem refused this directory" — the
   * automatic attempts stop there, because each one costs a staging file the
   * host leaves behind (it writes through a private temp dir and cannot clean it
   * up when the rename is refused) and the user is the only one who can change
   * the answer. The buffer is untouched either way: the draft stays, the close
   * still asks, and 保存 / 重试 still try on demand.
   */
  const [failures, setFailures] = useState(0)
  const [blocked, setBlocked] = useState(false)
  const [saved, setSaved] = useState(false)
  /** The close was asked for with unsaved changes: asking, not closing. */
  const [confirming, setConfirming] = useState(false)
  /**
   * The buffer's text, beside the state rather than instead of it.
   *
   * Two callers read the newest text from outside React's render cycle: the
   * autosave timer, whose callback closes over whatever draft the effect saw
   * last, and the post-write adoption check. Both must see what is in the box
   * *now*, so neither may read the state variable. Every write goes through
   * {@link setBuffer}, so the ref and the state cannot drift apart.
   */
  const draftRef = useRef('')
  /** A write is on the wire. A ref: the timers must not re-arm when it flips. */
  const savingRef = useRef(false)
  /** When the buffer first ran ahead of the disk; null while the two agree. */
  const dirtySince = useRef<number | null>(null)
  /**
   * The board's refresh callback, held rather than depended on.
   *
   * It is an inline arrow at the call site, so it is a new function on every
   * board render — and `flush` is on the autosave effect's dependency list. A
   * volatile callback there would re-arm the timer on each re-render and turn
   * the 800ms settle into "somewhere before 5s". The ref keeps `flush` stable;
   * the effect below is what keeps the ref current.
   */
  const onSavedRef = useRef(onSaved)
  useEffect(() => {
    onSavedRef.current = onSaved
  }, [onSaved])

  const setBuffer = useCallback((text: string): void => {
    draftRef.current = text
    setDraft(text)
  }, [])

  useEffect(() => {
    let cancelled = false
    setView(undefined)
    setError('')
    setMode(initialMode ?? 'preview')
    setBuffer('')
    setSaved(false)
    setSaveError('')
    setFailures(0)
    setBlocked(false)
    setConfirming(false)
    dirtySince.current = null
    bridge
      .readArtifact(projectId, cardId)
      .then((payload) => {
        if (cancelled) return
        setView(payload)
        setBuffer(payload.text)
        // An absent file has no kind evidence worth trusting, and a part-read
        // one must not be written: both land in the preview, where the note
        // says why, rather than in an editor that would overwrite blind.
        if (payload.present && payload.truncated) setMode('preview')
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : t('canvas.error.unknown'))
      })
    return () => {
      cancelled = true
    }
  }, [bridge, cardId, projectId, t, initialMode, setBuffer])

  const editKind = view !== undefined && isEditableText(view.kind)
  const canEdit = editKind && view.truncated === false
  const editing = mode === 'edit' && canEdit
  // Compared against the payload rather than kept as a flag: after a save the
  // payload *is* the draft, so "dirty" falls back to false on its own.
  const dirty = view !== undefined && canEdit && draft !== view.text

  /**
   * Move the mode group by keyboard (see {@link modeAfterKey}).
   *
   * Selection follows the arrow — that is what separates a radio group from a
   * toolbar of buttons — and focus follows the selection, so Tab still lands on
   * the group once rather than on each half. Switching to the editor ends with
   * the caret in it anyway: the textarea autofocuses when it mounts.
   */
  const moveMode = useCallback(
    (key: string): void => {
      const next = modeAfterKey(editing ? 'edit' : 'preview', key)
      if (next === null) return
      setMode(next)
      modeGroup.current?.querySelectorAll('button')[next === 'preview' ? 0 : 1]?.focus()
    },
    [editing],
  )

  /**
   * Write the buffer back, then re-read what landed.
   *
   * `settle` is the only difference between the two callers: ⌘/Ctrl+S and the
   * 保存 button hand the user over to the preview — they asked to see the
   * result — while an autosave leaves them exactly where they are. An autosave
   * that yanked the editor away mid-sentence would be worse than none.
   */
  const flush = useCallback(
    async (text: string, settle: 'stay' | 'preview'): Promise<void> => {
      if (savingRef.current) return
      savingRef.current = true
      setSaving(true)
      setSaveError('')
      try {
        await bridge.writeText(projectId, cardId, text)
        const payload = await bridge.readArtifact(projectId, cardId)
        setView(payload)
        // Adopt what came back only if nothing was typed while it was in
        // flight. A slow re-read must not eat the keystrokes that landed after
        // the write: when the buffer has moved on, it simply stays dirty and
        // the next round writes it.
        if (draftRef.current === text) {
          setBuffer(payload.text)
          setSaved(true)
          if (settle === 'preview') setMode('preview')
        }
        setFailures(0)
        setBlocked(false)
        setSaveError('')
        onSavedRef.current?.()
      } catch (reason: unknown) {
        const message = reason instanceof Error ? reason.message : t('canvas.error.unknown')
        setFailures((count) => count + 1)
        setSaveError(message)
        // A blocked write ends the automatic attempts here. The message stays up
        // with a 重试 beside it, so the user keeps the lever without the plugin
        // hammering a directory that has already said no.
        if (writeFailureShape(message) === 'blocked') setBlocked(true)
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    [bridge, cardId, projectId, setBuffer, t],
  )

  /** Save on demand. `draft` is read through the ref: this may run from a key. */
  const save = useCallback((): void => {
    if (dirty) void flush(draftRef.current, 'preview')
  }, [dirty, flush])

  /**
   * Try the write again after a blocked one, and put the autosave back on duty.
   *
   * The user's lever: nothing about the refusal is the plugin's to fix, so the
   * plugin waits for whoever can fix it and then does exactly what they asked.
   */
  const retry = useCallback((): void => {
    setBlocked(false)
    setFailures(0)
    dirtySince.current = null
    void flush(draftRef.current, 'stay')
  }, [flush])

  /**
   * Autosave, throttled, and deliberately not gated on the face being shown.
   *
   * A pending buffer settles wherever it is — hopping to the preview to read a
   * paragraph is not a way to leave the edit unwritten. The buffer is what the
   * preview renders until the write confirms, so what the user reads and what
   * is coming never disagree.
   *
   * A failed write owns the clock instead of the settle window (see
   * {@link autosaveRetryDelay}): a wire that keeps refusing gets one attempt per
   * backoff, not one per pause. When the refusal is one repeating cannot fix,
   * the effect stands down entirely — {@link retry} is how it comes back.
   */
  useEffect(() => {
    if (!canEdit || view === undefined || draft === view.text || blocked) {
      dirtySince.current = null
      return
    }
    const now = Date.now()
    if (dirtySince.current === null) dirtySince.current = now
    const delay = failures > 0 ? autosaveRetryDelay(failures) : autosaveDelay(now - dirtySince.current)
    const timer = window.setTimeout(() => {
      dirtySince.current = null
      void flush(draftRef.current, 'stay')
    }, delay)
    return () => window.clearTimeout(timer)
  }, [blocked, canEdit, draft, failures, flush, view])

  /** Leave — unless there is unsaved text, in which case ask first. */
  const requestClose = useCallback((): void => {
    if (dirty) setConfirming(true)
    else onClose()
  }, [dirty, onClose])

  // Escape asks the same question as ×; ⌘/Ctrl+S is the editor's save, the
  // chord users already have in their fingers. It stays live on the preview
  // face too: while a draft is pending, the chord means "do it now and show me".
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (confirming) setConfirming(false)
        else requestClose()
        return
      }
      if (canEdit && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canEdit, confirming, requestClose, save])

  /**
   * The head's one status slot, in the order the user cares about: a write in
   * flight, then pending text, then the last outcome — and in the editor with
   * nothing pending, the standing fact that pausing is enough to save.
   */
  const status = saving
    ? t('canvas.viewer.saving')
    : blocked
      ? // Above `dirty` on purpose: that the text is unsaved is plain from the
        // error bar, while "nothing will be retried until you say so" is the
        // fact the user cannot see anywhere else.
        t('canvas.viewer.autosaveOff')
      : dirty
        ? t('canvas.viewer.dirty')
        : saved
          ? t('canvas.viewer.saved')
          : editing
            ? t('canvas.viewer.autosave')
            : ''

  let body: ReactElement
  if (error !== '') {
    body = <div className="dsh-canvas-viewer-note">{t('canvas.error', { message: error })}</div>
  } else if (view === undefined) {
    body = <div className="dsh-canvas-viewer-note">{t('canvas.viewer.loading')}</div>
  } else if (editing) {
    body = (
      <div className="dsh-canvas-viewer-body">
        <textarea
          className="dsh-canvas-viewer-editor"
          value={draft}
          autoFocus
          spellCheck={false}
          onChange={(event) => {
            setBuffer(event.target.value)
            setSaved(false)
          }}
        />
      </div>
    )
  } else if (!view.present) {
    body = <div className="dsh-canvas-viewer-note">{t('canvas.viewer.absent')}</div>
  } else if (view.truncated && view.dataUrl === '' && view.text === '') {
    body = (
      <div className="dsh-canvas-viewer-note">
        {t('canvas.viewer.tooLarge')}
      </div>
    )
  } else {
    const Viewer = VIEWERS[viewerIdFor(view.kind)]
    // The viewer is fed the *buffer*, not the payload, whenever the two differ:
    // a preview that rendered the file on disk would show the prose the user
    // just replaced, and reading it back would look like the edit was lost.
    const shown = dirty ? { ...view, text: draft } : view
    body = (
      <div className="dsh-canvas-viewer-body">
        {dirty ? <div className="dsh-canvas-viewer-draft">{t('canvas.viewer.draftPreview')}</div> : null}
        {view.truncated ? <div className="dsh-canvas-viewer-truncated">{t('canvas.viewer.truncated')}</div> : null}
        <Viewer view={shown} t={t} />
      </div>
    )
  }

  return (
    <div
      className="dsh-canvas-scrim is-viewer"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) requestClose()
      }}
    >
      <div className="dsh-canvas-dialog dsh-canvas-viewer">
        <div className="dsh-canvas-dialog-head">
          {cardId.split('/').pop() ?? cardId}
          <span className="dsh-canvas-card-meta">{view?.kind ?? ''}</span>
          <span className="dsh-canvas-spacer" />
          {status !== '' ? <span className="dsh-canvas-viewer-status">{status}</span> : null}
          {canEdit ? (
            // One control with two choices rather than a button whose label flips:
            // the label used to name the *other* face, so "现在在哪一面" had to be
            // worked out backwards. A checked radio says it outright.
            <div
              ref={modeGroup}
              className="dsh-canvas-modeswitch"
              role="radiogroup"
              aria-label={t('canvas.viewer.mode')}
              onKeyDown={(event) => {
                if (event.altKey || event.metaKey || event.ctrlKey) return
                moveMode(event.key)
                if (modeAfterKey(editing ? 'edit' : 'preview', event.key) !== null) event.preventDefault()
              }}
            >
              <button
                type="button"
                role="radio"
                aria-checked={!editing}
                tabIndex={editing ? -1 : 0}
                className="dsh-canvas-modeswitch-opt"
                onClick={() => setMode('preview')}
              >
                {t('canvas.viewer.preview')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={editing}
                tabIndex={editing ? 0 : -1}
                className="dsh-canvas-modeswitch-opt"
                onClick={() => setMode('edit')}
              >
                {t('canvas.viewer.edit')}
              </button>
            </div>
          ) : null}
          {dirty ? (
            <button
              className="dsh-canvas-chipbtn"
              data-primary="true"
              disabled={saving}
              onClick={() => void save()}
            >
              {t('canvas.viewer.save')}
            </button>
          ) : null}
          <button className="dsh-canvas-chipbtn" onClick={requestClose} aria-label={t('canvas.action.collapse')}>
            ×
          </button>
        </div>
        {confirming ? (
          <div className="dsh-canvas-viewer-confirm">
            {t('canvas.viewer.discard.title')}
            <span className="dsh-canvas-spacer" />
            <button className="dsh-canvas-chipbtn" onClick={() => setConfirming(false)}>
              {t('canvas.viewer.discard.cancel')}
            </button>
            <button className="dsh-canvas-chipbtn" onClick={onClose}>
              {t('canvas.viewer.discard.confirm')}
            </button>
          </div>
        ) : null}
        {saveError !== '' ? (
          // A refused write says *why* in words the user can act on, and keeps
          // the wire's own words underneath: the raw text names the syscall and
          // the temp path, which is the whole diagnosis for whoever fixes it —
          // but it is not what a writer wants to read at the top of their page.
          <div className="dsh-canvas-viewer-error">
            <span className="dsh-canvas-viewer-errmain">
              {blocked ? t('canvas.viewer.writeBlocked') : t('canvas.error', { message: saveError })}
            </span>
            <span className="dsh-canvas-spacer" />
            {blocked ? (
              <button className="dsh-canvas-chipbtn" onClick={retry}>
                {t('canvas.viewer.retry')}
              </button>
            ) : null}
            {blocked ? <span className="dsh-canvas-viewer-errdetail">{saveError}</span> : null}
          </div>
        ) : null}
        {body}
      </div>
    </div>
  )
}
