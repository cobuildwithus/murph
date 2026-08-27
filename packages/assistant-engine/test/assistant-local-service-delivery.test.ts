import { mkdir, readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

import { expect, test, vi } from 'vitest'

import type { AssistantResponseMedia } from '@murphai/operator-config/assistant-cli-contracts'
import type {
  HostedRuntimeProductFeedbackRecord,
} from '@murphai/hosted-execution/runtime-control'
import {
  readAssistantAcceptedTurnInputJournal,
  resolveAssistantAcceptedTurnInputReferenceWindow,
} from '../src/assistant/active-turn-input-journal.ts'
import type { AssistantDeliveryOutcome } from '../src/assistant/service-contracts.ts'
import { upsertAssistantInputEvent } from '../src/assistant/input-store.ts'
import { assistantInputCandidateFromStoredEvent } from '../src/assistant/input-source.ts'
import {
  readAutomationDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools/automation.ts'
import {
  ASSISTANT_IMAGE_RESPONSE_TRANSCRIPT_MARKER,
} from '../src/assistant/response-media.ts'
import type {
  AssistantProviderStartCriticalPathContext,
} from '../src/assistant/provider-start-critical-path.ts'
import { readAssistantTranscriptEntries } from '../src/assistant/store/persistence.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.ts'

import {
  CODEX_MODEL_PROVIDER_CONFIG,
  TRACKED_COMPACT_TABLE_RESPONSE_CARD,
  createAssistantSession,
  createCodexTarget,
  createDeferred,
  createDirectSharedPlan,
  createHostedMailboxSourceRef,
  createSharedPlan,
  isTraceEventWithRawType,
  loadLocalServiceModule,
  makeRuntimeEvent,
  tempRoots,
} from './assistant-local-service-runtime.harness.ts'

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
    media: [],
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
  assert.equal(mocks.recordAssistantDiagnosticEvent.mock.calls.length, 0)
  assert.equal(mocks.refreshAssistantStatusSnapshotLocal.mock.calls.length, 1)
  assert.equal(mocks.getAssistantChannelAdapter.mock.calls[0]?.[0], 'telegram')
  assert.equal(stopTyping.mock.calls.length, 1)
  assert.deepEqual(stopTyping.mock.calls[0], [{ providerStop: false }])
  assert.deepEqual(mocks.maybeRunAssistantRuntimeMaintenance.mock.calls[0]?.[0], {
    signal: null,
    vault: '/vaults/test',
  })
  // Maintenance is a post-turn owner: it must run after the reply is
  // committed and delivered, never on the foreground path before it.
  assert.ok(
    (mocks.maybeRunAssistantRuntimeMaintenance.mock.invocationCallOrder[0] ?? 0) >
      (mocks.finalizeDeliveredAssistantTurn.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY),
  )
})

test('sendAssistantMessageLocal rejects a superseded provider result before transcript or outbox commit', async () => {
  const authorityError = Object.assign(
    new Error('Web already answered the exact inbound'),
    {
      code: 'HOSTED_LINQ_INSTANT_FIRST_TURN_ALREADY_ANSWERED',
      retryable: false,
    },
  )
  let webAccepted = false
  const assertTurnCommitAuthority = vi.fn(async () => {
    expect(webAccepted).toBe(true)
    throw authorityError
  })
  const providerStarted = createDeferred<void>()
  const releaseProviderResult = createDeferred<void>()
  const { mocks, sendAssistantMessageLocal, session } =
    await loadLocalServiceModule()
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async () => {
    providerStarted.resolve()
    await releaseProviderResult.promise
    return {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        response: 'runtime answer the member must not see',
        responseDeliveryContextOrdinal: 0,
        route: {
          routeId: 'route-web-first-turn-race',
        },
        session,
        transcriptResponse: 'runtime answer the member must not see',
      },
    }
  })

  const result = sendAssistantMessageLocal({
    deliverResponse: true,
    executionContext: {
      hosted: {
        assertTurnCommitAuthority,
        memberId: 'member-web-first-turn-race',
        userEnvKeys: [],
      },
    },
    persistUserPromptOnFailure: false,
    prompt: 'Hey Murph',
    vault: '/vaults/test',
  })
  await providerStarted.promise
  expect(mocks.finalizeAssistantTurnArtifacts).not.toHaveBeenCalled()
  webAccepted = true
  releaseProviderResult.resolve()
  await expect(result).rejects.toBe(authorityError)

  expect(mocks.recordAssistantUsageEvent).toHaveBeenCalledOnce()
  expect(assertTurnCommitAuthority).toHaveBeenCalledWith({
    acceptedInputs: expect.arrayContaining([
      expect.objectContaining({ source: 'manual' }),
    ]),
    turnId: 'turn-1',
  })
  expect(mocks.finalizeAssistantTurnArtifacts).not.toHaveBeenCalled()
  expect(mocks.dispatchAssistantReply).not.toHaveBeenCalled()
  expect(mocks.finalizeDeliveredAssistantTurn).not.toHaveBeenCalled()
  expect(
    mocks.runtimeState.turns.acceptedInputs.updateAdmissionState,
  ).not.toHaveBeenCalledWith(expect.objectContaining({
    admissionState: 'commit-started',
  }))
})

test('sendAssistantMessageLocal attaches runtime-derived context to the exact deliveries', async () => {
  const session = createAssistantSession()
  const contextReferences = [{
    entityId: 'evt_current_workout',
    entityKind: 'activity_session',
  }]
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: createDirectSharedPlan(),
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        codexContinuation: { kind: 'explicit-structured-history' },
        precedingResponseSegments: [{
          contextReferences,
          deliveryContextOrdinal: 0,
          response: 'First workout reply.',
        }],
        response: 'Final workout reply.',
        responseContextReferences: contextReferences,
        responseDeliveryContextOrdinal: 0,
        route: { routeId: 'route-workout-context' },
        session,
        transcriptResponse: 'Final workout reply.',
      },
    },
    session,
  })

  await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'Continue the workout',
    vault: '/vaults/test',
  })

  expect(mocks.deliverAssistantPrecedingReplies.mock.calls[0]?.[0]?.segments)
    .toEqual([
      expect.objectContaining({
        contextReferences,
        response: 'First workout reply.',
      }),
    ])
  expect(mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.input)
    .toEqual(expect.objectContaining({
      outboxAutomationContextReferences: contextReferences,
    }))
})

test('sendAssistantMessageLocal hands off product feedback only after durable reply handoff', async () => {
  const session = createAssistantSession()
  const productFeedbackCandidate: HostedRuntimeProductFeedbackRecord = {
    idempotencyKey: 'feedback-after-reply',
    kind: 'feature_request',
    relatedChangelogItemIds: [],
    summary: 'Speculative: support the missing Murph path.',
  }
  const acceptProductFeedbackCandidate = vi.fn(() => {
    throw new Error('Best-effort product feedback handoff failed.')
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        codexThreadId: 'provider-thread-product-feedback',
        productFeedbackCandidate,
        response: 'assistant response',
        responseDeliveryContextOrdinal: 0,
        route: {
          routeId: 'route-product-feedback',
        },
        session,
        transcriptResponse: 'assistant response',
      },
    },
    session,
  })

  await expect(sendAssistantMessageLocal({
    deliverResponse: true,
    executionContext: {
      hosted: {
        memberId: 'member-product-feedback',
        productFeedbackCandidateSink: {
          acceptProductFeedbackCandidate,
        },
        userEnvKeys: [],
      },
    },
    prompt: 'Use a missing Murph path.',
    vault: '/vaults/test',
  })).resolves.toMatchObject({
    response: 'assistant response',
    status: 'completed',
  })

  expect(acceptProductFeedbackCandidate).toHaveBeenCalledOnce()
  expect(acceptProductFeedbackCandidate).toHaveBeenCalledWith(
    productFeedbackCandidate,
  )
  expect(
    acceptProductFeedbackCandidate.mock.invocationCallOrder[0],
  ).toBeGreaterThan(
    mocks.finalizeDeliveredAssistantTurn.mock.invocationCallOrder[0] ??
      Number.POSITIVE_INFINITY,
  )
  expect(
    acceptProductFeedbackCandidate.mock.invocationCallOrder[0],
  ).toBeGreaterThan(
    mocks.dispatchAssistantReply.mock.invocationCallOrder[0] ??
      Number.POSITIVE_INFINITY,
  )
})

test('sendAssistantMessageLocal delivers an exact approval URL without persisting it in assistant history', async () => {
  const approvalUrl =
    `https://www.withmurph.ai/approve/haa_${'a'.repeat(32)}`
  const session = createAssistantSession()
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        codexThreadId: 'provider-thread-capability-split',
        response: `Approval is required.\n\n${approvalUrl}`,
        responseDeliveryContextOrdinal: 0,
        route: {
          routeId: 'route-capability-split',
        },
        session,
        transcriptResponse: 'Approval is required.',
      },
    },
    session,
  })

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    executionContext: {
      hosted: null,
    },
    prompt: 'Send the report.',
    vault: '/vaults/test',
  })

  expect(result.response).toContain(approvalUrl)
  expect(mocks.dispatchAssistantReply).toHaveBeenCalledWith(
    expect.objectContaining({
      response: `Approval is required.\n\n${approvalUrl}`,
    }),
  )
  expect(mocks.finalizeAssistantTurnArtifacts).toHaveBeenCalledWith(
    expect.objectContaining({
      assistantTranscriptText: 'Approval is required.',
    }),
  )
})

