import type {
  AssistantSession,
  AssistantTurnTrigger,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  normalizeIanaTimeZone,
  resolveSystemTimeZone,
  toLocalDayKey,
} from '@murphai/contracts'
import { loadVault } from '@murphai/core'
import {
  listGeneratedAssistantProtocolIndexEntries,
} from '@murphai/health-commons/runtime'
import {
  resolveCodexAssistantTargetCapabilities,
} from '../codex-runtime.js'
import { buildAssistantActiveExperimentContextBlock } from '../active-experiment-context.js'
import {
  resolveAssistantCliSurfaceBootstrapContext,
} from '../cli-surface-bootstrap.js'
import {
  normalizeAssistantExecutionContext,
  type AssistantHostedDeviceConnectProvider,
} from '../execution-context.js'
import {
  type CodexThreadIdentity,
} from '../codex-thread-route.js'
import {
  resolveAssistantDiagnosticsPolicy,
  type AssistantDiagnosticsPolicy,
} from '../issue-reporting.js'
import { createAssistantMemoryTurnContextEnv } from '../memory/turn-context.js'
import { resolveAssistantModelBehaviorProfile } from '../model-behavior.js'
import {
  resolveAssistantCodexResumeThreadId,
  resolveAssistantRouteResumeBinding,
} from '../codex-resume-binding.js'
import {
  readAssistantCodexResume,
} from '../conversation-persistence.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
} from '../service-contracts.js'
import type {
  AssistantActiveTurnLiveProviderSteering,
} from '../turn-input.js'
import type {
  AssistantProgressDelivery,
} from '../turn-progress.js'
import {
  buildAssistantNotificationDecisionSystemPromptWithCacheMetadata,
  buildAssistantSystemPromptWithCacheMetadata,
  resolveAssistantMurphProductBaseUrl,
  type AssistantPromptCacheMetadata,
} from '../system-prompt.js'
import { buildAssistantVaultOverviewBlock } from '../vault-overview.js'
import {
  type AssistantActiveTurnProviderHistory,
  type AssistantActiveTurnProviderHistoryMessage,
} from '../active-turn-history.js'
import type {
  AssistantCodexContinuation,
} from '../active-turn-input-journal.js'
import { normalizeNullableString } from '../shared.js'

export interface AssistantRouteTurnPlan {
  assistantCliContract: string | null
  cliEnv: NodeJS.ProcessEnv
  developerInstructions: string | null
  activeTurnMessages?: readonly AssistantActiveTurnProviderHistoryMessage[]
  diagnosticsPolicy: AssistantDiagnosticsPolicy
  freshThreadFallback?: AssistantRouteFreshThreadFallbackPlan
  onboardingGuidanceInjected: boolean
  codexContinuation: AssistantCodexContinuation
  planningDiagnostics: AssistantRoutePlanningDiagnostics
  refreshThreadInstructions: boolean
  resumeCodexThreadId: string | null
  sessionContext?: {
    binding: AssistantSession['binding']
  }
  promptCacheMetadata: AssistantPromptCacheMetadata | null
  systemPrompt: string | null
  turnContextPrompt: string | null
  workingDirectory: string
}

export interface AssistantRoutePlanningDiagnostics {
  activeExperimentContextElapsedMs: number | null
  allowSensitiveHealthContext: boolean
  cliBootstrapElapsedMs: number | null
  primarySystemPromptElapsedMs: number | null
  routePlanningElapsedMs: number
  routePlanningMeasuredElapsedMs: number
  routePlanningSlowestStage: AssistantRoutePlanningStage | null
  routePlanningSlowestStageElapsedMs: number | null
  routePlanningUnaccountedElapsedMs: number
  routeResumeBindingElapsedMs: number | null
  routeTargetCapabilitiesElapsedMs: number | null
  shouldPrepareAnyBootstrapContext: boolean
  shouldPrepareBootstrapContext: boolean
  shouldPrepareFreshThreadFallback: boolean
  supportedExperimentProtocolsElapsedMs: number | null
  freshThreadFallbackPromptElapsedMs: number | null
  vaultOverviewElapsedMs: number | null
}

type AssistantRoutePlanningSpanKey =
  | 'activeExperimentContextElapsedMs'
  | 'cliBootstrapElapsedMs'
  | 'freshThreadFallbackPromptElapsedMs'
  | 'primarySystemPromptElapsedMs'
  | 'routeResumeBindingElapsedMs'
  | 'routeTargetCapabilitiesElapsedMs'
  | 'supportedExperimentProtocolsElapsedMs'
  | 'vaultOverviewElapsedMs'

