import assert from 'node:assert/strict'

import { afterEach, expect, test, vi } from 'vitest'

import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import type { InboxListResult } from '@murphai/operator-config/inbox-cli-contracts'
import type { AssistantChannelAdapter } from '../src/assistant/channel-adapters.ts'
import type { AssistantTurnSharedPlan } from '../src/assistant/service-contracts.ts'
import {
  createAssistantTurnBeforeDeliveryHook,
} from '../src/assistant/turn-input.js'

type Deferred<T> = {
  promise: Promise<T>
  reject(error: unknown): void
  resolve(value: T): void
}

afterEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.doUnmock('@murphai/operator-config/operator-config')
  vi.doUnmock('@murphai/operator-config/assistant-backend')
  vi.doUnmock('../src/assistant/store.js')
  vi.doUnmock('../src/assistant/outbox.js')
  vi.doUnmock('../src/assistant/diagnostics.js')
  vi.doUnmock('../src/assistant/status.js')
  vi.doUnmock('../src/assistant/turn-plan.js')
  vi.doUnmock('../src/assistant/session-resolution.js')
  vi.doUnmock('../src/assistant/delivery-service.js')
  vi.doUnmock('../src/assistant/turn-finalizer.js')
  vi.doUnmock('../src/assistant/turns.js')
  vi.doUnmock('../src/assistant/execution-context.js')
  vi.doUnmock('../src/assistant/provider-turn-recovery.js')
  vi.doUnmock('../src/assistant/provider-turn-runner.js')
  vi.doUnmock('../src/assistant/service-result.js')
  vi.doUnmock('../src/assistant/prompt-attempts.js')
  vi.doUnmock('../src/assistant/service-turn-routes.js')
  vi.doUnmock('../src/assistant/service-usage.js')
  vi.doUnmock('../src/assistant/channel-adapters.js')
  vi.doUnmock('../src/assistant/turn-lock.js')
})

test('sendAssistantMessageLocal completes a successful turn, persists usage, and stops typing indicators', async () => {
  const stopTyping = vi.fn(async () => undefined)
  const { mocks, sendAssistantMessageLocal, session } = await loadLocalServiceModule({
    adapter: {
      startTypingIndicator: vi.fn(async () => ({
        stop: stopTyping,
      })),
    },
  })

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    executionContext: {
      hosted: null,
    },
    prompt: 'Summarize my inbox',
    receiptMetadata: {
      source: 'test',
    },
    vault: '/vaults/test',
  })

  assert.deepEqual(result, {
    delivery: {
      channel: 'telegram',
      sentAt: '2026-04-08T12:00:05.000Z',
      target: 'thread-1',
      targetKind: 'thread',
    },
    deliveryDeferred: false,
    deliveryError: null,
    deliveryIntentId: 'intent-1',
    prompt: 'Summarize my inbox',
    response: 'assistant response',
    session,
    status: 'completed',
    vault: '<redacted-vault>',
  })
  assert.equal(mocks.withAssistantTurnLock.mock.calls.length, 1)
  assert.equal(mocks.resolveAssistantMessageSession.mock.calls.length, 1)
  assert.equal(mocks.appendAssistantTranscriptEntries.mock.calls.length, 1)
  assert.equal(mocks.appendAssistantTurnReceiptEvent.mock.calls.length, 1)
  assert.equal(mocks.persistPendingAssistantUsageEvent.mock.calls.length, 1)
  assert.equal(mocks.finalizeAssistantTurnArtifacts.mock.calls.length, 1)
  assert.equal(mocks.dispatchAssistantReply.mock.calls.length, 1)
  assert.equal(mocks.finalizeDeliveredAssistantTurn.mock.calls.length, 1)
  assert.equal(mocks.refreshAssistantStatusSnapshotLocal.mock.calls.length, 1)
  assert.equal(mocks.getAssistantChannelAdapter.mock.calls[0]?.[0], 'telegram')
  assert.equal(stopTyping.mock.calls.length, 1)
})

test('sendAssistantMessageLocal keeps manual chat on continuous provider-thread continuity', async () => {
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule()

  await sendAssistantMessageLocal({
    deliverResponse: false,
    prompt: 'Continue the chat',
    turnTrigger: 'manual-ask',
    vault: '/vaults/test',
  })

  assert.deepEqual(
    mocks.executeProviderTurnWithRecovery.mock.calls[0]?.[0]?.profile,
    {
      turnContinuityPolicy: 'continuous-provider-thread',
    },
  )
  assert.equal(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]?.turnContinuityPolicy,
    'continuous-provider-thread',
  )
})

test('sendAssistantMessageLocal keeps auto-reply turns on Murph history only', async () => {
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule()

  await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'Reply to the inbound message',
    turnTrigger: 'automation-auto-reply',
    vault: '/vaults/test',
  })

  assert.deepEqual(
    mocks.executeProviderTurnWithRecovery.mock.calls[0]?.[0]?.profile,
    {
      turnContinuityPolicy: 'murph-history-only',
    },
  )
  assert.equal(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]?.turnContinuityPolicy,
    'murph-history-only',
  )
})

test('sendAssistantMessageLocal keeps automation cron turns on Murph history only', async () => {
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule()

  await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'Run the scheduled automation',
    turnTrigger: 'automation-cron',
    vault: '/vaults/test',
  })

  assert.deepEqual(
    mocks.executeProviderTurnWithRecovery.mock.calls[0]?.[0]?.profile,
    {
      turnContinuityPolicy: 'murph-history-only',
    },
  )
  assert.equal(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]?.turnContinuityPolicy,
    'murph-history-only',
  )
})

test('sendAssistantMessageLocal prefers the hosted execution default target when resolving the session', async () => {
  const hostedDefaultTarget: AssistantSession['target'] = {
    adapter: 'openai-compatible',
    apiKeyEnv: 'HOSTED_OPENAI_API_KEY',
    endpoint: 'https://gateway.example.com/v1',
    headers: null,
    model: 'gpt-4.1-mini',
    presetId: null,
    providerName: 'Hosted Gateway',
    reasoningEffort: null,
    webSearch: null,
  }
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule()

  await sendAssistantMessageLocal({
    deliverResponse: false,
    executionContext: {
      hosted: {
        defaultTarget: hostedDefaultTarget,
        memberId: 'member-123',
        userEnvKeys: [],
      },
    },
    prompt: 'Use the hosted provider defaults.',
    vault: '/vaults/test',
  })

  assert.equal(mocks.resolveAssistantExecutionDefaultTarget.mock.calls.length, 1)
  assert.deepEqual(
    mocks.resolveAssistantExecutionDefaultTarget.mock.calls[0]?.[0],
    {
      executionContext: {
        hosted: {
          defaultTarget: hostedDefaultTarget,
          memberId: 'member-123',
          userEnvKeys: [],
        },
      },
      fallbackTarget: {
        adapter: 'openai-compatible',
        model: 'gpt-5.4',
      },
    },
  )
  const firstResolvedMessageSessionCall = (
    mocks.resolveAssistantMessageSession.mock.calls as Array<
      Array<{ boundaryDefaultTarget?: unknown; defaults?: unknown }>
    >
  )[0]
  const firstResolvedMessageSessionInput =
    firstResolvedMessageSessionCall?.[0] as
      | { boundaryDefaultTarget?: unknown; defaults?: unknown }
      | undefined
  assert.deepEqual(
    firstResolvedMessageSessionInput?.boundaryDefaultTarget,
    hostedDefaultTarget,
  )
  assert.deepEqual(
    firstResolvedMessageSessionInput?.defaults,
    {
      backend: hostedDefaultTarget,
      timezone: 'Australia/Sydney',
    },
  )
})

