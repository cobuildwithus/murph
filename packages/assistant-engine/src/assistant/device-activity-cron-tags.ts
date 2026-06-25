export const ASSISTANT_DEVICE_ACTIVITY_PARENT_AUTOMATION_TAG_PREFIX =
  'system:assistant-device-activity-parent:'
export const ASSISTANT_DEVICE_ACTIVITY_OCCURRENCE_TAG_PREFIX =
  'system:assistant-device-activity-occurrence:'

export function buildAssistantDeviceActivityParentAutomationTag(
  automationId: string,
): string {
  return `${ASSISTANT_DEVICE_ACTIVITY_PARENT_AUTOMATION_TAG_PREFIX}${automationId}`
}

export function buildAssistantDeviceActivityOccurrenceTag(
  occurrenceKey: string,
): string {
  return `${ASSISTANT_DEVICE_ACTIVITY_OCCURRENCE_TAG_PREFIX}${occurrenceKey}`
}

export function readAssistantDeviceActivityParentAutomationTag(
  tags: readonly string[] | null | undefined,
): string | null {
  return readTagSuffix(tags, ASSISTANT_DEVICE_ACTIVITY_PARENT_AUTOMATION_TAG_PREFIX)
}

export function readAssistantDeviceActivityOccurrenceTag(
  tags: readonly string[] | null | undefined,
): string | null {
  return readTagSuffix(tags, ASSISTANT_DEVICE_ACTIVITY_OCCURRENCE_TAG_PREFIX)
}

function readTagSuffix(
  tags: readonly string[] | null | undefined,
  prefix: string,
): string | null {
  const tag = tags?.find((entry) => entry.startsWith(prefix))
  const suffix = tag?.slice(prefix.length).trim() ?? ''
  return suffix.length > 0 ? suffix : null
}
