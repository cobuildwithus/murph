import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assistantDeliveryErrorSchema } from '@murphai/operator-config/assistant-cli-contracts'
import {
  createAssistantOutboxIntent,
  readAssistantOutboxIntent,
  saveAssistantOutboxIntent,
} from '../src/assistant/outbox.ts'
import {
  rescheduleAssistantOutboxConfirmationRetry,
  updateAssistantOutboxAfterDispatchFailure,
} from '../src/assistant/outbox/dispatch-state.ts'
import { resolveAssistantOutboxIntentPath } from '../src/assistant/outbox/intents.ts'
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
  vault: string
}): Promise<Awaited<ReturnType<typeof saveAssistantOutboxIntent>>> {
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
    deliveryTransportIdempotent: false,
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
})
