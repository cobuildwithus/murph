import {
  assistantReasoningEffortValues,
  type AssistantReasoningEffort,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  DEFAULT_MURPH_CODEX_REASONING_EFFORT,
} from '@murphai/operator-config/assistant/provider-config'
import {
  resolveAssistantUsageCredentialSource,
} from '@murphai/hosted-execution/assistant-usage'
import {
  HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
  HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID,
  HOSTED_LOCAL_TEST_VENICE_CODEX_MODEL_PROVIDER_ID,
} from '@murphai/operator-config/assistant/target-runtime'
import {
  MURPH_GROUP_ROOM_MODEL_MAINTENANCE_PERMISSION_PROFILE,
  MURPH_MEMBER_MEMORY_MAINTENANCE_PERMISSION_PROFILE,
  MURPH_MEMBER_READ_PERMISSION_PROFILE,
  MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE,
} from '@murphai/hosted-execution/assistant-permissions'
import {
  hasHostedCodexModelCatalogFlexTier,
} from '../assistant-codex/config.js'
import {
  executeCodexAssistantTurnAttemptFromInput,
  resolveCodexAssistantTargetCapabilities,
} from './codex-runtime.js'
import type {
  AssistantAcceptedMessageTargetAuthorizer,
} from './message-target-selection.js'
import type {
  AssistantGenerateSongTurnPolicy,
  AssistantProviderServiceTier,
  AssistantProviderAttemptMetadata,
  AssistantProviderFinishWithoutReplyAcceptedEvent,
  AssistantProviderRequestStartTiming,
  AssistantProviderRequestOutcome,
  AssistantProviderUsage,
  AssistantProviderUsageDraft,
} from './providers/types.js'
import {
  resolveCodexAssistantProviderTokenPricingBasis,
} from './providers/helpers.js'
import { errorMessage, normalizeNullableString } from './shared.js'
import {
  recordAssistantRuntimeIssueInputsBestEffort,
  type AssistantRuntimeIssueInput,
} from './issue-reporting.js'
import {
  MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
} from './onboarding-goal-checkin-automation.js'
import type { CodexThreadIdentity } from './codex-thread-route.js'
import { maybeThrowInjectedAssistantFault } from './fault-injection.js'
import {
  annotateRecoveredCodexThreadIdForDiagnostics,
} from './provider-failure-diagnostics.js'
import { appendAssistantTranscriptEntries } from './store.js'
import {
  buildAssistantProviderTranscriptAuditEntries,
} from './transcript-audit.js'
import { HOSTED_STABLE_PROVIDER_WORKING_DIRECTORY } from './turn-plan.js'
import {
  createAssistantUsageAttribution,
  resolveAssistantUsageEnvironment,
  resolveAssistantUsageFeatureKey,
  resolveAssistantUsageReportingSecret,
  resolveAssistantUsageSurface,
  resolveAssistantUsageTriggerKind,
  type AssistantUsageAttribution,
} from './usage-attribution.js'
import type {
  AssistantMessageInput,
  AssistantProviderAcceptedInputsRelease,
  AssistantTurnSharedPlan,
  ExecutedAssistantProviderTurnResult,
} from './service-contracts.js'
import type {
  AssistantProviderStartCriticalPathContext,
} from './provider-start-critical-path.js'
import type {
  AssistantActiveTurnLiveProviderSteering,
} from './turn-input.js'
import {
  createAssistantProductFeedbackRecorder,
  type AssistantProgressDelivery,
} from './turn-progress.js'
import {
  MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_AUTOMATION_ID,
  MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
} from './managed-automations.js'
import type {
  AssistantHostedToolContext,
} from './hosted-tool-context.js'
import {
  resolveAssistantAcceptedTurnInputReferenceWindow,
  type AssistantAcceptedTurnInputItemInput,
  type AssistantCodexContinuation,
} from './active-turn-input-journal.js'
import type { AssistantUserMessageContentPart } from './content-types.js'
import type { AssistantProviderTraceEvent } from './provider-traces.js'
import {
  recordCodexAttemptFailed,
} from './codex-turn/attempt-observability.js'
import {
  buildCodexTurnAttemptPlan,
  buildCodexTurnExecutionPlan,
  type AssistantCodexAttemptPlan,
  type AssistantCodexTurnExecutionPlan,
  type AssistantCodexTurnExecutionProfile,
  type AssistantCodexTurnThreadScopeProfile,
  type AssistantRoutePlanningDiagnostics,
} from './codex-turn/planning.js'
import {
  resolveAssistantConversationScope,
} from './conversation-policy.js'

const ASSISTANT_PROVIDER_PLAN_TRACE_SCHEMA =
  'murph.assistant-provider-plan-diagnostics.v1'
