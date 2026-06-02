import { readFile, rm } from 'node:fs/promises'
import assert from 'node:assert/strict'

import { afterEach, expect, test, vi } from 'vitest'

import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantChannelAdapter } from '../src/assistant/channel-adapters.ts'
import {
  readAssistantAcceptedTurnInputJournal,
  resolveAssistantAcceptedTurnInputJournalPath,
  type AssistantCodexContinuation,
} from '../src/assistant/active-turn-input-journal.ts'
import type { AssistantTurnSharedPlan } from '../src/assistant/service-contracts.ts'
import {
  AssistantActiveTurnInputCheckpointRejectedError,
  AssistantActiveTurnInputUnavailableError,
  type AssistantActiveTurnInputAdmissionHook,
  type AssistantActiveTurnInputCheckpointInput,
} from '../src/assistant/turn-input.js'
import type { AssistantProviderUsage } from '../src/assistant/providers/types.ts'
import { upsertAssistantInputEvent } from '../src/assistant/input-store.ts'
import { readAssistantTranscriptEntries } from '../src/assistant/store/persistence.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.ts'

type CodexAssistantTarget = Extract<
  AssistantSession['target'],
  { adapter: 'codex-cli' }
>

type Deferred<T> = {
  promise: Promise<T>
  reject(error: unknown): void
  resolve(value: T): void
}

const tempRoots: string[] = []
const CODEX_MODEL_PROVIDER_CONFIG = {
  id: 'vercel-ai-gateway',
  name: 'Vercel AI Gateway',
  baseUrl: 'https://ai-gateway.vercel.sh/v1',
  envKey: 'VERCEL_AI_API_KEY',
  wireApi: 'responses' as const,
}

afterEach(async () => {
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
  vi.doUnmock('../src/assistant/provider-failure-diagnostics.js')
  vi.doUnmock('../src/assistant/codex-turn-runner.js')
  vi.doUnmock('../src/assistant/service-result.js')
  vi.doUnmock('../src/assistant/prompt-attempts.js')
  vi.doUnmock('../src/assistant/service-turn-routes.js')
  vi.doUnmock('../src/assistant/service-usage.js')
  vi.doUnmock('../src/assistant/channel-adapters.js')
  vi.doUnmock('../src/assistant/runtime-state-service.js')
  vi.doUnmock('../src/assistant/turn-lock.js')
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
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
  assert.equal(mocks.recordAssistantUsageEvent.mock.calls.length, 1)
  assert.equal(mocks.finalizeAssistantTurnArtifacts.mock.calls.length, 1)
  assert.equal(mocks.dispatchAssistantReply.mock.calls.length, 1)
  assert.equal(mocks.finalizeDeliveredAssistantTurn.mock.calls.length, 1)
  assert.equal(mocks.refreshAssistantStatusSnapshotLocal.mock.calls.length, 1)
  assert.equal(mocks.getAssistantChannelAdapter.mock.calls[0]?.[0], 'telegram')
  assert.equal(stopTyping.mock.calls.length, 1)
})

test('sendAssistantMessageLocal keeps manual chat on the session Codex thread', async () => {
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule()

  await sendAssistantMessageLocal({
    deliverResponse: false,
    prompt: 'Continue the chat',
    turnTrigger: 'manual-ask',
    vault: '/vaults/test',
  })

  assert.deepEqual(
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.profile,
    {
      threadScope: 'session-thread',
    },
  )
  assert.equal(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.providerResumeStateAction,
    'persist-from-provider-turn',
  )
})

test('sendAssistantMessageLocal keeps auto-reply turns on the session Codex thread', async () => {
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule()

  await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'Reply to the inbound message',
    turnTrigger: 'automation-auto-reply',
    vault: '/vaults/test',
  })

  assert.deepEqual(
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.profile,
    {
      threadScope: 'session-thread',
    },
  )
  assert.equal(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.providerResumeStateAction,
    'persist-from-provider-turn',
  )
})

test('sendAssistantMessageLocal runs automation cron turns on isolated Codex threads', async () => {
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule()

  await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'Run the scheduled automation',
    turnTrigger: 'automation-cron',
    vault: '/vaults/test',
  })

  assert.deepEqual(
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.profile,
    {
      threadScope: 'isolated-thread',
    },
  )
  assert.equal(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.providerResumeStateAction,
    'preserve-existing',
  )
})

test('sendAssistantMessageLocal prefers the hosted execution default target when resolving the session', async () => {
  const hostedDefaultTarget = createCodexTarget({
    model: 'gpt-5.5-mini',
  })
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
      fallbackTarget: createCodexTarget(),
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
    isTraceEventWithRawType(event, 'assistant.context.diagnostics') &&
    (event as { rawEvent?: { stage?: unknown } }).rawEvent?.stage ===
      'assistant-session-resolved',
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

test('sendAssistantMessageLocal preserves resume state when active-turn fallback uses a provider fork', async () => {
  const { mocks, sendAssistantMessageLocal, session } = await loadLocalServiceModule({
    plan: {
      ...createSharedPlan(),
      persistUserPromptOnFailure: false,
    },
  })
  mocks.executeCodexTurnWithRecovery
    .mockImplementationOnce(async () => {
      return {
        kind: 'succeeded',
        providerTurn: {
          onboardingGuidanceInjected: true,
          codexContinuation: {
            kind: 'explicit-structured-history',
          },
          codexThreadId: 'provider-thread-active-turn',
          response: 'draft before late input',
          route: {
            routeId: 'route-active-turn',
          },
          session,
        },
      }
    })
    .mockImplementationOnce(async () => {
      return {
        kind: 'succeeded',
        providerTurn: {
          onboardingGuidanceInjected: true,
          codexContinuation: {
            kind: 'thread-start',
          },
          codexThreadId: 'provider-thread-active-turn',
          response: 'final after late input',
          route: {
            routeId: 'route-active-turn',
          },
          session,
        },
      }
    })
  let acceptedLateFollowUp = false
  const activeTurnInput = vi.fn<AssistantActiveTurnInputAdmissionHook>(async (input) => {
    if (input.phase !== 'request_boundary' || acceptedLateFollowUp) {
      return {
        kind: 'no-new-input' as const,
      }
    }
    acceptedLateFollowUp = true
    return {
      acceptedInputs: [
        {
          id: 'late-follow-up',
          promptFallbackReason: 'manual-input',
          promptFallbackText: 'Late follow up',
          source: 'manual',
        },
      ],
      kind: 'accepted' as const,
      prompt: 'Late follow up',
      receiptMetadata: {
        captureIds: 'capture-1,capture-2',
      },
      transcriptText: 'Late follow up',
    }
  })
  const activeTurnCheckpoint = vi.fn(
    async (_input: AssistantActiveTurnInputCheckpointInput) => undefined,
  )

  const result = await sendAssistantMessageLocal({
    activeTurnCheckpoint,
    activeTurnInput,
    deliverResponse: true,
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  })

  assert.equal(mocks.createAssistantTurnReceipt.mock.calls.length, 1)
  assert.equal(mocks.finalizeAssistantTurnReceipt.mock.calls.length, 0)
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 2)
  assert.equal(mocks.runtimeState.turns.acceptedInputs.append.mock.calls.length, 2)
  expect(
    mocks.runtimeState.turns.acceptedInputs.append.mock.calls[0]?.[0]?.inputs,
  ).toEqual([
      expect.objectContaining({
        id: 'initial',
        promptFallbackReason: 'manual-input',
        source: 'manual',
      }),
    ])
  expect(
    mocks.runtimeState.turns.acceptedInputs.append.mock.calls[1]?.[0]?.inputs,
  ).toEqual([
      expect.objectContaining({
        id: 'late-follow-up',
        promptFallbackReason: 'manual-input',
        promptFallbackText: 'Late follow up',
        source: 'manual',
      }),
    ])
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateTranscriptRefs.mock.calls[0]?.[0],
  ).toEqual({
    refs: [
      {
        inputId: 'initial',
        transcriptRef: {
          entryCreatedAt: '2026-04-08T12:00:00.000Z',
          entryIndex: 0,
          entryKind: 'user',
          sessionId: session.sessionId,
        },
      },
    ],
    turnId: 'turn-1',
  })
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateTranscriptRefs.mock.calls[1]?.[0],
  ).toEqual({
    refs: [
      {
        inputId: 'late-follow-up',
        transcriptRef: {
          entryCreatedAt: '2026-04-08T12:00:00.000Z',
          entryIndex: 1,
          entryKind: 'user',
          sessionId: session.sessionId,
        },
      },
    ],
    turnId: 'turn-1',
  })
  assert.deepEqual(activeTurnCheckpoint.mock.calls[0]?.[0], {
    acceptedInputIds: ['initial', 'late-follow-up'],
    providerRequestOrdinal: 0,
    sessionId: session.sessionId,
    signal: undefined,
    turnId: 'turn-1',
    vault: '/vaults/test',
  })
  assert.ok(
    mocks.appendAssistantTranscriptEntries.mock.invocationCallOrder[0]!
      < mocks.runtimeState.turns.acceptedInputs.updateTranscriptRefs.mock
        .invocationCallOrder[0]!,
  )
  assert.ok(
    mocks.runtimeState.turns.acceptedInputs.updateTranscriptRefs.mock
      .invocationCallOrder[0]!
      < mocks.runtimeState.turns.acceptedInputs.append.mock.invocationCallOrder[1]!,
  )
  assert.ok(
    mocks.runtimeState.turns.acceptedInputs.append.mock.invocationCallOrder[1]!
      < mocks.appendAssistantTranscriptEntries.mock.invocationCallOrder[1]!,
  )
  assert.ok(
    mocks.appendAssistantTranscriptEntries.mock.invocationCallOrder[1]!
      < mocks.runtimeState.turns.acceptedInputs.updateTranscriptRefs.mock
        .invocationCallOrder[1]!,
  )
  assert.ok(
    mocks.runtimeState.turns.acceptedInputs.updateTranscriptRefs.mock
      .invocationCallOrder[1]!
      < activeTurnCheckpoint.mock.invocationCallOrder[0]!,
  )
  assert.ok(
    mocks.runtimeState.turns.acceptedInputs.append.mock.invocationCallOrder[1]!
      < activeTurnCheckpoint.mock.invocationCallOrder[0]!,
  )
  assert.ok(
    activeTurnCheckpoint.mock.invocationCallOrder[0]!
      < mocks.executeCodexTurnWithRecovery.mock.invocationCallOrder[1]!,
  )
  assert.deepEqual(
    mocks.runtimeState.turns.acceptedInputs.recordProviderRequest.mock.calls.map(
      (call) => call[0]?.ordinal,
    ),
    [0, 1],
  )
  assert.deepEqual(
    mocks.runtimeState.turns.acceptedInputs.recordProviderRequest.mock.calls.map(
      (call) => call[0]?.continuation,
    ),
    [
      {
        kind: 'explicit-structured-history',
      },
      {
        kind: 'thread-start',
      },
    ],
  )
  assert.equal(
    mocks.executeCodexTurnWithRecovery.mock.calls[1]?.[0]?.input.prompt,
    'Late follow up',
  )
  expect(mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.progressDelivery)
    .toBeTruthy()
  expect(mocks.executeCodexTurnWithRecovery.mock.calls[1]?.[0]?.progressDelivery)
    .toBeTruthy()
  assert.deepEqual(
    mocks.executeCodexTurnWithRecovery.mock.calls[1]?.[0]?.resolvedSession
      .resumeState,
    {
      routeFingerprint: 'route-active-turn',
      threadId: 'provider-thread-active-turn',
    },
  )
  assert.deepEqual(
    mocks.executeCodexTurnWithRecovery.mock.calls[1]?.[0]?.activeTurnHistory
      ?.messages,
    [
      {
        content: 'Initial prompt',
        role: 'user',
      },
      {
        content: 'draft before late input',
        role: 'assistant',
      },
    ],
  )
  assert.deepEqual(
    mocks.recordAssistantUsageEvent.mock.calls.map(
      (call) => call[0]?.providerRequestOrdinal,
    ),
    [0, 1],
  )
  assert.equal(
    mocks.runtimeState.turns.acceptedInputs.updateAdmissionState.mock.calls[0]?.[0]
      ?.admissionState,
    'commit-started',
  )
  assert.equal(mocks.finalizeAssistantTurnArtifacts.mock.calls.length, 1)
  assert.equal(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]?.input.prompt,
    'Late follow up',
  )
  assert.equal(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.providerResumeStateAction,
    'persist-from-provider-turn',
  )
  assert.equal(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.persistUserPromptToTranscript,
    false,
  )
  assert.equal(mocks.appendAssistantTranscriptEntries.mock.calls.length, 2)
  assert.equal(
    mocks.appendAssistantTranscriptEntries.mock.calls[0]?.[2]?.[0]?.kind,
    'user',
  )
  assert.equal(
    mocks.appendAssistantTranscriptEntries.mock.calls[0]?.[2]?.[0]?.text,
    'Initial prompt',
  )
  assert.equal(
    typeof mocks.appendAssistantTranscriptEntries.mock.calls[0]?.[2]?.[0]
      ?.createdAt,
    'string',
  )
  assert.deepEqual(mocks.appendAssistantTranscriptEntries.mock.calls[1]?.[2], [
    {
      kind: 'user',
      text: 'Late follow up',
    },
  ])
  assert.equal(mocks.dispatchAssistantReply.mock.calls.length, 1)
  assert.equal(result.prompt, 'Late follow up')
  assert.equal(result.response, 'final after late input')
})

