import { randomUUID } from 'node:crypto'
import { readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import * as z from '@murphai/contracts/zod-runtime'
import {
  assistantCronJobSchema,
  assistantCronRunRecordSchema,
  type AssistantCronJob,
  type AssistantCronRunRecord,
  type AssistantCronTarget,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { quarantineAssistantStateFile } from '../quarantine.js'
import type { AssistantStatePaths } from '../store/paths.js'
import {
  appendTextFile,
  compareAssistantNullableTimestampsAscending,
  compareAssistantTimestampsAscending,
  ensureAssistantStateDirectory,
  isMissingFileError,
  normalizeNullableString,
  parseAssistantJsonLinesWithTailSalvage,
  writeJsonFileAtomic,
  writeTextFileAtomic,
} from '../shared.js'
import {
  assertAssistantCronJobId,
  assertAssistantCronRunId,
  resolveAssistantOpaqueStateFilePath,
} from '../state-ids.js'

const ASSISTANT_CRON_STORE_VERSION = 1
const ASSISTANT_CRON_RESPONSE_RETENTION_LIMIT = 20
const ASSISTANT_CRON_RESPONSE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const ASSISTANT_CRON_HISTORY_RETENTION_LIMIT = 200
const ASSISTANT_CRON_HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

const assistantCronStoreSchema = z
  .object({
    version: z.literal(ASSISTANT_CRON_STORE_VERSION),
    jobs: z.array(assistantCronJobSchema),
  })
  .strict()

export type AssistantCronStore = z.infer<typeof assistantCronStoreSchema>

export interface AssistantCronTargetInput {
  alias?: string | null
  channel?: string | null
  deliverySource?: AssistantCronTarget['deliverySource'] | null
  deliveryTarget?: string | null
  identityId?: string | null
  participantId?: string | null
  sessionId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
}

export async function ensureAssistantCronState(
  paths: AssistantStatePaths,
): Promise<void> {
  await Promise.all([
    ensureAssistantStateDirectory(paths.cronDirectory),
    ensureAssistantStateDirectory(paths.cronRunsDirectory),
  ])
}

export async function readAssistantCronStore(
  paths: AssistantStatePaths,
): Promise<AssistantCronStore> {
  await ensureAssistantCronState(paths)

  let raw: string | null = null
  try {
    raw = await readFile(paths.cronJobsPath, 'utf8')
    return normalizeAssistantCronStore(
      assistantCronStoreSchema.parse(JSON.parse(raw)),
    )
  } catch (error) {
    if (isMissingFileError(error)) {
      return createEmptyAssistantCronStore()
    }

    await quarantineAssistantStateFile({
      artifactKind: 'cron-store',
      error,
      ...(raw === null ? {} : { expectedContent: raw }),
      filePath: paths.cronJobsPath,
      paths,
    }).catch(() => undefined)
    return createEmptyAssistantCronStore()
  }
}

export async function writeAssistantCronStore(
  paths: AssistantStatePaths,
  store: AssistantCronStore,
): Promise<void> {
  await writeJsonFileAtomic(paths.cronJobsPath, sanitizeAssistantCronStoreForPersistence(store))
}

export async function readAssistantCronRuns(
  paths: AssistantStatePaths,
  jobId: string,
): Promise<AssistantCronRunRecord[]> {
  const runsPath = resolveAssistantCronRunsPath(paths, jobId)
  let raw: string | null = null

  try {
    raw = await readFile(runsPath, 'utf8')
    const parsed = parseAssistantJsonLinesWithTailSalvage(raw, (value) =>
      assistantCronRunRecordSchema.parse(value),
    )
    if (parsed.malformedLineCount > 0) {
      await quarantineAssistantStateFile({
        artifactKind: 'cron-run',
        error: new VaultCliError(
          'ASSISTANT_CRON_RUN_CORRUPTED',
          `Assistant cron run journal contains ${parsed.malformedLineCount} malformed committed line(s).`,
        ),
        expectedContent: raw,
        filePath: runsPath,
        paths,
      }).catch(() => undefined)
      return []
    }

    return parsed.values.sort((left, right) =>
      compareAssistantTimestampsAscending(right.startedAt, left.startedAt),
    )
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }

    await quarantineAssistantStateFile({
      artifactKind: 'cron-run',
      error,
      ...(raw === null ? {} : { expectedContent: raw }),
      filePath: runsPath,
      paths,
    }).catch(() => undefined)
    return []
  }
}

export async function appendAssistantCronRun(
  paths: AssistantStatePaths,
  run: AssistantCronRunRecord,
): Promise<void> {
  const runsPath = resolveAssistantCronRunsPath(paths, run.jobId)
  await ensureAssistantStateDirectory(paths.cronRunsDirectory)
  await appendTextFile(runsPath, `${JSON.stringify(run)}\n`)
}

export async function pruneAssistantCronRunHistory(input: {
  now: Date
  paths: AssistantStatePaths
}): Promise<{
  responsesRedacted: number
  runsPruned: number
}> {
  await ensureAssistantCronState(input.paths)
  const entries = await readdir(input.paths.cronRunsDirectory, {
    withFileTypes: true,
  })
  const historyCutoffMs = input.now.getTime() - ASSISTANT_CRON_HISTORY_RETENTION_MS
  const responseCutoffMs = input.now.getTime() - ASSISTANT_CRON_RESPONSE_RETENTION_MS
  let responsesRedacted = 0
  let runsPruned = 0

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
      continue
    }

    const runsPath = path.join(input.paths.cronRunsDirectory, entry.name)
    const jobId = path.basename(entry.name, '.jsonl')
    const runs = await readAssistantCronRuns(input.paths, jobId)
    if (runs.length === 0) {
      continue
    }

    const retained: AssistantCronRunRecord[] = []
    let changed = false

    for (const [index, run] of runs.entries()) {
      const finishedAtMs = Date.parse(run.finishedAt)
      const pruneByCount = index >= ASSISTANT_CRON_HISTORY_RETENTION_LIMIT
      const pruneByAge = Number.isFinite(finishedAtMs) && finishedAtMs < historyCutoffMs
      if (pruneByCount || pruneByAge) {
        runsPruned += 1
        changed = true
        continue
      }

      const redactByCount = index >= ASSISTANT_CRON_RESPONSE_RETENTION_LIMIT
      const redactByAge =
        Number.isFinite(finishedAtMs) && finishedAtMs < responseCutoffMs
      if (run.response !== null && (redactByCount || redactByAge)) {
        retained.push({
          ...run,
          response: null,
        })
        responsesRedacted += 1
        changed = true
        continue
      }

      retained.push(run)
    }

    if (!changed) {
      continue
    }

    if (retained.length === 0) {
      await rm(runsPath, {
        force: true,
      })
      continue
    }

    await writeTextFileAtomic(
      runsPath,
      `${retained.map((retainedRun) => JSON.stringify(retainedRun)).join('\n')}\n`,
    )
  }

  return {
    responsesRedacted,
    runsPruned,
  }
}

