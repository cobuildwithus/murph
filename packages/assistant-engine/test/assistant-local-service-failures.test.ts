import assert from 'node:assert/strict'

import { expect, test, vi } from 'vitest'

import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantChannelAdapter } from '../src/assistant/channel-adapters.ts'
import type { AssistantDeliveryOutcome } from '../src/assistant/service-contracts.ts'

import {
  createAssistantSession,
  createDeferred,
  createProviderUsage,
  createSharedPlan,
  isTraceEventWithRawType,
  loadLocalServiceModule,
} from './assistant-local-service-runtime.harness.ts'

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
  mocks.maybeRunAssistantRuntimeMaintenance.mockRejectedValueOnce(
    new Error('ignore failed post-turn maintenance'),
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
  // The post-turn maintenance owner still runs when the turn fails, and its
  // own rejection above must not mask the original provider error asserted
  // by assert.rejects.
  assert.equal(mocks.maybeRunAssistantRuntimeMaintenance.mock.calls.length, 1)
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
      providerRequestAcceptedInputIds: ['initial'],
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
  assert.equal(mocks.recordAssistantDiagnosticEvent.mock.calls.length, 1)
  assert.equal(mocks.recordAssistantDiagnosticEvent.mock.calls[0]?.[0]?.kind, 'turn.failed')
  assert.deepEqual(
    mocks.recordAssistantDiagnosticEvent.mock.calls[0]?.[0]?.counterDeltas,
    {
      turnsFailed: 1,
    },
  )
  assert.equal(mocks.normalizeAssistantDeliveryError.mock.calls.length, 1)
  assert.equal(mocks.refreshAssistantStatusSnapshotLocal.mock.calls.length, 1)
})

test('sendAssistantMessageLocal saves progress-materialized sessions after terminal provider failures', async () => {
  const terminalError = new Error('provider failed after progress')
  const assistantContractFingerprint = 'b'.repeat(64)
  const codexRolloutRelativePath =
    'sessions/2026/07/14/rollout-provider-thread-progress-failed.jsonl'
  const routeFingerprint = 'route-progress-failed'
  const baseSession = createAssistantSession({
    binding: {
      actorId: 'actor-progress-failed',
      channel: 'linq',
      conversationKey: null,
      delivery: {
        kind: 'participant',
        target: 'participant-progress-failed',
      },
      identityId: 'identity-progress-failed',
      threadId: null,
      threadIsDirect: null,
    },
    sessionId: 'session-progress-failed',
  })
  const materializedSession: AssistantSession = {
    ...baseSession,
    binding: {
      ...baseSession.binding,
      delivery: {
        kind: 'thread',
        target: 'thread-progress-failed',
      },
      threadId: 'thread-progress-failed',
      threadIsDirect: true,
    },
    updatedAt: '2026-04-08T12:00:03.000Z',
  }
  const providerSession: AssistantSession = {
    ...baseSession,
    updatedAt: '2026-04-08T12:00:04.000Z',
  }
  const progressDeliveryDependencies = {
    sendLinq: vi.fn(async () => ({
      providerMessageId: 'progress-message',
      providerThreadId: 'thread-progress-failed',
      target: 'thread-progress-failed',
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
    session: baseSession,
  })
  mocks.deliverAssistantProgressUpdate.mockResolvedValueOnce(materializedSession)
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    await expect(
      providerInput.progressDelivery?.send('Checking the iMessage thread.'),
    ).resolves.toEqual({
      kind: 'sent',
      source: 'model',
    })
    return {
      acceptedNoReplyDeliveryContextOrdinals: [],
      assistantContractFingerprint,
      attemptCount: 1,
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
      codexRolloutRelativePath,
      codexThreadId: 'provider-thread-progress-failed',
      error: terminalError,
      kind: 'failed_terminal',
      providerRequestOutcome: 'failed',
      providerTurnId: 'provider-turn-progress-failed',
      rawEvents: [],
      route: {
        provider: 'codex-cli',
        providerOptions: {
          model: 'gpt-5.4',
        },
        routeId: routeFingerprint,
      },
      session: providerSession,
      usage: null,
      usageAttribution: null,
    }
  })

  await expect(
    sendAssistantMessageLocal({
      channel: 'linq',
      deliverResponse: true,
      deliveryDispatchMode: 'immediate',
      executionContext: {
        hosted: {
          memberId: 'member-hosted',
          progressDeliveryDependencies,
          userEnvKeys: [],
        },
      },
      prompt: 'Hosted failed manual task',
      turnTrigger: 'manual-ask',
      vault: '/vaults/test',
    }),
  ).rejects.toBe(terminalError)

  expect(mocks.saveAssistantSession).toHaveBeenCalledWith(
    '/vaults/test',
    expect.objectContaining({
      binding: expect.objectContaining({
        delivery: {
          kind: 'thread',
          target: 'thread-progress-failed',
        },
        threadId: 'thread-progress-failed',
        threadIsDirect: true,
      }),
      codexResume: {
        assistantContractFingerprint,
        rolloutRelativePath: codexRolloutRelativePath,
        routeFingerprint,
        threadId: 'provider-thread-progress-failed',
      },
      resumeState: {
        assistantContractFingerprint,
        rolloutRelativePath: codexRolloutRelativePath,
        routeFingerprint,
        threadId: 'provider-thread-progress-failed',
      },
      turnCount: baseSession.turnCount,
    }),
  )
  expect(
    mocks.persistFailedAssistantPromptAttempt.mock.calls[0]?.[0]?.session.binding
      .delivery,
  ).toEqual({
    kind: 'thread',
    target: 'thread-progress-failed',
  })
  expect(
    mocks.persistFailedAssistantPromptAttempt.mock.calls[0]?.[0]?.session
      .resumeState,
  ).toEqual({
    assistantContractFingerprint,
    rolloutRelativePath: codexRolloutRelativePath,
    routeFingerprint,
    threadId: 'provider-thread-progress-failed',
  })
})

