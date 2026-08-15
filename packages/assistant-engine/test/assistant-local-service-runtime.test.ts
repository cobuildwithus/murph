import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

import { afterEach, expect, test, vi } from 'vitest'

import type {
  AssistantResponseMedia,
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import type {
  AssistantResponseCard,
} from '@murphai/operator-config/assistant-response-cards'
import type {
  HostedRuntimeProductFeedbackRecord,
} from '@murphai/hosted-execution/runtime-control'
import type { AssistantChannelAdapter } from '../src/assistant/channel-adapters.ts'
import {
  readAssistantAcceptedTurnInputJournal,
  resolveAssistantAcceptedTurnInputJournalPath,
  resolveAssistantAcceptedTurnInputReferenceWindow,
  type AssistantAcceptedTurnInputItemInput,
  type AssistantCodexContinuation,
} from '../src/assistant/active-turn-input-journal.ts'
import type {
  AssistantDeliveryOutcome,
  AssistantTurnSharedPlan,
} from '../src/assistant/service-contracts.ts'
import {
  type AssistantActiveTurnInputAdmissionHook,
  type AssistantActiveTurnInputCheckpointInput,
} from '../src/assistant/turn-input.js'
import type {
  AssistantNoReplyDisposition,
  AssistantProviderUsage,
} from '../src/assistant/providers/types.ts'
import {
  readAssistantInputEvent,
  upsertAssistantInputEvent,
} from '../src/assistant/input-store.ts'
import {
  assistantInputCandidateFromStoredEvent,
  createStoreBackedAssistantInputSource,
} from '../src/assistant/input-source.ts'
import {
  readAutomationDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools/automation.ts'
import { resolveAssistantConversationKey } from '../src/assistant/bindings.ts'
import {
  ASSISTANT_IMAGE_RESPONSE_TRANSCRIPT_MARKER,
} from '../src/assistant/response-media.ts'
import type {
  AssistantProviderStartCriticalPathContext,
} from '../src/assistant/provider-start-critical-path.ts'
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
const TRACKED_COMPACT_TABLE_RESPONSE_CARD: AssistantResponseCard = {
  kind: 'compact_table',
  version: 1,
  title: 'Strength session',
  subtitle: null,
  rowHeader: 'Exercise',
  columns: ['Set 1'],
  rows: [{ label: 'Bench press', values: ['185 lb × 8'] }],
  footer: null,
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-04T21:30:00.000Z',
  },
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
  vi.doUnmock('../src/assistant/runtime-budgets.js')
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
    providerInput.activeTurnSteering?.closeInputAdmission()
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
        liveSteeredPrompts.push(input.prompt)
      },
      turnId: 'turn-1',
    })
    providerStarted.resolve()
    await toolExecutionRequested.promise
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
  const hostedInput = await upsertAssistantInputEvent({
    vault: context.vaultRoot,
    now: new Date('2031-02-15T10:00:00.100Z'),
    event: {
      content: {
        attachmentDescriptors: [],
        text: 'Event-backed follow up',
      },
      conversation: {
        accountId: 'acct_1',
        actorId: 'actor_1',
        actorIsSelf: false,
        source: 'linq',
        threadId: 'thread-1',
        threadIsDirect: true,
      },
      occurredAt: '2031-02-15T09:59:58.000Z',
      receivedAt: '2031-02-15T09:59:59.900Z',
      replyTarget: {
        channel: 'linq',
        messageId: 'message-event-steer',
        threadId: 'thread-1',
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
  const sharedPlan = createDirectSharedPlan()
  sharedPlan.conversationPolicy.audience.channel = 'linq'
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan: {
      ...sharedPlan,
      persistUserPromptOnFailure: false,
    },
    realAcceptedInputPersistence: true,
    session,
  })
  const { notifyAssistantActiveTurnInputAvailable } = await import(
    '../src/assistant/active-turn-input-controller.ts'
  )
  mocks.deliverAssistantProgressUpdate.mockImplementationOnce(
    async (progressInput) => {
      await progressInput.dependencies?.sendLinq?.({
        message: progressInput.text,
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
  ).toEqual(['initial', hostedInput.inputId])
  expect(providerRequestStarted).toHaveBeenCalledTimes(1)
  expect(progressDeliveryDependencies.sendLinq).toHaveBeenCalledWith(
    expect.objectContaining({
      acceptedAssistantInputIds: ['initial', hostedInput.inputId],
      message: 'Checking the live-steered follow up.',
    }),
  )
  providerRelease.resolve()

  await expect(resultPromise).resolves.toMatchObject({
    prompt: 'Event-backed follow up',
    response: 'final after event input',
  })
  assert.equal(mocks.executeCodexTurnWithRecovery.mock.calls.length, 1)
  assert.equal(activeTurnInput.mock.calls.length, 2)
  const journal = await readAssistantAcceptedTurnInputJournal(
    context.vaultRoot,
    'turn-1',
  )
  expect(journal?.inputIds).toEqual(['initial', hostedInput.inputId])
  expect(journal?.providerRequests).toHaveLength(1)
  expect(journal?.providerRequests[0]?.acceptedInputIds).toEqual([
    'initial',
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
        responseDeliveryContextOrdinal: 1,
        transcriptResponse: 'final after live-steered input',
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
  assert.equal(activeTurnInput.mock.calls.length, 1)
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

test('sendAssistantMessageLocal enables hosted computer tools for Telegram when provider fetch and delivery are available', async () => {
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
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
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
      model: 'gpt-5.6-terra',
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
      model: 'gpt-5.6-terra',
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
      model: 'gpt-5.6-terra',
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
  assert.equal(mocks.saveAssistantSession.mock.calls[0]?.[1]?.target?.model, 'gpt-5.6-terra')
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
  adapter?: Pick<
    AssistantChannelAdapter,
    'setMessageReaction' | 'startTypingIndicator'
  > | null
  realAcceptedInputPersistence?: boolean
  realMessageTargetSelection?: boolean
  useRealRuntimeMaintenance?: boolean
  plan?: ReturnType<typeof createSharedPlan>
  providerOutcome?:
    | {
        acceptedNoReplyDeliveryContextOrdinals?: readonly number[] | null
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
          routeFingerprint?: string
          routeId?: string
        }
        reactions?: readonly {
          deliveryContextOrdinal: number
          reaction: 'heart' | 'laugh' | 'thumbs_up'
          targetInputId: string
        }[] | null
        session: AssistantSession
        usage: AssistantProviderUsage | null
        usageAttribution: null
      }
    | {
        kind: 'succeeded'
        providerTurn: {
          acceptedNoReplyDeliveryContextOrdinals?: readonly number[] | null
          onboardingGuidanceInjected: boolean
          codexContinuation: AssistantCodexContinuation
          codexThreadId?: string | null
          finalAction?: AssistantNoReplyDisposition
          precedingResponseSegments?: readonly {
            deliveryContextOrdinal: number
            media?: AssistantDeliveryOutcome['media']
            response: string
            transcriptResponse?: string | null
          }[]
          reactions?: readonly {
            deliveryContextOrdinal: number
            reaction: 'heart' | 'laugh' | 'thumbs_up'
            targetInputId: string
          }[] | null
          rawEvents?: unknown[]
          productFeedbackCandidate?: HostedRuntimeProductFeedbackRecord | null
          route?: {
            routeId?: string
          }
          response: string
          responseDeliveryContextOrdinal: number
          responseMedia?: readonly AssistantResponseMedia[] | null
          responseCard?: AssistantResponseCard | null
          session: AssistantSession
          targetInputId?: string | null
          transcriptResponse: string | null
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
    media?: AssistantDeliveryOutcome['media']
    session: AssistantSession
  }
  reactionOutcome?: AssistantDeliveryOutcome
  route?: {
    provider: string
    providerOptions?: {
      model?: string | null
    } | null
  }
  session?: AssistantSession
  sessionCreated?: boolean
  transcriptEntries?: Array<{
    createdAt?: string | null
  }>
}) {
  const session = input?.session ?? createAssistantSession()
  const sharedPlan = input?.plan ?? createSharedPlan()
  const useRealAcceptedInputPersistence = input?.realAcceptedInputPersistence === true
  const useRealMessageTargetSelection =
    input?.realMessageTargetSelection === true
  const useRealRuntimeMaintenance = input?.useRealRuntimeMaintenance === true
  const realStore = await vi.importActual<typeof import('../src/assistant/store.js')>(
    '../src/assistant/store.js',
  )
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
        responseDeliveryContextOrdinal: 0,
        route: {
          routeId: 'route-default',
        },
        session,
        transcriptResponse: 'assistant response',
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
      media: [],
      session,
    }
  const acceptedInputIds: string[] = []
  const acceptedInputs: AssistantAcceptedTurnInputItemInput[] = []
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
    deliverAssistantPrecedingReplies: vi.fn(
      async (
        _input: Parameters<
          typeof import('../src/assistant/delivery-service.js').deliverAssistantPrecedingReplies
        >[0],
      ): Promise<AssistantDeliveryOutcome[]> => [],
    ),
    deliverAssistantProgressUpdate: vi.fn(
      async (
        progressInput: Parameters<
          typeof import('../src/assistant/delivery-service.js').deliverAssistantProgressUpdate
        >[0],
      ) => progressInput.session,
    ),
    deliverAssistantReaction: vi.fn(
      async (
        _input: Parameters<
          typeof import('../src/assistant/delivery-service.js').deliverAssistantReaction
        >[0],
      ) => input?.reactionOutcome ?? deliveryOutcome,
    ),
    dispatchAssistantReply: vi.fn(
      async (
        _input: Parameters<
          typeof import('../src/assistant/delivery-service.js').deliverAssistantReply
        >[0],
      ) => deliveryOutcome,
    ),
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
        finalizeInput: Parameters<
          typeof import('../src/assistant/turn-finalizer.js').persistAssistantTurnAndSession
        >[0],
      ) => finalizeInput.session,
    ),
    applyAssistantSessionCodexResumeStateAction: vi.fn(
      async (
        actionInput: Parameters<
          typeof import('../src/assistant/turn-finalizer.js').applyAssistantSessionCodexResumeStateAction
        >[0],
      ) => {
        if (actionInput.action === 'preserve-existing') {
          return actionInput.session
        }
        if (actionInput.action === 'clear') {
          return await mocks.clearAssistantSessionCodexResumeState({
            session: actionInput.session,
            vault: actionInput.vault,
          })
        }
        if (!actionInput.codexThreadId || !actionInput.routeFingerprint) {
          return actionInput.session
        }
        const resumeState = {
          ...(actionInput.assistantContractFingerprint
            ? {
                assistantContractFingerprint:
                  actionInput.assistantContractFingerprint,
              }
            : {}),
          ...(actionInput.codexRolloutRelativePath
            ? { rolloutRelativePath: actionInput.codexRolloutRelativePath }
            : {}),
          routeFingerprint: actionInput.routeFingerprint,
          threadId: actionInput.codexThreadId,
        }
        return await mocks.saveAssistantSession(actionInput.vault, {
          ...actionInput.session,
          codexResume: resumeState,
          resumeState,
          updatedAt: new Date().toISOString(),
        })
      },
    ),
    clearAssistantSessionCodexResumeState: vi.fn(
      async (
        clearInput: Parameters<
          typeof import('../src/assistant/turn-finalizer.js').clearAssistantSessionCodexResumeState
        >[0],
      ) => clearInput.session,
    ),
    persistAssistantNoReplyTranscriptMarkers: vi.fn(
      async (
        _input: Parameters<
          typeof import('../src/assistant/turn-finalizer.js').persistAssistantNoReplyTranscriptMarkers
        >[0],
      ) => undefined,
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
    resolveAssistantAcceptedMessageTarget: vi.fn(async (targetInput: {
      action: 'native-reply' | 'participant-effect' | 'reaction'
      messageRef: string
    }) => ({
      ...(targetInput.action === 'reaction'
        ? { deliveryMessageReactionsAvailable: true as const }
        : {}),
      deliveryReplyToMessageId: 'provider-message-target',
      targetInputId: targetInput.messageRef,
    })),
    resolveAssistantAcceptedMessageParticipant: vi.fn(async (targetInput: {
      acceptedInputIds: readonly string[]
      messageRef: string
    }) => {
      expect(targetInput.acceptedInputIds).toContain(targetInput.messageRef)
      return {
        participant: {
          assistantInputId: targetInput.messageRef,
          senderHandle: 'telegram-sender',
          source: 'telegram' as const,
        },
        targetInputId: targetInput.messageRef,
      }
    }),
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
    recordAdditionalAssistantUsageEvents: vi.fn(
      async (_input: {
        providerRequestAcceptedInputIds?: readonly string[]
        providerRequestOrdinal?: number
      }) => undefined,
    ),
    recordAssistantUsageEvent: vi.fn(
      async (_input: {
        providerRequestAcceptedInputIds?: readonly string[]
        providerRequestOrdinal?: number
      }) => undefined,
    ),
    runtimeState: {
      turns: {
        acceptedInputs: {
          append: vi.fn(
            async (appendInput: {
              inputs: readonly AssistantAcceptedTurnInputItemInput[]
            }) => {
              for (const acceptedInput of appendInput.inputs) {
                if (!acceptedInputIds.includes(acceptedInput.id)) {
                  acceptedInputIds.push(acceptedInput.id)
                  acceptedInputs.push(acceptedInput)
                }
              }
              return {
                admissionState: 'current-turn-open' as const,
                inputIds: [...acceptedInputIds],
                inputs: [...acceptedInputs],
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
              inputs: [...acceptedInputs],
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
              inputs: [...acceptedInputs],
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
              inputs: [...acceptedInputs],
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
    maybeRunAssistantRuntimeMaintenance: vi.fn(
      async (
        _input: Parameters<
          typeof import('../src/assistant/runtime-budgets.js').maybeRunAssistantRuntimeMaintenance
        >[0],
      ) => undefined,
    ),
    redactAssistantDisplayPath: vi.fn(() => '<redacted-vault>'),
    refreshAssistantStatusSnapshotLocal: vi.fn(async () => undefined),
    saveAssistantSession: vi.fn(
      async (
        _vault: Parameters<
          typeof import('../src/assistant/store.js').saveAssistantSession
        >[0],
        nextSession: Parameters<
          typeof import('../src/assistant/store.js').saveAssistantSession
        >[1],
      ) => nextSession,
    ),
    resolveAssistantSession: vi.fn(),
    resolveAssistantMessageSession: vi.fn(async () => ({
      created: input?.sessionCreated === true,
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
        codexCommand?: string | null
        codexHome?: string | null
        model?: string | null
        modelProvider?: string | null
        oss?: boolean
        profile?: string | null
      } | null
    }) => {
      const provider = input.target ? 'codex-cli' : input.provider

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
      readAssistantAutomationState: realStore.readAssistantAutomationState,
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
    deliverAssistantPrecedingReplies: mocks.deliverAssistantPrecedingReplies,
    deliverAssistantReaction: mocks.deliverAssistantReaction,
    deliverAssistantReply: mocks.dispatchAssistantReply,
    deliverAssistantProgressUpdate: mocks.deliverAssistantProgressUpdate,
    finalizeAssistantTurnFromDeliveryOutcome: mocks.finalizeDeliveredAssistantTurn,
    resolveAssistantCurrentAudienceDeliveryFields: vi.fn(
      (input: Parameters<
        typeof import('../src/assistant/delivery-service.js').resolveAssistantCurrentAudienceDeliveryFields
      >[0]) => {
        const audience = input.sharedPlan.conversationPolicy.audience
        const binding = input.session.binding
        const message = input.input
        const actorId =
          audience.actorId ?? binding.actorId ?? message.actorId ??
          message.participantId ?? null
        const channel = audience.channel ?? binding.channel ?? message.channel ?? null
        const identityId =
          audience.identityId ?? binding.identityId ?? message.identityId ?? null
        const threadId =
          audience.threadId ?? binding.threadId ?? message.threadId ?? null
        return {
          actorId,
          bindingDelivery:
            audience.bindingDelivery ??
            binding.delivery ??
            null,
          channel,
          deliverySource: message.deliverySource ?? null,
          explicitTarget: message.deliveryTarget === undefined
            ? audience.explicitTarget ?? null
            : message.deliveryTarget,
          identityId,
          replyToMessageId:
            message.deliveryReplyToMessageId === undefined
              ? audience.replyToMessageId ?? null
              : message.deliveryReplyToMessageId,
          sessionId: input.session.sessionId,
          subject: message.deliverySubject ?? null,
          threadId,
          threadIsDirect:
            audience.threadIsDirect ??
            binding.threadIsDirect ??
            message.threadIsDirect ??
            null,
        }
      },
    ),
    supportsAssistantCurrentAudienceMessageReaction: vi.fn(() => false),
  }))
  vi.doMock('../src/assistant/turn-finalizer.js', () => ({
    applyAssistantSessionCodexResumeStateAction:
      mocks.applyAssistantSessionCodexResumeStateAction,
    clearAssistantSessionCodexResumeState:
      mocks.clearAssistantSessionCodexResumeState,
    persistAssistantNoReplyTranscriptMarkers:
      mocks.persistAssistantNoReplyTranscriptMarkers,
    persistAssistantTurnAndSession: mocks.finalizeAssistantTurnArtifacts,
    resolveAssistantProviderResumeStateAction: (actionInput: {
      codexThreadId: string | null
      threadScope: 'isolated-thread' | 'session-thread'
    }) => actionInput.threadScope === 'isolated-thread'
      ? 'preserve-existing'
      : actionInput.codexThreadId
        ? 'persist-from-provider-turn'
        : 'clear',
    resolveAssistantResumeStateFromProviderTurn: (input: {
      assistantContractFingerprint?: string | null
      codexRolloutRelativePath?: string | null
      codexThreadId: string | null
      routeFingerprint: string
    }) => input.codexThreadId && input.routeFingerprint
      ? {
          ...(input.assistantContractFingerprint
            ? { assistantContractFingerprint: input.assistantContractFingerprint }
            : {}),
          ...(input.codexRolloutRelativePath
            ? { rolloutRelativePath: input.codexRolloutRelativePath }
            : {}),
          routeFingerprint: input.routeFingerprint,
          threadId: input.codexThreadId,
        }
      : null,
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
  if (useRealMessageTargetSelection) {
    vi.doUnmock('../src/assistant/message-target-selection.js')
  } else {
    vi.doMock('../src/assistant/message-target-selection.js', async () => ({
      ...(await vi.importActual<
        typeof import('../src/assistant/message-target-selection.js')
      >('../src/assistant/message-target-selection.js')),
      resolveAssistantAcceptedMessageTarget:
        mocks.resolveAssistantAcceptedMessageTarget,
      resolveAssistantAcceptedMessageParticipant:
        mocks.resolveAssistantAcceptedMessageParticipant,
    }))
  }
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
    recordAdditionalAssistantUsageEvents: mocks.recordAdditionalAssistantUsageEvents,
    recordAssistantUsageEvent: mocks.recordAssistantUsageEvent,
  }))
  if (!useRealRuntimeMaintenance) {
    vi.doMock('../src/assistant/runtime-budgets.js', () => ({
      maybeRunAssistantRuntimeMaintenance:
        mocks.maybeRunAssistantRuntimeMaintenance,
    }))
  }
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
  const binding = input?.binding ?? {
    actorId: null,
    channel: 'telegram',
    conversationKey: null,
    delivery: {
      kind: 'thread' as const,
      target: 'thread-1',
    },
    identityId: 'identity-1',
    threadId: 'thread-1',
    threadIsDirect: false,
  }
  return {
    alias: null,
    binding: binding.conversationKey === null
      ? binding
      : {
          ...binding,
          conversationKey: resolveAssistantConversationKey({
            actorId: binding.actorId,
            channel: binding.channel,
            identityId: binding.identityId,
            threadId: binding.threadId,
            threadIsDirect: binding.threadIsDirect,
          }),
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
      model: 'gpt-5.6-terra',
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
    model: 'gpt-5.6-terra',
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
        channel: 'telegram',
        deliveryPolicy: 'binding-target-only',
        effectiveThreadIsDirect: false,
        explicitTarget: 'thread-1',
        identityId: 'identity-1',
        replyToMessageId: null,
        threadId: 'thread-1',
        threadIsDirect: false,
      },
      operatorAuthority: 'direct-operator',
    },
    onboardingGuidanceOpen: false,
    firstContactStateDocIds: ['doc-1'],
    operatorAuthority: 'direct-operator',
    persistUserPromptOnFailure: true,
    requestedWorkingDirectory: '/workspace',
  }
}

function createDirectSharedPlan(): AssistantTurnSharedPlan {
  const plan = createSharedPlan()
  return {
    ...plan,
    conversationPolicy: {
      ...plan.conversationPolicy,
      audience: {
        ...plan.conversationPolicy.audience,
        effectiveThreadIsDirect: true,
        threadIsDirect: true,
      },
    },
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

function makeRuntimeEvent(index: number) {
  return {
    at: `2026-04-08T10:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(
      index % 60,
    ).padStart(2, '0')}.000Z`,
    component: 'test',
    dataJson: null,
    entityId: `entity-${index}`,
    entityType: 'session',
    kind: 'runtime.maintenance' as const,
    level: 'info' as const,
    message: `event-${index}`,
    schema: 'murph.assistant-runtime-event.v1' as const,
  }
}
