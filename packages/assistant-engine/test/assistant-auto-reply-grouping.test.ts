import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_AUTO_REPLY_COMPOUND_INPUT_MAX,
  collectAssistantAutoReplyGroup,
  shouldGroupAdjacentAssistantInputCandidates,
  shouldGroupAdjacentConversationInput,
} from '../src/assistant/automation/grouping.ts'
import type { AssistantInputCandidate } from '../src/assistant/input-source.ts'
import type { AssistantAutomationInputSummary } from '../src/assistant/automation/input-summary.ts'

function createInputSummary(
  overrides: Partial<AssistantAutomationInputSummary> = {},
): AssistantAutomationInputSummary {
  return {
    inputId: overrides.inputId ?? 'ain_1',
    optionalInboxCaptureId: overrides.optionalInboxCaptureId ?? 'cap_1',
    source: overrides.source ?? 'telegram',
    conversation: overrides.conversation ?? {
      accountId: 'acct_1',
      actorId: 'actor_1',
      actorIsSelf: false,
      source: 'telegram',
      threadId: 'thread_1',
      threadIsDirect: true,
    },
    occurredAt: overrides.occurredAt ?? '2026-04-22T10:00:00.000Z',
    receivedAt: overrides.receivedAt ?? '2026-04-22T10:00:01.000Z',
    text: overrides.text ?? 'hello',
    attachmentCount: overrides.attachmentCount ?? 0,
    actorIsSelf: overrides.actorIsSelf ?? overrides.conversation?.actorIsSelf ?? false,
    ...(overrides.affirmativeReaction === true
      ? { affirmativeReaction: true }
      : {}),
    deliveryTarget: overrides.deliveryTarget ?? 'provider-thread-1',
    groupRoomBatchingEligible: overrides.groupRoomBatchingEligible ?? false,
    projectionReady: overrides.projectionReady ?? true,
    replyToMessageId: overrides.replyToMessageId ?? null,
  }
}

function createAuthenticatedGroupSummary(
  overrides: Partial<AssistantAutomationInputSummary> = {},
): AssistantAutomationInputSummary {
  return createInputSummary({
    conversation: {
      accountId: 'acct_1',
      actorId: 'actor_1',
      actorIsSelf: false,
      source: 'telegram',
      threadId: 'room_1',
      threadIsDirect: false,
    },
    deliveryTarget: 'provider-room-1',
    groupRoomBatchingEligible: true,
    ...overrides,
  })
}

function createAuthenticatedGroupCandidate(input: {
  completion?: boolean
  inputId: string
  projectionStatus?: AssistantInputCandidate['projection']['status']
  threadId?: string
}): AssistantInputCandidate {
  const threadId = input.threadId ?? 'room_1'
  const sourceRef = {
    dedupeKey: `dedupe_${input.inputId}`,
    eventId: `event_${input.inputId}`,
    itemId: `item_${input.inputId}`,
    kind: 'hosted-mailbox' as const,
    lane: input.completion ? 'system' as const : 'conversation' as const,
    laneSeq: input.completion ? `image-completion:${input.inputId}` : '42',
    payloadSchema: input.completion
      ? 'murph.hosted-image-completion.v1'
      : 'murph.hosted-mailbox-payload.v1',
    payloadSource: 'inline' as const,
    source: 'hosted-mailbox' as const,
    wakeSchema: input.completion
      ? 'murph.hosted-image-completion.v1'
      : 'murph.hosted-execution-wake.v1',
  }
  return {
    acceptedInput: {
      captureIds: [],
      contentRef: {
        kind: 'assistant-input-event',
        refId: input.inputId,
        version: 'murph.assistant-input-event.v1',
      },
      id: input.inputId,
      source: 'assistant-input',
    },
    event: {
      attachmentCount: 0,
      attachmentDescriptors: [],
      attachmentEvidence: {
        attachments: [],
        optionalInboxCaptureId: null,
        reasonCode: null,
        source: null,
        status: 'not_attempted',
        updatedAt: null,
      },
      conversation: {
        accountId: 'acct_1',
        actorId: input.completion ? null : 'actor_1',
        actorIsSelf: false,
        ...(input.completion
          ? { sessionId: 'asst_image_completion_group' }
          : {}),
        source: 'linq',
        threadId,
        threadIsDirect: false,
      },
      cursor: {
        createdAt: input.completion
          ? '2026-04-22T10:01:00.000Z'
          : '2026-04-22T10:00:00.000Z',
        inputId: input.inputId,
        occurredAt: '2026-04-22T10:00:00.000Z',
        sourceKind: 'hosted-mailbox',
        sourcePosition: `hosted-mailbox:${sourceRef.lane}:${sourceRef.laneSeq}`,
      },
      inputId: input.inputId,
      occurredAt: '2026-04-22T10:00:00.000Z',
      receivedAt: '2026-04-22T10:00:01.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'provider-message-1',
        threadId,
      },
      source: 'linq',
      sourceMetadata: {
        externalThreadRouteAuthorityPresent: true,
        kind: 'linq',
        partCount: 1,
        reactionEligible: false,
        replyToMessageId: null,
        service: 'iMessage',
      },
      sourceRef,
      text: 'input',
      transcriptText: 'input',
      userMessageContent: [{ text: 'input', type: 'text' }],
    },
    projection: {
      captureId: null,
      reasonCode: null,
      status: input.projectionStatus ?? 'not_attempted',
    },
  }
}

