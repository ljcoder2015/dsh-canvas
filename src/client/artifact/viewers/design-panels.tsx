/**
 * dsh-canvas — 设计编辑面板（React 改写自 @open-pencil/vue 的三块 UI）。
 *
 * Vue 原版是完整编辑器的左栏（pages + layers）与右栏（properties，基于
 * reka-ui / tanstack-table）。我们只搬它的**信息架构与交互语义**，不搬实现：
 * - 页面面板：列表、切换（`switchPage`，core 异步做字体/layout 准备）、
 *   新建、重命名、删除（最后一页拒删是 core 的规则，UI 也不再出按钮）。
 * - 图层面板：当前页子树、点选（shift 加选）、显隐眼睛、锁定、重命名；
 *   展示顺序取子节点**倒序**（场景图 latter-on-top，图层面板惯例顶层在上）。
 * - 属性面板：名称/几何（X·Y·W·H）/填充/不透明度/圆角/文本/字号。
 *
 * 数据流是「拉」不是「推」：面板不做任何订阅，每次渲染时从
 * `engine.snapshot()` / `engine.nodeProps()` 现取；图一变，viewer 的
 * onDirty 通道 bump 版本号 → 重挂 → 重读。字段提交节律沿用属性条
 * （blur/回车提交，每条一个 undo；组件按版本 key 重挂，不搞双向绑定）。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { DesignEngine, DesignLayerNode, DesignNodeProps, DesignSnapshot } from './design-engine-types.ts'

/** 面板动作的统一收口：viewer 那边连着落盘时钟 + 重画 + 版本 bump。 */
export interface DesignPanelsProps {
  snapshot: DesignSnapshot
  engine: DesignEngine
  onAction: () => void
  /** 图状态版本（viewer 的 editVersion）：属性表单按它重挂，undo/拖移后字段回真值。 */
  revision: number
}

/**
 * 侧栏容器的类名。viewer 那边的滚轮闸门按它认出「这一滚是给列表的，不是给画布
 * 的」——两处必须指同一个名字，所以只有这一份（@see design-viewer.tsx 的 wheel）。
 */
export const DESIGN_SIDE_CLASS = 'dsh-canvas-design-side'

/** 编辑态的左右栏：左 = 页面 + 图层，右 = 属性。 */
export function DesignSidePanels({ snapshot, engine, onAction, revision }: DesignPanelsProps): ReactElement {
  return (
    <>
      <div className={`${DESIGN_SIDE_CLASS} dsh-canvas-design-side-left`} onPointerDown={(event) => event.stopPropagation()}>
        <PagesPanel snapshot={snapshot} engine={engine} onAction={onAction} revision={revision} />
        <LayersPanel snapshot={snapshot} engine={engine} onAction={onAction} revision={revision} />
      </div>
      <div className={`${DESIGN_SIDE_CLASS} dsh-canvas-design-side-right`} onPointerDown={(event) => event.stopPropagation()}>
        <PropertiesPanel snapshot={snapshot} engine={engine} onAction={onAction} revision={revision} />
      </div>
    </>
  )
}

/** 类型徽标：一行字符的轻量图形（不引图标库）。 */
function typeGlyph(type: string): string {
  if (type === 'text') return 'T'
  if (type === 'frame' || type === 'canvas' || type === 'section') return '▢'
  if (type === 'ellipse' || type === 'circle') return '◯'
  if (type === 'image') return '▨'
  if (type === 'group') return '❏'
  return '◆'
}

// —— 页面面板 ————————————————————————————————————————————————————————

