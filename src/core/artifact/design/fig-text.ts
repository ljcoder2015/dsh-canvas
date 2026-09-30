/**
 * dsh-canvas — fig 那条路：交出去之前，把**写器会烘歪的文本**改写成「一行一个节点」（F10.1，v1.65）。
 *
 * 这一条与 PDF 那条（`pdf-svg.ts`）同源：都是「把中间产物改成转写器画得对的样子」。区别在于
 * 对方错在哪一层——
 *
 * - **PDF** 错在「一个 `<text>` 装整段」（上游 SVG 不折行），修法是往 SVG 里补行。
 * - **fig** 错在**烘字形**这一步（上游 `buildDerivedTextData`，见下），修法只能是**改输入**：
 *   让每个文本节点都变成它烘得对的那种形状。
 *
 * v1.64 真机报的「导出 Figma 文件，文字不会换行、文字错位、部分文字不渲染、渲染成一个方块」，
 * 三条症状同一个根：fig 写器把 `node.text`（**含换行符的整段**）一次性丢进
 * `font.forEachGlyph`，然后把**所有**字形按同一行摆：
 *
 * ```
 * position: { x: glyph.x || index * glyphAdvance, y: lineHeight }   // y 是常量
 * baselines: [{ firstCharacter: 0, endCharacter: text.length - 1, position: { x: 0, y: lineHeight } }]
 * ```
 *
 * 于是：**第 2 行起的字全落在第一行的基线上**（画布里是错位——几句叠在一起）；`baselines` 只有
 * 一条 ⇒ 这份文件对任何消费者都只有一行（**不折行**）；`\n` 在 cmap 里没有码位，落到 `.notdef`，
 * 它的轮廓也被照烘不误（**一个方块**）。这个烘法只对**单行**文本成立。
 *
 * 而写器**另一条**分支（节点自己带 `derivedTextGlyphs` —— 从真 Figma 文件导进来的文字）是
 * 逐字带坐标的，本来就没有这个毛病。那条分支要的是编码好的几何 blob，我们没有（
 * `encodePathCommandsBlob` 只从 `@open-pencil/fig` 内部露出来）。
 *
 * 所以这里走「**把节点改写成单行**」：拿**画布自己那份段落**的逐行量（`LineMetrics`：字符区间、
 * 行左边缘、行宽、基线），把一段多行文字拆成 N 个单行节点，每个都摆到它那一行画布上所在的
 * 位置、并把 `textAlignHorizontal` 收到 `LEFT`。这样写器那条「单行」的烘法对**每一行**都成立，
 * 而 `baselines` / `glyphs` / `textData.lines` / `layoutSize` 四个字段自洽——谁信谁都一样。
 *
 * **对齐是同一个毛病的另一面**（v1.65 接着真机报的「圆角矩里的居中文字导出后变居左」）：写器
 * 烘字形时坐标是**从节点原点起算**的——`position.x = glyph.x || index * glyphAdvance`，第一个字
 * 恒为 0；`position.y = lineHeight`，等于把垂直对齐当 `TOP` 处理。于是「居中 / 右对齐」「垂直居中 /
 * 靠底」这几件事，在 `.fig` 里只剩下节点上那个 `textAlignHorizontal` 字段还写着，而字形坐标是按
 * 左上对齐烘的——两处说的不是同一件事，谁听谁的都由对方定。一条**单行居中**的按钮标签于是成了
 * 最干净的反例：字符区间、行宽、字体、摘要全对，唯独「画在框中间」这件事没进产物。
 *
 * 所以「值得改写」的判据**不是行数**，而是「**写器这么烘，会不会跟画布上画的不一样**」（判据在
 * `worthRewriting`）：多行会（`baselines` 只写一条），对齐偏移非零也会（那段偏移烘不进去）；
 * 两条都不占的节点（单行 + 左上对齐，正是写器唯一烘得对的那种形状）一个字段都不碰。
 *
 * 折行**不由这里决定**：`LineMetrics` 是画布（CanvasKit 段落）自己排出来的，这里只搬运。
 * 这就是「与画布一致」最省事的证法——同一份排放，只是一次换成 N 个节点。
 *
 * **已知项**：两端对齐（`JUSTIFIED`）的多行文字在 `.fig` 里会按左对齐烘——段间那点拉伸是
 * **排版器**算出来的，而写器的 `position.x` 只认字形自己的进距。要在 Figma 里也拉开，得自己造
 * `derivedTextGlyphs`（逐字带坐标），而那份几何 blob 只有 `@open-pencil/fig` 内部能编码
 * （`encodePathCommandsBlob` 没从包的 exports 露出来）。从第一版起就如此，不是这一版引入的
 * （技术文档 §十二 第 10 条）。
 *
 * 全部是纯函数（喂一份 `FigTextLine[]` 就能测），DOM 与场景图的改动留在 `design-io.ts` 那一侧。
 */
