/**
 * dsh-canvas — 元素选择（F3.14）：页面帧这一侧。
 *
 * 「点页面里的某个元素，然后告诉模型改它」这件事跨着两个地方：**页面里**住着探针（宿主
 * 注入的 `preview-picker.ts`），它只看得见帧内；**这里**住着工具、提示词与这张卡的会话
 * —— 框画在哪、提示词长什么样、发去哪里。而把这两头连起来的那扇窗只有一个：跑着页面的
 * 那个预览器（`viewers/deck-viewer.tsx`）。所以这个 hook 由**它**调用，不再由弹窗外壳代管：
 * 能力（有没有一个能对话的页面帧）就是「谁真的拿着那个 iframe」，不必再声明一次。
 *
 * 它管三样东西：一个开关（`armed`）、一笔选择（`held`）、以及一次投递（`send` + 回读产物）。
 * 三者共享同一套坐标——框锚在用户点的那个元素上，而坐标是**回话那一刻**量到的帧位置——
 * 所以它们不能拆成几个各拿一半的返回值：拆开只会让调用方把两个不同时刻的矩形拼在一起，
 * 圈出来的位置差着一条提示条的高度。
 *
 * 一提的是「一发一收」不对等：单击时探针**吞掉**那次 pointerdown/up/click，页面自己收不到
 * 这一击；而这一击的结果（`describe(node)`）回到父窗口之后，一律按不可信内容重建
 * （`readsPick`）。页面不能自己把选择模式打开，也不能替用户按下发送。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import {
  PICK_BOX_HEIGHT,
  PICK_BOX_WIDTH,
  buildEditPrompt,
  placePickBox,
  type PickRect,
  type PickTarget,
} from '../../../core/artifact/preview-picker.ts'
import type { ArtifactView } from '../../../types.ts'
import type { ArtifactChrome } from '../chrome.tsx'

/** 选中的元素，加上弹窗要围着它画的那些东西。 */
interface HeldPick {
  target: PickTarget
  /** The frame's box at the moment of the pick, in window coordinates. */
  frame: PickRect
  /**
   * The artifact text the pick was made against.
   *
   * Kept so the *held outline* can be withheld when the artifact has been
   * rewritten since: the frame reloads with the new page, the old coordinates
   * point at whatever happens to be there now, and an outline that names the
   * wrong element is worse than none. Compared during render rather than
   * tracked in state — the two facts are both already at hand.
   */
  viewText: string
}

/**
 * 页面帧与探针之间的那条通道（生产者是这里，消费者是持有 iframe 的预览器）。
 *
 * 分得这么细是因为两头看得见的东西不同：这里握着工具、提示词与这张卡的会话，而只有拿着
 * `iframe` 的一方发得出消息（这一侧没有可 post 的窗口）。所以预览器拿到的是三件它能做的
 * 事，没有自己的状态。
 */
export interface PickChannel {
  /** Whether the frame should be picking right now. */
  readonly armed: boolean
  /** A click landed on an element inside the page; `frame` is the frame's own box. */
  onPicked(target: PickTarget, frame: PickRect): void
  /** The page relayed Escape — while armed it holds the keyboard, not the viewer. */
  onEscape(): void
}

export interface ElementPick {
  /** 这个产物有没有可选的页面：payload 完整（这不含「有没有帧」——调用方就是帧主）。 */
  available: boolean
  /** 选择模式开着吗（探针在页面里画不画十字、点不点得动就看它）。 */
  armed: boolean
  /** 手里还攥着一笔选择（框开着）。 */
  holding: boolean
  toggle(): void
  /**
   * 只把模式关掉，手里那一笔不动。
   *
   * 与 {@link toggle} 分开：toggle 是用户按按钮，按下去意味着"这件事我不做了"，
   * 所以它顺手把回话与错误也清掉；而 Esc 要退的是**模式**这一层——框还没开的时候
   * 按 Esc 只该收起十字光标，不该顺手抹掉屏幕上那行"已交给会话"的通知。
   */
  disarm(): void
  clear(): void
  /** 交给预览器（也就是调用方自己）的通道。 */
  channel: PickChannel
  /** 框下方的回话：已交给会话 / 产物已更新。 */
  notice: string
  dismissNotice(): void
  /**
   * 选中圈 + 提示词框，都已在正确的坐标上；没有选择时是 `null`。
   *
   * 作为一个元素交出去（而不是让调用方拿坐标自己摆）是刻意的：圈只在「这一笔还对得上
   * 现在这一页」时画，而那个判断要同时看这一笔和当前 payload——两样都在这里，调用方拿
   * 过去只会再算一遍。
   */
  overlay: ReactElement | null
}

