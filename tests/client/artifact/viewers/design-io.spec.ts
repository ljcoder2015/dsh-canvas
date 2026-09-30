/**
 * `design-io.ts` 的接线：**交出去之前要换字体名，PDF 那条自己建文档**（v1.60 起，v1.61 补齐）。
 *
 * 这一组读源码文本、不 import：那个模块拉着 `@open-pencil/core/io` 与 CanvasKit
 * （经 `design-skia.ts`），node 里 import 即死。能钉住的只是「这一步被接上了」——
 * 「哪些格式换到哪个名字」由 `tests/core/artifact/design.spec.ts` 那组真图判、「PDF 文档
 * 里到底嵌没嵌字体」由 `.workbuddy/repro/design-export` 那份真浏览器探针判（它会解开产物
 * 看 `/Type0` / `/FontFile2`）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../../../../src/client/artifact/viewers/design-io.ts', import.meta.url),
  'utf8',
)

/**
 * 取出某个顶层函数的**函数体**文本（`async function name(` 到下一个顶格的 `}`）。
 *
 * 有几个形状在四个函数里重样（`units: [{ name: '', bytes }]` 就是），整份源码里 `toContain`
 * 等于什么都没测。收窄到那个函数自己，断言才有指向。
 */
function bodyOf(name: string): string {
  const start = source.indexOf(`async function ${name}(`)
  if (start < 0) throw new Error(`源码里没有 ${name}`)
  const end = source.indexOf('\n}\n', start)
  if (end < 0) throw new Error(`${name} 找不到收尾的顶格 }`)
  return source.slice(start, end)
}

describe('design-io 的导出接线', () => {
  it('判断与动作各一次：一张表说了算，没有第二条路也在换字体', () => {
    // 一条查表挡在四条路前面、一处调用改图——多出来的一次调用就是「有另一条路也在换」。
    expect(source.match(/exportTextRetarget\(request\.format\)/g)).toHaveLength(1)
    expect(source.match(/retargetTextFonts\(graph, retarget\)/g)).toHaveLength(1)
  })

  it('换字体挡在渲染器之前：它动的是交给对方的那份数据，与画法无关', () => {
    const retarget = source.indexOf('retargetTextFonts(graph, retarget)')
    const renderer = source.indexOf('await createExportRenderer()')
    expect(retarget).toBeGreaterThan(-1)
    expect(renderer).toBeGreaterThan(-1)
    expect(retarget).toBeLessThan(renderer)
  })

  it('PDF 那条自己建文档，并且只交回**一件**（页在文档里面，客户端不必再合并）', () => {
    expect(source.match(/renderPdfDocument\(pages, pdfTextStyles\(graph\), font\)/g)).toHaveLength(1)
    // 断言收进 `pdfDocument` 的**函数体**里：这个文件里有四个出口，整份源码上的 `toContain`
    // 挡不住「PDF 这条改成了多件、而别的函数里恰好还留着同样一行」。一件 → 名字空串；多件才
    // 会走到客户端那条打包成 zip 的路（`client/canvas/design-export.ts`）。
    const body = bodyOf('pdfDocument')
    expect(body).toContain('renderPdfDocument(')
    expect(body.match(/units: \[\{ name: '', bytes \}\]/g) ?? []).toHaveLength(1)
  })

  it('字体先取到、再画：取不到就拒导，不交一份没有字的 PDF', () => {
    const font = source.indexOf('await ensureCJKFont()')
    const render = source.indexOf('renderPdfDocument(')
    expect(source.match(/await ensureCJKFont\(\)/g)).toHaveLength(1)
    expect(font).toBeGreaterThan(-1)
    expect(render).toBeGreaterThan(-1)
    expect(font).toBeLessThan(render)
    // 拒导不是「静默少字」：这条路上取不到字面必须报出来。
    expect(source).toContain('取不到中文字面')
  })

  it('PDF 不再借客户端的手合并：这一层不认识 pdf-lib', () => {
    expect(source).not.toContain('mergePdf')
  })
})
