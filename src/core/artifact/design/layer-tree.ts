/**
 * dsh-canvas — 图层树的展开状态（F2.9，v1.67）：**默认折叠**。
 *
 * 图层面板照 Figma 那一栏来：一进来**所有带子节点的行都是折着的**（只看得见顶层那几个
 * 画板），点箭头才展开。真机上「一进来铺开几百行」不是信息更多，是**看不见结构**——第 1 屏
 * 全被第一个画板的子节点占满，而用户此刻要的是「这份稿子里有几个东西」。
 *
 * 状态拆成两份，各管一件事：
 *
 * - `collapsed`：**现在折着**的那些 id（渲染就看它）。
 * - `seen`：**已经被「默认折叠」处理过**的那些 id。它挡的是「刷新时又把用户展开过的收回去」
 *   ——画布每落一次盘就换一份快照，若每次都重算「可展开 ⇒ 折叠」，用户刚点开的容器会自己
 *   折上。所以规矩是：**新出现的节点默认折叠，动过的（展开过或折叠过）不再自动改**。
 *
 * 于是四条路都自洽：首次挂载全折叠；新建的容器下一次快照进来是折叠的；用户点开的不再自己
 * 折回；画布上点选时把选中项的**祖先**展开（那条在面板里，见 `design-panels.tsx`）之后，
 * 刷新也不会把它收回去。
 *
 * 这一层是**纯**的：只认一个 `{ id, children }` 的形状（`DesignLayerNode` 结构上就兼容），
 * 不碰场景图、不碰 React——于是判据能在 node 下拿真数据跑，不必起浏览器。
 */

/** 判别形状：这棵树里凡是带子节点的都算「可展开」。 */
export interface LayerTreeNode {
  id: string
  children: readonly LayerTreeNode[]
}

export interface LayerCollapseState {
  /** 现在折着的节点 id。 */
  collapsed: ReadonlySet<string>
  /** 已经被「默认折叠」处理过的节点 id——动过的不再自动改。 */
  seen: ReadonlySet<string>
}

/** 一份空状态（每个面板实例各拿一份，别共享同一个可变对象）。 */
export function emptyCollapse(): LayerCollapseState {
  return { collapsed: new Set(), seen: new Set() }
}

/**
 * 图换了之后，把**新出现的**可展开节点收进折叠集合。没有新节点就**原样返回入参**
 * （引用相等——省掉一次无意义的重渲染）。
 */
export function withNewNodesCollapsed(
  layers: readonly LayerTreeNode[],
  state: LayerCollapseState,
): LayerCollapseState {
  const collapsed = new Set(state.collapsed)
  const seen = new Set(state.seen)
  let changed = false

  const walk = (nodes: readonly LayerTreeNode[]): void => {
    for (const node of nodes) {
      if (node.children.length > 0 && !seen.has(node.id)) {
        seen.add(node.id)
        collapsed.add(node.id)
        changed = true
      }
      walk(node.children)
    }
  }
  walk(layers)

  return changed ? { collapsed, seen } : state
}

/** 点箭头：折着的展开、开着的折上。**两向都记进 `seen`**（动过的就不再自动改）。 */
export function toggleCollapse(state: LayerCollapseState, id: string): LayerCollapseState {
  const collapsed = new Set(state.collapsed)
  const seen = new Set(state.seen)
  seen.add(id)
  if (collapsed.has(id)) collapsed.delete(id)
  else collapsed.add(id)
  return { collapsed, seen }
}

/** 展开这些节点（画布上点选时，把选中项的祖先让出来）。已展开的照旧。 */
export function expandNodes(
  state: LayerCollapseState,
  ids: Iterable<string>,
): LayerCollapseState {
  const collapsed = new Set(state.collapsed)
  const seen = new Set(state.seen)
  let changed = false
  for (const id of ids) {
    // `seen` 也记一笔（**兜底**）：常规路径上这些祖先早就在 `seen` 里了（初次折叠时一并加的），
    // 但如果有一份状态还没经过 `withNewNodesCollapsed`，不记它就会在下一次快照进来时被折回去
    // ——用户正指着它。幂等，代价只有一次 Set 写入。
    if (!seen.has(id)) {
      seen.add(id)
      changed = true
    }
    if (collapsed.delete(id)) changed = true
  }
  return changed ? { collapsed, seen } : state
}