import type { SceneNode, StyleRun, TextAlignVertical } from '@open-pencil/scene-graph'
import { weightToStyle } from '@open-pencil/scene-graph'

/**
 * 画布那侧一行文字的量——**原样来自 CanvasKit 的 `LineMetrics`**。
 *
 * 取的就是这四个字段，因为拆行只用到它们：哪几个字符是一行、这一行画在哪里、多宽、基线多高。
 * 其余（`ascent` / `descent` / `isHardBreak` …）这里不需要，也就不接过来。
 */
export interface FigTextLine {
  /** 原文里的起始字符下标（含）。 */
  start: number
  /** 结束下标（不含）。 */
  end: number
  /** 行左边缘，相对段落原点——**已经含对齐**（居中/右对齐的偏移就在这个值里）。 */
  left: number
  /** 行宽。 */
  width: number
  /** 基线距段落顶的距离。 */
  baseline: number
}

/** 拆出来的一行：要写进新节点的那几个字段（其余属性由调用方从原节点克隆）。 */
export interface FigLineNode {
  /** 这一行的文字（原文切片，行内不含换行符）。 */
  text: string
  /** 画布上这一行的绝对位置（父坐标系）。 */
  x: number
  y: number
  /** 按内容宽（贴住这一行），于是对方再怎么排也不会折。 */
  width: number
  height: number
  /** 按本行重排过下标、切过边界的样式段。 */
  styleRuns: StyleRun[]
}

/**
 * 写器烘基线时用的行高——**与它同一个公式**（`node.lineHeight ?? Math.ceil(fontSize * 1.2)`）。
 *
 * 拆行之后每一行都是一个单行节点，写器会把它烘在 `y = lineHeight` 这条基线上；这里要按同一个
 * 数字反推「节点该放在哪」，两个公式必须逐字一致，否则每一行都会差一个行高。
 */
export function figLineHeight(node: { fontSize: number; lineHeight: number | null }): number {
  return node.lineHeight ?? Math.ceil(node.fontSize * 1.2)
}

/**
 * 段落顶相对文本框顶的偏移——**复刻画布那条**（`textVerticalOffset`）。
 *
 * 只有垂直居中/靠底才非零：内容比框矮时那段余量按半、按整让出去。拆行之后每行都自成一个框
 * （`textAlignVertical` 收到 `TOP`、框高就是行高），但**原来那一行画在哪儿**要按这个偏移算。
 */
export function figVerticalOffset(
  node: { height: number; textAlignVertical: TextAlignVertical },
  contentHeight: number,
): number {
  const available = Math.max(0, node.height - contentHeight)
  if (node.textAlignVertical === 'CENTER') return available / 2
  if (node.textAlignVertical === 'BOTTOM') return available
  return 0
}

