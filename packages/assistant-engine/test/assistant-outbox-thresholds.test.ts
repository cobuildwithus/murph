import { readFile, rename as renameFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AssistantChannelDelivery } from '@murphai/operator-config/assistant-cli-contracts'
import { ensureAssistantState } from '../src/assistant/store/persistence.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS } from '../src/assistant/outbox/retry-policy.ts'
import { resolveAssistantOutboxIntentPath } from '../src/assistant/outbox/intents.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []
const mockedModules = [
  'node:fs/promises',
  '../src/outbound-channel.ts',
  '../src/assistant/diagnostics.js',
  '../src/assistant/shared.js',
  '../src/assistant/store.js',
]

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.resetModules()
  for (const moduleId of mockedModules) {
    vi.doUnmock(moduleId)
  }
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant outbox thresholds', () => {
  it('skips dispatch when a retryable intent is not due yet', async () => {
    const deliverAssistantMessageOverBinding = vi.fn()
    const { outbox } = await loadOutboxModule({
      deliverAssistantMessageOverBinding,
    })
    const { vaultRoot } = await createAssistantVault('assistant-outbox-thresholds-skip-')
    const seeded = await createIntent(outbox, vaultRoot, {
      createdAt: '2026-04-08T10:00:00.000Z',
      message: 'wait until later',
      sessionId: 'session-skip',
      turnId: 'turn-skip',
    })

    await outbox.saveAssistantOutboxIntent(vaultRoot, {
      ...seeded,
      attemptCount: 1,
      lastAttemptAt: '2026-04-08T10:01:00.000Z',
      lastError: {
        code: 'REQUEST_FAILED',
        message: 'try again later',
      },
      nextAttemptAt: '2026-04-08T11:00:00.000Z',
      status: 'retryable',
      updatedAt: '2026-04-08T10:01:00.000Z',
    })

    await expect(
      outbox.dispatchAssistantOutboxIntent({
        intentId: seeded.intentId,
        now: new Date('2026-04-08T10:30:00.000Z'),
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      deliveryError: {
        code: 'REQUEST_FAILED',
      },
      intent: {
        intentId: seeded.intentId,
        status: 'retryable',
      },
      session: null,
    })
    expect(deliverAssistantMessageOverBinding).not.toHaveBeenCalled()
  })

  it('terminalizes an exhausted idempotent confirmation retry before another provider call', async () => {
    const deliverAssistantMessageOverBinding = vi.fn()
    const { outbox } = await loadOutboxModule({
      deliverAssistantMessageOverBinding,
    })
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-thresholds-retry-exhausted-',
    )
    const seeded = await createIntent(outbox, vaultRoot, {
      createdAt: '2026-04-08T10:00:00.000Z',
      message: 'stop after the bounded retry attempts',
      sessionId: 'session-retry-exhausted',
      turnId: 'turn-retry-exhausted',
    })
    await outbox.saveAssistantOutboxIntent(vaultRoot, {
      ...seeded,
      attemptCount: ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS,
      deliveryConfirmationPending: true,
      deliveryTransportIdempotent: true,
      lastAttemptAt: '2026-04-08T10:01:00.000Z',
      lastError: {
        code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
        message: 'provider acceptance remains unconfirmed',
      },
      nextAttemptAt: '2026-04-08T10:30:00.000Z',
      status: 'retryable',
      updatedAt: '2026-04-08T10:01:00.000Z',
    })

    const first = await outbox.dispatchAssistantOutboxIntent({
      intentId: seeded.intentId,
      now: new Date('2026-04-08T10:30:00.000Z'),
      vault: vaultRoot,
    })
    const second = await outbox.dispatchAssistantOutboxIntent({
      force: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T11:00:00.000Z'),
      vault: vaultRoot,
    })

    expect(first).toMatchObject({
      deliveryError: {
        code: 'ASSISTANT_DELIVERY_RETRY_EXHAUSTED',
      },
      intent: {
        attemptCount: ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS,
        nextAttemptAt: null,
        status: 'failed',
      },
      session: null,
    })
    expect(second.intent).toMatchObject({
      intentId: seeded.intentId,
      status: 'failed',
    })
    expect(deliverAssistantMessageOverBinding).not.toHaveBeenCalled()
  })

  it('terminalizes an exhausted hosted prepared claim without taking ownership', async () => {
    const { outbox } = await loadOutboxModule()
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-thresholds-prepared-exhausted-',
    )
    const seeded = await createIntent(outbox, vaultRoot, {
      createdAt: '2026-04-08T10:00:00.000Z',
      message: 'do not pre-claim another retry',
      sessionId: 'session-prepared-exhausted',
      turnId: 'turn-prepared-exhausted',
    })
    await outbox.saveAssistantOutboxIntent(vaultRoot, {
      ...seeded,
      attemptCount: ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS,
      deliveryConfirmationPending: true,
      deliveryTransportIdempotent: true,
      lastAttemptAt: '2026-04-08T10:01:00.000Z',
      lastError: {
        code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
        message: 'provider acceptance remains unconfirmed',
      },
      nextAttemptAt: '2026-04-08T10:30:00.000Z',
      status: 'retryable',
      updatedAt: '2026-04-08T10:01:00.000Z',
    })

    await expect(outbox.beginAssistantOutboxIntentMirrorPreparedDispatch({
      deliveryIdempotencyKey: 'prepared-retry-key',
      deliveryTransportIdempotent: true,
      intentId: seeded.intentId,
      startedAt: '2026-04-08T10:30:00.000Z',
      vault: vaultRoot,
    })).resolves.toMatchObject({
      intent: {
        attemptCount: ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS,
        lastError: {
          code: 'ASSISTANT_DELIVERY_RETRY_EXHAUSTED',
        },
        nextAttemptAt: null,
        status: 'failed',
      },
      ownsDispatch: false,
      preparedDispatchToken: null,
      previousDispatchState: {
        attemptCount: ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS,
        deliveryConfirmationPending: true,
        status: 'retryable',
      },
    })
  })

  it('terminalizes the final hosted prepared claim after a definite failure', async () => {
    const { outbox } = await loadOutboxModule()
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-thresholds-prepared-final-failure-',
    )
    const seeded = await createIntent(outbox, vaultRoot, {
      createdAt: '2026-04-08T10:00:00.000Z',
      message: 'terminalize the final hosted attempt',
      sessionId: 'session-prepared-final-failure',
      turnId: 'turn-prepared-final-failure',
    })
    await outbox.saveAssistantOutboxIntent(vaultRoot, {
      ...seeded,
      attemptCount: ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS - 1,
      lastAttemptAt: '2026-04-08T10:01:00.000Z',
      lastError: {
        code: 'REQUEST_FAILED',
        message: 'try the final hosted attempt',
      },
      nextAttemptAt: '2026-04-08T10:30:00.000Z',
      status: 'retryable',
      updatedAt: '2026-04-08T10:01:00.000Z',
    })

    const prepared = await outbox.beginAssistantOutboxIntentMirrorPreparedDispatch({
      deliveryIdempotencyKey: 'prepared-final-failure-key',
      deliveryTransportIdempotent: true,
      intentId: seeded.intentId,
      startedAt: '2026-04-08T10:30:00.000Z',
      vault: vaultRoot,
    })
    expect(prepared).toMatchObject({
      intent: {
        attemptCount: ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS,
        status: 'sending',
      },
      ownsDispatch: true,
    })

    await expect(outbox.markAssistantOutboxIntentMirrorRetryableById({
      error: Object.assign(new Error('provider remained unavailable'), {
        retryable: true,
      }),
      failedAt: new Date('2026-04-08T10:31:00.000Z'),
      intentId: seeded.intentId,
      vault: vaultRoot,
    })).resolves.toMatchObject({
      attemptCount: ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS,
      lastError: {
        code: 'ASSISTANT_DELIVERY_RETRY_EXHAUSTED',
      },
      nextAttemptAt: null,
      status: 'failed',
    })

    await expect(outbox.beginAssistantOutboxIntentMirrorPreparedDispatch({
      deliveryIdempotencyKey: 'prepared-final-failure-key',
      deliveryTransportIdempotent: true,
      intentId: seeded.intentId,
      startedAt: '2026-04-08T11:00:00.000Z',
      vault: vaultRoot,
    })).resolves.toMatchObject({
      intent: {
        attemptCount: ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS,
        status: 'failed',
      },
      ownsDispatch: false,
    })
  })

  it('terminalizes a stale exhausted idempotent send before replaying it', async () => {
    const deliverAssistantMessageOverBinding = vi.fn()
    const { outbox } = await loadOutboxModule({
      deliverAssistantMessageOverBinding,
    })
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-thresholds-stale-idempotent-exhausted-',
    )
    const seeded = await createIntent(outbox, vaultRoot, {
      createdAt: '2026-04-08T10:00:00.000Z',
      message: 'do not replay a stale exhausted send',
      sessionId: 'session-stale-idempotent-exhausted',
      turnId: 'turn-stale-idempotent-exhausted',
    })
    await outbox.saveAssistantOutboxIntent(vaultRoot, {
      ...seeded,
      attemptCount: ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS,
      deliveryIdempotencyKey: 'stale-idempotent-key',
      deliveryTransportIdempotent: true,
      lastAttemptAt: '2026-04-08T10:00:00.000Z',
      lastError: {
        code: 'REQUEST_FAILED',
        message: 'runtime stopped during the final attempt',
      },
      nextAttemptAt: null,
      status: 'sending',
      updatedAt: '2026-04-08T10:00:00.000Z',
    })

    await expect(outbox.dispatchAssistantOutboxIntent({
      intentId: seeded.intentId,
      now: new Date('2026-04-08T10:11:00.000Z'),
      vault: vaultRoot,
    })).resolves.toMatchObject({
      deliveryError: {
        code: 'ASSISTANT_DELIVERY_RETRY_EXHAUSTED',
      },
      intent: {
        attemptCount: ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS,
        nextAttemptAt: null,
        status: 'failed',
      },
      session: null,
    })
    expect(deliverAssistantMessageOverBinding).not.toHaveBeenCalled()
  })

  it('reconciles proof for a stale exhausted idempotent send before terminalizing it', async () => {
    const deliverAssistantMessageOverBinding = vi.fn()
    const { outbox } = await loadOutboxModule({
      deliverAssistantMessageOverBinding,
    })
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-thresholds-stale-idempotent-reconciled-',
    )
    const seeded = await createIntent(outbox, vaultRoot, {
      createdAt: '2026-04-08T10:00:00.000Z',
      message: 'reconcile a stale exhausted send',
      sessionId: 'session-stale-idempotent-reconciled',
      turnId: 'turn-stale-idempotent-reconciled',
    })
    await outbox.saveAssistantOutboxIntent(vaultRoot, {
      ...seeded,
      attemptCount: ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS,
      deliveryIdempotencyKey: 'stale-idempotent-key',
      deliveryTransportIdempotent: true,
      lastAttemptAt: '2026-04-08T10:00:00.000Z',
      lastError: {
        code: 'REQUEST_FAILED',
        message: 'runtime stopped during the final attempt',
      },
      nextAttemptAt: null,
      status: 'sending',
      updatedAt: '2026-04-08T10:00:00.000Z',
    })
    const recoveredDelivery = createDelivery({
      idempotencyKey: 'stale-idempotent-key',
      providerMessageId: 'provider-reconciled-final-attempt',
      sentAt: '2026-04-08T10:00:01.000Z',
    })

    await expect(outbox.dispatchAssistantOutboxIntent({
      dispatchHooks: {
        resolveDeliveredIntent: async () => recoveredDelivery,
      },
      intentId: seeded.intentId,
      now: new Date('2026-04-08T10:11:00.000Z'),
      vault: vaultRoot,
    })).resolves.toMatchObject({
      deliveryError: null,
      intent: {
        attemptCount: ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS,
        delivery: recoveredDelivery,
        status: 'sent',
      },
      session: null,
    })
    expect(deliverAssistantMessageOverBinding).not.toHaveBeenCalled()
  })

  it('allows the final bounded attempt and terminalizes its definite failure', async () => {
    const deliverAssistantMessageOverBinding = vi.fn(async () => {
      throw Object.assign(new Error('provider remained unavailable'), {
        retryable: true,
      })
    })
    const { outbox } = await loadOutboxModule({
      deliverAssistantMessageOverBinding,
    })
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-thresholds-final-retry-',
    )
    const seeded = await createIntent(outbox, vaultRoot, {
      createdAt: '2026-04-08T10:00:00.000Z',
      message: 'use the final bounded attempt',
      sessionId: 'session-final-retry',
      turnId: 'turn-final-retry',
    })
    await outbox.saveAssistantOutboxIntent(vaultRoot, {
      ...seeded,
      attemptCount: ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS - 1,
      lastAttemptAt: '2026-04-08T10:01:00.000Z',
      lastError: {
        code: 'REQUEST_FAILED',
        message: 'try again',
      },
      nextAttemptAt: '2026-04-08T10:30:00.000Z',
      status: 'retryable',
      updatedAt: '2026-04-08T10:01:00.000Z',
    })

    await expect(outbox.dispatchAssistantOutboxIntent({
      intentId: seeded.intentId,
      now: new Date('2026-04-08T10:30:00.000Z'),
      vault: vaultRoot,
    })).resolves.toMatchObject({
      deliveryError: {
        code: 'ASSISTANT_DELIVERY_RETRY_EXHAUSTED',
      },
      intent: {
        attemptCount: ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS,
        nextAttemptAt: null,
        status: 'failed',
      },
      session: null,
    })
    expect(deliverAssistantMessageOverBinding).toHaveBeenCalledOnce()
  })

  it('keeps idempotent confirmation-pending intents dispatchable without rescheduling them', async () => {
    const deliverAssistantMessageOverBinding = vi.fn(async () => ({
      delivery: createDelivery({
        idempotencyKey: 'existing-idempotency',
        providerMessageId: 'provider-retry-success',
        sentAt: '2026-04-08T11:05:00.000Z',
      }),
      deliveryTransportIdempotent: true,
      session: null,
    }))
    const { outbox } = await loadOutboxModule({
      deliverAssistantMessageOverBinding,
    })
    const { vaultRoot } = await createAssistantVault('assistant-outbox-thresholds-idempotent-')
    const seeded = await createIntent(outbox, vaultRoot, {
      createdAt: '2026-04-08T11:00:00.000Z',
      message: 'retry the idempotent delivery',
      sessionId: 'session-idempotent',
      turnId: 'turn-idempotent',
    })

    await outbox.saveAssistantOutboxIntent(vaultRoot, {
      ...seeded,
      attemptCount: 1,
      delivery: createDelivery({
        idempotencyKey: 'existing-idempotency',
        providerMessageId: 'provider-pending',
        sentAt: '2026-04-08T11:01:00.000Z',
      }),
      deliveryConfirmationPending: true,
      deliveryIdempotencyKey: 'existing-idempotency',
      deliveryTransportIdempotent: true,
      lastAttemptAt: '2026-04-08T11:01:00.000Z',
      lastError: {
        code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
        message:
          'Assistant outbound delivery may have succeeded already and must be reconciled before resend.',
      },
      nextAttemptAt: null,
      status: 'sending',
      updatedAt: '2026-04-08T11:01:00.000Z',
    })

    await expect(
      outbox.dispatchAssistantOutboxIntent({
        force: true,
        intentId: seeded.intentId,
        now: new Date('2026-04-08T11:05:00.000Z'),
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      deliveryError: {
        code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
      },
      intent: {
        deliveryConfirmationPending: true,
        intentId: seeded.intentId,
        status: 'sending',
      },
      session: null,
    })
    expect(deliverAssistantMessageOverBinding).not.toHaveBeenCalled()
  })

  it.each([
    {
      channel: 'telegram',
      explicitTarget: null,
      identityId: 'participant-telegram',
      replyToMessageId: 'telegram-msg-1',
      threadId: 'thread-telegram',
      threadIsDirect: true,
      target: 'participant-telegram',
      targetKind: 'participant' as const,
    },
    {
      channel: 'email',
      explicitTarget: 'user@example.com',
      identityId: 'sender@example.com',
      replyToMessageId: 'email-msg-1',
      threadId: 'thread-email',
      threadIsDirect: true,
      target: 'thread-email',
      targetKind: 'thread' as const,
    },
  ])(
    'reconciles stale non-idempotent $channel sends from persisted delivery without invoking the adapter',
    async ({
      channel,
      explicitTarget,
      identityId,
      replyToMessageId,
      threadId,
      threadIsDirect,
      target,
      targetKind,
    }) => {
      const deliverAssistantMessageOverBinding = vi.fn(async () => ({
        delivery: createDelivery({
          channel,
          providerMessageId: 'provider-unexpected-resend',
          sentAt: '2026-04-08T11:12:00.000Z',
          target,
          targetKind,
        }),
        deliveryTransportIdempotent: false,
        session: null,
      }))
      const { outbox } = await loadOutboxModule({
        deliverAssistantMessageOverBinding,
      })
      const { vaultRoot } = await createAssistantVault(`assistant-outbox-thresholds-${channel}-stale-reconcile-`)
      const seeded = await createIntent(outbox, vaultRoot, {
        channel,
        createdAt: '2026-04-08T11:00:00.000Z',
        explicitTarget,
        identityId,
        message: `${channel} stale persisted delivery`,
        replyToMessageId,
        sessionId: `session-${channel}-stale-reconcile`,
        threadId,
        threadIsDirect,
        turnId: `turn-${channel}-stale-reconcile`,
      })
      const persistedDelivery = createDelivery({
        channel,
        idempotencyKey: null,
        providerMessageId: `provider-${channel}-persisted`,
        providerThreadId: threadId,
        sentAt: '2026-04-08T11:01:00.000Z',
        target,
        targetKind,
      })

      await outbox.saveAssistantOutboxIntent(vaultRoot, {
        ...seeded,
        attemptCount: 1,
        delivery: persistedDelivery,
        deliveryConfirmationPending: false,
        deliveryIdempotencyKey: persistedDelivery.idempotencyKey,
        deliveryTransportIdempotent: false,
        lastAttemptAt: '2026-04-08T11:01:00.000Z',
        lastError: {
          code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
          message:
            'Assistant outbound delivery may have succeeded already and must be reconciled before resend.',
        },
        nextAttemptAt: null,
        status: 'sending',
        updatedAt: '2026-04-08T11:01:00.000Z',
      })

      await expect(
        outbox.dispatchAssistantOutboxIntent({
          intentId: seeded.intentId,
          now: new Date('2026-04-08T11:20:00.000Z'),
          vault: vaultRoot,
        }),
      ).resolves.toMatchObject({
        deliveryError: null,
        intent: {
          delivery: persistedDelivery,
          deliveryConfirmationPending: false,
          intentId: seeded.intentId,
          sentAt: '2026-04-08T11:01:00.000Z',
          status: 'sent',
        },
        session: null,
      })
      expect(deliverAssistantMessageOverBinding).not.toHaveBeenCalled()
    },
  )

  it.each([
    {
      channel: 'telegram',
      explicitTarget: null,
      identityId: 'participant-telegram',
      replyToMessageId: 'telegram-msg-2',
      threadId: 'thread-telegram',
      threadIsDirect: true,
    },
    {
      channel: 'email',
      explicitTarget: 'user@example.com',
      identityId: 'sender@example.com',
      replyToMessageId: 'email-msg-2',
      threadId: 'thread-email',
      threadIsDirect: true,
    },
  ])(
    'fails stale non-idempotent $channel sends closed when no persisted delivery exists',
    async ({
      channel,
      explicitTarget,
      identityId,
      replyToMessageId,
      threadId,
      threadIsDirect,
    }) => {
      const deliverAssistantMessageOverBinding = vi.fn(async () => ({
        delivery: createDelivery({
          channel,
          providerMessageId: 'provider-unexpected-resend',
          sentAt: '2026-04-08T11:22:00.000Z',
        }),
        deliveryTransportIdempotent: false,
        session: null,
      }))
      const { outbox } = await loadOutboxModule({
        deliverAssistantMessageOverBinding,
      })
      const { vaultRoot } = await createAssistantVault(`assistant-outbox-thresholds-${channel}-stale-blocked-`)
      const seeded = await createIntent(outbox, vaultRoot, {
        channel,
        createdAt: '2026-04-08T11:00:00.000Z',
        explicitTarget,
        identityId,
        message: `${channel} stale missing delivery`,
        replyToMessageId,
        sessionId: `session-${channel}-stale-blocked`,
        threadId,
        threadIsDirect,
        turnId: `turn-${channel}-stale-blocked`,
      })

      await outbox.saveAssistantOutboxIntent(vaultRoot, {
        ...seeded,
        attemptCount: 1,
        delivery: null,
        deliveryConfirmationPending: false,
        deliveryIdempotencyKey: null,
        deliveryTransportIdempotent: false,
        lastAttemptAt: '2026-04-08T11:01:00.000Z',
        lastError: null,
        nextAttemptAt: null,
        status: 'sending',
        updatedAt: '2026-04-08T11:01:00.000Z',
      })

      await expect(
        outbox.dispatchAssistantOutboxIntent({
          intentId: seeded.intentId,
          now: new Date('2026-04-08T11:20:00.000Z'),
          vault: vaultRoot,
        }),
      ).resolves.toMatchObject({
        deliveryError: {
          code: 'ASSISTANT_DELIVERY_AMBIGUOUS',
        },
        intent: {
          deliveryConfirmationPending: false,
          intentId: seeded.intentId,
          status: 'failed',
        },
        session: null,
      })
      expect(deliverAssistantMessageOverBinding).not.toHaveBeenCalled()
    },
  )

  it('keeps stale idempotent sends retryable through the adapter path', async () => {
    const deliverAssistantMessageOverBinding = vi.fn(async () => ({
      delivery: createDelivery({
        channel: 'linq',
        idempotencyKey: 'existing-idempotency',
        providerMessageId: 'provider-linq-retry',
        providerThreadId: 'linq-thread-1',
        sentAt: '2026-04-08T12:01:00.000Z',
        target: 'linq-thread-1',
        targetKind: 'thread',
      }),
      deliveryTransportIdempotent: true,
      session: null,
    }))
    const { outbox } = await loadOutboxModule({
      deliverAssistantMessageOverBinding,
    })
    const { vaultRoot } = await createAssistantVault('assistant-outbox-thresholds-linq-stale-retry-')
    const seeded = await createIntent(outbox, vaultRoot, {
      channel: 'linq',
      createdAt: '2026-04-08T11:00:00.000Z',
      explicitTarget: 'linq-thread-1',
      identityId: 'phone_lookup_1',
      message: 'linq stale retry',
      replyToMessageId: 'linq-msg-1',
      sessionId: 'session-linq-stale-retry',
      threadId: 'linq-thread-1',
      threadIsDirect: true,
      turnId: 'turn-linq-stale-retry',
    })

    await outbox.saveAssistantOutboxIntent(vaultRoot, {
      ...seeded,
      attemptCount: 1,
      delivery: null,
      deliveryConfirmationPending: false,
      deliveryIdempotencyKey: 'existing-idempotency',
      deliveryTransportIdempotent: true,
      lastAttemptAt: '2026-04-08T11:01:00.000Z',
      lastError: null,
      nextAttemptAt: null,
      status: 'sending',
      updatedAt: '2026-04-08T11:01:00.000Z',
    })

    await expect(
      outbox.dispatchAssistantOutboxIntent({
        intentId: seeded.intentId,
        now: new Date('2026-04-08T12:00:00.000Z'),
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      deliveryError: null,
      intent: {
        delivery: {
          channel: 'linq',
          providerMessageId: 'provider-linq-retry',
        },
        intentId: seeded.intentId,
        status: 'sent',
      },
      session: null,
    })
    expect(deliverAssistantMessageOverBinding).toHaveBeenCalledOnce()
  })

  it('returns failed delivery results for permanent outbox errors', async () => {
    const deliverAssistantMessageOverBinding = vi.fn(async () => {
      throw Object.assign(new Error('channel required'), {
        code: 'CHANNEL_REQUIRED',
      })
    })
    const { outbox } = await loadOutboxModule({
      deliverAssistantMessageOverBinding,
    })
    const { vaultRoot } = await createAssistantVault('assistant-outbox-thresholds-failed-')

    await expect(
      outbox.deliverAssistantOutboxMessage({
        channel: 'telegram',
        identityId: 'participant-1',
        message: 'permanent failure',
        sessionId: 'session-failed',
        threadId: 'thread-failed',
        threadIsDirect: true,
        turnId: 'turn-failed',
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      delivery: null,
      deliveryError: {
        code: 'CHANNEL_REQUIRED',
      },
      kind: 'failed',
      session: null,
    })
  })

  it('marks delivery confirmation pending when session persistence fails after send', async () => {
    const deliverAssistantMessageOverBinding = vi.fn(async () => ({
      delivery: createDelivery({
        providerMessageId: 'provider-session-warning',
        sentAt: '2026-04-08T11:30:00.000Z',
      }),
      deliveryTransportIdempotent: false,
      session: {
        not: 'a valid assistant session',
      },
    }))
    const { outbox } = await loadOutboxModule({
      deliverAssistantMessageOverBinding,
    })
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-thresholds-session-warning-',
    )
    const seeded = await createIntent(outbox, vaultRoot, {
      createdAt: '2026-04-08T11:25:00.000Z',
      message: 'warn but keep the send',
      sessionId: 'session-warning',
      turnId: 'turn-warning',
    })

    await expect(
      outbox.dispatchAssistantOutboxIntent({
        force: true,
        intentId: seeded.intentId,
        now: new Date('2026-04-08T11:30:00.000Z'),
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      deliveryError: {
        code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
      },
      intent: {
        intentId: seeded.intentId,
        status: 'sending',
      },
    })
  })

  it('keeps a tracked provider receipt callback-replayable when its first checkpoint write fails', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-15T13:00:00.000Z'))
    const deliveryIdempotencyKey =
      'phone-call-result:hpc_checkpoint_recovery:generation:1'
    let checkpointIntentPath: string | null = null
    let providerDelivered = false
    let failNextPostSendCheckpoint = true
    const rename = vi.fn(async (...args: Parameters<typeof renameFile>) => {
      if (
        providerDelivered &&
        failNextPostSendCheckpoint &&
        args[1] === checkpointIntentPath
      ) {
        failNextPostSendCheckpoint = false
        throw Object.assign(new Error('checkpoint write unavailable'), {
          code: 'EIO',
        })
      }
      return renameFile(...args)
    })
    const deliverAssistantMessageOverBinding = vi.fn(async () => {
      providerDelivered = true
      vi.setSystemTime(new Date('2026-08-15T13:00:30.000Z'))
      return {
        delivery: createDelivery({
          idempotencyKey: deliveryIdempotencyKey,
          providerMessageId: 'provider-phone-call-checkpoint-recovery',
          sentAt: '2026-08-15T13:00:00.000Z',
        }),
        deliveryTransportIdempotent: false,
        session: null,
      }
    })
    const { outbox } = await loadOutboxModule({
      deliverAssistantMessageOverBinding,
      rename,
    })
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-outbox-phone-call-checkpoint-recovery-',
    )
    const seeded = await createIntent(outbox, vaultRoot, {
      deliveryIdempotencyKey,
      deliveryTransportIdempotent: false,
      explicitTarget: 'telegram-call-result',
      threadId: 'telegram-call-result',
    })
    checkpointIntentPath = resolveAssistantOutboxIntentPath(
      paths.outboxDirectory,
      seeded.intentId,
    )
    const confirmTerminalIntent = vi.fn()
      .mockImplementationOnce(async () => {
        vi.setSystemTime(new Date(Date.now() + 45_000))
        throw new Error('terminal callback deadline elapsed')
      })
      .mockResolvedValueOnce(undefined)
    const dispatchHooks = {
      confirmTerminalIntent,
      requiresTerminalConfirmation: ({ intent }: {
        intent: { deliveryIdempotencyKey: string | null }
      }) => intent.deliveryIdempotencyKey === deliveryIdempotencyKey,
    }

    const first = await outbox.dispatchAssistantOutboxIntent({
      dispatchHooks,
      force: true,
      intentId: seeded.intentId,
      vault: vaultRoot,
    })

    expect(failNextPostSendCheckpoint).toBe(false)
    expect(first.intent).toMatchObject({
      delivery: expect.objectContaining({
        providerMessageId: 'provider-phone-call-checkpoint-recovery',
      }),
      deliveryConfirmationPending: true,
      status: 'retryable',
    })
    expect(Date.parse(first.intent.nextAttemptAt ?? '')).toBeGreaterThan(
      Date.parse('2026-08-15T13:01:15.000Z'),
    )
    expect(confirmTerminalIntent).toHaveBeenCalledOnce()

    vi.setSystemTime(new Date(first.intent.nextAttemptAt!))
    const restarted = await outbox.dispatchAssistantOutboxIntent({
      dispatchHooks,
      intentId: seeded.intentId,
      now: new Date(first.intent.nextAttemptAt!),
      vault: vaultRoot,
    })

    expect(restarted.intent).toMatchObject({
      deliveryConfirmationPending: false,
      status: 'sent',
    })
    expect(deliverAssistantMessageOverBinding).toHaveBeenCalledOnce()
    expect(confirmTerminalIntent).toHaveBeenCalledTimes(2)
  })

  it('preserves failed turn receipts after a later successful send', async () => {
    const deliverAssistantMessageOverBinding = vi.fn(async () => ({
      delivery: createDelivery({
        providerMessageId: 'provider-preserved-failure',
        sentAt: '2026-04-08T12:05:00.000Z',
      }),
      deliveryTransportIdempotent: false,
      session: null,
    }))
    const { outbox, turns } = await loadOutboxModule({
      deliverAssistantMessageOverBinding,
    })
    const { vaultRoot } = await createAssistantVault('assistant-outbox-thresholds-receipt-')
    const seeded = await createIntent(outbox, vaultRoot, {
      createdAt: '2026-04-08T12:00:00.000Z',
      message: 'repair a failed receipt',
      sessionId: 'session-receipt',
      turnId: 'turn-receipt',
    })

    await turns.createAssistantTurnReceipt({
      deliveryRequested: true,
      prompt: 'prompt',
      provider: 'codex-cli',
      providerModel: 'model',
      sessionId: seeded.sessionId,
      startedAt: '2026-04-08T12:00:00.000Z',
      turnId: seeded.turnId,
      vault: vaultRoot,
    })
    await turns.finalizeAssistantTurnReceipt({
      completedAt: '2026-04-08T12:01:00.000Z',
      deliveryDisposition: 'failed',
      error: {
        code: 'REQUEST_FAILED',
        message: 'temporary failure',
      },
      status: 'failed',
      turnId: seeded.turnId,
      vault: vaultRoot,
    })

    const dispatched = await outbox.dispatchAssistantOutboxIntent({
      force: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T12:05:00.000Z'),
      vault: vaultRoot,
    })
    const receipt = await turns.readAssistantTurnReceipt(vaultRoot, seeded.turnId)

    expect(dispatched.intent.status).toBe('sent')
    expect(receipt).toMatchObject({
      deliveryDisposition: 'sent',
      lastError: null,
      status: 'failed',
    })
  })

  it('runs required delivery persistence before the canonical sent mark', async () => {
    const delivery = createDelivery({
      providerMessageId: 'provider-raced-send',
      sentAt: '2026-04-08T13:01:00.000Z',
    })
    const deliverAssistantMessageOverBinding = vi.fn(async () => ({
      delivery,
      deliveryTransportIdempotent: false,
      session: null,
    }))
    const { outbox } = await loadOutboxModule({
      deliverAssistantMessageOverBinding,
    })
    const { vaultRoot } = await createAssistantVault('assistant-outbox-thresholds-race-')
    const seeded = await createIntent(outbox, vaultRoot, {
      createdAt: '2026-04-08T13:00:00.000Z',
      message: 'persist hook observes the sent mark',
      sessionId: 'session-race',
      turnId: 'turn-race',
    })
    const persistDeliveredIntent = vi.fn(async ({ intent }) => {
      expect(intent).toMatchObject({
        delivery,
        deliveryConfirmationPending: false,
        sentAt: null,
        status: 'sending',
      })
    })
    const dispatched = await outbox.dispatchAssistantOutboxIntent({
      dispatchHooks: { persistDeliveredIntent },
      force: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T13:01:00.000Z'),
      vault: vaultRoot,
    })

    expect(dispatched.intent).toMatchObject({
      intentId: seeded.intentId,
      sentAt: '2026-04-08T13:01:00.000Z',
      status: 'sent',
      updatedAt: '2026-04-08T13:01:00.000Z',
    })
    expect(persistDeliveredIntent).toHaveBeenCalledOnce()
  })

  it('surfaces non-missing quarantine rename failures', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-outbox-thresholds-quarantine-',
    )
    await writeFile(
      path.join(paths.outboxDirectory, 'broken.json'),
      '{"schema":"murph.assistant-outbox-intent.v1"',
      'utf8',
    )

    const renameError = Object.assign(new Error('permission denied'), {
      code: 'EPERM',
    })
    const rename = vi.fn(async () => {
      throw renameError
    })
    const { outbox } = await loadOutboxModule({
      rename,
    })

    await expect(outbox.listAssistantOutboxIntentsLocal(vaultRoot)).rejects.toBe(renameError)
    expect(rename).toHaveBeenCalledOnce()
  })

  it('reads inventory files with fixed bounded concurrency and reports scan size', async () => {
    const { outbox: seedOutbox } = await loadOutboxModule()
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-thresholds-inventory-concurrency-',
    )
    for (let index = 0; index < 10; index += 1) {
      await createIntent(seedOutbox, vaultRoot, {
        createdAt: `2026-04-08T15:00:${String(index).padStart(2, '0')}.000Z`,
        message: `inventory message ${index}`,
        sessionId: `session-inventory-${index}`,
        turnId: `turn-inventory-${index}`,
      })
    }

    let activeReads = 0
    let maxActiveReads = 0
    let trackedBytes = 0
    const delayedReadFile = async (
      filePath: string,
      encoding: 'utf8',
    ): Promise<string> => {
      activeReads += 1
      maxActiveReads = Math.max(maxActiveReads, activeReads)
      try {
        await new Promise((resolve) => setTimeout(resolve, 5))
        const raw = await readFile(filePath, encoding)
        trackedBytes += Buffer.byteLength(raw, 'utf8')
        return raw
      } finally {
        activeReads -= 1
      }
    }
    const { outbox } = await loadOutboxModule({ readFile: delayedReadFile })
    let scanMetrics: { bytesRead: number; filesRead: number } | null = null

    const intents = await outbox.listAssistantOutboxIntentsLocal(
      vaultRoot,
      (metrics) => {
        scanMetrics = metrics
      },
    )

    expect(intents.map((intent) => intent.message)).toEqual(
      Array.from({ length: 10 }, (_, index) => `inventory message ${index}`),
    )
    expect(maxActiveReads).toBe(4)
    expect(scanMetrics).toEqual({
      bytesRead: trackedBytes,
      filesRead: 10,
    })
  })

  it('treats explicit delivery-may-have-succeeded errors as ambiguous retries', async () => {
    const deliverAssistantMessageOverBinding = vi.fn(async () => {
      throw Object.assign(new Error('socket closed after send'), {
        deliveryMayHaveSucceeded: true,
      })
    })
    const { outbox } = await loadOutboxModule({
      deliverAssistantMessageOverBinding,
    })
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-thresholds-confirmation-pending-',
    )
    const seeded = await createIntent(outbox, vaultRoot, {
      createdAt: '2026-04-08T14:00:00.000Z',
      message: 'ambiguous post-send failure',
      sessionId: 'session-confirmation',
      turnId: 'turn-confirmation',
    })
    await outbox.saveAssistantOutboxIntent(vaultRoot, {
      ...seeded,
      attemptCount: ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS - 1,
      lastAttemptAt: '2026-04-08T14:01:00.000Z',
      nextAttemptAt: '2026-04-08T14:05:00.000Z',
      status: 'retryable',
      updatedAt: '2026-04-08T14:01:00.000Z',
    })

    const ambiguous = await outbox.dispatchAssistantOutboxIntent({
      force: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T14:05:00.000Z'),
      vault: vaultRoot,
    })
    expect(ambiguous).toMatchObject({
      deliveryError: {
        code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
      },
      intent: {
        attemptCount: ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS,
        deliveryConfirmationPending: false,
        status: 'retryable',
      },
      session: null,
    })

    const exhausted = await outbox.dispatchAssistantOutboxIntent({
      force: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T14:35:00.000Z'),
      vault: vaultRoot,
    })
    expect(exhausted).toMatchObject({
      deliveryError: {
        code: 'ASSISTANT_DELIVERY_RETRY_EXHAUSTED',
      },
      intent: {
        attemptCount: ASSISTANT_OUTBOX_MAX_RETRY_ATTEMPTS,
        nextAttemptAt: null,
        status: 'failed',
      },
      session: null,
    })
    expect(deliverAssistantMessageOverBinding).toHaveBeenCalledOnce()
  })
})

