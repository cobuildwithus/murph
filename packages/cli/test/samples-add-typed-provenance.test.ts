import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { initializeVault } from '@murphai/core'
import { createUnwiredVaultServices } from '@murphai/vault-usecases'
import { Cli } from 'incur'
import { test } from 'vitest'
import { registerSamplesCommands } from '../src/commands/samples.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import type { CliEnvelope } from './cli-test-helpers.js'
import { requireData } from './cli-test-helpers.js'

function createSamplesCli() {
  const cli = Cli.create('vault-cli', {
    description: 'samples typed provenance test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  registerSamplesCommands(cli, createUnwiredVaultServices())

  return cli
}

async function runSliceCli<TData>(
  args: string[],
): Promise<CliEnvelope<TData>> {
  const cli = createSamplesCli()
  const output: string[] = []

  await cli.serve([...args, '--full-output', '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return JSON.parse(output.join('').trim()) as CliEnvelope<TData>
}

async function runRawSliceCli(args: string[]): Promise<string> {
  const cli = createSamplesCli()
  const output: string[] = []

  await cli.serve(args, {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return output.join('').trim()
}

test('samples add schema exposes typed source and batch provenance options', async () => {
  const schema = JSON.parse(
    await runRawSliceCli(['samples', 'add', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
    }
  }

  assert.equal('sourcePath' in schema.options.properties, true)
  assert.equal('batchSourceFileName' in schema.options.properties, true)
  assert.equal('batchPresetId' in schema.options.properties, true)
  assert.equal('batchDelimiter' in schema.options.properties, true)
  assert.equal('batchTimestampColumn' in schema.options.properties, true)
  assert.equal('batchValueColumn' in schema.options.properties, true)
  assert.equal('batchMetadataColumns' in schema.options.properties, true)
})

test.sequential('samples add stores typed source and batch provenance in the sample batch manifest', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-samples-provenance-'))
  const sourceRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-samples-source-'))
  const sourcePath = path.join(sourceRoot, 'manual-export.csv')

  try {
    await initializeVault({ vaultRoot })
    await writeFile(
      sourcePath,
      [
        'measured_at,bpm,device,context',
        '2026-03-12T08:00:00.000Z,61,watch,resting',
        '',
      ].join('\n'),
      'utf8',
    )

    const added = await runSliceCli<{
      addedCount: number
      lookupIds: string[]
      quality: string
      source: string
      stream: string
    }>([
      'samples',
      'add',
      '--vault',
      vaultRoot,
      '--stream',
      'heart_rate',
      '--unit',
      'bpm',
      '--recorded-at',
      '2026-03-12T08:00:00.000Z',
      '--value',
      '61',
      '--source',
      'import',
      '--quality',
      'normalized',
      '--source-path',
      sourcePath,
      '--batch-source-file-name',
      'watch-export.csv',
      '--batch-preset-id',
      'manual-watch',
      '--batch-delimiter',
      ',',
      '--batch-timestamp-column',
      'measured_at',
      '--batch-value-column',
      'bpm',
      '--batch-metadata-columns',
      'device',
      '--batch-metadata-columns',
      'context',
    ])

    assert.equal(added.ok, true)
    assert.equal(added.meta?.command, 'samples add')
    assert.equal(requireData(added).stream, 'heart_rate')
    assert.equal(requireData(added).source, 'import')
    assert.equal(requireData(added).quality, 'normalized')
    assert.equal(requireData(added).addedCount, 1)

    const batches = await runSliceCli<{
      items: Array<{
        batchId: string
        importedCount: number | null
        source: string | null
      }>
    }>([
      'samples',
      'batch',
      'list',
      '--vault',
      vaultRoot,
      '--stream',
      'heart_rate',
    ])

    assert.equal(batches.ok, true)
    assert.equal(requireData(batches).items.length, 1)
    assert.equal(requireData(batches).items[0]?.importedCount, 1)
    assert.equal(requireData(batches).items[0]?.source, 'import')

    const batchId = requireData(batches).items[0]?.batchId
    assert.match(String(batchId), /^xfm_/u)

    const shown = await runSliceCli<{
      batchId: string
      importConfig: {
        delimiter?: string
        metadataColumns?: string[]
        presetId?: string
        tsColumn?: string
        valueColumn?: string
      }
      manifest: {
        provenance?: {
          rows?: Array<{
            rawRecordedAt?: string
            rawValue?: string
            recordedAt?: string
            rowNumber?: number
            value?: number
          }>
          sourceFileName?: string
        }
      }
      manifestFile: string
      rawDirectory: string | null
      sampleIds: string[]
      source: string | null
      stream: string | null
    }>([
      'samples',
      'batch',
      'show',
      String(batchId),
      '--vault',
      vaultRoot,
    ])

    assert.equal(shown.ok, true)
    assert.equal(requireData(shown).batchId, batchId)
    assert.equal(requireData(shown).stream, 'heart_rate')
    assert.equal(requireData(shown).source, 'import')
    assert.notEqual(requireData(shown).rawDirectory, null)
    assert.deepEqual(requireData(shown).sampleIds, requireData(added).lookupIds)
    assert.deepEqual(requireData(shown).importConfig, {
      delimiter: ',',
      metadataColumns: ['device', 'context'],
      presetId: 'manual-watch',
      tsColumn: 'measured_at',
      valueColumn: 'bpm',
    })
    assert.equal(requireData(shown).manifest.provenance?.sourceFileName, 'watch-export.csv')
    assert.deepEqual(requireData(shown).manifest.provenance?.rows, [
      {
        rawRecordedAt: '2026-03-12T08:00:00.000Z',
        rawValue: '61',
        recordedAt: '2026-03-12T08:00:00.000Z',
        rowNumber: 1,
        value: 61,
      },
    ])

    type AuditRecord = {
      action?: unknown
      changes?: unknown
      commandName?: unknown
      targetIds?: unknown
    }
    const auditFile = await readFile(path.join(vaultRoot, 'audit/2026/2026-03.jsonl'), 'utf8')
    const auditRecords = auditFile
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as AuditRecord)
    const sampleImportAudit = auditRecords.find(
      (record) => record.action === 'samples_import_csv',
    )

    assert.ok(sampleImportAudit)
    assert.equal(sampleImportAudit.commandName, 'core.importSamples')
    assert.deepEqual(sampleImportAudit.targetIds, requireData(added).lookupIds)
    assert.ok(Array.isArray(sampleImportAudit.changes))
    assert.equal(
      sampleImportAudit.changes.some(
        (change) =>
          typeof change === 'object' &&
          change !== null &&
          'path' in change &&
          change.path === requireData(shown).manifestFile,
      ),
      true,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
    await rm(sourceRoot, { recursive: true, force: true })
  }
})

test.sequential('samples add rejects batch provenance that cannot be persisted or normalized', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-samples-provenance-invalid-'))
  const sourceRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-samples-source-invalid-'))
  const sourcePath = path.join(sourceRoot, 'manual-export.csv')

  try {
    await initializeVault({ vaultRoot })
    await writeFile(sourcePath, 'measured_at,bpm\n2026-03-12T08:00:00.000Z,61\n', 'utf8')

    const missingSourcePath = await runSliceCli([
      'samples',
      'add',
      '--vault',
      vaultRoot,
      '--stream',
      'heart_rate',
      '--unit',
      'bpm',
      '--recorded-at',
      '2026-03-12T08:00:00.000Z',
      '--value',
      '61',
      '--batch-source-file-name',
      'watch-export.csv',
    ])

    assert.equal(missingSourcePath.ok, false)
    assert.match(missingSourcePath.error?.message ?? '', /require --source-path/u)

    const pathLikeSourceFileName = await runSliceCli([
      'samples',
      'add',
      '--vault',
      vaultRoot,
      '--stream',
      'heart_rate',
      '--unit',
      'bpm',
      '--recorded-at',
      '2026-03-12T08:00:00.000Z',
      '--value',
      '61',
      '--source-path',
      sourcePath,
      '--batch-source-file-name',
      'exports/watch-export.csv',
    ])

    assert.equal(pathLikeSourceFileName.ok, false)
    assert.match(
      pathLikeSourceFileName.error?.message ?? '',
      /basename|path separators|file name/u,
    )

    const incompleteImportConfig = await runSliceCli([
      'samples',
      'add',
      '--vault',
      vaultRoot,
      '--stream',
      'heart_rate',
      '--unit',
      'bpm',
      '--recorded-at',
      '2026-03-12T08:00:00.000Z',
      '--value',
      '61',
      '--source-path',
      sourcePath,
      '--batch-preset-id',
      'manual-watch',
    ])

    assert.equal(incompleteImportConfig.ok, false)
    assert.match(incompleteImportConfig.error?.message ?? '', /--batch-delimiter/u)
    assert.match(incompleteImportConfig.error?.message ?? '', /--batch-timestamp-column/u)
    assert.match(incompleteImportConfig.error?.message ?? '', /--batch-value-column/u)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
    await rm(sourceRoot, { recursive: true, force: true })
  }
})
