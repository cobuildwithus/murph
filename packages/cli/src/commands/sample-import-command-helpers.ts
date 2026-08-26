import {
  createRuntimeUnavailableError,
  loadRuntimeModule,
} from '@murphai/vault-usecases/runtime'
import { sampleImportIssue } from '@murphai/vault-usecases/records'
import {
  VaultCliError,
} from '@murphai/operator-config/vault-cli-errors'

type CsvSampleCommandName =
  | 'samples import-csv'
  | 'samples csv import'
  | 'samples csv profile'

interface ImportCsvSamplesRuntimeInput {
  delimiter?: string
  filePath: string
  gapSeconds?: number
  includeSummary?: boolean
  metadataColumns?: string[]
  presetId?: string
  requestId?: string | null
  source?: string
  stream?: string
  summaryProfile?: string
  thresholdBelow?: number[]
  tsColumn?: string
  unit?: string
  valueColumn?: string
  vaultRoot: string
}

interface ImportCsvSamplesRuntimeResultItem {
  importedCount: number
  ledgerFiles: string[]
  lookupIds: string[]
  manifestPath: string | null
  skipReasons: Array<{
    count: number
    reason: string
  }>
  skippedCount: number
  stream: string
  timeZone: string
  transformId: string | null
  tsColumn: string
  unit: string
  valueColumn: string
}

interface ImportCsvSamplesRuntimeResult {
  importedCount: number
  imports: ImportCsvSamplesRuntimeResultItem[]
  ledgerFiles: string[]
  lookupIds: string[]
  metadataColumns: string[]
  skippedCount: number
  timeZone: string
  tsColumn: string
}

interface ImportersRuntimeModule {
  createImporters(): {
    profileCsvSampleFile(
      input: ImportCsvSamplesRuntimeInput,
    ): Promise<unknown>
    importCsvSamples(
      input: ImportCsvSamplesRuntimeInput,
    ): Promise<ImportCsvSamplesRuntimeResult>
  }
}

export interface ImportCsvSamplesOptions {
  commandName?: CsvSampleCommandName
  delimiter?: string
  file: string
  gapSeconds?: number
  includeSummary?: boolean
  metadataColumns?: string[]
  presetId?: string
  requestId?: string | null
  source?: string
  stream?: string
  summaryProfile?: string
  thresholdBelow?: number[]
  tsColumn?: string
  unit?: string
  valueColumn?: string
  vault: string
}

let importersRuntimePromise: Promise<ImportersRuntimeModule> | null = null

export async function importCsvSamples(options: ImportCsvSamplesOptions) {
  const commandName = options.commandName ?? 'samples import-csv'
  const importers = await loadImportersRuntimeForCommand(commandName)
  const runtimeInput = createImportCsvSamplesRuntimeInput(options)
  const runtime = importers.createImporters()

  if (!runtime || typeof runtime.importCsvSamples !== 'function') {
    importersRuntimePromise = null
    throw createRuntimeUnavailableError(
      commandName,
      new TypeError('Importer runtime package did not match the expected module shape.'),
    )
  }

  let result
  try {
    result = await runtime.importCsvSamples(runtimeInput)
  } catch (error) {
    throw toCsvSampleCliError(error)
  }

  return {
    vault: options.vault,
    sourceFile: options.file,
    timeZone: result.timeZone,
    tsColumn: result.tsColumn,
    importedCount: result.importedCount,
    skippedCount: result.skippedCount,
    lookupIds: result.lookupIds,
    ledgerFiles: result.ledgerFiles,
    streams: result.imports.map((entry) => entry.stream),
    imports: result.imports.map((entry) => ({
      stream: entry.stream,
      unit: entry.unit,
      timeZone: entry.timeZone,
      tsColumn: entry.tsColumn,
      valueColumn: entry.valueColumn,
      importedCount: entry.importedCount,
      skippedCount: entry.skippedCount,
      skipReasons: entry.skipReasons,
      transformId: entry.transformId,
      manifestFile: entry.manifestPath,
      lookupIds: entry.lookupIds,
      ledgerFiles: entry.ledgerFiles,
    })),
    inferred: {
      timeZone: result.timeZone,
      tsColumn: result.tsColumn,
      imports: result.imports.map((entry) => ({
        stream: entry.stream,
        valueColumn: entry.valueColumn,
      })),
      metadataColumns: result.metadataColumns,
    },
  }
}

