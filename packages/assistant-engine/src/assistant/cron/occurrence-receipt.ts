import { readFile } from 'node:fs/promises'

import type { AutomationSchedule } from '@murphai/contracts'

import type {
  AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  assistantCronRunRecordSchema,
  assistantOutboxIntentSchema,
  type AssistantCronRunRecord,
} from '@murphai/operator-config/assistant-cli-contracts'

import {
  buildAssistantDeviceActivityCronJobId,
  readAssistantDeviceActivityCronJobMetadata,
  readAssistantDeviceActivityDeliveryIdempotencyMetadata,
} from '../device-activity-cron-tags.js'
import type {
  AssistantAutomationOccurrenceReceipt,
} from '../execution-context.js'
import { resolveAssistantOutboxIntentPath } from '../outbox/intents.js'
import { hasAssistantOutboxDeliveryEvidence } from '../response-media.js'
import {
  compareAssistantTimestampsAscending,
  isMissingFileError,
  parseAssistantJsonLinesWithTailSalvage,
} from '../shared.js'
import { resolveAssistantOpaqueStateFilePath } from '../state-ids.js'
import { resolveAssistantStatePaths } from '../store/paths.js'
import {
  findAssistantCronCanonicalRuntimeRecord,
  normalizeAssistantCronCanonicalRuntimeStore,
} from './runtime-state.js'
import { parseAssistantCronStore } from './store.js'

type OccurrenceOutboxEvidence = {
  deliveryConfirmationPending: boolean
  dispatchConfirmed: boolean
  status: AssistantOutboxIntent['status']
}

export interface AssistantAutomationOccurrenceReceiptProjectionInput {
  latestRun: AssistantCronRunRecord | null
  pendingDeliveryIntent: OccurrenceOutboxEvidence | null
  pendingOccurrenceAt: string | null
  runningAt: string | null
}

export interface AssistantAutomationOccurrenceReceiptReadOptions {
  deviceActivitySchedule?: Extract<
    AutomationSchedule,
    { kind: 'deviceActivity' }
  >
}

/**
 * Reads canonical scheduler evidence and projects one bounded, content-free
 * latest-occurrence receipt. This does not create a second receipt store.
 */
export async function getAssistantCronAutomationOccurrenceReceipt(
  vault: string,
  automationId: string,
  options?: AssistantAutomationOccurrenceReceiptReadOptions,
): Promise<AssistantAutomationOccurrenceReceipt> {
  try {
    const paths = resolveAssistantStatePaths(vault)
    if (options?.deviceActivitySchedule !== undefined) {
      return await getAssistantDeviceActivityOccurrenceReceipt({
        automationId,
        cronJobsPath: paths.cronJobsPath,
        cronRunsDirectory: paths.cronRunsDirectory,
        deviceActivitySchedule: options.deviceActivitySchedule,
        outboxDirectory: paths.outboxDirectory,
      })
    }
    const [runs, runtimeStore] = await Promise.all([
      readAssistantCronRunsForReceipt(paths.cronRunsDirectory, automationId),
      readAssistantCronRuntimeForReceipt(paths.cronAutomationStatePath),
    ])
    const runtimeRecord = runtimeStore === null
      ? null
      : findAssistantCronCanonicalRuntimeRecord(runtimeStore, automationId)
    const pendingDeliveryIntentId =
      runtimeRecord?.state.pendingDeliveryIntentId ?? null
    const pendingDeliveryIntentRecord = pendingDeliveryIntentId === null
      ? null
      : await readAssistantOutboxIntentForReceipt(
          paths.outboxDirectory,
          pendingDeliveryIntentId,
        )
    const pendingDeliveryIntent =
      pendingDeliveryIntentRecord?.automationAuthority?.automationId === automationId
        ? projectOccurrenceOutboxEvidence(pendingDeliveryIntentRecord)
        : null

    return projectAssistantAutomationOccurrenceReceipt({
      latestRun: runs[0] ?? null,
      pendingDeliveryIntent,
      pendingOccurrenceAt:
        runtimeRecord?.state.pendingOccurrenceAt ?? null,
      runningAt: runtimeRecord?.state.runningAt ?? null,
    })
  } catch {
    return { history: 'unavailable' }
  }
}

