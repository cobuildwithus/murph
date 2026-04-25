export const DEFAULT_MODEL_EVIDENCE_FRAGMENT_CHARS = 6_000

const LARGE_TABULAR_ROW_THRESHOLD = 100
const TABULAR_HEAD_SAMPLE_ROWS = 8
const TABULAR_TAIL_SAMPLE_ROWS = 3
const MAX_DISPLAY_HEADERS = 24
const MAX_DISPLAY_CELL_CHARS = 80
const MAX_DISPLAY_ROW_CHARS = 500
const MAX_TABULAR_SUMMARY_CHARS = 4_000

export type ModelEvidenceFragmentKind =
  | 'attachment_extracted_text'
  | 'attachment_tabular_summary'
  | 'attachment_transcript'
  | 'derived_markdown'
  | 'derived_plain_text'
  | 'derived_tables'

export type ModelEvidenceSourceKind = Exclude<
  ModelEvidenceFragmentKind,
  'attachment_tabular_summary'
>

export interface ModelEvidenceSource {
  kind: ModelEvidenceSourceKind
  label: string
  path: string | null
  text: string | null | undefined
}

export interface ModelEvidenceAttachmentMetadata {
  byteSize?: number | null
  derivedPath?: string | null
  fileName?: string | null
  mime?: string | null
  storedPath?: string | null
}

export interface ModelEvidenceFragment {
  kind: ModelEvidenceFragmentKind
  label: string
  path: string | null
  text: string
  truncated: boolean
}

export function projectAttachmentEvidenceForModel(input: {
  attachment: ModelEvidenceAttachmentMetadata
  maxFragmentChars?: number
  sources: readonly ModelEvidenceSource[]
}): ModelEvidenceFragment[] {
  const maxFragmentChars =
    input.maxFragmentChars ?? DEFAULT_MODEL_EVIDENCE_FRAGMENT_CHARS
  const tabularSummary = buildLargeTabularSummary({
    attachment: input.attachment,
    maxFragmentChars,
    sources: input.sources,
  })
  const fragments: ModelEvidenceFragment[] = []

  for (const source of input.sources) {
    const text = normalizeModelEvidenceText(source.text)
    if (!text) {
      continue
    }

    if (tabularSummary && tabularSummary.source === source) {
      const boundedSummary = clampText(
        tabularSummary.text,
        Math.min(maxFragmentChars, MAX_TABULAR_SUMMARY_CHARS),
      )
      fragments.push({
        kind: 'attachment_tabular_summary',
        label: 'attachment-tabular-summary',
        path: source.path,
        text: boundedSummary.text,
        truncated: true,
      })
      continue
    }

    if (
      tabularSummary &&
      shouldSuppressSourceForTabularSummary(input.attachment, source, text)
    ) {
      continue
    }

    const clamped = clampText(text, maxFragmentChars)
    fragments.push({
      kind: source.kind,
      label: source.label,
      path: source.path,
      text: clamped.text,
      truncated: clamped.truncated,
    })
  }

  return fragments
}

function buildLargeTabularSummary(input: {
  attachment: ModelEvidenceAttachmentMetadata
  maxFragmentChars: number
  sources: readonly ModelEvidenceSource[]
}): { source: ModelEvidenceSource; text: string } | null {
  for (const source of input.sources) {
    const text = normalizeModelEvidenceText(source.text)
    if (
      !text ||
      !isTabularSummarySourceCandidate(input.attachment, source, text)
    ) {
      continue
    }

    const profile = analyzeTabularText(text)
    if (!profile) {
      continue
    }

    if (
      text.length <= input.maxFragmentChars &&
      profile.dataRowCount <= LARGE_TABULAR_ROW_THRESHOLD
    ) {
      continue
    }

    return {
      source,
      text: renderTabularSummary({
        attachment: input.attachment,
        path: source.path,
        profile,
      }),
    }
  }

  return null
}

function isTabularSummarySourceCandidate(
  attachment: ModelEvidenceAttachmentMetadata,
  source: ModelEvidenceSource,
  text: string,
): boolean {
  if (source.kind === 'attachment_transcript') {
    return false
  }
  if (source.kind === 'derived_tables') {
    return false
  }

  return (
    looksTabularFromMetadata(attachment.fileName) ||
    looksTabularFromMetadata(attachment.mime) ||
    looksTabularFromMetadata(source.path) ||
    analyzeTabularText(text) !== null
  )
}

function shouldSuppressSourceForTabularSummary(
  attachment: ModelEvidenceAttachmentMetadata,
  source: ModelEvidenceSource,
  text: string,
): boolean {
  if (source.kind === 'attachment_transcript') {
    return false
  }

  return (
    source.kind === 'derived_tables' ||
    looksTabularFromMetadata(attachment.fileName) ||
    looksTabularFromMetadata(attachment.mime) ||
    looksTabularFromMetadata(source.path) ||
    analyzeTabularText(text) !== null
  )
}

