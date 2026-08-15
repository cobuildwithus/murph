import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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

interface EventListResult {
  items: Array<{ id: string }>
  count: number
}

interface DocumentImportResult {
  created: boolean
  documentId: string
  eventId: string
  rawFile: string
  manifestFile: string
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

function withRawRef(rawFile: string, durationMinutes = 45) {
  const { externalRef: _externalRef, ...payload } = buildActivitySessionPayload()
  return { ...payload, durationMinutes, rawRefs: [rawFile] }
}

test('independent exact-source attempts stop from durable workout-source history', async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'murph-cli-import-jsonl-document-replay-'))
  const vaultRoot = path.join(workDir, 'vault')
  const sourcePath = path.join(workDir, 'workout-history.csv')
  await writeFile(sourcePath, 'session,exercise,reps\nsession-a,Squat,5\n', 'utf8')
  await runCli(['init', '--vault', vaultRoot])

  const firstDocument = await runCli<DocumentImportResult>([
    'document',
    'import',
    sourcePath,
    '--reuse-exact',
    '--vault',
    vaultRoot,
  ])
  assert.equal(firstDocument.ok, true, firstDocument.ok ? undefined : JSON.stringify(firstDocument.error))
  assert.equal(requireData(firstDocument).created, true)
  const first = requireData(firstDocument)
  const initialStatus = await runCli<{ status: string }>([
    'document',
    'workout-import-status',
    first.rawFile,
    '--vault',
    vaultRoot,
  ])
  assert.equal(initialStatus.ok, true, initialStatus.ok ? undefined : JSON.stringify(initialStatus.error))
  assert.equal(requireData(initialStatus).status, 'not_imported')

  const firstJsonl = path.join(workDir, 'first.jsonl')
  await writeFile(firstJsonl, toJsonl([withRawRef(first.rawFile)]), 'utf8')
  const firstApply = await runCli<EventImportJsonlResult>([
    'event',
    'import-jsonl',
    '--input',
    `@${firstJsonl}`,
    '--source-raw-ref-once',
    first.rawFile,
    '--apply',
    '--vault',
    vaultRoot,
  ])
  assert.equal(firstApply.ok, true)
  assert.equal(requireData(firstApply).createdCount, 1)

  const secondDocument = await runCli<DocumentImportResult>([
    'document',
    'import',
    sourcePath,
    '--reuse-exact',
    '--vault',
    vaultRoot,
  ])
  assert.equal(secondDocument.ok, true)
  const second = requireData(secondDocument)
  assert.equal(second.created, false)
  assert.equal(second.documentId, first.documentId)
  assert.equal(second.eventId, first.eventId)
  assert.equal(second.rawFile, first.rawFile)
  assert.equal(second.manifestFile, first.manifestFile)

  const importedStatus = await runCli<{ status: string }>([
    'document',
    'workout-import-status',
    second.rawFile,
    '--vault',
    vaultRoot,
  ])
  assert.equal(importedStatus.ok, true)
  assert.equal(requireData(importedStatus).status, 'completed')

  const listed = await runCli<EventListResult>([
    'event',
    'list',
    '--kind',
    'activity_session',
    '--vault',
    vaultRoot,
  ])
  assert.equal(listed.ok, true)
  assert.equal(requireData(listed).count, 1)
  const importedEventId = requireData(listed).items[0]?.id
  assert.ok(importedEventId)

  const memberEdit = await runCli([
    'event',
    'edit',
    importedEventId,
    '--note',
    'Member correction',
    '--vault',
    vaultRoot,
  ])
  assert.equal(memberEdit.ok, true)

  const statusAfterEdit = await runCli<{ status: string }>([
    'document',
    'workout-import-status',
    second.rawFile,
    '--vault',
    vaultRoot,
  ])
  assert.equal(statusAfterEdit.ok, true)
  assert.equal(requireData(statusAfterEdit).status, 'completed')

  const memberDelete = await runCli([
    'event',
    'delete',
    importedEventId,
    '--vault',
    vaultRoot,
  ])
  assert.equal(memberDelete.ok, true)

  const statusAfterDelete = await runCli<{ status: string }>([
    'document',
    'workout-import-status',
    second.rawFile,
    '--vault',
    vaultRoot,
  ])
  assert.equal(statusAfterDelete.ok, true)
  assert.equal(requireData(statusAfterDelete).status, 'completed')

  const retryJsonl = path.join(workDir, 'retry.jsonl')
  await writeFile(retryJsonl, toJsonl([withRawRef(second.rawFile, 60)]), 'utf8')
  const rejectedRetry = await runCli<EventImportJsonlResult>([
    'event',
    'import-jsonl',
    '--input',
    `@${retryJsonl}`,
    '--source-raw-ref-once',
    second.rawFile,
    '--apply',
    '--vault',
    vaultRoot,
  ])
  assert.equal(rejectedRetry.ok, false)
  if (rejectedRetry.ok) throw new Error('expected exact-source retry to be rejected')
  assert.equal(rejectedRetry.error.code, 'conflict')

  const documentDirectories = await readdir(path.join(vaultRoot, 'raw', 'documents'))
  const manifestFiles = await readdir(path.dirname(path.join(vaultRoot, first.manifestFile)))
  assert.equal(documentDirectories.length, 1)
  assert.equal(manifestFiles.filter((name) => name.startsWith('manifest.')).length, 1)
}, 180_000)

