/**
 * dsh-canvas — PDF 那条出路：**自己建文档**（F10.1，v1.61）。
 *
 * 上游有一条现成的 `renderNodesToPDF`（`@open-pencil/core/io/formats/pdf`），它做的正是这
 * 里做的事：把选区画成 SVG → `new jsPDF(...)` → `svg2pdf`。但那个函数**不在包的 exports
 * map 里**（从 `@open-pencil/core/io` 露出来的只有 `renderNodesToSVG` / `computeContentBounds`
 * 这些零件），于是我们只能从门面 `IORegistry.exportContent('pdf', …)` 走进去——而那样就够
 * 不着它内部那句 `new jsPDF(...)` 了。
 *
 * 为什么非够着不可：**JS 的字体必须注册在「正要写的那一份文档」上**。svg2pdf 是按
 * `pdf.getFontList()` 找字面的，找不到就回落 `times`（Type1 标准字体，没有汉字字形），
 * 中文于是被当单字节写进内容流——这就是 v1.61 真机报的「导出 PDF…文字渲染不正确」。
 * 我们试过「先随便建一份注册、指望 jsPDF 的全局事件把它带给后面新建的实例」：
 * `jsPDF.API.events` 那条队列**不会**把字体带过去（真测过，新实例的 `getFontList()` 里没有）。
 * 所以这一条只能自己建文档——好在零件都露着（`renderNodesToSVG`、`computeContentBounds`），
 * 而 `jspdf` / `svg2pdf.js` 本来就在引擎 chunk 里（上游那条路也在用它们）。
 *
 * 三件事定在这里：
 *
 * - **嵌进去的是子集**（`putOnlyUsedFonts: true`）。jsPDF 默认会把**注册过的每一支字面整个
 *   嵌进产物**——四个样式就是四份 17.7MB。打开这一格之后，只有真用上的那几支进去，而每支
 *   再按用到的字形子集化：一份三页的中文稿实测 **51KB**，文字可选中、可搜索（`/ToUnicode`
 *   在）、矢量。
 * - **一容器一页**，全在一份文档里（不是一页一份再拼）。少一次字体解析、少一份重复子集，
 *   客户端那边也不必再合并——粒度归调用方，这里只保证「给多少页写多少页」。
 * - **量尺来自 SVG 自己**：上游画 SVG 时根元素就写着 `width`/`height`/`viewBox`，页面就按它
 *   建；调用方把这个尺寸一起递进来（它本来就要算，见 `design-io.ts`）。
 *
 * 这个模块**只住在引擎 chunk 里**（`lib/assets/design-engine.js`）：`jspdf` 与 `svg2pdf.js`
 * 都是重家伙，且要 `DOMParser`。所以 import 一律是**动态的**、放在函数里——文件顶层保持
 * 纯净，判据才能在 node 里把纯函数拿出来单测。
 */
import { PDF_TEXT_FAMILY } from '../../../core/artifact/design/export-font.ts'

/**
 * 交给 jsPDF 虚拟文件系统的那个名字。
 *
 * 它只是本模块内部的握手（`addFileToVFS` 与 `addFont` 之间），不写进产物——产物里的
 * `/BaseFont` 来自字体自己的 PostScript 名（被加上子集前缀）。取个和字体对得上的名字，
 * 出问题时好认。
 */
export const PDF_FONT_FILE = 'NotoSansSC-Regular.ttf'

/** 一页的素材：上游画好的矢量图，以及它有多大（pt）。 */
export interface PdfPageSource {
  svg: string
  width: number
  height: number
}

/**
 * `ArrayBuffer` → jsPDF 要的那个「二进制字符串」（每个字符一个字节）。
 *
 * 走这一条而不是它的 base64 那条：jsPDF 两个都收（`addFont` 看头四个字节是不是
 * `00 01 00 00` 来决定要不要 `atob`），而 base64 要多一趟 24MB 的编码与一次解码、内存是
 * 这里的近两倍。**分块**是因为 `String.fromCharCode` 的参数个数有上限（整份 17.7MB 一次
 * 铺开会直接爆栈），一次 16KB 是安全又够快的粒度。
 */
export function binaryStringOf(bytes: Uint8Array): string {
  const CHUNK = 0x4000
  let out = ''
  for (let index = 0; index < bytes.length; index += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  }
  return out
}

/**
 * 把若干页画进一份 PDF，交回字节。
 *
 * `styles` 是要注册的字面样式名（`pdfTextStyles` 给的），`font` 是那支中文字面的字节——
 * 每一项都注册一次同一个文件，是因为 jsPDF 按「字体 id + 样式名」两维查表：只注册
 * `normal` 的话，一份带粗体的稿子会让 svg2pdf 找不到 `bold` 而回落 `times`。
 */
export async function renderPdfDocument(
  pages: readonly PdfPageSource[],
  styles: readonly string[],
  font: ArrayBuffer,
): Promise<Uint8Array> {
  const first = pages[0]
  if (first === undefined) throw new Error('这一趟没有要导出的页面。')

  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])
  const doc = new jsPDF({
    orientation: orientationOf(first),
    unit: 'pt',
    format: [first.width, first.height],
    compress: true,
    // 只有真用上的字面进产物（见文件头）。默认 false 会连没用过的样式一起整个嵌进去。
    putOnlyUsedFonts: true,
  })

  doc.addFileToVFS(PDF_FONT_FILE, binaryStringOf(new Uint8Array(font)))
  for (const style of styles) doc.addFont(PDF_FONT_FILE, PDF_TEXT_FAMILY, style)

  for (const [index, page] of pages.entries()) {
    if (index > 0) doc.addPage([page.width, page.height], orientationOf(page))
    const parsed = new DOMParser().parseFromString(page.svg, 'image/svg+xml')
    if (parsed.querySelector('parsererror') !== null) {
      throw new Error('这一页的矢量图读不了。')
    }
    await svg2pdf(parsed.documentElement, doc, {
      x: 0,
      y: 0,
      width: page.width,
      height: page.height,
    })
  }
  return new Uint8Array(doc.output('arraybuffer'))
}

/** 页面的朝向跟着容器走（与上游那条路同一条判据）。 */
function orientationOf(page: { width: number; height: number }): 'portrait' | 'landscape' {
  return page.width > page.height ? 'landscape' : 'portrait'
}
