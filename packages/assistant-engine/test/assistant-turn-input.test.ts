import { describe, expect, it } from 'vitest'
import type { InboxListResult } from '@murphai/operator-config/inbox-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
import {
  createInboxBackedAssistantTurnInputPort,
  createNoopAssistantTurnInputPort,
} from '../src/assistant/turn-input.ts'

type AssistantInboxCaptureSummary = InboxListResult['items'][number]

function createCaptureSummary(
  overrides: Partial<Omit<AssistantInboxCaptureSummary, 'createdAt'>> & {
    createdAt?: string | null
  } = {},
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
    createdAt:
      'createdAt' in overrides
        ? overrides.createdAt ?? undefined
        : '2026-04-22T10:00:02.000Z',
    promotions: overrides.promotions ?? [],
  }
}

function createListResult(input: {
  afterCaptureId?: string | null
  afterCreatedAt?: string | null
  afterOccurredAt?: string | null
  items: readonly AssistantInboxCaptureSummary[]
  limit: number
  oldestFirst: boolean
  sourceId?: string | null
}): InboxListResult {
  const filtered = input.items
    .filter((item) => !input.sourceId || item.source === input.sourceId)
    .filter((item) => {
      if (input.afterCreatedAt) {
        const createdAt = item.createdAt ?? item.occurredAt
        if (createdAt > input.afterCreatedAt) {
          return true
        }

        return (
          createdAt === input.afterCreatedAt &&
          Boolean(input.afterCaptureId) &&
          item.captureId > (input.afterCaptureId as string)
        )
      }

      if (!input.afterOccurredAt) {
        return true
      }

      if (item.occurredAt > input.afterOccurredAt) {
        return true
      }

      return (
        item.occurredAt === input.afterOccurredAt &&
        Boolean(input.afterCaptureId) &&
        item.captureId > (input.afterCaptureId as string)
      )
    })
    .sort((left, right) => {
      const leftTimestamp = left.createdAt ?? left.occurredAt
      const rightTimestamp = right.createdAt ?? right.occurredAt
      if (leftTimestamp !== rightTimestamp) {
        return input.oldestFirst
          ? leftTimestamp.localeCompare(rightTimestamp)
          : rightTimestamp.localeCompare(leftTimestamp)
      }

      return input.oldestFirst
        ? left.captureId.localeCompare(right.captureId)
        : right.captureId.localeCompare(left.captureId)
    })
    .slice(0, input.limit)

  return {
    vault: '/vault',
    filters: {
      sourceId: input.sourceId ?? null,
      limit: input.limit,
      afterCreatedAt: input.afterCreatedAt ?? null,
      afterOccurredAt: input.afterOccurredAt ?? null,
      afterCaptureId: input.afterCaptureId ?? null,
      oldestFirst: input.oldestFirst,
    },
    items: filtered,
  }
}

