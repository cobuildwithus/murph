import type {
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  resolveAssistantUsageCredentialSource,
} from '@murphai/hosted-execution/assistant-usage'
import {
  executeCodexAssistantTurnAttemptFromInput,
  resolveCodexAssistantTargetCapabilities,
} from './codex-runtime.js'
import type {
  AssistantProviderAttemptMetadata,
  AssistantProviderRequestOutcome,
  AssistantProviderUsage,
} from './providers/types.js'
import { errorMessage } from './shared.js'
import {
  recordAssistantToolFailureRuntimeIssues,
} from './issue-reporting.js'
import type { CodexThreadIdentity } from './codex-thread-route.js'
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
import type {
  AssistantProgressDelivery,
} from './turn-progress.js'
import type { AssistantCodexContinuation } from './active-turn-input-journal.js'
import type { AssistantUserMessageContentPart } from './content-types.js'
import type { AssistantProviderTraceEvent } from './provider-traces.js'
import {
  recordCodexAttemptFailed,
  recordCodexAttemptStarted,
  recordCodexAttemptSucceeded,
  recordCodexPlan,
} from './codex-turn/attempt-observability.js'
import {
  buildCodexTurnExecutionPlan,
  buildCodexTurnAttemptPlan,
} from './codex-turn/planning.js'
import type {
  AssistantCodexAttemptPlan,
  AssistantRoutePlanningDiagnostics,
  AssistantCodexTurnExecutionPlan,
  AssistantCodexTurnExecutionProfile,
  AssistantCodexTurnThreadScopeProfile,
} from './codex-turn/planning.js'

const ASSISTANT_PROVIDER_PLAN_TRACE_SCHEMA =
  'murph.assistant-provider-plan-diagnostics.v1'
const ASSISTANT_PROVIDER_PLAN_TRACE_TYPE = 'assistant.provider.plan'

export {
  resolveAssistantCodexThreadScope,
} from './codex-turn/planning.js'
export type {
  AssistantCodexTurnExecutionProfile,
  AssistantCodexTurnNativeResumePolicy,
  AssistantCodexTurnPromptProfile,
  AssistantCodexThreadScope,
  AssistantCodexTurnThreadScopeProfile,
  AssistantCodexTurnToolProfile,
} from './codex-turn/planning.js'

