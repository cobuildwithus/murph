import type {
  AssistantSession,
  AssistantTurnTrigger,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  resolveAssistantVoiceOptionElevenLabsVoiceId,
  type AssistantPersonalityPreferences,
  type AssistantTonePreference,
  normalizeIanaTimeZone,
  resolveSystemTimeZone,
  toLocalDayKey,
} from '@murphai/contracts'
import { loadVault, readPreferencesDocument } from '@murphai/core'
import {
  resolveCodexAssistantTargetCapabilities,
} from '../codex-runtime.js'
import {
  readAssistantCliSurfaceBootstrapContext,
  scopeAssistantCliSurfaceContractForAssistant,
} from '../cli-surface-bootstrap.js'
import {
  readAssistantContextSnapshotPrompt,
} from '../context-snapshot.js'
import {
  normalizeAssistantExecutionContext,
  type AssistantHostedDeviceConnectProvider,
} from '../execution-context.js'
import {
  readCodexThreadCompatibilityFingerprint,
  readCodexThreadRouteFingerprint,
  type CodexThreadIdentity,
} from '../codex-thread-route.js'
import {
  buildAssistantCodexContractFingerprint,
} from '../codex-contract-fingerprint.js'
import {
  resolveAssistantDiagnosticsPolicy,
  type AssistantDiagnosticsPolicy,
} from '../issue-reporting.js'
import { resolveAssistantModelBehaviorProfile } from '../model-behavior.js'
import {
  resolveAssistantCodexResumeThreadId,
  resolveAssistantRouteResumeBinding,
} from '../codex-resume-binding.js'
import {
  readAssistantCodexResume,
} from '../conversation-persistence.js'
import {
  listAssistantTranscriptEntries,
} from '../store.js'
import {
  ASSISTANT_NO_REPLY_TRANSCRIPT_HISTORY_TEXT,
  ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_PREFIX,
} from '../turn-finalizer.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
} from '../service-contracts.js'
import type {
  AssistantActiveTurnLiveProviderSteering,
} from '../turn-input.js'
import {
  resolveAssistantProductFeedbackAcceptedInputIds,
  type AssistantProgressDelivery,
} from '../turn-progress.js'
import type {
  AssistantHostedToolContext,
} from '../hosted-tool-context.js'
import {
  buildAssistantAskContinuationSystemPromptWithCacheMetadata,
  buildAssistantNotificationDecisionSystemPromptWithCacheMetadata,
  buildAssistantSystemPromptWithCacheMetadata,
  resolveAssistantMurphProductBaseUrl,
  type AssistantPromptCacheMetadata,
} from '../system-prompt.js'
import type {
  AssistantAcceptedTurnInputItemInput,
  AssistantCodexContinuation,
} from '../active-turn-input-journal.js'
import type {
  AssistantProviderConversationMessage,
  AssistantProviderFinishWithoutReplyAcceptedEvent,
} from '../providers/types.js'
import { normalizeNullableString } from '../shared.js'
import {
  resolveAssistantCurrentAudienceDeliveryFields,
} from '../delivery-service.js'
import {
  supportsAssistantAcceptedMessageTargetingRoute,
  type AssistantAcceptedMessageTargetAuthorizer,
} from '../message-target-selection.js'
import { resolveAssistantConversationScope } from '../conversation-policy.js'
import {
  resolveMurphDynamicTools,
  type MurphDynamicTool,
} from '../../assistant-codex/dynamic-tools.js'
import {
  resolveAssistantUserActionAcceptedInputIds,
} from '../../assistant-codex/dynamic-tools/phone-calls.js'
import {
  resolveAssistantVoiceMemoDeliveryChannel,
  type AssistantVoiceMemoDeliveryChannel,
} from '../voice-memo-delivery.js'

export interface AssistantRouteTurnPlan {
  assistantContractFingerprint: string
  assistantCliContract: string | null
  cliEnv: NodeJS.ProcessEnv
  developerInstructions: string | null
  dynamicTools: readonly MurphDynamicTool[]
  environments?: readonly Readonly<Record<string, unknown>>[]
  conversationHistoryMessages?: readonly AssistantProviderConversationMessage[]
  diagnosticsPolicy: AssistantDiagnosticsPolicy
  onboardingGuidanceInjected: boolean
  codexContinuation: AssistantCodexContinuation
  planningDiagnostics: AssistantRoutePlanningDiagnostics
  resume: AssistantRouteCodexResumePlan | null
  sessionContext?: {
    binding: AssistantSession['binding']
  }
  promptCacheMetadata: AssistantPromptCacheMetadata | null
  assistantPreferredElevenLabsVoiceId?: string | null
  systemPrompt: string | null
  turnContextPrompt: string | null
  voiceMemoDeliveryChannel?: AssistantVoiceMemoDeliveryChannel | null
  workingDirectory: string
}

export interface AssistantRoutePlanningDiagnostics {
  assistantContextSnapshotElapsedMs: number | null
  cliBootstrapElapsedMs: number | null
  dynamicToolCount: number
  messageTargetingAvailable: boolean
  primarySystemPromptElapsedMs: number | null
  messageTargetDynamicToolsAvailable: boolean
  routePlanningElapsedMs: number
  routePlanningMeasuredElapsedMs: number
  routePlanningSlowestStage: AssistantRoutePlanningStage | null
  routePlanningSlowestStageElapsedMs: number | null
  routePlanningUnaccountedElapsedMs: number
  routeResumeBindingElapsedMs: number | null
  routeTargetCapabilitiesElapsedMs: number | null
  shouldPrepareBootstrapContext: boolean
}

type AssistantRoutePlanningSpanKey =
  | 'assistantContextSnapshotElapsedMs'
  | 'cliBootstrapElapsedMs'
  | 'primarySystemPromptElapsedMs'
  | 'routeResumeBindingElapsedMs'
  | 'routeTargetCapabilitiesElapsedMs'

