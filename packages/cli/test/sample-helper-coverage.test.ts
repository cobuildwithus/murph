import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test, vi } from 'vitest'

const cleanupPaths: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules()

  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, {
        force: true,
        recursive: true,
      })
    }),
  )
})

async function loadSampleImportHelpers() {
  vi.resetModules()
  return await import('../src/commands/sample-import-command-helpers.js')
}

async function loadSampleBatchHelpers() {
  vi.resetModules()
  return await import('../src/commands/sample-batch-command-helpers.js')
}

async function loadSampleQueryHelpers() {
  vi.resetModules()
  return await import('../src/commands/sample-query-command-helpers.js')
}

test('importCsvSamples normalizes runtime output and reuses the loaded importer runtime', async () => {
  const loadRuntimeModule = vi.fn(async () => ({
    async prepareCsvSampleImport(input: Record<string, unknown>) {
      return {
        stream: String(input.stream ?? 'heart_rate'),
      }
    },
    createImporters() {
      return {
        async importCsvSamples(input: Record<string, unknown>) {
          return {
            count: 2,
            transformId: 'xform_01',
            manifestPath: 'raw/samples/heart-rate/import_01/manifest.json',
            records: [{ id: 'smp_01' }, { id: 'smp_02' }],
            shardPaths: ['ledger/samples/2026/2026-04.jsonl'],
            echoedVault: input.vaultRoot,
          }
        },
      }
    },
  }))

  vi.doMock('@murphai/vault-usecases/runtime', () => ({
    createRuntimeUnavailableError: vi.fn((operationType: string, error: unknown) =>
      Object.assign(new Error(`runtime unavailable: ${operationType}`), {
        code: 'runtime_unavailable',
        cause: error,
      }),
    ),
    loadRuntimeModule,
  }))

  const { importCsvSamples } = await loadSampleImportHelpers()

  const first = await importCsvSamples({
    file: '/tmp/samples.csv',
    metadataColumns: ['device', 'quality'],
    requestId: 'req-01',
    source: 'oura',
    stream: 'heart_rate',
    valueColumn: 'value',
    vault: '/vaults/main',
  })
  const second = await importCsvSamples({
    file: '/tmp/samples-2.csv',
    presetId: 'preset_hrv',
    stream: 'hrv',
    vault: '/vaults/main',
  })

  assert.equal(loadRuntimeModule.mock.calls.length, 1)
  assert.deepEqual(first, {
    vault: '/vaults/main',
    sourceFile: '/tmp/samples.csv',
    stream: 'heart_rate',
    importedCount: 2,
    transformId: 'xform_01',
    manifestFile: 'raw/samples/heart-rate/import_01/manifest.json',
    lookupIds: ['smp_01', 'smp_02'],
    ledgerFiles: ['ledger/samples/2026/2026-04.jsonl'],
  })
  assert.deepEqual(second, {
    vault: '/vaults/main',
    sourceFile: '/tmp/samples-2.csv',
    stream: 'hrv',
    importedCount: 2,
    transformId: 'xform_01',
    manifestFile: 'raw/samples/heart-rate/import_01/manifest.json',
    lookupIds: ['smp_01', 'smp_02'],
    ledgerFiles: ['ledger/samples/2026/2026-04.jsonl'],
  })
})

test('importCsvSamples resets the cached runtime after loader failures', async () => {
  const loadRuntimeModule = vi
    .fn()
    .mockRejectedValueOnce(new Error('missing importers runtime'))
    .mockResolvedValue({
      async prepareCsvSampleImport() {
        return {
          stream: 'glucose',
        }
      },
      createImporters() {
        return {
          async importCsvSamples() {
            return {
              count: 1,
              transformId: 'xform_retry',
              manifestPath: 'raw/samples/glucose/import_retry/manifest.json',
              records: [{ id: 'smp_retry' }],
              shardPaths: ['ledger/samples/2026/2026-04.jsonl'],
            }
          },
        }
      },
    })

  vi.doMock('@murphai/vault-usecases/runtime', () => ({
    createRuntimeUnavailableError: vi.fn((operationType: string, error: unknown) =>
      Object.assign(new Error(`runtime unavailable: ${operationType}`), {
        code: 'runtime_unavailable',
        operationType,
        cause: error,
      }),
    ),
    loadRuntimeModule,
  }))

  const { importCsvSamples } = await loadSampleImportHelpers()

  await assert.rejects(
    () =>
      importCsvSamples({
        file: '/tmp/samples.csv',
        vault: '/vaults/main',
      }),
    (error) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'runtime_unavailable' &&
      'operationType' in error &&
      error.operationType === 'samples import-csv',
  )

  const retried = await importCsvSamples({
    file: '/tmp/samples.csv',
    vault: '/vaults/main',
  })

  assert.equal(loadRuntimeModule.mock.calls.length, 2)
  assert.equal(retried.stream, 'glucose')
  assert.deepEqual(retried.lookupIds, ['smp_retry'])
})

