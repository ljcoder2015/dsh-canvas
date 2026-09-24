/**
 * dsh-canvas — kind registry (F2.1–F2.4).
 *
 * A kind is decided from *file evidence*, never declared by the user: the
 * extension and a bounded sniff of the content. This module is pure — it takes
 * a probe result, not a context — so both the host's artifact reader and the
 * naming tests can call it without a Cordis container.
 */
import type { ExportFormat, KindDefinition } from '../../types.ts'
import { WEBAPP_MANIFEST } from './webapp.ts'

/** Text and byte evidence gathered from the target before classification. */
export interface KindProbe {
  /** Path relative to the project root, e.g. `decks/intro.html`. */
  path: string
  /** Whether the path resolved to a directory. */
  directory: boolean
  /** Lower-cased basename, e.g. `index.html`. */
  basename: string
  /** Lower-cased extension without the dot; empty when there is none. */
  extension: string
  /** First few KB of text, when the target is a UTF-8 file within budget. */
  head: string
  /** Direct child names, when the target is a directory. */
  children: readonly string[]
}

/** Characters of `head` a detector may look at. Keeps sniffing bounded. */
export const PROBE_HEAD_LIMIT = 4096

/**
 * The built-in kinds (F2.3).
 *
 * Adding a kind is adding an entry here plus its client tab pattern — no
 * scattered branches (F2.4, §4.7).
 */
export const BUILTIN_KINDS: readonly KindDefinition[] = [
  {
    // 应用（v1.56 归并）：html-deck / site / webapp 三类产物本是同一种东西——一份
    // 跑在沙箱 iframe 里的 HTML 入口页，落在单个文件或一个带入口的目录上。类型表只留
    // 一个 id，预览、内联、命名、导出走同一套判据；目录形态的判据在 detectKind。
    id: 'app',
    label: '应用',
    addressPatterns: ['dsh-resource://file/**/*.html', 'dsh-resource://file/**/index.html'],
    directory: false,
    exportFormats: ['zip', 'html', 'pdf', 'png'],
    publishable: true,
  },
  {
    id: 'markdown',
    label: '文本',
    addressPatterns: ['dsh-resource://file/**/*.md'],
    directory: false,
    exportFormats: ['html', 'pdf'],
    publishable: false,
  },
  {
    id: 'image',
    label: '图片',
    addressPatterns: ['dsh-resource://file/**/*.png', 'dsh-resource://file/**/*.jpg', 'dsh-resource://file/**/*.svg'],
    directory: false,
    exportFormats: ['png', 'svg'],
    publishable: false,
  },
  {
    // 设计节点（F2.6）：一个 `.design` 文件就是一份场景图快照（v2）的多画板设计文档。
    id: 'design',
    label: '设计',
    addressPatterns: ['dsh-resource://file/**/*.design'],
    directory: false,
    exportFormats: ['png'],
    publishable: false,
  },
  {
    id: 'video',
    label: '视频',
    addressPatterns: ['dsh-resource://file/**/*.mp4'],
    directory: false,
    exportFormats: [],
    publishable: false,
  },
  {
    id: 'data',
    label: '数据图表',
    addressPatterns: ['dsh-resource://file/**/*.csv', 'dsh-resource://file/**/*.json'],
    directory: false,
    exportFormats: ['html', 'png'],
    publishable: false,
  },
  {
    id: 'folder',
    label: '文件夹',
    addressPatterns: [],
    directory: true,
    exportFormats: [],
    publishable: false,
  },
  {
    id: 'file',
    label: '文件',
    addressPatterns: ['dsh-resource://file/**'],
    directory: false,
    exportFormats: [],
    publishable: false,
  },
]

/**
 * 归并前的 kind id → 归并后的 id（v1.56）。
 *
 * 老板上的记录还盖着旧章（`webapp` / `site` / `html-deck`），零迁移的代价是读侧
 * 顺手对齐：查表时先折算，标签、导出格式这些按 kind 查的东西对老卡照常成立。
 */
const LEGACY_KIND_IDS: Readonly<Record<string, string>> = { 'html-deck': 'app', site: 'app', webapp: 'app' }

/** Look up a kind definition by id; pre-merge ids resolve onto their merged kind. */
export function kindById(id: string, definitions: readonly KindDefinition[] = BUILTIN_KINDS): KindDefinition | undefined {
  return definitions.find((entry) => entry.id === (LEGACY_KIND_IDS[id] ?? id))
}

/** Human label for a kind id, falling back to the id itself. */
export function kindLabel(id: string, definitions: readonly KindDefinition[] = BUILTIN_KINDS): string {
  return kindById(id, definitions)?.label ?? id
}

/** Whether a kind can export to a format (F10.1). */
export function kindSupportsExport(
  id: string,
  format: ExportFormat,
  definitions: readonly KindDefinition[] = BUILTIN_KINDS,
): boolean {
  return kindById(id, definitions)?.exportFormats.includes(format) ?? false
}

/**
 * The kinds whose artifact is a whole HTML page (F3.8).
 *
 * There is exactly one such kind (`app`), but the set stays a set on purpose:
 * the host's inlining gate and the client's kind→viewer table both read it, and
 * they were two hand-written lists once — the one that forgot a kind is exactly
 * how an HTML artifact lost its stylesheet.
 *
 * A `srcdoc` document has no base URL, so a locally referenced `styles.css` or
 * `app.js` resolves against nothing and the page renders unstyled and dead.
 * The host inlines those references for every kind in this set.
 */
