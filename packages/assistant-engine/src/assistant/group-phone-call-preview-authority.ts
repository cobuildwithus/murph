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

export interface AssistantGroupPhoneCallPreviewAuthority {
  assistantInputId: string
}

export async function hasDeliveredAssistantGroupPhoneCallPreview(input: {
  acceptedInputIds: readonly string[]
  brief?: HostedPhoneCallBrief
  channel?: string | null
  confirmationInputId?: string
  sessionId: string
  vault: string
}): Promise<boolean> {
  return await resolveDeliveredAssistantGroupPhoneCallPreviewAuthority(input)
    !== null
}

export async function resolveDeliveredAssistantGroupPhoneCallPreviewAuthority(
  input: {
    acceptedInputIds: readonly string[]
    brief?: HostedPhoneCallBrief
    channel?: string | null
    confirmationInputId?: string
    sessionId: string
    vault: string
  },
): Promise<AssistantGroupPhoneCallPreviewAuthority | null> {
  const channel = input.channel?.trim().toLowerCase() ?? ''
  if (channel !== 'linq' && channel !== 'telegram') {
    return null
  }

  const confirmationInputId =
    input.confirmationInputId ?? input.acceptedInputIds.at(-1)
  if (
    !confirmationInputId
    || input.acceptedInputIds.at(-1) !== confirmationInputId
  ) {
    return null
  }
  const confirmationInput = await readAssistantInputEvent({
    inputId: confirmationInputId,
    vault: input.vault,
  })
  if (
    !confirmationInput
    || confirmationInput.sourceRef.kind !== 'hosted-mailbox'
    || confirmationInput.sourceRef.lane !== 'conversation'
  ) {
    return null
  }
  const confirmationConversation = confirmationInput.conversation
  const confirmationThreadId =
    confirmationConversation?.threadId?.trim() ?? ''
  if (
    confirmationConversation?.source?.trim().toLowerCase() !== channel
    || confirmationConversation.threadIsDirect !== false
    || !confirmationThreadId
  ) {
    return null
  }
  const confirmationReceivedAtMs = Date.parse(
    confirmationInput.receivedAt ?? '',
  )
  if (!Number.isFinite(confirmationReceivedAtMs)) {
    return null
  }

  const routeIntents = (await listAssistantOutboxIntents(input.vault))
    .filter((intent) =>
      intent.sessionId === input.sessionId
      && intent.operation === null
      && intent.threadIsDirect === false
      && intent.channel?.trim().toLowerCase() === channel
      && intent.threadId === confirmationThreadId
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
    return null
  }

  const answeredInputIds = new Set(
    latestPreviewTurn.flatMap((intent) => intent.answeredMailboxItemIds),
  )
  if (
    answeredInputIds.size === 0
    || latestPreviewTurn.some((intent) => {
      const sentAtMs = intent.sentAt ? Date.parse(intent.sentAt) : Number.NaN
      return intent.status !== 'sent'
        || !Number.isFinite(sentAtMs)
        || sentAtMs >= confirmationReceivedAtMs
    })
  ) {
    return null
  }

  if (
    input.brief !== undefined
    && !assistantOutboxTurnContainsPhoneCallBrief(
      latestPreviewTurn,
      input.brief,
    )
  ) {
    return null
  }

  return {
    assistantInputId: confirmationInputId,
  }
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
  return normalizePreviewText(joinAssistantOutboxTurnMessages(intents))
    === normalizePreviewText(renderAssistantGroupPhoneCallPreview(brief))
}

export function renderAssistantGroupPhoneCallPreview(
  brief: HostedPhoneCallBrief,
): string {
  return [
    ASSISTANT_GROUP_PHONE_CALL_PREVIEW_HEADING,
    `Destination label: ${JSON.stringify(brief.to.label ?? null)}`,
    `Destination phone number: ${JSON.stringify(brief.to.phoneNumber)}`,
    `Caller name: ${JSON.stringify(brief.callerName ?? null)}`,
    `Goal: ${JSON.stringify(brief.goal)}`,
    `Instructions: ${JSON.stringify(brief.instructions)}`,
    `Shareable facts: ${JSON.stringify(sortRecord(brief.shareableFacts))}`,
    `Success criteria: ${JSON.stringify(brief.successCriteria)}`,
    `Time zone: ${JSON.stringify(brief.timeZone)}`,
    ASSISTANT_GROUP_PHONE_CALL_NO_TRANSFER_LINE,
  ].join('\n')
}

function sortRecord(
  value: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    ),
  )
}

function normalizePreviewText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/gu, '\n')
    .trim()
}