type AssistantRoutePlanningSpanMetrics = Partial<
  Record<AssistantRoutePlanningSpanKey, number>
>

export type AssistantRoutePlanningStage =
  | 'active_experiment_context'
  | 'cli_bootstrap'
  | 'fallback_instructions'
  | 'memory_overview'
  | 'primary_instructions'
  | 'resume_binding'
  | 'supported_experiment_protocols'
  | 'target_capabilities'

const ASSISTANT_ROUTE_PLANNING_SPAN_STAGES: readonly {
  key: AssistantRoutePlanningSpanKey
  stage: AssistantRoutePlanningStage
}[] = [
  {
    key: 'activeExperimentContextElapsedMs',
    stage: 'active_experiment_context',
  },
  {
    key: 'cliBootstrapElapsedMs',
    stage: 'cli_bootstrap',
  },
  {
    key: 'freshThreadFallbackPromptElapsedMs',
    stage: 'fallback_instructions',
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
  {
    key: 'supportedExperimentProtocolsElapsedMs',
    stage: 'supported_experiment_protocols',
  },
  {
    key: 'vaultOverviewElapsedMs',
    stage: 'memory_overview',
  },
]

export interface AssistantRouteFreshThreadFallbackPlan {
  developerInstructions: string | null
  sessionContext?: {
    binding: AssistantSession['binding']
  }
  turnContextPrompt: string | null
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

export type AssistantCodexTurnToolProfile =
  | 'provider-turn'
  | 'notification-turn'

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

export interface AssistantCodexThreadPlan {
  onboardingGuidanceInjected: boolean
  resumeCodexThreadId: string | null
  shouldInjectBootstrapContext: boolean
}

export interface AssistantCodexTurnExecutionPlan {
  activeTurnSteering: AssistantActiveTurnLiveProviderSteering | null
  activeTurnHistory: AssistantActiveTurnProviderHistory | null
  executionContext: ReturnType<typeof normalizeAssistantExecutionContext>
  input: AssistantMessageInput
  memoryTurnEnv: NodeJS.ProcessEnv
  profile: AssistantCodexTurnResolvedExecutionProfile
  promptTimeContext: AssistantPromptTimeContext
  route: CodexThreadIdentity
  sharedPlan: AssistantTurnSharedPlan
  modelProgressUpdatesEnabled: boolean
  progressDelivery?: AssistantProgressDelivery | null
  turnId: string
}

export interface AssistantCodexAttemptPlan {
  attemptCount: number
  route: CodexThreadIdentity
  routePlan: AssistantRouteTurnPlan
  session: AssistantSession
}

export function resolveAssistantCodexThreadPlan(input: {
  candidateResumeCodexThreadId: string | null
  onboardingGuidanceOpen: boolean
  promptProfile: AssistantCodexTurnPromptProfile
}): AssistantCodexThreadPlan {
  const resumeCodexThreadId = input.candidateResumeCodexThreadId
  const shouldInjectBootstrapContext = resumeCodexThreadId === null
  const onboardingGuidanceInjected =
    input.promptProfile === 'conversation' &&
    input.onboardingGuidanceOpen

  return {
    onboardingGuidanceInjected,
    resumeCodexThreadId,
    shouldInjectBootstrapContext,
  }
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
  activeTurnHistory?: AssistantActiveTurnProviderHistory | null
  activeTurnSteering?: AssistantActiveTurnLiveProviderSteering | null
  input: AssistantMessageInput
  plan: AssistantTurnSharedPlan
  profile?: AssistantCodexTurnThreadScopeProfile | null
  resolvedSession: AssistantSession
  route: CodexThreadIdentity
  modelProgressUpdatesEnabled?: boolean | null
  progressDelivery?: AssistantProgressDelivery | null
  turnCreatedAt: string
  turnId: string
}): Promise<AssistantCodexTurnExecutionPlan> {
  const executionContext = normalizeAssistantExecutionContext(input.input.executionContext)
  const memoryTurnEnv = createAssistantMemoryTurnContextEnv({
    allowSensitiveHealthContext: input.plan.allowSensitiveHealthContext,
    sessionId: input.resolvedSession.sessionId,
    sourcePrompt: input.input.prompt,
    turnId: `${input.resolvedSession.sessionId}:${input.turnCreatedAt}`,
    vault: input.input.vault,
  })
  const profile = resolveAssistantCodexTurnExecutionProfile({
    profile: input.profile,
    turnTrigger: input.input.turnTrigger,
  })
  const promptTimeContext = await resolveAssistantPromptTimeContext(input.input.vault)

  return {
    activeTurnSteering: input.activeTurnSteering ?? null,
    executionContext,
    activeTurnHistory: input.activeTurnHistory ?? null,
    input: input.input,
    memoryTurnEnv,
    profile,
    promptTimeContext,
    route: input.route,
    sharedPlan: input.plan,
    modelProgressUpdatesEnabled: input.modelProgressUpdatesEnabled === true,
    progressDelivery: input.progressDelivery ?? null,
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
      executionContext: input.executionPlan.executionContext,
      activeTurnHistory: input.executionPlan.activeTurnHistory,
      input: input.executionPlan.input,
      profile: input.executionPlan.profile,
      promptTimeContext: input.executionPlan.promptTimeContext,
      route,
      session: input.session,
      sharedPlan: input.executionPlan.sharedPlan,
      modelProgressUpdatesEnabled: input.executionPlan.modelProgressUpdatesEnabled,
      progressDelivery: input.executionPlan.progressDelivery ?? null,
    }),
    session: input.session,
  }
}