test('sendAssistantMessageLocal clears final resume state without a fresh final Codex thread', async () => {
  const session = createAssistantSession({
    resumeState: {
      routeFingerprint: 'old-route',
      threadId: 'old-provider-thread',
    },
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    session,
  })
  mocks.executeCodexTurnWithRecovery
    .mockImplementationOnce(async () => ({
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        codexThreadId: 'fresh-provider-thread',
        route: {
          routeId: 'fresh-route',
        },
        response: 'draft without fresh Codex thread',
        session,
      },
    }))
    .mockImplementationOnce(async () => ({
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'thread-start',
        },
        response: 'final after late input',
        session: {
          ...session,
          resumeState: null,
        },
      },
    }))
  let acceptedLateFollowUp = false
  const activeTurnInput = vi.fn<AssistantActiveTurnInputAdmissionHook>(async (input) => {
    if (input.phase !== 'request_boundary' || acceptedLateFollowUp) {
      return {
        kind: 'no-new-input' as const,
      }
    }
    acceptedLateFollowUp = true
    return {
      acceptedInputs: [
        {
          id: 'late-follow-up',
          promptFallbackReason: 'manual-input',
          promptFallbackText: 'Late follow up',
          source: 'manual',
        },
      ],
      kind: 'accepted' as const,
      prompt: 'Late follow up',
      receiptMetadata: {},
      transcriptText: 'Late follow up',
    }
  })

  await sendAssistantMessageLocal({
    activeTurnInput,
    deliverResponse: false,
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  })

  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 2)
  assert.equal(
    mocks.executeCodexTurnWithRecovery.mock.calls[1]?.[0]?.resolvedSession
      .resumeState?.threadId,
    'fresh-provider-thread',
  )
  assert.deepEqual(
    mocks.executeCodexTurnWithRecovery.mock.calls[1]?.[0]?.activeTurnHistory
      ?.messages,
    [
      {
        content: 'Initial prompt',
        role: 'user',
      },
      {
        content: 'draft without fresh Codex thread',
        role: 'assistant',
      },
    ],
  )
  assert.equal(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.providerResumeStateAction,
    'clear',
  )
})

test('sendAssistantMessageLocal journals provider request before provider execution resolves', async () => {
  const providerRelease = createDeferred<void>()
  const providerStarted = createDeferred<void>()
  let providerResolved = false
  const session = createAssistantSession()
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    session,
  })
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    providerStarted.resolve()
    await providerInput.onProviderRequestPlanned?.({
      providerAttemptId: null,
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
    })
    await providerRelease.promise
    providerResolved = true
    return {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        codexThreadId: 'provider-thread-default',
        response: 'assistant response',
        route: {
          routeId: 'route-default',
        },
        session,
      },
    }
  })

  const resultPromise = sendAssistantMessageLocal({
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  })
  await providerStarted.promise
  assert.equal(
    mocks.runtimeState.turns.acceptedInputs.recordProviderRequest.mock.calls.length,
    1,
  )
  assert.equal(providerResolved, false)

  providerRelease.resolve()
  const result = await resultPromise
  assert.equal(result.response, 'assistant response')
})

test('sendAssistantMessageLocal updates provider request metadata when final continuation changes', async () => {
  const session = createAssistantSession()
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    session,
  })
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    await providerInput.onProviderRequestPlanned?.({
      providerAttemptId: null,
      codexContinuation: {
        kind: 'provider-state-optimization',
      },
    })
    return {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        codexThreadId: 'provider-thread-default',
        response: 'assistant response',
        route: {
          routeId: 'route-default',
        },
        session,
      },
    }
  })

  const result = await sendAssistantMessageLocal({
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  })

  assert.equal(result.response, 'assistant response')
  assert.deepEqual(
    mocks.runtimeState.turns.acceptedInputs.recordProviderRequest.mock.calls[0]?.[0]
      ?.continuation,
    {
      kind: 'provider-state-optimization',
    },
  )
  assert.deepEqual(
    mocks.runtimeState.turns.acceptedInputs.updateProviderRequest.mock.calls[0]?.[0],
    {
      continuation: {
        kind: 'explicit-structured-history',
      },
      ordinal: 0,
      providerAttemptId: null,
      turnId: 'turn-1',
    },
  )
})

test('sendAssistantMessageLocal persists late manual accepted-input transcript refs to disk before checkpoint resumes', async () => {
  const context = await createTempVaultContext(
    'assistant-local-service-active-turn-journal-disk-',
  )
  tempRoots.push(context.parentRoot)
  const checkpointStarted = createDeferred<void>()
  let checkpointObserved = false
  const checkpointRelease = createDeferred<void>()
  const session = createAssistantSession({
    sessionId: 'session-active-turn-disk',
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...createSharedPlan(),
      persistUserPromptOnFailure: false,
    },
    realAcceptedInputPersistence: true,
    session,
  })
  mocks.executeCodexTurnWithRecovery
    .mockImplementationOnce(async () => {
      return {
        kind: 'succeeded',
        providerTurn: {
          onboardingGuidanceInjected: true,
          codexContinuation: {
            kind: 'explicit-structured-history',
          },
          response: 'draft before late input',
          session,
        },
      }
    })
    .mockImplementationOnce(async () => {
      return {
        kind: 'succeeded',
        providerTurn: {
          onboardingGuidanceInjected: true,
          codexContinuation: {
            kind: 'thread-start',
          },
          response: 'final after late input',
          session,
        },
      }
    })

  let acceptedLateFollowUp = false
  const activeTurnInput = vi.fn<AssistantActiveTurnInputAdmissionHook>(async (input) => {
    if (input.phase !== 'request_boundary' || acceptedLateFollowUp) {
      return {
        kind: 'no-new-input' as const,
      }
    }
    acceptedLateFollowUp = true
    return {
      acceptedInputs: [
        {
          id: 'late-follow-up',
          promptFallbackReason: 'manual-input',
          promptFallbackText: 'Late follow up',
          source: 'manual',
        },
      ],
      kind: 'accepted' as const,
      prompt: 'Late follow up',
      receiptMetadata: {
        captureIds: 'capture-1,capture-2',
      },
      transcriptText: 'Late follow up',
    }
  })
  const activeTurnCheckpoint = vi.fn(async () => {
    if (!checkpointObserved) {
      checkpointObserved = true
      checkpointStarted.resolve()
    }
    await checkpointRelease.promise
  })

  const resultPromise = sendAssistantMessageLocal({
    activeTurnCheckpoint,
    activeTurnInput,
    deliverResponse: true,
    prompt: 'Initial prompt',
    vault: context.vaultRoot,
  })

  try {
    await checkpointStarted.promise

    const transcriptEntries = await readAssistantTranscriptEntries(
      resolveAssistantStatePaths(context.vaultRoot),
      session.sessionId,
    )
    const initialTranscriptEntry = transcriptEntries.find(
      (entry) => entry.kind === 'user' && entry.text === 'Initial prompt',
    )
    expect(initialTranscriptEntry).toBeDefined()
    const initialTranscriptEntryIndex =
      initialTranscriptEntry === undefined
        ? -1
        : transcriptEntries.indexOf(initialTranscriptEntry)
    expect(initialTranscriptEntryIndex).toBeGreaterThanOrEqual(0)
    const lateTranscriptEntry = transcriptEntries.find(
      (entry) => entry.kind === 'user' && entry.text === 'Late follow up',
    )
    expect(lateTranscriptEntry).toBeDefined()
    const lateTranscriptEntryIndex =
      lateTranscriptEntry === undefined
        ? -1
        : transcriptEntries.indexOf(lateTranscriptEntry)
    expect(lateTranscriptEntryIndex).toBeGreaterThanOrEqual(0)

    const journal = await readAssistantAcceptedTurnInputJournal(
      context.vaultRoot,
      'turn-1',
    )
    expect(journal).not.toBeNull()
    expect(journal?.inputs).toHaveLength(2)
    expect(journal?.inputs[0]).toMatchObject({
      id: 'initial',
      promptFallback: {
        reason: 'manual-input',
        textLengthBucket: '1-64',
      },
      transcriptRef: {
        entryCreatedAt: initialTranscriptEntry?.createdAt,
        entryIndex: initialTranscriptEntryIndex,
        entryKind: 'user',
        sessionId: session.sessionId,
      },
    })
    expect(journal?.inputs[1]).toMatchObject({
      id: 'late-follow-up',
      promptFallback: {
        reason: 'manual-input',
        textLengthBucket: '1-64',
      },
      transcriptRef: {
        entryCreatedAt: lateTranscriptEntry?.createdAt,
        entryIndex: lateTranscriptEntryIndex,
        entryKind: 'user',
        sessionId: session.sessionId,
      },
    })

    const journalPath = resolveAssistantAcceptedTurnInputJournalPath(
      resolveAssistantStatePaths(context.vaultRoot),
      'turn-1',
    )
    const persistedRaw = await readFile(journalPath, 'utf8')
    expect(persistedRaw).not.toContain('Initial prompt')
    expect(persistedRaw).not.toContain('Late follow up')
  } finally {
    checkpointRelease.resolve()
    await resultPromise.catch(() => undefined)
  }

  await expect(resultPromise).resolves.toMatchObject({
    prompt: 'Late follow up',
    response: 'final after late input',
  })
})

test('sendAssistantMessageLocal rejects initial assistant-input refs before provider execution when the event is missing', async () => {
  const context = await createTempVaultContext(
    'assistant-local-service-initial-input-ref-missing-',
  )
  tempRoots.push(context.parentRoot)
  const session = createAssistantSession({
    sessionId: 'session-initial-input-ref-missing',
  })
  const startTypingIndicator = vi.fn(async () => ({
    stop: vi.fn(async () => undefined),
  }))
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    adapter: {
      startTypingIndicator,
    },
    plan: {
      ...createSharedPlan(),
      persistUserPromptOnFailure: false,
    },
    realAcceptedInputPersistence: true,
    session,
  })

  await expect(
    sendAssistantMessageLocal({
      acceptedTurnInput: {
        initialInputs: [
          {
            contentRef: {
              kind: 'assistant-input-event',
              refId: 'ain_00000000000000000000000000000004',
              version: 'murph.assistant-input-event.v1',
            },
            id: 'ain_00000000000000000000000000000004',
            source: 'assistant-input',
          },
        ],
      },
      deliverResponse: true,
      prompt: 'Initial prompt',
      vault: context.vaultRoot,
    }),
  ).rejects.toMatchObject({
    code: 'ASSISTANT_TURN_INPUT_JOURNAL_MISSING_ASSISTANT_INPUT_EVENT',
  })
  expect(mocks.executeCodexTurnWithRecovery).not.toHaveBeenCalled()
  expect(mocks.createAssistantTurnReceipt).not.toHaveBeenCalled()
  expect(mocks.recordAssistantDiagnosticEvent).not.toHaveBeenCalled()
  expect(mocks.persistFailedAssistantPromptAttempt).not.toHaveBeenCalled()
  expect(startTypingIndicator).not.toHaveBeenCalled()

  const transcriptEntries = await readAssistantTranscriptEntries(
    resolveAssistantStatePaths(context.vaultRoot),
    session.sessionId,
  )
  expect(
    transcriptEntries.some((entry) => entry.text === 'Initial prompt'),
  ).toBe(false)
})

test('sendAssistantMessageLocal rejects initial assistant-input refs before manual active-turn steering', async () => {
  const context = await createTempVaultContext(
    'assistant-local-service-manual-steer-input-ref-missing-',
  )
  tempRoots.push(context.parentRoot)
  const session = createAssistantSession({
    binding: {
      actorId: null,
      channel: 'telegram',
      conversationKey: 'channel:telegram|identity:identity-1|thread:thread-1',
      delivery: {
        kind: 'thread',
        target: 'thread-1',
      },
      identityId: 'identity-1',
      threadId: 'thread-1',
      threadIsDirect: false,
    },
    sessionId: 'session-manual-steer-input-ref-missing',
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    realAcceptedInputPersistence: true,
    session,
  })
  const providerStarted = createDeferred<void>()
  const providerRelease = createDeferred<void>()
  const steer = vi.fn(async () => undefined)

  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    const releaseLiveTurn = providerInput.activeTurnSteering?.registerLiveProviderTurn({
      interrupt: async () => undefined,
      codexThreadId: 'thread-live',
      providerTurnId: 'turn-live-provider',
      sessionId: session.sessionId,
      steer,
      turnId: 'turn-1',
    })
    providerStarted.resolve()
    await providerRelease.promise
    releaseLiveTurn?.()
    return {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        response: 'final after attempted steer',
        session,
      },
    }
  })

  const runningTurn = sendAssistantMessageLocal({
    prompt: 'Initial prompt',
    vault: context.vaultRoot,
  })
  await providerStarted.promise

  await expect(
    sendAssistantMessageLocal({
      acceptedTurnInput: {
        initialInputs: [
          {
            contentRef: {
              kind: 'assistant-input-event',
              refId: 'ain_00000000000000000000000000000007',
              version: 'murph.assistant-input-event.v1',
            },
            id: 'ain_00000000000000000000000000000007',
            source: 'assistant-input',
          },
        ],
      },
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      expectedActiveTurnId: 'turn-1',
      prompt: 'Follow-up while running',
      vault: context.vaultRoot,
    }),
  ).rejects.toMatchObject({
    code: 'ASSISTANT_TURN_INPUT_JOURNAL_MISSING_ASSISTANT_INPUT_EVENT',
  })
  expect(steer).not.toHaveBeenCalled()

  providerRelease.resolve()
  await runningTurn
})

