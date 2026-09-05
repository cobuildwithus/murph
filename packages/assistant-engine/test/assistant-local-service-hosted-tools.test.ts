import assert from 'node:assert/strict'

import { expect, test, vi } from 'vitest'

import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import {
  type AssistantActiveTurnInputAdmissionHook,
  type AssistantActiveTurnInputCheckpointInput,
} from '../src/assistant/turn-input.js'
import { upsertAssistantInputEvent } from '../src/assistant/input-store.ts'
import { assistantInputCandidateFromStoredEvent } from '../src/assistant/input-source.ts'
import { createTempVaultContext } from './test-helpers.ts'

import {
  createAssistantSession,
  createDeferred,
  createHostedMailboxSourceRef,
  createSharedPlan,
  loadLocalServiceModule,
  tempRoots,
} from './assistant-local-service-runtime.harness.ts'

test('sendAssistantMessageLocal probes active-turn input once before provider start', async () => {
  let admissionOrdinal = 0
  const activeTurnInput = vi.fn<AssistantActiveTurnInputAdmissionHook>(async () => {
    admissionOrdinal += 1
    return {
      acceptedInputs: [
        {
          id: `hook-${admissionOrdinal}`,
          promptFallbackReason: 'manual-input',
          promptFallbackText: `Pre-provider hook input ${admissionOrdinal}`,
          source: 'manual',
        },
      ],
      kind: 'accepted' as const,
      prompt: `Pre-provider hook input ${admissionOrdinal}`,
      transcriptText: `Pre-provider hook transcript ${admissionOrdinal}`,
      userMessageContent: [
        {
          text: `Pre-provider hook input ${admissionOrdinal}`,
          type: 'text' as const,
        },
      ],
    }
  })
  const activeTurnCheckpoint = vi.fn(
    async (_input: AssistantActiveTurnInputCheckpointInput) => undefined,
  )
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...createSharedPlan(),
      persistUserPromptOnFailure: false,
    },
  })

  const result = await sendAssistantMessageLocal({
    activeTurnCheckpoint,
    activeTurnInput,
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  })

  assert.equal(result.response, 'assistant response')
  assert.equal(activeTurnInput.mock.calls.length, 1)
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 1)
  assert.equal(
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.input.prompt,
    'Pre-provider hook input 1',
  )
  expect(activeTurnCheckpoint).toHaveBeenCalledWith({
    acceptedInputIds: ['initial', 'hook-1'],
    providerRequestOrdinal: 0,
    sessionId: 'session-test',
    signal: undefined,
    turnId: 'turn-1',
    vault: '/vaults/test',
  })
  expect(
    mocks.runtimeState.turns.acceptedInputs.append.mock.calls[1]?.[0]?.inputs,
  ).toEqual([
    expect.objectContaining({
      id: 'hook-1',
      source: 'manual',
    }),
  ])
})