/** 页面帧预览器的元素选择。 */
export function useElementPick(input: { view: ArtifactView; chrome: ArtifactChrome }): ElementPick {
  const { view, chrome } = input
  const { projectId, cardId, bridge, t, revision, areaRef, adopt } = chrome
  const [armed, setArmed] = useState(false)
  const [held, setHeld] = useState<HeldPick | undefined>(undefined)
  /** 提示词框里的全文。节点源码已经嵌在里面，用户接着往下写。 */
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /**
   * 等这张卡的会话把产物改出来。
   *
   * 发了要求之后产物不会立刻变——会话要先跑一轮。这里不是轮询：画布的
   * `revision`（会话域的变动计数）每动一次才回读一次，回读到文本真的变了就收工。
   * 上限是给「会话跑完却没写这个文件」兜底：那时再读下去也只是白读。
   */
  const [awaiting, setAwaiting] = useState(false)
  const awaitReads = useRef(0)
  /** 发出要求时产物的文本——回读到与它不同，才算改动落地。 */
  const awaitingFrom = useRef('')
  /** 提示词框里的 textarea，用来把光标放到末尾（用户接在「改动要求：」后面补写）。 */
  const boxRef = useRef<HTMLTextAreaElement | null>(null)

  /**
   * Whether there is a running page to pick from.
   *
   * 只剩 payload 这一半了：「有没有一个能对话的页面帧」由**调用方就是帧主**这件事回答
   * —— 这个 hook 只可能被跑着 iframe 的预览器调用。剩下要问的是页面够不够完整：读了一半
   * 的页面里，探针报出来的元素，用户接下来的改动要求要对着一段谁也没看全的文本解释。
   */
  const available = view.present && !view.truncated

  /** 工具按钮：开/关元素选择模式。 */
  const toggle = useCallback((): void => {
    setError('')
    setNotice('')
    if (armed) {
      setArmed(false)
      return
    }
    setHeld(undefined)
    setDraft('')
    setArmed(true)
  }, [armed])

  /** 放下这一笔：撤掉高亮与提示词框。 */
  const clear = useCallback((): void => {
    setHeld(undefined)
    setArmed(false)
    setDraft('')
    setError('')
    setNotice('')
  }, [])

  /** 只收起十字光标（Esc 的第一档，见 `ElementPick.disarm`）。 */
  const disarm = useCallback((): void => {
    setArmed(false)
  }, [])

  /**
   * 帧报到「点了这个元素」。
   *
   * 模式同时关掉：一击就是一次选择，探针自己也不再跟随鼠标（页面回话之前它就收起了）。
   * 提示词是**在这里组装**的——节点源码此刻嵌进去，用户接着在末尾写要求，于是「改动范围」
   * 不是他描述出来的，而是这次点击本身。
   */
  const onPicked = useCallback(
    (target: PickTarget, frame: PickRect): void => {
      setArmed(false)
      setError('')
      setNotice('')
      setHeld({ target, frame, viewText: view.text })
      setDraft(buildEditPrompt({ file: cardId, target, request: '' }))
    },
    [cardId, view.text],
  )

  const channel = useMemo<PickChannel>(
    () => ({ armed, onPicked, onEscape: clear }),
    [armed, clear, onPicked],
  )

  /**
   * 把提示词交给这张卡的会话——它才是改文件的那一方。
   *
   * 与画布输入框走同一条通道（`card/sendMessage`，会话不在就顺手开起来），因为「让模型改
   * 这个产物」从来就只有一个入口。发完闭上框、挂一条回话，并开始等产物真的变。
   */
  const send = useCallback((): void => {
    const prompt = draft.trim()
    if (prompt === '' || sending) return
    setSending(true)
    setError('')
    void bridge
      .sendMessage(projectId, cardId, prompt)
      .then(() => {
        awaitingFrom.current = view.text
        awaitReads.current = 0
        setSending(false)
        setHeld(undefined)
        setDraft('')
        setAwaiting(true)
        setNotice(t('canvas.pick.sent'))
      })
      .catch((reason: unknown) => {
        setSending(false)
        setError(reason instanceof Error ? reason.message : t('canvas.error.unknown'))
      })
  }, [bridge, cardId, draft, projectId, sending, t, view.text])

  /**
   * 回读产物，直到它真的变了。
   *
   * 触发源是画布那个「会话域动了」的计数，不是定时器：会话每动一步才读一次，读到文本不同
   * 就收工（`setAwaiting(false)`），并在框的位置说一句「已更新」。上限兜住「跑完了却没写
   * 这个文件」——那时再读下去只是白读。
   */
  useEffect(() => {
    if (!awaiting || revision === undefined || awaitReads.current >= 30) return undefined
    awaitReads.current += 1
    let cancelled = false
    bridge
      .readArtifact(projectId, cardId)
      .then((payload) => {
        if (cancelled) return
        adopt(payload)
        if (payload.text !== awaitingFrom.current) {
          setAwaiting(false)
          setNotice(t('canvas.pick.updated'))
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [adopt, awaiting, bridge, cardId, projectId, revision, t])

  /**
   * 光标落在末尾，并且**末尾那一行看得见**。
   *
   * 用户是接着「改动要求：」往下写的，不该先自己按到行尾；同理，滚动条也不该停在开头——
   * 框里的正文（节点源码）常常比框高，焦点与 `setSelectionRange` 都不会把它滚出来，用户
   * 看到的是一个停在源码中间、要写的那一行在折叠线以下的框。
   */
  useEffect(() => {
    if (held === undefined) return
    const node = boxRef.current
    if (node === null) return
    node.focus()
    node.setSelectionRange(node.value.length, node.value.length)
    node.scrollTop = node.scrollHeight
  }, [held])

  /**
   * 提示词框落在哪：就在刚点的那个元素旁边。
   *
   * 量尺在这里读，是因为框与帧用的是**同一套视口坐标**——帧的位置来自回话那一刻的
   * `getBoundingClientRect`，而遮罩层（`areaRef`）就是「框不许落出去」的那块面积。
   */
  let overlay: ReactElement | null = null
  if (held !== undefined) {
    const holdStyle: CSSProperties = {
      left: `${held.frame.left + held.target.rect.left}px`,
      top: `${held.frame.top + held.target.rect.top}px`,
      width: `${held.target.rect.width}px`,
      height: `${held.target.rect.height}px`,
    }
    const area = areaRef.current?.getBoundingClientRect()
    const at =
      area === undefined
        ? {
            left: held.frame.left + held.target.rect.left,
            top: held.frame.top + held.target.rect.top + held.target.rect.height + 8,
          }
        : placePickBox({
            target: held.target.rect,
            frame: held.frame,
            area: { left: area.left, top: area.top, width: area.width, height: area.height },
            size: { width: PICK_BOX_WIDTH, height: PICK_BOX_HEIGHT },
          })
    const boxStyle: CSSProperties = {
      left: `${at.left}px`,
      top: `${at.top}px`,
      width: `${PICK_BOX_WIDTH}px`,
      height: `${PICK_BOX_HEIGHT}px`,
    }
    // 高亮框只在「这一笔还对得上现在这一页」时画：产物被重写过（帧已经换了一页），旧坐标
    // 指着的是别的东西，圈错人比不圈更糟。
    const holdLive = view.text === held.viewText

    overlay = (
      <>
        {/* 选中的那一圈：帧那边收起高亮之后，由这里把「改哪儿」一直画着——
            探针在页面里，页面一重载就没了；框是这里画的，两者才总是一致。 */}
        {holdLive ? (
          <div className="dsh-canvas-pickhold" style={holdStyle} aria-hidden="true">
            <span className="dsh-canvas-pickhold-tag">{held.target.label}</span>
          </div>
        ) : null}
        <div
          className="dsh-canvas-pickbox"
          style={boxStyle}
          role="dialog"
          aria-label={t('canvas.pick.title')}
        >
          <div className="dsh-canvas-pickbox-head">
            <span className="dsh-canvas-pickbox-tag">{held.target.label}</span>
            <span className="dsh-canvas-pickbox-file">{cardId}</span>
            <span className="dsh-canvas-spacer" />
            <button className="dsh-canvas-chipbtn" onClick={clear} aria-label={t('canvas.action.cancel')}>
              ×
            </button>
          </div>
          <textarea
            ref={boxRef}
            className="dsh-canvas-pickbox-input"
            value={draft}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                send()
              }
            }}
          />
          {error === '' ? null : (
            <div className="dsh-canvas-pickbox-error">{t('canvas.pick.failed', { message: error })}</div>
          )}
          <div className="dsh-canvas-pickbox-foot">
            <span className="dsh-canvas-pickbox-hint">{t('canvas.pick.hint')}</span>
            <button
              className="dsh-canvas-chipbtn"
              data-primary="true"
              disabled={sending || draft.trim() === ''}
              onClick={send}
            >
              {sending ? t('canvas.pick.sending') : t('canvas.pick.send')}
            </button>
          </div>
        </div>
      </>
    )
  }

  return {
    available,
    armed,
    holding: held !== undefined,
    toggle,
    disarm,
    clear,
    channel,
    notice,
    dismissNotice: () => setNotice(''),
    overlay,
  }
}
