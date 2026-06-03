export const ASSISTANT_CURRENT_DELIVERY_ROUTE_CHANNEL_ENV =
  'MURPH_ASSISTANT_CURRENT_DELIVERY_ROUTE_CHANNEL'
export const ASSISTANT_CURRENT_DELIVERY_ROUTE_TARGET_ENV =
  'MURPH_ASSISTANT_CURRENT_DELIVERY_ROUTE_TARGET'

export interface AssistantDeliveryRouteFields {
  channel?: string | null
  deliveryTarget?: string | null
  identityId?: string | null
  participantId?: string | null
  threadId?: string | null
}

export interface NormalizedAssistantDeliveryRouteFields {
  channel: string | null
  deliveryTarget: string | null
  identityId: string | null
  participantId: string | null
  threadId: string | null
}

export interface AssistantCurrentDeliveryRoute {
  channel: string
  deliveryTarget: string
}

export function createAssistantCurrentDeliveryRouteEnv(
  input: AssistantDeliveryRouteFields,
): NodeJS.ProcessEnv {
  const channel = normalizeAssistantRouteString(input.channel)
  const deliveryTarget = normalizeAssistantRouteString(input.deliveryTarget)

  if (!channel || !deliveryTarget) {
    return {}
  }

  return {
    [ASSISTANT_CURRENT_DELIVERY_ROUTE_CHANNEL_ENV]: channel,
    [ASSISTANT_CURRENT_DELIVERY_ROUTE_TARGET_ENV]: deliveryTarget,
  }
}

export function readAssistantCurrentDeliveryRouteEnv(
  env: NodeJS.ProcessEnv = process.env,
): AssistantCurrentDeliveryRoute | null {
  const channel = normalizeAssistantRouteString(
    env[ASSISTANT_CURRENT_DELIVERY_ROUTE_CHANNEL_ENV],
  )
  const deliveryTarget = normalizeAssistantRouteString(
    env[ASSISTANT_CURRENT_DELIVERY_ROUTE_TARGET_ENV],
  )

  if (!channel || !deliveryTarget) {
    return null
  }

  return {
    channel,
    deliveryTarget,
  }
}

export function resolveAssistantDeliveryRouteWithCurrentDefaults(
  input: AssistantDeliveryRouteFields,
  env: NodeJS.ProcessEnv = process.env,
): NormalizedAssistantDeliveryRouteFields {
  const currentRoute = readAssistantCurrentDeliveryRouteEnv(env)
  const channel = normalizeAssistantRouteString(input.channel)
  const explicitDeliveryTarget = normalizeAssistantRouteString(input.deliveryTarget)
  const deliveryTarget =
    explicitDeliveryTarget ??
    (channel && currentRoute?.channel === channel
      ? currentRoute.deliveryTarget
      : null)

  return {
    channel,
    deliveryTarget,
    identityId: normalizeAssistantRouteString(input.identityId),
    participantId: normalizeAssistantRouteString(input.participantId),
    threadId: normalizeAssistantRouteString(input.threadId),
  }
}

export function stripPrivateAssistantRoutePlaceholders(
  input: NormalizedAssistantDeliveryRouteFields,
): NormalizedAssistantDeliveryRouteFields {
  if (input.channel !== 'linq' || !input.deliveryTarget) {
    return input
  }

  return {
    ...input,
    participantId: looksLikePrivateAssistantRoutePlaceholder(input.participantId)
      ? null
      : input.participantId,
    threadId: looksLikePrivateAssistantRoutePlaceholder(input.threadId)
      ? null
      : input.threadId,
  }
}

export function looksLikePrivateAssistantRoutePlaceholder(
  value: string | null | undefined,
): boolean {
  const target = normalizeAssistantRouteString(value)
  return (
    target !== null &&
    (/^h1_[a-f0-9]{24}$/iu.test(target) ||
      /(?:^|:)hid_[A-Za-z0-9_-]+/u.test(target) ||
      /(?:^|:)ain_[A-Za-z0-9_-]+/u.test(target) ||
      target.includes('hbid:') ||
      target.includes('hbidx:') ||
      target.startsWith('[redacted'))
  )
}

function normalizeAssistantRouteString(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : null
}
