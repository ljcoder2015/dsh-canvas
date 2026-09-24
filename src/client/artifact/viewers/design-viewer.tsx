/**
 * dsh-canvas — 设计预览器（F2.6；P4 编辑闭环，P4.5 双模式 + 编辑面板）。
 *
 * 右上角「预览 / 编辑」模式切换：
 * - 预览模式：只有视口手势（拖拽平移 / 滚轮缩放 / WASD·QE）与 HUD，无选中
 *   高亮、无面板——交付查看的干净画面。
 * - 编辑模式：左右两栏面板（React 改写自 @open-pencil/vue 的 pages/layers/
 *   properties 三块 UI，见 design-panels.tsx），画布交互（点选/拖移/删除/
 *   undo）照旧，改稿经 `bridge.writeText` 写回 `.design` 文件。
 *
 * 视口住在 ref 里（拖拽直接改、直接重画，不付 React 渲染）；「用户动过没有」
 * 这一位决定面板尺寸变化后要不要重新 zoom-to-fit。选中、模式与面板数据是
 * React 状态——它们的变更频率是「一次手势」，不是「一帧」。
 *
 * 写回节律沿用 `editing/autosave.ts` 的停手期时钟：改稿序列化成信封文本，
 * 停手 800ms 后落盘；写成功后回读 adopt——**自己写的回声**（view.text ===
 * 刚写入的文本）不再重建引擎，选中与镜头都保得住；别人的改动（模型经
 * `canvas_design_edit`）才会触发重建。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ViewerProps, ViewerRegistration } from './types.ts'
import { useChrome, Slot } from '../chrome.tsx'
import { autosaveDelay, autosaveRetryDelay } from '../editing/autosave.ts'
import { ASSET_BASE, loadCanvasKit } from './design-canvaskit.ts'
import { DESIGN_SIDE_CLASS, DesignSidePanels } from './design-panels.tsx'
import type {
  CreateDesignEngineArgs,
  DesignEngine,
  DesignSnapshot,
  DesignViewport,
  EngineOutcome,
} from './design-engine-types.ts'

/** The viewer's honest states: engine loading, failed, live. */
type DesignState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' }

/** 右上角的模式开关：预览（纯查看）与编辑（面板 + 画布编辑）。 */
type DesignMode = 'preview' | 'edit'

/** Wheel zoom limits — a zoom-to-fit never needs to leave this band. */
const ZOOM_MIN = 0.05
const ZOOM_MAX = 8

/** 改稿落盘前的停手期（复用文本编辑的节律）。 */
const SAVE_SETTLE_MS = 800

/**
 * 设计卡聚焦时**归设计**的键：与背后画布的快捷键（window 级监听）正面相撞的那一批。
 * onKeyDown 里对这些键 stopPropagation——按键已经消化在设计自己的视口手势里，
 * 不许隔着弹窗再把背后的画布推走缩走。Esc 不在此列：弹窗靠它关闭，必须放行。
 */
const DESIGN_KEYS = new Set([' ', 'w', 'a', 's', 'd', 'q', 'e', 'delete', 'backspace'])

/** The engine chunk's shape — the module is loaded by URL, typed here. */
interface DesignEngineModule {
  createDesignEngine(args: CreateDesignEngineArgs): Promise<EngineOutcome>
}

/** Single-flight module load by URL; `null` when the chunk cannot be fetched. */
let engineModule: Promise<DesignEngineModule | null> | undefined
function loadDesignEngine(): Promise<DesignEngineModule | null> {
  engineModule ??= import(`${ASSET_BASE}/design-engine.js`)
    .then((module) => module as DesignEngineModule)
    .catch(() => null)
  return engineModule
}

