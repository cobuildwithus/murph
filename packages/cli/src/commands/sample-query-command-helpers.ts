import { readdir } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { VAULT_LAYOUT } from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { summarizeSampleSeries } from '@murphai/health-metrics'
import {
  applyLimit,
  isMissingPathError,
  matchesDateRange,
  toCommandShowEntity,
  toSampleCommandListItem,
  type CommandShowEntity,
  type QueryRecord,
  type SampleCommandListItem,
} from '@murphai/vault-usecases/helpers'

export interface SampleListOptions {
  from?: string
  limit?: number
  quality?: string
  stream?: string
  to?: string
}

export interface SampleSummarizeOptions {
  from?: string
  gapSeconds?: number
  profile?: 'oxygen-night'
  stream: string
  thresholdBelow?: number[]
  to?: string
}

export async function showSample(
  vaultRoot: string,
  sampleId: string,
): Promise<CommandShowEntity> {
  for await (const record of readRawSampleRecords(vaultRoot)) {
    if (record.entityId === sampleId || record.primaryLookupId === sampleId) {
      return toCommandShowEntity(record)
    }
  }
  throw new VaultCliError('not_found', `No sample found for "${sampleId}".`)
}

export async function listSamples(
  vaultRoot: string,
  options: SampleListOptions = {},
): Promise<SampleCommandListItem[]> {
  const items: QueryRecord[] = []
  // dayKey can be explicitly chosen independently of the UTC shard timestamp.
  for await (const record of readRawSampleRecords(vaultRoot, { stream: options.stream })) {
    if (!matchesDateRange(record.date, options.from, options.to)) continue
    if (options.quality && record.status !== options.quality) continue
    items.push(record)
    if (options.limit !== undefined && options.limit > 0 && items.length >= 2 * options.limit) {
      items.sort(compareSamplesByLatest)
      items.length = options.limit
    }
  }
  return applyLimit(items.sort(compareSamplesByLatest), options.limit).map(toSampleCommandListItem)
}

export async function summarizeSampleWindow(
  vaultRoot: string,
  options: SampleSummarizeOptions,
) {
  const samples: Array<{ recordedAt: string; value?: number }> = []
  const units = new Set<string>()
  for await (const record of readRawSampleRecords(vaultRoot, options)) {
    if (!matchesSampleSummaryWindow(record, options)) continue
    const unit = getString(record.attributes.unit)
    if (unit) units.add(unit)
    if (record.occurredAt) samples.push({
      recordedAt: record.occurredAt,
      value: getNumber(record.attributes.value),
    })
  }

  return summarizeSampleSeries({
    stream: options.stream,
    unit: units.size === 1 ? [...units][0] : null,
    samples,
    from: options.from,
    to: options.to,
    thresholdsBelow: options.thresholdBelow,
    gapSeconds: options.gapSeconds,
    profile: options.profile,
  })
}

function matchesSampleSummaryWindow(
  record: QueryRecord,
  options: Pick<SampleSummarizeOptions, 'from' | 'to'>,
): boolean {
  const epochMs = Date.parse(record.occurredAt ?? record.date ?? '')
  if (!Number.isFinite(epochMs)) {
    return matchesDateRange(record.date, options.from, options.to)
  }

  const fromMs = options.from ? Date.parse(options.from) : null
  if (fromMs !== null && Number.isFinite(fromMs) && epochMs < fromMs) {
    return false
  }

  const toMs = options.to ? Date.parse(options.to) : null
  if (toMs !== null && Number.isFinite(toMs) && epochMs > toMs) {
    return false
  }

  return true
}

type JsonObject = Record<string, unknown>

async function* readRawSampleRecords(
  vaultRoot: string,
  options: Pick<SampleListOptions, 'stream' | 'from' | 'to'> = {},
): AsyncGenerator<QueryRecord> {
  const files = await walkSampleLedgerFiles(vaultRoot)
  for (const relativePath of files) {
    if (!sampleShardMatches(relativePath, options)) continue
    // Keep file reads bounded; a narrow query never parses unrelated shards.
    for await (const record of readSampleLedgerFile(vaultRoot, relativePath)) {
      if (!options.stream || record.stream === options.stream) yield record
    }
  }
}

