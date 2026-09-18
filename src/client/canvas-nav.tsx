/**
 * dsh-canvas — 左栏画布区：一个包裹，header 与画布列表。
 *
 * 为什么不是一个画布一行地注册进 `sidebar.panellist`：那个席位由宿主渲染成
 * **按钮列表**（图形 + 文字），行里放不下第二枚按钮，也放不下一棵列表子树——
 * 画布一多，侧栏就是一片按钮墙。画布区该是一件事：一行标题（右侧带新建），
 * 底下列出已有画布。
 *
 * 所以这里只注册**一行**（画布区自己），由那一行的组件把包裹经 `createPortal`
 * 挂进宿主的面板列表里：
 *
 * - 收起（rail）：宿主那一行照常露面——它就是「画布」的图标，点下去即新建。
 *   rail 只有 36px，本来就摆不下列表，所以包裹在收起态整棵不显示（styles.ts）。
 * - 展开：包裹接管。header 是标题 + 右侧新建按钮，下面每行一张画布，点一下切换。
 *
 * 定位宿主的容器不靠类名（那是打包哈希）：画布区那枚图形上带钩子类
 * `dsh-canvas-nav-anchor`，从它上溯最近的一个 `<nav>` 即可——宿主的面板列表就是
 * 一个 nav，包裹作为它的子项落在流里，占位与别处无异。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Project } from '../types.ts'
import type { Translate } from './locales.ts'
import type { ProjectCatalog } from './project-catalog.ts'

/**
 * 画布区那一行、它的主面板（新建流程）、以及面板列表里包裹的归属，共用这一个 id。
 *
 * 宿主要求行 id 与 `main` 面板 key 逐字相同：点行就是 `selectPanel(id)`。
 */
export const CREATE_ID = 'dsh-canvas:canvas:new'

/** 一个画布的面板 key 与它在包裹里的行身份；同样要求面板 key 与宿主条目 key 一致。 */
export function panelIdOf(projectId: string): string {
  return `dsh-canvas:canvas:${projectId}`
}

/**
 * 画布区那枚图形上的钩子类。
 *
 * 两处用处都不是造型：styles.ts 靠它把宿主那一行按折叠状态显隐（宿主的按钮类名
 * 是打包哈希，插件够不到），本模块靠它把自己那枚图形认出来再上溯到面板列表。
 * **只有画布区那一行带这个类**，包裹里的画布行不带。
 */
const ANCHOR = 'dsh-canvas-nav-anchor'

/**
 * 画布图形：一块板 + 一道折线。
 *
 * 画布区那一行与包裹里的画布行共用同一枚图标（视觉上它们说的是同一件事），
 * `mark` 是给画布区那枚的钩子类。
 */
