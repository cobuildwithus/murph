import * as z from '@murphai/contracts/zod-runtime'
import type {
  AssistantResponseMedia,
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  parseAssistantSessionRecord,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  createHostedExecutionPrivateAssistantAskCompletionDeliveryKey,
} from '@murphai/hosted-execution/assistant-identifiers'
import type {
  HostedRuntimeGroupEmailEffectResponse,
} from '@murphai/hosted-execution/runtime-control'
import type { AutomationScheduleKind } from '@murphai/contracts'
import { createDefaultLocalAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { resolveAssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import {
  renderAssistantResponseCardText,
  type AssistantResponseCard,
} from '@murphai/operator-config/assistant-response-cards'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  shouldSkipAutomationOccurrenceForAvailability,
  stripAutomationAvailabilityConflictEvidenceForProvider,
} from '@murphai/core'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import { normalizeAssistantExecutionContext } from './execution-context.js'
import { resolveAssistantExecutionDefaultTarget } from './execution-context.js'
import { resolveAssistantExecutionOperatorDefaults } from './execution-context.js'
import { resolveAssistantSessionForMessage } from './session-resolution.js'
import { resolveAssistantSessionTarget } from './session-resolution.js'
import { resolveAssistantTurnSharedPlan } from './turn-plan.js'
import { resolveAssistantConversationScope } from './conversation-policy.js'
import {
  executeCodexTurnWithRecovery,
  type AssistantCodexTurnThreadScopeProfile,
} from './codex-turn-runner.js'
import { normalizeCodexEvent } from '../assistant-codex-events.js'
import {
  readCodexThreadCompatibilityFingerprint,
  readCodexThreadRouteFingerprint,
  type CodexThreadIdentity,
} from './codex-thread-route.js'
import {
  recordAdditionalAssistantUsageEvents,
  recordAssistantUsageEvent,
} from './service-usage.js'
import {
  applyAssistantSessionCodexResumeStateAction,
  persistAssistantTurnAndSession,
  resolveAssistantProviderResumeStateAction,
  type AssistantProviderResumeStateAction,
} from './turn-finalizer.js'
import { resolveAssistantTurnRoute } from './service-turn-routes.js'
import { createAssistantTurnId } from './turns.js'
import {
  normalizeAssistantDeliverySubject,
  selectedAssistantEmailDeliveryIsThreadReply,
} from './channel-adapters.js'
import { withAssistantTurnLock } from './turn-lock.js'
import {
  buildAssistantMaintenanceConversationEvidence,
  type AssistantMaintenanceProfile,
} from './maintenance-evidence.js'
import type {
  AssistantDeliveryOutcome,
  AssistantMessageInput,
  AssistantSessionResolutionFields,
  ResolvedAssistantSession,
} from './service-contracts.js'
import {
  dropUnsupportedAssistantResponseMediaForChannel,
  finalizeAssistantTurnFromDeliveryOutcome,
  resolveAssistantCurrentAudienceDeliveryFields,
  resolveAssistantHostedDeliveryIdempotency,
} from './delivery-service.js'
import { normalizeAssistantResponseMediaList } from './response-media.js'
import {
  hasAssistantSeenFirstContact,
  markAssistantFirstContactSeen,
  resolveAssistantFirstContactStateDocIds,
} from './first-contact.js'
import {
  emitHostedAssistantContextSessionResolvedTrace,
} from './hosted-context-diagnostics.js'
import { createAssistantHostedToolContext } from './hosted-tool-context.js'
import {
  assistantDeliveryOutcomeSupersedesTypingIndicator,
  startAssistantChannelTypingIndicator,
  stopAssistantChannelTypingIndicator,
} from './channel-typing.js'
import {
  markAssistantOutboxIntentMirrorTerminalById,
  normalizeAssistantDeliveryError,
} from './outbox.js'
import { createAssistantBinding } from './bindings.js'
import {
  createAssistantSessionId,
  resolveAssistantStatePaths,
} from './store/paths.js'
import {
  normalizeNullableString,
  normalizeRequiredText,
  warnAssistantBestEffortFailure,
} from './shared.js'
import {
  MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
} from './onboarding-goal-checkin-automation.js'

const assistantNotificationSkipDecisionSchema = z
  .object({
    kind: z.literal('skip'),
    privateSummary: z.string().min(1),
  })
  .strict()

const assistantNotificationSendDecisionSchema = z
  .object({
    kind: z.literal('send_message'),
    text: z.string().min(1),
    subject: z.string().trim().min(1).nullable().optional(),
    privateSummary: z.string().min(1),
  })
  .strict()

const assistantNotificationDecisionSchema = z.discriminatedUnion('kind', [
  assistantNotificationSkipDecisionSchema,
  assistantNotificationSendDecisionSchema,
])

const ASSISTANT_MAINTENANCE_TURN_PROFILE: Required<
  AssistantCodexTurnThreadScopeProfile
> = {
  nativeResumePolicy: 'disabled',
  promptProfile: 'maintenance',
  threadScope: 'isolated-thread',
  toolProfile: 'maintenance-turn',
}
const ASSISTANT_SYSTEM_NOTIFICATION_TURN_PROFILE: Required<
  AssistantCodexTurnThreadScopeProfile
> = {
  nativeResumePolicy: 'disabled',
  promptProfile: 'system-notification',
  threadScope: 'isolated-thread',
  toolProfile: 'output-only-turn',
}
const ASSISTANT_CREATIVE_NOTIFICATION_TURN_PROFILE: Required<
  AssistantCodexTurnThreadScopeProfile
> = {
  nativeResumePolicy: 'disabled',
  promptProfile: 'creative-notification',
  threadScope: 'isolated-thread',
  toolProfile: 'provider-turn',
}
const ASSISTANT_CREATIVE_TEXT_NOTIFICATION_TURN_PROFILE: Required<
  AssistantCodexTurnThreadScopeProfile
> = {
  nativeResumePolicy: 'disabled',
  promptProfile: 'creative-notification',
  threadScope: 'isolated-thread',
  toolProfile: 'output-only-turn',
}
const ASSISTANT_ONBOARDING_GOAL_CHECKIN_TURN_PROFILE: Required<
  AssistantCodexTurnThreadScopeProfile
> = {
  nativeResumePolicy: 'disabled',
  promptProfile: 'conversation',
  threadScope: 'isolated-thread',
  toolProfile: 'provider-turn',
}
const ASSISTANT_NOTIFICATION_MAINTENANCE_CODEX_CONFIG_OVERRIDES = [
  'memories.use_memories=false',
  'memories.generate_memories=false',
] as const

export type AssistantNotificationDecision = z.infer<
  typeof assistantNotificationDecisionSchema
>

export type AssistantNotificationTurnPolicy =
  | {
      kind: 'maintenance-exact-skip'
      maintenanceProfile: AssistantMaintenanceProfile
      privateSummary: string
    }

export type AssistantNotificationPromptProfile =
  | 'creative-response'
  | 'creative-response-text'

export type AssistantNotificationResponsePolicy =
  | { kind: 'allow_send_or_skip' }
  | { kind: 'require_send' }
  | { kind: 'require_send_exact_text'; text: string }

type AssistantModelBackedNotificationResponsePolicy = Exclude<
  AssistantNotificationResponsePolicy,
  { kind: 'require_send_exact_text' }
>

export interface AssistantNotificationFirstContactPolicy {
  markSeenOnDeliveryAccepted: boolean
}

export interface AssistantNotificationCommitContext {
  decision: AssistantNotificationDecision
  deliveryOutcome?: AssistantDeliveryOutcome | null
  response: string | null
}

export interface AssistantNotificationPostTurnDeliveryExpectations {
  groupEmailPendingDeliveryIntentId?: string | null
  groupEmailSendResult?: Extract<
    HostedRuntimeGroupEmailEffectResponse,
    { action: 'send_email' }
  >['result'] | null
}

type AssistantNotificationGroupEmailSendResult = NonNullable<
  AssistantNotificationPostTurnDeliveryExpectations['groupEmailSendResult']
>

export interface AssistantNotificationInput
  extends AssistantSessionResolutionFields,
    Pick<
      AssistantMessageInput,
      | 'abortSignal'
      | 'answeredMailboxItemIds'
      | 'beforeProviderAcceptedInputs'
      | 'codexCommand'
      | 'deliveryDispatchMode'
      | 'deliveryIdempotencyKey'
      | 'deliveryReplyToMessageId'
      | 'deliverySource'
      | 'deliverySubject'
      | 'deliveryTarget'
      | 'executionContext'
      | 'hostedDeliveryIdempotency'
      | 'onProviderEvent'
      | 'onProviderRequestStarted'
      | 'onTraceEvent'
      | 'operatorAuthority'
      | 'reviewedAssistantAskCompletionExpiresAt'
      | 'outboxAutomationAuthority'
      | 'outboxExternalThreadRouteAuthority'
      | 'assistantTargetOverride'
      | 'scheduledAutomationAuthority'
      | 'scheduledInvocationAuthority'
      | 'scheduledOccurrenceAt'
      | 'serviceTier'
      | 'showThinkingTraces'
      | 'turnEnvironment'
      | 'turnTrigger'
      | 'workingDirectory'
    > {
  deliveryDedupeToken?: string | null
  beforeToolExecution?: (() => Promise<void> | void) | null
  beforeDelivery?: ((context: AssistantNotificationCommitContext) => Promise<void> | void) | null
  beforeCommit?: ((context: AssistantNotificationCommitContext) => Promise<void> | void) | null
  deferCommitUntilDeliveryAccepted?: boolean | null
  firstContactPolicy?: AssistantNotificationFirstContactPolicy | null
  instructions: string
  onGroupEmailPendingDeliveryIntentId?: ((intentId: string) => void) | null
  notificationPromptProfile?: AssistantNotificationPromptProfile | null
  turnPolicy?: AssistantNotificationTurnPolicy | null
  responsePolicy?: AssistantNotificationResponsePolicy | null
  scheduledAutomationScheduleKind?: AutomationScheduleKind | null
}

export interface AssistantNotificationResult {
  decision: AssistantNotificationDecision
  deliveryOutcome?: AssistantDeliveryOutcome | null
  postTurnDeliveryExpectations?: AssistantNotificationPostTurnDeliveryExpectations | null
  response: string | null
  session: AssistantSession
}

export async function sendAssistantNotificationLocal(
  input: AssistantNotificationInput,
): Promise<AssistantNotificationResult> {
  const executionContext = normalizeAssistantExecutionContext(input.executionContext)
  const boundaryDefaultTarget = resolveAssistantExecutionDefaultTarget({
    executionContext,
    fallbackTarget: createDefaultLocalAssistantModelTarget(),
  })
  const defaults = resolveAssistantExecutionOperatorDefaults({
    defaults: await resolveAssistantOperatorDefaults(),
    executionContext,
  })
  // Built before the turn lock so evidence reads never extend the window in
  // which fresh foreground input waits on lock admission.
  const maintenanceEvidence = isAssistantNotificationMaintenanceExactSkip(input)
    ? await buildAssistantMaintenanceConversationEvidence({
        now: new Date(),
        profile: requireAssistantNotificationMaintenanceProfile(input),
        vault: input.vault,
      })
    : null

  return withAssistantTurnLock({
    abortSignal: input.abortSignal,
    vault: input.vault,
    run: async () => {
      const messageInput = buildAssistantNotificationMessageInput(
        input,
        maintenanceEvidence,
      )
      let groupEmailSendResult:
        | AssistantNotificationPostTurnDeliveryExpectations['groupEmailSendResult']
        | null = null
      let groupEmailPendingDeliveryIntentId: string | null = null
      const resolved =
        isAssistantNotificationMaintenanceExactSkip(input)
          ? createAssistantMaintenanceNotificationResolvedSession({
              boundaryDefaultTarget,
              defaults,
              message: messageInput,
            })
          : await resolveAssistantSessionForMessage({
              boundaryDefaultTarget,
              defaults,
              message: messageInput,
            })
      await emitHostedAssistantContextSessionResolvedTrace({
        message: messageInput,
        resolved,
        source: 'assistant-notification',
      })
      const withPostTurnDeliveryExpectations = (
        result: AssistantNotificationResult,
      ): AssistantNotificationResult =>
        groupEmailSendResult
          ? {
              ...result,
              postTurnDeliveryExpectations: {
                ...(result.postTurnDeliveryExpectations ?? {}),
                ...(groupEmailPendingDeliveryIntentId
                  ? { groupEmailPendingDeliveryIntentId }
                  : {}),
                groupEmailSendResult,
              },
            }
          : result
      const sharedPlan = await resolveAssistantTurnSharedPlan(messageInput, resolved)
      const conversationScope = resolveAssistantConversationScope(
        sharedPlan.conversationPolicy.audience,
      )
      if (conversationScope === 'unverified-external') {
        throw new VaultCliError(
          'ASSISTANT_AUDIENCE_UNVERIFIED',
          'Notification audience could not be verified as direct or group.',
        )
      }
      const firstContactDocIds = resolveAssistantNotificationFirstContactDocIds({
        input: messageInput,
        session: resolved.session,
        sharedPlan,
      })

      if (
        input.firstContactPolicy?.markSeenOnDeliveryAccepted === true &&
        firstContactDocIds.length > 0 &&
        await hasAssistantSeenFirstContact({
          docIds: firstContactDocIds,
          vault: input.vault,
        })
      ) {
        return withPostTurnDeliveryExpectations({
          decision: {
            kind: 'skip',
            privateSummary: 'First-contact notification already accepted for this route.',
          },
          response: null,
          session: resolved.session,
        })
      }

      if (
        shouldSkipAutomationOccurrenceForAvailability({
          instructions: input.instructions,
          occurrenceAt: input.scheduledOccurrenceAt,
          scheduleKind: input.scheduledAutomationScheduleKind,
        })
      ) {
        return withPostTurnDeliveryExpectations({
          decision: {
            kind: 'skip',
            privateSummary: 'Scheduled occurrence overlaps an authorized calendar conflict.',
          },
          response: null,
          session: resolved.session,
        })
      }

      const responsePolicy: AssistantNotificationResponsePolicy =
        input.responsePolicy ?? { kind: 'allow_send_or_skip' }
      if (responsePolicy.kind === 'require_send_exact_text') {
        return withPostTurnDeliveryExpectations(
          await sendAssistantExactTextNotificationLocal({
            firstContactDocIds,
            input,
            messageInput,
            privateCompletionContinuitySessionId:
              resolved.privateCompletionContinuitySessionId ?? null,
            responseText: responsePolicy.text,
            session: resolved.session,
            sharedPlan,
          }),
        )
      }

      const turnId = createAssistantTurnId()
      const hostedExecutionContext =
        isAssistantNotificationScheduledOccurrence(input) &&
        !isAssistantNotificationMaintenanceExactSkip(input)
          ? executionContext?.hosted ?? null
          : null
      const route = resolveAssistantTurnRoute(messageInput, defaults, resolved)
      const hostedToolContext = hostedExecutionContext
        ? createAssistantHostedToolContext({
            beforeToolExecution: input.beforeToolExecution
              ? async () => {
                  await input.beforeToolExecution?.()
                }
              : undefined,
            computerToolsAvailable:
              typeof hostedExecutionContext.providerFetch === 'function',
            executionContext: hostedExecutionContext,
            getConversationScope: () => conversationScope,
            messageInput,
            groupEmailOutbox: {
              turnId,
              vault: input.vault,
            },
            recordGroupEmailSendResult: (result) => {
              groupEmailSendResult = resolveAssistantNotificationGroupEmailSendResult({
                current: groupEmailSendResult ?? null,
                next: result.result,
              })
            },
            recordGroupEmailPendingDeliveryIntentId: (intentId) => {
              groupEmailPendingDeliveryIntentId = intentId
              input.onGroupEmailPendingDeliveryIntentId?.(intentId)
            },
            route,
            session: resolved.session,
          })
        : null
      const turnCreatedAt = new Date().toISOString()
      const progressDelivery = null
      let committedDeliveryOutcomeKind: AssistantDeliveryOutcome['kind'] | null = null
      const typingIndicator =
        isAssistantNotificationMaintenanceExactSkip(input)
          ? null
          : startAssistantChannelTypingIndicator({
              channelDependencies:
                executionContext?.hosted?.channelTypingDependencies ?? null,
              input: messageInput,
              precedence: 'audience-first',
              session: resolved.session,
              sharedPlan,
            })

      try {
        const notificationProviderRequestStarted =
          messageInput.onProviderRequestStarted ?? null
        let notificationProviderRequestStartedAt: string | undefined
        const notificationTurnProfile = resolveAssistantNotificationTurnProfile(input)
        const notificationThreadScope =
          notificationTurnProfile?.threadScope ?? 'session-thread'
        const providerOutcome = await executeCodexTurnWithRecovery({
          allowFinishWithoutReply: false,
          input: messageInput,
          // Adapt the runner's lean start event to the message-input hook
          // shape; notification turns accept no input items.
          onProviderRequestStarted: (event) => {
            notificationProviderRequestStartedAt = event.startedAt
            return notificationProviderRequestStarted?.({
                  acceptedInputIds: [],
                  providerRequestOrdinal: event.providerRequestOrdinal ?? 0,
                  startedAt: event.startedAt,
                })
          },
          onProviderRequestPlanned: messageInput.beforeProviderAcceptedInputs
            ? async () => await messageInput.beforeProviderAcceptedInputs?.({
                acceptedInputs: [],
              })
            : undefined,
          plan: sharedPlan,
          progressDelivery,
          ...(notificationTurnProfile
            ? { profile: notificationTurnProfile }
            : {}),
          resolvedSession: resolved.session,
          route,
          turnCreatedAt,
          turnId,
          hostedToolContext,
        })
        if (providerOutcome.kind === 'failed_terminal') {
          const nonReplayableProviderWork =
            resolveAssistantNotificationProviderNonReplayableWork({
              input,
              rawEvents: providerOutcome.rawEvents ?? [],
            })
          const failedSession =
            await applyAssistantSessionCodexResumeStateAction({
              action: resolveAssistantProviderResumeStateAction({
                codexThreadId: providerOutcome.codexThreadId,
                threadScope: notificationThreadScope,
              }),
              assistantContractFingerprint:
                providerOutcome.assistantContractFingerprint,
              codexRolloutRelativePath:
                providerOutcome.codexRolloutRelativePath,
              codexThreadId: providerOutcome.codexThreadId,
              routeFingerprint:
                readCodexThreadRouteFingerprint(providerOutcome.route),
              threadCompatibilityFingerprint:
                readCodexThreadCompatibilityFingerprint(providerOutcome.route),
              session: providerOutcome.session,
              vault: input.vault,
            })
          const failedProviderResult = {
            attemptCount: providerOutcome.attemptCount,
            provider: providerOutcome.route.provider,
            providerOptions: providerOutcome.route.providerOptions,
            route: providerOutcome.route,
            session: failedSession,
            usage: providerOutcome.usage,
            usageAttribution: providerOutcome.usageAttribution,
          }
          await recordAssistantUsageEvent({
            executionContext,
            ...(notificationProviderRequestStartedAt === undefined
              ? {}
              : { occurredAt: notificationProviderRequestStartedAt }),
            providerRequestOutcome: providerOutcome.providerRequestOutcome,
            providerResult: failedProviderResult,
            turnId,
          })
          await recordAdditionalAssistantUsageEvents({
            additionalUsages: providerOutcome.additionalUsages,
            effectiveEnv: messageInput.turnEnvironment?.env ?? process.env,
            executionContext,
            providerResult: failedProviderResult,
            turnId,
          })
          throw annotateAssistantNotificationError(
            providerOutcome.error,
            {
              ...buildAssistantNotificationObservabilityDetails({
                stage: 'provider',
                input: messageInput,
                route: providerOutcome.route,
                session: failedSession,
              }),
              assistantNotificationProviderNonReplayableWork:
                nonReplayableProviderWork,
            },
          )
        }

        const providerResult = providerOutcome.providerTurn
        const nonReplayableProviderWork =
          resolveAssistantNotificationProviderNonReplayableWork({
            input,
            rawEvents: providerResult.rawEvents ?? [],
          })
        const selectedRoute = providerResult.route
        const providerResumeStateAction =
          resolveAssistantNotificationProviderResumeStateAction({
            input,
            providerResult,
          })
        await recordAssistantUsageEvent({
          executionContext,
          ...(notificationProviderRequestStartedAt === undefined
            ? {}
            : { occurredAt: notificationProviderRequestStartedAt }),
          providerResult,
          turnId,
        })
        await recordAdditionalAssistantUsageEvents({
          additionalUsages: providerResult.additionalUsages,
          effectiveEnv: messageInput.turnEnvironment?.env ?? process.env,
          executionContext,
          providerResult,
          turnId,
        })
        const providerValidationErrorDetails = {
          ...buildAssistantNotificationObservabilityDetails({
            stage: 'provider',
            input: messageInput,
            route: selectedRoute,
            session: providerResult.session,
          }),
          assistantNotificationProviderNonReplayableWork:
            nonReplayableProviderWork,
        }
        let decision: AssistantNotificationDecision
        try {
          decision = providerResult.finalAction?.kind === 'none' && groupEmailSendResult
            ? {
                kind: 'skip',
                privateSummary: 'Group email effect completed.',
              }
            : parseAssistantNotificationDecision(
                providerResult.providerAuthoredResponse ?? providerResult.response,
              )
          if (providerResult.responseCard && decision.kind !== 'send_message') {
            throw new VaultCliError(
              'ASSISTANT_NOTIFICATION_INVALID_RESPONSE',
              'A notification response card requires a send_message decision.',
            )
          }
        } catch (error) {
          throw annotateAssistantNotificationError(
            error,
            providerValidationErrorDetails,
          )
        }
        if (isAssistantNotificationMaintenanceExactSkip(input)) {
          try {
            assertAssistantMaintenanceNotificationDecision({
              decision,
              policy: input.turnPolicy,
            })
          } catch (error) {
            throw annotateAssistantNotificationError(
              error,
              providerValidationErrorDetails,
            )
          }
          return withPostTurnDeliveryExpectations({
            decision,
            response: null,
            session: resolved.session,
          })
        }

        if (decision.kind === 'skip') {
          assertAssistantNotificationSkipAllowed(responsePolicy)
          await runAssistantNotificationBeforeCommit(input, {
            decision,
            deliveryOutcome: null,
            response: null,
          })
          const savedSession = await persistAssistantTurnAndSession({
            assistantTranscriptText: null,
            input: messageInput,
            plan: sharedPlan,
            persistUserPromptToTranscript: false,
            providerResult,
            providerResumeStateAction,
            session: providerResult.session,
            turnCreatedAt,
            turnId,
          })
          return withPostTurnDeliveryExpectations({
            decision,
            response: null,
            session: savedSession,
          })
        }

        let responseMedia: readonly AssistantResponseMedia[]
        try {
          responseMedia = resolveAssistantNotificationResponseMedia({
            notificationPromptProfile: input.notificationPromptProfile ?? null,
            responseMedia: providerResult.responseMedia,
          })
        } catch (error) {
          throw annotateAssistantNotificationError(
            error,
            providerValidationErrorDetails,
          )
        }
        const responseText = providerResult.responseCard
          ? renderAssistantResponseCardText(providerResult.responseCard)
          : normalizeRequiredText(decision.text, 'notification response')
        throwIfAssistantNotificationAborted(messageInput.abortSignal)
        await runAssistantNotificationBeforeDelivery(input, {
          decision: {
            ...decision,
            text: responseText,
          },
          deliveryOutcome: null,
          response: responseText,
        })

        const state = createAssistantRuntimeStateService(input.vault)
        const createNotificationReceipt = async (session: AssistantSession): Promise<void> => {
          await state.turns.createReceipt({
            sessionId: session.sessionId,
            provider: selectedRoute.provider,
            providerModel:
              selectedRoute.providerOptions.model
              ?? session.providerOptions.model
              ?? null,
            prompt: messageInput.prompt,
            deliveryRequested: true,
            turnId,
          })
        }

        if (input.deferCommitUntilDeliveryAccepted !== true) {
          await createNotificationReceipt(providerResult.session)
          const savedSession = await persistAssistantTurnAndSession({
            assistantTranscriptText: responseText,
            input: messageInput,
            plan: sharedPlan,
            persistUserPromptToTranscript: false,
            providerResult,
            providerResumeStateAction,
            session: providerResult.session,
            turnCreatedAt,
            turnId,
          })
          const deliveryOutcome = await deliverAssistantNotificationMessage({
            dedupeToken: input.deliveryDedupeToken ?? null,
            decisionSubject: decision.subject ?? null,
            input: messageInput,
            card: providerResult.responseCard ?? null,
            media: responseMedia,
            message: responseText,
            session: savedSession,
            sharedPlan,
            turnId,
          })
          committedDeliveryOutcomeKind = deliveryOutcome.kind
          await finalizeAssistantTurnFromDeliveryOutcome({
            outcome: deliveryOutcome,
            response: responseText,
            turnId,
            vault: input.vault,
          })
          if (
            input.firstContactPolicy?.markSeenOnDeliveryAccepted === true &&
            assistantNotificationDeliveryAcceptedFirstContact({
              deliveryOutcome,
              dispatchMode: input.deliveryDispatchMode,
            })
          ) {
            await markAssistantFirstContactSeen({
              docIds: resolveAssistantNotificationFirstContactDocIds({
                input: messageInput,
                session: deliveryOutcome.session,
                sharedPlan,
              }),
              seenAt: new Date().toISOString(),
              vault: input.vault,
            })
          }
          await state.status.refreshSnapshot().catch((error) => {
            warnAssistantBestEffortFailure({
              error,
              operation: 'status snapshot refresh',
            })
          })

          if (deliveryOutcome.kind === 'failed') {
            throw annotateAssistantNotificationError(
              deliveryOutcome.error,
              buildAssistantNotificationObservabilityDetails({
                stage: 'delivery',
                input: messageInput,
                route: selectedRoute,
                session: savedSession,
              }),
            )
          }

          return withPostTurnDeliveryExpectations({
            decision: {
              ...decision,
              text: responseText,
            },
            deliveryOutcome,
            response: responseText,
            session: deliveryOutcome.session,
          })
        }

        const deliveryOutcome = await deliverAssistantNotificationMessage({
          dedupeToken: input.deliveryDedupeToken ?? null,
          decisionSubject: decision.subject ?? null,
          input: messageInput,
          card: providerResult.responseCard ?? null,
          media: responseMedia,
          message: responseText,
          session: providerResult.session,
          sharedPlan,
          turnId,
        })
        const committedDeliveryOutcome = await (async (): Promise<AssistantDeliveryOutcome> => {
          try {
            await runAssistantNotificationBeforeCommit(input, {
              decision: {
                ...decision,
                text: responseText,
              },
              deliveryOutcome,
              response: responseText,
            })
            if (deliveryOutcome.kind === 'failed') {
              throw annotateAssistantNotificationError(
                deliveryOutcome.error,
                buildAssistantNotificationObservabilityDetails({
                  stage: 'delivery',
                  input: messageInput,
                  route: selectedRoute,
                  session: providerResult.session,
                }),
              )
            }
            await createNotificationReceipt(deliveryOutcome.session)
            const savedSession = await persistAssistantTurnAndSession({
              assistantTranscriptText: responseText,
              input: messageInput,
              plan: sharedPlan,
              persistUserPromptToTranscript: false,
              providerResult,
              providerResumeStateAction,
              session: deliveryOutcome.session,
              turnCreatedAt,
              turnId,
            })
            const finalizedDeliveryOutcome = {
              ...deliveryOutcome,
              session: savedSession,
            }
            await finalizeAssistantTurnFromDeliveryOutcome({
              outcome: finalizedDeliveryOutcome,
              response: responseText,
              turnId,
              vault: input.vault,
            })
            return finalizedDeliveryOutcome
          } catch (error) {
            await abandonQueuedNotificationDeliveryAfterCommitFailure({
              deliveryOutcome,
              error,
              vault: input.vault,
            })
            throw error
          }
        })()
        committedDeliveryOutcomeKind = committedDeliveryOutcome.kind
        if (
          input.firstContactPolicy?.markSeenOnDeliveryAccepted === true &&
          assistantNotificationDeliveryAcceptedFirstContact({
            deliveryOutcome: committedDeliveryOutcome,
            dispatchMode: input.deliveryDispatchMode,
          })
        ) {
          await markAssistantFirstContactSeen({
            docIds: resolveAssistantNotificationFirstContactDocIds({
              input: messageInput,
              session: committedDeliveryOutcome.session,
              sharedPlan,
            }),
            seenAt: new Date().toISOString(),
            vault: input.vault,
          })
        }
        await state.status.refreshSnapshot().catch((error) => {
          warnAssistantBestEffortFailure({
            error,
            operation: 'status snapshot refresh',
          })
        })

        return withPostTurnDeliveryExpectations({
          decision: {
            ...decision,
            text: responseText,
          },
          deliveryOutcome: committedDeliveryOutcome,
          response: responseText,
          session: committedDeliveryOutcome.session,
        })
      } finally {
        await stopAssistantChannelTypingIndicator(typingIndicator, {
          providerStop: !assistantDeliveryOutcomeSupersedesTypingIndicator(
            committedDeliveryOutcomeKind,
          ),
        })
      }
    },
  })
}

async function sendAssistantExactTextNotificationLocal(input: {
  firstContactDocIds: readonly string[]
  input: AssistantNotificationInput
  messageInput: AssistantMessageInput
  privateCompletionContinuitySessionId: string | null
  responseText: string
  session: AssistantSession
  sharedPlan: Awaited<ReturnType<typeof resolveAssistantTurnSharedPlan>>
}): Promise<AssistantNotificationResult> {
  const responseText = normalizeRequiredText(
    input.responseText,
    'notification response',
  )
  const deferPrivateCompletionContinuity =
    isAssistantReviewedPrivateExactCompletion(input.input)
  const turnId = createAssistantTurnId()
  const turnCreatedAt = new Date().toISOString()
  const state = createAssistantRuntimeStateService(input.input.vault)
  throwIfAssistantNotificationAborted(input.input.abortSignal)

  const exactTextDecision: AssistantNotificationDecision = {
    kind: 'send_message',
    privateSummary: 'Sent required exact notification text.',
    text: responseText,
  }
  await runAssistantNotificationBeforeDelivery(input.input, {
    decision: exactTextDecision,
    deliveryOutcome: null,
    response: responseText,
  })

  const createExactTextReceipt = async (session: AssistantSession): Promise<void> => {
    await state.turns.createReceipt({
      deliveryRequested: true,
      metadata: {
        notificationMode: 'deterministic-exact-text',
      },
      prompt: input.messageInput.prompt,
      provider: session.provider,
      providerModel: session.providerOptions.model ?? null,
      sessionId: session.sessionId,
      startedAt: turnCreatedAt,
      turnId,
    })
  }

  if (input.input.deferCommitUntilDeliveryAccepted !== true) {
    await createExactTextReceipt(input.session)
  }

  const deliveryOutcome = await deliverAssistantNotificationMessage({
    dedupeToken: input.input.deliveryDedupeToken ?? null,
    decisionSubject: null,
    input: input.messageInput,
    media: [],
    message: responseText,
    privateCompletionContinuitySessionId:
      deferPrivateCompletionContinuity
        ? input.privateCompletionContinuitySessionId
        : undefined,
    session: input.session,
    sharedPlan: input.sharedPlan,
    turnId,
  })

  let savedSession: AssistantSession
  if (input.input.deferCommitUntilDeliveryAccepted === true) {
    try {
      await runAssistantNotificationBeforeCommit(input.input, {
        decision: exactTextDecision,
        deliveryOutcome,
        response: responseText,
      })
      if (
        input.input.deliveryDispatchMode !== 'queue-only' &&
        deliveryOutcome.kind === 'queued'
      ) {
        throw new VaultCliError(
          'ASSISTANT_NOTIFICATION_DELIVERY_DEFERRED',
          'Required exact-text notification delivery was deferred instead of sent.',
        )
      }

      if (deliveryOutcome.kind === 'failed') {
        throw deliveryOutcome.error
      }

      await createExactTextReceipt(deliveryOutcome.session)
      await finalizeAssistantTurnFromDeliveryOutcome({
        outcome: deliveryOutcome,
        response: responseText,
        turnId,
        vault: input.input.vault,
      })
      savedSession = deferPrivateCompletionContinuity
        ? deliveryOutcome.session
        : await persistAssistantExactTextNotificationSession({
            responseText,
            session: deliveryOutcome.session,
            turnCreatedAt,
            vault: input.input.vault,
          })
    } catch (error) {
      await abandonQueuedNotificationDeliveryAfterCommitFailure({
        deliveryOutcome,
        error,
        vault: input.input.vault,
      })
      throw error
    }
  } else {
    await finalizeAssistantTurnFromDeliveryOutcome({
      outcome: deliveryOutcome,
      response: responseText,
      turnId,
      vault: input.input.vault,
    })

    if (
      input.input.deliveryDispatchMode !== 'queue-only' &&
      deliveryOutcome.kind === 'queued'
    ) {
      throw new VaultCliError(
        'ASSISTANT_NOTIFICATION_DELIVERY_DEFERRED',
        'Required exact-text notification delivery was deferred instead of sent.',
      )
    }

    if (deliveryOutcome.kind === 'failed') {
      throw deliveryOutcome.error
    }
    savedSession = deferPrivateCompletionContinuity
      ? deliveryOutcome.session
      : await persistAssistantExactTextNotificationSession({
          responseText,
          session: deliveryOutcome.session,
          turnCreatedAt,
          vault: input.input.vault,
        })
  }

  if (
    input.input.firstContactPolicy?.markSeenOnDeliveryAccepted === true &&
    assistantNotificationDeliveryAcceptedFirstContact({
      deliveryOutcome,
      dispatchMode: input.input.deliveryDispatchMode,
    })
  ) {
    await markAssistantFirstContactSeen({
      docIds: input.firstContactDocIds,
      seenAt: new Date().toISOString(),
      vault: input.input.vault,
    })
  }

  await state.status.refreshSnapshot().catch((error) => {
    warnAssistantBestEffortFailure({
      error,
      operation: 'status snapshot refresh',
    })
  })

  return {
    decision: {
      ...exactTextDecision,
    },
    deliveryOutcome: {
      ...deliveryOutcome,
      session: savedSession,
    },
    response: responseText,
    session: savedSession,
  }
}

function resolveAssistantNotificationGroupEmailSendResult(input: {
  current: AssistantNotificationGroupEmailSendResult | null
  next: AssistantNotificationGroupEmailSendResult
}): AssistantNotificationGroupEmailSendResult {
  if (input.current && input.current.status !== 'unavailable') {
    return input.current
  }
  return input.next
}

async function runAssistantNotificationBeforeDelivery(
  input: AssistantNotificationInput,
  context: AssistantNotificationCommitContext,
): Promise<void> {
  throwIfAssistantNotificationAborted(input.abortSignal)
  await input.beforeDelivery?.(context)
  throwIfAssistantNotificationAborted(input.abortSignal)
}

async function runAssistantNotificationBeforeCommit(
  input: AssistantNotificationInput,
  context: AssistantNotificationCommitContext,
): Promise<void> {
  throwIfAssistantNotificationAborted(input.abortSignal)
  await input.beforeCommit?.(context)
  throwIfAssistantNotificationAborted(input.abortSignal)
}

async function abandonQueuedNotificationDeliveryAfterCommitFailure(input: {
  deliveryOutcome: AssistantDeliveryOutcome
  error: unknown
  vault: string
}): Promise<void> {
  if (input.deliveryOutcome.kind !== 'queued') {
    return
  }

  await markAssistantOutboxIntentMirrorTerminalById({
    error: input.error,
    intentId: input.deliveryOutcome.intentId,
    onlyCurrentStatuses: ['pending', 'retryable', 'awaiting_approval'],
    status: 'abandoned',
    vault: input.vault,
  })
}

function assistantNotificationDeliveryAcceptedFirstContact(input: {
  deliveryOutcome: AssistantDeliveryOutcome
  dispatchMode?: AssistantNotificationInput['deliveryDispatchMode']
}): boolean {
  if (input.deliveryOutcome.kind === 'sent') {
    return true
  }

  return input.dispatchMode === 'queue-only' && input.deliveryOutcome.kind === 'queued'
}

async function persistAssistantExactTextNotificationSession(input: {
  responseText: string
  session: AssistantSession
  turnCreatedAt: string
  vault: string
}): Promise<AssistantSession> {
  const state = createAssistantRuntimeStateService(input.vault)
  await state.transcripts.append(
    input.session.sessionId,
    [
      {
        kind: 'assistant',
        text: input.responseText,
        createdAt: input.turnCreatedAt,
      },
    ],
  )
  const updatedAt = new Date().toISOString()
  return await state.sessions.save({
    ...input.session,
    updatedAt,
    lastTurnAt: updatedAt,
    turnCount: input.session.turnCount + 1,
  })
}

function isAssistantReviewedPrivateExactCompletion(
  input: AssistantNotificationInput,
): boolean {
  const expiresAt = normalizeNullableString(
    input.reviewedAssistantAskCompletionExpiresAt,
  )
  const answeredMailboxItemIds = input.answeredMailboxItemIds ?? []
  const completionId = answeredMailboxItemIds.length === 1
    ? normalizeNullableString(answeredMailboxItemIds[0])
    : null
  if (
    expiresAt === null
    || !Number.isFinite(Date.parse(expiresAt))
    || completionId === null
    || answeredMailboxItemIds[0] !== completionId
    || [...completionId].length > 256
  ) {
    return false
  }

  const deliveryKey =
    createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(completionId)
  return (
    input.executionContext?.hosted != null
    && input.responsePolicy?.kind === 'require_send_exact_text'
    && input.deliveryDispatchMode === 'queue-only'
    && input.firstContactPolicy == null
    && input.notificationPromptProfile == null
    && input.outboxExternalThreadRouteAuthority == null
    && input.threadIsDirect === true
    && (input.channel === 'linq' || input.channel === 'telegram')
    && normalizeNullableString(input.deliveryDedupeToken) === deliveryKey
    && normalizeNullableString(input.deliveryIdempotencyKey) === deliveryKey
  )
}

type AssistantNotificationAnnotatedError = Error & {
  code?: string | null
  details?: Record<string, unknown>
  retryable?: boolean
}

function annotateAssistantNotificationError(
  error: unknown,
  details: Record<string, unknown>,
): Error {
  if (error instanceof Error) {
    const annotatedError = error as AssistantNotificationAnnotatedError
    annotatedError.details = mergeAssistantNotificationErrorDetails(
      annotatedError.details,
      details,
    )
    return annotatedError
  }

  const deliveryError = normalizeAssistantDeliveryError(error)
  const wrapped = new Error(
    deliveryError.message || 'Assistant notification execution failed.',
  ) as AssistantNotificationAnnotatedError
  wrapped.code = deliveryError.code ?? null
  const retryable = readAssistantNotificationRetryableFlag(error)
  if (retryable !== null) {
    wrapped.retryable = retryable
  }
  wrapped.details = { ...details }
  return wrapped
}

function readAssistantNotificationRetryableFlag(error: unknown): boolean | null {
  const record = readAssistantNotificationRecord(error)
  if (typeof record?.retryable === 'boolean') {
    return record.retryable
  }
  const context = readAssistantNotificationRecord(record?.context)
  return typeof context?.retryable === 'boolean' ? context.retryable : null
}

function readAssistantNotificationRecord(
  value: unknown,
): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function mergeAssistantNotificationErrorDetails(
  existing: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(isAssistantNotificationDetailsRecord(existing) ? existing : {}),
    ...next,
  }
}

function isAssistantNotificationDetailsRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function buildAssistantNotificationObservabilityDetails(input: {
  input: AssistantMessageInput
  route: CodexThreadIdentity
  session: AssistantSession
  stage: 'delivery' | 'provider'
}): Record<string, unknown> {
  const channel = input.input.channel ?? input.session.binding.channel ?? null
  const providerOptions = input.route.providerOptions
  const bindingDelivery = input.session.binding.delivery
  const env = input.input.turnEnvironment?.env ?? process.env
  const linqBaseUrl = readAssistantNotificationUrlDetails(env.LINQ_API_BASE_URL)
  const providerBaseUrl = readAssistantNotificationUrlDetails(
    readAssistantNotificationStringProperty(providerOptions, 'baseUrl'),
  )
  const gatewayOnlyProviders = summarizeAssistantNotificationGatewayOnlyProviders(
    readAssistantNotificationStringListProperty(
      providerOptions,
      'gatewayOnlyProviders',
    ),
  )

  return {
    assistantNotificationChannel: channel,
    assistantNotificationDeliveryDispatchMode: input.input.deliveryDispatchMode ?? null,
    assistantNotificationDeliveryKind:
      bindingDelivery?.kind ?? input.input.deliveryKind ?? null,
    assistantNotificationExplicitTargetPresent:
      normalizeNullableString(input.input.deliveryTarget) !== null,
    assistantNotificationIdentityIdPresent:
      normalizeNullableString(input.input.identityId) !== null,
    assistantNotificationLinqBaseUrlOrigin: linqBaseUrl.origin,
    assistantNotificationLinqBaseUrlPath: linqBaseUrl.path,
    assistantNotificationGatewayOnlyProviders: gatewayOnlyProviders,
    assistantNotificationProvider: input.route.provider,
    assistantNotificationProviderBaseUrlOrigin: providerBaseUrl.origin,
    assistantNotificationProviderBaseUrlPath: providerBaseUrl.path,
    assistantNotificationProviderModel: providerOptions.model ?? null,
    assistantNotificationRouteId: readCodexThreadRouteFingerprint(input.route),
    assistantNotificationStage: input.stage,
    assistantNotificationThreadIdPresent:
      normalizeNullableString(input.input.threadId) !== null,
    assistantNotificationThreadIsDirect:
      input.input.threadIsDirect ?? input.session.binding.threadIsDirect ?? null,
    assistantNotificationTurnTrigger: input.input.turnTrigger ?? null,
    assistantNotificationWorkingDirectoryPresent:
      normalizeNullableString(input.input.workingDirectory) !== null,
    assistantNotificationHostedExecutionPresent: input.input.executionContext?.hosted != null,
  }
}

