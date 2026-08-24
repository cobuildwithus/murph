import {
  createRuntimeUnavailableError,
  loadRuntimeModule,
} from '@murphai/vault-usecases/runtime'
import {
  VaultCliError,
  type VaultCliRepairFieldInput,
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

  const fields = repair.fields
    .map(toCsvSampleRepairField)
    .filter((field): field is VaultCliRepairFieldInput => field !== null)
  if (fields.length === 0) {
    return error
  }

  const hint = typeof repair.hint === 'string' ? repair.hint : undefined
  return new VaultCliError(
    'invalid_payload',
    code === 'no_importable_rows'
      ? 'Sample CSV did not contain any importable rows.'
      : 'Sample CSV column inference failed.',
    undefined,
    {
      stage: 'validation',
      fields,
      hint,
    },
  )
}

function toCsvSampleRepairField(value: unknown): VaultCliRepairFieldInput | null {
  if (
    !isRecord(value)
    || typeof value.code !== 'string'
    || typeof value.message !== 'string'
    || !isRepairPath(value.path)
  ) {
    return null
  }

  return {
    path: value.path,
    code: value.code,
    message: value.message,
    ...(typeof value.expected === 'string' ? { expected: value.expected } : {}),
    ...(value.missing === true ? { missing: true } : {}),
  }
}

function isRepairPath(value: unknown): value is string | readonly PropertyKey[] {
  return typeof value === 'string'
    || (
      Array.isArray(value)
      && value.every((segment) => typeof segment === 'string' || typeof segment === 'number')
    )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
