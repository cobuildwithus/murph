import type { AssistantInputCandidate } from '../input-source.js'
import { isAssistantHostedImageCompletionEvent } from '../hosted-image-completion.js'
import { isSameAssistantConversationRef } from '../conversation-ref.js'
import {
  readTelegramAutoReplyMetadataFromAssistantInput,
  type TelegramAutoReplyMetadata,
} from './prompt-builder.js'
import {
  assistantAutomationInputSummaryFromCandidate,
  type AssistantAutomationInputSummary,
} from './input-summary.js'

export const ASSISTANT_AUTO_REPLY_COMPOUND_INPUT_MAX = 50

export interface AssistantAutoReplyGroupItem {
  inputCandidate?: AssistantInputCandidate | null
  summary: AssistantAutomationInputSummary
  telegramMetadata: TelegramAutoReplyMetadata | null
}

export async function collectAssistantAutoReplyGroup(input: {
  inputSummaries: readonly AssistantAutomationInputSummary[]
  inputCandidatesByInputId?: ReadonlyMap<string, AssistantInputCandidate>
  startIndex: number
  vault: string
}): Promise<{
  endIndex: number
  items: AssistantAutoReplyGroupItem[]
}> {
  const first = input.inputSummaries[input.startIndex]
  if (!first) {
    return {
      endIndex: input.startIndex,
      items: [],
    }
  }
  const items: AssistantAutoReplyGroupItem[] = [
    await createAssistantAutoReplyGroupItem(input.vault, first, {
      inputCandidate: input.inputCandidatesByInputId?.get(first.inputId) ?? null,
    }),
  ]
  let endIndex = input.startIndex

  for (
    let index = input.startIndex + 1;
    index < input.inputSummaries.length;
    index += 1
  ) {
    if (items.length >= ASSISTANT_AUTO_REPLY_COMPOUND_INPUT_MAX) {
      break
    }
    const candidate = input.inputSummaries[index]
    const firstInputCandidate = input.inputCandidatesByInputId?.get(first.inputId)
    const candidateInputCandidate = candidate
      ? input.inputCandidatesByInputId?.get(candidate.inputId)
      : null
    const shouldGroup = candidate && firstInputCandidate && candidateInputCandidate
      ? shouldGroupAdjacentAssistantInputCandidates(
          firstInputCandidate,
          candidateInputCandidate,
        )
      : candidate
        ? shouldGroupAdjacentConversationInput(first, candidate)
        : false
    if (!candidate || !shouldGroup) {
      break
    }

    items.push(
      await createAssistantAutoReplyGroupItem(input.vault, candidate, {
        inputCandidate:
          input.inputCandidatesByInputId?.get(candidate.inputId) ?? null,
      }),
    )
    endIndex = index
  }

  return {
    endIndex,
    items,
  }
}

export async function loadAssistantAutoReplyGroupItems(input: {
  inputSummaries: readonly AssistantAutomationInputSummary[]
  inputCandidatesByInputId?: ReadonlyMap<string, AssistantInputCandidate>
  vault: string
}): Promise<AssistantAutoReplyGroupItem[]> {
  return Promise.all(
    input.inputSummaries.map((summary) =>
      createAssistantAutoReplyGroupItem(input.vault, summary, {
        inputCandidate: input.inputCandidatesByInputId?.get(summary.inputId) ?? null,
      }),
    ),
  )
}

async function createAssistantAutoReplyGroupItem(
  vault: string,
  summary: AssistantAutomationInputSummary,
  input: {
    inputCandidate?: AssistantInputCandidate | null
  } = {},
): Promise<AssistantAutoReplyGroupItem> {
  return {
    inputCandidate: input.inputCandidate ?? null,
    summary,
    telegramMetadata: await loadInputTelegramMetadata(
      vault,
      summary,
      input.inputCandidate ?? null,
    ),
  }
}