function summarizeAssistantNotificationGatewayOnlyProviders(
  values: readonly string[] | null | undefined,
): string | null {
  const normalized = [...(values ?? [])]
    .map((value) => normalizeNullableString(value)?.toLowerCase() ?? null)
    .filter((value): value is string =>
      value !== null && /^[a-z0-9][a-z0-9._-]*$/u.test(value),
    )

  return normalized.length > 0 ? Array.from(new Set(normalized)).join(',') : null
}

function readAssistantNotificationUrlDetails(value: string | null | undefined): {
  origin: string | null
  path: string | null
} {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    return {
      origin: null,
      path: null,
    }
  }

  try {
    const url = new URL(normalized)
    return {
      origin: url.origin,
      path: url.pathname,
    }
  } catch {
    return {
      origin: null,
      path: null,
    }
  }
}

function readAssistantNotificationStringProperty(
  value: object,
  key: string,
): string | null {
  const candidate: unknown = Reflect.get(value, key)
  return typeof candidate === 'string'
    ? normalizeNullableString(candidate)
    : null
}

function readAssistantNotificationStringListProperty(
  value: object,
  key: string,
): readonly string[] | null {
  const candidate: unknown = Reflect.get(value, key)
  if (!Array.isArray(candidate)) {
    return null
  }

  return candidate.filter((entry): entry is string => typeof entry === 'string')
}

