/**
 * dsh-canvas — 画布的键盘键位，以及把键位印出来的那张说明表。
 *
 * 一份真源：画布按键时走 `shortcutOf` 分派，dock 上的快捷键弹层印的是同一数组
 * `SHORTCUT_SHEET`。于是键位不可能「装了没写」或「写了没装」——改动只会发生在
 * 这一处，界面与行为不会各说各话。
 *
 * 方向键用的是字母而不是 ↑↓←→：浏览器的方向键还会滚动宿主页面，而 WASD 在画布
 * 语义里是「移动取景框」，按下即平移一步、按住则由系统的按键重复连续平移。
 */
import type { CanvasKey } from './locales.ts'

/**
 * 一次按键对视口做的事。
 *
 * 平移按**屏幕像素**记（画布上的位移自然随缩放放大或缩小），缩放记倍率而不是
 * 目标值——倍率在夹取到区间端点时行为可预期，目标值则会在两端堆叠无效按键。
 */
export type CanvasShortcut =
  | { readonly kind: 'pan'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'zoom'; readonly factor: number }

/** 每次按键平移的屏幕像素。 */
export const PAN_STEP = 72

/** Q / E 每次按键的缩放倍率。 */
export const ZOOM_STEP = 1.12

/** 空格键的 `event.key`；抓住手（平移）的那一枚。 */
export const SPACE_KEY = ' '

/**
 * 键位表：W 上、A 左、S 下、D 右、Q 缩小、E 放大。
 *
 * 只认单个字符的大小写（`event.key` 在按下 Shift 时是大写，先归一化再查表），
 * 不认 `keyCode`——后者在非拉丁键盘布局上会指向别处。
 */
export function shortcutOf(key: string): CanvasShortcut | undefined {
  switch (key.toLowerCase()) {
    case 'w':
      return { kind: 'pan', dx: 0, dy: -PAN_STEP }
    case 's':
      return { kind: 'pan', dx: 0, dy: PAN_STEP }
    case 'a':
      return { kind: 'pan', dx: -PAN_STEP, dy: 0 }
    case 'd':
      return { kind: 'pan', dx: PAN_STEP, dy: 0 }
    case 'q':
      return { kind: 'zoom', factor: 1 / ZOOM_STEP }
    case 'e':
      return { kind: 'zoom', factor: ZOOM_STEP }
    default:
      return undefined
  }
}

/**
 * 这次按键是否来自一个正在输入的地方。
 *
 * 画布的监听挂在 window 上（焦点多半不在表面上，而在卡片或提示词输入框里——它们
 * 同在一棵子树内），所以「不该管」的判断得自己做：一切吃文字的控件都碰不得，否则
 * 在提示词里打一个 a 就会把画布平移走。
 */
export function isTypingTarget(node: unknown): boolean {
  if (node === null || typeof node !== 'object') return false
  const element = node as { isContentEditable?: unknown; tagName?: unknown }
  if (element.isContentEditable === true) return true
  const tag = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : ''
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** 说明表里印出来的一枚键帽：要么是字面键名，要么是一个需要翻译的手势词。 */
export type KeyCap = { readonly literal: string } | { readonly key: CanvasKey }

/** 说明表的一行：左列是键帽，右列是它做什么。 */
export interface ShortcutRow {
  readonly caps: readonly KeyCap[]
  /** 右列的文案键；键位印在左列，动作说明走字典。 */
  readonly label: CanvasKey
}

/**
 * 快捷键说明表的行序：**一 key 一行**。
 *
 * 并排两枚键（W A S D 挤一行、Q E 挤一行）看着紧凑，读起来却要在脑子里拆开——
 * 说明表是给人查的，不是给人背的，所以方向与缩放各占一行、各配一句自己的话。
 *
 * 先键盘后指针：画布的第一手势是「按住空格拖」，键盘是它的加速器；卡片那两行排在
 * 最后，它们是画布上本来就有的鼠标动作，列在这里只是为了一张表说全。
 */
export const SHORTCUT_SHEET: readonly ShortcutRow[] = [
  { caps: [{ literal: 'Space' }], label: 'canvas.keys.space' },
  { caps: [{ literal: 'W' }], label: 'canvas.keys.up' },
  { caps: [{ literal: 'A' }], label: 'canvas.keys.left' },
  { caps: [{ literal: 'S' }], label: 'canvas.keys.down' },
  { caps: [{ literal: 'D' }], label: 'canvas.keys.right' },
  { caps: [{ literal: 'Q' }], label: 'canvas.keys.zoomOut' },
  { caps: [{ literal: 'E' }], label: 'canvas.keys.zoomIn' },
  { caps: [{ key: 'canvas.key.wheel' }], label: 'canvas.keys.wheel' },
  { caps: [{ key: 'canvas.key.dragCard' }], label: 'canvas.keys.card' },
  { caps: [{ key: 'canvas.key.dblclick' }], label: 'canvas.keys.preview' },
]