test('sendAssistantMessageLocal does not volunteer support contact for an unverified external audience', async () => {
  const safetyResponse =
    "I couldn't verify whether this is a private or group conversation, so I can't safely use account context here yet. Please try again in your private chat with Murph."
  const session = createAssistantSession({
    binding: {
      actorId: 'stored-direct-actor',
      channel: 'telegram',
      conversationKey: null,
      delivery: {
        kind: 'thread',
        target: 'stored-direct-thread',
      },
      identityId: 'stored-direct-identity',
      threadId: 'stored-direct-thread',
      threadIsDirect: true,
    },
    sessionId: 'session-unverified-external',
  })
  const plan = createSharedPlan()
  plan.conversationPolicy.audience = {
    actorId: 'stored-direct-actor',
    bindingDelivery: {
      kind: 'thread',
      target: 'stored-direct-thread',
    },
    channel: 'telegram',
    deliveryPolicy: 'explicit-target-override',
    effectiveThreadIsDirect: null,
    explicitTarget: 'external-thread',
    identityId: 'stored-direct-identity',
    replyToMessageId: null,
    threadId: 'external-thread',
    threadIsDirect: null,
  }
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    deliveryOutcome: {
      delivery: {
        channel: 'telegram',
        sentAt: '2026-04-08T12:00:05.000Z',
        target: 'external-thread',
        targetKind: 'thread',
      },
      intentId: 'intent-unverified-external',
      kind: 'sent',
      media: [],
      session,
    },
    plan,
    session,
  })
  mocks.saveAssistantSession.mockImplementationOnce(async (_vault, nextSession) =>
    nextSession,
  )

  const result = await sendAssistantMessageLocal({
    channel: 'telegram',
    deliverResponse: true,
    deliveryTarget: 'external-thread',
    prompt: 'What do you know about my account?',
    threadId: 'external-thread',
    threadIsDirect: null,
    vault: '/vaults/test',
  })

  expect(result.response).toBe(safetyResponse)
  expect(result.response).not.toContain('support@withmurph.ai')
  expect(result.delivery).toEqual(expect.objectContaining({
    target: 'external-thread',
  }))
  expect(mocks.executeCodexTurnWithRecovery).not.toHaveBeenCalled()
  expect(mocks.recordAssistantUsageEvent).not.toHaveBeenCalled()
  expect(mocks.finalizeAssistantTurnArtifacts).not.toHaveBeenCalled()
  expect(mocks.dispatchAssistantReply).toHaveBeenCalledOnce()
  expect(mocks.dispatchAssistantReply).toHaveBeenCalledWith(
    expect.objectContaining({
      response: safetyResponse,
      session: expect.objectContaining({ turnCount: 1 }),
    }),
  )
  expect(mocks.finalizeDeliveredAssistantTurn).toHaveBeenCalledWith(
    expect.objectContaining({ response: safetyResponse }),
  )
  expect(mocks.appendAssistantTranscriptEntries).toHaveBeenCalledTimes(2)
  expect(mocks.appendAssistantTranscriptEntries.mock.calls[1]?.[2]).toEqual([
    expect.objectContaining({
      kind: 'assistant',
      text: safetyResponse,
    }),
  ])
  expect(mocks.saveAssistantSession).toHaveBeenCalledWith(
    '/vaults/test',
    expect.objectContaining({
      sessionId: 'session-unverified-external',
      turnCount: 1,
    }),
  )
  expect(
    mocks.saveAssistantSession.mock.invocationCallOrder[0],
  ).toBeLessThan(mocks.dispatchAssistantReply.mock.invocationCallOrder[0]!)
})

test('sendAssistantMessageLocal gives hosted manual phone-call turns a real accepted input id', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'assistant-local-service-phone-call-input-',
  )
  tempRoots.push(parentRoot)
  const plan = createSharedPlan()
  plan.conversationPolicy.audience.effectiveThreadIsDirect = true
  plan.conversationPolicy.audience.threadIsDirect = true
  const { mocks, sendAssistantMessageLocal, session } = await loadLocalServiceModule({
    plan,
    realAcceptedInputPersistence: true,
  })
  let phoneCallScope: unknown = null

  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    expect(providerInput.acceptedInputItems).toEqual([
      expect.objectContaining({
        id: 'manual-phone-call:turn-1',
        promptFallback: expect.objectContaining({
          reason: 'manual-input',
        }),
        source: 'manual',
      }),
    ])
    phoneCallScope =
      providerInput.hostedToolContext?.currentUserActionScope?.() ?? null
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
    deliverResponse: false,
    executionContext: {
      hosted: {
        memberId: 'member-hosted',
        phoneCalls: {
          start: vi.fn(async () => ({
            phoneCallId: 'hpc_test',
            status: 'calling' as const,
          })),
        },
        userEnvKeys: [],
      },
    },
    prompt: 'Please call the clinic.',
    turnTrigger: 'manual-ask',
    vault: vaultRoot,
  })

  expect(phoneCallScope).toMatchObject({
    acceptedInputIds: ['manual-phone-call:turn-1'],
    conversationScope: 'direct',
  })
})

test('sendAssistantMessageLocal keeps a stored pre-midnight receipt authoritative after delayed initial processing', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2031-02-15T10:00:00.100Z'))
  const context = await createTempVaultContext(
    'assistant-local-service-relative-date-initial-',
  )
  tempRoots.push(context.parentRoot)
  const storedInput = await upsertAssistantInputEvent({
    vault: context.vaultRoot,
    now: new Date('2031-02-15T10:00:00.100Z'),
    event: {
      content: {
        attachmentDescriptors: [],
        text: 'Remind me tomorrow at 9 AM Honolulu time.',
      },
      conversation: {
        accountId: 'acct_1',
        actorId: 'actor_1',
        actorIsSelf: false,
        source: 'telegram',
        threadId: 'thread-1',
        threadIsDirect: true,
      },
      occurredAt: '2031-02-15T09:59:58.000Z',
      receivedAt: '2031-02-15T09:59:59.900Z',
      replyTarget: {
        channel: 'telegram',
        messageId: 'message-relative-date-initial',
        threadId: 'thread-1',
      },
      sourceRef: createHostedMailboxSourceRef({
        eventId: 'evt_relative_date_initial',
        laneSeq: '1',
      }),
    },
  })
  const acceptedInput = assistantInputCandidateFromStoredEvent(
    storedInput,
  ).acceptedInput
  const { mocks, sendAssistantMessageLocal, session } =
    await loadLocalServiceModule({
      realAcceptedInputPersistence: true,
    })

  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(
    async (providerInput) => {
      const referenceWindow = resolveAssistantAcceptedTurnInputReferenceWindow(
        providerInput.acceptedInputItems ?? [],
      )
      expect(referenceWindow).toEqual({
        earliestAt: '2031-02-15T09:59:59.900Z',
        latestAt: '2031-02-15T09:59:59.900Z',
      })
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
          title: 'Tomorrow reminder',
        },
        relativeDateReferenceWindow: referenceWindow,
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
      return {
        kind: 'succeeded',
        providerTurn: {
          onboardingGuidanceInjected: true,
          codexContinuation: {
            kind: 'explicit-structured-history',
          },
          codexThreadId: 'provider-thread-relative-date-initial',
          response: 'Reminder saved.',
          responseDeliveryContextOrdinal: 0,
          route: {
            routeId: 'route-relative-date-initial',
          },
          session,
          transcriptResponse: 'Reminder saved.',
        },
      }
    },
  )

  await sendAssistantMessageLocal({
    acceptedTurnInput: {
      initialInputs: [acceptedInput],
    },
    deliverResponse: false,
    executionContext: {
      hosted: {
        memberId: 'member-hosted',
        userEnvKeys: [],
      },
    },
    prompt: 'Remind me tomorrow at 9 AM Honolulu time.',
    vault: context.vaultRoot,
  })

  expect(
    (await readAssistantAcceptedTurnInputJournal(
      context.vaultRoot,
      'turn-1',
    ))?.inputs[0]?.acceptedAt,
  ).toBe('2031-02-15T09:59:59.900Z')
})

test('sendAssistantMessageLocal passes lazy scheduled group tools without invoking them', async () => {
  const groupPermissionOfferRequest = vi.fn(async () => ({
    action: 'post_join_offer' as const,
    result: {
      group: null,
      status: 'unavailable' as const,
      unavailableReason: 'test_unavailable',
    },
  }))
  const groupPermissionOfferTool = { request: groupPermissionOfferRequest }
  const groupSharedRead = vi.fn(async () => ({
    members: [] as const,
    requestedProjectionScopeKeys: ['steps-days.v0'],
    status: 'none' as const,
  }))
  const groupSharedReader = { request: groupSharedRead }
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule()

  await sendAssistantMessageLocal({
    deliverResponse: false,
    executionContext: {
      hosted: {
        groupPermissionOfferTool,
        groupSharedReader,
        memberId: 'member-hosted',
        userEnvKeys: [],
      },
    },
    prompt: 'Show the current challenge standings.',
    vault: '/vaults/test',
  })

  const hostedToolContext =
    mocks.executeCodexTurnWithRecovery.mock.calls[0]?.[0]?.hostedToolContext
  expect(hostedToolContext?.groupPermissionOfferTool)
    .toBe(groupPermissionOfferTool)
  expect(hostedToolContext?.groupSharedReader).toBe(groupSharedReader)
  expect(groupPermissionOfferRequest).not.toHaveBeenCalled()
  expect(groupSharedRead).not.toHaveBeenCalled()
})