/**
 * 把一段文字拆成「一行一个节点」的清单；**不值得拆就不拆**（返回 `null`）。
 *
 * 返回 `null` 的几种情形都是「这一份数据我改不动」——按全仓同一条规矩取保守那一边：**不改**的
 * 结果是「还是导出成老样子」（用户看得见），**改错**的结果是把人家的稿子画坏（用户看不出来）。
 *
 * - 这一行在框里**本来就贴着左上、而且只有一行** ⇒ 写器那条烘法本来就对，一个字段都不用动；
 * - 行区间越界/倒挂 ⇒ 下标对不上原文，切出来的字会串行；
 * - 节点带旋转/翻转 ⇒ 拆成 N 个节点之后**旋转轴心变了**，摆出来的位置不再等价；
 * - 文字做过大小写转换（`textCase`）⇒ `LineMetrics` 的下标是**转换后**那条缓冲的，
 *   而 `node.text` 是原文（`ß`→`SS` 这类会改长度），切出来会错位；
 * - 文字在路径上（`textPathData`）⇒ 它有自己的排法，不归这里管；
 * - 节点自带 `derivedTextGlyphs`（从真 Figma 文件读进来的）⇒ 那份烘焙本来就是对的，别动。
 *
 * 于是「能画对的还是原来那样」：这一版只碰**画布上一眼能看出会被烘歪**的那些文字。
 */
export function figLineNodes(
  node: SceneNode,
  lines: readonly FigTextLine[],
  contentHeight: number,
): FigLineNode[] | null {
  if (node.type !== 'TEXT' || node.text.length === 0) return null
  if (node.rotation !== 0 || node.flipX || node.flipY) return null
  if (node.textCase !== 'ORIGINAL') return null
  if (node.textPathData !== null) return null
  if ((node.derivedTextGlyphs?.length ?? 0) > 0) return null
  if (!linesAgreeWithText(lines, node.text.length)) return null

  const lineHeight = figLineHeight(node)
  const vertical = figVerticalOffset(node, contentHeight)
  if (!worthRewriting(lines, vertical)) return null

  const plans: FigLineNode[] = []
  for (const line of lines) {
    const end = trimBreak(node.text, line.start, line.end)
    const text = node.text.slice(line.start, end)
    // 空行（`\n\n` 中间那一段）不产节点：它画不出任何东西，留一个空文本框只是噪音。
    if (text.trim() === '') continue
    plans.push({
      text,
      // 行左边缘已经含对齐（居中/右对齐的那段偏移就在里面），所以新节点一律左对齐，**不指望
      // 对方把 `textAlignHorizontal` 用上**：那段偏移已经进了这个坐标与下面的 `width`（框贴住
      // 这一行），于是不管对方是按我们烘的字形画、还是自己照字符重排，落点都是画布上那一个。
      x: node.x + line.left,
      // 写器会把这一行烘在**节点内** `lineHeight` 那条基线上（它把垂直对齐当 TOP）；要让那条
      // 基线落在画布上这一行的基线上，节点就得往上让出「框内基线高 − 画布上这一行的基线」。
      // 这里的 `lineHeight` 必须**与原节点字段一致**（拆行不改它）——写器用的就是这个数。
      y: node.y + vertical + line.baseline - lineHeight,
      width: Math.max(1, line.width),
      height: lineHeight,
      styleRuns: sliceStyleRuns(node.styleRuns, line.start, end),
    })
  }
  return plans.length > 0 ? plans : null
}

/**
 * 这一份文字**值不值得改写**——即「照写器那条烘法烘出来，会不会跟画布上不一样」。
 *
 * 判据只有两条，对应写器烘字形时那两处「从节点原点起算」：
 *
 * - **多行**：`baselines` 只写一条（`[0…text.length-1]`），第 2 行起的字全叠在第一行的基线上，
 *   而且是横向一路排下去——画布上是几行，`.fig` 里是一行。
 * - **对齐偏移非零**：`position.x` 从 0 起、`position.y` 恒为 `lineHeight`。水平居中/右对齐那段
 *   偏移、垂直居中/靠底那段偏移，在这里都烘不进去——单行居中文字是最干净的反例。
 *
 * 两条都不占的（单行 + 左上对齐）**一个字段都不碰**：那是写器唯一烘得对的那种形状，动它只会
 * 引入新差异。
 *
 * 阈值取 0.01：`LineMetrics` 给的偏移是浮点，左上对齐时未必恰好是 `0.000`（可能有个 1e-7 级
 * 的舍入），而真正的对齐偏移至少是半个字宽——两边差着好几个数量级，不需要更细的界。
 */