function looksTabularFromMetadata(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) {
    return false
  }

  return (
    normalized.endsWith('.csv') ||
    normalized.endsWith('.tsv') ||
    normalized.includes('text/csv') ||
    normalized.includes('application/csv') ||
    normalized.includes('comma-separated-values') ||
    normalized.includes('tab-separated-values')
  )
}

interface TabularProfile {
  columns: number
  dataRowCount: number
  delimiter: string
  firstRows: string[][]
  headers: string[]
  lastRows: string[][]
  totalLineCount: number
}

function analyzeTabularText(text: string): TabularProfile | null {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length < 2) {
    return null
  }

  const delimiter = inferDelimiter(lines)
  if (!delimiter) {
    return null
  }

  const headers = splitDelimitedLine(lines[0] ?? '', delimiter)
  if (headers.length < 2) {
    return null
  }

  const dataLines = lines.slice(1)
  const firstRows = dataLines
    .slice(0, TABULAR_HEAD_SAMPLE_ROWS)
    .map((line) => splitDelimitedLine(line, delimiter))
  const tailStart = Math.max(
    TABULAR_HEAD_SAMPLE_ROWS,
    dataLines.length - TABULAR_TAIL_SAMPLE_ROWS,
  )
  const lastRows = dataLines
    .slice(tailStart)
    .map((line) => splitDelimitedLine(line, delimiter))

  return {
    columns: headers.length,
    dataRowCount: dataLines.length,
    delimiter,
    firstRows,
    headers,
    lastRows,
    totalLineCount: lines.length,
  }
}

function inferDelimiter(lines: readonly string[]): string | null {
  const candidates = [',', '\t', ';'] as const
  let selected: { delimiter: string; score: number } | null = null

  for (const delimiter of candidates) {
    let score = 0
    for (const line of lines.slice(0, 12)) {
      const columns = splitDelimitedLine(line, delimiter).length
      if (columns >= 2) {
        score += columns
      }
    }

    if (!selected || score > selected.score) {
      selected = { delimiter, score }
    }
  }

  return selected && selected.score > 0 ? selected.delimiter : null
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? ''
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === delimiter && !inQuotes) {
      cells.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  cells.push(current.trim())
  return cells
}

function renderTabularSummary(input: {
  attachment: ModelEvidenceAttachmentMetadata
  path: string | null
  profile: TabularProfile
}): string {
  const sourcePath =
    input.path ??
    input.attachment.derivedPath ??
    input.attachment.storedPath ??
    'unknown'
  const lines = [
    'Large tabular attachment summary:',
    `fileName: ${input.attachment.fileName ?? 'unknown'}`,
    `mime: ${input.attachment.mime ?? 'unknown'}`,
    `byteSize: ${
      typeof input.attachment.byteSize === 'number'
        ? input.attachment.byteSize
        : 'unknown'
    }`,
    `sourcePath: ${sourcePath}`,
    `rows: ${input.profile.dataRowCount} data rows plus header (${input.profile.totalLineCount} non-empty lines)`,
    `columns: ${input.profile.columns}`,
    `headers: ${formatHeaderList(input.profile.headers)}`,
    '',
    'First rows:',
    ...formatSampleRows(input.profile.firstRows),
    ...(input.profile.lastRows.length > 0
      ? ['', 'Last rows:', ...formatSampleRows(input.profile.lastRows)]
      : []),
    '',
    'Full parsed tabular content is stored locally but omitted from model context; inspect the source path for the complete data.',
  ]

  return lines.join('\n')
}

function formatHeaderList(headers: readonly string[]): string {
  const displayed = headers.slice(0, MAX_DISPLAY_HEADERS).map(formatCell)
  const omitted = headers.length - displayed.length
  return omitted > 0
    ? `${displayed.join(', ')} (+${omitted} more)`
    : displayed.join(', ')
}

function formatSampleRows(rows: readonly string[][]): string[] {
  if (rows.length === 0) {
    return ['- none']
  }

  return rows.map((row) => {
    const rendered = row.map(formatCell).join(' | ')
    return `- ${truncateText(rendered, MAX_DISPLAY_ROW_CHARS)}`
  })
}

function formatCell(value: string): string {
  return truncateText(value.replace(/\s+/gu, ' ').trim(), MAX_DISPLAY_CELL_CHARS)
}

function normalizeModelEvidenceText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function clampText(
  value: string,
  limit: number,
): {
  text: string
  truncated: boolean
} {
  const normalized = value.trim()
  if (normalized.length <= limit) {
    return {
      text: normalized,
      truncated: false,
    }
  }

  const suffix = `\n\n[truncated ${normalized.length - limit} characters]`
  const safeLimit = Math.max(0, limit - suffix.length)
  return {
    text: `${normalized.slice(0, safeLimit)}${suffix}`,
    truncated: true,
  }
}

function truncateText(value: string, limit: number): string {
  return value.length <= limit
    ? value
    : `${value.slice(0, Math.max(0, limit - 3))}...`
}
