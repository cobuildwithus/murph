import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, test, vi } from 'vitest'

import type {
  AssistantProviderSessionOptions,
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { serializeAssistantProviderSessionOptions } from '@murphai/operator-config/assistant/provider-config'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { AssistantChannelAdapter } from '../src/assistant/channel-adapters.ts'
import type { CodexThreadIdentity } from '../src/assistant/codex-thread-route.ts'
import type {
  AssistantFinalAction,
  AssistantProviderUsage,
} from '../src/assistant/providers/types.ts'
import type {
  AssistantTurnSharedPlan,
  ExecutedAssistantProviderTurnResult,
} from '../src/assistant/service-contracts.ts'

type CodexAssistantTarget = Extract<
  AssistantSession['target'],
  { adapter: 'codex-cli' }
>

const CODEX_MODEL_PROVIDER_CONFIG = {
  id: 'vercel-ai-gateway',
  name: 'Vercel AI Gateway',
  baseUrl: 'https://ai-gateway.vercel.sh/v1',
  envKey: 'VERCEL_AI_API_KEY',
  wireApi: 'responses' as const,
}

afterEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.doUnmock('@murphai/operator-config/operator-config')
  vi.doUnmock('@murphai/operator-config/assistant-backend')
  vi.doUnmock('../src/assistant/runtime-state-service.js')
  vi.doUnmock('../src/assistant/execution-context.js')
  vi.doUnmock('../src/assistant/session-resolution.js')
  vi.doUnmock('../src/assistant/turn-plan.js')
  vi.doUnmock('../src/assistant/codex-turn-runner.js')
  vi.doUnmock('../src/assistant/service-usage.js')
  vi.doUnmock('../src/assistant/turn-finalizer.js')
  vi.doUnmock('../src/assistant/service-turn-routes.js')
  vi.doUnmock('../src/assistant/turns.js')
  vi.doUnmock('../src/assistant/channel-adapters.js')
  vi.doUnmock('../src/assistant/turn-lock.js')
  vi.doUnmock('../src/assistant/response-media.js')
  vi.doUnmock('../src/assistant/first-contact.js')
})

test('sendAssistantNotificationLocal persists the turn before outbound delivery and forwards the dedupe token', async () => {
  const persistedBeforeOutbound: string[] = []
  const traceEvents: unknown[] = []
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const stopTyping = vi.fn(async () => undefined)
  const startTelegramTyping = vi.fn(async () => undefined)
  const startTypingIndicator = vi.fn<
    NonNullable<AssistantChannelAdapter['startTypingIndicator']>
  >(async () => ({
    stop: stopTyping,
  }))
  vi.stubEnv('HOSTED_LOG_FINGERPRINT_SECRET', 'notification-trace-secret')
  const initialSession = createAssistantSession({
    binding: {
      actorId: 'actor-initial',
      channel: 'telegram',
      conversationKey: null,
      delivery: {
        kind: 'thread',
        target: 'thread-initial',
      },
      identityId: 'identity-initial',
      threadId: 'thread-initial',
      threadIsDirect: false,
    },
    resumeState: {
      routeFingerprint: 'route-initial',
      threadId: 'provider-session-initial',
    },
    turnCount: 4,
  })
  const savedSession = createAssistantSession({
    binding: {
      actorId: 'actor-saved',
      channel: 'signal',
      conversationKey: null,
      delivery: {
        kind: 'thread',
        target: 'thread-saved',
      },
      identityId: 'identity-saved',
      threadId: 'thread-saved',
      threadIsDirect: true,
    },
    sessionId: initialSession.sessionId,
    turnCount: initialSession.turnCount + 1,
  })
  const deliveredSession = createAssistantSession({
    binding: {
      ...savedSession.binding,
      actorId: 'actor-delivered',
      channel: 'whatsapp',
    },
    sessionId: savedSession.sessionId,
    turnCount: savedSession.turnCount,
  })
  const sharedPlan = createSharedPlan()
  const providerResult = createProviderResult({
    response: JSON.stringify({
      kind: 'send_message',
      text: 'Raw notification text',
      privateSummary: 'summary',
    }),
    route: createRoute({
      routeId: 'route-notification',
    }),
    session: initialSession,
  })
  const deliverMessage = vi.fn(async (input) => {
    persistedBeforeOutbound.push('deliver')
    assert.equal(input.dedupeToken, 'cron-slot-token')
    return {
      delivery: null,
      intent: {
        intentId: 'intent-notification',
      },
      kind: 'sent',
      session: deliveredSession,
    }
  })
  const mocks = {
    createAssistantRuntimeStateService: vi.fn(() => ({
      outbox: {
        deliverMessage,
      },
      status: {
        refreshSnapshot: vi.fn(async () => {
          throw new Error('status refresh failed')
        }),
      },
      turns: {
        createReceipt: vi.fn(async () => undefined),
        finalizeReceipt: vi.fn(async () => undefined),
      },
      diagnostics: {
        recordEvent: vi.fn(async () => undefined),
      },
    })),
    executeCodexTurnWithRecovery: vi.fn(async () => ({
      kind: 'succeeded',
      providerTurn: providerResult,
    })),
    normalizeAssistantExecutionContext: vi.fn((value) => value),
    resolveAssistantExecutionDefaultTarget: vi.fn((input) =>
      input.executionContext?.hosted?.defaultTarget ?? input.fallbackTarget,
    ),
    resolveAssistantExecutionOperatorDefaults: vi.fn((input) =>
      input.executionContext?.hosted?.defaultTarget
        ? {
            ...(input.defaults ?? {}),
            backend: input.executionContext.hosted.defaultTarget,
          }
        : (input.defaults ?? null),
    ),
    persistAssistantTurnAndSession: vi.fn(async (input) => {
      persistedBeforeOutbound.push('persist')
      return savedSession
    }),
    recordAdditionalAssistantUsageEvents: vi.fn(async () => undefined),
    recordAssistantUsageEvent: vi.fn(async () => undefined),
    resolveAssistantOperatorDefaults: vi.fn(async () => ({
      timezone: 'Australia/Sydney',
    })),
    resolveAssistantSessionForMessage: vi.fn(async () => ({
      created: false,
      session: initialSession,
    })),
    resolveAssistantTurnRoute: vi.fn(() => providerResult.route),
    resolveAssistantTurnSharedPlan: vi.fn(async () => sharedPlan),
    withAssistantTurnLock: vi.fn(async (input: { run(): Promise<unknown> }) => await input.run()),
  }

  vi.doMock('@murphai/operator-config/operator-config', () => ({
    resolveAssistantOperatorDefaults: mocks.resolveAssistantOperatorDefaults,
  }))
  vi.doMock('@murphai/operator-config/assistant-backend', () => ({
    createDefaultLocalAssistantModelTarget: () => createCodexTarget(),
  }))
  vi.doMock('../src/assistant/runtime-state-service.js', () => ({
    createAssistantRuntimeStateService: mocks.createAssistantRuntimeStateService,
  }))
  vi.doMock('../src/assistant/execution-context.js', () => ({
    normalizeAssistantExecutionContext: mocks.normalizeAssistantExecutionContext,
    resolveAssistantExecutionDefaultTarget:
      mocks.resolveAssistantExecutionDefaultTarget,
    resolveAssistantExecutionOperatorDefaults:
      mocks.resolveAssistantExecutionOperatorDefaults,
  }))
  vi.doMock('../src/assistant/session-resolution.js', () => ({
    resolveAssistantSessionForMessage: mocks.resolveAssistantSessionForMessage,
  }))
  vi.doMock('../src/assistant/turn-plan.js', () => ({
    resolveAssistantTurnSharedPlan: mocks.resolveAssistantTurnSharedPlan,
  }))
  vi.doMock('../src/assistant/codex-turn-runner.js', () => ({
    executeCodexTurnWithRecovery: mocks.executeCodexTurnWithRecovery,
  }))
  vi.doMock('../src/assistant/service-usage.js', () => ({
    recordAdditionalAssistantUsageEvents: mocks.recordAdditionalAssistantUsageEvents,
    recordAssistantUsageEvent: mocks.recordAssistantUsageEvent,
  }))
  vi.doMock('../src/assistant/turn-finalizer.js', () => ({
    persistAssistantTurnAndSession: mocks.persistAssistantTurnAndSession,
  }))
  vi.doMock('../src/assistant/service-turn-routes.js', () => ({
    resolveAssistantTurnRoute: mocks.resolveAssistantTurnRoute,
  }))
  vi.doMock('../src/assistant/turns.js', () => ({
    createAssistantTurnId: () => 'turn-notification',
  }))
  vi.doMock('../src/assistant/channel-adapters.js', async () => {
    const actual = await vi.importActual<
      typeof import('../src/assistant/channel-adapters.ts')
    >('../src/assistant/channel-adapters.js')

    return {
      ...actual,
      getAssistantChannelAdapter: vi.fn(() => ({
        startTypingIndicator,
      })),
    }
  })
  vi.doMock('../src/assistant/turn-lock.js', () => ({
    withAssistantTurnLock: mocks.withAssistantTurnLock,
  }))

  const hostedDefaultTarget = createCodexTarget({
    model: 'gpt-5.5-mini',
  })
  const { sendAssistantNotificationLocal } = await import(
    '../src/assistant/notification-turn.ts'
  )

  const notificationInput = {
    deliveryDedupeToken: 'cron-slot-token',
    executionContext: {
      hosted: {
        defaultTarget: hostedDefaultTarget,
        channelTypingDependencies: {
          startTelegramTyping,
        },
        memberId: 'member-hosted',
        userEnvKeys: [],
      },
    },
    instructions: 'Check whether the operator should be notified.',
    onTraceEvent(event) {
      traceEvents.push(event)
    },
    vault: '/vaults/test',
  } satisfies Parameters<typeof sendAssistantNotificationLocal>[0] & Record<string, unknown>

  const result = await sendAssistantNotificationLocal(notificationInput)

  assert.deepEqual(persistedBeforeOutbound, ['persist', 'deliver'])
  assert.equal(mocks.persistAssistantTurnAndSession.mock.calls.length, 1)
  assert.equal(
    mocks.persistAssistantTurnAndSession.mock.calls[0]?.[0]?.session,
    initialSession,
  )
  assert.equal(
    mocks.persistAssistantTurnAndSession.mock.calls[0]?.[0]?.assistantTranscriptText,
    'Raw notification text',
  )
  assert.equal(
    deliverMessage.mock.calls[0]?.[0]?.channel,
    'signal',
  )
  assert.equal(
    deliverMessage.mock.calls[0]?.[0]?.identityId,
    'identity-saved',
  )
  assert.equal(
    deliverMessage.mock.calls[0]?.[0]?.deliveryTransportIdempotent,
    false,
  )
  assert.equal(result.response, 'Raw notification text')
  assert.deepEqual(result.session, deliveredSession)
  expect(warnSpy).toHaveBeenCalledWith(
    'Assistant best-effort status snapshot refresh failed (Error).',
  )
  assert.equal(startTypingIndicator.mock.calls.length, 1)
  assert.equal(
    startTypingIndicator.mock.calls[0]?.[1]?.startTelegramTyping,
    startTelegramTyping,
  )
  assert.equal(stopTyping.mock.calls.length, 1)
  const firstResolvedNotificationSessionCall = (
    mocks.resolveAssistantSessionForMessage.mock.calls as Array<
      Array<{ boundaryDefaultTarget?: unknown; defaults?: unknown }>
    >
  )[0]
  const firstResolvedNotificationSessionInput =
    firstResolvedNotificationSessionCall?.[0] as
      | {
          boundaryDefaultTarget?: unknown
          defaults?: unknown
          message?: Record<string, unknown>
        }
      | undefined
  assert.deepEqual(
    firstResolvedNotificationSessionInput?.boundaryDefaultTarget,
    hostedDefaultTarget,
  )
  assert.deepEqual(
    firstResolvedNotificationSessionInput?.defaults,
    {
      backend: hostedDefaultTarget,
      timezone: 'Australia/Sydney',
    },
  )
  assert.ok(firstResolvedNotificationSessionInput?.message)
  assert.deepEqual(result.decision, {
    kind: 'send_message',
    privateSummary: 'summary',
    text: 'Raw notification text',
  })

  const contextTrace = traceEvents.find((event) =>
    isTraceEventWithRawType(event, 'assistant.context.diagnostics'),
  )
  expect(contextTrace).toBeDefined()
  const rawEvent = (contextTrace as { rawEvent: Record<string, unknown> }).rawEvent
  expect(rawEvent).toEqual(expect.objectContaining({
    schema: 'murph.assistant-context-diagnostics.v1',
    type: 'assistant.context.diagnostics',
    source: 'assistant-notification',
    stage: 'assistant-session-resolved',
    fingerprintReady: true,
    sessionResolutionCreated: false,
    sessionTurnCount: 4,
  }))
  expect(rawEvent.actorFingerprint).toMatch(/^h1_[a-f0-9]{24}$/u)
  expect(rawEvent.identityFingerprint).toMatch(/^h1_[a-f0-9]{24}$/u)
  expect(rawEvent.threadFingerprint).toMatch(/^h1_[a-f0-9]{24}$/u)
  expect(rawEvent.sessionFingerprint).toMatch(/^h1_[a-f0-9]{24}$/u)
  expect(JSON.stringify(rawEvent)).not.toContain('actor-initial')
  expect(JSON.stringify(rawEvent)).not.toContain('identity-initial')
  expect(JSON.stringify(rawEvent)).not.toContain('thread-initial')
  expect(JSON.stringify(rawEvent)).not.toContain(initialSession.sessionId)
})

