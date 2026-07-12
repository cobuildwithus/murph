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
  replyToMessageId: string | null
  threadId: string | null
  threadIsDirect: boolean | null
}

export interface AssistantConversationPolicy {
  audience: AssistantConversationAudience
  operatorAuthority: AssistantOperatorAuthority
}

export type AssistantConversationScope =
  | 'direct'
  | 'group'
  | 'unverified-external'

export function resolveAssistantConversationScope(
  audience: AssistantConversationAudience,
): AssistantConversationScope {
  if (audience.effectiveThreadIsDirect === false) {
    return 'group'
  }

  const localPrivateAudience =
    audience.effectiveThreadIsDirect === null &&
    audience.bindingDelivery === null &&
    audience.channel === null &&
    audience.explicitTarget === null &&
    audience.threadId === null

  return audience.effectiveThreadIsDirect === true || localPrivateAudience
    ? 'direct'
    : 'unverified-external'
}

export function resolveAssistantConversationPolicy(input: {
  message: Pick<
    AssistantMessageInput,
    | 'bindingDeliveryTarget'
    | 'conversation'
    | 'channel'
    | 'deliverResponse'
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
    | 'bindingDeliveryTarget'
    | 'conversation'
    | 'channel'
    | 'deliverResponse'
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
  const messageBindingDeliveryTarget = normalizeNullableString(
    input.message.bindingDeliveryTarget,
  )
  const replyToMessageId = normalizeNullableString(
    input.message.deliveryReplyToMessageId,
  )
  const messageThreadIsDirect =
    typeof input.message.threadIsDirect === 'boolean'
      ? input.message.threadIsDirect
      : threadIsDirectFromConversationDirectness(conversation?.directness)
  const threadIsDirect = messageThreadIsDirect ?? binding.threadIsDirect
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
      messageBindingDeliveryTarget,
      explicitTarget,
      sessionThreadId: normalizeNullableString(binding.threadId),
      threadId,
      threadIsDirect: messageThreadIsDirect,
      storedThreadIsDirect: binding.threadIsDirect,
    }),
    explicitTarget,
    identityId,
    replyToMessageId,
    threadId,
    threadIsDirect,
  }
}

function resolveAssistantConversationAudienceDirectness(input: {
  actorId: string | null
  bindingDelivery: AssistantBindingDelivery | null
  messageBindingDeliveryTarget: string | null
  explicitTarget: string | null
  sessionThreadId: string | null
  storedThreadIsDirect: boolean | null
  threadId: string | null
  threadIsDirect: boolean | null | undefined
}): boolean | null {
  if (
    input.explicitTarget !== null &&
    input.explicitTarget === input.messageBindingDeliveryTarget &&
    typeof input.threadIsDirect === 'boolean'
  ) {
    return input.threadIsDirect
  }

  const explicitTargetDirectness = inferDirectAudienceFromTarget({
    actorId: input.actorId,
    bindingDelivery: input.bindingDelivery,
    target: input.explicitTarget,
    threadId: input.threadId,
    // Fresh directness is authoritative for an explicit destination only
    // when that raw destination matched the binding target above. Fallback
    // inference may still use independently bound actor/participant identity
    // or stored directness tied to the same stored thread.
    threadIsDirect: null,
    storedThreadId: input.sessionThreadId,
    storedThreadIsDirect: input.storedThreadIsDirect,
  })
  if (explicitTargetDirectness !== null) {
    return explicitTargetDirectness
  }
  if (input.explicitTarget !== null) {
    return null
  }
  if (typeof input.threadIsDirect === 'boolean') {
    return input.threadIsDirect
  }

  const bindingTargetDirectness = inferDirectAudienceFromTarget({
    actorId: input.actorId,
    bindingDelivery: input.bindingDelivery,
    target: normalizeNullableString(input.bindingDelivery?.target),
    threadId: input.threadId,
    threadIsDirect: input.threadIsDirect ?? null,
    storedThreadId: input.sessionThreadId,
    storedThreadIsDirect: input.storedThreadIsDirect,
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
  storedThreadId: string | null
  storedThreadIsDirect: boolean | null
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
    return input.threadIsDirect ??
      (input.threadId === input.storedThreadId
        ? input.storedThreadIsDirect
        : null)
  }

  if (input.storedThreadId && target === input.storedThreadId) {
    return input.storedThreadIsDirect
  }

  if (input.bindingDelivery?.kind === 'thread' && bindingDeliveryTarget === target) {
    return input.storedThreadIsDirect
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