async function loadInputTelegramMetadata(
  vault: string,
  summary: AssistantAutomationInputSummary,
  inputCandidate: AssistantInputCandidate | null,
): Promise<TelegramAutoReplyMetadata | null> {
  void vault
  void summary
  const eventMetadata = inputCandidate
    ? readTelegramAutoReplyMetadataFromAssistantInput({
        replyTarget: inputCandidate.event.replyTarget,
        sourceMetadata: inputCandidate.event.sourceMetadata,
      })
    : null
  if (eventMetadata) {
    return eventMetadata
  }

  return null
}

export function shouldGroupAdjacentConversationInput(
  first: AssistantAutomationInputSummary,
  candidate: AssistantAutomationInputSummary,
): boolean {
  // An affirmative reaction is a synthetic trigger with its own target
  // attestation. Keep it in a one-input group so adjacent ordinary messages
  // cannot lend it trust or be suppressed with it.
  if (
    first.affirmativeReaction === true ||
    candidate.affirmativeReaction === true
  ) {
    return false
  }
  if (
    first.groupRoomBatchingEligible ||
    candidate.groupRoomBatchingEligible
  ) {
    return first.groupRoomBatchingEligible &&
      candidate.groupRoomBatchingEligible &&
      isSameAuthenticatedGroupRoomBatch(first, candidate)
  }
  if (!isSameAssistantConversationRef(first.conversation, candidate.conversation)) {
    return false
  }
  // Outside authenticated group rooms, native reply targets identify the
  // specific prior assistant message the input is answering. Preserve the
  // existing boundary so direct inputs keep one turn context per anchor.
  return first.replyToMessageId === candidate.replyToMessageId
}

function isSameAuthenticatedGroupRoomBatch(
  first: AssistantAutomationInputSummary,
  candidate: AssistantAutomationInputSummary,
): boolean {
  return isSameAuthenticatedGroupRoomRoute(first, candidate) &&
    (first.conversation.sessionId ?? null) ===
      (candidate.conversation.sessionId ?? null) &&
    first.projectionReady === candidate.projectionReady
}

function isSameAuthenticatedGroupRoomRoute(
  first: AssistantAutomationInputSummary,
  candidate: AssistantAutomationInputSummary,
): boolean {
  return (
    first.source === candidate.source &&
    first.conversation.source === candidate.conversation.source &&
    first.conversation.accountId === candidate.conversation.accountId &&
    first.conversation.threadId === candidate.conversation.threadId &&
    first.conversation.threadIsDirect === false &&
    candidate.conversation.threadIsDirect === false &&
    first.actorIsSelf === candidate.actorIsSelf &&
    first.deliveryTarget === candidate.deliveryTarget
  )
}

export function isSameAuthenticatedAssistantGroupRoute(
  first: AssistantInputCandidate,
  candidate: AssistantInputCandidate,
): boolean {
  const firstSummary = assistantAutomationInputSummaryFromCandidate(first)
  const candidateSummary = assistantAutomationInputSummaryFromCandidate(candidate)
  return firstSummary.affirmativeReaction !== true &&
    candidateSummary.affirmativeReaction !== true &&
    firstSummary.groupRoomBatchingEligible &&
    candidateSummary.groupRoomBatchingEligible &&
    isSameAuthenticatedGroupRoomRoute(firstSummary, candidateSummary)
}

export function shouldGroupAdjacentAssistantInputCandidates(
  first: AssistantInputCandidate,
  candidate: AssistantInputCandidate,
): boolean {
  if (
    isHostedImageCompletionAssistantInputCandidate(first) &&
    isHostedImageCompletionAssistantInputCandidate(candidate)
  ) {
    return false
  }
  return (
    isHostedImageCompletionAssistantInputCandidate(first) &&
    isSameAuthenticatedAssistantGroupRoute(first, candidate)
  ) || shouldGroupAdjacentConversationInput(
    assistantAutomationInputSummaryFromCandidate(first),
    assistantAutomationInputSummaryFromCandidate(candidate),
  )
}

function isHostedImageCompletionAssistantInputCandidate(
  candidate: AssistantInputCandidate,
): boolean {
  return isAssistantHostedImageCompletionEvent(candidate.event)
}
