import type {
  CodexThreadIdentity,
} from '../provider-route.js'
import { recordAssistantDiagnosticEvent } from '../diagnostics.js'
import {
  fingerprintHostedAssistantContextValue,
  resolveHostedAssistantContextFingerprintSecret,
} from '../hosted-context-diagnostics.js'
import { HOSTED_STABLE_PROVIDER_WORKING_DIRECTORY } from '../turn-plan.js'
import {
  appendAssistantTurnReceiptEvent,
} from '../turns.js'

export async function recordProviderAttemptStarted(input: {
  activeTurnMessagesPresent: boolean
  attemptCount: number
  at: string
  conversationMessagesPresent: boolean
  hasResumeProviderSessionId: boolean
  hasStoredThreadInstructionsFingerprint: boolean
  hasThreadInstructionsFingerprint: boolean
  providerContinuationKind: string
  refreshThreadInstructions: boolean
  route: CodexThreadIdentity
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
      modelProvider: input.route.providerOptions.modelProvider,
      reasoningEffort: input.route.providerOptions.reasoningEffort,
      providerContinuationKind: input.providerContinuationKind,
      refreshThreadInstructions: input.refreshThreadInstructions,
      hasResumeProviderSessionId: input.hasResumeProviderSessionId,
      hasStoredThreadInstructionsFingerprint:
        input.hasStoredThreadInstructionsFingerprint,
      hasThreadInstructionsFingerprint: input.hasThreadInstructionsFingerprint,
      activeTurnMessagesPresent: input.activeTurnMessagesPresent,
      conversationMessagesPresent: input.conversationMessagesPresent,
    },
    counterDeltas: {
      providerAttempts: 1,
    },
    at: input.at,
  })
}

export async function recordProviderPlan(input: {
  activeTurnHistoryMessageCount: number
  activeTurnHistoryPresent: boolean
  at: string
  providerContinuation: string
  providerRequestOrdinal: number | null
  refreshThreadInstructions: boolean
  resumeProviderSessionIdPresent: boolean
  route: CodexThreadIdentity
  sessionId: string
  storedThreadInstructionsFingerprintPresent: boolean
  threadInstructionsFingerprintPresent: boolean
  turnId: string
  vault: string
  vaultRoot: string
  workingDirectory: string
}): Promise<void> {
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
      routeId: input.route.routeId,
      providerRequestOrdinal: input.providerRequestOrdinal,
      providerContinuation: input.providerContinuation,
      resumeProviderSessionIdPresent: input.resumeProviderSessionIdPresent,
      refreshThreadInstructions: input.refreshThreadInstructions,
      activeTurnHistoryPresent: input.activeTurnHistoryPresent,
      activeTurnHistoryMessageCount: input.activeTurnHistoryMessageCount,
      threadInstructionsFingerprintPresent:
        input.threadInstructionsFingerprintPresent,
      storedThreadInstructionsFingerprintPresent:
        input.storedThreadInstructionsFingerprintPresent,
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

export async function recordProviderAttemptSucceeded(input: {
  activityLabels?: readonly string[]
  attemptCount: number
  route: CodexThreadIdentity
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

export async function recordProviderAttemptFailed(input: {
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
    },
    counterDeltas: {
      providerFailures: 1,
    },
  })
}