test('sendAssistantMessageLocal compacts oversized runtime logs after the turn commits', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'assistant-local-service-runtime-maintenance-',
  )
  tempRoots.push(parentRoot)
  const paths = resolveAssistantStatePaths(vaultRoot)
  await mkdir(paths.journalsDirectory, {
    recursive: true,
  })
  await writeFile(
    paths.runtimeEventsPath,
    Array.from({ length: 2050 }, (_value, index) =>
      JSON.stringify(makeRuntimeEvent(index)),
    ).join('\n') + '\n',
    'utf8',
  )

  const { sendAssistantMessageLocal } = await loadLocalServiceModule({
    useRealRuntimeMaintenance: true,
  })

  await sendAssistantMessageLocal({
    deliverResponse: false,
    executionContext: {
      hosted: null,
    },
    prompt: 'Summarize my inbox',
    vault: vaultRoot,
  })

  const compactedRuntimeEvents = await readFile(paths.runtimeEventsPath, 'utf8')
  const compactedRuntimeEventCount = compactedRuntimeEvents
    .trim()
    .split('\n')
    .filter(Boolean).length

  assert.ok(compactedRuntimeEventCount <= 2000)
  assert.match(compactedRuntimeEvents, /runtime\.maintenance/)
})

test('sendAssistantMessageLocal delivers media-only provider replies', async () => {
  const session = createAssistantSession()
  const voiceMemoMedia: AssistantResponseMedia = {
    filename: 'voice-memo.mp3',
    kind: 'voice_memo',
    transcript: 'Voice-only reply.',
    transport: {
      generation: {
        kind: 'elevenlabs_speech',
        modelId: 'eleven_multilingual_v2',
        outputFormat: 'mp3_44100_128',
        text: 'Voice-only reply.',
        voiceId: 'voice-test',
      },
      kind: 'telegram_generation',
    },
  }
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    deliveryOutcome: {
      delivery: {
        channel: 'telegram',
        sentAt: '2026-04-08T12:00:05.000Z',
        target: 'thread-1',
        targetKind: 'thread',
      },
      intentId: 'intent-media-only',
      kind: 'sent',
      media: [voiceMemoMedia],
      session,
    },
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        codexContinuation: { kind: 'explicit-structured-history' },
        codexThreadId: 'provider-thread-media-only',
        response: '',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: '',
        responseMedia: [voiceMemoMedia],
        route: { routeId: 'route-media-only' },
        session,
      },
    },
    session,
  })

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    executionContext: {
      hosted: null,
    },
    prompt: 'Send only a voice memo',
    vault: '/vaults/test',
  })

  expect(mocks.dispatchAssistantReply).toHaveBeenCalledTimes(1)
  expect(mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.response).toBe('')
  expect(mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.media).toEqual([
    voiceMemoMedia,
  ])
  expect(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.assistantTranscriptText,
  ).toBe('Voice-only reply.')
  expect(result).toMatchObject({
    deliveryDeferred: false,
    deliveryError: null,
    deliveryIntentId: 'intent-media-only',
    media: [voiceMemoMedia],
    response: '',
    status: 'completed',
  })
})

test('sendAssistantMessageLocal preserves image presence for media-only image replies', async () => {
  const session = createAssistantSession()
  const imageMedia: AssistantResponseMedia = {
    alt: 'Generated image',
    kind: 'image',
    source: null,
    url: 'https://cdn.example.test/assistant/media-only.png',
  }
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        codexContinuation: { kind: 'explicit-structured-history' },
        codexThreadId: 'provider-thread-image-media-only',
        response: '',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: '',
        responseMedia: [imageMedia],
        route: { routeId: 'route-image-media-only' },
        session,
      },
    },
    session,
  })

  await sendAssistantMessageLocal({
    deliverResponse: true,
    executionContext: {
      hosted: null,
    },
    prompt: 'Create an image without accompanying text',
    vault: '/vaults/test',
  })

  expect(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.assistantTranscriptText,
  ).toBe('[This response included an image attachment.]')
  expect(mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.response).toBe('')
  expect(mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.media).toEqual([
    imageMedia,
  ])
})

test('sendAssistantMessageLocal preserves image presence beside transcript text', async () => {
  const session = createAssistantSession()
  const imageMedia: AssistantResponseMedia = {
    alt: 'Generated image',
    kind: 'image',
    source: null,
    url: 'https://cdn.example.test/assistant/generated.png',
  }
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        codexContinuation: { kind: 'explicit-structured-history' },
        codexThreadId: 'provider-thread-image-with-text',
        response: 'The image is ready.',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'The image is ready.',
        responseMedia: [imageMedia],
        route: { routeId: 'route-image-with-text' },
        session,
      },
    },
    session,
  })

  await sendAssistantMessageLocal({
    deliverResponse: true,
    executionContext: {
      hosted: null,
    },
    prompt: 'Create an image',
    vault: '/vaults/test',
  })

  expect(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.assistantTranscriptText,
  ).toBe(
    '[This response included an image attachment.]\n\nThe image is ready.',
  )
  expect(mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.media).toEqual([
    imageMedia,
  ])
})

test('sendAssistantMessageLocal preserves image presence for preceding replies', async () => {
  const session = createAssistantSession()
  const imageMedia: AssistantResponseMedia = {
    alt: 'Generated image',
    kind: 'image',
    source: null,
    url: 'https://cdn.example.test/assistant/preceding.png',
  }
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: createDirectSharedPlan(),
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        codexContinuation: { kind: 'explicit-structured-history' },
        precedingResponseSegments: [
          {
            deliveryContextOrdinal: 0,
            media: [imageMedia],
            response: 'The first image is ready.',
          },
        ],
        response: 'The follow-up is ready.',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'The follow-up is ready.',
        route: { routeId: 'route-preceding-image-with-text' },
        session,
      },
    },
    session,
  })

  await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'Create an image, then refine it',
    vault: '/vaults/test',
  })

  expect(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.precedingAssistantTranscriptTexts,
  ).toEqual([
    '[This response included an image attachment.]\n\nThe first image is ready.',
  ])
  expect(mocks.deliverAssistantPrecedingReplies.mock.calls[0]?.[0]?.segments)
    .toEqual([
      expect.objectContaining({
        media: [imageMedia],
        response: 'The first image is ready.',
      }),
    ])
})

test('sendAssistantMessageLocal separates preceding tracked-card delivery from transcript authority', async () => {
  const session = createAssistantSession()
  const publicResponse = 'Strength session\n\nBench press: Set 1: 185 lb × 8'
  const transcriptResponse = `${publicResponse}\n\n[Murph tracked workout source: evt_01K1ABCDEFGHJKMNPQRSTVWXYZ; snapshot: 2026-08-04T21:30:00.000Z]`
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: createDirectSharedPlan(),
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        codexContinuation: { kind: 'explicit-structured-history' },
        precedingResponseSegments: [{
          deliveryContextOrdinal: 0,
          media: [],
          response: publicResponse,
          transcriptResponse,
        }],
        response: 'Follow-up answer.',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'Follow-up answer.',
        route: { routeId: 'route-preceding-tracked-card' },
        session,
      },
    },
    session,
  })

  await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'Track this, then answer the follow-up',
    vault: '/vaults/test',
  })

  expect(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.precedingAssistantTranscriptTexts,
  ).toEqual([transcriptResponse])
  expect(mocks.deliverAssistantPrecedingReplies.mock.calls[0]?.[0]?.segments)
    .toEqual([
      expect.objectContaining({
        response: publicResponse,
        transcriptResponse,
      }),
    ])
  expect(
    mocks.deliverAssistantPrecedingReplies.mock.calls[0]?.[0]?.segments?.[0]
      ?.response,
  ).toBe(publicResponse)
})

test('sendAssistantMessageLocal persists the provider transcript for a final tracked card', async () => {
  const session = createAssistantSession()
  const publicResponse = 'Strength session\n\nBench press: Set 1: 185 lb × 8'
  const transcriptResponse = `${publicResponse}\n\n[Murph tracked workout source: evt_01K1ABCDEFGHJKMNPQRSTVWXYZ; snapshot: 2026-08-04T21:30:00.000Z]`
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: createDirectSharedPlan(),
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        codexContinuation: { kind: 'explicit-structured-history' },
        response: publicResponse,
        responseCard: TRACKED_COMPACT_TABLE_RESPONSE_CARD,
        responseDeliveryContextOrdinal: 0,
        transcriptResponse,
        route: { routeId: 'route-final-tracked-card' },
        session,
      },
    },
    session,
  })

  await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'Track this workout in a table',
    vault: '/vaults/test',
  })

  expect(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.assistantTranscriptText,
  ).toBe(transcriptResponse)
  expect(mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.response)
    .toBe(publicResponse)
  expect(mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.response)
    .not.toContain('evt_')
})

test('sendAssistantMessageLocal delivers an unresolved DST clarification after App Server suppresses its card', async () => {
  const session = createAssistantSession()
  const response = [
    'Strength session\n\nBench press: Set 1: 185 lb × 8',
    'For reminder "Gap reminder", the trusted date is 2026-03-08. What other local time on 2026-03-08 should I use?',
  ].join('\n\n')
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: createDirectSharedPlan(),
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        codexContinuation: { kind: 'explicit-structured-history' },
        response,
        responseCard: null,
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: response,
        route: { routeId: 'route-unresolved-dst-clarification' },
        session,
      },
    },
    session,
  })

  await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'Show my workout and remind me tomorrow at 2:30 AM.',
    vault: '/vaults/test',
  })

  expect(mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.response).toBe(response)
  expect(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.assistantTranscriptText,
  ).toBe(response)
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

test('sendAssistantMessageLocal clears resume state when the provider returns no thread', async () => {
  const session = createAssistantSession({
    resumeState: {
      routeFingerprint: 'route-stale-without-provider-thread',
      threadId: 'provider-thread-stale-without-provider-thread',
    },
    sessionId: 'session-without-provider-thread',
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        codexContinuation: { kind: 'explicit-structured-history' },
        codexThreadId: null,
        response: 'Answer without a resumable provider thread.',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'Answer without a resumable provider thread.',
        route: { routeId: 'route-without-provider-thread' },
        session,
      },
    },
    session,
  })

  await sendAssistantMessageLocal({
    deliverResponse: false,
    prompt: 'Continue without a provider thread',
    turnTrigger: 'manual-ask',
    vault: '/vaults/test',
  })

  expect(mocks.clearAssistantSessionCodexResumeState).toHaveBeenCalledWith({
    session,
    vault: '/vaults/test',
  })
  expect(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.providerResumeStateAction,
  ).toBe('clear')
})