test('sendAssistantMessageLocal emits a hosted context trace after session resolution', async () => {
  vi.stubEnv('HOSTED_LOG_FINGERPRINT_SECRET', 'message-trace-secret')
  const traceEvents: unknown[] = []
  const session = createAssistantSession({
    binding: {
      actorId: 'actor-message-trace',
      channel: 'linq',
      conversationKey: null,
      delivery: {
        kind: 'thread',
        target: 'thread-message-trace',
      },
      identityId: 'identity-message-trace',
      threadId: 'thread-message-trace',
      threadIsDirect: true,
    },
    sessionId: 'session-message-trace',
  })
  const { sendAssistantMessageLocal } = await loadLocalServiceModule({
    session,
  })

  await sendAssistantMessageLocal({
    actorId: 'actor-message-trace',
    channel: 'linq',
    deliverResponse: false,
    executionContext: {
      hosted: {
        memberId: 'member-123',
        userEnvKeys: [],
      },
    },
    identityId: 'identity-message-trace',
    onTraceEvent(event) {
      traceEvents.push(event)
    },
    prompt: 'Use the hosted trace diagnostics.',
    threadId: 'thread-message-trace',
    threadIsDirect: true,
    vault: '/vaults/test',
  })

  const contextTrace = traceEvents.find((event) =>
    isTraceEventWithRawType(event, 'assistant.context.diagnostics'),
  )
  expect(contextTrace).toBeDefined()
  const rawEvent = (contextTrace as { rawEvent: Record<string, unknown> }).rawEvent
  expect(rawEvent).toEqual(expect.objectContaining({
    schema: 'murph.assistant-context-diagnostics.v1',
    type: 'assistant.context.diagnostics',
    source: 'assistant-message',
    stage: 'assistant-session-resolved',
    fingerprintReady: true,
    sessionResolutionCreated: false,
    sessionTurnCount: 0,
  }))
  expect(rawEvent.actorFingerprint).toMatch(/^h1_[a-f0-9]{24}$/u)
  expect(rawEvent.identityFingerprint).toMatch(/^h1_[a-f0-9]{24}$/u)
  expect(rawEvent.threadFingerprint).toMatch(/^h1_[a-f0-9]{24}$/u)
  expect(rawEvent.sessionFingerprint).toMatch(/^h1_[a-f0-9]{24}$/u)
  expect(JSON.stringify(rawEvent)).not.toContain('actor-message-trace')
  expect(JSON.stringify(rawEvent)).not.toContain('identity-message-trace')
  expect(JSON.stringify(rawEvent)).not.toContain('thread-message-trace')
  expect(JSON.stringify(rawEvent)).not.toContain('session-message-trace')
})

test('sendAssistantMessageLocal forwards onboarding fallback completion metadata to finalization', async () => {
  const session = createAssistantSession({
    sessionId: 'session-onboarding-fallback',
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    session,
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingCompletionFallbackReason: 'user_answered',
        onboardingGuidanceInjected: true,
        response: 'Thanks, that helps.',
        session,
      },
    },
  })

  await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: "Call me Sam. I've been dealing with low energy lately.",
    vault: '/vaults/test',
  })

  assert.equal(mocks.finalizeDeliveredAssistantTurn.mock.calls.length, 1)
  const [firstFinalizationCall] = mocks.finalizeDeliveredAssistantTurn.mock.calls
  const [finalizationInput] = firstFinalizationCall ?? []
  assert.deepEqual(finalizationInput, {
    firstContactStateDocIds: ['doc-1'],
    onboardingCompletionFallbackReason: 'user_answered',
    onboardingGuidanceInjected: true,
    outcome: {
      delivery: {
        channel: 'telegram',
        sentAt: '2026-04-08T12:00:05.000Z',
        target: 'thread-1',
        targetKind: 'thread',
      },
      intentId: 'intent-1',
      kind: 'sent',
      session,
    },
    response: 'Thanks, that helps.',
    turnId: 'turn-1',
    vault: '/vaults/test',
  })
})

test('sendAssistantMessageLocal marks delivery as blocked when a late capture requires revision', async () => {
  const lateCapture: InboxListResult['items'][number] = {
    captureId: 'capture-late',
    source: 'telegram',
    accountId: null,
    externalId: 'external-late',
    threadId: 'thread-1',
    threadTitle: null,
    threadIsDirect: true,
    actorId: 'actor-1',
    actorName: 'Sender',
    actorIsSelf: false,
    occurredAt: '2026-04-08T12:00:06.000Z',
    receivedAt: '2026-04-08T12:00:07.000Z',
    text: 'late follow up',
    attachmentCount: 0,
    envelopePath: 'inbox/telegram/capture-late.json',
    eventId: 'event-late',
    createdAt: '2026-04-08T12:00:08.000Z',
    promotions: [],
  }
  const beforeDelivery = createAssistantTurnBeforeDeliveryHook({
    afterCursor: {
      captureId: 'capture-1',
      createdAt: '2026-04-08T12:00:01.000Z',
      occurredAt: '2026-04-08T12:00:00.000Z',
    },
    conversation: {
      accountId: null,
      actorId: 'actor-1',
      actorIsSelf: false,
      source: 'telegram',
      threadId: 'thread-1',
      threadIsDirect: true,
    },
    knownCaptureIds: ['capture-1'],
    port: {
      async refresh() {
        return {
          progressed: true,
          reason: 'ingested_input',
        }
      },
      async listNewConversationCaptures(input) {
        assert.deepEqual(input.knownCaptureIds, ['capture-1'])
        return {
          captures: [lateCapture],
          nextCursor: {
            captureId: lateCapture.captureId,
            createdAt: lateCapture.createdAt,
            occurredAt: lateCapture.occurredAt,
          },
        }
      },
    },
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        response: 'draft response',
        session: createAssistantSession({
          sessionId: 'session-revision',
        }),
      },
    },
  })

  await assert.rejects(
    () =>
      sendAssistantMessageLocal({
        beforeDelivery,
        deliverResponse: true,
        prompt: 'Summarize my inbox',
        vault: '/vaults/test',
      }),
    (error) => error instanceof Error && error.name === 'AssistantTurnRevisionRequiredError',
  )

  assert.equal(mocks.finalizeAssistantTurnReceipt.mock.calls.length, 1)
  assert.equal(mocks.finalizeAssistantTurnReceipt.mock.calls[0]?.[0]?.status, 'blocked')
  assert.equal(
    mocks.finalizeAssistantTurnReceipt.mock.calls[0]?.[0]?.deliveryDisposition,
    'blocked',
  )
  assert.equal(mocks.recordAssistantDiagnosticEvent.mock.calls.length, 2)
  assert.equal(mocks.recordAssistantDiagnosticEvent.mock.calls[1]?.[0]?.kind, 'turn.blocked')
  assert.equal(mocks.persistPendingAssistantUsageEvent.mock.calls.length, 0)
  assert.equal(mocks.dispatchAssistantReply.mock.calls.length, 0)
  assert.equal(mocks.finalizeAssistantTurnArtifacts.mock.calls.length, 0)
})

