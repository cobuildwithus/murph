import type {
  AssistantChatProvider,
  AssistantProviderBinding,
  AssistantProviderSessionOptions,
  AssistantSession,
} from '../assistant-cli-contracts.js'
import {
  buildAssistantCliGuidanceText,
  buildAssistantCronMcpConfig,
  buildAssistantMemoryMcpConfig,
  buildAssistantStateMcpConfig,
  resolveAssistantCliAccessContext,
} from '../assistant-cli-access.js'
import {
  executeAssistantProviderTurn,
  resolveAssistantProviderTraits,
  type AssistantProviderTurnExecutionResult,
} from '../assistant-provider.js'
import {
  executeWithCanonicalWriteGuard,
} from './canonical-write-guard.js'
import { recordAssistantDiagnosticEvent } from './diagnostics.js'
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
} from './memory.js'
import type { AssistantOnboardingSummary } from './onboarding.js'
import {
  buildRecoveredAssistantProviderBindingSeed as buildRecoveredProviderBindingSeed,
  hashAssistantProviderWorkingDirectory as hashProviderWorkingDirectory,
  resolveAssistantProviderResumeKey as readAssistantProviderResumeKey,
  resolveAssistantRouteResumeBinding as resolveAssistantResumeBinding,
  shouldResumeAssistantProviderRecovery as shouldResumeProviderRecovery,
} from './provider-binding.js'
import {
  attachRecoveredAssistantSession,
  clearAssistantProviderRouteRecovery,
  readAssistantProviderRouteRecovery,
  readRecoveredAssistantProviderBindingForRoute,
  recoverAssistantSessionAfterProviderFailure,
} from './provider-turn-recovery.js'
import {
  readAssistantCodexPromptVersion,
  readAssistantProviderBinding,
} from './provider-state.js'
import { resolveAssistantProviderWorkingDirectory } from './provider-workspace.js'
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
import type { AssistantMessageInput } from './service.js'

interface AssistantTurnSharedPlan {
  allowSensitiveHealthContext: boolean
  cliAccess: ReturnType<typeof resolveAssistantCliAccessContext>
  onboardingSummary: AssistantOnboardingSummary | null
  requestedWorkingDirectory: string
}

interface AssistantRouteTurnPlan {
  cliEnv: NodeJS.ProcessEnv
  configOverrides?: readonly string[]
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
type AssistantProviderRouteRecoveryState = Awaited<
  ReturnType<typeof readAssistantProviderRouteRecovery>
>

interface AssistantProviderTurnExecutionPlan {
  currentCodexPromptVersion: string
  input: AssistantMessageInput
  memoryTurnEnv: NodeJS.ProcessEnv
  primaryRoute: ResolvedAssistantFailoverRoute | null
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
      kind: 'blocked'
      error: unknown
      failoverState: AssistantProviderFailoverState
      providerRecovery: AssistantProviderRouteRecoveryState
      session: AssistantSession
    }
  | {
      kind: 'failed_terminal'
      error: unknown
      failoverState: AssistantProviderFailoverState
      providerRecovery: AssistantProviderRouteRecoveryState
      session: AssistantSession
    }
  | {
      kind: 'retry_next_route'
      error: unknown
      failoverState: AssistantProviderFailoverState
      providerRecovery: AssistantProviderRouteRecoveryState
      session: AssistantSession
    }
  | {
      kind: 'succeeded'
      failoverState: AssistantProviderFailoverState
      providerRecovery: AssistantProviderRouteRecoveryState
      result: ExecutedAssistantProviderTurnResult
    }

export type AssistantProviderTurnRecoveryOutcome =
  | {
      kind: 'blocked'
      error: unknown
      session: AssistantSession
    }
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
  currentCodexPromptVersion: string
  input: AssistantMessageInput
  plan: AssistantTurnSharedPlan
  resolvedSession: AssistantSession
  routes: readonly ResolvedAssistantFailoverRoute[]
  turnCreatedAt: string
  turnId: string
}): Promise<AssistantProviderTurnRecoveryOutcome> {
  const executionPlan = buildAssistantProviderTurnExecutionPlan(input)
  let failoverState = await readAssistantFailoverState(input.input.vault)
  let providerRecovery: AssistantProviderRouteRecoveryState =
    await readAssistantProviderRouteRecovery(
      input.input.vault,
      input.resolvedSession.sessionId,
    )
  const attemptedRouteIds = new Set<string>()
  let lastRetriableFailure: unknown = null
  let nextAttemptCount = 1

  while (attemptedRouteIds.size < executionPlan.routes.length) {
    const attemptPlan = await resolveAssistantProviderAttemptPlan({
      attemptCount: nextAttemptCount,
      attemptedRouteIds,
      executionPlan,
      failoverState,
      providerRecovery,
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
      providerRecovery,
    })

    failoverState = attemptOutcome.failoverState
    providerRecovery = attemptOutcome.providerRecovery

    switch (attemptOutcome.kind) {
      case 'succeeded':
        return {
          kind: 'succeeded',
          providerTurn: attemptOutcome.result,
        }
      case 'retry_next_route':
        lastRetriableFailure = attemptOutcome.error
        break
      case 'blocked':
        return {
          kind: 'blocked',
          error: attemptOutcome.error,
          session: attemptOutcome.session,
        }
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
  currentCodexPromptVersion: string
  input: AssistantMessageInput
  plan: AssistantTurnSharedPlan
  resolvedSession: AssistantSession
  routes: readonly ResolvedAssistantFailoverRoute[]
  turnCreatedAt: string
  turnId: string
}): AssistantProviderTurnExecutionPlan {
  return {
    currentCodexPromptVersion: input.currentCodexPromptVersion,
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
    turnId: input.turnId,
  }
}

async function resolveAssistantProviderAttemptPlan(input: {
  attemptCount: number
  attemptedRouteIds: ReadonlySet<string>
  executionPlan: AssistantProviderTurnExecutionPlan
  failoverState: AssistantProviderFailoverState
  providerRecovery: AssistantProviderRouteRecoveryState
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
      currentCodexPromptVersion: input.executionPlan.currentCodexPromptVersion,
      input: input.executionPlan.input,
      providerRecovery: input.providerRecovery,
      route,
      session: input.session,
      sharedPlan: input.executionPlan.sharedPlan,
    }),
    session: input.session,
  }
}

