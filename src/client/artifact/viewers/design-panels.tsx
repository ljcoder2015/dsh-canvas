/**
 * dsh-canvas — 设计编辑面板（React 改写自 @open-pencil/vue 的三块 UI）。
 *
 * Vue 原版是完整编辑器的左栏（pages + layers）与右栏（properties，基于
 * reka-ui / tanstack-table）。我们只搬它的**信息架构与交互语义**，不搬实现：
 * - 页面面板：列表、切换（`switchPage`，core 异步做字体/layout 准备）、
 *   新建、重命名、删除（最后一页拒删是 core 的规则，UI 也不再出按钮）。
 * - 图层面板：当前页子树、点选（shift 加选）、显隐眼睛、锁定、重命名；
 *   展示顺序取子节点**倒序**（场景图 latter-on-top，图层面板惯例顶层在上）。
 * - 属性面板：顶部「设计 / AI」两个标签页。设计页按模块分组编辑选中图层
 *   （名称、位置 X·Y、形状 W·H/圆角（统一或四角独立）/裁切溢出、外观
 *   填充/不透明、文本/字号、边框动态数组（颜色/宽度/实虚线/内外居中描边/
 *   作用边）、阴影、内阴影、模糊）；AI 页是通用提示词输入框，发送时内联
 *   选中图层（经本卡会话改稿）。
 *
 * 数据流是「拉」不是「推」：面板不做任何订阅，每次渲染时从
 * `engine.snapshot()` / `engine.nodeProps()` 现取；图一变，viewer 的
 * onDirty 通道 bump 版本号 → 重挂 → 重读。字段提交节律沿用属性条
 * （blur/回车提交，每条一个 undo；组件按版本 key 重挂，不搞双向绑定）。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { useChrome } from '../chrome.tsx'
import type {
  DesignEffectItem,
  DesignEngine,
  DesignLayerNode,
  DesignNodeProps,
  DesignSnapshot,
  DesignStrokeItem,
} from './design-engine-types.ts'

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

// —— 属性面板（设计 / AI 标签页） ——————————————————————————————————————————

/** 属性面板顶部的两个标签。 */
type PanelTab = 'design' | 'ai'

function PropertiesPanel({ snapshot, engine, onAction, revision }: DesignPanelsProps): ReactElement {
  const [tab, setTab] = useState<PanelTab>('design')
  return (
    <section className="dsh-canvas-design-panel">
      <div className="dsh-canvas-design-tabs" role="tablist" aria-label="属性面板">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'design'}
          className={`dsh-canvas-design-tab${tab === 'design' ? ' is-active' : ''}`}
          onClick={() => setTab('design')}
        >
          设计
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'ai'}
          className={`dsh-canvas-design-tab${tab === 'ai' ? ' is-active' : ''}`}
          onClick={() => setTab('ai')}
        >
          AI
        </button>
      </div>
      {tab === 'design' ? (
        <DesignPropertiesTab snapshot={snapshot} engine={engine} onAction={onAction} revision={revision} />
      ) : (
        <AiPromptTab snapshot={snapshot} engine={engine} onAction={onAction} revision={revision} />
      )}
    </section>
  )
}