test('sendAssistantMessageLocal preserves Codex resume state after progress-materialized failures', async () => {
  const terminalError = new Error('provider failed after progress')
  const staleResumeState = {
    routeFingerprint: 'route-stale-progress-failed',
    threadId: 'provider-thread-stale-progress-failed',
  }
  const baseSession = createAssistantSession({
    binding: {
      actorId: 'actor-progress-failed-clear',
      channel: 'linq',
      conversationKey: null,
      delivery: {
        kind: 'participant',
        target: 'participant-progress-failed-clear',
      },
      identityId: 'identity-progress-failed-clear',
      threadId: null,
      threadIsDirect: null,
    },
    resumeState: staleResumeState,
    sessionId: 'session-progress-failed-clear',
  })
  const materializedSession: AssistantSession = {
    ...baseSession,
    binding: {
      ...baseSession.binding,
      delivery: {
        kind: 'thread',
        target: 'thread-progress-failed-clear',
      },
      threadId: 'thread-progress-failed-clear',
      threadIsDirect: true,
    },
    updatedAt: '2026-04-08T12:00:03.000Z',
  }
  const progressDeliveryDependencies = {
    sendLinq: vi.fn(async () => ({
      providerMessageId: 'progress-message',
      providerThreadId: 'thread-progress-failed-clear',
      target: 'thread-progress-failed-clear',
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
    session: baseSession,
  })
  mocks.deliverAssistantProgressUpdate.mockResolvedValueOnce(materializedSession)
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    await expect(
      providerInput.progressDelivery?.send('Checking the iMessage thread.'),
    ).resolves.toEqual({
      kind: 'sent',
      source: 'model',
    })
    throw terminalError
  })

  await expect(
    sendAssistantMessageLocal({
      channel: 'linq',
      deliverResponse: true,
      deliveryDispatchMode: 'immediate',
      executionContext: {
        hosted: {
          memberId: 'member-hosted',
          progressDeliveryDependencies,
          userEnvKeys: [],
        },
      },
      prompt: 'Hosted failed manual task',
      turnTrigger: 'manual-ask',
      vault: '/vaults/test',
    }),
  ).rejects.toBe(terminalError)

  expect(mocks.clearAssistantSessionCodexResumeState).not.toHaveBeenCalled()
  const savedFailedSession = mocks.saveAssistantSession.mock.calls.at(-1)?.[1]
  expect(savedFailedSession?.binding.delivery).toEqual({
    kind: 'thread',
    target: 'thread-progress-failed-clear',
  })
  expect(savedFailedSession?.binding.threadId).toBe('thread-progress-failed-clear')
  expect(savedFailedSession?.resumeState).toEqual(staleResumeState)
  expect(
    mocks.persistFailedAssistantPromptAttempt.mock.calls[0]?.[0]?.session
      .resumeState,
  ).toEqual(staleResumeState)
})

test('sendAssistantMessageLocal preserves Codex resume state when progress resolves after failure', async () => {
  const terminalError = new Error('provider failed after late progress')
  const progressDeliveryStarted = createDeferred<void>()
  const progressDeliveryRelease = createDeferred<AssistantSession>()
  const staleResumeState = {
    routeFingerprint: 'route-late-progress-failed',
    threadId: 'provider-thread-late-progress-failed',
  }
  const baseSession = createAssistantSession({
    binding: {
      actorId: 'actor-progress-failed-late-clear',
      channel: 'linq',
      conversationKey: null,
      delivery: {
        kind: 'participant',
        target: 'participant-progress-failed-late-clear',
      },
      identityId: 'identity-progress-failed-late-clear',
      threadId: null,
      threadIsDirect: null,
    },
    resumeState: staleResumeState,
    sessionId: 'session-progress-failed-late-clear',
  })
  const materializedStaleSession: AssistantSession = {
    ...baseSession,
    binding: {
      ...baseSession.binding,
      delivery: {
        kind: 'thread',
        target: 'thread-progress-failed-late-clear',
      },
      threadId: 'thread-progress-failed-late-clear',
      threadIsDirect: true,
    },
    updatedAt: '2026-04-08T12:00:03.000Z',
  }
  const progressDeliveryDependencies = {
    sendLinq: vi.fn(async () => ({
      providerMessageId: 'progress-message',
      providerThreadId: 'thread-progress-failed-late-clear',
      target: 'thread-progress-failed-late-clear',
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
    session: baseSession,
  })
  mocks.deliverAssistantProgressUpdate.mockImplementationOnce(async () => {
    progressDeliveryStarted.resolve()
    return await progressDeliveryRelease.promise
  })
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    const progressPromise = providerInput.progressDelivery?.send(
      'Checking the iMessage thread.',
    )
    await progressDeliveryStarted.promise
    progressDeliveryRelease.resolve(materializedStaleSession)
    await expect(progressPromise).resolves.toEqual({
      kind: 'sent',
      source: 'model',
    })
    throw terminalError
  })

  await expect(
    sendAssistantMessageLocal({
      channel: 'linq',
      deliverResponse: true,
      deliveryDispatchMode: 'immediate',
      executionContext: {
        hosted: {
          memberId: 'member-hosted',
          progressDeliveryDependencies,
          userEnvKeys: [],
        },
      },
      prompt: 'Hosted failed manual task',
      turnTrigger: 'manual-ask',
      vault: '/vaults/test',
    }),
  ).rejects.toBe(terminalError)

  const savedFailedSession = mocks.saveAssistantSession.mock.calls.at(-1)?.[1]
  expect(savedFailedSession?.binding.delivery).toEqual({
    kind: 'thread',
    target: 'thread-progress-failed-late-clear',
  })
  expect(savedFailedSession?.binding.threadId).toBe(
    'thread-progress-failed-late-clear',
  )
  expect(mocks.clearAssistantSessionCodexResumeState).not.toHaveBeenCalled()
  expect(savedFailedSession?.resumeState).toEqual(staleResumeState)
  expect(
    mocks.persistFailedAssistantPromptAttempt.mock.calls[0]?.[0]?.session
      .resumeState,
  ).toEqual(staleResumeState)
})

