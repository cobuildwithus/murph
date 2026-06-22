import {
  assistantAskResultSchema,
  type AssistantAskResult,
  type AssistantResponseMedia,
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
  deliverAssistantPrecedingReplies,
  deliverAssistantReaction,
  deliverAssistantReply as dispatchAssistantReply,
  deliverAssistantProgressUpdate,
  finalizeAssistantTurnFromDeliveryOutcome as finalizeDeliveredAssistantTurn,
  supportsAssistantCurrentAudienceMessageReaction,
  type AssistantPrecedingReplySegment,
} from './delivery-service.js'
import {
  applyAssistantReplyDeliveryContext,
  applyAssistantReplyDeliveryContextOverrides,
  pickAssistantReplyDeliveryContext,
  type AssistantReplyDeliveryContext,
} from './reply-delivery-context.js'
import {
  clearAssistantSessionCodexResumeState,
  persistAssistantNoReplyTranscriptMarkers,
  persistAssistantTurnAndSession as finalizeAssistantTurnArtifacts,
} from './turn-finalizer.js'
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
import {
  normalizeAssistantExecutionContext,
  type AssistantHostedProgressDeliveryDependencies,
  type AssistantExecutionContext,
} from './execution-context.js'
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
import {
  recordAdditionalAssistantUsageEvents,
  recordAssistantUsageEvent,
} from './service-usage.js'
import { maybeRunAssistantRuntimeMaintenance } from './runtime-budgets.js'
import {
  type AssistantActiveTurnInputAdmissionResult,
} from './turn-input.js'
import {
  startAssistantChannelTypingIndicator,
  stopAssistantChannelTypingIndicator,
} from './channel-typing.js'
import {
  createAssistantProgressDelivery,
  shouldCreateAssistantProgressDelivery,
  type AssistantProgressDelivery,
} from './turn-progress.js'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import type {
  AssistantAcceptedTurnInputJournal,
  AssistantAcceptedTurnInputItemInput,
  AssistantAcceptedTurnInputTranscriptRef,
} from './active-turn-input-journal.js'
import {
  assertAssistantAcceptedTurnInputAssistantInputEventsExist,
  assertAssistantAcceptedTurnInputItemInputsAssistantInputEventsExist,
} from './active-turn-input-journal.js'
import {
  createAssistantActiveTurnNotActiveError,
  createAssistantActiveTurnInputController,
  steerAssistantActiveTurnInputWithStatus,
} from './active-turn-input-controller.js'
import { normalizeNullableString } from './shared.js'
import type {
  AssistantMessageInput,
  AssistantDeliveryOutcome,
  AssistantSessionResolutionFields,
  AssistantTurnSharedPlan,
  ExecutedAssistantProviderTurnResult,
  PersistedUserTurn,
} from './service-contracts.js'
import { withAssistantTurnLock } from './turn-lock.js'

export { buildResolveAssistantSessionInput } from './session-resolution.js'

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

function hasHostedProgressDeliveryForChannel(input: {
  channel: string | null
  dependencies?: AssistantHostedProgressDeliveryDependencies | null
}): boolean {
  const dependencies = input.dependencies
  if (!dependencies) {
    return false
  }

  switch (input.channel) {
    case 'telegram':
      return typeof dependencies.sendTelegram === 'function'
    case 'linq':
      return typeof dependencies.sendLinq === 'function'
    case 'email':
      return typeof dependencies.sendEmail === 'function'
    default:
      return false
  }
}

function isRequiredUserMessageDeliveryAvailable(input: {
  executionContext: AssistantExecutionContext | null
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
}): boolean {
  const hosted = input.executionContext?.hosted
  if (!hosted) {
    return true
  }

  return hasHostedProgressDeliveryForChannel({
    channel: resolveAssistantProgressDeliveryChannel(input),
    dependencies: hosted.progressDeliveryDependencies,
  })
}

