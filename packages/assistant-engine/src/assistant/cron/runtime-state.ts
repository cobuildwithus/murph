import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { quarantineAssistantStateFile } from '../quarantine.js'
import type { AssistantStatePaths } from '../store/paths.js'
import {
  ensureAssistantStateDirectory,
  isMissingFileError,
  writeJsonFileAtomic,
} from '../shared.js'

const ASSISTANT_CRON_CANONICAL_RUNTIME_STORE_VERSION = 1
const ASSISTANT_CRON_CANONICAL_RUNTIME_RECORD_SCHEMA =
  'murph.assistant-canonical-cron-runtime-state.v1'
const ASSISTANT_CRON_CANONICAL_RUNNING_STALE_AFTER_MS = 60 * 60 * 1000

const assistantCronCanonicalRuntimeStateSchema = z
  .object({
    activatedAt: z.string().min(1).nullable(),
    pendingOccurrenceAt: z.string().min(1).nullable(),
    retryAfterAt: z.string().min(1).nullable(),
    lastRunAt: z.string().min(1).nullable(),
    lastSucceededAt: z.string().min(1).nullable(),
    lastFailedAt: z.string().min(1).nullable(),
    consecutiveFailures: z.number().int().nonnegative(),
    lastError: z.string().nullable(),
    runningAt: z.string().min(1).nullable(),
    runningPid: z.number().int().positive().nullable(),
  })
  .strict()

const assistantCronCanonicalRuntimeRecordSchema = z
  .object({
    schema: z.literal(ASSISTANT_CRON_CANONICAL_RUNTIME_RECORD_SCHEMA),
    jobId: z.string().min(1),
    alias: z.string().min(1).nullable().default(null),
    sessionId: z.string().min(1).nullable().default(null),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    state: assistantCronCanonicalRuntimeStateSchema,
  })
  .strict()

const assistantCronCanonicalRuntimeStoreSchema = z
  .object({
    version: z.literal(ASSISTANT_CRON_CANONICAL_RUNTIME_STORE_VERSION),
    jobs: z.array(assistantCronCanonicalRuntimeRecordSchema),
  })
  .strict()

export type AssistantCronCanonicalRuntimeState = z.infer<
  typeof assistantCronCanonicalRuntimeStateSchema
>

export type AssistantCronCanonicalRuntimeRecord = z.infer<
  typeof assistantCronCanonicalRuntimeRecordSchema
>

export type AssistantCronCanonicalRuntimeStore = z.infer<
  typeof assistantCronCanonicalRuntimeStoreSchema
>

export async function readAssistantCronCanonicalRuntimeStore(
  paths: AssistantStatePaths,
): Promise<AssistantCronCanonicalRuntimeStore> {
  await ensureAssistantStateDirectory(paths.cronDirectory)

  try {
    const raw = await readFile(paths.cronAutomationStatePath, 'utf8')
    return normalizeAssistantCronCanonicalRuntimeStore(JSON.parse(raw))
  } catch (error) {
    if (isMissingFileError(error)) {
      return createEmptyAssistantCronCanonicalRuntimeStore()
    }

    await quarantineAssistantStateFile({
      artifactKind: 'cron-store',
      error,
      filePath: paths.cronAutomationStatePath,
      paths,
    }).catch(() => undefined)
    return createEmptyAssistantCronCanonicalRuntimeStore()
  }
}

export async function writeAssistantCronCanonicalRuntimeStore(
  paths: AssistantStatePaths,
  store: AssistantCronCanonicalRuntimeStore,
): Promise<void> {
  await ensureAssistantStateDirectory(paths.cronDirectory)
  await writeJsonFileAtomic(
    paths.cronAutomationStatePath,
    normalizeAssistantCronCanonicalRuntimeStore(store),
  )
}

export function findAssistantCronCanonicalRuntimeRecord(
  store: AssistantCronCanonicalRuntimeStore,
  jobId: string,
): AssistantCronCanonicalRuntimeRecord | null {
  return store.jobs.find((record) => record.jobId === jobId) ?? null
}

export function upsertAssistantCronCanonicalRuntimeRecord(
  store: AssistantCronCanonicalRuntimeStore,
  record: AssistantCronCanonicalRuntimeRecord,
): AssistantCronCanonicalRuntimeStore {
  const existingIndex = store.jobs.findIndex((entry) => entry.jobId === record.jobId)
  if (existingIndex === -1) {
    store.jobs.push(record)
  } else {
    store.jobs[existingIndex] = record
  }

  store.jobs.sort((left, right) => left.jobId.localeCompare(right.jobId))
  return store
}

export function removeAssistantCronCanonicalRuntimeRecord(
  store: AssistantCronCanonicalRuntimeStore,
  jobId: string,
): boolean {
  const existingLength = store.jobs.length
  store.jobs = store.jobs.filter((record) => record.jobId !== jobId)
  return store.jobs.length !== existingLength
}

export function createAssistantCronCanonicalRuntimeRecord(input: {
  activatedAt?: string | null
  alias?: string | null
  jobId: string
  now?: string
  sessionId?: string | null
}): AssistantCronCanonicalRuntimeRecord {
  const timestamp = input.now ?? new Date().toISOString()
  return assistantCronCanonicalRuntimeRecordSchema.parse({
    schema: ASSISTANT_CRON_CANONICAL_RUNTIME_RECORD_SCHEMA,
    jobId: input.jobId,
    alias: input.alias ?? null,
    sessionId: input.sessionId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    state: {
      activatedAt: input.activatedAt ?? timestamp,
      pendingOccurrenceAt: null,
      retryAfterAt: null,
      lastRunAt: null,
      lastSucceededAt: null,
      lastFailedAt: null,
      consecutiveFailures: 0,
      lastError: null,
      runningAt: null,
      runningPid: null,
    },
  })
}

function createEmptyAssistantCronCanonicalRuntimeStore(): AssistantCronCanonicalRuntimeStore {
  return {
    version: ASSISTANT_CRON_CANONICAL_RUNTIME_STORE_VERSION,
    jobs: [],
  }
}

function normalizeAssistantCronCanonicalRuntimeStore(
  value: unknown,
): AssistantCronCanonicalRuntimeStore {
  const parsedCurrent = assistantCronCanonicalRuntimeStoreSchema.parse(value)
  const nowMs = Date.now()
  return {
    ...parsedCurrent,
    jobs: [...parsedCurrent.jobs]
      .map((record) => normalizeAssistantCronCanonicalRuntimeRecord(record, nowMs))
      .sort((left, right) => left.jobId.localeCompare(right.jobId)),
  }
}

function normalizeAssistantCronCanonicalRuntimeRecord(
  record: AssistantCronCanonicalRuntimeRecord,
  nowMs: number,
): AssistantCronCanonicalRuntimeRecord {
  if (record.state.runningAt === null) {
    return record
  }

  const runningAtMs = Date.parse(record.state.runningAt)
  const runningClaimIsStale =
    !Number.isFinite(runningAtMs) ||
    nowMs - runningAtMs > ASSISTANT_CRON_CANONICAL_RUNNING_STALE_AFTER_MS

  if (!runningClaimIsStale) {
    return record
  }

  return assistantCronCanonicalRuntimeRecordSchema.parse({
    ...record,
    state: {
      ...record.state,
      runningAt: null,
      runningPid: null,
    },
  })
}
