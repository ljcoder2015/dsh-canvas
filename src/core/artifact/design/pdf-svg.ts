/**
 * dsh-canvas — PDF 那条路：交出去之前把矢量图修三处（F10.1，v1.64）。
 *
 * PDF 是四条出路里唯一「把矢量图交给**别人的排版器**」的一条：我们画 SVG，`svg2pdf` 逐元素
 * 转写成 PDF 内容流。而那条链上游有三处假设与**画布**不一致——三处都不报错，只是画出来
 * 不一样（v1.64 真机报的「导出 PDF，文本换行，和圆角矩形渲染不正确」）：
 *
 * **一、文本不折行。** 上游 `renderTextNode` 把整段文字放进**一个** `<text>`（`y` 只有
 * 第一行那个基线），而画布那道（CanvasKit / skia 段落排版）是按节点宽度折行的。于是同一
 * 份稿子：画布上三行，PDF 里一行、一路冲出容器右边界。折行必须在这里补——PDF 这条路**不
 * 过 CanvasKit**（它只要字体字节），拿不到 skia 的排版结果，而 `svg2pdf` 也不折行。
 * {@link wrapTextLines} 给的是**字符区间**（`[start, end)`），样式由调用方按 `styleRuns`
 * 去切——这样这个模块不必知道 `styleRuns` 长什么样。
 *
 * **二、裁剪丢圆角。** 上游 `buildGroupAttrs` 给 `clipsContent` 的节点生成的
 * `<clipPath>` 是**直角** `<rect>`（只有 width/height，没有 rx/ry）。圆角容器里铺满的子块
 * 于是把四个圆角**填平**：画布上四角露白底、PDF 里是一个直角矩形。
 * {@link clipOrder} 给出「上游会为哪些节点生成 clipPath」的**顺序**，接线按它把 rx/ry 补
 * 回去（顺序之外还要比尺寸，见 `design-pdf.ts`）。
 *
 * **三、超半轴圆角夹法不同。** 画布（skia 的 `RRect`）把超限的圆角**整体按比例缩**，而
 * SVG 规范是 `rx` 夹到 `w/2`、`ry` 夹到 `h/2`**各自**夹——一个 200×140、半径 100 的矩形
 * 画布上是超椭圆、PDF 里成了正椭圆。{@link clampRadius} 复刻画布那一条。
 *
 * 三件事都只读事实、不碰 DOM：折行要一个注入的 `measure`（判据里给假测量器就能测），
 * 顺序遍历只要 `getNode` / `getChildren`。`design-pdf.ts` 负责把结果落到 DOM 上。
 */
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

/**
 * 没写行高时用的倍数。
 *
 * 画布那道用的是 skia 字体度量（随字面变），这里只有一个字号可用。要的是**折行位置**一致
 * （那由 {@link wrapTextLines} 的宽度测量保证，用的是同一个字体），行距差一点点不改变
 * 「几行、在哪断」这件事——而用户看到的「没有换行」正是那件事。
 */
export const DEFAULT_LINE_HEIGHT = 1.2

/** 一行的字符区间（`[start, end)`，相对原文）。 */
export interface TextLine {
  start: number
  end: number
}

/**
 * 逐字符测量的函数（`design-pdf.ts` 用 jsPDF 的 `getStringUnitWidth` 接）。
 *
 * 注入是为了让折行这件事**在 node 里可测**：判据给一个「一字 10pt」的假测量器，折行的
 * 边界、回退、硬断就全能点名验。
 */
export type MeasureText = (slice: string) => number

/** 这些区段的字符可以在**任意两个之间**断行（中日韩与全角标点）。 */
const CJK_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x11ff], // 谚文字母
  [0x2e80, 0x303f], // 部首扩展 / 中日韩符号与标点（含全角句读）
  [0x3040, 0x33ff], // 假名 / 注音 / 中日韩兼容
  [0x3400, 0x4dbf], // 中日韩扩展 A
  [0x4e00, 0x9fff], // 中日韩统一表意
  [0xa960, 0xa97f], // 谚文字母扩展 A
  [0xac00, 0xd7af], // 谚文音节
  [0xf900, 0xfaff], // 中日韩兼容表意
  [0xfe10, 0xfe6f], // 竖排标点 / 小写变体 / 半角全角形式
  [0xff00, 0xff60], // 全角 ASCII
  [0xffe0, 0xffe6], // 全角符号
]

