/**
 * dsh-canvas — 数据预览器：CSV / TSV 摊成表格，JSON 排版后原样。
 *
 * 判断只有一条：扩展名说它是 JSON 就排版，否则按分隔符切。切行是状态机的事
 * （`delimited.ts`），这里只管把它画成表格。
 */
import { useMemo } from 'react'
import { parseDelimited } from './delimited.ts'
import type { ViewerProps, ViewerRegistration } from './types.ts'

/** The data viewer: CSV / TSV as a table, JSON pretty-printed. */
export function DataViewer({ view }: ViewerProps) {
  const extension = (view.file.split('.').pop() ?? '').toLowerCase()
  const content = useMemo(() => {
    if (extension === 'json') {
      try {
        return JSON.stringify(JSON.parse(view.text), null, 2)
      } catch {
        return view.text
      }
    }
    return undefined
  }, [extension, view.text])
  const rows = useMemo(() => {
    if (content !== undefined) return undefined
    const delimiter = extension === 'tsv' ? '\t' : ','
    return parseDelimited(view.text, delimiter).slice(0, 400)
  }, [content, extension, view.text])

  if (content !== undefined) return <pre className="dsh-canvas-pre">{content}</pre>
  if (rows === undefined || rows.length === 0) return <div className="dsh-canvas-viewer-note">{''}</div>
  const [head = [], ...body] = rows
  return (
    <div className="dsh-canvas-tablewrap">
      <table className="dsh-canvas-table">
        <thead>
          <tr>{head.map((cell, index) => <th key={index}>{cell}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * 注册项：CSV / TSV / JSON 都摊成别的东西看——表格，或排版后的 JSON。
 *
 * 刻意**不声明** `editable`：这里显示的是渲染结果，而编辑器整篇写回文件；在表格
 * 背后改原始文本是另一件事，不是 F3.12 那个功能（同见 `registry.ts` 的说明）。
 */
export const dataViewer: ViewerRegistration = {
  id: 'data',
  component: DataViewer,
  claims: (kind) => kind === 'data',
}
