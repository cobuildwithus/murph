import { describe, expect, it } from 'vitest'
import type { InboxListResult } from '@murphai/operator-config/inbox-cli-contracts'
import {
  assistantInputConversationRefFromCapture,
  isSameAssistantConversationCapture,
} from '../src/assistant/conversation-ref.ts'

type AssistantAutomationInputSummary = InboxListResult['items'][number]

function createCaptureSummary(
  overrides: Partial<AssistantAutomationInputSummary> = {},
): AssistantAutomationInputSummary {
  return {
    captureId: overrides.captureId ?? 'cap_1',
    source: overrides.source ?? 'telegram',
    accountId: overrides.accountId ?? 'acct_1',
    externalId: overrides.externalId ?? 'ext_1',
    threadId: overrides.threadId ?? 'thread_1',
    threadTitle: overrides.threadTitle ?? null,
    threadIsDirect: overrides.threadIsDirect ?? true,
    actorId: overrides.actorId ?? 'actor_1',
    actorName: overrides.actorName ?? 'Sender',
    actorIsSelf: overrides.actorIsSelf ?? false,
    occurredAt: overrides.occurredAt ?? '2026-04-22T10:00:00.000Z',
    receivedAt: overrides.receivedAt ?? '2026-04-22T10:00:01.000Z',
    text: overrides.text ?? 'hello',
    attachmentCount: overrides.attachmentCount ?? 0,
    sourceDirectory: overrides.sourceDirectory ?? 'raw/inbox/telegram/cap_1',
    eventId: overrides.eventId ?? 'evt_1',
    createdAt: overrides.createdAt ?? '2026-04-22T10:00:02.000Z',
    promotions: overrides.promotions ?? [],
  }
}

describe('assistantInputConversationRefFromCapture', () => {
  it('normalizes the capture-based conversation identity', () => {
    const capture = createCaptureSummary({
      source: 'email',
      accountId: ' inbox@example.com ',
      actorId: ' sender@example.com ',
      threadId: ' thread-123 ',
      actorIsSelf: true,
      threadIsDirect: false,
    })

    expect(assistantInputConversationRefFromCapture(capture)).toEqual({
      accountId: 'inbox@example.com',
      actorId: 'sender@example.com',
      actorIsSelf: true,
      source: 'email',
      threadId: 'thread-123',
      threadIsDirect: false,
    })
  })
})

describe('isSameAssistantConversationCapture', () => {
  it('matches captures from the same source/account/thread/actor lane', () => {
    const first = createCaptureSummary({
      captureId: 'cap_a',
      externalId: 'ext_a',
      eventId: 'evt_a',
    })
    const second = createCaptureSummary({
      captureId: 'cap_b',
      externalId: 'ext_b',
      eventId: 'evt_b',
      occurredAt: '2026-04-22T10:01:00.000Z',
      createdAt: '2026-04-22T10:01:01.000Z',
      text: 'follow up',
    })

    expect(isSameAssistantConversationCapture(first, second)).toBe(true)
  })

  it('rejects captures when any conversation identity field changes', () => {
    const first = createCaptureSummary()
    const differingCaptures = [
      createCaptureSummary({
        captureId: 'cap_other_source',
        externalId: 'ext_other_source',
        eventId: 'evt_other_source',
        source: 'sms',
      }),
      createCaptureSummary({
        captureId: 'cap_other_account',
        externalId: 'ext_other_account',
        eventId: 'evt_other_account',
        accountId: 'acct_2',
      }),
      createCaptureSummary({
        captureId: 'cap_other_actor',
        externalId: 'ext_other_actor',
        eventId: 'evt_other_actor',
        actorId: 'actor_2',
      }),
      createCaptureSummary({
        captureId: 'cap_other_thread',
        externalId: 'ext_other_thread',
        eventId: 'evt_other_thread',
        threadId: 'thread_2',
      }),
      createCaptureSummary({
        captureId: 'cap_other_directness',
        externalId: 'ext_other_directness',
        eventId: 'evt_other_directness',
        threadIsDirect: false,
      }),
      createCaptureSummary({
        captureId: 'cap_self_echo',
        externalId: 'ext_self_echo',
        eventId: 'evt_self_echo',
        actorIsSelf: true,
      }),
    ]

    for (const capture of differingCaptures) {
      expect(isSameAssistantConversationCapture(first, capture)).toBe(false)
    }
  })
})
