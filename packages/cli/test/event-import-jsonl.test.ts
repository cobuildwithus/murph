import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { importEventRecordsFromJsonl } from '@murphai/vault-usecases/records'
import { localParallelCliTest as test } from './local-parallel-test.js'
import { requireData, runCli } from './cli-test-helpers.js'

interface EventImportJsonlResult {
  applied: boolean
  receivedCount: number
  createdCount: number
  skippedExistingCount: number
  supersededCount: number
  eventShardPaths: string[]
  auditPath: string | null
}

function buildSleepSessionPayload(dayOfMonth: number) {
  const day = String(dayOfMonth).padStart(2, '0')
  return {
    kind: 'sleep_session',
    occurredAt: `2026-03-${day}T06:50:00.000Z`,
    source: 'device',
    title: `Sleep 2026-03-${day}`,
    startAt: `2026-03-${day}T00:10:00.000Z`,
    endAt: `2026-03-${day}T06:50:00.000Z`,
    durationMinutes: 400,
    externalRef: {
      system: 'whoop',
      resourceType: 'sleep',
      resourceId: `sleep-2026-03-${day}`,
    },
  }
}

function buildActivitySessionPayload() {
  return {
    kind: 'activity_session',
    occurredAt: '2026-03-13T17:00:00.000Z',
    source: 'import',
    title: 'Strength training',
    activityType: 'strength-training',
    externalRef: {
      system: 'example-workout-csv',
      resourceType: 'workout-session',
      resourceId: 'session-2026-03-13-1700',
    },
    workout: {
      exercises: [
        {
          name: 'Squat',
          order: 1,
          sets: [{ order: 1, reps: 5 }],
        },
      ],
    },
  }
}

function toJsonl(payloads: Array<Record<string, unknown>>): string {
  return `${payloads.map((payload) => JSON.stringify(payload)).join('\n')}\n`
}

test('event import-jsonl dry-runs, applies, and stays idempotent', async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'murph-cli-import-jsonl-'))
  const vaultRoot = path.join(workDir, 'vault')
  await runCli(['init', '--vault', vaultRoot])

  const inputPath = path.join(workDir, 'events.jsonl')
  await writeFile(
    inputPath,
    toJsonl([
      buildSleepSessionPayload(10),
      buildSleepSessionPayload(11),
      buildSleepSessionPayload(12),
    ]),
    'utf8',
  )

  const dryRun = await runCli<EventImportJsonlResult>(
    ['event', 'import-jsonl', '--input', `@${inputPath}`, '--vault', vaultRoot],
  )

  assert.equal(dryRun.ok, true)
  assert.equal(requireData(dryRun).applied, false)
  assert.equal(requireData(dryRun).receivedCount, 3)
  assert.equal(requireData(dryRun).createdCount, 3)
  assert.equal(requireData(dryRun).auditPath, null)

  const listAfterDryRun = await runCli<{ count: number }>(
    ['event', 'list', '--kind', 'sleep_session', '--vault', vaultRoot],
  )
  assert.equal(requireData(listAfterDryRun).count, 0)

  const apply = await runCli<EventImportJsonlResult>(
    ['event', 'import-jsonl', '--input', `@${inputPath}`, '--apply', '--vault', vaultRoot],
  )

  assert.equal(apply.ok, true)
  assert.equal(requireData(apply).applied, true)
  assert.equal(requireData(apply).createdCount, 3)
  assert.equal(requireData(apply).skippedExistingCount, 0)
  assert.notEqual(requireData(apply).auditPath, null)

  const listAfterApply = await runCli<{ count: number }>(
    ['event', 'list', '--kind', 'sleep_session', '--vault', vaultRoot],
  )
  assert.equal(requireData(listAfterApply).count, 3)

  const rerun = await runCli<EventImportJsonlResult>(
    ['event', 'import-jsonl', '--input', `@${inputPath}`, '--apply', '--vault', vaultRoot],
  )

  assert.equal(rerun.ok, true)
  assert.equal(requireData(rerun).applied, false)
  assert.equal(requireData(rerun).createdCount, 0)
  assert.equal(requireData(rerun).skippedExistingCount, 3)

  const listAfterRerun = await runCli<{ count: number }>(
    ['event', 'list', '--kind', 'sleep_session', '--vault', vaultRoot],
  )
  assert.equal(requireData(listAfterRerun).count, 3)
})