function isCJK(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0
  return CJK_RANGES.some(([from, to]) => code >= from && code <= to)
}

/** 行内不算内容的空白（`\n` 单独处理：它是硬换行，不是空白）。 */
function isBlank(ch: string): boolean {
  return ch !== '\n' && /\s/.test(ch)
}

/**
 * 按宽度把手写体折成若干行，交回**字符区间**。
 *
 * 规矩（与浏览器的 `word-break: normal` 同一路）：
 * - 中日韩字符**逐字**可断；西文**按词**断（词内不拆，除非一个词本身就超宽）；
 * - 空白留给下一行的行首（所以行内不含尾随空格，`design-pdf.ts` 画出来不会多一截）；
 * - `\n` 是**硬换行**：那一行到此为止，与宽度无关；
 * - 一个断点都放不下（第一个字就超宽，或一个超长英文词）⇒ **硬断**（逐字符取到放不下
 *   为止，至少一个字），否则会死循环。
 *
 * `maxLines` 是 `textAutoResize: 'TRUNCATE'` 用的：放不下的行**直接不生成**（画布上也是
 * 裁掉，不画省略号）。
 */
export function wrapTextLines(
  text: string,
  maxWidth: number,
  measure: MeasureText,
  options: { maxLines?: number } = {},
): TextLine[] {
  const maxLines = options.maxLines ?? Number.POSITIVE_INFINITY
  const lines: TextLine[] = []
  let offset = 0
  // `\n` 先切成段：段内按宽度折，段与段之间是硬换行（空段留一个空行，`\n\n` 的垂直间距
  // 就是画布上那一段空白）。段内不可能再有换行，后面的逻辑只管宽度。
  for (const paragraph of text.split('\n')) {
    if (lines.length >= maxLines) break
    wrapParagraph(paragraph, offset, maxWidth, measure, lines, maxLines)
    offset += paragraph.length + 1
  }
  return lines
}

/** 折一段（不含换行符）。区间都带上 `offset`（相对原文）。 */
function wrapParagraph(
  paragraph: string,
  offset: number,
  maxWidth: number,
  measure: MeasureText,
  lines: TextLine[],
  maxLines: number,
): void {
  if (paragraph === '') {
    // 空行也是占位置的一行（`\n\n` 之间那段垂直空白），但同样受 `maxLines` 约束。
    if (lines.length < maxLines) lines.push({ start: offset, end: offset })
    return
  }
  let cursor = skipBlank(paragraph, 0)
  while (cursor < paragraph.length && lines.length < maxLines) {
    const end = takeWithin(paragraph, cursor, paragraph.length, maxWidth, measure)
    // 兜底：真出现「一行一个字符都放不下」的怪情况也不能原地打转（宁可给它一个字）。
    const safe = end > cursor ? end : cursor + 1
    lines.push({ start: offset + cursor, end: offset + safe })
    if (safe >= paragraph.length) break
    cursor = skipBlank(paragraph, safe)
  }
}

/** 在 `[start, limit)` 里取最长的一段；断在断点上，放不下就回退到上一个断点。 */
function takeWithin(
  text: string,
  start: number,
  limit: number,
  maxWidth: number,
  measure: MeasureText,
): number {
  // 整段放得下：不必找断点。
  if (measure(text.slice(start, limit)) <= maxWidth) return trimEnd(text, start, limit)

  let fitted = -1
  let cursor = start
  while (cursor < limit) {
    const at = nextBreak(text, cursor, limit)
    const end = trimEnd(text, start, at)
    if (end > start && measure(text.slice(start, end)) <= maxWidth) {
      fitted = end
      cursor = at
      continue
    }
    // 一个断点都放不下 ⇒ 硬断（至少一个字，免得空行）。
    if (fitted <= start) return hardCut(text, start, at, maxWidth, measure)
    return fitted
  }
  return fitted === -1 ? limit : fitted
}

/**
 * `from` 之后最近的一个可行断点（exclusive end）。
 *
 * **必须严格大于 `from`**：返回 `from` 会让调用方原地打转（第一版就是这么死循环的——落在一
 * 段空白的开头时返回了自己）。所以空白那一支要**走过整段空白**再报。
 */
function nextBreak(text: string, from: number, limit: number): number {
  let cursor = from
  while (cursor < limit) {
    const ch = text[cursor]!
    if (isCJK(ch)) return cursor + 1
    if (isBlank(ch)) return skipBlank(text, cursor)
    // 西文：先走到词尾，再看落在哪儿。
    while (cursor < limit && !isCJK(text[cursor]!) && !isBlank(text[cursor]!)) cursor += 1
    if (cursor >= limit) return limit
  }
  return limit
}

