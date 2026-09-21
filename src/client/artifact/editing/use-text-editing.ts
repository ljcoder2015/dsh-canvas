/**
 * dsh-canvas — 文本产物的编辑面（F3.12）。
 *
 * 它属于**能做就地编辑的那几种形态**（`isDirectTextKind`：markdown 与纯文本文件），
 * 所以它住在预览器这一侧，而不是外壳里：外壳不知道哪种产物能打字，也不该知道。文本
 * 预览器拿这份状态画三样东西——头部那一格状态与「预览/编辑」单选组、条带上的错误与
 * 放弃确认、正文里的编辑框。
 *
 * 四件事，每件都有一条自己的时钟：
 *
 * 1. **改**：`draft` 是独立的，跳回预览再回到编辑面不会丢；「脏」是与盘上文本的*比较*，
 *    不是一个要记得清掉的标志位（写回之后 payload 就是草稿，脏自然为假）。
 * 2. **写**：按停手期节流（`autosave.ts`），⌘S 与保存钮即时写，写完回读。
 * 3. **拒绝**：文件系统说不行的时候，自动重试停下、把决定权交回用户。
 * 4. **退场**：Esc 与 × 在这一档上意味着「先问一句」——未保存的文本不该默默丢掉。这两条
 *    都不是这里自己关弹窗，而是向外壳**登记**（`useCloseGate` / `useEscapeLayer`）：关
 *    与不关是外壳的动作，问与不问是这里的判断。
 *
 * 预览渲染的是**草稿**而不是 payload（调用方按 `dirty` 决定），因为「刚刚写下的那段话」
 * 不该等到落盘才出现在眼前——那样看起来就像编辑被丢弃了。
 *
 * 状态不必自己按卡片重置：换一张卡时外壳先回到「正在读」，这个组件随之卸载（旧版是同一个
 * 组件里换卡，才需要手写一遍重置）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { ArtifactView } from '../../../types.ts'
import { useCloseGate, useEscapeLayer, type ArtifactChrome } from '../chrome.tsx'
import { autosaveDelay, autosaveRetryDelay, writeFailureShape } from './autosave.ts'
import { modeAfterKey, type ViewerMode } from './mode.ts'
import { writablePayload } from './writable.ts'

/** 编辑面要的一切（加上调用方自己那份 payload；没有就什么都画不出来）。 */
export interface TextEditing {
  /** 这一份 payload 能整篇写回（见 `writable.ts`）；编辑面与编辑钮都由它开合。 */
  canEdit: boolean
  /** 现在正开着编辑面。 */
  editing: boolean
  /** 编辑器里的全文。 */
  draft: string
  /** 用户在编辑器里敲了字（清掉「刚保存过」那句话）。 */
  edit(text: string): void
  /** 草稿与盘上文本不一致。 */
  dirty: boolean
  saving: boolean
  saveError: string
  /** 写被拒到重试也没用的地步：自动尝试已停。 */
  blocked: boolean
  /** 头部那一格状态文案（会随上面几项变）。 */
  status: string
  /** 模式组本身，方向键切完要把焦点交给它选中的那一项。 */
  modeGroup: RefObject<HTMLDivElement>
  setMode(mode: ViewerMode): void
  /** 方向键在模式组里的落点（见 `mode.ts`）。 */
  moveMode(key: string): void
  /** 立刻写并切到预览面（⌘S / 保存钮）。 */
  save(): void
  /** 被拒之后用户给的第二次机会。 */
  retry(): void
  /** 放弃确认条开着吗（它由 {@link useCloseGate} 打开）。 */
  confirming: boolean
  setConfirming(open: boolean): void
}