test('sendAssistantMessageLocal completes accepted no-reply terminal provider failures', async () => {
  const terminalError = new Error('provider failed after no-reply')
  const failedProviderSession = createAssistantSession({
    sessionId: 'session-provider-failed-after-no-reply',
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...createSharedPlan(),
      persistUserPromptOnFailure: false,
    },
    providerOutcome: {
      acceptedNoReplyDeliveryContextOrdinals: [0],
      attemptCount: 1,
      error: terminalError,
      kind: 'failed_terminal',
      providerRequestOutcome: 'failed',
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
      codexThreadId: 'provider-thread-failed-after-no-reply',
      providerTurnId: 'provider-turn-failed-after-no-reply',
      rawEvents: [],
      route: {
        provider: 'codex-cli',
        providerOptions: {
          model: 'gpt-5.4',
        },
      },
      session: failedProviderSession,
      usage: null,
      usageAttribution: null,
    },
    session: failedProviderSession,
  })

  const result = await sendAssistantMessageLocal({
    deliverResponse: false,
    prompt: 'Finish a background task',
    vault: '/vaults/test',
  })

  expect(result).toMatchObject({
    delivery: null,
    deliveryDeferred: false,
    deliveryError: null,
    deliveryIntentId: null,
    media: [],
    response: '',
    responseDisposition: 'none',
    session: failedProviderSession,
    status: 'completed',
  })
  expect(mocks.finalizeAssistantTurnArtifacts).toHaveBeenCalledWith(
    expect.objectContaining({
      assistantTranscriptText: null,
      persistUserPromptToTranscript: true,
      providerResumeStateAction: 'persist-from-provider-turn',
      providerResult: expect.objectContaining({
        acceptedNoReplyDeliveryContextOrdinals: [0],
        finalAction: {
          kind: 'none',
        },
        response: '',
      }),
      session: failedProviderSession,
      turnId: 'turn-1',
    }),
  )
  expect(mocks.finalizeDeliveredAssistantTurn).toHaveBeenCalledWith({
    firstContactStateDocIds: expect.any(Array),
    outcome: {
      kind: 'not-requested',
      media: [],
      session: failedProviderSession,
    },
    response: '',
    turnId: 'turn-1',
    vault: '/vaults/test',
  })
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateAdmissionState,
  ).toHaveBeenCalledWith({
    admissionState: 'commit-started',
    turnId: 'turn-1',
  })
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateAdmissionState.mock
      .invocationCallOrder[0],
  ).toBeLessThan(
    mocks.finalizeAssistantTurnArtifacts.mock.invocationCallOrder[0],
  )
  expect(mocks.normalizeAssistantDeliveryError).not.toHaveBeenCalled()
})

test('sendAssistantMessageLocal delivers preserved reactions for accepted no-reply terminal provider failures', async () => {
  const terminalError = new Error('provider failed after reaction no-reply')
  const failedProviderSession = createAssistantSession({
    sessionId: 'session-provider-failed-after-reaction-no-reply',
  })
  const traceEvents: unknown[] = []
  const reactionOutcome: AssistantDeliveryOutcome = {
    error: null,
    intentId: 'intent-failed-terminal-reaction',
    kind: 'queued',
    media: [],
    session: failedProviderSession,
  }
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    providerOutcome: {
      acceptedNoReplyDeliveryContextOrdinals: [0],
      attemptCount: 1,
      error: terminalError,
      kind: 'failed_terminal',
      providerRequestOutcome: 'failed',
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
      codexThreadId: 'provider-thread-failed-after-reaction-no-reply',
      providerTurnId: 'provider-turn-failed-after-reaction-no-reply',
      rawEvents: [],
      reactions: [
        {
          deliveryContextOrdinal: 0,
          reaction: 'heart',
          targetInputId: 'initial',
        },
      ],
      route: {
        provider: 'codex-cli',
        providerOptions: {
          model: 'gpt-5.4',
        },
      },
      session: failedProviderSession,
      usage: null,
      usageAttribution: null,
    },
    reactionOutcome,
    session: failedProviderSession,
  })

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    executionContext: {
      hosted: {
        memberId: 'member-123',
        userEnvKeys: [],
      },
    },
    onTraceEvent(event) {
      traceEvents.push(event)
    },
    prompt: 'React and finish',
    vault: '/vaults/test',
  })

  expect(mocks.deliverAssistantReaction).toHaveBeenCalledWith(
    expect.objectContaining({
      deliveryContextOrdinal: 0,
      reaction: 'heart',
      session: failedProviderSession,
      turnId: 'turn-1',
    }),
  )
  expect(result).toMatchObject({
    delivery: null,
    deliveryDeferred: true,
    deliveryError: null,
    deliveryIntentId: 'intent-failed-terminal-reaction',
    response: '',
    responseDisposition: 'none',
    session: failedProviderSession,
    status: 'completed',
  })
  expect(mocks.finalizeAssistantTurnArtifacts).toHaveBeenCalledWith(
    expect.objectContaining({
      assistantTranscriptText: null,
      providerResult: expect.objectContaining({
        finalAction: {
          kind: 'none',
        },
        reactions: [
          {
            deliveryContextOrdinal: 0,
            reaction: 'heart',
            targetInputId: 'initial',
          },
        ],
      }),
    }),
  )
  expect(mocks.finalizeDeliveredAssistantTurn).toHaveBeenCalledWith({
    firstContactStateDocIds: expect.any(Array),
    outcome: reactionOutcome,
    response: '',
    turnId: 'turn-1',
    vault: '/vaults/test',
  })
  const replyTiming = traceEvents.find((event) =>
    isTraceEventWithRawType(event, 'assistant.turn.timing') &&
    (event as { rawEvent?: { turnTimingStage?: unknown } }).rawEvent
      ?.turnTimingStage === 'reply-dispatched',
  )
  expect(replyTiming).toBeDefined()
  expect((replyTiming as { rawEvent: Record<string, unknown> }).rawEvent)
    .toEqual(expect.objectContaining({
      deliveryAttempted: true,
      deliveryIntentPresent: true,
      deliveryOutcomeKind: 'queued',
      finalReplySelected: false,
      schema: 'murph.assistant-turn-timing.v1',
    }))
})

