import type {
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  resolveAssistantUsageCredentialSource,
} from '@murphai/hosted-execution/assistant-usage'
import {
  executeCodexAssistantTurnAttemptFromInput,
  resolveCodexAssistantTargetCapabilities,
} from './provider-registry.js'
import type {
  AssistantProviderAttemptMetadata,
  AssistantProviderRequestOutcome,
  AssistantProviderUsage,
} from './providers/types.js'
import { errorMessage } from './shared.js'
import {
  recordAssistantToolFailureRuntimeIssues,
} from './issue-reporting.js'
import type { CodexThreadIdentity } from './provider-route.js'
import { maybeThrowInjectedAssistantFault } from './fault-injection.js'
import {
  annotateRecoveredCodexThreadIdForDiagnostics,
} from './provider-failure-diagnostics.js'
import { appendAssistantTranscriptEntries } from './store.js'
import {
  buildAssistantProviderTranscriptAuditEntries,
} from './transcript-audit.js'
import { HOSTED_STABLE_PROVIDER_WORKING_DIRECTORY } from './turn-plan.js'
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
import type { AssistantProviderTraceEvent } from './provider-traces.js'
import {
  recordProviderAttemptFailed,
  recordProviderAttemptStarted,
  recordProviderAttemptSucceeded,
  recordProviderPlan,
} from './provider-turn/attempt-observability.js'
import {
  buildAssistantProviderTurnExecutionPlan,
  buildCodexProviderAttemptPlan,
} from './provider-turn/planning.js'
import type {
  AssistantProviderAttemptPlan,
  AssistantProviderTurnExecutionPlan,
  AssistantProviderTurnExecutionProfile,
  AssistantProviderTurnThreadScopeProfile,
} from './provider-turn/planning.js'

const ASSISTANT_PROVIDER_PLAN_TRACE_SCHEMA =
  'murph.assistant-provider-plan-diagnostics.v1'
const ASSISTANT_PROVIDER_PLAN_TRACE_TYPE = 'assistant.provider.plan'

export {
  resolveAssistantProviderThreadPlan,
  resolveAssistantProviderThreadScope,
} from './provider-turn/planning.js'
export type {
  AssistantProviderThreadPlan,
  AssistantProviderTurnExecutionProfile,
  AssistantProviderTurnNativeResumePolicy,
  AssistantProviderTurnPromptProfile,
  AssistantProviderThreadScope,
  AssistantProviderTurnThreadScopeProfile,
  AssistantProviderTurnToolProfile,
} from './provider-turn/planning.js'

type AssistantProviderAttemptOutcome =
  | {
      kind: 'failed_terminal'
      attemptCount: number
      error: unknown
      providerRequestOutcome: Exclude<AssistantProviderRequestOutcome, 'succeeded'>
      providerContinuation: AssistantProviderContinuation
      providerSessionId: string | null
      providerTurnId: string | null
      rawEvents: unknown[]
      session: AssistantSession
      usage: AssistantProviderUsage | null
      usageAttribution: AssistantUsageAttribution | null
    }
  | {
      kind: 'succeeded'
      result: ExecutedAssistantProviderTurnResult
    }

export type AssistantProviderTurnRecoveryOutcome =
  | {
      kind: 'failed_terminal'
      attemptCount: number
      error: unknown
      providerRequestOutcome: Exclude<AssistantProviderRequestOutcome, 'succeeded'>
      providerContinuation: AssistantProviderContinuation
      providerSessionId: string | null
      providerTurnId: string | null
      rawEvents: unknown[]
      route: CodexThreadIdentity
      session: AssistantSession
      usage: AssistantProviderUsage | null
      usageAttribution: AssistantUsageAttribution | null
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
  profile?: AssistantProviderTurnThreadScopeProfile | null
  providerRequestOrdinal?: number | null
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
    providerRequestOrdinal: input.providerRequestOrdinal ?? null,
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
        attemptCount: attemptOutcome.attemptCount,
        error: attemptOutcome.error,
        providerRequestOutcome: attemptOutcome.providerRequestOutcome,
        providerContinuation: attemptOutcome.providerContinuation,
        providerSessionId: attemptOutcome.providerSessionId,
        providerTurnId: attemptOutcome.providerTurnId,
        rawEvents: attemptOutcome.rawEvents,
        route: attemptPlan.route,
        session: attemptOutcome.session,
        usage: attemptOutcome.usage,
        usageAttribution: attemptOutcome.usageAttribution,
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
    stripeMeterSource: 'murph',
    triggerKind: resolveAssistantUsageTriggerKind(
      input.executionPlan.input.turnTrigger ?? 'manual-ask',
    ),
  })
}

