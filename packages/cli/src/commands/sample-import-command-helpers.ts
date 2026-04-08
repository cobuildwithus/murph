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

interface ImportCsvSamplesRuntimeResult {
  count: number
  transformId: string
  manifestPath: string
  records: Array<{
    id: string
  }>
  shardPaths: string[]
}

interface ImportersRuntimeModule {
  createImporters(): {
    importCsvSamples(
      input: ImportCsvSamplesRuntimeInput,
    ): Promise<ImportCsvSamplesRuntimeResult>
  }
  prepareCsvSampleImport(input: ImportCsvSamplesRuntimeInput): Promise<{
    stream: string
  }>
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
  const preparedImport = await importers.prepareCsvSampleImport(runtimeInput)
  const result = await importers.createImporters().importCsvSamples(runtimeInput)

  return {
    vault: options.vault,
    sourceFile: options.file,
    stream: preparedImport.stream,
    importedCount: result.count,
    transformId: result.transformId,
    manifestFile: result.manifestPath,
    lookupIds: result.records.map((record) => record.id),
    ledgerFiles: result.shardPaths,
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

      if (
        typeof runtime.createImporters !== 'function' ||
        typeof runtime.prepareCsvSampleImport !== 'function'
      ) {
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
