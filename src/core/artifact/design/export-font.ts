/**
 * dsh-canvas — 交出去之前，把字体名换成对方认得的那一个（F10.1，v1.60→v1.61）。
 *
 * 设计稿里的字体名是**我们自己这边的东西**：拉丁字面是 `Inter`（core 的
 * `DEFAULT_FONT_FAMILY`），汉字靠仓库 vendored 的 `Noto Sans SC` 回落——两者都只活在本插件
 * 的资产路由里。画布上看得见，**别人的机器上没有**。
 *
 * 四条出路里三条要把这个名字**交出去**，而三条栽的姿势各不相同：
 *
 * - **PPT** 的原生文本（`addEditableText`）把文字连同 `typeface` 交给**对方的 PowerPoint**
 *   去排。写 `Inter` 的结果是对方找不到这支字体，而它根本没有汉字字形，中文整段丢——v1.60
 *   真机报的「导出 PPT，第一页的字体丢失」（只有第一页，因为后面几页的文字落进了图片回退，
 *   那部分是我们自己画的）。
 * - **fig** 的写器按 `node.fontFamily` 去 `fontManager` 取**字形轮廓**、烘进节点的
 *   `derivedTextData`（上游 `getGlyphOutlineMetricsSync`，**不做任何回落**）。写着 `Inter`
 *   去取汉字，九个字全落进 `.notdef`——同一个 738 字节的轮廓被写九遍，Figma 打开是一串同一个
 *   形状。v1.61 真机报的「导出 Figma 文件…文字渲染不正确」就是它。
 * - **PDF** 的文字在 SVG 里是 `<text font-family="…">`，由 svg2pdf 按 `pdf.getFontList()`
 *   找字体；找不到**一律回落 `times`**，而 Type1 标准字体没有汉字字形——中文被当单字节写进
 *   内容流，解开产物看到的是 `(N;ÆÉÿO`Y}ÿ¾` 这种东西。
 *
 * 图片（PNG）那条**不换**：字是我们自己画的，那个名字在那边是「拿去 `fontManager` 找字面」
 * 用的，换掉反而画不出字。
 *
 * 于是这张表就是「哪条路换到哪个名字」——一处说了算，判据才能点名测到它。
 */
import type { SceneGraph } from '@open-pencil/scene-graph'

/**
 * PPT 统一用的字体名——**不是**设计稿里那个。
 *
 * 写英文名而不是「微软雅黑」：OpenXML 的 `typeface` 按字族的英文名解析，各语言版本的
 * PowerPoint 与 WPS 都认它。选它是因为中文 Windows 与 WPS 必然装着它，Mac 上会替换成系统
 * 黑体（观感一致），而它本身是一支黑体、与设计稿那套「Inter + 思源黑体」最接近。
 */
export const PPT_TEXT_FAMILY = 'Microsoft YaHei'

/**
 * 仓库 vendored 那支中文字面在 `fontManager` 里的名字。
 *
 * **两端共用这一个常量**：客户端按它 `markLoaded` 与 `setCJKFallbackFamily`
 * （`design-skia.ts`），fig 与 PDF 两条路按它取字面/字形。两处各写一遍字符串正是
 * 「同一个东西两个来源」那个老毛病——漂移之后是一个查不出来的静默失败。
 */
export const CJK_TEXT_FAMILY = 'Noto Sans SC'

/**
 * PDF 文档里那个字体 id（jsPDF `addFont` 的第二个参数，也是 SVG 的 `font-family` 要写的
 * 那一个）。
 *
 * 不叫 `Noto Sans SC` 是因为 `svg2pdf` 拿 `font-family` 整串去 `getFontList()` 里**逐字**
 * 找键：名字必须是注册时那个 id，多一个空格都对不上。
 */
export const PDF_TEXT_FAMILY = 'NotoSansSC'

/** 换字体名的两件事：换成什么，以及要不要顺手把字重收一收。 */
export interface ExportTextRetarget {
  family: string
  /**
   * 要不要把字重收成 400 / 700 两档。
   *
   * **只对 PDF 为真**，两个理由叠在一起：我们手里只有一支 `NotoSansSC-Regular`，任何字重
   * 画出来都是它；而 svg2pdf 对第三档字重会算出一个谁也不认的样式名（jsPDF 4 那支分支是
   * `(fontWeight + '') + fontStyle`，500 出来就是 `'500normal'`），那一格没注册就会**回落
   * `times`**——又变回这次要修的那个毛病。收成两档之后样式名只可能是 normal / bold /
   * italic / bolditalic，正好是 {@link pdfTextStyles} 会注册的那几个。
   *
   * PPT 与 fig 不收：它们的字重是交给对方**合成**的（PowerPoint 有雅黑 Bold，Figma 有
   * Noto Sans SC Bold），收掉等于白丢信息。
   */
  snapWeight: boolean
}