test('listSampleBatches sorts, filters, and infers sample streams from stored manifests', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-sample-batches-'))
  cleanupPaths.push(vaultRoot)

  await mkdir(path.join(vaultRoot, 'raw/samples/heart-rate/import_alpha'), {
    recursive: true,
  })
  await mkdir(path.join(vaultRoot, 'raw/samples/hrv/import_beta'), {
    recursive: true,
  })

  await writeFile(
    path.join(vaultRoot, 'raw/samples/heart-rate/import_alpha/manifest.json'),
    JSON.stringify({
      importId: 'import_alpha',
      importedAt: '2026-04-05T08:00:00.000Z',
      source: 'oura',
      rawDirectory: 'raw/samples/heart-rate/import_alpha',
      provenance: {
        importedCount: 2,
        sampleIds: ['smp_01', 'smp_02'],
        importConfig: {
          delimiter: ',',
        },
      },
      artifacts: [{ path: 'raw/samples/heart-rate/import_alpha/source.csv' }],
    }),
    'utf8',
  )
  await writeFile(
    path.join(vaultRoot, 'raw/samples/hrv/import_beta/manifest.json'),
    JSON.stringify({
      importedAt: '2026-04-06T08:00:00.000Z',
      source: null,
      provenance: {
        importedCount: 1,
        sampleIds: ['smp_10'],
        importConfig: {
          unit: 'ms',
        },
      },
    }),
    'utf8',
  )

  const { listSampleBatches, showSampleBatch } = await loadSampleBatchHelpers()

  const listed = await listSampleBatches(vaultRoot, {
    from: '2026-04-05',
    limit: 5,
  })
  const filtered = await listSampleBatches(vaultRoot, {
    stream: 'heart_rate',
  })
  const shown = await showSampleBatch(vaultRoot, 'import_alpha')

  assert.deepEqual(
    listed.map((entry) => entry.batchId),
    ['import_beta', 'import_alpha'],
  )
  assert.equal(listed[0]?.stream, 'hrv')
  assert.equal(listed[0]?.rawDirectory, null)
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0]?.batchId, 'import_alpha')
  assert.equal(shown.stream, 'heart_rate')
  assert.equal(shown.importedCount, 2)
  assert.equal(shown.source, 'oura')
  assert.deepEqual(shown.sampleIds, ['smp_01', 'smp_02'])
  assert.deepEqual(shown.importConfig, {
    delimiter: ',',
  })
  assert.deepEqual(shown.artifacts, [
    {
      path: 'raw/samples/heart-rate/import_alpha/source.csv',
    },
  ])
})

test('showSampleBatch reports not-found and listSampleBatches tolerates a missing samples root', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-sample-batches-empty-'))
  cleanupPaths.push(vaultRoot)

  const { listSampleBatches, showSampleBatch } = await loadSampleBatchHelpers()

  assert.deepEqual(await listSampleBatches(vaultRoot), [])
  await assert.rejects(
    () => showSampleBatch(vaultRoot, 'missing_batch'),
    (error) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'not_found' &&
      error.message === 'No sample batch found for "missing_batch".',
  )
})

test('showSample and listSamples use the query runtime helpers for filtering and not-found handling', async () => {
  const loadQueryRuntime = vi.fn(async () => ({
    async readVault(vaultRoot: string) {
      return {
        vaultRoot,
      }
    },
    lookupEntityById(_vault: unknown, sampleId: string) {
      if (sampleId === 'smp_missing') {
        return null
      }

      return {
        family: sampleId === 'evt_01' ? 'event' : 'sample',
        entityId: sampleId,
      }
    },
    listEntities(_vault: unknown, input: Record<string, unknown>) {
      assert.deepEqual(input, {
        from: '2026-04-01',
        families: ['sample'],
        streams: ['heart_rate'],
        to: '2026-04-08',
      })

      return [
        { entityId: 'smp_low', status: 'draft', latestAt: '2026-04-02T00:00:00.000Z' },
        { entityId: 'smp_good', status: 'accepted', latestAt: '2026-04-03T00:00:00.000Z' },
      ]
    },
  }))
  const toCommandShowEntity = vi.fn((record: { entityId: string }) => ({
    id: record.entityId,
    kind: 'sample',
  }))
  const toSampleCommandListItem = vi.fn((record: { entityId: string }) => ({
    id: record.entityId,
    status: record.entityId === 'smp_good' ? 'accepted' : 'draft',
  }))

  vi.doMock('@murphai/vault-usecases/helpers', () => ({
    applyLimit: <T>(items: T[], limit?: number) =>
      typeof limit === 'number' ? items.slice(0, limit) : items,
    compareByLatest: (left: { latestAt: string }, right: { latestAt: string }) =>
      right.latestAt.localeCompare(left.latestAt),
    loadQueryRuntime,
    toCommandShowEntity,
    toSampleCommandListItem,
  }))

  const { listSamples, showSample } = await loadSampleQueryHelpers()

  const shown = await showSample('/vaults/main', 'smp_good')
  const listed = await listSamples('/vaults/main', {
    from: '2026-04-01',
    limit: 1,
    quality: 'accepted',
    stream: 'heart_rate',
    to: '2026-04-08',
  })

  assert.deepEqual(shown, {
    id: 'smp_good',
    kind: 'sample',
  })
  assert.deepEqual(listed, [
    {
      id: 'smp_good',
      status: 'accepted',
    },
  ])
  assert.equal(loadQueryRuntime.mock.calls.length, 2)
  assert.equal(toCommandShowEntity.mock.calls.length, 1)
  assert.equal(toSampleCommandListItem.mock.calls.length, 1)

  await assert.rejects(
    () => showSample('/vaults/main', 'evt_01'),
    (error) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'not_found' &&
      error.message === 'No sample found for "evt_01".',
  )
  await assert.rejects(
    () => showSample('/vaults/main', 'smp_missing'),
    (error) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'not_found' &&
      error.message === 'No sample found for "smp_missing".',
  )
})
