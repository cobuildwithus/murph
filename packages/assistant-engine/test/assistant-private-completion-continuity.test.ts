import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  createHostedExecutionPrivateAssistantAskCompletionDeliveryKey,
} from '@murphai/hosted-execution/assistant-identifiers'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import {
  assistantChannelDeliverySchema,
  type AssistantOutboxIntent,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  persistAssistantPrivateCompletionContinuityAfterDelivery,
  reconcileAssistantPrivateCompletionContinuityForSession,
} from '../src/assistant/private-completion-continuity.ts'
import {
  createAssistantOutboxIntent,
  dispatchAssistantOutboxIntent,
  readAssistantOutboxIntent,
  saveAssistantOutboxIntent,
} from '../src/assistant/outbox.ts'
import { pruneAssistantTerminalOutboxIntents } from '../src/assistant/outbox/store.ts'
import { resolveAssistantSessionForMessage } from '../src/assistant/session-resolution.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import {
  appendAssistantTranscriptEntries,
  getAssistantSession,
  listAssistantTranscriptEntries,
  resolveAssistantSession,
  saveAssistantSession,
} from '../src/assistant/store.ts'
import { createTempVaultContext } from './test-helpers.ts'

const cleanupPaths: string[] = []
const locator = {
  actorId: 'h1_111111111111111111111111',
  bindingDeliveryTarget: 'h1_555555555555555555555555',
  channel: 'linq',
  deliveryKind: 'thread' as const,
  identityId: 'h1_222222222222222222222222',
  threadId: 'h1_333333333333333333333333',
  threadIsDirect: true,
}
const telegramLocator = {
  ...locator,
  channel: 'telegram',
}
type ContinuityLocator = typeof locator | typeof telegramLocator
const ordinaryTarget = createAssistantModelTarget({
  approvalPolicy: 'never',
  model: 'gpt-5.6-terra',
  modelProvider: 'vercel-ai-gateway',
  oss: false,
  profile: null,
  provider: 'codex-cli',
  reasoningEffort: 'medium',
  sandbox: 'danger-full-access',
})
const detachedTarget = createAssistantModelTarget({
  approvalPolicy: 'never',
  model: 'gpt-5.6-terra',
  modelProvider: 'vercel-ai-gateway',
  oss: false,
  profile: null,
  provider: 'codex-cli',
  reasoningEffort: 'medium',
  sandbox: 'read-only',
})

if (!ordinaryTarget || !detachedTarget) {
  throw new Error('Expected private completion test targets.')
}

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, { force: true, recursive: true })
  ))
})

