/**
 * 预览里的元素选择（F3.14）：注入脚本 + 三个纯决策。
 *
 * 探针是以**字符串**的形式发给每份 HTML 预览的，所以只读字符串的测试证明不了任何
 * 事。这一份把它**真跑起来**——`new Function` 把探针唯一接触的三个全局
 * （`window` / `document` / `parent`）递进去，再用合成的鼠标事件驱动它。于是下面
 * 那张表是量出来的，不是复述的：未使能时一动不动、使能后高亮落在鼠标底下的元素上、
 * 点击把这一击吞掉并回话、shadow 里点得进内层、**开了模式页面就收不到任何指针事件
 * （只读）**。
 *
 * 与链接闸门（`tests/webapp.spec.ts`）同一套路，因为这是同一类东西：一段要跑在
 * 不可信页面里的代码，唯一能钉住它的办法就是执行它。
 */
import { describe, expect, it } from 'vitest'
import { PREVIEW_CHANNEL } from '../../../src/core/artifact/webapp.ts'
import {
  PICK_BOX_HEIGHT,
  PICK_BOX_WIDTH,
  PICK_DISABLE,
  PICK_ENABLE,
  PICK_ESCAPE_KIND,
  PICK_KIND,
  PICK_ORDER_KIND,
  PICK_SNIPPET_CAP,
  PREVIEW_PICKER_ID,
  PREVIEW_PICKER_MARK,
  PREVIEW_PICKER_SOURCE,
  buildEditPrompt,
  fenceFor,
  injectPreviewPicker,
  isPickEscape,
  pickOrder,
  placePickBox,
  readsPick,
  type PickTarget,
} from '../../../src/core/artifact/preview-picker.ts'

// ── 一个够用的假 DOM ────────────────────────────────────────────────────────

interface FakeRect {
  left: number
  top: number
  width: number
  height: number
}

interface FakeShadow {
  nodeType: number
  host: FakeElement
  children: FakeElement[]
  elementFromPoint?: (x: number, y: number) => FakeElement | null
}

interface FakeElement {
  nodeType: number
  tagName: string
  id: string
  classList: string[]
  style: Record<string, string>
  children: FakeElement[]
  parentNode: FakeElement | FakeShadow | null
  textContent: string
  outerHTML: string
  rect: FakeRect
  attributes: Record<string, string>
  /** 探针请它让出焦点时置真（页面里原有的焦点与后来想落进来的焦点都走这里）。 */
  blurred: boolean
  shadowRoot?: FakeShadow
  appendChild(child: FakeElement): void
  setAttribute(name: string, value: string): void
  getAttribute(name: string): string | null
  blur(): void
  getBoundingClientRect(): FakeRect
}

/** 一个假的 CSSStyleDeclaration：没设过的属性读出来是空串（真 DOM 就是这么答的），
 *  而写 `cssText` 会像真 DOM 那样被拆成一条条属性（并且把 `pointer-events` 这种
 *  连字符名折成 `pointerEvents`）—— 探针正是用 cssText 一次设完的，不拆的话
 *  「它到底把 cursor 设成了什么」就无从判起。 */
function makeStyle(): Record<string, string> {
  const dashed = (name: string): string => name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
  return new Proxy({} as Record<string, string>, {
    get: (target, key) => {
      if (key === 'cssText') {
        return Object.entries(target)
          .map(([name, value]) => `${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${value}`)
          .join(';')
      }
      return key in target ? target[key as string] : ''
    },
    set: (target, key, value: string) => {
      if (key === 'cssText') {
        for (const part of String(value).split(';')) {
          const at = part.indexOf(':')
          if (at <= 0) continue
          target[dashed(part.slice(0, at).trim())] = part.slice(at + 1).trim()
        }
        return true
      }
      target[key as string] = value
      return true
    },
  })
}

