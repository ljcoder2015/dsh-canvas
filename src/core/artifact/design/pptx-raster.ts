/**
 * dsh-canvas — PPT 那条路：**夹不动**的越界子孙，就地栅格化成一张图片（F10.1，v1.68）。
 *
 * 起因是一句真机反馈：「导出 PPT，文字丢失，每一页应该由可编辑元素组成，不是一整张图片」。
 * 上游 pptx 导出器本来是「可编辑混合导出」，但它有一条**在 root 一层生效、代价极大**的闸：
 * 只要容器开着裁切、又有**任一**子孙越界（>0.5px），它就放弃整页的逐元素转换、把这一页
 * **整页栅格成一张图**（`rootContentFallbackReason` → `clipsOverflowingContent`）。
 * 一次退图 = 这一页的可编辑性全丢 —— 文字、形状、色块全落进那张 PNG，一个字都改不了。
 *
 * v1.66 把其中**直角矩形叶子**那一半夹掉了（`pptx-preclip.ts`，矩形 ∩ 矩形 = 矩形，逐像素
 * 等价），但**夹不动的那一半还留在图上**：圆角矩形（弧总在四角，夹小之后弧跟着挪位）、椭圆
 * （连平直段都没有）、文本（夹宽度会重排）、矢量、带子树的容器。而真机上让整页退图的往往
 * 恰恰是它们——AI 画稿里的卡片几乎都是圆角矩，装饰块又爱贴边。**一个夹不动的越界子孙就够
 * 让整页变图**，于是「修了还是老样子」。
 *
 * 这一份接手的就是那一半。做法只有一句话可讲：
 *
 * > **给它套一个「裁切框」，连同裁切一起画成一张 PNG，再用这张 PNG 顶掉它。**
 *
 * 为什么这是等价的：栅格化画的是**画布上那块区域**（裁切框开裁切、原节点原封不动留在里面），
 * 输出图逐像素就是画布上看到的东西；而图片是**矩形**，夹（=收进裁切框）之后四边都是直角，
 * 裁剪一张位图与裁掉画布上同一块**完全一样**。于是画布外观一个像素不变，而图里不再有越界的
 * 子孙——上游那条 root 闸解开，这一页的其余部分（尤其**所有文字**）重新变成原生元素。
 *
 * 三条边界，都是有意的：
 *
 * 1. **只碰全链轴对齐的那些**（自己到页面的每个祖先都是平移 + 正缩放）。坐标换算因此就是
 *    减法与缩放折算，不必去猜「旋转中心在哪」（节点转过的世界里，改 `x`/`y` 动的是旋转轴，
 *    不是左上角）。转过的越界节点照旧留着——**不改 = 还是老样子（用户看得见），改错 =
 *    把人家的稿子画坏（用户看不出来）**，这条与 v1.66 同一句话。
 * 2. **不当遮罩的不碰**（`isMask`）。遮罩是靠"和兄弟的关系"生效的，把它单独烘成一张图，
 *    兄弟就不再被它裁了——那是真正的画错，不是保真度取舍。
 * 3. **画不出来就回滚**。渲染失败（取不到字面之类）时把图**恢复原样**，让它照旧退图。
 *    半改半不改比这个坏。
 *
 * 与 `pptx-preclip.ts` 的分工：那一份回答「谁越界了、该收进哪个框、夹不夹得动」，这一份只
 * 负责「夹不动的那些怎么落地」。**谁算越界只有一份**（`stubbornOverflows`），两处各写一遍
 * 迟早会一个改了、另一个没跟上。
 *
 * 同样只碰**一次性导出副本**（`exportDesignDocument` 解出来那份图，导完即丢），且只有 PPT
 * 这条路走它。渲染能力由调用方以 `draw` 注入——这一份因此是纯逻辑，判据不必起渲染器。
 */
import { computeImageHash, getWorldMatrix, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { stubbornOverflows, type Box } from './pptx-preclip.ts'

/** 图片填充的底色：图片自己带着内容，这个值不参与合成。 */
const TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 }

export interface RasterizeOutcome {
  /** 已烘成图片、从图里替掉的越界子孙数。 */
  rasterized: number
  /** 整块都在界外、收进 `visible = false` 的（与夹那一步同一个处理）。 */
  hidden: number
  /** 放弃了、原样留着的（照旧会让这一页退图，但画布外观一字未变）。 */
  kept: number
}

/**
 * 把「越界且夹不动」的子孙就地换成一张裁切过的图片。见文件头。
 *
 * `draw` 收一个节点 id、给回它的 PNG 字节（没有就给 `null`）——调用方把它接到引擎的图片
 * 导出上；渲染器在真机上由 `exportDesignDocument` 备好，判据则可以喂一份假的。`scale` 由
 * 调用方给（与图片那条路同一个倍率），这一份不自己再定一个——那正是「同一个东西两个来源」。
 */
