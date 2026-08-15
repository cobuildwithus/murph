import { afterEach, describe, expect, it } from 'vitest'

import {
  assistantOutboxIntentSchema,
} from '@murphai/operator-config/assistant-cli-contracts'

import {
  ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS,
  assistantDeliveryErrorPreventsFreshIntentRetry,
  createAssistantDeliveryAmbiguousError,
  createAssistantDeliveryConfirmationPendingError,
  createAssistantDeliveryRetryExhaustedError,
  isAssistantOutboxRetryBudgetExhausted,
  isAssistantOutboxRetryableError,
  normalizeAssistantDeliveryError,
  resolveAssistantOutboxSendingRecoveryAt,
  resolveAssistantOutboxRetryDelayMs,
  shouldBeginAssistantOutboxDispatch,
  shouldDispatchAssistantOutboxIntent,
} from '../src/assistant/outbox/retry-policy.ts'

afterEach(() => {
  // no shared mocks yet; keep the file symmetric with the rest of the test tree
})

describe('assistant outbox retry policy', () => {
  it('dispatches pending and stale sending intents only when they are due', () => {
    const now = new Date('2026-04-08T12:00:00.000Z')
    const pending = createIntent({
      nextAttemptAt: null,
      status: 'pending',
    })
    const futureRetry = createIntent({
      nextAttemptAt: '2026-04-08T12:05:00.000Z',
      status: 'retryable',
    })
    const staleSending = createIntent({
      lastAttemptAt: '2026-04-08T11:49:59.000Z',
      nextAttemptAt: null,
      status: 'sending',
    })
    const unknownSending = createIntent({
      lastAttemptAt: null,
      nextAttemptAt: null,
      status: 'sending',
    })
    const sent = createIntent({
      nextAttemptAt: null,
      sentAt: '2026-04-08T11:00:00.000Z',
      status: 'sent',
    })
    const freshSending = createIntent({
      lastAttemptAt: '2026-04-08T11:59:00.000Z',
      nextAttemptAt: null,
      status: 'sending',
    })

    expect(shouldDispatchAssistantOutboxIntent(pending, now)).toBe(true)
    expect(shouldDispatchAssistantOutboxIntent(futureRetry, now)).toBe(false)
    expect(shouldDispatchAssistantOutboxIntent(staleSending, now)).toBe(true)
    expect(shouldDispatchAssistantOutboxIntent(unknownSending, now)).toBe(true)
    expect(shouldDispatchAssistantOutboxIntent(freshSending, now)).toBe(false)
    expect(shouldDispatchAssistantOutboxIntent(sent, now)).toBe(false)

    expect(shouldBeginAssistantOutboxDispatch(futureRetry, now, true)).toBe(true)
    expect(shouldBeginAssistantOutboxDispatch(sent, now, true)).toBe(false)
    expect(shouldBeginAssistantOutboxDispatch(staleSending, now, false)).toBe(true)
  })

  it('derives the same sending recovery boundary used by dispatch', () => {
    const now = new Date('2026-04-08T12:00:00.000Z')
    const freshSending = createIntent({
      lastAttemptAt: '2026-04-08T11:59:00.000Z',
      status: 'sending',
    })
    const missingAttempt = createIntent({
      lastAttemptAt: null,
      status: 'sending',
    })

    expect(resolveAssistantOutboxSendingRecoveryAt(freshSending, now)).toBe(
      '2026-04-08T12:09:00.000Z',
    )
    expect(resolveAssistantOutboxSendingRecoveryAt(missingAttempt, now)).toBe(
      now.toISOString(),
    )
    expect(resolveAssistantOutboxSendingRecoveryAt(
      createIntent({ status: 'sent' }),
      now,
    )).toBeNull()
  })

  it('detects retryable delivery errors from context, direct flags, failure-class hints, and normalized fallback signals', () => {
    expect(isAssistantOutboxRetryableError({ context: { retryable: true } })).toBe(true)
    expect(
      isAssistantOutboxRetryableError({
        context: { retryable: false },
        message: 'retryable false: do not retry this request',
      }),
    ).toBe(false)
    expect(isAssistantOutboxRetryableError({ retryable: false })).toBe(false)
    expect(
      isAssistantOutboxRetryableError({
        context: { assistantDeliveryFailureClass: 'transient' },
      }),
    ).toBe(true)
    expect(
      isAssistantOutboxRetryableError({
        context: { assistantDeliveryFailureClass: 'blocked' },
        retryable: true,
      }),
    ).toBe(false)
    expect(
      isAssistantOutboxRetryableError({
        context: { assistantDeliveryFailureClass: 'terminal' },
      }),
    ).toBe(false)
    expect(
      isAssistantOutboxRetryableError({
        code: 'assistant_delivery_failed',
        message: 'temporary network issue',
      }),
    ).toBe(false)
    expect(
      isAssistantOutboxRetryableError({
        code: 'assistant_request_failed',
        message: 'bad gateway',
      }),
    ).toBe(false)
    expect(
      isAssistantOutboxRetryableError({
        code: 'assistant_channel_required',
        message: 'channel required',
      }),
    ).toBe(false)
    expect(isAssistantOutboxRetryableError({ message: 'plain failure' })).toBe(false)
    expect(isAssistantOutboxRetryableError('temporary network timeout')).toBe(true)
    expect(
      isAssistantOutboxRetryableError({
        code: null,
        message: 'temporary network timeout',
      }),
    ).toBe(true)
    expect(
      isAssistantOutboxRetryableError({
        code: 'TARGET_REQUIRED',
        message: 'temporary network timeout',
      }),
    ).toBe(false)
    expect(
      isAssistantOutboxRetryableError({
        code: 'INTERNAL_ERROR',
        message: 'Internal error.',
        statusCode: 500,
      }),
    ).toBe(true)
    expect(
      isAssistantOutboxRetryableError({
        context: { responseStatus: 503 },
        message: 'Hosted Linq egress engagement failed.',
      }),
    ).toBe(true)
    expect(
      isAssistantOutboxRetryableError({
        context: { statusCode: 404 },
        message: 'temporary network timeout',
      }),
    ).toBe(false)
    expect(
      isAssistantOutboxRetryableError({
        hostedRuntimeControlPlaneFetchFailure: true,
        message: 'Hosted Linq egress engagement request failed.',
      }),
    ).toBe(true)
    expect(
      isAssistantOutboxRetryableError({
        hostedRuntimeControlPlaneFetchFailure: true,
        retryable: false,
        message: 'Hosted Linq egress engagement request failed.',
      }),
    ).toBe(false)
  })

  it('clamps retry delays and preserves optional confirmation details', () => {
    expect(resolveAssistantOutboxRetryDelayMs(1)).toBe(30_000)
    expect(resolveAssistantOutboxRetryDelayMs(2)).toBe(120_000)
    expect(resolveAssistantOutboxRetryDelayMs(0)).toBe(30_000)
    expect(resolveAssistantOutboxRetryDelayMs(-10)).toBe(30_000)
    expect(resolveAssistantOutboxRetryDelayMs(999)).toBe(1_800_000)

    expect(createAssistantDeliveryConfirmationPendingError()).toEqual({
      code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
      message:
        'Assistant outbound delivery may have succeeded already and must be reconciled before resend.',
    })
    expect(
      createAssistantDeliveryConfirmationPendingError(
        new Error('provider may still deliver'),
      ),
    ).toEqual({
      code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
      message:
        'Assistant outbound delivery may have succeeded already and must be reconciled before resend. provider may still deliver',
    })
    expect(
      createAssistantDeliveryAmbiguousError({
        code: 'ASSISTANT_DELIVERY_AMBIGUOUS',
        message:
          'Assistant outbound delivery could not be confirmed safely and will not be resent automatically. hosted journal stale',
      }),
    ).toEqual({
      code: 'ASSISTANT_DELIVERY_AMBIGUOUS',
      message:
        'Assistant outbound delivery could not be confirmed safely and will not be resent automatically. hosted journal stale',
      retryable: false,
    })
  })

  it('bounds automatic retries by persisted dispatch attempts', () => {
    expect(isAssistantOutboxRetryBudgetExhausted(createIntent({
      attemptCount: ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS - 1,
    }))).toBe(false)
    expect(isAssistantOutboxRetryBudgetExhausted(createIntent({
      attemptCount: ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS,
    }))).toBe(true)
    expect(createAssistantDeliveryRetryExhaustedError()).toEqual({
      code: 'ASSISTANT_DELIVERY_RETRY_EXHAUSTED',
      message:
        'Assistant outbound delivery reached its automatic retry limit and will not be retried automatically.',
    })
  })

  it('forbids a fresh intent after canonical automation authority is revoked', () => {
    expect(assistantDeliveryErrorPreventsFreshIntentRetry({
      code: 'ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE',
      message: 'Automation authority changed before outbound delivery.',
    })).toBe(true)
  })

  it('forbids a fresh intent after a confirmed Linq attachment PUT is terminal', () => {
    expect(assistantDeliveryErrorPreventsFreshIntentRetry({
      code: 'LINQ_API_REQUEST_FAILED',
      diagnosticContext: {
        failureStage: 'http',
        method: 'PUT',
        operation: 'create_attachment_upload',
        retryable: false,
        status: 503,
      },
      message: 'The confirmed attachment upload exhausted its bounded retries.',
    })).toBe(true)
    expect(assistantDeliveryErrorPreventsFreshIntentRetry({
      code: 'LINQ_API_REQUEST_FAILED',
      diagnosticContext: {
        failureStage: 'http',
        method: 'POST',
        operation: 'create_attachment_upload',
        retryable: false,
        status: 400,
      },
      message: 'The attachment reservation was rejected before confirmation.',
    })).toBe(false)
  })

  it('keeps message text from error-like objects', () => {
    expect(normalizeAssistantDeliveryError({
      code: 'WEB_SEARCH_REQUEST_FAILED',
      message: 'temporary network timeout',
    })).toEqual({
      code: 'WEB_SEARCH_REQUEST_FAILED',
      message: 'temporary network timeout',
    })
  })

  it('keeps bounded Linq rejection diagnostics through outbox normalization', () => {
    const normalized = normalizeAssistantDeliveryError(Object.assign(
      new Error('Linq request POST /chats/[chat]/messages failed with HTTP 400.'),
      {
        code: 'LINQ_API_REQUEST_FAILED',
        context: {
          failureStage: 'http',
          hasIdempotencyKey: true,
          hasReplyToMessageId: false,
          method: 'POST',
          operation: 'send_message',
          path: '/chats/[chat]/messages',
          provider: 'linq',
          providerErrorCode: '1004',
          providerRequestId: 'trace_safe_123',
          requestAttachmentMediaPartCount: 1,
          requestBodyShape: 'object:message|message:idempotency_key,parts',
          requestMediaPartCount: 8,
          requestMessageLength: 4_321,
          requestMessagePartCount: 9,
          requestPublicUrlMediaPartCount: 7,
          requestTextPartCount: 1,
          responseBodyKeyCount: 4,
          responseBodyKeySummary: 'error,trace_id',
          responseBodyKind: 'json_object',
          responseBodySha256: 'a'.repeat(64),
          responseBodyStringFieldCount: 2,
          responseBodyStringFieldSummary: 'trace_id',
          responseBodyTextLength: 246,
          retryable: false,
          status: 400,
        },
      },
    ))

    expect(normalized.diagnosticContext).toEqual(expect.objectContaining({
      providerErrorCode: '1004',
      providerRequestId: 'trace_safe_123',
      requestMediaPartCount: 8,
      requestMessageLength: 4_321,
      responseBodySha256: 'a'.repeat(64),
      responseBodyTextLength: 246,
      retryable: false,
      status: 400,
    }))
  })
})

function createIntent(
  overrides: Partial<ReturnType<typeof assistantOutboxIntentSchema.parse>> = {},
) {
  return assistantOutboxIntentSchema.parse({
    actorId: null,
    attemptCount: 0,
    bindingDelivery: null,
    channel: 'telegram',
    createdAt: '2026-04-08T10:00:00.000Z',
    dedupeKey: 'dedupe-key',
    delivery: null,
    deliveryConfirmationPending: false,
    deliveryIdempotencyKey: null,
    deliveryTransportIdempotent: false,
    explicitTarget: null,
    identityId: 'identity-1',
    intentId: 'outbox_intent_test',
    lastAttemptAt: null,
    lastError: null,
    message: 'hello',
    subject: null,
    nextAttemptAt: '2026-04-08T10:00:00.000Z',
    replyToMessageId: null,
    schema: 'murph.assistant-outbox-intent.v1',
    sentAt: null,
    sessionId: 'session-1',
    status: 'pending',
    targetFingerprint: 'target-fingerprint',
    threadId: 'thread-1',
    threadIsDirect: true,
    turnId: 'turn-1',
    updatedAt: '2026-04-08T10:00:00.000Z',
    ...overrides,
  })
}
