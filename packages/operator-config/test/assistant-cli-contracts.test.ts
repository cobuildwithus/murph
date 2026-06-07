import { describe, expect, it } from 'vitest'
import {
  automationRouteSchema,
  automationScheduleAtSchema,
  automationScheduleCronSchema,
  automationScheduleDailyLocalSchema,
  automationScheduleEverySchema,
  automationScheduleKindValues,
  automationScheduleSchema,
  automationTimeScheduleKindValues,
  automationTimeScheduleSchema,
} from '@murphai/contracts'

import {
  gatewayDeliveryTargetKindValues,
  gatewayReplyRouteKindValues,
} from '@murphai/gateway-core'

import {
  assistantCronAtScheduleSchema,
  assistantCronDailyLocalScheduleSchema,
  assistantCronEveryScheduleSchema,
  assistantCronExpressionScheduleInputSchema,
  assistantCronExpressionScheduleSchema,
  assistantCronJobSchema,
  assistantCronJobStateSchema,
  assistantCronScheduleKindValues,
  assistantCronScheduleSchema,
  assistantCronTargetSchema,
  assistantCronRunRecordSchema,
  assistantBindingDeliveryKindValues,
  assistantChannelDeliveryTargetKindValues,
  assistantOutboxIntentSchema,
  assistantResponseMediaSchema,
  assistantSessionSecretsSchema,
  assistantSessionIdSchema,
  assistantSelfDeliveryTargetSchema,
  assistantTurnReceiptSchema,
  normalizeAssistantResponseMediaUrl,
} from '../src/assistant-cli-contracts.ts'

