/**
 * dsh-canvas — 卡片预览的两种「截图」素材。
 *
 * 画布卡片是 200×140 的静物，而设计与应用两类产物都活在「渲染之后」：设计是场景图，
 * 应用是跑起来的页面。卡片手里没有 CanvasKit 也没有浏览器，这里用两条最省的路径各拿一张：
 *
 * - **设计卡**：`.design` 信封在客户端解码（`decodeDesignFile`，core 里的纯函数），
 *   经 `paintDocument` 的 2D 后端画进一张离屏 canvas，`toDataURL` 成 PNG。这不是
 *   CanvasKit 的保真画质，但与全屏预览的降级路径同源——引擎换了，画面不换。
 * - **应用卡**：入口页的 HTML（host 已内联本地样式与脚本）装进卡片上的迷你 iframe
 *   跑起来。它不是死的截图而是活的缩比页面：脚手架的 web components 在 shadow root
 *   里渲染，任何「序列化 DOM 再转图片」的方案都会把它们拍成空壳，真帧不会。帧不接
 *   指针、不进 Tab 序；缩放低于阈值时整帧卸载（阈值由调用方的 zoom 闸决定）。
 *
 * 两类素材都按 `bytes` 缓存——bytes 是「文件被重写过」最便宜的凭证（updatedAt 每次
 * 重读都会变，当不了缓存键）。请求单飞、容量有界：应用页的 HTML 最多到
 * `VIEW_TEXT_CAP` 两兆，缓存不设上限就是一个内存漏斗。
 */
import { useEffect, useState } from 'react'
import type { CanvasBridge } from '../wire/bridge.ts'
import { decodeDesignFile } from '../../core/artifact/design/document.ts'
import { canvas2dBackend, documentBounds, paintDocument } from '../artifact/viewers/design-render.ts'

/** 设计截图的离屏画布尺寸：预览区约 200×114，按 2x 画，缩放板上看不糊。 */
const SHOT_WIDTH = 400
const SHOT_HEIGHT = 240

/** 两类缓存的容量上限；超限按插入序淘汰最老的一条。 */
const SHOT_CACHE_MAX = 32
const FRAME_CACHE_MAX = 6

const shots = new Map<string, Promise<string | undefined>>()
const frames = new Map<string, Promise<string | undefined>>()

/**
 * 单飞 + 有界的缓存读取。
 *
 * 键未命中才发起 `fetcher`；缓存满员时淘汰最早进入的一条——Promise 与缓存表无关，
 * 还在飞行中的请求不受淘汰影响，只是结果不再被后来的调用者复用。
 */
function cachedFetch(
  cache: Map<string, Promise<string | undefined>>,
  key: string,
  max: number,
  fetcher: () => Promise<string | undefined>,
): Promise<string | undefined> {
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const pending = fetcher()
  cache.set(key, pending)
  if (cache.size > max) {
    const oldest = cache.keys().next()
    if (oldest.done !== true) cache.delete(oldest.value)
  }
  return pending
}

/** 设计卡的离屏截图（PNG data URL）；产物缺失、解码失败都归一成 `undefined`，卡片退回文字预览。 */
function designShot(bridge: CanvasBridge, projectId: string, cardId: string, bytes: number): Promise<string | undefined> {
  return cachedFetch(shots, `${projectId}/${cardId}@${bytes}`, SHOT_CACHE_MAX, () =>
    bridge
      .readArtifact(projectId, cardId)
      .then((view) => {
        if (!view.present || view.text === '') return undefined
        const graph = decodeDesignFile(view.text)
        const canvas = document.createElement('canvas')
        canvas.width = SHOT_WIDTH
        canvas.height = SHOT_HEIGHT
        const context = canvas.getContext('2d')
        if (context === null) return undefined
        // 缩放封顶在 1：小文档放大到糊不如留白，与全屏预览的 zoom-to-fit 同一约定。
        const bounds = documentBounds(graph)
        const scale = Math.min(SHOT_WIDTH / bounds.width, SHOT_HEIGHT / bounds.height, 1)
        paintDocument(
          graph,
          canvas2dBackend(context),
          {
            x: (SHOT_WIDTH - bounds.width * scale) / 2,
            y: (SHOT_HEIGHT - bounds.height * scale) / 2,
            scale,
          },
        )
        return canvas.toDataURL('image/png')
      })
      .catch(() => undefined),
  )
}

/** 应用入口页的内联 HTML（host 已注入链接闸与选择探针，探针默认是死的）；失败归一成 `undefined`。 */
function webAppHtml(bridge: CanvasBridge, projectId: string, cardId: string, bytes: number): Promise<string | undefined> {
  return cachedFetch(frames, `${projectId}/${cardId}@${bytes}`, FRAME_CACHE_MAX, () =>
    bridge
      .readArtifact(projectId, cardId)
      .then((view) => (view.present && view.text !== '' ? view.text : undefined))
      .catch(() => undefined),
  )
}

/** 设计卡截图的读取 hook；`enabled` 为假时不发起任何请求。 */
export function useDesignShot(
  bridge: CanvasBridge,
  projectId: string,
  cardId: string,
  bytes: number,
  enabled: boolean,
): string | undefined {
  const [shot, setShot] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!enabled || bytes <= 0) return
    let cancelled = false
    void designShot(bridge, projectId, cardId, bytes).then((url) => {
      if (!cancelled) setShot(url)
    })
    return () => {
      cancelled = true
    }
  }, [bridge, cardId, enabled, bytes, projectId])
  return shot
}

/** 应用卡内联 HTML 的读取 hook；同样的 `enabled` 闸（调用方拿 zoom 当阈值）。 */
export function useWebAppHtml(
  bridge: CanvasBridge,
  projectId: string,
  cardId: string,
  bytes: number,
  enabled: boolean,
): string | undefined {
  const [html, setHtml] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!enabled || bytes <= 0) return
    let cancelled = false
    void webAppHtml(bridge, projectId, cardId, bytes).then((text) => {
      if (!cancelled) setHtml(text)
    })
    return () => {
      cancelled = true
    }
  }, [bridge, cardId, enabled, bytes, projectId])
  return html
}