async function resolveAssistantRouteTurnPlan(input: {
  currentCodexPromptVersion: string
  input: AssistantMessageInput
  providerRecovery: AssistantProviderRouteRecoveryState
  route: ResolvedAssistantFailoverRoute
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
}): Promise<AssistantRouteTurnPlan> {
  const routeTraits = resolveAssistantProviderTraits(input.route.provider)
  const supportsDirectCliExecution = routeTraits.workspaceMode === 'direct-cli'
  const workingDirectory = supportsDirectCliExecution
    ? await resolveAssistantProviderWorkingDirectory({
        requestedWorkingDirectory: input.sharedPlan.requestedWorkingDirectory,
        sessionId: input.session.sessionId,
        vault: input.input.vault,
      })
    : input.sharedPlan.requestedWorkingDirectory
  const workingDirectoryKey =
    supportsDirectCliExecution
      ? hashProviderWorkingDirectory(workingDirectory)
      : null
  const activeProviderBinding = readAssistantProviderBinding(input.session)
  const recoveredProviderBinding = shouldResumeProviderRecovery(
    input.input.turnTrigger ?? 'manual-ask',
  )
    ? readRecoveredAssistantProviderBindingForRoute({
        provider: input.route.provider,
        recovery: input.providerRecovery,
        routeId: input.route.routeId,
        session: input.session,
      })
    : null
  const resumeProviderBinding = resolveAssistantResumeBinding({
    provider: input.route.provider,
    recoveredBinding: recoveredProviderBinding,
    routeId: input.route.routeId,
    sessionBinding: activeProviderBinding,
    workingDirectoryKey,
  })
  const shouldResetCodexProviderSession =
    shouldResetCodexProviderSessionForPromptVersion({
      binding: resumeProviderBinding,
      currentCodexPromptVersion: input.currentCodexPromptVersion,
      provider: input.route.provider,
    })
  const resumeProviderSessionId =
    shouldResetCodexProviderSession
      ? null
      : readAssistantProviderResumeKey({
          binding: resumeProviderBinding,
          provider: input.route.provider,
        })
  const shouldInjectBootstrapContext =
    routeTraits.sessionMode === 'stateless' ||
    resumeProviderSessionId === null ||
    shouldResetCodexProviderSession
  const shouldInjectFirstTurnOnboarding =
    input.input.enableFirstTurnOnboarding === true &&
    input.session.turnCount === 0 &&
    shouldInjectBootstrapContext
  const conversationMessages =
    routeTraits.transcriptContextMode === 'local-transcript'
      ? removeTrailingCurrentUserPrompt(
          await loadAssistantConversationMessages({
            limit: 20,
            sessionId: input.session.sessionId,
            vault: input.input.vault,
          }),
          input.input.prompt,
        )
      : undefined
  const assistantMemoryPrompt = shouldInjectBootstrapContext
    ? await loadAssistantMemoryPromptBlock({
        includeSensitiveHealthContext: input.sharedPlan.allowSensitiveHealthContext,
        vault: input.input.vault,
      })
    : null
  const transcriptDistillation = shouldInjectBootstrapContext
    ? await readLatestAssistantTranscriptDistillation(
        input.input.vault,
        input.session.sessionId,
      )
    : null
  const continuityContext = [
    buildAssistantTranscriptDistillationContinuityText(transcriptDistillation),
    shouldResetCodexProviderSession
      ? await buildCodexPromptResetContinuityContext({
          sessionId: input.session.sessionId,
          vault: input.input.vault,
        })
      : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n') || null
  const stateMcpConfig = buildAssistantStateMcpConfig(
    workingDirectory,
  )
  const memoryMcpConfig = buildAssistantMemoryMcpConfig(
    workingDirectory,
  )
  const cronMcpConfig = buildAssistantCronMcpConfig(
    workingDirectory,
  )
  const exposesBoundAssistantTools = input.route.provider === 'openai-compatible'
  const assistantStateToolsAvailable =
    exposesBoundAssistantTools || (supportsDirectCliExecution && stateMcpConfig !== null)
  const assistantMemoryToolsAvailable =
    exposesBoundAssistantTools || (supportsDirectCliExecution && memoryMcpConfig !== null)
  const assistantCronToolsAvailable =
    exposesBoundAssistantTools || (supportsDirectCliExecution && cronMcpConfig !== null)
  const configOverrides = supportsDirectCliExecution
    ? [
        ...(stateMcpConfig?.configOverrides ?? []),
        ...(memoryMcpConfig?.configOverrides ?? []),
        ...(cronMcpConfig?.configOverrides ?? []),
      ]
    : []

  return {
    cliEnv: input.sharedPlan.cliAccess.env,
    configOverrides: configOverrides.length > 0 ? configOverrides : undefined,
    conversationMessages,
    continuityContext,
    resumeProviderSessionId,
    sessionContext: shouldInjectBootstrapContext
      ? {
          binding: input.session.binding,
        }
      : undefined,
    workingDirectory,
    systemPrompt: shouldInjectBootstrapContext
      ? buildAssistantSystemPrompt({
          assistantStateToolsAvailable,
          assistantCronToolsAvailable,
          cliAccess: input.sharedPlan.cliAccess,
          assistantMemoryToolsAvailable,
          assistantMemoryPrompt,
          channel: input.input.channel ?? input.session.binding.channel,
          onboardingSummary:
            shouldInjectFirstTurnOnboarding
              ? input.sharedPlan.onboardingSummary
              : null,
          supportsDirectCliExecution,
        })
      : null,
  }
}

async function executeAssistantProviderAttempt(input: {
  attemptPlan: AssistantProviderAttemptPlan
  executionPlan: AssistantProviderTurnExecutionPlan
  failoverState: AssistantProviderFailoverState
  providerRecovery: AssistantProviderRouteRecoveryState
}): Promise<AssistantProviderAttemptOutcome> {
  const { attemptPlan, executionPlan } = input

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
    const routeTraits = resolveAssistantProviderTraits(attemptPlan.route.provider)
    const result = await executeWithCanonicalWriteGuard({
      enabled: routeTraits.workspaceMode === 'direct-cli',
      vaultRoot: executionPlan.input.vault,
      execute: () =>
        executeAssistantProviderTurn({
          abortSignal: executionPlan.input.abortSignal,
          provider: attemptPlan.route.provider,
          workingDirectory: attemptPlan.routePlan.workingDirectory,
          configOverrides: attemptPlan.routePlan.configOverrides,
          env: {
            ...attemptPlan.routePlan.cliEnv,
            ...executionPlan.memoryTurnEnv,
          },
          userPrompt: executionPlan.input.prompt,
          continuityContext: attemptPlan.routePlan.continuityContext,
          systemPrompt: attemptPlan.routePlan.systemPrompt,
          toolRuntime: {
            requestId: executionPlan.turnId,
            vault: executionPlan.input.vault,
          },
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
        }),
    })

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
    await clearAssistantProviderRouteRecovery({
      sessionId: attemptPlan.session.sessionId,
      vault: executionPlan.input.vault,
    }).catch(() => undefined)

    return {
      kind: 'succeeded',
      failoverState: nextFailoverState,
      providerRecovery: null,
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
        currentCodexPromptVersion: executionPlan.currentCodexPromptVersion,
        previousBinding,
        provider: attemptPlan.route.provider,
        providerOptions: attemptPlan.route.providerOptions,
      }),
      routeId: attemptPlan.route.routeId,
      session: attemptPlan.session,
      vault: executionPlan.input.vault,
      workspaceKey: hashProviderWorkingDirectory(
        attemptPlan.routePlan.workingDirectory,
      ),
    })
    const session = recoveredSession ?? attemptPlan.session
    attachRecoveredAssistantSession(error, recoveredSession)
    const nextProviderRecovery = recoveredSession
      ? await readAssistantProviderRouteRecovery(
          executionPlan.input.vault,
          attemptPlan.session.sessionId,
        )
      : input.providerRecovery

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
        providerRecovery: nextProviderRecovery,
        error,
        session,
      }
    }

    return {
      kind: outcomeKind,
      error,
      failoverState: nextFailoverState,
      providerRecovery: nextProviderRecovery,
      session,
    }
  }
}