test('sendAssistantMessageLocal admits active-turn input before delivery and continues inside one receipt', async () => {
  const { mocks, sendAssistantMessageLocal, session } = await loadLocalServiceModule()
  mocks.executeProviderTurnWithRecovery
    .mockResolvedValueOnce({
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        response: 'draft before late input',
        session,
      },
    })
    .mockResolvedValueOnce({
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        response: 'final after late input',
        session,
      },
    })
  const activeTurnInput = vi.fn(async (input) =>
    input.providerRequestOrdinal === 0
      ? {
          kind: 'accepted' as const,
          prompt: 'Initial prompt\n\nLate follow up',
          receiptMetadata: {
            captureIds: 'capture-1,capture-2',
          },
        }
      : {
          kind: 'no-new-input' as const,
        },
  )

  const result = await sendAssistantMessageLocal({
    activeTurnInput,
    deliverResponse: true,
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  })

  assert.equal(mocks.createAssistantTurnReceipt.mock.calls.length, 1)
  assert.equal(mocks.finalizeAssistantTurnReceipt.mock.calls.length, 0)
  assert.equal(mocks.executeProviderTurnWithRecovery.mock.calls.length, 2)
  assert.equal(
    mocks.executeProviderTurnWithRecovery.mock.calls[1]?.[0]?.input.prompt,
    'Initial prompt\n\nLate follow up',
  )
  assert.equal(mocks.finalizeAssistantTurnArtifacts.mock.calls.length, 1)
  assert.equal(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]?.input.prompt,
    'Initial prompt\n\nLate follow up',
  )
  assert.equal(mocks.dispatchAssistantReply.mock.calls.length, 1)
  assert.equal(result.prompt, 'Initial prompt\n\nLate follow up')
  assert.equal(result.response, 'final after late input')
})

test('sendAssistantMessageLocal runs best-effort failure cleanup and rethrows terminal provider failures', async () => {
  const terminalError = new Error('provider failed hard')
  const recoveredSession = createAssistantSession({
    sessionId: 'session-recovered',
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...createSharedPlan(),
      persistUserPromptOnFailure: false,
    },
    providerOutcome: {
      error: terminalError,
      kind: 'failed_terminal',
    },
    recoveredSession,
  })

  mocks.persistFailedAssistantPromptAttempt.mockRejectedValueOnce(
    new Error('ignore failed prompt persistence'),
  )
  mocks.finalizeAssistantTurnReceipt.mockRejectedValueOnce(
    new Error('ignore failed receipt finalization'),
  )
  mocks.recordAssistantDiagnosticEvent
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('ignore failed diagnostics'))
  mocks.refreshAssistantStatusSnapshotLocal.mockRejectedValueOnce(
    new Error('ignore failed status refresh'),
  )

  await assert.rejects(
    () =>
      sendAssistantMessageLocal({
        deliverResponse: false,
        prompt: 'Summarize my inbox',
        vault: '/vaults/test',
      }),
    (error) => {
      assert.equal(error, terminalError)
      return true
    },
  )

  assert.equal(mocks.appendAssistantTranscriptEntries.mock.calls.length, 0)
  assert.equal(mocks.persistFailedAssistantPromptAttempt.mock.calls.length, 1)
  assert.equal(
    mocks.persistFailedAssistantPromptAttempt.mock.calls[0]?.[0]?.persistUserPromptOnFailure,
    false,
  )
  assert.equal(
    mocks.persistFailedAssistantPromptAttempt.mock.calls[0]?.[0]?.prompt,
    'Summarize my inbox',
  )
  assert.equal(
    mocks.persistFailedAssistantPromptAttempt.mock.calls[0]?.[0]?.session,
    recoveredSession,
  )
  assert.equal(
    mocks.persistFailedAssistantPromptAttempt.mock.calls[0]?.[0]?.turnTrigger,
    'manual-ask',
  )
  assert.equal(
    mocks.persistFailedAssistantPromptAttempt.mock.calls[0]?.[0]?.vault,
    '/vaults/test',
  )
  assert.equal(mocks.finalizeAssistantTurnReceipt.mock.calls.length, 1)
  assert.equal(mocks.finalizeAssistantTurnReceipt.mock.calls[0]?.[0]?.status, 'failed')
  assert.equal(mocks.recordAssistantDiagnosticEvent.mock.calls.length, 2)
  assert.equal(mocks.recordAssistantDiagnosticEvent.mock.calls[1]?.[0]?.kind, 'turn.failed')
  assert.equal(mocks.normalizeAssistantDeliveryError.mock.calls.length, 1)
  assert.equal(mocks.refreshAssistantStatusSnapshotLocal.mock.calls.length, 1)
})

test('sendAssistantMessageLocal stops a typing indicator that resolves after the turn already finished', async () => {
  const typingIndicatorDeferred = createDeferred<{ stop(): Promise<void> }>()
  const stopCompleted = createDeferred<void>()
  const stopTyping = vi.fn(async () => {
    stopCompleted.resolve()
  })
  const { sendAssistantMessageLocal } = await loadLocalServiceModule({
    adapter: {
      startTypingIndicator: vi.fn(() => typingIndicatorDeferred.promise),
    },
  })

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'Summarize my inbox',
    vault: '/vaults/test',
  })

  assert.equal(result.status, 'completed')
  typingIndicatorDeferred.resolve({
    stop: stopTyping,
  })
  await stopCompleted.promise

  assert.equal(stopTyping.mock.calls.length, 1)
})

