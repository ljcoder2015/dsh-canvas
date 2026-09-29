/**
 * dsh-canvas — 把一份份单页 PDF 并成一份多页（F10.1，v1.59）。
 *
 * 设计稿的 PDF 是**一容器一页**排出来的：每页的大小就是那个容器的尺寸，而它由 open-pencil
 * 那边一条一条画（矢量、文字可选可搜）。合成一份多页文档是它们各自的「一页」之外的事，
 * 而 pdf-lib 本来就在包里（文本导出的 PDF 一直用它），于是这一步在这里做，不麻烦引擎。
 *
 * 页面尺寸**可以逐页不同**（PDF 允许）：一份海报系列就该是一叠大小各异的页，把它们统一缩放
 * 到 A4 才是丢信息。所以这里只搬页，不动版面。
 */
import { PDFDocument } from 'pdf-lib'

/**
 * 一叠单页 PDF → 一份多页 PDF。
 *
 * 只有一页时原样返回（连重新编码都不必——那份字节本来就是完整合法的单页 PDF）。
 */
export async function mergePdfPages(parts: readonly Uint8Array[]): Promise<Uint8Array> {
  if (parts.length === 0) throw new Error('没有可合并的页面。')
  if (parts.length === 1) return parts[0]
  const merged = await PDFDocument.create()
  for (const part of parts) {
    const source = await PDFDocument.load(part)
    for (const page of await merged.copyPages(source, source.getPageIndices())) merged.addPage(page)
  }
  return merged.save()
}
