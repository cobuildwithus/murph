export const ASSISTANT_DEVICE_ACTIVITY_PARENT_AUTOMATION_TAG_PREFIX =
  'system:assistant-device-activity-parent:'
export const ASSISTANT_DEVICE_ACTIVITY_OCCURRENCE_TAG_PREFIX =
  'system:assistant-device-activity-occurrence:'
export const ASSISTANT_DEVICE_ACTIVITY_AUTHORITY_TAG_PREFIX =
  'system:assistant-device-activity-authority:'

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

export function buildAssistantDeviceActivityAuthorityTag(
  authorityKey: string,
): string {
  return `${ASSISTANT_DEVICE_ACTIVITY_AUTHORITY_TAG_PREFIX}${authorityKey}`
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

export function readAssistantDeviceActivityAuthorityTag(
  tags: readonly string[] | null | undefined,
): string | null {
  return readTagSuffix(tags, ASSISTANT_DEVICE_ACTIVITY_AUTHORITY_TAG_PREFIX)
}

function readTagSuffix(
  tags: readonly string[] | null | undefined,
  prefix: string,
): string | null {
  const matches = tags?.filter((entry) => entry.startsWith(prefix)) ?? []
  if (matches.length !== 1) {
    return null
  }

  const suffix = matches[0]?.slice(prefix.length).trim() ?? ''
  return suffix.length > 0 ? suffix : null
}

export function isAssistantDeviceActivityReservedTag(tag: string): boolean {
  return tag.startsWith(ASSISTANT_DEVICE_ACTIVITY_PARENT_AUTOMATION_TAG_PREFIX) ||
    tag.startsWith(ASSISTANT_DEVICE_ACTIVITY_OCCURRENCE_TAG_PREFIX) ||
    tag.startsWith(ASSISTANT_DEVICE_ACTIVITY_AUTHORITY_TAG_PREFIX)
}