describe('assistant CLI delivery contracts', () => {
  it('reuses gateway-owned delivery target kinds', () => {
    expect(assistantChannelDeliveryTargetKindValues).toEqual(gatewayDeliveryTargetKindValues)
  })

  it('reuses gateway-owned reply route kinds for bindings', () => {
    expect(assistantBindingDeliveryKindValues).toEqual(gatewayReplyRouteKindValues)
  })

  it('trims assistant session ids before returning them', () => {
    expect(assistantSessionIdSchema.parse('  session_123  ')).toBe('session_123')
  })

  it('normalizes assistant turn and outbox ids inside persisted assistant records', () => {
    const receipt = assistantTurnReceiptSchema.parse({
      schema: 'murph.assistant-turn-receipt.v1',
      turnId: '  turn_123  ',
      sessionId: '  session_123  ',
      provider: 'codex-cli',
      providerModel: null,
      promptPreview: null,
      responsePreview: null,
      status: 'running',
      deliveryRequested: false,
      deliveryDisposition: 'not-requested',
      deliveryIntentId: null,
      startedAt: '2026-04-12T00:00:00.000Z',
      updatedAt: '2026-04-12T00:00:00.000Z',
      completedAt: null,
      lastError: null,
      timeline: [],
    })

    expect(receipt.turnId).toBe('turn_123')
    expect(receipt.sessionId).toBe('session_123')

    const intent = assistantOutboxIntentSchema.parse({
      schema: 'murph.assistant-outbox-intent.v1',
      intentId: '  outbox_123  ',
      sessionId: '  session_123  ',
      turnId: '  turn_123  ',
      createdAt: '2026-04-12T00:00:00.000Z',
      updatedAt: '2026-04-12T00:00:00.000Z',
      lastAttemptAt: null,
      nextAttemptAt: null,
      sentAt: null,
      attemptCount: 0,
      status: 'pending',
      message: 'hello',
      dedupeKey: 'dedupe',
      targetFingerprint: 'target',
      channel: null,
      identityId: null,
      actorId: null,
      threadId: null,
      threadIsDirect: null,
      replyToMessageId: null,
      bindingDelivery: null,
      explicitTarget: null,
      delivery: null,
      deliveryConfirmationPending: false,
      deliveryIdempotencyKey: null,
      deliveryTransportIdempotent: false,
      lastError: null,
    })

    expect(intent.intentId).toBe('outbox_123')
    expect(intent.sessionId).toBe('session_123')
    expect(intent.turnId).toBe('turn_123')
  })

  it('normalizes assistant cron ids and nullable session ids', () => {
    const job = assistantCronJobSchema.parse({
      schema: 'murph.assistant-cron-job.v1',
      jobId: '  cronjob_123  ',
      name: 'Daily check-in',
      enabled: true,
      keepAfterRun: false,
      prompt: 'Ping me',
      schedule: {
        kind: 'every',
        everyMs: 60_000,
      },
      target: {
        sessionId: '  session_123  ',
        alias: null,
        channel: null,
        identityId: null,
        participantId: null,
        threadId: null,
        deliveryTarget: null,
      },
      createdAt: '2026-04-12T00:00:00.000Z',
      updatedAt: '2026-04-12T00:00:00.000Z',
      state: {
        nextRunAt: null,
        lastRunAt: null,
        lastSucceededAt: null,
        lastFailedAt: null,
        consecutiveFailures: 0,
        lastError: null,
        runningAt: null,
        runningPid: null,
      },
    })

    expect(job.jobId).toBe('cronjob_123')
    expect(job.target.sessionId).toBe('session_123')

    const run = assistantCronRunRecordSchema.parse({
      schema: 'murph.assistant-cron-run.v1',
      runId: '  cronrun_123  ',
      jobId: '  cronjob_123  ',
      trigger: 'manual',
      status: 'succeeded',
      startedAt: '2026-04-12T00:00:00.000Z',
      finishedAt: '2026-04-12T00:01:00.000Z',
      sessionId: '  session_123  ',
      response: null,
      responseLength: 0,
      error: null,
    })

    expect(run.runId).toBe('cronrun_123')
    expect(run.jobId).toBe('cronjob_123')
    expect(run.sessionId).toBe('session_123')
  })

  it('rejects the removed assistant cron deliverResponse field', () => {
    expect(() =>
      assistantCronJobSchema.parse({
        schema: 'murph.assistant-cron-job.v1',
        jobId: 'cronjob_456',
        name: 'Daily check-in',
        enabled: true,
        keepAfterRun: false,
        prompt: 'Ping me',
        schedule: {
          kind: 'every',
          everyMs: 60_000,
        },
        target: {
          sessionId: null,
          alias: null,
          channel: 'telegram',
          identityId: null,
          participantId: 'user_123',
          threadId: 'thread_123',
          deliveryTarget: null,
          deliverResponse: true,
        },
        createdAt: '2026-04-12T00:00:00.000Z',
        updatedAt: '2026-04-12T00:00:00.000Z',
        state: {
          nextRunAt: null,
          lastRunAt: null,
          lastSucceededAt: null,
          lastFailedAt: null,
          consecutiveFailures: 0,
          lastError: null,
          runningAt: null,
          runningPid: null,
        },
      }),
    ).toThrow()
  })

  it('normalizes assistant response media URLs to public image URLs only', () => {
    expect(
      assistantResponseMediaSchema.parse({
        kind: 'image',
        url: ' https://cdn.example.test/dead-bug/setup.png ',
        alt: 'Dead bug setup',
        source: 'dead-bug-setup',
      }),
    ).toEqual({
      kind: 'image',
      url: 'https://cdn.example.test/dead-bug/setup.png',
      alt: 'Dead bug setup',
      source: 'dead-bug-setup',
    })

    for (const url of [
      'http://cdn.example.test/dead-bug/setup.png',
      'https://user:pass@cdn.example.test/dead-bug/setup.png',
      'https://cdn.example.test/dead-bug/setup.png?token=secret',
      'https://cdn.example.test/dead-bug/setup.png#step',
      'https://localhost/dead-bug/setup.png',
      'https://assets.local/dead-bug/setup.png',
      'https://127.0.0.1/dead-bug/setup.png',
      'https://8.8.8.8/dead-bug/setup.png',
      'https://10.0.0.5/dead-bug/setup.png',
      'https://172.16.0.5/dead-bug/setup.png',
      'https://192.168.1.5/dead-bug/setup.png',
      'https://169.254.169.254/dead-bug/setup.png',
      'https://[::1]/dead-bug/setup.png',
      'https://[fe80::1]/dead-bug/setup.png',
      'https://[fd00::1]/dead-bug/setup.png',
      'https://[2001:db8::1]/dead-bug/setup.png',
      'https://[2606:4700:4700::1111]/dead-bug/setup.png',
      'https://[::ffff:127.0.0.1]/dead-bug/setup.png',
      'https://example.test/dead-bug/setup.txt',
    ]) {
      expect(() => normalizeAssistantResponseMediaUrl(url), url).toThrow()
    }
  })

  it('rejects assistant ids with path separators or traversal segments', () => {
    expect(() => assistantSessionIdSchema.parse('../session_123')).toThrow(
      /opaque runtime ids/i,
    )
  })

  it('rejects the obsolete provider binding header bucket', () => {
    expect(() =>
      assistantSessionSecretsSchema.parse({
        schema: 'murph.assistant-session-secrets.v1',
        sessionId: 'sess_headers_roundtrip',
        updatedAt: '2026-04-13T00:00:00.000Z',
        providerHeaders: {
          'X-Upstream-Auth': 'Bearer firstsecret123',
        },
        providerBindingHeaders: {
          'X-Old-Binding-Auth': 'Bearer oldsecret456',
        },
      }),
    ).toThrow()
  })
})

