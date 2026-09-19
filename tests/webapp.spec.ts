import { describe, expect, it } from 'vitest'
import { detectKind, outlineOf, type KindProbe } from '../src/core/kind-registry.ts'
import { WEBAPP_MANIFEST, inlineWebAppAssets, webAppAssetRefs, webappFiles } from '../src/core/webapp.ts'

const directoryProbe = (children: string[]): KindProbe => ({
  path: 'app',
  directory: true,
  basename: 'app',
  extension: '',
  head: '',
  children,
})

describe('webapp kind detection', () => {
  it('reads a directory with the manifest as a webapp', () => {
    expect(detectKind(directoryProbe([WEBAPP_MANIFEST, 'index.html', 'app.js', 'styles.css']))).toBe('webapp')
  })

  it('prefers the manifest over a bare site entry point', () => {
    // manifest + index.html 同时在场：webapp 赢过 site
    expect(detectKind(directoryProbe(['index.html', WEBAPP_MANIFEST]))).toBe('webapp')
  })

  it('still reads a manifest-less entry folder as a site', () => {
    expect(detectKind(directoryProbe(['index.html']))).toBe('site')
  })

  it('leaves other directories as folders', () => {
    expect(detectKind(directoryProbe(['a.css', 'b.js']))).toBe('folder')
  })

  it('outlines a webapp by its entry title', () => {
    const html = '<html><head><title>我的应用</title></head></html>'
    expect(outlineOf('webapp', html)).toEqual(['我的应用'])
  })
})

describe('webapp scaffold files', () => {
  const files = webappFiles('看板')

  it('writes the manifest first, then entry, tokens, components', () => {
    expect(files.map((file) => file.path)).toEqual([WEBAPP_MANIFEST, 'index.html', 'styles.css', 'app.js'])
  })

  it('declares the web component + shadcn pairing in the manifest', () => {
    const manifest = JSON.parse(files[0]!.content) as Record<string, unknown>
    expect(manifest).toMatchObject({ name: '看板', entry: 'index.html', framework: 'web-components', ui: 'shadcn' })
  })

  it('references only local assets from the entry page', () => {
    const html = files[1]!.content
    expect(webAppAssetRefs(html)).toEqual(['styles.css', 'app.js'])
  })

  it('components read the shadcn tokens through CSS variables', () => {
    const css = files[2]!.content
    const js = files[3]!.content
    expect(css).toContain('--primary')
    expect(css).toContain('prefers-color-scheme: dark')
    expect(js).toContain('customElements.define')
    expect(js).toContain('var(--radius)')
  })
})

describe('webAppAssetRefs', () => {
  it('collects stylesheet links and script sources in order, deduplicated', () => {
    const html = [
      '<link rel="stylesheet" href="a.css">',
      '<link rel="icon" href="favicon.ico">',
      '<script type="module" src="a.js"></script>',
      '<script type="module" src="a.css"></script>',
      '<link rel="stylesheet" href="a.css">',
    ].join('\n')
    expect(webAppAssetRefs(html)).toEqual(['a.css', 'a.js'])
  })

  it('ignores absolute, protocol and protocol-relative references', () => {
    const html = [
      '<link rel="stylesheet" href="/root.css">',
      '<link rel="stylesheet" href="https://cdn.example.com/x.css">',
      '<script src="//cdn.example.com/y.js"></script>',
      '<script src="data:text/javascript,1"></script>',
    ].join('\n')
    expect(webAppAssetRefs(html)).toEqual([])
  })
})

describe('inlineWebAppAssets', () => {
  const page = (href: string, src: string): string =>
    `<link rel="stylesheet" href="${href}"><script type="module" src="${src}"></script>`

  it('replaces resolvable local references with inline style and script', () => {
    const out = inlineWebAppAssets(page('styles.css', 'app.js'), (ref) => `/* ${ref} */`)
    expect(out).toContain('<style>\n/* styles.css */\n</style>')
    expect(out).toContain('type="module"')
    expect(out).not.toContain('src=')
  })

  it('leaves references the resolver cannot answer', () => {
    const original = page('styles.css', 'app.js')
    expect(inlineWebAppAssets(original, () => undefined)).toBe(original)
  })

  it('leaves absolute and protocol references untouched even when resolvable', () => {
    const original = page('/styles.css', 'https://cdn.example.com/app.js')
    expect(inlineWebAppAssets(original, () => 'x')).toBe(original)
  })

  it('escapes a closing script tag inside inlined script content', () => {
    const out = inlineWebAppAssets(page('a.css', 'b.js'), (ref) =>
      ref === 'b.js' ? 'const s = "</script>";' : '',
    )
    expect(out).toContain('<\\/script>')
  })

  it('returns a page without local references unchanged', () => {
    const original = '<p>没有引用</p>'
    expect(inlineWebAppAssets(original, () => 'x')).toBe(original)
  })
})