type AssistantRoutePlanningSpanMetrics = Partial<
  Record<AssistantRoutePlanningSpanKey, number>
>

export type AssistantRoutePlanningStage =
  | 'assistant_context_snapshot'
  | 'cli_bootstrap'
  | 'primary_instructions'
  | 'resume_binding'
  | 'target_capabilities'

const ASSISTANT_ROUTE_PLANNING_SPAN_STAGES: readonly {
  key: AssistantRoutePlanningSpanKey
  stage: AssistantRoutePlanningStage
}[] = [
  {
    key: 'assistantContextSnapshotElapsedMs',
    stage: 'assistant_context_snapshot',
  },
  {
    key: 'cliBootstrapElapsedMs',
    stage: 'cli_bootstrap',
  },
  {
    key: 'primarySystemPromptElapsedMs',
    stage: 'primary_instructions',
  },
  {
    key: 'routeResumeBindingElapsedMs',
    stage: 'resume_binding',
  },
  {
    key: 'routeTargetCapabilitiesElapsedMs',
    stage: 'target_capabilities',
  },
]
const ASSISTANT_ROUTE_COMMITTED_TRANSCRIPT_HISTORY_LIMIT = 24
const ASSISTANT_ROUTE_COMMITTED_TRANSCRIPT_HISTORY_MESSAGE_BYTES = 4_000
const ASSISTANT_ROUTE_COMMITTED_TRANSCRIPT_HISTORY_TOTAL_BYTES = 12_000
const assistantConversationHistoryTextEncoder = new TextEncoder()

export interface AssistantRouteCodexResumePlan {
  codexThreadId: string
}

export interface AssistantPromptCapabilityAvailability {
  assistantHostedDeviceConnectAvailable: boolean
  assistantHostedDeviceConnectProviders: readonly AssistantHostedDeviceConnectProvider[]
  assistantKnowledgeToolsAvailable: boolean
}

export interface AssistantPromptTimeContext {
  currentLocalDate: string
  currentTimeZone: string
}

export type AssistantCodexTurnPromptProfile =
  | 'conversation'
  | 'notification-decision'
  | 'assistant-ask-continuation'

export type AssistantCodexTurnToolProfile =
  | 'provider-turn'
  | 'notification-turn'
  | 'maintenance-turn'
  | 'internal-turn'
  | 'output-only-turn'

export type AssistantCodexThreadScope =
  | 'session-thread'
  | 'isolated-thread'

export type AssistantCodexTurnNativeResumePolicy =
  | 'default'
  | 'disabled'

export interface AssistantCodexTurnExecutionProfile {
  nativeResumePolicy?: AssistantCodexTurnNativeResumePolicy
  promptProfile?: AssistantCodexTurnPromptProfile
  threadScope?: AssistantCodexThreadScope
  toolProfile?: AssistantCodexTurnToolProfile
}

export interface AssistantCodexTurnThreadScopeProfile
  extends AssistantCodexTurnExecutionProfile {}

export type AssistantCodexTurnResolvedExecutionProfile =
  Required<Omit<AssistantCodexTurnExecutionProfile, 'nativeResumePolicy'>>

export interface AssistantCodexTurnExecutionPlan {
  acceptedInputItems?: readonly AssistantAcceptedTurnInputItemInput[] | null
  activeTurnSteering: AssistantActiveTurnLiveProviderSteering | null
  allowFinishWithoutReply?: boolean | null
  authorizeAcceptedMessageTarget?: AssistantAcceptedMessageTargetAuthorizer | null
  executionContext: ReturnType<typeof normalizeAssistantExecutionContext>
  input: AssistantMessageInput
  onFinishWithoutReplyAccepted?: ((
    event: AssistantProviderFinishWithoutReplyAcceptedEvent
  ) => Promise<void> | void) | null
  onFinishWithoutReplyRecorded?: ((event: {
    deliveryContextOrdinal: number
  }) => Promise<void> | void) | null
  profile: AssistantCodexTurnResolvedExecutionProfile
  preferenceContext?: AssistantTurnPreferenceContext
  promptTimeContext: AssistantPromptTimeContext
  route: CodexThreadIdentity
  sharedPlan: AssistantTurnSharedPlan
  progressDelivery?: AssistantProgressDelivery | null
  hostedToolContext?: AssistantHostedToolContext | null
  turnId: string
}

export interface AssistantCodexAttemptPlan {
  attemptCount: number
  route: CodexThreadIdentity
  routePlan: AssistantRouteTurnPlan
  session: AssistantSession
}

export interface AssistantTurnPreferenceContext {
  assistantPersonality: AssistantPersonalityPreferences | null
  assistantTone: AssistantTonePreference | null
  assistantVoice: string | null
}

const DEFAULT_ASSISTANT_TURN_PREFERENCE_CONTEXT: AssistantTurnPreferenceContext = {
  assistantPersonality: null,
  assistantTone: null,
  assistantVoice: null,
}

function resolveAssistantCodexTurnExecutionProfile(
  input: {
    profile: AssistantCodexTurnThreadScopeProfile | null | undefined
    turnTrigger: AssistantTurnTrigger | null | undefined
  },
): AssistantCodexTurnResolvedExecutionProfile {
  const threadScope = resolveAssistantCodexThreadScope({
    profile: input.profile,
    turnTrigger: input.turnTrigger,
  })

  return {
    promptProfile: input.profile?.promptProfile ?? 'conversation',
    threadScope,
    toolProfile: input.profile?.toolProfile ?? 'provider-turn',
  }
}

