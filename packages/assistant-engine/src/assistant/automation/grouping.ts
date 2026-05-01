import type { AssistantInputCandidate } from '../input-source.js'
import { isSameAssistantConversationRef } from '../conversation-ref.js'
import {
  readTelegramAutoReplyMetadataFromAssistantInput,
  type TelegramAutoReplyMetadata,
} from './prompt-builder.js'
import type { AssistantAutomationInputSummary } from './input-summary.js'

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
    const candidate = input.inputSummaries[index]
    if (!candidate || !shouldGroupAdjacentConversationInput(first, candidate)) {
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
  return isSameAssistantConversationRef(first.conversation, candidate.conversation)
}
