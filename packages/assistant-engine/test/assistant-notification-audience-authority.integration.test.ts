import { rm } from 'node:fs/promises'

import {
  createHostedExecutionPrivateAssistantAskCompletionDeliveryKey,
} from '@murphai/hosted-execution/assistant-identifiers'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import type { executeCodexTurnWithRecovery } from '../src/assistant/codex-turn-runner.ts'
import {
  readCodexThreadCompatibilityFingerprint,
  readCodexThreadRouteFingerprint,
} from '../src/assistant/codex-thread-route.ts'
import { resolveAssistantExecutionPlan } from '../src/assistant/execution-plan.ts'
import type { persistAssistantTurnAndSession } from '../src/assistant/turn-finalizer.ts'
import { sendAssistantNotificationLocal } from '../src/assistant/notification-turn.ts'
import { resolveAssistantSessionForMessage } from '../src/assistant/session-resolution.ts'
import {
  appendAssistantTranscriptEntries,
  listAssistantSessions,
  listAssistantTranscriptEntries,
  resolveAssistantSession,
  saveAssistantSession,
} from '../src/assistant/store.ts'
import { createTempVaultContext } from './test-helpers.ts'

const boundaries = vi.hoisted(() => ({
  appendTranscript: vi.fn(),
  createReceipt: vi.fn(),
  deliverMessage: vi.fn(),
  executeProvider: vi.fn<typeof executeCodexTurnWithRecovery>(),
  finalizeReceipt: vi.fn(),
  persistTurn: vi.fn<typeof persistAssistantTurnAndSession>(),
  recordDiagnostic: vi.fn(),
  recordUsage: vi.fn(),
  refreshStatus: vi.fn(),
  resolveDefaults: vi.fn(),
  saveSession: vi.fn(),
  startLinqTyping: vi.fn(),
}))

vi.mock('@murphai/operator-config/operator-config', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@murphai/operator-config/operator-config')
  >()
  return {
    ...actual,
    resolveAssistantOperatorDefaults: boundaries.resolveDefaults,
  }
})

vi.mock('../src/assistant/codex-turn-runner.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../src/assistant/codex-turn-runner.ts')
  >()
  return {
    ...actual,
    executeCodexTurnWithRecovery: boundaries.executeProvider,
  }
})

vi.mock('../src/assistant/runtime-state-service.js', () => ({
  createAssistantRuntimeStateService: () => ({
    diagnostics: {
      recordEvent: boundaries.recordDiagnostic,
    },
    outbox: {
      deliverMessage: boundaries.deliverMessage,
    },
    sessions: {
      save: boundaries.saveSession,
    },
    status: {
      refreshSnapshot: boundaries.refreshStatus,
    },
    transcripts: {
      append: boundaries.appendTranscript,
    },
    turns: {
      createReceipt: boundaries.createReceipt,
      finalizeReceipt: boundaries.finalizeReceipt,
    },
  }),
}))

vi.mock('../src/assistant/service-usage.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../src/assistant/service-usage.ts')
  >()
  return {
    ...actual,
    recordAdditionalAssistantUsageEvents: boundaries.recordUsage,
    recordAssistantUsageEvent: boundaries.recordUsage,
  }
})

vi.mock('../src/assistant/turn-finalizer.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../src/assistant/turn-finalizer.ts')
  >()
  return {
    ...actual,
    persistAssistantTurnAndSession: boundaries.persistTurn,
  }
})

const cleanupPaths: string[] = []
const opaqueLocator = {
  actorId: 'h1_111111111111111111111111',
  identityId: 'h1_222222222222222222222222',
  threadId: 'h1_333333333333333333333333',
}
const modelTarget = createAssistantModelTarget({
  provider: 'codex-cli',
  approvalPolicy: 'never',
  model: 'gpt-5.6-terra',
  modelProvider: 'vercel-ai-gateway',
  reasoningEffort: 'medium',
  sandbox: 'danger-full-access',
})

if (!modelTarget) {
  throw new Error('Expected a test assistant model target.')
}

