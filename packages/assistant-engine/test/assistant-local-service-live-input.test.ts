import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

import { expect, test, vi } from 'vitest'

import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import { createAssistantUsageId } from '@murphai/hosted-execution/assistant-usage'
import {
  readAssistantAcceptedTurnInputJournal,
  resolveAssistantAcceptedTurnInputJournalPath,
} from '../src/assistant/active-turn-input-journal.ts'
import {
  type AssistantActiveTurnInputAdmissionHook,
  type AssistantActiveTurnInputCheckpointInput,
} from '../src/assistant/turn-input.js'
import {
  readAssistantInputEvent,
  updateAssistantInputAttachmentEvidence,
  upsertAssistantInputEvent,
} from '../src/assistant/input-store.ts'
import {
  assistantInputCandidateFromStoredEvent,
  createStoreBackedAssistantInputSource,
} from '../src/assistant/input-source.ts'
import {
  readAutomationDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools/automation.ts'
import { readAssistantTranscriptEntries } from '../src/assistant/store/persistence.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.ts'

import {
  createAssistantSession,
  createDeferred,
  createHostedMailboxSourceRef,
  createProviderUsage,
  createSharedPlan,
  loadLocalServiceModule,
  tempRoots,
  type Deferred,
} from './assistant-local-service-runtime.harness.ts'

test('sendAssistantMessageLocal live-steers same-conversation input without provider replay', async () => {
  const progressDeliveryDependencies = {
    sendLinq: vi.fn(async () => ({
      providerMessageId: 'linq-progress-message',
      providerThreadId: 'linq-progress-thread',
      target: 'linq-progress-thread',
      targetKind: 'thread' as const,
    })),
    sendTelegram: vi.fn(async () => ({
      providerMessageId: 'telegram-progress-message',
      providerThreadId: 'thread-1',
      target: 'thread-1',
      targetKind: 'thread' as const,
    })),
  }
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
  const sharedPlan = createSharedPlan()
  sharedPlan.conversationPolicy.audience.channel = 'telegram'
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...sharedPlan,
      persistUserPromptOnFailure: false,
    },
    session,
  })
  const providerStarted = createDeferred<void>()
  const providerProgressRequested = createDeferred<void>()
  const providerProgressDelivered = createDeferred<void>()
  const providerRelease = createDeferred<void>()
  const providerBoundInputIds: string[][] = []
  const releaseProviderAcceptedInputs = vi.fn(async () => undefined)
  const liveSteeredPrompts: string[] = []
  mocks.deliverAssistantProgressUpdate.mockImplementationOnce(
    async (progressInput) => {
      await progressInput.dependencies?.sendTelegram?.({
        message: progressInput.text,
        target: 'thread-1',
      })
      return session
    },
  )
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    const releaseLiveTurn = providerInput.activeTurnSteering?.registerLiveProviderTurn({
      interrupt: async () => undefined,
      codexThreadId: 'provider-thread-active-turn',
      providerTurnId: 'provider-turn-active-turn',
      sessionId: session.sessionId,
      steer: async (input) => {
        liveSteeredPrompts.push(input.prompt)
      },
      turnId: 'turn-1',
    })
    providerStarted.resolve()
    await providerProgressRequested.promise
    await providerInput.progressDelivery?.send(
      'Checking the Telegram follow up.',
      {
        required: true,
        source: 'system',
      },
    )
    providerProgressDelivered.resolve()
    await providerRelease.promise
    releaseLiveTurn?.()
    return {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        codexThreadId: 'provider-thread-active-turn',
        response: 'final after late input',
        responseDeliveryContextOrdinal: 1,
        transcriptResponse: 'final after late input',
        route: {
          routeId: 'route-active-turn',
        },
        session,
      },
    }
  })
  const activeTurnCheckpoint = vi.fn(
    async (_input: AssistantActiveTurnInputCheckpointInput) => undefined,
  )

  const initialResultPromise = sendAssistantMessageLocal({
    activeTurnCheckpoint,
    beforeProviderAcceptedInputs: async ({ acceptedInputs, turnId }) => {
      expect(turnId).toBe('turn-1')
      expect(
        mocks.runtimeState.turns.acceptedInputs.append.mock.calls.at(-1)?.[0]
          ?.inputs,
      ).toEqual(acceptedInputs)
      providerBoundInputIds.push(acceptedInputs.map((item) => item.id))
      return releaseProviderAcceptedInputs
    },
    channel: 'telegram',
    deliverResponse: true,
    deliveryDispatchMode: 'immediate',
    deliveryTarget: 'initial-thread',
    executionContext: {
      hosted: {
        memberId: 'member-hosted',
        progressDeliveryDependencies,
        userEnvKeys: [],
      },
    },
    prompt: 'Initial prompt',
    turnTrigger: 'manual-ask',
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
    prompt: 'Late follow up',
    vault: '/vaults/test',
  })
  await vi.waitFor(() => {
    expect(liveSteeredPrompts).toEqual(['Late follow up'])
  })
  expect(providerBoundInputIds).toEqual([['manual-1']])
  expect(releaseProviderAcceptedInputs).toHaveBeenCalledOnce()
  providerProgressRequested.resolve()
  await providerProgressDelivered.promise
  expect(activeTurnCheckpoint).toHaveBeenCalledTimes(0)
  expect(progressDeliveryDependencies.sendTelegram).toHaveBeenCalledWith(
    expect.objectContaining({
      message: 'Checking the Telegram follow up.',
    }),
  )
  expect(progressDeliveryDependencies.sendLinq).toHaveBeenCalledTimes(0)
  assert.equal(
    mocks.deliverAssistantProgressUpdate.mock.calls[0]?.[0]?.dependencies,
    progressDeliveryDependencies,
  )
  providerRelease.resolve()

  const [initialResult, steeredResult] = await Promise.all([
    initialResultPromise,
    steeredResultPromise,
  ])

  assert.equal(mocks.createAssistantTurnReceipt.mock.calls.length, 1)
  assert.equal(mocks.finalizeAssistantTurnReceipt.mock.calls.length, 0)
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 1)
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
        id: 'manual-1',
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
        inputId: 'manual-1',
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
    acceptedInputIds: ['initial', 'manual-1'],
    providerRequestOrdinal: 0,
    sessionId: session.sessionId,
    signal: undefined,
    turnId: 'turn-1',
    vault: '/vaults/test',
  })
  assert.deepEqual(
    mocks.runtimeState.turns.acceptedInputs.recordProviderRequest.mock.calls.map(
      (call) => call[0]?.ordinal,
    ),
    [0],
  )
  expect(mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.progressDelivery)
    .toBeTruthy()
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateProviderRequest.mock.calls
      .map((call) => call[0])
      .some((input) =>
        input.ordinal === 0 &&
        input.turnId === 'turn-1' &&
        input.acceptedInputIds?.join(',') === 'initial,manual-1'
      ),
  ).toBe(true)
  assert.deepEqual(
    mocks.recordAssistantUsageEvent.mock.calls.map(
      (call) => ({
        inputIds: call[0]?.providerRequestAcceptedInputIds,
        ordinal: call[0]?.providerRequestOrdinal,
      }),
    ),
    [{
      inputIds: ['initial', 'manual-1'],
      ordinal: 0,
    }],
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
  assert.equal(initialResult.prompt, 'Late follow up')
  assert.equal(initialResult.response, 'final after late input')
  assert.equal(steeredResult.prompt, 'Late follow up')
  assert.equal(steeredResult.response, 'final after late input')
})

test('sendAssistantMessageLocal leaves an acknowledged uncovered steer pending after provider success', async () => {
  const context = await createTempVaultContext(
    'assistant-local-service-uncovered-steer-',
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
  })
  const initialInput = await upsertAssistantInputEvent({
    vault: context.vaultRoot,
    now: new Date('2026-04-22T10:00:00.000Z'),
    event: {
      content: {
        attachmentDescriptors: [],
        text: 'Initial durable request',
      },
      conversation: {
        accountId: 'acct_1',
        actorId: 'actor_1',
        actorIsSelf: false,
        source: 'telegram',
        threadId: 'thread-1',
        threadIsDirect: false,
      },
      occurredAt: '2026-04-22T10:00:00.000Z',
      receivedAt: '2026-04-22T10:00:00.000Z',
      replyTarget: {
        channel: 'telegram',
        messageId: 'message-initial',
        threadId: 'thread-1',
      },
      sourceRef: createHostedMailboxSourceRef({
        eventId: 'evt_uncovered_steer_initial',
        laneSeq: '1',
      }),
    },
  })
  const uncoveredInput = await upsertAssistantInputEvent({
    vault: context.vaultRoot,
    now: new Date('2026-04-22T10:00:01.000Z'),
    event: {
      content: {
        attachmentDescriptors: [],
        text: 'Late durable follow up',
      },
      conversation: {
        accountId: 'acct_1',
        actorId: 'actor_1',
        actorIsSelf: false,
        source: 'telegram',
        threadId: 'thread-1',
        threadIsDirect: false,
      },
      occurredAt: '2026-04-22T10:00:01.000Z',
      receivedAt: '2026-04-22T10:00:01.000Z',
      replyTarget: {
        channel: 'telegram',
        messageId: 'message-late',
        threadId: 'thread-1',
      },
      sourceRef: createHostedMailboxSourceRef({
        eventId: 'evt_uncovered_steer_late',
        laneSeq: '2',
      }),
    },
  })
  const providerStarted = createDeferred<void>()
  const finishProviderResult = createDeferred<void>()
  const admissionClosed = createDeferred<void>()
  const steerStarted = createDeferred<void>()
  const releaseSteer = createDeferred<void>()
  const steerSettled = createDeferred<void>()
  const liveSteeredPrompts: string[] = []
  const activeTurnInput = vi.fn<AssistantActiveTurnInputAdmissionHook>(
    async (input) => {
      if (input.knownInputIds?.includes(uncoveredInput.inputId)) {
        return {
          kind: 'no-new-input',
        }
      }
      if (activeTurnInput.mock.calls.length === 1) {
        return {
          kind: 'no-new-input',
        }
      }
      expect(input.availableInputIds).toEqual([uncoveredInput.inputId])
      return {
        acceptedInputs: [
          {
            ...assistantInputCandidateFromStoredEvent(uncoveredInput).acceptedInput,
            promptFallbackReason: 'missing-content-ref',
            promptFallbackText: 'Late durable follow up',
          },
        ],
        kind: 'accepted',
        prompt: 'Late durable follow up',
        transcriptText: 'Late durable follow up',
        userMessageContent: [
          {
            text: 'Late durable follow up',
            type: 'text',
          },
        ],
      }
    },
  )
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...createSharedPlan(),
      persistUserPromptOnFailure: false,
    },
    realAcceptedInputPersistence: true,
    session,
  })
  const { notifyAssistantActiveTurnInputAvailable } = await import(
    '../src/assistant/active-turn-input-controller.ts'
  )
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    await providerInput.onProviderRequestPlanned?.({
      providerAttemptId: null,
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
    })
    const releaseLiveTurn =
      providerInput.activeTurnSteering?.registerLiveProviderTurn({
        interrupt: async () => undefined,
        codexThreadId: 'thread-uncovered-steer',
        providerTurnId: 'turn-uncovered-steer',
        sessionId: session.sessionId,
        steer: async (input) => {
          liveSteeredPrompts.push(input.prompt)
          steerStarted.resolve()
          await releaseSteer.promise
          steerSettled.resolve()
        },
        turnId: 'turn-1',
      })
    providerStarted.resolve()
    await finishProviderResult.promise
    providerInput.activeTurnSteering?.onFirstAssistantResponseCompleted()
    admissionClosed.resolve()
    await steerSettled.promise
    releaseLiveTurn?.()
    return {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        response: 'Answer to the initial durable request',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'Answer to the initial durable request',
        session,
      },
    }
  })
  const activeTurnCheckpoint = vi.fn(
    async (_input: AssistantActiveTurnInputCheckpointInput) => undefined,
  )

  const resultPromise = sendAssistantMessageLocal({
    acceptedTurnInput: {
      initialInputs: [
        assistantInputCandidateFromStoredEvent(initialInput).acceptedInput,
      ],
    },
    activeTurnCheckpoint,
    activeTurnInput,
    prompt: 'Initial durable request',
    vault: context.vaultRoot,
  })
  await providerStarted.promise

  await notifyAssistantActiveTurnInputAvailable({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
      directness: 'group',
    },
    inputIds: [uncoveredInput.inputId],
    vault: context.vaultRoot,
  })
  await steerStarted.promise
  expect(liveSteeredPrompts).toEqual(['Late durable follow up'])

  finishProviderResult.resolve()
  await admissionClosed.promise
  releaseSteer.resolve()

  await expect(resultPromise).resolves.toMatchObject({
    prompt: 'Initial durable request',
    response: 'Answer to the initial durable request',
  })

  const journal = await readAssistantAcceptedTurnInputJournal(
    context.vaultRoot,
    'turn-1',
  )
  expect(journal?.inputIds).toEqual([initialInput.inputId])
  expect(journal?.providerRequests[0]?.acceptedInputIds).toEqual([
    initialInput.inputId,
  ])
  expect(activeTurnCheckpoint).not.toHaveBeenCalled()
  expect(
    await readAssistantInputEvent({
      inputId: uncoveredInput.inputId,
      vault: context.vaultRoot,
    }),
  ).toMatchObject({
    content: {
      text: 'Late durable follow up',
    },
    inputId: uncoveredInput.inputId,
  })
  expect(
    (await readAssistantTranscriptEntries(
      resolveAssistantStatePaths(context.vaultRoot),
      session.sessionId,
    )).some((entry) => entry.text === 'Late durable follow up'),
  ).toBe(false)
})

