/**
 * 画布那侧的〔导出〕接线（F10.1）。
 *
 * 判据读的是源码文本而不是运行结果：这一段要跑起来得有一整块画布、宿主 UI 加上一条 wire，
 * 而它决定的事情只有一件——**四条通道各自接到哪个函数上**。
 *
 * 「这张卡该给菜单还是一击、走哪条通道」不在这里判（那件事住在 `export-plan.ts`，是个纯
 * 函数，判据在 `export-plan.spec.ts` 里穷举）。这里钉的是接线：四条都接上了、接对了，以及
 * **画布这一侧不再自己判形态**——此前它一半从这里判（`exportCard` 里的 `isBundleKind` +
 * `exportFormats[0]`）、一半从那枚胶囊里判，同一个东西两个来源。
 *
 * 为什么这件事值得用「读源码」这种笨办法钉住：应用卡片曾经落到部署的导出能力上，而那条线
 * 在没有提供 `dsh-canvas.capabilities` 的部署上点一下是**什么都不发生**的——宿主返回
 * `{ ok: false, reason: '部署未提供导出能力' }` 是一份**答案**、不是异常，而画布那条
 * `run()` 只接异常。于是「点了没反应」正是它原来的症状，而它同时也说明为什么这条判据不能
 * 靠类型系统兜住——两边都是合法的代码。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(new URL('../../../src/client/canvas/canvas-view.tsx', import.meta.url), 'utf8')

/** One declaration's body, from its first line to a closing marker. */
function bodyOf(declaration: string, end = '\n  )'): string {
  const from = SOURCE.indexOf(declaration)
  expect(from, `源码里找不到 ${declaration}`).toBeGreaterThanOrEqual(0)
  const rest = SOURCE.slice(from + declaration.length)
  const to = rest.indexOf(end)
  return to === -1 ? rest : rest.slice(0, to)
}

describe('四条导出通道都接在同一个判据上', () => {
  it('去向由 `exportOfferOf` 给，四个处理函数各是各的', () => {
    const body = bodyOf('const exportOffer: ExportOffer = useMemo(', '\n  }, [')

    expect(body).toContain('exportOfferOf(kind, {')
    for (const handler of ['bundle:', 'host:', 'text:', 'design:']) {
      expect(body, handler).toContain(handler)
    }
    expect(body).toContain('exportBundleCard(card)')
    expect(body).toContain('exportHostCard(card, format)')
    expect(body).toContain('exportTextCard(card, format)')
    expect(body).toContain('exportDesignCard(card, format)')
  })

  it('形态先问摘要、读不到才回落问卡片自己（座位可以先于产物存在）', () => {
    const body = bodyOf('const exportOffer: ExportOffer = useMemo(', '\n  }, [')

    expect(body).toContain('summaries[card.id]?.kind ?? card.kind')
  })

  it('画布这一侧不再自己判形态——分派只此一份', () => {
    // 判据看的是**代码**，不是注释：两处 doc 注释里都还在讲这段历史（那是有意留着的，
    // 「此前是哪两个来源」正是这一版要记住的事）。
    const code = SOURCE.replace(/\/\*\*[\s\S]*?\*\//g, '')

    // `exportFormats[0]` 这一句搬进了 `export-plan.ts`；它留在代码里就意味着「两处各判
    // 一遍」，而那正是加第三条通道（设计稿）时会让菜单与实现分家的那种写法。
    expect(code).not.toContain('exportFormats[0]')
    expect(code).not.toContain('isBundleKind')
    // 交给部署那条线的调用只有一处，在 `exportHostCard` 里：格式是判据挑好之后递进来的。
    expect(code.match(/bridge\.exportCard\(/g)).toHaveLength(1)
  })
})

describe('应用卡片的导出：先在本地打包', () => {
  it('打包那一路读的是整个目录，包的字节在浏览器里生成', () => {
    const body = bodyOf('const exportBundleCard = useCallback(')

    expect(body).toContain('bridge.readBundle(')
    expect(body).toContain('exportBundle(view, downloadBytes)')
  })

  it('被拒时照实说一句，而不是静默', () => {
    const body = bodyOf('const exportBundleCard = useCallback(')

    // 两种收场都走 `notice.ts` 那张表：成了 / 被拒一句话，装包抛错另一句。文案与**口气**
    // 都在那里定，这一段只负责把它交出去——所以这里钉的是「两个出口都在」。
    expect(body).toContain('bundleNotice(')
    expect(body).toContain('bundleFailedNotice(')
    expect(body).toContain('setNotice(')
  })
})

describe('设计稿的导出：整趟都在浏览器里画', () => {
  it('读产物、取引擎、交给 `exportDesign`——落盘是注入的那一个', () => {
    const body = bodyOf('const exportDesignCard = useCallback(')

    expect(body).toContain('bridge.readArtifact(')
    // 引擎 chunk 是**只此一份**的加载器：预览器与导出读同一个 `null` 的语义（chunk 取不到
    // 是一条降级路径，不是异常），但两个调用点对它的处理各是各的。
    expect(body).toContain('await loadDesignEngine()')
    expect(body).toContain('exportDesign({')
    expect(body).toContain('save: downloadBytes')
    // 这里**没有**合并那一步了（v1.61）：PDF 的页由引擎自己写进同一份文档——它要嵌字体，
    // 就得够得着那句 `new jsPDF(...)`，于是客户端不必再认识 pdf-lib。
    expect(body).not.toContain('mergePdf')
    expect(body).toContain('designExportNotice(')
  })

  it('点下去先说一句「正在导出」——PDF 与 PPT 要画一会儿，不该看起来像点空了', () => {
    const body = bodyOf('const exportDesignCard = useCallback(')

    expect(body).toContain('exportWorkingNotice(t)')
  })
})
