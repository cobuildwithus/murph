import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assistantDeliveryErrorSchema,
  type AssistantChannelDelivery,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  beginAssistantOutboxIntentMirrorDispatch,
  beginAssistantOutboxIntentMirrorPreparedDispatch,
  createAssistantOutboxIntent,
  readAssistantOutboxIntent,
  saveAssistantOutboxIntent,
} from '../src/assistant/outbox.ts'
import {
  buildAssistantOutboxIntentMirrorState,
  rescheduleAssistantOutboxConfirmationRetry,
  markAssistantOutboxIntentSent,
  markAssistantOutboxIntentMirrorRetryable,
  markAssistantOutboxIntentMirrorTerminal,
  persistAssistantOutboxIntentLinqAppCardTextFallback,
  preserveAssistantOutboxAcceptedMediaDeliveryOrder,
  resetAssistantOutboxPreparedDispatch,
  sameAssistantChannelDelivery,
  updateAssistantOutboxAfterDispatchFailure,
} from '../src/assistant/outbox/dispatch-state.ts'
import { resolveAssistantOutboxIntentPath } from '../src/assistant/outbox/intents.ts'
import {
  createAssistantTurnReceipt,
  readAssistantTurnReceipt,
  updateAssistantTurnReceipt,
} from '../src/assistant/turns.ts'
import { readAssistantDiagnosticsSnapshot } from '../src/assistant/diagnostics.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'

type AssistantMessageChannelDelivery = Extract<
  AssistantChannelDelivery,
  { kind?: 'message' }
>

it('distinguishes physical media ownership in delivery equality', () => {
  const delivery = {
    channel: 'linq',
    idempotencyKey: 'delivery-media-owner',
    messageLength: 0,
    providerMessageEffects: [{
      message: null,
      providerMessageId: 'provider-message-media-owner',
    }],
    providerMessageId: 'provider-message-media-owner',
    providerMessageIds: ['provider-message-media-owner'],
    providerThreadId: 'thread-media-owner',
    sentAt: '2030-04-13T00:30:00.000Z',
    target: 'thread-media-owner',
    targetKind: 'thread',
  } satisfies AssistantChannelDelivery

  expect(sameAssistantChannelDelivery(delivery, {
    ...delivery,
    providerMessageEffects: [{
      carriesIntentMedia: true,
      message: null,
      providerMessageId: 'provider-message-media-owner',
    }],
  })).toBe(false)
})

it('keeps one accepted Linq media delivery order through partial retries and completion', async () => {
  await withTempVault(async (vault) => {
    const sending = await createSendingIntent({
      attemptCount: 2,
      channel: 'linq',
      vault,
    })
    const idempotencyKey = `assistant-outbox:${sending.intentId}`
    const firstAcceptedAt = '2030-04-13T00:30:00.000Z'
    const acceptedMediaDelivery = {
      channel: 'linq',
      idempotencyKey,
      messageLength: sending.message.length,
      providerMessageEffects: [{
        carriesIntentMedia: true,
        message: 'Generated image',
        providerMessageId: 'provider-media-primary',
      }],
      providerMessageId: 'provider-media-primary',
      providerMessageIds: ['provider-media-primary'],
      providerThreadId: 'thread-media-retry',
      sentAt: firstAcceptedAt,
      target: 'thread-media-retry',
      targetKind: 'thread',
    } satisfies AssistantMessageChannelDelivery
    const acceptedIntent = await saveAssistantOutboxIntent(vault, {
      ...sending,
      delivery: acceptedMediaDelivery,
      deliveryConfirmationPending: false,
      deliveryIdempotencyKey: idempotencyKey,
    })

    const repeatedPartial = preserveAssistantOutboxAcceptedMediaDeliveryOrder({
      delivery: {
        ...acceptedMediaDelivery,
        sentAt: '2030-04-13T00:31:00.000Z',
      },
      intent: acceptedIntent,
    })
    expect(expectMessageDelivery(repeatedPartial).sentAt).toBe(firstAcceptedAt)

    const completed = preserveAssistantOutboxAcceptedMediaDeliveryOrder({
      delivery: {
        ...acceptedMediaDelivery,
        idempotencyKey: `${idempotencyKey}:link`,
        providerMessageEffects: [
          ...acceptedMediaDelivery.providerMessageEffects,
          {
            message: null,
            providerMessageId: 'provider-rich-link',
          },
        ],
        providerMessageId: 'provider-rich-link',
        providerMessageIds: [
          'provider-media-primary',
          'provider-rich-link',
        ],
        sentAt: '2030-04-13T00:32:00.000Z',
        targetKind: 'explicit',
      },
      intent: {
        ...acceptedIntent,
        delivery: repeatedPartial,
      },
    })
    expect(expectMessageDelivery(completed).sentAt).toBe(firstAcceptedAt)

    const unrelated = preserveAssistantOutboxAcceptedMediaDeliveryOrder({
      delivery: {
        ...expectMessageDelivery(completed),
        providerMessageEffects: [{
          carriesIntentMedia: true,
          message: 'Different image',
          providerMessageId: 'provider-other-media',
        }],
        providerMessageId: 'provider-other-media',
        providerMessageIds: ['provider-other-media'],
        sentAt: '2030-04-13T00:33:00.000Z',
      },
      intent: acceptedIntent,
    })
    expect(expectMessageDelivery(unrelated).sentAt).toBe(
      '2030-04-13T00:33:00.000Z',
    )
  })
})

const OUTBOX_RESPONSE_CARD = {
  kind: 'daily_nutrition',
  localDate: '2030-04-13',
  mealCount: 1,
  totals: {
    calories: { mealCount: 1, total: 520 },
    carbsGrams: { mealCount: 1, total: 48 },
    fatGrams: { mealCount: 1, total: 20 },
    proteinGrams: { mealCount: 1, total: 42 },
  },
} as const

function expectMessageDelivery(
  delivery: AssistantChannelDelivery | null | undefined,
): AssistantMessageChannelDelivery {
  if (!delivery || delivery.kind === 'message-reaction') {
    throw new Error('Expected assistant message delivery.')
  }

  return delivery
}

async function withTempVault(run: (vault: string) => Promise<void>): Promise<void> {
  const vault = await mkdtemp(path.join(os.tmpdir(), 'murph-assistant-outbox-'))
  try {
    await run(vault)
  } finally {
    await rm(vault, { recursive: true, force: true })
  }
}

async function createSendingIntent(input: {
  attemptCount: number
  channel?: 'email' | 'linq' | 'telegram'
  deliveryTransportIdempotent?: boolean
  vault: string
}): Promise<Awaited<ReturnType<typeof saveAssistantOutboxIntent>>> {
  await createAssistantTurnReceipt({
    deliveryRequested: true,
    prompt: 'hello from the outbox seam',
    provider: 'codex-cli',
    providerModel: 'gpt-5.4',
    sessionId: 'asst_outbox_test',
    turnId: `turn_outbox_${input.attemptCount}`,
    vault: input.vault,
  })

  const created = await createAssistantOutboxIntent({
    channel: input.channel ?? 'telegram',
    message: 'hello from the outbox seam',
    sessionId: 'asst_outbox_test',
    turnId: `turn_outbox_${input.attemptCount}`,
    vault: input.vault,
  })

  return await saveAssistantOutboxIntent(input.vault, {
    ...created,
    attemptCount: input.attemptCount,
    deliveryConfirmationPending: input.attemptCount > 1,
    deliveryTransportIdempotent: input.deliveryTransportIdempotent ?? false,
    lastAttemptAt: '2026-04-13T00:00:00.000Z',
    nextAttemptAt: null,
    status: 'sending',
    updatedAt: '2026-04-13T00:00:00.000Z',
  })
}