export function resolveAssistantCodexThreadScope(input: {
  profile?: AssistantCodexTurnThreadScopeProfile | null
  turnTrigger?: AssistantTurnTrigger | null
}): AssistantCodexThreadScope {
  if (
    input.profile?.threadScope === 'isolated-thread' ||
    input.profile?.nativeResumePolicy === 'disabled'
  ) {
    return 'isolated-thread'
  }

  if (input.profile?.threadScope === 'session-thread') {
    return 'session-thread'
  }

  if (input.turnTrigger === 'automation-cron') {
    return 'isolated-thread'
  }

  if (input.profile?.promptProfile === 'notification-decision') {
    return 'isolated-thread'
  }

  return 'session-thread'
}

export async function buildCodexTurnExecutionPlan(input: {
  acceptedInputItems?: readonly AssistantAcceptedTurnInputItemInput[] | null
  activeTurnSteering?: AssistantActiveTurnLiveProviderSteering | null
  allowFinishWithoutReply?: boolean | null
  authorizeAcceptedMessageTarget?: AssistantAcceptedMessageTargetAuthorizer | null
  input: AssistantMessageInput
  onFinishWithoutReplyAccepted?: ((
    event: AssistantProviderFinishWithoutReplyAcceptedEvent
  ) => Promise<void> | void) | null
  onFinishWithoutReplyRecorded?: ((event: {
    deliveryContextOrdinal: number
  }) => Promise<void> | void) | null
  plan: AssistantTurnSharedPlan
  profile?: AssistantCodexTurnThreadScopeProfile | null
  resolvedSession: AssistantSession
  route: CodexThreadIdentity
  progressDelivery?: AssistantProgressDelivery | null
  hostedToolContext?: AssistantHostedToolContext | null
  turnCreatedAt: string
  turnId: string
}): Promise<AssistantCodexTurnExecutionPlan> {
  const executionContext = normalizeAssistantExecutionContext(input.input.executionContext)
  const profile = resolveAssistantCodexTurnExecutionProfile({
    profile: input.profile,
    turnTrigger: input.input.turnTrigger,
  })
  const promptTimeContext = await resolveAssistantPromptTimeContext(input.input.vault)
  const preferenceContext = await resolveAssistantTurnPreferenceContext(input.input.vault)

  return {
    acceptedInputItems: input.acceptedInputItems ?? [],
    activeTurnSteering: input.activeTurnSteering ?? null,
    allowFinishWithoutReply:
      input.allowFinishWithoutReply ?? profile.toolProfile === 'provider-turn',
    authorizeAcceptedMessageTarget:
      input.authorizeAcceptedMessageTarget ?? null,
    executionContext,
    input: input.input,
    onFinishWithoutReplyAccepted: input.onFinishWithoutReplyAccepted ?? null,
    onFinishWithoutReplyRecorded: input.onFinishWithoutReplyRecorded ?? null,
    profile,
    preferenceContext,
    promptTimeContext,
    route: input.route,
    sharedPlan: input.plan,
    progressDelivery: input.progressDelivery ?? null,
    hostedToolContext: input.hostedToolContext ?? null,
    turnId: input.turnId,
  }
}

export async function buildCodexTurnAttemptPlan(input: {
  attemptCount: number
  executionPlan: AssistantCodexTurnExecutionPlan
  session: AssistantSession
}): Promise<AssistantCodexAttemptPlan> {
  const route = input.executionPlan.route
  return {
    attemptCount: input.attemptCount,
    route,
    routePlan: await resolveAssistantRouteTurnPlan({
      acceptedInputItems: input.executionPlan.acceptedInputItems,
      allowFinishWithoutReply: input.executionPlan.allowFinishWithoutReply,
      executionContext: input.executionPlan.executionContext,
      input: input.executionPlan.input,
      profile: input.executionPlan.profile,
      preferenceContext:
        input.executionPlan.preferenceContext ??
        DEFAULT_ASSISTANT_TURN_PREFERENCE_CONTEXT,
      promptTimeContext: input.executionPlan.promptTimeContext,
      route,
      session: input.session,
      sharedPlan: input.executionPlan.sharedPlan,
      progressDelivery: input.executionPlan.progressDelivery ?? null,
      hostedToolContext: input.executionPlan.hostedToolContext ?? null,
      messageTargetAuthorizerAvailable:
        input.executionPlan.authorizeAcceptedMessageTarget != null,
    }),
    session: input.session,
  }
}

