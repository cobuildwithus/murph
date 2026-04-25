import assert from 'node:assert/strict'

import { afterEach, describe, expect, test, vi } from 'vitest'

import type {
  AssistantProviderSessionOptions,
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { serializeAssistantProviderSessionOptions } from '@murphai/operator-config/assistant/provider-config'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { ResolvedAssistantFailoverRoute } from '../src/assistant/failover.ts'
import type { AssistantProviderUsage } from '../src/assistant/providers/types.ts'
import type {
  AssistantTurnSharedPlan,
  ExecutedAssistantProviderTurnResult,
} from '../src/assistant/service-contracts.ts'

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
  vi.doUnmock('../src/assistant/provider-turn-runner.js')
  vi.doUnmock('../src/assistant/service-usage.js')
  vi.doUnmock('../src/assistant/turn-finalizer.js')
  vi.doUnmock('../src/assistant/service-turn-routes.js')
  vi.doUnmock('../src/assistant/rich-content-routing.js')
  vi.doUnmock('../src/assistant/turns.js')
  vi.doUnmock('../src/assistant/turn-lock.js')
})

test('sendAssistantNotificationLocal persists the turn before outbound delivery and forwards the dedupe token', async () => {
  const persistedBeforeDelivery: string[] = []
  const traceEvents: unknown[] = []
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
      providerSessionId: 'provider-session-initial',
      resumeRouteId: 'route-initial',
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
    persistedBeforeDelivery.push('deliver')
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
    executeProviderTurnWithRecovery: vi.fn(async () => ({
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
      persistedBeforeDelivery.push('persist')
      return savedSession
    }),
    persistPendingAssistantUsageEvent: vi.fn(async () => undefined),
    prioritizeAssistantRoutesForRichUserMessageContent: vi.fn((input) => input.routes),
    resolveAssistantOperatorDefaults: vi.fn(async () => ({
      timezone: 'Australia/Sydney',
    })),
    resolveAssistantSessionForMessage: vi.fn(async () => ({
      created: false,
      session: initialSession,
    })),
    resolveAssistantTurnRoutes: vi.fn(() => [providerResult.route]),
    resolveAssistantTurnSharedPlan: vi.fn(async () => sharedPlan),
    withAssistantTurnLock: vi.fn(async (input: { run(): Promise<unknown> }) => await input.run()),
  }

  vi.doMock('@murphai/operator-config/operator-config', () => ({
    resolveAssistantOperatorDefaults: mocks.resolveAssistantOperatorDefaults,
  }))
  vi.doMock('@murphai/operator-config/assistant-backend', () => ({
    createDefaultLocalAssistantModelTarget: () => ({
      adapter: 'openai-compatible',
      model: 'gpt-5.4',
    }),
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
  vi.doMock('../src/assistant/provider-turn-runner.js', () => ({
    executeProviderTurnWithRecovery: mocks.executeProviderTurnWithRecovery,
  }))
  vi.doMock('../src/assistant/service-usage.js', () => ({
    persistPendingAssistantUsageEvent: mocks.persistPendingAssistantUsageEvent,
  }))
  vi.doMock('../src/assistant/turn-finalizer.js', () => ({
    persistAssistantTurnAndSession: mocks.persistAssistantTurnAndSession,
  }))
  vi.doMock('../src/assistant/service-turn-routes.js', () => ({
    resolveAssistantTurnRoutes: mocks.resolveAssistantTurnRoutes,
  }))
  vi.doMock('../src/assistant/rich-content-routing.js', () => ({
    prioritizeAssistantRoutesForRichUserMessageContent:
      mocks.prioritizeAssistantRoutesForRichUserMessageContent,
  }))
  vi.doMock('../src/assistant/turns.js', () => ({
    createAssistantTurnId: () => 'turn-notification',
  }))
  vi.doMock('../src/assistant/turn-lock.js', () => ({
    withAssistantTurnLock: mocks.withAssistantTurnLock,
  }))

  const { sendAssistantNotificationLocal } = await import(
    '../src/assistant/notification-turn.ts'
  )

  const result = await sendAssistantNotificationLocal({
    deliveryDedupeToken: 'cron-slot-token',
    executionContext: {
      hosted: {
        defaultTarget: {
          adapter: 'openai-compatible',
          apiKeyEnv: 'HOSTED_OPENAI_API_KEY',
          endpoint: 'https://gateway.example.com/v1',
          headers: null,
          model: 'gpt-4.1-mini',
          presetId: null,
          providerName: 'Hosted Gateway',
          reasoningEffort: null,
          webSearch: null,
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
  })

  assert.deepEqual(persistedBeforeDelivery, ['persist', 'deliver'])
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
  assert.equal(result.response, 'Raw notification text')
  assert.deepEqual(result.session, deliveredSession)
  const firstResolvedNotificationSessionCall = (
    mocks.resolveAssistantSessionForMessage.mock.calls as Array<
      Array<{ boundaryDefaultTarget?: unknown; defaults?: unknown }>
    >
  )[0]
  const firstResolvedNotificationSessionInput =
    firstResolvedNotificationSessionCall?.[0] as
      | { boundaryDefaultTarget?: unknown; defaults?: unknown }
      | undefined
  assert.deepEqual(
    firstResolvedNotificationSessionInput?.boundaryDefaultTarget,
    {
      adapter: 'openai-compatible',
      apiKeyEnv: 'HOSTED_OPENAI_API_KEY',
      endpoint: 'https://gateway.example.com/v1',
      headers: null,
      model: 'gpt-4.1-mini',
      presetId: null,
      providerName: 'Hosted Gateway',
      reasoningEffort: null,
      webSearch: null,
    },
  )
  assert.deepEqual(
    firstResolvedNotificationSessionInput?.defaults,
    {
      backend: {
        adapter: 'openai-compatible',
        apiKeyEnv: 'HOSTED_OPENAI_API_KEY',
        endpoint: 'https://gateway.example.com/v1',
        headers: null,
        model: 'gpt-4.1-mini',
        presetId: null,
        providerName: 'Hosted Gateway',
        reasoningEffort: null,
        webSearch: null,
      },
      timezone: 'Australia/Sydney',
    },
  )
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
    executeProviderTurnWithRecovery: vi.fn(async () => ({
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
    persistPendingAssistantUsageEvent: vi.fn(async () => undefined),
    prioritizeAssistantRoutesForRichUserMessageContent: vi.fn((input) => input.routes),
    resolveAssistantOperatorDefaults: vi.fn(async () => ({
      timezone: 'Australia/Sydney',
    })),
    resolveAssistantSessionForMessage: vi.fn(async () => ({
      session: providerSession,
    })),
    resolveAssistantTurnRoutes: vi.fn(() => [providerResult.route]),
    resolveAssistantTurnSharedPlan: vi.fn(async () => sharedPlan),
    withAssistantTurnLock: vi.fn(async (input: { run(): Promise<unknown> }) => await input.run()),
  }

  vi.doMock('@murphai/operator-config/operator-config', () => ({
    resolveAssistantOperatorDefaults: mocks.resolveAssistantOperatorDefaults,
  }))
  vi.doMock('@murphai/operator-config/assistant-backend', () => ({
    createDefaultLocalAssistantModelTarget: () => ({
      adapter: 'openai-compatible',
      model: 'gpt-5.4',
    }),
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
  vi.doMock('../src/assistant/provider-turn-runner.js', () => ({
    executeProviderTurnWithRecovery: mocks.executeProviderTurnWithRecovery,
  }))
  vi.doMock('../src/assistant/service-usage.js', () => ({
    persistPendingAssistantUsageEvent: mocks.persistPendingAssistantUsageEvent,
  }))
  vi.doMock('../src/assistant/turn-finalizer.js', () => ({
    persistAssistantTurnAndSession: mocks.persistAssistantTurnAndSession,
  }))
  vi.doMock('../src/assistant/service-turn-routes.js', () => ({
    resolveAssistantTurnRoutes: mocks.resolveAssistantTurnRoutes,
  }))
  vi.doMock('../src/assistant/rich-content-routing.js', () => ({
    prioritizeAssistantRoutesForRichUserMessageContent:
      mocks.prioritizeAssistantRoutesForRichUserMessageContent,
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

test('sendAssistantNotificationLocal returns skip decisions without persisting or delivering', async () => {
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
  const providerResult = createProviderResult({
    response: '```json\n{"kind":"skip","privateSummary":"No notification required."}\n```',
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
    executeProviderTurnWithRecovery: vi.fn(async (input) => {
      assert.equal(input.input.turnTrigger, 'automation-cron')
      assert.equal(input.input.workingDirectory, '/vaults/skip')
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
    persistPendingAssistantUsageEvent: vi.fn(async () => undefined),
    prioritizeAssistantRoutesForRichUserMessageContent: vi.fn((input) => input.routes),
    resolveAssistantOperatorDefaults: vi.fn(async () => ({
      timezone: 'Australia/Sydney',
    })),
    resolveAssistantSessionForMessage: vi.fn(async () => ({
      session: providerSession,
    })),
    resolveAssistantTurnRoutes: vi.fn(() => [providerResult.route]),
    resolveAssistantTurnSharedPlan: vi.fn(async () => sharedPlan),
    withAssistantTurnLock: vi.fn(async (input: { run(): Promise<unknown> }) => await input.run()),
  }

  vi.doMock('@murphai/operator-config/operator-config', () => ({
    resolveAssistantOperatorDefaults: mocks.resolveAssistantOperatorDefaults,
  }))
  vi.doMock('@murphai/operator-config/assistant-backend', () => ({
    createDefaultLocalAssistantModelTarget: () => ({
      adapter: 'openai-compatible',
      model: 'gpt-5.4',
    }),
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
  vi.doMock('../src/assistant/provider-turn-runner.js', () => ({
    executeProviderTurnWithRecovery: mocks.executeProviderTurnWithRecovery,
  }))
  vi.doMock('../src/assistant/service-usage.js', () => ({
    persistPendingAssistantUsageEvent: mocks.persistPendingAssistantUsageEvent,
  }))
  vi.doMock('../src/assistant/turn-finalizer.js', () => ({
    persistAssistantTurnAndSession: mocks.persistAssistantTurnAndSession,
  }))
  vi.doMock('../src/assistant/service-turn-routes.js', () => ({
    resolveAssistantTurnRoutes: mocks.resolveAssistantTurnRoutes,
  }))
  vi.doMock('../src/assistant/rich-content-routing.js', () => ({
    prioritizeAssistantRoutesForRichUserMessageContent:
      mocks.prioritizeAssistantRoutesForRichUserMessageContent,
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
  expect(mocks.persistPendingAssistantUsageEvent).toHaveBeenCalledTimes(1)
  expect(mocks.persistAssistantTurnAndSession).not.toHaveBeenCalled()
  expect(deliverMessage).not.toHaveBeenCalled()
})

test('sendAssistantNotificationLocal surfaces failed delivery results', async () => {
  const providerSession = createAssistantSession()
  const sharedPlan = createSharedPlan()
  const primaryRoute = createRoute({
    providerOptions: {
      baseUrl: 'https://api.primary.example.test/v1',
      model: 'gpt-4.1-primary',
    },
    routeId: 'route-primary',
  })
  const backupRoute = createRoute({
    providerOptions: {
      baseUrl: 'https://api.backup.example.test/v1',
      model: 'gpt-4.1-backup',
    },
    routeId: 'route-backup',
  })
  const providerResult = createProviderResult({
    response: JSON.stringify({
      kind: 'send_message',
      text: 'Needs delivery',
      privateSummary: 'deliver',
    }),
    route: backupRoute,
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
    executeProviderTurnWithRecovery: vi.fn(async () => ({
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
    persistPendingAssistantUsageEvent: vi.fn(async () => undefined),
    prioritizeAssistantRoutesForRichUserMessageContent: vi.fn((input) => input.routes),
    resolveAssistantOperatorDefaults: vi.fn(async () => ({
      timezone: 'Australia/Sydney',
    })),
    resolveAssistantSessionForMessage: vi.fn(async () => ({
      session: providerSession,
    })),
    resolveAssistantTurnRoutes: vi.fn(() => [primaryRoute, backupRoute]),
    resolveAssistantTurnSharedPlan: vi.fn(async () => sharedPlan),
    withAssistantTurnLock: vi.fn(async (input: { run(): Promise<unknown> }) => await input.run()),
  }

  vi.doMock('@murphai/operator-config/operator-config', () => ({
    resolveAssistantOperatorDefaults: mocks.resolveAssistantOperatorDefaults,
  }))
  vi.doMock('@murphai/operator-config/assistant-backend', () => ({
    createDefaultLocalAssistantModelTarget: () => ({
      adapter: 'openai-compatible',
      model: 'gpt-5.4',
    }),
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
  vi.doMock('../src/assistant/provider-turn-runner.js', () => ({
    executeProviderTurnWithRecovery: mocks.executeProviderTurnWithRecovery,
  }))
  vi.doMock('../src/assistant/service-usage.js', () => ({
    persistPendingAssistantUsageEvent: mocks.persistPendingAssistantUsageEvent,
  }))
  vi.doMock('../src/assistant/turn-finalizer.js', () => ({
    persistAssistantTurnAndSession: mocks.persistAssistantTurnAndSession,
  }))
  vi.doMock('../src/assistant/service-turn-routes.js', () => ({
    resolveAssistantTurnRoutes: mocks.resolveAssistantTurnRoutes,
  }))
  vi.doMock('../src/assistant/rich-content-routing.js', () => ({
    prioritizeAssistantRoutesForRichUserMessageContent:
      mocks.prioritizeAssistantRoutesForRichUserMessageContent,
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
      provider: 'openai-compatible',
      providerModel: 'gpt-4.1-backup',
    }))
  expect((deliveryError as Error & {
    details?: Record<string, unknown>
  }).details).toMatchObject({
    assistantNotificationChannel: null,
    assistantNotificationDeliveryKind: null,
    assistantNotificationLinqBaseUrlOrigin: 'https://linq.example.test',
    assistantNotificationLinqBaseUrlPath: '/api/partner/v3',
    assistantNotificationProvider: 'openai-compatible',
    assistantNotificationProviderBaseUrlOrigin: 'https://api.backup.example.test',
    assistantNotificationProviderBaseUrlPath: '/v1',
    assistantNotificationProviderModel: 'gpt-4.1-backup',
    assistantNotificationRouteId: 'route-backup',
    assistantNotificationStage: 'delivery',
  })
})

test('sendAssistantNotificationLocal annotates terminal provider failures with route context', async () => {
  const providerSession = createAssistantSession()
  const sharedPlan = createSharedPlan()
  const providerError = new Error('provider route returned 404')
  const primaryRoute = createRoute({
    routeId: 'route-primary',
    providerOptions: {
      baseUrl: 'https://gateway-primary.example.test/v1',
      model: 'gpt-4.1-primary',
    },
  })
  const route = createRoute({
    routeId: 'route-provider-failure',
    providerOptions: {
      baseUrl: 'https://gateway.example.test/v1',
      model: 'gpt-4.1-mini',
    },
  })
  const mocks = {
    executeProviderTurnWithRecovery: vi.fn(async () => ({
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
    prioritizeAssistantRoutesForRichUserMessageContent: vi.fn((input) => input.routes),
    resolveAssistantOperatorDefaults: vi.fn(async () => ({
      timezone: 'Australia/Sydney',
    })),
    resolveAssistantSessionForMessage: vi.fn(async () => ({
      session: providerSession,
    })),
    resolveAssistantTurnRoutes: vi.fn(() => [primaryRoute, route]),
    resolveAssistantTurnSharedPlan: vi.fn(async () => sharedPlan),
    withAssistantTurnLock: vi.fn(async (input: { run(): Promise<unknown> }) => await input.run()),
  }

  vi.doMock('@murphai/operator-config/operator-config', () => ({
    resolveAssistantOperatorDefaults: mocks.resolveAssistantOperatorDefaults,
  }))
  vi.doMock('@murphai/operator-config/assistant-backend', () => ({
    createDefaultLocalAssistantModelTarget: () => ({
      adapter: 'openai-compatible',
      model: 'gpt-5.4',
    }),
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
  vi.doMock('../src/assistant/provider-turn-runner.js', () => ({
    executeProviderTurnWithRecovery: mocks.executeProviderTurnWithRecovery,
  }))
  vi.doMock('../src/assistant/service-turn-routes.js', () => ({
    resolveAssistantTurnRoutes: mocks.resolveAssistantTurnRoutes,
  }))
  vi.doMock('../src/assistant/rich-content-routing.js', () => ({
    prioritizeAssistantRoutesForRichUserMessageContent:
      mocks.prioritizeAssistantRoutesForRichUserMessageContent,
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
    assistantNotificationProvider: 'openai-compatible',
    assistantNotificationProviderBaseUrlOrigin: 'https://gateway.example.test',
    assistantNotificationProviderBaseUrlPath: '/v1',
    assistantNotificationProviderModel: 'gpt-4.1-mini',
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
    executeProviderTurnWithRecovery: vi.fn(async () => ({
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
    persistPendingAssistantUsageEvent: vi.fn(async () => undefined),
    prioritizeAssistantRoutesForRichUserMessageContent: vi.fn((input) => input.routes),
    resolveAssistantOperatorDefaults: vi.fn(async () => ({
      timezone: 'Australia/Sydney',
    })),
    resolveAssistantSessionForMessage: vi.fn(async () => ({
      session: providerSession,
    })),
    resolveAssistantTurnRoutes: vi.fn(() => [providerResult.route]),
    resolveAssistantTurnSharedPlan: vi.fn(async () => sharedPlan),
    withAssistantTurnLock: vi.fn(async (input: { run(): Promise<unknown> }) => await input.run()),
  }

  vi.doMock('@murphai/operator-config/operator-config', () => ({
    resolveAssistantOperatorDefaults: mocks.resolveAssistantOperatorDefaults,
  }))
  vi.doMock('@murphai/operator-config/assistant-backend', () => ({
    createDefaultLocalAssistantModelTarget: () => ({
      adapter: 'openai-compatible',
      model: 'gpt-5.4',
    }),
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
  vi.doMock('../src/assistant/provider-turn-runner.js', () => ({
    executeProviderTurnWithRecovery: mocks.executeProviderTurnWithRecovery,
  }))
  vi.doMock('../src/assistant/service-usage.js', () => ({
    persistPendingAssistantUsageEvent: mocks.persistPendingAssistantUsageEvent,
  }))
  vi.doMock('../src/assistant/turn-finalizer.js', () => ({
    persistAssistantTurnAndSession: mocks.persistAssistantTurnAndSession,
  }))
  vi.doMock('../src/assistant/service-turn-routes.js', () => ({
    resolveAssistantTurnRoutes: mocks.resolveAssistantTurnRoutes,
  }))
  vi.doMock('../src/assistant/rich-content-routing.js', () => ({
    prioritizeAssistantRoutesForRichUserMessageContent:
      mocks.prioritizeAssistantRoutesForRichUserMessageContent,
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
    provider: 'openai-compatible',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.example.test/v1',
    headers: null,
    model: 'gpt-4.1',
    providerName: 'murph-openai',
    reasoningEffort: 'high',
    zeroDataRetention: null,
    ...overrides,
  })
}

function createRoute(input?: {
  provider?: ResolvedAssistantFailoverRoute['provider']
  providerOptions?: Partial<AssistantProviderSessionOptions>
  routeId?: string
}): ResolvedAssistantFailoverRoute {
  return {
    codexCommand: null,
    cooldownMs: 60_000,
    label: 'Primary',
    provider: input?.provider ?? 'openai-compatible',
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
      provider:
        providerOptions.baseUrl ||
        providerOptions.apiKeyEnv ||
        providerOptions.providerName ||
        providerOptions.headers ||
        providerOptions.zeroDataRetention === true
          ? 'openai-compatible'
          : 'codex-cli',
      approvalPolicy: providerOptions.approvalPolicy,
      apiKeyEnv: providerOptions.apiKeyEnv ?? null,
      baseUrl: providerOptions.baseUrl ?? null,
      codexHome: providerOptions.codexHome ?? null,
      headers: providerOptions.headers ?? null,
      model: providerOptions.model,
      oss: providerOptions.oss,
      profile: providerOptions.profile,
      providerName: providerOptions.providerName ?? null,
      reasoningEffort: providerOptions.reasoningEffort ?? null,
      sandbox: providerOptions.sandbox,
      zeroDataRetention: providerOptions.zeroDataRetention ?? null,
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
    createdAt: '2026-04-08T00:00:00.000Z',
    lastTurnAt: null,
    provider: target.adapter,
    providerOptions,
    resumeState: input?.resumeState ?? null,
    schema: 'murph.assistant-session.v1',
    sessionId: input?.sessionId ?? 'session-notification-test',
    target,
    turnCount: input?.turnCount ?? 0,
    updatedAt: '2026-04-08T00:00:00.000Z',
  }
}

function createSharedPlan(): AssistantTurnSharedPlan {
  return {
    allowSensitiveHealthContext: true,
    cliAccess: {
      env: {},
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationPolicy: {
      allowSensitiveHealthContext: true,
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

function createProviderResult(input?: {
  providerOptions?: AssistantProviderSessionOptions
  providerSessionId?: string | null
  response?: string
  route?: ResolvedAssistantFailoverRoute
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
    attemptCount: 1,
    provider: 'openai-compatible',
    providerOptions: input?.providerOptions ?? createProviderOptions(),
    providerSessionId: input?.providerSessionId ?? 'provider-session-1',
    rawEvents: [],
    response: input?.response ?? 'provider response',
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