test('sendAssistantMessageLocal keeps every group prompt accepted before provider start', async () => {
  const initialImage = Buffer.from('synthetic-image-input')
  const session = createAssistantSession({
    binding: {
      actorId: null,
      channel: 'telegram',
      conversationKey: 'channel:telegram|identity:identity-1|thread:thread-1',
      delivery: { kind: 'thread', target: 'thread-1' },
      identityId: 'identity-1',
      threadId: 'thread-1',
      threadIsDirect: false,
    },
  })
  const sharedPlan = createSharedPlan()
  sharedPlan.conversationPolicy.audience.channel = 'telegram'
  sharedPlan.conversationPolicy.audience.threadIsDirect = false
  let admissionCount = 0
  const activeTurnInput = vi.fn<AssistantActiveTurnInputAdmissionHook>(
    async () => {
      admissionCount += 1
      if (admissionCount > 1) {
        return { kind: 'no-new-input' }
      }
      return {
        acceptedInputs: [
          {
            id: 'hook-1',
            promptFallbackReason: 'manual-input',
            promptFallbackText: 'Also share the walking time.',
            source: 'manual',
          },
        ],
        kind: 'accepted' as const,
        prompt: 'Also share the walking time.',
        transcriptText: 'Also share the walking time.',
        userMessageContent: [
          {
            text: 'Also share the walking time.',
            type: 'text' as const,
          },
        ],
      }
    },
  )
  const firstDraftReady = createDeferred<void>()
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: { ...sharedPlan, persistUserPromptOnFailure: false },
    session,
  })
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(
    async (providerInput) => {
      providerInput.activeTurnSteering?.onFirstAssistantResponseCompleted()
      firstDraftReady.resolve()
      return {
        kind: 'succeeded',
        providerTurn: {
          onboardingGuidanceInjected: true,
          codexContinuation: { kind: 'explicit-structured-history' },
          codexThreadId: 'provider-thread-group-pre-provider',
          response: 'The venue opens at nine, and the walk takes ten minutes.',
          responseDeliveryContextOrdinal: 0,
          route: { routeId: 'route-group-pre-provider' },
          session,
          transcriptResponse:
            'The venue opens at nine, and the walk takes ten minutes.',
        },
      }
    },
  )

  vi.useFakeTimers()
  const resultPromise = sendAssistantMessageLocal({
    activeTurnInput,
    conversation: {
      channel: 'telegram',
      directness: 'group',
      identityId: 'identity-1',
      threadId: 'thread-1',
    },
    deliverResponse: true,
    prompt: 'What time does the venue open?',
    turnTrigger: 'automation-auto-reply',
    userMessageContent: [
      {
        image: initialImage,
        mediaType: 'image/png',
        type: 'image',
      },
      {
        text: 'What time does the venue open?',
        type: 'text',
      },
    ],
    vault: '/vaults/test',
  })
  await firstDraftReady.promise

  expect(
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.input.prompt,
  ).toBe(
    'What time does the venue open?\n\nAlso share the walking time.',
  )
  expect(
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.input
      .userMessageContent,
  ).toEqual([
    {
      image: initialImage,
      mediaType: 'image/png',
      type: 'image',
    },
    {
      text: 'What time does the venue open?',
      type: 'text',
    },
    {
      text: 'Also share the walking time.',
      type: 'text',
    },
  ])
  await vi.advanceTimersByTimeAsync(4_000)
  await expect(resultPromise).resolves.toMatchObject({
    response: 'The venue opens at nine, and the walk takes ten minutes.',
  })
  expect(mocks.executeCodexTurnWithRecovery).toHaveBeenCalledOnce()
  expect(mocks.dispatchAssistantReply).toHaveBeenCalledOnce()
})

test('sendAssistantMessageLocal exposes hosted current-input authority to dynamic tools', async () => {
  const assistantInputId = 'ain_44444444444444444444444444444444'
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule()

  await sendAssistantMessageLocal({
    executionContext: {
      hosted: {
        currentAssistantInputId: () => assistantInputId,
        memberId: 'member-hosted',
        userEnvKeys: [],
      },
    },
    prompt: 'Use the current hosted input authority.',
    vault: '/vaults/test',
  })

  const hostedToolContext =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.hostedToolContext
  assert.ok(hostedToolContext)
  assert.equal(
    hostedToolContext.currentAssistantInputId?.(),
    assistantInputId,
  )
})