export async function resolveAssistantRouteTurnPlan(input: {
  acceptedInputItems?: readonly AssistantAcceptedTurnInputItemInput[] | null
  allowFinishWithoutReply?: boolean | null
  executionContext: ReturnType<typeof normalizeAssistantExecutionContext> | null
  input: AssistantMessageInput
  profile: AssistantCodexTurnResolvedExecutionProfile
  preferenceContext?: AssistantTurnPreferenceContext
  promptTimeContext: AssistantPromptTimeContext
  route: CodexThreadIdentity
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
  progressDelivery?: AssistantProgressDelivery | null
  hostedToolContext?: AssistantHostedToolContext | null
  messageTargetAuthorizerAvailable?: boolean | null
}): Promise<AssistantRouteTurnPlan> {
  const routePlanningStartedAt = Date.now()
  const preferenceContext =
    input.preferenceContext ?? DEFAULT_ASSISTANT_TURN_PREFERENCE_CONTEXT
  const routePlanningSpans: AssistantRoutePlanningSpanMetrics = {}
  const workingDirectory = input.sharedPlan.requestedWorkingDirectory
  const resumeBinding = measureRoutePlanningSync(
    routePlanningSpans,
    'routeResumeBindingElapsedMs',
    () => resolveAssistantRouteResumeBinding({
      route: input.route,
      sessionResumeState: readAssistantCodexResume(input.session),
    }),
  )
  const routeProviderCapabilities = measureRoutePlanningSync(
    routePlanningSpans,
    'routeTargetCapabilitiesElapsedMs',
    () => resolveCodexAssistantTargetCapabilities({
      ...input.route.providerOptions,
    }),
  )
  const routeFingerprint = readCodexThreadRouteFingerprint(input.route)
  const resolvedChannel = input.input.channel ?? input.session.binding.channel
  const audience = input.sharedPlan.conversationPolicy.audience
  const conversationScope = resolveAssistantConversationScope(audience)
  if (conversationScope === 'unverified-external') {
    throw new Error(
      'Cannot plan a provider turn for an unverified external audience.',
    )
  }
  const privateInteractiveAudience = conversationScope === 'direct'
  const hostedGroupRuntime =
    conversationScope === 'group' && input.executionContext?.hosted != null
  const hostedGroupStyleSettingsAvailable =
    hostedGroupRuntime &&
    resolvedChannel?.trim().toLowerCase() === 'linq' &&
    input.hostedToolContext?.personalizationTool != null &&
    input.input.assistantStyleSettingsAuthorized !== false
  const outputOnlyTurn = input.profile.toolProfile === 'output-only-turn'
  const privateInteractiveProviderTurn =
    privateInteractiveAudience &&
    input.profile.promptProfile === 'conversation' &&
    input.profile.toolProfile === 'provider-turn'
  const shouldUseCommittedTranscriptHistory =
    input.profile.threadScope === 'session-thread' || outputOnlyTurn
  const resolveCommittedTranscriptHistoryMessages = async () =>
    shouldUseCommittedTranscriptHistory
      ? await resolveAssistantCommittedTranscriptHistoryMessages({
          currentUserPrompt: input.input.prompt,
          sessionId: input.session.sessionId,
          vault: input.input.vault,
        })
      : []
  const assistantStyleSettingsAvailable =
    (
      (
        privateInteractiveAudience &&
        input.input.assistantStyleSettingsAuthorized !== false &&
        (
          resolvedChannel !== 'email'
          || input.input.assistantStyleSettingsAuthorized === true
        )
      )
      || hostedGroupStyleSettingsAvailable
    ) &&
    input.profile.promptProfile === 'conversation' &&
    input.profile.toolProfile === 'provider-turn'
  const groupAssistantStylePreferencesApply =
    hostedGroupRuntime &&
    input.profile.promptProfile === 'conversation' &&
    input.profile.toolProfile === 'provider-turn'
  const assistantVoicePreferenceApplies =
    privateInteractiveAudience || hostedGroupRuntime
  const diagnosticsPolicy = resolveAssistantDiagnosticsPolicy({
    channel: resolvedChannel,
    executionContext: input.input.executionContext,
  })
  const shouldInjectOnboardingGuidance =
    input.profile.promptProfile === 'conversation' &&
    input.sharedPlan.onboardingGuidanceOpen &&
    privateInteractiveAudience
  const assistantToolNameAliases = null
  // Maintenance turns consume only the engine-supplied conversation evidence
  // plus canonical memory; the context snapshot (which carries health
  // domains) and hosted dynamic context prompts must not reach their system
  // prompt, or the prompt itself would hand the model forbidden sources.
  const maintenanceTurn = input.profile.toolProfile === 'maintenance-turn'
  const internalTurn = input.profile.toolProfile === 'internal-turn'
  const hostedDynamicContextPrompts =
    maintenanceTurn || internalTurn || outputOnlyTurn
      ? []
      : input.executionContext?.hosted?.dynamicContextPrompts ?? []
  const promptCapabilityAvailability = resolveAssistantPromptCapabilityAvailability({
    executionContext: input.executionContext,
  })
  const voiceMemoDeliveryChannel = outputOnlyTurn || internalTurn
    ? null
    : resolveAssistantVoiceMemoDeliveryChannel({
        messageInput: input.input,
        session: input.session,
        sharedPlan: input.sharedPlan,
      })
  const shouldPrepareConversationThreadInstructions =
    input.profile.promptProfile === 'conversation' && privateInteractiveAudience
  let cliBootstrapElapsedMs: number | null = null
  const unscopedAssistantCliContract = shouldPrepareConversationThreadInstructions
    ? await measureRoutePlanningAsync(
        routePlanningSpans,
        'cliBootstrapElapsedMs',
        () => readAssistantCliSurfaceBootstrapContext(),
        (elapsedMs) => {
          cliBootstrapElapsedMs = elapsedMs
        },
      )
    : null
  const bootstrapAssistantCliContract = scopeAssistantCliSurfaceContractForAssistant({
    contract: unscopedAssistantCliContract,
    hostedRuntime: input.executionContext?.hosted != null,
  })
  let assistantContextSnapshotElapsedMs: number | null = null
  const assistantContextSnapshotPrompt =
    maintenanceTurn || internalTurn || !privateInteractiveAudience
      ? null
      : await measureRoutePlanningAsync(
        routePlanningSpans,
        'assistantContextSnapshotElapsedMs',
        () => readAssistantContextSnapshotPrompt({
          vaultRoot: input.input.vault,
        }),
        (elapsedMs) => {
          assistantContextSnapshotElapsedMs = elapsedMs
        },
      )
  const modelBehaviorProfile = resolveAssistantModelBehaviorProfile(
    input.route.providerOptions,
  )
  const toolSchemaHash = null
  const buildRouteSystemPromptResult = (options: {
    assistantCliContract: string | null
    injectOnboardingGuidance: boolean
  }) => {
    if (input.profile.promptProfile === 'assistant-ask-continuation') {
      return buildAssistantAskContinuationSystemPromptWithCacheMetadata({
        assistantContextSnapshotPrompt,
      }, {
        toolSchemaHash,
      })
    }

    return input.profile.promptProfile === 'notification-decision'
      ? buildAssistantNotificationDecisionSystemPromptWithCacheMetadata({
            assistantContextSnapshotPrompt,
            assistantDynamicContextPrompts: hostedDynamicContextPrompts,
            internalTurn,
            maintenanceTurn,
            assistantHostedDeviceConnectAvailable:
              privateInteractiveAudience &&
              promptCapabilityAvailability.assistantHostedDeviceConnectAvailable,
            assistantHostedDeviceConnectProviders:
              promptCapabilityAvailability.assistantHostedDeviceConnectProviders,
            assistantToolNameAliases,
            assistantTone: preferenceContext.assistantTone,
            channel: resolvedChannel,
            currentLocalDate: input.promptTimeContext.currentLocalDate,
            currentTimeZone: input.promptTimeContext.currentTimeZone,
            conversationScope,
            hostedRuntime: input.executionContext?.hosted != null,
            scheduledOccurrenceAt: input.input.scheduledOccurrenceAt ?? null,
          }, {
            toolSchemaHash,
          })
      : buildAssistantSystemPromptWithCacheMetadata({
            assistantCliContract: options.assistantCliContract,
            assistantContextSnapshotPrompt,
            assistantDynamicContextPrompts: hostedDynamicContextPrompts,
            assistantHostedAutomationAvailable:
              input.hostedToolContext?.automationTool != null,
            assistantHostedDeviceConnectAvailable:
              privateInteractiveAudience &&
              promptCapabilityAvailability.assistantHostedDeviceConnectAvailable,
            assistantHostedDeviceConnectProviders:
              promptCapabilityAvailability.assistantHostedDeviceConnectProviders,
            assistantHostedLabsAvailable:
              privateInteractiveProviderTurn &&
              input.hostedToolContext?.labsTool != null,
            assistantKnowledgeToolsAvailable:
              promptCapabilityAvailability.assistantKnowledgeToolsAvailable,
            assistantToolNameAliases,
            assistantPersonality:
              assistantStyleSettingsAvailable || groupAssistantStylePreferencesApply
                ? preferenceContext.assistantPersonality
                : null,
            assistantStyleSettingsAvailable,
            assistantTone: preferenceContext.assistantTone,
            cliAccess: input.sharedPlan.cliAccess,
            channel: resolvedChannel,
            currentLocalDate: input.promptTimeContext.currentLocalDate,
            currentTimeZone: input.promptTimeContext.currentTimeZone,
            conversationScope,
            hostedRuntime: input.executionContext?.hosted != null,
            murphProductBaseUrl: resolveAssistantMurphProductBaseUrl(
              input.sharedPlan.cliAccess.env,
            ),
            onboardingGuidance: options.injectOnboardingGuidance,
            modelBehaviorProfile,
            turnTrigger: input.input.turnTrigger ?? null,
          }, {
            toolSchemaHash,
          })
  }
  const buildDeveloperInstructions = (
    promptResult: ReturnType<typeof buildAssistantSystemPromptWithCacheMetadata>,
  ) =>
    [
      promptResult.layers.staticCacheableCorePrompt,
      promptResult.layers.stableRouteCapabilityPrompt,
      promptResult.layers.threadContextPrompt,
    ]
      .filter((section): section is string =>
        Boolean(normalizeNullableString(section)),
      )
      .join('\n\n')
  const threadStartPromptResult = measureRoutePlanningSync(
    routePlanningSpans,
    'primarySystemPromptElapsedMs',
    () => buildRouteSystemPromptResult({
      assistantCliContract: bootstrapAssistantCliContract,
      injectOnboardingGuidance: shouldInjectOnboardingGuidance,
    }),
  )
  const threadStartDeveloperInstructions = normalizeNullableString(
    buildDeveloperInstructions(threadStartPromptResult),
  )
  const currentAudienceDeliveryFields =
    resolveAssistantCurrentAudienceDeliveryFields({
      input: input.input,
      session: input.session,
      sharedPlan: input.sharedPlan,
    })
  const messageTargetingAvailable =
    input.messageTargetAuthorizerAvailable === true &&
    supportsAssistantAcceptedMessageTargetingRoute({
      channel: currentAudienceDeliveryFields.channel,
      explicitTarget: currentAudienceDeliveryFields.explicitTarget,
      threadId: currentAudienceDeliveryFields.threadId,
      threadIsDirect: currentAudienceDeliveryFields.threadIsDirect,
    })
  const productFeedbackAcceptedInputIds =
    resolveAssistantProductFeedbackAcceptedInputIds(input.acceptedInputItems ?? [])
  const userActionAcceptedInputIds = resolveAssistantUserActionAcceptedInputIds({
    acceptedInputItems: input.acceptedInputItems ?? [],
    turnTrigger: input.input.turnTrigger ?? null,
  })
  const allowFinishWithoutReply =
    input.allowFinishWithoutReply ?? input.profile.toolProfile === 'provider-turn'
  // Maintenance turns run without a delivery target and must not expose any
  // external-capable or delivery-facing tool surface, so the gate is the
  // resolved tool set itself rather than prompt text.
  const dynamicTools = maintenanceTurn || outputOnlyTurn
    ? []
    : resolveMurphDynamicTools({
        assistantStyleSettingsAvailable: internalTurn
          ? false
          : assistantStyleSettingsAvailable,
        allowFinishWithoutReply,
        messageTargetingAvailable:
          !internalTurn && messageTargetingAvailable,
        assistantConfigurationAvailable:
          !internalTurn &&
          privateInteractiveAudience &&
          input.hostedToolContext?.assistantConfigurationTool != null,
        automationAvailable:
          !internalTurn && input.hostedToolContext?.automationTool != null,
        computerToolsAvailable:
          !internalTurn &&
          privateInteractiveAudience &&
          input.hostedToolContext?.computerToolsAvailable === true,
        progressUpdatesAvailable:
          !internalTurn && input.progressDelivery != null,
        connectedAppsAvailable:
          !internalTurn && input.hostedToolContext?.connectedApps != null,
        connectedAppsManageAvailable: !internalTurn && privateInteractiveAudience,
        deviceAvailable:
          !internalTurn &&
          privateInteractiveAudience &&
          input.hostedToolContext?.deviceTool != null,
        clinicalRecordsConnectLinkAvailable:
          !internalTurn &&
          privateInteractiveAudience &&
          userActionAcceptedInputIds.length > 0 &&
          input.hostedToolContext?.clinicalRecordsConnectLinkTool != null,
        familyPlanAvailable:
          !internalTurn &&
          privateInteractiveAudience &&
          input.hostedToolContext?.familyPlanTool != null,
        labsAvailable:
          !internalTurn &&
          privateInteractiveProviderTurn &&
          input.hostedToolContext?.labsTool != null,
        planUsageAvailable:
          !internalTurn &&
          privateInteractiveAudience &&
          input.hostedToolContext?.planUsageTool != null,
        subscriptionAvailable:
          !internalTurn &&
          privateInteractiveAudience &&
          userActionAcceptedInputIds.length > 0 &&
          input.hostedToolContext?.subscriptionTool != null,
        groupAvailable: input.hostedToolContext?.groupTool != null,
        newsletterAvailable:
          !internalTurn && input.hostedToolContext?.newsletterTool != null,
        personalizationAvailable:
          !internalTurn &&
          assistantStyleSettingsAvailable &&
          input.hostedToolContext?.personalizationTool != null,
        productFeedbackAvailable:
          !internalTurn &&
          productFeedbackAcceptedInputIds.length > 0 &&
          typeof input.executionContext?.hosted?.productFeedbackRecorder?.recordProductFeedback === 'function',
        phoneCallsAvailable:
          !internalTurn &&
          privateInteractiveAudience &&
          userActionAcceptedInputIds.length > 0 &&
          input.hostedToolContext?.phoneCalls != null,
        voiceMemoGenerationAvailable:
          !internalTurn && voiceMemoDeliveryChannel !== null,
        vaultFileSendAvailable:
          !internalTurn &&
          privateInteractiveAudience &&
          input.hostedToolContext?.vaultFileSendAvailable === true,
      })
        // Layered isolation for the internal scheduled turn: every capability
        // above is already gated off by `!internalTurn`, and this final filter
        // is a redundant backstop that hard-limits the surface to `group`. The
        // group adapter then independently restricts actions to read_current /
        // ask_member when the invocation origin is an automation occurrence.
        .filter((tool) => !internalTurn || tool.name === 'group')
  const messageTargetDynamicToolsAvailable =
    dynamicTools.some(
      (tool) => tool.namespace === 'murph' && tool.name === 'select_reply_target',
    ) &&
    dynamicTools.some(
      (tool) => tool.namespace === 'murph' && tool.name === 'react_to_message',
    )
  const assistantContractFingerprint = buildAssistantCodexContractFingerprint({
    developerInstructions: threadStartDeveloperInstructions,
    dynamicTools,
    routeFingerprint: readCodexThreadCompatibilityFingerprint(input.route),
  })
  const storedAssistantContractFingerprint = normalizeNullableString(
    resumeBinding?.assistantContractFingerprint,
  )
  const assistantContractMatches =
    storedAssistantContractFingerprint === assistantContractFingerprint ||
    (
      resumeBinding !== null &&
      storedAssistantContractFingerprint === buildAssistantCodexContractFingerprint({
        developerInstructions: threadStartDeveloperInstructions,
        dynamicTools,
        routeFingerprint: resumeBinding.routeFingerprint,
      })
    )
  const nativeResumeEnabled =
    input.profile.threadScope === 'session-thread'
  const candidateResumeCodexThreadId =
    nativeResumeEnabled &&
    routeProviderCapabilities.supportsNativeResume &&
    resumeBinding !== null &&
    assistantContractMatches
      ? resolveAssistantEffectiveCodexResumeThreadId({
          resumeCodexThreadId: resolveAssistantCodexResumeThreadId({
            resumeState: resumeBinding,
          }),
        })
      : null
  const resumeCodexThreadId = candidateResumeCodexThreadId
  const conversationHistoryMessages = resumeCodexThreadId === null
    ? await resolveCommittedTranscriptHistoryMessages()
    : []
  const shouldInjectBootstrapContext = resumeCodexThreadId === null
  const shouldPrepareBootstrapContext = shouldInjectBootstrapContext
  const actualAssistantCliContract = shouldPrepareBootstrapContext
    ? bootstrapAssistantCliContract
    : null
  const turnContextPrompt = normalizeNullableString(
    [
      normalizeNullableString(
        threadStartPromptResult.layers.dynamicTurnContextPrompt,
      ),
      normalizeNullableString(input.input.turnContext),
    ].filter((section): section is string => section !== null).join('\n\n'),
  )
  const resume = resumeCodexThreadId !== null
    ? {
        codexThreadId: resumeCodexThreadId,
      }
    : null
  const systemPromptResult = threadStartPromptResult
  const systemPrompt = systemPromptResult.prompt
  const developerInstructions =
    resumeCodexThreadId === null
      ? threadStartDeveloperInstructions
      : null
  const routePlanningElapsedMs = elapsedSince(routePlanningStartedAt)
  const routePlanningMeasuredElapsedMs = sumRoutePlanningSpanMetrics(
    routePlanningSpans,
  )
  const routePlanningUnaccountedElapsedMs = Math.max(
    0,
    routePlanningElapsedMs - routePlanningMeasuredElapsedMs,
  )
  const routePlanningSlowestSpan =
    resolveRoutePlanningSlowestSpan(routePlanningSpans)

  return {
    assistantContractFingerprint,
    assistantCliContract: actualAssistantCliContract,
    cliEnv: {
      ...input.sharedPlan.cliAccess.env,
    },
    developerInstructions: normalizeNullableString(developerInstructions),
    dynamicTools,
    environments: outputOnlyTurn ? [] : undefined,
    conversationHistoryMessages:
      conversationHistoryMessages.length > 0
        ? conversationHistoryMessages
        : undefined,
    diagnosticsPolicy,
    onboardingGuidanceInjected: shouldInjectOnboardingGuidance,
    codexContinuation: resolveAssistantCodexContinuation({
      resumeCodexThreadId,
    }),
    planningDiagnostics: {
      assistantContextSnapshotElapsedMs,
      cliBootstrapElapsedMs,
      dynamicToolCount: dynamicTools.length,
      messageTargetingAvailable,
      primarySystemPromptElapsedMs:
        routePlanningSpans.primarySystemPromptElapsedMs ?? null,
      messageTargetDynamicToolsAvailable,
      routePlanningElapsedMs,
      routePlanningMeasuredElapsedMs,
      routePlanningSlowestStage: routePlanningSlowestSpan?.stage ?? null,
      routePlanningSlowestStageElapsedMs:
        routePlanningSlowestSpan?.elapsedMs ?? null,
      routePlanningUnaccountedElapsedMs,
      routeResumeBindingElapsedMs:
        routePlanningSpans.routeResumeBindingElapsedMs ?? null,
      routeTargetCapabilitiesElapsedMs:
        routePlanningSpans.routeTargetCapabilitiesElapsedMs ?? null,
      shouldPrepareBootstrapContext,
    },
    resume,
    sessionContext:
      shouldPrepareBootstrapContext &&
      !maintenanceTurn &&
      !internalTurn &&
      !outputOnlyTurn
      ? {
          binding: input.session.binding,
        }
      : undefined,
    promptCacheMetadata: systemPromptResult.cacheMetadata,
    assistantPreferredElevenLabsVoiceId:
      assistantVoicePreferenceApplies
        ? resolveAssistantVoiceOptionElevenLabsVoiceId(
            preferenceContext.assistantVoice,
          )
        : null,
    voiceMemoDeliveryChannel,
    workingDirectory,
    systemPrompt,
    turnContextPrompt,
  }
}