const ASSISTANT_CREATIVE_NOTIFICATION_SONG_POLICY = {
  maxAttempts: 1,
  requiredDurationSeconds: 15,
} as const satisfies AssistantGenerateSongTurnPolicy
const ASSISTANT_PROVIDER_PLAN_TRACE_TYPE = 'assistant.provider.plan'
const ASSISTANT_PROVIDER_FLEX_TURN_DEADLINE_MS = 600_000
const ASSISTANT_NATIVE_CAPABILITIES_RESTRICTED_THREAD_CONFIG = {
  'features.apps': false,
  'features.browser_use': false,
  'features.enable_mcp_apps': false,
  'features.multi_agent': false,
  'features.multi_agent_v2': false,
  'features.plugins': false,
  'features.shell_tool': false,
  'features.standalone_web_search': false,
  'features.tool_suggest': false,
  'features.web_search_request': false,
  'memories.generate_memories': false,
  'memories.use_memories': false,
  web_search: 'disabled',
} as const
const ASSISTANT_RESTRICTED_ONE_SHOT_INSTRUCTION_CONFIG = {
  include_apps_instructions: false,
  include_collaboration_mode_instructions: false,
  include_environment_context: false,
  include_permissions_instructions: false,
  project_doc_max_bytes: 0,
  'features.request_permissions_tool': false,
  'skills.include_instructions': false,
} as const
const ASSISTANT_TOOL_ONLY_MAINTENANCE_THREAD_CONFIG = {
  ...ASSISTANT_NATIVE_CAPABILITIES_RESTRICTED_THREAD_CONFIG,
  ...ASSISTANT_RESTRICTED_ONE_SHOT_INSTRUCTION_CONFIG,
} as const
const ASSISTANT_SHELL_PRESERVING_RESTRICTED_CODEX_CONFIG_OVERRIDES = [
  'memories.generate_memories=false',
  'web_search="disabled"',
  'features.web_search_request=false',
  'features.standalone_web_search=false',
  'features.apps=false',
  'features.enable_mcp_apps=false',
  'features.browser_use=false',
  'features.plugins=false',
  'features.multi_agent=false',
  'features.multi_agent_v2=false',
  'features.tool_suggest=false',
] as const
const ASSISTANT_NATIVE_CAPABILITIES_RESTRICTED_CODEX_CONFIG_OVERRIDES = [
  ...ASSISTANT_SHELL_PRESERVING_RESTRICTED_CODEX_CONFIG_OVERRIDES,
  'memories.use_memories=false',
  'features.shell_tool=false',
] as const
const ASSISTANT_FILESYSTEM_DISABLED_CODEX_CONFIG_OVERRIDES = [
  'features.shell_tool=false',
  'features.multi_agent=false',
  'features.multi_agent_v2=false',
  'features.tool_suggest=false',
] as const

function resolveAssistantCodexConfigOverrides(input: {
  filesystemDisabledTurn: boolean
  nativeCapabilitiesRestrictedTurn: boolean
  shellPreservingCapabilitiesRestrictedTurn: boolean
  requested: readonly string[] | null
}): readonly string[] | null {
  if (input.nativeCapabilitiesRestrictedTurn) {
    return [
      ...(input.requested ?? []),
      ...ASSISTANT_NATIVE_CAPABILITIES_RESTRICTED_CODEX_CONFIG_OVERRIDES,
    ]
  }
  if (input.shellPreservingCapabilitiesRestrictedTurn) {
    return ASSISTANT_SHELL_PRESERVING_RESTRICTED_CODEX_CONFIG_OVERRIDES
  }
  if (!input.filesystemDisabledTurn) {
    return input.requested
  }
  return [
    ...(input.requested ?? []),
    ...ASSISTANT_FILESYSTEM_DISABLED_CODEX_CONFIG_OVERRIDES,
  ]
}

export {
  resolveAssistantCodexThreadScope,
} from './codex-turn/planning.js'
export type {
  AssistantCodexTurnExecutionProfile,
  AssistantCodexTurnNativeResumePolicy,
  AssistantCodexTurnPromptProfile,
  AssistantCodexThreadScope,
  AssistantCodexTurnThreadScopeProfile,
  AssistantCodexTurnToolProfile,
} from './codex-turn/planning.js'

type AssistantCodexAttemptOutcome =
  | {
      kind: 'failed_terminal'
      attemptCount: number
      error: unknown
      providerRequestOutcome: Exclude<AssistantProviderRequestOutcome, 'succeeded'>
      codexContinuation: AssistantCodexContinuation
      codexRolloutRelativePath: string | null
      codexThreadId: string | null
      acceptedNoReplyDeliveryContextOrdinals: readonly number[]
      reactions: NonNullable<ExecutedAssistantProviderTurnResult['reactions']>
      providerTurnId: string | null
      rawEvents: unknown[]
      session: AssistantSession
      usage: AssistantProviderUsage | null
      additionalUsages: readonly AssistantProviderUsageDraft[]
      usageAttribution: AssistantUsageAttribution | null
    }
  | {
      kind: 'succeeded'
      result: ExecutedAssistantProviderTurnResult
    }

export type AssistantCodexTurnRecoveryOutcome =
  | {
      kind: 'failed_terminal'
      attemptCount: number
      error: unknown
      providerRequestOutcome: Exclude<AssistantProviderRequestOutcome, 'succeeded'>
      assistantContractFingerprint: string
      codexContinuation: AssistantCodexContinuation
      codexRolloutRelativePath: string | null
      codexThreadId: string | null
      acceptedNoReplyDeliveryContextOrdinals: readonly number[]
      reactions: NonNullable<ExecutedAssistantProviderTurnResult['reactions']>
      providerTurnId: string | null
      rawEvents: unknown[]
      route: CodexThreadIdentity
      session: AssistantSession
      usage: AssistantProviderUsage | null
      additionalUsages: readonly AssistantProviderUsageDraft[]
      usageAttribution: AssistantUsageAttribution | null
    }
  | {
      kind: 'succeeded'
      providerTurn: ExecutedAssistantProviderTurnResult
    }

