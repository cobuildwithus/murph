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
  appendAssistantTranscriptEntries,
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
import {
  prioritizeAssistantRoutesForRichUserMessageContent,
} from './rich-content-routing.js'
import { persistFailedAssistantPromptAttempt } from './prompt-attempts.js'
import { resolveAssistantTurnRoutes } from './service-turn-routes.js'
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
import type { AssistantAcceptedTurnInputItemInput } from './active-turn-input-journal.js'
import {
  appendAssistantActiveTurnProviderExchange,
  type AssistantActiveTurnProviderHistory,
} from './active-turn-history.js'
import {
  createAssistantActiveTurnInputQueue,
  steerAssistantActiveTurnInput,
} from './active-turn-input-queue.js'
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

async function appendUserTranscriptEntryForTurn(input: {
  createdAt?: string | null
  detail: string
  sessionId: string
  text: string
  turnId: string
  vault: string
}): Promise<string> {
  const fallbackCreatedAt = input.createdAt ?? new Date().toISOString()
  const userEntries = await appendAssistantTranscriptEntries(
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
  const persistedAt = userEntries[0]?.createdAt ?? fallbackCreatedAt
  await appendAssistantTurnReceiptEvent({
    vault: input.vault,
    turnId: input.turnId,
    kind: 'user.persisted',
    detail: input.detail,
    at: persistedAt,
  })

  return persistedAt
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
  if (plan.persistUserPromptOnFailure) {
    turnCreatedAt = await appendUserTranscriptEntryForTurn({
      detail: 'user prompt persisted before provider execution',
      sessionId: resolved.session.sessionId,
      text: input.prompt,
      turnId,
      vault: input.vault,
    })
    userPersisted = true
  }

  return {
    turnCreatedAt,
    turnId,
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
    const steeredResult = steerAssistantActiveTurnInput(input)
    if (steeredResult) {
      return steeredResult
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
      const routes = prioritizeAssistantRoutesForRichUserMessageContent({
        routes: resolveAssistantTurnRoutes(input, defaults, resolved),
        userMessageContent: input.userMessageContent,
      })
      const primaryRoute = routes[0] ?? null
      const receipt = await createAssistantTurnReceipt({
        vault: input.vault,
        sessionId: resolved.session.sessionId,
        provider: primaryRoute?.provider ?? resolved.session.provider,
        providerModel: primaryRoute?.providerOptions.model ?? null,
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
      let activeTurnInputQueue: ReturnType<
        typeof createAssistantActiveTurnInputQueue
      > | null = null

      try {
        userTurn = await persistUserTurn(input, resolved, sharedPlan, receipt.turnId)
        const runtimeState = createAssistantRuntimeStateService(input.vault)
        await runtimeState.turns.acceptedInputs.append({
          inputs: resolveInitialAcceptedTurnInputItems({
            input,
            resolved,
            userTurn,
          }),
          sessionId: resolved.session.sessionId,
          turnId: receipt.turnId,
        })
        const turnContinuityPolicy = resolveAssistantProviderTurnContinuityPolicy({
          turnTrigger: input.turnTrigger ?? null,
        })
        activeTurnInputQueue = isManualAssistantTurnTrigger(input.turnTrigger)
          ? createAssistantActiveTurnInputQueue({
              conversationKeys: [
                resolved.session.binding.conversationKey,
                resolveAssistantConversationLookupKey(input),
              ].filter((key): key is string => key !== null),
              sessionId: resolved.session.sessionId,
              vault: input.vault,
            })
          : null
        let currentInput = input
        let currentSession = resolved.session
        let activeTurnHistory: AssistantActiveTurnProviderHistory | null = null
        let providerResult: ExecutedAssistantProviderTurnResult | null = null
        let activeTurnRouteLock: ExecutedAssistantProviderTurnResult['route'] | null = null
        let userPromptPersistedToTranscript = userTurn.userPersisted
        providerLoop: for (
          let providerRequestOrdinal = 0;
          providerRequestOrdinal <= MAX_ACTIVE_TURN_INPUT_CONTINUATIONS;
          providerRequestOrdinal += 1
        ) {
          const providerRequestJournal =
            await runtimeState.turns.acceptedInputs.recordProviderRequest({
              ordinal: providerRequestOrdinal,
              turnId: userTurn.turnId,
            })
          const providerOutcome = await executeProviderTurnWithRecovery({
            activeTurnHistory,
            input: currentInput,
            routes: activeTurnRouteLock ? [activeTurnRouteLock] : routes,
            plan: sharedPlan,
            profile: {
              turnContinuityPolicy,
            },
            resolvedSession: currentSession,
            turnCreatedAt: userTurn.turnCreatedAt,
            turnId: userTurn.turnId,
          })
          if (providerOutcome.kind === 'failed_terminal') {
            throw providerOutcome.error
          }

          providerResult = providerOutcome.providerTurn
          currentSession = providerResult.session
          responseText = providerResult.response
          if (providerResult.nonReplayableProviderWork) {
            activeTurnRouteLock = providerResult.route
          }
          await persistPendingAssistantUsageEvent({
            executionContext,
            providerRequestOrdinal,
            providerResult,
            turnId: userTurn.turnId,
            vault: currentInput.vault,
          })

          for (const phase of ['request_boundary', 'commit_barrier'] as const) {
            const activeTurnInput =
              await resolveAssistantActiveTurnInputAdmission({
                activeTurnInputQueue,
                currentInput,
                phase,
                providerRequestOrdinal,
                providerResult,
                userTurn,
            })
            if (activeTurnInput?.kind !== 'accepted') {
              if (activeTurnInput && phase === 'commit_barrier') {
                activeTurnInputQueue?.close()
                await currentInput.activeTurnCheckpoint?.({
                  acceptedInputIds: [],
                  providerRequestOrdinal,
                  sessionId: providerResult.session.sessionId,
                  signal: currentInput.abortSignal,
                  turnId: userTurn.turnId,
                  vault: currentInput.vault,
                })
              }
              continue
            }
            if (providerRequestOrdinal >= MAX_ACTIVE_TURN_INPUT_CONTINUATIONS) {
              throw new AssistantActiveTurnInputBudgetExceededError()
            }
            const acceptedInputJournal =
              await runtimeState.turns.acceptedInputs.append({
                inputs: resolveAcceptedActiveTurnInputItems({
                  acceptedInput: activeTurnInput,
                  input: currentInput,
                  providerRequestOrdinal,
                }),
                sessionId: resolved.session.sessionId,
                turnId: userTurn.turnId,
              })
            const previousInput = currentInput
            if (!userPromptPersistedToTranscript) {
              const persistedAt = await appendUserTranscriptEntryForTurn({
                createdAt: userTurn.turnCreatedAt,
                detail:
                  'user prompt persisted before active-turn continuation',
                sessionId: resolved.session.sessionId,
                text: previousInput.prompt,
                turnId: userTurn.turnId,
                vault: currentInput.vault,
              })
              userTurn = {
                ...userTurn,
                turnCreatedAt: persistedAt,
                userPersisted: true,
              }
              userPromptPersistedToTranscript = true
            }
            for (const transcriptText of resolveAcceptedActiveTurnTranscriptTexts(
              activeTurnInput,
            )) {
              await appendUserTranscriptEntryForTurn({
                detail:
                  'accepted active-turn input persisted before provider continuation',
                sessionId: resolved.session.sessionId,
                text: transcriptText,
                turnId: userTurn.turnId,
                vault: currentInput.vault,
              })
            }
            await appendAssistantTurnReceiptEvent({
              vault: currentInput.vault,
              turnId: userTurn.turnId,
              kind: 'turn.input.accepted',
              detail: null,
              metadata: activeTurnInput.receiptMetadata ?? {},
            })
            await currentInput.activeTurnCheckpoint?.({
              acceptedInputIds: acceptedInputJournal.inputIds,
              providerRequestOrdinal,
              sessionId: providerResult.session.sessionId,
              signal: currentInput.abortSignal,
              turnId: userTurn.turnId,
              vault: currentInput.vault,
            })
            currentInput = buildActiveTurnContinuationInput({
              acceptedInput: activeTurnInput,
              input: previousInput,
            })
            activeTurnHistory = appendAssistantActiveTurnProviderExchange({
              acceptedInputIds: providerRequestJournal?.inputIds ?? null,
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

        activeTurnInputQueue?.close()
        await runtimeState.turns.acceptedInputs.updateAdmissionState({
          admissionState: 'commit-started',
          turnId: userTurn.turnId,
        })
        const session = await finalizeAssistantTurnArtifacts({
          activeTurnUsedExplicitHistory: activeTurnHistory !== null,
          input: currentInput,
          plan: sharedPlan,
          providerResult,
          persistUserPromptToTranscript: !userPromptPersistedToTranscript,
          turnContinuityPolicy,
          session: providerResult.session,
          turnCreatedAt: userTurn.turnCreatedAt,
          turnId: userTurn.turnId,
        })
        const deliveryOutcome = await dispatchAssistantReply({
          input: currentInput,
          response: providerResult.response,
          session,
          sharedPlan,
          turnId: userTurn.turnId,
        })

        await finalizeDeliveredAssistantTurn({
          onboardingCompletionFallbackReason:
            providerResult.onboardingCompletionFallbackReason,
          onboardingGuidanceInjected:
            providerResult.onboardingGuidanceInjected,
          firstContactStateDocIds: sharedPlan.firstContactStateDocIds,
          outcome: deliveryOutcome,
          response: providerResult.response,
          turnId: userTurn.turnId,
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
        activeTurnInputQueue?.complete(result)
        return result
      } catch (error) {
        activeTurnInputQueue?.fail(error)
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
        activeTurnInputQueue?.close()
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

function resolveAcceptedActiveTurnTranscriptTexts(
  acceptedInput: Extract<
    AssistantActiveTurnInputAdmissionResult,
    { kind: 'accepted' }
  >,
): readonly string[] {
  const fallbackTexts = acceptedInput.acceptedInputs
    ?.map((item) => normalizeNullableString(item.promptFallbackText))
    .filter((text): text is string => text !== null)
  if (fallbackTexts && fallbackTexts.length > 0) {
    return fallbackTexts
  }

  const directText = normalizeNullableString(acceptedInput.transcriptText)
  if (directText) {
    return [directText]
  }

  return [acceptedInput.prompt]
}

async function resolveAssistantActiveTurnInputAdmission(input: {
  activeTurnInputQueue: ReturnType<
    typeof createAssistantActiveTurnInputQueue
  > | null
  currentInput: AssistantMessageInput
  phase: 'request_boundary' | 'commit_barrier'
  providerRequestOrdinal: number
  providerResult: ExecutedAssistantProviderTurnResult
  userTurn: PersistedUserTurn
}): Promise<AssistantActiveTurnInputAdmissionResult | undefined> {
  const hookAdmission = await input.currentInput.activeTurnInput?.({
    phase: input.phase,
    providerRequestOrdinal: input.providerRequestOrdinal,
    response: input.providerResult.response,
    sessionId: input.providerResult.session.sessionId,
    turnId: input.userTurn.turnId,
    vault: input.currentInput.vault,
  })
  if (hookAdmission?.kind === 'accepted') {
    return hookAdmission
  }

  const queuedAdmission = input.activeTurnInputQueue?.admit()
  if (queuedAdmission?.kind === 'accepted') {
    return queuedAdmission
  }

  return hookAdmission
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
      id: 'initial',
      promptFallbackReason:
        isManualAssistantTurnTrigger(input.input.turnTrigger)
          ? 'manual-input'
          : 'system-input',
      promptFallbackText: input.input.prompt,
      source: isManualAssistantTurnTrigger(input.input.turnTrigger)
        ? 'manual'
        : 'initial',
      transcriptRef: {
        entryCreatedAt: input.userTurn.turnCreatedAt,
        entryIndex: null,
        entryKind: input.userTurn.userPersisted ? 'user' : null,
        sessionId: input.resolved.session.sessionId,
      },
    },
  ]
}

function resolveAcceptedActiveTurnInputItems(input: {
  acceptedInput: Extract<
    AssistantActiveTurnInputAdmissionResult,
    { kind: 'accepted' }
  >
  input: AssistantMessageInput
  providerRequestOrdinal: number
}): readonly AssistantAcceptedTurnInputItemInput[] {
  const acceptedInputs = input.acceptedInput.acceptedInputs ?? null
  if (acceptedInputs && acceptedInputs.length > 0) {
    return acceptedInputs
  }

  return [
    {
      id: `request-${input.providerRequestOrdinal + 1}`,
      promptFallbackReason:
        isManualAssistantTurnTrigger(input.input.turnTrigger)
          ? 'manual-input'
          : 'system-input',
      promptFallbackText: input.acceptedInput.prompt,
      source:
        input.input.turnTrigger === 'automation-auto-reply' ? 'inbox' : 'manual',
    },
  ]
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