describe('private completion continuity', () => {
  it('claims pending unbound ownership without importing before delivery authority', async () => {
    const fixture = await createContinuityFixture('private-continuity-rejected-')
    const pending = await createPrivateCompletionIntent({
      continuitySessionId: null,
      deliverySession: fixture.ordinarySession,
      vault: fixture.vaultRoot,
    })

    await reconcileAssistantPrivateCompletionContinuityForSession({
      allowUnbound: true,
      sessionId: fixture.ordinarySession.sessionId,
      vault: fixture.vaultRoot,
    })

    const session = await getAssistantSession(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
    )
    expect(pending.delivery).toBeNull()
    await expect(readAssistantOutboxIntent(
      fixture.vaultRoot,
      pending.intentId,
    )).resolves.toMatchObject({
      privateCompletionContinuitySessionId: fixture.ordinarySession.sessionId,
      status: 'pending',
    })
    expect(session).toMatchObject({
      codexResume: fixture.nativeResume,
      resumeState: fixture.nativeResume,
      turnCount: 0,
    })
    await expect(listAssistantTranscriptEntries(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
    )).resolves.toEqual([])
  })

  it.each([
    'sent',
    'retryable',
  ] as const)('claims an unbound completion during active delivery without importing it early and preserves the binding at $expectedStatus', async (expectedStatus) => {
    const fixture = await createContinuityFixture(
      'private-continuity-active-delivery-claim-',
    )
    const pending = await createPrivateCompletionIntent({
      completionId: 'aask_done_private_continuity_active_delivery',
      continuitySessionId: null,
      deliverySession: fixture.ordinarySession,
      vault: fixture.vaultRoot,
    })
    let markProviderEntered: (() => void) | undefined
    const providerEntered = new Promise<void>((resolve) => {
      markProviderEntered = resolve
    })
    let releaseProvider: (() => void) | undefined
    const providerReleased = new Promise<void>((resolve) => {
      releaseProvider = resolve
    })
    const dispatch = dispatchAssistantOutboxIntent({
      dependencies: {
        sendLinq: async () => {
          markProviderEntered?.()
          await providerReleased
          if (expectedStatus === 'retryable') {
            throw new VaultCliError(
              'ASSISTANT_TEST_RETRYABLE_DELIVERY',
              'Retry the test delivery.',
              { retryable: true },
            )
          }
          return {
            idempotencyKey: pending.deliveryIdempotencyKey,
            providerMessageId: 'provider_private_continuity_active_delivery',
            providerThreadId: locator.threadId,
            target: locator.bindingDeliveryTarget,
            targetKind: locator.deliveryKind,
          }
        },
      },
      force: true,
      intentId: pending.intentId,
      vault: fixture.vaultRoot,
    })
    await providerEntered

    await reconcileAssistantPrivateCompletionContinuityForSession({
      allowUnbound: true,
      sessionId: fixture.ordinarySession.sessionId,
      vault: fixture.vaultRoot,
    })

    await expect(readAssistantOutboxIntent(
      fixture.vaultRoot,
      pending.intentId,
    )).resolves.toMatchObject({
      privateCompletionContinuitySessionId: fixture.ordinarySession.sessionId,
      status: 'sending',
    })
    await expect(getAssistantSession(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
    )).resolves.toMatchObject({
      codexResume: fixture.nativeResume,
      resumeState: fixture.nativeResume,
      turnCount: 0,
    })
    await expect(listAssistantTranscriptEntries(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
    )).resolves.toEqual([])

    releaseProvider?.()
    const delivered = await dispatch
    expect(delivered.intent).toMatchObject({
      privateCompletionContinuitySessionId: fixture.ordinarySession.sessionId,
      status: expectedStatus,
    })
    if (expectedStatus === 'retryable') {
      await expect(getAssistantSession(
        fixture.vaultRoot,
        fixture.ordinarySession.sessionId,
      )).resolves.toMatchObject({
        codexResume: fixture.nativeResume,
        resumeState: fixture.nativeResume,
        turnCount: 0,
      })
      await expect(listAssistantTranscriptEntries(
        fixture.vaultRoot,
        fixture.ordinarySession.sessionId,
      )).resolves.toEqual([])
      return
    }
    await persistAssistantPrivateCompletionContinuityAfterDelivery({
      intent: delivered.intent,
      vault: fixture.vaultRoot,
    })
    await expect(getAssistantSession(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
    )).resolves.toMatchObject({
      codexResume: null,
      resumeState: null,
      turnCount: 1,
    })
    await expect(listAssistantTranscriptEntries(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
    )).resolves.toEqual([
      expect.objectContaining({
        sourceOutboxIntentId: pending.intentId,
        text: pending.message,
      }),
    ])
  })

  it('imports a canonically sent completion exactly once and clears native resume', async () => {
    const fixture = await createContinuityFixture('private-continuity-delivered-')
    const delivered = await createDeliveredPrivateCompletion({
      continuitySessionId: fixture.ordinarySession.sessionId,
      deliverySession: fixture.ordinarySession,
      vault: fixture.vaultRoot,
    })

    await persistAssistantPrivateCompletionContinuityAfterDelivery({
      intent: delivered,
      vault: fixture.vaultRoot,
    })
    await reconcileAssistantPrivateCompletionContinuityForSession({
      allowUnbound: true,
      sessionId: fixture.ordinarySession.sessionId,
      vault: fixture.vaultRoot,
    })

    const session = await getAssistantSession(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
    )
    expect(session).toMatchObject({
      codexResume: null,
      resumeState: null,
      turnCount: 1,
    })
    await expect(listAssistantTranscriptEntries(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
    )).resolves.toEqual([
      expect.objectContaining({
        kind: 'assistant',
        sourceOutboxIntentId: delivered.intentId,
        text: delivered.message,
      }),
    ])
    await expect(listAssistantTranscriptEntries(
      fixture.vaultRoot,
      fixture.detachedSession.sessionId,
    )).resolves.toEqual([])
    await expect(readAssistantOutboxIntent(
      fixture.vaultRoot,
      delivered.intentId,
    )).resolves.toMatchObject({
      privateCompletionContinuity: {
        sessionId: fixture.ordinarySession.sessionId,
        status: 'applied',
      },
    })
  })

  it.each([
    {
      channelLabel: 'Linq rich-link',
      errorCode: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
      route: locator,
      status: 'retryable' as const,
    },
    {
      channelLabel: 'Telegram chunk ambiguity',
      errorCode: 'ASSISTANT_DELIVERY_AMBIGUOUS',
      route: telegramLocator,
      status: 'abandoned' as const,
    },
  ])(
    'does not import an otherwise exact $channelLabel partial-delivery receipt',
    async ({ errorCode, route, status }) => {
      const fixture = await createContinuityFixture(
        `private-continuity-partial-${status}-`,
        route,
      )
      const delivered = await createDeliveredPrivateCompletion({
        continuitySessionId: fixture.ordinarySession.sessionId,
        deliverySession: fixture.ordinarySession,
        route,
        vault: fixture.vaultRoot,
      })
      const partial = await saveAssistantOutboxIntent(fixture.vaultRoot, {
        ...delivered,
        lastError: {
          code: errorCode,
          message: 'Synthetic partial delivery.',
        },
        nextAttemptAt: status === 'retryable'
          ? '2026-08-11T18:05:00.000Z'
          : null,
        sentAt: null,
        status,
        updatedAt: '2026-08-11T18:01:00.000Z',
      })

      await persistAssistantPrivateCompletionContinuityAfterDelivery({
        intent: partial,
        vault: fixture.vaultRoot,
      })
      await reconcileAssistantPrivateCompletionContinuityForSession({
        allowUnbound: true,
        sessionId: fixture.ordinarySession.sessionId,
        vault: fixture.vaultRoot,
      })

      await expect(getAssistantSession(
        fixture.vaultRoot,
        fixture.ordinarySession.sessionId,
      )).resolves.toMatchObject({
        codexResume: fixture.nativeResume,
        resumeState: fixture.nativeResume,
        turnCount: 0,
      })
      await expect(listAssistantTranscriptEntries(
        fixture.vaultRoot,
        fixture.ordinarySession.sessionId,
      )).resolves.toEqual([])
      await expect(readAssistantOutboxIntent(
        fixture.vaultRoot,
        partial.intentId,
      )).resolves.not.toHaveProperty('privateCompletionContinuity')

      if (status === 'retryable') {
        const recovered = await dispatchAssistantOutboxIntent({
          dependencies: {
            sendLinq: async () => ({
              idempotencyKey: partial.deliveryIdempotencyKey,
              providerMessageId: 'provider_private_continuity_recovered',
              providerThreadId: locator.threadId,
              target: locator.bindingDeliveryTarget,
              targetKind: 'thread',
            }),
          },
          force: true,
          intentId: partial.intentId,
          vault: fixture.vaultRoot,
        })
        expect(recovered.intent.status).toBe('sent')
        await expect(listAssistantTranscriptEntries(
          fixture.vaultRoot,
          fixture.ordinarySession.sessionId,
        )).resolves.toEqual([])
        await persistAssistantPrivateCompletionContinuityAfterDelivery({
          intent: recovered.intent,
          vault: fixture.vaultRoot,
        })
        await expect(listAssistantTranscriptEntries(
          fixture.vaultRoot,
          fixture.ordinarySession.sessionId,
        )).resolves.toEqual([
          expect.objectContaining({
            sourceOutboxIntentId: partial.intentId,
            text: partial.message,
          }),
        ])
        return
      }

      await expect(pruneAssistantTerminalOutboxIntents({
        now: new Date('2100-01-01T00:00:00.000Z'),
        paths: resolveAssistantStatePaths(fixture.vaultRoot),
        vault: fixture.vaultRoot,
      })).resolves.toBe(1)
    },
  )

  it('repairs a canonically sent completion on the next direct turn without provider resend', async () => {
    const fixture = await createBoundContinuityFixture(
      'private-continuity-post-send-repair-',
    )
    const pending = await createPrivateCompletionIntent({
      continuitySessionId: fixture.ordinarySession.sessionId,
      deliverySession: fixture.ordinarySession,
      vault: fixture.vaultRoot,
    })
    const sendLinq = vi.fn(async () => ({
      idempotencyKey: pending.deliveryIdempotencyKey,
      providerMessageId: 'provider_private_continuity_post_send',
      providerThreadId: locator.threadId,
      target: locator.bindingDeliveryTarget,
      targetKind: 'thread' as const,
    }))
    const dispatched = await dispatchAssistantOutboxIntent({
      dependencies: { sendLinq },
      force: true,
      intentId: pending.intentId,
      vault: fixture.vaultRoot,
    })
    expect(dispatched.intent.status).toBe('sent')
    expect(sendLinq).toHaveBeenCalledOnce()
    await expect(listAssistantTranscriptEntries(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
    )).resolves.toEqual([])

    const replay = await dispatchAssistantOutboxIntent({
      dependencies: { sendLinq },
      force: true,
      intentId: pending.intentId,
      vault: fixture.vaultRoot,
    })
    expect(replay.intent.status).toBe('sent')
    expect(sendLinq).toHaveBeenCalledOnce()

    const attended = await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: ordinaryTarget,
      defaults: null,
      message: {
        ...locator,
        executionContext: {
          hosted: {
            defaultTarget: ordinaryTarget,
            memberId: 'member_private_continuity_repair',
            userEnvKeys: [],
          },
        },
        prompt: 'Continue after a completed private reply.',
        vault: fixture.vaultRoot,
      },
    })

    expect(attended.session).toMatchObject({
      codexResume: null,
      resumeState: null,
      sessionId: fixture.ordinarySession.sessionId,
      turnCount: 1,
    })
    await expect(listAssistantTranscriptEntries(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
    )).resolves.toEqual([
      expect.objectContaining({
        sourceOutboxIntentId: pending.intentId,
        text: pending.message,
      }),
    ])
    await expect(readAssistantOutboxIntent(
      fixture.vaultRoot,
      pending.intentId,
    )).resolves.toMatchObject({
      privateCompletionContinuity: { status: 'applied' },
      status: 'sent',
    })
  })

  it.each([
    'automation-cron',
    'automation-auto-reply',
  ] as const)('repairs a bound completion before a direct $turnTrigger turn but leaves unbound work attended-only', async (turnTrigger) => {
    const fixture = await createContinuityFixture(
      'private-continuity-scheduled-repair-',
    )
    const bound = await createPrivateCompletionIntent({
      completionId: 'aask_done_private_continuity_scheduled_bound',
      continuitySessionId: fixture.ordinarySession.sessionId,
      deliverySession: fixture.ordinarySession,
      message: 'Private reply before the scheduled result.',
      turnId: 'turn_private_continuity_scheduled_bound',
      vault: fixture.vaultRoot,
    })
    const unbound = await createPrivateCompletionIntent({
      completionId: 'aask_done_private_continuity_scheduled_unbound',
      continuitySessionId: null,
      deliverySession: fixture.ordinarySession,
      message: 'Unbound reply for an attended turn.',
      turnId: 'turn_private_continuity_scheduled_unbound',
      vault: fixture.vaultRoot,
    })
    for (const [intent, providerMessageId] of [
      [bound, 'provider_private_continuity_scheduled_bound'],
      [unbound, 'provider_private_continuity_scheduled_unbound'],
    ] as const) {
      const dispatched = await dispatchAssistantOutboxIntent({
        dependencies: {
          sendLinq: async () => ({
            idempotencyKey: intent.deliveryIdempotencyKey,
            providerMessageId,
            providerThreadId: locator.threadId,
            target: locator.bindingDeliveryTarget,
            targetKind: 'thread',
          }),
        },
        force: true,
        intentId: intent.intentId,
        vault: fixture.vaultRoot,
      })
      expect(dispatched.intent.status).toBe('sent')
    }

    await reconcileAssistantPrivateCompletionContinuityForSession({
      allowUnbound: false,
      sessionId: fixture.detachedSession.sessionId,
      vault: fixture.vaultRoot,
    })
    await expect(listAssistantTranscriptEntries(
      fixture.vaultRoot,
      fixture.detachedSession.sessionId,
    )).resolves.toEqual([])

    const scheduled = await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: ordinaryTarget,
      defaults: null,
      message: {
        ...locator,
        executionContext: {
          hosted: {
            defaultTarget: ordinaryTarget,
            memberId: 'member_private_continuity_scheduled_repair',
            userEnvKeys: [],
          },
        },
        prompt: 'Prepare the direct continuation.',
        sessionId: fixture.ordinarySession.sessionId,
        turnTrigger,
        vault: fixture.vaultRoot,
      },
    })

    expect(scheduled.session).toMatchObject({
      codexResume: null,
      resumeState: null,
      sessionId: fixture.ordinarySession.sessionId,
      turnCount: 1,
    })
    await expect(listAssistantTranscriptEntries(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
    )).resolves.toEqual([
      expect.objectContaining({
        sourceOutboxIntentId: bound.intentId,
        text: bound.message,
      }),
    ])
    await expect(readAssistantOutboxIntent(
      fixture.vaultRoot,
      bound.intentId,
    )).resolves.toMatchObject({
      privateCompletionContinuity: { status: 'applied' },
    })
    await expect(readAssistantOutboxIntent(
      fixture.vaultRoot,
      unbound.intentId,
    )).resolves.toMatchObject({
      privateCompletionContinuitySessionId: null,
    })
    await expect(readAssistantOutboxIntent(
      fixture.vaultRoot,
      unbound.intentId,
    )).resolves.not.toHaveProperty('privateCompletionContinuity')
  })

  it('does not infer continuity ownership for a legacy intent without the binding field', async () => {
    const fixture = await createContinuityFixture('private-continuity-legacy-')
    const pending = await createPrivateCompletionIntent({
      continuitySessionId: fixture.ordinarySession.sessionId,
      deliverySession: fixture.ordinarySession,
      vault: fixture.vaultRoot,
    })
    const legacyIntent = { ...pending }
    delete legacyIntent.privateCompletionContinuitySessionId
    const persistedLegacy = await saveAssistantOutboxIntent(
      fixture.vaultRoot,
      legacyIntent,
    )

    const dispatched = await dispatchAssistantOutboxIntent({
      dependencies: {
        sendLinq: async () => ({
          idempotencyKey: persistedLegacy.deliveryIdempotencyKey,
          providerMessageId: 'provider_private_continuity_legacy',
          providerThreadId: locator.threadId,
          target: locator.bindingDeliveryTarget,
          targetKind: 'thread',
        }),
      },
      force: true,
      intentId: persistedLegacy.intentId,
      vault: fixture.vaultRoot,
    })
    expect(dispatched.intent.status).toBe('sent')
    await reconcileAssistantPrivateCompletionContinuityForSession({
      allowUnbound: true,
      sessionId: fixture.ordinarySession.sessionId,
      vault: fixture.vaultRoot,
    })

    await expect(getAssistantSession(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
    )).resolves.toMatchObject({
      codexResume: fixture.nativeResume,
      resumeState: fixture.nativeResume,
      turnCount: 0,
    })
    await expect(listAssistantTranscriptEntries(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
    )).resolves.toEqual([])
    await expect(readAssistantOutboxIntent(
      fixture.vaultRoot,
      pending.intentId,
    )).resolves.not.toHaveProperty('privateCompletionContinuity')
  })

  it('excludes ordinary direct intents from the private-completion candidate bound', async () => {
    const fixture = await createContinuityFixture(
      'private-continuity-ordinary-route-bound-',
    )
    const ordinary = await createAssistantOutboxIntent({
      actorId: locator.actorId,
      bindingDelivery: {
        kind: locator.deliveryKind,
        target: locator.bindingDeliveryTarget,
      },
      channel: locator.channel,
      deliveryIdempotencyKey: 'ordinary-direct-delivery-0',
      deliveryTransportIdempotent: true,
      identityId: locator.identityId,
      message: 'Ordinary direct reply 0.',
      sessionId: fixture.ordinarySession.sessionId,
      threadId: locator.threadId,
      threadIsDirect: true,
      turnId: 'turn_ordinary_direct_0',
      vault: fixture.vaultRoot,
    })
    const paths = resolveAssistantStatePaths(fixture.vaultRoot)
    await Promise.all(Array.from({ length: 100 }, async (_, offset) => {
      const index = offset + 1
      const suffix = index.toString().padStart(3, '0')
      const intent = {
        ...ordinary,
        dedupeKey: index.toString(16).padStart(64, '0'),
        deliveryIdempotencyKey: `ordinary-direct-delivery-${index}`,
        intentId: `outbox_ordinary_direct_${suffix}`,
        message: `Ordinary direct reply ${index}.`,
        turnId: `turn_ordinary_direct_${index}`,
      }
      await writeFile(
        path.join(paths.outboxDirectory, `${intent.intentId}.json`),
        JSON.stringify(intent),
        'utf8',
      )
    }))
    const delivered = await createDeliveredPrivateCompletion({
      continuitySessionId: fixture.ordinarySession.sessionId,
      deliverySession: fixture.ordinarySession,
      vault: fixture.vaultRoot,
    })
    await rm(path.join(paths.stateDirectory, 'outbox-dedupe.sqlite'), {
      force: true,
    })

    await expect(reconcileAssistantPrivateCompletionContinuityForSession({
      allowUnbound: true,
      sessionId: fixture.ordinarySession.sessionId,
      vault: fixture.vaultRoot,
    })).resolves.toMatchObject({
      sessionId: fixture.ordinarySession.sessionId,
      turnCount: 1,
    })

    const transcript = await listAssistantTranscriptEntries(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
    )
    expect(transcript).toEqual([
      expect.objectContaining({
        sourceOutboxIntentId: delivered.intentId,
        text: delivered.message,
      }),
    ])
    await reconcileAssistantPrivateCompletionContinuityForSession({
      allowUnbound: true,
      sessionId: fixture.ordinarySession.sessionId,
      vault: fixture.vaultRoot,
    })
    await expect(listAssistantTranscriptEntries(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
    )).resolves.toEqual(transcript)
  })

  it('fails closed above the marker-defined private-completion candidate bound', async () => {
    const fixture = await createContinuityFixture(
      'private-continuity-marker-route-bound-',
    )
    const first = await createPrivateCompletionIntent({
      completionId: 'aask_done_private_continuity_bound_0',
      continuitySessionId: fixture.ordinarySession.sessionId,
      deliverySession: fixture.ordinarySession,
      vault: fixture.vaultRoot,
    })
    const paths = resolveAssistantStatePaths(fixture.vaultRoot)
    await Promise.all(Array.from({ length: 100 }, async (_, offset) => {
      const index = offset + 1
      const suffix = index.toString().padStart(3, '0')
      const completionId = `aask_done_private_continuity_bound_${index}`
      const intent = {
        ...first,
        answeredMailboxItemIds: [completionId],
        dedupeKey: index.toString(16).padStart(64, '0'),
        deliveryIdempotencyKey:
          createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(
            completionId,
          ),
        intentId: `outbox_private_completion_bound_${suffix}`,
        turnId: `turn_private_continuity_bound_${index}`,
      }
      await writeFile(
        path.join(paths.outboxDirectory, `${intent.intentId}.json`),
        JSON.stringify(intent),
        'utf8',
      )
    }))
    await rm(path.join(paths.stateDirectory, 'outbox-dedupe.sqlite'), {
      force: true,
    })

    await expect(reconcileAssistantPrivateCompletionContinuityForSession({
      allowUnbound: true,
      sessionId: fixture.ordinarySession.sessionId,
      vault: fixture.vaultRoot,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_PRIVATE_COMPLETION_ROUTE_BOUND_EXCEEDED',
    })
  })

  it('recovers a prepared partial write without duplicating transcript or turn count', async () => {
    const fixture = await createContinuityFixture('private-continuity-recovery-')
    const delivered = await createDeliveredPrivateCompletion({
      continuitySessionId: fixture.ordinarySession.sessionId,
      deliverySession: fixture.ordinarySession,
      vault: fixture.vaultRoot,
    })
    const transcriptCreatedAt = delivered.delivery!.sentAt
    const prepared = await saveAssistantOutboxIntent(fixture.vaultRoot, {
      ...delivered,
      privateCompletionContinuity: {
        baseTurnCount: 0,
        preparedAt: '2026-08-11T18:00:01.000Z',
        sessionId: fixture.ordinarySession.sessionId,
        status: 'prepared',
        transcriptCreatedAt,
      },
    })
    await saveAssistantSession(fixture.vaultRoot, {
      ...fixture.ordinarySession,
      codexResume: null,
      lastTurnAt: transcriptCreatedAt,
      resumeState: null,
      turnCount: 1,
      updatedAt: '2026-08-11T18:00:02.000Z',
    })
    await appendAssistantTranscriptEntries(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
      [{
        createdAt: transcriptCreatedAt,
        kind: 'assistant',
        sourceOutboxIntentId: prepared.intentId,
        text: prepared.message,
      }],
    )

    await reconcileAssistantPrivateCompletionContinuityForSession({
      allowUnbound: true,
      sessionId: fixture.ordinarySession.sessionId,
      vault: fixture.vaultRoot,
    })
    await reconcileAssistantPrivateCompletionContinuityForSession({
      allowUnbound: true,
      sessionId: fixture.ordinarySession.sessionId,
      vault: fixture.vaultRoot,
    })

    const session = await getAssistantSession(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
    )
    expect(session.turnCount).toBe(1)
    await expect(listAssistantTranscriptEntries(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
    )).resolves.toHaveLength(1)
    await expect(readAssistantOutboxIntent(
      fixture.vaultRoot,
      delivered.intentId,
    )).resolves.toMatchObject({
      privateCompletionContinuity: { status: 'applied' },
    })
  })

  it('finishes a prepared import when the session write won but transcript append did not', async () => {
    const fixture = await createContinuityFixture(
      'private-continuity-partial-session-',
    )
    const delivered = await createDeliveredPrivateCompletion({
      continuitySessionId: fixture.ordinarySession.sessionId,
      deliverySession: fixture.ordinarySession,
      vault: fixture.vaultRoot,
    })
    const transcriptCreatedAt = delivered.delivery!.sentAt
    await saveAssistantOutboxIntent(fixture.vaultRoot, {
      ...delivered,
      privateCompletionContinuity: {
        baseTurnCount: 0,
        preparedAt: '2026-08-11T18:00:01.000Z',
        sessionId: fixture.ordinarySession.sessionId,
        status: 'prepared',
        transcriptCreatedAt,
      },
    })
    await saveAssistantSession(fixture.vaultRoot, {
      ...fixture.ordinarySession,
      codexResume: null,
      lastTurnAt: transcriptCreatedAt,
      resumeState: null,
      turnCount: 1,
      updatedAt: '2026-08-11T18:00:02.000Z',
    })

    await reconcileAssistantPrivateCompletionContinuityForSession({
      allowUnbound: true,
      sessionId: fixture.ordinarySession.sessionId,
      vault: fixture.vaultRoot,
    })

    const session = await getAssistantSession(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
    )
    expect(session.turnCount).toBe(1)
    await expect(listAssistantTranscriptEntries(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
    )).resolves.toEqual([
      expect.objectContaining({
        sourceOutboxIntentId: delivered.intentId,
        text: delivered.message,
      }),
    ])
    await expect(readAssistantOutboxIntent(
      fixture.vaultRoot,
      delivered.intentId,
    )).resolves.toMatchObject({
      privateCompletionContinuity: { status: 'applied' },
    })
  })

  it('joins a delivered completion before the first attended direct provider resume', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'private-continuity-first-direct-',
    )
    cleanupPaths.push(parentRoot)
    const detachedSession = (await resolveAssistantSession({
      ...locator,
      target: detachedTarget,
      vault: vaultRoot,
    })).session
    const delivered = await createDeliveredPrivateCompletion({
      continuitySessionId: null,
      deliverySession: detachedSession,
      vault: vaultRoot,
    })

    await persistAssistantPrivateCompletionContinuityAfterDelivery({
      intent: delivered,
      vault: vaultRoot,
    })
    const attended = await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: ordinaryTarget,
      defaults: null,
      message: {
        ...locator,
        executionContext: {
          hosted: {
            defaultTarget: ordinaryTarget,
            memberId: 'member_private_continuity',
            userEnvKeys: [],
          },
        },
        prompt: 'Continue the private conversation.',
        userMessageContent: [{
          text: 'Continue the private conversation.',
          type: 'text',
        }],
        vault: vaultRoot,
      },
    })

    expect(attended.session.sessionId).not.toBe(detachedSession.sessionId)
    expect(attended.session).toMatchObject({
      codexResume: null,
      resumeState: null,
      turnCount: 1,
    })
    await expect(listAssistantTranscriptEntries(
      vaultRoot,
      attended.session.sessionId,
    )).resolves.toEqual([
      expect.objectContaining({
        sourceOutboxIntentId: delivered.intentId,
        text: delivered.message,
      }),
    ])
  })

  it('retains a sent unbound completion until the first attended direct import', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'private-continuity-sent-unbound-',
    )
    cleanupPaths.push(parentRoot)
    const detachedSession = (await resolveAssistantSession({
      ...locator,
      target: detachedTarget,
      vault: vaultRoot,
    })).session
    const pending = await createPrivateCompletionIntent({
      continuitySessionId: null,
      deliverySession: detachedSession,
      vault: vaultRoot,
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      dependencies: {
        sendLinq: async () => ({
          idempotencyKey: pending.deliveryIdempotencyKey,
          providerMessageId: 'provider_private_continuity_unbound',
          providerThreadId: locator.threadId,
          target: locator.bindingDeliveryTarget,
          targetKind: 'thread',
        }),
      },
      force: true,
      intentId: pending.intentId,
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('sent')
    await expect(pruneAssistantTerminalOutboxIntents({
      now: new Date('2100-01-01T00:00:00.000Z'),
      paths: resolveAssistantStatePaths(vaultRoot),
      vault: vaultRoot,
    })).resolves.toBe(0)

    const attended = await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: ordinaryTarget,
      defaults: null,
      message: {
        ...locator,
        executionContext: {
          hosted: {
            defaultTarget: ordinaryTarget,
            memberId: 'member_private_continuity_retention',
            userEnvKeys: [],
          },
        },
        prompt: 'Continue after the retained private reply.',
        vault: vaultRoot,
      },
    })

    await expect(listAssistantTranscriptEntries(
      vaultRoot,
      attended.session.sessionId,
    )).resolves.toEqual([
      expect.objectContaining({
        sourceOutboxIntentId: pending.intentId,
        text: pending.message,
      }),
    ])
    await expect(readAssistantOutboxIntent(
      vaultRoot,
      pending.intentId,
    )).resolves.toMatchObject({
      privateCompletionContinuity: { status: 'applied' },
      status: 'sent',
    })
    await expect(pruneAssistantTerminalOutboxIntents({
      now: new Date('2100-01-01T00:01:00.000Z'),
      paths: resolveAssistantStatePaths(vaultRoot),
      vault: vaultRoot,
    })).resolves.toBe(1)
    await expect(readAssistantOutboxIntent(
      vaultRoot,
      pending.intentId,
    )).resolves.toBeNull()
  })

  it('recovers multiple unbound completions in canonical delivery order', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-11T18:00:00.000Z'))
    const fixture = await createContinuityFixture(
      'private-continuity-delivery-order-',
    )
    const earlierIntent = await createPrivateCompletionIntent({
      completionId: 'aask_done_private_continuity_order_earlier',
      continuitySessionId: null,
      createdAt: '2026-08-11T18:00:00.000Z',
      deliverySession: fixture.detachedSession,
      message: 'Delivered after the other completion.',
      turnId: 'turn_private_continuity_order_earlier',
      vault: fixture.vaultRoot,
    })
    const laterIntent = await createPrivateCompletionIntent({
      completionId: 'aask_done_private_continuity_order_later',
      continuitySessionId: null,
      createdAt: '2026-08-11T18:00:01.000Z',
      deliverySession: fixture.detachedSession,
      message: 'Delivered before the other completion.',
      turnId: 'turn_private_continuity_order_later',
      vault: fixture.vaultRoot,
    })

    vi.setSystemTime(new Date('2026-08-11T18:01:00.000Z'))
    const retryable = await dispatchAssistantOutboxIntent({
      dependencies: {
        sendLinq: async () => {
          throw Object.assign(new Error('Temporary synthetic provider failure.'), {
            code: 'LINQ_API_REQUEST_FAILED',
            retryable: true,
          })
        },
      },
      force: true,
      intentId: earlierIntent.intentId,
      vault: fixture.vaultRoot,
    })
    expect(retryable.intent.status).toBe('retryable')

    vi.setSystemTime(new Date('2026-08-11T18:02:00.000Z'))
    const deliveredFirst = await dispatchAssistantOutboxIntent({
      dependencies: {
        sendLinq: async () => ({
          idempotencyKey: laterIntent.deliveryIdempotencyKey,
          providerMessageId: 'provider_private_continuity_order_first',
          providerThreadId: locator.threadId,
          target: locator.bindingDeliveryTarget,
          targetKind: 'thread',
        }),
      },
      force: true,
      intentId: laterIntent.intentId,
      vault: fixture.vaultRoot,
    })
    expect(deliveredFirst.intent.status).toBe('sent')

    vi.setSystemTime(new Date('2026-08-11T18:03:00.000Z'))
    const deliveredSecond = await dispatchAssistantOutboxIntent({
      dependencies: {
        sendLinq: async () => ({
          idempotencyKey: earlierIntent.deliveryIdempotencyKey,
          providerMessageId: 'provider_private_continuity_order_second',
          providerThreadId: locator.threadId,
          target: locator.bindingDeliveryTarget,
          targetKind: 'thread',
        }),
      },
      force: true,
      intentId: earlierIntent.intentId,
      vault: fixture.vaultRoot,
    })
    expect(deliveredSecond.intent.status).toBe('sent')

    vi.setSystemTime(new Date('2026-08-11T18:04:00.000Z'))
    const attended = await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: ordinaryTarget,
      defaults: null,
      message: {
        ...locator,
        executionContext: {
          hosted: {
            defaultTarget: ordinaryTarget,
            memberId: 'member_private_continuity_order',
            userEnvKeys: [],
          },
        },
        prompt: 'Continue after both private replies.',
        vault: fixture.vaultRoot,
      },
    })

    expect(attended.session).toMatchObject({
      codexResume: null,
      resumeState: null,
      turnCount: 2,
    })
    expect(attended.session.sessionId).not.toBe(fixture.detachedSession.sessionId)
    const transcript = await listAssistantTranscriptEntries(
      fixture.vaultRoot,
      attended.session.sessionId,
    )
    expect(transcript).toEqual([
      expect.objectContaining({
        createdAt: '2026-08-11T18:02:00.000Z',
        sourceOutboxIntentId: laterIntent.intentId,
        text: laterIntent.message,
      }),
      expect.objectContaining({
        createdAt: '2026-08-11T18:03:00.000Z',
        sourceOutboxIntentId: earlierIntent.intentId,
        text: earlierIntent.message,
      }),
    ])
    await expect(readAssistantOutboxIntent(
      fixture.vaultRoot,
      laterIntent.intentId,
    )).resolves.toMatchObject({
      privateCompletionContinuity: { status: 'applied' },
    })
    await expect(readAssistantOutboxIntent(
      fixture.vaultRoot,
      earlierIntent.intentId,
    )).resolves.toMatchObject({
      privateCompletionContinuity: { status: 'applied' },
    })

    await reconcileAssistantPrivateCompletionContinuityForSession({
      allowUnbound: true,
      sessionId: attended.session.sessionId,
      vault: fixture.vaultRoot,
    })
    await expect(listAssistantTranscriptEntries(
      fixture.vaultRoot,
      attended.session.sessionId,
    )).resolves.toEqual(transcript)
    await expect(getAssistantSession(
      fixture.vaultRoot,
      attended.session.sessionId,
    )).resolves.toMatchObject({ turnCount: 2 })
  })
})

