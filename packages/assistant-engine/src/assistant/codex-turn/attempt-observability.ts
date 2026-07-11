import {
  readCodexThreadRouteFingerprint,
  type CodexThreadIdentity,
} from '../codex-thread-route.js'
import { recordAssistantDiagnosticEvent } from '../diagnostics.js'
import { warnAssistantBestEffortFailure } from '../shared.js'
import {
  appendAssistantTurnReceiptEvent,
} from '../turns.js'

// Only failed attempts are recorded: the start/success receipt events were
// write-only (no reader), and awaiting them let an observability write delay
// provider start or reclassify a successful turn as a provider failure.
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

  // Both writes are best-effort: this runs inside the provider failure
  // classification, and a thrown observability error here would replace the
  // structured failed-attempt outcome (thread id, usage, delivered-context
  // ordinals) with an unclassified error.
  try {
    await appendAssistantTurnReceiptEvent({
      vault: input.vault,
      turnId: input.turnId,
      kind: 'provider.attempt.failed',
      detail: input.detail,
      metadata,
    })
  } catch (error) {
    warnAssistantBestEffortFailure({
      error,
      operation: 'provider attempt receipt event',
    })
  }
  try {
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
  } catch (error) {
    warnAssistantBestEffortFailure({
      error,
      operation: 'provider attempt diagnostic',
    })
  }
}
