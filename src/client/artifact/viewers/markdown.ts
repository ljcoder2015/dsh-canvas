/**
 * dsh-canvas — 一小段 markdown 渲染成 HTML（纯，零依赖）。
 *
 * 从 `artifact-view.tsx` 搬出来单独成文件，因为它碰的是**不可信内容**：这里是
 * 全插件唯一一处把产物文本变成 DOM 的地方，把这件事从组件文件里拎出来，读的人
 * 才能一眼看全「逃逸在前、建标签在后」这条纪律，测试也能只 import 它而不连带
 * 把 React 组件树拖进 node 环境。
 *
 * 支持的子集是刻意的：围栏代码、标题、hr、引用、有序/无序列表、粗斜体、行内
 * 代码、链接、段落。子集本身由 `tests/client/artifact/artifact-view.spec.ts` 钉住。
 */

/** Escape a string into text that cannot open or close a tag. */
export function escapeHtml(text: string): string {
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
 * The exact subset is pinned by `tests/client/artifact/artifact-view.spec.ts`.
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