export async function executeCodexTurnWithRecovery(input: {
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
  onProviderRequestPlanned?: (event: {
    providerAttemptId: string | null
    codexContinuation: AssistantCodexContinuation
  }) => Promise<AssistantProviderAcceptedInputsRelease | void>
  onProviderRequestStarted?: (event: {
    providerRequestOrdinal: number | null
    startedAt: string
  } & AssistantProviderRequestStartTiming) => Promise<void> | void
  plan: AssistantTurnSharedPlan
  profile?: AssistantCodexTurnThreadScopeProfile | null
  providerRequestOrdinal?: number | null
  providerStartCriticalPath?: AssistantProviderStartCriticalPathContext | null
  resolvedSession: AssistantSession
  route: CodexThreadIdentity
  progressDelivery?: AssistantProgressDelivery | null
  hostedToolContext?: AssistantHostedToolContext | null
  turnCreatedAt: string
  turnId: string
}): Promise<AssistantCodexTurnRecoveryOutcome> {
  const executionPlan = await buildCodexTurnExecutionPlan(input)
  const attemptPlan = await buildCodexTurnAttemptPlan({
    attemptCount: 1,
    executionPlan,
    session: input.resolvedSession,
  })

  const releaseProviderAcceptedInputs = await input.onProviderRequestPlanned?.({
    providerAttemptId: null,
    codexContinuation: attemptPlan.routePlan.codexContinuation,
  })

  let attemptOutcome: AssistantCodexAttemptOutcome
  try {
    attemptOutcome = await executeAssistantCodexAttempt({
      attemptPlan,
      executionPlan,
      onProviderRequestStarted: input.onProviderRequestStarted ?? null,
      providerRequestOrdinal: input.providerRequestOrdinal ?? null,
      ...(input.providerStartCriticalPath
        ? { providerStartCriticalPath: input.providerStartCriticalPath }
        : {}),
    })
  } finally {
    await releaseProviderAcceptedInputs?.()
  }

  switch (attemptOutcome.kind) {
    case 'succeeded':
      return {
        kind: 'succeeded',
        providerTurn: attemptOutcome.result,
      }
    case 'failed_terminal':
      return {
        kind: 'failed_terminal',
        attemptCount: attemptOutcome.attemptCount,
        error: attemptOutcome.error,
        providerRequestOutcome: attemptOutcome.providerRequestOutcome,
        assistantContractFingerprint:
          attemptPlan.routePlan.assistantContractFingerprint,
        codexContinuation: attemptOutcome.codexContinuation,
        codexRolloutRelativePath: attemptOutcome.codexRolloutRelativePath,
        codexThreadId: attemptOutcome.codexThreadId,
        acceptedNoReplyDeliveryContextOrdinals:
          attemptOutcome.acceptedNoReplyDeliveryContextOrdinals,
        reactions: attemptOutcome.reactions,
        providerTurnId: attemptOutcome.providerTurnId,
        rawEvents: attemptOutcome.rawEvents,
        route: attemptPlan.route,
        session: attemptOutcome.session,
        usage: attemptOutcome.usage,
        additionalUsages: attemptOutcome.additionalUsages,
        usageAttribution: attemptOutcome.usageAttribution,
      }
  }
}

function createAssistantProviderUsageAttribution(input: {
  attemptPlan: AssistantCodexAttemptPlan
  env: NodeJS.ProcessEnv
  executionPlan: AssistantCodexTurnExecutionPlan
  hostedMemberId: string | null
}): AssistantUsageAttribution | null {
  if (!input.hostedMemberId) {
    return null
  }

  const credentialSource = resolveAssistantUsageCredentialSource({
    apiKeyEnv: null,
    credentialSourceHint:
      input.attemptPlan.route.providerOptions.modelProvider
        === HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID
        ? 'member'
        : null,
    effectiveEnv: input.env,
    headers: null,
    provider: input.attemptPlan.route.provider,
    userEnvKeys: [...(input.executionPlan.executionContext?.hosted?.userEnvKeys ?? [])],
  })
  return createAssistantUsageAttribution({
    credentialSource,
    environment: resolveAssistantUsageEnvironment(input.env),
    featureKey: resolveAssistantUsageFeatureKey({
      deliverResponse: input.executionPlan.input.deliverResponse,
      promptProfile: input.executionPlan.profile.promptProfile,
      turnTrigger: input.executionPlan.input.turnTrigger ?? 'manual-ask',
    }),
    memberId: input.hostedMemberId,
    reportingSecret: resolveAssistantUsageReportingSecret(input.env),
    surface: resolveAssistantUsageSurface({
      messageInput: input.executionPlan.input,
      session: input.attemptPlan.session,
    }),
    stripeMeterSource: 'murph',
    triggerKind: resolveAssistantUsageTriggerKind(
      input.executionPlan.input.turnTrigger ?? 'manual-ask',
    ),
  })
}