// Hosted-runner turns always run queue-only (the outbox owns final-reply
// delivery), including interactive auto-replies where a member is actively
// waiting. Progress delivery stays wired there for explicit model progress and
// required system notices; native provider commentary remains internal.
test('sendAssistantMessageLocal keeps hosted progress wired in queue-only auto-replies', async () => {
  const context = await createTempVaultContext(
    'assistant-local-service-hosted-auto-reply-progress-',
  )
  tempRoots.push(context.parentRoot)
  const activeTurnInput = vi.fn<AssistantActiveTurnInputAdmissionHook>(async () => ({
    kind: 'no-new-input' as const,
  }))
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

  const result = await sendAssistantMessageLocal({
    activeTurnInput,
    deliverResponse: true,
    deliveryDispatchMode: 'queue-only',
    executionContext: {
      hosted: {
        memberId: 'member-hosted',
        progressDeliveryDependencies,
        providerFetch: vi.fn<typeof fetch>(),
        userEnvKeys: [],
      },
    },
    prompt: 'Hosted queue-only auto-reply',
    turnTrigger: 'automation-auto-reply',
    vault: context.vaultRoot,
  })

  assert.equal(result.response, 'assistant response')
  assert.equal(activeTurnInput.mock.calls.length, 2)
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 1)
  const progressDelivery =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.progressDelivery
  const hostedToolContext =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.hostedToolContext
  assert.ok(progressDelivery, 'queue-only auto-reply turns keep progress delivery wired')
  assert.ok(hostedToolContext)
  assert.equal(hostedToolContext.computerToolsAvailable, true)
  assert.equal(mocks.dispatchAssistantReply.mock.calls.length, 1)
})

test('sendAssistantMessageLocal routes hosted Linq model progress through progress delivery dependencies', async () => {
  const refreshTypingAfterMessage = vi.fn(async () => undefined)
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
  const releaseProviderTurn = createDeferred<void>()
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    adapter: {
      startTypingIndicator: vi.fn(async () => ({
        refreshAfterMessage: refreshTypingAfterMessage,
        stop: vi.fn(async () => undefined),
      })),
    },
    plan: {
      ...sharedPlan,
      persistUserPromptOnFailure: false,
    },
  })
  mocks.deliverAssistantProgressUpdate.mockImplementationOnce(
    async (progressInput) => {
      await progressInput.dependencies?.sendLinq?.({
        message: progressInput.text,
        target: 'thread-progress',
        targetKind: 'thread',
      })
      return progressInput.session
    },
  )
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    await providerInput.onProviderRequestPlanned?.({
      providerAttemptId: null,
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
    })
    await releaseProviderTurn.promise
    return {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        codexThreadId: 'provider-thread-progress',
        response: 'assistant response',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'assistant response',
        route: {
          routeId: 'route-default',
        },
        session: createAssistantSession(),
      },
    }
  })

  const resultPromise = sendAssistantMessageLocal({
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
    prompt: 'Hosted queue-only manual reply',
    turnTrigger: 'manual-ask',
    vault: '/vaults/test',
  })
  await vi.waitFor(() => {
    expect(mocks.executeCodexTurnWithRecovery).toHaveBeenCalledTimes(1)
  })

  const progressDelivery =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.progressDelivery
  const hostedToolContext =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.hostedToolContext
  assert.ok(progressDelivery)
  assert.ok(hostedToolContext)
  assert.equal(hostedToolContext.computerToolsAvailable, false)
  assert.equal(hostedToolContext.pendingVaultFilesAvailable, true)
  assert.equal(hostedToolContext.vaultFileSendAvailable, false)
  await progressDelivery.send('Checking the iMessage thread.')

  assert.equal(mocks.deliverAssistantProgressUpdate.mock.calls.length, 1)
  expect(progressDeliveryDependencies.sendLinq).toHaveBeenCalledWith(
    expect.objectContaining({
      acceptedAssistantInputIds: ['initial'],
      message: 'Checking the iMessage thread.',
    }),
  )
  assert.equal(
    mocks.deliverAssistantProgressUpdate.mock.calls[0]?.[0]?.text,
    'Checking the iMessage thread.',
  )
  await vi.waitFor(() => {
    expect(refreshTypingAfterMessage).toHaveBeenCalledTimes(1)
  })

  releaseProviderTurn.resolve()
  await resultPromise
})