test('sendAssistantMessageLocal rejects late assistant-input refs before transcript writes when the event is missing', async () => {
  const context = await createTempVaultContext(
    'assistant-local-service-late-input-ref-missing-',
  )
  tempRoots.push(context.parentRoot)
  const session = createAssistantSession({
    sessionId: 'session-late-input-ref-missing',
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...createSharedPlan(),
      persistUserPromptOnFailure: false,
    },
    realAcceptedInputPersistence: true,
    session,
  })
  mocks.executeCodexTurnWithRecovery.mockResolvedValue({
    kind: 'succeeded',
    providerTurn: {
      onboardingGuidanceInjected: true,
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
      response: 'draft before missing late input',
      session,
    },
  })
  const activeTurnCheckpoint = vi.fn(
    async (_input: AssistantActiveTurnInputCheckpointInput) => undefined,
  )

  await expect(
    sendAssistantMessageLocal({
      activeTurnCheckpoint,
      activeTurnInput: vi.fn()
        .mockResolvedValueOnce({
          acceptedInputs: [
            {
              contentRef: {
                kind: 'assistant-input-event',
                refId: 'ain_00000000000000000000000000000005',
                version: 'murph.assistant-input-event.v1',
              },
              id: 'ain_00000000000000000000000000000005',
              promptFallbackReason: 'manual-input',
              promptFallbackText: 'Do not persist missing input text',
              source: 'assistant-input',
            },
          ],
          kind: 'accepted' as const,
          prompt: 'Do not persist missing input text',
          transcriptText: 'Do not persist missing input text',
        })
        .mockResolvedValue({
          kind: 'no-new-input' as const,
        }),
      deliverResponse: true,
      prompt: 'Initial prompt',
      vault: context.vaultRoot,
    }),
  ).rejects.toMatchObject({
    code: 'ASSISTANT_TURN_INPUT_JOURNAL_MISSING_ASSISTANT_INPUT_EVENT',
  })
  expect(activeTurnCheckpoint).not.toHaveBeenCalled()

  const transcriptEntries = await readAssistantTranscriptEntries(
    resolveAssistantStatePaths(context.vaultRoot),
    session.sessionId,
  )
  expect(
    transcriptEntries.some(
      (entry) => entry.text === 'Do not persist missing input text',
    ),
  ).toBe(false)
})

test('sendAssistantMessageLocal steers same-conversation input into an active manual turn', async () => {
  const session = createAssistantSession({
    binding: {
      actorId: null,
      channel: 'telegram',
      conversationKey: 'channel:telegram|identity:identity-1|thread:thread-1',
      delivery: {
        kind: 'thread',
        target: 'thread-1',
      },
      identityId: 'identity-1',
      threadId: 'thread-1',
      threadIsDirect: false,
    },
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    session,
  })
  const firstProviderTurn = createDeferred<Awaited<
    ReturnType<typeof mocks.executeCodexTurnWithRecovery>
  >>()
  mocks.executeCodexTurnWithRecovery
    .mockImplementationOnce(async () => firstProviderTurn.promise)
    .mockResolvedValueOnce({
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'thread-start',
        },
        response: 'final after steered input',
        session,
      },
    })

  const firstResultPromise = sendAssistantMessageLocal({
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  })
  await vi.waitFor(() => {
    expect(mocks.executeCodexTurnWithRecovery).toHaveBeenCalledTimes(1)
  })

  const steeredResultPromise = sendAssistantMessageLocal({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
    },
    expectedActiveTurnId: 'turn-1',
    prompt: 'Follow-up while running',
    vault: '/vaults/test',
  })

  firstProviderTurn.resolve({
    kind: 'succeeded',
    providerTurn: {
      onboardingGuidanceInjected: true,
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
      response: 'draft before steered input',
      session,
    },
  })

  const [firstResult, steeredResult] = await Promise.all([
    firstResultPromise,
    steeredResultPromise,
  ])

  assert.equal(firstResult.response, 'final after steered input')
  assert.equal(steeredResult.response, 'final after steered input')
  assert.equal(mocks.createAssistantTurnReceipt.mock.calls.length, 1)
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 2)
  assert.equal(
    mocks.executeCodexTurnWithRecovery.mock.calls[1]?.[0]?.input.prompt,
    'Follow-up while running',
  )
  expect(
    mocks.runtimeState.turns.acceptedInputs.append.mock.calls[1]?.[0]?.inputs,
  ).toEqual([
    expect.objectContaining({
      id: 'manual-1',
      promptFallbackReason: 'manual-input',
      source: 'manual',
    }),
  ])
})

test('sendAssistantMessageLocal live-steers same-conversation input without a second provider request', async () => {
  const session = createAssistantSession({
    binding: {
      actorId: null,
      channel: 'telegram',
      conversationKey: 'channel:telegram|identity:identity-1|thread:thread-1',
      delivery: {
        kind: 'thread',
        target: 'thread-1',
      },
      identityId: 'identity-1',
      threadId: 'thread-1',
      threadIsDirect: false,
    },
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    session,
  })
  const providerStarted = createDeferred<void>()
  const providerRelease = createDeferred<void>()
  const providerRequestStarted = vi.fn()
  const liveSteeredPrompts: string[] = []

  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    const releaseLiveTurn = providerInput.activeTurnSteering?.registerLiveProviderTurn({
      interrupt: async () => undefined,
      codexThreadId: 'thread-live',
      providerTurnId: 'turn-live-provider',
      sessionId: session.sessionId,
      steer: async (input) => {
        liveSteeredPrompts.push(input.prompt)
      },
      turnId: 'turn-1',
    })
    providerStarted.resolve()
    await providerRelease.promise
    releaseLiveTurn?.()
    return {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        response: 'final after live-steered input',
        session,
      },
    }
  })

  const firstResultPromise = sendAssistantMessageLocal({
    onProviderRequestStarted: providerRequestStarted,
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  })
  await providerStarted.promise

  const steeredResultPromise = sendAssistantMessageLocal({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
    },
    expectedActiveTurnId: 'turn-1',
    prompt: 'Follow-up while running',
    vault: '/vaults/test',
  })

  await vi.waitFor(() => {
    expect(liveSteeredPrompts).toEqual(['Follow-up while running'])
  })
  providerRelease.resolve()

  const [firstResult, steeredResult] = await Promise.all([
    firstResultPromise,
    steeredResultPromise,
  ])

  assert.equal(firstResult.response, 'final after live-steered input')
  assert.equal(firstResult.prompt, 'Follow-up while running')
  assert.equal(steeredResult.response, 'final after live-steered input')
  assert.equal(mocks.createAssistantTurnReceipt.mock.calls.length, 1)
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 1)
  expect(providerRequestStarted).not.toHaveBeenCalled()
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateProviderRequest.mock.calls
      .map((call) => call[0])
      .some((input) =>
        input.ordinal === 0 &&
        input.turnId === 'turn-1' &&
        input.acceptedInputIds?.join(',') === 'initial,manual-1'
      ),
  ).toBe(true)
})

test('sendAssistantMessageLocal replays only unsteered input from a mixed live-steer batch', async () => {
  const session = createAssistantSession({
    binding: {
      actorId: null,
      channel: 'telegram',
      conversationKey: 'channel:telegram|identity:identity-1|thread:thread-1',
      delivery: {
        kind: 'thread',
        target: 'thread-1',
      },
      identityId: 'identity-1',
      threadId: 'thread-1',
      threadIsDirect: false,
    },
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    session,
  })
  const providerStarted = createDeferred<void>()
  const providerRelease = createDeferred<void>()
  const liveSteeredPrompts: string[] = []

  mocks.executeCodexTurnWithRecovery
    .mockImplementationOnce(async (providerInput) => {
      await providerInput.onProviderRequestPlanned?.({
        providerAttemptId: null,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
      })
      const releaseLiveTurn = providerInput.activeTurnSteering?.registerLiveProviderTurn({
        interrupt: async () => undefined,
        codexThreadId: 'thread-live',
        providerTurnId: 'turn-live-provider',
        sessionId: session.sessionId,
        steer: async (input) => {
          liveSteeredPrompts.push(input.prompt)
          if (input.prompt === 'Second follow-up') {
            throw new Error('steer failed after first input')
          }
        },
        turnId: 'turn-1',
      })
      providerStarted.resolve()
      await providerRelease.promise
      releaseLiveTurn?.()
      return {
        kind: 'succeeded',
        providerTurn: {
          onboardingGuidanceInjected: true,
          codexContinuation: {
            kind: 'explicit-structured-history',
          },
          response: 'draft after mixed live input',
          session,
        },
      }
    })
    .mockImplementationOnce(async (providerInput) => {
      await providerInput.onProviderRequestPlanned?.({
        providerAttemptId: null,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
      })
      return {
        kind: 'succeeded',
        providerTurn: {
          onboardingGuidanceInjected: true,
          codexContinuation: {
            kind: 'explicit-structured-history',
          },
          response: 'final after unsteered replay',
          session,
        },
      }
    })

  const firstResultPromise = sendAssistantMessageLocal({
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  })
  await providerStarted.promise

  const firstQueuedResultPromise = sendAssistantMessageLocal({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
    },
    expectedActiveTurnId: 'turn-1',
    prompt: 'First follow-up',
    vault: '/vaults/test',
  })
  await vi.waitFor(() => {
    expect(liveSteeredPrompts).toEqual(['First follow-up'])
  })

  const secondQueuedResultPromise = sendAssistantMessageLocal({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
    },
    expectedActiveTurnId: 'turn-1',
    prompt: 'Second follow-up',
    vault: '/vaults/test',
  })
  await vi.waitFor(() => {
    expect(liveSteeredPrompts).toEqual(['First follow-up', 'Second follow-up'])
  })
  providerRelease.resolve()

  const [firstResult, firstQueuedResult, secondQueuedResult] = await Promise.all([
    firstResultPromise,
    firstQueuedResultPromise,
    secondQueuedResultPromise,
  ])

  assert.equal(firstResult.response, 'final after unsteered replay')
  assert.equal(firstQueuedResult.response, 'final after unsteered replay')
  assert.equal(secondQueuedResult.response, 'final after unsteered replay')
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 2)
  assert.equal(
    mocks.executeCodexTurnWithRecovery.mock.calls[1]?.[0]?.input.prompt,
    'Second follow-up',
  )
  assert.equal(
    mocks.executeCodexTurnWithRecovery.mock.calls[1]?.[0]?.input.prompt.includes('First follow-up'),
    false,
  )
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateProviderRequest.mock.calls
      .map((call) => call[0])
      .some((input) =>
        input.ordinal === 0 &&
        input.turnId === 'turn-1' &&
        input.acceptedInputIds?.join(',') === 'initial,manual-1'
      ),
  ).toBe(true)
})

test('sendAssistantMessageLocal registers manual steering before prompt persistence completes', async () => {
  const session = createAssistantSession({
    binding: {
      actorId: null,
      channel: 'telegram',
      conversationKey: 'channel:telegram|identity:identity-1|thread:thread-1',
      delivery: {
        kind: 'thread',
        target: 'thread-1',
      },
      identityId: 'identity-1',
      threadId: 'thread-1',
      threadIsDirect: false,
    },
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    session,
  })
  const firstProviderTurn = createDeferred<Awaited<
    ReturnType<typeof mocks.executeCodexTurnWithRecovery>
  >>()
  const promptPersistenceStarted = createDeferred<void>()
  const promptPersistenceRelease = createDeferred<{
    entries: Array<{
      createdAt: string
    }>
    refs: Array<{
      entryCreatedAt: string
      entryIndex: number
      entryKind: 'user'
      sessionId: string
    }>
  }>()
  mocks.appendAssistantTranscriptEntriesWithRefs.mockImplementationOnce(
    async () => {
      promptPersistenceStarted.resolve()
      return promptPersistenceRelease.promise
    },
  )
  mocks.executeCodexTurnWithRecovery
    .mockImplementationOnce(async () => firstProviderTurn.promise)

  const firstResultPromise = sendAssistantMessageLocal({
    prompt: 'Initial prompt',
    turnTrigger: 'manual-ask',
    vault: '/vaults/test',
  })
  await promptPersistenceStarted.promise

  const steeredResultPromise = sendAssistantMessageLocal({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
    },
    expectedActiveTurnId: 'turn-1',
    prompt: 'Follow-up while prompt persistence is blocked',
    turnTrigger: 'manual-ask',
    vault: '/vaults/test',
  })

  promptPersistenceRelease.resolve({
    entries: [
      {
        createdAt: '2026-04-08T12:00:00.000Z',
      },
    ],
    refs: [
      {
        entryCreatedAt: '2026-04-08T12:00:00.000Z',
        entryIndex: 0,
        entryKind: 'user',
        sessionId: session.sessionId,
      },
    ],
  })

  await vi.waitFor(() => {
    expect(mocks.executeCodexTurnWithRecovery).toHaveBeenCalledTimes(1)
  })
  assert.equal(
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.input.prompt,
    'Follow-up while prompt persistence is blocked',
  )
  firstProviderTurn.resolve({
    kind: 'succeeded',
    providerTurn: {
      onboardingGuidanceInjected: true,
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
      response: 'final after steered input',
      session,
    },
  })

  const [firstResult, steeredResult] = await Promise.all([
    firstResultPromise,
    steeredResultPromise,
  ])

  assert.equal(firstResult.response, 'final after steered input')
  assert.equal(steeredResult.response, 'final after steered input')
  assert.equal(mocks.createAssistantTurnReceipt.mock.calls.length, 1)
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 1)
})

