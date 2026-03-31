import { normalizeNullableString } from '../text/shared.js'
import {
  gatewayConversationDirectnessValues,
  gatewayConversationRouteSchema,
  type GatewayConversationDirectness,
  type GatewayConversationRoute,
  type GatewayReplyRouteKind,
} from './contracts.js'

export interface GatewayConversationRouteInput {
  channel?: string | null
  directness?: GatewayConversationDirectness | null
  identityId?: string | null
  participantId?: string | null
  reply?: {
    kind?: GatewayReplyRouteKind | null
    target?: string | null
  } | null
  threadId?: string | null
}

export interface GatewayInboundCaptureRouteInput {
  accountId?: string | null
  actor: {
    id?: string | null
  }
  source: string
  thread: {
    id: string
    isDirect?: boolean | null
  }
}

interface GatewayConversationRef {
  channel?: string | null
  directness?: GatewayConversationDirectness | null
  identityId?: string | null
  participantId?: string | null
  threadId?: string | null
}

interface GatewayBindingLike {
  actorId?: string | null
  channel?: string | null
  delivery?: {
    kind?: GatewayReplyRouteKind | null
    target?: string | null
  } | null
  identityId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
}

interface GatewayOutboxIntentLike {
  actorId?: string | null
  bindingDelivery?: {
    kind?: GatewayReplyRouteKind | null
    target?: string | null
  } | null
  channel?: string | null
  identityId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
}

export function normalizeGatewayConversationRoute(
  input: GatewayConversationRouteInput | null | undefined,
): GatewayConversationRoute {
  return gatewayConversationRouteSchema.parse({
    channel: normalizeNullableString(input?.channel),
    identityId: normalizeNullableString(input?.identityId),
    participantId: normalizeNullableString(input?.participantId),
    threadId: normalizeNullableString(input?.threadId),
    directness: normalizeGatewayConversationDirectness(input?.directness),
    reply: {
      kind: input?.reply?.kind ?? null,
      target: normalizeNullableString(input?.reply?.target),
    },
  })
}

export function gatewayConversationRouteFromBinding(
  binding: GatewayBindingLike,
): GatewayConversationRoute {
  const conversation = gatewayConversationRefFromBinding(binding)
  return gatewayConversationRouteFromConversationRef(conversation, {
    kind: binding.delivery?.kind ?? null,
    target: binding.delivery?.target ?? null,
  })
}

export function gatewayConversationRouteFromOutboxIntent(
  intent: GatewayOutboxIntentLike,
): GatewayConversationRoute {
  const conversation = gatewayConversationRefFromBinding({
    actorId: intent.actorId,
    channel: intent.channel,
    identityId: intent.identityId,
    threadId: intent.threadId,
    threadIsDirect: intent.threadIsDirect,
  })

  return gatewayConversationRouteFromConversationRef(conversation, {
    kind: intent.bindingDelivery?.kind ?? null,
    target: intent.bindingDelivery?.target ?? null,
  })
}

export function gatewayConversationRouteFromCapture(
  capture: GatewayInboundCaptureRouteInput,
): GatewayConversationRoute {
  const conversation = gatewayConversationRefFromCapture({
    accountId: capture.accountId ?? null,
    actorId: capture.actor.id ?? null,
    source: capture.source,
    threadId: capture.thread.id,
    threadIsDirect: capture.thread.isDirect ?? null,
  })

  return gatewayConversationRouteFromConversationRef(conversation)
}

export function mergeGatewayConversationRoutes(
  base: GatewayConversationRoute | null | undefined,
  patch: GatewayConversationRouteInput | null | undefined,
): GatewayConversationRoute {
  const merged = mergeGatewayConversationRefs(
    gatewayConversationRouteToConversationRef(base),
    gatewayConversationRouteToConversationRef(patch),
  )

  const reply = mergeGatewayReplyRoute(base?.reply, patch?.reply, merged)
  return gatewayConversationRouteFromConversationRef(merged, {
    kind: reply.kind,
    target: reply.target,
  })
}

export function resolveGatewayConversationRouteKey(
  route: GatewayConversationRoute | null | undefined,
): string | null {
  const normalized = normalizeGatewayConversationRoute(route)
  return resolveGatewayConversationKey({
    actorId: normalized.participantId,
    channel: normalized.channel,
    identityId: normalized.identityId,
    threadId: normalized.threadId,
    threadIsDirect: threadIsDirectFromGatewayDirectness(normalized.directness),
  })
}