test('sendAssistantMessageLocal returns deferred delivery results and keeps typing in queue-only mode', async () => {
  const queuedSession = createAssistantSession({
    sessionId: 'session-queued',
  })
  const stopTyping = vi.fn(async () => undefined)
  const startTelegramTyping = vi.fn(async () => undefined)
  const startTypingIndicator = vi.fn<
    NonNullable<AssistantChannelAdapter['startTypingIndicator']>
  >(async () => ({
    stop: stopTyping,
  }))
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    adapter: {
      startTypingIndicator,
    },
    deliveryOutcome: {
      error: {
        code: 'ASSISTANT_DELIVERY_DEFERRED',
        message: 'queued for delivery',
        retryable: true,
      },
      intentId: 'intent-queued',
      kind: 'queued',
      session: queuedSession,
    },
  })

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    deliveryDispatchMode: 'queue-only',
    executionContext: {
      hosted: {
        channelTypingDependencies: {
          startTelegramTyping,
        },
        memberId: 'member-test',
        userEnvKeys: [],
      },
    },
    prompt: 'Queue this reply',
    vault: '/vaults/test',
  })

  assert.deepEqual(result, {
    delivery: null,
    deliveryDeferred: true,
    deliveryError: {
      code: 'ASSISTANT_DELIVERY_DEFERRED',
      message: 'queued for delivery',
      retryable: true,
    },
    deliveryIntentId: 'intent-queued',
    prompt: 'Queue this reply',
    response: 'assistant response',
    session: queuedSession,
    status: 'completed',
    vault: '<redacted-vault>',
  })
  assert.equal(mocks.getAssistantChannelAdapter.mock.calls.length, 1)
  assert.equal(startTypingIndicator.mock.calls.length, 1)
  assert.equal(startTypingIndicator.mock.calls[0]?.[1]?.startTelegramTyping, startTelegramTyping)
  assert.equal(stopTyping.mock.calls.length, 1)
})

test('sendAssistantMessageLocal reports failed delivery outcomes after provider success', async () => {
  const failedSession = createAssistantSession({
    sessionId: 'session-failed-delivery',
  })
  const failedDeliveryOutcome = {
    error: {
      code: 'ASSISTANT_DELIVERY_FAILED',
      message: 'delivery failed after provider success',
      retryable: false,
    },
    intentId: 'intent-failed',
    kind: 'failed' as const,
    session: failedSession,
  }
  const { sendAssistantMessageLocal } = await loadLocalServiceModule({
    deliveryOutcome: failedDeliveryOutcome,
  })

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'Deliver this reply',
    vault: '/vaults/test',
  })

  assert.deepEqual(result, {
    delivery: null,
    deliveryDeferred: false,
    deliveryError: {
      code: 'ASSISTANT_DELIVERY_FAILED',
      message: 'delivery failed after provider success',
      retryable: false,
    },
    deliveryIntentId: 'intent-failed',
    prompt: 'Deliver this reply',
    response: 'assistant response',
    session: failedSession,
    status: 'completed',
    vault: '<redacted-vault>',
  })
})

test('sendAssistantMessageLocal starts typing indicators for queue-only delivery', async () => {
  const stopTyping = vi.fn(async () => undefined)
  const startTypingIndicator = vi.fn(async () => ({
    stop: stopTyping,
  }))
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    adapter: {
      startTypingIndicator,
    },
  })

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    deliveryDispatchMode: 'queue-only',
    prompt: 'Summarize my inbox',
    vault: '/vaults/test',
  })

  assert.equal(result.status, 'completed')
  assert.equal(mocks.getAssistantChannelAdapter.mock.calls.length, 1)
  assert.equal(startTypingIndicator.mock.calls.length, 1)
  assert.equal(stopTyping.mock.calls.length, 1)
})

test('sendAssistantMessageLocal swallows typing-indicator startup failures', async () => {
  const startTypingIndicator = vi.fn(async () => {
    throw new Error('typing startup failed')
  })
  const { sendAssistantMessageLocal } = await loadLocalServiceModule({
    adapter: {
      startTypingIndicator,
    },
  })

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'Summarize my inbox',
    vault: '/vaults/test',
  })

  assert.equal(result.status, 'completed')
  assert.equal(startTypingIndicator.mock.calls.length, 1)
})

test('sendAssistantMessageLocal surfaces queued delivery state after queue-only typing', async () => {
  const stopTyping = vi.fn(async () => undefined)
  const startTypingIndicator = vi.fn(async () => ({
    stop: stopTyping,
  }))
  const queuedSession = createAssistantSession({
    sessionId: 'session-queued',
  })
  const queuedError = {
    code: 'ASSISTANT_DELIVERY_DEFERRED',
    message: 'delivery queued for retry',
    retryable: true,
  }
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    adapter: {
      startTypingIndicator,
    },
    deliveryOutcome: {
      error: queuedError,
      intentId: 'intent-queued',
      kind: 'queued',
      session: queuedSession,
    },
  })

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    deliveryDispatchMode: 'queue-only',
    prompt: 'Queue this response',
    vault: '/vaults/test',
  })

  assert.equal(result.status, 'completed')
  assert.equal(result.delivery, null)
  assert.equal(result.deliveryDeferred, true)
  assert.equal(result.deliveryIntentId, 'intent-queued')
  assert.deepEqual(result.deliveryError, queuedError)
  assert.equal(startTypingIndicator.mock.calls.length, 1)
  assert.equal(stopTyping.mock.calls.length, 1)
  assert.equal(mocks.finalizeDeliveredAssistantTurn.mock.calls.length, 1)
})

test('sendAssistantMessageLocal ignores typing-indicator startup failures', async () => {
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    adapter: {
      startTypingIndicator: vi.fn(async () => {
        throw new Error('typing startup failed')
      }),
    },
  })

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'Proceed anyway',
    vault: '/vaults/test',
  })

  assert.equal(result.status, 'completed')
  assert.equal(mocks.dispatchAssistantReply.mock.calls.length, 1)
  assert.equal(mocks.refreshAssistantStatusSnapshotLocal.mock.calls.length, 1)
})