test('sendAssistantMessageLocal recovers reaction no-reply before draining later acknowledged steers', async () => {
  const terminalError = new Error('provider failed after steered reaction no-reply')
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
    sessionId: 'session-reaction-no-reply-before-later-steer',
  })
  const reactionOutcome: AssistantDeliveryOutcome = {
    error: null,
    intentId: 'intent-recovered-reaction-before-steer',
    kind: 'queued',
    media: [],
    session,
  }
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...createSharedPlan(),
      persistUserPromptOnFailure: false,
    },
    reactionOutcome,
    session,
  })
  const providerStarted = createDeferred<void>()
  const providerRelease = createDeferred<void>()
  const liveSteeredPrompts: string[] = []

  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    await providerInput.onProviderRequestPlanned?.({
      providerAttemptId: null,
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
    })
    const releaseLiveTurn = providerInput.activeTurnSteering?.registerLiveProviderTurn({
      interrupt: async () => undefined,
      codexThreadId: 'provider-thread-reaction-no-reply-before-later-steer',
      providerTurnId: 'provider-turn-reaction-no-reply-before-later-steer',
      sessionId: session.sessionId,
      steer: async (input) => {
        liveSteeredPrompts.push(input.prompt)
      },
      turnId: 'turn-1',
    })
    providerStarted.resolve()
    await providerRelease.promise
    await providerInput.onFinishWithoutReplyAccepted?.({
      deliveryContextOrdinal: 0,
      messageReactionPending: true,
    })
    await providerInput.onFinishWithoutReplyRecorded?.({
      deliveryContextOrdinal: 0,
    })
    releaseLiveTurn?.()
    return {
      acceptedNoReplyDeliveryContextOrdinals: [0],
      attemptCount: 1,
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
      codexThreadId: 'provider-thread-reaction-no-reply-before-later-steer',
      error: terminalError,
      kind: 'failed_terminal',
      providerRequestOutcome: 'failed',
      providerTurnId: 'provider-turn-reaction-no-reply-before-later-steer',
      rawEvents: [],
      reactions: [
        {
          deliveryContextOrdinal: 0,
          reaction: 'heart',
          targetInputId: 'initial',
        },
        {
          deliveryContextOrdinal: 1,
          reaction: 'thumbs_up',
          targetInputId: 'manual-1',
        },
      ],
      route: {
        provider: 'codex-cli',
        providerOptions: {
          model: 'gpt-5.4',
        },
      },
      session,
      usage: null,
      usageAttribution: null,
    }
  })

  const initialResultPromise = sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  })
  await providerStarted.promise

  const steeredResultPromise = sendAssistantMessageLocal({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
      directness: 'group',
    },
    expectedActiveTurnId: 'turn-1',
    prompt: 'Later follow up',
    vault: '/vaults/test',
  }).then(
    (result) => ({ kind: 'resolved' as const, result }),
    (error: unknown) => ({ kind: 'rejected' as const, error }),
  )
  await vi.waitFor(() => {
    expect(liveSteeredPrompts).toEqual(['Later follow up'])
  })
  providerRelease.resolve()

  const initialResult = await initialResultPromise
  const steeredResult = await steeredResultPromise

  assert.equal(initialResult.responseDisposition, 'none')
  assert.equal(initialResult.deliveryDeferred, true)
  assert.equal(
    initialResult.deliveryIntentId,
    'intent-recovered-reaction-before-steer',
  )
  assert.equal(steeredResult.kind, 'rejected')
  expect(mocks.deliverAssistantReaction).toHaveBeenCalledTimes(1)
  expect(mocks.deliverAssistantReaction).toHaveBeenCalledWith(
    expect.objectContaining({
      deliveryContextOrdinal: 0,
      reaction: 'heart',
      turnId: 'turn-1',
    }),
  )
  expect(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]?.providerResult
      .reactions,
  ).toEqual([
    {
      deliveryContextOrdinal: 0,
      reaction: 'heart',
      targetInputId: 'initial',
    },
  ])
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateProviderRequest.mock.calls
      .map((call) => call[0])
      .some((input) => input.acceptedInputIds?.includes('manual-1')),
  ).toBe(false)
})

