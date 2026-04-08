import { loadRuntimeModule } from '@murphai/vault-usecases/runtime-import'
import type { ImportersRuntimeModule } from '@murphai/vault-usecases/usecases/types'
import { createRuntimeUnavailableError } from '@murphai/operator-config/runtime-errors'

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
  const runtimeInput = {
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
  const normalized = await importers.prepareCsvSampleImport(runtimeInput)
  const result = await importers.createImporters().importCsvSamples(runtimeInput)

  return {
    vault: options.vault,
    sourceFile: options.file,
    stream: normalized.stream,
    importedCount: result.count,
    transformId: result.transformId,
    manifestFile: result.manifestPath,
    lookupIds: result.records.map((record) => record.id),
    ledgerFiles: result.shardPaths,
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