test('sendAssistantNotificationLocal sends required exact text without a provider turn', async () => {
  const order: string[] = []
  const initialSession = createAssistantSession({
    binding: {
      actorId: 'actor-exact',
      channel: 'telegram',
      conversationKey: null,
      delivery: {
        kind: 'thread',
        target: 'thread-exact',
      },
      identityId: 'identity-exact',
      threadId: 'thread-exact',
      threadIsDirect: true,
    },
    turnCount: 2,
  })
  const savedSession = {
    ...initialSession,
    lastTurnAt: '2026-04-08T00:00:01.000Z',
    turnCount: 3,
    updatedAt: '2026-04-08T00:00:01.000Z',
  }
  const sharedPlan = createSharedPlan()
  sharedPlan.conversationPolicy.audience.channel = 'telegram'
  sharedPlan.conversationPolicy.audience.threadId = 'thread-exact'
  sharedPlan.conversationPolicy.audience.threadIsDirect = true
  const deliverMessage = vi.fn(async (input) => {
    order.push(`deliver:${input.message}`)
    return {
      delivery: {
        channel: 'telegram',
        idempotencyKey: input.deliveryIdempotencyKey ?? null,
        messageId: 'provider-message-exact',
        sentAt: '2026-04-08T00:00:00.500Z',
        target: 'thread-exact',
        targetKind: 'thread',
      },
      deliveryError: null,
      intent: {
        intentId: 'intent-exact',
      },
      kind: 'sent',
      session: initialSession,
    }
  })
  const runtimeState = {
    outbox: {
      deliverMessage,
    },
    status: {
      refreshSnapshot: vi.fn(async () => undefined),
    },
    transcripts: {
      append: vi.fn(async () => {
        order.push('transcript')
        return []
      }),
    },
    sessions: {
      save: vi.fn(async () => {
        order.push('session')
        return savedSession
      }),
    },
    turns: {
      createReceipt: vi.fn(async () => undefined),
      finalizeReceipt: vi.fn(async () => undefined),
    },
    diagnostics: {
      recordEvent: vi.fn(async () => undefined),
    },
  }
  const mocks = {
    createAssistantRuntimeStateService: vi.fn(() => runtimeState),
    executeCodexTurnWithRecovery: vi.fn(async () => {
      throw new Error('provider should not run for exact text')
    }),
    hasAssistantSeenFirstContact: vi.fn(async () => false),
    markAssistantFirstContactSeen: vi.fn(async () => undefined),
    normalizeAssistantExecutionContext: vi.fn((value) => value),
    resolveAssistantExecutionDefaultTarget: vi.fn((input) => input.fallbackTarget),
    resolveAssistantExecutionOperatorDefaults: vi.fn((input) => input.defaults ?? null),
    persistAssistantTurnAndSession: vi.fn(async () => {
      throw new Error('provider finalizer should not run for exact text')
    }),
    recordAdditionalAssistantUsageEvents: vi.fn(async () => undefined),
    recordAssistantUsageEvent: vi.fn(async () => undefined),
    resolveAssistantOperatorDefaults: vi.fn(async () => null),
    resolveAssistantSessionForMessage: vi.fn(async () => ({
      created: false,
      session: initialSession,
    })),
    resolveAssistantTurnRoute: vi.fn(() => createRoute()),
    resolveAssistantTurnSharedPlan: vi.fn(async () => sharedPlan),
    withAssistantTurnLock: vi.fn(async (input: { run(): Promise<unknown> }) => await input.run()),
  }

  vi.doMock('@murphai/operator-config/operator-config', () => ({
    resolveAssistantOperatorDefaults: mocks.resolveAssistantOperatorDefaults,
  }))
  vi.doMock('@murphai/operator-config/assistant-backend', () => ({
    createDefaultLocalAssistantModelTarget: () => createCodexTarget(),
  }))
  vi.doMock('../src/assistant/runtime-state-service.js', () => ({
    createAssistantRuntimeStateService: mocks.createAssistantRuntimeStateService,
  }))
  vi.doMock('../src/assistant/execution-context.js', () => ({
    normalizeAssistantExecutionContext: mocks.normalizeAssistantExecutionContext,
    resolveAssistantExecutionDefaultTarget:
      mocks.resolveAssistantExecutionDefaultTarget,
    resolveAssistantExecutionOperatorDefaults:
      mocks.resolveAssistantExecutionOperatorDefaults,
  }))
  vi.doMock('../src/assistant/session-resolution.js', () => ({
    resolveAssistantSessionForMessage: mocks.resolveAssistantSessionForMessage,
  }))
  vi.doMock('../src/assistant/turn-plan.js', () => ({
    resolveAssistantTurnSharedPlan: mocks.resolveAssistantTurnSharedPlan,
  }))
  vi.doMock('../src/assistant/codex-turn-runner.js', () => ({
    executeCodexTurnWithRecovery: mocks.executeCodexTurnWithRecovery,
  }))
  vi.doMock('../src/assistant/service-usage.js', () => ({
    recordAdditionalAssistantUsageEvents: mocks.recordAdditionalAssistantUsageEvents,
    recordAssistantUsageEvent: mocks.recordAssistantUsageEvent,
  }))
  vi.doMock('../src/assistant/turn-finalizer.js', () => ({
    persistAssistantTurnAndSession: mocks.persistAssistantTurnAndSession,
  }))
  vi.doMock('../src/assistant/service-turn-routes.js', () => ({
    resolveAssistantTurnRoute: mocks.resolveAssistantTurnRoute,
  }))
  vi.doMock('../src/assistant/turns.js', () => ({
    createAssistantTurnId: () => 'turn-exact',
  }))
  vi.doMock('../src/assistant/channel-adapters.js', async () => {
    const actual = await vi.importActual<
      typeof import('../src/assistant/channel-adapters.ts')
    >('../src/assistant/channel-adapters.js')

    return {
      ...actual,
      getAssistantChannelAdapter: vi.fn(() => null),
    }
  })
  vi.doMock('../src/assistant/turn-lock.js', () => ({
    withAssistantTurnLock: mocks.withAssistantTurnLock,
  }))
  vi.doMock('../src/assistant/first-contact.js', async () => {
    const actual = await vi.importActual<
      typeof import('../src/assistant/first-contact.ts')
    >('../src/assistant/first-contact.js')

    return {
      ...actual,
      hasAssistantSeenFirstContact: mocks.hasAssistantSeenFirstContact,
      markAssistantFirstContactSeen: mocks.markAssistantFirstContactSeen,
    }
  })

  const { sendAssistantNotificationLocal } = await import(
    '../src/assistant/notification-turn.ts'
  )

  const result = await sendAssistantNotificationLocal({
    deliveryDedupeToken: 'signup-welcome:member_exact',
    deliveryIdempotencyKey: 'signup-welcome:member_exact',
    executionContext: {
      hosted: {
        memberId: 'member_exact',
        userEnvKeys: [],
      },
    },
    firstContactPolicy: {
      markSeenOnDeliveryAccepted: true,
    },
    instructions: 'Send the fixed hosted signup welcome.',
    responsePolicy: {
      kind: 'require_send_exact_text',
      text: 'Fixed welcome text',
    },
    vault: '/vaults/exact',
  })

  expect(mocks.executeCodexTurnWithRecovery).not.toHaveBeenCalled()
  expect(mocks.resolveAssistantTurnRoute).not.toHaveBeenCalled()
  expect(mocks.recordAssistantUsageEvent).not.toHaveBeenCalled()
  expect(mocks.persistAssistantTurnAndSession).not.toHaveBeenCalled()
  expect(order).toEqual(['deliver:Fixed welcome text', 'transcript', 'session'])
  expect(runtimeState.turns.createReceipt).toHaveBeenCalledWith(
    expect.objectContaining({
      deliveryRequested: true,
      metadata: {
        notificationMode: 'deterministic-exact-text',
      },
      provider: 'codex-cli',
      providerModel: 'gpt-5.5',
      sessionId: initialSession.sessionId,
      turnId: 'turn-exact',
    }),
  )
  expect(deliverMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      dedupeToken: 'signup-welcome:member_exact',
      deliveryIdempotencyKey: 'signup-welcome:member_exact',
      dispatchMode: undefined,
      message: 'Fixed welcome text',
      turnId: 'turn-exact',
    }),
  )
  expect(runtimeState.transcripts.append).toHaveBeenCalledWith(
    initialSession.sessionId,
    [
      {
        kind: 'assistant',
        text: 'Fixed welcome text',
        createdAt: expect.any(String),
      },
    ],
  )
  expect(runtimeState.sessions.save).toHaveBeenCalledWith(
    expect.objectContaining({
      lastTurnAt: expect.any(String),
      sessionId: initialSession.sessionId,
      turnCount: 3,
    }),
  )
  expect(mocks.markAssistantFirstContactSeen).toHaveBeenCalledWith({
    docIds: [
      expect.stringMatching(/^onboarding\/first-contact\/[a-f0-9]{64}$/u),
      expect.stringMatching(/^onboarding\/first-contact\/[a-f0-9]{64}$/u),
    ],
    seenAt: expect.any(String),
    vault: '/vaults/exact',
  })
  expect(result).toEqual({
    decision: {
      kind: 'send_message',
      privateSummary: 'Sent required exact notification text.',
      text: 'Fixed welcome text',
    },
    deliveryOutcome: expect.objectContaining({
      intentId: 'intent-exact',
      kind: 'sent',
      session: savedSession,
    }),
    response: 'Fixed welcome text',
    session: savedSession,
  })
})

