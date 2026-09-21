/**
 * dsh-canvas — 文本产物的那一面：头部控件 + 条带 + 编辑框（F3.12）。
 *
 * markdown 与纯文本两个预览器做的是**同一件事**：读进来的文字既可以直接看，也可以整篇
 * 改。所以编辑这一面写在这里一次，两个预览器各自只回答「预览长什么样」——一个是渲染过
 * 的 HTML，一个是原样的 pre。
 *
 * 三块东西挂在三个不同的地方 —— 头部插槽、条带插槽、正文 —— 而不是由外壳替它摆：
 * 外壳不知道有状态文案、不知道有保存钮、不知道未保存时该先问一句。
 */
import type { ComponentType } from 'react'
import type { ArtifactView } from '../../../types.ts'
import { Slot, useChrome } from '../chrome.tsx'
import { modeAfterKey } from './mode.ts'
import { useTextEditing } from './use-text-editing.ts'

/** 预览面：吃到的是**草稿**（比盘上新的时候），不是 payload。 */
export type TextPreview = ComponentType<{ text: string }>

/** 文本产物：预览 / 编辑是同一个弹窗的两种样子（F3.12）。 */
export function EditableText({ view, preview: Preview }: { view: ArtifactView; preview: TextPreview }) {
  const chrome = useChrome()
  const t = chrome.t
  const editor = useTextEditing({ view, chrome })

  return (
    <>
      <Slot at="header">
        {editor.status !== '' ? <span className="dsh-canvas-viewer-status">{editor.status}</span> : null}
        {editor.canEdit ? (
          // One control with two choices rather than a button whose label flips:
          // the label used to name the *other* face, so "现在在哪一面" had to be
          // worked out backwards. A checked radio says it outright.
          <div
            ref={editor.modeGroup}
            className="dsh-canvas-modeswitch"
            role="radiogroup"
            aria-label={t('canvas.viewer.mode')}
            onKeyDown={(event) => {
              if (event.altKey || event.metaKey || event.ctrlKey) return
              editor.moveMode(event.key)
              if (modeAfterKey(editor.editing ? 'edit' : 'preview', event.key) !== null) event.preventDefault()
            }}
          >
            <button
              type="button"
              role="radio"
              aria-checked={!editor.editing}
              tabIndex={editor.editing ? -1 : 0}
              className="dsh-canvas-modeswitch-opt"
              onClick={() => editor.setMode('preview')}
            >
              {t('canvas.viewer.preview')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={editor.editing}
              tabIndex={editor.editing ? 0 : -1}
              className="dsh-canvas-modeswitch-opt"
              onClick={() => editor.setMode('edit')}
            >
              {t('canvas.viewer.edit')}
            </button>
          </div>
        ) : null}
        {editor.dirty ? (
          <button
            className="dsh-canvas-chipbtn"
            data-primary="true"
            disabled={editor.saving}
            onClick={() => void editor.save()}
          >
            {t('canvas.viewer.save')}
          </button>
        ) : null}
      </Slot>
      <Slot at="banner">
        {editor.confirming ? (
          <div className="dsh-canvas-viewer-confirm">
            {t('canvas.viewer.discard.title')}
            <span className="dsh-canvas-spacer" />
            <button className="dsh-canvas-chipbtn" onClick={() => editor.setConfirming(false)}>
              {t('canvas.viewer.discard.cancel')}
            </button>
            <button className="dsh-canvas-chipbtn" onClick={() => chrome.discard()}>
              {t('canvas.viewer.discard.confirm')}
            </button>
          </div>
        ) : null}
        {editor.saveError !== '' ? (
          // A refused write says *why* in words the user can act on, and keeps
          // the wire's own words underneath: the raw text names the syscall and
          // the temp path, which is the whole diagnosis for whoever fixes it —
          // but it is not what a writer wants to read at the top of their page.
          <div className="dsh-canvas-viewer-error">
            <span className="dsh-canvas-viewer-errmain">
              {editor.blocked ? t('canvas.viewer.writeBlocked') : t('canvas.error', { message: editor.saveError })}
            </span>
            <span className="dsh-canvas-spacer" />
            {editor.blocked ? (
              <button className="dsh-canvas-chipbtn" onClick={editor.retry}>
                {t('canvas.viewer.retry')}
              </button>
            ) : null}
            {editor.blocked ? <span className="dsh-canvas-viewer-errdetail">{editor.saveError}</span> : null}
          </div>
        ) : null}
      </Slot>
      {/* 草稿提示只在**预览面**说：编辑面里本来就看着草稿，再说一句「你看到的是草稿」
          是废话。 */}
      {editor.dirty && !editor.editing ? (
        <div className="dsh-canvas-viewer-draft">{t('canvas.viewer.draftPreview')}</div>
      ) : null}
      {editor.editing ? (
        <textarea
          className="dsh-canvas-viewer-editor"
          value={editor.draft}
          autoFocus
          spellCheck={false}
          onChange={(event) => editor.edit(event.target.value)}
        />
      ) : (
        <Preview text={editor.draft} />
      )}
    </>
  )
}