test('damaged exact-source evidence stops before replacement identity or workout replay', async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'murph-cli-import-jsonl-damaged-source-'))
  const vaultRoot = path.join(workDir, 'vault')
  const sourcePath = path.join(workDir, 'workout-history.csv')
  await writeFile(sourcePath, 'session,exercise,reps\nsession-a,Squat,5\n', 'utf8')
  await runCli(['init', '--vault', vaultRoot])

  const sourceImport = await runCli<DocumentImportResult>([
    'document', 'import', sourcePath, '--reuse-exact', '--vault', vaultRoot,
  ])
  assert.equal(sourceImport.ok, true)
  const source = requireData(sourceImport)
  const inputPath = path.join(workDir, 'events.jsonl')
  await writeFile(inputPath, toJsonl([withRawRef(source.rawFile)]), 'utf8')
  const applied = await runCli<EventImportJsonlResult>([
    'event', 'import-jsonl',
    '--input', `@${inputPath}`,
    '--source-raw-ref-once', source.rawFile,
    '--apply',
    '--vault', vaultRoot,
  ])
  assert.equal(applied.ok, true)
  assert.equal(requireData(applied).createdCount, 1)

  await rm(path.join(vaultRoot, source.manifestFile))
  const pathsBeforeReplay = (await readdir(vaultRoot, { recursive: true })).sort()
  const rejectedReplay = await runCli<DocumentImportResult>([
    'document', 'import', sourcePath, '--reuse-exact', '--vault', vaultRoot,
  ])
  assert.equal(rejectedReplay.ok, false)
  if (rejectedReplay.ok) throw new Error('expected damaged exact-source reuse to fail')
  assert.equal(rejectedReplay.error.code, 'conflict')
  assert.match(rejectedReplay.error.message ?? '', /source evidence is incomplete or damaged/iu)
  assert.deepEqual((await readdir(vaultRoot, { recursive: true })).sort(), pathsBeforeReplay)

  const rejectedStatus = await runCli<{ status: string }>([
    'document', 'workout-import-status', source.rawFile, '--vault', vaultRoot,
  ])
  assert.equal(rejectedStatus.ok, false)
  if (rejectedStatus.ok) throw new Error('expected damaged source status to fail')
  assert.match(rejectedStatus.error.message ?? '', /source evidence is incomplete or damaged/iu)

  const rejectedApply = await runCli<EventImportJsonlResult>([
    'event', 'import-jsonl',
    '--input', `@${inputPath}`,
    '--source-raw-ref-once', source.rawFile,
    '--apply',
    '--vault', vaultRoot,
  ])
  assert.equal(rejectedApply.ok, false)
  if (rejectedApply.ok) throw new Error('expected damaged source apply to fail')
  assert.equal(rejectedApply.error.code, 'conflict')

  const workouts = await runCli<EventListResult>([
    'event', 'list', '--kind', 'activity_session', '--vault', vaultRoot,
  ])
  assert.equal(workouts.ok, true)
  assert.equal(requireData(workouts).count, 1)
}, 180_000)

