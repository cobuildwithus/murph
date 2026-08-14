import {
  type AssistantBindingDelivery,
  type AssistantCronJob,
  type AssistantCronTarget,
  type AssistantCronTargetSnapshot,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { AutomationRoute } from '@murphai/contracts'
import {
  type AssistantAutomationRouteValidationProfile,
  getAssistantAutomationRouteDeliverabilityIssue,
  resolveAssistantDeliveryRouteWithCurrentRoute,
  stripPrivateAssistantRoutePlaceholders,
} from '@murphai/operator-config/assistant/current-delivery-route'
import { applyAssistantSelfDeliveryTargetDefaults } from '@murphai/operator-config/operator-config'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { resolveAssistantBindingDelivery } from '../bindings.js'
import { getAssistantChannelAdapter } from '../channel-adapters.js'
import { normalizeNullableString } from '../shared.js'
import {
  buildAssistantCronTarget,
  type AssistantCronTargetInput,
} from './store.js'

export async function resolveAssistantCronTargetDefaults<
  TInput extends AssistantCronTargetInput,
>(input: TInput) {
  const resolvedTarget = await applyAssistantSelfDeliveryTargetDefaults(
    {
      channel: input.channel,
      identityId: input.identityId,
      participantId: input.participantId,
      threadId: input.threadId,
      deliveryTarget: input.deliveryTarget,
    },
    {
      allowSingleSavedTargetFallback: true,
    },
  )
  const resolvedRoute = stripPrivateAssistantRoutePlaceholders(
    resolveAssistantDeliveryRouteWithCurrentRoute(resolvedTarget, null),
  )

  return {
    ...input,
    channel: resolvedRoute.channel ?? undefined,
    deliverySource: input.deliverySource ?? undefined,
    identityId: resolvedRoute.identityId ?? undefined,
    participantId: resolvedRoute.participantId ?? undefined,
    threadId: resolvedRoute.threadId ?? undefined,
    threadIsDirect: resolvedRoute.threadIsDirect ?? undefined,
    deliveryTarget: resolvedRoute.deliveryTarget ?? undefined,
  }
}

export function validateAssistantCronDeliveryTarget(
  input: AssistantCronTargetInput,
  profile: AssistantAutomationRouteValidationProfile = 'local',
): AssistantCronTarget {
  const channel = normalizeNullableString(input.channel)
  if (!channel) {
    throw new VaultCliError(
      'ASSISTANT_CRON_DELIVERY_REQUIRED',
      'Assistant cron jobs must declare an outbound channel and delivery route. Pass --channel plus --thread, --participant, or --deliveryTarget. Cron jobs send a single notification message to the bound route.',
    )
  }

  if (!getAssistantChannelAdapter(channel)) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_UNSUPPORTED',
      `Outbound delivery for channel "${channel}" is not supported in this build.`,
    )
  }

  const normalizedRoute = stripPrivateAssistantRoutePlaceholders({
    channel,
    identityId: normalizeNullableString(input.identityId),
    participantId: normalizeNullableString(input.participantId),
    threadId: normalizeNullableString(input.threadId),
    ...(typeof input.threadIsDirect === 'boolean'
      ? { threadIsDirect: input.threadIsDirect }
      : {}),
    deliveryTarget: normalizeNullableString(input.deliveryTarget),
  })
  const identityId = normalizedRoute.identityId
  const participantId = normalizedRoute.participantId
  const threadId = normalizedRoute.threadId
  const deliveryTarget = normalizedRoute.deliveryTarget
  const deliverySource = input.deliverySource ?? null
  const deliveryIssue = getAssistantAutomationRouteDeliverabilityIssue(
    {
      ...normalizedRoute,
      deliverySource,
    },
    profile,
  )
  if (deliveryIssue) {
    throw new VaultCliError(
      deliveryIssue.code === 'email_identity_required'
        ? 'ASSISTANT_EMAIL_IDENTITY_REQUIRED'
        : 'ASSISTANT_CRON_DELIVERY_REQUIRED',
      formatAssistantCronDeliveryIssueMessage(deliveryIssue.message),
    )
  }
  const hasLinqParticipantDelivery =
    channel === 'linq' &&
    Boolean(participantId) &&
    deliverySource?.kind === 'linq'
  const bindingDelivery = resolveAssistantBindingDelivery({
    channel,
    actorId: participantId,
    threadId,
    deliveryTarget,
  })
  if (!deliveryTarget && !bindingDelivery && !hasLinqParticipantDelivery) {
    throw new VaultCliError(
      'ASSISTANT_CRON_DELIVERY_REQUIRED',
      'Assistant cron jobs must bind an explicit outbound route. Pass --thread, --participant, or --deliveryTarget for the selected channel.',
    )
  }

  return buildAssistantCronTarget({
    alias: input.alias,
    channel,
    deliverySource,
    deliveryTarget,
    identityId,
    participantId,
    sessionId: input.sessionId,
    threadId,
    ...(typeof normalizedRoute.threadIsDirect === 'boolean'
      ? { threadIsDirect: normalizedRoute.threadIsDirect }
      : {}),
  })
}

export type AssistantCronDeliveryRouteValidationProfile =
  AssistantAutomationRouteValidationProfile