async function createContinuityFixture(
  prefix: string,
  route: ContinuityLocator = locator,
): Promise<{
  detachedSession: AssistantSession
  nativeResume: NonNullable<AssistantSession['codexResume']>
  ordinarySession: AssistantSession
  vaultRoot: string
}> {
  const fixture = await createBoundContinuityFixture(prefix, route)
  const detachedSession = (await resolveAssistantSession({
    ...route,
    target: detachedTarget,
    vault: fixture.vaultRoot,
  })).session
  return { ...fixture, detachedSession }
}

async function createBoundContinuityFixture(
  prefix: string,
  route: ContinuityLocator = locator,
): Promise<{
  nativeResume: NonNullable<AssistantSession['codexResume']>
  ordinarySession: AssistantSession
  vaultRoot: string
}> {
  const { parentRoot, vaultRoot } = await createTempVaultContext(prefix)
  cleanupPaths.push(parentRoot)
  const ordinary = await resolveAssistantSession({
    ...route,
    target: ordinaryTarget,
    vault: vaultRoot,
  })
  const nativeResume: NonNullable<AssistantSession['codexResume']> = {
    assistantContractFingerprint: 'a'.repeat(64),
    routeFingerprint: 'b'.repeat(64),
    threadCompatibilityFingerprint: 'c'.repeat(64),
    threadId: 'thread_private_continuity',
  }
  const ordinarySession = await saveAssistantSession(vaultRoot, {
    ...ordinary.session,
    codexResume: nativeResume,
    resumeState: nativeResume,
  })
  return { nativeResume, ordinarySession, vaultRoot }
}

