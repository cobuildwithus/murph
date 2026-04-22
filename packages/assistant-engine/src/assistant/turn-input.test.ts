import { describe, expect, it } from 'vitest'
import type { InboxListResult } from '@murphai/operator-config/inbox-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
import {
  createAssistantTurnBeforeDeliveryHook,
  createInboxBackedAssistantTurnInputPort,
} from './turn-input.js'

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
      if (left.occurredAt !== right.occurredAt) {
        return input.oldestFirst
          ? left.occurredAt.localeCompare(right.occurredAt)
          : right.occurredAt.localeCompare(left.occurredAt)
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
})

describe('createAssistantTurnBeforeDeliveryHook', () => {
  it('blocks delivery when late same-conversation captures appear', async () => {
    const lateCapture = createCaptureSummary({
      captureId: 'cap_late',
      externalId: 'ext_late',
      eventId: 'evt_late',
      occurredAt: '2026-04-22T10:05:00.000Z',
      createdAt: '2026-04-22T10:05:01.000Z',
      text: 'late follow up',
    })
    const hook = createAssistantTurnBeforeDeliveryHook({
      afterCursor: {
        captureId: 'cap_1',
        createdAt: '2026-04-22T10:00:02.000Z',
        occurredAt: '2026-04-22T10:00:00.000Z',
      },
      conversation: {
        accountId: lateCapture.accountId,
        actorId: lateCapture.actorId,
        actorIsSelf: lateCapture.actorIsSelf,
        source: lateCapture.source,
        threadId: lateCapture.threadId,
        threadIsDirect: lateCapture.threadIsDirect,
      },
      knownCaptureIds: ['cap_1'],
      port: {
        async refresh() {
          return {
            progressed: true,
            reason: 'ingested_input',
          }
        },
        async listNewConversationCaptures() {
          return {
            captures: [lateCapture],
            nextCursor: {
              captureId: lateCapture.captureId,
              createdAt: lateCapture.createdAt ?? null,
              occurredAt: lateCapture.occurredAt,
            },
          }
        },
      },
    })

    await expect(
      hook({
        response: 'draft response',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        vault: '/vault',
      }),
    ).rejects.toMatchObject({
      name: 'AssistantTurnRevisionRequiredError',
      captures: [lateCapture],
      nextCursor: {
        captureId: lateCapture.captureId,
        createdAt: lateCapture.createdAt ?? null,
        occurredAt: lateCapture.occurredAt,
      },
    })
  })

  it('returns quietly when no late captures exist', async () => {
    const hook = createAssistantTurnBeforeDeliveryHook({
      afterCursor: {
        captureId: 'cap_1',
        createdAt: '2026-04-22T10:00:02.000Z',
        occurredAt: '2026-04-22T10:00:00.000Z',
      },
      conversation: {
        accountId: 'acct_1',
        actorId: 'actor_1',
        actorIsSelf: false,
        source: 'telegram',
        threadId: 'thread_1',
        threadIsDirect: true,
      },
      knownCaptureIds: ['cap_1'],
      port: {
        async refresh() {
          return {
            progressed: false,
            reason: 'no_new_input',
          }
        },
        async listNewConversationCaptures(input) {
          return {
            captures: [],
            nextCursor: input.afterCursor,
          }
        },
      },
    })

    await expect(
      hook({
        response: 'draft response',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        vault: '/vault',
      }),
    ).resolves.toBeUndefined()
  })
})
