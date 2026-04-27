import type {
  AssistantOnboardingCompletionReason,
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  normalizeIanaTimeZone,
  resolveSystemTimeZone,
  toLocalDayKey,
} from '@murphai/contracts'
import { loadVault } from '@murphai/core'
import { createIntegratedVaultServices } from '@murphai/vault-usecases/vault-services'
import {
  createNotificationTurnAssistantToolCatalog,
  createProviderTurnAssistantToolCatalog,
} from '../../assistant-cli-tools.js'
import {
  resolveAssistantProviderTargetExecutionCapabilities,
} from '../../assistant-provider.js'
import { buildAssistantActiveExperimentContextBlock } from '../active-experiment-context.js'
import { resolveAssistantCliSurfaceBootstrapContext } from '../cli-surface-bootstrap.js'
import {
  normalizeAssistantExecutionContext,
  type AssistantHostedDeviceConnectProvider,
} from '../execution-context.js'
import {
  isAssistantFailoverRouteCoolingDown,
  type readAssistantFailoverState,
  type ResolvedAssistantFailoverRoute,
} from '../failover.js'
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
import {
  resolveOpenAiCompatibleProviderVisibleToolAliases,
} from '../providers/openai-compatible.js'
import type {
  AssistantMurphCommandAccessMode,
} from '../providers/types.js'
import {
  hashAssistantToolCatalogForPromptCache,
} from '../../model-harness.js'
import {
  prioritizeAssistantRoutesForRichUserMessageContent,
} from '../rich-content-routing.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
} from '../service-contracts.js'
import {
  listAssistantTranscriptEntries,
} from '../store.js'
import {
  buildAssistantNotificationDecisionSystemPromptWithCacheMetadata,
  buildAssistantSystemPromptWithCacheMetadata,
  type AssistantPromptCacheMetadata,
  type AssistantHealthCommonsAccessMode,
} from '../system-prompt.js'
import { buildAssistantVaultOverviewBlock } from '../vault-overview.js'
import {
  resolveAssistantOnboardingCompletionFallbackReason,
} from './onboarding-fallback.js'

export interface AssistantRouteTurnPlan {
  assistantCommandAccessMode: AssistantMurphCommandAccessMode
  assistantCliContract: string | null
  cliEnv: NodeJS.ProcessEnv
  conversationMessages?: ReadonlyArray<{
    content: string
    role: 'assistant' | 'user'
  }>
  continuityContext: string | null
  diagnosticsPolicy: AssistantDiagnosticsPolicy
  onboardingCompletionFallbackReason: AssistantOnboardingCompletionReason | null
  onboardingGuidanceInjected: boolean
  resumeProviderSessionId: string | null
  sessionContext?: {
    binding: AssistantSession['binding']
  }
  promptCacheMetadata: AssistantPromptCacheMetadata | null
  systemPrompt: string | null
  supportsToolRuntime: boolean
  workingDirectory: string
}

export interface AssistantPromptCapabilityAvailability {
  assistantCommandAccessMode: AssistantMurphCommandAccessMode
  assistantHealthCommonsAccessMode: AssistantHealthCommonsAccessMode
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

export type AssistantProviderTurnNativeResumePolicy =
  | 'default'
  | 'disabled'

export interface AssistantProviderTurnExecutionProfile {
  nativeResumePolicy?: AssistantProviderTurnNativeResumePolicy
  promptProfile?: AssistantProviderTurnPromptProfile
  toolProfile?: AssistantProviderTurnToolProfile
}

export interface AssistantProviderTurnContinuityPlan {
  onboardingGuidanceInjected: boolean
  resumeProviderSessionId: string | null
  shouldInjectBootstrapContext: boolean
}

export interface AssistantProviderTurnExecutionPlan {
  executionContext: ReturnType<typeof normalizeAssistantExecutionContext>
  input: AssistantMessageInput
  memoryTurnEnv: NodeJS.ProcessEnv
  profile: Required<AssistantProviderTurnExecutionProfile>
  primaryRoute: ResolvedAssistantFailoverRoute | null
  promptTimeContext: AssistantPromptTimeContext
  toolCatalog: ReturnType<typeof createProviderTurnAssistantToolCatalog>
  routes: readonly ResolvedAssistantFailoverRoute[]
  sharedPlan: AssistantTurnSharedPlan
  turnId: string
}

export interface AssistantProviderAttemptPlan {
  attemptCount: number
  primaryRouteCooldownFailover: boolean
  remainingRoutes: readonly ResolvedAssistantFailoverRoute[]
  route: ResolvedAssistantFailoverRoute
  routePlan: AssistantRouteTurnPlan
  session: AssistantSession
}

export type AssistantProviderFailoverState = Awaited<
  ReturnType<typeof readAssistantFailoverState>
>

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
  profile: AssistantProviderTurnExecutionProfile | null | undefined,
): Required<AssistantProviderTurnExecutionProfile> {
  return {
    nativeResumePolicy: profile?.nativeResumePolicy ?? 'default',
    promptProfile: profile?.promptProfile ?? 'conversation',
    toolProfile: profile?.toolProfile ?? 'provider-turn',
  }
}