test('sendAssistantNotificationLocal rejects deferred immediate exact-text delivery but accepts queue-only deferral', async () => {
  const initialSession = createAssistantSession({
    binding: {
      actorId: 'actor-exact',
      channel: 'telegram',
      conversationKey: null,
      delivery: {
        kind: 'thread',
        target: 'thread-exact',
      },
      identityId: 'identity-exact',
      threadId: 'thread-exact',
      threadIsDirect: true,
    },
  })
  const sharedPlan = createSharedPlan()
  sharedPlan.conversationPolicy.audience.channel = 'telegram'
  sharedPlan.conversationPolicy.audience.threadId = 'thread-exact'
  sharedPlan.conversationPolicy.audience.threadIsDirect = true
  const deliverMessage = vi.fn(async () => ({
    delivery: null,
    deliveryError: null,
    intent: {
      intentId: 'intent-deferred',
    },
    kind: 'queued',
    session: null,
  }))
  const runtimeState = {
    outbox: {
      deliverMessage,
    },
    status: {
      refreshSnapshot: vi.fn(async () => undefined),
    },
    transcripts: {
      append: vi.fn(async () => []),
    },
    sessions: {
      save: vi.fn(async () => initialSession),
    },
    turns: {
      createReceipt: vi.fn(async () => undefined),
      finalizeReceipt: vi.fn(async () => undefined),
    },
    diagnostics: {
      recordEvent: vi.fn(async () => undefined),
    },
  }
  const mocks = {
    createAssistantRuntimeStateService: vi.fn(() => runtimeState),
    executeCodexTurnWithRecovery: vi.fn(async () => {
      throw new Error('provider should not run for exact text')
    }),
    hasAssistantSeenFirstContact: vi.fn(async () => false),
    markAssistantFirstContactSeen: vi.fn(async () => undefined),
    normalizeAssistantExecutionContext: vi.fn((value) => value),
    resolveAssistantExecutionDefaultTarget: vi.fn((input) => input.fallbackTarget),
    resolveAssistantExecutionOperatorDefaults: vi.fn((input) => input.defaults ?? null),
    persistAssistantTurnAndSession: vi.fn(async () => {
      throw new Error('provider finalizer should not run for exact text')
    }),
    recordAdditionalAssistantUsageEvents: vi.fn(async () => undefined),
    recordAssistantUsageEvent: vi.fn(async () => undefined),
    resolveAssistantOperatorDefaults: vi.fn(async () => null),
    resolveAssistantSessionForMessage: vi.fn(async () => ({
      created: false,
      session: initialSession,
    })),
    resolveAssistantTurnRoute: vi.fn(() => createRoute()),
    resolveAssistantTurnSharedPlan: vi.fn(async () => sharedPlan),
    withAssistantTurnLock: vi.fn(async (input: { run(): Promise<unknown> }) => await input.run()),
  }

  vi.doMock('@murphai/operator-config/operator-config', () => ({
    resolveAssistantOperatorDefaults: mocks.resolveAssistantOperatorDefaults,
  }))
  vi.doMock('@murphai/operator-config/assistant-backend', () => ({
    createDefaultLocalAssistantModelTarget: () => createCodexTarget(),
  }))
  vi.doMock('../src/assistant/runtime-state-service.js', () => ({
    createAssistantRuntimeStateService: mocks.createAssistantRuntimeStateService,
  }))
  vi.doMock('../src/assistant/execution-context.js', () => ({
    normalizeAssistantExecutionContext: mocks.normalizeAssistantExecutionContext,
    resolveAssistantExecutionDefaultTarget:
      mocks.resolveAssistantExecutionDefaultTarget,
    resolveAssistantExecutionOperatorDefaults:
      mocks.resolveAssistantExecutionOperatorDefaults,
  }))
  vi.doMock('../src/assistant/session-resolution.js', () => ({
    resolveAssistantSessionForMessage: mocks.resolveAssistantSessionForMessage,
  }))
  vi.doMock('../src/assistant/turn-plan.js', () => ({
    resolveAssistantTurnSharedPlan: mocks.resolveAssistantTurnSharedPlan,
  }))
  vi.doMock('../src/assistant/codex-turn-runner.js', () => ({
    executeCodexTurnWithRecovery: mocks.executeCodexTurnWithRecovery,
  }))
  vi.doMock('../src/assistant/service-usage.js', () => ({
    recordAdditionalAssistantUsageEvents: mocks.recordAdditionalAssistantUsageEvents,
    recordAssistantUsageEvent: mocks.recordAssistantUsageEvent,
  }))
  vi.doMock('../src/assistant/turn-finalizer.js', () => ({
    persistAssistantTurnAndSession: mocks.persistAssistantTurnAndSession,
  }))
  vi.doMock('../src/assistant/service-turn-routes.js', () => ({
    resolveAssistantTurnRoute: mocks.resolveAssistantTurnRoute,
  }))
  vi.doMock('../src/assistant/turns.js', () => ({
    createAssistantTurnId: () => 'turn-exact-deferred',
  }))
  vi.doMock('../src/assistant/channel-adapters.js', async () => {
    const actual = await vi.importActual<
      typeof import('../src/assistant/channel-adapters.ts')
    >('../src/assistant/channel-adapters.js')

    return {
      ...actual,
      getAssistantChannelAdapter: vi.fn(() => null),
    }
  })
  vi.doMock('../src/assistant/turn-lock.js', () => ({
    withAssistantTurnLock: mocks.withAssistantTurnLock,
  }))
  vi.doMock('../src/assistant/first-contact.js', async () => {
    const actual = await vi.importActual<
      typeof import('../src/assistant/first-contact.ts')
    >('../src/assistant/first-contact.js')

    return {
      ...actual,
      hasAssistantSeenFirstContact: mocks.hasAssistantSeenFirstContact,
      markAssistantFirstContactSeen: mocks.markAssistantFirstContactSeen,
    }
  })

  const { sendAssistantNotificationLocal } = await import(
    '../src/assistant/notification-turn.ts'
  )

  await expect(sendAssistantNotificationLocal({
    deliveryDedupeToken: 'signup-welcome:member_exact',
    deliveryIdempotencyKey: 'signup-welcome:member_exact',
    firstContactPolicy: {
      markSeenOnDeliveryAccepted: true,
    },
    instructions: 'Send the fixed hosted signup welcome.',
    responsePolicy: {
      kind: 'require_send_exact_text',
      text: 'Fixed welcome text',
    },
    vault: '/vaults/exact',
  })).rejects.toMatchObject({
    code: 'ASSISTANT_NOTIFICATION_DELIVERY_DEFERRED',
  })

  expect(mocks.executeCodexTurnWithRecovery).not.toHaveBeenCalled()
  expect(runtimeState.transcripts.append).not.toHaveBeenCalled()
  expect(runtimeState.sessions.save).not.toHaveBeenCalled()
  expect(mocks.markAssistantFirstContactSeen).not.toHaveBeenCalled()

  vi.mocked(deliverMessage).mockClear()
  vi.mocked(runtimeState.transcripts.append).mockClear()
  vi.mocked(runtimeState.sessions.save).mockClear()
  mocks.markAssistantFirstContactSeen.mockClear()

  const result = await sendAssistantNotificationLocal({
    deliveryDedupeToken: 'signup-welcome:member_exact',
    deliveryDispatchMode: 'queue-only',
    deliveryIdempotencyKey: 'signup-welcome:member_exact',
    firstContactPolicy: {
      markSeenOnDeliveryAccepted: true,
    },
    instructions: 'Send the fixed hosted signup welcome.',
    responsePolicy: {
      kind: 'require_send_exact_text',
      text: 'Fixed welcome text',
    },
    vault: '/vaults/exact',
  })

  expect(mocks.executeCodexTurnWithRecovery).not.toHaveBeenCalled()
  expect(deliverMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      dispatchMode: 'queue-only',
      message: 'Fixed welcome text',
    }),
  )
  expect(runtimeState.transcripts.append).toHaveBeenCalledWith(
    initialSession.sessionId,
    [
      {
        kind: 'assistant',
        text: 'Fixed welcome text',
        createdAt: expect.any(String),
      },
    ],
  )
  expect(runtimeState.sessions.save).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: initialSession.sessionId,
    }),
  )
  expect(mocks.markAssistantFirstContactSeen).toHaveBeenCalledWith({
    docIds: [
      expect.stringMatching(/^onboarding\/first-contact\/[a-f0-9]{64}$/u),
      expect.stringMatching(/^onboarding\/first-contact\/[a-f0-9]{64}$/u),
    ],
    seenAt: expect.any(String),
    vault: '/vaults/exact',
  })
  expect(result).toEqual({
    decision: {
      kind: 'send_message',
      privateSummary: 'Sent required exact notification text.',
      text: 'Fixed welcome text',
    },
    deliveryOutcome: expect.objectContaining({
      intentId: 'intent-deferred',
      kind: 'queued',
      session: initialSession,
    }),
    response: 'Fixed welcome text',
    session: initialSession,
  })
})

test('sendAssistantNotificationLocal derives hosted Linq deterministic delivery keys centrally', async () => {
  const linqSession = createAssistantSession({
    binding: {
      actorId: 'actor-linq',
      channel: 'linq',
      conversationKey: null,
      delivery: {
        kind: 'thread',
        target: 'thread-linq',
      },
      identityId: 'identity-linq',
      threadId: 'thread-linq',
      threadIsDirect: true,
    },
  })
  const providerResult = createProviderResult({
    response: JSON.stringify({
      kind: 'send_message',
      privateSummary: 'summary',
      text: 'Hosted Linq notification',
    }),
    session: linqSession,
  })
  const deliverMessage = vi.fn(async () => ({
    delivery: null,
    intent: {
      intentId: 'intent-hosted-linq-notification',
    },
    kind: 'queued',
    session: linqSession,
  }))
  const mocks = {
    createAssistantRuntimeStateService: vi.fn(() => ({
      outbox: {
        deliverMessage,
      },
      status: {
        refreshSnapshot: vi.fn(async () => undefined),
      },
      turns: {
        createReceipt: vi.fn(async () => undefined),
        finalizeReceipt: vi.fn(async () => undefined),
      },
      diagnostics: {
        recordEvent: vi.fn(async () => undefined),
      },
    })),
    executeCodexTurnWithRecovery: vi.fn(async () => ({
      kind: 'succeeded',
      providerTurn: providerResult,
    })),
    normalizeAssistantExecutionContext: vi.fn((value) => value),
    resolveAssistantExecutionDefaultTarget: vi.fn((input) =>
      input.executionContext?.hosted?.defaultTarget ?? input.fallbackTarget,
    ),
    resolveAssistantExecutionOperatorDefaults: vi.fn((input) =>
      input.executionContext?.hosted?.defaultTarget
        ? {
            ...(input.defaults ?? {}),
            backend: input.executionContext.hosted.defaultTarget,
          }
        : (input.defaults ?? null),
    ),
    persistAssistantTurnAndSession: vi.fn(async () => linqSession),
    recordAdditionalAssistantUsageEvents: vi.fn(async () => undefined),
    recordAssistantUsageEvent: vi.fn(async () => undefined),
    resolveAssistantOperatorDefaults: vi.fn(async () => ({
      timezone: 'Australia/Sydney',
    })),
    resolveAssistantSessionForMessage: vi.fn(async () => ({
      created: false,
      session: linqSession,
    })),
    resolveAssistantTurnRoute: vi.fn(() => providerResult.route),
    resolveAssistantTurnSharedPlan: vi.fn(async () => createSharedPlan()),
    withAssistantTurnLock: vi.fn(async (input: { run(): Promise<unknown> }) => await input.run()),
  }

  vi.doMock('@murphai/operator-config/operator-config', () => ({
    resolveAssistantOperatorDefaults: mocks.resolveAssistantOperatorDefaults,
  }))
  vi.doMock('@murphai/operator-config/assistant-backend', () => ({
    createDefaultLocalAssistantModelTarget: () => createCodexTarget(),
  }))
  vi.doMock('../src/assistant/runtime-state-service.js', () => ({
    createAssistantRuntimeStateService: mocks.createAssistantRuntimeStateService,
  }))
  vi.doMock('../src/assistant/execution-context.js', () => ({
    normalizeAssistantExecutionContext: mocks.normalizeAssistantExecutionContext,
    resolveAssistantExecutionDefaultTarget:
      mocks.resolveAssistantExecutionDefaultTarget,
    resolveAssistantExecutionOperatorDefaults:
      mocks.resolveAssistantExecutionOperatorDefaults,
  }))
  vi.doMock('../src/assistant/session-resolution.js', () => ({
    resolveAssistantSessionForMessage: mocks.resolveAssistantSessionForMessage,
  }))
  vi.doMock('../src/assistant/turn-plan.js', () => ({
    resolveAssistantTurnSharedPlan: mocks.resolveAssistantTurnSharedPlan,
  }))
  vi.doMock('../src/assistant/codex-turn-runner.js', () => ({
    executeCodexTurnWithRecovery: mocks.executeCodexTurnWithRecovery,
  }))
  vi.doMock('../src/assistant/service-usage.js', () => ({
    recordAdditionalAssistantUsageEvents: mocks.recordAdditionalAssistantUsageEvents,
    recordAssistantUsageEvent: mocks.recordAssistantUsageEvent,
  }))
  vi.doMock('../src/assistant/turn-finalizer.js', () => ({
    persistAssistantTurnAndSession: mocks.persistAssistantTurnAndSession,
  }))
  vi.doMock('../src/assistant/service-turn-routes.js', () => ({
    resolveAssistantTurnRoute: mocks.resolveAssistantTurnRoute,
  }))
  vi.doMock('../src/assistant/turns.js', () => ({
    createAssistantTurnId: () => 'turn-hosted-linq-notification',
  }))
  vi.doMock('../src/assistant/channel-adapters.js', async () => {
    const actual = await vi.importActual<
      typeof import('../src/assistant/channel-adapters.ts')
    >('../src/assistant/channel-adapters.js')

    return {
      ...actual,
      getAssistantChannelAdapter: vi.fn(() => null),
    }
  })
  vi.doMock('../src/assistant/turn-lock.js', () => ({
    withAssistantTurnLock: mocks.withAssistantTurnLock,
  }))

  const { sendAssistantNotificationLocal } = await import(
    '../src/assistant/notification-turn.ts'
  )

  await sendAssistantNotificationLocal({
    executionContext: {
      hosted: {
        memberId: 'member-hosted',
        userEnvKeys: [],
      },
    },
    hostedDeliveryIdempotency: {
      assistantTurnOrdinal: 'assistant-notification:1',
      conversationId: 'notification-conversation',
      inboundMailboxItemIds: ['mailbox_item_notification'],
      recipientKey: 'notification-recipient',
    },
    instructions: 'Deliver this hosted notification.',
    vault: '/vaults/test',
  })

  expect(deliverMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      channel: 'linq',
      deliveryIdempotencyKey: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      deliveryTransportIdempotent: true,
    }),
  )
})