/** One fake element. Only the surface the probe actually touches. */
function makeElement(
  tag: string,
  options: { id?: string; classes?: string[]; html?: string; rect?: Partial<FakeRect> } = {},
): FakeElement {
  const element: FakeElement = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id: options.id ?? '',
    classList: options.classes ?? [],
    style: makeStyle(),
    children: [],
    parentNode: null,
    textContent: '',
    outerHTML: options.html ?? `<${tag}></${tag}>`,
    rect: { left: 0, top: 0, width: 0, height: 0, ...options.rect },
    attributes: {},
    blurred: false,
    appendChild(child: FakeElement): void {
      child.parentNode = element
      element.children.push(child)
    },
    setAttribute(name: string, value: string): void {
      element.attributes[name] = value
    },
    getAttribute(name: string): string | null {
      return name in element.attributes ? element.attributes[name] : null
    },
    blur(): void {
      element.blurred = true
    },
    getBoundingClientRect(): FakeRect {
      return element.rect
    },
  }
  return element
}

/** Nest a child under a parent, the way a page is built. */
function nest(parent: FakeElement, child: FakeElement): FakeElement {
  parent.appendChild(child)
  return child
}

/** Put a child inside an open shadow root hanging off an already-nested host. */
function shadow(host: FakeElement, child: FakeElement): FakeShadow {
  const root: FakeShadow = { nodeType: 11, host, children: [] }
  child.parentNode = root
  root.children.push(child)
  host.shadowRoot = root
  return root
}

interface Harness {
  /** The three nodes the probe builds for itself, in creation order. */
  overlays: FakeElement[]
  /** What the frame posted to its parent. */
  posted: unknown[]
  /** Deliver a message to the probe; `source` defaults to the parent window. */
  send(data: unknown, source?: unknown): void
  /** Fire a listener the probe registered on `window`, and report what it did to the event. */
  fire(type: string, event: Record<string, unknown>): { prevented: boolean; stopped: boolean }
  /** Fire a listener the probe registered on `document`（焦点那道闸就在那儿）. */
  fireDoc(type: string, event: Record<string, unknown>): { prevented: boolean; stopped: boolean }
  /** Whether the probe listens for that event at all. */
  listens(type: string): boolean
  /** Decide what `document.elementsFromPoint` returns, topmost first. */
  hitTest(fn: (x: number, y: number) => FakeElement | FakeElement[] | null): void
  /** Whatever the page has focused right now. */
  setActive(node: FakeElement | null): void
  /** The node the probe created for itself with a given role. */
  overlay(role: string): FakeElement
  /** Whether it created that node at all. */
  hasOverlay(role: string): boolean
}

/** 把一发事件交给某个监听表，并报出探针对它做了什么。 */
function dispatch(
  listeners: Map<string, (event: Record<string, unknown>) => void>,
  where: string,
  type: string,
  event: Record<string, unknown>,
): { prevented: boolean; stopped: boolean } {
  const handler = listeners.get(type)
  if (handler === undefined) throw new Error(`${where}没有注册 ${type} 监听`)
  let prevented = false
  let stopped = false
  handler({
    ...event,
    preventDefault: (): void => {
      prevented = true
    },
    stopPropagation: (): void => {
      stopped = true
    },
  })
  return { prevented, stopped }
}

/**
 * 运行**实际发出的那段脚本**，把它的三个外部世界递进去。
 *
 * `legacy` 去掉 `elementsFromPoint`：不是所有浏览器都有它，探针为此留了另一条路（把只读层
 * 临时让开一次再问），那一条也得真跑过才算数。
 */