test('sendAssistantMessageLocal finalizes one provider request when no live input arrives', async () => {
  const session = createAssistantSession({
    resumeState: {
      routeFingerprint: 'old-route',
      threadId: 'old-provider-thread',
    },
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    session,
  })

  await sendAssistantMessageLocal({
    deliverResponse: false,
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  })

  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 1)
  assert.equal(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.providerResumeStateAction,
    'persist-from-provider-turn',
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
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'assistant response',
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

test('sendAssistantMessageLocal binds accepted inputs before provider execution', async () => {
  const callOrder: string[] = []
  const session = createAssistantSession()
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    session,
  })
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    await providerInput.onProviderRequestPlanned?.({
      providerAttemptId: null,
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
    })
    callOrder.push('provider')
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
        {
          id: 'turn-default',
          source: 'initial',
        },
      ],
    },
    beforeProviderAcceptedInputs: async ({
      acceptedInputs,
      turnId,
    }) => {
      assert.deepEqual(acceptedInputs.map((item) => item.id), ['turn-default'])
      assert.equal(turnId, 'turn-1')
      callOrder.push('accepted-inputs')
    },
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  })

  assert.deepEqual(callOrder, ['accepted-inputs', 'provider'])
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
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'assistant response',
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

test('sendAssistantMessageLocal serializes concurrent hosted tool preflights at the provider-visible bound', async () => {
  const context = await createTempVaultContext(
    'assistant-local-service-active-turn-event-steer-',
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
  })
  const writeVideoEvidence = async (input: {
    inputId: string
    label: string
    status: 'available' | 'failed'
  }) => {
    const rawPath =
      `raw/inbox/cap_${input.label}/attachments/01__video.mp4`
    const bytes = Buffer.from([
      0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
      input.label.length,
    ])
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    await mkdir(path.dirname(path.join(context.vaultRoot, rawPath)), {
      recursive: true,
    })
    await writeFile(path.join(context.vaultRoot, rawPath), bytes)
    await updateAssistantInputAttachmentEvidence({
      attachmentEvidence: {
        attachments: [{
          byteSize: bytes.byteLength,
          derived: null,
          descriptorAttachmentId: `descriptor_${input.label}`,
          fileName: 'video.mp4',
          inlineFragments: [],
          kind: 'video',
          mime: 'video/mp4',
          ordinal: 1,
          parseState: 'succeeded',
          raw: {
            byteSize: bytes.byteLength,
            kind: 'vault-relative-file',
            mediaType: 'video/mp4',
            path: rawPath,
            sha256,
          },
          sourceAttachmentId: `source_${input.label}`,
        }],
        optionalInboxCaptureId: `cap_${input.label}`,
        reasonCode: input.status === 'failed' ? 'evidence_failed' : null,
        source: 'hosted-inbox-projection',
        status: input.status,
        updatedAt: null,
      },
      inputId: input.inputId,
      vault: context.vaultRoot,
    })
    return { bytes, rawPath, sha256 }
  }
  const earlierHostedInput = await upsertAssistantInputEvent({
    vault: context.vaultRoot,
    now: new Date('2026-04-22T10:00:00.500Z'),
    event: {
      content: {
        attachmentDescriptors: [],
        text: 'Earlier accepted request',
      },
      conversation: {
        accountId: 'acct_1',
        actorId: 'actor_earlier',
        actorIsSelf: false,
        source: 'telegram',
        threadId: 'thread-1',
        threadIsDirect: false,
      },
      occurredAt: '2026-04-22T09:59:59.000Z',
      receivedAt: '2026-04-22T09:59:59.000Z',
      replyTarget: {
        channel: 'telegram',
        messageId: 'message-earlier-request',
        threadId: 'thread-1',
      },
      sourceRef: createHostedMailboxSourceRef({
        eventId: 'evt_active_turn_earlier_request',
        laneSeq: '1',
      }),
    },
  })
  const initialVideo = await writeVideoEvidence({
    inputId: earlierHostedInput.inputId,
    label: 'initial_video',
    status: 'available',
  })
  const hostedInput = await upsertAssistantInputEvent({
    vault: context.vaultRoot,
    now: new Date('2026-04-22T10:00:01.000Z'),
    event: {
      content: {
        attachmentDescriptors: [],
        text: 'Event-backed follow up',
      },
      conversation: {
        accountId: 'acct_1',
        actorId: 'actor_1',
        actorIsSelf: false,
        source: 'telegram',
        threadId: 'thread-1',
        threadIsDirect: false,
      },
      occurredAt: '2026-04-22T10:00:00.000Z',
      receivedAt: '2026-04-22T10:00:00.000Z',
      replyTarget: {
        channel: 'telegram',
        messageId: 'message-event-steer',
        threadId: 'thread-1',
      },
      sourceRef: createHostedMailboxSourceRef({
        eventId: 'evt_active_turn_event_steer',
        laneSeq: '2',
      }),
    },
  })
  const acceptedVideo = await writeVideoEvidence({
    inputId: hostedInput.inputId,
    label: 'active_turn_video',
    status: 'available',
  })
  const uncoveredHostedInput = await upsertAssistantInputEvent({
    vault: context.vaultRoot,
    now: new Date('2026-04-22T10:00:02.000Z'),
    event: {
      content: {
        attachmentDescriptors: [],
        text: 'Acknowledged but uncovered follow up',
      },
      conversation: {
        accountId: 'acct_1',
        actorId: 'actor_2',
        actorIsSelf: false,
        source: 'telegram',
        threadId: 'thread-1',
        threadIsDirect: false,
      },
      occurredAt: '2026-04-22T10:00:01.000Z',
      receivedAt: '2026-04-22T10:00:01.000Z',
      replyTarget: {
        channel: 'telegram',
        messageId: 'message-event-steer-uncovered',
        threadId: 'thread-1',
      },
      sourceRef: createHostedMailboxSourceRef({
        eventId: 'evt_active_turn_event_steer_uncovered',
        laneSeq: '3',
      }),
    },
  })
  await writeVideoEvidence({
    inputId: uncoveredHostedInput.inputId,
    label: 'failed_video',
    status: 'failed',
  })
  const providerStarted = createDeferred<void>()
  const providerRelease = createDeferred<void>()
  const toolExecutionRequested = createDeferred<void>()
  const ordinalZeroPreflightChecked = createDeferred<void>()
  const ordinalOnePreflightRequested = createDeferred<void>()
  const firstCheckpointStarted = createDeferred<void>()
  const firstCheckpointRelease = createDeferred<void>()
  const secondPreflightRequested = createDeferred<void>()
  const toolExecutionCheckpointed = createDeferred<void>()
  const liveSteeredPrompts: string[] = []
  let videoAuthoritiesBeforePreflight: readonly unknown[] = []
  let videoAuthoritiesAfterPreflight: readonly unknown[] = []
  let earlierParticipantAuthorization: { targetInputId: string } | null = null
  let earlierParticipantAuthorizationError: unknown = null
  const activeTurnInput = vi.fn<AssistantActiveTurnInputAdmissionHook>(
    async (input) => {
      if (activeTurnInput.mock.calls.length === 1) {
        return {
          kind: 'no-new-input',
        }
      }
      const nextInput = [hostedInput, uncoveredHostedInput].find(
        (candidate) =>
          input.availableInputIds?.includes(candidate.inputId) === true &&
          !input.knownInputIds?.includes(candidate.inputId),
      )
      if (!nextInput) {
        return {
          kind: 'no-new-input',
        }
      }
      const prompt =
        nextInput.inputId === hostedInput.inputId
          ? 'Event-backed follow up'
          : 'Acknowledged but uncovered follow up'
      return {
        acceptedInputs: [
          {
            ...assistantInputCandidateFromStoredEvent(nextInput).acceptedInput,
            promptFallbackReason: 'missing-content-ref',
            promptFallbackText: prompt,
          },
        ],
        kind: 'accepted',
        prompt,
        transcriptText: prompt,
        userMessageContent: [
          {
            text: prompt,
            type: 'text',
          },
        ],
      }
    },
  )
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...createSharedPlan(),
      persistUserPromptOnFailure: false,
    },
    realAcceptedInputPersistence: true,
    session,
  })
  const { notifyAssistantActiveTurnInputAvailable } = await import(
    '../src/assistant/active-turn-input-controller.ts'
  )
  const activeTurnCheckpoint = vi.fn(
    async (_input: AssistantActiveTurnInputCheckpointInput) => {
      if (activeTurnCheckpoint.mock.calls.length === 1) {
        firstCheckpointStarted.resolve()
        await firstCheckpointRelease.promise
      }
    },
  )
  const beforeProviderAcceptedInputs = vi.fn(async () => undefined)
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
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
        if (input.prompt === 'Event-backed follow up') {
          await writeVideoEvidence({
            inputId: hostedInput.inputId,
            label: 'active_turn_video_after_steer',
            status: 'available',
          })
        }
        liveSteeredPrompts.push(input.prompt)
      },
      turnId: 'turn-1',
    })
    providerStarted.resolve()
    await toolExecutionRequested.promise
    videoAuthoritiesBeforePreflight =
      providerInput.hostedToolContext
        ?.currentAnalyzeVideoAttachmentAuthorities?.() ?? []
    await providerInput.hostedToolContext?.beforeToolExecution?.(0)
    ordinalZeroPreflightChecked.resolve()
    await ordinalOnePreflightRequested.promise
    const firstPreflight =
      providerInput.hostedToolContext?.beforeToolExecution?.(1) ??
      Promise.resolve()
    await firstCheckpointStarted.promise
    const secondPreflight =
      providerInput.hostedToolContext?.beforeToolExecution?.(1) ??
      Promise.resolve()
    secondPreflightRequested.resolve()
    await Promise.all([firstPreflight, secondPreflight])
    videoAuthoritiesAfterPreflight =
      providerInput.hostedToolContext
        ?.currentAnalyzeVideoAttachmentAuthorities?.() ?? []
    try {
      earlierParticipantAuthorization =
        await providerInput.authorizeAcceptedMessageTarget?.({
          action: 'participant-effect',
          deliveryContextOrdinal: 1,
          messageRef: earlierHostedInput.inputId,
        }) ?? null
    } catch (error) {
      earlierParticipantAuthorizationError = error
    }
    toolExecutionCheckpointed.resolve()
    await providerRelease.promise
    releaseLiveTurn?.()
    return {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        response: 'final after event input',
        responseDeliveryContextOrdinal: 1,
        transcriptResponse: 'final after event input',
        session,
      },
    }
  })

  const resultPromise = sendAssistantMessageLocal({
    activeTurnCheckpoint,
    acceptedTurnInput: {
      initialInputs: [
        assistantInputCandidateFromStoredEvent(earlierHostedInput).acceptedInput,
      ],
    },
    activeTurnInput,
    beforeProviderAcceptedInputs,
    executionContext: {
      hosted: {
        memberId: 'member-hosted',
        userEnvKeys: [],
      },
    },
    prompt: 'Initial prompt',
    vault: context.vaultRoot,
  })
  await providerStarted.promise

  await notifyAssistantActiveTurnInputAvailable({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
      directness: 'group',
    },
    inputIds: [hostedInput.inputId],
    vault: context.vaultRoot,
  })
  await vi.waitFor(() => {
    expect(liveSteeredPrompts).toEqual(['Event-backed follow up'])
  })
  await writeFile(
    path.join(context.vaultRoot, acceptedVideo.rawPath),
    Buffer.alloc(acceptedVideo.bytes.byteLength, 0x7f),
  )
  toolExecutionRequested.resolve()
  await ordinalZeroPreflightChecked.promise

  const journalBeforeCoveredToolRequest =
    await readAssistantAcceptedTurnInputJournal(
      context.vaultRoot,
      'turn-1',
    )
  expect(
    journalBeforeCoveredToolRequest?.providerRequests[0]?.acceptedInputIds,
  ).toEqual([earlierHostedInput.inputId])

  ordinalOnePreflightRequested.resolve()
  await firstCheckpointStarted.promise
  await notifyAssistantActiveTurnInputAvailable({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
      directness: 'group',
    },
    inputIds: [uncoveredHostedInput.inputId],
    vault: context.vaultRoot,
  })
  await secondPreflightRequested.promise
  expect(liveSteeredPrompts).toEqual(['Event-backed follow up'])
  firstCheckpointRelease.resolve()
  await vi.waitFor(() => {
    expect(liveSteeredPrompts).toEqual([
      'Event-backed follow up',
      'Acknowledged but uncovered follow up',
    ])
  })
  expect(beforeProviderAcceptedInputs).toHaveBeenCalledTimes(3)
  const secondSteerBindingOrder =
    beforeProviderAcceptedInputs.mock.invocationCallOrder[2] ?? 0
  expect(secondSteerBindingOrder).toBeGreaterThan(
    mocks.appendAssistantTurnReceiptEvent.mock.invocationCallOrder[0] ?? 0,
  )
  expect(secondSteerBindingOrder).toBeGreaterThan(
    activeTurnCheckpoint.mock.invocationCallOrder[0] ?? 0,
  )
  expect(secondSteerBindingOrder).toBeGreaterThan(
    mocks.runtimeState.turns.acceptedInputs.updateProviderRequest
      .mock.invocationCallOrder[0] ?? 0,
  )
  await toolExecutionCheckpointed.promise

  const journalBeforeToolEffect = await readAssistantAcceptedTurnInputJournal(
    context.vaultRoot,
    'turn-1',
  )
  expect(journalBeforeToolEffect?.providerRequests[0]?.acceptedInputIds).toEqual([
    earlierHostedInput.inputId,
    hostedInput.inputId,
  ])
  expect(videoAuthoritiesBeforePreflight).toEqual([{
    byteSize: initialVideo.bytes.byteLength,
    messageRef: earlierHostedInput.inputId,
    mimeType: 'video/mp4',
    ordinal: 1,
    rawPath: initialVideo.rawPath,
    sha256: initialVideo.sha256,
  }])
  expect(videoAuthoritiesAfterPreflight).toEqual([
    {
      byteSize: initialVideo.bytes.byteLength,
      messageRef: earlierHostedInput.inputId,
      mimeType: 'video/mp4',
      ordinal: 1,
      rawPath: initialVideo.rawPath,
      sha256: initialVideo.sha256,
    },
    {
      byteSize: acceptedVideo.bytes.byteLength,
      messageRef: hostedInput.inputId,
      mimeType: 'video/mp4',
      ordinal: 1,
      rawPath: acceptedVideo.rawPath,
      sha256: acceptedVideo.sha256,
    },
  ])
  const refreshedHostedInput = await readAssistantInputEvent({
    inputId: hostedInput.inputId,
    vault: context.vaultRoot,
  })
  expect(
    refreshedHostedInput?.attachmentEvidence.attachments[0]?.raw?.path,
  ).toBe(
    'raw/inbox/cap_active_turn_video_after_steer/attachments/01__video.mp4',
  )
  providerRelease.resolve()

  await expect(resultPromise).resolves.toMatchObject({
    prompt: 'Event-backed follow up',
    response: 'final after event input',
  })
  expect(earlierParticipantAuthorizationError).toBeNull()
  expect(earlierParticipantAuthorization).toMatchObject({
    targetInputId: earlierHostedInput.inputId,
  })
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 1)
  assert.equal(activeTurnInput.mock.calls.length, 3)
  expect(activeTurnCheckpoint).toHaveBeenCalledTimes(1)
  const journal = await readAssistantAcceptedTurnInputJournal(
    context.vaultRoot,
    'turn-1',
  )
  expect(journal?.inputIds).toEqual([
    earlierHostedInput.inputId,
    hostedInput.inputId,
    uncoveredHostedInput.inputId,
  ])
  expect(journal?.providerRequests).toHaveLength(1)
  expect(journal?.providerRequests[0]?.acceptedInputIds).toEqual([
    earlierHostedInput.inputId,
    hostedInput.inputId,
  ])
  expect(activeTurnCheckpoint).toHaveBeenCalledWith(
    expect.objectContaining({
      acceptedInputIds: [
        earlierHostedInput.inputId,
        hostedInput.inputId,
      ],
    }),
  )
  expect(
    (await readAssistantTranscriptEntries(
      resolveAssistantStatePaths(context.vaultRoot),
      session.sessionId,
    )).map((entry) => entry.text),
  ).not.toContain('Acknowledged but uncovered follow up')
  const nextTurnCandidates =
    await createStoreBackedAssistantInputSource({
      vault: context.vaultRoot,
    }).listInputCandidates({
      knownInputIds: journal?.providerRequests[0]?.acceptedInputIds ?? [],
      limit: 10,
    })
  expect(nextTurnCandidates.inputs.map((candidate) => candidate.event.inputId))
    .toEqual([uncoveredHostedInput.inputId])
})

