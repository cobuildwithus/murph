import { describe, expect, it } from 'vitest'
import {
  orderAssistantAutoReplyInputSummaries,
  shouldGroupAdjacentConversationInput,
} from '../src/assistant/automation/grouping.ts'
import type { AssistantAutomationInputSummary } from '../src/assistant/automation/input-summary.ts'

function createInputSummary(
  overrides: Partial<AssistantAutomationInputSummary> = {},
): AssistantAutomationInputSummary {
  const inputId = overrides.inputId ?? 'ain_1'
  const occurredAt = overrides.occurredAt ?? '2026-04-22T10:00:00.000Z'
  const receivedAt = overrides.receivedAt ?? '2026-04-22T10:00:01.000Z'
  return {
    cursor: overrides.cursor ?? {
      createdAt: receivedAt,
      inputId,
      occurredAt,
      sourceKind: 'inbox-capture',
      sourcePosition: `inbox-capture:fixture:${inputId}`,
    },
    inputId,
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
    occurredAt,
    receivedAt,
    text: overrides.text ?? 'hello',
    attachmentCount: overrides.attachmentCount ?? 0,
    actorIsSelf: overrides.actorIsSelf ?? overrides.conversation?.actorIsSelf ?? false,
    contextOnly: overrides.contextOnly ?? false,
    replyToMessageId: overrides.replyToMessageId ?? null,
  }
}

