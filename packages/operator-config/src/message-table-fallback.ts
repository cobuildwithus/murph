const MARKDOWN_TABLE_DELIMITER_CELL = /^:?-{3,}:?$/u
const MARKDOWN_FENCE = /^\s*([`~]{3,})/u

function parseMarkdownTableRow(
  line: string,
  allowEmptyCells = false,
): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) {
    return null
  }

  const withoutEdges = trimmed
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
  const cells = withoutEdges.split('|').map((cell) => cell.trim())
  if (
    cells.length < 2
    || (!allowEmptyCells && cells.some((cell) => cell.length === 0))
  ) {
    return null
  }
  return cells
}

function isMarkdownTableDelimiter(
  line: string,
  expectedCellCount: number,
): boolean {
  const cells = parseMarkdownTableRow(line)
  return cells !== null
    && cells.length === expectedCellCount
    && cells.every((cell) => MARKDOWN_TABLE_DELIMITER_CELL.test(cell))
}

function renderReadableTableRow(
  headers: readonly string[],
  values: readonly string[],
): string {
  const label = values[0]?.trim() || 'Row'
  const fields = headers.slice(1).map((header, index) => {
    const value = values[index + 1]?.trim() || '—'
    return `${header}: ${value}`
  })
  return `${label}: ${fields.join(' · ')}`
}

type MarkdownFence = {
  marker: '`' | '~'
  length: number
}

function readMarkdownFence(line: string): MarkdownFence | null {
  const match = MARKDOWN_FENCE.exec(line)
  const token = match?.[1]
  if (!token) {
    return null
  }
  const marker = token[0]
  if (marker !== '`' && marker !== '~') {
    return null
  }
  return {
    marker,
    length: token.length,
  }
}

/**
 * Messaging clients do not reliably render Markdown tables. Convert only a
 * complete header + delimiter + body sequence into readable labeled rows,
 * preserve ordinary prose containing pipes, and leave fenced code untouched.
 */
export function normalizeMarkdownTablesForMessage(value: string): string {
  if (!value.includes('|') || !value.includes('\n')) {
    return value
  }

  const lines = value.split('\n')
  const rendered: string[] = []
  let activeFence: MarkdownFence | null = null
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const fence = readMarkdownFence(line)
    if (fence) {
      if (activeFence === null) {
        activeFence = fence
      } else if (
        fence.marker === activeFence.marker
        && fence.length >= activeFence.length
      ) {
        activeFence = null
      }
      rendered.push(line)
      index += 1
      continue
    }

    if (activeFence !== null) {
      rendered.push(line)
      index += 1
      continue
    }

    const headers = parseMarkdownTableRow(line)
    const delimiter = lines[index + 1]
    if (
      headers === null
      || delimiter === undefined
      || !isMarkdownTableDelimiter(delimiter, headers.length)
    ) {
      rendered.push(line)
      index += 1
      continue
    }

    const rows: string[][] = []
    let rowIndex = index + 2
    while (rowIndex < lines.length) {
      const row = parseMarkdownTableRow(lines[rowIndex] ?? '', true)
      if (row === null || row.length !== headers.length) {
        break
      }
      rows.push(row)
      rowIndex += 1
    }

    if (rows.length === 0) {
      rendered.push(line)
      index += 1
      continue
    }

    rendered.push(...rows.map((row) => renderReadableTableRow(headers, row)))
    index = rowIndex
  }

  return rendered.join('\n')
}
