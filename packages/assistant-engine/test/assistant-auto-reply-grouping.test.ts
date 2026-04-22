import { describe, expect, it } from 'vitest'
import type { InboxListResult } from '@murphai/operator-config/inbox-cli-contracts'
import { shouldGroupAdjacentConversationCapture } from '../src/assistant/automation/grouping.ts'

type AssistantInboxCaptureSummary = InboxListResult['items'][number]

function createCaptureSummary(
  overrides: Partial<AssistantInboxCaptureSummary> = {},
): AssistantInboxCaptureSummary {
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
    envelopePath: overrides.envelopePath ?? 'captures/cap_1.json',
    eventId: overrides.eventId ?? 'evt_1',
    createdAt: overrides.createdAt ?? '2026-04-22T10:00:02.000Z',
    promotions: overrides.promotions ?? [],
  }
}

describe('shouldGroupAdjacentConversationCapture', () => {
  it('groups adjacent captures from the same conversation lane', () => {
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

    expect(shouldGroupAdjacentConversationCapture(first, second)).toBe(true)
  })

  it('stops grouping when the conversation lane changes', () => {
    const first = createCaptureSummary()
    const differentThread = createCaptureSummary({
      captureId: 'cap_other_thread',
      externalId: 'ext_other_thread',
      eventId: 'evt_other_thread',
      threadId: 'thread_2',
    })

    expect(shouldGroupAdjacentConversationCapture(first, differentThread)).toBe(false)
  })
})
