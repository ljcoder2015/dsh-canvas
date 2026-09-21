/**
 * dsh-canvas — 分隔文本切行（纯，零依赖）。
 *
 * 从 `artifact-view.tsx` 搬出来单独成文件：这是一个**状态机**（引导区内外、
 * 成对引号、CRLF），它坏掉的样子是「表格串行」而不是抛错，所以它比组件更
 * 需要一份只跑它的测试。
 */

/**
 * Parse delimited text into rows.
 *
 * Pure, and pinned by the tests: quoted cells with embedded commas and escaped
 * quotes (`""`) are the two cases a naive `split(',')` mangles, and a data
 * viewer that mangles rows is worse than none.
 *
 * @param text - the CSV / TSV body.
 * @param delimiter - the field delimiter.
 * @returns the rows, shortest-first normalised to the widest row's length.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 1
        } else quoted = false
      } else cell += char
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === delimiter) {
      row.push(cell)
      cell = ''
      continue
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell)
      cell = ''
      rows.push(row)
      row = []
      continue
    }
    cell += char
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}
