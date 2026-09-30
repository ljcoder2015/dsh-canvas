/**
 * fig 那条路「交出去之前改写文本」的判据（F10.1，v1.65）。
 *
 * 这一组**不读源码文本**：`fig-text.ts` 是纯的（只吃一个 `SceneNode` + 一份逐行量），所以判据
 * 拿**真节点**跑、逐行量手写。逐行量为什么能手写：它来自 CanvasKit 的 `LineMetrics`（字符区间、
 * 行左边缘、行宽、基线），而这四样正是画布上那一眼——它的**来源**（`buildParagraph` 那一侧）
 * 由导出探针在真浏览器里对账（`.workbuddy/repro/design-export`），这里只需要「拿这一份量算出来
 * 的坐标对不对」。
 *
 * 两条症状各钉一组：①**多行**被烘成一行（写器 `baselines` 只写一条）；②**对齐偏移**烘不进去
 * （写器坐标恒从节点原点起算）——真机第二轮报的「圆角矩里的居中文字导出后变居左」是第②条，
 * 所以「单行」在这里是一个**要改写**的形状，不是「不用管」的形状。这两条的判据都必须能让
 * 反向的改动变红（把 `worthRewriting` 拆掉，`单行居中` 那条立刻失败）。
 */
import { describe, expect, it } from 'vitest'
import { SceneGraph, type SceneNode, type TextAlignVertical } from '@open-pencil/scene-graph'
import { decodeDesignFile, encodeDesignFile } from '../../../../src/core/artifact/design/document.ts'
import {
  figLineHeight,
  figLineNodes,
  figTextStyles,
  figVerticalOffset,
  sliceStyleRuns,
  type FigTextLine,
} from '../../../../src/core/artifact/design/fig-text.ts'

/** 建一个真文本节点并取回来（与画布上那一份同一个类，真字段真默认值）。 */
function text(overrides: Partial<SceneNode> = {}): SceneNode {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  if (page === undefined) throw new Error('场景图里没有页面')
  return graph.createNode('TEXT', page.id, overrides)
}

/** 一行的量：判据里只写这一条关心的那几个数，其余给「画布会给出的」合理默认。 */
function line(start: number, end: number, rest: Partial<FigTextLine> = {}): FigTextLine {
  return { start, end, left: 0, width: 100, baseline: 30, ...rest }
}

/** 一格垂直对齐的文本框（`figVerticalOffset` 只认这两个字段）。 */
const box = (textAlignVertical: TextAlignVertical, height = 100) => ({ height, textAlignVertical })

describe('figLineHeight：与写器同一个公式', () => {
  it('有 lineHeight 就用它，没有才是字号的 1.2 倍上取整', () => {
    expect(figLineHeight({ fontSize: 24, lineHeight: 36 })).toBe(36)
    expect(figLineHeight({ fontSize: 24, lineHeight: null })).toBe(29)
  })
})

describe('figVerticalOffset：复刻画布那条（只有居中/靠底才非零）', () => {
  it('三档各给各的余量', () => {
    expect(figVerticalOffset(box('TOP'), 40)).toBe(0)
    expect(figVerticalOffset(box('CENTER'), 40)).toBe(30)
    expect(figVerticalOffset(box('BOTTOM'), 40)).toBe(60)
  })

  it('内容比框还高时不倒扣（余量按 0 算，文字不许被顶到框外）', () => {
    expect(figVerticalOffset(box('CENTER'), 120)).toBe(0)
    expect(figVerticalOffset(box('BOTTOM'), 120)).toBe(0)
  })
})