function emitCodexPlanTraceEvent(input: {
  onTraceEvent?: ((event: AssistantProviderTraceEvent) => void) | null
  codexContinuation: string
  providerRequestOrdinal: number | null
  reasoningEffort?: AssistantReasoningEffort | null
  routePlanningDiagnostics: AssistantRoutePlanningDiagnostics
  resumeCodexThreadIdPresent: boolean
  workingDirectory: string
}): void {
  if (!input.onTraceEvent) {
    return
  }

  try {
    input.onTraceEvent({
      codexThreadId: null,
      rawEvent: {
        schema: ASSISTANT_PROVIDER_PLAN_TRACE_SCHEMA,
        type: ASSISTANT_PROVIDER_PLAN_TRACE_TYPE,
        codexContinuation: input.codexContinuation,
        providerRequestOrdinal: input.providerRequestOrdinal,
        ...(input.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: input.reasoningEffort }),
        routePlanningElapsedMs: input.routePlanningDiagnostics.routePlanningElapsedMs,
        dynamicToolCount: input.routePlanningDiagnostics.dynamicToolCount,
        messageTargetingAvailable:
          input.routePlanningDiagnostics.messageTargetingAvailable,
        messageTargetDynamicToolsAvailable:
          input.routePlanningDiagnostics.messageTargetDynamicToolsAvailable,
        routePlanningCliBootstrapElapsedMs:
          input.routePlanningDiagnostics.cliBootstrapElapsedMs,
        routePlanningMemoryOverviewElapsedMs: null,
        routePlanningVaultOverviewElapsedMs: null,
        routePlanningActiveExperimentContextElapsedMs: null,
        routePlanningAssistantContextSnapshotElapsedMs:
          input.routePlanningDiagnostics.assistantContextSnapshotElapsedMs,
        routePlanningAnyBootstrapContextPrepared:
          input.routePlanningDiagnostics.shouldPrepareBootstrapContext,
        routePlanningBootstrapContextPrepared:
          input.routePlanningDiagnostics.shouldPrepareBootstrapContext,
        routePlanningFallbackInstructionsElapsedMs: null,
        routePlanningMeasuredElapsedMs:
          input.routePlanningDiagnostics.routePlanningMeasuredElapsedMs,
        routePlanningPrimaryInstructionsElapsedMs:
          input.routePlanningDiagnostics.primarySystemPromptElapsedMs,
        routePlanningPrimarySystemPromptElapsedMs:
          input.routePlanningDiagnostics.primarySystemPromptElapsedMs,
        routePlanningResumeBindingElapsedMs:
          input.routePlanningDiagnostics.routeResumeBindingElapsedMs,
        routePlanningSlowestStage:
          input.routePlanningDiagnostics.routePlanningSlowestStage,
        routePlanningSlowestStageElapsedMs:
          input.routePlanningDiagnostics.routePlanningSlowestStageElapsedMs,
        routePlanningTargetCapabilitiesElapsedMs:
          input.routePlanningDiagnostics.routeTargetCapabilitiesElapsedMs,
        routePlanningUnaccountedElapsedMs:
          input.routePlanningDiagnostics.routePlanningUnaccountedElapsedMs,
        resumeCodexThreadIdPresent: input.resumeCodexThreadIdPresent,
        workingDirectoryKind:
          input.workingDirectory === HOSTED_STABLE_PROVIDER_WORKING_DIRECTORY
            ? 'hosted-stable-proc-cwd'
            : 'raw',
      },
      updates: [],
    })
  } catch {
    // Provider-plan traces are diagnostic-only and must not block turns.
  }
}

