import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, test, vi } from 'vitest'

const cleanupPaths: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.doUnmock('@murphai/vault-usecases/runtime')
  vi.doUnmock('@murphai/vault-usecases/helpers')

  await Promise.all(
    cleanupPaths.splice(0).map(async (targetPath) => {
      await rm(targetPath, {
        force: true,
        recursive: true,
      })
    }),
  )
})

async function createTempDir(prefix: string) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  cleanupPaths.push(directory)
  return directory
}

async function writeJsonFile(
  root: string,
  relativePath: string,
  value: unknown,
) {
  const absolutePath = path.join(root, relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function isVaultCliErrorWithCode(
  error: unknown,
  code: string,
  messageIncludes: string,
): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.includes(messageIncludes)
  )
}

test('stored export pack helpers tolerate a missing exports root and enforce manifest ids', async () => {
  const vaultRoot = await createTempDir('murph-cli-export-helper-')
  const {
    listStoredExportPacks,
    showStoredExportPack,
  } = await import('../src/commands/export-intake-read-helpers.js')

  assert.deepEqual(await listStoredExportPacks(vaultRoot), [])

  await writeJsonFile(vaultRoot, 'exports/packs/pack-alpha/manifest.json', {
    format: 'murph.export-pack.v1',
    packId: 'different-pack-id',
    generatedAt: '2026-04-08T00:00:00.000Z',
    filters: {
      from: '2026-04-01',
      to: '2026-04-07',
      experimentSlug: null,
    },
    manifest: {
      recordCount: 2,
      experimentCount: 0,
      journalCount: 0,
      sampleSummaryCount: 0,
      assessmentCount: 0,
      healthEventCount: 0,
      bankPageCount: 0,
      questionCount: 1,
      fileCount: 1,
    },
    files: [
      {
        path: 'exports/packs/pack-alpha/files/questions.ndjson',
        mediaType: 'application/x-ndjson',
      },
    ],
  })

  await assert.rejects(
    () => showStoredExportPack(vaultRoot, 'pack-alpha'),
    (error) =>
      isVaultCliErrorWithCode(error, 'manifest_invalid', 'different-pack-id'),
  )
})

test('stored export pack listing applies experiment/date filters and stable ordering', async () => {
  const vaultRoot = await createTempDir('murph-cli-export-list-')
  const { listStoredExportPacks } = await import(
    '../src/commands/export-intake-read-helpers.js'
  )

  await writeJsonFile(vaultRoot, 'exports/packs/pack-b/manifest.json', {
    format: 'murph.export-pack.v1',
    packId: 'pack-b',
    generatedAt: '2026-04-09T09:00:00.000Z',
    filters: {
      from: '2026-04-02',
      to: '2026-04-03',
      experimentSlug: 'sleep-reset',
    },
    manifest: {
      recordCount: 3,
      experimentCount: 1,
      journalCount: 0,
      sampleSummaryCount: 0,
      assessmentCount: 0,
      healthEventCount: 0,
      bankPageCount: 0,
      questionCount: 1,
      fileCount: 2,
    },
    files: [
      {
        path: 'exports/packs/pack-b/files/records.ndjson',
        mediaType: 'application/x-ndjson',
      },
    ],
  })
  await writeJsonFile(vaultRoot, 'exports/packs/pack-a/manifest.json', {
    format: 'murph.export-pack.v1',
    packId: 'pack-a',
    generatedAt: '2026-04-09T09:00:00.000Z',
    filters: {
      from: '2026-03-20',
      to: '2026-03-21',
      experimentSlug: null,
    },
    manifest: {
      recordCount: 1,
      experimentCount: 0,
      journalCount: 0,
      sampleSummaryCount: 0,
      assessmentCount: 0,
      healthEventCount: 0,
      bankPageCount: 0,
      questionCount: 0,
      fileCount: 1,
    },
    files: [
      {
        path: 'exports/packs/pack-a/files/records.ndjson',
        mediaType: 'application/x-ndjson',
      },
    ],
  })

  const filtered = await listStoredExportPacks(vaultRoot, {
    from: '2026-04-01',
    experiment: 'sleep-reset',
    limit: 5,
  })

  assert.deepEqual(filtered, [
    {
      packId: 'pack-b',
      manifestFile: 'exports/packs/pack-b/manifest.json',
      generatedAt: '2026-04-09T09:00:00.000Z',
      from: '2026-04-02',
      to: '2026-04-03',
      experiment: 'sleep-reset',
      recordCount: 3,
      questionCount: 1,
      fileCount: 2,
    },
  ])

  const all = await listStoredExportPacks(vaultRoot, {
    limit: 5,
  })
  assert.deepEqual(
    all.map((item) => item.packId),
    ['pack-a', 'pack-b'],
  )
})

