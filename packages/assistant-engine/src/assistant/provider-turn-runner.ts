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
  type ResolvedAssistantFailoverRoute,
} from './failover.js'
import { maybeThrowInjectedAssistantFault } from './fault-injection.js'
import {
  attachRecoveredAssistantSession,
  recoverAssistantSessionAfterProviderFailure,
} from './provider-turn-recovery.js'
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
import type {
  AssistantActiveTurnLiveProviderSteering,
} from './turn-input.js'
import type { AssistantProviderContinuation } from './active-turn-input-journal.js'
import type { AssistantActiveTurnProviderHistory } from './active-turn-history.js'
import {
  recordProviderAttemptFailed,
  recordProviderAttemptStarted,
  recordProviderAttemptSucceeded,
} from './provider-turn/attempt-observability.js'
import {
  buildAssistantProviderTurnExecutionPlan,
  resolveAssistantProviderAttemptPlan,
} from './provider-turn/planning.js'
import type {
  AssistantProviderAttemptPlan,
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
      providerContinuation: AssistantProviderContinuation
      session: AssistantSession
    }
  | {
      kind: 'succeeded'
      result: ExecutedAssistantProviderTurnResult
    }

export type AssistantProviderTurnRecoveryOutcome =
  | {
      kind: 'failed_terminal'
      error: unknown
      providerContinuation: AssistantProviderContinuation
      route?: ResolvedAssistantFailoverRoute | null
      session: AssistantSession
    }
  | {
      kind: 'succeeded'
      providerTurn: ExecutedAssistantProviderTurnResult
    }

export async function executeProviderTurnWithRecovery(input: {
  activeTurnHistory?: AssistantActiveTurnProviderHistory | null
  activeTurnSteering?: AssistantActiveTurnLiveProviderSteering | null
  input: AssistantMessageInput
  onProviderRequestPlanned?: (event: {
    providerAttemptId: string | null
    providerContinuation: AssistantProviderContinuation
  }) => Promise<void>
  plan: AssistantTurnSharedPlan
  profile?: AssistantProviderTurnContinuityProfile | null
  resolvedSession: AssistantSession
  routes: readonly ResolvedAssistantFailoverRoute[]
  turnCreatedAt: string
  turnId: string
}): Promise<AssistantProviderTurnRecoveryOutcome> {
  const executionPlan = await buildAssistantProviderTurnExecutionPlan(input)
  const attemptedRouteIds = new Set<string>()
  const attemptPlan = await resolveAssistantProviderAttemptPlan({
    attemptCount: 1,
    attemptedRouteIds,
    executionPlan,
    session: input.resolvedSession,
  })
  if (!attemptPlan) {
    return {
      kind: 'failed_terminal',
      error: new Error('Assistant provider route was not available. Reconfigure the assistant to use Codex.'),
      providerContinuation: {
        kind: 'explicit-structured-history',
      },
      route: null,
      session: input.resolvedSession,
    }
  }

  await input.onProviderRequestPlanned?.({
    providerAttemptId: null,
    providerContinuation: attemptPlan.routePlan.providerContinuation,
  })

  const attemptOutcome = await executeAssistantProviderAttempt({
    attemptPlan,
    executionPlan,
  })

  switch (attemptOutcome.kind) {
    case 'succeeded':
      return {
        kind: 'succeeded',
        providerTurn: attemptOutcome.result,
      }
    case 'failed_terminal':
      return {
        kind: 'failed_terminal',
        error: attemptOutcome.error,
        providerContinuation: attemptOutcome.providerContinuation,
        route: attemptPlan.route,
        session: attemptOutcome.session,
      }
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

  const credentialSource = resolveAssistantUsageCredentialSource({
    apiKeyEnv: null,
    effectiveEnv: input.env,
    headers: null,
    provider: input.attemptPlan.route.provider,
    userEnvKeys: [...(input.executionPlan.executionContext?.hosted?.userEnvKeys ?? [])],
  })
  const stripeCustomerId =
    input.executionPlan.executionContext?.hosted?.stripeCustomerId ?? null
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
    stripeMeterSource: 'murph',
    triggerKind: resolveAssistantUsageTriggerKind(
      input.executionPlan.input.turnTrigger ?? 'manual-ask',
    ),
    zeroDataRetention: null,
  })
}