test('sendAssistantMessageLocal uses progress-materialized sessions for final replies', async () => {
  const baseSession = createAssistantSession({
    binding: {
      actorId: 'actor-progress',
      channel: 'linq',
      conversationKey: null,
      delivery: {
        kind: 'participant',
        target: 'participant-progress',
      },
      identityId: 'identity-progress',
      threadId: null,
      threadIsDirect: null,
    },
  })
  const materializedSession: AssistantSession = {
    ...baseSession,
    binding: {
      ...baseSession.binding,
      delivery: {
        kind: 'thread',
        target: 'thread-progress-materialized',
      },
      threadId: 'thread-progress-materialized',
      threadIsDirect: true,
    },
    updatedAt: '2026-04-08T12:00:03.000Z',
  }
  const providerSession: AssistantSession = {
    ...baseSession,
    turnCount: 7,
    updatedAt: '2026-04-08T12:00:04.000Z',
  }
  const progressDeliveryDependencies = {
    sendLinq: vi.fn(async () => ({
      providerMessageId: 'progress-message',
      providerThreadId: 'thread-progress-materialized',
      target: 'thread-progress-materialized',
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
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        codexThreadId: 'provider-thread-default',
        response: 'assistant response',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'assistant response',
        route: {
          routeId: 'route-default',
        },
        session: providerSession,
      },
    }
  })

  await sendAssistantMessageLocal({
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
    prompt: 'Hosted immediate manual reply',
    turnTrigger: 'manual-ask',
    vault: '/vaults/test',
  })

  expect(mocks.deliverAssistantProgressUpdate).toHaveBeenCalledTimes(1)
  expect(mocks.dispatchAssistantReply).toHaveBeenCalledTimes(1)
  const finalSession = mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.session
  expect(finalSession?.binding.delivery).toEqual({
    kind: 'thread',
    target: 'thread-progress-materialized',
  })
  expect(finalSession?.binding.threadId).toBe('thread-progress-materialized')
  expect(finalSession?.binding.threadIsDirect).toBe(true)
  expect(finalSession?.turnCount).toBe(7)
})

test('sendAssistantMessageLocal keeps progress-materialized sessions for no-reply terminal failures', async () => {
  const terminalError = new Error('provider failed after no-reply progress')
  const baseSession = createAssistantSession({
    binding: {
      actorId: 'actor-progress-no-reply',
      channel: 'linq',
      conversationKey: null,
      delivery: {
        kind: 'participant',
        target: 'participant-progress-no-reply',
      },
      identityId: 'identity-progress-no-reply',
      threadId: null,
      threadIsDirect: null,
    },
    sessionId: 'session-progress-no-reply',
  })
  const materializedSession: AssistantSession = {
    ...baseSession,
    binding: {
      ...baseSession.binding,
      delivery: {
        kind: 'thread',
        target: 'thread-progress-no-reply',
      },
      threadId: 'thread-progress-no-reply',
      threadIsDirect: true,
    },
    updatedAt: '2026-04-08T12:00:03.000Z',
  }
  const providerSession: AssistantSession = {
    ...baseSession,
    turnCount: 4,
    updatedAt: '2026-04-08T12:00:04.000Z',
  }
  const progressDeliveryDependencies = {
    sendLinq: vi.fn(async () => ({
      providerMessageId: 'progress-message',
      providerThreadId: 'thread-progress-no-reply',
      target: 'thread-progress-no-reply',
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
      acceptedNoReplyDeliveryContextOrdinals: [0],
      attemptCount: 1,
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
      codexThreadId: 'provider-thread-progress-no-reply',
      error: terminalError,
      kind: 'failed_terminal',
      providerRequestOutcome: 'failed',
      providerTurnId: 'provider-turn-progress-no-reply',
      rawEvents: [],
      route: {
        provider: 'codex-cli',
        providerOptions: {
          model: 'gpt-5.4',
        },
      },
      session: providerSession,
      usage: null,
      usageAttribution: null,
    }
  })

  const result = await sendAssistantMessageLocal({
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
    prompt: 'Hosted no-reply manual task',
    turnTrigger: 'manual-ask',
    vault: '/vaults/test',
  })

  expect(result.status).toBe('completed')
  const finalizedSession =
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]?.session
  expect(finalizedSession?.binding.delivery).toEqual({
    kind: 'thread',
    target: 'thread-progress-no-reply',
  })
  expect(finalizedSession?.binding.threadId).toBe('thread-progress-no-reply')
  expect(finalizedSession?.binding.threadIsDirect).toBe(true)
  expect(finalizedSession?.turnCount).toBe(4)
  expect(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]?.providerResult.session
      .binding.delivery,
  ).toEqual({
    kind: 'thread',
    target: 'thread-progress-no-reply',
  })
})

