/**
 * dsh-canvas — 这份产物能不能整篇写回（F3.12）。
 *
 * 就地编辑是「把整个文件换成编辑器里的文字」，所以它成立的前提只有一条：**产物的字节
 * 就是它的文字**。kind 说得出前半句（`isDirectTextKind`，宿主那张 kind 表上的事实），
 * payload 说得出后半句（它在、而且读全了）—— 两半都成立，编辑钮才该出现。
 *
 * 单独成文件是为了能单测：这条判定要是散在 hook 里，就只有起一个真浏览器才知道它还
 * 会不会给出一枚「点下去就把文件改成别的东西」的按钮。
 */
import { isDirectTextKind } from '../../../core/artifact/kind-registry.ts'
import type { ArtifactView } from '../../../types.ts'

/** 这份 payload 能不能整篇写回（见文件头）。读了一半的文件绝不算：写回去的会是那半份。 */
export function writablePayload(view: Pick<ArtifactView, 'kind' | 'present' | 'truncated'>): boolean {
  return view.present && !view.truncated && isDirectTextKind(view.kind)
}