test('sendAssistantNotificationLocal derives hosted notification keys from resolved delivery target', async () => {
  const linqSession = createAssistantSession({
    binding: {
      actorId: 'actor-linq-notification-target',
      channel: 'linq',
      conversationKey: null,
      delivery: {
        kind: 'thread',
        target: 'thread-linq-notification-target',
      },
      identityId: 'identity-linq-notification-target',
      threadId: 'thread-linq-notification-target',
      threadIsDirect: true,
    },
  })
  const providerResult = createProviderResult({
    response: JSON.stringify({
      kind: 'send_message',
      privateSummary: 'summary',
      text: 'Hosted Linq notification',
    }),
    session: linqSession,
  })
  const deliverMessage = vi.fn(
    async (_payload: {
      deliveryIdempotencyKey?: string | null
      explicitTarget?: string | null
      replyToMessageId?: string | null
    }) => ({
      delivery: null,
      intent: {
        intentId: `intent-hosted-linq-notification-${deliverMessage.mock.calls.length}`,
      },
      kind: 'queued',
      session: linqSession,
    }),
  )
  const firstPlan = createSharedPlan()
  firstPlan.conversationPolicy.audience.channel = 'linq'
  firstPlan.conversationPolicy.audience.explicitTarget =
    'audience-notification-target-one'
  firstPlan.conversationPolicy.audience.replyToMessageId =
    'audience-notification-reply-one'
  const secondPlan = createSharedPlan()
  secondPlan.conversationPolicy.audience.channel = 'linq'
  secondPlan.conversationPolicy.audience.explicitTarget =
    'audience-notification-target-two'
  secondPlan.conversationPolicy.audience.replyToMessageId =
    'audience-notification-reply-two'
  const mocks = {
    createAssistantRuntimeStateService: vi.fn(() => ({
      outbox: {
        deliverMessage,
      },
      status: {
        refreshSnapshot: vi.fn(async () => undefined),
      },
      turns: {
        createReceipt: vi.fn(async () => undefined),
        finalizeReceipt: vi.fn(async () => undefined),
      },
      diagnostics: {
        recordEvent: vi.fn(async () => undefined),
      },
    })),
    executeCodexTurnWithRecovery: vi.fn(async () => ({
      kind: 'succeeded',
      providerTurn: providerResult,
    })),
    normalizeAssistantExecutionContext: vi.fn((value) => value),
    resolveAssistantExecutionDefaultTarget: vi.fn((input) =>
      input.executionContext?.hosted?.defaultTarget ?? input.fallbackTarget,
    ),
    resolveAssistantExecutionOperatorDefaults: vi.fn((input) =>
      input.executionContext?.hosted?.defaultTarget
        ? {
            ...(input.defaults ?? {}),
            backend: input.executionContext.hosted.defaultTarget,
          }
        : (input.defaults ?? null),
    ),
    persistAssistantTurnAndSession: vi.fn(async () => linqSession),
    recordAdditionalAssistantUsageEvents: vi.fn(async () => undefined),
    recordAssistantUsageEvent: vi.fn(async () => undefined),
    resolveAssistantOperatorDefaults: vi.fn(async () => ({
      timezone: 'Australia/Sydney',
    })),
    resolveAssistantSessionForMessage: vi.fn(async () => ({
      created: false,
      session: linqSession,
    })),
    resolveAssistantTurnRoute: vi.fn(() => providerResult.route),
    resolveAssistantTurnSharedPlan: vi
      .fn()
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce(secondPlan),
    withAssistantTurnLock: vi.fn(async (input: { run(): Promise<unknown> }) => await input.run()),
  }

  vi.doMock('@murphai/operator-config/operator-config', () => ({
    resolveAssistantOperatorDefaults: mocks.resolveAssistantOperatorDefaults,
  }))
  vi.doMock('@murphai/operator-config/assistant-backend', () => ({
    createDefaultLocalAssistantModelTarget: () => createCodexTarget(),
  }))
  vi.doMock('../src/assistant/runtime-state-service.js', () => ({
    createAssistantRuntimeStateService: mocks.createAssistantRuntimeStateService,
  }))
  vi.doMock('../src/assistant/execution-context.js', () => ({
    normalizeAssistantExecutionContext: mocks.normalizeAssistantExecutionContext,
    resolveAssistantExecutionDefaultTarget:
      mocks.resolveAssistantExecutionDefaultTarget,
    resolveAssistantExecutionOperatorDefaults:
      mocks.resolveAssistantExecutionOperatorDefaults,
  }))
  vi.doMock('../src/assistant/session-resolution.js', () => ({
    resolveAssistantSessionForMessage: mocks.resolveAssistantSessionForMessage,
  }))
  vi.doMock('../src/assistant/turn-plan.js', () => ({
    resolveAssistantTurnSharedPlan: mocks.resolveAssistantTurnSharedPlan,
  }))
  vi.doMock('../src/assistant/codex-turn-runner.js', () => ({
    executeCodexTurnWithRecovery: mocks.executeCodexTurnWithRecovery,
  }))
  vi.doMock('../src/assistant/service-usage.js', () => ({
    recordAdditionalAssistantUsageEvents: mocks.recordAdditionalAssistantUsageEvents,
    recordAssistantUsageEvent: mocks.recordAssistantUsageEvent,
  }))
  vi.doMock('../src/assistant/turn-finalizer.js', () => ({
    persistAssistantTurnAndSession: mocks.persistAssistantTurnAndSession,
  }))
  vi.doMock('../src/assistant/service-turn-routes.js', () => ({
    resolveAssistantTurnRoute: mocks.resolveAssistantTurnRoute,
  }))
  vi.doMock('../src/assistant/turns.js', () => ({
    createAssistantTurnId: () => 'turn-hosted-linq-notification-target',
  }))
  vi.doMock('../src/assistant/channel-adapters.js', async () => {
    const actual = await vi.importActual<
      typeof import('../src/assistant/channel-adapters.ts')
    >('../src/assistant/channel-adapters.js')

    return {
      ...actual,
      getAssistantChannelAdapter: vi.fn(() => null),
    }
  })
  vi.doMock('../src/assistant/turn-lock.js', () => ({
    withAssistantTurnLock: mocks.withAssistantTurnLock,
  }))

  const { sendAssistantNotificationLocal } = await import(
    '../src/assistant/notification-turn.ts'
  )

  const notificationInput = {
    deliveryReplyToMessageId: 'input-notification-reply',
    deliveryTarget: 'input-notification-target',
    executionContext: {
      hosted: {
        memberId: 'member-hosted-notification-target',
        userEnvKeys: [],
      },
    },
    hostedDeliveryIdempotency: {
      assistantTurnOrdinal: 'assistant-notification:target',
      conversationId: 'notification-conversation',
      inboundMailboxItemIds: ['mailbox_item_notification_target'],
    },
    instructions: 'Deliver this hosted notification.',
    vault: '/vaults/test',
  }

  await sendAssistantNotificationLocal(notificationInput)
  await sendAssistantNotificationLocal(notificationInput)

  const firstDelivery = deliverMessage.mock.calls[0]?.[0]
  const secondDelivery = deliverMessage.mock.calls[1]?.[0]
  expect(firstDelivery).toEqual(
    expect.objectContaining({
      explicitTarget: 'audience-notification-target-one',
      replyToMessageId: 'audience-notification-reply-one',
      deliveryIdempotencyKey: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    }),
  )
  expect(secondDelivery).toEqual(
    expect.objectContaining({
      explicitTarget: 'audience-notification-target-two',
      replyToMessageId: 'audience-notification-reply-two',
      deliveryIdempotencyKey: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    }),
  )
  expect(firstDelivery?.deliveryIdempotencyKey).not.toBe(
    secondDelivery?.deliveryIdempotencyKey,
  )
})

test('sendAssistantNotificationLocal passes user-facing provider text through before outbound delivery', async () => {
  const providerSession = createAssistantSession({
    binding: {
      actorId: 'actor-local-visible',
      channel: 'email',
      conversationKey: null,
      delivery: {
        kind: 'participant',
        target: 'local-visible@example.com',
      },
      identityId: 'identity-local-visible',
      threadId: 'thread-local-visible',
      threadIsDirect: true,
    },
  })
  const sharedPlan = createSharedPlan()
  sharedPlan.conversationPolicy.audience.channel = 'email'
  const providerResult = createProviderResult({
    response: JSON.stringify({
      kind: 'send_message',
      text: 'Visible notification text\n\n[DEV] local note',
      privateSummary: 'summary',
    }),
    session: providerSession,
  })
  const deliverMessage = vi.fn(async () => ({
    delivery: null,
    intent: {
      intentId: 'intent-local-visible',
    },
    kind: 'sent',
    session: null,
  }))
  const mocks = {
    createAssistantRuntimeStateService: vi.fn(() => ({
      outbox: {
        deliverMessage,
      },
      status: {
        refreshSnapshot: vi.fn(async () => undefined),
      },
      turns: {
        createReceipt: vi.fn(async () => undefined),
        finalizeReceipt: vi.fn(async () => undefined),
      },
      diagnostics: {
        recordEvent: vi.fn(async () => undefined),
      },
    })),
    executeCodexTurnWithRecovery: vi.fn(async () => ({
      kind: 'succeeded',
      providerTurn: providerResult,
    })),
    normalizeAssistantExecutionContext: vi.fn((value) => value),
    resolveAssistantExecutionDefaultTarget: vi.fn((input) =>
      input.executionContext?.hosted?.defaultTarget ?? input.fallbackTarget,
    ),
    resolveAssistantExecutionOperatorDefaults: vi.fn((input) =>
      input.executionContext?.hosted?.defaultTarget
        ? {
            ...(input.defaults ?? {}),
            backend: input.executionContext.hosted.defaultTarget,
          }
        : (input.defaults ?? null),
    ),
    persistAssistantTurnAndSession: vi.fn(async () => providerSession),
    recordAdditionalAssistantUsageEvents: vi.fn(async () => undefined),
    recordAssistantUsageEvent: vi.fn(async () => undefined),
    resolveAssistantOperatorDefaults: vi.fn(async () => ({
      timezone: 'Australia/Sydney',
    })),
    resolveAssistantSessionForMessage: vi.fn(async () => ({
      session: providerSession,
    })),
    resolveAssistantTurnRoute: vi.fn(() => providerResult.route),
    resolveAssistantTurnSharedPlan: vi.fn(async () => sharedPlan),
    withAssistantTurnLock: vi.fn(async (input: { run(): Promise<unknown> }) => await input.run()),
  }

  vi.doMock('@murphai/operator-config/operator-config', () => ({
    resolveAssistantOperatorDefaults: mocks.resolveAssistantOperatorDefaults,
  }))
  vi.doMock('@murphai/operator-config/assistant-backend', () => ({
    createDefaultLocalAssistantModelTarget: () => createCodexTarget(),
  }))
  vi.doMock('../src/assistant/runtime-state-service.js', () => ({
    createAssistantRuntimeStateService: mocks.createAssistantRuntimeStateService,
  }))
  vi.doMock('../src/assistant/execution-context.js', () => ({
    normalizeAssistantExecutionContext: mocks.normalizeAssistantExecutionContext,
    resolveAssistantExecutionDefaultTarget:
      mocks.resolveAssistantExecutionDefaultTarget,
    resolveAssistantExecutionOperatorDefaults:
      mocks.resolveAssistantExecutionOperatorDefaults,
  }))
  vi.doMock('../src/assistant/session-resolution.js', () => ({
    resolveAssistantSessionForMessage: mocks.resolveAssistantSessionForMessage,
  }))
  vi.doMock('../src/assistant/turn-plan.js', () => ({
    resolveAssistantTurnSharedPlan: mocks.resolveAssistantTurnSharedPlan,
  }))
  vi.doMock('../src/assistant/codex-turn-runner.js', () => ({
    executeCodexTurnWithRecovery: mocks.executeCodexTurnWithRecovery,
  }))
  vi.doMock('../src/assistant/service-usage.js', () => ({
    recordAdditionalAssistantUsageEvents: mocks.recordAdditionalAssistantUsageEvents,
    recordAssistantUsageEvent: mocks.recordAssistantUsageEvent,
  }))
  vi.doMock('../src/assistant/turn-finalizer.js', () => ({
    persistAssistantTurnAndSession: mocks.persistAssistantTurnAndSession,
  }))
  vi.doMock('../src/assistant/service-turn-routes.js', () => ({
    resolveAssistantTurnRoute: mocks.resolveAssistantTurnRoute,
  }))
  vi.doMock('../src/assistant/turns.js', () => ({
    createAssistantTurnId: () => 'turn-notification-local-visible',
  }))
  vi.doMock('../src/assistant/turn-lock.js', () => ({
    withAssistantTurnLock: mocks.withAssistantTurnLock,
  }))

  const { sendAssistantNotificationLocal } = await import(
    '../src/assistant/notification-turn.ts'
  )

  const result = await sendAssistantNotificationLocal({
    executionContext: {
      hosted: null,
    },
    instructions: 'Deliver this',
    vault: '/vaults/local-visible',
  })

  expect(result.response).toBe('Visible notification text\n\n[DEV] local note')
  expect(deliverMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      message: 'Visible notification text\n\n[DEV] local note',
    }),
  )
})