async function resolveAssistantCommittedTranscriptHistoryMessages(input: {
  currentUserPrompt: string
  sessionId: string
  vault: string
}): Promise<readonly AssistantProviderConversationMessage[]> {
  let entries: Awaited<ReturnType<typeof listAssistantTranscriptEntries>>
  try {
    entries = await listAssistantTranscriptEntries(input.vault, input.sessionId)
  } catch {
    return []
  }

  type TranscriptHistoryCandidate = {
    message: AssistantProviderConversationMessage
    userPromptKey: string | null
  }

  const messages = entries.flatMap((entry): TranscriptHistoryCandidate[] => {
    if (
      entry.kind === 'status' &&
      entry.text.startsWith(ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_PREFIX)
    ) {
      return [{
        message: {
          content: ASSISTANT_NO_REPLY_TRANSCRIPT_HISTORY_TEXT,
          role: 'assistant',
        },
        userPromptKey: null,
      }]
    }
    if (entry.kind !== 'assistant' && entry.kind !== 'user') {
      return []
    }
    const rawContent = normalizeNullableString(entry.text)
    const content = limitAssistantConversationHistoryTextBytes(
      rawContent,
      ASSISTANT_ROUTE_COMMITTED_TRANSCRIPT_HISTORY_MESSAGE_BYTES,
    )
    return content
      ? [{
          message: {
            content,
            role: entry.kind,
          },
          userPromptKey: entry.kind === 'user' && rawContent
            ? normalizeAssistantConversationHistoryText(rawContent)
            : null,
        }]
      : []
  })

  const currentPromptKey = normalizeAssistantConversationHistoryText(input.currentUserPrompt)

  while (messages.length > 0) {
    const lastMessage = messages[messages.length - 1]
    if (
      !lastMessage ||
      lastMessage.message.role !== 'user' ||
      typeof lastMessage.message.content !== 'string'
    ) {
      break
    }
    const lastUserPromptKey =
      lastMessage.userPromptKey ??
      normalizeAssistantConversationHistoryText(lastMessage.message.content)
    if (!lastUserPromptKey || shouldDropTrailingCurrentUserPrompt({
      currentPromptKey,
      lastUserPromptKey,
    })) {
      messages.pop()
      continue
    }
    break
  }

  return limitAssistantConversationHistoryMessages(
    messages.map(({ message }) => message),
  )
}