function buildAssistantNotificationMessageInput(
  input: AssistantNotificationInput,
  maintenanceEvidence: string | null,
): AssistantMessageInput {
  const instructions = normalizeRequiredText(
    stripAutomationAvailabilityConflictEvidenceForProvider(input.instructions),
    'instructions',
  )
  const maintenanceTurn = isAssistantNotificationMaintenanceExactSkip(input)
  const scheduledOccurrence = isAssistantNotificationScheduledOccurrence(input)
  const firstContactExactText =
    input.responsePolicy?.kind === 'require_send_exact_text' &&
    input.firstContactPolicy?.markSeenOnDeliveryAccepted === true
  // One overlay for each non-user turn boundary, so provider-audit policy
  // cannot drift across caller-specific configuration.
  const executionOverlay = maintenanceTurn
    ? {
        codexConfigOverrides:
          ASSISTANT_NOTIFICATION_MAINTENANCE_CODEX_CONFIG_OVERRIDES,
        suppressProviderFailureTranscriptAudit: true,
      }
    : scheduledOccurrence
      ? {}
      : { suppressProviderFailureTranscriptAudit: true }
  return {
    ...executionOverlay,
    abortSignal: input.abortSignal,
    actorId: input.actorId,
    alias: input.alias,
    allowBindingRebind: input.allowBindingRebind,
    answeredMailboxItemIds: input.answeredMailboxItemIds ?? [],
    approvalPolicy: scheduledOccurrence ? input.approvalPolicy : 'never',
    bindingDeliveryTarget: input.bindingDeliveryTarget,
    channel: input.channel,
    codexCommand: input.codexCommand,
    codexHome: input.codexHome,
    conversation: input.conversation,
    deliverResponse: true,
    deliveryDispatchMode: input.deliveryDispatchMode,
    deliveryKind: input.deliveryKind,
    deliveryIdempotencyKey: input.deliveryIdempotencyKey ?? null,
    reviewedAssistantAskCompletionExpiresAt:
      input.reviewedAssistantAskCompletionExpiresAt ?? null,
    deliveryReplyToMessageId: input.deliveryReplyToMessageId ?? null,
    deliverySource: input.deliverySource ?? null,
    deliverySubject: input.deliverySubject ?? null,
    deliveryTarget: input.deliveryTarget ?? null,
    executionContext: input.executionContext,
    hostedDeliveryIdempotency: input.hostedDeliveryIdempotency ?? null,
    identityId: input.identityId,
    includeEarlySessionOnboarding: false,
    maintenanceProfile: maintenanceTurn
      ? requireAssistantNotificationMaintenanceProfile(input)
      : null,
    maxSessionAgeMs: input.maxSessionAgeMs,
    model: input.model,
    modelProvider: input.modelProvider,
    oss: input.oss,
    onProviderEvent: input.onProviderEvent ?? null,
    beforeProviderAcceptedInputs: input.beforeProviderAcceptedInputs ?? null,
    onProviderRequestStarted: input.onProviderRequestStarted ?? null,
    onTraceEvent: input.onTraceEvent,
    operatorAuthority: input.operatorAuthority,
    outboxAutomationAuthority: input.outboxAutomationAuthority ?? null,
    outboxExternalThreadRouteAuthority:
      input.outboxExternalThreadRouteAuthority ?? null,
    participantId: input.participantId,
    persistUserPromptOnFailure: false,
    profile: input.profile,
    prompt: maintenanceEvidence
      ? `${instructions}\n\n${maintenanceEvidence}`
      : instructions,
    provider: input.provider,
    receiptMetadata: null,
    reasoningEffort: input.reasoningEffort,
    // First-contact exact text does not start a provider. Keep its durable
    // conversation session on the ordinary target so the next attended turn
    // continues from the welcome that was already delivered.
    sandbox:
      scheduledOccurrence || firstContactExactText
        ? input.sandbox
        : 'read-only',
    scheduledAutomationAuthority: input.scheduledAutomationAuthority ?? null,
    scheduledInvocationAuthority: input.scheduledInvocationAuthority ?? null,
    scheduledOccurrenceAt: input.scheduledOccurrenceAt ?? null,
    serviceTier: input.serviceTier ?? null,
    sessionId: input.sessionId,
    showThinkingTraces: input.showThinkingTraces,
    threadId: input.threadId,
    threadIsDirect: input.threadIsDirect,
    turnEnvironment: input.turnEnvironment ?? null,
    assistantTargetOverride: input.assistantTargetOverride ?? null,
    turnTrigger: scheduledOccurrence
      ? input.turnTrigger ?? 'automation-cron'
      : 'manual-deliver',
    userMessageContent: null,
    vault: input.vault,
    workingDirectory: input.workingDirectory,
  }
}

