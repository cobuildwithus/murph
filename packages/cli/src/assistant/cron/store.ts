import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'incur'
import {
  assistantCronJobSchema,
  assistantCronRunRecordSchema,
  type AssistantCronJob,
  type AssistantCronRunRecord,
  type AssistantCronTarget,
  type AssistantSelfDeliveryTarget,
} from '../../assistant-cli-contracts.js'
import { resolvePreferredAssistantSelfDeliveryTarget } from '../../operator-config.js'
import { VaultCliError } from '../../vault-cli-errors.js'
import { getAssistantChannelAdapter } from '../channel-adapters.js'
import { resolveAssistantBindingDelivery } from '../bindings.js'
import type { AssistantStatePaths } from '../store.js'
import {
  isMissingFileError,
  normalizeNullableString,
  writeJsonFileAtomic,
} from '../shared.js'

const ASSISTANT_CRON_STORE_VERSION = 1

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
  deliveryTarget?: string | null
  deliverResponse?: boolean
  identityId?: string | null
  participantId?: string | null
  sessionId?: string | null
  sourceThreadId?: string | null
}

export async function ensureAssistantCronState(
  paths: AssistantStatePaths,
): Promise<void> {
  await Promise.all([
    mkdir(paths.cronDirectory, {
      recursive: true,
    }),
    mkdir(paths.cronRunsDirectory, {
      recursive: true,
    }),
  ])
}

export async function readAssistantCronStore(
  paths: AssistantStatePaths,
): Promise<AssistantCronStore> {
  const normalized = await inspectAssistantCronStore(paths)
  return normalized.store
}

export async function inspectAssistantCronStore(
  paths: AssistantStatePaths,
): Promise<{
  changed: boolean
  store: AssistantCronStore
}> {
  await ensureAssistantCronState(paths)

  try {
    const raw = await readFile(paths.cronJobsPath, 'utf8')
    return normalizeAssistantCronStore(
      assistantCronStoreSchema.parse(JSON.parse(raw) as unknown),
    )
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        changed: false,
        store: {
          version: ASSISTANT_CRON_STORE_VERSION,
          jobs: [],
        },
      }
    }

    throw error
  }
}

export async function writeAssistantCronStore(
  paths: AssistantStatePaths,
  store: AssistantCronStore,
): Promise<void> {
  await writeJsonFileAtomic(paths.cronJobsPath, store)
}

export async function readAssistantCronRuns(
  paths: AssistantStatePaths,
  jobId: string,
): Promise<AssistantCronRunRecord[]> {
  const runsPath = resolveAssistantCronRunsPath(paths, jobId)

  try {
    const raw = await readFile(runsPath, 'utf8')
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) =>
        assistantCronRunRecordSchema.parse(JSON.parse(line) as unknown),
      )
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }

    throw error
  }
}