test('sendAssistantNotificationLocal returns skip decisions without delivering', async () => {
  const providerSession = createAssistantSession({
    binding: {
      actorId: 'actor-skip',
      channel: 'email',
      conversationKey: null,
      delivery: {
        kind: 'thread',
        target: 'thread-skip',
      },
      identityId: 'identity-skip',
      threadId: 'thread-skip',
      threadIsDirect: true,
    },
  })
  const sharedPlan = createSharedPlan()
  const imageUsageDraft = {
    provider: 'openai-images',
    providerRequestOrdinal: 1,
    providerRequestOutcome: 'succeeded' as const,
    usage: {
      apiKeyEnv: 'OPENAI_API_KEY',
      baseUrl: 'https://api.openai.com/v1',
      cacheWriteTokens: null,
      cachedInputTokens: null,
      inputTokens: 7,
      outputTokens: 11,
      providerMetadataJson: null,
      providerName: 'OpenAI Images',
      providerRequestId: 'req_image_notification',
      rawUsageJson: null,
      reasoningTokens: null,
      requestedModel: 'gpt-image-2',
      servedModel: null,
      totalTokens: 18,
    },
  }
  const providerResult = {
    ...createProviderResult({
      response: '```json\n{"kind":"skip","privateSummary":"No notification required."}\n```',
      session: providerSession,
    }),
    additionalUsages: [imageUsageDraft],
  }
  const deliverMessage = vi.fn()
  const mocks = {
    createAssistantRuntimeStateService: vi.fn(() => ({
      outbox: {
        deliverMessage,
      },
      status: {
        refreshSnapshot: vi.fn(async () => undefined),
      },
      turns: {
        createReceipt: vi.fn(async () => undefined),
        finalizeReceipt: vi.fn(async () => undefined),
      },
      diagnostics: {
        recordEvent: vi.fn(async () => undefined),
      },
    })),
    executeCodexTurnWithRecovery: vi.fn(async (input) => {
      assert.equal(input.input.serviceTier, 'flex')
      assert.equal(input.input.turnTrigger, 'automation-cron')
      assert.equal(input.input.workingDirectory, undefined)
      assert.equal(input.progressDelivery, null)
      return {
        kind: 'succeeded',
        providerTurn: providerResult,
      }
    }),
    normalizeAssistantExecutionContext: vi.fn((value) => value),
    resolveAssistantExecutionDefaultTarget: vi.fn((input) =>
      input.executionContext?.hosted?.defaultTarget ?? input.fallbackTarget,
    ),
    resolveAssistantExecutionOperatorDefaults: vi.fn((input) =>
      input.executionContext?.hosted?.defaultTarget
        ? {
            ...(input.defaults ?? {}),
            backend: input.executionContext.hosted.defaultTarget,
          }
        : (input.defaults ?? null),
    ),
    persistAssistantTurnAndSession: vi.fn(async () => providerSession),
    recordAdditionalAssistantUsageEvents: vi.fn(async () => undefined),
    recordAssistantUsageEvent: vi.fn(async () => undefined),
    resolveAssistantOperatorDefaults: vi.fn(async () => ({
      timezone: 'Australia/Sydney',
    })),
    resolveAssistantSessionForMessage: vi.fn(async () => ({
      session: providerSession,
    })),
    resolveAssistantTurnRoute: vi.fn(() => providerResult.route),
    resolveAssistantTurnSharedPlan: vi.fn(async () => sharedPlan),
    withAssistantTurnLock: vi.fn(async (input: { run(): Promise<unknown> }) => await input.run()),
  }

  vi.doMock('@murphai/operator-config/operator-config', () => ({
    resolveAssistantOperatorDefaults: mocks.resolveAssistantOperatorDefaults,
  }))
  vi.doMock('@murphai/operator-config/assistant-backend', () => ({
    createDefaultLocalAssistantModelTarget: () => createCodexTarget(),
  }))
  vi.doMock('../src/assistant/runtime-state-service.js', () => ({
    createAssistantRuntimeStateService: mocks.createAssistantRuntimeStateService,
  }))
  vi.doMock('../src/assistant/execution-context.js', () => ({
    normalizeAssistantExecutionContext: mocks.normalizeAssistantExecutionContext,
    resolveAssistantExecutionDefaultTarget:
      mocks.resolveAssistantExecutionDefaultTarget,
    resolveAssistantExecutionOperatorDefaults:
      mocks.resolveAssistantExecutionOperatorDefaults,
  }))
  vi.doMock('../src/assistant/session-resolution.js', () => ({
    resolveAssistantSessionForMessage: mocks.resolveAssistantSessionForMessage,
  }))
  vi.doMock('../src/assistant/turn-plan.js', () => ({
    resolveAssistantTurnSharedPlan: mocks.resolveAssistantTurnSharedPlan,
  }))
  vi.doMock('../src/assistant/codex-turn-runner.js', () => ({
    executeCodexTurnWithRecovery: mocks.executeCodexTurnWithRecovery,
  }))
  vi.doMock('../src/assistant/service-usage.js', () => ({
    recordAdditionalAssistantUsageEvents: mocks.recordAdditionalAssistantUsageEvents,
    recordAssistantUsageEvent: mocks.recordAssistantUsageEvent,
  }))
  vi.doMock('../src/assistant/turn-finalizer.js', () => ({
    persistAssistantTurnAndSession: mocks.persistAssistantTurnAndSession,
  }))
  vi.doMock('../src/assistant/service-turn-routes.js', () => ({
    resolveAssistantTurnRoute: mocks.resolveAssistantTurnRoute,
  }))
  vi.doMock('../src/assistant/turns.js', () => ({
    createAssistantTurnId: () => 'turn-notification-skip',
  }))
  vi.doMock('../src/assistant/turn-lock.js', () => ({
    withAssistantTurnLock: mocks.withAssistantTurnLock,
  }))

  const { sendAssistantNotificationLocal } = await import(
    '../src/assistant/notification-turn.ts'
  )

  const result = await sendAssistantNotificationLocal({
    executionContext: {
      hosted: null,
    },
    instructions: 'Decide if the operator should be interrupted.',
    serviceTier: 'flex',
    vault: '/vaults/skip',
  })

  expect(result).toEqual({
    decision: {
      kind: 'skip',
      privateSummary: 'No notification required.',
    },
    response: null,
    session: providerSession,
  })
  expect(mocks.recordAssistantUsageEvent).toHaveBeenCalledTimes(1)
  expect(mocks.recordAdditionalAssistantUsageEvents).toHaveBeenCalledWith(
    expect.objectContaining({
      additionalUsages: [imageUsageDraft],
      turnId: 'turn-notification-skip',
    }),
  )
  expect(mocks.persistAssistantTurnAndSession).toHaveBeenCalledWith(
    expect.objectContaining({
      assistantTranscriptText: null,
      persistUserPromptToTranscript: false,
      providerResumeStateAction: 'persist-from-provider-turn',
    }),
  )
  expect(deliverMessage).not.toHaveBeenCalled()
})

test('sendAssistantNotificationLocal maps explicit no-reply to skip when skipping is allowed', async () => {
  const providerSession = createAssistantSession({
    sessionId: 'session-notification-no-reply',
  })
  const providerResult = createProviderResult({
    codexThreadHistoryUnsafe: true,
    finalAction: {
      kind: 'none',
    },
    response: '',
    session: providerSession,
  })
  const { deliverMessage, mocks, sendAssistantNotificationLocal } =
    await loadNotificationTurnHarness({
      providerResult,
      turnId: 'turn-notification-no-reply',
    })

  const result = await sendAssistantNotificationLocal({
    executionContext: {
      hosted: null,
    },
    instructions: 'Decide if the operator should be interrupted.',
    vault: '/vaults/no-reply-notification',
  })

  expect(result).toEqual({
    decision: {
      kind: 'skip',
      privateSummary:
        'Assistant completed the notification turn without a user-visible reply.',
    },
    response: null,
    session: providerSession,
  })
  expect(mocks.persistAssistantTurnAndSession).toHaveBeenCalledWith(
    expect.objectContaining({
      assistantTranscriptText: null,
      persistUserPromptToTranscript: false,
      providerResumeStateAction: 'clear',
    }),
  )
  expect(deliverMessage).not.toHaveBeenCalled()
})

test('sendAssistantNotificationLocal rejects explicit no-reply when sending is required', async () => {
  const providerSession = createAssistantSession({
    sessionId: 'session-notification-required-no-reply',
  })
  const providerResult = createProviderResult({
    finalAction: {
      kind: 'none',
    },
    response: '',
    session: providerSession,
  })
  const { deliverMessage, mocks, sendAssistantNotificationLocal } =
    await loadNotificationTurnHarness({
      providerResult,
      turnId: 'turn-notification-required-no-reply',
    })

  await expect(sendAssistantNotificationLocal({
    executionContext: {
      hosted: null,
    },
    instructions: 'Send a required notification.',
    responsePolicy: {
      kind: 'require_send',
    },
    vault: '/vaults/required-no-reply-notification',
  })).rejects.toMatchObject({
    code: 'ASSISTANT_NOTIFICATION_RESPONSE_REQUIRED',
  })
  expect(mocks.persistAssistantTurnAndSession).not.toHaveBeenCalled()
  expect(deliverMessage).not.toHaveBeenCalled()
})