export function gatewayConversationRouteCanSend(
  route: GatewayConversationRoute | null | undefined,
): boolean {
  const normalized = normalizeGatewayConversationRoute(route)
  const inferredDelivery = inferGatewayBindingDelivery({
    channel: normalized.channel,
    conversation: gatewayConversationRouteToConversationRef(normalized),
    deliveryKind: normalized.reply.kind,
    deliveryTarget: normalized.reply.target,
  })

  if (!normalized.channel || !inferredDelivery) {
    return false
  }

  if (normalized.channel === 'email' && !normalized.identityId) {
    return false
  }

  if (normalized.channel === 'linq' && inferredDelivery.kind !== 'thread') {
    return false
  }

  return true
}

export function gatewayChannelSupportsReplyToMessage(
  channel: string | null | undefined,
): boolean {
  return normalizeNullableString(channel) === 'linq'
}

function inferGatewayBindingDelivery(input: {
  channel?: string | null
  conversation?: GatewayConversationRef | null
  deliveryKind?: 'participant' | 'thread' | null
  deliveryTarget?: string | null
}) {
  switch (input.channel) {
    case 'telegram':
    case 'email':
      return inferThreadFirstGatewayReply({
        conversation: input.conversation ?? {},
        deliveryKind: input.deliveryKind ?? null,
        deliveryTarget: input.deliveryTarget ?? null,
        includeParticipant: true,
      })
    case 'linq':
      return inferThreadFirstGatewayReply({
        conversation: input.conversation ?? {},
        deliveryKind: input.deliveryKind ?? null,
        deliveryTarget: input.deliveryTarget ?? null,
        includeParticipant: false,
      })
    default:
      return inferFallbackGatewayReply({
        conversation: input.conversation ?? {},
        deliveryKind: input.deliveryKind ?? null,
        deliveryTarget: input.deliveryTarget ?? null,
      })
  }
}

function gatewayConversationRouteFromConversationRef(
  conversation: GatewayConversationRef,
  reply?: {
    kind?: GatewayReplyRouteKind | null
    target?: string | null
  } | null,
): GatewayConversationRoute {
  return normalizeGatewayConversationRoute({
    channel: conversation.channel,
    identityId: conversation.identityId,
    participantId: conversation.participantId,
    threadId: conversation.threadId,
    directness: normalizeGatewayConversationDirectness(conversation.directness),
    reply: reply
      ? {
          kind: reply.kind ?? null,
          target: reply.target ?? null,
        }
      : null,
  })
}

function gatewayConversationRouteToConversationRef(
  input: GatewayConversationRouteInput | GatewayConversationRoute | null | undefined,
): GatewayConversationRef {
  return {
    channel: normalizeNullableString(input?.channel),
    identityId: normalizeNullableString(input?.identityId),
    participantId: normalizeNullableString(input?.participantId),
    threadId: normalizeNullableString(input?.threadId),
    directness: normalizeGatewayConversationDirectness(input?.directness),
  }
}

function gatewayConversationRefFromBinding(
  binding: Pick<
    GatewayBindingLike,
    'channel' | 'identityId' | 'actorId' | 'threadId' | 'threadIsDirect'
  >,
): GatewayConversationRef {
  return normalizeGatewayConversationRef({
    channel: binding.channel,
    identityId: binding.identityId,
    participantId: binding.actorId,
    threadId: binding.threadId,
    directness: gatewayConversationDirectnessFromThreadIsDirect(binding.threadIsDirect),
  })
}

function gatewayConversationRefFromCapture(input: {
  accountId?: string | null
  actorId?: string | null
  source?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
}): GatewayConversationRef {
  return normalizeGatewayConversationRef({
    channel: input.source,
    identityId:
      input.source === 'email' || input.source === 'linq' ? input.accountId : null,
    participantId: input.actorId,
    threadId: input.threadId,
    directness: gatewayConversationDirectnessFromThreadIsDirect(input.threadIsDirect),
  })
}

function normalizeGatewayConversationRef(
  input: GatewayConversationRef | null | undefined,
): GatewayConversationRef {
  if (!input) {
    return {}
  }

  return {
    channel: normalizeNullableString(input.channel),
    identityId: normalizeNullableString(input.identityId),
    participantId: normalizeNullableString(input.participantId),
    threadId: normalizeNullableString(input.threadId),
    directness: normalizeGatewayConversationDirectness(input.directness),
  }
}

function mergeGatewayConversationRefs(
  base: GatewayConversationRef | null | undefined,
  patch: GatewayConversationRef | null | undefined,
): GatewayConversationRef {
  const normalizedBase = normalizeGatewayConversationRef(base)
  const normalizedPatch = normalizeGatewayConversationRef(patch)

  return {
    channel: normalizedPatch.channel ?? normalizedBase.channel,
    identityId: normalizedPatch.identityId ?? normalizedBase.identityId,
    participantId: normalizedPatch.participantId ?? normalizedBase.participantId,
    threadId: normalizedPatch.threadId ?? normalizedBase.threadId,
    directness: normalizedPatch.directness ?? normalizedBase.directness,
  }
}

