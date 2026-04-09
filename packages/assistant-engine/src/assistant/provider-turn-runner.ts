import type {
  AssistantChatProvider,
  AssistantProviderBinding,
  AssistantProviderSessionOptions,
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  normalizeIanaTimeZone,
  resolveSystemTimeZone,
  toLocalDayKey,
} from '@murphai/contracts'
import { loadVault } from '@murphai/core'
import {
  resolveAssistantCliAccessContext,
} from '../assistant-cli-access.js'
import {
  createProviderTurnAssistantToolCatalog,
} from '../assistant-cli-tools.js'
import {
  executeAssistantProviderTurnAttempt,
  resolveAssistantProviderExecutionCapabilities,
  type AssistantProviderAttemptMetadata,
  type AssistantProviderTurnExecutionResult,
} from '../assistant-provider.js'
import { recordAssistantDiagnosticEvent } from './diagnostics.js'
import { normalizeAssistantExecutionContext } from './execution-context.js'
import { buildAssistantSystemPrompt } from './system-prompt.js'
import { errorMessage } from './shared.js'
import { resolveAssistantCliSurfaceBootstrapContext } from './cli-surface-bootstrap.js'
import {
  getAssistantFailoverCooldownUntil,
  isAssistantFailoverRouteCoolingDown,
  readAssistantFailoverState,
  recordAssistantFailoverRouteFailure,
  recordAssistantFailoverRouteSuccess,
  shouldAttemptAssistantProviderFailover,
  type ResolvedAssistantFailoverRoute,
} from './failover.js'
import { maybeThrowInjectedAssistantFault } from './fault-injection.js'
import { createAssistantMemoryTurnContextEnv } from './memory/turn-context.js'
import {
  attachRecoveredAssistantSession,
  recoverAssistantSessionAfterProviderFailure,
} from './provider-turn-recovery.js'
import {
  readAssistantProviderBinding,
} from './provider-state.js'
import {
  resolveAssistantProviderResumeKey,
  resolveAssistantRouteResumeBinding,
} from './provider-binding.js'
import {
  listAssistantTranscriptEntries,
} from './store.js'
import {
  appendAssistantTurnReceiptEvent,
} from './turns.js'
import { createIntegratedVaultServices } from '@murphai/vault-usecases/vault-services'
import { createAssistantFoodAutoLogHooks } from './food-auto-log-hooks.js'
import type { AssistantMessageInput } from './service-contracts.js'

interface AssistantTurnSharedPlan {
  allowSensitiveHealthContext: boolean
  cliAccess: ReturnType<typeof resolveAssistantCliAccessContext>
  firstTurnCheckInEligible: boolean
  requestedWorkingDirectory: string
}

interface AssistantRouteTurnPlan {
  assistantCliContract: string | null
  cliEnv: NodeJS.ProcessEnv
  conversationMessages?: ReadonlyArray<{
    content: string
    role: 'assistant' | 'user'
  }>
  continuityContext: string | null
  firstTurnCheckInInjected: boolean
  resumeProviderSessionId: string | null
  sessionContext?: {
    binding: AssistantSession['binding']
  }
  systemPrompt: string | null
  workingDirectory: string
}

interface AssistantPromptCapabilityAvailability {
  assistantCliExecutorAvailable: boolean
  assistantCronToolsAvailable: boolean
  assistantHostedDeviceConnectAvailable: boolean
  assistantKnowledgeToolsAvailable: boolean
}

interface AssistantPromptTimeContext {
  currentLocalDate: string
  currentTimeZone: string
}

export interface ExecutedAssistantProviderTurnResult
  extends AssistantProviderTurnExecutionResult {
  attemptCount: number
  firstTurnCheckInInjected?: boolean
  providerOptions: AssistantProviderSessionOptions
  route: ResolvedAssistantFailoverRoute
  session: AssistantSession
  workingDirectory: string
}

type AssistantProviderFailoverState = Awaited<
  ReturnType<typeof readAssistantFailoverState>
>

interface AssistantProviderTurnExecutionPlan {
  input: AssistantMessageInput
  memoryTurnEnv: NodeJS.ProcessEnv
  primaryRoute: ResolvedAssistantFailoverRoute | null
  promptTimeContext: AssistantPromptTimeContext
  toolCatalog: ReturnType<typeof createProviderTurnAssistantToolCatalog>
  routes: readonly ResolvedAssistantFailoverRoute[]
  sharedPlan: AssistantTurnSharedPlan
  turnId: string
}

