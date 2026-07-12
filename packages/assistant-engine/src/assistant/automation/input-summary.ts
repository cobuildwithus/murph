import type {
  AssistantInputCandidate,
  AssistantInputConversationRef,
  AssistantInputCursor,
} from '../input-source.js'
import { compareAssistantInputCursors } from '../input-store.js'
import { compareAssistantTimestampsAscending } from '../shared.js'

export interface AssistantAutomationInputSummary {
  cursor: AssistantInputCursor
  inputId: string
  optionalInboxCaptureId: string | null
  source: string
  conversation: AssistantInputConversationRef
  occurredAt: string
  receivedAt: string | null
  text: string | null
  attachmentCount: number
  actorIsSelf: boolean
  // Deferred provider context is rendered with the next actionable input but
  // never becomes the actionable input itself.
  contextOnly: boolean
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
  const contextOnly =
    sourceMetadata?.kind === 'linq' && sourceMetadata.contextOnly === true

  return {
    cursor: input.event.cursor,
    inputId: input.event.inputId,
    optionalInboxCaptureId: input.projection.captureId,
    source: input.event.source,
    conversation,
    occurredAt: input.event.occurredAt,
    receivedAt: input.event.receivedAt,
    text: input.event.transcriptText ?? input.event.text,
    attachmentCount: input.event.attachmentCount,
    actorIsSelf: conversation.actorIsSelf,
    contextOnly,
    replyToMessageId,
  }
}

export function compareAssistantInputSummaryOrder(
  left: AssistantAutomationInputSummary,
  right: AssistantAutomationInputSummary,
): number {
  if (left.contextOnly !== right.contextOnly) {
    return left.contextOnly ? -1 : 1
  }
  const compareSemanticTime = left.contextOnly && right.contextOnly
  const leftTimestamp = compareSemanticTime
    ? left.occurredAt
    : left.receivedAt ?? left.occurredAt
  const rightTimestamp = compareSemanticTime
    ? right.occurredAt
    : right.receivedAt ?? right.occurredAt

  if (leftTimestamp !== rightTimestamp) {
    return compareAssistantTimestampsAscending(leftTimestamp, rightTimestamp)
  }
  return compareAssistantInputCursors(left.cursor, right.cursor)
}
