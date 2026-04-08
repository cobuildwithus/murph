import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/outbound-channel.ts', () => ({
  deliverAssistantMessageOverBinding: vi.fn(),
}))

import type {
  AssistantChannelDelivery,
  AssistantDeliveryError,
  AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  buildAssistantOutboxSummary,
  createAssistantOutboxIntent,
  dispatchAssistantOutboxIntent,
  drainAssistantOutboxLocal,
  deliverAssistantOutboxMessage,
  listAssistantOutboxIntentsLocal,
  readAssistantOutboxIntent,
  saveAssistantOutboxIntent,
} from '../src/assistant/outbox.ts'
import { ensureAssistantState } from '../src/assistant/store/persistence.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { deliverAssistantMessageOverBinding } from '../src/outbound-channel.ts'
import { createTempVaultContext } from './test-helpers.ts'

const mockedDeliverAssistantMessageOverBinding = vi.mocked(
  deliverAssistantMessageOverBinding,
)

const tempRoots: string[] = []
let intentSequence = 0

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  mockedDeliverAssistantMessageOverBinding.mockReset()
  intentSequence = 0
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant outbox runtime', () => {
  it('dedupes non-terminal intents, allows retries after permanent failure, and rejects blank messages', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-dedupe-')

    const first = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T00:00:00.000Z',
      dedupeToken: 'stable-token',
      message: '  hello from outbox  ',
      sessionId: 'session-dedupe',
      turnId: 'turn-dedupe',
    })
    expect(first.message).toBe('hello from outbox')

    const deduped = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T00:01:00.000Z',
      dedupeToken: 'stable-token',
      message: 'hello from outbox',
      sessionId: 'session-dedupe',
      turnId: 'turn-dedupe',
    })
    expect(deduped.intentId).toBe(first.intentId)
    expect(deduped.createdAt).toBe(first.createdAt)

    await saveAssistantOutboxIntent(vaultRoot, {
      ...first,
      lastError: {
        code: 'CHANNEL_REQUIRED',
        message: 'channel required',
      },
      nextAttemptAt: null,
      status: 'failed',
      updatedAt: '2026-04-08T00:02:00.000Z',
    })

    const recreated = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T00:03:00.000Z',
      dedupeToken: 'stable-token',
      message: 'hello from outbox',
      sessionId: 'session-dedupe',
      turnId: 'turn-dedupe',
    })
    expect(recreated.intentId).not.toBe(first.intentId)

    await expect(readAssistantOutboxIntent(vaultRoot, 'missing-intent')).resolves.toBeNull()

    await expect(
      createIntent(vaultRoot, {
        message: '   ',
        sessionId: 'session-blank',
        turnId: 'turn-blank',
      }),
    ).rejects.toThrow('Assistant outbox messages must be non-empty strings.')
  })

  it('lists intents oldest-first and quarantines malformed inventory files', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T12:00:00.000Z'))

    const { paths, vaultRoot } = await createAssistantVault('assistant-outbox-list-')
    const later = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T00:02:00.000Z',
      message: 'later intent',
      sessionId: 'session-list-later',
      turnId: 'turn-list-later',
    })
    const earlier = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T00:01:00.000Z',
      message: 'earlier intent',
      sessionId: 'session-list-earlier',
      turnId: 'turn-list-earlier',
    })

    await mkdir(path.join(paths.outboxDirectory, 'nested'), {
      recursive: true,
    })
    await writeFile(path.join(paths.outboxDirectory, 'notes.txt'), 'ignore me\n', 'utf8')
    const brokenPath = path.join(paths.outboxDirectory, 'broken.json')
    await writeFile(
      brokenPath,
      '{"schema":"murph.assistant-outbox-intent.v1"',
      'utf8',
    )

    await expect(listAssistantOutboxIntentsLocal(vaultRoot)).resolves.toMatchObject([
      { intentId: earlier.intentId, createdAt: earlier.createdAt },
      { intentId: later.intentId, createdAt: later.createdAt },
    ])
    await expect(readAssistantOutboxIntent(vaultRoot, 'broken')).resolves.toBeNull()

    const quarantined = await readdir(paths.outboxQuarantineDirectory)
    expect(quarantined).toHaveLength(1)
    expect(quarantined[0]).toMatch(/^broken\.\d+\.invalid\.json$/u)
    expect(await readAssistantOutboxIntent(vaultRoot, 'broken')).toBeNull()
  })

  it('reconciles confirmation-pending deliveries or reschedules them for retry', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-reconcile-')

    const reconciledSeed = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T01:00:00.000Z',
      message: 'needs reconciliation',
      sessionId: 'session-reconcile-a',
      turnId: 'turn-reconcile-a',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...reconciledSeed,
      attemptCount: 1,
      delivery: createDelivery({
        idempotencyKey: 'existing-idempotency',
        providerMessageId: 'provider-pending',
        sentAt: '2026-04-08T01:01:00.000Z',
      }),
      deliveryConfirmationPending: true,
      deliveryIdempotencyKey: 'existing-idempotency',
      lastAttemptAt: '2026-04-08T01:01:00.000Z',
      lastError: createConfirmationPendingError(),
      nextAttemptAt: null,
      status: 'sending',
      updatedAt: '2026-04-08T01:01:00.000Z',
    })

    const reconciled = await dispatchAssistantOutboxIntent({
      dispatchHooks: {
        resolveDeliveredIntent: async () =>
          createDelivery({
            idempotencyKey: 'existing-idempotency',
            providerMessageId: 'provider-reconciled',
            sentAt: '2026-04-08T01:03:00.000Z',
          }),
      },
      intentId: reconciledSeed.intentId,
      now: new Date('2026-04-08T01:20:00.000Z'),
      vault: vaultRoot,
    })
    expect(reconciled.deliveryError).toBeNull()
    expect(reconciled.intent.status).toBe('sent')
    expect(reconciled.intent.delivery?.providerMessageId).toBe('provider-reconciled')
    expect(reconciled.intent.deliveryConfirmationPending).toBe(false)

    const retrySeed = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T02:00:00.000Z',
      message: 'still pending confirmation',
      sessionId: 'session-reconcile-b',
      turnId: 'turn-reconcile-b',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...retrySeed,
      attemptCount: 2,
      delivery: createDelivery({
        idempotencyKey: 'pending-idempotency',
        providerMessageId: 'provider-still-pending',
        sentAt: '2026-04-08T02:01:00.000Z',
      }),
      deliveryConfirmationPending: true,
      deliveryIdempotencyKey: 'pending-idempotency',
      lastAttemptAt: '2026-04-08T02:01:00.000Z',
      lastError: createConfirmationPendingError(),
      nextAttemptAt: null,
      status: 'sending',
      updatedAt: '2026-04-08T02:01:00.000Z',
    })

    const retried = await dispatchAssistantOutboxIntent({
      dispatchHooks: {
        resolveDeliveredIntent: async () => null,
      },
      intentId: retrySeed.intentId,
      now: new Date('2026-04-08T02:20:00.000Z'),
      vault: vaultRoot,
    })
    expect(retried.intent.status).toBe('retryable')
    expect(retried.intent.deliveryConfirmationPending).toBe(true)
    expect(retried.intent.lastError?.code).toBe(
      'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
    )
    expect(retried.intent.nextAttemptAt).toBe('2026-04-08T02:22:00.000Z')
  })

  it('delivers immediately, reuses sent dedupe hits, and supports queue-only mode', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-deliver-')
    const prepareDispatchIntent = vi.fn(async () => {})
    const persistDeliveredIntent = vi.fn(async () => {})

    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        idempotencyKey: null,
        providerMessageId: 'provider-sent',
        sentAt: '2026-04-08T03:01:00.000Z',
      }),
      deliveryTransportIdempotent: false,
      session: null,
    })

    const sent = await deliverAssistantOutboxMessage({
      channel: 'telegram',
      dispatchHooks: {
        persistDeliveredIntent,
        prepareDispatchIntent,
      },
      identityId: 'participant-1',
      message: 'deliver this now',
      sessionId: 'session-deliver',
      threadId: 'thread-deliver',
      threadIsDirect: true,
      turnId: 'turn-deliver',
      vault: vaultRoot,
    })
    expect(sent.kind).toBe('sent')
    expect(sent.intent.status).toBe('sent')
    expect(sent.delivery?.idempotencyKey).toBe(
      `assistant-outbox:${sent.intent.intentId}`,
    )
    expect(prepareDispatchIntent).toHaveBeenCalledTimes(1)
    expect(persistDeliveredIntent).toHaveBeenCalledTimes(1)
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(1)

    const alreadySent = await deliverAssistantOutboxMessage({
      channel: 'telegram',
      identityId: 'participant-1',
      message: 'deliver this now',
      sessionId: 'session-deliver',
      threadId: 'thread-deliver',
      threadIsDirect: true,
      turnId: 'turn-deliver',
      vault: vaultRoot,
    })
    expect(alreadySent.kind).toBe('sent')
    expect(alreadySent.intent.intentId).toBe(sent.intent.intentId)
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(1)

    const queued = await deliverAssistantOutboxMessage({
      channel: 'telegram',
      dispatchMode: 'queue-only',
      identityId: 'participant-queue',
      message: 'queue this',
      sessionId: 'session-queue',
      threadId: 'thread-queue',
      threadIsDirect: true,
      turnId: 'turn-queue',
      vault: vaultRoot,
    })
    expect(queued.kind).toBe('queued')
    expect(queued.intent.status).toBe('pending')
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(1)
  })

  it('clears prepared dispatches on definite failures and falls back to confirmation-pending retries when cleanup is ambiguous', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-failure-')

    const failedSeed = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T04:00:00.000Z',
      message: 'definite failure',
      sessionId: 'session-failure-a',
      turnId: 'turn-failure-a',
    })
    mockedDeliverAssistantMessageOverBinding.mockRejectedValueOnce(
      Object.assign(new Error('channel required'), {
        code: 'CHANNEL_REQUIRED',
      }),
    )
    const clearPreparedIntent = vi.fn(async () => {})

    const failed = await dispatchAssistantOutboxIntent({
      dispatchHooks: {
        clearPreparedIntent,
        prepareDispatchIntent: async () => {},
      },
      force: true,
      intentId: failedSeed.intentId,
      now: new Date('2026-04-08T04:05:00.000Z'),
      vault: vaultRoot,
    })
    expect(clearPreparedIntent).toHaveBeenCalledTimes(1)
    expect(failed.intent.status).toBe('failed')
    expect(failed.intent.deliveryConfirmationPending).toBe(false)
    expect(failed.intent.lastError?.code).toBe('CHANNEL_REQUIRED')

    const ambiguousSeed = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T04:10:00.000Z',
      message: 'ambiguous cleanup',
      sessionId: 'session-failure-b',
      turnId: 'turn-failure-b',
    })
    mockedDeliverAssistantMessageOverBinding.mockRejectedValueOnce(
      Object.assign(new Error('channel required'), {
        code: 'CHANNEL_REQUIRED',
      }),
    )

    const ambiguous = await dispatchAssistantOutboxIntent({
      dispatchHooks: {
        clearPreparedIntent: async () => {
          throw new Error('cleanup failed')
        },
        prepareDispatchIntent: async () => {},
      },
      force: true,
      intentId: ambiguousSeed.intentId,
      now: new Date('2026-04-08T04:15:00.000Z'),
      vault: vaultRoot,
    })
    expect(ambiguous.intent.status).toBe('retryable')
    expect(ambiguous.intent.deliveryConfirmationPending).toBe(true)
    expect(ambiguous.intent.lastError?.code).toBe(
      'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
    )
  })

  it('drains only due intents and summarizes mixed outbox states', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-drain-')

    await createIntent(vaultRoot, {
      createdAt: '2026-04-08T05:00:00.000Z',
      message: 'due pending',
      sessionId: 'session-drain-pending',
      turnId: 'turn-drain-pending',
    })
    const staleSending = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T05:01:00.000Z',
      message: 'stale sending',
      sessionId: 'session-drain-sending',
      turnId: 'turn-drain-sending',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...staleSending,
      attemptCount: 1,
      lastAttemptAt: '2026-04-08T05:00:00.000Z',
      nextAttemptAt: null,
      status: 'sending',
      updatedAt: '2026-04-08T05:00:00.000Z',
    })

    const futureRetryable = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T05:02:00.000Z',
      message: 'future retry',
      sessionId: 'session-drain-future',
      turnId: 'turn-drain-future',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...futureRetryable,
      attemptCount: 2,
      lastError: {
        code: 'REQUEST_FAILED',
        message: 'temporary retry',
      },
      nextAttemptAt: '2026-04-08T06:00:00.000Z',
      status: 'retryable',
      updatedAt: '2026-04-08T05:03:00.000Z',
    })

    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        providerMessageId: 'provider-drain-sent',
        sentAt: '2026-04-08T05:20:00.000Z',
      }),
      deliveryTransportIdempotent: false,
      session: null,
    })
    mockedDeliverAssistantMessageOverBinding.mockRejectedValueOnce(
      Object.assign(new Error('temporary network outage'), {
        code: 'REQUEST_FAILED',
      }),
    )

    const drained = await drainAssistantOutboxLocal({
      limit: 10,
      now: new Date('2026-04-08T05:20:00.000Z'),
      vault: vaultRoot,
    })
    expect(drained).toEqual({
      attempted: 2,
      failed: 0,
      queued: 1,
      sent: 1,
    })

    const failedIntent = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T05:03:00.000Z',
      message: 'failed later',
      sessionId: 'session-summary-failed',
      turnId: 'turn-summary-failed',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...failedIntent,
      lastError: {
        code: 'CHANNEL_REQUIRED',
        message: 'channel required',
      },
      nextAttemptAt: null,
      status: 'failed',
      updatedAt: '2026-04-08T05:03:30.000Z',
    })

    const abandonedIntent = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T05:04:00.000Z',
      message: 'abandoned later',
      sessionId: 'session-summary-abandoned',
      turnId: 'turn-summary-abandoned',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...abandonedIntent,
      nextAttemptAt: null,
      status: 'abandoned',
      updatedAt: '2026-04-08T05:04:30.000Z',
    })

    const summary = await buildAssistantOutboxSummary(vaultRoot)
    expect(summary).toEqual({
      abandoned: 1,
      failed: 1,
      nextAttemptAt: '2026-04-08T05:22:00.000Z',
      oldestPendingAt: staleSending.createdAt,
      pending: 0,
      retryable: 2,
      sending: 0,
      sent: 1,
      total: 5,
    })
  })
})

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
  vault: string,
  overrides: Partial<{
    channel: string | null
    createdAt: string
    dedupeToken: string | null
    explicitTarget: string | null
    identityId: string | null
    message: string
    sessionId: string
    threadId: string | null
    threadIsDirect: boolean | null
    turnId: string
  }> = {},
): Promise<AssistantOutboxIntent> {
  intentSequence += 1
  const sessionId = overrides.sessionId ?? `session-${intentSequence}`
  const turnId = overrides.turnId ?? `turn-${intentSequence}`

  return createAssistantOutboxIntent({
    channel: overrides.channel ?? 'telegram',
    createdAt: overrides.createdAt,
    dedupeToken:
      overrides.dedupeToken === undefined
        ? `${sessionId}:${turnId}`
        : overrides.dedupeToken,
    explicitTarget: overrides.explicitTarget ?? null,
    identityId: overrides.identityId ?? 'participant-1',
    message: overrides.message ?? `${sessionId}:${turnId}:message`,
    sessionId,
    threadId: overrides.threadId ?? 'thread-1',
    threadIsDirect: overrides.threadIsDirect ?? true,
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

function createConfirmationPendingError(): AssistantDeliveryError {
  return {
    code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
    message:
      'Assistant outbound delivery may have succeeded already and must be reconciled before resend.',
  }
}