test('sendAssistantMessageLocal does not wait for a pending typing indicator start', async () => {
  const typingIndicatorDeferred = createDeferred<{ stop(): Promise<void> }>()
  const stopTyping = vi.fn(async () => undefined)
  const { sendAssistantMessageLocal } = await loadLocalServiceModule({
    adapter: {
      startTypingIndicator: vi.fn(() => typingIndicatorDeferred.promise),
    },
  })

  const resultPromise = sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'Summarize my inbox',
    vault: '/vaults/test',
  })
  let resultResolved = false
  resultPromise.then(() => {
    resultResolved = true
  })
  await Promise.resolve()
  assert.equal(resultResolved, false)

  const result = await resultPromise
  assert.equal(result.status, 'completed')
  assert.equal(stopTyping.mock.calls.length, 0)

  typingIndicatorDeferred.resolve({
    stop: stopTyping,
  })
  await vi.waitFor(() => {
    expect(stopTyping).toHaveBeenCalledTimes(1)
  })
  expect(stopTyping).toHaveBeenCalledWith({
    providerStop: false,
  })
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
      media: [],
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
    media: [],
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
  assert.deepEqual(stopTyping.mock.calls[0], [{ providerStop: false }])
  assert.equal(mocks.refreshAssistantStatusSnapshotLocal.mock.calls.length, 0)
})

test('sendAssistantMessageLocal anchors hosted reply timing to the queued delivery intent', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-09T12:00:00.000Z'))
  const session = createAssistantSession({ sessionId: 'session-timed-reply' })
  const traceEvents: unknown[] = []
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    deliveryOutcome: {
      error: {
        code: 'ASSISTANT_DELIVERY_DEFERRED',
        message: 'queued for delivery',
        retryable: true,
      },
      intentId: 'intent-timed-reply',
      kind: 'queued',
      media: [],
      session,
    },
    session,
  })
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    await providerInput.onProviderRequestPlanned?.({
      codexContinuation: { kind: 'explicit-structured-history' },
      providerAttemptId: null,
    })
    await providerInput.onProviderRequestStarted?.({
      providerRequestOrdinal: 0,
      startedAt: '2026-07-09T12:00:00.000Z',
    })
    vi.setSystemTime(new Date('2026-07-09T12:00:01.200Z'))
    return {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        codexContinuation: { kind: 'explicit-structured-history' },
        response: 'timed response',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'timed response',
        session,
      },
    }
  })

  await sendAssistantMessageLocal({
    deliverResponse: true,
    executionContext: {
      hosted: {
        memberId: 'member-test',
        userEnvKeys: [],
      },
    },
    onTraceEvent(event) {
      traceEvents.push(event)
    },
    prompt: 'Queue a timed reply',
    vault: '/vaults/test',
  })

  const replyTiming = traceEvents.find((event) =>
    isTraceEventWithRawType(event, 'assistant.turn.timing') &&
    event.rawEvent.turnTimingStage === 'reply-dispatched',
  )
  expect(replyTiming).toBeDefined()
  expect((replyTiming as { rawEvent: Record<string, unknown> }).rawEvent)
    .toEqual(expect.objectContaining({
      deliveryIntentPresent: true,
      deliveryOutcomeKind: 'queued',
      finalReplySelected: true,
      providerRequestOrdinal: 0,
      turnTimingDeliveryIntentId: 'intent-timed-reply',
      turnTimingProviderRequestElapsedMs: 1_200,
      turnTimingSinceProviderResultMs: 0,
    }))
})

test('sendAssistantMessageLocal reports failed delivery outcomes after provider success', async () => {
  const failedSession = createAssistantSession({
    sessionId: 'session-failed-delivery',
  })
  const stopTyping = vi.fn(async () => undefined)
  const failedDeliveryOutcome = {
    error: {
      code: 'ASSISTANT_DELIVERY_FAILED',
      message: 'delivery failed after provider success',
      retryable: false,
    },
    intentId: 'intent-failed',
    kind: 'failed' as const,
    media: [],
    session: failedSession,
  }
  const { sendAssistantMessageLocal } = await loadLocalServiceModule({
    adapter: {
      startTypingIndicator: vi.fn(async () => ({
        stop: stopTyping,
      })),
    },
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
    media: [],
    prompt: 'Deliver this reply',
    response: 'assistant response',
    session: failedSession,
    status: 'completed',
    vault: '<redacted-vault>',
  })
  expect(stopTyping).toHaveBeenCalledWith({
    providerStop: true,
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
  assert.deepEqual(stopTyping.mock.calls[0], [{ providerStop: false }])
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
  assert.deepEqual(stopTyping.mock.calls[0], [{ providerStop: false }])
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

test('sendAssistantMessageLocal suppresses transcript and delivery for no-reply final actions', async () => {
  const session = createAssistantSession({
    sessionId: 'session-no-reply-final-action',
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        codexThreadId: 'provider-thread-no-reply',
        finalAction: {
          kind: 'none',
        },
        rawEvents: [],
        response: 'suppressed provider text',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: null,
        route: {
          routeId: 'route-no-reply',
        },
        session,
      },
    },
    session,
  })

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'ack',
    vault: '/vaults/test',
  })

  assert.equal(result.response, '')
  assert.equal(result.responseDisposition, 'none')
  assert.equal(result.delivery, null)
  assert.equal(result.deliveryDeferred, false)
  assert.equal(result.deliveryError, null)
  assert.equal(result.deliveryIntentId, null)
  assert.equal(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.assistantTranscriptText,
    null,
  )
  assert.equal(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.providerResumeStateAction,
    'persist-from-provider-turn',
  )
  expect(mocks.clearAssistantSessionCodexResumeState).not.toHaveBeenCalled()
  assert.equal(mocks.dispatchAssistantReply.mock.calls.length, 0)
  assert.deepEqual(
    mocks.finalizeDeliveredAssistantTurn.mock.calls[0]?.[0]?.outcome,
    {
      kind: 'not-requested',
      media: [],
      session,
    },
  )
})