export function Glyph(props: { size: number; active: boolean; mark?: string }) {
  return (
    <svg
      width={props.size}
      height={props.size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      // 选中态由宿主的行底色（或包裹里画布行的底色）表达，图形只做实心/虚心之分。
      opacity={props.active ? 1 : 0.8}
      className={props.mark}
      aria-hidden="true"
      strokeWidth="1.3"
      strokeLinejoin="round"
    >
      <rect x="1.9" y="2.9" width="12.2" height="10.2" rx="1.6" />
      <path d="M3.6 11.4l3-2.6 2.4 1.9 2.2-1.7 1.9 1.5" />
    </svg>
  )
}

/** 新建按钮的图形：一枚加号。 */
function PlusGlyph(props: { size: number }) {
  return (
    <svg width={props.size} height={props.size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <path d="M8 3.4v9.2M3.4 8h9.2" />
    </svg>
  )
}

/** 根布局暴露给所有席位的主面板选择态（`ui-layout` 的全局标准席位）。 */
interface PanelInfo {
  /** 当前选中的主面板；null 表示对话。 */
  readonly activePanelId: string | null
}

/** 读主面板选择态的钩子；由框架注入，本包不依赖 ui-layout 的包。 */
type PanelSelector = (select: (info: PanelInfo) => string | null) => string | null

/**
 * 没有 ui-layout 时的替身钩子。
 *
 * 全局标准席位是框架发的：裸组合里可能没有（本包的单测就是）。写成钩子的形状是
 * 为了让调用点无条件调用——Hook 调用顺序恒定，缺的只是「正在看哪张画布」这条信息。
 */
const useNoPanel = (select: (info: PanelInfo) => string | null): string | null => {
  // 替身不读选择态，但参数不能省：调用点与真钩子同形，Hook 调用顺序才恒定。
  void select
  return null
}

/** 画布区注入的外部面（注册时的 inject；由渲染器缓存，跨渲染恒等）。 */
export interface CanvasNavInject {
  /** 画布项目列表；包裹订阅它。 */
  catalog: ProjectCatalog
  /** 切换画布：主区域切到它的面板（必要时先补齐面板）。 */
  openCanvas: (projectId: string) => void
  /** 新建画布：主区域交给文件夹选择器。 */
  createCanvas: () => void
}

/** 宿主交给行图形的 props（`sidebar` 的 SidebarPanelIconOwnerProps）。 */
interface SectionRowShare {
  /** 请求的图形边长（展开 16 / 收起 18）。 */
  size: number
  /** 该行是否被选中。 */
  active: boolean
}

/** 画布区那枚图形的完整 props：宿主 share + 注入面 + 字典 + 框架的标准席位。 */
export type CanvasNavProps = SectionRowShare & CanvasNavInject & {
  /** 字典（注册声明了 `locale`，宿主按语言修订号重发引用，切语言即重渲染）。 */
  t: Translate
  /** 主面板选择态；缺省时画布行不做选中高亮。 */
  usePanelInfo?: PanelSelector
}

/**
 * 画布区的席位组件：一枚图形，加上挂在面板列表里的包裹。
 *
 * 图形留给宿主那一行（收起态的唯一入口）；包裹只在拿到宿主容器后渲染——拿不到就
 * 只出图形，宁少一块也不会把行拆坏。
 */
export function CanvasNavSeat(props: CanvasNavProps) {
  const list = usePanelList()
  const glyph = <Glyph size={props.size} active={props.active} mark={ANCHOR} />
  if (list === undefined) return glyph
  return (
    <>
      {glyph}
      {createPortal(
        <CanvasNavPane
          t={props.t}
          usePanelInfo={props.usePanelInfo}
          catalog={props.catalog}
          openCanvas={props.openCanvas}
          createCanvas={props.createCanvas}
        />,
        list,
      )}
    </>
  )
}

/** 包裹 props：注入面 + 字典 + 标准席位（几何是宿主行的事，包裹不接）。 */
type CanvasNavPaneProps = CanvasNavInject & Pick<CanvasNavProps, 't' | 'usePanelInfo'>

/** 包裹本体：header（标题 + 新建）与画布列表。 */
function CanvasNavPane(props: CanvasNavPaneProps) {
  const { t, catalog, openCanvas, createCanvas } = props
  const subscribe = useCallback((listener: () => void) => catalog.subscribe(listener), [catalog])
  const snapshot = useCallback(() => catalog.snapshot(), [catalog])
  const projects = useSyncExternalStore(subscribe, snapshot)
  const usePanelInfo = props.usePanelInfo ?? useNoPanel
  const activeId = usePanelInfo((info) => info.activePanelId)

  return (
    <div
      className="dsh-canvas-navpane"
      // Portal 的事件沿 **React 树**上溯，而本包裹的席位组件正渲染在宿主那一行
      // （新建入口）的按钮里——不拦的话，点包裹里任何地方（包括标题）都会被当成
      // 点了那一行，全部变成「新建」。这里拦掉冒泡：header 区域不再新增，加号才新增。
      // 包裹内各按钮自己的 onClick 先于本句执行，不受影响；收起态没有包裹，
      // rail 图标就是那一行本身，点击照常新建。
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="dsh-canvas-navhead">
        <span className="dsh-canvas-navtitle">{t('canvas.manage.new')}</span>
        <button
          type="button"
          className="dsh-canvas-navadd"
          onClick={createCanvas}
          title={t('canvas.manage.add')}
          aria-label={t('canvas.manage.add')}
        >
          <PlusGlyph size={14} />
        </button>
      </div>
      {projects.length === 0 ? (
        // 一张画布都没有时也留着 header：新建按钮是这一段的唯一入口。
        <div className="dsh-canvas-navempty">{t('canvas.empty.projects')}</div>
      ) : (
        <ul className="dsh-canvas-navlist">
          {projects.map((project: Project) => (
            <li key={project.id}>
              <button
                type="button"
                className="dsh-canvas-navrow"
                data-active={activeId === panelIdOf(project.id) ? 'true' : undefined}
                onClick={() => openCanvas(project.id)}
                title={project.name}
              >
                <Glyph size={14} active={activeId === panelIdOf(project.id)} />
                <span className="dsh-canvas-navname">{project.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * 宿主面板列表容器（挂包裹的地方）。
 *
 * 宿主不会为「插件在自己那一行旁边放点什么」开席位，但行本身在 DOM 里：从自己那枚
 * 图形上溯最近的 `<nav>` 就是面板列表（兜底是行按钮的父节点，万一宿主换掉 nav）。
 *
 * 容器一旦被宿主重建（布局重挂、插件重载），列表要先消失再长回来，所以这里挂一个
 * 观察者：每次 DOM 变动只做一件极便宜的事——确认手上那个容器还在树上；不在就重新
 * 定位。定位本身用不着找第二次，所以平时这个观察者是零成本的。
 */
function usePanelList(): HTMLElement | undefined {
  const [list, setList] = useState<HTMLElement | undefined>(undefined)
  const known = useRef<HTMLElement | undefined>(undefined)

  useEffect(() => {
    const locate = (): HTMLElement | undefined => {
      const glyph = document.querySelector(`svg.${ANCHOR}`)
      return glyph?.closest('nav') ?? glyph?.closest('button')?.parentElement ?? undefined
    }
    const settle = (): void => {
      const current = known.current
      if (current !== undefined && current.isConnected) return
      const next = locate()
      known.current = next
      setList(next)
    }
    settle()
    const observer = new MutationObserver(settle)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
    }
  }, [])

  return list
}