test('sendAssistantMessageLocal requires hosted Linq text delivery for model progress', async () => {
  const progressDeliveryDependencies = {
    sendLinqVoiceMemo: vi.fn(async () => ({
      providerMessageId: 'progress-voice-memo',
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
    deliveryDispatchMode: 'immediate',
    executionContext: {
      hosted: {
        memberId: 'member-hosted',
        progressDeliveryDependencies,
        providerFetch: vi.fn<typeof fetch>(),
        userEnvKeys: [],
      },
    },
    prompt: 'Hosted queue-only Linq manual reply',
    turnTrigger: 'manual-ask',
    vault: '/vaults/test',
  })

  const progressDelivery =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.progressDelivery
  const hostedToolContext =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.hostedToolContext
  assert.equal(progressDelivery, null)
  assert.ok(hostedToolContext)
  assert.equal(hostedToolContext.computerToolsAvailable, false)
  assert.equal(mocks.deliverAssistantProgressUpdate.mock.calls.length, 0)
  assert.equal(progressDeliveryDependencies.sendLinqVoiceMemo.mock.calls.length, 0)
})

test.each([
  { approvalAvailable: true, threadIsDirect: true },
  { approvalAvailable: false, threadIsDirect: true },
  { approvalAvailable: true, threadIsDirect: false },
  { approvalAvailable: true, threadIsDirect: null },
])('sendAssistantMessageLocal gates Telegram file tools on approval $approvalAvailable and private audience $threadIsDirect', async ({ approvalAvailable, threadIsDirect }) => {
  const progressDeliveryDependencies = {
    sendTelegram: vi.fn(async () => ({
      providerMessageId: 'progress-message',
      providerThreadId: 'telegram-thread',
      target: 'telegram-thread',
      targetKind: 'thread' as const,
    })),
  }
  const sharedPlan = createSharedPlan()
  sharedPlan.conversationPolicy.audience.channel = 'telegram'
  sharedPlan.conversationPolicy.audience.threadIsDirect = threadIsDirect
  sharedPlan.conversationPolicy.audience.effectiveThreadIsDirect = threadIsDirect === true
  const session = createAssistantSession()
  session.binding.threadIsDirect = threadIsDirect
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    session,
    plan: {
      ...sharedPlan,
      persistUserPromptOnFailure: false,
    },
  })

  await sendAssistantMessageLocal({
    channel: 'telegram',
    deliverResponse: true,
    deliveryDispatchMode: 'immediate',
    executionContext: {
      hosted: {
        memberId: 'member-hosted',
        ...(approvalAvailable ? { actionApprovalPort: { read: vi.fn(), request: vi.fn() } } : {}),
        progressDeliveryDependencies,
        providerFetch: vi.fn<typeof fetch>(),
        userEnvKeys: [],
      },
    },
    prompt: 'Hosted queue-only Telegram manual reply',
    turnTrigger: 'manual-ask',
    vault: '/vaults/test',
  })

  const progressDelivery =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.progressDelivery
  const hostedToolContext =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.hostedToolContext
  assert.ok(progressDelivery)
  assert.ok(hostedToolContext)
  assert.equal(hostedToolContext.computerToolsAvailable, true)
  assert.equal(hostedToolContext.vaultFileSendAvailable, approvalAvailable && threadIsDirect === true)
  await progressDelivery.send('Checking the Telegram thread.')

  assert.equal(mocks.deliverAssistantProgressUpdate.mock.calls.length, 1)
  assert.equal(
    mocks.deliverAssistantProgressUpdate.mock.calls[0]?.[0]?.dependencies,
    progressDeliveryDependencies,
  )
  assert.equal(
    mocks.deliverAssistantProgressUpdate.mock.calls[0]?.[0]?.text,
    'Checking the Telegram thread.',
  )
})