test('workout import status exposes partial history without a completion receipt', async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'murph-cli-import-jsonl-partial-source-'))
  const vaultRoot = path.join(workDir, 'vault')
  const sourcePath = path.join(workDir, 'workout-history.csv')
  await writeFile(sourcePath, 'session,exercise,reps\nsession-a,Squat,5\n', 'utf8')
  await runCli(['init', '--vault', vaultRoot])

  const sourceImport = await runCli<DocumentImportResult>([
    'document', 'import', sourcePath, '--reuse-exact', '--vault', vaultRoot,
  ])
  assert.equal(sourceImport.ok, true)
  const source = requireData(sourceImport)
  const inputPath = path.join(workDir, 'events.jsonl')
  await writeFile(inputPath, toJsonl([withRawRef(source.rawFile)]), 'utf8')

  const unguarded = await runCli<EventImportJsonlResult>([
    'event', 'import-jsonl', '--input', `@${inputPath}`, '--apply', '--vault', vaultRoot,
  ])
  assert.equal(unguarded.ok, true)

  const status = await runCli<{ status: string }>([
    'document', 'workout-import-status', source.rawFile, '--vault', vaultRoot,
  ])
  assert.equal(status.ok, true)
  assert.equal(requireData(status).status, 'partial_conflict')

  const guardedRetry = await runCli<EventImportJsonlResult>([
    'event', 'import-jsonl',
    '--input', `@${inputPath}`,
    '--source-raw-ref-once', source.rawFile,
    '--apply',
    '--vault', vaultRoot,
  ])
  assert.equal(guardedRetry.ok, false)
  if (guardedRetry.ok) throw new Error('expected partial source retry to be rejected')
  assert.equal(guardedRetry.error.code, 'conflict')
  assert.match(guardedRetry.error.message ?? '', /without a whole-source completion receipt/iu)
}, 180_000)

test('deleted exact source fails closed without duplicating workout history', async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'murph-cli-import-jsonl-deleted-source-'))
  const vaultRoot = path.join(workDir, 'vault')
  const sourcePath = path.join(workDir, 'workout-history.csv')
  await writeFile(sourcePath, 'session,exercise,reps\na,Squat,5\nb,Row,8\n', 'utf8')
  await runCli(['init', '--vault', vaultRoot])

  const sourceImport = await runCli<DocumentImportResult>([
    'document', 'import', sourcePath, '--reuse-exact', '--vault', vaultRoot,
  ])
  assert.equal(sourceImport.ok, true)
  const source = requireData(sourceImport)
  const secondPayload = {
    ...withRawRef(source.rawFile, 30),
    occurredAt: '2026-03-14T17:00:00.000Z',
    title: 'Upper body',
  }
  const inputPath = path.join(workDir, 'events.jsonl')
  await writeFile(inputPath, toJsonl([withRawRef(source.rawFile), secondPayload]), 'utf8')
  const applied = await runCli<EventImportJsonlResult>([
    'event', 'import-jsonl',
    '--input', `@${inputPath}`,
    '--source-raw-ref-once', source.rawFile,
    '--apply',
    '--vault', vaultRoot,
  ])
  assert.equal(applied.ok, true)
  assert.equal(requireData(applied).createdCount, 2)

  const deletedSource = await runCli([
    'document', 'delete', source.documentId, '--vault', vaultRoot,
  ])
  assert.equal(deletedSource.ok, true)
  const pathsBeforeReplay = (await readdir(vaultRoot, { recursive: true })).sort()

  const rejectedReplay = await runCli<DocumentImportResult>([
    'document', 'import', sourcePath, '--reuse-exact', '--vault', vaultRoot,
  ])
  assert.equal(
    rejectedReplay.ok,
    false,
    rejectedReplay.ok ? JSON.stringify(rejectedReplay.data) : JSON.stringify(rejectedReplay.error),
  )
  if (rejectedReplay.ok) throw new Error('expected deleted exact source reuse to fail')
  assert.equal(rejectedReplay.error.code, 'conflict')
  assert.match(rejectedReplay.error.message ?? '', /exact source document existed but was deleted/iu)
  assert.deepEqual((await readdir(vaultRoot, { recursive: true })).sort(), pathsBeforeReplay)
  assert.equal(await readFile(path.join(vaultRoot, source.rawFile), 'utf8'), await readFile(sourcePath, 'utf8'))

  const workoutsAfterReplay = await runCli<EventListResult>([
    'event', 'list', '--kind', 'activity_session', '--vault', vaultRoot,
  ])
  assert.equal(workoutsAfterReplay.ok, true)
  assert.equal(requireData(workoutsAfterReplay).count, 2)

  const explicitNewImport = await runCli<DocumentImportResult>([
    'document', 'import', sourcePath, '--vault', vaultRoot,
  ])
  assert.equal(explicitNewImport.ok, true)
  assert.equal(requireData(explicitNewImport).created, true)
  assert.notEqual(requireData(explicitNewImport).documentId, source.documentId)
  assert.notEqual(requireData(explicitNewImport).rawFile, source.rawFile)

  const pathsBeforeAliasReplay = (await readdir(vaultRoot, { recursive: true })).sort()
  const rejectedAliasReplay = await runCli<DocumentImportResult>([
    'document', 'import', sourcePath, '--reuse-exact', '--vault', vaultRoot,
  ])
  assert.equal(rejectedAliasReplay.ok, false)
  if (rejectedAliasReplay.ok) throw new Error('expected a deleted exact identity to fence its live alias')
  assert.equal(rejectedAliasReplay.error.code, 'conflict')
  assert.match(rejectedAliasReplay.error.message ?? '', /exact source document existed but was deleted/iu)
  assert.deepEqual((await readdir(vaultRoot, { recursive: true })).sort(), pathsBeforeAliasReplay)

  const workoutsAfterAliasReplay = await runCli<EventListResult>([
    'event', 'list', '--kind', 'activity_session', '--vault', vaultRoot,
  ])
  assert.equal(workoutsAfterAliasReplay.ok, true)
  assert.equal(requireData(workoutsAfterAliasReplay).count, 2)
}, 180_000)