/** 逐字符硬断：取到放不下为止（至少一个字）。 */
function hardCut(
  text: string,
  start: number,
  limit: number,
  maxWidth: number,
  measure: MeasureText,
): number {
  let at = start + 1
  while (at < limit && measure(text.slice(start, at + 1)) <= maxWidth) at += 1
  return at
}

/** 行尾收在最后一个非空白字符之后（行内不留尾随空格，画出来才不会多一截）。 */
function trimEnd(text: string, start: number, end: number): number {
  let at = end
  while (at > start && isBlank(text[at - 1]!)) at -= 1
  return at
}

/** 跳过空白（下一行不以空白开头）。 */
function skipBlank(text: string, at: number): number {
  let cursor = at
  while (cursor < text.length && isBlank(text[cursor]!)) cursor += 1
  return cursor
}

/**
 * 圆角真正画出来时是多少——**复刻画布的夹法**。
 *
 * skia 的 `RRect` 把超限的圆角**整体按比例缩**（一个统一比例同时作用到 rx 与 ry），结果是
 * `min(r, w/2, h/2)`；而 SVG 的 `rx`/`ry` 是**各自**夹到 `w/2`、`h/2`。200×140 的框给
 * 半径 100：画布上是超椭圆（上下各留 60 的直边），SVG 里 `rx=100 ry=70` 成了一个正椭圆。
 *
 * 数值上正好等于「夹到 `w/2` 与 `h/2` 里更小的那个」——所以把这个值写进 SVG，两边的
 * 夹取就都不起作用了（写进去的已经在范围内）。
 */
export function clampRadius(radius: number, width: number, height: number): number {
  return Math.max(0, Math.min(radius, width / 2, height / 2))
}

/** 一行文字的行高（pt）：节点自己写了就用它，没写按字号估。 */
export function lineHeightOf(node: { fontSize: number; lineHeight: number | null }): number {
  return node.lineHeight ?? Math.round(node.fontSize * DEFAULT_LINE_HEIGHT)
}

/**
 * 上游 `renderNodesToSVG` 会给哪些节点生成 `<clipPath>`——**按它 push 的顺序**。
 *
 * 顺序不是美学，是**配对用**：SVG 里那些 `<clipPath>` 只有 `clip0` / `clip1` 这样的编号，
 * 不带是谁的。而接线要按这个顺序把容器自己的圆角补回去，所以判据必须复刻上游那条遍历：
 * 先序（节点自己先，再它的子树），`!visible` 整棵跳过，条件是
 * `clipsContent && 子节点数 > 0`。
 *
 * 上游那句 `if (!node.visible) return null` 在 `buildGroupAttrs` **之前**：可见性是唯一
 * 的闸门；而 `clipId && childContent.length > 0` 只决定用不用得上，**clipPath 已经进了
 * defs**——所以筛的是「图上有没有子节点」，不是「子节点可不可见」。
 */
export function clipOrder(graph: SceneGraph, nodeIds: readonly string[]): string[] {
  const found: string[] = []
  walk(graph, nodeIds, (node) => {
    if (node.clipsContent && graph.getChildren(node.id).length > 0) found.push(node.id)
  })
  return found
}

/**
 * 上游会画成 `<text>` 的节点——**同一套先序**，用来把折行的结果对回页面上的元素。
 *
 * 反正 `<text>` 的内容就是节点原文，接线那边还会拿内容**再校验一次**（顺序漂了就不改），
 * 两道合起来才敢往 DOM 上写。
 */
export function textOrder(graph: SceneGraph, nodeIds: readonly string[]): string[] {
  const found: string[] = []
  walk(graph, nodeIds, (node) => {
    if (node.type === 'TEXT') found.push(node.id)
  })
  return found
}

/** 先序遍历：顶层是 `nodeIds`（不可见的跳过），逐层下潜。 */
function walk(graph: SceneGraph, nodeIds: readonly string[], visit: (node: SceneNode) => void): void {
  const step = (node: SceneNode): void => {
    if (!node.visible) return
    visit(node)
    for (const child of graph.getChildren(node.id)) step(child)
  }
  for (const id of nodeIds) {
    const node = graph.getNode(id)
    if (node !== undefined) step(node)
  }
}