function PagesPanel({ snapshot, engine, onAction }: DesignPanelsProps): ReactElement {
  const [renaming, setRenaming] = useState<string | null>(null)
  return (
    <section className="dsh-canvas-design-panel">
      <header className="dsh-canvas-design-panel-head">
        页面
        <button
          type="button"
          title="新建页面"
          onClick={() => {
            engine.addPage()
            onAction()
          }}
        >
          ＋
        </button>
      </header>
      <ul className="dsh-canvas-design-panel-list">
        {snapshot.pages.map((page) => (
          <li
            key={page.id}
            className={page.id === snapshot.currentPageId ? 'is-active' : undefined}
            onClick={() => {
              if (page.id !== snapshot.currentPageId) {
                engine.setPage(page.id)
                onAction()
              }
            }}
            onDoubleClick={() => setRenaming(page.id)}
          >
            {renaming === page.id ? (
              <TextField
                autoFocus
                value={page.name}
                onCommit={(name) => {
                  engine.renamePage(page.id, name)
                  setRenaming(null)
                  onAction()
                }}
                onCancel={() => setRenaming(null)}
              />
            ) : (
              <span className="dsh-canvas-design-row-name" title={page.name}>{page.name}</span>
            )}
            {snapshot.pages.length > 1 && page.id === snapshot.currentPageId ? (
              <button
                type="button"
                className="dsh-canvas-design-row-act"
                title="删除此页"
                onClick={(event) => {
                  event.stopPropagation()
                  engine.deletePage(page.id)
                  onAction()
                }}
              >
                ×
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

// —— 图层面板 ————————————————————————————————————————————————————————

/**
 * 缩进的最大层级：再深的节点也只缩到这里。
 *
 * 侧栏定宽 180px，而行里除缩进外还有折叠箭头、类型徽标、名字与两枚按钮（眼睛与
 * 锁）。缩进按 12px 无限累加的话，深度十来层的行就会把这些固定宽度顶出面板——眼睛
 * 与锁被裁掉，横向再多一根滚动条（面板不该有）。封顶换来的代价是极深的节点与它
 * 的父级缩进相同，但那一档的树本来也读不出层级了，看得见的按钮更要紧。
 */
const MAX_INDENT_DEPTH = 6

function LayersPanel({ snapshot, engine, onAction }: DesignPanelsProps): ReactElement {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const selected = new Set(snapshot.selection)
  const listRef = useRef<HTMLUListElement | null>(null)
  // 上次滚动聚焦的选区——同一选区的快照刷新（重画/落盘 bump）不再滚动。
  const scrolledRef = useRef<string>('')
  const selectionKey = snapshot.selection.join(',')

  // 画布上点选后，图层面板滚动到选中行。选中行若藏在折叠的祖先里，先展开
  // 祖先（否则行根本没渲染、无从滚动），再 rAF 等行挂载后 scrollIntoView。
  useEffect(() => {
    if (selectionKey === '' || selectionKey === scrolledRef.current) return
    scrolledRef.current = selectionKey
    const hitSelection = new Set(snapshot.selection)
    const ancestors = new Set<string>()
    const walk = (nodes: DesignLayerNode[], path: readonly string[]): void => {
      for (const node of nodes) {
        if (hitSelection.has(node.id)) for (const id of path) ancestors.add(id)
        walk(node.children, node.children.length > 0 ? [...path, node.id] : path)
      }
    }
    walk(snapshot.layers, [])
    if (ancestors.size > 0) {
      setCollapsed((previous) => {
        if (![...ancestors].some((id) => previous.has(id))) return previous
        const next = new Set(previous)
        for (const id of ancestors) next.delete(id)
        return next
      })
    }
    const frame = requestAnimationFrame(() => {
      listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [selectionKey, snapshot.layers, snapshot.selection])

  const row = (node: DesignLayerNode, depth: number): ReactElement => {
    const isSelected = selected.has(node.id)
    const hasChildren = node.children.length > 0
    const isCollapsed = collapsed.has(node.id)
    return (
      <li key={node.id}>
        <div
          className={[
            'dsh-canvas-design-layer',
            isSelected ? 'is-active' : undefined,
            node.visible ? undefined : 'is-hidden',
          ].filter(Boolean).join(' ')}
          style={{ paddingLeft: 4 + Math.min(depth, MAX_INDENT_DEPTH) * 12 }}
          onClick={(event) => {
            engine.select([node.id], event.shiftKey)
            onAction()
          }}
          onDoubleClick={() => setRenaming(node.id)}
        >
          {hasChildren ? (
            <button
              type="button"
              className="dsh-canvas-design-caret"
              onClick={(event) => {
                event.stopPropagation()
                setCollapsed((previous) => {
                  const next = new Set(previous)
                  if (next.has(node.id)) next.delete(node.id)
                  else next.add(node.id)
                  return next
                })
              }}
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          ) : (
            <span className="dsh-canvas-design-caret" />
          )}
          <span className="dsh-canvas-design-glyph">{typeGlyph(node.type)}</span>
          {renaming === node.id ? (
            <TextField
              autoFocus
              value={node.name}
              onCommit={(name) => {
                engine.updateProps(node.id, { name })
                setRenaming(null)
                onAction()
              }}
              onCancel={() => setRenaming(null)}
            />
          ) : (
            <span className="dsh-canvas-design-row-name" title={node.name}>
              {node.name === '' ? node.type : node.name}
            </span>
          )}
          <button
            type="button"
            className="dsh-canvas-design-row-act"
            title={node.locked ? '解除锁定' : '锁定'}
            onClick={(event) => {
              event.stopPropagation()
              engine.updateProps(node.id, { locked: !node.locked })
              onAction()
            }}
          >
            {node.locked ? '🔒' : '🔓'}
          </button>
          <button
            type="button"
            className="dsh-canvas-design-row-act"
            title={node.visible ? '隐藏' : '显示'}
            onClick={(event) => {
              event.stopPropagation()
              engine.updateProps(node.id, { visible: !node.visible })
              onAction()
            }}
          >
            {node.visible ? '👁' : '·'}
          </button>
        </div>
        {hasChildren && !isCollapsed ? (
          <ul>{[...node.children].reverse().map((child) => row(child, depth + 1))}</ul>
        ) : null}
      </li>
    )
  }

  return (
    <section className="dsh-canvas-design-panel dsh-canvas-design-panel-grow">
      <header className="dsh-canvas-design-panel-head">图层</header>
      <ul ref={listRef} className="dsh-canvas-design-panel-list">
        {[...snapshot.layers].reverse().map((node) => row(node, 0))}
      </ul>
    </section>
  )
}

// —— 属性面板 ————————————————————————————————————————————————————————

function PropertiesPanel({ snapshot, engine, onAction, revision }: DesignPanelsProps): ReactElement {
  const count = snapshot.selection.length
  if (count === 0) {
    return (
      <section className="dsh-canvas-design-panel">
        <header className="dsh-canvas-design-panel-head">属性</header>
        <p className="dsh-canvas-design-panel-empty">选中一个图层查看属性。</p>
      </section>
    )
  }
  if (count > 1) {
    return (
      <section className="dsh-canvas-design-panel">
        <header className="dsh-canvas-design-panel-head">属性</header>
        <p className="dsh-canvas-design-panel-empty">已选中 {count} 个图层。</p>
        <button
          type="button"
          className="dsh-canvas-design-danger"
          onClick={() => {
            engine.deleteSelection()
            onAction()
          }}
        >
          删除选中
        </button>
      </section>
    )
  }
  const read = engine.nodeProps(snapshot.selection[0] ?? '')
  if (read === null) {
    return (
      <section className="dsh-canvas-design-panel">
        <header className="dsh-canvas-design-panel-head">属性</header>
        <p className="dsh-canvas-design-panel-empty">图层已不存在。</p>
      </section>
    )
  }
  const commit = (props: DesignNodeProps): void => {
    engine.updateProps(read.id, props)
    onAction()
  }
  return (
    <section className="dsh-canvas-design-panel">
      <header className="dsh-canvas-design-panel-head">属性</header>
      <div className="dsh-canvas-design-form" key={`${read.id}:${revision}`}>
        <label className="dsh-canvas-design-field">
          <span>名称</span>
          <TextField value={read.name} onCommit={(name) => commit({ name })} />
        </label>
        <div className="dsh-canvas-design-grid2">
          <label className="dsh-canvas-design-field">
            <span>X</span>
            <NumField value={Math.round(read.x)} onCommit={(x) => commit({ x })} />
          </label>
          <label className="dsh-canvas-design-field">
            <span>Y</span>
            <NumField value={Math.round(read.y)} onCommit={(y) => commit({ y })} />
          </label>
          <label className="dsh-canvas-design-field">
            <span>W</span>
            <NumField value={Math.round(read.width)} min={1} onCommit={(width) => commit({ width })} />
          </label>
          <label className="dsh-canvas-design-field">
            <span>H</span>
            <NumField value={Math.round(read.height)} min={1} onCommit={(height) => commit({ height })} />
          </label>
        </div>
        <label className="dsh-canvas-design-field">
          <span>填充</span>
          <input
            type="color"
            value={(read.fill ?? '#000000').slice(0, 7)}
            onChange={(event) => commit({ fill: event.target.value })}
          />
        </label>
        <label className="dsh-canvas-design-field">
          <span>不透明</span>
          <NumField
            value={Math.round(read.opacity * 100)}
            min={0}
            max={100}
            onCommit={(value) => commit({ opacity: Math.min(1, Math.max(0, value / 100)) })}
          />
        </label>
        {read.type !== 'text' ? (
          <label className="dsh-canvas-design-field">
            <span>圆角</span>
            <NumField value={read.cornerRadius} min={0} onCommit={(cornerRadius) => commit({ cornerRadius })} />
          </label>
        ) : (
          <>
            <label className="dsh-canvas-design-field">
              <span>文本</span>
              <TextField value={read.text} onCommit={(text) => commit({ text })} />
            </label>
            <label className="dsh-canvas-design-field">
              <span>字号</span>
              <NumField value={read.fontSize} min={1} onCommit={(fontSize) => commit({ fontSize })} />
            </label>
          </>
        )}
        <button
          type="button"
          className="dsh-canvas-design-danger"
          onClick={() => {
            engine.deleteSelection()
            onAction()
          }}
        >
          删除图层
        </button>
      </div>
    </section>
  )
}

// —— 输入字段（从底部属性条迁来，节律不变） ————————————————————————————

/** 数字字段：blur / 回车提交，非法输入回弹到当前值。 */
export function NumField({
  value,
  min,
  max,
  onCommit,
}: {
  value: number
  min?: number
  max?: number
  onCommit: (value: number) => void
}): ReactElement {
  const ref = useRef<HTMLInputElement | null>(null)
  const send = (): void => {
    const input = ref.current
    if (input === null) return
    const parsed = Number(input.value)
    if (!Number.isFinite(parsed) || (min !== undefined && parsed < min) || (max !== undefined && parsed > max)) {
      input.value = String(value)
      return
    }
    if (parsed !== value) onCommit(parsed)
  }
  return (
    <input
      ref={ref}
      type="number"
      defaultValue={value}
      min={min}
      max={max}
      onBlur={send}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          send()
        }
      }}
    />
  )
}

/** 文本字段：同 {@link NumField} 的提交节律；Esc 复原。 */
export function TextField({
  value,
  onCommit,
  onCancel,
  autoFocus,
}: {
  value: string
  onCommit: (value: string) => void
  onCancel?: () => void
  autoFocus?: boolean
}): ReactElement {
  const ref = useRef<HTMLInputElement | null>(null)
  const send = (): void => {
    const input = ref.current
    if (input === null || input.value === value) {
      onCancel?.()
      return
    }
    onCommit(input.value)
  }
  return (
    <input
      ref={ref}
      type="text"
      defaultValue={value}
      // 重命名场景下直接进编辑态；每次击键都可能丢焦点的话就没法改名了。
      autoFocus={autoFocus}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={send}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          send()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel?.()
        }
      }}
    />
  )
}
