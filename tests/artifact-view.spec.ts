/**
 * The fullscreen artifact view (F3.8): the pure decisions the viewers and the
 * host payload reader are made of. The React components themselves are view;
 * what can drift silently and break a board is the kind → viewer mapping, the
 * markdown escaping and the delimited parsing, and those are pinned here.
 */
import { describe, expect, it } from 'vitest'
import { VIEW_TEXT_CAP, mediaMimeOf } from '../src/core/artifact-io.ts'
import { artifactViewSchema } from '../src/contract.ts'
import { parseDelimited, renderMarkdown, viewerIdFor } from '../src/client/artifact-view.tsx'

describe('kind → viewer mapping', () => {
  it('sends each content kind to its own viewer', () => {
    expect(viewerIdFor('markdown')).toBe('markdown')
    expect(viewerIdFor('image')).toBe('image')
    expect(viewerIdFor('html-deck')).toBe('deck')
    expect(viewerIdFor('site')).toBe('deck')
    expect(viewerIdFor('data')).toBe('data')
    expect(viewerIdFor('video')).toBe('video')
  })

  it('is total: an unknown kind still gets a viewer, not a blank modal', () => {
    expect(viewerIdFor('file')).toBe('text')
    expect(viewerIdFor('folder')).toBe('text')
    expect(viewerIdFor('something-new')).toBe('text')
  })
})

describe('binary media typing', () => {
  it('names a MIME type for every extension the image and video kinds cover', () => {
    expect(mediaMimeOf('png')).toBe('image/png')
    expect(mediaMimeOf('jpg')).toBe('image/jpeg')
    expect(mediaMimeOf('jpeg')).toBe('image/jpeg')
    expect(mediaMimeOf('svg')).toBe('image/svg+xml')
    expect(mediaMimeOf('mp4')).toBe('video/mp4')
    expect(mediaMimeOf('mov')).toBe('video/quicktime')
    expect(mediaMimeOf('webm')).toBe('video/webm')
  })

  it('refuses non-media extensions, so text kinds stay on the text path', () => {
    expect(mediaMimeOf('md')).toBeUndefined()
    expect(mediaMimeOf('csv')).toBeUndefined()
    expect(mediaMimeOf('html')).toBeUndefined()
    expect(mediaMimeOf('')).toBeUndefined()
  })
})

describe('markdown rendering', () => {
  it('escapes artifact markup before building any tag of its own', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img')
  })

  it('cannot be tricked into forging a fenced-code placeholder', () => {
    const html = renderMarkdown('before\n\u00000\u0000\nafter')
    // The artifact's own placeholder characters are escaped by `inline`, so no
    // stash slot is resolved from content.
    expect(html).toContain('\u00000\u0000')
  })

  it('renders the structural subset the viewer promises', () => {
    const html = renderMarkdown(
      ['# 标题', '', '正文 **加粗** *斜体* `代码`', '', '- 一', '- 二', '', '> 引用', '', '---'].join('\n'),
    )
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<strong>加粗</strong>')
    expect(html).toContain('<em>斜体</em>')
    expect(html).toContain('<code class="dsh-md-inline">代码</code>')
    expect(html.replace(/\n/g, '')).toContain('<ul class="dsh-md-list"><li>一</li><li>二</li></ul>')
    expect(html).toContain('<blockquote class="dsh-md-quote">引用</blockquote>')
    expect(html).toContain('<hr class="dsh-md-hr">')
  })

  it('keeps fenced code verbatim, unstyled by the inline rules', () => {
    const html = renderMarkdown('```js\nconst a = "<b>";\n```\n')
    expect(html).toContain('<pre class="dsh-md-code"><code>const a = &quot;&lt;b&gt;&quot;;</code></pre>')
    expect(html).not.toContain('<b>')
  })

  it('orders lists after fences correctly and closes them at the end', () => {
    const html = renderMarkdown('1. first\n2. second')
    expect(html.replace(/\n/g, '')).toContain('<ol class="dsh-md-list"><li>first</li><li>second</li></ol>')
  })
})

describe('delimited parsing', () => {
  it('splits plain rows on the delimiter', () => {
    expect(parseDelimited('a,b,c\n1,2,3', ',')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('keeps commas and escaped quotes inside quoted cells', () => {
    expect(parseDelimited('"a, b","say ""hi""",c', ',')).toEqual([['a, b', 'say "hi"', 'c']])
  })

  it('handles CRLF and a trailing newline without ghost rows', () => {
    expect(parseDelimited('a,b\r\n1,2\r\n', ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('serves tab-delimited bodies too', () => {
    expect(parseDelimited('a\tb', '\t')).toEqual([['a', 'b']])
  })
})

describe('wire payload validation', () => {
  it('accepts a text view and a data-URL view', () => {
    const base = { cardId: 'a.md', kind: 'markdown', present: true, truncated: false, bytes: 3, updatedAt: 1 }
    expect(artifactViewSchema.parse({ ...base, text: 'abc', dataUrl: '' }).present).toBe(true)
    expect(artifactViewSchema.parse({ ...base, cardId: 'a.png', kind: 'image', text: '', dataUrl: 'data:image/png;base64,AAAA' }).kind).toBe('image')
  })

  it('accepts the absent state a seated-but-unwritten card answers with', () => {
    const view = artifactViewSchema.parse({
      cardId: 'a.md',
      kind: 'markdown',
      present: false,
      text: '',
      dataUrl: '',
      truncated: false,
      bytes: 0,
      updatedAt: 1,
    })
    expect(view.present).toBe(false)
  })

  it('keeps the text cap and the schema cap in agreement', () => {
    // `.readonly()` wraps the object, so the cap is reached through the inner shape.
    const shape = (artifactViewSchema as unknown as { _def: { typeName: string; innerType: { shape: { text: { maxLength?: number | null } } } } })._def
      .innerType
    expect(VIEW_TEXT_CAP).toBeLessThanOrEqual(shape?.shape.text.maxLength ?? Infinity)
  })
})