export async function appendAssistantCronRun(
  paths: AssistantStatePaths,
  run: AssistantCronRunRecord,
): Promise<void> {
  const runsPath = resolveAssistantCronRunsPath(paths, run.jobId)
  await mkdir(paths.cronRunsDirectory, {
    recursive: true,
  })
  await appendFile(runsPath, `${JSON.stringify(run)}\n`, 'utf8')
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
    const nextRunComparison = compareNullableIsoTimestamps(
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
  return (
    job.enabled &&
    job.state.runningAt === null &&
    job.state.nextRunAt !== null &&
    job.state.nextRunAt <= nowIso
  )
}

export function buildAssistantCronTarget(
  input: AssistantCronTargetInput,
): AssistantCronTarget {
  return {
    sessionId: normalizeNullableString(input.sessionId),
    alias: normalizeNullableString(input.alias),
    channel: normalizeNullableString(input.channel),
    identityId: normalizeNullableString(input.identityId),
    participantId: normalizeNullableString(input.participantId),
    sourceThreadId: normalizeNullableString(input.sourceThreadId),
    deliveryTarget: normalizeNullableString(input.deliveryTarget),
    deliverResponse: input.deliverResponse ?? false,
  }
}

export function createAssistantCronJobId(): string {
  return `cron_${randomUUID().replace(/-/gu, '')}`
}

export function createAssistantCronRunId(): string {
  return `cronrun_${randomUUID().replace(/-/gu, '')}`
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

async function normalizeAssistantCronStore(store: AssistantCronStore): Promise<{
  changed: boolean
  store: AssistantCronStore
}> {
  const fallbackTarget = await resolvePreferredAssistantSelfDeliveryTarget({
    preferredChannel: 'telegram',
    allowSingleSavedTargetFallback: true,
  })
  const migratedAt = new Date().toISOString()
  let changed = false
  const jobs = store.jobs.map((job) => {
    const normalizedJob = normalizeAssistantCronJob(job, fallbackTarget, migratedAt)
    if (normalizedJob !== job) {
      changed = true
    }
    return normalizedJob
  })

  return {
    changed,
    store: {
      ...store,
      jobs,
    },
  }
}

function normalizeAssistantCronJob(
  job: AssistantCronJob,
  fallbackTarget: AssistantSelfDeliveryTarget | null,
  migratedAt: string,
): AssistantCronJob {
  let normalizedJob = job

  if (job.state.runningPid !== null && job.state.runningAt !== null) {
    if (process.pid === job.state.runningPid) {
      normalizedJob = job
    } else if (!isForeignAssistantCronProcessRunning(job.state.runningPid)) {
      normalizedJob = assistantCronJobSchema.parse({
        ...normalizedJob,
        state: {
          ...normalizedJob.state,
          runningAt: null,
          runningPid: null,
        },
      })
    }
  }

  const migratedTarget = migrateLegacyAssistantCronTarget(
    normalizedJob,
    fallbackTarget,
  )
  if (migratedTarget === normalizedJob.target) {
    return normalizedJob
  }

  return assistantCronJobSchema.parse({
    ...normalizedJob,
    target: migratedTarget,
    updatedAt: migratedAt,
  })
}

function migrateLegacyAssistantCronTarget(
  job: AssistantCronJob,
  fallbackTarget: AssistantSelfDeliveryTarget | null,
): AssistantCronTarget {
  if (job.foodAutoLog) {
    return job.target
  }

  if (assistantCronTargetCanAutoDeliver(job.target)) {
    if (job.target.deliverResponse) {
      return job.target
    }

    return {
      ...job.target,
      deliverResponse: true,
    }
  }

  if (!fallbackTarget) {
    return job.target
  }

  return {
    sessionId: job.target.sessionId,
    alias: job.target.alias,
    channel: fallbackTarget.channel,
    identityId: fallbackTarget.identityId,
    participantId: fallbackTarget.participantId,
    sourceThreadId: fallbackTarget.sourceThreadId,
    deliveryTarget: fallbackTarget.deliveryTarget,
    deliverResponse: true,
  }
}

function assistantCronTargetCanAutoDeliver(target: AssistantCronTarget): boolean {
  const channel = normalizeNullableString(target.channel)
  if (!channel || !getAssistantChannelAdapter(channel)) {
    return false
  }

  if (channel === 'email' && !normalizeNullableString(target.identityId)) {
    return false
  }

  if (normalizeNullableString(target.deliveryTarget)) {
    return true
  }

  return (
    resolveAssistantBindingDelivery({
      channel,
      actorId: normalizeNullableString(target.participantId),
      threadId: normalizeNullableString(target.sourceThreadId),
    }) !== null
  )
}

function resolveAssistantCronRunsPath(
  paths: AssistantStatePaths,
  jobId: string,
): string {
  return path.join(paths.cronRunsDirectory, `${jobId}.jsonl`)
}

function compareNullableIsoTimestamps(
  left: string | null,
  right: string | null,
): number {
  if (left === right) {
    return 0
  }

  if (left === null) {
    return 1
  }

  if (right === null) {
    return -1
  }

  return left.localeCompare(right)
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
