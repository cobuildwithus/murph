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

export function resolveAssistantDeliveryRouteWithCurrentRoute(
  input: AssistantDeliveryRouteFields,
  currentRoute: AssistantCurrentDeliveryRoute | null | undefined,
): NormalizedAssistantDeliveryRouteFields {
  const normalizedCurrentRoute = normalizeAssistantCurrentDeliveryRoute(currentRoute)
  const channel = normalizeAssistantRouteString(input.channel)
    ?? normalizedCurrentRoute?.channel
    ?? null
  const explicitDeliveryTarget = normalizeAssistantRouteString(input.deliveryTarget)
  const deliveryTarget =
    explicitDeliveryTarget ??
    (channel && normalizedCurrentRoute?.channel === channel
      ? normalizedCurrentRoute.deliveryTarget
      : null)

  return {
    channel,
    deliveryTarget,
    identityId: normalizeAssistantRouteString(input.identityId),
    participantId: normalizeAssistantRouteString(input.participantId),
    threadId: normalizeAssistantRouteString(input.threadId),
  }
}

function normalizeAssistantCurrentDeliveryRoute(
  currentRoute: AssistantCurrentDeliveryRoute | null | undefined,
): AssistantCurrentDeliveryRoute | null {
  const channel = normalizeAssistantRouteString(currentRoute?.channel)
  const deliveryTarget = normalizeAssistantRouteString(currentRoute?.deliveryTarget)
  if (!channel || !deliveryTarget) {
    return null
  }
  return {
    channel,
    deliveryTarget,
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