export function DesignViewer({ view }: ViewerProps) {
  const chrome = useChrome()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<DesignState>({ kind: 'loading' })

  // The viewport lives in a ref: pan/zoom mutate it and redraw directly, so a
  // drag never pays a React render per pointer event. `interacted` decides
  // whether a panel resize re-fits or preserves where the user put the camera.
  const viewportRef = useRef<DesignViewport | null>(null)
  const interactedRef = useRef(false)
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  // 节点拖移：与视口平移共用 pointer 流，靠哪个 ref 在场区分。
  const moveRef = useRef<{ pointerId: number; sx: number; sy: number } | null>(null)
  const engineRef = useRef<DesignEngine | null>(null)
  // `draw` re-creates on state change; the engine's repaint callbacks need the
  // latest one without re-subscribing.
  const drawRef = useRef<() => void>(() => {})
  // HUD 缩放百分比走 ref 直写：拖拽/滚轮/快捷键每帧都动视口，不该为改一个
  // 文本付 React 渲染。
  const zoomLabelRef = useRef<HTMLSpanElement | null>(null)
  // 写回：最后同步到盘上的信封文本（识别「自己的回声」）、节流时钟与失败计数。
  const lastSyncedRef = useRef<string | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const saveFailuresRef = useRef(0)
  const onDirtyRef = useRef<() => void>(() => {})

  // 选中、模式与面板版本是 React 状态：变更频率是「一次手势」而非「一帧」。
  const [editVersion, setEditVersion] = useState(0)
  const [mode, setMode] = useState<DesignMode>('preview')
  // 手势/键盘回调里的模式判断走 ref：不必为模式切换重挂监听器。
  const modeRef = useRef<DesignMode>('preview')
  modeRef.current = mode
  // 编辑模式的抓手开关（空格）。ref 供 pointerdown 即时判断，state 只驱动光标。
  const spaceRef = useRef(false)
  const [spaceHeld, setSpaceHeld] = useState(false)

  const refreshSelection = useCallback(() => {
    const engine = engineRef.current
    if (engine === null) return
    // 图层面板的高亮跟着选中走——选中变了面板也要重渲染。
    setEditVersion((version) => version + 1)
  }, [])

  /** 模式切换：进预览先清选中（预览画面不带高亮），进编辑交还 React 重渲染。 */
  const switchMode = useCallback(
    (next: DesignMode) => {
      setMode(next)
      // 预览模式没有编辑交互：清悬停、清选中。
      engineRef.current?.hover(null)
      if (next === 'preview') {
        engineRef.current?.select([], false)
        drawRef.current()
      }
      // 焦点交还画布：模式开关长在 header（wrap 之外），点击后焦点留在那个按钮上，
      // 下一按 WASD 既不归设计也不归弹窗正文——把焦点收回 wrap，快捷键立刻归位。
      wrapRef.current?.focus()
    },
    [],
  )

  // (Re)build the engine whenever the payload changes — unless the change is
  // our own write echoed back (见文件头)。 Absent artifacts, truncated
  // envelopes and unloadable chunks are honest error states.
  useEffect(() => {
    if (view.text === lastSyncedRef.current) return
    lastSyncedRef.current = null
    viewportRef.current = null
    interactedRef.current = false
    engineRef.current?.dispose()
    engineRef.current = null
    if (!view.present || view.text === '') {
      setState({ kind: 'error', message: view.present ? '设计文档为空或被截断，无法渲染。' : '这份设计还没有内容。' })
      return
    }
    setState({ kind: 'loading' })
    let cancelled = false
    void (async () => {
      // Both loads are independent: the WASM runtime and the 2MB engine chunk.
      const [runtime, module] = await Promise.all([loadCanvasKit(), loadDesignEngine()])
      const twoD = canvasRef.current
      const gl = glCanvasRef.current
      const wrap = wrapRef.current
      if (cancelled || module === null || twoD === null || gl === null || wrap === null) {
        if (!cancelled) setState({ kind: 'error', message: '设计预览引擎加载失败，请刷新页面重试。' })
        return
      }
      // Size the GL canvas *before* surface creation — the surface binds to
      // the device-pixel size at birth; the engine re-sizes on later paints.
      const dpr = window.devicePixelRatio || 1
      gl.width = Math.round(wrap.clientWidth * dpr)
      gl.height = Math.round(wrap.clientHeight * dpr)
      const outcome = await module.createDesignEngine({
        twoD,
        gl,
        runtime,
        envelope: view.text,
        onRepaint: () => drawRef.current(),
      })
      if (cancelled) {
        if (outcome.kind === 'ready') outcome.engine.dispose()
        return
      }
      if (outcome.kind === 'error') {
        setState({ kind: 'error', message: outcome.message })
        return
      }
      engineRef.current = outcome.engine
      lastSyncedRef.current = view.text
      setState({ kind: 'ready' })
    })()
    return () => {
      cancelled = true
    }
  }, [view.present, view.text])

  // Release the engine when the viewer goes away.
  useEffect(() => {
    return () => {
      engineRef.current?.dispose()
      engineRef.current = null
    }
  }, [])

  const draw = useCallback(() => {
    const engine = engineRef.current
    const wrap = wrapRef.current
    if (engine === null || wrap === null) return
    const width = wrap.clientWidth
    const height = wrap.clientHeight
    const dpr = window.devicePixelRatio || 1
    if (width === 0 || height === 0) return
    // Never fitted, or the user has not taken the camera yet (a resize should
    // keep the document framed): zoom-to-fit.
    if (viewportRef.current === null || !interactedRef.current) {
      viewportRef.current = engine.fit(width, height)
    }
    engine.render(viewportRef.current, width, height, dpr)
    const label = zoomLabelRef.current
    if (label !== null) label.textContent = `${Math.round(viewportRef.current.scale * 100)}%`
  }, [])
  drawRef.current = draw

  const flushSave = useCallback(async (): Promise<void> => {
    const engine = engineRef.current
    if (engine === null) return
    const envelope = engine.serialize()
    try {
      await chrome.bridge.writeText(chrome.projectId, chrome.cardId, envelope)
      saveFailuresRef.current = 0
      const payload = await chrome.bridge.readArtifact(chrome.projectId, chrome.cardId)
      // 回读先于 adopt 记下同步点：adopt 触发的 view.text 更新会命中 build
      // effect 的「自己的回声」早退，引擎与选中都原地保住。
      lastSyncedRef.current = payload.text
      chrome.adopt(payload)
      chrome.saved()
    } catch {
      // 写被拒：按退避重试（复用文本编辑的时钟），失败计数驱动间隔。
      saveFailuresRef.current += 1
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null
        void flushSave()
      }, autosaveRetryDelay(saveFailuresRef.current))
    }
  }, [chrome])

  // 改稿 → 停手期落盘。挂在 ref 上：headless editor 的 history:changed 回调
  // 只注册一次，但永远调到最新一份（draw/flushSave 都是后定义的闭包）。
  onDirtyRef.current = () => {
    if (saveTimerRef.current === null) {
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null
        void flushSave()
      }, autosaveDelay(0, SAVE_SETTLE_MS))
    }
    draw()
    refreshSelection()
    setEditVersion((version) => version + 1)
  }

  // 引擎就绪后订阅 headless editor 的历史变更：undo/redo/命令提交都从这走。
  useEffect(() => {
    const engine = engineRef.current
    if (engine === null || state.kind !== 'ready') return
    return engine.onDirty(() => onDirtyRef.current())
  }, [state])

  /** 视口中心（HUD 按钮、Q/E 快捷键的缩放锚点）。 */
  const viewCenter = useCallback(() => {
    const wrap = wrapRef.current
    return wrap === null ? { x: 0, y: 0 } : { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 }
  }, [])

  /** 把缩放调到 `targetScale`，以 (`cx`,`cy`) 为锚——锚点下的世界坐标保持不动。 */
  const zoomAt = useCallback(
    (cx: number, cy: number, targetScale: number) => {
      const viewport = viewportRef.current
      if (viewport === null) return
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, targetScale))
      const applied = next / viewport.scale
      if (applied === 1) return
      viewport.x = cx - (cx - viewport.x) * applied
      viewport.y = cy - (cy - viewport.y) * applied
      viewport.scale = next
      interactedRef.current = true
      draw()
    },
    [draw],
  )

  /** 快速居中：zoom-to-fit 并把镜头决定权交还用户（此后 resize 不再重置）。 */
  const fitView = useCallback(() => {
    const engine = engineRef.current
    const wrap = wrapRef.current
    if (engine === null || wrap === null) return
    viewportRef.current = engine.fit(wrap.clientWidth, wrap.clientHeight)
    interactedRef.current = true
    draw()
  }, [draw])

  // First frame + redraw on size changes; the wrapper, not the canvas, carries
  // the layout.
  useEffect(() => {
    const wrap = wrapRef.current
    if (wrap === undefined || wrap === null) return
    draw()
    const observer = new ResizeObserver(() => draw())
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [state, draw])

  // 指针三态：预览模式按住即平移；编辑模式鼠标默认是「选元素」——按住空格才
  // 变抓手平移（Figma 语义），打空且没按空格 = 取消选中，不拖动画布。两种
  // 手势共用 pointer capture，光标离面板也不丢。
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || engineRef.current === null) return
      const engine = engineRef.current
      const wrap = wrapRef.current
      if (wrap === null) return
      engine.hover(null)
      const rect = wrap.getBoundingClientRect()
      const sx = event.clientX - rect.left
      const sy = event.clientY - rect.top
      const viewport = viewportRef.current
      // 编辑模式 + 空格按住 → 跳过选择逻辑，直接进入平移。
      const panning = modeRef.current === 'preview' || spaceRef.current
      if (!panning && modeRef.current === 'edit' && viewport !== null) {
        const hit = engine.pick(sx, sy, viewport)
        if (hit !== null) {
          const current = engine.selection()
          if (event.shiftKey) engine.select([hit], true)
          else if (!current.includes(hit)) engine.select([hit], false)
          engine.beginMove()
          event.currentTarget.setPointerCapture(event.pointerId)
          moveRef.current = { pointerId: event.pointerId, sx, sy }
          event.currentTarget.classList.add('is-panning')
          draw()
          refreshSelection()
          return
        }
        if (!event.shiftKey) {
          engine.select([], false)
          draw()
          refreshSelection()
        }
        // 编辑模式打空：只取消选中，不拖画布。
        return
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      event.currentTarget.classList.add('is-panning')
    },
    [draw, refreshSelection],
  )
  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const wrap = wrapRef.current
      if (wrap === null) return
      const move = moveRef.current
      if (move !== null && move.pointerId === event.pointerId) {
        const engine = engineRef.current
        const viewport = viewportRef.current
        if (engine === null || viewport === null || viewport.scale <= 0) return
        const rect = wrap.getBoundingClientRect()
        // 拖移量换算成世界单位；节点 x/y 相对父级，父级不动时 Δ世界 = Δ相对。
        engine.nudgeSelection(
          (event.clientX - rect.left - move.sx) / viewport.scale,
          (event.clientY - rect.top - move.sy) / viewport.scale,
        )
        draw()
        return
      }
      const drag = dragRef.current
      const viewport = viewportRef.current
      // 编辑模式悬停高亮（无按键按下时）：跟随指针 pick 最深可选中节点
      // （hitTestDeep，含子图层），hover 变化引擎内部自查、只重画一次。
      if (modeRef.current === 'edit' && moveRef.current === null && dragRef.current === null && !spaceRef.current) {
        const engine = engineRef.current
        if (engine !== null && viewport !== null) {
          const rect = wrap.getBoundingClientRect()
          engine.hover(engine.pick(event.clientX - rect.left, event.clientY - rect.top, viewport))
        }
      }
      if (drag === null || viewport === null || drag.pointerId !== event.pointerId) return
      viewport.x += event.clientX - drag.x
      viewport.y += event.clientY - drag.y
      drag.x = event.clientX
      drag.y = event.clientY
      interactedRef.current = true
      draw()
    },
    [draw],
  )
  const endPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const move = moveRef.current
      if (move !== null && move.pointerId === event.pointerId) {
        moveRef.current = null
        event.currentTarget.classList.remove('is-panning')
        // 原地点击（没真拖动）时 endMove 内部不压 undo。
        engineRef.current?.endMove()
        engineRef.current?.hover(null)
        draw()
        return
      }
      if (dragRef.current?.pointerId !== event.pointerId) return
      dragRef.current = null
      event.currentTarget.classList.remove('is-panning')
    },
    [draw],
  )

  // Wheel zooms around the cursor. Native listener, `passive: false` — React's
  // onWheel cannot preventDefault reliably, and a preview must not scroll the
  // page under the user's fingers.
  //
  // 但滚轮落在左右侧栏上时**原样放过**：图层树与属性表自己就是滚动容器，这一滚
  // 是给那份列表的。放过＝不 preventDefault（默认动作被拦，列表就再也滚不动
  // 了）也不缩放。判断只能做在这一层：原生监听挂在 wrap 上，事件先流经它再走到
  // React 根，面板里 React 的 stopPropagation 拦不住自己上方的原生监听。
  useEffect(() => {
    const wrap = wrapRef.current
    if (wrap === null) return
    const onWheel = (event: WheelEvent) => {
      const viewport = viewportRef.current
      if (viewport === null || engineRef.current === null) return
      if (event.target instanceof Element && event.target.closest(`.${DESIGN_SIDE_CLASS}`) !== null) return
      event.preventDefault()
      const rect = wrap.getBoundingClientRect()
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, viewport.scale * Math.exp(-event.deltaY * 0.0015))
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // 键盘（跟画布聚焦走，监听挂在画布元素上——画板上可能同时亮着多张设计卡）：
  // WASD 连续平移（rAF 循环）、Q/E 离散缩放、Delete 删除、Esc 取消选中、
  // ⌘/Ctrl+Z（+Shift）撤销/重做。
  useEffect(() => {
    const wrap = wrapRef.current
    if (wrap === null || state.kind !== 'ready') return
    const held = new Set<string>()
    let raf = 0
    let last = 0
    /** 平移速度：css 像素/秒——按住一秒横穿半个面板的手感。 */
    const PAN_SPEED = 480
    const ZOOM_STEP = 1.25
    const step = (now: number) => {
      const viewport = viewportRef.current
      if (viewport === null || held.size === 0) {
        raf = 0
        return
      }
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      let dx = 0
      let dy = 0
      if (held.has('a')) dx -= 1
      if (held.has('d')) dx += 1
      if (held.has('w')) dy -= 1
      if (held.has('s')) dy += 1
      viewport.x += dx * PAN_SPEED * dt
      viewport.y += dy * PAN_SPEED * dt
      interactedRef.current = true
      draw()
      raf = requestAnimationFrame(step)
    }
    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      const key = event.key.toLowerCase()
      // 归设计的键拦在冒泡路上：设计卡聚焦时，画布那套 window 级 WASD/QE/空格
      // 监听不能隔着弹窗再收一遍（否则按住 W，背后的画布跟着平移）。Esc 例外——
      // 弹窗的关闭就靠它，拦了弹窗就关不上了。
      if (!event.ctrlKey && !event.metaKey && !event.altKey && DESIGN_KEYS.has(key)) {
        event.stopPropagation()
      }
      // 编辑类快捷键（undo/删除/Esc）只在编辑模式生效；预览模式保留视口手势。
      const editing = modeRef.current === 'edit'
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        if (editing && key === 'z') {
          event.preventDefault()
          const engine = engineRef.current
          if (engine === null) return
          if (event.shiftKey) engine.redo()
          else engine.undo()
          draw()
          refreshSelection()
        }
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // 空格 = 编辑模式的抓手：按下即把下一笔 pointerdown 判成平移。
      // preventDefault 挡掉长画布滚动的默认行为。
      if (key === ' ') {
        event.preventDefault()
        if (!spaceRef.current) {
          spaceRef.current = true
          setSpaceHeld(true)
        }
        return
      }
      if (key === 'q' || key === 'e') {
        event.preventDefault()
        if (event.repeat) return
        const center = viewCenter()
        zoomAt(center.x, center.y, (viewportRef.current?.scale ?? 1) * (key === 'e' ? ZOOM_STEP : 1 / ZOOM_STEP))
        return
      }
      if (editing && (key === 'delete' || key === 'backspace')) {
        event.preventDefault()
        engineRef.current?.deleteSelection()
        return
      }
      if (editing && key === 'escape') {
        engineRef.current?.select([], false)
        draw()
        refreshSelection()
        return
      }
      if (!'wasd'.includes(key) || key === '') return
      event.preventDefault()
      held.add(key)
      if (raf === 0) {
        last = performance.now()
        raf = requestAnimationFrame(step)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        spaceRef.current = false
        setSpaceHeld(false)
        return
      }
      held.delete(event.key.toLowerCase())
    }
    const onBlur = () => {
      held.clear()
      // 抓手键也得跟着清——不然焦点走后 spaceRef 卡在按住态。
      spaceRef.current = false
      setSpaceHeld(false)
    }
    wrap.addEventListener('keydown', onKeyDown)
    wrap.addEventListener('keyup', onKeyUp)
    wrap.addEventListener('blur', onBlur)
    return () => {
      wrap.removeEventListener('keydown', onKeyDown)
      wrap.removeEventListener('keyup', onKeyUp)
      wrap.removeEventListener('blur', onBlur)
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [state, draw, zoomAt, viewCenter, refreshSelection])

  // 卸载时收掉挂着的落盘时钟。
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    }
  }, [])

  const engine = engineRef.current
  // 面板数据是「拉」的：每次 React 渲染时从引擎现取快照（图小，不贵），
  // 变更由 onDirty / refreshSelection 的 editVersion bump 驱动重渲染。
  const snapshot: DesignSnapshot | null =
    state.kind === 'ready' && engine !== null && mode === 'edit' ? engine.snapshot() : null

  return (
    <>
      {/* 模式开关长在弹窗 header（× 左侧）。**必须挂在画布 wrap 之外**：Slot 的
          内容沿 React 树冒泡，会吃到 wrap 的 onPointerDown——画布一
          setPointerCapture，click 就落在捕获元素上，按钮永远收不到点击。 */}
      {state.kind === 'ready' ? (
        <Slot at="header">
          {/* 与 markdown 编辑面同一副开关（dsh-canvas-modeswitch）：radio 语义，
              aria-checked 直接说明「现在在哪一面」。 */}
          <div className="dsh-canvas-modeswitch" role="radiogroup" aria-label="设计预览模式">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'preview'}
              tabIndex={mode === 'preview' ? 0 : -1}
              className="dsh-canvas-modeswitch-opt"
              title="预览模式：查看画面，快捷键平移缩放"
              onClick={() => switchMode('preview')}
            >
              预览
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'edit'}
              tabIndex={mode === 'edit' ? 0 : -1}
              className="dsh-canvas-modeswitch-opt"
              title="编辑模式：页面 / 图层 / 属性面板，画布点选拖移"
              onClick={() => switchMode('edit')}
            >
              编辑
            </button>
          </div>
        </Slot>
      ) : null}
      <div
        ref={wrapRef}
        className={`dsh-canvas-design${mode === 'edit' ? ' is-editing' : ''}${mode === 'edit' && spaceHeld ? ' is-space' : ''}`}
        tabIndex={0}
        onPointerDown={(event) => {
          // 键盘快捷键（WASD/QE）跟聚焦走：点一下画布就把焦点拿到手。
          event.currentTarget.focus()
          onPointerDown(event)
        }}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={() => engineRef.current?.hover(null)}
      >
        <canvas ref={canvasRef} />
        {/* The GL canvas mounts with the doc (the Skia surface needs the element),
            but stays invisible until the engine flips it on after first paint. */}
        <canvas ref={glCanvasRef} style={{ visibility: 'hidden' }} />
        {snapshot !== null && engine !== null ? (
        <DesignSidePanels
          snapshot={snapshot}
          engine={engine}
          onAction={onDirtyRef.current}
          revision={editVersion}
        />
      ) : null}
      {state.kind === 'ready' ? (
        <div className="dsh-canvas-design-hud" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" title="缩小" aria-label="缩小" onClick={() => {
            const center = viewCenter()
            zoomAt(center.x, center.y, (viewportRef.current?.scale ?? 1) / 1.25)
          }}>
            −
          </button>
          <button type="button" className="dsh-canvas-design-hud-pct" title="点击回到 100%" onClick={() => {
            const center = viewCenter()
            zoomAt(center.x, center.y, 1)
          }}>
            <span ref={zoomLabelRef}>100%</span>
          </button>
          <button type="button" title="放大" aria-label="放大" onClick={() => {
            const center = viewCenter()
            zoomAt(center.x, center.y, (viewportRef.current?.scale ?? 1) * 1.25)
          }}>
            ＋
          </button>
          <button type="button" title="居中显示全部画板" onClick={fitView}>
            适应
          </button>
          <span className="dsh-canvas-design-hud-hint">
            {mode === 'edit' ? '点选拖移 · 空格+拖动平移 · Q/E 缩放' : 'WASD 平移 · Q/E 缩放'}
          </span>
        </div>
      ) : null}
      {state.kind === 'error' ? (
        <div className="dsh-canvas-design-note">{state.message}</div>
      ) : null}
      </div>
    </>
  )
}

/**
 * 注册项：认领 `design` kind。编辑面长在组件里；外壳（chrome 插槽与协商）
 * 待选择能力稳定后再按 F3.14 的路数挂头部按钮。
 */
export const designViewer: ViewerRegistration = {
  id: 'design',
  component: DesignViewer,
  claims: (kind) => kind === 'design',
}
