import {
  assistantAskResultSchema,
  type AssistantAskResult,
  type AssistantResponseMedia,
  type AssistantSession,
  type AssistantTurnTrigger,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  renderAssistantResponseCardTranscriptText,
  renderAssistantResponseCardText,
  type AssistantResponseCard,
} from '@murphai/operator-config/assistant-response-cards'
import {
  assistantBackendTargetToProviderConfigInput,
  createAssistantModelTarget,
  createDefaultLocalAssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import {
  CAPTURE_LOOKUP_INDEX_PATH,
  readStoredCaptureLookupIndex,
} from '@murphai/core'
import {
  type ResolvedAssistantSession,
  appendAssistantTranscriptEntries,
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
import {
  ASSISTANT_IMAGE_RESPONSE_TRANSCRIPT_MARKER,
  resolveAssistantGeneratedImageDelivery,
} from './response-media.js'
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
import { emitHostedAssistantTurnTimingTrace } from './hosted-turn-timing.js'
import {
  deliverAssistantPrecedingReplies,
  deliverAssistantReaction,
  deliverAssistantReply as dispatchAssistantReply,
  deliverAssistantProgressUpdate,
  finalizeAssistantTurnFromDeliveryOutcome as finalizeDeliveredAssistantTurn,
  resolveAssistantCurrentAudienceDeliveryFields,
  resolveAssistantHostedDeliveryIdempotency,
  type AssistantCurrentAudienceDeliveryFields,
  type AssistantPrecedingReplySegment,
} from './delivery-service.js'
import {
  applyAssistantReplyDeliveryContext,
  applyAssistantReplyDeliveryContextOverrides,
  pickAssistantReplyDeliveryContext,
  type AssistantReplyDeliveryContext,
} from './reply-delivery-context.js'
import {
  applyAssistantSessionCodexResumeStateAction,
  clearAssistantSessionCodexResumeState,
  persistAssistantNoReplyTranscriptMarkers,
  persistAssistantTurnAndSession as finalizeAssistantTurnArtifacts,
  resolveAssistantProviderResumeStateAction,
} from './turn-finalizer.js'
import {
  bindAssistantResumeStateToThreadCompatibility,
} from './codex-resume-binding.js'
import {
  readAssistantCodexResume,
} from './conversation-persistence.js'
import {
  appendAssistantTurnReceiptEvent,
  createAssistantTurnReceipt,
  finalizeAssistantTurnReceipt,
} from './turns.js'
import {
  mergeAssistantProviderConfigs,
  serializeAssistantProviderSessionOptions,
} from '@murphai/operator-config/assistant/provider-config'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  normalizeAssistantExecutionContext,
  resolveAssistantExecutionDefaultTarget,
  resolveAssistantExecutionOperatorDefaults,
  type AssistantHostedProgressDeliveryDependencies,
  type AssistantExecutionContext,
} from './execution-context.js'
import {
  executeCodexTurnWithRecovery,
  resolveAssistantCodexThreadScope,
} from './codex-turn-runner.js'
import {
  stampAssistantProviderStartCriticalPath,
} from './provider-start-critical-path.js'
import {
  readCodexThreadCompatibilityFingerprint,
  readCodexThreadRouteFingerprint,
} from './codex-thread-route.js'
import { resolveAssistantExecutionPlan } from './execution-plan.js'
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
  assistantDeliveryOutcomeSupersedesTypingIndicator,
  startAssistantChannelTypingIndicator,
  stopAssistantChannelTypingIndicator,
} from './channel-typing.js'
import {
  createAssistantProgressDelivery,
  resolveAssistantProductFeedbackAcceptedInputIds,
  shouldCreateAssistantProgressDelivery,
} from './turn-progress.js'
import {
  createAssistantHostedToolContext,
} from './hosted-tool-context.js'
import {
  resolveAssistantUserActionAcceptedInputIds,
} from '../assistant-codex/dynamic-tools/phone-calls.js'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import {
  requestAssistantVaultFileSend,
  resolveAssistantVaultFileSendTargetFingerprint,
} from './vault-file-send.js'
import {
  assertAssistantAcceptedTurnInputAssistantInputEventsExist,
  assertAssistantAcceptedTurnInputItemInputsAssistantInputEventsExist,
  type AssistantAcceptedTurnInputJournal,
  type AssistantAcceptedTurnInputItemInput,
  type AssistantAcceptedTurnInputTranscriptRef,
} from './active-turn-input-journal.js'
import {
  createAssistantActiveTurnNotActiveError,
  createAssistantActiveTurnInputController,
  steerAssistantActiveTurnInputWithStatus,
} from './active-turn-input-controller.js'
import {
  normalizeNullableString,
} from './shared.js'
import { readAssistantInputEvent } from './input-store.js'
import {
  resolveAssistantAcceptedMessageParticipant,
  resolveAssistantAcceptedMessageTarget,
  type AssistantAcceptedMessageTargetAuthorizer,
} from './message-target-selection.js'
import { resolveAssistantConversationScope } from './conversation-policy.js'
import {
  assistantChannelSupportsReplyBubbles,
  stripAssistantReplyBubbleDelimiters,
} from './reply-bubbles.js'
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
const PHONE_CALL_MANUAL_ACCEPTED_TURN_INPUT_ID_PREFIX = 'manual-phone-call:'

function resolveAssistantProgressDeliveryChannel(input: {
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
}): string | null {
  return normalizeNullableString(
    input.sharedPlan.conversationPolicy.audience.channel,
  )
    ?? normalizeNullableString(input.session.binding.channel)
}

function hasHostedTextDeliveryForChannel(input: {
  channel: string | null
  dependencies?: AssistantHostedProgressDeliveryDependencies | null
  includeEmail?: boolean
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
      return input.includeEmail === true &&
        typeof dependencies.sendEmail === 'function'
    default:
      return false
  }
}

function resolveAssistantPersistedReplyText(input: {
  messageInput: AssistantMessageInput
  rawResponse: string
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
}): string {
  const deliveryFields = resolveAssistantCurrentAudienceDeliveryFields({
    input: input.messageInput,
    session: input.session,
    sharedPlan: input.sharedPlan,
  })
  return assistantChannelSupportsReplyBubbles(deliveryFields.channel)
    ? stripAssistantReplyBubbleDelimiters(input.rawResponse)
    : input.rawResponse
}

function isHostedOptionalProgressDeliveryAvailable(input: {
  executionContext: AssistantExecutionContext | null
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
}): boolean {
  const hosted = input.executionContext?.hosted
  if (!hosted) {
    return true
  }

  return hasHostedTextDeliveryForChannel({
    channel: resolveAssistantProgressDeliveryChannel(input),
    dependencies: hosted.progressDeliveryDependencies,
  })
}

function isHostedCurrentAudienceReplyDeliveryAvailable(input: {
  executionContext: AssistantExecutionContext | null
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
}): boolean {
  const hosted = input.executionContext?.hosted
  if (!hosted) {
    return true
  }

  return hasHostedTextDeliveryForChannel({
    channel: resolveAssistantProgressDeliveryChannel(input),
    dependencies: hosted.progressDeliveryDependencies,
    includeEmail: true,
  })
}

function isHostedComputerToolTransportAvailable(input: {
  executionContext: AssistantExecutionContext | null
}): boolean {
  return typeof input.executionContext?.hosted?.providerFetch === 'function'
}