function runProbe(options: { legacy?: boolean } = {}): Harness {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>()
  const docListeners = new Map<string, (event: Record<string, unknown>) => void>()
  const overlays: FakeElement[] = []
  const posted: unknown[] = []
  let active: FakeElement | null = null
  let probe: ((x: number, y: number) => FakeElement | FakeElement[] | null) | null = null

  /** 命中测试的答案，一律按「自上而下一串」给（浏览器就是这么答的）。 */
  const hits = (x: number, y: number): FakeElement[] => {
    if (probe === null) return []
    const got = probe(x, y)
    if (got === null) return []
    return Array.isArray(got) ? got : [got]
  }
  /** 真 DOM 里 `pointer-events:none` 的元素根本不参与命中测试，这里照做。 */
  const reachable = (list: FakeElement[]): FakeElement[] => list.filter((node) => node.style.pointerEvents !== 'none')

  const documentElement = {
    nodeType: 1,
    tagName: 'HTML',
    style: makeStyle(),
    appendChild: (child: FakeElement): void => {
      overlays.push(child)
    },
  }
  const document: Record<string, unknown> = {
    documentElement,
    body: makeElement('body'),
    get activeElement(): FakeElement | null {
      return active
    },
    createElement: (tag: string): FakeElement => makeElement(tag),
    elementFromPoint: (x: number, y: number): FakeElement | null => reachable(hits(x, y))[0] ?? null,
    addEventListener: (type: string, handler: (event: Record<string, unknown>) => void): void => {
      docListeners.set(type, handler)
    },
  }
  if (options.legacy !== true) {
    document.elementsFromPoint = (x: number, y: number): FakeElement[] => hits(x, y)
  }
  const parent = {
    postMessage: (data: unknown): void => {
      posted.push(data)
    },
  }
  const window = {
    parent,
    addEventListener: (type: string, handler: (event: Record<string, unknown>) => void): void => {
      listeners.set(type, handler)
    },
  }
  // The probe is a plain script: these three are its entire outside world.
  const install = new Function('window', 'document', 'parent', PREVIEW_PICKER_SOURCE)
  install(window, document, parent)

  const find = (role: string): FakeElement | undefined =>
    overlays.find((node) => node.getAttribute(PREVIEW_PICKER_MARK) === role)

  return {
    overlays,
    posted,
    send(data: unknown, source: unknown = parent): void {
      dispatch(listeners, '探针在 window 上', 'message', { source, data })
    },
    fire(type: string, event: Record<string, unknown>): { prevented: boolean; stopped: boolean } {
      return dispatch(listeners, '探针', type, event)
    },
    fireDoc(type: string, event: Record<string, unknown>): { prevented: boolean; stopped: boolean } {
      return dispatch(docListeners, '探针在 document 上', type, event)
    },
    listens(type: string): boolean {
      return listeners.has(type) || docListeners.has(type)
    },
    hitTest(fn: (x: number, y: number) => FakeElement | FakeElement[] | null): void {
      probe = fn
    },
    setActive(node: FakeElement | null): void {
      active = node
    },
    overlay(role: string): FakeElement {
      const found = find(role)
      if (found === undefined) throw new Error(`探针没有建出 ${role} 这层`)
      return found
    },
    hasOverlay(role: string): boolean {
      return find(role) !== undefined
    },
  }
}

/** 使能探针（父窗口那一发报文）。 */
function arm(harness: Harness): void {
  harness.send({ channel: PREVIEW_CHANNEL, kind: PICK_ORDER_KIND, action: PICK_ENABLE })
}

/** A page with a title and a button, the way a fixture looks. */
function fixture(): { page: FakeElement; hero: FakeElement; action: FakeElement } {
  const page = makeElement('body', { rect: { left: 0, top: 0, width: 800, height: 600 } })
  const hero = nest(page, makeElement('section', { classes: ['hero'], html: '<section class="hero"><h1>你好</h1></section>', rect: { left: 40, top: 60, width: 300, height: 120 } }))
  const action = nest(page, makeElement('button', { id: 'go', classes: ['primary', 'wide'], html: '<button id="go" class="primary wide">开始</button>', rect: { left: 40, top: 220, width: 88, height: 32 } }))
  return { page, hero, action }
}

describe('元素探针：未使能时是死的', () => {
  it('不建浮层、不跟随鼠标、不回话', () => {
    const probe = runProbe()
    const { hero } = fixture()
    probe.hitTest(() => hero)

    const moved = probe.fire('mousemove', { clientX: 50, clientY: 70 })
    expect(probe.overlays).toEqual([])
    expect(probe.posted).toEqual([])
    expect(moved.prevented).toBe(false)

    const clicked = probe.fire('click', { clientX: 50, clientY: 70 })
    expect(probe.posted).toEqual([])
    // 页面是用户在看的页面：没使能时这一击照旧是页面自己的一击。
    expect(clicked.prevented).toBe(false)
    expect(clicked.stopped).toBe(false)
  })

  it('页面自己的动作也一概不碰（监听在，但没使能就一个指头都不动）', () => {
    const probe = runProbe()
    for (const type of ['mousedown', 'mouseup', 'contextmenu', 'selectstart', 'pointerdown']) {
      const done = probe.fire(type, { clientX: 1, clientY: 1 })
      expect([type, done.stopped, done.prevented]).toEqual([type, false, false])
    }
  })

  it('只有父窗口那一发报文能使能它', () => {
    const probe = runProbe()
    const { hero } = fixture()
    probe.hitTest(() => hero)
    const elsewhere = { postMessage: (): void => undefined }

    probe.send({ channel: PREVIEW_CHANNEL, kind: PICK_ORDER_KIND, action: PICK_ENABLE }, elsewhere)
    probe.send({ channel: 'other-channel', kind: PICK_ORDER_KIND, action: PICK_ENABLE })
    probe.send({ channel: PREVIEW_CHANNEL, kind: 'other-kind', action: PICK_ENABLE })
    probe.send({ channel: PREVIEW_CHANNEL, kind: PICK_ORDER_KIND, action: 'something-else' })
    probe.send(null)
    probe.send('nonsense')
    probe.fire('mousemove', { clientX: 50, clientY: 70 })

    expect(probe.overlays).toEqual([])
    expect(probe.posted).toEqual([])
  })
})

