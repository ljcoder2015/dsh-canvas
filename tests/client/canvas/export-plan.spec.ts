/**
 * 〔导出〕那一枚按钮点下去给什么（F10.1，v1.59）。
 *
 * 这一份判据把形态**穷举**一遍：类型表里每一个内置 kind 进去，出来的是一击、一张菜单、还是
 * 什么都没有；是菜单的话，里头的每一行点下去走的是哪条通道、带的是哪个格式。
 *
 * 之所以能这么测，是因为这一整套判据被抽成了一个纯函数（`export-plan.ts`）：形态进去、
 * 处理函数注入进来，不需要 React、不需要一块画布、也不需要真的导出一份东西。此前这份判据
 * 一半在胶囊里（`isDirectTextKind` 决定出不出菜单）、一半在画布那侧（`isBundleKind` 决定
 * 走哪条路），两处各判一件事的两半——**加第三条通道的那一刻它们就会打架**：菜单里摆着
 * 「Figma 文件」，点下去走的却是部署那条线。
 */
import { describe, expect, it } from 'vitest'
import { BUILTIN_KINDS, kindById } from '../../../src/core/artifact/kind-registry.ts'
import {
  exportOfferOf,
  type ExportHandlers,
  type ExportOffer,
} from '../../../src/client/canvas/export-plan.ts'
import { DESIGN_EXPORT_FORMATS, DESIGN_EXPORT_LABEL } from '../../../src/client/canvas/design-export.ts'
import { TEXT_EXPORT_FORMATS, TEXT_EXPORT_LABEL } from '../../../src/client/canvas/text-export.ts'

/** 一张注入的处理函数表，把每一次落点记下来。 */
function handlers() {
  const calls: string[] = []
  const face: ExportHandlers = {
    bundle: () => calls.push('bundle'),
    host: (format) => calls.push(`host:${format}`),
    text: (format) => calls.push(`text:${format}`),
    design: (format) => calls.push(`design:${format}`),
  }
  return { calls, face }
}

/** 把一份 offer 走进到底（一击点一下、菜单逐行点一下），落点全部记进 `calls`。 */
function run(offer: ExportOffer, calls: string[]): void {
  if (offer.kind === 'none') return
  if (offer.kind === 'one') {
    offer.run()
    return
  }
  for (const row of offer.rows) row.run()
  expect(calls.length).toBeGreaterThan(0)
}