test('sendAssistantMessageLocal starts a new turn when same-conversation input lacks expected turn id', async () => {
  const session = createAssistantSession({
    binding: {
      actorId: null,
      channel: 'telegram',
      conversationKey: 'channel:telegram|identity:identity-1|thread:thread-1',
      delivery: {
        kind: 'thread',
        target: 'thread-1',
      },
      identityId: 'identity-1',
      threadId: 'thread-1',
      threadIsDirect: false,
    },
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...createSharedPlan(),
      persistUserPromptOnFailure: false,
    },
    session,
  })
  const firstProviderTurn = createDeferred<Awaited<
    ReturnType<typeof mocks.executeCodexTurnWithRecovery>
  >>()
  mocks.createAssistantTurnReceipt
    .mockResolvedValueOnce({
      turnId: 'turn-active',
    })
    .mockResolvedValueOnce({
      turnId: 'turn-new',
    })
  mocks.executeCodexTurnWithRecovery
    .mockImplementationOnce(async () => firstProviderTurn.promise)
    .mockResolvedValueOnce({
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        response: 'new turn response',
        session,
      },
    })

  const firstResultPromise = sendAssistantMessageLocal({
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  })
  await vi.waitFor(() => {
    expect(mocks.executeCodexTurnWithRecovery).toHaveBeenCalledTimes(1)
  })

  await expect(
    sendAssistantMessageLocal({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      expectedActiveTurnId: 'turn-stale',
      prompt: 'Same conversation with stale expected turn id',
      vault: '/vaults/test',
    }),
  ).rejects.toMatchObject({
    code: 'ASSISTANT_ACTIVE_TURN_ID_MISMATCH',
  })
  assert.equal(mocks.createAssistantTurnReceipt.mock.calls.length, 1)

  const secondResult = await sendAssistantMessageLocal({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
    },
    prompt: 'Same conversation without expected turn id',
    vault: '/vaults/test',
  })

  assert.equal(secondResult.response, 'new turn response')
  assert.equal(mocks.createAssistantTurnReceipt.mock.calls.length, 2)
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 2)
  assert.equal(
    mocks.executeCodexTurnWithRecovery.mock.calls[1]?.[0]?.input.prompt,
    'Same conversation without expected turn id',
  )

  firstProviderTurn.resolve({
    kind: 'succeeded',
    providerTurn: {
      onboardingGuidanceInjected: true,
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
      response: 'first turn response',
      session,
    },
  })

  const firstResult = await firstResultPromise
  assert.equal(firstResult.response, 'first turn response')
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 2)
})