async function deliverAssistantNotificationMessage(input: {
  card?: AssistantResponseCard | null
  dedupeToken: string | null
  decisionSubject: string | null
  input: AssistantMessageInput
  media?: readonly AssistantResponseMedia[] | null
  message: string
  privateCompletionContinuitySessionId?: string | null
  session: AssistantSession
  sharedPlan: Awaited<ReturnType<typeof resolveAssistantTurnSharedPlan>>
  turnId: string
}): Promise<AssistantDeliveryOutcome> {
  const state = createAssistantRuntimeStateService(input.input.vault)
  const deliveryFieldsBase = resolveAssistantCurrentAudienceDeliveryFields({
    input: input.input,
    precedence: 'audience-first',
    session: input.session,
    sharedPlan: input.sharedPlan,
  })
  const subject = resolveAssistantNotificationDeliverySubject({
    bindingDelivery: deliveryFieldsBase.bindingDelivery,
    channel: deliveryFieldsBase.channel,
    decisionSubject: input.decisionSubject,
    explicitTarget: deliveryFieldsBase.explicitTarget,
    inputDeliverySubject: input.input.deliverySubject ?? null,
  })
  const deliveryFields = {
    ...deliveryFieldsBase,
    subject,
  }
  const hostedDelivery = resolveAssistantHostedDeliveryIdempotency({
    audience: input.sharedPlan.conversationPolicy.audience,
    channel: deliveryFields.channel,
    deliveryFields,
    input: input.input,
    session: input.session,
  })
  const requestedMedia = normalizeAssistantResponseMediaList(input.media ?? [])
  const media = dropUnsupportedAssistantResponseMediaForChannel({
    channel: deliveryFields.channel,
    media: requestedMedia,
  })
  const outcome = await state.outbox.deliverMessage({
    answeredMailboxItemIds: input.input.answeredMailboxItemIds ?? [],
    reviewedAssistantAskCompletionExpiresAt:
      input.input.reviewedAssistantAskCompletionExpiresAt ?? null,
    automationAuthority: input.input.outboxAutomationAuthority ?? null,
    externalThreadRouteAuthority:
      input.input.outboxExternalThreadRouteAuthority ?? null,
    turnId: input.turnId,
    message: input.message,
    dedupeToken: input.dedupeToken,
    deliveryIdempotencyKey: hostedDelivery.deliveryIdempotencyKey,
    deliveryTransportIdempotent: hostedDelivery.deliveryTransportIdempotent,
    signal: input.input.abortSignal,
    ...deliveryFields,
    card: input.card ?? null,
    media,
    ...(input.privateCompletionContinuitySessionId === undefined
      ? {}
      : {
          privateCompletionContinuitySessionId:
            input.privateCompletionContinuitySessionId,
        }),
    dispatchMode: input.input.deliveryDispatchMode,
  })
  switch (outcome.kind) {
    case 'sent':
      return {
        kind: 'sent',
        delivery: outcome.delivery,
        intentId: outcome.intent.intentId,
        media,
        session: outcome.session ?? input.session,
      }
    case 'queued':
      return {
        kind: 'queued',
        error: outcome.deliveryError,
        intentId: outcome.intent.intentId,
        media,
        session: outcome.session ?? input.session,
      }
    case 'failed':
      return {
        kind: 'failed',
        error: outcome.deliveryError,
        intentId: outcome.intent.intentId,
        media,
        session: outcome.session ?? input.session,
      }
    default:
      return {
        kind: 'failed',
        error: normalizeAssistantDeliveryError(
          new VaultCliError(
            'ASSISTANT_DELIVERY_FAILED',
            'Assistant outbound delivery did not complete successfully.',
          ),
        ),
        intentId: null,
        media,
        session: input.session,
      }
  }
}