type AssistantCodexAttemptOutcome =
  | {
      kind: 'failed_terminal'
      attemptCount: number
      error: unknown
      providerRequestOutcome: Exclude<AssistantProviderRequestOutcome, 'succeeded'>
      codexContinuation: AssistantCodexContinuation
      codexThreadId: string | null
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

export type AssistantCodexTurnRecoveryOutcome =
  | {
      kind: 'failed_terminal'
      attemptCount: number
      error: unknown
      providerRequestOutcome: Exclude<AssistantProviderRequestOutcome, 'succeeded'>
      codexContinuation: AssistantCodexContinuation
      codexThreadId: string | null
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

export async function executeCodexTurnWithRecovery(input: {
  activeTurnSteering?: AssistantActiveTurnLiveProviderSteering | null
  input: AssistantMessageInput
  onProviderRequestPlanned?: (event: {
    providerAttemptId: string | null
    codexContinuation: AssistantCodexContinuation
  }) => Promise<void>
  onProviderRequestStarted?: (event: {
    providerRequestOrdinal: number | null
    startedAt: string
  }) => Promise<void> | void
  plan: AssistantTurnSharedPlan
  profile?: AssistantCodexTurnThreadScopeProfile | null
  providerRequestOrdinal?: number | null
  resolvedSession: AssistantSession
  route: CodexThreadIdentity
  progressDelivery?: AssistantProgressDelivery | null
  turnCreatedAt: string
  turnId: string
}): Promise<AssistantCodexTurnRecoveryOutcome> {
  const executionPlan = await buildCodexTurnExecutionPlan(input)
  const attemptPlan = await buildCodexTurnAttemptPlan({
    attemptCount: 1,
    executionPlan,
    session: input.resolvedSession,
  })

  await input.onProviderRequestPlanned?.({
    providerAttemptId: null,
    codexContinuation: attemptPlan.routePlan.codexContinuation,
  })

  const attemptOutcome = await executeAssistantCodexAttempt({
    attemptPlan,
    executionPlan,
    onProviderRequestStarted: input.onProviderRequestStarted ?? null,
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
        codexContinuation: attemptOutcome.codexContinuation,
        codexThreadId: attemptOutcome.codexThreadId,
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
  attemptPlan: AssistantCodexAttemptPlan
  env: NodeJS.ProcessEnv
  executionPlan: AssistantCodexTurnExecutionPlan
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

function emitCodexPlanTraceEvent(input: {
  onTraceEvent?: ((event: AssistantProviderTraceEvent) => void) | null
  codexContinuation: string
  providerRequestOrdinal: number | null
  routePlanningDiagnostics: AssistantRoutePlanningDiagnostics
  resumeCodexThreadIdPresent: boolean
  workingDirectory: string
}): void {
  if (!input.onTraceEvent) {
    return
  }

  try {
    input.onTraceEvent({
      codexThreadId: null,
      rawEvent: {
        schema: ASSISTANT_PROVIDER_PLAN_TRACE_SCHEMA,
        type: ASSISTANT_PROVIDER_PLAN_TRACE_TYPE,
        codexContinuation: input.codexContinuation,
        providerRequestOrdinal: input.providerRequestOrdinal,
        routePlanningElapsedMs: input.routePlanningDiagnostics.routePlanningElapsedMs,
        routePlanningCliBootstrapElapsedMs:
          input.routePlanningDiagnostics.cliBootstrapElapsedMs,
        routePlanningMemoryOverviewElapsedMs: null,
        routePlanningVaultOverviewElapsedMs: null,
        routePlanningActiveExperimentContextElapsedMs: null,
        routePlanningAssistantContextSnapshotElapsedMs:
          input.routePlanningDiagnostics.assistantContextSnapshotElapsedMs,
        routePlanningAnyBootstrapContextPrepared:
          input.routePlanningDiagnostics.shouldPrepareBootstrapContext,
        routePlanningBootstrapContextPrepared:
          input.routePlanningDiagnostics.shouldPrepareBootstrapContext,
        routePlanningFreshThreadFallbackPrepared: false,
        routePlanningFallbackInstructionsElapsedMs: null,
        routePlanningFreshThreadFallbackPromptElapsedMs: null,
        routePlanningMeasuredElapsedMs:
          input.routePlanningDiagnostics.routePlanningMeasuredElapsedMs,
        routePlanningPrimaryInstructionsElapsedMs:
          input.routePlanningDiagnostics.primarySystemPromptElapsedMs,
        routePlanningPrimarySystemPromptElapsedMs:
          input.routePlanningDiagnostics.primarySystemPromptElapsedMs,
        routePlanningResumeBindingElapsedMs:
          input.routePlanningDiagnostics.routeResumeBindingElapsedMs,
        routePlanningSlowestStage:
          input.routePlanningDiagnostics.routePlanningSlowestStage,
        routePlanningSlowestStageElapsedMs:
          input.routePlanningDiagnostics.routePlanningSlowestStageElapsedMs,
        routePlanningSupportedExperimentProtocolsElapsedMs:
          input.routePlanningDiagnostics.supportedExperimentProtocolsElapsedMs,
        routePlanningTargetCapabilitiesElapsedMs:
          input.routePlanningDiagnostics.routeTargetCapabilitiesElapsedMs,
        routePlanningUnaccountedElapsedMs:
          input.routePlanningDiagnostics.routePlanningUnaccountedElapsedMs,
        resumeCodexThreadIdPresent: input.resumeCodexThreadIdPresent,
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

async function executeAssistantCodexAttempt(input: {
  attemptPlan: AssistantCodexAttemptPlan
  executionPlan: AssistantCodexTurnExecutionPlan
  onProviderRequestStarted?: ((event: {
    providerRequestOrdinal: number | null
    startedAt: string
  }) => Promise<void> | void) | null
  providerRequestOrdinal: number | null
}): Promise<AssistantCodexAttemptOutcome> {
  const { attemptPlan, executionPlan } = input
  let attemptMetadata: AssistantProviderAttemptMetadata = {
    activityLabels: [] as readonly string[],
    executedToolCount: 0,
    providerActionCount: 0,
    rawToolEvents: [] as readonly unknown[],
  }

  const attemptAt = new Date().toISOString()
  await recordCodexPlan({
    at: attemptAt,
    codexContinuation: attemptPlan.routePlan.codexContinuation.kind,
    providerRequestOrdinal: input.providerRequestOrdinal ?? null,
    resumeCodexThreadIdPresent:
      attemptPlan.routePlan.resumeCodexThreadId !== null,
    route: attemptPlan.route,
    sessionId: attemptPlan.session.sessionId,
    turnId: executionPlan.turnId,
    vault: executionPlan.input.vault,
    vaultRoot: executionPlan.input.vault,
    workingDirectory: attemptPlan.routePlan.workingDirectory,
  })
  emitCodexPlanTraceEvent({
    onTraceEvent: executionPlan.input.onTraceEvent,
    codexContinuation: attemptPlan.routePlan.codexContinuation.kind,
    providerRequestOrdinal: input.providerRequestOrdinal ?? null,
    routePlanningDiagnostics: attemptPlan.routePlan.planningDiagnostics,
    resumeCodexThreadIdPresent:
      attemptPlan.routePlan.resumeCodexThreadId !== null,
    workingDirectory: attemptPlan.routePlan.workingDirectory,
  })
  await recordCodexAttemptStarted({
    attemptCount: attemptPlan.attemptCount,
    at: attemptAt,
    hasResumeCodexThreadId:
      attemptPlan.routePlan.resumeCodexThreadId !== null,
    codexContinuationKind: attemptPlan.routePlan.codexContinuation.kind,
    route: attemptPlan.route,
    sessionId: attemptPlan.session.sessionId,
    turnId: executionPlan.turnId,
    vault: executionPlan.input.vault,
  })
  let effectiveCodexContinuation = attemptPlan.routePlan.codexContinuation
  let usageAttribution: AssistantUsageAttribution | null = null
  let failedAttemptCodexThreadId: string | null = null
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
    const attemptEnv = attemptPlan.routePlan.cliEnv
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
      onProviderRequestStarted: (event) => {
        notifyProviderRequestStartedBestEffort({
          event: {
            providerRequestOrdinal: input.providerRequestOrdinal,
            startedAt: event.startedAt,
          },
          hook: input.onProviderRequestStarted ?? null,
        })
      },
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
      progressDelivery: executionPlan.progressDelivery ?? null,
      turnContextPrompt: attemptPlan.routePlan.turnContextPrompt,
      sessionContext: attemptPlan.routePlan.sessionContext
        ? {
            binding: attemptPlan.session.binding,
          }
        : undefined,
      freshThreadFallback: attemptPlan.routePlan.freshThreadFallback,
      prepareFreshThreadFallback:
        attemptPlan.routePlan.prepareFreshThreadFallback,
      resumeCodexThreadId: attemptPlan.routePlan.resumeCodexThreadId,
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
      conversationHistoryMessages:
        attemptPlan.routePlan.conversationHistoryMessages,
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
      failedAttemptCodexThreadId = attemptResult.codexThreadId ?? null
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
      effectiveCodexContinuation =
        attemptResult.codexContinuation ?? attemptPlan.routePlan.codexContinuation
      throw attemptResult.error
    }
    const result = attemptResult.result

    await recordCodexAttemptSucceeded({
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
        assistantContractFingerprint:
          attemptPlan.routePlan.assistantContractFingerprint,
        attemptCount: attemptPlan.attemptCount,
        nonReplayableProviderWork:
          attemptMetadata.executedToolCount > 0 ||
          attemptMetadata.providerActionCount > 0,
        onboardingGuidanceInjected: attemptPlan.routePlan.onboardingGuidanceInjected,
        codexContinuation:
          result.codexContinuation ?? effectiveCodexContinuation,
        providerOptions: attemptPlan.route.providerOptions,
        route: attemptPlan.route,
        responseMedia: result.responseMedia ?? [],
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

    await recordCodexAttemptFailed({
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
      codexContinuation: effectiveCodexContinuation,
      codexThreadId: failedAttemptCodexThreadId,
      providerTurnId: failedAttemptProviderTurnId,
      rawEvents: failedAttemptRawEvents,
      session,
      usage: failedAttemptUsage,
      usageAttribution,
    }
  }
}

function notifyProviderRequestStartedBestEffort(input: {
  event: {
    providerRequestOrdinal: number | null
    startedAt: string
  }
  hook?: ((event: {
    providerRequestOrdinal: number | null
    startedAt: string
  }) => Promise<void> | void) | null
}): void {
  if (!input.hook) {
    return
  }

  try {
    void Promise.resolve(input.hook(input.event)).catch(() => {
      // Provider-start hooks are diagnostic-only and must not block turns.
    })
  } catch {
    // Provider-start hooks are diagnostic-only and must not block turns.
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
