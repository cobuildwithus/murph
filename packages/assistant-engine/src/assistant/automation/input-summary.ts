import type {
  AssistantInputCandidate,
  AssistantInputConversationRef,
} from '../input-source.js'
import {
  compareAssistantTimestampsAscending,
  normalizeNullableString,
} from '../shared.js'

export interface AssistantAutomationInputSummary {
  inputId: string
  optionalInboxCaptureId: string | null
  source: string
  conversation: AssistantInputConversationRef
  occurredAt: string
  receivedAt: string | null
  text: string | null
  attachmentCount: number
  actorIsSelf: boolean
  affirmativeReaction?: true
  deliveryTarget: string | null
  groupRoomBatchingEligible: boolean
  projectionReady: boolean
  // Provider-level native reply target. Direct conversation
  // batching preserves this boundary; authenticated group-room batching keeps
  // each message's anchor in its own prompt entry instead.
  replyToMessageId: string | null
}

export function assistantAutomationInputSummaryFromCandidate(
  input: AssistantInputCandidate,
): AssistantAutomationInputSummary {
  const conversation = input.event.conversation ?? {
    accountId: null,
    actorId: null,
    actorIsSelf: false,
    source: input.event.source,
    threadId: input.event.inputId,
    threadIsDirect: null,
  }
  const sourceMetadata = input.event.sourceMetadata
  const replyToMessageId =
    sourceMetadata?.kind === 'linq' || sourceMetadata?.kind === 'telegram'
      ? sourceMetadata.replyToMessageId ?? null
      : null
  const affirmativeReaction =
    sourceMetadata?.kind === 'linq' && sourceMetadata.affirmativeReaction === true
  const eventSource =
    normalizeNullableString(input.event.source)?.toLowerCase() ?? null
  const deliveryTarget = normalizeNullableString(input.event.replyTarget?.threadId)
  const deliveryChannel =
    normalizeNullableString(input.event.replyTarget?.channel)?.toLowerCase() ?? null
  const groupRoomBatchingEligible =
    conversation.threadIsDirect === false &&
    conversation.actorIsSelf === false &&
    (eventSource === 'linq' || eventSource === 'telegram') &&
    sourceMetadata?.kind === eventSource &&
    deliveryChannel === eventSource &&
    deliveryTarget !== null &&
    sourceMetadata.externalThreadRouteAuthorityPresent === true

  return {
    inputId: input.event.inputId,
    optionalInboxCaptureId: input.projection.captureId,
    source: input.event.source,
    conversation,
    occurredAt: input.event.occurredAt,
    receivedAt: input.event.receivedAt,
    text: input.event.transcriptText ?? input.event.text,
    attachmentCount: input.event.attachmentCount,
    actorIsSelf: conversation.actorIsSelf,
    ...(affirmativeReaction ? { affirmativeReaction: true } : {}),
    deliveryTarget,
    groupRoomBatchingEligible,
    projectionReady: input.projection.status !== 'pending',
    replyToMessageId,
  }
}

export function compareAssistantInputSummaryOrder(
  left: AssistantAutomationInputSummary,
  right: AssistantAutomationInputSummary,
): number {
  const leftTimestamp = left.receivedAt ?? left.occurredAt
  const rightTimestamp = right.receivedAt ?? right.occurredAt

  return leftTimestamp === rightTimestamp
    ? left.inputId.localeCompare(right.inputId)
    : compareAssistantTimestampsAscending(leftTimestamp, rightTimestamp)
}