export function resolveAssistantCronJobIndex(
  store: AssistantCronStore,
  specifier: string,
): number {
  const resolved = normalizeRequiredAssistantCronText(specifier, 'job')
  const exactIdIndex = store.jobs.findIndex((job) => job.jobId === resolved)
  if (exactIdIndex >= 0) {
    return exactIdIndex
  }

  const exactNameIndex = store.jobs.findIndex((job) => job.name === resolved)
  if (exactNameIndex >= 0) {
    return exactNameIndex
  }

  throw new VaultCliError(
    'ASSISTANT_CRON_JOB_NOT_FOUND',
    `Assistant cron job "${resolved}" was not found.`,
  )
}

export function resolveAssistantCronJobFromStore(
  store: AssistantCronStore,
  specifier: string,
): AssistantCronJob {
  return store.jobs[resolveAssistantCronJobIndex(store, specifier)] as AssistantCronJob
}

export function resolveAssistantCronRunLookupId(
  store: AssistantCronStore,
  specifier: string,
): string {
  const normalized = normalizeRequiredAssistantCronText(specifier, 'job')
  const existing = store.jobs.find(
    (job) => job.jobId === normalized || job.name === normalized,
  )

  return existing?.jobId ?? normalized
}

export function assertAssistantCronJobNameIsAvailable(
  store: AssistantCronStore,
  name: string,
): void {
  if (store.jobs.some((job) => job.name === name)) {
    throw new VaultCliError(
      'ASSISTANT_CRON_JOB_EXISTS',
      `Assistant cron job "${name}" already exists.`,
    )
  }
}