function resolveAssistantNotificationProviderResumeStateAction(input: {
  input: AssistantNotificationInput
  providerResult: { codexThreadId?: string | null }
}): AssistantProviderResumeStateAction {
  if (
    isAssistantNotificationMaintenanceExactSkip(input.input) ||
    isAssistantOnboardingGoalCheckinNotification(input.input) ||
    !isAssistantNotificationScheduledOccurrence(input.input)
  ) {
    return 'preserve-existing'
  }

  return normalizeNullableString(input.providerResult.codexThreadId)
    ? 'persist-from-provider-turn'
    : 'preserve-existing'
}

function createAssistantMaintenanceNotificationResolvedSession(input: {
  boundaryDefaultTarget:
    Parameters<typeof resolveAssistantSessionTarget>[0]['boundaryDefaultTarget']
  defaults: Parameters<typeof resolveAssistantSessionTarget>[0]['defaults']
  message: AssistantMessageInput
}): ResolvedAssistantSession {
  const now = new Date().toISOString()
  const sessionId = createAssistantSessionId()
  const target = resolveAssistantSessionTarget({
    boundaryDefaultTarget: input.boundaryDefaultTarget,
    defaults: input.defaults,
    input: input.message,
  })
  const actorId = input.message.actorId ?? input.message.participantId ?? null
  const binding = createAssistantBinding({
    actorId,
    channel: input.message.channel,
    deliveryKind: input.message.deliveryKind,
    deliveryTarget:
      input.message.bindingDeliveryTarget ?? input.message.deliveryTarget ?? null,
    identityId: input.message.identityId,
    threadId: input.message.threadId,
    threadIsDirect: input.message.threadIsDirect,
  })
  const session = parseAssistantSessionRecord({
    schema: 'murph.assistant-conversation.v2',
    conversationId: sessionId,
    alias: input.message.alias ?? null,
    binding,
    codexTarget: target,
    codexResume: null,
    createdAt: now,
    updatedAt: now,
    lastTurnAt: null,
    turnCount: 0,
  })

  return {
    created: true,
    paths: resolveAssistantStatePaths(input.message.vault),
    session,
  }
}