test('sendAssistantMessageLocal attributes required progress after real live steering to the same provider request', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2031-02-15T10:00:00.100Z'))
  const context = await createTempVaultContext(
    'assistant-local-service-active-turn-event-steer-',
  )
  tempRoots.push(context.parentRoot)
  const session = createAssistantSession({
    binding: {
      actorId: null,
      channel: 'linq',
      conversationKey:
        'channel:linq|identity:identity-1|audience:direct|thread:thread-1',
      delivery: {
        kind: 'thread',
        target: 'thread-1',
      },
      identityId: 'identity-1',
      threadId: 'thread-1',
      threadIsDirect: true,
    },
  })
  const earlierHostedInput = await upsertAssistantInputEvent({
    vault: context.vaultRoot,
    now: new Date('2026-04-22T10:00:00.000Z'),
    event: {
      content: {
        attachmentDescriptors: [],
        text: 'Earlier accepted group message',
      },
      conversation: {
        accountId: 'identity-1',
        actorId: 'actor_earlier',
        actorIsSelf: false,
        source: 'linq',
        threadId: 'thread-1',
        threadIsDirect: false,
      },
      occurredAt: '2026-04-22T09:59:59.000Z',
      receivedAt: '2026-04-22T09:59:59.000Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'message-event-earlier',
        threadId: 'thread-1',
      },
      sourceMetadata: {
        externalThreadRouteAuthorityPresent: true,
        kind: 'linq',
        partCount: 1,
        reactionEligible: true,
        replyToMessageId: null,
        service: 'iMessage',
      },
      sourceRef: createHostedMailboxSourceRef({
        eventId: 'evt_active_turn_event_earlier',
        laneSeq: '0',
      }),
    },
  })
  const hostedInput = await upsertAssistantInputEvent({
    vault: context.vaultRoot,
    now: new Date('2031-02-15T10:00:00.100Z'),
    event: {
      content: {
        attachmentDescriptors: [],
        text: 'Event-backed follow up',
      },
      conversation: {
        accountId: 'identity-1',
        actorId: 'actor_1',
        actorIsSelf: false,
        source: 'linq',
        threadId: 'thread-1',
        threadIsDirect: false,
      },
      occurredAt: '2031-02-15T09:59:58.000Z',
      receivedAt: '2031-02-15T09:59:59.900Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'message-event-steer',
        threadId: 'thread-1',
      },
      sourceMetadata: {
        externalThreadRouteAuthorityPresent: true,
        kind: 'linq',
        partCount: 1,
        reactionEligible: true,
        replyToMessageId: null,
        service: 'iMessage',
      },
      sourceRef: createHostedMailboxSourceRef({
        eventId: 'evt_active_turn_event_steer',
        laneSeq: '1',
      }),
    },
  })
  const hostedCandidate = assistantInputCandidateFromStoredEvent(hostedInput)
  const providerStarted = createDeferred<void>()
  const providerRelease = createDeferred<void>()
  const requiredProgressRequested = createDeferred<void>()
  const requiredProgressDelivered = createDeferred<void>()
  const liveSteeredPrompts: string[] = []
  const liveSteeredReferenceWindows: Array<{
    earliestAt: string
    latestAt: string
  } | null> = []
  const providerRequestStarted = vi.fn()
  const progressDeliveryDependencies = {
    sendLinq: vi.fn(async () => ({
      providerMessageId: 'progress-message-live-steer',
      providerThreadId: 'thread-1',
      target: 'thread-1',
    })),
  }
  const activeTurnInput = vi.fn<AssistantActiveTurnInputAdmissionHook>(
    async (input) => {
      if (input.knownInputIds?.includes(hostedInput.inputId)) {
        return {
          kind: 'no-new-input',
        }
      }
      if (activeTurnInput.mock.calls.length === 1) {
        return {
          kind: 'no-new-input',
        }
      }
      if (!input.availableInputIds?.length) {
        return {
          kind: 'no-new-input',
        }
      }
      expect(input.availableInputIds).toEqual([hostedInput.inputId])
      return {
        acceptedInputs: [
          {
            ...hostedCandidate.acceptedInput,
            promptFallbackReason: 'missing-content-ref',
            promptFallbackText: 'Event-backed follow up',
          },
        ],
        kind: 'accepted',
        prompt: 'Event-backed follow up',
        transcriptText: 'Event-backed follow up',
        userMessageContent: [
          {
            text: 'Event-backed follow up',
            type: 'text',
          },
        ],
      }
    },
  )
  const sharedPlan = createSharedPlan()
  sharedPlan.conversationPolicy.audience.channel = 'linq'
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...sharedPlan,
      persistUserPromptOnFailure: false,
    },
    realAcceptedInputPersistence: true,
    realMessageTargetSelection: true,
    session,
  })
  const { notifyAssistantActiveTurnInputAvailable } = await import(
    '../src/assistant/active-turn-input-controller.ts'
  )
  mocks.deliverAssistantProgressUpdate.mockImplementationOnce(
    async (progressInput) => {
      await progressInput.dependencies?.sendLinq?.({
        message: progressInput.text,
        replyToMessageId: progressInput.input.deliveryReplyToMessageId,
        target: 'thread-1',
        targetKind: 'thread',
      })
      return session
    },
  )
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    await providerInput.onProviderRequestPlanned?.({
      providerAttemptId: null,
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
    })
    await providerInput.onProviderRequestStarted?.({
      providerRequestOrdinal: 0,
      startedAt: '2026-04-22T10:00:02.000Z',
    })
    const releaseLiveTurn = providerInput.activeTurnSteering?.registerLiveProviderTurn({
      interrupt: async () => undefined,
      codexThreadId: 'thread-live',
      providerTurnId: 'turn-live-provider',
      sessionId: session.sessionId,
      steer: async (input) => {
        liveSteeredPrompts.push(input.prompt)
        liveSteeredReferenceWindows.push(input.relativeDateReferenceWindow)
      },
      turnId: 'turn-1',
    })
    providerStarted.resolve()
    await requiredProgressRequested.promise
    await providerInput.progressDelivery?.send(
      'Checking the live-steered follow up.',
      {
        deliveryContextOrdinal: 1,
        required: true,
        source: 'system',
        targetInputId: earlierHostedInput.inputId,
      },
    )
    requiredProgressDelivered.resolve()
    await providerRelease.promise
    releaseLiveTurn?.()
    return {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        response: 'final after event input',
        responseDeliveryContextOrdinal: 1,
        transcriptResponse: 'final after event input',
        session,
      },
    }
  })

  const resultPromise = sendAssistantMessageLocal({
    acceptedTurnInput: {
      initialInputs: [
        assistantInputCandidateFromStoredEvent(earlierHostedInput)
          .acceptedInput,
      ],
    },
    activeTurnInput,
    deliverResponse: true,
    deliveryDispatchMode: 'queue-only',
    executionContext: {
      hosted: {
        memberId: 'member-hosted',
        progressDeliveryDependencies,
        userEnvKeys: [],
      },
    },
    onProviderRequestStarted: providerRequestStarted,
    prompt: 'Initial prompt',
    turnTrigger: 'automation-auto-reply',
    vault: context.vaultRoot,
  })
  await providerStarted.promise

  await notifyAssistantActiveTurnInputAvailable({
    conversation: {
      channel: 'linq',
      identityId: 'identity-1',
      threadId: 'thread-1',
      directness: 'direct',
    },
    inputIds: [hostedInput.inputId],
    vault: context.vaultRoot,
  })
  await vi.waitFor(() => {
    expect(liveSteeredPrompts).toEqual(['Event-backed follow up'])
  })
  expect(liveSteeredReferenceWindows).toEqual([{
    earliestAt: '2031-02-15T09:59:59.900Z',
    latestAt: '2031-02-15T09:59:59.900Z',
  }])
  expect(readAutomationDynamicToolRequest({
    arguments: {
      action: 'save',
      instructions: 'Send the reminder.',
      schedule: {
        kind: 'at',
        localAt: {
          relativeDay: 'tomorrow',
          time: '09:00',
          timeZone: 'Pacific/Honolulu',
        },
      },
      title: 'Live-steered tomorrow reminder',
    },
    relativeDateReferenceWindow: liveSteeredReferenceWindows[0] ?? null,
    tool: 'automation',
  })).toMatchObject({
    kind: 'automation',
    request: {
      schedule: {
        at: '2031-02-15T19:00:00.000Z',
        kind: 'at',
      },
    },
  })
  requiredProgressRequested.resolve()
  await requiredProgressDelivered.promise

  const journalAfterRequiredProgress =
    await readAssistantAcceptedTurnInputJournal(
      context.vaultRoot,
      'turn-1',
    )
  expect(
    journalAfterRequiredProgress?.providerRequests[0]?.acceptedInputIds,
  ).toEqual([earlierHostedInput.inputId, hostedInput.inputId])
  expect(providerRequestStarted).toHaveBeenCalledTimes(1)
  expect(progressDeliveryDependencies.sendLinq).toHaveBeenCalledWith(
    expect.objectContaining({
      acceptedAssistantInputIds: [
        earlierHostedInput.inputId,
        hostedInput.inputId,
      ],
      message: 'Checking the live-steered follow up.',
      replyToMessageId: 'message-event-earlier',
    }),
  )
  providerRelease.resolve()

  await expect(resultPromise).resolves.toMatchObject({
    prompt: 'Initial prompt\n\nEvent-backed follow up',
    response: 'final after event input',
  })
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 1)
  assert.equal(activeTurnInput.mock.calls.length, 3)
  const journal = await readAssistantAcceptedTurnInputJournal(
    context.vaultRoot,
    'turn-1',
  )
  expect(journal?.inputIds).toEqual([
    earlierHostedInput.inputId,
    hostedInput.inputId,
  ])
  expect(journal?.providerRequests).toHaveLength(1)
  expect(journal?.providerRequests[0]?.acceptedInputIds).toEqual([
    earlierHostedInput.inputId,
    hostedInput.inputId,
  ])
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
  const providerStarted = createDeferred<void>()
  const providerRelease = createDeferred<void>()
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
        response: 'final after late input',
        responseDeliveryContextOrdinal: 1,
        transcriptResponse: 'final after late input',
        session,
      },
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
    deliverResponse: true,
    prompt: 'Initial prompt',
    vault: context.vaultRoot,
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
    prompt: 'Late follow up',
    vault: context.vaultRoot,
  })

  try {
    await vi.waitFor(() => {
      expect(liveSteeredPrompts).toEqual(['Late follow up'])
    })
    providerRelease.resolve()
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
      id: 'manual-1',
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
    await steeredResultPromise.catch(() => undefined)
  }

  await expect(resultPromise).resolves.toMatchObject({
    prompt: 'Late follow up',
    response: 'final after late input',
  })
  await expect(steeredResultPromise).resolves.toMatchObject({
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
            acceptedAt: '2026-04-22T10:00:00.000Z',
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
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'final after attempted steer',
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
            acceptedAt: '2026-04-22T10:00:00.000Z',
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
        directness: 'group',
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
      responseDeliveryContextOrdinal: 0,
      transcriptResponse: 'draft before missing late input',
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
              acceptedAt: '2026-04-22T10:00:00.000Z',
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
  const providerStarted = createDeferred<void>()
  const providerRelease = createDeferred<void>()
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
        response: 'final after steered input',
        responseDeliveryContextOrdinal: 1,
        transcriptResponse: 'final after steered input',
        session,
      },
    }
  })

  const firstResultPromise = sendAssistantMessageLocal({
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

  assert.equal(firstResult.response, 'final after steered input')
  assert.equal(steeredResult.response, 'final after steered input')
  assert.equal(mocks.createAssistantTurnReceipt.mock.calls.length, 1)
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 1)
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
  const reminderReferences = [{
    entityId: 'wfmt_initial',
    entityKind: 'workout_format',
  }]
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
        precedingResponseSegments: [{
          deliveryContextOrdinal: 0,
          response: 'initial response before live steer',
        }],
        response: 'final after live-steered input',
        responseDeliveryContextOrdinal: 1,
        transcriptResponse: 'final after live-steered input',
        session,
      },
    }
  })

  const firstResultPromise = sendAssistantMessageLocal({
    onProviderRequestStarted: providerRequestStarted,
    outboxAutomationContextReferences: reminderReferences,
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
    mocks.deliverAssistantPrecedingReplies.mock.calls[0]?.[0]?.segments?.[0]
      ?.deliveryContext?.outboxAutomationContextReferences,
  ).toEqual(reminderReferences)
  expect(
    mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.input
      ?.outboxAutomationContextReferences,
  ).toBeNull()
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateProviderRequest.mock.calls
      .map((call) => call[0])
      .some((input) =>
        input.ordinal === 0 &&
        input.turnId === 'turn-1' &&
        input.acceptedInputIds?.join(',') === 'initial,manual-1'
    ),
  ).toBe(true)
  expect(
    mocks.recordAssistantUsageEvent.mock.calls[0]?.[0]
      ?.providerRequestAcceptedInputIds,
  ).toEqual(['initial', 'manual-1'])
})

