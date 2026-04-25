export const DEFAULT_MODEL_EVIDENCE_FRAGMENT_CHARS = 6_000

const LARGE_TABULAR_ROW_THRESHOLD = 100
const LARGE_JSON_COLLECTION_THRESHOLD = 50
const TABULAR_HEAD_SAMPLE_ROWS = 8
const TABULAR_TAIL_SAMPLE_ROWS = 3
const MAX_DISPLAY_HEADERS = 24
const MAX_DISPLAY_CELL_CHARS = 80
const MAX_DISPLAY_ROW_CHARS = 500
const MAX_TABULAR_SUMMARY_CHARS = 4_000
const MAX_JSON_SUMMARY_CHARS = 4_000
const MAX_DISPLAY_JSON_KEYS = 24
const MAX_JSON_COLLECTIONS = 8
const MAX_JSON_COLLECTION_SCAN_ITEMS = 25
const MAX_JSON_SAMPLE_ITEMS = 3
const MAX_JSON_SAMPLE_OBJECT_KEYS = 8
const MAX_JSON_SAMPLE_CHARS = 700
const MAX_JSON_SAMPLE_STRING_CHARS = 120

export type ModelEvidenceFragmentKind =
  | 'attachment_extracted_text'
  | 'attachment_json_summary'
  | 'attachment_tabular_summary'
  | 'attachment_transcript'
  | 'derived_markdown'
  | 'derived_plain_text'
  | 'derived_tables'

export type ModelEvidenceSourceKind = Exclude<
  ModelEvidenceFragmentKind,
  'attachment_json_summary' | 'attachment_tabular_summary'
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

type ModelEvidenceSummaryKind = Extract<
  ModelEvidenceFragmentKind,
  'attachment_json_summary' | 'attachment_tabular_summary'
>

interface ModelEvidenceSummaryProjection {
  kind: ModelEvidenceSummaryKind
  label: string
  maxSummaryChars: number
  source: ModelEvidenceSource
  suppresses: (
    attachment: ModelEvidenceAttachmentMetadata,
    source: ModelEvidenceSource,
    text: string,
  ) => boolean
  text: string
}

