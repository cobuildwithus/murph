import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { assistantCronJobStateSchema } from '@murphai/operator-config/assistant-cli-contracts'
import { quarantineAssistantStateFile } from '../quarantine.js'
import type { AssistantStatePaths } from '../store/paths.js'
import {
  ensureAssistantStateDirectory,
  isMissingFileError,
  writeJsonFileAtomic,
} from '../shared.js'

const ASSISTANT_CRON_AUTOMATION_RUNTIME_STORE_VERSION = 1

const assistantCronAutomationRuntimeRecordSchema = z
  .object({
    schema: z.literal('murph.assistant-automation-runtime-state.v1'),
    automationId: z.string().min(1),
    alias: z.string().min(1).nullable().default(null),
    sessionId: z.string().min(1).nullable().default(null),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    state: assistantCronJobStateSchema,
  })
  .strict()

const assistantCronAutomationRuntimeStoreSchema = z
  .object({
    version: z.literal(ASSISTANT_CRON_AUTOMATION_RUNTIME_STORE_VERSION),
    automations: z.array(assistantCronAutomationRuntimeRecordSchema),
  })
  .strict()

export type AssistantCronAutomationRuntimeRecord = z.infer<
  typeof assistantCronAutomationRuntimeRecordSchema
>

export type AssistantCronAutomationRuntimeStore = z.infer<
  typeof assistantCronAutomationRuntimeStoreSchema
>

export async function readAssistantCronAutomationRuntimeStore(
  paths: AssistantStatePaths,
): Promise<AssistantCronAutomationRuntimeStore> {
  await ensureAssistantStateDirectory(paths.cronDirectory)

  try {
    const raw = await readFile(paths.cronAutomationStatePath, 'utf8')
    return normalizeAssistantCronAutomationRuntimeStore(
      assistantCronAutomationRuntimeStoreSchema.parse(JSON.parse(raw) as unknown),
    )
  } catch (error) {
    if (isMissingFileError(error)) {
      return createEmptyAssistantCronAutomationRuntimeStore()
    }

    await quarantineAssistantStateFile({
      artifactKind: 'cron-store',
      error,
      filePath: paths.cronAutomationStatePath,
      paths,
    }).catch(() => undefined)
    return createEmptyAssistantCronAutomationRuntimeStore()
  }
}

export async function writeAssistantCronAutomationRuntimeStore(
  paths: AssistantStatePaths,
  store: AssistantCronAutomationRuntimeStore,
): Promise<void> {
  await ensureAssistantStateDirectory(paths.cronDirectory)
  await writeJsonFileAtomic(paths.cronAutomationStatePath, store)
}

export function findAssistantCronAutomationRuntimeRecord(
  store: AssistantCronAutomationRuntimeStore,
  automationId: string,
): AssistantCronAutomationRuntimeRecord | null {
  return (
    store.automations.find((record) => record.automationId === automationId) ?? null
  )
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
  const timestamp = input.now ?? new Date().toISOString()
  return assistantCronAutomationRuntimeRecordSchema.parse({
    schema: 'murph.assistant-automation-runtime-state.v1',
    automationId: input.automationId,
    alias: input.alias ?? null,
    sessionId: input.sessionId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    state: {
      nextRunAt: input.nextRunAt,
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

function createEmptyAssistantCronAutomationRuntimeStore(): AssistantCronAutomationRuntimeStore {
  return {
    version: ASSISTANT_CRON_AUTOMATION_RUNTIME_STORE_VERSION,
    automations: [],
  }
}

function normalizeAssistantCronAutomationRuntimeStore(
  store: AssistantCronAutomationRuntimeStore,
): AssistantCronAutomationRuntimeStore {
  return {
    ...store,
    automations: [...store.automations].sort((left, right) =>
      left.automationId.localeCompare(right.automationId),
    ),
  }
}