describe('createInboxBackedAssistantTurnInputPort', () => {
  it('reports no new input for refresh calls', async () => {
    const inboxServices = {
      async list() {
        throw new Error('list should not be called during refresh')
      },
    } as Pick<InboxServices, 'list'> as InboxServices
    const port = createInboxBackedAssistantTurnInputPort({
      inboxServices,
      requestId: null,
      vault: '/vault',
    })

    await expect(
      port.refresh({
        phase: 'request_boundary',
      }),
    ).resolves.toEqual({
      progressed: false,
      reason: 'no_new_input',
    })
  })

  it('lists only new captures from the active conversation', async () => {
    const beforeCursor = createCaptureSummary({
      captureId: 'cap_before',
      externalId: 'ext_before',
      eventId: 'evt_before',
      occurredAt: '2026-04-22T09:59:00.000Z',
      createdAt: '2026-04-22T09:59:01.000Z',
    })
    const sameConversation = createCaptureSummary({
      captureId: 'cap_same',
      externalId: 'ext_same',
      eventId: 'evt_same',
      occurredAt: '2026-04-22T10:01:00.000Z',
      createdAt: '2026-04-22T10:01:01.000Z',
      text: 'same conversation follow up',
    })
    const differentConversation = createCaptureSummary({
      captureId: 'cap_other',
      externalId: 'ext_other',
      eventId: 'evt_other',
      threadId: 'thread_2',
      occurredAt: '2026-04-22T10:02:00.000Z',
      createdAt: '2026-04-22T10:02:01.000Z',
    })
    const alreadyKnown = createCaptureSummary({
      captureId: 'cap_known',
      externalId: 'ext_known',
      eventId: 'evt_known',
      occurredAt: '2026-04-22T10:03:00.000Z',
      createdAt: '2026-04-22T10:03:01.000Z',
    })

    const captures = [beforeCursor, sameConversation, differentConversation, alreadyKnown]
    const inboxServices = {
      async list(input) {
        expect(input.sourceId).toBeNull()
        expect(input.afterCreatedAt).toBe(beforeCursor.createdAt)
        return createListResult({
          afterCaptureId: input.afterCaptureId,
          afterCreatedAt: input.afterCreatedAt,
          afterOccurredAt: input.afterOccurredAt,
          items: captures,
          limit: input.limit ?? 100,
          oldestFirst: input.oldestFirst ?? false,
          sourceId: input.sourceId,
        })
      },
    } as Pick<InboxServices, 'list'> as InboxServices

    const port = createInboxBackedAssistantTurnInputPort({
      inboxServices,
      requestId: 'req_1',
      vault: '/vault',
    })

    const result = await port.listNewConversationCaptures({
      afterCursor: {
        captureId: beforeCursor.captureId,
        createdAt: beforeCursor.createdAt ?? null,
        occurredAt: beforeCursor.occurredAt,
      },
      conversation: {
        accountId: sameConversation.accountId,
        actorId: sameConversation.actorId,
        actorIsSelf: sameConversation.actorIsSelf,
        source: sameConversation.source,
        threadId: sameConversation.threadId,
        threadIsDirect: sameConversation.threadIsDirect,
      },
      knownCaptureIds: [alreadyKnown.captureId],
    })

    expect(result.captures.map((capture) => capture.captureId)).toEqual(['cap_same'])
    expect(result.nextCursor).toEqual({
      captureId: sameConversation.captureId,
      createdAt: sameConversation.createdAt ?? null,
      occurredAt: sameConversation.occurredAt,
    })
  })

  it('pages past unrelated captures until it finds a late match in the same conversation', async () => {
    const beforeCursor = createCaptureSummary({
      captureId: 'cap_before',
      externalId: 'ext_before',
      eventId: 'evt_before',
      occurredAt: '2026-04-22T09:59:00.000Z',
      createdAt: '2026-04-22T09:59:01.000Z',
    })
    const unrelatedCaptures = Array.from({ length: 100 }, (_, index) =>
      createCaptureSummary({
        captureId: `cap_unrelated_${String(index).padStart(3, '0')}`,
        externalId: `ext_unrelated_${index}`,
        eventId: `evt_unrelated_${index}`,
        threadId: 'thread_other',
        occurredAt: `2026-04-22T10:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
        createdAt: `2026-04-22T10:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.500Z`,
      }),
    )
    const lateMatch = createCaptureSummary({
      captureId: 'cap_same_late',
      externalId: 'ext_same_late',
      eventId: 'evt_same_late',
      occurredAt: '2026-04-22T10:02:00.000Z',
      createdAt: '2026-04-22T10:02:01.000Z',
      text: 'late same-conversation follow up',
    })
    const listCalls: Array<{
      afterCaptureId?: string | null
      afterCreatedAt?: string | null
      afterOccurredAt?: string | null
    }> = []
    const captures = [beforeCursor, ...unrelatedCaptures, lateMatch]
    const inboxServices = {
      async list(input) {
        listCalls.push({
          afterCaptureId: input.afterCaptureId,
          afterCreatedAt: input.afterCreatedAt,
          afterOccurredAt: input.afterOccurredAt,
        })
        return createListResult({
          afterCaptureId: input.afterCaptureId,
          afterCreatedAt: input.afterCreatedAt,
          afterOccurredAt: input.afterOccurredAt,
          items: captures,
          limit: input.limit ?? 100,
          oldestFirst: input.oldestFirst ?? false,
          sourceId: input.sourceId,
        })
      },
    } as Pick<InboxServices, 'list'> as InboxServices

    const port = createInboxBackedAssistantTurnInputPort({
      inboxServices,
      requestId: 'req_2',
      vault: '/vault',
    })

    const result = await port.listNewConversationCaptures({
      afterCursor: {
        captureId: beforeCursor.captureId,
        createdAt: beforeCursor.createdAt ?? null,
        occurredAt: beforeCursor.occurredAt,
      },
      conversation: {
        accountId: lateMatch.accountId,
        actorId: lateMatch.actorId,
        actorIsSelf: lateMatch.actorIsSelf,
        source: lateMatch.source,
        threadId: lateMatch.threadId,
        threadIsDirect: lateMatch.threadIsDirect,
      },
    })

    expect(listCalls).toHaveLength(2)
    expect(result.captures.map((capture) => capture.captureId)).toEqual(['cap_same_late'])
    expect(result.nextCursor).toEqual({
      captureId: lateMatch.captureId,
      createdAt: lateMatch.createdAt ?? null,
      occurredAt: lateMatch.occurredAt,
    })
  })

  it('keeps the createdAt tie-breaker when late captures share occurredAt', async () => {
    const beforeCursor = createCaptureSummary({
      captureId: 'cap_z',
      externalId: 'ext_before',
      eventId: 'evt_before',
      occurredAt: '2026-04-22T10:00:00.000Z',
      createdAt: '2026-04-22T10:00:02.000Z',
    })
    const sameOccurredLaterCreated = createCaptureSummary({
      captureId: 'cap_a',
      externalId: 'ext_same',
      eventId: 'evt_same',
      occurredAt: beforeCursor.occurredAt,
      createdAt: '2026-04-22T10:00:03.000Z',
      text: 'same occurredAt, later createdAt',
    })

    const inboxServices = {
      async list(input) {
        expect(input.afterCreatedAt).toBe(beforeCursor.createdAt)
        return createListResult({
          afterCaptureId: input.afterCaptureId,
          afterCreatedAt: input.afterCreatedAt,
          afterOccurredAt: input.afterOccurredAt,
          items: [beforeCursor, sameOccurredLaterCreated],
          limit: input.limit ?? 100,
          oldestFirst: input.oldestFirst ?? false,
          sourceId: input.sourceId,
        })
      },
    } as Pick<InboxServices, 'list'> as InboxServices

    const port = createInboxBackedAssistantTurnInputPort({
      inboxServices,
      requestId: 'req_3',
      vault: '/vault',
    })

    const result = await port.listNewConversationCaptures({
      afterCursor: {
        captureId: beforeCursor.captureId,
        createdAt: beforeCursor.createdAt ?? null,
        occurredAt: beforeCursor.occurredAt,
      },
      conversation: {
        accountId: sameOccurredLaterCreated.accountId,
        actorId: sameOccurredLaterCreated.actorId,
        actorIsSelf: sameOccurredLaterCreated.actorIsSelf,
        source: sameOccurredLaterCreated.source,
        threadId: sameOccurredLaterCreated.threadId,
        threadIsDirect: sameOccurredLaterCreated.threadIsDirect,
      },
    })

    expect(result.captures.map((capture) => capture.captureId)).toEqual(['cap_a'])
    expect(result.nextCursor).toEqual({
      captureId: sameOccurredLaterCreated.captureId,
      createdAt: sameOccurredLaterCreated.createdAt ?? null,
      occurredAt: sameOccurredLaterCreated.occurredAt,
    })
  })

  it('returns the original cursor when the inbox page is empty', async () => {
    const afterCursor = {
      captureId: 'cap_empty',
      createdAt: null,
      occurredAt: '2026-04-22T10:00:00.000Z',
    }
    const inboxServices = {
      async list(input) {
        expect(input.requestId).toBeNull()
        expect(input.afterCreatedAt).toBeNull()
        expect(input.limit).toBe(100)
        return createListResult({
          afterCaptureId: input.afterCaptureId,
          afterCreatedAt: input.afterCreatedAt,
          afterOccurredAt: input.afterOccurredAt,
          items: [],
          limit: input.limit ?? 100,
          oldestFirst: input.oldestFirst ?? false,
          sourceId: input.sourceId,
        })
      },
    } as Pick<InboxServices, 'list'> as InboxServices
    const port = createInboxBackedAssistantTurnInputPort({
      inboxServices,
      requestId: null,
      vault: '/vault',
    })

    await expect(
      port.listNewConversationCaptures({
        afterCursor,
        conversation: {
          accountId: 'acct_1',
          actorId: 'actor_1',
          actorIsSelf: false,
          source: 'telegram',
          threadId: 'thread_1',
          threadIsDirect: true,
        },
        limit: Number.NaN,
      }),
    ).resolves.toEqual({
      captures: [],
      nextCursor: afterCursor,
    })
  })

  it('uses occurredAt ordering when createdAt is absent and respects fractional limits', async () => {
    const first = createCaptureSummary({
      captureId: 'cap_b',
      createdAt: null,
      externalId: 'ext_b',
      eventId: 'evt_b',
      occurredAt: '2026-04-22T10:00:00.000Z',
    })
    const second = createCaptureSummary({
      captureId: 'cap_a',
      createdAt: null,
      externalId: 'ext_a',
      eventId: 'evt_a',
      occurredAt: '2026-04-22T10:00:00.000Z',
    })
    const third = createCaptureSummary({
      captureId: 'cap_c',
      createdAt: null,
      externalId: 'ext_c',
      eventId: 'evt_c',
      occurredAt: '2026-04-22T10:01:00.000Z',
    })
    const inboxServices = {
      async list(input) {
        expect(input.limit).toBe(100)
        return createListResult({
          afterCaptureId: input.afterCaptureId,
          afterCreatedAt: input.afterCreatedAt,
          afterOccurredAt: input.afterOccurredAt,
          items: [first, second, third],
          limit: input.limit ?? 100,
          oldestFirst: input.oldestFirst ?? false,
          sourceId: input.sourceId,
        })
      },
    } as Pick<InboxServices, 'list'> as InboxServices
    const port = createInboxBackedAssistantTurnInputPort({
      inboxServices,
      requestId: 'req_limit',
      vault: '/vault',
    })

    const result = await port.listNewConversationCaptures({
      afterCursor: {
        captureId: 'cap_0',
        createdAt: null,
        occurredAt: '2026-04-22T09:59:00.000Z',
      },
      conversation: {
        accountId: first.accountId,
        actorId: first.actorId,
        actorIsSelf: first.actorIsSelf,
        source: first.source,
        threadId: first.threadId,
        threadIsDirect: first.threadIsDirect,
      },
      limit: 2.9,
    })

    expect(result.captures.map((capture) => capture.captureId)).toEqual([
      'cap_a',
      'cap_b',
    ])
    expect(result.nextCursor).toEqual({
      captureId: 'cap_b',
      createdAt: null,
      occurredAt: '2026-04-22T10:00:00.000Z',
    })
  })
})

describe('createNoopAssistantTurnInputPort', () => {
  it('returns stable no-op refresh and capture-list responses', async () => {
    const afterCursor = {
      captureId: 'cap_1',
      createdAt: '2026-04-22T10:00:02.000Z',
      occurredAt: '2026-04-22T10:00:00.000Z',
    }
    const port = createNoopAssistantTurnInputPort()

    await expect(
      port.refresh({
        phase: 'request_boundary',
      }),
    ).resolves.toEqual({
      progressed: false,
      reason: 'no_port',
    })
    await expect(
      port.listNewConversationCaptures({
        afterCursor,
        conversation: {
          accountId: 'acct_1',
          actorId: 'actor_1',
          actorIsSelf: false,
          source: 'telegram',
          threadId: 'thread_1',
          threadIsDirect: true,
        },
      }),
    ).resolves.toEqual({
      captures: [],
      nextCursor: afterCursor,
    })
  })
})
