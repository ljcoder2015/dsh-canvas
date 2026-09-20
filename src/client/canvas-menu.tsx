/**
 * dsh-canvas — 画布行的右键动作（F1.8）。
 *
 * 画布列表里的一条画布需要两个「关于这张画布本身」的动作，而它们都不属于画布
 * 面板内部：**打开画布目录**（把这台机器上的文件夹交给系统文件管理器）与**删除
 * 画布**（把这张画布从列表里移开，磁盘一个字节都不动）。行上再放第二枚按钮会把
 * 左栏挤成按钮墙（同 F1.5 里舍弃「一个画布一行按钮」的理由），所以它们住在右键
 * 菜单里——一个动作只在被找的时候露面。
 *
 * 三件事在这里定：
 *
 * - **打开目录走宿主的「在应用中打开」路由**（`/open-in-app/open`）。宿主自己那套
 *   探测（哪个应用在这台机器上真的存在、按平台过滤）已经做好了，插件再走一遍
 *   `spawn` 是重复劳动，也没有必要自己判断当前是 macOS 还是 Windows。代价是这
 *   条路由**可能不存在**（裸组合、没装 `dsh-host-open-in-app` 的部署），所以那是
 *   一次探测：探测不到就把这一项整条藏起来，而不是给出一枚点了会报错的按钮。
 * - **删除只删画布**。`canvas/removeProject` 的语义是「忘掉这张画布」——卡片座次、
 *   取材关系、笔记一起消失，磁盘上的文件夹与文件原样保留。文案必须把这一点说在
 *   前头：这是用户右键删除时最怕的那件事。
 * - **菜单位置由视口兜底**。菜单是 `position:fixed` 挂在 body 上的（画布行在宿主
 *   侧栏里，那里有 overflow 与 transform，挂在行内会被裁），所以贴边时要自己翻
 *   回来，否则右键画布列表最下面那张时菜单会有一半在屏幕外。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Project } from '../types.ts'
import type { CanvasBridge } from './bridge.ts'
import type { Translate } from './locales.ts'

/** 宿主「在应用中打开」路由（见 `@deepseek-ai/dsh-host-open-in-app` 的 shared）。 */
const OPEN_IN_APP_APPS = '/open-in-app/apps'
const OPEN_IN_APP_OPEN = '/open-in-app/open'

/**
 * 「文件管理器」在各平台的目录标识。
 *
 * 宿主只报出与自己平台相符的那一个（darwin/finder、win32/explorer、linux/
 * filemanager），所以这里是一位候选表而不是一张平台表——插件不需要知道自己是
 * 跑在哪个系统上，问宿主要答案比猜平台稳。
 */
export const FILE_MANAGER_APPS = ['finder', 'explorer', 'filemanager'] as const

/**
 * 这份可用应用清单里的文件管理器；一个都没有时返回空串。
 *
 * 空串是「这台部署打不开目录」（路由不在、或系统里连 xdg-open 都没有），调用点
 * 据此把「打开画布目录」整条藏掉。
 *
 * @param apps - 宿主报出的可用应用标识。
 * @returns 可用的文件管理器标识，没有则 `''`。
 */
export function fileManagerOf(apps: readonly string[]): string {
  return FILE_MANAGER_APPS.find((id) => apps.includes(id)) ?? ''
}

/** 菜单在视口里的落点。`margin` 是贴边时留出的空隙。 */
export interface MenuPlacement {
  left: number
  top: number
}

/**
 * 右键落点 → 菜单落点，四条边都夹在视口内。
 *
 * 优先贴指针（右键菜单的手感全在「菜单就在手指边上」），只有空间不够时才让开：
 * 先按右下方向摆，越过视口边界就整体收回来。收回来时不翻到指针左边——菜单盖住
 * 指针会把「刚点的是哪一行」也一起盖掉，而列表最下面一行恰恰是最需要看清的那行。
 *
 * @param x - 指针的视口横坐标。
 * @param y - 指针的视口纵坐标。
 * @param width - 菜单宽度（先渲染后量出来）。
 * @param height - 菜单高度。
 * @param viewportWidth - 视口宽度。
 * @param viewportHeight - 视口高度。
 * @param margin - 与视口边缘的最小距离。
 * @returns 菜单左上角的视口坐标。
 */
export function placeMenu(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  margin: number = 8,
): MenuPlacement {
  const clamp = (value: number, max: number): number => Math.max(margin, Math.min(value, Math.max(margin, max)))
  return {
    left: clamp(x, viewportWidth - width - margin),
    top: clamp(y, viewportHeight - height - margin),
  }
}

/**
 * 页面的基准地址。
 *
 * 与宿主自己的客户端同一条规矩：来自 `file:` 之类的嵌入上下文里 `origin` 是字符串
 * `"null"`，那时 `new URL('/open-in-app/apps', 'null')` 会抛错，所以退到一个固定的
 * 主机名——这条路径只在嵌入场景里走，相对地址在那里本来也没有意义。
 */
