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
import { useEffect, useMemo, useState } from 'react'
import type { ComponentType, ReactElement } from 'react'
import type { ArtifactView } from '../types.ts'
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
  switch (kind) {
    case 'markdown':
      return 'markdown'
    case 'image':
      return 'image'
    case 'html-deck':
    case 'site':
      return 'deck'
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
 * name, its kind, and the way out; the modal has no other action.
 */
export function ArtifactModal(props: {
  projectId: string
  cardId: string
  bridge: { readArtifact(projectId: string, cardId: string): Promise<ArtifactView> }
  t: Translate
  onClose: () => void
}) {
  const { projectId, cardId, bridge, t, onClose } = props
  const [view, setView] = useState<ArtifactView | undefined>(undefined)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setView(undefined)
    setError('')
    bridge
      .readArtifact(projectId, cardId)
      .then((payload) => {
        if (!cancelled) setView(payload)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : t('canvas.error.unknown'))
      })
    return () => {
      cancelled = true
    }
  }, [bridge, cardId, projectId, t])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  let body: ReactElement
  if (error !== '') {
    body = <div className="dsh-canvas-viewer-note">{t('canvas.error', { message: error })}</div>
  } else if (view === undefined) {
    body = <div className="dsh-canvas-viewer-note">{t('canvas.viewer.loading')}</div>
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
    body = (
      <div className="dsh-canvas-viewer-body">
        {view.truncated ? <div className="dsh-canvas-viewer-truncated">{t('canvas.viewer.truncated')}</div> : null}
        <Viewer view={view} t={t} />
      </div>
    )
  }

  return (
    <div
      className="dsh-canvas-scrim is-viewer"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dsh-canvas-dialog dsh-canvas-viewer">
        <div className="dsh-canvas-dialog-head">
          {cardId.split('/').pop() ?? cardId}
          <span className="dsh-canvas-card-meta">{view?.kind ?? ''}</span>
          <span className="dsh-canvas-spacer" />
          <button className="dsh-canvas-chipbtn" onClick={onClose} aria-label={t('canvas.action.collapse')}>
            ×
          </button>
        </div>
        {body}
      </div>
    </div>
  )
}