export const HTML_KINDS: readonly string[] = ['app']

/** Whether a kind's artifact is a whole HTML page (see {@link HTML_KINDS}). */
export function isHtmlKind(kind: string): boolean {
  return HTML_KINDS.includes(kind)
}

/**
 * The kinds whose artifact **is its own text** (F3.12).
 *
 * A markdown file and a plain file are the two whose bytes are the whole of
 * what a preview shows, so writing the whole thing back is lossless. Every
 * other kind is looking at something *derived* from the file — a table parsed
 * out of a CSV, a page rendered from markup, pixels decoded from a PNG — and an
 * editor that wrote its own view back would replace the file with a different
 * file.
 *
 * It lives here, beside the kind table, because **two layers ask it and they
 * must not disagree**: the card's control strip, which decides whether to offer
 * 手动输入 *before* the modal is open (it has a kind, not a payload), and the
 * text viewers, which decide from the payload whether to offer an editor. The
 * frame is the same one {@link HTML_KINDS} sits in — a fact about kinds, read
 * by both halves, written once.
 *
 * @remarks `file` is the catch-all kind, so an extension nothing else claims
 * (`.txt`, `.js`, `.css`, and any kind a user's own definitions add later) is
 * directly editable. `folder` is not: a directory's payload is not text.
 */
export const DIRECT_TEXT_KINDS: readonly string[] = ['markdown', 'file']

/** Whether a kind's artifact is its own text (see {@link DIRECT_TEXT_KINDS}). */
export function isDirectTextKind(kind: string): boolean {
  return DIRECT_TEXT_KINDS.includes(kind)
}

/**
 * True for a directory that behaves as an app: it carries an entry page or the
 * scaffold manifest. The manifest alone separates a scaffolded folder from a
 * hand-made one, but both preview and name identically, so one verdict serves.
 */
function isAppDirectory(probe: KindProbe): boolean {
  return (
    probe.children.some((name) => name.toLowerCase() === 'index.html') || probe.children.includes(WEBAPP_MANIFEST)
  )
}

/**
 * Resolve the kind of one artifact from its evidence (F2.2).
 *
 * Any HTML page — a deck, a site's entry, an app's entry, a plain page — is
 * `app`; only a directory without either entry point or manifest falls through
 * to `folder`. The last entry in {@link BUILTIN_KINDS} is the catch-all, so
 * this never returns `undefined` for a path that exists.
 */
export function detectKind(probe: KindProbe, definitions: readonly KindDefinition[] = BUILTIN_KINDS): string {
  if (probe.directory) return isAppDirectory(probe) ? 'app' : 'folder'

  const { extension } = probe

  if (extension === 'html' || extension === 'htm') return 'app'
  if (extension === 'md' || extension === 'mdx') return 'markdown'
  if (extension === 'design') return 'design'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'].includes(extension)) return 'image'
  if (['mp4', 'mov', 'webm', 'm4v'].includes(extension)) return 'video'
  if (['csv', 'tsv', 'json', 'xlsx'].includes(extension)) return 'data'

  // A definition outside the built-ins may claim exotic extensions.
  const byExtension = definitions.find((entry) =>
    entry.addressPatterns.some((pattern) => pattern.endsWith(`*.${extension}`)),
  )
  return byExtension?.id ?? 'file'
}

/**
 * Extract a structural outline from artifact text (F5.2).
 *
 * The outline is what makes a digest useful to the model — it names the parts
 * without pasting the whole artifact. Each kind has its own cheap structural
 * signal; an unknown kind yields nothing rather than guessing.
 */
export function outlineOf(kind: string, text: string, limit = 24): string[] {
  const take = (pattern: RegExp): string[] => {
    const found: string[] = []
    for (const match of text.matchAll(pattern)) {
      const captured = match[1]?.trim()
      if (captured !== undefined && captured !== '' && !found.includes(captured)) found.push(captured)
      if (found.length >= limit) break
    }
    return found
  }
  switch (kind) {
    case 'markdown':
      return take(/^\s{0,3}#{1,3}\s+(.+)$/gm)
    case 'app': {
      // 标题在前（页面叫什么），标题级标签在后（页面有什么章节）——幻灯片、站点、
      // 应用共用这一套，去重由 add 统一负责。
      const found: string[] = []
      const add = (raw: string): void => {
        const line = raw.replace(/<[^>]+>/g, '').trim()
        if (line !== '' && !found.includes(line)) found.push(line)
      }
      for (const match of text.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)) add(match[1] ?? '')
      for (const match of text.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)) add(match[1] ?? '')
      return found.slice(0, limit)
    }
    case 'data': {
      const [header = ''] = text.split(/\r?\n/)
      return header
        .split(',')
        .map((cell) => cell.trim())
        .filter((cell) => cell !== '')
        .slice(0, limit)
    }
    default:
      return []
  }
}

/**
 * Build the bounded digest injected into a card session (F5.2).
 *
 * Structure first, then a trimmed body: the budget is honoured on characters
 * because the digest is a prompt fragment, and the caller owns the budget
 * (`Config.summaryBudget`).
 */
export function digestOf(kind: string, text: string, budget: number): string {
  const outline = outlineOf(kind, text)
  const head = text.trim().slice(0, budget)
  const parts: string[] = []
  if (outline.length > 0) parts.push(`结构：${outline.join(' / ')}`)
  parts.push(head.length < text.trim().length ? `${head}\n…（已截断）` : head)
  return parts.join('\n')
}