test('sendAssistantMessageLocal traces hosted reaction-only no-reply delivery outcomes', async () => {
  const session = createAssistantSession({
    sessionId: 'session-no-reply-final-reaction',
  })
  const traceEvents: unknown[] = []
  const reactionOutcome: AssistantDeliveryOutcome = {
    error: null,
    intentId: 'intent-no-reply-reaction',
    kind: 'queued',
    media: [],
    session,
  }
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        codexThreadId: 'provider-thread-no-reply-reaction',
        finalAction: {
          kind: 'none',
        },
        rawEvents: [],
        reactions: [
          {
            deliveryContextOrdinal: 0,
            reaction: 'heart',
            targetInputId: 'initial',
          },
        ],
        response: 'suppressed provider text',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: null,
        route: {
          routeId: 'route-no-reply-reaction',
        },
        session,
      },
    },
    reactionOutcome,
    session,
  })

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    executionContext: {
      hosted: {
        memberId: 'member-123',
        userEnvKeys: [],
      },
    },
    onTraceEvent(event) {
      traceEvents.push(event)
    },
    prompt: 'react only',
    vault: '/vaults/test',
  })

  expect(mocks.dispatchAssistantReply).not.toHaveBeenCalled()
  expect(mocks.deliverAssistantReaction).toHaveBeenCalledWith(
    expect.objectContaining({
      deliveryContextOrdinal: 0,
      reaction: 'heart',
      turnId: 'turn-1',
    }),
  )
  expect(result).toMatchObject({
    delivery: null,
    deliveryDeferred: true,
    deliveryIntentId: 'intent-no-reply-reaction',
    response: '',
    responseDisposition: 'none',
  })
  const replyTiming = traceEvents.find((event) =>
    isTraceEventWithRawType(event, 'assistant.turn.timing') &&
    (event as { rawEvent?: { turnTimingStage?: unknown } }).rawEvent
      ?.turnTimingStage === 'reply-dispatched',
  )
  expect(replyTiming).toBeDefined()
  expect((replyTiming as { rawEvent: Record<string, unknown> }).rawEvent)
    .toEqual(expect.objectContaining({
      deliveryAttempted: true,
      deliveryIntentPresent: true,
      deliveryOutcomeKind: 'queued',
      finalReplySelected: false,
      schema: 'murph.assistant-turn-timing.v1',
    }))
})

test('sendAssistantMessageLocal durably records accepted no-reply markers before visible finalization', async () => {
  const session = createAssistantSession({
    sessionId: 'session-no-reply-before-visible-final',
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...createSharedPlan(),
      persistUserPromptOnFailure: false,
    },
    session,
  })

  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    await providerInput.onFinishWithoutReplyAccepted?.({
      deliveryContextOrdinal: 0,
      messageReactionPending: false,
    })
    await providerInput.onFinishWithoutReplyRecorded?.({
      deliveryContextOrdinal: 0,
    })
    return {
      kind: 'succeeded',
      providerTurn: {
        acceptedNoReplyDeliveryContextOrdinals: [0],
        onboardingGuidanceInjected: false,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        codexThreadId: 'provider-thread-no-reply-before-visible-final',
        rawEvents: [],
        response: 'Visible answer.',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'Visible answer.',
        route: {
          routeId: 'route-no-reply-before-visible-final',
        },
        session,
      },
    }
  })

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'reply',
    vault: '/vaults/test',
  })

  assert.equal(result.response, 'Visible answer.')
  expect(mocks.persistAssistantNoReplyTranscriptMarkers).toHaveBeenCalledWith({
    deliveryContextOrdinals: [0],
    sessionId: session.sessionId,
    turnCreatedAt: expect.any(String),
    turnId: 'turn-1',
    vault: '/vaults/test',
  })
  expect(mocks.appendAssistantTranscriptEntries.mock.calls[0]?.[2])
    .toEqual([
      expect.objectContaining({
        kind: 'user',
        text: 'reply',
      }),
    ])
  expect(
    mocks.appendAssistantTranscriptEntries.mock.invocationCallOrder[0],
  ).toBeLessThan(
    mocks.persistAssistantNoReplyTranscriptMarkers.mock.invocationCallOrder[0],
  )
  expect(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]?.providerResult
      .acceptedNoReplyDeliveryContextOrdinals,
  ).toEqual([0])
  assert.equal(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.persistUserPromptToTranscript,
    false,
  )
  assert.equal(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.assistantTranscriptText,
    'Visible answer.',
  )
})

test('sendAssistantMessageLocal writes no-reply markers after caller retry fences', async () => {
  const session = createAssistantSession({
    sessionId: 'session-no-reply-hook-before-marker',
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...createSharedPlan(),
      persistUserPromptOnFailure: false,
    },
    session,
  })
  const onFinishWithoutReplyAccepted = vi.fn(async () => {
    throw new Error('suppression evidence failed before marker')
  })
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    await providerInput.onFinishWithoutReplyAccepted?.({
      deliveryContextOrdinal: 0,
      messageReactionPending: false,
    })
    throw new Error('unreachable after no-reply callback failure')
  })

  await assert.rejects(
    () =>
      sendAssistantMessageLocal({
        deliverResponse: true,
        onFinishWithoutReplyAccepted,
        prompt: 'reply',
        vault: '/vaults/test',
      }),
    /suppression evidence failed before marker/u,
  )

  expect(mocks.clearAssistantSessionCodexResumeState).not.toHaveBeenCalled()
  expect(onFinishWithoutReplyAccepted).toHaveBeenCalledTimes(1)
  expect(mocks.persistAssistantNoReplyTranscriptMarkers).not.toHaveBeenCalled()
})

