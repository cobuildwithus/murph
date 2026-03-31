import {
  assistantBindingDeliverySchema,
  assistantSessionBindingSchema,
  type AssistantBindingDelivery,
  type AssistantBindingDeliveryKind,
  type AssistantSession,
  type AssistantSessionBinding,
} from '../assistant-cli-contracts.js'
import { inferAssistantBindingDelivery } from './channel-adapters.js'
import {
  conversationDirectnessFromThreadIsDirect,
  type ConversationRef,
} from './conversation-ref.js'
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

export type AssistantBindingIsolationField =
  | 'actorId'
  | 'channel'
  | 'identityId'
  | 'threadId'
  | 'threadIsDirect'

export interface AssistantBindingIsolationConflict {
  current: string | boolean | null
  field: AssistantBindingIsolationField
  next: string | boolean | null
  reason: 'clear' | 'replace'
}

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
    : actorId && canUseActorScopedConversationKey(input)
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

export function getAssistantBindingIsolationConflicts(
  binding: Pick<
    AssistantSessionBinding,
    'actorId' | 'channel' | 'identityId' | 'threadId' | 'threadIsDirect'
  >,
  patch: AssistantBindingPatch,
): AssistantBindingIsolationConflict[] {
  const conflicts: AssistantBindingIsolationConflict[] = []

  for (const field of assistantBindingIsolationFields) {
    if (!(field in patch)) {
      continue
    }

    const current = readAssistantBindingIsolationValue(binding, field)
    const next = readAssistantBindingIsolationPatchValue(patch, field)

    if (current === null || current === next) {
      continue
    }

    conflicts.push({
      current,
      field,
      next,
      reason: next === null ? 'clear' : 'replace',
    })
  }

  return conflicts
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
  const hasExplicitDeliveryPatch =
    'deliveryKind' in patch || 'deliveryTarget' in patch
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

  if (
    !hasExplicitDeliveryPatch &&
    'threadId' in patch &&
    binding.delivery?.kind === 'thread'
  ) {
    if (next.threadId) {
      next.deliveryKind = 'thread'
      next.deliveryTarget = next.threadId
    } else {
      next.deliveryKind = null
      next.deliveryTarget = null
    }
  }

  if (
    !hasExplicitDeliveryPatch &&
    'actorId' in patch &&
    binding.delivery?.kind === 'participant' &&
    binding.delivery.target === binding.actorId
  ) {
    if (next.actorId) {
      next.deliveryKind = 'participant'
      next.deliveryTarget = next.actorId
    } else {
      next.deliveryKind = null
      next.deliveryTarget = null
    }
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
  return inferAssistantBindingDelivery({
    channel: input.channel,
    conversation: bindingConversationRef(input),
    deliveryKind: input.deliveryKind ?? null,
    deliveryTarget: input.deliveryTarget ?? null,
  })
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

function bindingConversationRef(input: {
  actorId?: string | null
  channel?: string | null
  identityId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
}): ConversationRef {
  return {
    channel: normalizeNullableString(input.channel),
    identityId: normalizeNullableString(input.identityId),
    participantId: normalizeNullableString(input.actorId),
    threadId: normalizeNullableString(input.threadId),
    directness: conversationDirectnessFromThreadIsDirect(input.threadIsDirect),
  }
}

const assistantBindingIsolationFields = [
  'channel',
  'identityId',
  'actorId',
  'threadId',
  'threadIsDirect',
] as const satisfies readonly AssistantBindingIsolationField[]

function canUseActorScopedConversationKey(
  input: Pick<AssistantBindingInput, 'threadIsDirect'>,
): boolean {
  return input.threadIsDirect !== false
}

function readAssistantBindingIsolationValue(
  binding: Pick<
    AssistantSessionBinding,
    'actorId' | 'channel' | 'identityId' | 'threadId' | 'threadIsDirect'
  >,
  field: AssistantBindingIsolationField,
): string | boolean | null {
  switch (field) {
    case 'actorId':
      return normalizeNullableString(binding.actorId)
    case 'channel':
      return normalizeNullableString(binding.channel)
    case 'identityId':
      return normalizeNullableString(binding.identityId)
    case 'threadId':
      return normalizeNullableString(binding.threadId)
    case 'threadIsDirect':
      return typeof binding.threadIsDirect === 'boolean'
        ? binding.threadIsDirect
        : null
  }
}

function readAssistantBindingIsolationPatchValue(
  patch: AssistantBindingPatch,
  field: AssistantBindingIsolationField,
): string | boolean | null {
  switch (field) {
    case 'actorId':
      return normalizeNullableString(patch.actorId)
    case 'channel':
      return normalizeNullableString(patch.channel)
    case 'identityId':
      return normalizeNullableString(patch.identityId)
    case 'threadId':
      return normalizeNullableString(patch.threadId)
    case 'threadIsDirect':
      return typeof patch.threadIsDirect === 'boolean' ? patch.threadIsDirect : null
  }
}