export function projectAttachmentEvidenceForModel(input: {
  attachment: ModelEvidenceAttachmentMetadata
  maxFragmentChars?: number
  sources: readonly ModelEvidenceSource[]
}): ModelEvidenceFragment[] {
  const maxFragmentChars =
    input.maxFragmentChars ?? DEFAULT_MODEL_EVIDENCE_FRAGMENT_CHARS
  const summaryProjection = buildSummaryProjection({
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

    if (summaryProjection && summaryProjection.source === source) {
      const boundedSummary = clampText(
        summaryProjection.text,
        Math.min(maxFragmentChars, summaryProjection.maxSummaryChars),
      )
      fragments.push({
        kind: summaryProjection.kind,
        label: summaryProjection.label,
        path: source.path,
        text: boundedSummary.text,
        truncated: true,
      })
      continue
    }

    if (
      summaryProjection &&
      summaryProjection.suppresses(input.attachment, source, text)
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

function buildSummaryProjection(input: {
  attachment: ModelEvidenceAttachmentMetadata
  maxFragmentChars: number
  sources: readonly ModelEvidenceSource[]
}): ModelEvidenceSummaryProjection | null {
  const tabularSummary = buildLargeTabularSummary(input)
  if (tabularSummary) {
    return {
      kind: 'attachment_tabular_summary',
      label: 'attachment-tabular-summary',
      maxSummaryChars: MAX_TABULAR_SUMMARY_CHARS,
      source: tabularSummary.source,
      suppresses: shouldSuppressSourceForTabularSummary,
      text: tabularSummary.text,
    }
  }

  const jsonSummary = buildLargeJsonSummary(input)
  if (jsonSummary) {
    return {
      kind: 'attachment_json_summary',
      label: 'attachment-json-summary',
      maxSummaryChars: MAX_JSON_SUMMARY_CHARS,
      source: jsonSummary.source,
      suppresses: shouldSuppressSourceForJsonSummary,
      text: jsonSummary.text,
    }
  }

  return null
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

function buildLargeJsonSummary(input: {
  attachment: ModelEvidenceAttachmentMetadata
  maxFragmentChars: number
  sources: readonly ModelEvidenceSource[]
}): { source: ModelEvidenceSource; text: string } | null {
  for (const source of input.sources) {
    const text = normalizeModelEvidenceText(source.text)
    if (
      !text ||
      !isJsonSummarySourceCandidate(input.attachment, source, text)
    ) {
      continue
    }

    const profile = analyzeJsonText(text)
    if (!profile) {
      continue
    }

    if (
      text.length <= input.maxFragmentChars &&
      profile.primaryItemCount <= LARGE_JSON_COLLECTION_THRESHOLD
    ) {
      continue
    }

    return {
      source,
      text: renderJsonSummary({
        attachment: input.attachment,
        path: source.path,
        profile,
      }),
    }
  }

  return null
}

function isJsonSummarySourceCandidate(
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
    looksJsonFromMetadata(attachment.fileName) ||
    looksJsonFromMetadata(attachment.mime) ||
    looksJsonFromMetadata(source.path) ||
    parseJsonText(text) !== null
  )
}

function shouldSuppressSourceForJsonSummary(
  _attachment: ModelEvidenceAttachmentMetadata,
  source: ModelEvidenceSource,
  text: string,
): boolean {
  if (source.kind === 'attachment_transcript') {
    return false
  }

  return parseJsonText(text) !== null
}

function looksJsonFromMetadata(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) {
    return false
  }

  return (
    normalized.endsWith('.json') ||
    normalized.includes('application/json') ||
    normalized.includes('+json')
  )
}

interface JsonParseResult {
  value: unknown
}

interface JsonCollectionSummary {
  itemCount: number
  itemTypes: string[]
  objectKeys: string[]
  path: string
  sampleItems: unknown[]
}

interface JsonProfile {
  collections: JsonCollectionSummary[]
  primaryItemCount: number
  rootSample: unknown
  rootType: string
  topLevelKeys: string[]
}

function analyzeJsonText(text: string): JsonProfile | null {
  const parsed = parseJsonText(text)
  if (!parsed) {
    return null
  }

  const value = parsed.value
  const topLevelKeys = isJsonObject(value) ? Object.keys(value) : []
  const collections = collectJsonCollections(value)
  const primaryItemCount =
    collections.length > 0
      ? Math.max(...collections.map((collection) => collection.itemCount))
      : Array.isArray(value)
        ? value.length
        : topLevelKeys.length

  return {
    collections,
    primaryItemCount,
    rootSample: value,
    rootType: describeJsonType(value),
    topLevelKeys,
  }
}

function parseJsonText(text: string): JsonParseResult | null {
  const normalized = stripJsonFence(text.trim().replace(/^\uFEFF/u, ''))
  if (!normalized) {
    return null
  }

  const firstChar = normalized[0]
  if (firstChar !== '{' && firstChar !== '[') {
    return null
  }

  try {
    const value: unknown = JSON.parse(normalized)
    return { value }
  } catch {
    return null
  }
}

function stripJsonFence(text: string): string {
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu)
  return fenceMatch?.[1]?.trim() ?? text
}

function collectJsonCollections(value: unknown): JsonCollectionSummary[] {
  if (Array.isArray(value)) {
    return [describeJsonArray('$', value)]
  }

  if (!isJsonObject(value)) {
    return []
  }

  return Object.entries(value)
    .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
    .slice(0, MAX_JSON_COLLECTIONS)
    .map(([key, arrayValue]) => describeJsonArray(`$.${key}`, arrayValue))
}

function describeJsonArray(
  path: string,
  value: unknown[],
): JsonCollectionSummary {
  const scannedItems = value.slice(0, MAX_JSON_COLLECTION_SCAN_ITEMS)
  const itemTypes = uniqueStrings(scannedItems.map(describeJsonType))
  const objectKeys = uniqueStrings(
    scannedItems.flatMap((item) =>
      isJsonObject(item) ? Object.keys(item) : [],
    ),
  )

  return {
    itemCount: value.length,
    itemTypes,
    objectKeys,
    path,
    sampleItems: value.slice(0, MAX_JSON_SAMPLE_ITEMS),
  }
}

function renderJsonSummary(input: {
  attachment: ModelEvidenceAttachmentMetadata
  path: string | null
  profile: JsonProfile
}): string {
  const sourcePath =
    input.path ??
    input.attachment.derivedPath ??
    input.attachment.storedPath ??
    'unknown'
  const lines = [
    'Large JSON attachment summary:',
    `fileName: ${input.attachment.fileName ?? 'unknown'}`,
    `mime: ${input.attachment.mime ?? 'unknown'}`,
    `byteSize: ${
      typeof input.attachment.byteSize === 'number'
        ? input.attachment.byteSize
        : 'unknown'
    }`,
    `sourcePath: ${sourcePath}`,
    `rootType: ${input.profile.rootType}`,
    ...(input.profile.topLevelKeys.length > 0
      ? [`topLevelKeys: ${formatJsonKeyList(input.profile.topLevelKeys)}`]
      : []),
    ...(input.profile.collections.length > 0
      ? [
          '',
          'Collections:',
          ...input.profile.collections.map(formatJsonCollection),
          '',
          'Sample items:',
          ...input.profile.collections.flatMap(formatJsonCollectionSamples),
        ]
      : [
          '',
          'Root sample:',
          formatJsonSample(input.profile.rootSample),
        ]),
    '',
    'Full parsed JSON content is stored locally but omitted from model context; inspect the source path for the complete data.',
  ]

  return lines.join('\n')
}

function formatJsonCollection(collection: JsonCollectionSummary): string {
  const itemTypes =
    collection.itemTypes.length > 0 ? collection.itemTypes.join(', ') : 'unknown'
  const objectKeys =
    collection.objectKeys.length > 0
      ? `; objectKeys: ${formatJsonKeyList(collection.objectKeys)}`
      : ''
  return `- ${collection.path}: ${collection.itemCount} items; itemTypes: ${itemTypes}${objectKeys}`
}

function formatJsonCollectionSamples(collection: JsonCollectionSummary): string[] {
  if (collection.sampleItems.length === 0) {
    return [`${collection.path}: none`]
  }

  return [
    `${collection.path}:`,
    ...collection.sampleItems.map((item) => `- ${formatJsonSample(item)}`),
  ]
}

function formatJsonSample(value: unknown): string {
  const rendered =
    JSON.stringify(summarizeJsonForDisplay(value)) ?? describeJsonType(value)
  return truncateText(
    rendered,
    MAX_JSON_SAMPLE_CHARS,
  )
}

function summarizeJsonForDisplay(value: unknown, depth = 0): unknown {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value
  }
  if (typeof value === 'string') {
    return truncateText(value, MAX_JSON_SAMPLE_STRING_CHARS)
  }
  if (Array.isArray(value)) {
    if (depth >= 2) {
      return `[array length ${value.length}]`
    }
    const displayed = value
      .slice(0, MAX_JSON_SAMPLE_ITEMS)
      .map((item) => summarizeJsonForDisplay(item, depth + 1))
    return value.length > displayed.length
      ? [...displayed, `[${value.length - displayed.length} more items]`]
      : displayed
  }
  if (isJsonObject(value)) {
    if (depth >= 2) {
      return `[object keys: ${formatJsonKeyList(Object.keys(value))}]`
    }
    const entries = Object.entries(value).slice(0, MAX_JSON_SAMPLE_OBJECT_KEYS)
    const output: Record<string, unknown> = {}
    for (const [key, nestedValue] of entries) {
      output[key] = summarizeJsonForDisplay(nestedValue, depth + 1)
    }
    const omitted = Object.keys(value).length - entries.length
    if (omitted > 0) {
      output.__omittedKeys = omitted
    }
    return output
  }

  return describeJsonType(value)
}

function formatJsonKeyList(keys: readonly string[]): string {
  const displayed = keys.slice(0, MAX_DISPLAY_JSON_KEYS).map(formatCell)
  const omitted = keys.length - displayed.length
  return omitted > 0
    ? `${displayed.join(', ')} (+${omitted} more)`
    : displayed.join(', ')
}

function describeJsonType(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  return typeof value
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
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
