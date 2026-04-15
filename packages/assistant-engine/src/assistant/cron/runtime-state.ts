import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { quarantineAssistantStateFile } from '../quarantine.js'
import type { AssistantStatePaths } from '../store/paths.js'
import {
  ensureAssistantStateDirectory,
  isMissingFileError,
  writeJsonFileAtomic,
} from '../shared.js'

const ASSISTANT_CRON_CANONICAL_RUNTIME_STORE_VERSION = 2
const ASSISTANT_CRON_CANONICAL_RUNTIME_RECORD_SCHEMA =
  'murph.assistant-canonical-cron-runtime-state.v2'

const legacyAssistantCronJobStateSchema = z
  .object({
    nextRunAt: z.string().min(1).nullable(),
    lastRunAt: z.string().min(1).nullable(),
    lastSucceededAt: z.string().min(1).nullable(),
    lastFailedAt: z.string().min(1).nullable(),
    consecutiveFailures: z.number().int().nonnegative(),
    lastError: z.string().nullable(),
    runningAt: z.string().min(1).nullable(),
    runningPid: z.number().int().positive().nullable(),
  })
  .strict()

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

const legacyAssistantCronAutomationRuntimeRecordSchema = z
  .object({
    schema: z.literal('murph.assistant-automation-runtime-state.v1'),
    automationId: z.string().min(1),
    alias: z.string().min(1).nullable().default(null),
    sessionId: z.string().min(1).nullable().default(null),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    state: legacyAssistantCronJobStateSchema,
  })
  .strict()

