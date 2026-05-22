import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { VAULT_LAYOUT } from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { summarizeSampleSeries } from '@murphai/importers/sample-series-summary'
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
  const record = (await listRawSampleRecords(vaultRoot))
    .find((sample) => sample.entityId === sampleId || sample.primaryLookupId === sampleId)

  if (!record) {
    throw new VaultCliError('not_found', `No sample found for "${sampleId}".`)
  }

  return toCommandShowEntity(record)
}

export async function listSamples(
  vaultRoot: string,
  options: SampleListOptions = {},
): Promise<SampleCommandListItem[]> {
  const items = (await listRawSampleRecords(vaultRoot))
    .filter((record) => (options.stream ? record.stream === options.stream : true))
    .filter((record) => matchesDateRange(record.date, options.from, options.to))
    .filter((record: QueryRecord) => (options.quality ? record.status === options.quality : true))
    .sort(compareSamplesByLatest)

  return applyLimit(items, options.limit).map(toSampleCommandListItem)
}

export async function summarizeSampleWindow(
  vaultRoot: string,
  options: SampleSummarizeOptions,
) {
  const records = (await listRawSampleRecords(vaultRoot))
    .filter((record) => record.stream === options.stream)
    .filter((record) => matchesSampleSummaryWindow(record, options))
  const units = [...new Set(records.map((record) => getString(record.attributes.unit)).filter(isString))].sort()

  return summarizeSampleSeries({
    stream: options.stream,
    unit: units.length === 1 ? units[0] : null,
    samples: records
      .map((record) => ({
        recordedAt: record.occurredAt ?? '',
        value: getNumber(record.attributes.value),
      }))
      .filter((record) => record.recordedAt.length > 0),
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

async function listRawSampleRecords(vaultRoot: string): Promise<QueryRecord[]> {
  const files = await walkSampleLedgerFiles(vaultRoot)
  const records = (
    await Promise.all(files.map((relativePath) => readSampleLedgerFile(vaultRoot, relativePath)))
  ).flat()

  return records.sort(compareSamplesByLatest)
}

async function readSampleLedgerFile(
  vaultRoot: string,
  relativePath: string,
): Promise<QueryRecord[]> {
  const absolutePath = path.join(vaultRoot, relativePath)
  const content = await readFile(absolutePath, 'utf8')
  const records: QueryRecord[] = []

  content.split(/\r?\n/u).forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) {
      return
    }

    const parsed = parseJsonLine(trimmed, relativePath, index + 1)
    if (!parsed) {
      return
    }

    const id = getString(parsed.id)
    const recordedAt = getString(parsed.recordedAt)
    const stream = getString(parsed.stream)
    if (!id || !recordedAt || !stream) {
      throw new VaultCliError(
        'invalid_record',
        `Sample ledger record at ${relativePath}:${index + 1} is missing id, recordedAt, or stream.`,
      )
    }

    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter(isString)
      : []

    records.push({
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
    })
  })

  return records
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

function parseJsonLine(line: string, relativePath: string, lineNumber: number): JsonObject | null {
  try {
    const parsed = JSON.parse(line) as unknown
    return isJsonObject(parsed) ? parsed : null
  } catch {
    throw new VaultCliError(
      'invalid_record',
      `Sample ledger record at ${relativePath}:${lineNumber} is not valid JSON.`,
    )
  }
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
