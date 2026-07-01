import type { ScheduleIntent, ScheduledLogAction, ScheduledLogStatus } from '@murphai/contracts'
import { executeScheduledLogOccurrence } from '@murphai/core'
import {
  assistantCronScheduleSchema,
  type AssistantCronSchedule,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { ScheduledLogQueryRecord } from '@murphai/query'

export interface CanonicalScheduledLogAssistantCronJobRecord {
  kind: 'scheduledLog'
  actionKind: ScheduledLogAction['kind']
  createdAt: string
  schedule: AssistantCronSchedule
  scheduledLogId: string
  slug: string
  status: Extract<ScheduledLogStatus, 'active' | 'paused'>
  timeZone: string | null
  title: string
  updatedAt: string
}

export function normalizeCanonicalScheduledLogCronRecord(
  record: ScheduledLogQueryRecord,
  timeZone: string,
): CanonicalScheduledLogAssistantCronJobRecord | null {
  if (record.status !== 'active' && record.status !== 'paused') {
    return null
  }

  return {
    kind: 'scheduledLog',
    actionKind: record.action.kind,
    createdAt: record.createdAt,
    schedule: normalizeScheduledLogSchedule(record.schedule),
    scheduledLogId: record.scheduledLogId,
    slug: record.slug,
    status: record.status,
    timeZone:
      record.schedule.kind === 'cron' || record.schedule.kind === 'dailyLocal'
        ? timeZone
        : null,
    title: record.title,
    updatedAt: record.updatedAt,
  }
}

export async function runScheduledLogCronJob(input: {
  beforeWrite?: () => Promise<void> | void
  occurrenceAt: string
  scheduledLogId: string
  vault: string
}): Promise<string> {
  const result = await executeScheduledLogOccurrence({
    vaultRoot: input.vault,
    scheduledLogId: input.scheduledLogId,
    occurrenceAt: input.occurrenceAt,
    ...(input.beforeWrite ? { beforeWrite: input.beforeWrite } : {}),
  })

  return result.message
}

function normalizeScheduledLogSchedule(schedule: ScheduleIntent): AssistantCronSchedule {
  if (schedule.kind === 'cron') {
    return assistantCronScheduleSchema.parse({
      kind: 'cron',
      expression: schedule.expression,
    })
  }

  if (schedule.kind === 'dailyLocal') {
    return assistantCronScheduleSchema.parse({
      kind: 'dailyLocal',
      localTime: schedule.localTime,
    })
  }

  return assistantCronScheduleSchema.parse(schedule)
}
