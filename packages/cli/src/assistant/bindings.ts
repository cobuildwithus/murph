import {
  assistantBindingDeliverySchema,
  assistantSessionBindingSchema,
  type AssistantBindingDelivery,
  type AssistantBindingDeliveryKind,
  type AssistantSession,
  type AssistantSessionBinding,
} from '../assistant-cli-contracts.js'
import { normalizeNullableString } from './shared.js'

export interface AssistantBindingInput {
  actorId?: string | null
  channel?: string | null
  deliveryKind?: AssistantBindingDeliveryKind | null
  deliveryTarget?: string | null
  identityId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
}

export interface AssistantBindingPatch extends AssistantBindingInput {}

export function resolveAssistantConversationKey(
  input: AssistantBindingInput,
): string | null {
  const channel = normalizeNullableString(input.channel)
  const identityId = normalizeNullableString(input.identityId)
  const actorId = normalizeNullableString(input.actorId)
  const threadId = normalizeNullableString(input.threadId)

  if (!channel) {
    return null
  }

  const scope: [string, string] | null = threadId
    ? ['thread', threadId]
    : actorId
      ? ['actor', actorId]
      : null

  if (!scope) {
    return null
  }

  const entries = [
    ['channel', channel],
    ['identity', identityId],
    scope,
  ].filter((entry): entry is [string, string] => entry[1] !== null)

  return entries
    .map(([key, value]) => `${key}:${encodeURIComponent(value)}`)
    .join('|')
}

export function createAssistantBinding(
  input: AssistantBindingInput,
): AssistantSessionBinding {
  const actorId = normalizeNullableString(input.actorId)
  const channel = normalizeNullableString(input.channel)
  const identityId = normalizeNullableString(input.identityId)
  const threadId = normalizeNullableString(input.threadId)
  const threadIsDirect =
    typeof input.threadIsDirect === 'boolean' ? input.threadIsDirect : null
  const delivery = resolveAssistantBindingDelivery({
    actorId,
    channel,
    threadId,
    threadIsDirect,
    deliveryKind: input.deliveryKind ?? null,
    deliveryTarget: input.deliveryTarget ?? null,
  })

  return assistantSessionBindingSchema.parse({
    conversationKey: resolveAssistantConversationKey({
      actorId,
      channel,
      identityId,
      threadId,
      threadIsDirect,
    }),
    channel,
    identityId,
    actorId,
    threadId,
    threadIsDirect,
    delivery,
  })
}

export function mergeAssistantBinding(
  binding: AssistantSessionBinding,
  patch: AssistantBindingPatch,
): AssistantSessionBinding {
  const next = {
    actorId: binding.actorId,
    channel: binding.channel,
    identityId: binding.identityId,
    threadId: binding.threadId,
    threadIsDirect: binding.threadIsDirect,
    deliveryKind: binding.delivery?.kind ?? null,
    deliveryTarget: binding.delivery?.target ?? null,
  }

  if ('actorId' in patch) {
    next.actorId = normalizeNullableString(patch.actorId)
  }
  if ('channel' in patch) {
    next.channel = normalizeNullableString(patch.channel)
  }
  if ('identityId' in patch) {
    next.identityId = normalizeNullableString(patch.identityId)
  }
  if ('threadId' in patch) {
    next.threadId = normalizeNullableString(patch.threadId)
  }
  if ('threadIsDirect' in patch) {
    next.threadIsDirect =
      typeof patch.threadIsDirect === 'boolean' ? patch.threadIsDirect : null
  }
  if ('deliveryKind' in patch) {
    next.deliveryKind = patch.deliveryKind ?? null
  }
  if ('deliveryTarget' in patch) {
    next.deliveryTarget = normalizeNullableString(patch.deliveryTarget)
  }

  return createAssistantBinding(next)
}

export function resolveAssistantBindingDelivery(input: {
  actorId?: string | null
  channel?: string | null
  deliveryKind?: AssistantBindingDeliveryKind | null
  deliveryTarget?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
}): AssistantBindingDelivery | null {
  const explicitKind = input.deliveryKind ?? null
  const explicitTarget = normalizeNullableString(input.deliveryTarget)
  if (explicitKind && explicitTarget) {
    return assistantBindingDeliverySchema.parse({
      kind: explicitKind,
      target: explicitTarget,
    })
  }

  const actorId = normalizeNullableString(input.actorId)
  const channel = normalizeNullableString(input.channel)
  const threadId = normalizeNullableString(input.threadId)
  const threadIsDirect =
    typeof input.threadIsDirect === 'boolean' ? input.threadIsDirect : null

  if (channel === 'telegram' && threadId) {
    return assistantBindingDeliverySchema.parse({
      kind: 'thread',
      target: threadId,
    })
  }

  if (threadIsDirect === false && threadId) {
    return assistantBindingDeliverySchema.parse({
      kind: 'thread',
      target: threadId,
    })
  }

  if (actorId) {
    return assistantBindingDeliverySchema.parse({
      kind: 'participant',
      target: actorId,
    })
  }

  if (threadId) {
    return assistantBindingDeliverySchema.parse({
      kind: 'thread',
      target: threadId,
    })
  }

  return null
}

export function getAssistantBindingContextLines(
  binding: AssistantSessionBinding,
): string[] {
  return [
    binding.channel ? `channel: ${binding.channel}` : null,
    binding.identityId ? `identity: ${binding.identityId}` : null,
    binding.actorId ? `actor: ${binding.actorId}` : null,
    binding.threadId ? `thread: ${binding.threadId}` : null,
    binding.threadIsDirect !== null
      ? `thread is direct: ${String(binding.threadIsDirect)}`
      : null,
    binding.delivery
      ? `delivery: ${binding.delivery.kind} -> ${binding.delivery.target}`
      : null,
  ].filter((line): line is string => Boolean(line))
}

export function getAssistantDisplayTarget(
  session: Pick<AssistantSession, 'binding'>,
): string | null {
  return session.binding.delivery?.target ?? null
}
