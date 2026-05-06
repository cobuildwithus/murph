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
} from '../provider-registry.js'
import { buildAssistantActiveExperimentContextBlock } from '../active-experiment-context.js'
import {
  readPersistedAssistantCliSurfaceBootstrapContext,
  resolveAssistantCliSurfaceBootstrapContext,
} from '../cli-surface-bootstrap.js'
import {
  normalizeAssistantExecutionContext,
  type AssistantHostedDeviceConnectProvider,
} from '../execution-context.js'
import {
  type CodexThreadIdentity,
} from '../provider-route.js'
import {
  resolveAssistantDiagnosticsPolicy,
  type AssistantDiagnosticsPolicy,
} from '../issue-reporting.js'
import { createAssistantMemoryTurnContextEnv } from '../memory/turn-context.js'
import { resolveAssistantModelBehaviorProfile } from '../model-behavior.js'
import {
  resolveAssistantProviderResumeKey,
  resolveAssistantRouteResumeBinding,
} from '../provider-binding.js'
import { listAssistantTranscriptEntries } from '../store.js'
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
  type AssistantPromptCacheMetadata,
} from '../system-prompt.js'
import { buildAssistantVaultOverviewBlock } from '../vault-overview.js'
import {
  type AssistantActiveTurnProviderHistory,
  type AssistantActiveTurnProviderHistoryMessage,
} from '../active-turn-history.js'
import type {
  AssistantProviderContinuation,
} from '../active-turn-input-journal.js'
import { normalizeNullableString } from '../shared.js'