function DesignPropertiesTab({ snapshot, engine, onAction, revision }: DesignPanelsProps): ReactElement {
  const count = snapshot.selection.length
  if (count === 0) {
    return <p className="dsh-canvas-design-panel-empty">选中一个图层查看属性。</p>
  }
  if (count > 1) {
    return (
      <>
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
      </>
    )
  }
  const read = engine.nodeProps(snapshot.selection[0] ?? '')
  if (read === null) {
    return <p className="dsh-canvas-design-panel-empty">图层已不存在。</p>
  }
  const commit = (props: DesignNodeProps): void => {
    engine.updateProps(read.id, props)
    onAction()
  }

  // 效果按类型分桶展示；任一桶提交都把三桶按固定顺序合并回去——
  // updateProps 的 effects 是整组替换，各模块不能只写自己的那份。
  const shadows = read.effects.filter((effect) => effect.type === 'DROP_SHADOW')
  const innerShadows = read.effects.filter((effect) => effect.type === 'INNER_SHADOW')
  const blurs = read.effects.filter((effect) => effect.type === 'LAYER_BLUR' || effect.type === 'BACKGROUND_BLUR')
  const commitEffects = (parts: { shadows?: DesignEffectItem[]; inner?: DesignEffectItem[]; blurs?: DesignEffectItem[] }): void => {
    commit({
      effects: [...(parts.shadows ?? shadows), ...(parts.inner ?? innerShadows), ...(parts.blurs ?? blurs)],
    })
  }

  const isFrame = read.type === 'frame'
  const isText = read.type === 'text'
  return (
    <div className="dsh-canvas-design-form" key={`${read.id}:${revision}`}>
      <label className="dsh-canvas-design-field">
        <span>名称</span>
        <TextField value={read.name} onCommit={(name) => commit({ name })} />
      </label>

      <Module title="位置">
        <div className="dsh-canvas-design-grid2">
          <label className="dsh-canvas-design-field">
            <span>X</span>
            <NumField value={Math.round(read.x)} onCommit={(x) => commit({ x })} />
          </label>
          <label className="dsh-canvas-design-field">
            <span>Y</span>
            <NumField value={Math.round(read.y)} onCommit={(y) => commit({ y })} />
          </label>
        </div>
      </Module>

      <Module title="形状">
        <div className="dsh-canvas-design-grid2">
          <label className="dsh-canvas-design-field">
            <span>W</span>
            <NumField value={Math.round(read.width)} min={1} onCommit={(width) => commit({ width })} />
          </label>
          <label className="dsh-canvas-design-field">
            <span>H</span>
            <NumField value={Math.round(read.height)} min={1} onCommit={(height) => commit({ height })} />
          </label>
        </div>
        {!isText && !read.independentCorners ? (
          <label className="dsh-canvas-design-field">
            <span>圆角</span>
            <NumField value={read.cornerRadius} min={0} onCommit={(cornerRadius) => commit({ cornerRadius })} />
          </label>
        ) : null}
        {!isText && read.independentCorners ? (
          <>
            <div className="dsh-canvas-design-grid2">
              <label className="dsh-canvas-design-field">
                <span>左上</span>
                <NumField value={read.topLeftRadius} min={0} onCommit={(topLeftRadius) => commit({ topLeftRadius })} />
              </label>
              <label className="dsh-canvas-design-field">
                <span>右上</span>
                <NumField value={read.topRightRadius} min={0} onCommit={(topRightRadius) => commit({ topRightRadius })} />
              </label>
            </div>
            <div className="dsh-canvas-design-grid2">
              <label className="dsh-canvas-design-field">
                <span>左下</span>
                <NumField value={read.bottomLeftRadius} min={0} onCommit={(bottomLeftRadius) => commit({ bottomLeftRadius })} />
              </label>
              <label className="dsh-canvas-design-field">
                <span>右下</span>
                <NumField value={read.bottomRightRadius} min={0} onCommit={(bottomRightRadius) => commit({ bottomRightRadius })} />
              </label>
            </div>
          </>
        ) : null}
        {!isText ? (
          <SelectField
            value={read.independentCorners ? 'independent' : 'uniform'}
            options={[
              { value: 'uniform', label: '统一圆角' },
              { value: 'independent', label: '四角独立' },
            ]}
            onChange={(next) => commit(next === 'independent' ? { independentCorners: true } : { cornerRadius: read.topLeftRadius })}
          />
        ) : null}
        {isFrame ? (
          <CheckField
            label="裁切溢出内容"
            checked={read.clipsContent}
            onChange={(clipsContent) => commit({ clipsContent })}
          />
        ) : null}
      </Module>

      <Module title="外观">
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
      </Module>

      {isText ? (
        <Module title="文本">
          <label className="dsh-canvas-design-field">
            <span>文本</span>
            <TextField value={read.text} onCommit={(text) => commit({ text })} />
          </label>
          <label className="dsh-canvas-design-field">
            <span>字号</span>
            <NumField value={read.fontSize} min={1} onCommit={(fontSize) => commit({ fontSize })} />
          </label>
        </Module>
      ) : null}

      <BordersModule items={read.strokes} commit={(strokes) => commit({ strokes })} />

      <EffectList items={shadows} kind="shadow" onChange={(items) => commitEffects({ shadows: items })} />
      <EffectList items={innerShadows} kind="inner-shadow" onChange={(items) => commitEffects({ inner: items })} />
      <EffectList items={blurs} kind="blur" onChange={(items) => commitEffects({ blurs: items })} />

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
  )
}

// —— 属性面板的小部件：模块壳 / 下拉 / 勾选 / 边框与效果列表 ————————————————

/** 模块小节：标题行（可挂动作按钮，如「＋添加」）+ 内容。 */
function Module({ title, action, children }: { title: string; action?: ReactElement; children: ReactNode }): ReactElement {
  return (
    <div className="dsh-canvas-design-module">
      <div className="dsh-canvas-design-module-head">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </div>
  )
}

/** 选项下拉：样式与数字输入框同壳。 */
function SelectField({
  value,
  options,
  onChange,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}): ReactElement {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}