test('sendAssistantMessageLocal keeps provider success when live steer misses provider close', async () => {
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
  const steerStarted = createDeferred<void>()
  const steerRelease = createDeferred<void>()
  const liveSteeredPrompts: string[] = []

  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    const releaseLiveTurn = providerInput.activeTurnSteering?.registerLiveProviderTurn({
      interrupt: async () => undefined,
      codexThreadId: 'thread-live',
      providerTurnId: 'turn-live-provider',
      sessionId: session.sessionId,
      steer: async (input) => {
        liveSteeredPrompts.push(input.prompt)
        steerStarted.resolve()
        await steerRelease.promise
        const error = new Error('Codex app-server live turn is no longer active.')
        Object.assign(error, {
          code: 'ASSISTANT_CODEX_APP_SERVER_LIVE_TURN_INACTIVE',
        })
        throw error
      },
      turnId: 'turn-1',
    })
    providerStarted.resolve()
    await steerStarted.promise
    releaseLiveTurn?.()
    steerRelease.resolve()
    return {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        response: 'final before missed live steer',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'final before missed live steer',
        session,
      },
    }
  })

  const capture = <T>(promise: Promise<T>) =>
    promise.then(
      (result) => ({ result, status: 'fulfilled' as const }),
      (error: unknown) => ({ error, status: 'rejected' as const }),
    )

  const firstResultPromise = sendAssistantMessageLocal({
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  })
  await providerStarted.promise

  const missedSteerResultPromise = capture(sendAssistantMessageLocal({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
      directness: 'group',
    },
    expectedActiveTurnId: 'turn-1',
    prompt: 'Misses provider close',
    vault: '/vaults/test',
  }))
  await steerStarted.promise

  const [firstResult, missedSteerOutcome] = await Promise.all([
    firstResultPromise,
    missedSteerResultPromise,
  ])

  assert.equal(firstResult.response, 'final before missed live steer')
  assert.equal(missedSteerOutcome.status, 'rejected')
  expect(missedSteerOutcome.error).toMatchObject({
    code: 'ASSISTANT_ACTIVE_TURN_NOT_ACTIVE',
  })
  expect(liveSteeredPrompts).toEqual(['Misses provider close'])
  assert.equal(mocks.createAssistantTurnReceipt.mock.calls.length, 1)
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 1)
  assert.equal(mocks.runtimeState.turns.acceptedInputs.append.mock.calls.length, 1)
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateProviderRequest.mock.calls
      .map((call) => call[0])
      .some((input) =>
        input.ordinal === 0 &&
        input.turnId === 'turn-1' &&
        input.acceptedInputIds?.join(',') === 'initial,manual-1'
      ),
  ).toBe(false)
})

test('sendAssistantMessageLocal resolves an admitted manual input and rejects a later missed target', async () => {
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

  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    const releaseLiveTurn = providerInput.activeTurnSteering?.registerLiveProviderTurn({
      codexThreadId: 'thread-live',
      interrupt: async () => undefined,
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
        response: 'final after first live input',
        responseDeliveryContextOrdinal: 1,
        transcriptResponse: 'final after first live input',
        session,
      },
    }
  })

  const capture = <T>(promise: Promise<T>) =>
    promise.then(
      (result) => ({ result, status: 'fulfilled' as const }),
      (error: unknown) => ({ error, status: 'rejected' as const }),
    )

  const firstResultPromise = sendAssistantMessageLocal({
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  })
  await providerStarted.promise

  const admittedResultPromise = capture(sendAssistantMessageLocal({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
      directness: 'group',
    },
    expectedActiveTurnId: 'turn-1',
    prompt: 'First admitted',
    vault: '/vaults/test',
  }))
  await vi.waitFor(() => {
    expect(liveSteeredPrompts).toEqual(['First admitted'])
  })

  const missedSteerResultPromise = capture(sendAssistantMessageLocal({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
      directness: 'group',
    },
    expectedActiveTurnId: 'turn-1',
    prompt: 'Second misses close',
    vault: '/vaults/test',
  }))
  expect(liveSteeredPrompts).toEqual(['First admitted'])
  providerRelease.resolve()

  const [firstResult, admittedOutcome, missedSteerOutcome] = await Promise.all([
    firstResultPromise,
    admittedResultPromise,
    missedSteerResultPromise,
  ])

  assert.equal(firstResult.response, 'final after first live input')
  assert.equal(firstResult.prompt, 'First admitted')
  if (admittedOutcome.status !== 'fulfilled') {
    assert.fail('expected admitted active-turn input to resolve')
  }
  assert.equal(admittedOutcome.result.response, 'final after first live input')
  assert.equal(admittedOutcome.result.prompt, 'First admitted')
  if (missedSteerOutcome.status !== 'rejected') {
    assert.fail('expected missed active-turn input to reject')
  }
  expect(missedSteerOutcome.error).toMatchObject({
    code: 'ASSISTANT_ACTIVE_TURN_NOT_ACTIVE',
  })
  expect(liveSteeredPrompts).toEqual(['First admitted'])
  assert.equal(mocks.createAssistantTurnReceipt.mock.calls.length, 1)
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 1)
  assert.equal(mocks.runtimeState.turns.acceptedInputs.append.mock.calls.length, 2)
  expect(
    mocks.runtimeState.turns.acceptedInputs.append.mock.calls[1]?.[0]?.inputs,
  ).toEqual([
      expect.objectContaining({
        id: 'manual-1',
        promptFallbackReason: 'manual-input',
        promptFallbackText: 'First admitted',
        source: 'manual',
      }),
    ])
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateProviderRequest.mock.calls
      .map((call) => call[0])
      .some((input) =>
        input.ordinal === 0 &&
        input.turnId === 'turn-1' &&
        input.acceptedInputIds?.join(',') === 'initial,manual-1'
      ),
  ).toBe(true)
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateProviderRequest.mock.calls
      .map((call) => call[0])
      .some((input) =>
        input.ordinal === 0 &&
        input.turnId === 'turn-1' &&
        input.acceptedInputIds?.join(',') === 'initial,manual-2'
      ),
  ).toBe(false)
})