describe('元素探针：使能后的跟随与回话', () => {
  it('把高亮画在鼠标底下的元素上，并亮出它的标签', () => {
    const probe = runProbe()
    const { hero } = fixture()
    probe.hitTest(() => hero)
    arm(probe)

    probe.fire('mousemove', { clientX: 50, clientY: 70 })

    const box = probe.overlay('box')
    expect([box.style.left, box.style.top, box.style.width, box.style.height]).toEqual(['40px', '60px', '300px', '120px'])
    expect(box.style.display).toBe('block')
    const chip = probe.overlay('label')
    expect(chip.textContent).toBe('section.hero')
    expect(chip.style.display).toBe('block')
  })

  it('回话带上源码、路径与位置，并且这一击不再落到页面上', () => {
    const probe = runProbe()
    const { hero } = fixture()
    probe.hitTest(() => hero)
    arm(probe)
    probe.fire('mousemove', { clientX: 50, clientY: 70 })

    const clicked = probe.fire('click', { clientX: 50, clientY: 70, button: 0 })
    expect(clicked.prevented).toBe(true)
    expect(clicked.stopped).toBe(true)
    expect(probe.posted).toEqual([
      {
        channel: PREVIEW_CHANNEL,
        kind: PICK_KIND,
        target: {
          label: 'section.hero',
          selector: 'body > section.hero',
          html: '<section class="hero"><h1>你好</h1></section>',
          truncated: false,
          shadow: false,
          rect: { left: 40, top: 60, width: 300, height: 120 },
        },
      },
    ])
  })

  it('一击即收：回话之后不再跟随，也不再吞掉别的东西', () => {
    const probe = runProbe()
    const { hero } = fixture()
    probe.hitTest(() => hero)
    arm(probe)
    probe.fire('mousemove', { clientX: 50, clientY: 70 })
    probe.fire('click', { clientX: 50, clientY: 70 })

    expect(probe.overlay('box').style.display).toBe('none')
    // 只读层一并收回：一击之后页面重新归它自己。
    expect(probe.overlay('veil').style.display).toBe('none')
    probe.hitTest(() => null)
    const after = probe.fire('click', { clientX: 50, clientY: 70 })
    expect(after.prevented).toBe(false)
    expect(probe.posted).toHaveLength(1)
  })

  it('没先移动过鼠标也能选中（用点击自己的坐标命中）', () => {
    const probe = runProbe()
    const { action } = fixture()
    probe.hitTest(() => action)
    arm(probe)

    probe.fire('click', { clientX: 60, clientY: 230 })
    const message = probe.posted[0] as { target: PickTarget }
    expect(message.target.label).toBe('button#go.primary.wide')
    expect(message.target.selector).toBe('body > button#go')
  })

  it('收起之后再使能仍然好使，且不再画上一次的框', () => {
    const probe = runProbe()
    const { hero } = fixture()
    probe.hitTest(() => hero)
    arm(probe)
    probe.send({ channel: PREVIEW_CHANNEL, kind: PICK_ORDER_KIND, action: PICK_DISABLE })
    expect(probe.overlay('box').style.display).toBe('none')
    expect(probe.overlay('veil').style.display).toBe('none')

    probe.hitTest(() => null)
    const stray = probe.fire('click', { clientX: 50, clientY: 70 })
    expect(stray.prevented).toBe(false)

    probe.hitTest(() => hero)
    arm(probe)
    probe.fire('mousemove', { clientX: 50, clientY: 70 })
    expect(probe.overlay('box').style.left).toBe('40px')
  })

  it('Esc 收起自己并把这一发交给父窗口', () => {
    const probe = runProbe()
    arm(probe)
    const pressed = probe.fire('keydown', { key: 'Escape' })

    expect(pressed.prevented).toBe(true)
    expect(probe.posted).toEqual([{ channel: PREVIEW_CHANNEL, kind: PICK_ESCAPE_KIND }])
    // 别的键一概不碰。
    probe.posted.length = 0
    arm(probe)
    expect(probe.posted).toEqual([])
    expect(probe.fire('keydown', { key: 'a' }).prevented).toBe(false)
  })
})

