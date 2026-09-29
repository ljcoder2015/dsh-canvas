/**
 * dsh-canvas — 提示条说什么，以及它是哪一档（F10.1）。
 *
 * 画布上这几条提示同占一个位置（画布左上角），而它们背后的收场并不是一回事：导出成了、
 * 这次没导成、打包出错、或者「本来就没有可引用的材料」。发出去时全长得一样，用户得把一行
 * 字读完才知道刚才发生了什么——「导出完了没有、为什么没导出」本来该一眼看出来。
 *
 * 所以**口气与那句话一起定**，就定在这个纯模块里：判据可以穷举，界面只管把 tone 画成颜色
 * （`styles.ts` 里那几条 `[data-tone]` 规则），谁也不许在 jsx 里临时挑一个颜色。
 *
 * 两条界线值得写下来，因为它们是这一档的全部内容：
 *
 * - **被拒不是出错。** 产物还没写、目录里没有可打包的东西、文件多到一包装不下——这三件事
 *   没有一件是「出错」，它们是「这次没导成，以及为什么」。`error` 只留给真的抛了异常。
 * - **「没事发生」也不是成功。** 「这张卡还没有引用任何材料」是一个中性的事实（`info`），
 *   给它涂成功色就是在替用户下结论。
 *
 * 不 import 任何碰宿主 UI 原语的模块（本模块在 vitest 的 node 环境里跑），`t` 一律注入。
 */
import type { CanvasKey, Translate } from '../ui/locales.ts'
import type { BundleExportResult, BundleRefusal } from './bundle-export.ts'
import type { DesignExportOutcome, DesignRefusal } from './design-export.ts'

/**
 * 提示条的口气。
 *
 * `info` 是中性那一档——「只是告诉你一件事」。它也是提示条的默认长相：底与描边走中性色，
 * 不抢任何东西。
 */
export type NoticeTone = 'info' | 'ok' | 'warn' | 'error'

/** 一条提示：一句话，加上它的口气。 */
export interface Notice {
  text: string
  tone: NoticeTone
}

/** 翻译接缝：与本仓别处一样，注入而不是 import 一个实例（本模块因此能在 node 里跑）。 */
export type NoticeTranslate = Translate

/**
 * 一次打包被拒：说哪一句、算哪一档。
 *
 * 三种拒绝口气相同（都是「这次没导成」），但**下一步各不相同**——等产物写出来、往目录里
 * 放点东西、自己先把目录精简一下——所以文案必须分开，不能合成一句「导出失败」。
 */
const REFUSAL: Record<BundleRefusal, { key: CanvasKey; tone: NoticeTone }> = {
  absent: { key: 'canvas.export.absent', tone: 'warn' },
  empty: { key: 'canvas.export.bundleEmpty', tone: 'warn' },
  truncated: { key: 'canvas.export.bundleTruncated', tone: 'warn' },
}

/** 应用打包的一次收场 → 提示条。 */
export function bundleNotice(result: BundleExportResult, t: NoticeTranslate): Notice {
  if (result.kind === 'refused') {
    const refused = REFUSAL[result.reason]
    return { text: t(refused.key), tone: refused.tone }
  }
  return { text: t('canvas.export.bundleDone', { name: result.name, count: String(result.files) }), tone: 'ok' }
}

/**
 * 装包这一步真的抛了异常时的那一句。
 *
 * 只有这里算 `error`：读产物失败是宿主那一侧的事（它有自己的错误条），而装包是客户端
 * 自己动手的步骤，出错要说得出是哪一步——不要只丢一句「导出失败」出去。
 */
export function bundleFailedNotice(reason: unknown, t: NoticeTranslate): Notice {
  return { text: t('canvas.export.bundleFailed', { reason: messageOf(reason) }), tone: 'error' }
}

