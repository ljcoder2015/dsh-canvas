/**
 * dsh-canvas — design painter（v2 底座）：用录音 ops 钉**结构性绘制契约**。
 *
 * 颜色、字形这些「画得对不对」交给真实 canvas 目测；这里钉的是画板语义的渲染面：
 * 画板默认裁切溢出内容（一页一板），溢出的东西不露头；模块 frame 不裁——元素
 * 可以溢出模块照常显示；叶子（RECTANGLE 等）自己也不产生裁切。
 */
import { describe, expect, it } from 'vitest'
import type { DesignPaintOps } from '../../../src/client/artifact/viewers/design-render.ts'
import { paintDocument } from '../../../src/client/artifact/viewers/design-render.ts'
import { scaffoldDesignDocument } from '../../../src/core/artifact/design/document.ts'

type Call = { op: 'clip' | 'endClip' | 'rect'; args?: number[] }

/** 录音 ops：只记 clip / rect 的调用序列，其余原语空转。 */
function recordingOps(): DesignPaintOps & { calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    opacity() {},
    rect(x: number, y: number, width: number, height: number) {
      calls.push({ op: 'rect', args: [x, y, width, height] })
    },
    ellipse() {},
    text() {},
    pushClip(x: number, y: number, width: number, height: number) {
      calls.push({ op: 'clip', args: [x, y, width, height] })
    },
    popClip() {
      calls.push({ op: 'endClip' })
    },
  }
}

/** 画板 1（1024×1024）→ 导航栏（1024×80）→ 一根横向溢出的横幅；板级再放一个矩形。 */
function fixtureGraph() {
  const graph = scaffoldDesignDocument()
  const page = graph.getPages()[0]
  if (page === undefined) throw new Error('scaffold produced no page')
  const board = graph.getChildren(page.id).find((node) => node.type === 'FRAME')
  if (board === undefined) throw new Error('scaffold produced no artboard')
  const nav = graph.createNode('FRAME', board.id, { name: '导航栏', x: 0, y: 0, width: 1024, height: 80 })
  graph.createNode('RECTANGLE', nav.id, { name: '溢出的横幅', x: 900, y: 8, width: 400, height: 40 })
  graph.createNode('RECTANGLE', board.id, { name: '板级元素', x: 40, y: 200, width: 100, height: 60 })
  return { board, graph, nav }
}

describe('design painter clipping', () => {
  it('the artboard clips its overflow; module frames do not clip', () => {
    const { graph, nav } = fixtureGraph()
    const ops = recordingOps()

    paintDocument(graph, ops, { x: 0, y: 0, scale: 1 })

    // 裁切严格配对且只有画板一对：模块 frame（导航栏）不产生自己的裁切
    expect(ops.calls.filter((call) => call.op === 'clip')).toHaveLength(1)
    expect(ops.calls.filter((call) => call.op === 'endClip')).toHaveLength(1)

    // 画板的裁切范围就是画板本身的屏幕矩形（父相对坐标 × scale）
    const boardIndex = ops.calls.findIndex((call) => call.op === 'clip')
    expect(ops.calls[boardIndex]?.args).toEqual([0, 0, 1024, 1024])

    // 溢出导航栏的横幅画在画板 clip 与其 endClip 之间——不出画板就照常显示
    const boardEnd = ops.calls.findIndex((call, index) => index > boardIndex && call.op === 'endClip')
    const bannerIndex = ops.calls.findIndex((call) => call.op === 'rect' && call.args?.[0] === 900)
    expect(bannerIndex).toBeGreaterThan(boardIndex)
    expect(bannerIndex).toBeLessThan(boardEnd)
    // 溢出横幅的矩形原样入画（没有被导航栏的裁切改形——它本来就不裁）
    expect(ops.calls[bannerIndex]?.args).toEqual([900, 8, 400, 40])
    expect(nav.width).toBe(1024)
  })

  it('a rectangle paints but never clips anything itself', () => {
    const { graph } = fixtureGraph()
    const ops = recordingOps()

    paintDocument(graph, ops, { x: 0, y: 0, scale: 1 })

    // 只有画板产生裁切；板级矩形是叶子，不产生自己的裁切
    expect(ops.calls.filter((call) => call.op === 'clip')).toHaveLength(1)
    expect(ops.calls.some((call) => call.op === 'rect' && call.args?.[0] === 40)).toBe(true)
  })
})