test('sample batch helpers handle missing roots, infer stream names, and enforce lookups', async () => {
  const missingVaultRoot = await createTempDir('murph-cli-sample-batches-missing-')
  const batchHelpers = await import('../src/commands/sample-batch-command-helpers.js')

  assert.deepEqual(await batchHelpers.listSampleBatches(missingVaultRoot), [])

  const vaultRoot = await createTempDir('murph-cli-sample-batches-')
  await writeJsonFile(
    vaultRoot,
    'raw/samples/resting-heart-rate/import-01/manifest.json',
    {
      importId: 'xfm_rest_01',
      importedAt: '2026-04-08T01:00:00.000Z',
      source: 'device',
      rawDirectory: 'raw/samples/resting-heart-rate/import-01',
      provenance: {
        importedCount: 2,
        importConfig: {
          delimiter: ',',
        },
        rowCount: 2,
      },
      artifacts: [
        {
          role: 'source_csv',
        },
      ],
    },
  )
  await writeJsonFile(
    vaultRoot,
    'raw/samples/hrv/import-02/manifest.json',
    {
      importId: 'xfm_hrv_02',
      importedAt: '2026-04-07T01:00:00.000Z',
      source: 'device',
      rawDirectory: 'raw/samples/hrv/import-02',
      provenance: {
        importedCount: 1,
        rowCount: 1,
      },
    },
  )

  const restingBatches = await batchHelpers.listSampleBatches(vaultRoot, {
    from: '2026-04-08',
    limit: 5,
    stream: 'resting_heart_rate',
  })
  assert.deepEqual(restingBatches, [
    {
      batchId: 'xfm_rest_01',
      stream: 'resting_heart_rate',
      manifestFile: 'raw/samples/resting-heart-rate/import-01/manifest.json',
      rawDirectory: 'raw/samples/resting-heart-rate/import-01',
      importedAt: '2026-04-08T01:00:00.000Z',
      source: 'device',
      importedCount: 2,
      importConfig: {
        delimiter: ',',
      },
      artifacts: [
        {
          role: 'source_csv',
        },
      ],
      manifest: {
        importId: 'xfm_rest_01',
        importedAt: '2026-04-08T01:00:00.000Z',
        source: 'device',
        rawDirectory: 'raw/samples/resting-heart-rate/import-01',
        provenance: {
          importedCount: 2,
          importConfig: {
            delimiter: ',',
          },
          rowCount: 2,
        },
        artifacts: [
          {
            role: 'source_csv',
          },
        ],
      },
    },
  ])

  await assert.rejects(
    () => batchHelpers.showSampleBatch(vaultRoot, 'xfm_missing'),
    (error) =>
      isVaultCliErrorWithCode(error, 'not_found', 'xfm_missing'),
  )
})