async function executeAssistantCodexAttempt(input: {
  attemptPlan: AssistantCodexAttemptPlan
  executionPlan: AssistantCodexTurnExecutionPlan
  onProviderRequestStarted?: ((event: {
    providerRequestOrdinal: number | null
    startedAt: string
  } & AssistantProviderRequestStartTiming) => Promise<void> | void) | null
  providerRequestOrdinal: number | null
  providerStartCriticalPath?: AssistantProviderStartCriticalPathContext | null
}): Promise<AssistantCodexAttemptOutcome> {
  const { attemptPlan, executionPlan } = input
  let attemptMetadata: AssistantProviderAttemptMetadata = {
    activityLabels: [] as readonly string[],
    executedToolCount: 0,
    providerActionCount: 0,
    rawToolEvents: [] as readonly unknown[],
    runtimeIssueInputs: [] as readonly AssistantRuntimeIssueInput[],
  }
  const reasoningEffort =
    normalizeNullableString(attemptPlan.route.providerOptions.reasoningEffort)
    ?? DEFAULT_MURPH_CODEX_REASONING_EFFORT
  const traceReasoningEffort = assistantReasoningEffortValues.find(
    (candidate) => candidate === reasoningEffort,
  )

  emitCodexPlanTraceEvent({
    onTraceEvent: executionPlan.input.onTraceEvent,
    codexContinuation: attemptPlan.routePlan.codexContinuation.kind,
    providerRequestOrdinal: input.providerRequestOrdinal ?? null,
    reasoningEffort: traceReasoningEffort,
    routePlanningDiagnostics: attemptPlan.routePlan.planningDiagnostics,
    resumeCodexThreadIdPresent: attemptPlan.routePlan.resume !== null,
    workingDirectory: attemptPlan.routePlan.workingDirectory,
  })
  let usageAttribution: AssistantUsageAttribution | null = null
  let failedAttemptCodexRolloutRelativePath: string | null = null
  let failedAttemptCodexThreadId: string | null = null
  let failedAttemptProviderTurnId: string | null = null
  let failedAttemptRawEvents: unknown[] = []
  let failedAttemptUsage: AssistantProviderUsage | null = null
  let failedAttemptAdditionalUsages: readonly AssistantProviderUsageDraft[] = []
  let failedAttemptAcceptedNoReplyDeliveryContextOrdinals: readonly number[] = []
  let failedAttemptReactions: NonNullable<ExecutedAssistantProviderTurnResult['reactions']> = []
  let failedAttemptOutcome: Exclude<AssistantProviderRequestOutcome, 'succeeded'> | null =
    null

  try {
    maybeThrowInjectedAssistantFault({
      component: 'provider',
      fault: 'provider',
      message: 'Injected assistant provider failure.',
    })
    const attemptEnv = attemptPlan.routePlan.cliEnv
    usageAttribution = createAssistantProviderUsageAttribution({
      attemptPlan,
      env: attemptEnv,
      executionPlan,
      hostedMemberId: executionPlan.executionContext?.hosted?.memberId ?? null,
    })
    const serviceTier = resolveCodexAttemptServiceTier({
      env: attemptEnv,
      executionContext: executionPlan.executionContext,
      requestedServiceTier: executionPlan.input.serviceTier ?? null,
      routeModel: attemptPlan.route.providerOptions.model ?? null,
      routeModelProvider: attemptPlan.route.providerOptions.modelProvider ?? null,
    })
    const voiceMemoDeliveryChannel =
      attemptPlan.routePlan.voiceMemoDeliveryChannel ?? null
    const assistantPreferredElevenLabsVoiceId =
      attemptPlan.routePlan.assistantPreferredElevenLabsVoiceId ?? null
    const outputOnlyTurn =
      executionPlan.profile.toolProfile === 'output-only-turn'
    const readOnlyAutomationTurn =
      executionPlan.input.scheduledInvocationAuthority?.automationId ===
        MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID
    const hostedRuntimeCapabilitiesRestrictedTurn =
      outputOnlyTurn ||
      executionPlan.profile.promptProfile === 'creative-notification'
    const readCurrentHostedImageCompletionEffectScope =
      executionPlan.hostedToolContext
        ?.currentHostedImageCompletionEffectScope
    const hostedImageCompletionNativeCapabilitiesRestrictedTurn =
      executionPlan.input.hostedImageCompletionEffectRestriction != null &&
      (
        readCurrentHostedImageCompletionEffectScope == null ||
        readCurrentHostedImageCompletionEffectScope() !== null
      )
    const nativeCapabilitiesRestrictedTurn =
      hostedRuntimeCapabilitiesRestrictedTurn ||
      hostedImageCompletionNativeCapabilitiesRestrictedTurn
    const creativeNotificationSongTurn =
      executionPlan.profile.promptProfile === 'creative-notification' &&
      executionPlan.profile.toolProfile === 'provider-turn'
    const systemNotificationTurn =
      executionPlan.profile.promptProfile === 'system-notification' ||
      executionPlan.profile.promptProfile === 'creative-notification'
    const groupRoomModelMaintenanceTurn =
      executionPlan.profile.toolProfile === 'maintenance-turn' &&
      executionPlan.input.maintenanceProfile === 'group-room-model' &&
      executionPlan.input.scheduledInvocationAuthority?.automationId ===
        MURPH_GROUP_ROOM_MODEL_CONSOLIDATION_AUTOMATION_ID
    const memberMemoryMaintenanceTurn =
      executionPlan.profile.toolProfile === 'maintenance-turn' &&
      executionPlan.input.maintenanceProfile === 'member-memory' &&
      executionPlan.input.scheduledInvocationAuthority?.automationId ===
        MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID
    const toolOnlyMaintenanceTurn =
      groupRoomModelMaintenanceTurn || memberMemoryMaintenanceTurn
    const restrictedOneShotTurn =
      groupRoomModelMaintenanceTurn ||
      memberMemoryMaintenanceTurn ||
      readOnlyAutomationTurn
    const audience = executionPlan.sharedPlan.conversationPolicy.audience
    const groupConversation =
      resolveAssistantConversationScope(audience) === 'group'
    const groupEmailTurn =
      audience.threadIsDirect === false &&
      normalizeNullableString(audience.channel)?.toLowerCase() === 'email'
    const ordinaryHostedWorkspaceTurn =
      Boolean(executionPlan.executionContext?.hosted) &&
      !restrictedOneShotTurn &&
      !nativeCapabilitiesRestrictedTurn &&
      !groupEmailTurn
    const hostedLocalTestProviderTurn =
      attemptPlan.route.providerOptions.modelProvider ===
        HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID ||
      attemptPlan.route.providerOptions.modelProvider ===
        HOSTED_LOCAL_TEST_VENICE_CODEX_MODEL_PROVIDER_ID
    const attemptResult = await executeCodexAssistantTurnAttemptFromInput({
      providerConfig: {
        approvalPolicy:
          nativeCapabilitiesRestrictedTurn || readOnlyAutomationTurn
          ? 'never'
          : attemptPlan.route.providerOptions.approvalPolicy,
        codexCommand:
          attemptPlan.route.codexCommand ??
          executionPlan.input.codexCommand ??
          undefined,
        codexHome: attemptPlan.route.providerOptions.codexHome,
        model: attemptPlan.route.providerOptions.model,
        modelProvider: attemptPlan.route.providerOptions.modelProvider,
        oss: attemptPlan.route.providerOptions.oss,
        profile: attemptPlan.route.providerOptions.profile,
        provider: attemptPlan.route.provider,
        reasoningEffort,
        sandbox:
          nativeCapabilitiesRestrictedTurn ||
          readOnlyAutomationTurn ||
          groupEmailTurn
          ? 'read-only'
          : attemptPlan.route.providerOptions.sandbox,
      },
      turn: {
        abortSignal: serviceTier
          ? composeAssistantProviderFlexDeadlineSignal(executionPlan.input.abortSignal)
          : executionPlan.input.abortSignal,
        activeTurnId: executionPlan.turnId,
        activeTurnSteering:
          hostedImageCompletionNativeCapabilitiesRestrictedTurn
          ? null
          : executionPlan.activeTurnSteering,
        activeTurnSessionId: attemptPlan.session.sessionId,
        allowFinishWithoutReply: executionPlan.allowFinishWithoutReply,
        automationRelativeDateReferenceWindow:
          resolveAssistantAcceptedTurnInputReferenceWindow(
            executionPlan.acceptedInputItems ?? [],
          ),
        authorizeAcceptedMessageTarget:
          executionPlan.authorizeAcceptedMessageTarget ?? null,
        codexConfigOverrides: resolveAssistantCodexConfigOverrides({
          filesystemDisabledTurn: groupEmailTurn,
          nativeCapabilitiesRestrictedTurn:
            hostedImageCompletionNativeCapabilitiesRestrictedTurn,
          shellPreservingCapabilitiesRestrictedTurn:
            readOnlyAutomationTurn,
          requested: executionPlan.input.codexConfigOverrides ?? null,
        }),
        codexThreadConfig:
          nativeCapabilitiesRestrictedTurn
            ? ASSISTANT_NATIVE_CAPABILITIES_RESTRICTED_THREAD_CONFIG
            : toolOnlyMaintenanceTurn
              ? ASSISTANT_TOOL_ONLY_MAINTENANCE_THREAD_CONFIG
              : readOnlyAutomationTurn
                ? ASSISTANT_RESTRICTED_ONE_SHOT_INSTRUCTION_CONFIG
                : null,
        conversationHistoryMessages:
          attemptPlan.routePlan.conversationHistoryMessages,
        developerInstructions: attemptPlan.routePlan.developerInstructions,
        dynamicTools: outputOnlyTurn || readOnlyAutomationTurn
          ? []
          : attemptPlan.routePlan.dynamicTools,
        environments:
          nativeCapabilitiesRestrictedTurn ||
          readOnlyAutomationTurn ||
          toolOnlyMaintenanceTurn
          ? []
          : attemptPlan.routePlan.environments,
        env: attemptEnv,
        ...(creativeNotificationSongTurn
          ? {
              generateSongPolicy:
                ASSISTANT_CREATIVE_NOTIFICATION_SONG_POLICY,
            }
          : {}),
        groupConversation,
        groupRoomModelMaintenanceAuthorized: groupRoomModelMaintenanceTurn,
        memberMemoryMaintenanceAuthorized: memberMemoryMaintenanceTurn,
        hostedToolContext:
          hostedRuntimeCapabilitiesRestrictedTurn ||
          readOnlyAutomationTurn ||
          toolOnlyMaintenanceTurn
          ? null
          : executionPlan.hostedToolContext ?? null,
        materializeWorkspaceArtifacts:
          hostedRuntimeCapabilitiesRestrictedTurn ||
          readOnlyAutomationTurn ||
          toolOnlyMaintenanceTurn
          ? null
          : executionPlan.executionContext?.hosted?.materializeWorkspaceArtifacts ?? null,
        onboardingFirstReadCompletionTransitionAvailable:
          attemptPlan.routePlan.onboardingGuidanceInjected &&
          executionPlan.input.scheduledOccurrenceAt == null &&
          executionPlan.input.scheduledInvocationAuthority == null,
        onEvent: executionPlan.input.onProviderEvent ?? undefined,
        onFinishWithoutReplyAccepted:
          executionPlan.onFinishWithoutReplyAccepted ?? null,
        onFinishWithoutReplyRecorded:
          executionPlan.onFinishWithoutReplyRecorded ?? null,
        onProviderRequestStarted: (event) => {
          notifyProviderRequestStartedBestEffort({
            event: {
              ...event,
              providerRequestOrdinal: input.providerRequestOrdinal,
            },
            hook: input.onProviderRequestStarted ?? null,
          })
        },
        onTraceEvent: executionPlan.input.onTraceEvent,
        productFeedbackRecorder: createAssistantProductFeedbackRecorder({
          acceptedInputItems: executionPlan.acceptedInputItems ?? [],
          ...(executionPlan.hostedToolContext
              ?.currentProductFeedbackAcceptedInputIds
            ? {
                getAcceptedInputIds:
                  executionPlan.hostedToolContext
                    .currentProductFeedbackAcceptedInputIds,
              }
            : {}),
          productFeedbackCandidateSink:
            executionPlan.executionContext?.hosted?.productFeedbackCandidateSink ?? null,
        }),
        providerThreadEphemeral: systemNotificationTurn || restrictedOneShotTurn
          ? true
          : executionPlan.input.providerThreadEphemeral ?? null,
        progressDelivery:
          hostedRuntimeCapabilitiesRestrictedTurn ||
          readOnlyAutomationTurn ||
          toolOnlyMaintenanceTurn
          ? null
          : executionPlan.progressDelivery ?? null,
        permissions:
          groupRoomModelMaintenanceTurn
            ? MURPH_GROUP_ROOM_MODEL_MAINTENANCE_PERMISSION_PROFILE
            : memberMemoryMaintenanceTurn
              ? MURPH_MEMBER_MEMORY_MAINTENANCE_PERMISSION_PROFILE
              : readOnlyAutomationTurn && executionPlan.executionContext?.hosted
              ? MURPH_MEMBER_READ_PERMISSION_PROFILE
              : ordinaryHostedWorkspaceTurn
                ? hostedLocalTestProviderTurn
                  ? null
                  : MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE
                : null,
        ...(restrictedOneShotTurn
          ? { processLifetime: 'one-shot' as const }
          : {}),
        providerFetch:
          outputOnlyTurn ||
          readOnlyAutomationTurn ||
          hostedImageCompletionNativeCapabilitiesRestrictedTurn
          ? null
          : executionPlan.executionContext?.hosted?.providerFetch ?? null,
        providerRequestOrdinal: input.providerRequestOrdinal ?? null,
        ...(input.providerStartCriticalPath
          ? { providerStartCriticalPath: input.providerStartCriticalPath }
          : {}),
        publicInternetFetch:
          outputOnlyTurn ||
          readOnlyAutomationTurn ||
          toolOnlyMaintenanceTurn ||
          hostedImageCompletionNativeCapabilitiesRestrictedTurn
          ? null
          : executionPlan.executionContext?.hosted?.publicInternetFetch ?? null,
        requireHostedPrivateImageDelivery:
          !hostedRuntimeCapabilitiesRestrictedTurn &&
          !readOnlyAutomationTurn &&
          !toolOnlyMaintenanceTurn &&
          Boolean(executionPlan.executionContext?.hosted),
        runtimeWorkspaceRoots:
          restrictedOneShotTurn || ordinaryHostedWorkspaceTurn
          ? [attemptPlan.routePlan.workingDirectory]
          : null,
        resume: readOnlyAutomationTurn ? null : attemptPlan.routePlan.resume,
        // Per-turn execution policy from the message input, not route identity.
        serviceTier,
        sessionContext: attemptPlan.routePlan.sessionContext
          ? {
              binding: attemptPlan.session.binding,
            }
          : undefined,
        showThinkingTraces: executionPlan.input.showThinkingTraces ?? false,
        systemPrompt: attemptPlan.routePlan.systemPrompt,
        turnContextPrompt: attemptPlan.routePlan.turnContextPrompt,
        usageAttribution,
        vaultRoot: executionPlan.input.vault,
        userMessageContent: resolveCodexRouteUserMessageContent({
          route: attemptPlan.route,
          userMessageContent: executionPlan.input.userMessageContent,
        }),
        userPrompt: executionPlan.input.prompt,
        assistantPreferredElevenLabsVoiceId,
        voiceMemoDeliveryChannel,
        workingDirectory: attemptPlan.routePlan.workingDirectory,
      },
    })
    attemptMetadata = normalizeAssistantProviderAttemptMetadata(attemptResult.metadata)
    recordAssistantRuntimeIssueInputsBestEffort({
      issues: attemptMetadata.runtimeIssueInputs,
      policy: attemptPlan.routePlan.diagnosticsPolicy,
      vault: executionPlan.input.vault,
    })
    if (!attemptResult.ok) {
      failedAttemptCodexRolloutRelativePath =
        attemptResult.codexRolloutRelativePath ?? null
      failedAttemptCodexThreadId = attemptResult.codexThreadId ?? null
      failedAttemptProviderTurnId = attemptResult.providerTurnId ?? null
      failedAttemptRawEvents = [...(attemptResult.rawEvents ?? [])]
      failedAttemptUsage = attemptResult.usage ?? null
      failedAttemptAdditionalUsages = attemptResult.additionalUsages ?? []
      failedAttemptAcceptedNoReplyDeliveryContextOrdinals = [
        ...(attemptResult.acceptedNoReplyDeliveryContextOrdinals ?? []),
      ]
      failedAttemptReactions = [...(attemptResult.reactions ?? [])]
      failedAttemptOutcome =
        attemptResult.providerRequestOutcome ??
        resolveFailedAssistantProviderRequestOutcome({
          error: attemptResult.error,
          rawEvents: failedAttemptRawEvents,
          usage: failedAttemptUsage,
        })
      throw attemptResult.error
    }
    const result = attemptResult.result
    return {
      kind: 'succeeded',
      result: {
        ...result,
        assistantContractFingerprint:
          attemptPlan.routePlan.assistantContractFingerprint,
        attemptCount: attemptPlan.attemptCount,
        onboardingGuidanceInjected: attemptPlan.routePlan.onboardingGuidanceInjected,
        codexContinuation: attemptPlan.routePlan.codexContinuation,
        providerOptions: attemptPlan.route.providerOptions,
        route: attemptPlan.route,
        responseMedia: result.responseMedia ?? [],
        responseCard: result.responseCard ?? null,
        session: attemptPlan.session,
        usageAttribution,
        workingDirectory: attemptPlan.routePlan.workingDirectory,
      },
    }
  } catch (error) {
    const errorCode = readAssistantErrorCode(error)
    if (executionPlan.profile.threadScope === 'session-thread') {
      annotateRecoveredCodexThreadIdForDiagnostics(error)
    }
    const session = attemptPlan.session
    recordAssistantRuntimeIssueInputsBestEffort({
      issues: [
        {
          component: 'assistant.codex-provider',
          operation: attemptPlan.route.provider,
          phase: 'provider_turn',
          issueKind: classifyProviderRuntimeIssueKind(error),
          severity: 'error',
          errorCode: errorCode ?? 'ASSISTANT_CODEX_PROVIDER_FAILED',
          summary: 'Codex provider turn failed.',
          details: {
            providerRequestOutcome:
              failedAttemptOutcome ??
              resolveFailedAssistantProviderRequestOutcome({
                error,
                rawEvents: failedAttemptRawEvents,
                usage: failedAttemptUsage,
              }),
            providerActionCount: attemptMetadata.providerActionCount,
            rawEventCountBucket: countBucket(failedAttemptRawEvents.length),
          },
        },
      ],
      policy: attemptPlan.routePlan.diagnosticsPolicy,
      vault: executionPlan.input.vault,
    })
    if (executionPlan.input.suppressProviderFailureTranscriptAudit !== true) {
      void appendAssistantTranscriptEntries(
        executionPlan.input.vault,
        session.sessionId,
        buildAssistantProviderTranscriptAuditEntries({
          error,
          rawToolEvents: attemptMetadata.rawToolEvents,
          routeLabel: attemptPlan.route.label,
        }),
      ).catch(() => undefined)
    }

    await recordCodexAttemptFailed({
      activityLabels: attemptMetadata.activityLabels,
      attemptCount: attemptPlan.attemptCount,
      detail: errorMessage(error),
      errorCode,
      route: attemptPlan.route,
      sessionId: session.sessionId,
      turnId: executionPlan.turnId,
      vault: executionPlan.input.vault,
    })

    return {
      kind: 'failed_terminal',
      attemptCount: attemptPlan.attemptCount,
      error,
      providerRequestOutcome:
        failedAttemptOutcome ??
        resolveFailedAssistantProviderRequestOutcome({
          error,
          rawEvents: failedAttemptRawEvents,
          usage: failedAttemptUsage,
        }),
      codexContinuation: attemptPlan.routePlan.codexContinuation,
      codexRolloutRelativePath: failedAttemptCodexRolloutRelativePath,
      codexThreadId: failedAttemptCodexThreadId,
      acceptedNoReplyDeliveryContextOrdinals:
        failedAttemptAcceptedNoReplyDeliveryContextOrdinals,
      reactions: failedAttemptReactions,
      providerTurnId: failedAttemptProviderTurnId,
      rawEvents: failedAttemptRawEvents,
      session,
      usage: failedAttemptUsage,
      additionalUsages: failedAttemptAdditionalUsages,
      usageAttribution,
    }
  }
}

