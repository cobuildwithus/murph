import { describe, expect, it } from 'vitest'

import {
  buildAssistantCronHostedDeliveryIdempotency,
  buildAssistantCronNotificationDedupeToken,
} from '../src/assistant/cron/notification-delivery.js'

describe('buildAssistantCronNotificationDedupeToken', () => {
  const baseJob = {
    jobId: 'cron_walk_reminder',
    state: {
      nextRunAt: '2026-04-14T08:00:00.000Z',
      lastRunAt: null,
      lastSucceededAt: null,
      lastFailedAt: null,
      consecutiveFailures: 0,
      lastError: null,
      runningAt: null,
      runningPid: null,
    },
    target: {
      alias: null,
      channel: 'telegram',
      deliverySource: null,
      sessionId: null,
      identityId: null,
      participantId: 'user_123',
      threadId: 'thread_123',
      deliveryTarget: null,
    },
  }

  it('returns a stable token for one scheduled audience slot', () => {
    expect(
      buildAssistantCronNotificationDedupeToken({
        job: baseJob,
        trigger: 'scheduled',
      }),
    ).toBe(
      'assistant-cron|cron_walk_reminder|2026-04-14T08:00:00.000Z|telegram||user_123|thread_123|',
    )
  })

  it('changes when the outbound audience changes', () => {
    const first = buildAssistantCronNotificationDedupeToken({
      job: baseJob,
      trigger: 'scheduled',
    })
    const second = buildAssistantCronNotificationDedupeToken({
      job: {
        ...baseJob,
        target: {
          ...baseJob.target,
          deliveryTarget: 'telegram:chat:456',
        },
      },
      trigger: 'scheduled',
    })

    expect(second).not.toBe(first)
  })

  it('does not dedupe manual runs', () => {
    expect(
      buildAssistantCronNotificationDedupeToken({
        job: baseJob,
        trigger: 'manual',
      }),
    ).toBeNull()
  })

  it('returns hosted delivery idempotency context for scheduled runs', () => {
    expect(
      buildAssistantCronHostedDeliveryIdempotency({
        job: baseJob,
        trigger: 'scheduled',
      }),
    ).toEqual({
      assistantTurnOrdinal: 'assistant-cron:1',
      conversationId: JSON.stringify([
        'telegram',
        null,
        'user_123',
        'thread_123',
      ]),
      inboundMailboxItemIds: [
        JSON.stringify([
          'assistant-cron',
          'cron_walk_reminder',
          '2026-04-14T08:00:00.000Z',
        ]),
      ],
      recipientKey: JSON.stringify([
        'telegram',
        null,
        null,
        'user_123',
        'thread_123',
      ]),
    })
  })
})