describe('元素探针：开了模式，页面就是只读的', () => {
  it('只读层盖满视口、出示十字，而且是唯一接得住鼠标的那一层', () => {
    const probe = runProbe()
    const { hero } = fixture()
    probe.hitTest(() => hero)
    arm(probe)
    const veil = probe.overlay('veil')
    expect([veil.style.position, veil.style.width, veil.style.height]).toEqual(['fixed', '100%', '100%'])
    expect(veil.style.pointerEvents).toBe('auto')
    expect(veil.style.cursor).toBe('crosshair')
    // 高亮框与记号牌相反：它们只是画上去的，不吃鼠标。
    for (const role of ['box', 'label']) expect(probe.overlay(role).style.pointerEvents).toBe('none')
  })

  it('只读从按下那一刻就生效，不等第一次划过；收起时也一并收回', () => {
    const probe = runProbe()
    arm(probe)
    expect(probe.overlay('veil').style.display).toBe('block')
    probe.send({ channel: PREVIEW_CHANNEL, kind: PICK_ORDER_KIND, action: PICK_DISABLE })
    expect(probe.overlay('veil').style.display).toBe('none')
  })

  it('命中测试把自己的层筛掉：鼠标底下的第一名还是页面的元素', () => {
    const probe = runProbe()
    const { hero } = fixture()
    arm(probe)
    // 浏览器就是这么答的：只读层在最上面，我们的记号牌紧随其后。
    probe.hitTest(() => [probe.overlay('veil'), probe.overlay('label'), hero])
    probe.fire('mousemove', { clientX: 50, clientY: 70 })
    expect(probe.overlay('label').textContent).toBe('section.hero')

    probe.fire('click', { clientX: 50, clientY: 70 })
    expect((probe.posted[0] as { target: PickTarget }).target.label).toBe('section.hero')
  })

  it('没有 elementsFromPoint 的浏览器：把只读层让开一次再问，问完放回去', () => {
    const probe = runProbe({ legacy: true })
    const { hero } = fixture()
    arm(probe)
    const veil = probe.overlay('veil')
    probe.hitTest(() => [veil, hero])
    probe.fire('mousemove', { clientX: 50, clientY: 70 })
    expect(probe.overlay('label').textContent).toBe('section.hero')
    // 让开的那一下必须放回去：留在 none 上等于只读层白盖了一层。
    expect(veil.style.pointerEvents).toBe('auto')
  })

  it('鼠标那一族挡下并且吞掉默认动作（焦点、选区、拖放、右键菜单都从这儿断）', () => {
    const probe = runProbe()
    arm(probe)
    const dead = [
      'mousedown', 'mouseup', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
      'dblclick', 'auxclick', 'contextmenu', 'dragstart', 'selectstart',
    ]
    for (const type of dead) {
      const done = probe.fire(type, { clientX: 1, clientY: 1 })
      expect([type, done.stopped, done.prevented]).toEqual([type, true, true])
    }
  })

  it('指针那一族只挡不吞（吞掉 pointerdown 会连带压掉兼容鼠标事件，而选择正靠 click）', () => {
    const probe = runProbe()
    arm(probe)
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout']) {
      const done = probe.fire(type, { clientX: 1, clientY: 1 })
      expect([type, done.stopped, done.prevented]).toEqual([type, true, false])
    }
    // 选择与跟随各有自己的监听，不在这张表里。
    expect(probe.listens('click')).toBe(true)
    expect(probe.listens('mousemove')).toBe(true)
    // 滚轮不在拦下的名单里：滚动是「看」，页面还得能滚。
    expect(probe.listens('wheel')).toBe(false)
  })

  it('焦点进不了页面：开模式时请走已有的，之后也不让新的落进来', () => {
    const probe = runProbe()
    const { page } = fixture()
    const field = nest(page, makeElement('input', { id: 'field' }))
    const later = makeElement('input', { id: 'later' })
    probe.setActive(field)

    arm(probe)
    expect(field.blurred).toBe(true)

    probe.fireDoc('focusin', { target: later })
    expect(later.blurred).toBe(true)

    // 模式关了就还回去：页面自己的焦点重新归页面管。
    probe.send({ channel: PREVIEW_CHANNEL, kind: PICK_ORDER_KIND, action: PICK_DISABLE })
    const late = makeElement('input', { id: 'late' })
    probe.fireDoc('focusin', { target: late })
    expect(late.blurred).toBe(false)
  })

  it('自己那几层都带着记号，且按「层、框、牌」的次序建出来', () => {
    const probe = runProbe()
    arm(probe)
    expect(probe.overlays.map((node) => node.getAttribute(PREVIEW_PICKER_MARK))).toEqual(['veil', 'box', 'label'])
  })
})

