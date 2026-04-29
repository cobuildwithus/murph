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
  emitHostedAssistantContextSessionResolvedTrace,
} from './hosted-context-diagnostics.js'
import {
  deliverAssistantReply as dispatchAssistantReply,
  finalizeAssistantTurnFromDeliveryOutcome as finalizeDeliveredAssistantTurn,
} from './delivery-service.js'
import {
  persistAssistantTurnAndSession as finalizeAssistantTurnArtifacts,
} from './turn-finalizer.js'
import {
  appendAssistantTurnReceiptEvent,
  createAssistantTurnReceipt,
  finalizeAssistantTurnReceipt,
} from './turns.js'
import {
  AUTO_REPLY_RECEIPT_RETRY_AT_KEY,
  computeAssistantAutoReplyRetryAt,
} from './automation/auto-reply-retry.js'
import {
  mergeAssistantProviderConfigsForProvider,
  serializeAssistantProviderSessionOptions,
} from '@murphai/operator-config/assistant/provider-config'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { normalizeAssistantExecutionContext } from './execution-context.js'
import { resolveAssistantExecutionDefaultTarget } from './execution-context.js'
import { resolveAssistantExecutionOperatorDefaults } from './execution-context.js'
import {
  extractRecoveredAssistantSession,
} from './provider-turn-recovery.js'
import {
  executeProviderTurnWithRecovery,
  resolveAssistantProviderTurnContinuityPolicy,
} from './provider-turn-runner.js'
import {
  normalizeAssistantAskResultForReturn,
  serializeAssistantSessionForResult,
} from './service-result.js'
import { persistFailedAssistantPromptAttempt } from './prompt-attempts.js'
import { resolveAssistantTurnRoute } from './service-turn-routes.js'
import { persistPendingAssistantUsageEvent } from './service-usage.js'
import {
  AssistantActiveTurnInputBudgetExceededError,
  type AssistantActiveTurnInputAdmissionResult,
} from './turn-input.js'
import {
  startAssistantChannelTypingIndicator,
  stopAssistantChannelTypingIndicator,
} from './channel-typing.js'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import type {
  AssistantAcceptedTurnInputItemInput,
  AssistantAcceptedTurnInputTranscriptRef,
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
  return withAssistantTurnLock({
    abortSignal: input.abortSignal,
    vault: input.vault,
    run: async () => {
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
        await runtimeState.turns.acceptedInputs.append({
          inputs: initialAcceptedTurnInputItems,
          sessionId: resolved.session.sessionId,
          turnId: receipt.turnId,
        })
        const turnContinuityPolicy = resolveAssistantProviderTurnContinuityPolicy({
          turnTrigger: input.turnTrigger ?? null,
        })
        let currentInput = input
        let currentSession = resolved.session
        let activeTurnHistory: AssistantActiveTurnProviderHistory | null = null
        let providerResult: ExecutedAssistantProviderTurnResult | null = null
        let activeTurnRouteLock: ExecutedAssistantProviderTurnResult['route'] | null = null
        let userPromptPersistedToTranscript = currentUserTurn.userPersisted
        providerLoop: for (
          let providerRequestOrdinal = 0;
          providerRequestOrdinal <= MAX_ACTIVE_TURN_INPUT_CONTINUATIONS;
          providerRequestOrdinal += 1
        ) {
          let providerRequestJournal: Awaited<
            ReturnType<typeof runtimeState.turns.acceptedInputs.recordProviderRequest>
          > = null
          let providerRequestAcceptedInputIds: readonly string[] = []
          const providerOutcome = await executeProviderTurnWithRecovery({
            activeTurnHistory,
            activeTurnSteering: activeTurnInputController,
            input: currentInput,
            onProviderRequestPlanned: async (event) => {
              providerRequestJournal =
                await runtimeState.turns.acceptedInputs.recordProviderRequest({
                  continuation: event.providerContinuation,
                  ordinal: providerRequestOrdinal,
                  providerAttemptId: event.providerAttemptId,
                  turnId: currentUserTurn.turnId,
                })
              providerRequestAcceptedInputIds = providerRequestJournal?.inputIds ?? []
            },
            route: activeTurnRouteLock ?? route,
            plan: sharedPlan,
            profile: {
              turnContinuityPolicy,
            },
            resolvedSession: currentSession,
            turnCreatedAt: currentUserTurn.turnCreatedAt,
            turnId: currentUserTurn.turnId,
          })
          if (providerOutcome.kind === 'failed_terminal') {
            if (!providerRequestJournal) {
              await runtimeState.turns.acceptedInputs.recordProviderRequest({
                continuation: providerOutcome.providerContinuation,
                ordinal: providerRequestOrdinal,
                providerAttemptId: null,
                turnId: currentUserTurn.turnId,
              })
            } else {
              await runtimeState.turns.acceptedInputs.updateProviderRequest({
                continuation: providerOutcome.providerContinuation,
                ordinal: providerRequestOrdinal,
                providerAttemptId: null,
                turnId: currentUserTurn.turnId,
              })
            }
            throw providerOutcome.error
          }

          providerResult = providerOutcome.providerTurn
          if (!providerRequestJournal) {
            providerRequestJournal =
              await runtimeState.turns.acceptedInputs.recordProviderRequest({
                continuation: providerResult.providerContinuation,
                ordinal: providerRequestOrdinal,
                providerAttemptId: null,
                turnId: currentUserTurn.turnId,
              })
            providerRequestAcceptedInputIds = providerRequestJournal?.inputIds ?? []
          } else {
            providerRequestJournal =
              await runtimeState.turns.acceptedInputs.updateProviderRequest({
                continuation: providerResult.providerContinuation,
                ordinal: providerRequestOrdinal,
                providerAttemptId: null,
                turnId: currentUserTurn.turnId,
              }) ?? providerRequestJournal
          }
          currentSession = providerResult.session
          responseText = providerResult.response
          if (providerResult.nonReplayableProviderWork) {
            activeTurnRouteLock = providerResult.route
          }
          await persistPendingAssistantUsageEvent({
            executionContext,
            providerRequestOrdinal,
            providerResult,
            turnId: currentUserTurn.turnId,
            vault: currentInput.vault,
          })

          for (const phase of ['request_boundary', 'commit_barrier'] as const) {
            const activeTurnInput =
              await resolveAssistantActiveTurnInputAdmission({
                activeTurnInputController,
                currentInput,
                phase,
                providerRequestOrdinal,
                providerResult,
                userTurn: currentUserTurn,
            })
            if (activeTurnInput?.kind !== 'accepted') {
              if (activeTurnInput && phase === 'commit_barrier') {
                activeTurnInputController.close()
                await currentInput.activeTurnCheckpoint?.({
                  acceptedInputIds: [],
                  providerRequestOrdinal,
                  sessionId: providerResult.session.sessionId,
                  signal: currentInput.abortSignal,
                  turnId: currentUserTurn.turnId,
                  vault: currentInput.vault,
                })
              }
              continue
            }
            if (providerRequestOrdinal >= MAX_ACTIVE_TURN_INPUT_CONTINUATIONS) {
              throw new AssistantActiveTurnInputBudgetExceededError()
            }
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
              acceptedInput: activeTurnInput,
              input: currentInput,
              providerRequestOrdinal,
            })
            assertAcceptedActiveTurnInputItemsAreNew({
              acceptedInputIds: providerRequestAcceptedInputIds,
              inputs: acceptedInputItems,
            })
            let acceptedInputJournal =
              await runtimeState.turns.acceptedInputs.append({
                inputs: acceptedInputItems,
                sessionId: resolved.session.sessionId,
                turnId: currentUserTurn.turnId,
              })
            const transcriptRefsByInputId =
              await appendAcceptedActiveTurnInputTranscriptEntries({
                acceptedInput: activeTurnInput,
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
              metadata: activeTurnInput.receiptMetadata ?? {},
            })
            await currentInput.activeTurnCheckpoint?.({
              acceptedInputIds: acceptedInputJournal.inputIds,
              providerRequestOrdinal,
              sessionId: providerResult.session.sessionId,
              signal: currentInput.abortSignal,
              turnId: currentUserTurn.turnId,
              vault: currentInput.vault,
            })
            const nextInput = buildActiveTurnContinuationInput({
              acceptedInput: activeTurnInput,
              input: previousInput,
            })
            if (activeTurnInput.providerAlreadySteered === true) {
              currentInput = nextInput
              providerRequestJournal =
                await runtimeState.turns.acceptedInputs.updateProviderRequest({
                  acceptedInputIds: acceptedInputJournal.inputIds,
                  continuation: providerResult.providerContinuation,
                  ordinal: providerRequestOrdinal,
                  providerAttemptId: null,
                  turnId: currentUserTurn.turnId,
                }) ?? providerRequestJournal
              providerRequestAcceptedInputIds =
                providerRequestJournal?.inputIds ?? acceptedInputJournal.inputIds
              continue
            }
            currentInput = nextInput
            activeTurnHistory = appendAssistantActiveTurnProviderExchange({
              acceptedInputIds: providerRequestAcceptedInputIds,
              assistantResponse: providerResult.response,
              history: activeTurnHistory,
              nonReplayableProviderWork:
                providerResult.nonReplayableProviderWork === true,
              userMessageContent: previousInput.userMessageContent ?? null,
              userPrompt: previousInput.prompt,
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
          activeTurnUsedExplicitHistory: activeTurnHistory !== null,
          input: currentInput,
          plan: sharedPlan,
          providerResult,
          persistUserPromptToTranscript: !userPromptPersistedToTranscript,
          turnContinuityPolicy,
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
          onboardingCompletionFallbackReason:
            providerResult.onboardingCompletionFallbackReason,
          onboardingGuidanceInjected:
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
        const retryAt =
          input.turnTrigger === 'automation-auto-reply'
            ? computeAssistantAutoReplyRetryAt(
                error,
                Date.parse(failedAt),
              )
            : null
        const failedSession =
          extractRecoveredAssistantSession(error) ?? resolved.session

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
            metadata:
              retryAt === null
                ? null
                : {
                    [AUTO_REPLY_RECEIPT_RETRY_AT_KEY]: retryAt,
                  },
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
        await runAssistantTurnBestEffort(() =>
          refreshAssistantStatusSnapshotLocal(input.vault),
        )
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

  return saveAssistantSession(input.vault, {
    ...session.session,
    provider: nextTarget.adapter,
    providerOptions: nextProviderOptions,
    resumeState: continuityChanged ? null : session.session.resumeState,
    target: nextTarget,
    updatedAt: new Date().toISOString(),
  })
}

async function runAssistantTurnBestEffort(
  task: () => Promise<unknown>,
): Promise<void> {
  try {
    await task()
  } catch {}
}

async function resolveAssistantActiveTurnInputAdmission(input: {
  activeTurnInputController: ReturnType<
    typeof createAssistantActiveTurnInputController
  > | null
  currentInput: AssistantMessageInput
  phase: 'request_boundary' | 'commit_barrier'
  providerRequestOrdinal: number
  providerResult: ExecutedAssistantProviderTurnResult
  userTurn: PersistedUserTurn
}): Promise<AssistantActiveTurnInputAdmissionResult | undefined> {
  return input.activeTurnInputController?.admit({
    phase: input.phase,
    signal: input.currentInput.abortSignal,
    sessionId: input.providerResult.session.sessionId,
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