function isAssistantNotificationMaintenanceExactSkip(
  input: AssistantNotificationInput,
): boolean {
  return input.turnPolicy?.kind === 'maintenance-exact-skip'
}

function requireAssistantNotificationMaintenanceProfile(
  input: AssistantNotificationInput,
): AssistantMaintenanceProfile {
  if (input.turnPolicy?.kind === 'maintenance-exact-skip') {
    return input.turnPolicy.maintenanceProfile
  }
  throw new TypeError('Maintenance profile requires an exact-skip turn policy.')
}

function isAssistantNotificationScheduledOccurrence(
  input: Pick<AssistantNotificationInput, 'scheduledOccurrenceAt'>,
): boolean {
  const occurrenceAt = normalizeNullableString(input.scheduledOccurrenceAt)
  return occurrenceAt !== null && Number.isFinite(new Date(occurrenceAt).getTime())
}

function resolveAssistantNotificationTurnProfile(
  input: AssistantNotificationInput,
): Required<AssistantCodexTurnThreadScopeProfile> | null {
  if (isAssistantNotificationMaintenanceExactSkip(input)) {
    return ASSISTANT_MAINTENANCE_TURN_PROFILE
  }
  if (input.notificationPromptProfile === 'creative-response') {
    return ASSISTANT_CREATIVE_NOTIFICATION_TURN_PROFILE
  }
  if (input.notificationPromptProfile === 'creative-response-text') {
    return ASSISTANT_CREATIVE_TEXT_NOTIFICATION_TURN_PROFILE
  }
  if (isAssistantOnboardingGoalCheckinNotification(input)) {
    return ASSISTANT_ONBOARDING_GOAL_CHECKIN_TURN_PROFILE
  }
  return isAssistantNotificationScheduledOccurrence(input)
    ? null
    : ASSISTANT_SYSTEM_NOTIFICATION_TURN_PROFILE
}