async function executeAssistantProviderAttempt(input: {
  attemptPlan: AssistantProviderAttemptPlan
  executionPlan: AssistantProviderTurnExecutionPlan
}): Promise<AssistantProviderAttemptOutcome> {
  const { attemptPlan, executionPlan } = input
  let attemptMetadata: AssistantProviderAttemptMetadata = {
    activityLabels: [] as readonly string[],
    executedToolCount: 0,
    providerActionCount: 0,
    rawToolEvents: [] as readonly unknown[],
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
  let effectiveProviderContinuation = attemptPlan.routePlan.providerContinuation

  try {
    maybeThrowInjectedAssistantFault({
      component: 'provider',
      fault: 'provider',
      message: 'Injected assistant provider failure.',
    })
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
      activeTurnId: executionPlan.turnId,
      activeTurnSteering: executionPlan.activeTurnSteering,
      activeTurnSessionId: attemptPlan.session.sessionId,
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
      modelProvider: attemptPlan.route.providerOptions.modelProvider,
      reasoningEffort: attemptPlan.route.providerOptions.reasoningEffort,
      sandbox: attemptPlan.route.providerOptions.sandbox,
      approvalPolicy: attemptPlan.route.providerOptions.approvalPolicy,
      activeTurnMessages: attemptPlan.routePlan.activeTurnMessages,
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
      effectiveProviderContinuation =
        attemptResult.providerContinuation ?? attemptPlan.routePlan.providerContinuation
      throw attemptResult.error
    }
    const result = attemptResult.result

    await recordProviderAttemptSucceeded({
      activityLabels: attemptMetadata.activityLabels,
      attemptCount: attemptPlan.attemptCount,
      route: attemptPlan.route,
      turnId: executionPlan.turnId,
      vault: executionPlan.input.vault,
    })
    return {
      kind: 'succeeded',
      result: {
        ...result,
        attemptCount: attemptPlan.attemptCount,
        nonReplayableProviderWork:
          attemptMetadata.executedToolCount > 0 ||
          attemptMetadata.providerActionCount > 0,
        onboardingCompletionFallbackReason:
          attemptPlan.routePlan.onboardingCompletionFallbackReason,
        onboardingGuidanceInjected: attemptPlan.routePlan.onboardingGuidanceInjected,
        providerContinuation:
          result.providerContinuation ?? effectiveProviderContinuation,
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

    await recordProviderAttemptFailed({
      activityLabels: attemptMetadata.activityLabels,
      attemptCount: attemptPlan.attemptCount,
      cooldownUntil: null,
      detail: errorMessage(error),
      errorCode,
      route: attemptPlan.route,
      sessionId: session.sessionId,
      turnId: executionPlan.turnId,
      vault: executionPlan.input.vault,
    })

    return {
      kind: 'failed_terminal',
      error,
      providerContinuation: effectiveProviderContinuation,
      session,
    }
  }
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
    const activeTurnMessages = attemptPlan.routePlan.activeTurnMessages ?? []
    const conversationMessages = attemptPlan.routePlan.conversationMessages ?? []
    const toolNames: string[] = []

    onTraceEvent({
      providerSessionId: null,
      rawEvent: {
        schema: 'murph.assistant-provider-request-debug.v1',
        type: 'assistant.provider.request.debug',
        attemptCount: attemptPlan.attemptCount,
        channel: executionPlan.input.channel ?? attemptPlan.session.binding.channel,
        activeTurnMessageCount: activeTurnMessages.length,
        activeTurnMessageRoles: activeTurnMessages.map((message) => message.role),
        conversationMessageCount: conversationMessages.length,
        conversationMessageRoles: conversationMessages.map((message) => message.role),
        deliveryDispatchMode: executionPlan.input.deliveryDispatchMode ?? null,
        providerResumeSessionIdPresent:
          attemptPlan.routePlan.resumeProviderSessionId !== null,
        provider: attemptPlan.route.provider,
        providerExecutionDriver: providerOptions.executionDriver,
        providerModel: providerOptions.model ?? null,
        promptProfile: executionPlan.profile.promptProfile,
        routeId: attemptPlan.route.routeId,
        sessionContextPresent: attemptPlan.routePlan.sessionContext != null,
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

function readAssistantErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null
  }

  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && code.trim().length > 0 ? code : null
}
