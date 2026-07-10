import {
  readCodexThreadRouteFingerprint,
  type CodexThreadIdentity,
} from '../codex-thread-route.js'
import { recordAssistantDiagnosticEvent } from '../diagnostics.js'
import {
  appendAssistantTurnReceiptEvent,
} from '../turns.js'

export async function recordCodexAttemptStarted(input: {
  attemptCount: number
  at: string
  route: CodexThreadIdentity
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