test('source-guarded apply rejects a document deleted after dry-run', async () => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'murph-cli-import-jsonl-delete-race-'))
  const vaultRoot = path.join(workDir, 'vault')
  const sourcePath = path.join(workDir, 'workout-history.csv')
  await writeFile(sourcePath, 'session,exercise,reps\na,Squat,5\n', 'utf8')
  await runCli(['init', '--vault', vaultRoot])

  const sourceImport = await runCli<DocumentImportResult>([
    'document', 'import', sourcePath, '--reuse-exact', '--vault', vaultRoot,
  ])
  assert.equal(sourceImport.ok, true)
  const source = requireData(sourceImport)
  const inputPath = path.join(workDir, 'events.jsonl')
  await writeFile(inputPath, toJsonl([withRawRef(source.rawFile)]), 'utf8')

  const dryRun = await runCli<EventImportJsonlResult>([
    'event', 'import-jsonl',
    '--input', `@${inputPath}`,
    '--source-raw-ref-once', source.rawFile,
    '--vault', vaultRoot,
  ])
  assert.equal(dryRun.ok, true)
  assert.equal(requireData(dryRun).createdCount, 1)

  const deletedSource = await runCli([
    'document', 'delete', source.documentId, '--vault', vaultRoot,
  ])
  assert.equal(deletedSource.ok, true)
  const rejectedApply = await runCli<EventImportJsonlResult>([
    'event', 'import-jsonl',
    '--input', `@${inputPath}`,
    '--source-raw-ref-once', source.rawFile,
    '--apply',
    '--vault', vaultRoot,
  ])
  assert.equal(rejectedApply.ok, false)
  if (rejectedApply.ok) throw new Error('expected deleted source authority to reject apply')
  assert.equal(rejectedApply.error.code, 'conflict')
  assert.match(rejectedApply.error.message ?? '', /no longer owned by a live source document/iu)

  const workouts = await runCli<EventListResult>([
    'event', 'list', '--kind', 'activity_session', '--vault', vaultRoot,
  ])
  assert.equal(workouts.ok, true)
  assert.equal(requireData(workouts).count, 0)
}, 180_000)

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
    ['event', 'import-jsonl', '--input', '-', '--apply', '--vault', vaultRoot],
    {
      stdin: toJsonl([{
        ...buildActivitySessionPayload(),
        durationMinutes: 60,
      }]),
    },
  )
  assert.equal(changedImport.ok, true)
  assert.equal(requireData(changedImport).supersededCount, 1)

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
