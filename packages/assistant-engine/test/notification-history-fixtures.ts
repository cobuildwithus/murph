import { assistantOutboxIntentSchema, type AssistantOutboxIntent } from '@murphai/operator-config/assistant-cli-contracts'

export const notificationHistoryDestination = {
  actorId: null, channel: 'linq', identityId: null, threadId: 'synthetic-room',
  threadIsDirect: false, bindingDelivery: null, explicitTarget: 'synthetic-room',
}

export function notificationHistoryIntent(overrides: Partial<AssistantOutboxIntent> = {}): AssistantOutboxIntent {
  const at = '2030-03-04T20:00:00.000Z'
  const message = 'Ava, are you taking your walk today?'
  return assistantOutboxIntentSchema.parse({
    schema: 'murph.assistant-outbox-intent.v1', intentId: 'outbox_synthetic_history',
    sessionId: 'session-previous', turnId: 'turn-previous', createdAt: at, updatedAt: at,
    lastAttemptAt: at, nextAttemptAt: null, sentAt: at, attemptCount: 1, status: 'sent',
    message, media: [], card: null, subject: null, operation: null,
    dedupeKey: 'synthetic-history', targetFingerprint: 'synthetic-room',
    ...notificationHistoryDestination, replyToMessageId: null, deliverySource: null,
    delivery: { channel: 'linq', idempotencyKey: 'synthetic-history', messageLength: message.length,
      providerMessageId: 'synthetic-message', providerThreadId: 'synthetic-room', sentAt: at,
      target: 'synthetic-room', targetKind: 'thread' },
    deliveryConfirmationPending: false, deliveryIdempotencyKey: 'synthetic-history',
    deliveryTransportIdempotent: true, answeredMailboxItemIds: [], preparedDispatchToken: null,
    lastError: null, ...overrides,
  })
}
