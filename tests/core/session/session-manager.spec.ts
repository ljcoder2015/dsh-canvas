/**
 * 卡片会话表的记账：谁开着、哪张卡在开会话，以及「收养」进来的会话算谁的。
 *
 * 卡片的对话是持久化的，所以它可能**已经**活在别处——harness 自己的会话控制器在
 * 用户于主聊天里打开该会话时会 resume 它，并因此握住日志的单写者租约。那张卡仍然
 * 开着同一段对话，于是这条会话是**收养**（`adopt`）进来的：卡片驱动它，但释放卡片
 * 不得 dispose 一个不是它创建的 agent。
 *
 * 这里钉住的是这张表本身：两个方向的索引、释放的对称性，以及收养的会话在释放后确实
 * 被忘记——好让下一次 open 能重新收养它，而不是以为它已经不在了。
 */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SessionManager } from '../../../src/core/session/session-manager.ts'

/** 一个只要 `id` 的 agent 替身——表里只读这一个字段。 */
function agent(id: string): never {
  return { id } as never
}

/** 无容器的插件上下文：工厂拿到的就是它。 */
const ctx = {} as Context

const PROJECT = 'flow-test'
const CARD = 'oozzqz'

/** 打开一张卡，工厂记下被调用了几次，并交回一个可观测的 disposer。 */
function opener(manager: SessionManager, sessionId: string) {
  const dispose = vi.fn(async () => undefined)
  const create = vi.fn(async () => ({ agent: agent(sessionId), dispose }))
  return { create, dispose, open: () => manager.open(PROJECT, CARD, create) }
}

describe('SessionManager.open', () => {
  it('建会话并登记两个方向的索引', async () => {
    const manager = new SessionManager(ctx)
    const { open } = opener(manager, 'cv-a')

    const { session, created } = await open()

    expect(created).toBe(true)
    expect(session.sessionId).toBe('cv-a')
    expect(manager.live(PROJECT, CARD)).toBe(session)
    // 反查是工具的身份判据：查不到自己属于哪张卡的工具必须拒绝运行。
    expect(manager.cardOf('cv-a')).toBe(session)
    expect(manager.all()).toEqual([session])
  })

  it('已经开着的卡片直接复用，不再建第二个', async () => {
    const manager = new SessionManager(ctx)
    const { create, open } = opener(manager, 'cv-a')

    const first = await open()
    const second = await open()

    expect(second.created).toBe(false)
    expect(second.session).toBe(first.session)
    expect(create).toHaveBeenCalledTimes(1)
  })
})

describe('SessionManager.release', () => {
  it('自建的会话释放时 dispose，并清掉两个索引', async () => {
    const manager = new SessionManager(ctx)
    const { dispose, open } = opener(manager, 'cv-a')
    await open()

    expect(await manager.release(PROJECT, CARD)).toBe(true)

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(manager.live(PROJECT, CARD)).toBeUndefined()
    expect(manager.cardOf('cv-a')).toBeUndefined()
    expect(manager.all()).toEqual([])
  })

  it('没有会话的卡片释放是空操作', async () => {
    const manager = new SessionManager(ctx)
    expect(await manager.release(PROJECT, CARD)).toBe(false)
  })
})

describe('SessionManager.adopt', () => {
  it('登记一个别处的 agent，方向索引照样成立', () => {
    const manager = new SessionManager(ctx)
    const external = agent('cv-live')

    const session = manager.adopt(PROJECT, CARD, 'cv-live', external)

    expect(session.agent).toBe(external)
    expect(session.sessionId).toBe('cv-live')
    expect(manager.live(PROJECT, CARD)).toBe(session)
    expect(manager.cardOf('cv-live')).toBe(session)
  })

  it('收养不覆盖这张卡已经开着的会话', async () => {
    const manager = new SessionManager(ctx)
    const opened = await opener(manager, 'cv-a').open()

    const adopted = manager.adopt(PROJECT, CARD, 'cv-live', agent('cv-live'))

    expect(adopted).toBe(opened.session)
    expect(manager.cardOf('cv-live')).toBeUndefined()
  })

  it('释放收养的会话后，下一次 open 会重新收养而不是以为它还开着', async () => {
    const manager = new SessionManager(ctx)
    manager.adopt(PROJECT, CARD, 'cv-live', agent('cv-live'))

    expect(await manager.release(PROJECT, CARD)).toBe(true)

    // 别处的 agent 仍在运行，所以卡片再打开时必须重新收养同一个 agent——
    // 这条会话的日志写租约在别人手上，卡片不能另起一段对话。
    const again = manager.adopt(PROJECT, CARD, 'cv-live', agent('cv-live'))
    expect(manager.live(PROJECT, CARD)).toBe(again)
    expect(again.sessionId).toBe('cv-live')
  })
})