export async function buildAssistantProviderTurnExecutionPlan(input: {
  input: AssistantMessageInput
  plan: AssistantTurnSharedPlan
  profile?: AssistantProviderTurnExecutionProfile | null
  resolvedSession: AssistantSession
  routes: readonly ResolvedAssistantFailoverRoute[]
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
  const profile = resolveAssistantProviderTurnExecutionProfile(input.profile)
  const toolCatalog = (
    profile.toolProfile === 'notification-turn'
      ? createNotificationTurnAssistantToolCatalog
      : createProviderTurnAssistantToolCatalog
  )({
    allowSensitiveHealthContext: input.plan.allowSensitiveHealthContext,
    cliEnv: {
      ...input.plan.cliAccess.env,
      ...memoryTurnEnv,
    },
    executionContext,
    operatorAuthority: input.plan.operatorAuthority,
    requestId: input.turnId,
    sessionBinding: input.resolvedSession.binding,
    sessionId: input.resolvedSession.sessionId,
    vault: input.input.vault,
    vaultServices: createIntegratedVaultServices(),
    workingDirectory: input.plan.requestedWorkingDirectory,
  })
  const promptTimeContext = await resolveAssistantPromptTimeContext(input.input.vault)

  return {
    executionContext,
    input: input.input,
    memoryTurnEnv,
    profile,
    primaryRoute: input.routes[0] ?? null,
    promptTimeContext,
    toolCatalog,
    routes: input.routes,
    sharedPlan: input.plan,
    turnId: input.turnId,
  }
}

export async function resolveAssistantProviderAttemptPlan(input: {
  attemptCount: number
  attemptedRouteIds: ReadonlySet<string>
  executionPlan: AssistantProviderTurnExecutionPlan
  failoverState: AssistantProviderFailoverState
  session: AssistantSession
}): Promise<AssistantProviderAttemptPlan | null> {
  const remainingRoutes = prioritizeAssistantRoutesForRichUserMessageContent({
    routes: input.executionPlan.routes.filter(
      (route) => !input.attemptedRouteIds.has(route.routeId),
    ),
    userMessageContent: input.executionPlan.input.userMessageContent,
  })
  const prioritizedRoutes = prioritizeAssistantFailoverRoutes(
    remainingRoutes,
    input.failoverState,
  )
  const route = prioritizedRoutes[0] ?? null
  if (!route) {
    return null
  }

  return {
    attemptCount: input.attemptCount,
    primaryRouteCooldownFailover:
      input.attemptCount === 1 &&
      input.executionPlan.primaryRoute !== null &&
      route.routeId !== input.executionPlan.primaryRoute.routeId,
    remainingRoutes: prioritizedRoutes.slice(1),
    route,
    routePlan: await resolveAssistantRouteTurnPlan({
      executionContext: input.executionPlan.executionContext,
      input: input.executionPlan.input,
      profile: input.executionPlan.profile,
      promptTimeContext: input.executionPlan.promptTimeContext,
      route,
      session: input.session,
      sharedPlan: input.executionPlan.sharedPlan,
      toolCatalog: input.executionPlan.toolCatalog,
    }),
    session: input.session,
  }
}

export async function resolveAssistantRouteTurnPlan(input: {
  executionContext: ReturnType<typeof normalizeAssistantExecutionContext> | null
  toolCatalog: ReturnType<typeof createProviderTurnAssistantToolCatalog>
  input: AssistantMessageInput
  profile: Required<AssistantProviderTurnExecutionProfile>
  promptTimeContext: AssistantPromptTimeContext
  route: ResolvedAssistantFailoverRoute
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
}): Promise<AssistantRouteTurnPlan> {
  const workingDirectory = input.sharedPlan.requestedWorkingDirectory
  const resumeBinding = resolveAssistantRouteResumeBinding({
    route: input.route,
    sessionResumeState: input.session.resumeState,
  })
  const routeProviderCapabilities = resolveAssistantProviderTargetExecutionCapabilities({
    ...input.route.providerOptions,
  })
  const nativeResumeEnabled = input.profile.nativeResumePolicy !== 'disabled'
  const candidateResumeProviderSessionId =
    nativeResumeEnabled &&
    routeProviderCapabilities.supportsNativeResume &&
    resumeBinding !== null
      ? resolveAssistantProviderResumeKey({
          resumeState: resumeBinding,
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
    (resumeProviderSessionId !== null &&
      providerUsesFlatPrompt(routeProviderCapabilities))
  const resolvedChannel = input.input.channel ?? input.session.binding.channel
  const diagnosticsPolicy = resolveAssistantDiagnosticsPolicy({
    channel: resolvedChannel,
    executionContext: input.input.executionContext,
  })
  const shouldInjectOnboardingGuidance =
    continuityPlan.onboardingGuidanceInjected
  const providerCapabilities = routeProviderCapabilities
  const supportsToolRuntime = providerCapabilities.supportsToolRuntime
  const assistantToolNameAliases = resolveAssistantProviderToolNameAliases({
    route: input.route,
    supportsToolRuntime,
    toolCatalog: input.toolCatalog,
  })
  const transcriptReplayLimit = shouldPrepareBootstrapContext
    ? ASSISTANT_BOOTSTRAP_TRANSCRIPT_REPLAY_MESSAGE_LIMIT
    : null
  const conversationMessages = transcriptReplayLimit
    ? removeTrailingCurrentUserPrompt(
        await loadAssistantConversationMessages({
          limit: transcriptReplayLimit,
          sessionId: input.session.sessionId,
          vault: input.input.vault,
        }),
        input.input.prompt,
      )
    : undefined
  const promptCapabilityAvailability = resolveAssistantPromptCapabilityAvailability({
    executionContext: input.executionContext,
    providerCapabilities,
    supportsToolRuntime,
    toolCatalog: input.toolCatalog,
  })
  const assistantCommandAccessMode =
    promptCapabilityAvailability.assistantCommandAccessMode
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
  const toolSchemaHash = supportsToolRuntime
    ? hashAssistantToolCatalogForPromptCache(input.toolCatalog)
    : null
  const systemPromptResult =
    input.profile.promptProfile === 'notification-decision'
      ? buildAssistantNotificationDecisionSystemPromptWithCacheMetadata({
            activeExperimentContext,
            allowSensitiveHealthContext:
              input.sharedPlan.allowSensitiveHealthContext,
            assistantHealthCommonsAccessMode:
              promptCapabilityAvailability.assistantHealthCommonsAccessMode,
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
            assistantCommandAccessMode:
              promptCapabilityAvailability.assistantCommandAccessMode,
            assistantHealthCommonsAccessMode:
              promptCapabilityAvailability.assistantHealthCommonsAccessMode,
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
    assistantCommandAccessMode,
    assistantCliContract,
    cliEnv: input.sharedPlan.cliAccess.env,
    conversationMessages,
    continuityContext: null,
    diagnosticsPolicy,
    onboardingCompletionFallbackReason:
      resolveAssistantOnboardingCompletionFallbackReason({
        assistantCommandAccessMode,
        onboardingGuidanceInjected: shouldInjectOnboardingGuidance,
        prompt: input.input.prompt,
      }),
    onboardingGuidanceInjected: shouldInjectOnboardingGuidance,
    resumeProviderSessionId,
    sessionContext: shouldPrepareBootstrapContext
      ? {
          binding: input.session.binding,
        }
      : undefined,
    promptCacheMetadata: systemPromptResult.cacheMetadata,
    workingDirectory,
    systemPrompt,
    supportsToolRuntime,
  }
}

function resolveAssistantProviderToolNameAliases(input: {
  route: ResolvedAssistantFailoverRoute
  supportsToolRuntime: boolean
  toolCatalog: ReturnType<typeof createProviderTurnAssistantToolCatalog>
}): Record<string, string> | null {
  if (input.route.provider !== 'openai-compatible' || !input.supportsToolRuntime) {
    return null
  }

  const aliases = resolveOpenAiCompatibleProviderVisibleToolAliases(
    input.toolCatalog.listTools().map((tool) => tool.name),
  )
  const visibleAliases = Object.fromEntries(
    Object.entries(aliases).filter(
      ([canonicalName, providerVisibleName]) =>
        providerVisibleName !== canonicalName,
    ),
  )

  return Object.keys(visibleAliases).length > 0 ? visibleAliases : null
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
  providerCapabilities: ReturnType<typeof resolveAssistantProviderTargetExecutionCapabilities>
  supportsToolRuntime: boolean
  toolCatalog: ReturnType<typeof createProviderTurnAssistantToolCatalog>
}): AssistantPromptCapabilityAvailability {
  const assistantHostedDeviceConnectAvailable = hasRouteToolRuntimeAccess({
    supportsToolRuntime: input.supportsToolRuntime,
    toolCatalog: input.toolCatalog,
    toolNames: ['murph.device.connect'],
  })

  return {
    assistantCommandAccessMode: resolveAssistantCommandAccessMode({
      providerCapabilities: input.providerCapabilities,
      supportsToolRuntime: input.supportsToolRuntime,
      toolCatalog: input.toolCatalog,
    }),
    assistantHealthCommonsAccessMode: resolveAssistantHealthCommonsAccessMode({
      providerCapabilities: input.providerCapabilities,
      supportsToolRuntime: input.supportsToolRuntime,
      toolCatalog: input.toolCatalog,
    }),
    assistantHostedDeviceConnectAvailable,
    assistantHostedDeviceConnectProviders: assistantHostedDeviceConnectAvailable
      ? input.executionContext?.hosted?.deviceConnectProviders ?? []
      : [],
    assistantKnowledgeToolsAvailable: hasRouteToolRuntimeAccess({
      supportsToolRuntime: input.supportsToolRuntime,
      toolCatalog: input.toolCatalog,
      toolNames: [
        'assistant.knowledge.list',
        'assistant.knowledge.search',
        'assistant.knowledge.get',
        'assistant.knowledge.lint',
        'assistant.knowledge.upsert',
        'assistant.knowledge.rebuildIndex',
      ],
    }),
  }
}

function resolveAssistantHealthCommonsAccessMode(input: {
  providerCapabilities: ReturnType<typeof resolveAssistantProviderTargetExecutionCapabilities>
  supportsToolRuntime: boolean
  toolCatalog: ReturnType<typeof createProviderTurnAssistantToolCatalog>
}): AssistantHealthCommonsAccessMode {
  if (
    hasRouteToolRuntimeAccess({
      supportsToolRuntime: input.supportsToolRuntime,
      toolCatalog: input.toolCatalog,
      toolNames: [
        'healthCommons.search',
        'healthCommons.get',
        'healthCommons.listProtocols',
        'healthCommons.listSources',
      ],
    })
  ) {
    return 'bound-tools'
  }

  return input.providerCapabilities.murphCommandSurface === 'direct-cli'
    ? 'direct-cli'
    : 'none'
}

function hasRouteToolRuntimeAccess(input: {
  supportsToolRuntime: boolean
  toolCatalog: ReturnType<typeof createProviderTurnAssistantToolCatalog>
  toolNames: readonly string[]
}): boolean {
  return (
    input.supportsToolRuntime &&
    input.toolNames.every((toolName) => input.toolCatalog.hasTool(toolName))
  )
}

function resolveAssistantCommandAccessMode(input: {
  providerCapabilities: ReturnType<typeof resolveAssistantProviderTargetExecutionCapabilities>
  supportsToolRuntime: boolean
  toolCatalog: ReturnType<typeof createProviderTurnAssistantToolCatalog>
}): AssistantMurphCommandAccessMode {
  switch (input.providerCapabilities.murphCommandSurface) {
    case 'bound-tools':
      return hasRouteToolRuntimeAccess({
        supportsToolRuntime: input.supportsToolRuntime,
        toolCatalog: input.toolCatalog,
        toolNames: ['vault.cli.run'],
      })
        ? 'bound-tools'
        : 'none'
    case 'direct-cli':
      return 'direct-cli'
    default:
      return 'none'
  }
}

export function prioritizeAssistantFailoverRoutes(
  routes: readonly ResolvedAssistantFailoverRoute[],
  state: AssistantProviderFailoverState,
): ResolvedAssistantFailoverRoute[] {
  const ready: ResolvedAssistantFailoverRoute[] = []
  const cooling: ResolvedAssistantFailoverRoute[] = []

  for (const route of routes) {
    if (isAssistantFailoverRouteCoolingDown({ route, state })) {
      cooling.push(route)
    } else {
      ready.push(route)
    }
  }

  return ready.length > 0 ? [...ready, ...cooling] : [...routes]
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

function providerUsesFlatPrompt(
  capabilities: ReturnType<typeof resolveAssistantProviderTargetExecutionCapabilities>,
): boolean {
  return capabilities.requestFormat === 'flat-prompt'
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