describe('元素探针：shadow DOM 与超长节点', () => {
  it('穿过 open shadow root 命中内层，路径里写明这一跳', () => {
    const probe = runProbe()
    const page = makeElement('body')
    const host = nest(page, makeElement('wc-button', { id: 'go', rect: { left: 10, top: 10, width: 100, height: 30 } }))
    const inner = makeElement('button', { classes: ['inner'], html: '<button class="inner">开始</button>', rect: { left: 14, top: 14, width: 92, height: 22 } })
    const root = shadow(host, inner)
    root.elementFromPoint = () => inner
    probe.hitTest(() => host)
    arm(probe)

    probe.fire('mousemove', { clientX: 20, clientY: 20 })
    expect(probe.overlay('label').textContent).toBe('button.inner')
    probe.fire('click', { clientX: 20, clientY: 20 })

    const message = probe.posted[0] as { target: PickTarget }
    expect(message.target.shadow).toBe(true)
    expect(message.target.selector).toBe('body > wc-button#go >>> button.inner')
    expect(message.target.html).toBe('<button class="inner">开始</button>')
  })

  it('同类兄弟才补 nth-of-type，超长源码截断并标出来', () => {
    const probe = runProbe()
    const page = makeElement('body')
    const first = nest(page, makeElement('li', { html: '<li>一</li>' }))
    const second = nest(page, makeElement('li', { html: `<li>${'x'.repeat(PICK_SNIPPET_CAP + 50)}</li>` }))
    probe.hitTest(() => second)
    arm(probe)
    probe.fire('mousemove', { clientX: 1, clientY: 1 })
    probe.fire('click', { clientX: 1, clientY: 1 })

    const message = probe.posted[0] as { target: PickTarget }
    expect(message.target.selector).toBe('body > li:nth-of-type(2)')
    expect(message.target.truncated).toBe(true)
    expect(message.target.html).toHaveLength(PICK_SNIPPET_CAP)

    probe.posted.length = 0
    probe.hitTest(() => first)
    arm(probe)
    probe.fire('mousemove', { clientX: 1, clientY: 1 })
    probe.fire('click', { clientX: 1, clientY: 1 })
    expect((probe.posted[0] as { target: PickTarget }).target.selector).toBe('body > li:nth-of-type(1)')
  })
})

describe('注入', () => {
  it('追加在文末、原文一字不动、幂等', () => {
    const risky = '<script>var s = "</body>";run()</script>'
    const out = injectPreviewPicker(risky)
    expect(out.startsWith(risky)).toBe(true)
    expect(out).toContain(`id="${PREVIEW_PICKER_ID}"`)
    expect(injectPreviewPicker(out)).toBe(out)
  })

  it('与父窗口说的是同一套话：信道与动作名都取自同一批常量', () => {
    expect(PREVIEW_PICKER_SOURCE).toContain(PREVIEW_CHANNEL)
    expect(PREVIEW_PICKER_SOURCE).toContain(PICK_KIND)
    expect(PREVIEW_PICKER_SOURCE).toContain(PICK_ESCAPE_KIND)
    expect(PREVIEW_PICKER_SOURCE).toContain(PREVIEW_PICKER_MARK)
    expect(pickOrder(PICK_ENABLE)).toEqual({ channel: PREVIEW_CHANNEL, kind: PICK_ORDER_KIND, action: PICK_ENABLE })
    expect(pickOrder(PICK_DISABLE).action).toBe(PICK_DISABLE)
  })
})