/**
 * 「哪条路换到哪个名字」。表里没有的格式就是**不换**（图片；或压根不是交出去的格式）。
 *
 * 单独做成一张表而不是埋在调用点的 `if` 里：一来「只有这三条要换、各换成什么」这件事本身
 * 该被判据点名测到，二来加第四条出路时改动只落在这一行。
 */
const EXPORT_TEXT_RETARGET: Readonly<Record<string, ExportTextRetarget>> = {
  pptx: { family: PPT_TEXT_FAMILY, snapWeight: false },
  fig: { family: CJK_TEXT_FAMILY, snapWeight: false },
  pdf: { family: PDF_TEXT_FAMILY, snapWeight: true },
}

/** 这个格式交出去之前要做什么；不换就是 `null`。 */
export function exportTextRetarget(format: string): ExportTextRetarget | null {
  return EXPORT_TEXT_RETARGET[format] ?? null
}

/** 收字重的那一档：700 及以上算粗，其余算常规。 */
function snapWeight(weight: number): number {
  return weight >= 700 ? 700 : 400
}

/**
 * 把图里所有文字的字体名换成 `retarget.family`。
 *
 * **逐段（`styleRuns`）一起换**：run 上显式的 `fontFamily` / `fontWeight` 会盖过节点那一个
 * （三条路的写器都是 `s.fontFamily ?? node.fontFamily` 这个写法），漏掉它等于漏掉那些被单独
 * 设过字体的文字。
 *
 * **就地改**：这份图是这一趟导出自己解码出来的，用完即弃，没有第二个读者。
 */
export function retargetTextFonts(graph: SceneGraph, retarget: ExportTextRetarget): void {
  visitText(graph, (node) => {
    node.fontFamily = retarget.family
    if (retarget.snapWeight) node.fontWeight = snapWeight(node.fontWeight)
    for (const run of node.styleRuns) {
      if (run.style.fontFamily !== undefined) run.style.fontFamily = retarget.family
      if (retarget.snapWeight && run.style.fontWeight !== undefined) {
        run.style.fontWeight = snapWeight(run.style.fontWeight)
      }
    }
  })
}

/**
 * 这份设计稿会用到哪几个字面样式名（jsPDF 那四个：`normal` / `bold` / `italic` /
 * `bolditalic`）。`normal` 永远在——SVG 不带 `font-weight` 时 svg2pdf 算出来的就是它。
 *
 * **调用点必须在 {@link retargetTextFonts} 之后**：它读的就是那份换过名字、收过字重的图，
 * 而 svg2pdf 也正是照那份图算样式名的——两处读同一份事实，才不会一个注册 `normal`、
 * 另一个去找 `500normal`。
 *
 * 只注册用得上的那几个：`addFont` 会把 18MB 的中文字面**整个解析一遍**，为一份没有粗体也
 * 没有斜体的稿子多解析三遍不值当。
 */
export function pdfTextStyles(graph: SceneGraph): string[] {
  const styles = new Set<string>(['normal'])
  visitText(graph, (node) => {
    addStyle(styles, node.fontWeight, node.italic)
    for (const run of node.styleRuns) {
      addStyle(styles, run.style.fontWeight ?? node.fontWeight, run.style.italic ?? node.italic)
    }
  })
  return [...styles]
}

function addStyle(styles: Set<string>, weight: number, italic: boolean): void {
  const bold = weight >= 700
  styles.add(italic ? (bold ? 'bolditalic' : 'italic') : bold ? 'bold' : 'normal')
}

/** 走一遍图里所有文字节点（页面 → 子节点，逐层下潜）。 */
function visitText(graph: SceneGraph, visit: (node: TextNode) => void): void {
  const walk = (parentId: string): void => {
    for (const node of graph.getChildren(parentId)) {
      walk(node.id)
      if (node.type === 'TEXT') visit(node)
    }
  }
  for (const page of graph.getPages()) walk(page.id)
}

/** `graph.getChildren` 给回来的那个形状里，这段逻辑用到的部分。 */
type TextNode = ReturnType<SceneGraph['getChildren']>[number]
