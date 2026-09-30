/**
 * 设计文档 v2（OpenPencil scene-graph 底座）：信封、digest、结构化 op。
 *
 * v1 的 Kiwi 编解码随改道退役（方案 A，格式破坏性切换）；这一版钉的是 v2 的
 * 三条面：**信封**（header + JSON 快照 round-trip、v1 拒绝）、**digest**（容器
 * 结构摘要）、**ops**（模型改稿的每条路都走到，失败进 errors 而不是静默）。
 */
import { describe, expect, it } from 'vitest'
import { SceneGraph } from '@open-pencil/scene-graph'
import {
  DESIGN_FILE_PREFIX,
  DESIGN_FILE_VERSION,
  colorFromCss,
  colorToCss,
  containersOf,
  decodeDesignFile,
  designDigest,
  designNodeToJson,
  encodeDesignFile,
  scaffoldDesignDocument,
} from '../../../src/core/artifact/design/document.ts'
import { applyDesignOps } from '../../../src/core/artifact/design/ops.ts'
import {
  PPT_TEXT_FAMILY,
  retargetsTextFonts,
  retargetTextFonts,
} from '../../../src/core/artifact/design/ppt-font.ts'

/** The page of a freshly scaffolded (or hydrated) document. */
const firstPage = (graph: SceneGraph) => {
  const page = graph.getPages()[0]
  if (page === undefined) throw new Error('scaffold produced no page')
  return page
}

/** The container of a scaffolded document (the single FRAME under the page). */
const firstBoard = (graph: SceneGraph) => {
  const board = graph.getChildren(firstPage(graph).id).find((node) => node.type === 'FRAME')
  if (board === undefined) throw new Error('scaffold produced no container')
  return board
}

describe('design envelope v2', () => {
  it('scaffolds exactly one blank 1024×1024 container', () => {
    const graph = scaffoldDesignDocument()
    const board = firstBoard(graph)
    expect(board.name).toBe('容器 1')
    expect(board.width).toBe(1024)
    expect(board.height).toBe(1024)
    expect(graph.getChildren(firstPage(graph).id)).toHaveLength(1)
  })

  it('round-trips a document through the envelope', () => {
    const graph = scaffoldDesignDocument()
    const board = firstBoard(graph)
    graph.createNode('RECTANGLE', board.id, { name: '卡片', x: 40, y: 60, width: 320, height: 200 })
    graph.createNode('TEXT', board.id, { name: '标题', x: 40, y: 280, width: 320, height: 48, text: '设计' })

    const restored = decodeDesignFile(encodeDesignFile(graph))
    const restoredBoard = firstBoard(restored)
    expect(restoredBoard.id).toBe(board.id)
    expect(restored.getChildren(restoredBoard.id).map((node) => node.name)).toEqual(['卡片', '标题'])
    const title = restored.getChildren(restoredBoard.id)[1]
    expect(title?.text).toBe('设计')
  })

  it('writes the v2 header and refuses v1 files instead of migrating them', () => {
    const text = encodeDesignFile(scaffoldDesignDocument())
    expect(text.startsWith(`${DESIGN_FILE_PREFIX}${DESIGN_FILE_VERSION}\n`)).toBe(true)
    expect(() => decodeDesignFile(`${DESIGN_FILE_PREFIX}1\n{}`)).toThrow(/v1/)
  })

  it('refuses a newer envelope and a corrupt body', () => {
    const text = encodeDesignFile(scaffoldDesignDocument())
    expect(() => decodeDesignFile(text.replace(`${DESIGN_FILE_PREFIX}2`, `${DESIGN_FILE_PREFIX}99`))).toThrow(/版本过新/)
    expect(() => decodeDesignFile(`${DESIGN_FILE_PREFIX}2\nnot json`)).toThrow(/JSON/)
    expect(() => decodeDesignFile('not a design')).toThrow(/文件头/)
  })
})

describe('digest', () => {
  it('summarizes the page and container structure', () => {
    const graph = scaffoldDesignDocument()
    const board = firstBoard(graph)
    graph.createNode('ELLIPSE', board.id, { name: '圆' })
    const { summary } = designDigest(graph)
    expect(summary).toContain('页面 1')
    expect(summary).toContain('容器 1（1024×1024）')
    expect(summary).toContain('1 个图层')
  })
})