test('sendAssistantMessageLocal skips typing indicators when delivery is not requested or unavailable', async () => {
  const disabledAdapter = {
    startTypingIndicator: vi.fn(async () => null),
  }
  const { sendAssistantMessageLocal } = await loadLocalServiceModule({
    adapter: disabledAdapter,
  })

  const noDelivery = await sendAssistantMessageLocal({
    deliverResponse: false,
    prompt: 'No delivery requested',
    vault: '/vaults/test',
  })
  assert.equal(noDelivery.status, 'completed')
  assert.equal(disabledAdapter.startTypingIndicator.mock.calls.length, 0)

  const noIndicator = await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'Adapter returns null',
    vault: '/vaults/test',
  })
  assert.equal(noIndicator.status, 'completed')
  assert.equal(disabledAdapter.startTypingIndicator.mock.calls.length, 1)
})

test('sendAssistantMessageLocal falls back to session defaults and not-requested delivery state when no route is resolved', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-04-08T16:30:00.000Z'))

  const session = createAssistantSession({
    sessionId: 'session-fallbacks',
  })
  session.binding.channel = null
  session.binding.delivery = null
  session.binding.identityId = null

  const plan = createSharedPlan()
  plan.conversationPolicy.audience = {
    actorId: null,
    bindingDelivery: null,
    channel: null,
    deliveryPolicy: 'binding-target-only',
    effectiveThreadIsDirect: false,
    explicitTarget: null,
    identityId: null,
    replyToMessageId: null,
    threadId: null,
    threadIsDirect: null,
  }

  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    deliveryOutcome: {
      intentId: 'intent-not-requested',
      kind: 'not-requested',
      session,
    },
    plan,
    routes: [],
    session,
    transcriptEntries: [],
  })

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'No explicit route please',
    vault: '/vaults/test',
  })

  assert.equal(result.delivery, null)
  assert.equal(result.deliveryDeferred, false)
  assert.equal(result.deliveryError, null)
  assert.equal(result.deliveryIntentId, null)
  assert.equal(result.session.sessionId, session.sessionId)
  assert.equal(mocks.createAssistantTurnReceipt.mock.calls[0]?.[0]?.provider, session.provider)
  assert.equal(mocks.createAssistantTurnReceipt.mock.calls[0]?.[0]?.providerModel, null)
  assert.equal(mocks.getAssistantChannelAdapter.mock.calls[0]?.[0], null)
  assert.match(
    String(mocks.appendAssistantTurnReceiptEvent.mock.calls[0]?.[0]?.at),
    /^2026-04-08T/u,
  )

  vi.useRealTimers()
})

test('sendAssistantMessageLocal records fallback failure metadata when persistence fails before a user turn exists', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-04-08T16:30:00.000Z'))

  const { mocks, sendAssistantMessageLocal, session } = await loadLocalServiceModule()
  mocks.appendAssistantTranscriptEntries.mockRejectedValueOnce(
    new Error('transcript persistence failed'),
  )
  mocks.extractRecoveredAssistantSession.mockReturnValueOnce(null)

  await assert.rejects(
    () =>
      sendAssistantMessageLocal({
        deliverResponse: false,
        prompt: 'Persist this later',
        turnTrigger: 'automation-cron',
        vault: '/vaults/test',
      }),
    /transcript persistence failed/u,
  )

  assert.equal(
    mocks.persistFailedAssistantPromptAttempt.mock.calls[0]?.[0]?.session,
    session,
  )
  assert.equal(
    mocks.persistFailedAssistantPromptAttempt.mock.calls[0]?.[0]?.turnCreatedAt,
    '2026-04-08T16:30:00.000Z',
  )
  assert.equal(
    mocks.persistFailedAssistantPromptAttempt.mock.calls[0]?.[0]?.turnTrigger,
    'automation-cron',
  )
  assert.equal(
    mocks.finalizeAssistantTurnReceipt.mock.calls[0]?.[0]?.deliveryDisposition,
    'not-requested',
  )
})

test('updateAssistantSessionOptionsLocal resolves and saves the refreshed session config', async () => {
  const updatedSession = createAssistantSession({
    sessionId: 'session-updated',
  })
  const { mocks, updateAssistantSessionOptionsLocal } = await loadLocalServiceModule()

  mocks.resolveAssistantSession.mockResolvedValueOnce({
    session: createAssistantSession({
      sessionId: 'session-updated',
      resumeState: {
        providerSessionId: 'provider-session-1',
        resumeRouteId: 'route-1',
      },
    }),
  })
  mocks.saveAssistantSession.mockResolvedValueOnce(updatedSession)

  const result = await updateAssistantSessionOptionsLocal({
    providerOptions: {
      model: 'gpt-5.4-mini',
      provider: 'openai-compatible',
      providerName: 'Updated Provider',
      reasoningEffort: 'low',
    },
    sessionId: 'session-updated',
    vault: '/vaults/test',
  })

  assert.equal(result, updatedSession)
  assert.equal(mocks.resolveAssistantSession.mock.calls.length, 1)
  assert.equal(mocks.saveAssistantSession.mock.calls.length, 1)
  assert.equal(
    mocks.saveAssistantSession.mock.calls[0]?.[1]?.providerOptions?.model,
    'gpt-5.4-mini',
  )
  assert.equal(mocks.saveAssistantSession.mock.calls[0]?.[1]?.provider, 'openai-compatible')
  assert.equal(mocks.saveAssistantSession.mock.calls[0]?.[1]?.target?.adapter, 'openai-compatible')
  assert.equal(mocks.saveAssistantSession.mock.calls[0]?.[1]?.resumeState, null)
})