export async function resolveAssistantRouteTurnPlan(input: {
  activeTurnHistory?: AssistantActiveTurnProviderHistory | null
  executionContext: ReturnType<typeof normalizeAssistantExecutionContext> | null
  input: AssistantMessageInput
  profile: AssistantCodexTurnResolvedExecutionProfile
  promptTimeContext: AssistantPromptTimeContext
  route: CodexThreadIdentity
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
  modelProgressUpdatesEnabled?: boolean | null
  progressDelivery?: AssistantProgressDelivery | null
}): Promise<AssistantRouteTurnPlan> {
  const routePlanningStartedAt = Date.now()
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
  const activeTurnHistory = input.activeTurnHistory ?? null
  const nativeResumeEnabled =
    input.profile.threadScope === 'session-thread'
  const candidateResumeCodexThreadId =
    nativeResumeEnabled &&
    routeProviderCapabilities.supportsNativeResume &&
    resumeBinding !== null
      ? resolveAssistantEffectiveCodexResumeThreadId({
          resumeCodexThreadId: resolveAssistantCodexResumeThreadId({
            resumeState: resumeBinding,
          }),
        })
      : null
  const threadPlan = resolveAssistantCodexThreadPlan({
    candidateResumeCodexThreadId,
    onboardingGuidanceOpen: input.sharedPlan.onboardingGuidanceOpen,
    promptProfile: input.profile.promptProfile,
  })
  const resumeCodexThreadId = threadPlan.resumeCodexThreadId
  const shouldInjectBootstrapContext = threadPlan.shouldInjectBootstrapContext
  const shouldPrepareBootstrapContext = shouldInjectBootstrapContext
  const shouldPrepareFreshThreadFallback = resumeCodexThreadId !== null
  const shouldPrepareAnyBootstrapContext =
    shouldPrepareBootstrapContext || shouldPrepareFreshThreadFallback
  const resolvedChannel = input.input.channel ?? input.session.binding.channel
  const diagnosticsPolicy = resolveAssistantDiagnosticsPolicy({
    channel: resolvedChannel,
    executionContext: input.input.executionContext,
  })
  const shouldInjectOnboardingGuidance =
    threadPlan.onboardingGuidanceInjected
  const assistantToolNameAliases = null
  const promptCapabilityAvailability = resolveAssistantPromptCapabilityAvailability({
    executionContext: input.executionContext,
  })
  const shouldPrepareConversationThreadInstructions =
    shouldPrepareAnyBootstrapContext && input.profile.promptProfile === 'conversation'
  let cliBootstrapElapsedMs: number | null = null
  const bootstrapAssistantCliContract = shouldPrepareConversationThreadInstructions
    ? await measureRoutePlanningAsync(
        routePlanningSpans,
        'cliBootstrapElapsedMs',
        () => resolveAssistantCliSurfaceBootstrapContext({
          cliEnv: input.sharedPlan.cliAccess.env,
          executionContext: input.input.executionContext,
          sessionId: input.session.sessionId,
          vault: input.input.vault,
          workingDirectory,
        }),
        (elapsedMs) => {
          cliBootstrapElapsedMs = elapsedMs
        },
      )
    : null
  const assistantSupportedExperimentProtocols =
    input.profile.promptProfile === 'conversation'
      ? measureRoutePlanningSync(
          routePlanningSpans,
          'supportedExperimentProtocolsElapsedMs',
          () => resolveAssistantSupportedExperimentProtocols(),
        )
      : []
  let vaultOverviewElapsedMs: number | null = null
  const bootstrapVaultOverview = shouldPrepareAnyBootstrapContext
    ? await measureRoutePlanningAsync(
        routePlanningSpans,
        'vaultOverviewElapsedMs',
        () => resolveAssistantVaultOverviewBlock(input.input.vault),
        (elapsedMs) => {
          vaultOverviewElapsedMs = elapsedMs
        },
      )
    : null
  let activeExperimentContextElapsedMs: number | null = null
  const activeExperimentContext = input.sharedPlan.allowSensitiveHealthContext
    ? await measureRoutePlanningAsync(
        routePlanningSpans,
        'activeExperimentContextElapsedMs',
        () => resolveAssistantActiveExperimentContextBlock(input.input.vault),
        (elapsedMs) => {
          activeExperimentContextElapsedMs = elapsedMs
        },
      )
    : null
  const modelBehaviorProfile = resolveAssistantModelBehaviorProfile(
    input.route.providerOptions,
  )
  const toolSchemaHash = null
  const buildRouteSystemPromptResult = (options: {
    assistantCliContract: string | null
    assistantModelProgressUpdatesAvailable: boolean
    injectBootstrapContext: boolean
    injectOnboardingGuidance: boolean
  }) =>
    input.profile.promptProfile === 'notification-decision'
      ? buildAssistantNotificationDecisionSystemPromptWithCacheMetadata({
            activeExperimentContext,
            allowSensitiveHealthContext:
              input.sharedPlan.allowSensitiveHealthContext,
            assistantHostedDeviceConnectAvailable:
              promptCapabilityAvailability.assistantHostedDeviceConnectAvailable,
            assistantHostedDeviceConnectProviders:
              promptCapabilityAvailability.assistantHostedDeviceConnectProviders,
            assistantToolNameAliases,
            channel: resolvedChannel,
            currentLocalDate: input.promptTimeContext.currentLocalDate,
            currentTimeZone: input.promptTimeContext.currentTimeZone,
            vaultOverview: options.injectBootstrapContext
              ? bootstrapVaultOverview
              : null,
          }, {
            toolSchemaHash,
          })
      : buildAssistantSystemPromptWithCacheMetadata({
            activeExperimentContext,
            assistantCliContract: options.assistantCliContract,
            allowSensitiveHealthContext:
              input.sharedPlan.allowSensitiveHealthContext,
            assistantHostedDeviceConnectAvailable:
              promptCapabilityAvailability.assistantHostedDeviceConnectAvailable,
            assistantHostedDeviceConnectProviders:
              promptCapabilityAvailability.assistantHostedDeviceConnectProviders,
            assistantKnowledgeToolsAvailable:
              promptCapabilityAvailability.assistantKnowledgeToolsAvailable,
            assistantSupportedExperimentProtocols,
            assistantToolNameAliases,
            assistantModelProgressUpdatesAvailable:
              options.assistantModelProgressUpdatesAvailable,
            cliAccess: input.sharedPlan.cliAccess,
            channel: resolvedChannel,
            currentLocalDate: input.promptTimeContext.currentLocalDate,
            currentTimeZone: input.promptTimeContext.currentTimeZone,
            murphProductBaseUrl: resolveAssistantMurphProductBaseUrl(
              input.sharedPlan.cliAccess.env,
            ),
            onboardingGuidance: options.injectOnboardingGuidance,
            modelBehaviorProfile,
            turnTrigger: input.input.turnTrigger ?? null,
            vaultOverview: options.injectBootstrapContext
              ? bootstrapVaultOverview
              : null,
          }, {
            toolSchemaHash,
          })
  const buildDeveloperInstructions = (
    promptResult: ReturnType<typeof buildAssistantSystemPromptWithCacheMetadata>,
  ) =>
    [
      promptResult.layers.staticCacheableCorePrompt,
      promptResult.layers.stableRouteCapabilityPrompt,
    ]
      .filter((section): section is string =>
        Boolean(normalizeNullableString(section)),
      )
      .join('\n\n')
  const actualAssistantCliContract = shouldPrepareBootstrapContext
    ? bootstrapAssistantCliContract
    : null
  const systemPromptResult = measureRoutePlanningSync(
    routePlanningSpans,
    'primarySystemPromptElapsedMs',
    () => buildRouteSystemPromptResult({
      assistantCliContract: actualAssistantCliContract,
      assistantModelProgressUpdatesAvailable:
        input.modelProgressUpdatesEnabled === true,
      injectBootstrapContext: shouldPrepareBootstrapContext,
      injectOnboardingGuidance: shouldInjectOnboardingGuidance,
    }),
  )
  const freshThreadFallbackPromptResult = shouldPrepareFreshThreadFallback
    ? measureRoutePlanningSync(
        routePlanningSpans,
        'freshThreadFallbackPromptElapsedMs',
        () => buildRouteSystemPromptResult({
          assistantCliContract: bootstrapAssistantCliContract,
          assistantModelProgressUpdatesAvailable:
            input.modelProgressUpdatesEnabled === true,
          injectBootstrapContext: true,
          injectOnboardingGuidance: shouldInjectOnboardingGuidance,
        }),
      )
    : null
  const refreshThreadInstructions = resumeCodexThreadId === null
  const systemPrompt = systemPromptResult.prompt
  const developerInstructions =
    resumeCodexThreadId === null
      ? buildDeveloperInstructions(systemPromptResult)
      : null
  const turnContextPrompt = normalizeNullableString(
    systemPromptResult.layers.dynamicTurnContextPrompt,
  )
  const freshThreadFallback = freshThreadFallbackPromptResult
    ? {
        developerInstructions: normalizeNullableString(
          buildDeveloperInstructions(freshThreadFallbackPromptResult),
        ),
        sessionContext: {
          binding: input.session.binding,
        },
        turnContextPrompt: normalizeNullableString(
          freshThreadFallbackPromptResult.layers.dynamicTurnContextPrompt,
        ),
      }
    : undefined
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
    assistantCliContract: actualAssistantCliContract,
    cliEnv: input.sharedPlan.cliAccess.env,
    developerInstructions: normalizeNullableString(developerInstructions),
    activeTurnMessages: activeTurnHistory?.messages ?? undefined,
    diagnosticsPolicy,
    freshThreadFallback,
    onboardingGuidanceInjected: shouldInjectOnboardingGuidance,
    codexContinuation: resolveAssistantCodexContinuation({
      resumeCodexThreadId,
    }),
    planningDiagnostics: {
      activeExperimentContextElapsedMs,
      allowSensitiveHealthContext: input.sharedPlan.allowSensitiveHealthContext,
      cliBootstrapElapsedMs,
      primarySystemPromptElapsedMs:
        routePlanningSpans.primarySystemPromptElapsedMs ?? null,
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
      shouldPrepareAnyBootstrapContext,
      shouldPrepareBootstrapContext,
      shouldPrepareFreshThreadFallback,
      supportedExperimentProtocolsElapsedMs:
        routePlanningSpans.supportedExperimentProtocolsElapsedMs ?? null,
      freshThreadFallbackPromptElapsedMs:
        routePlanningSpans.freshThreadFallbackPromptElapsedMs ?? null,
      vaultOverviewElapsedMs,
    },
    refreshThreadInstructions,
    resumeCodexThreadId,
    sessionContext: shouldPrepareBootstrapContext
      ? {
          binding: input.session.binding,
        }
      : undefined,
    promptCacheMetadata: systemPromptResult.cacheMetadata,
    workingDirectory,
    systemPrompt,
    turnContextPrompt,
  }
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

function resolveAssistantSupportedExperimentProtocols() {
  try {
    return listGeneratedAssistantProtocolIndexEntries()
  } catch {
    return []
  }
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

export async function resolveAssistantVaultOverviewBlock(
  vaultRoot: string,
): Promise<string | null> {
  try {
    return await buildAssistantVaultOverviewBlock(vaultRoot)
  } catch {
    return null
  }
}

export async function resolveAssistantActiveExperimentContextBlock(
  vaultRoot: string,
): Promise<string | null> {
  try {
    return await buildAssistantActiveExperimentContextBlock(vaultRoot)
  } catch {
    return null
  }
}

export function resolveAssistantPromptCapabilityAvailability(input: {
  executionContext: ReturnType<typeof normalizeAssistantExecutionContext> | null
}): AssistantPromptCapabilityAvailability {
  const assistantHostedDeviceConnectProviders =
    input.executionContext?.hosted?.deviceConnectProviders ?? []
  const assistantHostedDeviceConnectAvailable =
    assistantHostedDeviceConnectProviders.length > 0 &&
    typeof input.executionContext?.hosted?.issueDeviceConnectLink === 'function'

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