const legacyAssistantCronAutomationRuntimeStoreSchema = z
  .object({
    version: z.literal(1),
    automations: z.array(legacyAssistantCronAutomationRuntimeRecordSchema),
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

export interface AssistantCronAutomationRuntimeRecord {
  schema: 'murph.assistant-automation-runtime-state.v1'
  automationId: string
  alias: string | null
  sessionId: string | null
  createdAt: string
  updatedAt: string
  state: z.infer<typeof legacyAssistantCronJobStateSchema>
}

export interface AssistantCronAutomationRuntimeStore {
  version: 1
  automations: AssistantCronAutomationRuntimeRecord[]
}

export async function readAssistantCronCanonicalRuntimeStore(
  paths: AssistantStatePaths,
): Promise<AssistantCronCanonicalRuntimeStore> {
  await ensureAssistantStateDirectory(paths.cronDirectory)

  try {
    const raw = await readFile(paths.cronAutomationStatePath, 'utf8')
    return normalizeAssistantCronCanonicalRuntimeStore(JSON.parse(raw) as unknown)
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
  await writeJsonFileAtomic(paths.cronAutomationStatePath, store)
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

export async function readAssistantCronAutomationRuntimeStore(
  paths: AssistantStatePaths,
): Promise<AssistantCronAutomationRuntimeStore> {
  return toLegacyAutomationRuntimeStore(
    await readAssistantCronCanonicalRuntimeStore(paths),
  )
}

export async function writeAssistantCronAutomationRuntimeStore(
  paths: AssistantStatePaths,
  store: AssistantCronAutomationRuntimeStore,
): Promise<void> {
  await writeAssistantCronCanonicalRuntimeStore(
    paths,
    fromLegacyAutomationRuntimeStore(store),
  )
}

export function findAssistantCronAutomationRuntimeRecord(
  store: AssistantCronAutomationRuntimeStore,
  automationId: string,
): AssistantCronAutomationRuntimeRecord | null {
  return store.automations.find((record) => record.automationId === automationId) ?? null
}

export function upsertAssistantCronAutomationRuntimeRecord(
  store: AssistantCronAutomationRuntimeStore,
  record: AssistantCronAutomationRuntimeRecord,
): AssistantCronAutomationRuntimeStore {
  const existingIndex = store.automations.findIndex(
    (entry) => entry.automationId === record.automationId,
  )
  if (existingIndex === -1) {
    store.automations.push(record)
  } else {
    store.automations[existingIndex] = record
  }

  store.automations.sort((left, right) =>
    left.automationId.localeCompare(right.automationId),
  )
  return store
}

export function removeAssistantCronAutomationRuntimeRecord(
  store: AssistantCronAutomationRuntimeStore,
  automationId: string,
): boolean {
  const existingLength = store.automations.length
  store.automations = store.automations.filter(
    (record) => record.automationId !== automationId,
  )
  return store.automations.length !== existingLength
}

export function createAssistantCronAutomationRuntimeRecord(input: {
  alias?: string | null
  automationId: string
  nextRunAt: string | null
  now?: string
  sessionId?: string | null
}): AssistantCronAutomationRuntimeRecord {
  const created = createAssistantCronCanonicalRuntimeRecord({
    alias: input.alias,
    jobId: input.automationId,
    now: input.now,
    sessionId: input.sessionId,
  })

  const canonical =
    input.nextRunAt === null
      ? created
      : {
          ...created,
          state: {
            ...created.state,
            pendingOccurrenceAt: input.nextRunAt,
          },
        }

  return toLegacyAutomationRuntimeRecord(canonical)
}

function createEmptyAssistantCronCanonicalRuntimeStore(): AssistantCronCanonicalRuntimeStore {
  return {
    version: ASSISTANT_CRON_CANONICAL_RUNTIME_STORE_VERSION,
    jobs: [],
  }
}

function toLegacyAutomationRuntimeStore(
  store: AssistantCronCanonicalRuntimeStore,
): AssistantCronAutomationRuntimeStore {
  return {
    version: 1,
    automations: store.jobs
      .map((record) => toLegacyAutomationRuntimeRecord(record))
      .sort((left, right) => left.automationId.localeCompare(right.automationId)),
  }
}

function fromLegacyAutomationRuntimeStore(
  store: AssistantCronAutomationRuntimeStore,
): AssistantCronCanonicalRuntimeStore {
  return {
    version: ASSISTANT_CRON_CANONICAL_RUNTIME_STORE_VERSION,
    jobs: store.automations
      .map((record) => migrateLegacyRuntimeRecord(record))
      .sort((left, right) => left.jobId.localeCompare(right.jobId)),
  }
}

function toLegacyAutomationRuntimeRecord(
  record: AssistantCronCanonicalRuntimeRecord,
): AssistantCronAutomationRuntimeRecord {
  return {
    schema: 'murph.assistant-automation-runtime-state.v1',
    automationId: record.jobId,
    alias: record.alias,
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    state: {
      nextRunAt: record.state.retryAfterAt ?? record.state.pendingOccurrenceAt,
      lastRunAt: record.state.lastRunAt,
      lastSucceededAt: record.state.lastSucceededAt,
      lastFailedAt: record.state.lastFailedAt,
      consecutiveFailures: record.state.consecutiveFailures,
      lastError: record.state.lastError,
      runningAt: record.state.runningAt,
      runningPid: record.state.runningPid,
    },
  }
}

function normalizeAssistantCronCanonicalRuntimeStore(
  value: unknown,
): AssistantCronCanonicalRuntimeStore {
  const parsedCurrent = assistantCronCanonicalRuntimeStoreSchema.safeParse(value)
  if (parsedCurrent.success) {
    return {
      ...parsedCurrent.data,
      jobs: [...parsedCurrent.data.jobs].sort((left, right) =>
        left.jobId.localeCompare(right.jobId),
      ),
    }
  }

  const parsedLegacy = legacyAssistantCronAutomationRuntimeStoreSchema.parse(value)
  return {
    version: ASSISTANT_CRON_CANONICAL_RUNTIME_STORE_VERSION,
    jobs: parsedLegacy.automations
      .map((record) => migrateLegacyRuntimeRecord(record))
      .sort((left, right) => left.jobId.localeCompare(right.jobId)),
  }
}

function migrateLegacyRuntimeRecord(
  record: z.infer<typeof legacyAssistantCronAutomationRuntimeRecordSchema>,
): AssistantCronCanonicalRuntimeRecord {
  const pendingOccurrenceAt =
    record.state.runningAt !== null || record.state.consecutiveFailures > 0
      ? record.state.nextRunAt
      : null

  return assistantCronCanonicalRuntimeRecordSchema.parse({
    schema: ASSISTANT_CRON_CANONICAL_RUNTIME_RECORD_SCHEMA,
    jobId: record.automationId,
    alias: record.alias,
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    state: {
      activatedAt: record.createdAt,
      pendingOccurrenceAt,
      retryAfterAt:
        record.state.consecutiveFailures > 0 ? record.state.nextRunAt : null,
      lastRunAt: record.state.lastRunAt,
      lastSucceededAt: record.state.lastSucceededAt,
      lastFailedAt: record.state.lastFailedAt,
      consecutiveFailures: record.state.consecutiveFailures,
      lastError: record.state.lastError,
      runningAt: record.state.runningAt,
      runningPid: record.state.runningPid,
    },
  })
}
