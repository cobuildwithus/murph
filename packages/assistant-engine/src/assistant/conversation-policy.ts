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
  if (audience.threadIsDirect === false) {
    return 'group'
  }

  const localPrivateAudience =
    audience.threadIsDirect === null &&
    audience.bindingDelivery === null &&
    audience.channel === null &&
    audience.explicitTarget === null &&
    audience.threadId === null

  return audience.threadIsDirect === true || localPrivateAudience
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
  const threadIsDirect = resolveAssistantConversationAudienceDirectness({
    binding,
    explicitTarget,
    messageBindingDeliveryTarget,
    messageThreadIsDirect,
  })
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
    explicitTarget,
    identityId,
    replyToMessageId,
    threadId,
    threadIsDirect,
  }
}

// Audience belongs to a destination, not an actor or a delivery-kind guess.
function resolveAssistantConversationAudienceDirectness(input: {
  binding: AssistantSession['binding']
  explicitTarget: string | null
  messageBindingDeliveryTarget: string | null
  messageThreadIsDirect: boolean | null
}): boolean | null {
  if (
    (input.explicitTarget === null || input.explicitTarget === input.messageBindingDeliveryTarget)
    && input.messageThreadIsDirect !== null
  ) {
    return input.messageThreadIsDirect
  }
  if (
    input.explicitTarget === null
    || input.explicitTarget === normalizeNullableString(input.binding.delivery?.target)
    || input.explicitTarget === normalizeNullableString(input.binding.threadId)
  ) {
    return input.binding.threadIsDirect
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