interface AssistantProviderAttemptPlan {
  attemptCount: number
  primaryRouteCooldownFailover: boolean
  remainingRoutes: readonly ResolvedAssistantFailoverRoute[]
  route: ResolvedAssistantFailoverRoute
  routePlan: AssistantRouteTurnPlan
  session: AssistantSession
}

type AssistantProviderAttemptOutcome =
  | {
      kind: 'failed_terminal'
      error: unknown
      failoverState: AssistantProviderFailoverState
      session: AssistantSession
    }
  | {
      kind: 'retry_next_route'
      error: unknown
      failoverState: AssistantProviderFailoverState
      session: AssistantSession
    }
  | {
      kind: 'succeeded'
      failoverState: AssistantProviderFailoverState
      result: ExecutedAssistantProviderTurnResult
    }

export type AssistantProviderTurnRecoveryOutcome =
  | {
      kind: 'failed_terminal'
      error: unknown
      session: AssistantSession
    }
  | {
      kind: 'succeeded'
      providerTurn: ExecutedAssistantProviderTurnResult
    }

export async function executeProviderTurnWithRecovery(input: {
  input: AssistantMessageInput
  plan: AssistantTurnSharedPlan
  resolvedSession: AssistantSession
  routes: readonly ResolvedAssistantFailoverRoute[]
  turnCreatedAt: string
  turnId: string
}): Promise<AssistantProviderTurnRecoveryOutcome> {
  const executionPlan = await buildAssistantProviderTurnExecutionPlan(input)
  let failoverState = await readAssistantFailoverState(input.input.vault)
  const attemptedRouteIds = new Set<string>()
  let lastRetriableFailure: unknown = null
  let nextAttemptCount = 1

  while (attemptedRouteIds.size < executionPlan.routes.length) {
    const attemptPlan = await resolveAssistantProviderAttemptPlan({
      attemptCount: nextAttemptCount,
      attemptedRouteIds,
      executionPlan,
      failoverState,
      session: input.resolvedSession,
    })
    if (!attemptPlan) {
      break
    }

    attemptedRouteIds.add(attemptPlan.route.routeId)
    nextAttemptCount = attemptPlan.attemptCount + 1

    const attemptOutcome = await executeAssistantProviderAttempt({
      attemptPlan,
      executionPlan,
      failoverState,
    })

    failoverState = attemptOutcome.failoverState

    switch (attemptOutcome.kind) {
      case 'succeeded':
        return {
          kind: 'succeeded',
          providerTurn: attemptOutcome.result,
        }
      case 'retry_next_route':
        lastRetriableFailure = attemptOutcome.error
        break
      case 'failed_terminal':
        return {
          kind: 'failed_terminal',
          error: attemptOutcome.error,
          session: attemptOutcome.session,
        }
    }
  }

  return {
    kind: 'failed_terminal',
    error:
      lastRetriableFailure === null
        ? new Error('Assistant provider routes were exhausted before any attempt completed.')
        : attachAssistantFailoverExhaustionContext({
            attemptedRoutes: executionPlan.routes.filter((route) =>
              attemptedRouteIds.has(route.routeId),
            ),
            error: lastRetriableFailure,
          }),
    session: input.resolvedSession,
  }
}

async function buildAssistantProviderTurnExecutionPlan(input: {
  input: AssistantMessageInput
  plan: AssistantTurnSharedPlan
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
  const toolCatalog = createProviderTurnAssistantToolCatalog({
    allowSensitiveHealthContext: input.plan.allowSensitiveHealthContext,
    cliEnv: memoryTurnEnv,
    executionContext,
    requestId: input.turnId,
    sessionId: input.resolvedSession.sessionId,
    vault: input.input.vault,
    vaultServices: createIntegratedVaultServices({
      foodAutoLogHooks: createAssistantFoodAutoLogHooks(),
    }),
    workingDirectory: input.plan.requestedWorkingDirectory,
  })
  const promptTimeContext = await resolveAssistantPromptTimeContext(input.input.vault)

  return {
    input: input.input,
    memoryTurnEnv,
    primaryRoute: input.routes[0] ?? null,
    promptTimeContext,
    toolCatalog,
    routes: input.routes,
    sharedPlan: input.plan,
    turnId: input.turnId,
  }
}

async function resolveAssistantProviderAttemptPlan(input: {
  attemptCount: number
  attemptedRouteIds: ReadonlySet<string>
  executionPlan: AssistantProviderTurnExecutionPlan
  failoverState: AssistantProviderFailoverState
  session: AssistantSession
}): Promise<AssistantProviderAttemptPlan | null> {
  const prioritizedRoutes = prioritizeAssistantFailoverRoutes(
    input.executionPlan.routes.filter(
      (route) => !input.attemptedRouteIds.has(route.routeId),
    ),
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
      input: input.executionPlan.input,
      promptTimeContext: input.executionPlan.promptTimeContext,
      route,
      session: input.session,
      sharedPlan: input.executionPlan.sharedPlan,
      toolCatalog: input.executionPlan.toolCatalog,
    }),
    session: input.session,
  }
}

