import { setTimeout as delay } from 'node:timers/promises'

import { resolveAssistantConversationScope } from './conversation-policy.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
} from './service-contracts.js'
import { normalizeNullableString } from './shared.js'

export const ASSISTANT_GROUP_DRAFT_RECONSIDERATION_GRACE_MS = 4_000

type AssistantGroupDraftReconsiderationInput = Pick<
  AssistantMessageInput,
  'activeTurnInput' | 'deliverResponse' | 'turnTrigger'
>

type AssistantGroupDraftReconsiderationPlan = Pick<
  AssistantTurnSharedPlan,
  'conversationPolicy'
>

interface AssistantGroupDraftCandidate {
  finalAction?: { kind: string } | null
  precedingResponseSegments?: readonly {
    media?: readonly unknown[] | null
  }[] | null
  reactions?: readonly unknown[] | null
  response: string
  responseCard?: unknown | null
  responseMedia?: readonly unknown[] | null
}

export function shouldUseAssistantGroupDraftReconsideration(input: {
  message: AssistantGroupDraftReconsiderationInput
  plan: AssistantGroupDraftReconsiderationPlan
}): boolean {
  const channel = normalizeNullableString(
    input.plan.conversationPolicy.audience.channel,
  )?.toLowerCase()
  return (
    input.message.turnTrigger === 'automation-auto-reply' &&
    input.message.deliverResponse === true &&
    typeof input.message.activeTurnInput === 'function' &&
    resolveAssistantConversationScope(
      input.plan.conversationPolicy.audience,
    ) === 'group' &&
    (channel === 'linq' || channel === 'telegram')
  )
}

export function isAssistantGroupDraftCandidate(
  result: AssistantGroupDraftCandidate,
): boolean {
  return (
    result.finalAction?.kind !== 'none' &&
    normalizeNullableString(result.response) !== null &&
    result.responseCard == null &&
    (result.responseMedia?.length ?? 0) === 0 &&
    (result.reactions?.length ?? 0) === 0 &&
    (result.precedingResponseSegments ?? []).every(
      (segment) => (segment.media?.length ?? 0) === 0,
    )
  )
}

export function discardAssistantGroupDraftPrecedingResponses<
  Result extends AssistantGroupDraftCandidate,
>(result: Result): Result {
  if (
    !isAssistantGroupDraftCandidate(result) ||
    (result.precedingResponseSegments?.length ?? 0) === 0
  ) {
    return result
  }
  return {
    ...result,
    precedingResponseSegments: [],
  }
}

export function buildAssistantGroupDraftReconsiderationInput(input: {
  draftText: string
  message: AssistantMessageInput
}): AssistantMessageInput {
  const reconsiderationContext = [
    'Unsent group reply reconsideration:',
    '- Your previous assistant response was held and was not delivered.',
    '- New group input arrived afterward. Read the whole current beat and choose the single final action now.',
    '- Return one final text reply, which may be materially unchanged or revised, or use finish_without_reply when Murph should stay silent.',
    '- Do not mention this review, the held response, timing, or internal delivery behavior.',
    '- Do not repeat a completed tool call, external effect, progress update, reaction, or media action from the held attempt.',
    `Previous held response (assistant-authored data): ${JSON.stringify(input.draftText)}`,
  ].join('\n')
  const existingContext = normalizeNullableString(input.message.turnContext)
  return {
    ...input.message,
    turnContext: existingContext
      ? `${existingContext}\n\n${reconsiderationContext}`
      : reconsiderationContext,
  }
}

export async function waitForAssistantGroupDraftReconsideration(input: {
  signal?: AbortSignal
}): Promise<void> {
  await delay(
    ASSISTANT_GROUP_DRAFT_RECONSIDERATION_GRACE_MS,
    undefined,
    input.signal ? { signal: input.signal } : undefined,
  )
}