function normalizeAssistantProviderAttemptMetadata(
  metadata: AssistantProviderAttemptMetadata,
): AssistantProviderAttemptMetadata {
  return {
    ...metadata,
    rawToolEvents: metadata.rawToolEvents ?? [],
    runtimeIssueInputs: metadata.runtimeIssueInputs ?? [],
  }
}

function notifyProviderRequestStartedBestEffort(input: {
  event: {
    providerRequestOrdinal: number | null
    startedAt: string
  } & AssistantProviderRequestStartTiming
  hook?: ((event: {
    providerRequestOrdinal: number | null
    startedAt: string
  } & AssistantProviderRequestStartTiming) => Promise<void> | void) | null
}): void {
  if (!input.hook) {
    return
  }

  try {
    void Promise.resolve(input.hook(input.event)).catch(() => {
      // Provider-start hooks are diagnostic-only and must not block turns.
    })
  } catch {
    // Provider-start hooks are diagnostic-only and must not block turns.
  }
}

function resolveFailedAssistantProviderRequestOutcome(input: {
  error: unknown
  rawEvents: readonly unknown[]
  usage: AssistantProviderUsage | null
}): Exclude<AssistantProviderRequestOutcome, 'succeeded'> {
  if (isAssistantProviderAbortError(input.error)) {
    return 'aborted'
  }

  return input.usage && input.rawEvents.length > 0 ? 'partial' : 'failed'
}

function isAssistantProviderAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const code = 'code' in error ? (error as { code?: unknown }).code : null
  if (typeof code === 'string') {
    const normalizedCode = code.toUpperCase()
    if (
      normalizedCode.includes('ABORT') ||
      normalizedCode.includes('CANCEL') ||
      normalizedCode.includes('INTERRUPT')
    ) {
      return true
    }
  }

  const name = 'name' in error ? (error as { name?: unknown }).name : null
  return typeof name === 'string' && name === 'AbortError'
}

function classifyProviderRuntimeIssueKind(error: unknown): AssistantRuntimeIssueInput['issueKind'] {
  if (isAssistantProviderAbortError(error)) {
    return 'timeout'
  }

  const code = readAssistantErrorCode(error)?.toLowerCase() ?? ''
  if (/\b(?:schema|contract|validation|invalid|parse|strict|rejected|unsupported)\b/u.test(code)) {
    return 'schema_rejection'
  }

  return 'tool_error'
}

function countBucket(value: number):
  | '0'
  | '1'
  | '2_5'
  | '6_20'
  | 'gt_20' {
  if (value <= 0) {
    return '0'
  }
  if (value === 1) {
    return '1'
  }
  if (value <= 5) {
    return '2_5'
  }
  if (value <= 20) {
    return '6_20'
  }
  return 'gt_20'
}

