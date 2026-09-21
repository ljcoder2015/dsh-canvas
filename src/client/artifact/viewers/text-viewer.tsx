/**
 * dsh-canvas — 兜底预览器：一切别的东西，按它在盘上的原样显示。
 *
 * 它是注册表里唯一一条 `fallback`，认领所有没被别的预览器点名的 kind ——
 * `file`、`folder`，以及宿主将来新加的形态。
 *
 * 文本文件（`file`）能就地整篇改，目录（`folder`）不能：编辑面自己按 payload 判这一条
 * （`editing/writable.ts` 读 `isDirectTextKind`），所以这里只需要把「原样显示」这一面
 * 交出去。
 */
import { EditableText } from '../editing/editable-text.tsx'
import type { ViewerProps, ViewerRegistration } from './types.ts'

/** 预览面：盘上原样的文本。 */
function PlainBody({ text }: { text: string }) {
  return <pre className="dsh-canvas-pre">{text}</pre>
}

/** The text viewer: everything else, as it is on disk. */
export function TextViewer({ view }: ViewerProps) {
  return <EditableText view={view} preview={PlainBody} />
}

/**
 * 兜底注册项。
 *
 * 它认领所有没被别的预览器点名的 kind：`file`（`.txt` / `.js` / `.css` 这类按扩展名分不
 * 出形态的文本）、`folder`（目录）以及宿主将来新加的形态。所以 `claims` 恒真，而**顺序
 * 无关**——`fallback` 标出来，注册表先问别的条目。
 *
 * `editable` 那条声明已经删掉，判定搬进了编辑面自己：能整篇写回的只有「产物就是它自己的
 * 文字」的 kind（`core/artifact/kind-registry.ts` 的 `isDirectTextKind` = markdown /
 * file），目录不在其中——给目录一枚编辑钮，点下去就是把一个文件夹当文件写。
 *
 * 那里面还补了一个旧笔误：这段判定从前写的是 `kind === 'text'`，而 `'text'` 是**预览器
 * id**、从来不是一个 kind（兜底 kind 叫 `'file'`），于是「纯文本文件能就地编辑」从未生效
 * 过——`.txt` 在弹窗里只能看、拿不到编辑器，卡片控制带上的「手动输入」也对它隐身。
 */
export const textViewer: ViewerRegistration = {
  id: 'text',
  component: TextViewer,
  claims: () => true,
  fallback: true,
}