test('active-turn controller only steers exact conversations while open', async () => {
  const {
    createAssistantActiveTurnInputController,
    steerAssistantActiveTurnInput,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const controller = createAssistantActiveTurnInputController({
    conversationKeys: ['channel:telegram|identity:identity-1|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  try {
    assert.equal(
      steerAssistantActiveTurnInput({
        conversation: {
          channel: 'telegram',
          identityId: 'identity-1',
          sessionId: 'session-test',
          threadId: 'thread-2',
        },
        prompt: 'Different thread',
        sessionId: 'session-test',
        vault: '/vaults/test',
      }),
      null,
    )

    assert.equal(
      steerAssistantActiveTurnInput({
        conversation: {
          channel: 'telegram',
          identityId: 'identity-1',
          threadId: 'thread-1',
        },
        prompt: 'Same thread without expected turn id',
        vault: '/vaults/test',
      }),
      null,
    )

    assert.equal(
      steerAssistantActiveTurnInput({
        conversation: {
          channel: 'telegram',
          identityId: 'identity-1',
          threadId: 'thread-1',
        },
        expectedActiveTurnId: 'turn-stale',
        prompt: 'Same thread with stale turn id',
        vault: '/vaults/test',
      }),
      null,
    )

    assert.equal(
      steerAssistantActiveTurnInput({
        conversation: {
          channel: 'telegram',
          identityId: 'identity-1',
          threadId: 'thread-1',
        },
        expectedActiveTurnId: ' turn-active ',
        prompt: 'Same thread with padded turn id',
        vault: '/vaults/test',
      }),
      null,
    )

    const steered = steerAssistantActiveTurnInput({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      expectedActiveTurnId: 'turn-active',
      prompt: 'Same thread',
      vault: '/vaults/test',
    })
    assert.ok(steered)
    steered.catch(() => undefined)
    assert.deepEqual(await controller.admit({
      phase: 'request_boundary',
      sessionId: 'session-test',
      turnId: 'turn-active',
      vault: '/vaults/test',
    }), {
      acceptedInputs: [
        {
          id: 'manual-1',
          promptFallbackReason: 'manual-input',
          promptFallbackText: 'Same thread',
          source: 'manual',
        },
      ],
      deliveryReplyToMessageId: undefined,
      kind: 'accepted',
      prompt: 'Same thread',
      transcriptText: null,
      userMessageContent: [
        {
          text: 'Same thread',
          type: 'text',
        },
      ],
    })

    const sessionOnlyController = createAssistantActiveTurnInputController({
      sessionId: 'session-other',
      turnId: 'turn-session-only',
      vault: '/vaults/test',
    })
    try {
      assert.equal(
        steerAssistantActiveTurnInput({
          conversation: {
            sessionId: ' ',
          },
          prompt: 'Session fallback without expected turn id',
          sessionId: 'session-other',
          vault: '/vaults/test',
        }),
        null,
      )

      const sessionSteered = steerAssistantActiveTurnInput({
        conversation: {
          sessionId: ' ',
        },
        expectedActiveTurnId: 'turn-session-only',
        prompt: 'Session fallback',
        sessionId: 'session-other',
        vault: '/vaults/test',
      })
      assert.ok(sessionSteered)
      sessionSteered.catch(() => undefined)
      assert.deepEqual(await sessionOnlyController.admit({
        phase: 'request_boundary',
        sessionId: 'session-other',
        turnId: 'turn-session-only',
        vault: '/vaults/test',
      }), {
        acceptedInputs: [
          {
            id: 'manual-1',
            promptFallbackReason: 'manual-input',
            promptFallbackText: 'Session fallback',
            source: 'manual',
          },
        ],
        deliveryReplyToMessageId: undefined,
        kind: 'accepted',
        prompt: 'Session fallback',
        transcriptText: null,
        userMessageContent: [
          {
            text: 'Session fallback',
            type: 'text',
          },
        ],
      })
    } finally {
      sessionOnlyController.fail(new Error('session-only controller test complete'))
      sessionOnlyController.close()
    }

    controller.close()
    assert.equal(
      steerAssistantActiveTurnInput({
        conversation: {
          channel: 'telegram',
          identityId: 'identity-1',
          threadId: 'thread-1',
        },
        expectedActiveTurnId: 'turn-active',
        prompt: 'After commit',
        vault: '/vaults/test',
      }),
      null,
    )
  } finally {
    controller.fail(new Error('active-turn controller test complete'))
    controller.close()
  }
})

test('active-turn controller drains queued manual input before boundary hook input', async () => {
  const {
    createAssistantActiveTurnInputController,
    steerAssistantActiveTurnInput,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async () => ({
      acceptedInputs: [
        {
          id: 'hook-1',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Hook input',
          source: 'assistant-input',
        },
      ],
      deliveryReplyToMessageId: 'reply-hook',
      kind: 'accepted',
      prompt: 'Hook input',
      receiptMetadata: {
        hook: 'yes',
      },
      transcriptText: 'Hook transcript',
      userMessageContent: [
        {
          text: 'Hook input',
          type: 'text',
        },
      ],
    }),
    conversationKeys: ['channel:telegram|identity:identity-1|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  try {
    const steered = steerAssistantActiveTurnInput({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      deliveryReplyToMessageId: 'reply-manual',
      expectedActiveTurnId: 'turn-active',
      prompt: 'Manual input',
      vault: '/vaults/test',
    })
    assert.ok(steered)
    steered.catch(() => undefined)

    assert.deepEqual(await controller.admit({
      phase: 'request_boundary',
      sessionId: 'session-test',
      turnId: 'turn-active',
      vault: '/vaults/test',
    }), {
      acceptedInputs: [
        {
          id: 'manual-1',
          promptFallbackReason: 'manual-input',
          promptFallbackText: 'Manual input',
          source: 'manual',
        },
      ],
      deliveryReplyToMessageId: 'reply-manual',
      kind: 'accepted',
      prompt: 'Manual input',
      transcriptText: null,
      userMessageContent: [
        {
          text: 'Manual input',
          type: 'text',
        },
      ],
    })

    assert.deepEqual(await controller.admit({
      phase: 'request_boundary',
      sessionId: 'session-test',
      turnId: 'turn-active',
      vault: '/vaults/test',
    }), {
      acceptedInputs: [
        {
          id: 'hook-1',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Hook input',
          source: 'assistant-input',
        },
      ],
      deliveryReplyToMessageId: 'reply-hook',
      kind: 'accepted',
      prompt: 'Hook input',
      receiptMetadata: {
        hook: 'yes',
      },
      transcriptText: 'Hook transcript',
      userMessageContent: [
        {
          text: 'Hook input',
          type: 'text',
        },
      ],
    })
  } finally {
    controller.fail(new Error('active-turn controller composition test complete'))
    controller.close()
  }
})

test('active-turn controller keeps boundary input behind live-acknowledged input', async () => {
  const {
    createAssistantActiveTurnInputController,
    steerAssistantActiveTurnInput,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const liveSteeredPrompts: string[] = []
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async (input) => {
      if (input.knownInputIds?.includes('hook-1')) {
        return {
          kind: 'no-new-input',
        }
      }
      return {
        acceptedInputs: [
          {
            id: 'hook-1',
            promptFallbackReason: 'missing-content-ref',
            promptFallbackText: 'Boundary hook input',
            source: 'assistant-input',
          },
        ],
        kind: 'accepted',
        prompt: 'Boundary hook input',
        transcriptText: 'Boundary hook transcript',
        userMessageContent: [
          {
            text: 'Boundary hook input',
            type: 'text',
          },
        ],
      }
    },
    conversationKeys: ['channel:telegram|identity:identity-1|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  const releaseLiveTurn = controller.registerLiveProviderTurn({
    interrupt: async () => undefined,
    codexThreadId: 'provider-session',
    providerTurnId: 'provider-turn',
    sessionId: 'session-test',
    steer: async (input) => {
      liveSteeredPrompts.push(input.prompt)
    },
    turnId: 'turn-active',
  })
  try {
    const steered = steerAssistantActiveTurnInput({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      expectedActiveTurnId: 'turn-active',
      prompt: 'Live-steered input',
      vault: '/vaults/test',
    })
    assert.ok(steered)
    steered.catch(() => undefined)
    await vi.waitFor(() => {
      expect(liveSteeredPrompts).toEqual(['Live-steered input'])
    })
    releaseLiveTurn()

    assert.deepEqual(await controller.admit({
      phase: 'request_boundary',
      sessionId: 'session-test',
      turnId: 'turn-active',
      vault: '/vaults/test',
    }), {
      acceptedInputs: [
        {
          id: 'manual-1',
          promptFallbackReason: 'manual-input',
          promptFallbackText: 'Live-steered input',
          source: 'manual',
        },
      ],
      deliveryReplyToMessageId: undefined,
      kind: 'accepted',
      prompt: 'Live-steered input',
      providerAlreadySteered: true,
      transcriptText: null,
      userMessageContent: [
        {
          text: 'Live-steered input',
          type: 'text',
        },
      ],
    })
    assert.deepEqual(await controller.admit({
      phase: 'request_boundary',
      sessionId: 'session-test',
      turnId: 'turn-active',
      vault: '/vaults/test',
    }), {
      acceptedInputs: [
        {
          id: 'hook-1',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Boundary hook input',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Boundary hook input',
      transcriptText: 'Boundary hook transcript',
      userMessageContent: [
        {
          text: 'Boundary hook input',
          type: 'text',
        },
      ],
    })
  } finally {
    releaseLiveTurn()
    controller.fail(new Error('active-turn controller ordering test complete'))
    controller.close()
  }
})

test('active-turn controller validates hook input before live steering it to the provider', async () => {
  const {
    createAssistantActiveTurnInputController,
    notifyAssistantActiveTurnInputAvailable,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const validationError = new Error('missing assistant input event')
  const steer = vi.fn(async () => undefined)
  const acceptedInputValidator = vi.fn(async () => {
    throw validationError
  })
  const controller = createAssistantActiveTurnInputController({
    acceptedInputValidator,
    admissionHook: async () => ({
      acceptedInputs: [
        {
          contentRef: {
            kind: 'assistant-input-event',
            refId: 'ain_00000000000000000000000000000006',
            version: 'murph.assistant-input-event.v1',
          },
          id: 'ain_00000000000000000000000000000006',
          promptFallbackReason: 'manual-input',
          promptFallbackText: 'Unvalidated live input',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Unvalidated live input',
      transcriptText: 'Unvalidated live input',
    }),
    conversationKeys: ['channel:telegram|identity:identity-1|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  const releaseLiveTurn = controller.registerLiveProviderTurn({
    interrupt: async () => undefined,
    codexThreadId: 'provider-session',
    providerTurnId: 'provider-turn',
    sessionId: 'session-test',
    steer,
    turnId: 'turn-active',
  })

  try {
    await expect(
      notifyAssistantActiveTurnInputAvailable({
        conversation: {
          channel: 'telegram',
          identityId: 'identity-1',
          threadId: 'thread-1',
        },
        sessionId: 'session-test',
        vault: '/vaults/test',
      }),
    ).rejects.toThrow(/missing assistant input event/u)
    expect(acceptedInputValidator).toHaveBeenCalledWith({
      acceptedInputs: [
        expect.objectContaining({
          id: 'ain_00000000000000000000000000000006',
          source: 'assistant-input',
        }),
      ],
    })
    expect(steer).not.toHaveBeenCalled()
  } finally {
    releaseLiveTurn()
    controller.fail(new Error('active-turn controller validator test complete'))
    controller.close()
  }
})

test('active-turn controller can notify every active turn in one vault', async () => {
  const {
    createAssistantActiveTurnInputController,
    notifyAssistantActiveTurnInputsAvailableForVault,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const steer = vi.fn(async () => undefined)
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async () => ({
      acceptedInputs: [
        {
          id: 'hook-1',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Vault-level hook input',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Vault-level hook input',
      transcriptText: 'Vault-level hook transcript',
      userMessageContent: [
        {
          text: 'Vault-level hook input',
          type: 'text',
        },
      ],
    }),
    conversationKeys: ['channel:telegram|identity:identity-1|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  const otherController = createAssistantActiveTurnInputController({
    admissionHook: async () => {
      throw new Error('other vault should not be notified')
    },
    conversationKeys: ['channel:telegram|identity:identity-2|thread:thread-2'],
    sessionId: 'session-other',
    turnId: 'turn-other',
    vault: '/vaults/other',
  })
  const releaseLiveTurn = controller.registerLiveProviderTurn({
    interrupt: async () => undefined,
    codexThreadId: 'provider-session',
    providerTurnId: 'provider-turn',
    sessionId: 'session-test',
    steer,
    turnId: 'turn-active',
  })

  try {
    await expect(
      notifyAssistantActiveTurnInputsAvailableForVault({
        vault: '/vaults/test',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        kind: 'accepted',
        prompt: 'Vault-level hook input',
      }),
    ])
    expect(steer).toHaveBeenCalledWith({
      prompt: 'Vault-level hook input',
      userMessageContent: [
        {
          text: 'Vault-level hook input',
          type: 'text',
        },
      ],
    })
  } finally {
    releaseLiveTurn()
    controller.fail(new Error('active-turn controller vault notify test complete'))
    controller.close()
    otherController.close()
  }
})

test('active-turn controller keeps boundary input behind in-flight live steer input', async () => {
  const {
    createAssistantActiveTurnInputController,
    steerAssistantActiveTurnInput,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const steerStarted = createDeferred<void>()
  const steerRelease = createDeferred<void>()
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async (input) => {
      if (input.knownInputIds?.includes('hook-1')) {
        return {
          kind: 'no-new-input',
        }
      }
      return {
        acceptedInputs: [
          {
            id: 'hook-1',
            promptFallbackReason: 'missing-content-ref',
            promptFallbackText: 'Boundary hook input',
            source: 'assistant-input',
          },
        ],
        kind: 'accepted',
        prompt: 'Boundary hook input',
        transcriptText: 'Boundary hook transcript',
        userMessageContent: [
          {
            text: 'Boundary hook input',
            type: 'text',
          },
        ],
      }
    },
    conversationKeys: ['channel:telegram|identity:identity-1|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  const releaseLiveTurn = controller.registerLiveProviderTurn({
    interrupt: async () => undefined,
    codexThreadId: 'provider-session',
    providerTurnId: 'provider-turn',
    sessionId: 'session-test',
    steer: async () => {
      steerStarted.resolve()
      await steerRelease.promise
    },
    turnId: 'turn-active',
  })
  try {
    const steered = steerAssistantActiveTurnInput({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      expectedActiveTurnId: 'turn-active',
      prompt: 'In-flight live steer input',
      vault: '/vaults/test',
    })
    assert.ok(steered)
    steered.catch(() => undefined)
    await steerStarted.promise
    releaseLiveTurn()

    const admission = controller.admit({
      phase: 'request_boundary',
      sessionId: 'session-test',
      turnId: 'turn-active',
      vault: '/vaults/test',
    })
    steerRelease.resolve()

    assert.deepEqual(await admission, {
      acceptedInputs: [
        {
          id: 'manual-1',
          promptFallbackReason: 'manual-input',
          promptFallbackText: 'In-flight live steer input',
          source: 'manual',
        },
      ],
      deliveryReplyToMessageId: undefined,
      kind: 'accepted',
      prompt: 'In-flight live steer input',
      transcriptText: null,
      userMessageContent: [
        {
          text: 'In-flight live steer input',
          type: 'text',
        },
      ],
    })
    assert.deepEqual(await controller.admit({
      phase: 'request_boundary',
      sessionId: 'session-test',
      turnId: 'turn-active',
      vault: '/vaults/test',
    }), {
      acceptedInputs: [
        {
          id: 'hook-1',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Boundary hook input',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Boundary hook input',
      transcriptText: 'Boundary hook transcript',
      userMessageContent: [
        {
          text: 'Boundary hook input',
          type: 'text',
        },
      ],
    })
  } finally {
    steerRelease.resolve()
    releaseLiveTurn()
    controller.fail(new Error('active-turn controller in-flight ordering test complete'))
    controller.close()
  }
})

test('active-turn controller interrupts live provider when input-available checkpoint is rejected', async () => {
  const {
    createAssistantActiveTurnInputController,
    notifyAssistantActiveTurnInputAvailable,
    steerAssistantActiveTurnInput,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const checkpointRejected = new AssistantActiveTurnInputCheckpointRejectedError(
    'Active turn input checkpoint was rejected; retry from durable state.',
  )
  const interrupt = vi.fn(async () => undefined)
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async (input) => {
      if (input.phase === 'input_available') {
        throw checkpointRejected
      }
      return {
        kind: 'no-new-input',
      }
    },
    conversationKeys: ['channel:telegram|identity:identity-1|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  try {
    controller.registerLiveProviderTurn({
      interrupt,
      codexThreadId: 'provider-session',
      providerTurnId: 'provider-turn',
      sessionId: 'session-test',
      steer: async () => undefined,
      turnId: 'turn-active',
    })
    await assert.rejects(
      () => notifyAssistantActiveTurnInputAvailable({
        conversation: {
          channel: 'telegram',
          identityId: 'identity-1',
          threadId: 'thread-1',
        },
        vault: '/vaults/test',
      }),
      AssistantActiveTurnInputCheckpointRejectedError,
    )
    expect(interrupt).toHaveBeenCalledTimes(1)
    await assert.rejects(
      () => controller.admit({
        phase: 'request_boundary',
        sessionId: 'session-test',
        turnId: 'turn-active',
        vault: '/vaults/test',
      }),
      AssistantActiveTurnInputCheckpointRejectedError,
    )
    assert.equal(
      steerAssistantActiveTurnInput({
        conversation: {
          channel: 'telegram',
          identityId: 'identity-1',
          threadId: 'thread-1',
        },
        expectedActiveTurnId: 'turn-active',
        prompt: 'After rejected checkpoint',
        vault: '/vaults/test',
      }),
      null,
    )
  } finally {
    controller.close()
  }
})

test('active-turn controller retries boundary admission after non-fatal input-available failure', async () => {
  const {
    createAssistantActiveTurnInputController,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const unavailable = new AssistantActiveTurnInputUnavailableError(
    'Active turn input source is temporarily unavailable.',
  )
  let boundaryAdmissions = 0
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async (input) => {
      if (input.phase === 'input_available') {
        throw unavailable
      }
      boundaryAdmissions += 1
      return {
        acceptedInputs: [
          {
            id: 'hook-1',
            promptFallbackReason: 'missing-content-ref',
            promptFallbackText: 'Boundary hook input',
            source: 'assistant-input',
          },
        ],
        kind: 'accepted',
        prompt: 'Boundary hook input',
        transcriptText: 'Boundary hook transcript',
        userMessageContent: [
          {
            text: 'Boundary hook input',
            type: 'text',
          },
        ],
      }
    },
    conversationKeys: ['channel:telegram|identity:identity-1|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  try {
    const notification = controller.notifyInputAvailable().catch(() => undefined)
    assert.deepEqual(await controller.admit({
      phase: 'request_boundary',
      sessionId: 'session-test',
      turnId: 'turn-active',
      vault: '/vaults/test',
    }), {
      acceptedInputs: [
        {
          id: 'hook-1',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Boundary hook input',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Boundary hook input',
      transcriptText: 'Boundary hook transcript',
      userMessageContent: [
        {
          text: 'Boundary hook input',
          type: 'text',
        },
      ],
    })
    await notification
    assert.equal(boundaryAdmissions, 1)
  } finally {
    controller.close()
  }
})

test('active-turn controller only probes input after explicit notification or provider boundary', async () => {
  vi.useFakeTimers()
  const {
    createAssistantActiveTurnInputController,
    notifyAssistantActiveTurnInputAvailable,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const steer = vi.fn(async () => undefined)
  const admissions: string[] = []
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async (input) => {
      admissions.push(input.phase)
      return {
        acceptedInputs: [
          {
            id: 'hook-1',
            promptFallbackReason: 'missing-content-ref',
            promptFallbackText: 'Notification hook input',
            source: 'assistant-input',
          },
        ],
        kind: 'accepted',
        prompt: 'Notification hook input',
        transcriptText: 'Notification hook transcript',
        userMessageContent: [
          {
            text: 'Notification hook input',
            type: 'text',
          },
        ],
      }
    },
    boundaryAdmissionEnabled: false,
    conversationKeys: ['channel:telegram|identity:identity-1|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  const releaseLiveTurn = controller.registerLiveProviderTurn({
    interrupt: async () => undefined,
    codexThreadId: 'provider-session',
    providerTurnId: 'provider-turn',
    sessionId: 'session-test',
    steer,
    turnId: 'turn-active',
  })

  try {
    assert.equal(vi.getTimerCount(), 0)
    await vi.advanceTimersByTimeAsync(1500)
    assert.deepEqual(admissions, [])
    expect(steer).not.toHaveBeenCalled()

    assert.equal(await controller.admit({
      phase: 'request_boundary',
      sessionId: 'session-test',
      turnId: 'turn-active',
      vault: '/vaults/test',
    }), undefined)
    assert.deepEqual(admissions, [])

    await notifyAssistantActiveTurnInputAvailable({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      vault: '/vaults/test',
    })

    assert.deepEqual(admissions, ['input_available'])
    expect(steer).toHaveBeenCalledWith({
      prompt: 'Notification hook input',
      userMessageContent: [
        {
          text: 'Notification hook input',
          type: 'text',
        },
      ],
    })
    assert.deepEqual(await controller.admit({
      phase: 'commit_barrier',
      sessionId: 'session-test',
      turnId: 'turn-active',
      vault: '/vaults/test',
    }), {
      acceptedInputs: [
        {
          id: 'hook-1',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Notification hook input',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Notification hook input',
      providerAlreadySteered: true,
      transcriptText: 'Notification hook transcript',
      userMessageContent: [
        {
          text: 'Notification hook input',
          type: 'text',
        },
      ],
    })
  } finally {
    releaseLiveTurn()
    controller.close()
  }
})

test('active-turn controller reruns input-available admission for in-flight notifications', async () => {
  const {
    createAssistantActiveTurnInputController,
    notifyAssistantActiveTurnInputAvailable,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const firstAdmissionStarted = createDeferred<void>()
  const firstAdmissionRelease = createDeferred<void>()
  const phases: string[] = []
  const steer = vi.fn(async () => undefined)
  let ordinal = 0
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async (input) => {
      phases.push(input.phase)
      ordinal += 1
      if (ordinal === 1) {
        firstAdmissionStarted.resolve()
        await firstAdmissionRelease.promise
        return {
          kind: 'no-new-input',
        }
      }

      return {
        acceptedInputs: [
          {
            id: 'hook-2',
            promptFallbackReason: 'missing-content-ref',
            promptFallbackText: 'Rerun hook input',
            source: 'assistant-input',
          },
        ],
        kind: 'accepted',
        prompt: 'Rerun hook input',
        transcriptText: 'Rerun hook transcript',
        userMessageContent: [
          {
            text: 'Rerun hook input',
            type: 'text',
          },
        ],
      }
    },
    boundaryAdmissionEnabled: false,
    conversationKeys: ['channel:telegram|identity:identity-1|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  const releaseLiveTurn = controller.registerLiveProviderTurn({
    interrupt: async () => undefined,
    codexThreadId: 'provider-session',
    providerTurnId: 'provider-turn',
    sessionId: 'session-test',
    steer,
    turnId: 'turn-active',
  })

  try {
    const firstNotification = notifyAssistantActiveTurnInputAvailable({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      vault: '/vaults/test',
    })
    await firstAdmissionStarted.promise
    const secondNotification = notifyAssistantActiveTurnInputAvailable({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      vault: '/vaults/test',
    })
    await Promise.resolve()
    assert.deepEqual(phases, ['input_available'])

    firstAdmissionRelease.resolve()
    const [firstResult, secondResult] = await Promise.all([
      firstNotification,
      secondNotification,
    ])
    assert.deepEqual(phases, ['input_available', 'input_available'])
    assert.equal(firstResult?.kind, 'accepted')
    assert.equal(secondResult?.kind, 'accepted')
    expect(steer).toHaveBeenCalledTimes(1)
    expect(steer).toHaveBeenCalledWith({
      prompt: 'Rerun hook input',
      userMessageContent: [
        {
          text: 'Rerun hook input',
          type: 'text',
        },
      ],
    })
    assert.deepEqual(await controller.admit({
      phase: 'commit_barrier',
      sessionId: 'session-test',
      turnId: 'turn-active',
      vault: '/vaults/test',
    }), {
      acceptedInputs: [
        {
          id: 'hook-2',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Rerun hook input',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Rerun hook input',
      providerAlreadySteered: true,
      transcriptText: 'Rerun hook transcript',
      userMessageContent: [
        {
          text: 'Rerun hook input',
          type: 'text',
        },
      ],
    })
  } finally {
    firstAdmissionRelease.resolve()
    releaseLiveTurn()
    controller.close()
  }
})

test('active-turn controller reruns input-available admission after an accepted in-flight notification', async () => {
  const {
    createAssistantActiveTurnInputController,
    notifyAssistantActiveTurnInputAvailable,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const firstAdmissionStarted = createDeferred<void>()
  const firstAdmissionRelease = createDeferred<void>()
  const phases: string[] = []
  const knownInputSnapshots: string[][] = []
  const steer = vi.fn(async () => undefined)
  let ordinal = 0
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async (input) => {
      phases.push(input.phase)
      knownInputSnapshots.push([...(input.knownInputIds ?? [])])
      ordinal += 1
      const id = `hook-${ordinal}`
      const prompt = `Rerun accepted hook input ${ordinal}`
      const result = {
        acceptedInputs: [
          {
            id,
            promptFallbackReason: 'missing-content-ref' as const,
            promptFallbackText: prompt,
            source: 'assistant-input' as const,
          },
        ],
        kind: 'accepted' as const,
        prompt,
        transcriptText: `Rerun accepted hook transcript ${ordinal}`,
        userMessageContent: [
          {
            text: prompt,
            type: 'text' as const,
          },
        ],
      }
      if (ordinal === 1) {
        firstAdmissionStarted.resolve()
        await firstAdmissionRelease.promise
      }
      return result
    },
    boundaryAdmissionEnabled: false,
    conversationKeys: ['channel:telegram|identity:identity-1|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  const releaseLiveTurn = controller.registerLiveProviderTurn({
    interrupt: async () => undefined,
    codexThreadId: 'provider-session',
    providerTurnId: 'provider-turn',
    sessionId: 'session-test',
    steer,
    turnId: 'turn-active',
  })

  try {
    const firstNotification = notifyAssistantActiveTurnInputAvailable({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      vault: '/vaults/test',
    })
    await firstAdmissionStarted.promise
    const secondNotification = notifyAssistantActiveTurnInputAvailable({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      vault: '/vaults/test',
    })
    await Promise.resolve()
    assert.deepEqual(phases, ['input_available'])

    firstAdmissionRelease.resolve()
    const [firstResult, secondResult] = await Promise.all([
      firstNotification,
      secondNotification,
    ])
    assert.deepEqual(phases, ['input_available', 'input_available'])
    assert.deepEqual(knownInputSnapshots, [[], ['hook-1']])
    assert.equal(firstResult?.kind, 'accepted')
    assert.equal(secondResult?.kind, 'accepted')
    expect(steer).toHaveBeenCalledTimes(2)
    assert.deepEqual(await controller.admit({
      phase: 'commit_barrier',
      sessionId: 'session-test',
      turnId: 'turn-active',
      vault: '/vaults/test',
    }), {
      acceptedInputs: [
        {
          id: 'hook-1',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Rerun accepted hook input 1',
          source: 'assistant-input',
        },
        {
          id: 'hook-2',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Rerun accepted hook input 2',
          source: 'assistant-input',
        },
      ],
      deliveryReplyToMessageId: undefined,
      deliveryIdempotencyKey: undefined,
      kind: 'accepted',
      prompt: 'Rerun accepted hook input 1\n\nRerun accepted hook input 2',
      providerAlreadySteered: true,
      receiptMetadata: undefined,
      transcriptText: 'Rerun accepted hook transcript 1\n\nRerun accepted hook transcript 2',
      userMessageContent: [
        {
          text: 'Rerun accepted hook input 1',
          type: 'text',
        },
        {
          text: 'Rerun accepted hook input 2',
          type: 'text',
        },
      ],
    })
    assert.equal(await controller.admitAvailable(), undefined)
  } finally {
    firstAdmissionRelease.resolve()
    releaseLiveTurn()
    controller.close()
  }
})

test('active-turn controller can probe store-backed input before provider execution', async () => {
  const {
    createAssistantActiveTurnInputController,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const admissions: string[] = []
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async (input) => {
      admissions.push(input.phase)
      return {
        acceptedInputs: [
          {
            id: 'hook-polled',
            promptFallbackReason: 'missing-content-ref',
            promptFallbackText: 'Polled hook input',
            source: 'assistant-input',
          },
        ],
        kind: 'accepted',
        prompt: 'Polled hook input',
        transcriptText: 'Polled hook transcript',
      }
    },
    boundaryAdmissionEnabled: false,
    conversationKeys: ['channel:telegram|identity:identity-1|thread:thread-1'],
    eventAdmissionEnabled: false,
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })

  try {
    assert.deepEqual(await controller.admitAvailable({ probeIfIdle: true }), {
      acceptedInputs: [
        {
          id: 'hook-polled',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Polled hook input',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Polled hook input',
      transcriptText: 'Polled hook transcript',
    })
    assert.deepEqual(admissions, ['input_available'])
  } finally {
    controller.close()
  }
})

test('active-turn controller preserves delivery idempotency across merged admissions', async () => {
  const {
    createAssistantActiveTurnInputController,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  let ordinal = 0
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async () => {
      ordinal += 1
      return {
        acceptedInputs: [
          {
            id: `hook-${ordinal}`,
            promptFallbackReason: 'missing-content-ref',
            promptFallbackText: `Hook input ${ordinal}`,
            source: 'assistant-input',
          },
        ],
        deliveryIdempotencyKey: `idem-${ordinal}`,
        kind: 'accepted',
        prompt: `Hook input ${ordinal}`,
        transcriptText: `Hook transcript ${ordinal}`,
      }
    },
    conversationKeys: ['channel:telegram|identity:identity-1|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })

  try {
    await controller.notifyInputAvailable()
    await controller.notifyInputAvailable()

    assert.deepEqual(await controller.admitAvailable(), {
      acceptedInputs: [
        {
          id: 'hook-1',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Hook input 1',
          source: 'assistant-input',
        },
        {
          id: 'hook-2',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Hook input 2',
          source: 'assistant-input',
        },
      ],
      deliveryReplyToMessageId: undefined,
      deliveryIdempotencyKey: 'idem-2',
      kind: 'accepted',
      prompt: 'Hook input 1\n\nHook input 2',
      receiptMetadata: undefined,
      transcriptText: 'Hook transcript 1\n\nHook transcript 2',
      userMessageContent: undefined,
    })
  } finally {
    controller.close()
  }
})

test('active-turn controller ignores hook-authored provider steering acknowledgement', async () => {
  const {
    createAssistantActiveTurnInputController,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async () => ({
      acceptedInputs: [
        {
          id: 'hook-steered',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Hook claims already steered',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Hook claims already steered',
      providerAlreadySteered: true,
      transcriptText: 'Hook transcript',
    }),
    conversationKeys: ['channel:telegram|identity:identity-1|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })

  try {
    assert.deepEqual(await controller.admit({
      phase: 'request_boundary',
      sessionId: 'session-test',
      turnId: 'turn-active',
      vault: '/vaults/test',
    }), {
      acceptedInputs: [
        {
          id: 'hook-steered',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Hook claims already steered',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Hook claims already steered',
      transcriptText: 'Hook transcript',
    })
  } finally {
    controller.close()
  }
})

test('active-turn controller serializes input-available and boundary hook admission', async () => {
  const {
    createAssistantActiveTurnInputController,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const releaseFirst = createDeferred<void>()
  const phases: string[] = []
  const knownInputSnapshots: string[][] = []
  let ordinal = 0
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async (input) => {
      phases.push(input.phase)
      knownInputSnapshots.push([...(input.knownInputIds ?? [])])
      ordinal += 1
      const currentOrdinal = ordinal
      if (currentOrdinal === 1) {
        await releaseFirst.promise
      }
      return {
        acceptedInputs: [
          {
            id: `hook-${currentOrdinal}`,
            promptFallbackReason: 'missing-content-ref',
            promptFallbackText: `Hook input ${currentOrdinal}`,
            source: 'assistant-input',
          },
        ],
        kind: 'accepted',
        prompt: `Hook input ${currentOrdinal}`,
        transcriptText: `Hook transcript ${currentOrdinal}`,
      }
    },
    conversationKeys: ['channel:telegram|identity:identity-1|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })

  try {
    const notified = controller.notifyInputAvailable().catch(() => undefined)
    await vi.waitFor(() => {
      expect(phases).toEqual(['input_available'])
    })
    const boundary = controller.admit({
      phase: 'request_boundary',
      sessionId: 'session-test',
      turnId: 'turn-active',
      vault: '/vaults/test',
    })
    await Promise.resolve()
    assert.deepEqual(phases, ['input_available'])

    releaseFirst.resolve()
    assert.deepEqual(await boundary, {
      acceptedInputs: [
        {
          id: 'hook-1',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Hook input 1',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Hook input 1',
      transcriptText: 'Hook transcript 1',
    })
    await notified
    assert.deepEqual(phases, ['input_available'])
    assert.deepEqual(knownInputSnapshots, [[]])
  } finally {
    releaseFirst.resolve()
    controller.close()
  }
})

test('sendAssistantMessageLocal closes steering at commit barrier without empty checkpoint', async () => {
  const session = createAssistantSession({
    binding: {
      actorId: null,
      channel: 'telegram',
      conversationKey: 'channel:telegram|identity:identity-1|thread:thread-1',
      delivery: {
        kind: 'thread',
        target: 'thread-1',
      },
      identityId: 'identity-1',
      threadId: 'thread-1',
      threadIsDirect: false,
    },
  })
  const commitStarted = createDeferred<void>()
  const commitRelease = createDeferred<void>()
  const activeTurnInput = vi.fn<AssistantActiveTurnInputAdmissionHook>(async () => ({
    kind: 'no-new-input' as const,
  }))
  const activeTurnCheckpoint = vi.fn(
    async (_input: AssistantActiveTurnInputCheckpointInput) => undefined,
  )
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...createSharedPlan(),
      persistUserPromptOnFailure: false,
    },
    session,
  })
  mocks.executeCodexTurnWithRecovery
    .mockResolvedValueOnce({
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        response: 'first response',
        session,
      },
    })
    .mockResolvedValueOnce({
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        response: 'second response',
        session,
      },
    })
  mocks.finalizeAssistantTurnArtifacts.mockResolvedValue(session)
  mocks.runtimeState.turns.acceptedInputs.updateAdmissionState
    .mockImplementationOnce(async () => {
      commitStarted.resolve()
      await commitRelease.promise
      return null
    })

  const firstResultPromise = sendAssistantMessageLocal({
    activeTurnCheckpoint,
    activeTurnInput,
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  })
  await commitStarted.promise
  assert.equal(mocks.finalizeAssistantTurnArtifacts.mock.calls.length, 0)
  assert.equal(
    mocks.runtimeState.turns.acceptedInputs.updateAdmissionState.mock.calls.length,
    1,
  )
  assert.equal(activeTurnCheckpoint.mock.calls.length, 0)

  await expect(sendAssistantMessageLocal({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
    },
    expectedActiveTurnId: 'turn-1',
    prompt: 'Arrived after commit barrier',
    vault: '/vaults/test',
  })).rejects.toMatchObject({
    code: 'ASSISTANT_ACTIVE_TURN_NOT_ACTIVE',
  })

  const secondResult = await sendAssistantMessageLocal({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
    },
    prompt: 'Arrived after commit barrier',
    vault: '/vaults/test',
  })

  assert.equal(secondResult.response, 'second response')
  assert.equal(mocks.createAssistantTurnReceipt.mock.calls.length, 2)
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 2)
  assert.equal(
    mocks.executeCodexTurnWithRecovery.mock.calls[1]?.[0]?.input.prompt,
    'Arrived after commit barrier',
  )

  commitRelease.resolve()
  const firstResult = await firstResultPromise
  assert.equal(firstResult.response, 'first response')
  assert.equal(activeTurnInput.mock.calls.length, 3)
  assert.deepEqual(
    activeTurnInput.mock.calls.map((call) => call[0]?.phase),
    ['input_available', 'request_boundary', 'commit_barrier'],
  )
  assert.equal(activeTurnCheckpoint.mock.calls.length, 0)
})

test('sendAssistantMessageLocal preserves boundary admission for hosted queue-only auto-replies', async () => {
  const activeTurnInput = vi.fn<AssistantActiveTurnInputAdmissionHook>(async () => ({
    kind: 'no-new-input' as const,
  }))
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...createSharedPlan(),
      persistUserPromptOnFailure: false,
    },
  })

  const result = await sendAssistantMessageLocal({
    activeTurnInput,
    deliverResponse: true,
    deliveryDispatchMode: 'queue-only',
    executionContext: {
      hosted: {
        memberId: 'member-hosted',
        userEnvKeys: [],
      },
    },
    prompt: 'Hosted queue-only auto-reply',
    turnTrigger: 'automation-auto-reply',
    vault: '/vaults/test',
  })

  assert.equal(result.response, 'assistant response')
  assert.equal(activeTurnInput.mock.calls.length, 3)
  assert.deepEqual(
    activeTurnInput.mock.calls.map((call) => call[0]?.phase),
    ['input_available', 'request_boundary', 'commit_barrier'],
  )
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 1)
  assert.equal(
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.modelProgressUpdatesEnabled,
    true,
  )
  assert.ok(mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.progressDelivery)
  assert.equal(mocks.dispatchAssistantReply.mock.calls.length, 1)
})

test('sendAssistantMessageLocal routes hosted Linq model progress through progress delivery dependencies', async () => {
  const progressDeliveryDependencies = {
    sendLinq: vi.fn(async () => ({
      providerMessageId: 'progress-message',
      providerThreadId: 'thread-progress',
      target: 'thread-progress',
      targetKind: 'thread' as const,
    })),
  }
  const sharedPlan = createSharedPlan()
  sharedPlan.conversationPolicy.audience.channel = 'linq'
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...sharedPlan,
      persistUserPromptOnFailure: false,
    },
  })

  await sendAssistantMessageLocal({
    channel: 'linq',
    deliverResponse: true,
    deliveryDispatchMode: 'queue-only',
    executionContext: {
      hosted: {
        memberId: 'member-hosted',
        progressDeliveryDependencies,
        userEnvKeys: [],
      },
    },
    prompt: 'Hosted queue-only auto-reply',
    turnTrigger: 'automation-auto-reply',
    vault: '/vaults/test',
  })

  const progressDelivery =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.progressDelivery
  assert.ok(progressDelivery)
  await progressDelivery.send('Checking the iMessage thread.')

  assert.equal(mocks.deliverAssistantProgressUpdate.mock.calls.length, 1)
  assert.equal(
    mocks.deliverAssistantProgressUpdate.mock.calls[0]?.[0]?.dependencies,
    progressDeliveryDependencies,
  )
  assert.equal(
    mocks.deliverAssistantProgressUpdate.mock.calls[0]?.[0]?.text,
    'Checking the iMessage thread.',
  )
})

test('sendAssistantMessageLocal preflights hosted attachment progress before provider execution', async () => {
  const context = await createTempVaultContext(
    'assistant-local-service-hosted-attachment-progress-',
  )
  tempRoots.push(context.parentRoot)
  const hostedInput = await upsertAssistantInputEvent({
    vault: context.vaultRoot,
    now: new Date('2026-04-22T10:00:01.000Z'),
    event: {
      content: {
        attachmentDescriptors: [
          {
            attachmentId: 'att_pdf_1',
            contentType: 'application/pdf',
            fileName: 'lab-report.pdf',
            kind: 'document',
            sizeBytes: 12_345,
          },
        ],
        text: 'Received a Linq message with 1 attachment.',
      },
      conversation: {
        accountId: 'acct_1',
        actorId: 'actor_1',
        actorIsSelf: false,
        source: 'linq',
        threadId: 'thread-progress',
        threadIsDirect: true,
      },
      occurredAt: '2026-04-22T10:00:00.000Z',
      receivedAt: '2026-04-22T10:00:00.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'message-progress',
        threadId: 'thread-progress',
      },
      sourceRef: createHostedMailboxSourceRef({
        eventId: 'evt_attachment_progress',
        laneSeq: '1',
      }),
    },
  })
  const progressDeliveryDependencies = {
    sendLinq: vi.fn(async () => ({
      providerMessageId: 'progress-message',
      providerThreadId: 'thread-progress',
      target: 'thread-progress',
      targetKind: 'thread' as const,
    })),
  }
  const sharedPlan = createSharedPlan()
  sharedPlan.conversationPolicy.audience.channel = 'linq'
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...sharedPlan,
      persistUserPromptOnFailure: false,
    },
    realAcceptedInputPersistence: true,
  })

  await sendAssistantMessageLocal({
    acceptedTurnInput: {
      initialInputs: [
        {
          contentRef: {
            kind: 'assistant-input-event',
            refId: hostedInput.inputId,
            version: hostedInput.schema,
          },
          id: hostedInput.inputId,
          source: 'assistant-input',
        },
      ],
    },
    channel: 'linq',
    deliverResponse: true,
    deliveryDispatchMode: 'queue-only',
    executionContext: {
      hosted: {
        memberId: 'member-hosted',
        progressDeliveryDependencies,
        userEnvKeys: [],
      },
    },
    prompt: 'Process the attached PDF',
    turnTrigger: 'automation-auto-reply',
    vault: context.vaultRoot,
  })

  expect(mocks.deliverAssistantProgressUpdate).toHaveBeenCalledTimes(1)
  expect(mocks.deliverAssistantProgressUpdate.mock.calls[0]?.[0]).toMatchObject({
    dependencies: progressDeliveryDependencies,
    text: "File received. I'm checking the attachment now.",
  })
  expect(
    mocks.deliverAssistantProgressUpdate.mock.invocationCallOrder[0],
  ).toBeLessThan(
    mocks.executeCodexTurnWithRecovery.mock.invocationCallOrder[0] ??
      Number.MAX_SAFE_INTEGER,
  )

  const progressDelivery =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.progressDelivery
  assert.ok(progressDelivery)
  await expect(
    progressDelivery.send('Checking the saved context now.'),
  ).resolves.toEqual({
    kind: 'skipped',
    reason: 'limit',
    source: 'model',
  })
  expect(mocks.deliverAssistantProgressUpdate).toHaveBeenCalledTimes(1)
})

test('sendAssistantMessageLocal uses resolved audience channel for hosted model progress', async () => {
  const progressDeliveryDependencies = {
    sendLinq: vi.fn(async () => ({
      providerMessageId: 'progress-message',
      providerThreadId: 'thread-progress',
      target: 'thread-progress',
      targetKind: 'thread' as const,
    })),
  }
  const sharedPlan = createSharedPlan()
  sharedPlan.conversationPolicy.audience.channel = 'linq'
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...sharedPlan,
      persistUserPromptOnFailure: false,
    },
    session: createAssistantSession({
      binding: {
        actorId: null,
        channel: null,
        conversationKey: null,
        delivery: {
          kind: 'thread',
          target: 'thread-1',
        },
        identityId: 'identity-1',
        threadId: 'thread-1',
        threadIsDirect: false,
      },
    }),
  })

  await sendAssistantMessageLocal({
    deliverResponse: true,
    deliveryDispatchMode: 'queue-only',
    executionContext: {
      hosted: {
        memberId: 'member-hosted',
        progressDeliveryDependencies,
        userEnvKeys: [],
      },
    },
    prompt: 'Hosted queue-only auto-reply',
    turnTrigger: 'automation-auto-reply',
    vault: '/vaults/test',
  })

  const progressDelivery =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.progressDelivery
  assert.ok(progressDelivery)
  const result = await progressDelivery.send('Checking the iMessage thread.')

  assert.deepEqual(result, {
    kind: 'sent',
    source: 'model',
  })
  assert.equal(mocks.deliverAssistantProgressUpdate.mock.calls.length, 1)
  assert.equal(
    mocks.deliverAssistantProgressUpdate.mock.calls[0]?.[0]?.dependencies,
    progressDeliveryDependencies,
  )
})

test('sendAssistantMessageLocal rejects hosted model progress for non-Linq resolved audience channels', async () => {
  const progressDeliveryDependencies = {
    sendLinq: vi.fn(async () => ({
      providerMessageId: 'progress-message',
      providerThreadId: 'thread-progress',
      target: 'thread-progress',
      targetKind: 'thread' as const,
    })),
  }
  const sharedPlan = createSharedPlan()
  sharedPlan.conversationPolicy.audience.channel = 'email'
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...sharedPlan,
      persistUserPromptOnFailure: false,
    },
  })

  await sendAssistantMessageLocal({
    channel: 'linq',
    deliverResponse: true,
    deliveryDispatchMode: 'queue-only',
    executionContext: {
      hosted: {
        memberId: 'member-hosted',
        progressDeliveryDependencies,
        userEnvKeys: [],
      },
    },
    prompt: 'Hosted queue-only auto-reply',
    turnTrigger: 'automation-auto-reply',
    vault: '/vaults/test',
  })

  const progressDelivery =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.progressDelivery
  assert.ok(progressDelivery)
  const result = await progressDelivery.send('Checking the iMessage thread.')

  assert.deepEqual(result, {
    kind: 'failed',
    source: 'model',
  })
  assert.equal(mocks.deliverAssistantProgressUpdate.mock.calls.length, 0)
  assert.equal(progressDeliveryDependencies.sendLinq.mock.calls.length, 0)
})

test('sendAssistantMessageLocal runs best-effort failure cleanup and rethrows terminal provider failures', async () => {
  const terminalError = new Error('provider failed hard')
  const failedProviderSession = createAssistantSession({
    sessionId: 'session-provider-failed',
  })
  const { mocks, sendAssistantMessageLocal, session } = await loadLocalServiceModule({
    plan: {
      ...createSharedPlan(),
      persistUserPromptOnFailure: false,
    },
    providerOutcome: {
      attemptCount: 1,
      error: terminalError,
      kind: 'failed_terminal',
      providerRequestOutcome: 'failed',
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
      codexThreadId: 'provider-session-failed',
      providerTurnId: 'provider-turn-failed',
      rawEvents: [{ method: 'turn/completed' }],
      route: {
        provider: 'codex-cli',
        providerOptions: {
          model: 'gpt-5.4',
        },
      },
      session: failedProviderSession,
      usage: createProviderUsage({
        inputTokens: 9,
        outputTokens: 0,
        totalTokens: 9,
      }),
      usageAttribution: null,
    },
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
    session,
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
  assert.deepEqual(
    mocks.recordAssistantUsageEvent.mock.calls[0]?.[0],
    {
      executionContext: null,
      providerRequestOrdinal: 0,
      providerRequestOutcome: 'failed',
      providerResult: {
        attemptCount: 1,
        provider: 'codex-cli',
        providerOptions: {
          model: 'gpt-5.4',
        },
        route: {
          provider: 'codex-cli',
          providerOptions: {
            model: 'gpt-5.4',
          },
        },
        session: failedProviderSession,
        usage: createProviderUsage({
          inputTokens: 9,
          outputTokens: 0,
          totalTokens: 9,
        }),
        usageAttribution: null,
      },
      turnId: 'turn-1',
    },
  )
  assert.deepEqual(
    mocks.runtimeState.turns.acceptedInputs.recordProviderRequest.mock.calls.map(
      (call) => call[0]?.continuation,
    ),
    [
      {
        kind: 'explicit-structured-history',
      },
    ],
  )
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
    turnTrigger: 'automation-auto-reply',
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
  assert.equal(mocks.refreshAssistantStatusSnapshotLocal.mock.calls.length, 0)
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
    message: 'delivery deferred for background retry',
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

test('sendAssistantMessageLocal uses the Codex route and not-requested delivery state', async () => {
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
    route: {
      provider: 'codex-cli',
      providerOptions: {
        model: null,
      },
    },
    session,
    transcriptEntries: [],
  })

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'No explicit delivery please',
    vault: '/vaults/test',
  })

  assert.equal(result.delivery, null)
  assert.equal(result.deliveryDeferred, false)
  assert.equal(result.deliveryError, null)
  assert.equal(result.deliveryIntentId, null)
  assert.equal(result.session.sessionId, session.sessionId)
  assert.equal(mocks.createAssistantTurnReceipt.mock.calls[0]?.[0]?.provider, 'codex-cli')
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
        routeFingerprint: 'route-1',
        threadId: 'provider-session-1',
      },
    }),
  })
  mocks.saveAssistantSession.mockResolvedValueOnce(updatedSession)

  const result = await updateAssistantSessionOptionsLocal({
    providerOptions: {
      model: 'gpt-5.4-mini',
      modelProvider: 'vercel-ai-gateway',
      provider: 'codex-cli',
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
  assert.equal(mocks.saveAssistantSession.mock.calls[0]?.[1]?.provider, 'codex-cli')
  assert.equal(mocks.saveAssistantSession.mock.calls[0]?.[1]?.target?.adapter, 'codex-cli')
  assert.equal(mocks.saveAssistantSession.mock.calls[0]?.[1]?.resumeState, null)
})

test('updateAssistantSessionOptionsLocal preserves codex target-only fields', async () => {
  const updatedSession = createAssistantSession({
    provider: 'codex-cli',
    providerOptions: {
      provider: 'codex-cli',
      approvalPolicy: 'never',
      codexHome: '/tmp/codex-home',
      continuityFingerprint: 'fingerprint-codex',
      executionDriver: 'codex-app-server',
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
      oss: false,
      profile: 'prod',
      reasoningEffort: 'high',
      resumeKind: 'codex-thread',
      sandbox: 'workspace-write',
    },
    sessionId: 'session-codex-updated',
    target: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexCommand: '/opt/murph/bin/custom-codex',
      codexHome: '/tmp/codex-home',
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
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
        codexHome: '/tmp/codex-home',
        continuityFingerprint: 'fingerprint-codex',
        executionDriver: 'codex-app-server',
        model: 'gpt-5.4',
        modelProvider: 'vercel-ai-gateway',
        oss: false,
        profile: 'prod',
        reasoningEffort: 'high',
        resumeKind: 'codex-thread',
        sandbox: 'workspace-write',
      },
      sessionId: 'session-codex-updated',
      target: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: '/opt/murph/bin/custom-codex',
        codexHome: '/tmp/codex-home',
        model: 'gpt-5.4',
        modelProvider: 'vercel-ai-gateway',
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
  realAcceptedInputPersistence?: boolean
  plan?: ReturnType<typeof createSharedPlan>
  providerOutcome?:
    | {
        kind: 'failed_terminal'
        attemptCount: number
        error: Error
        providerRequestOutcome: 'aborted' | 'failed' | 'partial'
        codexContinuation: AssistantCodexContinuation
        codexThreadId: string | null
        providerTurnId: string | null
        rawEvents: unknown[]
        route: {
          provider: string
          providerOptions: {
            model?: string | null
          }
        }
        session: AssistantSession
        usage: AssistantProviderUsage | null
        usageAttribution: null
      }
    | {
        kind: 'succeeded'
        providerTurn: {
          onboardingGuidanceInjected: boolean
          codexContinuation: AssistantCodexContinuation
          response: string
          session: AssistantSession
        }
      }
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
  route?: {
    provider: string
    providerOptions?: {
      model?: string | null
    } | null
  }
  session?: AssistantSession
  transcriptEntries?: Array<{
    createdAt?: string | null
  }>
}) {
  const session = input?.session ?? createAssistantSession()
  const sharedPlan = input?.plan ?? createSharedPlan()
  const useRealAcceptedInputPersistence = input?.realAcceptedInputPersistence === true
  const providerOutcome =
    input?.providerOutcome ?? {
      kind: 'succeeded' as const,
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        codexThreadId: 'provider-thread-default',
        response: 'assistant response',
        route: {
          routeId: 'route-default',
        },
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
  const acceptedInputIds: string[] = []
  let transcriptEntryCount = 0

  const mocks = {
    appendAssistantTranscriptEntries: vi.fn(
      async (
        _vault: Parameters<
          typeof import('../src/assistant/store.js').appendAssistantTranscriptEntries
        >[0],
        _sessionId: Parameters<
          typeof import('../src/assistant/store.js').appendAssistantTranscriptEntries
        >[1],
        _entries: Parameters<
          typeof import('../src/assistant/store.js').appendAssistantTranscriptEntries
        >[2],
      ) =>
        input?.transcriptEntries ?? [
          {
            createdAt: '2026-04-08T12:00:00.000Z',
          },
        ],
    ),
    appendAssistantTranscriptEntriesWithRefs: vi.fn(
      async (
        vault: Parameters<
          typeof import('../src/assistant/store.js').appendAssistantTranscriptEntries
        >[0],
        sessionId: Parameters<
          typeof import('../src/assistant/store.js').appendAssistantTranscriptEntries
        >[1],
        entries: Parameters<
          typeof import('../src/assistant/store.js').appendAssistantTranscriptEntries
        >[2],
      ) => {
        const appended = await mocks.appendAssistantTranscriptEntries(
          vault,
          sessionId,
          entries,
        )
        const firstEntryIndex = transcriptEntryCount
        transcriptEntryCount += entries.length
        return {
          entries: appended,
          refs: entries.map((entry, index) => ({
            entryCreatedAt:
              appended[index]?.createdAt ?? '2026-04-08T12:00:00.000Z',
            entryIndex: firstEntryIndex + index,
            entryKind: entry.kind,
            sessionId,
          })),
        }
      },
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
    deliverAssistantProgressUpdate: vi.fn(
      async (
        _input: Parameters<
          typeof import('../src/assistant/delivery-service.js').deliverAssistantProgressUpdate
        >[0],
      ) => undefined,
    ),
    dispatchAssistantReply: vi.fn(async () => deliveryOutcome),
    executeCodexTurnWithRecovery: vi.fn(
      async (
        providerInput: Parameters<
          typeof import('../src/assistant/codex-turn-runner.js').executeCodexTurnWithRecovery
        >[0],
      ) => {
        await providerInput.onProviderRequestPlanned?.({
          providerAttemptId: null,
          codexContinuation:
            providerOutcome.kind === 'succeeded'
              ? providerOutcome.providerTurn.codexContinuation
              : providerOutcome.codexContinuation,
        })
        return providerOutcome
      },
    ),
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
    recordAssistantUsageEvent: vi.fn(
      async (_input: { providerRequestOrdinal?: number }) => undefined,
    ),
    runtimeState: {
      turns: {
        acceptedInputs: {
          append: vi.fn(
            async (appendInput: {
              inputs: readonly { id: string }[]
            }) => {
              for (const acceptedInput of appendInput.inputs) {
                if (!acceptedInputIds.includes(acceptedInput.id)) {
                  acceptedInputIds.push(acceptedInput.id)
                }
              }
              return {
                admissionState: 'current-turn-open' as const,
                inputIds: [...acceptedInputIds],
                inputs: [],
                providerRequests: [],
              }
            },
          ),
          recordProviderRequest: vi.fn(
            async (_input: {
              continuation?: { kind: string } | null
              ordinal: number
              providerAttemptId?: string | null
            }) => ({
              admissionState: 'current-turn-open' as const,
              inputIds: [...acceptedInputIds],
              inputs: [],
              providerRequests: [],
            }),
          ),
          updateTranscriptRefs: vi.fn(
            async (_input: {
              refs: readonly {
                inputId: string
                transcriptRef: {
                  entryCreatedAt: string | null
                  entryIndex: number | null
                  entryKind: string | null
                  sessionId: string
                }
              }[]
            }) => ({
              admissionState: 'current-turn-open' as const,
              inputIds: [...acceptedInputIds],
              inputs: [],
              providerRequests: [],
            }),
          ),
          updateAdmissionState: vi.fn(
            async (_input: { admissionState: string }) => null,
          ),
          updateProviderRequest: vi.fn(
            async (_input: {
              acceptedInputIds?: readonly string[] | null
              continuation: { kind: string }
              ordinal: number
              providerAttemptId?: string | null
              turnId?: string
            }) => ({
              admissionState: 'current-turn-open' as const,
              inputIds: [...acceptedInputIds],
              inputs: [],
              providerRequests: [],
            }),
          ),
        },
      },
    },
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
    resolveAssistantTurnRoute: vi.fn(() =>
      input?.route ?? {
        provider: 'codex-cli',
        providerOptions: {
          model: 'gpt-5.4',
        },
      },
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
      adapter: 'codex-cli'
      approvalPolicy?: string | null
      codexCommand?: string | null
      codexHome?: string | null
      model?: string | null
      modelProvider?: string | null
      oss?: boolean
      profile?: string | null
      reasoningEffort?: string | null
      sandbox?: string | null
    }) => ({
      provider: 'codex-cli',
      approvalPolicy: target.approvalPolicy ?? null,
      codexCommand: target.codexCommand ?? null,
      codexHome: target.codexHome ?? null,
      model: target.model ?? null,
      modelProvider: target.modelProvider ?? null,
      oss: target.oss === true,
      profile: target.profile ?? null,
      reasoningEffort: target.reasoningEffort ?? null,
      sandbox: target.sandbox ?? null,
    }),
    createAssistantModelTarget: (input: {
      approvalPolicy?: CodexAssistantTarget['approvalPolicy']
      codexCommand?: string | null
      codexHome?: string | null
      model?: string | null
      modelProvider?: string | null
      oss?: boolean
      policy?: {
        approvalPolicy?: CodexAssistantTarget['approvalPolicy']
        reasoningEffort?: CodexAssistantTarget['reasoningEffort']
        sandbox?: CodexAssistantTarget['sandbox']
        webSearch?: string | null
      } | null
      profile?: string | null
      provider?: 'codex-cli' | null
      reasoningEffort?: CodexAssistantTarget['reasoningEffort']
      sandbox?: CodexAssistantTarget['sandbox']
      target?: {
        kind: 'codex-cli' | 'responses'
        codexCommand?: string | null
        codexHome?: string | null
        model?: string | null
        modelProvider?: string | null
        oss?: boolean
        profile?: string | null
      } | null
    }) => {
      const provider =
        input.target?.kind === 'codex-cli'
          ? 'codex-cli'
          : input.target
            ? null
            : input.provider

      if (provider === 'codex-cli') {
        return createCodexTarget({
          approvalPolicy: input.policy?.approvalPolicy ?? input.approvalPolicy ?? null,
          codexCommand: input.target?.codexCommand ?? input.codexCommand ?? null,
          codexHome: input.target?.codexHome ?? input.codexHome ?? null,
          model: input.target?.model ?? input.model ?? null,
          modelProvider: input.target?.modelProvider ?? input.modelProvider ?? null,
          oss: input.target?.oss ?? input.oss === true,
          profile: input.target?.profile ?? input.profile ?? null,
          reasoningEffort:
            input.policy?.reasoningEffort ?? input.reasoningEffort ?? null,
          sandbox: input.policy?.sandbox ?? input.sandbox ?? null,
        })
      }

      return null
    },
    createDefaultLocalAssistantModelTarget: () => createCodexTarget(),
  }))
  if (!useRealAcceptedInputPersistence) {
    vi.doMock('../src/assistant/store.js', () => ({
      appendAssistantTranscriptEntries: mocks.appendAssistantTranscriptEntries,
      appendAssistantTranscriptEntriesWithRefs:
        mocks.appendAssistantTranscriptEntriesWithRefs,
      listAssistantTranscriptEntries: mocks.listAssistantTranscriptEntries,
      redactAssistantDisplayPath: mocks.redactAssistantDisplayPath,
      resolveAssistantSession: mocks.resolveAssistantSession,
      saveAssistantSession: mocks.saveAssistantSession,
    }))
  }
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
    deliverAssistantProgressUpdate: mocks.deliverAssistantProgressUpdate,
    finalizeAssistantTurnFromDeliveryOutcome: mocks.finalizeDeliveredAssistantTurn,
  }))
  vi.doMock('../src/assistant/turn-finalizer.js', () => ({
    persistAssistantTurnAndSession: mocks.finalizeAssistantTurnArtifacts,
    resolveAssistantResumeStateFromProviderTurn: (input: {
      codexThreadId: string | null
      routeFingerprint: string
    }) => ({
      routeFingerprint: input.routeFingerprint,
      threadId: input.codexThreadId,
    }),
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
  vi.doMock('../src/assistant/codex-turn-runner.js', () => ({
    executeCodexTurnWithRecovery: mocks.executeCodexTurnWithRecovery,
    resolveAssistantCodexThreadScope: vi.fn(
      (input: { turnTrigger?: string | null }) =>
        input.turnTrigger === 'automation-cron'
          ? 'isolated-thread'
          : 'session-thread',
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
    resolveAssistantTurnRoute: mocks.resolveAssistantTurnRoute,
  }))
  vi.doMock('../src/assistant/service-usage.js', () => ({
    recordAssistantUsageEvent: mocks.recordAssistantUsageEvent,
  }))
  if (!useRealAcceptedInputPersistence) {
    vi.doMock('../src/assistant/runtime-state-service.js', () => ({
      createAssistantRuntimeStateService: vi.fn(() => mocks.runtimeState),
    }))
  }
  vi.doMock('../src/assistant/channel-adapters.js', () => ({
    getAssistantChannelAdapter: mocks.getAssistantChannelAdapter,
  }))
  vi.doMock('../src/assistant/turn-input.js', () => ({
    AssistantActiveTurnInputBudgetExceededError: class AssistantActiveTurnInputBudgetExceededError extends Error {
      constructor() {
        super('Active turn input kept arriving during the turn; retry the expanded turn later.')
        this.name = 'AssistantActiveTurnInputBudgetExceededError'
      }
    },
    isAssistantActiveTurnInputCheckpointRejectedError(value: unknown) {
      return value instanceof Error &&
        value.name === 'AssistantActiveTurnInputCheckpointRejectedError'
    },
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

function createHostedMailboxSourceRef(input: {
  dedupeKey?: string | null
  eventId: string
  itemId?: string
  lane?: 'conversation' | 'system'
  laneSeq: string
}) {
  return {
    dedupeKey: input.dedupeKey === undefined
      ? `${input.eventId}_dedupe`
      : input.dedupeKey,
    eventId: input.eventId,
    itemId: input.itemId ?? `${input.eventId}_item`,
    kind: 'hosted-mailbox' as const,
    lane: input.lane ?? 'conversation',
    laneSeq: input.laneSeq,
    payloadSchema: 'murph.hosted-payload.v1',
    payloadSource: 'sidecar' as const,
    source: 'hosted-mailbox' as const,
    wakeSchema: 'murph.hosted-wake.v1',
  }
}

function createProviderUsage(
  overrides: Partial<AssistantProviderUsage> = {},
): AssistantProviderUsage {
  return {
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
    ...overrides,
  }
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
    codexResume: input?.resumeState ?? null,
    codexTarget:
      input?.target ??
      createCodexTarget(),
    conversationId: input?.sessionId ?? 'session-test',
    lastTurnAt: null,
    provider: input?.provider ?? 'codex-cli',
    providerOptions: {
      provider: input?.provider ?? 'codex-cli',
      approvalPolicy: 'never',
      codexHome: null,
      continuityFingerprint: 'fingerprint-codex',
      executionDriver: 'codex-app-server',
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
      oss: false,
      profile: null,
      reasoningEffort: 'medium',
      resumeKind: 'codex-thread',
      sandbox: 'danger-full-access',
      ...input?.providerOptions,
    },
    resumeState: input?.resumeState ?? null,
    schema: 'murph.assistant-conversation.v2',
    sessionId: input?.sessionId ?? 'session-test',
    target:
      input?.target ??
      createCodexTarget(),
    turnCount: 0,
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