function isHostedComputerToolTransportAvailable(input: {
  executionContext: AssistantExecutionContext | null
}): boolean {
  return typeof input.executionContext?.hosted?.providerFetch === 'function'
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
      typeof input.expectedActiveTurnId === 'string' &&
      steerResult.kind === 'no-active-turn'
    ) {
      throw createAssistantActiveTurnNotActiveError()
    }
  }

  await runAssistantTurnBestEffort(() =>
    maybeRunAssistantRuntimeMaintenance({
      vault: input.vault,
    })
  )

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
      const sessionResolveStartedAt = Date.now()
      const resolved = await resolveAssistantMessageSession({
        boundaryDefaultTarget,
        defaults,
        message: input,
      })
      const sessionResolveMs = elapsedSince(sessionResolveStartedAt)
      await emitHostedAssistantContextSessionResolvedTrace({
        message: input,
        resolved,
        source: 'assistant-message',
      })
      const promptBuildStartedAt = Date.now()
      const sharedPlan = await buildAssistantTurnSharedPlan(input, resolved)
      const promptBuildMs = elapsedSince(promptBuildStartedAt)
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
        const turnInputController = createAssistantActiveTurnInputController({
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
        activeTurnInputController = turnInputController
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
        const requiredUserMessageDeliveryAvailable =
          isRequiredUserMessageDeliveryAvailable({
            executionContext,
            session: resolved.session,
            sharedPlan,
          })
        const hostedComputerToolsAvailable =
          isHostedComputerToolTransportAvailable({
            executionContext,
          }) && requiredUserMessageDeliveryAvailable
        const progressDelivery = shouldCreateAssistantProgressDelivery(input)
          ? createAssistantProgressDelivery({
              deliver: async (progressInput) => {
                const hosted = executionContext?.hosted
                if (hosted) {
                  const dependencies = hosted.progressDeliveryDependencies
                  if (
                    !dependencies ||
                    !hasHostedProgressDeliveryForChannel({
                      channel: resolveAssistantProgressDeliveryChannel(
                        progressInput,
                      ),
                      dependencies,
                    })
                  ) {
                    throw new VaultCliError(
                      'ASSISTANT_PROGRESS_CHANNEL_UNSUPPORTED',
                      'Hosted model progress updates are unavailable for the current delivery channel.',
                    )
                  }
                  await deliverAssistantProgressUpdate({
                    ...progressInput,
                    dependencies,
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
              hostedComputerToolsAvailable,
              requiredUserMessageDeliveryAvailable,
              session: resolved.session,
              sharedPlan,
              turnId: currentUserTurn.turnId,
            })
          : null
        let providerResult: ExecutedAssistantProviderTurnResult | null = null
        let userPromptPersistedToTranscript = currentUserTurn.userPersisted
        const providerRequestOrdinal = 0
        let acceptedInputIdsForProviderRequest: readonly string[] =
          initialAcceptedInputJournal.inputIds
        const persistInitialUserPromptToTranscriptIfNeeded = async (persistInput: {
          detail: string
          prompt: string
          vault: string
        }) => {
          if (userPromptPersistedToTranscript) {
            return
          }
          const persisted = await appendUserTranscriptEntryForTurn({
            createdAt: currentUserTurn.turnCreatedAt,
            detail: persistInput.detail,
            sessionId: resolved.session.sessionId,
            text: persistInput.prompt,
            turnId: currentUserTurn.turnId,
            vault: persistInput.vault,
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
          await persistInitialUserPromptToTranscriptIfNeeded({
            detail: 'user prompt persisted before active-turn input',
            prompt: previousInput.prompt,
            vault: previousInput.vault,
          })
          const acceptedInputItems = resolveAcceptedActiveTurnInputItems({
            acceptedInput: acceptanceInput.activeTurnInput,
            input: currentInput,
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
          const nextInput = buildActiveTurnInput({
            acceptedInput: acceptanceInput.activeTurnInput,
            input: previousInput,
          })
          currentInput = nextInput
          acceptedInputIdsForProviderRequest = acceptedInputJournal.inputIds
          return {
            acceptedInputJournal,
            acceptedInputItems,
            previousInput,
          }
        }
        const admissionStartedAt = Date.now()
        const preProviderInput = await turnInputController.admitAvailable({
          probeIfIdle: true,
          signal: currentInput.abortSignal,
        })
        const preProviderAdmissionCount =
          preProviderInput?.kind === 'accepted' ? 1 : 0
        if (preProviderInput?.kind === 'accepted') {
          await acceptActiveTurnInput({
            activeTurnInput: preProviderInput,
            providerRequestAcceptedInputIds: acceptedInputIdsForProviderRequest,
            providerRequestOrdinal,
            sessionId: currentSession.sessionId,
          })
        }
        const replyDeliveryContexts: AssistantReplyDeliveryContext[] = [
          pickAssistantReplyDeliveryContext(currentInput),
        ]
        const acceptedInputIdsByDeliveryContextOrdinal: string[][] = [
          [...acceptedInputIdsForProviderRequest],
        ]
        const resolveAcceptedInputIdsForDeliveryContextOrdinal = (
          deliveryContextOrdinal: number,
        ): readonly string[] => [
          ...(acceptedInputIdsByDeliveryContextOrdinal[deliveryContextOrdinal] ??
            acceptedInputIdsForProviderRequest),
        ]
        const admissionMs = elapsedSince(admissionStartedAt)
        const preProviderSetupMs = elapsedSince(lockAcquiredAt)
        emitHostedAssistantContextTimingTrace({
          message: input,
          preProviderAdmissionCount,
          preProviderSetupMs,
          providerRequestOrdinal,
          stage: 'assistant-pre-provider-ready',
          turnLockWaitMs,
        })
        let providerRequestJournal: Awaited<
          ReturnType<typeof runtimeState.turns.acceptedInputs.recordProviderRequest>
        > = null
        let codexUnsafeResumeStateInvalidated = false
        const noReplyTranscriptMarkerDeliveryContextOrdinals = new Set<number>()
        let providerRequestContinuation:
          ExecutedAssistantProviderTurnResult['codexContinuation'] | null = null
        let providerRequestAcceptedInputIds: readonly string[] =
          acceptedInputIdsForProviderRequest
        const drainLiveSteeredActiveTurnInputs = async (drainInput: {
          continuation:
            ExecutedAssistantProviderTurnResult['codexContinuation'] | null
          sessionId: string
          throughDeliveryContextOrdinal?: number | null
        }) => {
          while (true) {
            if (
              typeof drainInput.throughDeliveryContextOrdinal === 'number' &&
              replyDeliveryContexts.length > drainInput.throughDeliveryContextOrdinal
            ) {
              break
            }
            const activeTurnInput =
              await turnInputController.admitLiveSteered()
            if (activeTurnInput?.kind !== 'accepted') {
              break
            }
            const accepted = await acceptActiveTurnInput({
              activeTurnInput,
              providerRequestAcceptedInputIds,
              providerRequestOrdinal,
              sessionId: drainInput.sessionId,
            })
            replyDeliveryContexts.push(
              pickAssistantReplyDeliveryContext(currentInput),
            )
            acceptedInputIdsByDeliveryContextOrdinal[
              replyDeliveryContexts.length - 1
            ] = [...accepted.acceptedInputJournal.inputIds]
            if (drainInput.continuation) {
              providerRequestJournal =
                await runtimeState.turns.acceptedInputs.updateProviderRequest({
                  acceptedInputIds: accepted.acceptedInputJournal.inputIds,
                  continuation: drainInput.continuation,
                  ordinal: providerRequestOrdinal,
                  providerAttemptId: null,
                  turnId: currentUserTurn.turnId,
                }) ?? providerRequestJournal
              providerRequestAcceptedInputIds =
                providerRequestJournal?.inputIds ??
                accepted.acceptedInputJournal.inputIds
            } else {
              providerRequestAcceptedInputIds =
                accepted.acceptedInputJournal.inputIds
            }
            acceptedInputIdsForProviderRequest = providerRequestAcceptedInputIds
          }
        }
        const providerOutcome = await executeCodexTurnWithRecovery({
          activeTurnSteering: turnInputController,
          input: currentInput,
          onCodexThreadHistoryUnsafe: async (event) => {
            if (!codexUnsafeResumeStateInvalidated) {
              await clearAssistantSessionCodexResumeStateIfNeeded({
                action: resolveProviderResumeStateAction({
                  codexThreadHistoryUnsafe: true,
                  codexThreadId: null,
                  threadScope,
                }),
                session: currentSession,
                vault: input.vault,
              })
              codexUnsafeResumeStateInvalidated = true
            }
            const deliveryContextOrdinal = event?.deliveryContextOrdinal
            if (
              typeof deliveryContextOrdinal !== 'number' ||
              noReplyTranscriptMarkerDeliveryContextOrdinals.has(
                deliveryContextOrdinal,
              )
            ) {
              return
            }
            await persistAssistantNoReplyTranscriptMarkers({
              deliveryContextOrdinals: [deliveryContextOrdinal],
              sessionId: currentSession.sessionId,
              turnCreatedAt: currentUserTurn.turnCreatedAt,
              turnId: currentUserTurn.turnId,
              vault: input.vault,
            })
            noReplyTranscriptMarkerDeliveryContextOrdinals.add(
              deliveryContextOrdinal,
            )
          },
          onFinishWithoutReplyAccepted: async (event) => {
            await drainLiveSteeredActiveTurnInputs({
              continuation: providerRequestContinuation,
              sessionId: currentSession.sessionId,
              throughDeliveryContextOrdinal: event.deliveryContextOrdinal,
            })
            await persistInitialUserPromptToTranscriptIfNeeded({
              detail: 'user prompt persisted before no-reply completion',
              prompt: currentInput.prompt,
              vault: currentInput.vault,
            })
            const noReplyDeliveryContext =
              resolveAssistantReplyDeliveryContextForSegment({
                contexts: replyDeliveryContexts,
                deliveryContextOrdinal: event.deliveryContextOrdinal,
              })
            const noReplyInput = noReplyDeliveryContext.context
              ? applyAssistantReplyDeliveryContext({
                  context: noReplyDeliveryContext.context,
                  input: currentInput,
                })
              : currentInput
            await currentInput.onFinishWithoutReplyAccepted?.({
              acceptedInputIds:
                resolveAcceptedInputIdsForDeliveryContextOrdinal(
                  event.deliveryContextOrdinal,
                ),
              deliveryContextOrdinal: event.deliveryContextOrdinal,
              messageReactionsAvailable:
                noReplyDeliveryContext.invalidDeliveryContextOrdinal === null &&
                supportsAssistantCurrentAudienceMessageReaction({
                  input: noReplyInput,
                  session: currentSession,
                  sharedPlan,
                }),
            })
          },
          onProviderRequestPlanned: async (event) => {
            providerRequestContinuation = event.codexContinuation
            providerRequestJournal =
              await runtimeState.turns.acceptedInputs.recordProviderRequest({
                continuation: event.codexContinuation,
                ordinal: providerRequestOrdinal,
                providerAttemptId: event.providerAttemptId,
                turnId: currentUserTurn.turnId,
              })
            providerRequestAcceptedInputIds =
              providerRequestJournal?.inputIds ?? acceptedInputIdsForProviderRequest
            acceptedInputIdsForProviderRequest = providerRequestAcceptedInputIds
          },
          onProviderRequestStarted: (event) => {
            if (!currentInput.onProviderRequestStarted) {
              return
            }
            return currentInput.onProviderRequestStarted({
              acceptedInputIds: providerRequestAcceptedInputIds,
              admissionMs,
              preProviderSetupMs,
              promptBuildMs,
              providerRequestOrdinal:
                event.providerRequestOrdinal ?? providerRequestOrdinal,
              sessionResolveMs,
              startedAt: event.startedAt,
              turnLockWaitMs,
            })
          },
          route,
          plan: sharedPlan,
          profile: {
            threadScope,
          },
          providerRequestOrdinal,
          resolvedSession: currentSession,
          turnCreatedAt: currentUserTurn.turnCreatedAt,
          progressDelivery,
          turnId: currentUserTurn.turnId,
        })
        if (providerOutcome.kind === 'failed_terminal') {
          if (!providerRequestJournal) {
            providerRequestJournal =
              await runtimeState.turns.acceptedInputs.recordProviderRequest({
                continuation: providerOutcome.codexContinuation,
                ordinal: providerRequestOrdinal,
                providerAttemptId: null,
                turnId: currentUserTurn.turnId,
              })
            providerRequestAcceptedInputIds =
              providerRequestJournal?.inputIds ?? acceptedInputIdsForProviderRequest
            acceptedInputIdsForProviderRequest = providerRequestAcceptedInputIds
          } else {
            providerRequestJournal =
              await runtimeState.turns.acceptedInputs.updateProviderRequest({
                continuation: providerOutcome.codexContinuation,
                ordinal: providerRequestOrdinal,
                providerAttemptId: null,
                turnId: currentUserTurn.turnId,
              }) ?? providerRequestJournal
            providerRequestAcceptedInputIds =
              providerRequestJournal?.inputIds ?? providerRequestAcceptedInputIds
            acceptedInputIdsForProviderRequest = providerRequestAcceptedInputIds
          }
          const failedProviderResult = {
            attemptCount: providerOutcome.attemptCount,
            provider: providerOutcome.route.provider,
            providerOptions: providerOutcome.route.providerOptions,
            route: providerOutcome.route,
            session: providerOutcome.session,
            usage: providerOutcome.usage,
            usageAttribution: providerOutcome.usageAttribution,
          }
          await recordAssistantUsageEvent({
            executionContext,
            providerRequestOrdinal,
            providerRequestOutcome: providerOutcome.providerRequestOutcome,
            providerResult: failedProviderResult,
            turnId: currentUserTurn.turnId,
          })
          await recordAdditionalAssistantUsageEvents({
            additionalUsages: providerOutcome.additionalUsages,
            effectiveEnv: currentInput.turnEnvironment?.env ?? process.env,
            executionContext,
            providerResult: failedProviderResult,
            turnId: currentUserTurn.turnId,
          })
          const acceptedNoReplyOrdinals =
            providerOutcome.acceptedNoReplyDeliveryContextOrdinals ?? []
          const latestAcceptedDeliveryContextOrdinal = replyDeliveryContexts.length - 1
          const recoverableNoReplyDeliveryContextOrdinal =
            latestAcceptedDeliveryContextOrdinal >= 0 &&
            acceptedNoReplyOrdinals.includes(latestAcceptedDeliveryContextOrdinal)
              ? latestAcceptedDeliveryContextOrdinal
              : null
          const failedProviderResumeStateAction = resolveProviderResumeStateAction({
            codexThreadHistoryUnsafe:
              providerOutcome.codexThreadHistoryUnsafe === true ||
              acceptedNoReplyOrdinals.length > 0,
            codexThreadId: providerOutcome.codexThreadId ?? null,
            threadScope,
          })
          if (!codexUnsafeResumeStateInvalidated) {
            await clearAssistantSessionCodexResumeStateIfNeeded({
              action: failedProviderResumeStateAction,
              session: providerOutcome.session,
              vault: input.vault,
            })
          }
          if (recoverableNoReplyDeliveryContextOrdinal !== null) {
            turnInputController.close()
            await runtimeState.turns.acceptedInputs.updateAdmissionState({
              admissionState: 'commit-started',
              turnId: currentUserTurn.turnId,
            })
            const recoveredReactions = (providerOutcome.reactions ?? []).filter(
              (reaction) =>
                reaction.deliveryContextOrdinal <= recoverableNoReplyDeliveryContextOrdinal,
            )
            const failedNoReplyProviderResult: ExecutedAssistantProviderTurnResult = {
              acceptedNoReplyDeliveryContextOrdinals: acceptedNoReplyOrdinals,
              assistantContractFingerprint: '',
              attemptCount: providerOutcome.attemptCount,
              codexContinuation: providerOutcome.codexContinuation,
              codexThreadHistoryUnsafe: true,
              codexThreadId: providerOutcome.codexThreadId,
              finalAction: {
                kind: 'none',
              },
              provider: providerOutcome.route.provider,
              providerOptions: providerOutcome.route.providerOptions,
              rawEvents: providerOutcome.rawEvents,
              reactions: recoveredReactions,
              response: '',
              responseMedia: [],
              route: providerOutcome.route,
              session: providerOutcome.session,
              stderr: '',
              stdout: '',
              usage: providerOutcome.usage,
              usageAttribution: providerOutcome.usageAttribution,
              workingDirectory: sharedPlan.requestedWorkingDirectory,
            }
            const session = await finalizeAssistantTurnArtifacts({
              assistantTranscriptText: null,
              input: currentInput,
              plan: sharedPlan,
              precedingAssistantTranscriptTexts: [],
              providerResult: failedNoReplyProviderResult,
              providerResumeStateAction: failedProviderResumeStateAction,
              persistUserPromptToTranscript: !userPromptPersistedToTranscript,
              session: providerOutcome.session,
              turnCreatedAt: currentUserTurn.turnCreatedAt,
              turnId: currentUserTurn.turnId,
            })
            const {
              deliverySession,
              reactionDeliveryOutcomes,
            } = await deliverAssistantProviderReactions({
              currentInput,
              providerResult: failedNoReplyProviderResult,
              replyDeliveryContexts,
              session,
              sharedPlan,
              turnId: currentUserTurn.turnId,
            })
            const deliveryOutcome = resolveAssistantNoReplyDeliveryOutcome({
              precedingDeliveryOutcomes: [],
              session: deliverySession,
            })
            const finalDeliveryOutcome =
              deliveryOutcome.kind === 'not-requested' &&
              reactionDeliveryOutcomes.length > 0
                ? reactionDeliveryOutcomes[reactionDeliveryOutcomes.length - 1]!
                : deliveryOutcome
            await finalizeDeliveredAssistantTurn({
              firstContactStateDocIds: sharedPlan.firstContactStateDocIds,
              outcome: finalDeliveryOutcome,
              response: '',
              turnId: currentUserTurn.turnId,
              vault: input.vault,
            })
            const result = normalizeAssistantAskResultForReturn({
              vault: redactAssistantDisplayPath(input.vault),
              status: 'completed',
              prompt: currentInput.prompt,
              response: '',
              responseDisposition: 'none' as const,
              media: finalDeliveryOutcome.media,
              session: finalDeliveryOutcome.session,
              delivery:
                finalDeliveryOutcome.kind === 'sent'
                  ? finalDeliveryOutcome.delivery
                  : null,
              deliveryDeferred: finalDeliveryOutcome.kind === 'queued',
              deliveryIntentId:
                finalDeliveryOutcome.kind === 'sent' ||
                finalDeliveryOutcome.kind === 'queued' ||
                finalDeliveryOutcome.kind === 'failed'
                  ? finalDeliveryOutcome.intentId
                  : null,
              deliveryError:
                finalDeliveryOutcome.kind === 'queued' ||
                finalDeliveryOutcome.kind === 'failed'
                  ? finalDeliveryOutcome.error
                  : null,
            })
            turnInputController.complete(result)
            return result
          }
          await drainLiveSteeredActiveTurnInputs({
            continuation: providerOutcome.codexContinuation,
            sessionId: providerOutcome.session.sessionId,
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
            providerRequestJournal?.inputIds ?? acceptedInputIdsForProviderRequest
          acceptedInputIdsForProviderRequest = providerRequestAcceptedInputIds
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
          acceptedInputIdsForProviderRequest = providerRequestAcceptedInputIds
        }
        currentSession = providerResult.session
        responseText = providerResult.response
        await recordAssistantUsageEvent({
          executionContext,
          providerRequestOrdinal,
          providerResult,
          turnId: currentUserTurn.turnId,
        })
        await recordAdditionalAssistantUsageEvents({
          additionalUsages: providerResult.additionalUsages,
          effectiveEnv: currentInput.turnEnvironment?.env ?? process.env,
          executionContext,
          providerResult,
          turnId: currentUserTurn.turnId,
        })

        await drainLiveSteeredActiveTurnInputs({
          continuation: providerResult.codexContinuation,
          sessionId: providerResult.session.sessionId,
        })

        turnInputController.close()
        await runtimeState.turns.acceptedInputs.updateAdmissionState({
          admissionState: 'commit-started',
          turnId: currentUserTurn.turnId,
        })
        // Final answers the model completed before a steered message arrived
        // are delivered ahead of the final reply with their own media.
        const precedingResponseSegments: AssistantPrecedingReplySegment[] = []
        for (const [segmentOrdinal, segment] of
          (providerResult.precedingResponseSegments ?? []).entries()) {
          const resolvedDeliveryContext =
            resolveAssistantReplyDeliveryContextForSegment({
              contexts: replyDeliveryContexts,
              deliveryContextOrdinal: segment.deliveryContextOrdinal,
            })
          if (resolvedDeliveryContext.invalidDeliveryContextOrdinal !== null) {
            await runAssistantTurnBestEffort(() =>
              recordAssistantDiagnosticEvent({
                vault: input.vault,
                component: 'assistant',
                kind: 'delivery.preceding-reply.delivery-context-ordinal-invalid',
                level: 'warn',
                message:
                  'Preceding assistant reply referenced an invalid delivery context ordinal.',
                code: 'ASSISTANT_DELIVERY_CONTEXT_ORDINAL_INVALID',
                sessionId: providerResult.session.sessionId,
                turnId: currentUserTurn.turnId,
                data: {
                  contextCount: replyDeliveryContexts.length,
                  deliveryContextOrdinal:
                    resolvedDeliveryContext.invalidDeliveryContextOrdinal,
                  segmentOrdinal,
                },
              }),
            )
            continue
          }
          precedingResponseSegments.push({
            deliveryContext: resolvedDeliveryContext.context,
            response: segment.response,
            media: segment.media ?? [],
          })
        }
        const precedingResponses = precedingResponseSegments.map(
          (segment) => segment.response,
        )
        const providerResumeStateAction = resolveProviderResumeStateAction({
          codexThreadHistoryUnsafe:
            providerResult.codexThreadHistoryUnsafe === true ||
            providerResult.finalAction?.kind === 'none',
          codexThreadId: providerResult.codexThreadId ?? null,
          threadScope,
        })
        if (!codexUnsafeResumeStateInvalidated) {
          await clearAssistantSessionCodexResumeStateIfNeeded({
            action: providerResumeStateAction,
            session: providerResult.session,
            vault: input.vault,
          })
        }
        const noReplySelected = providerResult.finalAction?.kind === 'none'
        const finalResponseText = noReplySelected
          ? null
          : resolveAssistantProviderFinalResponseText(providerResult)
        const assistantTranscriptText = resolveAssistantProviderTranscriptText({
          media: providerResult.responseMedia,
          response: finalResponseText,
        })
        const session = await finalizeAssistantTurnArtifacts({
          assistantTranscriptText,
          input: currentInput,
          plan: sharedPlan,
          precedingAssistantTranscriptTexts: precedingResponses,
          providerResult,
          providerResumeStateAction,
          persistUserPromptToTranscript: !userPromptPersistedToTranscript,
          session: providerResult.session,
          turnCreatedAt: currentUserTurn.turnCreatedAt,
          turnId: currentUserTurn.turnId,
        })
        // Preceding-answer delivery is best-effort only when a final reply can
        // still compensate. If no final reply is selected, preceding delivery
        // work is the turn's only user-visible outbound work.
        let precedingDeliveryOutcomes: Awaited<
          ReturnType<typeof deliverAssistantPrecedingReplies>
        > = []
        try {
          precedingDeliveryOutcomes = await deliverAssistantPrecedingReplies({
            input: currentInput,
            segments: precedingResponseSegments,
            session,
            sharedPlan,
            turnId: currentUserTurn.turnId,
          })
        } catch (precedingError) {
          const normalizedPrecedingError =
            normalizeAssistantDeliveryError(precedingError)
          if (finalResponseText === null) {
            precedingDeliveryOutcomes = [
              {
                kind: 'failed',
                error: normalizedPrecedingError,
                intentId: null,
                media: [],
                session,
              },
            ]
          } else {
            await runAssistantTurnBestEffort(() =>
              recordAssistantDiagnosticEvent({
                vault: input.vault,
                component: 'assistant',
                kind: 'delivery.preceding-reply.failed',
                level: 'error',
                message: normalizedPrecedingError.message,
                code: normalizedPrecedingError.code,
                sessionId: session.sessionId,
                turnId: currentUserTurn.turnId,
              }),
            )
          }
        }
        for (const precedingOutcome of precedingDeliveryOutcomes) {
          if (precedingOutcome.kind !== 'failed') {
            continue
          }
          await runAssistantTurnBestEffort(() =>
            recordAssistantDiagnosticEvent({
              vault: input.vault,
              component: 'assistant',
              kind: 'delivery.preceding-reply.failed',
              level: 'error',
              message: precedingOutcome.error.message,
              code: precedingOutcome.error.code,
              sessionId: precedingOutcome.session.sessionId,
              turnId: currentUserTurn.turnId,
            }),
          )
        }
        let deliverySession =
          precedingDeliveryOutcomes.at(-1)?.session ?? session
        const deliveryOutcome =
          finalResponseText !== null
            ? await dispatchAssistantReply({
                input: currentInput,
                media: providerResult.responseMedia ?? [],
                response: finalResponseText,
                session: deliverySession,
                sharedPlan,
                turnId: currentUserTurn.turnId,
              })
            : resolveAssistantNoReplyDeliveryOutcome({
                precedingDeliveryOutcomes,
                session: deliverySession,
              })
        const reactionDeliveryResult = await deliverAssistantProviderReactions({
          currentInput,
          providerResult,
          replyDeliveryContexts,
          session: deliverySession,
          sharedPlan,
          turnId: currentUserTurn.turnId,
        })
        deliverySession = reactionDeliveryResult.deliverySession
        const reactionDeliveryOutcomes =
          reactionDeliveryResult.reactionDeliveryOutcomes
        for (const reactionOutcome of reactionDeliveryOutcomes) {
          if (reactionOutcome.kind !== 'failed' || finalResponseText === null) {
            continue
          }
          await runAssistantTurnBestEffort(() =>
            recordAssistantDiagnosticEvent({
              vault: input.vault,
              component: 'assistant',
              kind: 'delivery.reaction.failed',
              level: 'error',
              message: reactionOutcome.error.message,
              code: reactionOutcome.error.code,
              sessionId: reactionOutcome.session.sessionId,
              turnId: currentUserTurn.turnId,
            }),
          )
        }
        const finalDeliveryOutcome =
          finalResponseText === null &&
          deliveryOutcome.kind === 'not-requested' &&
          reactionDeliveryOutcomes.length > 0
            ? reactionDeliveryOutcomes[reactionDeliveryOutcomes.length - 1]!
            : deliveryOutcome
        const finalResponseDisposition =
          finalResponseText === null && deliveryOutcome.kind === 'not-requested'
            ? 'none'
            : null
        const finalResponse = finalResponseText ?? ''

        await finalizeDeliveredAssistantTurn({
          firstContactGuidanceInjected:
            providerResult.onboardingGuidanceInjected,
          firstContactStateDocIds: sharedPlan.firstContactStateDocIds,
          outcome: finalDeliveryOutcome,
          response: finalResponse,
          turnId: currentUserTurn.turnId,
          vault: input.vault,
        })

        const result = normalizeAssistantAskResultForReturn({
          vault: redactAssistantDisplayPath(input.vault),
          status: 'completed',
          prompt: currentInput.prompt,
          response: finalResponse,
          ...(finalResponseDisposition === 'none'
            ? { responseDisposition: 'none' as const }
            : {}),
          media: finalDeliveryOutcome.media,
          session: finalDeliveryOutcome.session,
          delivery: finalDeliveryOutcome.kind === 'sent' ? finalDeliveryOutcome.delivery : null,
          deliveryDeferred: finalDeliveryOutcome.kind === 'queued',
          deliveryIntentId:
            finalDeliveryOutcome.kind === 'sent' ||
            finalDeliveryOutcome.kind === 'queued' ||
            finalDeliveryOutcome.kind === 'failed'
              ? finalDeliveryOutcome.intentId
              : null,
          deliveryError:
            finalDeliveryOutcome.kind === 'queued' || finalDeliveryOutcome.kind === 'failed'
              ? finalDeliveryOutcome.error
              : null,
        })
        turnInputController.complete(result)
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

async function clearAssistantSessionCodexResumeStateIfNeeded(input: {
  action: ReturnType<typeof resolveProviderResumeStateAction>
  session: AssistantSession
  vault: string
}): Promise<void> {
  if (input.action !== 'clear') {
    return
  }

  await clearAssistantSessionCodexResumeState({
    session: input.session,
    vault: input.vault,
  })
}

function resolveProviderResumeStateAction(input: {
  codexThreadHistoryUnsafe: boolean
  codexThreadId: string | null
  threadScope: AssistantCodexThreadScope
}): 'clear' | 'persist-from-provider-turn' | 'preserve-existing' {
  if (input.threadScope === 'isolated-thread') {
    return 'preserve-existing'
  }

  if (input.codexThreadHistoryUnsafe) {
    return 'clear'
  }

  return normalizeNullableString(input.codexThreadId)
    ? 'persist-from-provider-turn'
    : 'clear'
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
        'accepted active-turn input persisted for provider request',
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
        'Accepted active-turn input ids must be new for the current provider request.',
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
}): readonly AssistantAcceptedTurnInputItemInput[] {
  if (input.acceptedInput.acceptedInputs.length > 0) {
    return input.acceptedInput.acceptedInputs
  }

  throw new VaultCliError(
    'ASSISTANT_TURN_INPUT_MISSING_ACCEPTED_INPUTS',
    'Accepted active-turn input admissions must provide durable input ids.',
  )
}

function resolveAssistantReplyDeliveryContextForSegment(input: {
  contexts: readonly AssistantReplyDeliveryContext[]
  deliveryContextOrdinal?: number | null
}): {
  context: AssistantReplyDeliveryContext | null
  invalidDeliveryContextOrdinal: number | null
} {
  if (input.contexts.length === 0) {
    return {
      context: null,
      invalidDeliveryContextOrdinal: null,
    }
  }

  if (input.deliveryContextOrdinal === undefined || input.deliveryContextOrdinal === null) {
    return {
      context: input.contexts[0] ?? null,
      invalidDeliveryContextOrdinal: null,
    }
  }

  if (
    Number.isInteger(input.deliveryContextOrdinal) &&
    input.deliveryContextOrdinal >= 0 &&
    input.deliveryContextOrdinal < input.contexts.length
  ) {
    return {
      context: input.contexts[input.deliveryContextOrdinal] ?? null,
      invalidDeliveryContextOrdinal: null,
    }
  }

  return {
    context: null,
    invalidDeliveryContextOrdinal: input.deliveryContextOrdinal,
  }
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

function resolveAssistantProviderFinalResponseText(
  providerResult: ExecutedAssistantProviderTurnResult,
): string {
  const response = normalizeNullableString(providerResult.response)
  if (response) {
    return response
  }

  if ((providerResult.responseMedia ?? []).length > 0) {
    return ''
  }

  throw new VaultCliError(
    'ASSISTANT_PROVIDER_EMPTY_RESPONSE',
    'Assistant provider completed without a final response. Use finish_without_reply for an intentional no-reply turn.',
  )
}

function resolveAssistantProviderTranscriptText(input: {
  media?: readonly AssistantResponseMedia[] | null
  response: string | null
}): string | null {
  if (input.response === null) {
    return null
  }

  const response = normalizeNullableString(input.response)
  if (response !== null) {
    return response
  }

  const mediaTranscriptText = buildAssistantResponseMediaTranscriptText(
    input.media,
  )
  return mediaTranscriptText ?? input.response
}

function buildAssistantResponseMediaTranscriptText(
  media: readonly AssistantResponseMedia[] | null | undefined,
): string | null {
  const transcripts = (media ?? [])
    .map((item) =>
      item.kind === 'voice_memo'
        ? normalizeNullableString(item.transcript)
        : null,
    )
    .filter((text): text is string => text !== null)

  return transcripts.length > 0 ? transcripts.join('\n\n') : null
}

async function deliverAssistantProviderReactions(input: {
  currentInput: AssistantMessageInput
  providerResult: ExecutedAssistantProviderTurnResult
  replyDeliveryContexts: readonly AssistantReplyDeliveryContext[]
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
  turnId: string
}): Promise<{
  deliverySession: AssistantSession
  reactionDeliveryOutcomes: AssistantDeliveryOutcome[]
}> {
  let deliverySession = input.session
  const reactionDeliveryOutcomes: AssistantDeliveryOutcome[] = []

  for (const reaction of input.providerResult.reactions ?? []) {
    const resolvedDeliveryContext =
      resolveAssistantReplyDeliveryContextForSegment({
        contexts: input.replyDeliveryContexts,
        deliveryContextOrdinal: reaction.deliveryContextOrdinal,
      })
    if (resolvedDeliveryContext.invalidDeliveryContextOrdinal !== null) {
      const error = normalizeAssistantDeliveryError(
        new VaultCliError(
          'ASSISTANT_DELIVERY_CONTEXT_ORDINAL_INVALID',
          'Assistant reaction referenced an invalid delivery context ordinal.',
        ),
      )
      reactionDeliveryOutcomes.push({
        kind: 'failed',
        error,
        intentId: null,
        media: [],
        session: deliverySession,
      })
      continue
    }

    const reactionInput = applyAssistantReplyDeliveryContext({
      context: resolvedDeliveryContext.context,
      input: input.currentInput,
    })
    const reactionOutcome = await deliverAssistantReaction({
      deliveryContextOrdinal: reaction.deliveryContextOrdinal,
      input: reactionInput,
      reaction: reaction.reaction,
      session: deliverySession,
      sharedPlan: input.sharedPlan,
      turnId: input.turnId,
    })
    deliverySession = reactionOutcome.session
    reactionDeliveryOutcomes.push(reactionOutcome)
  }

  return {
    deliverySession,
    reactionDeliveryOutcomes,
  }
}

function resolveAssistantNoReplyDeliveryOutcome(input: {
  precedingDeliveryOutcomes: readonly AssistantDeliveryOutcome[]
  session: AssistantSession
}): AssistantDeliveryOutcome {
  const outcomes = input.precedingDeliveryOutcomes
  const failedOutcome = outcomes.find((outcome) => outcome.kind === 'failed')
  if (failedOutcome) {
    return failedOutcome
  }

  for (let index = outcomes.length - 1; index >= 0; index -= 1) {
    const outcome = outcomes[index]
    if (outcome && outcome.kind !== 'not-requested') {
      return outcome
    }
  }

  return {
    kind: 'not-requested',
    media: [],
    session: input.session,
  }
}

function buildActiveTurnInput(input: {
  acceptedInput: Extract<
    AssistantActiveTurnInputAdmissionResult,
    { kind: 'accepted' }
  >
  input: AssistantMessageInput
}): AssistantMessageInput {
  return {
    ...applyAssistantReplyDeliveryContextOverrides({
      input: input.input,
      overrides: input.acceptedInput,
    }),
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