test('sendAssistantMessageLocal clears rejected resume state after a terminal failure without a confirmed thread', async () => {
  const terminalError = new Error('stale resume rejected before provider start')
  const session = createAssistantSession({
    resumeState: {
      routeFingerprint: 'route-with-rejected-resume',
      threadId: 'rejected-provider-thread',
    },
    sessionId: 'session-with-rejected-resume',
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...createSharedPlan(),
      persistUserPromptOnFailure: false,
    },
    providerOutcome: {
      attemptCount: 1,
      codexContinuation: { kind: 'provider-state-optimization' },
      codexThreadId: null,
      error: terminalError,
      kind: 'failed_terminal',
      providerRequestOutcome: 'failed',
      providerTurnId: null,
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
    },
    session,
  })

  await expect(
    sendAssistantMessageLocal({
      deliverResponse: false,
      prompt: 'Continue after the rejected resume',
      vault: '/vaults/test',
    }),
  ).rejects.toBe(terminalError)

  expect(mocks.clearAssistantSessionCodexResumeState).toHaveBeenCalledWith({
    session,
    vault: '/vaults/test',
  })
  expect(mocks.saveAssistantSession).not.toHaveBeenCalled()
})

test('sendAssistantMessageLocal retains every completed group response and media segment', async () => {
  const { mocks, sendAssistantMessageLocal, session } = await loadLocalServiceModule()

  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async () => ({
    kind: 'succeeded',
    providerTurn: {
      onboardingGuidanceInjected: false,
      codexContinuation: { kind: 'explicit-structured-history' },
      precedingResponseSegments: [
        {
          deliveryContextOrdinal: 0,
          response: 'Answer one.',
          media: [
            {
              kind: 'image',
              url: 'https://cdn.example.test/assistant/answer-one.png',
              alt: 'Answer one image',
              source: null,
            },
          ],
        },
        {
          deliveryContextOrdinal: 0,
          response: 'Answer two.',
          media: [],
        },
      ],
      response: 'Answer three.',
      responseDeliveryContextOrdinal: 0,
      transcriptResponse: 'Answer three.',
      session,
    },
  }))

  await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'First question',
    vault: '/vaults/test',
  })

  expect(mocks.deliverAssistantPrecedingReplies.mock.calls[0]?.[0]?.segments)
    .toEqual([
      expect.objectContaining({
        media: [
          {
            kind: 'image',
            url: 'https://cdn.example.test/assistant/answer-one.png',
            alt: 'Answer one image',
            source: null,
          },
        ],
        response: 'Answer one.',
      }),
      expect.objectContaining({
        media: [],
        response: 'Answer two.',
      }),
    ])
  expect(mocks.dispatchAssistantReply).toHaveBeenCalledTimes(1)
  expect(mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.response)
    .toBe('Answer three.')
  expect(mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0])
    .toMatchObject({
      assistantTranscriptText: 'Answer three.',
      precedingAssistantTranscriptTexts: [
        `${ASSISTANT_IMAGE_RESPONSE_TRANSCRIPT_MARKER}\n\nAnswer one.`,
        'Answer two.',
      ],
    })
})

test('sendAssistantMessageLocal strips reply bubble delimiters from bubble-capable persisted and returned text', async () => {
  const session = createAssistantSession()
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: createDirectSharedPlan(),
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        codexContinuation: { kind: 'explicit-structured-history' },
        precedingResponseSegments: [
          {
            deliveryContextOrdinal: 0,
            response: 'Preceding one.\n---\nPreceding two.',
            media: [],
          },
        ],
        response: 'Final one.\n---\nFinal two?',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'Final one.\n---\nFinal two?',
        session,
      },
    },
    session,
  })

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'First question',
    vault: '/vaults/test',
  })

  expect(mocks.deliverAssistantPrecedingReplies.mock.calls[0]?.[0]?.segments)
    .toEqual([
      expect.objectContaining({
        response: 'Preceding one.\n---\nPreceding two.',
      }),
    ])
  expect(mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.response)
    .toBe('Final one.\n---\nFinal two?')
  expect(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.precedingAssistantTranscriptTexts,
  ).toEqual(['Preceding one.\n\nPreceding two.'])
  expect(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.assistantTranscriptText,
  ).toBe('Final one.\n\nFinal two?')
  expect(mocks.finalizeDeliveredAssistantTurn.mock.calls[0]?.[0]?.response)
    .toBe('Final one.\n\nFinal two?')
  expect(result.response).toBe('Final one.\n\nFinal two?')
})

test('sendAssistantMessageLocal strips reply bubble delimiters from failed receipt text after provider output', async () => {
  const usageError = new Error('usage persistence failed')
  const session = createAssistantSession()
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        codexContinuation: { kind: 'explicit-structured-history' },
        response: 'Final one.\n---\nFinal two?',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'Final one.\n---\nFinal two?',
        session,
      },
    },
    session,
  })
  mocks.recordAssistantUsageEvent.mockRejectedValueOnce(usageError)

  await assert.rejects(
    () =>
      sendAssistantMessageLocal({
        deliverResponse: true,
        prompt: 'First question',
        vault: '/vaults/test',
      }),
    (error) => {
      assert.equal(error, usageError)
      return true
    },
  )

  expect(mocks.finalizeAssistantTurnReceipt.mock.calls[0]?.[0]).toMatchObject({
    response: 'Final one.\n\nFinal two?',
    status: 'failed',
  })
})

test('sendAssistantMessageLocal preserves email delimiter lines in delivery, transcript, and receipt text', async () => {
  const session = createAssistantSession({
    binding: {
      actorId: 'email-actor',
      channel: 'email',
      conversationKey: 'channel:email|identity:email-identity|thread:email-thread',
      delivery: {
        kind: 'thread',
        target: 'email-thread',
      },
      identityId: 'email-identity',
      threadId: 'email-thread',
      threadIsDirect: true,
    },
  })
  const plan = createSharedPlan()
  plan.conversationPolicy.audience = {
    ...plan.conversationPolicy.audience,
    actorId: 'email-actor',
    bindingDelivery: {
      kind: 'thread',
      target: 'email-thread',
    },
    channel: 'email',
    effectiveThreadIsDirect: true,
    explicitTarget: 'email-thread',
    identityId: 'email-identity',
    threadId: 'email-thread',
    threadIsDirect: true,
  }
  const finalResponse = 'Final one.\n---\nFinal two?'
  const precedingResponse = 'Preceding one.\n---\nPreceding two.'
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan,
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        codexContinuation: { kind: 'explicit-structured-history' },
        precedingResponseSegments: [
          {
            deliveryContextOrdinal: 0,
            response: precedingResponse,
            media: [],
          },
        ],
        response: finalResponse,
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: finalResponse,
        session,
      },
    },
    session,
  })

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'Email question',
    vault: '/vaults/test',
  })

  expect(mocks.deliverAssistantPrecedingReplies.mock.calls[0]?.[0]?.segments)
    .toEqual([
      expect.objectContaining({
        response: precedingResponse,
      }),
    ])
  expect(mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.response)
    .toBe(finalResponse)
  expect(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.precedingAssistantTranscriptTexts,
  ).toEqual([precedingResponse])
  expect(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.assistantTranscriptText,
  ).toBe(finalResponse)
  expect(mocks.finalizeDeliveredAssistantTurn.mock.calls[0]?.[0]?.response)
    .toBe(finalResponse)
  expect(result.response).toBe(finalResponse)
})

test('sendAssistantMessageLocal preserves real same-text preceding answers', async () => {
  const { mocks, sendAssistantMessageLocal, session } =
    await loadLocalServiceModule({
      plan: createDirectSharedPlan(),
    })

  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async () => ({
    kind: 'succeeded',
    providerTurn: {
      onboardingGuidanceInjected: false,
      codexContinuation: { kind: 'explicit-structured-history' },
      precedingResponseSegments: [
        {
          deliveryContextOrdinal: 0,
          response: 'Done.',
          media: [],
        },
      ],
      response: 'Done.',
      responseDeliveryContextOrdinal: 0,
      transcriptResponse: 'Done.',
      session,
    },
  }))

  await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'First question',
    vault: '/vaults/test',
  })

  expect(mocks.deliverAssistantPrecedingReplies.mock.calls[0]?.[0]?.segments)
    .toEqual([
      {
        deliveryContext: expect.objectContaining({
          deliveryIdempotencyKey: undefined,
          deliveryReplyToMessageId: undefined,
          deliverySource: null,
          deliveryTarget: undefined,
          hostedDeliveryIdempotency: null,
        }),
        response: 'Done.',
        media: [],
      },
    ])
})

