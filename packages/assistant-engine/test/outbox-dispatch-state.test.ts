import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assistantDeliveryErrorSchema } from '@murphai/operator-config/assistant-cli-contracts'
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
  resetAssistantOutboxPreparedDispatch,
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
  it('schedules retryable failures from the failure time and keeps diagnostics aligned', async () => {
    await withTempVault(async (vault) => {
      const sending = await createSendingIntent({
        attemptCount: 1,
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
      const persisted = await readAssistantOutboxIntent(vault, created.intentId)
      expect(persisted?.lastAttemptAt).toBe(firstStartedAt)
      expect(persisted?.attemptCount).toBe(1)
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
      const sending = await beginAssistantOutboxIntentMirrorDispatch({
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_reset',
        deliveryTransportIdempotent: false,
        intentId: created.intentId,
        startedAt: preparedAt,
        vault,
      })
      expect(sending?.status).toBe('sending')

      const paths = resolveAssistantStatePaths(vault)
      const intentPath = resolveAssistantOutboxIntentPath(paths.outboxDirectory, created.intentId)
      const resetAt = new Date('2030-04-13T00:10:03.000Z')
      const reset = await resetAssistantOutboxPreparedDispatch({
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_reset',
        deliveryTransportIdempotent: false,
        intent: sending!,
        intentPath,
        preparedAt,
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
        deliveryIdempotencyKey: retryable.deliveryIdempotencyKey,
        deliveryTransportIdempotent: retryable.deliveryTransportIdempotent,
        intent: prepared!.intent,
        intentPath,
        preparedAt,
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
        deliveryIdempotencyKey: created.deliveryIdempotencyKey,
        deliveryTransportIdempotent: created.deliveryTransportIdempotent,
        intent: prepared!.intent,
        intentPath,
        minimumNextAttemptAt: successorRetryAt,
        preparedAt,
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
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_mismatch',
        deliveryTransportIdempotent: false,
        intent: sending!,
        intentPath,
        preparedAt: '2030-04-13T00:10:01.000Z',
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
      const sending = await beginAssistantOutboxIntentMirrorDispatch({
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_failed_reset',
        deliveryTransportIdempotent: false,
        intentId: created.intentId,
        startedAt: preparedAt,
        vault,
      })
      const failed = await saveAssistantOutboxIntent(vault, {
        ...sending!,
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
        deliveryIdempotencyKey: 'assistant-outbox:intent_prepared_failed_reset',
        deliveryTransportIdempotent: false,
        intent: failed,
        intentPath,
        preparedAt,
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
