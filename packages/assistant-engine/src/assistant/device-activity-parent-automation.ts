import {
  listAutomations,
  readAutomationByRelativePath,
  type AutomationQueryRecord,
} from '@murphai/query'
import {
  assistantDeviceActivityAuthorityKeyMatches,
  type AssistantDeviceActivityCronJobMetadata,
} from './device-activity-cron-tags.js'

type AutomationDeviceActivitySchedule = Extract<
  AutomationQueryRecord['schedule'],
  { kind: 'deviceActivity' }
>

export type AssistantValidDeviceActivityParent = AutomationQueryRecord & {
  schedule: AutomationDeviceActivitySchedule
}

/**
 * A device-activity child may act for its parent only while the parent is
 * active, still the same device-activity automation by semantic authority,
 * and before its deadline. Cursor advancement and model-only edits keep the
 * semantic authority; a declined archival write never extends the deadline.
 */
export function resolveAssistantDeviceActivityParentValidity(input: {
  metadata: AssistantDeviceActivityCronJobMetadata
  now: Date
  parent: AutomationQueryRecord | null
}): AssistantValidDeviceActivityParent | null {
  const parent = input.parent
  if (!parent || parent.status !== 'active') {
    return null
  }
  if (parent.schedule.kind !== 'deviceActivity') {
    return null
  }
  if (
    parent.activeUntil &&
    input.now.getTime() >= Date.parse(parent.activeUntil)
  ) {
    return null
  }
  const schedule = parent.schedule
  if (!assistantDeviceActivityAuthorityKeyMatches({
    authorityKey: input.metadata.authorityKey,
    automation: {
      ...parent,
      schedule: {
        activityKind: schedule.activityKind,
        source: schedule.source,
      },
    },
  })) {
    return null
  }
  return { ...parent, schedule }
}

export async function readAssistantDeviceActivityParentAutomation(input: {
  metadata: AssistantDeviceActivityCronJobMetadata
  vault: string
}): Promise<AutomationQueryRecord | null> {
  const byRelativePath = input.metadata.parentAutomationRelativePath
    ? await readAutomationByRelativePath(
        input.vault,
        input.metadata.parentAutomationRelativePath,
      )
    : null
  if (byRelativePath?.automationId === input.metadata.parentAutomationId) {
    return byRelativePath
  }

  return (await listAutomations(input.vault, {
    status: ['active', 'paused', 'archived'],
  })).find((automation) => automation.automationId === input.metadata.parentAutomationId) ?? null
}
