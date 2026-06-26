import {
  listAutomations,
  readAutomationByRelativePath,
  type AutomationQueryRecord,
} from '@murphai/query'
import type { AssistantDeviceActivityCronJobMetadata } from './device-activity-cron-tags.js'

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