function resolveCodexAttemptServiceTier(input: {
  env: NodeJS.ProcessEnv
  executionContext: AssistantCodexTurnExecutionPlan['executionContext']
  requestedServiceTier: AssistantProviderServiceTier | null
  routeModel: string | null
  routeModelProvider: string | null
}): AssistantProviderServiceTier | null {
  if (input.requestedServiceTier === null) {
    return null
  }
  if (!input.executionContext?.hosted) {
    return null
  }
  if (resolveCodexAssistantProviderTokenPricingBasis({
    model: input.routeModel,
    modelProvider: input.routeModelProvider,
    serviceTier: input.requestedServiceTier,
  }) !== 'openai-flex') {
    return null
  }
  return hasHostedCodexModelCatalogFlexTier({
    env: input.env,
    model: input.routeModel,
  })
    ? input.requestedServiceTier
    : null
}

function composeAssistantProviderFlexDeadlineSignal(
  signal: AbortSignal | undefined,
): AbortSignal {
  const deadline = AbortSignal.timeout(ASSISTANT_PROVIDER_FLEX_TURN_DEADLINE_MS)
  return signal ? AbortSignal.any([signal, deadline]) : deadline
}

function readAssistantErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null
  }

  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && code.trim().length > 0 ? code : null
}

function resolveCodexRouteUserMessageContent(input: {
  route: CodexThreadIdentity
  userMessageContent: readonly AssistantUserMessageContentPart[] | null | undefined
}): AssistantUserMessageContentPart[] | null {
  const normalized = normalizeAssistantUserMessageContent(input.userMessageContent)
  if (normalized === null) {
    return null
  }

  if (!hasAssistantRichUserMessageContent(normalized)) {
    return normalized
  }

  const supportedTypes = new Set(
    resolveCodexAssistantTargetCapabilities(
      input.route.providerOptions,
    ).supportedUserMessageContentTypes,
  )
  const supported = normalized.filter((part) => supportedTypes.has(part.type))

  return hasAssistantRichUserMessageContent(supported) ? supported : null
}

function normalizeAssistantUserMessageContent(
  userMessageContent: readonly AssistantUserMessageContentPart[] | null | undefined,
): AssistantUserMessageContentPart[] | null {
  if (!Array.isArray(userMessageContent) || userMessageContent.length === 0) {
    return null
  }

  return [...userMessageContent]
}

function hasAssistantRichUserMessageContent(
  userMessageContent: readonly AssistantUserMessageContentPart[],
): boolean {
  return userMessageContent.some((part) => part.type !== 'text')
}