test('sendAssistantNotificationLocal lets hosted shared planning stabilize provider cwd', async () => {
  const previousCwd = process.cwd()
  const vault = await mkdtemp(path.join(tmpdir(), 'assistant-notification-hosted-cwd-'))
  process.chdir(vault)
  vi.stubEnv('MURPH_HOSTED_RUNTIME_PROCESS', '1')

  try {
    const providerSession = createAssistantSession()
    const providerResult = createProviderResult({
      response: '```json\n{"kind":"skip","privateSummary":"No notification required."}\n```',
      session: providerSession,
    })
    const mocks = {
      executeCodexTurnWithRecovery: vi.fn(async (input) => {
        assert.equal(input.input.workingDirectory, undefined)
        assert.equal(input.plan.requestedWorkingDirectory, '/proc/self/cwd')
        return {
          kind: 'succeeded',
          providerTurn: providerResult,
        }
      }),
      recordAdditionalAssistantUsageEvents: vi.fn(async () => undefined),
    recordAssistantUsageEvent: vi.fn(async () => undefined),
      resolveAssistantOperatorDefaults: vi.fn(async () => ({
        timezone: 'Australia/Sydney',
      })),
      resolveAssistantSessionForMessage: vi.fn(async () => ({
        created: false,
        session: providerSession,
      })),
      resolveAssistantTurnRoute: vi.fn(() => providerResult.route),
      withAssistantTurnLock: vi.fn(async (input: { run(): Promise<unknown> }) => await input.run()),
    }

    vi.doMock('@murphai/operator-config/operator-config', () => ({
      resolveAssistantOperatorDefaults: mocks.resolveAssistantOperatorDefaults,
    }))
    vi.doMock('@murphai/operator-config/assistant-backend', async () => ({
      ...(await vi.importActual<typeof import('@murphai/operator-config/assistant-backend')>(
        '@murphai/operator-config/assistant-backend',
      )),
      createDefaultLocalAssistantModelTarget: () => createCodexTarget(),
    }))
    vi.doMock('../src/assistant/session-resolution.js', () => ({
      resolveAssistantSessionForMessage: mocks.resolveAssistantSessionForMessage,
    }))
    vi.doMock('../src/assistant/turn-plan.js', async () => {
      const actual = await vi.importActual<typeof import('../src/assistant/turn-plan.ts')>(
        '../src/assistant/turn-plan.js',
      )
      return {
        ...actual,
        resolveAssistantTurnSharedPlan: vi.fn(async (messageInput) => ({
          ...createSharedPlan(),
          requestedWorkingDirectory: actual.resolveAssistantRequestedWorkingDirectory(
            messageInput,
            {
              currentWorkingDirectory: vault,
              env: {
                MURPH_HOSTED_RUNTIME_PROCESS: '1',
              },
              platform: 'linux',
            },
          ),
        })),
      }
    })
    vi.doMock('../src/assistant/codex-turn-runner.js', () => ({
      executeCodexTurnWithRecovery: mocks.executeCodexTurnWithRecovery,
    }))
    vi.doMock('../src/assistant/service-usage.js', () => ({
      recordAdditionalAssistantUsageEvents: mocks.recordAdditionalAssistantUsageEvents,
      recordAssistantUsageEvent: mocks.recordAssistantUsageEvent,
    }))
    vi.doMock('../src/assistant/service-turn-routes.js', () => ({
      resolveAssistantTurnRoute: mocks.resolveAssistantTurnRoute,
    }))
    vi.doMock('../src/assistant/turns.js', () => ({
      createAssistantTurnId: () => 'turn-notification-hosted-cwd',
    }))
    vi.doMock('../src/assistant/turn-lock.js', () => ({
      withAssistantTurnLock: mocks.withAssistantTurnLock,
    }))

    const { sendAssistantNotificationLocal } = await import(
      '../src/assistant/notification-turn.ts'
    )

    const result = await sendAssistantNotificationLocal({
      executionContext: {
        hosted: {
          memberId: 'member_hosted_cwd',
          userEnvKeys: [],
        },
      },
      instructions: 'Decide if the operator should be interrupted.',
      vault,
    })

    expect(result.response).toBeNull()
    expect(result.decision.kind).toBe('skip')
    expect(mocks.executeCodexTurnWithRecovery).toHaveBeenCalledTimes(1)
  } finally {
    process.chdir(previousCwd)
    await rm(vault, {
      force: true,
      recursive: true,
    })
  }
})

test('sendAssistantNotificationLocal surfaces failed delivery results', async () => {
  const providerSession = createAssistantSession()
  const sharedPlan = createSharedPlan()
  const primaryRoute = createRoute({
    providerOptions: {
      model: 'gpt-5.5-primary',
    },
    routeId: 'route-primary',
  })
  const providerResult = createProviderResult({
    response: JSON.stringify({
      kind: 'send_message',
      text: 'Needs delivery',
      privateSummary: 'deliver',
    }),
    route: primaryRoute,
    session: providerSession,
  })
  const deliveryError = new Error('delivery exploded')
  const mocks = {
    createAssistantRuntimeStateService: vi.fn(() => ({
      outbox: {
        deliverMessage: vi.fn(async () => ({
          deliveryError,
          intent: {
            intentId: 'intent-delivery-error',
          },
          kind: 'failed',
        })),
      },
      status: {
        refreshSnapshot: vi.fn(async () => undefined),
      },
      turns: {
        createReceipt: vi.fn(async () => undefined),
        finalizeReceipt: vi.fn(async () => undefined),
      },
      diagnostics: {
        recordEvent: vi.fn(async () => undefined),
      },
    })),
    executeCodexTurnWithRecovery: vi.fn(async () => ({
      kind: 'succeeded',
      providerTurn: providerResult,
    })),
    normalizeAssistantExecutionContext: vi.fn((value) => value),
    resolveAssistantExecutionDefaultTarget: vi.fn((input) =>
      input.executionContext?.hosted?.defaultTarget ?? input.fallbackTarget,
    ),
    resolveAssistantExecutionOperatorDefaults: vi.fn((input) =>
      input.executionContext?.hosted?.defaultTarget
        ? {
            ...(input.defaults ?? {}),
            backend: input.executionContext.hosted.defaultTarget,
          }
        : (input.defaults ?? null),
    ),
    persistAssistantTurnAndSession: vi.fn(async () => providerSession),
    recordAdditionalAssistantUsageEvents: vi.fn(async () => undefined),
    recordAssistantUsageEvent: vi.fn(async () => undefined),
    resolveAssistantOperatorDefaults: vi.fn(async () => ({
      timezone: 'Australia/Sydney',
    })),
    resolveAssistantSessionForMessage: vi.fn(async () => ({
      session: providerSession,
    })),
    resolveAssistantTurnRoute: vi.fn(() => primaryRoute),
    resolveAssistantTurnSharedPlan: vi.fn(async () => sharedPlan),
    withAssistantTurnLock: vi.fn(async (input: { run(): Promise<unknown> }) => await input.run()),
  }

  vi.doMock('@murphai/operator-config/operator-config', () => ({
    resolveAssistantOperatorDefaults: mocks.resolveAssistantOperatorDefaults,
  }))
  vi.doMock('@murphai/operator-config/assistant-backend', () => ({
    createDefaultLocalAssistantModelTarget: () => createCodexTarget(),
  }))
  vi.doMock('../src/assistant/runtime-state-service.js', () => ({
    createAssistantRuntimeStateService: mocks.createAssistantRuntimeStateService,
  }))
  vi.doMock('../src/assistant/execution-context.js', () => ({
    normalizeAssistantExecutionContext: mocks.normalizeAssistantExecutionContext,
    resolveAssistantExecutionDefaultTarget:
      mocks.resolveAssistantExecutionDefaultTarget,
    resolveAssistantExecutionOperatorDefaults:
      mocks.resolveAssistantExecutionOperatorDefaults,
  }))
  vi.doMock('../src/assistant/session-resolution.js', () => ({
    resolveAssistantSessionForMessage: mocks.resolveAssistantSessionForMessage,
  }))
  vi.doMock('../src/assistant/turn-plan.js', () => ({
    resolveAssistantTurnSharedPlan: mocks.resolveAssistantTurnSharedPlan,
  }))
  vi.doMock('../src/assistant/codex-turn-runner.js', () => ({
    executeCodexTurnWithRecovery: mocks.executeCodexTurnWithRecovery,
  }))
  vi.doMock('../src/assistant/service-usage.js', () => ({
    recordAdditionalAssistantUsageEvents: mocks.recordAdditionalAssistantUsageEvents,
    recordAssistantUsageEvent: mocks.recordAssistantUsageEvent,
  }))
  vi.doMock('../src/assistant/turn-finalizer.js', () => ({
    persistAssistantTurnAndSession: mocks.persistAssistantTurnAndSession,
  }))
  vi.doMock('../src/assistant/service-turn-routes.js', () => ({
    resolveAssistantTurnRoute: mocks.resolveAssistantTurnRoute,
  }))
  vi.doMock('../src/assistant/turns.js', () => ({
    createAssistantTurnId: () => 'turn-notification-delivery-error',
  }))
  vi.doMock('../src/assistant/turn-lock.js', () => ({
    withAssistantTurnLock: mocks.withAssistantTurnLock,
  }))

  const { sendAssistantNotificationLocal } = await import(
    '../src/assistant/notification-turn.ts'
  )

  vi.stubEnv('LINQ_API_BASE_URL', 'https://linq.example.test/api/partner/v3')

  await expect(
    sendAssistantNotificationLocal({
      executionContext: {
        hosted: null,
      },
      instructions: 'Deliver this',
      vault: '/vaults/delivery-error',
    }),
  ).rejects.toThrow('delivery exploded')
  expect(mocks.createAssistantRuntimeStateService.mock.results[0]?.value.turns.createReceipt)
    .toHaveBeenCalledWith(expect.objectContaining({
      provider: 'codex-cli',
      providerModel: 'gpt-5.5-primary',
    }))
  expect((deliveryError as Error & {
    details?: Record<string, unknown>
  }).details).toMatchObject({
    assistantNotificationChannel: null,
    assistantNotificationDeliveryKind: null,
    assistantNotificationLinqBaseUrlOrigin: 'https://linq.example.test',
    assistantNotificationLinqBaseUrlPath: '/api/partner/v3',
    assistantNotificationProvider: 'codex-cli',
    assistantNotificationProviderBaseUrlOrigin: null,
    assistantNotificationProviderBaseUrlPath: null,
    assistantNotificationProviderModel: 'gpt-5.5-primary',
    assistantNotificationRouteId: 'route-primary',
    assistantNotificationStage: 'delivery',
  })
})

test('sendAssistantNotificationLocal forwards provider response media to delivery', async () => {
  const providerSession = createAssistantSession({
    binding: {
      actorId: 'actor-notification-media',
      channel: 'linq',
      conversationKey: null,
      delivery: {
        kind: 'thread',
        target: 'thread-notification-media',
      },
      identityId: 'identity-notification-media',
      threadId: 'thread-notification-media',
      threadIsDirect: true,
    },
  })
  const sharedPlan = createSharedPlan()
  const primaryRoute = createRoute({
    providerOptions: {
      model: 'gpt-5.5-primary',
    },
    routeId: 'route-primary',
  })
  const providerResult = createProviderResult({
    response: JSON.stringify({
      kind: 'send_message',
      text: 'Needs delivery',
      privateSummary: 'deliver',
    }),
    responseMedia: [
      {
        kind: 'image',
        url: 'https://cdn.example.test/notification.png',
        alt: 'notification',
        source: 'notification',
      },
    ],
    route: primaryRoute,
    session: providerSession,
  })
  const deliveryError = new Error('delivery exploded')
  const deliverMessage = vi.fn(async () => {
    throw deliveryError
  })
  const mocks = {
    createAssistantRuntimeStateService: vi.fn(() => ({
      outbox: {
        deliverMessage,
      },
      status: {
        refreshSnapshot: vi.fn(async () => undefined),
      },
      turns: {
        createReceipt: vi.fn(async () => undefined),
        finalizeReceipt: vi.fn(async () => undefined),
      },
      diagnostics: {
        recordEvent: vi.fn(async () => undefined),
      },
    })),
    executeCodexTurnWithRecovery: vi.fn(async () => ({
      kind: 'succeeded',
      providerTurn: providerResult,
    })),
    normalizeAssistantExecutionContext: vi.fn((value) => value),
    resolveAssistantExecutionDefaultTarget: vi.fn((input) =>
      input.executionContext?.hosted?.defaultTarget ?? input.fallbackTarget,
    ),
    resolveAssistantExecutionOperatorDefaults: vi.fn((input) =>
      input.executionContext?.hosted?.defaultTarget
        ? {
            ...(input.defaults ?? {}),
            backend: input.executionContext.hosted.defaultTarget,
          }
        : (input.defaults ?? null),
    ),
    persistAssistantTurnAndSession: vi.fn(async () => providerSession),
    recordAdditionalAssistantUsageEvents: vi.fn(async () => undefined),
    recordAssistantUsageEvent: vi.fn(async () => undefined),
    resolveAssistantOperatorDefaults: vi.fn(async () => ({
      timezone: 'Australia/Sydney',
    })),
    resolveAssistantSessionForMessage: vi.fn(async () => ({
      session: providerSession,
    })),
    resolveAssistantTurnRoute: vi.fn(() => primaryRoute),
    resolveAssistantTurnSharedPlan: vi.fn(async () => sharedPlan),
    withAssistantTurnLock: vi.fn(
      async (input: { run(): Promise<unknown> }) => await input.run(),
    ),
  }

  vi.doMock('@murphai/operator-config/operator-config', () => ({
    resolveAssistantOperatorDefaults: mocks.resolveAssistantOperatorDefaults,
  }))
  vi.doMock('@murphai/operator-config/assistant-backend', () => ({
    createDefaultLocalAssistantModelTarget: () => createCodexTarget(),
  }))
  vi.doMock('../src/assistant/runtime-state-service.js', () => ({
    createAssistantRuntimeStateService: mocks.createAssistantRuntimeStateService,
  }))
  vi.doMock('../src/assistant/execution-context.js', () => ({
    normalizeAssistantExecutionContext: mocks.normalizeAssistantExecutionContext,
    resolveAssistantExecutionDefaultTarget:
      mocks.resolveAssistantExecutionDefaultTarget,
    resolveAssistantExecutionOperatorDefaults:
      mocks.resolveAssistantExecutionOperatorDefaults,
  }))
  vi.doMock('../src/assistant/session-resolution.js', () => ({
    resolveAssistantSessionForMessage: mocks.resolveAssistantSessionForMessage,
  }))
  vi.doMock('../src/assistant/turn-plan.js', () => ({
    resolveAssistantTurnSharedPlan: mocks.resolveAssistantTurnSharedPlan,
  }))
  vi.doMock('../src/assistant/codex-turn-runner.js', () => ({
    executeCodexTurnWithRecovery: mocks.executeCodexTurnWithRecovery,
  }))
  vi.doMock('../src/assistant/service-usage.js', () => ({
    recordAdditionalAssistantUsageEvents: mocks.recordAdditionalAssistantUsageEvents,
    recordAssistantUsageEvent: mocks.recordAssistantUsageEvent,
  }))
  vi.doMock('../src/assistant/turn-finalizer.js', () => ({
    persistAssistantTurnAndSession: mocks.persistAssistantTurnAndSession,
  }))
  vi.doMock('../src/assistant/service-turn-routes.js', () => ({
    resolveAssistantTurnRoute: mocks.resolveAssistantTurnRoute,
  }))
  vi.doMock('../src/assistant/turns.js', () => ({
    createAssistantTurnId: () => 'turn-notification-delivery-throw',
  }))
  vi.doMock('../src/assistant/turn-lock.js', () => ({
    withAssistantTurnLock: mocks.withAssistantTurnLock,
  }))

  const { sendAssistantNotificationLocal } = await import(
    '../src/assistant/notification-turn.ts'
  )

  await expect(
    sendAssistantNotificationLocal({
      executionContext: {
        hosted: null,
      },
      instructions: 'Deliver this',
      vault: '/vaults/delivery-throw',
    }),
  ).rejects.toThrow('delivery exploded')
  expect(deliverMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      media: [
        {
          kind: 'image',
          url: 'https://cdn.example.test/notification.png',
          alt: 'notification',
          source: 'notification',
        },
      ],
      turnId: 'turn-notification-delivery-throw',
    }),
  )
})

