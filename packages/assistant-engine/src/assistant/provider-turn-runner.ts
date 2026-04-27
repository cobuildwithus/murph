import { createHash } from 'node:crypto'

import type {
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  resolveAssistantUsageCredentialSource,
} from '@murphai/runtime-state/node'
import {
  executeAssistantProviderTurnAttempt,
  type AssistantProviderAttemptMetadata,
} from '../assistant-provider.js'
import { errorMessage } from './shared.js'
import {
  recordAssistantToolFailureRuntimeIssues,
} from './issue-reporting.js'
import {
  getAssistantFailoverCooldownUntil,
  readAssistantFailoverState,
  recordAssistantFailoverRouteFailure,
  recordAssistantFailoverRouteSuccess,
  shouldAttemptAssistantProviderFailover,
  type ResolvedAssistantFailoverRoute,
} from './failover.js'
import { maybeThrowInjectedAssistantFault } from './fault-injection.js'
import {
  attachRecoveredAssistantSession,
  recoverAssistantSessionAfterProviderFailure,
} from './provider-turn-recovery.js'
import { resolveOpenAiCompatibleVercelStripeBillingHeaders } from './providers/openai-compatible.js'
import {
  resolveAssistantRouteUserMessageContent,
} from './rich-content-routing.js'
import { appendAssistantTranscriptEntries } from './store.js'
import {
  buildAssistantProviderTranscriptAuditEntries,
} from './transcript-audit.js'
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
  AssistantTurnSharedPlan,
  ExecutedAssistantProviderTurnResult,
} from './service-contracts.js'
import {
  recordProviderAttemptFailed,
  recordProviderAttemptStarted,
  recordProviderAttemptSucceeded,
  recordProviderCooldownFailoverApplied,
  recordProviderFailoverApplied,
} from './provider-turn/attempt-observability.js'
import {
  buildAssistantProviderTurnExecutionPlan,
  prioritizeAssistantFailoverRoutes,
  resolveAssistantProviderAttemptPlan,
} from './provider-turn/planning.js'
import type {
  AssistantProviderAttemptPlan,
  AssistantProviderFailoverState,
  AssistantProviderTurnContinuityProfile,
  AssistantProviderTurnExecutionPlan,
  AssistantProviderTurnExecutionProfile,
} from './provider-turn/planning.js'

export {
  resolveAssistantProviderTurnContinuityPolicy,
  resolveAssistantProviderTurnContinuityPlan,
} from './provider-turn/planning.js'
export type {
  AssistantProviderTurnContinuityPlan,
  AssistantProviderTurnContinuityPolicy,
  AssistantProviderTurnContinuityProfile,
  AssistantProviderTurnExecutionProfile,
  AssistantProviderTurnNativeResumePolicy,
  AssistantProviderTurnPromptProfile,
  AssistantProviderTurnToolProfile,
} from './provider-turn/planning.js'
export {
  resolveAssistantOnboardingCompletionFallbackReason,
} from './provider-turn/onboarding-fallback.js'

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
      route?: ResolvedAssistantFailoverRoute | null
      session: AssistantSession
    }
  | {
      kind: 'succeeded'
      providerTurn: ExecutedAssistantProviderTurnResult
    }

export async function executeProviderTurnWithRecovery(input: {
  input: AssistantMessageInput
  plan: AssistantTurnSharedPlan
  profile?: AssistantProviderTurnContinuityProfile | null
  resolvedSession: AssistantSession
  routes: readonly ResolvedAssistantFailoverRoute[]
  turnCreatedAt: string
  turnId: string
}): Promise<AssistantProviderTurnRecoveryOutcome> {
  const executionPlan = await buildAssistantProviderTurnExecutionPlan(input)
  let failoverState = await readAssistantFailoverState(input.input.vault)
  const attemptedRouteIds = new Set<string>()
  let lastRetriableFailure: unknown = null
  let lastAttemptedRoute: ResolvedAssistantFailoverRoute | null = null
  let nextAttemptCount = 1
  let currentSession = input.resolvedSession

  while (attemptedRouteIds.size < executionPlan.routes.length) {
    const attemptPlan = await resolveAssistantProviderAttemptPlan({
      attemptCount: nextAttemptCount,
      attemptedRouteIds,
      executionPlan,
      failoverState,
      session: currentSession,
    })
    if (!attemptPlan) {
      break
    }

    attemptedRouteIds.add(attemptPlan.route.routeId)
    lastAttemptedRoute = attemptPlan.route
    nextAttemptCount = attemptPlan.attemptCount + 1

    const attemptOutcome = await executeAssistantProviderAttempt({
      attemptPlan,
      executionPlan,
      failoverState,
    })

    failoverState = attemptOutcome.failoverState
    if (attemptOutcome.kind !== 'succeeded') {
      currentSession = attemptOutcome.session
    }

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
          route: attemptPlan.route,
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
    route: lastAttemptedRoute,
    session: currentSession,
  }
}