function emitProviderPlanTraceEvent(input: {
  activeTurnHistoryMessageCount: number
  activeTurnHistoryPresent: boolean
  onTraceEvent?: ((event: AssistantProviderTraceEvent) => void) | null
  providerContinuation: string
  providerRequestOrdinal: number | null
  refreshThreadInstructions: boolean
  resumeProviderSessionIdPresent: boolean
  workingDirectory: string
}): void {
  if (!input.onTraceEvent) {
    return
  }

  try {
    input.onTraceEvent({
      providerSessionId: null,
      rawEvent: {
        schema: ASSISTANT_PROVIDER_PLAN_TRACE_SCHEMA,
        type: ASSISTANT_PROVIDER_PLAN_TRACE_TYPE,
        activeTurnHistoryCount: input.activeTurnHistoryMessageCount,
        activeTurnHistoryPresent: input.activeTurnHistoryPresent,
        providerContinuation: input.providerContinuation,
        providerRequestOrdinal: input.providerRequestOrdinal,
        refreshThreadInstructions: input.refreshThreadInstructions,
        resumeProviderSessionIdPresent: input.resumeProviderSessionIdPresent,
        workingDirectoryKind:
          input.workingDirectory === HOSTED_STABLE_PROVIDER_WORKING_DIRECTORY
            ? 'hosted-stable-proc-cwd'
            : 'raw',
      },
      updates: [],
    })
  } catch {
    // Provider-plan traces are diagnostic-only and must not block turns.
  }
}