function classifyAssistantProviderAttemptFailure(input: {
  abortSignal?: AbortSignal
  error: unknown
  nextRoute: ResolvedAssistantFailoverRoute | null
}): 'blocked' | 'failed_terminal' | 'retry_next_route' {
  if (readAssistantErrorCode(input.error) === 'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED') {
    return 'blocked'
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
  return errorCode !== 'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED'
}

function shouldResetCodexProviderSessionForPromptVersion(input: {
  binding: AssistantProviderBinding | null
  currentCodexPromptVersion: string
  provider: AssistantChatProvider
}): boolean {
  return (
    input.provider === 'codex-cli' &&
    input.binding?.provider === 'codex-cli' &&
    input.binding.providerSessionId !== null &&
    readAssistantCodexPromptVersion({
      providerBinding: input.binding,
    }) !==
      input.currentCodexPromptVersion
  )
}

async function buildCodexPromptResetContinuityContext(input: {
  sessionId: string
  vault: string
}): Promise<string | null> {
  const transcript = await listAssistantTranscriptEntries(
    input.vault,
    input.sessionId,
  )
  const recentConversation = transcript
    .flatMap((entry) =>
      isAssistantConversationTranscriptEntry(entry)
        ? [
            `${entry.kind === 'user' ? 'User' : 'Assistant'}: ${truncateAssistantContinuityText(
              entry.text,
            )}`,
          ]
        : [],
    )
    .slice(-6)

  if (recentConversation.length === 0) {
    return null
  }

  return [
    'Recent local conversation transcript from this same Murph session:',
    recentConversation.join('\n\n'),
    'Use this only as continuity context while bootstrapping the fresh Codex provider session.',
  ].join('\n\n')
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

function buildAssistantSystemPrompt(input: {
  assistantStateToolsAvailable: boolean
  assistantCronToolsAvailable: boolean
  assistantMemoryToolsAvailable: boolean
  cliAccess: {
    rawCommand: 'vault-cli'
    setupCommand: 'murph'
  }
  assistantMemoryPrompt: string | null
  channel: string | null
  onboardingSummary: AssistantOnboardingSummary | null
  supportsDirectCliExecution: boolean
}): string {
  return [
    'You are Murph, a local-first health assistant bound to one active vault for this session.',
    'The active vault is already selected for this turn through the `VAULT` environment variable and Murph tools. The shell may start in an isolated assistant workspace instead of the live vault, so use `vault-cli` or assistant tools for vault work and do not treat direct file edits as the canonical path. Unless the user explicitly targets another vault, operate on this bound vault only.',
    [
      'Murph philosophy:',
      '- Murph is a calm, observant companion for understanding the body in the context of a life.',
      "- Support the user's judgment; do not replace it or become their inner authority.",
      '- Treat biomarkers and wearables as clues, not verdicts. Context, felt experience, and life-fit matter as much as numbers.',
      '- Default to synthesis over interruption: prefer summaries, weekly readbacks, and lightweight check-ins over constant nudges or micro-instructions.',
      '- Prefer one lightweight, reversible suggestion with burden, tradeoffs, and an off-ramp, or no suggestion at all, over stacks of protocols.',
      '- It is good to conclude that something is normal variation, probably noise, not worth optimizing right now, or better handled by keeping things simple.',
      '- Speak plainly and casually. Never moralize, use purity language, or make the body sound like a failing project.',
    ].join('\n'),
    [
      'Choose the right mode before acting:',
      '- Vault operator mode (default): inspect or change Murph vault/runtime state through `vault-cli` semantics and any Murph assistant tools exposed in this session. This is not repo coding work.',
      '- Repo coding mode: only when the user explicitly asks to change repository code, tests, or docs.',
      '- In repo coding mode, read and follow `AGENTS.md`, `agent-docs/index.md`, and `agent-docs/PRODUCT_CONSTITUTION.md` before making product, UX, copy, or behavior decisions.',
      '- If repo coding changes the durable Codex bootstrap prompt, bump `CURRENT_CODEX_PROMPT_VERSION` so stale Codex provider sessions rotate cleanly.',
    ].join('\n'),
    [
      'In vault operator mode:',
      '- `vault-cli` is the raw Murph operator/data-plane surface for vault, inbox, and assistant operations.',
      '- `murph` is the setup/onboarding entrypoint and also exposes the same top-level `chat` and `run` aliases after setup.',
      '- `chat` / `assistant chat` / `murph chat` are the same local interactive terminal chat surface.',
      '- `run` / `assistant run` / `murph run` are the long-lived automation loop for inbox watch, scheduled prompts, and configured channel auto-reply; with a model they can also triage inbox captures into structured vault updates.',
      '- Default to read-only inspection. Only write canonical vault data when the user is clearly asking to log, create, update, or delete something in the vault. Treat capture-style requests like meal logging as explicit permission to use the matching CLI write surface.',
      '- For vault-only tasks, do not read repo `AGENTS.md`, `agent-docs/**`, or `COORDINATION_LEDGER.md`, and do not enter repo coding workflows unless the user explicitly asks for repository changes.',
      '- Do not run repo tests, typechecks, coverage, coordination-ledger updates, or auto-commit workflows just because a vault CLI command changed data. Only use repo coding workflows when you edit repo code/docs or the user explicitly asks for software changes.',
    ].join('\n'),
    'Start with the smallest relevant context. Do not scan the whole vault or broad CLI manifests unless the task actually requires that coverage.',
    'Use canonical vault records and structured CLI output as the source of truth for health data. Read raw files directly only when the CLI or bound Murph tools lack the view you need or the user explicitly asks for targeted file-level inspection. Prefer narrow vault text-file reads over broad scans when file inspection is necessary.',
    buildAssistantVaultEvidenceFormattingGuidance(input.channel),
    buildOutboundReplyFormattingGuidance(input.channel),
    buildAssistantFirstTurnOnboardingGuidanceText(input.onboardingSummary),
    input.assistantMemoryPrompt,
    buildAssistantStateGuidanceText({
      rawCommand: input.cliAccess.rawCommand,
      assistantStateToolsAvailable: input.assistantStateToolsAvailable,
      supportsDirectCliExecution: input.supportsDirectCliExecution,
    }),
    buildAssistantMemoryGuidanceText({
      rawCommand: input.cliAccess.rawCommand,
      assistantMemoryToolsAvailable: input.assistantMemoryToolsAvailable,
      supportsDirectCliExecution: input.supportsDirectCliExecution,
    }),
    buildAssistantCronGuidanceText({
      rawCommand: input.cliAccess.rawCommand,
      assistantCronToolsAvailable: input.assistantCronToolsAvailable,
      supportsDirectCliExecution: input.supportsDirectCliExecution,
    }),
    buildAssistantCliGuidanceText(input.cliAccess, {
      supportsDirectCliExecution: input.supportsDirectCliExecution,
    }),
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n\n')
}

function buildAssistantStateGuidanceText(
  input: {
    assistantStateToolsAvailable: boolean
    rawCommand: 'vault-cli'
    supportsDirectCliExecution: boolean
  },
): string {
  if (input.assistantStateToolsAvailable) {
    return [
      'Assistant state tools are exposed in this session. Prefer the bound assistant-state tools over shelling out, and do not edit `assistant-state/state/` files directly.',
      'Use assistant state only for small non-canonical runtime scratchpads such as cron cooldowns, unresolved follow-ups, pending hypotheses, or delivery policy decisions.',
      'Assistant state is not long-term memory and not canonical vault data. Do not store durable confirmed facts there when they belong in assistant memory or the vault.',
      'Use `assistant state show` and `assistant state list` to inspect scratch state before repeating a question or suggestion, and use `assistant state patch` for incremental updates.',
      `Use \`${input.rawCommand} assistant state ...\` only as a fallback when the bound assistant-state tools are unavailable in this session.`,
    ].join('\n\n')
  }

  if (input.supportsDirectCliExecution) {
    return [
      'Assistant state tools are not exposed in this session, but direct Murph CLI execution is available.',
      `Use \`${input.rawCommand} assistant state list|show|put|patch|delete\` for small runtime scratchpads, and do not edit \`assistant-state/state/\` files directly.`,
      'Use assistant state only for small non-canonical runtime scratchpads such as cron cooldowns, unresolved follow-ups, pending hypotheses, or delivery policy decisions.',
      'Assistant state is not long-term memory and not canonical vault data. Do not store durable confirmed facts there when they belong in assistant memory or the vault.',
    ].join('\n\n')
  }

  return [
    'This provider path does not expose Murph assistant-state tools or direct shell access.',
    `If the user needs assistant scratch state inspected or changed here, give them the exact \`${input.rawCommand} assistant state ...\` command to run or switch to a Codex-backed Murph chat session.`,
    'Do not claim you inspected or updated assistant scratch state in this session unless a real tool call happened.',
  ].join('\n\n')
}

function buildAssistantVaultEvidenceFormattingGuidance(
  channel: string | null,
): string | null {
  if (isAssistantOutboundReplyChannel(channel)) {
    return null
  }

  return 'When you reference evidence from the vault, mention relative file paths when practical.'
}

function buildAssistantFirstTurnOnboardingGuidanceText(
  summary: AssistantOnboardingSummary | null,
): string | null {
  if (!summary || summary.missingSlots.length === 0) {
    return null
  }

  const known = [
    summary.answered.name ? `Name: ${summary.answered.name}` : null,
    summary.answered.tone ? `Tone/style: ${summary.answered.tone}` : null,
    summary.answered.goals.length > 0
      ? `Goals: ${summary.answered.goals.join(' | ')}`
      : null,
  ].filter((value): value is string => value !== null)
  const missing = summary.missingSlots.map((slot) => {
    switch (slot) {
      case 'name':
        return 'whether they want to give you a name'
      case 'tone':
        return 'what tone or response style they want'
      case 'goals':
        return 'what goals they want help with'
    }
  })

  return [
    known.length > 0
      ? `Known onboarding answers from prior sessions or the current message:\n- ${known.join('\n- ')}`
      : null,
    `On the first reply of a brand-new interactive chat session, include one short optional onboarding check-in only for the still-missing items:\n- ${missing.join('\n- ')}`,
    'If the first user message already asks for something concrete, answer that request first and then add the optional check-in as a brief closing note.',
    'Ask only about the missing items above, make it clear they are optional, and skip anything the user already told you.',
    'Stop asking once all onboarding items are filled. Do not repeat answered items or turn the check-in into a longer interview.',
  ].join('\n\n')
}

function buildOutboundReplyFormattingGuidance(channel: string | null): string | null {
  if (!isAssistantOutboundReplyChannel(channel)) {
    return null
  }

  return [
    'You are replying through a user-facing messaging channel, not the local terminal chat UI.',
    'Never include citations, source lists, footnotes, bracketed references, or appended file-path/source callouts in the reply unless the user explicitly asks for them.',
    'Do not mention internal vault paths, ledger filenames, JSONL files, or other implementation-level storage details unless the user explicitly asks for that detail.',
    'Do not surface raw machine timestamps such as ISO-8601 values by default. Prefer natural phrasing in the user-facing time context, such as "last night," "yesterday evening," or an explicit local date/time only when that precision is actually helpful.',
    'Reply naturally in plain conversational prose that fits the channel.',
  ].join('\n')
}

function isAssistantOutboundReplyChannel(channel: string | null): boolean {
  return (
    channel === 'email' ||
    channel === 'imessage' ||
    channel === 'linq' ||
    channel === 'telegram'
  )
}

function buildAssistantMemoryGuidanceText(
  input: {
    assistantMemoryToolsAvailable: boolean
    rawCommand: 'vault-cli'
    supportsDirectCliExecution: boolean
  },
): string {
  if (input.assistantMemoryToolsAvailable) {
    return [
      'Assistant memory tools are exposed in this session. Prefer the bound assistant-memory tools over shelling out, and do not edit `assistant-state/` files directly.',
      'When the current request depends on prior preferences, ongoing goals, recurring health context, or earlier plans, search assistant memory before answering.',
      'The active vault is already bound in this session. Do not switch vaults unless the user explicitly targets a different vault.',
      `Use \`${input.rawCommand} assistant memory ...\` only as a fallback when the bound assistant-memory tools are unavailable in this session.`,
      'Use memory upserts only when the user wants something remembered or when a stable identity, preference, or standing instruction clearly should persist.',
      'After a substantive conversation that surfaces a stable identity, preference, standing instruction, or durable health baseline, consider offering one short remember suggestion and only upsert after explicit user intent or acceptance.',
      'When manually upserting durable memory outside a live assistant turn, phrase `text` as the exact stored sentence you want committed, such as `Call the user Alex.`, `User prefers the default assistant tone.`, or `Keep responses brief.`',
      'Use `assistant memory forget` to remove mistaken or obsolete memory instead of appending a contradiction.',
      'Health memory is stricter: only store durable health context when the user explicitly asks you to remember it, and only in private assistant contexts.',
    ].join('\n\n')
  }

  if (input.supportsDirectCliExecution) {
    return [
      'Assistant memory tools are not exposed in this session, but direct Murph CLI execution is available.',
      `Use \`${input.rawCommand} assistant memory search|get|upsert|forget\` when you need stored memory, and do not edit \`assistant-state/\` files directly.`,
      'When the current request depends on prior preferences, ongoing goals, recurring health context, or earlier plans, search assistant memory before answering.',
      'Use memory upserts only when the user wants something remembered or when a stable identity, preference, or standing instruction clearly should persist.',
      'After a substantive conversation that surfaces a stable identity, preference, standing instruction, or durable health baseline, consider offering one short remember suggestion and only upsert after explicit user intent or acceptance.',
      'When manually upserting durable memory outside a live assistant turn, phrase `text` as the exact stored sentence you want committed, such as `Call the user Alex.`, `User prefers the default assistant tone.`, or `Keep responses brief.`',
      'Use `assistant memory forget` to remove mistaken or obsolete memory instead of appending a contradiction.',
      'Health memory is stricter: only store durable health context when the user explicitly asks you to remember it, and only in private assistant contexts.',
    ].join('\n\n')
  }

  return [
    'This provider path does not expose Murph assistant-memory tools or direct shell access.',
    'Use the injected core memory block if present, but do not claim you searched, updated, or forgot assistant memory unless a real tool call happened.',
    `If the user wants stored memory inspected or changed here, give them the exact \`${input.rawCommand} assistant memory ...\` command to run or switch to a Codex-backed Murph chat session.`,
    'When prior continuity would matter and you cannot search memory in this session, ask a brief clarifying question instead of inventing recall.',
    'Health memory is stricter: only store durable health context when the user explicitly asks you to remember it, and only in private assistant contexts.',
  ].join('\n\n')
}

function buildAssistantCronGuidanceText(
  input: {
    assistantCronToolsAvailable: boolean
    rawCommand: 'vault-cli'
    supportsDirectCliExecution: boolean
  },
): string {
  if (input.assistantCronToolsAvailable) {
    return [
      'Scheduled assistant automation tools are exposed in this session. Prefer the bound assistant-cron tools over shelling out, and do not edit `assistant-state/cron/` files directly.',
      'Built-in cron presets are available through `assistant cron preset list`, `assistant cron preset show`, and `assistant cron preset install`.',
      'When a user is onboarding or asks for automation ideas, offer the relevant preset first, then customize its variables, schedule, and outbound channel settings for them.',
      'Prefer digest-style or summary-style automation over nagging coaching. Default to weekly or daily summaries unless the user clearly asks for a higher-frequency nudge.',
      'Before asking the user to repeat phone, Telegram, or email routing details for an outbound cron job, inspect saved local self-targets. If the needed route is not already saved, ask for the missing details explicitly instead of guessing.',
      'Use `assistant cron add` for one-shot reminders with `--at` and recurring jobs with `--every` or `--cron`.',
      'Inspect the scheduler with `assistant cron status`, `assistant cron list`, `assistant cron show`, `assistant cron target show`, and `assistant cron runs` before changing an existing job.',
      'When the user wants to retarget an existing cron job without recreating it, use `assistant cron target set`.',
      'Cron schedules execute while `assistant run` is active for the vault.',
      'When a user or cron prompt asks for research on a complex topic or a broad current-evidence scan, default to `research` so the tool runs `review:gpt --deep-research --send --wait`. Use `deepthink` only when the task is a GPT Pro synthesis without Deep Research.',
      'Deep Research can legitimately take 10 to 60 minutes, sometimes longer, so keep waiting on the tool unless it actually errors or times out. Murph defaults the overall timeout to 40m.',
      '`--timeout` is the normal control. `--wait-timeout` is only for the uncommon case where you want the assistant-response wait cap different from the overall timeout.',
      'Cron prompts may explicitly tell you to use the research tool. In that case, run `research` for Deep Research or `deepthink` for GPT Pro before composing the final cron reply.',
      'Both research commands wait for completion and save a markdown note under `research/` inside the vault.',
      `Use \`${input.rawCommand} assistant cron ...\` only as a fallback when the bound assistant-cron tools are unavailable in this session.`,
    ].join('\n\n')
  }

  if (input.supportsDirectCliExecution) {
    return [
      'Scheduled assistant automation tools are not exposed in this session, but direct Murph CLI execution is available.',
      `Use \`${input.rawCommand} assistant cron ...\` when you need to inspect or change scheduled automation, and do not edit \`assistant-state/cron/\` files directly.`,
      'Built-in cron presets are available through `assistant cron preset list`, `assistant cron preset show`, and `assistant cron preset install`.',
      'When a user is onboarding or asks for automation ideas, offer the relevant preset first, then customize its variables, schedule, and outbound channel settings for them.',
      'Prefer digest-style or summary-style automation over nagging coaching. Default to weekly or daily summaries unless the user clearly asks for a higher-frequency nudge.',
      'Before asking the user to repeat phone, Telegram, or email routing details for an outbound cron job, inspect saved local self-targets. If the needed route is not already saved, ask for the missing details explicitly instead of guessing.',
      'Use `assistant cron add` for one-shot reminders with `--at` and recurring jobs with `--every` or `--cron`.',
      'Inspect the scheduler with `assistant cron status`, `assistant cron list`, `assistant cron show`, `assistant cron target show`, and `assistant cron runs` before changing an existing job.',
      'When the user wants to retarget an existing cron job without recreating it, use `assistant cron target set`.',
      'Cron schedules execute while `assistant run` is active for the vault.',
    ].join('\n\n')
  }

  return [
    'This provider path does not expose Murph cron tools or direct shell access.',
    `If the user wants automation here, explain the relevant \`${input.rawCommand} assistant cron ...\` command or suggest switching to a Codex-backed Murph chat session.`,
    'Built-in cron presets are available through `assistant cron preset list`, `assistant cron preset show`, and `assistant cron preset install`.',
    'When a user is onboarding or asks for automation ideas, offer the relevant preset first, then customize its variables, schedule, and outbound channel settings for them.',
    'Prefer digest-style or summary-style automation over nagging coaching. Default to weekly or daily summaries unless the user clearly asks for a higher-frequency nudge.',
    'Before asking the user to repeat phone, Telegram, or email routing details for an outbound cron job, inspect saved local self-targets. If the needed route is not already saved, ask for the missing details explicitly instead of guessing.',
    'Do not claim you created, changed, or inspected a cron job in this session unless a real tool call happened.',
    'Cron schedules execute while `assistant run` is active for the vault.',
  ].join('\n\n')
}
