/**
 * dsh-canvas — HTML 家族（幻灯片 / 站点 / 应用）共用的页面预览器。
 *
 * 三个 kind 一个预览：入口页的标记跑在一个沙箱 iframe 里。`allow-scripts` 而不给
 * `allow-same-origin` 是那个折中——幻灯片要靠自己的 JS 翻页，而文档待在 opaque
 * origin 里，够不到宿主页面、它的存储和它的 cookie。
 *
 * The two popup permissions are the other half of that compromise, and they are
 * about *links*: a page whose only exit is a link would otherwise be a page you
 * cannot leave. `allow-popups` unblocks `target="_blank"` (without it Chrome
 * refuses with "the request was made in a sandboxed frame whose 'allow-popups'
 * permission is not set"), and `allow-popups-to-escape-sandbox` makes the window
 * that opens a normal one — a sandboxed popup keeps the opaque origin, so the
 * far site would run without its own storage or session. The preview's own
 * frames stay exactly as locked down as before; only the window the *user* asked
 * for is free.
 *
 * `postMessage` from the frame is the one channel left open, and it is treated
 * as untrusted content: the sender is checked against this frame's own window,
 * the shape is checked field by field, and nothing is done with it beyond
 * showing a sentence — the guard injected into the page (`PREVIEW_GUARD_SOURCE`
 * in `core/artifact/webapp.ts`) is what acts, so the viewer never opens anything
 * on a page's say-so.
 *
 * The same channel carries the element picker (F3.14), and it is checked the
 * same way — but the two directions are not symmetrical. The **host injects**
 * the probe into the page's text (`injectPreviewPicker`), and the viewer only
 * ever asks the frame to arm or disarm it; the page cannot arm itself, and a
 * message from any window other than this frame's is dropped. What comes back
 * is read through `readsPick`, which rebuilds the payload from validated fields
 * rather than trusting the page's object.
 *
 * 元素选择的另外半边（工具按钮、选中圈、提示词框、交给会话）也由**这个文件**叫起来
 * （`useElementPick`），因为「有没有一个能对话的页面帧」这个问题只有拿着 iframe 的一方
 * 答得出：帧就是它画的。按钮挂进头部插槽、回话挂进条带插槽、圈与框挂进遮罩层插槽——
 * 弹窗外壳不认识它们，也不需要认识。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { isHtmlKind } from '../../../core/artifact/kind-registry.ts'
import {
  PICK_DISABLE,
  PICK_ENABLE,
  isPickEscape,
  pickOrder,
  readsPick,
} from '../../../core/artifact/preview-picker.ts'
import { PREVIEW_CHANNEL } from '../../../core/artifact/webapp.ts'
import { Slot, useChrome, useEscapeLayer } from '../chrome.tsx'
import { useElementPick } from '../element-pick/element-pick.tsx'
import type { ViewerProps, ViewerRegistration } from './types.ts'

/** 页面预览器：产物在一个沙箱 iframe 里跑起来。 */
export function DeckViewer({ view, t }: ViewerProps) {
  const chrome = useChrome()
  const pick = useElementPick({ view, chrome })
  const frame = useRef<HTMLIFrameElement | null>(null)
  /** The href of a link the guard refused to follow; `''` when there is none. */
  const [blocked, setBlocked] = useState('')
  const channel = pick.channel
  const armed = channel.armed
  /**
   * The latest pick channel, held rather than depended on.
   *
   * The hook hands it over as a memoized object, but the message listener below
   * must not re-subscribe when it moves (that window between unsubscribe and
   * subscribe is a window where a click is lost).
   */
  const channelRef = useRef(channel)
  useEffect(() => {
    channelRef.current = channel
  })
  // A re-read (an edit saved, the card's file written again) replaces the text
  // and reloads the frame; the note belongs to the page that is gone.
  useEffect(() => {
    setBlocked('')
  }, [view.text])
  /**
   * Esc 在帧这边退的是「刚打开的那样东西」：模式开着就收起十字光标，手里攥着一笔就撤掉
   * 那一笔。两者互斥（点完一下模式就关了），所以是一档；而它先于「关掉预览」——退的是刚
   * 打开的那样东西，不是整张预览。
   */
  useEscapeLayer(armed || pick.holding, () => (armed ? pick.disarm() : pick.clear()))
  /**
   * Tell the frame what to be.
   *
   * Run on every text change as well as on `armed`: a reloaded frame starts
   * dormant (the probe is injected into each page as inert), so a viewer that
   * was armed when the artifact was rewritten has to re-arm the page it just
   * received. The message is idempotent on the frame's side.
   */
  const tell = useCallback((): void => {
    const target = frame.current?.contentWindow
    if (target === null || target === undefined) return
    target.postMessage(pickOrder(armed ? PICK_ENABLE : PICK_DISABLE), '*')
  }, [armed])
  useEffect(() => {
    tell()
  }, [tell, view.text])
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const source = frame.current?.contentWindow
      // The frame's own window, not merely *a* frame: a page elsewhere on the
      // host must not be able to put words in this viewer's mouth.
      if (source === null || source === undefined || event.source !== source) return
      const data = event.data as { channel?: unknown; kind?: unknown; href?: unknown } | null
      if (typeof data !== 'object' || data === null) return
      if (data.channel !== PREVIEW_CHANNEL) return
      if (isPickEscape(data)) {
        channelRef.current.onEscape()
        return
      }
      const target = readsPick(data)
      if (target === undefined) {
        if (data.kind !== 'local-link') return
        if (typeof data.href !== 'string') return
        setBlocked(data.href.slice(0, 200))
        return
      }
      const box = frame.current?.getBoundingClientRect()
      if (box === undefined) return
      channelRef.current.onPicked(target, { left: box.left, top: box.top, width: box.width, height: box.height })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  return (
    <>
      <Slot at="header">
        {pick.available ? (
          // 元素选择（F3.14）：按下去，页面里的鼠标就成了一支「点哪儿选哪儿」的笔。
          // 是切换按钮，所以状态由 aria-pressed 与那点实心色说，不去改按钮上的字。
          <button
            type="button"
            className="dsh-canvas-chipbtn dsh-canvas-picktool"
            data-on={armed ? 'true' : 'false'}
            aria-pressed={armed}
            title={t('canvas.pick.tool')}
            onClick={pick.toggle}
          >
            {t('canvas.pick.tool')}
          </button>
        ) : null}
      </Slot>
      <Slot at="banner">
        {pick.notice === '' ? null : (
          // 元素选择的回话：发出去是一件事、产物真的变了是另一件事，两句话都说出来，
          // 否则用户关掉框之后无从知道刚才那一下有没有发生。
          <div className="dsh-canvas-viewer-picked">
            <span className="dsh-canvas-viewer-notetext">{pick.notice}</span>
            <span className="dsh-canvas-spacer" />
            <button
              className="dsh-canvas-chipbtn"
              onClick={pick.dismissNotice}
              aria-label={t('canvas.action.collapse')}
            >
              ×
            </button>
          </div>
        )}
      </Slot>
      {/* 帧区是**一个定位上下文**：提示条要么排在流里（链接闸门那条，它说的是页面自己
          的事）、要么浮在上面（选择模式那条），两者的区别见下面那处注释。 */}
      <div className="dsh-canvas-frame-area">
        {blocked === '' ? null : (
          <div className="dsh-canvas-frame-note">
            <span className="dsh-canvas-frame-notetext">{t('canvas.viewer.linkBlocked', { href: blocked })}</span>
            <button
              className="dsh-canvas-chipbtn"
              onClick={() => setBlocked('')}
              aria-label={t('canvas.viewer.linkBlocked.dismiss')}
            >
              ×
            </button>
          </div>
        )}
        {armed ? (
          // 探针在页面里画的是「鼠标底下是谁」，这句话说的是「接下来会发生什么」——
          // 用户按下按钮之后如果只在页面里看到一个十字光标，没人告诉他这一击不会
          // 真的按到那个按钮上。
          //
          // **它浮在帧上，不占排版位**（`.dsh-canvas-frame-note.is-pick` 是 absolute）：
          // 这条提示只在选择模式下活着，而一次选择结束（回话一到）模式就关了，于是它
          // 会**在单击的同一刻消失**。若它排在流里，那一瞬帧会被顶上 35px，而高亮框与
          // 提示词框用的是回话那一刻量到的帧坐标——圈出来的位置会比用户点的元素低一整条
          // 提示条的高度。页面不该因为我们的提示条而挪动，这是同一条判据。
          <div className="dsh-canvas-frame-note is-pick">
            <span className="dsh-canvas-frame-notetext">{t('canvas.pick.armed')}</span>
          </div>
        ) : null}
        <iframe
          ref={frame}
          className="dsh-canvas-frame"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          srcDoc={view.text}
          title={view.cardId}
          onLoad={tell}
        />
      </div>
      {/* 选中圈与提示词框：位置是视口的，落点归遮罩层（`areaRef` 量的就是它）。 */}
      <Slot at="overlay">{pick.overlay}</Slot>
    </>
  )
}

/**
 * 注册项：HTML 家族（幻灯片 / 站点 / 应用）共用同一个 iframe 预览。
 *
 * `claims` 直接拿 `isHtmlKind` —— kind 清单只有一份，在宿主的
 * `core/artifact/kind-registry.ts`。这条从前是两份手抄的清单，而「漏掉一个 kind」的后果
 * 之一正是某个 HTML 产物丢了它的样式表。
 *
 * 「有页面帧所以能做元素选择」不再是这里的一条声明：帧就是上面那个组件画的，所以元素选择
 * 的工具与状态也住在同一条记录里（`useElementPick`）。注册项只剩下认领哪些 kind。
 */
export const deckViewer: ViewerRegistration = {
  id: 'deck',
  component: DeckViewer,
  claims: isHtmlKind,
}