describe('改写的那条判据：写器这么烘，会不会跟画布不一样', () => {
  it('单行居中：**一行也要改写**——把「框中间」那段偏移变成坐标（真机报的「居左」就是它）', () => {
    const node = text({
      text: '确定',
      x: 10,
      y: 20,
      width: 320,
      height: 88,
      fontSize: 28,
      lineHeight: 40,
      textAlignHorizontal: 'CENTER',
      textAlignVertical: 'CENTER',
    })
    // 画布上这一行：左边缘 132（(320−56)/2）、宽 56、基线 32.21（一个 40 的行框里居中）。
    const plans = figLineNodes(node, [line(0, 2, { left: 132, width: 56, baseline: 32.21 })], 40)
    expect(plans).not.toBeNull()
    expect(plans?.map((plan) => plan.text)).toEqual(['确定'])
    const plan = plans?.[0]
    // 落点 = 画布上那一行的左边缘 / 基线（写器把字形从**节点原点**烘起，所以只能靠摆节点来补）。
    expect(plan?.x).toBeCloseTo(142) // 10 + 132
    expect(plan?.y).toBeCloseTo(20 + 24 + 32.21 - 40) // 框内基线高 40，让出 40 − 32.21
    // 框贴住这一行：对方哪怕完全不看对齐字段，字也落在这一个位置上。
    expect(plan?.width).toBeCloseTo(56)
    expect(plan?.height).toBe(40)
  })

  it('单行垂直居中也要改写：写器把基线烘在框顶下方一个行高处，等于把垂直对齐当 TOP', () => {
    const node = text({
      text: '标',
      x: 0,
      y: 0,
      width: 40,
      height: 88,
      fontSize: 24,
      lineHeight: 36,
      textAlignVertical: 'CENTER',
    })
    const plans = figLineNodes(node, [line(0, 1, { width: 24, baseline: 28 })], 36)
    expect(plans).toHaveLength(1)
    expect(plans?.[0]?.y).toBeCloseTo((88 - 36) / 2 + 28 - 36)
  })

  it('单行、贴着左上：一个字段都不碰——写器唯一烘得对的那种形状（也是改写自己的不动点）', () => {
    const node = text({ text: '短', x: 0, y: 0, width: 60, height: 30, fontSize: 20, lineHeight: 24 })
    expect(figLineNodes(node, [line(0, 1, { width: 20, baseline: 19 })], 24)).toBeNull()
  })

  it('多行：一行一个节点，x/y 是按画布上那一行摆，硬换行符不进字符', () => {
    const source = '第一行\n第二行'
    const node = text({ text: source, x: 5, y: 7, width: 300, height: 100, fontSize: 24, lineHeight: 36 })
    const plans = figLineNodes(
      node,
      [line(0, 4, { width: 72, baseline: 28.46 }), line(4, 7, { width: 72, baseline: 64.46 })],
      72,
    )
    expect(plans?.map((plan) => plan.text)).toEqual(['第一行', '第二行'])
    expect(plans?.[0]?.x).toBeCloseTo(5)
    expect(plans?.[0]?.y).toBeCloseTo(7 + 28.46 - 36)
    expect(plans?.[1]?.width).toBeCloseTo(72)
    // 两行之间正好差一个行高——差得多就是「垂直间距多了一倍」那类毛病。
    expect((plans?.[1]?.y ?? 0) - (plans?.[0]?.y ?? 0)).toBeCloseTo(36)
  })

  it('空行（`\\n\\n` 中间那一段）不产节点：它画不出东西，留个空文本框只是噪音', () => {
    const node = text({
      text: '第一行\n\n第三行',
      width: 300,
      height: 120,
      fontSize: 24,
      lineHeight: 36,
    })
    const plans = figLineNodes(node, [line(0, 4), line(4, 5), line(5, 8)], 108)
    expect(plans?.map((plan) => plan.text)).toEqual(['第一行', '第三行'])
  })
})

describe('对不上就不动：这几份数据一律留给上游照旧烘', () => {
  const base = { text: '第一行\n第二行', x: 0, y: 0, width: 300, height: 100, fontSize: 24, lineHeight: 36 }
  const lines = [line(0, 4), line(4, 7)]

  it('旋转 / 翻转：拆成 N 个节点之后旋转轴心变了，摆出来的位置不再等价', () => {
    expect(figLineNodes(text({ ...base, rotation: 30 }), lines, 72)).toBeNull()
    expect(figLineNodes(text({ ...base, flipX: true }), lines, 72)).toBeNull()
    expect(figLineNodes(text({ ...base, flipY: true }), lines, 72)).toBeNull()
  })

  it('做过大小写转换：`LineMetrics` 的下标是转换后那条缓冲的，切出来会串行', () => {
    expect(figLineNodes(text({ ...base, textCase: 'UPPER' }), lines, 72)).toBeNull()
  })

  it('文字在路径上：它有自己的排法，不归这里管', () => {
    const node = text({ ...base })
    node.textPathData = {
      network: { vertices: [], segments: [], regions: [] },
      normalizedSize: { x: 0, y: 0 },
      tValue: 0,
      forward: true,
    }
    expect(figLineNodes(node, lines, 72)).toBeNull()
  })

  it('节点自带烘焙（从真 Figma 读进来的）：那份本来就是对的，别动', () => {
    const node = text({ ...base })
    node.derivedTextGlyphs = [
      { commandsBlob: new Uint8Array(), x: 0, y: 0, fontSize: 24 },
      { commandsBlob: new Uint8Array(), x: 24, y: 0, fontSize: 24 },
    ]
    expect(figLineNodes(node, lines, 72)).toBeNull()
  })

  it('空文本 / 不是文本节点', () => {
    expect(figLineNodes(text({ ...base, text: '' }), lines, 72)).toBeNull()
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (page === undefined) throw new Error('场景图里没有页面')
    const frame = graph.createNode('FRAME', page.id, {})
    expect(figLineNodes(frame, lines, 72)).toBeNull()
  })

  it('行区间与原文对不上：越界、倒挂、非整数下标都是「切出来会串行」', () => {
    const node = text({ ...base })
    expect(figLineNodes(node, [line(0, 4), line(4, 99)], 72)).toBeNull()
    expect(figLineNodes(node, [line(4, 7), line(0, 4)], 72)).toBeNull()
    expect(figLineNodes(node, [line(0, 2.5), line(4, 7)], 72)).toBeNull()
  })
})