export function useTextEditing(input: { view: ArtifactView; chrome: ArtifactChrome }): TextEditing {
  const { view, chrome } = input
  const { bridge, projectId, cardId, t, adopt, saved: onSaved, openInEditor } = chrome
  /** `edit` while the textarea is up; the mode group moves between the two. */
  const [mode, setMode] = useState<ViewerMode>(openInEditor ? 'edit' : 'preview')
  /** The mode group, so an arrow key can hand the focus to the option it picked. */
  const modeGroup = useRef<HTMLDivElement | null>(null)
  /** The editor's text. Survives a hop back to the preview, by design. */
  const [draft, setDraft] = useState(view.text)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  /**
   * Consecutive failed writes, and whether the failure was one that repeating
   * cannot fix. State rather than refs: both steer the autosave effect, so a
   * change has to re-arm (or stop) the timer.
   *
   * `blocked` is the answer to "the filesystem refused this directory" — the
   * automatic attempts stop there, because each one costs a staging file the
   * host leaves behind (it writes through a private temp dir and cannot clean it
   * up when the rename is refused) and the user is the only one who can change
   * the answer. The buffer is untouched either way: the draft stays, the close
   * still asks, and 保存 / 重试 still try on demand.
   */
  const [failures, setFailures] = useState(0)
  const [blocked, setBlocked] = useState(false)
  const [saved, setSaved] = useState(false)
  /** The close was asked for with unsaved changes: asking, not closing. */
  const [confirming, setConfirming] = useState(false)
  /**
   * The buffer's text, beside the state rather than instead of it.
   *
   * Two callers read the newest text from outside React's render cycle: the
   * autosave timer, whose callback closes over whatever draft the effect saw
   * last, and the post-write adoption check. Both must see what is in the box
   * *now*, so neither may read the state variable. Every write goes through
   * {@link setBuffer}, so the ref and the state cannot drift apart.
   */
  const draftRef = useRef(view.text)
  /** A write is on the wire. A ref: the timers must not re-arm when it flips. */
  const savingRef = useRef(false)
  /** When the buffer first ran ahead of the disk; null while the two agree. */
  const dirtySince = useRef<number | null>(null)
  /**
   * The board's refresh callback, held rather than depended on.
   *
   * It is an inline arrow at the call site, so it is a new function on every
   * board render — and `flush` is on the autosave effect's dependency list. A
   * volatile callback there would re-arm the timer on each re-render and turn
   * the 800ms settle into "somewhere before 5s". The ref keeps `flush` stable;
   * the effect below is what keeps the ref current.
   */
  const savedRef = useRef(onSaved)
  useEffect(() => {
    savedRef.current = onSaved
  })

  const setBuffer = useCallback((text: string): void => {
    draftRef.current = text
    setDraft(text)
  }, [])

  /** 敲字：草稿跟着走，而「刚保存过」那句话就此作废。 */
  const edit = useCallback(
    (text: string): void => {
      setBuffer(text)
      setSaved(false)
    },
    [setBuffer],
  )

  const canEdit = writablePayload(view)
  const editing = mode === 'edit' && canEdit
  // Compared against the payload rather than kept as a flag: after a save the
  // payload *is* the draft, so "dirty" falls back to false on its own.
  const dirty = canEdit && draft !== view.text

  /**
   * Move the mode group by keyboard (see {@link modeAfterKey}).
   *
   * Selection follows the arrow — that is what separates a radio group from a
   * toolbar of buttons — and focus follows the selection, so Tab still lands on
   * the group once rather than on each half. Switching to the editor ends with
   * the caret in it anyway: the textarea autofocuses when it mounts.
   */
  const moveMode = useCallback(
    (key: string): void => {
      const next = modeAfterKey(editing ? 'edit' : 'preview', key)
      if (next === null) return
      setMode(next)
      modeGroup.current?.querySelectorAll('button')[next === 'preview' ? 0 : 1]?.focus()
    },
    [editing],
  )

  /**
   * Write the buffer back, then re-read what landed.
   *
   * `settle` is the only difference between the two callers: ⌘/Ctrl+S and the
   * 保存 button hand the user over to the preview — they asked to see the
   * result — while an autosave leaves them exactly where they are. An autosave
   * that yanked the editor away mid-sentence would be worse than none.
   */
  const flush = useCallback(
    async (text: string, settle: 'stay' | 'preview'): Promise<void> => {
      if (savingRef.current) return
      savingRef.current = true
      setSaving(true)
      setSaveError('')
      try {
        await bridge.writeText(projectId, cardId, text)
        const payload = await bridge.readArtifact(projectId, cardId)
        adopt(payload)
        // Adopt what came back only if nothing was typed while it was in
        // flight. A slow re-read must not eat the keystrokes that landed after
        // the write: when the buffer has moved on, it simply stays dirty and
        // the next round writes it.
        if (draftRef.current === text) {
          setBuffer(payload.text)
          setSaved(true)
          if (settle === 'preview') setMode('preview')
        }
        setFailures(0)
        setBlocked(false)
        setSaveError('')
        savedRef.current()
      } catch (reason: unknown) {
        const message = reason instanceof Error ? reason.message : t('canvas.error.unknown')
        setFailures((count) => count + 1)
        setSaveError(message)
        // A blocked write ends the automatic attempts here. The message stays up
        // with a 重试 beside it, so the user keeps the lever without the plugin
        // hammering a directory that has already said no.
        if (writeFailureShape(message) === 'blocked') setBlocked(true)
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    [adopt, bridge, cardId, projectId, setBuffer, t],
  )

  /** Save on demand. `draft` is read through the ref: this may run from a key. */
  const save = useCallback((): void => {
    if (dirty) void flush(draftRef.current, 'preview')
  }, [dirty, flush])

  /**
   * ⌘/Ctrl+S is the editor's own chord — the one users already have in their
   * fingers. It stays live on the preview face too: while a draft is pending it
   * means "do it now and show me".
   *
   * The listener lives here rather than in the modal because the modal no longer
   * knows whether there is anything to save: that is this face's private fact.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!canEdit) return
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      save()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canEdit, save])

  /**
   * Try the write again after a blocked one, and put the autosave back on duty.
   *
   * The user's lever: nothing about the refusal is the plugin's to fix, so the
   * plugin waits for whoever can fix it and then does exactly what they asked.
   */
  const retry = useCallback((): void => {
    setBlocked(false)
    setFailures(0)
    dirtySince.current = null
    void flush(draftRef.current, 'stay')
  }, [flush])

  /**
   * Autosave, throttled, and deliberately not gated on the face being shown.
   *
   * A pending buffer settles wherever it is — hopping to the preview to read a
   * paragraph is not a way to leave the edit unwritten. The buffer is what the
   * preview renders until the write confirms, so what the user reads and what
   * is coming never disagree.
   *
   * A failed write owns the clock instead of the settle window (see
   * {@link autosaveRetryDelay}): a wire that keeps refusing gets one attempt per
   * backoff, not one per pause. When the refusal is one repeating cannot fix,
   * the effect stands down entirely — {@link retry} is how it comes back.
   */
  useEffect(() => {
    if (!canEdit || draft === view.text || blocked) {
      dirtySince.current = null
      return
    }
    const now = Date.now()
    if (dirtySince.current === null) dirtySince.current = now
    const delay = failures > 0 ? autosaveRetryDelay(failures) : autosaveDelay(now - dirtySince.current)
    const timer = window.setTimeout(() => {
      dirtySince.current = null
      void flush(draftRef.current, 'stay')
    }, delay)
    return () => window.clearTimeout(timer)
  }, [blocked, canEdit, draft, failures, flush, view.text])

  /**
   * 未保存的文本不该被一次 × 或一下 Esc 默默丢掉：先问一句。
   *
   * 这是**一道闸**而不是一个按钮处理器：弹窗的出口有三处（×、遮罩、Esc），三处都
   * 得先过这里，所以登记给外壳、由它在那三处之前问；问出来的确认条由本面自己画。
   */
  useCloseGate(() => {
    if (!dirty) return false
    setConfirming(true)
    return true
  })

  /** Esc 只在确认条开着的时候归这一档：收起确认条，而不是把预览关掉。 */
  useEscapeLayer(confirming, () => setConfirming(false))

  /**
   * The head's one status slot, in the order the user cares about: a write in
   * flight, then pending text, then the last outcome — and in the editor with
   * nothing pending, the standing fact that pausing is enough to save.
   */
  const status = saving
    ? t('canvas.viewer.saving')
    : blocked
      ? // Above `dirty` on purpose: that the text is unsaved is plain from the
        // error bar, while "nothing will be retried until you say so" is the
        // fact the user cannot see anywhere else.
        t('canvas.viewer.autosaveOff')
      : dirty
        ? t('canvas.viewer.dirty')
        : saved
          ? t('canvas.viewer.saved')
          : editing
            ? t('canvas.viewer.autosave')
            : ''

  return {
    canEdit,
    editing,
    draft,
    edit,
    dirty,
    saving,
    saveError,
    blocked,
    status,
    modeGroup,
    setMode,
    moveMode,
    save,
    retry,
    confirming,
    setConfirming,
  }
}
