import { rm } from 'node:fs/promises'

import {
  createHostedExecutionPrivateAssistantAskCompletionDeliveryKey,
} from '@murphai/hosted-execution/assistant-identifiers'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import {
  assistantChannelDeliverySchema,
  type AssistantOutboxIntent,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import { afterEach, describe, expect, it } from 'vitest'

import {
  persistAssistantPrivateCompletionContinuityAfterDelivery,
  reconcileAssistantPrivateCompletionContinuityForSession,
} from '../src/assistant/private-completion-continuity.ts'
import {
  createAssistantOutboxIntent,
  readAssistantOutboxIntent,
  saveAssistantOutboxIntent,
} from '../src/assistant/outbox.ts'
import { resolveAssistantSessionForMessage } from '../src/assistant/session-resolution.ts'
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
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, { force: true, recursive: true })
  ))
})

describe('private completion continuity', () => {
  it('leaves the ordinary session untouched when delivery authority rejects before provider entry', async () => {
    const fixture = await createContinuityFixture('private-continuity-rejected-')
    const pending = await createPrivateCompletionIntent({
      detachedSession: fixture.detachedSession,
      vault: fixture.vaultRoot,
    })

    await reconcileAssistantPrivateCompletionContinuityForSession({
      sessionId: fixture.ordinarySession.sessionId,
      vault: fixture.vaultRoot,
    })

    const session = await getAssistantSession(
      fixture.vaultRoot,
      fixture.ordinarySession.sessionId,
    )
    expect(pending.delivery).toBeNull()
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

  it('imports a provider-accepted completion exactly once and clears native resume', async () => {
    const fixture = await createContinuityFixture('private-continuity-delivered-')
    const delivered = await createDeliveredPrivateCompletion({
      detachedSession: fixture.detachedSession,
      vault: fixture.vaultRoot,
    })

    await persistAssistantPrivateCompletionContinuityAfterDelivery({
      intent: delivered,
      vault: fixture.vaultRoot,
    })
    await reconcileAssistantPrivateCompletionContinuityForSession({
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

  it('recovers a prepared partial write without duplicating transcript or turn count', async () => {
    const fixture = await createContinuityFixture('private-continuity-recovery-')
    const delivered = await createDeliveredPrivateCompletion({
      detachedSession: fixture.detachedSession,
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
      sessionId: fixture.ordinarySession.sessionId,
      vault: fixture.vaultRoot,
    })
    await reconcileAssistantPrivateCompletionContinuityForSession({
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
      detachedSession: fixture.detachedSession,
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
      detachedSession,
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
})

async function createContinuityFixture(prefix: string): Promise<{
  detachedSession: AssistantSession
  nativeResume: NonNullable<AssistantSession['codexResume']>
  ordinarySession: AssistantSession
  vaultRoot: string
}> {
  const { parentRoot, vaultRoot } = await createTempVaultContext(prefix)
  cleanupPaths.push(parentRoot)
  const ordinary = await resolveAssistantSession({
    ...locator,
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
  const detachedSession = (await resolveAssistantSession({
    ...locator,
    target: detachedTarget,
    vault: vaultRoot,
  })).session
  return { detachedSession, nativeResume, ordinarySession, vaultRoot }
}

async function createPrivateCompletionIntent(input: {
  detachedSession: AssistantSession
  vault: string
}): Promise<AssistantOutboxIntent> {
  const completionId = 'aask_done_private_continuity_test'
  const deliveryKey =
    createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(completionId)
  return await createAssistantOutboxIntent({
    actorId: locator.actorId,
    answeredMailboxItemIds: [completionId],
    bindingDelivery: {
      kind: locator.deliveryKind,
      target: locator.bindingDeliveryTarget,
    },
    channel: locator.channel,
    deliveryIdempotencyKey: deliveryKey,
    deliveryTransportIdempotent: true,
    identityId: locator.identityId,
    message: 'Exact private completion.',
    reviewedAssistantAskCompletionExpiresAt: '2099-08-11T18:05:00.000Z',
    sessionId: input.detachedSession.sessionId,
    threadId: locator.threadId,
    threadIsDirect: true,
    turnId: 'turn_private_continuity_test',
    vault: input.vault,
  })
}

async function createDeliveredPrivateCompletion(input: {
  detachedSession: AssistantSession
  vault: string
}): Promise<AssistantOutboxIntent> {
  const intent = await createPrivateCompletionIntent(input)
  const delivery = assistantChannelDeliverySchema.parse({
    channel: locator.channel,
    idempotencyKey: intent.deliveryIdempotencyKey,
    kind: 'message',
    messageLength: intent.message.length,
    providerMessageId: 'provider_private_continuity',
    providerThreadId: null,
    sentAt: '2026-08-11T18:00:00.000Z',
    target: locator.bindingDeliveryTarget,
    targetKind: 'thread',
  })
  return await saveAssistantOutboxIntent(input.vault, {
    ...intent,
    delivery,
    deliveryConfirmationPending: true,
    status: 'sending',
  })
}