test('sendAssistantNotificationLocal annotates terminal provider failures with route context', async () => {
  const providerSession = createAssistantSession()
  const sharedPlan = createSharedPlan()
  const providerError = new Error('provider route returned 404')
  const primaryRoute = createRoute({
    routeId: 'route-primary',
    providerOptions: {
      model: 'gpt-5.5-primary',
    },
  })
  const route = createRoute({
    routeId: 'route-provider-failure',
    providerOptions: {
      model: 'gpt-5.5-mini',
    },
  })
  const mocks = {
    executeCodexTurnWithRecovery: vi.fn(async () => ({
      error: providerError,
      kind: 'failed_terminal',
      route,
    })),
    normalizeAssistantExecutionContext: vi.fn((value) => value),
    resolveAssistantExecutionDefaultTarget: vi.fn((input) =>
      input.executionContext?.hosted?.defaultTarget ?? input.fallbackTarget,
    ),
    resolveAssistantExecutionOperatorDefaults: vi.fn((input) =>
      input.executionContext?.hosted?.defaultTarget
        ? {
            ...(input.defaults ?? {}),
            backend: input.executionContext.hosted.defaultTarget,
          }
        : (input.defaults ?? null),
    ),
    resolveAssistantOperatorDefaults: vi.fn(async () => ({
      timezone: 'Australia/Sydney',
    })),
    resolveAssistantSessionForMessage: vi.fn(async () => ({
      session: providerSession,
    })),
    resolveAssistantTurnRoute: vi.fn(() => primaryRoute),
    resolveAssistantTurnSharedPlan: vi.fn(async () => sharedPlan),
    withAssistantTurnLock: vi.fn(async (input: { run(): Promise<unknown> }) => await input.run()),
  }

  vi.doMock('@murphai/operator-config/operator-config', () => ({
    resolveAssistantOperatorDefaults: mocks.resolveAssistantOperatorDefaults,
  }))
  vi.doMock('@murphai/operator-config/assistant-backend', () => ({
    createDefaultLocalAssistantModelTarget: () => createCodexTarget(),
  }))
  vi.doMock('../src/assistant/execution-context.js', () => ({
    normalizeAssistantExecutionContext: mocks.normalizeAssistantExecutionContext,
    resolveAssistantExecutionDefaultTarget:
      mocks.resolveAssistantExecutionDefaultTarget,
    resolveAssistantExecutionOperatorDefaults:
      mocks.resolveAssistantExecutionOperatorDefaults,
  }))
  vi.doMock('../src/assistant/session-resolution.js', () => ({
    resolveAssistantSessionForMessage: mocks.resolveAssistantSessionForMessage,
  }))
  vi.doMock('../src/assistant/turn-plan.js', () => ({
    resolveAssistantTurnSharedPlan: mocks.resolveAssistantTurnSharedPlan,
  }))
  vi.doMock('../src/assistant/codex-turn-runner.js', () => ({
    executeCodexTurnWithRecovery: mocks.executeCodexTurnWithRecovery,
  }))
  vi.doMock('../src/assistant/service-turn-routes.js', () => ({
    resolveAssistantTurnRoute: mocks.resolveAssistantTurnRoute,
  }))
  vi.doMock('../src/assistant/turns.js', () => ({
    createAssistantTurnId: () => 'turn-notification-provider-error',
  }))
  vi.doMock('../src/assistant/turn-lock.js', () => ({
    withAssistantTurnLock: mocks.withAssistantTurnLock,
  }))

  const { sendAssistantNotificationLocal } = await import(
    '../src/assistant/notification-turn.ts'
  )

  await expect(
    sendAssistantNotificationLocal({
      executionContext: {
        hosted: null,
      },
      instructions: 'Deliver this',
      vault: '/vaults/provider-error',
    }),
  ).rejects.toThrow('provider route returned 404')
  expect((providerError as Error & {
    details?: Record<string, unknown>
  }).details).toMatchObject({
    assistantNotificationProvider: 'codex-cli',
    assistantNotificationProviderBaseUrlOrigin: null,
    assistantNotificationProviderBaseUrlPath: null,
    assistantNotificationProviderModel: 'gpt-5.5-mini',
    assistantNotificationRouteId: 'route-provider-failure',
    assistantNotificationStage: 'provider',
  })
})

test('sendAssistantNotificationLocal rejects email thread subject overrides before outbound delivery dispatch', async () => {
  const providerSession = createAssistantSession({
    binding: {
      actorId: 'actor-email-thread',
      channel: 'email',
      conversationKey: null,
      delivery: {
        kind: 'thread',
        target: 'thread-email-notification',
      },
      identityId: 'assistant@example.com',
      threadId: 'thread-email-notification',
      threadIsDirect: true,
    },
  })
  const sharedPlan = createSharedPlan()
  const providerResult = createProviderResult({
    response: JSON.stringify({
      kind: 'send_message',
      privateSummary: 'deliver',
      subject: 'Generated thread subject',
      text: 'Needs delivery',
    }),
    session: providerSession,
  })
  const deliverMessage = vi.fn()
  const mocks = {
    createAssistantRuntimeStateService: vi.fn(() => ({
      outbox: {
        deliverMessage,
      },
      status: {
        refreshSnapshot: vi.fn(async () => undefined),
      },
      turns: {
        createReceipt: vi.fn(async () => undefined),
        finalizeReceipt: vi.fn(async () => undefined),
      },
      diagnostics: {
        recordEvent: vi.fn(async () => undefined),
      },
    })),
    executeCodexTurnWithRecovery: vi.fn(async () => ({
      kind: 'succeeded',
      providerTurn: providerResult,
    })),
    normalizeAssistantExecutionContext: vi.fn((value) => value),
    resolveAssistantExecutionDefaultTarget: vi.fn((input) =>
      input.executionContext?.hosted?.defaultTarget ?? input.fallbackTarget,
    ),
    resolveAssistantExecutionOperatorDefaults: vi.fn((input) =>
      input.executionContext?.hosted?.defaultTarget
        ? {
            ...(input.defaults ?? {}),
            backend: input.executionContext.hosted.defaultTarget,
          }
        : (input.defaults ?? null),
    ),
    persistAssistantTurnAndSession: vi.fn(async () => providerSession),
    recordAdditionalAssistantUsageEvents: vi.fn(async () => undefined),
    recordAssistantUsageEvent: vi.fn(async () => undefined),
    resolveAssistantOperatorDefaults: vi.fn(async () => ({
      timezone: 'Australia/Sydney',
    })),
    resolveAssistantSessionForMessage: vi.fn(async () => ({
      session: providerSession,
    })),
    resolveAssistantTurnRoute: vi.fn(() => providerResult.route),
    resolveAssistantTurnSharedPlan: vi.fn(async () => sharedPlan),
    withAssistantTurnLock: vi.fn(async (input: { run(): Promise<unknown> }) => await input.run()),
  }

  vi.doMock('@murphai/operator-config/operator-config', () => ({
    resolveAssistantOperatorDefaults: mocks.resolveAssistantOperatorDefaults,
  }))
  vi.doMock('@murphai/operator-config/assistant-backend', () => ({
    createDefaultLocalAssistantModelTarget: () => createCodexTarget(),
  }))
  vi.doMock('../src/assistant/runtime-state-service.js', () => ({
    createAssistantRuntimeStateService: mocks.createAssistantRuntimeStateService,
  }))
  vi.doMock('../src/assistant/execution-context.js', () => ({
    normalizeAssistantExecutionContext: mocks.normalizeAssistantExecutionContext,
    resolveAssistantExecutionDefaultTarget:
      mocks.resolveAssistantExecutionDefaultTarget,
    resolveAssistantExecutionOperatorDefaults:
      mocks.resolveAssistantExecutionOperatorDefaults,
  }))
  vi.doMock('../src/assistant/session-resolution.js', () => ({
    resolveAssistantSessionForMessage: mocks.resolveAssistantSessionForMessage,
  }))
  vi.doMock('../src/assistant/turn-plan.js', () => ({
    resolveAssistantTurnSharedPlan: mocks.resolveAssistantTurnSharedPlan,
  }))
  vi.doMock('../src/assistant/codex-turn-runner.js', () => ({
    executeCodexTurnWithRecovery: mocks.executeCodexTurnWithRecovery,
  }))
  vi.doMock('../src/assistant/service-usage.js', () => ({
    recordAdditionalAssistantUsageEvents: mocks.recordAdditionalAssistantUsageEvents,
    recordAssistantUsageEvent: mocks.recordAssistantUsageEvent,
  }))
  vi.doMock('../src/assistant/turn-finalizer.js', () => ({
    persistAssistantTurnAndSession: mocks.persistAssistantTurnAndSession,
  }))
  vi.doMock('../src/assistant/service-turn-routes.js', () => ({
    resolveAssistantTurnRoute: mocks.resolveAssistantTurnRoute,
  }))
  vi.doMock('../src/assistant/turns.js', () => ({
    createAssistantTurnId: () => 'turn-notification-thread-subject',
  }))
  vi.doMock('../src/assistant/turn-lock.js', () => ({
    withAssistantTurnLock: mocks.withAssistantTurnLock,
  }))

  const { sendAssistantNotificationLocal } = await import(
    '../src/assistant/notification-turn.ts'
  )

  await expect(
    sendAssistantNotificationLocal({
      executionContext: {
        hosted: null,
      },
      instructions: 'Deliver this',
      vault: '/vaults/thread-subject',
    }),
  ).rejects.toThrow(
    'Email thread replies preserve the existing subject. Do not provide a subject override when replying to a thread.',
  )
  expect(mocks.persistAssistantTurnAndSession).toHaveBeenCalledTimes(1)
  expect(deliverMessage).not.toHaveBeenCalled()
})