function mergeGatewayReplyRoute(
  base: GatewayConversationRoute['reply'] | null | undefined,
  patch: GatewayConversationRouteInput['reply'] | null | undefined,
  mergedConversation: GatewayConversationRef,
): {
  kind: GatewayReplyRouteKind | null
  target: string | null
} {
  const explicitKind =
    patch && 'kind' in patch ? patch.kind ?? null : base?.kind ?? null
  const explicitTarget =
    patch && 'target' in patch
      ? normalizeNullableString(patch.target)
      : normalizeNullableString(base?.target)

  if (patch && 'kind' in patch) {
    return {
      kind: explicitKind,
      target: explicitTarget,
    }
  }

  if (explicitKind === 'thread' && (!patch || !('target' in patch))) {
    return {
      kind: 'thread',
      target: mergedConversation.threadId ?? null,
    }
  }

  return {
    kind: explicitKind,
    target: explicitTarget,
  }
}

function resolveGatewayConversationKey(input: {
  actorId?: string | null
  channel?: string | null
  identityId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
}): string | null {
  const channel = normalizeNullableString(input.channel)
  const identityId = normalizeNullableString(input.identityId)
  const actorId = normalizeNullableString(input.actorId)
  const threadId = normalizeNullableString(input.threadId)

  if (!channel) {
    return null
  }

  const scope: [string, string] | null =
    input.threadIsDirect === true
      ? actorId
        ? ['actor', actorId]
        : threadId
          ? ['thread', threadId]
          : null
      : input.threadIsDirect === false
        ? threadId
          ? ['thread', threadId]
          : null
        : actorId
          ? ['actor', actorId]
          : threadId
            ? ['thread', threadId]
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

function normalizeGatewayConversationDirectness(
  value: GatewayConversationDirectness | string | null | undefined,
): GatewayConversationDirectness | null {
  const normalized = normalizeNullableString(value)
  return gatewayConversationDirectnessValues.includes(
    normalized as GatewayConversationDirectness,
  )
    ? (normalized as GatewayConversationDirectness)
    : null
}

function threadIsDirectFromGatewayDirectness(
  directness: GatewayConversationDirectness | null | undefined,
): boolean | null {
  switch (normalizeGatewayConversationDirectness(directness)) {
    case 'direct':
      return true
    case 'group':
      return false
    default:
      return null
  }
}

function gatewayConversationDirectnessFromThreadIsDirect(
  threadIsDirect: boolean | null | undefined,
): GatewayConversationDirectness | null {
  if (threadIsDirect === true) {
    return 'direct'
  }
  if (threadIsDirect === false) {
    return 'group'
  }
  return null
}

function inferThreadFirstGatewayReply(input: {
  conversation: GatewayConversationRef
  deliveryKind?: GatewayReplyRouteKind | null
  deliveryTarget?: string | null
  includeParticipant: boolean
}): { kind: GatewayReplyRouteKind; target: string } | null {
  const explicit = resolveExplicitGatewayReply(input)
  if (explicit) {
    return explicit
  }
  if (input.conversation.threadId) {
    return {
      kind: 'thread',
      target: input.conversation.threadId,
    }
  }
  if (input.includeParticipant && input.conversation.participantId) {
    return {
      kind: 'participant',
      target: input.conversation.participantId,
    }
  }
  return null
}

function inferFallbackGatewayReply(input: {
  conversation: GatewayConversationRef
  deliveryKind?: GatewayReplyRouteKind | null
  deliveryTarget?: string | null
}): { kind: GatewayReplyRouteKind; target: string } | null {
  const explicit = resolveExplicitGatewayReply(input)
  if (explicit) {
    return explicit
  }
  if (input.conversation.directness === 'group' && input.conversation.threadId) {
    return {
      kind: 'thread',
      target: input.conversation.threadId,
    }
  }
  if (input.conversation.participantId) {
    return {
      kind: 'participant',
      target: input.conversation.participantId,
    }
  }
  if (input.conversation.threadId) {
    return {
      kind: 'thread',
      target: input.conversation.threadId,
    }
  }
  return null
}

function resolveExplicitGatewayReply(input: {
  deliveryKind?: GatewayReplyRouteKind | null
  deliveryTarget?: string | null
}): { kind: GatewayReplyRouteKind; target: string } | null {
  const kind = input.deliveryKind ?? null
  const target = normalizeNullableString(input.deliveryTarget)
  if (!kind || !target) {
    return null
  }
  return { kind, target }
}
