import type {
  AssistantBindingDelivery,
  AssistantSession,
} from '../assistant-cli-contracts.js'
import type { AssistantMessageInput } from './service-contracts.js'
import {
  isAcceptedInboundMessageOperatorAuthority,
  resolveAssistantOperatorAuthority,
  type AssistantOperatorAuthority,
} from './operator-authority.js'
import { isAssistantUserFacingChannel } from './channel-presentation.js'
import { normalizeNullableString } from './shared.js'

export type AssistantConversationDeliveryPolicy =
  | 'binding-target-only'
  | 'explicit-target-override'
  | 'not-requested'

export interface AssistantConversationAudience {
  actorId: string | null
  bindingDelivery: AssistantBindingDelivery | null
  channel: string | null
  deliveryPolicy: AssistantConversationDeliveryPolicy
  effectiveThreadIsDirect: boolean | null
  explicitTarget: string | null
  identityId: string | null
  replyToMessageId: string | null
  threadId: string | null
  threadIsDirect: boolean | null
}

export interface AssistantConversationPolicy {
  allowSensitiveHealthContext: boolean
  audience: AssistantConversationAudience
  operatorAuthority: AssistantOperatorAuthority
}

export function resolveAssistantConversationPolicy(input: {
  message: Pick<
    AssistantMessageInput,
    | 'deliverResponse'
    | 'deliveryReplyToMessageId'
    | 'deliveryTarget'
    | 'operatorAuthority'
    | 'sourceThreadId'
    | 'threadId'
    | 'threadIsDirect'
  >
  session: Pick<AssistantSession, 'binding'>
}): AssistantConversationPolicy {
  const audience = resolveAssistantConversationAudience({
    message: input.message,
    session: input.session,
  })
  const operatorAuthority = resolveAssistantOperatorAuthority(
    input.message.operatorAuthority,
  )

  return {
    allowSensitiveHealthContext: shouldExposeSensitiveHealthContext(audience),
    audience,
    operatorAuthority,
  }
}

export function resolveAssistantConversationAudience(input: {
  message: Pick<
    AssistantMessageInput,
    | 'deliverResponse'
    | 'deliveryReplyToMessageId'
    | 'deliveryTarget'
    | 'operatorAuthority'
    | 'sourceThreadId'
    | 'threadId'
    | 'threadIsDirect'
  >
  session: Pick<AssistantSession, 'binding'>
}): AssistantConversationAudience {
  const binding = input.session.binding
  const channel = normalizeNullableString(binding.channel)
  const identityId = normalizeNullableString(binding.identityId)
  const actorId = normalizeNullableString(binding.actorId)
  const threadId =
    normalizeNullableString(input.message.threadId) ??
    normalizeNullableString(input.message.sourceThreadId) ??
    normalizeNullableString(binding.threadId)
  const explicitTarget = normalizeNullableString(input.message.deliveryTarget)
  const replyToMessageId = normalizeNullableString(
    input.message.deliveryReplyToMessageId,
  )
  const bindingDelivery = binding.delivery ?? null

  return {
    actorId,
    bindingDelivery,
    channel,
    deliveryPolicy:
      input.message.deliverResponse !== true
        ? 'not-requested'
        : explicitTarget
          ? 'explicit-target-override'
          : 'binding-target-only',
    effectiveThreadIsDirect: resolveAssistantConversationAudienceDirectness({
      actorId,
      bindingDelivery,
      explicitTarget,
      sessionThreadId: normalizeNullableString(binding.threadId),
      threadId,
      threadIsDirect: input.message.threadIsDirect,
      storedThreadIsDirect: binding.threadIsDirect,
    }),
    explicitTarget,
    identityId,
    replyToMessageId,
    threadId,
    threadIsDirect:
      typeof input.message.threadIsDirect === 'boolean'
        ? input.message.threadIsDirect
        : binding.threadIsDirect,
  }
}

export function resolveAssistantConversationAutoReplyEligibility(input: {
  audience: AssistantConversationAudience
  operatorAuthority: AssistantOperatorAuthority
}): boolean {
  if (!isAcceptedInboundMessageOperatorAuthority(input.operatorAuthority)) {
    return true
  }

  if (!input.audience.channel || !input.audience.identityId) {
    return false
  }

  if (input.audience.deliveryPolicy === 'not-requested') {
    return false
  }

  if (input.audience.threadIsDirect === false && !input.audience.bindingDelivery) {
    return false
  }

  return true
}

export function shouldExposeSensitiveHealthContext(
  audience: AssistantConversationAudience,
): boolean {
  if (!isAssistantUserFacingChannel(audience.channel)) {
    return true
  }

  const effectiveThreadIsDirect =
    audience.effectiveThreadIsDirect ?? audience.threadIsDirect
  if (effectiveThreadIsDirect !== true) {
    return false
  }

  if (audience.deliveryPolicy !== 'explicit-target-override') {
    return true
  }

  const explicitTarget = normalizeNullableString(audience.explicitTarget)
  if (!explicitTarget) {
    return false
  }

  const privateAudienceTargets = [
    normalizeNullableString(audience.bindingDelivery?.target),
    normalizeNullableString(audience.actorId),
    normalizeNullableString(audience.threadId),
  ].filter((value): value is string => value !== null)

  return privateAudienceTargets.includes(explicitTarget)
}

function resolveAssistantConversationAudienceDirectness(input: {
  actorId: string | null
  bindingDelivery: AssistantBindingDelivery | null
  explicitTarget: string | null
  sessionThreadId: string | null
  storedThreadIsDirect: boolean | null
  threadId: string | null
  threadIsDirect: boolean | null | undefined
}): boolean | null {
  if (typeof input.threadIsDirect === 'boolean') {
    return input.threadIsDirect
  }

  const explicitTargetDirectness = inferDirectAudienceFromTarget({
    actorId: input.actorId,
    bindingDelivery: input.bindingDelivery,
    target: input.explicitTarget,
    threadId: input.threadId ?? input.sessionThreadId,
    threadIsDirect: input.storedThreadIsDirect,
  })
  if (explicitTargetDirectness !== null) {
    return explicitTargetDirectness
  }

  const bindingTargetDirectness = inferDirectAudienceFromTarget({
    actorId: input.actorId,
    bindingDelivery: input.bindingDelivery,
    target: normalizeNullableString(input.bindingDelivery?.target),
    threadId: input.threadId ?? input.sessionThreadId,
    threadIsDirect: input.storedThreadIsDirect,
  })
  if (bindingTargetDirectness !== null) {
    return bindingTargetDirectness
  }

  return input.storedThreadIsDirect
}

function inferDirectAudienceFromTarget(input: {
  actorId: string | null
  bindingDelivery: AssistantBindingDelivery | null
  target: string | null
  threadId: string | null
  threadIsDirect: boolean | null
}): boolean | null {
  const target = normalizeNullableString(input.target)
  if (!target) {
    return null
  }

  if (input.actorId && target === input.actorId) {
    return true
  }

  const bindingDeliveryTarget = normalizeNullableString(input.bindingDelivery?.target)
  if (input.bindingDelivery?.kind === 'participant' && bindingDeliveryTarget === target) {
    return true
  }

  if (input.threadId && target === input.threadId) {
    return input.threadIsDirect
  }

  if (input.bindingDelivery?.kind === 'thread' && bindingDeliveryTarget === target) {
    return input.threadIsDirect
  }

  return null
}
