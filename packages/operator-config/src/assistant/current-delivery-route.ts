import {
  HOSTED_EMAIL_THREAD_TARGET_PREFIX,
  parseHostedEmailThreadTarget,
} from '@murphai/runtime-state'

export interface AssistantDeliveryRouteFields {
  channel?: string | null
  deliveryTarget?: string | null
  identityId?: string | null
  participantId?: string | null
  threadId?: string | null
}

export interface AssistantAutomationRouteFields extends AssistantDeliveryRouteFields {
  deliverySource?: { kind?: string | null } | null
}

export interface AssistantAutomationRouteDeliverabilityIssue {
  code:
    | 'channel_required'
    | 'email_delivery_target_required'
    | 'email_hosted_thread_target_invalid'
    | 'email_hosted_thread_target_recipient_required'
    | 'email_identity_required'
    | 'email_private_delivery_target'
    | 'linq_delivery_target_required'
    | 'linq_private_participant'
    | 'linq_private_delivery_target'
    | 'route_required'
  message: string
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

export type AssistantAutomationRouteValidationProfile = 'hosted' | 'local'

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

export function getAssistantAutomationRouteDeliverabilityIssue(
  input: AssistantAutomationRouteFields,
  profile: AssistantAutomationRouteValidationProfile = 'local',
): AssistantAutomationRouteDeliverabilityIssue | null {
  const channel = normalizeAssistantRouteString(input.channel)
  const deliveryTarget = normalizeAssistantRouteString(input.deliveryTarget)
  const identityId = normalizeAssistantRouteString(input.identityId)
  const participantId = normalizeAssistantRouteString(input.participantId)
  const threadId = normalizeAssistantRouteString(input.threadId)
  const deliverySourceKind =
    typeof input.deliverySource?.kind === 'string'
      ? input.deliverySource.kind
      : null

  if (!channel) {
    return {
      code: 'channel_required',
      message:
        'Automation routes require an explicit channel. Pass --channel with --delivery-target, --thread-id, or --participant-id.',
    }
  }

  if (channel === 'linq') {
    const hasParticipantSource =
      Boolean(participantId) &&
      deliverySourceKind === 'linq' &&
      !looksLikePrivateAssistantRoutePlaceholder(participantId)
    const hasThreadDelivery =
      Boolean(threadId) &&
      !looksLikePrivateAssistantRoutePlaceholder(threadId)
    if (
      !deliveryTarget &&
      participantId &&
      deliverySourceKind === 'linq' &&
      looksLikePrivateAssistantRoutePlaceholder(participantId)
    ) {
      return {
        code: 'linq_private_participant',
        message:
          'iMessage automation routes cannot use redacted conversation placeholders as participant routes.',
      }
    }

    if (!deliveryTarget && !hasParticipantSource && !hasThreadDelivery) {
      return {
        code: 'linq_delivery_target_required',
        message:
          'iMessage automation routes require an explicit delivery target or a participant route with a delivery source.',
      }
    }

    if (looksLikePrivateAssistantRoutePlaceholder(deliveryTarget)) {
      return {
        code: 'linq_private_delivery_target',
        message:
          'iMessage automation routes cannot use redacted conversation placeholders as delivery targets.',
      }
    }
    return null
  }

  if (channel === 'email') {
    const isHostedProfile = profile === 'hosted'
    const hasUsableEmailIdentity =
      Boolean(identityId) &&
      !looksLikePrivateAssistantRoutePlaceholder(identityId)
    const hostedEmailThreadTarget = deliveryTarget?.startsWith(
      HOSTED_EMAIL_THREAD_TARGET_PREFIX,
    )
      ? parseHostedEmailThreadTarget(deliveryTarget)
      : null

    if (
      deliveryTarget &&
      looksLikePrivateAssistantRoutePlaceholder(deliveryTarget)
    ) {
      return {
        code: 'email_private_delivery_target',
        message:
          'Email automation routes cannot use redacted conversation placeholders as delivery targets.',
      }
    }

    if (
      deliveryTarget?.startsWith(HOSTED_EMAIL_THREAD_TARGET_PREFIX) &&
      hostedEmailThreadTarget === null
    ) {
      return {
        code: 'email_hosted_thread_target_invalid',
        message:
          'Email automation routes cannot use malformed hosted email thread targets.',
      }
    }

    if (hostedEmailThreadTarget && !hostedEmailThreadTarget.to[0]) {
      return {
        code: 'email_hosted_thread_target_recipient_required',
        message:
          'Email automation routes cannot use hosted email thread targets without a recipient.',
      }
    }

    if (
      deliveryTarget &&
      !hasUsableEmailIdentity &&
      !isHostedProfile
    ) {
      return {
        code: 'email_identity_required',
        message:
          'Email automation routes require a sender identity for explicit email delivery targets.',
      }
    }

    const hasLocalBindingDeliveryRoute =
      !isHostedProfile &&
      hasUsableEmailIdentity &&
      (
        (
          Boolean(threadId) &&
          !looksLikePrivateAssistantRoutePlaceholder(threadId)
        ) ||
        (
          Boolean(participantId) &&
          !looksLikePrivateAssistantRoutePlaceholder(participantId)
        )
      )
    if (!deliveryTarget && !hasLocalBindingDeliveryRoute) {
      return {
        code: 'email_delivery_target_required',
        message:
          'Email automation routes require an explicit delivery target. Pass --delivery-target with a recipient address or hosted email thread target; thread and participant locators alone are local continuity metadata.',
      }
    }
    return null
  }

  if (!deliveryTarget && !participantId && !threadId) {
    return {
      code: 'route_required',
      message:
        'Automation routes require an explicit delivery target. Pass --delivery-target, --thread-id, or --participant-id for the selected channel.',
    }
  }

  return null
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