test('sendAssistantMessageLocal retains valid group preceding replies and resolves each delivery context', async () => {
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
    const releaseLiveTurn = providerInput.activeTurnSteering?.registerLiveProviderTurn({
      interrupt: async () => undefined,
      codexThreadId: 'provider-thread-contexts',
      providerTurnId: 'provider-turn-contexts',
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
        codexThreadId: 'provider-thread-contexts',
        precedingResponseSegments: [
          {
            deliveryContextOrdinal: 0,
            response: 'Answer one.',
            media: [],
          },
          {
            deliveryContextOrdinal: 99,
            response: 'Answer fallback.',
            media: [],
          },
        ],
        response: 'Retained answer.',
        transcriptResponse: 'Retained answer.',
        responseDeliveryContextOrdinal: 1,
        responseMedia: [
          {
            kind: 'image',
            url: 'https://cdn.example.test/assistant/retained-final.png',
            alt: 'Retained final image',
            source: null,
          },
        ],
        route: {
          routeId: 'route-contexts',
        },
        session,
      },
    }
  })

  const initialResultPromise = sendAssistantMessageLocal({
    deliverResponse: true,
    deliveryDispatchMode: 'queue-only',
    deliveryIdempotencyKey: 'delivery-one',
    deliveryReplyToMessageId: 'message-one',
    deliverySource: {
      kind: 'linq',
      fromPhoneNumber: '+15550000001',
    },
    deliverySubject: 'subject-one',
    deliveryTarget: 'thread-one',
    hostedDeliveryIdempotency: {
      assistantTurnOrdinal: 'assistant-reply:1',
      conversationId: 'conversation-one',
      inboundMailboxItemIds: ['mailbox-one'],
      recipientKey: 'recipient-one',
    },
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
    deliveryDispatchMode: 'immediate',
    deliveryIdempotencyKey: 'delivery-two',
    deliveryReplyToMessageId: 'message-two',
    deliverySource: {
      kind: 'linq',
      fromPhoneNumber: '+15550000002',
    },
    deliverySubject: 'subject-two',
    deliveryTarget: 'thread-two',
    expectedActiveTurnId: 'turn-1',
    hostedDeliveryIdempotency: {
      assistantTurnOrdinal: 'assistant-reply:2',
      conversationId: 'conversation-two',
      inboundMailboxItemIds: ['mailbox-two'],
      recipientKey: 'recipient-two',
    },
    prompt: 'Late follow up',
    vault: '/vaults/test',
  })
  await vi.waitFor(() => {
    expect(liveSteeredPrompts).toEqual(['Late follow up'])
  })

  const secondSteeredResultPromise = sendAssistantMessageLocal({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
      directness: 'group',
    },
    deliveryDispatchMode: 'queue-only',
    deliveryIdempotencyKey: 'delivery-three',
    deliveryReplyToMessageId: 'message-three',
    deliverySource: {
      kind: 'linq',
      fromPhoneNumber: '+15550000003',
    },
    deliverySubject: 'subject-three',
    deliveryTarget: 'thread-three',
    expectedActiveTurnId: 'turn-1',
    hostedDeliveryIdempotency: {
      assistantTurnOrdinal: 'assistant-reply:3',
      conversationId: 'conversation-three',
      inboundMailboxItemIds: ['mailbox-three'],
      recipientKey: 'recipient-three',
    },
    prompt: 'Second late follow up',
    vault: '/vaults/test',
  })
  expect(liveSteeredPrompts).toEqual(['Late follow up'])
  providerRelease.resolve()

  const [initialResult, steeredResult, secondSteeredOutcome] = await Promise.all([
    initialResultPromise,
    steeredResultPromise,
    secondSteeredResultPromise.then(
      (result) => ({ result, status: 'fulfilled' as const }),
      (error: unknown) => ({ error, status: 'rejected' as const }),
    ),
  ])

  expect(initialResult.response).toBe('Retained answer.')
  expect(steeredResult.response).toBe('Retained answer.')
  expect(secondSteeredOutcome.status).toBe('rejected')
  if (secondSteeredOutcome.status === 'rejected') {
    expect(secondSteeredOutcome.error).toMatchObject({
      code: 'ASSISTANT_ACTIVE_TURN_NOT_ACTIVE',
    })
  }
  expect(mocks.deliverAssistantPrecedingReplies.mock.calls[0]?.[0]?.segments)
    .toEqual([
      expect.objectContaining({
        deliveryContext: expect.objectContaining({
          deliveryIdempotencyKey: 'delivery-one',
          deliveryReplyToMessageId: 'message-one',
          deliveryTarget: 'thread-one',
        }),
        media: [],
        response: 'Answer one.',
      }),
    ])
  expect(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.precedingAssistantTranscriptTexts,
  ).toEqual(['Answer one.'])
  expect(mocks.recordAssistantDiagnosticEvent.mock.calls.map((call) => call[0]))
    .toContainEqual(
      expect.objectContaining({
        kind: 'delivery.preceding-reply.delivery-context-ordinal-invalid',
      }),
    )
  expect(mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.input).toMatchObject({
    deliveryDispatchMode: 'immediate',
    deliveryIdempotencyKey: 'delivery-two',
    deliveryReplyToMessageId: 'message-two',
    deliverySource: {
      kind: 'linq',
      fromPhoneNumber: '+15550000002',
    },
    deliverySubject: 'subject-two',
    deliveryTarget: 'thread-two',
    hostedDeliveryIdempotency: {
      assistantTurnOrdinal: 'assistant-reply:2',
      conversationId: 'conversation-two',
      inboundMailboxItemIds: ['mailbox-two'],
      recipientKey: 'recipient-two',
    },
  })
  expect(mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.media).toEqual([
    {
      kind: 'image',
      url: 'https://cdn.example.test/assistant/retained-final.png',
      alt: 'Retained final image',
      source: null,
    },
  ])

  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async () => ({
    kind: 'succeeded',
    providerTurn: {
      onboardingGuidanceInjected: false,
      codexContinuation: { kind: 'explicit-structured-history' },
      response: 'Do not route this through a fallback context.',
      transcriptResponse: 'Do not route this through a fallback context.',
      responseDeliveryContextOrdinal: 99,
      session,
    },
  }))
  mocks.dispatchAssistantReply.mockClear()

  await expect(sendAssistantMessageLocal({
    deliverResponse: true,
    deliveryTarget: 'thread-one',
    prompt: 'First question',
    vault: '/vaults/test',
  })).rejects.toMatchObject({
    code: 'ASSISTANT_DELIVERY_CONTEXT_ORDINAL_INVALID',
  })

  expect(mocks.dispatchAssistantReply).not.toHaveBeenCalled()
})

test('sendAssistantMessageLocal resolves one accepted-message ref for reply and reaction delivery', async () => {
  const context = await createTempVaultContext(
    'assistant-local-service-selected-reply-target-',
  )
  tempRoots.push(context.parentRoot)
  const acceptedMessage = await upsertAssistantInputEvent({
    vault: context.vaultRoot,
    now: new Date('2026-04-22T10:00:01.000Z'),
    event: {
      content: {
        attachmentDescriptors: [],
        text: 'Reply to this message.',
      },
      conversation: {
        accountId: 'telegram-account',
        actorId: 'telegram-actor',
        actorIsSelf: false,
        source: 'telegram',
        threadId: 'thread-1',
        threadIsDirect: false,
      },
      occurredAt: '2026-04-22T10:00:00.000Z',
      receivedAt: '2026-04-22T10:00:00.000Z',
      replyTarget: {
        channel: 'telegram',
        messageId: '987654321',
        threadId: 'thread-1',
      },
      sourceMetadata: {
        externalThreadRouteAuthorityPresent: true,
        kind: 'telegram',
        mediaGroupId: null,
        replyContext: null,
      },
      sourceRef: createHostedMailboxSourceRef({
        eventId: 'evt_selected_reply_target',
        laneSeq: '1',
      }),
    },
  })
  const session = createAssistantSession()
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        reactions: [
          {
            deliveryContextOrdinal: 0,
            reaction: 'heart',
            targetInputId: acceptedMessage.inputId,
          },
        ],
        response: 'Targeted response.',
        responseDeliveryContextOrdinal: 0,
        session,
        targetInputId: acceptedMessage.inputId,
        transcriptResponse: 'Targeted response.',
      },
    },
    adapter: {
      setMessageReaction: vi.fn(async () => {
        throw new Error('Reaction adapter should not be called by this harness.')
      }),
    },
    realMessageTargetSelection: true,
    session,
  })

  await sendAssistantMessageLocal({
    acceptedTurnInput: {
      initialInputs: [
        assistantInputCandidateFromStoredEvent(acceptedMessage).acceptedInput,
      ],
    },
    deliverResponse: true,
    prompt: 'Reply to the selected message.',
    vault: context.vaultRoot,
  })

  expect(mocks.dispatchAssistantReply).toHaveBeenCalledTimes(1)
  expect(mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.input).toMatchObject({
    deliveryNativeReplyRequested: true,
    deliveryReplyToMessageId: '987654321',
  })
  expect(mocks.deliverAssistantReaction).toHaveBeenCalledTimes(1)
  expect(mocks.deliverAssistantReaction.mock.calls[0]?.[0]?.input).toMatchObject({
    deliveryReplyToMessageId: '987654321',
  })
  expect(
    mocks.appendAssistantTranscriptEntriesWithRefs.mock.calls
      .flatMap((call) => call[2])
      .find((entry) =>
        entry.kind === 'user' && entry.text === 'Reply to the selected message.'
      ),
  ).toMatchObject({
    contentReceivedAt: '2026-04-22T10:00:00.000Z',
  })
})