/** 文本节点导出的一次收场。 */
export type TextExportOutcome =
  | { kind: 'done'; name: string }
  | { kind: 'absent' }
  | { kind: 'truncated' }
  | { kind: 'failed'; reason: unknown }

/**
 * 文本节点导出的一次收场 → 提示条。
 *
 * 与打包同一条规矩：读产物这一步的两条拒绝（还没写 / 只读到半份）是 `warn`，只有客户端
 * 自己排版那一步抛错（现在只有 PDF 那条要取字体资产）才是 `error`。
 */
export function textExportNotice(outcome: TextExportOutcome, t: NoticeTranslate): Notice {
  switch (outcome.kind) {
    case 'absent':
      return { text: t('canvas.export.absent'), tone: 'warn' }
    case 'truncated':
      return { text: t('canvas.export.truncated'), tone: 'warn' }
    case 'failed':
      return { text: t('canvas.export.pdfFailed', { reason: messageOf(outcome.reason) }), tone: 'error' }
    default:
      return { text: t('canvas.export.done', { name: outcome.name }), tone: 'ok' }
  }
}

/**
 * 一次「清理失效卡」的收场（F1.11）。
 *
 * host 只清「证明得了不存在」的那些，读不到的会留下来，所以报出的张数可能少于按钮上的
 * 数字。清光了是 `ok`，有留下的就是 `warn`——那不是一个失败，而是「还剩几张没清」。
 */
export function pruneNotice(removed: number, promised: number, t: NoticeTranslate): Notice {
  return removed < promised
    ? { text: t('canvas.prune.partial', { removed, skipped: promised - removed }), tone: 'warn' }
    : { text: t('canvas.prune.done', { count: removed }), tone: 'ok' }
}

/**
 * 设计稿被拒的五种原因：说哪一句、算哪一档（F10.1，v1.59）。
 *
 * 五种都是 `warn`，因为**没有一种是「出错」**：产物还没写、只读到半份、文档解不开（旧 v1
 * 或坏了）、文档里一个容器都没有、这台机器上取不到渲染引擎——每一件都有各自的下一步
 * （等模型写完、让模型重新生成、往里放一个容器、或者刷新页面把引擎资产取回来）。
 */
const DESIGN_REFUSAL: Record<DesignRefusal, { key: CanvasKey; tone: NoticeTone }> = {
  absent: { key: 'canvas.export.absent', tone: 'warn' },
  truncated: { key: 'canvas.export.truncated', tone: 'warn' },
  broken: { key: 'canvas.export.designBroken', tone: 'warn' },
  empty: { key: 'canvas.export.designEmpty', tone: 'warn' },
  'no-engine': { key: 'canvas.export.designNoEngine', tone: 'warn' },
}

/** 设计稿导出的一次收场 → 提示条。 */
export function designExportNotice(outcome: DesignExportOutcome, t: NoticeTranslate): Notice {
  if (outcome.kind === 'refused') {
    const refused = DESIGN_REFUSAL[outcome.reason]
    return { text: t(refused.key), tone: refused.tone }
  }
  if (outcome.kind === 'failed') {
    return { text: t('canvas.export.designFailed', { reason: messageOf(outcome.reason) }), tone: 'error' }
  }
  // 多件（图片一容器一张、PPT 一页面一份）按包给，于是报出件数——一句话说清拿到的是几份。
  return outcome.files > 1
    ? { text: t('canvas.export.designPacked', { name: outcome.name, count: String(outcome.files) }), tone: 'ok' }
    : { text: t('canvas.export.done', { name: outcome.name }), tone: 'ok' }
}

/** 导出还没收场时先说一句（PDF 与 PPT 要画一会儿，点下去不该看起来没反应）。 */
export function exportWorkingNotice(t: NoticeTranslate): Notice {
  return { text: t('canvas.export.working'), tone: 'info' }
}

/** 一句错误里可读的那一段（宿主抛出来的多数是 `Error`，别的照实转字符串）。 */
function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