export async function profileCsvSampleFile(
  options: ImportCsvSamplesOptions,
): Promise<Record<string, unknown> & {
  file?: unknown
  sourceFile: string
  summaries?: unknown
  vault: string
}> {
  const commandName = options.commandName ?? 'samples csv profile'
  const importers = await loadImportersRuntimeForCommand(commandName)
  const runtimeInput = createImportCsvSamplesRuntimeInput(options)
  const runtime = importers.createImporters()

  if (!runtime || typeof runtime.profileCsvSampleFile !== 'function') {
    importersRuntimePromise = null
    throw createRuntimeUnavailableError(
      'samples csv profile',
      new TypeError('Importer runtime package did not match the expected module shape.'),
    )
  }

  let result
  try {
    result = await runtime.profileCsvSampleFile(runtimeInput)
  } catch (error) {
    throw toCsvSampleCliError(error)
  }

  return {
    vault: options.vault,
    sourceFile: options.file,
    ...(typeof result === 'object' && result !== null ? result : {}),
  }
}

function createImportCsvSamplesRuntimeInput(
  options: ImportCsvSamplesOptions,
): ImportCsvSamplesRuntimeInput {
  return {
    delimiter: options.delimiter,
    filePath: options.file,
    gapSeconds: options.gapSeconds,
    includeSummary: options.includeSummary,
    metadataColumns: options.metadataColumns,
    presetId: options.presetId,
    requestId: options.requestId,
    source: options.source,
    stream: options.stream,
    summaryProfile: options.summaryProfile,
    thresholdBelow: options.thresholdBelow,
    tsColumn: options.tsColumn,
    unit: options.unit,
    valueColumn: options.valueColumn,
    vaultRoot: options.vault,
  }
}

async function loadImportersRuntime(): Promise<ImportersRuntimeModule> {
  importersRuntimePromise ??= (async () => {
    try {
      const runtime = await loadRuntimeModule<ImportersRuntimeModule>('@murphai/importers')

      if (typeof runtime.createImporters !== 'function') {
        throw new TypeError('Importer runtime package did not match the expected module shape.')
      }

      return runtime
    } catch (error) {
      importersRuntimePromise = null
      throw error
    }
  })()

  return importersRuntimePromise
}

async function loadImportersRuntimeForCommand(
  commandName: CsvSampleCommandName,
): Promise<ImportersRuntimeModule> {
  try {
    return await loadImportersRuntime()
  } catch (error) {
    throw createRuntimeUnavailableError(commandName, error)
  }
}

const CSV_SAMPLE_REPAIR_CODES = new Set([
  'invalid_sample',
  'no_importable_rows',
  'timestamp_column_inference_failed',
  'value_column_inference_failed',
])

function toCsvSampleCliError(error: unknown): unknown {
  if (!isRecord(error) || error.name !== 'CsvSampleImportError') {
    return error
  }

  const code = error.code
  const repair = error.repair
  if (
    typeof code !== 'string'
    || !CSV_SAMPLE_REPAIR_CODES.has(code)
    || !isRecord(repair)
    || !Array.isArray(repair.fields)
  ) {
    return error
  }

  if (code === 'invalid_sample') {
    return toCsvSampleSemanticCliError(repair.fields) ?? error
  }

  const issues = repair.fields.flatMap(toCsvSampleIssues)
  const message = createCsvSampleErrorMessage(code, repair.fields)
  if (issues.length === 0 || !message) {
    return error
  }

  return new VaultCliError(
    'invalid_payload',
    message,
    { issues, stage: 'validation' },
  )
}

function toCsvSampleSemanticCliError(
  fields: readonly unknown[],
): VaultCliError | null {
  if (fields.length !== 1 || !isRecord(fields[0])) {
    return null
  }

  const field = fields[0]
  const publicPath = toCsvSamplesIssuePath(field.path)
  if (
    !publicPath
    || typeof field.sampleField !== 'string'
    || typeof field.stream !== 'string'
  ) {
    return null
  }

  const issue = sampleImportIssue(field.sampleField, field.stream)
  if (!issue) {
    return null
  }

  const { hint, ...fieldIssue } = issue
  return new VaultCliError(
    'invalid_payload',
    'Sample CSV contains an invalid sample field.',
    {
      issues: [{ publicPath, ...fieldIssue }],
      stage: 'validation',
      ...(hint ? { hint } : {}),
    },
  )
}