function hostBase(): string {
  const origin = globalThis.location?.origin
  return origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
}

/** 本页读到过的可用应用；探测在宿主侧要跑一遍应用定位，每页读一次就够。 */
let applications: Promise<readonly string[]> | undefined

/** 宿主这台机器上可用的应用标识（读不到时是空表，不是异常）。 */
export function availableApps(): Promise<readonly string[]> {
  applications ??= fetch(new URL(OPEN_IN_APP_APPS, hostBase()), { headers: { accept: 'application/json' } })
    .then((response) => (response.ok ? response.json() : undefined))
    .then((payload: unknown) => {
      const apps = (payload as { apps?: unknown } | undefined)?.apps
      return Array.isArray(apps) ? apps.filter((id): id is string => typeof id === 'string') : []
    })
    // 探测失败与「一个都没装」在调用点是一件事：没有可用的应用。
    .catch((): readonly string[] => [])
  return applications
}

/**
 * 在一个应用里打开一个目录。
 *
 * 失败时抛出宿主给的那句话（目录不存在、应用启动失败都是它说的，插件编不出更准
 * 的），调用点把它放进错误行。
 */
export async function openInApp(app: string, path: string): Promise<void> {
  const response = await fetch(new URL(OPEN_IN_APP_OPEN, hostBase()), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app, path }),
  })
  if (response.ok) return
  const payload = (await response.json().catch(() => undefined)) as { message?: unknown } | undefined
  throw new Error(typeof payload?.message === 'string' ? payload.message : `HTTP ${String(response.status)}`)
}

/**
 * 悬浮构件的容器。
 *
 * 菜单与确认框都不直接挂到 body 上，而是挂进这一层：宿主的 body 本身是个 flex 容器，
 * 而**绝对定位元素落在 flex 容器里时，它的静态位置仍要接受容器的对齐属性**——实测这个
 * 菜单被 align-items:stretch 撑成整屏高（computed height 882px、下沿永远贴着视口底部，
 * 两项内容的菜单看起来像一块盖住半屏的板子）。这一层尺寸是写死的、不参与任何布局，菜单
 * 便只受视口摆布；不吃指针，免得它自己挡住下面那一列。
 */
function MenuHost(props: { children: ReactNode }) {
  return createPortal(<div className="dsh-canvas-menuhost">{props.children}</div>, document.body)
}

/** 打开目录的图形：一个文件夹。 */function FolderGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"
      strokeLinejoin="round" aria-hidden="true">
      <path d="M1.9 4.1h4l1.3 1.6h6.9v6.2H1.9z" />
    </svg>
  )
}

/** 删除画布的图形：一个垃圾桶。 */
function TrashGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.8 4.4h10.4M6.4 4.4V3.1h3.2v1.3M4.2 4.4l.7 8.5h6.2l.7-8.5M6.7 6.8v4M9.3 6.8v4" />
    </svg>
  )
}

/** 画布行的右键菜单。 */
export interface CanvasMenuProps {
  /** 右键的那张画布。 */
  project: Project
  /** 右键落点（视口坐标）。 */
  at: { x: number; y: number }
  /** 宿主这台机器上的文件管理器标识；空串表示打不开目录，那一项不出现。 */
  app: string
  t: Translate
  /** 打开画布目录。 */
  onOpenFolder: () => void
  /** 删除画布（先问一句，问在对话框里）。 */
  onRemove: () => void
  onClose: () => void
}

/**
 * 右键菜单本体。
 *
 * 键盘按菜单的规矩来：打开即把焦点放到第一项（右键不移动焦点，菜单若只认鼠标，
 * 键盘用户就够不着这两个动作），上下键在两项之间走，Esc 关掉并把焦点还给画布行
 * （`onClose` 的调用点负责还）。关掉的另外几条路——点到菜单外、窗口滚动或改变
 * 大小——都是「菜单会漂到离目标很远的地方」的前兆，宁可关掉。
 */
