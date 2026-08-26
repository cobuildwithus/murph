import { rm } from 'node:fs/promises'

import {
  afterEach,
  expect,
  type Mock,
  type MockedFunction,
  vi,
} from 'vitest'

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
  type AssistantAcceptedTurnInputItemInput,
  type AssistantCodexContinuation,
} from '../src/assistant/active-turn-input-journal.ts'
import type {
  AssistantDeliveryOutcome,
  AssistantTurnSharedPlan,
} from '../src/assistant/service-contracts.ts'
import type {
  AssistantNoReplyDisposition,
  AssistantProviderUsage,
} from '../src/assistant/providers/types.ts'
import { resolveAssistantConversationKey } from '../src/assistant/bindings.ts'

type CodexAssistantTarget = Extract<
  AssistantSession['target'],
  { adapter: 'codex-cli' }
>

export type Deferred<T> = {
  promise: Promise<T>
  reject(error: unknown): void
  resolve(value: T): void
}

type LocalServiceMockName =
  | 'appendAssistantTranscriptEntries'
  | 'appendAssistantTranscriptEntriesWithRefs'
  | 'appendAssistantTurnReceiptEvent'
  | 'clearAssistantSessionCodexResumeState'
  | 'createAssistantTurnReceipt'
  | 'deliverAssistantPrecedingReplies'
  | 'deliverAssistantProgressUpdate'
  | 'deliverAssistantReaction'
  | 'dispatchAssistantReply'
  | 'executeCodexTurnWithRecovery'
  | 'finalizeAssistantTurnArtifacts'
  | 'finalizeAssistantTurnReceipt'
  | 'finalizeDeliveredAssistantTurn'
  | 'getAssistantChannelAdapter'
  | 'maybeRunAssistantRuntimeMaintenance'
  | 'normalizeAssistantDeliveryError'
  | 'persistAssistantNoReplyTranscriptMarkers'
  | 'persistFailedAssistantPromptAttempt'
  | 'recordAdditionalAssistantUsageEvents'
  | 'recordAssistantDiagnosticEvent'
  | 'recordAssistantUsageEvent'
  | 'refreshAssistantStatusSnapshotLocal'
  | 'resolveAssistantAcceptedMessageTarget'
  | 'resolveAssistantExecutionDefaultTarget'
  | 'resolveAssistantMessageSession'
  | 'resolveAssistantOperatorDefaults'
  | 'resolveAssistantSession'
  | 'saveAssistantSession'
  | 'withAssistantTurnLock'

type AppendAssistantTranscriptEntriesWithRefs = (
  ...args: Parameters<
    typeof import('../src/assistant/store.js').appendAssistantTranscriptEntries
  >
) => Promise<unknown>

type AppendAssistantTranscriptEntries = (
  ...args: Parameters<
    typeof import('../src/assistant/store.js').appendAssistantTranscriptEntries
  >
) => Promise<Array<{ createdAt?: string | null }>>

type ExecuteCodexTurnTestDouble = (
  input: Parameters<
    typeof import('../src/assistant/codex-turn-runner.js').executeCodexTurnWithRecovery
  >[0],
) => Promise<unknown>

type RecordAdditionalAssistantUsageEventsTestDouble = (
  input: Parameters<
    typeof import('../src/assistant/service-usage.js').recordAdditionalAssistantUsageEvents
  >[0],
) => Promise<unknown>

type TypedLocalServiceMocks = {
  appendAssistantTranscriptEntries: MockedFunction<
    AppendAssistantTranscriptEntries
  >
  appendAssistantTranscriptEntriesWithRefs: MockedFunction<
    AppendAssistantTranscriptEntriesWithRefs
  >
  executeCodexTurnWithRecovery: MockedFunction<
    ExecuteCodexTurnTestDouble
  >
  recordAdditionalAssistantUsageEvents: MockedFunction<
    RecordAdditionalAssistantUsageEventsTestDouble
  >
}

type LoadedLocalServiceModule =
  typeof import('../src/assistant/local-service.ts') & {
    deliveryOutcome: unknown
    mocks: Record<Exclude<LocalServiceMockName, keyof TypedLocalServiceMocks>, Mock> &
      TypedLocalServiceMocks & {
      runtimeState: {
        turns: {
          acceptedInputs: Record<string, Mock>
        }
      }
    }
    resetAcceptedInputJournal(): void
    session: AssistantSession
  }

export const tempRoots: string[] = []
export const CODEX_MODEL_PROVIDER_CONFIG = {
  id: 'vercel-ai-gateway',
  name: 'Vercel AI Gateway',
  baseUrl: 'https://ai-gateway.vercel.sh/v1',
  envKey: 'VERCEL_AI_API_KEY',
  wireApi: 'responses' as const,
}
export const TRACKED_COMPACT_TABLE_RESPONSE_CARD: AssistantResponseCard = {
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

export async function loadLocalServiceModule(input?: {
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
            contextReferences?: readonly {
              entityId: string
              entityKind: string
            }[] | null
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
          responseContextReferences?: readonly {
            entityId: string
            entityKind: string
          }[] | null
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
}): Promise<LoadedLocalServiceModule> {
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
        additionalUsages?: readonly {
          providerRequestOrdinal: number
        }[] | null
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
    resetAcceptedInputJournal() {
      acceptedInputIds.length = 0
      acceptedInputs.length = 0
      transcriptEntryCount = 0
    },
    session,
  }
}

export function isTraceEventWithRawType(
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

export function createHostedMailboxSourceRef(input: {
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

export function createProviderUsage(
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

export function createAssistantSession(input?: {
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

export function createCodexTarget(
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

export function createSharedPlan(): AssistantTurnSharedPlan {
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

export function createDirectSharedPlan(): AssistantTurnSharedPlan {
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

export function createDeferred<T>(): Deferred<T> {
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

export function makeRuntimeEvent(index: number) {
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