test('updateAssistantSessionOptionsLocal preserves codex target-only fields', async () => {
  const updatedSession = createAssistantSession({
    provider: 'codex-cli',
    providerOptions: {
      provider: 'codex-cli',
      approvalPolicy: 'never',
      apiKeyEnv: undefined,
      baseUrl: undefined,
      codexHome: '/tmp/codex-home',
      continuityFingerprint: 'fingerprint-codex',
      executionDriver: 'codex-app-server',
      headers: undefined,
      model: 'gpt-5.5',
      oss: false,
      presetId: undefined,
      profile: 'prod',
      providerName: undefined,
      reasoningEffort: 'high',
      resumeKind: null,
      sandbox: 'workspace-write',
      webSearch: undefined,
      zeroDataRetention: undefined,
    },
    sessionId: 'session-codex-updated',
    target: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexCommand: '/opt/murph/bin/custom-codex',
      codexHome: '/tmp/codex-home',
      model: 'gpt-5.5',
      oss: false,
      profile: 'prod',
      reasoningEffort: 'high',
      sandbox: 'workspace-write',
    },
  })
  const { mocks, updateAssistantSessionOptionsLocal } = await loadLocalServiceModule()

  mocks.resolveAssistantSession.mockResolvedValueOnce({
    session: createAssistantSession({
      provider: 'codex-cli',
      providerOptions: {
        provider: 'codex-cli',
        approvalPolicy: 'never',
        apiKeyEnv: undefined,
        baseUrl: undefined,
        codexHome: '/tmp/codex-home',
        continuityFingerprint: 'fingerprint-codex',
        executionDriver: 'codex-app-server',
        headers: undefined,
        model: 'gpt-5.4',
        oss: false,
        presetId: undefined,
        profile: 'prod',
        providerName: undefined,
        reasoningEffort: 'high',
        resumeKind: null,
        sandbox: 'workspace-write',
        webSearch: undefined,
        zeroDataRetention: undefined,
      },
      sessionId: 'session-codex-updated',
      target: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: '/opt/murph/bin/custom-codex',
        codexHome: '/tmp/codex-home',
        model: 'gpt-5.4',
        oss: false,
        profile: 'prod',
        reasoningEffort: 'high',
        sandbox: 'workspace-write',
      },
    }),
  })
  mocks.saveAssistantSession.mockResolvedValueOnce(updatedSession)

  const result = await updateAssistantSessionOptionsLocal({
    providerOptions: {
      provider: 'codex-cli',
      model: 'gpt-5.5',
    },
    sessionId: 'session-codex-updated',
    vault: '/vaults/test',
  })

  assert.equal(result, updatedSession)
  assert.equal(
    mocks.saveAssistantSession.mock.calls[0]?.[1]?.target?.codexCommand,
    '/opt/murph/bin/custom-codex',
  )
  assert.equal(
    mocks.saveAssistantSession.mock.calls[0]?.[1]?.target?.codexHome,
    '/tmp/codex-home',
  )
  assert.equal(mocks.saveAssistantSession.mock.calls[0]?.[1]?.target?.model, 'gpt-5.5')
})

test('openAssistantConversationLocal forwards defaults into session resolution', async () => {
  const { mocks, openAssistantConversationLocal } = await loadLocalServiceModule()

  mocks.resolveAssistantSession.mockResolvedValueOnce({
    session: createAssistantSession({
      sessionId: 'session-open',
    }),
  })

  const result = await openAssistantConversationLocal({
    channel: 'telegram',
    vault: '/vaults/test',
  })

  assert.equal(result.session.sessionId, 'session-open')
  assert.equal(mocks.resolveAssistantOperatorDefaults.mock.calls.length, 1)
  assert.equal(mocks.resolveAssistantSession.mock.calls.length, 1)
})