async function getAssistantDeviceActivityOccurrenceReceipt(input: {
  automationId: string
  cronJobsPath: string
  cronRunsDirectory: string
  deviceActivitySchedule: Extract<
    AutomationSchedule,
    { kind: 'deviceActivity' }
  >
  outboxDirectory: string
}): Promise<AssistantAutomationOccurrenceReceipt> {
  const { afterEntityId, afterOccurredAt } = input.deviceActivitySchedule
  if (afterEntityId === undefined || afterOccurredAt === undefined) {
    return { history: 'not_observed' }
  }
  const jobId = buildAssistantDeviceActivityCronJobId({
    entityId: afterEntityId,
    occurredAt: afterOccurredAt,
    parentAutomationId: input.automationId,
    triggeredAt: input.deviceActivitySchedule.after,
  })
  const [cronStore, runs] = await Promise.all([
    readAssistantCronStoreForReceipt(input.cronJobsPath),
    readAssistantCronRunsForReceipt(input.cronRunsDirectory, jobId),
  ])
  const job = cronStore?.jobs.find((candidate) => candidate.jobId === jobId) ?? null
  if (job !== null) {
    const metadata = readAssistantDeviceActivityCronJobMetadata(job.name)
    if (
      metadata?.parentAutomationId !== input.automationId
      || metadata.occurrenceKey !== jobId.slice('cron_device_activity_'.length)
    ) {
      throw new Error('Device activity occurrence authority is unavailable.')
    }
  }
  const pendingDeliveryIntentId = job?.state.pendingDeliveryIntentId ?? null
  const pendingDeliveryIntentRecord = pendingDeliveryIntentId === null
    ? null
    : await readAssistantOutboxIntentForReceipt(
        input.outboxDirectory,
        pendingDeliveryIntentId,
      )
  if (pendingDeliveryIntentId !== null && pendingDeliveryIntentRecord === null) {
    throw new Error('Device activity delivery evidence is unavailable.')
  }
  if (pendingDeliveryIntentRecord !== null) {
    const metadata = readAssistantDeviceActivityDeliveryIdempotencyMetadata(
      pendingDeliveryIntentRecord.deliveryIdempotencyKey,
    )
    if (
      metadata?.parentAutomationId !== input.automationId
      || metadata.occurrenceKey !== jobId.slice('cron_device_activity_'.length)
    ) {
      throw new Error('Device activity delivery authority is unavailable.')
    }
  }
  return projectAssistantAutomationOccurrenceReceipt({
    latestRun: runs[0] ?? null,
    pendingDeliveryIntent: pendingDeliveryIntentRecord === null
      ? null
      : projectOccurrenceOutboxEvidence(pendingDeliveryIntentRecord),
    pendingOccurrenceAt: job?.state.nextRunAt ?? null,
    runningAt: job?.state.runningAt ?? null,
  })
}

function projectOccurrenceOutboxEvidence(
  intent: AssistantOutboxIntent,
): OccurrenceOutboxEvidence {
  return {
    deliveryConfirmationPending: intent.deliveryConfirmationPending,
    dispatchConfirmed:
      intent.status === 'sent'
      || hasAssistantOutboxDeliveryEvidence(intent, true),
    status: intent.status,
  }
}

export function projectAssistantAutomationOccurrenceReceipt(
  input: AssistantAutomationOccurrenceReceiptProjectionInput,
): AssistantAutomationOccurrenceReceipt {
  if (isNewerRunningOccurrence(input.runningAt, input.latestRun)) {
    return {
      delivered: 'unknown',
      finishedAt: null,
      generated: 'unknown',
      history: 'observed',
      outcome: 'pending',
      scheduledAt: input.pendingOccurrenceAt,
      sent: 'unknown',
      startedAt: input.runningAt as string,
      trigger: 'unknown',
    }
  }

  const run = input.latestRun
  if (run === null) {
    return { history: 'not_observed' }
  }

  const common = {
    finishedAt: run.finishedAt,
    history: 'observed' as const,
    scheduledAt: run.scheduledOccurrenceAt ?? null,
    startedAt: run.startedAt,
    trigger: run.trigger,
  }

  if (isLegacyAmbiguousSuccessRun(run)) {
    if (run.notificationDecision?.kind === 'skip') {
      return {
        ...common,
        delivered: 'not_reached',
        generated: 'not_reached',
        outcome: 'skipped',
        sent: 'not_reached',
      }
    }
    return {
      ...common,
      delivered: 'unknown',
      generated:
        run.notificationDecision?.kind === 'send_message'
        || run.responseLength > 0
          ? 'confirmed'
          : 'unknown',
      outcome: 'unknown',
      sent: 'unknown',
    }
  }

  switch (run.outcome) {
    case 'delivered':
      return {
        ...common,
        delivered: 'unconfirmed',
        generated: 'confirmed',
        outcome: 'sent',
        sent: 'confirmed',
      }
    case 'delivery_pending':
      return projectPendingDeliveryReceipt(common, input.pendingDeliveryIntent)
    case 'expired':
      return {
        ...common,
        delivered: 'not_reached',
        generated: 'not_reached',
        outcome: 'skipped',
        sent: 'not_reached',
      }
    case 'skipped_gate':
      return {
        ...common,
        delivered: 'not_reached',
        generated:
          run.notificationDecision?.kind === 'send_message'
          || run.responseLength > 0
            ? 'confirmed'
            : 'not_reached',
        outcome: 'skipped',
        sent: 'not_reached',
      }
    case 'no_op':
      if (run.notificationDecision?.kind === 'skip') {
        return {
          ...common,
          delivered: 'not_reached',
          generated: 'not_reached',
          outcome: 'skipped',
          sent: 'not_reached',
        }
      }
      return {
        ...common,
        delivered: 'not_reached',
        generated:
          run.notificationDecision?.kind === 'send_message'
          || run.responseLength > 0
            ? 'confirmed'
            : 'not_reached',
        outcome: 'no_message',
        sent: 'not_reached',
      }
    case 'failed':
      if (run.reason === 'delivery_failed_not_reached') {
        return {
          ...common,
          delivered: 'not_reached',
          generated: 'confirmed',
          outcome: 'failed',
          sent: 'not_reached',
        }
      }
      if (run.reason === 'delivery_failed_sent') {
        return {
          ...common,
          delivered: 'unconfirmed',
          generated: 'confirmed',
          outcome: 'sent',
          sent: 'confirmed',
        }
      }
      if (run.reason === 'delivery_failed_unknown') {
        return {
          ...common,
          delivered: 'unknown',
          generated: 'confirmed',
          outcome: 'failed',
          sent: 'unknown',
        }
      }
      return {
        ...common,
        delivered: 'unknown',
        generated:
          run.notificationDecision?.kind === 'send_message'
          || run.responseLength > 0
            ? 'confirmed'
            : 'unknown',
        outcome: 'failed',
        sent: 'unknown',
      }
  }
}

