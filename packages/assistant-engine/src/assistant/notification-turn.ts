import * as z from 'zod'
import type {
  AssistantResponseMedia,
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import { createDefaultLocalAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { resolveAssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { createAssistantRuntimeStateService } from './runtime-state-service.js'
import { normalizeAssistantExecutionContext } from './execution-context.js'
import { resolveAssistantExecutionDefaultTarget } from './execution-context.js'
import { resolveAssistantExecutionOperatorDefaults } from './execution-context.js'
import { resolveAssistantSessionForMessage } from './session-resolution.js'
import { resolveAssistantTurnSharedPlan } from './turn-plan.js'
import {
  executeCodexTurnWithRecovery,
  type AssistantCodexTurnThreadScopeProfile,
} from './codex-turn-runner.js'
import {
  readCodexThreadRouteFingerprint,
  type CodexThreadIdentity,
} from './codex-thread-route.js'
import {
  recordAdditionalAssistantUsageEvents,
  recordAssistantUsageEvent,
} from './service-usage.js'
import {
  persistAssistantTurnAndSession,
} from './turn-finalizer.js'
import { resolveAssistantTurnRoute } from './service-turn-routes.js'
import { createAssistantTurnId } from './turns.js'
import {
  normalizeAssistantDeliverySubject,
  selectedAssistantEmailDeliveryIsThreadReply,
} from './channel-adapters.js'
import { withAssistantTurnLock } from './turn-lock.js'
import type {
  AssistantDeliveryOutcome,
  AssistantMessageInput,
  AssistantSessionResolutionFields,
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
import {
  startAssistantChannelTypingIndicator,
  stopAssistantChannelTypingIndicator,
} from './channel-typing.js'
import { normalizeAssistantDeliveryError } from './outbox.js'
import {
  normalizeNullableString,
  normalizeRequiredText,
  warnAssistantBestEffortFailure,
} from './shared.js'

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

const ASSISTANT_NOTIFICATION_TURN_PROFILE: Required<
  Omit<AssistantCodexTurnThreadScopeProfile, 'nativeResumePolicy'>
> = {
  promptProfile: 'notification-decision',
  threadScope: 'session-thread',
  toolProfile: 'notification-turn',
}

export type AssistantNotificationDecision = z.infer<
  typeof assistantNotificationDecisionSchema
>

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

export interface AssistantNotificationInput
  extends AssistantSessionResolutionFields,
    Pick<
      AssistantMessageInput,
      | 'abortSignal'
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
      | 'onTraceEvent'
      | 'operatorAuthority'
      | 'assistantTargetOverride'
      | 'serviceTier'
      | 'showThinkingTraces'
      | 'turnEnvironment'
      | 'turnTrigger'
      | 'workingDirectory'
    > {
  deliveryDedupeToken?: string | null
  firstContactPolicy?: AssistantNotificationFirstContactPolicy | null
  instructions: string
  responsePolicy?: AssistantNotificationResponsePolicy | null
}

export interface AssistantNotificationResult {
  decision: AssistantNotificationDecision
  deliveryOutcome?: AssistantDeliveryOutcome | null
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

  return withAssistantTurnLock({
    abortSignal: input.abortSignal,
    vault: input.vault,
    run: async () => {
      const messageInput = buildAssistantNotificationMessageInput(input)
      const resolved = await resolveAssistantSessionForMessage({
        boundaryDefaultTarget,
        defaults,
        message: messageInput,
      })
      await emitHostedAssistantContextSessionResolvedTrace({
        message: messageInput,
        resolved,
        source: 'assistant-notification',
      })
      const sharedPlan = await resolveAssistantTurnSharedPlan(messageInput, resolved)
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
        return {
          decision: {
            kind: 'skip',
            privateSummary: 'First-contact notification already accepted for this route.',
          },
          response: null,
          session: resolved.session,
        }
      }

      const responsePolicy: AssistantNotificationResponsePolicy =
        input.responsePolicy ?? { kind: 'allow_send_or_skip' }
      if (responsePolicy.kind === 'require_send_exact_text') {
        return await sendAssistantExactTextNotificationLocal({
          firstContactDocIds,
          input,
          messageInput,
          responseText: responsePolicy.text,
          session: resolved.session,
          sharedPlan,
        })
      }

      const route = resolveAssistantTurnRoute(messageInput, defaults, resolved)
      const turnId = createAssistantTurnId()
      const turnCreatedAt = new Date().toISOString()
      const progressDelivery = null
      const typingIndicator = startAssistantChannelTypingIndicator({
        channelDependencies:
          executionContext?.hosted?.channelTypingDependencies ?? null,
        input: messageInput,
        precedence: 'audience-first',
        session: resolved.session,
        sharedPlan,
      })

      try {
        const providerOutcome = await executeCodexTurnWithRecovery({
          allowFinishWithoutReply: false,
          input: messageInput,
          plan: sharedPlan,
          progressDelivery,
          profile: ASSISTANT_NOTIFICATION_TURN_PROFILE,
          resolvedSession: resolved.session,
          route,
          turnCreatedAt,
          turnId,
        })
        if (providerOutcome.kind === 'failed_terminal') {
          const failedProviderResult = {
            attemptCount: providerOutcome.attemptCount,
            provider: providerOutcome.route.provider,
            providerOptions: providerOutcome.route.providerOptions,
            route: providerOutcome.route,
            session: providerOutcome.session ?? resolved.session,
            usage: providerOutcome.usage,
            usageAttribution: providerOutcome.usageAttribution,
          }
          await recordAssistantUsageEvent({
            executionContext,
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
            buildAssistantNotificationObservabilityDetails({
              stage: 'provider',
              input: messageInput,
              route: providerOutcome.route,
              session: resolved.session,
            }),
          )
        }

        const providerResult = providerOutcome.providerTurn
        const selectedRoute = providerResult.route
        const providerResumeStateAction =
          normalizeNullableString(providerResult.codexThreadId)
            ? 'persist-from-provider-turn'
            : 'preserve-existing'
        await recordAssistantUsageEvent({
          executionContext,
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
        const decision = parseAssistantNotificationDecision(providerResult.response)

        if (decision.kind === 'skip') {
          assertAssistantNotificationSkipAllowed(responsePolicy)
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
          return {
            decision,
            response: null,
            session: savedSession,
          }
        }

        const responseText = normalizeRequiredText(decision.text, 'notification response')

        const state = createAssistantRuntimeStateService(input.vault)
        await state.turns.createReceipt({
          sessionId: providerResult.session.sessionId,
          provider: selectedRoute.provider,
          providerModel:
            selectedRoute.providerOptions.model
            ?? providerResult.session.providerOptions.model
            ?? null,
          prompt: messageInput.prompt,
          deliveryRequested: true,
          turnId,
        })

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
          media: providerResult.responseMedia ?? [],
          message: responseText,
          session: savedSession,
          sharedPlan,
          turnId,
        })
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

        return {
          decision: {
            ...decision,
            text: responseText,
          },
          deliveryOutcome,
          response: responseText,
          session: deliveryOutcome.session,
        }
      } finally {
        await stopAssistantChannelTypingIndicator(typingIndicator)
      }
    },
  })
}

async function sendAssistantExactTextNotificationLocal(input: {
  firstContactDocIds: readonly string[]
  input: AssistantNotificationInput
  messageInput: AssistantMessageInput
  responseText: string
  session: AssistantSession
  sharedPlan: Awaited<ReturnType<typeof resolveAssistantTurnSharedPlan>>
}): Promise<AssistantNotificationResult> {
  const responseText = normalizeRequiredText(
    input.responseText,
    'notification response',
  )
  const turnId = createAssistantTurnId()
  const turnCreatedAt = new Date().toISOString()
  const state = createAssistantRuntimeStateService(input.input.vault)

  await state.turns.createReceipt({
    deliveryRequested: true,
    metadata: {
      notificationMode: 'deterministic-exact-text',
    },
    prompt: input.messageInput.prompt,
    provider: input.session.provider,
    providerModel: input.session.providerOptions.model ?? null,
    sessionId: input.session.sessionId,
    startedAt: turnCreatedAt,
    turnId,
  })

  const deliveryOutcome = await deliverAssistantNotificationMessage({
    dedupeToken: input.input.deliveryDedupeToken ?? null,
    decisionSubject: null,
    input: input.messageInput,
    media: [],
    message: responseText,
    session: input.session,
    sharedPlan: input.sharedPlan,
    turnId,
  })
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

  const savedSession = await persistAssistantExactTextNotificationSession({
    responseText,
    session: deliveryOutcome.session,
    turnCreatedAt,
    vault: input.input.vault,
  })

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
      kind: 'send_message',
      privateSummary: 'Sent required exact notification text.',
      text: responseText,
    },
    deliveryOutcome: {
      ...deliveryOutcome,
      session: savedSession,
    },
    response: responseText,
    session: savedSession,
  }
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

type AssistantNotificationAnnotatedError = Error & {
  details?: Record<string, unknown>
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

  const wrapped = new Error(
    typeof error === 'string' && error.trim().length > 0
      ? error
      : 'Assistant notification execution failed.',
  ) as AssistantNotificationAnnotatedError
  wrapped.details = { ...details }
  return wrapped
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
): AssistantMessageInput {
  return {
    abortSignal: input.abortSignal,
    actorId: input.actorId,
    alias: input.alias,
    allowBindingRebind: input.allowBindingRebind,
    approvalPolicy: input.approvalPolicy,
    bindingDeliveryTarget: input.bindingDeliveryTarget,
    channel: input.channel,
    codexCommand: input.codexCommand,
    codexHome: input.codexHome,
    conversation: input.conversation,
    deliverResponse: true,
    deliveryDispatchMode: input.deliveryDispatchMode,
    deliveryKind: input.deliveryKind,
    deliveryIdempotencyKey: input.deliveryIdempotencyKey ?? null,
    deliveryReplyToMessageId: input.deliveryReplyToMessageId ?? null,
    deliverySource: input.deliverySource ?? null,
    deliverySubject: input.deliverySubject ?? null,
    deliveryTarget: input.deliveryTarget ?? null,
    executionContext: input.executionContext,
    hostedDeliveryIdempotency: input.hostedDeliveryIdempotency ?? null,
    identityId: input.identityId,
    includeEarlySessionOnboarding: false,
    maxSessionAgeMs: input.maxSessionAgeMs,
    model: input.model,
    modelProvider: input.modelProvider,
    oss: input.oss,
    onProviderEvent: input.onProviderEvent ?? null,
    onTraceEvent: input.onTraceEvent,
    operatorAuthority: input.operatorAuthority,
    participantId: input.participantId,
    persistUserPromptOnFailure: false,
    profile: input.profile,
    prompt: normalizeRequiredText(input.instructions, 'instructions'),
    provider: input.provider,
    receiptMetadata: null,
    reasoningEffort: input.reasoningEffort,
    sandbox: input.sandbox,
    serviceTier: input.serviceTier ?? null,
    sessionId: input.sessionId,
    showThinkingTraces: input.showThinkingTraces,
    threadId: input.threadId,
    threadIsDirect: input.threadIsDirect,
    turnEnvironment: input.turnEnvironment ?? null,
    assistantTargetOverride: input.assistantTargetOverride ?? null,
    turnTrigger: input.turnTrigger ?? 'automation-cron',
    userMessageContent: null,
    vault: input.vault,
    workingDirectory: input.workingDirectory,
  }
}

async function deliverAssistantNotificationMessage(input: {
  dedupeToken: string | null
  decisionSubject: string | null
  input: AssistantMessageInput
  media?: readonly AssistantResponseMedia[] | null
  message: string
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
    turnId: input.turnId,
    message: input.message,
    dedupeToken: input.dedupeToken,
    deliveryIdempotencyKey: hostedDelivery.deliveryIdempotencyKey,
    deliveryTransportIdempotent: hostedDelivery.deliveryTransportIdempotent,
    ...deliveryFields,
    media,
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
