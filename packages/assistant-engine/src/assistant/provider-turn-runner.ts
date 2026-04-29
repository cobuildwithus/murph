import type {
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  resolveAssistantUsageCredentialSource,
} from '@murphai/runtime-state/node'
import {
  executeCodexAssistantTurnAttemptFromInput,
  resolveCodexAssistantTargetCapabilities,
} from './provider-registry.js'
import type { AssistantProviderAttemptMetadata } from './providers/types.js'
import { errorMessage } from './shared.js'
import {
  recordAssistantToolFailureRuntimeIssues,
} from './issue-reporting.js'
import {
  maybeHandleAssistantHostedDeviceConnect,
} from './hosted-device-connect.js'
import {
  type CodexThreadIdentity,
} from './provider-route.js'
import { maybeThrowInjectedAssistantFault } from './fault-injection.js'
import {
  attachRecoveredAssistantSession,
  recoverAssistantSessionAfterProviderFailure,
} from './provider-turn-recovery.js'
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
import type { AssistantUserMessageContentPart } from './content-types.js'
import {
  recordProviderAttemptFailed,
  recordProviderAttemptStarted,
  recordProviderAttemptSucceeded,
} from './provider-turn/attempt-observability.js'
import {
  buildAssistantProviderTurnExecutionPlan,
  buildCodexProviderAttemptPlan,
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

const VERCEL_AI_GATEWAY_MODEL_PROVIDER_ID = 'vercel-ai-gateway' as const

export type AssistantProviderTurnRecoveryOutcome =
  | {
      kind: 'failed_terminal'
      error: unknown
      providerContinuation: AssistantProviderContinuation
      route: CodexThreadIdentity
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
  route: CodexThreadIdentity
  turnCreatedAt: string
  turnId: string
}): Promise<AssistantProviderTurnRecoveryOutcome> {
  const executionPlan = await buildAssistantProviderTurnExecutionPlan(input)
  const attemptPlan = await buildCodexProviderAttemptPlan({
    attemptCount: 1,
    executionPlan,
    session: input.resolvedSession,
  })

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
  const stripeMeterSource =
    stripeCustomerId
    && credentialSource === 'platform'
    && input.attemptPlan.route.provider === 'codex-cli'
    && input.attemptPlan.route.providerOptions.modelProvider ===
      VERCEL_AI_GATEWAY_MODEL_PROVIDER_ID
      ? VERCEL_AI_GATEWAY_MODEL_PROVIDER_ID
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
    const hostedDeviceConnect =
      await maybeHandleAssistantHostedDeviceConnect({
        channel: executionPlan.input.channel,
        executionContext: executionPlan.executionContext,
        onboardingGuidanceInjected:
          attemptPlan.routePlan.onboardingGuidanceInjected,
        prompt: executionPlan.input.prompt,
      })
    if (hostedDeviceConnect.kind === 'handled') {
      attemptMetadata = {
        activityLabels: ['hosted-device-connect'],
        executedToolCount: 0,
        providerActionCount: hostedDeviceConnect.providerActionCount,
        rawToolEvents: [],
      }
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
          attemptCount: attemptPlan.attemptCount,
          nonReplayableProviderWork:
            hostedDeviceConnect.providerActionCount > 0,
          onboardingCompletionFallbackReason:
            attemptPlan.routePlan.onboardingCompletionFallbackReason,
          onboardingGuidanceInjected:
            attemptPlan.routePlan.onboardingGuidanceInjected,
          provider: attemptPlan.route.provider,
          providerContinuation: effectiveProviderContinuation,
          providerOptions: attemptPlan.route.providerOptions,
          providerSessionId: null,
          rawEvents: [],
          response: hostedDeviceConnect.response,
          route: attemptPlan.route,
          session: attemptPlan.session,
          stderr: '',
          stdout: '',
          usage: null,
          usageAttribution,
          workingDirectory: attemptPlan.routePlan.workingDirectory,
        },
      }
    }
    const attemptResult = await executeCodexAssistantTurnAttemptFromInput({
      abortSignal: executionPlan.input.abortSignal,
      activeTurnId: executionPlan.turnId,
      activeTurnSteering: executionPlan.activeTurnSteering,
      activeTurnSessionId: attemptPlan.session.sessionId,
      provider: attemptPlan.route.provider,
      workingDirectory: attemptPlan.routePlan.workingDirectory,
      env: attemptEnv,
      usageAttribution,
      userPrompt: executionPlan.input.prompt,
      userMessageContent: resolveCodexRouteUserMessageContent({
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

function readAssistantErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null
  }

  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && code.trim().length > 0 ? code : null
}

function resolveCodexRouteUserMessageContent(input: {
  route: CodexThreadIdentity
  userMessageContent: readonly AssistantUserMessageContentPart[] | null | undefined
}): AssistantUserMessageContentPart[] | null {
  const normalized = normalizeAssistantUserMessageContent(input.userMessageContent)
  if (normalized === null) {
    return null
  }

  if (!hasAssistantRichUserMessageContent(normalized)) {
    return normalized
  }

  const supportedTypes = new Set(
    resolveCodexAssistantTargetCapabilities(
      input.route.providerOptions,
    ).supportedUserMessageContentTypes,
  )
  const supported = normalized.filter((part) => supportedTypes.has(part.type))

  return hasAssistantRichUserMessageContent(supported) ? supported : null
}

function normalizeAssistantUserMessageContent(
  userMessageContent: readonly AssistantUserMessageContentPart[] | null | undefined,
): AssistantUserMessageContentPart[] | null {
  if (!Array.isArray(userMessageContent) || userMessageContent.length === 0) {
    return null
  }

  return [...userMessageContent]
}

function hasAssistantRichUserMessageContent(
  userMessageContent: readonly AssistantUserMessageContentPart[],
): boolean {
  return userMessageContent.some((part) => part.type !== 'text')
}
