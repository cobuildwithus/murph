import type {
  AssistantChatProvider,
  AssistantProviderBinding,
  AssistantProviderSessionOptions,
  AssistantSession,
} from '../assistant-cli-contracts.js'
import {
  resolveAssistantCliAccessContext,
} from '../assistant-cli-access.js'
import {
  createDefaultAssistantToolCatalog,
} from '../assistant-cli-tools.js'
import {
  executeAssistantProviderTurnAttempt,
  resolveAssistantProviderCapabilities,
  type AssistantProviderTurnExecutionResult,
} from '../assistant-provider.js'
import { recordAssistantDiagnosticEvent } from './diagnostics.js'
import { normalizeAssistantExecutionContext } from './execution-context.js'
import { buildAssistantSystemPrompt } from './system-prompt.js'
import { errorMessage } from './shared.js'
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
import {
  createAssistantMemoryTurnContextEnv,
  loadAssistantMemoryPromptBlock,
  resolveAssistantDailyMemoryPath,
  resolveAssistantMemoryStoragePaths,
} from './memory.js'
import {
  buildRecoveredAssistantProviderBindingSeed as buildRecoveredProviderBindingSeed,
  resolveAssistantProviderResumeKey as readAssistantProviderResumeKey,
  resolveAssistantRouteResumeBinding as resolveAssistantResumeBinding,
} from './provider-binding.js'
import {
  attachRecoveredAssistantSession,
  recoverAssistantSessionAfterProviderFailure,
} from './provider-turn-recovery.js'
import {
  readAssistantProviderBinding,
} from './provider-state.js'
import {
  listAssistantTranscriptEntries,
} from './store.js'
import {
  buildAssistantTranscriptDistillationContinuityText,
  readLatestAssistantTranscriptDistillation,
} from './transcript-distillation.js'
import {
  appendAssistantTurnReceiptEvent,
} from './turns.js'
import { createIntegratedVaultServices } from '../vault-services.js'
import type { AssistantMessageInput } from './service-contracts.js'

interface AssistantTurnSharedPlan {
  allowSensitiveHealthContext: boolean
  cliAccess: ReturnType<typeof resolveAssistantCliAccessContext>
  requestedWorkingDirectory: string
}

interface AssistantRouteTurnPlan {
  cliEnv: NodeJS.ProcessEnv
  conversationMessages?: ReadonlyArray<{
    content: string
    role: 'assistant' | 'user'
  }>
  continuityContext: string | null
  resumeProviderSessionId: string | null
  sessionContext?: {
    binding: AssistantSession['binding']
  }
  systemPrompt: string | null
  workingDirectory: string
}

export interface ExecutedAssistantProviderTurnResult
  extends AssistantProviderTurnExecutionResult {
  attemptCount: number
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
  routes: readonly ResolvedAssistantFailoverRoute[]
  sharedPlan: AssistantTurnSharedPlan
  toolCatalog: ReturnType<typeof createDefaultAssistantToolCatalog>
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
  const executionPlan = buildAssistantProviderTurnExecutionPlan(input)
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

function buildAssistantProviderTurnExecutionPlan(input: {
  input: AssistantMessageInput
  plan: AssistantTurnSharedPlan
  resolvedSession: AssistantSession
  routes: readonly ResolvedAssistantFailoverRoute[]
  turnCreatedAt: string
  turnId: string
}): AssistantProviderTurnExecutionPlan {
  const executionContext = normalizeAssistantExecutionContext(input.input.executionContext)
  const toolCatalog = createDefaultAssistantToolCatalog({
    allowSensitiveHealthContext: input.plan.allowSensitiveHealthContext,
    executionContext,
    requestId: input.turnId,
    sessionId: input.resolvedSession.sessionId,
    vault: input.input.vault,
    vaultServices: createIntegratedVaultServices(),
  })

  return {
    input: input.input,
    memoryTurnEnv: createAssistantMemoryTurnContextEnv({
      allowSensitiveHealthContext: input.plan.allowSensitiveHealthContext,
      sessionId: input.resolvedSession.sessionId,
      sourcePrompt: input.input.prompt,
      turnId: `${input.resolvedSession.sessionId}:${input.turnCreatedAt}`,
      vault: input.input.vault,
    }),
    primaryRoute: input.routes[0] ?? null,
    routes: input.routes,
    sharedPlan: input.plan,
    toolCatalog,
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
      route,
      session: input.session,
      sharedPlan: input.executionPlan.sharedPlan,
      toolCatalog: input.executionPlan.toolCatalog,
    }),
    session: input.session,
  }
}