describe('回话当不可信内容读', () => {
  const good = {
    channel: PREVIEW_CHANNEL,
    kind: PICK_KIND,
    target: {
      label: 'div.a',
      selector: 'body > div.a',
      html: '<div class="a"></div>',
      truncated: false,
      shadow: false,
      rect: { left: 1, top: 2, width: 3, height: 4 },
    },
  }

  it('收下一条合法的回话，并且**重建**对象（页面塞进来的键不跟着走）', () => {
    const smuggled = { ...good, target: { ...good.target, extra: 'x', rect: { ...good.target.rect, evil: 1 } } }
    const target = readsPick(smuggled)
    expect(target).toEqual(good.target)
    expect(Object.keys(target as object).sort()).toEqual(['html', 'label', 'rect', 'selector', 'shadow', 'truncated'])
    expect(Object.keys((target as PickTarget).rect).sort()).toEqual(['height', 'left', 'top', 'width'])
  })

  it('拒绝每一条不成形的回话', () => {
    const broken: unknown[] = [
      null,
      'text',
      42,
      {},
      { channel: PREVIEW_CHANNEL, kind: 'local-link', target: good.target },
      { channel: 'x', kind: PICK_KIND, target: good.target },
      { channel: PREVIEW_CHANNEL, kind: PICK_KIND },
      { channel: PREVIEW_CHANNEL, kind: PICK_KIND, target: null },
      { channel: PREVIEW_CHANNEL, kind: PICK_KIND, target: { ...good.target, label: 5 } },
      { channel: PREVIEW_CHANNEL, kind: PICK_KIND, target: { ...good.target, html: undefined } },
      { channel: PREVIEW_CHANNEL, kind: PICK_KIND, target: { ...good.target, truncated: 'yes' } },
      { channel: PREVIEW_CHANNEL, kind: PICK_KIND, target: { ...good.target, shadow: 0 } },
      { channel: PREVIEW_CHANNEL, kind: PICK_KIND, target: { ...good.target, rect: null } },
      { channel: PREVIEW_CHANNEL, kind: PICK_KIND, target: { ...good.target, rect: { left: 1, top: 2, width: 3 } } },
      { channel: PREVIEW_CHANNEL, kind: PICK_KIND, target: { ...good.target, rect: { left: Number.NaN, top: 2, width: 3, height: 4 } } },
      { channel: PREVIEW_CHANNEL, kind: PICK_KIND, target: { ...good.target, rect: { left: 1, top: 2, width: 3, height: Number.POSITIVE_INFINITY } } },
    ]
    for (const data of broken) expect(readsPick(data), JSON.stringify(data)).toBeUndefined()
  })

  it('把过长的字段收到上限（提示词的形状不受页面摆布）', () => {
    const target = readsPick({
      channel: PREVIEW_CHANNEL,
      kind: PICK_KIND,
      target: { ...good.target, label: 'z'.repeat(900), selector: 'z'.repeat(900), html: 'z'.repeat(PICK_SNIPPET_CAP + 500) },
    })
    expect(target?.label).toHaveLength(160)
    expect(target?.selector).toHaveLength(400)
    expect(target?.html).toHaveLength(PICK_SNIPPET_CAP)
  })

  it('Esc 那一发只认自己的信道与种类', () => {
    expect(isPickEscape({ channel: PREVIEW_CHANNEL, kind: PICK_ESCAPE_KIND })).toBe(true)
    expect(isPickEscape({ channel: PREVIEW_CHANNEL, kind: PICK_KIND })).toBe(false)
    expect(isPickEscape({ channel: 'x', kind: PICK_ESCAPE_KIND })).toBe(false)
    expect(isPickEscape(null)).toBe(false)
  })
})

