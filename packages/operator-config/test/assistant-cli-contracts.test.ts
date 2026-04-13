import { describe, expect, it } from 'vitest'

import {
  gatewayDeliveryTargetKindValues,
  gatewayReplyRouteKindValues,
} from '@murphai/gateway-core'

import {
  assistantCronJobSchema,
  assistantCronRunRecordSchema,
  assistantBindingDeliveryKindValues,
  assistantChannelDeliveryTargetKindValues,
  assistantOutboxIntentSchema,
  assistantSessionIdSchema,
  assistantTurnReceiptSchema,
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
        sourceThreadId: null,
        deliveryTarget: null,
        deliverResponse: false,
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

  it('rejects assistant ids with path separators or traversal segments', () => {
    expect(() => assistantSessionIdSchema.parse('../session_123')).toThrow(
      /opaque runtime ids/i,
    )
  })
})
