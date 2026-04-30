import { describe, expect, it } from 'vitest'
import type { InboxServices } from '@murphai/inbox-services'
import type { InboxListResult } from '@murphai/operator-config/inbox-cli-contracts'
import {
  assistantInputCandidateFromInboxCapture,
  assistantInputIdFromInboxCaptureId,
  createInboxBackedAssistantInputSource,
  createNoopAssistantInputSource,
  inboxCaptureIdFromAssistantInputId,
} from '../src/assistant/input-source.ts'

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
      const useCreatedAtCursor = Boolean(input.afterCreatedAt)
      const leftTimestamp =
        useCreatedAtCursor && left.createdAt ? left.createdAt : left.occurredAt
      const rightTimestamp =
        useCreatedAtCursor && right.createdAt ? right.createdAt : right.occurredAt
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

describe('assistant inbox input candidate adapter', () => {
  it('uses stable inbox input ids and accepted capture content refs', () => {
    const capture = createCaptureSummary({
      captureId: 'cap_stable',
      source: 'linq',
      text: 'decoded message text',
      attachmentCount: 2,
    })

    const candidate = assistantInputCandidateFromInboxCapture(capture)

    expect(assistantInputIdFromInboxCaptureId(capture.captureId)).toBe(
      'inbox:cap_stable',
    )
    expect(inboxCaptureIdFromAssistantInputId(candidate.event.inputId)).toBe(
      capture.captureId,
    )
    expect(candidate.event).not.toHaveProperty('text')
    expect(candidate).toMatchObject({
      acceptedInput: {
        id: 'inbox:cap_stable',
        source: 'inbox',
        captureIds: ['cap_stable'],
        contentRef: {
          kind: 'inbox-capture',
          refId: 'cap_stable',
          version: null,
        },
        cursorEffects: [],
      },
      event: {
        attachmentCount: 2,
        inputId: 'inbox:cap_stable',
        source: 'linq',
      },
      projection: {
        captureId: 'cap_stable',
        reasonCode: null,
        status: 'succeeded',
      },
    })
  })

  it('lists inbox captures as source-agnostic input candidates', async () => {
    const beforeCursor = createCaptureSummary({
      captureId: 'cap_before',
      externalId: 'ext_before',
      eventId: 'evt_before',
      occurredAt: '2026-04-22T09:59:00.000Z',
      createdAt: '2026-04-22T09:59:01.000Z',
    })
    const telegramCapture = createCaptureSummary({
      captureId: 'cap_telegram',
      externalId: 'ext_telegram',
      eventId: 'evt_telegram',
      source: 'telegram',
      occurredAt: '2026-04-22T10:01:00.000Z',
      createdAt: '2026-04-22T10:01:01.000Z',
    })
    const linqCapture = createCaptureSummary({
      captureId: 'cap_linq',
      externalId: 'ext_linq',
      eventId: 'evt_linq',
      source: 'linq',
      occurredAt: '2026-04-22T10:02:00.000Z',
      createdAt: '2026-04-22T10:02:01.000Z',
    })
    const captures = [beforeCursor, telegramCapture, linqCapture]
    const inboxServices = {
      async list(input) {
        expect(input.sourceId).toBe('linq')
        expect(input.afterCaptureId).toBe(beforeCursor.captureId)
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
    const source = createInboxBackedAssistantInputSource({
      inboxServices,
      requestId: 'req_input_source',
      vault: '/vault',
    })

    const result = await source.listInputCandidates({
      afterCursor: {
        createdAt: beforeCursor.createdAt ?? null,
        inputId: assistantInputIdFromInboxCaptureId(beforeCursor.captureId),
        sourceKind: 'inbox-capture',
        occurredAt: beforeCursor.occurredAt,
      },
      sourceId: 'linq',
    })

    expect(result.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      'inbox:cap_linq',
    ])
    expect(result.nextCursor).toEqual({
      createdAt: linqCapture.createdAt ?? null,
      inputId: 'inbox:cap_linq',
      sourceKind: 'inbox-capture',
      occurredAt: linqCapture.occurredAt,
    })
  })

  it('lists same-conversation inputs while honoring known capture and input ids', async () => {
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
    })
    const knownByInputId = createCaptureSummary({
      captureId: 'cap_known_input',
      externalId: 'ext_known_input',
      eventId: 'evt_known_input',
      occurredAt: '2026-04-22T10:02:00.000Z',
      createdAt: '2026-04-22T10:02:01.000Z',
    })
    const knownByCaptureId = createCaptureSummary({
      captureId: 'cap_known_capture',
      externalId: 'ext_known_capture',
      eventId: 'evt_known_capture',
      occurredAt: '2026-04-22T10:03:00.000Z',
      createdAt: '2026-04-22T10:03:01.000Z',
    })
    const differentConversation = createCaptureSummary({
      captureId: 'cap_other',
      externalId: 'ext_other',
      eventId: 'evt_other',
      threadId: 'thread_other',
      occurredAt: '2026-04-22T10:04:00.000Z',
      createdAt: '2026-04-22T10:04:01.000Z',
    })
    const inboxServices = {
      async list(input) {
        return createListResult({
          afterCaptureId: input.afterCaptureId,
          afterCreatedAt: input.afterCreatedAt,
          afterOccurredAt: input.afterOccurredAt,
          items: [
            beforeCursor,
            sameConversation,
            knownByInputId,
            knownByCaptureId,
            differentConversation,
          ],
          limit: input.limit ?? 100,
          oldestFirst: input.oldestFirst ?? false,
          sourceId: input.sourceId,
        })
      },
    } as Pick<InboxServices, 'list'> as InboxServices
    const source = createInboxBackedAssistantInputSource({
      inboxServices,
      requestId: null,
      vault: '/vault',
    })

    const result = await source.listNewConversationInputs({
      afterCursor: {
        createdAt: beforeCursor.createdAt ?? null,
        inputId: assistantInputIdFromInboxCaptureId(beforeCursor.captureId),
        sourceKind: 'inbox-capture',
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
      knownCaptureIds: [knownByCaptureId.captureId],
      knownInputIds: [
        assistantInputIdFromInboxCaptureId(knownByInputId.captureId),
      ],
    })

    expect(result.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      'inbox:cap_same',
    ])
    expect(result.nextCursor).toEqual({
      createdAt: differentConversation.createdAt ?? null,
      inputId: 'inbox:cap_other',
      sourceKind: 'inbox-capture',
      occurredAt: differentConversation.occurredAt,
    })

    const secondResult = await source.listNewConversationInputs({
      afterCursor: result.nextCursor,
      conversation: {
        accountId: sameConversation.accountId,
        actorId: sameConversation.actorId,
        actorIsSelf: sameConversation.actorIsSelf,
        source: sameConversation.source,
        threadId: sameConversation.threadId,
        threadIsDirect: sameConversation.threadIsDirect,
      },
      knownCaptureIds: [knownByCaptureId.captureId],
      knownInputIds: [
        assistantInputIdFromInboxCaptureId(knownByInputId.captureId),
      ],
    })

    expect(secondResult.inputs).toEqual([])
    expect(secondResult.nextCursor).toEqual(result.nextCursor)
  })

  it('keeps the cursor at the last returned candidate when the limit truncates matches', async () => {
    const first = createCaptureSummary({
      captureId: 'cap_first',
      externalId: 'ext_first',
      eventId: 'evt_first',
      occurredAt: '2026-04-22T10:00:00.000Z',
      createdAt: '2026-04-22T10:00:01.000Z',
    })
    const second = createCaptureSummary({
      captureId: 'cap_second',
      externalId: 'ext_second',
      eventId: 'evt_second',
      occurredAt: '2026-04-22T10:01:00.000Z',
      createdAt: '2026-04-22T10:01:01.000Z',
    })
    const third = createCaptureSummary({
      captureId: 'cap_third',
      externalId: 'ext_third',
      eventId: 'evt_third',
      occurredAt: '2026-04-22T10:02:00.000Z',
      createdAt: '2026-04-22T10:02:01.000Z',
    })
    const inboxServices = {
      async list(input) {
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
    const source = createInboxBackedAssistantInputSource({
      inboxServices,
      requestId: null,
      vault: '/vault',
    })

    const result = await source.listInputCandidates({
      limit: 2,
    })

    expect(result.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      'inbox:cap_first',
      'inbox:cap_second',
    ])
    expect(result.nextCursor).toEqual({
      createdAt: null,
      inputId: 'inbox:cap_second',
      sourceKind: 'inbox-capture',
      occurredAt: second.occurredAt,
    })
  })

  it('keeps no-cursor pagination on occurredAt when createdAt order diverges', async () => {
    const timestamp = (seconds: number) =>
      new Date(Date.UTC(2026, 3, 22, 10, 0, seconds)).toISOString()
    const firstMatch = createCaptureSummary({
      captureId: 'cap_match_first',
      externalId: 'ext_match_first',
      eventId: 'evt_match_first',
      occurredAt: timestamp(0),
      createdAt: timestamp(300),
    })
    const unrelatedCaptures = Array.from({ length: 99 }, (_, index) =>
      createCaptureSummary({
        captureId: `cap_unrelated_${String(index).padStart(3, '0')}`,
        externalId: `ext_unrelated_${index}`,
        eventId: `evt_unrelated_${index}`,
        threadId: 'thread_other',
        occurredAt: timestamp(index + 1),
        createdAt: timestamp(250 - index),
      }),
    )
    const secondMatch = createCaptureSummary({
      captureId: 'cap_match_second',
      externalId: 'ext_match_second',
      eventId: 'evt_match_second',
      occurredAt: timestamp(100),
      createdAt: timestamp(50),
    })
    const listInputs: Array<{
      afterCaptureId?: string | null
      afterCreatedAt?: string | null
      afterOccurredAt?: string | null
    }> = []
    const inboxServices = {
      async list(input) {
        listInputs.push({
          afterCaptureId: input.afterCaptureId,
          afterCreatedAt: input.afterCreatedAt,
          afterOccurredAt: input.afterOccurredAt,
        })
        return createListResult({
          afterCaptureId: input.afterCaptureId,
          afterCreatedAt: input.afterCreatedAt,
          afterOccurredAt: input.afterOccurredAt,
          items: [firstMatch, ...unrelatedCaptures, secondMatch],
          limit: input.limit ?? 100,
          oldestFirst: input.oldestFirst ?? false,
          sourceId: input.sourceId,
        })
      },
    } as Pick<InboxServices, 'list'> as InboxServices
    const source = createInboxBackedAssistantInputSource({
      inboxServices,
      requestId: null,
      vault: '/vault',
    })

    const result = await source.listNewConversationInputs({
      conversation: {
        accountId: firstMatch.accountId,
        actorId: firstMatch.actorId,
        actorIsSelf: firstMatch.actorIsSelf,
        source: firstMatch.source,
        threadId: firstMatch.threadId,
        threadIsDirect: firstMatch.threadIsDirect,
      },
    })

    expect(listInputs).toHaveLength(2)
    expect(listInputs[0]).toEqual({
      afterCaptureId: null,
      afterCreatedAt: null,
      afterOccurredAt: null,
    })
    expect(listInputs[1]).toEqual({
      afterCaptureId: unrelatedCaptures[98]!.captureId,
      afterCreatedAt: null,
      afterOccurredAt: unrelatedCaptures[98]!.occurredAt,
    })
    expect(result.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      'inbox:cap_match_first',
      'inbox:cap_match_second',
    ])
    expect(result.nextCursor).toEqual({
      createdAt: null,
      inputId: 'inbox:cap_match_second',
      sourceKind: 'inbox-capture',
      occurredAt: secondMatch.occurredAt,
    })
  })

  it('does not treat a hosted mailbox cursor as an inbox capture cursor', async () => {
    const firstCapture = createCaptureSummary({
      captureId: 'cap_first',
      externalId: 'ext_first',
      eventId: 'evt_first',
      occurredAt: '2026-04-22T10:00:00.000Z',
      createdAt: '2026-04-22T10:00:01.000Z',
    })
    const listInputs: Array<{
      afterCaptureId?: string | null
      afterCreatedAt?: string | null
      afterOccurredAt?: string | null
    }> = []
    const inboxServices = {
      async list(input) {
        listInputs.push({
          afterCaptureId: input.afterCaptureId,
          afterCreatedAt: input.afterCreatedAt,
          afterOccurredAt: input.afterOccurredAt,
        })
        return createListResult({
          afterCaptureId: input.afterCaptureId,
          afterCreatedAt: input.afterCreatedAt,
          afterOccurredAt: input.afterOccurredAt,
          items: [firstCapture],
          limit: input.limit ?? 100,
          oldestFirst: input.oldestFirst ?? false,
          sourceId: input.sourceId,
        })
      },
    } as Pick<InboxServices, 'list'> as InboxServices
    const source = createInboxBackedAssistantInputSource({
      inboxServices,
      requestId: null,
      vault: '/vault',
    })

    const result = await source.listInputCandidates({
      afterCursor: {
        createdAt: null,
        inputId: 'ain_00000000000000000000000000000000',
        occurredAt: '2026-04-22T09:59:00.000Z',
        sourceKind: 'hosted-mailbox-item',
      },
    })

    expect(listInputs).toEqual([
      {
        afterCaptureId: null,
        afterCreatedAt: null,
        afterOccurredAt: '2026-04-22T09:59:00.000Z',
      },
    ])
    expect(result.inputs.map((candidate) => candidate.event.inputId)).toEqual([
      'inbox:cap_first',
    ])
    expect(result.nextCursor).toEqual({
      createdAt: null,
      inputId: 'inbox:cap_first',
      occurredAt: firstCapture.occurredAt,
      sourceKind: 'inbox-capture',
    })
  })

  it('rejects aborted candidate queries before listing', async () => {
    const abortController = new AbortController()
    const abortReason = new Error('stop input scan')
    abortController.abort(abortReason)
    const inboxServices = {
      async list() {
        throw new Error('list should not run after abort')
      },
    } as Pick<InboxServices, 'list'> as InboxServices
    const source = createInboxBackedAssistantInputSource({
      inboxServices,
      requestId: null,
      vault: '/vault',
    })

    await expect(
      source.listInputCandidates({
        signal: abortController.signal,
      }),
    ).rejects.toThrow(abortReason)
  })
})

describe('createNoopAssistantInputSource', () => {
  it('returns stable no-op refresh and list responses', async () => {
    const source = createNoopAssistantInputSource()
    const afterCursor = {
      createdAt: '2026-04-22T10:00:02.000Z',
      inputId: 'inbox:cap_1',
      sourceKind: 'inbox-capture' as const,
      occurredAt: '2026-04-22T10:00:00.000Z',
    }

    await expect(
      source.refresh({
        phase: 'request_boundary',
      }),
    ).resolves.toEqual({
      progressed: false,
      reason: 'no_port',
    })
    await expect(
      source.listInputCandidates({
        afterCursor,
      }),
    ).resolves.toEqual({
      inputs: [],
      nextCursor: afterCursor,
    })
    await expect(
      source.listNewConversationInputs({
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
      inputs: [],
      nextCursor: afterCursor,
    })
  })
})