test('sendAssistantMessageLocal completes no-reply if marker persistence fails after acceptance', async () => {
  const codexThreadId = '00000000-0000-4000-8000-000000000620'
  const codexRolloutRelativePath =
    `sessions/2026/07/14/rollout-2026-07-14T01-02-03-${codexThreadId}.jsonl`
  const assistantContractFingerprint = 'a'.repeat(64)
  const session = createAssistantSession({
    sessionId: 'session-no-reply-marker-final-write',
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...createSharedPlan(),
      persistUserPromptOnFailure: false,
    },
    session,
  })
  const markerFailure = new Error('marker write failed after retry fence')
  const onFinishWithoutReplyAccepted = vi.fn()
  mocks.persistAssistantNoReplyTranscriptMarkers.mockRejectedValueOnce(markerFailure)
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    let terminalError: unknown = null
    try {
      await providerInput.onFinishWithoutReplyAccepted?.({
        deliveryContextOrdinal: 0,
        messageReactionPending: false,
      })
      await providerInput.onFinishWithoutReplyRecorded?.({
        deliveryContextOrdinal: 0,
      })
    } catch (error) {
      terminalError = error
    }
    return {
      acceptedNoReplyDeliveryContextOrdinals: [0],
      assistantContractFingerprint,
      attemptCount: 1,
      codexContinuation: {
        kind: 'thread-start',
      },
      codexRolloutRelativePath,
      codexThreadId,
      error: terminalError instanceof Error
        ? terminalError
        : new Error('missing marker failure'),
      kind: 'failed_terminal',
      providerRequestOutcome: 'failed',
      providerTurnId: 'provider-turn-no-reply-marker-final-write',
      rawEvents: [],
      route: {
        provider: 'codex-cli',
        providerOptions: {
          model: 'gpt-5.4',
        },
      },
      session,
      usage: null,
      usageAttribution: null,
    }
  })

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    onFinishWithoutReplyAccepted,
    prompt: 'reply',
    vault: '/vaults/test',
  })

  assert.equal(result.responseDisposition, 'none')
  expect(mocks.clearAssistantSessionCodexResumeState).not.toHaveBeenCalled()
  expect(onFinishWithoutReplyAccepted).toHaveBeenCalledTimes(1)
  expect(mocks.persistAssistantNoReplyTranscriptMarkers).toHaveBeenCalledWith({
    deliveryContextOrdinals: [0],
    sessionId: session.sessionId,
    turnCreatedAt: expect.any(String),
    turnId: 'turn-1',
    vault: '/vaults/test',
  })
  expect(
    onFinishWithoutReplyAccepted.mock.invocationCallOrder[0],
  ).toBeLessThan(
    mocks.persistAssistantNoReplyTranscriptMarkers.mock.invocationCallOrder[0],
  )
  expect(mocks.finalizeAssistantTurnArtifacts).toHaveBeenCalledWith(
    expect.objectContaining({
      assistantTranscriptText: null,
      providerResult: expect.objectContaining({
        acceptedNoReplyDeliveryContextOrdinals: [0],
        assistantContractFingerprint,
        codexContinuation: {
          kind: 'thread-start',
        },
        codexRolloutRelativePath,
        codexThreadId,
        finalAction: {
          kind: 'none',
        },
      }),
      turnId: 'turn-1',
    }),
  )
  expect(mocks.normalizeAssistantDeliveryError).not.toHaveBeenCalled()
})

test('sendAssistantMessageLocal persists live-steered input before its no-reply marker', async () => {
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
    sessionId: 'session-live-steered-no-reply',
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...createSharedPlan(),
      persistUserPromptOnFailure: false,
    },
    session,
  })
  const providerStarted = createDeferred<void>()
  const providerRelease = createDeferred<void>()
  const liveSteeredPrompts: string[] = []
  const finishWithoutReplyAcceptedEvents: Array<{
    acceptedInputIds: readonly string[]
    deliveryContextOrdinal: number
  }> = []
  const onFinishWithoutReplyAccepted = vi.fn((event: {
    acceptedInputIds: readonly string[]
    deliveryContextOrdinal: number
  }) => {
    finishWithoutReplyAcceptedEvents.push({
      acceptedInputIds: [...event.acceptedInputIds],
      deliveryContextOrdinal: event.deliveryContextOrdinal,
    })
  })

  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    await providerInput.onProviderRequestPlanned?.({
      providerAttemptId: null,
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
    })
    const releaseLiveTurn = providerInput.activeTurnSteering?.registerLiveProviderTurn({
      interrupt: async () => undefined,
      codexThreadId: 'provider-thread-live-steered-no-reply',
      providerTurnId: 'provider-turn-live-steered-no-reply',
      sessionId: session.sessionId,
      steer: async (input) => {
        liveSteeredPrompts.push(input.prompt)
      },
      turnId: 'turn-1',
    })
    providerStarted.resolve()
    await providerRelease.promise
    await providerInput.onFinishWithoutReplyAccepted?.({
      deliveryContextOrdinal: 1,
      messageReactionPending: false,
    })
    await providerInput.onFinishWithoutReplyRecorded?.({
      deliveryContextOrdinal: 1,
    })
    releaseLiveTurn?.()
    return {
      kind: 'succeeded',
      providerTurn: {
        acceptedNoReplyDeliveryContextOrdinals: [1],
        onboardingGuidanceInjected: false,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        codexThreadId: 'provider-thread-live-steered-no-reply',
        finalAction: {
          kind: 'none',
        },
        rawEvents: [],
        response: 'suppressed text',
        responseDeliveryContextOrdinal: 1,
        transcriptResponse: null,
        route: {
          routeId: 'route-live-steered-no-reply',
        },
        session,
      },
    }
  })

  const initialResultPromise = sendAssistantMessageLocal({
    deliverResponse: true,
    onFinishWithoutReplyAccepted,
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  })
  await providerStarted.promise

  const steeredResultPromise = sendAssistantMessageLocal({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
      directness: 'group',
    },
    expectedActiveTurnId: 'turn-1',
    prompt: 'Live no-reply follow up',
    vault: '/vaults/test',
  })
  await vi.waitFor(() => {
    expect(liveSteeredPrompts).toEqual(['Live no-reply follow up'])
  })
  providerRelease.resolve()

  const [initialResult, steeredResult] = await Promise.all([
    initialResultPromise,
    steeredResultPromise,
  ])

  assert.equal(initialResult.responseDisposition, 'none')
  assert.equal(steeredResult.responseDisposition, 'none')
  expect(finishWithoutReplyAcceptedEvents).toEqual([
    {
      acceptedInputIds: ['initial', 'manual-1'],
      deliveryContextOrdinal: 1,
    },
  ])
  expect(mocks.persistAssistantNoReplyTranscriptMarkers).toHaveBeenCalledWith({
    deliveryContextOrdinals: [1],
    sessionId: session.sessionId,
    turnCreatedAt: expect.any(String),
    turnId: 'turn-1',
    vault: '/vaults/test',
  })
  const steeredTranscriptCallIndex =
    mocks.appendAssistantTranscriptEntries.mock.calls.findIndex((call) =>
      call[2]?.some((entry) =>
        entry.kind === 'user' &&
        entry.text === 'Live no-reply follow up'
      )
    )
  expect(steeredTranscriptCallIndex).toBeGreaterThanOrEqual(0)
  expect(
    mocks.appendAssistantTranscriptEntries.mock.invocationCallOrder[
      steeredTranscriptCallIndex
    ],
  ).toBeLessThan(
    mocks.persistAssistantNoReplyTranscriptMarkers.mock.invocationCallOrder[0],
  )
  expect(
    onFinishWithoutReplyAccepted.mock.invocationCallOrder[0],
  ).toBeLessThan(
    mocks.persistAssistantNoReplyTranscriptMarkers.mock.invocationCallOrder[0],
  )
  expect(mocks.clearAssistantSessionCodexResumeState).not.toHaveBeenCalled()
})