function createAssistantProviderUsageAttribution(input: {
  attemptPlan: AssistantProviderAttemptPlan
  env: NodeJS.ProcessEnv
  executionPlan: AssistantProviderTurnExecutionPlan
  hostedMemberId: string | null
}): AssistantUsageAttribution | null {
  if (!input.hostedMemberId) {
    return null
  }

  const apiKeyEnv = input.attemptPlan.route.providerOptions.apiKeyEnv ?? null
  const credentialSource = resolveAssistantUsageCredentialSource({
    apiKeyEnv,
    effectiveEnv: input.env,
    headers: input.attemptPlan.route.providerOptions.headers ?? null,
    provider: input.attemptPlan.route.provider,
    userEnvKeys: [...(input.executionPlan.executionContext?.hosted?.userEnvKeys ?? [])],
  })
  const stripeCustomerId =
    input.executionPlan.executionContext?.hosted?.stripeCustomerId ?? null
  const stripeMeterSource =
    input.attemptPlan.route.provider === 'openai-compatible' &&
    resolveOpenAiCompatibleVercelStripeBillingHeaders({
      billingContext: {
        credentialSource,
        stripeCustomerId,
      },
      env: input.env,
      providerTarget: input.attemptPlan.route.providerOptions,
    })
      ? 'vercel-ai-gateway'
      : 'murph'

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
    stripeCustomerId,
    stripeMeterSource,
    triggerKind: resolveAssistantUsageTriggerKind(
      input.executionPlan.input.turnTrigger ?? 'manual-ask',
    ),
    zeroDataRetention: input.attemptPlan.route.providerOptions.zeroDataRetention ?? null,
  })
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
    providerActionCount: 0,
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
    const toolRuntime = attemptPlan.routePlan.supportsToolRuntime
      ? {
          allowSensitiveHealthContext:
            executionPlan.sharedPlan.allowSensitiveHealthContext,
          requestId: executionPlan.turnId,
          sessionId: attemptPlan.session.sessionId,
          toolCatalog,
          vault: executionPlan.input.vault,
        }
      : null
    const attemptEnv = {
      ...attemptPlan.routePlan.cliEnv,
      ...executionPlan.memoryTurnEnv,
    }
    const usageAttribution = createAssistantProviderUsageAttribution({
      attemptPlan,
      env: attemptEnv,
      executionPlan,
      hostedMemberId: executionPlan.executionContext?.hosted?.memberId ?? null,
    })
    emitHostedProviderRequestDebugTrace({
      attemptPlan,
      executionPlan,
    })
    const attemptResult = await executeAssistantProviderTurnAttempt({
      abortSignal: executionPlan.input.abortSignal,
      provider: attemptPlan.route.provider,
      workingDirectory: attemptPlan.routePlan.workingDirectory,
      env: attemptEnv,
      usageAttribution,
      userPrompt: executionPlan.input.prompt,
      userMessageContent: resolveAssistantRouteUserMessageContent({
        route: attemptPlan.route,
        userMessageContent: executionPlan.input.userMessageContent,
      }),
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
      presetId: attemptPlan.route.providerOptions.presetId,
      gatewayOnlyProviders: attemptPlan.route.providerOptions.gatewayOnlyProviders,
      headers: attemptPlan.route.providerOptions.headers,
      webSearch: attemptPlan.route.providerOptions.webSearch,
      zeroDataRetention:
        attemptPlan.route.providerOptions.zeroDataRetention ?? null,
      conversationMessages: attemptPlan.routePlan.conversationMessages,
      onEvent: executionPlan.input.onProviderEvent ?? undefined,
      profile: attemptPlan.route.providerOptions.profile,
      oss: attemptPlan.route.providerOptions.oss,
      onTraceEvent: executionPlan.input.onTraceEvent,
      showThinkingTraces: executionPlan.input.showThinkingTraces ?? false,
    })
    attemptMetadata = attemptResult.metadata
    await recordAssistantToolFailureRuntimeIssues({
      policy: attemptPlan.routePlan.diagnosticsPolicy,
      rawToolEvents: attemptMetadata.rawToolEvents,
      vault: executionPlan.input.vault,
    }).catch(() => undefined)
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
        onboardingCompletionFallbackReason:
          attemptPlan.routePlan.onboardingCompletionFallbackReason,
        onboardingGuidanceInjected: attemptPlan.routePlan.onboardingGuidanceInjected,
        providerOptions: attemptPlan.route.providerOptions,
        route: attemptPlan.route,
        session: attemptPlan.session,
        usageAttribution,
        workingDirectory: attemptPlan.routePlan.workingDirectory,
      },
    }
  } catch (error) {
    const errorCode = readAssistantErrorCode(error)
    const recoveredSession =
      executionPlan.profile.turnContinuityPolicy === 'continuous-provider-thread'
        ? await recoverAssistantSessionAfterProviderFailure({
            error,
            routeId: attemptPlan.route.routeId,
            session: attemptPlan.session,
            vault: executionPlan.input.vault,
          })
        : null
    const session = recoveredSession ?? attemptPlan.session
    if (recoveredSession) {
      attachRecoveredAssistantSession(error, recoveredSession)
    }
    void appendAssistantTranscriptEntries(
      executionPlan.input.vault,
      session.sessionId,
      buildAssistantProviderTranscriptAuditEntries({
        error,
        rawToolEvents: attemptMetadata.rawToolEvents,
        routeLabel: attemptPlan.route.label,
      }),
    ).catch(() => undefined)

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
      nonReplayableProviderWork:
        attemptMetadata.executedToolCount > 0 ||
        attemptMetadata.providerActionCount > 0 ||
        readAssistantProviderErrorActionCount(error) > 0,
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
  nonReplayableProviderWork: boolean
  nextRoute: ResolvedAssistantFailoverRoute | null
}): 'failed_terminal' | 'retry_next_route' {
  if (input.nonReplayableProviderWork) {
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

function emitHostedProviderRequestDebugTrace(input: {
  attemptPlan: AssistantProviderAttemptPlan
  executionPlan: AssistantProviderTurnExecutionPlan
}): void {
  const { attemptPlan, executionPlan } = input
  const onTraceEvent = executionPlan.input.onTraceEvent

  if (
    !onTraceEvent ||
    executionPlan.executionContext?.hosted == null
  ) {
    return
  }

  try {
    const providerOptions = attemptPlan.route.providerOptions
    const systemPrompt = attemptPlan.routePlan.systemPrompt ?? null
    const promptCacheMetadata = attemptPlan.routePlan.promptCacheMetadata
    const conversationMessages = attemptPlan.routePlan.conversationMessages ?? []
    const toolNames = listAssistantToolCatalogNames(executionPlan.toolCatalog)

    onTraceEvent({
      providerSessionId: null,
      rawEvent: {
        schema: 'murph.assistant-provider-request-debug.v1',
        type: 'assistant.provider.request.debug',
        attemptCount: attemptPlan.attemptCount,
        channel: executionPlan.input.channel ?? attemptPlan.session.binding.channel,
        conversationMessageCount: conversationMessages.length,
        conversationMessageRoles: conversationMessages.map((message) => message.role),
        deliveryDispatchMode: executionPlan.input.deliveryDispatchMode ?? null,
        gatewayOnlyProviderCount:
          providerOptions.gatewayOnlyProviders?.length ?? 0,
        gatewayOnlyProviders: providerOptions.gatewayOnlyProviders ?? null,
        previousResponseIdPresent:
          attemptPlan.routePlan.resumeProviderSessionId !== null,
        provider: attemptPlan.route.provider,
        providerExecutionDriver: providerOptions.executionDriver,
        providerModel: providerOptions.model ?? null,
        providerName: providerOptions.providerName ?? null,
        promptProfile: executionPlan.profile.promptProfile,
        routeId: attemptPlan.route.routeId,
        sessionContextPresent: attemptPlan.routePlan.sessionContext != null,
        supportsToolRuntime: attemptPlan.routePlan.supportsToolRuntime,
        turnContinuityPolicy: executionPlan.profile.turnContinuityPolicy,
        promptCacheDynamicContextStartsAfterStaticCore:
          promptCacheMetadata?.dynamicContextStartsAfterStaticCore ?? null,
        promptCacheStableRouteCapabilityPromptHash:
          promptCacheMetadata?.stableRouteCapabilityPromptHash ?? null,
        promptCacheStaticPromptHash:
          promptCacheMetadata?.staticPromptHash ?? null,
        promptCacheToolSchemaHash:
          promptCacheMetadata?.toolSchemaHash ?? null,
        systemPromptHash:
          systemPrompt === null ? null : hashAssistantProviderDebugText(systemPrompt),
        systemPromptLength: systemPrompt?.length ?? 0,
        toolCount: toolNames.length,
        toolNames,
        turnTrigger: executionPlan.input.turnTrigger ?? null,
        userPromptHash: hashAssistantProviderDebugText(executionPlan.input.prompt),
        userPromptLength: executionPlan.input.prompt.length,
        webSearch: providerOptions.webSearch ?? null,
        zeroDataRetention: providerOptions.zeroDataRetention ?? null,
      },
      updates: [
        {
          kind: 'status',
          text: 'Hosted provider request summary captured.',
        },
      ],
    })
  } catch {
    // Debug trace observers must not block the provider call.
  }
}

function hashAssistantProviderDebugText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function listAssistantToolCatalogNames(
  toolCatalog: AssistantProviderTurnExecutionPlan['toolCatalog'],
): string[] {
  return toolCatalog
    .listTools()
    .map((tool) => tool.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
    .sort()
}

function readAssistantErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null
  }

  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && code.trim().length > 0 ? code : null
}

function readAssistantProviderErrorActionCount(error: unknown): number {
  if (!error || typeof error !== 'object' || !('context' in error)) {
    return 0
  }

  const context = (error as { context?: unknown }).context
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return 0
  }

  const value = (context as { providerActionCount?: unknown }).providerActionCount
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0
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
