import assert from 'node:assert/strict'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { initializeVault } from '@murphai/core'
import { Cli } from 'incur'
import { test } from 'vitest'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { registerAuditCommands } from '../src/commands/audit.js'
import { registerSamplesCommands } from '../src/commands/samples.js'
import { createUnwiredVaultServices } from '@murphai/assistant-core/vault-services'
import type { CliEnvelope } from './cli-test-helpers.js'
import { requireData, runCli } from './cli-test-helpers.js'

function createSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'samples/audit slice test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  const services = createUnwiredVaultServices()

  registerSamplesCommands(cli, services)
  registerAuditCommands(cli, services)

  return cli
}

async function runSliceCli<TData>(
  args: string[],
): Promise<CliEnvelope<TData>> {
  const cli = createSliceCli()
  const output: string[] = []

  await cli.serve([...args, '--verbose', '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return JSON.parse(output.join('').trim()) as CliEnvelope<TData>
}

async function runRawSliceCli(args: string[]): Promise<string> {
  const cli = createSliceCli()
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

test('samples import-csv schema exposes the expansion-only import options', async () => {
  const schema = JSON.parse(
    await runRawSliceCli(['samples', 'import-csv', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('preset' in schema.options.properties, true)
  assert.equal('delimiter' in schema.options.properties, true)
  assert.equal('metadataColumns' in schema.options.properties, true)
  assert.equal('source' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault'])
})

test.sequential('samples commands support richer import options plus show/list/batch follow-up flows', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-samples-'))
  const csvPath = path.join(vaultRoot, 'samples-semicolon.csv')

  try {
    await initializeVault({ vaultRoot })
    await writeFile(
      csvPath,
      [
        'recorded_at;value;device;context',
        '2026-03-12T08:00:00Z;61;watch;resting',
        '2026-03-12T08:05:00Z;63;watch;walking',
        '',
      ].join('\n'),
      'utf8',
    )

    const imported = await runSliceCli<{
      transformId: string
      lookupIds: string[]
      manifestFile: string
      stream: string
    }>([
      'samples',
      'import-csv',
      csvPath,
      '--vault',
      vaultRoot,
      '--stream',
      'heart_rate',
      '--ts-column',
      'recorded_at',
      '--value-column',
      'value',
      '--unit',
      'bpm',
      '--delimiter',
      ';',
      '--metadata-columns',
      'device',
      '--metadata-columns',
      ' device ',
      '--metadata-columns',
      'context',
      '--metadata-columns',
      'device',
      '--source',
      'device',
    ])

    assert.equal(imported.ok, true)
    assert.equal(imported.meta?.command, 'samples import-csv')
    assert.equal(requireData(imported).stream, 'heart_rate')
    assert.match(requireData(imported).transformId, /^xfm_/u)
    assert.equal(requireData(imported).lookupIds.length, 2)
    await access(path.join(vaultRoot, requireData(imported).manifestFile))

    const csvMetadataColumns = await runSliceCli([
      'samples',
      'import-csv',
      csvPath,
      '--vault',
      vaultRoot,
      '--stream',
      'heart_rate',
      '--ts-column',
      'recorded_at',
      '--value-column',
      'value',
      '--unit',
      'bpm',
      '--delimiter',
      ';',
      '--metadata-columns',
      'device,context',
    ])
    assert.equal(csvMetadataColumns.ok, false)
    assert.match(
      csvMetadataColumns.error.message ?? '',
      /repeat the flag instead|comma-delimited values are not supported/iu,
    )

    const showResult = await runSliceCli<{
      entity: {
        id: string
        kind: string
      }
    }>([
      'samples',
      'show',
      requireData(imported).lookupIds[0] as string,
      '--vault',
      vaultRoot,
    ])
    assert.equal(showResult.ok, true)
    assert.equal(requireData(showResult).entity.id, requireData(imported).lookupIds[0])
    assert.equal(requireData(showResult).entity.kind, 'sample')

    const invalidSampleShow = await runSliceCli([
      'samples',
      'show',
      'evt_not_a_sample',
      '--vault',
      vaultRoot,
    ])
    assert.equal(invalidSampleShow.ok, false)

    const listResult = await runSliceCli<{
      count: number
      items: Array<{
        id: string
        quality: string | null
        stream: string | null
        data: Record<string, unknown>
      }>
    }>([
      'samples',
      'list',
      '--vault',
      vaultRoot,
      '--stream',
      'heart_rate',
      '--quality',
      'raw',
      '--from',
      '2026-03-12',
      '--to',
      '2026-03-12',
    ])
    assert.equal(listResult.ok, true)
    assert.equal(requireData(listResult).count, 2)
    assert.equal(requireData(listResult).items.length, 2)
    assert.deepEqual(
      requireData(listResult).items.map((item) => item.quality),
      ['raw', 'raw'],
    )
    assert.deepEqual(
      requireData(listResult).items.map((item) => item.stream),
      ['heart_rate', 'heart_rate'],
    )

    const batchShow = await runSliceCli<{
      batchId: string
      stream: string | null
      sampleIds: string[]
      importConfig: {
        metadataColumns?: string[]
      }
      manifest: {
        importId?: string
      }
    }>([
      'samples',
      'batch',
      'show',
      requireData(imported).transformId,
      '--vault',
      vaultRoot,
    ])
    assert.equal(batchShow.ok, true)
    assert.equal(requireData(batchShow).batchId, requireData(imported).transformId)
    assert.equal(requireData(batchShow).stream, 'heart_rate')
    assert.deepEqual(
      requireData(batchShow).sampleIds,
      requireData(imported).lookupIds,
    )
    assert.deepEqual(requireData(batchShow).importConfig.metadataColumns, ['device', 'context'])
    assert.equal(requireData(batchShow).manifest.importId, requireData(imported).transformId)

    const batchList = await runSliceCli<{
      items: Array<{
        batchId: string
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
    assert.equal(batchList.ok, true)
    assert.deepEqual(
      requireData(batchList).items.map((item) => item.batchId),
      [requireData(imported).transformId],
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('audit commands show, filter, and tail canonical audit records', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-audit-'))

  try {
    await initializeVault({ vaultRoot })
    await mkdir(path.join(vaultRoot, 'audit/2026'), { recursive: true })
    await writeFile(
      path.join(vaultRoot, 'audit/2026/2026-03.jsonl'),
      [
        JSON.stringify({
          schemaVersion: 'murph.audit.v1',
          id: 'aud_01JNW00000000000000000001',
          action: 'samples_import_csv',
          status: 'success',
          occurredAt: '2026-03-12T08:10:00Z',
          actor: 'cli',
          commandName: 'vault-cli samples import-csv',
          summary: 'Imported glucose samples.',
          changes: [],
        }),
        JSON.stringify({
          schemaVersion: 'murph.audit.v1',
          id: 'aud_01JNW00000000000000000002',
          action: 'show',
          status: 'failure',
          occurredAt: '2026-03-12T09:15:00Z',
          actor: 'query',
          commandName: 'vault-cli show',
          summary: 'Missing lookup id.',
          changes: [],
        }),
        JSON.stringify({
          schemaVersion: 'murph.audit.v1',
          id: 'aud_01JNW00000000000000000003',
          action: 'validate',
          status: 'success',
          occurredAt: '2026-03-12T10:45:00Z',
          actor: 'cli',
          commandName: 'vault-cli validate',
          summary: 'Validated vault.',
          changes: [],
        }),
      ].join('\n') + '\n',
      'utf8',
    )

    const showResult = await runSliceCli<{
      entity: {
        id: string
        kind: string
      }
    }>([
      'audit',
      'show',
      'aud_01JNW00000000000000000001',
      '--vault',
      vaultRoot,
    ])
    assert.equal(showResult.ok, true)
    assert.equal(requireData(showResult).entity.id, 'aud_01JNW00000000000000000001')
    assert.equal(requireData(showResult).entity.kind, 'audit')

    const listResult = await runSliceCli<{
      count: number
      items: Array<{
        id: string
        kind: string
        title: string | null
        occurredAt: string | null
        path: string | null
        action: string | null
        actor: string | null
        status: string | null
        commandName: string | null
        summary: string | null
        data: Record<string, unknown>
        links: Array<{ id: string }>
      }>
    }>([
      'audit',
      'list',
      '--vault',
      vaultRoot,
      '--action',
      'show',
      '--actor',
      'query',
      '--status',
      'failure',
      '--from',
      '2026-03-12',
      '--to',
      '2026-03-12',
    ])
    assert.equal(listResult.ok, true)
    assert.equal(requireData(listResult).count, 1)
    assert.deepEqual(
      requireData(listResult).items.map((item) => item.id),
      ['aud_01JNW00000000000000000002'],
    )
    assert.equal(requireData(listResult).items[0]?.kind, 'audit')
    assert.equal(requireData(listResult).items[0]?.title, 'Missing lookup id.')
    assert.equal(requireData(listResult).items[0]?.occurredAt, '2026-03-12T09:15:00Z')
    assert.equal(requireData(listResult).items[0]?.path, 'audit/2026/2026-03.jsonl')
    assert.equal(requireData(listResult).items[0]?.action, 'show')
    assert.equal(requireData(listResult).items[0]?.actor, 'query')
    assert.equal(requireData(listResult).items[0]?.status, 'failure')
    assert.equal(requireData(listResult).items[0]?.commandName, 'vault-cli show')
    assert.equal(requireData(listResult).items[0]?.summary, 'Missing lookup id.')
    assert.equal(requireData(listResult).items[0]?.data.summary, 'Missing lookup id.')
    assert.equal(requireData(listResult).items[0]?.links.length, 0)

    const ascendingListResult = await runSliceCli<{
      count: number
      filters: {
        sort: 'asc' | 'desc'
      }
      items: Array<{
        id: string
      }>
    }>([
      'audit',
      'list',
      '--vault',
      vaultRoot,
      '--from',
      '2026-03-12',
      '--to',
      '2026-03-12',
      '--sort',
      'asc',
      '--limit',
      '2',
    ])
    assert.equal(ascendingListResult.ok, true)
    assert.equal(requireData(ascendingListResult).filters.sort, 'asc')
    assert.deepEqual(
      requireData(ascendingListResult).items.map((item) => item.id),
      ['aud_01JNW00000000000000000001', 'aud_01JNW00000000000000000002'],
    )

    const descendingListResult = await runSliceCli<{
      count: number
      filters: {
        sort: 'asc' | 'desc'
        limit: number
      }
      items: Array<{
        id: string
      }>
    }>([
      'audit',
      'list',
      '--vault',
      vaultRoot,
      '--from',
      '2026-03-12',
      '--to',
      '2026-03-12',
      '--sort',
      'desc',
      '--limit',
      '2',
    ])
    assert.equal(descendingListResult.ok, true)
    assert.equal(requireData(descendingListResult).filters.sort, 'desc')
    assert.equal(requireData(descendingListResult).filters.limit, 2)
    assert.deepEqual(
      requireData(descendingListResult).items.map((item) => item.id),
      ['aud_01JNW00000000000000000003', 'aud_01JNW00000000000000000002'],
    )

    const tailResult = await runSliceCli<{
      count: number
      filters: {
        sort: 'asc' | 'desc'
        limit: number
      }
      items: Array<{
        id: string
      }>
    }>([
      'audit',
      'list',
      '--vault',
      vaultRoot,
      '--from',
      '2026-03-12',
      '--to',
      '2026-03-12',
      '--sort',
      'desc',
      '--limit',
      '2',
    ])
    assert.equal(tailResult.ok, true)
    assert.equal(tailResult.meta?.command, 'audit list')
    assert.equal(requireData(tailResult).count, 2)
    assert.equal(requireData(tailResult).filters.sort, 'desc')
    assert.equal(requireData(tailResult).filters.limit, 2)
    assert.deepEqual(
      requireData(tailResult).items.map((item) => item.id),
      requireData(descendingListResult).items.map((item) => item.id),
    )

    const invalidAuditShow = await runSliceCli([
      'audit',
      'show',
      'evt_not_an_audit',
      '--vault',
      vaultRoot,
    ])
    assert.equal(invalidAuditShow.ok, false)

    const auditFile = await readFile(path.join(vaultRoot, 'audit/2026/2026-03.jsonl'), 'utf8')
    assert.match(auditFile, /samples_import_csv/u)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('audit commands are reachable through the top-level CLI registration', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-audit-runtime-'))

  try {
    await initializeVault({ vaultRoot })
    await mkdir(path.join(vaultRoot, 'audit/2099'), { recursive: true })
    await writeFile(
      path.join(vaultRoot, 'audit/2099/2099-12.jsonl'),
      JSON.stringify({
        schemaVersion: 'murph.audit.v1',
        id: 'aud_01JNW00000000000000000010',
        action: 'validate',
        status: 'success',
        occurredAt: '2099-12-31T23:59:59Z',
        actor: 'cli',
        commandName: 'vault-cli validate',
        summary: 'Validated vault.',
        changes: [],
      }) + '\n',
      'utf8',
    )

    const tailResult = await runCli<{
      count: number
      items: Array<{
        id: string
      }>
    }>([
      'audit',
      'tail',
      '--vault',
      vaultRoot,
      '--limit',
      '1',
    ])

    assert.equal(tailResult.ok, true)
    assert.equal(tailResult.meta?.command, 'audit tail')
    assert.equal(requireData(tailResult).count, 1)
    assert.deepEqual(
      requireData(tailResult).items.map((item) => item.id),
      ['aud_01JNW00000000000000000010'],
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