interface CsvSampleIssue {
  code: 'custom'
  expected: 'array' | 'string'
  publicPath: readonly (string | number)[]
}

const CSV_SKIP_REASON_MESSAGES: Readonly<Record<string, string>> = {
  'non-numeric value': 'had a non-numeric value',
  'unparseable timestamp': 'had an unparseable timestamp',
  'unparseable timestamp; non-numeric value':
    'had an unparseable timestamp and non-numeric value',
}

function toCsvSampleIssues(value: unknown): CsvSampleIssue[] {
  if (
    !isRecord(value)
    || typeof value.code !== 'string'
    || typeof value.message !== 'string'
  ) {
    return []
  }

  if (value.code === 'timestamp_column_inference_failed') {
    return [{ code: 'custom', expected: 'string', publicPath: ['tsColumn'] }]
  }
  if (value.code === 'value_column_inference_failed') {
    return [{ code: 'custom', expected: 'string', publicPath: ['valueColumn'] }]
  }

  if (value.code !== 'no_importable_rows') {
    return []
  }

  const publicPath = toCsvSamplesIssuePath(value.path)
  if (!publicPath || readCsvSkipCounts(value.message).length === 0) {
    return []
  }

  return [{ code: 'custom', expected: 'array', publicPath }]
}

interface CsvSkipCount {
  count: number
  message: string
}

function readCsvSkipCounts(message: string): CsvSkipCount[] {
  const counts = /^[a-z_]+ skipped (.+)\.$/u.exec(message)?.[1]
  if (!counts) {
    return []
  }

  return counts.split(', ').flatMap((entry): CsvSkipCount[] => {
    const match = /^(unparseable timestamp(?:; non-numeric value)?|non-numeric value)=(\d+)$/u.exec(entry)
    if (!match) {
      return []
    }
    const reasonMessage = CSV_SKIP_REASON_MESSAGES[match[1] ?? '']
    const count = Number(match[2])
    return reasonMessage && Number.isSafeInteger(count) && count > 0
      ? [{ count, message: reasonMessage }]
      : []
  })
}

function createCsvSampleErrorMessage(
  code: string,
  fields: readonly unknown[],
): string | null {
  if (code === 'timestamp_column_inference_failed') {
    return 'Sample CSV column inference failed. Check --delimiter, then retry with --ts-column set to the exact timestamp column name.'
  }
  if (code === 'value_column_inference_failed') {
    return 'Sample CSV column inference failed. Check --delimiter, then retry with --value-column set to the exact sample value column name and --stream set to its sample stream.'
  }
  if (code !== 'no_importable_rows') {
    return null
  }

  const totals = new Map<string, number>()
  for (const field of fields) {
    if (!isRecord(field) || typeof field.message !== 'string') {
      continue
    }
    for (const entry of readCsvSkipCounts(field.message)) {
      const nextCount = (totals.get(entry.message) ?? 0) + entry.count
      if (!Number.isSafeInteger(nextCount)) {
        return null
      }
      totals.set(entry.message, nextCount)
    }
  }
  if (totals.size === 0) {
    return null
  }

  const summary = Array.from(totals, ([message, count]) =>
    `${count} ${count === 1 ? 'row' : 'rows'} ${message}`
  ).join('; ')
  return `Sample CSV did not contain any importable rows. Skipped rows: ${summary}. Correct those timestamp or numeric value cells, then retry.`
}

function toCsvSamplesIssuePath(
  value: unknown,
): readonly ['imports', number, 'samples'] | null {
  if (
    !Array.isArray(value)
    || value.length !== 3
    || value[0] !== 'imports'
    || typeof value[1] !== 'number'
    || !Number.isSafeInteger(value[1])
    || value[1] < 0
    || value[2] !== 'samples'
  ) {
    return null
  }
  return ['imports', value[1], 'samples']
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
