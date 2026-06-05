import {
  readCodexThreadRouteFingerprint,
  type CodexThreadIdentity,
} from '../codex-thread-route.js'
import { recordAssistantDiagnosticEvent } from '../diagnostics.js'
import {
  fingerprintHostedAssistantContextValue,
  resolveHostedAssistantContextFingerprintSecret,
} from '../hosted-context-diagnostics.js'
import { HOSTED_STABLE_PROVIDER_WORKING_DIRECTORY } from '../turn-plan.js'
import {
  appendAssistantTurnReceiptEvent,
} from '../turns.js'

export async function recordCodexAttemptStarted(input: {
  attemptCount: number
  at: string
  hasResumeCodexThreadId: boolean
  codexContinuationKind: string
  refreshThreadInstructions: boolean
  route: CodexThreadIdentity
  sessionId: string
  turnId: string
  vault: string
}): Promise<void> {
  const routeFingerprint = readCodexThreadRouteFingerprint(input.route)
  await appendAssistantTurnReceiptEvent({
    vault: input.vault,
    turnId: input.turnId,
    kind: 'provider.attempt.started',
    detail: input.route.label,
    metadata: {
      attempt: String(input.attemptCount),
      provider: input.route.provider,
      model: input.route.providerOptions.model ?? 'default',
      routeFingerprint,
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
      routeFingerprint,
      provider: input.route.provider,
      model: input.route.providerOptions.model,
      modelProvider: input.route.providerOptions.modelProvider,
      reasoningEffort: input.route.providerOptions.reasoningEffort,
      codexContinuationKind: input.codexContinuationKind,
      refreshThreadInstructions: input.refreshThreadInstructions,
      hasResumeCodexThreadId: input.hasResumeCodexThreadId,
    },
    counterDeltas: {
      providerAttempts: 1,
    },
    at: input.at,
  })
}

export async function recordCodexPlan(input: {
  at: string
  codexContinuation: string
  providerRequestOrdinal: number | null
  refreshThreadInstructions: boolean
  resumeCodexThreadIdPresent: boolean
  route: CodexThreadIdentity
  sessionId: string
  turnId: string
  vault: string
  vaultRoot: string
  workingDirectory: string
}): Promise<void> {
  const routeFingerprint = readCodexThreadRouteFingerprint(input.route)
  const pathDiagnostics = buildProviderPlanPathDiagnostics({
    codexHome: input.route.providerOptions.codexHome ?? null,
    vaultRoot: input.vaultRoot,
    workingDirectory: input.workingDirectory,
  })
  await recordAssistantDiagnosticEvent({
    vault: input.vault,
    component: 'provider',
    kind: 'provider.plan',
    message: 'Assistant provider plan resolved.',
    sessionId: input.sessionId,
    turnId: input.turnId,
    data: {
      sessionId: input.sessionId,
      routeFingerprint,
      providerRequestOrdinal: input.providerRequestOrdinal,
      codexContinuation: input.codexContinuation,
      resumeCodexThreadIdPresent: input.resumeCodexThreadIdPresent,
      refreshThreadInstructions: input.refreshThreadInstructions,
      ...pathDiagnostics,
    },
    at: input.at,
  })
}

function buildProviderPlanPathDiagnostics(input: {
  codexHome: string | null
  vaultRoot: string
  workingDirectory: string
}): {
  codexHomeHash: string | null
  vaultRootHash: string | null
  workingDirectoryHash: string | null
  workingDirectoryKind: 'hosted-stable-proc-cwd' | 'raw'
} {
  const secret = resolveHostedAssistantContextFingerprintSecret()
  return {
    codexHomeHash:
      secret
        ? fingerprintHostedAssistantContextValue(secret, 'codex_home', input.codexHome)
        : null,
    vaultRootHash:
      secret
        ? fingerprintHostedAssistantContextValue(secret, 'vault_root', input.vaultRoot)
        : null,
    workingDirectoryHash:
      secret
        ? fingerprintHostedAssistantContextValue(
            secret,
            'working_directory',
            input.workingDirectory,
          )
        : null,
    workingDirectoryKind:
      input.workingDirectory === HOSTED_STABLE_PROVIDER_WORKING_DIRECTORY
        ? 'hosted-stable-proc-cwd'
        : 'raw',
  }
}

export async function recordCodexAttemptSucceeded(input: {
  activityLabels?: readonly string[]
  attemptCount: number
  route: CodexThreadIdentity
  turnId: string
  vault: string
}): Promise<void> {
  const activityLabels = input.activityLabels ?? []
  const routeFingerprint = readCodexThreadRouteFingerprint(input.route)
  const metadata: Record<string, string> = {
    attempt: String(input.attemptCount),
    provider: input.route.provider,
    model: input.route.providerOptions.model ?? 'default',
    routeFingerprint,
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

export async function recordCodexAttemptFailed(input: {
  activityLabels?: readonly string[]
  attemptCount: number
  detail: string
  errorCode: string | null
  route: CodexThreadIdentity
  sessionId: string
  turnId: string
  vault: string
}): Promise<void> {
  const activityLabels = input.activityLabels ?? []
  const routeFingerprint = readCodexThreadRouteFingerprint(input.route)
  const metadata: Record<string, string> = {
    attempt: String(input.attemptCount),
    provider: input.route.provider,
    model: input.route.providerOptions.model ?? 'default',
    routeFingerprint,
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
      routeFingerprint,
      provider: input.route.provider,
      model: input.route.providerOptions.model,
    },
    counterDeltas: {
      providerFailures: 1,
    },
  })
}
