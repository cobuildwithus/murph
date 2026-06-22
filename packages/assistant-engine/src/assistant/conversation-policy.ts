import type {
  AssistantBindingDelivery,
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantMessageInput } from './service-contracts.js'
import { threadIsDirectFromConversationDirectness } from './conversation-ref.js'
import {
  resolveAssistantOperatorAuthority,
  type AssistantOperatorAuthority,
} from './operator-authority.js'
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
  reactionTargetMessageId: string | null
  replyToMessageId: string | null
  threadId: string | null
  threadIsDirect: boolean | null
}

export interface AssistantConversationPolicy {
  audience: AssistantConversationAudience
  operatorAuthority: AssistantOperatorAuthority
}

export function resolveAssistantConversationPolicy(input: {
  message: Pick<
    AssistantMessageInput,
    | 'conversation'
    | 'channel'
    | 'deliverResponse'
    | 'deliveryReactionTargetMessageId'
    | 'deliveryReplyToMessageId'
    | 'deliveryTarget'
    | 'operatorAuthority'
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
    audience,
    operatorAuthority,
  }
}

export function resolveAssistantConversationAudience(input: {
  message: Pick<
    AssistantMessageInput,
    | 'conversation'
    | 'channel'
    | 'deliverResponse'
    | 'deliveryReactionTargetMessageId'
    | 'deliveryReplyToMessageId'
    | 'deliveryTarget'
    | 'operatorAuthority'
    | 'threadId'
    | 'threadIsDirect'
  >
  session: Pick<AssistantSession, 'binding'>
}): AssistantConversationAudience {
  const binding = input.session.binding
  const conversation =
    typeof input.message.conversation === 'object' && input.message.conversation !== null
      ? input.message.conversation
      : null
  const channel =
    normalizeNullableString(binding.channel) ??
    normalizeNullableString(conversation?.channel) ??
    normalizeNullableString(input.message.channel)
  const identityId =
    normalizeNullableString(binding.identityId) ??
    normalizeNullableString(conversation?.identityId)
  const actorId =
    normalizeNullableString(binding.actorId) ??
    normalizeNullableString(conversation?.participantId)
  const threadId =
    normalizeNullableString(input.message.threadId) ??
    normalizeNullableString(conversation?.threadId) ??
    normalizeNullableString(binding.threadId)
  const explicitTarget = normalizeNullableString(input.message.deliveryTarget)
  const replyToMessageId = normalizeNullableString(
    input.message.deliveryReplyToMessageId,
  )
  const reactionTargetMessageId =
    input.message.deliveryReactionTargetMessageId === undefined
      ? replyToMessageId
      : normalizeNullableString(input.message.deliveryReactionTargetMessageId)
  const threadIsDirect =
    typeof input.message.threadIsDirect === 'boolean'
      ? input.message.threadIsDirect
      : threadIsDirectFromConversationDirectness(conversation?.directness) ??
        binding.threadIsDirect
  const bindingDelivery = resolveConversationAudienceBindingDelivery({
    bindingDelivery: binding.delivery ?? null,
    channel,
    threadId,
    threadIsDirect,
  })

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
    reactionTargetMessageId,
    replyToMessageId,
    threadId,
    threadIsDirect,
  }
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

function resolveConversationAudienceBindingDelivery(input: {
  bindingDelivery: AssistantBindingDelivery | null
  channel: string | null
  threadId: string | null
  threadIsDirect: boolean | null
}): AssistantBindingDelivery | null {
  if (
    input.threadId &&
    input.threadIsDirect === true &&
    input.bindingDelivery?.kind === 'participant' &&
    isThreadFirstAssistantChannel(input.channel)
  ) {
    return {
      kind: 'thread',
      target: input.threadId,
    }
  }

  return input.bindingDelivery
}

function isThreadFirstAssistantChannel(channel: string | null): boolean {
  switch (channel) {
    case 'email':
    case 'linq':
    case 'telegram':
      return true
    default:
      return false
  }
}
