import {
  createRuntimeUnavailableError,
  loadRuntimeModule,
} from '@murphai/vault-usecases/runtime'

interface ImportCsvSamplesRuntimeInput {
  delimiter?: string
  filePath: string
  metadataColumns?: string[]
  presetId?: string
  requestId?: string | null
  source?: string
  stream?: string
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
    importCsvSamples(
      input: ImportCsvSamplesRuntimeInput,
    ): Promise<ImportCsvSamplesRuntimeResult>
  }
}

export interface ImportCsvSamplesOptions {
  delimiter?: string
  file: string
  metadataColumns?: string[]
  presetId?: string
  requestId?: string | null
  source?: string
  stream?: string
  tsColumn?: string
  unit?: string
  valueColumn?: string
  vault: string
}

let importersRuntimePromise: Promise<ImportersRuntimeModule> | null = null

export async function importCsvSamples(options: ImportCsvSamplesOptions) {
  const importers = await loadImportersRuntime()
  const runtimeInput = createImportCsvSamplesRuntimeInput(options)
  const runtime = importers.createImporters()

  if (!runtime || typeof runtime.importCsvSamples !== 'function') {
    importersRuntimePromise = null
    throw createRuntimeUnavailableError(
      'samples import-csv',
      new TypeError('Importer runtime package did not match the expected module shape.'),
    )
  }

  const result = await runtime.importCsvSamples(runtimeInput)

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

function createImportCsvSamplesRuntimeInput(
  options: ImportCsvSamplesOptions,
): ImportCsvSamplesRuntimeInput {
  return {
    delimiter: options.delimiter,
    filePath: options.file,
    metadataColumns: options.metadataColumns,
    presetId: options.presetId,
    requestId: options.requestId,
    source: options.source,
    stream: options.stream,
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
      throw createRuntimeUnavailableError('samples import-csv', error)
    }
  })()

  return importersRuntimePromise
}