function isAssistantOnboardingGoalCheckinNotification(
  input: Pick<AssistantNotificationInput, 'scheduledInvocationAuthority'>,
): boolean {
  return input.scheduledInvocationAuthority?.automationId ===
    MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID
}

// Only maintenance turns consume this signal (to decide whether a failed run
// already performed a non-replayable owned write); it is derived from committed
// provider events rather than trusted from provider metadata.
function resolveAssistantNotificationProviderNonReplayableWork(input: {
  input: AssistantNotificationInput
  rawEvents: readonly unknown[]
}): boolean {
  return isAssistantNotificationMaintenanceExactSkip(input.input) &&
    assistantMaintenanceRawEventsIncludeMutation(
      input.rawEvents,
      requireAssistantNotificationMaintenanceProfile(input.input),
    )
}

function assistantMaintenanceRawEventsIncludeMutation(
  rawEvents: readonly unknown[],
  profile: AssistantMaintenanceProfile,
): boolean {
  return rawEvents.some((rawEvent) => {
    const event = normalizeCodexEvent(rawEvent)
    if (
      profile === 'group-room-model' &&
      assistantGroupRoomModelDynamicMutationCompleted(event)
    ) {
      return true
    }
    return (
      event.kind === 'status_item' &&
      event.itemType === 'commandExecution' &&
      event.itemState === 'completed' &&
      event.exitCode === 0 &&
      isAssistantMaintenanceMutationCommand(event.commandLabel, profile)
    )
  })
}

function isAssistantMaintenanceMutationCommand(
  commandLabel: string | null,
  profile: AssistantMaintenanceProfile,
): boolean {
  const normalized = normalizeNullableString(commandLabel)
  if (normalized === null) {
    return false
  }
  if (profile === 'group-room-model') {
    return false
  }
  return profile === 'habitat-voice'
    ? /\bvault-cli\b[\s\S]*\bhabitat\s+save\b/u.test(normalized)
    : /\bvault-cli\b[\s\S]*\bmemory\s+(?:upsert|update)\b/u.test(normalized)
}

function assistantGroupRoomModelDynamicMutationCompleted(
  event: ReturnType<typeof normalizeCodexEvent>,
): boolean {
  if (
    event.kind !== 'tool_call' ||
    event.itemState !== 'completed' ||
    event.toolServer !== 'murph' ||
    event.toolName !== 'group_room_model'
  ) {
    return false
  }
  const record = readAssistantNotificationRecord(event.rawEvent)
  const item = readAssistantNotificationRecord(
    readAssistantNotificationRecord(record?.params)?.item,
  )
  const args = readAssistantNotificationRecord(item?.arguments)
  return (
    item?.success === true &&
    (args?.action === 'upsert' || args?.action === 'delete')
  )
}

function assertAssistantMaintenanceNotificationDecision(input: {
  decision: AssistantNotificationDecision
  policy: AssistantNotificationTurnPolicy | null | undefined
}): void {
  if (
    input.policy?.kind === 'maintenance-exact-skip' &&
    input.decision.kind === 'skip' &&
    input.decision.privateSummary === input.policy.privateSummary
  ) {
    return
  }

  throw new VaultCliError(
    'ASSISTANT_NOTIFICATION_MAINTENANCE_DECISION_INVALID',
    'Assistant maintenance notification must return the exact configured skip decision.',
  )
}

function throwIfAssistantNotificationAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return
  }

  const reason: unknown = signal.reason
  if (reason instanceof Error) {
    throw reason
  }

  throw new VaultCliError(
    'ASSISTANT_NOTIFICATION_ABORTED',
    'Assistant notification turn was aborted before outbound delivery.',
  )
}

function resolveAssistantNotificationFirstContactDocIds(input: {
  input: AssistantMessageInput
  session: AssistantSession
  sharedPlan: Awaited<ReturnType<typeof resolveAssistantTurnSharedPlan>>
}): string[] {
  const audience = input.sharedPlan.conversationPolicy.audience
  return resolveAssistantFirstContactStateDocIds({
    actorId: audience.actorId ?? input.session.binding.actorId,
    channel: audience.channel ?? input.session.binding.channel ?? input.input.channel ?? null,
    identityId: audience.identityId ?? input.session.binding.identityId ?? input.input.identityId ?? null,
    threadId: audience.threadId ?? input.session.binding.threadId ?? input.input.threadId ?? null,
    threadIsDirect:
      audience.threadIsDirect ?? input.session.binding.threadIsDirect ?? input.input.threadIsDirect ?? null,
  })
}

function assertAssistantNotificationSkipAllowed(
  policy: AssistantModelBackedNotificationResponsePolicy,
): void {
  if (policy.kind === 'allow_send_or_skip') {
    return
  }

  throw new VaultCliError(
    'ASSISTANT_NOTIFICATION_RESPONSE_REQUIRED',
    'Assistant notification turn skipped despite a required send policy.',
  )
}

export function resolveAssistantNotificationDeliverySubject(input: {
  bindingDelivery: AssistantSession['binding']['delivery']
  channel: string | null | undefined
  decisionSubject: string | null | undefined
  explicitTarget: string | null | undefined
  inputDeliverySubject: string | null | undefined
}): string | null {
  const configuredSubject = normalizeNullableString(input.inputDeliverySubject)
  const generatedSubject = normalizeNullableString(input.decisionSubject)
  const channel = normalizeNullableString(input.channel)
  if (
    configuredSubject === null &&
    generatedSubject !== null &&
    channel === 'email' &&
    selectedAssistantEmailDeliveryIsThreadReply({
      bindingDelivery: input.bindingDelivery,
      explicitTarget: input.explicitTarget,
    })
  ) {
    return null
  }

  return normalizeAssistantDeliverySubject({
    bindingDelivery: input.bindingDelivery ?? null,
    channel,
    explicitTarget: input.explicitTarget ?? null,
    subject:
      configuredSubject ??
      (channel === 'email' ? generatedSubject : null),
  })
}

export function parseAssistantNotificationDecision(
  value: string,
): AssistantNotificationDecision {
  const normalized = normalizeAssistantNotificationDecisionJson(value)

  try {
    return assistantNotificationDecisionSchema.parse(
      JSON.parse(normalized),
    )
  } catch (error) {
    const extracted = tryExtractAssistantNotificationDecisionObject(normalized)
    if (!extracted) {
      throw new VaultCliError(
        'ASSISTANT_NOTIFICATION_INVALID_RESPONSE',
        'Assistant notification turn must return a single valid JSON decision object.',
      )
    }

    try {
      return assistantNotificationDecisionSchema.parse(
        JSON.parse(extracted),
      )
    } catch {
      throw new VaultCliError(
        'ASSISTANT_NOTIFICATION_INVALID_RESPONSE',
        'Assistant notification turn returned an invalid decision object.',
      )
    }
  }
}

function resolveAssistantNotificationResponseMedia(input: {
  notificationPromptProfile: AssistantNotificationPromptProfile | null
  responseMedia: readonly AssistantResponseMedia[] | null | undefined
}): readonly AssistantResponseMedia[] {
  if (input.notificationPromptProfile !== 'creative-response') {
    return input.responseMedia ?? []
  }
  const media = normalizeAssistantResponseMediaList(input.responseMedia)
  if (media.length !== 1 || media[0]?.kind !== 'voice_memo') {
    throw new VaultCliError(
      'ASSISTANT_NOTIFICATION_INVALID_RESPONSE',
      'A song notification requires exactly one generated song attachment.',
    )
  }
  return media
}

function normalizeAssistantNotificationDecisionJson(value: string): string {
  const trimmed = value.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed)
  return fenced?.[1]?.trim() ?? trimmed
}

function tryExtractAssistantNotificationDecisionObject(
  value: string,
): string | null {
  const firstBrace = value.indexOf('{')
  const lastBrace = value.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return null
  }

  return value.slice(firstBrace, lastBrace + 1).trim()
}
