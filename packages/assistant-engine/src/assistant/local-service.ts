import {
  assistantAskResultSchema,
  type AssistantAskResult,
  type AssistantSession,
  type AssistantTurnTrigger,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  assistantBackendTargetToProviderConfigInput,
  createAssistantModelTarget,
  createDefaultLocalAssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import {
  type ResolvedAssistantSession,
  appendAssistantTranscriptEntriesWithRefs,
  redactAssistantDisplayPath,
  resolveAssistantSession,
  saveAssistantSession,
} from './store.js'
import { resolveAssistantConversationLookupKey } from './store/paths.js'
import { resolveAssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import {
  normalizeAssistantDeliveryError,
} from './outbox.js'
import { recordAssistantDiagnosticEvent } from './diagnostics.js'
import { refreshAssistantStatusSnapshotLocal } from './status.js'
import {
  resolveAssistantTurnSharedPlan as buildAssistantTurnSharedPlan,
} from './turn-plan.js'
import {
  buildResolveAssistantSessionInput,
  resolveAssistantSessionForMessage as resolveAssistantMessageSession,
} from './session-resolution.js'
import {
  emitHostedAssistantContextTimingTrace,
  emitHostedAssistantContextSessionResolvedTrace,
} from './hosted-context-diagnostics.js'
import {
  deliverAssistantReply as dispatchAssistantReply,
  deliverAssistantProgressUpdate,
  finalizeAssistantTurnFromDeliveryOutcome as finalizeDeliveredAssistantTurn,
} from './delivery-service.js'
import {
  resolveAssistantResumeStateFromProviderTurn,
  persistAssistantTurnAndSession as finalizeAssistantTurnArtifacts,
} from './turn-finalizer.js'
import { readCodexThreadRouteFingerprint } from './codex-thread-route.js'
import {
  readAssistantCodexResume,
} from './conversation-persistence.js'
import {
  appendAssistantTurnReceiptEvent,
  createAssistantTurnReceipt,
  finalizeAssistantTurnReceipt,
} from './turns.js'
import {
  mergeAssistantProviderConfigsForProvider,
  serializeAssistantProviderSessionOptions,
} from '@murphai/operator-config/assistant/provider-config'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { normalizeAssistantExecutionContext } from './execution-context.js'
import { resolveAssistantExecutionDefaultTarget } from './execution-context.js'
import { resolveAssistantExecutionOperatorDefaults } from './execution-context.js'
import {
  executeCodexTurnWithRecovery,
  resolveAssistantCodexThreadScope,
  type AssistantCodexThreadScope,
} from './codex-turn-runner.js'
import {
  normalizeAssistantAskResultForReturn,
  serializeAssistantSessionForResult,
} from './service-result.js'
import { persistFailedAssistantPromptAttempt } from './prompt-attempts.js'
import { resolveAssistantTurnRoute } from './service-turn-routes.js'
import { recordAssistantUsageEvent } from './service-usage.js'
import {
  AssistantActiveTurnInputBudgetExceededError,
  type AssistantActiveTurnInputAdmissionResult,
} from './turn-input.js'
import {
  startAssistantChannelTypingIndicator,
  stopAssistantChannelTypingIndicator,
} from './channel-typing.js'
import {
  createAssistantProgressDelivery,
  shouldEnableAssistantModelProgressUpdates,
  type AssistantProgressDelivery,
} from './turn-progress.js'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import type {
  AssistantAcceptedTurnInputItemInput,
  AssistantAcceptedTurnInputTranscriptRef,
} from './active-turn-input-journal.js'
import {
  assertAssistantAcceptedTurnInputAssistantInputEventsExist,
  assertAssistantAcceptedTurnInputItemInputsAssistantInputEventsExist,
} from './active-turn-input-journal.js'
import {
  appendAssistantActiveTurnProviderExchange,
  type AssistantActiveTurnProviderHistory,
} from './active-turn-history.js'
import {
  createAssistantActiveTurnInputController,
  steerAssistantActiveTurnInputWithStatus,
} from './active-turn-input-controller.js'
import { normalizeNullableString } from './shared.js'
import type {
  AssistantMessageInput,
  AssistantSessionResolutionFields,
  AssistantTurnSharedPlan,
  ExecutedAssistantProviderTurnResult,
  PersistedUserTurn,
} from './service-contracts.js'
import { withAssistantTurnLock } from './turn-lock.js'

export { buildResolveAssistantSessionInput } from './session-resolution.js'

const MAX_ACTIVE_TURN_INPUT_CONTINUATIONS = 3
const DEFAULT_INITIAL_ACCEPTED_TURN_INPUT_ID = 'initial'

function resolveAssistantProgressDeliveryChannel(input: {
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
}): string | null {
  return normalizeNullableString(
    input.sharedPlan.conversationPolicy.audience.channel,
  )
    ?? normalizeNullableString(input.session.binding.channel)
}

async function appendUserTranscriptEntryForTurn(input: {
  createdAt?: string | null
  detail: string
  sessionId: string
  text: string
  turnId: string
  vault: string
}): Promise<{
  createdAt: string
  transcriptRef: AssistantAcceptedTurnInputTranscriptRef
}> {
  const fallbackCreatedAt = input.createdAt ?? new Date().toISOString()
  const appended = await appendAssistantTranscriptEntriesWithRefs(
    input.vault,
    input.sessionId,
    [
      {
        kind: 'user',
        text: input.text,
        ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
      },
    ],
  )
  const persistedAt = appended.entries[0]?.createdAt ?? fallbackCreatedAt
  const transcriptRef =
    appended.refs[0] ??
    ({
      entryCreatedAt: persistedAt,
      entryIndex: null,
      entryKind: 'user',
      sessionId: input.sessionId,
    } satisfies AssistantAcceptedTurnInputTranscriptRef)
  await appendAssistantTurnReceiptEvent({
    vault: input.vault,
    turnId: input.turnId,
    kind: 'user.persisted',
    detail: input.detail,
    at: persistedAt,
  })

  return {
    createdAt: persistedAt,
    transcriptRef,
  }
}

async function persistUserTurn(
  input: AssistantMessageInput,
  resolved: ResolvedAssistantSession,
  plan: {
    persistUserPromptOnFailure: boolean
  },
  turnId: string,
): Promise<PersistedUserTurn> {
  let turnCreatedAt = new Date().toISOString()
  let userPersisted = false
  let userTranscriptRef: AssistantAcceptedTurnInputTranscriptRef | null = null
  if (plan.persistUserPromptOnFailure) {
    const persisted = await appendUserTranscriptEntryForTurn({
      detail: 'user prompt persisted before provider execution',
      sessionId: resolved.session.sessionId,
      text: input.prompt,
      turnId,
      vault: input.vault,
    })
    turnCreatedAt = persisted.createdAt
    userTranscriptRef = persisted.transcriptRef
    userPersisted = true
  }

  return {
    turnCreatedAt,
    turnId,
    userTranscriptRef,
    userPersisted,
  }
}

export async function openAssistantConversationLocal(
  input: AssistantSessionResolutionFields,
) {
  const defaults = await resolveAssistantOperatorDefaults()
  return resolveAssistantSession(
    buildResolveAssistantSessionInput(
      input,
      defaults,
      createDefaultLocalAssistantModelTarget(),
    ),
  )
}

export async function sendAssistantMessageLocal(
  input: AssistantMessageInput,
): Promise<AssistantAskResult> {
  await assertAssistantAcceptedTurnInputItemInputsAssistantInputEventsExist({
    inputs: input.acceptedTurnInput?.initialInputs ?? [],
    vault: input.vault,
  })

  if (isManualAssistantTurnTrigger(input.turnTrigger)) {
    const steerResult = steerAssistantActiveTurnInputWithStatus(input)
    if (steerResult.kind === 'queued') {
      return steerResult.completion
    }
    if (steerResult.kind === 'turn-id-mismatch') {
      throw new VaultCliError(
        'ASSISTANT_ACTIVE_TURN_ID_MISMATCH',
        'Manual active-turn input targeted a stale or different active turn.',
      )
    }
    if (
      steerResult.kind === 'no-active-turn' &&
      typeof input.expectedActiveTurnId === 'string'
    ) {
      throw new VaultCliError(
        'ASSISTANT_ACTIVE_TURN_NOT_ACTIVE',
        'Manual active-turn input targeted a turn that is no longer active.',
      )
    }
  }

  const executionContext = normalizeAssistantExecutionContext(input.executionContext)
  const boundaryDefaultTarget = resolveAssistantExecutionDefaultTarget({
    executionContext,
    fallbackTarget: createDefaultLocalAssistantModelTarget(),
  })
  const defaults = resolveAssistantExecutionOperatorDefaults({
    defaults: await resolveAssistantOperatorDefaults(),
    executionContext,
  })
  const turnLockWaitStartedAt = Date.now()
  return withAssistantTurnLock({
    abortSignal: input.abortSignal,
    vault: input.vault,
    run: async () => {
      const lockAcquiredAt = Date.now()
      const turnLockWaitMs = elapsedSince(turnLockWaitStartedAt)
      emitHostedAssistantContextTimingTrace({
        message: input,
        stage: 'assistant-turn-lock-acquired',
        turnLockWaitMs,
      })
      const resolved = await resolveAssistantMessageSession({
        boundaryDefaultTarget,
        defaults,
        message: input,
      })
      await emitHostedAssistantContextSessionResolvedTrace({
        message: input,
        resolved,
        source: 'assistant-message',
      })
      const sharedPlan = await buildAssistantTurnSharedPlan(input, resolved)
      const route = resolveAssistantTurnRoute(input, defaults, resolved)
      const receipt = await createAssistantTurnReceipt({
        vault: input.vault,
        sessionId: resolved.session.sessionId,
        provider: route.provider,
        providerModel: route.providerOptions.model ?? null,
        metadata: input.receiptMetadata ?? null,
        prompt: input.prompt,
        deliveryRequested: input.deliverResponse === true,
      })

      await recordAssistantDiagnosticEvent({
        vault: input.vault,
        component: 'assistant',
        kind: 'turn.started',
        message: `Started assistant turn for session ${resolved.session.sessionId}.`,
        sessionId: resolved.session.sessionId,
        turnId: receipt.turnId,
        counterDeltas: {
          turnsStarted: 1,
        },
      })

      let responseText: string | null = null
      let userTurn: PersistedUserTurn | null = null
      const typingIndicator = startAssistantChannelTypingIndicator({
        channelDependencies:
          executionContext?.hosted?.channelTypingDependencies ?? null,
        input,
        session: resolved.session,
        sharedPlan,
      })
      let activeTurnInputController: ReturnType<
        typeof createAssistantActiveTurnInputController
      > | null = null

      try {
        activeTurnInputController = createAssistantActiveTurnInputController({
          acceptedInputValidator: async ({ acceptedInputs }) => {
            await assertAssistantAcceptedTurnInputItemInputsAssistantInputEventsExist({
              inputs: acceptedInputs,
              vault: input.vault,
            })
          },
          admissionHook: input.activeTurnInput,
          conversationKeys: [
            resolved.session.binding.conversationKey,
            resolveAssistantConversationLookupKey(input),
          ].filter((key): key is string => key !== null),
          sessionId: resolved.session.sessionId,
          turnId: receipt.turnId,
          vault: input.vault,
        })
        userTurn = await persistUserTurn(input, resolved, sharedPlan, receipt.turnId)
        let currentUserTurn = userTurn
        const runtimeState = createAssistantRuntimeStateService(input.vault)
        const initialAcceptedTurnInputItems = resolveInitialAcceptedTurnInputItems({
          input,
          resolved,
          userTurn: currentUserTurn,
        })
        const initialUserPromptInputId =
          resolveInitialUserPromptAcceptedTurnInputId(input)
        const initialAcceptedInputJournal =
          await runtimeState.turns.acceptedInputs.append({
            inputs: initialAcceptedTurnInputItems,
            sessionId: resolved.session.sessionId,
            turnId: receipt.turnId,
          })
        await assertAssistantAcceptedTurnInputAssistantInputEventsExist({
          journal: initialAcceptedInputJournal,
          vault: input.vault,
        })
        const threadScope = resolveAssistantCodexThreadScope({
          turnTrigger: input.turnTrigger ?? null,
        })
        let currentInput = input
        let currentSession = resolved.session
        const modelProgressUpdatesEnabled =
          shouldEnableAssistantModelProgressUpdates(input)
        const progressDelivery = modelProgressUpdatesEnabled
          ? createAssistantProgressDelivery({
              deliver: async (progressInput) => {
                const hosted = executionContext?.hosted
                if (hosted) {
                  const deliveryChannel = resolveAssistantProgressDeliveryChannel(
                    progressInput,
                  )
                  if (deliveryChannel !== 'linq') {
                    throw new VaultCliError(
                      'ASSISTANT_PROGRESS_CHANNEL_UNSUPPORTED',
                      'Hosted model progress updates are currently supported for iMessage delivery only.',
                    )
                  }
                  if (!hosted.progressDeliveryDependencies?.sendLinq) {
                    throw new VaultCliError(
                      'ASSISTANT_PROGRESS_DELIVERY_UNAVAILABLE',
                      'Hosted iMessage progress delivery dependencies were not available.',
                    )
                  }
                  await deliverAssistantProgressUpdate({
                    ...progressInput,
                    dependencies: hosted.progressDeliveryDependencies,
                  })
                  return
                }

                await deliverAssistantProgressUpdate({
                  ...progressInput,
                })
              },
              getDeliveryContext: () => ({
                messageInput: currentInput,
                session: currentSession,
              }),
              messageInput: input,
              session: resolved.session,
              sharedPlan,
              turnId: currentUserTurn.turnId,
            })
          : null
        let activeTurnHistory: AssistantActiveTurnProviderHistory | null = null
        let providerResult: ExecutedAssistantProviderTurnResult | null = null
        let activeTurnRouteLock: ExecutedAssistantProviderTurnResult['route'] | null = null
        let userPromptPersistedToTranscript = currentUserTurn.userPersisted
        let acceptedInputIdsForNextProviderRequest: readonly string[] =
          initialAcceptedInputJournal.inputIds
        const acceptActiveTurnInput = async (acceptanceInput: {
          activeTurnInput: Extract<
            AssistantActiveTurnInputAdmissionResult,
            { kind: 'accepted' }
          >
          providerRequestAcceptedInputIds: readonly string[]
          providerRequestOrdinal: number
          sessionId: string
        }) => {
          const previousInput = currentInput
          if (!userPromptPersistedToTranscript) {
            const persisted = await appendUserTranscriptEntryForTurn({
              createdAt: currentUserTurn.turnCreatedAt,
              detail:
                'user prompt persisted before active-turn continuation',
              sessionId: resolved.session.sessionId,
              text: previousInput.prompt,
              turnId: currentUserTurn.turnId,
              vault: currentInput.vault,
            })
            currentUserTurn = {
              ...currentUserTurn,
              turnCreatedAt: persisted.createdAt,
              userTranscriptRef: persisted.transcriptRef,
              userPersisted: true,
            }
            userTurn = currentUserTurn
            userPromptPersistedToTranscript = true
            if (initialUserPromptInputId) {
              await runtimeState.turns.acceptedInputs.updateTranscriptRefs({
                refs: [
                  {
                    inputId: initialUserPromptInputId,
                    transcriptRef: persisted.transcriptRef,
                  },
                ],
                turnId: currentUserTurn.turnId,
              })
            }
          }
          const acceptedInputItems = resolveAcceptedActiveTurnInputItems({
            acceptedInput: acceptanceInput.activeTurnInput,
            input: currentInput,
            providerRequestOrdinal: acceptanceInput.providerRequestOrdinal,
          })
          assertAcceptedActiveTurnInputItemsAreNew({
            acceptedInputIds: acceptanceInput.providerRequestAcceptedInputIds,
            inputs: acceptedInputItems,
          })
          let acceptedInputJournal =
            await runtimeState.turns.acceptedInputs.append({
              inputs: acceptedInputItems,
              sessionId: resolved.session.sessionId,
              turnId: currentUserTurn.turnId,
            })
          await assertAssistantAcceptedTurnInputAssistantInputEventsExist({
            journal: acceptedInputJournal,
            vault: currentInput.vault,
          })
          const transcriptRefsByInputId =
            await appendAcceptedActiveTurnInputTranscriptEntries({
              acceptedInput: acceptanceInput.activeTurnInput,
              acceptedInputItems,
              sessionId: resolved.session.sessionId,
              turnId: currentUserTurn.turnId,
              vault: currentInput.vault,
            })
          const transcriptRefUpdates = resolveAcceptedTurnInputTranscriptRefUpdates({
            inputs: acceptedInputItems,
            transcriptRefsByInputId,
          })
          if (transcriptRefUpdates.length > 0) {
            acceptedInputJournal =
              await runtimeState.turns.acceptedInputs.updateTranscriptRefs({
                refs: transcriptRefUpdates,
                turnId: currentUserTurn.turnId,
              }) ?? acceptedInputJournal
          }
          await appendAssistantTurnReceiptEvent({
            vault: currentInput.vault,
            turnId: currentUserTurn.turnId,
            kind: 'turn.input.accepted',
            detail: null,
            metadata: acceptanceInput.activeTurnInput.receiptMetadata ?? {},
          })
          if (acceptedInputJournal.inputIds.length > 0) {
            await currentInput.activeTurnCheckpoint?.({
              acceptedInputIds: acceptedInputJournal.inputIds,
              providerRequestOrdinal: acceptanceInput.providerRequestOrdinal,
              sessionId: acceptanceInput.sessionId,
              signal: currentInput.abortSignal,
              turnId: currentUserTurn.turnId,
              vault: currentInput.vault,
            })
          }
          const nextInput = buildActiveTurnContinuationInput({
            acceptedInput: acceptanceInput.activeTurnInput,
            input: previousInput,
          })
          currentInput = nextInput
          acceptedInputIdsForNextProviderRequest = acceptedInputJournal.inputIds
          return {
            acceptedInputJournal,
            acceptedInputItems,
            previousInput,
          }
        }
        providerLoop: for (
          let providerRequestOrdinal = 0;
          providerRequestOrdinal <= MAX_ACTIVE_TURN_INPUT_CONTINUATIONS;
          providerRequestOrdinal += 1
        ) {
          let preProviderAdmissionCount = 0
          while (true) {
            const activeTurnInput = await activeTurnInputController?.admitAvailable({
              probeIfIdle: true,
              signal: currentInput.abortSignal,
            })
            if (activeTurnInput?.kind !== 'accepted') {
              break
            }
            preProviderAdmissionCount += 1
            if (preProviderAdmissionCount > MAX_ACTIVE_TURN_INPUT_CONTINUATIONS) {
              throw new AssistantActiveTurnInputBudgetExceededError()
            }
            await acceptActiveTurnInput({
              activeTurnInput,
              providerRequestAcceptedInputIds: acceptedInputIdsForNextProviderRequest,
              providerRequestOrdinal,
              sessionId: currentSession.sessionId,
            })
          }
          emitHostedAssistantContextTimingTrace({
            message: input,
            preProviderAdmissionCount,
            preProviderSetupMs: elapsedSince(lockAcquiredAt),
            providerRequestOrdinal,
            stage: 'assistant-pre-provider-ready',
            turnLockWaitMs,
          })
          let providerRequestJournal: Awaited<
            ReturnType<typeof runtimeState.turns.acceptedInputs.recordProviderRequest>
          > = null
          let providerRequestAcceptedInputIds: readonly string[] =
            acceptedInputIdsForNextProviderRequest
          const providerOutcome = await executeCodexTurnWithRecovery({
            activeTurnHistory,
            activeTurnSteering: activeTurnInputController,
            input: currentInput,
            onProviderRequestPlanned: async (event) => {
              providerRequestJournal =
                await runtimeState.turns.acceptedInputs.recordProviderRequest({
                  continuation: event.codexContinuation,
                  ordinal: providerRequestOrdinal,
                  providerAttemptId: event.providerAttemptId,
                  turnId: currentUserTurn.turnId,
                })
              providerRequestAcceptedInputIds =
                providerRequestJournal?.inputIds ?? acceptedInputIdsForNextProviderRequest
              acceptedInputIdsForNextProviderRequest = providerRequestAcceptedInputIds
            },
            onProviderRequestStarted: (event) => {
              if (!currentInput.onProviderRequestStarted) {
                return
              }
              return currentInput.onProviderRequestStarted({
                acceptedInputIds: providerRequestAcceptedInputIds,
                providerRequestOrdinal:
                  event.providerRequestOrdinal ?? providerRequestOrdinal,
                startedAt: event.startedAt,
              })
            },
            route: activeTurnRouteLock ?? route,
            plan: sharedPlan,
            profile: {
              threadScope,
            },
            providerRequestOrdinal,
            resolvedSession: currentSession,
            turnCreatedAt: currentUserTurn.turnCreatedAt,
            modelProgressUpdatesEnabled,
            progressDelivery,
            turnId: currentUserTurn.turnId,
          })
          if (providerOutcome.kind === 'failed_terminal') {
            if (!providerRequestJournal) {
              await runtimeState.turns.acceptedInputs.recordProviderRequest({
                continuation: providerOutcome.codexContinuation,
                ordinal: providerRequestOrdinal,
                providerAttemptId: null,
                turnId: currentUserTurn.turnId,
              })
            } else {
              await runtimeState.turns.acceptedInputs.updateProviderRequest({
                continuation: providerOutcome.codexContinuation,
                ordinal: providerRequestOrdinal,
                providerAttemptId: null,
                turnId: currentUserTurn.turnId,
              })
            }
            await recordAssistantUsageEvent({
              executionContext,
              providerRequestOrdinal,
              providerRequestOutcome: providerOutcome.providerRequestOutcome,
              providerResult: {
                attemptCount: providerOutcome.attemptCount,
                provider: providerOutcome.route.provider,
                providerOptions: providerOutcome.route.providerOptions,
                route: providerOutcome.route,
                session: providerOutcome.session,
                usage: providerOutcome.usage,
                usageAttribution: providerOutcome.usageAttribution,
              },
              turnId: currentUserTurn.turnId,
            })
            throw providerOutcome.error
          }

          providerResult = providerOutcome.providerTurn
          if (!providerRequestJournal) {
            providerRequestJournal =
              await runtimeState.turns.acceptedInputs.recordProviderRequest({
                continuation: providerResult.codexContinuation,
                ordinal: providerRequestOrdinal,
                providerAttemptId: null,
                turnId: currentUserTurn.turnId,
              })
            providerRequestAcceptedInputIds =
              providerRequestJournal?.inputIds ?? acceptedInputIdsForNextProviderRequest
            acceptedInputIdsForNextProviderRequest = providerRequestAcceptedInputIds
          } else {
            providerRequestJournal =
              await runtimeState.turns.acceptedInputs.updateProviderRequest({
                continuation: providerResult.codexContinuation,
                ordinal: providerRequestOrdinal,
                providerAttemptId: null,
                turnId: currentUserTurn.turnId,
              }) ?? providerRequestJournal
            providerRequestAcceptedInputIds =
              providerRequestJournal?.inputIds ?? providerRequestAcceptedInputIds
            acceptedInputIdsForNextProviderRequest = providerRequestAcceptedInputIds
          }
          currentSession = resolveActiveTurnProviderLoopSession({
            providerResult,
            threadScope,
          })
          responseText = providerResult.response
          if (providerResult.nonReplayableProviderWork) {
            activeTurnRouteLock = providerResult.route
          }
          await recordAssistantUsageEvent({
            executionContext,
            providerRequestOrdinal,
            providerResult,
            turnId: currentUserTurn.turnId,
          })

          for (const phase of ['request_boundary', 'commit_barrier'] as const) {
            const activeTurnInput =
              await resolveAssistantActiveTurnInputAdmission({
                activeTurnInputController,
                currentInput,
                phase,
                sessionId: providerResult.session.sessionId,
                userTurn: currentUserTurn,
              })
            if (activeTurnInput?.kind !== 'accepted') {
              if (activeTurnInput && phase === 'commit_barrier') {
                activeTurnInputController.close()
              }
              continue
            }
            if (providerRequestOrdinal >= MAX_ACTIVE_TURN_INPUT_CONTINUATIONS) {
              throw new AssistantActiveTurnInputBudgetExceededError()
            }
            const accepted = await acceptActiveTurnInput({
              activeTurnInput,
              providerRequestAcceptedInputIds,
              providerRequestOrdinal,
              sessionId: providerResult.session.sessionId,
            })
            if (activeTurnInput.providerAlreadySteered === true) {
              providerRequestJournal =
                await runtimeState.turns.acceptedInputs.updateProviderRequest({
                  acceptedInputIds: accepted.acceptedInputJournal.inputIds,
                  continuation: providerResult.codexContinuation,
                  ordinal: providerRequestOrdinal,
                  providerAttemptId: null,
                  turnId: currentUserTurn.turnId,
                }) ?? providerRequestJournal
              providerRequestAcceptedInputIds =
                providerRequestJournal?.inputIds ?? accepted.acceptedInputJournal.inputIds
              acceptedInputIdsForNextProviderRequest = providerRequestAcceptedInputIds
              continue
            }
            activeTurnHistory = appendAssistantActiveTurnProviderExchange({
              acceptedInputIds: providerRequestAcceptedInputIds,
              assistantResponse: providerResult.response,
              history: activeTurnHistory,
              nonReplayableProviderWork:
                providerResult.nonReplayableProviderWork === true,
              userMessageContent: accepted.previousInput.userMessageContent ?? null,
              userPrompt: accepted.previousInput.prompt,
            })
            continue providerLoop
          }
          break
        }

        if (!providerResult) {
          throw new Error('Assistant provider turn did not produce a result.')
        }

        activeTurnInputController.close()
        await runtimeState.turns.acceptedInputs.updateAdmissionState({
          admissionState: 'commit-started',
          turnId: currentUserTurn.turnId,
        })
        const session = await finalizeAssistantTurnArtifacts({
          input: currentInput,
          plan: sharedPlan,
          providerResult,
          providerResumeStateAction: resolveProviderResumeStateAction({
            codexThreadId: providerResult.codexThreadId ?? null,
            threadScope,
          }),
          persistUserPromptToTranscript: !userPromptPersistedToTranscript,
          session: providerResult.session,
          turnCreatedAt: currentUserTurn.turnCreatedAt,
          turnId: currentUserTurn.turnId,
        })
        const deliveryOutcome = await dispatchAssistantReply({
          input: currentInput,
          response: providerResult.response,
          session,
          sharedPlan,
          turnId: currentUserTurn.turnId,
        })

        await finalizeDeliveredAssistantTurn({
          firstContactGuidanceInjected:
            providerResult.onboardingGuidanceInjected,
          firstContactStateDocIds: sharedPlan.firstContactStateDocIds,
          outcome: deliveryOutcome,
          response: providerResult.response,
          turnId: currentUserTurn.turnId,
          vault: input.vault,
        })

        const result = normalizeAssistantAskResultForReturn({
          vault: redactAssistantDisplayPath(input.vault),
          status: 'completed',
          prompt: currentInput.prompt,
          response: providerResult.response,
          session: deliveryOutcome.session,
          delivery: deliveryOutcome.kind === 'sent' ? deliveryOutcome.delivery : null,
          deliveryDeferred: deliveryOutcome.kind === 'queued',
          deliveryIntentId:
            deliveryOutcome.kind === 'sent' ||
            deliveryOutcome.kind === 'queued' ||
            deliveryOutcome.kind === 'failed'
              ? deliveryOutcome.intentId
              : null,
          deliveryError:
            deliveryOutcome.kind === 'queued' || deliveryOutcome.kind === 'failed'
              ? deliveryOutcome.error
              : null,
        })
        activeTurnInputController.complete(result)
        return result
      } catch (error) {
        activeTurnInputController?.fail(error)
        const normalizedError = normalizeAssistantDeliveryError(error)
        const failedAt = new Date().toISOString()
        const failedSession = resolved.session

        await runAssistantTurnBestEffort(() =>
          persistFailedAssistantPromptAttempt({
            persistUserPromptOnFailure: sharedPlan.persistUserPromptOnFailure,
            prompt: input.prompt,
            session: failedSession,
            turnCreatedAt: userTurn?.turnCreatedAt ?? failedAt,
            turnTrigger: input.turnTrigger ?? 'manual-ask',
            vault: input.vault,
          }),
        )

        await runAssistantTurnBestEffort(() =>
          finalizeAssistantTurnReceipt({
            vault: input.vault,
            turnId: receipt.turnId,
            status: 'failed',
            deliveryDisposition:
              input.deliverResponse === true ? 'failed' : 'not-requested',
            error: normalizedError,
            response: responseText,
            completedAt: failedAt,
            metadata: null,
          }),
        )

        await runAssistantTurnBestEffort(() =>
          recordAssistantDiagnosticEvent({
            vault: input.vault,
            component: 'assistant',
            kind: 'turn.failed',
            level: 'error',
            message: normalizedError.message,
            code: normalizedError.code,
            sessionId: failedSession.sessionId,
            turnId: receipt.turnId,
            counterDeltas: {
              turnsFailed: 1,
            },
            at: failedAt,
          }),
        )

        throw error
      } finally {
        activeTurnInputController?.close()
        await stopAssistantChannelTypingIndicator(typingIndicator)
        if (
          !(
            executionContext?.hosted != null
            && input.deliveryDispatchMode === 'queue-only'
            && input.turnTrigger === 'automation-auto-reply'
          )
        ) {
          await runAssistantTurnBestEffort(() =>
            refreshAssistantStatusSnapshotLocal(input.vault),
          )
        }
      }
    },
  })
}

export async function updateAssistantSessionOptionsLocal(input: {
  providerOptions: Pick<AssistantSession['providerOptions'], 'provider'> &
    Partial<Omit<AssistantSession['providerOptions'], 'provider'>>
  sessionId: string
  vault: string
}): Promise<AssistantSession> {
  const session = await resolveAssistantSession({
    vault: input.vault,
    conversation: {
      sessionId: input.sessionId,
    },
    createIfMissing: false,
  })

  const providerConfig = mergeAssistantProviderConfigsForProvider(
    input.providerOptions.provider,
    // Persisted targets carry the full durable provider config. Session
    // providerOptions are a derived runtime projection and omit target-only
    // fields such as the Codex executable path.
    assistantBackendTargetToProviderConfigInput(session.session.target),
    input.providerOptions,
  )
  const nextTarget =
    createAssistantModelTarget(providerConfig) ?? session.session.target
  if (nextTarget.adapter !== 'codex-cli') {
    throw new VaultCliError(
      'ASSISTANT_PROVIDER_UNSUPPORTED',
      'Assistant sessions only support Codex app-server targets.',
    )
  }
  const nextProviderOptions = serializeAssistantProviderSessionOptions(providerConfig)
  const continuityChanged =
    session.session.providerOptions.continuityFingerprint !==
    nextProviderOptions.continuityFingerprint
  const currentResumeState = readAssistantCodexResume(session.session)

  return saveAssistantSession(input.vault, {
    ...session.session,
    codexResume: continuityChanged ? null : currentResumeState,
    codexTarget: nextTarget,
    provider: nextTarget.adapter,
    providerOptions: nextProviderOptions,
    resumeState: continuityChanged ? null : currentResumeState,
    target: nextTarget,
    updatedAt: new Date().toISOString(),
  })
}

async function runAssistantTurnBestEffort(
  task: () => Promise<unknown>,
): Promise<void> {
  try {
    await task()
  } catch {
    // Preserve the original turn failure; these cleanup writes are best-effort.
  }
}

function resolveProviderResumeStateAction(input: {
  codexThreadId: string | null
  threadScope: AssistantCodexThreadScope
}): 'clear' | 'persist-from-provider-turn' | 'preserve-existing' {
  if (input.threadScope === 'isolated-thread') {
    return 'preserve-existing'
  }

  return normalizeNullableString(input.codexThreadId)
    ? 'persist-from-provider-turn'
    : 'clear'
}

function resolveActiveTurnProviderLoopSession(input: {
  providerResult: ExecutedAssistantProviderTurnResult
  threadScope: AssistantCodexThreadScope
}): AssistantSession {
  if (input.threadScope !== 'session-thread') {
    return input.providerResult.session
  }

  const codexThreadId = normalizeNullableString(
    input.providerResult.codexThreadId,
  )
  const routeFingerprint = normalizeNullableString(
    readCodexThreadRouteFingerprint(input.providerResult.route),
  )
  if (!codexThreadId || !routeFingerprint) {
    return {
      ...input.providerResult.session,
      codexResume: null,
      resumeState: null,
    }
  }
  const nextResumeState = resolveAssistantResumeStateFromProviderTurn({
    codexThreadId,
    routeFingerprint,
  })

  return {
    ...input.providerResult.session,
    codexResume: nextResumeState,
    resumeState: nextResumeState,
  }
}

async function resolveAssistantActiveTurnInputAdmission(input: {
  activeTurnInputController: ReturnType<
    typeof createAssistantActiveTurnInputController
  > | null
  currentInput: AssistantMessageInput
  phase: 'request_boundary' | 'commit_barrier'
  sessionId: string
  userTurn: PersistedUserTurn
}): Promise<AssistantActiveTurnInputAdmissionResult | undefined> {
  return input.activeTurnInputController?.admit({
    phase: input.phase,
    signal: input.currentInput.abortSignal,
    sessionId: input.sessionId,
    turnId: input.userTurn.turnId,
    vault: input.currentInput.vault,
  })
}

function resolveInitialAcceptedTurnInputItems(input: {
  input: AssistantMessageInput
  resolved: ResolvedAssistantSession
  userTurn: PersistedUserTurn
}): readonly AssistantAcceptedTurnInputItemInput[] {
  const initialInputs = input.input.acceptedTurnInput?.initialInputs ?? null
  if (initialInputs && initialInputs.length > 0) {
    return initialInputs
  }

  return [
    {
      id: DEFAULT_INITIAL_ACCEPTED_TURN_INPUT_ID,
      promptFallbackReason:
        isManualAssistantTurnTrigger(input.input.turnTrigger)
          ? 'manual-input'
          : 'system-input',
      promptFallbackText: input.input.prompt,
      source: isManualAssistantTurnTrigger(input.input.turnTrigger)
        ? 'manual'
        : 'initial',
      transcriptRef:
        input.userTurn.userTranscriptRef ??
        {
          entryCreatedAt: input.userTurn.turnCreatedAt,
          entryIndex: null,
          entryKind: input.userTurn.userPersisted ? 'user' : null,
          sessionId: input.resolved.session.sessionId,
        },
    },
  ]
}

function resolveInitialUserPromptAcceptedTurnInputId(
  input: AssistantMessageInput,
): string | null {
  const initialInputs = input.acceptedTurnInput?.initialInputs ?? null
  return initialInputs && initialInputs.length > 0
    ? null
    : DEFAULT_INITIAL_ACCEPTED_TURN_INPUT_ID
}

async function appendAcceptedActiveTurnInputTranscriptEntries(input: {
  acceptedInput: Extract<
    AssistantActiveTurnInputAdmissionResult,
    { kind: 'accepted' }
  >
  acceptedInputItems: readonly AssistantAcceptedTurnInputItemInput[]
  sessionId: string
  turnId: string
  vault: string
}): Promise<Map<string, AssistantAcceptedTurnInputTranscriptRef>> {
  const transcriptPlans = resolveAcceptedActiveTurnTranscriptAppendPlans({
    acceptedInput: input.acceptedInput,
    acceptedInputItems: input.acceptedInputItems,
  })
  const refsByInputId = new Map<string, AssistantAcceptedTurnInputTranscriptRef>()
  for (const plan of transcriptPlans) {
    const persisted = await appendUserTranscriptEntryForTurn({
      detail:
        'accepted active-turn input persisted before provider continuation',
      sessionId: input.sessionId,
      text: plan.text,
      turnId: input.turnId,
      vault: input.vault,
    })
    for (const inputId of plan.inputIds) {
      refsByInputId.set(inputId, persisted.transcriptRef)
    }
  }
  return refsByInputId
}

function resolveAcceptedActiveTurnTranscriptAppendPlans(input: {
  acceptedInput: Extract<
    AssistantActiveTurnInputAdmissionResult,
    { kind: 'accepted' }
  >
  acceptedInputItems: readonly AssistantAcceptedTurnInputItemInput[]
}): Array<{
  inputIds: readonly string[]
  text: string
}> {
  const itemPlans = input.acceptedInputItems.flatMap((item) => {
    const text = normalizeNullableString(item.promptFallbackText)
    return text ? [{ inputIds: [item.id], text }] : []
  })
  if (itemPlans.length > 0) {
    return itemPlans
  }

  const directText = normalizeNullableString(input.acceptedInput.transcriptText)
  if (directText) {
    return [
      {
        inputIds: input.acceptedInputItems.map((item) => item.id),
        text: directText,
      },
    ]
  }

  return [
    {
      inputIds: input.acceptedInputItems.map((item) => item.id),
      text: input.acceptedInput.prompt,
    },
  ]
}

function resolveAcceptedTurnInputTranscriptRefUpdates(input: {
  inputs: readonly AssistantAcceptedTurnInputItemInput[]
  transcriptRefsByInputId: ReadonlyMap<string, AssistantAcceptedTurnInputTranscriptRef>
}): Array<{
  inputId: string
  transcriptRef: AssistantAcceptedTurnInputTranscriptRef
}> {
  return input.inputs.flatMap((item) => {
    if (item.transcriptRef) {
      return []
    }
    const transcriptRef = input.transcriptRefsByInputId.get(item.id)
    return transcriptRef
      ? [
          {
            inputId: item.id,
            transcriptRef,
          },
        ]
      : []
  })
}

function assertAcceptedActiveTurnInputItemsAreNew(input: {
  acceptedInputIds: readonly string[]
  inputs: readonly AssistantAcceptedTurnInputItemInput[]
}): void {
  const existingIds = new Set(input.acceptedInputIds)
  const nextIds = new Set<string>()
  for (const item of input.inputs) {
    if (existingIds.has(item.id) || nextIds.has(item.id)) {
      throw new VaultCliError(
        'ASSISTANT_TURN_INPUT_JOURNAL_DUPLICATE_INPUT',
        'Accepted active-turn input ids must be new for the current provider continuation.',
      )
    }
    nextIds.add(item.id)
  }
}

function resolveAcceptedActiveTurnInputItems(input: {
  acceptedInput: Extract<
    AssistantActiveTurnInputAdmissionResult,
    { kind: 'accepted' }
  >
  input: AssistantMessageInput
  providerRequestOrdinal: number
}): readonly AssistantAcceptedTurnInputItemInput[] {
  if (input.acceptedInput.acceptedInputs.length > 0) {
    return input.acceptedInput.acceptedInputs
  }

  throw new VaultCliError(
    'ASSISTANT_TURN_INPUT_MISSING_ACCEPTED_INPUTS',
    'Accepted active-turn input admissions must provide durable input ids.',
  )
}

function isManualAssistantTurnTrigger(
  turnTrigger: AssistantTurnTrigger | null | undefined,
): boolean {
  return (
    turnTrigger === undefined ||
    turnTrigger === null ||
    turnTrigger === 'manual-ask' ||
    turnTrigger === 'manual-deliver'
  )
}

function elapsedSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}

function buildActiveTurnContinuationInput(input: {
  acceptedInput: Extract<
    AssistantActiveTurnInputAdmissionResult,
    { kind: 'accepted' }
  >
  input: AssistantMessageInput
}): AssistantMessageInput {
  return {
    ...input.input,
    deliveryReplyToMessageId:
      input.acceptedInput.deliveryReplyToMessageId === undefined
        ? input.input.deliveryReplyToMessageId
        : input.acceptedInput.deliveryReplyToMessageId,
    deliveryIdempotencyKey:
      input.acceptedInput.deliveryIdempotencyKey === undefined
        ? input.input.deliveryIdempotencyKey
        : input.acceptedInput.deliveryIdempotencyKey,
    prompt: input.acceptedInput.prompt,
    receiptMetadata:
      input.acceptedInput.receiptMetadata === undefined
        ? input.input.receiptMetadata
        : input.acceptedInput.receiptMetadata,
    userMessageContent:
      input.acceptedInput.userMessageContent === undefined
        ? input.input.userMessageContent
        : input.acceptedInput.userMessageContent,
  }
}