test('sendAssistantMessageLocal does not expose hosted progress or computer delivery for unsupported channels', async () => {
  const progressDeliveryDependencies = {
    sendTelegram: vi.fn(async () => ({
      providerMessageId: 'progress-message',
      providerThreadId: 'telegram-thread',
      target: 'telegram-thread',
      targetKind: 'thread' as const,
    })),
  }
  const sharedPlan = createSharedPlan()
  sharedPlan.conversationPolicy.audience.channel = 'signal'
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...sharedPlan,
      persistUserPromptOnFailure: false,
    },
  })

  await sendAssistantMessageLocal({
    channel: 'signal',
    deliverResponse: true,
    deliveryDispatchMode: 'queue-only',
    executionContext: {
      hosted: {
        memberId: 'member-hosted',
        progressDeliveryDependencies,
        providerFetch: vi.fn<typeof fetch>(),
        userEnvKeys: [],
      },
    },
    prompt: 'Hosted queue-only unsupported-channel manual reply',
    turnTrigger: 'manual-ask',
    vault: '/vaults/test',
  })

  const progressDelivery =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.progressDelivery
  const hostedToolContext =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.hostedToolContext
  assert.equal(progressDelivery, null)
  assert.ok(hostedToolContext)
  assert.equal(hostedToolContext.computerToolsAvailable, false)
  assert.equal(mocks.deliverAssistantProgressUpdate.mock.calls.length, 0)
  assert.equal(progressDeliveryDependencies.sendTelegram.mock.calls.length, 0)
})