describe('assistant CLI automation shape ownership', () => {
  it('keeps assistant cron schedules on the canonical automation owners', () => {
    expect(automationScheduleKindValues).toContain('deviceActivity')
    expect(assistantCronScheduleKindValues).toBe(automationTimeScheduleKindValues)
    expect(assistantCronAtScheduleSchema).toBe(automationScheduleAtSchema)
    expect(assistantCronEveryScheduleSchema).toBe(automationScheduleEverySchema)
    expect(assistantCronExpressionScheduleSchema).toBe(automationScheduleCronSchema)
    expect(assistantCronDailyLocalScheduleSchema).toBe(automationScheduleDailyLocalSchema)
    expect(assistantCronScheduleSchema).toBe(automationTimeScheduleSchema)

    expect(
      assistantCronExpressionScheduleSchema.parse({
        kind: 'cron',
        expression: '0 9 * * *',
      }),
    ).toEqual({
      kind: 'cron',
      expression: '0 9 * * *',
    })

    expect(
      assistantCronDailyLocalScheduleSchema.parse({
        kind: 'dailyLocal',
        localTime: '09:00',
      }),
    ).toEqual({
      kind: 'dailyLocal',
      localTime: '09:00',
    })

    expect(() =>
      assistantCronScheduleSchema.parse({
        kind: 'deviceActivity',
        after: '2026-06-07T12:00:00.000Z',
      }),
    ).toThrow()

    expect(
      automationScheduleSchema.parse({
        kind: 'deviceActivity',
        after: '2026-06-07T12:00:00.000Z',
      }),
    ).toEqual({
      kind: 'deviceActivity',
      after: '2026-06-07T12:00:00.000Z',
    })
  })

  it('reuses the canonical automation route for saved self-delivery targets', () => {
    expect(assistantSelfDeliveryTargetSchema).toBe(automationRouteSchema)

    const route = {
      channel: 'slack',
      deliveryTarget: 'channel:alerts',
      identityId: 'idn_123',
      participantId: 'user_123',
      threadId: 'thread_123',
    }

    expect(assistantSelfDeliveryTargetSchema.parse(route)).toEqual(
      automationRouteSchema.parse(route),
    )
  })

  it('composes canonical route fields into cron targets while keeping local selector fields', () => {
    const target = assistantCronTargetSchema.parse({
      channel: 'telegram',
      deliveryTarget: 'chat:123',
      identityId: null,
      participantId: 'participant_123',
      threadId: null,
      alias: 'personal',
      sessionId: null,
    })

    const { alias, sessionId, threadId, ...route } = target
    expect({ alias, sessionId }).toEqual({
      alias: 'personal',
      sessionId: null,
    })
    expect({
      ...route,
      threadId: threadId,
    }).toEqual(
      automationRouteSchema.parse({
        ...route,
        threadId: threadId,
      }),
    )
  })

  it('keeps route-less cron targets valid for local-only jobs', () => {
    expect(
      assistantCronTargetSchema.parse({
        channel: null,
        deliveryTarget: null,
        identityId: null,
        participantId: null,
        threadId: null,
        alias: null,
        sessionId: null,
      }),
    ).toEqual({
      channel: null,
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      threadId: null,
      alias: null,
      sessionId: null,
    })
  })

  it('drops timezone from recurring cron inputs and persisted schedules', () => {
    expect(
      assistantCronExpressionScheduleInputSchema.parse({
        kind: 'cron',
        expression: '0 9 * * *',
      }),
    ).toEqual({
      kind: 'cron',
      expression: '0 9 * * *',
    })

    expect(
      assistantCronScheduleSchema.parse({
        kind: 'cron',
        expression: '0 9 * * *',
      }),
    ).toEqual({
      kind: 'cron',
      expression: '0 9 * * *',
    })

    expect(
      assistantCronScheduleSchema.parse({
        kind: 'dailyLocal',
        localTime: '09:00',
      }),
    ).toEqual({
      kind: 'dailyLocal',
      localTime: '09:00',
    })

    expect(() =>
      assistantCronScheduleSchema.parse({
        kind: 'cron',
        expression: '0 9 * * *',
        timeZone: 'America/Los_Angeles',
      }),
    ).toThrow()

    expect(() =>
      automationScheduleSchema.parse({
        kind: 'cron',
        expression: '0 9 * * *',
        timeZone: 'America/Los_Angeles',
      }),
    ).toThrow()

    expect(() =>
      assistantCronDailyLocalScheduleSchema.parse({
        kind: 'dailyLocal',
        localTime: '09:00',
        timeZone: 'America/Los_Angeles',
      }),
    ).toThrow()
  })

  it('keeps the public cron job state surface stable on nextRunAt', () => {
    expect(
      assistantCronJobStateSchema.parse({
        nextRunAt: null,
        lastRunAt: null,
        lastSucceededAt: null,
        lastFailedAt: null,
        consecutiveFailures: 0,
        lastError: null,
        runningAt: null,
        runningPid: null,
      }),
    ).toEqual({
      nextRunAt: null,
      lastRunAt: null,
      lastSucceededAt: null,
      lastFailedAt: null,
      consecutiveFailures: 0,
      lastError: null,
      runningAt: null,
      runningPid: null,
    })

    expect(() =>
      assistantCronJobStateSchema.parse({
        pendingOccurrenceAt: null,
        retryAfterAt: null,
        lastRunAt: null,
        lastSucceededAt: null,
        lastFailedAt: null,
        consecutiveFailures: 0,
        lastError: null,
        runningAt: null,
        runningPid: null,
      }),
    ).toThrow()
  })
})
