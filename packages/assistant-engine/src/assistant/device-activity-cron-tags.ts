import { createHash } from 'node:crypto'
import type {
  AutomationContinuityPolicy,
  AutomationDeviceActivityKind,
  AutomationDeviceActivitySource,
  AutomationRoute,
} from '@murphai/contracts'

export const ASSISTANT_DEVICE_ACTIVITY_PARENT_AUTOMATION_TAG_PREFIX =
  'system:assistant-device-activity-parent:'
export const ASSISTANT_DEVICE_ACTIVITY_OCCURRENCE_TAG_PREFIX =
  'system:assistant-device-activity-occurrence:'
export const ASSISTANT_DEVICE_ACTIVITY_AUTHORITY_TAG_PREFIX =
  'system:assistant-device-activity-authority:'
const ASSISTANT_DEVICE_ACTIVITY_CRON_NAME_MARKER_PREFIX =
  ' [system:assistant-device-activity:v1:'
const ASSISTANT_DEVICE_ACTIVITY_CRON_NAME_MARKER_SUFFIX = ']'
const ASSISTANT_DEVICE_ACTIVITY_DELIVERY_IDEMPOTENCY_PREFIX =
  'device-activity-cron:v1:'

export interface AssistantDeviceActivityAuthorityInput {
  automationId: string
  continuityPolicy: AutomationContinuityPolicy
  instructions: string
  route: AutomationRoute
  schedule: {
    activityKind?: AutomationDeviceActivityKind
    source?: AutomationDeviceActivitySource
  }
}

export interface AssistantDeviceActivityCronJobMetadata {
  authorityKey: string
  occurrenceKey: string
  parentAutomationId: string
}

export function buildAssistantDeviceActivityAuthorityKey(
  automation: AssistantDeviceActivityAuthorityInput,
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      activityKind: automation.schedule.activityKind ?? null,
      automationId: automation.automationId,
      continuityPolicy: automation.continuityPolicy,
      instructions: automation.instructions,
      route: automation.route,
      source: automation.schedule.source ?? null,
    }))
    .digest('hex')
    .slice(0, 40)
}

export function appendAssistantDeviceActivityCronJobMetadata(
  name: string,
  metadata: AssistantDeviceActivityCronJobMetadata,
): string {
  return `${name}${ASSISTANT_DEVICE_ACTIVITY_CRON_NAME_MARKER_PREFIX}${[
    encodeURIComponent(metadata.parentAutomationId),
    metadata.authorityKey,
    metadata.occurrenceKey,
  ].join(':')}${ASSISTANT_DEVICE_ACTIVITY_CRON_NAME_MARKER_SUFFIX}`
}

export function readAssistantDeviceActivityCronJobMetadata(
  name: string,
): AssistantDeviceActivityCronJobMetadata | null {
  const markerStart = name.lastIndexOf(ASSISTANT_DEVICE_ACTIVITY_CRON_NAME_MARKER_PREFIX)
  if (markerStart < 0 || !name.endsWith(ASSISTANT_DEVICE_ACTIVITY_CRON_NAME_MARKER_SUFFIX)) {
    return null
  }

  const marker = name.slice(
    markerStart + ASSISTANT_DEVICE_ACTIVITY_CRON_NAME_MARKER_PREFIX.length,
    -ASSISTANT_DEVICE_ACTIVITY_CRON_NAME_MARKER_SUFFIX.length,
  )
  return parseAssistantDeviceActivityMetadataParts(marker.split(':'))
}

export function buildAssistantDeviceActivityDeliveryIdempotencyKey(input: {
  discriminator: unknown
  metadata: AssistantDeviceActivityCronJobMetadata
}): string {
  const discriminatorDigest = createHash('sha256')
    .update(JSON.stringify(input.discriminator))
    .digest('hex')
    .slice(0, 40)
  return `${ASSISTANT_DEVICE_ACTIVITY_DELIVERY_IDEMPOTENCY_PREFIX}${[
    encodeURIComponent(input.metadata.parentAutomationId),
    input.metadata.authorityKey,
    input.metadata.occurrenceKey,
    discriminatorDigest,
  ].join(':')}`
}

export function readAssistantDeviceActivityDeliveryIdempotencyMetadata(
  deliveryIdempotencyKey: string | null | undefined,
): AssistantDeviceActivityCronJobMetadata | null {
  if (!deliveryIdempotencyKey?.startsWith(ASSISTANT_DEVICE_ACTIVITY_DELIVERY_IDEMPOTENCY_PREFIX)) {
    return null
  }

  const suffix = deliveryIdempotencyKey.slice(
    ASSISTANT_DEVICE_ACTIVITY_DELIVERY_IDEMPOTENCY_PREFIX.length,
  )
  return parseAssistantDeviceActivityMetadataParts(suffix.split(':').slice(0, 3))
}

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

function parseAssistantDeviceActivityMetadataParts(
  parts: readonly string[],
): AssistantDeviceActivityCronJobMetadata | null {
  if (parts.length !== 3) {
    return null
  }
  const [encodedParentAutomationId, authorityKey, occurrenceKey] = parts
  if (
    !encodedParentAutomationId ||
    !isDeviceActivityHash(authorityKey) ||
    !isDeviceActivityHash(occurrenceKey)
  ) {
    return null
  }

  try {
    const parentAutomationId = decodeURIComponent(encodedParentAutomationId)
    return parentAutomationId.length > 0
      ? {
          authorityKey,
          occurrenceKey,
          parentAutomationId,
        }
      : null
  } catch {
    return null
  }
}

function isDeviceActivityHash(value: string | undefined): value is string {
  return typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value)
}