async function loadOutboxModule(options: {
  deliverAssistantMessageOverBinding?: (...args: never[]) => Promise<unknown>
  readFile?: (filePath: string, encoding: 'utf8') => Promise<string>
  rename?: typeof renameFile
  saveAssistantSession?: (...args: never[]) => Promise<unknown>
} = {}) {
  vi.resetModules()
  vi.doMock('../src/outbound-channel.ts', () => ({
    deliverAssistantMessageOverBinding:
      options.deliverAssistantMessageOverBinding ?? vi.fn(),
  }))

  if (options.readFile || options.rename) {
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>(
        'node:fs/promises',
      )
      return {
        ...actual,
        ...(options.readFile ? { readFile: options.readFile } : {}),
        ...(options.rename ? { rename: options.rename } : {}),
      }
    })
  }

  if (options.saveAssistantSession) {
    vi.doMock('../src/assistant/store.js', async () => {
      const actual = await vi.importActual<typeof import('../src/assistant/store.ts')>(
        '../src/assistant/store.ts',
      )
      return {
        ...actual,
        saveAssistantSession: options.saveAssistantSession,
      }
    })
  }

  const outbox = await import('../src/assistant/outbox.ts')
  const turns = await import('../src/assistant/turns.ts')
  return {
    outbox,
    turns,
  }
}