function formatAssistantCronDeliveryIssueMessage(message: string): string {
  return message
    .replace(/^Email automation routes/u, 'Email assistant cron jobs')
    .replace(/^iMessage automation routes/u, 'iMessage assistant cron jobs')
    .replace(/^Automation routes/u, 'Assistant cron jobs')
}

export function buildCanonicalAutomationRoute(
  target: AssistantCronTarget,
): AutomationRoute {
  return {
    channel: target.channel ?? '',
    deliverySource: target.deliverySource,
    deliveryTarget: target.deliveryTarget,
    identityId: target.identityId,
    participantId: target.participantId,
    threadId: target.threadId,
    ...(typeof target.threadIsDirect === 'boolean'
      ? { threadIsDirect: target.threadIsDirect }
      : {}),
  }
}

// Non-throwing form of validateAssistantCronDeliveryTarget for callers that
// pre-check deliverability (e.g. managed-automation seeding) instead of
// surfacing a CLI error. Keep this the only other entry into the route rules
// so deliverability semantics cannot drift between write paths.
export function resolveDeliverableAutomationRoute(
  input: AssistantCronTargetInput,
  profile: AssistantCronDeliveryRouteValidationProfile,
): AutomationRoute | null {
  try {
    return buildCanonicalAutomationRoute(
      validateAssistantCronDeliveryTarget(input, profile),
    )
  } catch (error) {
    if (error instanceof VaultCliError) {
      return null
    }
    throw error
  }
}

export function buildAssistantCronTargetSnapshot(
  job: Pick<AssistantCronJob, 'jobId' | 'name' | 'target'>,
): AssistantCronTargetSnapshot {
  return {
    jobId: job.jobId,
    jobName: job.name,
    target: job.target,
    bindingDelivery: resolveAssistantCronTargetBindingDelivery(job.target),
  }
}

export function resolveAssistantCronTargetBindingDelivery(
  target: AssistantCronTarget,
): AssistantBindingDelivery | null {
  if (normalizeNullableString(target.deliveryTarget) !== null) {
    return null
  }

  if (isLinqParticipantMaterializationTarget(target)) {
    return {
      kind: 'participant',
      target: target.participantId,
    }
  }

  return resolveAssistantBindingDelivery({
    channel: target.channel,
    actorId: target.participantId,
    threadId: target.threadId,
    deliveryTarget: target.deliveryTarget,
  })
}

export function resolveAssistantCronNotificationDeliveryRoute(
  target: AssistantCronTarget,
): {
  bindingDelivery: AssistantBindingDelivery | null
  deliveryTarget: string | null
  threadIsDirect: boolean | null
} {
  const bindingDelivery = resolveAssistantCronTargetBindingDelivery(target)
  return {
    bindingDelivery,
    deliveryTarget: normalizeNullableString(target.deliveryTarget),
    threadIsDirect: resolveAssistantCronNotificationThreadIsDirect(target),
  }
}

function resolveAssistantCronNotificationThreadIsDirect(
  target: AssistantCronTarget,
): boolean | null {
  return typeof target.threadIsDirect === 'boolean'
    ? target.threadIsDirect
    : null
}

function isLinqParticipantMaterializationTarget(
  target: AssistantCronTarget,
): target is AssistantCronTarget & {
  deliverySource: { kind: 'linq'; fromPhoneNumber: string }
  participantId: string
} {
  return (
    normalizeNullableString(target.deliveryTarget) === null &&
    target.channel === 'linq' &&
    Boolean(target.participantId) &&
    target.deliverySource?.kind === 'linq' &&
    Boolean(target.deliverySource.fromPhoneNumber)
  )
}

export function assistantCronTargetAudienceEquals(
  left: Pick<
    AssistantCronTarget | AutomationRoute,
    | 'channel'
    | 'deliverySource'
    | 'deliveryTarget'
    | 'identityId'
    | 'participantId'
    | 'threadId'
    | 'threadIsDirect'
  >,
  right: Pick<
    AssistantCronTarget | AutomationRoute,
    | 'channel'
    | 'deliverySource'
    | 'deliveryTarget'
    | 'identityId'
    | 'participantId'
    | 'threadId'
    | 'threadIsDirect'
  >,
): boolean {
  return (
    left.channel === right.channel &&
    assistantCronDeliverySourceEquals(
      left.deliverySource,
      right.deliverySource,
    ) &&
    left.identityId === right.identityId &&
    left.participantId === right.participantId &&
    left.threadId === right.threadId &&
    (left.threadIsDirect ?? null) === (right.threadIsDirect ?? null) &&
    left.deliveryTarget === right.deliveryTarget
  )
}

function assistantCronDeliverySourceEquals(
  left: AssistantCronTarget['deliverySource'] | undefined,
  right: AssistantCronTarget['deliverySource'] | undefined,
): boolean {
  const normalizedLeft = left ?? null
  const normalizedRight = right ?? null

  if (normalizedLeft === null || normalizedRight === null) {
    return normalizedLeft === normalizedRight
  }

  return normalizedLeft.kind === normalizedRight.kind &&
    normalizedLeft.fromPhoneNumber === normalizedRight.fromPhoneNumber
}
