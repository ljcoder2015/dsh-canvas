/**
 * dsh-canvas — PPT 那条路：交出去之前，把「会让整页退化成一张图片」的越界预夹掉（F10.1，v1.66）。
 *
 * 上游 pptx 导出器**本来就是「可编辑混合导出」**：文本、矩形、椭圆、直线转成原生
 * PowerPoint 元素（可再次编辑），矢量 / 渐变 / 遮罩才退化成 PNG。但它在 root 一层有一条
 * 极保守的闸：**容器开了裁切（`clipsContent`）、又有子孙真的越界（>0.5px 容差），整页放弃
 * 逐元素转换、栅格成一张图**（`rootContentFallbackReason` → `clipsOverflowingContent`）。
 * 而我们的容器**默认就开裁切**（跟 Figma 的 frame 同一语义，见 `ops.ts` / `document.ts`），
 * AI 画稿时装饰性子块贴边 / 冲出容器又是常态——于是真机上「每一页都是一张图片」。
 *
 * 这条闸保守过头了，因为**越界的那部分在画布上本来就被裁掉、不可见**：上游担心「逐元素
 * 转换后子块露出容器外」露出来的恰恰是画布上不存在的东西。修法于是不是去拦上游，而是
 * **在交出去之前把越界预夹掉**（与 `fig-text.ts` 同一条「改输入」的路）：
 *
 * - 夹的目标是「**它所有裁切祖先**边界**的交**」——不是只夹回最近一层，这样夹完之后
 *   对每一层裁切都不再越界（中间容器那条子树退图的闸也一并解开）。
 * - 夹的合法性是**数学上可证明的视觉等价**，所以只有**直角矩形叶子**这一种形状能夹：
 *   纯色填充、直角、无旋转无翻转、全链（自己到每个裁切祖先）都是平移 + 正缩放——
 *   这几个条件下「矩形 ∩ 矩形 = 矩形」，夹出来的矩形与画布上被裁剩的那块**逐像素一致**。
 *   圆角矩 / 椭圆夹不得：弧总在节点四角，夹小之后**弧跟着挪位**，任何夹法都不等价
 *   （椭圆连平直段都没有）；文本夹不得（夹宽度会重排）；矢量 / 带子树的容器不归这里管。
 *   夹不动的越界子孙**原样留着**：不改 = 还是导出成老样子（用户看得见），改错 = 把人家
 *   的稿子画坏（用户看不出来）。
 * - 整块都落在界外的（画布上零可见像素）：置 `visible = false`，上游直接跳过——也是等价。
 *
 * 越界判定**逐字复刻上游**那套（角点映进裁切祖先的局部空间、比 `[-0.5, w+0.5]`），同一个
 * 容差：夹的判定与闸的判定必须同一把尺子，差一点就会出现「夹了还是退图」或「没越界也白夹」。
 *
 * 只该发生在 PPT 那条路上、且只碰**一次性导出副本**（`exportDesignDocument` 解出来的那份
 * 图，导完即丢）——用户的 `.design` 文件一个字节不动；图片 / PDF / fig 三条路各有各的
 * 保真手段（前两者自己排版，后者拆行），都不夹。
 *
 * **夹不动的那一半交给 `pptx-raster.ts`**（v1.68）：一个夹不动的越界子孙就够让上游把**整页**
 * 栅格成一张图（`== 整份可编辑性全丢 + 所有文字落进图片`）。这一份只回答「谁越界了、该收进
 * 哪个框、夹不夹得动」——**两处共用这一份扫描**（`overflowingNodes`），免得「谁算顽固」在
 * 两个文件里各写一遍而漂移。栅格化那一步自己去问同一份名单。
 */