function worthRewriting(lines: readonly FigTextLine[], vertical: number): boolean {
  if (lines.length > 1) return true
  if (Math.abs(vertical) > ALIGN_EPSILON) return true
  return lines.some((line) => Math.abs(line.left) > ALIGN_EPSILON)
}

/** 视作「没有偏移」的界（见 `worthRewriting`）。 */
const ALIGN_EPSILON = 0.01

/**
 * 行区间必须逐条落在原文里、且**不回退**（顺序与画布一致）。
 *
 * 这是「对不上就不动」的那道闸：`LineMetrics` 给的是**渲染缓冲**上的下标，一旦它与 `node.text`
 * 不是同一套坐标（大小写转换、连字、以后上游换排版器），切出来的字就会串到隔壁行去——那种
 * 错误画出来是「文字内容变了」，比不拆坏得多。
 */
function linesAgreeWithText(lines: readonly FigTextLine[], length: number): boolean {
  let cursor = 0
  for (const line of lines) {
    if (!Number.isInteger(line.start) || !Number.isInteger(line.end)) return false
    if (line.start < cursor || line.end < line.start || line.end > length) return false
    cursor = line.end
  }
  return true
}

/** 硬换行那一行的区间可能含着换行符——它是分隔符不是字，末尾收掉。 */
function trimBreak(text: string, start: number, end: number): number {
  let at = end
  while (at > start && (text[at - 1] === '\n' || text[at - 1] === '\r')) at -= 1
  return at
}

/**
 * 把样式段切到这一行的区间上，并把下标重排成本行的相对位置。
 *
 * **必须切**：写器按 `charIds`（逐字符的样式段下标）写 `characterStyleIDs`，段的下标是相对
 * `textData.characters` 的——那串字符现在是**这一行**，留着原来那套下标就会把样式涂到隔壁字符上。
 */
export function sliceStyleRuns(runs: readonly StyleRun[], start: number, end: number): StyleRun[] {
  const sliced: StyleRun[] = []
  for (const run of runs) {
    const from = Math.max(run.start, start)
    const to = Math.min(run.start + run.length, end)
    if (to <= from) continue
    sliced.push({ start: from - start, length: to - from, style: run.style })
  }
  return sliced
}

/**
 * 这份稿子用到的**样式名**（`Regular` / `Bold` / `Medium Italic` …），去重、稳定序。
 *
 * 为什么要有这一问：fig 写器取字形轮廓与字体摘要都按 `node.fontFamily` + 样式名去
 * `fontManager` 找字面。我们手里只有仓库 vendored 的**一支** Noto Sans SC（Regular），
 * 稿子里写着 700 的字会去问 `'Noto Sans SC' | 'Bold'`——找不到就返回 `null`，于是
 * **那个节点的字形数组是空的、摘要也是空的**（v1.64 真机报的「部分文字不渲染」正是它）。
 * 调用方按这张表把同一份字节按每个用到的样式名登记一次，字形与摘要就都在了。
 */
export function figTextStyles(graph: { getAllNodes(): Iterable<SceneNode> }): string[] {
  const styles = new Set<string>()
  for (const node of graph.getAllNodes()) {
    if (node.type !== 'TEXT') continue
    styles.add(weightToStyle(node.fontWeight, node.italic))
    for (const run of node.styleRuns) {
      styles.add(weightToStyle(run.style.fontWeight ?? node.fontWeight, run.style.italic ?? node.italic))
    }
  }
  return [...styles].sort()
}