describe('shouldGroupAdjacentConversationInput', () => {
  it('groups adjacent inputs from the same direct conversation lane', () => {
    const first = createInputSummary({
      inputId: 'ain_a',
      optionalInboxCaptureId: 'cap_a',
    })
    const second = createInputSummary({
      inputId: 'ain_b',
      optionalInboxCaptureId: 'cap_b',
      occurredAt: '2026-04-22T10:01:00.000Z',
      text: 'follow up',
    })

    expect(shouldGroupAdjacentConversationInput(first, second)).toBe(true)
  })

  it('stops direct grouping when the conversation actor changes', () => {
    const first = createInputSummary()
    const differentActor = createInputSummary({
      inputId: 'ain_other_actor',
      conversation: {
        ...first.conversation,
        actorId: 'actor_2',
      },
    })

    expect(shouldGroupAdjacentConversationInput(first, differentActor)).toBe(false)
  })

  it('stops grouping when the conversation lane changes', () => {
    const first = createInputSummary()
    const differentThread = createInputSummary({
      inputId: 'ain_other_thread',
      optionalInboxCaptureId: 'cap_other_thread',
      conversation: {
        accountId: 'acct_1',
        actorId: 'actor_1',
        actorIsSelf: false,
        source: 'telegram',
        threadId: 'thread_2',
        threadIsDirect: true,
      },
    })

    expect(shouldGroupAdjacentConversationInput(first, differentThread)).toBe(false)
  })

  it('keeps direct grouping when both inputs share the same native reply target', () => {
    const first = createInputSummary({
      inputId: 'ain_reply_a',
      replyToMessageId: 'linq-msg-shared',
    })
    const second = createInputSummary({
      inputId: 'ain_reply_b',
      occurredAt: '2026-04-22T10:01:00.000Z',
      replyToMessageId: 'linq-msg-shared',
    })

    expect(shouldGroupAdjacentConversationInput(first, second)).toBe(true)
  })

  it('keeps affirmative reactions separate from adjacent ordinary replies', () => {
    const ordinary = createAuthenticatedGroupSummary({
      inputId: 'ain_ordinary',
      replyToMessageId: 'linq-msg-shared',
    })
    const reaction = createAuthenticatedGroupSummary({
      affirmativeReaction: true,
      inputId: 'ain_reaction',
      occurredAt: '2026-04-22T10:01:00.000Z',
      replyToMessageId: 'linq-msg-shared',
      text: 'Reacted with a like reaction.',
    })

    expect(shouldGroupAdjacentConversationInput(ordinary, reaction)).toBe(false)
    expect(shouldGroupAdjacentConversationInput(reaction, ordinary)).toBe(false)
  })

  it('splits direct inputs that reply to different assistant messages', () => {
    const first = createInputSummary({
      inputId: 'ain_reply_m1',
      replyToMessageId: 'linq-msg-m1',
    })
    const replyToM2 = createInputSummary({
      inputId: 'ain_reply_m2',
      occurredAt: '2026-04-22T10:01:00.000Z',
      replyToMessageId: 'linq-msg-m2',
    })

    expect(shouldGroupAdjacentConversationInput(first, replyToM2)).toBe(false)
  })

  it('separates a direct anchored reply from a preceding unanchored input', () => {
    const unanchored = createInputSummary({ inputId: 'ain_unanchored' })
    const anchored = createInputSummary({
      inputId: 'ain_anchored',
      occurredAt: '2026-04-22T10:01:00.000Z',
      replyToMessageId: 'linq-msg-anchor',
    })

    expect(shouldGroupAdjacentConversationInput(unanchored, anchored)).toBe(false)
  })

  it('batches authenticated group-room successors across actor and reply-anchor changes', () => {
    const first = createAuthenticatedGroupSummary({
      inputId: 'ain_group_actor_a',
      replyToMessageId: 'linq-anchor-a',
    })
    const second = createAuthenticatedGroupSummary({
      inputId: 'ain_group_actor_b',
      conversation: {
        ...first.conversation,
        actorId: 'actor_2',
      },
      replyToMessageId: 'linq-anchor-b',
    })

    expect(shouldGroupAdjacentConversationInput(first, second)).toBe(true)
  })

  it.each([
    ['account', { conversation: {
      accountId: 'acct_2',
      actorId: 'actor_2',
      actorIsSelf: false,
      source: 'telegram',
      threadId: 'room_1',
      threadIsDirect: false,
    } }],
    ['room', { conversation: {
      accountId: 'acct_1',
      actorId: 'actor_2',
      actorIsSelf: false,
      source: 'telegram',
      threadId: 'room_2',
      threadIsDirect: false,
    } }],
    ['delivery route', { deliveryTarget: 'provider-room-2' }],
    ['projection readiness', { projectionReady: false }],
    ['route authority', { groupRoomBatchingEligible: false }],
  ] as const)('does not batch group inputs across a %s mismatch', (_label, patch) => {
    const first = createAuthenticatedGroupSummary({ inputId: 'ain_group_a' })
    const second = createAuthenticatedGroupSummary({
      inputId: 'ain_group_b',
      ...patch,
    })

    expect(shouldGroupAdjacentConversationInput(first, second)).toBe(false)
  })

  it('folds a trusted image completion into the next authenticated group input', () => {
    const completion = createAuthenticatedGroupCandidate({
      completion: true,
      inputId: 'ain_image_completion',
      projectionStatus: 'not_attempted',
    })
    const fresh = createAuthenticatedGroupCandidate({
      inputId: 'ain_fresh_group_input',
      projectionStatus: 'pending',
    })
    const differentRoute = createAuthenticatedGroupCandidate({
      inputId: 'ain_other_group_input',
      projectionStatus: 'pending',
      threadId: 'room_2',
    })

    expect(shouldGroupAdjacentAssistantInputCandidates(completion, fresh)).toBe(true)
    expect(
      shouldGroupAdjacentAssistantInputCandidates(completion, differentRoute),
    ).toBe(false)
    expect(shouldGroupAdjacentAssistantInputCandidates(fresh, completion)).toBe(false)
  })

  it('caps one initial compound turn at 50 and leaves overflow for the next turn', async () => {
    const summaries = Array.from(
      { length: ASSISTANT_AUTO_REPLY_COMPOUND_INPUT_MAX + 1 },
      (_, index) => createAuthenticatedGroupSummary({
        inputId: `ain_group_${index}`,
        occurredAt: new Date(Date.UTC(2026, 3, 22, 10, index)).toISOString(),
        optionalInboxCaptureId: `cap_group_${index}`,
        text: `message ${index}`,
      }),
    )

    const grouped = await collectAssistantAutoReplyGroup({
      inputSummaries: summaries,
      startIndex: 0,
      vault: '/vaults/test',
    })

    expect(grouped.items).toHaveLength(ASSISTANT_AUTO_REPLY_COMPOUND_INPUT_MAX)
    expect(grouped.endIndex).toBe(ASSISTANT_AUTO_REPLY_COMPOUND_INPUT_MAX - 1)
    expect(summaries[grouped.endIndex + 1]?.inputId).toBe('ain_group_50')
  })

})
