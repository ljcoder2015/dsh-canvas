/**
 * `design-io.ts` 的接线：**PPT 那条路交出去之前要换字体名**（v1.60）。
 *
 * 这一组读源码文本、不 import：那个模块拉着 `@open-pencil/core/io` 与 CanvasKit
 * （经 `design-skia.ts`），node 里 import 即死。能钉住的只是「这一步被接上了」——
 * 「哪些格式要换」由 `tests/core/artifact/design.spec.ts` 那组真图判，「换出来的产物对不对」
 * 由 `.workbuddy/repro/design-export` 那份真浏览器探针判（它会解开 pptx 看 typeface）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../../../../src/client/artifact/viewers/design-io.ts', import.meta.url),
  'utf8',
)

describe('design-io 的导出接线', () => {
  it('判断与动作各一次：只有幻灯片那条路会走进去', () => {
    // 一条 if 挡在四条路前面，动作只此一处——多出来的一次调用就是「有第二条路也在换字体」。
    expect(source.match(/retargetsTextFonts\(request\.format\)/g)).toHaveLength(1)
    expect(source.match(/retargetTextFonts\(graph\)/g)).toHaveLength(1)
  })

  it('换字体挡在渲染器之前：它动的是交给对方的那份数据，与画法无关', () => {
    const retarget = source.indexOf('retargetTextFonts(graph)')
    const renderer = source.indexOf('await createExportRenderer()')
    expect(retarget).toBeGreaterThan(-1)
    expect(renderer).toBeGreaterThan(-1)
    expect(retarget).toBeLessThan(renderer)
  })
})