async function resolveAssistantRouteTurnPlan(input: {
  toolCatalog: ReturnType<typeof createProviderTurnAssistantToolCatalog>
  input: AssistantMessageInput
  promptTimeContext: AssistantPromptTimeContext
  route: ResolvedAssistantFailoverRoute
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
}): Promise<AssistantRouteTurnPlan> {
  const workingDirectory = input.sharedPlan.requestedWorkingDirectory
  const resumeBinding = resolveAssistantRouteResumeBinding({
    route: input.route,
    sessionBinding: readAssistantProviderBinding(input.session),
  })
  const resumeProviderSessionId =
    resolveAssistantProviderExecutionCapabilities(input.route.provider)
      .supportsNativeResume &&
    resumeBinding !== null
      ? resolveAssistantProviderResumeKey({
          binding: resumeBinding,
          provider: input.route.provider,
        })
      : null
  const shouldInjectBootstrapContext = resumeProviderSessionId === null
  const resolvedChannel = input.input.channel ?? input.session.binding.channel
  const shouldInjectFirstTurnCheckIn =
    input.sharedPlan.firstTurnCheckInEligible &&
    shouldInjectBootstrapContext &&
    input.session.turnCount === 0
  const providerCapabilities = resolveAssistantProviderExecutionCapabilities(
    input.route.provider,
  )
  const conversationMessages = removeTrailingCurrentUserPrompt(
    await loadAssistantConversationMessages({
      limit: 20,
      sessionId: input.session.sessionId,
      vault: input.input.vault,
    }),
    input.input.prompt,
  )
  const promptCapabilityAvailability = resolveAssistantPromptCapabilityAvailability({
    providerCapabilities,
    toolCatalog: input.toolCatalog,
  })
  const assistantCliContract = shouldInjectBootstrapContext
    ? await resolveAssistantCliSurfaceBootstrapContext({
        cliEnv: input.sharedPlan.cliAccess.env,
        executionContext: input.input.executionContext,
        sessionId: input.session.sessionId,
        vault: input.input.vault,
        workingDirectory,
      })
    : null

  return {
    assistantCliContract,
    cliEnv: input.sharedPlan.cliAccess.env,
    conversationMessages,
    continuityContext: null,
    firstTurnCheckInInjected: shouldInjectFirstTurnCheckIn,
    resumeProviderSessionId,
    sessionContext: shouldInjectBootstrapContext
      ? {
          binding: input.session.binding,
        }
      : undefined,
    workingDirectory,
    systemPrompt: buildAssistantSystemPrompt({
      assistantCliContract,
      allowSensitiveHealthContext: input.sharedPlan.allowSensitiveHealthContext,
      assistantCliExecutorAvailable:
        promptCapabilityAvailability.assistantCliExecutorAvailable,
      assistantCronToolsAvailable:
        promptCapabilityAvailability.assistantCronToolsAvailable,
      assistantHostedDeviceConnectAvailable:
        promptCapabilityAvailability.assistantHostedDeviceConnectAvailable,
      assistantKnowledgeToolsAvailable:
        promptCapabilityAvailability.assistantKnowledgeToolsAvailable,
      cliAccess: input.sharedPlan.cliAccess,
      channel: resolvedChannel,
      currentLocalDate: input.promptTimeContext.currentLocalDate,
      currentTimeZone: input.promptTimeContext.currentTimeZone,
      firstTurnCheckIn: shouldInjectFirstTurnCheckIn,
    }),
  }
}

