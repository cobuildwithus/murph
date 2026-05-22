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

async function writeSampleLedger(vaultRoot: string, records: readonly Record<string, unknown>[]) {
  const ledgerPath = path.join(vaultRoot, 'ledger/samples/heart_rate/2026/2026-04.jsonl')
  await mkdir(path.dirname(ledgerPath), { recursive: true })
  await writeFile(
    ledgerPath,
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8',
  )
}

test('importCsvSamples normalizes runtime output and reuses the loaded importer runtime', async () => {
  const loadRuntimeModule = vi.fn(async () => ({
    createImporters() {
      return {
        async importCsvSamples(input: Record<string, unknown>) {
          return {
            importedCount: 2,
            imports: [
              {
                importedCount: 2,
                ledgerFiles: ['ledger/samples/2026/2026-04.jsonl'],
                lookupIds: ['smp_01', 'smp_02'],
                manifestPath: 'raw/samples/heart-rate/import_01/manifest.json',
                skipReasons: [],
                skippedCount: 0,
                stream: String(input.stream ?? 'heart_rate'),
                timeZone: 'UTC',
                transformId: 'xform_01',
                tsColumn: 'timestamp',
                unit: 'bpm',
                valueColumn: String(input.valueColumn ?? 'value'),
              },
            ],
            ledgerFiles: ['ledger/samples/2026/2026-04.jsonl'],
            lookupIds: ['smp_01', 'smp_02'],
            metadataColumns: ['device', 'quality'],
            skippedCount: 0,
            timeZone: 'UTC',
            tsColumn: 'timestamp',
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
    timeZone: 'UTC',
    tsColumn: 'timestamp',
    importedCount: 2,
    skippedCount: 0,
    lookupIds: ['smp_01', 'smp_02'],
    ledgerFiles: ['ledger/samples/2026/2026-04.jsonl'],
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
        transformId: 'xform_01',
        manifestFile: 'raw/samples/heart-rate/import_01/manifest.json',
        lookupIds: ['smp_01', 'smp_02'],
        ledgerFiles: ['ledger/samples/2026/2026-04.jsonl'],
      },
    ],
    inferred: {
      timeZone: 'UTC',
      tsColumn: 'timestamp',
      imports: [{ stream: 'heart_rate', valueColumn: 'value' }],
      metadataColumns: ['device', 'quality'],
    },
  })
  assert.deepEqual(second, {
    vault: '/vaults/main',
    sourceFile: '/tmp/samples-2.csv',
    timeZone: 'UTC',
    tsColumn: 'timestamp',
    importedCount: 2,
    skippedCount: 0,
    lookupIds: ['smp_01', 'smp_02'],
    ledgerFiles: ['ledger/samples/2026/2026-04.jsonl'],
    streams: ['hrv'],
    imports: [
      {
        stream: 'hrv',
        unit: 'bpm',
        timeZone: 'UTC',
        tsColumn: 'timestamp',
        valueColumn: 'value',
        importedCount: 2,
        skippedCount: 0,
        skipReasons: [],
        transformId: 'xform_01',
        manifestFile: 'raw/samples/heart-rate/import_01/manifest.json',
        lookupIds: ['smp_01', 'smp_02'],
        ledgerFiles: ['ledger/samples/2026/2026-04.jsonl'],
      },
    ],
    inferred: {
      timeZone: 'UTC',
      tsColumn: 'timestamp',
      imports: [{ stream: 'hrv', valueColumn: 'value' }],
      metadataColumns: ['device', 'quality'],
    },
  })
})

test('importCsvSamples resets the cached runtime after loader failures', async () => {
  const loadRuntimeModule = vi
    .fn()
    .mockRejectedValueOnce(new Error('missing importers runtime'))
    .mockResolvedValue({
      createImporters() {
        return {
          async importCsvSamples() {
            return {
              importedCount: 1,
              imports: [
                {
                  importedCount: 1,
                  ledgerFiles: ['ledger/samples/2026/2026-04.jsonl'],
                  lookupIds: ['smp_retry'],
                  manifestPath: 'raw/samples/glucose/import_retry/manifest.json',
                  skipReasons: [],
                  skippedCount: 0,
                  stream: 'glucose',
                  timeZone: 'UTC',
                  transformId: 'xform_retry',
                  tsColumn: 'timestamp',
                  unit: 'mg_dL',
                  valueColumn: 'value',
                },
              ],
              ledgerFiles: ['ledger/samples/2026/2026-04.jsonl'],
              lookupIds: ['smp_retry'],
              metadataColumns: [],
              skippedCount: 0,
              timeZone: 'UTC',
              tsColumn: 'timestamp',
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
  assert.deepEqual(retried.streams, ['glucose'])
  assert.deepEqual(retried.lookupIds, ['smp_retry'])
})

test('profileCsvSampleFile normalizes runtime profile output', async () => {
  const loadRuntimeModule = vi.fn(async () => ({
    createImporters() {
      return {
        async profileCsvSampleFile(input: Record<string, unknown>) {
          return {
            sourcePath: input.filePath,
            sourceFileName: 'samples.csv',
            file: {
              kind: 'csv',
              fileName: 'samples.csv',
              byteSize: 120,
              delimiter: ',',
              rowCount: 3,
              dataRowCount: 2,
              blankRowCount: 0,
            },
            columns: [
              { name: 'Time', index: 0, role: 'timestamp' },
              { name: 'Oxygen Level', index: 1, role: 'sample_value', stream: 'spo2', unit: '%' },
            ],
            time: {
              timeZone: 'UTC',
              timestampColumn: 'Time',
              firstRecordedAt: '2026-04-17T00:00:00.000Z',
              lastRecordedAt: '2026-04-17T00:00:01.000Z',
              sampleIntervalSeconds: 1,
              gapCount: 0,
              gaps: [],
            },
            series: [
              {
                stream: 'spo2',
                unit: '%',
                valueColumn: 'Oxygen Level',
                importableCount: 2,
                skippedCount: 0,
                skipReasons: [],
                minValue: 95,
                maxValue: 96,
                averageValue: 95.5,
                confidence: 0.98,
              },
            ],
            sourceHints: [],
            warnings: [],
            summaries: input.includeSummary ? [{ stream: 'spo2', sampleCount: 2 }] : undefined,
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

  const { profileCsvSampleFile } = await loadSampleImportHelpers()
  const result = await profileCsvSampleFile({
    file: '/tmp/samples.csv',
    includeSummary: true,
    summaryProfile: 'oxygen-night',
    thresholdBelow: [92, 90],
    vault: '/vaults/main',
  })

  assert.equal(loadRuntimeModule.mock.calls.length, 1)
  assert.equal(result.vault, '/vaults/main')
  assert.equal(result.sourceFile, '/tmp/samples.csv')
  assert.deepEqual(result.file, {
    kind: 'csv',
    fileName: 'samples.csv',
    byteSize: 120,
    delimiter: ',',
    rowCount: 3,
    dataRowCount: 2,
    blankRowCount: 0,
  })
  assert.deepEqual(result.summaries, [{ stream: 'spo2', sampleCount: 2 }])
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
        rowCount: 2,
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
        rowCount: 1,
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
  assert.equal('sampleIds' in shown, false)
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

test('showSample and listSamples read explicit raw sample ledgers for filtering and not-found handling', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-sample-query-'))
  cleanupPaths.push(vaultRoot)

  await writeSampleLedger(vaultRoot, [
    {
      schemaVersion: 1,
      id: 'smp_low',
      stream: 'heart_rate',
      value: 65,
      unit: 'bpm',
      recordedAt: '2026-04-02T00:00:00.000Z',
      dayKey: '2026-04-02',
      source: 'import',
      quality: 'draft',
    },
    {
      schemaVersion: 1,
      id: 'smp_good',
      stream: 'heart_rate',
      value: 71,
      unit: 'bpm',
      recordedAt: '2026-04-03T00:00:00.000Z',
      dayKey: '2026-04-03',
      source: 'import',
      quality: 'accepted',
    },
  ])

  const toCommandShowEntity = vi.fn((record: { entityId: string }) => ({
    id: record.entityId,
    kind: 'sample',
  }))
  const toSampleCommandListItem = vi.fn((record: { entityId: string }) => ({
    id: record.entityId,
    status: record.entityId === 'smp_good' ? 'accepted' : 'draft',
  }))

  vi.doMock('@murphai/vault-usecases/helpers', async () => {
    const actual = await vi.importActual<typeof import('@murphai/vault-usecases/helpers')>(
      '@murphai/vault-usecases/helpers',
    )

    return {
      ...actual,
      toCommandShowEntity,
      toSampleCommandListItem,
    }
  })

  const { listSamples, showSample } = await loadSampleQueryHelpers()

  const shown = await showSample(vaultRoot, 'smp_good')
  const listed = await listSamples(vaultRoot, {
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
  assert.equal(toCommandShowEntity.mock.calls.length, 1)
  assert.equal(toSampleCommandListItem.mock.calls.length, 1)

  await assert.rejects(
    () => showSample(vaultRoot, 'evt_01'),
    (error) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'not_found' &&
      error.message === 'No sample found for "evt_01".',
  )
  await assert.rejects(
    () => showSample(vaultRoot, 'smp_missing'),
    (error) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'not_found' &&
      error.message === 'No sample found for "smp_missing".',
  )
})

test('summarizeSampleWindow summarizes explicit raw sample ledger records', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-sample-summary-'))
  cleanupPaths.push(vaultRoot)

  await writeSampleLedger(vaultRoot, [
    {
      schemaVersion: 1,
      id: 'smp_spo2_a',
      stream: 'spo2',
      value: 91,
      unit: '%',
      recordedAt: '2026-04-17T01:00:00.000Z',
      dayKey: '2026-04-17',
      source: 'import',
      quality: 'raw',
    },
    {
      schemaVersion: 1,
      id: 'smp_spo2_b',
      stream: 'spo2',
      value: 94,
      unit: '%',
      recordedAt: '2026-04-17T02:00:00.000Z',
      dayKey: '2026-04-17',
      source: 'import',
      quality: 'raw',
    },
  ])

  const { summarizeSampleWindow } = await loadSampleQueryHelpers()
  const summary = await summarizeSampleWindow(vaultRoot, {
    stream: 'spo2',
    from: '2026-04-17T00:00:00.000Z',
    to: '2026-04-17T08:00:00.000Z',
    thresholdBelow: [92, 90],
    gapSeconds: 3,
    profile: 'oxygen-night',
  })

  assert.equal(summary.stream, 'spo2')
  assert.equal(summary.unit, '%')
  assert.equal(summary.sampleCount, 2)
  assert.equal(summary.thresholds[0]?.below, 92)
})
