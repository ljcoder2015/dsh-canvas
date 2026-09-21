/**
 * dsh-canvas — 弹窗打开时读一次产物（F3.8）。
 *
 * 「这张卡背后的文件现在是什么」只有一件事需要：**读**。读回来的 payload 于是成了整
 * 个弹窗共享的事实——正文按 kind 分派给某个预览器，而预览器要不要给编辑钮、要不要给
 * 元素选择钮，看的是它自己这份 payload 里有什么（`writablePayload` / `present` /
 * `truncated`），不是外壳替它判断出来的能力。
 *
 * 从前读和编辑是同一个 hook（`use-artifact-editor.ts`）里的一件事，因为「能编辑」是
 * 注册表替预览器声明的一条能力，外壳得先查表、再决定正文画成编辑器还是预览。现在编辑
 * 是文本预览器自己的面（它自己读 `writablePayload`），所以读这一半留在外壳、写那一半
 * 跟着预览器走。
 *
 * 弹窗仍然是自足的：不等画布为每张卡留的那份摘要，打开就读，读到的就是现在这一刻的盘上
 * 内容。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ArtifactView } from '../../types.ts'
import type { Translate } from '../ui/locales.ts'
import type { ArtifactModalBridge } from './chrome.tsx'

export interface ArtifactPayload {
  /** 读回来的产物；`undefined` 表示还在读。 */
  view: ArtifactView | undefined
  /** 读失败时的一句话。 */
  error: string
  /**
   * 采用一份新读回来的产物。
   *
   * 给写回之后的重读与元素选择用：会话把那头把文件改了、或者编辑刚落了盘，回读到的那
   * 一版得走这里进来，预览才跟着换。
   */
  adopt(payload: ArtifactView): void
}

export function useArtifactPayload(input: {
  projectId: string
  cardId: string
  bridge: ArtifactModalBridge
  t: Translate
}): ArtifactPayload {
  const { projectId, cardId, bridge, t } = input
  const [view, setView] = useState<ArtifactView | undefined>(undefined)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    // 换一张卡先回到「正在读」：这是外壳唯一的加载态，也是下面那半边状态不必自己
    // 重置的原因——预览器随之卸载，草稿不跟着走到另一张卡上。
    setView(undefined)
    setError('')
    bridge
      .readArtifact(projectId, cardId)
      .then((payload) => {
        if (!cancelled) setView(payload)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : t('canvas.error.unknown'))
      })
    return () => {
      cancelled = true
    }
  }, [bridge, cardId, projectId, t])

  const adopt = useCallback((payload: ArtifactView): void => setView(payload), [])

  return { view, error, adopt }
}