describe('样式段：切到本行、下标重排成本行相对位置', () => {
  const bold = { fontWeight: 700 }

  it('整段落在行内 ⇒ 下标减掉行的起点', () => {
    expect(sliceStyleRuns([{ start: 3, length: 2, style: bold }], 3, 5)).toEqual([
      { start: 0, length: 2, style: bold },
    ])
  })

  it('跨行界的段在两端各切一刀', () => {
    const runs = [{ start: 0, length: 4, style: bold }]
    expect(sliceStyleRuns(runs, 2, 5)).toEqual([{ start: 0, length: 2, style: bold }])
    expect(sliceStyleRuns(runs, 0, 2)).toEqual([{ start: 0, length: 2, style: bold }])
  })

  it('与这一行不相交的段整条丢掉（否则样式会涂到别的字符上）', () => {
    expect(sliceStyleRuns([{ start: 0, length: 2, style: bold }], 5, 7)).toEqual([])
  })

  it('多段按原顺序留下（写器按逐字符 charIds 写，顺序不能乱）', () => {
    const runs = [
      { start: 0, length: 2, style: { fontWeight: 700 } },
      { start: 4, length: 2, style: { italic: true } },
    ]
    expect(sliceStyleRuns(runs, 1, 6)).toEqual([
      { start: 0, length: 1, style: { fontWeight: 700 } },
      { start: 3, length: 2, style: { italic: true } },
    ])
  })
})

describe('稿子用到的样式名：去重 + 稳定序', () => {
  function doc(...texts: Partial<SceneNode>[]): SceneGraph {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (page === undefined) throw new Error('场景图里没有页面')
    for (const one of texts) graph.createNode('TEXT', page.id, { text: '字', ...one })
    return graph
  }

  it('按字重/斜体折算，重复的只留一个', () => {
    expect(figTextStyles(doc({}, { fontWeight: 400 }))).toEqual(['Regular'])
  })

  it('样式段里的字重也算（写器按逐字符的样式段去取字面）', () => {
    expect(figTextStyles(doc({ styleRuns: [{ start: 0, length: 1, style: { fontWeight: 700 } }] }))).toEqual(
      ['Bold', 'Regular'],
    )
  })

  it('稳定序：这张表决定 `fontMetaData` 的顺序，不许随取随变', () => {
    const graph = doc({}, { fontWeight: 700 }, { italic: true })
    expect(figTextStyles(graph)).toEqual(['Bold', 'Regular', 'Regular Italic'])
    expect(figTextStyles(graph)).toEqual(figTextStyles(graph))
  })

  it('非文本节点一个都不进表（一个 700 的矩形不该把 Bold 拖进来）', () => {
    const graph = doc({})
    const page = graph.getPages()[0]
    if (page === undefined) throw new Error('场景图里没有页面')
    graph.createNode('FRAME', page.id, { fontWeight: 700 })
    expect(figTextStyles(graph)).toEqual(['Regular'])
  })

  it('一张没有文字的稿子给空表（不是「一支默认字面」）', () => {
    expect(figTextStyles(doc())).toEqual([])
  })
})

/**
 * 导出前那份**一次性图**上必须成立的一件事：解出来的节点还能被复制。
 *
 * 这是 `document.ts` 里 `reviveInstanceOverrides` 的判据，来处正是这一批：fig 的改写要在
 * 一份 `decodeDesignFile` 出来的图上 `cloneTree`，而那份图里的 `instanceOverrides` 是
 * `JSON.stringify` 把两个 `Map` 写成 `{}` 的结果——`cloneTree` 第一句 `[...state.self]` 直接抛
 * `state.self is not iterable`。**「复制页面」在每一份真文档上都是这个死法**，而 `pages.spec.ts`
 * 全绿是因为那些判据都在内存图上跑、从没喂过一份解出来的图。所以这一条就钉在**解出来的图**上。
 */
describe('解出来的图必须和造出来的一样好用', () => {
  it('实例覆写表还是 Map：`cloneTree` 不再抛 `state.self is not iterable`', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (page === undefined) throw new Error('场景图里没有页面')
    const board = graph.createNode('FRAME', page.id, { name: '容器', width: 100, height: 100 })
    graph.createNode('TEXT', board.id, { name: '文字', text: '一' })

    const decoded = decodeDesignFile(encodeDesignFile(graph))
    const restored = decoded.getNode(board.id)
    if (restored === undefined) throw new Error('解回来的图里没有那个容器')
    expect(restored.instanceOverrides.self).toBeInstanceOf(Map)
    expect(restored.instanceOverrides.descendants).toBeInstanceOf(Map)
    expect(() => decoded.cloneTree(board.id, page.id)).not.toThrow()
  })
})
