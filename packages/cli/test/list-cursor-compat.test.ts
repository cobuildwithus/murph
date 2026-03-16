import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { test } from 'vitest'
import { ensureCliRuntimeArtifacts, repoRoot } from './cli-test-helpers.js'

const execFileAsync = promisify(execFile)
const sourceBinPath = path.join(repoRoot, 'packages/cli/src/bin.ts')

interface CliSuccessEnvelope<TData = Record<string, unknown>> {
  ok: true
  data: TData
  meta: {
    command: string
    duration: string
  }
}

type CliEnvelope<TData = Record<string, unknown>> =
  | CliSuccessEnvelope<TData>
  | {
      ok: false
      error: {
        code?: string
        message?: string
      }
      meta: {
        command: string
        duration: string
      }
    }

async function runSourceCli<TData = Record<string, unknown>>(
  args: string[],
): Promise<CliEnvelope<TData>> {
  await ensureCliRuntimeArtifacts()

  try {
    const { stdout } = await execFileAsync(
      'pnpm',
      ['exec', 'tsx', sourceBinPath, ...withMachineOutput(args)],
      { cwd: repoRoot },
    )

    return JSON.parse(stdout) as CliEnvelope<TData>
  } catch (error) {
    const envelope = parseCliEnvelopeFromError<TData>(error)
    if (envelope !== null) {
      return envelope
    }

    throw error
  }
}

async function runRawSourceCli(args: string[]): Promise<string> {
  await ensureCliRuntimeArtifacts()

  try {
    const { stdout } = await execFileAsync(
      'pnpm',
      ['exec', 'tsx', sourceBinPath, ...args],
      { cwd: repoRoot },
    )

    return stdout.trim()
  } catch (error) {
    const output = outputFromError(error)
    if (output !== null) {
      return output
    }

    throw error
  }
}

function parseCliEnvelopeFromError<TData>(
  error: unknown,
): CliEnvelope<TData> | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const maybeOutput = error as {
    stdout?: Buffer | string
    stderr?: Buffer | string
  }

  return (
    parseEnvelopeText<TData>(decodeCommandOutput(maybeOutput.stdout)) ??
    parseEnvelopeText<TData>(decodeCommandOutput(maybeOutput.stderr))
  )
}

function parseEnvelopeText<TData>(output: string | null): CliEnvelope<TData> | null {
  if (output === null) {
    return null
  }

  try {
    return JSON.parse(output) as CliEnvelope<TData>
  } catch {
    const jsonStart = output.indexOf('{')
    const jsonEnd = output.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
      return null
    }

    try {
      return JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as CliEnvelope<TData>
    } catch {
      return null
    }
  }
}

function outputFromError(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const maybeOutput = error as {
    stdout?: Buffer | string
    stderr?: Buffer | string
  }

  return decodeCommandOutput(maybeOutput.stdout) ?? decodeCommandOutput(maybeOutput.stderr)
}

function decodeCommandOutput(output: Buffer | string | undefined): string | null {
  if (typeof output === 'string') {
    return output.trim().length > 0 ? output : null
  }

  if (Buffer.isBuffer(output)) {
    const text = output.toString('utf8').trim()
    return text.length > 0 ? text : null
  }

  return null
}

function requireData<TData>(result: CliEnvelope<TData>): TData {
  if (!result.ok) {
    throw new Error(
      `CLI result failed: ${result.error.message ?? result.error.code ?? 'unknown error'}`,
    )
  }

  return result.data
}

function withMachineOutput(args: string[]): string[] {
  const nextArgs = [...args]

  if (!nextArgs.includes('--verbose')) {
    nextArgs.push('--verbose')
  }

  if (!nextArgs.includes('--json') && !nextArgs.includes('--format')) {
    nextArgs.push('--format', 'json')
  }

  return nextArgs
}

test('list help and schemas no longer expose cursor pagination options', async () => {
  const help = await runRawSourceCli(['goal', 'list', '--help'])
  const profileHelp = await runRawSourceCli(['profile', 'list', '--help'])
  const historyHelp = await runRawSourceCli(['history', 'list', '--help'])
  const readSchema = JSON.parse(
    await runRawSourceCli(['list', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
    }
  }
  const intakeSchema = JSON.parse(
    await runRawSourceCli(['intake', 'list', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
    }
  }

  assert.doesNotMatch(help, /--cursor/u)
  assert.doesNotMatch(help, /next-page token/u)
  assert.match(profileHelp, /--from/u)
  assert.match(profileHelp, /--to/u)
  assert.match(historyHelp, /--kind/u)
  assert.match(historyHelp, /--from/u)
  assert.match(historyHelp, /--to/u)
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
})

test.sequential('list commands still run after cursor removal', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-list-'))

  try {
    const initResult = await runSourceCli<{ created: boolean }>(['init', '--vault', vaultRoot])
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
    ])
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
    ])
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
    ])
    assert.equal(goalList.ok, true)
    assert.equal(goalList.meta?.command, 'goal list')
    assert.equal(requireData(goalList).count, 0)
    assert.deepEqual(requireData(goalList).items, [])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential('generic list applies date bounds and echoes renamed filter keys', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-list-'))

  try {
    const initResult = await runSourceCli<{ created: boolean }>(['init', '--vault', vaultRoot])
    assert.equal(initResult.ok, true)
    assert.equal(requireData(initResult).created, true)

    await mkdir(path.join(vaultRoot, 'ledger/events/2026'), {
      recursive: true,
    })
    await writeFile(
      path.join(vaultRoot, 'ledger/events/2026/2026-03.jsonl'),
      [
        JSON.stringify({
          schemaVersion: 'hb.event.v1',
          id: 'evt_range_out',
          kind: 'note',
          occurredAt: '2026-03-10T08:00:00Z',
          recordedAt: '2026-03-10T08:05:00Z',
          source: 'manual',
          title: 'Outside the requested range',
        }),
        JSON.stringify({
          schemaVersion: 'hb.event.v1',
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
    ])

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
})

test.sequential('goal list keeps status-only filters canonical', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-list-'))
  const activeGoalPath = path.join(vaultRoot, 'goal-active.json')
  const pausedGoalPath = path.join(vaultRoot, 'goal-paused.json')

  try {
    const initResult = await runSourceCli<{ created: boolean }>(['init', '--vault', vaultRoot])
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
    ])
    const pausedUpsert = await runSourceCli<{ goalId: string }>([
      'goal',
      'upsert',
      '--input',
      `@${pausedGoalPath}`,
      '--vault',
      vaultRoot,
    ])
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
    ])

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
})

test.sequential('generic list exposes record-type, status, stream, and tag filter parity', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-list-'))
  const csvPath = path.join(vaultRoot, 'samples.csv')
  const experimentPath = path.join(
    vaultRoot,
    'bank/experiments/sleep-window.md',
  )
  const experimentId = 'exp_01JNY0B2W4VG5C2A0G9S8M7R6Q'

  try {
    const initResult = await runSourceCli<{ created: boolean }>(['init', '--vault', vaultRoot])
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
    ])
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
    ])
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
    ])
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
})

test.sequential('generic list rejects comma-delimited repeatable filter tokens', async () => {
  const result = await runSourceCli([
    'list',
    '--record-type',
    'sample,event',
    '--vault',
    path.join(repoRoot, 'fixtures/minimal-vault'),
  ])

  assert.equal(result.ok, false)
  assert.match(
    result.error.message ?? '',
    /comma-delimited values are not supported.*repeat the flag instead/ui,
  )
})
