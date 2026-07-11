import type { AssistantInputCandidate } from '../input-source.js'
import {
  isSameAssistantConversationRef,
  type AssistantInputConversationRef,
} from '../conversation-ref.js'
import {
  readTelegramAutoReplyMetadataFromAssistantInput,
  type TelegramAutoReplyMetadata,
} from './prompt-builder.js'
import {
  compareAssistantInputSummaryOrder,
  type AssistantAutomationInputSummary,
} from './input-summary.js'
import { compareAssistantTimestampsAscending } from '../shared.js'

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
  let actionableConversation = first.contextOnly
    ? undefined
    : first.conversation
  let actionableReplyAnchor = first.contextOnly
    ? undefined
    : first.replyToMessageId

  for (
    let index = input.startIndex + 1;
    index < input.inputSummaries.length;
    index += 1
  ) {
    const candidate = input.inputSummaries[index]
    if (!candidate) {
      break
    }

    if (candidate.contextOnly) {
      if (!isSameAssistantDeferredContextRoute(first.conversation, candidate.conversation)) {
        break
      }
      if (
        actionableConversation !== undefined &&
        actionableReplyAnchor !== undefined &&
        !nextActionableInputSharesReplyAnchor({
          actionableReplyAnchor,
          conversation: actionableConversation,
          inputSummaries: input.inputSummaries,
          startIndex: index + 1,
        })
      ) {
        break
      }
    } else if (actionableReplyAnchor === undefined) {
      if (!isSameAssistantDeferredContextRoute(first.conversation, candidate.conversation)) {
        break
      }
      actionableConversation = candidate.conversation
      actionableReplyAnchor = candidate.replyToMessageId
    } else {
      if (
        !actionableConversation ||
        !isSameAssistantConversationRef(
          actionableConversation,
          candidate.conversation,
        ) ||
        candidate.replyToMessageId !== actionableReplyAnchor
      ) {
        break
      }
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

export function orderAssistantAutoReplyInputSummaries(
  inputSummaries: readonly AssistantAutomationInputSummary[],
): AssistantAutomationInputSummary[] {
  const actionable = inputSummaries.filter((summary) => !summary.contextOnly)
  const contextByActionableInputId = new Map<string, AssistantAutomationInputSummary[]>()
  const unpairedContext: AssistantAutomationInputSummary[] = []

  for (const context of inputSummaries.filter((summary) => summary.contextOnly)) {
    const target = selectEarliestCausalActionableInput({
      actionable,
      context,
    })
    if (!target) {
      unpairedContext.push(context)
      continue
    }
    const matching = contextByActionableInputId.get(target.inputId) ?? []
    matching.push(context)
    contextByActionableInputId.set(target.inputId, matching)
  }

  const ordered = actionable.flatMap((summary) => [
    ...(contextByActionableInputId.get(summary.inputId) ?? [])
      .sort(compareDeferredContextSemanticOrder),
    summary,
  ])
  return [...ordered, ...unpairedContext.sort(compareDeferredContextSemanticOrder)]
}

function selectEarliestCausalActionableInput(input: {
  actionable: readonly AssistantAutomationInputSummary[]
  context: AssistantAutomationInputSummary
}): AssistantAutomationInputSummary | null {
  let selected: AssistantAutomationInputSummary | null = null
  for (const candidate of input.actionable) {
    if (
      !isSameAssistantDeferredContextRoute(
        input.context.conversation,
        candidate.conversation,
      )
      || compareAssistantTimestampsAscending(
        input.context.occurredAt,
        candidate.occurredAt,
      ) > 0
    ) {
      continue
    }
    if (
      selected === null
      || compareAssistantTimestampsAscending(
        candidate.occurredAt,
        selected.occurredAt,
      ) < 0
    ) {
      selected = candidate
    }
  }
  return selected
}

function compareDeferredContextSemanticOrder(
  left: AssistantAutomationInputSummary,
  right: AssistantAutomationInputSummary,
): number {
  return compareAssistantInputSummaryOrder(left, right)
}

export function isSameAssistantDeferredContextRoute(
  left: AssistantInputConversationRef,
  right: AssistantInputConversationRef,
): boolean {
  return (
    left.source === 'linq' &&
    right.source === 'linq' &&
    left.accountId === right.accountId &&
    left.source === right.source &&
    left.threadId === right.threadId &&
    left.threadIsDirect === false &&
    right.threadIsDirect === false
  )
}

function nextActionableInputSharesReplyAnchor(input: {
  actionableReplyAnchor: string | null
  conversation: AssistantInputConversationRef
  inputSummaries: readonly AssistantAutomationInputSummary[]
  startIndex: number
}): boolean {
  for (let index = input.startIndex; index < input.inputSummaries.length; index += 1) {
    const candidate = input.inputSummaries[index]
    if (
      !candidate ||
      !isSameAssistantConversationRef(
        input.conversation,
        candidate.conversation,
      )
    ) {
      return false
    }
    if (!candidate.contextOnly) {
      return candidate.replyToMessageId === input.actionableReplyAnchor
    }
  }
  return false
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
  if (!isSameAssistantConversationRef(first.conversation, candidate.conversation)) {
    return false
  }
  if (first.contextOnly || candidate.contextOnly) {
    return true
  }
  // Native reply targets identify the specific prior assistant message the
  // input is answering. Mixing them into one group would inject only one
  // turn context for messages that semantically need different anchors;
  // split the group at every reply-anchor boundary so each anchored input
  // gets its own turn with its own context.
  return first.replyToMessageId === candidate.replyToMessageId
}