beforeEach(() => {
  vi.clearAllMocks()
  boundaries.resolveDefaults.mockResolvedValue({
    backend: null,
    identityId: null,
    selfDeliveryTargets: null,
  })
  boundaries.startLinqTyping.mockResolvedValue(null)
  boundaries.recordDiagnostic.mockResolvedValue(undefined)
  boundaries.recordUsage.mockResolvedValue(undefined)
  boundaries.refreshStatus.mockResolvedValue(undefined)
  boundaries.createReceipt.mockResolvedValue(undefined)
  boundaries.finalizeReceipt.mockResolvedValue(undefined)
  boundaries.appendTranscript.mockResolvedValue([])
  boundaries.saveSession.mockImplementation(async (session: AssistantSession) => session)
  boundaries.persistTurn.mockImplementation(async (input) => input.session)
  boundaries.deliverMessage.mockImplementation(async (input) => ({
    delivery: {
      channel: 'linq',
      idempotencyKey: input.deliveryIdempotencyKey ?? null,
      messageId: 'linq-message-1',
      sentAt: '2026-07-14T12:30:00.000Z',
      target: input.explicitTarget ?? input.bindingDelivery?.target ?? 'missing-target',
      targetKind: 'explicit' as const,
    },
    intent: {
      intentId: 'intent-authorized-audience',
    },
    kind: 'sent' as const,
    session: null,
  }))
  boundaries.executeProvider.mockImplementation(async (input) => ({
    kind: 'succeeded',
    providerTurn: {
      assistantContractFingerprint:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      attemptCount: 1,
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
      codexThreadId: null,
      provider: input.route.provider,
      providerOptions: input.route.providerOptions,
      rawEvents: [],
      response: JSON.stringify({
        kind: 'send_message',
        privateSummary: 'Scheduled update prepared.',
        text: 'Authorized scheduled update.',
      }),
      responseDeliveryContextOrdinal: 0,
      responseMedia: [],
      route: input.route,
      session: input.resolvedSession,
      stderr: '',
      stdout: '',
      transcriptResponse: JSON.stringify({
        kind: 'send_message',
        privateSummary: 'Scheduled update prepared.',
        text: 'Authorized scheduled update.',
      }),
      usage: null,
      workingDirectory: input.plan.requestedWorkingDirectory,
    },
  }))
})

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('notification audience authority integration', () => {
  it.each([
    {
      label: 'direct',
      target: 'linq-direct-chat',
      threadIsDirect: true,
    },
    {
      label: 'group',
      target: 'linq-group-chat',
      threadIsDirect: false,
    },
  ])('carries an authoritative $label Linq tuple through the real policy guard', async ({
    target,
    threadIsDirect,
  }) => {
    const context = await createPersistedLegacyContext('authorized-audience-')

    const result = await sendNotification({
      context,
      bindingDeliveryTarget: target,
      deliveryTarget: target,
      threadIsDirect,
    })

    expect(result.deliveryOutcome?.kind).toBe('sent')
    expect(boundaries.executeProvider).toHaveBeenCalledTimes(1)
    const providerInput = boundaries.executeProvider.mock.calls[0]?.[0]
    expect(providerInput?.route.providerOptions.sandbox).toBe('read-only')
    expect(providerInput?.plan.conversationPolicy.audience).toMatchObject({
      effectiveThreadIsDirect: threadIsDirect,
      explicitTarget: target,
      threadIsDirect,
    })
    expect(boundaries.deliverMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'linq',
        explicitTarget: target,
        threadIsDirect,
      }),
    )
  })

  it('rejects an unknown Linq audience before provider work', async () => {
    const context = await createPersistedLegacyContext('unknown-audience-')

    await expect(sendNotification({
      context,
      deliveryTarget: 'linq-unknown-chat',
      threadIsDirect: null,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_AUDIENCE_UNVERIFIED',
    })

    expect(boundaries.executeProvider).not.toHaveBeenCalled()
    expect(boundaries.deliverMessage).not.toHaveBeenCalled()
  })

  it('rejects an explicit direct Linq target without exact binding proof', async () => {
    const context = await createPersistedLegacyContext('direct-unverified-audience-')

    await expect(sendNotification({
      context,
      deliveryTarget: 'linq-direct-unverified-chat',
      threadIsDirect: true,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_AUDIENCE_UNVERIFIED',
    })

    expect(boundaries.executeProvider).not.toHaveBeenCalled()
    expect(boundaries.deliverMessage).not.toHaveBeenCalled()
  })

  it('does not let a direct session authorize a different explicit target', async () => {
    const context = await createPersistedLegacyContext('mismatched-audience-')
    const storedTarget = 'linq-stored-direct-chat'
    await sendNotification({
      context,
      bindingDeliveryTarget: storedTarget,
      deliveryTarget: storedTarget,
      threadIsDirect: true,
    })
    vi.clearAllMocks()

    await expect(sendNotification({
      context,
      bindingDeliveryTarget: storedTarget,
      deliveryTarget: 'linq-different-chat',
      threadIsDirect: true,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_AUDIENCE_UNVERIFIED',
    })

    expect(boundaries.executeProvider).not.toHaveBeenCalled()
    expect(boundaries.deliverMessage).not.toHaveBeenCalled()
  })

  it('rejects unknown exact text before deterministic delivery', async () => {
    const context = await createPersistedLegacyContext('unknown-exact-audience-')

    await expect(sendNotification({
      context,
      deliveryTarget: 'linq-unknown-exact-chat',
      responsePolicy: {
        kind: 'require_send_exact_text',
        text: 'Scheduled exact text.',
      },
      threadIsDirect: null,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_AUDIENCE_UNVERIFIED',
    })

    expect(boundaries.executeProvider).not.toHaveBeenCalled()
    expect(boundaries.deliverMessage).not.toHaveBeenCalled()
  })

  it('keeps unrelated exact text with only reviewed expiry on a detached session', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'linq-exact-detached-session-',
    )
    cleanupPaths.push(parentRoot)
    const locator = {
      actorId: 'h1_777777777777777777777777',
      channel: 'linq',
      identityId: 'h1_888888888888888888888888',
      threadId: 'h1_999999999999999999999999',
      threadIsDirect: true,
    } as const
    const executionContext = {
      hosted: {
        defaultTarget: modelTarget,
        memberId: 'member-exact-detached',
        userEnvKeys: [],
      },
    } as const

    const notification = await sendAssistantNotificationLocal({
      ...locator,
      bindingDeliveryTarget: locator.threadId,
      deliveryIdempotencyKey: 'group-join:member-exact-detached',
      deliveryKind: 'thread',
      deliveryTarget: locator.threadId,
      executionContext,
      instructions: 'Send the exact group confirmation.',
      responsePolicy: {
        kind: 'require_send_exact_text',
        text: 'You joined the group.',
      },
      reviewedAssistantAskCompletionExpiresAt: '2099-01-01T00:00:00.000Z',
      vault: vaultRoot,
    })

    expect(boundaries.executeProvider).not.toHaveBeenCalled()
    expect(notification.session.providerOptions.sandbox).toBe('read-only')

    const attended = await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: modelTarget,
      defaults: null,
      message: {
        ...locator,
        executionContext,
        prompt: 'What did I miss?',
        vault: vaultRoot,
      },
    })

    expect(attended.created).toBe(true)
    expect(attended.session.sessionId).not.toBe(notification.session.sessionId)
    expect(attended.session.providerOptions.sandbox).toBe('danger-full-access')
  })

  it('keeps a reviewed private exact completion on the ordinary direct session and invalidates native resume', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'linq-private-completion-continuity-',
    )
    cleanupPaths.push(parentRoot)
    const completionText = 'Here is the reviewed private answer.'
    const completionEventId = 'aask_done_private_completion_continuity'
    const deliveryKey =
      createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(
        completionEventId,
      )
    const reviewedExpiresAt = '2099-01-01T00:00:00.000Z'
    const locator = {
      actorId: 'h1_aaaaaaaaaaaaaaaaaaaaaaaa',
      channel: 'linq',
      identityId: 'h1_bbbbbbbbbbbbbbbbbbbbbbbb',
      threadId: 'h1_cccccccccccccccccccccccc',
      threadIsDirect: true,
    } as const
    const executionContext = {
      hosted: {
        defaultTarget: modelTarget,
        memberId: 'member-private-completion-continuity',
        userEnvKeys: [],
      },
    } as const
    const ordinary = await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: modelTarget,
      defaults: null,
      message: {
        ...locator,
        executionContext,
        prompt: 'Start the ordinary direct conversation.',
        vault: vaultRoot,
      },
    })
    const ordinaryRoute = resolveAssistantExecutionPlan({
      defaults: null,
      sessionTarget: ordinary.session.target,
    }).codexRoute
    const nativeResume: NonNullable<AssistantSession['codexResume']> = {
      assistantContractFingerprint: 'a'.repeat(64),
      routeFingerprint: readCodexThreadRouteFingerprint(ordinaryRoute),
      threadCompatibilityFingerprint:
        readCodexThreadCompatibilityFingerprint(ordinaryRoute),
      threadId: 'thread-private-completion-continuity',
    }
    const ordinaryWithResume = await saveAssistantSession(vaultRoot, {
      ...ordinary.session,
      codexResume: nativeResume,
      resumeState: nativeResume,
    })
    const ordinaryContinuityFingerprint =
      ordinaryWithResume.providerOptions.continuityFingerprint
    expect(ordinary.created).toBe(true)
    expect(ordinaryContinuityFingerprint).toEqual(expect.any(String))
    expect(ordinaryWithResume.codexResume).toEqual(nativeResume)
    expect(ordinaryWithResume.resumeState).toEqual(nativeResume)

    boundaries.appendTranscript.mockImplementation(
      async (
        sessionId: string,
        entries: Parameters<typeof appendAssistantTranscriptEntries>[2],
      ) => await appendAssistantTranscriptEntries(vaultRoot, sessionId, entries),
    )
    boundaries.saveSession.mockImplementation(
      async (session: AssistantSession) =>
        await saveAssistantSession(vaultRoot, session),
    )
    boundaries.deliverMessage.mockResolvedValueOnce({
      delivery: null,
      deliveryError: null,
      intent: {
        intentId: 'intent-private-completion-continuity',
      },
      kind: 'queued',
      session: null,
    })

    const completion = await sendAssistantNotificationLocal({
      ...locator,
      answeredMailboxItemIds: [completionEventId],
      bindingDeliveryTarget: locator.threadId,
      deliveryDedupeToken: deliveryKey,
      deliveryDispatchMode: 'queue-only',
      deliveryIdempotencyKey: deliveryKey,
      deliveryKind: 'thread',
      deliveryTarget: locator.threadId,
      executionContext,
      instructions: 'Deliver the reviewed private Assistant Ask answer exactly.',
      responsePolicy: {
        kind: 'require_send_exact_text',
        text: completionText,
      },
      reviewedAssistantAskCompletionExpiresAt: reviewedExpiresAt,
      vault: vaultRoot,
    })

    expect(boundaries.executeProvider).not.toHaveBeenCalled()
    expect(boundaries.deliverMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        answeredMailboxItemIds: [completionEventId],
        dedupeToken: deliveryKey,
        dispatchMode: 'queue-only',
        message: completionText,
        reviewedAssistantAskCompletionExpiresAt: reviewedExpiresAt,
      }),
    )
    expect(completion.deliveryOutcome?.kind).toBe('queued')
    expect(completion.session.sessionId).toBe(ordinaryWithResume.sessionId)
    expect(completion.session.providerOptions.continuityFingerprint).toBe(
      ordinaryContinuityFingerprint,
    )
    expect(completion.session.providerOptions.sandbox).toBe('danger-full-access')
    expect(completion.session.codexResume).toBeNull()
    expect(completion.session.resumeState).toBeNull()
    expect(boundaries.saveSession).toHaveBeenCalledTimes(1)
    expect(boundaries.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        codexResume: null,
        resumeState: null,
        sessionId: ordinaryWithResume.sessionId,
      }),
    )
    await expect(
      listAssistantTranscriptEntries(vaultRoot, ordinaryWithResume.sessionId),
    ).resolves.toEqual([
      expect.objectContaining({
        kind: 'assistant',
        text: completionText,
      }),
    ])
    await expect(listAssistantSessions(vaultRoot)).resolves.toEqual([
      expect.objectContaining({
        codexResume: null,
        providerOptions: expect.objectContaining({
          continuityFingerprint: ordinaryContinuityFingerprint,
        }),
        resumeState: null,
        sessionId: ordinaryWithResume.sessionId,
      }),
    ])

    const nextOrdinary = await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: modelTarget,
      defaults: null,
      message: {
        ...locator,
        executionContext,
        prompt: 'Continue the ordinary direct conversation.',
        vault: vaultRoot,
      },
    })

    expect(nextOrdinary.created).toBe(false)
    expect(nextOrdinary.session.sessionId).toBe(ordinaryWithResume.sessionId)
    expect(nextOrdinary.session.providerOptions.continuityFingerprint).toBe(
      ordinaryContinuityFingerprint,
    )
    expect(nextOrdinary.session.codexResume).toBeNull()
    expect(nextOrdinary.session.resumeState).toBeNull()
    await expect(listAssistantSessions(vaultRoot)).resolves.toHaveLength(1)
  })

  it('keeps an exact Telegram welcome on the attended conversation session', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'telegram-exact-welcome-continuity-',
    )
    cleanupPaths.push(parentRoot)
    const welcomeText = 'Welcome to Murph.'
    const locator = {
      actorId: 'h1_444444444444444444444444',
      channel: 'telegram',
      identityId: 'h1_555555555555555555555555',
      threadId: 'h1_666666666666666666666666',
      threadIsDirect: true,
    } as const
    const executionContext = {
      hosted: {
        defaultTarget: modelTarget,
        memberId: 'member-exact-welcome',
        userEnvKeys: [],
      },
    } as const

    const welcome = await sendAssistantNotificationLocal({
      ...locator,
      bindingDeliveryTarget: locator.threadId,
      deliveryIdempotencyKey: 'signup-welcome:member-exact-welcome',
      deliveryKind: 'thread',
      deliveryTarget: locator.threadId,
      executionContext,
      firstContactPolicy: {
        markSeenOnDeliveryAccepted: true,
      },
      instructions: 'Send the exact signup welcome.',
      responsePolicy: {
        kind: 'require_send_exact_text',
        text: welcomeText,
      },
      vault: vaultRoot,
    })

    expect(boundaries.executeProvider).not.toHaveBeenCalled()
    expect(welcome.session.providerOptions.sandbox).toBe('danger-full-access')
    expect(boundaries.appendTranscript).toHaveBeenCalledWith(
      welcome.session.sessionId,
      [
        {
          createdAt: expect.any(String),
          kind: 'assistant',
          text: welcomeText,
        },
      ],
    )

    const attended = await resolveAssistantSessionForMessage({
      boundaryDefaultTarget: modelTarget,
      defaults: null,
      message: {
        ...locator,
        executionContext,
        prompt: 'Hey Murph, do your thing.',
        vault: vaultRoot,
      },
    })

    expect(attended.created).toBe(false)
    expect(attended.session.sessionId).toBe(welcome.session.sessionId)
    expect(attended.session.providerOptions.sandbox).toBe('danger-full-access')
  })
})

