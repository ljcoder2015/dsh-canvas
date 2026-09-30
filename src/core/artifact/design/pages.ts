/**
 * dsh-canvas — 页面（F2.8）：一份设计文档里一页一份，画布一次只画**当前页**。
 *
 * 四件事里三件上游（`@open-pencil/core` 的 page actions）已经给了——切页、新建、删除、
 * 重命名。**复制没有**，所以那份机制住在这里：建一张新页，把源页整棵子树搬过去，插在源页
 * **后面**（上游 `addPage` 只会追加到末尾，复制出来的页该贴在原件旁边），再把名字取成
 * 「X 副本」。上游的 `addPage` 是「建一张空页并切过去」，复制要的是「建页 + 照搬 + 切过去」，
 * 后两步得自己接。
 *
 * 这一层是**纯**的：只认一张 `SceneGraph`，不碰编辑器状态、不碰 DOM——切页那一步是编辑器
 * 的事，留在引擎里（`design-engine.ts`）。于是判据能在 node 下拿一张真图跑
 * （`tests/core/artifact/design/pages.spec.ts`），不靠读源码文本。
 *
 * 为什么删除要单独说一句：上游的 `deletePage` 是**直接** `graph.deleteNode`，**不进撤销栈**
 * （`addPage`/`renamePage` 同样不进）。所以「删掉一页」在真机上是一去不回的，面板那一层的
 * 二次确认不是装饰（`canRemovePage` 只答「还剩几页」，能不能删的另一半在面板里）。
 */

import type { SceneGraph } from '@open-pencil/scene-graph'

/** 新建页的默认名：「页面 N」，N 取**第一个空位**（改过名的页不占号，撞不出重名）。 */
export function newPageName(taken: readonly string[]): string {
  const used = new Set(taken)
  let index = 1
  while (used.has(`页面 ${index}`)) index += 1
  return `页面 ${index}`
}

/**
 * 复制页的名字：「X 副本」，撞了再添序号（`X 副本 2`）——与 Figma 中文版同一口径。
 *
 * 判据是**拿去比一整份名单**，不是「有没有『副本』这两个字」：复制一份「页面 1 副本」得到
 * 的该是「页面 1 副本 副本」还是「页面 1 副本 2」，取决于现有名单里有什么。
 */
export function copyPageName(name: string, taken: readonly string[]): string {
  const used = new Set(taken)
  const base = `${pageLabel(name)} 副本`
  if (!used.has(base)) return base
  let index = 2
  while (used.has(`${base} ${index}`)) index += 1
  return `${base} ${index}`
}

/**
 * 页面行上显示的名字。
 *
 * 空名的页只有一种来路：模型手写的文档（面板的改名不许改成空——引擎那一格直接不放行）。
 * 灰着一行什么都没有比随手编个名字更糟：至少得让人看见「这里有一页，没名字」。
 */
export function pageLabel(name: string): string {
  return name === '' ? '未命名页面' : name
}

/**
 * 还能不能删：一份文档**至少留一页**。
 *
 * 上游 `deletePage` 自己也会拒（`pages.length <= 1` 直接 return），但面板得**先问这一句**——
 * 不然点下去什么都不发生（面板那枚按钮点了没反应，是这一族里最难查的一种）。两处判据同源
 * 是巧合，不同源时以这里为准：这枚按钮的可见性只认这个函数。
 */
export function canRemovePage(pageCount: number): boolean {
  return pageCount > 1
}

/**
 * 复制一页：新页 + 源页整棵子树，插在源页后面；返回新页 id。
 *
 * - `cloneTree` 已经是**深**拷贝（孙辈一起走），所以逐个顶层子节点各来一次就够，不必自己
 *   递归；新页里的节点拿到的是**新 id**（`cloneTree` 会把 `source.id` 清掉），源页一个
 *   字节不动——这正是「复制」与「移动」的分界。
 * - 插位用 `insertChildAt(copy, rootId, at + 1)`：先从末尾摘下来再插，下标按**摘掉之后**
 *   的名单算，所以 `at + 1` 落的正是源页右侧那一格。
 * - 传进来的不是一页（画布上任何别的节点都不是 `CANVAS`）就什么也不做，返回 `null`——
 *   页面这一层的四个操作只认页面。
 */
export function duplicatePageIn(graph: SceneGraph, pageId: string): string | null {
  const source = graph.getNode(pageId)
  if (source === undefined || source.type !== 'CANVAS') return null
  const pages = graph.getPages()
  const copy = graph.addPage(copyPageName(source.name, pages.map((page) => page.name)))
  for (const childId of [...source.childIds]) graph.cloneTree(childId, copy.id)
  const at = pages.findIndex((page) => page.id === pageId)
  if (at >= 0) graph.insertChildAt(copy.id, graph.rootId, at + 1)
  return copy.id
}