export function CanvasContextMenu(props: CanvasMenuProps) {
  const { project, at, app, t, onOpenFolder, onRemove, onClose } = props
  const ref = useRef<HTMLDivElement | null>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const [box, setBox] = useState<MenuPlacement | undefined>(undefined)

  // 尺寸要等渲染出来才知道，所以第一帧先摆在指针处且不可见，量完再归位。
  const place = useCallback((): void => {
    const element = ref.current
    if (element === null) return
    const rect = element.getBoundingClientRect()
    setBox(placeMenu(at.x, at.y, rect.width, rect.height, window.innerWidth, window.innerHeight))
  }, [at.x, at.y])

  useLayoutEffect(() => {
    place()
  }, [place])

  // 量到的高度可能不是最终的高度：字体落地、以及「打开画布目录」那一项在宿主报回
  // 可用应用之前还不存在，都会让菜单长高——尺寸一变就得重算，否则贴在视口底边时会被
  // 切掉一截。观察器只改 left/top，不改尺寸，所以不会自激。
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const observer = new ResizeObserver(place)
    observer.observe(element)
    return () => observer.disconnect()
  }, [place])

  useEffect(() => {
    // 焦点要让一帧再抢。右键的 mousedown 默认动作是**把焦点落到被点的那一行上**，
    // 而 contextmenu 在 Blink 里就派发在那条默认动作之前——同步 focus 会被它顶掉
    // （实测：菜单开着，activeElement 却还是画布行）。等到这一轮事件跑完再落到第一项，
    // 键盘才真的能直接用。第一项可能不存在（这台部署打不开目录），所以取第一个非空项。
    const frame = window.requestAnimationFrame(() => {
      items.current.find((item) => item !== null)?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const element = ref.current
      if (element !== null && event.target instanceof Node && element.contains(event.target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  /** 上下键在菜单项之间走；到头停住（与单选组同一个约定：不绕回）。 */
  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const list = items.current.filter((item): item is HTMLButtonElement => item !== null)
    const index = list.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    const next = list[Math.min(list.length - 1, Math.max(0, index + step))]
    if (next !== undefined && next !== document.activeElement) {
      event.preventDefault()
      next.focus()
    }
  }, [])

  /** 点一项：动作交给调用点，菜单自己先关（动作要开对话框，别让菜单压在它上面）。 */
  const pick = (action: () => void): void => {
    onClose()
    action()
  }

  return (
    <MenuHost>
      <div
        className="dsh-canvas-floating dsh-canvas-ctxmenu"
        role="menu"
        aria-label={t('canvas.menu.aria')}
        ref={ref}
        style={{ left: at.x, top: at.y, visibility: box === undefined ? 'hidden' : 'visible', ...box }}
        onKeyDown={onKeyDown}
      >
        <div className="dsh-canvas-ctxhead" title={project.root}>
          <span className="dsh-canvas-ctxname">{project.name}</span>
          <span className="dsh-canvas-ctxpath">{project.root}</span>
        </div>
        {app === '' ? null : (
          <button
            type="button"
            role="menuitem"
            className="dsh-canvas-row"
            ref={(node) => {
              items.current[0] = node
            }}
            title={project.root}
            onClick={() => pick(onOpenFolder)}
          >
            <FolderGlyph />
            {t('canvas.menu.open')}
          </button>
        )}
        <button
          type="button"
          role="menuitem"
          className="dsh-canvas-row"
          ref={(node) => {
            items.current[1] = node
          }}
          onClick={() => pick(onRemove)}
        >
          <TrashGlyph />
          {t('canvas.menu.remove')}
        </button>
      </div>
    </MenuHost>
  )
}

/** 删除画布的确认框。 */
export interface CanvasDeleteProps {
  project: Project
  bridge: CanvasBridge
  t: Translate
  /** 删掉了：调用点负责把主区域从这张画布上挪开并刷新列表。 */
  onRemoved: () => void
  onClose: () => void
}

/**
 * 删除确认。
 *
 * 没有「撤销」可点，所以确认之前把后果说明白：磁盘上的东西都在，消失的是这张画布
 * 自己的排版与取材关系。默认焦点落在「取消」上——这个对话框是右键菜单里的一次
 * 误触就能走到的地方，回车不该等于删除。
 */
export function CanvasDeleteDialog(props: CanvasDeleteProps) {
  const { project, bridge, t, onRemoved, onClose } = props
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const confirm = useCallback((): void => {
    if (busy) return
    setBusy(true)
    setError('')
    bridge
      .removeProject(project.id)
      .then(() => {
        // 删成功之后就不要再碰本组件自己的状态了：调用点会把这张对话框卸掉。
        onRemoved()
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : t('canvas.error.unknown'))
        setBusy(false)
      })
  }, [bridge, busy, onRemoved, project.id, t])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  return (
    <MenuHost>
      <div
        className="dsh-canvas-floating dsh-canvas-scrim is-floating"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <div className="dsh-canvas-dialog" role="dialog" aria-modal="true" aria-label={t('canvas.menu.remove.title')}>
          <div className="dsh-canvas-dialog-head">{t('canvas.menu.remove.title')}</div>
          <div className="dsh-canvas-dialog-body">{t('canvas.menu.remove.desc', { name: project.name })}</div>
          <div className="dsh-canvas-dialog-path">{project.root}</div>
          {error === '' ? null : <div className="dsh-canvas-dialog-error">{t('canvas.error', { message: error })}</div>}
          <div className="dsh-canvas-dialog-foot">
            <span style={{ marginLeft: 'auto' }} />
            <button type="button" className="dsh-canvas-chipbtn" autoFocus onClick={onClose}>
              {t('canvas.action.cancel')}
            </button>
            <button type="button" className="dsh-canvas-chipbtn" data-primary="true" disabled={busy} onClick={confirm}>
              {t('canvas.action.delete')}
            </button>
          </div>
        </div>
      </div>
    </MenuHost>
  )
}
