import { describe, expect, it } from 'vitest'
import { shouldGroupAdjacentConversationInput } from '../src/assistant/automation/grouping.ts'
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
})