export interface AssistantRouteTurnPlan {
  assistantCliContract: string | null
  cliEnv: NodeJS.ProcessEnv
  developerInstructions: string | null
  conversationMessages?: ReadonlyArray<{
    content: string | AssistantActiveTurnProviderHistoryMessage['content']
    role: 'assistant' | 'user'
  }>
  activeTurnMessages?: readonly AssistantActiveTurnProviderHistoryMessage[]
  continuityContext: string | null
  diagnosticsPolicy: AssistantDiagnosticsPolicy
  onboardingGuidanceInjected: boolean
  providerContinuation: AssistantProviderContinuation
  refreshThreadInstructions: boolean
  resumeProviderSessionId: string | null
  sessionContext?: {
    binding: AssistantSession['binding']
  }
  promptCacheMetadata: AssistantPromptCacheMetadata | null
  systemPrompt: string | null
  threadInstructionsFingerprint: string | null
  turnContextPrompt: string | null
  workingDirectory: string
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

export type AssistantProviderTurnPromptProfile =
  | 'conversation'
  | 'notification-decision'

export type AssistantProviderTurnToolProfile =
  | 'provider-turn'
  | 'notification-turn'

export type AssistantProviderThreadScope =
  | 'session-thread'
  | 'isolated-thread'

export type AssistantProviderTurnNativeResumePolicy =
  | 'default'
  | 'disabled'

export interface AssistantProviderTurnExecutionProfile {
  nativeResumePolicy?: AssistantProviderTurnNativeResumePolicy
  promptProfile?: AssistantProviderTurnPromptProfile
  threadScope?: AssistantProviderThreadScope
  toolProfile?: AssistantProviderTurnToolProfile
}

export interface AssistantProviderTurnThreadScopeProfile
  extends AssistantProviderTurnExecutionProfile {}

export type AssistantProviderTurnResolvedExecutionProfile =
  Required<Omit<AssistantProviderTurnExecutionProfile, 'nativeResumePolicy'>>

export interface AssistantProviderThreadPlan {
  onboardingGuidanceInjected: boolean
  resumeProviderSessionId: string | null
  shouldInjectBootstrapContext: boolean
}

export interface AssistantProviderTurnExecutionPlan {
  activeTurnSteering: AssistantActiveTurnLiveProviderSteering | null
  activeTurnHistory: AssistantActiveTurnProviderHistory | null
  executionContext: ReturnType<typeof normalizeAssistantExecutionContext>
  input: AssistantMessageInput
  memoryTurnEnv: NodeJS.ProcessEnv
  profile: AssistantProviderTurnResolvedExecutionProfile
  promptTimeContext: AssistantPromptTimeContext
  route: CodexThreadIdentity
  sharedPlan: AssistantTurnSharedPlan
  turnId: string
}

export interface AssistantProviderAttemptPlan {
  attemptCount: number
  route: CodexThreadIdentity
  routePlan: AssistantRouteTurnPlan
  session: AssistantSession
}

export function resolveAssistantProviderThreadPlan(input: {
  candidateResumeProviderSessionId: string | null
  onboardingGuidanceOpen: boolean
  promptProfile: AssistantProviderTurnPromptProfile
}): AssistantProviderThreadPlan {
  const resumeProviderSessionId = input.candidateResumeProviderSessionId
  const shouldInjectBootstrapContext = resumeProviderSessionId === null
  const onboardingGuidanceInjected =
    input.promptProfile === 'conversation' &&
    input.onboardingGuidanceOpen

  return {
    onboardingGuidanceInjected,
    resumeProviderSessionId,
    shouldInjectBootstrapContext,
  }
}

function resolveAssistantProviderTurnExecutionProfile(
  input: {
    profile: AssistantProviderTurnThreadScopeProfile | null | undefined
    turnTrigger: AssistantTurnTrigger | null | undefined
  },
): AssistantProviderTurnResolvedExecutionProfile {
  const threadScope = resolveAssistantProviderThreadScope({
    profile: input.profile,
    turnTrigger: input.turnTrigger,
  })

  return {
    promptProfile: input.profile?.promptProfile ?? 'conversation',
    threadScope,
    toolProfile: input.profile?.toolProfile ?? 'provider-turn',
  }
}

export function resolveAssistantProviderThreadScope(input: {
  profile?: AssistantProviderTurnThreadScopeProfile | null
  turnTrigger?: AssistantTurnTrigger | null
}): AssistantProviderThreadScope {
  if (
    input.profile?.promptProfile === 'notification-decision' ||
    input.turnTrigger === 'automation-cron'
  ) {
    return 'isolated-thread'
  }

  if (
    input.profile?.threadScope === 'isolated-thread' ||
    input.profile?.nativeResumePolicy === 'disabled'
  ) {
    return 'isolated-thread'
  }

  return 'session-thread'
}

export async function buildAssistantProviderTurnExecutionPlan(input: {
  activeTurnHistory?: AssistantActiveTurnProviderHistory | null
  activeTurnSteering?: AssistantActiveTurnLiveProviderSteering | null
  input: AssistantMessageInput
  plan: AssistantTurnSharedPlan
  profile?: AssistantProviderTurnThreadScopeProfile | null
  resolvedSession: AssistantSession
  route: CodexThreadIdentity
  turnCreatedAt: string
  turnId: string
}): Promise<AssistantProviderTurnExecutionPlan> {
  const executionContext = normalizeAssistantExecutionContext(input.input.executionContext)
  const memoryTurnEnv = createAssistantMemoryTurnContextEnv({
    allowSensitiveHealthContext: input.plan.allowSensitiveHealthContext,
    sessionId: input.resolvedSession.sessionId,
    sourcePrompt: input.input.prompt,
    turnId: `${input.resolvedSession.sessionId}:${input.turnCreatedAt}`,
    vault: input.input.vault,
  })
  const profile = resolveAssistantProviderTurnExecutionProfile({
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

export async function buildCodexProviderAttemptPlan(input: {
  attemptCount: number
  executionPlan: AssistantProviderTurnExecutionPlan
  session: AssistantSession
}): Promise<AssistantProviderAttemptPlan> {
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
  profile: AssistantProviderTurnResolvedExecutionProfile
  promptTimeContext: AssistantPromptTimeContext
  route: CodexThreadIdentity
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
}): Promise<AssistantRouteTurnPlan> {
  const workingDirectory = input.sharedPlan.requestedWorkingDirectory
  const resumeBinding = resolveAssistantRouteResumeBinding({
    route: input.route,
    sessionResumeState: input.session.resumeState,
  })
  const routeProviderCapabilities = resolveCodexAssistantTargetCapabilities({
    ...input.route.providerOptions,
  })
  const activeTurnHistory = input.activeTurnHistory ?? null
  const nativeResumeEnabled =
    input.profile.threadScope === 'session-thread'
  const candidateResumeProviderSessionId =
    nativeResumeEnabled &&
    routeProviderCapabilities.supportsNativeResume &&
    resumeBinding !== null
      ? resolveAssistantEffectiveProviderResumeSessionId({
          resumeProviderSessionId: resolveAssistantProviderResumeKey({
            resumeState: resumeBinding,
          }),
        })
      : null
  const threadPlan = resolveAssistantProviderThreadPlan({
    candidateResumeProviderSessionId,
    onboardingGuidanceOpen: input.sharedPlan.onboardingGuidanceOpen,
    promptProfile: input.profile.promptProfile,
  })
  const resumeProviderSessionId = threadPlan.resumeProviderSessionId
  const shouldInjectBootstrapContext = threadPlan.shouldInjectBootstrapContext
  const shouldPrepareThreadInstructions =
    shouldInjectBootstrapContext ||
    resumeProviderSessionId !== null
  const shouldPrepareBootstrapContext = shouldInjectBootstrapContext
  const storedThreadInstructionsFingerprint = normalizeNullableString(
    resumeBinding?.threadInstructionsFingerprint,
  )
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
    shouldPrepareThreadInstructions && input.profile.promptProfile === 'conversation'
  const shouldTryPersistedThreadInstructions =
    shouldPrepareConversationThreadInstructions &&
    resumeProviderSessionId !== null &&
    storedThreadInstructionsFingerprint !== null
  let assistantCliContract = shouldTryPersistedThreadInstructions
    ? await readPersistedAssistantCliSurfaceBootstrapContext({
        sessionId: input.session.sessionId,
        vault: input.input.vault,
      })
    : shouldPrepareConversationThreadInstructions
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
  const vaultOverview = shouldPrepareBootstrapContext
    ? await resolveAssistantVaultOverviewBlock(input.input.vault)
    : null
  const activeExperimentContext = input.sharedPlan.allowSensitiveHealthContext
    ? await resolveAssistantActiveExperimentContextBlock(input.input.vault)
    : null
  const modelBehaviorProfile = resolveAssistantModelBehaviorProfile(
    input.route.providerOptions,
  )
  const toolSchemaHash = null
  const buildRouteSystemPromptResult = (routeAssistantCliContract: string | null) =>
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
            vaultOverview,
          }, {
            toolSchemaHash,
          })
      : buildAssistantSystemPromptWithCacheMetadata({
            activeExperimentContext,
            assistantCliContract: routeAssistantCliContract,
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
            onboardingGuidance: shouldInjectOnboardingGuidance,
            modelBehaviorProfile,
            turnTrigger: input.input.turnTrigger ?? null,
            vaultOverview,
          }, {
            toolSchemaHash,
          })
  let systemPromptResult = buildRouteSystemPromptResult(assistantCliContract)
  let threadInstructionsFingerprint =
    buildAssistantThreadInstructionsFingerprint(systemPromptResult.cacheMetadata)
  let refreshThreadInstructions =
    resumeProviderSessionId === null ||
    threadInstructionsFingerprint === null ||
    storedThreadInstructionsFingerprint !== threadInstructionsFingerprint
  if (shouldTryPersistedThreadInstructions && refreshThreadInstructions) {
    assistantCliContract = await resolveAssistantCliSurfaceBootstrapContext({
      cliEnv: input.sharedPlan.cliAccess.env,
      executionContext: input.input.executionContext,
      sessionId: input.session.sessionId,
      vault: input.input.vault,
      workingDirectory,
    })
    systemPromptResult = buildRouteSystemPromptResult(assistantCliContract)
    threadInstructionsFingerprint =
      buildAssistantThreadInstructionsFingerprint(systemPromptResult.cacheMetadata)
    refreshThreadInstructions =
      resumeProviderSessionId === null ||
      threadInstructionsFingerprint === null ||
      storedThreadInstructionsFingerprint !== threadInstructionsFingerprint
  }
  const systemPrompt = systemPromptResult.prompt
  const developerInstructions = [
    systemPromptResult.layers.staticCacheableCorePrompt,
    systemPromptResult.layers.stableRouteCapabilityPrompt,
  ]
    .filter((section): section is string => Boolean(normalizeNullableString(section)))
    .join('\n\n')
  const turnContextPrompt = normalizeNullableString(
    systemPromptResult.layers.dynamicTurnContextPrompt,
  )
  const conversationMessages = await resolveAssistantTranscriptConversationMessages({
    promptProfile: input.profile.promptProfile,
    resumeProviderSessionId,
    session: input.session,
    threadScope: input.profile.threadScope,
    vault: input.input.vault,
  })

  return {
    assistantCliContract,
    cliEnv: input.sharedPlan.cliAccess.env,
    developerInstructions: normalizeNullableString(developerInstructions),
    activeTurnMessages: activeTurnHistory?.messages ?? undefined,
    conversationMessages,
    continuityContext: null,
    diagnosticsPolicy,
    onboardingGuidanceInjected: shouldInjectOnboardingGuidance,
    providerContinuation: resolveAssistantProviderContinuation({
      resumeProviderSessionId,
    }),
    refreshThreadInstructions,
    resumeProviderSessionId,
    sessionContext: shouldPrepareBootstrapContext
      ? {
          binding: input.session.binding,
        }
      : undefined,
    promptCacheMetadata: systemPromptResult.cacheMetadata,
    workingDirectory,
    systemPrompt,
    threadInstructionsFingerprint,
    turnContextPrompt,
  }
}

export function buildAssistantThreadInstructionsFingerprint(
  metadata: AssistantPromptCacheMetadata | null,
): string | null {
  if (!metadata) {
    return null
  }

  return [
    'thread-instructions-v1',
    metadata.staticPromptHash,
    metadata.stableRouteCapabilityPromptHash,
  ].join(':')
}

async function resolveAssistantTranscriptConversationMessages(input: {
  promptProfile: AssistantProviderTurnPromptProfile
  resumeProviderSessionId: string | null
  session: Pick<AssistantSession, 'sessionId' | 'turnCount'>
  threadScope: AssistantProviderThreadScope
  vault: string
}): Promise<AssistantRouteTurnPlan['conversationMessages']> {
  if (
    input.promptProfile !== 'conversation' ||
    input.resumeProviderSessionId !== null ||
    input.session.turnCount <= 0 ||
    input.threadScope !== 'session-thread'
  ) {
    return undefined
  }

  const transcript = await listAssistantTranscriptEntries(
    input.vault,
    input.session.sessionId,
  )
  const messages = selectAssistantReplayMessages(transcript, 12)

  return messages.length > 0 ? messages : undefined
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

function resolveAssistantProviderContinuation(input: {
  resumeProviderSessionId: string | null
}): AssistantProviderContinuation {
  if (input.resumeProviderSessionId) {
    return {
      kind: 'provider-state-optimization',
    }
  }

  return {
    kind: 'thread-start',
  }
}

function resolveAssistantEffectiveProviderResumeSessionId(input: {
  resumeProviderSessionId: string | null
}): string | null {
  return normalizeNullableString(input.resumeProviderSessionId)
}

export function selectAssistantReplayMessages(
  entries: readonly {
    createdAt?: string | null
    kind: string
    text: string
  }[],
  limit: number,
): Array<{
  content: string
  role: 'assistant' | 'user'
}> {
  const replayLimit =
    typeof limit === 'number' && Number.isFinite(limit)
      ? Math.max(0, Math.trunc(limit))
      : 0
  if (replayLimit === 0) {
    return []
  }

  const replayMessages: Array<{
    content: string
    role: 'assistant' | 'user'
  }> = []
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const message = toAssistantReplayMessage(entries[index])
    if (!message) {
      continue
    }
    replayMessages.unshift(message)
    if (replayMessages.length >= replayLimit) {
      break
    }
  }

  return replayMessages
}

function toAssistantReplayMessage(entry: {
  createdAt?: string | null
  kind: string
  text: string
} | undefined): {
  content: string
  role: 'assistant' | 'user'
} | null {
  if (!entry) {
    return null
  }
  if (entry.kind === 'assistant' || entry.kind === 'user') {
    return {
      role: entry.kind,
      content: entry.text,
    }
  }
  return null
}
