import type {
  AssistantInputCandidate,
  AssistantInputConversationRef,
} from '../input-source.js'

export interface AssistantAutomationInputSummary {
  inputId: string
  projectionCaptureId: string | null
  source: string
  conversation: AssistantInputConversationRef
  occurredAt: string
  receivedAt: string | null
  text: string | null
  attachmentCount: number
  actorIsSelf: boolean
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

  return {
    inputId: input.event.inputId,
    projectionCaptureId: input.projection.captureId,
    source: input.event.source,
    conversation,
    occurredAt: input.event.occurredAt,
    receivedAt: input.event.receivedAt,
    text: input.event.transcriptText ?? input.event.text,
    attachmentCount: input.event.attachmentCount,
    actorIsSelf: conversation.actorIsSelf,
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
    : leftTimestamp.localeCompare(rightTimestamp)
}