async function loadLocalServiceModule(input?: {
  adapter?: {
    startTypingIndicator?: NonNullable<AssistantChannelAdapter['startTypingIndicator']>
  } | null
  plan?: ReturnType<typeof createSharedPlan>
  providerOutcome?:
    | {
        kind: 'failed_terminal'
        error: Error
      }
    | {
        kind: 'succeeded'
        providerTurn: {
          onboardingCompletionFallbackReason?: 'concrete_request' | 'user_answered' | 'user_declined' | 'manual' | null
          onboardingGuidanceInjected: boolean
          response: string
          session: AssistantSession
        }
      }
  recoveredSession?: AssistantSession | null
  deliveryOutcome?: {
    delivery?: {
      channel: string
      sentAt: string
      target: string
      targetKind: string
    } | null
    error?: {
      code: string
      message: string
      retryable?: boolean | null
    } | null
    intentId: string
    kind: 'failed' | 'not-requested' | 'queued' | 'sent'
    session: AssistantSession
  }
  routes?: Array<{
    provider: string
    providerOptions?: {
      model?: string | null
    } | null
  }>
  session?: AssistantSession
  transcriptEntries?: Array<{
    createdAt?: string | null
  }>
}) {
  const session = input?.session ?? createAssistantSession()
  const sharedPlan = input?.plan ?? createSharedPlan()
  const providerOutcome =
    input?.providerOutcome ?? {
      kind: 'succeeded' as const,
      providerTurn: {
        onboardingGuidanceInjected: true,
        response: 'assistant response',
        session,
      },
    }
  const deliveryOutcome =
    input?.deliveryOutcome ?? {
      delivery: {
        channel: 'telegram',
        sentAt: '2026-04-08T12:00:05.000Z',
        target: 'thread-1',
        targetKind: 'thread',
      },
      intentId: 'intent-1',
      kind: 'sent' as const,
      session,
    }

  const mocks = {
    appendAssistantTranscriptEntries: vi.fn(async () =>
      input?.transcriptEntries ?? [
        {
          createdAt: '2026-04-08T12:00:00.000Z',
        },
      ],
    ),
    appendAssistantTurnReceiptEvent: vi.fn(
      async (
        _input: Parameters<
          typeof import('../src/assistant/turns.js').appendAssistantTurnReceiptEvent
        >[0],
      ) => undefined,
    ),
    createAssistantTurnReceipt: vi.fn(
      async (
        _input: Parameters<
          typeof import('../src/assistant/turns.js').createAssistantTurnReceipt
        >[0],
      ) => ({
        turnId: 'turn-1',
      }),
    ),
    dispatchAssistantReply: vi.fn(async () => deliveryOutcome),
    executeProviderTurnWithRecovery: vi.fn(
      async (
        _input: Parameters<
          typeof import('../src/assistant/provider-turn-runner.js').executeProviderTurnWithRecovery
        >[0],
      ) => providerOutcome,
    ),
    extractRecoveredAssistantSession: vi.fn(() => input?.recoveredSession ?? null),
    finalizeAssistantTurnArtifacts: vi.fn(
      async (
        _input: Parameters<
          typeof import('../src/assistant/turn-finalizer.js').persistAssistantTurnAndSession
        >[0],
      ) => session,
    ),
    finalizeAssistantTurnReceipt: vi.fn(
      async (
        _input: Parameters<
          typeof import('../src/assistant/turns.js').finalizeAssistantTurnReceipt
        >[0],
      ) => undefined,
    ),
    finalizeDeliveredAssistantTurn: vi.fn(
      async (
        _input: Parameters<
          typeof import('../src/assistant/delivery-service.js').finalizeAssistantTurnFromDeliveryOutcome
        >[0],
      ) => undefined,
    ),
    getAssistantChannelAdapter: vi.fn((_channel: string | null) => input?.adapter ?? null),
    listAssistantTranscriptEntries: vi.fn(async () => []),
    normalizeAssistantAskResultForReturn: vi.fn((value) => value),
    normalizeAssistantDeliveryError: vi.fn((error: Error) => ({
      code: 'ASSISTANT_DELIVERY_FAILED',
      message: error.message,
    })),
    normalizeAssistantExecutionContext: vi.fn((value) => value ?? null),
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
    persistFailedAssistantPromptAttempt: vi.fn(
      async (
        _input: Parameters<
          typeof import('../src/assistant/prompt-attempts.js').persistFailedAssistantPromptAttempt
        >[0],
      ) => undefined,
    ),
    persistPendingAssistantUsageEvent: vi.fn(async () => undefined),
    recordAssistantDiagnosticEvent: vi.fn(
      async (
        _input: Parameters<
          typeof import('../src/assistant/diagnostics.js').recordAssistantDiagnosticEvent
        >[0],
      ) => undefined,
    ),
    redactAssistantDisplayPath: vi.fn(() => '<redacted-vault>'),
    refreshAssistantStatusSnapshotLocal: vi.fn(async () => undefined),
    saveAssistantSession: vi.fn(),
    resolveAssistantSession: vi.fn(),
    resolveAssistantMessageSession: vi.fn(async () => ({
      created: false,
      session,
    })),
    resolveAssistantOperatorDefaults: vi.fn(async () => ({
      timezone: 'Australia/Sydney',
    })),
    resolveAssistantTurnRoutes: vi.fn(() =>
      input?.routes ?? [
        {
          provider: 'openai-compatible',
          providerOptions: {
            model: 'gpt-5.4',
          },
        },
      ],
    ),
    withAssistantTurnLock: vi.fn(async (value: {
      run(): Promise<unknown>
    }) => await value.run()),
  }

  vi.doMock('@murphai/operator-config/operator-config', () => ({
    resolveAssistantOperatorDefaults: mocks.resolveAssistantOperatorDefaults,
  }))
  vi.doMock('@murphai/operator-config/assistant-backend', () => ({
    assistantBackendTargetToProviderConfigInput: (target: {
      adapter: 'codex-cli' | 'openai-compatible'
      apiKeyEnv?: string | null
      approvalPolicy?: string | null
      codexCommand?: string | null
      codexHome?: string | null
      endpoint?: string | null
      headers?: Record<string, string> | null
      model?: string | null
      oss?: boolean
      presetId?: string | null
      profile?: string | null
      providerName?: string | null
      reasoningEffort?: string | null
      sandbox?: string | null
      webSearch?: string | null
      zeroDataRetention?: boolean
    }) =>
      target.adapter === 'openai-compatible'
        ? {
            provider: 'openai-compatible',
            apiKeyEnv: target.apiKeyEnv ?? null,
            baseUrl: target.endpoint ?? null,
            headers: target.headers ?? null,
            model: target.model ?? null,
            presetId: target.presetId ?? null,
            providerName: target.providerName ?? null,
            reasoningEffort: target.reasoningEffort ?? null,
            webSearch: target.webSearch ?? null,
            zeroDataRetention: target.zeroDataRetention === true ? true : null,
          }
        : {
            provider: 'codex-cli',
            approvalPolicy: target.approvalPolicy ?? null,
            codexCommand: target.codexCommand ?? null,
            codexHome: target.codexHome ?? null,
            model: target.model ?? null,
            oss: target.oss === true,
            profile: target.profile ?? null,
            reasoningEffort: target.reasoningEffort ?? null,
            sandbox: target.sandbox ?? null,
          },
    createAssistantModelTarget: (input: {
      apiKeyEnv?: string | null
      approvalPolicy?: string | null
      codexCommand?: string | null
      codexHome?: string | null
      model?: string | null
      oss?: boolean
      policy?: {
        approvalPolicy?: string | null
        reasoningEffort?: string | null
        sandbox?: string | null
        webSearch?: string | null
      } | null
      profile?: string | null
      provider?: 'codex-cli' | 'openai-compatible' | null
      providerName?: string | null
      reasoningEffort?: string | null
      sandbox?: string | null
      target?: {
        kind: 'codex-cli' | 'openai-compatible' | 'responses'
        apiKeyEnv?: string | null
        baseUrl?: string | null
        codexCommand?: string | null
        codexHome?: string | null
        headers?: Record<string, string> | null
        model?: string | null
        oss?: boolean
        presetId?: string | null
        profile?: string | null
        providerName?: string | null
      } | null
    }) => {
      const provider =
        input.target?.kind === 'codex-cli'
          ? 'codex-cli'
          : input.target
            ? 'openai-compatible'
            : input.provider

      if (provider === 'openai-compatible') {
        return {
          adapter: 'openai-compatible',
          apiKeyEnv: input.target?.apiKeyEnv ?? input.apiKeyEnv ?? null,
          endpoint: input.target?.baseUrl ?? null,
          headers: input.target?.headers ?? null,
          model: input.target?.model ?? input.model ?? null,
          presetId: input.target?.presetId ?? null,
          providerName: input.target?.providerName ?? input.providerName ?? null,
          reasoningEffort: null,
          webSearch: input.policy?.webSearch ?? null,
        }
      }

      return provider === 'codex-cli'
        ? {
            adapter: 'codex-cli',
            approvalPolicy:
              input.policy?.approvalPolicy ?? input.approvalPolicy ?? null,
            codexCommand: input.target?.codexCommand ?? input.codexCommand ?? null,
            codexHome: input.target?.codexHome ?? input.codexHome ?? null,
            model: input.target?.model ?? input.model ?? null,
            oss: input.target?.oss ?? input.oss === true,
            profile: input.target?.profile ?? input.profile ?? null,
            reasoningEffort:
              input.policy?.reasoningEffort ?? input.reasoningEffort ?? null,
            sandbox: input.policy?.sandbox ?? input.sandbox ?? null,
          }
        : null
    },
    createDefaultLocalAssistantModelTarget: () => ({
      adapter: 'openai-compatible',
      model: 'gpt-5.4',
    }),
  }))
  vi.doMock('../src/assistant/store.js', () => ({
    appendAssistantTranscriptEntries: mocks.appendAssistantTranscriptEntries,
    listAssistantTranscriptEntries: mocks.listAssistantTranscriptEntries,
    redactAssistantDisplayPath: mocks.redactAssistantDisplayPath,
    resolveAssistantSession: mocks.resolveAssistantSession,
    saveAssistantSession: mocks.saveAssistantSession,
  }))
  vi.doMock('../src/assistant/outbox.js', () => ({
    normalizeAssistantDeliveryError: mocks.normalizeAssistantDeliveryError,
  }))
  vi.doMock('../src/assistant/diagnostics.js', () => ({
    recordAssistantDiagnosticEvent: mocks.recordAssistantDiagnosticEvent,
  }))
  vi.doMock('../src/assistant/status.js', () => ({
    refreshAssistantStatusSnapshotLocal: mocks.refreshAssistantStatusSnapshotLocal,
  }))
  vi.doMock('../src/assistant/turn-plan.js', () => ({
    resolveAssistantTurnSharedPlan: vi.fn(async () => sharedPlan),
  }))
  vi.doMock('../src/assistant/session-resolution.js', () => ({
    buildResolveAssistantSessionInput: vi.fn(),
    resolveAssistantSessionForMessage: mocks.resolveAssistantMessageSession,
  }))
  vi.doMock('../src/assistant/delivery-service.js', () => ({
    deliverAssistantReply: mocks.dispatchAssistantReply,
    finalizeAssistantTurnFromDeliveryOutcome: mocks.finalizeDeliveredAssistantTurn,
  }))
  vi.doMock('../src/assistant/turn-finalizer.js', () => ({
    persistAssistantTurnAndSession: mocks.finalizeAssistantTurnArtifacts,
  }))
  vi.doMock('../src/assistant/turns.js', () => ({
    appendAssistantTurnReceiptEvent: mocks.appendAssistantTurnReceiptEvent,
    createAssistantTurnReceipt: mocks.createAssistantTurnReceipt,
    finalizeAssistantTurnReceipt: mocks.finalizeAssistantTurnReceipt,
  }))
  vi.doMock('../src/assistant/execution-context.js', () => ({
    normalizeAssistantExecutionContext: mocks.normalizeAssistantExecutionContext,
    resolveAssistantExecutionDefaultTarget:
      mocks.resolveAssistantExecutionDefaultTarget,
    resolveAssistantExecutionOperatorDefaults:
      mocks.resolveAssistantExecutionOperatorDefaults,
  }))
  vi.doMock('../src/assistant/provider-turn-recovery.js', () => ({
    extractRecoveredAssistantSession: mocks.extractRecoveredAssistantSession,
  }))
  vi.doMock('../src/assistant/provider-turn-runner.js', () => ({
    executeProviderTurnWithRecovery: mocks.executeProviderTurnWithRecovery,
    resolveAssistantProviderTurnContinuityPolicy: vi.fn(
      (input: { turnTrigger?: string | null }) =>
        input.turnTrigger === 'automation-auto-reply' ||
        input.turnTrigger === 'automation-cron'
          ? 'murph-history-only'
          : 'continuous-provider-thread',
    ),
  }))
  vi.doMock('../src/assistant/service-result.js', () => ({
    normalizeAssistantAskResultForReturn: mocks.normalizeAssistantAskResultForReturn,
    serializeAssistantSessionForResult: vi.fn(),
  }))
  vi.doMock('../src/assistant/prompt-attempts.js', () => ({
    persistFailedAssistantPromptAttempt: mocks.persistFailedAssistantPromptAttempt,
  }))
  vi.doMock('../src/assistant/service-turn-routes.js', () => ({
    resolveAssistantTurnRoutes: mocks.resolveAssistantTurnRoutes,
  }))
  vi.doMock('../src/assistant/service-usage.js', () => ({
    persistPendingAssistantUsageEvent: mocks.persistPendingAssistantUsageEvent,
  }))
  vi.doMock('../src/assistant/channel-adapters.js', () => ({
    getAssistantChannelAdapter: mocks.getAssistantChannelAdapter,
  }))
  vi.doMock('../src/assistant/turn-input.js', () => ({
    AssistantActiveTurnInputBudgetExceededError: class AssistantActiveTurnInputBudgetExceededError extends Error {
      constructor() {
        super('Active turn input kept arriving before delivery; retry the expanded turn later.')
        this.name = 'AssistantActiveTurnInputBudgetExceededError'
      }
    },
    isAssistantTurnRevisionRequiredError: (value: unknown) =>
      value instanceof Error &&
      value.name === 'AssistantTurnRevisionRequiredError',
  }))
  vi.doMock('../src/assistant/turn-lock.js', () => ({
    withAssistantTurnLock: mocks.withAssistantTurnLock,
  }))

  const module = await import('../src/assistant/local-service.ts')
  return {
    ...module,
    mocks,
    deliveryOutcome,
    session,
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
  provider?: AssistantSession['provider']
  providerOptions?: Partial<AssistantSession['providerOptions']>
  resumeState?: AssistantSession['resumeState']
  sessionId?: string
  target?: AssistantSession['target']
}): AssistantSession {
  return {
    alias: null,
    binding:
      input?.binding ??
      {
        actorId: null,
        channel: 'telegram',
        conversationKey: null,
        delivery: {
          kind: 'thread',
          target: 'thread-1',
        },
        identityId: 'identity-1',
        threadId: 'thread-1',
        threadIsDirect: false,
      },
    createdAt: '2026-04-08T00:00:00.000Z',
    lastTurnAt: null,
    provider: input?.provider ?? 'openai-compatible',
    providerOptions: {
      provider: input?.provider ?? 'openai-compatible',
      apiKeyEnv: 'OPENAI_API_KEY',
      continuityFingerprint: 'fingerprint-openai',
      executionDriver: 'openai-compatible',
      model: 'gpt-5.4',
      oss: false,
      profile: null,
      providerName: 'OpenAI',
      reasoningEffort: null,
      resumeKind: null,
      sandbox: null,
      approvalPolicy: null,
      ...input?.providerOptions,
    },
    resumeState: input?.resumeState ?? null,
    schema: 'murph.assistant-session.v1',
    sessionId: input?.sessionId ?? 'session-test',
    target:
      input?.target ??
      {
        adapter: 'openai-compatible',
        apiKeyEnv: 'OPENAI_API_KEY',
        endpoint: null,
        headers: null,
        model: 'gpt-5.4',
        presetId: null,
        providerName: 'OpenAI',
        reasoningEffort: null,
        webSearch: null,
      },
    turnCount: 0,
    updatedAt: '2026-04-08T00:00:00.000Z',
  }
}

function createSharedPlan(): AssistantTurnSharedPlan {
  return {
    allowSensitiveHealthContext: false,
    cliAccess: {
      env: {},
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationPolicy: {
      audience: {
        actorId: null,
        bindingDelivery: null,
        channel: 'telegram',
        deliveryPolicy: 'binding-target-only',
        effectiveThreadIsDirect: false,
        explicitTarget: 'thread-1',
        identityId: 'identity-1',
        replyToMessageId: null,
        threadId: 'thread-1',
        threadIsDirect: false,
      },
      allowSensitiveHealthContext: false,
      operatorAuthority: 'direct-operator',
    },
    onboardingGuidanceOpen: false,
    firstContactStateDocIds: ['doc-1'],
    operatorAuthority: 'direct-operator',
    persistUserPromptOnFailure: true,
    requestedWorkingDirectory: '/workspace',
  }
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return {
    promise,
    reject,
    resolve,
  }
}