function normalizeAssistantConversationHistoryText(value: string): string | null {
  const normalized = normalizeNullableString(value)
  return normalized?.replace(/\s+/gu, ' ') ?? null
}

function shouldDropTrailingCurrentUserPrompt(input: {
  currentPromptKey: string | null
  lastUserPromptKey: string
}): boolean {
  if (!input.currentPromptKey) {
    return false
  }
  if (input.lastUserPromptKey === input.currentPromptKey) {
    return true
  }
  return (
    input.lastUserPromptKey.length >= 32 &&
    input.currentPromptKey.includes(input.lastUserPromptKey)
  )
}

function limitAssistantConversationHistoryMessages(
  messages: readonly AssistantProviderConversationMessage[],
): AssistantProviderConversationMessage[] {
  const countLimited = messages.slice(-ASSISTANT_ROUTE_COMMITTED_TRANSCRIPT_HISTORY_LIMIT)
  const retained: AssistantProviderConversationMessage[] = []
  let retainedBytes = 0

  for (const message of [...countLimited].reverse()) {
    if (typeof message.content !== 'string') {
      continue
    }
    const messageBytes = assistantConversationHistoryUtf8Bytes(message.content)
    if (messageBytes === 0) {
      continue
    }
    if (
      retainedBytes + messageBytes >
      ASSISTANT_ROUTE_COMMITTED_TRANSCRIPT_HISTORY_TOTAL_BYTES
    ) {
      break
    }
    retained.push(message)
    retainedBytes += messageBytes
  }

  return retained.reverse()
}

