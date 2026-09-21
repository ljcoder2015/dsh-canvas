/**
 * dsh-canvas — 一摞「这一下谁收」的处理者（纯逻辑）。
 *
 * Esc 与「关掉」都不是外壳一个人的事：正在选元素的预览器要收第一下 Esc，编辑器要收
 * 「放弃确认」那一下；而窗口只有一处键盘、弹窗只有一个出口。所以两边各登记一摞处理者，
 * 由外壳在按下的那一刻从**后往前**问——后来登记的总在最上面那一层。
 *
 * 这一条与「谁在左边」是同一类判断：坏掉的时候不报错，只是行为换了个人做。所以它单独
 * 成一个没有依赖的文件，测试可以直接钉住顺位与短路。
 */

/** 一位处理者：`true` = 这一下我收下了，别往下问。 */
export type Claim = () => boolean

/**
 * 从后往前问，第一个认领的收下。
 *
 * 短路的理由是它会**改变程序的状态**（收下 Esc 往往就是关掉某个模式、问出一个确认），
 * 所以不能「问完所有人再决定」，只能问到第一个举手的人为止。空摞返回 `false` —— 没有
 * 人认领，事情归外壳。
 */
export function claimFirst(claims: readonly Claim[]): boolean {
  for (let index = claims.length - 1; index >= 0; index -= 1) {
    if (claims[index]?.() === true) return true
  }
  return false
}