function sampleShardMatches(
  relativePath: string,
  options: Pick<SampleListOptions, 'stream' | 'from' | 'to'>,
): boolean {
  const suffix = relativePath.slice(VAULT_LAYOUT.sampleLedgerDirectory.length + 1)
  const shard = /^([^/]+)\/\d{4}\/(\d{4}-\d{2})\.(?:jsonl|ndjson)$/u.exec(suffix)
  // Retained unpartitioned ledgers still use row-level filtering.
  if (!shard) return true
  if (options.stream && shard[1] !== options.stream) return false
  const month = shard[2]!
  // Only timestamp-based summaries supply bounds; lists filter explicit dayKey.
  const from = options.from ? Date.parse(options.from) : Number.NaN
  const to = options.to ? Date.parse(options.to) : Number.NaN
  return (!Number.isFinite(from) || month >= new Date(from).toISOString().slice(0, 7))
    && (!Number.isFinite(to) || month <= new Date(to).toISOString().slice(0, 7))
}

async function* readSampleLedgerFile(
  vaultRoot: string,
  relativePath: string,
): AsyncGenerator<QueryRecord> {
  const absolutePath = path.join(vaultRoot, relativePath)
  const input = createReadStream(absolutePath, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  let lineNumber = 0
  try {
    for await (const line of lines) {
      lineNumber += 1
      const trimmed = line.trim()
      if (!trimmed) {
        continue
      }

      const parsed = parseJsonLine(trimmed, relativePath, lineNumber)

      const id = getString(parsed.id)
      const recordedAt = getString(parsed.recordedAt)
      const stream = getString(parsed.stream)
      if (!id || !recordedAt || !stream) {
        throw new VaultCliError(
          'invalid_record',
          `Sample ledger record at ${relativePath}:${lineNumber} is missing id, recordedAt, or stream.`,
        )
      }

      const tags = Array.isArray(parsed.tags)
        ? parsed.tags.filter(isString)
        : []

      yield {
        attributes: parsed,
        body: null,
        date: getString(parsed.dayKey) ?? recordedAt.slice(0, 10),
        entityId: id,
        experimentSlug: getString(parsed.experimentSlug),
        family: 'sample',
        frontmatter: null,
        kind: 'sample',
        links: [],
        lookupIds: [id],
        occurredAt: recordedAt,
        path: relativePath,
        primaryLookupId: id,
        recordClass: 'sample',
        relatedIds: [],
        status: getString(parsed.quality),
        stream,
        tags,
        title: `${stream} sample`,
      }
    }
  } finally {
    lines.close()
    input.destroy()
  }
}

async function walkSampleLedgerFiles(vaultRoot: string): Promise<string[]> {
  const relativeRoot = VAULT_LAYOUT.sampleLedgerDirectory
  const absoluteRoot = path.join(vaultRoot, relativeRoot)
  return walkRelativeFiles(absoluteRoot, relativeRoot)
}

async function walkRelativeFiles(
  absoluteDirectory: string,
  relativeDirectory: string,
): Promise<string[]> {
  let entries

  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true })
  } catch (error) {
    if (isMissingPathError(error)) {
      return []
    }

    throw error
  }

  const files: string[] = []

  for (const entry of entries) {
    const absolutePath = path.join(absoluteDirectory, entry.name)
    const relativePath = path.posix.join(relativeDirectory, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await walkRelativeFiles(absolutePath, relativePath)))
      continue
    }

    if (entry.isFile() && isSampleLedgerFileName(entry.name)) {
      files.push(relativePath)
    }
  }

  return files.sort()
}

function isSampleLedgerFileName(fileName: string): boolean {
  return fileName.endsWith('.jsonl') || fileName.endsWith('.ndjson')
}

function parseJsonLine(line: string, relativePath: string, lineNumber: number): JsonObject {
  let parsed: unknown
  try {
    parsed = JSON.parse(line) as unknown
  } catch {
    throw new VaultCliError(
      'invalid_record',
      `Sample ledger record at ${relativePath}:${lineNumber} is not valid JSON.`,
    )
  }
  if (!isJsonObject(parsed)) {
    throw new VaultCliError(
      'invalid_record',
      `Sample ledger record at ${relativePath}:${lineNumber} must be a JSON object.`,
    )
  }
  return parsed
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function compareSamplesByLatest(left: QueryRecord, right: QueryRecord): number {
  const leftDate = left.occurredAt ?? ''
  const rightDate = right.occurredAt ?? ''

  if (leftDate !== rightDate) {
    return rightDate.localeCompare(leftDate)
  }

  return left.entityId.localeCompare(right.entityId)
}