export function limitAssistantConversationHistoryTextBytes(
  value: string | null,
  maxBytes: number,
): string | null {
  if (!value) {
    return null
  }
  if (assistantConversationHistoryUtf8Bytes(value) <= maxBytes) {
    return value
  }

  const codePoints = Array.from(value)
  let low = 0
  let high = codePoints.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const candidate = codePoints.slice(0, mid).join('').trimEnd()
    if (assistantConversationHistoryUtf8Bytes(candidate) <= maxBytes) {
      low = mid
    } else {
      high = mid - 1
    }
  }

  return normalizeNullableString(codePoints.slice(0, low).join('').trimEnd())
}

export function assistantConversationHistoryUtf8Bytes(value: string): number {
  return assistantConversationHistoryTextEncoder.encode(value).byteLength
}

async function measureRoutePlanningAsync<TResult>(
  spans: AssistantRoutePlanningSpanMetrics,
  key: AssistantRoutePlanningSpanKey,
  work: () => Promise<TResult>,
  record?: (elapsedMs: number) => void,
): Promise<TResult> {
  const startedAt = Date.now()
  try {
    return await work()
  } finally {
    const elapsedMs = elapsedSince(startedAt)
    spans[key] = elapsedMs
    record?.(elapsedMs)
  }
}

function measureRoutePlanningSync<TResult>(
  spans: AssistantRoutePlanningSpanMetrics,
  key: AssistantRoutePlanningSpanKey,
  work: () => TResult,
): TResult {
  const startedAt = Date.now()
  try {
    return work()
  } finally {
    spans[key] = elapsedSince(startedAt)
  }
}