export async function rasterizeStubbornOverflows(
  graph: SceneGraph,
  draw: (nodeId: string, scale: number) => Promise<Uint8Array | null>,
  scale: number,
): Promise<RasterizeOutcome> {
  const outcome: RasterizeOutcome = { rasterized: 0, hidden: 0, kept: 0 }

  // 名单先一次取齐：改动过程中会插节点、删节点，边走边扫会漏掉后面的。
  const candidates = stubbornOverflows(graph)
  for (const { node, limit } of candidates) {
    // 前面的候选若是它的祖先，它已经跟着被烘掉了（那正是我们要的结果）。
    if (graph.getNode(node.id) === undefined) continue
    if (node.isMask || node.parentId === null || !chainAligned(graph, node)) {
      outcome.kept += 1
      continue
    }

    const parent = graph.getNode(node.parentId)
    if (parent === undefined) {
      outcome.kept += 1
      continue
    }
    const pm = getWorldMatrix(parent, graph)

    // 烘的范围是「**节点自己** ∩ 裁切祖先边界的交」——不是整个祖先交。
    // 少了这一步，裁切框就长成整个容器，图片里会带上一大片与本节点无关的透明区，还平白
    // 多烘几十倍的像素。（`limit` 给的是后者，夹那一步正需要它；这里要的是两者取交。）
    const self = getWorldMatrix(node, graph)
    const visible = intersect(limit, {
      x: self[2],
      y: self[5],
      w: node.width * self[0],
      h: node.height * self[4],
    })
    // 整块都在界外：画布上它本来就是零可见像素，与 `preclip` 对夹得动的那些一样藏起来。
    if (visible.w <= 0 || visible.h <= 0) {
      node.visible = false
      outcome.hidden += 1
      continue
    }

    const frame = frameBox(visible, pm)

    // 原 z 位：裁切框与后来的图片都占这个位置，图层的叠放次序在画布上什么样，交出去就什么样。
    const index = graph.getChildren(parent.id).findIndex((child) => child.id === node.id)
    if (index < 0) {
      outcome.kept += 1
      continue
    }

    const box = graph.createNode('FRAME', parent.id, {
      name: node.name,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      // 这一条是全部意义所在：它让画出来的图 = 画布上被裁剩的那块。
      clipsContent: true,
      fills: [],
    })
    graph.insertChildAt(box.id, parent.id, index)

    // 挪进裁切框：同一父下的纯平移（链已判过轴对齐），所以只需减去框的偏移。
    const origin = { x: node.x, y: node.y }
    graph.insertChildAt(node.id, box.id, 0)
    node.x -= frame.x
    node.y -= frame.y

    const bytes = await draw(box.id, scale)
    if (bytes === null || bytes.byteLength === 0) {
      // 回滚：还原坐标、挪回原位、拆掉裁切框——照旧退图，但一个像素都没改。
      node.x = origin.x
      node.y = origin.y
      graph.insertChildAt(node.id, parent.id, index)
      graph.deleteNode(box.id)
      outcome.kept += 1
      continue
    }

    // 图片按哈希认：同一个哈希存两次是同一张图，上游的 `extractExportGraph` 也是照它取的。
    const hash = computeImageHash(bytes)
    graph.images.set(hash, bytes)

    graph.deleteNode(box.id)
    const image = graph.createNode('RECTANGLE', parent.id, {
      name: node.name,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      fills: [
        {
          type: 'IMAGE',
          color: TRANSPARENT,
          opacity: 1,
          visible: true,
          imageHash: hash,
          imageScaleMode: 'FILL',
        },
      ],
    })
    graph.insertChildAt(image.id, parent.id, index)
    outcome.rasterized += 1
  }

  return outcome
}

/** 两个世界框的交（宽 / 高为负就是不相交，调用方自己判）。 */
function intersect(a: Box, b: Box): Box {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/** 一个节点的局部框（与 `SceneNode` 同名字段，好直接喂给 `createNode`）。 */
interface LocalBox {
  x: number
  y: number
  width: number
  height: number
}

/** 世界框 → 父局部框（轴对齐链上就是减法 + 缩放折算）。 */
function frameBox(limit: Box, parentWorld: number[]): LocalBox {
  return {
    x: (limit.x - parentWorld[2]) / parentWorld[0],
    y: (limit.y - parentWorld[5]) / parentWorld[4],
    width: limit.w / parentWorld[0],
    height: limit.h / parentWorld[4],
  }
}

/**
 * 自己到页面这条链上，每个节点的世界矩阵都是平移 + 正缩放。
 *
 * 比 `pptx-preclip.ts` 的 `axisAlignedChain` 严：那个只管「自己 + 裁切祖先」（夹只用到这两级
 * 的 AABB），而这里要**按父坐标写回 `x`/`y`**，中间任何一级转过或翻过，这个减法就不再是
 * 它原来的位置。
 */
function chainAligned(graph: SceneGraph, node: SceneNode): boolean {
  let cursor: SceneNode | null | undefined = node
  while (cursor !== null && cursor !== undefined) {
    const m = getWorldMatrix(cursor, graph)
    const aligned =
      Math.abs(m[1]) <= 1e-6 && Math.abs(m[3]) <= 1e-6 && m[0] > 1e-6 && m[4] > 1e-6
    if (!aligned) return false
    cursor = cursor.parentId === null ? null : graph.getNode(cursor.parentId)
  }
  return true
}
