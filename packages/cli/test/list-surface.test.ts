import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { localParallelCliTest as test } from './local-parallel-test.js'
import {
  repoRoot,
  requireData,
  runCli,
  runRawCli,
} from './cli-test-helpers.js'
const runSourceCli = runCli
const runRawSourceCli = runRawCli
const CLI_LIST_TIMEOUT_MS = 30_000

function listCliOptions() {
  const env = { ...process.env }
  delete env.VAULT
  return { env }
}

test('list help and schemas no longer expose cursor pagination options', async () => {
  const help = await runRawSourceCli(['goal', 'list', '--help'], listCliOptions())
  const bloodTestHelp = await runRawSourceCli(['blood-test', 'list', '--help'], listCliOptions())
  const readSchema = JSON.parse(
    await runRawSourceCli(['list', '--schema', '--format', 'json'], listCliOptions()),
  ) as {
    options: {
      properties: Record<string, unknown>
    }
  }
  const intakeSchema = JSON.parse(
    await runRawSourceCli(
      ['intake', 'list', '--schema', '--format', 'json'],
      listCliOptions(),
    ),
  ) as {
    options: {
      properties: Record<string, unknown>
    }
  }

  assert.doesNotMatch(help, /--cursor/u)
  assert.doesNotMatch(help, /next-page token/u)
  assert.doesNotMatch(bloodTestHelp, /--kind/u)
  assert.match(bloodTestHelp, /--from/u)
  assert.match(bloodTestHelp, /--to/u)
  assert.equal('cursor' in readSchema.options.properties, false)
  assert.equal('recordType' in readSchema.options.properties, true)
  assert.equal('status' in readSchema.options.properties, true)
  assert.equal('stream' in readSchema.options.properties, true)
  assert.equal('tag' in readSchema.options.properties, true)
  assert.equal('from' in readSchema.options.properties, true)
  assert.equal('to' in readSchema.options.properties, true)
  assert.equal('dateFrom' in readSchema.options.properties, false)
  assert.equal('dateTo' in readSchema.options.properties, false)
  assert.equal('cursor' in intakeSchema.options.properties, false)
  assert.equal('from' in intakeSchema.options.properties, true)
  assert.equal('to' in intakeSchema.options.properties, true)
  assert.equal('dateFrom' in intakeSchema.options.properties, false)
  assert.equal('dateTo' in intakeSchema.options.properties, false)
}, CLI_LIST_TIMEOUT_MS)

test('list commands still run after cursor removal', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-list-'))
  const options = listCliOptions()

  try {
    const initResult = await runSourceCli<{ created: boolean }>(
      ['init', '--vault', vaultRoot],
      options,
    )
    assert.equal(initResult.ok, true)
    assert.equal(requireData(initResult).created, true)

    const readList = await runSourceCli<{
      count: number
      filters: Record<string, unknown>
      nextCursor: string | null
    }>([
      'list',
      '--limit',
      '5',
      '--vault',
      vaultRoot,
    ], options)
    assert.equal(readList.ok, true)
    assert.equal(readList.meta?.command, 'list')
    assert.equal(requireData(readList).count, 0)
    assert.equal('cursor' in requireData(readList).filters, false)
    assert.equal(requireData(readList).nextCursor, null)

    const intakeList = await runSourceCli<{
      count: number
      filters: Record<string, unknown>
      nextCursor: string | null
    }>([
      'intake',
      'list',
      '--limit',
      '5',
      '--vault',
      vaultRoot,
    ], options)
    assert.equal(intakeList.ok, true)
    assert.equal(intakeList.meta?.command, 'intake list')
    assert.equal(requireData(intakeList).count, 0)
    assert.equal('cursor' in requireData(intakeList).filters, false)
    assert.equal(requireData(intakeList).nextCursor, null)

    const goalList = await runSourceCli<{
      count: number
      items: unknown[]
    }>([
      'goal',
      'list',
      '--limit',
      '5',
      '--vault',
      vaultRoot,
    ], options)
    assert.equal(goalList.ok, true)
    assert.equal(goalList.meta?.command, 'goal list')
    assert.equal(requireData(goalList).count, 0)
    assert.deepEqual(requireData(goalList).items, [])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
}, CLI_LIST_TIMEOUT_MS)

