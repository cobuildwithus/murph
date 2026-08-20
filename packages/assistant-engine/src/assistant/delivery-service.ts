import type {
  AssistantResponseMedia,
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import type {
  AssistantResponseCard,
} from '@murphai/operator-config/assistant-response-cards'
import {
  parseTelegramThreadTarget,
} from '@murphai/messaging-ingress/telegram-webhook'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { shouldCreateAssistantProgressDelivery } from './progress-constants.js'
import { markAssistantFirstContactSeen } from './first-contact.js'
import { createHostedDeliveryId } from './hosted-delivery-id.js'
import {
  type AssistantOutboxDispatchMessage,
  deliverAssistantOutboxReaction,
  normalizeAssistantDeliveryError,
  sendAssistantOutboxDispatchMessage,
} from './outbox.js'
import type { AssistantChannelDependencies } from './channel-adapters.js'
import {
  getAssistantChannelAdapter,
} from './channel-adapters.js'
import { resolveAssistantBindingDelivery } from './bindings.js'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import type {
  AssistantDeliveryOutcome,
  AssistantMessageInput,
  AssistantTurnDeliveryFinalizationPlan,
  AssistantTurnSharedPlan,
} from './service-contracts.js'
import type {
  AssistantMessageReaction,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  normalizeNullableString,
  warnAssistantBestEffortFailure,
} from './shared.js'
import {
  normalizeAssistantResponseMediaList,
} from './response-media.js'
import {
  applyAssistantReplyDeliveryContext,
  type AssistantReplyDeliveryContext,
} from './reply-delivery-context.js'
import {
  assistantChannelSupportsReplyBubbles,
  splitAssistantReplyBubbles,
} from './reply-bubbles.js'

export interface AssistantPrecedingReplySegment {
  deliveryContextOrdinal?: number
  deliveryContext?: AssistantReplyDeliveryContext | null
  media?: readonly AssistantResponseMedia[] | null
  response: string
  transcriptResponse?: string | null
  targetInputId?: string | null
}

export type { AssistantReplyDeliveryContext }

export function resolveHostedAssistantDeliveryTransportIdempotentOverride(input: {
  channel?: string | null
  deliveryIdempotencyKey?: string | null
  executionContext?: AssistantMessageInput['executionContext']
  media?: readonly AssistantResponseMedia[] | null
}): boolean | undefined {
  if (!input.executionContext?.hosted) {
    return undefined
  }
  if (input.media?.some((item) => item.kind === 'voice_memo')) {
    return false
  }
  if (!input.deliveryIdempotencyKey?.trim()) {
    return false
  }

  const channel = input.channel?.trim().toLowerCase()
  return channel === 'linq'
}

export function resolveAssistantHostedDeliveryIdempotency(input: {
  audience: AssistantTurnSharedPlan['conversationPolicy']['audience']
  channel: string | null
  deliveryFields: Pick<
    AssistantCurrentAudienceDeliveryFields,
    | 'actorId'
    | 'bindingDelivery'
    | 'explicitTarget'
    | 'identityId'
    | 'threadId'
    | 'threadIsDirect'
  >
  input: AssistantMessageInput
  media?: readonly AssistantResponseMedia[] | null
  session: AssistantSession
}): {
  deliveryIdempotencyKey: string | null
  deliveryTransportIdempotent: boolean | undefined
} {
  const explicitKey = normalizeNullableString(input.input.deliveryIdempotencyKey)
  const hosted = input.input.executionContext?.hosted ?? null
  const channel = normalizeNullableString(input.channel)?.toLowerCase() ?? null

  if (!hosted) {
    return {
      deliveryIdempotencyKey: explicitKey,
      deliveryTransportIdempotent: undefined,
    }
  }

  const deliveryIdempotencyKey =
    explicitKey ??
    createHostedDeliveryIdempotencyKeyFromContext({
      audience: input.audience,
      channel,
      deliveryFields: input.deliveryFields,
      input: input.input,
      memberId: hosted.memberId,
      session: input.session,
    })

  if (!deliveryIdempotencyKey && hostedDeliveryChannelRequiresIdempotencyKey(channel)) {
    throw new VaultCliError(
      'ASSISTANT_HOSTED_DELIVERY_IDEMPOTENCY_KEY_REQUIRED',
      'Hosted outbound delivery requires a deterministic idempotency key.',
    )
  }

  return {
    deliveryIdempotencyKey,
    deliveryTransportIdempotent:
      resolveHostedAssistantDeliveryTransportIdempotentOverride({
        channel,
        deliveryIdempotencyKey,
        executionContext: input.input.executionContext,
        media: input.media ?? [],
      }),
  }
}

export function dropUnsupportedAssistantResponseMediaForChannel(input: {
  channel?: string | null
  media: readonly AssistantResponseMedia[]
}): AssistantResponseMedia[] {
  if (input.media.length === 0) {
    return []
  }

  const supportedKinds =
    getAssistantChannelAdapter(input.channel)?.supportedResponseMediaKinds ?? []
  return input.media.filter((item) => supportedKinds.includes(item.kind))
}

export async function deliverAssistantReply(input: {
  card?: AssistantResponseCard | null
  dedupeToken?: string | null
  input: AssistantMessageInput
  media?: readonly AssistantResponseMedia[] | null
  response: string
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
  turnId: string
}): Promise<AssistantDeliveryOutcome> {
  const requestedMedia = normalizeAssistantResponseMediaList(input.media ?? [])
  const card = input.card ?? null
  if (card !== null && requestedMedia.length > 0) {
    throw new VaultCliError(
      'ASSISTANT_RESPONSE_CARD_MEDIA_CONFLICT',
      'A response card cannot be combined with response media.',
    )
  }
  if (!input.input.deliverResponse) {
    return {
      kind: 'not-requested',
      media: requestedMedia,
      session: input.session,
    }
  }

  const deliveryFields = resolveAssistantCurrentAudienceDeliveryFields({
    input: input.input,
    session: input.session,
    sharedPlan: input.sharedPlan,
  })
  const deliveryMedia = dropUnsupportedAssistantResponseMediaForChannel({
    channel: deliveryFields.channel,
    media: requestedMedia,
  })
  const hostedDelivery = resolveAssistantHostedDeliveryIdempotency({
    audience: input.sharedPlan.conversationPolicy.audience,
    channel: deliveryFields.channel,
    deliveryFields,
    input: input.input,
    media: deliveryMedia,
    session: input.session,
  })
  const baseDedupeToken =
    input.dedupeToken ?? hostedDelivery.deliveryIdempotencyKey ?? null

  if (card !== null) {
    return await deliverAssistantCurrentAudienceMessage({
      card,
      dedupeToken: baseDedupeToken,
      answeredMailboxItemIds: input.input.answeredMailboxItemIds ?? [],
      deliveryIdempotencyKey: hostedDelivery.deliveryIdempotencyKey,
      deliveryTransportIdempotent: hostedDelivery.deliveryTransportIdempotent,
      input: input.input,
      media: [],
      message: input.response,
      session: input.session,
      sharedPlan: input.sharedPlan,
      turnId: input.turnId,
    })
  }

  if (!assistantChannelSupportsReplyBubbles(deliveryFields.channel)) {
    return await deliverAssistantCurrentAudienceMessage({
      dedupeToken: baseDedupeToken,
      answeredMailboxItemIds: input.input.answeredMailboxItemIds ?? [],
      deliveryIdempotencyKey: hostedDelivery.deliveryIdempotencyKey,
      deliveryTransportIdempotent: hostedDelivery.deliveryTransportIdempotent,
      input: input.input,
      media: deliveryMedia,
      message: input.response,
      session: input.session,
      sharedPlan: input.sharedPlan,
      turnId: input.turnId,
    })
  }

  const splitReplyBubbles = splitAssistantReplyBubbles(input.response)
  const replyBubbles = input.input.reviewedAssistantAskCompletionExpiresAt
    ? [splitReplyBubbles.join('\n\n')]
    : splitReplyBubbles
  if (replyBubbles.length <= 1) {
    return await deliverAssistantCurrentAudienceMessage({
      dedupeToken: baseDedupeToken,
      answeredMailboxItemIds: input.input.answeredMailboxItemIds ?? [],
      deliveryIdempotencyKey: hostedDelivery.deliveryIdempotencyKey,
      deliveryTransportIdempotent: hostedDelivery.deliveryTransportIdempotent,
      input: input.input,
      media: deliveryMedia,
      message: replyBubbles[0]!,
      session: input.session,
      sharedPlan: input.sharedPlan,
      turnId: input.turnId,
    })
  }

  let session = input.session
  // Bubbles deliver sequentially with per-bubble idempotency keys. Persisted
  // intent ordering is owned by the outbox drain comparator
  // (`compareAssistantOutboxDeliverySequenceOrder`) plus hosted boundary
  // gating, so hosted queue-only delivery stays strictly ordered across
  // retries; local immediate retry behavior remains best-effort like steered
  // segments.
  for (let bubbleIndex = 0; bubbleIndex < replyBubbles.length - 1; bubbleIndex += 1) {
    const bubbleIdempotencyKey = buildAssistantReplyBubbleDeliveryIdempotencyKey({
      deliveryIdempotencyKey: hostedDelivery.deliveryIdempotencyKey,
      index: bubbleIndex,
      turnId: input.turnId,
    })
    const outcome = await deliverAssistantCurrentAudienceMessage({
      dedupeToken: bubbleIdempotencyKey,
      answeredMailboxItemIds: [],
      deliveryIdempotencyKey: bubbleIdempotencyKey,
      deliveryTransportIdempotent:
        resolveHostedAssistantDeliveryTransportIdempotentOverride({
          channel: deliveryFields.channel,
          deliveryIdempotencyKey: bubbleIdempotencyKey,
          executionContext: input.input.executionContext,
          media: [],
        }),
      input: input.input,
      media: [],
      message: replyBubbles[bubbleIndex]!,
      session,
      sharedPlan: input.sharedPlan,
      turnId: input.turnId,
    })
    session = outcome.session
    if (outcome.kind === 'failed') {
      return outcome
    }
  }

  return await deliverAssistantCurrentAudienceMessage({
    dedupeToken: baseDedupeToken,
    answeredMailboxItemIds: input.input.answeredMailboxItemIds ?? [],
    deliveryIdempotencyKey: hostedDelivery.deliveryIdempotencyKey,
    deliveryTransportIdempotent: hostedDelivery.deliveryTransportIdempotent,
    input: input.input,
    media: deliveryMedia,
    message: replyBubbles[replyBubbles.length - 1]!,
    session,
    sharedPlan: input.sharedPlan,
    turnId: input.turnId,
  })
}

export function buildAssistantReplyBubbleDeliveryIdempotencyKey(input: {
  deliveryIdempotencyKey?: string | null
  index: number
  turnId: string
}): string {
  const explicitKey = normalizeNullableString(input.deliveryIdempotencyKey)
  const prefix = explicitKey ?? `assistant-bubble:${input.turnId}`
  return `${prefix}:bubble:${input.index}`
}

export async function deliverAssistantReaction(input: {
  deliveryContextOrdinal: number
  input: AssistantMessageInput
  reaction: AssistantMessageReaction
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
  turnId: string
}): Promise<AssistantDeliveryOutcome> {
  if (!input.input.deliverResponse) {
    return {
      kind: 'not-requested',
      media: [],
      session: input.session,
    }
  }

  const deliveryFields = resolveAssistantCurrentAudienceDeliveryFields({
    input: input.input,
    session: input.session,
    sharedPlan: input.sharedPlan,
  })
  const channel = normalizeNullableString(deliveryFields.channel)?.toLowerCase() ?? null
  const channelAdapter = getAssistantChannelAdapter(channel)
  if (!channelAdapter?.setMessageReaction) {
    return {
      kind: 'failed',
      error: normalizeAssistantDeliveryError(
        new VaultCliError(
          'ASSISTANT_REACTION_CHANNEL_UNSUPPORTED',
          'Assistant reactions are not supported for this delivery channel.',
        ),
      ),
      intentId: null,
      media: [],
      session: input.session,
    }
  }
  if (!deliveryFields.replyToMessageId) {
    return {
      kind: 'failed',
      error: normalizeAssistantDeliveryError(
        new VaultCliError(
          'ASSISTANT_REACTION_TARGET_REQUIRED',
          'Assistant reaction delivery requires a current inbound message id.',
        ),
      ),
      intentId: null,
      media: [],
      session: input.session,
    }
  }
  if (!supportsAssistantCurrentAudienceMessageReaction(input)) {
    return {
      kind: 'failed',
      error: normalizeAssistantDeliveryError(
        new VaultCliError(
          'ASSISTANT_REACTION_TARGET_UNAVAILABLE',
          'Assistant reactions are not available for the current inbound message.',
        ),
      ),
      intentId: null,
      media: [],
      session: input.session,
    }
  }

  const hostedDelivery = resolveAssistantHostedDeliveryIdempotency({
    audience: input.sharedPlan.conversationPolicy.audience,
    channel: deliveryFields.channel,
    deliveryFields,
    input: input.input,
    session: input.session,
  })
  const reactionDedupeToken = buildAssistantReactionDeliveryIdempotencyKey({
    deliveryContextOrdinal: input.deliveryContextOrdinal,
    deliveryIdempotencyKey: hostedDelivery.deliveryIdempotencyKey,
    turnId: input.turnId,
  })
  const outcome = await deliverAssistantOutboxReaction({
    ...deliveryFields,
    answeredMailboxItemIds: input.input.answeredMailboxItemIds ?? [],
    dedupeToken: reactionDedupeToken,
    deliveryIdempotencyKey: reactionDedupeToken,
    dispatchMode: input.input.deliveryDispatchMode,
    reaction: input.reaction,
    targetMessageId: deliveryFields.replyToMessageId,
    turnId: input.turnId,
    turnTrigger: input.input.turnTrigger ?? null,
    vault: input.input.vault,
  })
  const session = outcome.session ?? input.session

  switch (outcome.kind) {
    case 'sent':
      return {
        kind: 'sent',
        delivery: outcome.delivery!,
        intentId: outcome.intent.intentId,
        media: [],
        session,
      }
    case 'queued':
      return {
        kind: 'queued',
        error: outcome.deliveryError,
        intentId: outcome.intent.intentId,
        media: [],
        session,
      }
    case 'failed':
      return {
        kind: 'failed',
        error: outcome.deliveryError,
        intentId: outcome.intent.intentId,
        media: [],
        session,
      }
  }
}

export function buildAssistantReactionDeliveryIdempotencyKey(input: {
  deliveryContextOrdinal: number
  deliveryIdempotencyKey?: string | null
  turnId: string
}): string {
  const explicitKey = normalizeNullableString(input.deliveryIdempotencyKey)
  const prefix = explicitKey ?? `assistant-reaction:${input.turnId}`
  return `${prefix}:reaction:${input.deliveryContextOrdinal}`
}

// Codex steered turns can complete several final answers in one turn: an
// answer the model already finished stays final when a steered user message
// arrives afterwards, and the turn continues with a new answer. Codex
// frontends render every completed agent message, so each preceding answer is
// delivered as its own message ahead of the final reply instead of being
// dropped by last-wins extraction.
export async function deliverAssistantPrecedingReplies(input: {
  input: AssistantMessageInput
  resolveSegmentDeliveryInput?: ((input: {
    input: AssistantMessageInput
    segment: AssistantPrecedingReplySegment
    session: AssistantSession
  }) => Promise<AssistantMessageInput>) | null
  segments?: readonly AssistantPrecedingReplySegment[]
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
  turnId: string
}): Promise<AssistantDeliveryOutcome[]> {
  const segments = normalizeAssistantPrecedingReplySegments(input)
  if (!input.input.deliverResponse || segments.length === 0) {
    return []
  }

  const outcomes: AssistantDeliveryOutcome[] = []
  let session = input.session
  for (const [ordinal, segment] of segments.entries()) {
    try {
      const baseSegmentInput = applyAssistantReplyDeliveryContext({
        context: segment.deliveryContext ?? null,
        input: input.input,
      })
      const segmentInput = input.resolveSegmentDeliveryInput
        ? await input.resolveSegmentDeliveryInput({
            input: baseSegmentInput,
            segment,
            session,
          })
        : baseSegmentInput
      const deliveryFields = resolveAssistantCurrentAudienceDeliveryFields({
        input: segmentInput,
        session,
        sharedPlan: input.sharedPlan,
      })
      const baseDeliveryIdempotencyKey = resolveAssistantHostedDeliveryIdempotency({
        audience: input.sharedPlan.conversationPolicy.audience,
        channel: deliveryFields.channel,
        deliveryFields,
        input: segmentInput,
        session,
      }).deliveryIdempotencyKey
      const segmentKey = baseDeliveryIdempotencyKey
        ? `${baseDeliveryIdempotencyKey}:segment:${ordinal}`
        : `assistant-segment:${input.turnId}:${ordinal}`
      const outcome = await deliverAssistantReply({
        dedupeToken: segmentKey,
        input: {
          ...segmentInput,
          deliveryIdempotencyKey: segmentKey,
        },
        media: segment.media ?? [],
        response: segment.response,
        session,
        sharedPlan: input.sharedPlan,
        turnId: input.turnId,
      })
      session = outcome.session
      outcomes.push(outcome)
    } catch (error) {
      outcomes.push({
        kind: 'failed',
        error: normalizeAssistantDeliveryError(error),
        intentId: null,
        media: normalizeAssistantResponseMediaList(segment.media ?? []),
        session,
      })
    }
  }

  return outcomes
}

function normalizeAssistantPrecedingReplySegments(input: {
  segments?: readonly AssistantPrecedingReplySegment[]
}): AssistantPrecedingReplySegment[] {
  return (input.segments ?? []).map((segment) => ({
    ...(segment.deliveryContextOrdinal === undefined
      ? {}
      : { deliveryContextOrdinal: segment.deliveryContextOrdinal }),
    deliveryContext: segment.deliveryContext ?? null,
    response: segment.response,
    ...(segment.transcriptResponse === undefined
      ? {}
      : { transcriptResponse: segment.transcriptResponse }),
    media: normalizeAssistantResponseMediaList(segment.media ?? []),
    ...(segment.targetInputId ? { targetInputId: segment.targetInputId } : {}),
  }))
}

export async function deliverAssistantProgressUpdate(input: {
  dependencies?: AssistantChannelDependencies
  input: AssistantMessageInput
  ordinal: number
  session: AssistantSession
  signal?: AbortSignal
  sharedPlan: AssistantTurnSharedPlan
  text: string
  turnId: string
}): Promise<AssistantSession> {
  // Progress updates are ephemeral current-audience sends, not final-reply
  // delivery or commit-aware outbox decisions. The caller gates on the same
  // shared predicate before invoking, so failing it here means the delivery
  // context diverged mid-send; fail loudly instead of returning a
  // success-shaped no-op that the model reports to the user as "sent".
  if (!shouldCreateAssistantProgressDelivery(input.input)) {
    throw new VaultCliError(
      'ASSISTANT_PROGRESS_DELIVERY_SUPPRESSED',
      `Progress update suppressed: delivery context is not progress-eligible ` +
      `(turn=${input.turnId} ordinal=${input.ordinal} ` +
      `deliverResponse=${String(input.input.deliverResponse)} ` +
      `dispatchMode=${String(input.input.deliveryDispatchMode)} ` +
      `turnTrigger=${String(input.input.turnTrigger)}).`,
    )
  }

  const deliveryFields = resolveAssistantCurrentAudienceDeliveryFields({
    input: input.input,
    session: input.session,
    sharedPlan: input.sharedPlan,
  })
  const deliveryIdempotencyKey = buildAssistantProgressDeliveryIdempotencyKey({
    deliveryIdempotencyKey: resolveAssistantHostedDeliveryIdempotency({
      audience: input.sharedPlan.conversationPolicy.audience,
      channel: deliveryFields.channel,
      deliveryFields,
      input: input.input,
      session: input.session,
    }).deliveryIdempotencyKey,
    ordinal: input.ordinal,
    turnId: input.turnId,
  })
  const messageDeliveryFields = resolveAssistantCurrentAudienceTextDeliveryFields({
    deliveryFields,
    input: input.input,
  })
  // Progress sends bypass the persisted outbox, so this dispatch summary is
  // the only durable trace tying a "sent" tool result to a transport attempt.
  const progressTurnId = input.turnId
  const progressOrdinal = input.ordinal
  console.warn(
    'Assistant progress update dispatching ' +
    `(turn=${progressTurnId} ordinal=${progressOrdinal} ` +
    `channel=${String(messageDeliveryFields.channel)} ` +
    `explicitTargetPresent=${Boolean(messageDeliveryFields.explicitTarget)} ` +
    `threadIdPresent=${Boolean(messageDeliveryFields.threadId)}).`,
  )

  const delivery = await sendAssistantOutboxDispatchMessage({
    ...(input.dependencies ? { dependencies: input.dependencies } : {}),
    ...messageDeliveryFields,
    deliveryIdempotencyKey,
    media: [],
    message: input.text,
    replyToMessageId: messageDeliveryFields.replyToMessageId,
    subject: messageDeliveryFields.subject,
    turnId: input.turnId,
    vault: input.input.vault,
    signal: input.signal,
  })
  console.warn(
    'Assistant progress update dispatched ' +
    `(turn=${progressTurnId} ordinal=${progressOrdinal} ` +
    `deliveredTargetPresent=${Boolean(delivery.delivery?.target)} ` +
    `providerMessageIdPresent=${Boolean(
      delivery.delivery && 'providerMessageId' in delivery.delivery
        ? delivery.delivery.providerMessageId
        : null,
    )}).`,
  )
  return delivery.session ?? input.session
}

export function buildAssistantProgressDeliveryIdempotencyKey(input: {
  deliveryIdempotencyKey?: string | null
  ordinal: number
  turnId: string
}): string {
  const explicitKey = normalizeNullableString(input.deliveryIdempotencyKey)
  if (explicitKey) {
    return `${explicitKey}:progress:${input.ordinal}`
  }

  return `assistant-progress:${input.turnId}:${input.ordinal}`
}

export interface AssistantCurrentAudienceDeliveryFields {
  actorId: string | null
  bindingDelivery: Exclude<
    AssistantOutboxDispatchMessage['bindingDelivery'],
    undefined
  >
  channel: string | null
  deliverySource: Exclude<
    AssistantOutboxDispatchMessage['deliverySource'],
    undefined
  >
  explicitTarget: string | null
  identityId: string | null
  replyToMessageId: string | null
  sessionId: string
  subject: string | null
  threadId: string | null
  threadIsDirect: boolean | null
}

type AssistantCurrentAudienceRouteFields = Pick<
  AssistantCurrentAudienceDeliveryFields,
  | 'actorId'
  | 'channel'
  | 'identityId'
  | 'threadId'
  | 'threadIsDirect'
>

export type AssistantCurrentAudienceDeliveryPrecedence =
  | 'audience-first'
  | 'input-override'

export function resolveAssistantCurrentAudienceDeliveryFields(input: {
  input: AssistantMessageInput
  precedence?: AssistantCurrentAudienceDeliveryPrecedence
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
}): AssistantCurrentAudienceDeliveryFields {
  const audience = input.sharedPlan.conversationPolicy.audience
  const binding = input.session.binding
  const message = input.input
  const inputRoute = resolveAssistantInputRouteFallback(message)
  const precedence = input.precedence ?? 'input-override'

  const actorId = audience?.actorId ?? binding.actorId ?? inputRoute.actorId
  const channel = audience?.channel ?? binding.channel ?? inputRoute.channel
  const identityId =
    audience?.identityId ?? binding.identityId ?? inputRoute.identityId
  const threadId = audience?.threadId ?? binding.threadId ?? inputRoute.threadId
  const threadIsDirect =
    audience?.threadIsDirect ?? binding.threadIsDirect ?? inputRoute.threadIsDirect
  const selectedRoute = {
    actorId,
    channel,
    identityId,
    threadId,
    threadIsDirect,
  }
  const hasBindingDeliveryHint = hasAssistantInputBindingDeliveryHint(message)
  const hintedBindingDelivery = hasBindingDeliveryHint
    ? resolveAssistantHintedBindingDelivery({
        input: message,
        inputRoute,
        selectedRoute,
      })
    : null
  const fallbackBindingDelivery =
    hasBindingDeliveryHint ? null : resolveAssistantBindingDelivery(selectedRoute)
  const bindingDelivery =
    hintedBindingDelivery ??
    audience?.bindingDelivery ??
    binding.delivery ??
    fallbackBindingDelivery

  return {
    actorId,
    bindingDelivery,
    channel,
    deliverySource: message.deliverySource ?? null,
    explicitTarget:
      precedence === 'audience-first'
        ? audience?.explicitTarget ?? message.deliveryTarget ?? null
        : message.deliveryTarget === undefined
          ? audience?.explicitTarget ?? null
          : message.deliveryTarget,
    identityId,
    replyToMessageId:
      precedence === 'audience-first'
        ? audience?.replyToMessageId ?? message.deliveryReplyToMessageId ?? null
        : message.deliveryReplyToMessageId === undefined
          ? audience?.replyToMessageId ?? null
          : message.deliveryReplyToMessageId,
    sessionId: input.session.sessionId,
    subject: message.deliverySubject ?? null,
    threadId,
    threadIsDirect,
  }
}

export function supportsAssistantCurrentAudienceMessageReaction(input: {
  input: AssistantMessageInput
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
}): boolean {
  const deliveryFields = resolveAssistantCurrentAudienceDeliveryFields(input)
  const channel = normalizeNullableString(deliveryFields.channel)?.toLowerCase() ?? null
  if (
    !getAssistantChannelAdapter(channel)?.setMessageReaction ||
    normalizeNullableString(deliveryFields.replyToMessageId) === null
  ) {
    return false
  }

  if (
    channel === 'linq' &&
    input.input.deliveryMessageReactionsAvailable !== true
  ) {
    return false
  }

  const explicitTarget = normalizeNullableString(deliveryFields.explicitTarget)
  if (channel !== 'telegram' || !explicitTarget) {
    return true
  }

  const target = parseTelegramThreadTarget(explicitTarget)
  return !target?.businessConnectionId
}

function resolveAssistantCurrentAudienceTextDeliveryFields(input: {
  deliveryFields: AssistantCurrentAudienceDeliveryFields
  input: AssistantMessageInput
}): AssistantCurrentAudienceDeliveryFields {
  if (
    input.input.deliveryNativeReplyRequested === true ||
    !shouldSuppressAssistantNativeTextReplyToMessageId({
      channel: input.deliveryFields.channel,
      turnTrigger: input.input.turnTrigger ?? null,
    })
  ) {
    return input.deliveryFields
  }

  return {
    ...input.deliveryFields,
    replyToMessageId: null,
  }
}

function shouldSuppressAssistantNativeTextReplyToMessageId(input: {
  channel: string | null
  turnTrigger: AssistantMessageInput['turnTrigger'] | null
}): boolean {
  return (
    normalizeNullableString(input.channel)?.toLowerCase() === 'telegram' &&
    input.turnTrigger === 'automation-auto-reply'
  )
}

function resolveAssistantHintedBindingDelivery(input: {
  input: AssistantMessageInput
  inputRoute: AssistantCurrentAudienceRouteFields
  selectedRoute: AssistantCurrentAudienceRouteFields
}): AssistantCurrentAudienceDeliveryFields['bindingDelivery'] {
  if (!assistantDeliveryRoutesMatch(input.selectedRoute, input.inputRoute)) {
    return null
  }

  const explicitBindingTarget = normalizeNullableString(
    input.input.bindingDeliveryTarget,
  )
  return resolveAssistantInputRouteBindingDelivery({
    input: input.input,
    route:
      explicitBindingTarget === null ? input.selectedRoute : input.inputRoute,
  })
}

function hasAssistantInputBindingDeliveryHint(
  input: AssistantMessageInput,
): boolean {
  return (
    (input.deliveryKind !== undefined && input.deliveryKind !== null) ||
    normalizeNullableString(input.bindingDeliveryTarget) !== null
  )
}

function assistantDeliveryRoutesMatch(
  first: AssistantCurrentAudienceRouteFields,
  second: AssistantCurrentAudienceRouteFields,
): boolean {
  return (
    assistantDeliveryRouteValuesCompatible(first.actorId, second.actorId) &&
    assistantDeliveryRouteValuesCompatible(first.channel, second.channel) &&
    assistantDeliveryRouteValuesCompatible(first.identityId, second.identityId) &&
    assistantDeliveryRouteValuesCompatible(first.threadId, second.threadId) &&
    assistantDeliveryRouteValuesCompatible(
      first.threadIsDirect,
      second.threadIsDirect,
    )
  )
}

function assistantDeliveryRouteValuesCompatible<T extends boolean | string>(
  first: T | null,
  second: T | null,
): boolean {
  return first === null || second === null || first === second
}

function resolveAssistantInputRouteFallback(
  input: AssistantMessageInput,
): AssistantCurrentAudienceRouteFields {
  return {
    actorId:
      normalizeNullableString(input.actorId) ??
      normalizeNullableString(input.participantId),
    channel: normalizeNullableString(input.channel),
    identityId: normalizeNullableString(input.identityId),
    threadId: normalizeNullableString(input.threadId),
    threadIsDirect:
      typeof input.threadIsDirect === 'boolean' ? input.threadIsDirect : null,
  }
}

function resolveAssistantInputRouteBindingDelivery(input: {
  input: AssistantMessageInput
  route: Pick<
    AssistantCurrentAudienceDeliveryFields,
    | 'actorId'
    | 'channel'
    | 'threadId'
    | 'threadIsDirect'
  >
}): AssistantCurrentAudienceDeliveryFields['bindingDelivery'] {
  return resolveAssistantBindingDelivery({
    actorId: input.route.actorId,
    channel: input.route.channel,
    deliveryKind: input.input.deliveryKind ?? null,
    deliveryTarget: input.input.bindingDeliveryTarget ?? null,
    threadId: input.route.threadId,
    threadIsDirect: input.route.threadIsDirect,
  })
}

async function deliverAssistantCurrentAudienceMessage(input: {
  card?: AssistantResponseCard | null
  answeredMailboxItemIds?: readonly string[] | null
  dedupeToken: string | null
  deliveryIdempotencyKey: string | null
  deliveryTransportIdempotent: boolean | undefined
  input: AssistantMessageInput
  media: AssistantResponseMedia[]
  message: string
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
  turnId: string
}): Promise<AssistantDeliveryOutcome> {
  const state = createAssistantRuntimeStateService(input.input.vault)
  const deliveryFields = resolveAssistantCurrentAudienceDeliveryFields({
    input: input.input,
    session: input.session,
    sharedPlan: input.sharedPlan,
  })
  const messageDeliveryFields = resolveAssistantCurrentAudienceTextDeliveryFields({
    deliveryFields,
    input: input.input,
  })
  const outcome = await state.outbox.deliverMessage({
    ...messageDeliveryFields,
    answeredMailboxItemIds: input.answeredMailboxItemIds ?? [],
    reviewedAssistantAskCompletionExpiresAt:
      input.input.reviewedAssistantAskCompletionExpiresAt ?? null,
    automationAuthority: input.input.outboxAutomationAuthority ?? null,
    automationContextReferences:
      input.input.outboxAutomationContextReferences ?? null,
    plannedOccurrenceAt: input.input.outboxPlannedOccurrenceAt ?? null,
    scheduledOccurrenceAt: input.input.scheduledOccurrenceAt ?? null,
    externalThreadRouteAuthority:
      input.input.outboxExternalThreadRouteAuthority ?? null,
    dedupeToken: input.dedupeToken,
    card: input.card ?? null,
    media: input.media,
    message: input.message,
    nativeReplyRequested: input.input.deliveryNativeReplyRequested,
    deliveryIdempotencyKey: input.deliveryIdempotencyKey,
    deliveryTransportIdempotent: input.deliveryTransportIdempotent,
    turnId: input.turnId,
    turnTrigger: input.input.turnTrigger ?? null,
    dependencies: undefined,
    dispatchMode: input.input.deliveryDispatchMode,
  })
  const session = outcome.session ?? input.session

  switch (outcome.kind) {
    case 'sent':
      return {
        kind: 'sent',
        delivery: outcome.delivery!,
        intentId: outcome.intent.intentId,
        media: input.media,
        session,
      }
    case 'queued':
      return {
        kind: 'queued',
        error: outcome.deliveryError,
        intentId: outcome.intent.intentId,
        media: input.media,
        session,
      }
    case 'failed':
      return {
        kind: 'failed',
        error: outcome.deliveryError,
        intentId: outcome.intent.intentId,
        media: input.media,
        session,
      }
    default:
      return {
        kind: 'failed',
        error: normalizeAssistantDeliveryError(
          new Error('Assistant outbound delivery failed.'),
        ),
        intentId: 'unknown',
        media: input.media,
        session,
      }
  }
}

function createHostedDeliveryIdempotencyKeyFromContext(input: {
  audience: AssistantTurnSharedPlan['conversationPolicy']['audience']
  channel: string | null
  deliveryFields: Pick<
    AssistantCurrentAudienceDeliveryFields,
    | 'actorId'
    | 'bindingDelivery'
    | 'explicitTarget'
    | 'identityId'
    | 'threadId'
    | 'threadIsDirect'
  >
  input: AssistantMessageInput
  memberId: string
  session: AssistantSession
}): string | null {
  const context = input.input.hostedDeliveryIdempotency
  const channel = normalizeNullableString(input.channel)
  const memberId = normalizeNullableString(input.memberId)
  const inboundMailboxItemIds =
    context?.inboundMailboxItemIds
      ?.map((itemId) => normalizeNullableString(itemId))
      .filter((itemId): itemId is string => itemId !== null) ?? []
  const assistantTurnOrdinal =
    typeof context?.assistantTurnOrdinal === 'number' ||
    typeof context?.assistantTurnOrdinal === 'string'
      ? context.assistantTurnOrdinal
      : null

  if (!channel || !memberId || inboundMailboxItemIds.length === 0 || assistantTurnOrdinal === null) {
    return null
  }
  const actorId = input.deliveryFields.actorId
  const bindingDelivery = input.deliveryFields.bindingDelivery
  const explicitTarget = input.deliveryFields.explicitTarget
  const identityId = input.deliveryFields.identityId
  const threadId = input.deliveryFields.threadId
  const threadIsDirect = input.deliveryFields.threadIsDirect

  return createHostedDeliveryId({
    assistantTurnOrdinal,
    channel,
    conversationId:
      normalizeNullableString(context?.conversationId) ??
      stringifyHostedDeliveryIdempotencyKeyParts([
        channel,
        identityId,
        threadIsDirect === false ? null : actorId,
        threadId,
        threadIsDirect,
      ]),
    // Keep the key stable if replay groups previously steered inputs into one
    // turn: the latest inbound item is the causal anchor for this delivery.
    inboundMailboxItemIds: [inboundMailboxItemIds.at(-1)!],
    recipientKey:
      normalizeNullableString(context?.recipientKey) ??
      stringifyHostedDeliveryIdempotencyKeyParts([
        channel,
        explicitTarget,
        bindingDelivery?.target,
        identityId,
        threadIsDirect === false ? null : actorId,
        threadId,
      ]),
    userId: memberId,
  })
}

function hostedDeliveryChannelRequiresIdempotencyKey(channel: string | null): boolean {
  return channel === 'linq' || channel === 'email'
}

function stringifyHostedDeliveryIdempotencyKeyParts(
  parts: readonly (boolean | null | string | undefined)[],
): string {
  return JSON.stringify(parts.map((part) => part ?? null))
}

export async function finalizeAssistantTurnFromDeliveryOutcome(input: {
  firstContactGuidanceInjected?: boolean
  firstContactStateDocIds?: readonly string[]
  outcome: AssistantDeliveryOutcome
  response: string
  turnId: string
  vault: string
}): Promise<void> {
  const completedAt = new Date().toISOString()
  const response = input.response
  const plan = buildAssistantTurnDeliveryFinalizationPlan({
    completedAt,
    outcome: input.outcome,
    response,
    turnId: input.turnId,
  })
  const state = createAssistantRuntimeStateService(input.vault)
  await state.turns.finalizeReceipt(plan.receipt)
  // Any accepted reply on a first-contact-scoped route is first contact, not
  // just the canned welcome text: once the user has heard from the assistant
  // here, a queued signup welcome for this route is stale and must skip.
  const firstContactAcceptedForDelivery =
    input.firstContactGuidanceInjected === true &&
    response !== '' &&
    isAssistantFirstContactAcceptedForDelivery(input.outcome)
  if (firstContactAcceptedForDelivery) {
    await markAssistantFirstContactSeen({
      docIds: input.firstContactStateDocIds ?? [],
      seenAt: completedAt,
      vault: input.vault,
    })
  }
  // The receipt finalization above is the commit; the terminal diagnostic is
  // observability only and must never fail an already-accepted delivery (a
  // thrown error here would abandon a queued outbox intent upstream).
  await state.diagnostics.recordEvent(plan.diagnostic).catch((error) => {
    warnAssistantBestEffortFailure({
      error,
      operation: 'turn delivery diagnostic',
    })
  })
}

// The hosted signup-welcome skip and managed onboarding follow-up seeder both
// read this marker, so it must mean "a reply actually reached (or is queued
// for) this route".
// A 'not-requested' outcome delivered nothing and must not suppress the
// welcome for a route that has never heard from the assistant.
function isAssistantFirstContactAcceptedForDelivery(
  outcome: AssistantDeliveryOutcome,
): boolean {
  return outcome.kind === 'sent' || outcome.kind === 'queued'
}

export function buildAssistantTurnDeliveryFinalizationPlan(input: {
  completedAt: string
  outcome: AssistantDeliveryOutcome
  response: string
  turnId: string
}): AssistantTurnDeliveryFinalizationPlan {
  const response = input.response
  switch (input.outcome.kind) {
    case 'not-requested':
      return {
        receipt: {
          turnId: input.turnId,
          status: 'completed',
          deliveryDisposition: 'not-requested',
          response,
          completedAt: input.completedAt,
        },
        diagnostic: {
          component: 'assistant',
          kind: 'turn.completed',
          message: 'Assistant turn completed without outbound delivery.',
          sessionId: input.outcome.session.sessionId,
          turnId: input.turnId,
          counterDeltas: {
            turnsCompleted: 1,
          },
          at: input.completedAt,
        },
      }
    case 'sent':
      return {
        receipt: {
          turnId: input.turnId,
          status: 'completed',
          deliveryDisposition: 'sent',
          deliveryIntentId: input.outcome.intentId,
          response,
          completedAt: input.completedAt,
        },
        diagnostic: {
          component: 'assistant',
          kind: 'turn.completed',
          message: 'Assistant turn completed and delivered successfully.',
          sessionId: input.outcome.session.sessionId,
          turnId: input.turnId,
          intentId: input.outcome.intentId,
          counterDeltas: {
            turnsCompleted: 1,
          },
          at: input.completedAt,
        },
      }
    case 'queued':
      return {
        receipt: {
          turnId: input.turnId,
          status: 'deferred',
          deliveryDisposition: input.outcome.error ? 'retryable' : 'queued',
          deliveryIntentId: input.outcome.intentId,
          error: input.outcome.error,
          response,
          completedAt: input.completedAt,
        },
        diagnostic: {
          component: 'assistant',
          kind: 'turn.deferred',
          level: input.outcome.error ? 'warn' : 'info',
          message:
            input.outcome.error?.message ??
            'Assistant turn deferred with a queued outbound delivery.',
          code: input.outcome.error?.code ?? null,
          sessionId: input.outcome.session.sessionId,
          turnId: input.turnId,
          intentId: input.outcome.intentId,
          counterDeltas: {
            turnsDeferred: 1,
          },
          at: input.completedAt,
        },
      }
    case 'failed':
      return {
        receipt: {
          turnId: input.turnId,
          status: 'failed',
          deliveryDisposition: 'failed',
          deliveryIntentId: input.outcome.intentId,
          error: input.outcome.error,
          response,
          completedAt: input.completedAt,
        },
        diagnostic: {
          component: 'assistant',
          kind: 'turn.failed',
          level: 'error',
          message: input.outcome.error.message,
          code: input.outcome.error.code,
          sessionId: input.outcome.session.sessionId,
          turnId: input.turnId,
          intentId: input.outcome.intentId,
          counterDeltas: {
            turnsFailed: 1,
          },
          at: input.completedAt,
        },
      }
  }
}