test('sendAssistantMessageLocal lets the provider own hosted attachment progress', async () => {
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
  const session = createAssistantSession()
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...sharedPlan,
      persistUserPromptOnFailure: false,
    },
    realAcceptedInputPersistence: true,
    session,
  })
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    expect(mocks.deliverAssistantProgressUpdate).toHaveBeenCalledTimes(0)
    await expect(
      providerInput.progressDelivery?.send('Checking the saved context now.'),
    ).resolves.toEqual({
      kind: 'sent',
      source: 'model',
    })
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
        codexThreadId: 'provider-thread-default',
        response: 'assistant response',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'assistant response',
        route: {
          routeId: 'route-default',
        },
        session,
      },
    }
  })

  await sendAssistantMessageLocal({
    acceptedTurnInput: {
      initialInputs: [
        assistantInputCandidateFromStoredEvent(hostedInput).acceptedInput,
      ],
    },
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
    prompt: 'Process the attached PDF',
    turnTrigger: 'manual-ask',
    vault: context.vaultRoot,
  })

  expect(mocks.deliverAssistantProgressUpdate).toHaveBeenCalledTimes(1)
  expect(mocks.deliverAssistantProgressUpdate.mock.calls[0]?.[0]).toMatchObject({
    text: 'Checking the saved context now.',
  })
  const attachmentProgressDependencies =
    mocks.deliverAssistantProgressUpdate.mock.calls[0]?.[0]?.dependencies
  assert.ok(attachmentProgressDependencies?.sendLinq)
  await attachmentProgressDependencies.sendLinq({
    message: 'Checking the saved context now.',
    target: 'thread-progress',
    targetKind: 'thread',
  })
  expect(progressDeliveryDependencies.sendLinq).toHaveBeenCalledWith(
    expect.objectContaining({
      acceptedAssistantInputIds: [hostedInput.inputId],
      message: 'Checking the saved context now.',
    }),
  )
  expect(
    mocks.executeCodexTurnWithRecovery.mock.invocationCallOrder[0],
  ).toBeLessThanOrEqual(
    mocks.deliverAssistantProgressUpdate.mock.invocationCallOrder[0] ??
      Number.MAX_SAFE_INTEGER,
  )

  const progressDelivery =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.progressDelivery
  assert.ok(progressDelivery)
  await expect(
    progressDelivery.send('Still checking the attachment context.'),
  ).resolves.toEqual({
    kind: 'sent',
    source: 'model',
  })
  await expect(
    progressDelivery.send('One more progress update.'),
  ).resolves.toEqual({
    kind: 'sent',
    source: 'model',
  })
  await expect(
    progressDelivery.send('A fourth progress update.'),
  ).resolves.toEqual({
    kind: 'skipped',
    reason: 'limit',
    source: 'model',
  })
  await expect(
    progressDelivery.send('Required checkpoint prompt.', { required: true }),
  ).resolves.toEqual({
    kind: 'sent',
    source: 'model',
  })
  expect(mocks.deliverAssistantProgressUpdate).toHaveBeenCalledTimes(4)
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
    deliveryDispatchMode: 'immediate',
    executionContext: {
      hosted: {
        memberId: 'member-hosted',
        progressDeliveryDependencies,
        providerFetch: vi.fn(async () => new Response(null)),
        userEnvKeys: [],
      },
    },
    prompt: 'Hosted queue-only manual reply',
    turnTrigger: 'manual-ask',
    vault: '/vaults/test',
  })

  const progressDelivery =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.progressDelivery
  const hostedToolContext =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.hostedToolContext
  assert.ok(progressDelivery)
  assert.ok(hostedToolContext)
  assert.equal(hostedToolContext.computerToolsAvailable, true)
  const result = await progressDelivery.send('Checking the iMessage thread.')

  assert.deepEqual(result, {
    kind: 'sent',
    source: 'model',
  })
  assert.equal(mocks.deliverAssistantProgressUpdate.mock.calls.length, 1)
  const resolvedChannelProgressDependencies =
    mocks.deliverAssistantProgressUpdate.mock.calls[0]?.[0]?.dependencies
  assert.ok(resolvedChannelProgressDependencies?.sendLinq)
  await resolvedChannelProgressDependencies.sendLinq({
    message: 'Checking the iMessage thread.',
    target: 'thread-progress',
    targetKind: 'thread',
  })
  expect(progressDeliveryDependencies.sendLinq).toHaveBeenCalledWith(
    expect.objectContaining({
      acceptedAssistantInputIds: ['initial'],
      message: 'Checking the iMessage thread.',
    }),
  )
})

test('sendAssistantMessageLocal does not expose optional progress delivery for hosted email', async () => {
  const progressDeliveryDependencies = {
    sendEmail: vi.fn(async () => ({
      providerMessageId: 'required-message',
      providerThreadId: 'email-thread',
      target: 'email-thread',
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
    channel: 'email',
    deliverResponse: true,
    deliveryDispatchMode: 'queue-only',
    executionContext: {
      hosted: {
        memberId: 'member-hosted',
        progressDeliveryDependencies,
        providerFetch: vi.fn(async () => new Response(null)),
        userEnvKeys: [],
      },
    },
    prompt: 'Hosted queue-only email manual reply',
    turnTrigger: 'manual-ask',
    vault: '/vaults/test',
  })

  const progressDelivery =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.progressDelivery
  const hostedToolContext =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.hostedToolContext
  assert.equal(progressDelivery, null)
  assert.ok(hostedToolContext)
  assert.equal(hostedToolContext.computerToolsAvailable, true)
  assert.equal(mocks.deliverAssistantProgressUpdate.mock.calls.length, 0)
})