async function createPersistedLegacyContext(label: string) {
  const { parentRoot, vaultRoot } = await createTempVaultContext(label)
  cleanupPaths.push(parentRoot)
  const resolved = await resolveAssistantSession({
    ...opaqueLocator,
    channel: 'linq',
    target: modelTarget,
    vault: vaultRoot,
  })
  return {
    sessionId: resolved.session.sessionId,
    vault: vaultRoot,
  }
}

async function sendNotification(input: {
  bindingDeliveryTarget?: string
  context: Awaited<ReturnType<typeof createPersistedLegacyContext>>
  deliveryTarget: string
  responsePolicy?: Parameters<typeof sendAssistantNotificationLocal>[0]['responsePolicy']
  threadIsDirect: boolean | null
}) {
  return await sendAssistantNotificationLocal({
    ...opaqueLocator,
    allowBindingRebind: true,
    bindingDeliveryTarget: input.bindingDeliveryTarget,
    channel: 'linq',
    deliveryIdempotencyKey: 'cron-occurrence-authorized-audience',
    deliveryTarget: input.deliveryTarget,
    executionContext: {
      hosted: {
        channelTypingDependencies: {
          startLinqTyping: boundaries.startLinqTyping,
        },
        defaultTarget: modelTarget,
        memberId: 'member-authorized-audience',
        userEnvKeys: [],
      },
    },
    instructions: 'Prepare the scheduled update.',
    operatorAuthority: 'direct-operator',
    responsePolicy: input.responsePolicy,
    sessionId: input.context.sessionId,
    threadIsDirect: input.threadIsDirect,
    turnTrigger: 'automation-cron',
    vault: input.context.vault,
    workingDirectory: input.context.vault,
  })
}