async function resolveAssistantPromptTimeContext(
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

function resolveAssistantPromptCapabilityAvailability(input: {
  providerCapabilities: ReturnType<typeof resolveAssistantProviderExecutionCapabilities>
  toolCatalog: ReturnType<typeof createProviderTurnAssistantToolCatalog>
}): AssistantPromptCapabilityAvailability {
  const assistantCliExecutorAvailable = hasRouteToolRuntimeAccess({
    providerCapabilities: input.providerCapabilities,
    toolCatalog: input.toolCatalog,
    toolNames: ['murph.cli.run'],
  })

  return {
    assistantCliExecutorAvailable,
    assistantCronToolsAvailable: assistantCliExecutorAvailable,
    assistantHostedDeviceConnectAvailable: hasRouteToolRuntimeAccess({
      providerCapabilities: input.providerCapabilities,
      toolCatalog: input.toolCatalog,
      toolNames: ['murph.device.connect'],
    }),
    assistantKnowledgeToolsAvailable: hasRouteToolRuntimeAccess({
      providerCapabilities: input.providerCapabilities,
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

function hasRouteToolRuntimeAccess(input: {
  providerCapabilities: ReturnType<typeof resolveAssistantProviderExecutionCapabilities>
  toolCatalog: ReturnType<typeof createProviderTurnAssistantToolCatalog>
  toolNames: readonly string[]
}): boolean {
  return (
    input.providerCapabilities.supportsToolRuntime &&
    input.toolNames.every((toolName) => input.toolCatalog.hasTool(toolName))
  )
}

async function executeAssistantProviderAttempt(input: {
  attemptPlan: AssistantProviderAttemptPlan
  executionPlan: AssistantProviderTurnExecutionPlan
  failoverState: AssistantProviderFailoverState
}): Promise<AssistantProviderAttemptOutcome> {
  const { attemptPlan, executionPlan } = input
  let attemptMetadata: AssistantProviderAttemptMetadata = {
    activityLabels: [] as readonly string[],
    executedToolCount: 0,
    rawToolEvents: [] as readonly unknown[],
  }

  if (attemptPlan.primaryRouteCooldownFailover && executionPlan.primaryRoute) {
    await recordProviderCooldownFailoverApplied({
      primaryRoute: executionPlan.primaryRoute,
      route: attemptPlan.route,
      sessionId: attemptPlan.session.sessionId,
      turnId: executionPlan.turnId,
      vault: executionPlan.input.vault,
    })
  }

  const attemptAt = new Date().toISOString()
  await recordProviderAttemptStarted({
    attemptCount: attemptPlan.attemptCount,
    at: attemptAt,
    route: attemptPlan.route,
    sessionId: attemptPlan.session.sessionId,
    turnId: executionPlan.turnId,
    vault: executionPlan.input.vault,
  })

  try {
    maybeThrowInjectedAssistantFault({
      component: 'provider',
      fault: 'provider',
      message: 'Injected assistant provider failure.',
    })
    const { toolCatalog } = executionPlan
    const toolRuntime = {
      allowSensitiveHealthContext: executionPlan.sharedPlan.allowSensitiveHealthContext,
      requestId: executionPlan.turnId,
      sessionId: attemptPlan.session.sessionId,
      toolCatalog,
      vault: executionPlan.input.vault,
    }
    const attemptResult = await executeAssistantProviderTurnAttempt({
      abortSignal: executionPlan.input.abortSignal,
      provider: attemptPlan.route.provider,
      workingDirectory: attemptPlan.routePlan.workingDirectory,
      env: {
        ...attemptPlan.routePlan.cliEnv,
        ...executionPlan.memoryTurnEnv,
      },
      userPrompt: executionPlan.input.prompt,
      userMessageContent: executionPlan.input.userMessageContent,
      continuityContext: attemptPlan.routePlan.continuityContext,
      systemPrompt: attemptPlan.routePlan.systemPrompt,
      toolRuntime,
      sessionContext: attemptPlan.routePlan.sessionContext
        ? {
            binding: attemptPlan.session.binding,
          }
        : undefined,
      resumeProviderSessionId: attemptPlan.routePlan.resumeProviderSessionId,
      codexCommand:
        attemptPlan.route.codexCommand ??
        executionPlan.input.codexCommand ??
        undefined,
      codexHome: attemptPlan.route.providerOptions.codexHome,
      model: attemptPlan.route.providerOptions.model,
      reasoningEffort: attemptPlan.route.providerOptions.reasoningEffort,
      sandbox: attemptPlan.route.providerOptions.sandbox,
      approvalPolicy: attemptPlan.route.providerOptions.approvalPolicy,
      baseUrl: attemptPlan.route.providerOptions.baseUrl,
      apiKeyEnv: attemptPlan.route.providerOptions.apiKeyEnv,
      providerName: attemptPlan.route.providerOptions.providerName,
      headers: attemptPlan.route.providerOptions.headers,
      conversationMessages: attemptPlan.routePlan.conversationMessages,
      onEvent: executionPlan.input.onProviderEvent ?? undefined,
      profile: attemptPlan.route.providerOptions.profile,
      oss: attemptPlan.route.providerOptions.oss,
      onTraceEvent: executionPlan.input.onTraceEvent,
      showThinkingTraces: executionPlan.input.showThinkingTraces ?? false,
    })
    attemptMetadata = attemptResult.metadata
    if (!attemptResult.ok) {
      throw attemptResult.error
    }
    const result = attemptResult.result

    const nextFailoverState = await recordAssistantFailoverRouteSuccess({
      vault: executionPlan.input.vault,
      route: attemptPlan.route,
      at: new Date().toISOString(),
    })
    await recordProviderAttemptSucceeded({
      activityLabels: attemptMetadata.activityLabels,
      attemptCount: attemptPlan.attemptCount,
      route: attemptPlan.route,
      turnId: executionPlan.turnId,
      vault: executionPlan.input.vault,
    })
    return {
      kind: 'succeeded',
      failoverState: nextFailoverState,
      result: {
        ...result,
        attemptCount: attemptPlan.attemptCount,
        firstTurnCheckInInjected: attemptPlan.routePlan.firstTurnCheckInInjected,
        providerOptions: attemptPlan.route.providerOptions,
        route: attemptPlan.route,
        session: attemptPlan.session,
        workingDirectory: attemptPlan.routePlan.workingDirectory,
      },
    }
  } catch (error) {
    const errorCode = readAssistantErrorCode(error)
    const recoveredSession = await recoverAssistantSessionAfterProviderFailure({
      error,
      routeId: attemptPlan.route.routeId,
      session: attemptPlan.session,
      vault: executionPlan.input.vault,
    })
    const session = recoveredSession ?? attemptPlan.session
    attachRecoveredAssistantSession(error, recoveredSession)

    const nextFailoverState = await recordAssistantFailoverRouteFailure({
      error,
      route: attemptPlan.route,
      vault: executionPlan.input.vault,
    })
    const cooldownUntil = getAssistantFailoverCooldownUntil({
      route: attemptPlan.route,
      state: nextFailoverState,
    })

    await recordProviderAttemptFailed({
      activityLabels: attemptMetadata.activityLabels,
      attemptCount: attemptPlan.attemptCount,
      cooldownUntil,
      detail: errorMessage(error),
      errorCode,
      route: attemptPlan.route,
      sessionId: session.sessionId,
      turnId: executionPlan.turnId,
      vault: executionPlan.input.vault,
    })

    const nextRoute =
      prioritizeAssistantFailoverRoutes(
        attemptPlan.remainingRoutes,
        nextFailoverState,
      )[0] ?? null
    const outcomeKind = classifyAssistantProviderAttemptFailure({
      abortSignal: executionPlan.input.abortSignal,
      error,
      executedBoundAssistantTool: attemptMetadata.executedToolCount > 0,
      nextRoute,
    })

    if (outcomeKind === 'retry_next_route' && nextRoute) {
      await recordProviderFailoverApplied({
        errorCode,
        fromRoute: attemptPlan.route,
        sessionId: session.sessionId,
        toRoute: nextRoute,
        turnId: executionPlan.turnId,
        vault: executionPlan.input.vault,
      })

      return {
        kind: 'retry_next_route',
        failoverState: nextFailoverState,
        error,
        session,
      }
    }

    return {
      kind: outcomeKind,
      error,
      failoverState: nextFailoverState,
      session,
    }
  }
}

function classifyAssistantProviderAttemptFailure(input: {
  abortSignal?: AbortSignal
  error: unknown
  executedBoundAssistantTool: boolean
  nextRoute: ResolvedAssistantFailoverRoute | null
}): 'failed_terminal' | 'retry_next_route' {
  if (input.executedBoundAssistantTool) {
    return 'failed_terminal'
  }

  if (
    !shouldAttemptAssistantProviderFailover({
      abortSignal: input.abortSignal,
      error: input.error,
    }) ||
    input.nextRoute === null
  ) {
    return 'failed_terminal'
  }

  return 'retry_next_route'
}

async function recordProviderCooldownFailoverApplied(input: {
  primaryRoute: ResolvedAssistantFailoverRoute
  route: ResolvedAssistantFailoverRoute
  sessionId: string
  turnId: string
  vault: string
}): Promise<void> {
  await appendAssistantTurnReceiptEvent({
    vault: input.vault,
    turnId: input.turnId,
    kind: 'provider.failover.applied',
    detail: `${input.primaryRoute.label} -> ${input.route.label}`,
    metadata: {
      from: input.primaryRoute.label,
      to: input.route.label,
      fromRouteId: input.primaryRoute.routeId,
      toRouteId: input.route.routeId,
      reason: 'cooldown',
    },
  })
  await recordAssistantDiagnosticEvent({
    vault: input.vault,
    component: 'provider',
    kind: 'provider.failover.applied',
    level: 'warn',
    message: `Primary assistant provider route ${input.primaryRoute.label} is cooling down; using ${input.route.label}.`,
    sessionId: input.sessionId,
    turnId: input.turnId,
    data: {
      from: input.primaryRoute.label,
      to: input.route.label,
      fromRouteId: input.primaryRoute.routeId,
      toRouteId: input.route.routeId,
    },
    counterDeltas: {
      providerFailovers: 1,
    },
  })
}

async function recordProviderAttemptStarted(input: {
  attemptCount: number
  at: string
  route: ResolvedAssistantFailoverRoute
  sessionId: string
  turnId: string
  vault: string
}): Promise<void> {
  await appendAssistantTurnReceiptEvent({
    vault: input.vault,
    turnId: input.turnId,
    kind: 'provider.attempt.started',
    detail: input.route.label,
    metadata: {
      attempt: String(input.attemptCount),
      provider: input.route.provider,
      model: input.route.providerOptions.model ?? 'default',
      routeId: input.route.routeId,
    },
    at: input.at,
  })
  await recordAssistantDiagnosticEvent({
    vault: input.vault,
    component: 'provider',
    kind: 'provider.attempt.started',
    message: `Assistant provider attempt ${input.attemptCount} started with ${input.route.label}.`,
    sessionId: input.sessionId,
    turnId: input.turnId,
    data: {
      attempt: input.attemptCount,
      routeId: input.route.routeId,
      provider: input.route.provider,
      model: input.route.providerOptions.model,
    },
    counterDeltas: {
      providerAttempts: 1,
    },
    at: input.at,
  })
}

async function recordProviderAttemptSucceeded(input: {
  activityLabels?: readonly string[]
  attemptCount: number
  route: ResolvedAssistantFailoverRoute
  turnId: string
  vault: string
}): Promise<void> {
  const activityLabels = input.activityLabels ?? []
  const metadata: Record<string, string> = {
    attempt: String(input.attemptCount),
    provider: input.route.provider,
    model: input.route.providerOptions.model ?? 'default',
    routeId: input.route.routeId,
  }
  if (activityLabels.length > 0) {
    metadata.activityCount = String(activityLabels.length)
    metadata.activities = activityLabels.join(', ')
  }

  await appendAssistantTurnReceiptEvent({
    vault: input.vault,
    turnId: input.turnId,
    kind: 'provider.attempt.succeeded',
    detail: input.route.label,
    metadata,
  })
}

async function recordProviderAttemptFailed(input: {
  activityLabels?: readonly string[]
  attemptCount: number
  cooldownUntil: string | null
  detail: string
  errorCode: string | null
  route: ResolvedAssistantFailoverRoute
  sessionId: string
  turnId: string
  vault: string
}): Promise<void> {
  const activityLabels = input.activityLabels ?? []
  const metadata: Record<string, string> = {
    attempt: String(input.attemptCount),
    provider: input.route.provider,
    model: input.route.providerOptions.model ?? 'default',
    routeId: input.route.routeId,
    code: input.errorCode ?? 'unknown',
  }
  if (activityLabels.length > 0) {
    metadata.activityCount = String(activityLabels.length)
    metadata.activities = activityLabels.join(', ')
  }

  await appendAssistantTurnReceiptEvent({
    vault: input.vault,
    turnId: input.turnId,
    kind: 'provider.attempt.failed',
    detail: input.detail,
    metadata,
  })
  if (input.cooldownUntil) {
    await appendAssistantTurnReceiptEvent({
      vault: input.vault,
      turnId: input.turnId,
      kind: 'provider.cooldown.started',
      detail: `${input.route.label} cooling down until ${input.cooldownUntil}`,
      metadata: {
        routeId: input.route.routeId,
        cooldownUntil: input.cooldownUntil,
      },
    })
  }
  await recordAssistantDiagnosticEvent({
    vault: input.vault,
    component: 'provider',
    kind: 'provider.attempt.failed',
    level: 'warn',
    message: input.detail,
    code: input.errorCode,
    sessionId: input.sessionId,
    turnId: input.turnId,
    data: {
      attempt: input.attemptCount,
      routeId: input.route.routeId,
      provider: input.route.provider,
      model: input.route.providerOptions.model,
      cooldownUntil: input.cooldownUntil,
    },
    counterDeltas: {
      providerFailures: 1,
    },
  })
}

async function recordProviderFailoverApplied(input: {
  errorCode: string | null
  fromRoute: ResolvedAssistantFailoverRoute
  sessionId: string
  toRoute: ResolvedAssistantFailoverRoute
  turnId: string
  vault: string
}): Promise<void> {
  await appendAssistantTurnReceiptEvent({
    vault: input.vault,
    turnId: input.turnId,
    kind: 'provider.failover.applied',
    detail: `${input.fromRoute.label} -> ${input.toRoute.label}`,
    metadata: {
      from: input.fromRoute.label,
      to: input.toRoute.label,
      fromRouteId: input.fromRoute.routeId,
      toRouteId: input.toRoute.routeId,
    },
  })
  await recordAssistantDiagnosticEvent({
    vault: input.vault,
    component: 'provider',
    kind: 'provider.failover.applied',
    level: 'warn',
    message: `Failing over assistant provider from ${input.fromRoute.label} to ${input.toRoute.label}.`,
    code: input.errorCode,
    sessionId: input.sessionId,
    turnId: input.turnId,
    data: {
      from: input.fromRoute.label,
      to: input.toRoute.label,
      fromRouteId: input.fromRoute.routeId,
      toRouteId: input.toRoute.routeId,
    },
    counterDeltas: {
      providerFailovers: 1,
    },
  })
}

function prioritizeAssistantFailoverRoutes(
  routes: readonly ResolvedAssistantFailoverRoute[],
  state: Awaited<ReturnType<typeof readAssistantFailoverState>>,
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

function readAssistantErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null
  }

  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && code.trim().length > 0 ? code : null
}

function attachAssistantFailoverExhaustionContext(input: {
  attemptedRoutes: readonly ResolvedAssistantFailoverRoute[]
  error: unknown
}): unknown {
  if (input.error && typeof input.error === 'object') {
    const currentContext =
      'context' in input.error &&
      typeof (input.error as { context?: unknown }).context === 'object' &&
      (input.error as { context?: unknown }).context !== null &&
      !Array.isArray((input.error as { context?: unknown }).context)
        ? ((input.error as { context?: unknown }).context as Record<string, unknown>)
        : {}
    ;(input.error as { context?: Record<string, unknown> }).context = {
      ...currentContext,
      failoverExhausted: true,
      attemptedRouteIds: input.attemptedRoutes.map((route) => route.routeId),
      attemptedRouteLabels: input.attemptedRoutes.map((route) => route.label),
    }
    return input.error
  }

  return new Error('Assistant provider routes were exhausted.', {
    cause: input.error,
  })
}

function truncateAssistantContinuityText(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  if (normalized.length <= 400) {
    return normalized
  }

  return `${normalized.slice(0, 397)}...`
}

async function loadAssistantConversationMessages(input: {
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

  return transcript
    .slice(-input.limit)
    .flatMap((entry) =>
      isAssistantConversationTranscriptEntry(entry)
        ? [{
            role: entry.kind,
            content: entry.text,
          }]
        : [],
    )
}

function isAssistantConversationTranscriptEntry(entry: {
  kind: string
  text: string
}): entry is {
  kind: 'assistant' | 'user'
  text: string
} {
  return entry.kind === 'assistant' || entry.kind === 'user'
}
