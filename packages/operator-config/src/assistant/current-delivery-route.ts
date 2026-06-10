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
  identityId?: string | null
  participantId?: string | null
  threadId?: string | null
}

export function resolveAssistantDeliveryRouteWithCurrentRoute(
  input: AssistantDeliveryRouteFields,
  currentRoute: AssistantCurrentDeliveryRoute | null | undefined,
): NormalizedAssistantDeliveryRouteFields {
  const normalizedCurrentRoute = normalizeAssistantCurrentDeliveryRoute(currentRoute)
  const explicit: NormalizedAssistantDeliveryRouteFields = {
    channel: normalizeAssistantRouteString(input.channel)
      ?? normalizedCurrentRoute?.channel
      ?? null,
    deliveryTarget: normalizeAssistantRouteString(input.deliveryTarget),
    identityId: normalizeAssistantRouteString(input.identityId),
    participantId: normalizeAssistantRouteString(input.participantId),
    threadId: normalizeAssistantRouteString(input.threadId),
  }
  if (
    normalizedCurrentRoute === null ||
    explicit.channel === null ||
    normalizedCurrentRoute.channel !== explicit.channel
  ) {
    return explicit
  }
  // The target and locator fields together describe one conversation, so the
  // current route is inherited atomically: mixing explicit and inherited
  // fields would fabricate a route that never existed.
  if (
    explicit.deliveryTarget === null &&
    explicit.identityId === null &&
    explicit.participantId === null &&
    explicit.threadId === null
  ) {
    return normalizedCurrentRoute
  }
  // An explicit delivery target naming the current conversation (channel +
  // delivery target identify one conversation) inherits its missing locators,
  // so the saved route can resolve that conversation's session later.
  if (explicit.deliveryTarget !== normalizedCurrentRoute.deliveryTarget) {
    return explicit
  }
  return {
    channel: explicit.channel,
    deliveryTarget: explicit.deliveryTarget,
    identityId: explicit.identityId ?? normalizedCurrentRoute.identityId,
    participantId: explicit.participantId ?? normalizedCurrentRoute.participantId,
    threadId: explicit.threadId ?? normalizedCurrentRoute.threadId,
  }
}

function normalizeAssistantCurrentDeliveryRoute(
  currentRoute: AssistantCurrentDeliveryRoute | null | undefined,
): NormalizedAssistantDeliveryRouteFields | null {
  const channel = normalizeAssistantRouteString(currentRoute?.channel)
  const deliveryTarget = normalizeAssistantRouteString(currentRoute?.deliveryTarget)
  if (!channel || !deliveryTarget) {
    return null
  }
  return {
    channel,
    deliveryTarget,
    identityId: normalizeAssistantRouteString(currentRoute?.identityId),
    participantId: normalizeAssistantRouteString(currentRoute?.participantId),
    threadId: normalizeAssistantRouteString(currentRoute?.threadId),
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
    identityId: looksLikeRedactedAssistantRoutePlaceholder(input.identityId)
      ? null
      : input.identityId,
    participantId: looksLikeRedactedAssistantRoutePlaceholder(input.participantId)
      ? null
      : input.participantId,
    threadId: looksLikeRedactedAssistantRoutePlaceholder(input.threadId)
      ? null
      : input.threadId,
  }
}

function looksLikeRedactedAssistantRoutePlaceholder(
  value: string | null | undefined,
): boolean {
  const target = normalizeAssistantRouteString(value)
  return (
    target !== null &&
    (/(?:^|:)hid_[A-Za-z0-9_-]+/u.test(target) ||
      /(?:^|:)ain_[A-Za-z0-9_-]+/u.test(target) ||
      target.includes('hbid:') ||
      target.includes('hbidx:') ||
      target.startsWith('[redacted'))
  )
}

export function looksLikePrivateAssistantRoutePlaceholder(
  value: string | null | undefined,
): boolean {
  const target = normalizeAssistantRouteString(value)
  return (
    (target !== null && /^h1_[a-f0-9]{24}$/iu.test(target)) ||
    looksLikeRedactedAssistantRoutePlaceholder(value)
  )
}

export function normalizeAssistantRouteString(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : null
}
