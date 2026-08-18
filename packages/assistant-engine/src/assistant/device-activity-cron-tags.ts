import { createHash } from 'node:crypto'
import type {
  AutomationContextReference,
  AutomationContinuityPolicy,
  AutomationDeviceActivityKind,
  AutomationDeviceActivitySource,
  AutomationRoute,
} from '@murphai/contracts'

const ASSISTANT_DEVICE_ACTIVITY_CRON_NAME_MARKER_PREFIX =
  ' [system:assistant-device-activity:v1:'
const ASSISTANT_DEVICE_ACTIVITY_CRON_NAME_MARKER_SUFFIX = ']'
const ASSISTANT_DEVICE_ACTIVITY_DELIVERY_IDEMPOTENCY_PREFIX =
  'device-activity-cron:v1:'

export interface AssistantDeviceActivityAuthorityInput {
  automationId: string
  continuityPolicy: AutomationContinuityPolicy
  contextReferences?: readonly AutomationContextReference[]
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
  parentAutomationRelativePath?: string
}

export function buildAssistantDeviceActivityAuthorityKey(
  automation: AssistantDeviceActivityAuthorityInput,
): string {
  return hashAssistantDeviceActivityAuthorityPayload({
    activityKind: automation.schedule.activityKind ?? null,
    automationId: automation.automationId,
    continuityPolicy: automation.continuityPolicy,
    ...(automation.contextReferences?.length
      ? {
          contextReferences: automation.contextReferences.map((reference) => ({
            entityId: reference.entityId,
            entityKind: reference.entityKind,
          })),
        }
      : {}),
    instructions: automation.instructions,
    route: automation.route,
    source: automation.schedule.source ?? null,
  })
}

export function assistantDeviceActivityAuthorityKeyMatches(input: {
  automation: AssistantDeviceActivityAuthorityInput
  authorityKey: string
}): boolean {
  return buildAssistantDeviceActivityAuthorityKey(input.automation) === input.authorityKey
}

function hashAssistantDeviceActivityAuthorityPayload(
  payload: Record<string, unknown>,
): string {
  return createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 40)
}

export function appendAssistantDeviceActivityCronJobMetadata(
  name: string,
  metadata: AssistantDeviceActivityCronJobMetadata,
): string {
  return `${name}${ASSISTANT_DEVICE_ACTIVITY_CRON_NAME_MARKER_PREFIX}${[
    encodeURIComponent(metadata.parentAutomationId),
    metadata.parentAutomationRelativePath
      ? encodeURIComponent(metadata.parentAutomationRelativePath)
      : null,
    metadata.authorityKey,
    metadata.occurrenceKey,
  ].filter((part): part is string => part !== null).join(':')}${ASSISTANT_DEVICE_ACTIVITY_CRON_NAME_MARKER_SUFFIX}`
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
    input.metadata.parentAutomationRelativePath
      ? encodeURIComponent(input.metadata.parentAutomationRelativePath)
      : null,
    input.metadata.authorityKey,
    input.metadata.occurrenceKey,
    discriminatorDigest,
  ].filter((part): part is string => part !== null).join(':')}`
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
  const parts = suffix.split(':')
  return parseAssistantDeviceActivityMetadataParts(
    parts.length >= 5 ? parts.slice(0, 4) : parts.slice(0, 3),
  )
}

function parseAssistantDeviceActivityMetadataParts(
  parts: readonly string[],
): AssistantDeviceActivityCronJobMetadata | null {
  if (parts.length !== 3 && parts.length !== 4) {
    return null
  }
  const [
    encodedParentAutomationId,
    encodedParentAutomationRelativePathOrAuthorityKey,
    authorityKeyOrOccurrenceKey,
    occurrenceKeyMaybe,
  ] = parts
  const encodedParentAutomationRelativePath =
    parts.length === 4 ? encodedParentAutomationRelativePathOrAuthorityKey : null
  const authorityKey =
    parts.length === 4 ? authorityKeyOrOccurrenceKey : encodedParentAutomationRelativePathOrAuthorityKey
  const occurrenceKey = parts.length === 4 ? occurrenceKeyMaybe : authorityKeyOrOccurrenceKey
  if (
    !encodedParentAutomationId ||
    !isDeviceActivityHash(authorityKey) ||
    !isDeviceActivityHash(occurrenceKey)
  ) {
    return null
  }

  try {
    const parentAutomationId = decodeURIComponent(encodedParentAutomationId)
    const parentAutomationRelativePath = encodedParentAutomationRelativePath
      ? decodeURIComponent(encodedParentAutomationRelativePath)
      : null
    return parentAutomationId.length > 0
      ? {
          authorityKey,
          occurrenceKey,
          parentAutomationId,
          ...(parentAutomationRelativePath ? { parentAutomationRelativePath } : {}),
        }
      : null
  } catch {
    return null
  }
}

function isDeviceActivityHash(value: string | undefined): value is string {
  return typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value)
}
