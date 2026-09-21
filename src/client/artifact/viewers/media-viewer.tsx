/**
 * dsh-canvas — 图片与视频预览器。
 *
 * 两者共用同一块媒体面板，差别只有那一个元素：二进制内容不走文本通道，host 把它
 * 读成 data URL 随 payload 一起送来（`ArtifactView.dataUrl`），所以这里只负责铺开。
 * 它们各自是一个文件里的两个导出，而不是两个文件——分开也不会有第二个读者。
 */
import type { ViewerProps, ViewerRegistration } from './types.ts'

/** The image viewer: the artifact, letterboxed on a plain surface. */
export function ImageViewer({ view }: ViewerProps) {
  return (
    <div className="dsh-canvas-media">
      <img src={view.dataUrl} alt={view.cardId} />
    </div>
  )
}

/** The video viewer: native controls, keep it that way. */
export function VideoViewer({ view }: ViewerProps) {
  return (
    <div className="dsh-canvas-media">
      <video src={view.dataUrl} controls />
    </div>
  )
}

/**
 * 两条注册项：图片与视频各认领一个 kind，都不声明 `editable` / `pickable` ——
 * 它们的 payload 是二进制，没有「文件自己的文本」可写，也没有页面帧可选。
 */
export const imageViewer: ViewerRegistration = {
  id: 'image',
  component: ImageViewer,
  claims: (kind) => kind === 'image',
}

export const videoViewer: ViewerRegistration = {
  id: 'video',
  component: VideoViewer,
  claims: (kind) => kind === 'video',
}
