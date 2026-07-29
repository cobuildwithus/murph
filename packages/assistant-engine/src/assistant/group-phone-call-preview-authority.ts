import type {
  HostedPhoneCallBrief,
} from '@murphai/hosted-execution/phone-calls'
import type {
  AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'

import { readAssistantInputEvent } from './input-store.js'
import {
  compareAssistantOutboxDeliverySequenceOrder,
  listAssistantOutboxIntents,
} from './outbox.js'

export const ASSISTANT_GROUP_PHONE_CALL_PREVIEW_HEADING =
  'GROUP CALL PREVIEW'
export const ASSISTANT_GROUP_PHONE_CALL_NO_TRANSFER_LINE =
  'Transfer to a participant: no'

export async function hasDeliveredAssistantGroupPhoneCallPreview(input: {
  acceptedInputIds: readonly string[]
  brief?: HostedPhoneCallBrief
  channel?: string | null
  sessionId: string
  vault: string
}): Promise<boolean> {
  const channel = input.channel?.trim().toLowerCase() ?? ''
  if (channel !== 'linq' && channel !== 'telegram') {
    return false
  }

  const currentInputId = input.acceptedInputIds.at(-1)
  if (!currentInputId) {
    return false
  }
  const currentInput = await readAssistantInputEvent({
    inputId: currentInputId,
    vault: input.vault,
  })
  if (!currentInput) {
    return false
  }
  const currentConversation = currentInput.conversation
  const currentThreadId = currentConversation?.threadId?.trim() ?? ''
  if (
    currentConversation?.source?.trim().toLowerCase() !== channel
    || currentConversation.threadIsDirect !== false
    || !currentThreadId
  ) {
    return false
  }
  const currentInputReceivedAtMs = Date.parse(currentInput.receivedAt ?? '')
  if (!Number.isFinite(currentInputReceivedAtMs)) {
    return false
  }

  const routeIntents = (await listAssistantOutboxIntents(input.vault))
    .filter((intent) =>
      intent.sessionId === input.sessionId
      && intent.operation === null
      && intent.threadIsDirect === false
      && intent.channel?.trim().toLowerCase() === channel
      && intent.threadId === currentThreadId
    )
  const previewTurns = groupAssistantOutboxIntentsByTurn(routeIntents)
    .filter((turn) =>
      normalizePreviewText(joinAssistantOutboxTurnMessages(turn))
        .includes(normalizePreviewText(
          ASSISTANT_GROUP_PHONE_CALL_PREVIEW_HEADING,
        ))
    )
    .sort((left, right) =>
      compareAssistantOutboxTurnCreationOrder(right, left)
    )
  const latestPreviewTurn = previewTurns[0]
  if (!latestPreviewTurn) {
    return false
  }

  const answeredInputIds = new Set(
    latestPreviewTurn.flatMap((intent) => intent.answeredMailboxItemIds),
  )
  if (
    answeredInputIds.size === 0
    || answeredInputIds.has(currentInputId)
    || latestPreviewTurn.some((intent) => {
      const sentAtMs = intent.sentAt ? Date.parse(intent.sentAt) : Number.NaN
      return intent.status !== 'sent'
        || !Number.isFinite(sentAtMs)
        || sentAtMs > currentInputReceivedAtMs
    })
  ) {
    return false
  }

  return input.brief === undefined
    || assistantOutboxTurnContainsPhoneCallBrief(
      latestPreviewTurn,
      input.brief,
    )
}

function groupAssistantOutboxIntentsByTurn(
  intents: readonly AssistantOutboxIntent[],
): AssistantOutboxIntent[][] {
  const intentsByTurn = new Map<string, AssistantOutboxIntent[]>()
  for (const intent of intents) {
    const turnIntents = intentsByTurn.get(intent.turnId)
    if (turnIntents) {
      turnIntents.push(intent)
    } else {
      intentsByTurn.set(intent.turnId, [intent])
    }
  }
  return [...intentsByTurn.values()]
}

function joinAssistantOutboxTurnMessages(
  intents: readonly AssistantOutboxIntent[],
): string {
  return [...intents]
    .sort(compareAssistantOutboxDeliverySequenceOrder)
    .map((intent) => intent.message)
    .join('\n')
}

function compareAssistantOutboxTurnCreationOrder(
  left: readonly AssistantOutboxIntent[],
  right: readonly AssistantOutboxIntent[],
): number {
  const leftCreatedAt = Math.max(
    ...left.map((intent) => Date.parse(intent.createdAt)),
  )
  const rightCreatedAt = Math.max(
    ...right.map((intent) => Date.parse(intent.createdAt)),
  )
  return leftCreatedAt - rightCreatedAt
}

function assistantOutboxTurnContainsPhoneCallBrief(
  intents: readonly AssistantOutboxIntent[],
  brief: HostedPhoneCallBrief,
): boolean {
  if (brief.allowTransferToUser) {
    return false
  }
  const normalizedPreview = normalizePreviewText(
    joinAssistantOutboxTurnMessages(intents),
  )
  const requiredValues = [
    ASSISTANT_GROUP_PHONE_CALL_PREVIEW_HEADING,
    ASSISTANT_GROUP_PHONE_CALL_NO_TRANSFER_LINE,
    brief.to.label,
    brief.to.phoneNumber,
    brief.callerName,
    brief.goal,
    ...brief.instructions,
    ...Object.entries(brief.shareableFacts).flatMap(([key, value]) => [
      key,
      value,
    ]),
    brief.successCriteria,
    brief.timeZone,
  ].filter((value): value is string => typeof value === 'string')

  return requiredValues.every((value) =>
    normalizedPreview.includes(normalizePreviewText(value))
  )
}

function normalizePreviewText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
}