export function sortAssistantCronJobs(
  jobs: readonly AssistantCronJob[],
): AssistantCronJob[] {
  return [...jobs].sort((left, right) => {
    const nextRunComparison = compareAssistantNullableTimestampsAscending(
      left.state.nextRunAt,
      right.state.nextRunAt,
    )
    if (nextRunComparison !== 0) {
      return nextRunComparison
    }

    return left.name.localeCompare(right.name)
  })
}

export function isAssistantCronJobDue(
  job: AssistantCronJob,
  nowIso: string,
): boolean {
  const nextRunAtMs = parseAssistantCronTimestampMs(job.state.nextRunAt)
  const nowMs = parseAssistantCronTimestampMs(nowIso)

  return (
    job.enabled &&
    job.state.runningAt === null &&
    (job.state.pendingDeliveryIntentId ?? null) === null &&
    Number.isFinite(nextRunAtMs) &&
    Number.isFinite(nowMs) &&
    nextRunAtMs <= nowMs
  )
}

export function buildAssistantCronTarget(
  input: AssistantCronTargetInput,
): AssistantCronTarget {
  return {
    sessionId: normalizeNullableString(input.sessionId),
    alias: normalizeNullableString(input.alias),
    channel: normalizeNullableString(input.channel),
    deliverySource: input.deliverySource ?? null,
    identityId: normalizeNullableString(input.identityId),
    participantId: normalizeNullableString(input.participantId),
    threadId: normalizeNullableString(input.threadId),
    ...(typeof input.threadIsDirect === 'boolean'
      ? { threadIsDirect: input.threadIsDirect }
      : {}),
    deliveryTarget: normalizeNullableString(input.deliveryTarget),
  }
}

export function createAssistantCronJobId(): string {
  return assertAssistantCronJobId(`cron_${randomUUID().replace(/-/gu, '')}`)
}

export function createAssistantCronRunId(): string {
  return assertAssistantCronRunId(`cronrun_${randomUUID().replace(/-/gu, '')}`)
}

export function normalizeRequiredAssistantCronText(
  value: string,
  fieldName: string,
): string {
  const normalized = normalizeNullableString(value)
  if (normalized) {
    return normalized
  }

  throw new VaultCliError(
    'ASSISTANT_CRON_INVALID_INPUT',
    `${fieldName} must be a non-empty string.`,
  )
}

function createEmptyAssistantCronStore(): AssistantCronStore {
  return {
    version: ASSISTANT_CRON_STORE_VERSION,
    jobs: [],
  }
}

function normalizeAssistantCronStore(store: AssistantCronStore): AssistantCronStore {
  return {
    ...store,
    jobs: store.jobs.map((job) => normalizeAssistantCronJob(job)),
  }
}

function sanitizeAssistantCronStoreForPersistence(store: AssistantCronStore): AssistantCronStore {
  return {
    ...store,
    jobs: store.jobs.map((job) => assistantCronJobSchema.parse(job)),
  }
}

function normalizeAssistantCronJob(job: AssistantCronJob): AssistantCronJob {
  if (job.state.runningPid === null || job.state.runningAt === null) {
    return job
  }

  if (process.pid === job.state.runningPid) {
    return job
  }

  return isForeignAssistantCronProcessRunning(job.state.runningPid)
    ? job
    : assistantCronJobSchema.parse({
        ...job,
        state: {
          ...job.state,
          runningAt: null,
          runningPid: null,
        },
      })
}

function resolveAssistantCronRunsPath(
  paths: AssistantStatePaths,
  jobId: string,
): string {
  return resolveAssistantOpaqueStateFilePath({
    directory: paths.cronRunsDirectory,
    extension: '.jsonl',
    kind: 'cron job',
    value: jobId,
  })
}

function parseAssistantCronTimestampMs(timestamp: string | null): number {
  return timestamp === null ? Number.NaN : Date.parse(timestamp)
}

function isForeignAssistantCronProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ESRCH'
    ) {
      return false
    }

    return true
  }
}