describe('assistant outbox dispatch-state', () => {
  it('allows media-only voice memo intents but still rejects empty text-only intents', async () => {
    await withTempVault(async (vault) => {
      const media = [
        {
          kind: 'voice_memo' as const,
          filename: 'memo.mp3',
          transcript: null,
          transport: {
            attachmentId: 'attachment_voice_1',
            kind: 'linq_attachment' as const,
          },
        },
      ]

      const created = await createAssistantOutboxIntent({
        channel: 'linq',
        media,
        message: '   ',
        sessionId: 'session_voice_memo',
        turnId: 'turn_voice_memo',
        vault,
      })

      expect(created.message).toBe('')
      expect(created.media).toEqual(media)
      expect(created.deliveryTransportIdempotent).toBe(false)

      await expect(
        createAssistantOutboxIntent({
          channel: 'linq',
          message: '   ',
          sessionId: 'session_empty_text',
          turnId: 'turn_empty_text',
          vault,
        }),
      ).rejects.toThrow('Assistant outbox messages must include text or response media.')
    })
  })

  it('schedules retryable failures from the failure time and keeps diagnostics aligned', async () => {
    await withTempVault(async (vault) => {
      const sending = await createSendingIntent({
        attemptCount: 1,
        channel: 'telegram',
        vault,
      })
      const paths = resolveAssistantStatePaths(vault)
      const failedAt = new Date('2030-04-13T00:00:45.000Z')

      const failed = await updateAssistantOutboxAfterDispatchFailure({
        deliveryMayHaveSucceeded: false,
        deliveryTransportIdempotent: false,
        error: Object.assign(new Error('network timeout'), {
          retryable: true,
        }),
        failedAt,
        intentPath: resolveAssistantOutboxIntentPath(paths.outboxDirectory, sending.intentId),
        sending,
        vault,
      })

      expect(failed.status).toBe('retryable')
      expect(failed.updatedAt).toBe('2030-04-13T00:00:45.000Z')
      expect(failed.nextAttemptAt).toBe('2030-04-13T00:01:15.000Z')

      const persisted = await readAssistantOutboxIntent(vault, sending.intentId)
      expect(persisted?.updatedAt).toBe(failed.updatedAt)
      expect(persisted?.nextAttemptAt).toBe(failed.nextAttemptAt)

      const diagnostics = await readAssistantDiagnosticsSnapshot(vault)
      expect(diagnostics.updatedAt).toBe(failed.updatedAt)
      expect(diagnostics.lastEventAt).toBe(failed.updatedAt)
    })
  })

  it('abandons ambiguous Telegram voice memo sends without provider ids', async () => {
    await withTempVault(async (vault) => {
      const sending = await createSendingIntent({
        attemptCount: 1,
        vault,
      })
      const paths = resolveAssistantStatePaths(vault)
      const failedAt = new Date('2030-04-13T00:01:00.000Z')

      const failed = await updateAssistantOutboxAfterDispatchFailure({
        deliveryMayHaveSucceeded: true,
        deliveryTransportIdempotent: false,
        error: Object.assign(new Error('sendVoice result could not be confirmed'), {
          code: 'ASSISTANT_TELEGRAM_VOICE_MEMO_DELIVERY_AMBIGUOUS',
          deliveryMayHaveSucceeded: true,
          providerMessageIds: [],
        }),
        failedAt,
        intentPath: resolveAssistantOutboxIntentPath(paths.outboxDirectory, sending.intentId),
        sending,
        vault,
      })

      expect(failed.status).toBe('abandoned')
      expect(failed.deliveryConfirmationPending).toBe(false)
      expect(failed.deliveryTransportIdempotent).toBe(false)
      expect(failed.nextAttemptAt).toBeNull()
      expect(failed.lastError?.code).toBe('ASSISTANT_DELIVERY_AMBIGUOUS')

      const diagnostics = await readAssistantDiagnosticsSnapshot(vault)
      expect(diagnostics.counters.deliveriesFailed).toBe(1)
      expect(diagnostics.counters.deliveriesRetryable).toBe(0)
      expect(diagnostics.counters.outboxRetries).toBe(0)
    })
  })

  it('abandons a superseded email group recipient without claiming provider ambiguity', async () => {
    await withTempVault(async (vault) => {
      const sending = await createSendingIntent({
        attemptCount: 1,
        channel: 'email',
        vault,
      })
      const paths = resolveAssistantStatePaths(vault)

      const abandoned = await updateAssistantOutboxAfterDispatchFailure({
        deliveryMayHaveSucceeded: false,
        deliveryTransportIdempotent: false,
        error: Object.assign(new Error('recipient authority changed before delivery began'), {
          code: 'ASSISTANT_EMAIL_GROUP_RECIPIENT_AUTHORITY_SUPERSEDED',
          deliveryMayHaveSucceeded: false,
          retryable: false,
        }),
        failedAt: new Date('2030-04-13T00:02:00.000Z'),
        intentPath: resolveAssistantOutboxIntentPath(paths.outboxDirectory, sending.intentId),
        sending,
        vault,
      })

      expect(abandoned.status).toBe('abandoned')
      expect(abandoned.deliveryConfirmationPending).toBe(false)
      expect(abandoned.deliveryTransportIdempotent).toBe(false)
      expect(abandoned.nextAttemptAt).toBeNull()
      expect(abandoned.lastError?.code).toBe(
        'ASSISTANT_EMAIL_GROUP_RECIPIENT_AUTHORITY_SUPERSEDED',
      )
    })
  })

  it('reschedules confirmation retries from the reconciliation time', async () => {
    await withTempVault(async (vault) => {
      const sending = await createSendingIntent({
        attemptCount: 2,
        deliveryTransportIdempotent: true,
        vault,
      })
      const paths = resolveAssistantStatePaths(vault)
      const scheduledAt = new Date('2030-04-13T00:05:00.000Z')

      const retryIntent = await rescheduleAssistantOutboxConfirmationRetry({
        error: assistantDeliveryErrorSchema.parse({
          code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
          message: 'delivery must be reconciled before resend',
        }),
        intentPath: resolveAssistantOutboxIntentPath(paths.outboxDirectory, sending.intentId),
        scheduledAt,
        sending,
        vault,
      })

      expect(retryIntent.deliveryConfirmationPending).toBe(true)
      expect(retryIntent.updatedAt).toBe('2030-04-13T00:05:00.000Z')
      expect(retryIntent.nextAttemptAt).toBe('2030-04-13T00:07:00.000Z')
    })
  })

  it('deduplicates repeated hosted mirror sending observations for the same attempt', async () => {
    await withTempVault(async (vault) => {
      await createAssistantTurnReceipt({
        deliveryRequested: true,
        prompt: 'hello from the outbox seam',
        provider: 'codex-cli',
        providerModel: 'gpt-5.4',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_mirror',
        vault,
      })
      const created = await createAssistantOutboxIntent({
        channel: 'telegram',
        deliveryIdempotencyKey: 'assistant-outbox:intent_mirror',
        message: 'hello from the outbox seam',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_mirror',
        vault,
      })
      const startedAt = '2030-04-13T00:10:00.000Z'

      const first = await beginAssistantOutboxIntentMirrorDispatch({
        deliveryIdempotencyKey: 'assistant-outbox:intent_mirror',
        deliveryTransportIdempotent: false,
        intentId: created.intentId,
        startedAt,
        vault,
      })
      const second = await beginAssistantOutboxIntentMirrorDispatch({
        deliveryIdempotencyKey: 'assistant-outbox:intent_mirror',
        deliveryTransportIdempotent: false,
        intentId: created.intentId,
        startedAt,
        vault,
      })

      expect(first?.attemptCount).toBe(1)
      expect(second).toEqual(first)
      const persisted = await readAssistantOutboxIntent(vault, created.intentId)
      expect(persisted?.attemptCount).toBe(1)

      const receipt = await readAssistantTurnReceipt(vault, created.turnId)
      expect(
        receipt?.timeline.filter((event) => event.kind === 'delivery.attempt.started'),
      ).toHaveLength(1)
    })
  })

  it('does not overwrite a different in-flight prepared sending attempt', async () => {
    await withTempVault(async (vault) => {
      await createAssistantTurnReceipt({
        deliveryRequested: true,
        prompt: 'hello from the outbox seam',
        provider: 'codex-cli',
        providerModel: 'gpt-5.4',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_mirror_takeover',
        vault,
      })
      const created = await createAssistantOutboxIntent({
        channel: 'telegram',
        deliveryIdempotencyKey: 'assistant-outbox:intent_mirror_takeover',
        message: 'hello from the outbox seam',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_mirror_takeover',
        vault,
      })
      const firstStartedAt = '2030-04-13T00:10:00.000Z'
      const secondStartedAt = '2030-04-13T00:11:00.000Z'

      const first = await beginAssistantOutboxIntentMirrorPreparedDispatch({
        deliveryIdempotencyKey: 'assistant-outbox:intent_mirror_takeover',
        deliveryTransportIdempotent: false,
        intentId: created.intentId,
        startedAt: firstStartedAt,
        vault,
      })
      const second = await beginAssistantOutboxIntentMirrorPreparedDispatch({
        deliveryIdempotencyKey: 'assistant-outbox:intent_mirror_takeover',
        deliveryTransportIdempotent: false,
        intentId: created.intentId,
        startedAt: secondStartedAt,
        vault,
      })

      expect(first?.intent.lastAttemptAt).toBe(firstStartedAt)
      expect(second?.intent.lastAttemptAt).toBe(firstStartedAt)
      expect(second?.ownsDispatch).toBe(false)
      const persisted = await readAssistantOutboxIntent(vault, created.intentId)
      expect(persisted?.lastAttemptAt).toBe(firstStartedAt)
      expect(persisted?.attemptCount).toBe(1)
    })
  })

  it('does not grant prepared ownership to a same-millisecond competing batch', async () => {
    await withTempVault(async (vault) => {
      await createAssistantTurnReceipt({
        deliveryRequested: true,
        prompt: 'hello from the outbox seam',
        provider: 'codex-cli',
        providerModel: 'gpt-5.4',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_mirror_same_ms',
        vault,
      })
      const created = await createAssistantOutboxIntent({
        channel: 'telegram',
        deliveryIdempotencyKey: 'assistant-outbox:intent_mirror_same_ms',
        message: 'hello from the outbox seam',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_mirror_same_ms',
        vault,
      })
      const preparedAt = '2030-04-13T00:10:00.000Z'

      const first = await beginAssistantOutboxIntentMirrorPreparedDispatch({
        deliveryIdempotencyKey: 'assistant-outbox:intent_mirror_same_ms',
        deliveryTransportIdempotent: false,
        intentId: created.intentId,
        startedAt: preparedAt,
        vault,
      })
      const second = await beginAssistantOutboxIntentMirrorPreparedDispatch({
        deliveryIdempotencyKey: 'assistant-outbox:intent_mirror_same_ms',
        deliveryTransportIdempotent: false,
        intentId: created.intentId,
        startedAt: preparedAt,
        vault,
      })

      expect(first?.ownsDispatch).toBe(true)
      expect(first?.preparedDispatchToken).toEqual(expect.any(String))
      expect(second?.ownsDispatch).toBe(false)
      expect(second?.preparedDispatchToken).toBe(null)
      const persisted = await readAssistantOutboxIntent(vault, created.intentId)
      expect(persisted?.preparedDispatchToken).toBe(first?.preparedDispatchToken)
      expect(persisted?.attemptCount).toBe(1)
    })
  })

  it('does not prepare-claim an already terminal intent', async () => {
    await withTempVault(async (vault) => {
      await createAssistantTurnReceipt({
        deliveryRequested: true,
        prompt: 'hello from the outbox seam',
        provider: 'codex-cli',
        providerModel: 'gpt-5.4',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_terminal_claim',
        vault,
      })
      const created = await createAssistantOutboxIntent({
        channel: 'telegram',
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_terminal_claim',
        message: 'hello from the outbox seam',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_terminal_claim',
        vault,
      })
      const sent = await saveAssistantOutboxIntent(vault, {
        ...created,
        delivery: {
          channel: 'telegram',
          idempotencyKey: created.deliveryIdempotencyKey,
          messageLength: created.message.length,
          providerMessageId: 'provider-terminal-claim',
          providerThreadId: null,
          sentAt: '2030-04-13T00:09:00.000Z',
          target: 'chat-terminal-claim',
          targetKind: 'thread',
        },
        sentAt: '2030-04-13T00:09:00.000Z',
        status: 'sent',
        updatedAt: '2030-04-13T00:09:00.000Z',
      })

      const prepared = await beginAssistantOutboxIntentMirrorPreparedDispatch({
        deliveryIdempotencyKey: sent.deliveryIdempotencyKey,
        deliveryTransportIdempotent: sent.deliveryTransportIdempotent,
        intentId: sent.intentId,
        startedAt: '2030-04-13T00:10:00.000Z',
        vault,
      })

      expect(prepared?.ownsDispatch).toBe(false)
      expect(prepared?.intent.status).toBe('sent')
      expect(expectMessageDelivery(prepared?.intent.delivery).providerMessageId).toBe(
        'provider-terminal-claim',
      )
      const persisted = await readAssistantOutboxIntent(vault, sent.intentId)
      expect(persisted?.status).toBe('sent')
      expect(persisted?.preparedDispatchToken).toBe(null)
      expect(expectMessageDelivery(persisted?.delivery).providerMessageId).toBe(
        'provider-terminal-claim',
      )
    })
  })

  it('does not prepare-claim retryable intents with pending delivery confirmation evidence', async () => {
    await withTempVault(async (vault) => {
      await createAssistantTurnReceipt({
        deliveryRequested: true,
        prompt: 'hello from the outbox seam',
        provider: 'codex-cli',
        providerModel: 'gpt-5.4',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_confirmation_claim',
        vault,
      })
      const created = await createAssistantOutboxIntent({
        channel: 'telegram',
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_confirmation_claim',
        message: 'hello from the outbox seam',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_confirmation_claim',
        vault,
      })
      const retryable = await saveAssistantOutboxIntent(vault, {
        ...created,
        attemptCount: 2,
        delivery: {
          channel: 'telegram',
          idempotencyKey: created.deliveryIdempotencyKey,
          messageLength: created.message.length,
          providerMessageId: 'provider-confirmation-claim',
          providerThreadId: null,
          sentAt: '2030-04-13T00:08:00.000Z',
          target: 'chat-confirmation-claim',
          targetKind: 'thread',
        },
        deliveryConfirmationPending: true,
        deliveryTransportIdempotent: true,
        lastAttemptAt: '2030-04-13T00:08:00.000Z',
        lastError: assistantDeliveryErrorSchema.parse({
          code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
          message: 'provider confirmation pending',
        }),
        nextAttemptAt: '2030-04-13T00:10:00.000Z',
        status: 'retryable',
        updatedAt: '2030-04-13T00:08:00.000Z',
      })

      const prepared = await beginAssistantOutboxIntentMirrorPreparedDispatch({
        deliveryIdempotencyKey: retryable.deliveryIdempotencyKey,
        deliveryTransportIdempotent: retryable.deliveryTransportIdempotent,
        intentId: retryable.intentId,
        startedAt: '2030-04-13T00:10:00.000Z',
        vault,
      })

      expect(prepared?.ownsDispatch).toBe(false)
      expect(prepared?.intent.status).toBe('retryable')
      expect(prepared?.intent.deliveryConfirmationPending).toBe(true)
      expect(expectMessageDelivery(prepared?.intent.delivery).providerMessageId).toBe(
        'provider-confirmation-claim',
      )
      const persisted = await readAssistantOutboxIntent(vault, retryable.intentId)
      expect(persisted?.status).toBe('retryable')
      expect(persisted?.deliveryConfirmationPending).toBe(true)
      expect(persisted?.preparedDispatchToken).toBe(null)
      expect(expectMessageDelivery(persisted?.delivery).providerMessageId).toBe(
        'provider-confirmation-claim',
      )
    })
  })

  it('does not prepare-claim retryable intents before their retry time', async () => {
    await withTempVault(async (vault) => {
      await createAssistantTurnReceipt({
        deliveryRequested: true,
        prompt: 'hello from the outbox seam',
        provider: 'codex-cli',
        providerModel: 'gpt-5.4',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_future_retry_claim',
        vault,
      })
      const created = await createAssistantOutboxIntent({
        channel: 'telegram',
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_future_retry_claim',
        message: 'hello from the outbox seam',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_future_retry_claim',
        vault,
      })
      const retryable = await saveAssistantOutboxIntent(vault, {
        ...created,
        attemptCount: 1,
        lastAttemptAt: '2030-04-13T00:05:00.000Z',
        lastError: assistantDeliveryErrorSchema.parse({
          code: 'TELEGRAM_TEMPORARY_FAILURE',
          message: 'temporary provider failure',
        }),
        nextAttemptAt: '2030-04-13T00:15:00.000Z',
        status: 'retryable',
        updatedAt: '2030-04-13T00:05:00.000Z',
      })

      const prepared = await beginAssistantOutboxIntentMirrorPreparedDispatch({
        deliveryIdempotencyKey: retryable.deliveryIdempotencyKey,
        deliveryTransportIdempotent: retryable.deliveryTransportIdempotent,
        intentId: retryable.intentId,
        startedAt: '2030-04-13T00:10:00.000Z',
        vault,
      })

      expect(prepared?.ownsDispatch).toBe(false)
      expect(prepared?.intent.status).toBe('retryable')
      const persisted = await readAssistantOutboxIntent(vault, retryable.intentId)
      expect(persisted?.status).toBe('retryable')
      expect(persisted?.nextAttemptAt).toBe('2030-04-13T00:15:00.000Z')
      expect(persisted?.preparedDispatchToken).toBe(null)
    })
  })

  it('ignores stale sent completions without the current prepared dispatch token', async () => {
    await withTempVault(async (vault) => {
      await createAssistantTurnReceipt({
        deliveryRequested: true,
        prompt: 'hello from the outbox seam',
        provider: 'codex-cli',
        providerModel: 'gpt-5.4',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_stale_sent',
        vault,
      })
      const created = await createAssistantOutboxIntent({
        channel: 'telegram',
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_stale_sent',
        message: 'hello from the outbox seam',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_stale_sent',
        vault,
      })
      const prepared = await beginAssistantOutboxIntentMirrorPreparedDispatch({
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_stale_sent',
        deliveryTransportIdempotent: false,
        intentId: created.intentId,
        startedAt: '2030-04-13T00:10:00.000Z',
        vault,
      })
      const paths = resolveAssistantStatePaths(vault)
      const staleIntent = {
        ...prepared!.intent,
        preparedDispatchToken: null,
      }

      const result = await markAssistantOutboxIntentSent({
        delivery: {
          channel: 'telegram',
          idempotencyKey: 'assistant-outbox:intent_prepared_stale_sent',
          messageLength: staleIntent.message.length,
          providerMessageId: 'provider-stale-sent',
          providerThreadId: null,
          sentAt: '2030-04-13T00:10:05.000Z',
          target: 'chat-stale-sent',
          targetKind: 'thread',
        },
        intent: staleIntent,
        intentPath: resolveAssistantOutboxIntentPath(paths.outboxDirectory, created.intentId),
        vault,
      })

      expect(result.status).toBe('sending')
      expect(result.preparedDispatchToken).toBe(prepared!.preparedDispatchToken)
      expect(result.delivery).toBe(null)
      const persisted = await readAssistantOutboxIntent(vault, created.intentId)
      expect(persisted?.status).toBe('sending')
      expect(persisted?.preparedDispatchToken).toBe(prepared!.preparedDispatchToken)
      expect(persisted?.delivery).toBe(null)
    })
  })

  it('ignores stale dispatch failures without the current prepared dispatch token', async () => {
    await withTempVault(async (vault) => {
      await createAssistantTurnReceipt({
        deliveryRequested: true,
        prompt: 'hello from the outbox seam',
        provider: 'codex-cli',
        providerModel: 'gpt-5.4',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_stale_failure',
        vault,
      })
      const created = await createAssistantOutboxIntent({
        channel: 'telegram',
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_stale_failure',
        message: 'hello from the outbox seam',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_stale_failure',
        vault,
      })
      const prepared = await beginAssistantOutboxIntentMirrorPreparedDispatch({
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_stale_failure',
        deliveryTransportIdempotent: false,
        intentId: created.intentId,
        startedAt: '2030-04-13T00:10:00.000Z',
        vault,
      })
      const paths = resolveAssistantStatePaths(vault)
      const staleIntent = {
        ...prepared!.intent,
        preparedDispatchToken: null,
      }

      const result = await updateAssistantOutboxAfterDispatchFailure({
        deliveryMayHaveSucceeded: false,
        deliveryTransportIdempotent: false,
        error: Object.assign(new Error('stale failure'), {
          retryable: true,
        }),
        failedAt: new Date('2030-04-13T00:10:05.000Z'),
        intentPath: resolveAssistantOutboxIntentPath(paths.outboxDirectory, created.intentId),
        sending: staleIntent,
        vault,
      })

      expect(result.status).toBe('sending')
      expect(result.preparedDispatchToken).toBe(prepared!.preparedDispatchToken)
      expect(result.lastError).toBe(null)
      const persisted = await readAssistantOutboxIntent(vault, created.intentId)
      expect(persisted?.status).toBe('sending')
      expect(persisted?.preparedDispatchToken).toBe(prepared!.preparedDispatchToken)
      expect(persisted?.lastError).toBe(null)
    })
  })

  it('ignores stale mirror failures without the current prepared dispatch token', async () => {
    await withTempVault(async (vault) => {
      await createAssistantTurnReceipt({
        deliveryRequested: true,
        prompt: 'hello from the outbox seam',
        provider: 'codex-cli',
        providerModel: 'gpt-5.4',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_stale_mirror_failure',
        vault,
      })
      const created = await createAssistantOutboxIntent({
        channel: 'telegram',
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_stale_mirror_failure',
        message: 'hello from the outbox seam',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_stale_mirror_failure',
        vault,
      })
      const prepared = await beginAssistantOutboxIntentMirrorPreparedDispatch({
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_stale_mirror_failure',
        deliveryTransportIdempotent: false,
        intentId: created.intentId,
        startedAt: '2030-04-13T00:10:00.000Z',
        vault,
      })
      const paths = resolveAssistantStatePaths(vault)
      const staleIntent = {
        ...prepared!.intent,
        preparedDispatchToken: null,
      }

      const result = await markAssistantOutboxIntentMirrorRetryable({
        error: Object.assign(new Error('stale mirror failure'), {
          retryable: true,
        }),
        failedAt: new Date('2030-04-13T00:10:05.000Z'),
        intent: staleIntent,
        intentPath: resolveAssistantOutboxIntentPath(paths.outboxDirectory, created.intentId),
        vault,
      })

      expect(result.status).toBe('sending')
      expect(result.preparedDispatchToken).toBe(prepared!.preparedDispatchToken)
      expect(result.lastError).toBe(null)
      const persisted = await readAssistantOutboxIntent(vault, created.intentId)
      expect(persisted?.status).toBe('sending')
      expect(persisted?.preparedDispatchToken).toBe(prepared!.preparedDispatchToken)
      expect(persisted?.lastError).toBe(null)
    })
  })

  it('resets prepared sending dispatches back to immediate pending when no delivery exists', async () => {
    await withTempVault(async (vault) => {
      await createAssistantTurnReceipt({
        deliveryRequested: true,
        prompt: 'hello from the outbox seam',
        provider: 'codex-cli',
        providerModel: 'gpt-5.4',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_reset',
        vault,
      })
      const created = await createAssistantOutboxIntent({
        channel: 'telegram',
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_reset',
        message: 'hello from the outbox seam',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_reset',
        vault,
      })
      const preparedAt = '2030-04-13T00:10:00.000Z'
      const prepared = await beginAssistantOutboxIntentMirrorPreparedDispatch({
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_reset',
        deliveryTransportIdempotent: false,
        intentId: created.intentId,
        startedAt: preparedAt,
        vault,
      })
      expect(prepared?.intent.status).toBe('sending')

      const paths = resolveAssistantStatePaths(vault)
      const intentPath = resolveAssistantOutboxIntentPath(paths.outboxDirectory, created.intentId)
      const resetAt = new Date('2030-04-13T00:10:03.000Z')
      const reset = await resetAssistantOutboxPreparedDispatch({
        deliveryTransportIdempotent: false,
        intent: prepared!.intent,
        intentPath,
        preparedDispatchToken: prepared!.preparedDispatchToken,
        resetAt,
        vault,
      })

      expect(reset?.status).toBe('pending')
      expect(reset?.delivery).toBe(null)
      expect(reset?.deliveryConfirmationPending).toBe(false)
      expect(reset?.lastError).toBe(null)
      expect(reset?.nextAttemptAt).toBe(resetAt.toISOString())

      const persisted = await readAssistantOutboxIntent(vault, created.intentId)
      expect(persisted?.status).toBe('pending')
      expect(persisted?.nextAttemptAt).toBe(resetAt.toISOString())
    })
  })

  it('restores pre-prepare dispatch metadata for prepared retries that never dispatched', async () => {
    await withTempVault(async (vault) => {
      await createAssistantTurnReceipt({
        deliveryRequested: true,
        prompt: 'hello from the outbox seam',
        provider: 'codex-cli',
        providerModel: 'gpt-5.4',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_retry_restore',
        vault,
      })
      const created = await createAssistantOutboxIntent({
        channel: 'telegram',
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_retry_restore',
        message: 'hello from the outbox seam',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_retry_restore',
        vault,
      })
      const retryable = await saveAssistantOutboxIntent(vault, {
        ...created,
        attemptCount: 3,
        lastAttemptAt: '2030-04-13T00:05:00.000Z',
        lastError: assistantDeliveryErrorSchema.parse({
          code: 'TELEGRAM_TEMPORARY_FAILURE',
          message: 'temporary provider failure',
        }),
        nextAttemptAt: '2030-04-13T00:10:00.000Z',
        status: 'retryable',
        updatedAt: '2030-04-13T00:05:00.000Z',
      })
      const preparedAt = '2030-04-13T00:10:00.000Z'
      const prepared = await beginAssistantOutboxIntentMirrorPreparedDispatch({
        deliveryIdempotencyKey: retryable.deliveryIdempotencyKey,
        deliveryTransportIdempotent: retryable.deliveryTransportIdempotent,
        intentId: retryable.intentId,
        startedAt: preparedAt,
        vault,
      })
      expect(prepared?.intent.attemptCount).toBe(4)

      const paths = resolveAssistantStatePaths(vault)
      const intentPath = resolveAssistantOutboxIntentPath(paths.outboxDirectory, created.intentId)
      const reset = await resetAssistantOutboxPreparedDispatch({
        deliveryTransportIdempotent: retryable.deliveryTransportIdempotent,
        intent: prepared!.intent,
        intentPath,
        preparedDispatchToken: prepared!.preparedDispatchToken,
        resetAt: new Date('2030-04-13T00:10:03.000Z'),
        restoreDispatchState: prepared!.previousDispatchState,
        vault,
      })

      expect(reset?.status).toBe('retryable')
      expect(reset?.attemptCount).toBe(3)
      expect(reset?.lastAttemptAt).toBe('2030-04-13T00:05:00.000Z')
      expect(reset?.nextAttemptAt).toBe('2030-04-13T00:10:00.000Z')
      expect(reset?.lastError?.code).toBe('TELEGRAM_TEMPORARY_FAILURE')

      const persisted = await readAssistantOutboxIntent(vault, created.intentId)
      expect(persisted?.status).toBe('retryable')
      expect(persisted?.attemptCount).toBe(3)
      expect(persisted?.lastAttemptAt).toBe('2030-04-13T00:05:00.000Z')
      expect(persisted?.nextAttemptAt).toBe('2030-04-13T00:10:00.000Z')
      expect(persisted?.lastError?.code).toBe('TELEGRAM_TEMPORARY_FAILURE')
    })
  })

  it('preserves the durable current delivery identity while restoring prepared metadata', async () => {
    await withTempVault(async (vault) => {
      await createAssistantTurnReceipt({
        deliveryRequested: true,
        prompt: 'hello from the outbox seam',
        provider: 'codex-cli',
        providerModel: 'gpt-5.4',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_identity_transition',
        vault,
      })
      const created = await createAssistantOutboxIntent({
        card: OUTBOX_RESPONSE_CARD,
        channel: 'linq',
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_identity_transition',
        message: 'hello from the outbox seam',
        sessionId: 'asst_outbox_test',
        threadId: 'thread_prepared_identity_transition',
        threadIsDirect: true,
        turnId: 'turn_outbox_prepared_identity_transition',
        vault,
      })
      const prepared = await beginAssistantOutboxIntentMirrorPreparedDispatch({
        deliveryIdempotencyKey: created.deliveryIdempotencyKey,
        deliveryTransportIdempotent: created.deliveryTransportIdempotent,
        intentId: created.intentId,
        startedAt: '2030-04-13T00:10:00.000Z',
        vault,
      })
      const paths = resolveAssistantStatePaths(vault)
      const intentPath = resolveAssistantOutboxIntentPath(
        paths.outboxDirectory,
        created.intentId,
      )
      await persistAssistantOutboxIntentLinqAppCardTextFallback({
        idempotencyKey: `${created.deliveryIdempotencyKey}:fallback`,
        intentPath,
        persistedAt: new Date('2030-04-13T00:10:01.000Z'),
        sending: prepared!.intent,
        vault,
      })

      const reset = await resetAssistantOutboxPreparedDispatch({
        deliveryTransportIdempotent: created.deliveryTransportIdempotent,
        intent: prepared!.intent,
        intentPath,
        preparedDispatchToken: prepared!.preparedDispatchToken,
        resetAt: new Date('2030-04-13T00:10:03.000Z'),
        restoreDispatchState: prepared!.previousDispatchState,
        vault,
      })

      expect(reset?.status).toBe('pending')
      expect(reset?.attemptCount).toBe(0)
      expect(reset?.card).toBeNull()
      expect(reset?.deliveryIdempotencyKey)
        .toBe(`${created.deliveryIdempotencyKey}:fallback`)
    })
  })

  it('clamps restored prepared successor scheduling behind a retryable predecessor', async () => {
    await withTempVault(async (vault) => {
      await createAssistantTurnReceipt({
        deliveryRequested: true,
        prompt: 'hello from the outbox seam',
        provider: 'codex-cli',
        providerModel: 'gpt-5.4',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_successor_clamp',
        vault,
      })
      const created = await createAssistantOutboxIntent({
        channel: 'telegram',
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_successor_clamp',
        message: 'hello from the outbox seam',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_successor_clamp',
        vault,
      })
      const preparedAt = '2030-04-13T00:10:00.000Z'
      const prepared = await beginAssistantOutboxIntentMirrorPreparedDispatch({
        deliveryIdempotencyKey: created.deliveryIdempotencyKey,
        deliveryTransportIdempotent: created.deliveryTransportIdempotent,
        intentId: created.intentId,
        startedAt: preparedAt,
        vault,
      })
      const successorRetryAt = new Date('2030-04-13T00:15:00.000Z')

      const paths = resolveAssistantStatePaths(vault)
      const intentPath = resolveAssistantOutboxIntentPath(paths.outboxDirectory, created.intentId)
      const reset = await resetAssistantOutboxPreparedDispatch({
        deliveryTransportIdempotent: created.deliveryTransportIdempotent,
        intent: prepared!.intent,
        intentPath,
        minimumNextAttemptAt: successorRetryAt,
        preparedDispatchToken: prepared!.preparedDispatchToken,
        resetAt: successorRetryAt,
        restoreDispatchState: prepared!.previousDispatchState,
        vault,
      })

      expect(reset?.status).toBe('pending')
      expect(reset?.attemptCount).toBe(0)
      expect(reset?.lastAttemptAt).toBeNull()
      expect(reset?.lastError).toBeNull()
      expect(reset?.nextAttemptAt).toBe(successorRetryAt.toISOString())
    })
  })

  it('does not reset prepared sending dispatches when the prepared attempt no longer matches', async () => {
    await withTempVault(async (vault) => {
      await createAssistantTurnReceipt({
        deliveryRequested: true,
        prompt: 'hello from the outbox seam',
        provider: 'codex-cli',
        providerModel: 'gpt-5.4',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_mismatch',
        vault,
      })
      const created = await createAssistantOutboxIntent({
        channel: 'telegram',
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_mismatch',
        message: 'hello from the outbox seam',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_mismatch',
        vault,
      })
      const sending = await beginAssistantOutboxIntentMirrorDispatch({
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_mismatch',
        deliveryTransportIdempotent: false,
        intentId: created.intentId,
        startedAt: '2030-04-13T00:10:00.000Z',
        vault,
      })

      const paths = resolveAssistantStatePaths(vault)
      const intentPath = resolveAssistantOutboxIntentPath(paths.outboxDirectory, created.intentId)
      const reset = await resetAssistantOutboxPreparedDispatch({
        deliveryTransportIdempotent: false,
        intent: sending!,
        intentPath,
        resetAt: new Date('2030-04-13T00:10:03.000Z'),
        vault,
      })

      expect(reset).toBe(null)
      const persisted = await readAssistantOutboxIntent(vault, created.intentId)
      expect(persisted?.status).toBe('sending')
      expect(persisted?.lastAttemptAt).toBe('2030-04-13T00:10:00.000Z')
    })
  })

  it('resets matching prepared dispatch failure aftermath back to immediate pending', async () => {
    await withTempVault(async (vault) => {
      await createAssistantTurnReceipt({
        deliveryRequested: true,
        prompt: 'hello from the outbox seam',
        provider: 'codex-cli',
        providerModel: 'gpt-5.4',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_failed_reset',
        vault,
      })
      const created = await createAssistantOutboxIntent({
        channel: 'telegram',
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_failed_reset',
        message: 'hello from the outbox seam',
        sessionId: 'asst_outbox_test',
        turnId: 'turn_outbox_prepared_failed_reset',
        vault,
      })
      const preparedAt = '2030-04-13T00:10:00.000Z'
      const prepared = await beginAssistantOutboxIntentMirrorPreparedDispatch({
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_failed_reset',
        deliveryTransportIdempotent: false,
        intentId: created.intentId,
        startedAt: preparedAt,
        vault,
      })
      const failed = await saveAssistantOutboxIntent(vault, {
        ...prepared!.intent,
        lastError: assistantDeliveryErrorSchema.parse({
          code: 'ASSISTANT_DELIVERY_ABORTED',
          message: 'lease expired before provider dispatch',
        }),
        nextAttemptAt: null,
        status: 'failed',
        updatedAt: '2030-04-13T00:10:01.000Z',
      })

      const paths = resolveAssistantStatePaths(vault)
      const intentPath = resolveAssistantOutboxIntentPath(paths.outboxDirectory, created.intentId)
      const resetAt = new Date('2030-04-13T00:10:03.000Z')
      const reset = await resetAssistantOutboxPreparedDispatch({
        deliveryTransportIdempotent: false,
        intent: failed,
        intentPath,
        preparedDispatchToken: prepared!.preparedDispatchToken,
        resetAt,
        vault,
      })

      expect(reset?.status).toBe('pending')
      expect(reset?.lastError).toBe(null)
      expect(reset?.nextAttemptAt).toBe(resetAt.toISOString())
    })
  })

  it('records hosted mirror retryable failures with the next retry timestamp', async () => {
    await withTempVault(async (vault) => {
      const sending = await createSendingIntent({
        attemptCount: 1,
        vault,
      })
      const paths = resolveAssistantStatePaths(vault)
      const failedAt = new Date('2030-04-13T00:12:00.000Z')

      const retryable = await markAssistantOutboxIntentMirrorRetryable({
        error: Object.assign(new Error('hosted mirror journal GET failed'), {
          code: 'HOSTED_ASSISTANT_OUTBOX_JOURNAL_FAILED',
          retryable: true,
        }),
        failedAt,
        intent: sending,
        intentPath: resolveAssistantOutboxIntentPath(paths.outboxDirectory, sending.intentId),
        vault,
      })

      expect(retryable.status).toBe('retryable')
      expect(retryable.deliveryConfirmationPending).toBe(false)
      expect(retryable.updatedAt).toBe('2030-04-13T00:12:00.000Z')
      expect(retryable.nextAttemptAt).toBe('2030-04-13T00:12:30.000Z')
      expect(retryable.lastError?.code).toBe('HOSTED_ASSISTANT_OUTBOX_JOURNAL_FAILED')

      const receipt = await readAssistantTurnReceipt(vault, sending.turnId)
      expect(receipt?.status).toBe('deferred')
      expect(receipt?.deliveryDisposition).toBe('retryable')
      expect(receipt?.lastError?.code).toBe('HOSTED_ASSISTANT_OUTBOX_JOURNAL_FAILED')
      expect(receipt?.timeline.at(-1)).toMatchObject({
        kind: 'delivery.retry-scheduled',
        detail: 'hosted mirror journal GET failed',
      })

      const diagnostics = await readAssistantDiagnosticsSnapshot(vault)
      expect(diagnostics.counters.deliveriesRetryable).toBe(1)
      expect(diagnostics.counters.outboxRetries).toBe(1)
      expect(diagnostics.counters.deliveriesFailed).toBe(0)
    })
  })

  it('records retry timeline entries for each distinct retryable transition', async () => {
    await withTempVault(async (vault) => {
      const sending = await createSendingIntent({
        attemptCount: 1,
        vault,
      })
      const paths = resolveAssistantStatePaths(vault)
      const intentPath = resolveAssistantOutboxIntentPath(
        paths.outboxDirectory,
        sending.intentId,
      )
      const firstRetry = await markAssistantOutboxIntentMirrorRetryable({
        error: Object.assign(new Error('first hosted mirror retry'), {
          code: 'HOSTED_ASSISTANT_OUTBOX_JOURNAL_FAILED',
          retryable: true,
        }),
        failedAt: new Date('2030-04-13T00:12:00.000Z'),
        intent: sending,
        intentPath,
        vault,
      })
      const secondSending = await beginAssistantOutboxIntentMirrorDispatch({
        deliveryIdempotencyKey: 'assistant-outbox:retry-timeline',
        deliveryTransportIdempotent: false,
        intentId: firstRetry.intentId,
        startedAt: '2030-04-13T00:13:00.000Z',
        vault,
      })
      if (!secondSending) {
        throw new Error('Expected second sending intent.')
      }

      await markAssistantOutboxIntentMirrorRetryable({
        error: Object.assign(new Error('second hosted mirror retry'), {
          code: 'HOSTED_ASSISTANT_OUTBOX_JOURNAL_FAILED',
          retryable: true,
        }),
        failedAt: new Date('2030-04-13T00:14:00.000Z'),
        intent: secondSending,
        intentPath,
        vault,
      })

      const receipt = await readAssistantTurnReceipt(vault, sending.turnId)
      const retryEvents =
        receipt?.timeline.filter((event) => event.kind === 'delivery.retry-scheduled') ??
        []
      expect(retryEvents).toHaveLength(2)
      expect(retryEvents.map((event) => event.at)).toEqual([
        '2030-04-13T00:12:00.000Z',
        '2030-04-13T00:14:00.000Z',
      ])
    })
  })

  it('records hosted mirror terminal failures without scheduling another retry', async () => {
    await withTempVault(async (vault) => {
      const sending = await createSendingIntent({
        attemptCount: 2,
        vault,
      })
      const paths = resolveAssistantStatePaths(vault)
      const failedAt = new Date('2030-04-13T00:20:00.000Z')

      const failed = await markAssistantOutboxIntentMirrorTerminal({
        error: Object.assign(new Error('hosted mirror reconciliation refused the delivery'), {
          code: 'HOSTED_ASSISTANT_OUTBOX_JOURNAL_FAILED',
        }),
        failedAt,
        intent: sending,
        intentPath: resolveAssistantOutboxIntentPath(paths.outboxDirectory, sending.intentId),
        status: 'abandoned',
        vault,
      })

      expect(failed.status).toBe('abandoned')
      expect(failed.deliveryConfirmationPending).toBe(false)
      expect(failed.updatedAt).toBe('2030-04-13T00:20:00.000Z')
      expect(failed.nextAttemptAt).toBeNull()
      expect(failed.lastError?.code).toBe('HOSTED_ASSISTANT_OUTBOX_JOURNAL_FAILED')

      const receipt = await readAssistantTurnReceipt(vault, sending.turnId)
      expect(receipt?.status).toBe('failed')
      expect(receipt?.deliveryDisposition).toBe('failed')
      expect(receipt?.lastError?.code).toBe('HOSTED_ASSISTANT_OUTBOX_JOURNAL_FAILED')
      expect(receipt?.timeline.at(-1)).toMatchObject({
        kind: 'delivery.failed',
        detail: 'hosted mirror reconciliation refused the delivery',
      })

      const diagnostics = await readAssistantDiagnosticsSnapshot(vault)
      expect(diagnostics.counters.deliveriesFailed).toBe(1)
      expect(diagnostics.counters.deliveriesRetryable).toBe(0)
      expect(diagnostics.counters.outboxRetries).toBe(0)
    })
  })

  it('sanitizes persisted outbox and receipt delivery errors', async () => {
    await withTempVault(async (vault) => {
      const sending = await createSendingIntent({
        attemptCount: 1,
        vault,
      })
      const paths = resolveAssistantStatePaths(vault)

      const failed = await markAssistantOutboxIntentMirrorTerminal({
        error: Object.assign(
          new Error(
            'Authorization: Bearer secret-token-value failed at https://example.com/send?api_key=secret-token-value under /tmp/murph-secret',
          ),
          {
            code: 'HOSTED_ASSISTANT_OUTBOX_JOURNAL_FAILED',
          },
        ),
        failedAt: new Date('2030-04-13T00:24:00.000Z'),
        intent: sending,
        intentPath: resolveAssistantOutboxIntentPath(paths.outboxDirectory, sending.intentId),
        status: 'failed',
        vault,
      })

      const receipt = await readAssistantTurnReceipt(vault, sending.turnId)
      const serialized = JSON.stringify({
        intent: failed,
        receipt,
      })
      expect(failed.lastError?.message).toContain('[REDACTED]')
      expect(receipt?.lastError?.message).toContain('[url]')
      expect(receipt?.timeline.at(-1)?.detail).toContain('[path]')
      expect(serialized).not.toContain('secret-token-value')
      expect(serialized).not.toContain('api_key=')
      expect(serialized).not.toContain('/tmp/murph-secret')
    })
  })

  it('repairs sent receipt state when a repeated sent transition hits an existing sent intent', async () => {
    await withTempVault(async (vault) => {
      const sending = await createSendingIntent({
        attemptCount: 1,
        vault,
      })
      const paths = resolveAssistantStatePaths(vault)
      const intentPath = resolveAssistantOutboxIntentPath(
        paths.outboxDirectory,
        sending.intentId,
      )
      const delivery = {
        channel: 'telegram',
        idempotencyKey: 'assistant-outbox:sent-repair',
        messageLength: sending.message.length,
        providerMessageId: 'provider-sent-repair',
        providerThreadId: null,
        sentAt: '2030-04-13T00:30:00.000Z',
        target: 'chat-sent-repair',
        targetKind: 'thread',
      } as const

      const sent = await markAssistantOutboxIntentSent({
        delivery,
        intent: sending,
        intentPath,
        vault,
      })
      await updateAssistantTurnReceipt({
        vault,
        turnId: sent.turnId,
        mutate(receipt) {
          return {
            ...receipt,
            completedAt: '2030-04-13T00:31:00.000Z',
            deliveryDisposition: 'queued',
            deliveryIntentId: null,
            timeline: receipt.timeline.filter((event) => event.kind !== 'delivery.sent'),
            updatedAt: '2030-04-13T00:31:00.000Z',
          }
        },
      })

      const repeated = await markAssistantOutboxIntentSent({
        delivery,
        intent: sent,
        intentPath,
        vault,
      })

      expect(repeated.intentId).toBe(sent.intentId)
      const receipt = await readAssistantTurnReceipt(vault, sent.turnId)
      expect(receipt?.deliveryDisposition).toBe('sent')
      expect(receipt?.deliveryIntentId).toBe(sent.intentId)
      expect(receipt?.updatedAt).toBe('2030-04-13T00:31:00.000Z')
      expect(receipt?.completedAt).toBe('2030-04-13T00:31:00.000Z')
      expect(receipt?.timeline.filter((event) => event.kind === 'delivery.sent')).toHaveLength(1)
    })
  })

  it('does not repair sent receipt state for a mismatched terminal delivery', async () => {
    await withTempVault(async (vault) => {
      const sending = await createSendingIntent({
        attemptCount: 1,
        vault,
      })
      const paths = resolveAssistantStatePaths(vault)
      const intentPath = resolveAssistantOutboxIntentPath(
        paths.outboxDirectory,
        sending.intentId,
      )
      const firstDelivery = {
        channel: 'telegram',
        idempotencyKey: 'assistant-outbox:sent-mismatch',
        messageLength: sending.message.length,
        providerMessageId: 'provider-original',
        providerThreadId: null,
        sentAt: '2030-04-13T00:30:00.000Z',
        target: 'chat-sent-mismatch',
        targetKind: 'thread',
      } as const
      const secondDelivery = {
        ...firstDelivery,
        providerMessageId: 'provider-mismatch',
        sentAt: '2030-04-13T00:30:05.000Z',
      }

      const sent = await markAssistantOutboxIntentSent({
        delivery: firstDelivery,
        intent: sending,
        intentPath,
        vault,
      })
      await updateAssistantTurnReceipt({
        vault,
        turnId: sent.turnId,
        mutate(receipt) {
          return {
            ...receipt,
            completedAt: null,
            deliveryDisposition: 'queued',
            deliveryIntentId: null,
            timeline: receipt.timeline.filter((event) => event.kind !== 'delivery.sent'),
            updatedAt: '2030-04-13T00:31:00.000Z',
          }
        },
      })

      const repeated = await markAssistantOutboxIntentSent({
        delivery: secondDelivery,
        intent: sent,
        intentPath,
        vault,
      })

      expect(expectMessageDelivery(repeated.delivery).providerMessageId).toBe(
        'provider-original',
      )
      const receipt = await readAssistantTurnReceipt(vault, sent.turnId)
      expect(receipt?.deliveryDisposition).toBe('queued')
      expect(receipt?.deliveryIntentId).toBe(null)
      expect(receipt?.timeline.filter((event) => event.kind === 'delivery.sent')).toHaveLength(0)
    })
  })

  it('marks sending mirror state stale once the grace window elapses', async () => {
    await withTempVault(async (vault) => {
      const sending = await createSendingIntent({
        attemptCount: 2,
        vault,
      })

      const mirrorState = buildAssistantOutboxIntentMirrorState({
        intent: sending,
        now: new Date('2026-04-13T00:03:00.000Z'),
        sendingGraceMs: 2 * 60 * 1000,
      })

      expect(mirrorState.intent?.intentId).toBe(sending.intentId)
      expect(mirrorState.sendingStartedAt).toBe('2026-04-13T00:00:00.000Z')
      expect(mirrorState.sendingPastGraceWindow).toBe(true)
    })
  })

  it('keeps sent mirror state non-stale and does not invent a sending timestamp', async () => {
    await withTempVault(async (vault) => {
      const sending = await createSendingIntent({
        attemptCount: 1,
        vault,
      })
      const sent = await saveAssistantOutboxIntent(vault, {
        ...sending,
        delivery: {
          channel: 'telegram',
          idempotencyKey: 'assistant-outbox:sent',
          messageLength: 24,
          providerMessageId: 'provider_sent',
          providerThreadId: 'thread_sent',
          sentAt: '2026-04-13T00:01:00.000Z',
          target: 'chat_sent',
          targetKind: 'participant',
        },
        sentAt: '2026-04-13T00:01:00.000Z',
        status: 'sent',
        updatedAt: '2026-04-13T00:01:00.000Z',
      })

      const mirrorState = buildAssistantOutboxIntentMirrorState({
        intent: sent,
        now: new Date('2026-04-13T00:03:00.000Z'),
        sendingGraceMs: 2 * 60 * 1000,
      })

      expect(mirrorState.intent?.status).toBe('sent')
      expect(mirrorState.sendingStartedAt).toBeNull()
      expect(mirrorState.sendingPastGraceWindow).toBe(false)
    })
  })

})
