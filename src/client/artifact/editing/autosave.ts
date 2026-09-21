/**
 * dsh-canvas — 自动保存的节律，以及写被拒之后怎么办（F3.12）。
 *
 * 从 `artifact-view.tsx` 搬出来的纯决策。它们原先是四个散在组件里的常量与两个
 * 函数，共同回答一个问题：**这次该等多久再写**——安静时按停手期，一直不停手时
 * 按上限，写失败时按退避，而写被文件系统拒绝时干脆不写。这类判断在浏览器里只能
 * 靠掐表观察，抽出来才能被测试钉住。
 */

/**
 * How long typing must pause before the buffer is written on its own.
 *
 * A pure debounce never fires while the user keeps typing, so a long paragraph
 * could sit unwritten for minutes; a pure throttle writes mid-word and turns
 * every keystroke burst into disk traffic. These two numbers together are the
 * compromise: settle {@link AUTOSAVE_SETTLE_MS} after the last keystroke, but
 * never let a run of typing go past {@link AUTOSAVE_MAX_WAIT_MS} uncheckpointed.
 */
export const AUTOSAVE_SETTLE_MS = 800
export const AUTOSAVE_MAX_WAIT_MS = 5000

/**
 * How long to wait before the next autosave.
 *
 * Exported and pure so the pacing is pinned by a test rather than only being
 * observable by watching a browser: the two useful properties are "a pause is
 * followed by a write" and "the wait never exceeds the ceiling".
 *
 * @param elapsed - ms since the buffer first ran ahead of the disk.
 * @param settleMs - the quiet period a pause earns.
 * @param maxWaitMs - the longest a pending buffer may stay unwritten.
 * @returns the delay in ms; 0 means write now.
 */
export function autosaveDelay(
  elapsed: number,
  settleMs: number = AUTOSAVE_SETTLE_MS,
  maxWaitMs: number = AUTOSAVE_MAX_WAIT_MS,
): number {
  if (!Number.isFinite(elapsed) || elapsed < 0) return settleMs
  return Math.max(0, Math.min(settleMs, maxWaitMs - elapsed))
}

/**
 * What a refused write means for the autosave: try again later, or stop.
 *
 * The distinction is the whole reason this is a named decision rather than an
 * inline `catch`: a *transient* failure (the wire blipped, the file was held for
 * a moment) deserves another attempt, while a *blocked* one is the filesystem
 * saying no in a way that repeating cannot change — `EPERM` on the rename that
 * publishes the write, a read-only volume, a path that is no longer a regular
 * file. Retrying a blocked write on the autosave clock costs a staging file per
 * attempt (the host writes through a private temp dir, and a refused rename
 * leaves it behind) and tells the user nothing new.
 *
 * The markers are the errno names as the host spells them out in the message,
 * so this reads the wire rather than a structured code: only the message crosses
 * the RemoteError boundary.
 *
 * @param message - the failure's message, as the wire handed it over.
 * @returns `blocked` when another automatic attempt would be noise.
 */
export function writeFailureShape(message: string): 'blocked' | 'transient' {
  return /EPERM|EACCES|EROFS|ENOTDIR|not a regular file/i.test(message) ? 'blocked' : 'transient'
}

/** The first wait after a failed write; doubles per consecutive failure. */
export const AUTOSAVE_BACKOFF_MS = 2000
/** The longest wait between attempts, however long the failures run. */
export const AUTOSAVE_BACKOFF_CAP_MS = 30_000

/**
 * How long a *failed* write waits before trying again.
 *
 * The settle window suits a healthy wire and is far too eager for a wire that is
 * refusing: on a transient failure the retry backs off 2s, 4s, 8s … so a run of
 * failures cannot turn into a write every 800ms, and a cause that heals by
 * itself (a lock released, a service restarted) is picked up without the user
 * having to do anything.
 *
 * @param failures - consecutive failures so far; 0 means the last write landed.
 * @param baseMs - the first wait.
 * @param capMs - the ceiling on the wait.
 * @returns the delay in ms; 0 when there is nothing to wait for.
 */
export function autosaveRetryDelay(
  failures: number,
  baseMs: number = AUTOSAVE_BACKOFF_MS,
  capMs: number = AUTOSAVE_BACKOFF_CAP_MS,
): number {
  if (!Number.isFinite(failures) || failures < 1) return 0
  return Math.min(baseMs * 2 ** (Math.floor(failures) - 1), capMs)
}
