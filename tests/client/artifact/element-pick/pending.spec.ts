/**
 * 元素选择手里那一笔：一张表，按卡记。
 *
 * 它存在的理由只有一个 —— 弹窗关掉就整棵卸掉，而元素选择要**跨过那次卸载**（见
 * `pending.ts` 的开头）。所以这里钉住的正是那几条：记得住、读得回、丢得掉，以及
 * **存的是副本**（调用方那边还在改的那个对象不该顺着这张表漂进来）。
 *
 * 模块本身零依赖（不碰 React、不碰宿主 UI 原语），所以能在 node 里直接跑——这里量的就是
 * 它的全部行为，没有别的。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  dropPending,
  forgetPending,
  pendingKey,
  readPending,
  writePending,
  type PendingPick,
} from '../../../../src/client/artifact/element-pick/pending.ts'

/** 一笔长得像样的记录：圈住一个按钮，草稿里嵌着它的源码，还没发出去。 */
function record(): PendingPick {
  return {
    target: {
      label: 'button#go.primary.wide',
      selector: 'body > button#go',
      html: '<button id="go">开始</button>',
      truncated: false,
      shadow: false,
      rect: { left: 10, top: 220, width: 88, height: 32 },
    },
    frame: { left: 280, top: 51, width: 1320, height: 900 },
    viewText: '<html><body><button id="go">开始</button></body></html>',
    draft: '请改这个页面节点，改动范围就是下面这一段。\n\n改动要求：',
    sent: '',
    awaiting: false,
    from: '',
  }
}

describe('元素选择：手里那一笔能活过一次关闭', () => {
  beforeEach(() => {
    forgetPending()
  })

  it('按「画布 + 卡片」记：两张卡的笔互不串门', () => {
    const one = pendingKey('project-a', 'index.html')
    const two = pendingKey('project-b', 'index.html')
    expect(one).not.toBe(two)

    writePending(one, record())
    expect(readPending(one)?.target.label).toBe('button#go.primary.wide')
    // 另一张卡（另一个画布）没有就是没有 —— 重开时不该凭空冒出一个圈。
    expect(readPending(two)).toBeUndefined()
  })

  it('记的是副本：调用方接着改手里那份，袋里的不受影响', () => {
    const key = pendingKey('p', 'index.html')
    const mine = record()
    writePending(key, mine)
    // 用户在框里继续写字（React 那边会造一份新的，但这里连旧对象一起改，更狠一点）。
    ;(mine as { draft: string }).draft = '改了'
    ;(mine as { awaiting: boolean }).awaiting = true

    const kept = readPending(key)
    expect(kept?.draft).toBe('请改这个页面节点，改动范围就是下面这一段。\n\n改动要求：')
    expect(kept?.awaiting).toBe(false)
  })

  it('放手就是放手：丢掉之后读不到（框上的 × 与 Esc 走这条）', () => {
    const key = pendingKey('p', 'index.html')
    writePending(key, record())
    dropPending(key)
    expect(readPending(key)).toBeUndefined()
  })

  it('后来的一份盖掉先前那份（重新选一个元素）', () => {
    const key = pendingKey('p', 'index.html')
    writePending(key, record())
    const second = { ...record(), draft: '换一个元素', sent: '换一个元素', awaiting: true }
    writePending(key, second)
    expect(readPending(key)?.awaiting).toBe(true)
    expect(readPending(key)?.sent).toBe('换一个元素')
  })

  it('没有记录时读到的是 undefined，不是空壳', () => {
    expect(readPending(pendingKey('nobody', 'none.html'))).toBeUndefined()
  })

  it('forgetPending 清空整张表（测试用，也是「它没有比这更长的记忆」的明证）', () => {
    writePending(pendingKey('p', 'a.html'), record())
    writePending(pendingKey('p', 'b.html'), record())
    forgetPending()
    expect(readPending(pendingKey('p', 'a.html'))).toBeUndefined()
    expect(readPending(pendingKey('p', 'b.html'))).toBeUndefined()
  })
})