test('sample import helper resets its runtime cache after an invalid module shape', async () => {
  let mode: 'invalid' | 'valid' = 'invalid'
  vi.doMock('@murphai/vault-usecases/runtime', async () => {
    const actual = await vi.importActual<typeof import('@murphai/vault-usecases/runtime')>(
      '@murphai/vault-usecases/runtime',
    )

    return {
      ...actual,
      async loadRuntimeModule() {
        if (mode === 'invalid') {
          return {
            createImporters() {
              return {}
            },
          }
        }

        return {
          createImporters() {
            return {
              async importCsvSamples() {
                return {
                  importedCount: 2,
                  imports: [
                    {
                      importedCount: 2,
                      ledgerFiles: ['ledger/samples/2026-04.ndjson'],
                      lookupIds: ['smp_01', 'smp_02'],
                      manifestPath: 'raw/samples/heart-rate/import-01/manifest.json',
                      skipReasons: [],
                      skippedCount: 0,
                      stream: 'heart_rate',
                      timeZone: 'UTC',
                      transformId: 'xfm_ok_01',
                      tsColumn: 'timestamp',
                      unit: 'bpm',
                      valueColumn: 'value',
                    },
                  ],
                  ledgerFiles: ['ledger/samples/2026-04.ndjson'],
                  lookupIds: ['smp_01', 'smp_02'],
                  metadataColumns: [],
                  skippedCount: 0,
                  timeZone: 'UTC',
                  tsColumn: 'timestamp',
                }
              },
            }
          },
        }
      },
    }
  })

  const { importCsvSamples } = await import(
    '../src/commands/sample-import-command-helpers.js'
  )

  await assert.rejects(
    () =>
      importCsvSamples({
        file: '/tmp/input.csv',
        vault: '/tmp/vault',
      }),
    (error) =>
      isVaultCliErrorWithCode(error, 'runtime_unavailable', 'samples import-csv'),
  )

  mode = 'valid'

  const result = await importCsvSamples({
    file: '/tmp/input.csv',
    requestId: 'req-01',
    source: 'device',
    stream: 'heart_rate',
    vault: '/tmp/vault',
  })

  assert.deepEqual(result, {
    vault: '/tmp/vault',
    sourceFile: '/tmp/input.csv',
    timeZone: 'UTC',
    tsColumn: 'timestamp',
    importedCount: 2,
    skippedCount: 0,
    lookupIds: ['smp_01', 'smp_02'],
    ledgerFiles: ['ledger/samples/2026-04.ndjson'],
    streams: ['heart_rate'],
    imports: [
      {
        stream: 'heart_rate',
        unit: 'bpm',
        timeZone: 'UTC',
        tsColumn: 'timestamp',
        valueColumn: 'value',
        importedCount: 2,
        skippedCount: 0,
        skipReasons: [],
        transformId: 'xfm_ok_01',
        manifestFile: 'raw/samples/heart-rate/import-01/manifest.json',
        lookupIds: ['smp_01', 'smp_02'],
        ledgerFiles: ['ledger/samples/2026-04.ndjson'],
      },
    ],
    inferred: {
      timeZone: 'UTC',
      tsColumn: 'timestamp',
      imports: [{ stream: 'heart_rate', valueColumn: 'value' }],
      metadataColumns: [],
    },
  })
})

test('sample query helpers reject non-sample lookups and filter list results by quality', async () => {
  const vaultRoot = await createTempDir('murph-cli-sample-query-')
  const ledgerPath = path.join(vaultRoot, 'ledger/samples/heart_rate/2026/2026-04.jsonl')
  await mkdir(path.dirname(ledgerPath), { recursive: true })
  await writeFile(
    ledgerPath,
    [
      {
        schemaVersion: 1,
        id: 'smp_raw',
        stream: 'heart_rate',
        value: 65,
        unit: 'bpm',
        recordedAt: '2026-04-08T03:00:00.000Z',
        dayKey: '2026-04-08',
        source: 'import',
        quality: 'raw',
      },
      {
        schemaVersion: 1,
        id: 'smp_curated',
        stream: 'heart_rate',
        value: 70,
        unit: 'bpm',
        recordedAt: '2026-04-07T03:00:00.000Z',
        dayKey: '2026-04-07',
        source: 'import',
        quality: 'curated',
      },
    ].map((record) => JSON.stringify(record)).join('\n') + '\n',
    'utf8',
  )

  vi.doMock('@murphai/vault-usecases/helpers', async () => {
    const actual = await vi.importActual<typeof import('@murphai/vault-usecases/helpers')>(
      '@murphai/vault-usecases/helpers',
    )

    return {
      ...actual,
      toCommandShowEntity(record: { entityId: string; family: string }) {
        return {
          id: record.entityId,
          kind: record.family,
        }
      },
      toSampleCommandListItem(record: { entityId: string; status: string }) {
        return {
          id: record.entityId,
          quality: record.status,
        }
      },
    }
  })

  const { listSamples, showSample } = await import(
    '../src/commands/sample-query-command-helpers.js'
  )

  await assert.rejects(
    () => showSample(vaultRoot, 'evt_not_sample'),
    (error) =>
      isVaultCliErrorWithCode(error, 'not_found', 'evt_not_sample'),
  )

  const shown = await showSample(vaultRoot, 'smp_raw')
  assert.deepEqual(shown, {
    id: 'smp_raw',
    kind: 'sample',
  })

  const items = await listSamples(vaultRoot, {
    limit: 5,
    quality: 'curated',
  })
  assert.deepEqual(items, [
    {
      id: 'smp_curated',
      quality: 'curated',
    },
  ])
})
