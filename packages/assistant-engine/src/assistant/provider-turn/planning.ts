import type {
  AssistantOnboardingCompletionReason,
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
  resolveCodexAssistantTargetCapabilities,
} from '../provider-registry.js'
import { buildAssistantActiveExperimentContextBlock } from '../active-experiment-context.js'
import { resolveAssistantCliSurfaceBootstrapContext } from '../cli-surface-bootstrap.js'
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
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
} from '../service-contracts.js'
import type {
  AssistantActiveTurnLiveProviderSteering,
} from '../turn-input.js'
import {
  listAssistantTranscriptEntries,
} from '../store.js'
import {
  buildAssistantNotificationDecisionSystemPromptWithCacheMetadata,
  buildAssistantSystemPromptWithCacheMetadata,
  type AssistantPromptCacheMetadata,
} from '../system-prompt.js'
import { buildAssistantVaultOverviewBlock } from '../vault-overview.js'
import {
  hasAssistantActiveTurnProviderHistory,
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
  conversationMessages?: ReadonlyArray<{
    content: string | AssistantActiveTurnProviderHistoryMessage['content']
    role: 'assistant' | 'user'
  }>
  activeTurnMessages?: readonly AssistantActiveTurnProviderHistoryMessage[]
  continuityContext: string | null
  diagnosticsPolicy: AssistantDiagnosticsPolicy
  onboardingCompletionFallbackReason: AssistantOnboardingCompletionReason | null
  onboardingGuidanceInjected: boolean
  providerContinuation: AssistantProviderContinuation
  resumeProviderSessionId: string | null
  sessionContext?: {
    binding: AssistantSession['binding']
  }
  promptCacheMetadata: AssistantPromptCacheMetadata | null
  systemPrompt: string | null
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

export type AssistantProviderTurnContinuityPolicy =
  | 'continuous-provider-thread'
  | 'murph-history-only'

export type AssistantProviderTurnNativeResumePolicy =
  | 'default'
  | 'disabled'

export interface AssistantProviderTurnExecutionProfile {
  nativeResumePolicy?: AssistantProviderTurnNativeResumePolicy
  promptProfile?: AssistantProviderTurnPromptProfile
  toolProfile?: AssistantProviderTurnToolProfile
}

export interface AssistantProviderTurnContinuityProfile
  extends AssistantProviderTurnExecutionProfile {
  turnContinuityPolicy?: AssistantProviderTurnContinuityPolicy
}

export type AssistantProviderTurnResolvedExecutionProfile =
  Required<Omit<AssistantProviderTurnExecutionProfile, 'nativeResumePolicy'>> & {
    turnContinuityPolicy: AssistantProviderTurnContinuityPolicy
  }

export interface AssistantProviderTurnContinuityPlan {
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

const ASSISTANT_BOOTSTRAP_TRANSCRIPT_REPLAY_MESSAGE_LIMIT = 100

export function resolveAssistantProviderTurnContinuityPlan(input: {
  candidateResumeProviderSessionId: string | null
  onboardingGuidanceOpen: boolean
  promptProfile: AssistantProviderTurnPromptProfile
}): AssistantProviderTurnContinuityPlan {
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
    profile: AssistantProviderTurnContinuityProfile | null | undefined
    turnTrigger: AssistantTurnTrigger | null | undefined
  },
): AssistantProviderTurnResolvedExecutionProfile {
  const turnContinuityPolicy = resolveAssistantProviderTurnContinuityPolicy({
    profile: input.profile,
    turnTrigger: input.turnTrigger,
  })

  return {
    promptProfile: input.profile?.promptProfile ?? 'conversation',
    toolProfile: input.profile?.toolProfile ?? 'provider-turn',
    turnContinuityPolicy,
  }
}

export function resolveAssistantProviderTurnContinuityPolicy(input: {
  profile?: AssistantProviderTurnContinuityProfile | null
  turnTrigger?: AssistantTurnTrigger | null
}): AssistantProviderTurnContinuityPolicy {
  if (
    input.profile?.promptProfile === 'notification-decision' ||
    input.turnTrigger === 'automation-auto-reply' ||
    input.turnTrigger === 'automation-cron'
  ) {
    return 'murph-history-only'
  }

  if (
    input.profile?.turnContinuityPolicy === 'murph-history-only' ||
    input.profile?.nativeResumePolicy === 'disabled'
  ) {
    return 'murph-history-only'
  }

  return 'continuous-provider-thread'
}

export async function buildAssistantProviderTurnExecutionPlan(input: {
  activeTurnHistory?: AssistantActiveTurnProviderHistory | null
  activeTurnSteering?: AssistantActiveTurnLiveProviderSteering | null
  input: AssistantMessageInput
  plan: AssistantTurnSharedPlan
  profile?: AssistantProviderTurnContinuityProfile | null
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
  const activeTurnHistoryPresent =
    hasAssistantActiveTurnProviderHistory(activeTurnHistory)
  const nativeResumeEnabled =
    input.profile.turnContinuityPolicy === 'continuous-provider-thread' &&
    !activeTurnHistoryPresent
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
  const continuityPlan = resolveAssistantProviderTurnContinuityPlan({
    candidateResumeProviderSessionId,
    onboardingGuidanceOpen: input.sharedPlan.onboardingGuidanceOpen,
    promptProfile: input.profile.promptProfile,
  })
  const resumeProviderSessionId = continuityPlan.resumeProviderSessionId
  const shouldInjectBootstrapContext = continuityPlan.shouldInjectBootstrapContext
  const shouldPrepareBootstrapContext =
    shouldInjectBootstrapContext ||
    resumeProviderSessionId !== null
  const resolvedChannel = input.input.channel ?? input.session.binding.channel
  const diagnosticsPolicy = resolveAssistantDiagnosticsPolicy({
    channel: resolvedChannel,
    executionContext: input.input.executionContext,
  })
  const shouldInjectOnboardingGuidance =
    continuityPlan.onboardingGuidanceInjected
  const assistantToolNameAliases = null
  const transcriptReplayLimit = shouldPrepareBootstrapContext && !activeTurnHistoryPresent
    ? ASSISTANT_BOOTSTRAP_TRANSCRIPT_REPLAY_MESSAGE_LIMIT
    : null
  const transcriptConversationMessages = transcriptReplayLimit
    ? removeTrailingCurrentUserPrompt(
        await loadAssistantConversationMessages({
          limit: transcriptReplayLimit,
          sessionId: input.session.sessionId,
          vault: input.input.vault,
        }),
        input.input.prompt,
      )
    : undefined
  const conversationMessages =
    transcriptConversationMessages && transcriptConversationMessages.length > 0
      ? transcriptConversationMessages
      : undefined
  const promptCapabilityAvailability = resolveAssistantPromptCapabilityAvailability({
    executionContext: input.executionContext,
  })
  const assistantCliContract =
    shouldPrepareBootstrapContext && input.profile.promptProfile === 'conversation'
      ? await resolveAssistantCliSurfaceBootstrapContext({
          cliEnv: input.sharedPlan.cliAccess.env,
          executionContext: input.input.executionContext,
          sessionId: input.session.sessionId,
          vault: input.input.vault,
          workingDirectory,
        })
      : null
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
  const systemPromptResult =
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
            assistantCliContract,
            allowSensitiveHealthContext:
              input.sharedPlan.allowSensitiveHealthContext,
            assistantHostedDeviceConnectAvailable:
              promptCapabilityAvailability.assistantHostedDeviceConnectAvailable,
            assistantHostedDeviceConnectProviders:
              promptCapabilityAvailability.assistantHostedDeviceConnectProviders,
            assistantKnowledgeToolsAvailable:
              promptCapabilityAvailability.assistantKnowledgeToolsAvailable,
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
  const systemPrompt = systemPromptResult.prompt

  return {
    assistantCliContract,
    cliEnv: input.sharedPlan.cliAccess.env,
    conversationMessages,
    activeTurnMessages: activeTurnHistory?.messages ?? undefined,
    continuityContext: null,
    diagnosticsPolicy,
    onboardingCompletionFallbackReason: null,
    onboardingGuidanceInjected: shouldInjectOnboardingGuidance,
    providerContinuation: resolveAssistantProviderContinuation({
      resumeProviderSessionId,
    }),
    resumeProviderSessionId,
    sessionContext: shouldPrepareBootstrapContext
      ? {
          binding: input.session.binding,
        }
      : undefined,
    promptCacheMetadata: systemPromptResult.cacheMetadata,
    workingDirectory,
    systemPrompt,
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
    assistantHostedDeviceConnectProviders.length > 0

  return {
    assistantHostedDeviceConnectAvailable,
    assistantHostedDeviceConnectProviders: assistantHostedDeviceConnectAvailable
      ? assistantHostedDeviceConnectProviders
      : [],
    assistantKnowledgeToolsAvailable: false,
  }
}

function removeTrailingCurrentUserPrompt(
  messages: ReadonlyArray<{
    content: string
    role: 'assistant' | 'user'
  }>,
  currentPrompt: string,
): ReadonlyArray<{
  content: string
  role: 'assistant' | 'user'
}> {
  const lastMessage = messages.at(-1)
  if (
    lastMessage?.role === 'user' &&
    lastMessage.content === currentPrompt
  ) {
    return messages.slice(0, -1)
  }

  return messages
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
    kind: 'flat-prompt-replay',
  }
}

function resolveAssistantEffectiveProviderResumeSessionId(input: {
  resumeProviderSessionId: string | null
}): string | null {
  return normalizeNullableString(input.resumeProviderSessionId)
}

export async function loadAssistantConversationMessages(input: {
  limit: number
  sessionId: string
  vault: string
}): Promise<Array<{
  content: string
  role: 'assistant' | 'user'
}>> {
  const transcript = await listAssistantTranscriptEntries(
    input.vault,
    input.sessionId,
  )

  return selectAssistantReplayMessages(transcript, input.limit)
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