async function resolveAssistantRouteTurnPlan(input: {
  input: AssistantMessageInput
  route: ResolvedAssistantFailoverRoute
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
  toolCatalog: ReturnType<typeof createDefaultAssistantToolCatalog>
}): Promise<AssistantRouteTurnPlan> {
  const workingDirectory = input.sharedPlan.requestedWorkingDirectory
  const activeProviderBinding = readAssistantProviderBinding(input.session)
  const resumeProviderBinding = resolveAssistantResumeBinding({
    provider: input.route.provider,
    routeId: input.route.routeId,
    sessionBinding: activeProviderBinding,
  })
  const resumeProviderSessionId =
    resolveAssistantProviderCapabilities(input.route.provider).supportsNativeResume
      ? readAssistantProviderResumeKey({
          binding: resumeProviderBinding,
          provider: input.route.provider,
        })
      : null
  const shouldInjectBootstrapContext = resumeProviderSessionId === null
  const resolvedChannel = input.input.channel ?? input.session.binding.channel
  const shouldInjectFirstTurnCheckIn =
    input.input.includeFirstTurnCheckIn === true &&
    shouldInjectBootstrapContext &&
    input.session.turnCount === 0
  const conversationMessages = removeTrailingCurrentUserPrompt(
    await loadAssistantConversationMessages({
      limit: 20,
      sessionId: input.session.sessionId,
      vault: input.input.vault,
    }),
    input.input.prompt,
  )
  const assistantMemoryPrompt =
    true
    ? await loadAssistantMemoryPromptBlock({
        includeSensitiveHealthContext: input.sharedPlan.allowSensitiveHealthContext,
        vault: input.input.vault,
      })
    : null
  const assistantMemoryPaths = resolveAssistantMemoryStoragePaths(input.input.vault)
  const transcriptDistillation = await readLatestAssistantTranscriptDistillation(
    input.input.vault,
    input.session.sessionId,
  )
  const continuityContext = [
    buildAssistantTranscriptDistillationContinuityText(transcriptDistillation),
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n') || null
  const assistantStateToolsAvailable = input.toolCatalog.hasTool('assistant.state.show')
  const assistantMemoryRecallToolsAvailable =
    input.toolCatalog.hasTool('assistant.memory.search') &&
    input.toolCatalog.hasTool('assistant.memory.get')
  const assistantMemoryAppendToolAvailable =
    input.toolCatalog.hasTool('assistant.memory.file.append')
  const assistantMemoryFileEditToolsAvailable =
    input.toolCatalog.hasTool('assistant.memory.file.read') &&
    input.toolCatalog.hasTool('assistant.memory.file.write')
  const assistantCronToolsAvailable = input.toolCatalog.hasTool('assistant.cron.status')

  return {
    cliEnv: input.sharedPlan.cliAccess.env,
    conversationMessages,
    continuityContext,
    resumeProviderSessionId,
    sessionContext: shouldInjectBootstrapContext
      ? {
          binding: input.session.binding,
        }
      : undefined,
    workingDirectory,
    systemPrompt: buildAssistantSystemPrompt({
      allowSensitiveHealthContext: input.sharedPlan.allowSensitiveHealthContext,
      assistantMemoryAppendToolAvailable,
      assistantStateToolsAvailable,
      assistantCronToolsAvailable,
      cliAccess: input.sharedPlan.cliAccess,
      assistantMemoryDailyPath: resolveAssistantDailyMemoryPath(assistantMemoryPaths),
      assistantMemoryFileEditToolsAvailable,
      assistantMemoryLongTermPath: assistantMemoryPaths.longTermMemoryPath,
      assistantMemoryRecallToolsAvailable,
      assistantMemoryPrompt,
      channel: resolvedChannel,
      firstTurnCheckIn: shouldInjectFirstTurnCheckIn,
    }),
  }
}

async function executeAssistantProviderAttempt(input: {
  attemptPlan: AssistantProviderAttemptPlan
  executionPlan: AssistantProviderTurnExecutionPlan
  failoverState: AssistantProviderFailoverState
}): Promise<AssistantProviderAttemptOutcome> {
  const { attemptPlan, executionPlan } = input
  let attemptMetadata = {
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
    const toolCatalog = executionPlan.toolCatalog
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
        providerOptions: attemptPlan.route.providerOptions,
        route: attemptPlan.route,
        session: attemptPlan.session,
        workingDirectory: attemptPlan.routePlan.workingDirectory,
      },
    }
  } catch (error) {
    const errorCode = readAssistantErrorCode(error)
    const previousBinding = readAssistantProviderBinding(attemptPlan.session)
    const recoveredSession = await recoverAssistantSessionAfterProviderFailure({
      error,
      provider: attemptPlan.route.provider,
      providerOptions: attemptPlan.route.providerOptions,
      providerBinding: buildRecoveredProviderBindingSeed({
        provider: attemptPlan.route.provider,
        providerOptions: attemptPlan.route.providerOptions,
      }),
      routeId: attemptPlan.route.routeId,
      session: attemptPlan.session,
      vault: executionPlan.input.vault,
    })
    const session = recoveredSession ?? attemptPlan.session
    attachRecoveredAssistantSession(error, recoveredSession)

    let nextFailoverState = input.failoverState
    const shouldRecordRouteFailure = shouldRecordAssistantRouteFailure(errorCode)
    if (shouldRecordRouteFailure) {
      nextFailoverState = await recordAssistantFailoverRouteFailure({
        error,
        route: attemptPlan.route,
        vault: executionPlan.input.vault,
      })
    }
    const cooldownUntil = shouldRecordRouteFailure
      ? getAssistantFailoverCooldownUntil({
          route: attemptPlan.route,
          state: nextFailoverState,
        })
      : null

    await recordProviderAttemptFailed({
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
  attemptCount: number
  route: ResolvedAssistantFailoverRoute
  turnId: string
  vault: string
}): Promise<void> {
  await appendAssistantTurnReceiptEvent({
    vault: input.vault,
    turnId: input.turnId,
    kind: 'provider.attempt.succeeded',
    detail: input.route.label,
    metadata: {
      attempt: String(input.attemptCount),
      provider: input.route.provider,
      model: input.route.providerOptions.model ?? 'default',
      routeId: input.route.routeId,
    },
  })
}

async function recordProviderAttemptFailed(input: {
  attemptCount: number
  cooldownUntil: string | null
  detail: string
  errorCode: string | null
  route: ResolvedAssistantFailoverRoute
  sessionId: string
  turnId: string
  vault: string
}): Promise<void> {
  await appendAssistantTurnReceiptEvent({
    vault: input.vault,
    turnId: input.turnId,
    kind: 'provider.attempt.failed',
    detail: input.detail,
    metadata: {
      attempt: String(input.attemptCount),
      provider: input.route.provider,
      model: input.route.providerOptions.model ?? 'default',
      routeId: input.route.routeId,
      code: input.errorCode ?? 'unknown',
    },
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

function shouldRecordAssistantRouteFailure(errorCode: string | null): boolean {
  return true
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