async function executeAssistantProviderAttempt(input: {
  attemptPlan: AssistantProviderAttemptPlan
  executionPlan: AssistantProviderTurnExecutionPlan
  providerRequestOrdinal: number | null
}): Promise<AssistantProviderAttemptOutcome> {
  const { attemptPlan, executionPlan } = input
  let attemptMetadata: AssistantProviderAttemptMetadata = {
    activityLabels: [] as readonly string[],
    executedToolCount: 0,
    providerActionCount: 0,
    rawToolEvents: [] as readonly unknown[],
  }

  const attemptAt = new Date().toISOString()
  await recordProviderPlan({
    activeTurnHistoryMessageCount:
      executionPlan.activeTurnHistory?.messages.length ?? 0,
    activeTurnHistoryPresent:
      (executionPlan.activeTurnHistory?.messages.length ?? 0) > 0,
    at: attemptAt,
    providerContinuation: attemptPlan.routePlan.providerContinuation.kind,
    providerRequestOrdinal: input.providerRequestOrdinal ?? null,
    refreshThreadInstructions: attemptPlan.routePlan.refreshThreadInstructions,
    resumeProviderSessionIdPresent:
      attemptPlan.routePlan.resumeProviderSessionId !== null,
    route: attemptPlan.route,
    sessionId: attemptPlan.session.sessionId,
    turnId: executionPlan.turnId,
    vault: executionPlan.input.vault,
    vaultRoot: executionPlan.input.vault,
    workingDirectory: attemptPlan.routePlan.workingDirectory,
  })
  emitProviderPlanTraceEvent({
    activeTurnHistoryMessageCount:
      executionPlan.activeTurnHistory?.messages.length ?? 0,
    activeTurnHistoryPresent:
      (executionPlan.activeTurnHistory?.messages.length ?? 0) > 0,
    onTraceEvent: executionPlan.input.onTraceEvent,
    providerContinuation: attemptPlan.routePlan.providerContinuation.kind,
    providerRequestOrdinal: input.providerRequestOrdinal ?? null,
    refreshThreadInstructions: attemptPlan.routePlan.refreshThreadInstructions,
    resumeProviderSessionIdPresent:
      attemptPlan.routePlan.resumeProviderSessionId !== null,
    workingDirectory: attemptPlan.routePlan.workingDirectory,
  })
  await recordProviderAttemptStarted({
    activeTurnMessagesPresent:
      (attemptPlan.routePlan.activeTurnMessages?.length ?? 0) > 0,
    attemptCount: attemptPlan.attemptCount,
    at: attemptAt,
    hasResumeProviderSessionId:
      attemptPlan.routePlan.resumeProviderSessionId !== null,
    providerContinuationKind: attemptPlan.routePlan.providerContinuation.kind,
    refreshThreadInstructions: attemptPlan.routePlan.refreshThreadInstructions,
    route: attemptPlan.route,
    sessionId: attemptPlan.session.sessionId,
    turnId: executionPlan.turnId,
    vault: executionPlan.input.vault,
  })
  let effectiveProviderContinuation = attemptPlan.routePlan.providerContinuation
  let usageAttribution: AssistantUsageAttribution | null = null
  let failedAttemptProviderSessionId: string | null = null
  let failedAttemptProviderTurnId: string | null = null
  let failedAttemptRawEvents: unknown[] = []
  let failedAttemptUsage: AssistantProviderUsage | null = null
  let failedAttemptOutcome: Exclude<AssistantProviderRequestOutcome, 'succeeded'> | null =
    null

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
    usageAttribution = createAssistantProviderUsageAttribution({
      attemptPlan,
      env: attemptEnv,
      executionPlan,
      hostedMemberId: executionPlan.executionContext?.hosted?.memberId ?? null,
    })
    const attemptResult = await executeCodexAssistantTurnAttemptFromInput({
      abortSignal: executionPlan.input.abortSignal,
      activeTurnId: executionPlan.turnId,
      activeTurnSteering: executionPlan.activeTurnSteering,
      activeTurnSessionId: attemptPlan.session.sessionId,
      provider: attemptPlan.route.provider,
      workingDirectory: attemptPlan.routePlan.workingDirectory,
      env: attemptEnv,
      developerInstructions: attemptPlan.routePlan.developerInstructions,
      usageAttribution,
      userPrompt: executionPlan.input.prompt,
      userMessageContent: resolveCodexRouteUserMessageContent({
        route: attemptPlan.route,
        userMessageContent: executionPlan.input.userMessageContent,
      }),
      systemPrompt: attemptPlan.routePlan.systemPrompt,
      turnContextPrompt: attemptPlan.routePlan.turnContextPrompt,
      sessionContext: attemptPlan.routePlan.sessionContext
        ? {
            binding: attemptPlan.session.binding,
          }
        : undefined,
      freshThreadFallback: attemptPlan.routePlan.freshThreadFallback,
      resumeProviderSessionId: attemptPlan.routePlan.resumeProviderSessionId,
      refreshThreadInstructions: attemptPlan.routePlan.refreshThreadInstructions,
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
      failedAttemptProviderSessionId = attemptResult.providerSessionId ?? null
      failedAttemptProviderTurnId = attemptResult.providerTurnId ?? null
      failedAttemptRawEvents = [...(attemptResult.rawEvents ?? [])]
      failedAttemptUsage = attemptResult.usage ?? null
      failedAttemptOutcome =
        attemptResult.providerRequestOutcome ??
        resolveFailedAssistantProviderRequestOutcome({
          error: attemptResult.error,
          rawEvents: failedAttemptRawEvents,
          usage: failedAttemptUsage,
        })
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
    if (executionPlan.profile.threadScope === 'session-thread') {
      annotateRecoveredCodexThreadIdForDiagnostics(error)
    }
    const session = attemptPlan.session
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
      attemptCount: attemptPlan.attemptCount,
      error,
      providerRequestOutcome:
        failedAttemptOutcome ??
        resolveFailedAssistantProviderRequestOutcome({
          error,
          rawEvents: failedAttemptRawEvents,
          usage: failedAttemptUsage,
        }),
      providerContinuation: effectiveProviderContinuation,
      providerSessionId: failedAttemptProviderSessionId,
      providerTurnId: failedAttemptProviderTurnId,
      rawEvents: failedAttemptRawEvents,
      session,
      usage: failedAttemptUsage,
      usageAttribution,
    }
  }
}

function resolveFailedAssistantProviderRequestOutcome(input: {
  error: unknown
  rawEvents: readonly unknown[]
  usage: AssistantProviderUsage | null
}): Exclude<AssistantProviderRequestOutcome, 'succeeded'> {
  if (isAssistantProviderAbortError(input.error)) {
    return 'aborted'
  }

  return input.usage && input.rawEvents.length > 0 ? 'partial' : 'failed'
}

function isAssistantProviderAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const code = 'code' in error ? (error as { code?: unknown }).code : null
  if (typeof code === 'string') {
    const normalizedCode = code.toUpperCase()
    if (
      normalizedCode.includes('ABORT') ||
      normalizedCode.includes('CANCEL') ||
      normalizedCode.includes('INTERRUPT')
    ) {
      return true
    }
  }

  const name = 'name' in error ? (error as { name?: unknown }).name : null
  return typeof name === 'string' && name === 'AbortError'
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
