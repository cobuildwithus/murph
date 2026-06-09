import { describe, expect, it } from 'vitest'
import type { AssistantCronJob } from '@murphai/operator-config/assistant-cli-contracts'

import {
  buildAssistantCronHostedDeliveryIdempotency,
  buildAssistantCronNotificationDedupeToken,
} from '../src/assistant/cron/notification-delivery.js'

describe('buildAssistantCronNotificationDedupeToken', () => {
  const baseJob: Pick<AssistantCronJob, 'jobId' | 'state' | 'target'> = {
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
      'assistant-cron|cron_walk_reminder|2026-04-14T08:00:00.000Z|telegram||||user_123|thread_123|',
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

  it('changes when a Linq participant source changes', () => {
    const firstJob = {
      ...baseJob,
      target: {
        ...baseJob.target,
        channel: 'linq',
        deliverySource: {
          fromPhoneNumber: '+15550001111',
          kind: 'linq' as const,
        },
        deliveryTarget: null,
        identityId: 'identity_linq',
        participantId: '+15550002222',
        threadId: null,
      },
    }
    const secondJob = {
      ...baseJob,
      target: {
        ...baseJob.target,
        channel: 'linq',
        deliverySource: {
          fromPhoneNumber: '+15550003333',
          kind: 'linq' as const,
        },
        deliveryTarget: null,
        identityId: 'identity_linq',
        participantId: '+15550002222',
        threadId: null,
      },
    }
    const first = buildAssistantCronNotificationDedupeToken({
      job: firstJob,
      trigger: 'scheduled',
    })
    const second = buildAssistantCronNotificationDedupeToken({
      job: secondJob,
      trigger: 'scheduled',
    })
    const firstHosted = buildAssistantCronHostedDeliveryIdempotency({
      job: firstJob,
      trigger: 'scheduled',
    })
    const secondHosted = buildAssistantCronHostedDeliveryIdempotency({
      job: secondJob,
      trigger: 'scheduled',
    })

    expect(second).not.toBe(first)
    expect(secondHosted?.conversationId).not.toBe(firstHosted?.conversationId)
    expect(secondHosted?.recipientKey).not.toBe(firstHosted?.recipientKey)
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
        null,
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
        null,
        null,
        'user_123',
        'thread_123',
      ]),
    })
  })
})