describe('exportOfferOf：形态 → 那枚按钮的去向', () => {
  it('应用节点给一击——本地打包，不问部署要能力', () => {
    const { calls, face } = handlers()

    const offer = exportOfferOf('app', face)

    expect(offer.kind).toBe('one')
    run(offer, calls)
    expect(calls).toEqual(['bundle'])
  })

  it('文本节点给菜单：四种文本格式，各走本地排版那条通道', () => {
    const { calls, face } = handlers()

    const offer = exportOfferOf('markdown', face)

    expect(offer).toEqual(
      expect.objectContaining({ kind: 'menu', menu: 'canvas.export.menu' }),
    )
    run(offer, calls)
    expect(calls).toEqual(TEXT_EXPORT_FORMATS.map((format) => `text:${format}`))
  })

  it('设计稿给菜单：Figma / 图片 / PDF / PPT，四行都走渲染那条通道', () => {
    const { calls, face } = handlers()

    const offer = exportOfferOf('design', face)

    expect(offer).toEqual(
      expect.objectContaining({ kind: 'menu', menu: 'canvas.export.menuDesign' }),
    )
    run(offer, calls)
    expect(calls).toEqual(DESIGN_EXPORT_FORMATS.map((format) => `design:${format}`))
  })

  it('设计稿**不**掉到部署那条线上去（它自己的 exportFormats 里那个 png 不作数）', () => {
    // 这是这一份判据存在的理由：`design` 在类型表里的 `exportFormats` 是 `['png']`——那是
    // 部署能力那条线的表，而设计稿的四样出路**部署一个都做不到**（fig 要 Figma 的 kiwi
    // schema、图片与 PPT 要 CanvasKit、PDF 要 DOM）。谁要是把设计也交给 `exportFormats[0]`，
    // 用户点下去拿到的是一份没有导出能力的部署给不出的东西——界面上什么都不发生。
    const { calls, face } = handlers()

    run(exportOfferOf('design', face), calls)

    expect(calls).not.toContain('host:png')
    expect(kindById('design')?.exportFormats).toEqual(['png'])
  })

  it('菜单里每一行都带得动它的字典键（表的另一半不许缺）', () => {
    const { face } = handlers()

    const text = exportOfferOf('markdown', face)
    const design = exportOfferOf('design', face)

    expect(text.kind === 'menu' && text.rows.map((row) => row.label)).toEqual(
      TEXT_EXPORT_FORMATS.map((format) => TEXT_EXPORT_LABEL[format]),
    )
    expect(design.kind === 'menu' && design.rows.map((row) => row.label)).toEqual(
      DESIGN_EXPORT_FORMATS.map((format) => DESIGN_EXPORT_LABEL[format]),
    )
  })

  it('行 id 就是格式名——菜单少了哪一样一眼看得出来', () => {
    const { face } = handlers()

    const design = exportOfferOf('design', face)

    expect(design.kind === 'menu' && design.rows.map((row) => row.id)).toEqual(['fig', 'png', 'pdf', 'pptx'])
  })

  it('归并前的老 id 与今天的 id 同一条路（`webapp` 也是应用）', () => {
    const { calls, face } = handlers()

    run(exportOfferOf('webapp', face), calls)

    // 老记录盖着旧章，而它落到的必须是**本地打包**那条路：掉到部署那条线上，在没有
    // `dsh-canvas.capabilities` 的部署上点一下是什么都不会发生的（v1.58 才绕开它）。
    expect(calls).toEqual(['bundle'])
  })

  it('其余形态仍走部署那条线，格式取类型表里的第一个', () => {
    const { calls, face } = handlers()

    const image = exportOfferOf('image', face)
    expect(image.kind).toBe('one')
    run(image, calls)
    expect(calls).toEqual(['host:png'])

    const { calls: more, face: second } = handlers()
    const data = exportOfferOf('data', second)
    run(data, more)
    expect(more).toEqual(['host:html'])
  })

  it('导不出东西的形态连按钮都不出——不是「点一下没反应」', () => {
    // 视频与文件夹的 `exportFormats` 都是空的。此前那枚按钮靠「kind 不是 folder」硬挡着，
    // 于是**视频卡片上有一枚点了什么都不发生的按钮**；现在按「能不能导」判。
    //
    // `file` 不在这张单子上：它是「产物就是它自己的文字」那一类（`.txt` / `.js` / 别的
    // 什么），走的正是文本那四种格式。
    for (const kind of ['video', 'folder', 'unknown-kind']) {
      expect(exportOfferOf(kind, handlers().face)).toEqual({ kind: 'none' })
    }
  })

  it('纯文本文件与 markdown 同一条路——它有文字，就有那四种排法', () => {
    const { calls, face } = handlers()

    run(exportOfferOf('file', face), calls)

    expect(calls).toEqual(TEXT_EXPORT_FORMATS.map((format) => `text:${format}`))
  })

  it('内置形态穷举一遍：没有一个会掉进「既不是一击也不是菜单」的缝里', () => {
    for (const definition of BUILTIN_KINDS) {
      const offer = exportOfferOf(definition.id, handlers().face)
      expect(['none', 'one', 'menu'], definition.id).toContain(offer.kind)
      // 有得导的形态必须真的给出一条路；`none` 只允许出现在类型表自己也说没有格式的时候。
      if (offer.kind === 'none') expect(definition.exportFormats, definition.id).toEqual([])
    }
  })
})