function sumRoutePlanningSpanMetrics(
  spans: AssistantRoutePlanningSpanMetrics,
): number {
  return Object.values(spans).reduce(
    (total, value) => total + (Number.isFinite(value) ? value : 0),
    0,
  )
}

function resolveRoutePlanningSlowestSpan(
  spans: AssistantRoutePlanningSpanMetrics,
): {
  elapsedMs: number
  stage: AssistantRoutePlanningStage
} | null {
  let slowest: {
    elapsedMs: number
    stage: AssistantRoutePlanningStage
  } | null = null

  for (const candidate of ASSISTANT_ROUTE_PLANNING_SPAN_STAGES) {
    const elapsedMs = spans[candidate.key]
    if (
      typeof elapsedMs !== 'number'
      || !Number.isFinite(elapsedMs)
      || elapsedMs <= 0
    ) {
      continue
    }

    if (!slowest || elapsedMs > slowest.elapsedMs) {
      slowest = {
        elapsedMs,
        stage: candidate.stage,
      }
    }
  }

  return slowest
}

function elapsedSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}

export async function resolveAssistantPromptTimeContext(
  vaultRoot: string,
): Promise<AssistantPromptTimeContext> {
  const fallbackTimeZone = resolveSystemTimeZone()
  let currentTimeZone = fallbackTimeZone

  try {
    const loadedVault = await loadVault({
      vaultRoot,
    })
    currentTimeZone =
      normalizeIanaTimeZone(loadedVault.metadata.timezone) ?? fallbackTimeZone
  } catch {
    // Prompt time context is best-effort and should not block the turn.
  }

  return {
    currentLocalDate: toLocalDayKey(new Date(), currentTimeZone),
    currentTimeZone,
  }
}

export async function resolveAssistantTurnPreferenceContext(
  vaultRoot: string,
): Promise<AssistantTurnPreferenceContext> {
  try {
    const preferences = await readPreferencesDocument(vaultRoot)
    return {
      assistantPersonality: preferences.assistant?.personality ?? null,
      assistantTone: preferences.assistant?.tone ?? null,
      assistantVoice: preferences.assistant?.voice ?? null,
    }
  } catch {
    return {
      assistantPersonality: null,
      assistantTone: null,
      assistantVoice: null,
    }
  }
}

export function resolveAssistantPromptCapabilityAvailability(input: {
  executionContext: ReturnType<typeof normalizeAssistantExecutionContext> | null
}): AssistantPromptCapabilityAvailability {
  const assistantHostedDeviceConnectProviders =
    input.executionContext?.hosted?.deviceConnectProviders ?? []
  const assistantHostedDeviceConnectAvailable =
    assistantHostedDeviceConnectProviders.length > 0 &&
    input.executionContext?.hosted?.deviceTool != null

  return {
    assistantHostedDeviceConnectAvailable,
    assistantHostedDeviceConnectProviders: assistantHostedDeviceConnectAvailable
      ? assistantHostedDeviceConnectProviders
      : [],
    assistantKnowledgeToolsAvailable: false,
  }
}

function resolveAssistantCodexContinuation(input: {
  resumeCodexThreadId: string | null
}): AssistantCodexContinuation {
  if (input.resumeCodexThreadId) {
    return {
      kind: 'provider-state-optimization',
    }
  }

  return {
    kind: 'thread-start',
  }
}

function resolveAssistantEffectiveCodexResumeThreadId(input: {
  resumeCodexThreadId: string | null
}): string | null {
  return normalizeNullableString(input.resumeCodexThreadId)
}
