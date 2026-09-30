/**
 * dsh-canvas — 交出去的 PPT 里那个字体名（F10.1，v1.60）。
 *
 * 设计稿里的字体名是**我们自己这边的东西**：拉丁字面是 `Inter`（core 的
 * `DEFAULT_FONT_FAMILY`），汉字靠仓库 vendored 的 `Noto Sans SC` 回落——两者都只活在
 * 本插件的资产路由里。画布上看得见，**别人的机器上没有**。
 *
 * 四条出路里只有 PPT 这条是「把字体名交出去」：图片与 PDF 的字是我们自己栅格化的，
 * 那个名字在那边是**拿去 fontManager 里找字面的**，必须原样保留；fig 那边 `Inter`
 * 恰好是 Figma 自己的默认字体，它也认得。而 PPT 的原生文本（`addEditableText`）
 * 是把文字连同 `typeface` 一起交给**对方的 PowerPoint** 去排——于是那个名字会在对方
 * 机器上解析，写 `Inter` 的结果是 PowerPoint 找不到这支字体，而 `Inter` 根本没有汉字
 * 字形，整段中文就跟着丢了（v1.59 真机复验抓到的那一次：「导出 PPT，第一页的字体丢失」。
 * 只有第一页，是因为后面几页的文字落进了图片回退，而图片是我们自己画的）。
 *
 * 所以交出去之前换一个名字。**微软雅黑**：中文 Windows 与 WPS 必然装着它，Mac 上会被
 * 替换成系统黑体（观感一致），任何情况下都不会丢字；而它本身是一支黑体，与设计稿上
 * 看到的「Inter + 思源黑体」那套最接近。
 */
import type { SceneGraph } from '@open-pencil/scene-graph'

/**
 * 交出去的 PPT 里统一用的字体名——**不是**设计稿里那个。
 *
 * 写英文名而不是「微软雅黑」：OpenXML 的 `typeface` 按字族的英文名解析，各语言版本的
 * PowerPoint 与 WPS 都认它。
 */
export const PPT_TEXT_FAMILY = 'Microsoft YaHei'

/**
 * 这个格式交出去之前要不要换字体名——**四条出路里只有 PPT 要**。
 *
 * 另三条的字是我们自己画的（图片、PDF 栅格化；fig 那边 `Inter` 正是 Figma 的默认字体），
 * 字体名在那三条路上是「拿去 fontManager 里找字面」用的，换掉反而画不出字。单独做成一个
 * 函数，是为了让「哪条路要换」这件事本身能被判据点名测到，而不是埋在调用点的 if 里。
 */
export function retargetsTextFonts(format: string): boolean {
  return format === 'pptx'
}

/**
 * 把图里所有文字的字体名换成 `family`（默认 `PPT_TEXT_FAMILY`）。
 *
 * **逐段（`styleRuns`）也要换**：run 上显式的 `fontFamily` 会盖过节点那一个（那边写的是
 * `s.fontFamily ?? node.fontFamily`），漏掉它等于漏掉那些被单独设过字体的文字。
 *
 * **就地改**：这份图是这一趟导出自己解码出来的，用完即弃，没有第二个读者。
 */
export function retargetTextFonts(graph: SceneGraph, family: string = PPT_TEXT_FAMILY): void {
  const visit = (parentId: string): void => {
    for (const node of graph.getChildren(parentId)) {
      visit(node.id)
      if (node.type !== 'TEXT') continue
      node.fontFamily = family
      for (const run of node.styleRuns) {
        if (run.style.fontFamily !== undefined) run.style.fontFamily = family
      }
    }
  }
  for (const page of graph.getPages()) visit(page.id)
}