test('generic list applies date bounds and echoes renamed filter keys', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-list-'))
  const options = listCliOptions()

  try {
    const initResult = await runSourceCli<{ created: boolean }>(
      ['init', '--vault', vaultRoot],
      options,
    )
    assert.equal(initResult.ok, true)
    assert.equal(requireData(initResult).created, true)

    await mkdir(path.join(vaultRoot, 'ledger/events/2026'), {
      recursive: true,
    })
    await writeFile(
      path.join(vaultRoot, 'ledger/events/2026/2026-03.jsonl'),
      [
        JSON.stringify({
          schemaVersion: 'murph.event.v1',
          id: 'evt_range_out',
          kind: 'note',
          occurredAt: '2026-03-10T08:00:00Z',
          recordedAt: '2026-03-10T08:05:00Z',
          source: 'manual',
          title: 'Outside the requested range',
        }),
        JSON.stringify({
          schemaVersion: 'murph.event.v1',
          id: 'evt_range_in',
          kind: 'note',
          occurredAt: '2026-03-12T09:00:00Z',
          recordedAt: '2026-03-12T09:05:00Z',
          source: 'manual',
          title: 'Inside the requested range',
        }),
        '',
      ].join('\n'),
      'utf8',
    )

    const result = await runSourceCli<{
      count: number
      filters: Record<string, unknown>
      items: Array<{
        id: string
      }>
    }>([
      'list',
      '--record-type',
      'event',
      '--from',
      '2026-03-12',
      '--to',
      '2026-03-12',
      '--vault',
      vaultRoot,
    ], options)

    assert.equal(result.ok, true)
    assert.equal(requireData(result).filters.from, '2026-03-12')
    assert.equal(requireData(result).filters.to, '2026-03-12')
    assert.equal('dateFrom' in requireData(result).filters, false)
    assert.equal('dateTo' in requireData(result).filters, false)
    assert.equal(requireData(result).count, 1)
    assert.deepEqual(
      requireData(result).items.map((item) => item.id),
      ['evt_range_in'],
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
}, CLI_LIST_TIMEOUT_MS)

test('goal list keeps status-only filters canonical', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-list-'))
  const activeGoalPath = path.join(vaultRoot, 'goal-active.json')
  const pausedGoalPath = path.join(vaultRoot, 'goal-paused.json')
  const options = listCliOptions()

  try {
    const initResult = await runSourceCli<{ created: boolean }>(
      ['init', '--vault', vaultRoot],
      options,
    )
    assert.equal(initResult.ok, true)
    assert.equal(requireData(initResult).created, true)

    await writeFile(
      activeGoalPath,
      JSON.stringify({
        title: 'Improve sleep consistency',
        status: 'active',
        horizon: 'long_term',
        domains: ['sleep'],
      }),
      'utf8',
    )
    await writeFile(
      pausedGoalPath,
      JSON.stringify({
        title: 'Reduce afternoon caffeine',
        status: 'paused',
        horizon: 'short_term',
        domains: ['energy'],
      }),
      'utf8',
    )

    const activeUpsert = await runSourceCli<{ goalId: string }>([
      'goal',
      'upsert',
      '--input',
      `@${activeGoalPath}`,
      '--vault',
      vaultRoot,
    ], options)
    const pausedUpsert = await runSourceCli<{ goalId: string }>([
      'goal',
      'upsert',
      '--input',
      `@${pausedGoalPath}`,
      '--vault',
      vaultRoot,
    ], options)
    const activeGoalId = requireData(activeUpsert).goalId
    const pausedGoalId = requireData(pausedUpsert).goalId

    const result = await runSourceCli<{
      count: number
      filters: Record<string, unknown>
      nextCursor: string | null
      items: Array<{
        id: string
        kind: string
        data: Record<string, unknown>
        links: Array<{ id: string }>
      }>
    }>([
      'goal',
      'list',
      '--status',
      'active',
      '--limit',
      '5',
      '--vault',
      vaultRoot,
    ], options)

    assert.equal(result.ok, true)
    assert.equal(requireData(result).filters.status, 'active')
    assert.equal(requireData(result).filters.limit, 5)
    assert.equal('from' in requireData(result).filters, false)
    assert.equal('to' in requireData(result).filters, false)
    assert.equal('kind' in requireData(result).filters, false)
    assert.equal(requireData(result).count, requireData(result).items.length)
    assert.equal(requireData(result).nextCursor, null)
    assert.deepEqual(
      requireData(result).items.map((item) => item.id),
      [activeGoalId],
    )
    assert.equal(
      requireData(result).items.some((item) => item.id === pausedGoalId),
      false,
    )
    assert.equal(requireData(result).items[0]?.kind, 'goal')
    assert.equal(requireData(result).items[0]?.data.status, 'active')
    assert.deepEqual(requireData(result).items[0]?.links, [])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
}, CLI_LIST_TIMEOUT_MS)

test('generic list exposes record-type, status, stream, and tag filter parity', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-list-'))
  const csvPath = path.join(vaultRoot, 'samples.csv')
  const experimentPath = path.join(
    vaultRoot,
    'bank/experiments/sleep-window.md',
  )
  const experimentId = 'exp_01JNY0B2W4VG5C2A0G9S8M7R6Q'
  const options = listCliOptions()

  try {
    const initResult = await runSourceCli<{ created: boolean }>(
      ['init', '--vault', vaultRoot],
      options,
    )
    assert.equal(initResult.ok, true)
    assert.equal(requireData(initResult).created, true)

    await writeFile(
      experimentPath,
      [
        '---',
        'schemaVersion: "1.0"',
        'docType: experiment',
        `experimentId: ${experimentId}`,
        'slug: sleep-window',
        'status: paused',
        'title: Sleep Window',
        'startedOn: 2026-03-12',
        'tags:',
        '  - energy',
        '  - sleep',
        '---',
        '',
        '# Sleep Window',
        '',
        'Notes.',
        '',
      ].join('\n'),
      'utf8',
    )

    await writeFile(
      csvPath,
      [
        'timestamp,bpm',
        '2026-03-12T08:00:00Z,61',
        '2026-03-12T08:01:00Z,63',
        '',
      ].join('\n'),
      'utf8',
    )

    const importResult = await runSourceCli<{ importedCount: number }>([
      'samples',
      'import-csv',
      csvPath,
      '--stream',
      'heart_rate',
      '--ts-column',
      'timestamp',
      '--value-column',
      'bpm',
      '--unit',
      'bpm',
      '--vault',
      vaultRoot,
    ], options)
    assert.equal(importResult.ok, true)
    assert.equal(requireData(importResult).importedCount, 2)

    const experimentList = await runSourceCli<{
      filters: {
        recordType?: string[]
        status?: string
        tag?: string[]
      }
      items: Array<{
        id: string
        kind: string
        excerpt?: string | null
        markdown?: string | null
      }>
    }>([
      'list',
      '--record-type',
      'experiment',
      '--record-type',
      'goal',
      '--status',
      'paused',
      '--tag',
      'energy',
      '--tag',
      'sleep',
      '--vault',
      vaultRoot,
    ], options)
    assert.equal(experimentList.ok, true)
    assert.deepEqual(requireData(experimentList).filters.recordType, [
      'experiment',
      'goal',
    ])
    assert.equal(requireData(experimentList).filters.status, 'paused')
    assert.deepEqual(requireData(experimentList).filters.tag, [
      'energy',
      'sleep',
    ])
    assert.equal(requireData(experimentList).items.length, 1)
    assert.equal(requireData(experimentList).items[0]?.id, experimentId)
    assert.equal(requireData(experimentList).items[0]?.kind, 'experiment')
    assert.match(requireData(experimentList).items[0]?.excerpt ?? '', /Sleep Window Notes\./u)
    assert.equal('markdown' in (requireData(experimentList).items[0] ?? {}), false)

    const sampleList = await runSourceCli<{
      filters: {
        recordType?: string[]
        stream?: string[]
      }
      items: Array<{
        id: string
        kind: string
      }>
    }>([
      'list',
      '--record-type',
      'sample',
      '--record-type',
      'event',
      '--stream',
      'heart_rate',
      '--stream',
      'glucose',
      '--vault',
      vaultRoot,
    ], options)
    assert.equal(sampleList.ok, true)
    assert.deepEqual(requireData(sampleList).filters.recordType, [
      'sample',
      'event',
    ])
    assert.deepEqual(requireData(sampleList).filters.stream, [
      'heart_rate',
      'glucose',
    ])
    assert.equal(requireData(sampleList).items.length, 2)
    assert.equal(
      requireData(sampleList).items.every((item) => item.kind === 'sample'),
      true,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
}, CLI_LIST_TIMEOUT_MS)

test('generic list rejects comma-delimited repeatable filter tokens', async () => {
  const result = await runSourceCli([
    'list',
    '--record-type',
    'sample,event',
    '--vault',
    path.join(repoRoot, 'fixtures/minimal-vault'),
  ], listCliOptions())

  assert.equal(result.ok, false)
  assert.match(
    result.error.message ?? '',
    /comma-delimited values are not supported.*repeat the flag instead/ui,
  )
}, CLI_LIST_TIMEOUT_MS)

test('generic list rejects unsupported record-type values', async () => {
  const result = await runSourceCli([
    'list',
    '--record-type',
    'not_a_real_record_type',
    '--vault',
    path.join(repoRoot, 'fixtures/minimal-vault'),
  ], listCliOptions())

  assert.equal(result.ok, false)
  assert.match(
    result.error.message ?? '',
    /unsupported value(?:s)? for --record-type/ui,
  )
}, CLI_LIST_TIMEOUT_MS)