describe('parseAssistantNotificationDecision', () => {
  test('accepts fenced JSON and extracted objects', async () => {
    const { parseAssistantNotificationDecision } = await import(
      '../src/assistant/notification-turn.ts'
    )

    expect(
      parseAssistantNotificationDecision(
        '```json\n{"kind":"send_message","text":"Hello","privateSummary":"brief"}\n```',
      ),
    ).toEqual({
      kind: 'send_message',
      privateSummary: 'brief',
      text: 'Hello',
    })
    expect(
      parseAssistantNotificationDecision(
        'Some preface\n{"kind":"skip","privateSummary":"No action"}\nSome trailing note',
      ),
    ).toEqual({
      kind: 'skip',
      privateSummary: 'No action',
    })
  })

  test('rejects missing or invalid decision objects with stable errors', async () => {
    const { parseAssistantNotificationDecision } = await import(
      '../src/assistant/notification-turn.ts'
    )

    expect(() => parseAssistantNotificationDecision('not json at all')).toThrowError(
      new VaultCliError(
        'ASSISTANT_NOTIFICATION_INVALID_RESPONSE',
        'Assistant notification turn must return a single valid JSON decision object.',
      ),
    )
    expect(() =>
      parseAssistantNotificationDecision('{"kind":"send_message","privateSummary":"brief"}'),
    ).toThrowError(
      new VaultCliError(
        'ASSISTANT_NOTIFICATION_INVALID_RESPONSE',
        'Assistant notification turn returned an invalid decision object.',
      ),
    )
  })
})

function createProviderOptions(
  overrides: Partial<AssistantProviderSessionOptions> = {},
): AssistantProviderSessionOptions {
  return serializeAssistantProviderSessionOptions({
    approvalPolicy: 'never',
    provider: 'codex-cli',
    model: 'gpt-5.5',
    modelProvider: 'vercel-ai-gateway',
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
    ...overrides,
  })
}

function createRoute(input?: {
  provider?: CodexThreadIdentity['provider']
  providerOptions?: Partial<AssistantProviderSessionOptions>
  routeId?: string
}): CodexThreadIdentity {
  return {
    codexCommand: null,
    label: 'Primary',
    provider: input?.provider ?? 'codex-cli',
    providerOptions: createProviderOptions(input?.providerOptions),
    routeId: input?.routeId ?? 'route-primary',
  }
}

function isTraceEventWithRawType(
  event: unknown,
  type: string,
): event is { rawEvent: Record<string, unknown> } {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return false
  }

  const rawEvent = (event as { rawEvent?: unknown }).rawEvent
  return (
    rawEvent !== null &&
    typeof rawEvent === 'object' &&
    !Array.isArray(rawEvent) &&
    (rawEvent as { type?: unknown }).type === type
  )
}

function createAssistantSession(input?: {
  binding?: AssistantSession['binding']
  providerOptions?: AssistantProviderSessionOptions
  resumeState?: AssistantSession['resumeState']
  sessionId?: string
  target?: AssistantSession['target']
  turnCount?: number
}): AssistantSession {
  const providerOptions = input?.providerOptions ?? createProviderOptions()
  const target =
    input?.target ??
    createAssistantModelTarget({
      provider: 'codex-cli',
      approvalPolicy: providerOptions.approvalPolicy,
      codexHome: providerOptions.codexHome ?? null,
      model: providerOptions.model,
      modelProvider: providerOptions.modelProvider ?? null,
      oss: providerOptions.oss,
      profile: providerOptions.profile,
      reasoningEffort: providerOptions.reasoningEffort ?? null,
      sandbox: providerOptions.sandbox,
    })

  if (!target) {
    throw new Error('Expected assistant session target.')
  }

  return {
    alias: null,
    binding:
      input?.binding ??
      {
        actorId: null,
        channel: null,
        conversationKey: null,
        delivery: null,
        identityId: null,
        threadId: null,
        threadIsDirect: null,
      },
    codexResume: input?.resumeState ?? null,
    codexTarget: target,
    conversationId: input?.sessionId ?? 'session-notification-test',
    createdAt: '2026-04-08T00:00:00.000Z',
    lastTurnAt: null,
    provider: 'codex-cli',
    providerOptions,
    resumeState: input?.resumeState ?? null,
    schema: 'murph.assistant-conversation.v2',
    sessionId: input?.sessionId ?? 'session-notification-test',
    target,
    turnCount: input?.turnCount ?? 0,
    updatedAt: '2026-04-08T00:00:00.000Z',
  }
}

function createCodexTarget(
  overrides: Partial<CodexAssistantTarget> = {},
): CodexAssistantTarget {
  return {
    adapter: 'codex-cli',
    approvalPolicy: 'never',
    codexCommand: null,
    codexHome: null,
    model: 'gpt-5.5',
    modelProvider: 'vercel-ai-gateway',
    oss: false,
    profile: null,
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
    ...overrides,
  }
}

function createSharedPlan(): AssistantTurnSharedPlan {
  return {
    cliAccess: {
      env: {},
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationPolicy: {
      audience: {
        actorId: null,
        bindingDelivery: null,
        channel: null,
        deliveryPolicy: 'not-requested',
        effectiveThreadIsDirect: null,
        explicitTarget: null,
        identityId: null,
        replyToMessageId: null,
        threadId: null,
        threadIsDirect: null,
      },
      operatorAuthority: 'direct-operator',
    },
    onboardingGuidanceOpen: false,
    firstContactStateDocIds: [],
    operatorAuthority: 'direct-operator',
    persistUserPromptOnFailure: false,
    requestedWorkingDirectory: '/tmp/assistant-notification-turn-runtime',
  }
}

async function loadNotificationTurnHarness(input: {
  providerResult: ExecutedAssistantProviderTurnResult
  turnId: string
}) {
  const deliverMessage = vi.fn()
  const sharedPlan = createSharedPlan()
  const mocks = {
    createAssistantRuntimeStateService: vi.fn(() => ({
      outbox: {
        deliverMessage,
      },
      status: {
        refreshSnapshot: vi.fn(async () => undefined),
      },
      turns: {
        createReceipt: vi.fn(async () => undefined),
        finalizeReceipt: vi.fn(async () => undefined),
      },
      diagnostics: {
        recordEvent: vi.fn(async () => undefined),
      },
    })),
    executeCodexTurnWithRecovery: vi.fn(async () => ({
      kind: 'succeeded',
      providerTurn: input.providerResult,
    })),
    normalizeAssistantExecutionContext: vi.fn((value) => value),
    resolveAssistantExecutionDefaultTarget: vi.fn((targetInput) =>
      targetInput.executionContext?.hosted?.defaultTarget ?? targetInput.fallbackTarget,
    ),
    resolveAssistantExecutionOperatorDefaults: vi.fn((targetInput) =>
      targetInput.executionContext?.hosted?.defaultTarget
        ? {
            ...(targetInput.defaults ?? {}),
            backend: targetInput.executionContext.hosted.defaultTarget,
          }
        : (targetInput.defaults ?? null),
    ),
    persistAssistantTurnAndSession: vi.fn(async () => input.providerResult.session),
    recordAdditionalAssistantUsageEvents: vi.fn(async () => undefined),
    recordAssistantUsageEvent: vi.fn(async () => undefined),
    resolveAssistantOperatorDefaults: vi.fn(async () => ({
      timezone: 'Australia/Sydney',
    })),
    resolveAssistantSessionForMessage: vi.fn(async () => ({
      session: input.providerResult.session,
    })),
    resolveAssistantTurnRoute: vi.fn(() => input.providerResult.route),
    resolveAssistantTurnSharedPlan: vi.fn(async () => sharedPlan),
    withAssistantTurnLock: vi.fn(async (lockInput: { run(): Promise<unknown> }) =>
      await lockInput.run()),
  }

  vi.doMock('@murphai/operator-config/operator-config', () => ({
    resolveAssistantOperatorDefaults: mocks.resolveAssistantOperatorDefaults,
  }))
  vi.doMock('@murphai/operator-config/assistant-backend', () => ({
    createDefaultLocalAssistantModelTarget: () => createCodexTarget(),
  }))
  vi.doMock('../src/assistant/runtime-state-service.js', () => ({
    createAssistantRuntimeStateService: mocks.createAssistantRuntimeStateService,
  }))
  vi.doMock('../src/assistant/execution-context.js', () => ({
    normalizeAssistantExecutionContext: mocks.normalizeAssistantExecutionContext,
    resolveAssistantExecutionDefaultTarget:
      mocks.resolveAssistantExecutionDefaultTarget,
    resolveAssistantExecutionOperatorDefaults:
      mocks.resolveAssistantExecutionOperatorDefaults,
  }))
  vi.doMock('../src/assistant/session-resolution.js', () => ({
    resolveAssistantSessionForMessage: mocks.resolveAssistantSessionForMessage,
  }))
  vi.doMock('../src/assistant/turn-plan.js', () => ({
    resolveAssistantTurnSharedPlan: mocks.resolveAssistantTurnSharedPlan,
  }))
  vi.doMock('../src/assistant/codex-turn-runner.js', () => ({
    executeCodexTurnWithRecovery: mocks.executeCodexTurnWithRecovery,
  }))
  vi.doMock('../src/assistant/service-usage.js', () => ({
    recordAdditionalAssistantUsageEvents: mocks.recordAdditionalAssistantUsageEvents,
    recordAssistantUsageEvent: mocks.recordAssistantUsageEvent,
  }))
  vi.doMock('../src/assistant/turn-finalizer.js', () => ({
    persistAssistantTurnAndSession: mocks.persistAssistantTurnAndSession,
  }))
  vi.doMock('../src/assistant/service-turn-routes.js', () => ({
    resolveAssistantTurnRoute: mocks.resolveAssistantTurnRoute,
  }))
  vi.doMock('../src/assistant/turns.js', () => ({
    createAssistantTurnId: () => input.turnId,
  }))
  vi.doMock('../src/assistant/turn-lock.js', () => ({
    withAssistantTurnLock: mocks.withAssistantTurnLock,
  }))

  const { sendAssistantNotificationLocal } = await import(
    '../src/assistant/notification-turn.ts'
  )

  return {
    deliverMessage,
    mocks,
    sendAssistantNotificationLocal,
  }
}

function createProviderResult(input?: {
  codexThreadHistoryUnsafe?: boolean | null
  providerOptions?: AssistantProviderSessionOptions
  codexThreadId?: string | null
  finalAction?: AssistantFinalAction
  responseMedia?: ExecutedAssistantProviderTurnResult['responseMedia']
  response?: string
  route?: CodexThreadIdentity
  session?: AssistantSession
  usage?: AssistantProviderUsage | null
}): ExecutedAssistantProviderTurnResult {
  const session = input?.session ?? createAssistantSession()
  const defaultUsage: AssistantProviderUsage = {
    apiKeyEnv: null,
    baseUrl: null,
    cacheWriteTokens: null,
    cachedInputTokens: null,
    inputTokens: 5,
    outputTokens: 8,
    providerMetadataJson: null,
    providerName: null,
    providerRequestId: null,
    rawUsageJson: null,
    reasoningTokens: null,
    requestedModel: null,
    servedModel: null,
    totalTokens: 13,
  }

  return {
    assistantContractFingerprint:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    attemptCount: 1,
    provider: 'codex-cli',
    codexContinuation: {
      kind: 'explicit-structured-history',
    },
    providerOptions: input?.providerOptions ?? createProviderOptions(),
    ...(input?.codexThreadHistoryUnsafe !== undefined
      ? { codexThreadHistoryUnsafe: input.codexThreadHistoryUnsafe }
      : {}),
    codexThreadId: input?.codexThreadId ?? 'provider-session-1',
    ...(input?.finalAction ? { finalAction: input.finalAction } : {}),
    rawEvents: [],
    response: input?.response ?? 'provider response',
    responseMedia: input?.responseMedia ?? [],
    route: input?.route ?? createRoute(),
    session,
    stderr: '',
    stdout: '',
    usage:
      input?.usage === undefined
        ? defaultUsage
        : input.usage === null
          ? null
          : { ...defaultUsage, ...input.usage },
    workingDirectory: '/tmp/assistant-notification-turn-runtime',
  }
}