test('sendAssistantMessageLocal completes terminal provider failures after live-steered no-reply', async () => {
  const terminalError = new Error('provider failed after steered no-reply')
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
    sessionId: 'session-live-steered-no-reply-failure',
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...createSharedPlan(),
      persistUserPromptOnFailure: false,
    },
    session,
  })
  const providerStarted = createDeferred<void>()
  const providerRelease = createDeferred<void>()
  const liveSteeredPrompts: string[] = []

  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    await providerInput.onProviderRequestPlanned?.({
      providerAttemptId: null,
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
    })
    const releaseLiveTurn = providerInput.activeTurnSteering?.registerLiveProviderTurn({
      interrupt: async () => undefined,
      codexThreadId: 'provider-thread-live-steered-no-reply-failure',
      providerTurnId: 'provider-turn-live-steered-no-reply-failure',
      sessionId: session.sessionId,
      steer: async (input) => {
        liveSteeredPrompts.push(input.prompt)
      },
      turnId: 'turn-1',
    })
    providerStarted.resolve()
    await providerRelease.promise
    await providerInput.onFinishWithoutReplyAccepted?.({
      deliveryContextOrdinal: 1,
      messageReactionPending: false,
    })
    await providerInput.onFinishWithoutReplyRecorded?.({
      deliveryContextOrdinal: 1,
    })
    releaseLiveTurn?.()
    return {
      acceptedNoReplyDeliveryContextOrdinals: [1],
      attemptCount: 1,
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
      codexThreadId: 'provider-thread-live-steered-no-reply-failure',
      error: terminalError,
      kind: 'failed_terminal',
      providerRequestOutcome: 'failed',
      providerTurnId: 'provider-turn-live-steered-no-reply-failure',
      rawEvents: [],
      route: {
        provider: 'codex-cli',
        providerOptions: {
          model: 'gpt-5.4',
        },
      },
      session,
      usage: null,
      usageAttribution: null,
    }
  })

  const initialResultPromise = sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  })
  await providerStarted.promise

  const steeredResultPromise = sendAssistantMessageLocal({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
      directness: 'group',
    },
    expectedActiveTurnId: 'turn-1',
    prompt: 'Live no-reply follow up',
    vault: '/vaults/test',
  })
  await vi.waitFor(() => {
    expect(liveSteeredPrompts).toEqual(['Live no-reply follow up'])
  })
  providerRelease.resolve()

  const [initialResult, steeredResult] = await Promise.all([
    initialResultPromise,
    steeredResultPromise,
  ])

  assert.equal(initialResult.responseDisposition, 'none')
  assert.equal(steeredResult.responseDisposition, 'none')
  expect(mocks.persistAssistantNoReplyTranscriptMarkers).toHaveBeenCalledWith({
    deliveryContextOrdinals: [1],
    sessionId: session.sessionId,
    turnCreatedAt: expect.any(String),
    turnId: 'turn-1',
    vault: '/vaults/test',
  })
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateAdmissionState,
  ).toHaveBeenCalledWith({
    admissionState: 'commit-started',
    turnId: 'turn-1',
  })
  expect(mocks.finalizeAssistantTurnArtifacts).toHaveBeenCalledWith(
    expect.objectContaining({
      assistantTranscriptText: null,
      persistUserPromptToTranscript: false,
      providerResumeStateAction: 'persist-from-provider-turn',
      providerResult: expect.objectContaining({
        acceptedNoReplyDeliveryContextOrdinals: [1],
        finalAction: {
          kind: 'none',
        },
        response: '',
      }),
      session,
      turnId: 'turn-1',
    }),
  )
  expect(mocks.normalizeAssistantDeliveryError).not.toHaveBeenCalled()
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