describe('design edit ops', () => {
  it('upserts into the container, minting ids when absent', () => {
    const graph = scaffoldDesignDocument()
    const board = firstBoard(graph)
    const result = applyDesignOps(graph, [
      { kind: 'upsert', type: 'rect', parentId: board.id, x: 10, y: 20, width: 120, height: 80, fill: '#6b4226' },
    ])
    expect(result.errors).toEqual([])
    expect(result.applied).toBe(1)
    const shape = graph.getChildren(board.id)[0]
    expect(shape?.type).toBe('RECTANGLE')
    expect(shape?.width).toBe(120)
    expect(shape?.fills[0]?.type).toBe('SOLID')
  })

  it('upsert with a known id updates instead of duplicating', () => {
    const graph = scaffoldDesignDocument()
    const board = firstBoard(graph)
    const shape = graph.createNode('RECTANGLE', board.id, { name: '卡片' })
    const result = applyDesignOps(graph, [
      { kind: 'upsert', id: shape.id, type: 'rect', parentId: board.id, width: 300 },
    ])
    expect(result.errors).toEqual([])
    expect(graph.getChildren(board.id)).toHaveLength(1)
    expect(shape.width).toBe(300)
  })

  it('setProps changes one node; unknown ids and bad colors are per-op errors', () => {
    const graph = scaffoldDesignDocument()
    const board = firstBoard(graph)
    const shape = graph.createNode('ELLIPSE', board.id, { name: '圆' })
    const result = applyDesignOps(graph, [
      { kind: 'setProps', id: shape.id, cornerRadius: 8, opacity: 0.5, fill: '#ff8800', text: '' },
      { kind: 'setProps', id: 'missing', width: 5 },
      { kind: 'setProps', id: shape.id, fill: 'nope' },
    ])
    expect(result.applied).toBe(1)
    expect(result.errors).toHaveLength(2)
    expect(shape.cornerRadius).toBe(8)
    expect(shape.opacity).toBe(0.5)
    expect(colorToCss(shape.fills[0]?.color ?? { r: 0, g: 0, b: 0, a: 0 })).toBe('#ff8800')
  })

  it('move relocates and refuses to move a node into its own descendant', () => {
    const graph = scaffoldDesignDocument()
    const board = firstBoard(graph)
    const group = graph.createNode('GROUP', board.id, { name: '组' })
    const shape = graph.createNode('ELLIPSE', board.id, { name: '圆' })
    const result = applyDesignOps(graph, [
      { kind: 'move', id: shape.id, parentId: group.id },
      { kind: 'move', id: board.id, parentId: shape.id },
    ])
    expect(result.errors).toHaveLength(1)
    expect(shape.parentId).toBe(group.id)
    expect(graph.getChildren(group.id).map((node) => node.id)).toContain(shape.id)
  })

  it('delete cascades to descendants', () => {
    const graph = scaffoldDesignDocument()
    const board = firstBoard(graph)
    const shape = graph.createNode('RECTANGLE', board.id, { name: '卡片' })
    const label = graph.createNode('TEXT', shape.id, { name: '标签' })
    const result = applyDesignOps(graph, [{ kind: 'delete', id: shape.id }])
    expect(result.errors).toEqual([])
    expect(graph.nodes.get(shape.id)).toBeUndefined()
    expect(graph.nodes.get(label.id)).toBeUndefined()
  })

  it('reorder lands on top by default and honours an explicit index', () => {
    const graph = scaffoldDesignDocument()
    const board = firstBoard(graph)
    const a = graph.createNode('RECTANGLE', board.id, { name: 'a' })
    const b = graph.createNode('RECTANGLE', board.id, { name: 'b' })
    const result = applyDesignOps(graph, [
      { kind: 'reorder', id: a.id },
      { kind: 'reorder', id: a.id, index: 0 },
    ])
    expect(result.errors).toEqual([])
    expect(graph.getChildren(board.id).map((node) => node.id)).toEqual([a.id, b.id])
  })

  it('enforces the Figma hierarchy: a region never goes inside a container', () => {
    const graph = scaffoldDesignDocument()
    const board = firstBoard(graph)
    const result = applyDesignOps(graph, [
      // 区域归页面管，塞进容器要被拒。
      { kind: 'upsert', type: 'section', parentId: board.id, name: '区域' },
      // 容器嵌容器是模块，合法。
      { kind: 'upsert', type: 'frame', parentId: board.id, name: '模块' },
    ])
    expect(result.applied).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('section 不能放进 frame')
    expect(graph.getChildren(board.id).map((node) => node.type)).toEqual(['FRAME'])
  })
})

describe('container walks', () => {
  it('collects containers through regions and stops at nested containers', () => {
    const graph = scaffoldDesignDocument()
    const region = graph.createNode('SECTION', firstPage(graph).id, { name: '区域' })
    const board = graph.createNode('FRAME', region.id, { name: '区域里的容器' })
    // 嵌套容器是模块，不算独立的一块。
    graph.createNode('FRAME', board.id, { name: '模块' })
    expect(containersOf(graph).map((node) => node.name)).toEqual(['容器 1', '区域里的容器'])
  })
})

