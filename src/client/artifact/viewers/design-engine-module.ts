/**
 * dsh-canvas — 设计引擎 chunk 的加载器（**只此一份**）。
 *
 * `lib/assets/design-engine.js` 是按 URL 动态 import 的一份 ESM chunk（为什么非得分两半
 * 见 `design-engine.ts` 开头那两条理由）。这个加载器的存在只为两件事：
 *
 * 1. **单飞**：几次调用共用同一次 fetch。浏览器自己有模块缓存，但那是它的事；这里要的是
 *    「不重复发起、失败也只有一个结果」这个语义。
 * 2. **失败即 `null`**：chunk 取不到（资产没发布、路由不认）是一条降级路径，不是异常——
 *    预览器退成报错面板、导出退成「这次没导成」。
 *
 * 它原先躲在预览器里（`design-viewer.tsx` 的两行）。导出也要用同一份 chunk 之后就必须
 * 挪出来：**两份加载器 = 两份「加载失败怎么办」**，而这两个调用点对失败的处理恰恰不同
 * （一个要报错面板，一个要一句提示）。加载这件事让这里管，怎么处理各自决定。
 */
import { ASSET_BASE } from './design-canvaskit.ts'
import type {
  CreateDesignEngineArgs,
  DesignExportOutcome,
  DesignExportRequest,
  EngineOutcome,
} from './design-engine-types.ts'

/** The engine chunk's shape — the module is loaded by URL, typed here. */
export interface DesignEngineModule {
  createDesignEngine(args: CreateDesignEngineArgs): Promise<EngineOutcome>
  designExport(request: DesignExportRequest): Promise<DesignExportOutcome>
}

/** Single-flight module load by URL; `null` when the chunk cannot be fetched. */
let engineModule: Promise<DesignEngineModule | null> | undefined

export function loadDesignEngine(): Promise<DesignEngineModule | null> {
  engineModule ??= import(`${ASSET_BASE}/design-engine.js`)
    .then((module) => module as DesignEngineModule)
    .catch(() => null)
  return engineModule
}