async function appendUserTranscriptEntryForTurn(input: {
  contentReceivedAt?: string | null
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
        ...(input.contentReceivedAt
          ? { contentReceivedAt: input.contentReceivedAt }
          : {}),
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
  const userContentReceivedAt =
    await resolveAcceptedInputContentReceivedAt({
      inputs: input.acceptedTurnInput?.initialInputs ?? [],
      vault: input.vault,
    })
  if (plan.persistUserPromptOnFailure) {
    const persisted = await appendUserTranscriptEntryForTurn({
      contentReceivedAt: userContentReceivedAt,
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
    userContentReceivedAt,
    userTranscriptRef,
    userPersisted,
  }
}

const UNVERIFIED_EXTERNAL_AUDIENCE_RESPONSE =
  "I couldn't verify whether this is a private or group conversation, so I can't safely use account context here yet. Please try again in your private chat with Murph."
const UNVERIFIED_EXTERNAL_SUPPORT_CONTACT_RESPONSE =
  `${UNVERIFIED_EXTERNAL_AUDIENCE_RESPONSE} You can email support@withmurph.ai.`

function resolveUnverifiedExternalAudienceResponse(prompt: string): string {
  const asksForSupportContact = /\bsupport\b/iu.test(prompt)
    && /\b(?:address|contact|e-?mail|reach)\b/iu.test(prompt)
    && (/[?]/u.test(prompt)
      || /\b(?:give|how|need|please|send|share|tell|want|what|where)\b/iu.test(
        prompt,
      ))
  return asksForSupportContact
    ? UNVERIFIED_EXTERNAL_SUPPORT_CONTACT_RESPONSE
    : UNVERIFIED_EXTERNAL_AUDIENCE_RESPONSE
}

async function completeUnverifiedExternalAudienceTurn(input: {
  message: AssistantMessageInput
  plan: AssistantTurnSharedPlan
  response: string
  session: AssistantSession
  turnId: string
  userTurn: PersistedUserTurn
}): Promise<{
  outcome: AssistantDeliveryOutcome
  result: AssistantAskResult
}> {
  let turnCreatedAt = input.userTurn.turnCreatedAt
  if (!input.userTurn.userPersisted) {
    const persisted = await appendUserTranscriptEntryForTurn({
      contentReceivedAt: input.userTurn.userContentReceivedAt,
      detail: 'user prompt persisted before deterministic audience-safety reply',
      sessionId: input.session.sessionId,
      text: input.message.prompt,
      turnId: input.turnId,
      vault: input.message.vault,
    })
    turnCreatedAt = persisted.createdAt
  }

  await appendAssistantTranscriptEntries(
    input.message.vault,
    input.session.sessionId,
    [{
      createdAt: turnCreatedAt,
      kind: 'assistant',
      text: input.response,
    }],
  )

  const updatedAt = new Date().toISOString()
  const savedSession = await saveAssistantSession(input.message.vault, {
    ...input.session,
    lastTurnAt: updatedAt,
    turnCount: input.session.turnCount + 1,
    updatedAt,
  })
  const outcome = await dispatchAssistantReply({
    input: input.message,
    response: input.response,
    session: savedSession,
    sharedPlan: input.plan,
    turnId: input.turnId,
  })
  await finalizeDeliveredAssistantTurn({
    outcome,
    response: input.response,
    turnId: input.turnId,
    vault: input.message.vault,
  })

  return {
    outcome,
    result: normalizeAssistantAskResultForReturn({
      delivery: outcome.kind === 'sent' ? outcome.delivery : null,
      deliveryDeferred: outcome.kind === 'queued',
      deliveryError:
        outcome.kind === 'queued' || outcome.kind === 'failed'
          ? outcome.error
          : null,
      deliveryIntentId:
        outcome.kind === 'sent' || outcome.kind === 'queued' || outcome.kind === 'failed'
          ? outcome.intentId
          : null,
      media: outcome.media,
      prompt: input.message.prompt,
      response: input.response,
      session: outcome.session,
      status: 'completed',
      vault: redactAssistantDisplayPath(input.message.vault),
    }),
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
  const providerStartAtAssistantService =
    stampAssistantProviderStartCriticalPath(
      input.providerStartCriticalPath,
      'assistantServiceStartedAtMonotonicMs',
    )
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

  const executionContext = normalizeAssistantExecutionContext(input.executionContext)
  const boundaryDefaultTarget = resolveAssistantExecutionDefaultTarget({
    executionContext,
    fallbackTarget: createDefaultLocalAssistantModelTarget(),
  })
  const defaults = resolveAssistantExecutionOperatorDefaults({
    defaults: await resolveAssistantOperatorDefaults(),
    executionContext,
  })
  const providerStartAtTurnLockWait =
    stampAssistantProviderStartCriticalPath(
      providerStartAtAssistantService,
      'assistantTurnLockWaitStartedAtMonotonicMs',
    )
  const turnLockWaitStartedAt = Date.now()
  const runLockedTurn = () => withAssistantTurnLock({
    abortSignal: input.abortSignal,
    vault: input.vault,
    run: async () => {
      const providerStartAtTurnLockAcquired =
        stampAssistantProviderStartCriticalPath(
          providerStartAtTurnLockWait,
          'assistantTurnLockAcquiredAtMonotonicMs',
        )
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

      let responseText: string | null = null
      let userTurn: PersistedUserTurn | null = null
      const typingIndicatorDeliveryFields =
        input.deliverResponse === true
          ? resolveAssistantCurrentAudienceDeliveryFields({
              input,
              session: resolved.session,
              sharedPlan,
            })
          : null
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
      const progressDeliveredSessionRef: { value: AssistantSession | null } = {
        value: null,
      }
      let currentSession = resolved.session
      let deliverySupersededTypingIndicator = false

      try {
        if (
          resolveAssistantConversationScope(
            sharedPlan.conversationPolicy.audience,
          ) === 'unverified-external'
        ) {
          userTurn = await persistUserTurn(
            input,
            resolved,
            sharedPlan,
            receipt.turnId,
          )
          responseText = resolveUnverifiedExternalAudienceResponse(input.prompt)
          const completed = await completeUnverifiedExternalAudienceTurn({
            message: input,
            plan: sharedPlan,
            response: responseText,
            session: resolved.session,
            turnId: receipt.turnId,
            userTurn,
          })
          deliverySupersededTypingIndicator =
            assistantDeliveryOutcomeSupersedesTypingIndicator(
              completed.outcome.kind,
            )
          return completed.result
        }

        const runtimeState = createAssistantRuntimeStateService(input.vault)
        const preProviderSteerAcceptedInputJournals = new Map<
          string,
          AssistantAcceptedTurnInputJournal
        >()
        const turnInputController = createAssistantActiveTurnInputController({
          acceptedInputValidator: async ({ acceptedInputs }) => {
            await assertAssistantAcceptedTurnInputItemInputsAssistantInputEventsExist({
              inputs: acceptedInputs,
              vault: input.vault,
            })
          },
          admissionHook: input.activeTurnInput,
          beforeProviderSteer: input.beforeProviderAcceptedInputs
            ? async (event) => {
                const acceptedInputJournal =
                  await runtimeState.turns.acceptedInputs.append({
                    inputs: event.acceptedInputs,
                    sessionId: resolved.session.sessionId,
                    turnId: receipt.turnId,
                  })
                await assertAssistantAcceptedTurnInputAssistantInputEventsExist({
                  journal: acceptedInputJournal,
                  vault: input.vault,
                })
                const releaseProviderAcceptedInputs =
                  await input.beforeProviderAcceptedInputs?.({
                    ...event,
                    turnId: receipt.turnId,
                  })
                preProviderSteerAcceptedInputJournals.set(
                  JSON.stringify(event.acceptedInputs.map((item) => item.id)),
                  acceptedInputJournal,
                )
                return releaseProviderAcceptedInputs
              }
            : undefined,
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
        const initialAcceptedTurnInputItems = resolveInitialAcceptedTurnInputItems({
          input,
          resolved,
          userTurn: currentUserTurn,
        })
        const initialUserPromptInputId =
          resolveInitialUserPromptAcceptedTurnInputId({
            input,
            userTurn: currentUserTurn,
          })
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
        const threadScope = resolveAssistantCodexThreadScope({})
        const turnTimingStartedAt = lockAcquiredAt
        let currentInput = input
        const currentAudienceReplyDeliveryAvailable =
          isHostedCurrentAudienceReplyDeliveryAvailable({
            executionContext,
            session: resolved.session,
            sharedPlan,
          })
        const hostedOptionalProgressDeliveryAvailable =
          isHostedOptionalProgressDeliveryAvailable({
            executionContext,
            session: resolved.session,
            sharedPlan,
          })
        const hostedComputerToolsAvailable =
          input.deliverResponse === true &&
          isHostedComputerToolTransportAvailable({
            executionContext,
          }) && currentAudienceReplyDeliveryAvailable
        const hostedExecutionContext = executionContext?.hosted ?? null
        let acceptedInputIdsForProviderRequest: readonly string[] =
          initialAcceptedInputJournal.inputIds
        let acceptedInputItemsForProviderRequest: readonly AssistantAcceptedTurnInputItemInput[] =
          initialAcceptedInputJournal.inputs
        let providerRequestAcceptedInputIds: readonly string[] =
          initialAcceptedInputJournal.inputIds
        let beforeHostedToolExecution = async (
          _throughDeliveryContextOrdinal: number,
        ): Promise<void> => {}
        const refreshTypingIndicatorAfterProgress = () => {
          void runAssistantTurnBestEffort(async () => {
            await typingIndicator?.refreshAfterMessage?.()
          })
        }
        const progressDelivery =
          shouldCreateAssistantProgressDelivery(input) &&
          hostedOptionalProgressDeliveryAvailable
          ? createAssistantProgressDelivery({
              deliver: async (progressInput) => {
                const deliveryContextOrdinal =
                  progressInput.deliveryContextOrdinal ?? 0
                const { targetInputId, ...untargetedProgressInput } = progressInput
                if (targetInputId) {
                  await beforeHostedToolExecution(deliveryContextOrdinal)
                }
                const resolvedProgressInput = targetInputId
                  ? {
                      ...untargetedProgressInput,
                      input:
                        await applyAssistantAcceptedMessageTargetToDeliveryInput({
                          acceptedInputIds:
                            resolveAcceptedInputIdsThroughDeliveryContextOrdinal(
                              deliveryContextOrdinal,
                            ),
                          action: 'native-reply',
                          input: progressInput.input,
                          session: progressInput.session,
                          sharedPlan,
                          targetInputId,
                        }),
                    }
                  : untargetedProgressInput
                const hosted = hostedExecutionContext
                if (hosted) {
                  const dependencies = hosted.progressDeliveryDependencies
                  const progressChannel =
                    resolveAssistantProgressDeliveryChannel(resolvedProgressInput)
                  if (
                    !dependencies ||
                    !hasHostedTextDeliveryForChannel({
                      channel: progressChannel,
                      dependencies,
                    })
                  ) {
                    throw new VaultCliError(
                      'ASSISTANT_PROGRESS_CHANNEL_UNSUPPORTED',
                      'Hosted model progress updates are unavailable for the current delivery channel.',
                    )
                  }
                  const sendLinq =
                    progressChannel === 'linq'
                      ? dependencies.sendLinq
                      : undefined
                  if (sendLinq) {
                    await beforeHostedToolExecution(
                      deliveryContextOrdinal,
                    )
                  }
                  const progressDependencies = sendLinq
                    ? {
                        ...dependencies,
                        sendLinq: (
                          sendInput: Parameters<typeof sendLinq>[0],
                        ) =>
                          sendLinq({
                            ...sendInput,
                            acceptedAssistantInputIds: [
                              ...providerRequestAcceptedInputIds,
                            ],
                          }),
                      }
                    : dependencies
                  const result = await deliverAssistantProgressUpdate({
                    ...resolvedProgressInput,
                    dependencies: progressDependencies,
                  })
                  refreshTypingIndicatorAfterProgress()
                  return result
                }

                const result = await deliverAssistantProgressUpdate({
                  ...resolvedProgressInput,
                })
                refreshTypingIndicatorAfterProgress()
                return result
              },
              getDeliveryContext: () => ({
                messageInput: currentInput,
                session: currentSession,
              }),
              messageInput: input,
              onDeliveredSession: (session) => {
                progressDeliveredSessionRef.value = session
                currentSession = applyAssistantProgressDeliveredSession({
                  progressDeliveredSession: session,
                  session: currentSession,
                })
              },
              session: resolved.session,
              sharedPlan,
              turnId: currentUserTurn.turnId,
            })
          : null
        const currentDeliveryFields = resolveAssistantCurrentAudienceDeliveryFields({
          input: currentInput,
          session: currentSession,
          sharedPlan,
        })
        const vaultFileSendTargetFingerprint =
          resolveAssistantVaultFileSendTargetFingerprint(currentDeliveryFields)
        // Captured once so the narrowing survives into the sendVaultFile
        // closure below. Without this local, TS widens the property access
        // back to `… | null | undefined` inside the async closure body.
        const actionApprovalPort = hostedExecutionContext?.actionApprovalPort ?? null
        const vaultFileSendAvailable =
          input.deliverResponse === true
          && currentAudienceReplyDeliveryAvailable
          && actionApprovalPort != null
          && currentDeliveryFields.channel?.trim().toLowerCase() === 'linq'
          && vaultFileSendTargetFingerprint !== null
        const pendingVaultFilesAvailable =
          input.deliverResponse === true
          && currentAudienceReplyDeliveryAvailable
          && currentDeliveryFields.channel?.trim().toLowerCase() === 'linq'
        const hostedToolContext = hostedExecutionContext
          ? createAssistantHostedToolContext({
              computerToolsAvailable: hostedComputerToolsAvailable,
              beforeToolExecution: (deliveryContextOrdinal) =>
                beforeHostedToolExecution(deliveryContextOrdinal),
              executionContext: hostedExecutionContext,
              getDeliveryContext: () => ({
                messageInput: currentInput,
                session: currentSession,
              }),
              getConversationScope: () =>
                resolveAssistantConversationScope(
                  sharedPlan.conversationPolicy.audience,
                ),
              getUserActionAcceptedInputIds: () =>
                resolveAssistantUserActionAcceptedInputIds({
                  acceptedInputItems: acceptedInputItemsForProviderRequest,
                  turnTrigger: currentInput.turnTrigger ?? null,
                }),
              getProductFeedbackAcceptedInputIds: () =>
                resolveAssistantProductFeedbackAcceptedInputIds(
                  acceptedInputItemsForProviderRequest,
                ),
              messageInput: input,
              pendingVaultFilesAvailable,
              verifyGeneratedImageDelivery: async (candidate) => {
                try {
                  const imageRef = candidate.imageRef
                  const knownFromCurrentCompletion =
                    currentInput.hostedImageCompletionEffectRestriction
                      ?.exactMedia?.some((media) => media.ref === imageRef) === true
                  const [intents, transcriptEntries, captureLookupIndex] =
                    await Promise.all([
                      runtimeState.outbox.listIntents(),
                      runtimeState.transcripts.list(currentSession.sessionId),
                      (async () => {
                        await hostedExecutionContext
                          ?.materializeWorkspaceArtifacts?.([
                            CAPTURE_LOOKUP_INDEX_PATH,
                          ])
                        return await readStoredCaptureLookupIndex({
                          vaultRoot: input.vault,
                        })
                      })(),
                    ])
                  return resolveAssistantGeneratedImageDelivery({
                    currentMedia: {
                      contentType: candidate.contentType,
                      sha256: candidate.sha256,
                      sizeBytes: candidate.sizeBytes,
                    },
                    generatedImageOriginKnown:
                      knownFromCurrentCompletion ||
                      Object.values(captureLookupIndex.entries).some(
                        (entry) => entry.attachmentRef === imageRef,
                      ),
                    imageRef,
                    intents,
                    sessionId: currentSession.sessionId,
                    transcriptEntries,
                  })
                } catch {
                  return false
                }
              },
              route,
              ...(vaultFileSendAvailable && actionApprovalPort
                ? {
                    sendVaultFile: async (
                      ref: string,
                      toolCallId?: string | null,
                      retireExportPackIds?: readonly string[],
                    ) => {
                      const deliveryFields = resolveAssistantCurrentAudienceDeliveryFields({
                        input: currentInput,
                        session: currentSession,
                        sharedPlan,
                      })
                      if (deliveryFields.channel?.trim().toLowerCase() !== 'linq') {
                        throw new VaultCliError(
                          'ASSISTANT_VAULT_FILE_CHANNEL_UNSUPPORTED',
                          'Vault files can only be sent to the current iMessage conversation.',
                        )
                      }
                      if (!resolveAssistantVaultFileSendTargetFingerprint(deliveryFields)) {
                        throw new VaultCliError(
                          'ASSISTANT_VAULT_FILE_TARGET_UNAVAILABLE',
                          'Secure vault-file approval requires a concrete destination.',
                        )
                      }
                      const hostedDelivery = resolveAssistantHostedDeliveryIdempotency({
                        audience: sharedPlan.conversationPolicy.audience,
                        channel: deliveryFields.channel,
                        deliveryFields,
                        input: currentInput,
                        session: currentSession,
                      })
                      const result = await requestAssistantVaultFileSend({
                        actionApprovalPort,
                        actorId: deliveryFields.actorId,
                        answeredMailboxItemIds: currentInput.answeredMailboxItemIds ?? [],
                        bindingDelivery: deliveryFields.bindingDelivery,
                        channel: deliveryFields.channel,
                        deliverySource: deliveryFields.deliverySource,
                        deliveryTransportIdempotent:
                          hostedDelivery.deliveryTransportIdempotent,
                        explicitTarget: deliveryFields.explicitTarget,
                        identityId: deliveryFields.identityId,
                        ref,
                        retireExportPackIds,
                        replyToMessageId: deliveryFields.replyToMessageId,
                        sessionId: currentSession.sessionId,
                        threadId: deliveryFields.threadId,
                        threadIsDirect: deliveryFields.threadIsDirect,
                        toolCallId: toolCallId ?? null,
                        turnId: currentUserTurn.turnId,
                        turnTrigger: currentInput.turnTrigger ?? null,
                        vault: currentInput.vault,
                      })
                      if (result.status === 'pending') {
                        return {
                          approvalUrl: result.approvalUrl,
                          filename: result.filename,
                          status: 'pending',
                        }
                      }
                      if (result.status === 'approved') {
                        return {
                          filename: result.filename,
                          status: 'approved',
                        }
                      }
                      return result.status === 'denied'
                        ? {
                            filename: result.filename,
                            status: 'denied',
                          }
                        : {
                            filename: result.filename,
                            status: 'expired',
                          }
                    },
                  }
                : {}),
              session: resolved.session,
            })
          : null
        let providerResult: ExecutedAssistantProviderTurnResult | null = null
        let userPromptPersistedToTranscript = currentUserTurn.userPersisted
        const providerRequestOrdinal = 0
        const persistInitialUserPromptToTranscriptIfNeeded = async (persistInput: {
          detail: string
          prompt: string
          vault: string
        }) => {
          if (userPromptPersistedToTranscript) {
            return
          }
          const persisted = await appendUserTranscriptEntryForTurn({
            contentReceivedAt: currentUserTurn.userContentReceivedAt,
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
          const preProviderSteerJournalKey = JSON.stringify(
            acceptedInputItems.map((item) => item.id),
          )
          const preProviderSteerJournal =
            preProviderSteerAcceptedInputJournals.get(
              preProviderSteerJournalKey,
            )
          if (!preProviderSteerJournal) {
            assertAcceptedActiveTurnInputItemsAreNew({
              acceptedInputIds: acceptanceInput.providerRequestAcceptedInputIds,
              inputs: acceptedInputItems,
            })
          }
          let acceptedInputJournal =
            preProviderSteerJournal ??
            await runtimeState.turns.acceptedInputs.append({
              inputs: acceptedInputItems,
              sessionId: resolved.session.sessionId,
              turnId: currentUserTurn.turnId,
            })
          preProviderSteerAcceptedInputJournals.delete(
            preProviderSteerJournalKey,
          )
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
          acceptedInputItemsForProviderRequest = acceptedInputJournal.inputs
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
        function resolveAcceptedInputIdsThroughDeliveryContextOrdinal(
          deliveryContextOrdinal: number,
        ): readonly string[] {
          if (
            deliveryContextOrdinal >=
              acceptedInputIdsByDeliveryContextOrdinal.length
          ) {
            return [...acceptedInputIdsForProviderRequest]
          }
          return [
            ...new Set(
              acceptedInputIdsByDeliveryContextOrdinal
                .slice(0, deliveryContextOrdinal + 1)
                .flat(),
            ),
          ]
        }
        const authorizeAcceptedMessageTarget: AssistantAcceptedMessageTargetAuthorizer =
          async (authorizationInput) => {
            const acceptedInputIds =
              authorizationInput.action === 'participant-effect'
                ? resolveAcceptedInputIdsThroughDeliveryContextOrdinal(
                    authorizationInput.deliveryContextOrdinal,
                  )
                : acceptedInputIdsByDeliveryContextOrdinal[
                    authorizationInput.deliveryContextOrdinal
                  ]
            const deliveryContext =
              replyDeliveryContexts[authorizationInput.deliveryContextOrdinal]
            if (!acceptedInputIds || !deliveryContext) {
              return null
            }
            try {
              if (authorizationInput.action === 'participant-effect') {
                return await resolveAssistantAcceptedMessageParticipant({
                  acceptedInputIds,
                  messageRef: authorizationInput.messageRef,
                  route: resolveAssistantCurrentAudienceDeliveryFields({
                    input: applyAssistantReplyDeliveryContext({
                      context: deliveryContext,
                      input: currentInput,
                    }),
                    session: currentSession,
                    sharedPlan,
                  }),
                  vault: currentInput.vault,
                })
              }
              const target = await resolveAssistantAcceptedMessageTarget({
                acceptedInputIds,
                action: authorizationInput.action,
                messageRef: authorizationInput.messageRef,
                route: resolveAssistantCurrentAudienceDeliveryFields({
                  input: applyAssistantReplyDeliveryContext({
                    context: deliveryContext,
                    input: currentInput,
                  }),
                  session: currentSession,
                  sharedPlan,
                }),
                vault: currentInput.vault,
              })
              return { targetInputId: target.targetInputId }
            } catch (error) {
              if (
                error instanceof VaultCliError &&
                error.code === 'ASSISTANT_MESSAGE_TARGET_UNAVAILABLE'
              ) {
                return null
              }
              throw error
            }
          }
        // Cumulative through the ordinal: the no-reply hook and participant
        // effects may reference any input already admitted into the provider
        // turn. Native replies and reactions remain exact to one ordinal.
        const admissionMs = elapsedSince(admissionStartedAt)
        const providerStartAtPreProviderSetupDone =
          stampAssistantProviderStartCriticalPath(
            providerStartAtTurnLockAcquired,
            'preProviderSetupDoneAtMonotonicMs',
          )
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
        let providerRequestContinuation:
          ExecutedAssistantProviderTurnResult['codexContinuation'] | null = null
        providerRequestAcceptedInputIds = acceptedInputIdsForProviderRequest
        let providerRequestAcceptedInputItems: readonly AssistantAcceptedTurnInputItemInput[] =
          acceptedInputItemsForProviderRequest
        let providerRequestStartedAtMs: number | null = null
        let providerResultReturnedAt: number | null = null
        const emitTurnTiming = (timingInput: Parameters<
          typeof emitHostedAssistantTurnTimingTrace
        >[0]) => {
          emitHostedAssistantTurnTimingTrace({
            executionContext,
            onTraceEvent: currentInput.onTraceEvent ?? null,
            ...timingInput,
          })
        }
        let liveSteeredActiveTurnInputDrainTail: Promise<void> =
          Promise.resolve()
        const drainLiveSteeredActiveTurnInputs = (drainInput: {
          continuation:
            ExecutedAssistantProviderTurnResult['codexContinuation'] | null
          sessionId: string
          throughDeliveryContextOrdinal?: number | null
        }) => {
          const drain = liveSteeredActiveTurnInputDrainTail.then(async () => {
            while (true) {
              if (
                typeof drainInput.throughDeliveryContextOrdinal === 'number' &&
                replyDeliveryContexts.length >
                  drainInput.throughDeliveryContextOrdinal
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
              ] = accepted.acceptedInputItems.map((item) => item.id)
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
                providerRequestAcceptedInputItems =
                  providerRequestJournal?.inputs ??
                  accepted.acceptedInputJournal.inputs
              } else {
                providerRequestAcceptedInputIds =
                  accepted.acceptedInputJournal.inputIds
                providerRequestAcceptedInputItems =
                  accepted.acceptedInputJournal.inputs
              }
              acceptedInputIdsForProviderRequest =
                providerRequestAcceptedInputIds
              acceptedInputItemsForProviderRequest =
                providerRequestAcceptedInputItems
              turnInputController.commitLiveSteeredLocalAdmission(activeTurnInput)
            }
          })
          liveSteeredActiveTurnInputDrainTail = drain.catch(() => undefined)
          return drain
        }
        beforeHostedToolExecution = async (throughDeliveryContextOrdinal) => {
          await drainLiveSteeredActiveTurnInputs({
            continuation: providerRequestContinuation,
            sessionId: currentSession.sessionId,
            throughDeliveryContextOrdinal,
          })
        }
        const providerOutcome = await executeCodexTurnWithRecovery({
          acceptedInputItems: providerRequestAcceptedInputItems,
          activeTurnSteering: turnInputController,
          authorizeAcceptedMessageTarget,
          input: currentInput,
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
            const acceptedInputIds =
              resolveAcceptedInputIdsThroughDeliveryContextOrdinal(
                event.deliveryContextOrdinal,
              )
            await currentInput.onFinishWithoutReplyAccepted?.({
              acceptedInputIds,
              deliveryContextOrdinal: event.deliveryContextOrdinal,
              messageReactionPending: event.messageReactionPending,
            })
          },
          onFinishWithoutReplyRecorded: async (event) => {
            await persistAssistantNoReplyTranscriptMarkers({
              deliveryContextOrdinals: [event.deliveryContextOrdinal],
              sessionId: currentSession.sessionId,
              turnCreatedAt: currentUserTurn.turnCreatedAt,
              turnId: currentUserTurn.turnId,
              vault: input.vault,
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
            providerRequestAcceptedInputItems =
              providerRequestJournal?.inputs ?? acceptedInputItemsForProviderRequest
            acceptedInputIdsForProviderRequest = providerRequestAcceptedInputIds
            acceptedInputItemsForProviderRequest = providerRequestAcceptedInputItems
            return await input.beforeProviderAcceptedInputs?.({
              acceptedInputs: providerRequestAcceptedInputItems,
              turnId: currentUserTurn.turnId,
            })
          },
          onProviderRequestStarted: (event) => {
            const startedAtMs = Date.parse(event.startedAt)
            if (Number.isFinite(startedAtMs)) {
              providerRequestStartedAtMs = startedAtMs
            }
            if (!currentInput.onProviderRequestStarted) {
              return
            }
            return currentInput.onProviderRequestStarted({
              ...event,
              acceptedInputIds: providerRequestAcceptedInputIds,
              admissionMs,
              preProviderSetupMs,
              promptBuildMs,
              providerRequestOrdinal:
                event.providerRequestOrdinal ?? providerRequestOrdinal,
              sessionResolveMs,
              turnLockWaitMs,
            })
          },
          route,
          plan: sharedPlan,
          profile: {
            threadScope,
          },
          providerRequestOrdinal,
          ...(providerStartAtPreProviderSetupDone
            ? {
                providerStartCriticalPath:
                  providerStartAtPreProviderSetupDone,
              }
            : {}),
          resolvedSession: currentSession,
          turnCreatedAt: currentUserTurn.turnCreatedAt,
          progressDelivery,
          hostedToolContext,
          turnId: currentUserTurn.turnId,
        })
        providerResultReturnedAt = Date.now()
        emitTurnTiming({
          elapsedMs: elapsedSince(turnTimingStartedAt),
          providerOutcomeKind: providerOutcome.kind,
          providerRequestElapsedMs: providerRequestStartedAtMs === null
            ? null
            : Math.max(0, providerResultReturnedAt - providerRequestStartedAtMs),
          providerRequestOrdinal,
          sinceProviderResultMs: 0,
          stage: 'provider-result-returned',
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
            providerRequestAcceptedInputItems =
              providerRequestJournal?.inputs ?? acceptedInputItemsForProviderRequest
            acceptedInputIdsForProviderRequest = providerRequestAcceptedInputIds
            acceptedInputItemsForProviderRequest = providerRequestAcceptedInputItems
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
            providerRequestAcceptedInputItems =
              providerRequestJournal?.inputs ?? providerRequestAcceptedInputItems
            acceptedInputIdsForProviderRequest = providerRequestAcceptedInputIds
            acceptedInputItemsForProviderRequest = providerRequestAcceptedInputItems
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
          const acceptedNoReplyOrdinals =
            providerOutcome.acceptedNoReplyDeliveryContextOrdinals ?? []
          const latestAcceptedDeliveryContextOrdinal = replyDeliveryContexts.length - 1
          const recoverableNoReplyDeliveryContextOrdinal =
            latestAcceptedDeliveryContextOrdinal >= 0 &&
            acceptedNoReplyOrdinals.includes(latestAcceptedDeliveryContextOrdinal)
              ? latestAcceptedDeliveryContextOrdinal
              : null
          if (recoverableNoReplyDeliveryContextOrdinal === null) {
            await drainLiveSteeredActiveTurnInputs({
              continuation: providerOutcome.codexContinuation,
              sessionId: providerOutcome.session.sessionId,
            })
          }
          const usageRecordStartedAt = Date.now()
          await recordAssistantUsageEvent({
            executionContext,
            ...(providerRequestStartedAtMs === null
              ? {}
              : { occurredAt: new Date(providerRequestStartedAtMs).toISOString() }),
            providerRequestAcceptedInputIds,
            providerRequestOrdinal,
            providerRequestOutcome: providerOutcome.providerRequestOutcome,
            providerResult: failedProviderResult,
            turnId: currentUserTurn.turnId,
          })
          emitTurnTiming({
            elapsedMs: elapsedSince(turnTimingStartedAt),
            providerRequestOrdinal,
            sinceProviderResultMs: providerResultReturnedAt === null
              ? null
              : elapsedSince(providerResultReturnedAt),
            stage: 'usage-recorded',
            stepElapsedMs: elapsedSince(usageRecordStartedAt),
          })
          await recordAdditionalAssistantUsageEvents({
            additionalUsages: providerOutcome.additionalUsages,
            effectiveEnv: currentInput.turnEnvironment?.env ?? process.env,
            executionContext,
            providerRequestAcceptedInputIds,
            providerResult: failedProviderResult,
            turnId: currentUserTurn.turnId,
          })
          const failedProviderResumeStateAction =
            resolveAssistantProviderResumeStateAction({
              codexThreadId: providerOutcome.codexThreadId ?? null,
              threadScope,
            })
          if (progressDeliveredSessionRef.value) {
            currentSession = applyAssistantProgressDeliveredSession({
              progressDeliveredSession: progressDeliveredSessionRef.value,
              session: providerOutcome.session,
            })
          }
          currentSession = await applyAssistantSessionCodexResumeStateAction({
            action: failedProviderResumeStateAction,
            assistantContractFingerprint:
              providerOutcome.assistantContractFingerprint,
            codexRolloutRelativePath:
              providerOutcome.codexRolloutRelativePath,
            codexThreadId: providerOutcome.codexThreadId,
            routeFingerprint:
              readCodexThreadRouteFingerprint(providerOutcome.route),
            threadCompatibilityFingerprint:
              readCodexThreadCompatibilityFingerprint(providerOutcome.route),
            session: currentSession,
            vault: input.vault,
          })
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
            const failedNoReplySession = currentSession
            const failedNoReplyProviderResult: ExecutedAssistantProviderTurnResult = {
              acceptedNoReplyDeliveryContextOrdinals: acceptedNoReplyOrdinals,
              assistantContractFingerprint:
                providerOutcome.assistantContractFingerprint,
              attemptCount: providerOutcome.attemptCount,
              codexContinuation: providerOutcome.codexContinuation,
              codexRolloutRelativePath:
                providerOutcome.codexRolloutRelativePath,
              codexThreadId: providerOutcome.codexThreadId,
              finalAction: {
                kind: 'none',
              },
              provider: providerOutcome.route.provider,
              providerOptions: providerOutcome.route.providerOptions,
              rawEvents: providerOutcome.rawEvents,
              reactions: recoveredReactions,
              response: '',
              responseDeliveryContextOrdinal:
                recoverableNoReplyDeliveryContextOrdinal,
              responseMedia: [],
              responseCard: null,
              route: providerOutcome.route,
              session: failedNoReplySession,
              stderr: '',
              stdout: '',
              transcriptResponse: null,
              usage: providerOutcome.usage,
              usageAttribution: providerOutcome.usageAttribution,
              workingDirectory: sharedPlan.requestedWorkingDirectory,
            }
            const turnArtifactsStartedAt = Date.now()
            const session = await finalizeAssistantTurnArtifacts({
              assistantTranscriptText: null,
              input: currentInput,
              plan: sharedPlan,
              precedingAssistantTranscriptTexts: [],
              providerResult: failedNoReplyProviderResult,
              providerResumeStateAction: failedProviderResumeStateAction,
              persistUserPromptToTranscript: !userPromptPersistedToTranscript,
              session: failedNoReplySession,
              turnCreatedAt: currentUserTurn.turnCreatedAt,
              turnId: currentUserTurn.turnId,
              userContentReceivedAt: currentUserTurn.userContentReceivedAt,
            })
            currentSession = session
            emitTurnTiming({
              elapsedMs: elapsedSince(turnTimingStartedAt),
              finalReplySelected: false,
              providerRequestOrdinal,
              sinceProviderResultMs: providerResultReturnedAt === null
                ? null
                : elapsedSince(providerResultReturnedAt),
              stage: 'turn-artifacts-finalized',
              stepElapsedMs: elapsedSince(turnArtifactsStartedAt),
            })
            const replyDispatchStartedAt = Date.now()
            const {
              deliverySession,
              reactionDeliveryOutcomes,
            } = await deliverAssistantProviderReactions({
              acceptedInputIdsByDeliveryContextOrdinal,
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
            emitTurnTiming({
              deliveryAttempted: reactionDeliveryOutcomes.length > 0,
              deliveryIntentPresent: 'intentId' in finalDeliveryOutcome
                ? finalDeliveryOutcome.intentId !== null
                : false,
              deliveryOutcomeKind: finalDeliveryOutcome.kind,
              elapsedMs: elapsedSince(turnTimingStartedAt),
              finalReplySelected: false,
              providerRequestOrdinal,
              sinceProviderResultMs: providerResultReturnedAt === null
                ? null
                : elapsedSince(providerResultReturnedAt),
              stage: 'reply-dispatched',
              stepElapsedMs: elapsedSince(replyDispatchStartedAt),
            })
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
          providerRequestAcceptedInputItems =
            providerRequestJournal?.inputs ?? acceptedInputItemsForProviderRequest
          acceptedInputIdsForProviderRequest = providerRequestAcceptedInputIds
          acceptedInputItemsForProviderRequest = providerRequestAcceptedInputItems
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
          providerRequestAcceptedInputItems =
            providerRequestJournal?.inputs ?? providerRequestAcceptedInputItems
          acceptedInputIdsForProviderRequest = providerRequestAcceptedInputIds
          acceptedInputItemsForProviderRequest = providerRequestAcceptedInputItems
        }
        await drainLiveSteeredActiveTurnInputs({
          continuation: providerResult.codexContinuation,
          sessionId: providerResult.session.sessionId,
          throughDeliveryContextOrdinal:
            providerResult.responseDeliveryContextOrdinal,
        })
        currentSession = applyAssistantProgressDeliveredSession({
          progressDeliveredSession: progressDeliveredSessionRef.value,
          session: providerResult.session,
        })
        responseText = resolveAssistantPersistedReplyText({
          messageInput: currentInput,
          rawResponse: providerResult.response,
          session: currentSession,
          sharedPlan,
        })
        const usageRecordStartedAt = Date.now()
        await recordAssistantUsageEvent({
          executionContext,
          ...(providerRequestStartedAtMs === null
            ? {}
            : { occurredAt: new Date(providerRequestStartedAtMs).toISOString() }),
          providerRequestAcceptedInputIds,
          providerRequestOrdinal,
          providerResult,
          turnId: currentUserTurn.turnId,
        })
        emitTurnTiming({
          elapsedMs: elapsedSince(turnTimingStartedAt),
          providerRequestOrdinal,
          sinceProviderResultMs: providerResultReturnedAt === null
            ? null
            : elapsedSince(providerResultReturnedAt),
          stage: 'usage-recorded',
          stepElapsedMs: elapsedSince(usageRecordStartedAt),
        })
        await recordAdditionalAssistantUsageEvents({
          additionalUsages: providerResult.additionalUsages,
          effectiveEnv: currentInput.turnEnvironment?.env ?? process.env,
          executionContext,
          providerRequestAcceptedInputIds,
          providerResult,
          turnId: currentUserTurn.turnId,
        })

        const resolvedFinalReplyDeliveryContext =
          resolveAssistantReplyDeliveryContextForSegment({
            contexts: replyDeliveryContexts,
            deliveryContextOrdinal:
              providerResult.responseDeliveryContextOrdinal,
          })
        if (
          resolvedFinalReplyDeliveryContext.invalidDeliveryContextOrdinal !==
          null
        ) {
          throw new VaultCliError(
            'ASSISTANT_DELIVERY_CONTEXT_ORDINAL_INVALID',
            'Assistant final reply referenced an invalid delivery context ordinal.',
          )
        }
        const finalReplyInput = resolvedFinalReplyDeliveryContext.context
          ? applyAssistantReplyDeliveryContext({
              context: resolvedFinalReplyDeliveryContext.context,
              input: currentInput,
            })
          : currentInput

        turnInputController.close()
        await runtimeState.turns.acceptedInputs.updateAdmissionState({
          admissionState: 'commit-started',
          turnId: currentUserTurn.turnId,
        })
        // Every completed provider response is part of the ordinary turn,
        // regardless of audience. A later steer may add another response, but
        // it never erases text or media the provider already completed.
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
              ...(segment.transcriptResponse === undefined
                ? {}
                : { transcriptResponse: segment.transcriptResponse }),
              media: segment.media ?? [],
              ...(segment.targetInputId
                ? {
                    deliveryContextOrdinal: segment.deliveryContextOrdinal,
                    targetInputId: segment.targetInputId,
                  }
                : {}),
            })
        }
        const precedingResponses = precedingResponseSegments.map((segment) => {
          const response = resolveAssistantPersistedReplyText({
            messageInput: applyAssistantReplyDeliveryContext({
              context: segment.deliveryContext ?? null,
              input: currentInput,
            }),
            rawResponse: segment.transcriptResponse ?? segment.response,
            session: currentSession,
            sharedPlan,
          })
          return resolveAssistantProviderTranscriptText({
            media: segment.media,
            response,
          }) ?? response
        })
        const providerResumeStateAction =
          resolveAssistantProviderResumeStateAction({
            codexThreadId: providerResult.codexThreadId ?? null,
            threadScope,
          })
        if (providerResumeStateAction === 'clear') {
          currentSession = await clearAssistantSessionCodexResumeState({
            session: currentSession,
            vault: input.vault,
          })
        }
        const noReplySelected = providerResult.finalAction?.kind === 'none'
        const rawFinalResponseText = noReplySelected
          ? null
          : resolveAssistantProviderFinalResponseText(providerResult)
        const finalResponseText =
          rawFinalResponseText === null
            ? null
            : resolveAssistantPersistedReplyText({
                messageInput: finalReplyInput,
                rawResponse: rawFinalResponseText,
                session: currentSession,
                sharedPlan,
              })
        const rawTranscriptResponseText = noReplySelected
          ? null
          : providerResult.transcriptResponse ??
            (providerResult.responseCard
              ? renderAssistantResponseCardTranscriptText(providerResult.responseCard)
              : null)
        const transcriptResponseText =
          rawTranscriptResponseText === null
            ? null
            : resolveAssistantPersistedReplyText({
                messageInput: finalReplyInput,
                rawResponse: rawTranscriptResponseText,
                session: currentSession,
                sharedPlan,
              })
        const assistantTranscriptText = resolveAssistantProviderTranscriptText({
          media: providerResult.responseMedia,
          response: transcriptResponseText,
        })
        const turnArtifactsStartedAt = Date.now()
        const session = await finalizeAssistantTurnArtifacts({
          assistantTranscriptText,
          input: currentInput,
          plan: sharedPlan,
          precedingAssistantTranscriptTexts: precedingResponses,
          providerResult,
          providerResumeStateAction,
          persistUserPromptToTranscript: !userPromptPersistedToTranscript,
          session: currentSession,
          turnCreatedAt: currentUserTurn.turnCreatedAt,
          turnId: currentUserTurn.turnId,
          userContentReceivedAt: currentUserTurn.userContentReceivedAt,
        })
        currentSession = session
        emitTurnTiming({
          elapsedMs: elapsedSince(turnTimingStartedAt),
          finalReplySelected: finalResponseText !== null,
          providerRequestOrdinal,
          sinceProviderResultMs: providerResultReturnedAt === null
            ? null
            : elapsedSince(providerResultReturnedAt),
          stage: 'turn-artifacts-finalized',
          stepElapsedMs: elapsedSince(turnArtifactsStartedAt),
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
            resolveSegmentDeliveryInput: async (segmentInput) => {
              const targetInputId = segmentInput.segment.targetInputId
              const deliveryContextOrdinal =
                segmentInput.segment.deliveryContextOrdinal
              if (!targetInputId || deliveryContextOrdinal === undefined) {
                return segmentInput.input
              }
              return await applyAssistantAcceptedMessageTargetToDeliveryInput({
                acceptedInputIds:
                  acceptedInputIdsByDeliveryContextOrdinal[
                    deliveryContextOrdinal
                  ] ?? [],
                action: 'native-reply',
                input: segmentInput.input,
                session: segmentInput.session,
                sharedPlan,
                targetInputId,
              })
            },
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
        for (const [precedingOutcomeIndex, precedingOutcome] of
          precedingDeliveryOutcomes.entries()) {
          const precedingSegment =
            precedingResponseSegments[precedingOutcomeIndex] ?? null
          const precedingDeliveryFields = precedingSegment
            ? resolveAssistantCurrentAudienceDeliveryFields({
                input: applyAssistantReplyDeliveryContext({
                  context: precedingSegment.deliveryContext ?? null,
                  input: currentInput,
                }),
                session: precedingOutcome.session,
                sharedPlan,
              })
            : null
          deliverySupersededTypingIndicator =
            deliverySupersededTypingIndicator ||
            assistantDeliveryOutcomeSupersedesTypingIndicatorForTarget({
              deliveryFields: precedingDeliveryFields,
              kind: precedingOutcome.kind,
              typingIndicatorDeliveryFields,
            })
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
        const replyDispatchStartedAt = Date.now()
        let finalDeliveryInput = finalReplyInput
        let finalTargetResolutionError: ReturnType<
          typeof normalizeAssistantDeliveryError
        > | null = null
        if (finalResponseText !== null && providerResult.targetInputId) {
          try {
            finalDeliveryInput =
              await applyAssistantAcceptedMessageTargetToDeliveryInput({
                acceptedInputIds:
                  acceptedInputIdsByDeliveryContextOrdinal[
                    providerResult.responseDeliveryContextOrdinal
                  ] ?? [],
                action: 'native-reply',
                input: finalReplyInput,
                session: deliverySession,
                sharedPlan,
                targetInputId: providerResult.targetInputId,
              })
          } catch (error) {
            finalTargetResolutionError = normalizeAssistantDeliveryError(error)
          }
        }
        const deliveryOutcome =
          finalResponseText !== null
            ? finalTargetResolutionError
              ? {
                  kind: 'failed' as const,
                  error: finalTargetResolutionError,
                  intentId: null,
                  media: [...(providerResult.responseMedia ?? [])],
                  session: deliverySession,
                }
              : await dispatchAssistantReply({
                  input: finalDeliveryInput,
                  card: providerResult.responseCard ?? null,
                  media: providerResult.responseMedia ?? [],
                  response: rawFinalResponseText ?? '',
                  session: deliverySession,
                  sharedPlan,
                  turnId: currentUserTurn.turnId,
                })
            : resolveAssistantNoReplyDeliveryOutcome({
                precedingDeliveryOutcomes,
                session: deliverySession,
              })
        const replyIntentReadyAt = finalResponseText === null ? null : Date.now()
        const finalReplyDeliveryFields =
          finalResponseText !== null
            ? resolveAssistantCurrentAudienceDeliveryFields({
                input: finalDeliveryInput,
                session: deliveryOutcome.session,
                sharedPlan,
              })
            : null
        deliverySupersededTypingIndicator =
          deliverySupersededTypingIndicator ||
          assistantDeliveryOutcomeSupersedesTypingIndicatorForTarget({
            deliveryFields: finalReplyDeliveryFields,
            kind: finalResponseText !== null ? deliveryOutcome.kind : null,
            typingIndicatorDeliveryFields,
          })
        const reactionDeliveryResult = await deliverAssistantProviderReactions({
          acceptedInputIdsByDeliveryContextOrdinal,
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
        emitTurnTiming({
          deliveryAttempted:
            finalResponseText !== null || reactionDeliveryOutcomes.length > 0,
          deliveryIntentId: 'intentId' in finalDeliveryOutcome
            ? finalDeliveryOutcome.intentId
            : null,
          deliveryIntentPresent: 'intentId' in finalDeliveryOutcome
            ? finalDeliveryOutcome.intentId !== null
            : false,
          deliveryOutcomeKind: finalDeliveryOutcome.kind,
          elapsedMs: elapsedSince(turnTimingStartedAt),
          finalReplySelected: finalResponseText !== null,
          providerRequestElapsedMs:
            providerRequestStartedAtMs === null || providerResultReturnedAt === null
              ? null
              : Math.max(0, providerResultReturnedAt - providerRequestStartedAtMs),
          providerRequestOrdinal,
          sinceProviderResultMs:
            providerResultReturnedAt === null || replyIntentReadyAt === null
              ? null
              : Math.max(0, replyIntentReadyAt - providerResultReturnedAt),
          stage: 'reply-dispatched',
          stepElapsedMs: elapsedSince(replyDispatchStartedAt),
        })
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
        const productFeedbackCandidate =
          providerResult.productFeedbackCandidate ?? null
        const productFeedbackCandidateSink =
          executionContext?.hosted?.productFeedbackCandidateSink ?? null
        if (
          productFeedbackCandidate &&
          productFeedbackCandidateSink
        ) {
          try {
            productFeedbackCandidateSink.acceptProductFeedbackCandidate(
              productFeedbackCandidate,
            )
          } catch {
            // Optional feedback cannot affect the completed assistant turn.
          }
        }
        return result
      } catch (error) {
        activeTurnInputController?.fail(error)
        const normalizedError = normalizeAssistantDeliveryError(error)
        const failedAt = new Date().toISOString()
        const failedSession = applyAssistantProgressDeliveredSession({
          progressDeliveredSession: progressDeliveredSessionRef.value,
          session: currentSession,
        })

        if (failedSession !== currentSession) {
          await runAssistantTurnBestEffort(() =>
            saveAssistantSession(input.vault, failedSession),
          )
        }

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
        await stopAssistantChannelTypingIndicator(typingIndicator, {
          providerStop: !deliverySupersededTypingIndicator,
        })
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

  try {
    return await runLockedTurn()
  } finally {
    // The automation pass owns maintenance for auto-reply turns; every
    // independently-started turn keeps a post-turn owner so direct ask/chat/
    // assistantd use cannot grow runtime state (transcripts, event logs)
    // without bound. Post-turn keeps it off the foreground reply path.
    if (input.turnTrigger !== 'automation-auto-reply') {
      await runAssistantTurnBestEffort(() =>
        maybeRunAssistantRuntimeMaintenance({
          signal: input.abortSignal ?? null,
          vault: input.vault,
        })
      )
    }
  }
}

function assistantDeliveryOutcomeSupersedesTypingIndicatorForTarget(input: {
  deliveryFields: AssistantCurrentAudienceDeliveryFields | null
  kind: AssistantDeliveryOutcome['kind'] | null
  typingIndicatorDeliveryFields: AssistantCurrentAudienceDeliveryFields | null
}): boolean {
  if (!assistantDeliveryOutcomeSupersedesTypingIndicator(input.kind)) {
    return false
  }
  if (!input.typingIndicatorDeliveryFields || !input.deliveryFields) {
    return true
  }

  const typingChannel = normalizeAssistantDeliveryMatchChannel(
    input.typingIndicatorDeliveryFields.channel,
  )
  const deliveryChannel = normalizeAssistantDeliveryMatchChannel(
    input.deliveryFields.channel,
  )
  if (typingChannel && deliveryChannel && typingChannel !== deliveryChannel) {
    return false
  }

  const typingTarget = resolveAssistantVaultFileSendTargetFingerprint(
    input.typingIndicatorDeliveryFields,
  )
  const deliveryTarget = resolveAssistantVaultFileSendTargetFingerprint(
    input.deliveryFields,
  )
  if (!typingTarget || !deliveryTarget) {
    return true
  }

  return typingTarget === deliveryTarget
}

function normalizeAssistantDeliveryMatchChannel(
  value: string | null,
): string | null {
  const normalized = value?.trim().toLowerCase() ?? ''
  return normalized.length > 0 ? normalized : null
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

  const providerConfig = mergeAssistantProviderConfigs(
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
  const currentResumeState = bindAssistantResumeStateToThreadCompatibility({
    resumeState: readAssistantCodexResume(session.session),
    route: resolveAssistantExecutionPlan({
      defaults: null,
      sessionTarget: session.session.target,
    }).codexRoute,
  })

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

function applyAssistantProgressDeliveredSession(input: {
  progressDeliveredSession: AssistantSession | null
  session: AssistantSession
}): AssistantSession {
  if (
    input.progressDeliveredSession === null ||
    input.progressDeliveredSession.sessionId !== input.session.sessionId
  ) {
    return input.session
  }
  return {
    ...input.session,
    binding: input.progressDeliveredSession.binding,
    updatedAt: input.progressDeliveredSession.updatedAt,
  }
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
      acceptedAt: input.userTurn.turnCreatedAt,
      id: resolveDefaultInitialAcceptedTurnInputId({
        input: input.input,
        userTurn: input.userTurn,
      }),
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

function resolveInitialUserPromptAcceptedTurnInputId(input: {
  input: AssistantMessageInput
  userTurn: PersistedUserTurn
}): string | null {
  const initialInputs = input.input.acceptedTurnInput?.initialInputs ?? null
  return initialInputs && initialInputs.length > 0
    ? null
    : resolveDefaultInitialAcceptedTurnInputId(input)
}

function resolveDefaultInitialAcceptedTurnInputId(input: {
  input: AssistantMessageInput
  userTurn: PersistedUserTurn
}): string {
  return shouldUsePhoneCallManualAcceptedTurnInputId(input.input)
    ? `${PHONE_CALL_MANUAL_ACCEPTED_TURN_INPUT_ID_PREFIX}${input.userTurn.turnId}`
    : DEFAULT_INITIAL_ACCEPTED_TURN_INPUT_ID
}

function shouldUsePhoneCallManualAcceptedTurnInputId(
  input: AssistantMessageInput,
): boolean {
  return isManualAssistantTurnTrigger(input.turnTrigger) &&
    input.executionContext?.hosted?.phoneCalls != null
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
    const contentReceivedAt = await resolveAcceptedInputContentReceivedAt({
      inputs: input.acceptedInputItems.filter((item) =>
        plan.inputIds.includes(item.id)
      ),
      vault: input.vault,
    })
    const persisted = await appendUserTranscriptEntryForTurn({
      contentReceivedAt,
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

async function resolveAcceptedInputContentReceivedAt(input: {
  inputs: readonly AssistantAcceptedTurnInputItemInput[]
  vault: string
}): Promise<string | null> {
  const events = await Promise.all(
    input.inputs
      .filter((item) => item.source === 'assistant-input')
      .map((item) =>
        readAssistantInputEvent({
          inputId: item.id,
          vault: input.vault,
        })
      ),
  )
  let earliestMs: number | null = null
  for (const event of events) {
    if (!event) {
      continue
    }
    const receivedAtMs = Date.parse(event.receivedAt ?? event.occurredAt)
    if (
      Number.isFinite(receivedAtMs)
      && (earliestMs === null || receivedAtMs < earliestMs)
    ) {
      earliestMs = receivedAtMs
    }
  }
  return earliestMs === null ? null : new Date(earliestMs).toISOString()
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
  deliveryContextOrdinal: number
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
  const card = normalizeAssistantProviderResponseCard(providerResult)
  if (card) {
    return renderAssistantResponseCardText(card)
  }

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

function normalizeAssistantProviderResponseCard(
  providerResult: ExecutedAssistantProviderTurnResult,
): AssistantResponseCard | null {
  const card = providerResult.responseCard ?? null
  if (card !== null && (providerResult.responseMedia ?? []).length > 0) {
    throw new VaultCliError(
      'ASSISTANT_RESPONSE_CARD_MEDIA_CONFLICT',
      'A response card cannot be combined with response media.',
    )
  }
  return card
}

function resolveAssistantProviderTranscriptText(input: {
  media?: readonly AssistantResponseMedia[] | null
  response: string | null
}): string | null {
  if (input.response === null) {
    return null
  }

  const response = normalizeNullableString(input.response)
  const imagePresence = (input.media ?? []).some(
    (item) => item.kind === 'image',
  )
    ? ASSISTANT_IMAGE_RESPONSE_TRANSCRIPT_MARKER
    : null
  const mediaTranscriptText = buildAssistantResponseMediaTranscriptText(
    input.media,
  )
  return [imagePresence, response ?? mediaTranscriptText]
    .filter((text): text is string => text !== null)
    .join('\n\n') || input.response
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
  acceptedInputIdsByDeliveryContextOrdinal: readonly (readonly string[])[]
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

    const baseReactionInput = applyAssistantReplyDeliveryContext({
      context: resolvedDeliveryContext.context,
      input: input.currentInput,
    })
    let reactionInput: AssistantMessageInput
    try {
      reactionInput = await applyAssistantAcceptedMessageTargetToDeliveryInput({
        acceptedInputIds:
          input.acceptedInputIdsByDeliveryContextOrdinal[
            reaction.deliveryContextOrdinal
          ] ?? [],
        action: 'reaction',
        input: baseReactionInput,
        session: deliverySession,
        sharedPlan: input.sharedPlan,
        targetInputId: reaction.targetInputId,
      })
    } catch (error) {
      reactionDeliveryOutcomes.push({
        kind: 'failed',
        error: normalizeAssistantDeliveryError(error),
        intentId: null,
        media: [],
        session: deliverySession,
      })
      continue
    }
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

async function applyAssistantAcceptedMessageTargetToDeliveryInput(input: {
  acceptedInputIds: readonly string[]
  action: 'native-reply' | 'reaction'
  input: AssistantMessageInput
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
  targetInputId: string
}): Promise<AssistantMessageInput> {
  const target = await resolveAssistantAcceptedMessageTarget({
    acceptedInputIds: input.acceptedInputIds,
    action: input.action,
    messageRef: input.targetInputId,
    route: resolveAssistantCurrentAudienceDeliveryFields({
      input: input.input,
      session: input.session,
      sharedPlan: input.sharedPlan,
    }),
    vault: input.input.vault,
  })

  return applyAssistantReplyDeliveryContextOverrides({
    input: input.input,
    overrides: {
      ...(input.action === 'native-reply'
        ? { deliveryNativeReplyRequested: true as const }
        : target.deliveryMessageReactionsAvailable === true
          ? { deliveryMessageReactionsAvailable: true }
          : {}),
      deliveryReplyToMessageId: target.deliveryReplyToMessageId,
    },
  })
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