function isLegacyAmbiguousSuccessRun(
  run: AssistantCronRunRecord,
): boolean {
  return run.status === 'succeeded'
    && run.reason === 'legacy_succeeded'
}

function projectPendingDeliveryReceipt(
  common: {
    finishedAt: string
    history: 'observed'
    scheduledAt: string | null
    startedAt: string
    trigger: 'manual' | 'scheduled'
  },
  intent: OccurrenceOutboxEvidence | null,
): AssistantAutomationOccurrenceReceipt {
  if (intent === null) {
    return {
      ...common,
      delivered: 'unknown',
      generated: 'confirmed',
      outcome: 'pending',
      sent: 'unknown',
    }
  }

  if (intent.dispatchConfirmed) {
    return {
      ...common,
      delivered: 'unconfirmed',
      generated: 'confirmed',
      outcome: 'sent',
      sent: 'confirmed',
    }
  }

  if (intent.status === 'sent') {
    return {
      ...common,
      delivered: 'unconfirmed',
      generated: 'confirmed',
      outcome: 'sent',
      sent: 'confirmed',
    }
  }

  if (intent.status === 'failed' || intent.status === 'abandoned') {
    const dispatchWasAmbiguous =
      intent.status === 'abandoned' || intent.deliveryConfirmationPending
    return {
      ...common,
      delivered: dispatchWasAmbiguous ? 'unknown' : 'not_reached',
      generated: 'confirmed',
      outcome: 'failed',
      sent: dispatchWasAmbiguous ? 'unknown' : 'not_reached',
    }
  }

  if (intent.deliveryConfirmationPending) {
    return {
      ...common,
      delivered: 'unknown',
      generated: 'confirmed',
      outcome: 'pending',
      sent: 'unknown',
    }
  }

  return {
    ...common,
    delivered: 'not_reached',
    generated: 'confirmed',
    outcome: 'pending',
    sent: 'pending',
  }
}

async function readAssistantCronRunsForReceipt(
  runsDirectory: string,
  automationId: string,
): Promise<AssistantCronRunRecord[]> {
  const runsPath = resolveAssistantOpaqueStateFilePath({
    directory: runsDirectory,
    extension: '.jsonl',
    kind: 'cron job',
    value: automationId,
  })
  const raw = await readOptionalAssistantStateFile(runsPath)
  if (raw === null) {
    return []
  }
  const parsed = parseAssistantJsonLinesWithTailSalvage(raw, (value) =>
    assistantCronRunRecordSchema.parse(value),
  )
  if (parsed.malformedLineCount > 0) {
    throw new Error('Assistant cron occurrence history is unavailable.')
  }
  return parsed.values.sort((left, right) =>
    compareAssistantTimestampsAscending(right.startedAt, left.startedAt),
  )
}

async function readAssistantCronRuntimeForReceipt(runtimePath: string) {
  const raw = await readOptionalAssistantStateFile(runtimePath)
  return raw === null
    ? null
    : normalizeAssistantCronCanonicalRuntimeStore(JSON.parse(raw))
}

async function readAssistantCronStoreForReceipt(cronJobsPath: string) {
  const raw = await readOptionalAssistantStateFile(cronJobsPath)
  return raw === null
    ? null
    : parseAssistantCronStore(JSON.parse(raw))
}

async function readAssistantOutboxIntentForReceipt(
  outboxDirectory: string,
  intentId: string,
): Promise<AssistantOutboxIntent | null> {
  const raw = await readOptionalAssistantStateFile(
    resolveAssistantOutboxIntentPath(outboxDirectory, intentId),
  )
  return raw === null
    ? null
    : assistantOutboxIntentSchema.parse(JSON.parse(raw))
}

async function readOptionalAssistantStateFile(
  filePath: string,
): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  }
}

function isNewerRunningOccurrence(
  runningAt: string | null,
  latestRun: AssistantCronRunRecord | null,
): runningAt is string {
  if (runningAt === null || !Number.isFinite(Date.parse(runningAt))) {
    return false
  }
  if (latestRun === null) {
    return true
  }
  return Date.parse(runningAt) > Date.parse(latestRun.finishedAt)
}