test('sendAssistantMessageLocal resolves required progress to one exact accepted message', async () => {
  const context = await createTempVaultContext(
    'assistant-local-service-selected-progress-target-',
  )
  tempRoots.push(context.parentRoot)
  const acceptedMessage = await upsertAssistantInputEvent({
    vault: context.vaultRoot,
    now: new Date('2026-04-22T10:00:01.000Z'),
    event: {
      content: {
        attachmentDescriptors: [],
        text: 'Bind progress to this message.',
      },
      conversation: {
        accountId: 'telegram-account',
        actorId: 'telegram-actor',
        actorIsSelf: false,
        source: 'telegram',
        threadId: 'thread-1',
        threadIsDirect: false,
      },
      occurredAt: '2026-04-22T10:00:00.000Z',
      receivedAt: '2026-04-22T10:00:00.000Z',
      replyTarget: {
        channel: 'telegram',
        messageId: '987654329',
        threadId: 'thread-1',
      },
      sourceMetadata: {
        externalThreadRouteAuthorityPresent: true,
        kind: 'telegram',
        mediaGroupId: null,
        replyContext: null,
      },
      sourceRef: createHostedMailboxSourceRef({
        eventId: 'evt_selected_progress_target',
        laneSeq: '1',
      }),
    },
  })
  const newerMessage = await upsertAssistantInputEvent({
    vault: context.vaultRoot,
    now: new Date('2026-04-22T10:00:02.000Z'),
    event: {
      content: {
        attachmentDescriptors: [],
        text: 'This newer speaker remains the generic context.',
      },
      conversation: {
        accountId: 'telegram-account',
        actorId: 'telegram-actor-newer',
        actorIsSelf: false,
        source: 'telegram',
        threadId: 'thread-1',
        threadIsDirect: false,
      },
      occurredAt: '2026-04-22T10:00:01.000Z',
      receivedAt: '2026-04-22T10:00:01.000Z',
      replyTarget: {
        channel: 'telegram',
        messageId: '987654330',
        threadId: 'thread-1',
      },
      sourceMetadata: {
        externalThreadRouteAuthorityPresent: true,
        kind: 'telegram',
        mediaGroupId: null,
        replyContext: null,
      },
      sourceRef: createHostedMailboxSourceRef({
        eventId: 'evt_newer_progress_context',
        laneSeq: '2',
      }),
    },
  })
  const session = createAssistantSession()
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    realMessageTargetSelection: true,
    session,
  })
  let unavailableProgressKind: string | null = null
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    await providerInput.progressDelivery?.send(
      'Sharing after the exact source is reviewed.',
      {
        deliveryContextOrdinal: 0,
        required: true,
        source: 'system',
        targetInputId: acceptedMessage.inputId,
      },
    )
    unavailableProgressKind = (await providerInput.progressDelivery?.send(
      'This target must fail closed.',
      {
        deliveryContextOrdinal: 0,
        required: true,
        source: 'system',
        targetInputId: 'ain_ffffffffffffffffffffffffffffffff',
      },
    ))?.kind ?? null
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
        codexContinuation: { kind: 'explicit-structured-history' },
        finalAction: { kind: 'none' },
        rawEvents: [],
        response: '',
        responseDeliveryContextOrdinal: 0,
        session,
        transcriptResponse: null,
      },
    }
  })

  await sendAssistantMessageLocal({
    acceptedTurnInput: {
      initialInputs: [
        assistantInputCandidateFromStoredEvent(acceptedMessage).acceptedInput,
        assistantInputCandidateFromStoredEvent(newerMessage).acceptedInput,
      ],
    },
    deliverResponse: true,
    deliveryReplyToMessageId: '987654330',
    prompt: 'Review the selected source.',
    vault: context.vaultRoot,
  })

  expect(mocks.deliverAssistantProgressUpdate).toHaveBeenCalledTimes(1)
  expect(unavailableProgressKind).toBe('failed')
  expect(mocks.deliverAssistantProgressUpdate.mock.calls[0]?.[0]?.input)
    .toMatchObject({
      deliveryNativeReplyRequested: true,
      deliveryReplyToMessageId: '987654329',
    })
})

test('sendAssistantMessageLocal fails closed before reply delivery when second-pass target authority is lost', async () => {
  const context = await createTempVaultContext(
    'assistant-local-service-stale-reply-target-',
  )
  tempRoots.push(context.parentRoot)
  const acceptedMessage = await upsertAssistantInputEvent({
    vault: context.vaultRoot,
    now: new Date('2026-04-22T10:00:01.000Z'),
    event: {
      content: {
        attachmentDescriptors: [],
        text: 'This remains the only accepted message.',
      },
      conversation: {
        accountId: 'telegram-account',
        actorId: 'telegram-actor',
        actorIsSelf: false,
        source: 'telegram',
        threadId: 'thread-1',
        threadIsDirect: false,
      },
      occurredAt: '2026-04-22T10:00:00.000Z',
      receivedAt: '2026-04-22T10:00:00.000Z',
      replyTarget: {
        channel: 'telegram',
        messageId: '987654322',
        threadId: 'thread-1',
      },
      sourceRef: createHostedMailboxSourceRef({
        eventId: 'evt_stale_reply_target',
        laneSeq: '1',
      }),
    },
  })
  const session = createAssistantSession()
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: true,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        response: 'This must not be delivered.',
        responseDeliveryContextOrdinal: 0,
        session,
        targetInputId: 'ain_ffffffffffffffffffffffffffffffff',
        transcriptResponse: 'This must not be delivered.',
      },
    },
    realMessageTargetSelection: true,
    session,
  })

  const result = await sendAssistantMessageLocal({
    acceptedTurnInput: {
      initialInputs: [
        assistantInputCandidateFromStoredEvent(acceptedMessage).acceptedInput,
      ],
    },
    deliverResponse: true,
    prompt: 'Attempt a stale target.',
    vault: context.vaultRoot,
  })

  expect(mocks.dispatchAssistantReply).not.toHaveBeenCalled()
  expect(result).toMatchObject({
    delivery: null,
    deliveryDeferred: false,
    deliveryError: {
      code: 'ASSISTANT_DELIVERY_FAILED',
      message: 'The selected message is not available for this action.',
    },
    deliveryIntentId: null,
  })
})

test('sendAssistantMessageLocal fails closed before reaction delivery when second-pass target authority is lost', async () => {
  const context = await createTempVaultContext(
    'assistant-local-service-stale-reaction-target-',
  )
  tempRoots.push(context.parentRoot)
  const acceptedMessage = await upsertAssistantInputEvent({
    vault: context.vaultRoot,
    now: new Date('2026-04-22T10:00:01.000Z'),
    event: {
      content: {
        attachmentDescriptors: [],
        text: 'This reaction target is accepted now.',
      },
      conversation: {
        accountId: 'telegram-account',
        actorId: 'telegram-actor',
        actorIsSelf: false,
        source: 'telegram',
        threadId: 'thread-1',
        threadIsDirect: false,
      },
      occurredAt: '2026-04-22T10:00:00.000Z',
      receivedAt: '2026-04-22T10:00:00.000Z',
      replyTarget: {
        channel: 'telegram',
        messageId: '987654323',
        threadId: 'thread-1',
      },
      sourceRef: createHostedMailboxSourceRef({
        eventId: 'evt_stale_reaction_target',
        laneSeq: '1',
      }),
    },
  })
  const session = createAssistantSession()
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    adapter: {
      setMessageReaction: vi.fn(async () => {
        throw new Error('Reaction adapter should not be called by this harness.')
      }),
    },
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        acceptedNoReplyDeliveryContextOrdinals: [0],
        onboardingGuidanceInjected: false,
        codexContinuation: {
          kind: 'explicit-structured-history',
        },
        finalAction: {
          kind: 'none',
        },
        reactions: [
          {
            deliveryContextOrdinal: 0,
            reaction: 'heart',
            targetInputId: 'ain_ffffffffffffffffffffffffffffffff',
          },
        ],
        response: 'suppressed provider text',
        responseDeliveryContextOrdinal: 0,
        session,
        transcriptResponse: null,
      },
    },
    realMessageTargetSelection: true,
    session,
  })

  const result = await sendAssistantMessageLocal({
    acceptedTurnInput: {
      initialInputs: [
        assistantInputCandidateFromStoredEvent(acceptedMessage).acceptedInput,
      ],
    },
    deliverResponse: true,
    prompt: 'Attempt a stale reaction target without replying.',
    vault: context.vaultRoot,
  })

  expect(mocks.dispatchAssistantReply).not.toHaveBeenCalled()
  expect(mocks.deliverAssistantReaction).not.toHaveBeenCalled()
  expect(result).toMatchObject({
    delivery: null,
    deliveryDeferred: false,
    deliveryError: {
      code: 'ASSISTANT_DELIVERY_FAILED',
      message: 'The selected message is not available for this action.',
    },
    deliveryIntentId: null,
    responseDisposition: 'none',
  })
})