test('sendAssistantMessageLocal rejects queued targeted input when provider never becomes live', async () => {
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

  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async () => {
    providerStarted.resolve()
    await providerRelease.promise
    return {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        response: 'final without live provider',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'final without live provider',
        session,
      },
    }
  })

  const capture = <T>(promise: Promise<T>) =>
    promise.then(
      (result) => ({ result, status: 'fulfilled' as const }),
      (error: unknown) => ({ error, status: 'rejected' as const }),
    )

  const firstResultPromise = sendAssistantMessageLocal({
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  })
  await providerStarted.promise

  const targetedResultPromise = capture(sendAssistantMessageLocal({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
      directness: 'group',
    },
    expectedActiveTurnId: 'turn-1',
    prompt: 'Cannot be live-steered',
    vault: '/vaults/test',
  }))

  providerRelease.resolve()
  const [firstResult, targetedOutcome] = await Promise.all([
    firstResultPromise,
    targetedResultPromise,
  ])

  assert.equal(firstResult.response, 'final without live provider')
  assert.equal(targetedOutcome.status, 'rejected')
  expect(targetedOutcome.error).toMatchObject({
    code: 'ASSISTANT_ACTIVE_TURN_NOT_ACTIVE',
  })
  assert.equal(mocks.createAssistantTurnReceipt.mock.calls.length, 1)
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 1)
  assert.equal(mocks.runtimeState.turns.acceptedInputs.append.mock.calls.length, 1)
})

test('sendAssistantMessageLocal fails closed when live steering fails', async () => {
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
  const interrupt = vi.fn(async () => undefined)
  const liveSteeredPrompts: string[] = []

  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    await providerInput.onProviderRequestPlanned?.({
      providerAttemptId: null,
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
    })
    const releaseLiveTurn = providerInput.activeTurnSteering?.registerLiveProviderTurn({
      interrupt,
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
    try {
      await providerInput.hostedToolContext?.beforeToolExecution?.(2)
    } finally {
      releaseLiveTurn?.()
    }
    throw new Error('expected live steering failure to abort tool preflight')
  })

  const capture = <T>(promise: Promise<T>) =>
    promise.then(
      (result) => ({ result, status: 'fulfilled' as const }),
      (error: unknown) => ({ error, status: 'rejected' as const }),
    )

  const firstResultPromise = capture(sendAssistantMessageLocal({
    executionContext: {
      hosted: {
        memberId: 'member-hosted',
        userEnvKeys: [],
      },
    },
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  }))
  await providerStarted.promise

  const firstQueuedResultPromise = capture(sendAssistantMessageLocal({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
      directness: 'group',
    },
    expectedActiveTurnId: 'turn-1',
    prompt: 'First follow-up',
    vault: '/vaults/test',
  }))
  await vi.waitFor(() => {
    expect(liveSteeredPrompts).toEqual(['First follow-up'])
  })

  const secondQueuedResultPromise = capture(sendAssistantMessageLocal({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
      directness: 'group',
    },
    expectedActiveTurnId: 'turn-1',
    prompt: 'Second follow-up',
    vault: '/vaults/test',
  }))
  expect(liveSteeredPrompts).toEqual(['First follow-up'])
  providerRelease.resolve()

  const outcomes = await Promise.all([
    firstResultPromise,
    firstQueuedResultPromise,
    secondQueuedResultPromise,
  ])

  expect(outcomes.map((outcome) => outcome.status)).toEqual([
    'rejected',
    'rejected',
    'rejected',
  ])
  for (const outcome of outcomes) {
    assert.equal(outcome.status, 'rejected')
    expect(outcome.error).toMatchObject({
      message: 'steer failed after first input',
    })
  }
  expect(liveSteeredPrompts).toEqual(['First follow-up', 'Second follow-up'])
  expect(interrupt).toHaveBeenCalledTimes(1)
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 1)
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

test('sendAssistantMessageLocal journals live-steered input before terminal provider failure settles', async () => {
  const terminalError = new Error('provider failed after live steer')
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
      attemptCount: 1,
      codexContinuation: {
        kind: 'explicit-structured-history',
      },
      codexThreadId: 'thread-live',
      error: terminalError,
      kind: 'failed_terminal',
      providerRequestOutcome: 'failed',
      providerTurnId: 'turn-live-provider',
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

  const capture = <T>(promise: Promise<T>) =>
    promise.then(
      (result) => ({ result, status: 'fulfilled' as const }),
      (error: unknown) => ({ error, status: 'rejected' as const }),
    )
  const initialResultPromise = capture(sendAssistantMessageLocal({
    prompt: 'Initial prompt',
    vault: '/vaults/test',
  }))
  await providerStarted.promise

  const steeredResultPromise = capture(sendAssistantMessageLocal({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
      directness: 'group',
    },
    expectedActiveTurnId: 'turn-1',
    prompt: 'Failure-path follow-up',
    vault: '/vaults/test',
  }))
  await vi.waitFor(() => {
    expect(liveSteeredPrompts).toEqual(['Failure-path follow-up'])
  })
  providerRelease.resolve()

  const outcomes = await Promise.all([
    initialResultPromise,
    steeredResultPromise,
  ])
  expect(outcomes.map((outcome) => outcome.status)).toEqual([
    'rejected',
    'rejected',
  ])
  for (const outcome of outcomes) {
    assert.equal(outcome.status, 'rejected')
    assert.equal(outcome.error, terminalError)
  }
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 1)
  expect(
    mocks.runtimeState.turns.acceptedInputs.append.mock.calls[1]?.[0]?.inputs,
  ).toEqual([
    expect.objectContaining({
      id: 'manual-1',
      promptFallbackReason: 'manual-input',
      promptFallbackText: 'Failure-path follow-up',
      source: 'manual',
    }),
  ])
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateProviderRequest.mock.calls
      .map((call) => call[0])
      .some((input) =>
        input.ordinal === 0 &&
        input.turnId === 'turn-1' &&
        input.acceptedInputIds?.join(',') === 'initial,manual-1'
      ),
  ).toBe(true)
  expect(
    mocks.recordAssistantUsageEvent.mock.calls[0]?.[0]
      ?.providerRequestAcceptedInputIds,
  ).toEqual(['initial', 'manual-1'])
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
      directness: 'group',
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
      responseDeliveryContextOrdinal: 0,
      transcriptResponse: 'final after steered input',
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
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'new turn response',
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
        directness: 'group',
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
      directness: 'group',
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
      responseDeliveryContextOrdinal: 0,
      transcriptResponse: 'first turn response',
      session,
    },
  })

  const firstResult = await firstResultPromise
  assert.equal(firstResult.response, 'first turn response')
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 2)
})

test('sendAssistantMessageLocal rejects targeted active-turn input when no active turn exists', async () => {
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule()

  await expect(
    sendAssistantMessageLocal({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
        directness: 'group',
      },
      expectedActiveTurnId: 'turn-missing',
      prompt: 'Targeted stale turn',
      vault: '/vaults/test',
    }),
  ).rejects.toMatchObject({
    code: 'ASSISTANT_ACTIVE_TURN_NOT_ACTIVE',
  })
  assert.equal(mocks.createAssistantTurnReceipt.mock.calls.length, 0)
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 0)
})

test('sendAssistantMessageLocal treats input after provider close as a normal next turn', async () => {
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
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'first response',
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
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'second response',
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

  const secondResultPromise = sendAssistantMessageLocal({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
      directness: 'group',
    },
    prompt: 'Arrived after provider close',
    vault: '/vaults/test',
  })

  assert.equal(mocks.createAssistantTurnReceipt.mock.calls.length, 1)

  commitRelease.resolve()
  const [firstResult, secondResult] = await Promise.all([
    firstResultPromise,
    secondResultPromise,
  ])
  assert.equal(firstResult.response, 'first response')
  assert.equal(secondResult.response, 'second response')
  assert.equal(mocks.createAssistantTurnReceipt.mock.calls.length, 2)
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 2)
  assert.equal(
    mocks.executeCodexTurnWithRecovery.mock.calls[1]?.[0]?.input.prompt,
    'Arrived after provider close',
  )
  assert.equal(activeTurnInput.mock.calls.length, 1)
  assert.equal(activeTurnCheckpoint.mock.calls.length, 0)
})