import { TransformMatrix, getWorldMatrix, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

/** 与上游 pptx 导出器同一个容差（`CLIP_EPSILON_PX`）。 */
const CLIP_EPSILON_PX = 0.5
/** 上游认的「会裁切的容器」三类（`CONTAINER_TYPES`）。页面（CANVAS）不在内。 */
const CLIPPING_TYPES = new Set<SceneNode['type']>(['FRAME', 'GROUP', 'SECTION'])
/** 判「这条链是平移 + 正缩放（无旋转 / 剪切 / 翻转）」的容差。 */
const ALIGN_EPSILON = 1e-6

export interface PreclipOutcome {
  /** 夹掉的越界叶子数（几何已收进裁切边界）。 */
  clipped: number
  /** 整块都在界外、被藏起来的叶子数（`visible` 置 false）。 */
  hidden: number
  /** 越界但夹不动（照旧会触发上游退图）的子孙数——这页若还有它，仍是一张图。 */
  stubborn: number
}

/** 世界坐标下的一个框（轴对齐）。 */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** 一个「越界于某个裁切祖先」的可见节点，连同它该被收进去的那个框。 */
export interface OverflowCandidate {
  node: SceneNode
  /** 它全部的裁切祖先（近 → 远）。 */
  ancestors: SceneNode[]
  /** 世界坐标下「所有裁切祖先边界的**交**」——越界的那块该被收进这里。 */
  limit: Box
}

/**
 * 扫一遍图：哪些可见节点越界于某个裁切祖先、该被收进哪个框。
 *
 * **夹与栅格化共用这一份**——两处各写一遍「谁算越界」，迟早会一个夹了、另一个没跟上，
 * 而症状是「修了还是退图」这种最难查的静默失败。
 */
export function overflowingNodes(graph: SceneGraph): OverflowCandidate[] {
  const out: OverflowCandidate[] = []
  for (const node of [...graph.getAllNodes()]) {
    if (node.type === 'CANVAS') continue
    if (!visibleChain(graph, node)) continue
    const ancestors = clippingAncestors(graph, node)
    if (ancestors.length === 0) continue
    if (!ancestors.some((ancestor) => overflowsAncestor(graph, node, ancestor))) continue
    out.push({ node, ancestors, limit: intersectionOf(graph, ancestors) })
  }
  return out
}

/**
 * 越界、且**夹不动**的那些（`preclipOverflowingRects` 挑剩下的）。
 *
 * 判据与夹那一步逐字同一份（同一个 `clippable`、同一个 `axisAlignedChain`）：栅格化那条路
 * 接手的就是这一步放行不了的人，两边口径一漂，就会出现「夹了一半、栅格化又漏了一半」。
 */
export function stubbornOverflows(graph: SceneGraph): OverflowCandidate[] {
  return overflowingNodes(graph).filter(
    ({ node, ancestors }) => !clippable(node) || !axisAlignedChain(graph, node, ancestors),
  )
}

/**
 * 把图里「越界于某个裁切祖先」的直角矩形叶子预夹进边界交。见文件头。
 *
 * 返回三份计数（判据用：`stubborn === 0` 才意味着这一页不再退图）。
 */
export function preclipOverflowingRects(graph: SceneGraph): PreclipOutcome {
  const outcome: PreclipOutcome = { clipped: 0, hidden: 0, stubborn: 0 }

  for (const { node, ancestors, limit } of overflowingNodes(graph)) {
    if (!clippable(node) || !axisAlignedChain(graph, node, ancestors)) {
      outcome.stubborn += 1
      continue
    }

    // 世界 AABB（链平移 + 正缩放下，原点 + 尺寸×缩放就是全部）。
    const self = getWorldMatrix(node, graph)
    const box = { x: self[2], y: self[5], w: node.width * self[0], h: node.height * self[4] }

    const x1 = Math.max(box.x, limit.x)
    const y1 = Math.max(box.y, limit.y)
    const x2 = Math.min(box.x + box.w, limit.x + limit.w)
    const y2 = Math.min(box.y + box.h, limit.y + limit.h)
    if (x2 <= x1 || y2 <= y1) {
      node.visible = false
      outcome.hidden += 1
      continue
    }

    const parent = node.parentId === null ? null : graph.getNode(node.parentId)
    const pm = parent === null || parent === undefined ? TransformMatrix.identity() : getWorldMatrix(parent, graph)
    node.x = (x1 - pm[2]) / pm[0]
    node.y = (y1 - pm[5]) / pm[4]
    node.width = (x2 - x1) / pm[0]
    node.height = (y2 - y1) / pm[4]
    outcome.clipped += 1
  }

  return outcome
}

/**
 * 复刻上游 `clipsOverflowingContent` 的单点判定：子孙的四个角映进裁切祖先的**局部空间**，
 * 落在 `[-0.5, w+0.5]` 之外才算越界。逐字同式（含「逆不出就当不越界」），于是夹的判定
 * 与闸的判定是同一把尺子。
 */
export function overflowsAncestor(
  graph: SceneGraph,
  node: SceneNode,
  ancestor: SceneNode,
): boolean {
  const toLocal = TransformMatrix.invert(getWorldMatrix(ancestor, graph))
  if (toLocal === null) return false
  const local = TransformMatrix.multiply(toLocal, getWorldMatrix(node, graph))
  const corners = TransformMatrix.mapPoints(local, [
    0,
    0,
    node.width,
    0,
    node.width,
    node.height,
    0,
    node.height,
  ])
  for (let i = 0; i < corners.length; i += 2) {
    if (corners[i] < -CLIP_EPSILON_PX || corners[i] > ancestor.width + CLIP_EPSILON_PX) return true
    if (corners[i + 1] < -CLIP_EPSILON_PX || corners[i + 1] > ancestor.height + CLIP_EPSILON_PX) {
      return true
    }
  }
  return false
}

/**
 * 「夹得动」的**样式**前提，见文件头：直角、纯色、无描边无效果、无子树、不当遮罩。
 *
 * 旋转 / 翻转不在这里管——它们由 `axisAlignedChain` 从**世界矩阵**上统一挡（转过的节点
 * 矩阵里就有非零的 `m[1]`/`m[3]`，翻过的是负的 `m[0]`/`m[4]`），那是「几何等不等价」那条线，
 * 写在这里只会多一份会飘的副本。
 */
function clippable(node: SceneNode): boolean {
  if (node.type !== 'RECTANGLE') return false
  if (node.childIds.length > 0) return false
  if (node.isMask) return false
  const fills = node.fills.filter((fill) => fill.visible)
  if (fills.length > 1) return false
  if (fills.length === 1 && fills[0].type !== 'SOLID') return false
  if (node.strokes.some((stroke) => stroke.visible)) return false
  if (node.effects.some((effect) => effect.visible)) return false
  return true
}

/** 自己到每个裁切祖先的世界矩阵都得是平移 + 正缩放，AABB 求交才与「局部空间角点」同一语义。 */
function axisAlignedChain(graph: SceneGraph, node: SceneNode, ancestors: readonly SceneNode[]): boolean {
  if (!axisAligned(getWorldMatrix(node, graph))) return false
  return ancestors.every((ancestor) => axisAligned(getWorldMatrix(ancestor, graph)))
}

function axisAligned(m: number[]): boolean {
  return (
    Math.abs(m[1]) <= ALIGN_EPSILON &&
    Math.abs(m[3]) <= ALIGN_EPSILON &&
    m[0] > ALIGN_EPSILON &&
    m[4] > ALIGN_EPSILON
  )
}

/** 裁切祖先链（从近到远）：链上可见、类型会裁、且真的开了裁切的那些。 */
function clippingAncestors(graph: SceneGraph, node: SceneNode): SceneNode[] {
  const out: SceneNode[] = []
  let cursor = node.parentId === null ? null : graph.getNode(node.parentId)
  while (cursor !== null && cursor !== undefined) {
    if (
      cursor.visible &&
      cursor.clipsContent &&
      CLIPPING_TYPES.has(cursor.type)
    ) {
      out.push(cursor)
    }
    cursor = cursor.parentId === null ? null : graph.getNode(cursor.parentId)
  }
  return out
}

/** 自己到根全可见（**含自己**——上游那句 `if (!child?.visible) continue` 连自己一起跳）。 */
function visibleChain(graph: SceneGraph, node: SceneNode): boolean {
  let cursor: SceneNode | null | undefined = node
  while (cursor !== null && cursor !== undefined) {
    if (!cursor.visible) return false
    cursor = cursor.parentId === null ? null : graph.getNode(cursor.parentId)
  }
  return true
}

/** 世界 AABB（调用前提：链已判过轴对齐）。 */
function boxFor(graph: SceneGraph, node: SceneNode): Box {
  const m = getWorldMatrix(node, graph)
  return { x: m[2], y: m[5], w: node.width * m[0], h: node.height * m[4] }
}

/**
 * 所有裁切祖先边界**的交**（不只越过的那几层——收进交里才对每一层都不越界）。
 *
 * 前提与 {@link boxFor} 一样：链已判过轴对齐。相交为空时给出宽 / 高为负的框，调用方自己判。
 */
function intersectionOf(graph: SceneGraph, ancestors: readonly SceneNode[]): Box {
  let limit = boxFor(graph, ancestors[0])
  for (let i = 1; i < ancestors.length; i++) {
    const next = boxFor(graph, ancestors[i])
    limit = {
      x: Math.max(limit.x, next.x),
      y: Math.max(limit.y, next.y),
      w: Math.min(limit.x + limit.w, next.x + next.w) - Math.max(limit.x, next.x),
      h: Math.min(limit.y + limit.h, next.y + next.h) - Math.max(limit.y, next.y),
    }
  }
  return limit
}