async function createAssistantVault(prefix: string): Promise<{
  paths: ReturnType<typeof resolveAssistantStatePaths>
  vaultRoot: string
}> {
  const { parentRoot, vaultRoot } = await createTempVaultContext(prefix)
  tempRoots.push(parentRoot)
  const paths = resolveAssistantStatePaths(vaultRoot)
  await ensureAssistantState(paths)
  return {
    paths,
    vaultRoot,
  }
}

async function createIntent(
  outbox: Awaited<ReturnType<typeof loadOutboxModule>>['outbox'],
  vault: string,
  overrides: Partial<{
    channel: string
    createdAt: string
    deliveryIdempotencyKey: string | null
    deliveryTransportIdempotent: boolean
    explicitTarget: string | null
    identityId: string
    message: string
    replyToMessageId: string | null
    sessionId: string
    threadId: string
    threadIsDirect: boolean
    turnId: string
  }> = {},
) {
  const sessionId = overrides.sessionId ?? 'session-test'
  const turnId = overrides.turnId ?? 'turn-test'
  return outbox.createAssistantOutboxIntent({
    channel: overrides.channel ?? 'telegram',
    createdAt: overrides.createdAt,
    deliveryIdempotencyKey: overrides.deliveryIdempotencyKey,
    deliveryTransportIdempotent: overrides.deliveryTransportIdempotent,
    explicitTarget: overrides.explicitTarget ?? null,
    identityId: overrides.identityId ?? 'participant-1',
    message: overrides.message ?? 'assistant outbox threshold coverage',
    replyToMessageId: overrides.replyToMessageId ?? null,
    sessionId,
    threadId: overrides.threadId ?? 'thread-test',
    threadIsDirect: overrides.threadIsDirect ?? true,
    turnId,
    vault,
  })
}

type AssistantMessageChannelDelivery = Extract<
  AssistantChannelDelivery,
  { kind?: 'message' }
>

function createDelivery(
  overrides: Partial<AssistantMessageChannelDelivery> = {},
): AssistantMessageChannelDelivery {
  return {
    channel: 'telegram',
    idempotencyKey: 'delivery-idempotency',
    messageLength: 12,
    providerMessageId: 'provider-message',
    providerThreadId: 'provider-thread',
    sentAt: '2026-04-08T00:00:00.000Z',
    target: 'participant-1',
    targetKind: 'participant',
    ...overrides,
  }
}