test('sendAssistantMessageLocal commits only the selected held-group result', async () => {
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
  const {
    mocks,
    resetAcceptedInputJournal,
    sendAssistantMessageLocal,
  } = await loadLocalServiceModule({
    plan: { ...sharedPlan, persistUserPromptOnFailure: false },
    session,
  })
  type SendInput = Parameters<typeof sendAssistantMessageLocal>[0]
  const groupConversation = {
    channel: 'telegram',
    directness: 'group' as const,
    identityId: 'identity-1',
    threadId: 'thread-1',
  }
  const progressDeliveryDependencies = {
    sendTelegram: vi.fn(async () => ({
      providerMessageId: 'telegram-progress-message',
      providerThreadId: 'thread-1',
      target: 'thread-1',
      targetKind: 'thread' as const,
    })),
  }
  const capture = <T>(promise: Promise<T>) =>
    promise.then(
      (result) => ({ result, status: 'fulfilled' as const }),
      (error: unknown) => ({ error, status: 'rejected' as const }),
    )
  const resetScenario = () => {
    resetAcceptedInputJournal()
    mocks.appendAssistantTranscriptEntries.mockClear()
    mocks.appendAssistantTranscriptEntriesWithRefs.mockClear()
    mocks.appendAssistantTurnReceiptEvent.mockClear()
    mocks.applyAssistantSessionCodexResumeStateAction.mockClear()
    mocks.clearAssistantSessionCodexResumeState.mockClear()
    mocks.executeCodexTurnWithRecovery.mockReset()
    mocks.deliverAssistantPrecedingReplies.mockClear()
    mocks.deliverAssistantProgressUpdate.mockClear()
    mocks.deliverAssistantReaction.mockClear()
    mocks.dispatchAssistantReply.mockClear()
    mocks.finalizeAssistantTurnArtifacts.mockClear()
    mocks.finalizeAssistantTurnReceipt.mockClear()
    mocks.persistFailedAssistantPromptAttempt.mockClear()
    mocks.recordAdditionalAssistantUsageEvents.mockClear()
    mocks.recordAssistantUsageEvent.mockClear()
    mocks.resolveAssistantAcceptedMessageTarget.mockClear()
    mocks.saveAssistantSession.mockClear()
    mocks.runtimeState.turns.acceptedInputs.updateAdmissionState.mockClear()
    mocks.runtimeState.turns.acceptedInputs.updateTranscriptRefs.mockClear()
  }
  const addFirstDraft = (
    ready: Deferred<void>,
    providerThreadId: string,
  ) => {
    mocks.executeCodexTurnWithRecovery.mockImplementationOnce(
      async (providerInput) => {
        await providerInput.onProviderRequestPlanned?.({
          providerAttemptId: 'attempt-0',
          codexContinuation: { kind: 'explicit-structured-history' },
        })
        providerInput.activeTurnSteering?.onFirstAssistantResponseCompleted()
        ready.resolve()
        return {
          kind: 'succeeded',
          providerTurn: {
            additionalUsages: [
              {
                occurredAt: '2026-08-20T20:00:01.000Z',
                provider: 'openai-image',
                providerRequestOrdinal: 1,
                providerRequestOutcome: 'succeeded',
                usage: createProviderUsage({ providerRequestId: 'image-usage' }),
              },
              {
                occurredAt: '2026-08-20T20:00:02.000Z',
                provider: 'codex-subagent',
                providerRequestOrdinal: 2,
                providerRequestOutcome: 'succeeded',
                usage: createProviderUsage({ providerRequestId: 'child-usage' }),
              },
            ],
            onboardingGuidanceInjected: true,
            attemptCount: 1,
            codexContinuation: { kind: 'explicit-structured-history' },
            codexThreadId: providerThreadId,
            precedingResponseSegments: [{
              deliveryContextOrdinal: 0,
              media: [],
              response: 'Provisional segment.',
            }],
            response: 'The stale draft.',
            responseDeliveryContextOrdinal: 0,
            provider: 'codex-cli',
            providerOptions: session.providerOptions,
            route: { routeId: 'route-group-review' },
            session,
            transcriptResponse: 'The stale draft.',
            usage: createProviderUsage({ providerRequestId: 'request-0' }),
          },
        }
      },
    )
  }
  const startHeldTurn = async (input: {
    activeTurnCheckpoint?: NonNullable<SendInput['activeTurnCheckpoint']>
    firstDraftReady: Deferred<void>
    latePrompt: string
    onFinishWithoutReplyAccepted?: NonNullable<
      SendInput['onFinishWithoutReplyAccepted']
    >
  }) => {
    const initial = capture(sendAssistantMessageLocal({
      ...(input.activeTurnCheckpoint
        ? { activeTurnCheckpoint: input.activeTurnCheckpoint }
        : {}),
      activeTurnInput: async () => ({ kind: 'no-new-input' }),
      conversation: groupConversation,
      deliverResponse: true,
      executionContext: {
        hosted: {
          memberId: 'member-hosted',
          progressDeliveryDependencies,
          userEnvKeys: [],
        },
      },
      ...(input.onFinishWithoutReplyAccepted
        ? {
            onFinishWithoutReplyAccepted:
              input.onFinishWithoutReplyAccepted,
          }
        : {}),
      prompt: 'Initial group message',
      turnTrigger: 'automation-auto-reply',
      vault: '/vaults/test',
    }))
    await input.firstDraftReady.promise
    const late = capture(sendAssistantMessageLocal({
      conversation: groupConversation,
      expectedActiveTurnId: 'turn-1',
      prompt: input.latePrompt,
      vault: '/vaults/test',
    }))
    await vi.advanceTimersByTimeAsync(4_000)
    return { initial, late }
  }

  vi.useFakeTimers()
  for (const scenario of [
    {
      finalResponse: 'The stale draft.',
      liveSteer: true,
    },
    {
      finalResponse: 'The updated final reply.',
      liveSteer: false,
    },
  ]) {
    resetScenario()
    const firstDraftReady = createDeferred<void>()
    const reconsiderationStarted = createDeferred<void>()
    const reconsiderationRelease = createDeferred<void>()
    const reconsiderationSteers: string[] = []
    const activeTurnCheckpoint = vi.fn(
      async (_input: AssistantActiveTurnInputCheckpointInput) => undefined,
    )
    addFirstDraft(firstDraftReady, 'provider-thread-group-review')
    mocks.executeCodexTurnWithRecovery.mockImplementationOnce(
      async (providerInput) => {
        await providerInput.onProviderRequestPlanned?.({
          providerAttemptId: 'attempt-1',
          codexContinuation: { kind: 'explicit-structured-history' },
        })
        const releaseLiveTurn = scenario.liveSteer
          ? providerInput.activeTurnSteering?.registerLiveProviderTurn({
              interrupt: async () => undefined,
              codexThreadId: 'provider-thread-group-review',
              providerTurnId: 'provider-turn-group-review-1',
              sessionId: session.sessionId,
              steer: async (steerInput) => {
                reconsiderationSteers.push(steerInput.prompt)
              },
              turnId: 'turn-1',
            })
          : undefined
        reconsiderationStarted.resolve()
        await reconsiderationRelease.promise
        if (scenario.liveSteer) {
          await providerInput.progressDelivery?.send(
            'Replying to the late message.',
            {
              deliveryContextOrdinal: 0,
              required: true,
              source: 'system',
              targetInputId: 'manual-1',
            },
          )
          await providerInput.progressDelivery?.send(
            'Replying to the live-steered message.',
            {
              deliveryContextOrdinal: 1,
              required: true,
              source: 'system',
              targetInputId: 'manual-2',
            },
          )
        }
        providerInput.activeTurnSteering?.onFirstAssistantResponseCompleted()
        releaseLiveTurn?.()
        return {
          kind: 'succeeded',
          providerTurn: {
            additionalUsages: [{
              occurredAt: '2026-08-20T20:00:03.000Z',
              provider: 'request-1-tool',
              providerRequestOrdinal: 2,
              providerRequestOutcome: 'succeeded',
              usage: createProviderUsage({ providerRequestId: 'request-1-tool' }),
            }],
            onboardingGuidanceInjected: true,
            attemptCount: 1,
            codexContinuation: { kind: 'explicit-structured-history' },
            codexThreadId: 'provider-thread-group-review',
            precedingResponseSegments: [{
              deliveryContextOrdinal: 0,
              media: [],
              response: 'Selected completed segment.',
            }],
            provider: 'codex-cli',
            providerOptions: session.providerOptions,
            response: scenario.finalResponse,
            responseDeliveryContextOrdinal: scenario.liveSteer ? 1 : 0,
            route: { routeId: 'route-group-review' },
            session,
            transcriptResponse: scenario.finalResponse,
            usage: createProviderUsage({ providerRequestId: 'request-1' }),
          },
        }
      },
    )
    const turn = await startHeldTurn({
      activeTurnCheckpoint,
      firstDraftReady,
      latePrompt: 'Actually, plans changed.',
    })
    await reconsiderationStarted.promise
    const live = scenario.liveSteer
      ? capture(sendAssistantMessageLocal({
          conversation: groupConversation,
          expectedActiveTurnId: 'turn-1',
          prompt: 'One more group detail.',
          vault: '/vaults/test',
        }))
      : null
    if (live) {
      await vi.waitFor(() => {
        expect(reconsiderationSteers).toEqual(['One more group detail.'])
      })
    }
    reconsiderationRelease.resolve()

    const outcomes = await Promise.all([
      turn.initial,
      turn.late,
      ...(live ? [live] : []),
    ])
    expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true)
    for (const outcome of outcomes) {
      assert.equal(outcome.status, 'fulfilled')
      expect(outcome.result).toMatchObject({
        prompt: scenario.liveSteer
          ? [
              'Initial group message',
              'Actually, plans changed.',
              'One more group detail.',
            ].join('\n\n')
          : 'Initial group message\n\nActually, plans changed.',
        response: scenario.finalResponse,
      })
    }
    expect(
      mocks.executeCodexTurnWithRecovery.mock.calls.map(
        ([providerInput]) => providerInput.providerRequestOrdinal,
      ),
    ).toEqual([0, 1])
    expect(
      mocks.executeCodexTurnWithRecovery.mock.calls[1]?.[0]?.input,
    ).toMatchObject({
      prompt: 'Initial group message\n\nActually, plans changed.',
      turnContext: expect.stringContaining(
        'The unsent draft neither answers a request nor keeps Murph\'s floor; the latest accepted message decides who owns the updated beat.',
      ),
    })
    expect(
      mocks.executeCodexTurnWithRecovery.mock.calls[1]?.[0]?.input.turnContext,
    ).not.toContain('previous response was held')
    expect(
      mocks.executeCodexTurnWithRecovery.mock.calls[1]?.[0]?.resolvedSession
        ?.resumeState,
    ).toMatchObject({
      routeFingerprint: 'route-group-review',
      threadId: 'provider-thread-group-review',
    })
    expect(activeTurnCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ providerRequestOrdinal: 1 }),
    )
    expect(mocks.finalizeAssistantTurnArtifacts).toHaveBeenCalledOnce()
    expect(mocks.clearAssistantSessionCodexResumeState).toHaveBeenCalledWith({
      session: expect.objectContaining({
        sessionId: session.sessionId,
      }),
      vault: '/vaults/test',
    })
    expect(mocks.finalizeAssistantTurnArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        precedingAssistantTranscriptTexts: [],
        providerResumeStateAction: 'clear',
      }),
    )
    expect(
      mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]?.providerResult,
    ).toMatchObject({
      precedingResponseSegments: [],
      response: scenario.finalResponse,
      responseDeliveryContextOrdinal: scenario.liveSteer ? 2 : 1,
    })
    expect(mocks.deliverAssistantPrecedingReplies).toHaveBeenCalledWith(
      expect.objectContaining({ segments: [] }),
    )
    expect(mocks.dispatchAssistantReply).toHaveBeenCalledOnce()
    expect(mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.response).toBe(
      scenario.finalResponse,
    )
    expect(
      mocks.runtimeState.turns.acceptedInputs.updateAdmissionState,
    ).toHaveBeenCalledOnce()
    if (scenario.liveSteer) {
      expect(mocks.resolveAssistantAcceptedMessageTarget).toHaveBeenCalledWith(
        expect.objectContaining({
          acceptedInputIds: ['initial', 'manual-1'],
          action: 'native-reply',
          messageRef: 'manual-1',
        }),
      )
      expect(mocks.resolveAssistantAcceptedMessageTarget).toHaveBeenCalledWith(
        expect.objectContaining({
          acceptedInputIds: ['initial', 'manual-1', 'manual-2'],
          action: 'native-reply',
          messageRef: 'manual-2',
        }),
      )
      expect(mocks.deliverAssistantProgressUpdate).toHaveBeenCalledTimes(2)
    }
    expect(
      mocks.recordAssistantUsageEvent.mock.calls.map(
        ([usageInput]) => usageInput.providerRequestOrdinal,
      ),
    ).toEqual([0, 3])
    expect(
      mocks.recordAdditionalAssistantUsageEvents.mock.calls.map(
        ([usageInput]) =>
          usageInput.additionalUsages?.map(
            (usage) => usage.providerRequestOrdinal,
          ),
      ),
    ).toEqual([[1, 2], [4]])
    const canonicalUsageIds = [0, 1, 2, 3, 4].map(
      (providerRequestOrdinal) => createAssistantUsageId({
        attemptCount: 1,
        providerRequestOrdinal,
        turnId: 'turn-1',
      }),
    )
    expect(new Set(canonicalUsageIds).size).toBe(canonicalUsageIds.length)
  }

  resetScenario()
  const quietDraftReady = createDeferred<void>()
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(
    async (providerInput) => {
      await providerInput.onProviderRequestPlanned?.({
        providerAttemptId: 'attempt-0',
        codexContinuation: { kind: 'explicit-structured-history' },
      })
      providerInput.activeTurnSteering?.onFirstAssistantResponseCompleted()
      quietDraftReady.resolve()
      return {
        kind: 'succeeded',
        providerTurn: {
          onboardingGuidanceInjected: true,
          codexContinuation: { kind: 'explicit-structured-history' },
          codexThreadId: 'provider-thread-group-quiet',
          precedingResponseSegments: [{
            deliveryContextOrdinal: 0,
            media: [{
              alt: 'Selected quiet segment image',
              kind: 'image',
              source: null,
              url: 'https://cdn.example.test/selected-quiet.png',
            }],
            response: 'Selected quiet segment.',
          }],
          response: 'Selected quiet final reply.',
          responseDeliveryContextOrdinal: 0,
          route: { routeId: 'route-group-review' },
          session,
          transcriptResponse: 'Selected quiet final reply.',
        },
      }
    },
  )
  const quietDraft = capture(sendAssistantMessageLocal({
    activeTurnInput: async () => ({ kind: 'no-new-input' }),
    conversation: groupConversation,
    deliverResponse: true,
    prompt: 'Quiet group message',
    turnTrigger: 'automation-auto-reply',
    vault: '/vaults/test',
  }))
  await quietDraftReady.promise
  await vi.advanceTimersByTimeAsync(4_000)
  const quietDraftOutcome = await quietDraft
  assert.equal(quietDraftOutcome.status, 'fulfilled')
  expect(quietDraftOutcome.result.response).toBe('Selected quiet final reply.')
  expect(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]?.providerResult,
  ).toMatchObject({
    precedingResponseSegments: [],
  })
  expect(mocks.deliverAssistantPrecedingReplies).toHaveBeenCalledWith(
    expect.objectContaining({ segments: [] }),
  )
  expect(mocks.dispatchAssistantReply).toHaveBeenCalledOnce()
  expect(mocks.clearAssistantSessionCodexResumeState).not.toHaveBeenCalled()
  expect(mocks.finalizeAssistantTurnArtifacts).toHaveBeenCalledWith(
    expect.objectContaining({
      providerResumeStateAction: 'persist-from-provider-turn',
    }),
  )

  resetScenario()
  const silenceDraftReady = createDeferred<void>()
  const noReplyAccepted = vi.fn(async () => undefined)
  addFirstDraft(silenceDraftReady, 'provider-thread-group-silence')
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(
    async (providerInput) => {
      await providerInput.onProviderRequestPlanned?.({
        providerAttemptId: 'attempt-1',
        codexContinuation: { kind: 'explicit-structured-history' },
      })
      await providerInput.onFinishWithoutReplyAccepted?.({
        deliveryContextOrdinal: 0,
        messageReactionPending: true,
      })
      return {
        kind: 'succeeded',
        providerTurn: {
          acceptedNoReplyDeliveryContextOrdinals: [0],
          onboardingGuidanceInjected: true,
          codexContinuation: { kind: 'explicit-structured-history' },
          codexThreadId: 'provider-thread-group-silence',
          finalAction: { kind: 'none' },
          reactions: [{
            deliveryContextOrdinal: 0,
            reaction: 'thumbs_up',
            targetInputId: 'manual-1',
          }],
          response: 'This contradictory text must not escape.',
          responseDeliveryContextOrdinal: 0,
          responseMedia: [{
            alt: 'provisional image',
            kind: 'image',
            source: null,
            url: 'https://cdn.example.test/provisional.png',
          }],
          route: { routeId: 'route-group-review' },
          session,
          transcriptResponse: 'This contradictory text must not escape.',
        },
      }
    },
  )
  const silenceTurn = await startHeldTurn({
    firstDraftReady: silenceDraftReady,
    latePrompt: 'A human already answered.',
    onFinishWithoutReplyAccepted: noReplyAccepted,
  })
  const silenceOutcomes = await Promise.all([
    silenceTurn.initial,
    silenceTurn.late,
  ])
  expect(silenceOutcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(
    true,
  )
  for (const outcome of silenceOutcomes) {
    assert.equal(outcome.status, 'fulfilled')
    expect(outcome.result).toMatchObject({
      response: '',
      responseDisposition: 'none',
    })
  }
  expect(noReplyAccepted).toHaveBeenCalledOnce()
  expect(noReplyAccepted).toHaveBeenCalledWith({
    acceptedInputIds: ['initial', 'manual-1'],
    deliveryContextOrdinal: 1,
    messageReactionPending: true,
  })
  expect(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]?.providerResult,
  ).toMatchObject({
    acceptedNoReplyDeliveryContextOrdinals: [1],
    precedingResponseSegments: [],
    reactions: [{ deliveryContextOrdinal: 1, reaction: 'thumbs_up' }],
    response: '',
    responseDeliveryContextOrdinal: 1,
    responseMedia: [],
    transcriptResponse: null,
  })
  expect(mocks.deliverAssistantReaction).toHaveBeenCalledOnce()
  expect(mocks.dispatchAssistantReply).not.toHaveBeenCalled()

  resetScenario()
  const abortedSilenceDraftReady = createDeferred<void>()
  const abortController = new AbortController()
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(
    async (providerInput) => {
      await providerInput.onProviderRequestPlanned?.({
        providerAttemptId: 'attempt-0',
        codexContinuation: { kind: 'explicit-structured-history' },
      })
      await providerInput.onFinishWithoutReplyAccepted?.({
        deliveryContextOrdinal: 0,
        messageReactionPending: false,
      })
      abortedSilenceDraftReady.resolve()
      return {
        kind: 'succeeded',
        providerTurn: {
          acceptedNoReplyDeliveryContextOrdinals: [0],
          onboardingGuidanceInjected: true,
          codexContinuation: { kind: 'explicit-structured-history' },
          codexThreadId: 'provider-thread-group-aborted-silence',
          finalAction: { kind: 'none' },
          response: '',
          responseDeliveryContextOrdinal: 0,
          route: { routeId: 'route-group-review' },
          session,
          transcriptResponse: null,
        },
      }
    },
  )
  const abortedSilence = capture(sendAssistantMessageLocal({
    abortSignal: abortController.signal,
    activeTurnInput: async () => ({ kind: 'no-new-input' }),
    conversation: groupConversation,
    deliverResponse: true,
    prompt: 'Initial human-owned group beat',
    turnTrigger: 'automation-auto-reply',
    vault: '/vaults/test',
  }))
  await abortedSilenceDraftReady.promise
  expect(mocks.appendAssistantTranscriptEntriesWithRefs).not.toHaveBeenCalled()
  expect(mocks.appendAssistantTurnReceiptEvent).not.toHaveBeenCalled()
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateTranscriptRefs,
  ).not.toHaveBeenCalled()
  abortController.abort()
  const abortedSilenceOutcome = await abortedSilence
  assert.equal(abortedSilenceOutcome.status, 'rejected')
  expect(mocks.appendAssistantTranscriptEntriesWithRefs).not.toHaveBeenCalled()
  expect(mocks.appendAssistantTurnReceiptEvent).not.toHaveBeenCalled()
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateTranscriptRefs,
  ).not.toHaveBeenCalled()

  resetScenario()
  const quietSilenceDraftReady = createDeferred<void>()
  const quietNoReplyAccepted = vi.fn(async () => undefined)
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(
    async (providerInput) => {
      await providerInput.onProviderRequestPlanned?.({
        providerAttemptId: 'attempt-0',
        codexContinuation: { kind: 'explicit-structured-history' },
      })
      await providerInput.onFinishWithoutReplyAccepted?.({
        deliveryContextOrdinal: 0,
        messageReactionPending: false,
      })
      quietSilenceDraftReady.resolve()
      return {
        kind: 'succeeded',
        providerTurn: {
          acceptedNoReplyDeliveryContextOrdinals: [0],
          onboardingGuidanceInjected: true,
          codexContinuation: { kind: 'explicit-structured-history' },
          codexThreadId: 'provider-thread-group-quiet-silence',
          finalAction: { kind: 'none' },
          response: 'This contradictory text must remain provisional.',
          responseDeliveryContextOrdinal: 0,
          route: { routeId: 'route-group-review' },
          session,
          transcriptResponse: 'This contradictory text must remain provisional.',
        },
      }
    },
  )
  const quietSilence = capture(sendAssistantMessageLocal({
    activeTurnInput: async () => ({ kind: 'no-new-input' }),
    conversation: groupConversation,
    deliverResponse: true,
    onFinishWithoutReplyAccepted: quietNoReplyAccepted,
    prompt: 'Initial human-owned group beat',
    turnTrigger: 'automation-auto-reply',
    vault: '/vaults/test',
  }))
  await quietSilenceDraftReady.promise
  expect(quietNoReplyAccepted).not.toHaveBeenCalled()
  expect(mocks.finalizeAssistantTurnArtifacts).not.toHaveBeenCalled()
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateAdmissionState,
  ).not.toHaveBeenCalled()
  expect(mocks.appendAssistantTranscriptEntriesWithRefs).not.toHaveBeenCalled()
  expect(mocks.appendAssistantTurnReceiptEvent).not.toHaveBeenCalled()
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateTranscriptRefs,
  ).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(4_000)
  const quietSilenceOutcome = await quietSilence
  assert.equal(quietSilenceOutcome.status, 'fulfilled')
  expect(quietSilenceOutcome.result).toMatchObject({
    response: '',
    responseDisposition: 'none',
  })
  expect(quietNoReplyAccepted).toHaveBeenCalledOnce()
  expect(mocks.finalizeAssistantTurnArtifacts).toHaveBeenCalledOnce()
  expect(mocks.dispatchAssistantReply).not.toHaveBeenCalled()
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateAdmissionState,
  ).toHaveBeenCalledOnce()
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateAdmissionState.mock
      .invocationCallOrder[0],
  ).toBeLessThan(quietNoReplyAccepted.mock.invocationCallOrder[0]!)
  expect(mocks.appendAssistantTranscriptEntriesWithRefs).toHaveBeenCalledOnce()
  expect(mocks.appendAssistantTranscriptEntriesWithRefs).toHaveBeenCalledWith(
    '/vaults/test',
    session.sessionId,
    [expect.objectContaining({
      kind: 'user',
      text: 'Initial human-owned group beat',
    })],
  )
  expect(mocks.appendAssistantTurnReceiptEvent).toHaveBeenCalledOnce()
  expect(mocks.appendAssistantTurnReceiptEvent).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'user.persisted' }),
  )
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateTranscriptRefs,
  ).toHaveBeenCalledOnce()

  resetScenario()
  const initialFailure = new Error('initial provider failed after no reply')
  const initialFailedNoReplyAccepted = vi.fn(async () => undefined)
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(
    async (providerInput) => {
      await providerInput.onProviderRequestPlanned?.({
        providerAttemptId: 'attempt-0',
        codexContinuation: { kind: 'explicit-structured-history' },
      })
      await providerInput.onFinishWithoutReplyAccepted?.({
        deliveryContextOrdinal: 0,
        messageReactionPending: false,
      })
      return {
        acceptedNoReplyDeliveryContextOrdinals: [0],
        attemptCount: 1,
        codexContinuation: { kind: 'explicit-structured-history' },
        codexThreadId: 'provider-thread-group-initial-failure',
        error: initialFailure,
        kind: 'failed_terminal',
        providerRequestOutcome: 'failed',
        providerTurnId: 'provider-turn-group-initial-failure',
        rawEvents: [],
        route: {
          provider: 'codex-cli',
          providerOptions: { model: 'gpt-5.4' },
          routeId: 'route-group-initial-failure',
        },
        session,
        usage: null,
        usageAttribution: null,
      }
    },
  )
  const initialFailureOutcome = await capture(sendAssistantMessageLocal({
    activeTurnInput: async () => ({ kind: 'no-new-input' }),
    conversation: groupConversation,
    deliverResponse: true,
    onFinishWithoutReplyAccepted: initialFailedNoReplyAccepted,
    prompt: 'Initial group message',
    turnTrigger: 'automation-auto-reply',
    vault: '/vaults/test',
  }))
  assert.equal(initialFailureOutcome.status, 'rejected')
  assert.equal(initialFailureOutcome.error, initialFailure)
  expect(initialFailedNoReplyAccepted).not.toHaveBeenCalled()
  expect(mocks.finalizeAssistantTurnArtifacts).not.toHaveBeenCalled()
  expect(mocks.dispatchAssistantReply).not.toHaveBeenCalled()
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateAdmissionState,
  ).not.toHaveBeenCalled()
  expect(mocks.appendAssistantTranscriptEntriesWithRefs).not.toHaveBeenCalled()
  expect(mocks.appendAssistantTurnReceiptEvent).not.toHaveBeenCalled()
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateTranscriptRefs,
  ).not.toHaveBeenCalled()

  resetScenario()
  const failureDraftReady = createDeferred<void>()
  const terminalError = new Error('reconsideration provider failed')
  const failedNoReplyAccepted = vi.fn(async () => undefined)
  addFirstDraft(failureDraftReady, 'provider-thread-group-failure')
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(
    async (providerInput) => {
      await providerInput.onProviderRequestPlanned?.({
        providerAttemptId: 'attempt-1',
        codexContinuation: { kind: 'explicit-structured-history' },
      })
      await providerInput.onFinishWithoutReplyAccepted?.({
        deliveryContextOrdinal: 0,
        messageReactionPending: false,
      })
      return {
        acceptedNoReplyDeliveryContextOrdinals: [0],
        attemptCount: 1,
        codexContinuation: { kind: 'explicit-structured-history' },
        codexThreadId: 'provider-thread-group-failure',
        error: terminalError,
        kind: 'failed_terminal',
        providerRequestOutcome: 'failed',
        providerTurnId: 'provider-turn-group-failure',
        rawEvents: [],
        route: {
          provider: 'codex-cli',
          providerOptions: { model: 'gpt-5.4' },
          routeId: 'route-group-failure',
        },
        session,
        usage: null,
        usageAttribution: null,
      }
    },
  )
  const failureTurn = await startHeldTurn({
    firstDraftReady: failureDraftReady,
    latePrompt: 'New group input',
    onFinishWithoutReplyAccepted: failedNoReplyAccepted,
  })
  const failureOutcomes = await Promise.all([
    failureTurn.initial,
    failureTurn.late,
  ])
  expect(failureOutcomes.every((outcome) => outcome.status === 'rejected')).toBe(
    true,
  )
  for (const outcome of failureOutcomes) {
    assert.equal(outcome.status, 'rejected')
    assert.equal(outcome.error, terminalError)
  }
  expect(mocks.executeCodexTurnWithRecovery).toHaveBeenCalledTimes(2)
  expect(
    mocks.applyAssistantSessionCodexResumeStateAction,
  ).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'preserve-existing',
      codexThreadId: 'provider-thread-group-failure',
      session: expect.objectContaining({ sessionId: session.sessionId }),
    }),
  )
  expect(mocks.clearAssistantSessionCodexResumeState).toHaveBeenCalledWith({
    session: expect.objectContaining({ sessionId: session.sessionId }),
    vault: '/vaults/test',
  })
  expect(failedNoReplyAccepted).not.toHaveBeenCalled()
  expect(mocks.finalizeAssistantTurnArtifacts).not.toHaveBeenCalled()
  expect(mocks.dispatchAssistantReply).not.toHaveBeenCalled()
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateAdmissionState,
  ).not.toHaveBeenCalled()
  expect(mocks.appendAssistantTranscriptEntriesWithRefs).not.toHaveBeenCalled()
  expect(
    mocks.appendAssistantTurnReceiptEvent.mock.calls
      .map(([event]) => event.kind)
      .filter((kind) => kind === 'user.persisted'),
  ).toEqual([])
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateTranscriptRefs,
  ).not.toHaveBeenCalled()
  expect(mocks.finalizeAssistantTurnReceipt).toHaveBeenCalledWith(
    expect.objectContaining({ response: null, status: 'failed' }),
  )

  resetScenario()
  const checkpointDraftReady = createDeferred<void>()
  const checkpointError = new Error(
    'reconsideration checkpoint rejected after the draft',
  )
  const warmResumeState = {
    routeFingerprint: 'route-group-checkpoint-failure',
    threadId: 'provider-thread-group-checkpoint-failure',
  }
  const warmSession: AssistantSession = {
    ...session,
    codexResume: warmResumeState,
    resumeState: warmResumeState,
  }
  const rejectingCheckpoint = vi.fn(
    async (_input: AssistantActiveTurnInputCheckpointInput) => {
      throw checkpointError
    },
  )
  mocks.clearAssistantSessionCodexResumeState.mockImplementationOnce(
    async (clearInput) => {
      const clearedSession = {
        ...clearInput.session,
        codexResume: null,
        resumeState: null,
      }
      await mocks.saveAssistantSession(clearInput.vault, clearedSession)
      return clearedSession
    },
  )
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(
    async (providerInput) => {
      await providerInput.onProviderRequestPlanned?.({
        providerAttemptId: 'attempt-0',
        codexContinuation: { kind: 'explicit-structured-history' },
      })
      providerInput.activeTurnSteering?.onFirstAssistantResponseCompleted()
      checkpointDraftReady.resolve()
      return {
        kind: 'succeeded',
        providerTurn: {
          onboardingGuidanceInjected: true,
          attemptCount: 1,
          codexContinuation: { kind: 'explicit-structured-history' },
          codexThreadId: warmResumeState.threadId,
          provider: 'codex-cli',
          providerOptions: session.providerOptions,
          response: 'The checkpoint draft.',
          responseDeliveryContextOrdinal: 0,
          route: { routeId: warmResumeState.routeFingerprint },
          session: warmSession,
          transcriptResponse: 'The checkpoint draft.',
          usage: createProviderUsage({ providerRequestId: 'request-0' }),
        },
      }
    },
  )
  const checkpointTurn = await startHeldTurn({
    activeTurnCheckpoint: rejectingCheckpoint,
    firstDraftReady: checkpointDraftReady,
    latePrompt: 'New group input before checkpoint',
  })
  const checkpointOutcomes = await Promise.all([
    checkpointTurn.initial,
    checkpointTurn.late,
  ])
  expect(
    checkpointOutcomes.every((outcome) => outcome.status === 'rejected'),
  ).toBe(true)
  for (const outcome of checkpointOutcomes) {
    assert.equal(outcome.status, 'rejected')
    assert.equal(outcome.error, checkpointError)
  }
  expect(rejectingCheckpoint).toHaveBeenCalledWith(
    expect.objectContaining({ providerRequestOrdinal: 1 }),
  )
  expect(mocks.executeCodexTurnWithRecovery).toHaveBeenCalledOnce()
  expect(mocks.clearAssistantSessionCodexResumeState).toHaveBeenCalledWith({
    session: expect.objectContaining({
      codexResume: null,
      resumeState: null,
    }),
    vault: '/vaults/test',
  })
  expect(mocks.saveAssistantSession.mock.calls.at(-1)?.[1]).toMatchObject({
    codexResume: null,
    resumeState: null,
  })
  expect(
    mocks.persistFailedAssistantPromptAttempt.mock.calls[0]?.[0]?.session,
  ).toMatchObject({
    codexResume: null,
    resumeState: null,
  })
  expect(mocks.finalizeAssistantTurnArtifacts).not.toHaveBeenCalled()
  expect(mocks.dispatchAssistantReply).not.toHaveBeenCalled()
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateAdmissionState,
  ).not.toHaveBeenCalled()
  expect(mocks.appendAssistantTranscriptEntriesWithRefs).not.toHaveBeenCalled()

  resetScenario()
  const postProgressDraftReady = createDeferred<void>()
  const postProgressError = new Error(
    'reconsideration usage recording failed after progress',
  )
  const postProgressClearError = new Error(
    'reconsideration durable clear failed',
  )
  addFirstDraft(
    postProgressDraftReady,
    'provider-thread-group-post-progress-failure',
  )
  mocks.recordAssistantUsageEvent
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(postProgressError)
  mocks.deliverAssistantProgressUpdate.mockImplementationOnce(
    async (progressInput) => ({
      ...progressInput.session,
      updatedAt: '2026-08-20T20:00:04.000Z',
    }),
  )
  mocks.clearAssistantSessionCodexResumeState.mockRejectedValueOnce(
    postProgressClearError,
  )
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(
    async (providerInput) => {
      await providerInput.onProviderRequestPlanned?.({
        providerAttemptId: 'attempt-1',
        codexContinuation: { kind: 'explicit-structured-history' },
      })
      await providerInput.progressDelivery?.send(
        'Working through the accepted group messages.',
        {
          deliveryContextOrdinal: 0,
          required: true,
          source: 'system',
          targetInputId: 'manual-1',
        },
      )
      return {
        kind: 'succeeded',
        providerTurn: {
          onboardingGuidanceInjected: true,
          attemptCount: 1,
          codexContinuation: { kind: 'explicit-structured-history' },
          codexThreadId: 'provider-thread-group-post-progress-failure',
          provider: 'codex-cli',
          providerOptions: session.providerOptions,
          response: 'This response must not be finalized.',
          responseDeliveryContextOrdinal: 0,
          route: { routeId: 'route-group-review' },
          session: providerInput.resolvedSession,
          transcriptResponse: 'This response must not be finalized.',
          usage: createProviderUsage({ providerRequestId: 'request-1' }),
        },
      }
    },
  )
  const postProgressTurn = await startHeldTurn({
    firstDraftReady: postProgressDraftReady,
    latePrompt: 'New group input before delivery',
  })
  const postProgressOutcomes = await Promise.all([
    postProgressTurn.initial,
    postProgressTurn.late,
  ])
  expect(
    postProgressOutcomes.every((outcome) => outcome.status === 'rejected'),
  ).toBe(true)
  for (const outcome of postProgressOutcomes) {
    assert.equal(outcome.status, 'rejected')
    assert.equal(outcome.error, postProgressError)
  }
  expect(mocks.deliverAssistantProgressUpdate).toHaveBeenCalledOnce()
  expect(mocks.clearAssistantSessionCodexResumeState).toHaveBeenCalledWith({
    session: expect.objectContaining({
      codexResume: null,
      resumeState: null,
      updatedAt: '2026-08-20T20:00:04.000Z',
    }),
    vault: '/vaults/test',
  })
  const savedPostProgressSession =
    mocks.saveAssistantSession.mock.calls.at(-1)?.[1]
  expect(savedPostProgressSession).toMatchObject({
    codexResume: null,
    resumeState: null,
  })
  expect(
    mocks.saveAssistantSession.mock.calls.every(([, savedSession]) =>
      savedSession.codexResume === null && savedSession.resumeState === null
    ),
  ).toBe(true)
  expect(
    mocks.persistFailedAssistantPromptAttempt.mock.calls[0]?.[0]?.session,
  ).toMatchObject({
    codexResume: null,
    resumeState: null,
  })
  expect(mocks.finalizeAssistantTurnArtifacts).not.toHaveBeenCalled()
  expect(mocks.dispatchAssistantReply).not.toHaveBeenCalled()
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateAdmissionState,
  ).not.toHaveBeenCalled()
  expect(mocks.appendAssistantTranscriptEntriesWithRefs).not.toHaveBeenCalled()
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateTranscriptRefs,
  ).not.toHaveBeenCalled()

  resetScenario()
  const retryDraftReady = createDeferred<void>()
  const retryNoReplyAccepted = vi.fn(async () => undefined)
  addFirstDraft(retryDraftReady, 'provider-thread-group-retry')
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(
    async (providerInput) => {
      await providerInput.onProviderRequestPlanned?.({
        providerAttemptId: 'attempt-1',
        codexContinuation: { kind: 'explicit-structured-history' },
      })
      await providerInput.onFinishWithoutReplyAccepted?.({
        deliveryContextOrdinal: 0,
        messageReactionPending: false,
      })
      return {
        kind: 'succeeded',
        providerTurn: {
          acceptedNoReplyDeliveryContextOrdinals: [0],
          onboardingGuidanceInjected: true,
          codexContinuation: { kind: 'explicit-structured-history' },
          codexThreadId: 'provider-thread-group-retry',
          finalAction: { kind: 'none' },
          response: '',
          responseDeliveryContextOrdinal: 0,
          route: { routeId: 'route-group-review' },
          session,
          transcriptResponse: null,
        },
      }
    },
  )
  const retryTurn = await startHeldTurn({
    firstDraftReady: retryDraftReady,
    latePrompt: 'New group input',
    onFinishWithoutReplyAccepted: retryNoReplyAccepted,
  })
  const retryOutcomes = await Promise.all([
    retryTurn.initial,
    retryTurn.late,
  ])
  expect(retryOutcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(
    true,
  )
  for (const outcome of retryOutcomes) {
    assert.equal(outcome.status, 'fulfilled')
    expect(outcome.result).toMatchObject({
      response: '',
      responseDisposition: 'none',
    })
  }
  expect(retryNoReplyAccepted).toHaveBeenCalledOnce()
  expect(mocks.appendAssistantTranscriptEntriesWithRefs).toHaveBeenCalledTimes(2)
  expect(
    mocks.appendAssistantTranscriptEntriesWithRefs.mock.calls.map(
      ([, , entries]) => entries.map((entry) => entry.text),
    ),
  ).toEqual([
    ['Initial group message'],
    ['New group input'],
  ])
  expect(
    mocks.appendAssistantTurnReceiptEvent.mock.calls
      .map(([event]) => event.kind)
      .filter((kind) => kind === 'user.persisted'),
  ).toEqual(['user.persisted', 'user.persisted'])
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateTranscriptRefs,
  ).toHaveBeenCalledTimes(2)
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateAdmissionState.mock
      .invocationCallOrder[0],
  ).toBeLessThan(
    mocks.appendAssistantTranscriptEntriesWithRefs.mock.invocationCallOrder[0]!,
  )
})