test('sendAssistantMessageLocal carries the provider reaction patch into the no-reply fence', async () => {
  const context = await createTempVaultContext(
    'assistant-local-service-no-reply-reaction-fence-',
  )
  tempRoots.push(context.parentRoot)
  const storeLinqMessage = async (input: {
    eventId: string
    laneSeq: string
    messageId: string
    reactionEligible: boolean
    text: string
  }) => await upsertAssistantInputEvent({
    vault: context.vaultRoot,
    now: new Date('2026-04-22T10:00:03.000Z'),
    event: {
      content: {
        attachmentDescriptors: [],
        text: input.text,
      },
      conversation: {
        accountId: 'linq-account',
        actorId: `actor-${input.laneSeq}`,
        actorIsSelf: false,
        source: 'linq',
        threadId: 'thread-1',
        threadIsDirect: false,
      },
      occurredAt: `2026-04-22T10:00:0${input.laneSeq}.000Z`,
      receivedAt: `2026-04-22T10:00:0${input.laneSeq}.000Z`,
      replyTarget: {
        channel: 'linq',
        messageId: input.messageId,
        threadId: 'linq-chat-1',
      },
      sourceMetadata: {
        externalThreadRouteAuthorityPresent: true,
        kind: 'linq',
        partCount: 1,
        reactionEligible: input.reactionEligible,
        replyToMessageId: null,
        service: 'iMessage',
      },
      sourceRef: createHostedMailboxSourceRef({
        eventId: input.eventId,
        laneSeq: input.laneSeq,
      }),
    },
  })
  const olderEligibleMessage = await storeLinqMessage({
    eventId: 'evt_older_reaction_target',
    laneSeq: '1',
    messageId: 'linq-message-older-eligible',
    reactionEligible: true,
    text: 'Older reaction-eligible message.',
  })
  const newerIneligibleMessage = await storeLinqMessage({
    eventId: 'evt_newer_ineligible_ambient',
    laneSeq: '2',
    messageId: 'linq-message-newer-ineligible',
    reactionEligible: false,
    text: 'Newer ambient message with no reaction support.',
  })
  const session = createAssistantSession({
    binding: {
      actorId: null,
      channel: 'linq',
      conversationKey: null,
      delivery: {
        kind: 'thread',
        target: 'linq-chat-1',
      },
      identityId: 'linq-account',
      threadId: 'thread-1',
      threadIsDirect: false,
    },
    sessionId: 'session-no-reply-reaction-fence',
  })
  const plan = createSharedPlan()
  plan.conversationPolicy.audience = {
    actorId: null,
    bindingDelivery: {
      kind: 'thread',
      target: 'linq-chat-1',
    },
    channel: 'linq',
    deliveryPolicy: 'binding-target-only',
    effectiveThreadIsDirect: false,
    explicitTarget: 'linq-chat-1',
    identityId: 'linq-account',
    replyToMessageId: 'linq-message-newer-ineligible',
    threadId: 'thread-1',
    threadIsDirect: false,
  }
  const reactionOutcome: AssistantDeliveryOutcome = {
    error: null,
    intentId: 'intent-older-target-reaction',
    kind: 'queued',
    media: [],
    session,
  }
  const noReplyAccepted = vi.fn()
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    adapter: {
      setMessageReaction: vi.fn(async () => {
        throw new Error('Reaction adapter should not be called by this harness.')
      }),
    },
    plan,
    reactionOutcome,
    realMessageTargetSelection: true,
    session,
  })
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    await providerInput.onFinishWithoutReplyAccepted?.({
      deliveryContextOrdinal: 0,
      messageReactionPending: true,
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
        codexThreadId: 'provider-thread-no-reply-reaction-fence',
        finalAction: {
          kind: 'none',
        },
        rawEvents: [],
        reactions: [
          {
            deliveryContextOrdinal: 0,
            reaction: 'heart',
            targetInputId: olderEligibleMessage.inputId,
          },
        ],
        response: 'suppressed provider text',
        responseDeliveryContextOrdinal: 0,
        route: {
          routeId: 'route-no-reply-reaction-fence',
        },
        session,
        transcriptResponse: null,
      },
    }
  })

  const result = await sendAssistantMessageLocal({
    acceptedTurnInput: {
      initialInputs: [olderEligibleMessage, newerIneligibleMessage].map(
        (message) =>
          assistantInputCandidateFromStoredEvent(message).acceptedInput,
      ),
    },
    channel: 'linq',
    deliverResponse: true,
    deliveryMessageReactionsAvailable: false,
    deliveryReplyToMessageId: 'linq-message-newer-ineligible',
    deliveryTarget: 'linq-chat-1',
    identityId: 'linq-account',
    onFinishWithoutReplyAccepted: noReplyAccepted,
    prompt: 'React to the older message without replying.',
    threadId: 'thread-1',
    threadIsDirect: false,
    vault: context.vaultRoot,
  })

  expect(noReplyAccepted).toHaveBeenCalledWith({
    acceptedInputIds: [
      olderEligibleMessage.inputId,
      newerIneligibleMessage.inputId,
    ],
    deliveryContextOrdinal: 0,
    messageReactionPending: true,
  })
  expect(mocks.deliverAssistantReaction.mock.calls[0]?.[0]?.input).toMatchObject({
    deliveryReplyToMessageId: 'linq-message-older-eligible',
  })
  expect(mocks.dispatchAssistantReply).not.toHaveBeenCalled()
  expect(result).toMatchObject({
    deliveryDeferred: true,
    deliveryIntentId: 'intent-older-target-reaction',
    responseDisposition: 'none',
  })
})

test('sendAssistantMessageLocal records a diagnostic when a preceding answer fails and still sends the final reply', async () => {
  const { mocks, sendAssistantMessageLocal, session } =
    await loadLocalServiceModule({
      plan: createDirectSharedPlan(),
    })

  const sessionAfterPreceding = createAssistantSession({
    sessionId: 'session-after-preceding',
  })
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async () => ({
    kind: 'succeeded',
    providerTurn: {
      onboardingGuidanceInjected: false,
      codexContinuation: { kind: 'explicit-structured-history' },
      precedingResponseSegments: [
        {
          deliveryContextOrdinal: 0,
          response: 'Answer one.',
          media: [],
        },
      ],
      response: 'Answer two.',
      responseDeliveryContextOrdinal: 0,
      transcriptResponse: 'Answer two.',
      session,
    },
  }))
  mocks.deliverAssistantPrecedingReplies.mockResolvedValueOnce([
    {
      error: {
        code: 'ASSISTANT_DELIVERY_FAILED',
        message: 'segment delivery failed',
      },
      intentId: null,
      kind: 'failed',
      media: [],
      session: sessionAfterPreceding,
    },
  ])

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'First question',
    vault: '/vaults/test',
  })

  // The preceding-segment failure is diagnostic-only; the turn still
  // completes and the final reply still goes out.
  expect(result.response).toBe('Answer two.')
  expect(mocks.recordAssistantDiagnosticEvent.mock.calls.map((call) => call[0]))
    .toContainEqual(
      expect.objectContaining({
        code: 'ASSISTANT_DELIVERY_FAILED',
        kind: 'delivery.preceding-reply.failed',
        message: 'segment delivery failed',
        sessionId: 'session-after-preceding',
      }),
    )
  expect(mocks.dispatchAssistantReply).toHaveBeenCalledTimes(1)
  expect(mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.response)
    .toBe('Answer two.')
  // The final reply continues from the session returned by the last
  // preceding delivery outcome.
  expect(mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.session?.sessionId)
    .toBe('session-after-preceding')
})

test('sendAssistantMessageLocal still sends the final reply when preceding delivery throws', async () => {
  const { mocks, sendAssistantMessageLocal, session } =
    await loadLocalServiceModule({
      plan: createDirectSharedPlan(),
    })

  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async () => ({
    kind: 'succeeded',
    providerTurn: {
      onboardingGuidanceInjected: false,
      codexContinuation: { kind: 'explicit-structured-history' },
      precedingResponseSegments: [
        {
          deliveryContextOrdinal: 0,
          response: 'Answer one.',
          media: [],
        },
      ],
      response: 'Answer two.',
      responseDeliveryContextOrdinal: 0,
      transcriptResponse: 'Answer two.',
      session,
    },
  }))
  mocks.deliverAssistantPrecedingReplies.mockRejectedValueOnce(
    new Error('outbox intent write failed'),
  )

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'First question',
    vault: '/vaults/test',
  })

  // A thrown segment delivery is diagnostic-only, same as a failed outcome:
  // the final reply must still be dispatched and the turn must complete.
  expect(result.response).toBe('Answer two.')
  expect(result.status).toBe('completed')
  expect(mocks.recordAssistantDiagnosticEvent.mock.calls.map((call) => call[0]))
    .toContainEqual(
      expect.objectContaining({
        kind: 'delivery.preceding-reply.failed',
      }),
    )
  expect(mocks.dispatchAssistantReply).toHaveBeenCalledTimes(1)
  expect(mocks.dispatchAssistantReply.mock.calls[0]?.[0]?.response)
    .toBe('Answer two.')
})

test('sendAssistantMessageLocal fails blank provider output without explicit no-reply', async () => {
  const session = createAssistantSession({
    sessionId: 'session-empty-provider-output',
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        codexContinuation: { kind: 'explicit-structured-history' },
        response: '',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: null,
        session,
      },
    },
    session,
  })

  await assert.rejects(
    () =>
      sendAssistantMessageLocal({
        deliverResponse: true,
        prompt: 'blank provider output',
        vault: '/vaults/test',
      }),
    /completed without a final response/u,
  )

  expect(mocks.dispatchAssistantReply).not.toHaveBeenCalled()
  expect(mocks.finalizeDeliveredAssistantTurn).not.toHaveBeenCalled()
  expect(mocks.persistFailedAssistantPromptAttempt).toHaveBeenCalledTimes(1)
})

test('sendAssistantMessageLocal reports preceding delivery failure when no final reply exists', async () => {
  const session = createAssistantSession({
    sessionId: 'session-no-reply-preceding-failure',
  })
  const stopTyping = vi.fn(async () => undefined)
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    adapter: {
      startTypingIndicator: vi.fn(async () => ({
        stop: stopTyping,
      })),
    },
    plan: createDirectSharedPlan(),
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        codexContinuation: { kind: 'explicit-structured-history' },
        finalAction: {
          kind: 'none',
        },
        precedingResponseSegments: [
          {
            deliveryContextOrdinal: 0,
            response: 'Answer one.',
            media: [],
          },
        ],
        response: '',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: null,
        session,
      },
    },
    session,
  })
  mocks.deliverAssistantPrecedingReplies.mockResolvedValueOnce([
    {
      error: {
        code: 'ASSISTANT_DELIVERY_FAILED',
        message: 'preceding delivery failed',
      },
      intentId: 'intent-preceding-failed',
      kind: 'failed',
      media: [],
      session,
    },
  ])

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'ack later message',
    vault: '/vaults/test',
  })

  expect(result).toMatchObject({
    delivery: null,
    deliveryDeferred: false,
    deliveryError: {
      code: 'ASSISTANT_DELIVERY_FAILED',
      message: 'preceding delivery failed',
    },
    deliveryIntentId: 'intent-preceding-failed',
    response: '',
  })
  expect(result.responseDisposition).toBeUndefined()
  expect(mocks.dispatchAssistantReply).not.toHaveBeenCalled()
  expect(mocks.finalizeDeliveredAssistantTurn.mock.calls[0]?.[0]?.outcome)
    .toMatchObject({
      kind: 'failed',
      intentId: 'intent-preceding-failed',
    })
  expect(stopTyping).toHaveBeenCalledWith({
    providerStop: true,
  })
})