/** 勾选行：标题 + 开关。 */
function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }): ReactElement {
  return (
    <label className="dsh-canvas-design-check">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

/** css 颜色的不透明度（#rrggbbaa 的 aa；6 位视为 1）。 */
function alphaOf(css: string): number {
  return css.length === 9 ? Number.parseInt(css.slice(7), 16) / 255 : 1
}

/** 把不透明度写回 css 颜色（保留 6 位的 RGB 部分）。 */
function withAlpha(css: string, alpha: number): string {
  const byte = Math.round(Math.min(Math.max(alpha, 0), 1) * 255).toString(16).padStart(2, '0')
  return `${css.slice(0, 7)}${byte}`
}

/** 拾色器 onChange 里的保 alpha：input[type=color] 只吐 6 位，后缀从旧值搬过来。 */
function pickColor(picked: string, previous: string): string {
  return previous.length === 9 ? `${picked}${previous.slice(7)}` : picked
}

/** 边框模块：动态数组，每格一条描边（颜色/宽度/样式/描边类型/作用边）。 */
function BordersModule({ items, commit }: { items: DesignStrokeItem[]; commit: (items: DesignStrokeItem[]) => void }): ReactElement {
  const patch = (index: number, part: Partial<DesignStrokeItem>): void => {
    commit(items.map((item, i) => (i === index ? { ...item, ...part } : item)))
  }
  return (
    <Module
      title="边框"
      action={
        <button
          type="button"
          title="添加边框"
          onClick={() => commit([...items, { color: '#0F172A', weight: 1, align: 'INSIDE', dashed: false, side: 'ALL' }])}
        >
          ＋
        </button>
      }
    >
      {items.length === 0 ? <span className="dsh-canvas-design-module-empty">无边框</span> : null}
      {items.map((item, index) => (
        <div key={index} className="dsh-canvas-design-item">
          <div className="dsh-canvas-design-item-row">
            <input
              type="color"
              title="边框颜色"
              value={item.color.slice(0, 7)}
              onChange={(event) => patch(index, { color: pickColor(event.target.value, item.color) })}
            />
            <label className="dsh-canvas-design-field">
              <span>宽度</span>
              <NumField value={item.weight} min={0} onCommit={(weight) => patch(index, { weight })} />
            </label>
          </div>
          <div className="dsh-canvas-design-grid2">
            <SelectField
              value={item.dashed ? 'dashed' : 'solid'}
              options={[
                { value: 'solid', label: '实线' },
                { value: 'dashed', label: '虚线' },
              ]}
              onChange={(next) => patch(index, { dashed: next === 'dashed' })}
            />
            <SelectField
              value={item.align}
              options={[
                { value: 'INSIDE', label: '内描边' },
                { value: 'CENTER', label: '居中描边' },
                { value: 'OUTSIDE', label: '外描边' },
              ]}
              onChange={(align) => patch(index, { align: align as DesignStrokeItem['align'] })}
            />
          </div>
          <div className="dsh-canvas-design-item-row">
            <SelectField
              value={item.side}
              options={[
                { value: 'ALL', label: '四边' },
                { value: 'TOP', label: '顶部' },
                { value: 'RIGHT', label: '右侧' },
                { value: 'BOTTOM', label: '底部' },
                { value: 'LEFT', label: '左侧' },
              ]}
              onChange={(side) => patch(index, { side: side as DesignStrokeItem['side'] })}
            />
            <button
              type="button"
              className="dsh-canvas-design-item-remove"
              title="移除此边框"
              onClick={() => commit(items.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </Module>
  )
}

/**
 * 效果列表（阴影/内阴影/模糊共用）。`kind` 决定新格的默认值与展示字段：
 * 模糊只露类型与半径，阴影露颜色/偏移/半径/扩展/不透明。
 */
function EffectList({
  items,
  kind,
  onChange,
}: {
  items: DesignEffectItem[]
  kind: 'shadow' | 'inner-shadow' | 'blur'
  onChange: (items: DesignEffectItem[]) => void
}): ReactElement {
  const isBlur = kind === 'blur'
  const blank: DesignEffectItem = isBlur
    ? { type: 'LAYER_BLUR', color: '#00000000', x: 0, y: 0, radius: 8, spread: 0 }
    : { type: kind === 'shadow' ? 'DROP_SHADOW' : 'INNER_SHADOW', color: '#00000040', x: 0, y: 4, radius: 10, spread: 0 }
  const patch = (index: number, part: Partial<DesignEffectItem>): void => {
    onChange(items.map((item, i) => (i === index ? { ...item, ...part } : item)))
  }
  const head = kind === 'shadow' ? '阴影' : kind === 'inner-shadow' ? '内阴影' : '模糊'
  return (
    <Module
      title={head}
      action={
        <button type="button" title={`添加${head}`} onClick={() => onChange([...items, blank])}>
          ＋
        </button>
      }
    >
      {items.length === 0 ? <span className="dsh-canvas-design-module-empty">无{head}</span> : null}
      {items.map((item, index) => (
        <div key={index} className="dsh-canvas-design-item">
          {isBlur ? (
            <div className="dsh-canvas-design-item-row">
              <SelectField
                value={item.type}
                options={[
                  { value: 'LAYER_BLUR', label: '层模糊' },
                  { value: 'BACKGROUND_BLUR', label: '背景模糊' },
                ]}
                onChange={(type) => patch(index, { type: type as DesignEffectItem['type'] })}
              />
              <button
                type="button"
                className="dsh-canvas-design-item-remove"
                title="移除此模糊"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </div>
          ) : (
            <div className="dsh-canvas-design-item-row">
              <input
                type="color"
                title="颜色"
                value={item.color.slice(0, 7)}
                onChange={(event) => patch(index, { color: pickColor(event.target.value, item.color) })}
              />
              <button
                type="button"
                className="dsh-canvas-design-item-remove"
                title="移除此阴影"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </div>
          )}
          <div className="dsh-canvas-design-grid2">
            <label className="dsh-canvas-design-field">
              <span>模糊</span>
              <NumField value={item.radius} min={0} onCommit={(radius) => patch(index, { radius })} />
            </label>
            {!isBlur ? (
              <label className="dsh-canvas-design-field">
                <span>扩展</span>
                <NumField value={item.spread} onCommit={(spread) => patch(index, { spread })} />
              </label>
            ) : null}
          </div>
          {!isBlur ? (
            <>
              <div className="dsh-canvas-design-grid2">
                <label className="dsh-canvas-design-field">
                  <span>X</span>
                  <NumField value={item.x} onCommit={(x) => patch(index, { x })} />
                </label>
                <label className="dsh-canvas-design-field">
                  <span>Y</span>
                  <NumField value={item.y} onCommit={(y) => patch(index, { y })} />
                </label>
              </div>
              <label className="dsh-canvas-design-field">
                <span>不透明</span>
                <NumField
                  value={Math.round(alphaOf(item.color) * 100)}
                  min={0}
                  max={100}
                  onCommit={(value) => patch(index, { color: withAlpha(item.color, value / 100) })}
                />
              </label>
            </>
          ) : null}
        </div>
      ))}
    </Module>
  )
}

// —— AI 标签页：通用提示词 + 内联选中图层 ————————————————————————————————

/** 内联进提示词的选中图层上限（再多就截断——提示词不是图层清单）。 */
const AI_INLINE_MAX = 8

function AiPromptTab({ snapshot, engine }: DesignPanelsProps): ReactElement {
  const chrome = useChrome()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  // 内联的图层上下文：每次渲染现取（与面板的「拉」数据流一致），发送时定格。
  const inlined = snapshot.selection
    .slice(0, AI_INLINE_MAX)
    .map((id) => engine.nodeProps(id))
    .filter((read): read is NonNullable<typeof read> => read !== null)
    .map((read) => ({
      id: read.id,
      type: read.type,
      name: read.name,
      x: Math.round(read.x),
      y: Math.round(read.y),
      width: Math.round(read.width),
      height: Math.round(read.height),
      fill: read.fill,
    }))

  const send = (): void => {
    const text = draft.trim()
    if (text === '' || sending) return
    setSending(true)
    setError('')
    // 选中图层以 id 清单内联进提示词：模型拿 id 调 canvas_design_edit 精确改稿。
    const prompt =
      inlined.length > 0
        ? `${text}\n\n（内联的选中图层，请以这些 id 为目标用 canvas_design_edit 修改：${JSON.stringify(inlined)}）`
        : text
    void chrome.bridge
      .sendMessage(chrome.projectId, chrome.cardId, prompt)
      .then(() => {
        setSending(false)
        setDraft('')
        setNotice('已发送给本卡会话，模型改稿写入后画布会自动刷新。')
      })
      .catch((reason: unknown) => {
        setSending(false)
        setError(reason instanceof Error ? reason.message : '发送失败，请重试。')
      })
  }

  return (
    <div className="dsh-canvas-design-ai">
      <p className="dsh-canvas-design-ai-hint">
        {inlined.length > 0
          ? `将内联 ${inlined.length} 个选中图层${snapshot.selection.length > AI_INLINE_MAX ? `（已截取前 ${AI_INLINE_MAX} 个）` : ''}。`
          : '未选中图层，将作为通用指令发送。'}
      </p>
      <textarea
        placeholder="描述要做的修改，例如「把这个卡片改成深色主题，加上投影」…"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // ⌘/Ctrl+Enter 直接发送；面板表单的其余键节律不在此处。
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            send()
          }
        }}
      />
      <button type="button" className="dsh-canvas-design-ai-send" disabled={sending || draft.trim() === ''} onClick={send}>
        {sending ? '发送中…' : '发送给会话'}
      </button>
      {notice !== '' ? <p className="dsh-canvas-design-ai-notice">{notice}</p> : null}
      {error !== '' ? <p className="dsh-canvas-design-ai-error">{error}</p> : null}
    </div>
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
