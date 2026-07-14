import {
  gatewayConversationDirectnessValues,
  type GatewayConversationDirectness,
  type GatewayReplyRouteKind,
} from './contracts.ts'
import { normalizeNullableString } from './shared.ts'

export interface GatewayReplyRouteContext {
  directness?: GatewayConversationDirectness | null
  participantId?: string | null
  threadId?: string | null
}

export interface GatewayResolvedReplyRoute {
  kind: GatewayReplyRouteKind
  target: string
}

export interface GatewayExplicitReplyRouteInput {
  deliveryKind?: GatewayReplyRouteKind | null
  deliveryTarget?: string | null
}

export interface GatewayReplyRouteInferenceInput extends GatewayExplicitReplyRouteInput {
  conversation?: GatewayReplyRouteContext | null
}

export interface GatewayThreadFirstReplyRouteInferenceInput
  extends GatewayReplyRouteInferenceInput {
  includeParticipant: boolean
}

export interface GatewayChannelReplyRouteInferenceInput
  extends GatewayReplyRouteInferenceInput {
  channel?: string | null
}

export function normalizeGatewayConversationDirectness(
  value: GatewayConversationDirectness | string | null | undefined,
): GatewayConversationDirectness | null {
  const normalized = normalizeNullableString(value)
  return gatewayConversationDirectnessValues.includes(
    normalized as GatewayConversationDirectness,
  )
    ? (normalized as GatewayConversationDirectness)
    : null
}

export function resolveExplicitGatewayReplyRoute(
  input: GatewayExplicitReplyRouteInput,
): GatewayResolvedReplyRoute | null {
  const kind = input.deliveryKind ?? null
  const target = normalizeNullableString(input.deliveryTarget)
  if (!kind || !target) {
    return null
  }

  return {
    kind,
    target,
  }
}

export function inferThreadFirstGatewayReplyRoute(
  input: GatewayThreadFirstReplyRouteInferenceInput,
): GatewayResolvedReplyRoute | null {
  const explicit = resolveExplicitGatewayReplyRoute(input)
  if (explicit) {
    return explicit
  }

  const conversation = normalizeGatewayReplyRouteContext(input.conversation)
  if (input.deliveryKind === 'thread' && conversation.threadId) {
    return {
      kind: 'thread',
      target: conversation.threadId,
    }
  }

  if (input.deliveryKind === 'participant' && conversation.participantId) {
    return {
      kind: 'participant',
      target: conversation.participantId,
    }
  }

  if (conversation.threadId) {
    return {
      kind: 'thread',
      target: conversation.threadId,
    }
  }

  if (input.includeParticipant && conversation.participantId) {
    return {
      kind: 'participant',
      target: conversation.participantId,
    }
  }

  return null
}

export function inferFallbackGatewayReplyRoute(
  input: GatewayReplyRouteInferenceInput,
): GatewayResolvedReplyRoute | null {
  const explicit = resolveExplicitGatewayReplyRoute(input)
  if (explicit) {
    return explicit
  }

  const conversation = normalizeGatewayReplyRouteContext(input.conversation)
  if (conversation.directness === 'group' && conversation.threadId) {
    return {
      kind: 'thread',
      target: conversation.threadId,
    }
  }

  if (conversation.participantId) {
    return {
      kind: 'participant',
      target: conversation.participantId,
    }
  }

  if (conversation.threadId) {
    return {
      kind: 'thread',
      target: conversation.threadId,
    }
  }

  return null
}

export function inferGatewayReplyRouteForChannel(
  input: GatewayChannelReplyRouteInferenceInput,
): GatewayResolvedReplyRoute | null {
  switch (normalizeNullableString(input.channel)) {
    case 'telegram':
    case 'email':
      return inferThreadFirstGatewayReplyRoute({
        conversation: input.conversation ?? {},
        deliveryKind: input.deliveryKind ?? null,
        deliveryTarget: input.deliveryTarget ?? null,
        includeParticipant: true,
      })
    case 'linq':
      return inferLinqGatewayReplyRoute({
        conversation: input.conversation ?? {},
        deliveryKind: input.deliveryKind ?? null,
        deliveryTarget: input.deliveryTarget ?? null,
      })
    default:
      return inferFallbackGatewayReplyRoute({
        conversation: input.conversation ?? {},
        deliveryKind: input.deliveryKind ?? null,
        deliveryTarget: input.deliveryTarget ?? null,
      })
  }
}

function inferLinqGatewayReplyRoute(
  input: GatewayReplyRouteInferenceInput,
): GatewayResolvedReplyRoute | null {
  const explicit = resolveExplicitGatewayReplyRoute(input)
  if (explicit) {
    return explicit
  }

  const conversation = normalizeGatewayReplyRouteContext(input.conversation)
  if (input.deliveryKind === 'participant' && conversation.participantId) {
    return {
      kind: 'participant',
      target: conversation.participantId,
    }
  }

  if (conversation.threadId) {
    return {
      kind: 'thread',
      target: conversation.threadId,
    }
  }

  return null
}

function normalizeGatewayReplyRouteContext(
  input: GatewayReplyRouteContext | null | undefined,
): GatewayReplyRouteContext {
  if (!input) {
    return {}
  }

  return {
    directness: normalizeGatewayConversationDirectness(input.directness),
    participantId: normalizeNullableString(input.participantId),
    threadId: normalizeNullableString(input.threadId),
  }
}