test('sendAssistantMessageLocal reports preceding queued delivery when no final reply exists', async () => {
  const session = createAssistantSession({
    sessionId: 'session-no-reply-preceding-queued',
  })
  const stopTyping = vi.fn(async () => undefined)
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    adapter: {
      startTypingIndicator: vi.fn(async () => ({
        stop: stopTyping,
      })),
    },
    plan: createDirectSharedPlan(),
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        codexContinuation: { kind: 'explicit-structured-history' },
        finalAction: {
          kind: 'none',
        },
        precedingResponseSegments: [
          {
            deliveryContextOrdinal: 0,
            response: 'Answer one.',
            media: [],
          },
        ],
        response: '',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: null,
        session,
      },
    },
    session,
  })
  mocks.deliverAssistantPrecedingReplies.mockResolvedValueOnce([
    {
      error: {
        code: 'ASSISTANT_DELIVERY_DEFERRED',
        message: 'preceding delivery queued',
      },
      intentId: 'intent-preceding-queued',
      kind: 'queued',
      media: [],
      session,
    },
  ])

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'ack later message',
    vault: '/vaults/test',
  })

  expect(result).toMatchObject({
    delivery: null,
    deliveryDeferred: true,
    deliveryError: {
      code: 'ASSISTANT_DELIVERY_DEFERRED',
      message: 'preceding delivery queued',
    },
    deliveryIntentId: 'intent-preceding-queued',
    response: '',
  })
  expect(result.responseDisposition).toBeUndefined()
  expect(mocks.dispatchAssistantReply).not.toHaveBeenCalled()
  expect(mocks.finalizeDeliveredAssistantTurn.mock.calls[0]?.[0]?.outcome)
    .toMatchObject({
      kind: 'queued',
      intentId: 'intent-preceding-queued',
    })
  expect(stopTyping).toHaveBeenCalledWith({
    providerStop: false,
  })
})

test('sendAssistantMessageLocal reports thrown preceding delivery when no final reply exists', async () => {
  const session = createAssistantSession({
    sessionId: 'session-no-reply-preceding-throw',
  })
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: createDirectSharedPlan(),
    providerOutcome: {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        codexContinuation: { kind: 'explicit-structured-history' },
        finalAction: {
          kind: 'none',
        },
        precedingResponseSegments: [
          {
            deliveryContextOrdinal: 0,
            response: 'Answer one.',
            media: [],
          },
        ],
        response: '',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: null,
        session,
      },
    },
    session,
  })
  mocks.deliverAssistantPrecedingReplies.mockRejectedValueOnce(
    new Error('preceding delivery threw'),
  )

  const result = await sendAssistantMessageLocal({
    deliverResponse: true,
    prompt: 'ack later message',
    vault: '/vaults/test',
  })

  expect(result).toMatchObject({
    delivery: null,
    deliveryDeferred: false,
    deliveryError: {
      code: 'ASSISTANT_DELIVERY_FAILED',
      message: 'preceding delivery threw',
    },
    deliveryIntentId: null,
    response: '',
  })
  expect(result.responseDisposition).toBeUndefined()
  expect(mocks.dispatchAssistantReply).not.toHaveBeenCalled()
  expect(mocks.finalizeDeliveredAssistantTurn.mock.calls[0]?.[0]?.outcome)
    .toMatchObject({
      kind: 'failed',
    })
})

test('sendAssistantMessageLocal surfaces the provider setup sub-split on onProviderRequestStarted', async () => {
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule()
  let providerStartCriticalPath:
    | AssistantProviderStartCriticalPathContext
    | null
    | undefined

  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (providerInput) => {
    providerStartCriticalPath = providerInput.providerStartCriticalPath
    await providerInput.onProviderRequestStarted?.({
      codexAppServerInitializeMs: 7,
      codexAppServerPreProviderMs: 17,
      codexAppServerSpawnReadyMs: 1,
      codexAppServerThreadResumeMs: 9,
      codexAppServerWarmReuseMs: 0,
      providerRequestOrdinal: 0,
      startedAt: '2026-06-09T00:00:00.000Z',
    })
    return {
      kind: 'succeeded',
      providerTurn: {
        onboardingGuidanceInjected: false,
        codexContinuation: { kind: 'explicit-structured-history' },
        response: 'done',
        responseDeliveryContextOrdinal: 0,
        transcriptResponse: 'done',
        session: createAssistantSession({ sessionId: 'session-split' }),
      },
    }
  })

  const providerRequestStarted = vi.fn()
  await sendAssistantMessageLocal({
    deliverResponse: false,
    onProviderRequestStarted: providerRequestStarted,
    providerStartCriticalPath: {
      assistantPhaseStartedAtMonotonicMs: 0,
      automationCandidateScanDoneAtMonotonicMs: 0,
      automationCrossSessionContextDoneAtMonotonicMs: 0,
      automationGroupAndOperationScopeDoneAtMonotonicMs: 0,
      automationInputSelectionDoneAtMonotonicMs: 0,
      automationLaneStartedAtMonotonicMs: 0,
      automationPassSetupDoneAtMonotonicMs: 0,
      automationPromptPreparationDoneAtMonotonicMs: 0,
      automationReadinessDoneAtMonotonicMs: 0,
      automationSessionPreflightDoneAtMonotonicMs: 0,
      automationTerminalEvidenceDoneAtMonotonicMs: 0,
      mailboxImportDoneAtMonotonicMs: 0,
    },
    prompt: 'Measure setup split',
    vault: '/vaults/test',
  })

  expect(providerRequestStarted).toHaveBeenCalledTimes(1)
  expect(providerStartCriticalPath).toEqual(expect.objectContaining({
    assistantServiceStartedAtMonotonicMs: expect.any(Number),
    assistantTurnLockAcquiredAtMonotonicMs: expect.any(Number),
    assistantTurnLockWaitStartedAtMonotonicMs: expect.any(Number),
    automationCandidateScanDoneAtMonotonicMs: 0,
    automationCrossSessionContextDoneAtMonotonicMs: 0,
    automationGroupAndOperationScopeDoneAtMonotonicMs: 0,
    automationInputSelectionDoneAtMonotonicMs: 0,
    automationLaneStartedAtMonotonicMs: 0,
    automationPassSetupDoneAtMonotonicMs: 0,
    automationPromptPreparationDoneAtMonotonicMs: 0,
    automationReadinessDoneAtMonotonicMs: 0,
    automationSessionPreflightDoneAtMonotonicMs: 0,
    automationTerminalEvidenceDoneAtMonotonicMs: 0,
    preProviderSetupDoneAtMonotonicMs: expect.any(Number),
  }))
  expect(
    providerStartCriticalPath?.assistantTurnLockWaitStartedAtMonotonicMs ?? -1,
  ).toBeGreaterThanOrEqual(
    providerStartCriticalPath?.assistantServiceStartedAtMonotonicMs ?? 0,
  )
  expect(
    providerStartCriticalPath?.assistantTurnLockAcquiredAtMonotonicMs ?? -1,
  ).toBeGreaterThanOrEqual(
    providerStartCriticalPath?.assistantTurnLockWaitStartedAtMonotonicMs ?? 0,
  )
  expect(
    providerStartCriticalPath?.preProviderSetupDoneAtMonotonicMs ?? -1,
  ).toBeGreaterThanOrEqual(
    providerStartCriticalPath?.assistantTurnLockAcquiredAtMonotonicMs ?? 0,
  )
  expect(mocks.recordAssistantUsageEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      occurredAt: '2026-06-09T00:00:00.000Z',
    }),
  )
  const event = providerRequestStarted.mock.calls[0]?.[0] as {
    admissionMs: number
    codexAppServerInitializeMs: number
    codexAppServerPreProviderMs: number
    codexAppServerSpawnReadyMs: number
    codexAppServerThreadResumeMs: number
    codexAppServerWarmReuseMs: number
    preProviderSetupMs: number
    promptBuildMs: number
    sessionResolveMs: number
    turnLockWaitMs: number
  }
  expect(typeof event.turnLockWaitMs).toBe('number')
  expect(event.codexAppServerInitializeMs).toBe(7)
  expect(event.codexAppServerPreProviderMs).toBe(17)
  expect(event.codexAppServerSpawnReadyMs).toBe(1)
  expect(event.codexAppServerThreadResumeMs).toBe(9)
  expect(event.codexAppServerWarmReuseMs).toBe(0)
  expect(typeof event.sessionResolveMs).toBe('number')
  expect(typeof event.promptBuildMs).toBe('number')
  expect(typeof event.admissionMs).toBe('number')
  expect(typeof event.preProviderSetupMs).toBe('number')
  // preProviderSetupMs spans from lock acquisition through pre-provider admission,
  // so it must be at least the sum of the sub-stages measured within that window.
  expect(event.preProviderSetupMs).toBeGreaterThanOrEqual(
    event.sessionResolveMs + event.promptBuildMs + event.admissionMs,
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
  // The automation pass owns maintenance for auto-reply turns.
  assert.equal(mocks.maybeRunAssistantRuntimeMaintenance.mock.calls.length, 0)
})

test('sendAssistantMessageLocal keeps automation cron turns on the session Codex thread', async () => {
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
      threadScope: 'session-thread',
    },
  )
  assert.equal(
    mocks.finalizeAssistantTurnArtifacts.mock.calls[0]?.[0]
      ?.providerResumeStateAction,
    'persist-from-provider-turn',
  )
  assert.equal(mocks.maybeRunAssistantRuntimeMaintenance.mock.calls.length, 1)
})

test('sendAssistantMessageLocal prefers the hosted execution default target when resolving the session', async () => {
  const hostedDefaultTarget = createCodexTarget({
    model: 'gpt-5.6-terra-mini',
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
