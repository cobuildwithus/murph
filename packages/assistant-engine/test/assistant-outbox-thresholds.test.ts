import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AssistantChannelDelivery } from '@murphai/operator-config/assistant-cli-contracts'
import { ensureAssistantState } from '../src/assistant/store/persistence.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
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

  it('warns and still marks delivery sent when session persistence fails after send', async () => {
    const warnAssistantBestEffortFailure = vi.fn()
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
      warnAssistantBestEffortFailure,
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
      deliveryError: null,
      intent: {
        intentId: seeded.intentId,
        status: 'sent',
      },
    })
    expect(warnAssistantBestEffortFailure).toHaveBeenCalledWith({
      error: expect.any(Error),
      operation: 'post-delivery session persistence',
    })
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
      provider: 'openai-compatible',
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

  it('reuses the already-sent intent when the persist hook races the final send mark', async () => {
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
      message: 'persist hook races the sent mark',
      sessionId: 'session-race',
      turnId: 'turn-race',
    })

    const dispatched = await outbox.dispatchAssistantOutboxIntent({
      dispatchHooks: {
        persistDeliveredIntent: async ({ intent, vault }) => {
          await outbox.saveAssistantOutboxIntent(vault, {
            ...intent,
            delivery,
            deliveryConfirmationPending: false,
            deliveryIdempotencyKey: delivery.idempotencyKey,
            lastError: null,
            nextAttemptAt: null,
            sentAt: delivery.sentAt,
            status: 'sent',
            updatedAt: '2026-04-08T13:02:00.000Z',
          })
        },
      },
      force: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T13:01:00.000Z'),
      vault: vaultRoot,
    })

    expect(dispatched.intent).toMatchObject({
      intentId: seeded.intentId,
      sentAt: '2026-04-08T13:01:00.000Z',
      status: 'sent',
      updatedAt: '2026-04-08T13:02:00.000Z',
    })
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

  it('treats explicit delivery-may-have-succeeded errors as confirmation-pending retries', async () => {
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

    await expect(
      outbox.dispatchAssistantOutboxIntent({
        force: true,
        intentId: seeded.intentId,
        now: new Date('2026-04-08T14:05:00.000Z'),
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      deliveryError: {
        code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
      },
      intent: {
        deliveryConfirmationPending: true,
        status: 'retryable',
      },
      session: null,
    })
  })
})

async function loadOutboxModule(options: {
  deliverAssistantMessageOverBinding?: (...args: never[]) => Promise<unknown>
  rename?: (...args: never[]) => Promise<unknown>
  saveAssistantSession?: (...args: never[]) => Promise<unknown>
  warnAssistantBestEffortFailure?: (...args: never[]) => unknown
} = {}) {
  vi.resetModules()
  vi.doMock('../src/outbound-channel.ts', () => ({
    deliverAssistantMessageOverBinding:
      options.deliverAssistantMessageOverBinding ?? vi.fn(),
  }))

  if (options.rename) {
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>(
        'node:fs/promises',
      )
      return {
        ...actual,
        rename: options.rename,
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

  if (options.warnAssistantBestEffortFailure) {
    vi.doMock('../src/assistant/shared.js', async () => {
      const actual = await vi.importActual<typeof import('../src/assistant/shared.ts')>(
        '../src/assistant/shared.ts',
      )
      return {
        ...actual,
        warnAssistantBestEffortFailure: options.warnAssistantBestEffortFailure,
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
    createdAt: string
    message: string
    sessionId: string
    turnId: string
  }> = {},
) {
  const sessionId = overrides.sessionId ?? 'session-test'
  const turnId = overrides.turnId ?? 'turn-test'
  return outbox.createAssistantOutboxIntent({
    channel: 'telegram',
    createdAt: overrides.createdAt,
    identityId: 'participant-1',
    message: overrides.message ?? 'assistant outbox threshold coverage',
    sessionId,
    threadId: 'thread-test',
    threadIsDirect: true,
    turnId,
    vault,
  })
}

function createDelivery(
  overrides: Partial<AssistantChannelDelivery> = {},
): AssistantChannelDelivery {
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