describe('wire json', () => {
  it('projects scene-graph nodes into lowercase css json', () => {
    const graph = scaffoldDesignDocument()
    const board = firstBoard(graph)
    graph.createNode('TEXT', board.id, { name: '标题', text: '设计', fontSize: 24 })
    const json = [...graph.nodes.values()].filter((node) => node.id !== graph.rootId).map(designNodeToJson)
    const boardJson = json.find((node) => node.id === board.id)
    expect(boardJson?.type).toBe('frame')
    expect(boardJson?.parentId).toBe(firstPage(graph).id)
    const text = json.find((node) => node.type === 'text')
    expect(text?.text).toBe('设计')
    expect(text?.fontSize).toBe(24)
  })
})

describe('colors', () => {
  it('converts css both ways, folding opaque alpha away', () => {
    expect(colorToCss({ r: 107 / 255, g: 66 / 255, b: 38 / 255, a: 1 })).toBe('#6b4226')
    expect(colorToCss({ r: 107 / 255, g: 66 / 255, b: 38 / 255, a: 0.5 })).toBe('#6b422680')
    expect(colorFromCss('#6B4226')?.r).toBeCloseTo(107 / 255)
    expect(colorFromCss('#6b422680')?.a).toBeCloseTo(0.5)
    expect(colorFromCss('#abc')?.r).toBeCloseTo(170 / 255)
    expect(colorFromCss('nope')).toBeUndefined()
  })
})

/**
 * 交出去的 PPT 里的字体名（v1.60）。
 *
 * 这一组钉的是一次真机事故：设计稿里的字体名是**我们自己这边的东西**（拉丁字面 `Inter`、
 * 汉字靠 vendored 的 `Noto Sans SC` 回落），而幻灯片里的原生文本是**对方的 PowerPoint**
 * 排的——那个 `typeface` 会在对方机器上解析，写 `Inter` 的结果是找不到字体、汉字又没有
 * 字形，中文整段丢。
 */
describe('ppt fonts', () => {
  it('只有幻灯片那条路要换：图片 / PDF / fig 的字体名是拿去给渲染器找字面的，动不得', () => {
    expect(retargetsTextFonts('pptx')).toBe(true)
    for (const other of ['fig', 'png', 'pdf']) expect(retargetsTextFonts(other)).toBe(false)
  })

  it('把设计稿那套内部字体名换成对方机器上有的那个', () => {
    const graph = scaffoldDesignDocument()
    const title = graph.createNode('TEXT', firstBoard(graph).id, { name: '标题', text: '主视觉：你好' })
    // 先钉住「设计稿里确实是 Inter」——不然这条判据可能什么都没测到。
    expect(title.fontFamily).toBe('Inter')

    retargetTextFonts(graph)

    expect(title.fontFamily).toBe(PPT_TEXT_FAMILY)
    expect(PPT_TEXT_FAMILY).toBe('Microsoft YaHei')
  })

  it('逐段字体一起换：run 上的名字会盖过节点那一个', () => {
    const graph = scaffoldDesignDocument()
    const title = graph.createNode('TEXT', firstBoard(graph).id, {
      name: '标题',
      text: '普通粗体',
      fontFamily: 'Noto Sans SC',
      styleRuns: [{ start: 2, length: 2, style: { fontFamily: 'Noto Sans SC' } }],
    })

    retargetTextFonts(graph)

    expect(title.fontFamily).toBe(PPT_TEXT_FAMILY)
    expect(title.styleRuns[0]?.style.fontFamily).toBe(PPT_TEXT_FAMILY)
  })

  it('只换文字：容器与形状碰都不碰（字体字段在那儿不代表画得出字）', () => {
    const graph = scaffoldDesignDocument()
    const board = firstBoard(graph)
    const rect = graph.createNode('RECTANGLE', board.id, { name: '色块' })
    graph.createNode('TEXT', board.id, { name: '标题', text: '设计' })

    retargetTextFonts(graph)

    expect(board.fontFamily).toBe('Inter')
    expect(rect.fontFamily).toBe('Inter')
  })

  it('区域里嵌了层容器也换得到（走的是整棵页面树，不是只扫顶层）', () => {
    const graph = scaffoldDesignDocument()
    const region = graph.createNode('SECTION', firstPage(graph).id, { name: '区域' })
    const inner = graph.createNode('FRAME', region.id, { name: '区域里的容器' })
    const deep = graph.createNode('TEXT', inner.id, { name: '标题', text: '深一层' })

    retargetTextFonts(graph)

    expect(deep.fontFamily).toBe(PPT_TEXT_FAMILY)
  })
})