test('event import-jsonl accepts stdin and rejects invalid lines atomically', async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'murph-cli-import-jsonl-stdin-'))
  const vaultRoot = path.join(workDir, 'vault')
  await runCli(['init', '--vault', vaultRoot])

  const stdinImport = await runCli<EventImportJsonlResult>(
    ['event', 'import-jsonl', '--input', '-', '--apply', '--vault', vaultRoot],
    { stdin: toJsonl([buildSleepSessionPayload(10)]) },
  )

  assert.equal(stdinImport.ok, true)
  assert.equal(requireData(stdinImport).createdCount, 1)

  const { title: _title, ...missingTitle } = buildSleepSessionPayload(11)
  const invalidImport = await runCli<EventImportJsonlResult>(
    ['event', 'import-jsonl', '--input', '-', '--apply', '--vault', vaultRoot],
    { stdin: toJsonl([buildSleepSessionPayload(12), missingTitle]) },
  )

  assert.equal(invalidImport.ok, false)
  if (invalidImport.ok) {
    throw new Error('expected the invalid batch to fail')
  }
  assert.equal(invalidImport.error.code, 'contract_invalid')

  const listAfterInvalid = await runCli<{ count: number }>(
    ['event', 'list', '--kind', 'sleep_session', '--vault', vaultRoot],
  )
  assert.equal(requireData(listAfterInvalid).count, 1)

  const unparsableImport = await runCli<EventImportJsonlResult>(
    ['event', 'import-jsonl', '--input', '-', '--apply', '--vault', vaultRoot],
    { stdin: '{"kind": "sleep_session"\nnot json\n' },
  )

  assert.equal(unparsableImport.ok, false)
  if (unparsableImport.ok) {
    throw new Error('expected the unparsable batch to fail')
  }
  assert.equal(unparsableImport.error.code, 'invalid_payload')
})

test('event import-jsonl requires activity-session duration before writing', async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'murph-cli-import-jsonl-workout-'))
  const vaultRoot = path.join(workDir, 'vault')
  await runCli(['init', '--vault', vaultRoot])

  const invalidImport = await runCli<EventImportJsonlResult>(
    ['event', 'import-jsonl', '--input', '-', '--apply', '--vault', vaultRoot],
    { stdin: toJsonl([buildActivitySessionPayload()]) },
  )

  assert.equal(invalidImport.ok, false)
  if (invalidImport.ok) {
    throw new Error('expected durationless activity session to fail')
  }
  assert.equal(invalidImport.error.code, 'contract_invalid')

  const listAfterInvalid = await runCli<{ count: number }>(
    ['event', 'list', '--kind', 'activity_session', '--vault', vaultRoot],
  )
  assert.equal(requireData(listAfterInvalid).count, 0)

  const validImport = await runCli<EventImportJsonlResult>(
    ['event', 'import-jsonl', '--input', '-', '--apply', '--vault', vaultRoot],
    {
      stdin: toJsonl([
        { ...buildActivitySessionPayload(), durationMinutes: 45 },
      ]),
    },
  )
  assert.equal(validImport.ok, true)
  assert.equal(requireData(validImport).createdCount, 1)

  const retry = await runCli<EventImportJsonlResult>(
    ['event', 'import-jsonl', '--input', '-', '--apply', '--vault', vaultRoot],
    {
      stdin: toJsonl([
        { ...buildActivitySessionPayload(), durationMinutes: 45 },
      ]),
    },
  )
  assert.equal(retry.ok, true)
  assert.equal(requireData(retry).applied, false)
  assert.equal(requireData(retry).skippedExistingCount, 1)

  const listAfterRetry = await runCli<{ count: number }>(
    ['event', 'list', '--kind', 'activity_session', '--vault', vaultRoot],
  )
  assert.equal(requireData(listAfterRetry).count, 1)

  const changedImport = await runCli<EventImportJsonlResult>(
    [
      'event',
      'import-jsonl',
      '--input',
      '-',
      '--conflict-policy',
      'reject',
      '--apply',
      '--vault',
      vaultRoot,
    ],
    {
      stdin: toJsonl([{
        ...buildActivitySessionPayload(),
        durationMinutes: 60,
      }]),
    },
  )
  assert.equal(changedImport.ok, false)
  if (changedImport.ok) {
    throw new Error('expected changed externalRef content to be rejected')
  }
  assert.equal(changedImport.error.code, 'conflict')

  const listAfterConflict = await runCli<{ count: number }>(
    ['event', 'list', '--kind', 'activity_session', '--vault', vaultRoot],
  )
  assert.equal(requireData(listAfterConflict).count, 1)
})

