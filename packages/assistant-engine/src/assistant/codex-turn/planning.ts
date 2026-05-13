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
  resolveAssistantProviderResumeKey,
  resolveAssistantRouteResumeBinding,
} from '../codex-resume-binding.js'
import {
  readAssistantSessionResumeState,
} from '../provider-state.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
} from '../service-contracts.js'
import type {
  AssistantActiveTurnLiveProviderSteering,
} from '../turn-input.js'
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
}): Promise<AssistantRouteTurnPlan> {
  const workingDirectory = input.sharedPlan.requestedWorkingDirectory
  const resumeBinding = resolveAssistantRouteResumeBinding({
    route: input.route,
    sessionResumeState: readAssistantSessionResumeState(input.session),
  })
  const routeProviderCapabilities = resolveCodexAssistantTargetCapabilities({
    ...input.route.providerOptions,
  })
  const activeTurnHistory = input.activeTurnHistory ?? null
  const nativeResumeEnabled =
    input.profile.threadScope === 'session-thread'
  const candidateResumeCodexThreadId =
    nativeResumeEnabled &&
    routeProviderCapabilities.supportsNativeResume &&
    resumeBinding !== null
      ? resolveAssistantEffectiveCodexResumeThreadId({
          resumeCodexThreadId: resolveAssistantProviderResumeKey({
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
  const bootstrapAssistantCliContract = shouldPrepareConversationThreadInstructions
    ? await resolveAssistantCliSurfaceBootstrapContext({
        cliEnv: input.sharedPlan.cliAccess.env,
        executionContext: input.input.executionContext,
        sessionId: input.session.sessionId,
        vault: input.input.vault,
        workingDirectory,
      })
    : null
  const assistantSupportedExperimentProtocols =
    input.profile.promptProfile === 'conversation'
      ? resolveAssistantSupportedExperimentProtocols()
      : []
  const bootstrapVaultOverview = shouldPrepareAnyBootstrapContext
    ? await resolveAssistantVaultOverviewBlock(input.input.vault)
    : null
  const activeExperimentContext = input.sharedPlan.allowSensitiveHealthContext
    ? await resolveAssistantActiveExperimentContextBlock(input.input.vault)
    : null
  const modelBehaviorProfile = resolveAssistantModelBehaviorProfile(
    input.route.providerOptions,
  )
  const toolSchemaHash = null
  const buildRouteSystemPromptResult = (options: {
    assistantCliContract: string | null
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
  const systemPromptResult = buildRouteSystemPromptResult({
    assistantCliContract: actualAssistantCliContract,
    injectBootstrapContext: shouldPrepareBootstrapContext,
    injectOnboardingGuidance: shouldInjectOnboardingGuidance,
  })
  const freshThreadFallbackPromptResult = shouldPrepareFreshThreadFallback
    ? buildRouteSystemPromptResult({
        assistantCliContract: bootstrapAssistantCliContract,
        injectBootstrapContext: true,
        injectOnboardingGuidance: shouldInjectOnboardingGuidance,
      })
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