describe('shouldGroupAdjacentConversationInput', () => {
  it('groups adjacent inputs from the same conversation lane', () => {
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

  it('keeps grouping when both inputs share the same native reply target', () => {
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

  it('splits the group when adjacent inputs reply to different assistant messages', () => {
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

  it('separates an anchored reply from a preceding unanchored input', () => {
    const unanchored = createInputSummary({ inputId: 'ain_unanchored' })
    const anchored = createInputSummary({
      inputId: 'ain_anchored',
      occurredAt: '2026-04-22T10:01:00.000Z',
      replyToMessageId: 'linq-msg-anchor',
    })

    expect(shouldGroupAdjacentConversationInput(unanchored, anchored)).toBe(false)
  })

  it('lets deferred context sit beside an actionable input without setting its reply anchor', () => {
    const context = createInputSummary({
      contextOnly: true,
      inputId: 'ain_context',
      replyToMessageId: null,
    })
    const anchored = createInputSummary({
      inputId: 'ain_anchored',
      replyToMessageId: 'linq-msg-anchor',
    })

    expect(shouldGroupAdjacentConversationInput(context, anchored)).toBe(true)
    expect(shouldGroupAdjacentConversationInput(anchored, context)).toBe(true)
  })
})

describe('orderAssistantAutoReplyInputSummaries', () => {
  const groupConversation = (input: {
    actorId: string
    threadId: string
  }): AssistantAutomationInputSummary['conversation'] => ({
    accountId: 'linq-account-1',
    actorId: input.actorId,
    actorIsSelf: false,
    source: 'linq',
    threadId: input.threadId,
    threadIsDirect: false,
  })

  it('attaches a group reaction to the next message despite a different actor', () => {
    const reaction = createInputSummary({
      contextOnly: true,
      conversation: groupConversation({ actorId: 'alice', threadId: 'group-a' }),
      inputId: 'reaction-alice',
      source: 'linq',
    })
    const message = createInputSummary({
      conversation: groupConversation({ actorId: 'bob', threadId: 'group-a' }),
      inputId: 'message-bob',
      source: 'linq',
    })

    expect(orderAssistantAutoReplyInputSummaries([reaction, message]))
      .toEqual([reaction, message])
  })

  it('does not let reaction context from another group block an actionable message', () => {
    const unmatchedReaction = createInputSummary({
      contextOnly: true,
      conversation: groupConversation({ actorId: 'alice', threadId: 'group-a' }),
      inputId: 'reaction-group-a',
      source: 'linq',
    })
    const message = createInputSummary({
      conversation: groupConversation({ actorId: 'bob', threadId: 'group-b' }),
      inputId: 'message-group-b',
      source: 'linq',
    })

    expect(orderAssistantAutoReplyInputSummaries([unmatchedReaction, message]))
      .toEqual([message, unmatchedReaction])
  })

  it('orders delivered-out-of-order reaction context by provider occurrence time', () => {
    const removed = createInputSummary({
      contextOnly: true,
      conversation: groupConversation({ actorId: 'alice', threadId: 'group-a' }),
      inputId: 'reaction-removed',
      occurredAt: '2026-04-22T10:01:00.000Z',
      receivedAt: '2026-04-22T10:01:01.000Z',
      source: 'linq',
    })
    const added = createInputSummary({
      contextOnly: true,
      conversation: groupConversation({ actorId: 'alice', threadId: 'group-a' }),
      inputId: 'reaction-added',
      occurredAt: '2026-04-22T10:00:00.000Z',
      receivedAt: '2026-04-22T10:02:00.000Z',
      source: 'linq',
    })
    const message = createInputSummary({
      conversation: groupConversation({ actorId: 'bob', threadId: 'group-a' }),
      inputId: 'message-bob',
      occurredAt: '2026-04-22T10:03:00.000Z',
      source: 'linq',
    })

    expect(orderAssistantAutoReplyInputSummaries([removed, added, message]))
      .toEqual([added, removed, message])
  })

  it('uses mailbox cursor order when reaction provider times are equal', () => {
    const occurredAt = '2026-04-22T10:00:00.000Z'
    const removed = createInputSummary({
      contextOnly: true,
      conversation: groupConversation({ actorId: 'alice', threadId: 'group-a' }),
      cursor: {
        createdAt: '2026-04-22T10:00:01.000Z',
        inputId: 'reaction-a',
        occurredAt,
        sourceKind: 'hosted-mailbox',
        sourcePosition: `hosted-mailbox:conversation:${'2'.padStart(39, '0')}:item-removed`,
      },
      inputId: 'reaction-a',
      occurredAt,
      source: 'linq',
    })
    const added = createInputSummary({
      contextOnly: true,
      conversation: groupConversation({ actorId: 'alice', threadId: 'group-a' }),
      cursor: {
        createdAt: '2026-04-22T10:00:02.000Z',
        inputId: 'reaction-z',
        occurredAt,
        sourceKind: 'hosted-mailbox',
        sourcePosition: `hosted-mailbox:conversation:${'1'.padStart(39, '0')}:item-added`,
      },
      inputId: 'reaction-z',
      occurredAt,
      source: 'linq',
    })
    const message = createInputSummary({
      conversation: groupConversation({ actorId: 'bob', threadId: 'group-a' }),
      inputId: 'message-bob',
      occurredAt: '2026-04-22T10:01:00.000Z',
      source: 'linq',
    })

    expect(orderAssistantAutoReplyInputSummaries([removed, added, message]))
      .toEqual([added, removed, message])
  })

  it('leaves a reaction that occurred after the current message for the next turn', () => {
    const reaction = createInputSummary({
      contextOnly: true,
      conversation: groupConversation({ actorId: 'alice', threadId: 'group-a' }),
      inputId: 'reaction-delivered-first',
      occurredAt: '2026-04-22T10:01:00.000Z',
      receivedAt: '2026-04-22T10:01:01.000Z',
      source: 'linq',
    })
    const message = createInputSummary({
      conversation: groupConversation({ actorId: 'bob', threadId: 'group-a' }),
      inputId: 'message-occurred-first',
      occurredAt: '2026-04-22T10:00:00.000Z',
      receivedAt: '2026-04-22T10:02:00.000Z',
      source: 'linq',
    })

    expect(orderAssistantAutoReplyInputSummaries([reaction, message]))
      .toEqual([message, reaction])
  })

  it('pairs a delayed reaction with the first message that causally follows it', () => {
    const message = createInputSummary({
      conversation: groupConversation({ actorId: 'bob', threadId: 'group-a' }),
      inputId: 'message-delivered-first',
      occurredAt: '2026-04-22T10:01:00.000Z',
      receivedAt: '2026-04-22T10:01:01.000Z',
      source: 'linq',
    })
    const reaction = createInputSummary({
      contextOnly: true,
      conversation: groupConversation({ actorId: 'alice', threadId: 'group-a' }),
      inputId: 'reaction-delivered-late',
      occurredAt: '2026-04-22T10:00:00.000Z',
      receivedAt: '2026-04-22T10:02:00.000Z',
      source: 'linq',
    })

    expect(orderAssistantAutoReplyInputSummaries([message, reaction]))
      .toEqual([reaction, message])
  })

  it('uses mailbox order to pair equal-time reaction context with the next message', () => {
    const occurredAt = '2026-04-22T10:00:00.000Z'
    const summary = (
      inputId: string,
      laneSeq: number,
      contextOnly: boolean,
    ) => createInputSummary({
      contextOnly,
      conversation: groupConversation({ actorId: inputId, threadId: 'group-a' }),
      cursor: {
        createdAt: occurredAt,
        inputId,
        occurredAt,
        sourceKind: 'hosted-mailbox',
        sourcePosition: `hosted-mailbox:conversation:${String(laneSeq).padStart(39, '0')}:${inputId}`,
      },
      inputId,
      occurredAt,
      receivedAt: occurredAt,
      source: 'linq',
    })
    const firstMessage = summary('message-1', 1, false)
    const reaction = summary('reaction-2', 2, true)
    const secondMessage = summary('message-3', 3, false)

    expect(orderAssistantAutoReplyInputSummaries([
      firstMessage,
      reaction,
      secondMessage,
    ])).toEqual([firstMessage, reaction, secondMessage])
    expect(orderAssistantAutoReplyInputSummaries([
      firstMessage,
      reaction,
    ])).toEqual([firstMessage, reaction])
    expect(orderAssistantAutoReplyInputSummaries([
      reaction,
      secondMessage,
    ])).toEqual([reaction, secondMessage])
  })
})