// The CLI error envelope only carries code/message, so per-line failure
// details are proven at the usecase boundary the command delegates to.
test('import-jsonl usecase maps failures to JSONL line numbers and rejects empty input', async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'murph-cli-import-jsonl-lines-'))
  const vaultRoot = path.join(workDir, 'vault')
  await runCli(['init', '--vault', vaultRoot])

  const emptyPath = path.join(workDir, 'empty.jsonl')
  await writeFile(emptyPath, '\n   \n', 'utf8')

  await assert.rejects(
    importEventRecordsFromJsonl({ vault: vaultRoot, inputFile: `@${emptyPath}` }),
    (error: unknown) => {
      assert.equal(error instanceof VaultCliError, true)
      const cliError = error as VaultCliError
      assert.equal(cliError.code, 'invalid_payload')
      assert.match(cliError.message, /no event payloads/u)
      return true
    },
  )

  // Line 1 valid, line 2 blank, line 3 invalid: the failing payload has
  // batch index 1 but must be reported as JSONL line 3.
  const { title: _title, ...missingTitle } = buildSleepSessionPayload(11)
  const contractInvalidPath = path.join(workDir, 'contract-invalid.jsonl')
  await writeFile(
    contractInvalidPath,
    `${JSON.stringify(buildSleepSessionPayload(10))}\n\n${JSON.stringify(missingTitle)}\n`,
    'utf8',
  )

  await assert.rejects(
    importEventRecordsFromJsonl({
      vault: vaultRoot,
      inputFile: `@${contractInvalidPath}`,
      apply: true,
    }),
    (error: unknown) => {
      assert.equal(error instanceof VaultCliError, true)
      const cliError = error as VaultCliError
      assert.equal(cliError.code, 'contract_invalid')
      const failures = cliError.context?.failures as Array<{ line: number, message: string }>
      assert.equal(failures.length, 1)
      assert.equal(failures[0]!.line, 3)
      assert.match(failures[0]!.message, /title/iu)
      return true
    },
  )

  const parseInvalidPath = path.join(workDir, 'parse-invalid.jsonl')
  await writeFile(
    parseInvalidPath,
    `${JSON.stringify(buildSleepSessionPayload(10))}\n\nnot json\n`,
    'utf8',
  )

  await assert.rejects(
    importEventRecordsFromJsonl({ vault: vaultRoot, inputFile: `@${parseInvalidPath}` }),
    (error: unknown) => {
      assert.equal(error instanceof VaultCliError, true)
      const cliError = error as VaultCliError
      assert.equal(cliError.code, 'invalid_payload')
      const failures = cliError.context?.failures as Array<{ line: number, message: string }>
      assert.equal(failures.length, 1)
      assert.equal(failures[0]!.line, 3)
      return true
    },
  )
})
