/**
 * 画布键位与快捷键说明表。
 *
 * 这个模块是「印出来的键」与「按得动的键」共用的唯一真源，所以值得钉住的不是
 * 某个键返回什么，而是两件事：分派表本身（含大小写、含不认的键不吃掉按键），
 * 以及说明表与字典的一致性——`SHORTCUT_SHEET` 里的每个文案键都必须在 zh / en
 * 两份字典里存在，否则弹层会印出一个键名而不是一句话。
 */
import { describe, expect, it } from 'vitest'
import { en, zh } from '../../../src/client/ui/locales.ts'
import { isTypingTarget, PAN_STEP, shortcutOf, SHORTCUT_SHEET, ZOOM_STEP } from '../../../src/client/ui/shortcuts.ts'

describe('shortcutOf', () => {
  it('W A S D 是上下左右，符号按屏幕坐标（y 向下为正）', () => {
    expect(shortcutOf('w')).toEqual({ kind: 'pan', dx: 0, dy: -PAN_STEP })
    expect(shortcutOf('s')).toEqual({ kind: 'pan', dx: 0, dy: PAN_STEP })
    expect(shortcutOf('a')).toEqual({ kind: 'pan', dx: -PAN_STEP, dy: 0 })
    expect(shortcutOf('d')).toEqual({ kind: 'pan', dx: PAN_STEP, dy: 0 })
  })

  it('Q 缩小、E 放大，且互为倒数', () => {
    const out = shortcutOf('q')
    const into = shortcutOf('e')
    expect(out).toEqual({ kind: 'zoom', factor: 1 / ZOOM_STEP })
    expect(into).toEqual({ kind: 'zoom', factor: ZOOM_STEP })
  })

  it('按下 Shift 时 key 是大写，键位照认', () => {
    expect(shortcutOf('W')).toEqual(shortcutOf('w'))
    expect(shortcutOf('E')).toEqual(shortcutOf('e'))
  })

  it('没登记的键返回 undefined——调用方据此决定不拦默认行为', () => {
    for (const key of ['x', 'Enter', 'ArrowUp', ' ', 'Escape', '1']) {
      expect(shortcutOf(key)).toBeUndefined()
    }
  })
})

describe('isTypingTarget', () => {
  it('吃文字的控件都算「正在输入」', () => {
    expect(isTypingTarget({ tagName: 'input' })).toBe(true)
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTypingTarget({ tagName: 'select' })).toBe(true)
    expect(isTypingTarget({ tagName: 'div', isContentEditable: true })).toBe(true)
  })

  it('卡片与画布自己不算', () => {
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false)
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false)
    // window / document 这类没有 tagName 的目标也不能让它抛异常。
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget(undefined)).toBe(false)
    expect(isTypingTarget({})).toBe(false)
    expect(isTypingTarget('input')).toBe(false)
  })
})

describe('SHORTCUT_SHEET', () => {
  const dict = zh as Record<string, string>

  it('每行的动作文案与键帽词都在两份字典里', () => {
    for (const row of SHORTCUT_SHEET) {
      expect(dict[row.label], row.label).toBeTypeOf('string')
      expect(en[row.label], `en 缺 ${row.label}`).toBeTypeOf('string')
      for (const cap of row.caps) {
        if ('literal' in cap) continue
        expect(dict[cap.key], cap.key).toBeTypeOf('string')
        expect(en[cap.key], `en 缺 ${cap.key}`).toBeTypeOf('string')
      }
    }
  })

  it('键帽列印的是「按什么」，说明列说的是「做什么」，没有空行', () => {
    expect(SHORTCUT_SHEET.length).toBeGreaterThan(0)
    for (const row of SHORTCUT_SHEET) {
      expect(row.caps.length).toBeGreaterThan(0)
      for (const cap of row.caps) {
        const printed = 'literal' in cap ? cap.literal : dict[cap.key]
        expect(printed).toBeTruthy()
      }
    }
  })

  it('一个键一行：没有一行并排两枚键帽', () => {
    for (const row of SHORTCUT_SHEET) {
      expect(row.caps.length, `一行印了 ${row.caps.length} 枚键帽：${row.label}`).toBe(1)
    }
  })

  it('行文案互不相同——弹层拿它当 React key', () => {
    const labels = SHORTCUT_SHEET.map((row) => row.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('键位表里的每一枚字母键都在说明表里出现过', () => {
    const printed = SHORTCUT_SHEET.flatMap((row) =>
      row.caps.flatMap((cap) => ('literal' in cap ? [cap.literal.toLowerCase()] : [])),
    )
    for (const key of ['w', 'a', 's', 'd', 'q', 'e']) {
      expect(printed).toContain(key)
    }
  })
})