describe('提示词：节点源码嵌进去，改动范围就圈住了', () => {
  const target: PickTarget = {
    label: 'section.hero',
    selector: 'body > main.app > section.hero',
    html: '<section class="hero">\n  <h1>你好</h1>\n</section>',
    truncated: false,
    shadow: false,
    rect: { left: 0, top: 0, width: 10, height: 10 },
  }

  it('给全四样：文件、节点、位置、源码，末尾留出要求那一行', () => {
    const prompt = buildEditPrompt({ file: 'site/index.html', target, request: '' })
    expect(prompt).toContain('site/index.html')
    expect(prompt).toContain('section.hero')
    expect(prompt).toContain('body > main.app > section.hero')
    expect(prompt).toContain('```html\n<section class="hero">\n  <h1>你好</h1>\n</section>\n```')
    // 用户接在「改动要求：」后面写，所以提示词必须**以它收尾**，光标才落得对。
    expect(prompt.endsWith('改动要求：')).toBe(true)
    expect(buildEditPrompt({ file: 'f.html', target, request: '改成蓝色' }).endsWith('改动要求：改成蓝色')).toBe(true)
  })

  it('节点里本来就有反引号时，围栏加长而不是被撑破', () => {
    const fenced: PickTarget = { ...target, html: '<pre>\n```js\nconst a = 1\n```\n</pre>' }
    const prompt = buildEditPrompt({ file: 'a.html', target: fenced, request: '' })
    expect(fenceFor(fenced.html)).toBe('````')
    expect(prompt).toContain('````html')
    // 内层那对三反引号必须原样留在块里，不能提前把块闭上。
    expect(prompt).toContain('```js')
  })

  it('截断与 shadow 各说一句，别让模型自己猜', () => {
    const cut = buildEditPrompt({ file: 'a.html', target: { ...target, truncated: true }, request: '' })
    expect(cut).toContain(String(PICK_SNIPPET_CAP))
    expect(buildEditPrompt({ file: 'a.html', target, request: '' })).not.toContain('shadow DOM')

    const deep = buildEditPrompt({ file: 'a.html', target: { ...target, shadow: true }, request: '' })
    expect(deep).toContain('shadow DOM')
    expect(deep).toContain('>>>')
  })

  it('围栏至少三个反引号', () => {
    expect(fenceFor('<p>没有反引号</p>')).toBe('```')
    expect(fenceFor('`一个`')).toBe('```')
  })
})

describe('提示词框落在哪：纯几何', () => {
  const area = { left: 280, top: 0, width: 1320, height: 1000 }
  const size = { width: PICK_BOX_WIDTH, height: PICK_BOX_HEIGHT }
  const frame = { left: 280, top: 100, width: 1320, height: 900 }

  it('优先落在元素正下方（元素 + 帧 + 缝）', () => {
    const at = placePickBox({ target: { left: 100, top: 200, width: 300, height: 80 }, frame, area, size })
    expect(at).toEqual({ left: 380, top: 388 })
  })

  it('下面放不下就翻到上面', () => {
    const at = placePickBox({ target: { left: 100, top: 700, width: 300, height: 120 }, frame, area, size })
    // 700+100=800 起，下方只剩 200px 不够放 268px 的框 → 翻到元素上方。
    expect(at.top).toBe(700 + 100 - 8 - PICK_BOX_HEIGHT)
  })

  it('上下都放不下时贴住下沿，绝不落出可视区', () => {
    const at = placePickBox({ target: { left: 100, top: 20, width: 300, height: 900 }, frame, area, size })
    expect(at.top + PICK_BOX_HEIGHT).toBeLessThanOrEqual(area.top + area.height - 12)
    expect(at.top).toBeGreaterThanOrEqual(area.top + 12)
  })

  it('右边越界就往回收，收到装不下为止', () => {
    const at = placePickBox({ target: { left: 1200, top: 200, width: 100, height: 40 }, frame, area, size })
    expect(at.left).toBe(area.left + area.width - 12 - PICK_BOX_WIDTH)
    const narrow = placePickBox({
      target: { left: 1200, top: 200, width: 100, height: 40 },
      frame,
      area: { left: 0, top: 0, width: 200, height: 200 },
      size,
    })
    expect(narrow.left).toBe(12)
  })

  it('给的是整数像素（半像素会让边框糊）', () => {
    const at = placePickBox({ target: { left: 10.4, top: 20.6, width: 30.2, height: 40.8 }, frame, area, size })
    expect(Number.isInteger(at.left)).toBe(true)
    expect(Number.isInteger(at.top)).toBe(true)
  })
})
