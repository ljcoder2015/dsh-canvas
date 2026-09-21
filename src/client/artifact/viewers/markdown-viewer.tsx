/**
 * dsh-canvas — markdown 预览器。
 *
 * 两件事都不是这个文件的了：渲染是纯函数的（`markdown.ts`），编辑面是共用的
 * （`editing/editable-text.tsx`）。这里只剩「预览长什么样」——一段渲染过的标记。
 */
import { useMemo } from 'react'
import { EditableText } from '../editing/editable-text.tsx'
import { renderMarkdown } from './markdown.ts'
import type { ViewerProps, ViewerRegistration } from './types.ts'

/** 预览面：吃的是草稿（比盘上新的时候），不是 payload。 */
function MarkdownBody({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  return <div className="dsh-canvas-md" dangerouslySetInnerHTML={{ __html: html }} />
}

/** The markdown viewer: artifact prose, rendered — and editable as a whole. */
export function MarkdownViewer({ view }: ViewerProps) {
  return <EditableText view={view} preview={MarkdownBody} />
}

/**
 * 注册项：markdown 独占一个预览器。
 *
 * 「它能就地编辑」不再是这里的一条声明：编辑是这一面自己按 payload 判出来的
 * （`editing/writable.ts` 拿 kind 与 present / truncated 两半一起看），所以注册项只剩下
 * 认领哪些 kind 这一件事。
 */
export const markdownViewer: ViewerRegistration = {
  id: 'markdown',
  component: MarkdownViewer,
  claims: (kind) => kind === 'markdown',
}
