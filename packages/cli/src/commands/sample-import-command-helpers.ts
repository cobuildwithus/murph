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

type CsvSampleFailure =
  | { code: 'timestamp_column_inference_failed' }
  | { code: 'value_column_inference_failed' }
  | {
    code: 'no_importable_rows'
    importIndexes: readonly number[]
  }
  | {
    code: 'invalid_sample'
    importIndex: number
    sampleField: string
    stream: string
  }

function toCsvSampleCliError(error: unknown): unknown {
  const failure = readCsvSampleFailure(error)
  if (!failure) {
    return error
  }

  switch (failure.code) {
    case 'timestamp_column_inference_failed': {
      return new VaultCliError(
        'invalid_payload',
        'Sample CSV column inference failed. Check --delimiter, then retry with --ts-column set to the exact timestamp column name.',
        {
          issues: [{ code: 'custom', expected: 'string', publicPath: ['tsColumn'] }],
          stage: 'validation',
        },
      )
    }
    case 'value_column_inference_failed': {
      return new VaultCliError(
        'invalid_payload',
        'Sample CSV column inference failed. Check --delimiter, then retry with --value-column set to the exact sample value column name and --stream set to its sample stream.',
        {
          issues: [{ code: 'custom', expected: 'string', publicPath: ['valueColumn'] }],
          stage: 'validation',
        },
      )
    }
    case 'no_importable_rows': {
      return new VaultCliError(
        'invalid_payload',
        'Sample CSV did not contain any importable rows. Correct invalid timestamp or numeric value cells, then retry.',
        {
          issues: failure.importIndexes.map((importIndex) => ({
            code: 'custom',
            expected: 'array',
            publicPath: ['imports', importIndex, 'samples'],
          })),
          stage: 'validation',
        },
      )
    }
    case 'invalid_sample': {
      const issue = sampleImportIssue(failure.sampleField, failure.stream)
      if (!issue) {
        return error
      }

      const { hint, ...fieldIssue } = issue
      return new VaultCliError(
        'invalid_payload',
        'Sample CSV contains an invalid sample field.',
        {
          issues: [{
            publicPath: ['imports', failure.importIndex, 'samples'],
            ...fieldIssue,
          }],
          stage: 'validation',
          ...(hint ? { hint } : {}),
        },
      )
    }
  }

  const exhaustive: never = failure
  return exhaustive
}

function readCsvSampleFailure(error: unknown): CsvSampleFailure | null {
  if (
    !isRecord(error)
    || error.name !== 'CsvSampleImportError'
    || !isRecord(error.failure)
    || typeof error.failure.code !== 'string'
  ) {
    return null
  }

  const failure = error.failure
  if (
    failure.code === 'timestamp_column_inference_failed'
    || failure.code === 'value_column_inference_failed'
  ) {
    return { code: failure.code }
  }

  if (failure.code === 'no_importable_rows') {
    if (
      !Array.isArray(failure.importIndexes)
      || failure.importIndexes.length === 0
      || failure.importIndexes.some((value) =>
        typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < 0
      )
      || new Set(failure.importIndexes).size !== failure.importIndexes.length
    ) {
      return null
    }
    return { code: failure.code, importIndexes: failure.importIndexes }
  }

  if (
    failure.code === 'invalid_sample'
    && typeof failure.importIndex === 'number'
    && Number.isSafeInteger(failure.importIndex)
    && failure.importIndex >= 0
    && typeof failure.sampleField === 'string'
    && typeof failure.stream === 'string'
  ) {
    return {
      code: failure.code,
      importIndex: failure.importIndex,
      sampleField: failure.sampleField,
      stream: failure.stream,
    }
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
