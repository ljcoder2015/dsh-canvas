/**
 * dsh-canvas — 预览 / 编辑两面的切换（F3.12）。
 *
 * 从 `artifact-view.tsx` 搬出来的纯决策：一组单选按钮的方向键语义，以及「哪一面
 * 正开着」。单独成文件是因为它是可判定的——键盘与焦点是截图里看不见的那一半，
 * 只有测试能钉住。
 */

/** Which face of the modal is up: the rendered artifact, or the editor. */
export type ViewerMode = 'preview' | 'edit'

/**
 * Where an arrow key moves the mode group, as a pure step.
 *
 * The group is one control with two choices, and the arrow keys are what make it
 * a radio group rather than two unrelated buttons: pressing an arrow *selects*
 * the neighbour rather than merely moving a cursor onto it. Left/Up mean "the
 * earlier option", Right/Down "the later one", which for a two-item group is the
 * whole of the semantics. A key already pointing at the end returns null — that
 * is the caller's cue to leave the event alone instead of swallowing it.
 *
 * @param current - the mode in force.
 * @param key - the `KeyboardEvent.key` that arrived.
 * @returns the mode to switch to, or null if this key is not the group's.
 */
export function modeAfterKey(current: ViewerMode, key: string): ViewerMode | null {
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      return current === 'edit' ? 'preview' : null
    case 'ArrowRight':
    case 'ArrowDown':
      return current === 'preview' ? 'edit' : null
    default:
      return null
  }
}
