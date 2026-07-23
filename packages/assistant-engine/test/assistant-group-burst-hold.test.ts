import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_GROUP_BURST_MAX_HOLD_MS,
  ASSISTANT_GROUP_BURST_QUIET_MS,
  decideAssistantGroupBurstHold,
  type AssistantGroupBurstHoldItem,
} from '../src/assistant/automation/group-burst-hold.ts'

const BURST_STARTED_AT = Date.parse('2026-07-23T12:00:00.000Z')

function createHoldItem(
  input: {
    affirmativeReaction?: true
    groupParticipantAdded?: true
    occurredAtMs?: number
    receivedAtMs?: number | null
    sourceLane?: 'conversation' | 'system'
    threadIsDirect?: boolean | null
  } = {},
): AssistantGroupBurstHoldItem {
  const occurredAtMs = input.occurredAtMs ?? BURST_STARTED_AT
  const receivedAtMs = input.receivedAtMs === undefined
    ? occurredAtMs
    : input.receivedAtMs

  return {
    ...(input.groupParticipantAdded === true
      ? { groupParticipantAdded: true as const }
      : {}),
    sourceRef: {
      causalSeq: '1',
      dedupeKey: 'dedupe-1',
      eventId: 'event-1',
      itemId: 'item-1',
      kind: 'hosted-mailbox',
      lane: input.sourceLane ?? 'conversation',
      laneSeq: '1',
      payloadSchema: 'murph.hosted-mailbox-payload.v1',
      payloadSource: 'inline',
      source: 'hosted-mailbox',
      wakeSchema: 'murph.hosted-execution-wake.v1',
    },
    summary: {
      actorIsSelf: false,
      ...(input.affirmativeReaction === true
        ? { affirmativeReaction: true as const }
        : {}),
      conversation: {
        accountId: 'account-1',
        actorId: 'actor-1',
        actorIsSelf: false,
        source: 'linq',
        threadId: 'thread-1',
        threadIsDirect:
          input.threadIsDirect === undefined ? false : input.threadIsDirect,
      },
      occurredAt: new Date(occurredAtMs).toISOString(),
      receivedAt: receivedAtMs === null
        ? null
        : new Date(receivedAtMs).toISOString(),
    },
  }
}

describe('assistant group burst hold decision', () => {
  it('holds a fresh group burst until the quiet boundary', () => {
    expect(decideAssistantGroupBurstHold({
      items: [createHoldItem()],
      now: BURST_STARTED_AT + ASSISTANT_GROUP_BURST_QUIET_MS - 1,
    })).toEqual({
      ready: false,
      resumeAt: BURST_STARTED_AT + ASSISTANT_GROUP_BURST_QUIET_MS,
    })
  })

  it('releases once the newest group message has been quiet for five seconds', () => {
    expect(decideAssistantGroupBurstHold({
      items: [createHoldItem()],
      now: BURST_STARTED_AT + ASSISTANT_GROUP_BURST_QUIET_MS,
    })).toEqual({
      ready: true,
    })
  })

  it('releases at the fifteen-second cap even when a newer message is fresh', () => {
    expect(decideAssistantGroupBurstHold({
      items: [
        createHoldItem(),
        createHoldItem({
          occurredAtMs:
            BURST_STARTED_AT + ASSISTANT_GROUP_BURST_MAX_HOLD_MS - 1_000,
        }),
      ],
      now: BURST_STARTED_AT + ASSISTANT_GROUP_BURST_MAX_HOLD_MS,
    })).toEqual({
      ready: true,
    })
  })

  it('never holds direct conversations', () => {
    expect(decideAssistantGroupBurstHold({
      items: [
        createHoldItem({
          threadIsDirect: true,
        }),
      ],
      now: BURST_STARTED_AT,
    })).toEqual({
      ready: true,
    })
  })

  it('never holds conversations whose directness is unresolved', () => {
    expect(decideAssistantGroupBurstHold({
      items: [
        createHoldItem({
          threadIsDirect: null,
        }),
      ],
      now: BURST_STARTED_AT,
    })).toEqual({
      ready: true,
    })
  })

  it('never holds synthetic affirmative-reaction triggers', () => {
    expect(decideAssistantGroupBurstHold({
      items: [
        createHoldItem({
          affirmativeReaction: true,
        }),
      ],
      now: BURST_STARTED_AT,
    })).toEqual({
      ready: true,
    })
  })

  it('never holds synthetic group-participant triggers', () => {
    expect(decideAssistantGroupBurstHold({
      items: [
        createHoldItem({
          groupParticipantAdded: true,
        }),
      ],
      now: BURST_STARTED_AT,
    })).toEqual({
      ready: true,
    })
  })

  it('never holds system-lane items', () => {
    expect(decideAssistantGroupBurstHold({
      items: [
        createHoldItem({
          sourceLane: 'system',
        }),
      ],
      now: BURST_STARTED_AT,
    })).toEqual({
      ready: true,
    })
  })

  it('extends the quiet window when a later group message joins', () => {
    const laterAt = BURST_STARTED_AT + 4_000

    expect(decideAssistantGroupBurstHold({
      items: [
        createHoldItem(),
        createHoldItem({
          occurredAtMs: laterAt,
        }),
      ],
      now: BURST_STARTED_AT + ASSISTANT_GROUP_BURST_QUIET_MS,
    })).toEqual({
      ready: false,
      resumeAt: laterAt + ASSISTANT_GROUP_BURST_QUIET_MS,
    })
  })
})