async function createPrivateCompletionIntent(input: {
  completionId?: string
  continuitySessionId: string | null
  createdAt?: string
  deliverySession: AssistantSession
  message?: string
  route?: ContinuityLocator
  turnId?: string
  vault: string
}): Promise<AssistantOutboxIntent> {
  const route = input.route ?? locator
  const completionId = input.completionId ?? 'aask_done_private_continuity_test'
  const deliveryKey =
    createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(completionId)
  return await createAssistantOutboxIntent({
    actorId: route.actorId,
    answeredMailboxItemIds: [completionId],
    bindingDelivery: {
      kind: route.deliveryKind,
      target: route.bindingDeliveryTarget,
    },
    channel: route.channel,
    createdAt: input.createdAt,
    deliveryIdempotencyKey: deliveryKey,
    deliveryTransportIdempotent: true,
    identityId: route.identityId,
    message: input.message ?? 'Exact private completion.',
    privateCompletionContinuitySessionId: input.continuitySessionId,
    reviewedAssistantAskCompletionExpiresAt: '2099-08-11T18:05:00.000Z',
    sessionId: input.deliverySession.sessionId,
    threadId: route.threadId,
    threadIsDirect: route.threadIsDirect,
    turnId: input.turnId ?? 'turn_private_continuity_test',
    vault: input.vault,
  })
}

async function createDeliveredPrivateCompletion(input: {
  continuitySessionId: string | null
  deliverySession: AssistantSession
  route?: ContinuityLocator
  vault: string
}): Promise<AssistantOutboxIntent> {
  const route = input.route ?? locator
  const intent = await createPrivateCompletionIntent(input)
  const delivery = assistantChannelDeliverySchema.parse({
    channel: route.channel,
    idempotencyKey: intent.deliveryIdempotencyKey,
    kind: 'message',
    messageLength: intent.message.length,
    providerMessageId: 'provider_private_continuity',
    providerThreadId: null,
    sentAt: '2026-08-11T18:00:00.000Z',
    target: route.bindingDeliveryTarget,
    targetKind: 'thread',
  })
  return await saveAssistantOutboxIntent(input.vault, {
    ...intent,
    delivery,
    deliveryConfirmationPending: false,
    sentAt: delivery.sentAt,
    status: 'sent',
  })
}
