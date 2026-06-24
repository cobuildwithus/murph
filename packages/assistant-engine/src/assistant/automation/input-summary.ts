import type {
  AssistantInputCandidate,
  AssistantInputConversationRef,
} from '../input-source.js'
import { compareAssistantTimestampsAscending } from '../shared.js'

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
  // Provider-level native reply target (Linq only today). Carried on the
  // summary so adjacent-grouping can split across reply-anchor boundaries
  // without re-reading source metadata.
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
    sourceMetadata?.kind === 'linq' ? sourceMetadata.replyToMessageId ?? null : null

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
